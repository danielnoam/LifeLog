// Zero-dependency tests for src/home.js's pure parts — `node test/home.test.js`.
// The Backlog, Finance and Habits it reads are the app's own, loaded the way
// the bridge loads them.
const assert = require("assert");
const { load } = require("../bridge/load.js");
const { Backlog, Finance, Habits, Home } = load();

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

const today = Finance.localDateStr(new Date());
const at = (n) => Finance.addDaysStr(today, n);
const deps = { Backlog, Finance, Habits };

test("a saved section order keeps what it knows and adds what's new at the end", () => {
  assert.deepStrictEqual(Home.sectionOrder(undefined), ["progress", "upcoming", "scratchpad", "pinned", "ledger"]);
  assert.deepStrictEqual(Home.sectionOrder(["pinned", "nope", "progress", "pinned"]), ["pinned", "progress", "upcoming", "scratchpad", "ledger"]);
});

test("floors: the old order turns into the rows it made, halves two or three across", () => {
  assert.deepStrictEqual(Home.DEFAULT_FLOORS, [["progress"], ["upcoming", "scratchpad"], ["pinned", "ledger"]]);
  assert.deepStrictEqual(Home.floorLayout(undefined, { order: ["pinned", "progress", "upcoming", "scratchpad"], hidden: ["progress"] }),
    [["pinned", "upcoming"], ["scratchpad", "ledger"]]);
});

test("floors: saved floors lose hidden, unknown and repeated sections and empty floors, and gain new ones at the bottom", () => {
  assert.deepStrictEqual(Home.floorLayout([["ledger", "nope"], [], ["progress", "ledger"], "x", ["pinned"]], { hidden: ["pinned"] }),
    [["ledger"], ["progress"], ["upcoming"], ["scratchpad"]]);
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

console.log(`\n${passed} test(s) passed.`);
