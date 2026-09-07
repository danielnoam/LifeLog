// Zero-dependency tests for src/todos.js's pure data logic — run with
// `node test/todos.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern.
const assert = require("assert");
global.window = {};
require("../src/todos.js");
const Todos = global.window.LifeLogTodos;

let idCounter = 0;
const state = { data: { todos: [] }, search: "" };
Todos.init({
  state,
  uid: () => "test-id-" + (idCounter++),
  backfillUpdatedAt: (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z",
  keepUnknown: (src, out, known) => {
    for (const key of Object.keys(src || {})) if (!known.has(key)) out[key] = src[key];
    return out;
  },
});

const { sanitizeTodo, assignMissingOrder, getFilteredTodos, byOldest, byNewestDone, byOrder } = Todos;

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

// ---------- sanitizeTodo ----------
test("sanitizeTodo assigns an id and trims the text", () => {
  const out = sanitizeTodo({ text: "  buy milk  " });
  assert.ok(out.id);
  assert.strictEqual(out.text, "buy milk");
});

test("an unticked to-do carries no done or doneAt at all", () => {
  const out = sanitizeTodo({ text: "x" });
  assert.strictEqual("done" in out, false);
  assert.strictEqual("doneAt" in out, false);
  // Explicitly false is the same as absent, like every other flag here.
  assert.strictEqual("done" in sanitizeTodo({ text: "x", done: false }), false);
});

test("a ticked to-do keeps the moment it was ticked", () => {
  const out = sanitizeTodo({ text: "x", done: true, doneAt: "2026-09-07T10:00:00.000Z" });
  assert.strictEqual(out.done, true);
  assert.strictEqual(out.doneAt, "2026-09-07T10:00:00.000Z");
});

test("a ticked to-do with no doneAt falls back to its stamp rather than sorting nowhere", () => {
  // Ticked by a hand edit, or by a build from before doneAt existed.
  const out = sanitizeTodo({ text: "x", done: true, updatedAt: "2026-05-05T10:00:00.000Z" });
  assert.strictEqual(out.doneAt, "2026-05-05T10:00:00.000Z");
});

test("sanitizeTodo carries through a field it doesn't know about", () => {
  assert.strictEqual(sanitizeTodo({ text: "x", shippedLater: 7 }).shippedLater, 7);
});

// ---------- ordering ----------
test("the To do panel runs oldest first, so the list doesn't reshuffle as you add", () => {
  const rows = [
    { id: "b", createdAt: "2026-09-02T10:00:00.000Z" },
    { id: "a", createdAt: "2026-09-01T10:00:00.000Z" },
    { id: "c", createdAt: "2026-09-03T10:00:00.000Z" },
  ];
  assert.deepStrictEqual(rows.sort(byOldest).map((t) => t.id), ["a", "b", "c"]);
});

test("the Done panel puts what you just ticked at the top", () => {
  const rows = [
    { id: "old", doneAt: "2026-09-01T10:00:00.000Z" },
    { id: "new", doneAt: "2026-09-05T10:00:00.000Z" },
  ];
  assert.deepStrictEqual(rows.sort(byNewestDone).map((t) => t.id), ["new", "old"]);
});

test("Done sorts by when it was ticked, not when it was written", () => {
  // The distinction doneAt exists for: a to-do written first can easily be
  // finished last.
  const rows = [
    { id: "written-first", createdAt: "2026-01-01T10:00:00.000Z", doneAt: "2026-09-09T10:00:00.000Z" },
    { id: "written-later", createdAt: "2026-08-01T10:00:00.000Z", doneAt: "2026-09-01T10:00:00.000Z" },
  ];
  assert.deepStrictEqual(rows.sort(byNewestDone).map((t) => t.id), ["written-first", "written-later"]);
});

// ---------- hand-ordering ----------
test("sanitizeTodo keeps a numeric order and ignores a junk one", () => {
  assert.strictEqual(sanitizeTodo({ text: "x", order: 3 }).order, 3);
  assert.strictEqual(sanitizeTodo({ text: "x", order: "2" }).order, 2);
  assert.strictEqual(sanitizeTodo({ text: "x", order: 0 }).order, 0, "zero is a real position");
  assert.strictEqual("order" in sanitizeTodo({ text: "x", order: "banana" }), false);
  assert.strictEqual("order" in sanitizeTodo({ text: "x" }), false);
});

test("byOrder sorts by hand order, falling back to when it was written", () => {
  const rows = [
    { id: "c", order: 2, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "a", order: 0, createdAt: "2026-03-01T00:00:00.000Z" },
    { id: "b", order: 1, createdAt: "2026-02-01T00:00:00.000Z" },
  ];
  assert.deepStrictEqual(rows.sort(byOrder).map((t) => t.id), ["a", "b", "c"]);
  // Same order value: oldest wins, so the sort is still total.
  const tied = [
    { id: "later", order: 1, createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "earlier", order: 1, createdAt: "2026-04-01T00:00:00.000Z" },
  ];
  assert.deepStrictEqual(tied.sort(byOrder).map((t) => t.id), ["earlier", "later"]);
});

test("assignMissingOrder numbers old data by when it was written", () => {
  // The order it was already being shown in, so nothing appears to move the
  // first time a device opens the list after the field existed.
  const list = [
    { id: "b", createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "c", createdAt: "2026-03-01T00:00:00.000Z" },
  ];
  assignMissingOrder(list);
  assert.deepStrictEqual(list.map((t) => [t.id, t.order]), [["b", 1], ["a", 0], ["c", 2]]);
});

test("assignMissingOrder is deterministic, so two devices can't disagree", () => {
  // It runs in normalize on every device independently; if it weren't a pure
  // function of the data it would manufacture sync conflicts out of nothing.
  const seed = () => [
    { id: "b", createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
  ];
  const one = assignMissingOrder(seed()), two = assignMissingOrder(seed().reverse());
  const orderOf = (list, id) => list.find((t) => t.id === id).order;
  assert.strictEqual(orderOf(one, "a"), orderOf(two, "a"));
  assert.strictEqual(orderOf(one, "b"), orderOf(two, "b"));
});

test("assignMissingOrder leaves an already-ordered list completely alone", () => {
  const list = [{ id: "a", order: 5 }, { id: "b", order: 2 }];
  assignMissingOrder(list);
  assert.deepStrictEqual(list.map((t) => t.order), [5, 2]);
});

// ---------- filtering ----------
test("search matches the text, and nothing else narrows a checklist", () => {
  state.data.todos = [
    { id: "a", text: "Renew passport" },
    { id: "b", text: "Buy milk", done: true },
  ];
  state.search = "";
  assert.strictEqual(getFilteredTodos().length, 2, "no search shows both panels' worth");
  state.search = "PASS";
  assert.deepStrictEqual(getFilteredTodos().map((t) => t.id), ["a"]);
  // A done to-do is still findable — it's in the Done panel, not gone.
  state.search = "milk";
  assert.deepStrictEqual(getFilteredTodos().map((t) => t.id), ["b"]);
});

console.log(`\n${passed} test(s) passed.`);
