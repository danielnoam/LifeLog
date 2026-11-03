// Zero-dependency tests for src/dates.js and the places that count weeks
// from it — `node test/dates.test.js`.
//
// The defaults are the app before 0.301.0 (Sunday weeks, "3 Nov 2026"), so a
// file that never picked reads exactly as it did.
const assert = require("assert");
global.window = {};
const D = require("../src/dates.js");
require("../src/habits.js");
require("../src/widgets.js");
const H = window.LifeLogHabits;
const W = window.LifeLogWidgets;
H.init({ uid: () => "h", backfillUpdatedAt: () => "1970-01-01T00:00:00.000Z", keepUnknown: (s, o) => o });

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}
let settings = {};
D.bind(() => settings);
const using = (s, fn) => { const was = settings; settings = s; try { fn(); } finally { settings = was; } };

// 2026-11-03 is a Tuesday.
const TUE = "2026-11-03";

console.log("\nsettings");

test("nothing chosen is Sunday and 3 Nov 2026; junk falls back to the same", () => {
  assert.strictEqual(D.weekStart(), 0);
  assert.strictEqual(D.dateFormat(), "dmy");
  using({ weekStart: 3, dateFormat: "yy" }, () => {
    assert.strictEqual(D.weekStart(), 0);
    assert.strictEqual(D.dateFormat(), "dmy");
  });
  using({ weekStart: "6" }, () => assert.strictEqual(D.weekStart(), 6));
});

console.log("\nweeks");

test("a week starts on its own day, and a start day is its own week's first", () => {
  assert.strictEqual(D.startOfWeek(TUE), "2026-11-01");
  using({ weekStart: 1 }, () => assert.strictEqual(D.startOfWeek(TUE), "2026-11-02"));
  using({ weekStart: 6 }, () => {
    assert.strictEqual(D.startOfWeek(TUE), "2026-10-31");
    assert.strictEqual(D.startOfWeek("2026-10-31"), "2026-10-31");
    assert.strictEqual(D.startOfWeek("2026-11-06"), "2026-10-31");
    assert.deepStrictEqual(D.weekOrder(), [6, 0, 1, 2, 3, 4, 5]);
    assert.strictEqual(D.weekPos(5), 6);
  });
});

test("a Saturday week has Friday and Saturday off; the others Saturday and Sunday", () => {
  assert.deepStrictEqual([D.workDays(), D.weekendDays()], [[1, 2, 3, 4, 5], [0, 6]]);
  using({ weekStart: 1 }, () => assert.deepStrictEqual(D.weekendDays(), [0, 6]));
  using({ weekStart: 6 }, () => assert.deepStrictEqual([D.workDays(), D.weekendDays()], [[0, 1, 2, 3, 4], [5, 6]]));
});

console.log("\nformats");

test("every format, with and without the year and the weekday", () => {
  const cases = {
    dmy: ["3 Nov 2026", "3 Nov", "Tue 3 Nov"],
    mdy: ["Nov 3, 2026", "Nov 3", "Tue, Nov 3"],
    "dmy-num": ["03/11/2026", "03/11", "Tue 03/11"],
    "mdy-num": ["11/03/2026", "11/03", "Tue 11/03"],
    iso: ["2026-11-03", "2026-11-03", "Tue 2026-11-03"],
  };
  for (const [f, [full, short, wd]] of Object.entries(cases)) {
    using({ dateFormat: f }, () => {
      assert.strictEqual(D.day(TUE), full, f);
      assert.strictEqual(D.day(TUE, { year: false }), short, f);
      assert.strictEqual(D.day(TUE, { year: false, weekday: true }), wd, f);
    });
  }
});

test("a timestamp is read on this device's clock, and nothing readable is blank", () => {
  assert.strictEqual(D.day(new Date(2026, 10, 3, 23, 59)), "3 Nov 2026");
  assert.strictEqual(D.day(""), "");
  assert.strictEqual(D.day("not a date"), "");
  assert.strictEqual(D.dateTime(null), "");
});

