const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }, { id: "film", name: "Film", color: "#e2554b" }],
  financeCategories: [{ id: "food", name: "Food", color: "#4bd07a" }],
  backlog: [
    { id: "b1", title: "Hades", category: "Games", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b2", title: "Tunic", category: "Games", createdAt: "2026-01-02T00:00:00.000Z" },
    // upcoming mode needs a future release date
    { id: "b3", title: "Hollow Knight Silksong", category: "Games", releaseDate: "2027-05-01",
      releaseStatus: "upcoming", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "b4", title: "Dune Three", category: "Film", releaseYear: 2027,
      releaseStatus: "upcoming", createdAt: "2026-01-04T00:00:00.000Z" },
  ],
  entries: [
    { id: "e1", title: "Celeste", category: "Games", year: 2026, month: 3, createdAt: "2026-03-01T00:00:00.000Z" },
    { id: "e2", title: "Arrival", category: "Film", year: 2026, month: 4, createdAt: "2026-04-01T00:00:00.000Z" },
  ],
  notes: [
    { id: "n1", text: "a note", year: 2026, month: 3, createdAt: "2026-03-02T00:00:00.000Z" },
    { id: "n2", text: "another note", year: 2026, month: 3, createdAt: "2026-03-03T00:00:00.000Z" },
  ],
  todos: [{ id: "t1", text: "Renew passport", createdAt: "2026-03-01T00:00:00.000Z" }],
  financeEntries: [
    { id: "f1", date: "2026-03-04", amount: 20, category: "Food", note: "lunch", createdAt: "2026-03-04T00:00:00.000Z" },
    { id: "f2", date: "2026-03-05", amount: 30, category: "Food", note: "dinner", createdAt: "2026-03-05T00:00:00.000Z" },
  ],
  recurringExpenses: [], projects: [], todoCategories: [],
  settings: { mediaCategorySources: { Games: "rawg", Film: "tmdb-movie" } },
};

