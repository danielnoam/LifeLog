// Zero-dependency tests for src/waypage.js's pure parts: reading Waypage's
// activity/reading.json and applying it to the Backlog, the Timeline and a
// minutes habit — run with `node test/waypage.test.js`.
const assert = require("assert");
global.window = {};
require("../src/waypage.js");
const W = global.window.LifeLogWaypage;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}
const NOW = "2026-11-13T10:00:00.000Z", TODAY = "2026-11-13";
const file = (items, days = {}) => JSON.stringify({ schema: 1, app: "waypage", updatedAt: NOW, timeZone: "Asia/Jerusalem", items, days });
const item = (o) => ({ id: "c1", kind: "book", title: "The Quiet Orbit", author: "M. Ellery", collection: "", progress: 0.4, startedAt: "2026-11-02", finishedAt: null, minutes: 120, lastReadAt: "2026-11-12", lengthMinutes: 300, ...o });
const data = (o = {}) => ({ categories: [{ name: "Books" }, { name: "Games" }, { name: "Audiobooks" }], backlog: [], entries: [], habits: [], ...o });
const cfg = (o = {}) => W.cleanConfig({ repo: "me/waypage-data", token: "github_pat_x", kinds: { book: "Books", audiobook: "Audiobooks", comic: "Books", serial: "Books", article: "" }, ...o });
const run = (d, c, items, days) => W.apply(d, c, W.parseActivity(file(items, days)), TODAY, NOW);

test("the file is read only when it's Waypage's, and unknown kinds and fields are left out", () => {
  assert.strictEqual(W.parseActivity("{}"), null);
  assert.strictEqual(W.parseActivity("not json"), null);
  assert.strictEqual(W.parseActivity(JSON.stringify({ schema: 1, app: "other", items: [] })), null);
  const a = W.parseActivity(file([item(), item({ id: "c2", kind: "podcast" }), item({ id: "c3", future: 1, progress: 7 })], { "2026-11-12": { read: 30, listened: 20, items: {} }, bad: { read: 1 } }));
  assert.deepStrictEqual(a.items.map((x) => x.id), ["c1", "c3"]);
  assert.strictEqual(a.items[1].progress, 1, "progress is held to 0..1");
  assert.ok(!("future" in a.items[1]));
  assert.deepStrictEqual(a.days, { "2026-11-12": 50 }, "reading and listening add up; bad days are dropped");
});

test("a new book comes in as in progress, with its % and an id made from Waypage's", () => {
  const d = data(), c = cfg();
  const r = run(d, c, [item()]);
  assert.ok(r.changed);
  assert.strictEqual(d.backlog.length, 1);
  const b = d.backlog[0];
  assert.deepStrictEqual([b.id, b.title, b.category, b.startedAt, b.waypageId, b.waypageProgress, b.author], ["wp-c1", "The Quiet Orbit", "Books", "2026-11-02", "c1", 0.4, "M. Ellery"]);
  assert.ok(c.seen.c1);
});

test("a book already in the backlog is started there, keeping your fields", () => {
  const mine = { id: "b1", title: "The quiet orbit", category: "Books", notes: "mine", coverUrl: "x.png" };
  const d = data({ backlog: [mine] }), c = cfg();
  run(d, c, [item()]);
  assert.strictEqual(d.backlog.length, 1, "no second item");
  assert.deepStrictEqual([mine.waypageId, mine.startedAt, mine.waypageProgress, mine.notes, mine.title], ["c1", "2026-11-02", 0.4, "mine", "The quiet orbit"]);
});

