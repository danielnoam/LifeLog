// AniList and airing shows (0.265.0): one sync brings in Planning, starts
// Watching, and moves what you completed there off the backlog (Undo puts
// it back); a show's row says how far it has run, a mid-run one sorts into a
// "Still airing" band that folds, and the re-check finishes a show that ended.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ name: "Anime", color: "#58a6ff" }, { name: "TV", color: "#f0883e" }, { name: "Games", color: "#3fb950" }],
  entries: [],
  backlog: [
    { id: "b1", title: "Frieren", category: "Anime", mediaSource: "anilist-anime", mediaId: "5", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b2", title: "Dandadan", category: "Anime", mediaSource: "anilist-anime", mediaId: "9", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "b3", title: "Severance", category: "TV", mediaSource: "tmdb-tv", mediaId: "77", releaseStatus: "released", releaseDate: "2022-02-18", releasePrecision: "day",
      airing: "airing", airingSeason: 2, episodesOut: 7, episodesTotal: 10, createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "b4", title: "Hades", category: "Games", createdAt: "2026-01-04T00:00:00.000Z" },
  ],
  notes: [], accomplishments: {}, habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: { anilist: { userName: "me", animeCategory: "Anime", mangaCategory: "", autoSyncDays: "0" }, mediaKeys: { tmdb: "k" } },
};

