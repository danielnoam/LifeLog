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

const { sanitizeBacklog, isUnreleased } = Backlog;

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

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
