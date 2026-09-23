// Zero-dependency tests for src/merge.js — run with `node test/merge.test.js`.
// No build step, no test framework: plain Node `assert`, matching the rest
// of this project's no-dependency constraint.
const assert = require("assert");
global.window = {};
require("../src/merge.js");
const {
  byId, sameContent, stampChangedItems, diffCollection, diffSnapshots, summarizeConflicts,
  mergeCollection, mergeAllSources, mergeSettings, flattenAccomplishments,
  compareVersions, maxVersion,
} = global.window.LifeLogMerge;
const Merge = global.window.LifeLogMerge;

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

function item(id, title, updatedAt, extra) {
  return { id, title, updatedAt, ...extra };
}

// ---------- collections ----------
test("notes merge like every other collection", () => {
  // The whole reason notes went in COLLECTION_KEYS rather than getting their
  // own path: three-way merge, conflict resolution and undelete for free.
  const base = { notes: [item("1", "first", "t1")] };
  const local = { notes: [item("1", "first", "t1"), item("2", "added here", "t2")] };
  const remote = { notes: [item("1", "edited there", "t3")] };
  const merged = mergeAllSources(base, local, remote);
  assert.deepStrictEqual(merged.notes.map((n) => n.id).sort(), ["1", "2"]);
  assert.strictEqual(merged.notes.find((n) => n.id === "1").title, "edited there");
});

test("a note deleted on one device stays deleted", () => {
  const base = { notes: [item("1", "x", "t1")] };
  const merged = mergeAllSources(base, { notes: [] }, { notes: [item("1", "x", "t1")] });
  assert.deepStrictEqual(merged.notes, []);
});

test("diffSnapshots counts notes by name", () => {
  const out = diffSnapshots({ notes: [] }, { notes: [item("1", "x", "t1")] });
  assert.strictEqual(out, "+1 note");
});

// ---------- version comparison ----------
test("compareVersions orders by numeric part, not string order", () => {
  assert.strictEqual(compareVersions("0.116.0", "0.117.0"), -1);
  // The one string comparison gets wrong: "0.9.0" > "0.116.0" alphabetically.
  assert.strictEqual(compareVersions("0.116.0", "0.9.0"), 1);
  assert.strictEqual(compareVersions("1.0.0", "0.999.9"), 1);
  assert.strictEqual(compareVersions("0.116.0", "0.116.0"), 0);
  assert.strictEqual(compareVersions("0.116", "0.116.0"), 0); // missing parts are 0
});

test("compareVersions treats junk as 0 rather than as from the future", () => {
  assert.strictEqual(compareVersions("banana", "0.1.0"), -1);
  assert.strictEqual(compareVersions("", "0.0.0"), 0);
  assert.strictEqual(compareVersions(undefined, "0.116.0"), -1);
});

test("maxVersion keeps the newer, and either one when the other is missing", () => {
  assert.strictEqual(maxVersion("0.116.0", "0.117.0"), "0.117.0");
  assert.strictEqual(maxVersion("0.117.0", "0.116.0"), "0.117.0");
  assert.strictEqual(maxVersion("", "0.116.0"), "0.116.0");
  assert.strictEqual(maxVersion("0.116.0", ""), "0.116.0");
  assert.strictEqual(maxVersion("", ""), "");
});

test("a merge carries the newest writer version, so a device behind can't lower it", () => {
  const behind = { backlog: [], appVersion: "0.116.0" };
  const ahead = { backlog: [], appVersion: "0.117.0" };
  assert.strictEqual(mergeAllSources({}, behind, ahead).appVersion, "0.117.0");
  assert.strictEqual(mergeAllSources({}, ahead, behind).appVersion, "0.117.0");
  // Nothing to carry: no key rather than an empty one, like every other
  // optional field in this file.
  assert.strictEqual("appVersion" in mergeAllSources({}, { backlog: [] }, { backlog: [] }), false);
});

