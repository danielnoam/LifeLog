// Zero-dependency tests for src/tags.js and tags on notes, tasks and
// boards — run with `node test/tags.test.js`.
const assert = require("assert");
global.window = {};
const T = require("../src/tags.js");
require("../src/tasks.js");
require("../src/notes.js");
require("../src/boards.js");
const Notes = global.window.LifeLogNotes;
const Boards = global.window.LifeLogBoards;
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

test("a tag is trimmed, loses its # and commas, and two that differ only in case are one", () => {
  assert.deepStrictEqual(T.clean(["#Road  trip,", "road trip", " kids ", "", null, "Kids"]), ["Road trip", "kids"]);
  assert.deepStrictEqual(T.clean("not a list"), []);
  assert.strictEqual(T.cleanOne("x".repeat(60)).length, T.MAX_LEN);
});
test("setOn writes or removes the field and says whether it changed", () => {
  const o = {};
  assert.strictEqual(T.setOn(o, ["a"]), true);
  assert.deepStrictEqual(o.tags, ["a"]);
  assert.strictEqual(T.setOn(o, ["A"]), true); // the spelling changed
  assert.strictEqual(T.setOn(o, ["A"]), false);
  assert.strictEqual(T.setOn(o, []), true);
  assert.ok(!("tags" in o));
});
test("notes, quotes, lists, tasks and boards keep their tags through their sanitizers", () => {
  const n = Notes.sanitizeNote({ id: "n", text: "hi", tags: ["#weekend", "Weekend", "friends"] });
  assert.deepStrictEqual(n.tags, ["weekend", "friends"]);
  const l = Notes.sanitizeNote({ id: "l", kind: "list", text: "Trip", tags: ["trip"], items: [{ id: "a", text: "Book", tags: ["camping", ""] }, { id: "b", text: "Pack", tags: [] }] });
  assert.deepStrictEqual(l.tags, ["trip"]);
  assert.deepStrictEqual(l.items[0].tags, ["camping"]);
  assert.ok(!("tags" in l.items[1]));
  const q = Notes.sanitizeNote({ id: "q", kind: "quote", text: "So it goes", tags: ["books"] });
  assert.deepStrictEqual(q.tags, ["books"]);
  const b = Boards.sanitizeBoard({ id: "b", name: "Plan", tags: ["garden", "#Garden"], elements: [] });
  assert.deepStrictEqual(b.tags, ["garden"]);
  assert.ok(!("tags" in Notes.sanitizeNote({ id: "x", text: "none" })));
});
test("count lists every tag, most used first, by kind; Home's scratch board isn't counted", () => {
  const notes = [
    { id: "1", text: "a", tags: ["weekend"] },
    { id: "2", kind: "quote", text: "b", tags: ["Weekend", "books"] },
    { id: "3", kind: "list", text: "c", tags: ["weekend"], items: [{ id: "i", text: "x", tags: ["camping", "weekend"] }] },
  ];
  const boards = [{ id: "b", tags: ["camping"] }, { id: "s", scratch: true, tags: ["weekend"] }];
  const c = T.count(notes, boards);
  assert.deepStrictEqual(c.map((x) => [x.name, x.total]), [["weekend", 4], ["camping", 2], ["books", 1]]);
  assert.strictEqual(T.summary(c[0]), "1 note · 1 quote · 1 list · 1 task");
  assert.strictEqual(T.summary(c[1]), "1 task · 1 board");
});
test("renaming onto an existing tag merges; deleting takes it off everything, the categories' too", () => {
  const notes = [
    { id: "1", text: "a", tags: ["travel", "trip"] },
    { id: "2", kind: "list", text: "c", items: [{ id: "i", text: "x", tags: ["Travel"] }, { id: "j", text: "y" }] },
    { id: "3", text: "z" },
  ];
  const cats = [{ id: "c", name: "Ideas", tags: ["travel"] }];
  const hit = T.renameIn({ notes, cats }, "travel", "trip");
  assert.deepStrictEqual(notes[0].tags, ["trip"]);
  assert.deepStrictEqual(notes[1].items[0].tags, ["trip"]);
  assert.deepStrictEqual(cats[0].tags, ["trip"]);
  assert.deepStrictEqual([...hit.notes].map((n) => n.id), ["1", "2"]);
  assert.strictEqual(hit.items.length, 1);
  T.renameIn({ notes, cats }, "TRIP", "");
  assert.ok(!("tags" in notes[0]) && !("tags" in notes[1].items[0]) && !("tags" in cats[0]));
  const boards = [{ id: "b", tags: ["trip", "garden"] }, { id: "c" }];
  assert.strictEqual(Boards.renameTagIn(boards, "garden", "").length, 1);
  assert.deepStrictEqual(boards[0].tags, ["trip"]);
});
test("#words in a search ask for tags; the rest is the text", () => {
  assert.deepStrictEqual(T.parseQuery("#weekend lake #Camp"), { tags: ["weekend", "Camp"], text: "lake" });
  assert.deepStrictEqual(T.parseQuery("C# notes"), { tags: [], text: "C# notes" });
});
test("the Notebook's filter keeps anything with any picked tag, a list through its tasks", () => {
  const state = { data: { notes: [
    Notes.sanitizeNote({ id: "1", text: "a", tags: ["weekend"], createdAt: "2026-11-01T00:00:00Z" }),
    Notes.sanitizeNote({ id: "2", kind: "list", text: "Trip", items: [{ id: "i", text: "x", tags: ["camping"] }], createdAt: "2026-11-02T00:00:00Z" }),
    Notes.sanitizeNote({ id: "3", text: "plain", createdAt: "2026-11-03T00:00:00Z" }),
  ], noteCategories: [], settings: {} }, search: "", activeYears: new Set(), noteActiveCats: new Set(), noteKinds: new Set(["text", "list", "quote"]), noteActiveTags: new Set(["Weekend", "camping"]) };
  Notes.init({ state, uid: () => "u", backfillUpdatedAt: (i) => i.updatedAt || "1970-01-01T00:00:00.000Z", keepUnknown: (s, o) => o });
  assert.deepStrictEqual(Notes.getFilteredNotes().map((n) => n.id).sort(), ["1", "2"]);
  state.noteActiveTags.clear();
  state.search = "#camping";
  assert.deepStrictEqual(Notes.getFilteredNotes().map((n) => n.id), ["2"]);
  state.search = "plain";
  assert.deepStrictEqual(Notes.getFilteredNotes().map((n) => n.id), ["3"]);
});

console.log(`\n${passed} test(s) passed.`);
