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
});

const {
  recurringOccurrences, nextRecurringDate, addMonthsClamped, localDateStr,
  sanitizeFinanceEntry, sanitizeRecurring, financeKey, recurringKey, seedFinanceCategories,
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

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
