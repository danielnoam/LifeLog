// Ledger subcategories (0.288.0): the folder-style picker, the row's chip,
// the sub chips after their category's, the By category bars, and the
// category sheet adding, renaming and removing subs (each carried to the
// expenses). SHOTS=<dir> saves screenshots at phone and desktop width.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const T = "2026-10-01T00:00:00.000Z";
const SEP = "\u001f";
const SEED = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], notes: [], noteCategories: [], projects: [],
  financeCategories: [
    { id: "ent", name: "Entertainment", color: "#723be2", subs: [{ id: "g", name: "Games", createdAt: T }, { id: "b", name: "Books", createdAt: T }] },
    { id: "food", name: "Food", color: "#4bd07a" },
  ],
  financeEntries: [
    { id: "f1", date: "2026-10-04", amount: 60, category: "Entertainment", subcategory: "Games", note: "Hades II", createdAt: T },
    { id: "f2", date: "2026-10-05", amount: 20, category: "Entertainment", subcategory: "Books", note: "Dune", createdAt: T },
    { id: "f3", date: "2026-10-06", amount: 15, category: "Entertainment", note: "Bowling", createdAt: T },
    { id: "f4", date: "2026-10-07", amount: 30, category: "Food", note: "Lunch", createdAt: T },
  ],
  recurringExpenses: [], settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 375, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".finance-entry");
  const saved = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());
  const notes = () => page.evaluate(() => [...document.querySelectorAll(".finance-entry:not(.ll-exit)")].map((r) => r.textContent).join("|"));
  const chips = () => page.evaluate(() => [...document.querySelectorAll("#catFilter .cat-chip")].map((c) => c.textContent.trim()));
  const tap = (text) => page.evaluate((t) => [...document.querySelectorAll("#catFilter .cat-chip")].find((c) => c.textContent.trim() === t).click(), text);

  check("a row's chip names its sub, the full path in its title", await page.evaluate(() => [...document.querySelectorAll(".finance-entry .entry-cat")].some((c) => c.textContent === "Games" && c.title === "Entertainment › Games")));
  check("sub chips stay hidden until their category is on", !(await chips()).includes("Games"), await chips());
  await tap("Entertainment");
  await page.waitForTimeout(200);
  const c1 = await chips();
  check("its sub chips follow it", c1.join(",").includes("Entertainment,Only Entertainment,Games,Books,Food"), c1);
  let n = await notes();
  check("the category alone shows all of it", n.includes("Hades II") && n.includes("Dune") && n.includes("Bowling") && !n.includes("Lunch"), n);
  await tap("Games");
  await page.waitForTimeout(200);
  n = await notes();
  check("a sub narrows to it", n.includes("Hades II") && !n.includes("Dune") && !n.includes("Bowling"), n);
  await tap("Only Entertainment");
  await page.waitForTimeout(200);
  n = await notes();
  check("Only Entertainment adds the ones with no sub", n.includes("Hades II") && n.includes("Bowling") && !n.includes("Dune"), n);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/chips-375.png" });
  await tap("Entertainment");
  await page.waitForTimeout(200);
  check("switching the category off takes its subs' picks with it", !(await chips()).includes("Games") && (await notes()).includes("Lunch"));

  // ---- the picker ----
  await page.evaluate(() => window.LifeLogFinance.openFinanceModal(null));
  await page.waitForTimeout(100);
  const opts = await page.evaluate(() => [...document.querySelectorAll("#finCategory option")].map((o) => [o.value, o.textContent]));
  check("the picker lists subs under their category", opts.findIndex((o) => o[0] === "Entertainment" + "\u001fGames") === opts.findIndex((o) => o[0] === "Entertainment") + 1
    && opts.find((o) => o[0] === "Entertainment\u001fGames")[1].trim() === "Games", opts);
  await page.fill("#finAmount", "9");
  await page.fill("#finNote", "Arcade");
  await page.selectOption("#finCategory", "Entertainment" + SEP + "Games");
  await page.evaluate(() => document.querySelector("#financeForm").requestSubmit());
  await page.waitForTimeout(400);
  let d = await saved();
  const arcade = d.financeEntries.find((f) => f.note === "Arcade");
  check("saving a sub files it under both", arcade && arcade.category === "Entertainment" && arcade.subcategory === "Games", arcade);
  await page.evaluate(() => document.querySelectorAll(".finance-entry").forEach((r) => { if (r.textContent.includes("Arcade")) r.click(); }));
  await page.waitForTimeout(200);
  check("editing it shows the sub picked", await page.evaluate(() => document.querySelector("#finCategory").value) === "Entertainment" + SEP + "Games");
  await page.selectOption("#finCategory", "Entertainment");
  await page.evaluate(() => document.querySelector("#financeForm").requestSubmit());
  await page.waitForTimeout(400);
  d = await saved();
  check("picking the category alone drops the sub", !("subcategory" in d.financeEntries.find((f) => f.note === "Arcade")));

  // ---- the category sheet ----
  await page.evaluate(() => [...document.querySelectorAll("#catFilter .cat-chip")].find((c) => c.textContent.trim() === "Entertainment").querySelector(".chip-edit").click());
  await page.waitForTimeout(200);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#finCatSubItems input")].map((i) => i.value));
  check("the sheet lists the subs", rows.join(",") === "Games,Books", rows);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/sheet-375.png" });
  await page.locator("#finCatSubItems input").first().fill("Gaming");
  await page.evaluate(() => document.querySelectorAll("#finCatSubItems .note-list-del")[1].click());
  await page.fill("#finCatNewSub", "Cinema");
  await page.press("#finCatNewSub", "Enter");
  check("Enter adds a sub without saving", await page.evaluate(() => !document.querySelector("#financeCatModal").hidden && document.querySelectorAll("#finCatSubItems input").length === 2));
  let asked = "";
  page.once("dialog", (dlg) => { asked = dlg.message(); dlg.accept(); });
  await page.evaluate(() => document.querySelector("#financeCatForm").requestSubmit());
  await page.waitForTimeout(400);
  check("removing a sub in use asks first", /1 expense uses “Books”/.test(asked), asked);
  d = await saved();
  const ent = d.financeCategories.find((c) => c.name === "Entertainment");
  check("the sheet saves renames, removals and adds", ent.subs.map((x) => x.name).join(",") === "Gaming,Cinema", ent.subs);
  check("a rename keeps the sub's id", ent.subs[0].id === "g", ent.subs[0]);
  check("the renamed sub's expenses follow", d.financeEntries.find((f) => f.id === "f1").subcategory === "Gaming");
  check("the removed sub's expenses stay in the category", (() => { const f = d.financeEntries.find((x) => x.id === "f2"); return f.category === "Entertainment" && !f.subcategory; })());

  // ---- By category ----
  await page.evaluate(() => {
    const ui = JSON.parse(localStorage.getItem("lifelog-ui-v1") || "{}");
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ ...ui, view: "finance", financeMode: "summary" }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".bar-row");
  const bars = await page.evaluate(() => [...document.querySelectorAll(".bar-row")].map((r) => (r.classList.contains("is-sub") ? "  " : "") + r.querySelector(".lbl").textContent));
  const at = bars.indexOf("Entertainment");
  check("By category draws a category's subs under it", at >= 0 && bars[at + 1] === "  Gaming" && bars[at + 2] === "  No subcategory", bars);
  check("a category with no subs has no sub bars", bars[bars.indexOf("Food") + 1] === undefined || !bars[bars.indexOf("Food") + 1].startsWith("  "), bars);

  if (process.env.SHOTS) {
    for (const [w, h] of [[375, 900], [1280, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const theme of ["", "light", "nord", "dracula"]) {
        await page.evaluate((t) => {
          for (const c of ["theme-light", "theme-nord", "theme-dracula"]) document.documentElement.classList.remove(c);
          if (t) document.documentElement.classList.add("theme-" + t);
        }, theme);
        await page.waitForTimeout(150);
        await page.screenshot({ path: process.env.SHOTS + `/summary-${w}${theme ? "-" + theme : ""}.png` });
      }
    }
  }

  check("no page errors", !errs.length, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