// ---------- sameContent / byId ----------
test("sameContent ignores updatedAt but catches real field changes", () => {
  const a = item("1", "X", "t1");
  const b = item("1", "X", "t2");
  const c = item("1", "Y", "t2");
  assert.strictEqual(sameContent(a, b), true);
  assert.strictEqual(sameContent(a, c), false);
});

// ---------- diffCollection / diffSnapshots ----------
test("diffCollection finds added/removed/edited", () => {
  const before = [item("1", "A", "t1"), item("2", "B", "t1")];
  const after = [item("1", "A-edited", "t2"), item("3", "C", "t1")];
  const d = diffCollection(before, after);
  assert.deepStrictEqual(d.added, ["3"]);
  assert.deepStrictEqual(d.removed, ["2"]);
  assert.deepStrictEqual(d.edited, ["1"]);
});

test("diffSnapshots produces a readable summary", () => {
  const before = { entries: [item("1", "A", "t1")] };
  const after = { entries: [item("1", "A", "t1"), item("2", "B", "t2")] };
  assert.strictEqual(diffSnapshots(before, after), "+1 entry");
});

test("diffSnapshots reports no changes as such", () => {
  const snap = { entries: [item("1", "A", "t1")] };
  assert.strictEqual(diffSnapshots(snap, snap), "No changes");
});

// ---------- mergeCollection: core scenarios ----------
test("pure local addition is kept", () => {
  const base = [];
  const local = [item("1", "A", "t1")];
  const remote = [];
  const r = mergeCollection(base, local, remote);
  assert.strictEqual(r.merged.length, 1);
  assert.deepStrictEqual(r.added, ["1"]);
});

test("pure remote addition is kept", () => {
  const base = [];
  const local = [];
  const remote = [item("1", "A", "t1")];
  const r = mergeCollection(base, local, remote);
  assert.strictEqual(r.merged.length, 1);
  assert.deepStrictEqual(r.added, ["1"]);
});

test("both sides add different items -> both kept (the core multi-device scenario)", () => {
  const base = [item("y", "Y", "t0")];
  const local = [item("y", "Y", "t0"), item("w", "W (from B)", "t1")];
  const remote = [item("y", "Y", "t0"), item("x", "X (from A)", "t1")];
  const r = mergeCollection(base, local, remote);
  const ids = r.merged.map((i) => i.id).sort();
  assert.deepStrictEqual(ids, ["w", "x", "y"]);
});

test("unchanged item passes through untouched", () => {
  const base = [item("1", "A", "t1")];
  const r = mergeCollection(base, base, base);
  assert.strictEqual(r.merged.length, 1);
  assert.strictEqual(r.merged[0].title, "A");
});

test("deletion vs unchanged-elsewhere: deletion wins", () => {
  const base = [item("1", "A", "t1")];
  const local = []; // deleted locally
  const remote = [item("1", "A", "t1")]; // untouched remotely
  const r = mergeCollection(base, local, remote);
  assert.strictEqual(r.merged.length, 0);
  assert.deepStrictEqual(r.removed, ["1"]);
});

test("deletion vs edit-elsewhere: edit wins (resurrected)", () => {
  const base = [item("1", "A", "t1")];
  const local = []; // deleted locally
  const remote = [item("1", "A-edited", "t2")]; // edited remotely since base
  const r = mergeCollection(base, local, remote);
  assert.strictEqual(r.merged.length, 1);
  assert.strictEqual(r.merged[0].title, "A-edited");
  assert.deepStrictEqual(r.updatedFromRemote, ["1"]);
  assert.deepStrictEqual(r.deleteOverridden, ["1"]); // flagged as a real conflict, not a plain update
  assert.deepStrictEqual(r.editConflicts, []);
});

test("deletion vs no change: not flagged as a conflict", () => {
  const base = [item("1", "A", "t1")];
  const local = []; // deleted locally
  const remote = [item("1", "A", "t1")]; // untouched remotely
  const r = mergeCollection(base, local, remote);
  assert.deepStrictEqual(r.removed, ["1"]);
  assert.deepStrictEqual(r.deleteOverridden, []);
});

