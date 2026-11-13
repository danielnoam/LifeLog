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
  steamCoverUrl, normGenres, titleKey, isTitleMatch, pickMatch, stripHtml, firstParagraph, rawgMeta,
  parseSteamReleaseDate, steamEarlyAccess, releaseFromString, releaseFromParts,
  releaseFromSgdb, mergeRelease,
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

// ---------- steamEarlyAccess ----------
test("steamEarlyAccess reads Steam's genre id 70, not its localized label", () => {
  assert.deepStrictEqual(
    steamEarlyAccess({ genres: [{ id: "70", description: "Accès anticipé" }, { id: "1", description: "Action" }] }),
    { earlyAccess: true }
  );
  assert.deepStrictEqual(
    steamEarlyAccess({ genres: [{ id: "23", description: "Early Access-ish" }] }),
    { earlyAccess: false }
  );
});

test("steamEarlyAccess says nothing at all when the response carried no genres", () => {
  assert.deepStrictEqual(steamEarlyAccess({ name: "Some Game" }), {});
  assert.deepStrictEqual(steamEarlyAccess(null), {});
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

test("mergeRelease carries an Early Access flag but never a false one", () => {
  assert.strictEqual(mergeRelease({ earlyAccess: false }, { earlyAccess: true }).earlyAccess, true);
  // A stated `false` is a real answer — the later source drops the key, and
  // an absent key is what deletes the field off an item (see sync.js).
  assert.strictEqual("earlyAccess" in mergeRelease({ earlyAccess: true }, { earlyAccess: false }), false);
  // A source that said nothing leaves an earlier one's answer alone.
  assert.strictEqual(mergeRelease({ earlyAccess: true }, { releaseDate: "2026" }).earlyAccess, true);
  assert.strictEqual("earlyAccess" in mergeRelease({ releaseDate: "2026" }), false);
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

atest("the cross-fill hands back RAWG's id, so the blurb can be asked for later", async () => {
  stubRawg();
  const d = await Media.fetchDetails("sgdb-1", "steamgriddb", { rawg: "k" }, { title: "Hades II", wantSummary: false });
  assert.strictEqual(d.rawgId, "hades-ii");
});

// RAWG failures used to come back as a bare [], so a refused key, a spent
// quota and an outage all read as "No matches found".
function stubRawgFailure(status, body) {
  global.fetch = async () => ({ ok: false, status, json: async () => body });
}

atest("a refused RAWG key says so, with RAWG's own words", async () => {
  stubRawgFailure(401, { error: "The key parameter is not valid" });
  assert.deepStrictEqual(await Media.search("Hades", "rawg", { rawg: "bad" }), []);
  assert.strictEqual(Media.getLastError(), "RAWG refused the API key (HTTP 401: The key parameter is not valid)");
});

atest("RAWG's rate limit reads as a quota problem", async () => {
  stubRawgFailure(429, null);
  await Media.search("Hades", "rawg-steam-gg", { rawg: "k" });
  assert.strictEqual(Media.getLastError(), "RAWG's rate limit or monthly quota is used up (HTTP 429)");
});

atest("a RAWG request that never answers gives up and says so", async () => {
  let signal = null;
  global.fetch = async (url, init) => {
    signal = init && init.signal;
    const e = new Error("timed out"); e.name = "TimeoutError"; throw e;
  };
  await Media.search("Hades", "rawg", { rawg: "k" });
  assert.ok(signal, "the request carries a timeout signal");
  assert.match(Media.getLastError(), /^RAWG didn't answer within \d+s$/);
});

atest("a working RAWG search leaves no error behind", async () => {
  stubRawgFailure(500, null);
  await Media.search("Hades", "rawg", { rawg: "k" });
  stubRawg();
  const rows = await Media.search("Hades II", "rawg", { rawg: "k" });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(Media.getLastError(), "");
});

// ---------- checkKey (Settings → Media lookups status) ----------
function stubStatus(status, body) {
  const calls = [];
  global.fetch = async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  return calls;
}

atest("checkKey: a working key reads Working", async () => {
  const calls = stubStatus(200, { results: [] });
  assert.strictEqual((await Media.checkKey("rawg", "k")).state, "ok");
  assert.match(calls[0].url, /api\.rawg\.io\/api\/genres\?page_size=1&key=k$/);
});

atest("checkKey: a refused key, in the service's own words", async () => {
  stubStatus(401, { status_message: "Invalid API key: You must be granted a valid key." });
  const r = await Media.checkKey("tmdb", "bad");
  assert.strictEqual(r.label, "Key refused");
  assert.match(r.detail, /Invalid API key/);
});

atest("checkKey: Google's 400 about the key is a refused key, and the check stays on the free tier", async () => {
  const calls = stubStatus(400, { error: { message: "API key not valid. Please pass a valid API key." } });
  assert.strictEqual((await Media.checkKey("googlePlaces", "bad")).state, "bad");
  assert.strictEqual(calls[0].init.headers["X-Goog-FieldMask"], "id");
});

atest("checkKey: GG.deals answering success:false is a refused key", async () => {
  stubStatus(200, { success: false });
  assert.strictEqual((await Media.checkKey("ggdeals", "bad", "https://p.test")).state, "bad");
});

atest("checkKey: proxy-only services say they need the proxy, without asking", async () => {
  const calls = stubStatus(200, {});
  assert.strictEqual((await Media.checkKey("steamgriddb", "k", "")).label, "Needs the proxy");
  assert.strictEqual(calls.length, 0);
});

atest("checkKey: a service that never answers reads No answer", async () => {
  global.fetch = async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; };
  assert.strictEqual((await Media.checkKey("rawg", "k")).label, "No answer");
});

atest("checkKey: a spent quota and an empty key", async () => {
  stubStatus(429, null);
  assert.strictEqual((await Media.checkKey("nyt", "k")).label, "Limit reached");
  assert.strictEqual(await Media.checkKey("nyt", ""), null);
});

atest("fetchEntryExtras still skips RAWG, whose search already said both", async () => {
  const calls = stubRawg();
  const e = await Media.fetchEntryExtras("hades-ii", "rawg", { rawg: "k" }, "Hades II");
  assert.deepStrictEqual(e, { length: "", genres: [] });
  assert.strictEqual(calls.length, 0);
});

atest("NYT bestsellers (0.272.0): fiction then non-fiction, title-cased, stamped as the books source", async () => {
  const urls = [];
  const book = (title, isbn) => ({ title, author: "A. Writer", book_image: "https://img/" + isbn, description: "About it.", primary_isbn13: isbn });
  global.fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ results: { lists: [
      { list_name_encoded: "hardcover-fiction", books: [book("SKIP ME", "0")] },
      { list_name_encoded: "combined-print-and-e-book-nonfiction", books: [book("THE ANXIOUS GENERATION", "2")] },
      { list_name_encoded: "combined-print-and-e-book-fiction", books: [book("JAMES", "1"), book("THE ANXIOUS GENERATION", "3")] },
    ] } }) };
  };
  const rows = await Media.discover("nyt-openlibrary", "popular", { nyt: "k" });
  assert.deepStrictEqual(rows.map((r) => [r.title, r.source, r.lookup, r.id]),
    [["James", "openlibrary", true, "nyt-1"], ["The Anxious Generation", "openlibrary", true, "nyt-3"]]);
  assert.match(urls[0], /lists\/overview\.json\?api-key=k$/);
  assert.deepStrictEqual(await Media.discover("nyt-googlebooks", "upcoming", { nyt: "k" }), [], "no Coming soon");
  assert.deepStrictEqual(await Media.discover("nyt-googlebooks", "popular", {}), [], "no key, no request");
  assert.strictEqual(urls.length, 1);
});

