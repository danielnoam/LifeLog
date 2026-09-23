// Zero-dependency tests for src/recap.js's pure half — `node test/recap.test.js`.
// The recap is a thing you read once a year, so the bar is that it never says
// anything untrue and never pads itself with a slide that has nothing to say.
const assert = require("assert");
global.window = {};
require("../src/habits.js");
global.window.LifeLogHabits.init({
  uid: () => "h", backfillUpdatedAt: (i) => i.updatedAt || "1970-01-01T00:00:00.000Z",
  keepUnknown: (src, out) => out,
});
require("../src/recap.js");
const Recap = global.window.LifeLogRecap;
Recap.init({
  MONTHS: ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"],
});

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

const entry = (o) => ({ title: "T", category: "Games", year: 2026, month: 3, date: "2026-03", ...o });
const money = (n) => "₪" + n.toFixed(2);
const ids = (slides) => slides.map((s) => s.id);
const byId = (slides, id) => slides.find((s) => s.id === id);
const build = (data, year) => Recap.buildRecap(data, year, money);

console.log("\nempty and near-empty years");

test("a year with nothing in it produces no slides at all", () => {
  assert.deepStrictEqual(build({ entries: [], notes: [], todos: [] }, 2026), []);
});

test("a single logged entry still opens, but skips everything it can't support", () => {
  const s = build({ entries: [entry({ title: "One" })] }, 2026);
  assert.ok(ids(s).includes("opening"));
  assert.ok(ids(s).includes("logged"));
  // Two entries is not a busiest month, one category is not a breakdown, and
  // one viewing is not a thing you came back to.
  assert.ok(!ids(s).includes("month"), "no busiest month from one entry");
  assert.ok(!ids(s).includes("categories"), "no category breakdown from one category");
  assert.ok(!ids(s).includes("repeated"), "nothing was repeated");
});

test("a slide is dropped rather than shown empty", () => {
  const s = build({ entries: [entry({}), entry({}), entry({})], notes: [], todos: [], financeEntries: [] }, 2026);
  assert.ok(!ids(s).includes("notes"));
  assert.ok(!ids(s).includes("todos"));
  assert.ok(!ids(s).includes("spend"));
  assert.ok(!ids(s).includes("achievements"));
});

console.log("\nwhat it says");

test("the count and the unique count are both right, and agree", () => {
  const data = { entries: [entry({ title: "A" }), entry({ title: "A" }), entry({ title: "B" })] };
  const s = byId(build(data, 2026), "logged");
  assert.strictEqual(s.value, 3);
  // The headline must not repeat the number that is already the slide's
  // whole point — "3" above "3 things logged" reads as a stutter.
  assert.strictEqual(s.headline, "things logged");
  assert.ok(!/3/.test(s.headline), "the count appears once, as the value");
  assert.strictEqual(s.sub, "2 of them different");
});

test("with nothing repeated it doesn't claim a unique count", () => {
  const data = { entries: [entry({ title: "A" }), entry({ title: "B" })] };
  assert.strictEqual(byId(build(data, 2026), "logged").sub, "");
});

test("the busiest month is named, not numbered", () => {
  const data = { entries: [
    entry({ month: 7 }), entry({ month: 7 }), entry({ month: 7 }), entry({ month: 2 }),
  ] };
  const s = byId(build(data, 2026), "month");
  assert.strictEqual(s.value, "July");
  assert.strictEqual(s.sub, "3 things logged");
});

test("last year is compared against, and only when there is a last year", () => {
  const withPrev = { entries: [
    entry({ title: "A" }), entry({ title: "B" }),
    entry({ title: "C", year: 2025 }),
  ] };
  assert.strictEqual(byId(build(withPrev, 2026), "logged").foot, "up 1 on last year");
  const noPrev = { entries: [entry({ title: "A" }), entry({ title: "B" })] };
  assert.strictEqual(byId(build(noPrev, 2026), "logged").foot, "");
});

