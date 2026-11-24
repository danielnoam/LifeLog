// Zero-dependency tests for src/tasks.js's data side — run with
// `node test/tasks.test.js`.
const assert = require("assert");
global.window = {};
const T = require("../src/tasks.js");
require("../src/notes.js");
const Notes = global.window.LifeLogNotes;
let idCounter = 0;
Notes.init({
  state: { data: { notes: [], settings: {} } },
  uid: () => "id-" + (idCounter++),
  backfillUpdatedAt: (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z",
  keepUnknown: (src, out, known) => { for (const k of Object.keys(src || {})) if (!known.has(k)) out[k] = src[k]; return out; },
});

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error(e); process.exitCode = 1; }
}
const list = (items) => ({ id: "L", kind: "list", text: "Trip", items });

test("a plain item stays exactly as it was", () => {
  const n = Notes.sanitizeNote(list([{ id: "a", text: "Milk" }, { id: "b", text: "Eggs", done: true, doneAt: "2026-11-01T00:00:00.000Z" }]));
  assert.deepStrictEqual(n.items, [{ id: "a", text: "Milk" }, { id: "b", text: "Eggs", done: true, doneAt: "2026-11-01T00:00:00.000Z" }]);
});
test("task fields are kept and checked", () => {
  const n = Notes.sanitizeNote(list([{ id: "a", text: "Book", note: "Lake site", priority: "1", date: "2026-11-20", time: "18:00",
    repeat: { every: 2, unit: "week", days: [5, 1, 1, 9] }, remind: 30, deadline: "2026-12-01", category: " Travel " }]));
  assert.deepStrictEqual(n.items[0], { id: "a", text: "Book", note: "Lake site", priority: 1, date: "2026-11-20", time: "18:00",
    repeat: { every: 2, unit: "week", days: [1, 5] }, remind: 30, deadline: "2026-12-01", category: "Travel" });
});
test("what doesn't hold up is dropped", () => {
  const n = Notes.sanitizeNote(list([{ id: "a", text: "x", priority: 7, date: "2026-13-40", time: "18:00", repeat: { unit: "day" }, remind: 5, note: "  " }]));
  assert.deepStrictEqual(n.items[0], { id: "a", text: "x" });
});
test("rows are the list's subtasks: 0.317.0's nested ones come back to the list, in place", () => {
  const n = Notes.sanitizeNote(list([{ id: "a", text: "A" }, { id: "b", text: "B", parent: "a" }, { id: "c", text: "C", parent: "b" }, { id: "d", text: "D", parent: "gone" }]));
  assert.deepStrictEqual(n.items.map((i) => i.id + (i.parent || "")), ["a", "b", "c", "d"]);
});
test("the list itself is a task: its fields are cleaned like a row's", () => {
  const n = Notes.sanitizeNote({ ...list([{ id: "a", text: "A" }]), note: "Car booked", priority: 1, date: "2026-11-21", time: "10:00", repeat: { every: 1, unit: "week" }, remind: 60, deadline: "nope", done: "yes" });
  assert.strictEqual(n.note, "Car booked");
  assert.strictEqual(n.priority, 1);
  assert.strictEqual(n.date, "2026-11-21");
  assert.deepStrictEqual(n.repeat, { every: 1, unit: "week" });
  assert.strictEqual(n.remind, 60);
  assert.strictEqual(n.deadline, undefined);
  assert.strictEqual(n.done, true);
  assert.strictEqual(Notes.sanitizeNote({ text: "plain", date: "2026-11-21" }).date, "2026-11-21", "a plain note keeps it as an unknown field");
});
test("ticking the list ticks its rows; a repeating list moves on and unticks them", () => {
  const n = { id: "L", kind: "list", text: "Trip", items: [{ id: "a", text: "A" }, { id: "b", text: "B", done: true }] };
  T.tick(n, "L", true, new Date("2026-11-15T12:00:00"), "2026-11-15");
  assert.ok(n.done && n.items.every((i) => i.done));
  const w = { id: "W", kind: "list", text: "Weekly", date: "2026-11-15", repeat: { every: 1, unit: "week" }, items: [{ id: "a", text: "A", done: true }] };
  const r = T.tick(w, "W", true, new Date("2026-11-15T12:00:00"), "2026-11-15");
  assert.strictEqual(r.next, "2026-11-22");
  assert.ok(!w.done && !w.items[0].done && w.ticks.length === 1);
});
test("a dated list is one row in what's due, with the note as its item", () => {
  const n = { id: "L", kind: "list", text: "Trip", date: "2026-11-16", items: [{ id: "a", text: "A", date: "2026-11-17" }] };
  const rows = T.dueTasks({ notes: [n] }, "2026-11-30");
  assert.deepStrictEqual(rows.map((r) => r.item.id), ["L", "a"]);
  assert.strictEqual(rows[0].item.text, "Trip");
});
test("search finds a task's description", () => {
  const n = Notes.sanitizeNote(list([{ id: "a", text: "Book", note: "plate number" }]));
  assert.ok(Notes.noteHaystack(n).includes("plate number"));
});