// ---------- next in the series (0.275.0) ----------
const RAWG_SERIES = [
  { slug: "hades", name: "Hades", released: "2020-09-17" },
  { slug: "hades-iii", name: "Hades III", tba: true, released: "2030-12-31" },
  { slug: "hades-ii-remaster", name: "Hades II Remaster", released: "2027-01-01" },
];
function stubRawgSeries(series) {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    const body = url.includes("/game-series") ? { results: series }
      : url.includes("/api/games?search=") ? { results: [RAWG_SEARCH_GAME] }
      : RAWG_SEARCH_GAME;
    return { ok: true, json: async () => body };
  };
  return calls;
}

atest("nextInSeries (RAWG): the earliest title dated after this one, never a prequel", async () => {
  stubRawgSeries(RAWG_SERIES);
  const r = await Media.nextInSeries("hades-ii", "rawg", { rawg: "k" });
  assert.strictEqual(r.title, "Hades II Remaster");
  assert.strictEqual(r.source, "rawg");
  assert.strictEqual(r.releaseDate, "2027-01-01");
});

atest("nextInSeries (RAWG): with nothing dated after it, an undated entry is offered", async () => {
  stubRawgSeries(RAWG_SERIES.slice(0, 2));
  const r = await Media.nextInSeries("hades-ii", "rawg-steam-gg", { rawg: "k" });
  assert.strictEqual(r.title, "Hades III");
  assert.strictEqual(r.releasePrecision, "tba");
  assert.strictEqual(r.source, "rawg-steam-gg", "the combo source stays, so the pick resolves to Steam");
});

