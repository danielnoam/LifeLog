// How far a show has run, where it was missing (0.280.0): TMDB TV rows in
// Discover (the trending list doesn't say, so each show's page is asked
// once a day) and the Timeline's In progress card.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const pad = (n) => String(n).padStart(2, "0");
const day = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

const SEED = {
  categories: [{ id: "s", name: "Shows", color: "#58a6ff" }, { id: "a", name: "Anime", color: "#f778ba" }],
  entries: [], accomplishments: {}, notes: [], habits: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [],
  settings: { mediaCategorySources: { Shows: "tmdb-tv" }, mediaKeys: { tmdb: "t" } },
  backlog: [
    { id: "p1", title: "Severance", category: "Shows", mediaSource: "tmdb-tv", mediaId: "95396", airing: "airing", airingSeason: 2, episodesOut: 5, episodesTotal: 10, startedAt: day(new Date()), createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "p2", title: "Frieren", category: "Anime", mediaSource: "anilist-anime", mediaId: "154587", airing: "finished", episodesOut: 28, episodesTotal: 28, startedAt: day(new Date()), createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "p3", title: "A film", category: "Shows", startedAt: day(new Date()), createdAt: "2026-01-03T00:00:00.000Z" },
  ],
};

const SHOWS = {
  1: { status: "Returning Series", last_episode_to_air: { season_number: 3, episode_number: 4 }, next_episode_to_air: { season_number: 3, episode_number: 5, air_date: "2026-11-01" }, seasons: [{ season_number: 3, episode_count: 8 }] },
  2: { status: "Ended", number_of_episodes: 62 },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const width of [390, 1280]) {
    const at = " (" + width + "px)";
    const page = await b.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    const asked = [];
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route("https://api.themoviedb.org/**", (r) => {
      const u = r.request().url();
      const json = (body) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
      if (/\/trending\/tv\//.test(u)) return json({ results: [
        { id: 1, name: "Show One", first_air_date: "2024-01-01", overview: "x" },
        { id: 2, name: "Show Two", first_air_date: "2010-01-01", overview: "y" },
      ] });
      const m = /\/tv\/(\d+)\?/.exec(u);
      if (m) { asked.push(m[1]); return json(SHOWS[m[1]] || {}); }
      return json({ results: [] });
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "entries" }));
    }, SEED);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // ---- In progress ----
    const since = (id) => page.evaluate((i) => (document.querySelector('.progress-row[data-id="' + i + '"] .progress-since') || {}).textContent || "", id);
    check("an airing show in progress says how far it's run" + at, /since .* · todayS2 airing · 5 of 10$/.test(await since("p1")), await since("p1"));
    const lines = await page.evaluate(() => {
      const s = document.querySelector('.progress-row[data-id="p1"] .progress-since'), a = s.querySelector(".progress-airing");
      return { block: getComputedStyle(a).display === "block", before: getComputedStyle(a, "::before").content };
    });
    check(width < 720 ? "on a phone, on its own line under the days" + at : "on a computer, after the days with a dot" + at,
      width < 720 ? lines.block && (lines.before === "none" || lines.before === "normal") : !lines.block && /·/.test(lines.before), lines);
    check("a finished one says Complete, in the done colour" + at, /Complete$/.test(await since("p2"))
      && await page.evaluate(() => !!document.querySelector('.progress-row[data-id="p2"] .progress-airing.is-done')), await since("p2"));
    check("something that isn't a show says only how long" + at, /^since .* · today$/.test(await since("p3")), await since("p3"));

    await page.screenshot({ path: require("path").join(require("os").tmpdir(), "showstate-ip-" + width + ".png") });

    // ---- Discover ----
    await page.evaluate(() => localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "discover" })));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const rowText = (title) => page.evaluate((t) => {
      const row = [...document.querySelectorAll(".dsc-row")].find((r) => r.querySelector(".bl-title").textContent === t);
      return row ? ((row.querySelector(".bl-airing") || {}).textContent || "") : "missing";
    }, title);
    check("a trending TMDB show in Discover says it's airing, with the season count" + at, /S3 airing · 4 of 8/.test(await rowText("Show One")), await rowText("Show One"));
    check("and an ended one says Complete" + at, /Complete/.test(await rowText("Show Two")), await rowText("Show Two"));
    check("each show's page was asked once" + at, asked.sort().join(",") === "1,2", asked);
    asked.length = 0;
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    check("a reload the same day answers from the day's cache, asking nothing" + at, asked.length === 0 && /S3 airing/.test(await rowText("Show One")), { asked, t: await rowText("Show One") });
    await page.screenshot({ path: require("path").join(require("os").tmpdir(), "showstate-dsc-" + width + ".png") });
    await page.close();
  }
  await b.close();
  done(errs);
})();