test("symmetric: local edit survives a remote deletion", () => {
  const base = [item("1", "A", "t1")];
  const local = [item("1", "A-edited-locally", "t2")];
  const remote = []; // deleted remotely
  const r = mergeCollection(base, local, remote);
  assert.strictEqual(r.merged.length, 1);
  assert.strictEqual(r.merged[0].title, "A-edited-locally");
});

test("both sides delete the same item: stays deleted", () => {
  const base = [item("1", "A", "t1")];
  const r = mergeCollection(base, [], []);
  assert.strictEqual(r.merged.length, 0);
});

test("true conflict: both sides changed the same item since base -> newer updatedAt wins wholesale", () => {
  const base = [item("1", "A", "t0")];
  const local = [item("1", "A-local", "t1", { extra: "local-field" })];
  const remote = [item("1", "A-remote", "t2", { extra: "remote-field" })];
  const r = mergeCollection(base, local, remote);
  assert.strictEqual(r.merged.length, 1);
  assert.strictEqual(r.merged[0].title, "A-remote"); // t2 > t1
  assert.strictEqual(r.merged[0].extra, "remote-field"); // whole item, no field bleed from local
  assert.deepStrictEqual(r.updatedFromRemote, ["1"]);
  assert.deepStrictEqual(r.editConflicts, ["1"]);
  assert.deepStrictEqual(r.deleteOverridden, []);
});

test("one-sided update is not flagged as a conflict", () => {
  const base = [item("1", "A", "t0")];
  const local = [item("1", "A", "t0")]; // unchanged locally
  const remote = [item("1", "A-remote", "t1")]; // only remote changed
  const r = mergeCollection(base, local, remote);
  assert.deepStrictEqual(r.updatedFromRemote, ["1"]);
  assert.deepStrictEqual(r.editConflicts, []);
});

test("summarizeConflicts describes edit-edit and delete-vs-edit conflicts by collection", () => {
  const base = { entries: [item("1", "A", "t0")], backlog: [item("2", "B", "t0")] };
  const local = { entries: [item("1", "A-local", "t1")], backlog: [] };
  const remote = { entries: [item("1", "A-remote", "t2")], backlog: [item("2", "B-edited", "t1")] };
  const s = summarizeConflicts(base, local, remote);
  assert.match(s, /kept the newer edit for 1 entry/);
  assert.match(s, /restored 1 backlog item deleted on one side but edited on the other/);
});

test("summarizeConflicts reports nothing for a conflict-free merge", () => {
  const base = { entries: [item("1", "A", "t0")] };
  const local = { entries: [item("1", "A", "t0")] };
  const remote = { entries: [item("1", "A", "t0"), item("2", "B", "t0")] };
  assert.strictEqual(summarizeConflicts(base, local, remote), "");
});

test("no-base fallback: union semantics, no deletions inferred", () => {
  // Simulates a device's very first sync, before any base has been recorded.
  const local = [item("1", "A", "t1"), item("2", "B", "t1")];
  const remote = [item("2", "B", "t1"), item("3", "C", "t1")];
  const r = mergeCollection(undefined, local, remote);
  const ids = r.merged.map((i) => i.id).sort();
  assert.deepStrictEqual(ids, ["1", "2", "3"]); // union, nothing dropped
});

// ---------- mergeSettings ----------
test("mergeSettings: only one side changed -> that side wins", () => {
  const base = { currency: "ILS", updatedAt: "t0" };
  const local = { currency: "USD", updatedAt: "t1" };
  const remote = { currency: "ILS", updatedAt: "t0" };
  assert.strictEqual(mergeSettings(base, local, remote).currency, "USD");
});

test("mergeSettings: both changed -> newer wins wholesale", () => {
  const base = { currency: "ILS", updatedAt: "t0" };
  const local = { currency: "USD", updatedAt: "t1" };
  const remote = { currency: "EUR", updatedAt: "t2" };
  assert.strictEqual(mergeSettings(base, local, remote).currency, "EUR");
});

