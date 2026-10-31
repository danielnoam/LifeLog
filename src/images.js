// LifeLog — pictures in notes (0.297.0).
//
// A picture is never inside the data. A note's text points at it the
// Markdown way, ![alt](lifelog-img:<id>), and the file itself lives:
//   - on this device, in its own IndexedDB database (this file), shrunk to
//     at most MAX_EDGE px on its long side before it's kept;
//   - on GitHub, as images/<id> on the data repo's "lifelog-images" branch
//     (storage.js), uploaded before the lifelog.json that first points at
//     it, so another device never sees a note before its picture exists.
// lifelog.json stays small and every save stays cheap; see NOTES.md
// "Pictures in notes (0.297.0)" for why the branch is separate.
(function () {
  const DB_NAME = "lifelog-images";
  const STORE = "images";
  const SCHEME = "lifelog-img:";
  const MAX_EDGE = 1600;
  const QUALITY = 0.82;
  // Small enough already: kept as it came, so a screenshot isn't blurred by
  // a JPEG pass and a GIF keeps moving.
  const KEEP_AS_IS = 400 * 1024;
  const KEEP_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
  const ID = /^[a-z0-9]{8,40}\.(jpg|png|gif|webp)$/;
  // A picture added and then not kept (the sheet cancelled, an import's
  // note left out) is dropped from this device after a day.
  const STRAY_MS = 24 * 3600 * 1000;

  const idOf = (src) => {
    const s = String(src || "");
    if (!s.startsWith(SCHEME)) return null;
    const id = s.slice(SCHEME.length);
    return ID.test(id) ? id : null;
  };
  const ref = (id, alt) => "![" + String(alt || "").replace(/[\[\]\n]/g, " ").trim() + "](" + SCHEME + id + ")";
  const typeOf = (id) => ({ jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" })[String(id).split(".").pop()] || "image/jpeg";

  // Every picture the notes point at.
  function usedIds(notes) {
    const out = new Set();
    const re = /\]\(lifelog-img:([a-z0-9]{8,40}\.(?:jpg|png|gif|webp))\)/g;
    for (const n of notes || []) {
      for (const m of String((n && n.text) || "").matchAll(re)) out.add(m[1]);
    }
    return out;
  }

  // ---------- this device's copy ----------
  let dbOpen = null;
  function db() {
    if (dbOpen) return dbOpen;
    return (dbOpen = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      // "pending" is only on a picture not uploaded yet, so a save reads
      // those and not every picture this device holds.
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("pending", "pending"); };
      req.onsuccess = () => {
        const d = req.result;
        d.onversionchange = () => { d.close(); dbOpen = null; };
        d.onclose = () => { dbOpen = null; };
        resolve(d);
      };
      req.onerror = () => { dbOpen = null; reject(req.error); };
    }));
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      let out;
      const r = fn(t.objectStore(STORE));
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const getRec = (id) => tx("readonly", (s) => s.get(id));
  const putRec = (rec) => tx("readwrite", (s) => { s.put(rec); });
  const delRec = (id) => tx("readwrite", (s) => { s.delete(id); });
  const allRecs = () => tx("readonly", (s) => s.getAll());
  const pendingRecs = () => tx("readonly", (s) => s.index("pending").getAll());
  // Stored with `pending` only while it waits to be uploaded.
  const keep = (rec) => {
    const out = { ...rec };
    if (out.uploaded) delete out.pending; else out.pending = 1;
    return putRec(out);
  };

  // ---------- making one ----------
  function newId(ext) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    return Array.from(bytes, (b) => (b % 36).toString(36)).join("") + Date.now().toString(36) + "." + ext;
  }

  // Blob in, { blob, ext, w, h } out: as it came when it's small and a kind
  // every WebView draws, else redrawn as a JPEG no longer than MAX_EDGE.
  async function shrink(blob) {
    let bmp;
    try { bmp = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
    catch (e) {
      throw new Error(/heic|heif/i.test(blob.type || "") ? "That's an iPhone HEIC photo, which this app can't open — export it as JPEG first" : "That file isn't a picture this app can open");
    }
    const w0 = bmp.width, h0 = bmp.height;
    const keepExt = KEEP_TYPES[blob.type];
    if (keepExt && blob.size <= KEEP_AS_IS && Math.max(w0, h0) <= MAX_EDGE) {
      bmp.close && bmp.close();
      return { blob, ext: keepExt, w: w0, h: h0 };
    }
    const k = Math.min(1, MAX_EDGE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext("2d");
    // A transparent PNG would turn black as a JPEG; paper-white behind it.
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    const out = await new Promise((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
    if (!out) throw new Error("Couldn't shrink that picture");
    return { blob: out, ext: "jpg", w, h };
  }

  // Keeps a picture on this device, waiting to be uploaded. Returns its id.
  async function add(blob) {
    const s = await shrink(blob);
    const id = newId(s.ext);
    await keep({ id, blob: s.blob, w: s.w, h: s.h, size: s.blob.size, uploaded: false, addedAt: Date.now() });
    return id;
  }

  // ---------- showing one ----------
  const urls = new Map();
  const fetching = new Map();
  // An object URL for the picture, from this device or else GitHub (kept
  // here once fetched, so it shows offline from then on). null when it's
  // in neither place: not uploaded yet by the device that added it.
  async function url(id) {
    if (urls.has(id)) return urls.get(id);
    if (fetching.has(id)) return fetching.get(id);
    const p = (async () => {
      let rec = null;
      try { rec = await getRec(id); } catch (e) { /* no IndexedDB: fetch it */ }
      let blob = rec && rec.blob;
      if (!blob) {
        const S = window.LifeLogStorage;
        blob = S && S.images ? await S.images.get(id).catch(() => null) : null;
        if (!blob) return null;
        if (blob.type !== typeOf(id)) blob = new Blob([blob], { type: typeOf(id) });
        keep({ id, blob, size: blob.size, uploaded: true, addedAt: Date.now() }).catch(() => {});
      }
      const u = URL.createObjectURL(blob);
      urls.set(id, u);
      return u;
    })();
    fetching.set(id, p);
    try { return await p; } finally { fetching.delete(id); }
  }

  // ---------- GitHub ----------
  // Before each save of lifelog.json (storage.js): every picture a note
  // points at that GitHub doesn't have yet, in one commit. A failure is
  // thrown to the caller, which saves the notes anyway and tries again on
  // the next save.
  //
  // A clean-up on another device (settings.imagesCleanedAt moved) may have
  // dropped a picture this device uploaded for a note it hadn't seen yet.
  // So once per clean-up, the pictures marked uploaded here are checked
  // against what the branch holds, and any missing go up again.
  const CHECKED_KEY = "lifelog-images-checked";
  let uploading = null;
  async function uploadPending(data) {
    if (uploading) await uploading.catch(() => {});
    const S = window.LifeLogStorage;
    if (!S || !S.images || !S.images.connected()) return 0;
    const notes = (data && data.notes) || [];
    const cleaned = (data && data.settings && data.settings.imagesCleanedAt) || "";
    uploading = (async () => {
      const used = usedIds(notes);
      let checked = "";
      try { checked = localStorage.getItem(CHECKED_KEY) || ""; } catch (e) {}
      if (cleaned && cleaned !== checked) {
        const there = await S.images.list();
        for (const r of await allRecs()) {
          if (r.uploaded && used.has(r.id) && !there.has(r.id)) await keep({ ...r, uploaded: false });
        }
        try { localStorage.setItem(CHECKED_KEY, cleaned); } catch (e) {}
      }
      const recs = await pendingRecs();
      const now = Date.now();
      const todo = [];
      for (const r of recs) {
        if (r.uploaded) continue;
        if (used.has(r.id)) todo.push(r);
        else if (now - (r.addedAt || 0) > STRAY_MS) await delRec(r.id).catch(() => {});
      }
      if (!todo.length) return 0;
      await S.images.put(todo.map((r) => ({ id: r.id, blob: r.blob })));
      for (const r of todo) await keep({ ...r, uploaded: true });
      return todo.length;
    })();
    try { return await uploading; } finally { uploading = null; }
  }

  // Settings → Notes → Clean up pictures: GitHub keeps only what the notes
  // point at (storage.js starts the branch over), and this device drops its
  // copies of the rest. The caller stamps settings.imagesCleanedAt.
  async function cleanUp(data) {
    const S = window.LifeLogStorage;
    const used = usedIds(data.notes);
    await uploadPending(data);
    let local = 0;
    for (const r of await allRecs()) {
      if (used.has(r.id) || (!r.uploaded && Date.now() - (r.addedAt || 0) < STRAY_MS)) continue;
      await delRec(r.id);
      const u = urls.get(r.id);
      if (u) { URL.revokeObjectURL(u); urls.delete(r.id); }
      local++;
    }
    const remote = S && S.images && S.images.connected() ? await S.images.cleanUp(used) : null;
    return { local, remote };
  }

  // The app-lock reset forgets this device's copy (Storage.forgetDevice).
  function forget() {
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
    const close = dbOpen ? dbOpen.then((d) => d.close()).catch(() => {}) : Promise.resolve();
    dbOpen = null;
    try { localStorage.removeItem(CHECKED_KEY); } catch (e) {}
    return close.then(() => new Promise((resolve) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    }));
  }

  async function stats(notes) {
    const used = usedIds(notes);
    let count = 0, bytes = 0, waiting = 0;
    for (const r of await allRecs().catch(() => [])) {
      count++; bytes += r.size || 0;
      if (!r.uploaded && used.has(r.id)) waiting++;
    }
    return { used: used.size, count, bytes, waiting };
  }

  window.LifeLogImages = { SCHEME, idOf, ref, usedIds, add, shrink, url, uploadPending, cleanUp, stats, forget };
})();
