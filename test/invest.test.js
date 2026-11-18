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

test("a sale the buys before it can't cover is caught", () => {
  const buy = { id: "b", date: "2026-01-02", units: 3, price: 10, createdAt: "2026-01-02T10:00:00Z" };
  assert.strictEqual(I.shortSale([buy, { id: "s", date: "2026-01-05", units: 3, price: 12, sell: true, createdAt: "2026-01-05T10:00:00Z" }]), null);
  const over = I.shortSale([buy, { id: "s", date: "2026-01-05", units: 4, price: 12, sell: true, createdAt: "2026-01-05T10:00:00Z" }]);
  assert.deepStrictEqual([over.sale.id, over.held], ["s", 3], "more than held");
  const sameDay = I.shortSale([{ ...buy, date: "2026-01-05" }, { id: "s", date: "2026-01-05", units: 1, price: 12, sell: true, createdAt: "2026-01-01T10:00:00Z" }]);
  assert.strictEqual(sameDay.sale.id, "s", "logged before that day's buy");
  assert.strictEqual(I.shortSale([{ ...buy, date: "2026-02-01" }, { id: "s", date: "2026-01-05", units: 1, price: 12, sell: true }]).held, 0, "buy moved after the sale");
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

// ---------- the market clock, targets both ways, the S&P 500, today's price ----------
test("NYSE holidays by rule, with the weekend moves", () => {
  const h26 = I.marketHolidays(2026);
  for (const d of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]) assert.ok(h26.has(d), d);
  assert.strictEqual(h26.size, 10);
  assert.ok(I.marketHolidays(2027).has("2027-12-24"), "a Saturday Christmas is kept the Friday before");
  assert.ok(I.marketHolidays(2023).has("2023-01-02"), "a Sunday New Year's Day is kept the Monday after");
  assert.ok(!I.marketHolidays(2022).has("2021-12-31") && !I.marketHolidays(2021).has("2021-12-31"), "a Saturday New Year's Day isn't kept at all");
  assert.ok(I.marketHolidays(2025).has("2025-04-18"), "Good Friday 2025");
  assert.strictEqual(I.nextTradingDay("2026-11-25"), "2026-11-27", "Thanksgiving skipped");
  assert.strictEqual(I.nextTradingDay("2026-11-20"), "2026-11-23", "Friday → Monday");
  assert.ok(!I.isTradingDay("2026-11-21") && I.isTradingDay("2026-11-23"));
});

test("New York's clock follows summer time", () => {
  assert.strictEqual(new Date(I.nyTime("2026-11-18", 16 * 60)).toISOString(), "2026-11-18T21:00:00.000Z", "EST");
  assert.strictEqual(new Date(I.nyTime("2026-07-01", 16 * 60)).toISOString(), "2026-07-01T20:00:00.000Z", "EDT");
  assert.strictEqual(new Date(I.nyTime("2026-03-09", 9 * 60 + 30)).toISOString(), "2026-03-09T13:30:00.000Z", "the Monday after the change");
  assert.deepStrictEqual(I.nyParts(Date.parse("2026-11-19T02:30:00Z")), { day: "2026-11-18", minutes: 21 * 60 + 30 });
});

test("prices stay fresh until the next close should be out, then retry every two hours", () => {
  const entry = (lastDay, at) => ({ at, points: [["2026-11-01", 1], [lastDay, 2]] });
  const fri = entry("2026-11-20", "2026-11-20T23:00:00.000Z");
  assert.ok(!I.pricesStale(fri, Date.parse("2026-11-22T12:00:00Z")), "nothing asked over the weekend");
  assert.ok(!I.pricesStale(fri, Date.parse("2026-11-23T22:00:00Z")), "Monday before 17:30 New York");
  assert.ok(I.pricesStale(fri, Date.parse("2026-11-23T22:31:00Z")), "Monday's close is due");
  const asked = entry("2026-11-20", "2026-11-23T22:31:00.000Z");
  assert.ok(!I.pricesStale(asked, Date.parse("2026-11-23T23:30:00Z")), "asked after it was due and it wasn't there: wait");
  assert.ok(I.pricesStale(asked, Date.parse("2026-11-24T00:32:00Z")), "two hours on, ask again");
  assert.ok(!I.pricesStale(entry("2026-11-25", "2026-11-25T23:00:00.000Z"), Date.parse("2026-11-26T23:00:00Z")), "no close is due on Thanksgiving");
  assert.ok(I.pricesStale(null, 0) && I.pricesStale({ at: "x", points: [["2026-11-20", 1]] }, 0));
});

test("the market's state: open with its close, or closed with its next open", () => {
  assert.deepStrictEqual(I.marketNow(Date.parse("2026-11-18T15:00:00Z")), { open: true, day: "2026-11-18" });
  const sat = I.marketNow(Date.parse("2026-11-21T15:00:00Z"));
  assert.strictEqual(sat.open, false);
  assert.strictEqual(new Date(sat.opensAt).toISOString(), "2026-11-23T14:30:00.000Z");
  assert.strictEqual(new Date(I.marketNow(Date.parse("2026-11-18T13:00:00Z")).opensAt).toISOString(), "2026-11-18T14:30:00.000Z", "before the open, today's open");
  assert.strictEqual(I.waitWords(25 * 60000), "25 min");
  assert.strictEqual(I.waitWords(190 * 60000), "3 h 10 min");
  assert.strictEqual(I.waitWords(3 * 864e5), "3 days");
});

test("a target rings under its price, or with targetAbove over it", () => {
  const under = I.sanitizeWatch({ symbol: "VOO", target: 500 });
  const over = I.sanitizeWatch({ symbol: "VOO", target: 500, targetAbove: true });
  assert.ok(!("targetAbove" in under));
  assert.strictEqual(over.targetAbove, true);
  assert.ok(!("targetAbove" in I.sanitizeWatch({ symbol: "VOO", targetAbove: true })), "no direction without a target");
  assert.ok(!("targetAbove" in I.sanitizeWatch({ symbol: "VOO", target: 5, targetAbove: "yes" })));
  assert.ok(I.atTarget(under, 499) && I.atTarget(under, 500) && !I.atTarget(under, 501));
  assert.ok(I.atTarget(over, 501) && I.atTarget(over, 500) && !I.atTarget(over, 499));
  assert.ok(!I.atTarget(over, null) && !I.atTarget({ symbol: "VOO" }, 1));
  const doc = I.sanitizeDoc({ watchlist: [
    { id: "a", symbol: "AAPL", createdAt: T0 },
    { id: "b", symbol: "AAPL", target: 300, targetAbove: true, createdAt: T1 },
  ] });
  assert.deepStrictEqual([doc.watchlist[0].id, doc.watchlist[0].target, doc.watchlist[0].targetAbove], ["a", 300, true], "a folded twin's target keeps its direction");
  const w = I.widgetOf([over], { VOO: { points: [["2026-11-17", 490], ["2026-11-18", 510]] } });
  assert.strictEqual(w.rows[0].hit, true);
});

test("the same money in the S&P 500: buys buy SPY on their days, sales take the dollars back out", () => {
  const spy = [["2026-01-02", 100], ["2026-02-02", 110], ["2026-03-02", 120], ["2026-04-01", 150]];
  // $1,000 on 2 Jan (10 SPY) and $1,100 on 2 Feb (10 SPY): 20 SPY at 150 = $3,000.
  const buys = [{ id: "1", date: "2026-01-02", units: 10, price: 100 }, { id: "2", date: "2026-02-02", units: 10, price: 110 }];
  const b = I.benchmarkOf(buys, spy, 120);
  assert.strictEqual(b.paid, 2100);
  assert.strictEqual(Math.round(b.theirs), 3000);
  assert.strictEqual(b.mine, 2400, "20 shares at the last close");
  assert.strictEqual(Math.round(b.ahead), -600);
  assert.strictEqual(b.asOf, "2026-04-01");
  // Selling 10 shares at 200 on 1 Mar takes $2,000 out of SPY too (at 120: 16.67 SPY).
  const sold = I.benchmarkOf(buys.concat([{ id: "3", date: "2026-03-02", units: 10, price: 200, sell: true }]), spy, 120);
  assert.strictEqual(sold.mine, 10 * 120 + 2000);
  assert.strictEqual(Math.round(sold.theirs), Math.round((20 - 2000 / 120) * 150 + 2000));
  // A sale worth more than all the SPY there is takes it all, no more.
  const big = I.benchmarkOf([{ id: "1", date: "2026-01-02", units: 1, price: 100 }, { id: "2", date: "2026-03-02", units: 1, price: 1000, sell: true }], spy, 1000);
  assert.strictEqual(Math.round(big.theirs), 120, "the one SPY share sold at 120");
  assert.strictEqual(I.benchmarkOf(buys, [["2026-01-10", 100]], 120), null, "SPY's prices start after the first buy");
  assert.strictEqual(I.benchmarkOf([], spy, 1), null);
  const all = I.benchmarkAll([{ buys, last: 120 }, { buys: [{ id: "x", date: "2026-03-02", units: 1, price: 120 }], last: 150 }], spy);
  assert.strictEqual(all.paid, 2220);
  assert.strictEqual(Math.round(all.theirs), 3150);
});

test("today's price lays on the end of the closes only when it's from a later day", () => {
  const live = I.parseLive([{ ticker: "voo", tngoLast: 612.345, last: null, prevClose: 600, timestamp: "2026-11-18T18:42:10-05:00" }]);
  assert.deepStrictEqual([live.price, live.day], [612.345, "2026-11-18"]);
  assert.strictEqual(I.parseLive([{ tngoLast: null, last: null, mid: 0, timestamp: "2026-11-18T18:00:00Z" }]), null);
  assert.strictEqual(I.parseLive([]), null);
  assert.strictEqual(I.parseLive([{ last: 5, timestamp: "2026-11-18T19:00:00Z" }]).price, 5, "the last trade when Tiingo's own is missing");
  const closes = [["2026-11-16", 590], ["2026-11-17", 600]];
  const on = I.withLive(closes, live);
  assert.deepStrictEqual(on.slice(-1)[0], ["2026-11-18", 612.345]);
  assert.strictEqual(on.live, live);
  assert.strictEqual(I.withLive(closes.concat([["2026-11-18", 611]]), live).length, 3, "the close is in: the live price goes");
  const w = I.widgetOf([{ id: "w", symbol: "VOO", buys: [{ id: "b", date: "2026-11-16", units: 2, price: 590 }] }], { VOO: { points: closes, live } });
  assert.strictEqual(w.rows[0].price, "$612.35");
  assert.ok(/^As of /.test(w.closed), w.closed);
  assert.strictEqual(w.hold.today, "+$24.69 today");
});

console.log(`\n${passed} test(s) passed.`);
