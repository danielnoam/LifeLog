// Zero-dependency tests for src/reconcile.js's pure half — run with
// `node test/reconcile.test.js`. No build step, no test framework: plain
// Node `assert`, matching test/merge.test.js's pattern.
//
// Only `diffKeys` is covered, deliberately. It is the half that decides what
// happens; applying the ops to real elements is a dozen lines of
// insertBefore against a DOM this harness doesn't have.
const assert = require("assert");
global.window = {};
require("../src/reconcile.js");
const { diffKeys } = global.window.LifeLogReconcile;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok - " + name);
  } catch (e) {
    process.exitCode = 1;
    console.log("  FAIL - " + name + "\n      " + (e && e.message));
  }
}

const count = (ops, op) => ops.filter((o) => o.op === op).length;
const kinds = (ops) => ops.map((o) => o.op);
const keysOf = (ops, op) => ops.filter((o) => o.op === op).map((o) => o.key);

// The result has to describe the new list completely: one op per new key, in
// order, and nothing invented. Asserted after most cases below rather than
// stated once, because it's the property every caller relies on.
function assertDescribes(ops, oldKeys, newKeys) {
  const placed = ops.filter((o) => o.op !== "remove");
  assert.strictEqual(placed.length, newKeys.length, "one op per new key");
  placed.forEach((o, i) => {
    assert.strictEqual(o.key, newKeys[i], "op " + i + " names the key at that position");
    assert.strictEqual(o.to, i, "op " + i + " carries its new index");
  });
  const removedAt = keysOf(ops, "remove");
  assert.strictEqual(
    count(ops, "remove") + count(ops, "keep") + count(ops, "move"),
    oldKeys.length,
    "every old key is either removed or reused"
  );
  // Removes lead, so a caller can apply the list top to bottom.
  const firstNonRemove = kinds(ops).findIndex((k) => k !== "remove");
  if (firstNonRemove !== -1) {
    assert.ok(!kinds(ops).slice(firstNonRemove).includes("remove"), "removes come first");
  }
  return removedAt;
}

console.log("diffKeys");

test("empty to empty is no work", () => {
  assert.deepStrictEqual(diffKeys([], []), []);
});

test("first render inserts everything", () => {
  const ops = diffKeys([], ["a", "b", "c"]);
  assert.strictEqual(count(ops, "insert"), 3);
  assertDescribes(ops, [], ["a", "b", "c"]);
});

test("emptying removes everything", () => {
  const ops = diffKeys(["a", "b", "c"], []);
  assert.deepStrictEqual(kinds(ops), ["remove", "remove", "remove"]);
  assert.deepStrictEqual(keysOf(ops, "remove"), ["a", "b", "c"]);
});

test("an unchanged list moves nothing", () => {
  const ops = diffKeys(["a", "b", "c"], ["a", "b", "c"]);
  assert.deepStrictEqual(kinds(ops), ["keep", "keep", "keep"]);
  assertDescribes(ops, ["a", "b", "c"], ["a", "b", "c"]);
});

test("appending touches only the new one", () => {
  const ops = diffKeys(["a", "b"], ["a", "b", "c"]);
  assert.deepStrictEqual(kinds(ops), ["keep", "keep", "insert"]);
});

test("prepending touches only the new one", () => {
  // The three existing rows keep their nodes and their order; only the new
  // row is work. A naive index-based diff would call all four of these
  // changed, which is exactly the behaviour this replaces.
  const ops = diffKeys(["a", "b", "c"], ["z", "a", "b", "c"]);
  assert.deepStrictEqual(kinds(ops), ["insert", "keep", "keep", "keep"]);
});

test("removing from the middle leaves its neighbours alone", () => {
  const ops = diffKeys(["a", "b", "c"], ["a", "c"]);
  assert.deepStrictEqual(kinds(ops), ["remove", "keep", "keep"]);
  assert.deepStrictEqual(keysOf(ops, "remove"), ["b"]);
  assertDescribes(ops, ["a", "b", "c"], ["a", "c"]);
});

test("carries the old index a survivor came from", () => {
  const ops = diffKeys(["a", "b", "c"], ["c", "a"]);
  const byKey = Object.fromEntries(ops.map((o) => [o.key, o]));
  assert.strictEqual(byKey.a.from, 0);
  assert.strictEqual(byKey.c.from, 2);
});