const media = (id, title, extra) => ({ id, type: "ANIME", title: { romaji: title }, coverImage: { medium: "" }, startDate: { year: 2025, month: 1, day: 5 },
  status: "FINISHED", episodes: 12, averageScore: 80, genres: [], ...extra });

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const asked = [];
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.route("https://graphql.anilist.co/**", (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    asked.push(body.variables || {});
    const json = (data) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ data }) });
    if (/MediaListCollection/.test(body.query)) {
      return json({ MediaListCollection: { lists: [
        { isCustomList: false, entries: [{ status: "PLANNING", score: 0, startedAt: {}, completedAt: {}, media: media(11, "Planned Show") }] },
        { isCustomList: false, entries: [
          { status: "CURRENT", score: 0, startedAt: { year: 2026, month: 9, day: 2 }, completedAt: {}, media: media(9, "Dandadan", { status: "RELEASING", nextAiringEpisode: { airingAt: 1924992000, episode: 6 } }) },
          { status: "CURRENT", score: 0, startedAt: {}, completedAt: {}, media: media(12, "New Watching") },
        ] },
        { isCustomList: true, entries: [{ status: "PLANNING", score: 0, startedAt: {}, completedAt: {}, media: media(11, "Planned Show") }] },
      ] } });
    }
    if (/mediaList\(/.test(body.query)) {
      return json({ Page: { pageInfo: { hasNextPage: false }, mediaList: [
        { status: "COMPLETED", score: 4, startedAt: { year: 2026, month: 1, day: 20 }, completedAt: { year: 2026, month: 3, day: 14 }, media: media(5, "Frieren") },
      ] } });
    }
    return json({});
  });
  await page.route("https://api.themoviedb.org/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ status: "Ended", first_air_date: "2022-02-18", number_of_seasons: 2, number_of_episodes: 19,
      last_episode_to_air: { season_number: 2, episode_number: 10 }, next_episode_to_air: null, seasons: [] }) }));

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)); }, SEED);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(400);
  const data = () => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));
  const rowText = (title) => page.evaluate((t) => {
    const row = [...document.querySelectorAll(".backlog-item, .backlog-item-rich")].find((r) => r.querySelector(".bl-title")?.textContent === t);
    return row ? row.textContent : null;
  }, title);

  // How far a show has run, on its row.
  const sev = await rowText("Severance");
  check("a mid-season show says so on its row", /S2 airing · 7 of 10/.test(sev || ""), sev);
  const bar = await page.evaluate(() => [...document.querySelectorAll(".backlog-section")].map((sec) => sec.textContent).find((t) => /Severance/.test(t)) || "");
  check("it sits in a band named for it, after what's ready", /Still airing/.test(bar) && !/Early Access/.test(bar), bar.slice(0, 200));
  await page.evaluate(() => { const v = JSON.parse(localStorage.getItem("lifelog-visual-settings-v1") || "{}"); v.backlogFoldEa = "collapsed"; localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v)); });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(400);
  check("folded, the band takes it out of sight", (await rowText("Severance")) === null && (await rowText("Hades")) !== null);
  await page.evaluate(() => { const v = JSON.parse(localStorage.getItem("lifelog-visual-settings-v1") || "{}"); v.backlogFoldEa = "open"; localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v)); });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(400);

  // The AniList sync.
  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  await page.click('.srow[data-page="imports"]'); await page.waitForTimeout(300);
  await page.click("#anilistSyncBtn");
  await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 8000 }); await page.waitForTimeout(300);
  check("Completed is asked only about the backlog's AniList titles", asked.some((v) => Array.isArray(v.ids) && v.ids.sort().join() === "5,9"), asked);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#financePickerModal .picker-row")].map((r) => ({
    text: r.textContent, checked: r.querySelector("input[type=checkbox]")?.checked })));
  const row = (re) => rows.find((r) => re.test(r.text));
  check("Planning comes in as a backlog row", row(/Planned Show/) && /backlog/.test(row(/Planned Show/).text) && row(/Planned Show/).checked, rows);
  check("a custom list doesn't repeat it", rows.filter((r) => /Planned Show/.test(r.text)).length === 1, rows.map((r) => r.text));
  check("a new Watching title comes in progress", row(/New Watching/) && /in progress/.test(row(/New Watching/).text), rows);
  check("one you have is started, as an update", row(/Dandadan/) && /started/.test(row(/Dandadan/).text) && row(/Dandadan/).checked, rows);
  check("a Completed one is done and leaves the backlog", row(/Frieren/) && /leaves backlog/.test(row(/Frieren/).text) && row(/Frieren/).checked, rows);
  await page.click("#financePickerConfirmBtn"); await page.waitForTimeout(800);
  let d = await data();
  const frierenEntry = d.entries.find((e) => e.title === "Frieren");
  check("Frieren moved to the timeline in March with your score", frierenEntry && frierenEntry.year === 2026 && frierenEntry.month === 3 && frierenEntry.rating === 4
    && frierenEntry.startMonth === 1 && frierenEntry.backlogAddedAt === "2026-01-01T00:00:00.000Z", frierenEntry);
  check("and is off the backlog", !d.backlog.some((x) => x.id === "b1"), d.backlog.map((x) => x.title));
  check("Dandadan is started on the day AniList says", (d.backlog.find((x) => x.id === "b2") || {}).startedAt === "2026-09-02", d.backlog.find((x) => x.id === "b2"));
  const nw = d.backlog.find((x) => x.title === "New Watching");
  check("New Watching is in progress", nw && /^\d{4}-\d{2}-\d{2}$/.test(nw.startedAt || ""), nw);
  check("Planned Show is in the backlog, not started", (d.backlog.find((x) => x.title === "Planned Show") || {}).startedAt === undefined && d.backlog.some((x) => x.title === "Planned Show"));
  const toast = await page.textContent("#toast");
  check("the toast says what moved", /moved off your backlog/.test(toast), toast);

  await page.click("#toast .toast-action"); await page.waitForTimeout(700);
  d = await data();
  check("Undo puts Frieren back on the backlog and takes the entry away", d.backlog.some((x) => x.id === "b1" && x.title === "Frieren") && !d.entries.some((e) => e.title === "Frieren"), { b: d.backlog.map((x) => x.title), e: d.entries.map((e) => e.title) });
  check("and un-starts Dandadan", (d.backlog.find((x) => x.id === "b2") || {}).startedAt === undefined);

  // The re-check finishes a show that ended.
  await page.evaluate(() => { const back = document.querySelector("#settingsBack, .settings-back"); if (back) back.click(); });
  await page.waitForTimeout(300);
  await page.click('.srow[data-page="releases"]'); await page.waitForTimeout(300);
  const label = await page.textContent("#refreshReleasesBtn");
  check("the re-check counts the airing show", /\(\d+\)/.test(label), label);
  await page.click("#refreshReleasesBtn"); await page.waitForTimeout(1500);
  d = await data();
  const sv = d.backlog.find((x) => x.id === "b3");
  check("an ended show is Complete, with its whole run counted", sv.airing === "finished" && sv.episodesOut === 19 && sv.airingSeason === undefined, sv);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  check("and its row says so", /Complete/.test((await rowText("Severance")) || ""), await rowText("Severance"));

  await ctx.close();
  await b.close();
  done(errs);
})();
