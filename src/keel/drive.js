// keel: backups in Google Drive, beside GitHub sync rather than instead of
// it (Waypage's drive.js, with LifeLog's sign-in for the computer app).
// What goes in a backup, and when one runs, stay in each app.
//
//   const drive = Keel.drive.create({ name: "Waypage", tag: "wpdrive", keys, webClient, ... });
//   await drive.connect();
//   await drive.upload({ blob }, { device }, onProgress, ctl);
//
// The scope is drive.file: the app sees only the files it made, so Google
// needs no review. How a token is got:
//   - Android: the app's Drive plugin asks Play Services, which knows the
//     app by its package name and signing key. No client ID here.
//   - A browser: Google's sign-in page in a small window, which hands a
//     token back through the address (good for an hour).
//   - A computer app (Tauri): Google won't send a sign-in back to the
//     app's own window, so it opens in the browser and comes back to a
//     one-off address on 127.0.0.1 that the app listens on (the loopback
//     flow, with PKCE). That gives a refresh token, kept on the computer.
//
// create()'s options:
//   name           the folder in Drive and the word in descriptions; its
//                  lower case tags the files (appProperties) and names the
//                  sign-in window and channel
//   tag            what the sign-in's state starts with ("wpdrive")
//   keys           localStorage keys: { cfg, token, hand, ask }
//   webClient      the Web client ID ("" and a browser isn't offered Drive)
//   desktopClient, desktopSecret   the Desktop client ("" and no computer)
//   mime           what a backup is ("application/json")
//   native(), desktop()            which platform this is
//   plugin()       the Capacitor Drive plugin, or null
//   tauri()        window.__TAURI__ on a computer, or null
//   openOutside(url)               opens the system browser (computer)
//   fileBlob(uri, size)            the plugin's downloaded file as a Blob
//   fresh()        the app's own fields for a new connection's settings
(function () {
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const API = "https://www.googleapis.com/drive/v3";
  const OUT = "&fields=id,name,size,createdTime,description";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart" + OUT;
  const RESUMABLE = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable" + OUT;
  const TOKEN_URL = "https://oauth2.googleapis.com/token";
  const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
  // A browser's backup goes up in pieces this big: Drive wants a multiple
  // of 256 KB, and a piece is all a pause or a dropped connection costs.
  const CHUNK = 8 * 1024 * 1024;
  const FIELDS = "id,name,size,createdTime,description,appProperties";
  const KEEP = 3;
  const DAY = 24 * 3600 * 1000;
  const EVERY = [1, 3, 7, 14, 30];
  const SENDING = "The backup didn't finish sending. Try again on a steadier connection.";

  class DriveError extends Error {
    constructor(message, code) { super(message); this.code = code || ""; }
  }

  // ---- Pure parts ----

  // Which backups to keep: the newest KEEP, and with backups more often
  // than weekly the newest one at least a week older than those, so a
  // mistake found a few days late can still be undone. `all` newest first.
  function toKeep(all, every) {
    const keep = new Set(all.slice(0, KEEP));
    if (all.length && every < 7) {
      const week = all.find((f) => !keep.has(f) && f.at <= all[0].at - 7 * DAY);
      if (week) keep.add(week);
    }
    return keep;
  }
  // Whether an automatic backup is due: `every` days since the last one,
  // or since connecting when there's none yet.
  function isDue(cfg, now) {
    if (!cfg || !cfg.auto) return false;
    const every = EVERY.includes(cfg.every) ? cfg.every : 7;
    const from = Math.max((cfg.last && cfg.last.at) || 0, cfg.since || 0);
    return now - from >= every * DAY - 3600 * 1000;
  }
  // "<prefix>-2026-11-15-0930<ext>"
  function fileName(prefix, ext, d) {
    const p = (n) => String(n).padStart(2, "0");
    return prefix + "-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ext;
  }
  // Drive's answers as rows: [{ id, name, size, at, from, props }], newest first.
  function readList(files) {
    return (files || []).map((f) => ({ id: f.id, name: f.name, size: Number(f.size) || 0, at: Date.parse(f.createdTime) || 0,
      from: (f.appProperties && f.appProperties.device) || "", props: f.appProperties || {} })).sort((a, b) => b.at - a.at);
  }
  function failure(status, body) {
    const why = body && body.error && (body.error.errors || [])[0];
    const reason = (why && why.reason) || "";
    if (status === 401) return new DriveError("Connect Google Drive again.", "signin");
    if (/storageQuotaExceeded|quotaExceeded/.test(reason)) return new DriveError("Your Google Drive is full.", "full");
    if (status === 404) return new DriveError("That backup isn't in Drive any more.", "gone");
    return new DriveError("Google Drive said no (" + status + "). Try again later.", String(status));
  }
  const parseBody = (msg) => { try { return JSON.parse(String(msg).replace(/^[^{]*/, "")); } catch (e) { return null; } };
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const randomText = (n) => b64url(crypto.getRandomValues(new Uint8Array(n))).replace(/[^A-Za-z0-9]/g, "x");
  async function challengeOf(verifier) {
    return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  }
  const quote = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

  function create(o) {
    const NAME = o.name;
    const LOW = NAME.toLowerCase();
    const K = o.keys;
    const MIME = o.mime || "application/json";
    const native = () => !!(o.native && o.native());
    const desktop = () => !!(o.desktop && o.desktop());
    const P = () => (o.plugin && o.plugin()) || null;
    const T = () => (desktop() && o.tauri && o.tauri()) || null;
    const browser = () => !native() && !desktop();

    const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const keep = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not kept */ } };
    let cfg = load(K.cfg, null);
    let token = null; // { token, exp }
    const save = () => keep(K.cfg, cfg);
    const live = (t) => !!(t && t.token && t.exp > Date.now());
    const expiry = (s) => Date.now() + ((Number(s) || 3600) - 120) * 1000;

    // ---- Coming back from Google's sign-in page (a browser) ----
    // The address carries #state=<tag>.<p|r>.<nonce>[.then]&access_token=…:
    // p when it opened in its own window, which closes again; r when the
    // browser blocked that window and this tab went to Google itself.
    const back = (() => {
      if (!browser() || location.hash.indexOf("state=" + o.tag + ".") < 0) return null;
      const q = new URLSearchParams(location.hash.slice(1));
      if (!(q.get("state") || "").startsWith(o.tag + ".")) return null;
      history.replaceState(history.state, "", location.pathname + location.search);
      const [, how, nonce, then] = q.get("state").split(".");
      const got = { nonce, then: then || "", error: q.get("error") || (q.get("access_token") ? "" : "none"),
        token: q.get("access_token") || "", exp: expiry(q.get("expires_in")) };
      keep(K.hand, got);
      try { const ch = new BroadcastChannel(LOW + ".drive"); ch.postMessage(got); ch.close(); } catch (e) { /* the storage event says it too */ }
      if (how === "p") setTimeout(() => window.close(), 60);
      return { popup: how === "p", got };
    })();

    // ---- Tokens ----

    if (browser()) { const t = load(K.token, null); if (live(t)) token = t; }
    const setToken = (t) => { token = t; if (browser()) keep(K.token, t); };
    const loginHint = () => (cfg && cfg.email ? { login_hint: cfg.email } : {});

    // A browser: Google's page in a small window; the page it comes back
    // to (this app, at its own address) leaves the token in K.hand and
    // closes. Without a window (blocked), this tab goes there and comes
    // back with `then` to carry on with.
    let waiting = null;
    function signInBrowser(then) {
      if (!o.webClient) return Promise.reject(new DriveError("Google Drive isn't set up in this copy.", "setup"));
      const nonce = randomText(12);
      keep(K.ask, nonce);
      keep(K.hand, null);
      const redirect = location.origin + location.pathname.replace(/[^/]*$/, "");
      const url = (how) => AUTH_URL + "?" + new URLSearchParams({
        client_id: o.webClient, redirect_uri: redirect, response_type: "token", scope: SCOPE, include_granted_scopes: "true",
        state: o.tag + "." + how + "." + nonce + (how === "r" && then ? "." + then : ""), ...loginHint(),
      });
      const w = window.open(url("p"), LOW + "-drive", "popup,width=480,height=640");
      if (!w) { location.assign(url("r")); return new Promise(() => {}); }
      if (waiting) waiting.no(new DriveError("Asked again.", "again"));
      return new Promise((ok, no) => {
        waiting = { ok, no };
        // Not w.closed: Google's page cuts the window off from this one,
        // so it reads closed while it's still open.
        waiting.timer = setTimeout(() => { if (waiting) { waiting = null; no(new DriveError("Google didn't answer.", "timeout")); } }, 5 * 6e4);
      });
    }
    function handed(got) {
      if (!got || got.nonce !== load(K.ask, null)) return;
      keep(K.ask, null);
      keep(K.hand, null);
      const w = waiting;
      waiting = null;
      if (w) clearTimeout(w.timer);
      if (got.error) { if (w) w.no(new DriveError(got.error === "access_denied" ? "Not allowed." : "Google said no (" + got.error + ").", "declined")); return; }
      setToken({ token: got.token, exp: got.exp });
      if (w) w.ok(got.token);
    }
    if (browser()) {
      addEventListener("storage", (e) => { if (e.key === K.hand && e.newValue) handed(load(K.hand, null)); });
      try { new BroadcastChannel(LOW + ".drive").onmessage = (e) => handed(e.data); } catch (e) { /* storage event instead */ }
      if (back && !back.popup) handed(back.got);
    }

    // A computer: the browser, back to 127.0.0.1 (the app's oauth_listen
    // and oauth_wait commands).
    async function tokenRequest(fields) {
      let res;
      try {
        res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: o.desktopClient, client_secret: o.desktopSecret || "", ...fields }).toString() });
      } catch (e) { throw new DriveError("Couldn't reach Google. Check the connection and try again.", "network"); }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !body.access_token) {
        if (body && body.error === "invalid_grant") { keep(K.token, null); throw new DriveError("Connect Google Drive again.", "signin"); }
        throw new DriveError("Google said no (" + ((body && body.error) || res.status) + ").", "declined");
      }
      return body;
    }
    async function signInDesktop() {
      if (!o.desktopClient) throw new DriveError("Google Drive isn't set up in this copy.", "setup");
      const t = T();
      const port = await t.core.invoke("oauth_listen");
      const redirect = "http://127.0.0.1:" + port;
      const verifier = randomText(48);
      const state = randomText(12);
      const url = AUTH_URL + "?" + new URLSearchParams({
        client_id: o.desktopClient, redirect_uri: redirect, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent",
        code_challenge: await challengeOf(verifier), code_challenge_method: "S256", state, ...loginHint(),
      });
      const answer = t.core.invoke("oauth_wait");
      o.openOutside(url);
      let q;
      try { q = new URLSearchParams(await answer); }
      catch (e) { throw new DriveError(/time/i.test(String(e)) ? "Google didn't answer." : "Sign-in stopped.", "timeout"); }
      if (q.get("state") !== state) throw new DriveError("That sign-in wasn't this one. Try again.", "declined");
      if (q.get("error") || !q.get("code")) throw new DriveError(q.get("error") === "access_denied" ? "Not allowed." : "Google said no.", "declined");
      const got = await tokenRequest({ code: q.get("code"), code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect });
      if (got.refresh_token) keep(K.token, { refresh: got.refresh_token });
      setToken({ token: got.access_token, exp: expiry(got.expires_in) });
      return got.access_token;
    }

    // A token, asking the person only when `ask` (a tap; a browser can
    // open its sign-in window only then). Throws DriveError "signin" otherwise.
    async function getToken(ask, then) {
      if (live(token)) return token.token;
      const D = P();
      if (D) {
        try {
          const r = await D.authorize({ ask: !!ask });
          setToken({ token: r.token, exp: Date.now() + 50 * 6e4 });
          return r.token;
        } catch (e) {
          if (e && e.code === "consent") throw new DriveError("Connect Google Drive again.", "signin");
          if (e && e.code === "declined") throw new DriveError("Not allowed.", "declined");
          throw new DriveError("Couldn't reach Google. Check the connection and try again.", "network");
        }
      }
      if (T()) {
        const kept = load(K.token, null);
        if (kept && kept.refresh) {
          const got = await tokenRequest({ refresh_token: kept.refresh, grant_type: "refresh_token" });
          setToken({ token: got.access_token, exp: expiry(got.expires_in) });
          return got.access_token;
        }
        if (!ask) throw new DriveError("Connect Google Drive again.", "signin");
        return signInDesktop();
      }
      if (!ask) throw new DriveError("Sign in to Google again.", "signin");
      return signInBrowser(then);
    }
    async function forget(t) {
      const D = P();
      if (D && t && D.clearToken) await D.clearToken({ token: t }).catch(() => {});
    }

    async function api(path, opts = {}, ask) {
      for (let tries = 0; ; tries++) {
        const t = await getToken(ask);
        let res;
        try {
          res = await fetch(path.startsWith("https:") ? path : API + path, { ...opts, headers: { Authorization: "Bearer " + t, ...(opts.headers || {}) } });
        } catch (e) {
          throw new DriveError("Couldn't reach Google Drive. Check the connection and try again.", "network");
        }
        // Play Services hands back its cached token until told it's dead,
        // say after Disconnect revoked it.
        if (res.status === 401 && !tries) { setToken(null); await forget(t); continue; }
        if (res.status === 204) return null;
        const body = await res.json().catch(() => null);
        if (!res.ok) throw failure(res.status, body);
        return body;
      }
    }

    // ---- Drive ----

    // The app's folder, made the first time. Found again by name when its
    // id is lost (another device made it: drive.file sees what any copy of
    // the app made, as they share one Google Cloud project).
    async function folder() {
      if (cfg.folder) {
        const f = await api("/files/" + cfg.folder + "?fields=id,trashed").catch((e) => { if (e.code === "gone") return null; throw e; });
        if (f && !f.trashed) return cfg.folder;
      }
      const q = "name=" + quote(NAME) + " and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents";
      const found = await api("/files?" + new URLSearchParams({ q, fields: "files(id)", pageSize: "1" }));
      let id = found && found.files && found.files[0] && found.files[0].id;
      if (!id) {
        const made = await api("/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: NAME, mimeType: "application/vnd.google-apps.folder" }) });
        id = made.id;
      }
      cfg.folder = id;
      save();
      return id;
    }

    // The backups there, newest first.
    async function list() {
      const dir = await folder();
      const q = quote(dir) + " in parents and trashed=false and appProperties has { key=" + quote(LOW) + " and value='backup' }";
      const got = await api("/files?" + new URLSearchParams({ q, orderBy: "createdTime desc", fields: "files(" + FIELDS + ")", pageSize: "50" }));
      return readList(got && got.files);
    }

    // Sends one backup and keeps the newest. `src` is { uri } (a file the
    // plugin sends, Android), { blob } or { text }, with an optional
    // `name`; `info` is { device, props } (props: more appProperties, as
    // text). `ctl.stop()` (set here) breaks the transfer off: it rejects
    // "cancelled". Called again with the same `ctl`, it goes on from where
    // Drive got to. Resolves to { id, size }.
    async function upload(src, info = {}, onProgress, ctl = {}) {
      const dir = await folder();
      const ext = MIME === "application/zip" ? ".zip" : MIME === "application/json" ? ".json" : "";
      const meta = { name: src.name || fileName(LOW, ext, new Date()), parents: [dir], mimeType: MIME,
        description: NAME + " backup" + (info.device ? " from " + info.device : ""),
        appProperties: { ...(info.props || {}), [LOW]: "backup", device: String(info.device || "").slice(0, 40) } };
      let made;
      const D = P();
      if (D && src.uri && D.session) {
        const heard = onProgress ? await D.addListener("progress", (p) => onProgress(p.done, p.total)) : null;
        ctl.stop = () => D.cancel().catch(() => {});
        try {
          if (!ctl.session) ctl.session = (await D.session({ uri: src.uri, token: await getToken(false), meta: JSON.stringify(meta) })).session;
          made = await D.send({ uri: src.uri, session: ctl.session });
        } catch (e) {
          if (e && e.code === "cancelled") throw new DriveError("Stopped.", "cancelled");
          if (e && e.code === "401") setToken(null);
          // A session Drive has forgotten (404, 410) starts over next time.
          if (e && /^(404|410)$/.test(e.code || "")) ctl.session = null;
          throw e && /^\d+$/.test(e.code || "") ? failure(Number(e.code), parseBody(e.message)) : new DriveError(SENDING, "network");
        } finally {
          ctl.stop = null;
          if (heard) heard.remove();
        }
      } else {
        const blob = src.blob || new Blob([src.text], { type: MIME });
        made = await sendInPieces(blob, meta, onProgress, ctl);
      }
      await prune().catch(() => {});
      return { id: made.id, size: Number(made.size) || 0 };
    }

    // A resumable upload: a session at Drive, then the file a piece at a
    // time, so Resume goes on from the last piece Drive took instead of
    // from the start. The session's address is Location, or, where a
    // browser isn't shown that, the upload id Drive does show; neither,
    // and it's one request. `ctl` keeps the session and how far it got.
    async function sendInPieces(blob, meta, onProgress, ctl) {
      const total = blob.size;
      if (!ctl.session) {
        const res = await fetch(RESUMABLE, { method: "POST", headers: { Authorization: "Bearer " + await getToken(false),
          "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": MIME, "X-Upload-Content-Length": String(total) },
          body: JSON.stringify(meta) }).catch(() => null);
        if (!res) throw new DriveError(SENDING, "network");
        if (res.status === 401) setToken(null);
        if (!res.ok) throw failure(res.status, await res.json().catch(() => null));
        const id = res.headers.get("X-GUploader-UploadID");
        ctl.session = res.headers.get("Location") || (id ? RESUMABLE + "&upload_id=" + encodeURIComponent(id) : null);
        ctl.at = 0;
        if (!ctl.session) return send(blob, meta, await getToken(false), onProgress, ctl);
      }
      for (;;) {
        // After a pause or a dropped piece, Drive says how much it has: a
        // piece cut off may still have reached it.
        const asking = !!ctl.unsure;
        const from = ctl.at || 0, to = asking ? from : Math.min(total, from + CHUNK);
        ctl.unsure = true;
        const x = await piece(ctl, asking ? null : blob.slice(from, to), from, to, total, onProgress);
        ctl.unsure = false;
        if (x.status === 308) {
          const range = /^bytes=0-(\d+)$/.exec(x.getResponseHeader("Range") || "");
          ctl.at = range ? Number(range[1]) + 1 : asking ? 0 : to;
          continue;
        }
        let got = null;
        try { got = JSON.parse(x.responseText); } catch (e) { got = null; }
        if (x.status >= 200 && x.status < 300 && got && got.id) return got;
        // A session Drive has forgotten starts over next time.
        if (x.status === 404 || x.status === 410) ctl.session = null;
        if (x.status === 401) setToken(null);
        throw failure(x.status, got);
      }
    }
    // XMLHttpRequest rather than fetch, for its upload progress.
    function xhr(method, url, t, headers, body, onProgress, ctl, from = 0) {
      return new Promise((ok, no) => {
        const x = new XMLHttpRequest();
        x.open(method, url);
        x.setRequestHeader("Authorization", "Bearer " + t);
        for (const h in headers) x.setRequestHeader(h, headers[h]);
        if (onProgress) x.upload.onprogress = (e) => onProgress(from + e.loaded, e.total);
        ctl.stop = () => x.abort();
        const done = () => { ctl.stop = null; };
        x.onload = () => { done(); ok(x); };
        x.onabort = () => { done(); no(new DriveError("Stopped.", "cancelled")); };
        x.onerror = () => { done(); no(new DriveError(SENDING, "network")); };
        x.send(body);
      });
    }
    async function piece(ctl, part, from, to, total, onProgress) {
      const t = await getToken(false);
      const range = part ? "bytes " + from + "-" + (to - 1) + "/" + total : "bytes */" + total;
      return xhr("PUT", ctl.session, t, { "Content-Range": range }, part, onProgress && ((done) => onProgress(done, total)), ctl, from);
    }
    // One multipart request: where a resumable session can't be had.
    async function send(blob, meta, t, onProgress, ctl) {
      const cut = LOW + randomText(9);
      const body = new Blob(["--" + cut + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
        "\r\n--" + cut + "\r\nContent-Type: " + MIME + "\r\n\r\n", blob, "\r\n--" + cut + "--\r\n"]);
      const x = await xhr("POST", UPLOAD, t, { "Content-Type": "multipart/related; boundary=" + cut }, body, onProgress, ctl);
      let got = null;
      try { got = JSON.parse(x.responseText); } catch (e) { got = null; }
      if (x.status >= 200 && x.status < 300 && got && got.id) return got;
      if (x.status === 401) setToken(null);
      throw failure(x.status, got);
    }

    // Deletes for good rather than to Drive's bin, where it would go on
    // counting against the space.
    async function prune() {
      const all = await list();
      const kept = toKeep(all, cfg && cfg.auto ? cfg.every || 7 : 7);
      for (const f of all) if (!kept.has(f)) await api("/files/" + encodeURIComponent(f.id), { method: "DELETE" }).catch(() => {});
    }
    async function remove(id) { await api("/files/" + encodeURIComponent(id), { method: "DELETE" }, true); }

    // A backup as a Blob. On Android the plugin brings it down to a file
    // (o.fileBlob turns that into a Blob); elsewhere fetch does.
    async function download(id, onProgress, ctl = {}) {
      const D = P();
      if (D && D.download) {
        const heard = onProgress ? await D.addListener("progress", (p) => onProgress(p.done, p.total)) : null;
        ctl.stop = () => D.cancel().catch(() => {});
        try {
          const got = await D.download({ id, token: await getToken(false) });
          return await o.fileBlob(got.uri, got.size);
        } catch (e) {
          if (e && e.code === "cancelled") throw new DriveError("Stopped.", "cancelled");
          if (e && e.code === "401") setToken(null);
          throw e instanceof DriveError ? e : e && /^\d+$/.test(e.code || "") ? failure(Number(e.code), parseBody(e.message))
            : new DriveError("Couldn't bring the backup down. Try again.", "network");
        } finally {
          ctl.stop = null;
          if (heard) heard.remove();
        }
      }
      const t = await getToken(false);
      const ac = new AbortController();
      ctl.stop = () => ac.abort();
      let res;
      try { res = await fetch(API + "/files/" + encodeURIComponent(id) + "?alt=media", { headers: { Authorization: "Bearer " + t }, signal: ac.signal }); }
      catch (e) { ctl.stop = null; throw ac.signal.aborted ? new DriveError("Stopped.", "cancelled") : new DriveError("Couldn't bring the backup down. Try again.", "network"); }
      try {
        if (res.status === 401) setToken(null);
        if (!res.ok) throw failure(res.status, await res.json().catch(() => null));
        return await res.blob();
      } catch (e) {
        throw ac.signal.aborted ? new DriveError("Stopped.", "cancelled") : e;
      } finally {
        ctl.stop = null;
      }
    }

    // ---- Connecting ----

    async function connect() {
      await getToken(true, "connect");
      const about = await api("/about?fields=user(emailAddress)", {}, true);
      // The first automatic backup is a week after connecting, not now.
      cfg = { email: (about && about.user && about.user.emailAddress) || "", auto: true, every: 7, last: {}, since: Date.now(), ...(o.fresh ? o.fresh() : {}) };
      save();
      await folder();
      return cfg.email;
    }
    // The app's access is taken back from Google too, so the account's
    // "Third-party connections" page doesn't keep listing it.
    async function disconnect() {
      const kept = load(K.token, null);
      const t = (token && token.token) || (kept && kept.refresh) || "";
      cfg = null;
      keep(K.cfg, null);
      keep(K.token, null);
      token = null;
      if (!t) return;
      await forget(t);
      fetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "token=" + encodeURIComponent(t) }).catch(() => {});
    }

    return {
      DriveError, KEEP, DAY, EVERY, connect, disconnect, list, upload, download, remove, getToken, plugin: P,
      // There's a way in: the plugin on a phone, a Desktop client on a
      // computer, a Web client in a browser served over https.
      get available() {
        if (native()) return !!P();
        if (desktop()) return !!o.desktopClient && !!T();
        return !!o.webClient && (location.protocol === "https:" || location.hostname === "localhost");
      },
      get on() { return !!cfg; },
      get email() { return cfg ? cfg.email : ""; },
      get folder() { return (cfg && cfg.folder) || ""; },
      get auto() { return !!(cfg && cfg.auto); },
      set auto(v) { if (cfg) { cfg.auto = !!v; save(); } },
      get every() { return (cfg && EVERY.includes(cfg.every) && cfg.every) || 7; },
      set every(v) { if (cfg && EVERY.includes(v)) { cfg.every = v; save(); } },
      get last() { return (cfg && cfg.last) || {}; },
      set last(v) { if (cfg) { cfg.last = v || {}; save(); } },
      get since() { return (cfg && cfg.since) || 0; },
      set since(v) { if (cfg) { cfg.since = v; save(); } },
      get due() { return isDue(cfg, Date.now()); },
      // The app's own settings, kept beside these (what fresh() made).
      get(k) { return cfg ? cfg[k] : undefined; },
      set(k, v) { if (cfg) { cfg[k] = v; save(); } },
      // Whether a token is at hand without asking: always on a phone and,
      // once connected, on a computer; in a browser only for the hour.
      get signedIn() { return native() ? !!P() : desktop() ? !!(load(K.token, null) || {}).refresh || live(token) : live(token); },
      // The sign-in window's own copy: it only hands the token over.
      get closing() { return !!(back && back.popup); },
      // What a tab sent to Google itself was doing ("connect", "backup").
      get resume() { return back && !back.popup && !back.got.error ? back.got.then : ""; },
    };
  }

  window.Keel = window.Keel || {};
  window.Keel.drive = { create, DriveError, toKeep, isDue, fileName, readList, failure, challengeOf, KEEP, DAY, EVERY };
})();
