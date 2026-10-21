// Zero-dependency tests for src/alerts.js — run with `node test/alerts.test.js`.
// What a phone is told to ring: charge heads-ups off the real recurrence
// maths in finance.js, and release days off the Backlog.
const assert = require("assert");
global.window = {};
require("../src/finance.js");
require("../src/alerts.js");
const Finance = global.window.LifeLogFinance;
const { alertsOf, outDay } = global.window.LifeLogAlerts;

Finance.init({
  state: { data: { settings: { currency: "ILS" }, projects: [], financeEntries: [] } },
  uid: () => "x",
  backfillUpdatedAt: (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z",
  keepUnknown: (src, out) => out,
  MONTHS: ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"],
});

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok - " + name);
  } catch (e) {
    console.error("  FAIL - " + name);
    console.error("    " + e.message);
    process.exitCode = 1;
  }
}

const TODAY = "2026-10-17";
const fmt = { money: (n) => "₪" + n, day: (d) => d };
const plan = (extra) => ({ id: "p1", startDate: "2025-11-02", interval: "yearly", amount: 300, category: "Subscriptions", note: "Domain", createdAt: "2025-11-02T00:00:00Z", ...extra });
const charges = (data, map) => alertsOf(data, { today: TODAY, charges: map, finance: Finance, fmt });

test("a yearly plan set to a week before rings a week before its next charge", () => {
  const a = charges({ recurringExpenses: [plan()] }, { p1: "7" });
  assert.deepStrictEqual(a.map((x) => [x.day, x.time, x.title, x.body]),
    [["2026-10-26", "09:00", "Domain charges in 7 days", "₪300 on 2026-11-02"]]);
  assert.strictEqual(a[0].action, "open-finance");
});

test("a plan with no choice rings nothing, On the day rings that day", () => {
  assert.strictEqual(charges({ recurringExpenses: [plan()] }, {}).length, 0);
  const a = charges({ recurringExpenses: [plan()] }, { p1: "0" });
  assert.deepStrictEqual([a[0].day, a[0].title], ["2026-11-02", "Domain charges today"]);
});

test("a heads-up whose day has already passed is left out", () => {
  const monthly = plan({ interval: "monthly", startDate: "2026-01-20" });
  const a = charges({ recurringExpenses: [monthly] }, { p1: "7" });
  assert.ok(a.every((x) => x.day >= TODAY), JSON.stringify(a.map((x) => x.day)));
  assert.strictEqual(a[0].body, "₪300 on 2026-11-20", "Oct 20's heads-up was on the 13th");
});

test("a skipped charge and a stopped plan ring nothing", () => {
  const skipped = plan({ overrides: { "2026-11-02": { skip: true } } });
  assert.strictEqual(charges({ recurringExpenses: [skipped] }, { p1: "1" }).length, 0);
  const stopped = plan({ endDate: "2026-10-01" });
  assert.strictEqual(charges({ recurringExpenses: [stopped] }, { p1: "1" }).length, 0);
});

test("after a plan change the reminder set on the first plan still rings for the new one", () => {
  const old = plan({ interval: "monthly", startDate: "2026-01-25", endDate: "2026-09-24" });
  const next = plan({ id: "p2", prevId: "p1", interval: "monthly", startDate: "2026-09-25", amount: 350 });
  const a = charges({ recurringExpenses: [old, next] }, { p1: "1" });
  assert.deepStrictEqual(a.map((x) => x.body), ["₪350 on 2026-10-25", "₪350 on 2026-11-25"]);
});

const item = (extra) => ({ id: "b", title: "Show", category: "Shows", ...extra });
const releases = (backlog, mode) => alertsOf({ backlog }, { today: TODAY, releases: mode });

test("release day: starred items only, or everything, and nothing when off", () => {
  const bl = [item({ priority: 1, nextAt: "2026-10-20", nextLabel: "S2E3" }), item({ id: "c", title: "Game", releaseDate: "2026-10-20", releasePrecision: "day" })];
  assert.strictEqual(releases(bl, "off").length, 0);
  const starred = releases(bl, "starred");
  assert.deepStrictEqual(starred.map((x) => [x.day, x.title, x.action]), [["2026-10-20", "Show S2E3 is out today", "open-upcoming"]]);
  const all = releases(bl, "all");
  assert.deepStrictEqual(all.map((x) => [x.title, x.body]), [["2 things are out today", "Show S2E3, Game"]]);
});

test("release day: no day, a month, a past day or a dropped item ring nothing", () => {
  const bl = [
    item({ releaseDate: "2026-11", releasePrecision: "month" }),
    item({ releaseDate: "2026-10-01", releasePrecision: "day" }),
    item({ releaseDate: "2026-10-25", releasePrecision: "day", dropped: true }),
  ];
  assert.strictEqual(releases(bl, "all").length, 0);
  assert.strictEqual(outDay(item({ releaseDate: "2026-10-25" })), "2026-10-25");
});

// ---------- price alerts (0.276.0) ----------
const game = (extra) => ({ id: "g1", title: "Hades II", category: "Games", mediaSource: "steam", mediaId: "1145350", priceAlert: 15, ...extra });
const prices = (backlog, hits) => alertsOf({ backlog }, { today: TODAY, prices: hits });
const HIT = { g1: { day: TODAY, time: "10:31", price: 12.49 } };

test("price: a recorded hit rings at its own minute, with the price and the target", () => {
  const out = prices([game()], HIT);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], { id: "price-g1", kind: "price", day: TODAY, time: "10:31", title: "Hades II is $12.49", body: "Under your $15.00 on GG.deals", action: "open-backlog" });
});

test("price: no target, bought, dropped, a hit for another item, or an old hit ring nothing", () => {
  assert.deepStrictEqual(prices([game({ priceAlert: 0 })], HIT), []);
  assert.deepStrictEqual(prices([game({ bought: true })], HIT), []);
  assert.deepStrictEqual(prices([game({ dropped: true })], HIT), []);
  assert.deepStrictEqual(prices([game({ id: "g2" })], HIT), []);
  assert.deepStrictEqual(prices([game()], { g1: { ...HIT.g1, day: "2026-10-15" } }), []);
  assert.strictEqual(prices([game()], { g1: { ...HIT.g1, day: "2026-10-16" } }).length, 1, "yesterday's still rides, the phone skips a past minute itself");
});

test("price: hidden in widgets says a game is on sale, not which", () => {
  const out = alertsOf({ backlog: [game()] }, { today: TODAY, prices: HIT, hidden: true });
  assert.deepStrictEqual([out[0].title, out[0].body], ["LifeLog", "A game in your Backlog is on sale"]);
});

test("hidden in widgets: a notification says what kind of thing, not which", () => {
  const a = alertsOf({ recurringExpenses: [plan()], backlog: [item({ nextAt: "2026-10-20" })] },
    { today: TODAY, charges: { p1: "7" }, releases: "all", finance: Finance, fmt, hidden: true });
  assert.deepStrictEqual(a.map((x) => x.body), ["Something in your Backlog is out today", "A recurring charge is coming up"]);
  assert.ok(a.every((x) => x.title === "LifeLog"));
});

console.log(`\n${passed} test(s) passed.`);
