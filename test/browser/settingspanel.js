// The Settings rework (0.169.0). Appearance had grown to ten equal-weight
// sections, so the two things you change were buried among the ones you set
// once. What this suite guards is that the reorganisation moved controls
// rather than losing them, and that each one still does what it did.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

// Every control the two panels are responsible for, and the visual-settings
// key it writes. currency is the odd one out: it is app data and it syncs.
const CONTROLS = [
  ["themeSelect", "theme", "nord"],
  ["fontFamily", "fontFamily", "serif"],
  ["forceLayout", "forceLayout", "mobile"],
  ["timelineCoverSize", "timelineCoverSize", "none"],
  ["backlogCoverSize", "backlogCoverSize", "small"],
  ["backlogCounts", "backlogCounts", "total"],
  ["backlogFoldEa", "backlogFoldEa", "always"],
  ["backlogFoldUnreleased", "backlogFoldUnreleased", "collapsed"],
  ["backlogFoldDropped", "backlogFoldDropped", "always"],
  ["backlogSummaries", "backlogSummaries", "hide"],
  ["ledgerMonthSummary", "ledgerMonthSummary", "hide"],
  ["timelineMonthSummary", "timelineMonthSummary", "show"],
];

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  entries: [{ id: "e1", title: "Thing", category: "Games", year: 2026, month: 3, date: "2026-03",
    rating: 4, createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" }],
  backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [],
  financeCategories: [{ id: "food", name: "Food", color: "#4bc46a", updatedAt: "2026-01-01T00:00:00.000Z" }],
  settings: { currency: "ILS" },
};

async function open(browser, vp) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((s) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
    localStorage.removeItem("lifelog-visual-settings-v1");
    localStorage.removeItem("lifelog-github-v1");
  }, SEED);
  await page.reload({ waitUntil: "load" });
  await page.click("#settingsBtn");
  await page.waitForSelector("#settingsModal:not([hidden])", { timeout: 6000 });
  return { page, ctx, errs };
}

