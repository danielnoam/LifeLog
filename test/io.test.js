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
global.window.LifeLogFinance.init({ uid, backfillUpdatedAt, keepUnknown });
global.window.LifeLogJournal.init({ uid, backfillUpdatedAt, sanitizeOverrides, keepUnknown });
global.window.LifeLogBacklog.init({ uid, backfillUpdatedAt, sanitizeOverrides, keepUnknown });

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
IO.init({
  state, CATEGORY_PALETTE, MONTHS,
  financeKey: global.window.LifeLogFinance.financeKey,
  recurringKey: global.window.LifeLogFinance.recurringKey,
  sanitizeEntry: global.window.LifeLogJournal.sanitizeEntry,
  sanitizeBacklog: global.window.LifeLogBacklog.sanitizeBacklog,
  sanitizeFinanceEntry: global.window.LifeLogFinance.sanitizeFinanceEntry,
  sanitizeRecurring: global.window.LifeLogFinance.sanitizeRecurring,
});

const { parseCsv, csvEsc, buildImportItems, importItemDateStr, importBucketKey, journalCsvText, parseJournalCsv,
  fillableFields, findImportTarget, importItemIncomplete } = IO;

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

seed();

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
