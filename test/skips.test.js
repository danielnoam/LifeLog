// What an import remembers you skipped, and when it asks again
// (src/skips.js) — `node test/skips.test.js`.
const assert = require("assert");
const K = require("../src/skips.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

test("a skip keeps where the title was", () => {
  assert.strictEqual(K.stateOf({ progress: 5 }), "5");
  assert.strictEqual(K.stateOf({ progress: 0 }), "0");
  assert.strictEqual(K.stateOf({ done: true, progress: 7 }), "done");
  assert.deepStrictEqual(K.parse("anilist-anime:12#5"), { key: "anilist-anime:12", state: "5" });
  assert.deepStrictEqual(K.parse("steam:400"), { key: "steam:400", state: null });
});

test("it asks again only once the title has moved on", () => {
  const list = ["a:1#5", "a:2#done", "a:3"];
  const map = K.index(list);
  assert.strictEqual(K.check(map, "a:1", "5").status, "skipped");
  assert.strictEqual(K.check(map, "a:1", "4").status, "skipped");
  assert.strictEqual(K.check(map, "a:1", "6").status, "back");
  assert.strictEqual(K.check(map, "a:1", "done").status, "back");
  assert.strictEqual(K.check(map, "a:2", "done").status, "skipped");
  // Skipped before skips knew their state: it stays out until reviewed.
  assert.strictEqual(K.check(map, "a:3", "9").status, "skipped");
  assert.strictEqual(K.check(map, "a:9", "1").status, "");
});

test("a review forgets what was ticked and keeps the rest at their state now", () => {
  const next = K.remember(["a:1#5", "a:2", "a:3#1"], [
    { key: "a:1", state: "6", chosen: false },
    { key: "a:2", state: "3", chosen: false },
    { key: "a:3", state: "2", chosen: true },
    { key: "a:4", state: "", chosen: false },
  ]);
  assert.deepStrictEqual(next, ["a:1#6", "a:2#3", "a:4"]);
});

test("adding keeps a skip that's already there as it is", () => {
  assert.deepStrictEqual(K.add(["a:1#5"], "a:1"), ["a:1#5"]);
  assert.deepStrictEqual(K.add(["a:1#5"], "a:2"), ["a:1#5", "a:2"]);
  assert.deepStrictEqual(K.forget(["a:1#5", "a:2"], "a:1"), ["a:2"]);
});

test("rows: a skip is hidden and unticked, one that moved on comes back marked", () => {
  const rows = [
    { key: "a:1", s: "5", checked: true },
    { key: "a:2", s: "6", checked: true },
    { key: "a:3", s: "1", checked: true, dup: true },
    { key: "a:4", s: "1", checked: true },
  ];
  K.mark(rows, ["a:1#5", "a:2#5", "a:3#0"], (r) => r.key, (r) => r.s);
  assert.deepStrictEqual([rows[0].skipped, rows[0].checked, rows[0].skippedAt], [true, false, "5"]);
  assert.deepStrictEqual([rows[1].skipped, rows[1].cameBack, rows[1].checked, rows[1].skippedAt], [undefined, true, true, "5"]);
  assert.ok(!rows[2].skipped && !rows[2].cameBack);
  assert.ok(!rows[3].skipped && !rows[3].cameBack);
});

console.log(`\n${passed} passed`);
