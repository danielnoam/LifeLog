// Price alerts (0.276.0): a Steam game with a price target says so, once,
// when GG.deals' retail price lands at or under it — a toast, the row's
// price line, a hit recorded for the phone's notification — stays quiet
// while that hit stands, forgets it once the price climbs back, and the
// sheet offers the target only for a game with a Steam App ID.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ name: "Games", color: "#3fb950" }],
  entries: [],
  backlog: [
    { id: "b1", title: "Hades II", category: "Games", mediaSource: "steam", mediaId: "1145350", priceAlert: 15, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b2", title: "Balatro", category: "Games", mediaSource: "steam", mediaId: "2379780", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "b3", title: "Hollow Knight", category: "Games", mediaSource: "rawg", mediaId: "hollow-knight", createdAt: "2026-01-03T00:00:00.000Z" },
  ],
  notes: [], accomplishments: {}, habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: { mediaCategorySources: { Games: "rawg-steam-gg" }, mediaKeys: { rawg: "k", ggdeals: "gk" }, steam: { proxyUrl: "https://proxy.test", gameTimes: "off" } },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  let price = 12.49;
  const asked = [];
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.route("https://proxy.test/**", (r) => {
    asked.push(r.request().url());
    const ids = (new URL(r.request().url()).searchParams.get("ids") || "").split(",");
    const data = {};
    for (const id of ids) data[id] = { prices: { currentRetail: String(price), historicalRetail: "9.99" } };
    r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ success: true, data }) });
  });

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)); }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const toasts = () => page.evaluate(() => [...document.querySelectorAll("#noticeStack .toast:not([hidden])")].map((t) => t.textContent));
  const hits = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("lifelog-alerts-v1")).prices || {}; } catch (e) { return {}; } });
  const priceText = (appid) => page.evaluate((id) => (document.querySelector(`.bl-price[data-appid="${id}"]`) || {}).textContent || "", appid);

  // ---- the price lands under the target ----
  let t = await toasts();
  check("a price at or under the target toasts it, with the target", t.some((x) => /Hades II is \$12\.49, under your \$15\.00/.test(x)), t);
  check("the row's price line says so too", /under your \$15\.00/.test(await priceText("1145350")), await priceText("1145350"));
  check("a game with no target says nothing extra", !/under your/.test(await priceText("2379780")), await priceText("2379780"));
  let h = await hits();
  const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
  check("the hit is recorded for the phone, a minute ahead, with the price", h.b1 && h.b1.day === today && /^\d{2}:\d{2}$/.test(h.b1.time) && h.b1.price === 12.49, h);
  const snap = await page.evaluate(() => window.LifeLogAlerts.current(window.LifeLogStorage.cachedCopy(), new Date().toISOString().slice(0, 10)));
  check("and rides in the snapshot's alerts as a price alert that opens the Backlog",
    snap.some((a) => a.id === "price-b1" && a.kind === "price" && a.action === "open-backlog" && a.title === "Hades II is $12.49"), snap);
  const onlyWatched = asked.length === 1 && /ids=1145350%2C2379780|ids=1145350,2379780|ids=2379780,1145350|ids=2379780%2C1145350/.test(asked[0]);
  check("one GG.deals request priced both Steam games", onlyWatched, asked);

  // ---- the hit stands: a later load doesn't repeat it ----
  await page.evaluate(() => document.querySelectorAll("#noticeStack .toast").forEach((x) => { x.hidden = true; }));
  await page.click('#viewTabs .tab[data-view="timeline"]');
  await page.waitForTimeout(300);
  await page.click('#viewTabs .tab[data-view="backlog"]');
  await page.waitForTimeout(800);
  t = await toasts();
  check("a second price load with the hit still standing stays quiet", !t.some((x) => /under your/.test(x)), t);

  // ---- the sheet: the target only for a Steam game ----
  await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(window.LifeLogStorage.cachedCopy().backlog.find((x) => x.id === "b1")));
  await page.waitForTimeout(200);
  let f = await page.evaluate(() => ({ hidden: document.querySelector("#bPriceAlertWrap").hidden, value: document.querySelector("#bPriceAlert").value }));
  check("a Steam game's sheet shows its target", !f.hidden && f.value === "15", f);
  await page.evaluate(() => window.LifeLogBacklog.closeBacklogModal());
  await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(window.LifeLogStorage.cachedCopy().backlog.find((x) => x.id === "b3")));
  await page.waitForTimeout(200);
  f = await page.evaluate(() => ({ hidden: document.querySelector("#bPriceAlertWrap").hidden }));
  check("a game without a Steam App ID has no target field", f.hidden, f);
  await page.evaluate(() => window.LifeLogBacklog.closeBacklogModal());
  await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(window.LifeLogStorage.cachedCopy().backlog.find((x) => x.id === "b2")));
  await page.waitForTimeout(200);
  await page.fill("#bPriceAlert", "5");
  await page.click("#backlogForm button[type=submit]");
  await page.waitForTimeout(600);
  const b2 = await page.evaluate(() => window.LifeLogStorage.cachedCopy().backlog.find((x) => x.id === "b2"));
  check("a target typed in the sheet is kept on the item, as a number", b2.priceAlert === 5, b2);
  t = await toasts();
  check("a price above the new target rings nothing", !t.some((x) => /Balatro is/.test(x)), t);

  // ---- the price climbs back over the target: the hit is forgotten ----
  price = 19.99;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  h = await hits();
  check("a price back above the target clears the hit", !h.b1, h);
  t = await toasts();
  check("and rings nothing", !t.some((x) => /under your/.test(x)), t);

  // ---- and the next dip rings again ----
  price = 14.99;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  t = await toasts();
  h = await hits();
  check("the next dip under the target rings again", t.some((x) => /Hades II is \$14\.99, under your \$15\.00/.test(x)) && h.b1 && h.b1.price === 14.99, { t, h });
  check("Balatro at $14.99 is still above its $5", !h.b2 && !t.some((x) => /Balatro/.test(x)), { t, h });

  await b.close();
  done(errs);
})();
