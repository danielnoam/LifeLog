// Zero-dependency tests for src/recap.js's pure half — `node test/recap.test.js`.
// The recap is a thing you read once a year, so the bar is that it never says
// anything untrue and never pads itself with a slide that has nothing to say.
const assert = require("assert");
global.window = {};
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
