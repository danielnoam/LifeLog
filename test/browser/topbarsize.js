// The computer's top bar is the same on every tab (2026-11-21). The phone's
// tab underline sat in the row on a computer, sized by app.js to the active
// tab, so switching tabs moved the search box and, near the fit edge,
// dropped the tabs to icons on some tabs only. A two-word Hebrew tab name
// also wrapped to a second line before the row counted as full.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const VIEWS = ["notes", "timeline", "home", "backlog", "finance"];

async function measure(browser, lang, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: "block" });
  await ctx.addInitScript((l) => localStorage.setItem("lifelog.lang", l), lang);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(600);
  const rows = {};
  for (const v of VIEWS) {
    await page.click(`#viewTabs .tab[data-view="${v}"]`);
    await page.waitForTimeout(300);
    rows[v] = await page.evaluate(() => {
      const bar = document.querySelector(".topbar");
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      return {
        h: Math.round(bar.getBoundingClientRect().height),
        tight: bar.classList.contains("is-tight"),
        search: Math.round(box(".search-wrap").width),
        tabs: Math.round(box("#viewTabs").width),
        tabH: Math.max(...[...document.querySelectorAll("#viewTabs .tab")].map((t) => Math.round(t.getBoundingClientRect().height))),
      };
    });
  }
  await ctx.close();
  return { rows, errs };
}

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  for (const lang of ["en", "he"]) {
    for (const width of [1440, 1100, 900]) {
      const { rows, errs: e } = await measure(browser, lang, width);
      errs.push(...e);
      const first = JSON.stringify(rows[VIEWS[0]]);
      check(`${lang} ${width}px: top bar identical on every tab`,
        VIEWS.every((v) => JSON.stringify(rows[v]) === first), rows);
      check(`${lang} ${width}px: tab names stay on one line`,
        VIEWS.every((v) => rows[v].tabH <= 40), rows);
    }
  }
  await browser.close();
  done(errs);
})();