test("next date: every day, from its date, skipping missed ones", () => {
  assert.strictEqual(T.nextDate({ date: "2026-11-15", repeat: { every: 1, unit: "day" } }, "2026-11-15"), "2026-11-16");
  assert.strictEqual(T.nextDate({ date: "2026-11-10", repeat: { every: 3, unit: "day" } }, "2026-11-15"), "2026-11-16");
});
test("next date: from when it's ticked", () => {
  assert.strictEqual(T.nextDate({ date: "2026-11-10", repeat: { every: 3, unit: "day", fromDone: true } }, "2026-11-15"), "2026-11-18");
});
test("next date: a month on keeps the 31st", () => {
  assert.strictEqual(T.nextDate({ date: "2026-01-31", repeat: { every: 1, unit: "month" } }, "2026-01-31"), "2026-02-28");
  assert.strictEqual(T.nextDate({ date: "2026-10-31", repeat: { every: 1, unit: "month" } }, "2026-10-31"), "2026-11-30");
  assert.strictEqual(T.nextDate({ date: "2026-11-15", repeat: { every: 1, unit: "year" } }, "2026-11-15"), "2027-11-15");
});
test("next date: weekdays", () => {
  // Friday 20 Nov 2026 → Monday 23 Nov (week starts Sunday by default).
  assert.strictEqual(T.nextDate({ date: "2026-11-20", repeat: { every: 1, unit: "week", days: [1, 2, 3, 4, 5] } }, "2026-11-20"), "2026-11-23");
  // Every 2 weeks on Monday: Mon 16 → Mon 30.
  assert.strictEqual(T.nextDate({ date: "2026-11-16", repeat: { every: 2, unit: "week", days: [1] } }, "2026-11-16"), "2026-11-30");
  // Every 2 weeks on Mon and Wed: Mon 16 → Wed 18 (same week).
  assert.strictEqual(T.nextDate({ date: "2026-11-16", repeat: { every: 2, unit: "week", days: [1, 3] } }, "2026-11-16"), "2026-11-18");
});

test("ticking a task ticks its open subtasks", () => {
  const n = list([{ id: "a", text: "A" }, { id: "b", text: "B", parent: "a" }, { id: "c", text: "C", parent: "a", done: true, doneAt: "x" }]);
  T.tick(n, "a", true, new Date("2026-11-15T10:00:00Z"));
  assert.deepStrictEqual(n.items.map((i) => [i.done, i.doneAt]), [[true, "2026-11-15T10:00:00.000Z"], [true, "2026-11-15T10:00:00.000Z"], [true, "x"]]);
});
test("ticking a repeating task moves it on, keeps the tick, unticks its subtasks", () => {
  const n = list([{ id: "a", text: "Water", date: "2026-11-15", deadline: "2026-11-16", repeat: { every: 3, unit: "day" } }, { id: "b", text: "B", parent: "a", done: true, doneAt: "x" }]);
  const r = T.tick(n, "a", true, new Date(2026, 10, 15, 12), "2026-11-15");
  assert.strictEqual(r.next, "2026-11-18");
  assert.strictEqual(n.items[0].done, undefined);
  assert.strictEqual(n.items[0].date, "2026-11-18");
  assert.strictEqual(n.items[0].deadline, "2026-11-19");
  assert.strictEqual(n.items[0].ticks.length, 1);
  assert.strictEqual(n.items[1].done, undefined);
});
test("unticking clears done", () => {
  const n = list([{ id: "a", text: "A", done: true, doneAt: "x" }]);
  T.tick(n, "a", false);
  assert.deepStrictEqual(n.items[0], { id: "a", text: "A" });
});

