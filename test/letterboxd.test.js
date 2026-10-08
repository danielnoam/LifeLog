// Zero-dependency tests for src/letterboxd.js's reading of a Letterboxd
// export — `node test/letterboxd.test.js`. The CSV shapes are the ones the
// zip from Settings → Import & Export holds.
const assert = require("assert");
global.window = {};
require("../src/io.js");
const { parseCsv } = global.window.LifeLogIO;
const L = require("../src/letterboxd.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}
const csv = (name, text) => ({ name, rows: parseCsv(text.trim() + "\n") });

const DIARY = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2026-02-15,Heat,1995,https://boxd.it/aaa,4.5,,,2026-02-14
2026-03-02,Heat,1995,https://boxd.it/bbb,5,Yes,,2026-03-01
2026-03-09,"Hundreds of Beavers",2022,https://boxd.it/ccc,,,,2026-03-08`;
const WATCHED = `Date,Name,Year,Letterboxd URI
2026-02-15,Heat,1995,https://boxd.it/aaa
2025-12-20,Thief,1981,https://boxd.it/ddd`;
const RATINGS = `Date,Name,Year,Letterboxd URI,Rating
2025-12-20,Thief,1981,https://boxd.it/ddd,3.5`;
const WATCHLIST = `Date,Name,Year,Letterboxd URI
2026-01-05,Collateral,2004,https://boxd.it/eee
2026-01-06,Ferrari,2023,https://boxd.it/fff`;

test("diary lines are entries on the watched day, a rewatch is another entry", () => {
  const got = L.parseExport([csv("diary.csv", DIARY)], "Films");
  assert.strictEqual(got.entries.length, 3);
  const [a, b, c] = got.entries;
  assert.deepStrictEqual([a.title, a.year, a.month, a.date, a.rating, a.category], ["Heat", 2026, 2, "2026-02-14", 5, "Films"]);
  assert.strictEqual(b.rating, 5);
  assert.ok(/Rewatch/.test(b.notes), "a rewatch says so");
  assert.strictEqual(c.rating, undefined, "no rating stays no rating");
  assert.strictEqual(c.title, "Hundreds of Beavers");
});

test("watched films with no diary line are entries on the day marked, rated from ratings.csv", () => {
  const got = L.parseExport([csv("diary.csv", DIARY), csv("watched.csv", WATCHED), csv("ratings.csv", RATINGS)], "Films");
  const thief = got.entries.find((e) => e.title === "Thief");
  assert.ok(thief, "Thief came from watched.csv");
  assert.deepStrictEqual([thief.year, thief.month, thief.rating], [2025, 12, 4]);
  assert.strictEqual(got.entries.filter((e) => e.title === "Heat").length, 2, "the diary's Heat isn't doubled by watched.csv");
});

test("the watchlist is backlog, with the year kept", () => {
  const got = L.parseExport([csv("watchlist.csv", WATCHLIST)], "Films");
  assert.strictEqual(got.entries.length, 0);
  assert.deepStrictEqual(got.backlog.map((b) => [b.title, b.releaseYear, b.category]), [["Collateral", 2004, "Films"], ["Ferrari", 2023, "Films"]]);
  assert.strictEqual(got.backlog[0].notes, undefined, "no link in the notes, so a film already there stays a plain duplicate");
});

test("a file is known by its columns when its name doesn't say", () => {
  assert.strictEqual(L.kindOf("export/diary.csv", []), "diary");
  assert.strictEqual(L.kindOf("whatever.csv", ["Date", "Name", "Year", "Letterboxd URI", "Rating", "Rewatch", "Tags", "Watched Date"]), "diary");
  assert.strictEqual(L.kindOf("whatever.csv", ["Date", "Name", "Year", "Letterboxd URI", "Rating"]), "ratings");
  assert.strictEqual(L.kindOf("whatever.csv", ["Date", "Name", "Year", "Letterboxd URI"]), null, "watched and watchlist look alike");
  assert.strictEqual(L.kindOf("reviews.csv", ["Date", "Name"]), null);
});

test("half stars round up to the app's five", () => {
  assert.deepStrictEqual(["0.5", "1", "2.5", "4.5", "5", "", "0"].map(L.starsOf), [1, 1, 3, 5, 5, 0, 0]);
});

test("a zip with none of the four files says so", () => {
  assert.throws(() => L.parseExport([csv("reviews.csv", "Date,Name\n2026-01-01,x")], "Films"), /Letterboxd files/);
});

console.log(`\n${passed} test(s) passed.`);
