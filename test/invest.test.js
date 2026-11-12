// Zero-dependency tests for src/invest.js's pure parts (the Ledger's
// watchlist) and its merge in src/merge.js — run with `node test/invest.test.js`.
const assert = require("assert");
global.window = {};
require("../src/invest.js");
const M = require("../src/merge.js");
const I = global.window.LifeLogInvest;
I.init({ uid: (() => { let n = 0; return () => "u" + (n++); })() });

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}
const T0 = "2026-01-01T00:00:00.000Z", T1 = "2026-02-01T00:00:00.000Z";
const series = (pairs) => pairs.map(([d, v]) => [d, v]);

test("a ticker is upper case letters, digits, dots and dashes", () => {
  assert.strictEqual(I.cleanSymbol(" brk.b "), "BRK.B");
  assert.strictEqual(I.cleanSymbol("voo"), "VOO");
  assert.strictEqual(I.cleanSymbol("not a ticker"), "");
  assert.strictEqual(I.cleanSymbol("$VOO"), "");
  assert.strictEqual(I.cleanSymbol("ABCDEFGHIJKLM"), "", "13 characters is too long");
});

test("a target is a positive price; a note and a name are trimmed; unknown fields ride along", () => {
  const w = I.sanitizeWatch({ id: "w1", symbol: "voo", name: " Vanguard ", target: "$1,250.5", note: "  buy  ", extra: 1 });
  assert.deepStrictEqual([w.symbol, w.name, w.target, w.note, w.extra], ["VOO", "Vanguard", 1250.5, "buy", 1]);
  assert.ok(!("target" in I.sanitizeWatch({ symbol: "VOO", target: -3 })));
  assert.ok(!("target" in I.sanitizeWatch({ symbol: "VOO", target: "soon" })));
  assert.ok(!("note" in I.sanitizeWatch({ symbol: "VOO", note: "  " })));
});

test("a pin needs a real date and a ticker that's still there", () => {
  const doc = I.sanitizeDoc({
    watchlist: [{ id: "w1", symbol: "VOO" }],
    pins: [
      { id: "p1", watch: "w1", date: "2026-01-05", label: " Opened " },
      { id: "p2", watch: "w1", date: "2026-02-30" },
      { id: "p3", watch: "gone", date: "2026-01-06" },
    ],
  });
  assert.deepStrictEqual(doc.pins.map((p) => [p.id, p.label]), [["p1", "Opened"]]);
});

test("the same ticker added on two devices folds into the first, pins and all", () => {
  const doc = I.sanitizeDoc({
    watchlist: [
      { id: "late", symbol: "VOO", target: 550, createdAt: T1 },
      { id: "early", symbol: "voo", createdAt: T0 },
      { id: "q", symbol: "QQQ", createdAt: T0 },
    ],
    pins: [{ id: "p1", watch: "late", date: "2026-01-05" }, { id: "p2", watch: "early", date: "2026-03-01" }],
  });
  assert.deepStrictEqual(doc.watchlist.map((w) => w.id), ["early", "q"], "the earlier one keeps its place in the list");
  assert.strictEqual(doc.watchlist[0].target, 550, "a target only the other had comes along");
  assert.deepStrictEqual(doc.pins.map((p) => p.watch), ["early", "early"]);
});

test("a range starts a span back from the last close, from the close before when that's a weekend", () => {
  assert.strictEqual(I.rangeStart("1Y", "2026-11-06"), "2025-11-06");
  assert.strictEqual(I.rangeStart("1M", "2026-03-31"), "2026-02-28", "the 31st a month back is the end of February");
  assert.strictEqual(I.rangeStart("YTD", "2026-11-06"), "2026-01-01");
  assert.strictEqual(I.rangeStart("Max", "2026-11-06"), null);
  const pts = series([["2025-11-03", 1], ["2025-11-07", 2], ["2025-11-10", 3], ["2026-11-06", 4]]);
  // A year back from 6 Nov is 6 Nov, between the 3rd and the 7th: the 3rd's close is where it starts.
  assert.deepStrictEqual(I.sliceRange(pts, "1Y").map((p) => p[0]), ["2025-11-03", "2025-11-07", "2025-11-10", "2026-11-06"]);
  assert.deepStrictEqual(I.sliceRange(pts, "1M").map((p) => p[0]), ["2025-11-10", "2026-11-06"]);
  assert.strictEqual(I.sliceRange(pts, "Max").length, 4);
  assert.deepStrictEqual(I.sliceRange([], "1Y"), []);
});

