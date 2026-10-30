// AniList and airing shows (0.265.0): one sync brings in Planning, starts
// Watching, and moves what you completed there off the backlog (Undo puts
// it back); a Completed title you have nowhere comes in as history, and
// Paused or Dropped as dropped (0.268.0); since 0.292.0 it applies all of
// that without a review (only undated history waits for one), takes the
// episode count, and with a token sends a + on the In progress row back to
// AniList. A show's row says how far it has run, a mid-run one sorts into a
// "Still airing" band that folds, and the re-check finishes a show that ended.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ name: "Anime", color: "#58a6ff" }, { name: "TV", color: "#f0883e" }, { name: "Games", color: "#3fb950" }],
  entries: [{ id: "e1", title: "Logged Already", category: "Anime", year: 2025, month: 4, date: "2025-04", mediaSource: "anilist-anime", mediaId: "22", createdAt: "2025-04-01T00:00:00.000Z" }],
  backlog: [
    { id: "b1", title: "Frieren", category: "Anime", mediaSource: "anilist-anime", mediaId: "5", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b2", title: "Dandadan", category: "Anime", mediaSource: "anilist-anime", mediaId: "9", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "b3", title: "Severance", category: "TV", mediaSource: "tmdb-tv", mediaId: "77", releaseStatus: "released", releaseDate: "2022-02-18", releasePrecision: "day",
      airing: "airing", airingSeason: 2, episodesOut: 7, episodesTotal: 10, createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "b4", title: "Hades", category: "Games", createdAt: "2026-01-04T00:00:00.000Z" },
    { id: "b5", title: "Chainsaw Man", category: "Anime", mediaSource: "anilist-anime", mediaId: "30", createdAt: "2026-01-05T00:00:00.000Z" },
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
  const asked = [], saved = [];
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.route("https://graphql.anilist.co/**", (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    asked.push(body.query || "");
    const json = (data) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ data }) });
    if (/MediaListCollection/.test(body.query)) {
      return json({ MediaListCollection: { lists: [
        { isCustomList: false, entries: [{ status: "PLANNING", score: 0, startedAt: {}, completedAt: {}, media: media(11, "Planned Show") }] },
        { isCustomList: false, entries: [
          { status: "CURRENT", score: 0, progress: 4, updatedAt: 1790000000, startedAt: { year: 2026, month: 9, day: 2 }, completedAt: {}, media: media(9, "Dandadan", { status: "RELEASING", nextAiringEpisode: { airingAt: 1924992000, episode: 6 } }) },
          { status: "CURRENT", score: 0, startedAt: {}, completedAt: {}, media: media(12, "New Watching") },
        ] },
        { isCustomList: false, entries: [
          { status: "COMPLETED", score: 4, startedAt: { year: 2026, month: 1, day: 20 }, completedAt: { year: 2026, month: 3, day: 14 }, media: media(5, "Frieren") },
          { status: "COMPLETED", score: 5, startedAt: { year: 2024, month: 11, day: 2 }, completedAt: { year: 2025, month: 2, day: 9 }, media: media(20, "Old Favourite") },
          { status: "COMPLETED", score: 0, startedAt: {}, completedAt: {}, media: media(21, "Undated One") },
          { status: "COMPLETED", score: 3, startedAt: {}, completedAt: { year: 2025, month: 4, day: 2 }, media: media(22, "Logged Already") },
        ] },
        { isCustomList: false, entries: [{ status: "PAUSED", score: 0, startedAt: {}, completedAt: {}, media: media(30, "Chainsaw Man") }] },
        { isCustomList: false, entries: [{ status: "DROPPED", score: 0, startedAt: {}, completedAt: {}, media: media(31, "Gave Up") }] },
        { isCustomList: true, entries: [{ status: "PLANNING", score: 0, startedAt: {}, completedAt: {}, media: media(11, "Planned Show") }] },
      ] } });
    }
    if (/SaveMediaListEntry/.test(body.query)) { saved.push(body.variables); return json({ SaveMediaListEntry: { status: body.variables.status || "CURRENT", progress: body.variables.progress || 0, updatedAt: 1800000000 } }); }
    return json({});
  });
  await page.route("https://api.themoviedb.org/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ status: "Ended", first_air_date: "2022-02-18", number_of_seasons: 2, number_of_episodes: 19,
      last_episode_to_air: { season_number: 2, episode_number: 10 }, next_episode_to_air: null, seasons: [] }) }));

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)); }, SEED);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(400);
  const data = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());
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

  // The AniList sync: everything applied, only undated history to review.
  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  await page.click('.srow[data-page="imports"]'); await page.waitForTimeout(300);
  await page.click("#anilistSyncBtn");
  await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 8000 }); await page.waitForTimeout(300);
  check("one request asks for every status list, with the count and the time", asked.length === 1 && /status_in: \[PLANNING, CURRENT, COMPLETED, PAUSED, DROPPED\]/.test(asked[0]) && /progress updatedAt/.test(asked[0]), asked);
  const toast = await page.evaluate(() => [...document.querySelectorAll("#noticeStack .toast")].map((t) => t.textContent).join(" | "));
  check("the toast says what moved", /AniList: 4 new, 1 started, 1 finished, 1 dropped, 1 episode count/.test(toast), toast);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#financePickerModal .picker-row")].map((r) => ({
    text: r.textContent, checked: r.querySelector("input[type=checkbox]")?.checked })));
  check("only the Completed title with no dates waits for review, unticked", rows.length === 1 && /Undated One/.test(rows[0].text) && !rows[0].checked, rows);
  await page.click("#financePickerCancelBtn"); await page.waitForTimeout(300);
  let d = await data();
  const frierenEntry = d.entries.find((e) => e.title === "Frieren");
  check("Frieren moved to the timeline on the day it was finished, with your score", frierenEntry && frierenEntry.year === 2026 && frierenEntry.month === 3 && frierenEntry.day === 14 && frierenEntry.rating === 4
    && frierenEntry.startMonth === 1 && frierenEntry.backlogAddedAt === "2026-01-01T00:00:00.000Z", frierenEntry);
  check("and is off the backlog", !d.backlog.some((x) => x.id === "b1"), d.backlog.map((x) => x.title));
  const old = d.entries.find((e) => e.title === "Old Favourite");
  check("Old Favourite is filed in the month it was finished, spanning back, with your score", old && old.year === 2025 && old.month === 2 && old.day === 9 && old.startYear === 2024 && old.startMonth === 11 && old.rating === 5 && old.mediaId === "20", old);
  check("a custom list doesn't repeat Planned Show", d.backlog.filter((x) => x.title === "Planned Show").length === 1);
  check("one already on the timeline isn't brought in again", d.entries.filter((e) => e.title === "Logged Already").length === 1);
  check("Chainsaw Man (Paused) is dropped", (d.backlog.find((x) => x.id === "b5") || {}).dropped === true, d.backlog.find((x) => x.id === "b5"));
  check("Gave Up is in the backlog, dropped", (d.backlog.find((x) => x.title === "Gave Up") || {}).dropped === true);
  const dan = d.backlog.find((x) => x.id === "b2") || {};
  check("Dandadan is started on the day AniList says, at episode 4", dan.startedAt === "2026-09-02" && dan.progress === 4 && !!dan.progressAt, dan);
  const nw = d.backlog.find((x) => x.title === "New Watching");
  check("New Watching is in progress", nw && /^\d{4}-\d{2}-\d{2}$/.test(nw.startedAt || ""), nw);
  check("Planned Show is in the backlog, not started", (d.backlog.find((x) => x.title === "Planned Show") || {}).startedAt === undefined && d.backlog.some((x) => x.title === "Planned Show"));
  check("nothing went to AniList without a token", saved.length === 0, saved);

  await page.evaluate(() => [...document.querySelectorAll("#noticeStack .toast-action")].find((b) => /Undo/.test(b.textContent))?.click()); await page.waitForTimeout(700);
  d = await data();
  check("Undo puts Frieren back on the backlog and takes the entry away", d.backlog.some((x) => x.id === "b1" && x.title === "Frieren") && !d.entries.some((e) => e.title === "Frieren"), { b: d.backlog.map((x) => x.title), e: d.entries.map((e) => e.title) });
  check("and un-starts Dandadan", (d.backlog.find((x) => x.id === "b2") || {}).startedAt === undefined);
  check("and un-drops Chainsaw Man, and takes the history away", (d.backlog.find((x) => x.id === "b5") || {}).dropped === undefined && !d.entries.some((e) => e.title === "Old Favourite"));

  // Signed in: the + on the In progress row goes to AniList.
  await page.evaluate(() => {
    const doc = window.LifeLogStorage.cachedCopy();
    doc.settings.anilist.token = "tok";
    doc.settings.mediaCategorySources = { ...(doc.settings.mediaCategorySources || {}), Anime: "anilist-anime" };
    const dd = doc.backlog.find((x) => x.id === "b2");
    Object.assign(dd, { startedAt: "2026-09-02", progress: 4, progressAt: "2026-10-01T00:00:00.000Z", airing: "airing", episodesOut: 6, episodesTotal: 12 });
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(doc));
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" }));
    localStorage.setItem("lifelog-anilist-base-v1", JSON.stringify({ "anilist-anime:9": { s: "current", p: 4 } }));
  });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(400);
  const progressRow = await page.evaluate(() => [...document.querySelectorAll(".progress-row")].map((r) => r.textContent).find((t) => /Dandadan/.test(t)) || "");
  check("the In progress row joins the count to how many are out, once", /4\/6\/12 · since/.test(progressRow) && !/Airing/.test(progressRow), progressRow);
  await page.evaluate(() => [...document.querySelectorAll(".progress-row")].find((r) => /Dandadan/.test(r.textContent)).querySelector(".progress-up").click());
  await page.waitForTimeout(4500);
  check("+ sends episode 5 to AniList, and only the count", saved.length === 1 && saved[0].mediaId === 9 && saved[0].progress === 5 && !saved[0].status, saved);
  d = await data();
  check("and it's 5 here", (d.backlog.find((x) => x.id === "b2") || {}).progress === 5);
  const base = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-anilist-base-v1") || "{}"));
  check("the two now agree on 5", base["anilist-anime:9"] && base["anilist-anime:9"].p === 5, base);
  await page.evaluate(() => { const doc = window.LifeLogStorage.cachedCopy(); delete doc.settings.anilist.token; localStorage.setItem("lifelog-cache-v1", JSON.stringify(doc)); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" })); });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(400);
  await page.click("#settingsBtn"); await page.waitForTimeout(300);

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
