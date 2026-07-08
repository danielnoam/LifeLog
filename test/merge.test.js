// Zero-dependency tests for src/merge.js — run with `node test/merge.test.js`.
// No build step, no test framework: plain Node `assert`, matching the rest
// of this project's no-dependency constraint.
const assert = require("assert");
global.window = {};
require("../src/merge.js");
const {
  byId, sameContent, stampChangedItems, diffCollection, diffSnapshots,
  mergeCollection, mergeAllSources, mergeSettings, flattenAccomplishments,
} = global.window.LifeLogMerge;

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

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
