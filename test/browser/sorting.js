const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  financeCategories: [{ id: "f", name: "Food", color: "#4bd07a" }],
  entries: [
    { id: "e1", title: "Old24", category: "Games", year: 2024, month: 2, createdAt: "2024-02-01T00:00:00.000Z" },
    { id: "e2", title: "Late24", category: "Games", year: 2024, month: 11, createdAt: "2024-11-01T00:00:00.000Z" },
    { id: "e3", title: "Early26", category: "Games", year: 2026, month: 1, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "e4", title: "Late26", category: "Games", year: 2026, month: 9, createdAt: "2026-09-01T00:00:00.000Z" },
  ],
  backlog: [
    // Deliberately arranged so A-Z, newest-added and oldest-added are three
    // DIFFERENT orders — with the alphabetical one also newest, the first
    // version of this test passed without the sort doing anything.
    { id: "b1", title: "Charlie", category: "Games", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "b2", title: "Alpha",   category: "Games", createdAt: "2024-01-01T00:00:00.000Z" },
    { id: "b3", title: "Bravo",   category: "Games", createdAt: "2026-01-01T00:00:00.000Z" },
  ],
  financeEntries: [
    { id: "f1", date: "2026-03-02", amount: 10, category: "Food", note: "small", createdAt: "2026-03-02T00:00:00.000Z" },
    { id: "f2", date: "2026-03-20", amount: 300, category: "Food", note: "big", createdAt: "2026-03-20T00:00:00.000Z" },
    { id: "f3", date: "2026-03-10", amount: 50, category: "Food", note: "mid", createdAt: "2026-03-10T00:00:00.000Z" },
    { id: "f4", date: "2025-07-01", amount: 20, category: "Food", note: "lastyear", createdAt: "2025-07-01T00:00:00.000Z" },
  ],
  notes: [], todos: [], todoCategories: [], projects: [], recurringExpenses: [], settings: {},
};

const go = async (page, ui) => {
  await page.evaluate((ui) => localStorage.setItem("lifelog-ui-v1", JSON.stringify(ui)), ui);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(450);
};
const pick = async (page, value) => {
  await page.evaluate((v) => {
    const s = document.querySelector(".sort-select");
    s.value = v; s.onchange();
  }, value);
  await page.waitForTimeout(450);
};
const years = (page) => page.evaluate(() =>
  [...document.querySelectorAll(".year-block")].map((yb) => ({
    y: yb.querySelector(".year-head h2").textContent.trim(),
    months: [...yb.querySelectorAll(".month-card h3 .mc-left")].map((m) => m.textContent.trim()),
  })));
const rows = (page, sel) => page.evaluate((sel) =>
  [...document.querySelectorAll(sel)].map((n) => n.textContent.trim()), sel);

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 500, height: 1100 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)), SEED);

  // ---------- Timeline ----------
  await go(page, { view: "timeline", timelineMode: "entries" });
  const opts = await page.evaluate(() => [...document.querySelectorAll(".sort-select option")].map((o) => o.textContent));
  check("the Timeline control is a list of finished phrases, not a toggle",
    JSON.stringify(opts) === JSON.stringify(["Newest first", "Oldest first"]), opts);
  check("nothing on screen contradicts it", await page.evaluate(() => {
    const s = document.querySelector(".sort-select");
    return !/oldest/i.test(s.title || "") || !/newest/i.test(s.options[s.selectedIndex].text);
  }));

  let y = await years(page);
  check("Newest first runs years newest-first",
    JSON.stringify(y.map((x) => x.y)) === JSON.stringify(["2026", "2024"]), y);
  check("and months inside them newest-first too — the old mix is gone",
    JSON.stringify(y[0].months) === JSON.stringify(["September", "January"]), y[0]);

  await pick(page, "oldest");
  y = await years(page);
  check("Oldest first flips the years as well, which is what it says",
    JSON.stringify(y.map((x) => x.y)) === JSON.stringify(["2024", "2026"]), y);
  check("and the months with them", JSON.stringify(y[0].months) === JSON.stringify(["February", "November"]), y[0]);

  // Notes follows the Timeline, deliberately.
  await go(page, { view: "timeline", timelineMode: "notes" });
  check("Notes has no control of its own", (await page.$(".sort-select")) === null);

  // ---------- Ledger ----------
  await go(page, { view: "finance", financeMode: "entries" });
  const lopts = await page.evaluate(() => [...document.querySelectorAll(".sort-select option")].map((o) => o.textContent));
  check("the Ledger offers time and amount as four complete phrases",
    JSON.stringify(lopts) === JSON.stringify(["Newest first", "Oldest first", "Largest first", "Smallest first"]), lopts);
  check("and it is its own setting, not the Timeline's",
    await page.evaluate(() => document.querySelector(".sort-select").value) === "newest");

  const notes = () => rows(page, ".month-card .finance-entry .etitle");
  check("Newest first: rows run newest date first",
    JSON.stringify((await notes()).slice(0, 3)) === JSON.stringify(["big", "mid", "small"]), await notes());
  await pick(page, "largest");
  check("Largest first: biggest expense leads",
    JSON.stringify((await notes()).slice(0, 3)) === JSON.stringify(["big", "mid", "small"]), await notes());
  await pick(page, "smallest");
  check("Smallest first is its mirror",
    JSON.stringify((await notes()).slice(0, 3)) === JSON.stringify(["small", "mid", "big"]), await notes());
  let ly = await years(page);
  check("an amount sort leaves the months and years where they were",
    JSON.stringify(ly.map((x) => x.y)) === JSON.stringify(["2026", "2025"]), ly);
  await pick(page, "oldest");
  ly = await years(page);
  check("Oldest first flips the Ledger's years too",
    JSON.stringify(ly.map((x) => x.y)) === JSON.stringify(["2025", "2026"]), ly);

  // ---------- Backlog ----------
  await go(page, { view: "backlog", backlogMode: "entries" });
  const bopts = await page.evaluate(() => [...document.querySelectorAll(".sort-select option")].map((o) => o.textContent));
  check("the Backlog offers five sorts including both date-added directions",
    bopts.includes("Recently added") && bopts.includes("Added longest ago") && bopts.length === 5, bopts);
  const titles = () => rows(page, ".backlog-section .bl-title");
  check("Title A–Z is the default", JSON.stringify(await titles()) === JSON.stringify(["Alpha", "Bravo", "Charlie"]), await titles());
  await pick(page, "added-new");
  check("Recently added puts the newest at the top, in an order A–Z would not give",
    JSON.stringify(await titles()) === JSON.stringify(["Bravo", "Charlie", "Alpha"]), await titles());
  await pick(page, "added-old");
  check("Added longest ago is its mirror",
    JSON.stringify(await titles()) === JSON.stringify(["Alpha", "Charlie", "Bravo"]), await titles());

  // ---------- it sticks ----------
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(450);
  check("the choice survives a reload",
    await page.evaluate(() => document.querySelector(".sort-select").value) === "added-old");
  const stored = await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
    return { b: c.settings.backlogSort, t: c.settings.timelineSort, l: c.settings.ledgerSort,
             month: c.settings.monthOrder === undefined };
  });
  check("each view stores its own", stored.b === "added-old" && stored.t === "oldest" && stored.l === "oldest", stored);
  check("and the old monthOrder is gone, not left as a stale second answer", stored.month === true, stored);

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
