// The Settings reworks: 0.169.0 split Appearance up, and 0.186.0 swapped the
// tab strip for a list of pages with search, and moved each view's options
// onto that view's View button. What this suite guards is that the moves
// moved controls rather than losing them, that each one still does what it
// did, and that the list, search and View button get you to them.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

// Every control Appearance and the View options are responsible for, and
// the visual-settings key it writes. currency is the odd one out: it is app data and it syncs.
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

const pageOf = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  const p = el && el.closest(".settings-page");
  if (p) return p.dataset.page;
  const v = el && el.closest("#viewOptionsModal [data-for]");
  return v ? "view:" + v.dataset.for : null;
}, id);

const shown = (page, sel) => page.evaluate((q) => {
  const el = document.querySelector(q);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}, sel);

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const { page, ctx, errs: e } = await open(browser, { width: 1280, height: 900 });
  errs.push(...e);

  // ---- 1. nothing was lost in the move ----
  const missing = [];
  for (const [id] of CONTROLS) if (!(await page.evaluate((i) => !!document.getElementById(i), id))) missing.push(id);
  check("every control still exists after the reshuffle", !missing.length, missing);
  check("and the tab strip is gone", await page.evaluate(() => !document.querySelector(".stab, .settings-tabs")));

  // ---- 2. each control is where a person would look for it ----
  const homes = {};
  for (const [id] of CONTROLS.concat([["currency"], ["monthMin"], ["monthMax"]])) homes[id] = await pageOf(page, id);
  check("what the whole app looks like is on Appearance",
    homes.themeSelect === "appearance" && homes.fontFamily === "appearance" && homes.forceLayout === "appearance", homes);
  check("what changes one list is on that list's View options",
    homes.timelineCoverSize === "view:timeline" && homes.timelineMonthSummary === "view:timeline" &&
    ["backlogCoverSize", "backlogCounts", "backlogFoldEa", "backlogFoldUnreleased", "backlogFoldDropped", "backlogSummaries"]
      .every((k) => homes[k] === "view:backlog") &&
    homes.ledgerMonthSummary === "view:finance" && homes.currency === "view:finance", homes);
  check("and the month card widths belong to both the Timeline and the Ledger",
    homes.monthMin === "view:timeline finance" && homes.monthMax === "view:timeline finance", homes);
  check("and the Backlog's settings are in one group, not four sections",
    await page.evaluate(() => {
      const sec = document.getElementById("backlogFoldEa").closest("section");
      return ["backlogCoverSize", "backlogCounts", "backlogSummaries", "backlogFoldUnreleased", "backlogFoldDropped"]
        .every((i) => sec.contains(document.getElementById(i)));
    }));

  // ---- 3. the list, and the page beside it ----
  const rows = await page.evaluate(() => [...document.querySelectorAll("#settingsHome .srow")].map((r) => ({
    page: r.dataset.page, status: r.querySelector(".srow-status").textContent,
  })));
  const pages = await page.evaluate(() => [...document.querySelectorAll(".settings-page")].map((p) => p.dataset.page));
  check("every page has a row on the list, and every row a page",
    rows.length === pages.length && rows.every((r) => pages.includes(r.page)), { rows, pages });
  check("and every row says where things stand", rows.every((r) => r.status.trim()), rows);
  check("an unsynced device's row says so", /not synced/i.test(rows.find((r) => r.page === "sync").status), rows);
  check("on a computer the list and the first page open together",
    await shown(page, "#settingsHome") && await shown(page, '.settings-page[data-page="sync"]'));
  await page.click('.srow[data-page="appearance"]');
  await page.waitForTimeout(300);
  check("choosing a row shows that page and only that page", await page.evaluate(() => {
    const on = [...document.querySelectorAll(".settings-page")].filter((p) => !p.hidden);
    return on.length === 1 && on[0].dataset.page === "appearance" &&
      document.querySelector('.srow[data-page="appearance"]').classList.contains("active");
  }));
  check("with the list still beside it", await shown(page, "#settingsHome"));

  // ---- 4. search ----
  await page.fill("#settingsSearch", "rawg");
  await page.waitForTimeout(200);
  const found = await page.evaluate(() => [...document.querySelectorAll("#settingsResults .srow-result")].map((r) => r.textContent));
  check("searching finds a setting by its label, and says which page it's on",
    found.some((t) => /RAWG key/.test(t) && /Media lookups/.test(t)), found);
  check("and the list steps aside while it does", !(await shown(page, "#settingsHome")));
  await page.evaluate(() => [...document.querySelectorAll("#settingsResults .srow-result")].find((r) => /RAWG key/.test(r.textContent)).click());
  await page.waitForTimeout(700);
  check("a result opens its page with the setting in view", await page.evaluate(() => {
    const k = document.getElementById("rawgKey").getBoundingClientRect();
    return !document.querySelector('.settings-page[data-page="media"]').hidden && k.top >= 0 && k.bottom <= innerHeight;
  }));
  await page.fill("#settingsSearch", "dracula");
  await page.waitForTimeout(200);
  check("a select's choices are searchable too",
    await page.evaluate(() => [...document.querySelectorAll("#settingsResults .srow-result")].some((r) => /Color scheme/.test(r.textContent))));
  await page.fill("#settingsSearch", "qqqzzz");
  await page.waitForTimeout(200);
  check("nothing found says so", await page.evaluate(() => /No results/.test(document.querySelector("#settingsResults").textContent)));
  await page.focus("#settingsSearch");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("Escape in the search clears it rather than closing Settings", await page.evaluate(() =>
    !document.querySelector("#settingsModal").hidden && document.querySelector("#settingsSearch").value === "" &&
    !document.querySelector("#settingsHome").hidden));
  await page.fill("#settingsSearch", "currency");
  await page.waitForTimeout(200);
  await page.evaluate(() => [...document.querySelectorAll("#settingsResults .srow-result")].find((r) => /Currency/.test(r.textContent)).click());
  await page.waitForTimeout(500);
  check("a view's option is found from Settings, and opens that view's options on that view", await page.evaluate(() =>
    document.querySelector("#settingsModal").hidden && !document.querySelector("#viewOptionsModal").hidden &&
    !document.querySelector("#currency").closest("section").hidden &&
    document.querySelector('#viewTabs .tab[data-view="finance"]').classList.contains("active")));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // ---- 5. the View button ----
  const viewBtn = {};
  for (const v of ["notes", "timeline", "backlog", "finance"]) {
    await page.click(`#viewTabs .tab[data-view="${v}"]`);
    await page.waitForTimeout(250);
    viewBtn[v] = await shown(page, "#viewOptionsBtn");
  }
  check("the View button is on the Timeline, Backlog and Ledger, and not where there's nothing to set",
    viewBtn.timeline && viewBtn.backlog && viewBtn.finance && !viewBtn.notes, viewBtn);
  const sheets = {};
  for (const v of ["timeline", "backlog", "finance"]) {
    await page.click(`#viewTabs .tab[data-view="${v}"]`);
    await page.waitForTimeout(250);
    await page.click("#viewOptionsBtn");
    await page.waitForTimeout(250);
    sheets[v] = await page.evaluate(() => ({
      title: document.querySelector("#viewOptionsTitle").textContent,
      ids: [...document.querySelectorAll("#viewOptionsModal [data-for]:not([hidden]) select, #viewOptionsModal [data-for]:not([hidden]) input")].map((x) => x.id),
    }));
    await page.click("#closeViewOptionsBtn");
    await page.waitForTimeout(150);
  }
  check("each opens its own options and no one else's",
    sheets.timeline.ids.includes("timelineCoverSize") && !sheets.timeline.ids.includes("backlogCoverSize") &&
    sheets.backlog.ids.includes("backlogFoldEa") && !sheets.backlog.ids.includes("monthMin") &&
    sheets.finance.ids.includes("currency") && sheets.finance.ids.includes("monthMin") && sheets.timeline.ids.includes("monthMin"), sheets);
  check("named for the view", sheets.finance.title === "Ledger view" && sheets.backlog.title === "Backlog view", sheets);

  // ---- 6. every control still writes what it wrote before ----
  const wrong = [];
  for (const [id, key, value] of CONTROLS) {
    await page.evaluate(({ i, v }) => {
      const el = document.getElementById(i);
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

  // ---- 7. on a phone the list and a page take turns ----
  {
    const { page: p, ctx: c, errs: e4 } = await open(browser, { width: 390, height: 844 });
    check("a phone opens on the list", await shown(p, "#settingsHome") && !(await shown(p, ".settings-main")));
    await p.click('.srow[data-page="lock"]');
    await p.waitForTimeout(300);
    check("a row opens its page in place of the list", await shown(p, "#privacyEnabled") && !(await shown(p, "#settingsHome")));
    await p.click("#settingsBackBtn");
    await p.waitForTimeout(300);
    check("back returns to the list", await shown(p, "#settingsHome"));
    await p.click('.srow[data-page="lock"]');
    await p.waitForTimeout(300);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(200);
    const afterOne = await p.evaluate(() => !document.querySelector("#settingsModal").hidden);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(200);
    check("Escape steps back to the list first, then closes",
      afterOne && await p.evaluate(() => document.querySelector("#settingsModal").hidden));
    errs.push(...e4);
    await c.close();
  }

  // ---- 8. a switch and its label are not jammed together ----
  // `.modal label { display: block }` outranked `.toggle-label`'s flex row,
  // so the 8px gap never applied anywhere in the app — including the privacy
  // toggle, which shipped that way. Measured rather than asserted on the
  // rule, since the rule was there all along and still did nothing.
  {
    const { page: p3, ctx: c3, errs: e3 } = await open(browser, { width: 390, height: 844 });
    const gaps = {};
    for (const [name, pg, sel] of [
      ["tabs", "tabs", "#tabToggles .tab-toggle-view"],
      ["privacy", "lock", ".settings-page[data-page=lock] .toggle-label"],
    ]) {
      await p3.click(`.srow[data-page="${pg}"]`);
      await p3.waitForTimeout(300);
      gaps[name] = await p3.evaluate((q) => {
        const row = document.querySelector(q);
        if (!row) return null;
        const box = row.querySelector("input");
        const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() ? 1 : 3 });
        const txt = walk.nextNode();
        if (!box || !txt) return null;
        const r = document.createRange(); r.selectNode(txt);
        const t = r.getBoundingClientRect(), b = box.getBoundingClientRect();
        // The switch sits on either side of its label depending on the row.
        return Math.round(b.left >= t.right ? b.left - t.right : t.left - b.right);
      }, sel);
      await p3.click("#settingsBackBtn");
      await p3.waitForTimeout(200);
    }
    check("a checkbox has real space before its label, in the new rows and the old",
      gaps.tabs >= 6 && gaps.privacy >= 6, gaps);
    errs.push(...e3);
    await c3.close();
  }

  // ---- 9. it fits a phone ----
  {
    const { page: p2, ctx: c2, errs: e2 } = await open(browser, { width: 390, height: 844 });
    const probs = [];
    const measure = (root) => p2.evaluate((q) => {
      const box = document.querySelector(q);
      const rows = [...box.querySelectorAll(".row, label, select, input")];
      const vw = window.innerWidth;
      return {
        overflowX: box.scrollWidth > box.clientWidth + 1,
        escaping: rows.filter((r) => { const b = r.getBoundingClientRect(); return b.width > 0 && (b.left < -1 || b.right > vw + 1); }).length,
      };
    }, root);
    for (const name of ["sync", "appearance", "media", "imports"]) {
      await p2.click(`.srow[data-page="${name}"]`);
      await p2.waitForTimeout(350);
      const g = await measure(".settings-pages");
      if (g.overflowX || g.escaping) probs.push({ name, ...g });
      await p2.click("#settingsBackBtn");
      await p2.waitForTimeout(200);
    }
    const home = await measure(".settings-side");
    if (home.overflowX || home.escaping) probs.push({ name: "list", ...home });
    await p2.click("#closeSettingsBtn");
    for (const v of ["timeline", "backlog", "finance"]) {
      await p2.evaluate((view) => window.LifeLogSettings.openViewOptions(view), v);
      await p2.waitForTimeout(300);
      const g = await measure(".view-options");
      if (g.overflowX || g.escaping) probs.push({ name: "view " + v, ...g });
      await p2.click("#closeViewOptionsBtn");
    }
    check("the list, the pages and the view options fit a 390px screen", !probs.length, probs);
    errs.push(...e2);
    await c2.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
