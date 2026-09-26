// Zero-dependency tests for src/notes.js's pure data logic — run with
// `node test/notes.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern.
const assert = require("assert");
global.window = {};
require("../src/notes.js");
const Notes = global.window.LifeLogNotes;

let idCounter = 0;
const state = { data: { notes: [], settings: {} }, search: "", activeYears: new Set(), noteActiveCats: new Set(), noteKind: "" };
Notes.init({
  state,
  uid: () => "test-id-" + (idCounter++),
  backfillUpdatedAt: (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z",
  keepUnknown: (src, out, known) => {
    for (const key of Object.keys(src || {})) if (!known.has(key)) out[key] = src[key];
    return out;
  },
});

const { sanitizeNote, noteYear, noteYears, getFilteredNotes } = Notes;

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

// ---------- sanitizeNote ----------
test("sanitizeNote assigns an id and keeps the text as written", () => {
  const out = sanitizeNote({ text: "  spaces kept  \n\nand blank lines" });
  assert.ok(out.id);
  assert.strictEqual(out.text, "  spaces kept  \n\nand blank lines");
});

test("sanitizeNote drops editedAt until there has actually been an edit", () => {
  assert.strictEqual("editedAt" in sanitizeNote({ text: "x" }), false);
  assert.strictEqual(sanitizeNote({ text: "x", editedAt: "2026-09-06T10:00:00.000Z" }).editedAt,
    "2026-09-06T10:00:00.000Z");
});

test("sanitizeNote coerces a non-string body instead of throwing on it", () => {
  // A hand-edited file or a bad import can hand over anything; the render
  // path treats text as a string unconditionally.
  assert.strictEqual(sanitizeNote({ text: 42 }).text, "42");
  assert.strictEqual(sanitizeNote({}).text, "");
});

test("sanitizeNote carries through a field it doesn't know about", () => {
  // Same forward-compatibility contract as every other collection: a build
  // older than the data must not delete a field newer than itself.
  assert.strictEqual(sanitizeNote({ text: "x", shippedLater: 7 }).shippedLater, 7);
});

// ---------- dates ----------
test("a note is filed under the year it was written", () => {
  assert.strictEqual(noteYear({ createdAt: "2026-09-06T10:00:00.000Z" }), 2026);
});

test("a note with no createdAt falls back to its sync stamp rather than vanishing", () => {
  // Hand-edited JSON or a bad import. It has to land somewhere.
  assert.strictEqual(noteYear({ updatedAt: "2024-03-01T10:00:00.000Z" }), 2024);
  assert.strictEqual(noteYear({}), new Date(0).getFullYear());
});

test("an unparseable date doesn't take the whole feed down", () => {
  assert.strictEqual(noteYear({ createdAt: "not a date" }), new Date(0).getFullYear());
});

// ---------- filtering ----------
const seed = () => {
  state.data.notes = [
    { id: "a", text: "Bought a keyboard", createdAt: "2026-09-06T10:00:00.000Z" },
    { id: "b", text: "Finished Silksong", createdAt: "2026-01-02T10:00:00.000Z" },
    { id: "c", text: "keyboard broke", createdAt: "2025-05-05T10:00:00.000Z" },
  ];
  state.search = "";
  state.activeYears = new Set();
};

test("noteYears lists the years notes fall in, newest first", () => {
  seed();
  assert.deepStrictEqual(noteYears(), [2026, 2025]);
});

test("search matches the note body, case-insensitively", () => {
  seed();
  state.search = "KEYBOARD";
  assert.deepStrictEqual(getFilteredNotes().map((n) => n.id), ["a", "c"]);
});

test("the year chips narrow the feed", () => {
  seed();
  state.activeYears = new Set([2025]);
  assert.deepStrictEqual(getFilteredNotes().map((n) => n.id), ["c"]);
});

test("year and search narrow together, not separately", () => {
  seed();
  state.activeYears = new Set([2026]);
  state.search = "keyboard";
  assert.deepStrictEqual(getFilteredNotes().map((n) => n.id), ["a"]);
});

test("a plain note keeps a title, and search finds it; other kinds don't carry one", () => {
  assert.strictEqual(sanitizeNote({ text: "body", title: "  Idea  " }).title, "Idea");
  assert.strictEqual("title" in sanitizeNote({ text: "body", title: "  " }), false);
  assert.strictEqual("title" in sanitizeNote({ kind: "quote", text: "q", title: "T" }), false);
  assert.ok(Notes.noteHaystack({ title: "Groceries idea", text: "x" }).includes("groceries"));
});

test("Open shows only the lists with something left to tick", () => {
  seed();
  state.data.notes.push(
    { id: "l1", kind: "list", text: "Shop", createdAt: "2026-09-01T10:00:00.000Z", items: [{ id: "i1", text: "Milk" }, { id: "i2", text: "Eggs", done: true }] },
    { id: "l2", kind: "list", text: "Done", createdAt: "2026-09-01T10:00:00.000Z", items: [{ id: "i3", text: "All", done: true }] },
    { id: "l3", kind: "list", text: "Empty", createdAt: "2026-09-01T10:00:00.000Z", items: [] });
  state.noteKind = "open";
  assert.deepStrictEqual(getFilteredNotes().map((n) => n.id), ["l1"]);
  state.search = "eggs"; // a finished item still finds its list
  assert.deepStrictEqual(getFilteredNotes().map((n) => n.id), ["l1"]);
  state.noteKind = "";
});

console.log("\nsplitNoteForEntry");

const { splitNoteForEntry } = Notes;

test("a one-line note is all title, and leaves the entry's notes empty", () => {
  // The duplication case: repeating the title in the notes field would be
  // the obvious implementation and the wrong one.
  assert.deepStrictEqual(splitNoteForEntry("Finished Silksong"), { title: "Finished Silksong", notes: "" });
});

test("the first line titles it and the rest becomes the notes", () => {
  const r = splitNoteForEntry("Finished Silksong\nHarder than Hollow Knight, and better for it.");
  assert.strictEqual(r.title, "Finished Silksong");
  assert.strictEqual(r.notes, "Harder than Hollow Knight, and better for it.");
});

test("blank lines between the two are not carried into the notes", () => {
  const r = splitNoteForEntry("Finished Silksong\n\n\nWorth it.");
  assert.strictEqual(r.title, "Finished Silksong");
  assert.strictEqual(r.notes, "Worth it.");
});

test("line breaks inside the body survive", () => {
  const r = splitNoteForEntry("Trip\nDay one: rain.\nDay two: less rain.");
  assert.strictEqual(r.notes, "Day one: rain.\nDay two: less rain.");
});

test("surrounding whitespace is trimmed off both halves", () => {
  const r = splitNoteForEntry("   Finished Silksong   \n   Worth it.   ");
  assert.strictEqual(r.title, "Finished Silksong");
  assert.strictEqual(r.notes, "Worth it.");
});

test("an over-long first line is cut for the title but kept whole in the notes", () => {
  // Nothing you wrote may be lost on the way across, so the full line lands
  // in the notes when the title can't hold it.
  const long = "x".repeat(200);
  const r = splitNoteForEntry(long);
  assert.strictEqual(r.title.length, 80);
  assert.ok(r.notes.startsWith(long), "the whole first line is still there");
});

test("an over-long first line keeps the body under it too", () => {
  const long = "y".repeat(120);
  const r = splitNoteForEntry(long + "\nthe rest");
  assert.strictEqual(r.title, "y".repeat(80));
  assert.strictEqual(r.notes, long + "\n\nthe rest");
});

test("a title cut mid-way does not end on a space", () => {
  const r = splitNoteForEntry("word ".repeat(40));
  assert.strictEqual(r.title, r.title.trimEnd());
});

test("an empty or junk note does not throw", () => {
  assert.deepStrictEqual(splitNoteForEntry(""), { title: "", notes: "" });
  assert.deepStrictEqual(splitNoteForEntry(null), { title: "", notes: "" });
  assert.deepStrictEqual(splitNoteForEntry(undefined), { title: "", notes: "" });
});

// ---------- kinds and categories (0.195.0) ----------
const { sanitizeNote: sn } = Notes;
test("a note with no kind stays a plain note, with nothing added to it", () => {
  const n = sn({ id: "n1", text: "hi", createdAt: "2026-01-01T00:00:00.000Z" });
  assert.deepStrictEqual(Object.keys(n).sort(), ["createdAt", "id", "text", "updatedAt"]);
});
test("a list keeps its items with ids, drops empty ones, and a tick keeps when it happened", () => {
  const n = sn({ text: "Packing", kind: "list", items: [{ text: " Passport " }, { text: "" }, { id: "x", text: "Charger", done: true, doneAt: "2026-02-01" }] });
  assert.strictEqual(n.kind, "list");
  assert.deepStrictEqual(n.items.map((i) => i.text), ["Passport", "Charger"]);
  assert.ok(n.items[0].id, "every item gets an id, so two devices ticking different ones can merge");
  assert.deepStrictEqual([n.items[1].done, n.items[1].doneAt], [true, "2026-02-01"]);
});
test("a quote keeps its author and source; other kinds don't carry them", () => {
  const q = sn({ text: "Words", kind: "quote", author: " Frost ", source: "" });
  assert.deepStrictEqual([q.author, "source" in q], ["Frost", false]);
  const t = sn({ text: "Plain", author: "Nobody", items: [{ text: "x" }] });
  assert.ok(!("author" in t) && !("items" in t) && !("kind" in t));
});
test("a category is kept trimmed, and an empty one is no category", () => {
  assert.strictEqual(sn({ text: "a", category: " Trip " }).category, "Trip");
  assert.ok(!("category" in sn({ text: "a", category: "  " })));
});
test("an unknown kind falls back to a plain note rather than losing the text", () => {
  const n = sn({ text: "future", kind: "drawing" });
  assert.ok(!("kind" in n) && n.text === "future");
});

test("a favourite is kept as true, and a note that isn't carries nothing", () => {
  assert.strictEqual(sn({ text: "a", fav: "yes" }).fav, true);
  assert.ok(!("fav" in sn({ text: "a", fav: false })));
});

// ---------- the To-do mode's lists become list notes (0.197.0) ----------
const fold = Notes.foldTodosIntoLists;
const todoData = () => ({
  notes: [],
  todoCategories: [{ id: "c-shop", name: "Shopping", color: "#f00" }],
  todos: [
    { id: "t1", text: "Milk", category: "Shopping", order: 2, createdAt: "2026-01-02" },
    { id: "t2", text: "Eggs", category: "Shopping", order: 1, createdAt: "2026-01-01" },
    { id: "t3", text: "Call mum", order: 0, createdAt: "2026-01-03" },
    { id: "t4", text: "Old thing", done: true, doneAt: "2026-01-05", createdAt: "2025-12-01" },
  ],
});
test("each to-do category becomes a list, the rest one \"To-do\" list, items in their order", () => {
  const d = todoData();
  assert.strictEqual(fold(d), true);
  assert.deepStrictEqual(d.todos, []);
  const shop = d.notes.find((n) => n.text === "Shopping"), gen = d.notes.find((n) => n.text === "To-do");
  assert.strictEqual(shop.id, "todos-c-shop", "the list's id comes from the category's");
  assert.deepStrictEqual(shop.items.map((i) => i.id), ["t2", "t1"], "hand order kept; each item keeps its to-do's id");
  assert.deepStrictEqual(gen.items.map((i) => [i.text, !!i.done]), [["Call mum", false], ["Old thing", true]]);
  assert.strictEqual(shop.createdAt, "2026-01-01");
});
test("two devices folding on their own make the same notes, and merging them doubles nothing", () => {
  const a = todoData(), b = todoData();
  fold(a); fold(b);
  assert.deepStrictEqual(a.notes, b.notes);
  const M = require("../src/merge.js");
  const merged = M.mergeNotes([], a.notes, b.notes);
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged.find((n) => n.text === "Shopping").items.length, 2);
});
test("a to-do written later by a device on an older build lands in its list", () => {
  const d = todoData();
  fold(d);
  d.todos = [{ id: "t9", text: "Bread", category: "Shopping", createdAt: "2026-02-01" }];
  fold(d);
  const shop = d.notes.find((n) => n.text === "Shopping");
  assert.deepStrictEqual(shop.items.map((i) => i.text), ["Eggs", "Milk", "Bread"]);
  assert.strictEqual(d.notes.length, 2);
});
test("an older device's tick or edit to a folded to-do comes across instead of doubling it", () => {
  const d = todoData();
  fold(d);
  d.todos = [{ id: "t1", text: "Oat milk", category: "Shopping", done: true, doneAt: "2026-03-01" }];
  fold(d);
  const it = d.notes.find((n) => n.text === "Shopping").items.find((i) => i.id === "t1");
  assert.deepStrictEqual([it.text, it.done, it.doneAt], ["Oat milk", true, "2026-03-01"]);
});
test("a to-do with no id match but the same words in the same list isn't added twice", () => {
  const d = todoData();
  fold(d);
  d.todos = [{ id: "fresh", text: "eggs", category: "Shopping" }];
  fold(d);
  assert.strictEqual(d.notes.find((n) => n.text === "Shopping").items.length, 2);
});
test("nothing to fold is a no-op", () => {
  const d = { notes: [{ id: "n", text: "x" }], todos: [] };
  assert.strictEqual(fold(d), false);
  assert.deepStrictEqual(d.notes, [{ id: "n", text: "x" }]);
});

console.log(`\n${passed} test(s) passed.`);
