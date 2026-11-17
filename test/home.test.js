// Zero-dependency tests for src/home.js's pure parts — `node test/home.test.js`.
// The Backlog, Finance and Habits it reads are the app's own, loaded the way
// the bridge loads them.
const assert = require("assert");
const { load } = require("../bridge/load.js");
const { Backlog, Finance, Habits, Home, Tasks } = load();

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

const today = Finance.localDateStr(new Date());
const at = (n) => Finance.addDaysStr(today, n);
const deps = { Backlog, Finance, Habits };

test("a saved section order keeps what it knows and adds what's new at the end", () => {
  assert.deepStrictEqual(Home.sectionOrder(undefined), ["progress", "upcoming", "scratchpad", "pinned", "ledger", "invest", "calendar", "pick", "year"]);
  assert.deepStrictEqual(Home.sectionOrder(["pinned", "nope", "progress", "pinned"]), ["pinned", "progress", "upcoming", "scratchpad", "ledger", "invest", "calendar", "pick", "year"]);
});

test("floors: a new Home shows In progress, Coming up and Scratchpad only", () => {
  assert.deepStrictEqual(Home.DEFAULT_FLOORS, [["progress"], ["upcoming", "scratchpad"]]);
  // nothing arranged: the app's own default order and nothing hidden
  assert.deepStrictEqual(Home.floorLayout(undefined, { order: ["progress", "upcoming", "scratchpad", "pinned"], hidden: [] }), Home.DEFAULT_FLOORS);
  assert.deepStrictEqual(Home.floorLayout(undefined, {}), Home.DEFAULT_FLOORS);
  assert.deepStrictEqual(Home.hiddenOf(Home.DEFAULT_FLOORS), ["pinned", "ledger", "invest", "calendar", "pick", "year"]);
});

test("floors: the old order turns into the rows it made, halves two or three across", () => {
  assert.deepStrictEqual(Home.legacyFloors(Home.SECTION_IDS), [["progress"], ["upcoming", "scratchpad"], ["pinned", "ledger"]]);
  // Investments came after floors: it never joins an old row, it gets its own at the bottom; Calendar starts hidden.
  assert.deepStrictEqual(Home.floorLayout(undefined, { order: ["pinned", "invest", "progress", "upcoming", "scratchpad"], hidden: ["progress"] }),
    [["pinned", "upcoming"], ["scratchpad", "ledger"], ["invest"]]);
});

test("floors: saved floors lose hidden, unknown and repeated sections and empty floors, and what's not on them stays hidden", () => {
  assert.deepStrictEqual(Home.floorLayout([["ledger", "nope"], [], ["progress", "ledger"], "x", ["pinned"]], { hidden: ["pinned"] }),
    [["ledger"], ["progress"]]);
  // a layout saved before Calendar existed doesn't grow one
  const before = [["progress"], ["upcoming", "scratchpad"], ["pinned", "ledger"], ["invest"]];
  assert.deepStrictEqual(Home.floorLayout(before, { hidden: [] }), before);
  assert.deepStrictEqual(Home.hiddenOf(before), ["calendar", "pick", "year"]);
  assert.deepStrictEqual(Home.floorLayout([], {}), []);
});

test("floors: dropping into a floor with room, into a full one, and between floors", () => {
  const f = [["progress"], ["upcoming", "scratchpad", "pinned"], ["ledger"]];
  assert.deepStrictEqual(Home.placeSection(f, "ledger", { floor: 0, at: 1 }, 3), { floors: [["progress", "ledger"], ["upcoming", "scratchpad", "pinned"]], pushed: null });
  assert.deepStrictEqual(Home.placeSection(f, "ledger", { floor: 1, at: 0 }, 3), { floors: [["progress"], ["ledger", "upcoming", "scratchpad"], ["pinned"]], pushed: "pinned" });
  // dropped last into a full floor, the one before it goes down instead
  assert.deepStrictEqual(Home.placeSection(f, "ledger", { floor: 1, at: 3 }, 3).floors, [["progress"], ["upcoming", "scratchpad", "ledger"], ["pinned"]]);
  assert.deepStrictEqual(Home.placeSection(f, "pinned", { floor: 1, newFloor: true }, 3).floors, [["progress"], ["pinned"], ["upcoming", "scratchpad"], ["ledger"]]);
  assert.deepStrictEqual(Home.placeSection(f, "progress", { floor: 9, newFloor: true }, 3).floors, [["upcoming", "scratchpad", "pinned"], ["ledger"], ["progress"]]);
  // put back where it was, nothing changes
  for (const id of ["progress", "scratchpad", "ledger"]) assert.deepStrictEqual(Home.placeSection(f, id, Home.placeOf(f, id), 3).floors, f);
});

