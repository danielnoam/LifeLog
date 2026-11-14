// LifeLog — your Hardcover library, both ways.
//
// Settings → Connections → Hardcover. One category (your Books) is kept in
// step with your Hardcover statuses: Want to Read is the backlog, Currently
// Reading is in progress, Read is the Timeline on the day you finished, Did
// Not Finish is Dropped, and Paused stays in the backlog. Hardcover's
// Ignored is left alone.
//
// It works like the AniList sync (sync.js, "AniList, both ways"): each book
// both sides have is compared with what this device saw the last time they
// agreed (the base, per device). The side that moved since wins; when both
// moved, the newer change wins; with no base, the further one does (Read
// over Reading over Want to Read). A local win goes to Hardcover.
//
// Books are linked by mediaSource "hardcover" + the book's slug, the same
// shape a Hardcover lookup gives. One you have by another source is matched
// by title (and author, when both have one) and linked. Books on Hardcover
// you have nowhere come in through the import review; what you untick
// stays out (importSkips.hardcover). Books you add here after connecting go
// to Hardcover when they're Hardcover books, or when Hardcover has one with
// the same title and author. Deleting never reaches Hardcover.
//
// The Waypage reading log needs no rule of its own: when it starts or
// finishes a book here, that's a change here, and it goes on from there.
//
// Hardcover's write calls (insert_user_book, update_user_book,
// insert_user_book_read) aren't in its docs; they're the ones its KOReader
// plugin uses with a personal token.
(function () {
  let ctx = null;

  const STATUS_IDS = { want: 1, reading: 2, read: 3, paused: 4, dnf: 5 };
  const STATUS_NAMES = { 1: "want", 2: "reading", 3: "read", 4: "paused", 5: "dnf" };
  const RANK = { want: 0, reading: 1, read: 2 };
  const BASE_KEY = "lifelog-hardcover-base-v1"; // { slug: status } on this device
  const SYNC_KEY = "lifelog-hardcover-autosync-v1";
  const MISS_KEY = "lifelog-hardcover-miss-v1"; // { itemId: time } books Hardcover had no match for
  const MISS_RETRY = 30 * 24 * 60 * 60 * 1000;
  const OPEN_GAP = 10 * 60 * 1000;
  const SEARCH_PER_SYNC = 10;
  const SOURCE = "hardcover";

  const pad2 = (n) => String(n).padStart(2, "0");
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const dayOf = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "");
  const timeOf = (s) => Date.parse(s || "") || 0;
  const text = (v) => String(v == null ? "" : v).trim();
  const localDay = (d = new Date()) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());

  function titleKey(t) {
    if (typeof window !== "undefined" && window.LifeLogMedia && window.LifeLogMedia.titleKey) return window.LifeLogMedia.titleKey(t);
    return text(t).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim() + "|1";
  }
  const authorKey = (a) => text(a).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const authorsClash = (a, b) => !!authorKey(a) && !!authorKey(b) && authorKey(a) !== authorKey(b);
  const isLinked = (x) => x && x.mediaSource === SOURCE && !!x.mediaId;

  // ---------- pure: Hardcover's rows ----------
  // One user_books row as the sync uses it, or null.
  function readUserBook(row) {
    if (!row || !row.book || !row.book.slug) return null;
    const status = STATUS_NAMES[+row.status_id];
    if (!status) return null;
    const bk = row.book;
    const img = bk.cached_image && typeof bk.cached_image === "object" ? bk.cached_image : {};
    const people = Array.isArray(bk.cached_contributors) ? bk.cached_contributors.map((c) => c && c.author && c.author.name).filter(Boolean) : [];
    return {
      ubId: +row.id || 0, bookId: +bk.id || 0, slug: String(bk.slug), title: text(bk.title), author: people[0] || "",
      coverUrl: /^https:\/\//.test(img.url || "") ? img.url : "", pages: +bk.pages || 0, year: +bk.release_year || 0,
      status, updatedAt: timeOf(row.updated_at),
      startedAt: dayOf(row.first_started_reading_date), finishedAt: dayOf(row.last_read_date), addedAt: dayOf(row.date_added),
      rating: +row.rating || 0,
    };
  }

  // What a book is here: in the backlog (want, reading or dnf) or only on
  // the Timeline (read).
  function localState(b) {
    if (b) return { status: b.dropped ? "dnf" : isDay(b.startedAt) ? "reading" : "want", at: timeOf(b.updatedAt) };
    return { status: "read", at: 0 };
  }
  // Paused is kept as it is on Hardcover and reads as Want to Read here.
  const remoteAsLocal = (s) => (s === "paused" ? "want" : s);

  // Which side wins, or null when they agree.
  function side(l, r, base, lt, rt) {
    if (l === r) return null;
    if (base !== undefined) {
      if (l === base) return "remote";
      if (r === base) return "local";
      if (lt && rt && lt !== rt) return lt > rt ? "local" : "remote";
    }
    return l in RANK && r in RANK && RANK[l] > RANK[r] ? "local" : "remote";
  }

  // Every book on your Hardcover lists against what you have in the
  // category: `titles` you have (linked by slug, or matched by title and
  // author and then linked), and `fresh` ones you have nowhere.
  function plan(remote, data, category, base, skips) {
    const bSlug = new Map(), eSlug = new Map(), bName = new Map(), eName = new Map();
    const newer = (map, k, x) => { const y = map.get(k); if (!y || String(x.date || "") + pad2(x.day || 0) > String(y.date || "") + pad2(y.day || 0)) map.set(k, x); };
    for (const b of data.backlog || []) {
      if (isLinked(b)) bSlug.set(b.mediaId, b);
      else if (b.category === category) { const k = titleKey(b.title); if (k && !bName.has(k)) bName.set(k, b); }
    }
    for (const e of data.entries || []) {
      if (isLinked(e)) newer(eSlug, e.mediaId, e);
      else if (e.category === category) { const k = titleKey(e.title); if (k) newer(eName, k, e); }
    }
    const titles = [], fresh = [];
    for (const r of remote) {
      let b = bSlug.get(r.slug) || null, e = b ? null : eSlug.get(r.slug) || null, link = null;
      if (!b && !e) {
        const k = titleKey(r.title);
        const mb = bName.get(k), me = eName.get(k);
        if (mb && !authorsClash(mb.author, r.author)) { b = link = mb; bName.delete(k); }
        else if (me && !authorsClash(me.author, r.author)) { e = link = me; eName.delete(k); }
      }
      if (!b && !e) {
        if (base[r.slug] === undefined && !skips.has(SOURCE + ":" + r.slug)) fresh.push(r);
        continue;
      }
      const l = localState(b);
      const rs = remoteAsLocal(r.status);
      const won = side(l.status, rs, base[r.slug], l.at, r.updatedAt);
      titles.push({ r, b, e, link, status: won === "local" ? l.status : rs, pull: won === "remote", push: won === "local" });
    }
    return { titles, fresh };
  }

  // A Read book's Timeline entry: the backlog item's own fields when there
  // is one, filed on the day Hardcover has it finished (this month when it
  // has none), spanning back to when it was started.
  function finishedEntry(b, r, category, today) {
    const dated = isDay(r.finishedAt);
    const done = dated ? r.finishedAt : today;
    const year = +done.slice(0, 4), month = +done.slice(5, 7);
    const e = { title: b ? b.title : r.title, category: b ? b.category : category, year, month, date: year + "-" + pad2(month), mediaSource: SOURCE, mediaId: r.slug };
    if (dated) e.day = +done.slice(8, 10);
    if (b) {
      for (const k of ["coverUrl", "length", "genres", "author", "notes", "externalRating", "overrides", "releaseYear"]) if (b[k]) e[k] = b[k];
      if (b.createdAt) e.backlogAddedAt = b.createdAt;
    }
    if (!e.coverUrl && r.coverUrl) e.coverUrl = r.coverUrl;
    if (!e.author && r.author) e.author = r.author;
    if (!e.length && r.pages) e.length = r.pages + " pages";
    const started = (b && isDay(b.startedAt) ? b.startedAt : "") || r.startedAt;
    if (started && started <= done) {
      e.startedAt = started;
      const sy = +started.slice(0, 4), sm = +started.slice(5, 7);
      if (sy * 12 + sm < year * 12 + month) { e.startYear = sy; e.startMonth = sm; }
    }
    if (r.rating >= 1) e.rating = Math.min(5, Math.round(r.rating));
    if (!dated) e.notes = (e.notes ? e.notes + "\n" : "") + "Finished: Hardcover didn't say when";
    return e;
  }

  function backlogItem(r, category, today) {
    const b = { title: r.title, category, mediaSource: SOURCE, mediaId: r.slug };
    if (r.coverUrl) b.coverUrl = r.coverUrl;
    if (r.author) b.author = r.author;
    if (r.pages) b.length = r.pages + " pages";
    if (r.year) b.releaseYear = r.year;
    if (r.status === "reading") b.startedAt = r.startedAt || today;
    if (r.status === "dnf") b.dropped = true;
    return b;
  }

  const itemId = (slug, suffix) => ("hc-" + slug + (suffix ? "-" + suffix : "")).replace(/[^a-z0-9-]+/gi, "-");

  // Makes the plan's pulls in `data`. Returns the counts and what Undo needs.
  function applyPlan(p, data, today, now) {
    const undo = { added: { backlog: [], entries: [] }, removed: [], prev: [] };
    const counts = { linked: 0, started: 0, finished: 0, dropped: 0, back: 0 };
    const remember = (list, x) => {
      if (undo.added[list].includes(x.id) || undo.prev.some((q) => q.id === x.id && q.list === list)) return;
      undo.prev.push({ list, id: x.id, before: JSON.parse(JSON.stringify(x)) });
    };
    for (const t of p.titles) {
      let b = t.b;
      if (t.link) {
        remember(b ? "backlog" : "entries", t.link);
        t.link.mediaSource = SOURCE;
        t.link.mediaId = t.r.slug;
        counts.linked++;
      }
      if (!t.pull) continue;
      if (b && t.status === "read") {
        const entry = { ...finishedEntry(b, t.r, b.category, today), id: itemId(t.r.slug, t.r.finishedAt || today), createdAt: now };
        if (!data.entries.some((x) => x.id === entry.id)) { data.entries.push(entry); undo.added.entries.push(entry.id); }
        undo.removed.push(b);
        data.backlog = data.backlog.filter((x) => x !== b);
        counts.finished++;
      } else if (b) {
        remember("backlog", b);
        if (t.status === "reading") { if (!isDay(b.startedAt)) b.startedAt = t.r.startedAt || today; delete b.dropped; counts.started++; }
        else if (t.status === "dnf") { b.dropped = true; delete b.startedAt; counts.dropped++; }
        else { delete b.startedAt; delete b.dropped; counts.back++; }
      } else if (t.e && t.status !== "read") {
        // Back on a list after you finished it: reading it again.
        const nb = { ...backlogItem({ ...t.r, status: t.status }, t.e.category, today), id: itemId(t.r.slug, today), createdAt: now };
        for (const k of ["coverUrl", "author", "length", "genres"]) if (t.e[k] && !nb[k]) nb[k] = t.e[k];
        if (!data.backlog.some((x) => x.id === nb.id)) { data.backlog.push(nb); undo.added.backlog.push(nb.id); }
        if (t.status === "reading") counts.started++; else if (t.status === "dnf") counts.dropped++; else counts.back++;
      }
    }
    const changed = !!(undo.prev.length || undo.removed.length || undo.added.backlog.length || undo.added.entries.length);
    return { changed, counts, undo };
  }

  // Fresh books as import rows: Read ones as Timeline entries (unticked when
  // Hardcover has no finish date), the rest as backlog items.
  function freshRecords(fresh, category, today) {
    const entries = [], backlog = [];
    for (const r of fresh) {
      if (r.status === "read") entries.push({ r, entry: finishedEntry(null, r, category, today) });
      else backlog.push({ r, item: backlogItem(r, category, today) });
    }
    return { entries, backlog };
  }

  // Books added here after connecting that Hardcover doesn't have on a list
  // yet. Older ones are left alone: connecting isn't asking to copy your
  // whole history over.
  function localOnly(data, category, remoteSlugs, connectedAt, base, skips) {
    const since = timeOf(connectedAt);
    if (!since) return [];
    const out = [], seen = new Set();
    const consider = (x, isEntry) => {
      if (x.category !== category || timeOf(x.createdAt) < since) return;
      if (isLinked(x)) {
        if (remoteSlugs.has(x.mediaId) || base[x.mediaId] !== undefined || skips.has(SOURCE + ":" + x.mediaId) || seen.has(x.mediaId)) return;
        seen.add(x.mediaId);
      }
      out.push({ x, isEntry, linked: isLinked(x) });
    };
    for (const b of data.backlog || []) consider(b, false);
    for (const e of data.entries || []) consider(e, true);
    return out;
  }

  function due(setting, lastAt, now = Date.now()) {
    if (setting === "open") return now - lastAt >= OPEN_GAP;
    const days = parseInt(setting, 10) || 0;
    return days > 0 && now - lastAt >= days * 24 * 60 * 60 * 1000;
  }

  // ---------- talking to Hardcover ----------
  const Q_ME = "{ me { id username } }";
  const Q_LIST = "query ($u: Int!, $o: Int!) { user_books(where: {user_id: {_eq: $u}, status_id: {_in: [1, 2, 3, 4, 5]}}, order_by: {id: asc}, limit: 100, offset: $o) { id status_id updated_at date_added first_started_reading_date last_read_date rating book { id slug title pages release_year cached_image cached_contributors } } }";
  const Q_BOOK = "query ($s: String!) { books(where: {slug: {_eq: $s}}, limit: 1) { id } }";
  const M_INSERT = "mutation ($o: UserBookCreateInput!) { insert_user_book(object: $o) { error user_book { id } } }";
  const M_UPDATE = "mutation ($id: Int!, $s: Int!) { update_user_book(id: $id, object: {status_id: $s}) { error user_book { id } } }";
  const M_READ = "mutation ($id: Int!, $s: date, $f: date) { insert_user_book_read(user_book_id: $id, user_book_read: {started_at: $s, finished_at: $f}) { error } }";

  const S = () => ctx.state.data.settings;
  const cfgOf = () => ({ ...ctx.DEFAULT_SETTINGS.hardcover, ...(S().hardcover || {}) });
  const keys = () => S().mediaKeys || {};
  const proxy = () => (window.LifeLogPlatform ? window.LifeLogPlatform.steamProxy((S().steam || {}).proxyUrl) : "");
  const q = (query, variables) => window.LifeLogMedia.hardcoverQuery(query, variables, keys(), proxy());
  const hasToken = () => !!String(keys().hardcover || "").trim();

  async function whoAmI() {
    const d = await q(Q_ME);
    const me = d && (Array.isArray(d.me) ? d.me[0] : d.me);
    return me && +me.id ? { id: +me.id, username: text(me.username) } : null;
  }
  async function fetchLibrary(userId, job) {
    const out = [];
    for (let o = 0; o < 5000; o += 100) {
      if (job && job.stopping) return null;
      const d = await q(Q_LIST, { u: userId, o });
      if (!d || !Array.isArray(d.user_books)) return null;
      for (const row of d.user_books) { const r = readUserBook(row); if (r) out.push(r); }
      if (job) job.progress(out.length, 0, "Reading your Hardcover library…");
      if (d.user_books.length < 100) break;
    }
    return out;
  }
  async function bookIdOf(slug) {
    const d = await q(Q_BOOK, { s: slug });
    const b = d && Array.isArray(d.books) ? d.books[0] : null;
    return b && +b.id ? +b.id : 0;
  }
  const failed = (d, name) => !d || !d[name] || d[name].error;

  // Sends one book's status, with the dates that go with it. Returns the
  // user_book id, or 0 when Hardcover said no.
  async function sendStatus(status, { ubId, bookId, slug, startedAt, finishedAt }) {
    let id = ubId;
    if (id) {
      const d = await q(M_UPDATE, { id, s: STATUS_IDS[status] });
      if (failed(d, "update_user_book")) return 0;
    } else {
      const bid = bookId || await bookIdOf(slug);
      if (!bid) return 0;
      const d = await q(M_INSERT, { o: { book_id: bid, status_id: STATUS_IDS[status] } });
      if (failed(d, "insert_user_book") || !d.insert_user_book.user_book) return 0;
      id = +d.insert_user_book.user_book.id || 0;
    }
    // Dates: a read-through, so Hardcover files it where LifeLog does.
    if (id && (status === "reading" && isDay(startedAt) || status === "read" && (isDay(startedAt) || isDay(finishedAt)))) {
      await q(M_READ, { id, s: isDay(startedAt) ? startedAt : null, f: status === "read" && isDay(finishedAt) ? finishedAt : null });
    }
    return id;
  }

  // A book here by another source, looked up on Hardcover: the same title,
  // and the same author when both have one.
  async function findOnHardcover(x) {
    const hits = await window.LifeLogMedia.search(x.title, "hardcover", keys(), proxy(), x.author || "").catch(() => null);
    const want = titleKey(x.title);
    return (hits || []).find((h) => h && h.id && titleKey(h.title) === want && !authorsClash(h.author, x.author)) || null;
  }

  function readJson(key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } }
  function writeJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* asked again next time */ } }

  const entryDay = (e) => (e && e.year && e.month && e.day ? e.year + "-" + pad2(e.month) + "-" + pad2(e.day) : "");

  // ---------- the sync ----------
  let running = null, again = false;
  function sync(opts = {}) {
    if (running) { again = again || !opts.manual; if (opts.manual) ctx.toast("Hardcover is already syncing"); return running; }
    running = runSync(opts).finally(() => { running = null; if (again) { again = false; sync({ nudge: true }); } });
    return running;
  }

  async function runSync({ manual } = {}) {
    const cfg = cfgOf();
    const say = (msg) => { if (manual) ctx.toast(msg, true); };
    if (!hasToken()) return say("Add your Hardcover token in Media lookups first");
    if (!cfg.category || !ctx.state.data.categories.some((c) => c.name === cfg.category)) return say("Pick a category for your Hardcover books first");
    if (!window.LifeLogMedia || !window.LifeLogMedia.hardcoverQuery) return say("Media lookups aren't available");
    if (ctx.whenSynced) await ctx.whenSynced();
    const btn = manual ? document.getElementById("hardcoverSyncBtn") : null;
    const label = btn ? [...btn.childNodes].map((n) => n.cloneNode(true)) : null;
    if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
    const lastErr = () => window.LifeLogMedia.getLastError();
    try {
      await window.LifeLogJobs.run({ label: manual ? "Syncing Hardcover" : "Checking Hardcover", lane: "hardcover", again: "hardcoverSyncBtn" }, async (job) => {
        const me = await whoAmI();
        if (!me) { say("Hardcover sync failed — " + (lastErr() || "it didn't say who the token belongs to")); job.fail("Hardcover couldn't be reached"); return; }
        if (me.username !== cfg.username) await setSetting("username", me.username);
        const remote = await fetchLibrary(me.id, job);
        if (!remote) {
          if (job.stopping) { job.finish("Stopped"); return; }
          say("Hardcover sync failed — " + (lastErr() || "couldn't read your library"));
          job.fail("Hardcover couldn't be read");
          return;
        }
        const data = ctx.state.data;
        const base = readJson(BASE_KEY);
        const skips = new Set(((S().importSkips || {}).hardcover) || []);
        const today = localDay();
        const now = new Date().toISOString();
        const p = plan(remote, data, cfg.category, base, skips);
        // What comes in: a status switched off leaves the book here as it is.
        const C = window.LifeLogConnections;
        const takes = (s) => !C || C.takes("hardcover", s === "paused" ? "want" : s);
        const sending = !C || C.sends("hardcover");
        for (const t of p.titles) if (t.pull && !takes(t.status)) { t.pull = false; t.held = true; }
        p.fresh = p.fresh.filter((r) => takes(r.status));
        const result = applyPlan(p, data, today, now);

        // Sending what this side won.
        let sent = 0, failures = 0;
        for (const t of p.titles) {
          if (job.stopping) break;
          if (t.held) continue;
          if (!t.push) { base[t.r.slug] = t.status; continue; }
          if (!sending) continue;
          const slug = t.r.slug;
          const b = t.status === "read" ? null : data.backlog.find((x) => isLinked(x) && x.mediaId === slug);
          const e = t.status === "read" ? (t.e || data.entries.find((x) => isLinked(x) && x.mediaId === slug)) : null;
          const ok = await sendStatus(t.status, { ubId: t.r.ubId, bookId: t.r.bookId, slug, startedAt: (b || e || {}).startedAt, finishedAt: entryDay(e) });
          if (ok) { sent++; base[slug] = t.status; } else failures++;
        }
        // Then books added here since connecting.
        const remoteSlugs = new Set(remote.map((r) => r.slug));
        const misses = readJson(MISS_KEY);
        let searched = 0, linkedNew = 0;
        for (const { x, isEntry, linked } of sending ? localOnly(data, cfg.category, remoteSlugs, cfg.connectedAt, base, skips) : []) {
          if (job.stopping) break;
          let slug = linked ? x.mediaId : "";
          if (!slug) {
            if (searched >= SEARCH_PER_SYNC || Date.now() - (misses[x.id] || 0) < MISS_RETRY) continue;
            searched++;
            const hit = await findOnHardcover(x);
            if (!hit) { misses[x.id] = Date.now(); continue; }
            if (remoteSlugs.has(hit.id) || base[hit.id] !== undefined) continue; // the next sync matches it
            x.mediaSource = SOURCE;
            x.mediaId = slug = hit.id;
            if (!x.coverUrl && hit.coverUrl) x.coverUrl = hit.coverUrl;
            linkedNew++;
          }
          const st = isEntry ? "read" : localState(x).status;
          const ok = await sendStatus(st, { ubId: 0, bookId: 0, slug, startedAt: x.startedAt, finishedAt: isEntry ? entryDay(x) : "" });
          if (ok) { sent++; base[slug] = st; } else failures++;
        }
        writeJson(MISS_KEY, misses);
        writeJson(BASE_KEY, base);
        if (failures) ctx.toast("Couldn't update Hardcover" + (lastErr() ? " — " + lastErr() : "") + ". It's tried again next sync.", true);

        const c = result.counts;
        const parts = [];
        if (c.started) parts.push(c.started + " started");
        if (c.finished) parts.push(c.finished + " finished");
        if (c.dropped) parts.push(c.dropped + " dropped");
        if (c.back) parts.push(c.back + " back to the backlog");
        if (result.changed || linkedNew) {
          ctx.afterDataChange();
          await ctx.persist();
          ctx.render();
        }
        if (result.changed && parts.length) ctx.toast("Hardcover: " + parts.join(", "), false, { label: "Undo", onClick: () => undoPlan(result.undo) });
        else if (manual && (!p.fresh.length || (C && C.newMode("hardcover") === "none"))) ctx.toast(sent ? `Hardcover is up to date — sent ${sent} change${sent === 1 ? "" : "s"}` : "Your Hardcover library is up to date");

        // New on Hardcover: through the review.
        const recs = freshRecords(p.fresh, cfg.category, today);
        let n = 0, built = null;
        if (recs.entries.length || recs.backlog.length) {
          built = ctx.buildImportItems({ entries: recs.entries.map((x) => x.entry), backlog: recs.backlog.map((x) => x.item), categories: [] });
          const eRows = built.items.filter((it) => it.kind === "entry"), bRows = built.items.filter((it) => it.kind === "backlog");
          eRows.forEach((it, i) => { const rec = recs.entries[i]; if (!rec) return; it.hardcoverSlug = rec.r.slug; if (!it.dup && !isDay(rec.r.finishedAt)) it.checked = false; });
          bRows.forEach((it, i) => { if (recs.backlog[i]) it.hardcoverSlug = recs.backlog[i].r.slug; });
          for (const it of built.items) if (!it.dup && skips.has(SOURCE + ":" + it.hardcoverSlug)) { it.skipped = true; it.checked = false; }
          n = built.items.filter((it) => !it.dup && !it.skipped).length;
        }
        const mode = C ? C.newMode("hardcover") : "ask";
        job.finish([parts.join(", "), sent && `sent ${sent}`, n && mode !== "none" && (mode === "add" ? `${n} new` : `${n} to review`)].filter(Boolean).join(" · ") || "Up to date");
        if (n && C) C.route("hardcover", { built, title: "Hardcover", hint: HINT, manual, onSkips: (selected, rows) => rememberSkips(rows, selected, base), onAdded: (rows) => rememberSkips(rows, rows, base) });
        else if (n) ctx.reviewAndImport("Hardcover", HINT, built, (selected) => rememberSkips(built.items, selected, base));
      });
    } catch (e) {
      // Already said, and kept in Activity.
    } finally {
      if (btn) { btn.disabled = false; btn.replaceChildren(...label); }
      renderSettings();
    }
  }
  const HINT = "Books on your Hardcover lists that aren't in LifeLog yet. Read books go to your Timeline on the day you finished; ones Hardcover has no date for are unticked. What you leave unticked stays out next time.";

  // Unticked rows stay out of the way next time. Ticked ones are agreed
  // on, so the next sync starts from them.
  async function rememberSkips(rows, selected, base) {
    const chosen = new Set(selected);
    const all = { ...(S().importSkips || {}) };
    const next = new Set(all.hardcover || []);
    const b = base || readJson(BASE_KEY);
    for (const it of rows) {
      if (it.dup || !it.hardcoverSlug) continue;
      const k = SOURCE + ":" + it.hardcoverSlug;
      if (chosen.has(it)) {
        next.delete(k);
        b[it.hardcoverSlug] = it.kind === "entry" ? "read" : it.entry.dropped ? "dnf" : isDay(it.entry.startedAt) ? "reading" : "want";
      } else next.add(k);
    }
    writeJson(BASE_KEY, b);
    if (next.size) all.hardcover = [...next]; else delete all.hardcover;
    S().importSkips = all;
    await ctx.persist();
  }

  async function undoPlan(undo) {
    const d = ctx.state.data;
    for (const list of ["backlog", "entries"]) {
      const gone = new Set(undo.added[list]);
      d[list] = d[list].filter((x) => !gone.has(x.id));
    }
    for (const p of undo.prev) {
      const at = d[p.list].findIndex((x) => x.id === p.id);
      if (at >= 0) d[p.list][at] = p.before;
    }
    for (const b of undo.removed) if (!d.backlog.some((x) => x.id === b.id)) d.backlog.push(b);
    ctx.afterDataChange();
    await ctx.persist();
    ctx.render();
    ctx.toast("Hardcover changes undone here — the next sync sends that to Hardcover");
  }

  async function maybeAutoCheck() {
    if (!ctx) return;
    const cfg = cfgOf();
    if (!hasToken() || !cfg.category) return;
    const last = readJson(SYNC_KEY);
    if (!due(String(cfg.autoSyncDays || "0"), timeOf(last.lastCheckedAt))) return;
    writeJson(SYNC_KEY, { lastCheckedAt: new Date().toISOString() });
    await sync();
  }

  // A change here to a book in the Hardcover category (a start, Done, a
  // drop, or the Waypage log doing one of those) goes out a few seconds
  // later, whatever the automatic setting says.
  let nudge = null;
  function changed(item) {
    if (!ctx || !item) return;
    const cfg = cfgOf();
    if (!hasToken() || !cfg.category || (item.category && item.category !== cfg.category && !isLinked(item))) return;
    clearTimeout(nudge);
    nudge = setTimeout(() => sync({ nudge: true }), 3000);
  }
  // Deleted here, it stays gone here: the next sync leaves it out instead
  // of bringing it back. Hardcover keeps it. The caller persists.
  function removed(item) {
    if (!ctx || !isLinked(item)) return;
    const all = { ...(S().importSkips || {}) };
    const k = SOURCE + ":" + item.mediaId;
    if ((all.hardcover || []).includes(k)) return;
    all.hardcover = [...(all.hardcover || []), k];
    S().importSkips = all;
  }

  // ---------- Settings → Connections → Hardcover ----------
  const $ = (id) => document.getElementById(id);
  async function setSetting(field, value) {
    const st = S();
    st.hardcover = { ...cfgOf(), [field]: value };
    await ctx.persist();
  }
  function renderSettings() {
    if (!ctx || !$("hardcoverSyncBtn")) return;
    const cfg = cfgOf();
    const sel = $("hardcoverCategory");
    sel.replaceChildren(new Option("Don't sync", ""));
    for (const c of ctx.state.data.categories) sel.appendChild(new Option(c.name, c.name));
    sel.value = ctx.state.data.categories.some((c) => c.name === cfg.category) ? cfg.category : "";
    $("hardcoverAutoSyncDays").value = String(cfg.autoSyncDays || "0");
    $("hardcoverState").textContent = !hasToken() ? "Add your token in Media lookups"
      : !cfg.category ? "Pick a category to start" : cfg.username ? "Syncing as @" + cfg.username : "Ready: syncs on the next check";
  }
  function wire() {
    if (!$("hardcoverSyncBtn")) return;
    $("hardcoverCategory").onchange = async () => {
      const v = $("hardcoverCategory").value;
      const cfg = cfgOf();
      // Connecting starts the clock for "added here since": books you add
      // from now on go to Hardcover; the ones you had stay as they are.
      if (v && !cfg.connectedAt) await setSetting("connectedAt", new Date().toISOString());
      await setSetting("category", v);
      renderSettings();
      if (v && hasToken()) sync({ manual: true });
    };
    $("hardcoverAutoSyncDays").onchange = () => setSetting("autoSyncDays", $("hardcoverAutoSyncDays").value);
    $("hardcoverSyncBtn").onclick = () => sync({ manual: true });
    if (window.LifeLogJobs && window.LifeLogJobs.onAgain) window.LifeLogJobs.onAgain("hardcoverSyncBtn", () => sync({ manual: true }));
  }

  function start(c) { ctx = c; wire(); }

  const api = {
    start, sync, maybeAutoCheck, renderSettings, changed, removed,
    // pure, for tests
    readUserBook, localState, side, plan, applyPlan, finishedEntry, backlogItem, freshRecords, localOnly, due, STATUS_IDS,
  };
  if (typeof window !== "undefined") window.LifeLogHardcover = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
