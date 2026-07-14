// Zero-dependency tests for src/journal.js's pure data logic — run with
// `node test/journal.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern.
const assert = require("assert");
global.window = {};
require("../src/journal.js");
const Journal = global.window.LifeLogJournal;

let idCounter = 0;
// Mutated per-test by titleSuggestions/backlogSuggestions tests below —
// both read state.data.entries/backlog fresh on every call, so one shared
// object works fine across tests without re-calling init().
const state = { data: { entries: [], backlog: [] } };
Journal.init({
  uid: () => "test-id-" + (idCounter++),
  backfillUpdatedAt: (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z",
  state,
});

const { sanitizeEntry, stripMediaSearchSuffix, heatColor, titleSuggestions, backlogSuggestions } = Journal;

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

// ---------- sanitizeEntry ----------
test("sanitizeEntry coerces year/month to numbers and assigns an id if missing", () => {
  const out = sanitizeEntry({ title: "Foo", category: "Games", year: "2026", month: "3" });
  assert.strictEqual(out.year, 2026);
  assert.strictEqual(out.month, 3);
  assert.ok(out.id);
});

test("sanitizeEntry synthesizes date only when not already present", () => {
  const withoutDate = sanitizeEntry({ title: "Foo", category: "Games", year: 2026, month: 3 });
  assert.strictEqual(withoutDate.date, "2026-03");
  const withDate = sanitizeEntry({ title: "Foo", category: "Games", year: 2026, month: 3, date: "2026-03-15" });
  assert.strictEqual(withDate.date, "2026-03-15");
});

test("sanitizeEntry clamps genres to 4 and stringifies each", () => {
  const out = sanitizeEntry({ title: "Foo", category: "Games", year: 2026, month: 1, genres: ["A", "B", "C", "D", "E"] });
  assert.deepStrictEqual(out.genres, ["A", "B", "C", "D"]);
});

test("sanitizeEntry drops falsy optional fields instead of keeping them as 0/empty", () => {
  const out = sanitizeEntry({ title: "Foo", category: "Games", year: 2026, month: 1, rating: 0, genres: [] });
  assert.ok(!("rating" in out));
  assert.ok(!("genres" in out));
});

test("sanitizeEntry keeps a truthy rating and defaults a missing category", () => {
  const out = sanitizeEntry({ title: "Foo", year: 2026, month: 1, rating: 4 });
  assert.strictEqual(out.rating, 4);
  assert.strictEqual(out.category, "Other");
});

// ---------- stripMediaSearchSuffix ----------
test("stripMediaSearchSuffix strips a trailing 'Season N' marker", () => {
  assert.strictEqual(stripMediaSearchSuffix("Foo - Season 2"), "Foo");
});

test("stripMediaSearchSuffix strips a trailing 'SN' marker", () => {
  assert.strictEqual(stripMediaSearchSuffix("Foo S2"), "Foo");
});

test("stripMediaSearchSuffix strips a trailing 'Book N'/'BN' marker", () => {
  assert.strictEqual(stripMediaSearchSuffix("Foo - Book 3"), "Foo");
  assert.strictEqual(stripMediaSearchSuffix("Foo B1"), "Foo");
});

test("stripMediaSearchSuffix strips a separator glued directly onto the title, not just a spaced one", () => {
  // Regression test for a dangling colon this used to leave behind
  // ("Foo: Book 3" -> "Foo:") when the separator was attached to the base
  // title before the space rather than surrounded by whitespace.
  assert.strictEqual(stripMediaSearchSuffix("Foo: Book 3"), "Foo");
});

test("stripMediaSearchSuffix is case-insensitive and tolerates extra whitespace", () => {
  assert.strictEqual(stripMediaSearchSuffix("Foo   season   2"), "Foo");
});

test("stripMediaSearchSuffix leaves a non-matching title untouched", () => {
  assert.strictEqual(stripMediaSearchSuffix("Foo Season"), "Foo Season"); // no trailing digit
  assert.strictEqual(stripMediaSearchSuffix("Foobar"), "Foobar");
});

test("stripMediaSearchSuffix falls back to the original title if stripping would empty it", () => {
  assert.strictEqual(stripMediaSearchSuffix("S1"), "S1");
  assert.strictEqual(stripMediaSearchSuffix("Season 1"), "Season 1");
});

// ---------- heatColor ----------
test("heatColor forces full intensity when max<=1 regardless of count", () => {
  const zeroMax = heatColor(0, 0);
  const oneMax = heatColor(5, 1);
  assert.strictEqual(zeroMax, oneMax); // both hit the max<=1 branch -> t=1
});

test("heatColor never drops below the 0.2-intensity floor even at count=0", () => {
  const floor = heatColor(0, 10); // t = max(0.2, 0/10) = 0.2
  const full = heatColor(10, 10); // t = 1
  assert.notStrictEqual(floor, full);
  assert.ok(floor.startsWith("rgb("));
});

// ---------- titleSuggestions ----------
test("titleSuggestions matches case-insensitively and excludes a given id", () => {
  state.data.entries = [
    { id: "1", title: "The Witcher 3", category: "Games", year: 2020, month: 1 },
    { id: "2", title: "other game", category: "Games", year: 2020, month: 1 },
  ];
  const results = titleSuggestions("witcher", null);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].title, "The Witcher 3");
  assert.deepStrictEqual(titleSuggestions("witcher", "1"), []);
});

test("titleSuggestions groups repeat titles and keeps the most recent occurrence's fields", () => {
  state.data.entries = [
    { id: "1", title: "Foo", category: "Games", year: 2020, month: 1 },
    { id: "2", title: "foo", category: "Movies", year: 2022, month: 6 }, // same title, later, different category
  ];
  const results = titleSuggestions("foo", null);
  assert.strictEqual(results.length, 1); // grouped into one suggestion
  assert.strictEqual(results[0].count, 2);
  assert.strictEqual(results[0].category, "Movies"); // the more recent entry's category wins
});

test("titleSuggestions sorts by match position first, then by count", () => {
  state.data.entries = [
    { id: "1", title: "ZZZ Foo", category: "Games", year: 2020, month: 1 }, // "foo" at index 4
    { id: "2", title: "Foo Bar", category: "Games", year: 2020, month: 1 }, // "foo" at index 0
  ];
  const results = titleSuggestions("foo", null);
  assert.strictEqual(results[0].title, "Foo Bar"); // earlier match position sorts first
});

// ---------- backlogSuggestions ----------
test("backlogSuggestions matches case-insensitively and excludes a given id, with no grouping", () => {
  state.data.backlog = [
    { id: "1", title: "Foo", category: "Games" },
    { id: "2", title: "foo", category: "Movies" }, // same title as #1, but backlogSuggestions doesn't dedupe
  ];
  const results = backlogSuggestions("foo", null);
  assert.strictEqual(results.length, 2); // unlike titleSuggestions, no grouping/merge
  assert.deepStrictEqual(backlogSuggestions("foo", "1").map((b) => b.id), ["2"]);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
