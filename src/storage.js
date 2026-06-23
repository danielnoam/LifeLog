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
  const IDB_NAME = "lifelog";
  const IDB_STORE = "handles";
  const HANDLE_KEY = "dataFile";

  const fsSupported = "showSaveFilePicker" in window;
  const API = "https://api.github.com";

  // ---- tiny IndexedDB helpers (persist the FileSystemFileHandle) ----
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
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
  // Best-effort write to the local backup file; never throws.
  async function backupToFile(data) {
    if (!handle || needsReconnect) return false;
    try { await writeHandle(handle, data); return true; }
    catch (e) { needsReconnect = true; return false; }
  }

  // ---- GitHub backend ----
  let gh = loadGhCfg();      // { owner, repo, path, branch, token, sha } | null
  let githubError = null;

  function loadGhCfg() {
    try { return JSON.parse(localStorage.getItem(GH_KEY)) || null; } catch (e) { return null; }
  }
  function saveGhCfg() { localStorage.setItem(GH_KEY, JSON.stringify(gh)); }

  // base64 that survives non-ASCII characters
  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64decode(b64) { return decodeURIComponent(escape(atob(b64.replace(/\s/g, "")))); }
  // URL-safe base64 for the device-setup link (carries the connection config)
  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
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
  function ghContentsUrl() {
    return `${API}/repos/${gh.owner}/${gh.repo}/contents/${gh.path}`;
  }

  function ghErr(status, text) {
    const e = new Error("GitHub " + status + ": " + text.slice(0, 200));
    e.status = status; return e;
  }

  // The login the token belongs to (so the user only has to supply a token).
  async function ghWhoAmI() {
    const r = await fetch(API + "/user", { headers: ghHeaders(), cache: "no-store" });
    if (!r.ok) throw ghErr(r.status, await r.text());
    return (await r.json()).login;
  }

  // Make sure the data repo exists; create it (private) if missing.
  // Returns the branch to use (the new repo's default branch when we create it).
  async function ghEnsureRepo() {
    const r = await fetch(API + "/repos/" + gh.owner + "/" + gh.repo, {
      headers: ghHeaders(), cache: "no-store",
    });
    if (r.ok) return gh.branch;
    if (r.status !== 404) throw ghErr(r.status, await r.text());
    const cr = await fetch(API + "/user/repos", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()),
      body: JSON.stringify({ name: gh.repo, private: true, auto_init: true, description: "LifeLog data" }),
    });
    if (!cr.ok) throw ghErr(cr.status, await cr.text());
    const created = await cr.json();
    return created.default_branch || gh.branch; // honour main/master the repo actually used
  }

  // Returns { data, sha } or null if the file doesn't exist yet.
  async function ghGetFile() {
    const r = await fetch(ghContentsUrl() + "?ref=" + encodeURIComponent(gh.branch), {
      headers: ghHeaders(), cache: "no-store",
    });
    if (r.status === 404) return null;
    if (!r.ok) {
      const err = new Error("GitHub " + r.status + ": " + (await r.text()).slice(0, 200));
      err.status = r.status; throw err;
    }
    const j = await r.json();
    return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
  }

  // Recent commits that touched the data file (newest first). Capped at 20 —
  // this is a rollback aid, not a full audit log.
  async function ghListCommits() {
    const url = `${API}/repos/${gh.owner}/${gh.repo}/commits` +
      `?path=${encodeURIComponent(gh.path)}&sha=${encodeURIComponent(gh.branch)}&per_page=20`;
    const r = await fetch(url, { headers: ghHeaders(), cache: "no-store" });
    if (!r.ok) throw ghErr(r.status, await r.text());
    const j = await r.json();
    return j.map((c) => ({
      sha: c.sha,
      date: (c.commit.author && c.commit.author.date) || (c.commit.committer && c.commit.committer.date) || null,
      message: (c.commit.message || "").split("\n")[0],
    }));
  }

  // Historical content of the data file at a specific commit. Same shape as
  // ghGetFile() (data, sha) but addressed by commit sha instead of the branch tip.
  async function ghGetFileAtRef(ref) {
    const r = await fetch(ghContentsUrl() + "?ref=" + encodeURIComponent(ref), {
      headers: ghHeaders(), cache: "no-store",
    });
    if (r.status === 404) return null;
    if (!r.ok) throw ghErr(r.status, await r.text());
    const j = await r.json();
    return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
  }

  async function ghPut(data, sha) {
    const body = {
      message: "Update lifelog (" + new Date().toISOString() + ")",
      content: b64encode(JSON.stringify(data, null, 2)),
      branch: gh.branch,
    };
    if (sha) body.sha = sha;
    const r = await fetch(ghContentsUrl(), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = new Error("GitHub " + r.status + ": " + (await r.text()).slice(0, 200));
      err.status = r.status; throw err;
    }
    const j = await r.json();
    return j.content.sha;
  }

  async function ghSave(data) {
    try {
      gh.sha = await ghPut(data, gh.sha);
    } catch (e) {
      // Stale SHA (edited on another device) → refetch and overwrite (last write wins).
      if (e.status === 409 || e.status === 422) {
        const cur = await ghGetFile();
        gh.sha = await ghPut(data, cur ? cur.sha : null);
      } else throw e;
    }
    saveGhCfg();
  }

  const Storage = {
    fsSupported,
    get needsReconnect() { return needsReconnect; },
    get fileName() { return handle ? handle.name : null; },
    get fileConnected() { return !!(handle && !needsReconnect); },
    get githubConnected() { return !!(gh && gh.token); },
    get githubError() { return githubError; },
    // public github info without exposing the token
    get githubInfo() {
      return gh ? { owner: gh.owner, repo: gh.repo, path: gh.path, branch: gh.branch } : null;
    },

    // Returns one of:
    //   { data, source }   source: 'github' | 'file' | 'cache' | 'seed' | 'empty'
    //   { conflict: [{ source, label, data }, ...] }  when sources disagree (by exportedAt)
    async load() {
      await ensureHandleLoaded(); // so the local file can also serve as a backup

      const candidates = [];

      // --- GitHub ---
      if (gh && gh.token) {
        try {
          const f = await ghGetFile();
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

      // --- localStorage cache ---
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        try { candidates.push({ source: "cache", label: "This browser", data: JSON.parse(cached) }); }
        catch (e) { /* ignore */ }
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

      // If the available sources were saved at different times, let the user pick.
      const stamped = candidates.filter((c) => c.data && c.data.exportedAt);
      if (new Set(stamped.map((c) => c.data.exportedAt)).size > 1) {
        return { conflict: candidates };
      }

      // Otherwise GitHub wins (source of truth), then the local file, then cache.
      const order = { github: 0, file: 1, cache: 2 };
      candidates.sort((a, b) => order[a.source] - order[b.source]);
      const winner = candidates[0];
      if (winner.source === "github") {
        this._cache(winner.data);
        await backupToFile(winner.data); // keep the on-disk backup fresh
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
        try { await ghSave(data); githubError = null; }
        catch (e) { githubError = e; }
      }
      await backupToFile(data);
      return { data, source: candidate.source };
    },

    _cache(data) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
    },

    // Persist data to cache plus EVERY connected target (GitHub + local file).
    // Returns where it landed: 'github+file' | 'github' | 'file' | 'cache'.
    async save(data) {
      this._cache(data);
      let toGithub = false, toFile = false;

      if (gh && gh.token) {
        try { await ghSave(data); githubError = null; toGithub = true; }
        catch (e) { githubError = e; }
      }
      toFile = await backupToFile(data);

      if (toGithub && toFile) return "github+file";
      if (toGithub) return "github";
      if (toFile) return "file";
      return "cache";
    },

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
      try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    },

    // Lightweight poll for changes made elsewhere (e.g. another device).
    // Returns { changed: true, data } if the remote file moved on since we
    // last loaded/saved it, { changed: false } if it's the same, or null if
    // GitHub isn't connected or unreachable (e.g. offline) — callers should
    // treat null as "nothing to report" and try again later.
    async checkRemote() {
      if (!gh || !gh.token) return null;
      try {
        const f = await ghGetFile();
        if (!f || f.sha === gh.sha) return { changed: false };
        gh.sha = f.sha; saveGhCfg();
        return { changed: true, data: f.data };
      } catch (e) { return null; }
    },

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
    // Connect from a location hash produced on another device. Returns the
    // connectGithub result, or null if the hash has no setup payload. Never
    // creates a new (empty) file — pairing only ever joins a sync target that
    // already has data; if it doesn't, that's an error, not something to fix
    // by overwriting it with this device's (likely empty) data.
    async connectFromHash(hash, currentData) {
      const h = (hash || "").replace(/^#/, "");
      let cfg = null;
      const legacy = h.match(/(?:^|&)setup=([A-Za-z0-9\-_]+)/);
      if (legacy) {
        const c = JSON.parse(b64urlDecode(legacy[1]));
        cfg = { owner: c.o, repo: c.r, path: c.p, branch: c.b, token: c.t };
      } else {
        const p = new URLSearchParams(h);
        if (!p.get("t")) return null;
        cfg = { owner: p.get("o") || "", repo: p.get("r") || "", path: p.get("p") || "", branch: p.get("b") || "", token: p.get("t") };
      }
      return this.connectGithub(cfg, currentData, false);
    },
  };

  window.LifeLogStorage = Storage;
})();