test("swapping a pair moves one of them, not both", () => {
  const ops = diffKeys(["a", "b"], ["b", "a"]);
  assert.strictEqual(count(ops, "move"), 1);
  assert.strictEqual(count(ops, "keep"), 1);
});

test("one row dragged to the front is one move", () => {
  // The to-do reorder case, and the reason the longest-increasing-subsequence
  // pass is worth having: a, b, c, d stay put and only e is reported as
  // moving. Phase 8 animates exactly the ops reported here, so a sloppier
  // diff would animate the whole list for a one-row drag.
  const ops = diffKeys(["a", "b", "c", "d", "e"], ["e", "a", "b", "c", "d"]);
  assert.strictEqual(count(ops, "move"), 1);
  assert.strictEqual(count(ops, "keep"), 4);
  assert.strictEqual(ops.find((o) => o.op === "move").key, "e");
});

test("a reversal keeps the one row it can", () => {
  const ops = diffKeys(["a", "b", "c", "d"], ["d", "c", "b", "a"]);
  assert.strictEqual(count(ops, "keep"), 1);
  assert.strictEqual(count(ops, "move"), 3);
});

test("ticking a to-do moves it past the separator", () => {
  // What Phase 1 is for: the row that was ticked keeps its node and crosses
  // the done separator, rather than one node being destroyed above the rule
  // and an unrelated one appearing below it.
  const before = ["__head", "t1", "t2", "t3"];
  const after = ["__head", "t1", "t3", "__sep", "t2"];
  const ops = diffKeys(before, after);
  assert.strictEqual(count(ops, "remove"), 0, "nothing is thrown away");
  const t2 = ops.find((o) => o.key === "t2");
  assert.ok(t2.op === "move" || t2.op === "keep", "t2 survives");
  assert.strictEqual(count(ops, "insert"), 1, "only the separator is new");
  assertDescribes(ops, before, after);
});

test("a duplicate key does not throw, and does not steal a node", () => {
  const ops = diffKeys(["a"], ["a", "a"]);
  assert.strictEqual(count(ops, "insert"), 1, "the second one is new");
  assert.strictEqual(count(ops, "keep") + count(ops, "move"), 1, "the first reuses");
  assertDescribes(ops, ["a"], ["a", "a"]);
});

test("a duplicate that disappears is removed once per node", () => {
  const ops = diffKeys(["a", "a", "b"], ["a", "b"]);
  assert.strictEqual(count(ops, "remove"), 1);
  assertDescribes(ops, ["a", "a", "b"], ["a", "b"]);
});

test("a wholesale replacement reuses nothing", () => {
  const ops = diffKeys(["a", "b"], ["c", "d"]);
  assert.strictEqual(count(ops, "remove"), 2);
  assert.strictEqual(count(ops, "insert"), 2);
  assert.strictEqual(count(ops, "keep") + count(ops, "move"), 0);
});

test("holds up under arbitrary shuffles, adds and drops", () => {
  // The invariants, not the exact op for each key: whatever it decides, the
  // result must still describe the new list exactly once and account for
  // every old key. A view that renders a wrong list is worse than a slow one.
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 300; round++) {
    const oldKeys = [];
    for (let i = 0; i < Math.floor(rand() * 12); i++) oldKeys.push("k" + Math.floor(rand() * 10));
    const newKeys = oldKeys.filter(() => rand() > 0.35);
    for (let i = 0; i < Math.floor(rand() * 4); i++) {
      newKeys.splice(Math.floor(rand() * (newKeys.length + 1)), 0, "n" + Math.floor(rand() * 10));
    }
    for (let i = newKeys.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [newKeys[i], newKeys[j]] = [newKeys[j], newKeys[i]];
    }
    assertDescribes(diffKeys(oldKeys, newKeys), oldKeys, newKeys);
  }
});

test("reuses as many nodes as there are keys in common", () => {
  // Reuse is the point of the file, so it gets asserted rather than assumed:
  // the number of survivors must equal the multiset intersection.
  const oldKeys = ["a", "b", "c", "d", "e"];
  const newKeys = ["e", "x", "c", "y", "a"];
  const ops = diffKeys(oldKeys, newKeys);
  assert.strictEqual(count(ops, "keep") + count(ops, "move"), 3, "a, c and e are reused");
  assert.strictEqual(count(ops, "remove"), 2, "b and d go");
  assert.strictEqual(count(ops, "insert"), 2, "x and y arrive");
});

console.log("\n" + passed + " test(s) passed.");
