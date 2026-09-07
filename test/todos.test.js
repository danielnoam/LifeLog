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

const { sanitizeTodo, getFilteredTodos, byOldest, byNewestDone } = Todos;

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
