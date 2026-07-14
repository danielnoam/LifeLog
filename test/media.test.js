// Zero-dependency tests for src/media.js's pure data logic — run with
// `node test/media.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern. media.js is fully
// self-contained (no state/ctx/DOM references), so — unlike the other
// modules — nothing needs to be init()'d first, same as merge.js.
const assert = require("assert");
global.window = {};
require("../src/media.js");
const Media = global.window.LifeLogMedia;

const { steamCoverUrl, normGenres, stripHtml } = Media;

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

// ---------- steamCoverUrl ----------
test("steamCoverUrl builds the expected header-image URL", () => {
  assert.strictEqual(
    steamCoverUrl(12345),
    "https://cdn.akamai.steamstatic.com/steam/apps/12345/header.jpg"
  );
});

test("steamCoverUrl encodes an unusual app id", () => {
  assert.strictEqual(
    steamCoverUrl("12/45"),
    "https://cdn.akamai.steamstatic.com/steam/apps/12%2F45/header.jpg"
  );
});

// ---------- normGenres ----------
test("normGenres dedupes case-insensitively but keeps the first-seen casing", () => {
  assert.deepStrictEqual(normGenres(["Action", "action", "ACTION"]), ["Action"]);
});

test("normGenres trims whitespace and drops empty entries", () => {
  assert.deepStrictEqual(normGenres(["  RPG  ", "", "  ", "Horror"]), ["RPG", "Horror"]);
});

test("normGenres caps the result at 4", () => {
  const result = normGenres(["A", "B", "C", "D", "E", "F"]);
  assert.deepStrictEqual(result, ["A", "B", "C", "D"]);
});

test("normGenres returns [] for no input", () => {
  assert.deepStrictEqual(normGenres(undefined), []);
  assert.deepStrictEqual(normGenres([]), []);
});

// ---------- stripHtml ----------
test("stripHtml removes tags but keeps the text content", () => {
  assert.strictEqual(stripHtml("<p>Hello <b>world</b></p>"), "Hello world");
});

test("stripHtml handles null/undefined input without throwing", () => {
  assert.strictEqual(stripHtml(null), "");
  assert.strictEqual(stripHtml(undefined), "");
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
