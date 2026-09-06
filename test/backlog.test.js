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
  // Stubbed like the two above — the real one lives in app.js, which needs a
  // DOM. Same contract: keep the ticked keys, drop the key entirely when
  // nothing is ticked.
  // Same contract as the real one in app.js: copy anything the sanitizer
  // didn't name, so a build older than the data can't silently drop it.
  keepUnknown: (src, out, known) => {
    for (const key of Object.keys(src || {})) if (!known.has(key)) out[key] = src[key];
    return out;
  },
  sanitizeOverrides: (overrides, keys) => {
    const out = {};
    for (const key of keys) if (overrides && overrides[key]) out[key] = true;
    return Object.keys(out).length ? out : null;
  },
});

const { sanitizeBacklog, isUnreleased, releaseStateOf, upcomingAt, parseReleaseInput,
  formatReleaseInput, bandOf, compareBacklog, peekPickBag, spendPick } = Backlog;

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

test("sanitizeBacklog stores earlyAccess as a boolean, not the string \"true\"", () => {
  // mergeRelease tells a stated answer from silence with typeof === "boolean",
  // so a String()'d flag would make a re-check clear a game still in EA.
  assert.strictEqual(sanitizeBacklog({ title: "Foo", earlyAccess: true }).earlyAccess, true);
  // Including one already saved as a string by an older build.
  assert.strictEqual(sanitizeBacklog({ title: "Foo", earlyAccess: "true" }).earlyAccess, true);
  assert.strictEqual("earlyAccess" in sanitizeBacklog({ title: "Foo" }), false);
  assert.strictEqual("earlyAccess" in sanitizeBacklog({ title: "Foo", earlyAccess: false }), false);
});

test("sanitizeBacklog carries through a field it doesn't know about", () => {
  // The whole point: a build older than the data must not delete a field
  // newer than itself. The merge decides by content, so a device that
  // dropped it would win and the field would be gone everywhere.
  const out = sanitizeBacklog({ title: "Foo", somethingShippedLater: { a: 1 }, alsoNew: "x" });
  assert.deepStrictEqual(out.somethingShippedLater, { a: 1 });
  assert.strictEqual(out.alsoNew, "x");
});

test("carrying unknown fields through never resurrects a known falsy one", () => {
  // A known field the sanitizer deliberately drops (a false flag, a 0
  // priority) must stay dropped rather than come back via the passthrough.
  const out = sanitizeBacklog({ title: "Foo", earlyAccess: false, priority: 0, dropped: false });
  assert.strictEqual("earlyAccess" in out, false);
  assert.strictEqual("priority" in out, false);
  assert.strictEqual("dropped" in out, false);
});

test("sanitizeBacklog keeps bought with or without a star", () => {
  const starred = sanitizeBacklog({ title: "Foo", category: "Games", priority: 1, bought: true });
  assert.strictEqual(starred.bought, true);
  const unstarred = sanitizeBacklog({ title: "Foo", category: "Games", bought: true });
  assert.strictEqual(unstarred.bought, true);
});

