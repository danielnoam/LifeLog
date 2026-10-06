// Activity and background work (0.244.0): long work runs as jobs
// (src/jobs.js) that show in the header and the Activity sheet, wait their
// turn per site, stop on request keeping what they did, and, in the phone
// app, tell the native side what's going on so it can keep working put away.
// Steam is faked through the proxy routes; the phone through a fake Widgets
// plugin, which can't prove Android's service runs, only that it's asked.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const PROXY = "https://fake-proxy.test";
const CORS = { "Access-Control-Allow-Origin": "*" };
const steamItem = (id) => ({ id: "s" + id, title: "Steam app " + id, category: "Games", mediaSource: "steam", mediaId: String(id), createdAt: "2026-01-01T00:00:00.000Z" });
const SEED = {
  categories: [{ name: "Games", color: "#6c8cff" }], entries: [], backlog: [1, 2, 3, 4, 5, 6].map(steamItem),
  notes: [], noteCategories: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [],
  settings: { steam: { proxyUrl: PROXY } },
};

const FAKE_WIDGETS = () => {
  window.__bg = [];
  window.__listeners = {};
  const real = {
    holdBackground: (s) => { window.__bg.push(["hold", s.title, s.text]); return Promise.resolve(); },
    releaseBackground: () => { window.__bg.push(["release"]); return Promise.resolve(); },
    addListener: (ev, cb) => { window.__listeners[ev] = cb; return Promise.resolve({ remove() {} }); },
    takeLaunchAction: () => Promise.resolve(window.__launch ? { action: window.__launch } : {}),
  };
  const Widgets = new Proxy(real, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve({})) });
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      App: { addListener: () => Promise.resolve({ remove() {} }), minimizeApp: () => Promise.resolve() },
      Widgets,
    },
  };
};

