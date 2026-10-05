// Renaming a project, an expense category or a note category carries every
// item that names it (0.240.0): the Ledger's project rename used to leave
// recurring bills behind, and the note-category rename left boards behind.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const T = "2026-05-01T00:00:00.000Z";
const SEED = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [],
  notes: [{ id: "n1", text: "Pack light", category: "Ideas", createdAt: T, updatedAt: T }],
  noteCategories: [{ id: "nc1", name: "Ideas", color: "#556677" }],
  financeCategories: [{ id: "food", name: "Food", color: "#4bd07a" }],
  projects: [{ id: "p1", name: "Switzerland", color: "#e2b23b", createdAt: T }],
  financeEntries: [{ id: "f1", date: "2026-06-04", amount: 120, category: "Food", note: "train", project: "Switzerland", createdAt: T }],
  recurringExpenses: [{ id: "r1", startDate: "2026-06-01", interval: "monthly", amount: 40, category: "Food", note: "Gym",
    project: "Switzerland", extras: [{ id: "x1", date: "2026-06-10", amount: 5, category: "Food" }], createdAt: T }],
  settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".proj-group");
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));

  await page.click(".proj-group-edit");
  await page.fill("#projName", "Alps");
  await page.evaluate(() => document.querySelector("#projectForm").requestSubmit());
  await page.waitForTimeout(400);
  let d = await saved();
  check("a project rename moves its expenses", d.financeEntries[0].project === "Alps", d.financeEntries[0]);
  check("and its recurring bills", d.recurringExpenses[0].project === "Alps", d.recurringExpenses[0]);

  page.once("dialog", (dlg) => dlg.accept());
  await page.click(".proj-group-edit");
  await page.click("#deleteProjectBtn");
  await page.waitForTimeout(400);
  d = await saved();
  check("deleting the project ungroups the bill too", !d.recurringExpenses[0].project && !d.financeEntries[0].project, d.recurringExpenses[0]);

  await page.evaluate(() => {
    window.LifeLogFinance.renameFinanceCategory({ financeEntries: [], recurringExpenses: window.__probe = [{ category: "Food", extras: [{ category: "Food" }] }] }, "Food", "Meals");
  });
  check("an expense-category rename reaches a bill's one-off charges", await page.evaluate(() => window.__probe[0].extras[0].category === "Meals"));

  // The note category's boards follow through LifeLogBoards.renameCategory.
  await page.evaluate(() => {
    window.__renamed = [];
    const real = window.LifeLogBoards.renameCategory;
    window.LifeLogBoards.renameCategory = (from, to) => { window.__renamed.push([from, to]); return real(from, to); };
    window.LifeLogNotes.openNoteCatModal(window.LifeLogNotes.noteCats().find((c) => c.name === "Ideas"));
  });
  await page.fill("#noteCatName", "Plans");
  await page.evaluate(() => document.querySelector("#noteCatForm").requestSubmit());
  await page.waitForTimeout(400);
  d = await saved();
  check("a note-category rename moves its notes", d.notes[0].category === "Plans", d.notes[0]);
  check("and asks the boards to follow", await page.evaluate(() => JSON.stringify(window.__renamed) === JSON.stringify([["Ideas", "Plans"]])));

  check("no page errors", !errs.length, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