// ---------- mergeAllSources: whole-document + accomplishments ----------
test("mergeAllSources merges accomplishments per-year and stays convergent", () => {
  const base = { entries: [], accomplishments: { "2024": [{ id: "a1", text: "Ran a marathon", updatedAt: "t0" }] } };
  const local = { entries: [], accomplishments: { "2024": [{ id: "a1", text: "Ran a marathon", updatedAt: "t0" }, { id: "a2", text: "Learned guitar", updatedAt: "t1" }] } };
  const remote = { entries: [], accomplishments: { "2024": [{ id: "a1", text: "Ran a marathon", updatedAt: "t0" }] } };
  const merged = mergeAllSources(base, local, remote);
  assert.strictEqual(merged.accomplishments["2024"].length, 2);
});

// ---------- stampChangedItems ----------
test("stampChangedItems stamps new and changed items, leaves untouched items alone", () => {
  const prev = { entries: [item("1", "A", "t0")], settings: { currency: "ILS", updatedAt: "t0" } };
  const next = {
    entries: [item("1", "A", "t0"), item("2", "B", null)], // "2" is new
    settings: { currency: "ILS", updatedAt: "t0" }, // unchanged
  };
  stampChangedItems(prev, next, "NOW");
  assert.strictEqual(next.entries[0].updatedAt, "t0"); // unchanged item untouched
  assert.strictEqual(next.entries[1].updatedAt, "NOW"); // new item stamped
  assert.strictEqual(next.settings.updatedAt, "t0"); // unchanged settings untouched
});

test("stampChangedItems stamps an edited item", () => {
  const prev = { entries: [item("1", "A", "t0")] };
  const next = { entries: [item("1", "A-edited", "t0")] };
  stampChangedItems(prev, next, "NOW");
  assert.strictEqual(next.entries[0].updatedAt, "NOW");
});

// ---------- two-device convergence simulation (the core scenario from the plan) ----------
test("two devices, each with different offline edits, converge to the same result either direction", () => {
  const S = { // shared starting point
    entries: [item("y", "Y", "t0"), item("z", "Z", "t0")],
    backlog: [], financeEntries: [], recurringExpenses: [], categories: [], financeCategories: [],
    accomplishments: {}, settings: { currency: "ILS", updatedAt: "t0" }, version: 1,
  };
  const A = JSON.parse(JSON.stringify(S));
  const B = JSON.parse(JSON.stringify(S));

  // Device A, offline: adds X, edits Y, deletes nothing.
  A.entries.push(item("x", "X (added by A)", "t1"));
  A.entries.find((e) => e.id === "y").title = "Y edited by A";
  A.entries.find((e) => e.id === "y").updatedAt = "t1";

  // Device B, offline: adds W, deletes Z, edits Y differently and later.
  B.entries.push(item("w", "W (added by B)", "t1"));
  B.entries = B.entries.filter((e) => e.id !== "z");
  B.entries.find((e) => e.id === "y").title = "Y edited by B";
  B.entries.find((e) => e.id === "y").updatedAt = "t2"; // later than A's edit

  // A reconnects first and pushes -> remote is now A.
  // B reconnects: merge(base=S, local=B, remote=A).
  const mergedAtB = mergeAllSources(S, B, A);
  const idsAtB = mergedAtB.entries.map((e) => e.id).sort();
  assert.deepStrictEqual(idsAtB, ["w", "x", "y"]); // both additions present, Z's deletion honored
  assert.strictEqual(mergedAtB.entries.find((e) => e.id === "y").title, "Y edited by B"); // t2 > t1

  // A then reconnects again and merges against what B just pushed -> must converge, not oscillate.
  const mergedAtA = mergeAllSources(S, A, mergedAtB);
  const idsAtA = mergedAtA.entries.map((e) => e.id).sort();
  assert.deepStrictEqual(idsAtA, idsAtB);
  assert.strictEqual(mergedAtA.entries.find((e) => e.id === "y").title, "Y edited by B");
});


// ---------- habits: a marks map two devices both write to (0.171.0) ----------
const habit = (o) => ({ id: "h1", name: "Read", target: 1, cadence: "daily",
  startedAt: "2026-03-01", updatedAt: "2026-03-01T00:00:00.000Z", ...o });

