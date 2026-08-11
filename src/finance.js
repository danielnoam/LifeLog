// LifeLog — finance: expenses, recurring expenses (with per-occurrence
// overrides, plan changes, and the link-past-expenses picker), finance
// categories, the Ledger + Summary views, and finance import/export.
// Extracted from app.js;
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

  // ---------- amount math expressions ----------
  // The amount fields accept a plain number or a basic arithmetic expression
  // ("50-25", "12.5*3", "(10+5)/2") so quick sums/splits can be entered
  // inline. evalMathExpr is a tiny self-contained recursive-descent evaluator
  // (no eval()/Function — CSP-safe and can't run arbitrary code) supporting
  // + - * / and parentheses over decimal numbers. Returns a finite number, or
  // null for empty/invalid/incomplete input (e.g. a trailing "50-").
  function evalMathExpr(raw) {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    if (!s || !/^[0-9+\-*/().,\s]+$/.test(s)) return null;
    const expr = s.replace(/,/g, ""); // ignore thousands separators
    let i = 0;
    const skip = () => { while (expr[i] === " ") i++; };
    function parseExpr() {
      let v = parseTerm();
      if (v === null) return null;
      for (skip(); expr[i] === "+" || expr[i] === "-"; skip()) {
        const op = expr[i++];
        const r = parseTerm();
        if (r === null) return null;
        v = op === "+" ? v + r : v - r;
      }
      return v;
    }
    function parseTerm() {
      let v = parseFactor();
      if (v === null) return null;
      for (skip(); expr[i] === "*" || expr[i] === "/"; skip()) {
        const op = expr[i++];
        const r = parseFactor();
        if (r === null) return null;
        v = op === "*" ? v * r : v / r;
      }
      return v;
    }
    function parseFactor() {
      skip();
      if (expr[i] === "+") { i++; return parseFactor(); }
      if (expr[i] === "-") { i++; const r = parseFactor(); return r === null ? null : -r; }
      if (expr[i] === "(") {
        i++;
        const v = parseExpr();
        skip();
        if (v === null || expr[i] !== ")") return null;
        i++;
        return v;
      }
      const start = i;
      while (i < expr.length && /[0-9.]/.test(expr[i])) i++;
      if (i === start) return null;
      const num = parseFloat(expr.slice(start, i));
      return isNaN(num) ? null : num;
    }
    const val = parseExpr();
    skip();
    if (i !== expr.length || val === null || !isFinite(val)) return null;
    return Math.round(val * 100) / 100; // clamp to cents
  }

  // Reads an amount input, resolving any math expression, as a non-negative
  // number of cents (expenses are stored positive). Falls back to parseFloat
  // for a plain number the evaluator rejects; returns 0 when unparseable, so
  // callers keep their existing "amount falsy → don't save" guard.
  function readAmount(sel) {
    const raw = $(sel).value;
    const evaled = evalMathExpr(raw);
    const n = evaled != null ? evaled : parseFloat(raw);
    const v = Math.abs(n);
    return isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  // Wires an amount input so a completed math expression auto-resolves to its
  // result: ~800ms after typing stops, and immediately on blur. Plain numbers
  // (and half-typed expressions like "50-") are left untouched.
  function attachMathInput(sel) {
    const input = $(sel);
    if (!input || input._mathWired) return;
    input._mathWired = true;
    let timer = null;
    const resolve = () => {
      const raw = input.value;
      // Only touch values that actually contain an operator — a leading unary
      // minus ("-25") on its own isn't a computation, so strip it before the check.
      if (!/[+*/()]|\d\s*-/.test(raw)) return;
      const val = evalMathExpr(raw);
      if (val === null) return;
      const out = String(val);
      if (out === raw.trim()) return;
      input.value = out;
      input.classList.add("math-eval-flash");
      setTimeout(() => input.classList.remove("math-eval-flash"), 450);
    };
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(resolve, 800);
    });
    input.addEventListener("blur", () => { clearTimeout(timer); resolve(); });
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
  // That retroactive reach is deliberate for a correction ("this was always
  // 50, I typed 40") but wrong for a real change in terms — for those, see
  // splitRecurring, which ends this template and starts a linked successor
  // so the past keeps the terms it was actually paid at.
  // rec.overrides (optional) keys a sparse { amount?, note?, skip? } patch
  // by occurrence date, for the rare month that genuinely differed (a
  // price change, a one-off note, or a month skipped entirely) without
  // dragging every other occurrence along.
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
  // ---------- pauses ----------
  // rec.pauses (optional) is a list of { from, to? } inclusive date ranges
  // the bill was suspended for — a subscription frozen over the summer, a
  // gym membership on hold. An absent `to` means "still paused, no end
  // decided yet", which is the case a per-occurrence skip can't express at
  // all: the occurrences it would need to skip haven't been generated yet.
  // The schedule itself keeps ticking underneath (same anchor day), so
  // resuming picks the billing date back up where it always was rather
  // than re-anchoring to the resume date.
  function isPausedOn(rec, dateStr) {
    return (rec.pauses || []).some((p) => p && p.from && dateStr >= p.from && (!p.to || dateStr <= p.to));
  }
  // Sorted, with overlapping/adjacent ranges fused — so the list stays
  // readable after a few edits and "is this date paused" can't depend on
  // which of two overlapping entries it happened to hit first.
  function normalizePauses(pauses) {
    const clean = (pauses || [])
      .filter((p) => p && p.from)
      .map((p) => (p.to && p.to < p.from ? { from: p.to, to: p.from } : { from: p.from, to: p.to })) // tolerate a backwards range
      .sort((a, b) => a.from.localeCompare(b.from));
    const out = [];
    for (const p of clean) {
      const last = out[out.length - 1];
      // an open-ended range swallows everything after it, so nothing can follow one
      if (last && !last.to) break;
      if (last && p.from <= addDaysStr(last.to, 1)) {
        if (!p.to) delete last.to; else if (p.to > last.to) last.to = p.to;
        continue;
      }
      out.push(p.to ? { from: p.from, to: p.to } : { from: p.from });
    }
    return out;
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
      // A paused occurrence rides on the same `skipped` flag a one-off skip
      // uses, so every total/count downstream already excludes it — `paused`
      // only changes how it's labelled and whether it's individually
      // un-skippable (it isn't; that's the pause's job).
      const paused = isPausedOn(rec, dateStr);
      out.push({
        id: `${rec.id}:${n}`, date: dateStr, type: "expense",
        amount: ov && ov.amount != null ? ov.amount : rec.amount,
        category: rec.category,
        note: ov && ov.note != null ? ov.note : rec.note,
        createdAt: rec.createdAt,
        recurringId: rec.id, virtual: true, overridden: !!ov,
        skipped: paused || !!(ov && ov.skip),
        paused,
      });
      n++;
      d = nextRecurringDate(d, rec.interval, anchorDay);
    }
    return out;
  }

  function addDaysStr(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    d.setDate(d.getDate() + n);
    return localDateStr(d);
  }

  // The first date the template's own schedule lands on strictly after
  // `fromDateStr` — the natural default for "when does the new plan take
  // over", so a plan change falls on a real billing date instead of
  // mid-period. Ignores endDate on purpose: this answers "where would the
  // next period start", which is exactly the date you'd stop at.
  function nextOccurrenceDateAfter(rec, fromDateStr) {
    const start = new Date(rec.startDate + "T00:00:00");
    if (isNaN(start.getTime())) return fromDateStr;
    const anchorDay = start.getDate();
    let d = start;
    let guard = 0;
    while (localDateStr(d) <= fromDateStr && guard++ < 5000) d = nextRecurringDate(d, rec.interval, anchorDay);
    return localDateStr(d);
  }

  // ---------- plan changes ----------
  // A bill whose price/schedule/category changes isn't the same plan any
  // more — but its past occurrences really did happen at the old terms.
  // Editing the template in place would retroactively rewrite them (and,
  // when the interval or start date moves, silently orphan every override,
  // since those are keyed by an occurrence date that no longer exists).
  // So a plan change *splits*: the old template gets an end date one day
  // before the change takes effect and keeps generating its history exactly
  // as it was; a new template takes over from that date, linked back via
  // prevId so the two read as one bill's history (see planChain).
  function splitRecurring(rec, effectiveFrom, next, newId, now) {
    const prev = { ...rec, endDate: addDaysStr(effectiveFrom, -1) };
    const created = {
      id: newId,
      startDate: effectiveFrom,
      interval: next.interval,
      amount: next.amount,
      category: next.category,
      createdAt: now,
      prevId: rec.id,
    };
    if (next.note) created.note = next.note;
    // A stop date is about the bill, not the terms — the tail after the
    // split still ends when the old plan said it would, so it moves to
    // whichever plan now owns that stretch. (Callers reject a split past
    // the stop date, so there's always a tail to hand over.)
    if (rec.endDate) created.endDate = rec.endDate;

    // Overrides belong to whichever plan actually generates that date.
    // Anything before the split stays behind; anything on/after moves over —
    // but only if the new schedule still lands on that exact date. A plan
    // that changed interval usually doesn't, and an override for a date
    // nothing generates is invisible dead weight, so it's dropped and
    // reported back to the caller rather than left to rot in the file.
    const kept = {}, carried = {};
    for (const [date, ov] of Object.entries(rec.overrides || {})) {
      if (date < effectiveFrom) kept[date] = ov; else carried[date] = ov;
    }
    const dropped = [];
    const carriedDates = Object.keys(carried);
    if (carriedDates.length) {
      const last = carriedDates.slice().sort().pop();
      const generated = new Set(recurringOccurrences(created, new Date(last + "T00:00:00")).map((o) => o.date));
      for (const date of carriedDates) if (!generated.has(date)) { dropped.push(date); delete carried[date]; }
    }
    if (Object.keys(kept).length) prev.overrides = kept; else delete prev.overrides;
    if (Object.keys(carried).length) created.overrides = carried;

    // A pause is a stretch of calendar, not a set of dates, so one straddling
    // the split is clipped in two rather than assigned to a single side —
    // the bill was suspended across the change, and both plans have to know
    // it. (Unlike overrides, no pause is ever dropped: a range doesn't need
    // the schedule to land on it to mean something.)
    const keptPauses = [], carriedPauses = [];
    for (const p of rec.pauses || []) {
      const endsBefore = p.to && p.to < effectiveFrom;
      if (endsBefore) { keptPauses.push({ ...p }); continue; }
      if (p.from >= effectiveFrom) { carriedPauses.push({ ...p }); continue; }
      keptPauses.push({ from: p.from, to: addDaysStr(effectiveFrom, -1) });
      carriedPauses.push(p.to ? { from: effectiveFrom, to: p.to } : { from: effectiveFrom });
    }
    if (keptPauses.length) prev.pauses = keptPauses; else delete prev.pauses;
    if (carriedPauses.length) created.pauses = carriedPauses;

    return { prev, created, dropped };
  }

  // Every plan one bill has been through, oldest first, walked in both
  // directions from `rec` along prevId. Guards against a cycle (a corrupted
  // or hand-edited file) so this can never spin forever.
  function planChain(all, rec) {
    if (!rec) return [];
    const list = all || [];
    const byId = new Map(list.map((r) => [r.id, r]));
    const seen = new Set([rec.id]);
    const chain = [rec];
    let cur = rec;
    while (cur.prevId && byId.has(cur.prevId) && !seen.has(cur.prevId)) {
      cur = byId.get(cur.prevId);
      seen.add(cur.id);
      chain.unshift(cur);
    }
    cur = rec;
    for (;;) {
      const nx = list.find((x) => x.prevId === cur.id && !seen.has(x.id));
      if (!nx) break;
      seen.add(nx.id);
      chain.push(nx);
      cur = nx;
    }
    return chain;
  }
  // real finance entries plus every recurring template's occurrences through
  // today — the merged list everything else (list view, stats, filters)
  // should read instead of state.data.financeEntries directly
  // Skipped occurrences are still returned here (so the Ledger can show
  // them, faded out, rather than making them vanish outright) — every
  // total/sum downstream filters them out itself; see renderFinanceEntries'
  // month/year counts and renderFinanceStats' `items`.
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
      head.appendChild(el("span", "ycount", `${byYear[y].filter((f) => !f.skipped).length} entries`));
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
            const countedItems = monthItems.filter((f) => !f.skipped);
            const label = mm === 0 ? "Yearly" : MONTHS[m];
            card.appendChild(monthCardHeader(label, countedItems.length, monthItems.filter((f) => !f.virtual), {
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
            const total = countedItems.reduce((s, f) => s + f.amount, 0);
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
    const row = el("div", "entry finance-entry" + (f.yearly ? " yearly-expense" : "") + (f.skipped ? " is-skipped" : ""));
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
    if (f.skipped) row.appendChild(el("span", "skipped-badge", f.paused ? "Paused" : "Skipped"));
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
    // Skipped occurrences are excluded here (unlike the Ledger, which still
    // lists them faded out) — Stats has no per-row list, only aggregates,
    // and a skipped month was never really spent.
    const items = getFilteredFinance().filter((f) => !f.skipped);
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
    renderFinanceHighlights(root, items);

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
    renderFinanceTrendCard(root, items);
    renderRecurringSplitCard(root, items);
    renderTopExpensesCard(root, items);
  }

  // Monthly spend totals keyed by year*12+(month-1) so consecutive calendar
  // months are consecutive integers. Yearly ad-hoc entries carry no month
  // (financeMonthOf → 0) and are left out — they'd distort a per-month view.
  function financeMonthlyTotals(items) {
    const totals = {};
    for (const f of items) {
      if (f.yearly) continue;
      const k = financeYearOf(f) * 12 + (financeMonthOf(f) - 1);
      totals[k] = (totals[k] || 0) + f.amount;
    }
    return totals;
  }
  function monthKeyLabel(k, shortYear) {
    const y = Math.floor(k / 12);
    return MONTHS[(k % 12) + 1].slice(0, 3) + " " + (shortYear ? "'" + String(y).slice(2) : y);
  }

  // At-a-glance Ledger insights, mirroring the Journal Stats "Highlights"
  // card: real average over the months you actually spent (not total/12),
  // the single biggest month, the top spending category, and this calendar
  // year vs last. Monthly figures skip yearly ad-hoc entries; the
  // year-over-year delta counts everything.
  function renderFinanceHighlights(root, items) {
    if (items.length < 2) return;
    const monthTotals = financeMonthlyTotals(items);
    const monthKeys = Object.keys(monthTotals).map(Number);

    const catTotals = {};
    for (const f of items) catTotals[f.category] = (catTotals[f.category] || 0) + f.amount;
    const topCat = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a])[0];

    const thisYear = new Date().getFullYear();
    const yearTotal = (y) => items.filter((f) => financeYearOf(f) === y).reduce((s, f) => s + f.amount, 0);
    const delta = yearTotal(thisYear) - yearTotal(thisYear - 1);

    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Highlights"));
    const row = el("div", "stat-big");

    if (monthKeys.length) {
      const avg = monthKeys.reduce((s, k) => s + monthTotals[k], 0) / monthKeys.length;
      row.appendChild(moneyStatItem(avg, "avg / month", "var(--expense)"));
      let bigK = monthKeys[0];
      for (const k of monthKeys) if (monthTotals[k] > monthTotals[bigK]) bigK = k;
      row.appendChild(moneyStatItem(monthTotals[bigK], "biggest (" + monthKeyLabel(bigK, false) + ")", "var(--expense)"));
    }

    // Top category — a text (not money) stat, tinted to the category.
    const catItem = el("div", "item");
    const catN = el("div", "n", topCat);
    catN.style.color = financeColorOf(topCat);
    catItem.appendChild(catN);
    catItem.appendChild(el("div", "l", "top category"));
    row.appendChild(catItem);

    // This calendar year vs last — a signed money delta (formatMoney already
    // prefixes "-" for negatives; add a leading "+" when spend went up).
    const dItem = el("div", "item");
    dItem.appendChild(el("div", "n", (delta > 0 ? "+" : "") + formatMoney(delta)));
    dItem.appendChild(el("div", "l", "vs " + (thisYear - 1)));
    row.appendChild(dItem);

    card.appendChild(row);
    root.appendChild(card);
  }

  // Recent spend trend — the last up to 12 calendar months on one continuous
  // timeline (unlike "By month", which is a single year), so the trajectory
  // is visible at a glance. Empty months inside the window show a zero bar so
  // gaps read as gaps rather than being silently skipped.
  function renderFinanceTrendCard(root, items) {
    const monthTotals = financeMonthlyTotals(items);
    const keys = Object.keys(monthTotals).map(Number);
    if (keys.length < 2) return; // a single month isn't a trend
    const end = Math.max(...keys);
    const start = Math.max(Math.min(...keys), end - 11);
    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Spend trend"));
    const window = [];
    for (let k = start; k <= end; k++) window.push(k);
    const max = Math.max(1, ...window.map((k) => monthTotals[k] || 0));
    for (const k of window) {
      card.appendChild(barRow(monthKeyLabel(k, true), monthTotals[k] || 0, max, "var(--expense)", null, formatMoney));
    }
    root.appendChild(card);
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
    // Only an existing, dated entry can seed a recurring template — a yearly
    // entry carries no month/day for the schedule to anchor to.
    $("#makeRecurringBtn").hidden = yearly || !$("#financeId").value;
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
    const amount = readAmount("#finAmount");
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
  // Set when the recurring modal was opened to convert an existing one-off
  // finance entry (see makeEntryRecurring): the entry is only removed once
  // the template is actually saved, so cancelling leaves it untouched.
  let pendingConvertEntryId = null;

  function openRecurringModal(rec, prefill) {
    const editing = !!rec;
    const p = prefill || {};
    $("#recurringModalTitle").textContent = editing ? "Edit recurring expense"
      : (p.convertFromId ? "Make recurring" : "Add recurring expense");
    pendingConvertEntryId = editing ? null : (p.convertFromId || null);
    $("#recConvertHint").hidden = !pendingConvertEntryId;
    $("#recId").value = editing ? rec.id : "";
    $("#recStart").value = editing ? rec.startDate : (p.startDate || todayStr());
    $("#recEnd").value = editing ? (rec.endDate || "") : "";
    $("#recInterval").value = editing ? rec.interval : "monthly";
    $("#recAmount").value = editing ? rec.amount : (p.amount != null ? p.amount : "");
    fillCategorySelect($("#recCategory"), state.data.financeCategories,
      editing ? rec.category : (p.category || (state.data.financeCategories[0] && state.data.financeCategories[0].name)));
    $("#recNote").value = editing ? (rec.note || "") : (p.note || "");
    $("#deleteRecurringBtn").hidden = !editing;
    $("#recTools").hidden = !editing;

    // A plan that's already been superseded can't be split again — the
    // change belongs on whichever plan is currently in force, so point at
    // that one instead of quietly forking the chain.
    const chain = editing ? planChain(state.data.recurringExpenses, rec) : [];
    const superseded = editing && chain[chain.length - 1] !== rec;
    $("#changePlanBtn").hidden = superseded;
    renderPlanTrail(rec, chain);
    renderPauses(rec);
    // The pause button doubles as the resume button while a pause is in
    // force — resuming is the only thing you'd want from it right then, and
    // stacking a second button for it just to sit greyed out most of the
    // time isn't worth the row.
    const pausedNow = editing && isPausedOn(rec, todayStr());
    $("#pauseBtn").textContent = pausedNow ? "▶ Resume now" : "⏸ Pause…";
    $("#pauseBtn").title = pausedNow
      ? "End the current pause so this bill starts generating occurrences again"
      : "Suspend this bill for a stretch of time without deleting it";

    const occWrap = $("#recOccurrences");
    if (editing) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const occ = recurringOccurrences(rec, today).slice().sort((a, b) => b.date.localeCompare(a.date));
      const list = $("#recOccList");
      list.innerHTML = "";
      occ.forEach((o) => {
        const row = el("div", "rec-occ-row" + (o.overridden ? " is-overridden" : "") + (o.skipped ? " is-skipped" : ""));
        row.appendChild(el("span", "rec-occ-date", o.date + (o.overridden ? " *" : "")));
        row.appendChild(el("span", "rec-occ-amount", o.paused ? "Paused" : (o.skipped ? "Skipped" : "-" + formatMoney(o.amount))));
        row.title = o.paused ? "Paused — edit the pause above to change this"
          : (o.skipped ? "Skipped — click to restore or edit" : "Edit this occurrence");
        row.onclick = () => openRecurringOccModal(rec, o);
        list.appendChild(row);
      });
      occWrap.hidden = false;
    } else {
      occWrap.hidden = true;
    }
    $("#recurringModal").hidden = false;
  }
  function closeRecurringModal() { $("#recurringModal").hidden = true; pendingConvertEntryId = null; }

  // The plan history strip: every template this bill has been through,
  // oldest first. Only rendered once a plan change has actually happened —
  // a bill that's never changed is just itself, and a one-row trail is noise.
  function renderPlanTrail(rec, chain) {
    const wrap = $("#recPlanTrail");
    const list = $("#recPlanTrailList");
    list.innerHTML = "";
    if (!rec || chain.length < 2) { wrap.hidden = true; return; }
    chain.forEach((r) => {
      const isCurrent = r.id === rec.id;
      const row = el("div", "plan-trail-row" + (isCurrent ? " is-current" : ""));
      row.appendChild(el("span", "plan-trail-range", r.startDate + " → " + (r.endDate || "now")));
      row.appendChild(el("span", "plan-trail-terms", formatMoney(r.amount) + " · " + r.interval));
      if (isCurrent) {
        row.title = "This plan";
      } else {
        row.title = "Open this plan";
        row.onclick = () => openRecurringModal(r);
      }
      list.appendChild(row);
    });
    wrap.hidden = false;
  }

  // ---------- pauses (list + modal) ----------
  function pauseLabel(p) {
    return p.from + " → " + (p.to || "still paused");
  }
  function renderPauses(rec) {
    const wrap = $("#recPauses");
    const list = $("#recPauseList");
    list.innerHTML = "";
    const pauses = (rec && rec.pauses) || [];
    if (!pauses.length) { wrap.hidden = true; return; }
    const today = todayStr();
    pauses.forEach((p, i) => {
      const live = today >= p.from && (!p.to || today <= p.to);
      const row = el("div", "pause-row" + (live ? " is-live" : ""));
      row.appendChild(el("span", "pause-range", pauseLabel(p)));
      if (live) row.appendChild(el("span", "pause-tag", "now"));
      row.title = "Edit this pause";
      row.onclick = () => openPauseModal(rec, i);
      list.appendChild(row);
    });
    wrap.hidden = false;
  }

  // The pause currently in force, if any — what "Resume now" acts on.
  function livePauseIndex(rec, dateStr) {
    return (rec.pauses || []).findIndex((p) => dateStr >= p.from && (!p.to || dateStr <= p.to));
  }

  function openPauseModal(rec, index) {
    const editing = index != null && index >= 0;
    const p = editing ? rec.pauses[index] : null;
    $("#pauseModalTitle").textContent = editing ? "Edit pause" : "Pause this expense";
    $("#pauseRecId").value = rec.id;
    $("#pauseIndex").value = editing ? String(index) : "";
    $("#pauseFrom").value = editing ? p.from : todayStr();
    $("#pauseTo").value = editing ? (p.to || "") : "";
    $("#deletePauseBtn").hidden = !editing;
    $("#pauseModal").hidden = false;
  }
  function closePauseModal() { $("#pauseModal").hidden = true; }

  async function savePauseFromForm(ev) {
    ev.preventDefault();
    const rec = state.data.recurringExpenses.find((x) => x.id === $("#pauseRecId").value);
    if (!rec) return;
    const from = $("#pauseFrom").value;
    const to = $("#pauseTo").value;
    if (!from) return;
    if (to && to < from) { toast("A pause can't end before it starts", true); return; }
    const idxRaw = $("#pauseIndex").value;
    const entry = to ? { from, to } : { from };
    const pauses = (rec.pauses || []).slice();
    if (idxRaw === "") pauses.push(entry); else pauses.splice(+idxRaw, 1, entry);
    rec.pauses = normalizePauses(pauses);
    closePauseModal();
    render();
    await persist();
    toast(to ? `Paused ${from} → ${to}` : `Paused from ${from} — resume whenever`);
    openRecurringModal(rec);
  }

  async function deleteCurrentPause() {
    const rec = state.data.recurringExpenses.find((x) => x.id === $("#pauseRecId").value);
    const idxRaw = $("#pauseIndex").value;
    if (!rec || idxRaw === "") return;
    const pauses = (rec.pauses || []).slice();
    pauses.splice(+idxRaw, 1);
    if (pauses.length) rec.pauses = pauses; else delete rec.pauses;
    closePauseModal();
    render();
    await persist();
    toast("Pause removed — those occurrences are back");
    openRecurringModal(rec);
  }

  // Ends whichever pause covers today, so the bill picks its schedule back
  // up from tomorrow. A pause that hadn't started yet is left alone — you
  // can't resume from something you're not in.
  async function resumeCurrentRecurring(rec) {
    const today = todayStr();
    const i = livePauseIndex(rec, today);
    if (i < 0) return;
    const p = rec.pauses[i];
    const pauses = rec.pauses.slice();
    // A pause that began today never suppressed anything — drop it outright
    // rather than leaving a zero-length range behind.
    if (p.from >= today) pauses.splice(i, 1);
    else pauses.splice(i, 1, { from: p.from, to: addDaysStr(today, -1) });
    if (pauses.length) rec.pauses = normalizePauses(pauses); else delete rec.pauses;
    render();
    await persist();
    toast("Resumed — this bill is generating occurrences again");
    openRecurringModal(rec);
  }

  // Edits one generated occurrence's amount/note without touching the
  // template or any other occurrence — stored as a sparse patch on
  // rec.overrides, keyed by that occurrence's date.
  function openRecurringOccModal(rec, occ) {
    $("#recurringOccModalTitle").textContent = occ.date;
    $("#recOccRecId").value = rec.id;
    $("#recOccDate").value = occ.date;
    $("#recOccAmount").value = occ.amount;
    $("#recOccNote").value = occ.note || "";
    // While a pause covers this date the skip checkbox has nothing to say —
    // unticking it wouldn't bring the occurrence back, since the pause is
    // what's suppressing it. Lock it and point at where to actually fix it.
    $("#recOccSkip").checked = !!occ.skipped;
    $("#recOccSkip").disabled = !!occ.paused;
    $("#recOccPausedHint").hidden = !occ.paused;
    $("#resetRecOccBtn").hidden = !occ.overridden;
    $("#recurringOccModal").hidden = false;
  }
  function closeRecurringOccModal() { $("#recurringOccModal").hidden = true; }

  async function saveRecurringOccFromForm(ev) {
    ev.preventDefault();
    const rec = state.data.recurringExpenses.find((x) => x.id === $("#recOccRecId").value);
    if (!rec) return;
    const date = $("#recOccDate").value;
    const amount = readAmount("#recOccAmount");
    const note = $("#recOccNote").value.trim();
    // A paused date's checkbox is ticked and locked purely to reflect the
    // pause, so reading it here would bake a skip override in that outlives
    // the pause. The pause is already the reason it's suppressed.
    const skip = !isPausedOn(rec, date) && $("#recOccSkip").checked;
    const ov = {};
    if (skip) ov.skip = true;
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
    const endDate = $("#recEnd").value;
    const interval = $("#recInterval").value;
    const amount = readAmount("#recAmount");
    const category = $("#recCategory").value;
    const note = $("#recNote").value.trim();
    if (!startDate || !amount) return;
    if (endDate && endDate < startDate) { toast("The stop date can't be before the start date", true); return; }
    const converted = pendingConvertEntryId;
    if (id) {
      const r = state.data.recurringExpenses.find((x) => x.id === id);
      Object.assign(r, { startDate, interval, amount, category });
      if (note) r.note = note; else delete r.note;
      if (endDate) r.endDate = endDate; else delete r.endDate;
    } else {
      const item = { id: uid(), startDate, interval, amount, category, createdAt: new Date().toISOString() };
      if (note) item.note = note;
      if (endDate) item.endDate = endDate;
      state.data.recurringExpenses.push(item);
      // The entry this was converted from is only dropped now that the
      // template exists — the template regenerates it as its first occurrence.
      if (converted) state.data.financeEntries = state.data.financeEntries.filter((x) => x.id !== converted);
    }
    closeRecurringModal();
    buildYearFilter();
    render();
    await persist();
    toast(id ? "Recurring expense updated" : (converted ? "Converted to a recurring expense" : "Recurring expense added"));
  }

  // ---------- changing a plan ----------
  // Edits that should apply from a date forward rather than rewriting
  // history — a price rise, a monthly bill going yearly, a re-categorised
  // subscription. See splitRecurring for what that actually does to the data.
  function openChangePlanModal(rec) {
    if (!rec) return;
    $("#planRecId").value = rec.id;
    $("#planCurrent").textContent =
      `Currently ${formatMoney(rec.amount)} ${rec.interval}, ${rec.category}, since ${rec.startDate}.`;
    $("#planFrom").value = nextOccurrenceDateAfter(rec, todayStr());
    $("#planFrom").min = addDaysStr(rec.startDate, 1);
    $("#planInterval").value = rec.interval;
    $("#planAmount").value = rec.amount;
    fillCategorySelect($("#planCategory"), state.data.financeCategories, rec.category);
    $("#planNote").value = rec.note || "";
    $("#changePlanModal").hidden = false;
  }
  function closeChangePlanModal() { $("#changePlanModal").hidden = true; }

  async function saveChangePlanFromForm(ev) {
    ev.preventDefault();
    const rec = state.data.recurringExpenses.find((x) => x.id === $("#planRecId").value);
    if (!rec) return;
    const effectiveFrom = $("#planFrom").value;
    const amount = readAmount("#planAmount");
    if (!effectiveFrom || !amount) return;
    if (effectiveFrom <= rec.startDate) {
      toast("That's on or before this plan's start date — edit the plan itself instead", true);
      return;
    }
    if (rec.endDate && effectiveFrom > rec.endDate) {
      toast(`This plan already stops on ${rec.endDate} — pick an earlier date`, true);
      return;
    }
    const next = {
      interval: $("#planInterval").value,
      amount,
      category: $("#planCategory").value,
      note: $("#planNote").value.trim(),
    };
    const { prev, created, dropped } = splitRecurring(rec, effectiveFrom, next, uid(), new Date().toISOString());
    const i = state.data.recurringExpenses.indexOf(rec);
    state.data.recurringExpenses.splice(i, 1, prev, created);

    closeChangePlanModal();
    closeRecurringModal();
    buildYearFilter();
    render();
    await persist();
    toast(`New plan from ${effectiveFrom} — earlier occurrences keep the old one`
      + (dropped.length ? `. ${dropped.length} per-occurrence edit${dropped.length === 1 ? "" : "s"} dropped (the new schedule doesn't land on those dates)` : ""));
    openRecurringModal(created);
  }

  // Turns a recurring expense into ordinary one-off finance entries: every
  // occurrence it generated becomes a real, individually editable entry and
  // the template goes away. Skipped occurrences are left out — they were
  // excluded from every total, so materializing them would resurrect spend
  // that never happened.
  async function convertRecurringToEntries() {
    const id = $("#recId").value;
    const r = state.data.recurringExpenses.find((x) => x.id === id);
    if (!r) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const occs = recurringOccurrences(r, today).filter((o) => !o.skipped);
    if (!confirm(`Convert this recurring expense into ${occs.length} one-off entr${occs.length === 1 ? "y" : "ies"}? It stops generating new ones, and each entry becomes editable on its own.`)) return;
    const now = new Date().toISOString();
    occs.forEach((o) => {
      const entry = { id: uid(), date: o.date, type: "expense", amount: o.amount, category: o.category, createdAt: now };
      if (o.note) entry.note = o.note;
      state.data.financeEntries.push(entry);
    });
    state.data.recurringExpenses = state.data.recurringExpenses.filter((x) => x.id !== id);
    closeRecurringModal();
    buildYearFilter();
    render();
    await persist();
    toast(`Converted to ${occs.length} one-off entr${occs.length === 1 ? "y" : "ies"}`);
  }

  // Removes the template outright. Its occurrences are generated on the fly,
  // never stored, so they simply stop existing — which is the point when a
  // recurring expense was a mistake, but is *not* what you want for a bill
  // you actually paid, hence the pointer to "Convert to entries".
  async function deleteCurrentRecurring() {
    const id = $("#recId").value;
    if (!id) return;
    const r = state.data.recurringExpenses.find((x) => x.id === id);
    if (!r) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const n = recurringOccurrences(r, today).length;
    if (!confirm(`Delete this recurring expense and the ${n} occurrence${n === 1 ? "" : "s"} it generated? To keep that history, cancel and use “Convert to entries” instead.`)) return;
    state.data.recurringExpenses = state.data.recurringExpenses.filter((x) => x.id !== id);
    closeRecurringModal();
    buildYearFilter();
    render();
    await persist();
    toast("Recurring expense deleted");
  }

  // One-off → recurring: opens the recurring modal prefilled from an
  // existing entry rather than converting on the spot, so the interval can
  // be picked before the template starts backfilling occurrences from the
  // entry's date. The entry itself is only removed once that's saved.
  function makeEntryRecurring() {
    const entry = state.data.financeEntries.find((x) => x.id === $("#financeId").value);
    if (!entry) return;
    if (entry.yearly) { toast("Yearly entries have no month or day to repeat from", true); return; }
    closeFinanceModal();
    openRecurringModal(null, {
      convertFromId: entry.id,
      startDate: entry.date,
      amount: entry.amount,
      category: entry.category,
      note: entry.note || "",
    });
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
    const all = state.data.recurringExpenses || [];
    const today = todayStr();
    const active = all.filter((r) => !r.endDate || r.endDate >= today);
    // Ended plans (stopped, or superseded by a plan change) still generate
    // the history in the Ledger, so they need to stay openable — otherwise
    // the only way back to one is hunting down one of its occurrences.
    const ended = all.filter((r) => r.endDate && r.endDate < today);
    if (!active.length && !ended.length) return;
    const card = el("div", "recur-card");
    const head = el("div", "year-head");
    head.appendChild(el("h2", null, "Recurring expenses"));
    head.appendChild(el("span", "ycount", `${active.length} active`));
    card.appendChild(head);

    const addRow = (r, isEnded) => {
      const row = el("div", "recur-row" + (isEnded ? " is-ended" : ""));
      const bar = el("div", "bar");
      bar.style.background = financeColorOf(r.category);
      row.appendChild(bar);
      row.appendChild(el("span", "recur-badge", "↻ " + r.interval));
      const t = el("span", "etitle", r.note || r.category);
      t.title = r.note || r.category;
      row.appendChild(t);
      row.appendChild(el("span", "ecat", r.category));
      if (isEnded) row.appendChild(el("span", "recur-badge", "ended " + r.endDate));
      else if (isPausedOn(r, today)) {
        const p = r.pauses[livePauseIndex(r, today)];
        row.appendChild(el("span", "pause-tag", p.to ? "paused until " + p.to : "paused"));
      }
      row.appendChild(el("span", "famount fnegative", "-" + formatMoney(r.amount)));
      row.onclick = () => openRecurringModal(r);
      card.appendChild(row);
    };

    active.slice().sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach((r) => addRow(r, false));
    if (ended.length) {
      const sub = el("div", "recur-subhead");
      sub.appendChild(el("span", null, `Ended (${ended.length})`));
      card.appendChild(sub);
      ended.slice().sort((a, b) => b.endDate.localeCompare(a.endDate)).forEach((r) => addRow(r, true));
    }
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
    // The plan this one took over from — kept so a bill's history still
    // reads as one chain after an import/sync round-trip (see planChain).
    if (r.prevId) out.prevId = r.prevId;
    if (r.overrides && typeof r.overrides === "object") {
      const overrides = {};
      for (const [date, ov] of Object.entries(r.overrides)) {
        if (!ov || typeof ov !== "object") continue;
        const clean = {};
        if (ov.amount != null) clean.amount = Math.abs(+ov.amount) || 0;
        if (ov.note != null) clean.note = String(ov.note);
        if (ov.skip) clean.skip = true;
        if (Object.keys(clean).length) overrides[date] = clean;
      }
      if (Object.keys(overrides).length) out.overrides = overrides;
    }
    if (Array.isArray(r.pauses)) {
      const pauses = normalizePauses(r.pauses.map((p) => {
        if (!p || typeof p !== "object" || !p.from) return null;
        const clean = { from: String(p.from) };
        if (p.to) clean.to = String(p.to);
        return clean;
      }).filter(Boolean));
      if (pauses.length) out.pauses = pauses;
    }
    return out;
  }
  const recurringKey = (r) => `${r.startDate}|${r.interval}|${+r.amount}|${(r.category || "").toLowerCase()}|${(r.note || "").toLowerCase()}`;

  // ---------- events ----------
  // Finance-specific DOM wiring; called from app.js's wire().
  function wire() {
    wireCategorySelect("#finCategory", "#financeModal", true);
    wireCategorySelect("#recCategory", "#recurringModal", true);
    wireCategorySelect("#planCategory", "#changePlanModal", true);

    // Basic math in the amount fields: "50-25" auto-resolves to 25.
    attachMathInput("#finAmount");
    attachMathInput("#recAmount");
    attachMathInput("#recOccAmount");
    attachMathInput("#planAmount");

    $("#cancelFinanceBtn").onclick = closeFinanceModal;
    $("#financeForm").onsubmit = saveFinanceFromForm;
    $("#deleteFinanceBtn").onclick = deleteCurrentFinanceEntry;
    $("#finYearly").onchange = applyFinanceYearlyUI;
    $("#makeRecurringBtn").onclick = makeEntryRecurring;

    $("#cancelRecurringBtn").onclick = closeRecurringModal;
    $("#recurringForm").onsubmit = saveRecurringFromForm;
    $("#deleteRecurringBtn").onclick = deleteCurrentRecurring;
    $("#convertRecurringBtn").onclick = convertRecurringToEntries;
    $("#changePlanBtn").onclick = () => {
      const rec = state.data.recurringExpenses.find((x) => x.id === $("#recId").value);
      if (rec) openChangePlanModal(rec);
    };
    $("#cancelChangePlanBtn").onclick = closeChangePlanModal;
    $("#changePlanForm").onsubmit = saveChangePlanFromForm;
    $("#pauseBtn").onclick = () => {
      const rec = state.data.recurringExpenses.find((x) => x.id === $("#recId").value);
      if (!rec) return;
      if (isPausedOn(rec, todayStr())) resumeCurrentRecurring(rec); else openPauseModal(rec, null);
    };
    $("#cancelPauseBtn").onclick = closePauseModal;
    $("#pauseForm").onsubmit = savePauseFromForm;
    $("#deletePauseBtn").onclick = deleteCurrentPause;
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
    addDaysStr,
    nextOccurrenceDateAfter,
    splitRecurring,
    planChain,
    isPausedOn,
    normalizePauses,
    localDateStr,
    closestOccurrenceDate,
    parseMoneyCell,
    monthSortAsc,
    evalMathExpr,
    // shared lookups/formatting (used by the shared import picker rows)
    rebuildFinanceColorMap,
    financeColorOf,
    formatMoney,
    financeYears,
    // views (dispatched from app.js's render())
    renderFinanceEntries,
    renderFinanceStats,
    // cross-view search match count (app.js's tab match badges)
    getFilteredFinance,
    // modals (add menu, filter-chip edit, Escape/overlay close)
    openFinanceModal,
    closeFinanceModal,
    openRecurringModal,
    closeRecurringModal,
    closeChangePlanModal,
    closePauseModal,
    openFinanceCatModal,
    cancelFinanceCatModal,
  };
})();