test("an unchanged year says nothing rather than 'the same as last year'", () => {
  const data = { entries: [entry({ title: "A" }), entry({ title: "B", year: 2025 })] };
  assert.strictEqual(byId(build(data, 2026), "logged").foot, "");
});

test("only things rated 4 or better are called a highlight", () => {
  const meh = { entries: [entry({ title: "A", rating: 3 }), entry({ title: "B", rating: 2 })] };
  assert.strictEqual(byId(build(meh, 2026), "rated"), undefined, "a 3-star year has no best-of");
  const good = { entries: [entry({ title: "A", rating: 5 }), entry({ title: "B", rating: 3 })] };
  const s = byId(build(good, 2026), "rated");
  assert.strictEqual(s.headline, "The ones you loved");
  assert.deepStrictEqual(s.list.map((x) => x.label), ["A"], "the 3-star one is not a highlight");
});

test("a title logged twice takes one slot, at its best rating", () => {
  const data = { entries: [entry({ title: "Dune", rating: 4 }), entry({ title: "Dune", rating: 5 })] };
  const s = byId(build(data, 2026), "rated");
  assert.strictEqual(s.list.length, 1);
  assert.strictEqual(s.list[0].note, "★★★★★");
});

test("the backlog slide counts what came off it and how long one waited", () => {
  const data = { entries: [
    entry({ title: "Old", date: "2026-06", backlogAddedAt: "2024-01-01T00:00:00.000Z" }),
    entry({ title: "New", date: "2026-06", backlogAddedAt: "2026-05-01T00:00:00.000Z" }),
  ] };
  const s = byId(build(data, 2026), "backlog");
  assert.strictEqual(s.value, 2);
  assert.ok(/had been waiting 2\d months/.test(s.sub), s.sub);
});

