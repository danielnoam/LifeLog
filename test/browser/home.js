// The Home tab (0.306.0): first on a computer and in the middle of a phone's
// bar, a fresh start lands on
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

  check("on a computer Home is the first tab", JSON.stringify(bar) === JSON.stringify(["home", "notes", "timeline", "backlog", "finance"]), bar);
  check("a fresh start opens on Home, not the last tab", (await active()) === "home", await active());
  check("Home has no filter chips", await page.isHidden("#filterbar"));
  const heads = await page.evaluate(() => [...document.querySelectorAll(".home-sec-head h2")].map((h) => h.textContent.trim()));
  check("its sections, in the default order", JSON.stringify(heads) === JSON.stringify(["In progress", "Coming up", "Scratchpad", "Pinned notes", "Ledger", "Investments"]), heads);
  const row = await page.evaluate(() => {
    const floors = [...document.querySelectorAll(".home-floor")].map((f) => [...f.children].map((c) => c.dataset.sec));
    const tops = [".home-upcoming", ".home-scratch", ".home-pinned", ".home-ledger"].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top));
    return { floors, tops };
  });
  // Four halves in a row go two by two, not three and a lone one.
  check("Coming up, Scratchpad, Pinned notes and Ledger sit two by two on a computer", JSON.stringify(row.floors) === JSON.stringify([["progress"], ["upcoming", "scratchpad"], ["pinned", "ledger"], ["invest"]])
    && row.tops[0] === row.tops[1] && row.tops[2] === row.tops[3] && row.tops[2] > row.tops[0], row);
  const ledger = await page.evaluate(() => ({ total: (document.querySelector(".home-ledger-total") || {}).textContent || "", text: document.querySelector(".home-ledger").textContent }));
  check("the Ledger card shows this month so far, and says when nothing's been spent yet", /\d/.test(ledger.total) && ledger.text.includes("No expenses yet this month") && ledger.text.includes("Add expense"), ledger);
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
  await page.click('.home-scratch button:has-text("Save to Notebook")'); await page.waitForTimeout(500);
  const made = await page.evaluate(() => { const d = window.LifeLogStorage.cachedCopy(); return { pad: d.settings.scratchpad, note: (d.notes.find((n) => n.text === "Buy stamps") || {}).id }; });
  check("Save to Notebook turns it into a note and clears the scratchpad", !!made.note && made.pad === undefined && (await page.inputValue("#homeScratchpad")) === "", made);

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
  check("View lists the six sections", (await page.$$("#homeSectionRows .home-sec-row")).length === 6);
  await page.click('#homeSectionRows .home-sec-row:has-text("Pinned notes") [aria-label="Move Pinned notes up"]'); await page.waitForTimeout(200);
  await page.click('#homeSectionRows [aria-label="Show In progress"]'); await page.waitForTimeout(200);
  await page.click('#homeSectionRows [aria-label="Show Ledger"]'); await page.waitForTimeout(200);
  await page.click('#homeSectionRows [aria-label="Show Investments"]'); await page.waitForTimeout(200);
  await page.click("#closeViewOptionsBtn"); await page.waitForTimeout(300);
  const floorsNow = () => page.evaluate(() => [...document.querySelectorAll(".home-floor")].map((f) => [...f.children].map((c) => c.dataset.sec)));
  const after = await floorsNow();
  check("moving Pinned notes up swaps it with Scratchpad, and hiding In progress, Ledger and Investments leaves their floors", JSON.stringify(after) === JSON.stringify([["upcoming", "pinned"], ["scratchpad"]]), after);
  let vis = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-visual-settings-v1")));
  check("and is kept for this device", JSON.stringify(vis.homeFloors) === JSON.stringify([["upcoming", "pinned"], ["scratchpad"]]) && vis.homeHidden.join() === "progress,ledger,invest", vis);

  // ---- arranging by dragging a heading ----
  const dragHead = async (from, to) => {
    const h = await page.$(`.home-sec[data-sec="${from}"] .home-sec-head h2`);
    const a = await h.boundingBox();
    await page.mouse.move(a.x + 10, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 30, a.y + 20, { steps: 3 });
    const b = await to();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.waitForTimeout(100);
    const during = await page.evaluate(() => ({ ghost: !!document.querySelector(".home-ghost"), slot: document.querySelector(".home-sec.is-slot")?.dataset.sec || "", pushed: document.querySelector(".home-sec.is-pushed")?.dataset.sec || "" }));
    await page.mouse.up();
    await page.waitForTimeout(300);
    return during;
  };
  const box = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
  check("hovering a section outlines it", await page.evaluate(() => document.querySelector(".home").classList.contains("can-arrange")));
  let d = await dragHead("scratchpad", async () => { const r = await box('.home-sec[data-sec="upcoming"]'); return { x: r.left + 20, y: r.top + 60 }; });
  check("dragging Scratchpad shows a copy and a slot where it lands", d.ghost && d.slot === "scratchpad", d);
  check("and dropping it left of Coming up puts it first in that floor; the empty floor goes", JSON.stringify(await floorsNow()) === JSON.stringify([["scratchpad", "upcoming", "pinned"]]), await floorsNow());
  const tops = await page.evaluate(() => [...document.querySelectorAll(".home-floor > .home-sec")].map((s) => Math.round(s.getBoundingClientRect().top)));
  check("the three share the floor's width", new Set(tops).size === 1, tops);
  d = await dragHead("pinned", async () => { const r = await box(".home-floor"); return { x: r.left + 200, y: r.bottom + 6 }; });
  check("dropping below the last floor starts a new one", JSON.stringify(await floorsNow()) === JSON.stringify([["scratchpad", "upcoming"], ["pinned"]]), await floorsNow());
  await page.click("#viewOptionsBtn"); await page.waitForTimeout(300);
  await page.click('#homeSectionRows [aria-label="Show Ledger"]'); await page.waitForTimeout(200);
  await page.click("#closeViewOptionsBtn"); await page.waitForTimeout(300);
  check("a section shown again gets a floor at the bottom", JSON.stringify(await floorsNow()) === JSON.stringify([["scratchpad", "upcoming"], ["pinned"], ["ledger"]]), await floorsNow());
  await dragHead("ledger", async () => { const r = await box('.home-sec[data-sec="upcoming"]'); return { x: r.right - 20, y: r.top + 60 }; });
  check("a floor takes a third section while each still gets 380px", JSON.stringify(await floorsNow()) === JSON.stringify([["scratchpad", "upcoming", "ledger"], ["pinned"]]), await floorsNow());
  d = await dragHead("pinned", async () => { const r = await box('.home-sec[data-sec="scratchpad"]'); return { x: r.left + 20, y: r.top + 60 }; });
  check("over a full floor, its last section is marked to move down", d.pushed === "ledger", d);
  check("and dropping pushes it to a floor of its own below", JSON.stringify(await floorsNow()) === JSON.stringify([["pinned", "scratchpad", "upcoming"], ["ledger"]]), await floorsNow());
  check("with a toast saying so", (await page.textContent("#toast").catch(() => "")).includes("Ledger moved down"), await page.textContent("#toast").catch(() => ""));
  await page.keyboard.press("Escape");
  const h = await (await page.$('.home-sec[data-sec="ledger"] .home-sec-head h2')).boundingBox();
  await page.mouse.move(h.x + 10, h.y + 5); await page.mouse.down(); await page.mouse.move(h.x + 40, h.y - 300, { steps: 6 });
  await page.keyboard.press("Escape"); await page.mouse.up(); await page.waitForTimeout(300);
  check("Esc mid-drag puts everything back", JSON.stringify(await floorsNow()) === JSON.stringify([["pinned", "scratchpad", "upcoming"], ["ledger"]]) && !(await page.$(".home-ghost")), await floorsNow());
  await page.click("#viewOptionsBtn"); await page.waitForTimeout(300);
  await page.click("#homeResetLayoutBtn"); await page.waitForTimeout(300);
  await page.click("#closeViewOptionsBtn"); await page.waitForTimeout(300);
  check("Reset layout brings back the default floors and every section", JSON.stringify(await floorsNow()) === JSON.stringify([["progress"], ["upcoming", "scratchpad"], ["pinned", "ledger"], ["invest"]]), await floorsNow());

  // ---- the scratchpad as a board ----
  const padH = await page.evaluate(() => document.querySelector(".home-scratch .home-card").offsetHeight);
  await page.click('.home-pad-mode .seg-btn[data-mode="board"]'); await page.waitForTimeout(500);
  const boardH = await page.evaluate(() => document.querySelector(".home-scratch .home-card").offsetHeight);
  check("the board card is as tall as the note card", Math.abs(padH - boardH) <= 1, { padH, boardH });
  check("Board swaps the text pad for the scratch board", (await page.$("#homeScratchpad")) === null && (await page.textContent("#homeScratchBoard")).includes("Nothing drawn yet"));
  check("and is remembered for this device", await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-visual-settings-v1")).homeScratchMode) === "board");
  await page.click("#homeScratchBoard"); await page.waitForTimeout(500);
  check("tapping it opens the board editor", !(await page.isHidden("#boardEditor")));
  await page.evaluate(() => { const b = window.LifeLogBoards.scratchBoard(); b.elements.push({ id: "s1", t: "text", c: "ink", sw: 2, x: 0, y: 0, text: "Desk by the window" }); });
  await page.click("#boardBack"); await page.waitForTimeout(500);
  const sb = await page.evaluate(() => ({ scratch: !!(window.LifeLogBoards.scratchBoard() || {}).scratch, listed: window.LifeLogBoards.boardsNow().length, thumb: !!document.querySelector("#homeScratchBoard svg") }));
  check("the drawing shows on Home, and stays out of the Boards list", sb.scratch && sb.listed === 0 && sb.thumb, sb);
  await page.click('.home-scratch button:has-text("Save to Notebook")'); await page.waitForTimeout(500);
  const kept = await page.evaluate(() => ({ scratch: window.LifeLogBoards.scratchBoard(), listed: window.LifeLogBoards.boardsNow().map((b) => b.elements.length) }));
  check("in Board, Save to Notebook files it and leaves a blank one", kept.scratch === null && JSON.stringify(kept.listed) === "[1]" && (await page.textContent("#homeScratchBoard")).includes("Nothing drawn yet"), kept);
  await page.click('.home-pad-mode .seg-btn[data-mode="note"]'); await page.waitForTimeout(400);
  check("Note brings the text pad back", (await page.$("#homeScratchpad")) !== null);
  const rowHeads = await page.evaluate(() => [...document.querySelector(".home-scratch").parentElement.querySelectorAll(".home-sec-head")].map((h) => Math.round(h.getBoundingClientRect().height)));
  check("the switch doesn't make the Scratchpad head taller than its neighbours", rowHeads.length > 1 && rowHeads.every((h) => h === rowHeads[0]), rowHeads);

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
  check("on a phone Home sits in the middle of the bottom bar", await pp.evaluate(() => [...document.querySelectorAll("#viewTabs .tab")].filter((t) => !t.hidden).map((t) => t.dataset.view).join()) === "notes,timeline,home,backlog,finance");
  check("on a phone the sections stack", await pp.evaluate(() => {
    const a = document.querySelector(".home-upcoming").getBoundingClientRect(), s = document.querySelector(".home-scratch").getBoundingClientRect(), p = document.querySelector(".home-pinned").getBoundingClientRect();
    return s.top >= a.bottom - 1 && p.top >= s.bottom - 1 && Math.abs(a.left - s.left) < 2 && Math.abs(a.left - p.left) < 2;
  }));
  check("and nothing is wider than the screen", await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await phone.close();

  check("no errors", errs.length === 0, errs);
  await ctx.close();
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
