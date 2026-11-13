// Hardcover as a books source: a search lists each match's series and
// place in it, a pick fills the author, pages and rating, and Discover's
// Popular is Hardcover's trending books (no Coming soon card, as NYT has
// none). The proxy and Hardcover's GraphQL are answered here.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const PROXY = "https://proxy.lifelog.test";
const SEED = {
  categories: [{ id: "books", name: "Books", color: "#5b8cff" }],
  backlog: [], entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [],
  settings: {
    mediaCategorySources: { Books: "hardcover" },
    mediaKeys: { hardcover: "hctok" },
    steam: { proxyUrl: PROXY },
  },
};
const HIT = {
  slug: "mistborn-the-final-empire", title: "Mistborn: The Final Empire", author_names: ["Brandon Sanderson"],
  release_year: 2006, pages: 541, rating: 4.4, ratings_count: 2000, description: "Ash falls.",
  featured_series: { position: 1, series: { name: "Mistborn" } },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const width of [375, 1280]) {
    const at = " @" + width;
    const page = await b.newPage({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    const asked = [];
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route(/proxy\.lifelog\.test/, (route) => {
      const url = route.request().url();
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
      }
      const body = JSON.parse(decodeURIComponent((/[?&]q=([^&]*)/.exec(url) || [])[1] || "{}"));
      asked.push({ auth: route.request().headers().authorization, query: body.query || "" });
      const json = (data) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ data }) });
      if (/search\(/.test(body.query)) return json({ search: { results: { hits: [{ document: HIT }] } } });
      if (/books_trending/.test(body.query)) return json({ books_trending: { ids: [7, 8] } });
      if (/books\(where: \{id/.test(body.query)) return json({ books: [{ id: 8, slug: "b", title: "Onyx Storm" }, { id: 7, slug: "a", title: "Sunrise on the Reaping" }] });
      if (/me \{/.test(body.query)) return json({ me: [{ username: "d" }] });
      return json({});
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const boot = async (mode) => {
      await forgetCopy(page);
      await page.evaluate(([s, m]) => {
        localStorage.clear();
        localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: m }));
        localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      }, [SEED, mode]);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(900);
    };

    await boot("entries");
    await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(null));
    await page.evaluate(() => {
      const s = document.querySelector("#bCategory"); s.value = "Books"; s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.fill("#bTitle", "Mistborn");
    await page.evaluate(() => document.querySelector("#bSyncBtn").click());
    await page.waitForSelector("#bTitleSuggest .ac-item", { timeout: 5000 });
    const meta = await page.evaluate(() => document.querySelector("#bTitleSuggest .ac-meta").textContent);
    check("a match says its author and its place in the series" + at, /Brandon Sanderson · Mistborn #1 · 2006/.test(meta), meta);
    await page.evaluate(() => document.querySelector("#bTitleSuggest .ac-item").click());
    await page.waitForFunction(() => document.querySelector("#bMediaSource").value === "hardcover", null, { timeout: 5000 }).catch(() => {});
    const form = await page.evaluate(() => ({
      id: document.querySelector("#bMediaId").value,
      author: (document.querySelector("#bAuthor") || {}).value,
      length: document.querySelector("#bLength").value,
      rating: document.querySelector("#bExternalRating").value,
      summary: document.querySelector("#bSummary").value,
    }));
    check("the pick fills the author, pages, rating and blurb, keyed by slug" + at,
      form.id === "mistborn-the-final-empire" && form.author === "Brandon Sanderson" && form.length === "541 pages" && form.rating === "4.4 Hardcover" && form.summary === "Ash falls.", form);
    check("the token goes behind Bearer" + at, asked.some((a) => a.auth === "Bearer hctok"), asked);
    await page.keyboard.press("Escape");

    await boot("discover");
    await page.waitForTimeout(600);
    const popular = await page.evaluate(() => [...document.querySelectorAll("#viewBody .dsc-row .bl-title")].map((e) => e.textContent));
    check("Popular is Hardcover's trending, in its order" + at, popular.join() === "Sunrise on the Reaping,Onyx Storm", popular);
    const upcoming = await page.evaluate(() => {
      const btn = [...document.querySelectorAll(".backlog-mode-bar .seg-btn")].find((x) => x.textContent === "Coming soon");
      btn.click();
      return new Promise((r) => setTimeout(() => r(document.querySelectorAll("#viewBody .dsc-row").length), 500));
    });
    check("and there's no Coming soon card for it" + at, upcoming === 0, upcoming);
    await page.close();
  }
  await b.close();
  done(errs);
})();
