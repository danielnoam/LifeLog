// Zero-dependency tests for src/habits.js's pure half — `node test/habits.test.js`.
//
// The streak rules are the feature. Two of them are judgement calls that a
// reader would otherwise have to guess at, so they get tests that say so:
// a cadence day you never promised doesn't break a run, and today doesn't
// count against you until it's over.
const assert = require("assert");
global.window = {};
require("../src/habits.js");
const H = global.window.LifeLogHabits;
let ids = 0;
H.init({
  uid: () => "h" + (ids++),
  backfillUpdatedAt: (i) => i.updatedAt || i.createdAt || "1970-01-01T00:00:00.000Z",
  keepUnknown: (src, out, known) => {
    for (const k of Object.keys(src || {})) if (!known.has(k)) out[k] = src[k];
    return out;
  },
});

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

// 2026-03-02 is a Monday, which every date below is anchored off.
const habit = (o) => H.sanitizeHabit({ name: "Read", startedAt: "2026-03-01", ...o });
const marks = (...dates) => Object.fromEntries(dates.map((d) => [d, 1]));

console.log("\nthe model");

test("a habit is daily unless it names days, and junk days fall back to daily", () => {
  assert.strictEqual(habit({}).cadence, "daily");
  assert.deepStrictEqual(habit({ cadence: { days: [1, 3, 5] } }).cadence, { days: [1, 3, 5] });
  // A habit due on no day is not a habit, it is a thing you can never keep.
  assert.strictEqual(habit({ cadence: { days: [] } }).cadence, "daily");
  assert.strictEqual(habit({ cadence: { days: [9, -2] } }).cadence, "daily");
  // All seven days IS daily — one spelling for one meaning.
  assert.strictEqual(habit({ cadence: { days: [0, 1, 2, 3, 4, 5, 6] } }).cadence, "daily");
});

test("a target is at least one, and rounds", () => {
  assert.strictEqual(habit({}).target, 1);
  assert.strictEqual(habit({ target: 3 }).target, 3);
  assert.strictEqual(habit({ target: 0 }).target, 1);
  assert.strictEqual(habit({ target: -5 }).target, 1);
  assert.strictEqual(habit({ target: "2" }).target, 2);
});

test("marks keep only real dates with a real count", () => {
  const h = habit({ marks: { "2026-03-02": 1, "2026-03-03": 0, "nope": 4, "2026-03-04": "2" } });
  assert.deepStrictEqual(h.marks, { "2026-03-02": 1, "2026-03-04": 2 });
  // A habit with nothing recorded carries no empty map to sync around.
  assert.strictEqual(habit({}).marks, undefined);
});

test("an unknown field survives a round trip", () => {
  assert.strictEqual(habit({ somethingNewer: 7 }).somethingNewer, 7);
});

console.log("\nwhen a habit is due");

test("a daily habit is due every day inside its own life", () => {
  const h = habit({ startedAt: "2026-03-02" });
  assert.strictEqual(H.isDue(h, "2026-03-01"), false, "before it started");
  assert.strictEqual(H.isDue(h, "2026-03-02"), true);
  assert.strictEqual(H.isDue(h, "2026-03-07"), true, "Saturday counts for a daily habit");
});

test("a weekday habit asks nothing of the weekend", () => {
  const h = habit({ cadence: { days: [1, 2, 3, 4, 5] } });
  assert.strictEqual(H.isDue(h, "2026-03-02"), true, "Monday");
  assert.strictEqual(H.isDue(h, "2026-03-06"), true, "Friday");
  assert.strictEqual(H.isDue(h, "2026-03-07"), false, "Saturday");
  assert.strictEqual(H.isDue(h, "2026-03-08"), false, "Sunday");
});

test("an archived habit stops asking, rather than racking up misses", () => {
  const h = habit({ archivedAt: "2026-03-10" });
  assert.strictEqual(H.isDue(h, "2026-03-10"), true);
  assert.strictEqual(H.isDue(h, "2026-03-11"), false);
});

test("the cadence reads as words, not day numbers", () => {
  assert.strictEqual(H.cadenceLabel(habit({})), "Every day");
  assert.strictEqual(H.cadenceLabel(habit({ cadence: { days: [1, 2, 3, 4, 5] } })), "Weekdays");
  assert.strictEqual(H.cadenceLabel(habit({ cadence: { days: [0, 6] } })), "Weekends");
  assert.strictEqual(H.cadenceLabel(habit({ cadence: { days: [1, 4] } })), "Mon, Thu");
});

console.log("\nticking");

