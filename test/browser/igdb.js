// IGDB as a games source: a pick from "IGDB + Steam + GG.deals" lands on its
// Steam App ID with IGDB's play time, rating and early access, and a
// SteamGridDB games category with no RAWG key gets IGDB's Discover lists.
// The proxy, Twitch and IGDB are all answered here.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const PROXY = "https://proxy.lifelog.test";
const seed = (source) => ({
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }],
  backlog: [], entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [],
  settings: {
    mediaCategorySources: { Games: source },
    mediaKeys: { igdb: "clientid123", igdbSecret: "secret12345" },
    steam: { proxyUrl: PROXY },
  },
});
const GAME = {
  id: 1942, name: "Hades II", cover: { image_id: "co8abc" },
  release_dates: [{ human: "May 06, 2024" }], aggregated_rating: 91, aggregated_rating_count: 10,
  genres: [{ name: "Roguelike" }], game_status: { status: "Early Access" },
  external_games: [{ uid: "1145350", external_game_source: 1 }],
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const asked = [];
  const json = (route, body) => route.fulfill({
    status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body),
  });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.route(/proxy\.lifelog\.test|images\.igdb\.com|akamai/, (route) => {
    const url = route.request().url();
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    }
    if (!url.includes(PROXY)) return route.fulfill({ status: 204, body: "" });
    const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(url) || [])[1] || "");
    asked.push({ path: new URL(url).pathname, q });
    if (url.includes("/igdb-token")) return json(route, { access_token: "tok", expires_in: 5000000 });
    if (url.includes("/igdb/game_time_to_beats")) return json(route, [{ normally: 108000 }]);
    if (url.includes("/igdb/games")) {
      if (/sort hypes desc/.test(q)) return json(route, [{ id: 5, name: "Hollow Knight: Silksong", release_dates: [{ human: "Q4 2027" }] }]);
      if (/sort rating_count desc/.test(q)) return json(route, [{ id: 6, name: "Balatro", release_dates: [{ human: "Feb 20, 2024" }] }]);
      return json(route, [{ ...GAME, summary: "IGDB's blurb." }]);
    }
    if (url.includes("/steam-appdetails/1145350")) {
      return json(route, { 1145350: { success: true, data: { name: "Hades II", short_description: "Steam's blurb.", release_date: { coming_soon: false, date: "6 May, 2024" }, genres: [{ id: "70" }] } } });
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const boot = async (source, mode) => {
    await forgetCopy(page);
    await page.evaluate(([s, m]) => {
      localStorage.clear();
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: m }));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
    }, [seed(source), mode]);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
  };

  // ---- a pick ----
  await boot("igdb-steam-gg", "entries");
  await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(null));
  await page.evaluate(() => {
    const s = document.querySelector("#bCategory"); s.value = "Games"; s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.fill("#bTitle", "Hades II");
  await page.evaluate(() => document.querySelector("#bSyncBtn").click());
  await page.waitForSelector("#bTitleSuggest .ac-item", { timeout: 5000 });
  const listed = await page.evaluate(() => document.querySelector("#bTitleSuggest").textContent);
  check("the search lists IGDB's match", /Hades II/.test(listed), listed);
  await page.evaluate(() => document.querySelector("#bTitleSuggest .ac-item").click());
  await page.waitForFunction(() => document.querySelector("#bMediaSource").value === "steam", null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector("#bSyncBtn").classList.contains("busy"), null, { timeout: 8000 }).catch(() => {});
  const form = await page.evaluate(() => ({
    source: document.querySelector("#bMediaSource").value,
    id: document.querySelector("#bMediaId").value,
    length: document.querySelector("#bLength").value,
    rating: document.querySelector("#bExternalRating").value,
    summary: document.querySelector("#bSummary").value,
    genres: document.querySelector("#bGenres").value,
  }));
  check("it lands on the Steam App ID IGDB knows", form.source === "steam" && form.id === "1145350", form);
  check("with IGDB's play time, rating and genres, and Steam's blurb", form.length === "30 hrs" && form.rating === "91 IGDB" && form.genres === "Roguelike" && form.summary === "Steam's blurb.", form);
  check("signed in to Twitch once", asked.filter((a) => a.path === "/igdb-token").length === 1, asked);
  await page.keyboard.press("Escape");

  // ---- Discover, standing in for SteamGridDB with no RAWG key ----
  await boot("steamgriddb-steam-gg", "discover");
  await page.waitForTimeout(600);
  const popular = await page.evaluate(() => [...document.querySelectorAll("#viewBody .dsc-row .bl-title")].map((e) => e.textContent));
  check("a SteamGridDB category's Popular comes from IGDB without a RAWG key", popular.join() === "Balatro", popular);
  const upcoming = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".backlog-mode-bar .seg-btn")].find((x) => x.textContent === "Coming soon");
    btn.click();
    return new Promise((r) => setTimeout(() => r([...document.querySelectorAll("#viewBody .dsc-row .bl-title")].map((e) => e.textContent)), 800));
  });
  check("and Coming soon too", upcoming.join() === "Hollow Knight: Silksong", upcoming);
  check("no page errors", !errs.length, errs);

  await b.close();
  done(errs);
})();