test("floors: how many fit across, and the arrows swap neighbours in reading order", () => {
  assert.deepStrictEqual([300, 380, 783, 784, 1188, 1400, 1880].map(Home.perFloor), [1, 1, 1, 2, 3, 3, 4]);
  assert.deepStrictEqual(Home.swapSections([["progress"], ["upcoming", "scratchpad"]], "upcoming", -1), [["upcoming"], ["progress", "scratchpad"]]);
  assert.deepStrictEqual(Home.swapSections([["progress"], ["upcoming"]], "upcoming", 1), [["progress"], ["upcoming"]]);
});

test("in progress is what's started and not dropped, newest start first", () => {
  const data = { backlog: [
    { id: "a", title: "A", startedAt: at(-5) }, { id: "b", title: "B", startedAt: at(-1) },
    { id: "c", title: "C", startedAt: at(-2), dropped: true }, { id: "d", title: "D" },
  ] };
  assert.deepStrictEqual(Home.inProgress(data).map((b) => b.id), ["b", "a"]);
});

test("coming up lists what's known to the day, inside the window, soonest first", () => {
  const data = {
    backlog: [
      { id: "r1", title: "Out today", category: "Games", releaseDate: today, releasePrecision: "day" },
      { id: "r2", title: "Next week", category: "Games", releaseDate: at(8), releasePrecision: "day" },
      { id: "r3", title: "Sometime", category: "Games", releaseDate: today.slice(0, 7), releasePrecision: "month" },
      { id: "r4", title: "Too far", category: "Games", releaseDate: at(30), releasePrecision: "day" },
      { id: "r5", title: "Dropped", category: "Games", releaseDate: at(2), releasePrecision: "day", dropped: true },
      { id: "e1", title: "Show", category: "Shows", nextAt: at(3), nextLabel: "S2 E5", releaseDate: "2024-01-01", releasePrecision: "day" },
    ],
    recurringExpenses: [{ id: "c1", startDate: at(4), interval: "monthly", amount: 12.5, category: "Subscriptions", note: "Music" }],
    habits: [],
  };
  const rows = Home.comingUp(data, today, deps);
  assert.deepStrictEqual(rows.map((r) => [r.kind, r.title, r.day]), [
    ["release", "Out today", today], ["episode", "Show", at(3)], ["charge", "Music", at(4)], ["release", "Next week", at(8)],
  ]);
  assert.strictEqual(rows[1].label, "S2 E5");
  assert.strictEqual(rows[2].amount, 12.5);
  assert.ok(Home.comingUp(data, today, { ...deps, days: 40 }).some((r) => r.title === "Too far"));
});

test("habits still to do today are one row; a weekly goal short of its target is its own", () => {
  const data = { backlog: [], recurringExpenses: [], habits: [
    { id: "h1", name: "Read", cadence: "daily", target: 1, order: 0, startedAt: at(-10), marks: {} },
    { id: "h2", name: "Walk", cadence: "daily", target: 1, order: 1, startedAt: at(-10), marks: {} },
    { id: "h3", name: "Gym", period: "week", target: 3, order: 2, startedAt: at(-10), marks: {} },
  ].map(Habits.sanitizeHabit) };
  const rows = Home.comingUp(data, today, deps).filter((r) => r.kind === "habit");
  // Found by period, not position: on the last day of a week the weekly
  // goal is due today too and can sort first.
  const daily = rows.find((r) => r.period === "day");
  assert.ok(daily, JSON.stringify(rows));
  assert.strictEqual(daily.title, "Read, Walk");
  assert.strictEqual(daily.count, 2);
  const gym = rows.find((r) => r.title === "Gym");
  assert.ok(gym && gym.period === "week" && gym.target === 3 && gym.done === 0, JSON.stringify(rows));
});

