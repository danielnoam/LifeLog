// LifeLog — finance: expenses, recurring expenses (with per-occurrence
// overrides, plan changes, and the link-past-expenses picker), finance
// categories, the Ledger + Summary views, and finance import/export.
// Extracted from app.js;
// shared app plumbing (state, DOM helpers, render/persist, the import
// picker, …) is handed in via init(ctx), and everything app.js still needs
// (view renderers, modal openers, sanitizers for the shared import
// infrastructure) is exposed on window.LifeLogFinance.
(function () {
  const CURRENCY_SYMBOLS = {
    ILS: "₪", USD: "$", EUR: "€", GBP: "£",
    CHF: "CHF", JPY: "¥", SEK: "kr", NOK: "kr", DKK: "kr", PLN: "zł", CZK: "Kč",
    HUF: "Ft", TRY: "₺", AED: "د.إ", THB: "฿", CAD: "CA$", AUD: "A$", NZD: "NZ$",
    SGD: "S$", HKD: "HK$", KRW: "₩", INR: "₹", MXN: "MX$", BRL: "R$", ZAR: "R",
  };
  // Currencies that conventionally have no minor unit — showing "¥1,200.00"
  // for a yen price reads as a mistake to anyone who uses it.
  const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "HUF"]);

  // ---------- money in more than one currency ----------
  // The storage rule, and the reason everything downstream needed no changes:
  // `amount` is ALWAYS in your home currency. A foreign expense carries three
  // extra fields describing where that number came from — fxAmount (what you
  // actually paid), currency, and rate (home per 1 foreign unit) — and
  // `amount` is fxAmount * rate, frozen at the moment it was set.
  //
  // The alternative, storing the foreign figure in `amount` and deriving the
  // home one, would mean auditing every total, breakdown, chart, sort and
  // export that reads `.amount`, and any one missed would silently add francs
  // to shekels. This way a reader that knows nothing about currency is still
  // correct.
  //
  // Rates are frozen rather than looked up, because a past expense cost what
  // it cost: re-deriving from today's rate would make last July's total drift
  // every time you open the app.

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
    buildYearFilter, buildCatFilter, buildProjectFilter, monthCardHeader, emptyState,
    bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
    animatedNumberText, barRow, fillSelect, sortSelect, fillCategorySelect, wireCategorySelect,
    resolvePendingCatSelect, download, csvEsc, parseCsv,
    buildImportItems, reviewAndImport, openImportPicker,
    backfillUpdatedAt, MONTHS, DEFAULT_SETTINGS;

  // Looked up at call time rather than captured: this file is required by the
  // Node tests, which have no DOM and never render.
  const reconcile = (...a) => window.LifeLogReconcile.reconcile(...a);
  const adopt = (...a) => window.LifeLogReconcile.adopt(...a);

  function init(ctx) {
    ({ state, $, el, uid, groupBy, countBy, toast, persist, render, renderLazySections,
      buildYearFilter, buildCatFilter, buildProjectFilter, monthCardHeader, emptyState,
      bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
      animatedNumberText, barRow, fillSelect, sortSelect, fillCategorySelect, wireCategorySelect,
      resolvePendingCatSelect, keepUnknown, download, csvEsc, parseCsv,
      buildImportItems, reviewAndImport, openImportPicker,
      backfillUpdatedAt, MONTHS, DEFAULT_SETTINGS } = ctx);
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

  let projectColor = {};
  function rebuildProjectColorMap() {
    projectColor = {};
    for (const p of state.data.projects || []) projectColor[p.name] = p.color;
  }
  const projectColorOf = (name) => projectColor[name] || "#7a8a99";
  const projectByName = (name) => (state.data.projects || []).find((p) => p.name === name) || null;

  // Manual formatting instead of Intl.NumberFormat("he-IL", {style:"currency"}) —
  // that locale injects invisible RTL bidi marks and puts the symbol after the
  // number ("1,302.00 ₪"), not matching the source sheet's "₪1,302.00".
  function formatMoney(n) {
    return formatIn(n, state.data.settings.currency);
  }

  // The same formatting in any currency — used for the "what you actually
  // paid" figure beside a converted amount. A symbol that is really a code
  // (CHF, CA$) gets a space after it; a true symbol doesn't.
  function formatIn(n, code) {
    const sign = n < 0 ? "-" : "";
    const symbol = CURRENCY_SYMBOLS[code] || CURRENCY_SYMBOLS[state.data.settings.currency] || CURRENCY_SYMBOLS.ILS;
    const gap = /[A-Za-z]$/.test(symbol) ? " " : "";
    const digits = ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
    return sign + symbol + gap + Math.abs(n)
      .toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  const homeCurrency = () => state.data.settings.currency || "ILS";

  // What an expense actually cost, in the currency it was paid in — null for
  // an ordinary home-currency one, which is most of them.
  function fxOf(f) {
    if (!f || !f.currency || f.currency === homeCurrency()) return null;
    return { currency: f.currency, amount: +f.fxAmount || 0, rate: +f.rate || 0 };
  }

  // A rate is provisional while it belongs to a project that hasn't been
  // converted yet. Derived rather than stored on the entry: "has this trip
  // been settled up" is a fact about the trip, and a per-entry copy would be
  // one more thing to keep in sync every time Convert runs.
  function isProvisional(f) {
    if (!f || !f.currency || f.currency === homeCurrency()) return false;
    // Only inside a project, and only until Convert settles it. A one-off
    // foreign expense is never provisional: you typed that rate yourself and
    // nothing is waiting on it.
    return !!f.project && !f.rateConfirmed;
  }

  function currencyGlyph() {
    return CURRENCY_SYMBOLS[state.data.settings.currency] || CURRENCY_SYMBOLS.ILS;
  }

  function financeYearOf(f) { return +String(f.date).slice(0, 4); }
  function financeMonthOf(f) { return +String(f.date).slice(5, 7); }

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

  // What one occurrence of a foreign plan cost, and whether that is a fact or
  // a forecast. null for an ordinary plan, which is most of them.
  //
  // The rate is per occurrence rather than per plan, and that is the whole
  // decision this feature turned on. A single rate on the template would mean
  // every past charge re-priced itself the moment you updated it — three
  // years of a dollar subscription silently restated at today's rate, which
  // is exactly the drift the frozen-rate rule at the top of this file exists
  // to prevent. So a date with a rate of its own uses it and is a fact;
  // everything else falls back to the template's rate and is a forecast until
  // it gets one. Freezing is what "Look up past rates" does.
  function occurrenceFx(rec, dateStr, ov) {
    if (!rec || !rec.currency || !rec.fxAmount || !(+rec.rate > 0)) return null;
    const frozenRate = rec.rates && +rec.rates[dateStr];
    const frozen = isFinite(frozenRate) && frozenRate > 0;
    const rate = frozen ? frozenRate : +rec.rate;
    const fxAmount = ov && ov.fxAmount != null ? ov.fxAmount : rec.fxAmount;
    return { fxAmount, rate, frozen, amount: Math.round(fxAmount * rate * 100) / 100 };
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
      const fx = occurrenceFx(rec, dateStr, ov);
      out.push({
        id: `${rec.id}:${n}`, date: dateStr, type: "expense",
        amount: fx ? fx.amount : (ov && ov.amount != null ? ov.amount : rec.amount),
        category: rec.category,
        note: ov && ov.note != null ? ov.note : rec.note,
        createdAt: rec.createdAt,
        project: rec.project || undefined,
        recurringId: rec.id, virtual: true, overridden: !!ov,
        skipped: paused || !!(ov && ov.skip),
        paused,
        // Spread last so a home-currency plan adds nothing at all and every
        // reader downstream — fxOf, the row, the totals — sees exactly what
        // it saw before. On a foreign plan these are the same three fields a
        // one-off foreign expense carries, which is why none of those readers
        // needed changing.
        ...(fx ? { currency: rec.currency, fxAmount: fx.fxAmount, rate: fx.rate, rateFrozen: fx.frozen } : {}),
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
    // A plan change is a change of terms, not of currency: a dollar
    // subscription whose price went up is still a dollar subscription. The
    // new plan is billed the new figure in the same currency, at the same
    // fallback rate, and `amount` follows from the two.
    if (rec.currency && next.fxAmount && +next.rate > 0) {
      created.currency = rec.currency;
      created.fxAmount = next.fxAmount;
      created.rate = next.rate;
      created.amount = Math.round(next.fxAmount * next.rate * 100) / 100;
    }
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

    // Frozen rates split on the same line, and for the same reason: a rate
    // belongs to the charge it priced, and after the split that charge is
    // generated by whichever plan now owns its date. Unlike an override, one
    // for a date the new schedule misses is simply dropped without a report —
    // a rate nothing uses costs the reader nothing, where a lost custom
    // amount would be a change they made and can no longer see.
    const keptRates = {}, carriedRates = {};
    for (const [date, v] of Object.entries(rec.rates || {})) {
      if (date < effectiveFrom) keptRates[date] = v; else carriedRates[date] = v;
    }
    if (Object.keys(keptRates).length) prev.rates = keptRates; else delete prev.rates;
    if (created.currency && Object.keys(carriedRates).length) created.rates = carriedRates;

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
      // Projects narrow on a second axis: an empty set means everything, the
      // same rule the category chips follow. Two states only — in a project
      // or not — so this asks which, never which one.
      const pf = state.financeActiveProjects;
      if (pf.size && !pf.has(f.project ? "any" : "none")) return false;
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
  // Held across renders, so sections, month cards and rows survive app.js
  // clearing #viewBody. The recurring card and the bulk bar sit outside it:
  // both are small, both come and go with state rather than with the list.
  let finRootEl = null;

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
    root.appendChild(ledgerToolbar());
    const sort = ledgerSort();
    // The two time options run the whole ledger their way; the two amount
    // ones reorder rows inside a month and leave the months where they are,
    // because "largest first" is a statement about expenses, not about
    // months. That scope is part of what each option means — see SORTS.
    const oldest = sort === "oldest";
    const byYear = groupBy(items, financeYearOf);
    const sections = [];
    for (const y of Object.keys(byYear).sort((a, b) => (oldest ? a - b : b - a))) {
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
        // build() reconciles the body rather than appending to it.
        keepBody: true,
        build: (body) => {
          const byMonth = groupBy(byYear[y], financeMonthOf);
          const monthSort = (a, b) => (oldest ? +a - +b : +b - +a);
          const cards = Object.keys(byMonth).sort(monthSort).map((m) => {
            const yy = +y, mm = +m;
            const monthItems = byMonth[m];
            return {
              key: y + "-" + m,
              year: yy,
              month: mm,
              label: MONTHS[m],
              // Same-date entries need a real tiebreaker, not just array order —
              // that order is stable within a session (new entries are always
              // pushed to the end) but merge.js rebuilds the array from a Set of
              // ids on every multi-device sync, reshuffling same-date entries
              // arbitrarily. createdAt keeps the display order deterministic
              // across renders and merges alike.
              items: monthItems.slice().sort(financeRowSort(sort)),
              counted: monthItems.filter((f) => !f.skipped),
            };
          });
          reconcile(body, cards, {
            keyOf: (c) => c.key,
            create: () => el("div", "month-card"),
            update: (card, c) => {
              card.dataset.year = c.year;
              card.dataset.month = c.month;
              fillFinanceMonthCard(card, c.year + "-" + c.month, c.label, c.items, c.counted,
                () => openFinanceModal(null, { year: c.year, month: c.month }));
            },
          });
        },
      });
    }
    if (!finRootEl) finRootEl = document.createElement("div");
    root.appendChild(finRootEl);
    renderLazySections(finRootEl, sections);
    // All sections are attached to the document by now (renderLazySections
    // appends every node up front, before building any bodies), so headers
    // can be measured here regardless of which sections have built their
    // rows yet. getBoundingClientRect (not offsetHeight) keeps the
    // sub-pixel remainder, which otherwise rounds away and leaves a
    // hairline gap under the sticky header.
    // Every height read first, then every write: alternating them makes the
    // browser flush layout once per section instead of once for the lot.
    const headHeights = sections.map((s) => s.header.getBoundingClientRect().height);
    sections.forEach((s, i) => s.node.style.setProperty("--year-head-h", headHeights[i] + "px"));
    if (state.bulk.active) {
      root.appendChild(bulkActionBar({
        categories: state.data.financeCategories,
        onMove: bulkMoveFinanceSelected,
        onDelete: bulkDeleteFinanceSelected,
      }));
    }
  }

  // Consecutive rows belonging to the same project become one pill, so the
  // project is named once over the block rather than repeated on every row.
  // Runs, not a groupBy: a month card is sorted by date, so a holiday's
  // expenses are already adjacent, and a non-project expense landing in the
  // middle (a subscription that hit while you were away) genuinely does split
  // the block in two. Grouping regardless of position would reorder the month
  // to make the pills look tidy, which is the ledger lying about dates.
  //
  // Pure, and exported for test/finance.test.js.
  function groupRunsByProject(items) {
    const runs = [];
    for (const f of items || []) {
      const project = f.project || "";
      const last = runs[runs.length - 1];
      if (last && last.project === project) last.items.push(f);
      else runs.push({ project, items: [f] });
    }
    return runs;
  }

  // The row's *contents*. Its click and long-press live in createFinanceRow.
  function financeRow(f) {
    const row = el("div", "entry finance-entry" + (f.skipped ? " is-skipped" : ""));
    row.dataset.id = f.id;
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
    // What you actually handed over, beside what it came to. The home figure
    // stays in the amount column so the column still lines up and still adds
    // up; the foreign one is the smaller note next to it.
    const fx = fxOf(f);
    if (fx) {
      const tag = el("span", "fx-paid", formatIn(fx.amount, fx.currency));
      tag.title = "Paid " + formatIn(fx.amount, fx.currency) + " at " + fx.rate + " " + homeCurrency() + " per " + fx.currency;
      row.appendChild(tag);
    }
    const amt = el("span", "famount fnegative"
      + (fx && isProvisional(f) ? " is-provisional" : ""), formatMoney(f.amount));
    if (fx && isProvisional(f)) amt.title = "Provisional — this project hasn't been converted yet";
    row.appendChild(amt);
    return row;
  }

  // The row's click and long-press, bound once per node and resolving the item
  // by id at click time — adopt() carries attributes across a refill but not
  // properties, so a captured item goes stale (see NOTES.md). The lookup goes
  // through getEffectiveFinanceEntries because a recurring occurrence is
  // generated, not stored, and so isn't in state.data.financeEntries.
  //
  // Whether a row is virtual is fixed for the life of its node: a generated
  // occurrence keys as `${rec.id}:${n}` and a real entry as a uid, so the two
  // key spaces are disjoint and a key never changes sides. That is what makes
  // it safe to decide here, at create time, whether to attach the long-press.
  function createFinanceRow(id, virtual) {
    const row = el("div", "entry finance-entry");
    row.dataset.id = id;
    row.onclick = () => {
      const f = getEffectiveFinanceEntries().find((x) => x.id === id);
      if (!f) return;
      if (f.virtual) {
        const rec = state.data.recurringExpenses.find((r) => r.id === f.recurringId);
        if (rec) openRecurringOccModal(rec, f);
        return;
      }
      if (state.bulk.active) { toggleBulkItem(id); return; }
      openFinanceModal(f);
    };
    if (!virtual) attachLongPressSelect(row, { id });
    return row;
  }

  // The pill's contents: the project named once over the block, and its rows
  // reconciled inside. Nested reconcile rather than a rebuild, so a row that
  // stays in the same run keeps its node — which is what lets the month card
  // animate at all, and what keeps a long-press or an open bulk selection
  // from being torn out from under you.
  //
  // No amount in the head, deliberately. A run is a partial figure: a project
  // spans months and can be split in two within one, so a number here would
  // sit next to the month's project line in the breakdown and disagree with
  // it. The month's total is in the breakdown; the project's is in Summary.
  function fillProjectGroup(box, project, items) {
    const color = projectColorOf(project);
    // Alpha suffixes on the hex, the same trick the category chip uses
    // (`color + "22"`). A project colour that isn't a 6-digit hex — from
    // hand-edited JSON — makes these invalid, and the tints fall back to
    // their defaults: a pill with no colour rather than a broken card.
    box.style.setProperty("--proj-tint", color + "12");
    box.style.setProperty("--proj-head", color + "22");
    box.style.setProperty("--proj-edge", color + "59");
    const head = box.firstElementChild;
    const list = box.lastElementChild;

    const fresh = el("div", "proj-group-head");
    const dot = el("span", "dot");
    dot.style.background = color;
    fresh.appendChild(dot);
    const name = el("span", "proj-group-name", project);
    name.title = project;
    fresh.appendChild(name);
    // Straight into a new expense already on this project, the way a month
    // card's + opens one already on that month. A trip is entered as a run of
    // small expenses, so the shortest path from "I just paid for something"
    // to a saved row is the button that matters most on this header.
    const add = el("button", "proj-group-add", "+");
    add.type = "button";
    add.title = "Add an expense to " + project;
    add.setAttribute("aria-label", add.title);
    fresh.appendChild(add);
    // Opens the project itself, not the expense — the head names the group,
    // so tapping it is how you rename or recolour it.
    const edit = el("button", "proj-group-edit", "✎");
    edit.type = "button";
    edit.title = "Edit " + project;
    edit.setAttribute("aria-label", edit.title);
    fresh.appendChild(edit);
    adopt(head, fresh);
    // Bound after adopt: adopt() carries attributes, not properties, so a
    // handler set on a child that gets replaced goes with it. The buttons are
    // re-created every refill, so they are wired every refill.
    head.querySelector(".proj-group-edit").onclick = (ev) => {
      ev.stopPropagation();
      const p = projectByName(project);
      if (p) openProjectModal(p);
    };
    // The date comes from the month this pill is sitting in rather than
    // today: adding to a June trip from the June card should land in June.
    // openFinanceModal wants { year, month } — handing it the run's raw
    // "2026-06-04" produced an invalid date the input silently dropped —
    // and from there it behaves exactly like a month card's +, i.e. today
    // when the month is the current one and the 1st otherwise.
    head.querySelector(".proj-group-add").onclick = (ev) => {
      ev.stopPropagation();
      const first = (items[0] && items[0].date) || "";
      const m = /^(\d{4})-(\d{2})/.exec(first);
      openFinanceModal(null, m ? { year: +m[1], month: +m[2] } : undefined);
      fillProjectSelect($("#finProject"), project);
      // Re-run the currency offer now the project is set: fillProjectSelect
      // only changes the dropdown, and a new expense inherits its project's
      // currency from the same place the dropdown's own change handler does.
      $("#finProject").dispatchEvent(new Event("change", { bubbles: true }));
    };

    reconcile(list, items, {
      animate: true,
      keyOf: (f) => f.id,
      create: (f) => createFinanceRow(f.id, !!f.virtual),
      update: (node, f) => adopt(node, financeRow(f)),
    });
  }

  // A month's header plus its rows. financeRow encodes four bits of state in
  // its class string — skipped, and via the row's contents virtual and
  // overridden — and adopt() syncs the whole class attribute, so a reused node
  // loses the ones that no longer apply as well as gaining the ones that do.
  function fillFinanceMonthCard(card, key, label, monthItems, countedItems, onAdd) {
    const parts = [{ key: "__head", kind: "head", label, countedItems, monthItems, onAdd }];
    // Consecutive same-project rows become one pill. The key carries the run's
    // first row id, not just the project name: one project can have two runs
    // in a month (something non-project landed between them) and the two must
    // not share a key. The cost is that adding an expense *above* a run's
    // current head changes the key and rebuilds that pill rather than
    // animating it — cheap, and rare next to the alternative of colliding.
    for (const run of groupRunsByProject(monthItems)) {
      if (!run.project) {
        for (const f of run.items) parts.push({ key: f.id, kind: "row", item: f });
        continue;
      }
      parts.push({
        key: "proj:" + run.project + ":" + run.items[0].id,
        kind: "group", project: run.project, items: run.items,
      });
    }

    // Where the month's money went, above its total: one line per category
    // that actually has entries this month, largest first. Counted items only,
    // so the lines add up to the total under them (a skipped or paused
    // occurrence is in neither).
    // Off by setting means not computed either, not merely not shown: this
    // runs per month card on every render.
    const projectTotal = countedItems.reduce((sum, f) => sum + (f.project ? f.amount : 0), 0);
    const anyProvisional = countedItems.some(isProvisional);
    if (state.visual.ledgerMonthSummary !== "hide") {
      // A project's spending leaves its category lines and gets one of its
      // own, so every line here still sums to the total underneath. Counting
      // a Switzerland dinner under both "Food" and "Switzerland" would make
      // the breakdown add up to more than the month, which is the one thing a
      // breakdown has to get right.
      const byCat = groupBy(countedItems.filter((f) => !f.project), (f) => f.category);
      const catRows = Object.keys(byCat)
        .map((name) => ({ name, total: byCat[name].reduce((sum, f) => sum + f.amount, 0) }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
      const byProj = groupBy(countedItems.filter((f) => f.project), (f) => f.project);
      const projRows = Object.keys(byProj)
        .map((name) => ({
          name, project: true,
          total: byProj[name].reduce((sum, f) => sum + f.amount, 0),
          provisional: byProj[name].some(isProvisional),
        }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
      // Projects last regardless of size: they are the one-offs, and the
      // recurring shape of the month is what the category lines are for.
      const rows = catRows.concat(projRows);
      if (rows.length) parts.push({ key: "__cats", kind: "cats", catRows: rows });
    }
    parts.push({
      key: "__total", kind: "total", animKey: "fin-month-total:" + key,
      total: countedItems.reduce((sum, f) => sum + f.amount, 0),
      provisional: anyProvisional,
    });
    // Its own part rather than a third child of .month-total, which is a
    // two-column flex row — anything appended there lands beside the amount.
    //
    // Only when the month actually has both kinds of spending. The line is a
    // contrast — "of this total, this much was ordinary" — so a month that is
    // all project spending has nothing to contrast and used to say "₪0.00
    // excluding projects" on every card, which is loudest exactly when you
    // filter to Project and every month says it at once.
    const exTotal = countedItems.reduce((sum, f) => sum + (f.project ? 0 : f.amount), 0);
    if (projectTotal && exTotal) parts.push({ key: "__ex", kind: "ex", total: exTotal });

    reconcile(card, parts, {
      animate: true,
      keyOf: (part) => part.key,
      create: (part) => {
        if (part.kind === "head") return el("h3");
        if (part.kind === "cats") return el("div", "month-cats");
        if (part.kind === "ex") return el("div", "month-total-ex");
        if (part.kind === "total") {
          // Built once and updated in place, unlike the rest: the total counts
          // up over half a second, and rebuilding the span it animates would
          // cut that off on any render landing mid-flight. The ex-projects
          // line rides alongside rather than inside, for the same reason.
          const totalRow = el("div", "month-total");
          totalRow.appendChild(el("span", null, "Total"));
          totalRow.appendChild(el("span", "famount fnegative"));
          return totalRow;
        }
        // The pill. Its head and list are kept across renders so the rows
        // inside reconcile rather than being rebuilt with the wrapper.
        if (part.kind === "group") {
          const box = el("div", "proj-group");
          box.appendChild(el("div", "proj-group-head"));
          box.appendChild(el("div", "proj-group-list"));
          return box;
        }
        return createFinanceRow(part.item.id, !!part.item.virtual);
      },
      update: (node, part) => {
        if (part.kind === "total") {
          animatedNumberText(node.lastChild, part.animKey, part.total, formatMoney);
          node.classList.toggle("is-provisional", !!part.provisional);
          node.title = part.provisional
            ? "Includes provisional figures — a project here hasn't been converted yet" : "";
          return;
        }
        if (part.kind === "ex") {
          node.textContent = formatMoney(part.total) + " excluding projects";
          return;
        }
        if (part.kind === "cats") {
          const cats = el("div", "month-cats");
          for (const c of part.catRows) {
            const row = el("div", "month-cat" + (c.project ? " is-project" : "")
              + (c.provisional ? " is-provisional" : ""));
            const dot = el("span", "dot");
            dot.style.background = c.project ? projectColorOf(c.name) : financeColorOf(c.name);
            row.appendChild(dot);
            const name = el("span", "month-cat-name", c.name);
            name.title = c.name;
            row.appendChild(name);
            row.appendChild(el("span", "famount", formatMoney(c.total)));
            cats.appendChild(row);
          }
          adopt(node, cats);
          return;
        }
        if (part.kind === "group") {
          fillProjectGroup(node, part.project, part.items);
          return;
        }
        adopt(node, part.kind === "head"
          ? monthCardHeader(part.label, part.countedItems.length,
              part.monthItems.filter((f) => !f.virtual), { onAdd: part.onAdd })
          : financeRow(part.item));
      },
    });
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
    renderProjectsCard(root, items);
    renderRecurringSplitCard(root, items);
    renderTopExpensesCard(root, items);
  }

  // What each project cost in total — the number the whole feature exists to
  // give back. Before this you wrote one lump "Switzerland 10,000" entry and
  // had the figure but none of the detail; now the detail adds up to it.
  //
  // A project with no spending yet has nothing to show here. It is a name you
  // can pick in the expense form, and it appears the moment it costs
  // something.
  function renderProjectsCard(root, items) {
    const projects = state.data.projects || [];
    if (!projects.length) return;
    const byProj = groupBy(items.filter((f) => f.project), (f) => f.project);
    const rows = projects
      .map((p) => {
        const own = byProj[p.name] || [];
        return { p, total: own.reduce((sum, f) => sum + f.amount, 0), n: own.length };
      })
      .filter((r) => r.n)
      .sort((a, b) => b.total - a.total || a.p.name.localeCompare(b.p.name));
    if (!rows.length) return;

    const card = el("div", "card");
    // Every card in this stack sets its own top margin inline. Forgetting it
    // is invisible in code and obvious on screen — this one did, and sat flush
    // against Spend trend looking like an overlap. The uniform-gap check in
    // test/panelgaps is what makes the next omission fail rather than ship.
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Projects"));
    const max = Math.max(1, ...rows.map((r) => r.total));
    for (const r of rows) {
      const line = el("div", "proj-stat");
      const bar = barRow(r.p.name, r.total, max, r.p.color, null, formatMoney);
      line.appendChild(bar);
      line.appendChild(el("div", "proj-stat-meta", r.n + (r.n === 1 ? " expense" : " expenses")));
      // Same target as the pill's ✎ — one place to rename, recolour or redate.
      line.onclick = () => openProjectModal(r.p);
      card.appendChild(line);
    }
    root.appendChild(card);
  }

  // Monthly spend totals keyed by year*12+(month-1) so consecutive calendar
  // months are consecutive integers.
  function financeMonthlyTotals(items) {
    const totals = {};
    for (const f of items) {
      // Projects are left out: a holiday is not part of the shape of a normal
      // month, and letting one through makes the average, the trend line and
      // "biggest month" answer a question nobody asked. The Ledger still
      // counts them — that is where you go to see what actually left your
      // account.
      if (f.project) continue;
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
  // year vs last. Monthly figures skip project spending; the year-over-year
  // delta counts everything.
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

  const ledgerSort = () => state.data.settings.ledgerSort || DEFAULT_SETTINGS.ledgerSort;

  function ledgerToolbar() {
    const bar = el("div", "timeline-toolbar");
    bar.appendChild(sortSelect("ledger", ledgerSort(), async (value) => {
      state.data.settings.ledgerSort = value;
      render();
      await persist();
    }));
    return bar;
  }

  // createdAt is the tie-break in every case, not id: ids are regenerated on
  // every multi-device sync and would reshuffle same-date or same-amount rows
  // arbitrarily. It keeps the display order deterministic across renders and
  // merges alike.
  function financeRowSort(sort) {
    const added = (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "");
    if (sort === "largest") return (a, b) => b.amount - a.amount || added(a, b);
    if (sort === "smallest") return (a, b) => a.amount - b.amount || added(a, b);
    if (sort === "oldest") return (a, b) => a.date.localeCompare(b.date) || -added(a, b);
    return (a, b) => b.date.localeCompare(a.date) || added(a, b);
  }

  const monthSortAsc = (a, b) => +a - +b;

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
      const total = byMonth[m].reduce((s, f) => s + f.amount, 0);
      card.appendChild(financeMoneyRow(MONTHS[+m], total));
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
      row.querySelector(".lbl").title = f.project ? label + " · " + f.project : label;
      card.appendChild(row);
      // The biggest expenses of a year are usually the trip ones, and "which
      // trip" is the first thing you want to know about them. On its own line
      // rather than inside the label: .bar-row is a grid whose label column
      // is 120px and ellipsised, so anything appended there is invisible.
      if (f.project) {
        const tag = el("div", "top-proj");
        const dot = el("span", "dot");
        dot.style.background = projectColorOf(f.project);
        tag.appendChild(dot);
        tag.appendChild(document.createTextNode(f.project));
        card.appendChild(tag);
      }
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
  // Only an existing entry can seed a recurring template — there is nothing
  // for a schedule to anchor to until the expense has a date of its own.
  function applyFinanceModalUI() {
    $("#makeRecurringBtn").hidden = !$("#financeId").value;
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
    $("#financeModalTitle").textContent = editing ? "Edit finance entry" : "Add finance entry";
    $("#financeId").value = editing ? entry.id : "";
    $("#finDate").value = editing ? entry.date
      : (presetDate ? presetDateStr(presetDate) : todayStr());
    $("#finAmount").value = editing ? entry.amount : "";
    fillCategorySelect($("#finCategory"), state.data.financeCategories,
      editing ? entry.category : (state.data.financeCategories[0] && state.data.financeCategories[0].name));
    // An existing entry keeps whatever it has, including none. A new one is
    // offered the project whose range covers its date — preselected in a
    // visible dropdown, never applied silently.
    // A new expense starts on no project. The date-range offer still runs,
    // but only when you actually pick a date — opening the form on today's
    // date and finding a trip already filled in was too eager.
    const preset = editing ? (entry.project || "") : "";
    fillProjectSelect($("#finProject"), preset);
    // An existing entry shows what it was saved with. A new one inherits its
    // project's currency and rough rate, which is the whole point of setting
    // them on the project: you pick "Switzerland" and stop thinking about it.
    const pfx = preset ? projectFx(preset) : null;
    const fx = editing ? fxOf(entry) : null;
    fillCurrencySelect($("#finCurrency"), fx ? fx.currency : (pfx && pfx.currency) || homeCurrency());
    $("#finRate").value = fx ? fx.rate : ((pfx && pfx.rate) || "");
    // The amount field shows what you paid, not the converted figure — it is
    // the number you have in front of you.
    if (editing && fx) $("#finAmount").value = fx.amount;
    applyFinanceCurrencyUI();
    $("#finNote").value = editing ? (entry.note || "") : "";
    $("#deleteFinanceBtn").hidden = !editing;
    applyFinanceModalUI();
    $("#financeModal").hidden = false;
  }

  const ADD_PROJECT_OPTION = "__add_project__";

  // Home first, then the rest alphabetically — the list is long enough that
  // hunting for your own currency at the bottom of it would be silly.
  function currencyOptions() {
    const home = homeCurrency();
    const codes = Object.keys(CURRENCY_SYMBOLS).filter((c) => c !== home).sort();
    return [home, ...codes].map((c) => {
      // Several codes are their own symbol (CHF, CA$ is not but CHF is), and
      // "CHF · CHF" reads as a bug rather than as a currency.
      const sym = CURRENCY_SYMBOLS[c];
      const shown = sym && sym !== c ? c + " · " + sym : c;
      return { value: c, label: c === home ? shown + " (yours)" : shown };
    });
  }

  function fillCurrencySelect(sel, val) {
    fillSelect(sel, currencyOptions(), val || homeCurrency());
  }

  // Rate, amount and the running "= ₪X" under them, refreshed together. The
  // rate row only exists for a foreign currency, so an ordinary expense sees
  // the form it has always seen.
  // The selected project, but only when it actually supplies this expense's
  // rate — same currency, rate set. That is the case where the rate is not
  // yours to type.
  function ratingProject() {
    const name = $("#finProject").value;
    const fx = projectFx(name);
    return fx && fx.currency === $("#finCurrency").value ? { name, rate: fx.rate } : null;
  }

  function applyFinanceCurrencyUI() {
    const code = $("#finCurrency").value;
    const foreign = code && code !== homeCurrency();
    const from = foreign ? ratingProject() : null;
    // Home currency: no rate, nothing to say. Foreign but the project already
    // has a rate: it is used, and shown in the preview line below rather than
    // as a box asking to be filled in — you said "Switzerland is in CHF at
    // 3.9" once and shouldn't be asked again per expense. Foreign with no
    // project rate: the box, because nobody else knows the number.
    $("#finRateLabel").hidden = !foreign || !!from;
    if (from) $("#finRate").value = from.rate;
    const preview = $("#finFxPreview");
    if (!foreign) { preview.hidden = true; return; }
    const amount = readAmount("#finAmount");
    const rate = parseFloat($("#finRate").value);
    if (!isFinite(rate) || rate <= 0) {
      preview.textContent = "1 " + code + " = how many " + homeCurrency() + "?";
      preview.hidden = false;
      return;
    }
    const at = " at " + rate + " " + homeCurrency() + " per " + code
      + (from ? " (from " + from.name + ")" : "") + fxNote(code, rate);
    preview.textContent = amount
      ? formatIn(amount, code) + " = " + formatMoney(amount * rate) + at
      : "Converted" + at;
    preview.hidden = false;
  }

  // The recurring form's version of the same three controls. Deliberately
  // simpler than the expense form's: a plan has no single date, so there is
  // no project rate to inherit and no one day to look up — the rate typed
  // here is the fallback a date without a frozen rate of its own uses, and
  // the preview says so rather than pretending it is a settled figure.
  function applyRecurringCurrencyUI() {
    const code = $("#recCurrency").value;
    const foreign = code && code !== homeCurrency();
    $("#recRateLabel").hidden = !foreign;
    const preview = $("#recFxPreview");
    if (!foreign) { preview.hidden = true; return; }
    const amount = readAmount("#recAmount");
    const rate = parseFloat($("#recRate").value);
    if (!isFinite(rate) || rate <= 0) {
      preview.textContent = "1 " + code + " = how many " + homeCurrency() + "?";
      preview.hidden = false;
      return;
    }
    const at = " at " + rate + " " + homeCurrency() + " per " + code + fxNote(code, rate);
    preview.textContent = (amount
      ? formatIn(amount, code) + " = " + formatMoney(amount * rate) + at
      : "Converted" + at)
      + " — used for any date without a rate of its own. “Look up past rates” freezes one per charge.";
    preview.hidden = false;
  }

  // Whenever the project changes — by your hand or by the date picking one —
  // the expense adopts that project's currency and rough rate. The project is
  // the strongest available signal about what currency you are spending in,
  // and having chosen "Switzerland" you should not then have to say "CHF" as
  // well. A currency you set yourself after that stands, until the project
  // changes again.
  function inheritProjectCurrency() {
    const fx = projectFx($("#finProject").value);
    fillCurrencySelect($("#finCurrency"), fx ? fx.currency : homeCurrency());
    $("#finRate").value = fx ? fx.rate : "";
    applyFinanceCurrencyUI();
  }

  // What currency a project is being spent in, read off the expenses already
  // in it rather than declared on the project. The most recently added
  // foreign one wins: it is the rate you last decided was right, and on a
  // trip that is the one you want the next expense to use.
  //
  // This is why a project has no currency field. The expenses carry the
  // money; asking you to declare it twice would be asking you to keep two
  // answers in step.
  function projectFx(name) {
    if (!name) return null;
    let best = null;
    for (const f of state.data.financeEntries) {
      if (f.project !== name || !f.currency || !f.rate) continue;
      if (!best || (f.createdAt || "") > (best.createdAt || "")) best = f;
    }
    return best ? { currency: best.currency, rate: best.rate } : null;
  }

  function fillProjectSelect(sel, val) {
    fillSelect(sel, [{ value: "", label: "— none —" }]
      .concat((state.data.projects || []).map((p) => ({ value: p.name, label: p.name })))
      .concat([{ value: ADD_PROJECT_OPTION, label: "+ New project…" }]), val || "");
    sel.dataset.prevValue = val || "";
  }

  function closeFinanceModal() { $("#financeModal").hidden = true; }

  async function saveFinanceFromForm(ev) {
    ev.preventDefault();
    const id = $("#financeId").value;
    const date = $("#finDate").value;
    const typed = readAmount("#finAmount");
    const category = $("#finCategory").value;
    const project = $("#finProject").value === ADD_PROJECT_OPTION ? "" : $("#finProject").value;
    const note = $("#finNote").value.trim();
    const code = $("#finCurrency").value;
    const foreign = code && code !== homeCurrency();
    const rate = foreign ? parseFloat($("#finRate").value) : 0;
    if (!date || !typed) return;
    if (foreign && (!isFinite(rate) || rate <= 0)) {
      toast("Give a rate for " + code + ", or switch back to " + homeCurrency(), true);
      return;
    }
    // What gets stored in `amount` is always the home figure. See the note on
    // CURRENCY_SYMBOLS for why that direction and not the other.
    const amount = foreign ? Math.round(typed * rate * 100) / 100 : typed;
    // rateConfirmed is Convert's to set, never the form's: a rate you type
    // when adding a trip expense is exactly the guess Convert exists to
    // settle. An edit that leaves the rate alone keeps whatever settlement
    // the expense already had; changing the rate re-opens the question.
    const prev = id ? state.data.financeEntries.find((x) => x.id === id) : null;
    const keepConfirmed = !!(prev && prev.rateConfirmed && prev.currency === code && +prev.rate === rate);
    const fxFields = foreign
      ? { currency: code, fxAmount: typed, rate, rateConfirmed: keepConfirmed || null }
      : { currency: null, fxAmount: null, rate: null, rateConfirmed: null };
    if (id) {
      const f = state.data.financeEntries.find((x) => x.id === id);
      Object.assign(f, { date, amount, category });
      if (note) f.note = note; else delete f.note;
      if (project) f.project = project; else delete f.project;
      for (const [k, v] of Object.entries(fxFields)) { if (v == null) delete f[k]; else f[k] = v; }
    } else {
      const item = { id: uid(), date, amount, category, createdAt: new Date().toISOString() };
      if (note) item.note = note;
      if (project) item.project = project;
      for (const [k, v] of Object.entries(fxFields)) if (v != null) item[k] = v;
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
    // Foreign plan: the Amount box holds what you're billed, in that
    // currency — same as the expense form, where the typed figure is the one
    // you actually paid and `amount` is what it came to.
    const recFx = editing ? fxOf(rec) : null;
    $("#recAmount").value = editing
      ? (recFx ? recFx.amount : rec.amount)
      : (p.amount != null ? p.amount : "");
    fillCurrencySelect($("#recCurrency"), recFx ? recFx.currency : (p.currency || homeCurrency()));
    $("#recRate").value = recFx ? recFx.rate : (p.rate || "");
    applyRecurringCurrencyUI();
    fillCategorySelect($("#recCategory"), state.data.financeCategories,
      editing ? rec.category : (p.category || (state.data.financeCategories[0] && state.data.financeCategories[0].name)));
    $("#recNote").value = editing ? (rec.note || "") : (p.note || "");
    $("#deleteRecurringBtn").hidden = !editing;
    // Change plan, Pause, Convert, Link past expenses: four things you do to
    // a plan occasionally, which were laid out in full every time you opened
    // one to fix a typo in its note. Behind a button next to Delete, and
    // closed again on every open — the form's job is the form, and these are
    // errands you arrive already knowing you want.
    $("#recMoreWrap").hidden = !editing;
    $("#recFetchRatesBtn").hidden = !recFx;
    setRecToolsOpen(false);

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
        const ofx = fxOf(o);
        if (ofx && !o.skipped) {
          // What you were billed, beside what it came to — the same pairing
          // the ledger row uses, so the two read alike.
          const tag = el("span", "fx-paid", formatIn(ofx.amount, ofx.currency));
          tag.title = "Billed " + formatIn(ofx.amount, ofx.currency) + " at " + ofx.rate
            + " " + homeCurrency() + " per " + ofx.currency;
          row.appendChild(tag);
        }
        const amtEl = el("span", "rec-occ-amount" + (ofx && !o.rateFrozen && !o.skipped ? " is-provisional" : ""),
          o.paused ? "Paused" : (o.skipped ? "Skipped" : "-" + formatMoney(o.amount)));
        row.appendChild(amtEl);
        row.title = o.paused ? "Paused — edit the pause above to change this"
          : (o.skipped ? "Skipped — click to restore or edit"
            : (ofx && !o.rateFrozen
              ? "At the plan's fallback rate — use “Look up past rates” to freeze the rate this charge really had"
              : "Edit this occurrence"));
        row.onclick = () => openRecurringOccModal(rec, o);
        list.appendChild(row);
      });
      occWrap.hidden = false;
    } else {
      occWrap.hidden = true;
    }
    $("#recurringModal").hidden = false;
    fillProjectSelect($("#recProject"), (rec && rec.project) || "");
  }
  // A menu anchored to the button, the same one the + button drops (see
  // .menu-pop): the four errands are actions you pick, not a section of the
  // form, and laying them out inline made them look like fields.
  function setRecToolsOpen(open) {
    const menu = $("#recMoreMenu");
    const btn = $("#recMoreBtn");
    if (!menu || !btn) return;
    // Never open on a new plan: there is nothing yet to pause or convert.
    const on = open && !$("#recMoreWrap").hidden;
    menu.hidden = !on;
    btn.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function closeRecurringModal() {
    setRecToolsOpen(false);
    $("#recurringModal").hidden = true;
    pendingConvertEntryId = null;
  }

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
    // On a foreign plan this box edits the sum you were billed, not the home
    // figure — that one is the rate's business, and it has its own box below.
    const ofx = fxOf(occ);
    $("#recOccAmountLabel").textContent = ofx ? "Amount billed (" + ofx.currency + ")" : "Amount";
    $("#recOccAmount").value = ofx ? ofx.amount : occ.amount;
    $("#recOccRateLabel").hidden = !ofx;
    $("#recOccRate").value = ofx ? ofx.rate : "";
    $("#recOccNote").value = occ.note || "";
    applyRecurringOccCurrencyUI();
    // While a pause covers this date the skip checkbox has nothing to say —
    // unticking it wouldn't bring the occurrence back, since the pause is
    // what's suppressing it. Lock it and point at where to actually fix it.
    $("#recOccSkip").checked = !!occ.skipped;
    $("#recOccSkip").disabled = !!occ.paused;
    $("#recOccPausedHint").hidden = !occ.paused;
    $("#resetRecOccBtn").hidden = !occ.overridden;
    $("#recurringOccModal").hidden = false;
  }
  // The occurrence editor's preview, which unlike the template's is about
  // one real date, so it states a figure rather than a fallback.
  function applyRecurringOccCurrencyUI() {
    const label = $("#recOccAmountLabel").textContent;
    const m = /\(([A-Z]{3})\)/.exec(label);
    const preview = $("#recOccFxPreview");
    if (!m) { preview.hidden = true; return; }
    const code = m[1];
    const amount = readAmount("#recOccAmount");
    const rate = parseFloat($("#recOccRate").value);
    if (!isFinite(rate) || rate <= 0) {
      preview.textContent = "1 " + code + " = how many " + homeCurrency() + "?";
      preview.hidden = false;
      return;
    }
    preview.textContent = (amount
      ? formatIn(amount, code) + " = " + formatMoney(amount * rate)
      : "Converted")
      + " at " + rate + " " + homeCurrency() + " per " + code + fxNote(code, rate);
    preview.hidden = false;
  }

  function closeRecurringOccModal() { $("#recurringOccModal").hidden = true; }

  async function saveRecurringOccFromForm(ev) {
    ev.preventDefault();
    const rec = state.data.recurringExpenses.find((x) => x.id === $("#recOccRecId").value);
    if (!rec) return;
    const date = $("#recOccDate").value;
    const typed = readAmount("#recOccAmount");
    const note = $("#recOccNote").value.trim();
    const planFx = fxOf(rec);
    if (planFx) {
      const rate = parseFloat($("#recOccRate").value);
      if (!isFinite(rate) || rate <= 0) {
        toast("Give a rate for " + planFx.currency + " on this date", true);
        return;
      }
      // Freezing it here is the same act "Look up past rates" performs in
      // bulk — a rate you set by hand is no less a fact than a fetched one.
      rec.rates = { ...(rec.rates || {}), [date]: rate };
    }
    const amount = typed;
    // A paused date's checkbox is ticked and locked purely to reflect the
    // pause, so reading it here would bake a skip override in that outlives
    // the pause. The pause is already the reason it's suppressed.
    const skip = !isPausedOn(rec, date) && $("#recOccSkip").checked;
    const ov = {};
    if (skip) ov.skip = true;
    if (planFx) { if (amount !== rec.fxAmount) ov.fxAmount = amount; }
    else if (amount !== rec.amount) ov.amount = amount;
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

  // Set or clear a plan's foreign billing in one place, so the add and edit
  // branches can't drift apart.
  //
  // Switching a plan back to your home currency drops the frozen rates with
  // it: they describe charges in a currency the plan no longer claims to be
  // billed in, and leaving them would make them reappear — silently repricing
  // history — if it were ever switched back.
  function applyPlanCurrency(r, fx) {
    if (!fx) {
      delete r.currency; delete r.fxAmount; delete r.rate; delete r.rates;
      return;
    }
    // A currency change invalidates the frozen rates for the same reason:
    // they are dollars-per-shekel readings, and this plan is in euros now.
    if (r.currency && r.currency !== fx.code) delete r.rates;
    r.currency = fx.code;
    r.fxAmount = fx.typed;
    r.rate = fx.rate;
  }

  async function saveRecurringFromForm(ev) {
    ev.preventDefault();
    const id = $("#recId").value;
    const startDate = $("#recStart").value;
    const endDate = $("#recEnd").value;
    const interval = $("#recInterval").value;
    const typed = readAmount("#recAmount");
    const category = $("#recCategory").value;
    const note = $("#recNote").value.trim();
    if (!startDate || !typed) return;
    if (endDate && endDate < startDate) { toast("The stop date can't be before the start date", true); return; }
    // Same rule as the expense form: the typed figure is what you're billed,
    // and `amount` is always the home-currency one it works out to.
    const code = $("#recCurrency").value;
    const foreign = !!code && code !== homeCurrency();
    const rate = foreign ? parseFloat($("#recRate").value) : 0;
    if (foreign && (!isFinite(rate) || rate <= 0)) {
      toast("Give a rate for " + code + ", or switch back to " + homeCurrency(), true);
      return;
    }
    const amount = foreign ? Math.round(typed * rate * 100) / 100 : typed;
    const converted = pendingConvertEntryId;
    if (id) {
      const r = state.data.recurringExpenses.find((x) => x.id === id);
      Object.assign(r, { startDate, interval, amount, category });
      applyPlanCurrency(r, foreign ? { code, typed, rate } : null);
      const rProject = $("#recProject").value === ADD_PROJECT_OPTION ? "" : $("#recProject").value;
      if (rProject) r.project = rProject; else delete r.project;
      if (note) r.note = note; else delete r.note;
      if (endDate) r.endDate = endDate; else delete r.endDate;
    } else {
      const item = { id: uid(), startDate, interval, amount, category, createdAt: new Date().toISOString() };
      applyPlanCurrency(item, foreign ? { code, typed, rate } : null);
      const rProject = $("#recProject").value === ADD_PROJECT_OPTION ? "" : $("#recProject").value;
      if (rProject) item.project = rProject;
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
    const pfx = fxOf(rec);
    $("#planCurrent").textContent = pfx
      ? `Currently ${formatIn(pfx.amount, pfx.currency)} ${rec.interval} (${formatMoney(rec.amount)} at ${pfx.rate}), ${rec.category}, since ${rec.startDate}.`
      : `Currently ${formatMoney(rec.amount)} ${rec.interval}, ${rec.category}, since ${rec.startDate}.`;
    $("#planFrom").value = nextOccurrenceDateAfter(rec, todayStr());
    $("#planFrom").min = addDaysStr(rec.startDate, 1);
    $("#planInterval").value = rec.interval;
    // In the plan's own currency, since that is the number that changed when
    // the price went up — the home figure follows from it.
    $("#planAmount").value = pfx ? pfx.amount : rec.amount;
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
    const planFx = fxOf(rec);
    const next = {
      interval: $("#planInterval").value,
      amount,
      category: $("#planCategory").value,
      note: $("#planNote").value.trim(),
    };
    // On a foreign plan the box holds the new billed figure; the rate carries
    // over, since a price change says nothing about the exchange rate.
    if (planFx) { next.fxAmount = amount; next.rate = planFx.rate; }
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
    const candidates = state.data.financeEntries.filter((e) => e.category === rec.category);
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

    const addRow = (r, isEnded, into) => {
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
      // A foreign plan reads the same way its charges do in the Ledger: the
      // sum you're billed beside what it comes to.
      const rfx = fxOf(r);
      if (rfx) {
        const tag = el("span", "fx-paid", formatIn(rfx.amount, rfx.currency));
        tag.title = "Billed " + formatIn(rfx.amount, rfx.currency) + " each " + r.interval.replace(/ly$/, "")
          + " period, at " + rfx.rate + " " + homeCurrency() + " per " + rfx.currency;
        row.appendChild(tag);
      }
      row.appendChild(el("span", "famount fnegative", "-" + formatMoney(r.amount)));
      row.onclick = () => openRecurringModal(r);
      (into || card).appendChild(row);
    };

    // Plans on a project gather into a pill, the same one the Ledger's month
    // cards use for a run of project expenses. Unlike there, these are
    // grouped rather than run-merged: this list is ordered by start date and
    // a trip's two subscriptions are rarely adjacent, so waiting for them to
    // touch would mean never grouping them at all.
    const byProject = (plans, isEnded) => {
      const loose = plans.filter((r) => !r.project);
      const named = plans.filter((r) => r.project);
      loose.forEach((r) => addRow(r, isEnded, card));
      const seen = [];
      for (const r of named) if (!seen.includes(r.project)) seen.push(r.project);
      for (const name of seen) {
        const mine = named.filter((r) => r.project === name);
        const color = projectColorOf(name);
        const box = el("div", "proj-group");
        box.style.setProperty("--proj-tint", color + "12");
        box.style.setProperty("--proj-head", color + "22");
        box.style.setProperty("--proj-edge", color + "59");
        const head = el("div", "proj-group-head");
        const dot = el("span", "dot");
        dot.style.background = color;
        head.appendChild(dot);
        const label = el("span", "proj-group-name", name);
        label.title = name;
        head.appendChild(label);
        // Opens the project, not a plan — the head names the group, exactly
        // as it does in the Ledger.
        const edit = el("button", "proj-group-edit", "✎");
        edit.type = "button";
        edit.title = "Edit " + name;
        edit.setAttribute("aria-label", edit.title);
        edit.onclick = (ev) => {
          ev.stopPropagation();
          const p = projectByName(name);
          if (p) openProjectModal(p);
        };
        head.appendChild(edit);
        box.appendChild(head);
        const list = el("div", "proj-group-list");
        mine.forEach((r) => addRow(r, isEnded, list));
        box.appendChild(list);
        card.appendChild(box);
      }
    };

    byProject(active.slice().sort((a, b) => a.startDate.localeCompare(b.startDate)), false);
    if (ended.length) {
      const sub = el("div", "recur-subhead");
      sub.appendChild(el("span", null, `Ended (${ended.length})`));
      card.appendChild(sub);
      byProject(ended.slice().sort((a, b) => b.endDate.localeCompare(a.endDate)), true);
    }
    root.appendChild(card);
  }

  // ---------- finance categories management ----------
  // ---------- projects ----------
  // The fourth copy of the add/edit-category modal, knowingly. DROPPED.md
  // says why the three existing ones weren't unified: their save paths
  // diverge in ways a shared form would have to resolve rather than absorb.
  // This one diverges further still — it carries a date range nothing else
  // has, and deleting it un-groups expenses instead of moving them to a
  // fallback, because there is no "Other project" and an expense without a
  // project is a perfectly ordinary expense.
  // Which form to hand back to after adding a project inline, and which
  // select on it to fill in. A boolean pointing at #financeModal was enough
  // while the expense form was the only caller — the recurring form offered
  // "+ New project…" too, and picking it did nothing at all, then saved as
  // no project.
  let pendingProjectReturn = null; // { modal, select } | null

  function openProjectModal(proj, opts) {
    const editing = !!proj;
    pendingProjectReturn = (opts && opts.returnTo) || null;
    $("#projectModalTitle").textContent = editing ? "Edit project" : "New project";
    $("#projOrigName").value = editing ? proj.name : "";
    $("#projName").value = editing ? proj.name : "";
    $("#projColorInput").value = editing ? proj.color : "#3bb2e2";
    // Convert is offered once there is something to convert: expenses in
    // this project that were paid in a currency other than yours.
    $("#convertProjectBtn").hidden = !(editing && projectExpenses(proj).length);
    const uses = $("#projUses");
    const list = $("#projExpenses");
    if (editing) {
      // Effective entries, so a recurring expense assigned to this project
      // counts here exactly as it does in the month cards.
      const items = getEffectiveFinanceEntries()
        .filter((f) => f.project === proj.name && !f.skipped)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const total = items.reduce((sum, f) => sum + f.amount, 0);
      uses.textContent = items.length
        ? `${items.length} expense${items.length === 1 ? "" : "s"}, ${formatMoney(total)}`
        : "No expenses yet";
      uses.hidden = false;
      fillProjectExpenses(list, items);
    } else { uses.hidden = true; list.hidden = true; }
    $("#deleteProjectBtn").hidden = !editing;
    $("#projectModal").hidden = false;
  }
  // Everything in the project, so "what did this actually consist of" is
  // answered where you are already looking at it rather than by scrolling
  // months. A row opens that expense, which is the other thing you come here
  // wanting to do.
  function fillProjectExpenses(list, items) {
    list.hidden = !items.length;
    if (!items.length) { list.replaceChildren(); return; }
    const rows = items.map((f) => {
      const row = el("div", "proj-expense");
      row.appendChild(el("span", "proj-expense-date", String(f.date).slice(5)));
      const dot = el("span", "dot");
      dot.style.background = financeColorOf(f.category);
      row.appendChild(dot);
      const name = el("span", "proj-expense-name", f.note || f.category);
      name.title = (f.note ? f.note + " · " : "") + f.category;
      row.appendChild(name);
      if (f.virtual) {
        const badge = el("span", "recur-badge", "↻");
        badge.title = "From a recurring expense";
        row.appendChild(badge);
      }
      const fx = fxOf(f);
      if (fx) row.appendChild(el("span", "fx-paid", formatIn(fx.amount, fx.currency)));
      row.appendChild(el("span", "famount" + (isProvisional(f) ? " is-provisional" : ""), formatMoney(f.amount)));
      // A generated occurrence has no entry of its own to open; its template
      // does, and that is what editing it means.
      row.onclick = () => {
        closeProjectModal();
        if (f.virtual) {
          const rec = state.data.recurringExpenses.find((r) => r.id === f.recurringId);
          if (rec) openRecurringModal(rec);
        } else openFinanceModal(f);
      };
      return row;
    });
    list.replaceChildren(...rows);
  }

  function closeProjectModal() { $("#projectModal").hidden = true; }
  // Backing out of a project opened from the expense form puts you back in
  // the expense form, with whatever was selected before still selected.
  function cancelProjectModal() {
    closeProjectModal();
    const back = pendingProjectReturn;
    if (back) {
      pendingProjectReturn = null;
      // Back to whatever it was before "+ New project…" was picked, so
      // cancelling the project leaves the form as it was found.
      fillProjectSelect($(back.select), $(back.select).dataset.prevValue || "");
      $(back.modal).hidden = false;
    }
  }

  async function saveProjectFromForm(ev) {
    ev.preventDefault();
    const orig = $("#projOrigName").value;
    const name = $("#projName").value.trim();
    const color = $("#projColorInput").value;
    if (!name) return;
    const clash = (p) => p.name.toLowerCase() === name.toLowerCase();
    const projects = state.data.projects;

    if (!orig) {
      if (projects.some(clash)) { toast("That project already exists", true); return; }
      const now = new Date().toISOString();
      const item = { id: uid(), name, color, createdAt: now, updatedAt: now };
      projects.push(item);
    } else {
      const proj = projects.find((p) => p.name === orig);
      if (!proj) return;
      if (name !== proj.name && projects.some((p) => p !== proj && clash(p))) {
        toast("A project with that name already exists", true);
        return;
      }
      proj.color = color;
      if (name !== proj.name) {
        // The id stays put — it's the merge identity — and the name cascades
        // across the entries that reference it, exactly as a finance category
        // rename does.
        const old = proj.name;
        proj.name = name;
        state.data.financeEntries.forEach((f) => { if (f.project === old) f.project = name; });
      }
    }
    closeProjectModal();
    rebuildProjectColorMap();
    buildProjectFilter();
    const back = pendingProjectReturn;
    if (back) {
      pendingProjectReturn = null;
      fillProjectSelect($(back.select), name);
      $(back.modal).hidden = false;
    }
    render();
    await persist();
    toast(orig ? "Project updated" : "Project added");
  }

  // ---------- convert ----------
  // Two ways in, because they are the two ways you actually know the number.
  // Either you looked up the rate, or — far more often — the statement
  // arrived and the trip came to a figure, and the rate is whatever makes
  // that true. The second includes your bank's spread and fees, which no
  // published rate does, so it is the more accurate of the two.
  let convertingProject = null;

  // ---------- looking a rate up ----------
  // Google has no public FX API — Google Finance never exposed one and the
  // old Currency API was retired — so "check with Google" is not a thing that
  // can be built. These two are keyless and send CORS headers, which is what
  // a browser-only app actually needs: no proxy, no key in localStorage.
  //
  // Two sources with different failure modes, for the same reason the media
  // lookups have a primary and a fallback: an API host and a CDN do not go
  // down together.
  //
  // Both answer in the direction LifeLog stores — `rate` is home per foreign,
  // so 1 CHF = <rate> ILS (see saveFinanceFromForm).
  const FX_TIMEOUT_MS = 8000;

  async function fxJson(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FX_TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Six significant digits rather than a fixed number of decimals: 4dp is
  // plenty for 1 CHF = 4.1234 ILS and destroys 1 IDR = 0.000234 ILS, which
  // would round to 0.0002 and be wrong by more than a tenth.
  const fxRound = (n) => +Number(n).toPrecision(6);

  // `date` is the expense's own, not today's. An expense on 4 June converted
  // at today's rate is a number that was never true. ECB publishes on
  // business days only, so a weekend asks for and receives the Friday before
  // it — which the caller says out loud rather than hiding.
  async function fetchRate(from, to, date) {
    const f = String(from || "").toUpperCase();
    const t = String(to || "").toUpperCase();
    if (!f || !t) return null;
    if (f === t) return { rate: 1, date: date || "", source: "" };
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date || "") && date <= todayStr() ? date : "latest";

    const a = await fxJson(`https://api.frankfurter.dev/v1/${day}?base=${f}&symbols=${t}`);
    const ar = a && a.rates && +a.rates[t];
    if (isFinite(ar) && ar > 0) return { rate: fxRound(ar), date: a.date || "", source: "ECB" };

    // Same numbers off a CDN, version-pinned to the same day, so a dead API
    // host isn't a dead button.
    const lo = f.toLowerCase(), tlo = t.toLowerCase();
    const b = await fxJson(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/${lo}.json`);
    const br = b && b[lo] && +b[lo][tlo];
    if (isFinite(br) && br > 0) return { rate: fxRound(br), date: b.date || "", source: "Currency API" };
    return null;
  }

  // Rates for many dates at once, for freezing a plan's past charges. One
  // request where there would otherwise be one per occurrence: Frankfurter
  // serves a date range, and its reply is keyed by date.
  //
  // It only quotes business days, so a charge that falls on a weekend or a
  // holiday has no key of its own and takes the last quoted day before it —
  // which is the rate that was actually in force when the card was charged.
  async function fetchRateSeries(from, to, start, end) {
    const f = String(from || "").toUpperCase(), t = String(to || "").toUpperCase();
    if (!f || !t || f === t) return null;
    const j = await fxJson(`https://api.frankfurter.dev/v1/${start}..${end}?base=${f}&symbols=${t}`);
    const rates = j && j.rates;
    if (!rates || typeof rates !== "object") return null;
    const days = Object.keys(rates).sort();
    if (!days.length) return null;
    return {
      source: "ECB",
      // Last quote on or before the date asked for; null before the series
      // starts, so the caller can fall back rather than invent one.
      on(dateStr) {
        let lo = 0, hi = days.length - 1, found = null;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (days[mid] <= dateStr) { found = days[mid]; lo = mid + 1; } else hi = mid - 1;
        }
        const v = found && +rates[found][t];
        return isFinite(v) && v > 0 ? { rate: fxRound(v), date: found } : null;
      },
    };
  }

  // Anything the series could not answer is asked for one date at a time,
  // through the same two-host lookup a single expense uses. Capped, because
  // this is the fallback for a dead range endpoint and a decade of a weekly
  // bill is not worth five hundred requests — it fills what it can and the
  // caller says how many that was.
  const RATE_BACKFILL_CAP = 60;
  const RATE_BACKFILL_CONCURRENCY = 5;
  async function fetchRatesOneByOne(code, home, dates) {
    const out = new Map();
    const queue = dates.slice(0, RATE_BACKFILL_CAP);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= queue.length) return;
        const got = await fetchRate(code, home, queue[i]);
        if (got) out.set(queue[i], got.rate);
      }
    };
    await Promise.all(Array.from({ length: RATE_BACKFILL_CONCURRENCY }, worker));
    return out;
  }

  // Freeze a rate onto every past occurrence that hasn't got one. Future
  // dates are deliberately left alone: a charge that hasn't happened has no
  // rate yet, and writing today's would dress a forecast up as a fact.
  async function fetchPastRatesFor(rec, btn) {
    const home = homeCurrency();
    if (!rec || !rec.currency || rec.currency === home) { toast("This plan is already in " + home); return; }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const missing = recurringOccurrences(rec, today)
      .filter((o) => !o.skipped && o.date <= todayStr() && !(rec.rates && rec.rates[o.date]))
      .map((o) => o.date);
    if (!missing.length) { toast("Every past charge already has its own rate"); return; }

    const label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Looking up " + missing.length + " rates…"; }
    try {
      const found = new Map();
      // The range starts a week early on purpose. A charge on the 15th of a
      // month that falls on a Saturday has no quote of its own and takes the
      // preceding business day's — which is outside the range if the range
      // begins on the charge itself, leaving the very first date unanswered.
      // A week covers any weekend and every public holiday run worth having.
      const series = await fetchRateSeries(
        rec.currency, home, addDaysStr(missing[0], -7), missing[missing.length - 1]);
      if (series) for (const d of missing) {
        const hit = series.on(d);
        if (hit) found.set(d, hit.rate);
      }
      const stillMissing = missing.filter((d) => !found.has(d));
      if (stillMissing.length) {
        for (const [d, r] of await fetchRatesOneByOne(rec.currency, home, stillMissing)) found.set(d, r);
      }
      if (!found.size) { toast("Couldn't reach rates for " + rec.currency + " — set them per charge instead", true); return; }
      rec.rates = { ...(rec.rates || {}), ...Object.fromEntries(found) };
      const short = missing.length - found.size;
      render();
      await persist();
      toast(short
        ? "Froze " + found.size + " rates — " + short + " dates couldn't be reached"
        : "Froze the rate for " + found.size + (found.size === 1 ? " charge" : " charges"), !!short);
      // Reopen so the occurrence list shows what the charges actually came to.
      openRecurringModal(state.data.recurringExpenses.find((x) => x.id === rec.id));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  // What the last successful lookup said, so the form can name the date and
  // source it used. Cleared by any rate that isn't the one it returned, which
  // is how typing over it makes the note go away on its own.
  let lastFx = null;

  function fxNote(code, rate) {
    if (!lastFx || lastFx.code !== code || lastFx.rate !== rate) return "";
    const d = lastFx.date;
    const pretty = /^\d{4}-\d{2}-\d{2}$/.test(d)
      ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })
      : "";
    return pretty ? ` — ${lastFx.source} rate for ${pretty}` : "";
  }

  // Shared by both buttons: the lookup, the button's own busy state, and the
  // one toast that says why nothing happened.
  async function runRateLookup(btn, code, date, onRate) {
    const home = homeCurrency();
    if (!code || code === home) { toast("Pick a currency other than " + home); return; }
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";
    try {
      const got = await fetchRate(code, home, date);
      if (!got) { toast("Couldn't reach a rate for " + code + " — type it in", true); return; }
      lastFx = { code, rate: got.rate, date: got.date, source: got.source };
      onRate(got);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function openConvertModal(proj) {
    convertingProject = proj;
    const codes = projectCurrencies(proj);
    fillSelect($("#convCurrency"), codes.map((c) => ({ value: c, label: c })), codes[0] || "");
    $("#convCurrencyLabel").hidden = codes.length < 2;
    $("#convertModalTitle").textContent = "Convert " + proj.name;
    $("#convProjName").value = proj.name;
    $("#convTotalLabel").firstChild.textContent = "Total charged in " + homeCurrency() + " ";
    $("#convTotal").value = "";
    $("#convRate").value = "";
    updateConvertIntro();
    $("#projectModal").hidden = true;
    $("#convertModal").hidden = false;
  }

  // Restated whenever the currency changes: how many expenses are about to
  // move, what they came to in that currency, and the rate they are on now.
  function updateConvertIntro() {
    const proj = convertingProject;
    if (!proj) return;
    const code = $("#convCurrency").value;
    const own = projectExpenses(proj, code);
    const fxTotal = own.reduce((sum, f) => sum + (+f.fxAmount || 0), 0);
    const rates = [...new Set(own.map((f) => f.rate))];
    $("#convIntro").textContent = own.length + " expense" + (own.length === 1 ? "" : "s")
      + " totalling " + formatIn(fxTotal, code)
      + (rates.length === 1
        ? (own.every((f) => f.rateConfirmed) ? ", converted at " + rates[0] : ", provisionally at " + rates[0])
        : ", at " + rates.length + " different rates") + ".";
    if (!$("#convRate").value && rates.length === 1) $("#convRate").value = rates[0];
    updateConvertSummary();
  }

  function closeConvertModal() { $("#convertModal").hidden = true; convertingProject = null; }

  // Every foreign expense in the project, optionally narrowed to one
  // currency. Real entries only, for two reasons that both still hold now
  // that a recurring expense CAN be foreign (0.165.0): a recurring
  // occurrence is generated rather than stored, so there is nothing to
  // restamp; and a plan's rates are frozen per charge on purpose, so
  // settling a whole project at one rate must not reach in and restate
  // them — that is the drift occurrenceFx exists to prevent. A foreign
  // plan inside a converted project therefore keeps its own rates, which
  // is the intended answer rather than an oversight.
  const projectExpenses = (proj, code) => state.data.financeEntries
    .filter((f) => f.project === proj.name && f.currency && +f.fxAmount
      && f.currency !== homeCurrency() && (!code || f.currency === code));

  // The distinct currencies a project was spent in, biggest total first — a
  // trip through Switzerland and Italy is two, and Convert settles one at a
  // time rather than pretending they share a rate.
  function projectCurrencies(proj) {
    const totals = {};
    for (const f of projectExpenses(proj)) totals[f.currency] = (totals[f.currency] || 0) + (+f.fxAmount || 0);
    return Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  }

  function convertFxTotal() {
    if (!convertingProject) return 0;
    return projectExpenses(convertingProject, $("#convCurrency").value)
      .reduce((s, f) => s + (+f.fxAmount || 0), 0);
  }

  function updateConvertSummary() {
    const rate = parseFloat($("#convRate").value);
    const fxTotal = convertFxTotal();
    const out = $("#convSummary");
    if (!isFinite(rate) || rate <= 0 || !fxTotal) { out.hidden = true; return; }
    out.textContent = formatIn(fxTotal, $("#convCurrency").value) + " → " + formatMoney(fxTotal * rate);
    out.hidden = false;
  }

  async function saveConvertFromForm(ev) {
    ev.preventDefault();
    const proj = convertingProject;
    if (!proj) return;
    const rate = parseFloat($("#convRate").value);
    if (!isFinite(rate) || rate <= 0) { toast("Give a rate, or a total to work it out from", true); return; }
    const code = $("#convCurrency").value;
    const own = projectExpenses(proj, code);
    for (const f of own) {
      f.rate = rate;
      f.amount = Math.round((+f.fxAmount || 0) * rate * 100) / 100;
    }
    // Settlement is recorded per expense, not on the project: a trip through
    // Switzerland and Italy is converted one currency at a time, and the
    // francs being settled says nothing about the euros.
    for (const f of own) f.rateConfirmed = true;
    closeConvertModal();
    render();
    await persist();
    toast(`Converted ${own.length} expense${own.length === 1 ? "" : "s"} at ${rate}`);
  }

  async function deleteCurrentProject() {
    const proj = state.data.projects.find((p) => p.name === $("#projOrigName").value);
    if (!proj) return;
    const n = state.data.financeEntries.filter((f) => f.project === proj.name).length;
    // Un-grouped, not deleted, and not moved to a fallback: the expenses are
    // real and stay exactly where they are in their months. Only the grouping
    // goes, which is the thing being deleted.
    if (n > 0 && !confirm(`Delete “${proj.name}”? Its ${n} expense${n === 1 ? "" : "s"} stay where they are, just no longer grouped.`)) return;
    state.data.projects = state.data.projects.filter((p) => p !== proj);
    state.data.financeEntries.forEach((f) => { if (f.project === proj.name) delete f.project; });
    closeProjectModal();
    rebuildProjectColorMap();
    buildProjectFilter();
    render();
    await persist();
    toast("Project deleted");
  }

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
    // Case-insensitive, matching the to-do and journal modals: "Games" and
    // "games" are the same category to a reader, and the entries that carry
    // the name as a string can only ever point at one of them.
    const clash = (c) => c.name.toLowerCase() === newName.toLowerCase();

    if (!orig) { // adding a new category
      if (state.data.financeCategories.some(clash)) {
        toast("That category already exists", true);
        return;
      }
      const now = new Date().toISOString();
      // See the journal's equivalent: this collection syncs, so it needs an
      // updatedAt for merge.js to decide between two devices.
      state.data.financeCategories.push({ id: newName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: newName, color, createdAt: now, updatedAt: now });
      closeFinanceCatModal();
      rebuildFinanceColorMap(); buildCatFilter(); render();
      await persist();
      toast("Finance category added");
      resolvePendingCatSelect(newName);
      return;
    }

    const cat = state.data.financeCategories.find((c) => c.name === orig);
    if (!cat) return;
    if (newName !== cat.name && state.data.financeCategories.some((c) => c !== cat && clash(c))) {
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
    // trailing label — that label should only be excluded from the
    // whole-year-column check below, not used to skip the row's own monthly data
    const reservedLabels = new Set([...MONTHS.slice(1), ...rowSkipLabels]);
    const monthly = [];
    // The export's year-total column: a big purchase the sheet recorded
    // against the year rather than a month. It has no month to land in, so it
    // takes 1 January — the same rule the sanitizer applies to a legacy
    // yearly entry, since the kind of entry it used to become no longer
    // exists.
    const undated = [];
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
        if (amount) undated.push({ date: `${currentYear}-01-01`, amount, category: "Other", note: label });
      }
    }
    if (currentYear === null) throw new Error("No year blocks found — is this the right CSV export?");
    return { monthly, undated };
  }
  function importFinanceCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { monthly, undated } = parseFinanceCsv(reader.result);
        const incoming = [...monthly, ...undated];
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
        // Amount stays the home figure so the column still sums in a
        // spreadsheet; what was paid rides in three columns beside it.
        const rows = [["Date", "Amount", "Category", "Note", "Project", "Currency", "Paid", "Rate"]];
        selected.map((i) => i.entry).sort((a, b) => b.date.localeCompare(a.date)).forEach((f) =>
          rows.push([f.date, f.amount, f.category, f.note || "",
            f.project || "", f.currency || "", f.fxAmount || "", f.rate || ""]));
        download("lifelog-finance.csv", rows.map((r) => r.map(csvEsc).join(",")).join("\n"), "text/csv");
        toast(`Exported ${selected.length} entr${selected.length === 1 ? "y" : "ies"}`);
      },
    });
  }

  // ---------- data lifecycle ----------
  // See keepUnknown in app.js: fields this build doesn't know about are
  // carried through rather than dropped, so a device on an older build can't
  // silently delete a newer one's data.
  const KNOWN_FINANCE_ENTRY_KEYS = new Set([
    "id", "date", "amount", "category", "createdAt", "updatedAt", "note", "project",
    "currency", "fxAmount", "rate", "rateConfirmed",
  ]);
  // startDate/endDate are deliberately absent: projects carried a date range
  // until 0.148.0, and one that still has it keeps it untouched through
  // keepUnknown. Nothing reads it — NOTES.md says why it went.
  const KNOWN_PROJECT_KEYS = new Set([
    "id", "name", "color", "createdAt", "updatedAt",
  ]);
  const KNOWN_RECURRING_KEYS = new Set([
    "id", "startDate", "interval", "amount", "category", "createdAt", "updatedAt",
    "note", "endDate", "prevId", "overrides", "pauses", "project",
    // A plan billed in a currency that isn't yours: fxAmount is what you're
    // charged each period, rate is the fallback used for a date with no
    // frozen rate of its own, and rates freezes one per occurrence date.
    // `amount` stays the home-currency figure, same invariant as an expense.
    "currency", "fxAmount", "rate", "rates",
  ]);
  function sanitizeFinanceEntry(f) {
    const out = {
      id: f.id || uid(),
      date: f.date || "",
      amount: Math.abs(+f.amount) || 0,
      category: f.category || "Other",
      createdAt: f.createdAt || null,
      updatedAt: backfillUpdatedAt(f),
    };
    // Yearly entries are gone (0.150.0). One left in the data carries a bare
    // year for a date, which every month lookup below would read as NaN, so
    // it becomes an ordinary expense on 1 January of that year. The month is
    // invented — a lump had none — but a dated expense is a real row and a
    // broken date is not, and no row is deleted to make the feature go away.
    if (/^\d{4}$/.test(out.date)) out.date = out.date + "-01-01";
    if (f.note) out.note = f.note;
    // Referenced by name, exactly as `category` is — the rename cascade in
    // saveProjectFromForm is the same one finance categories already use.
    if (f.project) out.project = String(f.project);
    // All three or none: a currency without a rate can't produce the home
    // amount above, and half a conversion is worse than none. A junk trio is
    // dropped and `amount` stands on its own, which is a plain expense.
    const rate = +f.rate;
    const fxAmount = Math.abs(+f.fxAmount);
    if (f.currency && isFinite(rate) && rate > 0 && isFinite(fxAmount)) {
      out.currency = String(f.currency).toUpperCase().slice(0, 8);
      out.rate = rate;
      out.fxAmount = Math.round(fxAmount * 100) / 100;
      if (f.rateConfirmed) out.rateConfirmed = true;
    }
    const kept = keepUnknown(f, out, KNOWN_FINANCE_ENTRY_KEYS);
    // keepUnknown exists so a build older than the data can't silently drop
    // what a newer one added. `yearly` is the opposite case — a field this
    // build deliberately retired — and carrying it would leave every migrated
    // row paired with a flag that tells an older build to truncate the date
    // back to a bare year. Retired, so dropped on purpose.
    delete kept.yearly;
    return kept;
  }

  // A project is a one-off burst of spending you want totalled on its own and
  // kept out of your monthly average: a holiday, a renovation, a wedding. The
  // shape deliberately mirrors a finance category (name + colour, referenced
  // by name) and adds an optional date range, which is what lets the expense
  // form offer the right project for a date without being asked.
  function sanitizeProject(p) {
    const out = {
      id: p.id || uid(),
      name: String(p.name == null ? "" : p.name),
      color: p.color || "#7a8a99",
      updatedAt: backfillUpdatedAt(p),
    };
    if (p.createdAt) out.createdAt = p.createdAt;
    // Nothing else. A project is a name and a colour: the money, the
    // currency, the rate and whether it has been settled all live on the
    // expenses, because that is where they actually are.
    return keepUnknown(p, out, KNOWN_PROJECT_KEYS);
  }
  const financeKey = (f) => `${(f.date || "").toLowerCase()}|${+f.amount}|${(f.category || "").toLowerCase()}|${(f.note || "").toLowerCase()}|${(f.project || "").toLowerCase()}|${(f.currency || "").toUpperCase()}|${+f.fxAmount || 0}`;
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
    // Foreign billing. Kept only as a complete set — a currency with no rate
    // would make every occurrence's home figure a guess, and dropping the
    // lot is better than carrying half of it into a total.
    const fxAmount = Math.abs(+r.fxAmount) || 0;
    const rate = +r.rate;
    if (r.currency && fxAmount && isFinite(rate) && rate > 0) {
      out.currency = String(r.currency);
      out.fxAmount = fxAmount;
      out.rate = rate;
      if (r.rates && typeof r.rates === "object") {
        const rates = {};
        for (const [date, v] of Object.entries(r.rates)) {
          const n = +v;
          if (/^\d{4}-\d{2}-\d{2}$/.test(date) && isFinite(n) && n > 0) rates[date] = n;
        }
        if (Object.keys(rates).length) out.rates = rates;
      }
    }
    // Every occurrence this template generates inherits it, so a subscription
    // that belongs to a project groups with the rest of it.
    if (r.project) out.project = String(r.project);
    // The plan this one took over from — kept so a bill's history still
    // reads as one chain after an import/sync round-trip (see planChain).
    if (r.prevId) out.prevId = r.prevId;
    if (r.overrides && typeof r.overrides === "object") {
      const overrides = {};
      for (const [date, ov] of Object.entries(r.overrides)) {
        if (!ov || typeof ov !== "object") continue;
        const clean = {};
        if (ov.amount != null) clean.amount = Math.abs(+ov.amount) || 0;
        // On a foreign plan you change the sum you were billed, not the home
        // figure it works out to — that one is the rate's job.
        if (ov.fxAmount != null) clean.fxAmount = Math.abs(+ov.fxAmount) || 0;
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
    return keepUnknown(r, out, KNOWN_RECURRING_KEYS);
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

    $("#finCurrency").onchange = () => {
      const code = $("#finCurrency").value;
      // Switching to a foreign currency with an empty rate box borrows the
      // project's, if it has one — the common case is that they match.
      if (code !== homeCurrency() && !$("#finRate").value) {
        const pfx = projectFx($("#finProject").value);
        if (pfx && pfx.currency === code) $("#finRate").value = pfx.rate;
      }
      applyFinanceCurrencyUI();
    };
    $("#finRate").oninput = applyFinanceCurrencyUI;
    $("#finRateFetchBtn").onclick = () =>
      runRateLookup($("#finRateFetchBtn"), $("#finCurrency").value, $("#finDate").value, (got) => {
        $("#finRate").value = got.rate;
        applyFinanceCurrencyUI();
      });
    $("#finAmount").addEventListener("input", applyFinanceCurrencyUI);

    // The recurring form's three, mirroring the expense form's above. Its
    // "Look up" asks for today's rate rather than a date's: a plan has no one
    // date, and this box is the fallback for dates that have no rate yet.
    $("#recCurrency").onchange = applyRecurringCurrencyUI;
    $("#recRate").oninput = applyRecurringCurrencyUI;
    $("#recRateFetchBtn").onclick = () =>
      runRateLookup($("#recRateFetchBtn"), $("#recCurrency").value, todayStr(), (got) => {
        $("#recRate").value = got.rate;
        applyRecurringCurrencyUI();
      });
    $("#recAmount").addEventListener("input", applyRecurringCurrencyUI);
    $("#recFetchRatesBtn").onclick = () => {
      const rec = state.data.recurringExpenses.find((x) => x.id === $("#recId").value);
      setRecToolsOpen(false);
      if (rec) fetchPastRatesFor(rec, $("#recFetchRatesBtn"));
    };

    // And the occurrence editor's, where the date is known, so the lookup
    // asks for the rate that day actually had.
    $("#recOccRate").oninput = applyRecurringOccCurrencyUI;
    $("#recOccAmount").addEventListener("input", applyRecurringOccCurrencyUI);
    $("#recOccRateFetchBtn").onclick = () => {
      const rec = state.data.recurringExpenses.find((x) => x.id === $("#recOccRecId").value);
      const fx = rec && fxOf(rec);
      if (!fx) return;
      runRateLookup($("#recOccRateFetchBtn"), fx.currency, $("#recOccDate").value, (got) => {
        $("#recOccRate").value = got.rate;
        applyRecurringOccCurrencyUI();
      });
    };

    $("#convertProjectBtn").onclick = () => {
      const proj = state.data.projects.find((p) => p.name === $("#projOrigName").value);
      if (proj) openConvertModal(proj);
    };
    // No single date here — a project spans them — so Convert asks for the
    // latest rate, which is the one you are settling at.
    $("#convRateFetchBtn").onclick = () =>
      runRateLookup($("#convRateFetchBtn"), $("#convCurrency").value, "", (got) => {
        $("#convRate").value = got.rate;
        $("#convRate").dispatchEvent(new Event("input", { bubbles: true }));
      });
    $("#cancelConvertBtn").onclick = closeConvertModal;
    $("#convertForm").onsubmit = saveConvertFromForm;
    $("#convCurrency").onchange = () => { $("#convRate").value = ""; $("#convTotal").value = ""; updateConvertIntro(); };
    $("#convRate").oninput = () => { $("#convTotal").value = ""; updateConvertSummary(); };
    // Typing what the statement says derives the rate, rather than making you
    // do the division. The two fields drive each other, last one edited wins.
    $("#convTotal").oninput = () => {
      const total = parseFloat($("#convTotal").value);
      const fxTotal = convertFxTotal();
      if (!isFinite(total) || total <= 0 || !fxTotal) return;
      $("#convRate").value = Math.round((total / fxTotal) * 1e6) / 1e6;
      updateConvertSummary();
    };

    $("#cancelProjectBtn").onclick = cancelProjectModal;
    $("#projectForm").onsubmit = saveProjectFromForm;
    $("#deleteProjectBtn").onclick = deleteCurrentProject;
    // "+ New project…" hides the expense form, opens the project one, and
    // comes back with the new project selected — the same round trip
    // wireCategorySelect does for categories.
    $("#finProject").onchange = () => {
      const sel = $("#finProject");
      if (sel.value !== ADD_PROJECT_OPTION) {
        sel.dataset.prevValue = sel.value;
        inheritProjectCurrency();
        return;
      }
      $("#financeModal").hidden = true;
      openProjectModal(null, { returnTo: { modal: "#financeModal", select: "#finProject" } });
    };
    // The same offer on the recurring form, which had the option in its
    // dropdown and no handler behind it.
    $("#recMoreBtn").onclick = (ev) => {
      // Or the document listener below would close it in the same click.
      ev.stopPropagation();
      setRecToolsOpen($("#recMoreBtn").getAttribute("aria-expanded") !== "true");
    };
    // Picking one is the end of the menu's job, whatever it then opens.
    $("#recMoreMenu").querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => setRecToolsOpen(false));
    });
    // Same dismissal as the + menu: anywhere else closes it.
    document.addEventListener("click", () => setRecToolsOpen(false));
    $("#recProject").onchange = () => {
      const sel = $("#recProject");
      if (sel.value !== ADD_PROJECT_OPTION) { sel.dataset.prevValue = sel.value; return; }
      $("#recurringModal").hidden = true;
      openProjectModal(null, { returnTo: { modal: "#recurringModal", select: "#recProject" } });
    };
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
    sanitizeProject,
    sanitizeRecurring,
    financeKey,
    recurringKey,
    // pure date/recurrence math (exported for test/finance.test.js)
    recurringOccurrences,
    occurrenceFx,
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
    // exported for test/finance.test.js — the date-range reply's shape and
    // its last-quote-on-or-before rule are the parts worth pinning down
    fetchRateSeries,
    parseMoneyCell,
    monthSortAsc,
    evalMathExpr,
    // shared lookups/formatting (used by the shared import picker rows)
    rebuildFinanceColorMap,
    financeColorOf,
    rebuildProjectColorMap,
    projectColorOf,
    groupRunsByProject,
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
    openProjectModal,
    closeProjectModal,
    cancelProjectModal,
    openConvertModal,
    closeConvertModal,
    // currency (test/finance.test.js)
    formatIn,
    fxOf,
    isProvisional,
  };
})();
