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
  const HISTORY_CAP = 40; // a rollback aid, not a full audit log — oldest entries beyond this are pruned

  const fsSupported = "showSaveFilePicker" in window;
  const API = "https://api.github.com";

  // ---- tiny IndexedDB helpers (persist the FileSystemFileHandle, and the
  // local-first history log) ----
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        if (!db.objectStoreNames.contains(IDB_HISTORY_STORE)) db.createObjectStore(IDB_HISTORY_STORE, { keyPath: "id" });
      };
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
  async function idbAddHistory(entry) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_HISTORY_STORE, "readwrite");
      tx.objectStore(IDB_HISTORY_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGetAllHistory() {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_HISTORY_STORE, "readonly");
      const r = tx.objectStore(IDB_HISTORY_STORE).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbDeleteHistory(id) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_HISTORY_STORE, "readwrite");
      tx.objectStore(IDB_HISTORY_STORE).delete(id);
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
  // Best-effort write to the local backup file; never throws.
  async function backupToFile(data) {
    if (!handle || needsReconnect) return false;
    try { await writeHandle(handle, data); return true; }
    catch (e) { needsReconnect = true; return false; }
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
    if (r.ok) return gh.branch;
    if (r.status !== 404) throw ghErr(r.status, await r.text(), r);
    const cr = await fetch(API + "/user/repos", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()),
      body: JSON.stringify({ name: gh.repo, private: true, auto_init: true, description: "LifeLog data" }),
    });
    if (!cr.ok) throw ghErr(cr.status, await cr.text(), cr);
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
  async function ghListCommits() {
    const url = `${API}/repos/${gh.owner}/${gh.repo}/commits` +
      `?path=${encodeURIComponent(gh.path)}&sha=${encodeURIComponent(gh.branch)}&per_page=20`;
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

  // `path` and `pretty` are for boards.json, which is written compact: it's
  // mostly numbers, and indenting them would double its size.
  async function ghPut(data, sha, path, pretty = true) {
    const body = {
      message: "Update " + (path ? "boards" : "lifelog") + " (" + new Date().toISOString() + ")",
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

  // ---- boards (0.193.0) ----
  // Drawing boards live in a file of their own, boards.json beside the data
  // file, so an ordinary save — ticking a habit — never uploads them, and a
  // heavy board can't push lifelog.json past GitHub's 1MB mark. The file has
  // its own sha and its own merge ancestor, kept in IndexedDB rather than
  // localStorage because a few handwritten boards would crowd its 5MB. Unlike
  // lifelog.json, a merge here is adopted by the caller straight away (see
  // boards.js), so the sha and base move to whatever was written.
  const BOARDS_CACHE = "boardsCache", BOARDS_BASE = "boardsBase";
  let boardsError = null;
  const boardsPath = () => gh.path.replace(/[^/]*$/, "") + "boards.json";
  const emptyBoards = () => ({ boards: [] });
  const mergeBoardDocs = (base, local, remote) => ({
    boards: window.LifeLogMerge.mergeBoards(base && base.boards, local && local.boards, remote && remote.boards),
  });
  const idbGetSafe = (k) => idbGet(k).catch(() => null);

  const Boards = {
    get error() { return boardsError; },
    // This device's copy, merged with GitHub's when it's connected and
    // reachable. `dirty` means this device holds changes GitHub doesn't have
    // yet (a save made offline, or the merge just now), for the caller to
    // save.
    async load() {
      const local = await idbGetSafe(BOARDS_CACHE);
      if (!gh || !gh.token) return { doc: local || emptyBoards(), dirty: false };
      const base = await idbGetSafe(BOARDS_BASE);
      let remote;
      try { remote = await ghGetFile(null, boardsPath()); boardsError = null; }
      catch (e) { boardsError = e; return { doc: local || emptyBoards(), dirty: false }; }
      if (!remote) return { doc: local || emptyBoards(), dirty: !!(local && local.boards.length) };
      const doc = local ? mergeBoardDocs(base, local, remote.data) : { boards: remote.data.boards || [] };
      gh.boardsSha = remote.sha; saveGhCfg();
      await idbSet(BOARDS_BASE, remote.data).catch(() => {});
      await idbSet(BOARDS_CACHE, doc).catch(() => {});
      return { doc, dirty: JSON.stringify(doc.boards) !== JSON.stringify(remote.data.boards || []) };
    },
    // Resolves { doc, where, merged }: `doc` is what now stands — the caller's
    // own, or a merge with a save another device made first.
    async save(doc) {
      doc = { boards: doc.boards, exportedAt: new Date().toISOString() };
      await idbSet(BOARDS_CACHE, doc).catch(() => {});
      if (!gh || !gh.token) return { doc, where: "cache", merged: false };
      const path = boardsPath();
      let out = doc;
      for (let tries = 0; ; tries++) {
        try {
          gh.boardsSha = await ghPut(out, gh.boardsSha, path, false);
          saveGhCfg(); boardsError = null;
          await idbSet(BOARDS_BASE, out).catch(() => {});
          if (out !== doc) await idbSet(BOARDS_CACHE, out).catch(() => {});
          return { doc: out, where: "github", merged: out !== doc };
        } catch (e) {
          if ((e.status !== 409 && e.status !== 422) || tries >= 3) { boardsError = e; return { doc, where: "cache", merged: false }; }
          let cur;
          try { cur = await ghGetFile(null, path); } catch (e2) { boardsError = e2; return { doc, where: "cache", merged: false }; }
          out = cur ? { ...mergeBoardDocs(await idbGetSafe(BOARDS_BASE), doc, cur.data), exportedAt: doc.exportedAt } : doc;
          gh.boardsSha = cur ? cur.sha : null;
        }
      }
    },
    async forget() {
      await idbDel(BOARDS_CACHE).catch(() => {});
      await idbDel(BOARDS_BASE).catch(() => {});
    },
  };

  const Storage = {
    fsSupported,
    boards: Boards,
    get needsReconnect() { return needsReconnect; },
    get fileName() { return handle ? handle.name : null; },
    get fileConnected() { return !!(handle && !needsReconnect); },
    get githubConnected() { return !!(gh && gh.token); },
    get githubError() { return githubError; },
    get githubProblem() { return describeGhError(githubError); },
    get githubReadOk() { return githubReadOk; },
    // public github info without exposing the token
    get githubInfo() {
      return gh ? { owner: gh.owner, repo: gh.repo, path: gh.path, branch: gh.branch } : null;
    },

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
      try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
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
