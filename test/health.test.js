// Zero-dependency tests for src/health.js's pure half: Health Connect's
// steps, workouts and sleep into linked habits — `node test/health.test.js`.
const assert = require("assert");
global.window = {};
require("../src/habits.js");
require("../src/health.js");
const H = global.window.LifeLogHabits;
const HC = global.window.LifeLogHealth;
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
const at = (date, hh, mm = 0) => new Date(date + "T" + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":00").getTime();
const habit = (o) => ({ id: "h1", name: "Walk", startedAt: "2026-11-01", marks: {}, ...o });
const data = (...habits) => ({ habits });

test("a link is cleaned on the habit, and an avoided habit never keeps one", () => {
  assert.deepStrictEqual(H.cleanHealthLink({ from: "steps", min: "8000.4" }), { from: "steps", min: 8000 });
  assert.deepStrictEqual(H.cleanHealthLink({ from: "workout", kind: "parkour" }), { from: "workout", kind: "any" });
  assert.deepStrictEqual(H.cleanHealthLink({ from: "sleep", hours: 7.3 }), { from: "sleep", hours: 7.25 });
  assert.strictEqual(H.cleanHealthLink({ from: "heart" }), null);
  assert.deepStrictEqual(H.sanitizeHabit(habit({ health: { from: "steps", min: 5000 } })).health, { from: "steps", min: 5000 });
  assert.ok(!("health" in H.sanitizeHabit(habit({ avoid: true, health: { from: "steps", min: 5000 } }))));
});

test("overlapping sessions count once; a night counts on the morning it ends", () => {
  const days = HC.daysFrom({
    steps: [{ date: "2026-11-20", count: 9100 }],
    workouts: [
      { start: at("2026-11-20", 18), end: at("2026-11-20", 19), type: 56 },
      { start: at("2026-11-20", 18, 5), end: at("2026-11-20", 19, 10), type: 79 },
      { start: at("2026-11-20", 20), end: at("2026-11-20", 20, 30), type: 70 },
    ],
    sleep: [
      { start: at("2026-11-19", 23), end: at("2026-11-20", 6) },
      { start: at("2026-11-20", 5), end: at("2026-11-20", 7) },
    ],
  });
  const d = days["2026-11-20"];
  assert.strictEqual(d.steps, 9100);
  assert.strictEqual(d.workouts.length, 2, "the run seen by two apps is one");
  assert.deepStrictEqual(d.workouts[0], { types: [56, 79], min: 70 });
  assert.strictEqual(d.sleepMin, 8 * 60, "two trackers' night, merged");
});

test("steps and sleep tick a day that meets the bar; workouts count each, or their minutes", () => {
  const day = { steps: 7999, sleepMin: 420, workouts: [{ types: [70], min: 50 }, { types: [56], min: 30 }] };
  assert.strictEqual(HC.amountFor(habit({ health: { from: "steps", min: 8000 } }), day), 0);
  assert.strictEqual(HC.amountFor(habit({ health: { from: "steps", min: 7000 } }), day), 1);
  assert.strictEqual(HC.amountFor(habit({ health: { from: "sleep", hours: 7 } }), day), 1);
  assert.strictEqual(HC.amountFor(habit({ health: { from: "sleep", hours: 7.5 } }), day), 0);
  assert.strictEqual(HC.amountFor(habit({ health: { from: "workout", kind: "any" } }), day), 2);
  assert.strictEqual(HC.amountFor(habit({ health: { from: "workout", kind: "strength" } }), day), 1);
  assert.strictEqual(HC.amountFor(habit({ unit: "min", health: { from: "workout", kind: "any" } }), day), 80);
  assert.strictEqual(HC.amountFor(habit({ unit: "min", health: { from: "steps", min: 10 } }), day), 0, "steps never fill a timed habit");
});

