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
  let state, $, el, toast, persist, afterDataChange, ensureCategories,
    CATEGORY_PALETTE, MONTHS, MONTHS_SHORT, colorOf,
    financeColorOf, formatMoney, financeKey, recurringKey,
    sanitizeFinanceEntry, sanitizeRecurring, sanitizeEntry, sanitizeBacklog, isOverridden;

  function init(ctx) {
    ({ state, $, el, toast, persist, afterDataChange, ensureCategories,
      CATEGORY_PALETTE, MONTHS, MONTHS_SHORT, colorOf,
      financeColorOf, formatMoney, financeKey, recurringKey,
      sanitizeFinanceEntry, sanitizeRecurring, sanitizeEntry, sanitizeBacklog, isOverridden } = ctx);
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = el("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  function exportJson() {
    download("lifelog.json", JSON.stringify(state.data, null, 2), "application/json");
  }
  function csvEsc(s) {
    s = String(s == null ? "" : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportJournalJson() {
    const payload = { entries: state.data.entries, backlog: state.data.backlog, categories: state.data.categories };
    download("lifelog-journal.json", JSON.stringify(payload, null, 2), "application/json");
  }
  // journal CSV covers both Timeline entries (dated, Year+Month) and Backlog
  // items (undated) — the Kind column tells them apart on re-import. Row-
  // building is split out from the actual download() call so the export
  // side of the CSV round-trip (paired with parseJournalCsv below) can be
  // exercised directly in tests, without a browser Blob/URL.
  function journalCsvRows(entries, backlog) {
    const rows = [["Kind", "Year", "Month", "Category", "Title", "Added"]];
    entries.slice()
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .forEach((e) => rows.push(["Entry", e.year, MONTHS[e.month], e.category, e.title,
        e.createdAt ? e.createdAt.slice(0, 10) : ""]));
    backlog.slice()
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
      .forEach((b) => rows.push(["Backlog", "", "", b.category, b.title,
        b.createdAt ? b.createdAt.slice(0, 10) : ""]));
    return rows;
  }
  function journalCsvText(entries, backlog) {
    return journalCsvRows(entries, backlog).map((r) => r.map(csvEsc).join(",")).join("\n");
  }
  function exportJournalCsv() {
    download("lifelog-journal.csv", journalCsvText(state.data.entries, state.data.backlog), "text/csv");
  }
  let MONTH_NAME_TO_NUM;
  function parseJournalCsv(text) {
    if (!MONTH_NAME_TO_NUM) {
      MONTH_NAME_TO_NUM = MONTHS.reduce((m, name, i) => { if (name) m[name.toLowerCase()] = i; return m; }, {});
    }
    const rows = parseCsv(text);
    const entries = [];
    const backlog = [];
    for (const row of rows) {
      const kind = (row[0] || "").trim().toLowerCase();
      if (kind !== "entry" && kind !== "backlog") continue; // skips header row + blank lines
      const category = (row[3] || "Other").trim() || "Other";
      const title = (row[4] || "").trim();
      const createdAt = (row[5] || "").trim();
      if (!title) continue;
      if (kind === "entry") {
        const year = parseInt(row[1], 10);
        const month = MONTH_NAME_TO_NUM[(row[2] || "").trim().toLowerCase()];
        if (!year || !month) continue;
        entries.push({ title, category, year, month, createdAt: createdAt ? new Date(createdAt).toISOString() : null });
      } else {
        backlog.push({ title, category, createdAt: createdAt ? new Date(createdAt).toISOString() : null });
      }
    }
    if (!entries.length && !backlog.length) throw new Error("No rows found — is this a Journal CSV export?");
    return { entries, backlog };
  }

  // ---------- unified import review ----------
  // Builds the mixed-kind item list + new-category list for the picker,
  // scoped to "journal" (entries/backlog), "finance" (finance/recurring), or
  // "all" (everything) — shared by every JSON/CSV importer below.
  function buildNewCategoryList(items, incomingCats, knownCategories) {
    const known = new Set(knownCategories.map((c) => c.name));
    const colorByName = {};
    for (const c of incomingCats || []) if (c.name) colorByName[c.name] = c.color;
    const names = new Set((incomingCats || []).map((c) => c.name).filter(Boolean));
    for (const it of items) if (it.entry.category) names.add(it.entry.category);
    const out = [];
    let pi = 0;
    names.forEach((name) => {
      if (known.has(name)) return;
      out.push({ name, color: colorByName[name] || CATEGORY_PALETTE[pi++ % CATEGORY_PALETTE.length], scope: knownCategories === state.data.financeCategories ? "finance" : "journal", add: true });
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

  function buildImportItems({ entries, backlog, financeEntries, recurringExpenses, categories, financeCategories }) {
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

    const newCategories = [
      ...buildNewCategoryList(items.filter((i) => i.kind === "entry" || i.kind === "backlog"), categories, state.data.categories),
      ...buildNewCategoryList(items.filter((i) => i.kind === "finance" || i.kind === "recurring"), financeCategories, state.data.financeCategories),
    ];
    return { items, newCategories };
  }
  // applies a confirmed picker selection: registers opted-in new categories,
  // pushes each selected item into its matching state array, and reports a
  // single summary toast across every kind that was touched
  async function applyImportSelection(selected, addCats) {
    if (!selected.length) { toast("Nothing selected"); return; }
    for (const c of addCats) {
      const target = c.scope === "finance" ? state.data.financeCategories : state.data.categories;
      if (!target.some((x) => x.name === c.name)) target.push({ id: c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: c.name, color: c.color });
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
      for (const f of u.fills) {
        const v = u.entry[f.key];
        if (isEmptyField(v)) continue;
        target[f.key] = Array.isArray(v) ? v.slice() : v;
        // A paired field travels with its other half — an id with no source
        // to resolve it against, or a span with no start month, is worse than
        // the gap it filled.
        const other = FIELD_PAIR[f.key];
        if (other && !isEmptyField(u.entry[other])) target[other] = u.entry[other];
        filled++;
      }
      // No updatedAt stamp here on purpose: persist() runs
      // merge.stampChangedItems first, which times every item whose content
      // actually changed. Touching it by hand would be the manual "touch"
      // call that function exists to make unnecessary.
    }
    const byKind = { entry: [], backlog: [], finance: [], recurring: [] };
    selected.filter((i) => !i.update).forEach((i) => byKind[i.kind].push(i.entry));
    state.data.entries.push(...byKind.entry);
    state.data.backlog.push(...byKind.backlog);
    state.data.financeEntries.push(...byKind.finance);
    state.data.recurringExpenses.push(...byKind.recurring);
    ensureCategories(state.data.categories, [...byKind.entry, ...byKind.backlog]);
    ensureCategories(state.data.financeCategories, [...byKind.finance, ...byKind.recurring]);

    afterDataChange();
    await persist();
    const parts = [];
    if (byKind.entry.length) parts.push(`${byKind.entry.length} entries`);
    if (byKind.backlog.length) parts.push(`${byKind.backlog.length} backlog items`);
    if (byKind.finance.length) parts.push(`${byKind.finance.length} finance entries`);
    if (byKind.recurring.length) parts.push(`${byKind.recurring.length} recurring expenses`);
    if (updates.length) {
      parts.push(`filled ${filled} field${filled === 1 ? "" : "s"} on ${updates.length} existing item${updates.length === 1 ? "" : "s"}`);
    }
    if (!parts.length) { toast("Nothing to import"); return; }
    toast(`Imported ${parts.join(", ")}`);
  }

  function mergeAccomplishments(accIn) {
    let added = 0;
    for (const y of Object.keys(accIn || {})) {
      state.data.accomplishments[y] = state.data.accomplishments[y] || [];
      const existingTexts = new Set(state.data.accomplishments[y].map((a) => (a.text || "").toLowerCase()));
      for (const a of accIn[y] || []) {
        const out = typeof a === "string" ? { text: a, createdAt: null } : { text: a.text || "", createdAt: a.createdAt || null, ...(a.notes ? { notes: a.notes } : {}) };
        if (out.text && !existingTexts.has(out.text.toLowerCase())) { state.data.accomplishments[y].push(out); existingTexts.add(out.text.toLowerCase()); added++; }
      }
    }
    return added;
  }
  function reviewAndImport(title, hint, built, extraOnConfirm) {
    if (!built.items.length) { toast("No items found in this file"); return; }
    openImportPicker({
      title, hint, mode: "import", items: built.items, newCategories: built.newCategories,
      confirmLabel: "Import",
      onConfirm: async (selected, addCats) => {
        await applyImportSelection(selected, addCats);
        if (extraOnConfirm) extraOnConfirm();
      },
    });
  }
  function importJsonAll(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!Array.isArray(incoming.entries) && !Array.isArray(incoming.backlog) && !Array.isArray(incoming.financeEntries)) throw new Error("not a LifeLog file");
        const built = buildImportItems(incoming);
        reviewAndImport("Import full backup", "Review what to bring in — pick individual items, toggle whole periods on/off, and choose which new categories to add. Items already in your data are hidden by default.", built, () => {
          const added = mergeAccomplishments(incoming.accomplishments);
          if (added) toast(`Also imported ${added} accomplishment${added === 1 ? "" : "s"}`);
        });
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
  }
  function importJournalJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!Array.isArray(incoming.entries) && !Array.isArray(incoming.backlog)) throw new Error("not a Journal export");
        const built = buildImportItems(incoming);
        reviewAndImport("Import journal data", "Review what to bring in — pick individual items, toggle whole periods on/off, and choose which new categories to add. Items already in your data are hidden by default.", built);
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
  }
  function importJournalCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { entries, backlog } = parseJournalCsv(reader.result);
        const built = buildImportItems({ entries, backlog });
        reviewAndImport("Import journal CSV", "Review what to bring in — pick individual items, toggle whole periods on/off, and choose which new categories to add. Items already in your data are hidden by default.", built);
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
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
    return ""; // backlog has no date
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
  function importRowFor(item, onChange) {
    const e = item.entry;
    const finance = item.kind === "finance" || item.kind === "recurring";
    const row = el("label", "entry picker-row"
      + (item.update ? " is-update" : (item.dup ? " is-dup" : ""))
      + (finance ? " finance-entry" : ""));
    const cb = el("input"); cb.type = "checkbox"; cb.checked = item.checked;
    cb.onchange = () => { item.checked = cb.checked; onChange(); };
    row.appendChild(cb);
    const bar = el("div", "bar");
    bar.style.background = finance ? financeColorOf(e.category) : colorOf(e.category);
    row.appendChild(bar);
    if (item.kind === "finance") {
      row.appendChild(el("span", "fdate", e.date));
      const t = el("span", "etitle", e.note || e.category); t.title = e.note || e.category; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      row.appendChild(el("span", "famount fnegative", formatMoney(e.amount)));
    } else if (item.kind === "recurring") {
      row.appendChild(el("span", "fdate", e.startDate));
      row.appendChild(el("span", "recur-badge", "↻ " + e.interval));
      const t = el("span", "etitle", e.note || e.category); t.title = e.note || e.category; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      row.appendChild(el("span", "famount fnegative", "-" + formatMoney(e.amount)));
    } else if (item.kind === "entry") {
      row.appendChild(el("span", "fdate", `${MONTHS_SHORT[e.month]} ${e.year}`));
      const t = el("span", "etitle", e.title); t.title = e.title; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
    } else { // backlog
      row.appendChild(el("span", "fdate", "—"));
      const t = el("span", "etitle", e.title); t.title = e.title; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      row.appendChild(el("span", "dup-tag", "backlog"));
    }
    // An update says what it would actually do, rather than "already added":
    // that phrase is true of the item and useless about the change.
    if (item.update) {
      const tag = el("span", "update-tag", "+ " + item.fills.map((f) => f.label).join(", "));
      tag.title = "Already in your " + (item.targetKind === "entry" ? "timeline" : "backlog")
        + " — this fills in what it's missing, and changes nothing it already has";
      row.appendChild(tag);
    } else if (item.dup) row.appendChild(el("span", "dup-tag", "already added"));
    return row;
  }
  function openImportPicker({ title, hint, mode, items, newCategories, confirmLabel, onConfirm, searchable }) {
    items = items.slice().sort((a, b) => importItemDateStr(b).localeCompare(importItemDateStr(a)));
    newCategories = newCategories || [];
    $("#financePickerTitle").textContent = title;
    $("#financePickerHint").textContent = hint;
    $("#financePickerConfirmBtn").textContent = confirmLabel;
    const dupRow = $("#financePickerDupRow");
    const showDupCb = $("#financePickerShowDup");
    dupRow.hidden = mode !== "import" || !items.some((i) => i.dup && !i.update);
    showDupCb.checked = false;
    const unresolvedRow = $("#financePickerUnresolvedRow");
    const hideUnresolvedCb = $("#financePickerHideUnresolved");
    const unresolvedCount = items.filter((i) => i.unresolved).length;
    unresolvedRow.hidden = mode !== "import" || !unresolvedCount;
    hideUnresolvedCb.checked = false;
    $("#financePickerUnresolvedCount").textContent = unresolvedCount ? `(${unresolvedCount})` : "";
    const searchInput = $("#financePickerSearch");
    searchInput.hidden = !searchable;
    searchInput.value = "";
    let searchTerm = "";
    const list = $("#financePickerList");
    const bucketsWrap = $("#financePickerBuckets");
    const newCatsWrap = $("#financePickerNewCats");
    const newCatsList = $("#financePickerNewCatsList");

    newCatsWrap.hidden = !newCategories.length;
    $("#financePickerNewCatsEyebrow").textContent =
      `${newCategories.length} new categor${newCategories.length === 1 ? "y" : "ies"} found — pick which ones to add`;
    newCatsList.innerHTML = "";
    newCategories.forEach((nc) => {
      const row = el("label", "toggle-label");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = nc.add;
      cb.onchange = () => { nc.add = cb.checked; };
      row.appendChild(cb);
      const dot = el("span", "dot"); dot.style.background = nc.color;
      dot.style.width = "9px"; dot.style.height = "9px"; dot.style.borderRadius = "50%"; dot.style.display = "inline-block";
      row.appendChild(dot);
      row.appendChild(document.createTextNode(nc.name));
      newCatsList.appendChild(row);
    });

    function matchesSearch(i) {
      if (!searchTerm) return true;
      const e = i.entry;
      const hay = [e.note, e.category, String(e.amount)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(searchTerm);
    }
    function visibleItems() {
      return items.filter((i) =>
        // An update is a duplicate by identity but not by intent: it is the
        // one row that says what a re-sync would actually do, so the
        // hide-duplicates toggle must not take it away.
        (i.update || !i.dup || showDupCb.checked) &&
        (!i.unresolved || !hideUnresolvedCb.checked) &&
        matchesSearch(i)
      );
    }
    function renderBuckets() {
      const map = new Map();
      visibleItems().forEach((i) => {
        const key = importBucketKey(i);
        if (key) (map.get(key) || map.set(key, []).get(key)).push(i);
      });
      bucketsWrap.innerHTML = "";
      bucketsWrap.hidden = map.size < 2;
      [...map.keys()].sort((a, b) => b.localeCompare(a)).forEach((key) => {
        const its = map.get(key);
        const allOn = its.every((i) => i.checked);
        const chip = el("span", "cat-chip" + (allOn ? " on" : ""), importBucketLabel(key));
        chip.title = "Toggle this period on/off";
        chip.onclick = () => { const v = !allOn; its.forEach((i) => (i.checked = v)); render(); };
        bucketsWrap.appendChild(chip);
      });
    }
    function updateCount() {
      const checked = visibleItems().filter((i) => i.checked).length;
      $("#financePickerCount").textContent = `${checked} selected`;
    }
    function render() {
      list.innerHTML = "";
      visibleItems().forEach((item) => list.appendChild(importRowFor(item, updateCount)));
      renderBuckets();
      updateCount();
    }

    showDupCb.onchange = render;
    hideUnresolvedCb.onchange = () => {
      // Hiding also deselects — otherwise a checked-but-hidden item would
      // still get imported despite looking "off" in the visible count.
      if (hideUnresolvedCb.checked) items.forEach((i) => { if (i.unresolved) i.checked = false; });
      render();
    };
    searchInput.oninput = () => { searchTerm = searchInput.value.trim().toLowerCase(); render(); };
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
    exportJson, exportJournalJson, exportJournalCsv,
    importJsonAll, importJournalJson, importJournalCsv,
    buildImportItems,
    importItemIncomplete, reviewAndImport, openImportPicker,
    // pure helpers (exported for test/io.test.js)
    importItemDateStr, importBucketKey, journalCsvText, parseJournalCsv,
    fillableFields, findImportTarget,
  };
})();
