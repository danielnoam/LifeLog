// Turning tabs and modes off (0.168.0). The feature is small; what it can
// break is not — the tab bar, the swipe, the mode fan and dots, the search
// badges, the keyboard shortcuts and where the app opens all assumed every
// view existed. The trap this suite exists for is the last one: turning off
// the tab you were last on must not open the app on a blank page.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  entries: [{ id: "e1", title: "Thing", category: "Games", year: 2026, month: 3, date: "2026-03",
    rating: 4, createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" }],
  backlog: [{ id: "b1", title: "Later", category: "Games", releaseStatus: "released",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
  notes: [{ id: "n1", text: "A note about Thing", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" }],
  todos: [{ id: "t1", text: "Thing to do", order: 0, createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" }],
  todoCategories: [], projects: [],
  financeEntries: [{ id: "f1", title: "Thing bought", amount: 4, category: "Food", date: "2026-03-02", updatedAt: "2026-01-01T00:00:00.000Z" }],
  recurringExpenses: [],
  financeCategories: [{ id: "food", name: "Food", color: "#4bc46a", updatedAt: "2026-01-01T00:00:00.000Z" }],
  settings: { currency: "ILS" },
};

async function app(browser, { ui, visual } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1100 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(({ s, u, v }) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify(u || { view: "timeline", timelineMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
    localStorage.removeItem("lifelog-github-v1");
    if (v) localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v));
    else localStorage.removeItem("lifelog-visual-settings-v1");
  }, { s: SEED, u: ui, v: visual });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(600);
  return { page, ctx, errs };
}

const shownTabs = (page) => page.evaluate(() =>
  [...document.querySelectorAll("#viewTabs .tab")].filter((t) => !t.hidden).map((t) => t.dataset.view));
const activeView = (page) => page.evaluate(() => {
  const t = document.querySelector("#viewTabs .tab.active");
  return t ? t.dataset.view : null;
});

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // ---- 1. by default nothing changes ----
  {
    const { page, ctx, errs: e } = await app(browser);
    check("all four tabs are there when nothing is turned off",
      JSON.stringify(await shownTabs(page)) === JSON.stringify(["notes", "timeline", "backlog", "finance"]),
      await shownTabs(page));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 2. a disabled tab leaves the bar, and the swipe skips it ----
  {
    const { page, ctx, errs: e } = await app(browser, { visual: { disabledViews: ["backlog"] } });
    const tabs = await shownTabs(page);
    check("a disabled tab is gone from the bar", !tabs.includes("backlog") && tabs.length === 3, tabs);
    check("and the ones left keep their order",
      JSON.stringify(tabs) === JSON.stringify(["notes", "timeline", "finance"]), tabs);

    // Timeline → swipe left should land on Finance, not the disabled Backlog.
    // attachSwipe listens on pointer events, not touch, and only in the
    // mobile layout — so this is a real drag across the bar.
    await page.evaluate(() => {
      const r = document.querySelector("#viewTabs").getBoundingClientRect();
      window.__bar = { y: r.top + r.height / 2 };
    });
    const bar = await page.evaluate(() => window.__bar);
    await page.mouse.move(340, bar.y);
    await page.mouse.down();
    await page.mouse.move(280, bar.y, { steps: 4 });
    await page.mouse.move(150, bar.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    check("swiping past a disabled tab lands on the next enabled one",
      (await activeView(page)) === "finance", await activeView(page));

    check("the search badges skip it too", await page.evaluate(() => {
      const s = document.querySelector("#search");
      s.value = "Thing"; s.oninput({ target: s });
      return true;
    }));
    await page.waitForTimeout(400);
    const badged = await page.evaluate(() =>
      [...document.querySelectorAll("#viewTabs .tab")].filter((t) => t.querySelector(".tab-match-badge")).map((t) => t.dataset.view));
    check("no disabled tab gets a match badge", !badged.includes("backlog"), badged);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 3. THE TRAP: opening on a tab you have since turned off ----
  {
    const { page, ctx, errs: e } = await app(browser, {
      ui: { view: "backlog", backlogMode: "entries" },
      visual: { disabledViews: ["backlog"] },
    });
    const v = await activeView(page);
    check("opening on a disabled tab falls back to the first enabled one", v === "notes", v);
    check("and the page is not blank", await page.evaluate(() => document.querySelector("#viewBody").children.length > 0));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 4. modes ----
  {
    const { page, ctx, errs: e } = await app(browser, {
      ui: { view: "timeline", timelineMode: "entries" },
      visual: { disabledModes: { timeline: ["stats"] } },
    });
    const dots = await page.evaluate(() =>
      document.querySelectorAll('#viewTabs .tab[data-view="timeline"] .tab-mode-dot').length);
    check("a tab with one mode left shows one dot, not two", dots === 1, dots);

    // Shift+2 asks for Timeline's second mode, which no longer exists.
    await page.keyboard.press("Shift+Digit2");
    await page.waitForTimeout(400);
    const mode = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-ui-v1")).timelineMode);
    check("the shortcut for a disabled mode leaves you where you are", mode === "entries", mode);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 5. opening in a mode you have since turned off ----
  {
    const { page, ctx, errs: e } = await app(browser, {
      ui: { view: "timeline", timelineMode: "stats" },
      visual: { disabledModes: { timeline: ["stats"] } },
    });
    // Read what is on screen, not what localStorage holds: saveUiState only
    // runs on a change, so the file still says "stats" until something moves.
    const shown = await page.evaluate(() => ({
      entries: !!document.querySelector(".entry"),
      statsCard: !!document.querySelector(".yir-card"),
      dots: document.querySelectorAll('#viewTabs .tab[data-view="timeline"] .tab-mode-dot').length,
    }));
    check("a disabled mode falls back to the first one that's left",
      shown.entries && !shown.statsCard && shown.dots === 1, shown);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 6. the settings switches ----
  {
    const { page, ctx, errs: e } = await app(browser);
    await page.click("#settingsBtn");
    await page.waitForSelector("#settingsModal:not([hidden])", { timeout: 5000 });
    await page.click('.settings-tab[data-panel="appearance"], nav.settings-tabs button:has-text("Appearance")').catch(() => {});
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() => ({
      views: document.querySelectorAll("#tabToggles .tab-toggle-view").length,
      modes: document.querySelectorAll("#tabToggles .tab-toggle-modes .toggle-label").length,
    }));
    check("every tab gets a switch, and every mode one under it", rows.views === 4 && rows.modes === 9, rows);

    // Turn Backlog off through the real control.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("#tabToggles .tab-toggle-view")].find((l) => /Backlog/.test(l.textContent));
      row.querySelector("input").click();
    });
    await page.waitForTimeout(500);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-visual-settings-v1")).disabledViews);
    check("the switch stores it", JSON.stringify(stored) === JSON.stringify(["backlog"]), stored);
    check("and its modes grey out rather than vanishing", await page.evaluate(() => {
      const wrap = [...document.querySelectorAll("#tabToggles .tab-toggle-view")].find((l) => /Backlog/.test(l.textContent));
      const sub = wrap.nextElementSibling;
      return sub.querySelectorAll("input").length === 3 && [...sub.querySelectorAll("input")].every((i) => i.disabled);
    }));

    // The last one standing can't be turned off.
    for (const name of ["Notes", "Timeline", "Ledger"]) {
      await page.evaluate((n) => {
        const row = [...document.querySelectorAll("#tabToggles .tab-toggle-view")].find((l) => l.textContent.includes(n));
        if (row && row.querySelector("input").checked) row.querySelector("input").click();
      }, name);
      await page.waitForTimeout(300);
    }
    const left = await page.evaluate(() => (JSON.parse(localStorage.getItem("lifelog-visual-settings-v1")).disabledViews || []).length);
    check("you cannot turn off the last tab", left === 3, left);
    check("so one tab is still on screen", (await shownTabs(page)).length === 1, await shownTabs(page));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 7. a hand-edited file that turns everything off is survivable ----
  {
    const { page, ctx, errs: e } = await app(browser, {
      visual: { disabledViews: ["notes", "timeline", "backlog", "finance"] },
    });
    check("disabling every tab falls back to all of them rather than bricking",
      (await shownTabs(page)).length === 4, await shownTabs(page));
    errs.push(...e);
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
