// The Windows app's update bar: when Tauri's updater finds nothing (a release
// with no latest.json), one click opens the release page, never shows
// "Downloading", and the bar can be closed for that version.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const BUILD = { version: "0.0.0", repo: "someone/lifelog", webUrl: "https://someone.github.io/lifelog/" };
const DOC = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], projects: [], habits: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {}, notes: [],
};

const FAKE_TAURI = () => {
  window.__t = { opened: [], checks: 0, texts: [] };
  window.__TAURI__ = {
    core: { invoke: async () => null },
    opener: { openUrl: async (u) => { window.__t.opened.push(u); } },
    updater: { check: async () => { window.__t.checks++; return null; } },
  };
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.addInitScript(FAKE_TAURI);
  await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BUILD) }));
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route("https://api.github.com/repos/someone/lifelog/releases/latest",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tag_name: "app-v9.9.9" }) }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify(d)); }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.getElementById("updateBar").hidden, null, { timeout: 5000 }).catch(() => {});

  const text = () => page.evaluate(() => document.getElementById("updateBarText").textContent);
  const btn = () => page.evaluate(() => document.getElementById("updateReloadBtn").textContent);
  check("the app is the desktop one", await page.evaluate(() => window.LifeLogPlatform.desktop));
  check("a newer release is offered with Update", /9\.9\.9/.test(await text()) && (await btn()) === "Update");

  await page.click("#updateReloadBtn");
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => window.__t);
  check("the updater is asked once and finds nothing", t.checks === 1, t);
  check("so the release page opens", t.opened.includes("https://github.com/someone/lifelog/releases/latest"), t);
  check("and the bar says it's a page, not a download", !/Downloading/.test(await text()) && (await btn()) === "Open page", { text: await text(), btn: await btn() });

  await page.click("#updateReloadBtn");
  await page.waitForTimeout(200);
  const t2 = await page.evaluate(() => window.__t);
  check("a second click opens the page again without asking the updater", t2.checks === 1 && t2.opened.length === 2, t2);

  await page.click("#updateCloseBtn");
  check("the close button hides the bar", await page.evaluate(() => document.getElementById("updateBar").hidden));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("it stays closed for that version on the next launch", await page.evaluate(() => document.getElementById("updateBar").hidden));

  check("no page errors", errs.length === 0, errs);
  await b.close();
  done();
})();
