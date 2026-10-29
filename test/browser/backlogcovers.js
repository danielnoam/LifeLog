const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const art = (fill) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${fill}"/></svg>`);

const SEED = {
  categories: [
    { id: "games", name: "Games", color: "#5b8cff" },
    { id: "books", name: "Books", color: "#3fb27f" },
  ],
  backlog: [
    { id: "g1", title: "Starred Bought", category: "Games", priority: 1, bought: true, coverUrl: art("#2d4f8f"), createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "g2", title: "A Plain Game With A Long Name That Wraps", category: "Games", coverUrl: art("#6b3f8f"), createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "g3", title: "Watched Game", category: "Games", mediaSource: "steam", mediaId: "1", priceAlert: 10, createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "g4", title: "Gave Up", category: "Games", dropped: true, createdAt: "2026-01-04T00:00:00.000Z" },
    { id: "b1", title: "First Book", category: "Books", coverUrl: art("#8f5a2d"), createdAt: "2026-01-05T00:00:00.000Z" },
    { id: "b2", title: "Second Book", category: "Books", createdAt: "2026-01-06T00:00:00.000Z" },
    { id: "u1", title: "Far Off Game", category: "Games", releaseDate: "2099-05-01", releasePrecision: "day", createdAt: "2026-01-07T00:00:00.000Z" },
  ],
  entries: [
    { id: "e1", title: "Finished Game", category: "Games", year: 2026, month: 3, rating: 4, coverUrl: art("#2d7a4f"), createdAt: "2026-03-01T00:00:00.000Z" },
    { id: "e2", title: "Finished Book", category: "Books", year: 2026, month: 3, createdAt: "2026-03-02T00:00:00.000Z" },
  ],
  notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [], settings: {},
};

const tileTitles = (page) => page.evaluate(() => [...document.querySelectorAll("#viewBody .bl-tile-title")].map((t) => t.textContent.trim()));
const shots = process.env.LIFELOG_SHOTS;

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 400, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".backlog-section");
  await page.waitForTimeout(300);

  check("the List is the default", (await page.$$(".bl-tile")).length === 0);
  const setLayout = async (id, value) => {
    await page.click("#viewOptionsBtn"); await page.waitForTimeout(300);
    await page.selectOption("#" + id, value); await page.waitForTimeout(300);
    await page.click("#closeViewOptionsBtn"); await page.waitForTimeout(400);
  };
  await setLayout("backlogLayout", "covers");
  check("View → Layout → Covers shows covers, the dropped band folded away", JSON.stringify(await tileTitles(page)) ===
    JSON.stringify(["Starred Bought", "A Plain Game With A Long Name That Wraps", "Watched Game", "Far Off Game", "First Book", "Second Book"]), await tileTitles(page));
  check("a tile without art gets the tinted block", (await page.$$('.bl-tile[data-id="g3"] .cover-empty')).length === 1);
  check("starred and bought are marked", (await page.$$('.bl-tile[data-id="g1"] .bl-tile-mark')).length === 2);
  check("a price alert is marked", !!(await page.$('.bl-tile[data-id="g3"] .bl-tile-mark[aria-label="Price alert"]')));
  check("with Spin, Pick random and the sort", (await page.$$(".dsc-bar-right > *")).length === 3);
  if (shots) await page.screenshot({ path: shots + "/covers-phone.png" });

  await page.click('.bl-tile[data-id="g2"]'); await page.waitForTimeout(400);
  check("a cover opens the item's own sheet", !(await page.isHidden("#backlogModal")) && (await page.inputValue("#bTitle")) === "A Plain Game With A Long Name That Wraps");
  check("not the Pick random card", await page.isHidden("#pickModal"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);

  await page.click(".dsc-bar-right .btn:has-text('Pick random')"); await page.waitForTimeout(400);
  check("Pick random is still the draw", await page.isVisible(".pick-scope"));
  await page.click("#pickCloseBtn"); await page.waitForTimeout(300);

  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(500);
  check("the layout is kept on this device", (await page.$$(".bl-tile")).length >= 5);

  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(400);
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".bl-covers")).gridTemplateColumns.split(" ").length);
  check("a desktop wall is wider than a phone's", cols >= 8, cols);
  if (shots) await page.screenshot({ path: shots + "/covers-desktop.png" });

  await page.setViewportSize({ width: 400, height: 900 });
  await page.evaluate(() => localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "upcoming" })));
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(500);
  check("Next releases draws covers too, with the date under the title",
    !!(await page.$('.bl-tile[data-id="u1"] .bl-tile-caption.up-when')));
  await page.click('.bl-tile[data-id="u1"]'); await page.waitForTimeout(400);
  check("and its cover opens the item's sheet", !(await page.isHidden("#backlogModal")) && (await page.inputValue("#bTitle")) === "Far Off Game");
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);


  await page.evaluate(() => localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "covers" })));
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(500);
  check("someone left on 0.289.0's Covers mode lands on the List, in covers",
    (await page.$$(".backlog-section .bl-tile")).length >= 5, { mode: await page.evaluate(() => localStorage.getItem("lifelog-ui-v1")), tiles: (await page.$$(".bl-tile")).length });

  await page.click('.tab[data-view="timeline"]'); await page.waitForTimeout(500);
  check("the Timeline keeps its own layout", (await page.$$("#viewBody .bl-tile")).length === 0);
  await setLayout("timelineLayout", "covers");
  check("and takes Covers from its View", JSON.stringify(await tileTitles(page)) === JSON.stringify(["Finished Book", "Finished Game"]), await tileTitles(page));
  check("with the rating under the title", !!(await page.$('.bl-tile[data-id="e1"] .bl-tile-caption.erating')));
  if (shots) await page.screenshot({ path: shots + "/timeline-phone.png" });
  await page.click('.bl-tile[data-id="e1"]'); await page.waitForTimeout(400);
  check("a cover there opens the entry", !(await page.isHidden("#entryModal")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  check("no console errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
