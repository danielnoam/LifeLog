// Zero-dependency tests for src/travel.js's pure parts and the trip merge in
// src/merge.js — run with `node test/travel.test.js`.
const assert = require("assert");
global.window = {};
require("../src/travel.js");
const M = require("../src/merge.js");
const T = global.window.LifeLogTravel;
T.init({ uid: (() => { let n = 0; return () => "u" + (n++); })() });

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

test("a trip keeps real dates only, and swaps an end before its start", () => {
  assert.deepStrictEqual(T.sanitizeTrip({ id: "t1", name: " Rome ", start: "2027-04-12", end: "2027-04-10" }),
    { id: "t1", name: "Rome", start: "2027-04-10", end: "2027-04-12", createdAt: null, updatedAt: "1970-01-01T00:00:00.000Z" });
  const t = T.sanitizeTrip({ id: "t2", name: "", start: "2027-02-30", end: "soon" });
  assert.strictEqual(t.name, "Untitled trip");
  assert.ok(!("start" in t) && !("end" in t));
});

test("a place's time needs a day, and its end needs to come after the start", () => {
  assert.strictEqual(T.sanitizePlace({ trip: "t1", name: "A", time: "10:00" }).time, undefined);
  const p = T.sanitizePlace({ trip: "t1", name: "A", day: "2027-04-11", time: "10:00", endTime: "09:00" });
  assert.deepStrictEqual([p.time, p.endTime], ["10:00", undefined]);
  const q = T.sanitizePlace({ trip: "t1", name: "A", day: "2027-04-11", time: "25:00" });
  assert.strictEqual(q.time, undefined);
});

test("a place keeps coordinates only as a valid pair, and carries fields it doesn't know", () => {
  assert.deepStrictEqual([T.sanitizePlace({ trip: "t", name: "A", lat: "41.9", lng: 12.47 }).lat, T.sanitizePlace({ trip: "t", name: "A", lat: "41.9", lng: 12.47 }).lng], [41.9, 12.47]);
  assert.ok(!("lat" in T.sanitizePlace({ trip: "t", name: "A", lat: 91, lng: 0 })));
  assert.ok(!("lat" in T.sanitizePlace({ trip: "t", name: "A", lat: 41 })));
  assert.strictEqual(T.sanitizePlace({ trip: "t", name: "A", rating: 4.5 }).rating, 4.5);
});

test("a place whose trip is gone is dropped", () => {
  const d = T.sanitizeDoc({ trips: [{ id: "t1", name: "Rome" }], places: [{ id: "p1", trip: "t1", name: "A" }, { id: "p2", trip: "gone", name: "B" }] });
  assert.deepStrictEqual(d.places.map((p) => p.id), ["p1"]);
});

test("a trip's days: every day it covers, plus any day a place sits on outside it", () => {
  const trip = { start: "2027-04-10", end: "2027-04-12" };
  assert.deepStrictEqual(T.tripDays(trip, [{ day: "2027-04-14" }, { day: "2027-04-11" }, {}]),
    ["2027-04-10", "2027-04-11", "2027-04-12", "2027-04-14"]);
  assert.deepStrictEqual(T.tripDays({}, [{ day: "2027-05-02" }, { day: "2027-05-01" }]), ["2027-05-01", "2027-05-02"]);
  // Across a month and a daylight-saving change, one entry per day.
  assert.deepStrictEqual(T.tripDays({ start: "2027-03-27", end: "2027-04-01" }, []).length, 6);
});

test("a day's places: scheduled by time first, then the rest in their order", () => {
  const out = T.sortDay([
    { name: "Open 2", order: 1 }, { name: "Late", time: "18:00" }, { name: "Open 1", order: 0 }, { name: "Early", time: "09:00" },
  ]).map((p) => p.name);
  assert.deepStrictEqual(out, ["Early", "Late", "Open 1", "Open 2"]);
});

test("trips: under way, then coming up soonest first, then undated, then past newest first", () => {
  const today = "2027-04-11";
  const trips = [
    { id: "past1", start: "2026-01-01", end: "2026-01-05" }, { id: "soon", start: "2027-05-01" },
    { id: "now", start: "2027-04-10", end: "2027-04-12" }, { id: "undated", createdAt: "x" },
    { id: "later", start: "2027-09-01" }, { id: "past2", start: "2026-06-01", end: "2026-06-02" },
  ];
  assert.deepStrictEqual(T.sortTrips(trips, today).map((t) => t.id), ["now", "soon", "later", "undated", "past2", "past1"]);
  assert.strictEqual(T.tripStatus({ start: "2027-04-11" }, today), "now", "a one-day trip today is under way");
});

test("dates read as people write them", () => {
  assert.strictEqual(T.dayLabel("2027-04-10"), "Sat 10 Apr");
  assert.strictEqual(T.rangeLabel("2027-04-10", "2027-04-12"), "10–12 Apr 2027");
  assert.strictEqual(T.rangeLabel("2027-09-30", "2027-10-03"), "30 Sep – 3 Oct 2027");
  assert.strictEqual(T.rangeLabel("2027-12-28", "2028-01-04"), "28 Dec 2027 – 4 Jan 2028");
  assert.strictEqual(T.rangeLabel("2027-04-10"), "10 Apr 2027");
  assert.strictEqual(T.timeLabel({ time: "10:00", endTime: "11:30" }), "10:00–11:30");
});

test("Open in Google Maps: the link given, else the coordinates, else a search", () => {
  assert.strictEqual(T.mapsUrl({ url: "https://maps.app.goo.gl/x", lat: 1, lng: 2 }), "https://maps.app.goo.gl/x");
  assert.strictEqual(T.mapsUrl({ name: "A", lat: 41.9, lng: 12.4 }), "https://www.google.com/maps/search/?api=1&query=41.9,12.4");
  assert.strictEqual(T.mapsUrl({ name: "Trevi Fountain", address: "Rome" }), "https://www.google.com/maps/search/?api=1&query=Trevi%20Fountain%2C%20Rome");
});

test("two devices planning different places of one trip both keep their changes", () => {
  const base = { trips: [{ id: "t1", name: "Rome", updatedAt: "1" }], places: [{ id: "p1", trip: "t1", name: "A", updatedAt: "1" }] };
  const local = { trips: base.trips, places: [{ ...base.places[0], day: "2027-04-11", updatedAt: "2" }] };
  const remote = { trips: base.trips, places: [...base.places, { id: "p2", trip: "t1", name: "B", updatedAt: "2" }] };
  const out = M.mergeTravel(base, local, remote);
  assert.deepStrictEqual(out.places.map((p) => [p.id, p.day]).sort(), [["p1", "2027-04-11"], ["p2", undefined]]);
});

console.log(`\n${passed} test(s) passed.`);
