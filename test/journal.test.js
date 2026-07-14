// Zero-dependency tests for src/journal.js's pure data logic — run with
// `node test/journal.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern.
const assert = require("assert");
global.window = {};
require("../src/journal.js");
const Journal = global.window.LifeLogJournal;

let idCounter = 0;
Journal.init({
  uid: () => "test-id-" + (idCounter++),
  backfillUpdatedAt: (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z",
});

const { sanitizeEntry, stripMediaSearchSuffix } = Journal;

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

test("stripMediaSearchSuffix leaves a dangling colon when it's attached to the title, not the marker", () => {
  // The separator group only matches a `-`/`:` that comes AFTER whitespace
  // (e.g. "Foo - Book 3"), not one already glued onto the base title before
  // the space (e.g. "Foo: Book 3") — so this case strips the marker word but
  // leaves the colon behind. Documented as current behavior, not asserted as
  // correct — a title written with a trailing colon is a plausible real
  // input this doesn't fully clean up.
  assert.strictEqual(stripMediaSearchSuffix("Foo: Book 3"), "Foo:");
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

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