atest("nextInSeries (RAWG): only prequels means no offer; no key means no request", async () => {
  const calls = stubRawgSeries(RAWG_SERIES.slice(0, 1));
  assert.strictEqual(await Media.nextInSeries("hades-ii", "rawg", { rawg: "k" }), null);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(await Media.nextInSeries("hades-ii", "rawg", {}), null);
  assert.strictEqual(calls.length, 2);
});

atest("nextInSeries (Steam): the title is matched on RAWG first, exactly or not at all", async () => {
  const calls = stubRawgSeries(RAWG_SERIES);
  const r = await Media.nextInSeries("1145350", "steam", { rawg: "k" }, "Hades II");
  assert.strictEqual(r.title, "Hades II Remaster");
  assert.strictEqual(r.source, "rawg-steam-gg");
  assert.match(calls[0], /games\?search=Hades%20II/);
  assert.strictEqual(await Media.nextInSeries("1145350", "steam", { rawg: "k" }, "Hades II: Deluxe"), null);
});

atest("nextInSeries (TMDB movie): the collection's next film by date; a loner has none", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    const body = url.includes("/collection/")
      ? { parts: [
          { id: 10, title: "Dune", release_date: "2021-10-22" },
          { id: 20, title: "Dune: Part Two", release_date: "2024-03-01" },
          { id: 30, title: "Dune: Part Three", release_date: "2026-12-18" },
        ] }
      : url.includes("/movie/10?") ? { id: 10, release_date: "2021-10-22", belongs_to_collection: { id: 7 } }
      : { id: 99, release_date: "2020-01-01", belongs_to_collection: null };
    return { ok: true, json: async () => body };
  };
  const r = await Media.nextInSeries("10", "tmdb-movie", { tmdb: "t" });
  assert.strictEqual(r.title, "Dune: Part Two");
  assert.strictEqual(r.source, "tmdb-movie");
  assert.strictEqual(r.id, "20");
  assert.strictEqual(await Media.nextInSeries("99", "tmdb-movie", { tmdb: "t" }), null);
  assert.strictEqual(calls.length, 3);
});

atest("nextInSeries (AniList): the SEQUEL relation of the same type, in the search shape", async () => {
  global.fetch = async (url, init) => {
    const q = JSON.parse(init.body);
    assert.strictEqual(q.variables.id, 101);
    return { ok: true, json: async () => ({ data: { Media: { relations: { edges: [
      { relationType: "PREQUEL", node: { id: 100, type: "ANIME", title: { romaji: "Before" } } },
      { relationType: "ADAPTATION", node: { id: 1, type: "MANGA", title: { romaji: "The Manga" } } },
      { relationType: "SEQUEL", node: { id: 102, type: "ANIME", title: { romaji: "After", english: "After (EN)" }, startDate: { year: 2027, month: null, day: null }, status: "NOT_YET_RELEASED" } },
    ] } } } }) };
  };
  const r = await Media.nextInSeries("101", "anilist-anime", {});
  assert.strictEqual(r.title, "After (EN)");
  assert.strictEqual(r.id, "102");
  assert.strictEqual(r.source, "anilist-anime");
  assert.strictEqual(r.releaseDate, "2027");
});

atest("nextInSeries: TV, books and music answer null without a request", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => ({}) }; };
  for (const src of ["tmdb-tv", "openlibrary", "googlebooks", "musicbrainz", "steamgriddb", ""]) {
    assert.strictEqual(await Media.nextInSeries("1", src, { tmdb: "t", rawg: "k" }, "X"), null, src);
  }
  assert.strictEqual(calls, 0);
});

