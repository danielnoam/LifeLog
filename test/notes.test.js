// Zero-dependency tests for src/notes.js's pure data logic — run with
// `node test/notes.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern.
const assert = require("assert");
global.window = {};
require("../src/notes.js");
const Notes = global.window.LifeLogNotes;

let idCounter = 0;
const state = { data: { notes: [], settings: {} }, search: "", activeYears: new Set() };
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

console.log(`\n${passed} test(s) passed.`);
