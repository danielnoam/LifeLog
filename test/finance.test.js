// Zero-dependency tests for src/finance.js's pure data logic — run with
// `node test/finance.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern.
const assert = require("assert");
global.window = {};
require("../src/finance.js");
const Finance = global.window.LifeLogFinance;

// finance.js gets uid()/backfillUpdatedAt() via init(ctx) rather than being
// fully free-standing like merge.js — supply trivial stubs so the sanitizers
// are callable in isolation.
let idCounter = 0;
Finance.init({
  uid: () => "test-id-" + (idCounter++),
  backfillUpdatedAt: (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z",
  // Same contract as the real one in app.js: copy anything the sanitizer
  // didn't name, so a build older than the data can't silently drop it.
  keepUnknown: (src, out, known) => {
    for (const key of Object.keys(src || {})) if (!known.has(key)) out[key] = src[key];
    return out;
  },
});

const {
  recurringOccurrences, nextRecurringDate, addMonthsClamped, localDateStr,
  addDaysStr, nextOccurrenceDateAfter, splitRecurring, planChain, isPausedOn, normalizePauses,
  sanitizeFinanceEntry, sanitizeRecurring, financeKey, recurringKey, seedFinanceCategories,
  closestOccurrenceDate, parseMoneyCell, monthSortAsc, evalMathExpr,
} = Finance;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok - " + name);
  } catch (e) {
    console.error("  FAIL - " + name);
    console.error("    " + e.message);
    process.exitCode = 1;
  }
}

// ---------- localDateStr ----------
test("localDateStr reads local calendar fields, no UTC round-trip", () => {
  // A late-night local date that would shift back a day if round-tripped
  // through toISOString() (UTC) in a timezone ahead of UTC.
  const d = new Date(2026, 0, 31, 23, 30, 0); // Jan 31 2026, 23:30 local
  assert.strictEqual(localDateStr(d), "2026-01-31");
});

// ---------- addMonthsClamped / nextRecurringDate ----------
test("addMonthsClamped clamps to the shorter receiving month", () => {
  const jan31 = new Date(2026, 0, 31);
  const next = addMonthsClamped(jan31, 1, 31);
  assert.strictEqual(next.getMonth(), 1); // February
  assert.strictEqual(next.getDate(), 28); // 2026 is not a leap year
});

test("addMonthsClamped keeps the anchor day in a longer month", () => {
  const jan15 = new Date(2026, 0, 15);
  const next = addMonthsClamped(jan15, 1, 15);
  assert.strictEqual(next.getMonth(), 1);
  assert.strictEqual(next.getDate(), 15);
});

test("addMonthsClamped handles a leap-year February correctly", () => {
  const jan31 = new Date(2024, 0, 31); // 2024 is a leap year
  const next = addMonthsClamped(jan31, 1, 31);
  assert.strictEqual(next.getMonth(), 1);
  assert.strictEqual(next.getDate(), 29);
});

test("nextRecurringDate: weekly adds 7 days", () => {
  const d = new Date(2026, 0, 1);
  const next = nextRecurringDate(d, "weekly", 1);
  assert.strictEqual(localDateStr(next), "2026-01-08");
});

test("nextRecurringDate: yearly adds 1 year", () => {
  const d = new Date(2026, 0, 15);
  const next = nextRecurringDate(d, "yearly", 15);
  assert.strictEqual(localDateStr(next), "2027-01-15");
});

test("nextRecurringDate: monthly clamps via addMonthsClamped", () => {
  const d = new Date(2026, 0, 31);
  const next = nextRecurringDate(d, "monthly", 31);
  assert.strictEqual(localDateStr(next), "2026-02-28");
});

// ---------- recurringOccurrences ----------
test("recurringOccurrences returns [] for an invalid startDate", () => {
  const occs = recurringOccurrences({ id: "r1", startDate: "not-a-date", amount: 10 }, new Date(2026, 5, 1));
  assert.deepStrictEqual(occs, []);
});

test("recurringOccurrences generates one occurrence per month up to the cutoff", () => {
  const occs = recurringOccurrences(
    { id: "r1", startDate: "2026-01-15", interval: "monthly", amount: 50, category: "Food" },
    new Date(2026, 2, 15) // until March 15
  );
  assert.deepStrictEqual(occs.map((o) => o.date), ["2026-01-15", "2026-02-15", "2026-03-15"]);
  assert.strictEqual(occs[0].id, "r1:0");
  assert.strictEqual(occs[0].amount, 50);
  assert.strictEqual(occs[0].virtual, true);
  assert.strictEqual(occs[0].overridden, false);
});