test("tasks with a date come up, overdue ones first, done and undated ones not", () => {
  const data = { backlog: [], recurringExpenses: [], habits: [], notes: [{ id: "L", kind: "list", text: "Trip", category: "Travel", items: [
    { id: "a", text: "Late", date: at(-2) }, { id: "b", text: "Today later", date: today, time: "18:00" }, { id: "c", text: "Today early", date: today, time: "08:00" },
    { id: "d", text: "Done", date: today, done: true }, { id: "e", text: "Undated" }, { id: "f", text: "Far", date: at(30) }] }] };
  const rows = Home.comingUp(data, today, { ...deps, Tasks });
  assert.deepStrictEqual(rows.map((r) => [r.kind, r.title, r.list, r.category]), [
    ["task", "Late", "Trip", "Travel"], ["task", "Today early", "Trip", "Travel"], ["task", "Today later", "Trip", "Travel"]]);
  assert.strictEqual(Home.bucketOf(at(-2), today), "Overdue");
  // Without Tasks (an older caller) nothing changes.
  assert.strictEqual(Home.comingUp(data, today, deps).length, 0);
});

test("days fall under Today, Tomorrow, This week and Later", () => {
  assert.strictEqual(Home.bucketOf(today, today), "Today");
  assert.strictEqual(Home.bucketOf(at(1), today), "Tomorrow");
  assert.strictEqual(Home.bucketOf(at(6), today), "This week");
  assert.strictEqual(Home.bucketOf(at(7), today), "Later");
});

test("pinned notes are the ones marked pinned, last edited first", () => {
  const data = { notes: [
    { id: "a", pinned: true, createdAt: "2026-01-01" }, { id: "b", createdAt: "2026-03-01" },
    { id: "c", pinned: true, createdAt: "2026-01-02", editedAt: "2026-04-01" },
  ] };
  assert.deepStrictEqual(Home.pinnedNotes(data).map((n) => n.id), ["c", "a"]);
});

test("the Ledger card: this month so far against last month by the same day, recurring once charged", () => {
  const data = {
    financeEntries: [
      { id: "f1", date: "2026-03-02", amount: 30, category: "Food", note: "Lunch", createdAt: "a" },
      { id: "f2", date: "2026-03-30", amount: 70, category: "Home", createdAt: "b" },
      { id: "f3", date: "2026-02-10", amount: 40, category: "Food" },
      { id: "f4", date: "2026-02-28", amount: 25, category: "Food" },
      { id: "f5", date: "2026-04-01", amount: 999, category: "Food" },
      { id: "f6", date: "2026-03-05", amount: 200, category: "Trip", project: "Rome" },
    ],
    recurringExpenses: [{ id: "r1", startDate: "2026-01-15", interval: "monthly", amount: 10, category: "Subs", note: "Music" }],
  };
  const g = Home.ledgerGlance(data, "2026-03-31", { Finance });
  assert.strictEqual(g.total, 30 + 70 + 200 + 10);
  // February has no 31st: the same day is its last.
  assert.strictEqual(g.lastByNow, 40 + 25 + 10);
  assert.strictEqual(g.lastTotal, 75);
  assert.deepStrictEqual(g.categories.map((c) => c.name), ["Trip", "Home", "Food", "Subs"]);
  assert.deepStrictEqual(g.latest.map((f) => (f.virtual ? f.recurringId : f.id)), ["f2", "r1", "f6", "f1"]);
  const early = Home.ledgerGlance(data, "2026-03-03", { Finance });
  assert.strictEqual(early.total, 30);
  assert.strictEqual(early.lastByNow, 0);
  assert.strictEqual(Home.ledgerGlance({}, "2026-03-03", { Finance }).hasLast, false);
});