test("a day's price is that day's close, or the last before it; none before the series", () => {
  const pts = series([["2026-01-02", 10], ["2026-01-05", 11], ["2026-01-06", 12]]);
  assert.strictEqual(I.priceOn(pts, "2026-01-05"), 11);
  assert.strictEqual(I.priceOn(pts, "2026-01-04"), 10, "a Sunday takes Friday's close");
  assert.strictEqual(I.priceOn(pts, "2026-03-01"), 12);
  assert.strictEqual(I.priceOn(pts, "2025-12-31"), null);
});

test("pins in date order, the move between each, to now, and since the first", () => {
  const pts = series([["2026-01-05", 100], ["2026-06-01", 110], ["2026-11-06", 99]]);
  const s = I.pinSteps([
    { id: "b", date: "2026-06-01", createdAt: T0 },
    { id: "a", date: "2026-01-05", createdAt: T0 },
  ], pts);
  assert.deepStrictEqual(s.steps.map((x) => [x.pin.id, x.price]), [["a", 100], ["b", 110]]);
  assert.strictEqual(s.steps[0].change, null);
  assert.ok(Math.abs(s.steps[1].change - 0.1) < 1e-9);
  assert.strictEqual(s.steps[1].days, 147);
  assert.ok(Math.abs(s.now.change - (99 / 110 - 1)) < 1e-9);
  assert.ok(Math.abs(s.total - -0.01) < 1e-9);
  assert.strictEqual(I.spanLabel(147), "5 months");
  assert.strictEqual(I.spanLabel(1), "1 day");
  assert.strictEqual(I.spanLabel(1000), "2.7 years");
  // One pin: no total, as it would only repeat the step to now.
  assert.strictEqual(I.pinSteps([{ id: "a", date: "2026-01-05" }], pts).total, null);
});

test("percentages and dollars read the way the Ledger writes them", () => {
  assert.strictEqual(I.pct(0.1234), "+12.3%");
  assert.strictEqual(I.pct(-0.004), "−0.40%");
  assert.strictEqual(I.usd(1234.5), "$1,234.50");
  assert.strictEqual(I.usd(0.1234), "$0.1234");
});

test("Tiingo's rows become adjusted closes; a split or dividend asks for the history again", () => {
  const rows = [
    { date: "2026-01-06T00:00:00.000Z", close: 200, adjClose: 100, divCash: 0, splitFactor: 1 },
    { date: "2026-01-05T00:00:00.000Z", close: 99, adjClose: 99 },
    { date: "bad", close: 5 },
    { date: "2026-01-07T00:00:00.000Z", close: 0 },
  ];
  assert.deepStrictEqual(I.parseTiingo(rows), [["2026-01-05", 99], ["2026-01-06", 100]]);
  assert.strictEqual(I.rewritesHistory(rows), false);
  assert.strictEqual(I.rewritesHistory([{ divCash: 1.2 }]), true);
  assert.strictEqual(I.rewritesHistory([{ splitFactor: 10 }]), true);
  assert.deepStrictEqual(I.joinSeries([["a", 1], ["b", 2], ["c", 3]], [["c", 4], ["d", 5]]), [["a", 1], ["b", 2], ["c", 4], ["d", 5]]);
});

