// Zero-dependency tests for src/stremio.js's reading of a Stremio library
// and the rows it makes — `node test/stremio.test.js`. The library item
// shape is the one api.strem.io's datastoreGet sends for "libraryItem".
const assert = require("assert");
global.window = {};
const S = require("../src/stremio.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

const NEVER = "1970-01-01T00:00:00.000Z";
const item = (id, type, name, state, extra) => ({ _id: id, type, name, poster: "https://images.metahub.space/poster/medium/" + id + "/img", removed: false, temp: false, state: { lastWatched: NEVER, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null, ...state }, ...extra });
const LIB = [
  item("tt0113277", "movie", "Heat", {}),
  item("tt0369339", "movie", "Collateral", { lastWatched: "2026-10-02T20:15:00.000Z", timeWatched: 7000000, timesWatched: 1, flaggedWatched: 1, duration: 7200000 }, { removed: true, temp: true }),
  item("tt0081613", "movie", "Thief", { lastWatched: "2026-11-01T21:00:00.000Z", timeWatched: 1200000, timeOffset: 1200000, duration: 7300000 }),
  item("tt0903747", "series", "Breaking Bad", { lastWatched: "2026-11-10T19:00:00.000Z", timeWatched: 900000, video_id: "tt0903747:2:5" }),
  item("tt2861424", "series", "Rick and Morty", {}),
  item("tt9999999", "series", "Played once, removed", { lastWatched: NEVER }, { removed: true, temp: true }),
  item("kitsu:1376", "series", "Some anime", { lastWatched: "2026-11-01T10:00:00.000Z", video_id: "kitsu:1376:3" }),
  item("tt1234567", "channel", "Not a title", {}),
];

test("library items read as planning, watching or watched", () => {
  const recs = S.readLibrary(LIB);
  const by = Object.fromEntries(recs.map((r) => [r.name, r]));
  assert.strictEqual(by.Heat.status, "planning");
  assert.strictEqual(by.Collateral.status, "watched", "a watched movie counts even off the library");
  assert.strictEqual(by.Collateral.last.slice(0, 7), "2026-10");
  assert.strictEqual(by.Thief.status, "watching");
  assert.deepStrictEqual([by["Breaking Bad"].status, by["Breaking Bad"].season, by["Breaking Bad"].episode], ["watching", 2, 5]);
  assert.strictEqual(by["Rick and Morty"].status, "planning");
  assert.ok(!by["Played once, removed"], "removed and never played is nothing");
  assert.ok(!by["Some anime"], "Kitsu ids are left to AniList");
  assert.ok(!by["Not a title"]);
});

test("1970 and nothing both mean never played", () => {
  assert.strictEqual(S.dayOf(NEVER), "");
  assert.strictEqual(S.dayOf(null), "");
  assert.match(S.dayOf("2026-03-04T12:00:00Z"), /^2026-03-0[45]$/);
});

test("episodes watched follow how the app counts", () => {
  const ended = { airing: "finished", seasons: [{ season: 1, episodes: 7 }, { season: 2, episodes: 13 }] };
  assert.strictEqual(S.episodesWatched(2, 5, ended), 12, "an ended show counts the whole run");
  assert.strictEqual(S.episodesWatched(3, 4, { airing: "airing", airingSeason: 3 }), 4, "a running show counts its season");
  assert.strictEqual(S.episodesWatched(2, 4, { airing: "airing", airingSeason: 3 }), 0, "an older season of a running show can't be told");
  assert.strictEqual(S.episodesWatched(1, 6, null), 6);
  assert.strictEqual(S.episodesWatched(2, 6, null), 0);
  assert.strictEqual(S.episodesWatched(0, 0, null), 0);
});

const cats = { movie: "Films", series: "Shows" };
const plan = (data, extra) => S.planStremio(S.readLibrary(LIB), { categories: cats, data, matches: new Map(), seasons: new Map(), today: "2026-11-13", ...extra });

test("new titles: backlog, in progress and timeline rows", () => {
  const p = plan({ backlog: [], entries: [] });
  const titles = (xs, f) => xs.map(f).sort();
  assert.deepStrictEqual(titles(p.backlog, (x) => x.item.title), ["Breaking Bad", "Heat", "Rick and Morty", "Thief"]);
  const bb = p.backlog.find((x) => x.item.title === "Breaking Bad").item;
  assert.match(bb.startedAt, /^2026-11-1[01]$/);
  assert.strictEqual(bb.progress, undefined, "S2 with nothing from TMDB has no count");
  assert.strictEqual(bb.category, "Shows");
  const heat = p.backlog.find((x) => x.item.title === "Heat").item;
  assert.strictEqual(heat.startedAt, undefined);
  assert.ok(heat.coverUrl.startsWith("https://"));
  assert.strictEqual(p.entries.length, 1);
  const e = p.entries[0];
  assert.deepStrictEqual([e.entry.title, e.entry.year, e.entry.month, e.entry.category], ["Collateral", 2026, 10, "Films"]);
  assert.ok(e.entry.day >= 2 && e.entry.day <= 3);
  assert.strictEqual(e.finishes, null);
});

test("a category left empty isn't imported", () => {
  const p = plan({ backlog: [], entries: [] }, { categories: { movie: "Films", series: "" } });
  assert.ok(p.backlog.every((x) => x.item.category === "Films"));
});

test("what you already have is left alone, or filled in", () => {
  const data = {
    backlog: [
      { id: "b1", title: "Heat", category: "Films" },
      { id: "b2", title: "Collateral", category: "Films", createdAt: "2026-01-01T00:00:00Z", notes: "Mann" },
      { id: "b3", title: "Breaking Bad", category: "Shows", startedAt: "2026-09-01", progress: 3 },
    ],
    entries: [{ id: "e1", title: "Thief", category: "Films", year: 2025, month: 12 }],
  };
  const seasons = new Map([["tt0903747", { airing: "finished", seasons: [{ season: 1, episodes: 7 }, { season: 2, episodes: 13 }] }]]);
  const p = plan(data, { seasons });
  assert.deepStrictEqual(p.backlog.map((x) => x.item.title), ["Rick and Morty"], "Heat is there, Thief is logged");
  assert.strictEqual(p.entries.length, 1);
  assert.strictEqual(p.entries[0].finishes, "b2", "watching what was on the backlog finishes it");
  assert.strictEqual(p.entries[0].entry.notes, "Mann", "the backlog item's own words go with it");
  assert.strictEqual(p.updates.length, 1);
  const u = p.updates[0];
  assert.strictEqual(u.target.id, "b3");
  assert.strictEqual(u.patch.progress, 12);
  assert.strictEqual(u.patch.startedAt, undefined, "a start you have is kept");
});

test("TMDB matches give the title and media id, and match by id", () => {
  const matches = new Map([["tt0113277", { source: "tmdb-movie", id: "949", title: "Heat", coverUrl: "https://image.tmdb.org/t/p/w92/x.jpg", year: 1995, genres: ["Crime"] }]]);
  const fresh = plan({ backlog: [], entries: [] }, { matches });
  const heat = fresh.backlog.find((x) => x.id === "tt0113277").item;
  assert.deepStrictEqual([heat.mediaSource, heat.mediaId, heat.releaseYear, heat.coverUrl], ["tmdb-movie", "949", 1995, "https://image.tmdb.org/t/p/w92/x.jpg"]);
  const renamed = plan({ backlog: [{ id: "b9", title: "Heat (1995)", category: "Films", mediaSource: "tmdb-movie", mediaId: "949" }], entries: [] }, { matches });
  assert.ok(!renamed.backlog.some((x) => x.id === "tt0113277"), "a renamed item with the same TMDB id is the same title");
});

test("rows: finishing, updates, undated unticked and skips hidden", () => {
  const p = {
    entries: [{ entry: { title: "A" }, id: "tt1", finishes: "b1", dated: true }, { entry: { title: "B" }, id: "tt2", finishes: null, dated: false }],
    backlog: [{ item: { title: "C" }, id: "tt3" }],
    updates: [{ target: { id: "b5", title: "D" }, patch: { progress: 4 }, fills: [{ key: "progress", label: "episode 4" }], id: "tt4" }],
  };
  const fakeBuild = (inc) => ({ items: [...inc.entries.map((e) => ({ kind: "entry", entry: e, dup: false, checked: true })), ...inc.backlog.map((b) => ({ kind: "backlog", entry: b, dup: false, checked: true }))], newCategories: [] });
  const built = S.buildRows(p, fakeBuild, new Set(["stremio:tt3"]));
  const [a, b, c, d] = built.items;
  assert.strictEqual(a.finishes, "b1");
  assert.strictEqual(b.checked, false);
  assert.ok(c.skipped && !c.checked);
  assert.deepStrictEqual([d.update, d.targetId, d.entry.progress, d.stremioId], [true, "b5", 4, "tt4"]);
});

test("auto-check pacing", () => {
  const now = Date.now();
  assert.strictEqual(S.due("0", 0, now), false);
  assert.strictEqual(S.due("open", now - 60000, now), false);
  assert.strictEqual(S.due("open", now - 11 * 60000, now), true);
  assert.strictEqual(S.due("1", now - 23 * 3600000, now), false);
  assert.strictEqual(S.due("1", now - 25 * 3600000, now), true);
});

console.log(`\n${passed} passed`);