// ---------- IGDB ----------
test("releaseFromIgdbHuman reads how vague IGDB says a date is", () => {
  const r = Media.releaseFromIgdbHuman;
  assert.deepStrictEqual(r("Mar 05, 2026"), { releaseDate: "2026-03-05", releasePrecision: "day" });
  assert.deepStrictEqual(r("Sep 2026"), { releaseDate: "2026-09", releasePrecision: "month" });
  assert.deepStrictEqual(r("Q3 2026"), { releaseDate: "2026-07", releasePrecision: "quarter" });
  assert.deepStrictEqual(r("2027"), { releaseDate: "2027", releasePrecision: "year" });
  assert.strictEqual(r("TBD"), null);
});

test("mapIgdbResult: earliest platform date, critics first, cover, early access", () => {
  const g = Media.mapIgdbResult({
    id: 1942, name: "Hades II", cover: { image_id: "co8abc" },
    release_dates: [{ human: "Sep 25, 2025", date: 1758758400 }, { human: "May 06, 2024", date: 1714953600 }],
    aggregated_rating: 91.4, aggregated_rating_count: 12, rating: 88, rating_count: 400,
    genres: [{ name: "Roguelike" }], game_status: { status: "Early Access" },
  });
  assert.strictEqual(g.id, "1942");
  assert.strictEqual(g.source, "igdb");
  assert.strictEqual(g.releaseDate, "2024-05-06");
  assert.strictEqual(g.releasePrecision, "day");
  assert.strictEqual(g.releaseStatus, "released");
  assert.strictEqual(g.year, 2024);
  assert.strictEqual(g.externalRating, "91 IGDB");
  assert.strictEqual(g.coverUrl, "https://images.igdb.com/igdb/image/upload/t_cover_big/co8abc.jpg");
  assert.strictEqual(g.earlyAccess, true);
  assert.deepStrictEqual(g.genres, ["Roguelike"]);
});

test("mapIgdbResult: no date is TBA and upcoming; a year still to finish is upcoming; few votes say nothing", () => {
  const tba = Media.mapIgdbResult({ id: 1, name: "X", rating: 90, rating_count: 2 });
  assert.strictEqual(tba.releasePrecision, "tba");
  assert.strictEqual(tba.releaseStatus, "upcoming");
  assert.strictEqual(tba.externalRating, "");
  assert.strictEqual("earlyAccess" in tba, false);
  const y = new Date().getFullYear();
  const later = Media.mapIgdbResult({ id: 2, name: "Y", release_dates: [{ human: String(y) }], status: 0, rating: 76.4, rating_count: 9 });
  assert.strictEqual(later.releasePrecision, "year");
  assert.strictEqual(later.releaseStatus, "upcoming");
  assert.strictEqual(later.earlyAccess, false);
  assert.strictEqual(later.externalRating, "76% IGDB users");
});

// A fake proxy: the Twitch token route and IGDB's endpoints.
function stubIgdb(answers) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    const path = url.replace(/^https:\/\/proxy\.test/, "").split("?")[0];
    const a = typeof answers[path] === "function" ? answers[path](calls) : answers[path];
    const status = (a && a.status) || 200;
    return { ok: status < 300, status, json: async () => (a && a.body !== undefined ? a.body : a) };
  };
  return calls;
}
const IGDB_KEYS = { igdb: "clientid123", igdbSecret: "secret12345" };

atest("IGDB search signs in once, then queries with the token", async () => {
  const calls = stubIgdb({
    "/igdb-token": { access_token: "tok1", expires_in: 5000000 },
    "/igdb/games": [{ id: 7, name: "Celeste", release_dates: [{ human: "Jan 25, 2018" }] }],
  });
  const rows = await Media.search('Cel"este', "igdb-steam-gg", IGDB_KEYS, "https://proxy.test");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].source, "igdb-steam-gg");
  assert.strictEqual(calls[0].init.headers["Client-ID"], "clientid123");
  assert.strictEqual(calls[0].init.headers.Authorization, "Secret secret12345");
  assert.strictEqual(calls[1].init.headers.Authorization, "Bearer tok1");
  assert.match(decodeURIComponent(calls[1].url), /search "Cel este"; fields /);
  await Media.search("Celeste", "igdb", IGDB_KEYS, "https://proxy.test");
  assert.strictEqual(calls.filter((c) => c.url.includes("/igdb-token")).length, 1);
});