test("a backlog that grew says so, and one that shrank says the opposite", () => {
  const bl = (n, y) => Array.from({ length: n }, (_, i) => ({ id: "b" + i, createdAt: y + "-02-01T00:00:00.000Z" }));
  const grew = byId(build({ backlog: bl(9, 2026), entries: [entry({ backlogAddedAt: "2025-01-01T00:00:00.000Z" })] }, 2026), "backlog-grew");
  assert.ok(/it grew by 8/.test(grew.sub), grew.sub);
  const ahead = byId(build({
    backlog: bl(3, 2026),
    entries: Array.from({ length: 5 }, () => entry({ backlogAddedAt: "2025-01-01T00:00:00.000Z" })),
  }, 2026), "backlog-grew");
  assert.ok(/you're ahead/.test(ahead.sub), ahead.sub);
});

test("spending is formatted by the caller, never by the recap", () => {
  const data = { financeEntries: [
    { id: "f1", amount: 100, category: "Food", date: "2026-03-01" },
    { id: "f2", amount: 40, category: "Fuel", date: "2026-04-01" },
    { id: "f3", amount: 60, category: "Food", date: "2026-05-01" },
  ] };
  const s = byId(build(data, 2026), "spend");
  assert.strictEqual(s.value, "₪200.00");
  assert.ok(/Most of it on Food \(₪160\.00\)/.test(s.sub), s.sub);
});

test("a skipped expense is not spending", () => {
  const data = { financeEntries: [
    { id: "f1", amount: 100, category: "Food", date: "2026-03-01" },
    { id: "f2", amount: 999, category: "Food", date: "2026-03-01", skipped: true },
  ] };
  assert.strictEqual(byId(build(data, 2026), "spend").value, "₪100.00");
});

test("the year-on-year spend line is a percentage of the right direction", () => {
  const data = { financeEntries: [
    { id: "a", amount: 150, category: "Food", date: "2026-03-01" },
    { id: "b", amount: 100, category: "Food", date: "2025-03-01" },
  ] };
  assert.ok(/50% more than 2025/.test(byId(build(data, 2026), "spend").foot));
});

test("only to-dos finished in that year count, and only if there are a few", () => {
  const td = (y, done = true) => ({ id: "t" + Math.random(), done, doneAt: y + "-05-01T00:00:00.000Z" });
  assert.strictEqual(byId(build({ todos: [td(2026), td(2026)] }, 2026), "todos"), undefined, "two is not a story");
  const s = byId(build({ todos: [td(2026), td(2026), td(2026), td(2025)] }, 2026), "todos");
  assert.strictEqual(s.value, 3);
  assert.strictEqual(byId(build({ todos: [td(2026, false), td(2026, false), td(2026, false)] }, 2026), "todos"), undefined,
    "unfinished to-dos are not ticked off");
});

test("achievements come through verbatim", () => {
  const data = { accomplishments: { 2026: [{ text: "Ran a half marathon" }] } };
  const s = byId(build(data, 2026), "achievements");
  assert.strictEqual(s.headline, "The thing you're proud of");
  assert.strictEqual(s.list[0].label, "Ran a half marathon");
});

test("no big slide says its own number twice", () => {
  const data = {
    entries: [entry({ title: "A" }), entry({ title: "B" })],
    notes: [{ id: "n", createdAt: "2026-04-01T00:00:00.000Z" }],
    todos: Array.from({ length: 4 }, (_, i) => ({ id: "t" + i, done: true, doneAt: "2026-05-01T00:00:00.000Z" })),
    backlog: Array.from({ length: 5 }, (_, i) => ({ id: "b" + i, createdAt: "2026-02-01T00:00:00.000Z" })),
  };
  for (const s of build(data, 2026)) {
    if (s.kind !== "big" || typeof s.value !== "number") continue;
    assert.ok(!new RegExp("\\b" + s.value + "\\b").test(s.headline),
      s.id + " repeats its value in the headline: " + s.value + " / " + s.headline);
  }
});

test("the closing line only lists what actually happened", () => {
  const data = { entries: [entry({}), entry({})], notes: [{ id: "n", createdAt: "2026-04-01T00:00:00.000Z" }] };
  const s = byId(build(data, 2026), "closing");
  assert.strictEqual(s.sub, "2 things logged, 1 note. On to the next one.");
});

console.log("\nshowing things, not counting them");

test("the wall carries one tile per title, not one per logging", () => {
  const data = { entries: [
    entry({ title: "Dune", coverUrl: "" }),
    entry({ title: "Dune", coverUrl: "c.jpg", rating: 5 }),
    entry({ title: "Hyperion" }),
    entry({ title: "Celeste", category: "Games" }),
  ] };
  const g = byId(build(data, 2026), "gallery");
  assert.strictEqual(g.items.length, 3);
  // The showing that has art wins, so the wall doesn't lose a picture it had.
  const dune = g.items.find((i) => i.title === "Dune");
  assert.strictEqual(dune.coverUrl, "c.jpg");
  assert.strictEqual(dune.rating, 5);
});

test("a thing with no cover still gets a tile", () => {
  const data = { entries: [entry({ title: "A" }), entry({ title: "B" }), entry({ title: "C" })] };
  const g = byId(build(data, 2026), "gallery");
  assert.strictEqual(g.items.length, 3);
  assert.ok(g.items.every((i) => i.coverUrl === ""), "no art, but every one is on the wall");
  assert.ok(g.items.every((i) => i.category), "each keeps its category, which is what tints its tile");
});

test("the wall groups by category, and sorts the best first inside each", () => {
  const data = { entries: [
    entry({ title: "Zed", category: "Games", rating: 2 }),
    entry({ title: "Alpha", category: "Games", rating: 5 }),
    entry({ title: "Beta", category: "Film", rating: 3 }),
  ] };
  const g = byId(build(data, 2026), "gallery");
  assert.deepStrictEqual(g.items.map((i) => i.title), ["Beta", "Alpha", "Zed"]);
});

test("a very full year says it is holding some back rather than showing 400 tiles", () => {
  const many = Array.from({ length: 60 }, (_, i) => entry({ title: "T" + i }));
  const g = byId(build({ entries: many }, 2026), "gallery");
  assert.strictEqual(g.items.length, 48);
  assert.ok(/Showing the first 48/.test(g.foot), g.foot);
  const few = byId(build({ entries: many.slice(0, 10) }, 2026), "gallery");
  assert.strictEqual(few.foot, "", "and says nothing when it is showing everything");
});

test("two entries is not a wall", () => {
  assert.strictEqual(byId(build({ entries: [entry({ title: "A" }), entry({ title: "B" })] }, 2026), "gallery"), undefined);
});

test("the notes slide carries the notes themselves, newest first", () => {
  const data = { notes: [
    { id: "n1", text: "older", createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "n2", text: "newer", createdAt: "2026-08-01T00:00:00.000Z" },
  ] };
  const s = byId(build(data, 2026), "notes");
  assert.strictEqual(s.kind, "cards");
  assert.deepStrictEqual(s.cards.map((c) => c.text), ["newer", "older"]);
  assert.strictEqual(s.cards[0].date, "2026-08-01");
  // The count is still the first thing you read.
  assert.strictEqual(s.headline, "2 notes written");
});

test("a note's text comes through untouched, line breaks and all", () => {
  const text = "A line\nand another\n\nwith a gap";
  const s = byId(build({ notes: [{ id: "n", text, createdAt: "2026-02-01T00:00:00.000Z" }] }, 2026), "notes");
  assert.strictEqual(s.cards[0].text, text);
});

test("a year of heavy note-taking shows the recent ones and says so", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: "n" + i, text: "note " + i,
    createdAt: "2026-" + String(1 + (i % 9)).padStart(2, "0") + "-01T00:00:00.000Z",
  }));
  const s = byId(build({ notes: many }, 2026), "notes");
  assert.strictEqual(s.cards.length, 12);
  assert.ok(/Showing the most recent 12/.test(s.foot), s.foot);
});

