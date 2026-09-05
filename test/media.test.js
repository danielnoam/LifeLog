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
  steamCoverUrl, normGenres, titleKey, stripHtml, firstParagraph, rawgMeta,
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

// ---------- titleKey ----------
// What Discover's "you already have this" check compares. Two rules pull
// against each other here: fold away everything two spellings of the same
// title disagree about, but never fold away the season number, or owning a
// first season would hide a fourth you have not seen.
const same = (a, b) => assert.strictEqual(titleKey(a), titleKey(b), `${a} != ${b}`);
const differ = (a, b) => assert.notStrictEqual(titleKey(a), titleKey(b), `${a} == ${b}`);

test("titleKey: a trailing season marker reads as season 1's absence", () => {
  same("Attack on Titan S1", "Attack on Titan");
  same("Attack on Titan - Season 1", "Attack on Titan");
  same("Foo: Book 1", "Foo");
});

test("titleKey: case, accents, punctuation and & are folded away", () => {
  same("ATTACK ON TITAN!", "Attack on Titan");
  same("Pokémon", "Pokemon");
  same("Rick & Morty", "Rick and Morty");
  same("  Spaced   Out  ", "Spaced Out");
});

test("titleKey: the same season said two ways is one key", () => {
  same("Dandadan 3rd Season", "Dandadan S3");
  same("Slime Season 4", "Slime S4");
  same("Slime - Season 4", "Slime: S4");
});

test("titleKey: a season you own does NOT match a season you don't", () => {
  differ("That Time I Got Reincarnated as a Slime", "That Time I Got Reincarnated as a Slime Season 4");
  differ("Attack on Titan S1", "Attack on Titan S4");
  differ("Dandadan", "Dandadan 3rd Season");
  differ("Foo: Book 1", "Foo: Book 2");
});

test("titleKey: a number that isn't a season marker stays in the title", () => {
  differ("Portal 2", "Portal");
  differ("Se7en", "Seven");
});

test("titleKey: nothing to key on gives an empty string, not a bare marker", () => {
  assert.strictEqual(titleKey(""), "");
  assert.strictEqual(titleKey("   "), "");
  assert.strictEqual(titleKey(null), "");
  assert.strictEqual(titleKey(undefined), "");
});

// ---------- stripHtml ----------
test("stripHtml removes tags but keeps the text content", () => {
  assert.strictEqual(stripHtml("<p>Hello <b>world</b></p>"), "Hello world");
});

test("stripHtml handles null/undefined input without throwing", () => {
  assert.strictEqual(stripHtml(null), "");
  assert.strictEqual(stripHtml(undefined), "");
});

test("stripHtml decodes the entities escaped text leaves behind", () => {
  assert.strictEqual(stripHtml("<p>Baldur&#39;s Gate &amp; friends</p>"), "Baldur's Gate & friends");
  assert.strictEqual(stripHtml("&lt;b&gt; stays text"), "<b> stays text");
});

// ---------- firstParagraph ----------
test("firstParagraph keeps a short blurb as-is, collapsing whitespace", () => {
  assert.strictEqual(firstParagraph("A short   blurb.\nSame paragraph."), "A short blurb. Same paragraph.");
});

test("firstParagraph stops at the first blank line", () => {
  assert.strictEqual(firstParagraph("The blurb.\n\nAbout the game\n\nCredits"), "The blurb.");
});

test("firstParagraph cuts a long paragraph at a word boundary", () => {
  const out = firstParagraph("word ".repeat(50), 40);
  assert.ok(out.length <= 41, "stays within the cap: " + out.length);
  assert.ok(out.endsWith("…"), "marks the cut: " + out);
  assert.ok(!out.includes("wor…"), "doesn't cut mid-word: " + out);
});

test("firstParagraph handles empty/null input", () => {
  assert.strictEqual(firstParagraph(null), "");
  assert.strictEqual(firstParagraph(""), "");
});

// ---------- rawgMeta ----------
test("rawgMeta prefers a Metacritic score over RAWG's own user rating", () => {
  assert.deepStrictEqual(rawgMeta({ metacritic: 84, rating: 4.2, playtime: 12 }), {
    externalRating: "84 Metacritic", length: "12 hrs",
  });
});

test("rawgMeta falls back to the user rating as a percentage", () => {
  assert.strictEqual(rawgMeta({ metacritic: null, rating: 3.8 }).externalRating, "76% users");
});

