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
  steamGameNeedsInfo, steamGameNeedsRawgInfo,
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

console.log(`\n${passed} test(s) passed.`);
