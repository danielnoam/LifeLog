// The Backlog's Pick sheet (0.296.0): one button for both ways of letting
// something else decide. Backlog draws from the list as a shuffle or on the
// wheel, My list is the wheel of your own options.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [
    { id: "games", name: "Games", color: "#5b8cff" },
    { id: "chores", name: "Chores", color: "#e2554b", showBought: false },
  ],
  backlog: [
    { id: "g1", title: "Starred Bought", category: "Games", priority: 1, bought: true, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "g2", title: "Starred Only", category: "Games", priority: 1, createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "g3", title: "Plain Game", category: "Games", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "g4", title: "Dropped Game", category: "Games", dropped: true, createdAt: "2026-01-04T00:00:00.000Z" },
    { id: "c1", title: "Plain Chore", category: "Chores", createdAt: "2026-01-05T00:00:00.000Z" },
  ],
  entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [], settings: {},
};

const title = (page) => page.evaluate(() => document.querySelector("#pickModalTitle").firstChild.textContent.trim());
const chip = (page, text) => page.click(`#pickCats .pick-cat:has-text("${text}")`);

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 400, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.removeItem("lifelog-pick-prefs-v1");
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".backlog-section");

  check("one Pick button in the bar", (await page.$$(".dsc-bar-right .pick-open-btn")).length === 1
    && !(await page.$('.dsc-bar-right .btn:has-text("Spin")')));
  await page.click(".pick-open-btn"); await page.waitForTimeout(300);
  check("opens on Backlog with a pick on the card", await page.isVisible("#pickCard") && !!(await title(page)));
  check("dropped titles aren't in the draw", (await page.textContent("#pickCount")).trim() === "4 titles");

  const seen = new Set();
  for (let i = 0; i < 4; i++) { seen.add(await title(page)); await page.click("#pickRerollBtn"); await page.waitForTimeout(50); }
  check("Again goes through everything before repeating", seen.size === 4, [...seen]);

  await chip(page, "Starred"); await page.waitForTimeout(100);
  check("Starred narrows the draw", (await page.textContent("#pickCount")).trim() === "2 titles");
  await chip(page, "Starred");
  await chip(page, "Bought"); await page.waitForTimeout(100);
  check("Bought lets through a category without Bought", (await page.textContent("#pickCount")).trim() === "2 titles");
  await chip(page, "Bought");
  await chip(page, "Games"); await chip(page, "Chores"); await page.waitForTimeout(100);
  check("no category on says so", (await page.textContent("#pickModalTitle")).includes("Nothing to pick from") && await page.isDisabled("#pickOpenBtn"));
  await chip(page, "Games"); await page.waitForTimeout(100);

  await page.click("#pickRevealBtn"); await page.waitForTimeout(300);
  check("Wheel puts the titles on a wheel in the same sheet", await page.isVisible("#wheelCanvas") && await page.isHidden("#pickCard"));
  await page.click("#wheelSpinBtn"); await page.waitForTimeout(500);
  check("where it lands becomes the card", await page.isVisible("#pickCard") && await page.isHidden("#pickWheel") && !!(await title(page)));

  const picked = await title(page);
  await page.click("#pickStartBtn"); await page.waitForTimeout(400);
  const started = await page.evaluate(async (t) => (await window.LifeLogStorage.cachedCopy()).backlog.find((x) => x.title === t).startedAt, picked);
  check("Start moves the pick to In progress", await page.isHidden("#pickModal") && /^\d{4}-\d{2}-\d{2}$/.test(started || ""), started);

  await page.click(".pick-open-btn"); await page.waitForTimeout(300);
  check("the wheel reveal is remembered", await page.isVisible("#wheelCanvas"));
  await page.click('.pick-source [data-src="own"]'); await page.waitForTimeout(300);
  check("My list hides the backlog's scope and buttons", await page.isHidden("#pickScope") && await page.isHidden("#pickOpenBtn") && await page.isVisible("#wheelEdit"));
  await page.fill("#wheelOptions", "Pizza\nRamen\nTacos");
  await page.click("#wheelApplyBtn"); await page.waitForTimeout(200);
  await page.click("#wheelSpinBtn"); await page.waitForTimeout(300);
  const landed = (await page.textContent("#wheelResultText")).trim();
  check("My list spins your own options", ["Pizza", "Ramen", "Tacos"].includes(landed), landed);
  check("and offers Remove & spin", await page.isVisible("#wheelRemoveBtn"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  await page.click(".pick-open-btn"); await page.waitForTimeout(300);
  check("My list is remembered, options kept", await page.isVisible("#wheelCanvas") && await page.isHidden("#pickScope") && await page.isHidden("#wheelEdit"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  check("no console errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
