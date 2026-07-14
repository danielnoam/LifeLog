// LifeLog — finance: expenses, recurring expenses (with per-occurrence
// overrides and the link-past-expenses picker), finance categories, the
// Ledger + Summary views, and finance import/export. Extracted from app.js;
// shared app plumbing (state, DOM helpers, render/persist, the import
// picker, …) is handed in via init(ctx), and everything app.js still needs
// (view renderers, modal openers, sanitizers for the shared import
// infrastructure) is exposed on window.LifeLogFinance.
(function () {
  const CURRENCY_SYMBOLS = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };

  // Seeded so a first-time switch to the Finance tab starts from a familiar
  // set of categories instead of empty — fully editable/deletable afterward.
  const DEFAULT_FINANCE_CATEGORY_NAMES = ["Entertainment", "Food", "Fuel", "Clothing", "Health", "Smoking", "Other"];
  const FINANCE_PALETTE = ["#e2723b", "#3bb2e2", "#9fe23b", "#b23be2", "#e23b72", "#6b7384", "#7a8a99"];
  function seedFinanceCategories() {
    return DEFAULT_FINANCE_CATEGORY_NAMES.map((name, i) => ({
      id: name.toLowerCase(), name, color: FINANCE_PALETTE[i % FINANCE_PALETTE.length],
    }));
  }

  // Shared app plumbing, provided by app.js via init(ctx). Everything below
  // (except seedFinanceCategories and the pure date/key helpers) assumes
  // init() has run.
  let state, $, el, uid, groupBy, countBy, toast, persist, render, renderLazySections,
    buildYearFilter, buildCatFilter, monthCardHeader, emptyState,
    bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
    animatedNumberText, barRow, fillCategorySelect, wireCategorySelect,
    resolvePendingCatSelect, download, csvEsc, parseCsv,
    buildImportItems, reviewAndImport, openImportPicker,
    backfillUpdatedAt, MONTHS;

  function init(ctx) {
    ({ state, $, el, uid, groupBy, countBy, toast, persist, render, renderLazySections,
      buildYearFilter, buildCatFilter, monthCardHeader, emptyState,
      bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
      animatedNumberText, barRow, fillCategorySelect, wireCategorySelect,
      resolvePendingCatSelect, download, csvEsc, parseCsv,
      buildImportItems, reviewAndImport, openImportPicker,
      backfillUpdatedAt, MONTHS } = ctx);
  }

  let financeCatColor = {}; // name -> color

  function rebuildFinanceColorMap() {
    financeCatColor = {};
    for (const c of state.data.financeCategories) financeCatColor[c.name] = c.color;
  }
  const financeColorOf = (name) => financeCatColor[name] || "#7a8a99";

  // Manual formatting instead of Intl.NumberFormat("he-IL", {style:"currency"}) —
  // that locale injects invisible RTL bidi marks and puts the symbol after the
  // number ("1,302.00 ₪"), not matching the source sheet's "₪1,302.00".
  function formatMoney(n) {
    const sign = n < 0 ? "-" : "";
    const symbol = CURRENCY_SYMBOLS[state.data.settings.currency] || CURRENCY_SYMBOLS.ILS;
    return sign + symbol + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function currencyGlyph() {
    return CURRENCY_SYMBOLS[state.data.settings.currency] || CURRENCY_SYMBOLS.ILS;
  }

  function financeYearOf(f) { return +String(f.date).slice(0, 4); }
  // yearly ad-hoc entries (imported big purchases) carry just a year, no
  // month — they get bucketed into a pseudo-month (0) rendered as "Yearly"
  function financeMonthOf(f) { return f.yearly ? 0 : +String(f.date).slice(5, 7); }

  // "YYYY-MM-DD" from a Date's local calendar fields — never
  // `.toISOString().slice(0, 10)`, which converts to UTC first and can
  // silently shift the date by a day for any timezone that isn't exactly
  // UTC (e.g. local midnight in a timezone ahead of UTC is still the
  // previous day in UTC). Every date here is a plain calendar date, not a
  // moment in time, so it must stay in local terms end to end.
  function localDateStr(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function todayStr() { return localDateStr(new Date()); }

  // ---------- recurring expenses ----------
  // Recurring expenses are stored as a single template (start date, interval,
  // amount/category/note) rather than as individual finance entries. Their
  // occurrences are computed on the fly, from the start date up through
  // today, every time finance data is read — nothing is written to
  // state.data.financeEntries for them. This keeps the template the single
  // source of truth: editing it changes every past and future occurrence,
  // and there's no per-occurrence row to clean up if it's stopped or edited.
  // rec.overrides (optional) keys a sparse { amount?, note? } patch by
  // occurrence date, for the rare month that genuinely differed (a price
  // change, a one-off note) without dragging every other occurrence along.
  function addMonthsClamped(date, n, day) {
    const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, daysInMonth));
    return d;
  }
  function nextRecurringDate(date, interval, anchorDay) {
    if (interval === "weekly") { const d = new Date(date); d.setDate(d.getDate() + 7); return d; }
    if (interval === "yearly") { const d = new Date(date); d.setFullYear(d.getFullYear() + 1); return d; }
    return addMonthsClamped(date, 1, anchorDay);
  }
  // generates every occurrence of a recurring template from its start date
  // up to (and including) `until`, capped at the template's stop date if set
  function recurringOccurrences(rec, until) {
    const start = new Date(rec.startDate + "T00:00:00");
    if (isNaN(start.getTime())) return [];
    const stop = rec.endDate ? new Date(rec.endDate + "T00:00:00") : null;
    const cutoff = stop && stop < until ? stop : until;
    const anchorDay = start.getDate();
    const out = [];
    let d = start;
    let n = 0;
    while (d <= cutoff) {
      const dateStr = localDateStr(d);
      const ov = (rec.overrides || {})[dateStr];
      out.push({
        id: `${rec.id}:${n}`, date: dateStr, type: "expense",
        amount: ov && ov.amount != null ? ov.amount : rec.amount,
        category: rec.category,
        note: ov && ov.note != null ? ov.note : rec.note,
        createdAt: rec.createdAt,
        recurringId: rec.id, virtual: true, overridden: !!ov,
      });
      n++;
      d = nextRecurringDate(d, rec.interval, anchorDay);
    }
    return out;
  }
  // real finance entries plus every recurring template's occurrences through
  // today — the merged list everything else (list view, stats, filters)
  // should read instead of state.data.financeEntries directly
  function getEffectiveFinanceEntries() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const virtual = (state.data.recurringExpenses || []).flatMap((r) => recurringOccurrences(r, today));
    return [...state.data.financeEntries, ...virtual];
  }
  function financeYears() {
    const ys = new Set(getEffectiveFinanceEntries().map(financeYearOf));
    return [...ys].sort((a, b) => b - a);
  }

  function getFilteredFinance() {
    const q = state.search.trim().toLowerCase();
    return getEffectiveFinanceEntries().filter((f) => {
      if (state.financeActiveYears.size && !state.financeActiveYears.has(financeYearOf(f))) return false;
      if (state.financeActiveCats.size && !state.financeActiveCats.has(f.category)) return false;
      if (q && !(f.note || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }

  // ---------- bulk actions ----------
  async function bulkMoveFinanceSelected(categoryName) {
    const ids = state.bulk.selected;
    state.data.financeEntries.forEach((f) => { if (ids.has(f.id)) f.category = categoryName; });
    const n = ids.size;
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Moved ${n} entr${n === 1 ? "y" : "ies"} to “${categoryName}”`);
  }

  async function bulkDeleteFinanceSelected() {
    const ids = state.bulk.selected;
    const n = ids.size;
    if (!confirm(`Delete ${n} entr${n === 1 ? "y" : "ies"} from your finance log?`)) return;
    state.data.financeEntries = state.data.financeEntries.filter((f) => !ids.has(f.id));
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Deleted ${n} entr${n === 1 ? "y" : "ies"}`);
  }

  // ---------- Ledger view ----------
  function renderFinanceEntries(root) {
    renderRecurringCard(root);
    if (!state.data.financeEntries.length && !state.data.recurringExpenses.length) {
      root.appendChild(emptyState({
        glyph: currencyGlyph(),
        title: "No finance entries yet",
        body: "Track an expense and LifeLog starts building your monthly summary, category breakdown and spend trend.",
        action: "Add finance entry",
        onAction: () => openFinanceModal(null),
        hint: "Recurring expenses can generate their entries automatically.",
      }));
      return;
    }
    const items = getFilteredFinance();
    if (!items.length) {
      root.appendChild(emptyState("No finance entries match your filters."));
      return;
    }
    const byYear = groupBy(items, financeYearOf);
    const sections = [];
    for (const y of Object.keys(byYear).sort((a, b) => b - a)) {
      const block = el("div", "year-block");
      const head = el("div", "year-head");
      head.appendChild(el("h2", null, y));
      head.appendChild(el("span", "ycount", `${byYear[y].length} entries`));
      block.appendChild(head);

      const grid = el("div", "month-grid");
      grid.style.setProperty("--month-min", "260px"); // finance rows need more room (date + amount columns)
      block.appendChild(grid);

      sections.push({
        key: y, header: head, node: block, bodyEl: grid,
        build: () => {
          const byMonth = groupBy(byYear[y], financeMonthOf);
          const monthSort = (a, b) => {
            a = +a; b = +b;
            if (a === 0) return 1; // yearly ad-hoc bucket always last
            if (b === 0) return -1;
            return state.data.settings.monthOrder === "desc" ? b - a : a - b;
          };
          for (const m of Object.keys(byMonth).sort(monthSort)) {
            const card = el("div", "month-card");
            const yy = +y, mm = +m;
            const monthItems = byMonth[m];
            const label = mm === 0 ? "Yearly" : MONTHS[m];
            card.appendChild(monthCardHeader(label, monthItems.length, monthItems.filter((f) => !f.virtual), {
              onAdd: () => openFinanceModal(null, { year: yy, month: mm }),
            }));
            // Same-date entries need a real tiebreaker, not just array order —
            // that order is stable within a session (new entries are always
            // pushed to the end) but merge.js rebuilds the array from a Set of
            // ids on every multi-device sync, reshuffling same-date entries
            // arbitrarily. createdAt keeps the display order deterministic
            // across renders and merges alike.
            monthItems.slice()
              .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""))
              .forEach((f) => card.appendChild(financeRow(f)));
            const total = monthItems.reduce((s, f) => s + f.amount, 0);
            const totalRow = el("div", "month-total");
            totalRow.appendChild(el("span", null, "Total"));
            const totalAmt = el("span", "famount fnegative");
            animatedNumberText(totalAmt, "fin-month-total:" + yy + "-" + mm, total, formatMoney);
            totalRow.appendChild(totalAmt);
            card.appendChild(totalRow);
            grid.appendChild(card);
          }
        },
      });
    }
    renderLazySections(root, sections);
    // All sections are attached to the document by now (renderLazySections
    // appends every node up front, before building any bodies), so headers
    // can be measured here regardless of which sections have built their
    // rows yet. getBoundingClientRect (not offsetHeight) keeps the
    // sub-pixel remainder, which otherwise rounds away and leaves a
    // hairline gap under the sticky header.
    sections.forEach((s) => s.node.style.setProperty("--year-head-h", s.header.getBoundingClientRect().height + "px"));
    if (state.bulk.active) {
      root.appendChild(bulkActionBar({
        categories: state.data.financeCategories,
        onMove: bulkMoveFinanceSelected,
        onDelete: bulkDeleteFinanceSelected,
      }));
    }
  }

  function financeRow(f) {
    const row = el("div", "entry finance-entry" + (f.yearly ? " yearly-expense" : ""));
    if (state.bulk.active && !f.virtual) row.appendChild(bulkCheckbox(f));
    const color = financeColorOf(f.category);
    const chip = el("span", "entry-cat");
    chip.style.background = color + "22";
    chip.style.color = color;
    const dot = el("span", "dot");
    dot.style.background = color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(f.category));
    row.appendChild(chip);
    const t = el("span", "etitle", f.note || f.category);
    t.title = f.note || f.category;
    row.appendChild(t);
    if (f.virtual) {
      const badge = el("span", "recur-badge", f.overridden ? "↻*" : "↻");
      badge.title = f.overridden ? "Recurring — custom amount/note for this date" : "Recurring";
      row.appendChild(badge);
    }
    const amt = el("span", "famount fnegative", formatMoney(f.amount));
    row.appendChild(amt);
    row.onclick = f.virtual
      ? () => {
          const rec = state.data.recurringExpenses.find((r) => r.id === f.recurringId);
          if (rec) openRecurringOccModal(rec, f);
        }
      : () => (state.bulk.active ? toggleBulkItem(f.id) : openFinanceModal(f));
    if (!f.virtual) attachLongPressSelect(row, f);
    return row;
  }

  // ---------- Summary view ----------
  function renderFinanceStats(root) {
    if (!state.data.financeEntries.length && !state.data.recurringExpenses.length) {
      root.appendChild(emptyState({
        glyph: currencyGlyph(),
        title: "No finance entries yet",
        body: "Track an expense and LifeLog starts building your monthly summary, category breakdown and spend trend.",
        action: "Add finance entry",
        onAction: () => openFinanceModal(null),
        hint: "Recurring expenses can generate their entries automatically.",
      }));
      return;
    }
    const items = getFilteredFinance();
    if (!items.length) {
      root.appendChild(emptyState("No finance entries match your filters."));
      return;
    }

    const expense = items.reduce((s, f) => s + f.amount, 0);

    const big = el("div", "card");
    big.appendChild(el("h2", null, "Expenses"));
    const bigRow = el("div", "stat-big");
    bigRow.appendChild(moneyStatItem(expense, "total", "var(--expense)"));
    big.appendChild(bigRow);
    root.appendChild(big);

    const grid = el("div", "stats-grid");
    grid.appendChild(financeCategoryCard("By category", items));

    const yearCard = el("div", "card");
    yearCard.appendChild(el("h2", null, "By year"));
    const yearTotals = {};
    for (const f of items) {
      const y = financeYearOf(f);
      yearTotals[y] = (yearTotals[y] || 0) + f.amount;
    }
    const yearMax = Math.max(1, ...Object.values(yearTotals));
    Object.keys(yearTotals).sort((a, b) => b - a)
      .forEach((y) => yearCard.appendChild(barRow(y, yearTotals[y], yearMax, "var(--accent)", null, formatMoney)));
    grid.appendChild(yearCard);

    root.appendChild(grid);

    renderFinanceMonthCard(root, items);
    renderRecurringSplitCard(root, items);
    renderTopExpensesCard(root, items);
  }

  // Builds the "By category" breakdown card (bar per category, sorted by total).
  function financeCategoryCard(title, catItems) {
    const card = el("div", "card");
    card.appendChild(el("h2", null, title));
    const totals = {};
    const counts = {};
    for (const f of catItems) {
      totals[f.category] = (totals[f.category] || 0) + f.amount;
      counts[f.category] = (counts[f.category] || 0) + 1;
    }
    let order = state.data.financeCategories.map((c) => c.name).filter((n) => totals[n]);
    for (const n of Object.keys(totals)) if (!order.includes(n)) order.push(n);
    const max = Math.max(1, ...Object.values(totals));
    order.sort((a, b) => totals[b] - totals[a])
      .forEach((n) => card.appendChild(barRow(n, totals[n], max, financeColorOf(n), counts[n], formatMoney, "entries")));
    return card;
  }

  const monthSortAsc = (a, b) => {
    a = +a; b = +b;
    if (a === 0) return 1; // yearly ad-hoc bucket always last
    if (b === 0) return -1;
    return a - b;
  };

  // Real per-month expense total, replacing the old flat
  // yearTotal/12 "Per month average" — one year at a time via a tab
  // picker, same pattern as the Journal Stats "Year in Review" card.
  function renderFinanceMonthCard(root, items) {
    const allYears = [...new Set(items.map(financeYearOf))].sort((a, b) => b - a);
    if (!allYears.length) return;
    if (!state.financeStatsYear || !allYears.includes(state.financeStatsYear)) state.financeStatsYear = allYears[0];

    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "By month"));

    const yearNav = el("div", "yir-years");
    for (const y of allYears) {
      const btn = el("button", "yir-year-btn" + (y === state.financeStatsYear ? " active" : ""), String(y));
      btn.type = "button";
      btn.onclick = () => { state.financeStatsYear = y; render(); };
      yearNav.appendChild(btn);
    }
    card.appendChild(yearNav);

    const yearItems = items.filter((f) => financeYearOf(f) === state.financeStatsYear);
    const byMonth = groupBy(yearItems, financeMonthOf);
    Object.keys(byMonth).sort(monthSortAsc).forEach((m) => {
      const mm = +m;
      const label = mm === 0 ? "Yearly" : MONTHS[mm];
      const total = byMonth[m].reduce((s, f) => s + f.amount, 0);
      card.appendChild(financeMoneyRow(label, total));
    });
    root.appendChild(card);
  }

  // Total spent this period through each recurring expense, broken out
  // individually (largest first) rather than lumped into one bucket.
  function renderRecurringSplitCard(root, expenseItems) {
    const recurring = expenseItems.filter((f) => f.virtual);
    if (!recurring.length) return;
    const byRec = groupBy(recurring, (f) => f.recurringId);
    const rows = Object.keys(byRec).map((id) => {
      const group = byRec[id];
      const rec = state.data.recurringExpenses.find((r) => r.id === id);
      const label = (rec && (rec.note || rec.category)) || group[0].note || group[0].category;
      const color = financeColorOf((rec && rec.category) || group[0].category);
      return { label, color, total: group.reduce((s, f) => s + f.amount, 0), count: group.length };
    }).sort((a, b) => b.total - a.total);

    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Recurring"));
    const max = Math.max(1, ...rows.map((r) => r.total));
    rows.forEach((r) => card.appendChild(barRow(r.label, r.total, max, r.color, r.count, formatMoney, "entries")));
    root.appendChild(card);
  }

  // Top 5 largest single expense transactions in the filtered range.
  function renderTopExpensesCard(root, expenseItems) {
    const top = expenseItems.slice().sort((a, b) => b.amount - a.amount).slice(0, 5);
    if (!top.length) return;
    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Top expenses"));
    const max = Math.max(1, ...top.map((f) => f.amount));
    top.forEach((f) => {
      const label = f.note || f.category;
      const row = barRow(label, f.amount, max, financeColorOf(f.category), null, formatMoney);
      row.querySelector(".lbl").title = label;
      card.appendChild(row);
    });
    root.appendChild(card);
  }

  function moneyStatItem(n, l, color) {
    const i = el("div", "item");
    const nEl = el("div", "n");
    if (color) nEl.style.color = color;
    animatedNumberText(nEl, "finstat:" + l, n, formatMoney);
    i.appendChild(nEl);
    i.appendChild(el("div", "l", l));
    return i;
  }
  function financeMoneyRow(label, amount) {
    const row = el("div", "month-total");
    row.appendChild(el("span", null, String(label)));
    row.appendChild(el("span", "famount fnegative", formatMoney(amount)));
    return row;
  }

  // ---------- finance entries ----------
  function applyFinanceYearlyUI() {
    const yearly = $("#finYearly").checked;
    $("#finDateLabel").hidden = yearly;
    $("#finYearLabel").hidden = !yearly;
    $("#finDate").required = !yearly;
    $("#finYear").required = yearly;
  }
  // Quick-adding into a month card should default to today's actual date
  // when that card is the current month (matches what the plain "+" button
  // already does) — only falls back to the 1st of the month when the
  // preset month isn't the current one, since "today" wouldn't be in it.
  function presetDateStr(presetDate) {
    const now = new Date();
    if (presetDate.year === now.getFullYear() && presetDate.month === now.getMonth() + 1) return todayStr();
    return `${presetDate.year}-${String(presetDate.month).padStart(2, "0")}-01`;
  }
  function openFinanceModal(entry, presetDate) {
    const editing = !!entry;
    const yearly = editing ? !!entry.yearly : (presetDate && presetDate.month === 0);
    $("#financeModalTitle").textContent = editing ? "Edit finance entry" : "Add finance entry";
    $("#financeId").value = editing ? entry.id : "";
    $("#finYearly").checked = yearly;
    $("#finDate").value = (editing && !yearly) ? entry.date
      : (!yearly && presetDate ? presetDateStr(presetDate) : todayStr());
    $("#finYear").value = yearly ? (editing ? entry.date : (presetDate ? String(presetDate.year) : "")) : "";
    $("#finAmount").value = editing ? entry.amount : "";
    fillCategorySelect($("#finCategory"), state.data.financeCategories,
      editing ? entry.category : (state.data.financeCategories[0] && state.data.financeCategories[0].name));
    $("#finNote").value = editing ? (entry.note || "") : "";
    $("#deleteFinanceBtn").hidden = !editing;
    applyFinanceYearlyUI();
    $("#financeModal").hidden = false;
  }
  function closeFinanceModal() { $("#financeModal").hidden = true; }

  async function saveFinanceFromForm(ev) {
    ev.preventDefault();
    const id = $("#financeId").value;
    const yearly = $("#finYearly").checked;
    const date = yearly ? $("#finYear").value : $("#finDate").value;
    const amount = Math.abs(parseFloat($("#finAmount").value)) || 0;
    const category = $("#finCategory").value;
    const note = $("#finNote").value.trim();
    if (!date || !amount) return;
    if (yearly && !/^\d{4}$/.test(date)) return;
    if (id) {
      const f = state.data.financeEntries.find((x) => x.id === id);
      Object.assign(f, { date, amount, category });
      if (note) f.note = note; else delete f.note;
      if (yearly) f.yearly = true; else delete f.yearly;
    } else {
      const item = { id: uid(), date, amount, category, createdAt: new Date().toISOString() };
      if (note) item.note = note;
      if (yearly) item.yearly = true;
      state.data.financeEntries.push(item);
    }
    closeFinanceModal();
    buildYearFilter();
    render();
    await persist();
    toast(id ? "Finance entry updated" : "Finance entry added");
  }

  async function deleteCurrentFinanceEntry() {
    const id = $("#financeId").value;
    if (!id) return;
    if (!confirm("Delete this finance entry?")) return;
    state.data.financeEntries = state.data.financeEntries.filter((x) => x.id !== id);
    closeFinanceModal();
    buildYearFilter();
    render();
    await persist();
    toast("Finance entry deleted");
  }

  // ---------- recurring expenses (modals + card) ----------
  function openRecurringModal(rec) {
    const editing = !!rec;
    $("#recurringModalTitle").textContent = editing ? "Edit recurring expense" : "Add recurring expense";
    $("#recId").value = editing ? rec.id : "";
    $("#recStart").value = editing ? rec.startDate : todayStr();
    $("#recInterval").value = editing ? rec.interval : "monthly";
    $("#recAmount").value = editing ? rec.amount : "";
    fillCategorySelect($("#recCategory"), state.data.financeCategories,
      editing ? rec.category : (state.data.financeCategories[0] && state.data.financeCategories[0].name));
    $("#recNote").value = editing ? (rec.note || "") : "";
    $("#deleteRecurringBtn").hidden = !editing;
    const occWrap = $("#recOccurrences");
    if (editing) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const occ = recurringOccurrences(rec, today).slice().sort((a, b) => b.date.localeCompare(a.date));
      const list = $("#recOccList");
      list.innerHTML = "";
      occ.forEach((o) => {
        const row = el("div", "rec-occ-row" + (o.overridden ? " is-overridden" : ""));
        row.appendChild(el("span", "rec-occ-date", o.date + (o.overridden ? " *" : "")));
        row.appendChild(el("span", "rec-occ-amount", "-" + formatMoney(o.amount)));
        row.title = "Edit this occurrence";
        row.onclick = () => openRecurringOccModal(rec, o);
        list.appendChild(row);
      });
      occWrap.hidden = false;
    } else {
      occWrap.hidden = true;
    }
    $("#recurringModal").hidden = false;
  }
  function closeRecurringModal() { $("#recurringModal").hidden = true; }

  // Edits one generated occurrence's amount/note without touching the
  // template or any other occurrence — stored as a sparse patch on
  // rec.overrides, keyed by that occurrence's date.
  function openRecurringOccModal(rec, occ) {
    $("#recurringOccModalTitle").textContent = occ.date;
    $("#recOccRecId").value = rec.id;
    $("#recOccDate").value = occ.date;
    $("#recOccAmount").value = occ.amount;
    $("#recOccNote").value = occ.note || "";
    $("#resetRecOccBtn").hidden = !occ.overridden;
    $("#recurringOccModal").hidden = false;
  }
  function closeRecurringOccModal() { $("#recurringOccModal").hidden = true; }

  async function saveRecurringOccFromForm(ev) {
    ev.preventDefault();
    const rec = state.data.recurringExpenses.find((x) => x.id === $("#recOccRecId").value);
    if (!rec) return;
    const date = $("#recOccDate").value;
    const amount = Math.abs(parseFloat($("#recOccAmount").value)) || 0;
    const note = $("#recOccNote").value.trim();
    const ov = {};
    if (amount !== rec.amount) ov.amount = amount;
    if (note !== (rec.note || "")) ov.note = note;
    if (Object.keys(ov).length) {
      if (!rec.overrides) rec.overrides = {};
      rec.overrides[date] = ov;
    } else if (rec.overrides) {
      delete rec.overrides[date];
      if (!Object.keys(rec.overrides).length) delete rec.overrides;
    }
    const reopenTemplate = !$("#recurringModal").hidden;
    closeRecurringOccModal();
    render();
    await persist();
    toast("Occurrence updated");
    if (reopenTemplate) openRecurringModal(rec);
  }
  async function resetRecurringOcc() {
    const rec = state.data.recurringExpenses.find((x) => x.id === $("#recOccRecId").value);
    const date = $("#recOccDate").value;
    if (rec && rec.overrides) {
      delete rec.overrides[date];
      if (!Object.keys(rec.overrides).length) delete rec.overrides;
    }
    const reopenTemplate = !$("#recurringModal").hidden;
    closeRecurringOccModal();
    render();
    await persist();
    toast("Reset to template amount");
    if (reopenTemplate && rec) openRecurringModal(rec);
  }

  async function saveRecurringFromForm(ev) {
    ev.preventDefault();
    const id = $("#recId").value;
    const startDate = $("#recStart").value;
    const interval = $("#recInterval").value;
    const amount = Math.abs(parseFloat($("#recAmount").value)) || 0;
    const category = $("#recCategory").value;
    const note = $("#recNote").value.trim();
    if (!startDate || !amount) return;
    if (id) {
      const r = state.data.recurringExpenses.find((x) => x.id === id);
      Object.assign(r, { startDate, interval, amount, category });
      if (note) r.note = note; else delete r.note;
    } else {
      const item = { id: uid(), startDate, interval, amount, category, createdAt: new Date().toISOString() };
      if (note) item.note = note;
      state.data.recurringExpenses.push(item);
    }
    closeRecurringModal();
    buildYearFilter();
    render();
    await persist();
    toast(id ? "Recurring expense updated" : "Recurring expense added");
  }

  // Deleting a recurring expense removes the template (so no new occurrences
  // get generated) but first materializes every occurrence it already
  // produced into real finance entries, so none of that history disappears.
  async function deleteCurrentRecurring() {
    const id = $("#recId").value;
    if (!id) return;
    if (!confirm("Delete this recurring expense? It will stop generating new occurrences, but everything it already created stays in your history.")) return;
    const r = state.data.recurringExpenses.find((x) => x.id === id);
    if (r) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      recurringOccurrences(r, today).forEach((o) => {
        const entry = { id: uid(), date: o.date, type: "expense", amount: o.amount, category: o.category, createdAt: new Date().toISOString() };
        if (o.note) entry.note = o.note;
        state.data.financeEntries.push(entry);
      });
      state.data.recurringExpenses = state.data.recurringExpenses.filter((x) => x.id !== id);
    }
    closeRecurringModal();
    buildYearFilter();
    render();
    await persist();
    toast("Recurring expense deleted");
  }

  // Finds, among a template's generated occurrences, the one closest in
  // time to a given date — used to map a linked real entry onto whichever
  // occurrence date the template actually lands on for that period, since
  // the entry's own date (e.g. the 3rd) doesn't necessarily match the
  // template's anchor day (e.g. the 5th).
  function closestOccurrenceDate(occs, targetDateStr) {
    const target = new Date(targetDateStr + "T00:00:00").getTime();
    let best = null, bestDiff = Infinity;
    for (const o of occs) {
      const diff = Math.abs(new Date(o.date + "T00:00:00").getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = o.date; }
    }
    return best;
  }

  // Lets old, manually-logged finance entries (from before this recurring
  // expense existed, or a stray real entry that duplicates a since-covered
  // period) be folded into the template: picked entries are deleted, and if
  // any predate the template's start, the start date moves back to cover
  // them. Each linked entry's own amount/note is preserved as a
  // per-occurrence override rather than silently snapping to the
  // template's current amount — a bill that changed price over time
  // shouldn't have its history rewritten by linking it.
  function openLinkPastExpensesPicker(rec) {
    // Yearly big-purchase entries only carry a bare year (no month/day), so
    // they're excluded both because a template's startDate needs a real
    // date and because a one-off yearly purchase isn't really an instance
    // of a periodic bill anyway.
    const candidates = state.data.financeEntries.filter((e) => e.category === rec.category && !e.yearly);
    if (!candidates.length) { toast("No existing expenses in this category to link", true); return; }
    const items = candidates.map((e) => ({ kind: "finance", entry: e, dup: false, checked: false }));
    openImportPicker({
      title: "Link past expenses",
      hint: `Pick expenses you logged before this recurring expense existed (or a stray duplicate of one it already covers). Linked ones are removed — if any predate ${rec.startDate}, the start date moves back to cover them. Each one keeps its own original amount/note as an override, so a price that changed over time isn't flattened to the template's current amount.`,
      mode: "link",
      items,
      searchable: true,
      confirmLabel: "Link",
      onConfirm: async (selected) => {
        if (!selected.length) return;
        const ids = new Set(selected.map((i) => i.entry.id));
        state.data.financeEntries = state.data.financeEntries.filter((e) => !ids.has(e.id));
        const minDate = selected.map((i) => i.entry.date).sort()[0];
        const movedStart = minDate < rec.startDate;
        if (movedStart) rec.startDate = minDate;

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const occs = recurringOccurrences(rec, today);
        selected.forEach((i) => {
          const e = i.entry;
          const ov = {};
          if (e.amount !== rec.amount) ov.amount = e.amount;
          if ((e.note || "") !== (rec.note || "")) ov.note = e.note || "";
          if (Object.keys(ov).length) {
            const occDate = closestOccurrenceDate(occs, e.date) || e.date;
            if (!rec.overrides) rec.overrides = {};
            rec.overrides[occDate] = ov;
          }
        });

        buildYearFilter();
        render();
        await persist();
        toast(`Linked ${selected.length} expense${selected.length === 1 ? "" : "s"}` + (movedStart ? ` — now starts ${minDate}` : ""));
        openRecurringModal(rec);
      },
    });
  }

  function renderRecurringCard(root) {
    const active = (state.data.recurringExpenses || []).filter((r) => !r.endDate || r.endDate >= todayStr());
    if (!active.length) return;
    const card = el("div", "recur-card");
    const head = el("div", "year-head");
    head.appendChild(el("h2", null, "Recurring expenses"));
    head.appendChild(el("span", "ycount", `${active.length} active`));
    card.appendChild(head);
    active.slice().sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach((r) => {
      const row = el("div", "recur-row");
      const bar = el("div", "bar");
      bar.style.background = financeColorOf(r.category);
      row.appendChild(bar);
      row.appendChild(el("span", "recur-badge", "↻ " + r.interval));
      const t = el("span", "etitle", r.note || r.category);
      t.title = r.note || r.category;
      row.appendChild(t);
      row.appendChild(el("span", "ecat", r.category));
      row.appendChild(el("span", "famount fnegative", "-" + formatMoney(r.amount)));
      row.onclick = () => openRecurringModal(r);
      card.appendChild(row);
    });
    root.appendChild(card);
  }

  // ---------- finance categories management ----------
  function openFinanceCatModal(cat) {
    const editing = !!cat;
    $("#financeCatModalTitle").textContent = editing ? "Edit finance category" : "Add finance category";
    $("#finCatOrigName").value = editing ? cat.name : "";
    $("#finCatName").value = editing ? cat.name : "";
    $("#finCatColorInput").value = editing ? cat.color : "#3bb2e2";
    const uses = $("#finCatUses");
    if (editing) {
      const n = (countBy(state.data.financeEntries, (f) => f.category)[cat.name] || 0)
        + (countBy(state.data.recurringExpenses, (r) => r.category)[cat.name] || 0);
      uses.textContent = n + (n === 1 ? " entry uses this" : " entries use this");
      uses.hidden = false;
    } else uses.hidden = true;
    $("#deleteFinanceCatBtn").hidden = !editing;
    $("#financeCatModal").hidden = false;
  }
  function closeFinanceCatModal() { $("#financeCatModal").hidden = true; }
  function cancelFinanceCatModal() { closeFinanceCatModal(); resolvePendingCatSelect(); }

  async function saveFinanceCatFromForm(ev) {
    ev.preventDefault();
    const orig = $("#finCatOrigName").value;
    const newName = $("#finCatName").value.trim();
    const color = $("#finCatColorInput").value;
    if (!newName) return;

    if (!orig) { // adding a new category
      if (state.data.financeCategories.some((c) => c.name === newName)) {
        toast("That category already exists", true);
        return;
      }
      state.data.financeCategories.push({ id: newName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: newName, color, createdAt: new Date().toISOString() });
      closeFinanceCatModal();
      rebuildFinanceColorMap(); buildCatFilter(); render();
      await persist();
      toast("Finance category added");
      resolvePendingCatSelect(newName);
      return;
    }

    const cat = state.data.financeCategories.find((c) => c.name === orig);
    if (!cat) return;
    if (newName !== cat.name && state.data.financeCategories.some((c) => c !== cat && c.name === newName)) {
      toast("A category with that name already exists", true);
      return;
    }
    cat.color = color;
    if (newName !== cat.name) {
      // id stays put across a rename (it's the merge/sync identity for this
      // category) — only the display name and the cascade below change.
      // (updatedAt isn't set here — persist() stamps it automatically for
      // anything that changed since the last save.)
      const old = cat.name;
      cat.name = newName;
      state.data.financeEntries.forEach((f) => { if (f.category === old) f.category = newName; });
      state.data.recurringExpenses.forEach((r) => { if (r.category === old) r.category = newName; });
      if (state.financeActiveCats.has(old)) { state.financeActiveCats.delete(old); state.financeActiveCats.add(newName); }
    }
    closeFinanceCatModal();
    rebuildFinanceColorMap(); buildCatFilter(); render();
    await persist();
    toast("Finance category saved");
  }

  function deleteCurrentFinanceCategory() {
    const cat = state.data.financeCategories.find((c) => c.name === $("#finCatOrigName").value);
    if (!cat) return;
    closeFinanceCatModal();
    deleteFinanceCategory(cat);
  }

  async function deleteFinanceCategory(cat) {
    const counts = countBy(state.data.financeEntries, (f) => f.category);
    const recurCounts = countBy(state.data.recurringExpenses, (r) => r.category);
    const n = (counts[cat.name] || 0) + (recurCounts[cat.name] || 0);
    if (n > 0) {
      if (cat.name === "Other") {
        toast("Can't delete “Other” while it's in use", true);
        return;
      }
      if (!confirm(`“${cat.name}” is used by ${n} entr${n === 1 ? "y" : "ies"}. Move them to “Other” and delete?`)) return;
      let other = state.data.financeCategories.find((c) => c.name === "Other");
      if (!other) { other = { id: "other", name: "Other", color: "#7a8a99" }; state.data.financeCategories.push(other); }
      state.data.financeEntries.forEach((f) => { if (f.category === cat.name) f.category = "Other"; });
      state.data.recurringExpenses.forEach((r) => { if (r.category === cat.name) r.category = "Other"; });
    } else {
      if (!confirm(`Delete category “${cat.name}”?`)) return;
    }
    state.data.financeCategories = state.data.financeCategories.filter((c) => c !== cat);
    state.financeActiveCats.delete(cat.name);
    rebuildFinanceColorMap();
    buildCatFilter(); render();
    await persist();
    toast("Finance category deleted");
  }

  // ---------- import / export ----------
  function exportFinanceJson() {
    const payload = {
      financeEntries: state.data.financeEntries,
      financeCategories: state.data.financeCategories,
      recurringExpenses: state.data.recurringExpenses,
    };
    download("lifelog-finance.json", JSON.stringify(payload, null, 2), "application/json");
  }
  function importFinanceJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!Array.isArray(incoming.financeEntries) && !Array.isArray(incoming.recurringExpenses)) throw new Error("not a Finance export");
        const built = buildImportItems(incoming);
        reviewAndImport("Import finance data", "Review what to bring in — pick individual items, toggle whole periods on/off, and choose which new categories to add. Items already in your data are hidden by default.", built);
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
  }
  function parseMoneyCell(s) {
    return parseFloat(String(s || "").replace(/[^0-9.\-]/g, "")) || 0;
  }
  // parses a yearly pivot-report export: each year has a 12-month x 3-column
  // (Amount, Category, Note) grid for real line items, a redundant
  // monthly-totals/category-totals matrix, and trailing ad-hoc big purchases
  // with a year-level amount + label but no month
  function parseFinanceCsv(text) {
    const rows = parseCsv(text);
    // category-totals, grand-total, and per-month-average rows repeat the
    // same label across every month column with zero/blank cells — they're
    // redundant aggregates, not real transactions, so skip the whole row
    const rowSkipLabels = new Set([
      ...state.data.financeCategories.map((c) => c.name),
      "Total", "Per Month",
    ]);
    // month-totals rows (the first 12 rows of each year block) carry a real
    // transaction in one of their month columns *and* a month name in the
    // trailing label — that label should only be excluded from the yearly
    // ad-hoc-expense check below, not used to skip the row's own monthly data
    const reservedLabels = new Set([...MONTHS.slice(1), ...rowSkipLabels]);
    const monthly = [];
    const yearly = [];
    let currentYear = null;
    for (const row of rows) {
      const yearMatch = (row[1] || "").trim().match(/^(\d{4}):$/);
      if (yearMatch) { currentYear = yearMatch[1]; continue; }
      if (!currentYear) continue;
      const label = (row[37] || "").trim();
      if (label && rowSkipLabels.has(label)) continue;
      for (let m = 0; m < 12; m++) {
        const amount = parseMoneyCell(row[0 + m * 3]);
        if (!amount) continue;
        const category = (row[1 + m * 3] || "").trim() || "Other";
        const note = (row[2 + m * 3] || "").trim();
        monthly.push({ date: `${currentYear}-${String(m + 1).padStart(2, "0")}-01`, amount, category, note });
      }
      if (label && !reservedLabels.has(label)) {
        const amount = parseMoneyCell(row[36]);
        if (amount) yearly.push({ date: currentYear, amount, category: "Other", note: label, yearly: true });
      }
    }
    if (currentYear === null) throw new Error("No year blocks found — is this the right CSV export?");
    return { monthly, yearly };
  }
  function importFinanceCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { monthly, yearly } = parseFinanceCsv(reader.result);
        const incoming = [...monthly, ...yearly];
        const built = buildImportItems({ financeEntries: incoming });
        reviewAndImport("Import Finance CSV", "Pick which entries to add, disable whole years/months at once, and choose which new categories to bring in. Entries already in your data are hidden by default — turn on the toggle below to review and re-import them anyway.", built);
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
  }
  function exportFinanceCsv() {
    if (!state.data.financeEntries.length) { toast("No finance entries to export"); return; }
    const items = state.data.financeEntries.map((entry) => ({ kind: "finance", entry, dup: false, checked: true }));
    openImportPicker({
      title: "Export Finance CSV",
      hint: "Pick which entries to export.",
      mode: "export",
      items,
      confirmLabel: "Export",
      onConfirm: (selected) => {
        if (!selected.length) { toast("Nothing selected"); return; }
        const rows = [["Date", "Amount", "Category", "Note", "Yearly"]];
        selected.map((i) => i.entry).sort((a, b) => b.date.localeCompare(a.date)).forEach((f) =>
          rows.push([f.date, f.amount, f.category, f.note || "", f.yearly ? "yes" : ""]));
        download("lifelog-finance.csv", rows.map((r) => r.map(csvEsc).join(",")).join("\n"), "text/csv");
        toast(`Exported ${selected.length} entr${selected.length === 1 ? "y" : "ies"}`);
      },
    });
  }

  // ---------- data lifecycle ----------
  function sanitizeFinanceEntry(f) {
    const out = {
      id: f.id || uid(),
      date: f.date || "",
      amount: Math.abs(+f.amount) || 0,
      category: f.category || "Other",
      createdAt: f.createdAt || null,
      updatedAt: backfillUpdatedAt(f),
    };
    if (f.yearly) {
      out.yearly = true;
      out.date = String(out.date).slice(0, 4);
    }
    if (f.note) out.note = f.note;
    return out;
  }
  const financeKey = (f) => `${(f.date || "").toLowerCase()}|${+f.amount}|${(f.category || "").toLowerCase()}|${(f.note || "").toLowerCase()}|${f.yearly ? 1 : 0}`;
  function sanitizeRecurring(r) {
    const out = {
      id: r.id || uid(),
      startDate: r.startDate || "",
      interval: ["weekly", "monthly", "yearly"].includes(r.interval) ? r.interval : "monthly",
      amount: Math.abs(+r.amount) || 0,
      category: r.category || "Other",
      createdAt: r.createdAt || null,
      updatedAt: backfillUpdatedAt(r),
    };
    if (r.note) out.note = r.note;
    if (r.endDate) out.endDate = r.endDate;
    if (r.overrides && typeof r.overrides === "object") {
      const overrides = {};
      for (const [date, ov] of Object.entries(r.overrides)) {
        if (!ov || typeof ov !== "object") continue;
        const clean = {};
        if (ov.amount != null) clean.amount = Math.abs(+ov.amount) || 0;
        if (ov.note != null) clean.note = String(ov.note);
        if (Object.keys(clean).length) overrides[date] = clean;
      }
      if (Object.keys(overrides).length) out.overrides = overrides;
    }
    return out;
  }
  const recurringKey = (r) => `${r.startDate}|${r.interval}|${+r.amount}|${(r.category || "").toLowerCase()}|${(r.note || "").toLowerCase()}`;

  // ---------- events ----------
  // Finance-specific DOM wiring; called from app.js's wire().
  function wire() {
    wireCategorySelect("#finCategory", "#financeModal", true);
    wireCategorySelect("#recCategory", "#recurringModal", true);

    $("#cancelFinanceBtn").onclick = closeFinanceModal;
    $("#financeForm").onsubmit = saveFinanceFromForm;
    $("#deleteFinanceBtn").onclick = deleteCurrentFinanceEntry;
    $("#finYearly").onchange = applyFinanceYearlyUI;

    $("#cancelRecurringBtn").onclick = closeRecurringModal;
    $("#recurringForm").onsubmit = saveRecurringFromForm;
    $("#deleteRecurringBtn").onclick = deleteCurrentRecurring;
    $("#linkPastExpensesBtn").onclick = () => {
      const rec = state.data.recurringExpenses.find((x) => x.id === $("#recId").value);
      if (rec) openLinkPastExpensesPicker(rec);
    };
    $("#cancelRecOccBtn").onclick = closeRecurringOccModal;
    $("#recurringOccForm").onsubmit = saveRecurringOccFromForm;
    $("#resetRecOccBtn").onclick = resetRecurringOcc;
    $("#editRecTemplateBtn").onclick = () => {
      const rec = state.data.recurringExpenses.find((x) => x.id === $("#recOccRecId").value);
      closeRecurringOccModal();
      if (rec) openRecurringModal(rec);
    };

    $("#cancelFinanceCatBtn").onclick = cancelFinanceCatModal;
    $("#financeCatForm").onsubmit = saveFinanceCatFromForm;
    $("#deleteFinanceCatBtn").onclick = deleteCurrentFinanceCategory;

    $("#exportFinanceJsonBtn").onclick = exportFinanceJson;
    $("#exportFinanceCsvBtn").onclick = exportFinanceCsv;
    $("#importFinanceJsonBtn").onclick = () => $("#importFinanceJsonInput").click();
    $("#importFinanceJsonInput").onchange = (e) => { if (e.target.files[0]) importFinanceJson(e.target.files[0]); e.target.value = ""; };
    $("#importFinanceCsvBtn").onclick = () => $("#importFinanceCsvInput").click();
    $("#importFinanceCsvInput").onchange = (e) => { if (e.target.files[0]) importFinanceCsv(e.target.files[0]); e.target.value = ""; };
  }

  window.LifeLogFinance = {
    init,
    wire,
    // data lifecycle (used by app.js's emptyData/normalize/import infra)
    seedFinanceCategories,
    sanitizeFinanceEntry,
    sanitizeRecurring,
    financeKey,
    recurringKey,
    // pure date/recurrence math (exported for test/finance.test.js)
    recurringOccurrences,
    nextRecurringDate,
    addMonthsClamped,
    localDateStr,
    closestOccurrenceDate,
    parseMoneyCell,
    monthSortAsc,
    // shared lookups/formatting (used by the shared import picker rows)
    rebuildFinanceColorMap,
    financeColorOf,
    formatMoney,
    financeYears,
    // views (dispatched from app.js's render())
    renderFinanceEntries,
    renderFinanceStats,
    // modals (add menu, filter-chip edit, Escape/overlay close)
    openFinanceModal,
    closeFinanceModal,
    openRecurringModal,
    openFinanceCatModal,
    cancelFinanceCatModal,
  };
})();
