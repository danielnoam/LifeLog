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

// Actually invisible, not merely carrying the hidden attribute. The first
// version of this asked `!t.hidden`, which is a property the app sets and
// therefore always agreed with itself — meanwhile `html:not(.force-pc) .tab
// { display: flex }` outranked the UA stylesheet's [hidden] rule and the tab
// kept its icon on the phone layout. Ask the layout, not the attribute.
const shownTabs = (page) => page.evaluate(() =>
  [...document.querySelectorAll("#viewTabs .tab")]
    .filter((t) => t.getBoundingClientRect().width > 0 && getComputedStyle(t).display !== "none")
    .map((t) => t.dataset.view));
const activeView = (page) => page.evaluate(() => {
  const t = document.querySelector("#viewTabs .tab.active");
  return t ? t.dataset.view : null;
});

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // Read off the bar rather than written down here, so adding a sixth view
  // does not fail a test about turning tabs off. The 0.171.0 habits tab broke
  // six checks that had "four" baked into them; that is a fact about the
  // tests, not about the feature.
  let ALL_VIEWS = [];

  // ---- 1. by default nothing changes ----
  {
    const { page, ctx, errs: e } = await app(browser);
    ALL_VIEWS = await page.evaluate(() =>
      [...document.querySelectorAll("#viewTabs .tab")].map((t) => t.dataset.view));
    const shown = await shownTabs(page);
    check("every tab is there when nothing is turned off",
      JSON.stringify(shown) === JSON.stringify(ALL_VIEWS) && shown.length >= 4, shown);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 2. a disabled tab leaves the bar, and the swipe skips it ----
  {
    const { page, ctx, errs: e } = await app(browser, { visual: { disabledViews: ["backlog"] } });
    const tabs = await shownTabs(page);
    check("a disabled tab is gone from the bar",
      !tabs.includes("backlog") && tabs.length === ALL_VIEWS.length - 1, tabs);
    check("and the ones left keep their order",
      JSON.stringify(tabs) === JSON.stringify(ALL_VIEWS.filter((v) => v !== "backlog")), tabs);

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

  // ---- 2b. and it is gone on the phone layout too, not just this one ----
  // The layouts style .tab differently — the mobile one sets its own display
  // — so "gone from the bar" has to be asked at both widths.
  {
    for (const [label, vp] of [["desktop 1280", { width: 1280, height: 900 }], ["phone 390", { width: 390, height: 844 }]]) {
      const c = await browser.newContext({ viewport: vp, serviceWorkers: "block" });
      const pg = await c.newPage();
      pg.on("pageerror", (x) => errs.push("pageerror: " + x.message));
      await pg.goto(BASE + "/", { waitUntil: "networkidle" });
      await pg.evaluate((s2) => {
        localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "entries" }));
        localStorage.setItem("lifelog-cache-v1", JSON.stringify(s2));
        localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ disabledViews: ["notes"] }));
        localStorage.removeItem("lifelog-github-v1");
      }, SEED);
      await pg.reload({ waitUntil: "load" });
      await pg.waitForTimeout(700);
      const seen = await pg.evaluate(() => [...document.querySelectorAll("#viewTabs .tab")]
        .filter((t) => t.getBoundingClientRect().width > 0 && getComputedStyle(t).display !== "none")
        .map((t) => t.dataset.view));
      // The icon is drawn by a ::before on the tab, so a tab that is really
      // gone takes no width at all — that is the thing to measure.
      const box = await pg.evaluate(() => {
        const t = document.querySelector('#viewTabs .tab[data-view="notes"]');
        const r = t.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(t).display };
      });
      check(`a disabled tab takes no space on ${label}`,
        !seen.includes("notes") && box.w === 0 && box.h === 0 && box.display === "none", { seen, box });
      await c.close();
    }
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
    await page.click('.srow[data-page="tabs"]');
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() => ({
      views: document.querySelectorAll("#tabToggles .tab-toggle-view").length,
      modes: document.querySelectorAll("#tabToggles .tab-toggle-modes .toggle-label").length,
    }));
    // Counted off the app rather than written down, for the same reason the
    // tab list is: "9" was right until Notes grew a third mode.
    const expected = await page.evaluate(() =>
      [...document.querySelectorAll("#viewTabs .tab")]
        .reduce((n, t) => n + t.querySelectorAll(".tab-mode-dot").length, 0));
    check("every tab gets a switch, and every mode one under it",
      rows.views === ALL_VIEWS.length && rows.modes === expected && expected >= 8,
      { ...rows, tabs: ALL_VIEWS.length, expected });

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

    // The last one standing can't be turned off — try to switch off every
    // remaining one and see how many actually go.
    for (let i = 0; i < ALL_VIEWS.length; i++) {
      await page.evaluate(() => {
        const row = [...document.querySelectorAll("#tabToggles .tab-toggle-view")]
          .find((l) => l.querySelector("input").checked);
        if (row) row.querySelector("input").click();
      });
      await page.waitForTimeout(250);
    }
    const left = await page.evaluate(() => (JSON.parse(localStorage.getItem("lifelog-visual-settings-v1")).disabledViews || []).length);
    check("you cannot turn off the last tab", left === ALL_VIEWS.length - 1, { left, of: ALL_VIEWS.length });
    check("so one tab is still on screen", (await shownTabs(page)).length === 1, await shownTabs(page));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 6b. nothing anywhere else offers a tab you turned off ----
  // 0.168.0 only took the tab out of the bar. A disabled Ledger still had
  // "Add finance entry" in the + menu, a row in the keyboard cheat sheet and
  // a spending slide in the Recap — all of them ways in to a tab that isn't
  // there.
  {
    const { page, ctx, errs: e } = await app(browser, {
      visual: { disabledViews: ["finance"], disabledModes: { notes: ["todo"] } },
    });

    await page.click("#addBtn");
    await page.waitForTimeout(250);
    const menu = await page.evaluate(() => [...document.querySelectorAll("#addMenu button")]
      .filter((b) => !b.hidden).map((b) => b.dataset.add));
    check("the + menu drops the items that file into a disabled tab",
      !menu.includes("finance") && !menu.includes("recurring"), menu);
    check("and keeps the rest", menu.includes("entry") && menu.includes("note") && menu.includes("backlog"), menu);
    check("the divider that headed the dropped group goes with it",
      await page.evaluate(() => document.querySelector("#addMenu .menu-pop-divider").hidden === true));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    await page.keyboard.press("?");
    await page.waitForSelector("#shortcutsModal:not([hidden])", { timeout: 5000 });
    const sheet = await page.evaluate(() => document.querySelector(".shortcuts-list").innerText);
    check("the cheat sheet doesn't list a key for a disabled tab", !/Ledger/.test(sheet), sheet.replace(/\s+/g, " "));
    check("it still lists the tabs you kept", /Notes/.test(sheet) && /Timeline/.test(sheet) && /Backlog/.test(sheet), sheet.replace(/\s+/g, " "));
    check("and the Shift row names only second modes that still exist",
      /Stats/.test(sheet) && !/To-do/.test(sheet) && !/Summary/.test(sheet), sheet.replace(/\s+/g, " "));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 6c. and neither does the Recap ----
  {
    const seed = {
      ...SEED,
      financeEntries: [{ id: "f1", title: "Coffee", amount: 99, category: "Food", date: "2026-03-02", updatedAt: "2026-01-01T00:00:00.000Z" }],
      entries: Array.from({ length: 5 }, (_, i) => ({
        id: "e" + i, title: "Game " + i, category: "Games", year: 2026, month: 1 + i,
        date: "2026-0" + (1 + i), rating: 5, createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" })),
    };
    const ctx2 = await browser.newContext({ viewport: { width: 460, height: 1100 }, serviceWorkers: "block" });
    const page = await ctx2.newPage();
    const e2 = [];
    page.on("pageerror", (x) => e2.push("pageerror: " + x.message));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate((s) => {
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "stats" }));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ disabledViews: ["finance"] }));
      localStorage.removeItem("lifelog-github-v1");
    }, seed);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".recap-open-btn", { timeout: 8000 });
    await page.click(".recap-open-btn");
    await page.waitForSelector("#recapScreen:not([hidden])", { timeout: 5000 });
    let text = "";
    for (let i = 0; i < 20; i++) {
      if (await page.isHidden("#recapScreen")) break;
      text += " " + (await page.evaluate(() => document.querySelector("#recapStage").innerText));
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(130);
    }
    check("the Recap has no slide about a tab you turned off", !/99|spent across/.test(text), text.replace(/\s+/g, " ").slice(0, 120));
    check("and still recaps the ones you kept", /things logged/.test(text), text.replace(/\s+/g, " ").slice(0, 120));
    errs.push(...e2);
    await ctx2.close();
  }

  // ---- 6d. and no cell offers a jump into a mode that isn't there ----
  {
    const seed = { ...SEED, entries: Array.from({ length: 4 }, (_, i) => ({
      id: "e" + i, title: "Game " + i, category: "Games", year: 2026, month: 1 + i,
      date: "2026-0" + (1 + i), rating: 4, createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" })) };
    const mk = async (visual) => {
      const c = await browser.newContext({ viewport: { width: 460, height: 1100 }, serviceWorkers: "block" });
      const pg = await c.newPage();
      pg.on("pageerror", (x) => errs.push("pageerror: " + x.message));
      await pg.goto(BASE + "/", { waitUntil: "networkidle" });
      await pg.evaluate(({ s2, v }) => {
        localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "stats" }));
        localStorage.setItem("lifelog-cache-v1", JSON.stringify(s2));
        localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v));
        localStorage.removeItem("lifelog-github-v1");
      }, { s2: seed, v: visual });
      await pg.reload({ waitUntil: "load" });
      await pg.waitForSelector(".card", { timeout: 8000 });
      return { c, pg };
    };
    const a = await mk({});
    const withEntries = await a.pg.evaluate(() => document.querySelectorAll(".heat-cell.is-clickable, .is-clickable").length);
    await a.c.close();
    const b2 = await mk({ disabledModes: { timeline: ["entries"] } });
    const withoutEntries = await b2.pg.evaluate(() => document.querySelectorAll(".heat-cell.is-clickable, .is-clickable").length);
    await b2.c.close();
    check("Stats' heatmap offers its jump only while there is an Entries mode to jump to",
      withEntries > 0 && withoutEntries === 0, { withEntries, withoutEntries });
  }

  // ---- 7. a hand-edited file that turns everything off is survivable ----
  {
    const { page, ctx, errs: e } = await app(browser, { visual: { disabledViews: ALL_VIEWS } });
    check("disabling every tab falls back to all of them rather than bricking",
      (await shownTabs(page)).length === ALL_VIEWS.length, await shownTabs(page));
    errs.push(...e);
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