test("two devices ticking different days keep both", () => {
  // The single most likely thing that will ever happen here. Left to
  // mergeCollection it is an edit conflict and one of the days is gone.
  const base = [habit({ marks: { "2026-03-01": 1 } })];
  const local = [habit({ marks: { "2026-03-01": 1, "2026-03-02": 1 }, updatedAt: "2026-03-02T09:00:00.000Z" })];
  const remote = [habit({ marks: { "2026-03-01": 1, "2026-03-03": 1 }, updatedAt: "2026-03-03T09:00:00.000Z" })];
  const out = Merge.mergeHabits(base, local, remote);
  assert.deepStrictEqual(out[0].marks, { "2026-03-01": 1, "2026-03-02": 1, "2026-03-03": 1 });
});

test("unticking a day sticks, rather than being undone by the other copy", () => {
  // Only one side changed that date, so that side is the truth — which is
  // what a plain union would get wrong.
  const base = [habit({ marks: { "2026-03-01": 1, "2026-03-02": 1 } })];
  const local = [habit({ marks: { "2026-03-01": 1 }, updatedAt: "2026-03-05T00:00:00.000Z" })];
  const remote = [habit({ marks: { "2026-03-01": 1, "2026-03-02": 1 } })];
  assert.deepStrictEqual(Merge.mergeHabits(base, local, remote)[0].marks, { "2026-03-01": 1 });
});

test("both sides changing the same day keeps the larger count", () => {
  const base = [habit({ target: 3, marks: { "2026-03-02": 1 } })];
  const local = [habit({ target: 3, marks: { "2026-03-02": 3 }, updatedAt: "2026-03-02T20:00:00.000Z" })];
  const remote = [habit({ target: 3, marks: { "2026-03-02": 2 }, updatedAt: "2026-03-02T21:00:00.000Z" })];
  assert.strictEqual(Merge.mergeHabits(base, local, remote)[0].marks["2026-03-02"], 3);
});

test("a habit added on one device arrives with its marks intact", () => {
  const added = habit({ id: "h2", name: "Run", marks: { "2026-03-04": 1 } });
  const out = Merge.mergeHabits([], [], [added]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].marks, { "2026-03-04": 1 });
});

test("a habit with every mark removed carries no empty map", () => {
  const base = [habit({ marks: { "2026-03-01": 1 } })];
  const local = [habit({ marks: {}, updatedAt: "2026-03-05T00:00:00.000Z" })];
  const out = Merge.mergeHabits(base, local, base);
  assert.strictEqual("marks" in out[0], false);
});

test("habits go through mergeAllSources with their marks merged, not clobbered", () => {
  const doc = (marks, stamp) => ({ habits: [habit({ marks, updatedAt: stamp })] });
  const out = Merge.mergeAllSources(
    doc({ "2026-03-01": 1 }, "2026-03-01T00:00:00.000Z"),
    doc({ "2026-03-01": 1, "2026-03-02": 1 }, "2026-03-02T00:00:00.000Z"),
    doc({ "2026-03-01": 1, "2026-03-03": 1 }, "2026-03-03T00:00:00.000Z"));
  assert.deepStrictEqual(out.habits[0].marks, { "2026-03-01": 1, "2026-03-02": 1, "2026-03-03": 1 });
});

test("habits are a synced collection like every other list", () => {
  assert.ok(Merge.COLLECTION_KEYS.includes("habits"));
});

// ---- settings, field by field (0.175.0) ----
// Settings used to merge as one blob, newer wins wholesale — so an
// unrelated change on one device erased a media key set on another.
const KEYS_EMPTY = { rawg: "", tmdb: "", ggdeals: "", steamgriddb: "" };
const S = (o, at) => ({ backlogSort: "title", currency: "ILS", mediaKeys: { ...KEYS_EMPTY },
  mediaCategorySources: { Games: "rawg" }, steam: { proxyUrl: "", steamId: "" }, ...o, updatedAt: at });

