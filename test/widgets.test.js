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
  // The widget's to-dos are list notes' items since 0.197.0.
  notes: [
    { id: "Lg", kind: "list", text: "To-do", createdAt: "2026-01-01", items: [
      { id: "t2", text: "Call mum" }, { id: "t3", text: "Done already", done: true, doneAt: "2026-09-20T00:00:00.000Z" }] },
    { id: "Lw", kind: "list", text: "Work", category: "Work", createdAt: "2026-01-02", items: [{ id: "t4", text: "Taxes" }] },
    { id: "Le", kind: "list", text: "Errands", category: "Errands", createdAt: "2026-01-03", items: [
      { id: "t5", text: "Bread" }, { id: "t1", text: "Milk" }] },
    { id: "Lf", kind: "list", text: "Later", fav: true, createdAt: "2026-05-01", items: [{ id: "t6", text: "Someday" }] },
    { id: "N", text: "A plain note is no one's to-do" },
  ],
  noteCategories: [{ name: "Work", color: "#ff0000" }, { name: "Errands", color: "#00ff00" }],
});
const allItems = (d) => d.notes.flatMap((n) => n.items || []);

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

test("a panel per list: favourites first, then oldest first; each list's own order, finished at its foot", () => {
  const s = W.snapshotOf(data(), { today: TODAY });
  assert.deepStrictEqual(s.todos.map((t) => t.id), ["t6", "t2", "t3", "t4", "t5", "t1"]);
  assert.deepStrictEqual(s.todos.map((t) => t.category), ["Later", "To-do", "To-do", "Work", "Errands", "Errands"]);
  assert.deepStrictEqual(s.todos.filter((t) => t.done).map((t) => t.id), ["t3"]);
  assert.deepStrictEqual(s.doneCount, { "To-do": 1 });
});

test("two lists with one title stay two panels", () => {
  const d = data();
  d.notes.push({ id: "L2", kind: "list", text: "Work", createdAt: "2026-06-01", items: [{ id: "x", text: "Other work" }] });
  const s = W.snapshotOf(d, { today: TODAY });
  assert.deepStrictEqual([...new Set(s.todos.map((t) => t.category))], ["Later", "To-do", "Work", "Errands", "Work (2)"]);
});

test("finished ones newest first, as the panel shows them, and only the latest few", () => {
  const items = [];
  for (let i = 0; i < W.DONE_PER_PANEL + 5; i++) {
    items.push({ id: "d" + i, text: "x", done: true, doneAt: "2026-09-" + String(1 + (i % 28)).padStart(2, "0") + "T00:00:" + String(i % 60).padStart(2, "0") + ".000Z" });
  }
  items.push({ id: "newest", text: "y", done: true, doneAt: "2026-09-30T00:00:00.000Z" });
  const s = W.snapshotOf({ notes: [{ id: "L", kind: "list", text: "Done pile", items }] }, { today: TODAY });
  assert.strictEqual(s.todos[0].id, "newest");
  assert.strictEqual(s.todos.length, W.DONE_PER_PANEL);
  // The line under the list still counts every one of them.
  assert.strictEqual(s.doneCount["Done pile"], W.DONE_PER_PANEL + 6);
});

test("a list in a category brings the category's colour", () => {
  const s = W.snapshotOf(data(), { today: TODAY });
  assert.strictEqual(s.todos.find((t) => t.id === "t4").color, "#ff0000");
  // An empty string, never null: Android's org.json reads a null as "null".
  assert.strictEqual(s.todos.find((t) => t.id === "t2").color, "");
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
  const t = allItems(d).find((x) => x.id === "t1");
  assert.strictEqual(t.done, true);
  assert.strictEqual(t.doneAt, "2026-09-24T08:00:00.000Z");
});

test("unticking a to-do clears it the way the app does", () => {
  const d = data();
  W.applyQueue(d, [{ kind: "todo", id: "t3", done: false }]);
  const t = allItems(d).find((x) => x.id === "t3");
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
  assert.strictEqual(allItems(d).length, 6);
});

console.log("\nwhat the note widgets are shown");

test("every kind of note, a list as its title and open items, with its category's colour", () => {
  const snap = W.snapshotOf(data(), { today: TODAY });
  const byId = Object.fromEntries(snap.notes.map((n) => [n.id, n]));
  assert.deepStrictEqual(byId.Lg.items, ["Call mum"]);
  assert.strictEqual(byId.Lg.open, 1);
  assert.strictEqual(byId.Lw.color, "#ff0000");
  assert.strictEqual(byId.N.kind, "text");
  assert.strictEqual(snap.noteCount, 5);
  assert.deepStrictEqual(snap.noteCats.map((c) => c.name), ["Work", "Errands"]);
});

test("the to-do widget is told every list, empty ones too, and each row its list", () => {
  const d = data();
  d.notes.push({ id: "Lx", kind: "list", text: "Nothing yet", createdAt: "2026-06-01", items: [] });
  const snap = W.snapshotOf(d, { today: TODAY });
  assert.deepStrictEqual(snap.lists.map((l) => l.id), ["Lf", "Lg", "Lw", "Le", "Lx"]);
  assert.strictEqual(snap.lists.find((l) => l.id === "Lw").color, "#ff0000");
  assert.ok(snap.todos.every((t) => t.list && snap.lists.some((l) => l.id === t.list && l.name === t.category)));
});

test("a plain note's title travels with it", () => {
  const d = data();
  d.notes.push({ id: "T", title: "Idea", text: "", createdAt: "2026-09-01" });
  assert.strictEqual(W.snapshotOf(d, { today: TODAY }).notes.find((n) => n.id === "T").title, "Idea");
});

test("a long note is cut to what a widget can show", () => {
  const d = data();
  d.notes.push({ id: "long", text: "x".repeat(5000), createdAt: "2026-09-01" });
  const n = W.snapshotOf(d, { today: TODAY }).notes.find((x) => x.id === "long");
  assert.strictEqual(n.text.length, W.NOTE_CHARS);
  assert.ok(n.text.endsWith("…"));
});

test("past the budget the oldest go first, but a pinned note always travels", () => {
  const d = { notes: [] };
  for (let i = 0; i < 1000; i++) d.notes.push({ id: "n" + i, text: "y".repeat(300), createdAt: "2020-01-01T00:00:" + String(i % 60).padStart(2, "0") + "Z" });
  d.notes.push({ id: "old", text: "the pinned one", createdAt: "2001-01-01" });
  const plain = W.snapshotOf(d, { today: TODAY });
  assert.ok(plain.notes.length < d.notes.length && !plain.notes.some((n) => n.id === "old"));
  assert.ok(JSON.stringify(plain.notes).length <= W.NOTES_BUDGET + 500);
  const pinned = W.snapshotOf(d, { today: TODAY, pins: ["old"] });
  assert.strictEqual(pinned.notes[0].id, "old");
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
