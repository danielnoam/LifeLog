// Zero-dependency tests for src/travel.js's pure parts and the trip merge in
// src/merge.js — run with `node test/travel.test.js`.
const assert = require("assert");
global.window = {};
require("../src/markdown.js"); // travel.js checks place links with its safeHref
require("../src/travel.js");
const M = require("../src/merge.js");
const T = global.window.LifeLogTravel;
const { googleList, LIST_ID } = require("./fixtures/google-list.js");
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
  assert.strictEqual(T.mapsUrl({ name: "A", gid: "0x1:0x2", lat: 41.9, lng: 12.4 }), "https://www.google.com/maps?ftid=0x1:0x2");
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

test("a Google list: its name, and each place's name, note, address, coordinates and id, and nothing of its owner", () => {
  const list = T.parseGoogleList(googleList());
  assert.strictEqual(list.name, "Italy");
  assert.strictEqual(list.id, LIST_ID);
  assert.strictEqual(list.places.length, 5);
  assert.deepStrictEqual(list.places[0], { name: "Colosseo", lat: 41.8902, lng: 12.4922, note: "Book the underground tour", gid: "0x132f604566693529:0xe8f4e4319c2df271" });
  assert.strictEqual(list.places[3].address, "P.za del Duomo, 20122 Milano MI, Italy");
  assert.ok(!JSON.stringify(list).includes("Someone"));
  assert.throws(() => T.parseGoogleList("<html>"), /isn't a Google Maps list/);
});

test("Google's place id: two signed decimals become Maps' unsigned hex", () => {
  assert.strictEqual(T.gidOf(["1", "-1"]), "0x1:0xffffffffffffffff");
  assert.strictEqual(T.gidOf(["255", "16"]), "0xff:0x10");
  assert.strictEqual(T.gidOf(["x", "1"]), null);
  assert.strictEqual(T.gidOf(null), null);
});

test("a list id from every shape of link that holds one", () => {
  const id = "KtcMn2kOOjTBNLIPNrHaAHbQqc1mWw";
  assert.strictEqual(T.googleListId(`https://www.google.com/maps/@/data=!4m3!11m2!2s${id}!3e3?entry=tts`), id);
  assert.strictEqual(T.googleListId(`https://consent.google.com/m?continue=https://www.google.com/maps/@/data%3D!4m3!11m2!2s${id}!3e3&gl=IT`), id);
  assert.strictEqual(T.googleListId(`https://www.google.com/maps/placelists/list/${id}`), id);
  assert.strictEqual(T.googleListId(id), id);
  assert.strictEqual(T.googleListId("https://www.google.com/maps/place/Trevi"), null);
  assert.strictEqual(T.googleShortCode("https://maps.app.goo.gl/FMe3YPZevJJeFY168?g_st=ac"), "FMe3YPZevJJeFY168");
  assert.strictEqual(T.googleShortCode("goo.gl/maps/abc123"), "abc123");
  assert.strictEqual(T.googleShortCode("https://example.com/x"), null);
});

test("a single shared place, from either URL a place link resolves to", () => {
  assert.deepStrictEqual(T.parseGooglePlaceUrl("https://www.google.com/maps/place/Trevi+Fountain/@41.9,12.48,17z/data=!3m1!4b1!4m6!3m5!1s0x132f604f678640a9:0xcad165fa2036ce2c!8m2!3d41.9009!4d12.4833!16z"),
    { name: "Trevi Fountain", lat: 41.9009, lng: 12.4833, gid: "0x132f604f678640a9:0xcad165fa2036ce2c" });
  assert.deepStrictEqual(T.parseGooglePlaceUrl("https://maps.google.com/maps?q=Trevi+Fountain,+Piazza+di+Trevi,+00187+Roma+RM,+Italy&ftid=0x132f604f678640a9:0xcad165fa2036ce2c"),
    { name: "Trevi Fountain", gid: "0x132f604f678640a9:0xcad165fa2036ce2c", address: "Piazza di Trevi, 00187 Roma RM, Italy" });
  assert.strictEqual(T.parseGooglePlaceUrl("https://evil.example/maps/place/X"), null);
});

test("a town from an address, in the ways countries write them", () => {
  assert.strictEqual(T.townOf("Piazza di Trevi, 00187 Roma RM, Italy"), "Roma");
  assert.strictEqual(T.townOf("123 Main St, Springfield, IL 62701, USA"), "Springfield");
  assert.strictEqual(T.townOf("10 Downing St, London SW1A 2AA, UK"), "London");
  assert.strictEqual(T.townOf("1 Chome-1-2 Oshiage, Sumida City, Tokyo 131-0045, Japan"), "Tokyo");
  assert.strictEqual(T.townOf(""), "");
});

test("areas: places a day's travel apart, named by their town or a place, in walking order", () => {
  const list = T.parseGoogleList(googleList()).places;
  const out = T.areas(list.concat([{ name: "Somewhere" }, { name: "Brera", address: "Via Brera, 20121 Milano MI, Italy" }]));
  assert.deepStrictEqual(out.map((a) => [a.name, a.places.length]), [["Milano", 3], ["Near Trevi", 3], ["No location", 1]]);
  // The walk starts at an end and goes to the nearest each time.
  assert.deepStrictEqual(out[1].places.map((p) => p.name), ["Colosseo", "Trevi", "Pantheon"]);
});

test("areas with no address take a looked-up town, and say which place to look up", () => {
  const list = T.parseGoogleList(googleList()).places.map((p) => ({ ...p, address: "" }));
  const before = T.areas(list);
  const rome = before.find((a) => a.places.some((p) => p.name === "Trevi"));
  assert.ok(!rome.named && rome.name.startsWith("Near "), rome.name);
  assert.ok(rome.places.includes(rome.centre));
  // What the device has cached for that spot names it, before anything is saved…
  const after = T.areas(list, (p) => (p === rome.centre ? "Roma" : ""));
  assert.ok(after.some((a) => a.name === "Roma" && a.named));
  // …and a place's own town (saved) does too; an address still wins over both.
  const saved = list.map((p) => (p === rome.centre ? { ...p, town: "Rome" } : p));
  assert.ok(T.areas(saved).some((a) => a.name === "Rome"));
  assert.strictEqual(T.sanitizePlace({ name: "X", trip: "t", town: " Roma ", placeId: "ChIJ123" }).town, "Roma");
  assert.strictEqual(T.sanitizePlace({ name: "X", trip: "t", placeId: "ChIJ123" }).placeId, "ChIJ123");
});

test("the same place twice: by Google's id, else by name close by", () => {
  assert.ok(T.samePlace({ gid: "0x1:0x2", name: "A" }, { gid: "0x1:0x2", name: "B" }));
  assert.ok(!T.samePlace({ gid: "0x1:0x2", name: "A" }, { gid: "0x1:0x3", name: "A" }));
  assert.ok(T.samePlace({ name: "Trevi", lat: 41.9009, lng: 12.4833 }, { name: "trevi", lat: 41.9010, lng: 12.4833 }));
  assert.ok(!T.samePlace({ name: "Trevi", lat: 41.9009, lng: 12.4833 }, { name: "Trevi", lat: 45, lng: 9 }));
});

const later = [];
const atest = (name, fn) => later.push([name, fn]);

atest("a short link to a list: resolved, then fetched by its id", async () => {
  const asked = [];
  const got = await T.fetchGoogle("https://maps.app.goo.gl/abc?g_st=ac", async (kind, arg) => {
    asked.push(kind + ":" + arg);
    return kind === "resolve" ? `https://www.google.com/maps/@/data=!4m3!11m2!2s${LIST_ID}!3e3` : googleList();
  });
  assert.deepStrictEqual(asked, ["resolve:abc", "list:" + LIST_ID]);
  assert.deepStrictEqual([got.name, got.source, got.places.length], ["Italy", LIST_ID, 5]);
});

atest("a long place link needs no network, and a stray link says what it isn't", async () => {
  const got = await T.fetchGoogle("https://www.google.com/maps/place/Pantheon/@41.8986,12.4769,17z", () => { throw new Error("no network"); });
  assert.deepStrictEqual(got.places, [{ name: "Pantheon", lat: 41.8986, lng: 12.4769 }]);
  await assert.rejects(T.fetchGoogle("https://example.com/", async () => ""), /isn't a Google Maps list or place/);
  await assert.rejects(T.fetchGoogle("  ", async () => ""), /Paste a Google Maps link/);
});

atest("it says what it's doing, and why it stopped", async () => {
  const steps = [];
  await T.fetchGoogle("https://maps.app.goo.gl/abc", async (kind) => (kind === "resolve" ? `https://www.google.com/maps/@/data=!4m3!11m2!2s${LIST_ID}!3e3` : googleList()), (m) => steps.push(m));
  assert.deepStrictEqual(steps, ["Opening the link…", "Reading the list…"]);
  await assert.rejects(T.fetchGoogle("https://maps.app.goo.gl/abc", async (kind) => (kind === "resolve" ? `https://www.google.com/maps/@/data=!4m3!11m2!2s${LIST_ID}!3e3` : "<html>sign in</html>")),
    /isn't a list — it may be private/);
  await assert.rejects(T.fetchGoogle("https://maps.app.goo.gl/abc", async () => "https://www.google.com/maps/dir/Rome/Milan"),
    /That link opened www\.google\.com\/maps\/dir\/Rome\/Milan, not a saved list or a place/);
});

(async () => {
  for (const [name, fn] of later) {
    try { await fn(); passed++; console.log("  ok - " + name); }
    catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
  }
  console.log(`\n${passed} test(s) passed.`);
})();
