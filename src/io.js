// LifeLog — import/export: JSON/CSV export for the full backup and the
// journal, JSON/CSV import parsing, the unified dup-checked import-item
// builder, and the shared import/export review picker modal used by every
// importer/exporter across the app (including finance.js's CSV flow and
// steam.js's/app.js's sync-based imports). Extracted from app.js; shared app
// plumbing and the sanitizers/lookups it needs from the other view modules
// arrive via init(ctx), and everything app.js still calls directly is
// exposed on window.LifeLogIO.
(function () {
  // Shared app plumbing, provided by app.js via init(ctx).
  let state, $, el, uid, toast, persist, afterDataChange, ensureCategories, ensureProjects,
    CATEGORY_PALETTE, MONTHS, MONTHS_SHORT, colorOf,
    financeColorOf, formatMoney, financeKey, recurringKey,
    sanitizeFinanceEntry, sanitizeRecurring, sanitizeProject, sanitizeEntry, sanitizeBacklog,
    sanitizeNote, sanitizeTodo, sanitizeHabit, sanitizeBoard, addBoards, boardsForExport, boardsNow, isOverridden, deleteBoards;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, afterDataChange, ensureCategories, ensureProjects,
      CATEGORY_PALETTE, MONTHS, MONTHS_SHORT, colorOf,
      financeColorOf, formatMoney, financeKey, recurringKey,
      sanitizeFinanceEntry, sanitizeRecurring, sanitizeProject, sanitizeEntry, sanitizeBacklog,
      sanitizeNote, sanitizeTodo, sanitizeHabit, sanitizeBoard, addBoards, boardsForExport, boardsNow, isOverridden, deleteBoards } = ctx);
  }

  // What each tab holds, keyed by its view name. A tab's export carries all
  // of it, and a tab's import takes only its own kinds out of whatever file
  // it is given — so a full backup can be imported one tab at a time.
  const TAB_KINDS = {
    notes: ["note", "todo", "habit", "board"],
    timeline: ["entry", "achievement"],
    backlog: ["backlog"],
    finance: ["finance", "recurring"],
  };
  const TAB_LABEL = { notes: "Notebook", timeline: "Timeline", backlog: "Backlog", finance: "Ledger", all: "everything" };
  const TAB_FILE = { notes: "notes", timeline: "timeline", backlog: "backlog", finance: "ledger" };
  function tabPayload(tab) {
    const d = state.data;
    if (tab === "notes") return { notes: d.notes, noteCategories: d.noteCategories, habits: d.habits };
    if (tab === "timeline") return { entries: d.entries, categories: d.categories, accomplishments: d.accomplishments };
    if (tab === "backlog") return { backlog: d.backlog, categories: d.categories };
    return { financeEntries: d.financeEntries, recurringExpenses: d.recurringExpenses, financeCategories: d.financeCategories, projects: d.projects };
  }

  // Every export goes through here. In the Android app a download link does
  // nothing, so the file goes to Android's share sheet instead (see
  // LifeLogPlatform.saveAndShare); everywhere else it's the ordinary link.
  // `base64: true` when `text` is a binary file's bytes in base64 (a board's
  // PNG) rather than text.
  function download(filename, text, type, opts = {}) {
    const P = window.LifeLogPlatform;
    if (P && P.native) {
      P.saveAndShare(filename, text, opts).then((done) => { if (!done) downloadLink(filename, text, type, opts); })
        .catch((e) => toast("Couldn't export: " + (e && e.message || e), true));
      return;
    }
    downloadLink(filename, text, type, opts);
  }
  function downloadLink(filename, text, type, opts = {}) {
    const body = opts.base64 ? Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0)) : text;
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const a = el("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  // Boards live in their own file (boards.js), so both exports that carry
  // them fetch them first.
  async function exportJson() {
    const boards = boardsForExport ? await boardsForExport() : undefined;
    download("lifelog.json", JSON.stringify({ ...state.data, boards }, null, 2), "application/json");
  }
  function csvEsc(s) {
    s = String(s == null ? "" : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  async function exportTabJson(tab) {
    const payload = { lifelog: tab, exportedAt: new Date().toISOString(), ...tabPayload(tab) };
    if (tab === "notes" && boardsForExport) payload.boards = await boardsForExport();
    download("lifelog-" + TAB_FILE[tab] + ".json", JSON.stringify(payload, null, 2), "application/json");
  }
  // journal CSV covers both Timeline entries (dated, Year+Month) and Backlog
  // items (undated) — the Kind column tells them apart on re-import. Row-
  // building is split out from the actual download() call so the export
  // side of the CSV round-trip (paired with parseJournalCsv below) can be
  // exercised directly in tests, without a browser Blob/URL.
  function journalCsvRows(entries, backlog, accomplishments) {
    const rows = [["Kind", "Year", "Month", "Category", "Title", "Added"]];
    entries.slice()
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .forEach((e) => rows.push(["Entry", e.year, MONTHS[e.month], e.category, e.title,
        e.createdAt ? e.createdAt.slice(0, 10) : ""]));
    Object.keys(accomplishments || {}).sort().forEach((y) => (accomplishments[y] || []).forEach((a) =>
      rows.push(["Achievement", y, "", "", a.text, a.createdAt ? a.createdAt.slice(0, 10) : ""])));
    backlog.slice()
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
      .forEach((b) => rows.push(["Backlog", "", "", b.category, b.title,
        b.createdAt ? b.createdAt.slice(0, 10) : ""]));
    return rows;
  }
  function journalCsvText(entries, backlog, accomplishments) {
    return journalCsvRows(entries, backlog, accomplishments).map((r) => r.map(csvEsc).join(",")).join("\n");
  }

  // The Notes tab's three kinds in one sheet. Columns a kind has no use for
  // stay empty. A habit's history rides in one cell — its marked days, each
  // with "*n" when it was done more than once — so a re-import keeps the
  // streaks; "Done" is when a to-do was ticked or a habit archived.
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // A quote's author and source, and a list's items (one per line, "[x] "
  // when ticked), ride in three columns on the end (0.195.0), so a sheet
  // from before them still reads; a plain note's title (0.199.0) after them.
  const LIST_KIND = { list: "Checklist", quote: "Quote" };
  function notesCsvRows(notes, habits) {
    const rows = [["Kind", "Date", "Category", "Text", "Done", "Days", "Target", "Marks", "Color", "Author", "Source", "Items", "Favourite", "Title"]];
    (notes || []).forEach((n) => rows.push([LIST_KIND[n.kind] || "Note", n.createdAt || "", n.category || "", n.text, "", "", "", "", "",
      n.author || "", n.source || "", (n.items || []).map((i) => (i.done ? "[x] " : "[ ] ") + i.text).join("\n"), n.fav ? "yes" : "", n.title || ""]));
    (habits || []).forEach((h) => rows.push(["Habit", h.startedAt || "", "", h.name, h.archivedAt || "",
      h.cadence && h.cadence.days ? h.cadence.days.map((d) => DAY_LABELS[d]).join(" ") : "daily",
      h.target || 1,
      Object.keys(h.marks || {}).sort().map((d) => (h.marks[d] > 1 ? d + "*" + h.marks[d] : d)).join(" "),
      h.color || ""]));
    return rows;
  }
  function notesCsvText(notes, habits) {
    return notesCsvRows(notes, habits).map((r) => r.map(csvEsc).join(",")).join("\n");
  }
  function parseNotesCsv(text) {
    const notes = [], todos = [], habits = [];
    const iso = (s) => { const d = new Date(s); return s && !isNaN(d) ? d.toISOString() : null; };
    for (const row of parseCsv(text)) {
      // "List" until 0.230.0, "Checklist" since: a sheet from either reads.
      const raw = (row[0] || "").trim().toLowerCase();
      const kind = raw === "checklist" ? "list" : raw;
      const txt = (row[3] || "").trim();
      // A list may be all items and no title.
      if (!txt && !((kind === "list" && (row[11] || "").trim()) || (kind === "note" && (row[13] || "").trim()))) continue;
      const date = (row[1] || "").trim(), done = (row[4] || "").trim();
      if (kind === "note" || kind === "quote" || kind === "list") {
        const n = { text: row[3], createdAt: iso(date) };
        if ((row[2] || "").trim()) n.category = row[2].trim();
        if ((row[12] || "").trim()) n.fav = true;
        if (kind === "note" && (row[13] || "").trim()) n.title = row[13].trim();
        if (kind === "quote") { n.kind = "quote"; n.author = (row[9] || "").trim(); n.source = (row[10] || "").trim(); }
        if (kind === "list") {
          n.kind = "list";
          n.items = String(row[11] || "").split("\n").map((l) => l.trim()).filter(Boolean)
            .map((l) => { const m = /^\[( |x|X)\]\s*(.*)$/.exec(l); return m ? { text: m[2], done: m[1] !== " " } : { text: l }; });
        }
        notes.push(n);
      }
      else if (kind === "to-do" || kind === "todo") {
        const t = { text: txt, createdAt: iso(date) };
        if ((row[2] || "").trim()) t.category = row[2].trim();
        if (done) { t.done = true; t.doneAt = iso(done); }
        todos.push(t);
      } else if (kind === "habit") {
        const days = (row[5] || "").trim().split(/\s+/).map((d) => DAY_LABELS.findIndex((l) => l.toLowerCase() === d.toLowerCase())).filter((i) => i >= 0);
        const marks = {};
        for (const m of (row[7] || "").trim().split(/\s+/).filter(Boolean)) {
          const [d, n] = m.split("*");
          marks[d] = +n || 1;
        }
        const h = { name: txt, target: +row[6] || 1, marks };
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) h.startedAt = date;
        if (days.length) h.cadence = { days };
        if (/^\d{4}-\d{2}-\d{2}$/.test(done)) h.archivedAt = done;
        if ((row[8] || "").trim()) h.color = row[8].trim();
        habits.push(h);
      }
    }
    if (!notes.length && !todos.length && !habits.length) throw new Error("No rows found — is this a Notes CSV export?");
    return { notes, todos, habits };
  }

  // Ledger's CSV is finance.js's own (it has a picker and reads the Sheets
  // pivot too); the other tabs' are here.
  function exportTabCsv(tab) {
    const d = state.data;
    if (tab === "notes") return download("lifelog-notes.csv", notesCsvText(d.notes, d.habits), "text/csv");
    if (tab === "timeline") return download("lifelog-timeline.csv", journalCsvText(d.entries, [], d.accomplishments), "text/csv");
    if (tab === "backlog") return download("lifelog-backlog.csv", journalCsvText([], d.backlog), "text/csv");
    if (tab === "all") return download("lifelog.csv", allCsvText(d), "text/csv");
  }

  // Everything in one CSV: a CSV has one sheet, so it's the three sheets one
  // under another — Notes, then Timeline and Backlog, then Ledger — each
  // under its own header row, a blank line between. The import splits it
  // back at those headers, so each block goes to the parser that wrote it.
  function allCsvText(d) {
    return [
      notesCsvText(d.notes, d.habits),
      journalCsvText(d.entries, d.backlog, d.accomplishments),
      window.LifeLogFinance.financeCsvText(d.financeEntries, d.recurringExpenses),
    ].join("\n\n");
  }
  function parseAllCsv(text) {
    const blocks = [];
    for (const row of parseCsv(text)) {
      if (String(row[0]).trim().toLowerCase() === "kind") blocks.push([]);
      if (blocks.length) blocks[blocks.length - 1].push(row);
    }
    const out = {};
    for (const rows of blocks) {
      const h = rows[0].map((c) => String(c).trim().toLowerCase());
      const text = rows.map((r) => r.map(csvEsc).join(",")).join("\n");
      const parse = h[1] === "year" ? parseJournalCsv
        : h[2] === "amount" ? (t) => window.LifeLogFinance.parseFlatFinanceCsv(t)
        : h[2] === "category" ? parseNotesCsv : null;
      if (!parse || rows.length < 2) continue;
      Object.assign(out, parse(text));
    }
    if (!Object.keys(out).length) throw new Error("No rows found — is this a LifeLog CSV export?");
    return out;
  }
  let MONTH_NAME_TO_NUM;
  function parseJournalCsv(text) {
    if (!MONTH_NAME_TO_NUM) {
      MONTH_NAME_TO_NUM = MONTHS.reduce((m, name, i) => { if (name) m[name.toLowerCase()] = i; return m; }, {});
    }
    const rows = parseCsv(text);
    const entries = [];
    const backlog = [];
    const accomplishments = {};
    for (const row of rows) {
      const kind = (row[0] || "").trim().toLowerCase();
      if (kind !== "entry" && kind !== "backlog" && kind !== "achievement") continue; // skips header row + blank lines
      const category = (row[3] || "Other").trim() || "Other";
      const title = (row[4] || "").trim();
      const createdAt = (row[5] || "").trim();
      if (!title) continue;
      if (kind === "achievement") {
        const year = parseInt(row[1], 10);
        if (!year) continue;
        (accomplishments[year] = accomplishments[year] || []).push({ text: title, createdAt: createdAt ? new Date(createdAt).toISOString() : null });
      } else if (kind === "entry") {
        const year = parseInt(row[1], 10);
        const month = MONTH_NAME_TO_NUM[(row[2] || "").trim().toLowerCase()];
        if (!year || !month) continue;
        entries.push({ title, category, year, month, createdAt: createdAt ? new Date(createdAt).toISOString() : null });
      } else {
        backlog.push({ title, category, createdAt: createdAt ? new Date(createdAt).toISOString() : null });
      }
    }
    if (!entries.length && !backlog.length && !Object.keys(accomplishments).length) throw new Error("No rows found — is this a Timeline or Backlog CSV export?");
    return { entries, backlog, accomplishments };
  }

  // ---------- unified import review ----------
  // Builds the mixed-kind item list + new-category list for the picker,
  // scoped to "journal" (entries/backlog), "finance" (finance/recurring), or
  // "all" (everything) — shared by every JSON/CSV importer below.
  // `scope` says which list a name belongs to: "journal", "finance", "note"
  // (notes' own categories) or "project", which is read off the
  // items' `project` field rather than `category`.
  function buildNewCategoryList(items, incomingCats, knownCategories, scope, field = "category") {
    const known = new Set((knownCategories || []).map((c) => c.name));
    const srcByName = {};
    for (const c of incomingCats || []) if (c && c.name) srcByName[c.name] = c;
    const names = new Set(Object.keys(srcByName));
    for (const it of items) if (it.entry[field]) names.add(it.entry[field]);
    const out = [];
    let pi = 0;
    names.forEach((name) => {
      if (known.has(name)) return;
      const src = srcByName[name];
      out.push({ name, color: (src && src.color) || CATEGORY_PALETTE[pi++ % CATEGORY_PALETTE.length], scope, src, add: true });
    });
    return out;
  }
  // Which of an incoming record's fields the thing you already have is
  // *missing*. Never a field that already holds something: an import fills
  // gaps and does not overwrite, so a title you corrected or a cover you
  // picked can't be reverted by re-running a sync. Pinned fields (the
  // Advanced foldout) are skipped even when empty — pinning is a statement
  // that this field is yours to set.
  //
  // One table per kind, because the answer to "what could an import add"
  // depends entirely on what the duplicate check already matched on. There is
  // deliberately no `finance` table: financeKey spans date, amount, category,
  // note, project, currency and fxAmount, which is every field a finance
  // entry has bar `rate` — which cannot be missing when a currency is set,
  // since sanitizeFinanceEntry drops the trio otherwise — and the
  // `rateConfirmed` flag, which is a claim about a rate rather than a gap in
  // one. A finance duplicate has nothing to fill, so it stays a plain
  // duplicate instead of an update row that would always read "+ nothing".
  const IMPORT_FILLABLE = {
    backlog: [
      ["coverUrl", "cover"],
      ["externalRating", "rating"],
      ["length", "length"],
      ["releaseYear", "year"],
      ["releaseDate", "release date"],
      ["releaseStatus", "release status"],
      ["summary", "description"],
      ["genres", "genres"],
      ["mediaSource", "media link"],
    ],
    // Only what sanitizeEntry actually keeps (KNOWN_ENTRY_KEYS). An entry has
    // no externalRating/release*/summary — offering those would write fields
    // nothing in the app ever reads back. `rating` and `notes` are yours
    // rather than a source's, which is exactly why restoring them from a
    // backup is worth offering; gap-only means neither can overwrite what
    // you wrote.
    entry: [
      ["coverUrl", "cover"],
      ["length", "length"],
      ["genres", "genres"],
      ["rating", "your rating"],
      ["notes", "your notes"],
      ["startYear", "month span"],
      ["mediaSource", "media link"],
    ],
    // recurringKey matches on startDate, interval, amount, category and note,
    // so everything that makes a plan more than its bare shape is outside it
    // and can go missing on a restore.
    recurring: [
      ["endDate", "end date"],
      ["project", "project"],
      ["pauses", "pauses"],
      ["overrides", "per-month changes"],
      ["prevId", "plan history"],
      ["extras", "one-off charges"],
    ],
  };

  // Fields that only mean anything together: filling one half would leave an
  // id with no source to resolve it against, or a span with no start month.
  const FIELD_PAIR = { mediaSource: "mediaId", startYear: "startMonth" };

  const isEmptyField = (v) => v == null || v === ""
    || (Array.isArray(v) && !v.length)
    || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

  // The Advanced foldout's pin names don't all match the field they pin.
  const overrideKeyFor = (key) => (key === "coverUrl" ? "cover" : key);

  // A pair is only fillable when the incoming record has both halves and the
  // local one has neither — a half-filled pair is worse than an empty one.
  function pairBlocked(key, target, incoming) {
    const other = FIELD_PAIR[key];
    return !!other && (isEmptyField(incoming[other]) || !isEmptyField(target[other]));
  }

  // Whether a local item is missing anything an import could fill. Asked
  // before a source spends a slow per-item lookup on something it already
  // has: a complete item has nothing to gain, an incomplete one might.
  function importItemIncomplete(target, kind) {
    return (IMPORT_FILLABLE[kind || "backlog"] || []).some(([key]) => {
      if (!isEmptyField(target[key])) return false;
      if (isOverridden && isOverridden(target, overrideKeyFor(key))) return false;
      if (FIELD_PAIR[key] && !isEmptyField(target[FIELD_PAIR[key]])) return false;
      return true;
    });
  }

  function fillableFields(target, incoming, kind) {
    const out = [];
    for (const [key, label] of IMPORT_FILLABLE[kind || "backlog"] || []) {
      if (isEmptyField(incoming[key])) continue;
      if (!isEmptyField(target[key])) continue;
      if (isOverridden && isOverridden(target, overrideKeyFor(key))) continue;
      if (pairBlocked(key, target, incoming)) continue;
      out.push({ key, label });
    }
    return out;
  }

  const titleCatKey = (title, category) =>
    `${(title || "").toLowerCase()}|${(category || "").toLowerCase()}`;
  const entryKey = (e) => `${titleCatKey(e.title, e.category)}|${+e.year}|${+e.month}`;

  // The record an incoming one is a duplicate of, found the same way
  // buildImportItems decided it was one — so the thing that gets updated is
  // always the thing that caused the row to be called a duplicate.
  //
  // Returns { item, kind } rather than tagging the item: these are the live
  // records out of state, and a marker property stuck on one would be
  // persisted, synced, and carried through keepUnknown forever.
  function findImportTarget(rec, kind) {
    if (kind === "entry") {
      const k = entryKey(rec);
      const hit = state.data.entries.find((x) => entryKey(x) === k);
      return hit ? { item: hit, kind: "entry" } : null;
    }
    if (kind === "recurring") {
      const k = recurringKey(rec);
      const hit = state.data.recurringExpenses.find((x) => recurringKey(x) === k);
      return hit ? { item: hit, kind: "recurring" } : null;
    }
    // Backlog, by the same three identities as its dup check — strongest
    // first, so a locally renamed item still matches on its media id, and a
    // wishlist row can land on something already in your timeline.
    if (rec.mediaSource && rec.mediaId) {
      const inBacklog = state.data.backlog.find((x) => x.mediaSource === rec.mediaSource && x.mediaId === rec.mediaId);
      if (inBacklog) return { item: inBacklog, kind: "backlog" };
      const inEntries = state.data.entries.find((x) => x.mediaSource === rec.mediaSource && x.mediaId === rec.mediaId);
      if (inEntries) return { item: inEntries, kind: "entry" };
    }
    const k = titleCatKey(rec.title, rec.category);
    const byTitle = state.data.backlog.find((x) => titleCatKey(x.title, x.category) === k);
    if (byTitle) return { item: byTitle, kind: "backlog" };
    const inJournal = state.data.entries.find((x) => titleCatKey(x.title, x.category) === k);
    return inJournal ? { item: inJournal, kind: "entry" } : null;
  }

  // One shape for every kind: a duplicate that could gain something becomes a
  // ticked update row naming what; one that couldn't stays a plain duplicate.
  function buildImportRow(kind, rec, dup, extra) {
    const found = dup ? findImportTarget(rec, kind) : null;
    const fills = found ? fillableFields(found.item, rec, found.kind) : [];
    if (found && fills.length) {
      return Object.assign({
        kind, entry: rec, dup: true, update: true,
        targetId: found.item.id, targetKind: found.kind, fills, checked: true,
      }, extra);
    }
    return Object.assign({ kind, entry: rec, dup, checked: !dup }, extra);
  }

  // `kinds`, when given, keeps only those kinds out of the file (a tab's
  // import); without it everything in the file is offered.
  function buildImportItems(incoming, kinds) {
    const want = (k) => !kinds || kinds.includes(k);
    const pick = (k, list) => (want(k) ? list || [] : []);
    const entries = pick("entry", incoming.entries), backlog = pick("backlog", incoming.backlog);
    const financeEntries = pick("finance", incoming.financeEntries), recurringExpenses = pick("recurring", incoming.recurringExpenses);
    const { categories, financeCategories } = incoming;
    const items = [];
    const backlogKey = (b) => titleCatKey(b.title, b.category);
    const existingEntryKeys = new Set(state.data.entries.map(entryKey));
    const existingBacklogKeys = new Set(state.data.backlog.map(backlogKey));
    const existingFinanceKeys = new Set(state.data.financeEntries.map(financeKey));
    const existingRecurKeys = new Set(state.data.recurringExpenses.map(recurringKey));
    // A wishlisted game already logged as finished in the Journal (title
    // match, ignoring year/month/date since a backlog item has none of
    // those yet) is just as much a duplicate as one already sitting in
    // the backlog — same check the single-item add form already does
    // (updateBacklogDuplicateBanner) that bulk import was missing.
    const existingEntryTitleKeys = new Set(state.data.entries.map((e) => titleCatKey(e.title, e.category)));
    // A synced item's media source+id is a stronger identity than its title —
    // catches an imported item (Steam wishlist, AniList Planning) whose title
    // was edited locally after an earlier import, which a plain title/category
    // match would otherwise treat as new again. Keyed by "<source>:<id>" and
    // checked against both the backlog and the Journal, so it works uniformly
    // for every source, not just Steam.
    const existingMediaIds = new Set(
      [...state.data.backlog, ...state.data.entries]
        .filter((x) => x.mediaSource && x.mediaId)
        .map((x) => x.mediaSource + ":" + x.mediaId)
    );

    (entries || []).map(sanitizeEntry).forEach((e) => {
      items.push(buildImportRow("entry", e, existingEntryKeys.has(entryKey(e))));
    });
    (backlog || []).forEach((raw) => {
      const b = sanitizeBacklog(raw);
      // Boolean-wrapped because the last term short-circuits on an empty
      // mediaSource and would otherwise leave dup as "" — truthy-correct but
      // a lie to anything that reads the flag rather than tests it.
      const dup = !!(existingBacklogKeys.has(backlogKey(b)) ||
        existingEntryTitleKeys.has(titleCatKey(b.title, b.category)) ||
        (b.mediaSource && b.mediaId && existingMediaIds.has(b.mediaSource + ":" + b.mediaId)));
      // A duplicate used to be the end of the story: hidden, skipped, and the
      // sync could never enrich anything you already had. Now it is asked
      // what it could *add* — a cover you have no cover for, a rating you
      // have no rating for — and offered as an update when the answer isn't
      // "nothing". One that can't add anything stays a plain duplicate.
      items.push(buildImportRow("backlog", b, dup, { unresolved: !!raw.unresolved }));
    });
    // No update path: see IMPORT_FILLABLE — financeKey already spans every
    // field a finance entry has that could be missing.
    (financeEntries || []).map(sanitizeFinanceEntry).forEach((f) => {
      const dup = existingFinanceKeys.has(financeKey(f));
      items.push({ kind: "finance", entry: f, dup, checked: !dup });
    });
    (recurringExpenses || []).map(sanitizeRecurring).forEach((r) => {
      items.push(buildImportRow("recurring", r, existingRecurKeys.has(recurringKey(r))));
    });

    // The rest are matched on what you'd call them: a note's words, a
    // to-do's words in its list, a habit's name, an achievement's text in its
    // year. Or on id, which catches the same item edited since the file was
    // made — that's an item you already have, not a new one.
    const low = (s) => String(s == null ? "" : s).trim().toLowerCase();
    const simple = (kind, list, sanitize, label, key, existing) => {
      const ids = new Set(existing.map((x) => x.id)), keys = new Set(existing.map(key));
      for (const raw of list) {
        const rec = sanitize(raw);
        if (!low(label(rec))) continue;
        const dup = ids.has(rec.id) || keys.has(key(rec));
        items.push({ kind, entry: rec, dup, checked: !dup });
      }
    };
    // A checklist can be items and no title, so its items are part of what
    // it's called and what it matches on.
    const noteWords = (n) => [n.title, n.text, ...(n.items || []).map((i) => i.text)].filter(Boolean).join("\n");
    if (want("note")) simple("note", incoming.notes || [], sanitizeNote, noteWords, (n) => low(noteWords(n)), state.data.notes || []);
    // A to-do you already have is an item of a list note now (0.197.0): the
    // same id, or the same words in the list its category became.
    const asTodos = (state.data.notes || []).filter((n) => n.kind === "list")
      .flatMap((n) => (n.items || []).map((i) => ({ id: i.id, text: i.text, category: n.text === "To-do" ? "" : n.text })));
    if (want("todo")) simple("todo", incoming.todos || [], sanitizeTodo, (t) => t.text, (t) => low(t.category) + "|" + low(t.text), asTodos);
    if (want("habit")) simple("habit", incoming.habits || [], sanitizeHabit, (h) => h.name, (h) => low(h.name), state.data.habits || []);
    // Names like "Board 3" repeat across devices, so a board matches on its
    // name and how much is on it, or on id.
    if (want("board") && sanitizeBoard) simple("board", incoming.boards || [], sanitizeBoard, (b) => b.name,
      (b) => low(b.name) + "|" + b.elements.length, boardsNow ? boardsNow() : []);
    if (want("achievement")) {
      const have = state.data.accomplishments || {};
      for (const [y, list] of Object.entries(incoming.accomplishments || {})) {
        const keys = new Set((have[y] || []).map((a) => low(a.text)));
        const ids = new Set((have[y] || []).map((a) => a.id));
        for (const a of list || []) {
          const rec = typeof a === "string" ? { text: a, createdAt: null } : { ...a };
          if (!low(rec.text)) continue;
          const dup = keys.has(low(rec.text)) || (!!rec.id && ids.has(rec.id));
          items.push({ kind: "achievement", entry: rec, year: +y, dup, checked: !dup });
        }
      }
    }

    const of = (...ks) => items.filter((i) => ks.includes(i.kind));
    const newCategories = [
      ...buildNewCategoryList(of("entry", "backlog"), want("entry") || want("backlog") ? categories : [], state.data.categories, "journal"),
      ...buildNewCategoryList(of("finance", "recurring"), want("finance") || want("recurring") ? financeCategories : [], state.data.financeCategories, "finance"),
      ...buildNewCategoryList(of("note"), want("note") ? incoming.noteCategories : [], state.data.noteCategories, "note"),
      ...buildNewCategoryList(of("finance", "recurring"), want("finance") || want("recurring") ? incoming.projects : [], state.data.projects, "project", "project"),
    ];
    return { items, newCategories };
  }
  // applies a confirmed picker selection: registers opted-in new categories,
  // pushes each selected item into its matching state array, and reports a
  // single summary toast across every kind that was touched
  async function applyImportSelection(selected, addCats) {
    if (!selected.length) { toast("Nothing selected"); return; }
    const d = state.data;
    // Everything this import does, so Undo in the toast can take exactly it
    // back (0.256.0): ids added per list, categories and projects created,
    // and each filled field's previous value.
    const undo = { added: {}, ach: [], cats: [], projects: [], updates: [] };
    for (const c of addCats) {
      if (c.scope === "project") {
        d.projects = d.projects || [];
        if (d.projects.some((x) => x.name === c.name)) continue;
        const p = sanitizeProject({ ...(c.src || {}), name: c.name, color: c.color });
        if (d.projects.some((x) => x.id === p.id)) p.id = uid();
        d.projects.push(p);
        undo.projects.push(p.id);
        continue;
      }
      const target = c.scope === "finance" ? d.financeCategories
        : c.scope === "note" ? (d.noteCategories = d.noteCategories || [])
        : d.categories;
      if (!target.some((x) => x.name === c.name)) { target.push({ id: c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: c.name, color: c.color }); undo.cats.push({ scope: c.scope, name: c.name }); }
    }
    // Updates are applied in place against the item they matched; only the
    // rest are new rows. Split before anything is pushed, or an update would
    // be added as a second copy of what it was meant to enrich.
    const updates = selected.filter((i) => i.update);
    let filled = 0;
    const POOL = {
      entry: () => state.data.entries,
      backlog: () => state.data.backlog,
      recurring: () => state.data.recurringExpenses,
    };
    for (const u of updates) {
      const pool = (POOL[u.targetKind] || POOL.backlog)();
      const target = pool.find((x) => x.id === u.targetId);
      if (!target) continue;
      const prev = {};
      for (const f of u.fills) {
        const v = u.entry[f.key];
        if (isEmptyField(v)) continue;
        if (!(f.key in prev)) prev[f.key] = target[f.key];
        target[f.key] = Array.isArray(v) ? v.slice() : v;
        // A paired field travels with its other half — an id with no source
        // to resolve it against, or a span with no start month, is worse than
        // the gap it filled.
        const other = FIELD_PAIR[f.key];
        if (other && !isEmptyField(u.entry[other])) { if (!(other in prev)) prev[other] = target[other]; target[other] = u.entry[other]; }
        filled++;
      }
      undo.updates.push({ targetKind: u.targetKind, targetId: u.targetId, prev });
      // No updatedAt stamp here on purpose: persist() runs
      // merge.stampChangedItems first, which times every item whose content
      // actually changed. Touching it by hand would be the manual "touch"
      // call that function exists to make unnecessary.
    }
    const byKind = { entry: [], backlog: [], finance: [], recurring: [], note: [], todo: [], habit: [], achievement: [], board: [] };
    selected.filter((i) => !i.update).forEach((i) => byKind[i.kind].push(i));
    // A new item whose id is already taken — the same item, changed since the
    // file was made, re-imported as a copy on purpose — gets an id of its own:
    // two items sharing one would be folded into one by the next sync.
    const add = (list, recs, name) => {
      const ids = new Set(list.map((x) => x.id));
      for (const r of recs) {
        if (!r.id || ids.has(r.id)) r.id = uid();
        ids.add(r.id);
        list.push(r);
      }
      if (name && recs.length) undo.added[name] = recs.map((r) => r.id);
    };
    const recs = (k) => byKind[k].map((i) => i.entry);
    // Hand-ordered lists: what comes in goes after what's there.
    const after = (list, k) => {
      let n = list.reduce((m, x) => Math.max(m, +x.order || 0), 0);
      return recs(k).map((r) => ({ ...r, order: ++n }));
    };
    add(d.entries, recs("entry"), "entries");
    add(d.backlog, recs("backlog"), "backlog");
    add(d.financeEntries, recs("finance"), "financeEntries");
    add(d.recurringExpenses, recs("recurring"), "recurringExpenses");
    add(d.notes = d.notes || [], recs("note"), "notes");
    add(d.todos = d.todos || [], after(d.todos, "todo"));
    add(d.habits = d.habits || [], after(d.habits, "habit"), "habits");
    d.accomplishments = d.accomplishments || {};
    for (const i of byKind.achievement) {
      const list = d.accomplishments[i.year] = d.accomplishments[i.year] || [];
      add(list, [i.entry]);
      undo.ach.push({ year: i.year, id: i.entry.id });
    }
    ensureCategories(d.categories, [...recs("entry"), ...recs("backlog")]);
    ensureCategories(d.financeCategories, [...recs("finance"), ...recs("recurring")]);
    ensureCategories(d.noteCategories = d.noteCategories || [], recs("note").filter((n) => n.category));
    // To-dos from an older file land in their list notes (0.197.0), the way
    // they do when an older device syncs them; a to-do category is the name
    // of its list, not a category to add.
    const Notes = window.LifeLogNotes;
    if (byKind.todo.length && Notes && Notes.foldTodosIntoLists(d)) d.notes = d.notes.map(sanitizeNote);
    delete d.todos;
    if (ensureProjects) ensureProjects(d.projects = d.projects || [], [...recs("finance"), ...recs("recurring")]);
    if (byKind.board.length && addBoards) { await addBoards(recs("board")); undo.boards = recs("board").map((b) => b.id); }

    afterDataChange();
    await persist();
    const parts = [];
    const count = (k, one, many) => { const n = byKind[k].length; if (n) parts.push(n + " " + (n === 1 ? one : many)); };
    count("entry", "entry", "entries");
    count("achievement", "achievement", "achievements");
    count("backlog", "backlog item", "backlog items");
    count("note", "note", "notes");
    count("todo", "checklist item", "checklist items");
    count("habit", "habit", "habits");
    count("board", "board", "boards");
    count("finance", "finance entry", "finance entries");
    count("recurring", "recurring expense", "recurring expenses");
    if (updates.length) {
      parts.push(`filled ${filled} field${filled === 1 ? "" : "s"} on ${updates.length} existing item${updates.length === 1 ? "" : "s"}`);
    }
    if (!parts.length) { toast("Nothing to import"); return; }
    // To-dos from an older file were folded into their list notes, which
    // rewrites notes this import didn't add; that one isn't offered Undo.
    const canUndo = !byKind.todo.length && (!undo.boards || deleteBoards);
    toast(`Imported ${parts.join(", ")}`, false, canUndo ? { label: "Undo", onClick: () => undoImport(undo) } : undefined);
  }
  // Takes one import back: what it added goes, what it filled in returns to
  // what it was, and a category or project it created goes if nothing uses
  // it now (something else may have been filed there since).
  async function undoImport(undo) {
    const d = state.data;
    for (const [name, ids] of Object.entries(undo.added)) {
      const gone = new Set(ids);
      if (Array.isArray(d[name])) d[name] = d[name].filter((x) => !gone.has(x.id));
    }
    for (const a of undo.ach) {
      const list = (d.accomplishments || {})[a.year];
      if (list) d.accomplishments[a.year] = list.filter((x) => x.id !== a.id);
    }
    const POOL = { entry: d.entries, backlog: d.backlog, recurring: d.recurringExpenses };
    for (const u of undo.updates) {
      const target = (POOL[u.targetKind] || d.backlog).find((x) => x.id === u.targetId);
      if (!target) continue;
      for (const [k, v] of Object.entries(u.prev)) { if (v === undefined) delete target[k]; else target[k] = v; }
    }
    const used = (scope, name) => (scope === "finance" ? [...d.financeEntries, ...d.recurringExpenses]
      : scope === "note" ? (d.notes || []) : [...d.entries, ...d.backlog]).some((x) => x.category === name);
    for (const c of undo.cats) {
      if (used(c.scope, c.name)) continue;
      const list = c.scope === "finance" ? d.financeCategories : c.scope === "note" ? d.noteCategories : d.categories;
      const at = list.findIndex((x) => x.name === c.name);
      if (at >= 0) list.splice(at, 1);
    }
    if (undo.projects.length) {
      const inUse = new Set([...d.financeEntries, ...d.recurringExpenses].map((x) => x.project).filter(Boolean));
      d.projects = (d.projects || []).filter((p) => !undo.projects.includes(p.id) || inUse.has(p.id) || inUse.has(p.name));
    }
    if (undo.boards && deleteBoards) await deleteBoards(undo.boards);
    afterDataChange();
    await persist();
    toast("Import undone");
  }

  // `opts` (0.255.0) passes the picker's extras through: `threshold` is a
  // source's "at least N" slider (the Steam backfill's play time).
  function reviewAndImport(title, hint, built, extraOnConfirm, opts) {
    if (!built.items.length) { toast("No items found in this file"); return; }
    openImportPicker({
      title, hint, mode: "import", items: built.items, newCategories: built.newCategories,
      confirmLabel: "Import", ...(opts || {}),
      onConfirm: async (selected, addCats) => {
        await applyImportSelection(selected, addCats);
        if (extraOnConfirm) await extraOnConfirm(selected);
      },
    });
  }
  const IMPORT_HINT = "Review what to bring in — pick individual items, toggle whole periods on/off, and choose which new categories to add. Items already in your data are hidden by default.";
  // ---------- Markdown files as notes (0.200.0) ----------
  // One file, one note. The title is the front matter's `title`, else a
  // leading "# heading", else the file's name; a file that's nothing but
  // "- [ ]" tasks is a list, and one that's nothing but "> " lines a quote
  // (a last "— Name" line its author). The date is the front matter's
  // `date` or `created`, else when the file was last changed; `category`
  // there files it. The words stay as the Markdown they were written in.
  const MD_TASK = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
  function parseMarkdownNote(text, fileName, lastModified) {
    let body = String(text == null ? "" : text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const meta = {};
    const fm = /^---\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(body);
    if (fm) {
      body = body.slice(fm[0].length);
      for (const line of fm[1].split("\n")) {
        const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
      }
    }
    const lines = body.split("\n");
    let title = meta.title || "";
    const first = lines.findIndex((l) => l.trim());
    const heading = first >= 0 ? /^#\s+(.+?)\s*#*$/.exec(lines[first].trim()) : null;
    if (heading && (!title || heading[1] === title)) { title = heading[1]; lines.splice(first, 1); }
    if (!title) title = String(fileName || "").replace(/^.*[\\/]/, "").replace(/\.(md|markdown|txt)$/i, "").trim();
    const words = lines.join("\n").trim();
    const filled = words.split("\n").filter((l) => l.trim());

    const when = new Date(meta.date || meta.created || lastModified || NaN);
    const note = { createdAt: isNaN(when) ? null : when.toISOString() };
    if (meta.category) note.category = meta.category;
    if (filled.length && filled.every((l) => MD_TASK.test(l))) {
      return { ...note, kind: "list", text: title,
        items: filled.map((l) => { const m = MD_TASK.exec(l); return m[1] === " " ? { text: m[2].trim() } : { text: m[2].trim(), done: true }; }) };
    }
    if (filled.length && filled.every((l) => /^\s*>/.test(l))) {
      const quoted = filled.map((l) => l.replace(/^\s*>\s?/, ""));
      const by = /^\s*(?:—|–|--?)\s*(.+)$/.exec(quoted[quoted.length - 1]);
      if (by && quoted.length > 1) quoted.pop();
      const q = { ...note, kind: "quote", text: quoted.join("\n").trim() };
      if (by && quoted.length) q.author = by[1].trim();
      return q;
    }
    return { ...note, title, text: words };
  }
  const MD_HINT = "One note per file. Pick which to bring in, and put any of them in a category: select them, choose it below, Apply. Files already in your notes are hidden.";
  // `files` are browser Files, or what the Android app's folder picker
  // hands back (0.202.0): { name, folder, text, lastModified }.
  //
  // A PDF or EPUB (0.236.0) comes in as its text, by docimport.js, and is
  // refused past DOC_MAX characters: every note lives in the one data file
  // that syncs on each save and is cached in localStorage, and a whole book
  // there would make every save slow and could outgrow the cache.
  const DOC_MAX = 300000;
  const isDoc = (name) => /\.(pdf|epub)$/i.test(name);
  async function importMarkdown(files) {
    const picked = [...files].filter((f) => /\.(md|markdown|txt)$/i.test(f.name) || (isDoc(f.name) && typeof f.arrayBuffer === "function"));
    if (!picked.length) { toast("No Markdown, PDF or EPUB files in that selection", true); return; }
    // Only notes with something in them, so the rows buildImportItems hands
    // back line up one to one with these and each can be told its folder.
    const notes = [], folders = [], failed = [];
    if (picked.some((f) => isDoc(f.name))) toast("Reading " + (picked.length === 1 ? picked[0].name : picked.length + " files") + "…");
    for (const f of picked) {
      let n;
      if (isDoc(f.name)) {
        try {
          n = await window.LifeLogDocImport.fileToNote(new Uint8Array(await f.arrayBuffer()), f.name, f.lastModified);
          if (n.text.length > DOC_MAX) throw new Error(`It's too long to keep as a note (${Math.round(n.text.length / 1000)}k characters, the limit is ${DOC_MAX / 1000}k)`);
        } catch (err) { failed.push(f.name + ": " + (err.message || err)); continue; }
      } else {
        const text = typeof f.text === "function" ? await f.text() : f.text;
        n = parseMarkdownNote(text, f.name, f.lastModified);
      }
      if (n.items) n.items = n.items.filter((i) => i.text);
      if (!(n.title || n.text || (n.items || []).length)) continue;
      const parts = String(f.webkitRelativePath || "").split("/");
      folders.push(typeof f.folder === "string" ? f.folder : parts.length > 2 ? parts[parts.length - 2] : "");
      notes.push(n);
    }
    // One file that can't be read says why; several say how many and the
    // first reason, and the rest still come in.
    if (failed.length && !notes.length) { toast(failed.length === 1 ? failed[0] : `None of those ${failed.length} files could be read. ${failed[0]}`, true); return; }
    if (failed.length) toast(`${failed.length} file${failed.length === 1 ? "" : "s"} couldn't be read. ${failed[0]}`, true);
    if (!notes.length) { toast("Those files are empty", true); return; }
    const built = buildImportItems({ notes }, ["note"]);
    if (built.items.length === notes.length) built.items.forEach((it, i) => { it.folder = folders[i]; });
    const n = notes.length;
    openImportPicker({
      title: `Import ${n} file${n === 1 ? "" : "s"}`,
      hint: MD_HINT, mode: "import", items: built.items, newCategories: built.newCategories,
      confirmLabel: "Import", searchable: picked.length > 8, categorize: "note",
      onConfirm: applyImportSelection,
    });
  }

  function readFile(file, then) {
    const reader = new FileReader();
    reader.onload = () => {
      Promise.resolve().then(() => then(reader.result)).catch((e) => toast("Import failed: " + (e.message || e), true));
    };
    reader.readAsText(file);
  }
  // A whole backup (tab omitted) or one tab's share of any LifeLog JSON —
  // a tab's own export, a full backup, or the older Journal/Finance files.
  function importJson(file, tab) {
    readFile(file, async (text) => {
      const incoming = JSON.parse(text);
      // What boards you already have, so a re-import of one is a duplicate.
      if (Array.isArray(incoming.boards) && boardsForExport) await boardsForExport();
      if (!incoming || typeof incoming !== "object") throw new Error("not a LifeLog file");
      const built = buildImportItems(incoming, tab ? TAB_KINDS[tab] : null);
      if (!built.items.length) throw new Error(tab ? "no " + TAB_LABEL[tab] + " data in this file" : "not a LifeLog file");
      reviewAndImport(tab ? "Import " + TAB_LABEL[tab] : "Import full backup", IMPORT_HINT, built);
    });
  }
  function importTabCsv(file, tab) {
    readFile(file, (text) => {
      const incoming = tab === "all" ? parseAllCsv(text) : tab === "notes" ? parseNotesCsv(text) : parseJournalCsv(text);
      const built = buildImportItems(incoming, TAB_KINDS[tab]);
      if (!built.items.length) throw new Error("no " + TAB_LABEL[tab] + " rows in this file");
      reviewAndImport("Import " + TAB_LABEL[tab] + " CSV", IMPORT_HINT, built);
    });
  }
  // parses CSV text into rows of cells, honoring quoted fields (with
  // "" escapes) that may contain commas or newlines — needed because
  // money cells like "₪1,302.00" are quoted due to the embedded comma
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n") {
        row.push(field); field = ""; rows.push(row); row = [];
      } else if (c === "\r") {
        // ignore; \n follows
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  // ---------- shared import/export review picker ----------
  // Used by every importer/exporter above. Items are { kind, entry, dup,
  // checked } where kind is "entry" (journal), "backlog", "finance", or
  // "recurring" — rendered with a kind-appropriate row, grouped into
  // year/month "period" chips that bulk-toggle their items on/off, with an
  // optional "new categories found" checklist shown above the list (import
  // only).
  function importItemDateStr(item) {
    const e = item.entry;
    if (item.kind === "finance") return e.date || "";
    if (item.kind === "entry") return `${e.year}-${String(e.month).padStart(2, "0")}`;
    if (item.kind === "recurring") return e.startDate || "";
    if (item.kind === "note") return (e.createdAt || "").slice(0, 10);
    if (item.kind === "board") return (e.updatedAt || "").slice(0, 10);
    return ""; // backlog, to-dos, habits and achievements have no month to group by
  }
  function importBucketKey(item) {
    const ds = importItemDateStr(item);
    if (!ds) return null;
    return ds.slice(0, 7);
  }
  function importBucketLabel(key) {
    const [y, m] = key.split("-");
    return `${MONTHS_SHORT[+m]} ${y}`;
  }
  // What a value looks like in the review (0.258.0): a rating as stars,
  // text cut short, a list joined, a URL as the one word it is.
  function fillValueText(key, v) {
    if (key === "rating") return "★".repeat(+v || 0);
    if (/url$/i.test(key)) return key === "coverUrl" ? "a cover" : "a link";
    if (Array.isArray(v)) return v.join(", ");
    const t = String(v == null ? "" : v);
    return t.length > 60 ? t.slice(0, 57) + "…" : t;
  }
  function importRowFor(item, onChange, onEdit) {
    const e = item.entry;
    const finance = item.kind === "finance" || item.kind === "recurring";
    const row = el("label", "entry picker-row"
      + (item.update ? " is-update" : (item.dup ? " is-dup" : ""))
      + (item.edited ? " is-edited" : "")
      + (finance ? " finance-entry" : ""));
    const cb = el("input"); cb.type = "checkbox"; cb.checked = item.checked;
    cb.onchange = () => { item.checked = cb.checked; onChange(); };
    row.appendChild(cb);
    const bar = el("div", "bar");
    bar.style.background = e.category ? (finance ? financeColorOf(e.category) : colorOf(e.category)) : "transparent";
    row.appendChild(bar);
    if (item.kind === "finance") {
      row.appendChild(el("span", "fdate", e.date));
      const t = el("span", "etitle", e.note || e.category); t.title = e.note || e.category; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      row.appendChild(el("span", "famount fnegative", formatMoney(e.amount)));
    } else if (item.kind === "recurring") {
      row.appendChild(el("span", "fdate", e.startDate));
      row.appendChild(el("span", "recur-badge")).appendChild(window.LifeLogIcons.labelled("repeat", e.interval));
      const t = el("span", "etitle", e.note || e.category); t.title = e.note || e.category; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      row.appendChild(el("span", "famount fnegative", "-" + formatMoney(e.amount)));
    } else if (item.kind === "entry") {
      row.appendChild(el("span", "fdate", `${MONTHS_SHORT[e.month]} ${e.year}`));
      const t = el("span", "etitle", e.title); t.title = e.title; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
    } else if (item.kind === "note" || item.kind === "todo" || item.kind === "habit" || item.kind === "achievement" || item.kind === "board") {
      const date = item.kind === "note" ? (e.createdAt || "").slice(0, 10)
        : item.kind === "board" ? (e.updatedAt || "").slice(0, 10)
        : item.kind === "achievement" ? String(item.year)
        : item.kind === "habit" ? (e.startedAt || "") : "—";
      row.appendChild(el("span", "fdate", date || "—"));
      const text = item.kind === "habit" || item.kind === "board" ? e.name
        : (e.title || e.text || (e.items || []).map((i) => i.text).join(", ")).split("\n")[0];
      const t = el("span", "etitle", (item.kind === "todo" && e.done ? "✓ " : "") + text); t.title = e.text || e.name; row.appendChild(t);
      if (e.category) row.appendChild(el("span", "ecat", e.category));
      const tag = item.kind === "note" && e.kind ? e.kind : { note: "note", todo: "checklist item", habit: "habit", achievement: "achievement", board: "board" }[item.kind];
      row.appendChild(el("span", "dup-tag", tag));
    } else { // backlog
      row.appendChild(el("span", "fdate", "—"));
      const t = el("span", "etitle", e.title); t.title = e.title; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      row.appendChild(el("span", "dup-tag", "backlog"));
    }
    // An update says what it would actually do, rather than "already added":
    // that phrase is true of the item and useless about the change.
    if (item.update) {
      // What the update writes, value by value (0.258.0): an update only
      // ever fills a field that is empty, so the "before" is always nothing,
      // and the tag says where the item is instead of repeating the list.
      const tag = el("span", "update-tag", "+ " + item.fills.length + (item.fills.length === 1 ? " field" : " fields"));
      tag.title = "Already in your " + (item.targetKind === "entry" ? "timeline" : "backlog")
        + " — this fills in what it's missing, and changes nothing it already has";
      row.appendChild(tag);
      const diff = el("div", "picker-fills");
      for (const f of item.fills) {
        if (isEmptyField(e[f.key])) continue;
        const line = el("span", "picker-fill");
        line.appendChild(el("span", "picker-fill-key", f.label));
        line.appendChild(el("span", "picker-fill-val", fillValueText(f.key, e[f.key])));
        diff.appendChild(line);
      }
      row.appendChild(diff);
    } else if (item.dup) row.appendChild(el("span", "dup-tag", "already added"));
    else if (item.edited) row.appendChild(el("span", "dup-tag", "edited"));
    if (onEdit && !item.dup) {
      const edit = el("button", "btn btn-icon picker-edit");
      edit.type = "button";
      edit.setAttribute("aria-label", "Edit before import");
      edit.title = "Edit before import";
      edit.appendChild(window.LifeLogIcons.svg("pencil"));
      edit.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); onEdit(item, row); };
      row.appendChild(edit);
    }
    return row;
  }
  // The row as a small form (0.258.0): title, when, category and rating as
  // the kind allows, written back into the item on Done. The categories
  // offered are the ones you have plus the ones this import is adding.
  const EDIT_FIELDS = {
    entry: ["title", "when", "category", "rating"],
    backlog: ["title", "category"],
    note: ["title", "category"],
    finance: ["note", "date", "category", "amount"],
    recurring: ["note", "startDate", "category", "amount"],
    habit: ["name"], board: ["name"], todo: ["text"], achievement: ["text"],
  };
  function importRowEditor(item, newCategories, onDone) {
    const e = item.entry;
    const fields = EDIT_FIELDS[item.kind] || ["title"];
    const form = el("form", "picker-editor");
    const inputs = {};
    const field = (key, label, input) => {
      const l = el("label", "picker-editor-field");
      l.appendChild(el("span", null, label));
      l.appendChild(input);
      inputs[key] = input;
      form.appendChild(l);
    };
    const text = (key, label) => { const i = el("input"); i.type = "text"; i.value = e[key] || ""; field(key, label, i); };
    const scope = item.kind === "note" ? "note" : (item.kind === "finance" || item.kind === "recurring") ? "finance" : "entry";
    const have = scope === "note" ? (state.data.noteCategories || []) : scope === "finance" ? state.data.financeCategories : state.data.categories;
    const names = new Set([...have.map((c) => c.name), ...newCategories.filter((c) => (c.scope === "journal" ? "entry" : c.scope) === scope).map((c) => c.name)]);
    if (e.category) names.add(e.category);
    for (const key of fields) {
      if (key === "title" || key === "note" || key === "name" || key === "text") text(key, key === "note" ? "Note" : key === "name" ? "Name" : key === "text" ? "Text" : "Title");
      else if (key === "when") {
        const y = el("input"); y.type = "number"; y.min = 1900; y.max = 2200; y.value = e.year || new Date().getFullYear();
        const m = el("select"); MONTHS.forEach((name, i) => { if (!i && !MONTHS[0]) return; const o = document.createElement("option"); o.value = i; o.textContent = name; if (i === +e.month) o.selected = true; m.appendChild(o); });
        const wrap = el("span", "picker-editor-when"); wrap.appendChild(m); wrap.appendChild(y);
        inputs.year = y; inputs.month = m;
        const l = el("label", "picker-editor-field"); l.appendChild(el("span", null, "When")); l.appendChild(wrap); form.appendChild(l);
      } else if (key === "date" || key === "startDate") { const i = el("input"); i.type = "date"; i.value = e[key] || ""; field(key, key === "date" ? "Date" : "Starts", i); }
      else if (key === "category") {
        const sel = el("select");
        const none = document.createElement("option"); none.value = ""; none.textContent = "No category"; sel.appendChild(none);
        for (const n of [...names].sort((a, b) => a.localeCompare(b))) { const o = document.createElement("option"); o.value = n; o.textContent = n; if (n === e.category) o.selected = true; sel.appendChild(o); }
        field("category", "Category", sel);
      } else if (key === "rating") {
        const sel = el("select");
        for (let r = 0; r <= 5; r++) { const o = document.createElement("option"); o.value = r; o.textContent = r ? "★".repeat(r) : "No rating"; if (r === (+e.rating || 0)) o.selected = true; sel.appendChild(o); }
        field("rating", "Rating", sel);
      } else if (key === "amount") { const i = el("input"); i.type = "number"; i.step = "0.01"; i.value = e.amount == null ? "" : e.amount; field("amount", "Amount", i); }
    }
    const actions = el("div", "picker-editor-actions");
    const cancel = el("button", "btn btn-small", "Cancel"); cancel.type = "button"; cancel.onclick = () => onDone(false);
    const done = el("button", "btn btn-small btn-primary", "Done"); done.type = "submit";
    actions.appendChild(cancel); actions.appendChild(done);
    form.appendChild(actions);
    form.onsubmit = (ev) => {
      ev.preventDefault();
      for (const key of ["title", "note", "name", "text"]) if (inputs[key]) { const v = inputs[key].value.trim(); if (v) e[key] = v; }
      if (inputs.year) {
        const y = +inputs.year.value, m = +inputs.month.value;
        if (y && m && (y !== +e.year || m !== +e.month)) { e.year = y; e.month = m; delete e.date; }
      }
      for (const key of ["date", "startDate"]) if (inputs[key] && inputs[key].value) e[key] = inputs[key].value;
      if (inputs.category) { if (inputs.category.value) e.category = inputs.category.value; else delete e.category; }
      if (inputs.rating) { const r = +inputs.rating.value; if (r) e.rating = r; else delete e.rating; }
      if (inputs.amount && inputs.amount.value !== "") e.amount = +inputs.amount.value;
      item.edited = true;
      onDone(true);
    };
    return form;
  }
  const KIND_WORDS = { entry: ["entry", "entries"], backlog: ["backlog item", "backlog items"], finance: ["expense", "expenses"], recurring: ["recurring expense", "recurring expenses"], note: ["note", "notes"], todo: ["checklist item", "checklist items"], habit: ["habit", "habits"], achievement: ["achievement", "achievements"], board: ["board", "boards"] };
  const importItemName = (i) => { const e = i.entry; return String(e.title || e.name || e.note || e.text || e.category || "").toLowerCase(); };
  function openImportPicker({ title, hint, mode, items, newCategories, confirmLabel, onConfirm, searchable, categorize, threshold }) {
    const sorted = items.slice().sort((a, b) => importItemDateStr(b).localeCompare(importItemDateStr(a)));
    items = sorted;
    newCategories = newCategories || [];
    $("#financePickerTitle").textContent = title;
    $("#financePickerHint").textContent = hint;
    $("#financePickerConfirmBtn").textContent = confirmLabel;
    const dupRow = $("#financePickerDupRow");
    const showDupCb = $("#financePickerShowDup");
    dupRow.hidden = mode !== "import" || !items.some((i) => i.dup && !i.update);
    showDupCb.checked = false;
    const skipRow = $("#financePickerSkipRow");
    const showSkipCb = $("#financePickerShowSkipped");
    const skippedCount = items.filter((i) => i.skipped).length;
    skipRow.hidden = mode !== "import" || !skippedCount;
    showSkipCb.checked = false;
    $("#financePickerSkippedCount").textContent = skippedCount ? `(${skippedCount})` : "";
    const unresolvedRow = $("#financePickerUnresolvedRow");
    const hideUnresolvedCb = $("#financePickerHideUnresolved");
    const unresolvedCount = items.filter((i) => i.unresolved).length;
    unresolvedRow.hidden = mode !== "import" || !unresolvedCount;
    hideUnresolvedCb.checked = false;
    $("#financePickerUnresolvedCount").textContent = unresolvedCount ? `(${unresolvedCount})` : "";
    // The search box comes on its own once the list is long (0.255.0).
    const searchInput = $("#financePickerSearch");
    searchInput.hidden = !(searchable || items.length > 20);
    searchInput.value = "";
    let searchTerm = "";
    // Sort: by date either way, by name, or by the threshold's measure.
    const sortSel = $("#financePickerSort");
    sortSel.hidden = items.length < 2;
    sortSel.innerHTML = "";
    for (const [v, label] of [["newest", "Newest first"], ["oldest", "Oldest first"], ["name", "A to Z"]].concat(threshold ? [["measure", threshold.sortLabel || "Most first"]] : [])) {
      const o = document.createElement("option"); o.value = v; o.textContent = label; sortSel.appendChild(o);
    }
    sortSel.value = threshold ? "measure" : "newest";
    const applySort = () => {
      const v = sortSel.value;
      items = v === "newest" ? sorted
        : v === "oldest" ? sorted.slice().reverse()
        : v === "name" ? sorted.slice().sort((a, b) => importItemName(a).localeCompare(importItemName(b)))
        : sorted.slice().sort((a, b) => threshold.of(b) - threshold.of(a));
    };
    applySort();
    // "At least N": rows under the line are hidden and unticked, so a
    // Steam library's one-minute demos never need unticking one by one.
    const thresholdRow = $("#financePickerThresholdRow");
    const thresholdInput = $("#financePickerThreshold");
    thresholdRow.hidden = !threshold;
    if (threshold) {
      $("#financePickerThresholdLabel").textContent = threshold.label;
      $("#financePickerThresholdUnit").textContent = threshold.unit || "";
      thresholdInput.value = threshold.value == null ? 0 : threshold.value;
      thresholdInput.min = 0; thresholdInput.step = threshold.step || 1;
    }
    const underThreshold = (i) => !!threshold && threshold.of(i) < (parseFloat(thresholdInput.value) || 0);
    const list = $("#financePickerList");
    const bucketsWrap = $("#financePickerBuckets");
    const newCatsWrap = $("#financePickerNewCats");
    const newCatsList = $("#financePickerNewCatsList");

    function renderNewCats() {
    newCatsWrap.hidden = !newCategories.length;
    $("#financePickerNewCatsEyebrow").textContent =
      `${newCategories.length} new categor${newCategories.length === 1 ? "y" : "ies"} found — pick which ones to add`;
    newCatsList.innerHTML = "";
    newCategories.forEach((nc) => {
      const row = el("label", "toggle-label");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = nc.add;
      cb.onchange = () => { nc.add = cb.checked; updateCount(); };
      row.appendChild(cb);
      const dot = el("span", "dot"); dot.style.background = nc.color;
      dot.style.width = "9px"; dot.style.height = "9px"; dot.style.borderRadius = "50%"; dot.style.display = "inline-block";
      row.appendChild(dot);
      row.appendChild(document.createTextNode(nc.name + (nc.scope === "project" ? " (project)" : nc.scope === "note" ? " (notes)" : "")));
      newCatsList.appendChild(row);
    });
    }
    renderNewCats();

    // Filing the selected rows under a category (0.200.0, the Markdown
    // import): what the files didn't say, said here. A name you don't have
    // yet joins the new categories above, ticked.
    const catBar = $("#financePickerCatBar");
    catBar.hidden = !categorize;
    if (categorize) {
      const FOLDER = "\u0000folder", NEW = "\u0000new";
      const sel = $("#financePickerCatSelect");
      const fillSelect = () => {
        sel.innerHTML = "";
        const opt = (v, label) => { const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o); };
        opt("", "No category");
        const names = new Set([...(state.data.noteCategories || []).map((c) => c.name), ...newCategories.map((c) => c.name)]);
        for (const n of [...names].sort((a, b) => a.localeCompare(b))) opt(n, n);
        if (items.some((i) => i.folder)) opt(FOLDER, "Each file's folder");
        opt(NEW, "New category…");
      };
      fillSelect();
      const ensureCat = (name) => {
        if (!name || (state.data.noteCategories || []).some((c) => c.name === name) || newCategories.some((c) => c.name === name)) return;
        newCategories.push({ name, color: CATEGORY_PALETTE[newCategories.length % CATEGORY_PALETTE.length], scope: categorize, add: true });
      };
      $("#financePickerCatApply").onclick = () => {
        let name = sel.value;
        if (name === NEW) {
          name = (prompt("Name of the new category") || "").trim();
          if (!name) return;
        }
        const chosen = visibleItems().filter((i) => i.checked);
        if (!chosen.length) { toast("Select the notes to file first"); return; }
        for (const i of chosen) {
          // A file straight in the folder you picked has no folder of its
          // own to be filed under, so it keeps what it had.
          if (name === FOLDER && !i.folder) continue;
          const cat = name === FOLDER ? i.folder : name;
          if (cat) { i.entry.category = cat; ensureCat(cat); } else delete i.entry.category;
        }
        renderNewCats();
        fillSelect();
        sel.value = name === FOLDER ? FOLDER : name;
        render();
      };
    }

    function matchesSearch(i) {
      if (!searchTerm) return true;
      const e = i.entry;
      const hay = [e.note, e.category, e.title, e.text, e.name, e.amount != null ? String(e.amount) : ""].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(searchTerm);
    }
    function visibleItems() {
      return items.filter((i) =>
        // An update is a duplicate by identity but not by intent: it is the
        // one row that says what a re-sync would actually do, so the
        // hide-duplicates toggle must not take it away.
        (i.update || !i.dup || showDupCb.checked) &&
        (!i.unresolved || !hideUnresolvedCb.checked) &&
        (!i.skipped || showSkipCb.checked) &&
        !underThreshold(i) &&
        matchesSearch(i)
      );
    }
    // Periods come as years, each a chip that toggles the whole year and
    // says how many of its rows are on, with its months behind a chevron
    // (0.255.0). A four-year backup used to put 48 month chips above the
    // list, and the list and the Import button below the fold.
    const openYears = new Set();
    let yearsSeeded = false;
    function renderBuckets() {
      const byYear = new Map();
      visibleItems().forEach((i) => {
        const key = importBucketKey(i);
        if (!key) return;
        const y = key.slice(0, 4);
        const months = byYear.get(y) || byYear.set(y, new Map()).get(y);
        (months.get(key) || months.set(key, []).get(key)).push(i);
      });
      const monthCount = [...byYear.values()].reduce((n, m) => n + m.size, 0);
      if (!yearsSeeded) { yearsSeeded = true; if (monthCount <= 6) byYear.forEach((m, y) => openYears.add(y)); }
      bucketsWrap.innerHTML = "";
      bucketsWrap.hidden = monthCount < 2;
      const chipFor = (its, label, cls) => {
        const on = its.filter((i) => i.checked).length;
        const chip = el("button", "cat-chip " + cls + (on === its.length ? " on" : on ? " part" : ""));
        chip.type = "button";
        chip.appendChild(el("span", null, label));
        chip.appendChild(el("span", "bucket-count", on === its.length ? String(its.length) : `${on}/${its.length}`));
        chip.title = "Toggle this period on/off";
        chip.setAttribute("aria-pressed", String(on === its.length));
        chip.onclick = () => { const v = on !== its.length; its.forEach((i) => (i.checked = v)); render(); };
        return chip;
      };
      [...byYear.keys()].sort((a, b) => b.localeCompare(a)).forEach((y) => {
        const months = byYear.get(y);
        const all = [...months.values()].flat();
        const group = el("div", "picker-year" + (openYears.has(y) ? " is-open" : ""));
        const head = el("div", "picker-year-head");
        head.appendChild(chipFor(all, y, "year-chip"));
        if (months.size > 1) {
          const more = el("button", "btn btn-icon picker-year-more");
          more.type = "button";
          more.setAttribute("aria-label", (openYears.has(y) ? "Hide" : "Show") + " the months of " + y);
          more.setAttribute("aria-expanded", String(openYears.has(y)));
          more.appendChild(window.LifeLogIcons.svg("chevron-down"));
          more.onclick = () => { if (openYears.has(y)) openYears.delete(y); else openYears.add(y); renderBuckets(); };
          head.appendChild(more);
        }
        group.appendChild(head);
        if (openYears.has(y) && months.size > 1) {
          const row = el("div", "picker-months");
          [...months.keys()].sort((a, b) => b.localeCompare(a)).forEach((key) => row.appendChild(chipFor(months.get(key), MONTHS_SHORT[+key.slice(5)], "month-chip")));
          group.appendChild(row);
        }
        bucketsWrap.appendChild(group);
      });
    }
    // What the button will do, by kind: "36 entries, 20 backlog items, 2
    // updates · 2 new categories" (0.255.0), not a bare "58 selected".
    function updateCount() {
      const chosen = visibleItems().filter((i) => i.checked);
      const parts = [];
      for (const k of Object.keys(KIND_WORDS)) {
        const n = chosen.filter((i) => !i.update && i.kind === k).length;
        if (n) parts.push(n + " " + KIND_WORDS[k][n === 1 ? 0 : 1]);
      }
      const ups = chosen.filter((i) => i.update).length;
      if (ups) parts.push(ups + (ups === 1 ? " update" : " updates"));
      const cats = newCategories.filter((nc) => nc.add).length;
      let text = parts.length ? parts.join(", ") + (mode === "import" ? "" : " selected") : (chosen.length ? `${chosen.length} selected` : "Nothing selected");
      if (cats && mode === "import") text += ` · ${cats} new categor${cats === 1 ? "y" : "ies"}`;
      $("#financePickerCount").textContent = text;
      if (threshold) {
        const under = items.filter(underThreshold).length;
        $("#financePickerThresholdHidden").textContent = under ? `${under} hidden` : "";
      }
      $("#financePickerConfirmBtn").disabled = mode === "import" && !chosen.length;
    }
    let editing = null;
    const onEdit = mode === "import" ? (item, row) => {
      if (editing) render();
      editing = item;
      const form = importRowEditor(item, newCategories, () => { editing = null; render(); });
      row.replaceWith(form);
      const first = form.querySelector("input, select");
      if (first) first.focus();
    } : null;
    function render() {
      editing = null;
      list.innerHTML = "";
      visibleItems().forEach((item) => list.appendChild(importRowFor(item, updateCount, onEdit)));
      renderBuckets();
      updateCount();
    }

    showDupCb.onchange = render;
    showSkipCb.onchange = () => {
      // Hidden again means out again: a skipped row ticked and then hidden
      // would otherwise come in unseen.
      if (!showSkipCb.checked) items.forEach((i) => { if (i.skipped) i.checked = false; });
      render();
    };
    hideUnresolvedCb.onchange = () => {
      // Hiding also deselects — otherwise a checked-but-hidden item would
      // still get imported despite looking "off" in the visible count.
      if (hideUnresolvedCb.checked) items.forEach((i) => { if (i.unresolved) i.checked = false; });
      render();
    };
    searchInput.oninput = () => { searchTerm = searchInput.value.trim().toLowerCase(); render(); };
    sortSel.onchange = () => { applySort(); render(); };
    thresholdInput.oninput = () => { items.forEach((i) => { if (underThreshold(i)) i.checked = false; }); render(); };
    $("#financePickerSelectAll").onclick = () => { visibleItems().forEach((i) => (i.checked = true)); render(); };
    $("#financePickerSelectNone").onclick = () => { visibleItems().forEach((i) => (i.checked = false)); render(); };
    $("#financePickerCancelBtn").onclick = () => { $("#financePickerModal").hidden = true; };
    $("#financePickerConfirmBtn").onclick = async () => {
      const selected = items.filter((i) => i.checked);
      const addCats = newCategories.filter((nc) => nc.add);
      $("#financePickerModal").hidden = true;
      await onConfirm(selected, addCats);
    };

    render();
    $("#financePickerModal").hidden = false;
  }

  window.LifeLogIO = {
    init,
    download, csvEsc, parseCsv,
    exportJson, exportTabJson, exportTabCsv, importJson, importTabCsv, importMarkdown, TAB_KINDS,
    buildImportItems,
    importItemIncomplete, reviewAndImport, openImportPicker,
    // pure helpers (exported for test/io.test.js)
    importItemDateStr, importBucketKey, parseMarkdownNote, journalCsvText, parseJournalCsv, notesCsvText, parseNotesCsv, allCsvText, parseAllCsv,
    fillableFields, findImportTarget, applyImportSelection,
  };
})();
