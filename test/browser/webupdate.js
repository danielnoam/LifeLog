// The browser's "New version ready" bar: shown when a new service worker
// finishes installing over one that already controls the page, with Reload
// and a close button that hides it.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const DOC = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], projects: [], habits: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {}, notes: [],
};

// A registration the test drives: an incoming worker that reaches
// "installed" while another already controls the page.
const FAKE_SW = () => {
  const reg = new EventTarget();
  window.__reg = reg;
  window.__arrive = () => {
    const w = new EventTarget();
    w.state = "installing";
    reg.installing = w;
    reg.dispatchEvent(new Event("updatefound"));
    w.state = "installed";
    w.dispatchEvent(new Event("statechange"));
  };
  const proto = ServiceWorkerContainer.prototype;
  Object.defineProperty(proto, "register", { configurable: true, value: async () => reg });
  Object.defineProperty(proto, "controller", { configurable: true, get: () => ({}) });
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "allow" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.addInitScript(FAKE_SW);
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify(d)); }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);

  const hidden = (id) => page.evaluate((i) => {
    const e = document.getElementById(i);
    return e.hidden || getComputedStyle(e).display === "none";
  }, id);
  check("the app is the browser one", await page.evaluate(() => !window.LifeLogPlatform.native && !window.LifeLogPlatform.desktop));
  check("no bar before a new build arrives", await hidden("updateBar"));

  await page.evaluate(() => window.__arrive());
  check("a new build shows the bar", !(await hidden("updateBar")));
  check("with Reload", (await page.textContent("#updateReloadBtn")).trim() === "Reload");
  check("and a close button", !(await hidden("updateCloseBtn")));

  await page.click("#updateCloseBtn");
  check("the close button hides the bar", await hidden("updateBar"));

  await page.evaluate(() => window.__arrive());
  check("the next build shows it again", !(await hidden("updateBar")));

  check("no page errors", errs.length === 0, errs);
  await b.close();
  done();
})();
