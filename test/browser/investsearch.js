// The ticker sheet's search as you type: Searching… while it asks, a typed
// ticker completed through the meta route when the proxy has no search route,
// a plain-words problem instead of a silent empty box, a query asked once per
// session, and the no-key line. SHOTS=dir writes the sheet's states.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const seed = (key) => ({
  categories: [], entries: [], backlog: [], notes: [], accomplishments: {}, habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: { steam: { proxyUrl: "https://proxy.test" }, mediaKeys: key ? { tiingo: key } : {} },
});
const SEARCH = {
  vanguard: [{ ticker: "VOO", name: "Vanguard S&P 500 ETF", assetType: "ETF", isActive: true, countryCode: "US" }, { ticker: "VTI", name: "Vanguard Total Stock Market ETF", assetType: "ETF", isActive: true, countryCode: "US" }],
  appl: [{ ticker: "AAPL", name: "Apple Inc", assetType: "Stock", isActive: true }],
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const shots = process.env.SHOTS;
  for (const width of [1280, 390]) {
    const at = " (" + width + "px)";
    const page = await b.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    const asked = [];
    let mode = "ok";
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route("https://proxy.test/**", async (r) => {
      const u = new URL(r.request().url());
      asked.push(u.pathname + u.search);
      const send = (status, body) => r.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
      if (u.pathname === "/tiingo-search") {
        await new Promise((res) => setTimeout(res, 400));
        if (mode === "old-proxy") return send(404, { error: "Not found" });
        if (mode === "bad-key") return send(401, { detail: "Invalid token." });
        return send(200, SEARCH[u.searchParams.get("query").toLowerCase()] || []);
      }
      const m = /^\/tiingo-meta\/(.+)$/.exec(u.pathname);
      if (m) return m[1] === "VOO" ? send(200, { ticker: "VOO", name: "Vanguard S&P 500 ETF" }) : send(404, { detail: "Not found." });
      send(200, []);
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    const boot = async (key) => {
      await page.evaluate((s) => {
        localStorage.clear();
        localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
        localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "invest" }));
      }, seed(key));
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await page.click(".empty-state .btn-primary");
      await page.waitForSelector("#watchModal:not([hidden])");
    };
    const status = () => page.$eval("#watchResults", (n) => (n.hidden ? "" : (n.querySelector(".invest-results-status") || {}).textContent || ""));
    const symbols = () => page.$$eval(".invest-result b", (n) => n.map((x) => x.textContent).join());
    const settle = () => page.waitForTimeout(900);
    const shot = (name) => shots && page.screenshot({ path: `${shots}/${name}-${width < 720 ? "phone" : "desktop"}.png` });

    await boot("tk-1");
    await page.fill("#watchSymbol", "vanguard");
    await page.waitForTimeout(150);
    check("it says Searching… while Tiingo is asked" + at, (await status()) === "Searching…");
    await shot("1-searching");
    await settle();
    check("the matches show by name" + at, (await symbols()) === "VOO,VTI");
    await shot("2-results");
    const before = asked.filter((a) => a.startsWith("/tiingo-search")).length;
    await page.fill("#watchSymbol", "vanguar");
    await settle();
    await page.fill("#watchSymbol", "vanguard");
    await page.waitForTimeout(50);
    check("a query asked before answers at once" + at, (await symbols()) === "VOO,VTI");
    await settle();
    check("…without asking Tiingo again" + at, asked.filter((a) => a === "/tiingo-search?query=vanguard").length === 1 && asked.filter((a) => a.startsWith("/tiingo-search")).length === before + 1, asked);
    await page.fill("#watchSymbol", "zzqx");
    await settle();
    check("no match says so" + at, (await status()) === "No US tickers match “zzqx”");
    await shot("3-no-match");

    mode = "old-proxy";
    await page.fill("#watchSymbol", "voo");
    await settle();
    check("without the proxy's search route, a typed ticker still completes" + at, (await symbols()) === "VOO" && (await page.textContent(".invest-result span")) === "Vanguard S&P 500 ETF");
    await page.fill("#watchSymbol", "apple");
    await settle();
    check("…and a name says the proxy needs redeploying" + at, /redeploy proxy\/worker\.js/.test(await status()));
    await shot("4-old-proxy");

    mode = "bad-key";
    await page.fill("#watchSymbol", "appl");
    await settle();
    check("a turned-down key says so" + at, (await status()) === "Tiingo turned the key down");

    await boot("");
    await page.fill("#watchSymbol", "voo");
    await page.waitForTimeout(100);
    check("without a key it points to Settings" + at, /Add a Tiingo key in Settings/.test(await status()));
    await shot("5-no-key");
    await page.close();
  }
  await b.close();
  done(errs);
})();