test("rawgMeta leaves rating and length empty when RAWG knows neither", () => {
  // The usual state of an unreleased game — nobody has reviewed or played it.
  assert.deepStrictEqual(rawgMeta({ metacritic: null, rating: 0, playtime: 0 }), {
    externalRating: "", length: "",
  });
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

// ---------- SteamGridDB → RAWG cross-fill ----------
// The only network-touching code covered in this file; everything above is
// pure. It earns the exception because what's under test isn't RAWG's
// response shape but the routing around it — which sources cross-fill, how
// many requests that costs, and which of RAWG's fields are deliberately
// dropped. `fetch` is stubbed, so nothing leaves the machine.
const RAWG_SEARCH_GAME = {
  slug: "hades-ii", name: "Hades II", background_image: "https://img/hades2.jpg",
  released: "2024-05-06", metacritic: 91, playtime: 30,
  genres: [{ name: "Action" }, { name: "Roguelike" }],
};

// Answers RAWG's search and per-game endpoints, and hands back the array of
// URLs asked for so a test can assert on the request count as well as the
// result — the whole point of the wantSummary flag is the second request it
// avoids, which is invisible in the returned fields.
function stubRawg({ search = [RAWG_SEARCH_GAME], details = {} } = {}) {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    const body = url.includes("/api/games?search=")
      ? { results: search }
      : { ...RAWG_SEARCH_GAME, ...details };
    return { ok: true, json: async () => body };
  };
  return calls;
}

// Async twin of test() above, run sequentially at the bottom of the file —
// each case installs its own `fetch` stub, so letting them overlap would
// have them fighting over the global.
const asyncTests = [];
function atest(name, fn) { asyncTests.push([name, fn]); }

atest("a SteamGridDB pick cross-fills rating, length, genres and a blurb", async () => {
  const calls = stubRawg({ details: { description_raw: "A rogue-lite." } });
  const d = await Media.fetchDetails("sgdb-1", "steamgriddb", { rawg: "k" }, { title: "Hades II" });
  assert.strictEqual(d.externalRating, "91 Metacritic");
  assert.strictEqual(d.length, "30 hrs");
  assert.deepStrictEqual(d.genres, ["Action", "Roguelike"]);
  assert.strictEqual(d.summary, "A rogue-lite.");
  assert.strictEqual(calls.length, 2); // the search, then the blurb
  assert.ok(calls[0].includes("search=Hades%20II"));
});

atest("the cross-fill never takes RAWG's date, so SteamGridDB's own survives", async () => {
  // RAWG dates by earliest platform release; the per-game endpoint stubbed
  // here does return `released`, so this guards the field being ignored
  // rather than merely absent.
  const calls = stubRawg();
  const d = await Media.fetchDetails("sgdb-1", "steamgriddb", { rawg: "k" }, { title: "Hades II" });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(d.releaseDate, "");
  assert.strictEqual(d.releasePrecision, "");
  const merged = mergeRelease({ releaseDate: "2025-11-20", releasePrecision: "day" }, d);
  assert.strictEqual(merged.releaseDate, "2025-11-20");
});

atest("wantSummary:false keeps the cross-fill to a single request", async () => {
  const calls = stubRawg();
  const d = await Media.fetchDetails("sgdb-1", "steamgriddb-steam-gg", { rawg: "k" },
    { title: "Hades II", wantSummary: false });
  assert.strictEqual(d.length, "30 hrs");
  assert.strictEqual(d.summary, "");
  assert.strictEqual(calls.length, 1);
});

atest("no RAWG key means no cross-fill and no request at all", async () => {
  const calls = stubRawg();
  const d = await Media.fetchDetails("sgdb-1", "steamgriddb", {}, { title: "Hades II" });
  assert.strictEqual(d.externalRating, "");
  assert.deepStrictEqual(d.genres, []);
  assert.strictEqual(calls.length, 0);
});

atest("a title RAWG can't match cross-fills nothing, and skips the blurb", async () => {
  const calls = stubRawg({ search: [] });
  const d = await Media.fetchDetails("sgdb-1", "steamgriddb", { rawg: "k" }, { title: "Nonesuch" });
  assert.strictEqual(d.length, "");
  assert.strictEqual(d.summary, "");
  assert.strictEqual(calls.length, 1);
});

atest("fetchEntryExtras cross-fills SteamGridDB's length and genres in one call", async () => {
  const calls = stubRawg();
  const e = await Media.fetchEntryExtras("sgdb-1", "steamgriddb", { rawg: "k" }, "Hades II");
  assert.strictEqual(e.length, "30 hrs");
  assert.deepStrictEqual(e.genres, ["Action", "Roguelike"]);
  // One search answers both fields; never the second request a description
  // would cost, since a timeline entry has nowhere to put one.
  assert.strictEqual(calls.length, 1);
});

atest("fetchEntryExtras still skips RAWG, whose search already said both", async () => {
  const calls = stubRawg();
  const e = await Media.fetchEntryExtras("hades-ii", "rawg", { rawg: "k" }, "Hades II");
  assert.deepStrictEqual(e, { length: "", genres: [] });
  assert.strictEqual(calls.length, 0);
});

// The sync cases above have all run by now; the async ones are only queued,
// so the tally waits on them rather than reporting a count six short.
(async () => {
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      passed++;
      console.log("  ok - " + name);
    } catch (e) {
      console.error("  FAIL - " + name);
      console.error("    " + e.message);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed} test(s) passed.`);
  if (process.exitCode) console.log("Some tests FAILED — see above.");
})();