test("a search keeps active US tickers only", () => {
  const r = I.parseSearch([
    { ticker: "voo", name: "Vanguard S&P 500 ETF", assetType: "ETF", isActive: true, countryCode: "US" },
    { ticker: "OLD", name: "Gone", isActive: false },
    { ticker: "VOD", name: "Vodafone", countryCode: "GB" },
  ]);
  assert.deepStrictEqual(r.map((x) => x.symbol), ["VOO"]);
});

test("the merge keeps both devices' pins on one ticker, and a removal on one side", () => {
  const base = { watchlist: [{ id: "w1", symbol: "VOO", updatedAt: T0 }, { id: "w2", symbol: "QQQ", updatedAt: T0 }], pins: [] };
  const local = { watchlist: base.watchlist, pins: [{ id: "p1", watch: "w1", date: "2026-01-05", updatedAt: T1 }] };
  const remote = { watchlist: [base.watchlist[0]], pins: [{ id: "p2", watch: "w1", date: "2026-06-01", updatedAt: T1 }] };
  const out = M.mergeInvest(base, local, remote);
  assert.deepStrictEqual(out.pins.map((p) => p.id).sort(), ["p1", "p2"]);
  assert.deepStrictEqual(out.watchlist.map((w) => w.id), ["w1"], "QQQ removed on the other device stays removed");
});

test("a buy needs a real day, shares and a price above zero; fractions are fine", () => {
  const w = I.sanitizeWatch({ symbol: "VOO", buys: [
    { id: "b2", date: "2026-03-01", units: "0.5", price: "$600" },
    { id: "b1", date: "2026-01-05", units: 2, price: 500, sell: false, note: " first " },
    { id: "bad1", date: "2026-02-30", units: 1, price: 1 },
    { id: "bad2", date: "2026-02-01", units: 0, price: 1 },
    { id: "bad3", date: "2026-02-01", units: 1, price: -4 },
  ] });
  assert.deepStrictEqual(w.buys.map((b) => [b.id, b.units, b.price]), [["b1", 2, 500], ["b2", 0.5, 600]], "kept in date order");
  assert.strictEqual(w.buys[0].note, "first");
  assert.ok(!("sell" in w.buys[0]));
  assert.ok(!("buys" in I.sanitizeWatch({ symbol: "VOO", buys: [] })));
});

test("a holding is at average cost: a sale takes shares out at the average and its profit is realized", () => {
  const h = I.holdingOf([
    { date: "2026-01-01", units: 10, price: 100 },
    { date: "2026-02-01", units: 10, price: 200 },
    { date: "2026-03-01", units: 5, price: 300, sell: true },
  ], 250);
  assert.strictEqual(h.units, 15);
  assert.strictEqual(h.avg, 150);
  assert.strictEqual(h.cost, 2250);
  assert.strictEqual(h.realized, 750, "5 sold at 300 over an average of 150");
  assert.strictEqual(h.value, 3750);
  assert.strictEqual(h.gain, 1500);
  assert.ok(Math.abs(h.gainPct - 2 / 3) < 1e-9);
  const none = I.holdingOf([{ date: "2026-01-01", units: 1, price: 10, sell: true }], 20);
  assert.deepStrictEqual([none.units, none.value, none.realized], [0, null, 0], "a sale with nothing held counts for nothing");
  assert.strictEqual(I.holdingOf([{ date: "2026-01-01", units: 3, price: 10 }], null).value, null, "no close, no value");
});

test("two days compare either way round, from the close on or before each", () => {
  const pts = series([["2026-01-02", 100], ["2026-01-05", 110], ["2026-02-02", 121]]);
  const c = I.compareDays(pts, "2026-02-02", "2026-01-03");
  assert.deepStrictEqual([c.from, c.to, c.fromPrice, c.toPrice, c.diff, c.days], ["2026-01-03", "2026-02-02", 100, 121, 21, 30]);
  assert.ok(Math.abs(c.change - 0.21) < 1e-9);
});