test("finishing it in Waypage moves it to the Timeline on that day, spanning back to its start", () => {
  const mine = { id: "b1", title: "The Quiet Orbit", category: "Books", coverUrl: "x.png", startedAt: "2026-10-20", waypageId: "c1", createdAt: "2026-09-01T00:00:00.000Z" };
  const d = data({ backlog: [mine] }), c = cfg({ seen: { c1: true } });
  const r = run(d, c, [item({ progress: 1, finishedAt: "2026-11-12" })]);
  assert.strictEqual(r.counts.finished, 1);
  assert.strictEqual(d.backlog.length, 0);
  const e = d.entries[0];
  assert.deepStrictEqual([e.year, e.month, e.day, e.startYear, e.startMonth, e.coverUrl, e.waypageId, e.length, e.backlogAddedAt],
    [2026, 11, 12, 2026, 10, "x.png", "c1", "2h", "2026-09-01T00:00:00.000Z"]);
  const again = run(d, c, [item({ progress: 1, finishedAt: "2026-11-12" })]);
  assert.strictEqual(d.entries.length, 1, "a second read of the file changes nothing");
  assert.ok(!again.changed);
});

test("one finished before LifeLog knew it goes straight onto the Timeline", () => {
  const d = data(), c = cfg();
  run(d, c, [item({ finishedAt: "2026-11-01", progress: 1 })]);
  assert.strictEqual(d.backlog.length, 0);
  assert.strictEqual(d.entries[0].id, "wp-c1-2026-11-01");
});

test("one already on the Timeline waits for review, unless it's the same read logged by hand", () => {
  const old = { id: "e1", title: "The Quiet Orbit", category: "Books", year: 2025, month: 3, date: "2025-03" };
  const d = data({ entries: [old] }), c = cfg();
  run(d, c, [item()]);
  assert.strictEqual(d.backlog.length, 0);
  assert.deepStrictEqual([c.review.c1.reason, c.review.c1.match], ["logged", "entries:e1"]);
  const same = { id: "e2", title: "The Quiet Orbit", category: "Books", year: 2026, month: 11, date: "2026-11" };
  const d2 = data({ entries: [same] }), c2 = cfg();
  run(d2, c2, [item({ finishedAt: "2026-11-10", progress: 1 })]);
  assert.strictEqual(same.waypageId, "c1");
  assert.deepStrictEqual(c2.review, {});
  assert.strictEqual(d2.entries.length, 1);
});

test("a different author is a review, not a guess; one blank author isn't a clash", () => {
  const d = data({ backlog: [{ id: "b1", title: "Dune", category: "Books", author: "Someone Else" }] }), c = cfg();
  run(d, c, [item({ title: "Dune", author: "Frank Herbert" })]);
  assert.strictEqual(c.review.c1.reason, "author");
  assert.ok(!d.backlog[0].waypageId);
  const d2 = data({ backlog: [{ id: "b1", title: "Dune", category: "Books" }] }), c2 = cfg();
  run(d2, c2, [item({ title: "Dune", author: "Frank Herbert" })]);
  assert.strictEqual(d2.backlog[0].waypageId, "c1");
});

test("only titles in the categories Waypage fills are matched", () => {
  const d = data({ backlog: [{ id: "g1", title: "The Quiet Orbit", category: "Games" }] }), c = cfg();
  run(d, c, [item()]);
  assert.strictEqual(d.backlog.length, 2, "a game of the same name is left alone");
  assert.ok(!d.backlog[0].waypageId);
});

test("kinds set to Don't bring in, Never, and things you removed stay out", () => {
  const d = data(), c = cfg();
  run(d, c, [item({ id: "a1", kind: "article", title: "An essay" })]);
  assert.strictEqual(d.backlog.length, 0, "articles are off");
  const c2 = cfg({ never: { c1: true } });
  run(d, c2, [item()]);
  assert.strictEqual(d.backlog.length, 0);
  const c3 = cfg();
  run(d, c3, [item()]);
  d.backlog = [];
  run(d, c3, [item()]);
  assert.strictEqual(d.backlog.length, 0, "removed here, not brought back");
});

