// Next in the series (0.275.0): logging a synced title as done asks its
// source what follows it and offers that in a second toast, whose button
// opens the backlog sheet with the sequel filled in. A sequel you already
// have is not offered, and an edit asks nothing.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ name: "Games", color: "#3fb950" }, { name: "Film", color: "#58a6ff" }],
  entries: [{ id: "e1", title: "Dune", category: "Film", year: 2026, month: 1, date: "2026-01", mediaSource: "tmdb-movie", mediaId: "10", createdAt: "2026-01-01T00:00:00.000Z" }],
  backlog: [
    { id: "b1", title: "Hades II", category: "Games", mediaSource: "rawg", mediaId: "hades-ii", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b2", title: "Dune: Part Two", category: "Film", mediaSource: "tmdb-movie", mediaId: "20", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "b3", title: "Dune: Part Three", category: "Film", createdAt: "2026-01-03T00:00:00.000Z" },
  ],
  notes: [], accomplishments: {}, habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: { mediaCategorySources: { Games: "rawg", Film: "tmdb-movie" }, mediaKeys: { rawg: "k", tmdb: "t" } },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const asked = [];
  const json = (r, body) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.route("https://api.rawg.io/**", (r) => {
    const u = r.request().url();
    asked.push(u);
    if (/game-series/.test(u)) return json(r, { results: [
      { slug: "hades", name: "Hades", released: "2020-09-17", background_image: "https://img/h1.jpg" },
      { slug: "hades-iii", name: "Hades III", released: "2028-03-03", background_image: "https://img/h3.jpg", metacritic: 90, playtime: 40, genres: [{ name: "Roguelike" }] },
    ] });
    return json(r, { slug: "hades-ii", name: "Hades II", released: "2024-05-06", description_raw: "Underworld again." });
  });
  await page.route("https://api.themoviedb.org/**", (r) => {
    const u = r.request().url();
    asked.push(u);
    if (/\/collection\//.test(u)) return json(r, { parts: [
      { id: 10, title: "Dune", release_date: "2021-10-22" }, { id: 20, title: "Dune: Part Two", release_date: "2024-03-01" }, { id: 30, title: "Dune: Part Three", release_date: "2026-12-18" },
    ] });
    return json(r, { id: 20, release_date: "2024-03-01", belongs_to_collection: { id: 7 }, status: "Released", runtime: 166 });
  });

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)); }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const toasts = () => page.evaluate(() => [...document.querySelectorAll("#noticeStack .toast:not([hidden])")].map((t) => t.textContent));
  const finish = async (backlogId) => {
    await page.evaluate((id) => {
      const item = window.LifeLogBacklog ? (window.LifeLogStorage.cachedCopy().backlog || []).find((x) => x.id === id) : null;
      window.LifeLogJournal.openEntryModal(null, item);
    }, backlogId);
    await page.waitForTimeout(200);
    await page.click("#entryForm button[type=submit]");
    await page.waitForTimeout(900);
  };

  // ---- a game from RAWG: the sequel is offered, and the button fills the sheet ----
  await finish("b1");
  let t = await toasts();
  check("logging a RAWG game offers the next game in its series", t.some((x) => /Next in the series: Hades III/.test(x)), t);
  check("the prequel in the same list is not what's offered", !t.some((x) => /Hades\b(?! I)/.test(x) && /Next/.test(x)), t);
  check("RAWG was asked for the game and its series", asked.filter((u) => /rawg/.test(u)).length === 2, asked);
  await page.click("#toast .toast-action");
  await page.waitForTimeout(600);
  const sheet = await page.evaluate(() => ({
    open: !document.querySelector("#backlogModal").hidden && getComputedStyle(document.querySelector("#backlogModal")).display !== "none",
    title: document.querySelector("#bTitle").value, cat: document.querySelector("#bCategory").value,
    id: document.querySelector("#bMediaId").value, src: document.querySelector("#bMediaSource").value,
    cover: document.querySelector("#bCoverUrl").value,
  }));
  check("Add to backlog opens the sheet with the sequel filled in, in the finished title's category",
    sheet.open && sheet.title === "Hades III" && sheet.cat === "Games" && sheet.id === "hades-iii" && sheet.src === "rawg" && /h3\.jpg/.test(sheet.cover), sheet);
  await page.click("#backlogForm button[type=submit]");
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => (window.LifeLogStorage.cachedCopy().backlog || []).map((x) => x.title));
  check("and saving it lands it in the backlog", saved.includes("Hades III") && !saved.includes("Hades II"), saved);

  // ---- a film whose next part is already in the backlog: no offer ----
  await page.evaluate(() => document.querySelectorAll("#noticeStack .toast").forEach((x) => { x.hidden = true; }));
  asked.length = 0;
  await finish("b2");
  t = await toasts();
  check("a sequel already in the backlog is not offered", !t.some((x) => /Next in the series/.test(x)), t);
  check("though the source was asked", asked.some((u) => /\/collection\/7/.test(u)), asked);

  // ---- editing a logged title asks nothing ----
  asked.length = 0;
  await page.evaluate(() => {
    const e = window.LifeLogStorage.cachedCopy().entries.find((x) => x.id === "e1");
    window.LifeLogJournal.openEntryModal(e);
  });
  await page.waitForTimeout(200);
  await page.click("#entryForm button[type=submit]");
  await page.waitForTimeout(600);
  t = await toasts();
  check("an edit is not a finish: no lookup, no offer", asked.length === 0 && !t.some((x) => /Next in the series/.test(x)), { asked, t });

  await b.close();
  done(errs);
})();