test("one tap is a tick, and a second untick, for an ordinary habit", () => {
  const h = habit({});
  assert.strictEqual(H.nextMark(h, "2026-03-02"), 1);
  h.marks = { "2026-03-02": 1 };
  assert.strictEqual(H.nextMark(h, "2026-03-02"), 0);
});

test("a habit with a target counts up and wraps at the top", () => {
  const h = habit({ target: 3 });
  assert.strictEqual(H.nextMark(h, "2026-03-02"), 1);
  h.marks = { "2026-03-02": 1 };
  assert.strictEqual(H.isDone(h, "2026-03-02"), false, "one of three is not done");
  assert.strictEqual(H.nextMark(h, "2026-03-02"), 2);
  h.marks = { "2026-03-02": 3 };
  assert.strictEqual(H.isDone(h, "2026-03-02"), true);
  assert.strictEqual(H.nextMark(h, "2026-03-02"), 0, "and round again");
});

console.log("\nstreaks");

test("a run of kept days is the streak", () => {
  const h = habit({ startedAt: "2026-03-02", marks: marks("2026-03-02", "2026-03-03", "2026-03-04") });
  assert.strictEqual(H.streakOf(h, "2026-03-04"), 3);
});

test("a missed day ends it", () => {
  const h = habit({ startedAt: "2026-03-02", marks: marks("2026-03-02", "2026-03-04") });
  assert.strictEqual(H.streakOf(h, "2026-03-04"), 1, "only today survives the gap");
});

test("a day you never promised does not break a run", () => {
  // The reason cadence exists here. Mon-Fri, kept all week; Saturday is not a
  // miss, so Monday continues the run rather than starting a new one.
  const h = habit({
    startedAt: "2026-03-02", cadence: { days: [1, 2, 3, 4, 5] },
    marks: marks("2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-09"),
  });
  assert.strictEqual(H.streakOf(h, "2026-03-09"), 6, "Monday-to-Friday plus the next Monday");
});

test("today not done yet does not end the streak — the day isn't over", () => {
  const h = habit({ startedAt: "2026-03-02", marks: marks("2026-03-02", "2026-03-03") });
  assert.strictEqual(H.streakOf(h, "2026-03-04"), 2, "yesterday's run still stands this morning");
  h.marks["2026-03-04"] = 1;
  assert.strictEqual(H.streakOf(h, "2026-03-04"), 3, "and ticking today extends it");
});

test("yesterday missed does end it, even before today is done", () => {
  const h = habit({ startedAt: "2026-03-02", marks: marks("2026-03-02") });
  assert.strictEqual(H.streakOf(h, "2026-03-04"), 0);
});

test("a habit with nothing recorded has no streak", () => {
  assert.strictEqual(H.streakOf(habit({}), "2026-03-04"), 0);
});

test("the best run is found even when it is long past", () => {
  const h = habit({
    startedAt: "2026-03-01",
    marks: marks("2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-09"),
  });
  assert.strictEqual(H.bestStreakOf(h, "2026-03-10"), 4);
  // And the current one is 1, not 0: yesterday was kept, and today being
  // untouched does not count against you yet. Two days ago is what ends it.
  assert.strictEqual(H.streakOf(h, "2026-03-10"), 1);
});

test("a run that ended the day before yesterday really is over", () => {
  const h = habit({ startedAt: "2026-03-01", marks: marks("2026-03-01", "2026-03-02") });
  assert.strictEqual(H.streakOf(h, "2026-03-04"), 0, "the 3rd was missed and the 3rd is not today");
  assert.strictEqual(H.bestStreakOf(h, "2026-03-04"), 2, "but the record stands");
});

console.log("\nhow much of it you kept");

test("the rate counts days it asked for, not days on the calendar", () => {
  const h = habit({ startedAt: "2026-03-02", cadence: { days: [1, 2, 3, 4, 5] },
    marks: marks("2026-03-02", "2026-03-03") });
  // Mon-Sun: five due days, two kept. The weekend is not two misses.
  const s = H.statsFor(h, "2026-03-02", "2026-03-08");
  assert.strictEqual(s.due, 5);
  assert.strictEqual(s.done, 2);
  assert.strictEqual(+s.rate.toFixed(2), 0.4);
});

test("a window before the habit existed asks nothing of it", () => {
  const s = H.statsFor(habit({ startedAt: "2026-03-05" }), "2026-03-01", "2026-03-04");
  assert.deepStrictEqual(s, { due: 0, done: 0, rate: 0 });
});

console.log("\nbackfill and the grid window");

