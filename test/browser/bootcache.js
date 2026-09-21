// Boot renders this device's own copy before it consults the network, and
// reconciles behind it (0.164.0). The two things that could go wrong are the
// two things this suite is for:
//
//   1. an edit made while GitHub is still answering must survive the merge,
//   2. remote changes must still land — rendering early must not mean
//      rendering stale forever.
//
// GitHub is answered from inside the test on a fixed delay, so "while the
// network is in flight" is a window the test controls rather than races.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const CATS = [{ id: "g", name: "Games", color: "#5b8cff" }];
const entry = (id, title, stamp) => ({
  id, title, category: "Games", year: 2026, month: 3, date: "2026-03",
  rating: 4, createdAt: "2026-03-01T00:00:00.000Z", updatedAt: stamp,
});
const doc = (entries, exportedAt) => ({
  categories: CATS, entries, backlog: [], notes: [], todos: [], todoCategories: [],
  projects: [], financeEntries: [], recurringExpenses: [], financeCategories: [],
  settings: {}, exportedAt,
});

const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake", sha: "sha-old" };

async function openApp(browser, { cache, remote, latencyMs, connected = true }) {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1100 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(({ cache, gh, connected }) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "timeline" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(cache));
    localStorage.setItem("lifelog-sync-base-v1", JSON.stringify(cache));
    localStorage.removeItem("lifelog-visual-settings-v1");
    if (connected) localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
    else localStorage.removeItem("lifelog-github-v1");
  }, { cache, gh: GH, connected });

  const puts = [];
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "PUT") {
      puts.push(JSON.parse(Buffer.from(JSON.parse(req.postData()).content, "base64").toString()));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-new" } }) });
    }
    if (/\/commits/.test(req.url())) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    await new Promise((r) => setTimeout(r, latencyMs));
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      sha: "sha-remote", content: Buffer.from(JSON.stringify(remote)).toString("base64"), encoding: "base64",
    }) });
  });
  await page.reload({ waitUntil: "load" });
  return { page, ctx, errs, puts };
}