// view, mode key, mode value, a row selector that exists in that mode, and
// whether that mode's bar is supposed to offer Sync at all.
const MODES = [
  { name: "Timeline > entries", ui: { view: "timeline", timelineMode: "entries" }, row: ".entry", sync: true },
  { name: "Backlog > backlog", ui: { view: "backlog", backlogMode: "entries" }, row: ".backlog-item, .backlog-item-rich", sync: true },
  { name: "Backlog > next releases", ui: { view: "backlog", backlogMode: "upcoming" }, row: ".backlog-item, .backlog-item-rich", sync: true },
  { name: "Ledger > entries", ui: { view: "finance", financeMode: "entries" }, row: ".finance-entry", sync: false },
  { name: "Notes > notes", ui: { view: "timeline", timelineMode: "notes" }, row: ".note-card", sync: false },
];

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.dismiss());
  await page.goto(BASE + "/", { waitUntil: "networkidle" });

  for (const M of MODES) {
    await page.evaluate(({ ui, seed }) => {
      localStorage.setItem("lifelog-ui-v1", JSON.stringify(ui));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    }, { ui: M.ui, seed: SEED });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    const row = await page.$(M.row);
    if (!row) { check(`${M.name}: has rows to select`, false, M.row); continue; }

    // Enter bulk mode the way a person does.
    // Press near the left edge: attachLongPressSelect deliberately ignores a
    // press that lands on .etitle / .bl-title / .note-text so those stay
    // text-selectable, and those fill the middle of most rows.
    const box = await row.boundingBox();
    await page.mouse.move(box.x + 8, box.y + Math.min(14, box.height / 2));
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    const bar = await page.waitForSelector(".bulk-bar", { timeout: 3000 }).catch(() => null);
    if (!bar) { check(`${M.name}: long-press opens the bulk bar`, false); continue; }

    const idle = await page.evaluate(() => {
      const p = document.querySelector(".bulk-progress");
      return {
        pill: p ? { tag: p.tagName, hidden: p.hidden, box: p.getBoundingClientRect().height } : null,
        hasSync: [...document.querySelectorAll(".bulk-bar .btn")].some((x) => /Sync/.test(x.textContent)),
        run: window.LifeLogApp.getBulkRun(),
      };
    });
    check(`${M.name}: the pill exists as a button`, !!(idle.pill && idle.pill.tag === "BUTTON"), idle.pill);
    check(`${M.name}: and takes no room until there is a run`,
      !!(idle.pill && idle.pill.hidden === true && idle.pill.box === 0), idle.pill);
    check(`${M.name}: Sync ${M.sync ? "is" : "is not"} offered`, idle.hasSync === M.sync, idle.hasSync);
    check(`${M.name}: no run is inherited on entering bulk mode`, idle.run === null, idle.run);

    // Drive a run through the tracker and check the bar in THIS mode reacts.
    const during = await page.evaluate(async () => {
      window.LifeLogApp.startBulkRun([{ id: "a", title: "A" }, { id: "b", title: "B" }]);
      window.LifeLogApp.markBulkItem("a", "done", "cover");
      const cb = document.querySelector(".bulk-check");
      if (cb) { cb.click(); cb.click(); }
      await new Promise((r) => setTimeout(r, 200));
      const p = document.querySelector(".bulk-progress");
      const controls = [...document.querySelectorAll(".bulk-bar .btn, .bulk-bar select")];
      const out = { text: p ? p.textContent : null, hidden: p ? p.hidden : null,
        allDisabled: controls.length > 0 && controls.every((x) => x.disabled) };
      if (p) p.click();
      await new Promise((r) => setTimeout(r, 150));
      out.opened = !document.querySelector("#bulkProgressModal").hidden;
      out.rows = [...document.querySelectorAll("#bulkProgressList .bulkp-row")].length;
      out.panelBox = (() => { const m = document.querySelector("#bulkProgressModal .modal"); const r = m.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), offRight: r.right > innerWidth + 1, offBottom: r.bottom > innerHeight + 1 }; })();
      window.LifeLogApp.closeBulkProgressPanel();
      window.LifeLogApp.finishBulkRun();
      return out;
    });
    check(`${M.name}: the pill shows the run`, during.hidden === false && /1\/2/.test(during.text), during);
    check(`${M.name}: the bar's controls lock during a run`, during.allDisabled === true, during);
    check(`${M.name}: the panel opens with every row`, during.opened === true && during.rows === 2, during);
    check(`${M.name}: the panel fits the viewport`,
      !during.panelBox.offRight && !during.panelBox.offBottom && during.panelBox.h > 80, during.panelBox);

    // Leave bulk mode cleanly.
    await page.evaluate(() => {
      const c = [...document.querySelectorAll(".bulk-bar .btn")].find((x) => /Cancel/.test(x.textContent));
      if (c) { c.disabled = false; c.click(); }
    });
    await page.waitForTimeout(200);
  }

  // A mode with no bulk mode at all must not be broken by any of this.
  for (const ui of [{ view: "timeline", timelineMode: "stats" }, { view: "finance", financeMode: "summary" },
                    { view: "backlog", backlogMode: "discover" }, { view: "timeline", timelineMode: "todo" }]) {
    await page.evaluate(({ ui, seed }) => {
      localStorage.setItem("lifelog-ui-v1", JSON.stringify(ui));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    }, { ui, seed: SEED });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const ok = await page.evaluate(() => ({
      body: !!document.querySelector("#viewBody").children.length,
      bar: !!document.querySelector(".bulk-bar"),
      panel: document.querySelector("#bulkProgressModal").hidden,
    }));
    const label = ui.view + " > " + (ui.timelineMode || ui.financeMode || ui.backlogMode);
    check(`${label}: renders, with no stray bar or panel`, ok.body && !ok.bar && ok.panel === true, ok);
  }

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