test("'most of them in X' only when a month actually leads", () => {
  const note = (iso) => ({ id: "n" + Math.random(), text: "t", createdAt: iso });
  // Four notes in four months: no month leads, so it says nothing.
  const spread = byId(build({ notes: [
    note("2026-02-01T00:00:00.000Z"), note("2026-04-01T00:00:00.000Z"),
    note("2026-06-01T00:00:00.000Z"), note("2026-08-01T00:00:00.000Z"),
  ] }, 2026), "notes");
  assert.strictEqual(spread.sub, "", "a four-way tie of one is not a busiest month");
  // A real lead does get named.
  const leader = byId(build({ notes: [
    note("2026-03-01T00:00:00.000Z"), note("2026-03-02T00:00:00.000Z"),
    note("2026-03-03T00:00:00.000Z"), note("2026-08-01T00:00:00.000Z"),
  ] }, 2026), "notes");
  assert.strictEqual(leader.sub, "Most of them in March");
  // A two-way tie at the top is not a lead either.
  const tie = byId(build({ notes: [
    note("2026-03-01T00:00:00.000Z"), note("2026-03-02T00:00:00.000Z"),
    note("2026-08-01T00:00:00.000Z"), note("2026-08-02T00:00:00.000Z"),
  ] }, 2026), "notes");
  assert.strictEqual(tie.sub, "");
});

test("the best-of list carries cover art where there is any", () => {
  const data = { entries: [
    entry({ title: "With art", rating: 5, coverUrl: "a.jpg" }),
    entry({ title: "Without", rating: 5 }),
  ] };
  const s = byId(build(data, 2026), "rated");
  assert.strictEqual(s.list.find((x) => x.label === "With art").coverUrl, "a.jpg");
  assert.strictEqual(s.list.find((x) => x.label === "Without").coverUrl, "");
});

console.log("\nhabits in the recap");

const habit = (o) => ({ id: "h" + Math.random(), name: "Read", color: "#5b8cff",
  cadence: "daily", target: 1, startedAt: "2026-01-01", ...o });
const run = (from, n) => {
  const m = {};
  const d = new Date(from + "T00:00:00");
  for (let i = 0; i < n; i++) { m[d.toISOString().slice(0, 10)] = 1; d.setDate(d.getDate() + 1); }
  return m;
};