// Backfilling is only possible because of three things together: a start
// date you can move, days before it becoming due, and a grid that reaches
// them. Each one on its own leaves the feature impossible, which is what it
// was in 0.171.1 — see NOTES.md.

test("the blank days are the ones it now asks for and has nothing for", () => {
  const h = habit({ startedAt: "2026-03-02", cadence: { days: [1, 2, 3, 4, 5] },
    marks: marks("2026-03-03") });
  // Mon-Sun. Tuesday is already recorded; the weekend was never promised.
  assert.deepStrictEqual(H.blankDaysBetween(h, "2026-03-02", "2026-03-08"),
    ["2026-03-02", "2026-03-04", "2026-03-05", "2026-03-06"]);
});

test("days before the habit started are not blank days, they are nothing", () => {
  const h = habit({ startedAt: "2026-03-05" });
  assert.deepStrictEqual(H.blankDaysBetween(h, "2026-03-01", "2026-03-06"),
    ["2026-03-05", "2026-03-06"]);
});

test("a partial day counts as recorded — backfill never overwrites a count", () => {
  const h = habit({ startedAt: "2026-03-01", target: 3, marks: { "2026-03-02": 1 } });
  assert.deepStrictEqual(H.blankDaysBetween(h, "2026-03-02", "2026-03-02"), []);
});

test("a range that runs backwards or is junk yields nothing rather than spinning", () => {
  const h = habit({ startedAt: "2026-03-01" });
  assert.deepStrictEqual(H.blankDaysBetween(h, "2026-03-05", "2026-03-01"), []);
  assert.deepStrictEqual(H.blankDaysBetween(h, "", "2026-03-01"), []);
});

test("the grid window is whole weeks, ending on the week containing its day", () => {
  const start = H.windowStart("2026-03-02", 0); // a Monday
  assert.strictEqual(start, "2025-12-14");
  assert.strictEqual(new Date(start + "T00:00:00").getDay(), 0); // a Sunday
  // GRID_WEEKS columns of seven days, the last of which contains today.
  const last = H.addDaysStr(start, H.GRID_WEEKS * 7 - 1);
  assert.ok(last >= "2026-03-02");
  assert.strictEqual(H.addDaysStr(last, -6) <= "2026-03-02", true);
});

test("an offset is one week, and the window slides by that many", () => {
  assert.strictEqual(H.windowStart("2026-03-02", 1), H.addDaysStr(H.windowStart("2026-03-02", 0), -7));
  assert.strictEqual(H.windowStart("2026-03-02", 4), H.addDaysStr(H.windowStart("2026-03-02", 0), -28));
});

test("you can page back to the habit's start and no further", () => {
  // Started inside the first window: nowhere to page to.
  assert.strictEqual(H.maxOffset(habit({ startedAt: "2026-01-05" }), "2026-03-02"), 0);
  const h = habit({ startedAt: "2025-06-01" });
  const max = H.maxOffset(h, "2026-03-02");
  assert.ok(max > 0);
  // The last window reaches the start date; the one before it does not.
  assert.ok(H.windowStart("2026-03-02", max) <= "2025-06-01");
  assert.ok(H.windowStart("2026-03-02", max - 1) > "2025-06-01");
});

test("the window is labelled by the months it covers", () => {
  assert.strictEqual(H.rangeLabel("2026-03-01", "2026-03-28"), "Mar 2026");
  assert.strictEqual(H.rangeLabel("2026-01-04", "2026-03-28"), "Jan – Mar 2026");
  assert.strictEqual(H.rangeLabel("2025-12-14", "2026-03-07"), "Dec 2025 – Mar 2026");
});

console.log("\ncounting a window instead of walking it");

// statsFor used to walk the window a day at a time, which was fine while a
// window was ninety days. Backfilling makes "since you started" a real
// question, and a ten-year card would walk 3,650 days per habit on every
// render — including every tick. The counting version has to agree with the
// walking one exactly, so the walking one lives on here as the reference.
function walk(h, from, to) {
  let due = 0, done = 0, c = from;
  for (let g = 0; g < 8000 && c <= to; g++) {
    if (H.isDue(h, c)) { due++; if (H.isDone(h, c)) done++; }
    c = H.addDaysStr(c, 1);
  }
  return { due, done };
}