test("recurringOccurrences applies a per-date override's amount/note without touching other occurrences", () => {
  const occs = recurringOccurrences(
    {
      id: "r1", startDate: "2026-01-15", interval: "monthly", amount: 50, note: "base",
      overrides: { "2026-02-15": { amount: 75, note: "price went up" } },
    },
    new Date(2026, 2, 15)
  );
  assert.strictEqual(occs[0].amount, 50); // January unaffected
  assert.strictEqual(occs[0].overridden, false);
  assert.strictEqual(occs[1].amount, 75); // February overridden
  assert.strictEqual(occs[1].note, "price went up");
  assert.strictEqual(occs[1].overridden, true);
  assert.strictEqual(occs[2].amount, 50); // March unaffected
});

test("recurringOccurrences stops at endDate when it's earlier than the requested cutoff", () => {
  const occs = recurringOccurrences(
    { id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 10, endDate: "2026-02-01" },
    new Date(2026, 5, 1) // asked for through June, but endDate cuts it off in February
  );
  assert.deepStrictEqual(occs.map((o) => o.date), ["2026-01-01", "2026-02-01"]);
});

test("recurringOccurrences ignores endDate when it's later than the requested cutoff", () => {
  const occs = recurringOccurrences(
    { id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 10, endDate: "2026-12-01" },
    new Date(2026, 1, 1) // until Feb 1, well before the endDate
  );
  assert.deepStrictEqual(occs.map((o) => o.date), ["2026-01-01", "2026-02-01"]);
});

// ---------- pauses ----------
test("isPausedOn treats both ends of a pause as inclusive", () => {
  const rec = { pauses: [{ from: "2026-06-01", to: "2026-08-31" }] };
  assert.strictEqual(isPausedOn(rec, "2026-05-31"), false);
  assert.strictEqual(isPausedOn(rec, "2026-06-01"), true);  // first day
  assert.strictEqual(isPausedOn(rec, "2026-08-31"), true);  // last day
  assert.strictEqual(isPausedOn(rec, "2026-09-01"), false);
});

test("isPausedOn treats a pause with no end date as still running", () => {
  const rec = { pauses: [{ from: "2026-06-01" }] };
  assert.strictEqual(isPausedOn(rec, "2026-05-31"), false);
  assert.strictEqual(isPausedOn(rec, "2030-01-01"), true);
});

