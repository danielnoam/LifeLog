// Home's Investments section: what you hold with the gain and today's move,
// a row per ticker (sparkline, close, day's move, At target), a tap opening
// that ticker in the Ledger, Add ticker, and the empty watchlist.
// SHOTS=dir [THEME=light] writes the section at both widths.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const T = "2026-01-01T00:00:00.000Z";
function closes(start, drift, wobble) {
  const out = [];
  let p = start;
  for (let t = Date.UTC(2026, 6, 1), i = 0; t <= Date.UTC(2026, 10, 12); t += 864e5) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    p *= 1 + drift + (Math.sin(i / (4 + start % 7) + start) + Math.sin(i++ / 1.7 + start / 3) * 0.6) * wobble;
    out.push([d.toISOString().slice(0, 10), Math.round(p * 100) / 100]);
  }
  return out;
}
const WATCH = [
  { id: "w1", symbol: "VOO", name: "Vanguard S&P 500 ETF", buys: [{ id: "b1", date: "2026-03-02", units: 4, price: 480, createdAt: T, updatedAt: T }], createdAt: T, updatedAt: T },
  { id: "w2", symbol: "QQQ", name: "Invesco QQQ Trust", buys: [{ id: "b2", date: "2026-05-04", units: 2.5, price: 455, createdAt: T, updatedAt: T }], createdAt: T, updatedAt: T },
  { id: "w3", symbol: "AAPL", name: "Apple Inc", target: 240, createdAt: T, updatedAt: T },
  { id: "w4", symbol: "NVDA", name: "NVIDIA Corp", createdAt: T, updatedAt: T },
];
const PRICES = { VOO: closes(520, 0.0009, 0.006), QQQ: closes(470, 0.0011, 0.009), AAPL: closes(255, -0.0006, 0.008), NVDA: closes(150, 0.0012, 0.014) };
const seed = { categories: [], entries: [], backlog: [], notes: [], habits: [], financeEntries: [], recurringExpenses: [], projects: [], financeCategories: [], settings: { steam: { proxyUrl: "https://proxy.test" }, mediaKeys: { tiingo: "tk" } } };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const shots = process.env.SHOTS, theme = process.env.THEME || "";
  for (const width of [1280, 390]) {
    const at = " (" + width + "px)";
    const page = await b.newPage({ viewport: { width, height: 900 }, colorScheme: theme === "light" ? "light" : "dark" });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route("https://proxy.test/**", (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate(async ({ s, watch, prices, theme }) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "home" }));
      localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ homeSections: ["invest", "ledger", "progress", "upcoming", "scratchpad", "pinned"], ...(theme ? { theme } : {}) }));
      await window.LifeLogStorage.invest.save({ watchlist: watch, pins: [] });
      const now = new Date().toISOString(), map = {};
      for (const k in prices) map[k] = { points: prices[k], at: now };
      await window.LifeLogStorage.deviceSet("investPrices", map);
    }, { s: seed, watch: WATCH, prices: PRICES, theme });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".home-invest .home-invest-row", { timeout: 8000 });

    const sec = (sel) => page.$$eval(".home-invest " + sel, (n) => n.map((x) => x.textContent));
    check("the section is headed Investments" + at, (await page.textContent(".home-invest h2")).includes("Investments"));
    const voo = PRICES.VOO.at(-1)[1] * 4, qqq = PRICES.QQQ.at(-1)[1] * 2.5;
    const want = "$" + (voo + qqq).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const got = await page.textContent(".home-invest .home-ledger-total");
    check("You hold is the value of every buy" + at, got === want, [got, want]);
    check("the gain since buying shows" + at, /since you bought$/.test(await page.textContent(".home-invest-gain")));
    check("each ticker has a row in watchlist order" + at, (await sec(".home-invest-row .home-row-title")).map((t) => t.replace("At target", "")).join() === "VOO,QQQ,AAPL,NVDA");
    check("a row has a sparkline, close and day's move" + at, (await page.$$(".home-invest-row .invest-spark path")).length === 4 && /^\$[\d,.]+[+−-]/.test((await sec(".home-invest-end"))[0]), await sec(".home-invest-end"));
    const aaplHit = PRICES.AAPL.at(-1)[1] <= 240;
    check("a ticker at its target is tagged" + at, (await sec(".home-invest-hit")).length === (aaplHit ? 1 : 0));
    check("the foot says when the market closed" + at, /^Closed /.test(await page.textContent(".home-invest-closed")));
    if (shots) await page.locator(".home-invest").screenshot({ path: `${shots}/home-invest-${theme || "default"}-${width < 720 ? "phone" : "desktop"}.png` });
    if (shots && width >= 720) await page.screenshot({ path: `${shots}/home-${theme || "default"}-desktop.png` });

    await page.click(".home-invest-row >> text=QQQ");
    await page.waitForSelector(".invest-head", { timeout: 5000 });
    check("a tap opens that ticker in the Ledger" + at, (await page.textContent(".invest-head")).includes("QQQ"));

    await page.evaluate(async () => { await window.LifeLogStorage.invest.save({ watchlist: [], pins: [] }); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "home" })); });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".home-invest .home-invest-none");
    check("an empty watchlist says so" + at, (await page.textContent(".home-invest .home-invest-none")) === "Nothing on your watchlist yet.");
    await page.click(".home-invest .btn >> text=Add ticker");
    check("Add ticker opens the ticker sheet" + at, await page.isVisible("#watchModal:not([hidden])"));
    await page.close();
  }
  await b.close();
  done(errs);
})();