test("a day ticked by hand isn't counted twice, and the phone's part is kept apart", () => {
  const h = habit({ period: "week", target: 3, health: { from: "workout", kind: "strength" }, marks: { "2026-11-18": 1 } });
  const d = data(h), cfg = HC.cleanConfig({});
  const days = { "2026-11-18": { steps: 0, sleepMin: 0, workouts: [{ types: [70], min: 40 }] }, "2026-11-19": { steps: 0, sleepMin: 0, workouts: [{ types: [81], min: 40 }, { types: [70], min: 30 }] } };
  HC.apply(d, cfg, days, "2026-11-18", "2026-11-20");
  assert.deepStrictEqual(h.marks, { "2026-11-18": 1, "2026-11-19": 2 }, "the hand tick on the 18th was the same session");
  assert.deepStrictEqual(cfg.filled.h1, { "2026-11-18": [0, 1], "2026-11-19": [2, 2] });
  h.marks["2026-11-19"] = 3; // one more by hand, after the phone's two
  HC.apply(d, cfg, days, "2026-11-18", "2026-11-20");
  assert.strictEqual(h.marks["2026-11-19"], 3, "a tick added later is one more");
  assert.deepStrictEqual(cfg.filled.h1["2026-11-19"], [2, 2]);
  delete days["2026-11-19"]; // deleted in Health Connect
  HC.apply(d, cfg, days, "2026-11-18", "2026-11-20");
  assert.strictEqual(h.marks["2026-11-19"], 1, "only the phone's part came out");
  assert.deepStrictEqual(cfg.filled.h1, { "2026-11-18": [0, 1] });
});

test("before the habit started and outside the window, nothing is touched", () => {
  const h = habit({ startedAt: "2026-11-19", health: { from: "steps", min: 100 }, marks: { "2026-11-10": 1 } });
  const d = data(h), cfg = HC.cleanConfig({});
  const days = { "2026-11-18": { steps: 500, sleepMin: 0, workouts: [] }, "2026-11-19": { steps: 500, sleepMin: 0, workouts: [] } };
  HC.apply(d, cfg, days, "2026-11-17", "2026-11-20");
  assert.deepStrictEqual(h.marks, { "2026-11-10": 1, "2026-11-19": 1 });
});

test("unlinking or changing a link takes out only the phone's part; a new link reads 30 days", () => {
  const h = habit({ health: { from: "steps", min: 100 }, marks: { "2026-11-18": 1 } });
  const d = data(h), cfg = HC.cleanConfig({});
  assert.strictEqual(HC.windowFor(d, cfg, "2026-11-20"), "2026-10-22");
  HC.apply(d, cfg, { "2026-11-19": { steps: 500, sleepMin: 0, workouts: [] }, "2026-11-18": { steps: 500, sleepMin: 0, workouts: [] } }, "2026-11-14", "2026-11-20");
  assert.deepStrictEqual(h.marks, { "2026-11-18": 1, "2026-11-19": 1 });
  assert.strictEqual(HC.windowFor(d, cfg, "2026-11-20"), "2026-11-14");
  assert.ok(HC.setLink(d, cfg, "h1", { from: "steps", min: 9000 }));
  assert.deepStrictEqual(h.marks, { "2026-11-18": 1 }, "the hand tick stays");
  assert.deepStrictEqual(h.health, { from: "steps", min: 9000 });
  assert.ok(!HC.setLink(d, cfg, "h1", { from: "steps", min: 9000 }), "the same link is no change");
  assert.ok(HC.setLink(d, cfg, "h1", null));
  assert.ok(!("health" in h));
});

test("a habit unlinked on another device gives back the phone's part at the next read", () => {
  const h = habit({ marks: { "2026-11-19": 1 } });
  const cfg = HC.cleanConfig({ filled: { h1: { "2026-11-19": [1, 1], bad: 2 } } });
  assert.deepStrictEqual(cfg.filled, { h1: { "2026-11-19": [1, 1] } });
  HC.apply(data(h), cfg, {}, "2026-11-14", "2026-11-20");
  assert.deepStrictEqual(h.marks, {});
  assert.deepStrictEqual(cfg.filled, {});
});

test("what's read is only what the links need", () => {
  const d = data(habit({ health: { from: "sleep", hours: 7 } }), habit({ id: "h2", archivedAt: "2026-11-01", health: { from: "steps", min: 1 } }));
  assert.deepStrictEqual([...HC.needed(d)], ["sleep"]);
});

console.log(`\n${passed} passed`);
