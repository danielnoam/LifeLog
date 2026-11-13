// Discover's per-card switch (Daniel, 2026-11-13): a category with more than
// one list to show (games: RAWG or IGDB; books: NYT bestsellers or
// Hardcover's trending) gets a switch in its card's head, remembered per
// device; one list keeps the plain source name. Every service is answered here.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const PROXY = "https://proxy.lifelog.test";
const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }, { id: "books", name: "Books", color: "#e0a030" }, { id: "films", name: "Films", color: "#40b080" }],
  backlog: [], entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [],
  settings: {
    mediaCategorySources: { Games: "rawg-steam-gg", Books: "openlibrary", Films: "tmdb-movie" },
    mediaKeys: { rawg: "rk", igdb: "clientid123", igdbSecret: "secret12345", nyt: "nk", hardcover: "hk", tmdb: "tk" },
    steam: { proxyUrl: PROXY },
  },
};
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) });

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const width of [375, 1280]) {
    const at = " @" + width;
    const page = await b.newPage({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: process.env.SHOTS ? 2 : 1 });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route(/api\.rawg\.io|proxy\.lifelog\.test|api\.nytimes\.com|themoviedb\.org/, (route) => {
      const url = route.request().url();
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (url.includes("api.rawg.io")) return json(route, { results: [{ slug: "hades-ii", name: "Hades II", released: "2025-09-25" }] });
      if (url.includes("/igdb-token")) return json(route, { access_token: "tok", expires_in: 5000000 });
      if (url.includes("/igdb/games")) return json(route, [{ id: 6, name: "Balatro", release_dates: [{ human: "Feb 20, 2024" }] }]);
      if (url.includes("/hardcover")) {
        const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(url) || [])[1] || "");
        if (/books_trending/.test(q)) return json(route, { data: { books_trending: { ids: [7] } } });
        return json(route, { data: { books: [{ id: 7, slug: "a", title: "Sunrise on the Reaping" }] } });
      }
      if (url.includes("api.nytimes.com")) return json(route, { results: { lists: [{ list_name_encoded: "combined-print-and-e-book-fiction", books: [{ title: "JAMES", author: "Percival Everett", primary_isbn13: "1" }] }] } });
      if (url.includes("themoviedb.org")) return json(route, { results: [{ id: 1, title: "Sinners", release_date: "2025-04-18" }] });
      return route.fulfill({ status: 404, headers: cors, body: "{}" });
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "discover" }));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
    }, SEED);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    const cards = () => page.evaluate(() => [...document.querySelectorAll("#viewBody .backlog-section")].map((c) => ({
      name: (c.querySelector(".backlog-section-name") || {}).textContent,
      choices: [...c.querySelectorAll(".dsc-switch .seg-btn")].map((x) => x.textContent + (x.classList.contains("active") ? "*" : "")),
      label: (c.querySelector(".dsc-source") || {}).textContent || "",
      rows: [...c.querySelectorAll(".dsc-row .bl-title, .dsc-tile .bl-title")].map((x) => x.textContent),
    })));
    let all = await cards();
    const games = () => all.find((c) => c.name === "Games") || {};
    const books = () => all.find((c) => c.name === "Books") || {};
    const films = () => all.find((c) => c.name === "Films") || {};
    check("Games offers RAWG or IGDB, its own source first" + at, games().choices.join() === "RAWG*,IGDB" && games().rows.join() === "Hades II", games());
    check("Books offers NYT bestsellers or Hardcover" + at, books().choices.join() === "NYT bestsellers*,Hardcover" && books().rows.join() === "James", books());
    check("a category with one list keeps the plain source name" + at, !films().choices.length && films().label === "TMDB", films());
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/discover-switch-" + width + ".png", fullPage: true });

    await page.locator("#viewBody .backlog-section", { hasText: "Games" }).locator(".dsc-switch .seg-btn", { hasText: "IGDB" }).click();
    await page.locator("#viewBody .backlog-section", { hasText: "Books" }).locator(".dsc-switch .seg-btn", { hasText: "Hardcover" }).click();
    await page.waitForTimeout(1000);
    all = await cards();
    check("switching shows that list in place" + at, games().choices.join() === "RAWG,IGDB*" && games().rows.join() === "Balatro"
      && books().choices.join() === "NYT bestsellers,Hardcover*" && books().rows.join() === "Sunrise on the Reaping", all);
    check("the cards keep their order" + at, all.map((c) => c.name).join() === "Games,Books,Films", all.map((c) => c.name));

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    all = await cards();
    check("the pick is remembered on this device" + at, games().choices.join() === "RAWG,IGDB*" && books().choices.join() === "NYT bestsellers,Hardcover*", all);
    const tap = await page.evaluate(() => {
      const r = document.querySelector(".dsc-switch .seg-btn").getBoundingClientRect();
      const a = getComputedStyle(document.querySelector(".dsc-switch .seg-btn"), "::after");
      return r.height + parseFloat(a.top) * -1 + parseFloat(a.bottom) * -1;
    });
    check("each switch button's tap area is at least 44px tall" + at, tap >= 44, tap);

    const upcoming = await page.evaluate(() => {
      [...document.querySelectorAll(".backlog-mode-bar .seg-btn")].find((x) => x.textContent === "Coming soon").click();
      return new Promise((r) => setTimeout(() => r([...document.querySelectorAll("#viewBody .backlog-section .backlog-section-name")].map((e) => e.textContent)), 900));
    });
    check("Coming soon has no books card, and still the games one" + at, upcoming.includes("Games") && !upcoming.includes("Books"), upcoming);
    await page.close();
  }
  await b.close();
  done(errs);
})();
