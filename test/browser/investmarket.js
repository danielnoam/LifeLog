// The Investments mode against the market's clock (frozen at Monday 9 Nov
// 2026, 12:00 New York): today's price from IEX on the end of the chart,
// the S&P 500 (SPY) line and its switch, the same-money line under Holding
// and the You hold total, a target that rings over its price, and no
// second ask for closes before the next one is due.
// SHOTS=dir also writes screenshots at both widths.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const NOW = "2026-11-09T17:00:00Z";
// Weekday closes from 2025 to Friday 6 Nov 2026; QQQ climbs faster than SPY.
function rows(symbol, startDate) {
  const out = [];
  const rate = symbol === "SPY" ? 0.0003 : 0.0008;
  let price = symbol === "SPY" ? 500 : 400;
  for (let t = Date.UTC(2025, 0, 2); t <= Date.UTC(2026, 10, 6); t += 864e5) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const day = d.toISOString().slice(0, 10);
    price *= 1 + rate + Math.sin(t / 864e5 / 7) * 0.002;
    if (day >= (startDate || "0000")) out.push({ date: day + "T00:00:00.000Z", close: price, adjClose: price, divCash: 0, splitFactor: 1 });
  }
  return out;
}
const seed = {
  categories: [], entries: [], backlog: [], notes: [], accomplishments: {}, habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: { steam: { proxyUrl: "https://proxy.test" }, mediaKeys: { tiingo: "tk-1" } },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const width of [1280, 390]) {
    const at = " (" + width + "px)";
    const page = await b.newPage({ viewport: { width, height: 900 } });
    await page.clock.setFixedTime(new Date(NOW));
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    const asked = [];
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route("https://proxy.test/**", (r) => {
      const u = new URL(r.request().url());
      asked.push(u.pathname + u.search);
      let body = {}, m;
      if ((m = /^\/tiingo-meta\/(.+)$/.exec(u.pathname))) body = { ticker: m[1], name: m[1] === "QQQ" ? "Invesco QQQ Trust" : m[1] };
      else if ((m = /^\/tiingo-prices\/(.+)$/.exec(u.pathname))) body = rows(m[1], u.searchParams.get("startDate"));
      else if ((m = /^\/tiingo-iex\/(.+)$/.exec(u.pathname))) {
        const last = rows(m[1]).slice(-1)[0].close;
        body = [{ ticker: m[1].toLowerCase(), tngoLast: Math.round(last * 1.02 * 100) / 100, prevClose: last, timestamp: "2026-11-09T11:55:00-05:00" }];
      }
      r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "invest" }));
    }, seed);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".empty-state .btn-primary");

    // QQQ with a target over its price.
    await page.click(".empty-state .btn-primary");
    await page.waitForSelector("#watchModal:not([hidden])");
    await page.fill("#watchSymbol", "QQQ");
    await page.fill("#watchTarget", "2000");
    await page.click('#watchTargetDir .seg-btn[data-dir="above"]');
    check("the target's way is a two-button choice" + at, (await page.getAttribute('#watchTargetDir .seg-btn[data-dir="above"]', "aria-pressed")) === "true");
    await page.click("#watchSaveBtn");
    await page.waitForSelector(".invest-chart svg .invest-line", { timeout: 8000 });

    check("SPY's closes are asked for beside the ticker's" + at, asked.some((a) => a.startsWith("/tiingo-prices/SPY")), asked);
    await page.waitForSelector(".invest-benchline", { timeout: 8000 });
    check("the S&P 500 is a faint line on the chart" + at, (await page.$$(".invest-benchline")).length === 1);
    check("with its move at the end" + at, /^S&P 500 [+−][\d.]+%$/.test(await page.textContent(".invest-benchlabel")));
    await page.waitForSelector(".invest-meta >> text=/As of/", { timeout: 8000 });
    check("today's price is asked for while the market trades" + at, asked.some((a) => a === "/tiingo-iex/QQQ"), asked);
    const meta = await page.textContent(".invest-meta");
    check("the price line says as of when, the day's move and when it closes" + at, /^As of .+ · \+2\.0% today · Closes in 4 h 0 min$/.test(meta), meta);
    check("the target chip says it rings over its price" + at, /^Target \$2,000\.00 and up · /.test(await page.textContent(".invest-target")));

    // Hiding the line is per device and leaves the rest.
    await page.click(".invest-bench-btn");
    check("the S&P 500 button hides the line" + at, (await page.$$(".invest-benchline")).length === 0 && (await page.getAttribute(".invest-bench-btn", "aria-pressed")) === "false");
    await page.click(".invest-bench-btn");
    check("and brings it back" + at, (await page.$$(".invest-benchline")).length === 1);

    // A buy: the same money in SPY on the same day.
    await page.click(".invest-addbuy");
    await page.waitForSelector("#investBuyModal:not([hidden])");
    await page.fill("#investBuyDate", "2026-01-05");
    await page.dispatchEvent("#investBuyDate", "change");
    await page.fill("#investBuyUnits", "10");
    await page.click("#investBuySaveBtn");
    await page.waitForSelector(".invest-bench");
    const bench = await page.textContent(".invest-chart-card .invest-bench");
    check("Holding is followed by the same money in the S&P 500" + at, /^The same money in the S&P 500 would be worth \$[\d,.]+ \(\+[\d.]+%\)\. You're \$[\d,.]+ ahead\.$/.test(bench), bench);
    check("the You hold total has the comparison too" + at, /^All you bought: \+[\d.]+%\. The same money in the S&P 500: \+[\d.]+%\.$/.test(await page.textContent(".invest-bench-sum")));
    check("the list row's price is today's" + at, /\+[\d.]+%/.test(await page.textContent(".invest-row >> nth=0")));

    // A reload asks for no closes: the next one isn't due until 17:30 New York.
    // The watchlist written out, and the prices (kept after 300ms).
    await page.evaluate(() => window.LifeLogInvest.flush());
    await page.waitForTimeout(500);
    asked.length = 0;
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".invest-chart svg .invest-line", { timeout: 8000 });
    await page.waitForTimeout(400);
    check("fresh closes aren't asked for again before the next is due" + at, !asked.some((a) => a.startsWith("/tiingo-prices/")), asked);

    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/investmarket-${width}.png`, fullPage: true });
    await page.close();
  }
  check("no page errors", errs.length === 0, errs);
  await b.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
