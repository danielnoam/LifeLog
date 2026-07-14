// Zero-dependency tests for src/app.js's normalize() and its small pure
// helpers — run with `node test/app.test.js`. No build step, no test
// framework: plain Node `assert`, matching test/merge.test.js's pattern.
//
// app.js isn't a self-contained module like merge.js: it reads window.
// LifeLogJournal/Backlog/Finance/IO/Sync/Settings/Storage at its own top
// level, touches localStorage while building `state`, and (deliberately,
// to avoid a flash of the default theme on load — see the comment above
// applyMonthLayout() in app.js) calls a handful of DOM-styling functions
// unconditionally before any of that. None of that is testable through a
// full browser bootstrap here, so this file supplies just enough of a
// stub for those top-level reads to complete without throwing, then a
// `module`-only guard in app.js itself (see the bottom of src/app.js)
// skips the real init()/wire()/Storage.load() bootstrap, which only ever
// runs in a real browser <script> load, never under require().
const assert = require("assert");

// In-memory localStorage — real enough that a "migrates once" check can
// observe the migration actually writing a key, and a second normalize()
// call in the same process seeing it already set.
const localStorageData = new Map();
global.localStorage = {
  getItem: (k) => (localStorageData.has(k) ? localStorageData.get(k) : null),
  setItem: (k, v) => localStorageData.set(k, String(v)),
  removeItem: (k) => localStorageData.delete(k),
};

// Just enough document surface for applyMonthLayout/applyFont/applyTheme/
// applyForceLayout (called unconditionally at the top of app.js's IIFE).
global.document = {
  documentElement: {
    style: { setProperty: () => {} },
    classList: { toggle: () => {} },
  },
  querySelector: () => null,
};

global.window = {};
// Real modules — normalize() calls their actual sanitizers, already
// covered by their own test files; requiring them for real here gives
// genuine integration coverage instead of re-stubbing what they do.
require("../src/finance.js");
require("../src/journal.js");
require("../src/backlog.js");
// app.js calls .init(ctx) on these three unconditionally at its own top
// level; normalize() doesn't depend on their behavior, so no-op stubs.
global.window.LifeLogIO = { init: () => {} };
global.window.LifeLogSync = { init: () => {} };
global.window.LifeLogSettings = { init: () => {} };
global.window.LifeLogStorage = {};

