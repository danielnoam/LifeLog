// Storage layer for LifeLog.
// Data is written to every CONNECTED target on each save, with a localStorage
// cache always underneath as an offline fallback. Targets:
//   - GitHub : lifelog.json in a private repo via the Contents API — the live
//              sync source (works on phones; every save is a commit = history).
//   - Local file : a user-chosen .json via the File System Access API, kept as
//              an on-disk backup that mirrors every save.
// On load, GitHub wins when connected (source of truth); the local file is
// freshened from it so the backup never goes stale. With neither connected,
// it's browser-only (localStorage), seeded from ./lifelog.json.
(function () {
  const CACHE_KEY = "lifelog-cache-v1";
  const GH_KEY = "lifelog-github-v1";        // { owner, repo, path, branch, token, sha }
  const SYNC_BASE_KEY = "lifelog-sync-base-v1";
  const IDB_NAME = "lifelog";
  const IDB_STORE = "handles";
  const HANDLE_KEY = "dataFile";
  const IDB_HISTORY_STORE = "history";
  const IDB_BOARDS_HISTORY = "boardsHistory"; // boards.json's own saves (0.194.0)
  const IDB_TRAVEL_HISTORY = "travelHistory"; // travel.json's (0.241.0)
  const BOARDS_HISTORY_CAP = 30;
  const HISTORY_CAP = 40; // a rollback aid, not a full audit log — oldest entries beyond this are pruned

  const fsSupported = "showSaveFilePicker" in window;
  const API = "https://api.github.com";

  // ---- tiny IndexedDB helpers (persist the FileSystemFileHandle, and the
  // local-first history log) ----
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 4);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        if (!db.objectStoreNames.contains(IDB_HISTORY_STORE)) db.createObjectStore(IDB_HISTORY_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(IDB_BOARDS_HISTORY)) db.createObjectStore(IDB_BOARDS_HISTORY, { keyPath: "id" });
        if (!db.objectStoreNames.contains(IDB_TRAVEL_HISTORY)) db.createObjectStore(IDB_TRAVEL_HISTORY, { keyPath: "id" });
      };
      req.onsuccess = () => {
        // A newer build in another tab may need to upgrade the database; let
        // it, rather than holding it at this version until this tab closes.
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const r = tx.objectStore(IDB_STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbDel(key) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbAddHistory(entry, store = IDB_HISTORY_STORE) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGetAllHistory(store = IDB_HISTORY_STORE) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const r = tx.objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbDeleteHistory(id, store = IDB_HISTORY_STORE) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---- local-first version history ----
  // Independent of GitHub: every successful save is recorded here too, with
  // a full snapshot and a human-readable diff summary, so restoring recent
  // history works offline and for Browser-only/local-file-only setups that
  // have no GitHub commit log to fall back on at all.
  let lastSavedSnapshot = null; // for diffing into history summaries — a plain in-memory copy, not synced
  function historyId() { return "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  async function recordHistory(data, summary) {
    try {
      await idbAddHistory({ id: historyId(), savedAt: new Date().toISOString(), summary: summary || "Saved", snapshot: data });
      const all = await idbGetAllHistory();
      if (all.length > HISTORY_CAP) {
        all.sort((a, b) => a.savedAt.localeCompare(b.savedAt)); // oldest first
        for (const e of all.slice(0, all.length - HISTORY_CAP)) await idbDeleteHistory(e.id);
      }
    } catch (e) { /* history is a convenience — never block a save on it failing */ }
  }

  // ---- sync base (merge ancestor) ----
  // The last data confirmed to match GitHub — the "we both had this" point a
  // three-way merge diffs local/remote against, so it can tell an intentional
  // deletion apart from an item the other side just hasn't seen yet. Set only
  // when GitHub is actually reached (never on an offline/cache-only save,
  // which would otherwise make the base drift ahead of what's really synced
  // and cause unsynced local edits to look "unchanged" and get discarded).
  // Local-only, never synced itself — a merge ancestor is inherently
  // per-device bookkeeping, not shared data.
  function _setSyncBase(data) {
    try { localStorage.setItem(SYNC_BASE_KEY, JSON.stringify(data)); } catch (e) {}
  }
  function _getSyncBase() {
    try {
      const raw = localStorage.getItem(SYNC_BASE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ---- local-file backend state ----
  let handle = null;        // current FileSystemFileHandle
  let needsReconnect = false;

  async function readHandle(h) {
    const file = await h.getFile();
    const text = await file.text();
    return JSON.parse(text);
  }
  async function writeHandle(h, data) {
    const w = await h.createWritable();
    await w.write(JSON.stringify(data, null, 2));
    await w.close();
  }
  // Load the saved file handle into memory (if any) and note whether it still
  // has permission. Safe to call repeatedly.
  async function ensureHandleLoaded() {
    if (!fsSupported || handle) return;
    try {
      const saved = await idbGet(HANDLE_KEY);
      if (saved) {
        handle = saved;
        const perm = await handle.queryPermission({ mode: "readwrite" });
        needsReconnect = perm !== "granted";
      }
    } catch (e) { /* ignore */ }
  }
  // Best-effort write to the local backup file; never throws. The phone
  // backup rides along: every moment the file is freshened, so is it.
  async function backupToFile(data) {
    backupToPhone(data, "lifelog.json");
    if (!handle || needsReconnect) return false;
    try { await writeHandle(handle, data); return true; }
    catch (e) { needsReconnect = true; return false; }
  }

  // ---- the phone backup (0.215.0, the Android app only) ----
  // A copy in the phone's shared Documents/LifeLog, which the Files app and a
  // PC over USB can see, and which outlives clearing the app's data or
  // uninstalling it — the cases where the cache is gone and a GitHub token
  // may be too. lifelog.json (and boards.json) are the latest save; daily/
  // keeps one copy per day, the day's last, for DAILY_KEEP days, to go back
  // to. Opt-in: turning it on is also what asks Android 9 and earlier for
  // storage (see tools/android-manifest.js). Writes are serialised, so a
  // burst of saves can't interleave two copies of one file.
  const PHONE_KEY = "lifelog-phone-backup-v1"; // { on, last, error }
  // On iOS, Documents is already the app's own folder, which the Files app
  // shows as On My iPhone → LifeLog (tools/ios-project.js); a LifeLog folder
  // inside it would only be a second one. Android's is the shared Documents.
  const phoneIos = () => !!(window.LifeLogPlatform && window.LifeLogPlatform.ios);
  const phonePath = (p) => (phoneIos() ? p : "LifeLog/" + p);
  const DAILY_KEEP = 14;
  const phoneFs = () => (window.LifeLogPlatform && window.LifeLogPlatform.plugin("Filesystem")) || null;
  function phoneCfg() {
    try { return JSON.parse(localStorage.getItem(PHONE_KEY)) || {}; } catch (e) { return {}; }
  }
  function setPhoneCfg(patch) {
    const next = { ...phoneCfg(), ...patch };
    try { localStorage.setItem(PHONE_KEY, JSON.stringify(next)); } catch (e) { /* full */ }
    return next;
  }
  const localDay = (d = new Date()) =>
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  let phoneQueue = Promise.resolve();
  function backupToPhone(doc, name) {
    const FS = phoneFs();
    if (!FS || !phoneCfg().on || !doc) return phoneQueue;
    phoneQueue = phoneQueue.then(() => writePhone(FS, doc, name)).catch(() => {});
    return phoneQueue;
  }
  async function writePhone(FS, doc, name) {
    const write = (path, text) => FS.writeFile({ path: phonePath(path), data: text, directory: "DOCUMENTS", encoding: "utf8", recursive: true });
    try {
      const text = JSON.stringify(name === "lifelog.json" ? withoutSecrets(doc) : doc, null, 2);
      await write(name, text);
      if (name === "lifelog.json") {
        await write("daily/lifelog-" + localDay() + ".json", text);
        await prunePhoneDaily(FS);
      }
      setPhoneCfg({ last: new Date().toISOString(), error: null });
    } catch (e) {
      setPhoneCfg({ error: String((e && e.message) || e).slice(0, 160) });
    }
  }
  async function prunePhoneDaily(FS) {
    const { files } = await FS.readdir({ path: phonePath("daily"), directory: "DOCUMENTS" });
    const days = (files || []).map((f) => (typeof f === "string" ? f : f.name))
      .filter((n) => /^lifelog-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    for (const n of days.slice(0, Math.max(0, days.length - DAILY_KEEP))) {
      await FS.deleteFile({ path: phonePath("daily/" + n), directory: "DOCUMENTS" });
    }
  }

  // ---- GitHub backend ----
  let gh = loadGhCfg();      // { owner, repo, path, branch, token, sha } | null
  let githubError = null;
  // Whether the last load() actually got an answer out of GitHub. Not the
  // same question as "did GitHub's copy win" — a repo with no data file yet
  // answers 404, which is an answer — and the two were being conflated,
  // warning people they were offline while the status line went green.
  let githubReadOk = false;

  function loadGhCfg() {
    try { return JSON.parse(localStorage.getItem(GH_KEY)) || null; } catch (e) { return null; }
  }
  function saveGhCfg() { localStorage.setItem(GH_KEY, JSON.stringify(gh)); }

  // base64 that survives non-ASCII characters
  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64decode(b64) { return decodeURIComponent(escape(atob(b64.replace(/\s/g, "")))); }
  // URL-safe base64 for the device-setup link (carries the connection config)
  function b64urlDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return decodeURIComponent(escape(atob(s)));
  }

  function ghHeaders() {
    return {
      "Authorization": "Bearer " + gh.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }
  function ghContentsUrl(path) {
    return `${API}/repos/${gh.owner}/${gh.repo}/contents/${path || gh.path}`;
  }

  // Every GitHub failure carries a kind, because the status line has to say
  // something true about it. Until 0.173.1 there were two stories: a 401/403
  // was "GitHub rejected your token", and anything else was "will sync when
  // online". Neither is true of a rate limit (a 403 that fixes itself in a
  // minute), and the second is not true of anything except being offline — a
  // data file that had grown past 1MB failed every read, said "offline" to
  // someone who was online, and never recovered.
  function ghErr(status, text, response) {
    let message = "";
    try { message = JSON.parse(text).message || ""; } catch (e) { message = String(text || ""); }
    const e = new Error("GitHub " + status + ": " + String(text || "").slice(0, 200));
    e.status = status;
    e.detail = message.slice(0, 160);
    const limited = /rate limit/i.test(message) ||
      (response && response.headers && response.headers.get("x-ratelimit-remaining") === "0");
    e.kind = status === 401 ? "auth"
      : (status === 403 || status === 429) ? (limited ? "ratelimit" : "auth")
      : status >= 500 ? "server"
      : "other";
    return e;
  }

  // What went wrong, in terms the status line can act on. A fetch that never
  // reached GitHub throws a TypeError before any status exists — that, and
  // only that, is "offline".
  function describeGhError(e) {
    if (!e) return null;
    if (e.kind) return { kind: e.kind, detail: e.detail || "" };
    if (e instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      return { kind: "offline", detail: "" };
    }
    if (e instanceof SyntaxError) return { kind: "other", detail: "GitHub sent back something that isn't your data" };
    return { kind: "other", detail: String(e.message || e).slice(0, 160) };
  }

  // "classic" (ghp_…, every repo the account can see) or "fine" (github_pat_…,
  // the repos it was given). Anything else is unknown: an old-format token
  // or a server-to-server one.
  function tokenKind(token) {
    if (/^ghp_/.test(token || "")) return "classic";
    if (/^github_pat_/.test(token || "")) return "fine";
    return "unknown";
  }

  // The same document with the API keys blanked, for copies that leave the
  // app's own storage: the Export JSON and the phone's Documents folder.
  // Sync and the local-file target keep them; they are live sources, and a
  // reload from either would otherwise lose the keys. Import never reads
  // settings, so a blanked export can't clear the keys on the way back in.
  function withoutSecrets(doc) {
    if (!doc || !doc.settings) return doc;
    const st = doc.settings;
    const out = { ...doc, settings: { ...st } };
    if (st.mediaKeys && typeof st.mediaKeys === "object") {
      out.settings.mediaKeys = Object.fromEntries(Object.keys(st.mediaKeys).map((k) => [k, ""]));
    }
    if (st.steam && typeof st.steam === "object") out.settings.steam = { ...st.steam, apiKey: "" };
    return out;
  }

  // The login the token belongs to (so the user only has to supply a token).
  async function ghWhoAmI() {
    const r = await fetch(API + "/user", { headers: ghHeaders(), cache: "no-store" });
    if (!r.ok) throw ghErr(r.status, await r.text(), r);
    return (await r.json()).login;
  }

  // Make sure the data repo exists; create it (private) if missing.
  // Returns the branch to use (the new repo's default branch when we create it).
  async function ghEnsureRepo() {
    const r = await fetch(API + "/repos/" + gh.owner + "/" + gh.repo, {
      headers: ghHeaders(), cache: "no-store",
    });
    if (r.ok) {
      // The log, its finances and the API keys in settings go into this
      // repo in plain JSON on every save; a public one would publish them.
      // Only a new repo was ever checked (created private, below), so a
      // repo pointed at through Advanced, or one flipped public later, went
      // unnoticed (0.259.2).
      let info = null;
      try { info = await r.json(); } catch (e) {}
      if (info && info.private === false) throw new Error(`The repo ${gh.owner}/${gh.repo} is public — your log would be visible to everyone. Make it private on GitHub, or pick another repo.`);
      return gh.branch;
    }
    if (r.status !== 404) throw ghErr(r.status, await r.text(), r);
    // A token limited to one repo answers 404 for a repo it wasn't given,
    // whether or not the repo exists, and can't create one. Say what to do
    // rather than "GitHub 403" (0.260.0).
    const limited = (msg) => new Error(`This token can't reach ${gh.owner}/${gh.repo}. Create that private repo on GitHub if it doesn't exist yet, and give the token access to it (Only select repositories) — then Connect again.` + (msg ? ` GitHub said: ${msg}` : ""));
    if (tokenKind(gh.token) === "fine") throw limited("");
    const cr = await fetch(API + "/user/repos", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()),
      body: JSON.stringify({ name: gh.repo, private: true, auto_init: true, description: "LifeLog data" }),
    });
    if (!cr.ok) {
      const err = ghErr(cr.status, await cr.text(), cr);
      if (cr.status === 403 || cr.status === 404 || cr.status === 422) throw limited(err.detail);
      throw err;
    }
    const created = await cr.json();
    return created.default_branch || gh.branch; // honour main/master the repo actually used
  }

  // Returns { data, sha } or null if the file doesn't exist yet. `ref` is a
  // branch or a commit; the branch by default.
  //
  // The contents endpoint only carries a file's bytes up to 1MB. Between 1
  // and 100MB it answers with the metadata and an empty `content` with
  // `encoding: "none"`, and the bytes are only reachable as the git blob the
  // sha names. A LifeLog with a few years of entries, a Steam backlog and a
  // finance history crosses 1MB pretty-printed, and from then on every read
  // failed: JSON.parse("") on the empty field. The blob is fetched by the sha
  // from the same answer, so the data and the sha a later save writes against
  // can't come from two different versions of the file.
  async function ghGetFile(ref, path) {
    const r = await fetch(ghContentsUrl(path) + "?ref=" + encodeURIComponent(ref || gh.branch), {
      // Asked for explicitly: "object" is the type documented to answer large
      // files with metadata rather than a refusal.
      headers: Object.assign(ghHeaders(), { "Accept": "application/vnd.github.object+json" }),
      cache: "no-store",
    });
    if (r.status === 404) return null;
    if (!r.ok) throw ghErr(r.status, await r.text(), r);
    const j = await r.json();
    if (j.size === 0) return null; // an empty file holds nothing to merge
    // The content when it came, the blob when it didn't. Keyed on the content
    // itself rather than `encoding`, so an answer that leaves the field out
    // isn't mistaken for a large file.
    const b64 = j.content ? j.content : await ghGetBlob(j.sha);
    return { data: JSON.parse(b64decode(b64)), sha: j.sha };
  }

  async function ghGetBlob(sha) {
    const r = await fetch(`${API}/repos/${gh.owner}/${gh.repo}/git/blobs/${encodeURIComponent(sha)}`, {
      headers: ghHeaders(), cache: "no-store",
    });
    if (!r.ok) throw ghErr(r.status, await r.text(), r);
    const j = await r.json();
    return j.content;
  }

  // The data file's current sha, from a listing of its folder: a few hundred
  // bytes, where ghGetFile brings the whole log (two requests past 1MB) only
  // for the poll to find nothing changed. undefined when the listing didn't
  // answer, so the caller reads the file and reports whatever went wrong.
  async function ghPeekSha() {
    const slash = gh.path.lastIndexOf("/");
    const dir = slash < 0 ? "" : "/" + gh.path.slice(0, slash);
    try {
      const r = await fetch(`${API}/repos/${gh.owner}/${gh.repo}/contents${dir}?ref=${encodeURIComponent(gh.branch)}`, {
        headers: ghHeaders(), cache: "no-store",
      });
      if (!r.ok) return undefined;
      const list = await r.json();
      if (!Array.isArray(list)) return undefined;
      const hit = list.find((f) => f.path === gh.path);
      return hit ? hit.sha : undefined;
    } catch (e) { return undefined; }
  }

  // One retry on a transient failure. A single blip on the load fetch was
  // enough to warn someone their connection was down, and the next save
  // seconds later would go through and turn the status green — leaving a
  // warning on screen contradicted by the thing right next to it. A 401/403
  // is a decision, not a blip, so it is not retried; a 404 never throws.
  async function ghGetFileRetrying() {
    try {
      return await ghGetFile();
    } catch (e) {
      // Neither a rejected token nor a rate limit gets better in a second.
      if (e && (e.kind === "auth" || e.kind === "ratelimit")) throw e;
      return await ghGetFile();
    }
  }

  // Recent commits that touched the data file (newest first). Capped at 20 —
  // this is a rollback aid, not a full audit log.
  async function ghListCommits(path) {
    const url = `${API}/repos/${gh.owner}/${gh.repo}/commits` +
      `?path=${encodeURIComponent(path || gh.path)}&sha=${encodeURIComponent(gh.branch)}&per_page=20`;
    const r = await fetch(url, { headers: ghHeaders(), cache: "no-store" });
    if (!r.ok) throw ghErr(r.status, await r.text(), r);
    const j = await r.json();
    return j.map((c) => ({
      sha: c.sha,
      date: (c.commit.author && c.commit.author.date) || (c.commit.committer && c.commit.committer.date) || null,
      message: (c.commit.message || "").split("\n")[0],
    }));
  }

  // Historical content of the data file at a specific commit — ghGetFile at
  // a ref, including its large-file path: a restore is exactly the moment an
  // old version is needed, and a file past 1MB now is one past 1MB then.
  const ghGetFileAtRef = (ref) => ghGetFile(ref);

  // `path`, `pretty` and `label` are for the files beside lifelog.json,
  // which are written compact: boards.json is mostly numbers, and indenting
  // them would double its size.
  async function ghPut(data, sha, path, pretty = true, label = "lifelog") {
    const body = {
      message: "Update " + label + " (" + new Date().toISOString() + ")",
      content: b64encode(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)),
      branch: gh.branch,
    };
    if (sha) body.sha = sha;
    const r = await fetch(ghContentsUrl(path), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw ghErr(r.status, await r.text(), r);
    const j = await r.json();
    return j.content.sha;
  }

  // Resolves true when another device had saved first and what went out was
  // a merge rather than `data` itself.
  //
  // A stale sha (409) used to be answered by writing this copy over the
  // other device's. That lost its new items twice over: they were gone from
  // GitHub, and the other device's next poll then deleted them locally too —
  // its base had them, the remote didn't, and it hadn't changed them, which
  // is exactly what a deletion looks like (0.180.0). Now this copy is merged
  // onto theirs against the sync base, and the merge is what's written.
  //
  // Neither the sha nor the sync base moves to the merge, on purpose: this
  // device hasn't seen it — state.data still lacks what the other device
  // added. So the next poll finds GitHub changed and brings those items in
  // through its usual merge, and a save before then comes back 409 and
  // merges again instead of writing over them. `merge: false` is for a
  // version the user explicitly chose to put in place.
  async function ghSave(data, { merge = true } = {}) {
    try {
      gh.sha = await ghPut(data, gh.sha);
      saveGhCfg();
      return false;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
    }
    for (let tries = 1; ; tries++) {
      const cur = await ghGetFile();
      const merging = merge && !!cur && !!window.LifeLogMerge;
      const out = merging ? window.LifeLogMerge.mergeAllSources(_getSyncBase(), data, cur.data) : data;
      if (merging) out.exportedAt = new Date().toISOString();
      try {
        const sha = await ghPut(out, cur ? cur.sha : null);
        if (!merging) { gh.sha = sha; saveGhCfg(); }
        return merging;
      } catch (e) {
        // Yet another save landed in between; take it into the next merge.
        if ((e.status !== 409 && e.status !== 422) || tries >= 3) throw e;
      }
    }
  }

  // ---- files beside lifelog.json: boards (0.193.0), travel (0.241.0) ----
  // Drawing boards live in a file of their own, boards.json beside the data
  // file, so an ordinary save — ticking a habit — never uploads them, and a
  // heavy board can't push lifelog.json past GitHub's 1MB mark. The file has
  // its own sha and its own merge ancestor, kept in IndexedDB rather than
  // localStorage because a few handwritten boards would crowd its 5MB. Unlike
  // lifelog.json, a merge here is adopted by the caller straight away (see
  // boards.js), so the sha and base move to whatever was written.
  //
  // Trips (travel.json) are small, but sit beside rather than inside for a
  // different reason: mergeAllSources builds a fresh object from the keys it
  // knows, so a build older than 0.241.0 merging lifelog.json would drop a
  // new root key, and that deletion would then win everywhere. An older
  // build never opens travel.json at all.
  const idbGetSafe = (k) => idbGet(k).catch(() => null);

  // Every save that changed something is kept on the device too, like
  // lifelog.json's local history, so a board wiped by mistake — or by a
  // merge — can be brought back offline and without GitHub. Identical saves
  // in a row are skipped by comparing a fingerprint, rather than reading the
  // last snapshot back each time.
  function fingerprint(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return str.length + ":" + h;
  }

  // One store per sibling file. `keys` are the arrays its document holds and
  // `merge(base, local, remote)` returns a document of them.
  function siblingStore(o) {
    const { file, label, keys, merge, shaKey, cacheKey, baseKey, histStore, histCap, histMark, fileKey, fileType } = o;
    let error = null;
    const path = () => gh.path.replace(/[^/]*$/, "") + file;
    const pick = (d) => { const out = {}; for (const k of keys) out[k] = (d && d[k]) || []; return out; };
    const empty = () => pick(null);
    const hasAny = (d) => keys.some((k) => d && d[k] && d[k].length);
    const same = (a, b) => JSON.stringify(pick(a)) === JSON.stringify(pick(b));

    async function recordHistory(doc) {
      try {
        const mark = fingerprint(JSON.stringify(keys.length === 1 ? doc[keys[0]] : pick(doc)));
        if (localStorage.getItem(histMark) === mark) return;
        await idbAddHistory({ id: historyId(), savedAt: new Date().toISOString(), doc: pick(doc) }, histStore);
        localStorage.setItem(histMark, mark);
        const all = await idbGetAllHistory(histStore);
        if (all.length > histCap) {
          all.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
          for (const e of all.slice(0, all.length - histCap)) await idbDeleteHistory(e.id, histStore);
        }
      } catch (e) { /* a convenience — never blocks a save */ }
    }

    // The file's own backup copy: a second handle, since a page can't make a
    // file beside the one it was given. Written on every save, like
    // lifelog.json's; best-effort, never blocks.
    let handle = null, needsReconnect = false, handleTried = false;
    async function ensureHandle() {
      if (!fsSupported || handle || handleTried) return;
      handleTried = true;
      try {
        const saved = await idbGet(fileKey);
        if (saved) {
          handle = saved;
          needsReconnect = (await saved.queryPermission({ mode: "readwrite" })) !== "granted";
        }
      } catch (e) { /* no file, then */ }
    }
    async function backupToFile(doc) {
      backupToPhone(doc, file);
      await ensureHandle();
      if (!handle || needsReconnect) return false;
      try {
        const w = await handle.createWritable();
        await w.write(JSON.stringify(doc));
        await w.close();
        return true;
      } catch (e) { needsReconnect = true; return false; }
    }

    const store = {
      get error() { return error; },
      // This device's copy, merged with GitHub's when it's connected and
      // reachable. `dirty` means this device holds changes GitHub doesn't
      // have yet (a save made offline, or the merge just now), for the
      // caller to save.
      async load() {
        let local = await idbGetSafe(cacheKey);
        if (!local) { const f = await store.readFile(); if (f && keys.some((k) => Array.isArray(f[k]))) local = pick(f); }
        if (!gh || !gh.token) return { doc: local || empty(), dirty: false };
        const base = await idbGetSafe(baseKey);
        let remote;
        try { remote = await ghGetFile(null, path()); error = null; }
        catch (e) { error = e; return { doc: local || empty(), dirty: false }; }
        if (!remote) return { doc: local || empty(), dirty: hasAny(local) };
        const doc = local ? merge(base, local, remote.data) : pick(remote.data);
        gh[shaKey] = remote.sha; saveGhCfg();
        await idbSet(baseKey, remote.data).catch(() => {});
        await idbSet(cacheKey, doc).catch(() => {});
        return { doc, dirty: !same(doc, remote.data) };
      },
      // Resolves { doc, where, merged }: `doc` is what now stands — the
      // caller's own, or a merge with a save another device made first.
      async save(doc) {
        doc = { ...pick(doc), exportedAt: new Date().toISOString() };
        await idbSet(cacheKey, doc).catch(() => {});
        await recordHistory(doc);
        await backupToFile(doc);
        if (!gh || !gh.token) return { doc, where: "cache", merged: false };
        const p = path();
        let out = doc;
        for (let tries = 0; ; tries++) {
          try {
            gh[shaKey] = await ghPut(out, gh[shaKey], p, false, label);
            saveGhCfg(); error = null;
            await idbSet(baseKey, out).catch(() => {});
            if (out !== doc) await idbSet(cacheKey, out).catch(() => {});
            return { doc: out, where: "github", merged: out !== doc };
          } catch (e) {
            if ((e.status !== 409 && e.status !== 422) || tries >= 3) { error = e; return { doc, where: "cache", merged: false }; }
            let cur;
            try { cur = await ghGetFile(null, p); } catch (e2) { error = e2; return { doc, where: "cache", merged: false }; }
            out = cur ? { ...merge(await idbGetSafe(baseKey), doc, cur.data), exportedAt: doc.exportedAt } : doc;
            gh[shaKey] = cur ? cur.sha : null;
          }
        }
      },
      async forget() {
        await idbDel(cacheKey).catch(() => {});
        await idbDel(baseKey).catch(() => {});
      },
      // Past versions, newest first: this device's saves, then GitHub's
      // commits to the file when it's connected. Each is { id, savedAt,
      // source } — read one with version().
      async history() {
        const local = (await idbGetAllHistory(histStore).catch(() => []))
          .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
          .map((e) => ({ id: e.id, savedAt: e.savedAt, source: "device", doc: e.doc }));
        let remote = [];
        if (gh && gh.token) {
          try { remote = (await ghListCommits(path())).map((c) => ({ id: c.sha, savedAt: c.date, source: "github", sha: c.sha })); }
          catch (e) { remote = []; }
        }
        return local.concat(remote);
      },
      async version(entry) {
        if (entry.doc) return entry.doc;
        const f = await ghGetFile(entry.sha, path());
        if (!f) throw new Error("That version of " + file + " couldn't be found.");
        return f.data;
      },
      // ---- a copy on disk (File System Access), beside the local-file backup ----
      get fileName() { return handle ? handle.name : null; },
      get fileConnected() { return !!(handle && !needsReconnect); },
      get fileNeedsReconnect() { return !!(handle && needsReconnect); },
      async connectFile(doc) {
        if (!fsSupported) throw new Error("unsupported");
        const h = await window.showSaveFilePicker({
          suggestedName: file,
          types: [{ description: fileType, accept: { "application/json": [".json"] } }],
        });
        handle = h; needsReconnect = false;
        await idbSet(fileKey, h);
        if (doc) await h.createWritable().then(async (w) => { await w.write(JSON.stringify(doc)); await w.close(); });
        return h.name;
      },
      async reconnectFile() {
        if (!handle) return false;
        const perm = await handle.requestPermission({ mode: "readwrite" });
        needsReconnect = perm !== "granted";
        return !needsReconnect;
      },
      async disconnectFile() {
        handle = null; needsReconnect = false;
        await idbDel(fileKey).catch(() => {});
      },
      // What's in the file, for a device that has none of its own yet — a
      // new browser pointed at the same backup folder.
      async readFile() {
        await ensureHandle();
        if (!handle || needsReconnect) return null;
        try { const f = await handle.getFile(); return JSON.parse(await f.text()); } catch (e) { return null; }
      },
      async ensureFile() { await ensureHandle(); },
    };
    return store;
  }

  const Boards = siblingStore({
    file: "boards.json", label: "boards", keys: ["boards"],
    merge: (base, local, remote) => ({
      boards: window.LifeLogMerge.mergeBoards(base && base.boards, local && local.boards, remote && remote.boards),
    }),
    shaKey: "boardsSha", cacheKey: "boardsCache", baseKey: "boardsBase",
    histStore: IDB_BOARDS_HISTORY, histCap: BOARDS_HISTORY_CAP, histMark: "lifelog-boards-history-mark",
    fileKey: "boardsFile", fileType: "LifeLog boards",
  });
  const Travel = siblingStore({
    file: "travel.json", label: "travel", keys: ["trips", "places"],
    merge: (base, local, remote) => window.LifeLogMerge.mergeTravel(base, local, remote),
    shaKey: "travelSha", cacheKey: "travelCache", baseKey: "travelBase",
    histStore: IDB_TRAVEL_HISTORY, histCap: BOARDS_HISTORY_CAP, histMark: "lifelog-travel-history-mark",
    fileKey: "travelFile", fileType: "LifeLog trips",
  });

  const Storage = {
    fsSupported,
    boards: Boards,
    travel: Travel,
    get needsReconnect() { return needsReconnect; },
    get fileName() { return handle ? handle.name : null; },
    get fileConnected() { return !!(handle && !needsReconnect); },
    get githubConnected() { return !!(gh && gh.token); },
    get githubError() { return githubError; },
    get githubProblem() { return describeGhError(githubError); },
    get githubReadOk() { return githubReadOk; },
    // public github info without exposing the token
    // The phone backup, for Settings: whether this is somewhere it can be,
    // whether it's on, and when it last wrote.
    get phoneBackup() {
      const c = phoneCfg();
      return { available: !!phoneFs(), on: !!c.on, last: c.last || null, error: c.error || null, folder: phoneIos() ? "Files → On My iPhone → LifeLog" : "Documents/LifeLog" };
    },
    // Turning it on writes a copy straight away, so "on" never means "on,
    // and empty until the next edit". `boards` is boards.json's current doc.
    async enablePhoneBackup(boards) {
      const FS = phoneFs();
      if (!FS) throw new Error("Only in the Android app");
      // Asks on Android 9 and earlier; later versions answer granted.
      try {
        const p = await FS.requestPermissions();
        if (p && p.publicStorage && p.publicStorage !== "granted") throw new Error("LifeLog wasn't allowed to save files");
      } catch (e) { if (/allowed/.test(e.message)) throw e; /* no such call on this build: try anyway */ }
      setPhoneCfg({ on: true, error: null });
      const cached = this.loadCache();
      if (cached) await backupToPhone(cached.data, "lifelog.json");
      if (boards) await backupToPhone(boards, "boards.json");
      const c = phoneCfg();
      if (c.error) { setPhoneCfg({ on: false }); throw new Error(c.error); }
      return this.phoneBackup;
    },
    disablePhoneBackup() { setPhoneCfg({ on: false }); return this.phoneBackup; },

    get githubInfo() {
      return gh ? { owner: gh.owner, repo: gh.repo, path: gh.path, branch: gh.branch, tokenKind: tokenKind(gh.token) } : null;
    },
    withoutSecrets,

    // Returns one of:
    //   { data, source }   source: 'github' | 'file' | 'cache' | 'seed' | 'empty'
    //   { conflict: [{ source, label, data }, ...] }  when sources disagree (by exportedAt)
    // The cache on its own, with nothing awaited: no IndexedDB open for the
    // file handle, no GitHub round-trip. This is what boot renders from, so
    // the first rows are on screen before the network is consulted at all —
    // see reconcileFromSources() in app.js for the other half. Returns null
    // when this device has never held a copy, which is the one case that
    // genuinely has nothing to draw and has to wait for load().
    loadCache() {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      try {
        const data = JSON.parse(raw);
        return data ? { data, source: "cache" } : null;
      } catch (e) { return null; }
    },

    // getLocal, when given, replaces the cached copy as this device's side of
    // the merge. Boot has already rendered from the cache by the time the
    // background pass runs, and the user may have edited since — merging
    // against the stale cache would quietly undo those edits. It is a
    // function rather than a value so the snapshot is taken after the network
    // waits below, at the latest possible moment before the merge.
    async load(getLocal) {
      await ensureHandleLoaded(); // so the local file can also serve as a backup

      const candidates = [];

      // --- GitHub ---
      githubReadOk = false;
      if (gh && gh.token) {
        try {
          const f = await ghGetFileRetrying();
          // Reached, whatever it said. A missing file is an answer: it means
          // "nothing synced here yet", not "we couldn't get through".
          githubReadOk = true;
          if (f) {
            gh.sha = f.sha; saveGhCfg();
            githubError = null;
            candidates.push({ source: "github", label: "GitHub (" + gh.owner + "/" + gh.repo + ")", data: f.data });
          }
          // file vanished — fall through to local/cache/seed
        } catch (e) { githubError = e; /* offline/bad token → local/cache */ }
      }

      // --- Local file ---
      if (handle && !needsReconnect) {
        try {
          const data = await readHandle(handle);
          candidates.push({ source: "file", label: "Local file (" + handle.name + ")", data });
        } catch (e) { /* file moved/unreadable; fall through */ }
      }

      // --- this device's own copy ---
      if (getLocal) {
        const live = getLocal();
        if (live) candidates.push({ source: "cache", label: "This browser", data: live });
      } else {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          try { candidates.push({ source: "cache", label: "This browser", data: JSON.parse(cached) }); }
          catch (e) { /* ignore */ }
        }
      }

      if (!candidates.length) {
        // --- seed from bundled file (works when served over http) ---
        try {
          const res = await fetch("lifelog.json", { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            this._cache(data);
            return { data, source: "seed" };
          }
        } catch (e) { /* ignore */ }

        return { data: null, source: "empty" };
      }

      // If the available sources were saved at different times, try to merge
      // them automatically instead of asking the user to pick one and
      // discard the rest — the common case here is simply "another device
      // saved while this one was offline", not a genuine irreconcilable
      // conflict. remote = GitHub (or the local file, if that's all that's
      // connected); local = this device's own last-known cache.
      const stamped = candidates.filter((c) => c.data && c.data.exportedAt);
      if (new Set(stamped.map((c) => c.data.exportedAt)).size > 1) {
        const remote = candidates.find((c) => c.source === "github") || candidates.find((c) => c.source === "file");
        const local = candidates.find((c) => c.source === "cache");
        if (window.LifeLogMerge && remote && local && remote !== local) {
          try {
            const syncBase = _getSyncBase();
            const merged = window.LifeLogMerge.mergeAllSources(syncBase, local.data, remote.data);
            merged.exportedAt = new Date().toISOString();
            this._cache(merged);
            let remerged = false;
            if (gh && gh.token) { try { remerged = await ghSave(merged); githubError = null; } catch (e) { githubError = e; } }
            await backupToFile(merged);
            if (!remerged) _setSyncBase(merged);
            lastSavedSnapshot = structuredClone(merged);
            const conflictSummary = window.LifeLogMerge.summarizeConflicts(syncBase, local.data, remote.data);
            let historySummary = "Merged — " + window.LifeLogMerge.diffSnapshots(local.data, merged);
            if (conflictSummary) historySummary += " (" + conflictSummary + ")";
            await recordHistory(merged, historySummary);
            return { data: merged, source: "merged", conflictSummary };
          } catch (e) {
            // Merge itself failed (malformed data etc.) — fall back to the
            // manual picker rather than guessing.
            return { conflict: candidates };
          }
        }
        return { conflict: candidates };
      }

      // Otherwise GitHub wins (source of truth), then the local file, then cache.
      const order = { github: 0, file: 1, cache: 2 };
      candidates.sort((a, b) => order[a.source] - order[b.source]);
      const winner = candidates[0];
      if (winner.source === "github") {
        this._cache(winner.data);
        await backupToFile(winner.data); // keep the on-disk backup fresh
        _setSyncBase(winner.data);
      } else if (winner.source === "file") {
        this._cache(winner.data);
      }
      return { data: winner.data, source: winner.source };
    },

    // Apply the user's chosen version (from a `conflict` result) everywhere:
    // cache it and push it to GitHub / the local file if connected, so every
    // target ends up holding the same data.
    async resolveConflict(candidate) {
      const data = candidate.data;
      this._cache(data);
      if (gh && gh.token) {
        try { await ghSave(data, { merge: false }); githubError = null; }
        catch (e) { githubError = e; }
      }
      await backupToFile(data);
      return { data, source: candidate.source };
    },

    _cache(data) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
    },

    // Persist data to cache plus EVERY connected target (GitHub + local file).
    // Resolves to { where, merged }: where it landed — 'github+file' |
    // 'github' | 'file' | 'cache' — and whether GitHub had moved on and got
    // a merge instead (see ghSave), which means there's something to fetch.
    async save(data) {
      this._cache(data);
      let toGithub = false, toFile = false, merged = false;

      if (gh && gh.token) {
        try {
          merged = await ghSave(data);
          githubError = null; toGithub = true;
          if (!merged) _setSyncBase(data);
        } catch (e) { githubError = e; }
      }
      toFile = await backupToFile(data);

      const summary = (window.LifeLogMerge && lastSavedSnapshot)
        ? window.LifeLogMerge.diffSnapshots(lastSavedSnapshot, data)
        : "Saved";
      await recordHistory(data, summary);
      lastSavedSnapshot = structuredClone(data);

      const where = toGithub && toFile ? "github+file" : toGithub ? "github" : toFile ? "file" : "cache";
      return { where, merged };
    },

    // Local-first history: recent saves with a full snapshot + diff
    // summary, newest first, capped at HISTORY_CAP — works fully offline
    // and regardless of which backends (if any) are connected.
    async listLocalHistory() {
      try {
        const all = await idbGetAllHistory();
        return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      } catch (e) { return []; }
    },

    // The last data confirmed to match GitHub — the merge ancestor a
    // three-way merge diffs against. See _setSyncBase's comment above.
    getSyncBase() { return _getSyncBase(); },

    // ---- Local-file backend controls ----
    async connectFile(currentData) {
      if (!fsSupported) throw new Error("unsupported");
      const h = await window.showSaveFilePicker({
        suggestedName: "lifelog.json",
        types: [{ description: "LifeLog data", accept: { "application/json": [".json"] } }],
      });
      handle = h;
      needsReconnect = false;
      await idbSet(HANDLE_KEY, h);
      if (currentData) await writeHandle(h, currentData);
      return h.name;
    },
    async reconnect() {
      if (!handle) return false;
      const perm = await handle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") { needsReconnect = false; return true; }
      return false;
    },
    async disconnect() {
      handle = null;
      needsReconnect = false;
      await idbDel(HANDLE_KEY);
    },

    // ---- GitHub backend controls ----
    // cfg: { owner?, repo?, path?, branch?, token }. Owner defaults to the
    // token's account and the repo is auto-created (private) if missing, so the
    // user normally only needs to supply a token.
    // allowCreate: when false, refuses to create a new file if none exists yet
    // (used by link-based pairing, which should only ever join an existing
    // sync target — never silently seed/overwrite it with empty data).
    // Returns { existed: bool, data?: <remote data when it already existed> }.
    async connectGithub(cfg, currentData, allowCreate = true) {
      const prev = gh;
      gh = {
        owner: (cfg.owner || "").trim(),
        repo: (cfg.repo || "lifelog-data").trim(),
        path: cfg.path || "lifelog.json",
        branch: cfg.branch || "main",
        token: cfg.token, sha: null,
      };
      try {
        if (!gh.owner) gh.owner = await ghWhoAmI(); // derive account from token
        gh.branch = await ghEnsureRepo();           // create the repo if needed
        const existing = await ghGetFile();
        if (existing) {
          gh.sha = existing.sha;
          saveGhCfg(); githubError = null;
          return { existed: true, data: existing.data };
        }
        if (!allowCreate) {
          throw new Error("No existing data found at this sync target — open the link from the device that already has your data, or set this up from Settings instead.");
        }
        // Create the file with whatever we currently have.
        gh.sha = await ghPut(currentData, null);
        saveGhCfg(); githubError = null;
        return { existed: false };
      } catch (e) {
        gh = prev; // don't leave a half-applied/bad config in memory
        throw e;
      }
    },
    async disconnectGithub() {
      gh = null; githubError = null;
      localStorage.removeItem(GH_KEY);
    },

    // Wipes this device's local copy and connections — used by the app-lock
    // "forgot PIN" reset, so that resetting the lock can't double as a free
    // bypass to see the data. Forgets the GitHub token and local file handle
    // (without touching the actual repo or file contents — those can be
    // reconnected to afterward) and clears the localStorage cache.
    async forgetDevice() {
      if (gh && gh.token) await Storage.disconnectGithub();
      if (handle) await Storage.disconnect();
      await Boards.forget();
      await Travel.forget();
      try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem("lifelog-travel-ui"); } catch (e) {}
    },

    // Lightweight poll for changes made elsewhere (e.g. another device).
    // Returns { changed: true, data } if the remote file moved on since we
    // last loaded/saved it, { changed: false } if it's the same, or null if
    // GitHub isn't connected or unreachable (e.g. offline) — callers should
    // treat null as "nothing to report" and try again later.
    //
    // It doesn't take the new sha as this device's own — the caller does
    // that with acceptRemote once it has actually merged the data in. Taking
    // it here was the last way to overwrite another device (0.185.0): a poll
    // that found a change and then backed off (a save in flight, a form just
    // opened) left this device holding GitHub's new sha without GitHub's new
    // data, so its next save sailed through with no 409 to stop it.
    async checkRemote() {
      if (!gh || !gh.token) return null;
      try {
        if (gh.sha && await ghPeekSha() === gh.sha) return { changed: false };
        const f = await ghGetFile();
        if (!f || f.sha === gh.sha) return { changed: false };
        return { changed: true, data: f.data, sha: f.sha };
      } catch (e) { return { changed: false, error: e }; }
    },
    acceptRemote(sha) {
      if (!gh || !sha) return;
      gh.sha = sha; saveGhCfg();
    },
    // What this device believes about GitHub — the sha it writes against and
    // the merge ancestor — so a caller that has read GitHub but can't take
    // the result in yet can put the belief back, and the next save meets a
    // 409 and merges rather than writing over what it never saw.
    syncPoint() {
      return { sha: gh ? gh.sha : null, base: localStorage.getItem(SYNC_BASE_KEY) };
    },
    restoreSyncPoint(p) {
      if (!p) return;
      if (gh) { gh.sha = p.sha; saveGhCfg(); }
      try {
        if (p.base == null) localStorage.removeItem(SYNC_BASE_KEY);
        else localStorage.setItem(SYNC_BASE_KEY, p.base);
      } catch (e) { /* the base is a convenience; the 409 is what protects */ }
    },
    // What a failure means, for callers that report one themselves (the
    // Android app's pull to refresh). The same reading the status line uses.
    describeError: (e) => describeGhError(e),

    // ---- version history (GitHub only) ----
    // Recent commits to the data file. Throws if GitHub isn't connected or the
    // request fails — this is a user-initiated action, so callers should show
    // the error rather than swallow it.
    async listHistory() {
      if (!gh || !gh.token) throw new Error("GitHub isn't connected.");
      return ghListCommits();
    },
    // Data as of a specific historical commit. Read-only — does not touch the
    // current save state. Callers should normalize() the result and call
    // Storage.save() themselves to commit it forward as the new current state.
    async getVersion(sha) {
      if (!gh || !gh.token) throw new Error("GitHub isn't connected.");
      const f = await ghGetFileAtRef(sha);
      if (!f) throw new Error("That version's data file couldn't be found.");
      return f.data;
    },

    // ---- one-link device setup ----
    // Compact URL fragment carrying the connection (incl. token). Default fields
    // are omitted so the link/QR stays short; the owner is derived from the token.
    setupFragment() {
      if (!gh || !gh.token) return null;
      const p = new URLSearchParams();
      p.set("t", gh.token);
      const advanced = (gh.repo && gh.repo !== "lifelog-data");
      if (advanced) p.set("r", gh.repo);
      if (gh.path && gh.path !== "lifelog.json") p.set("p", gh.path);
      if (gh.branch && gh.branch !== "main") p.set("b", gh.branch);
      if (advanced && gh.owner) p.set("o", gh.owner); // org/non-default repos can't derive owner
      return p.toString();
    },
    // True if a location hash carries a setup payload (new #t= or legacy #setup=).
    hashHasSetup(hash) {
      return /[#&](t|setup)=/.test(hash || "");
    },
    // "owner/repo" a setup hash would connect to, for asking before it does;
    // "your account/lifelog-data" when the link leaves the owner to the
    // token. null when the hash carries no usable setup.
    describeSetupHash(hash) {
      let cfg;
      try { cfg = parseSetupHash(hash); } catch (e) { return null; }
      if (!cfg || !cfg.token) return null;
      return (cfg.owner || "your account") + "/" + (cfg.repo || "lifelog-data");
    },
    // Connect from a location hash produced on another device. Returns the
    // connectGithub result, or null if the hash has no setup payload. Never
    // creates a new (empty) file — pairing only ever joins a sync target that
    // already has data; if it doesn't, that's an error, not something to fix
    // by overwriting it with this device's (likely empty) data.
    async connectFromHash(hash, currentData) {
      const cfg = parseSetupHash(hash);
      if (!cfg) return null;
      return this.connectGithub(cfg, currentData, false);
    },
  };

  // The connection a setup hash carries, or null when it has none.
  function parseSetupHash(hash) {
    const h = (hash || "").replace(/^#/, "");
    const legacy = h.match(/(?:^|&)setup=([A-Za-z0-9\-_]+)/);
    if (legacy) {
      const c = JSON.parse(b64urlDecode(legacy[1]));
      return { owner: c.o, repo: c.r, path: c.p, branch: c.b, token: c.t };
    }
    const p = new URLSearchParams(h);
    if (!p.get("t")) return null;
    return { owner: p.get("o") || "", repo: p.get("r") || "", path: p.get("p") || "", branch: p.get("b") || "", token: p.get("t") };
  }

  window.LifeLogStorage = Storage;
})();