const panelOf = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  const panel = el && el.closest(".settings-panel");
  return panel ? panel.dataset.panel : null;
}, id);

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const { page, ctx, errs: e } = await open(browser, { width: 1280, height: 900 });
  errs.push(...e);

  // ---- 1. nothing was lost in the move ----
  const missing = [];
  for (const [id] of CONTROLS) if (!(await page.evaluate((i) => !!document.getElementById(i), id))) missing.push(id);
  check("every control still exists after the reshuffle", !missing.length, missing);

  const counts = await page.evaluate(() => {
    const per = {};
    document.querySelectorAll(".settings-panel").forEach((p) => {
      per[p.dataset.panel] = p.querySelectorAll("section.settings-section").length;
    });
    return per;
  });
  check("Appearance is no longer a ten-section dumping ground", counts.appearance <= 4, counts);
  check("and the per-view settings have a panel of their own", counts.views >= 3, counts);

  // ---- 2. each control is where a person would look for it ----
  const homes = {};
  for (const [id] of CONTROLS.concat([["currency"]])) homes[id] = await panelOf(page, id);
  check("what the whole app looks like stayed in Appearance",
    homes.themeSelect === "appearance" && homes.fontFamily === "appearance" && homes.forceLayout === "appearance", homes);
  check("everything that changes one list moved to Views",
    ["timelineCoverSize", "timelineMonthSummary", "backlogCoverSize", "backlogCounts",
     "backlogFoldEa", "backlogFoldUnreleased", "backlogFoldDropped", "backlogSummaries",
     "ledgerMonthSummary", "currency"].every((k) => homes[k] === "views"), homes);
  check("and the Backlog's four settings are in one group, not four sections",
    await page.evaluate(() => {
      const sec = document.getElementById("backlogFoldEa").closest("section");
      return ["backlogCoverSize", "backlogCounts", "backlogSummaries", "backlogFoldUnreleased", "backlogFoldDropped"]
        .every((i) => sec.contains(document.getElementById(i)));
    }));

  // ---- 3. the force-layout override is folded away, not deleted ----
  check("force layout sits behind a disclosure rather than as a peer row",
    await page.evaluate(() => !!document.getElementById("forceLayout").closest("details.settings-advanced")));

  // ---- 4. the new tab is reachable and the panels still switch ----
  const tabs = await page.evaluate(() => [...document.querySelectorAll(".stab")].map((t) => t.dataset.stab));
  check("a Views tab was added beside Appearance",
    tabs.includes("views") && tabs.indexOf("views") === tabs.indexOf("appearance") + 1, tabs);
  await page.click('.stab[data-stab="views"]');
  await page.waitForTimeout(300);
  check("clicking it shows that panel and only that panel", await page.evaluate(() => {
    const active = [...document.querySelectorAll(".settings-panel.active")];
    return active.length === 1 && active[0].dataset.panel === "views";
  }));

  // ---- 5. every control still writes what it wrote before ----
  const wrong = [];
  for (const [id, key, value] of CONTROLS) {
    await page.evaluate(({ i, v }) => {
      const el = document.getElementById(i);
      const d = el.closest("details");
      if (d) d.open = true;
      el.value = v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, { i: id, v: value });
    await page.waitForTimeout(120);
    const got = await page.evaluate((k) => (JSON.parse(localStorage.getItem("lifelog-visual-settings-v1") || "{}"))[k], key);
    if (got !== value) wrong.push({ id, key, want: value, got });
  }
  check("every moved control still saves what it used to", !wrong.length, wrong);

  await page.evaluate(() => {
    const el = document.getElementById("currency");
    el.value = "EUR";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  check("currency still writes to the synced data, not to the device settings",
    await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).settings.currency === "EUR"));

  await ctx.close();

  // ---- 6. a checkbox and its label are not jammed together ----
  // `.modal label { display: block }` outranked `.toggle-label`'s flex row,
  // so the 8px gap never applied anywhere in the app — including the privacy
  // toggle, which shipped that way. Measured rather than asserted on the
  // rule, since the rule was there all along and still did nothing.
  {
    const { page: p3, ctx: c3, errs: e3 } = await open(browser, { width: 390, height: 844 });
    const gaps = {};
    for (const [name, stab, sel] of [
      ["tabs", "appearance", "#tabToggles .tab-toggle-view"],
      ["privacy", "privacy", ".settings-panel[data-panel=privacy] .toggle-label"],
    ]) {
      await p3.click(`.stab[data-stab="${stab}"]`);
      await p3.waitForTimeout(300);
      gaps[name] = await p3.evaluate((q) => {
        const row = document.querySelector(q);
        if (!row) return null;
        const box = row.querySelector("input");
        const txt = [...row.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        if (!box || !txt) return null;
        const r = document.createRange(); r.selectNode(txt);
        return Math.round(r.getBoundingClientRect().left - box.getBoundingClientRect().right);
      }, sel);
    }
    check("a checkbox has real space before its label, in the new rows and the old",
      gaps.tabs >= 6 && gaps.privacy >= 6, gaps);
    errs.push(...e3);
    await c3.close();
  }

  // ---- 7. it fits a phone ----
  {
    const { page: p2, ctx: c2, errs: e2 } = await open(browser, { width: 390, height: 844 });
    const probs = [];
    for (const name of ["appearance", "views"]) {
      await p2.click(`.stab[data-stab="${name}"]`);
      await p2.waitForTimeout(350);
      const g = await p2.evaluate(() => {
        const panel = document.querySelector(".settings-panel.active");
        const rows = [...panel.querySelectorAll(".row, label, select, input")];
        const vw = window.innerWidth;
        return {
          overflowX: panel.scrollWidth > panel.clientWidth + 1,
          escaping: rows.filter((r) => { const b = r.getBoundingClientRect(); return b.width > 0 && (b.left < -1 || b.right > vw + 1); }).length,
        };
      });
      if (g.overflowX || g.escaping) probs.push({ name, ...g });
    }
    check("both panels fit a 390px screen with nothing spilling out", !probs.length, probs);
    errs.push(...e2);
    await c2.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