atest("IGDB: a revoked token gets one fresh one and one retry", async () => {
  let n = 0;
  const calls = stubIgdb({
    "/igdb-token": { access_token: "tok2", expires_in: 5000000 },
    "/igdb/games": () => (n++ === 0 ? { status: 401, body: {} } : [{ id: 8, name: "Hollow Knight" }]),
  });
  const rows = await Media.search("Hollow Knight", "igdb", IGDB_KEYS, "https://proxy.test");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(calls.filter((c) => c.url.includes("/igdb-token")).length, 1);
});

atest("IGDB without the proxy or the secret asks nothing", async () => {
  const calls = stubIgdb({});
  assert.deepStrictEqual(await Media.search("X", "igdb", IGDB_KEYS, ""), []);
  assert.match(Media.getLastError(), /proxy/);
  assert.deepStrictEqual(await Media.search("X", "igdb", { igdb: "clientid123" }, "https://proxy.test"), []);
  assert.strictEqual(calls.length, 0);
});

atest("IGDB details: blurb, play time from time-to-beat, early access cleared on release", async () => {
  stubIgdb({
    "/igdb/games": [{ id: 9, name: "Z", summary: "First.\n\nSecond.", status: 0, aggregated_rating: 80, aggregated_rating_count: 5 }],
    "/igdb/game_time_to_beats": [{ normally: 36000, hastily: 20000 }],
  });
  const d = await Media.fetchDetails("9", "igdb", IGDB_KEYS, { proxyUrl: "https://proxy.test" });
  assert.strictEqual(d.summary, "First.");
  assert.strictEqual(d.length, "10 hrs");
  assert.strictEqual(d.externalRating, "80 IGDB");
  assert.strictEqual(d.earlyAccess, false);
});

atest("IGDB's Steam App ID comes from its external ids, else its Steam link", async () => {
  stubIgdb({ "/igdb/games": [{ id: 1, external_games: [{ uid: "abc", category: 5 }, { uid: "1145360", external_game_source: 1 }] }] });
  assert.strictEqual(await Media.fetchIgdbSteamAppId("1", IGDB_KEYS, "https://proxy.test"), "1145360");
  stubIgdb({ "/igdb/games": [{ id: 1, websites: [{ url: "https://store.steampowered.com/app/504230/Celeste/" }] }] });
  assert.strictEqual(await Media.fetchIgdbSteamAppId("1", IGDB_KEYS, "https://proxy.test"), "504230");
});

atest("checkKey for IGDB signs in with both halves, and says when the secret is missing", async () => {
  assert.strictEqual((await Media.checkKey("igdb", "clientid123", "https://proxy.test", { igdb: "clientid123" })).label, "Needs the secret");
  stubIgdb({ "/igdb-token": { status: 400, body: { status: 400, message: "invalid client secret" } } });
  assert.strictEqual((await Media.checkKey("igdb", "clientid123", "https://proxy.test", IGDB_KEYS)).state, "bad");
  stubIgdb({ "/igdb-token": { access_token: "t", expires_in: 100 } });
  assert.strictEqual((await Media.checkKey("igdb", "clientid123", "https://proxy.test", IGDB_KEYS)).state, "ok");
});

// ---------- Hardcover ----------
test("mapHardcoverBook: a search hit, with its series and position", () => {
  const b = Media.mapHardcoverBook({
    id: 369, slug: "the-well-of-ascension", title: "The Well of Ascension", author_names: ["Brandon Sanderson"],
    image: { url: "https://assets.hardcover.app/x.jpg" }, release_year: 2007, pages: 590, rating: 4.31, ratings_count: 900,
    featured_series: { position: 2, series: { name: "Mistborn" } }, genres: ["Fantasy"], description: "Vin's back.\n\nMore.",
  });
  assert.strictEqual(b.id, "the-well-of-ascension");
  assert.strictEqual(b.author, "Brandon Sanderson");
  assert.strictEqual(b.series, "Mistborn #2");
  assert.strictEqual(b.externalRating, "4.3 Hardcover");
  assert.strictEqual(b.length, "590 pages");
  assert.strictEqual(b.year, 2007);
  assert.strictEqual(b.summary, "Vin's back.");
  assert.strictEqual(b.coverUrl, "https://assets.hardcover.app/x.jpg");
});

