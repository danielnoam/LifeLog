// Stremio, read only. Stremio has no public API; this uses the one its own
// apps use (api.strem.io), which can change without notice. Signing in
// trades your email and password for an auth key once; only the key is
// kept (synced like the AniList token, blanked in exports), and Sign out
// asks Stremio to end that session. Nothing is ever written to Stremio.
//
// What Stremio keeps per title is one library item: its IMDb id, name,
// poster and a small state (when it was last played, the episode last
// played, how far in, whether a movie was watched). There is no history:
// a movie watched twice has one date, the last one. So:
//
//   in your library, never played      → a Backlog item
//   a movie part-way, a show played    → In progress, started the day it
//                                         was last played, with the episode
//                                         count when it can be worked out
//   a movie watched                     → a Timeline entry on the day it was
//                                         last played (finishing the Backlog
//                                         item when you have one)
//
// Everything goes through the import review. Titles are matched to TMDB by
// IMDb id with your TMDB key, so covers, genres and airing work as for any
// TMDB title; without a key they come in by name with Stremio's poster.
// Anime under a Kitsu id (from an anime addon) is left to AniList.
//
// The reading and planning are pure (test/stremio.test.js); `start` wires
// the Settings rows and the flows need a whole app.
(() => {
  const API = "https://api.strem.io/api/";
  const SYNC_KEY = "lifelog-stremio-autosync-v1";
  const TMDB_CACHE_KEY = "lifelog-stremio-tmdb-v1";
  const OPEN_GAP = 10 * 60 * 1000;
  const MISS_RETRY = 30 * 24 * 60 * 60 * 1000;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const pad2 = (n) => String(n).padStart(2, "0");
  const localDay = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  const lower = (s) => String(s || "").trim().toLowerCase();
  let ctx = null;

  // Stremio writes 1970 or nothing for "never played".
  function dayOf(iso) {
    const t = Date.parse(iso || "");
    if (!t || new Date(t).getFullYear() < 2000) return "";
    return localDay(new Date(t));
  }

  // Stremio's library items to the records the rest of this file reads.
  function readLibrary(items) {
    const out = [];
    for (const it of items || []) {
      if (!it || (it.type !== "movie" && it.type !== "series")) continue;
      const id = String(it._id || "");
      if (!/^tt\d+$/.test(id)) continue;
      const st = it.state || {};
      const last = dayOf(st.lastWatched);
      const inLibrary = !it.removed && !it.temp;
      const ep = /^tt\d+:(\d+):(\d+)$/.exec(st.video_id || st.videoId || "");
      const played = !!last && ((+st.timeWatched || 0) > 0 || (+st.overallTimeWatched || 0) > 0 || (+st.timeOffset || 0) > 0 || !!ep);
      let status;
      if (it.type === "movie" && ((+st.flaggedWatched || 0) > 0 || (+st.timesWatched || 0) > 0)) status = "watched";
      else if (played && (it.type === "series" || (+st.timeOffset || 0) > 0)) status = "watching";
      else if (inLibrary) status = "planning";
      else continue;
      const rec = { id, type: it.type, name: String(it.name || "").trim(), poster: /^https:\/\//.test(it.poster || "") ? it.poster : "", status, last };
      if (ep && +ep[1] > 0) { rec.season = +ep[1]; rec.episode = +ep[2]; }
      out.push(rec);
    }
    return out;
  }

  // Episodes watched for a show last played at S<season>E<episode>, in the
  // count the app shows: the whole run for a show that has ended, the
  // season's for one still going (its "5/6/12" is that season's). 0 when it
  // can't be told.
  function episodesWatched(season, episode, info) {
    if (!season || !episode) return 0;
    if (info && (info.airing === "finished" || info.airing === "cancelled") && info.seasons && info.seasons.length) {
      const before = info.seasons.filter((s) => s.season < season).reduce((n, s) => n + (s.episodes || 0), 0);
      return before + episode;
    }
    if (info && info.airingSeason) return info.airingSeason === season ? episode : 0;
    return season === 1 ? episode : 0;
  }

  // Records to review rows. `opts`: categories { movie, series } (empty is
  // "don't import"), data (backlog and entries), matches (IMDb id → TMDB
  // result, null or absent), seasons (IMDb id → fetchTmdbSeasons' answer)
  // and today. Titles you already have are matched on their media id, else
  // on title and category; what they already say is left alone, apart from
  // a start or a higher episode count for one Stremio has you watching.
  function planStremio(records, opts) {
    const { categories, data, matches, seasons } = opts;
    const nameKey = (t, c) => lower(t) + "\u0000" + c;
    const index = (list) => {
      const map = new Map();
      for (const x of list || []) {
        if (x.mediaSource && x.mediaId) map.set(x.mediaSource + ":" + x.mediaId, x);
        const n = nameKey(x.title, x.category);
        if (!map.has(n)) map.set(n, x);
      }
      return map;
    };
    const inBacklog = index(data.backlog), onTimeline = index(data.entries);
    const backlog = [], entries = [], updates = [];
    for (const r of records) {
      const category = r.type === "movie" ? categories.movie : categories.series;
      if (!category) continue;
      const m = (matches && matches.get(r.id)) || null;
      const title = (m && m.title) || r.name;
      if (!title) continue;
      const find = (map) => (m && map.get(m.source + ":" + m.id)) || map.get(nameKey(title, category)) || (r.name && map.get(nameKey(r.name, category))) || null;
      const b = find(inBacklog), e = find(onTimeline);
      const media = m ? { mediaSource: m.source, mediaId: m.id } : {};
      const look = {};
      const cover = (m && m.coverUrl) || r.poster;
      if (cover) look.coverUrl = cover;
      if (m && m.genres && m.genres.length) look.genres = m.genres;
      if (m && m.externalRating) look.externalRating = m.externalRating;
      if (r.status === "watched") {
        if (e) continue;
        const when = DAY.test(r.last) ? r.last : opts.today;
        const year = +when.slice(0, 4), month = +when.slice(5, 7);
        const entry = { title, category, year, month, date: year + "-" + pad2(month), ...media, ...look };
        if (DAY.test(r.last)) entry.day = +when.slice(8, 10);
        else entry.notes = "Watched: Stremio didn't say when";
        if (b) {
          entry.title = b.title;
          for (const k of ["coverUrl", "mediaId", "mediaSource", "length", "genres", "author", "notes", "externalRating"]) if (b[k]) entry[k] = b[k];
          entry.backlogAddedAt = b.createdAt || null;
          if (DAY.test(b.startedAt || "") && b.startedAt <= when) entry.startedAt = b.startedAt;
        }
        entries.push({ entry, id: r.id, finishes: b ? b.id : null, dated: DAY.test(r.last) });
      } else if (r.status === "watching") {
        const count = r.type === "series" ? episodesWatched(r.season, r.episode, seasons && seasons.get(r.id)) : 0;
        const started = DAY.test(r.last) ? r.last : opts.today;
        if (b) {
          if (b.dropped) continue;
          const fills = [];
          const patch = {};
          if (!DAY.test(b.startedAt || "")) { patch.startedAt = started; fills.push({ key: "startedAt", label: "started" }); }
          if (count > (+b.progress || 0)) {
            patch.progress = count;
            patch.progressAt = new Date().toISOString();
            fills.push({ key: "progress", label: "episode " + count }, { key: "progressAt", label: "count time" });
          }
          if (fills.length) updates.push({ target: b, patch, fills, id: r.id });
          continue;
        }
        if (e) continue;
        const item = { title, category, ...media, ...look, startedAt: started };
        if (m && m.year) item.releaseYear = m.year;
        if (count) { item.progress = count; item.progressAt = new Date().toISOString(); }
        backlog.push({ item, id: r.id });
      } else {
        if (b || e) continue;
        const item = { title, category, ...media, ...look };
        if (m && m.year) item.releaseYear = m.year;
        backlog.push({ item, id: r.id });
      }
    }
    return { backlog, entries, updates };
  }

  // The plan as the import review's rows. buildImportItems lists entries
  // first, then backlog items, each in the order given, which is how a row
  // finds the record it came from.
  function buildRows(plan, buildImportItems, skips) {
    const built = buildImportItems({ entries: plan.entries.map((x) => x.entry), backlog: plan.backlog.map((x) => x.item), categories: [] });
    const entryRows = built.items.filter((it) => it.kind === "entry");
    const backlogRows = built.items.filter((it) => it.kind === "backlog");
    entryRows.forEach((it, i) => {
      const p = plan.entries[i];
      if (!p) return;
      it.stremioId = p.id;
      if (!it.dup && p.finishes) it.finishes = p.finishes;
      if (!it.dup && !p.dated) it.checked = false;
    });
    backlogRows.forEach((it, i) => { if (plan.backlog[i]) it.stremioId = plan.backlog[i].id; });
    for (const u of plan.updates) {
      built.items.push({ kind: "backlog", entry: { ...u.target, ...u.patch }, dup: true, update: true, targetId: u.target.id, targetKind: "backlog", fills: u.fills, checked: true, stremioId: u.id });
    }
    for (const it of built.items) {
      if (!it.dup && !it.update && it.stremioId && skips.has("stremio:" + it.stremioId)) { it.skipped = true; it.checked = false; }
    }
    return built;
  }

  function due(setting, lastAt, now = Date.now()) {
    if (setting === "open") return now - lastAt >= OPEN_GAP;
    const days = parseInt(setting, 10) || 0;
    return days > 0 && now - lastAt >= days * 24 * 60 * 60 * 1000;
  }

  // ---------- talking to Stremio ----------
  // The phone and computer apps go through their own native HTTP (see
  // platform.js), so a browser's rules about other sites don't apply there.
  function endpoint(method) {
    const p = window.LifeLogPlatform;
    return p && p.steamDirect ? p.steamProxy("") + "/stremio/" + method : API + method;
  }
  async function call(method, body) {
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined;
    let res;
    try {
      res = await fetch(endpoint(method), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    } catch (e) { throw new Error("Stremio couldn't be reached"); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* said below */ }
    if (data && data.error) {
      const msg = String(data.error.message || data.error || "").slice(0, 160);
      const err = new Error(/session|auth/i.test(msg) ? "Stremio signed you out. Sign in again" : msg || "Stremio said no");
      err.signedOut = /session|auth/i.test(msg);
      throw err;
    }
    if (!res.ok || !data) throw new Error("Stremio answered " + res.status);
    return data.result;
  }
  async function signIn(email, password) {
    const r = await call("login", { type: "Login", email, password, facebook: false });
    if (!r || !r.authKey) throw new Error("Stremio didn't send a key back");
    return { authKey: String(r.authKey), email: (r.user && r.user.email) || email };
  }
  async function fetchLibrary(authKey) {
    const r = await call("datastoreGet", { authKey, collection: "libraryItem", ids: [], all: true });
    if (!Array.isArray(r)) throw new Error("Stremio sent something unexpected");
    return r;
  }

  // IMDb → TMDB answers kept on this device, so a sync after the first asks
  // TMDB only about what's new. A title TMDB doesn't have is asked again a
  // month later.
  function readCache() { try { return JSON.parse(localStorage.getItem(TMDB_CACHE_KEY)) || {}; } catch (e) { return {}; } }
  function writeCache(c) { try { localStorage.setItem(TMDB_CACHE_KEY, JSON.stringify(c)); } catch (e) { /* asked again next time */ } }
  async function matchAll(records, key, job) {
    const matches = new Map();
    if (!key || !window.LifeLogMedia) return matches;
    const cache = readCache();
    const now = Date.now();
    const ask = [];
    for (const r of records) {
      const c = cache[r.id];
      if (c && (c.m || now - c.at < MISS_RETRY)) { if (c.m) matches.set(r.id, c.m); }
      else ask.push(r);
    }
    let done = 0;
    const worker = async () => {
      while (ask.length && !job.stopping) {
        const r = ask.shift();
        const m = await window.LifeLogMedia.findTmdbByImdb(r.id, r.type === "movie" ? "movie" : "tv", key);
        if (m !== undefined) {
          const keep = m ? { source: m.source, id: m.id, title: m.title, coverUrl: m.coverUrl, year: m.year, genres: m.genres, externalRating: m.externalRating } : null;
          cache[r.id] = { m: keep, at: now };
          if (keep) matches.set(r.id, keep);
        }
        job.progress(++done, done + ask.length, "Matching titles on TMDB…");
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    writeCache(cache);
    return matches;
  }

  // ---------- the sync ----------
  const S = () => ctx.state.data.settings;
  const cfgOf = () => ({ ...ctx.DEFAULT_SETTINGS.stremio, ...(S().stremio || {}) });

  let running = null;
  function sync(opts = {}) {
    if (running) { if (opts.manual) ctx.toast("Stremio is already syncing"); return running; }
    running = runSync(opts).finally(() => { running = null; });
    return running;
  }
  async function runSync({ manual } = {}) {
    const cfg = cfgOf();
    const say = (msg) => { if (manual) ctx.toast(msg, true); };
    if (!cfg.authKey) return say("Sign in to Stremio first");
    if (!cfg.movieCategory && !cfg.showCategory) return say("Pick a category for movies and/or shows first");
    if (ctx.whenSynced) await ctx.whenSynced();
    const btn = manual ? document.getElementById("stremioSyncBtn") : null;
    const label = btn ? [...btn.childNodes].map((n) => n.cloneNode(true)) : null;
    if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
    try {
      await window.LifeLogJobs.run({ label: manual ? "Syncing Stremio" : "Checking Stremio", lane: "stremio", again: "stremioSyncBtn" }, async (job) => {
        job.progress(0, 0, "Reading your Stremio library…");
        let items;
        try { items = await fetchLibrary(cfg.authKey); }
        catch (e) {
          if (e.signedOut) { await setSetting("authKey", ""); renderSettings(); }
          say("Stremio sync failed — " + e.message);
          job.fail(e.message);
          return;
        }
        const categories = { movie: cfg.movieCategory, series: cfg.showCategory };
        const records = readLibrary(items).filter((r) => (r.type === "movie" ? categories.movie : categories.series));
        const key = (S().mediaKeys || {}).tmdb || "";
        const matches = await matchAll(records, key, job);
        const seasons = new Map();
        for (const r of records) {
          if (job.stopping) break;
          const m = matches.get(r.id);
          if (r.type !== "series" || r.status !== "watching" || !r.season || !m) continue;
          const info = await window.LifeLogMedia.fetchTmdbSeasons(m.id, key);
          if (info) seasons.set(r.id, info);
        }
        if (job.stopping) { job.finish("Stopped"); return; }
        const plan = planStremio(records, { categories, data: ctx.state.data, matches, seasons, today: localDay(new Date()) });
        const skips = new Set(((S().importSkips || {}).stremio) || []);
        const built = buildRows(plan, ctx.buildImportItems, skips);
        const fresh = built.items.filter((it) => (it.update || !it.dup) && !it.skipped);
        if (!fresh.length) {
          if (manual) ctx.toast("Nothing new from Stremio");
          job.finish("Nothing new");
          return;
        }
        const n = fresh.length;
        job.finish(n + " to review");
        const review = () => ctx.reviewAndImport("Stremio", HINT + (key ? "" : " Add a TMDB key in Media lookups to match titles and get covers, genres and airing."), built, (selected) => rememberSkips(built.items, selected));
        if (manual) review();
        else ctx.toast(`Stremio: ${n} to review`, false, { label: "Review", onClick: review });
      });
    } catch (e) {
      // Already said, and kept in Activity.
    } finally {
      if (btn) { btn.disabled = false; btn.replaceChildren(...label); }
    }
  }
  const HINT = "Your Stremio library, watching and watched. Stremio keeps only the last time you played something, so a watched movie is dated on its last play, and earlier watches aren't there. Movies with no date are unticked.";

  // What you leave unticked stays out of the way next time.
  async function rememberSkips(rows, selected) {
    const chosen = new Set(selected);
    const all = { ...(S().importSkips || {}) };
    const next = new Set(all.stremio || []);
    for (const it of rows) {
      if (it.dup || it.update || !it.stremioId) continue;
      const k = "stremio:" + it.stremioId;
      if (chosen.has(it)) next.delete(k); else next.add(k);
    }
    if (next.size) all.stremio = [...next]; else delete all.stremio;
    S().importSkips = all;
    await ctx.persist();
  }

  async function maybeAutoCheck() {
    if (!ctx) return;
    const cfg = cfgOf();
    if (!cfg.authKey || (!cfg.movieCategory && !cfg.showCategory)) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(SYNC_KEY)); } catch (e) { /* never checked */ }
    const lastAt = last && last.lastCheckedAt ? Date.parse(last.lastCheckedAt) || 0 : 0;
    if (!due(String(cfg.autoSyncDays || "0"), lastAt)) return;
    try { localStorage.setItem(SYNC_KEY, JSON.stringify({ lastCheckedAt: new Date().toISOString() })); } catch (e) { /* checks again next open */ }
    await sync();
  }

  // ---------- Settings → Imports → Stremio ----------
  const $ = (id) => document.getElementById(id);
  async function setSetting(field, value) {
    const st = S();
    st.stremio = { ...ctx.DEFAULT_SETTINGS.stremio, ...(st.stremio || {}), [field]: value };
    await ctx.persist();
  }
  function fillCategories(sel, current) {
    if (!sel) return;
    sel.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Don't import";
    sel.appendChild(none);
    for (const c of ctx.state.data.categories) {
      const o = document.createElement("option");
      o.value = c.name;
      o.textContent = c.name;
      sel.appendChild(o);
    }
    sel.value = current && ctx.state.data.categories.some((c) => c.name === current) ? current : "";
  }
  function renderSettings() {
    if (!ctx || !$("stremioSyncBtn")) return;
    const cfg = cfgOf();
    const signedIn = !!cfg.authKey;
    $("stremioState").textContent = signedIn ? "Signed in" + (cfg.email ? " as " + cfg.email : "") : "Not signed in";
    $("stremioEmailRow").hidden = signedIn;
    $("stremioPasswordRow").hidden = signedIn;
    $("stremioSignInBtn").hidden = signedIn;
    $("stremioSignOutBtn").hidden = !signedIn;
    if (!signedIn && cfg.email && !$("stremioEmail").value) $("stremioEmail").value = cfg.email;
    fillCategories($("stremioMovieCategory"), cfg.movieCategory);
    fillCategories($("stremioShowCategory"), cfg.showCategory);
    $("stremioAutoSyncDays").value = String(cfg.autoSyncDays || "0");
  }
  function wire() {
    if (!$("stremioSyncBtn")) return;
    $("stremioSignInBtn").onclick = async () => {
      const email = $("stremioEmail").value.trim(), password = $("stremioPassword").value;
      if (!email || !password) { ctx.toast("Enter your Stremio email and password", true); return; }
      const btn = $("stremioSignInBtn");
      btn.disabled = true;
      $("stremioState").textContent = "Signing in…";
      try {
        const r = await signIn(email, password);
        const st = S();
        st.stremio = { ...ctx.DEFAULT_SETTINGS.stremio, ...(st.stremio || {}), authKey: r.authKey, email: r.email, connectedAt: new Date().toISOString() };
        await ctx.persist();
        ctx.toast("Signed in to Stremio");
      } catch (e) {
        ctx.toast("Couldn't sign in to Stremio — " + e.message, true);
      } finally {
        $("stremioPassword").value = "";
        btn.disabled = false;
        renderSettings();
      }
    };
    $("stremioSignOutBtn").onclick = async () => {
      const key = cfgOf().authKey;
      if (key) call("logout", { authKey: key }).catch(() => { /* the key is forgotten here either way */ });
      await setSetting("authKey", "");
      await setSetting("connectedAt", "");
      renderSettings();
      ctx.toast("Signed out of Stremio");
    };
    $("stremioMovieCategory").onchange = () => setSetting("movieCategory", $("stremioMovieCategory").value);
    $("stremioShowCategory").onchange = () => setSetting("showCategory", $("stremioShowCategory").value);
    $("stremioAutoSyncDays").onchange = () => setSetting("autoSyncDays", $("stremioAutoSyncDays").value);
    $("stremioSyncBtn").onclick = () => sync({ manual: true });
    if (window.LifeLogJobs && window.LifeLogJobs.onAgain) window.LifeLogJobs.onAgain("stremioSyncBtn", () => sync({ manual: true }));
  }

  function start(c) { ctx = c; wire(); }

  const api = { readLibrary, episodesWatched, planStremio, buildRows, due, dayOf, start, sync, maybeAutoCheck, renderSettings };
  if (typeof window !== "undefined") window.LifeLogStremio = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