test("sanitizeBacklog drops bought:false instead of keeping the field", () => {
  const out = sanitizeBacklog({ title: "Foo", category: "Games", priority: 1, bought: false });
  assert.ok(!("bought" in out));
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

// ---------- manual release overrides ----------

test("parseReleaseInput reads each precision back out of what you typed", () => {
  assert.deepStrictEqual(parseReleaseInput("2027-05-14"), { releaseDate: "2027-05-14", releasePrecision: "day" });
  assert.deepStrictEqual(parseReleaseInput("2027-05"), { releaseDate: "2027-05", releasePrecision: "month" });
  assert.deepStrictEqual(parseReleaseInput("2027"), { releaseDate: "2027", releasePrecision: "year" });
});

test("parseReleaseInput stores a quarter as its first month", () => {
  assert.deepStrictEqual(parseReleaseInput("2027-Q1"), { releaseDate: "2027-01", releasePrecision: "quarter" });
  assert.deepStrictEqual(parseReleaseInput("2027-Q4"), { releaseDate: "2027-10", releasePrecision: "quarter" });
  assert.deepStrictEqual(parseReleaseInput("2027q2"), { releaseDate: "2027-04", releasePrecision: "quarter" });
});

test("parseReleaseInput treats blank and nonsense alike as TBA", () => {
  for (const input of ["", "   ", "soon", "14/05/2027", "27-05"]) {
    assert.deepStrictEqual(parseReleaseInput(input), { releaseDate: "", releasePrecision: "tba" }, input);
  }
});

test("a typed date survives a round trip through the form", () => {
  for (const input of ["2027-05-14", "2027-05", "2027", "2027-Q3"]) {
    assert.strictEqual(formatReleaseInput(parseReleaseInput(input)), input, input);
  }
});

test("formatReleaseInput falls back to a bare releaseYear, and shows TBA as blank", () => {
  assert.strictEqual(formatReleaseInput({ releaseYear: 2027 }), "2027");
  assert.strictEqual(formatReleaseInput({ releaseDate: "2027-05", releasePrecision: "tba" }), "");
});

test("a pinned field survives sanitize; an item with none stays clean", () => {
  const pinned = sanitizeBacklog({ title: "Hollow Knight: Silksong", overrides: { release: true, cover: true } });
  assert.deepStrictEqual(pinned.overrides, { release: true, cover: true });
  assert.strictEqual("overrides" in sanitizeBacklog({ title: "Nothing pinned" }), false);
  assert.strictEqual("overrides" in sanitizeBacklog({ title: "Empty", overrides: {} }), false);
});

test("sanitize drops override keys this item has no field for", () => {
  const out = sanitizeBacklog({ title: "Made up", overrides: { release: true, nonsense: true } });
  assert.deepStrictEqual(out.overrides, { release: true });
});

// ---------- the one release-state classifier ----------
test("releaseStateOf splits out, in Early Access and can't-start-yet", () => {
  assert.strictEqual(releaseStateOf({ releaseDate: "2019-03-04", releasePrecision: "day" }), "ready");
  assert.strictEqual(releaseStateOf({ releaseDate: "2019-03-04", releasePrecision: "day", earlyAccess: true }), "early-access");
  assert.strictEqual(releaseStateOf({ releaseDate: shift(400).slice(0, 7), releasePrecision: "month" }), "waiting");
  // Announced, nothing dated: still waiting.
  assert.strictEqual(releaseStateOf({ releasePrecision: "tba" }), "waiting");
});

test("an announced show with only a first-episode date is waiting, everywhere", () => {
  // It has no release window of its own, so a plain date test reads it as
  // released. The band, the count and the pick each used to answer this
  // differently — the row sat in the ready band while the header counted it
  // as unreleased and the pick refused to draw it.
  const show = { title: "Announced", nextAt: shift(20) };
  assert.strictEqual(isUnreleased(show), false, "precondition: no date of its own to judge");
  assert.strictEqual(releaseStateOf(show), "waiting");
  assert.strictEqual(bandOf(show), 3);
});

test("a source saying released outright beats a stale next-episode date", () => {
  assert.strictEqual(releaseStateOf({ releaseStatus: "released", nextAt: shift(20) }), "ready");
});

test("releaseStateOf ignores the star and the dropped flag", () => {
  // Those are facts about you, not about whether the thing is out; bandOf
  // layers them on top.
  const ea = { releaseDate: "2019-03-04", releasePrecision: "day", earlyAccess: true };
  assert.strictEqual(releaseStateOf({ ...ea, priority: 1 }), "early-access");
  assert.strictEqual(releaseStateOf({ ...ea, dropped: true }), "early-access");
});

// ---------- which block of a category a row lands in ----------

test("a starred item sits in the starred block whether or not it's out yet", () => {
  const unreleased = { priority: 1, releaseDate: shift(400).slice(0, 7), releasePrecision: "month" };
  assert.strictEqual(isUnreleased(unreleased), true, "precondition: this one hasn't come out");
  assert.strictEqual(bandOf(unreleased), 0);
  assert.strictEqual(bandOf({ priority: 1, releaseDate: "2019-03-04", releasePrecision: "day" }), 0);
});

test("unstarred items split into out, in Early Access and still-to-come, in that order", () => {
  const out = { releaseDate: "2019-03-04", releasePrecision: "day" };
  assert.strictEqual(bandOf(out), 1);
  assert.strictEqual(bandOf({ ...out, earlyAccess: true }), 2);
  assert.strictEqual(bandOf({ releaseDate: shift(400).slice(0, 7), releasePrecision: "month" }), 3);
});

test("an Early Access game that hasn't come out at all still sorts as unreleased", () => {
  // Steam says both for a game with an announced EA date still ahead of it,
  // and the later block is the honest one: you can't start it today.
  assert.strictEqual(bandOf({ releaseDate: shift(400).slice(0, 7), releasePrecision: "month", earlyAccess: true }), 3);
});

test("a starred Early Access game stays in the starred block", () => {
  assert.strictEqual(bandOf({ priority: 1, earlyAccess: true, releaseDate: "2019-03-04", releasePrecision: "day" }), 0);
});

test("dropped stays last, star or no star", () => {
  assert.strictEqual(bandOf({ dropped: true }), 4);
  assert.strictEqual(bandOf({ dropped: true, priority: 1 }), 4);
  assert.strictEqual(bandOf({ dropped: true, earlyAccess: true }), 4);
});

// ---------- render order within a category ----------
const order = (items) => items.slice().sort(compareBacklog).map((b) => b.title);

test("already-bought favorites sort to the top of the starred block", () => {
  assert.deepStrictEqual(order([
    { title: "Astro", priority: 1 },
    { title: "Bought B", priority: 1, bought: true },
    { title: "Bought A", priority: 1, bought: true },
    { title: "Zelda", priority: 1 },
  ]), ["Bought A", "Bought B", "Astro", "Zelda"]);
});

test("bought never lifts an item out of its band", () => {
  assert.deepStrictEqual(order([
    { title: "Dropped", priority: 1, bought: true, dropped: true },
    { title: "Plain" },
    { title: "Bought", priority: 1, bought: true },
  ]), ["Bought", "Plain", "Dropped"]);
});

test("bought reorders nothing outside the starred block", () => {
  // It can be set on anything, but only the starred band reads it: here the
  // unstarred rows stay in title order rather than the bought ones jumping
  // the queue, and the same holds among the still-to-come and the dropped.
  assert.deepStrictEqual(order([
    { title: "Zulu" },
    { title: "Alpha", bought: true },
    { title: "Mike", bought: true },
    { title: "Bravo" },
  ]), ["Alpha", "Bravo", "Mike", "Zulu"]);
  assert.deepStrictEqual(order([
    { title: "Yankee", dropped: true },
    { title: "Xray", dropped: true, bought: true },
  ]), ["Xray", "Yankee"]);
});

test("Early Access rows land between the finished ones and the unannounced", () => {
  assert.deepStrictEqual(order([
    { title: "Unreleased", releaseDate: shift(400).slice(0, 7), releasePrecision: "month" },
    { title: "Dropped", dropped: true },
    { title: "In EA", releaseDate: "2021-02-02", releasePrecision: "day", earlyAccess: true },
    { title: "Finished", releaseDate: "2019-03-04", releasePrecision: "day" },
    { title: "Starred EA", priority: 1, releaseDate: "2021-02-02", releasePrecision: "day", earlyAccess: true },
  ]), ["Starred EA", "Finished", "In EA", "Unreleased", "Dropped"]);
});

test("titles still break the tie once band and bought agree", () => {
  assert.deepStrictEqual(order([
    { title: "Beta", priority: 1, bought: true },
    { title: "Alpha", priority: 1, bought: true },
    { title: "Delta" },
    { title: "Charlie" },
  ]), ["Alpha", "Beta", "Charlie", "Delta"]);
});



// ---------- "Pick random" draw order ----------
// The bag is what stops a reroll handing you the same three titles all
// evening — every candidate has to come up before any of them comes up twice.
const pool = (n) => Array.from({ length: n }, (_, i) => ({ id: "p" + i, title: "T" + i }));

test("every candidate is drawn once before any repeats", () => {
  const items = pool(8);
  const drawn = [];
  for (let i = 0; i < 8; i++) {
    const b = peekPickBag(items, 1)[0];
    spendPick(b.id);
    drawn.push(b.id);
  }
  assert.deepStrictEqual([...new Set(drawn)].length, 8);
});

test("the bag refills once it runs out", () => {
  const items = pool(3);
  for (let i = 0; i < 7; i++) {
    const b = peekPickBag(items, 1)[0];
    assert.ok(b, "a draw is always available");
    spendPick(b.id);
  }
});

test("peeking does not spend the draw", () => {
  const items = pool(5);
  const first = peekPickBag(items, 1)[0].id;
  assert.strictEqual(peekPickBag(items, 1)[0].id, first);
});

test("a peek returns at most what is in scope", () => {
  assert.strictEqual(peekPickBag(pool(4), 12).length, 4);
  assert.strictEqual(peekPickBag(pool(20), 12).length, 12);
  assert.strictEqual(peekPickBag([], 12).length, 0);
});

test("narrowing the scope drops what left it, widening picks up what came back", () => {
  const items = pool(6);
  peekPickBag(items, 6);
  const narrowed = peekPickBag(items.slice(0, 2), 6);
  assert.deepStrictEqual(narrowed.map((b) => b.id).sort(), ["p0", "p1"]);
  const widened = peekPickBag(items, 6).map((b) => b.id).sort();
  assert.deepStrictEqual(widened, ["p0", "p1", "p2", "p3", "p4", "p5"]);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