test("review answers: same links, add makes it new (a re-read on the Timeline), never keeps it out", () => {
  const old = { id: "e1", title: "The Quiet Orbit", category: "Books", year: 2025, month: 3 };
  const d = data({ entries: [old] }), c = cfg();
  run(d, c, [item({ finishedAt: "2026-11-12", progress: 1 })]);
  assert.ok(W.resolve(d, c, "c1", "add", TODAY, NOW));
  assert.strictEqual(d.entries.length, 2);
  assert.ok(c.seen.c1 && !c.review.c1);
  run(d, c, [item({ finishedAt: "2026-11-12", progress: 1 })]);
  assert.strictEqual(d.entries.length, 2);
  const d2 = data({ entries: [{ ...old }] }), c2 = cfg();
  run(d2, c2, [item()]);
  W.resolve(d2, c2, "c1", "same", TODAY, NOW);
  assert.strictEqual(d2.entries[0].waypageId, "c1");
  run(d2, c2, [item()]);
  assert.deepStrictEqual(c2.review, {}, "linked to a finished entry: nothing more to do");
  const c3 = cfg();
  run(data({ entries: [{ ...old }] }), c3, [item()]);
  W.resolve(data(), c3, "c1", "never", TODAY, NOW);
  assert.ok(c3.never.c1);
});

test("serials show chapters; a dropped item isn't restarted", () => {
  const d = data(), c = cfg();
  run(d, c, [item({ id: "s1", kind: "serial", title: "Ashfall", chapters: { read: 31, total: 40 }, progress: 0.78 })]);
  assert.strictEqual(W.progressLabel(d.backlog[0]), "ch 31/40");
  assert.strictEqual(W.progressLabel({ waypageProgress: 0.624 }), "62%");
  d.backlog[0].dropped = true;
  delete d.backlog[0].startedAt;
  run(d, c, [item({ id: "s1", kind: "serial", title: "Ashfall", chapters: { read: 32, total: 40 }, progress: 0.8 })]);
  assert.ok(!d.backlog[0].startedAt);
});

test("minutes fill the habit, and minutes added by hand stay on top", () => {
  const h = { id: "h1", name: "Read", unit: "min", target: 20, marks: { "2026-11-12": 15 } };
  const d = data({ habits: [h] }), c = cfg({ habit: "h1" });
  run(d, c, [], { "2026-11-11": { read: 30, listened: 0 }, "2026-11-12": { read: 10, listened: 25 } });
  assert.deepStrictEqual(h.marks, { "2026-11-11": 30, "2026-11-12": 50 });
  run(d, c, [], { "2026-11-11": { read: 30, listened: 0 }, "2026-11-12": { read: 20, listened: 25 } });
  assert.strictEqual(h.marks["2026-11-12"], 60, "only Waypage's part moved");
  W.moveHabit(d, c, "");
  assert.deepStrictEqual(h.marks, { "2026-11-12": 15 }, "switching habits takes Waypage's minutes back out");
  const count = { id: "h2", name: "Read", target: 1, marks: {} };
  const d2 = data({ habits: [count] });
  run(d2, cfg({ habit: "h2" }), [], { "2026-11-11": { read: 30 } });
  assert.deepStrictEqual(count.marks, {}, "only a minutes habit is filled");
});

test("two devices reading the same file make the same items", () => {
  const a = data(), b = data();
  run(a, cfg(), [item(), item({ id: "c9", title: "Other", finishedAt: "2026-11-05", progress: 1 })]);
  run(b, cfg(), [item(), item({ id: "c9", title: "Other", finishedAt: "2026-11-05", progress: 1 })]);
  assert.deepStrictEqual(a.backlog.map((x) => x.id), b.backlog.map((x) => x.id));
  assert.deepStrictEqual(a.entries.map((x) => x.id), b.entries.map((x) => x.id));
});

