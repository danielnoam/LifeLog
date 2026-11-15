// Settings → Sync shows how much room the GitHub data repo has left (2026-11),
// as Waypage does: GitHub's repo size against the 5 GB it asks a repo to stay
// under. The size is asked for at most every 10 minutes and kept between
// opens; with no GitHub connection the row isn't there.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const doc = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {}, exportedAt: "2026-11-01T00:00:00.000Z",
};
const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake", sha: "sha-remote" };

async function openApp(browser, { connect = true, sizeKb, saved }) {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1000 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const asked = { repo: 0 };
  await page.route("https://api.github.com/**", (route) => {
    const url = route.request().url();
    const say = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (/\/repos\/someone\/lifelog-data$/.test(url)) { asked.repo++; return say(200, { default_branch: "main", private: true, size: sizeKb }); }
    if (/\/commits/.test(url)) return say(200, []);
    if (/\/contents\//.test(url)) return say(200, { sha: "sha-remote", encoding: "base64", content: Buffer.from(JSON.stringify(doc)).toString("base64") });
    return say(404, { message: "Not Found" });
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate(({ gh, connect }) => {
    localStorage.clear();
    if (connect) localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
  }, { gh: { ...GH, ...(saved || {}) }, connect });
  await page.reload({ waitUntil: "networkidle" });
  return { ctx, page, errs, asked };
}

async function openSync(page) {
  await page.evaluate(() => window.LifeLogSettings.openSettings("sync"));
  await page.waitForSelector("#settingsModal:not([hidden])", { timeout: 6000 });
}
const row = (page) => page.evaluate(() => {
  const r = document.querySelector("#ghSpace");
  const bar = r.querySelector(".space-bar");
  return { hidden: r.hidden || !r.offsetParent, left: r.querySelector("#ghSpaceLeft").textContent, used: r.querySelector("#ghSpaceUsed").textContent,
    now: bar.getAttribute("aria-valuenow"), full: r.classList.contains("full") };
});

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  try {
    // 1.2 GB used.
    let a = await openApp(browser, { sizeKb: 1171875 });
    await openSync(a.page);
    await a.page.waitForFunction(() => !document.querySelector("#ghSpace").hidden, null, { timeout: 6000 });
    let r = await row(a.page);
    check("the row shows what's left", r.left === "3.8 GB left", r);
    check("and what's used of 5 GB", /^1\.2 GB of 5\.0 GB used/.test(r.used), r);
    check("with the bar at 24%", r.now === "24" && !r.full, r);
    const kept = await a.page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-github-v1")));
    check("the size is kept with the connection", kept.size === 1171875 && kept.sizeAt > 0 && kept.token === "ghp_fake", kept);
    const before = a.asked.repo;
    await a.page.evaluate(() => window.LifeLogSettings.openSettings("sync"));
    await a.page.waitForTimeout(300);
    check("opening Sync again soon doesn't ask GitHub again", a.asked.repo === before, { before, after: a.asked.repo });
    errs.push(...a.errs);
    await a.ctx.close();

    // Nearly full: the row turns to the warning color.
    a = await openApp(browser, { sizeKb: 4700000, saved: { size: 4700000, sizeAt: Date.now() } });
    await openSync(a.page);
    r = await row(a.page);
    check("a kept size shows straight away", !r.hidden && r.left === "187 MB left", r);
    check("and past 90% it warns", r.full && r.now === "96", r);
    errs.push(...a.errs);
    await a.ctx.close();

    // Not connected: no row.
    a = await openApp(browser, { connect: false, sizeKb: 10 });
    await openSync(a.page);
    await a.page.waitForTimeout(300);
    r = await row(a.page);
    check("without GitHub there's no row", r.hidden, r);
    errs.push(...a.errs);
    await a.ctx.close();
  } finally {
    await browser.close();
  }
  done(errs);
})();