test("a calendar month: finished entries by day (no day kept apart, oldest added first), open tasks and releases", () => {
  const data = {
    entries: [
      { id: "e1", title: "Late", year: 2026, month: 11, day: 4, createdAt: "2026-11-05T10:00:00Z" },
      { id: "e2", title: "Early", year: 2026, month: 11, day: 4, createdAt: "2026-11-04T10:00:00Z" },
      { id: "e3", title: "No day", year: 2026, month: 11, createdAt: "2026-11-01T10:00:00Z" },
      { id: "e4", title: "October", year: 2026, month: 10, day: 4 },
      { id: "e5", title: "Day 31 of a 30-day month", year: 2026, month: 11, day: 31 },
    ],
    notes: [{ id: "n1", kind: "list", text: "Errands", items: [
      { id: "t1", text: "Bins", date: "2026-11-17" }, { id: "t2", text: "Done", date: "2026-11-17", done: true }, { id: "t3", text: "December", date: "2026-12-01" },
    ] }],
    backlog: [
      { id: "b1", title: "Out", category: "Games", releaseDate: "2026-11-20", releasePrecision: "day" },
      { id: "b2", title: "Gone", category: "Games", releaseDate: "2026-11-21", releasePrecision: "day", dropped: true },
    ],
  };
  const mo = Home.calendarMonth(data, 2026, 11, { Backlog, Tasks });
  assert.strictEqual(mo.days, 30);
  assert.deepStrictEqual(mo.byDay.get(4).map((e) => e.id), ["e2", "e1"]);
  assert.deepStrictEqual(mo.undated.map((e) => e.id).sort(), ["e3", "e5"]);
  assert.deepStrictEqual(mo.tasksByDay.get(17).map((r) => r.item.id), ["t1"]);
  assert.deepStrictEqual([...mo.rel.byDay.keys()], [20]);
  assert.strictEqual(Home.calendarMonth(data, 2026, 11, { Backlog, Tasks, releases: false }).rel.byDay.size, 0);
});

test("the year so far: finished against last year by the same date, tasks, spending and the best habit run", () => {
  const data = {
    entries: [
      { id: "a", title: "A", category: "Games", year: 2026, month: 3, day: 4 },
      { id: "b", title: "B", category: "Books", year: 2026, month: 11 },
      { id: "c", title: "C", category: "Games", year: 2026, month: 1, day: 9 },
      { id: "l1", title: "Before", category: "Games", year: 2025, month: 11, day: 17 },
      { id: "l2", title: "After", category: "Games", year: 2025, month: 11, day: 18 },
      { id: "l3", title: "Month only, this month", category: "Games", year: 2025, month: 11 },
      { id: "l4", title: "Month only, earlier", category: "Games", year: 2025, month: 10 },
    ],
    notes: [{ id: "n", kind: "list", items: [
      { id: "t1", text: "x", done: true, doneAt: "2026-02-01T10:00:00Z" }, { id: "t2", text: "y", done: true, doneAt: "2025-12-31T10:00:00Z" }, { id: "t3", text: "z" },
    ] }],
    financeEntries: [{ id: "f1", date: "2026-01-05", amount: 10 }, { id: "f2", date: "2025-12-31", amount: 99 }, { id: "f3", date: "2026-11-20", amount: 5 }],
    recurringExpenses: [{ id: "r1", startDate: "2026-11-01", interval: "monthly", amount: 7, category: "Subs" }],
    habits: [],
  };
  const g = Home.yearSoFar(data, "2026-11-17", { Finance, Habits });
  assert.strictEqual(g.finished, 3);
  assert.strictEqual(g.lastByNow, 2);
  assert.strictEqual(g.hasLast, true);
  assert.deepStrictEqual(g.categories, [{ name: "Games", n: 2 }, { name: "Books", n: 1 }]);
  assert.strictEqual(g.tasksDone, 1);
  assert.strictEqual(g.spent, 17);
  assert.strictEqual(g.streak, null);
  assert.strictEqual(Home.yearSoFar({}, "2026-11-17", {}).hasLast, false);
});

console.log(`\n${passed} test(s) passed.`);