test("mapHardcoverBook: a table row reads its cached image and contributors", () => {
  const b = Media.mapHardcoverBook({ slug: "x", title: "X", cached_image: { url: "https://a.test/c.jpg" }, cached_contributors: [{ author: { name: "A. Writer" } }], rating: 5, ratings_count: 1 });
  assert.strictEqual(b.coverUrl, "https://a.test/c.jpg");
  assert.strictEqual(b.author, "A. Writer");
  assert.strictEqual(b.externalRating, "");
  assert.strictEqual("series" in b, false);
});

function stubHardcover(answer) {
  const calls = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(decodeURIComponent(/[?&]q=([^&]*)/.exec(url)[1]));
    calls.push({ url, init, body });
    const a = answer(body, calls.length);
    return { ok: (a.status || 200) < 300, status: a.status || 200, json: async () => a.body || a };
  };
  return calls;
}

atest("Hardcover search sends the token behind Bearer once and reads the hits", async () => {
  const calls = stubHardcover(() => ({ data: { search: { results: JSON.stringify({ hits: [{ document: { slug: "mistborn", title: "Mistborn", author_names: ["B"] } }, { document: { title: "No slug" } }] }) } } }));
  const rows = await Media.search("Mistborn", "hardcover", { hardcover: "Bearer tok" }, "https://proxy.test", "Sanderson");
  assert.deepStrictEqual(rows.map((r) => r.id), ["mistborn"]);
  assert.strictEqual(calls[0].init.headers.Authorization, "Bearer tok");
  assert.strictEqual(calls[0].body.variables.q, "Mistborn Sanderson");
  assert.ok(calls[0].url.startsWith("https://proxy.test/hardcover?q="));
});

atest("Hardcover: a GraphQL error is said, not shown as no matches", async () => {
  stubHardcover(() => ({ errors: [{ message: "Unable to verify token" }] }));
  assert.deepStrictEqual(await Media.search("X", "hardcover", { hardcover: "tok" }, "https://proxy.test"), []);
  assert.match(Media.getLastError(), /Unable to verify token/);
});

