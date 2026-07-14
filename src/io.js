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
    sanitizeFinanceEntry, sanitizeRecurring, sanitizeEntry, sanitizeBacklog;

  function init(ctx) {
    ({ state, $, el, toast, persist, afterDataChange, ensureCategories,
      CATEGORY_PALETTE, MONTHS, MONTHS_SHORT, colorOf,
      financeColorOf, formatMoney, financeKey, recurringKey,
      sanitizeFinanceEntry, sanitizeRecurring, sanitizeEntry, sanitizeBacklog } = ctx);
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
  // items (undated) — the Kind column tells them apart on re-import
  function exportJournalCsv() {
    const rows = [["Kind", "Year", "Month", "Category", "Title", "Added"]];
    state.data.entries.slice()
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .forEach((e) => rows.push(["Entry", e.year, MONTHS[e.month], e.category, e.title,
        e.createdAt ? e.createdAt.slice(0, 10) : ""]));
    state.data.backlog.slice()
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
      .forEach((b) => rows.push(["Backlog", "", "", b.category, b.title,
        b.createdAt ? b.createdAt.slice(0, 10) : ""]));
    download("lifelog-journal.csv", rows.map((r) => r.map(csvEsc).join(",")).join("\n"), "text/csv");
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
  function buildImportItems({ entries, backlog, financeEntries, recurringExpenses, categories, financeCategories }) {
    const items = [];
    const entryKey = (e) => `${(e.title || "").toLowerCase()}|${(e.category || "").toLowerCase()}|${+e.year}|${+e.month}`;
    const backlogKey = (b) => `${(b.title || "").toLowerCase()}|${(b.category || "").toLowerCase()}`;
    const existingEntryKeys = new Set(state.data.entries.map(entryKey));
    const existingBacklogKeys = new Set(state.data.backlog.map(backlogKey));
    const existingFinanceKeys = new Set(state.data.financeEntries.map(financeKey));
    const existingRecurKeys = new Set(state.data.recurringExpenses.map(recurringKey));
    // A wishlisted game already logged as finished in the Journal (title
    // match, ignoring year/month/date since a backlog item has none of
    // those yet) is just as much a duplicate as one already sitting in
    // the backlog — same check the single-item add form already does
    // (updateBacklogDuplicateBanner) that bulk import was missing.
    const titleCatKey = (t, c) => `${(t || "").toLowerCase()}|${(c || "").toLowerCase()}`;
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
      const dup = existingEntryKeys.has(entryKey(e));
      items.push({ kind: "entry", entry: e, dup, checked: !dup });
    });
    (backlog || []).forEach((raw) => {
      const b = sanitizeBacklog(raw);
      const dup = existingBacklogKeys.has(backlogKey(b)) ||
        existingEntryTitleKeys.has(titleCatKey(b.title, b.category)) ||
        (b.mediaSource && b.mediaId && existingMediaIds.has(b.mediaSource + ":" + b.mediaId));
      items.push({ kind: "backlog", entry: b, dup, checked: !dup, unresolved: !!raw.unresolved });
    });
    (financeEntries || []).map(sanitizeFinanceEntry).forEach((f) => {
      const dup = existingFinanceKeys.has(financeKey(f));
      items.push({ kind: "finance", entry: f, dup, checked: !dup });
    });
    (recurringExpenses || []).map(sanitizeRecurring).forEach((r) => {
      const dup = existingRecurKeys.has(recurringKey(r));
      items.push({ kind: "recurring", entry: r, dup, checked: !dup });
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
    const byKind = { entry: [], backlog: [], finance: [], recurring: [] };
    selected.forEach((i) => byKind[i.kind].push(i.entry));
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
    return ds.length === 4 ? ds : ds.slice(0, 7);
  }
  function importBucketLabel(key) {
    if (key.length === 4) return `${key} · yearly`;
    const [y, m] = key.split("-");
    return `${MONTHS_SHORT[+m]} ${y}`;
  }
  function importRowFor(item, onChange) {
    const e = item.entry;
    const finance = item.kind === "finance" || item.kind === "recurring";
    const row = el("label", "entry picker-row" + (item.dup ? " is-dup" : "") + (finance ? " finance-entry" : "") + (e.yearly ? " yearly-expense" : ""));
    const cb = el("input"); cb.type = "checkbox"; cb.checked = item.checked;
    cb.onchange = () => { item.checked = cb.checked; onChange(); };
    row.appendChild(cb);
    const bar = el("div", "bar");
    bar.style.background = finance ? financeColorOf(e.category) : colorOf(e.category);
    row.appendChild(bar);
    if (item.kind === "finance") {
      row.appendChild(el("span", "fdate" + (e.yearly ? " fyearly" : ""), e.yearly ? `${e.date} · yearly` : e.date));
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
    if (item.dup) row.appendChild(el("span", "dup-tag", "already added"));
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
    dupRow.hidden = mode !== "import" || !items.some((i) => i.dup);
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
        (!i.dup || showDupCb.checked) &&
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
    buildImportItems, reviewAndImport, openImportPicker,
    // pure helpers (exported for test/io.test.js)
    importItemDateStr, importBucketKey,
  };
})();
