// Background refresh (0.279.0): the app run with no screen. Android opens
// the page with ?headless=1 and a small Java object in place of Capacitor
// (src/headless.js); the run pulls from GitHub, re-checks the watched
// prices through that object's fetch, hands the widgets a snapshot through
// its update, and says whether anything moved through its done. There is
// no Android here, so the object is faked the way HeadlessRefresh.java
// gives it to the page, and what this proves is everything the page decides
// on finding it: no lock screen in the way, the merge landing in this
// device's copy, the snapshot and the alert going out, done() with the
// right answer, and nothing of it in a browser.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const CATS = [{ id: "g", name: "Games", color: "#5b8cff" }];
const entry = (id, title, stamp) => ({ id, title, category: "Games", year: 2026, month: 3, date: "2026-03", rating: 4, createdAt: "2026-03-01T00:00:00.000Z", updatedAt: stamp });
const doc = (entries, exportedAt) => ({
  categories: CATS, entries,
  backlog: [{ id: "b1", title: "Hades II", category: "Games", mediaSource: "steam", mediaId: "1145350", priceAlert: 15, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
  notes: [], todos: [], todoCategories: [], projects: [], financeEntries: [], recurringExpenses: [], financeCategories: [],
  habits: [{ id: "h1", name: "Read", color: "#3fb950", marks: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
  settings: { mediaCategorySources: { Games: "rawg-steam-gg" }, mediaKeys: { rawg: "k", ggdeals: "gk" } }, accomplishments: {}, exportedAt,
});
const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake", sha: "sha-old" };
// PIN 1234, as native.js seeds it: a normal boot would stop at the lock.
const LOCKED = { enabled: true, graceMinutes: 0, lastUnlockAt: 0, credentialId: null, pinSalt: "abcd", pinHash: "ef53952abc7954443575c3ee91322dce7d70e261ddc310a7cc9e5475309e30df" };

// HeadlessRefresh.Shim, as far as the page uses it. Answers come back
// through window.LifeLogHeadlessFetched on a later tick, as Java's do.
const SHIM = () => {
  window.__headless = { updates: [], done: null, fetched: [], logs: [], price: "12.49" };
  window.LifeLogHeadless = {
    update: (json) => { window.__headless.updates.push(JSON.parse(json)); },
    notePins: () => "[]",
    notificationState: () => "granted",
    fetch: (id, url, headers, noRedirects) => {
      window.__headless.fetched.push({ url, headers: JSON.parse(headers), noRedirects });
      const ids = (new URL(url).searchParams.get("ids") || "").split(",");
      const data = {};
      for (const i of ids) data[i] = { prices: { currentRetail: window.__headless.price, historicalRetail: "9.99" } };
      setTimeout(() => window.LifeLogHeadlessFetched(id, JSON.stringify({ status: 200, data: JSON.stringify({ success: true, data }), headers: { "content-type": "application/json" }, url })), 30);
    },
    done: (changed, note) => { window.__headless.done = { changed, note }; },
    log: (s) => { window.__headless.logs.push(s); },
  };
};

async function openRun(browser, { remote, shim = true, lock = false }) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const asked = { sw: 0, github: 0 };
  await page.route("**/sw.js", (r) => { asked.sw++; r.fulfill({ status: 404, body: "" }); });
  await page.route("https://api.github.com/**", (route) => {
    asked.github++;
    const req = route.request();
    if (req.method() === "PUT") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-new" } }) });
    if (/\/commits/.test(req.url())) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sha: remote.sha, content: Buffer.from(JSON.stringify(remote.data)).toString("base64"), encoding: "base64" }) });
  });
  if (shim) await page.addInitScript(SHIM);
  return { ctx, page, errs, asked, lock };
}

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // ---- the run: a lock in the way, GitHub ahead, a price under its target ----
  {
    const cached = doc([entry("a", "From Cache", "2026-03-01T00:00:00.000Z")], "2026-03-01T00:00:00.000Z");
    const remote = doc([entry("a", "From Cache", "2026-03-01T00:00:00.000Z"), entry("b", "From GitHub", "2026-03-02T00:00:00.000Z")], "2026-03-02T00:00:00.000Z");
    const { ctx, page, errs: e, asked } = await openRun(browser, { remote: { sha: "sha-remote", data: remote } });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate(({ cache, gh, lock }) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(cache));
      localStorage.setItem("lifelog-sync-base-v1", JSON.stringify(cache));
      localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
      localStorage.setItem("lifelog-privacy-v1", JSON.stringify(lock));
    }, { cache: cached, gh: GH, lock: LOCKED });
    await page.goto(BASE + "/?headless=1", { waitUntil: "load" });
    await page.waitForFunction(() => window.__headless && window.__headless.done, null, { timeout: 15000 }).catch(() => {});
    const h = await page.evaluate(() => window.__headless);
    check("the run ends with done(), and says the copy moved", h.done && h.done.changed === true && h.done.note === "", h.done);
    check("the lock didn't stop it", await page.evaluate(() => document.querySelector("#lockScreen").hidden));
    check("what GitHub had landed in this device's copy", await page.evaluate(() => (window.LifeLogStorage.cachedCopy().entries || []).some((x) => x.title === "From GitHub")));
    check("GitHub was read once", asked.github >= 1 && asked.github <= 2, asked);
    check("no service worker was asked for", asked.sw === 0, asked);
    const last = h.updates[h.updates.length - 1];
    check("the widgets got a snapshot: the habit, the alert for the price", !!last && (last.habits || []).some((x) => x.name === "Read")
      && (last.alerts || []).some((a) => a.id === "price-b1" && a.kind === "price"), last);
    check("the price was asked through the shim's fetch, the proxy route as the app builds it",
      h.fetched.length === 1 && /gg\.deals.*1145350/.test(h.fetched[0].url) && h.fetched[0].noRedirects === false, h.fetched);
    check("the hit is on record for the phone", await page.evaluate(() => !!JSON.parse(localStorage.getItem("lifelog-alerts-v1")).prices.b1));
    check("Capacitor's shape was there for platform.js: a native Android build",
      await page.evaluate(() => window.LifeLogPlatform.native && window.LifeLogPlatform.android && window.LifeLogPlatform.headless));

    // ---- again, with nothing new: done(false) ----
    await page.evaluate(() => { window.__headless.updates = []; window.__headless.done = null; window.__headless.fetched = []; });
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__headless && window.__headless.done, null, { timeout: 15000 }).catch(() => {});
    const again = await page.evaluate(() => window.__headless);
    check("a run that finds nothing new says so, and still sends the snapshot", again.done && again.done.changed === false && again.updates.length >= 1, again.done);
    check("the standing price hit isn't recorded twice", again.fetched.length === 1 && (again.updates[again.updates.length - 1].alerts || []).filter((a) => a.id === "price-b1").length === 1);
    errs.push(...e);
    await ctx.close();
  }

  // ---- a browser with ?headless=1 is just the app ----
  {
    const cached = doc([entry("a", "From Cache", "2026-03-01T00:00:00.000Z")], "2026-03-01T00:00:00.000Z");
    const { ctx, page, errs: e } = await openRun(browser, { remote: { sha: "sha-old", data: cached }, shim: false });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate((cache) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify(cache)); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "timeline" })); }, cached);
    await page.goto(BASE + "/?headless=1", { waitUntil: "load" });
    await page.waitForTimeout(900);
    check("without the Java object the page is the app, on screen", await page.evaluate(() => !window.Capacitor && !window.LifeLogPlatform.headless && document.body.innerText.includes("From Cache")));
    errs.push(...e);
    await ctx.close();
  }

  await browser.close();
  done(errs);
})();