let idCounter = 0;
const uid = () => "test-id-" + (idCounter++);
const backfillUpdatedAt = (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z";
global.window.LifeLogFinance.init({ uid, backfillUpdatedAt });
global.window.LifeLogJournal.init({ uid, backfillUpdatedAt });
global.window.LifeLogBacklog.init({ uid, backfillUpdatedAt });

require("../src/app.js");
const App = global.window.LifeLogApp;

const { normalize, backfillUpdatedAt: appBackfillUpdatedAt, emptyData, ensureCategories } = App;

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

// ---------- backfillUpdatedAt ----------
test("backfillUpdatedAt prefers updatedAt, then createdAt, then the epoch", () => {
  assert.strictEqual(appBackfillUpdatedAt({ updatedAt: "t2", createdAt: "t1" }), "t2");
  assert.strictEqual(appBackfillUpdatedAt({ createdAt: "t1" }), "t1");
  assert.strictEqual(appBackfillUpdatedAt({}), "1970-01-01T00:00:00.000Z");
});

// ---------- emptyData ----------
test("emptyData returns the expected empty shape", () => {
  const d = emptyData();
  assert.deepStrictEqual(d.categories, []);
  assert.deepStrictEqual(d.entries, []);
  assert.deepStrictEqual(d.backlog, []);
  assert.ok(Array.isArray(d.financeCategories) && d.financeCategories.length > 0);
});

// ---------- ensureCategories ----------
test("ensureCategories adds a palette-colored category for each new name, leaves existing ones alone", () => {
  const categories = [{ id: "games", name: "Games", color: "#000000" }];
  ensureCategories(categories, [{ category: "Games" }, { category: "Movies" }]);
  assert.strictEqual(categories.length, 2);
  const added = categories.find((c) => c.name === "Movies");
  assert.ok(added.color && added.color !== "#000000");
  assert.strictEqual(categories[0].color, "#000000"); // untouched
});

// ---------- normalize(): entries/backlog sanitizing + category backfill ----------
test("normalize runs entries/backlog through the real sanitizers and backfills missing categories", () => {
  const data = normalize({
    entries: [{ title: "Foo", category: "Games", year: 2026, month: 1 }],
    backlog: [{ title: "Bar", category: "Movies" }],
    categories: [],
  });
  assert.strictEqual(data.entries[0].year, 2026); // went through sanitizeEntry
  assert.ok(data.entries[0].id);
  assert.ok(data.backlog[0].id);
  const catNames = data.categories.map((c) => c.name).sort();
  assert.deepStrictEqual(catNames, ["Games", "Movies"]);
});

test("normalize seeds finance categories/sanitizes finance data the same way", () => {
  const data = normalize({
    entries: [], backlog: [], categories: [],
    financeEntries: [{ date: "2026-01-01", amount: "10", category: "Food" }],
    recurringExpenses: [{ startDate: "2026-01-01", amount: "5", category: "Food", interval: "monthly" }],
  });
  assert.strictEqual(data.financeEntries[0].amount, 10);
  assert.ok(data.financeCategories.some((c) => c.name === "Food"));
});

// ---------- normalize(): accomplishments migration ----------
test("normalize converts a legacy plain-string accomplishment into an id'd object deterministically", () => {
  const data = normalize({ entries: [], backlog: [], categories: [], accomplishments: { 2026: ["Beat the game!"] } });
  const acc = data.accomplishments["2026"][0];
  assert.strictEqual(acc.text, "Beat the game!");
  assert.strictEqual(acc.id, "a-2026-beat-the-game-");
  assert.strictEqual(acc.updatedAt, "1970-01-01T00:00:00.000Z");
});

test("normalize gives an object-shaped accomplishment a deterministic id only when it doesn't already have one", () => {
  const withoutId = normalize({ entries: [], backlog: [], categories: [], accomplishments: { 2026: [{ text: "Won!" }] } });
  assert.strictEqual(withoutId.accomplishments["2026"][0].id, "a-2026-won-");

  const withId = normalize({ entries: [], backlog: [], categories: [], accomplishments: { 2026: [{ id: "custom-id", text: "Won!" }] } });
  assert.strictEqual(withId.accomplishments["2026"][0].id, "custom-id");
});

// ---------- normalize(): one-time visual-settings migration ----------
test("normalize migrates legacy monthMinWidth/monthMaxWidth into local visual settings exactly once", () => {
  assert.strictEqual(localStorageData.has("lifelog-visual-settings-v1"), false); // sanity: hasn't run yet

  normalize({ entries: [], backlog: [], categories: [], settings: { monthMinWidth: 240, monthMaxWidth: 900 } });
  assert.ok(localStorageData.has("lifelog-visual-settings-v1"));
  const firstSaved = JSON.parse(localStorageData.get("lifelog-visual-settings-v1"));
  assert.strictEqual(firstSaved.monthMinWidth, 240);
  assert.strictEqual(firstSaved.monthMaxWidth, 900);

  // A second normalize() call with different legacy values must NOT
  // re-trigger the migration now that the local key is already set.
  normalize({ entries: [], backlog: [], categories: [], settings: { monthMinWidth: 999, monthMaxWidth: 999 } });
  const secondSaved = JSON.parse(localStorageData.get("lifelog-visual-settings-v1"));
  assert.strictEqual(secondSaved.monthMinWidth, 240);
  assert.strictEqual(secondSaved.monthMaxWidth, 900);
});

// ---------- normalize(): settings rebuild ----------
test("normalize falls back to defaults for missing settings fields and merges nested steam/anilist objects", () => {
  const data = normalize({
    entries: [], backlog: [], categories: [],
    settings: { steam: { steamId: "12345" } },
  });
  assert.strictEqual(data.settings.monthOrder, "asc"); // DEFAULT_SETTINGS.monthOrder
  assert.strictEqual(data.settings.currency, "ILS");
  assert.strictEqual(data.settings.steam.steamId, "12345"); // incoming value kept
  assert.strictEqual(data.settings.steam.proxyUrl, ""); // default field still present
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