atest("Hardcover next in series skips a second edition at the same place", async () => {
  const calls = stubHardcover((body) => /books\(where: \{slug/.test(body.query)
    ? { data: { books: [{ title: "Mistborn", book_series: [{ position: 1, series_id: 40 }] }] } }
    : { data: { book_series: [{ position: 1.5, book: { slug: "mistborn-2", title: "Mistborn" } }, { position: 2, book: { slug: "the-well-of-ascension", title: "The Well of Ascension", cached_contributors: [{ author: { name: "B" } }] } }] } });
  const next = await Media.nextInSeries("mistborn", "hardcover", { hardcover: "tok" }, "Mistborn", "https://proxy.test");
  assert.strictEqual(next.title, "The Well of Ascension");
  assert.strictEqual(next.source, "hardcover");
  assert.match(calls[1].body.query, /series_id: \{_eq: 40\}, position: \{_gt: 1\}/);
});

atest("Hardcover's key check reads a GraphQL error inside a 200 as a refused token", async () => {
  stubHardcover(() => ({ errors: [{ message: "invalid token" }] }));
  assert.strictEqual((await Media.checkKey("hardcover", "tok", "https://proxy.test")).state, "bad");
  stubHardcover(() => ({ data: { me: [{ username: "d" }] } }));
  assert.strictEqual((await Media.checkKey("hardcover", "tok", "https://proxy.test")).state, "ok");
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
  // ---------- isTitleMatch / pickMatch ----------
// The reported cases: RAWG answers "BioShock" with "BioShock Infinite", which
// is not nothing — so the old "fall back only when empty, then take [0]" rule
// never asked the second source and then picked the wrong game.
test("an auto-pick refuses a result that is merely the closest thing", () => {
  assert.strictEqual(isTitleMatch("BioShock", "BioShock Infinite"), false);
  assert.strictEqual(isTitleMatch("Metro 2033", "Metro 2033 Redux"), false);
  assert.strictEqual(isTitleMatch("Portal", "Portal Knights"), false);
});

test("the same title in different dress is still a match", () => {
  assert.strictEqual(isTitleMatch("BioShock", "BioShock"), true);
  assert.strictEqual(isTitleMatch("bioshock", "BIOSHOCK"), true);
  // Store names carry these constantly, and NFKD turns \u2122 into the letters TM.
  assert.strictEqual(isTitleMatch("Bioshock", "BIOSHOCK\u2122"), true);
  assert.strictEqual(isTitleMatch("Half-Life 2", "Half-Life\u00ae 2"), true);
  assert.strictEqual(isTitleMatch("Pokemon", "Pok\u00e9mon"), true);
  assert.strictEqual(isTitleMatch("Ratchet & Clank", "Ratchet and Clank"), true);
  // A season marker is not a different title; a season NUMBER is.
  assert.strictEqual(isTitleMatch("Attack on Titan S1", "Attack on Titan"), true);
  assert.strictEqual(isTitleMatch("Attack on Titan S1", "Attack on Titan Season 4"), false);
});

// Dropped in 0.153.0: a subtitle is usually the same work narrowed, but
// "usually" is what put the wrong cover on things in the first place.
test("a subtitle is no longer close enough", () => {
  assert.strictEqual(isTitleMatch("The Witcher 3", "The Witcher 3: Wild Hunt"), false);
  assert.strictEqual(isTitleMatch("Halo", "Halo - Combat Evolved"), false);
  assert.strictEqual(isTitleMatch("BioShock", "BioShock: The Collection"), false);
});

test("nothing matches an empty query", () => {
  assert.strictEqual(isTitleMatch("", "BioShock"), false);
  assert.strictEqual(isTitleMatch("   ", "BioShock"), false);
  assert.strictEqual(isTitleMatch("BioShock", null), false);
});

test("pickMatch returns null rather than the closest thing", () => {
  const rawgSaysNo = [{ title: "BioShock Infinite" }, { title: "BioShock 2" }, { title: "BioShock Remastered" }];
  assert.strictEqual(pickMatch(rawgSaysNo, "BioShock"), null);
  assert.strictEqual(pickMatch([], "BioShock"), null);
  assert.strictEqual(pickMatch(null, "BioShock"), null);
});

test("pickMatch takes the match wherever it sits in the list", () => {
  const results = [{ title: "BioShock Infinite" }, { title: "BioShock 2" }, { title: "BioShock" }];
  assert.strictEqual(pickMatch(results, "BioShock").title, "BioShock");
});

test("pickMatch takes the first of several matches, which is the source's own ranking", () => {
  const results = [{ id: "a", title: "BIOSHOCK\u2122" }, { id: "b", title: "BioShock" }];
  assert.strictEqual(pickMatch(results, "BioShock").id, "a");
});

test("titleKey no longer turns a trademark symbol into letters", () => {
  assert.strictEqual(titleKey("BIOSHOCK\u2122"), titleKey("BioShock"));
  assert.strictEqual(titleKey("Portal\u00a9"), titleKey("Portal"));
});

// ---------- how far a show has run (0.265.0) ----------
const { aniListStatus, tmdbAiring, jikanAiring, mapAniListListEntry } = Media;

test("aniListStatus: mid-run counts the episodes before the next one", () => {
  const out = aniListStatus({ type: "ANIME", status: "RELEASING", episodes: 12, nextAiringEpisode: { airingAt: 1893456000, episode: 8 } });
  assert.strictEqual(out.airing, "airing");
  assert.strictEqual(out.releaseStatus, "released");
  assert.strictEqual(out.episodesOut, 7);
  assert.strictEqual(out.episodesTotal, 12);
  assert.strictEqual(out.nextLabel, "Episode 8");
});

test("aniListStatus: finished has all of them out, a manga counts chapters", () => {
  assert.deepStrictEqual(
    (({ airing, episodesOut, episodesTotal }) => ({ airing, episodesOut, episodesTotal }))(aniListStatus({ type: "ANIME", status: "FINISHED", episodes: 24 })),
    { airing: "finished", episodesOut: 24, episodesTotal: 24 });
  const manga = aniListStatus({ type: "MANGA", status: "FINISHED", episodes: null, chapters: 120 });
  assert.strictEqual(manga.episodesTotal, 120);
  assert.strictEqual(aniListStatus({ type: "MANGA", status: "RELEASING", chapters: null }).episodesTotal, undefined);
  assert.strictEqual(aniListStatus({ status: "HIATUS" }).airing, "hiatus");
  assert.strictEqual(aniListStatus({ status: "NOT_YET_RELEASED" }).airing, "upcoming");
});

test("tmdbAiring: mid-season, between seasons, ended, not started", () => {
  const seasons = [{ season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 8 }, { season_number: 2, episode_count: 10 }];
  assert.deepStrictEqual(tmdbAiring({ status: "Returning Series", seasons,
    last_episode_to_air: { season_number: 2, episode_number: 7 }, next_episode_to_air: { season_number: 2, episode_number: 8 } }),
    { airing: "airing", airingSeason: 2, episodesOut: 7, episodesTotal: 10 });
  assert.deepStrictEqual(tmdbAiring({ status: "Returning Series", seasons,
    last_episode_to_air: { season_number: 2, episode_number: 10 }, next_episode_to_air: { season_number: 3, episode_number: 1 } }),
    { airing: "between", airingSeason: 2, episodesOut: 10, episodesTotal: 10 });
  // Episodes still listed for the season, with no date on the next one.
  assert.strictEqual(tmdbAiring({ status: "Returning Series", seasons,
    last_episode_to_air: { season_number: 2, episode_number: 4 }, next_episode_to_air: null }).airing, "airing");
  assert.deepStrictEqual(tmdbAiring({ status: "Ended", number_of_episodes: 18, last_episode_to_air: { season_number: 2, episode_number: 10 } }),
    { airing: "finished", episodesOut: 18, episodesTotal: 18 });
  assert.strictEqual(tmdbAiring({ status: "Canceled" }).airing, "cancelled");
  assert.deepStrictEqual(tmdbAiring({ status: "In Production", last_episode_to_air: null }), { airing: "upcoming" });
});

test("jikanAiring reads the free-text status", () => {
  assert.deepStrictEqual(jikanAiring({ status: "Currently Airing", episodes: 12 }, "anime"), { airing: "airing", episodesTotal: 12 });
  assert.deepStrictEqual(jikanAiring({ status: "Finished", chapters: 90 }, "manga"), { airing: "finished", episodesTotal: 90, episodesOut: 90 });
  assert.strictEqual(jikanAiring({ status: "On Hiatus" }, "manga").airing, "hiatus");
  assert.deepStrictEqual(jikanAiring({ status: "" }, "anime"), {});
});

test("mergeRelease: a source stating airing replaces the counts and clears a stale next episode", () => {
  const item = { airing: "airing", episodesOut: 11, episodesTotal: 12, nextAt: "2026-03-03", nextLabel: "Episode 12" };
  const out = mergeRelease(item, { airing: "finished", episodesOut: 12, episodesTotal: 12, releaseStatus: "released" });
  assert.strictEqual(out.airing, "finished");
  assert.strictEqual(out.episodesOut, 12);
  assert.strictEqual(out.nextAt, undefined);
  assert.strictEqual(out.nextLabel, undefined);
  // One that says nothing about airing leaves all of it alone.
  const kept = mergeRelease(item, { releaseStatus: "released" });
  assert.strictEqual(kept.nextAt, "2026-03-03");
  assert.strictEqual(kept.episodesOut, 11);
  // And a season count it doesn't state goes.
  assert.strictEqual(mergeRelease({ airingSeason: 2, airing: "airing" }, { airing: "finished" }).airingSeason, undefined);
});

test("mapAniListListEntry carries the list's status, dates and score", () => {
  const e = mapAniListListEntry({
    status: "COMPLETED", score: 4, startedAt: { year: 2026, month: 2, day: 1 }, completedAt: { year: 2026, month: 3, day: null },
    media: { id: 5, title: { romaji: "Frieren" }, status: "FINISHED", episodes: 28, startDate: { year: 2023 } },
  }, "ANIME");
  assert.strictEqual(e.listStatus, "completed");
  assert.strictEqual(e.startedAt, "2026-02-01");
  assert.strictEqual(e.completedAt, "");
  assert.strictEqual(e.score, 4);
  assert.strictEqual(e.airing, "finished");
  assert.strictEqual(e.source, "anilist-anime");
});

console.log(`\n${passed} test(s) passed.`);
  if (process.exitCode) console.log("Some tests FAILED — see above.");
})();
