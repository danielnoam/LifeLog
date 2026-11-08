// A SteamGridDB + Steam + GG.deals pick used to ask SGDB, then Steam, then
// RAWG, one after the other, so the item took the sum of all three to fill
// in. The identity (SGDB → Steam) and the RAWG cross-fill now go out
// together, and RAWG's blurb is still skipped when Steam's is on its way.
// Every request is served here with a fixed delay, so the timing is ours.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const PROXY = "https://proxy.lifelog.test";
const DELAY = 500;
const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }],
  backlog: [], entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [],
  settings: {
    mediaCategorySources: { Games: "steamgriddb-steam-gg" },
    mediaKeys: { rawg: "rk", steamgriddb: "sk" },
    steam: { proxyUrl: PROXY },
  },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const asked = [];
  const json = (route, body, wait) => setTimeout(() => route.fulfill({
    status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body),
  }).catch(() => {}), wait || 0);
  await page.route(/proxy\.lifelog\.test|api\.rawg\.io|x\.test/, (route) => {
    const url = route.request().url();
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    }
    asked.push(url.replace(/[?&]key=rk/, ""));
    if (url.includes("/steamgriddb/search/autocomplete/")) return json(route, { success: true, data: [{ id: 7, name: "Hades II" }] });
    if (url.includes("/steamgriddb/grids/game/7")) return json(route, { success: true, data: [{ thumb: "https://x.test/c.png" }] });
    if (url.includes("/steamgriddb/games/id/7")) return json(route, { success: true, data: { external_platform_data: { steam: [{ id: "1145350" }] } } }, DELAY);
    if (url.includes("/steam-appdetails/1145350")) {
      return json(route, { 1145350: { success: true, data: { name: "Hades II", short_description: "Steam's blurb.", release_date: { coming_soon: false, date: "25 Sep, 2025" } } } }, DELAY);
    }
    if (url.includes("api.rawg.io/api/games?search=")) {
      return json(route, { results: [{ slug: "hades-ii", name: "Hades II", metacritic: 91, playtime: 30, genres: [{ name: "Roguelike" }] }] }, DELAY);
    }
    if (url.includes("api.rawg.io/api/games/hades-ii")) return json(route, { description_raw: "RAWG's blurb." }, DELAY);
    return route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(null));
  await page.selectOption("#bCategory", "Games").catch(() => page.evaluate(() => {
    const s = document.querySelector("#bCategory"); s.value = "Games"; s.dispatchEvent(new Event("change", { bubbles: true }));
  }));
  await page.fill("#bTitle", "Hades II");
  await page.evaluate(() => document.querySelector("#bSyncBtn").click());
  await page.waitForSelector("#bTitleSuggest .ac-item", { timeout: 5000 });
  asked.length = 0;
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector("#bTitleSuggest .ac-item").click());
  check("the list goes and the button spins while the pick loads",
    await page.evaluate(() => document.querySelector("#bTitleSuggest").hidden && document.querySelector("#bSyncBtn").classList.contains("busy")));
  await page.waitForFunction(() => document.querySelector("#bMediaSource").value === "steam", null, { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector("#bSyncBtn").classList.contains("busy"), null, { timeout: 8000 });
  const took = Date.now() - t0;

  // SGDB → Steam is two requests in a row (2 × DELAY); RAWG's search runs
  // beside them rather than after, which used to make it three.
  check("the pick fills in about as fast as its slowest chain, not the sum", took < DELAY * 2 + 400, { took });
  const form = await page.evaluate(() => ({
    id: document.querySelector("#bMediaId").value,
    length: document.querySelector("#bLength").value,
    rating: document.querySelector("#bExternalRating").value,
    summary: document.querySelector("#bSummary").value,
    genres: document.querySelector("#bGenres").value,
  }));
  check("it lands on Steam with RAWG's length, rating and genres", form.id === "1145350" && form.length === "30 hrs" && form.rating === "91 Metacritic" && form.genres === "Roguelike", form);
  check("Steam's blurb wins and RAWG's is never asked for", form.summary === "Steam's blurb." && !asked.some((u) => u.includes("/api/games/hades-ii")), { summary: form.summary, asked });
  check("no page errors", !errs.length, errs);

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
