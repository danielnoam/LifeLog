const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }],
  financeCategories: [{ id: "food", name: "Food", color: "#4bd07a" }],
  backlog: [{ id: "b1", title: "Hades", category: "Games", createdAt: "2026-01-01T00:00:00.000Z" }],
  entries: [{ id: "e1", title: "Celeste", category: "Games", year: 2026, month: 3, createdAt: "2026-03-01T00:00:00.000Z" }],
  financeEntries: [{ id: "f1", date: "2026-03-04", amount: 20, category: "Food", note: "lunch", createdAt: "2026-03-04T00:00:00.000Z" }],
  recurringExpenses: [], notes: [], todos: [], projects: [], todoCategories: [],
  settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // A full-backup shape: every kind at once, each one a duplicate with gaps.
  const r = await page.evaluate(() => {
    const { items } = window.LifeLogIO.buildImportItems({
      backlog: [{ title: "Hades", category: "Games", coverUrl: "https://x/h.png", externalRating: "93" }],
      entries: [{ title: "Celeste", category: "Games", year: 2026, month: 3, coverUrl: "https://x/c.png", length: "8h" }],
      financeEntries: [{ date: "2026-03-04", amount: 20, category: "Food", note: "lunch" }],
      recurringExpenses: [],
    });
    const by = {};
    for (const i of items) (by[i.kind] = by[i.kind] || []).push({ dup: i.dup, update: !!i.update, checked: i.checked, fills: (i.fills || []).map((f) => f.key) });
    return by;
  });
  check("a full backup's backlog duplicate becomes an update row",
    !!(r.backlog && r.backlog[0].update && r.backlog[0].fills.length === 2), r.backlog);
  check("so the feature is not Steam/AniList-only — every import path gets it",
    !!(r.backlog && r.backlog[0].update), r.backlog);
  // Was add-or-skip until 0.154.0; entries now get update rows of their own.
  check("a journal entry duplicate is an update row too",
    !!(r.entry && r.entry[0].dup === true && r.entry[0].update === true
       && JSON.stringify(r.entry[0].fills.sort()) === JSON.stringify(["coverUrl", "length"])), r.entry);
  check("a finance duplicate is still add-or-skip only",
    !!(r.finance && r.finance[0].dup === true && r.finance[0].update === false), r.finance);

  // An imported backlog row CAN update a journal entry it matches by title.
  const cross = await page.evaluate(() => {
    const { items } = window.LifeLogIO.buildImportItems({
      backlog: [{ title: "Celeste", category: "Games", coverUrl: "https://x/c.png", externalRating: "91" }],
    });
    const i = items.find((x) => x.kind === "backlog");
    return { update: !!i.update, targetKind: i.targetKind, targetId: i.targetId, fills: (i.fills || []).map((f) => f.key) };
  });
  check("a wishlist row matching something already in your timeline updates the entry, not the backlog",
    cross.update && cross.targetKind === "entry" && cross.targetId === "e1", cross);

  // And applying it writes to the entry in place.
  await page.evaluate(() => {
    window.LifeLogIO.reviewAndImport("x", "", window.LifeLogIO.buildImportItems({
      backlog: [{ title: "Celeste", category: "Games", coverUrl: "https://x/c.png", externalRating: "91" }],
    }));
  });
  await page.waitForSelector("#financePickerModal:not([hidden])");
  await page.evaluate(() => document.querySelector("#financePickerConfirmBtn").click());
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
    return { entryCover: (c.entries.find((e) => e.title === "Celeste") || {}).coverUrl,
      backlogTitles: c.backlog.map((b) => b.title), entryCount: c.entries.length };
  });
  check("the timeline entry got the cover", after.entryCover === "https://x/c.png", after);
  check("and nothing was added to the backlog", after.backlogTitles.length === 1 && after.entryCount === 1, after);

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
