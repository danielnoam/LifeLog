// What a holding really did: a 4-for-1 split after the buy counted in the
// shares (not read as a 75% loss), the cash dividends on the shares held,
// a fee on a buy, the yearly return from a year in, the Worth chart under
// You hold, and the fee field in the buy sheet.
// SHOTS=dir [THEME=light] writes the Investments mode at both widths.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const T = "2024-01-01T00:00:00.000Z";
// Weekday closes from 2024 to 6 Nov 2026: $400 a share until a 4-for-1
// split on 2 Mar 2026, then $100 and climbing a little.
function points() {
  const out = [];
  for (let t = Date.UTC(2024, 0, 2), i = 0; t <= Date.UTC(2026, 10, 6); t += 864e5) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const day = d.toISOString().slice(0, 10);
    const raw = (day < "2026-03-02" ? 400 : 100) * (1 + i++ * 0.0003);
    const adj = day < "2026-03-02" ? raw / 4 : raw;
    out.push(adj === raw ? [day, Math.round(raw * 100) / 100] : [day, Math.round(adj * 100) / 100, Math.round(raw * 100) / 100]);
  }
  return out;
}
const PTS = points();
const EVENTS = [["2025-06-02", 2, 1], ["2026-03-02", 0, 4], ["2026-06-01", 0.5, 1]];
const WATCH = [{
  id: "w1", symbol: "ACME", name: "Acme Fund", createdAt: T, updatedAt: T,
  buys: [{ id: "b1", date: "2024-02-01", units: 10, price: 400, fee: 2, createdAt: T, updatedAt: T }],
}];
const seed = { categories: [], entries: [], backlog: [], notes: [], habits: [], financeEntries: [], recurringExpenses: [], projects: [], financeCategories: [], settings: { steam: { proxyUrl: "https://proxy.test" }, mediaKeys: { tiingo: "tk" } } };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const shots = process.env.SHOTS, theme = process.env.THEME || "";
  for (const width of [1280, 390]) {
    const at = " (" + width + "px)";
    const page = await b.newPage({ viewport: { width, height: 1000 }, colorScheme: theme === "light" ? "light" : "dark" });
    await page.clock.setFixedTime(new Date("2026-11-07T15:00:00Z"));
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route("https://proxy.test/**", (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate(async ({ s, watch, pts, events, theme }) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "invest" }));
      if (theme) localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ theme }));
      await window.LifeLogStorage.invest.save({ watchlist: watch, pins: [] });
      await window.LifeLogStorage.deviceSet("investPrices", { ACME: { points: pts, events, at: new Date().toISOString() } });
    }, { s: seed, watch: WATCH, pts: PTS, events: EVENTS, theme });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".invest-hold-stats", { timeout: 8000 });

    const stats = await page.$$eval(".invest-hold .invest-stat", (n) => n.map((x) => x.textContent));
    check("the split's new shares are counted" + at, stats[0] === "Shares40", stats);
    check("the average cost follows the split, with the fee" + at, stats[1] === "Average cost$100.05", stats);
    const last = PTS[PTS.length - 1][1];
    check("the gain isn't read as a 75% loss" + at, !/−7\d\.\d%/.test(stats[3]) && (last * 40 - 4002 >= 0 ? stats[3].startsWith("Gain+") : true), stats);
    const returns = await page.textContent(".invest-hold .invest-returns");
    check("the dividends on the shares held show" + at, returns.includes("Dividends $40.00"), returns);
    check("the yearly return shows from a year in" + at, /A year [+−]\d/.test(returns), returns);
    check("all in counts the dividends" + at, /All in [+−]\$/.test(returns), returns);
    check("the buy row says its fee" + at, (await page.textContent(".invest-buy")).includes("$2.00 fee"));
    await page.waitForSelector(".invest-worth .invest-worth-chart svg path.invest-putline", { state: "attached" });
    check("the Worth chart sits under You hold" + at, await page.isVisible(".invest-list .invest-worth"));
    check("the Worth chart has no drop on the split's day" + at, await page.evaluate(() => {
      const d = document.querySelector(".invest-worth .invest-line").getAttribute("d").split(/[ML]/).filter(Boolean).map((p) => +p.split(",")[1]);
      return d.every((y, i) => !i || Math.abs(y - d[i - 1]) < 20);
    }));
    check("You hold's line adds the dividends and the yearly return" + at, /Dividends \$40\.00/.test(await page.textContent(".invest-sum-returns")));
    if (shots) await page.screenshot({ path: `${shots}/invest-returns-${theme || "default"}-${width < 720 ? "phone" : "desktop"}.png`, fullPage: true });

    await page.click(".invest-addbuy");
    await page.waitForSelector("#investBuyModal:not([hidden])");
    await page.fill("#investBuyUnits", "2");
    await page.fill("#investBuyPrice", "110");
    await page.fill("#investBuyFee", "one");
    await page.click("#investBuySaveBtn");
    check("a fee that isn't a number is refused" + at, await page.isVisible("#investBuyModal:not([hidden])"));
    await page.fill("#investBuyFee", "1.5");
    check("the total counts the fee" + at, (await page.textContent("#investBuyTotal")).includes("$221.50"));
    await page.click("#investBuySaveBtn");
    await page.waitForSelector("#investBuyModal", { state: "hidden" });
    const saved = await page.evaluate(async () => { await window.LifeLogInvest.flush(); return (await window.LifeLogStorage.invest.load()).doc.watchlist[0].buys; });
    check("the fee is saved on the buy" + at, saved.some((x) => x.fee === 1.5 && x.units === 2), saved);
    await page.close();
  }
  check("no page errors", errs.length === 0, errs);
  await b.close();
  done();
})();
