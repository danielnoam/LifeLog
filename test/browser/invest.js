// The Ledger's Investments mode: a ticker added through the search, its chart
// and list row from Tiingo's daily closes on the proxy, the Range row, a
// target and note, pins with the change between them, a reload keeping it
// all, Undo after removing a ticker, and the setup card without a key.
// SHOTS=dir also writes screenshots of the mode at both widths.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

// Weekday closes from 2021 to 7 Nov 2026, a gentle climb with some wobble.
function rows(symbol, startDate) {
  const out = [];
  const seedOf = [...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 1000;
  let price = 300 + seedOf / 10;
  for (let t = Date.UTC(2021, 0, 4); t <= Date.UTC(2026, 10, 7); t += 864e5) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const day = d.toISOString().slice(0, 10);
    price *= 1 + Math.sin(t / 864e5 / 9 + seedOf) * 0.006 + 0.0004;
    if (day >= (startDate || "0000")) out.push({ date: day + "T00:00:00.000Z", close: price, adjClose: price, divCash: 0, splitFactor: 1 });
  }
  return out;
}
const NAMES = { VOO: "Vanguard S&P 500 ETF", QQQ: "Invesco QQQ Trust" };

const seed = (key) => ({
  categories: [], entries: [], backlog: [], notes: [], accomplishments: {}, habits: [],
  financeCategories: [{ name: "Food", color: "#3fb950" }], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: { steam: { proxyUrl: "https://proxy.test" }, mediaKeys: { tiingo: key } },
});

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const width of [1280, 390]) {
    const at = " (" + width + "px)";
    const page = await b.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    const asked = [];
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route("https://proxy.test/**", (r) => {
      const u = new URL(r.request().url());
      asked.push(u.pathname + u.search + " " + (r.request().headers().authorization || ""));
      let body = {};
      let m;
      if (u.pathname === "/tiingo-search") body = [{ ticker: "VOO", name: NAMES.VOO, assetType: "ETF", isActive: true, countryCode: "US" }, { ticker: "VOOG", name: "Vanguard S&P 500 Growth ETF", assetType: "ETF", isActive: true, countryCode: "US" }];
      else if ((m = /^\/tiingo-meta\/(.+)$/.exec(u.pathname))) body = { ticker: m[1], name: NAMES[m[1]] || m[1] + " Inc" };
      else if ((m = /^\/tiingo-prices\/(.+)$/.exec(u.pathname))) body = rows(m[1], u.searchParams.get("startDate"));
      r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "invest" }));
    }, seed("tk-123"));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    check("an empty watchlist offers to add a ticker" + at, await page.isVisible(".empty-state >> text=Nothing on your watchlist yet"));
    check("the Ledger tab has three mode dots" + at, (await page.$$eval('.tab[data-view="finance"] .tab-mode-dot', (d) => d.length)) === 3 || width < 720);
    await page.click(".empty-state .btn-primary");
    await page.waitForSelector("#watchModal:not([hidden])");
    await page.fill("#watchSymbol", "vanguard");
    await page.waitForSelector("#watchResults:not([hidden]) .invest-result");
    check("the search lists Tiingo's matches" + at, (await page.$$eval(".invest-result b", (n) => n.map((x) => x.textContent))).join() === "VOO,VOOG");
    await page.click(".invest-result >> text=VOO");
    await page.fill("#watchTarget", "$550");
    await page.fill("#watchNote", "Buy more under the target");
    await page.click("#watchSaveBtn");
    await page.waitForSelector(".invest-chart svg .invest-line", { timeout: 8000 });
    check("the key goes as a Token header" + at, asked.some((a) => /\/tiingo-prices\/VOO\?startDate=1980-01-01 Token tk-123$/.test(a)), asked);
    check("the ticker's head shows its symbol and name" + at, (await page.textContent(".invest-head")).includes("VOOVanguard S&P 500 ETF"));
    check("the target chip says how far off it is" + at, /Target \$550\.00 · [\d.]+% above/.test(await page.textContent(".invest-target")));
    check("the note shows under the price" + at, (await page.textContent(".invest-note-text")) === "Buy more under the target");
    check("the Range row is the only filter row" + at, await page.isVisible("#rangeFilterGroup") && !(await page.isVisible("#yearFilterGroup")) && !(await page.isVisible("#catFilterGroup")));
    check("1Y is picked by default" + at, (await page.textContent("#rangeFilter .on")) === "1Y");
    const words1y = await page.textContent(".invest-price span");
    await page.click("#rangeFilter >> text=5Y");
    await page.waitForTimeout(200);
    check("a range changes the change it shows" + at, /past 5 years/.test(await page.textContent(".invest-price span")) && /past year/.test(words1y));
    await page.click("#rangeFilter >> text=1Y");

    // Pins: two by the button, a label each, then the steps between them.
    for (const [day, label] of [["2026-01-05", "Opened Blink"], ["2026-06-01", "Bought more"]]) {
      await page.click(".invest-pins h3 .btn");
      await page.waitForSelector("#investPinModal:not([hidden])");
      await page.fill("#investPinDate", day);
      await page.fill("#investPinLabel", label);
      await page.click("#investPinForm .btn-primary");
      await page.waitForTimeout(500);
    }
    const pinRows = await page.$$eval(".invest-pin .invest-pin-l b", (n) => n.map((x) => x.textContent));
    check("pins list in date order, then the latest close" + at, pinRows.join("|") === "Opened Blink|Bought more|Latest close", pinRows);
    check("a step between pins says % and $ and how long" + at, /^[+−][\d.]+%[+−]?\$[\d,.]+ over 5 months$/.test((await page.textContent(".invest-gap")).trim()), await page.textContent(".invest-gap"));
    check("the total since pin 1 is shown" + at, /Since pin 1 \(10 months\)/.test(await page.textContent(".invest-total")));
    check("both pins are flags on the 1Y chart" + at, (await page.$$(".invest-flag")).length === 2);

    const box = await page.$(".invest-chart svg");
    const bb = await box.boundingBox();
    // On a phone a sideways drag across the chart scrubs it rather than
    // swiping to the next Ledger mode.
    if (width < 720) {
      const y0 = bb.y + bb.height * 0.5;
      await page.mouse.move(bb.x + bb.width * 0.8, y0);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(bb.x + bb.width * (0.8 - i * 0.05), y0 + i * 0.3); await page.waitForTimeout(16); }
      const mid = await page.evaluate(() => ({ tip: !document.querySelector(".invest-tip").hidden, layer: !!document.querySelector(".mode-layer") }));
      await page.mouse.up();
      await page.waitForTimeout(600);
      const ui = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-ui-v1") || "{}").financeMode);
      check("a drag across the chart scrubs the days" + at, mid.tip && !mid.layer, mid);
      check("and stays on Investments" + at, ui === "invest" && await page.isVisible(".invest-chart"), ui);
      await page.mouse.click(bb.x + 4, bb.y - 30);
      await page.waitForTimeout(200);
    }
    // A tap on the chart holds the day, with a button to pin it.
    await page.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5);
    check("a click on the chart offers Pin this day" + at, await page.isVisible(".invest-pin-btn"));
    await page.click(".invest-pin-btn");
    await page.waitForSelector("#investPinModal:not([hidden])");
    const picked = await page.inputValue("#investPinDate");
    check("the pin sheet opens on the clicked day" + at, /^2026-0[4-6]-\d\d$/.test(picked), picked);
    await page.click("#cancelInvestPinBtn");
    await page.waitForTimeout(500);

    // A second ticker typed without the search, its name looked up.
    await page.click(".invest-list h2 .btn");
    await page.fill("#watchSymbol", "qqq");
    await page.click("#watchSaveBtn");
    await page.waitForTimeout(900);
    const listed = await page.$$eval(".invest-row-t b", (n) => n.map((x) => x.firstChild.textContent));
    check("the list shows both tickers" + at, listed.join() === "VOO,QQQ", listed);
    check("a typed ticker is looked up for its name" + at, (await page.textContent(".invest-head")).includes("QQQInvesco QQQ Trust"));
    check("the VOO row carries its target" + at, (await page.textContent(".invest-row >> nth=0")).includes("Target $550.00"));

    if (process.env.SHOTS) {
      await page.click(".invest-row >> nth=0");
      await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: process.env.SHOTS + "/invest-" + width + ".png" });
      if (width < 720) {
        await page.evaluate(() => document.querySelector(".invest-pins").scrollIntoView());
        await page.evaluate(() => window.scrollBy(0, -260));
        await page.screenshot({ path: process.env.SHOTS + "/invest-pins-" + width + ".png" });
      }
    }

    // A reload keeps the watchlist, its pins, and asks only for new days.
    await page.waitForTimeout(1200);
    asked.length = 0;
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".invest-row", { timeout: 8000 });
    await page.waitForTimeout(600);
    check("a reload keeps both tickers" + at, (await page.$$(".invest-row")).length === 2);
    await page.click(".invest-row >> nth=0");
    await page.waitForTimeout(200);
    check("a reload keeps the pins" + at, (await page.$$(".invest-pin")).length === 3);
    check("fresh prices aren't asked for again" + at, !asked.some((a) => a.includes("/tiingo-prices/")), asked);

    // Removing a ticker, then Undo.
    await page.click(".invest-edit");
    await page.waitForSelector("#watchModal:not([hidden])");
    check("the edit sheet has the target filled" + at, (await page.inputValue("#watchTarget")) === "550");
    await page.click("#deleteWatchBtn");
    await page.waitForTimeout(500);
    check("removing takes the ticker off" + at, (await page.$$(".invest-row")).length === 1);
    await page.click(".toast >> text=Undo");
    await page.waitForTimeout(200);
    check("Undo puts it back with its pins" + at, (await page.$$(".invest-row")).length === 2 && (await page.$$(".invest-pin")).length === 3);

    await page.close();
  }

  // Without a key, a ticker still adds and the setup card says what to do.
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  let calls = 0;
  await page.route("https://proxy.test/**", (r) => { calls++; r.fulfill({ status: 500, body: "{}" }); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((s) => {
    localStorage.clear();
    indexedDB.deleteDatabase("lifelog");
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "invest" }));
  }, seed(""));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("without a key the empty state says where prices come from", /Tiingo/.test(await page.textContent(".empty-state")));
  await page.click(".empty-state .btn-primary");
  await page.fill("#watchSymbol", "voo");
  await page.click("#watchSaveBtn");
  await page.waitForTimeout(400);
  check("a ticker adds without a key", (await page.textContent(".invest-head")).startsWith("VOO"));
  check("the setup card asks for a key", await page.isVisible(".invest-setup >> text=Add a Tiingo key to see prices"));
  check("nothing is asked of Tiingo without a key", calls === 0, calls);

  await b.close();
  done(errs);
})();