test("the widget gets the holding, a row per ticker with its day and month, and dots when hidden", () => {
  const days = [];
  for (let t = Date.UTC(2026, 9, 1); t <= Date.UTC(2026, 10, 10); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const pts = days.map((d, i) => [d, 100 + i]);
  const list = [
    { id: "w1", symbol: "VOO", name: "Vanguard", buys: [{ date: "2026-10-01", units: 2, price: 100 }] },
    { id: "w2", symbol: "AAPL", name: "Apple Inc", target: 200 },
    { id: "w3", symbol: "NEW", name: "No prices yet" },
  ];
  const last = pts[pts.length - 1][1];
  const out = I.widgetOf(list, { VOO: { points: pts }, AAPL: { points: pts } });
  assert.strictEqual(out.day, "2026-11-10");
  assert.match(out.closed, /^Closed /);
  assert.strictEqual(out.hold.value, I.usd(2 * last));
  assert.ok(out.hold.up && out.hold.todayUp);
  assert.match(out.hold.today, /^\+\$2\.00 today$/);
  const [voo, aapl, none] = out.rows;
  assert.deepStrictEqual([voo.symbol, voo.price, voo.hit, voo.up], ["VOO", I.usd(last), false, true]);
  assert.match(voo.sub, /^2 shares · /);
  assert.strictEqual(aapl.sub, "Apple Inc");
  assert.ok(aapl.hit, "under its target");
  assert.ok(voo.spark.length > 1 && voo.spark.length <= 33 && voo.spark[0] === 0 && voo.spark[voo.spark.length - 1] === 1);
  assert.deepStrictEqual([none.price, none.day, none.spark], ["—", "", []]);
  const hid = I.widgetOf(list, { VOO: { points: pts } }, { hidden: true });
  assert.deepStrictEqual([hid.hold.value, hid.hold.gain, hid.rows[0].sub, hid.rows[0].price, hid.rows[0].spark], ["•••••", "", "Holding", "•••", []]);
  assert.strictEqual(I.widgetOf(list.slice(1), {}).hold, null, "nothing held, no total");
  assert.strictEqual(I.widgetOf([], {}), null);
});

test("the same ticker on two devices keeps both devices' buys", () => {
  const doc = I.sanitizeDoc({ watchlist: [
    { id: "a", symbol: "VOO", createdAt: T0, buys: [{ id: "b1", date: "2026-01-05", units: 1, price: 500 }] },
    { id: "b", symbol: "VOO", createdAt: T1, buys: [{ id: "b2", date: "2026-02-05", units: 2, price: 520 }] },
  ] });
  assert.deepStrictEqual(doc.watchlist[0].buys.map((b) => b.id), ["b1", "b2"]);
});

test("the merge keeps a buy logged on each device on the same ticker, and a deletion on one", () => {
  const b0 = { id: "b0", date: "2026-01-01", units: 1, price: 400, updatedAt: T0 };
  const base = { watchlist: [{ id: "w1", symbol: "VOO", updatedAt: T0, buys: [b0] }], pins: [] };
  const local = { watchlist: [{ id: "w1", symbol: "VOO", updatedAt: T1, buys: [b0, { id: "bl", date: "2026-03-01", units: 1, price: 500, updatedAt: T1 }] }], pins: [] };
  const remote = { watchlist: [{ id: "w1", symbol: "VOO", target: 450, updatedAt: "2026-02-15T00:00:00.000Z", buys: [{ id: "br", date: "2026-02-01", units: 2, price: 450, updatedAt: T1 }] }], pins: [] };
  const out = M.mergeInvest(base, local, remote);
  assert.deepStrictEqual(out.watchlist[0].buys.map((b) => b.id), ["br", "bl"], "both new buys, in date order; b0 deleted on the remote");
  assert.strictEqual(out.watchlist[0].target, 450, "the rest of the ticker is the newer side's");
});

console.log(`\n${passed} test(s) passed.`);