test("a year's best run gets a slide, with the habit named", () => {
  const s = byId(build({ habits: [habit({ name: "Read", marks: run("2026-02-01", 9) })] }, 2026), "habit-streak");
  assert.strictEqual(s.value, 9);
  assert.ok(/your best run of Read/.test(s.sub), s.sub);
  assert.ok(/kept it 9 of \d+ days/.test(s.foot), s.foot);
});

test("two days in a row is not a streak worth a slide", () => {
  assert.strictEqual(byId(build({ habits: [habit({ marks: run("2026-02-01", 2) })] }, 2026), "habit-streak"), undefined);
});

test("a habit with nothing recorded that year is not in the recap at all", () => {
  const s = build({ habits: [habit({ marks: run("2025-02-01", 20) })] }, 2026);
  assert.deepStrictEqual(s, [], "a year with nothing else in it has no recap either");
});

test("with more than one habit, the recap compares them", () => {
  const s = byId(build({ habits: [
    habit({ name: "Read", marks: run("2026-02-01", 20) }),
    habit({ name: "Run", color: "#e2554b", marks: run("2026-02-01", 6) }),
  ] }, 2026), "habits-kept");
  assert.deepStrictEqual(s.bars.map((b) => b.label), ["Read", "Run"]);
  assert.strictEqual(s.bars[0].n, 20);
  // Each bar carries its own habit's colour rather than borrowing a category's.
  assert.strictEqual(s.bars[1].color, "#e2554b");
});

test("one habit alone is a streak slide, not a comparison", () => {
  const one = build({ habits: [habit({ marks: run("2026-02-01", 9) })] }, 2026);
  assert.ok(one.some((x) => x.id === "habit-streak"));
  assert.ok(!one.some((x) => x.id === "habits-kept"), "nothing to compare it with");
});

test("the closing line counts the days you kept", () => {
  const s = byId(build({ habits: [habit({ marks: run("2026-02-01", 9) })] }, 2026), "closing");
  assert.ok(/9 days of habits kept/.test(s.sub), s.sub);
});

test("a year that is only habits is still a year worth recapping", () => {
  const s = build({ habits: [habit({ marks: run("2026-02-01", 9) })] }, 2026);
  assert.ok(s.some((x) => x.id === "opening"), "it opens");
  assert.ok(s.some((x) => x.id === "habit-streak"));
});

test("turning the Habits mode off takes its slides with it", () => {
  // Habits is Notes' third mode since 0.171.1, so it is turned off the same
  // way To-do is — by (view, mode), not by a view of its own.
  const data = { habits: [
    habit({ name: "Read", marks: run("2026-02-01", 20) }),
    habit({ name: "Run", marks: run("2026-02-01", 9) }),
  ], entries: [entry({ title: "A" }), entry({ title: "B" })] };
  const off = Recap.buildRecap(data, 2026, money, (v, m) => !(v === "notes" && m === "habits"));
  assert.ok(!off.some((x) => ["habit-streak", "habits-kept"].includes(x.id)), off.map((x) => x.id));
  assert.ok(off.some((x) => x.id === "logged"), "and nothing else goes with it");
});

test("turning off the whole Notes tab takes the habits too", () => {
  const data = {
    habits: [habit({ name: "Read", marks: run("2026-02-01", 20) })],
    notes: [{ id: "n", createdAt: "2026-04-01T00:00:00.000Z" }],
    entries: [entry({ title: "A" }), entry({ title: "B" })],
  };
  const s = Recap.buildRecap(data, 2026, money, (v) => v !== "notes");
  assert.ok(!s.some((x) => ["habit-streak", "notes"].includes(x.id)), s.map((x) => x.id));
});

test("a year known only by its habit marks is still offered", () => {
  assert.deepStrictEqual(Recap.recapYears({ habits: [habit({ marks: run("2024-03-01", 3) })] }), [2024]);
});

console.log("\nturned-off tabs and modes");

