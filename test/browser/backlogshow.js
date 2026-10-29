const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [
    { id: "games", name: "Games", color: "#5b8cff" },
    // Nothing to buy here: Bought lets it through.
    { id: "chores", name: "Chores", color: "#e2554b", showBought: false },
  ],
  backlog: [
    { id: "g1", title: "Starred Bought", category: "Games", priority: 1, bought: true, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "g2", title: "Starred Only", category: "Games", priority: 1, createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "g3", title: "Bought Only", category: "Games", bought: true, createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "g4", title: "Plain Game", category: "Games", createdAt: "2026-01-04T00:00:00.000Z" },
    { id: "g5", title: "Watched Game", category: "Games", mediaSource: "steam", mediaId: "1", priceAlert: 10, createdAt: "2026-01-04T01:00:00.000Z" },
    { id: "c1", title: "Starred Chore", category: "Chores", priority: 1, createdAt: "2026-01-05T00:00:00.000Z" },
    { id: "c2", title: "Plain Chore", category: "Chores", createdAt: "2026-01-06T00:00:00.000Z" },
  ],
  entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [], settings: {},
};

const titles = (page) => page.evaluate(() => [...document.querySelectorAll("#viewBody .bl-title")].map((t) => t.textContent.trim()).sort());
const chip = (page, key) => page.click(`#showFilter [data-show="${key}"]`);

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

  check("the Show row is there on the Backlog", await page.isVisible("#showFilterGroup"));
  check("nothing on lists everything", (await titles(page)).length === 7, await titles(page));

  await chip(page, "starred"); await page.waitForTimeout(700);
  check("Starred lists the starred ones", JSON.stringify(await titles(page)) === JSON.stringify(["Starred Bought", "Starred Chore", "Starred Only"]), await titles(page));
  check("and the chip reads as on", await page.getAttribute('#showFilter [data-show="starred"]', "aria-pressed") === "true");

  await chip(page, "bought"); await page.waitForTimeout(700);
  check("both stack, and a category without Bought counts as bought", JSON.stringify(await titles(page)) === JSON.stringify(["Starred Bought", "Starred Chore"]), await titles(page));

  await chip(page, "starred"); await page.waitForTimeout(700);
  check("Bought alone keeps every chore", JSON.stringify(await titles(page)) === JSON.stringify(["Bought Only", "Plain Chore", "Starred Bought", "Starred Chore"]), await titles(page));
  await chip(page, "bought"); await page.waitForTimeout(700);

  await chip(page, "unbought"); await page.waitForTimeout(700);
  check("Not bought turns Bought off", await page.getAttribute('#showFilter [data-show="bought"]', "aria-pressed") === "false");
  check("and lists what's left to buy, chores kept", JSON.stringify(await titles(page)) === JSON.stringify(["Plain Chore", "Plain Game", "Starred Chore", "Starred Only", "Watched Game"]), await titles(page));

  await chip(page, "alert"); await page.waitForTimeout(700);
  check("Price alert lists the watched Steam game", JSON.stringify(await titles(page)) === JSON.stringify(["Watched Game"]), await titles(page));
  await chip(page, "bought"); await page.waitForTimeout(700);
  check("Bought turns Not bought and Price alert off",
    (await page.$$('#showFilter [aria-pressed="true"]')).length === 1, await titles(page));

  await page.click("#showFilterLabel"); await page.waitForTimeout(700);
  check("the label clears the row", (await titles(page)).length === 7 && (await page.$$('#showFilter [aria-pressed="true"]')).length === 0, await titles(page));

  await page.click('.tab[data-view="timeline"]'); await page.waitForTimeout(300);
  check("the row isn't on the Timeline", !(await page.isVisible("#showFilterGroup")));

  check("no console errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
