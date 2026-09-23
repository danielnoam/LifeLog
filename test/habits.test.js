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
