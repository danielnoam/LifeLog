// Skips that remember where a title was (Nov 2026, src/skips.js): left
// unticked at 5 episodes, an AniList title stays out while it's at 5, the
// sync's toast offers it under Show skipped, and it's asked about again at 6
// or once it's completed.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ name: "Anime", color: "#58a6ff" }],
  entries: [], backlog: [],
  notes: [], accomplishments: {}, habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: { anilist: { userName: "me", animeCategory: "Anime", mangaCategory: "", autoSyncDays: "0", newMode: "ask" } },
};
const media = (id, title) => ({ id, type: "ANIME", title: { romaji: title }, coverImage: { medium: "" }, startDate: { year: 2025, month: 1, day: 5 }, status: "FINISHED", episodes: 7, averageScore: 80, genres: [] });
const lists = { a: { status: "CURRENT", progress: 5 }, b: { status: "CURRENT", progress: 3 } };
const entry = (k, id, title) => ({ status: lists[k].status, score: 0, progress: lists[k].progress, updatedAt: 1790000000, startedAt: { year: 2026, month: 9, day: 2 },
  completedAt: lists[k].status === "COMPLETED" ? { year: 2026, month: 11, day: 1 } : {}, media: media(id, title) });

const rowsOf = (page) => page.evaluate(() => [...document.querySelectorAll("#financePickerList label")].map((r) => ({ t: r.textContent.replace(/\s+/g, " ").trim(), on: r.querySelector("input").checked })));

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.route("https://graphql.anilist.co/**", (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    const json = (data) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ data }) });
    if (/MediaListCollection/.test(body.query)) return json({ MediaListCollection: { lists: [{ isCustomList: false, entries: [entry("a", 41, "Show A"), entry("b", 42, "Show B")] }] } });
    return json({});
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)); }, SEED);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(300);
  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  await page.click('.srow[data-page="imports"]'); await page.waitForTimeout(300);
  await page.click('.srow[data-page="conn-anilist"]'); await page.waitForTimeout(300);
  const sync = async () => { await page.click("#anilistSyncBtn"); await page.waitForTimeout(900); };
  const reviewOpen = () => page.evaluate(() => !document.querySelector("#financePickerModal").hidden);

  await sync();
  check("the first sync asks about both new titles", await reviewOpen() && (await rowsOf(page)).length === 2);
  // Untick both: skipped at 5 and at 3.
  await page.evaluate(() => document.querySelectorAll("#financePickerList label input").forEach((c) => { if (c.checked) c.click(); }));
  await page.click("#financePickerConfirmBtn"); await page.waitForTimeout(700);
  let d = await page.evaluate(() => window.LifeLogStorage.cachedCopy());
  check("each skip keeps its episode count", JSON.stringify(d.settings.importSkips.anilist.slice().sort()) === JSON.stringify(["anilist-anime:41#5", "anilist-anime:42#3"]), d.settings.importSkips);

  await sync();
  const t = await page.evaluate(() => document.querySelector("#toast").textContent);
  check("unchanged, nothing is asked; the toast offers what was skipped", !(await reviewOpen()) && /Show skipped/.test(t), t);
  await page.evaluate(() => [...document.querySelectorAll(".toast-action")].find((x) => /Show skipped/.test(x.textContent)).click());
  await page.waitForTimeout(500);
  const shown = await rowsOf(page);
  check("Show skipped lists them unticked, saying where they were skipped", await reviewOpen() && shown.length === 2 && shown.every((r) => !r.on) && shown.some((r) => /skipped at 5/.test(r.t)), shown);
  await page.click("#financePickerCancelBtn"); await page.waitForTimeout(300);

  lists.a.progress = 6;
  lists.b = { status: "COMPLETED", progress: 7 };
  await sync();
  const back = await rowsOf(page);
  check("6 episodes and completed both come back, saying they've moved on", await reviewOpen() && back.length === 2 && back.every((r) => /moved on/.test(r.t)), back);
  check("the skipped count is gone, as nothing is still skipped", await page.evaluate(() => document.querySelector("#financePickerSkipRow").hidden));
  await page.evaluate(() => document.querySelectorAll("#financePickerList label input").forEach((c) => { if (c.checked) c.click(); }));
  await page.click("#financePickerConfirmBtn"); await page.waitForTimeout(700);
  d = await page.evaluate(() => window.LifeLogStorage.cachedCopy());
  check("skipped again, they keep the new state", JSON.stringify(d.settings.importSkips.anilist.slice().sort()) === JSON.stringify(["anilist-anime:41#6", "anilist-anime:42#done"]), d.settings.importSkips);

  check("no errors", errs.length === 0, errs);
  await ctx.close();
  await b.close();
  done();
})();