test("recurringOccurrences suppresses paused occurrences but still returns them for the Ledger", () => {
  const occs = recurringOccurrences(
    { id: "r1", startDate: "2026-01-05", interval: "monthly", amount: 45,
      pauses: [{ from: "2026-03-01", to: "2026-04-30" }] },
    new Date(2026, 4, 31)
  );
  assert.deepStrictEqual(occs.map((o) => o.date), ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05", "2026-05-05"]);
  assert.deepStrictEqual(occs.map((o) => o.skipped), [false, false, true, true, false]);
  assert.deepStrictEqual(occs.map((o) => o.paused), [false, false, true, true, false]);
});

test("a pause does not re-anchor the schedule — billing resumes on its original day", () => {
  const occs = recurringOccurrences(
    { id: "r1", startDate: "2026-01-05", interval: "monthly", amount: 45,
      pauses: [{ from: "2026-02-10", to: "2026-04-12" }] },
    new Date(2026, 5, 30)
  );
  const live = occs.filter((o) => !o.skipped).map((o) => o.date);
  assert.deepStrictEqual(live, ["2026-01-05", "2026-02-05", "2026-05-05", "2026-06-05"]); // still the 5th
});

test("a paused occurrence stays skipped even without a per-occurrence skip override", () => {
  const occs = recurringOccurrences(
    { id: "r1", startDate: "2026-01-05", interval: "monthly", amount: 45,
      pauses: [{ from: "2026-02-01" }], overrides: { "2026-02-05": { amount: 99 } } },
    new Date(2026, 1, 28)
  );
  const feb = occs.find((o) => o.date === "2026-02-05");
  assert.strictEqual(feb.skipped, true);
  assert.strictEqual(feb.paused, true);
  assert.strictEqual(feb.overridden, true); // the amount override is still recorded, just not counted
});

test("normalizePauses sorts, fuses overlapping ranges, and closes the gap between adjacent ones", () => {
  assert.deepStrictEqual(
    normalizePauses([{ from: "2026-06-01", to: "2026-06-30" }, { from: "2026-01-01", to: "2026-02-01" }]),
    [{ from: "2026-01-01", to: "2026-02-01" }, { from: "2026-06-01", to: "2026-06-30" }]
  );
  assert.deepStrictEqual(
    normalizePauses([{ from: "2026-01-01", to: "2026-03-01" }, { from: "2026-02-01", to: "2026-05-01" }]),
    [{ from: "2026-01-01", to: "2026-05-01" }] // overlapping
  );
  assert.deepStrictEqual(
    normalizePauses([{ from: "2026-01-01", to: "2026-01-31" }, { from: "2026-02-01", to: "2026-02-28" }]),
    [{ from: "2026-01-01", to: "2026-02-28" }] // back-to-back, no day between them
  );
});

test("normalizePauses lets an open-ended range absorb everything after it", () => {
  assert.deepStrictEqual(
    normalizePauses([{ from: "2026-01-01" }, { from: "2026-06-01", to: "2026-07-01" }]),
    [{ from: "2026-01-01" }]
  );
  // and an open end wins when it's the one being merged in
  assert.deepStrictEqual(
    normalizePauses([{ from: "2026-01-01", to: "2026-03-01" }, { from: "2026-02-01" }]),
    [{ from: "2026-01-01" }]
  );
});

test("normalizePauses drops entries with no start date and rights a backwards range", () => {
  assert.deepStrictEqual(normalizePauses([{ to: "2026-01-01" }, null]), []);
  assert.deepStrictEqual(
    normalizePauses([{ from: "2026-06-30", to: "2026-06-01" }]),
    [{ from: "2026-06-01", to: "2026-06-30" }]
  );
});

test("splitRecurring clips a pause that straddles the split across both plans", () => {
  const rec = {
    id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 50, category: "Fun",
    pauses: [{ from: "2026-02-01", to: "2026-02-28" }, { from: "2026-03-15", to: "2026-05-15" }],
  };
  const { prev, created } = splitRecurring(rec, "2026-04-01", { interval: "monthly", amount: 60, category: "Fun" }, "r2", "t1");
  assert.deepStrictEqual(prev.pauses, [
    { from: "2026-02-01", to: "2026-02-28" },  // entirely before, untouched
    { from: "2026-03-15", to: "2026-03-31" },  // clipped at the split
  ]);
  assert.deepStrictEqual(created.pauses, [{ from: "2026-04-01", to: "2026-05-15" }]); // the other half
});

test("splitRecurring keeps an open-ended pause open on the new plan", () => {
  const rec = { id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 50, category: "Fun", pauses: [{ from: "2026-02-01" }] };
  const { prev, created } = splitRecurring(rec, "2026-04-01", { interval: "monthly", amount: 60, category: "Fun" }, "r2", "t1");
  assert.deepStrictEqual(prev.pauses, [{ from: "2026-02-01", to: "2026-03-31" }]);
  assert.deepStrictEqual(created.pauses, [{ from: "2026-04-01" }]);
});

test("sanitizeRecurring normalizes pauses and drops malformed ones", () => {
  const out = sanitizeRecurring({
    startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food",
    pauses: [{ from: "2026-06-01", to: "2026-06-30" }, { to: "2026-09-01" }, "nope", { from: "2026-02-01", to: "2026-03-01" }],
  });
  assert.deepStrictEqual(out.pauses, [
    { from: "2026-02-01", to: "2026-03-01" },
    { from: "2026-06-01", to: "2026-06-30" },
  ]);
});

test("sanitizeRecurring omits pauses entirely when there are none left", () => {
  const out = sanitizeRecurring({ startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food", pauses: [] });
  assert.strictEqual(out.pauses, undefined);
});

// ---------- addDaysStr / nextOccurrenceDateAfter ----------
test("addDaysStr steps a calendar date without a UTC round-trip", () => {
  assert.strictEqual(addDaysStr("2026-03-01", -1), "2026-02-28");
  assert.strictEqual(addDaysStr("2024-03-01", -1), "2024-02-29"); // leap year
  assert.strictEqual(addDaysStr("2026-12-31", 1), "2027-01-01");
});

test("nextOccurrenceDateAfter lands on the schedule's own next date, not the day after", () => {
  const rec = { id: "r1", startDate: "2026-01-05", interval: "monthly", amount: 50 };
  assert.strictEqual(nextOccurrenceDateAfter(rec, "2026-03-20"), "2026-04-05");
  // exactly on an occurrence date -> the following one (strictly after)
  assert.strictEqual(nextOccurrenceDateAfter(rec, "2026-03-05"), "2026-04-05");
});

test("nextOccurrenceDateAfter ignores endDate — it answers where the next period would start", () => {
  const rec = { id: "r1", startDate: "2026-01-05", interval: "monthly", amount: 50, endDate: "2026-02-05" };
  assert.strictEqual(nextOccurrenceDateAfter(rec, "2026-03-20"), "2026-04-05");
});

// ---------- splitRecurring / planChain ----------
test("splitRecurring ends the old plan the day before the new one starts, with no gap or overlap", () => {
  const rec = { id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 50, category: "Fun", createdAt: "t0" };
  const { prev, created } = splitRecurring(rec, "2026-04-01", { interval: "yearly", amount: 500, category: "Fun" }, "r2", "t1");
  assert.strictEqual(prev.endDate, "2026-03-31");
  assert.strictEqual(created.startDate, "2026-04-01");
  assert.strictEqual(created.prevId, "r1");
  // the old plan's occurrences are exactly the ones before the change
  const before = recurringOccurrences(prev, new Date(2026, 11, 31));
  assert.deepStrictEqual(before.map((o) => o.date), ["2026-01-01", "2026-02-01", "2026-03-01"]);
  assert.ok(before.every((o) => o.amount === 50));
  // and the new plan picks up from the change date on the new terms
  const after = recurringOccurrences(created, new Date(2027, 11, 31));
  assert.deepStrictEqual(after.map((o) => o.date), ["2026-04-01", "2027-04-01"]);
  assert.ok(after.every((o) => o.amount === 500));
});

test("splitRecurring hands a stop date over to the new plan — the bill still ends when it was set to", () => {
  const rec = { id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 50, category: "Fun", endDate: "2026-06-30" };
  const { prev, created } = splitRecurring(rec, "2026-04-01", { interval: "monthly", amount: 60, category: "Fun" }, "r2", "t1");
  assert.strictEqual(prev.endDate, "2026-03-31");
  assert.strictEqual(created.endDate, "2026-06-30");
  assert.deepStrictEqual(
    recurringOccurrences(created, new Date(2027, 11, 31)).map((o) => o.date),
    ["2026-04-01", "2026-05-01", "2026-06-01"] // stops at the inherited end date, not run on forever
  );
});

test("splitRecurring leaves the original object untouched (callers get new records to splice in)", () => {
  const rec = { id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 50, category: "Fun" };
  splitRecurring(rec, "2026-04-01", { interval: "monthly", amount: 60, category: "Fun" }, "r2", "t1");
  assert.strictEqual(rec.endDate, undefined);
  assert.strictEqual(rec.amount, 50);
});

test("splitRecurring keeps pre-split overrides on the old plan and carries later ones over", () => {
  const rec = {
    id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 50, category: "Fun",
    overrides: { "2026-02-01": { amount: 55 }, "2026-05-01": { skip: true } },
  };
  const { prev, created, dropped } = splitRecurring(rec, "2026-04-01", { interval: "monthly", amount: 60, category: "Fun" }, "r2", "t1");
  assert.deepStrictEqual(Object.keys(prev.overrides), ["2026-02-01"]);
  assert.deepStrictEqual(Object.keys(created.overrides), ["2026-05-01"]); // same schedule still hits May 1
  assert.deepStrictEqual(dropped, []);
});

test("splitRecurring drops (and reports) a carried override the new schedule never lands on", () => {
  const rec = {
    id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 50, category: "Fun",
    overrides: { "2026-05-01": { amount: 55 } },
  };
  // going yearly from April means the only later occurrence is 2027-04-01 — May 1 no longer exists
  const { prev, created, dropped } = splitRecurring(rec, "2026-04-01", { interval: "yearly", amount: 500, category: "Fun" }, "r2", "t1");
  assert.strictEqual(prev.overrides, undefined);
  assert.strictEqual(created.overrides, undefined);
  assert.deepStrictEqual(dropped, ["2026-05-01"]);
});

test("planChain walks both directions and orders a bill's plans oldest first", () => {
  const a = { id: "a", startDate: "2025-01-01", interval: "monthly", amount: 40 };
  const b = { id: "b", startDate: "2026-01-01", interval: "monthly", amount: 50, prevId: "a" };
  const c = { id: "c", startDate: "2027-01-01", interval: "yearly", amount: 500, prevId: "b" };
  const other = { id: "z", startDate: "2026-06-01", interval: "monthly", amount: 9 };
  const all = [c, other, a, b];
  assert.deepStrictEqual(planChain(all, b).map((r) => r.id), ["a", "b", "c"]);
  assert.deepStrictEqual(planChain(all, a).map((r) => r.id), ["a", "b", "c"]);
  assert.deepStrictEqual(planChain(all, other).map((r) => r.id), ["z"]);
});

test("planChain survives a prevId cycle instead of looping forever", () => {
  const a = { id: "a", startDate: "2025-01-01", prevId: "b" };
  const b = { id: "b", startDate: "2026-01-01", prevId: "a" };
  assert.strictEqual(planChain([a, b], a).length, 2);
});

test("sanitizeRecurring preserves prevId so a plan chain survives an import round-trip", () => {
  const out = sanitizeRecurring({ id: "r2", startDate: "2026-04-01", interval: "monthly", amount: 60, category: "Fun", prevId: "r1" });
  assert.strictEqual(out.prevId, "r1");
});

// ---------- sanitizeFinanceEntry / sanitizeRecurring ----------
test("sanitizeFinanceEntry coerces amount to a positive number and assigns an id if missing", () => {
  const out = sanitizeFinanceEntry({ date: "2026-01-01", amount: "-42.5", category: "Food" });
  assert.strictEqual(out.amount, 42.5);
  assert.ok(out.id);
  assert.strictEqual(out.updatedAt, "1970-01-01T00:00:00.000Z"); // no updatedAt/createdAt supplied
});

test("sanitizeFinanceEntry truncates the date to just the year for yearly entries", () => {
  const out = sanitizeFinanceEntry({ date: "2026-03-15", amount: 100, category: "Other", yearly: true });
  assert.strictEqual(out.date, "2026");
  assert.strictEqual(out.yearly, true);
});

test("sanitizeFinanceEntry drops amount to 0 for garbage input instead of NaN", () => {
  const out = sanitizeFinanceEntry({ date: "2026-01-01", amount: "not-a-number", category: "Other" });
  assert.strictEqual(out.amount, 0);
});

test("sanitizeRecurring falls back to monthly for an unrecognized interval", () => {
  const out = sanitizeRecurring({ startDate: "2026-01-01", interval: "daily", amount: 10, category: "Food" });
  assert.strictEqual(out.interval, "monthly");
});

test("sanitizeRecurring drops malformed override entries but keeps valid ones", () => {
  const out = sanitizeRecurring({
    startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food",
    overrides: {
      "2026-02-01": { amount: "15" },
      "2026-03-01": "not-an-object",
      "2026-04-01": {},
    },
  });
  assert.deepStrictEqual(Object.keys(out.overrides), ["2026-02-01"]);
  assert.strictEqual(out.overrides["2026-02-01"].amount, 15);
});

// ---------- financeKey / recurringKey / seedFinanceCategories ----------
test("financeKey is case-insensitive and numerically coerces the amount", () => {
  const a = financeKey({ date: "2026-01-01", amount: "12.0", category: "Food", note: "Lunch" });
  const b = financeKey({ date: "2026-01-01", amount: 12, category: "FOOD", note: "LUNCH" });
  assert.strictEqual(a, b);
});

test("recurringKey does not include endDate or overrides", () => {
  const a = recurringKey({ startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food" });
  const b = recurringKey({
    startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food",
    endDate: "2026-12-01", overrides: { "2026-02-01": { amount: 20 } },
  });
  assert.strictEqual(a, b);
});

test("seedFinanceCategories returns a non-empty, deterministic default list", () => {
  const cats = seedFinanceCategories();
  assert.ok(cats.length > 0);
  assert.ok(cats.every((c) => c.id && c.name && c.color));
});

// ---------- closestOccurrenceDate ----------
test("closestOccurrenceDate picks the occurrence nearest the target date", () => {
  const occs = [{ date: "2026-01-01" }, { date: "2026-01-15" }, { date: "2026-02-01" }];
  assert.strictEqual(closestOccurrenceDate(occs, "2026-01-20"), "2026-01-15");
});

test("closestOccurrenceDate breaks a tie in favor of the first occurrence encountered", () => {
  const occs = [{ date: "2026-01-10" }, { date: "2026-01-20" }];
  assert.strictEqual(closestOccurrenceDate(occs, "2026-01-15"), "2026-01-10"); // both 5 days away
});

test("closestOccurrenceDate returns null for an empty list", () => {
  assert.strictEqual(closestOccurrenceDate([], "2026-01-01"), null);
});

// ---------- parseMoneyCell ----------
test("parseMoneyCell strips currency symbols and thousands separators", () => {
  assert.strictEqual(parseMoneyCell("₪1,302.00"), 1302);
  assert.strictEqual(parseMoneyCell("$42.50"), 42.5);
});

test("parseMoneyCell returns 0 for empty/garbage input", () => {
  assert.strictEqual(parseMoneyCell(""), 0);
  assert.strictEqual(parseMoneyCell(null), 0);
  assert.strictEqual(parseMoneyCell("abc"), 0);
});

test("parseMoneyCell's naive character-class strip keeps every '.'/'-' character, not just the first", () => {
  // Documents current behavior rather than asserting it's ideal — the regex
  // is `[^0-9.\-]` (strip anything that ISN'T a digit/dot/minus), so a
  // multi-dot or trailing-minus input parses through parseFloat as-is,
  // which stops at the first invalid numeric token it hits.
  assert.strictEqual(parseMoneyCell("1.302.00-"), 1.302);
});

// ---------- monthSortAsc ----------
test("monthSortAsc sorts numerically ascending", () => {
  assert.ok(monthSortAsc(1, 2) < 0);
  assert.ok(monthSortAsc(3, 2) > 0);
});

test("monthSortAsc always sorts the pseudo-month 0 ('Yearly' bucket) last", () => {
  assert.ok(monthSortAsc(0, 12) > 0); // 0 sorts after even December
  assert.ok(monthSortAsc(1, 0) < 0); // any real month sorts before 0
});

// ---------- evalMathExpr ----------
test("evalMathExpr resolves plain subtraction like the user's 50-25", () => {
  assert.strictEqual(evalMathExpr("50-25"), 25);
});

test("evalMathExpr honors operator precedence and parentheses", () => {
  assert.strictEqual(evalMathExpr("2+3*4"), 14);
  assert.strictEqual(evalMathExpr("(2+3)*4"), 20);
  assert.strictEqual(evalMathExpr("12.5*3"), 37.5);
  assert.strictEqual(evalMathExpr("10/4"), 2.5);
});

test("evalMathExpr passes a plain number through unchanged", () => {
  assert.strictEqual(evalMathExpr("42"), 42);
  assert.strictEqual(evalMathExpr(" 12.50 "), 12.5);
});

test("evalMathExpr rounds the result to cents", () => {
  assert.strictEqual(evalMathExpr("10/3"), 3.33);
});

test("evalMathExpr ignores thousands-separator commas", () => {
  assert.strictEqual(evalMathExpr("1,000-1"), 999);
});

test("evalMathExpr returns null for incomplete or invalid input", () => {
  assert.strictEqual(evalMathExpr("50-"), null); // half-typed: don't resolve
  assert.strictEqual(evalMathExpr(""), null);
  assert.strictEqual(evalMathExpr("   "), null);
  assert.strictEqual(evalMathExpr("(1+2"), null); // unbalanced paren
  assert.strictEqual(evalMathExpr("abc"), null); // no code execution surface
  assert.strictEqual(evalMathExpr("2**"), null);
});

test("evalMathExpr guards against division by zero (non-finite)", () => {
  assert.strictEqual(evalMathExpr("1/0"), null);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
