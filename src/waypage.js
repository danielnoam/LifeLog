// LifeLog — the reading log from Waypage (0.313.0).
//
// Waypage (github.com/danielnoam/waypage), with Settings › GitHub sync ›
// Other apps › Share reading activity on, writes activity/reading.json to the
// person's own waypage-data repo (its docs/reading-activity.md is the format:
// fields are only ever added). LifeLog reads that one file with a read-only
// token for that one repo, and never Waypage's library.json.
//
// What it does with it:
// - A book (or audiobook, comic, serial; articles are off unless picked) you
//   have in the Backlog is matched by title (and author, when both have one)
//   and started there; its % read shows on it, and finishing it in Waypage
//   moves it to the Timeline. Your title, cover, notes, rating and category
//   stay yours.
// - One you have nowhere comes in as in progress, or straight onto the
//   Timeline when it's already finished.
// - One that's already on the Timeline (a re-read), or matches a title with a
//   different author, waits in a review list: Same one, Add, or Never.
// - Minutes a day (reading and listening) fill the minutes habit you pick.
//   What Waypage put into a day is remembered, so minutes you add by hand
//   for a paper book stay on top of it.
//
// Every link is the item's own `waypageId`, so it rides sync with the item.
// The rest (repo, token, kinds, habit, review list, what was seen) is
// settings.waypage, merged field by field like the other settings. Items it
// makes have ids made from Waypage's id, so two devices reading the same file
// make one item, not two. Something removed here isn't brought back: its id
// is in `seen`.
(function () {
  let state, $, el, toast, persist, afterDataChange, render, whenSynced;

  function init(ctx) {
    ({ state, $, el, toast, persist, afterDataChange, render, whenSynced } = ctx);
  }

  const KINDS = ["book", "audiobook", "comic", "serial", "article"];
  const KIND_NAMES = { book: "Books", audiobook: "Audiobooks", comic: "Comics", serial: "Serials", article: "Articles" };
  // paused: off on every device. every: "5m", "open", "day" or "manual".
  // newMode: "add" (as before), "ask" (new books wait in the review list) or
  // "none". startFinish / showProgress: what it does to books you have.
  const DEFAULTS = { repo: "", token: "", connectedAt: "", kinds: {}, habit: "", minutes: {}, seen: {}, never: {}, review: {}, paused: false, every: "5m", newMode: "add", startFinish: true, showProgress: true };
  const EVERY_MS = { "5m": 5 * 60 * 1000, open: 10 * 60 * 1000, day: 24 * 60 * 60 * 1000 };
  const FILE = "activity/reading.json";
  const CACHE_KEY = "lifelog-waypage-v1"; // { etag, text, checkedAt } on this device only
  const EVERY = 5 * 60 * 1000;

  const pad2 = (n) => String(n).padStart(2, "0");
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const text = (v) => String(v == null ? "" : v).trim();
  const plainObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const localDay = (d = new Date()) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());

  // The same key media.js's titleKey makes ("Dune: Part 2" and "Dune Part 2"
  // meet); the bridge doesn't load media.js, so this is the fallback there.
  function titleKey(title) {
    if (typeof window !== "undefined" && window.LifeLogMedia && window.LifeLogMedia.titleKey) return window.LifeLogMedia.titleKey(title);
    let t = text(title).replace(/(\d+)(?:st|nd|rd|th)\s+(season|part)\s*$/i, "$2 $1");
    const m = t.match(/[-–—:\s]+(?:season|s|book|b|part|p|vol|volume)\s*\.?\s*(\d+)\s*$/i);
    const part = m ? parseInt(m[1], 10) : 1;
    if (m) t = t.slice(0, m.index);
    const base = t.replace(/[™®©℗℠]/g, " ").normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
    return base ? base + "|" + part : "";
  }
  const authorKey = (a) => text(a).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  // Both named and different. One side blank isn't a clash: most of your
  // backlog has no author typed in.
  const authorsClash = (a, b) => !!authorKey(a) && !!authorKey(b) && authorKey(a) !== authorKey(b);

  // ---------- pure: the settings, the file ----------
  function cleanConfig(c) {
    c = plainObj(c);
    const out = { ...DEFAULTS, ...c };
    out.repo = text(c.repo).replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
    out.token = text(c.token);
    out.connectedAt = text(c.connectedAt);
    out.habit = text(c.habit);
    out.kinds = {};
    for (const k of Object.keys(plainObj(c.kinds))) if (typeof c.kinds[k] === "string") out.kinds[k] = c.kinds[k];
    out.minutes = {};
    for (const [d, n] of Object.entries(plainObj(c.minutes))) if (isDay(d) && +n > 0) out.minutes[d] = Math.round(+n);
    out.seen = {};
    for (const [id, v] of Object.entries(plainObj(c.seen))) if (v) out.seen[id] = true;
    // A title kept with each so the Kept out list can name it.
    out.never = {};
    for (const [id, v] of Object.entries(plainObj(c.never))) if (v) out.never[id] = typeof v === "string" ? v.slice(0, 300) : true;
    out.paused = c.paused === true;
    out.every = ["5m", "open", "day", "manual"].includes(c.every) ? c.every : "5m";
    out.newMode = ["add", "ask", "none"].includes(c.newMode) ? c.newMode : "add";
    out.startFinish = c.startFinish !== false;
    out.showProgress = c.showProgress !== false;
    out.review = {};
    for (const [id, r] of Object.entries(plainObj(c.review))) if (r && typeof r === "object" && r.title) out.review[id] = r;
    return out;
  }

  // reading.json as LifeLog uses it, or null when it isn't one. Unknown
  // kinds and fields are left out (the format only ever adds).
  function parseActivity(json) {
    let doc = json;
    if (typeof json === "string") { try { doc = JSON.parse(json); } catch (e) { return null; } }
    if (!doc || typeof doc !== "object" || doc.app !== "waypage" || !(+doc.schema >= 1) || !Array.isArray(doc.items)) return null;
    const items = [];
    for (const it of doc.items) {
      if (!it || typeof it !== "object" || !text(it.id) || !text(it.title) || !KINDS.includes(it.kind)) continue;
      const p = Number(it.progress);
      const ch = it.chapters && typeof it.chapters === "object" && +it.chapters.read >= 0 ? { read: Math.round(+it.chapters.read), ...(+it.chapters.total > 0 ? { total: Math.round(+it.chapters.total) } : {}) } : null;
      items.push({
        id: text(it.id), kind: it.kind, title: text(it.title).slice(0, 300), author: text(it.author).slice(0, 200),
        progress: isFinite(p) ? Math.max(0, Math.min(1, p)) : 0, chapters: ch,
        startedAt: isDay(it.startedAt) ? it.startedAt : null, finishedAt: isDay(it.finishedAt) ? it.finishedAt : null,
        minutes: Math.max(0, Math.round(+it.minutes || 0)),
      });
    }
    const days = {};
    for (const [d, v] of Object.entries(plainObj(doc.days))) {
      if (!isDay(d) || !v) continue;
      const n = Math.max(0, Math.round(+v.read || 0)) + Math.max(0, Math.round(+v.listened || 0));
      if (n) days[d] = n;
    }
    return { updatedAt: text(doc.updatedAt), items, days };
  }

  // "6h 40m", how the Timeline writes a length.
  function minutesText(n) {
    const h = Math.floor(n / 60), m = n % 60;
    return h ? h + "h" + (m ? " " + m + "m" : "") : m + "m";
  }
  const safeId = (s) => String(s).replace(/[^a-z0-9-]+/gi, "-");

  function backlogFrom(it, category, today, now) {
    const b = { id: "wp-" + safeId(it.id), title: it.title, category, createdAt: now, startedAt: it.startedAt || today, waypageId: it.id, waypageProgress: it.progress };
    if (it.author) b.author = it.author;
    if (it.chapters) b.waypageChapters = it.chapters;
    return b;
  }

  // The Timeline entry a finished read becomes: the backlog item's own
  // fields when there is one, filed on the day Waypage has it finished, and
  // spanning back to the month it was started.
  function entryFrom(b, it, category, now) {
    const done = it.finishedAt;
    const year = +done.slice(0, 4), month = +done.slice(5, 7);
    const e = { id: "wp-" + safeId(it.id) + "-" + done, title: b ? b.title : it.title, category: b ? b.category : category, year, month, day: +done.slice(8, 10), date: year + "-" + pad2(month), createdAt: now, waypageId: it.id };
    if (b) {
      for (const k of ["coverUrl", "mediaId", "mediaSource", "length", "genres", "author", "notes", "externalRating", "overrides"]) if (b[k]) e[k] = b[k];
      if (b.createdAt) e.backlogAddedAt = b.createdAt;
    }
    if (!e.author && it.author) e.author = it.author;
    if (!e.length && it.minutes) e.length = minutesText(it.minutes);
    const started = (b && isDay(b.startedAt) ? b.startedAt : "") || it.startedAt || "";
    if (started && started <= done) {
      e.startedAt = started;
      const sy = +started.slice(0, 4), sm = +started.slice(5, 7);
      if (sy * 12 + sm < year * 12 + month) { e.startYear = sy; e.startMonth = sm; }
    }
    return e;
  }

  // ---------- pure: one read of the file applied to the data ----------
  // Changes `data` and `cfg` (settings.waypage, cleaned) in place and says
  // what changed. `today` is the local day; `now` an ISO time for createdAt.
  function apply(data, cfg, act, today, now) {
    const counts = { started: 0, finished: 0, added: 0, progress: 0, linked: 0, minutes: 0, review: 0 };
    data.backlog = data.backlog || [];
    data.entries = data.entries || [];
    const cats = new Set(KINDS.map((k) => cfg.kinds[k]).filter(Boolean));
    const known = new Set((data.categories || []).map((c) => c.name));
    const linkedB = new Map(), linkedE = new Map(), byKeyB = new Map(), byKeyE = new Map();
    for (const b of data.backlog) {
      if (b.waypageId) linkedB.set(b.waypageId, b);
      else if (cats.has(b.category)) { const k = titleKey(b.title); if (k && !byKeyB.has(k)) byKeyB.set(k, b); }
    }
    for (const e of data.entries) {
      if (e.waypageId) { if (!linkedE.has(e.waypageId)) linkedE.set(e.waypageId, e); }
      else if (cats.has(e.category)) { const k = titleKey(e.title); const y = byKeyE.get(k); if (k && (!y || (e.date || "") > (y.date || ""))) byKeyE.set(k, e); }
    }
    const review = {};
    const removed = new Set();
    for (const it of act.items) {
      const category = cfg.kinds[it.kind];
      if (!category || !known.has(category) || cfg.never[it.id]) continue;
      let b = linkedB.get(it.id) || null;
      if (!b && linkedE.has(it.id)) continue; // finished and logged
      if (!b) {
        if (cfg.seen[it.id]) continue; // made or matched before, then removed here
        const k = titleKey(it.title);
        const m = byKeyB.get(k);
        if (m && authorsClash(m.author, it.author)) { review[it.id] = { ...snapshot(it), reason: "author", match: "backlog:" + m.id }; continue; }
        if (m) {
          b = m;
          byKeyB.delete(k);
          b.waypageId = it.id;
          counts.linked++;
        } else {
          const e = byKeyE.get(k);
          if (e) {
            // The same read logged by hand: finished in the month you logged it.
            if (it.finishedAt && e.year === +it.finishedAt.slice(0, 4) && e.month === +it.finishedAt.slice(5, 7) && !authorsClash(e.author, it.author)) {
              e.waypageId = it.id; cfg.seen[it.id] = true; byKeyE.delete(k); counts.linked++;
            } else review[it.id] = { ...snapshot(it), reason: "logged", match: "entries:" + e.id };
            continue;
          }
          if (cfg.newMode === "none") continue; // not seen: it can still come later
          if (cfg.newMode === "ask") { review[it.id] = { ...snapshot(it), reason: "new", match: "" }; continue; }
          cfg.seen[it.id] = true;
          if (it.finishedAt) {
            const entry = entryFrom(null, it, category, now);
            if (!data.entries.some((x) => x.id === entry.id)) { data.entries.push(entry); counts.finished++; }
          } else {
            const nb = backlogFrom(it, category, today, now);
            if (!data.backlog.some((x) => x.id === nb.id)) { data.backlog.push(nb); counts.added++; }
          }
          continue;
        }
        cfg.seen[it.id] = true;
      }
      if (b.dropped) continue;
      if (!cfg.showProgress && (b.waypageProgress != null || b.waypageChapters)) { delete b.waypageProgress; delete b.waypageChapters; counts.progress++; }
      if (!cfg.startFinish) {
        if (cfg.showProgress && isDay(b.startedAt)) setProgress(b, it, counts);
        continue;
      }
      if (it.finishedAt) {
        const entry = entryFrom(b, it, category, now);
        if (!data.entries.some((x) => x.id === entry.id)) data.entries.push(entry);
        removed.add(b.id);
        counts.finished++;
        continue;
      }
      if (!isDay(b.startedAt)) { b.startedAt = it.startedAt || today; counts.started++; }
      if (cfg.showProgress) setProgress(b, it, counts);
    }
    if (removed.size) data.backlog = data.backlog.filter((x) => !removed.has(x.id));
    // The review list is what this read found; anything you've answered is
    // gone from it because it's linked, seen or never now.
    const reviewBefore = JSON.stringify(cfg.review);
    cfg.review = review;
    counts.review = Object.keys(review).length;
    const reviewChanged = reviewBefore !== JSON.stringify(review);
    counts.minutes = fillHabit(data, cfg, act.days);
    const changed = counts.started + counts.finished + counts.added + counts.progress + counts.linked + counts.minutes > 0 || reviewChanged;
    return { changed, counts };
  }

  function setProgress(b, it, counts) {
    if (b.waypageProgress !== it.progress) { b.waypageProgress = it.progress; counts.progress++; }
    const ch = it.chapters ? JSON.stringify(it.chapters) : "";
    if ((b.waypageChapters ? JSON.stringify(b.waypageChapters) : "") !== ch) {
      if (it.chapters) b.waypageChapters = it.chapters; else delete b.waypageChapters;
      counts.progress++;
    }
  }

  // Unlink: the item stays and Waypage stops changing it; its id goes on
  // the Kept out list, named, so Allow again can bring it back.
  function unlink(data, cfg, list, itemId) {
    const x = (data[list] || []).find((y) => y.id === itemId);
    if (!x || !x.waypageId) return false;
    cfg.never[x.waypageId] = x.title || true;
    delete x.waypageId;
    delete x.waypageProgress;
    delete x.waypageChapters;
    return true;
  }
  // Allow again: forgotten as never and as seen, so the next read matches
  // it by title again or brings it in as new.
  function allowAgain(cfg, id) {
    if (!cfg.never[id]) return false;
    delete cfg.never[id];
    delete cfg.seen[id];
    return true;
  }

  const snapshot = (it) => ({ title: it.title, author: it.author, kind: it.kind, progress: it.progress, chapters: it.chapters, startedAt: it.startedAt, finishedAt: it.finishedAt, minutes: it.minutes });

  // A day's mark is what you added by hand plus what Waypage counted; only
  // Waypage's part is replaced when its count changes.
  function fillHabit(data, cfg, days) {
    const h = (data.habits || []).find((x) => x.id === cfg.habit);
    if (!h || h.unit !== "min") return 0;
    h.marks = h.marks || {};
    let n = 0;
    const first = Object.keys(days).sort()[0] || "";
    for (const day of new Set([...Object.keys(days), ...Object.keys(cfg.minutes)])) {
      const was = cfg.minutes[day] || 0;
      const now = days[day] || 0;
      if (now === was || (!now && day < first)) continue; // older than the file goes back: kept
      const v = Math.max(0, (+h.marks[day] || 0) - was + now);
      if (v) h.marks[day] = v; else delete h.marks[day];
      if (now) cfg.minutes[day] = now; else delete cfg.minutes[day];
      n++;
    }
    return n;
  }

  // Picking another habit takes Waypage's minutes out of the old one first.
  function moveHabit(data, cfg, habitId) {
    const old = (data.habits || []).find((x) => x.id === cfg.habit);
    if (old && old.marks) for (const [day, n] of Object.entries(cfg.minutes)) {
      const v = Math.max(0, (+old.marks[day] || 0) - n);
      if (v) old.marks[day] = v; else delete old.marks[day];
    }
    cfg.minutes = {};
    cfg.habit = habitId || "";
  }

  // One row of the review list answered: "same" links it to what it
  // matched, "add" makes it new, "never" keeps it out for good.
  function resolve(data, cfg, id, action, today, now) {
    const r = cfg.review[id];
    if (!r) return false;
    const it = { id, ...r };
    if (action === "never") cfg.never[id] = r.title || true;
    else if (action === "same") {
      const [list, mid] = String(r.match || "").split(":");
      const x = (data[list] || []).find((y) => y.id === mid);
      if (x) x.waypageId = id;
      cfg.seen[id] = true;
    } else if (action === "add") {
      const category = cfg.kinds[r.kind];
      if (!category) return false;
      if (r.finishedAt) data.entries.push(entryFrom(null, it, category, now));
      else data.backlog.push(backlogFrom(it, category, today, now));
      cfg.seen[id] = true;
    } else return false;
    delete cfg.review[id];
    return true;
  }

  // Books for books, comics and serials; audiobooks to Audiobooks when there
  // is one; articles off. Only categories you have.
  function defaultKinds(categories) {
    const names = (categories || []).map((c) => c.name);
    const find = (re) => names.find((n) => re.test(n)) || "";
    const books = find(/^books?$/i) || find(/book|read/i);
    return { book: books, audiobook: find(/audio/i) || books, comic: find(/comic|manga/i) || books, serial: find(/serial/i) || books, article: "" };
  }

  // "62% in Waypage", or "ch 31/40 in Waypage" for a serial.
  function progressLabel(b) {
    if (!b || b.waypageProgress == null) return "";
    const c = b.waypageChapters;
    if (c && c.total) return "ch " + c.read + "/" + c.total;
    return Math.round(b.waypageProgress * 100) + "%";
  }

  // ---------- the app side ----------
  const cfgNow = () => cleanConfig(state.data.settings.waypage);
  const connected = (c) => /^[\w.-]+\/[\w.-]+$/.test(c.repo) && !!c.token;
  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; } }
  function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {} }
  let lastStatus = "";

  // The file, or { none } for a 404 (sharing off, or no sync yet), or
  // { same } when it hasn't changed since the last read (ETag).
  async function fetchFile(c, fresh) {
    const cache = readCache();
    const headers = { Authorization: "Bearer " + c.token, Accept: "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28" };
    if (!fresh && cache.etag && cache.repo === c.repo) headers["If-None-Match"] = cache.etag;
    const res = await fetch("https://api.github.com/repos/" + c.repo + "/contents/" + FILE, { headers, cache: "no-store" });
    if (res.status === 304) return { same: true, text: cache.text };
    if (res.status === 404) { writeCache({ repo: c.repo, checkedAt: Date.now() }); return { none: true }; }
    if (res.status === 401 || res.status === 403) throw new Error("GitHub refused the token. It needs Contents: Read-only on " + c.repo + ".");
    if (!res.ok) throw new Error("GitHub said " + res.status + ".");
    const body = await res.text();
    writeCache({ repo: c.repo, etag: res.headers.get("ETag") || "", text: body, checkedAt: Date.now() });
    return { text: body };
  }

  let running = null;
  // One check. `manual` is the Check now button: it says what happened.
  // Otherwise quiet, and at most every 5 minutes.
  function check(opts = {}) {
    if (running) return running;
    running = run(opts).finally(() => { running = null; });
    return running;
  }
  async function run({ manual, reapply } = {}) {
    const c = cfgNow();
    if (!connected(c)) { if (manual) toast("Add your waypage-data repo and token first", true); return; }
    if (c.paused) { if (manual) toast("Reading from Waypage is turned off", true); return; }
    const cache = readCache();
    if (!manual && !reapply && c.every === "manual") return;
    if (!manual && !reapply && cache.checkedAt && Date.now() - cache.checkedAt < (EVERY_MS[c.every] || EVERY)) return;
    if (whenSynced) await whenSynced();
    let body;
    try {
      if (reapply) body = cache.repo === c.repo ? cache.text : null;
      else {
        const got = await fetchFile(c, manual);
        if (got.none) { lastStatus = "No reading shared yet: turn on Share reading activity in Waypage, then sync it."; paintStatus(); if (manual) toast("Nothing shared from Waypage yet"); return; }
        if (got.same && !manual) { writeCache({ ...readCache(), checkedAt: Date.now() }); return; }
        body = got.text;
      }
    } catch (e) {
      lastStatus = e.message || "Couldn't reach GitHub.";
      paintStatus();
      if (manual) toast(lastStatus, true);
      return;
    }
    const act = body ? parseActivity(body) : null;
    if (!act) { if (manual) toast("That file isn't Waypage's reading activity", true); return; }
    const cfg = cfgNow();
    const { changed, counts } = apply(state.data, cfg, act, localDay(), new Date().toISOString());
    lastStatus = "Read " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " · " + act.items.length + " in the file";
    if (changed) {
      state.data.settings.waypage = cfg;
      afterDataChange();
      await persist();
      render();
      // What it started or finished goes on to Hardcover from here.
      if (window.LifeLogHardcover && (counts.started || counts.finished || counts.added || counts.linked)) window.LifeLogHardcover.changed({ category: "" });
    }
    paintStatus();
    paintReview();
    paintLinked();
    const said = [counts.added && counts.added + " started", counts.finished && counts.finished + " finished", counts.review && counts.review + " to review"].filter(Boolean);
    if (said.length && (manual || counts.added || counts.finished)) toast("Waypage: " + said.join(", "));
    else if (manual) toast("Waypage is up to date");
  }

  let timer = null;
  function start() {
    check();
    if (timer) clearInterval(timer);
    timer = setInterval(() => { if (document.visibilityState === "visible" && cfgNow().every === "5m") check(); }, EVERY);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  }

  // ---------- Settings › Connections › Waypage ----------
  async function save(c, opts = {}) {
    state.data.settings.waypage = c;
    afterDataChange();
    await persist();
    if (opts.reapply) await check({ reapply: true });
  }

  function paintStatus() {
    const s = $("#waypageStatus");
    if (!s) return;
    const c = cfgNow();
    const how = { "5m": "every few minutes", open: "every open", day: "once a day", manual: "when you tap Check" }[c.every];
    s.textContent = !c.repo ? "Not connected" : !c.token ? "Add a token to read it" : c.paused ? "Turned off: nothing is read" : lastStatus || "Connected — reads " + how;
  }

  function fillKinds() {
    const box = $("#waypageKinds");
    if (!box) return;
    const c = cfgNow();
    const names = (state.data.categories || []).map((x) => x.name);
    box.replaceChildren();
    for (const k of KINDS) {
      const row = el("label", "sitem");
      const label = el("span", "sitem-text");
      label.appendChild(el("span", "sitem-title", KIND_NAMES[k]));
      row.appendChild(label);
      const sel = el("select");
      sel.appendChild(new Option("Don't bring in", ""));
      for (const n of names) sel.appendChild(new Option(n, n));
      sel.value = names.includes(c.kinds[k]) ? c.kinds[k] : "";
      sel.onchange = () => { const x = cfgNow(); x.kinds[k] = sel.value; save(x, { reapply: true }); };
      row.appendChild(sel);
      box.appendChild(row);
    }
  }

  function fillHabitSelect() {
    const sel = $("#waypageHabit");
    if (!sel) return;
    const c = cfgNow();
    sel.replaceChildren(new Option("None", ""));
    for (const h of state.data.habits || []) if (h.unit === "min") sel.appendChild(new Option(h.name, h.id));
    sel.value = [...sel.options].some((o) => o.value === c.habit) ? c.habit : "";
  }

  const REASONS = { logged: "Already on your Timeline. A re-read?", author: "Matches a backlog item by a different author", new: "New from Waypage" };
  function paintReview() {
    const box = $("#waypageReview");
    if (!box) return;
    const c = cfgNow();
    const rows = Object.entries(c.review);
    box.hidden = !rows.length;
    const list = $("#waypageReviewList");
    list.replaceChildren();
    for (const [id, r] of rows) {
      const row = el("div", "sitem sitem-stack wp-review-row");
      const t = el("span", "sitem-text");
      t.append(el("span", "sitem-title", r.title + (r.author ? " · " + r.author : "")), el("span", "sitem-sub", REASONS[r.reason] || "Needs a look"));
      row.appendChild(t);
      const btns = el("div", "wp-review-btns");
      const acts = r.reason === "new" ? [["add", "Add"], ["never", "Never"]] : [["same", "Same one"], ["add", r.finishedAt ? "Add as re-read" : "Add"], ["never", "Never"]];
      for (const [act, label] of acts) {
        const b = el("button", "btn btn-sm", label);
        b.type = "button";
        b.onclick = async () => {
          const x = cfgNow();
          if (!resolve(state.data, x, id, act, localDay(), new Date().toISOString())) return;
          await save(x);
          render();
          paintReview();
          paintLinked();
        };
        btns.appendChild(b);
      }
      row.appendChild(btns);
      list.appendChild(row);
    }
  }

  // What Waypage brought in or linked, newest first, and what's kept out.
  function titlesFromCache() {
    const act = parseActivity(readCache().text || "");
    return new Map(act ? act.items.map((it) => [it.id, it.title]) : []);
  }
  function smallRow(title, sub, label, onClick) {
    const row = el("div", "sitem");
    const t = el("span", "sitem-text");
    t.append(el("span", "sitem-title", title), el("span", "sitem-sub", sub));
    const b = el("button", "btn btn-sm", label);
    b.type = "button";
    b.onclick = onClick;
    row.append(t, b);
    return row;
  }
  const LINKED_SHOWN = 30;
  function paintLinked() {
    const box = $("#waypageLinked");
    if (!box) return;
    const c = cfgNow();
    const d = state.data;
    const dayText = (e) => e.year + "-" + pad2(e.month) + (e.day ? "-" + pad2(e.day) : "");
    const rows = [
      ...(d.backlog || []).filter((b) => b.waypageId).map((b) => ({ list: "backlog", x: b, sort: "9" + (b.startedAt || ""), sub: (b.dropped ? "Dropped" : isDay(b.startedAt) ? "Reading" : "In your backlog") + (progressLabel(b) ? " · " + progressLabel(b) : "") })),
      ...(d.entries || []).filter((e) => e.waypageId).map((e) => ({ list: "entries", x: e, sort: "1" + dayText(e), sub: "Finished " + dayText(e) + " · on your Timeline" })),
    ].sort((a, b) => (a.sort < b.sort ? 1 : -1));
    box.replaceChildren();
    for (const r of rows.slice(0, LINKED_SHOWN)) {
      box.appendChild(smallRow(r.x.title + (r.x.author ? " · " + r.x.author : ""), r.sub, "Unlink", async () => {
        const x = cfgNow();
        if (!unlink(state.data, x, r.list, r.x.id)) return;
        await save(x);
        render();
        paintLinked();
        toast("Unlinked: Waypage won't change it");
      }));
    }
    if (rows.length > LINKED_SHOWN) box.appendChild(el("div", "sitem sitem-sub", "And " + (rows.length - LINKED_SHOWN) + " more"));
    $("#waypageLinkedGroup").hidden = !rows.length;
    const kept = $("#waypageKeptOut");
    const names = titlesFromCache();
    const out = Object.entries(c.never);
    kept.replaceChildren();
    for (const [id, v] of out) {
      kept.appendChild(smallRow(typeof v === "string" ? v : names.get(id) || "A book from Waypage", "Kept out", "Allow again", async () => {
        const x = cfgNow();
        if (!allowAgain(x, id)) return;
        await save(x, { reapply: true });
        paintLinked();
      }));
    }
    $("#waypageKeptOutGroup").hidden = !out.length;
  }

  // GitHub's form for a new fine-grained token, filled in (its URL
  // parameters: name, description, owner, expiry, contents=read). The one
  // thing a link can't pick is the repo, so that's the step left.
  function tokenUrl(repo) {
    const owner = String(repo || "").split("/")[0];
    const p = new URLSearchParams({ name: "LifeLog reads Waypage", description: "Read-only: LifeLog reads activity/reading.json", expires_in: "366", contents: "read" });
    if (owner) p.set("target_name", owner);
    return "https://github.com/settings/personal-access-tokens/new?" + p.toString();
  }
  // Your Waypage repo is most likely beside your LifeLog one.
  function guessRepo() {
    const gh = window.LifeLogStorage && window.LifeLogStorage.githubInfo;
    return gh && gh.owner ? gh.owner + "/waypage-data" : "";
  }

  function renderSettings() {
    if (!$("#waypageRepo")) return;
    const c = cfgNow();
    $("#waypageRepo").value = c.repo || guessRepo();
    $("#waypageTokenLink").href = tokenUrl(c.repo || guessRepo());
    $("#waypageToken").value = c.token;
    $("#waypageOn").checked = !c.paused;
    $("#waypageEvery").value = c.every;
    $("#waypageNew").value = c.newMode;
    $("#waypageStartFinish").checked = c.startFinish;
    $("#waypageShowProgress").checked = c.showProgress;
    $("#waypageDisconnectBtn").hidden = !c.token;
    fillKinds();
    fillHabitSelect();
    paintStatus();
    paintReview();
    paintLinked();
  }

  function wire() {
    if (!$("#waypageRepo")) return;
    const setField = async (field, value) => {
      const c = cfgNow();
      if (c[field] === value) return;
      c[field] = value;
      if (field === "repo") writeCache({});
      if (connected(c) && !c.connectedAt) {
        c.connectedAt = new Date().toISOString();
        const picked = KINDS.some((k) => c.kinds[k]);
        if (!picked) c.kinds = defaultKinds(state.data.categories);
        fillKinds();
      }
      await save(c);
      paintStatus();
    };
    $("#waypageRepo").onchange = () => setField("repo", cleanConfig({ repo: $("#waypageRepo").value }).repo);
    $("#waypageToken").onchange = async () => {
      // A pasted token with no repo typed takes the one shown, then reads at once.
      const repo = cleanConfig({ repo: $("#waypageRepo").value }).repo;
      if (repo && repo !== cfgNow().repo) await setField("repo", repo);
      await setField("token", $("#waypageToken").value.trim());
      if (connected(cfgNow())) check({ manual: true });
    };
    $("#waypageRepo").addEventListener("input", () => { $("#waypageTokenLink").href = tokenUrl($("#waypageRepo").value); });
    $("#waypageHabit").onchange = async () => {
      const c = cfgNow();
      moveHabit(state.data, c, $("#waypageHabit").value);
      await save(c, { reapply: true });
      render();
    };
    $("#waypageCheckBtn").onclick = () => check({ manual: true });
    const setOpt = async (field, value, reapply) => {
      const c = cfgNow();
      c[field] = value;
      await save(c, { reapply });
      paintStatus();
      if (reapply) render();
    };
    $("#waypageOn").onchange = async () => { await setOpt("paused", !$("#waypageOn").checked); if (!cfgNow().paused) check({ manual: true }); };
    $("#waypageEvery").onchange = () => setOpt("every", $("#waypageEvery").value);
    $("#waypageNew").onchange = () => setOpt("newMode", $("#waypageNew").value, true);
    $("#waypageStartFinish").onchange = () => setOpt("startFinish", $("#waypageStartFinish").checked, true);
    $("#waypageShowProgress").onchange = () => setOpt("showProgress", $("#waypageShowProgress").checked, true);
    $("#waypageDisconnectBtn").onclick = async () => {
      const c = cfgNow();
      c.token = "";
      c.connectedAt = "";
      writeCache({});
      await save(c);
      renderSettings();
      toast("Disconnected from Waypage. What it brought in stays");
    };
  }

  const api = {
    init, wire, start, check, renderSettings, progressLabel,
    // pure, for tests and the bridge
    KINDS, KIND_NAMES, DEFAULTS, tokenUrl, cleanConfig, parseActivity, apply, resolve, unlink, allowAgain, moveHabit, defaultKinds, titleKey, minutesText, entryFrom, backlogFrom,
  };
  if (typeof window !== "undefined") window.LifeLogWaypage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
