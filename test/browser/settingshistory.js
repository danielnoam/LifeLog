// Settings' pages in the browser's history (2026-11-27): the browser's and
// the mouse's back and forward step through them, back from the first page
// shuts Settings, and shutting it any other way takes its entries off again.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  entries: [], backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {},
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
  }, SEED);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(300);
  return { page, ctx, errs };
}

// Where Settings stands: shut, or the page showing and its history depth.
const where = (page) => page.evaluate(() => {
  const m = document.getElementById("settingsModal");
  const on = [...m.querySelectorAll(".settings-page")].find((p) => !p.hidden);
  const s = history.state;
  return { open: !m.hidden, page: m.hidden ? null : (on ? on.dataset.page : ""), d: s && typeof s.settingsPage === "string" ? s.d : 0 };
});
const step = async (page, how) => {
  await page.evaluate((h) => new Promise((done) => {
    addEventListener("popstate", () => setTimeout(done, 50), { once: true });
    history[h]();
  }), how);
  await page.waitForTimeout(100);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // ---- a computer: the list beside a page ----
  {
    const { page, ctx, errs: e } = await open(browser, { width: 1280, height: 900 });
    errs.push(...e);
    await page.click("#settingsBtn");
    await page.waitForSelector("#settingsModal:not([hidden])");
    let w = await where(page);
    check("opening Settings is one entry in history", same(w, { open: true, page: "sync", d: 1 }), w);
    await page.click('#settingsHome .srow[data-page="appearance"]');
    await page.click('#settingsHome .srow[data-page="imports"]');
    w = await where(page);
    check("each page opened is another", same(w, { open: true, page: "imports", d: 3 }), w);
    await step(page, "back");
    w = await where(page);
    check("back goes to the page before", same(w, { open: true, page: "appearance", d: 2 }), w);
    await step(page, "forward");
    w = await where(page);
    check("forward comes back", same(w, { open: true, page: "imports", d: 3 }), w);
    await step(page, "back"); await step(page, "back"); await step(page, "back");
    w = await where(page);
    check("back from the first page shuts Settings", same(w, { open: false, page: null, d: 0 }), w);
    await step(page, "forward");
    w = await where(page);
    check("and forward opens it again where it was", same(w, { open: true, page: "sync", d: 1 }), w);

    await page.click('#settingsHome .srow[data-page="imports"]');
    await page.click('.settings-page[data-page="imports"] .srow[data-page="conn-hardcover"]');
    w = await where(page);
    check("a page inside another is an entry too", same(w, { open: true, page: "conn-hardcover", d: 3 }), w);
    await page.click('.settings-page[data-page="conn-hardcover"] .settings-crumb');
    await page.waitForTimeout(200);
    w = await where(page);
    check("its crumb back to the parent steps back in history rather than adding to it", same(w, { open: true, page: "imports", d: 2 }), w);

    await page.click("#closeSettingsBtn");
    await page.waitForTimeout(300);
    w = await where(page);
    check("shutting Settings with × takes its entries off", same(w, { open: false, page: null, d: 0 }), w);
    const len = await page.evaluate(() => history.length);
    await page.keyboard.press("Tab");
    await page.waitForSelector("#settingsModal:not([hidden])");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    w = await where(page);
    check("as does Escape", same(w, { open: false, page: null, d: 0 }), w);
    check("and reopening doesn't pile up entries", await page.evaluate(() => history.length) <= len + 1);
    await ctx.close();
  }

  // ---- a phone: the list and a page take turns ----
  {
    const { page, ctx, errs: e } = await open(browser, { width: 390, height: 800 });
    errs.push(...e);
    await page.click("#settingsBtn");
    await page.waitForSelector("#settingsModal:not([hidden])");
    let w = await where(page);
    check("on a phone Settings opens on its list", same(w, { open: true, page: "", d: 1 }), w);
    await page.click('#settingsHome .srow[data-page="appearance"]');
    await page.waitForTimeout(200);
    w = await where(page);
    check("a page is an entry after it", same(w, { open: true, page: "appearance", d: 2 }), w);
    await page.click("#settingsBackBtn");
    await page.waitForTimeout(200);
    w = await where(page);
    check("the back button steps back in history", same(w, { open: true, page: "", d: 1 }), w);
    await step(page, "forward");
    w = await where(page);
    check("so forward returns to the page", same(w, { open: true, page: "appearance", d: 2 }), w);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    w = await where(page);
    check("Escape (Android's back) steps back the same way", same(w, { open: true, page: "", d: 1 }), w);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    w = await where(page);
    check("and from the list shuts Settings, entries and all", same(w, { open: false, page: null, d: 0 }), w);
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
