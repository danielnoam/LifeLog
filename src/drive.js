// LifeLog: backups in Google Drive, beside GitHub sync rather than
// instead of it (Waypage's src/drive.js, made for LifeLog's three
// platforms). A backup is one JSON file, the same shape as Import & export
// → Everything (lifelog.json without its keys, with boards and the
// watchlist), in a "LifeLog" folder in the person's Drive; the newest KEEP
// are kept, and with backups more often than weekly one a week old too.
//
// The scope is drive.file: LifeLog sees only the files it made, so Google
// needs no review. How a token is got:
//   - Android: the Drive plugin (native/widgets) asks Play Services, which
//     knows the app by its package name and signing key. No client ID here.
//   - A browser: Google's sign-in page in a small window, which hands a
//     token back through the address (good for an hour), as Waypage does.
//   - The Windows and Linux app: Google won't send a sign-in back to the
//     app's own window, so it opens in the browser and comes back to a
//     one-off address on 127.0.0.1 that src-tauri listens on (the loopback
//     flow, with PKCE). That gives a refresh token, kept on this computer,
//     so automatic backups need no sign-in each hour.
(function () {
  // From the LifeLog Google Cloud project's clients. Neither is a secret:
  // the Desktop client's "secret" is one Google says can't be kept in an
  // app and isn't treated as one. Empty means Drive isn't offered.
  const WEB_CLIENT = "";
  const DESKTOP_CLIENT = "";
  const DESKTOP_SECRET = "";

  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime";
  const TOKEN_URL = "https://oauth2.googleapis.com/token";
  const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  const FIELDS = "id,name,size,createdTime,appProperties";
  const CFG_KEY = "lifelog-drive-v1";        // { email, folder, auto, every, last, since }
  const TOKEN_KEY = "lifelog-drive-token-v1"; // { token, exp } (browser) or { refresh } (computer)
  const HAND_KEY = "lifelog-drive-hand";     // the sign-in window's answer
  const ASK_KEY = "lifelog-drive-ask";       // what that answer must carry
  const FOLDER = "LifeLog";
  const KEEP = 3;
  const DAY = 24 * 3600 * 1000;
  const EVERY = [1, 3, 7, 14, 30];

  class DriveError extends Error {
    constructor(message, code) { super(message); this.code = code || ""; }
  }

  // ---- Pure parts (tested in test/drive.test.js) ----

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
    const from = (cfg.last && cfg.last.at) || cfg.since || 0;
    return now - from >= every * DAY - 3600 * 1000;
  }
  function backupName(d) {
    const p = (n) => String(n).padStart(2, "0");
    return "lifelog-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ".json";
  }
  // Drive's answers as rows: [{ id, name, size, at, from }], newest first.
  function readList(files) {
    return (files || []).map((f) => ({ id: f.id, name: f.name, size: Number(f.size) || 0, at: Date.parse(f.createdTime) || 0,
      from: (f.appProperties && f.appProperties.device) || "" })).sort((a, b) => b.at - a.at);
  }
  // The body of one multipart upload: the file's details, then the file.
  function multipart(meta, text, cut) {
    return "--" + cut + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
      "\r\n--" + cut + "\r\nContent-Type: application/json\r\n\r\n" + text + "\r\n--" + cut + "--\r\n";
  }
  function failure(status, body) {
    const why = body && body.error && (body.error.errors || [])[0];
    const reason = (why && why.reason) || "";
    if (status === 401) return new DriveError("Connect Google Drive again.", "signin");
    if (/storageQuotaExceeded|quotaExceeded/.test(reason)) return new DriveError("Your Google Drive is full.", "full");
    if (status === 404) return new DriveError("That backup isn't in Drive any more.", "gone");
    return new DriveError("Google Drive said no (" + status + "). Try again later.", String(status));
  }
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const randomText = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
  async function challengeOf(verifier) {
    return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  }

  const pure = { toKeep, isDue, backupName, readList, multipart, failure, challengeOf, DriveError, KEEP, DAY, EVERY };
  if (typeof module !== "undefined" && module.exports && typeof window !== "undefined" && !window.document) {
    module.exports = pure;
    return;
  }

  // ---- The app's side ----

  const P = () => window.LifeLogPlatform || {};
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const keep = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not kept */ } };
  const plugin = () => (P().native && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Drive) || null;
  const tauri = () => (P().desktop && window.__TAURI__) || null;
  let cfg = load(CFG_KEY, null);
  let token = null; // { token, exp }
  const save = () => keep(CFG_KEY, cfg);
  const live = (t) => !!(t && t.token && t.exp > Date.now());

  // ---- Coming back from Google's sign-in page (a browser) ----
  // The address carries #state=lldrive.<p|r>.<nonce>&access_token=…: p when
  // it opened in its own window, which closes again; r when the browser
  // blocked that window and this tab went to Google itself.
  const back = (() => {
    if (P().native || P().desktop || !/[#&]state=lldrive\./.test(location.hash)) return null;
    const q = new URLSearchParams(location.hash.slice(1));
    history.replaceState(history.state, "", location.pathname + location.search);
    const [, how, nonce, then] = (q.get("state") || "").split(".");
    const got = { nonce, then: then || "", error: q.get("error") || (q.get("access_token") ? "" : "none"),
      token: q.get("access_token") || "", exp: Date.now() + ((Number(q.get("expires_in")) || 3600) - 120) * 1000 };
    keep(HAND_KEY, got);
    try { const ch = new BroadcastChannel("lifelog.drive"); ch.postMessage(got); ch.close(); } catch (e) { /* the storage event says it too */ }
    if (how === "p") setTimeout(() => window.close(), 60);
    return { popup: how === "p", got };
  })();

  if (!P().native && !P().desktop) { const t = load(TOKEN_KEY, null); if (live(t)) token = t; }
  const setToken = (t) => { token = t; if (!P().native && !P().desktop) keep(TOKEN_KEY, t); };

  // ---- A browser: Google's page in a small window ----
  let waiting = null;
  function signInBrowser(then) {
    if (!WEB_CLIENT) return Promise.reject(new DriveError("Google Drive isn't set up in this copy.", "setup"));
    const nonce = randomText(12).replace(/[._]/g, "x");
    keep(ASK_KEY, nonce);
    keep(HAND_KEY, null);
    const redirect = location.origin + location.pathname.replace(/[^/]*$/, "");
    const url = (how) => AUTH_URL + "?" + new URLSearchParams({
      client_id: WEB_CLIENT, redirect_uri: redirect, response_type: "token", scope: SCOPE, include_granted_scopes: "true",
      state: "lldrive." + how + "." + nonce + (how === "r" && then ? "." + then : ""), ...(cfg && cfg.email ? { login_hint: cfg.email } : {}),
    });
    const w = window.open(url("p"), "lifelog-drive", "popup,width=480,height=640");
    if (!w) { location.assign(url("r")); return new Promise(() => {}); }
    if (waiting) waiting.no(new DriveError("Asked again.", "again"));
    return new Promise((ok, no) => {
      waiting = { ok, no };
      // Not w.closed: Google's page cuts the window off from this one, so
      // it reads closed while it's still open.
      waiting.timer = setTimeout(() => { if (waiting) { waiting = null; no(new DriveError("Google didn't answer.", "timeout")); } }, 5 * 6e4);
    });
  }
  function handed(got) {
    if (!got || got.nonce !== load(ASK_KEY, null)) return;
    keep(ASK_KEY, null);
    keep(HAND_KEY, null);
    const w = waiting;
    waiting = null;
    if (w) clearTimeout(w.timer);
    if (got.error) { if (w) w.no(new DriveError(got.error === "access_denied" ? "Not allowed." : "Google said no (" + got.error + ").", "declined")); return; }
    setToken({ token: got.token, exp: got.exp });
    if (w) w.ok(got.token);
  }
  if (!P().native && !P().desktop) {
    addEventListener("storage", (e) => { if (e.key === HAND_KEY && e.newValue) handed(load(HAND_KEY, null)); });
    try { new BroadcastChannel("lifelog.drive").onmessage = (e) => handed(e.data); } catch (e) { /* storage event instead */ }
    if (back && !back.popup) handed(back.got);
  }

  // ---- The computer app: the browser, back to 127.0.0.1 ----
  async function tokenRequest(fields) {
    let res;
    try {
      res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: DESKTOP_CLIENT, client_secret: DESKTOP_SECRET, ...fields }).toString() });
    } catch (e) { throw new DriveError("Couldn't reach Google. Check the connection and try again.", "network"); }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.access_token) {
      if (body && body.error === "invalid_grant") { keep(TOKEN_KEY, null); throw new DriveError("Connect Google Drive again.", "signin"); }
      throw new DriveError("Google said no (" + ((body && body.error) || res.status) + ").", "declined");
    }
    return body;
  }
  async function signInDesktop() {
    if (!DESKTOP_CLIENT) throw new DriveError("Google Drive isn't set up in this copy.", "setup");
    const T = tauri();
    const port = await T.core.invoke("oauth_listen");
    const redirect = "http://127.0.0.1:" + port;
    const verifier = randomText(48);
    const state = randomText(12);
    const url = AUTH_URL + "?" + new URLSearchParams({
      client_id: DESKTOP_CLIENT, redirect_uri: redirect, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent",
      code_challenge: await challengeOf(verifier), code_challenge_method: "S256", state, ...(cfg && cfg.email ? { login_hint: cfg.email } : {}),
    });
    const answer = T.core.invoke("oauth_wait");
    P().openOutside(url);
    let q;
    try { q = new URLSearchParams(await answer); }
    catch (e) { throw new DriveError(/time/i.test(String(e)) ? "Google didn't answer." : "Sign-in stopped.", "timeout"); }
    if (q.get("state") !== state) throw new DriveError("That sign-in wasn't this one. Try again.", "declined");
    if (q.get("error") || !q.get("code")) throw new DriveError(q.get("error") === "access_denied" ? "Not allowed." : "Google said no.", "declined");
    const got = await tokenRequest({ code: q.get("code"), code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect });
    if (got.refresh_token) keep(TOKEN_KEY, { refresh: got.refresh_token });
    setToken({ token: got.access_token, exp: Date.now() + ((Number(got.expires_in) || 3600) - 120) * 1000 });
    return got.access_token;
  }

  // A token, asking the person only when `ask` (a tap; a browser can open
  // its sign-in window only then). Throws DriveError "signin" otherwise.
  async function getToken(ask, then) {
    if (live(token)) return token.token;
    const D = plugin();
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
    if (tauri()) {
      const kept = load(TOKEN_KEY, null);
      if (kept && kept.refresh) {
        const got = await tokenRequest({ refresh_token: kept.refresh, grant_type: "refresh_token" });
        setToken({ token: got.access_token, exp: Date.now() + ((Number(got.expires_in) || 3600) - 120) * 1000 });
        return got.access_token;
      }
      if (!ask) throw new DriveError("Connect Google Drive again.", "signin");
      return signInDesktop();
    }
    if (!ask) throw new DriveError("Sign in to Google again.", "signin");
    return signInBrowser(then);
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
      // Play Services hands back its cached token until told it's dead.
      if (res.status === 401 && !tries) {
        setToken(null);
        const D = plugin();
        if (D && D.clearToken) await D.clearToken({ token: t }).catch(() => {});
        continue;
      }
      if (res.status === 204) return null;
      const body = opts.raw && res.ok ? await res.text() : await res.json().catch(() => null);
      if (!res.ok) throw failure(res.status, body);
      return body;
    }
  }

  // ---- Drive ----

  const quote = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

  // The LifeLog folder, made the first time; found again by name when its
  // id is lost (another device made it: drive.file sees what any copy of
  // LifeLog made, as they share one Google Cloud project).
  async function folder() {
    if (cfg.folder) {
      const f = await api("/files/" + cfg.folder + "?fields=id,trashed").catch((e) => { if (e.code === "gone") return null; throw e; });
      if (f && !f.trashed) return cfg.folder;
    }
    const q = "name=" + quote(FOLDER) + " and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents";
    const found = await api("/files?" + new URLSearchParams({ q, fields: "files(id)", pageSize: "1" }));
    let id = found && found.files && found.files[0] && found.files[0].id;
    if (!id) {
      const made = await api("/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }) });
      id = made.id;
    }
    cfg.folder = id;
    save();
    return id;
  }

  async function list() {
    const dir = await folder();
    const q = quote(dir) + " in parents and trashed=false and appProperties has { key='lifelog' and value='backup' }";
    const got = await api("/files?" + new URLSearchParams({ q, orderBy: "createdTime desc", fields: "files(" + FIELDS + ")", pageSize: "50" }));
    return readList(got && got.files);
  }

  // Sends one backup (`text`, the JSON) and keeps the newest. Resolves to
  // { id, size, at }, which is also kept as `last`.
  async function upload(text, device) {
    const dir = await folder();
    const meta = { name: backupName(new Date()), parents: [dir], mimeType: "application/json",
      description: "LifeLog backup" + (device ? " from " + device : ""),
      appProperties: { lifelog: "backup", device: String(device || "").slice(0, 40) } };
    const cut = "lifelog" + randomText(9).replace(/[^A-Za-z0-9]/g, "");
    const made = await api(UPLOAD, { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + cut }, body: multipart(meta, text, cut) }, false);
    const out = { id: made.id, size: Number(made.size) || text.length, at: Date.now() };
    cfg.last = out;
    save();
    await prune().catch(() => {});
    return out;
  }
  // Prune deletes for good rather than to Drive's bin, where it would go on
  // counting against the space.
  async function prune() {
    const all = await list();
    const kept = toKeep(all, cfg && cfg.auto ? cfg.every || 7 : 7);
    for (const f of all) if (!kept.has(f)) await api("/files/" + f.id, { method: "DELETE" }).catch(() => {});
  }
  async function remove(id) { await api("/files/" + encodeURIComponent(id), { method: "DELETE" }, true); }
  // A backup's text, parsed.
  async function download(id) {
    const text = await api("/files/" + encodeURIComponent(id) + "?alt=media", { raw: true });
    try { return JSON.parse(text); } catch (e) { throw new DriveError("That backup can't be read.", "bad"); }
  }

  // ---- Connecting ----

  async function connect() {
    await getToken(true, "connect");
    const about = await api("/about?fields=user(emailAddress)", {}, true);
    // The first automatic backup is `every` days after connecting; Back up
    // now is there for one straight away.
    cfg = { email: (about && about.user && about.user.emailAddress) || "", auto: true, every: 7, last: null, since: Date.now() };
    save();
    await folder();
    return cfg.email;
  }
  // LifeLog's access is taken back from Google too, so the account's
  // "Third-party connections" page doesn't keep listing it.
  async function disconnect() {
    const kept = load(TOKEN_KEY, null);
    const t = (token && token.token) || (kept && kept.refresh) || "";
    cfg = null;
    keep(CFG_KEY, null);
    keep(TOKEN_KEY, null);
    token = null;
    if (!t) return;
    const D = plugin();
    if (D && D.clearToken) await D.clearToken({ token: t }).catch(() => {});
    fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "token=" + encodeURIComponent(t) }).catch(() => {});
  }

  window.LifeLogDrive = {
    ...pure, connect, disconnect, list, upload, download, remove, getToken,
    // There's a way in: the plugin on Android, a Desktop client on a
    // computer, a Web client in a browser served over https.
    get available() {
      if (P().native) return !!plugin();
      if (P().desktop) return !!DESKTOP_CLIENT;
      return !!WEB_CLIENT && (location.protocol === "https:" || location.hostname === "localhost");
    },
    get on() { return !!cfg; },
    get email() { return cfg ? cfg.email : ""; },
    get auto() { return !!(cfg && cfg.auto); },
    set auto(v) { if (cfg) { cfg.auto = !!v; save(); } },
    get every() { return (cfg && EVERY.includes(cfg.every) && cfg.every) || 7; },
    set every(v) { if (cfg && EVERY.includes(v)) { cfg.every = v; save(); } },
    get last() { return (cfg && cfg.last) || null; },
    get due() { return isDue(cfg, Date.now()); },
    // Whether a token is at hand without asking: always on Android and,
    // once connected, on a computer; in a browser only for the hour.
    get signedIn() { return P().native ? !!plugin() : P().desktop ? !!(load(TOKEN_KEY, null) || {}).refresh || live(token) : live(token); },
    // The sign-in window's own copy: it only hands the token over.
    get closing() { return !!(back && back.popup); },
    // What a tab sent to Google itself was doing ("connect", "backup").
    get resume() { return back && !back.popup && !back.got.error ? back.got.then : ""; },
  };
})();
