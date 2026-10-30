// Zero-dependency tests for src/sync.js's pure per-item logic — run with
// `node test/sync.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern.
//
// sync.js is the module with the least testable surface in the app: almost
// everything in it is a flow that needs a browser, a CORS proxy and someone
// else's wishlist. What these cover is the decisions inside those flows —
// which items a pass touches, and what a fresh answer does to an item — which
// are ordinary functions once they're not buried in a state.data filter.
//
// It leans on the real media.js and backlog.js rather than stubs, because the
// point of needsReleaseRecheck reading window.LifeLogBacklog is that the two
// can't disagree; stubbing isAwaitingRelease here would test the wrong thing.
const assert = require("assert");
global.window = {};
require("../src/media.js");
require("../src/backlog.js");
require("../src/sync.js");

let idCounter = 0;
global.window.LifeLogBacklog.init({
  uid: () => "test-id-" + (idCounter++),
  backfillUpdatedAt: (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z",
  sanitizeOverrides: () => null,
  keepUnknown: (src, out, known) => {
    for (const key of Object.keys(src || {})) if (!known.has(key)) out[key] = src[key];
    return out;
  },
});

// Everything sync.js's flows reach for. Only isOverridden is actually called
// by the functions under test; the rest exist so init() destructures cleanly.
const noop = () => {};
global.window.LifeLogSync.init({
  state: { data: { backlog: [], settings: {} } },
  $: () => null,
  toast: noop, persist: noop, render: noop, afterDataChange: noop,
  DEFAULT_SETTINGS: { steam: {}, anilist: {}, mediaKeys: {} },
  isOverridden: (item, key) => !!(item && item.overrides && item.overrides[key]),
  buildImportItems: noop, reviewAndImport: noop,
  setBacklogCover: noop, setEntryCover: noop,
});

const {
  needsReleaseRecheck, applyItemRelease, isUnresolvedSteamItem,
  steamGameNeedsInfo, steamGameNeedsRawgInfo, ownedToEntry,
} = global.window.LifeLogSync;

function shift(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

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

const linked = (extra) => ({
  id: "b1", title: "A Game", category: "Games", mediaSource: "steam", mediaId: "892970", ...extra,
});
const OUT = { releaseDate: "2021-02-02", releasePrecision: "day", releaseStatus: "released" };
const AHEAD = { releaseDate: shift(400).slice(0, 7), releasePrecision: "month", releaseStatus: "upcoming" };

// ---------- needsReleaseRecheck ----------
test("an item with no media link can't be re-asked, however unreleased it is", () => {
  assert.strictEqual(needsReleaseRecheck({ ...AHEAD, mediaSource: "steam" }), false);
  assert.strictEqual(needsReleaseRecheck({ ...AHEAD, mediaId: "892970" }), false);
  assert.strictEqual(needsReleaseRecheck(linked(AHEAD)), true);
});

test("a pinned release date is left alone rather than fetched and discarded", () => {
  assert.strictEqual(needsReleaseRecheck(linked({ ...AHEAD, overrides: { release: true } })), false);
  // A pin on something else doesn't exempt it.
  assert.strictEqual(needsReleaseRecheck(linked({ ...AHEAD, overrides: { cover: true } })), true);
});

test("a released item is done staling, so it isn't re-asked", () => {
  assert.strictEqual(needsReleaseRecheck(linked(OUT)), false);
});

test("an Early Access item is re-asked even though it counts as released", () => {
  // The whole reason the flag has to be re-asked: Steam drops the marker at
  // 1.0 and nothing else in the app would ever notice.
  assert.strictEqual(needsReleaseRecheck(linked({ ...OUT, earlyAccess: true })), true);
});

test("a show mid-season is re-asked for its next episode, not its release", () => {
  assert.strictEqual(needsReleaseRecheck(linked({ ...OUT, nextAt: shift(6) })), true);
  assert.strictEqual(needsReleaseRecheck(linked({ ...OUT, nextAt: shift(-6) })), false);
});

test("a dropped item is not re-asked, waiting or not", () => {
  assert.strictEqual(needsReleaseRecheck(linked({ ...AHEAD, dropped: true })), false);
});

// ---------- applyItemRelease ----------
test("a re-check that found nothing new leaves no trace", () => {
  // Every stamped item is a merge candidate for the GitHub sync, so a no-op
  // re-check must not touch updatedAt.
  const item = linked({ ...OUT, updatedAt: "2026-01-01T00:00:00.000Z" });
  assert.strictEqual(applyItemRelease(item, { ...OUT }), false);
  assert.strictEqual(item.updatedAt, "2026-01-01T00:00:00.000Z");
});

test("a date that firmed up is written and stamped", () => {
  const item = linked({ releaseDate: "2027", releasePrecision: "year", updatedAt: "2026-01-01T00:00:00.000Z" });
  assert.strictEqual(applyItemRelease(item, { releaseDate: "2027-03-15", releasePrecision: "day" }), true);
  assert.strictEqual(item.releaseDate, "2027-03-15");
  assert.strictEqual(item.releasePrecision, "day");
  assert.notStrictEqual(item.updatedAt, "2026-01-01T00:00:00.000Z");
});

test("Steam saying the game left Early Access clears the flag", () => {
  const item = linked({ ...OUT, earlyAccess: true });
  assert.strictEqual(applyItemRelease(item, { ...OUT, earlyAccess: false }), true);
  assert.strictEqual("earlyAccess" in item, false);
});

test("a source that says nothing about Early Access leaves the flag alone", () => {
  // An older proxy deploy doesn't ask Steam for genres, so its answer states
  // neither — which must not read as "no longer in Early Access".
  const item = linked({ ...OUT, earlyAccess: true });
  assert.strictEqual(applyItemRelease(item, { ...OUT }), false);
  assert.strictEqual(item.earlyAccess, true);
});

test("a game that has entered Early Access gets the flag", () => {
  const item = linked({ ...OUT });
  assert.strictEqual(applyItemRelease(item, { ...OUT, earlyAccess: true }), true);
  assert.strictEqual(item.earlyAccess, true);
});

test("a pinned release date is never overwritten by a re-check", () => {
  const item = linked({ ...AHEAD, overrides: { release: true } });
  assert.strictEqual(applyItemRelease(item, { releaseDate: "2030-01-01", releasePrecision: "day" }), false);
  assert.strictEqual(item.releaseDate, AHEAD.releaseDate);
});

test("a vaguer answer never overwrites a more precise date", () => {
  const item = linked({ releaseDate: "2027-03-15", releasePrecision: "day" });
  assert.strictEqual(applyItemRelease(item, { releaseDate: "2027", releasePrecision: "year" }), false);
  assert.strictEqual(item.releaseDate, "2027-03-15");
});

// ---------- Steam backfill targets ----------
test("an unresolved Steam item is one still carrying its placeholder title", () => {
  assert.strictEqual(isUnresolvedSteamItem({ mediaSource: "steam", mediaId: "42", title: "Steam app 42" }), true);
  assert.strictEqual(isUnresolvedSteamItem({ mediaSource: "steam", mediaId: "42", title: "Portal" }), false);
  // Another source's item is never one, whatever it's called.
  assert.strictEqual(isUnresolvedSteamItem({ mediaSource: "rawg", mediaId: "42", title: "Steam app 42" }), false);
  assert.strictEqual(isUnresolvedSteamItem({ mediaSource: "steam", title: "Steam app 42" }), false);
});

test("the RAWG half of the backfill wants items missing all three of its fields", () => {
  assert.strictEqual(steamGameNeedsRawgInfo({}), true);
  assert.strictEqual(steamGameNeedsRawgInfo({ length: "90 hrs" }), false);
  assert.strictEqual(steamGameNeedsRawgInfo({ externalRating: "82 Metacritic" }), false);
  assert.strictEqual(steamGameNeedsRawgInfo({ releaseYear: 2021 }), false);
});

test("the backfill skips unresolved items and anything already filled in", () => {
  const full = { mediaSource: "steam", mediaId: "42", title: "Portal", length: "9 hrs", summary: "A blurb" };
  assert.strictEqual(steamGameNeedsInfo(full), false);
  assert.strictEqual(steamGameNeedsInfo({ ...full, summary: "" }), true);
  assert.strictEqual(steamGameNeedsInfo({ ...full, length: "" }), true);
  // An unresolved item belongs to the title retry, not to this pass.
  assert.strictEqual(steamGameNeedsInfo({ ...full, title: "Steam app 42" }), false);
  assert.strictEqual(steamGameNeedsInfo({ ...full, mediaSource: "rawg" }), false);
});

// ---------- Steam played-games backfill (0.253.0) ----------
test("a played game becomes an entry in the month it was last played, hours as its length", () => {
  const e = ownedToEntry({ appid: 620, name: "Portal 2", playtime_forever: 547, rtime_last_played: Date.UTC(2024, 4, 17, 12) / 1000 }, "Games");
  assert.strictEqual(e.title, "Portal 2");
  assert.strictEqual(e.category, "Games");
  assert.strictEqual(e.year, 2024);
  assert.strictEqual(e.month, 5);
  assert.strictEqual(e.date, "2024-05-17");
  assert.strictEqual(e.length, "9.1 hrs");
  assert.strictEqual(e.mediaSource, "steam");
  assert.strictEqual(e.mediaId, "620");
  assert.ok(/620/.test(e.coverUrl));
  assert.strictEqual(e.notes, undefined);
});

test("ten hours or more are whole hours; under that keeps a decimal", () => {
  assert.strictEqual(ownedToEntry({ appid: 1, name: "A", playtime_forever: 6031 }, "Games").length, "101 hrs");
  assert.strictEqual(ownedToEntry({ appid: 1, name: "A", playtime_forever: 95 }, "Games").length, "1.6 hrs");
  assert.strictEqual(ownedToEntry({ appid: 1, name: "A", playtime_forever: 0 }, "Games").length, undefined);
});

test("a game Steam has no last-played time for lands today and says so", () => {
  const now = new Date(2026, 9, 8, 15);
  const e = ownedToEntry({ appid: 7, playtime_forever: 60 }, "Games", now);
  assert.strictEqual(e.date, "2026-10-08");
  assert.strictEqual(e.title, "Steam app 7");
  assert.ok(/didn't say/.test(e.notes));
});

// ---------- airing and AniList (0.265.0) ----------
test("needsReleaseRecheck keeps asking about a show until it has finished", () => {
  const show = (extra) => ({ mediaId: "1", mediaSource: "tmdb-tv", releaseStatus: "released", releaseDate: "2020-01-01", releasePrecision: "day", ...extra });
  assert.strictEqual(needsReleaseRecheck(show({ airing: "airing" })), true);
  assert.strictEqual(needsReleaseRecheck(show({ airing: "between" })), true);
  assert.strictEqual(needsReleaseRecheck(show({})), true, "never asked: asked once");
  assert.strictEqual(needsReleaseRecheck(show({ airing: "finished" })), false);
  assert.strictEqual(needsReleaseRecheck(show({ airing: "airing", dropped: true })), false);
  assert.strictEqual(needsReleaseRecheck({ ...show({}), mediaSource: "tmdb-movie" }), false);
});

test("applyItemRelease moves the counts along and finishes a show", () => {
  const item = { airing: "airing", episodesOut: 7, episodesTotal: 12, nextAt: "2026-01-01", nextLabel: "Episode 8" };
  assert.strictEqual(applyItemRelease(item, { airing: "finished", episodesOut: 12, episodesTotal: 12 }), true);
  assert.strictEqual(item.airing, "finished");
  assert.strictEqual(item.episodesOut, 12);
  assert.strictEqual(item.nextAt, undefined);
  assert.strictEqual(applyItemRelease(item, { airing: "finished", episodesOut: 12, episodesTotal: 12 }), false, "nothing moved");
});

{
  const { aniListBacklogItem, aniListFinishedEntry, aniListHistoryEntry } = global.window.LifeLogSync;
  test("a Watching title comes in started, a Planning one doesn't", () => {
    const m = { id: "9", title: "Dandadan", source: "anilist-anime", airing: "airing", episodesOut: 5, episodesTotal: 12 };
    const w = aniListBacklogItem({ ...m, listStatus: "current", startedAt: "2026-09-02" }, "Anime");
    assert.strictEqual(w.startedAt, "2026-09-02");
    assert.strictEqual(w.episodesOut, 5);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(aniListBacklogItem({ ...m, listStatus: "current", startedAt: "" }, "Anime").startedAt));
    assert.strictEqual(aniListBacklogItem({ ...m, listStatus: "planning" }, "Anime").startedAt, undefined);
  });
  test("a Completed title becomes its backlog item, done in AniList's month, with your score", () => {
    const b = { id: "b1", title: "Frieren", category: "Anime", mediaSource: "anilist-anime", mediaId: "5", coverUrl: "c", createdAt: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-20" };
    const e = aniListFinishedEntry(b, { completedAt: "2026-03-14", score: 5 });
    assert.deepStrictEqual([e.year, e.month, e.date, e.startYear, e.startMonth, e.rating, e.backlogAddedAt, e.coverUrl],
      [2026, 3, "2026-03", 2026, 1, 5, "2026-01-01T00:00:00.000Z", "c"]);
    const same = aniListFinishedEntry({ ...b, startedAt: undefined }, { completedAt: "2026-03-14", startedAt: "2026-03-01", score: 0 });
    assert.strictEqual(same.startYear, undefined, "one month is no span");
    assert.strictEqual(same.rating, undefined);
  });
  test("a Completed title you have nowhere is history: its finish month, else its start, else this month and a note", () => {
    const m = { id: "20", title: "Mushishi", source: "anilist-anime", coverUrl: "c", genres: [], score: 4 };
    const e = aniListHistoryEntry({ ...m, startedAt: "2024-11-02", completedAt: "2025-02-09" }, "Anime");
    assert.deepStrictEqual([e.year, e.month, e.startYear, e.startMonth, e.rating, e.mediaId, e.coverUrl, e.genres, e.notes],
      [2025, 2, 2024, 11, 4, "20", "c", undefined, undefined]);
    const started = aniListHistoryEntry({ ...m, startedAt: "2023-06-10", completedAt: "" }, "Anime");
    assert.deepStrictEqual([started.year, started.month, started.startYear, started.notes], [2023, 6, undefined, undefined]);
    const none = aniListHistoryEntry({ ...m, startedAt: "", completedAt: "" }, "Anime");
    assert.strictEqual(none.year, new Date().getFullYear());
    assert.match(none.notes, /didn't say/);
  });
}

// ---------- a date arriving (0.271.0) ----------
{
  const { releaseDue } = global.window.LifeLogSync;
  const H = 60 * 60 * 1000;
  const now = Date.now();
  const show = (extra) => ({ id: "s1", title: "A Show", mediaSource: "tmdb-tv", mediaId: "1", airing: "airing", ...extra });
  const ago = (ms) => new Date(now - ms).toISOString();
  test("an episode date that has arrived is due, one still ahead isn't", () => {
    assert.strictEqual(releaseDue(show({ nextAt: shift(0) }), {}, now), true);
    assert.strictEqual(releaseDue(show({ nextAt: shift(-3) }), {}, now), true);
    assert.strictEqual(releaseDue(show({ nextAt: shift(2) }), {}, now), false);
  });
  test("a release day that has passed is due even though the item now reads as released", () => {
    const game = linked({ releaseDate: shift(-1), releasePrecision: "day" });
    assert.strictEqual(needsReleaseRecheck(game), false);
    assert.strictEqual(releaseDue(game, {}, now), true);
    assert.strictEqual(releaseDue(linked({ releaseDate: shift(-1).slice(0, 7), releasePrecision: "month" }), {}, now), false, "a month has no day");
    assert.strictEqual(releaseDue(linked({ releaseDate: shift(-1).slice(0, 4), releasePrecision: "year" }), {}, now), false, "nor a year");
  });
  test("asked on the day it stays due for the day after; asked after the day it's settled", () => {
    const b = show({ nextAt: shift(-1) });
    const twoDaysAgo = new Date(now - 48 * H).toISOString();
    assert.strictEqual(releaseDue(b, { s1: twoDaysAgo }, now), true, "asked before the date");
    assert.strictEqual(releaseDue(b, { s1: ago(7 * H) }, now), new Date(now - 7 * H).getDate() !== new Date(now).getDate());
    assert.strictEqual(releaseDue(b, { s1: ago(1 * H) }, now), false, "within 6 hours");
    assert.strictEqual(releaseDue(b, { s1: ago(1 * H) }, now, true), new Date(now - H).getDate() !== new Date(now).getDate(), "a press ignores the gap");
  });
  test("not past two weeks, not dropped, pinned or unlinked", () => {
    assert.strictEqual(releaseDue(show({ nextAt: shift(-15) }), {}, now), false);
    assert.strictEqual(releaseDue(show({ nextAt: shift(0), dropped: true }), {}, now), false);
    assert.strictEqual(releaseDue(show({ nextAt: shift(0), overrides: { release: true } }), {}, now), false);
    assert.strictEqual(releaseDue(show({ nextAt: shift(0), mediaId: "" }), {}, now), false);
  });
}

// ---------- AniList, both ways (0.292.0) ----------
{
  const { decideAniList, planAniList, aniListPushFields, aniListDue, aniListLocalOnly } = global.window.LifeLogSync;
  const T = (iso) => Date.parse(iso);
  const remote = (status, progress, updated, extra) => ({ id: "7", source: "anilist-anime", title: "Frieren", listStatus: status, progress, updatedAt: updated ? T(updated) : 0, ...extra });
  const item = (extra) => ({ id: "b1", title: "Frieren", category: "Anime", mediaSource: "anilist-anime", mediaId: "7", updatedAt: "2026-10-01T00:00:00Z", ...extra });

  test("a title that agrees with AniList is left alone", () => {
    const r = decideAniList(remote("current", 5, "2026-10-02T00:00:00Z"), item({ startedAt: "2026-09-01", progress: 5 }), null, { s: "current", p: 5 });
    assert.deepStrictEqual([r.pullStatus, r.pullProgress, r.pushStatus, r.pushProgress], [false, false, false, false]);
  });
  test("the side that moved since the last sync wins", () => {
    const base = { s: "current", p: 5 };
    let r = decideAniList(remote("current", 8, "2026-10-02T00:00:00Z"), item({ startedAt: "2026-09-01", progress: 5 }), null, base);
    assert.deepStrictEqual([r.progress, r.pullProgress, r.pushProgress], [8, true, false], "AniList moved");
    r = decideAniList(remote("current", 5, "2026-10-02T00:00:00Z"), item({ startedAt: "2026-09-01", progress: 6, progressAt: "2026-09-20T00:00:00Z" }), null, base);
    assert.deepStrictEqual([r.progress, r.pullProgress, r.pushProgress], [6, false, true], "LifeLog moved, even with an older time");
    r = decideAniList(remote("completed", 12, "2026-10-02T00:00:00Z"), item({ startedAt: "2026-09-01", progress: 5 }), null, base);
    assert.deepStrictEqual([r.status, r.pullStatus], ["completed", true]);
  });
  test("both moved: the newer change wins, by AniList's time and the count's own", () => {
    const base = { s: "current", p: 5 };
    // +1 here to 6, then the extension took it to 8 later: 8.
    let r = decideAniList(remote("current", 8, "2026-10-05T00:00:00Z"), item({ startedAt: "2026-09-01", progress: 6, progressAt: "2026-10-04T00:00:00Z" }), null, base);
    assert.deepStrictEqual([r.progress, r.pullProgress], [8, true]);
    // Set back to 6 here after the extension's 8: 6.
    r = decideAniList(remote("current", 8, "2026-10-05T00:00:00Z"), item({ startedAt: "2026-09-01", progress: 6, progressAt: "2026-10-06T00:00:00Z" }), null, base);
    assert.deepStrictEqual([r.progress, r.pushProgress], [6, true]);
  });
  test("with no time to go by, the further one wins", () => {
    let r = decideAniList(remote("current", 8, ""), item({ startedAt: "2026-09-01", progress: 6, progressAt: "2026-10-04T00:00:00Z" }), null, undefined);
    assert.deepStrictEqual([r.progress, r.pullProgress], [8, true], "more episodes");
    r = decideAniList(remote("current", 3, ""), item({ startedAt: "2026-09-01", progress: 6 }), null, undefined);
    assert.deepStrictEqual([r.progress, r.pushProgress], [6, true]);
    // A status never goes by an item's updatedAt with no base: that's when
    // anything about it changed. Completed beats Watching beats Planning.
    r = decideAniList(remote("completed", 12, "2025-01-01T00:00:00Z"), item({ updatedAt: "2026-10-01T00:00:00Z" }), null, undefined);
    assert.deepStrictEqual([r.status, r.pullStatus], ["completed", true]);
    r = decideAniList(remote("current", 3, "2026-10-09T00:00:00Z"), null, { id: "e1", createdAt: "2026-01-01T00:00:00Z" }, undefined);
    assert.deepStrictEqual([r.status, r.pushStatus, r.progress], ["completed", true, null], "finished here beats still watching there");
    r = decideAniList(remote("paused", 3, ""), item({ startedAt: "2026-09-01" }), null, undefined);
    assert.deepStrictEqual([r.status, r.pullStatus], ["dropped", true], "Paused counts as dropped, and with no order AniList's stands");
  });
  test("finished here and still Watching there, with no token: it stays finished here", () => {
    const r = decideAniList(remote("current", 9, "2026-09-01T00:00:00Z"), null, { id: "e1", createdAt: "2026-10-01T00:00:00Z" }, { s: "current", p: 9 });
    assert.deepStrictEqual([r.status, r.pullStatus, r.pushStatus], ["completed", false, true]);
  });
  test("watching again after finishing: AniList moved, so it's back in progress here", () => {
    const r = decideAniList(remote("current", 2, "2026-10-09T00:00:00Z"), null, { id: "e1", createdAt: "2026-01-01T00:00:00Z" }, { s: "completed", p: null });
    assert.deepStrictEqual([r.status, r.pullStatus, r.progress, r.pullProgress], ["current", true, 2, true]);
  });
  test("the plan links a hand-added title, and leaves out a removed or skipped one", () => {
    const data = {
      backlog: [{ id: "h1", title: "frieren ", category: "Anime" }],
      entries: [{ id: "e9", title: "Old", category: "Anime", date: "2025-01", mediaSource: "anilist-anime", mediaId: "3" }],
    };
    const raw = [
      { m: remote("current", 4, "2026-10-01T00:00:00Z"), category: "Anime" },
      { m: { ...remote("completed", 12, "2025-01-01T00:00:00Z"), id: "3", title: "Old" }, category: "Anime" },
      { m: { ...remote("planning", 0, ""), id: "50", title: "New One" }, category: "Anime" },
      { m: { ...remote("planning", 0, ""), id: "51", title: "Removed" }, category: "Anime" },
      { m: { ...remote("planning", 0, ""), id: "52", title: "Skipped" }, category: "Anime" },
    ];
    const plan = planAniList(raw, data, { "anilist-anime:51": { s: "planning", p: 0 } }, new Set(["anilist-anime:52"]));
    assert.deepStrictEqual(plan.titles.map((t) => [t.key, t.link ? t.link.id : null, t.status]),
      [["anilist-anime:7", "h1", "current"], ["anilist-anime:3", null, "completed"]]);
    assert.deepStrictEqual(plan.fresh.map((f) => f.m.title), ["New One"]);
  });
  test("what's sent: the status with its dates, or just the count", () => {
    const e = { year: 2026, month: 3, day: 14, startedAt: "2026-01-20" };
    assert.deepStrictEqual(aniListPushFields("completed", null, e, null, 24, true, false),
      { status: "COMPLETED", startedAt: "2026-01-20", completedAt: "2026-03-14", progress: 24 });
    assert.deepStrictEqual(aniListPushFields("current", { startedAt: "2026-10-01" }, null, 3, 0, true, true), { status: "CURRENT", startedAt: "2026-10-01", progress: 3 });
    assert.deepStrictEqual(aniListPushFields("current", { startedAt: "2026-10-01" }, null, 4, 0, false, true), { progress: 4 });
  });
  test("only titles added after signing in go to AniList on their own", () => {
    const cfg = { animeCategory: "Anime", mangaCategory: "", connectedAt: "2026-10-01T00:00:00Z" };
    const data = { backlog: [
      { id: "a", title: "New", category: "Anime", mediaSource: "anilist-anime", mediaId: "90", createdAt: "2026-10-05T00:00:00Z" },
      { id: "b", title: "Old", category: "Anime", mediaSource: "anilist-anime", mediaId: "91", createdAt: "2026-09-05T00:00:00Z" },
      { id: "c", title: "On a list", category: "Anime", mediaSource: "anilist-anime", mediaId: "92", createdAt: "2026-10-05T00:00:00Z" },
    ], entries: [] };
    assert.deepStrictEqual(aniListLocalOnly(data, new Set(["anilist-anime:92"]), cfg, {}).map((x) => x.key), ["anilist-anime:90"]);
    assert.deepStrictEqual(aniListLocalOnly(data, new Set(), { ...cfg, connectedAt: "" }, {}), [], "not signed in");
  });
  test("Sync automatically: every open is ten minutes apart at most, else days", () => {
    const now = T("2026-10-30T12:00:00Z");
    assert.strictEqual(aniListDue("open", now - 11 * 60000, now), true);
    assert.strictEqual(aniListDue("open", now - 5 * 60000, now), false);
    assert.strictEqual(aniListDue("3", now - 2 * 86400000, now), false);
    assert.strictEqual(aniListDue("3", now - 3 * 86400000, now), true);
    assert.strictEqual(aniListDue("0", 0, now), false);
  });
}

console.log(`\n${passed} test(s) passed.`);
