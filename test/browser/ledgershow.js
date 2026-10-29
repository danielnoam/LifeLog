// The Ledger's project filter as a Show row like the Backlog's (0.290.0).
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [],
  financeCategories: [{ id: "f", name: "Food", color: "#4bd07a" }],
  projects: [{ id: "p1", name: "Switzerland", color: "#e2b23b", createdAt: "2026-05-01T00:00:00.000Z" }],
  financeEntries: [
    { id: "f1", date: "2026-06-04", amount: 120, category: "Food", note: "groceries", createdAt: "2026-06-04T00:00:00.000Z" },
    { id: "f2", date: "2026-06-05", amount: 80, category: "Food", note: "fondue", project: "Switzerland", createdAt: "2026-06-05T00:00:00.000Z" },
  ],
  recurringExpenses: [], settings: { currency: "ILS" },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 400, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const shown = () => page.evaluate(() => document.querySelectorAll('#viewBody [data-id="f1"], #viewBody [data-id="f2"]').length);
  const on = () => page.evaluate(() => [...document.querySelectorAll("#projFilter [aria-pressed=true]")].map((c) => c.dataset.show));

  check("the row reads Show", (await page.textContent("#projFilterLabel")).trim() === "Show");
  check("its chips carry icons", (await page.$$("#projFilter .kind-chip .kind-ico")).length === 2);
  const all = await shown();
  await page.click('#projFilter [data-show="any"]'); await page.waitForTimeout(500);
  check("Project narrows to project spending", JSON.stringify(await on()) === '["any"]' && (await shown()) < all, { on: await on(), shown: await shown(), all });
  await page.click('#projFilter [data-show="none"]'); await page.waitForTimeout(500);
  check("No project turns Project off", JSON.stringify(await on()) === '["none"]', await on());
  await page.click("#projFilterLabel"); await page.waitForTimeout(500);
  check("the label clears the row", (await on()).length === 0 && (await shown()) === all);

  check("no console errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
