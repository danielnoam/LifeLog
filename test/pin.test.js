// Zero-dependency tests for src/pin.js's quick add — `node test/pin.test.js`.
const assert = require("assert");
global.window = {};
const Pin = require("../src/pin.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}
const base = { today: "2026-11-19", now: "2026-11-19T10:00:00.000Z", id: "q1" };

test("nothing written adds nothing", () => {
  for (const k of ["task", "note", "entry", "expense"]) assert.strictEqual(Pin.quickItem(k, "  ", base), null);
});

test("an expense is its first number, the rest its note, either way round", () => {
  assert.deepStrictEqual(Pin.quickItem("expense", "12.50 coffee", base), [{ kind: "expense", id: "q1", at: base.now, date: "2026-11-19", amount: "12.50", note: "coffee" }]);
  assert.strictEqual(Pin.quickItem("expense", "lunch at Joe's 48", base)[0].note, "lunch at Joe's");
  assert.strictEqual(Pin.quickItem("expense", "taxi 7,5", base)[0].amount, "7.5");
  assert.strictEqual(Pin.quickItem("expense", "coffee", base), null);
  assert.strictEqual(Pin.quickItem("expense", "route66 home", base), null, "a number inside a word isn't an amount");
});

test("a task goes to the picked list, or to a new Inbox when there's none", () => {
  assert.deepStrictEqual(Pin.quickItem("task", "Bins", { ...base, listId: "L", lists: [{ id: "L" }] }), [{ kind: "item", id: "q1", at: base.now, list: "L", text: "Bins" }]);
  const made = Pin.quickItem("task", "Bins", { ...base, listId: "gone", lists: [] });
  assert.deepStrictEqual(made.map((x) => x.kind), ["list", "item"]);
  assert.strictEqual(made[1].list, made[0].id);
  assert.strictEqual(made[0].text, "Inbox");
});

test("an entry is finished today; a note's first line is its title when there are more", () => {
  assert.deepStrictEqual(Pin.quickItem("entry", "Hades", base), [{ kind: "entry", id: "q1", at: base.now, date: "2026-11-19", title: "Hades" }]);
  assert.deepStrictEqual(Pin.quickItem("note", "one line", base), [{ kind: "note", id: "q1", at: base.now, text: "one line" }]);
  assert.deepStrictEqual(Pin.quickItem("note", "Title\nbody", base), [{ kind: "note", id: "q1", at: base.now, title: "Title", text: "body" }]);
});

console.log(`\n${passed} test(s) passed.`);
