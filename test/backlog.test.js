// Zero-dependency tests for src/backlog.js's pure data logic — run with
// `node test/backlog.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern.
const assert = require("assert");
global.window = {};
require("../src/backlog.js");
const Backlog = global.window.LifeLogBacklog;

let idCounter = 0;
Backlog.init({
  uid: () => "test-id-" + (idCounter++),
  backfillUpdatedAt: (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z",
});

const { sanitizeBacklog, isUnreleased, upcomingAt } = Backlog;

// Dates relative to today, so these stay true whenever they're run.
function shift(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const TODAY = shift(0);

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

// ---------- sanitizeBacklog ----------
test("sanitizeBacklog assigns an id if missing and defaults category", () => {
  const out = sanitizeBacklog({ title: "Foo" });
  assert.ok(out.id);
  assert.strictEqual(out.category, "Other");
});

test("sanitizeBacklog drops a falsy priority instead of keeping it as 0", () => {
  const out = sanitizeBacklog({ title: "Foo", category: "Games", priority: 0 });
  assert.ok(!("priority" in out));
});

test("sanitizeBacklog keeps a truthy priority coerced to a number", () => {
  const out = sanitizeBacklog({ title: "Foo", category: "Games", priority: "3" });
  assert.strictEqual(out.priority, 3);
});

test("sanitizeBacklog drops dropped:false instead of keeping the field", () => {
  const out = sanitizeBacklog({ title: "Foo", category: "Games", dropped: false });
  assert.ok(!("dropped" in out));
});

test("sanitizeBacklog keeps dropped:true and clamps genres to 4", () => {
  const out = sanitizeBacklog({ title: "Foo", category: "Games", dropped: true, genres: ["A", "B", "C", "D", "E"] });
  assert.strictEqual(out.dropped, true);
  assert.deepStrictEqual(out.genres, ["A", "B", "C", "D"]);
});

// ---------- isUnreleased ----------
test("isUnreleased is false for a releaseDate in the past", () => {
  assert.strictEqual(isUnreleased({ releaseDate: "2000-01-01" }), false);
});

test("isUnreleased is true for a releaseDate far in the future", () => {
  assert.strictEqual(isUnreleased({ releaseDate: "2999-01-01" }), true);
});

test("isUnreleased is true for a releaseDate of exactly today", () => {
  const today = new Date();
  const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  assert.strictEqual(isUnreleased({ releaseDate: todayStr }), true);
});

test("isUnreleased falls back to releaseYear when releaseDate is malformed", () => {
  // Matches the YYYY-MM-DD shape but is not a real calendar date.
  const pastYear = new Date().getFullYear() - 1;
  assert.strictEqual(isUnreleased({ releaseDate: "9999-13-45", releaseYear: pastYear }), false);
});

test("isUnreleased year-only fallback treats the current year as still unreleased", () => {
  const thisYear = new Date().getFullYear();
  assert.strictEqual(isUnreleased({ releaseYear: thisYear }), true);
  assert.strictEqual(isUnreleased({ releaseYear: thisYear - 1 }), false);
});

test("isUnreleased is false with no release info at all", () => {
  assert.strictEqual(isUnreleased({}), false);
});

// ---------- isUnreleased: precision + status ----------
test("isUnreleased trusts an explicit status over the date", () => {
  // The case a year-only date can't decide on its own: out since January,
  // but the year hasn't ended.
  const thisYear = new Date().getFullYear();
  assert.strictEqual(isUnreleased({ releaseYear: thisYear, releaseStatus: "released" }), false);
  assert.strictEqual(isUnreleased({ releaseDate: "1999-01-01", releasePrecision: "day", releaseStatus: "upcoming" }), true);
});

test("isUnreleased treats a month as unreleased until the month is over", () => {
  const soon = shift(20), gone = shift(-400);
  assert.strictEqual(isUnreleased({ releaseDate: soon.slice(0, 7), releasePrecision: "month" }), true);
  assert.strictEqual(isUnreleased({ releaseDate: gone.slice(0, 7), releasePrecision: "month" }), false);
});

test("isUnreleased runs a quarter three months from its stored first month", () => {
  // Q4 of last year ended in December, so it has passed; Q1 of next year hasn't.
  const year = new Date().getFullYear();
  assert.strictEqual(isUnreleased({ releaseDate: (year - 1) + "-10", releasePrecision: "quarter" }), false);
  assert.strictEqual(isUnreleased({ releaseDate: (year + 1) + "-01", releasePrecision: "quarter" }), true);
});

test("isUnreleased is true for tba, which is announced-but-undated", () => {
  assert.strictEqual(isUnreleased({ releasePrecision: "tba" }), true);
  assert.strictEqual(isUnreleased({ releasePrecision: "tba", releaseStatus: "released" }), false);
});

// ---------- upcomingAt ----------
test("upcomingAt returns the release day for a dated future item", () => {
  const day = shift(30);
  assert.strictEqual(upcomingAt({ releaseDate: day, releasePrecision: "day" }), day);
});

test("upcomingAt clamps a window already underway to today", () => {
  // A month-precision release for the current month started before today.
  assert.strictEqual(upcomingAt({ releaseDate: TODAY.slice(0, 7), releasePrecision: "month" }), TODAY);
});

test("upcomingAt prefers a scheduled next episode over the original release", () => {
  const next = shift(3);
  assert.strictEqual(
    upcomingAt({ releaseDate: "2013-04-06", releasePrecision: "day", nextAt: next }),
    next
  );
});

test("upcomingAt ignores a next episode that has already aired", () => {
  const day = shift(10);
  assert.strictEqual(upcomingAt({ releaseDate: day, releasePrecision: "day", nextAt: shift(-5) }), day);
});

test("upcomingAt returns nothing for year-only, tba, or past items", () => {
  assert.strictEqual(upcomingAt({ releaseDate: "2099", releasePrecision: "year" }), "");
  assert.strictEqual(upcomingAt({ releasePrecision: "tba" }), "");
  assert.strictEqual(upcomingAt({ releaseDate: shift(-10), releasePrecision: "day" }), "");
  assert.strictEqual(upcomingAt({}), "");
});

// ---------- sanitizeBacklog: release fields ----------
test("sanitizeBacklog carries the release fields through untouched", () => {
  const out = sanitizeBacklog({
    title: "Foo", category: "Games", releaseDate: "2026-01", releasePrecision: "quarter",
    releaseStatus: "upcoming", nextAt: "2026-02-01", nextLabel: "Episode 3",
  });
  assert.strictEqual(out.releasePrecision, "quarter");
  assert.strictEqual(out.releaseStatus, "upcoming");
  assert.strictEqual(out.nextLabel, "Episode 3");
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
