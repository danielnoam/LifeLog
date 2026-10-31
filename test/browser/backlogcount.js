// The episode count kept when an item goes back to the backlog (0.298.0):
// stopping it only clears startedAt, so its row says where you stopped,
// where its category counts episodes, in every row layout.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ name: "Anime", color: "#e06c9f" }, { name: "Manga", color: "#c38a3d" }, { name: "Shows", color: "#5b8cff" }],
  entries: [],
  backlog: [
    { id: "a1", title: "Frieren", category: "Anime", mediaSource: "anilist-anime", mediaId: "5", progress: 7, episodesTotal: 28, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "a2", title: "Dandadan", category: "Anime", mediaSource: "anilist-anime", mediaId: "9", progress: 3, startedAt: "2026-10-01", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "a3", title: "Never Started", category: "Anime", mediaSource: "anilist-anime", mediaId: "11", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "m1", title: "Berserk", category: "Manga", mediaSource: "anilist-manga", mediaId: "12", progress: 12, createdAt: "2026-01-04T00:00:00.000Z" },
    { id: "s1", title: "Uncounted Show", category: "Shows", progress: 2, createdAt: "2026-01-05T00:00:00.000Z" },
  ],
  notes: [], noteCategories: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [],
  settings: { mediaCategorySources: { Anime: "anilist-anime", Manga: "anilist-manga" } },
};
const shots = process.env.LIFELOG_SHOTS;
const countOf = (page, id) => page.evaluate((id) => { const c = document.querySelector(`#viewBody [data-id="${id}"] .bl-count`); return c ? c.textContent.replace(/^ · /, "") : null; }, id);

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const [w, h, name] of [[400, 860, "phone"], [1280, 860, "desktop"]]) {
    const page = await b.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate((seed) => {
      localStorage.clear();
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" }));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    }, SEED);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(400);

    await page.click('.progress-row[data-id="a2"] .progress-stop, [data-id="a2"] .progress-stop');
    await page.waitForTimeout(400);
    const a2 = await page.evaluate(async () => (await window.LifeLogStorage.cachedCopy()).backlog.find((x) => x.id === "a2"));
    check(name + ": stopping keeps the count", a2 && !a2.startedAt && a2.progress === 3, a2);

    await page.click('.tab[data-view="backlog"]');
    await page.waitForTimeout(500);
    check(name + ": the stopped item says where you were", (await countOf(page, "a2")) === "Ep 3", await countOf(page, "a2"));
    check(name + ": an item with a saved count shows it", (await countOf(page, "a1")) === "Ep 7", await countOf(page, "a1"));
    check(name + ": a manga counts chapters", (await countOf(page, "m1")) === "Ch 12", await countOf(page, "m1"));
    check(name + ": nothing on an item never counted", (await countOf(page, "a3")) === null);
    check(name + ": nothing where the category doesn't count", (await countOf(page, "s1")) === null);
    if (shots) {
      for (const theme of ["default", "theme-light", "theme-nord", "theme-dracula"]) {
        await page.evaluate((t) => { document.documentElement.classList.remove("theme-light", "theme-nord", "theme-dracula"); if (t !== "default") document.documentElement.classList.add(t); }, theme);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${shots}/${name}-${theme}.png` });
      }
      await page.evaluate(() => document.documentElement.classList.remove("theme-light", "theme-nord", "theme-dracula"));
    }

    await page.evaluate(() => { const v = JSON.parse(localStorage.getItem("lifelog-visual-settings-v1") || "{}"); v.backlogCoverSize = "none"; localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v)); });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    check(name + ": the plain row shows it too", (await countOf(page, "a1")) === "Ep 7", await countOf(page, "a1"));
    if (shots) await page.screenshot({ path: `${shots}/${name}-plain.png` });
    await page.close();
  }
  check("no page errors", errs.length === 0, errs);
  await b.close();
  done();
})();