test("due tasks: open, dated, up to a day, with the category they show", () => {
  const data = { notes: [
    { id: "L", kind: "list", text: "Trip", category: "Travel", items: [
      { id: "a", text: "A", date: "2026-11-14" }, { id: "b", text: "B", date: "2026-11-30" }, { id: "c", text: "C", date: "2026-11-15", done: true },
      { id: "d", text: "D" }, { id: "e", text: "E", date: "2026-11-15", category: "Work" }, { id: "f", text: "F", parent: "e", date: "2026-11-16" }] },
    { id: "N", text: "plain" }] };
  const rows = T.dueTasks(data, "2026-11-20");
  assert.deepStrictEqual(rows.map((r) => [r.item.id, r.category]), [["a", "Travel"], ["e", "Work"], ["f", "Work"]]);
});
test("a reminder rings before its time, or 09:00 for an all-day task", () => {
  assert.strictEqual(T.remindAt({ date: "2026-11-15", time: "18:00", remind: 30 }).getTime(), new Date(2026, 10, 15, 17, 30).getTime());
  assert.strictEqual(T.remindAt({ date: "2026-11-15", remind: 1440 }).getTime(), new Date(2026, 10, 14, 9, 0).getTime());
  assert.strictEqual(T.remindAt({ date: "2026-11-15" }), null);
});
test("copy text indents subtasks and brackets dates", () => {
  const lines = T.listLines([{ id: "a", text: "A", date: "2026-11-15", time: "18:00" }, { id: "b", text: "B", parent: "a", done: true }, { id: "c", text: "C" }], "2026-11-15");
  assert.deepStrictEqual(lines, ["- [ ] A (Today 18:00)", "  - [x] B", "- [ ] C"]);
});
test("words: repeat and reminder", () => {
  assert.strictEqual(T.repeatText({ every: 1, unit: "week", days: [1, 2, 3, 4, 5] }), "Every weekday");
  assert.strictEqual(T.repeatText({ every: 3, unit: "day", fromDone: true }), "Every 3 days, from when ticked");
  assert.strictEqual(T.remindText({ time: "18:00", remind: 30 }), "30 min before");
  assert.strictEqual(T.remindText({ remind: 1440 }), "The day before");
});

test("a ticked list gets unticked when a row is unticked", () => {
  const n = { id: "L", kind: "list", done: true, doneAt: "2026-11-15T10:00:00.000Z", items: [{ id: "a", text: "A", done: true, doneAt: "x" }] };
  T.tick(n, "a", false);
  assert.ok(!n.done && !n.doneAt && !n.items[0].done);
  assert.deepStrictEqual(T.reopen({ id: "M" }), { id: "M" });
});

test("a pasted list: one task per line, bullets and numbers off, blanks skipped", () => {
  const got = T.pastedLines("- Milk\r\n\n* Eggs\n1. Bread\n2) Jam\n• Tea\n  ✓ Rice\n-5 degrees\n1.5kg flour\n   \n");
  assert.deepStrictEqual(got.map((l) => l.text), ["Milk", "Eggs", "Bread", "Jam", "Tea", "Rice", "-5 degrees", "1.5kg flour"]);
  assert.ok(got.every((l) => !l.done));
});
test("a pasted checklist keeps what was ticked", () => {
  assert.deepStrictEqual(T.pastedLines("- [ ] A\n- [x] B\n[X] C\n☐ D\n☑ E\n☒ F"),
    [{ text: "A" }, { text: "B", done: true }, { text: "C", done: true }, { text: "D" }, { text: "E", done: true }, { text: "F", done: true }]);
});
test("a pasted Hebrew list, with direction marks", () => {
  assert.deepStrictEqual(T.pastedLines("\u200f- חלב\n\u200f2. ביצים\nלחם").map((l) => l.text), ["חלב", "ביצים", "לחם"]);
  assert.strictEqual(T.pastedLines("just one line").length, 1);
  assert.deepStrictEqual(T.pastedLines(""), []);
});

console.log(`\n${passed} test(s) passed.`);