const rich = () => ({
  entries: [entry({ title: "A", rating: 5 }), entry({ title: "A" }), entry({ title: "B", month: 7 }),
    entry({ title: "C", category: "Film", backlogAddedAt: "2024-01-01T00:00:00.000Z" })],
  backlog: Array.from({ length: 5 }, (_, i) => ({ id: "b" + i, createdAt: "2026-02-01T00:00:00.000Z" })),
  notes: [{ id: "n", createdAt: "2026-04-01T00:00:00.000Z" }],
  todos: Array.from({ length: 4 }, (_, i) => ({ id: "t" + i, done: true, doneAt: "2026-05-01T00:00:00.000Z" })),
  financeEntries: [{ id: "f", amount: 50, category: "Food", date: "2026-03-01" }],
  accomplishments: { 2026: [{ text: "Ran a half marathon" }] },
});
const off = (...views) => (v) => !views.includes(v);

test("with nothing turned off, every slide is offered", () => {
  const all = Recap.buildRecap(rich(), 2026, money, () => true);
  for (const id of ["logged", "backlog", "notes", "todos", "spend", "achievements"]) {
    assert.ok(all.some((s) => s.id === id), "expected " + id);
  }
});

test("a slide about a tab you turned off is not shown at all", () => {
  const s = Recap.buildRecap(rich(), 2026, money, off("finance"));
  assert.ok(!s.some((x) => x.id === "spend"), "the Ledger is off, so spending is not a slide");
  assert.ok(s.some((x) => x.id === "logged"), "and the rest is untouched");
});

test("turning off the Backlog takes both of its slides", () => {
  const s = Recap.buildRecap(rich(), 2026, money, off("backlog"));
  assert.ok(!s.some((x) => ["backlog", "backlog-grew"].includes(x.id)), s.map((x) => x.id));
});

test("a mode counts too — to-dos go with the Notes tab's To-do mode", () => {
  const noTodoMode = Recap.buildRecap(rich(), 2026, money, (v, m) => !(v === "notes" && m === "todo"));
  assert.ok(!noTodoMode.some((x) => x.id === "todos"), "the To-do mode is off");
  assert.ok(noTodoMode.some((x) => x.id === "notes"), "but Notes itself is still on, so its slide stays");
  const noStats = Recap.buildRecap(rich(), 2026, money, (v, m) => !(v === "timeline" && m === "stats"));
  assert.ok(!noStats.some((x) => x.id === "achievements"), "achievements are read in Stats");
  assert.ok(noStats.some((x) => x.id === "logged"), "the Timeline's own slides stay");
});

test("if every tab a slide could belong to is off, there is no recap at all", () => {
  // Not an opening and a closing with nothing between them — "2026" followed
  // by "That was 2026." is two cards of nothing.
  const s = Recap.buildRecap(rich(), 2026, money, off("timeline", "backlog", "notes", "finance"));
  assert.deepStrictEqual(s, []);
});

console.log("\nwhich years, and when it offers itself");

test("every view contributes a year worth recapping", () => {
  const data = {
    entries: [entry({ year: 2024 })],
    notes: [{ id: "n", createdAt: "2022-01-01T00:00:00.000Z" }],
    financeEntries: [{ id: "f", date: "2023-01-01", amount: 1 }],
    accomplishments: { 2021: [{ text: "x" }] },
  };
  assert.deepStrictEqual(Recap.recapYears(data), [2024, 2023, 2022, 2021]);
});

test("it volunteers itself in December, and in the first half of January for the year just gone", () => {
  assert.strictEqual(Recap.yearToOffer(new Date("2026-12-01T12:00:00")), 2026);
  assert.strictEqual(Recap.yearToOffer(new Date("2026-12-31T12:00:00")), 2026);
  assert.strictEqual(Recap.yearToOffer(new Date("2027-01-10T12:00:00")), 2026);
});

test("and stays out of the way the rest of the time", () => {
  assert.strictEqual(Recap.yearToOffer(new Date("2026-11-30T12:00:00")), null);
  assert.strictEqual(Recap.yearToOffer(new Date("2027-01-16T12:00:00")), null, "past mid-January it is an interruption");
  assert.strictEqual(Recap.yearToOffer(new Date("2026-06-15T12:00:00")), null);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
