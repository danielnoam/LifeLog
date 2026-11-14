// Zero-dependency tests for src/hardcover.js's two-way sync logic —
// `node test/hardcover.test.js`. The rows are the user_books shape
// Hardcover's GraphQL API sends (status_id 1 want, 2 reading, 3 read,
// 4 paused, 5 did not finish).
const assert = require("assert");
global.window = {};
const H = require("../src/hardcover.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

const row = (id, slug, title, status, extra = {}) => ({
  id, status_id: status, updated_at: extra.updated_at || "2026-11-10T10:00:00Z", date_added: "2026-01-02",
  first_started_reading_date: extra.started || null, last_read_date: extra.finished || null, rating: extra.rating || null,
  book: { id: id * 10, slug, title, pages: 320, release_year: 2020, cached_image: { url: "https://assets.hardcover.app/" + slug + ".jpg" }, cached_contributors: [{ author: { name: extra.author || "A. Writer" } }] },
});
const remote = (rows) => rows.map(H.readUserBook).filter(Boolean);
const TODAY = "2026-11-14", NOW = "2026-11-14T12:00:00.000Z";

test("rows read with status, slug, author and dates; Ignored is left out", () => {
  const r = remote([row(1, "dune", "Dune", 2, { started: "2026-11-01" }), row(2, "x", "X", 6)]);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual([r[0].status, r[0].slug, r[0].author, r[0].startedAt, r[0].bookId, r[0].ubId], ["reading", "dune", "A. Writer", "2026-11-01", 10, 1]);
});

test("a book here by another source is matched by title and linked; author clash isn't", () => {
  const data = { backlog: [
    { id: "b1", title: "Dune", category: "Books", mediaSource: "openlibrary", mediaId: "OL1", author: "A. Writer" },
    { id: "b2", title: "Emma", category: "Books", author: "Someone Else" },
  ], entries: [] };
  const p = H.plan(remote([row(1, "dune", "Dune", 1), row(2, "emma", "Emma", 1)]), data, "Books", {}, new Set());
  assert.strictEqual(p.titles.length, 1);
  assert.strictEqual(p.titles[0].b.id, "b1");
  assert.deepStrictEqual(p.fresh.map((r) => r.slug), ["emma"]);
  H.applyPlan(p, data, TODAY, NOW);
  assert.deepStrictEqual([data.backlog[0].mediaSource, data.backlog[0].mediaId], ["hardcover", "dune"]);
});

test("with a base, the side that moved wins", () => {
  const data = { backlog: [{ id: "b1", title: "Dune", category: "Books", mediaSource: "hardcover", mediaId: "dune", startedAt: "2026-11-12" }], entries: [] };
  // Started here, Hardcover still Want to Read: push.
  let p = H.plan(remote([row(1, "dune", "Dune", 1)]), data, "Books", { dune: "want" }, new Set());
  assert.deepStrictEqual([p.titles[0].status, p.titles[0].push, p.titles[0].pull], ["reading", true, false]);
  // Finished on Hardcover since: pull, and the item moves to the Timeline.
  p = H.plan(remote([row(1, "dune", "Dune", 3, { finished: "2026-11-13", rating: 4.5 })]), data, "Books", { dune: "reading" }, new Set());
  assert.deepStrictEqual([p.titles[0].status, p.titles[0].pull], ["read", true]);
  const res = H.applyPlan(p, data, TODAY, NOW);
  assert.strictEqual(res.counts.finished, 1);
  assert.strictEqual(data.backlog.length, 0);
  const e = data.entries[0];
  assert.deepStrictEqual([e.year, e.month, e.day, e.startedAt, e.rating, e.mediaId], [2026, 11, 13, "2026-11-12", 5, "dune"]);
});

test("both moved: the newer change wins; no base: the further one", () => {
  const b = { id: "b1", title: "Dune", category: "Books", mediaSource: "hardcover", mediaId: "dune", dropped: true, updatedAt: "2026-11-12T00:00:00Z" };
  const data = { backlog: [b], entries: [] };
  let p = H.plan(remote([row(1, "dune", "Dune", 2, { updated_at: "2026-11-13T00:00:00Z" })]), data, "Books", { dune: "want" }, new Set());
  assert.deepStrictEqual([p.titles[0].status, p.titles[0].pull], ["reading", true]);
  b.updatedAt = "2026-11-14T00:00:00Z";
  p = H.plan(remote([row(1, "dune", "Dune", 2, { updated_at: "2026-11-13T00:00:00Z" })]), data, "Books", { dune: "want" }, new Set());
  assert.deepStrictEqual([p.titles[0].status, p.titles[0].push], ["dnf", true]);
  delete b.dropped; b.startedAt = "2026-11-01";
  p = H.plan(remote([row(1, "dune", "Dune", 1)]), data, "Books", {}, new Set());
  assert.deepStrictEqual([p.titles[0].status, p.titles[0].push], ["reading", true], "Reading is further than Want to Read");
});

test("Paused on Hardcover matches Want to Read here and sends nothing", () => {
  const data = { backlog: [{ id: "b1", title: "Dune", category: "Books", mediaSource: "hardcover", mediaId: "dune" }], entries: [] };
  const p = H.plan(remote([row(1, "dune", "Dune", 4)]), data, "Books", {}, new Set());
  assert.deepStrictEqual([p.titles[0].push, p.titles[0].pull], [false, false]);
});

test("a removed or skipped book isn't offered again", () => {
  const data = { backlog: [], entries: [] };
  assert.strictEqual(H.plan(remote([row(1, "dune", "Dune", 1)]), data, "Books", { dune: "want" }, new Set()).fresh.length, 0);
  assert.strictEqual(H.plan(remote([row(1, "dune", "Dune", 1)]), data, "Books", {}, new Set(["hardcover:dune"])).fresh.length, 0);
});

test("fresh books: Read to the Timeline (noted when undated), the rest to the backlog", () => {
  const r = remote([row(1, "a", "A", 3, { finished: "2026-10-05" }), row(2, "b", "B", 3), row(3, "c", "C", 2, { started: "2026-11-02" }), row(4, "d", "D", 5)]);
  const recs = H.freshRecords(r, "Books", TODAY);
  assert.deepStrictEqual(recs.entries.map((x) => [x.entry.title, x.entry.month, x.entry.day || 0]), [["A", 10, 5], ["B", 11, 0]]);
  assert.ok(/didn't say when/.test(recs.entries[1].entry.notes));
  assert.deepStrictEqual(recs.backlog.map((x) => [x.item.title, x.item.startedAt || "", !!x.item.dropped]), [["C", "2026-11-02", false], ["D", "", true]]);
});

test("Read on Hardcover after you finished it here and started again: a re-read comes back in progress", () => {
  const data = { backlog: [], entries: [{ id: "e1", title: "Dune", category: "Books", year: 2025, month: 3, date: "2025-03", mediaSource: "hardcover", mediaId: "dune" }] };
  const p = H.plan(remote([row(1, "dune", "Dune", 2, { started: "2026-11-10" })]), data, "Books", { dune: "read" }, new Set());
  H.applyPlan(p, data, TODAY, NOW);
  assert.deepStrictEqual([data.backlog.length, data.backlog[0].startedAt, data.backlog[0].mediaId], [1, "2026-11-10", "dune"]);
});

test("only books added after connecting are sent as new", () => {
  const data = { backlog: [
    { id: "old", title: "Old", category: "Books", mediaSource: "hardcover", mediaId: "old", createdAt: "2026-01-01T00:00:00Z" },
    { id: "new", title: "New", category: "Books", mediaSource: "hardcover", mediaId: "new", createdAt: "2026-11-14T00:00:00Z" },
    { id: "ol", title: "Other", category: "Books", mediaSource: "openlibrary", mediaId: "OL9", createdAt: "2026-11-14T00:00:00Z" },
    { id: "film", title: "Film", category: "Movies", createdAt: "2026-11-14T00:00:00Z" },
  ], entries: [] };
  const out = H.localOnly(data, "Books", new Set(), "2026-11-13T00:00:00Z", {}, new Set());
  assert.deepStrictEqual(out.map((o) => [o.x.id, o.linked]), [["new", true], ["ol", false]]);
});

test("auto-sync interval", () => {
  assert.ok(H.due("open", 0, 11 * 60 * 1000));
  assert.ok(!H.due("open", 0, 5 * 60 * 1000));
  assert.ok(!H.due("0", 0, 1e12));
  assert.ok(H.due("1", 0, 25 * 3600 * 1000));
});

console.log(`\n${passed} passed`);
