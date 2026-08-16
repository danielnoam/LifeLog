// Zero-dependency tests for src/media.js's pure data logic — run with
// `node test/media.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern. media.js is fully
// self-contained (no state/ctx/DOM references), so — unlike the other
// modules — nothing needs to be init()'d first, same as merge.js.
const assert = require("assert");
global.window = {};
require("../src/media.js");
const Media = global.window.LifeLogMedia;

const {
  steamCoverUrl, normGenres, stripHtml,
  parseSteamReleaseDate, releaseFromString, releaseFromParts, releaseFromSgdb, mergeRelease,
} = Media;

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

// ---------- releaseFromString / releaseFromParts ----------
test("releaseFromString reads precision off the date's shape", () => {
  assert.deepStrictEqual(releaseFromString("2026-03-15"), { releaseDate: "2026-03-15", releasePrecision: "day" });
  assert.deepStrictEqual(releaseFromString("2026-03"), { releaseDate: "2026-03", releasePrecision: "month" });
  assert.deepStrictEqual(releaseFromString("2026"), { releaseDate: "2026", releasePrecision: "year" });
});

test("releaseFromString trims a full ISO datetime down to the day", () => {
  assert.deepStrictEqual(
    releaseFromString("2013-04-06T00:00:00+00:00"),
    { releaseDate: "2013-04-06", releasePrecision: "day" }
  );
});

test("releaseFromString reports anything undateable as tba", () => {
  assert.deepStrictEqual(releaseFromString(""), { releaseDate: "", releasePrecision: "tba" });
  assert.deepStrictEqual(releaseFromString(null), { releaseDate: "", releasePrecision: "tba" });
  assert.deepStrictEqual(releaseFromString("soon"), { releaseDate: "", releasePrecision: "tba" });
});

test("releaseFromParts takes precision from which parts are present", () => {
  assert.deepStrictEqual(releaseFromParts(2026, 3, 5), { releaseDate: "2026-03-05", releasePrecision: "day" });
  assert.deepStrictEqual(releaseFromParts(2026, 3, null), { releaseDate: "2026-03", releasePrecision: "month" });
  assert.deepStrictEqual(releaseFromParts(2026, null, null), { releaseDate: "2026", releasePrecision: "year" });
  assert.deepStrictEqual(releaseFromParts(null, null, null), { releaseDate: "", releasePrecision: "tba" });
});

// ---------- releaseFromSgdb ----------
// SteamGridDB dates a game with one `release_date` field. It's documented as
// unix seconds, but the parser also has to survive a milliseconds value and
// the odd plain string without turning either into a 1970 release.
test("releaseFromSgdb reads a unix-seconds timestamp as a day", () => {
  // 2022-08-11 in local time, whatever zone the test runs in
  const sec = Math.floor(new Date(2022, 7, 11, 12, 0, 0).getTime() / 1000);
  assert.deepStrictEqual(releaseFromSgdb(sec), { releaseDate: "2022-08-11", releasePrecision: "day" });
});

test("releaseFromSgdb treats an out-of-range value as milliseconds", () => {
  const ms = new Date(2022, 7, 11, 12, 0, 0).getTime();
  assert.deepStrictEqual(releaseFromSgdb(ms), { releaseDate: "2022-08-11", releasePrecision: "day" });
});

test("releaseFromSgdb falls back to string parsing, and to tba for the rest", () => {
  assert.deepStrictEqual(releaseFromSgdb("2026-03"), { releaseDate: "2026-03", releasePrecision: "month" });
  const tba = { releaseDate: "", releasePrecision: "tba" };
  assert.deepStrictEqual(releaseFromSgdb(null), tba);
  assert.deepStrictEqual(releaseFromSgdb(undefined), tba);
  assert.deepStrictEqual(releaseFromSgdb(0), tba);
  assert.deepStrictEqual(releaseFromSgdb(-1), tba);
  assert.deepStrictEqual(releaseFromSgdb("soon"), tba);
});

// ---------- parseSteamReleaseDate ----------
test("parseSteamReleaseDate handles both day orderings Steam ships", () => {
  const expected = { releaseDate: "2026-03-12", releasePrecision: "day" };
  assert.deepStrictEqual(parseSteamReleaseDate("12 Mar, 2026"), expected);
  assert.deepStrictEqual(parseSteamReleaseDate("Mar 12, 2026"), expected);
});

test("parseSteamReleaseDate stores a quarter as its first month", () => {
  assert.deepStrictEqual(parseSteamReleaseDate("Q1 2026"), { releaseDate: "2026-01", releasePrecision: "quarter" });
  assert.deepStrictEqual(parseSteamReleaseDate("Q4 2027"), { releaseDate: "2027-10", releasePrecision: "quarter" });
});

test("parseSteamReleaseDate keeps a month or year on its own", () => {
  assert.deepStrictEqual(parseSteamReleaseDate("March 2026"), { releaseDate: "2026-03", releasePrecision: "month" });
  assert.deepStrictEqual(parseSteamReleaseDate("2026"), { releaseDate: "2026", releasePrecision: "year" });
});

test("parseSteamReleaseDate refuses to guess at a placeholder", () => {
  const tba = { releaseDate: "", releasePrecision: "tba" };
  assert.deepStrictEqual(parseSteamReleaseDate("Coming soon"), tba);
  assert.deepStrictEqual(parseSteamReleaseDate("To be announced"), tba);
  assert.deepStrictEqual(parseSteamReleaseDate("When it's ready"), tba);
  assert.deepStrictEqual(parseSteamReleaseDate(""), tba);
});

// ---------- mergeRelease ----------
test("mergeRelease keeps the most precise date regardless of argument order", () => {
  const vague = { releaseDate: "2026", releasePrecision: "year" };
  const exact = { releaseDate: "2026-03-12", releasePrecision: "day" };
  assert.strictEqual(mergeRelease(vague, exact).releaseDate, "2026-03-12");
  assert.strictEqual(mergeRelease(exact, vague).releaseDate, "2026-03-12");
});

test("mergeRelease lets the last source win an equal-precision tie", () => {
  const a = { releaseDate: "2026-03-12", releasePrecision: "day" };
  const b = { releaseDate: "2026-04-01", releasePrecision: "day" };
  assert.strictEqual(mergeRelease(a, b).releaseDate, "2026-04-01");
});

test("mergeRelease takes status and next-episode info from whoever has it", () => {
  const out = mergeRelease(
    { releaseDate: "2026-03-12", releasePrecision: "day" },
    { releaseStatus: "upcoming", nextAt: "2026-03-19", nextLabel: "Episode 3" }
  );
  assert.strictEqual(out.releaseDate, "2026-03-12");
  assert.strictEqual(out.releaseStatus, "upcoming");
  assert.strictEqual(out.nextAt, "2026-03-19");
  assert.strictEqual(out.nextLabel, "Episode 3");
});

test("mergeRelease drops the date when the winning source has none", () => {
  const out = mergeRelease({ releaseDate: "2026", releasePrecision: "year" }, { releaseDate: "", releasePrecision: "tba" });
  // tba ranks below year, so the year survives.
  assert.strictEqual(out.releaseDate, "2026");
  const out2 = mergeRelease({ releaseDate: "", releasePrecision: "tba" }, { releaseDate: "2026", releasePrecision: "year" });
  assert.strictEqual(out2.releaseDate, "2026");
});

test("mergeRelease ignores null sources and emits no empty keys", () => {
  assert.deepStrictEqual(mergeRelease(null, undefined), {});
  assert.deepStrictEqual(mergeRelease(null, { releaseDate: "", releasePrecision: "tba" }), { releasePrecision: "tba" });
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