test("ranges share what they share", () => {
  assert.strictEqual(D.range("2026-03-03", "2026-03-16"), "3–16 Mar 2026");
  assert.strictEqual(D.range("2026-02-28", "2026-03-03"), "28 Feb – 3 Mar 2026");
  assert.strictEqual(D.range("2025-12-30", "2026-01-02"), "30 Dec 2025 – 2 Jan 2026");
  assert.strictEqual(D.range(TUE, TUE), "3 Nov 2026");
  using({ dateFormat: "mdy" }, () => {
    assert.strictEqual(D.range("2026-03-03", "2026-03-16"), "Mar 3–16, 2026");
    assert.strictEqual(D.range("2026-02-28", "2026-03-03"), "Feb 28 – Mar 3, 2026");
  });
  using({ dateFormat: "dmy-num" }, () => assert.strictEqual(D.range("2026-11-03", "2026-11-09"), "03/11 – 09/11/2026"));
  using({ dateFormat: "iso" }, () => assert.strictEqual(D.range("2026-11-03", "2026-11-09"), "2026-11-03 – 2026-11-09"));
});

test("the settings page's choices show one real date in each format", () => {
  assert.deepStrictEqual(D.formatChoices().map((c) => c.label), ["3 Nov 2026", "Nov 3, 2026", "03/11/2026", "11/03/2026", "2026-11-03"]);
  assert.deepStrictEqual(D.weekStartChoices().map((c) => c.label), ["Sunday", "Monday", "Saturday"]);
});

console.log("\nhabits and widgets follow the week start");

const weekly = { id: "g", name: "Gym", period: "week", target: 3, startedAt: "2026-01-01", cadence: "daily",
  marks: { "2026-10-31": 1, "2026-11-02": 1 } };

test("a weekly goal counts the week Settings says", () => {
  assert.deepStrictEqual(H.periodRange("week", TUE), ["2026-11-01", "2026-11-07"]);
  assert.strictEqual(H.progressOf(weekly, TUE).done, 1);
  using({ weekStart: 6 }, () => {
    assert.deepStrictEqual(H.periodRange("week", TUE), ["2026-10-31", "2026-11-06"]);
    // Saturday's session is this week's now.
    assert.strictEqual(H.progressOf(weekly, TUE).done, 2);
  });
});

test("the grid's window opens on the week's first day", () => {
  using({ weekStart: 6 }, () => assert.strictEqual(new Date(H.windowStart(TUE, 0) + "T00:00:00").getDay(), 6));
  using({ weekStart: 1 }, () => assert.strictEqual(new Date(H.windowStart(TUE, 0) + "T00:00:00").getDay(), 1));
});

test("Weekdays and Weekends name the week's own working days", () => {
  const h = (days) => ({ cadence: { days } });
  assert.strictEqual(H.cadenceLabel(h([1, 2, 3, 4, 5])), "Weekdays");
  assert.strictEqual(H.cadenceLabel(h([0, 6])), "Weekends");
  using({ weekStart: 6 }, () => {
    assert.strictEqual(H.cadenceLabel(h([0, 1, 2, 3, 4])), "Weekdays");
    assert.strictEqual(H.cadenceLabel(h([5, 6])), "Weekends");
    assert.strictEqual(H.cadenceLabel(h([0, 6])), "Sat, Sun");
  });
});

test("the widget snapshot sends a weekly goal's week and its start day", () => {
  using({ weekStart: 6 }, () => {
    const g = W.snapshotOf({ habits: [weekly] }, { today: TUE }).habits[0];
    assert.strictEqual(g.periodFrom, "2026-10-31");
    assert.strictEqual(g.weekStart, 6);
    assert.strictEqual(g.marks["2026-10-31"], 1);
  });
});

test("the widget's dates are written in the chosen format", () => {
  using({ dateFormat: "dmy-num" }, () => {
    const s = W.snapshotOf({ backlog: [{ id: "p", title: "Playing", category: "Games", startedAt: "2026-10-10" }] }, { today: TUE });
    assert.strictEqual(s.inProgress[0].startedText, "10/10");
  });
});

console.log(`\n${passed} test(s) passed.`);