async function open(b, { native } = {}) {
  const page = await b.newPage({ viewport: { width: 400, height: 860 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  if (native) await page.addInitScript(FAKE_WIDGETS);
  await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route(PROXY + "/**", async (route) => {
    const m = /\/steam-appdetails\/(\d+)/.exec(route.request().url());
    if (!m) return route.fulfill({ headers: CORS, status: 404, body: "" });
    await new Promise((r) => setTimeout(r, 250));
    return route.fulfill({ headers: CORS, contentType: "application/json",
      body: JSON.stringify({ [m[1]]: { success: true, data: { name: "Game " + m[1], release_date: { date: "1 Jan, 2020" } } } }) });
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  return { page, errs };
}

(async () => {
  const b = await chromium.launch();
  const errs = [];

  // ---- a browser ----
  {
    const { page, errs: e } = await open(b);
    check("nothing running, nothing shown", await page.isHidden("#activityPill"));
    page.evaluate(() => window.LifeLogSync.retryUnresolvedSteamTitles()).catch(() => {});
    await page.waitForSelector("#activityPill:not([hidden])", { timeout: 3000 });
    check("a pass over the backlog shows the pill", true);
    await page.click("#activityPill");
    await page.waitForSelector("#activityModal:not([hidden]) .activity-row.is-running");
    await page.waitForFunction(() => /of 6/.test(document.querySelector(".activity-row.is-running .activity-meta").textContent));
    check("its row says what it is and how far along", (await page.textContent(".activity-row.is-running .activity-label")) === "Retrying unresolved Steam titles"
      && /\d of 6/.test(await page.textContent(".activity-row.is-running .activity-meta")), await page.textContent(".activity-row.is-running .activity-meta"));
    check("with a bar that fills", /%/.test(await page.getAttribute(".activity-row.is-running .activity-fill", "style") || ""));

    // A second pass on Steam waits for the first.
    page.evaluate(() => window.LifeLogJobs.run({ label: "Checking your Steam wishlist", lane: "steam" }, (job) => job.sleep(300))).catch(() => {});
    await page.waitForTimeout(100);
    const queued = await page.$(".activity-row.is-queued");
    check("a second Steam pass waits its turn", !!queued
      && /Waiting for retrying unresolved steam titles/.test(await page.textContent(".activity-row.is-queued .activity-meta")),
      queued && await page.textContent(".activity-row.is-queued .activity-meta"));
    check("and the pill says how far the first is, and that one more waits", /^\d\/6 · Retrying/.test(await page.textContent("#activityPillText"))
      && (await page.textContent("#activityPillMore")) === "+1", await page.textContent("#activityPill"));
    check("Stop all shows with two going", await page.isVisible("#activityStopAllBtn"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const pill = await page.locator("#activityPill").boundingBox();
    const fab = await page.locator(".fab-wrap .fab").boundingBox();
    check("the pill floats across from the +, clear of it", pill && fab && pill.x + pill.width < fab.x && Math.abs((pill.y + pill.height / 2) - (fab.y + fab.height / 2)) < 6, { pill, fab });
    await page.screenshot({ path: (process.env.SHOTS || "/tmp") + "/activity-pill.png" });
    await page.click("#activityPill");
    await page.waitForTimeout(300);
    await page.screenshot({ path: (process.env.SHOTS || "/tmp") + "/activity-phone.png" });

    await page.waitForFunction(() => window.LifeLogJobs.active()[0].done >= 2, null, { timeout: 5000 });
    await page.click(".activity-row.is-running .activity-stop");
    await page.waitForFunction(() => !document.querySelector(".activity-row.is-running .activity-label")
      || document.querySelector(".activity-row.is-running .activity-label").textContent !== "Retrying unresolved Steam titles", null, { timeout: 5000 });
    const titles = await page.evaluate(() => window.LifeLogApp && JSON.parse(localStorage.getItem("lifelog-cache-v1")).backlog.map((x) => x.title));
    const resolved = titles.filter((t) => /^Game /.test(t)).length;
    check("stopping keeps the titles it had resolved, and no more", resolved >= 2 && resolved < 6, titles);
    const stoppedRow = page.locator(".activity-row.is-stopped", { hasText: "Retrying" });
    check("its row reads as stopped, with what it did", await stoppedRow.count() === 1
      && /Stopped after \d of 6 — resolved \d/.test(await stoppedRow.locator(".activity-meta").textContent()),
      await stoppedRow.locator(".activity-meta").textContent().catch(() => ""));
    check("the waiting pass started once the lane was free", await page.evaluate(() =>
      window.LifeLogJobs.list().some((j) => j.label === "Checking your Steam wishlist" && j.state !== "queued")));
    await page.evaluate(() => window.LifeLogJobs.stopAll());
    await page.waitForFunction(() => !window.LifeLogJobs.active().length, null, { timeout: 5000 });
    check("with nothing running the pill goes", await page.isHidden("#activityPill"));
    check("finished work can be cleared", await page.isVisible("#activityClearBtn"));
    await page.click("#activityClearBtn");
    check("leaving the empty state", (await page.textContent("#activityList")).startsWith("Nothing running"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("Escape closes it", await page.isHidden("#activityModal"));

    // A failure keeps the button up until it's been seen.
    await page.evaluate(() => window.LifeLogJobs.run({ label: "Checking something" }, async () => { throw new Error("Steam answered 503"); }).catch(() => {}));
    check("a failure leaves the pill up, marked", await page.isVisible("#activityPill.is-failed"));
    await page.click("#activityPill");
    check("its row says why", (await page.textContent(".activity-row.is-failed .activity-meta")).startsWith("Steam answered 503"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("once seen, the pill goes", await page.isHidden("#activityPill"));

    // Settings → Activity, any time.
    await page.click("#settingsBtn");
    await page.waitForSelector("#settingsActivityRow");
    check("Settings says nothing is running", (await page.textContent("#settingsActivityStatus")) === "Nothing running");
    await page.click("#settingsActivityRow");
    await page.waitForTimeout(300);
    check("and opens Activity", await page.isVisible("#activityModal") && await page.isHidden("#settingsModal"));
    await page.keyboard.press("Escape");

    // Desktop width.
    await page.setViewportSize({ width: 1280, height: 860 });
    page.evaluate(() => window.LifeLogJobs.run({ label: "Re-checking release dates", lane: "media" }, async (job) => {
      for (let i = 0; i < 40 && !job.stopping; i++) { job.progress(i, 40, "Title " + i); await job.sleep(100); }
    })).catch(() => {});
    await page.waitForSelector("#activityBtn:not([hidden])");
    check("on a desktop the pill gives way to a header button", await page.isHidden("#activityPill"));
    const box = await page.locator("#activityBtn").boundingBox();
    const gear = await page.locator("#settingsBtn").boundingBox();
    check("on a desktop it sits beside Settings", box && gear && Math.abs(box.y - gear.y) < 8 && box.x < gear.x, { box, gear });
    await page.click("#activityBtn");
    await page.waitForTimeout(400);
    await page.screenshot({ path: (process.env.SHOTS || "/tmp") + "/activity-desktop.png" });
    await page.evaluate(() => window.LifeLogJobs.stopAll());
    errs.push(...e);
    await page.close();
  }

  // ---- a pass the app was closed on (0.245.0) ----
  {
    const { page, errs: e } = await open(b);
    page.evaluate(() => window.LifeLogSync.retryUnresolvedSteamTitles()).catch(() => {});
    await page.waitForFunction(() => window.LifeLogJobs.active().length && window.LifeLogJobs.active()[0].done >= 5, null, { timeout: 8000 });
    const note = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-jobs-running-v1") || "[]"));
    check("a pass that can be run again is noted while it runs", note.length === 1 && note[0].again === "steamRetry", note);
    // Closed mid-pass: a reload doesn't let it end.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).backlog.filter((x) => /^Game /.test(x.title)).length);
    check("what it had done by then is saved, every 5", kept >= 5 && kept < 6, kept);
    check("the next open says it didn't finish", await page.isVisible("#activityPill") && /Didn't finish/.test(await page.textContent("#activityPillText")), await page.textContent("#activityPill"));
    await page.click("#activityPill");
    await page.waitForSelector(".activity-row.is-unfinished");
    check("Activity offers to run it again", (await page.textContent(".activity-row.is-unfinished .activity-label")) === "Retrying unresolved Steam titles"
      && await page.isVisible(".activity-row.is-unfinished .activity-stop"));
    await page.click(".activity-row.is-unfinished .activity-stop");
    await page.waitForSelector(".activity-row.is-running", { timeout: 3000 });
    check("Run again starts it", (await page.textContent(".activity-row.is-running .activity-label")) === "Retrying unresolved Steam titles"
      && !(await page.$(".activity-row.is-unfinished")));
    await page.waitForFunction(() => !window.LifeLogJobs.active().length, null, { timeout: 8000 });
    check("and once it ends, the note goes", await page.evaluate(() => !localStorage.getItem("lifelog-jobs-running-v1")));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    // Dismissed rather than run.
    await page.evaluate(() => localStorage.setItem("lifelog-jobs-running-v1", JSON.stringify([{ page: "gone", id: 1, again: "releases", label: "Re-checking release dates", at: Date.now() }])));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.click("#activityPill");
    await page.waitForSelector(".activity-row.is-unfinished");
    await page.click(".activity-row.is-unfinished .activity-dismiss");
    check("✕ lets it go", !(await page.$(".activity-row.is-unfinished")));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("and the pill with it", await page.isHidden("#activityPill"));
    errs.push(...e);
    await page.close();
  }

  // ---- the phone app ----
  {
    const { page, errs: e } = await open(b, { native: true });
    const run = page.evaluate(() => window.LifeLogJobs.run({ label: "Syncing Steam Wishlist", lane: "steam" }, async (job) => {
      for (let i = 0; i < 50 && !job.stopping; i++) { job.progress(i, 50); await job.sleep(60); }
      return "ran";
    }));
    await page.waitForTimeout(1500);
    const bg = await page.evaluate(() => window.__bg);
    check("the phone is told what's running, and how far", bg.length >= 1 && bg[0][0] === "hold" && bg[0][1] === "Syncing Steam Wishlist" && / of 50$/.test(bg[0][2]), bg);
    check("updates are paced, not one per item", bg.length <= 3, bg.length);
    await page.evaluate(() => window.__listeners.stopWork && window.__listeners.stopWork());
    await run;
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({ bg: window.__bg, state: window.LifeLogJobs.list().find((j) => j.label === "Syncing Steam Wishlist").state }));
    check("the notification's Stop stops the work", after.state === "stopped", after.state);
    check("and with nothing left the phone is let go", after.bg[after.bg.length - 1][0] === "release", after.bg);

    // A save to GitHub keeps the app awake too, but isn't listed.
    await page.evaluate(() => window.LifeLogJobs.begin({ label: "Saving to GitHub", listed: false, stoppable: false }));
    await page.waitForTimeout(50);
    check("an unlisted save holds the phone without showing in the app", await page.isHidden("#activityPill")
      && (await page.evaluate(() => window.__bg[window.__bg.length - 1][0])) === "hold");

    // Tapping the notification opens Activity, over whatever is up.
    page.evaluate(() => window.LifeLogJobs.run({ label: "Re-checking release dates", lane: "media" }, (job) => job.sleep(3000))).catch(() => {});
    await page.evaluate(() => { window.__launch = "open-activity"; window.__listeners.action(); });
    await page.waitForSelector("#activityModal:not([hidden])", { timeout: 3000 });
    check("tapping the notification opens Activity", true);
    check("which says the work keeps going put away", /keep going with the app put away/.test(await page.textContent("#activityHint")));
    errs.push(...e);
    await page.close();
  }

  await b.close();
  done(errs);
})();