const titles = (page) => page.evaluate(() => [...document.querySelectorAll(".entry .etitle")].map((e) => e.textContent.trim()));

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // ---- 1. the rows are up before GitHub has answered ----
  {
    const cached = doc([entry("a", "From Cache", "2026-03-01T00:00:00.000Z")], "2026-03-01T00:00:00.000Z");
    const remote = doc([entry("a", "From Cache", "2026-03-01T00:00:00.000Z"),
                        entry("b", "From GitHub", "2026-03-02T00:00:00.000Z")], "2026-03-02T00:00:00.000Z");
    const { page, ctx, errs: e } = await openApp(browser, { cache: cached, remote, latencyMs: 2500 });
    await page.waitForSelector(".entry", { timeout: 2000 }); // must beat the 2.5s GitHub answer
    const early = await titles(page);
    check("rows are on screen while GitHub is still answering",
      early.some((t) => /From Cache/.test(t)) && !early.some((t) => /From GitHub/.test(t)), early);

    // ---- 2. and the remote change still lands afterwards ----
    await page.waitForFunction(() => document.body.innerText.includes("From GitHub"), null, { timeout: 15000 });
    const late = await titles(page);
    check("the remote entry arrives once the reconcile lands",
      late.some((t) => /From GitHub/.test(t)) && late.some((t) => /From Cache/.test(t)), late);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 3. an edit made during the network wait survives the merge ----
  {
    const cached = doc([entry("a", "Original", "2026-03-01T00:00:00.000Z")], "2026-03-01T00:00:00.000Z");
    const remote = doc([entry("a", "Original", "2026-03-01T00:00:00.000Z"),
                        entry("b", "Remote Only", "2026-03-02T00:00:00.000Z")], "2026-03-02T00:00:00.000Z");
    const { page, ctx, errs: e, puts } = await openApp(browser, { cache: cached, remote, latencyMs: 3000 });
    await page.waitForSelector(".entry", { timeout: 2000 });

    // Edited through the app's own path, not by poking state: the point is
    // that a real edit made during the network wait survives.
    await page.click(".entry .etitle");
    await page.waitForSelector("#entryModal:not([hidden])", { timeout: 4000 });
    await page.fill("#fTitle", "Edited While Waiting");
    await page.click("#entryForm button[type=submit]");
    await page.waitForSelector("#entryModal", { state: "hidden", timeout: 4000 });
    const mid = await titles(page);
    check("the edit is applied straight away", mid.some((t) => /Edited While Waiting/.test(t)), mid);

    await page.waitForFunction(() => document.body.innerText.includes("Remote Only"), null, { timeout: 20000 });
    await page.waitForTimeout(800);
    const after = await titles(page);
    check("the edit survives the reconcile that follows it",
      after.some((t) => /Edited While Waiting/.test(t)), after);
    check("and the remote entry came in alongside it",
      after.some((t) => /Remote Only/.test(t)), after);
    check("the edit was not reverted to its pre-edit title",
      !after.some((t) => /^Original$/.test(t)), after);
    const lastPut = puts[puts.length - 1];
    check("what got written back to GitHub carries the edit",
      !!lastPut && lastPut.entries.some((x) => x.title === "Edited While Waiting"),
      lastPut && lastPut.entries.map((x) => x.title));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 3b. both sides edited the same entry during the wait ----
  // The case case 3 does not reach: there the remote had not touched that
  // entry, so the merge kept the local one whether or not its timestamp was
  // accurate. Here the remote edited it too, so the merge has to compare
  // timestamps — and the local edit's stamp is normally written by persist(),
  // which is being held behind this very reconcile.
  {
    const cached = doc([entry("a", "Original", "2026-03-01T00:00:00.000Z")], "2026-03-01T00:00:00.000Z");
    const remote = doc([entry("a", "Remote Edit", "2026-03-02T00:00:00.000Z")], "2026-03-02T00:00:00.000Z");
    const { page, ctx, errs: e } = await openApp(browser, { cache: cached, remote, latencyMs: 3000 });
    await page.waitForSelector(".entry", { timeout: 2000 });
    await page.click(".entry .etitle");
    await page.waitForSelector("#entryModal:not([hidden])", { timeout: 4000 });
    await page.fill("#fTitle", "Local Edit");
    await page.click("#entryForm button[type=submit]");
    await page.waitForSelector("#entryModal", { state: "hidden", timeout: 4000 });
    await page.waitForTimeout(5000); // past the 3s answer and the merge behind it
    const after = await titles(page);
    check("an edit made during the wait outranks the remote's older edit",
      after.includes("Local Edit") && !after.includes("Remote Edit"), after);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 4. offline: no network at all, the cache still renders ----
  {
    const cached = doc([entry("a", "Offline Copy", "2026-03-01T00:00:00.000Z")], "2026-03-01T00:00:00.000Z");
    const ctxr = await browser.newContext({ viewport: { width: 460, height: 1100 }, serviceWorkers: "block" });
    const page = await ctxr.newPage();
    const e = [];
    page.on("pageerror", (x) => e.push("pageerror: " + x.message));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(({ cache, gh }) => {
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "timeline" }));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(cache));
      localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
      localStorage.removeItem("lifelog-visual-settings-v1");
    }, { cache: cached, gh: GH });
    await page.route("https://api.github.com/**", (route) => route.abort());
    const t0 = Date.now();
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".entry", { timeout: 6000 });
    const ms = Date.now() - t0;
    const shown = await titles(page);
    check("an unreachable GitHub does not stop the cached copy rendering",
      shown.some((t) => /Offline Copy/.test(t)), shown);
    check("and it does not have to time out first (under 3s)", ms < 3000, ms);
    errs.push(...e);
    await ctxr.close();
  }

  // ---- 5. a device with no cache at all still loads ----
  {
    const remote = doc([entry("a", "First Sync", "2026-03-02T00:00:00.000Z")], "2026-03-02T00:00:00.000Z");
    const ctxr = await browser.newContext({ viewport: { width: 460, height: 1100 }, serviceWorkers: "block" });
    const page = await ctxr.newPage();
    const e = [];
    page.on("pageerror", (x) => e.push("pageerror: " + x.message));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate((gh) => {
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "timeline" }));
      localStorage.removeItem("lifelog-cache-v1");
      localStorage.removeItem("lifelog-sync-base-v1");
      localStorage.removeItem("lifelog-visual-settings-v1");
      localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
    }, GH);
    await page.route("https://api.github.com/**", (route) => {
      if (route.request().method() === "PUT") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "s" } }) });
      if (/\/commits/.test(route.request().url())) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        sha: "sha-remote", content: Buffer.from(JSON.stringify(remote)).toString("base64"), encoding: "base64" }) });
    });
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".entry", { timeout: 10000 });
    const shown = await titles(page);
    check("a device with no copy of its own still gets GitHub's", shown.some((t) => /First Sync/.test(t)), shown);
    errs.push(...e);
    await ctxr.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
