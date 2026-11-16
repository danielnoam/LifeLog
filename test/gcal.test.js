// src/gcal.js's pure parts: Google's events read as days on this device.
process.env.TZ = "Asia/Jerusalem";
const assert = require("assert");
const G = require("../src/gcal.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + e.message); }
}

test("asks only to read: the calendar list and the events", () => {
  assert.deepStrictEqual(G.SCOPES, ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.readonly"]);
});

test("a timed event lands on its local day with its local times", () => {
  const [e] = G.readEvents([{ id: "1", summary: "Cinema", start: { dateTime: "2026-11-16T17:30:00Z" }, end: { dateTime: "2026-11-16T20:00:00Z" }, location: "Yes Planet", htmlLink: "https://www.google.com/calendar/event?eid=x" }], "me");
  assert.deepStrictEqual([e.start, e.end, e.time, e.endTime, e.allDay, e.place, e.cal], ["2026-11-16", "2026-11-16", "19:30", "22:00", false, "Yes Planet", "me"]);
});

test("an all-day event's end date is the day after, so it's taken back one", () => {
  const [one, two] = G.readEvents([
    { id: "a", summary: "Birthday", start: { date: "2026-11-07" }, end: { date: "2026-11-08" } },
    { id: "b", summary: "Trip", start: { date: "2026-11-21" }, end: { date: "2026-11-24" } },
  ]);
  assert.deepStrictEqual([one.start, one.end, one.allDay], ["2026-11-07", "2026-11-07", true]);
  assert.deepStrictEqual([two.start, two.end], ["2026-11-21", "2026-11-23"]);
});

test("cancelled ones and ones without a start are left out; no title gets one", () => {
  const got = G.readEvents([{ id: "x", status: "cancelled", start: { date: "2026-11-01" } }, { id: "y" }, { id: "z", start: { date: "2026-11-02" }, end: { date: "2026-11-03" } }]);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].title, "(No title)");
});

test("ending at midnight stays on the day it started", () => {
  const [e] = G.readEvents([{ id: "1", summary: "Late", start: { dateTime: "2026-11-16T20:00:00+02:00" }, end: { dateTime: "2026-11-17T00:00:00+02:00" } }]);
  assert.deepStrictEqual([e.start, e.end], ["2026-11-16", "2026-11-16"]);
});

test("a month's days: several-day events on each, inside the month only, all-day first then by time", () => {
  const evs = G.readEvents([
    { id: "t", summary: "Trip", start: { date: "2026-10-30" }, end: { date: "2026-11-03" } },
    { id: "b", summary: "B", start: { dateTime: "2026-11-02T10:00:00+02:00" }, end: { dateTime: "2026-11-02T11:00:00+02:00" } },
    { id: "a", summary: "A", start: { dateTime: "2026-11-02T08:00:00+02:00" }, end: { dateTime: "2026-11-02T09:00:00+02:00" } },
    { id: "d", summary: "December", start: { date: "2026-12-01" }, end: { date: "2026-12-02" } },
  ]);
  const m = G.byDay(evs, 2026, 11);
  assert.deepStrictEqual([...m.keys()].sort((x, y) => x - y), [1, 2]);
  assert.deepStrictEqual(m.get(2).map((e) => e.id), ["t", "a", "b"]);
});

test("the when in words", () => {
  const [timed, allDay, long] = G.readEvents([
    { id: "1", start: { dateTime: "2026-11-16T19:30:00+02:00" }, end: { dateTime: "2026-11-16T22:00:00+02:00" } },
    { id: "2", start: { date: "2026-11-07" }, end: { date: "2026-11-08" } },
    { id: "3", start: { date: "2026-11-21" }, end: { date: "2026-11-24" } },
  ]);
  assert.strictEqual(G.whenText(timed), "2026-11-16 · 19:30–22:00");
  assert.strictEqual(G.whenText(allDay), "2026-11-07 · All day");
  assert.strictEqual(G.whenText(long), "2026-11-21 – 2026-11-23");
});

test("a description's HTML comes out as plain text", () => {
  assert.strictEqual(G.plainText("Dune <b>Part Three</b><br>with Noa &amp; Tal<script>x</script>"), "Dune Part Three\nwith Noa & Talx");
});

console.log(passed + " passed");