test("settings: edits to different fields on two devices both survive", () => {
  const base = S({}, "t0");
  const desktop = S({ mediaKeys: { ...KEYS_EMPTY, rawg: "RAWG-KEY" } }, "t1");
  const phone = S({ backlogSort: "release" }, "t2"); // later, and about something else
  const m = mergeSettings(base, phone, desktop);
  assert.strictEqual(m.mediaKeys.rawg, "RAWG-KEY");
  assert.strictEqual(m.backlogSort, "release");
});

test("settings: the same field changed on both sides goes to the newer one", () => {
  const base = S({}, "t0");
  const a = S({ currency: "USD" }, "t1"), b = S({ currency: "EUR" }, "t2");
  assert.strictEqual(mergeSettings(base, a, b).currency, "EUR");
  assert.strictEqual(mergeSettings(base, b, a).currency, "EUR");
});

test("settings: nested maps merge per entry — two devices, two categories", () => {
  const base = S({}, "t0");
  const a = S({ mediaCategorySources: { Games: "rawg", Movies: "tmdb-movie" } }, "t1");
  const b = S({ mediaCategorySources: { Games: "rawg", Books: "openlibrary" } }, "t2");
  assert.deepStrictEqual(mergeSettings(base, a, b).mediaCategorySources,
    { Games: "rawg", Movies: "tmdb-movie", Books: "openlibrary" });
});

test("settings: removing a mapping on one side stays removed", () => {
  const base = S({ mediaCategorySources: { Games: "rawg", Movies: "tmdb-movie" } }, "t0");
  const a = S({ mediaCategorySources: { Games: "rawg" } }, "t1");
  const b = S({ mediaCategorySources: { Games: "rawg", Movies: "tmdb-movie" }, backlogSort: "release" }, "t2");
  const m = mergeSettings(base, a, b);
  assert.deepStrictEqual(m.mediaCategorySources, { Games: "rawg" });
  assert.strictEqual(m.backlogSort, "release");
});

test("settings: clearing a key on one side is a change, not a blank to be overruled", () => {
  const base = S({ mediaKeys: { ...KEYS_EMPTY, rawg: "OLD" } }, "t0");
  const a = S({ mediaKeys: { ...KEYS_EMPTY, rawg: "" } }, "t1");
  const b = S({ mediaKeys: { ...KEYS_EMPTY, rawg: "OLD" }, backlogSort: "release" }, "t2");
  assert.strictEqual(mergeSettings(base, a, b).mediaKeys.rawg, "");
});

test("settings: joining with no base, a real value beats a fresh app's blank — however new the blank", () => {
  const fresh = S({}, "t9"); // a new install whose first save is the newest thing here
  const synced = S({ mediaKeys: { ...KEYS_EMPTY, rawg: "RAWG-KEY" }, steam: { proxyUrl: "https://proxy", steamId: "7656" } }, "t1");
  const m = mergeSettings(null, fresh, synced);
  assert.strictEqual(m.mediaKeys.rawg, "RAWG-KEY");
  assert.deepStrictEqual(m.steam, { proxyUrl: "https://proxy", steamId: "7656" });
});

test("settings: joining with no base, two real values still go to the newer", () => {
  const a = S({ currency: "USD" }, "t1"), b = S({ currency: "EUR" }, "t2");
  assert.strictEqual(mergeSettings(null, a, b).currency, "EUR");
});

test("settings: the merged result carries the newer stamp", () => {
  assert.strictEqual(mergeSettings(S({}, "t0"), S({ currency: "USD" }, "t1"), S({}, "t3")).updatedAt, "t3");
});

test("settings: the whole sync path keeps both edits, not just mergeSettings", () => {
  const doc = (settings) => ({ entries: [], settings });
  const base = doc(S({}, "t0"));
  const out = mergeAllSources(base, doc(S({ backlogSort: "release" }, "t2")), doc(S({ mediaKeys: { ...KEYS_EMPTY, tmdb: "TMDB" } }, "t1")));
  assert.strictEqual(out.settings.mediaKeys.tmdb, "TMDB");
  assert.strictEqual(out.settings.backlogSort, "release");
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