test("counting agrees with walking over four thousand random habits", () => {
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  let mismatch = null;
  for (let i = 0; i < 4000 && !mismatch; i++) {
    const startedAt = H.addDaysStr("2025-01-01", Math.floor(Math.random() * 400));
    const cadence = rnd(["daily", { days: [1, 3, 5] }, { days: [0, 6] }, { days: [2] }, { days: [1, 2, 3, 4, 5] }]);
    const m = {};
    for (let k = 0; k < 40; k++) m[H.addDaysStr(startedAt, Math.floor(Math.random() * 500) - 20)] = rnd([1, 2, 3]);
    const h = H.sanitizeHabit({ name: "x", startedAt, cadence, target: rnd([1, 2, 3]), marks: m,
      archivedAt: Math.random() < 0.3 ? H.addDaysStr(startedAt, 200 + Math.floor(Math.random() * 100)) : undefined });
    const from = H.addDaysStr(startedAt, Math.floor(Math.random() * 600) - 100);
    const to = H.addDaysStr(from, Math.floor(Math.random() * 500));
    const slow = walk(h, from, to), fast = H.statsFor(h, from, to);
    if (slow.due !== fast.due || slow.done !== fast.done) mismatch = { startedAt, cadence, from, to, slow, fast };
  }
  assert.strictEqual(mismatch, null, "disagreed: " + JSON.stringify(mismatch));
});

test("a window is clipped to the habit's own life at both ends", () => {
  const h = habit({ startedAt: "2026-03-05", archivedAt: "2026-03-10" });
  assert.strictEqual(H.dueBetween(h, "2026-03-01", "2026-03-31"), 6);
  assert.strictEqual(H.dueBetween(h, "2026-01-01", "2026-03-04"), 0);
});

test("a mark on a day the habit never asked for is not a day kept", () => {
  // Weekdays only, with a Saturday ticked: one due day, none kept.
  const h = habit({ startedAt: "2026-03-07", cadence: { days: [1, 2, 3, 4, 5] },
    marks: marks("2026-03-07") });
  assert.deepStrictEqual(H.statsFor(h, "2026-03-07", "2026-03-09"), { due: 1, done: 0, rate: 0 });
});

test("a partial day is not a day kept either", () => {
  const h = habit({ startedAt: "2026-03-02", target: 3, marks: { "2026-03-02": 2 } });
  assert.strictEqual(H.keptBetween(h, "2026-03-02", "2026-03-02"), 0);
  assert.strictEqual(H.keptBetween(habit({ startedAt: "2026-03-02", target: 3, marks: { "2026-03-02": 3 } }),
    "2026-03-02", "2026-03-02"), 1);
});

console.log("\nfilling a run, and what a start date costs");

test("a run covers only the days the habit asked for", () => {
  const h = habit({ startedAt: "2026-03-01", cadence: { days: [0, 6] } });
  // Sun 2026-03-01 through Sun 2026-03-08.
  assert.deepStrictEqual(H.dueDaysBetween(h, "2026-03-01", "2026-03-08"),
    ["2026-03-01", "2026-03-07", "2026-03-08"]);
});

test("a run is clipped to the habit's life rather than inventing days", () => {
  const h = habit({ startedAt: "2026-03-05" });
  assert.deepStrictEqual(H.dueDaysBetween(h, "2026-03-01", "2026-03-06"), ["2026-03-05", "2026-03-06"]);
  assert.deepStrictEqual(H.dueDaysBetween(h, "2026-03-06", "2026-03-01"), []);
});

test("moving a start date forward counts what stops counting", () => {
  const h = habit({ startedAt: "2026-03-01", marks: marks("2026-03-01", "2026-03-02", "2026-03-09") });
  assert.strictEqual(H.orphanedMarks(h, "2026-03-05"), 2);
  assert.strictEqual(H.orphanedMarks(h, "2026-03-01"), 0);
});

test("a date reads as a date, not as an ISO string", () => {
  assert.strictEqual(H.prettyDate("2025-06-14"), "14 Jun 2025");
  assert.strictEqual(H.prettyDate("2026-01-01"), "1 Jan 2026");
  assert.strictEqual(H.prettyDate("nonsense"), "");
});

test("search matches a habit's name, and archived ones are out of the list", () => {
  global.window.LifeLogHabits.init({
    uid: () => "x", backfillUpdatedAt: (i) => i.updatedAt || "1970-01-01T00:00:00.000Z",
    keepUnknown: (s, o) => o,
    state: { search: "read", data: { habits: [
      { id: "a", name: "Read 20 pages" }, { id: "b", name: "Run" },
      { id: "c", name: "Read at night", archivedAt: "2026-01-01" },
    ] } },
  });
  assert.deepStrictEqual(global.window.LifeLogHabits.getFilteredHabits().map((h) => h.id), ["a"]);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