test("default kinds use the categories you have", () => {
  assert.deepStrictEqual(W.defaultKinds([{ name: "Games" }, { name: "Books" }, { name: "Audiobooks" }]),
    { book: "Books", audiobook: "Audiobooks", comic: "Books", serial: "Books", article: "" });
  assert.deepStrictEqual(W.defaultKinds([{ name: "Games" }]), { book: "", audiobook: "", comic: "", serial: "", article: "" });
  assert.strictEqual(W.cleanConfig({ repo: "https://github.com/me/waypage-data.git" }).repo, "me/waypage-data");
});

test("Make a token opens GitHub's form filled in: name, owner, a year, contents read", () => {
  const u = new URL(W.tokenUrl("danielnoam/waypage-data"));
  assert.strictEqual(u.origin + u.pathname, "https://github.com/settings/personal-access-tokens/new");
  assert.deepStrictEqual([u.searchParams.get("target_name"), u.searchParams.get("contents"), u.searchParams.get("expires_in"), u.searchParams.get("name")],
    ["danielnoam", "read", "366", "LifeLog reads Waypage"]);
  assert.ok(u.searchParams.get("name").length <= 40);
  assert.strictEqual(new URL(W.tokenUrl("")).searchParams.get("target_name"), null);
});

test("controls: new books wait for a look, or stay out; settings default to how it was", () => {
  assert.deepStrictEqual([cfg().paused, cfg().every, cfg().newMode, cfg().startFinish, cfg().showProgress], [false, "5m", "add", true, true]);
  let d = data(), c = cfg({ newMode: "ask" });
  run(d, c, [item()]);
  assert.strictEqual(d.backlog.length, 0);
  assert.strictEqual(c.review.c1.reason, "new");
  assert.ok(W.resolve(d, c, "c1", "add", TODAY, NOW));
  assert.strictEqual(d.backlog[0].waypageId, "c1");
  d = data(); c = cfg({ newMode: "none" });
  run(d, c, [item()]);
  assert.deepStrictEqual([d.backlog.length, !!c.seen.c1, Object.keys(c.review).length], [0, false, 0], "not seen, so switching back brings it");
  c.newMode = "add";
  run(d, c, [item()]);
  assert.strictEqual(d.backlog.length, 1);
});

test("controls: Start and finish off leaves your books' status alone; Show how far off clears the %", () => {
  const mine = { id: "b1", title: "The Quiet Orbit", category: "Books", startedAt: "2026-10-20", waypageId: "c1", waypageProgress: 0.2 };
  const d = data({ backlog: [mine] }), c = cfg({ seen: { c1: true }, startFinish: false });
  run(d, c, [item({ progress: 1, finishedAt: "2026-11-12" })]);
  assert.deepStrictEqual([d.backlog.length, d.entries.length, mine.waypageProgress], [1, 0, 1], "not finished here, % still shown");
  c.showProgress = false;
  run(d, c, [item({ progress: 1, finishedAt: "2026-11-12" })]);
  assert.ok(!("waypageProgress" in mine));
});

test("controls: unlink keeps the book and keeps Waypage off it; Allow again lets it match again", () => {
  const mine = { id: "b1", title: "The Quiet Orbit", category: "Books", startedAt: "2026-10-20", waypageId: "c1", waypageProgress: 0.2 };
  const d = data({ backlog: [mine] }), c = cfg({ seen: { c1: true } });
  assert.ok(W.unlink(d, c, "backlog", "b1"));
  assert.deepStrictEqual([mine.waypageId, mine.waypageProgress, c.never.c1], [undefined, undefined, "The Quiet Orbit"]);
  run(d, c, [item({ progress: 0.9 })]);
  assert.ok(!mine.waypageId, "never means never");
  assert.ok(W.allowAgain(c, "c1"));
  run(d, c, [item({ progress: 0.9 })]);
  assert.deepStrictEqual([mine.waypageId, mine.waypageProgress, d.backlog.length], ["c1", 0.9, 1], "matched by title again, not added twice");
});

console.log(`\n${passed} passed`);
