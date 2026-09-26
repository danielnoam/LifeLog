// Zero-dependency tests for src/io.js's pure data logic — run with
// `node test/io.test.js`. No build step, no test framework: plain Node
// `assert`, matching test/merge.test.js's pattern.
//
// buildImportItems needs the real sanitizers/dedup-key builders from
// finance.js/journal.js/backlog.js (same "require the real modules and
// init() them with trivial stubs" approach test/app.test.js established),
// since re-stubbing those would just mean re-testing io.js's own dedup
// logic against a fake of what the sanitizers do instead of the real thing.
const assert = require("assert");
global.window = {};
require("../src/finance.js");
require("../src/journal.js");
require("../src/backlog.js");
require("../src/notes.js");
require("../src/todos.js");
require("../src/habits.js");
require("../src/io.js");

let idCounter = 0;
const uid = () => "test-id-" + (idCounter++);
const backfillUpdatedAt = (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z";
// The real sanitizeOverrides lives in app.js, which needs a DOM — stubbed to
// the same contract test/backlog.test.js uses (keep the ticked keys, drop the
// key entirely when nothing is ticked). Without it sanitizeBacklog/
// sanitizeEntry throw the moment an import item reaches them.
const sanitizeOverrides = (overrides, keys) => {
  const out = {};
  for (const key of keys) if (overrides && overrides[key]) out[key] = true;
  return Object.keys(out).length ? out : null;
};
// Same, for the other app.js helper every sanitizer takes: copy anything the
// sanitizer didn't name, so a build older than the data can't silently drop it.
const keepUnknown = (src, out, known) => {
  for (const key of Object.keys(src || {})) if (!known.has(key)) out[key] = src[key];
  return out;
};
global.window.LifeLogFinance.init({ uid, backfillUpdatedAt, keepUnknown,
  csvEsc: (...a) => global.window.LifeLogIO.csvEsc(...a), parseCsv: (...a) => global.window.LifeLogIO.parseCsv(...a) });
global.window.LifeLogJournal.init({ uid, backfillUpdatedAt, sanitizeOverrides, keepUnknown });
global.window.LifeLogBacklog.init({ uid, backfillUpdatedAt, sanitizeOverrides, keepUnknown });
global.window.LifeLogNotes.init({ uid, backfillUpdatedAt, keepUnknown });
global.window.LifeLogTodos.init({ uid, backfillUpdatedAt, keepUnknown });
global.window.LifeLogHabits.init({ uid, backfillUpdatedAt, keepUnknown });

const state = {
  data: {
    entries: [], backlog: [], financeEntries: [], recurringExpenses: [],
    categories: [{ id: "games", name: "Games", color: "#111" }],
    financeCategories: [{ id: "food", name: "Food", color: "#222" }],
  },
};
const CATEGORY_PALETTE = ["#aaa", "#bbb", "#ccc"];
const MONTHS = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const IO = global.window.LifeLogIO;
// What applyImportSelection calls on its way out; the tests read state.
const ensureCategories = (cats, items) => {
  for (const i of items) if (!cats.some((c) => c.name === i.category)) cats.push({ id: i.category, name: i.category, color: "#000" });
};
IO.init({
  state, CATEGORY_PALETTE, MONTHS, uid, ensureCategories,
  toast: () => {}, persist: async () => {}, afterDataChange: () => {},
  sanitizeProject: global.window.LifeLogFinance.sanitizeProject,
  sanitizeNote: global.window.LifeLogNotes.sanitizeNote,
  sanitizeTodo: global.window.LifeLogTodos.sanitizeTodo,
  sanitizeHabit: global.window.LifeLogHabits.sanitizeHabit,
  financeKey: global.window.LifeLogFinance.financeKey,
  recurringKey: global.window.LifeLogFinance.recurringKey,
  sanitizeEntry: global.window.LifeLogJournal.sanitizeEntry,
  sanitizeBacklog: global.window.LifeLogBacklog.sanitizeBacklog,
  sanitizeFinanceEntry: global.window.LifeLogFinance.sanitizeFinanceEntry,
  sanitizeRecurring: global.window.LifeLogFinance.sanitizeRecurring,
});

const { parseCsv, csvEsc, buildImportItems, importItemDateStr, importBucketKey, journalCsvText, parseJournalCsv,
  fillableFields, findImportTarget, importItemIncomplete, notesCsvText, parseNotesCsv, allCsvText, parseAllCsv, applyImportSelection, TAB_KINDS } = IO;
const { financeCsvText, parseFlatFinanceCsv } = global.window.LifeLogFinance;

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

// ---------- parseCsv ----------
test("parseCsv splits plain rows on commas and newlines", () => {
  const rows = parseCsv("a,b,c\n1,2,3");
  assert.deepStrictEqual(rows, [["a", "b", "c"], ["1", "2", "3"]]);
});

test("parseCsv honors quoted fields containing commas and newlines", () => {
  const rows = parseCsv('a,"b, with comma",c\nd,"multi\nline",f');
  assert.deepStrictEqual(rows, [["a", "b, with comma", "c"], ["d", "multi\nline", "f"]]);
});

test("parseCsv unescapes doubled quotes inside a quoted field", () => {
  const rows = parseCsv('a,"she said ""hi""",c');
  assert.deepStrictEqual(rows[0], ["a", 'she said "hi"', "c"]);
});

test("parseCsv treats \\r\\n the same as \\n", () => {
  const rows = parseCsv("a,b\r\nc,d");
  assert.deepStrictEqual(rows, [["a", "b"], ["c", "d"]]);
});

test("parseCsv keeps a trailing unterminated row", () => {
  const rows = parseCsv("a,b\nc,d"); // no trailing newline
  assert.deepStrictEqual(rows, [["a", "b"], ["c", "d"]]);
});

// ---------- csvEsc ----------
test("csvEsc only quotes when the value needs it", () => {
  assert.strictEqual(csvEsc("plain"), "plain");
  assert.strictEqual(csvEsc("has,comma"), '"has,comma"');
  assert.strictEqual(csvEsc('has"quote'), '"has""quote"');
  assert.strictEqual(csvEsc("has\nnewline"), '"has\nnewline"');
});

test("csvEsc turns null/undefined into an empty string", () => {
  assert.strictEqual(csvEsc(null), "");
  assert.strictEqual(csvEsc(undefined), "");
});

test("parseCsv(csvEsc(x)) round-trips a value containing every special character", () => {
  const value = 'has, a comma, a "quote", and\na newline';
  assert.strictEqual(parseCsv(csvEsc(value))[0][0], value);
});

// ---------- buildImportItems ----------
test("buildImportItems flags an exact-key match as a duplicate and leaves new items checked", () => {
  state.data.entries = [{ id: "e1", title: "Foo", category: "Games", year: 2026, month: 1 }];
  const { items } = buildImportItems({ entries: [
    { title: "Foo", category: "Games", year: 2026, month: 1 }, // exact dup
    { title: "Bar", category: "Games", year: 2026, month: 2 }, // new
  ] });
  const dupItem = items.find((i) => i.entry.title === "Foo");
  const newItem = items.find((i) => i.entry.title === "Bar");
  assert.strictEqual(dupItem.dup, true);
  assert.strictEqual(dupItem.checked, false);
  assert.strictEqual(newItem.dup, false);
  assert.strictEqual(newItem.checked, true);
});

test("buildImportItems flags a backlog item as a duplicate of an already-logged journal entry by title+category", () => {
  state.data.entries = [{ id: "e1", title: "Finished Game", category: "Games", year: 2026, month: 1 }];
  state.data.backlog = [];
  const { items } = buildImportItems({ backlog: [{ title: "finished game", category: "Games" }] });
  assert.strictEqual(items[0].dup, true);
});

test("buildImportItems flags a mediaSource+mediaId match as a duplicate even if the title was renamed locally", () => {
  state.data.entries = [];
  state.data.backlog = [{ id: "b1", title: "Renamed Locally", category: "Games", mediaSource: "steam", mediaId: "123" }];
  const { items } = buildImportItems({ backlog: [{ title: "Original Wishlist Title", category: "Games", mediaSource: "steam", mediaId: "123" }] });
  assert.strictEqual(items[0].dup, true);
});

test("buildImportItems collects new category names not already known, tagged by scope", () => {
  state.data.entries = [];
  state.data.backlog = [];
  state.data.financeEntries = [];
  const { newCategories } = buildImportItems({
    entries: [{ title: "Foo", category: "NewJournalCat", year: 2026, month: 1 }],
    financeEntries: [{ date: "2026-01-01", amount: 10, category: "NewFinanceCat" }],
  });
  const names = newCategories.map((c) => c.name).sort();
  assert.deepStrictEqual(names, ["NewFinanceCat", "NewJournalCat"]);
  assert.strictEqual(newCategories.find((c) => c.name === "NewJournalCat").scope, "journal");
  assert.strictEqual(newCategories.find((c) => c.name === "NewFinanceCat").scope, "finance");
});

// ---------- journal CSV round-trip (export then re-import) ----------
// journalCsvText/parseJournalCsv are the two ends of Settings → Import/Export
// → Journal data → CSV — exercising them back-to-back is what buildImportItems's
// existing dedup-key tests above don't cover: they start from already-parsed
// objects, never from CSV text that was itself produced by the exporter.
test("journal CSV round-trip preserves entries (title, category, year, month, createdAt)", () => {
  const entries = [
    { title: "Foo", category: "Games", year: 2026, month: 1, createdAt: "2026-01-03T00:00:00.000Z" },
    { title: "Bar", category: "Games", year: 2025, month: 12, createdAt: "2025-12-25T00:00:00.000Z" },
  ];
  const text = journalCsvText(entries, []);
  const { entries: reimported, backlog } = parseJournalCsv(text);
  assert.strictEqual(backlog.length, 0);
  assert.strictEqual(reimported.length, entries.length);
  const byTitle = (list) => Object.fromEntries(list.map((e) => [e.title, e]));
  const before = byTitle(entries), after = byTitle(reimported);
  for (const title of Object.keys(before)) {
    assert.strictEqual(after[title].category, before[title].category);
    assert.strictEqual(after[title].year, before[title].year);
    assert.strictEqual(after[title].month, before[title].month);
    assert.strictEqual(after[title].createdAt, before[title].createdAt);
  }
});

test("journal CSV round-trip preserves backlog items (title, category, createdAt)", () => {
  const backlogIn = [
    { title: "Someday Game", category: "Games", createdAt: "2026-02-14T00:00:00.000Z" },
    { title: "No Date Item", category: "Games", createdAt: null },
  ];
  const text = journalCsvText([], backlogIn);
  const { entries, backlog } = parseJournalCsv(text);
  assert.strictEqual(entries.length, 0);
  assert.strictEqual(backlog.length, backlogIn.length);
  const byTitle = Object.fromEntries(backlog.map((b) => [b.title, b]));
  assert.strictEqual(byTitle["Someday Game"].category, "Games");
  assert.strictEqual(byTitle["Someday Game"].createdAt, "2026-02-14T00:00:00.000Z");
  assert.strictEqual(byTitle["No Date Item"].createdAt, null);
});

test("journal CSV round-trip survives titles/categories with commas, quotes, and newlines", () => {
  const entries = [
    { title: 'Foo, Bar: "The Game"', category: "Games", year: 2026, month: 6, createdAt: null },
    { title: "Multi\nLine Title", category: "Games", year: 2026, month: 7, createdAt: null },
  ];
  const text = journalCsvText(entries, []);
  const { entries: reimported } = parseJournalCsv(text);
  const titles = reimported.map((e) => e.title).sort();
  assert.deepStrictEqual(titles, entries.map((e) => e.title).sort());
});

test("journal CSV round-trip on a mixed entries+backlog export recovers both kinds fully", () => {
  const entries = [{ title: "Played It", category: "Games", year: 2026, month: 3, createdAt: null }];
  const backlogIn = [{ title: "Will Play It", category: "Games", createdAt: null }];
  const text = journalCsvText(entries, backlogIn);
  const { entries: reEntries, backlog: reBacklog } = parseJournalCsv(text);
  assert.deepStrictEqual(reEntries.map((e) => e.title), ["Played It"]);
  assert.deepStrictEqual(reBacklog.map((b) => b.title), ["Will Play It"]);
});

// ---------- importItemDateStr / importBucketKey ----------
test("importItemDateStr branches by item kind", () => {
  assert.strictEqual(importItemDateStr({ kind: "finance", entry: { date: "2026-03-15" } }), "2026-03-15");
  assert.strictEqual(importItemDateStr({ kind: "entry", entry: { year: 2026, month: 3 } }), "2026-03");
  assert.strictEqual(importItemDateStr({ kind: "recurring", entry: { startDate: "2026-01-01" } }), "2026-01-01");
  assert.strictEqual(importItemDateStr({ kind: "backlog", entry: {} }), "");
});

test("importBucketKey buckets by year for a yearly finance entry, year-month otherwise, null for backlog", () => {
  assert.strictEqual(importBucketKey({ kind: "finance", entry: { date: "2026" } }), "2026");
  assert.strictEqual(importBucketKey({ kind: "finance", entry: { date: "2026-03-15" } }), "2026-03");
  assert.strictEqual(importBucketKey({ kind: "entry", entry: { year: 2026, month: 3 } }), "2026-03");
  assert.strictEqual(importBucketKey({ kind: "backlog", entry: {} }), null);
});

// ---------- import updates (fill-the-gaps) ----------
// The reset matters: these tests seed the shared `state` the IO module was
// init()ed with, and buildImportItems reads it live.
function seed({ backlog = [], entries = [], recurringExpenses = [], financeEntries = [] } = {}) {
  state.data.backlog = backlog;
  state.data.entries = entries;
  state.data.recurringExpenses = recurringExpenses;
  state.data.financeEntries = financeEntries;
}

test("fillableFields names only the gaps, never a field that already has something", () => {
  const target = { coverUrl: "have.png", externalRating: "", length: "12h" };
  const incoming = { coverUrl: "new.png", externalRating: "88", length: "20h", summary: "words" };
  const keys = fillableFields(target, incoming, "backlog").map((f) => f.key).sort();
  assert.deepStrictEqual(keys, ["externalRating", "summary"]);
});

test("fillableFields ignores an incoming field that is itself empty", () => {
  assert.deepStrictEqual(fillableFields({}, { coverUrl: "", genres: [] }, "backlog"), []);
});

test("fillableFields only offers a media link when the incoming has an id and the target has none", () => {
  const inc = { mediaSource: "steam", mediaId: "440" };
  assert.ok(fillableFields({}, inc, "backlog").some((f) => f.key === "mediaSource"));
  assert.ok(!fillableFields({ mediaId: "1" }, inc, "backlog").some((f) => f.key === "mediaSource"));
  assert.ok(!fillableFields({}, { mediaSource: "steam" }, "backlog").some((f) => f.key === "mediaSource"));
});

test("importItemIncomplete is true while any fillable field is still empty, false once they are all set", () => {
  assert.strictEqual(importItemIncomplete({ title: "X" }), true);
  const full = {
    coverUrl: "c.png", externalRating: "9", length: "10h", releaseYear: 2020,
    releaseDate: "2020-01-01", releaseStatus: "released", summary: "s",
    genres: ["RPG"], mediaSource: "steam", mediaId: "440",
  };
  assert.strictEqual(importItemIncomplete(full), false);
});

test("findExistingFor prefers a media-id match over a title match, and reports which list it came from", () => {
  seed({
    backlog: [{ id: "b1", title: "Other Name", category: "Games", mediaSource: "steam", mediaId: "440" }],
    entries: [{ id: "e1", title: "Team Fortress 2", category: "Games" }],
  });
  const byMedia = findImportTarget({ title: "Team Fortress 2", category: "Games", mediaSource: "steam", mediaId: "440" }, "backlog");
  assert.strictEqual(byMedia.item.id, "b1");
  assert.strictEqual(byMedia.kind, "backlog");
  const byTitle = findImportTarget({ title: "Team Fortress 2", category: "Games" }, "backlog");
  assert.strictEqual(byTitle.item.id, "e1");
  assert.strictEqual(byTitle.kind, "entry");
});

test("findExistingFor matches a title regardless of case, and returns null when nothing matches", () => {
  seed({ backlog: [{ id: "b1", title: "Hades", category: "Games" }] });
  assert.strictEqual(findImportTarget({ title: "HADES", category: "games" }, "backlog").item.id, "b1");
  assert.strictEqual(findImportTarget({ title: "Hades II", category: "Games" }, "backlog"), null);
});

test("finding the existing item leaves no marker on the record itself", () => {
  const live = { id: "b1", title: "Hades", category: "Games" };
  seed({ backlog: [live] });
  findImportTarget({ title: "Hades", category: "Games" }, "backlog");
  assert.deepStrictEqual(Object.keys(live).sort(), ["category", "id", "title"],
    "a marker stuck on a live record would be persisted and synced forever");
});

test("a duplicate with gaps imports as an update row naming what it would fill", () => {
  seed({ backlog: [{ id: "b1", title: "Hades", category: "Games", coverUrl: "" }] });
  const { items } = buildImportItems({ backlog: [{ title: "Hades", category: "Games", coverUrl: "art.png", externalRating: "93" }] });
  const row = items.find((i) => i.kind === "backlog");
  assert.strictEqual(row.update, true);
  assert.strictEqual(row.dup, true);
  assert.strictEqual(row.checked, true, "an update is worth doing, so it comes pre-ticked");
  assert.strictEqual(row.targetId, "b1");
  assert.strictEqual(row.targetKind, "backlog");
  assert.deepStrictEqual(row.fills.map((f) => f.key).sort(), ["coverUrl", "externalRating"]);
});

test("a duplicate with nothing to add stays a plain, unticked duplicate", () => {
  seed({ backlog: [{ id: "b1", title: "Hades", category: "Games", coverUrl: "art.png" }] });
  const { items } = buildImportItems({ backlog: [{ title: "Hades", category: "Games", coverUrl: "other.png" }] });
  const row = items.find((i) => i.kind === "backlog");
  assert.strictEqual(row.dup, true);
  assert.ok(!row.update);
  assert.strictEqual(row.checked, false);
});

test("an update never proposes overwriting a field the existing item already had", () => {
  seed({ backlog: [{ id: "b1", title: "Hades", category: "Games", coverUrl: "mine.png", summary: "" }] });
  const { items } = buildImportItems({ backlog: [{ title: "Hades", category: "Games", coverUrl: "theirs.png", summary: "words" }] });
  const row = items.find((i) => i.kind === "backlog");
  assert.deepStrictEqual(row.fills.map((f) => f.key), ["summary"]);
});

test("a brand new item is a plain add, not an update", () => {
  seed({ backlog: [] });
  const { items } = buildImportItems({ backlog: [{ title: "Hades", category: "Games", coverUrl: "art.png" }] });
  const row = items.find((i) => i.kind === "backlog");
  assert.ok(!row.update);
  assert.strictEqual(row.dup, false);
  assert.strictEqual(row.checked, true);
});

seed();

// ---------- update rows for entries and recurring expenses (0.154.0) ----------
test("a journal entry duplicate with gaps becomes an update row", () => {
  seed({ entries: [{ id: "e1", title: "Celeste", category: "Games", year: 2026, month: 3, coverUrl: "" }] });
  const { items } = buildImportItems({
    entries: [{ title: "Celeste", category: "Games", year: 2026, month: 3,
      coverUrl: "art.png", length: "8h", rating: 5, notes: "loved it" }],
  });
  const row = items.find((i) => i.kind === "entry");
  assert.strictEqual(row.update, true);
  assert.strictEqual(row.targetId, "e1");
  assert.strictEqual(row.targetKind, "entry");
  assert.deepStrictEqual(row.fills.map((f) => f.key).sort(), ["coverUrl", "length", "notes", "rating"]);
});

test("an entry update never proposes a field the entry already has", () => {
  seed({ entries: [{ id: "e1", title: "Celeste", category: "Games", year: 2026, month: 3, rating: 4, notes: "" }] });
  const { items } = buildImportItems({
    entries: [{ title: "Celeste", category: "Games", year: 2026, month: 3, rating: 5, notes: "mine" }],
  });
  assert.deepStrictEqual(items.find((i) => i.kind === "entry").fills.map((f) => f.key), ["notes"]);
});

test("an entry is only a duplicate of the same month, so a replay is a new entry", () => {
  seed({ entries: [{ id: "e1", title: "Celeste", category: "Games", year: 2026, month: 3 }] });
  const { items } = buildImportItems({
    entries: [{ title: "Celeste", category: "Games", year: 2027, month: 1, coverUrl: "art.png" }],
  });
  const row = items.find((i) => i.kind === "entry");
  assert.strictEqual(row.dup, false);
  assert.ok(!row.update);
});

test("an entry is never offered a field the app would never read back", () => {
  seed({ entries: [{ id: "e1", title: "Celeste", category: "Games", year: 2026, month: 3 }] });
  const { items } = buildImportItems({
    entries: [{ title: "Celeste", category: "Games", year: 2026, month: 3,
      summary: "words", releaseDate: "2018-01-25", externalRating: "91", coverUrl: "art.png" }],
  });
  assert.deepStrictEqual(items.find((i) => i.kind === "entry").fills.map((f) => f.key), ["coverUrl"]);
});

test("a recurring duplicate offers what recurringKey does not match on", () => {
  seed({ recurringExpenses: [{ id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food", note: "milk" }] });
  const { items } = buildImportItems({
    recurringExpenses: [{ startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food", note: "milk",
      endDate: "2026-12-01", project: "Switzerland", pauses: [{ from: "2026-06-01" }],
      overrides: { "2026-04-01": { amount: 12 } } }],
  });
  const row = items.find((i) => i.kind === "recurring");
  assert.strictEqual(row.update, true);
  assert.strictEqual(row.targetKind, "recurring");
  assert.deepStrictEqual(row.fills.map((f) => f.key).sort(), ["endDate", "overrides", "pauses", "project"]);
});

test("a recurring duplicate with nothing outside the key stays a plain duplicate", () => {
  seed({ recurringExpenses: [{ id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food", note: "milk" }] });
  const { items } = buildImportItems({
    recurringExpenses: [{ startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food", note: "milk" }],
  });
  const row = items.find((i) => i.kind === "recurring");
  assert.strictEqual(row.dup, true);
  assert.ok(!row.update);
  assert.strictEqual(row.checked, false);
});

// financeKey spans every field a finance entry has that could go missing, so
// there is nothing an update could add. Asserted so that stays true.
test("a finance duplicate is never an update row, because it has nothing to fill", () => {
  seed({ financeEntries: [{ id: "f1", date: "2026-03-04", amount: 20, category: "Food", note: "lunch" }] });
  const { items } = buildImportItems({
    financeEntries: [{ date: "2026-03-04", amount: 20, category: "Food", note: "lunch" }],
  });
  const row = items.find((i) => i.kind === "finance");
  assert.strictEqual(row.dup, true);
  assert.ok(!row.update);
});

test("an empty object counts as a gap, so pauses/overrides can be filled", () => {
  assert.deepStrictEqual(fillableFields({ overrides: {} }, { overrides: { a: { skip: true } } }, "recurring")
    .map((f) => f.key), ["overrides"]);
  assert.deepStrictEqual(fillableFields({ overrides: { a: { skip: true } } }, { overrides: { b: { skip: true } } }, "recurring"), []);
});

test("a paired field needs both halves incoming and neither locally", () => {
  const inc = { startYear: 2025, startMonth: 11 };
  assert.ok(fillableFields({}, inc, "entry").some((f) => f.key === "startYear"));
  // Half a span is worse than none.
  assert.deepStrictEqual(fillableFields({}, { startYear: 2025 }, "entry"), []);
  assert.deepStrictEqual(fillableFields({ startMonth: 2 }, inc, "entry"), []);
});

test("importItemIncomplete still answers for the backlog by default", () => {
  assert.strictEqual(importItemIncomplete({ title: "X" }), true);
  assert.strictEqual(importItemIncomplete({ title: "X" }, "backlog"), true);
  // And says so per kind: a recurring plan with every optional part set.
  assert.strictEqual(importItemIncomplete(
    { endDate: "2026-12-01", project: "P", pauses: [{ from: "x" }], overrides: { a: {} }, prevId: "r0" },
    "recurring"), false);
});


// ---------- every tab, both ways ----------
// Each tab's export has to come back through that tab's import: JSON whole,
// CSV as far as a row goes. These start from a full set of every kind, run it
// out and back in against an empty app, and look at what arrived.
const blank = () => ({
  entries: [], backlog: [], financeEntries: [], recurringExpenses: [], notes: [], todos: [], habits: [],
  accomplishments: {}, categories: [], financeCategories: [], todoCategories: [], noteCategories: [], projects: [],
});
const FULL = {
  entries: [{ id: "e1", title: "Outer Wilds", category: "Games", year: 2026, month: 3, rating: 5, notes: "wow" }],
  backlog: [{ id: "b1", title: "Hades II", category: "Games" }],
  accomplishments: { 2026: [{ id: "a1", text: "Ran a 10k", createdAt: "2026-04-01T00:00:00.000Z" }] },
  categories: [{ id: "games", name: "Games", color: "#123456" }],
  notes: [{ id: "n1", text: "A thought,\nwith a comma", createdAt: "2026-05-01T10:00:00.000Z" }],
  todos: [{ id: "t1", text: "Call mum", category: "Home", createdAt: "2026-05-02T00:00:00.000Z" },
    { id: "t2", text: "Done thing", done: true, doneAt: "2026-05-03T00:00:00.000Z", createdAt: "2026-05-01T00:00:00.000Z" }],
  todoCategories: [{ id: "home", name: "Home", color: "#abcdef" }],
  habits: [{ id: "h1", name: "Read", color: "#00aa00", cadence: { days: [1, 3] }, target: 2, startedAt: "2026-01-01", marks: { "2026-01-05": 2, "2026-01-07": 1 } }],
  financeEntries: [{ id: "f1", date: "2026-02-03", amount: 42.5, category: "Food", note: "Lunch, big", project: "Trip" }],
  recurringExpenses: [{ id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 9.99, category: "Subs", note: "Music", endDate: "2026-12-01" }],
  financeCategories: [{ id: "subs", name: "Subs", color: "#ff0000" }],
  projects: [{ id: "p1", name: "Trip", color: "#0000ff" }],
};
const importAll = async (incoming, kinds) => {
  const built = buildImportItems(incoming, kinds);
  await applyImportSelection(built.items.filter((i) => i.checked), built.newCategories.filter((c) => c.add));
  return built;
};
const asyncTests = [];
const atest = (name, fn) => asyncTests.push([name, fn]);

atest("every tab's JSON brings back all of its kinds, and only its kinds", async () => {
  const want = {
    notes: { notes: 1, todos: 2, habits: 1, entries: 0, financeEntries: 0 },
    timeline: { entries: 1, backlog: 0, notes: 0 },
    backlog: { backlog: 1, entries: 0 },
    finance: { financeEntries: 1, recurringExpenses: 1, notes: 0, backlog: 0 },
  };
  for (const tab of Object.keys(TAB_KINDS)) {
    state.data = blank();
    await importAll(JSON.parse(JSON.stringify(FULL)), TAB_KINDS[tab]);
    for (const [k, n] of Object.entries(want[tab])) assert.strictEqual(state.data[k].length, n, tab + " → " + k);
  }
});

atest("a full backup import brings everything, with its categories, projects and achievements", async () => {
  state.data = blank();
  await importAll(JSON.parse(JSON.stringify(FULL)));
  const d = state.data;
  assert.deepStrictEqual([d.entries.length, d.backlog.length, d.notes.length, d.todos.length, d.habits.length, d.financeEntries.length, d.recurringExpenses.length], [1, 1, 1, 2, 1, 1, 1]);
  assert.strictEqual(d.accomplishments[2026][0].text, "Ran a 10k");
  assert.strictEqual(d.entries[0].notes, "wow");
  assert.deepStrictEqual(d.habits[0].marks, { "2026-01-05": 2, "2026-01-07": 1 });
  assert.strictEqual(d.todoCategories.find((c) => c.name === "Home").color, "#abcdef");
  assert.strictEqual(d.projects.find((p) => p.name === "Trip").color, "#0000ff");
  assert.strictEqual(d.financeCategories.find((c) => c.name === "Subs").color, "#ff0000");
});

atest("importing the same file twice adds nothing the second time", async () => {
  state.data = blank();
  await importAll(JSON.parse(JSON.stringify(FULL)));
  const again = buildImportItems(JSON.parse(JSON.stringify(FULL)));
  assert.deepStrictEqual(again.items.filter((i) => !i.dup && !i.update).map((i) => i.kind), []);
  assert.deepStrictEqual(again.newCategories, []);
});

atest("an item changed since the export still matches on id, and a copy imported anyway gets an id of its own", async () => {
  state.data = blank();
  await importAll({ notes: [{ id: "n1", text: "old words", createdAt: "2026-01-01T00:00:00.000Z" }] });
  state.data.notes[0].text = "new words";
  const built = buildImportItems({ notes: [{ id: "n1", text: "old words" }] });
  assert.strictEqual(built.items[0].dup, true, "same id is the same note");
  // Taken ids are never shared, even when a copy is imported on purpose.
  await applyImportSelection(built.items, []);
  assert.strictEqual(new Set(state.data.notes.map((n) => n.id)).size, 2);
});

atest("Notes CSV round trip keeps notes, to-dos and habits with their history", async () => {
  const text = notesCsvText(FULL.notes, FULL.todos, FULL.habits);
  const back = parseNotesCsv(text);
  assert.strictEqual(back.notes[0].text, "A thought,\nwith a comma");
  assert.strictEqual(back.notes[0].createdAt, "2026-05-01T10:00:00.000Z");
  assert.strictEqual(back.todos[0].category, "Home");
  assert.strictEqual(back.todos[1].done, true);
  assert.strictEqual(back.todos[1].doneAt, "2026-05-03T00:00:00.000Z");
  const h = back.habits[0];
  assert.deepStrictEqual([h.name, h.target, h.startedAt, h.color], ["Read", 2, "2026-01-01", "#00aa00"]);
  assert.deepStrictEqual(h.cadence, { days: [1, 3] });
  assert.deepStrictEqual(h.marks, { "2026-01-05": 2, "2026-01-07": 1 });
  state.data = blank();
  await importAll(back, TAB_KINDS.notes);
  assert.deepStrictEqual([state.data.notes.length, state.data.todos.length, state.data.habits.length], [1, 2, 1]);
});

atest("Notes CSV round trip keeps a list's items and ticks, a quote's author, and categories", async () => {
  const notes = [
    { id: "q", text: "Words", kind: "quote", author: "Frost", source: "Poem", category: "Ideas", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "l", text: "Shop", kind: "list", category: "Home", createdAt: "2026-01-02T00:00:00.000Z", items: [{ id: "a", text: "Milk, 2L", done: true }, { id: "b", text: "Eggs" }] },
  ];
  const back = parseNotesCsv(notesCsvText(notes, [], []));
  assert.deepStrictEqual([back.notes[0].kind, back.notes[0].author, back.notes[0].source, back.notes[0].category], ["quote", "Frost", "Poem", "Ideas"]);
  assert.deepStrictEqual(back.notes[1].items.map((i) => [i.text, !!i.done]), [["Milk, 2L", true], ["Eggs", false]]);
  state.data = blank();
  await importAll(back, TAB_KINDS.notes);
  assert.deepStrictEqual(state.data.noteCategories.map((c) => c.name).sort(), ["Home", "Ideas"]);
  assert.strictEqual(state.data.notes.find((n) => n.kind === "list").items.length, 2);
});

atest("a list with items and no title still imports", async () => {
  state.data = blank();
  await importAll({ notes: [{ id: "u", text: "", kind: "list", items: [{ text: "Only an item" }] }] }, TAB_KINDS.notes);
  assert.strictEqual(state.data.notes.length, 1);
});

atest("Timeline CSV carries achievements alongside entries", async () => {
  const back = parseJournalCsv(journalCsvText(FULL.entries, [], FULL.accomplishments));
  assert.strictEqual(back.entries[0].title, "Outer Wilds");
  assert.strictEqual(back.accomplishments[2026][0].text, "Ran a 10k");
  state.data = blank();
  await importAll(back, TAB_KINDS.timeline);
  assert.strictEqual(state.data.accomplishments[2026].length, 1);
});

atest("Ledger CSV round trip keeps expenses and recurring expenses", async () => {
  const back = parseFlatFinanceCsv(financeCsvText(FULL.financeEntries, FULL.recurringExpenses));
  assert.deepStrictEqual(back.financeEntries[0], { amount: 42.5, category: "Food", note: "Lunch, big", project: "Trip", date: "2026-02-03" });
  const r = back.recurringExpenses[0];
  assert.deepStrictEqual([r.startDate, r.interval, r.amount, r.note, r.endDate], ["2026-01-01", "monthly", 9.99, "Music", "2026-12-01"]);
  state.data = blank();
  await importAll(back, TAB_KINDS.finance);
  assert.deepStrictEqual([state.data.financeEntries.length, state.data.recurringExpenses.length], [1, 1]);
  assert.ok(state.data.projects.some((p) => p.name === "Trip"), "a project named on an expense comes with it");
});

atest("everything in one CSV comes back as every kind, each block to its own parser", async () => {
  const back = parseAllCsv(allCsvText(FULL));
  state.data = blank();
  await importAll(back);
  const d = state.data;
  assert.deepStrictEqual([d.notes.length, d.todos.length, d.habits.length, d.entries.length, d.backlog.length,
    d.accomplishments[2026].length, d.financeEntries.length, d.recurringExpenses.length], [1, 2, 1, 1, 1, 1, 1, 1]);
  // A habit's date column is a plain date, which the Ledger parser would
  // read as an expense if it looked past its own block.
  assert.deepStrictEqual(d.financeEntries.map((f) => f.note), ["Lunch, big"]);
});

atest("a Ledger CSV from before the Kind column still reads, and a Sheets pivot is left alone", async () => {
  const old = parseFlatFinanceCsv("Date,Amount,Category,Note\n2026-01-02,5,Food,Coffee");
  assert.deepStrictEqual(old.financeEntries.map((f) => f.note), ["Coffee"]);
  assert.strictEqual(parseFlatFinanceCsv(",January,,,February\n2026,,,"), null);
});

seed();

(async () => {
  for (const [name, fn] of asyncTests) {
    try { await fn(); passed++; console.log("  ok - " + name); }
    catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
  }
  console.log(`\n${passed} test(s) passed.`);
  if (process.exitCode) console.log("Some tests FAILED — see above.");
})();
