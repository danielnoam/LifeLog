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
  ],
  entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [], settings: {},
};

const tileTitles = (page) => page.evaluate(() => [...document.querySelectorAll("#viewBody .bl-tile-title")].map((t) => t.textContent.trim()));
const pickTitle = (page) => page.evaluate(() => document.querySelector("#pickModalTitle").textContent.trim());
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
  const swipeLeft = async (sel) => {
    const r = await page.locator(sel).boundingBox();
    const y = r.y + 200;
    await page.mouse.move(r.x + 300, y); await page.mouse.down();
    for (let x = 300; x >= 60; x -= 20) await page.mouse.move(r.x + x, y + 2);
    await page.mouse.up(); await page.waitForTimeout(700);
  };
  await swipeLeft("#content");
  check("a swipe from the List lands on Covers", await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-ui-v1")).backlogMode) === "covers");
  check("which shows covers, the dropped band folded away", JSON.stringify(await tileTitles(page)) ===
    JSON.stringify(["Starred Bought", "A Plain Game With A Long Name That Wraps", "Watched Game", "First Book", "Second Book"]), await tileTitles(page));
  check("a tile without art gets the tinted block", (await page.$$('.bl-tile[data-id="g3"] .cover-empty')).length === 1);
  check("starred and bought are marked", (await page.$$('.bl-tile[data-id="g1"] .bl-tile-mark')).length === 2);
  check("a price alert is marked", !!(await page.$('.bl-tile[data-id="g3"] .bl-tile-mark[aria-label="Price alert"]')));
  check("with Spin, Pick random and the sort", (await page.$$(".dsc-bar-right > *")).length === 3);
  if (shots) await page.screenshot({ path: shots + "/covers-phone.png" });

  await page.click('.bl-tile[data-id="g1"]'); await page.waitForTimeout(400);
  check("a cover opens the card on it", !(await page.isHidden("#pickModal")) && await pickTitle(page) === "Starred Bought");
  check("previous is off at the start", await page.isDisabled("#pickPrevBtn"));
  check("browsing hides the draw's scope", await page.isHidden(".pick-scope") && await page.isHidden("#pickRerollBtn"));
  check("and says where you are", (await page.textContent("#pickBrowseCount")) === "1 of 5", await page.textContent("#pickBrowseCount"));
  if (shots) await page.screenshot({ path: shots + "/card-phone.png" });

  await page.click("#pickNextBtn"); await page.waitForTimeout(300);
  check("next steps in the covers' order", await pickTitle(page) === "A Plain Game With A Long Name That Wraps");
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
  check("the arrow keys step too", await pickTitle(page) === "Watched Game");
  await page.click("#pickNextBtn"); await page.waitForTimeout(300);
  check("and carry on into the next category", await pickTitle(page) === "First Book");
  await page.click("#pickNextBtn"); await page.waitForTimeout(300);
  check("next is off at the end", await page.isDisabled("#pickNextBtn"));

  const box = await page.locator("#pickModal .modal").boundingBox();
  const y = box.y + 120;
  await page.mouse.move(box.x + 60, y); await page.mouse.down();
  for (let x = 60; x <= 260; x += 20) await page.mouse.move(box.x + x, y + 2);
  await page.mouse.up(); await page.waitForTimeout(300);
  check("a swipe right goes back", await pickTitle(page) === "First Book", await pickTitle(page));
  await page.mouse.move(box.x + 260, y); await page.mouse.down();
  for (let x = 260; x >= 60; x -= 20) await page.mouse.move(box.x + x, y + 2);
  await page.mouse.up(); await page.waitForTimeout(300);
  check("a swipe left goes forward", await pickTitle(page) === "Second Book", await pickTitle(page));

  await page.click("#pickOpenBtn"); await page.waitForTimeout(400);
  check("Open goes to the item's sheet", !(await page.isHidden("#backlogModal")) && (await page.inputValue("#bTitle")) === "Second Book");
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);

  await page.click(".dsc-bar-right .btn:has-text('Pick random')"); await page.waitForTimeout(400);
  check("Pick random is still the draw", await page.isVisible(".pick-scope") && await page.isHidden("#pickPrevBtn"));
  await page.click("#pickCloseBtn"); await page.waitForTimeout(300);

  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(500);
  check("the mode is kept on this device", (await page.$$(".bl-tile")).length === 5);

  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(400);
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".bl-covers")).gridTemplateColumns.split(" ").length);
  check("a desktop wall is wider than a phone's", cols >= 8, cols);
  if (shots) await page.screenshot({ path: shots + "/covers-desktop.png" });

  await page.evaluate(() => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" }));
  });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(400);
  await page.click('.tab[data-view="backlog"]'); await page.waitForTimeout(500);
  check("the Backlog still opens on its List", (await page.$$(".bl-tile")).length === 0 && (await page.$$(".backlog-item-rich")).length > 0);

  check("no console errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
