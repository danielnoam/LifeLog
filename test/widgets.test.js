// Zero-dependency tests for src/widgets.js's pure half — `node test/widgets.test.js`.
//
// The widgets are native and can't be run here, but what they are shown and
// what their ticks do to your data are decided in JavaScript, and those are
// the two ways they could quietly be wrong.
const assert = require("assert");
global.window = {};
require("../src/widgets.js");
const W = global.window.LifeLogWidgets;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

const TODAY = "2026-09-24";
const data = () => ({
  habits: [
    { id: "h2", name: "Run", order: 1, target: 1, cadence: { days: [2, 4] }, startedAt: "2026-01-01", marks: { "2026-01-05": 1, "2026-09-23": 1 } },
    { id: "h1", name: "Read", order: 0, target: 3, cadence: "daily", startedAt: "2026-01-01", marks: { [TODAY]: 2 } },
    { id: "h3", name: "Old", order: 2, archivedAt: "2026-05-01", marks: {} },
  ],
  todos: [
    { id: "t1", text: "Milk", category: "Errands", order: 0 },
    { id: "t2", text: "Call mum", order: 1 },
    { id: "t3", text: "Done already", done: true, doneAt: "2026-09-20T00:00:00.000Z", order: 2 },
    { id: "t4", text: "Taxes", category: "Work", order: 0 },
    { id: "t5", text: "Bread", category: "Errands", order: -1 },
    { id: "t6", text: "Orphan", category: "Gone", order: 0 },
  ],
  todoCategories: [{ name: "Work", color: "#ff0000" }, { name: "Errands", color: "#00ff00" }],
});

console.log("\nwhat the widgets are shown");

test("habits in the app's order, archived ones left out", () => {
  const s = W.snapshotOf(data(), { today: TODAY });
  assert.deepStrictEqual(s.habits.map((h) => h.id), ["h1", "h2"]);
});

test("each habit carries what the widget needs to work out today by itself", () => {
  const [read, run] = W.snapshotOf(data(), { today: TODAY }).habits;
  assert.strictEqual(read.days, null, "daily is every day");
  assert.deepStrictEqual(run.days, [2, 4]);
  assert.strictEqual(read.target, 3);
  assert.strictEqual(run.startedAt, "2026-01-01");
});

test("only the last week of marks, not a habit's whole history", () => {
  const [read, run] = W.snapshotOf(data(), { today: TODAY }).habits;
  assert.deepStrictEqual(read.marks, { [TODAY]: 2 });
  assert.deepStrictEqual(run.marks, { "2026-09-23": 1 });
});

test("open to-dos in the to-do view's panel order, done ones left out", () => {
  const s = W.snapshotOf(data(), { today: TODAY });
  // General first, then the categories in their list's order, then one a
  // to-do names that the list has lost; hand order inside each.
  assert.deepStrictEqual(s.todos.map((t) => t.id), ["t2", "t4", "t5", "t1", "t6"]);
});

test("a categorised to-do brings its category's colour", () => {
  const s = W.snapshotOf(data(), { today: TODAY });
  assert.strictEqual(s.todos.find((t) => t.id === "t4").color, "#ff0000");
  // An empty string, never null: Android's org.json reads a null as "null".
  assert.strictEqual(s.todos.find((t) => t.id === "t2").color, "");
  assert.strictEqual(s.todos.find((t) => t.id === "t2").category, "");
});

test("the quick-add buttons are passed through as given", () => {
  assert.deepStrictEqual(W.snapshotOf(data(), { today: TODAY, actions: ["add-note"] }).actions, ["add-note"]);
});

test("a log with no habits or to-dos at all still makes a snapshot", () => {
  const s = W.snapshotOf({}, { today: TODAY });
  assert.deepStrictEqual([s.habits, s.todos], [[], []]);
});

console.log("\nticks coming back from a widget");

test("a habit tick sets that day's mark", () => {
  const d = data();
  assert.strictEqual(W.applyQueue(d, [{ kind: "habit", id: "h2", date: TODAY, value: 1 }]), 1);
  assert.strictEqual(d.habits[0].marks[TODAY], 1);
});

test("unticking removes the mark rather than storing a zero", () => {
  const d = data();
  W.applyQueue(d, [{ kind: "habit", id: "h1", date: TODAY, value: 0 }]);
  // Its only mark, so the map goes too — habits.js's own tick does the same.
  assert.ok(!("marks" in d.habits[1]), JSON.stringify(d.habits[1]));
});

test("a tick that changes nothing isn't counted, so no save is made for it", () => {
  const d = data();
  assert.strictEqual(W.applyQueue(d, [{ kind: "habit", id: "h1", date: TODAY, value: 2 }]), 0);
});

test("a to-do ticked on the widget is done as of when it was ticked", () => {
  const d = data();
  W.applyQueue(d, [{ kind: "todo", id: "t1", done: true, at: "2026-09-24T08:00:00.000Z" }]);
  const t = d.todos.find((x) => x.id === "t1");
  assert.strictEqual(t.done, true);
  assert.strictEqual(t.doneAt, "2026-09-24T08:00:00.000Z");
});

test("unticking a to-do clears it the way the app does", () => {
  const d = data();
  W.applyQueue(d, [{ kind: "todo", id: "t3", done: false }]);
  const t = d.todos.find((x) => x.id === "t3");
  assert.ok(!("done" in t) && !("doneAt" in t));
});

test("a tick for something deleted since is dropped, not recreated", () => {
  const d = data();
  const n = W.applyQueue(d, [
    { kind: "todo", id: "nope", done: true },
    { kind: "habit", id: "nope", date: TODAY, value: 1 },
    { kind: "habit", id: "h1", date: "not a date", value: 1 },
  ]);
  assert.strictEqual(n, 0);
  assert.strictEqual(d.todos.length, 6);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
