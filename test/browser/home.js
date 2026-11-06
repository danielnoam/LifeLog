// The Home tab (0.306.0): in the middle of the bar, a fresh start lands on
// it, its sections, the scratchpad, pinned notes, and the View sheet's order.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const T = "2026-01-01T00:00:00.000Z";
const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }, { id: "shows", name: "Shows", color: "#c061cb" }],
  entries: [],
  backlog: [
    { id: "p1", title: "Playing Now", category: "Games", startedAt: day(-2), createdAt: T, updatedAt: T },
    { id: "r1", title: "Comes Out Soon", category: "Games", releaseDate: day(3), releasePrecision: "day", createdAt: T, updatedAt: T },
    { id: "e1", title: "Weekly Show", category: "Shows", nextAt: day(1), nextLabel: "S1 E4", releaseDate: "2025-01-01", createdAt: T, updatedAt: T },
  ],
  notes: [
    { id: "n1", title: "Pinned idea", text: "Keep this in view", pinned: true, createdAt: T, updatedAt: T },
    { id: "n2", title: "Plain note", text: "Not pinned", createdAt: T, updatedAt: T },
  ],
  habits: [], todos: [], financeEntries: [],
  recurringExpenses: [{ id: "c1", startDate: day(2), interval: "monthly", amount: 9.99, category: "Subscriptions", note: "Music", createdAt: T, updatedAt: T }],
  projects: [], todoCategories: [], financeCategories: [{ id: "f1", name: "Subscriptions", color: "#334455" }], settings: { currency: "USD" },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  // Seeded before the app's first load, so this load is a fresh start.
  await ctx.addInitScript((seed) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ outTodaySheet: "hide" }));
  }, SEED);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const active = () => page.evaluate(() => document.querySelector("#viewTabs .tab.active").dataset.view);
  const bar = await page.evaluate(() => [...document.querySelectorAll("#viewTabs .tab")].filter((t) => !t.hidden).map((t) => t.dataset.view));

  check("Home sits in the middle of the bar", JSON.stringify(bar) === JSON.stringify(["notes", "timeline", "home", "backlog", "finance"]), bar);
  check("a fresh start opens on Home, not the last tab", (await active()) === "home", await active());
  check("Home has no filter chips", await page.isHidden("#filterbar"));
  const heads = await page.evaluate(() => [...document.querySelectorAll(".home-sec-head h2")].map((h) => h.textContent.trim()));
  check("its sections, in the default order", JSON.stringify(heads) === JSON.stringify(["In progress", "Coming up", "Scratchpad", "Pinned notes"]), heads);
  check("Coming up and Scratchpad share a row on a computer", await page.evaluate(() => !!document.querySelector(".home-pair .home-upcoming") && !!document.querySelector(".home-pair .home-scratch")));
  check("in progress shows what's started", (await page.textContent(".home-progress")).includes("Playing Now"));
  const rows = await page.evaluate(() => [...document.querySelectorAll(".home-upcoming .home-row-title")].map((r) => r.textContent));
  check("coming up lists the episode, the charge and the release, soonest first", JSON.stringify(rows) === JSON.stringify(["Weekly Show", "Music", "Comes Out Soon"]), rows);
  check("a charge shows its amount", (await page.textContent(".home-upcoming .home-row-end.is-money")).includes("9.99"));
  check("only the pinned note is on Home", await page.evaluate(() => [...document.querySelectorAll(".home-pinned .note-card")].map((c) => c.dataset.id).join()) === "n1");

  await page.click('.home-upcoming .home-row:has-text("Comes Out Soon")'); await page.waitForTimeout(400);
  check("a release opens its backlog sheet", !(await page.isHidden("#backlogModal")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  // ---- the scratchpad ----
  await page.fill("#homeScratchpad", "Buy stamps");
  await page.waitForTimeout(1100);
  check("the scratchpad saves as you type, into the synced settings", await page.evaluate(() => window.LifeLogStorage.cachedCopy().settings.scratchpad) === "Buy stamps");
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(600);
  check("a reload stays where you were (Home here) and keeps the text", (await active()) === "home" && (await page.inputValue("#homeScratchpad")) === "Buy stamps");
  await page.click('#viewTabs .tab[data-view="backlog"]'); await page.waitForTimeout(400);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(600);
  check("a reload on another tab stays on it", (await active()) === "backlog", await active());
  await page.click('#viewTabs .tab[data-view="home"]'); await page.waitForTimeout(400);
  await page.click('.home-scratch button:has-text("Make a note")'); await page.waitForTimeout(500);
  const made = await page.evaluate(() => { const d = window.LifeLogStorage.cachedCopy(); return { pad: d.settings.scratchpad, note: (d.notes.find((n) => n.text === "Buy stamps") || {}).id }; });
  check("Make a note turns it into a note and clears the scratchpad", !!made.note && made.pad === undefined && (await page.inputValue("#homeScratchpad")) === "", made);

  // ---- pinning from a note's ⋯ menu ----
  await page.evaluate(() => window.LifeLogNotes.openNote(window.LifeLogStorage.cachedCopy().notes.find((n) => n.id === "n2")));
  await page.waitForTimeout(400);
  if (!(await page.isHidden("#noteReader"))) { await page.click("#editNoteReaderBtn"); await page.waitForTimeout(400); }
  await page.click("#noteMoreBtn"); await page.waitForTimeout(200);
  check("a saved note's ⋯ menu offers Pin to Home", (await page.textContent("#notePinBtn")).includes("Pin to Home"));
  await page.click("#notePinBtn"); await page.waitForTimeout(400);
  check("and pinning it saves at once", await page.evaluate(() => window.LifeLogStorage.cachedCopy().notes.find((n) => n.id === "n2").pinned) === true);
  await page.click("#cancelNoteBtn"); await page.waitForTimeout(400);
  check("Home shows it with the other pinned note", (await page.$$(".home-pinned .note-card")).length === 2);

  // ---- the View sheet ----
  await page.click("#viewOptionsBtn"); await page.waitForTimeout(300);
  check("View lists the four sections", (await page.$$("#homeSectionRows .home-sec-row")).length === 4);
  await page.click('#homeSectionRows .home-sec-row:has-text("Pinned notes") [aria-label="Move Pinned notes up"]'); await page.waitForTimeout(200);
  await page.click('#homeSectionRows .home-sec-row:has-text("Pinned notes") [aria-label="Move Pinned notes up"]'); await page.waitForTimeout(200);
  await page.click('#homeSectionRows .home-sec-row:has-text("Pinned notes") [aria-label="Move Pinned notes up"]'); await page.waitForTimeout(200);
  await page.click('#homeSectionRows [aria-label="Show In progress"]'); await page.waitForTimeout(200);
  await page.click("#closeViewOptionsBtn"); await page.waitForTimeout(300);
  const after = await page.evaluate(() => [...document.querySelectorAll(".home-sec-head h2")].map((h) => h.textContent.trim()));
  check("moving Pinned notes to the top and hiding In progress redraws Home", JSON.stringify(after) === JSON.stringify(["Pinned notes", "Coming up", "Scratchpad"]), after);
  const vis = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-visual-settings-v1")));
  check("and is kept for this device", JSON.stringify(vis.homeSections) === JSON.stringify(["pinned", "progress", "upcoming", "scratchpad"]) && vis.homeHidden.join() === "progress", vis);

  // ---- turned off ----
  await page.evaluate(() => {
    const v = JSON.parse(localStorage.getItem("lifelog-visual-settings-v1"));
    v.disabledViews = ["travel", "home"];
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v));
    sessionStorage.removeItem("lifelog-started");
  });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(600);
  check("turned off in Settings → Tabs, it leaves the bar and a fresh start stays put",
    (await page.isHidden('#viewTabs .tab[data-view="home"]')) && (await active()) !== "home", await active());

  // ---- a phone ----
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await phone.addInitScript((seed) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ outTodaySheet: "hide" }));
  }, SEED);
  const pp = await phone.newPage();
  pp.on("pageerror", (e) => errs.push("phone pageerror: " + e.message));
  await pp.goto(BASE + "/", { waitUntil: "networkidle" }); await pp.waitForTimeout(600);
  check("on a phone the sections stack", await pp.evaluate(() => {
    const a = document.querySelector(".home-upcoming").getBoundingClientRect(), s = document.querySelector(".home-scratch").getBoundingClientRect();
    return s.top >= a.bottom - 1 && Math.abs(a.left - s.left) < 2;
  }));
  check("and nothing is wider than the screen", await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await phone.close();

  check("no errors", errs.length === 0, errs);
  await ctx.close();
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
