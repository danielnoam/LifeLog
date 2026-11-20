// The web app on a Windows PC offers the Windows app: once in the update
// bar (Download or close, and it doesn't come back), and always as a row in
// Settings → About. Nowhere else sees either.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const DOC = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], projects: [], habits: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {}, notes: [],
};
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SETUP = "https://github.com/danielnoam/LifeLog/releases/latest/download/LifeLog-setup.exe";

async function open(b, userAgent) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block", userAgent });
  const page = await ctx.newPage();
  const errs = [], asked = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  // The offer waits a few seconds after launch; the clock skips them.
  await ctx.clock.install();
  await ctx.route(/^https:\/\/(github\.com|api\.github\.com)\//, (r) => { asked.push(r.request().url()); return r.fulfill({ status: 204, body: "" }); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify(d)); }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  return { ctx, page, errs, asked };
}
const later = (page) => page.clock.fastForward(5000);
const barUp = (page) => page.evaluate(() => !document.getElementById("updateBar").hidden);
const aboutRow = async (page) => {
  await page.evaluate(() => LifeLogSettings.openSettings("about"));
  const shown = await page.evaluate(() => !document.getElementById("windowsAppRow").hidden && document.getElementById("windowsAppRow").offsetHeight > 0);
  await page.keyboard.press("Escape");
  return shown;
};

(async () => {
  const b = await chromium.launch();

  const w = await open(b, WIN_UA);
  check("a browser on Windows is the one offered it", await w.page.evaluate(() => LifeLogPlatform.windowsBrowser));
  await later(w.page);
  check("the bar offers the Windows app", await barUp(w.page) && await w.page.evaluate(() => document.getElementById("updateBarText").textContent === "LifeLog has a Windows app" && document.getElementById("updateReloadBtn").textContent === "Download"));
  await Promise.all([w.page.waitForRequest(SETUP, { timeout: 3000 }).catch(() => {}), w.page.click("#updateReloadBtn")]);
  check("Download fetches the installer", w.asked.includes(SETUP), w.asked);
  check("and the bar goes", !(await barUp(w.page)));
  await w.page.reload({ waitUntil: "networkidle" });
  await later(w.page);
  check("it isn't offered again on the next launch", !(await barUp(w.page)));
  check("Settings → About still has the row", await aboutRow(w.page));
  const href = await w.page.evaluate(() => document.getElementById("windowsAppRow").getAttribute("href"));
  check("the row points at the installer", href === SETUP, href);
  check("no page errors on Windows", w.errs.length === 0, w.errs);
  await w.ctx.close();

  const w2 = await open(b, WIN_UA);
  await later(w2.page);
  await w2.page.click("#updateCloseBtn");
  check("closing it hides the bar", !(await barUp(w2.page)));
  await w2.page.reload({ waitUntil: "networkidle" });
  await later(w2.page);
  check("and it stays closed", !(await barUp(w2.page)));
  await w2.ctx.close();

  const l = await open(b, undefined);
  await later(l.page);
  check("elsewhere there's no offer", !(await barUp(l.page)) && !(await l.page.evaluate(() => LifeLogPlatform.windowsBrowser)));
  check("and no About row", !(await aboutRow(l.page)));
  check("no page errors elsewhere", l.errs.length === 0, l.errs);
  await l.ctx.close();

  await b.close();
  done();
})();
