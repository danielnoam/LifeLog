// The Android app (0.174.0): the same files, inside Capacitor.
//
// There is no Android here, so the bridge is faked the way Capacitor
// presents itself to a page — `window.Capacitor` with isNativePlatform() and
// a Plugins map — before any of the app's scripts run. What this can prove is
// everything the page decides for itself on finding it: no service worker, a
// newer APK noticed and offered, the back gesture closing what's open before
// it leaves, and setup links that work without an address bar. What it can't
// prove is that Android's WebView agrees, which is the first launch's job.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const note = (id, text, stamp) => ({ id, text, createdAt: stamp, updatedAt: stamp });
const doc = (notes, exportedAt) => ({
  categories: [], entries: [], backlog: [], notes, todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {}, exportedAt,
});
const BUILD = { version: "0.0.0", repo: "someone/lifelog", webUrl: "https://someone.github.io/lifelog/" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

// What Capacitor's native bridge puts on the page, as far as LifeLog uses it.
const FAKE_BRIDGE = () => {
  window.__cap = { minimized: 0, opened: [], back: null };
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      App: {
        addListener: (ev, cb) => { if (ev === "backButton") window.__cap.back = cb; return Promise.resolve({ remove() {} }); },
        minimizeApp: () => { window.__cap.minimized++; return Promise.resolve(); },
      },
    },
  };
  window.open = (url) => { window.__cap.opened.push(String(url)); return null; };
};

async function openApp(browser, { native = true, latestTag = null, cache = doc([], null), gh = null, remote = null, serviceWorkers = "block" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  if (native) await page.addInitScript(FAKE_BRIDGE);
  await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BUILD) }));
  const github = { puts: [] };
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = req.url();
    const say = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (/\/releases\/latest$/.test(url)) return latestTag ? say(200, { tag_name: latestTag }) : say(404, { message: "Not Found" });
    if (/\/user$/.test(url)) return say(200, { login: "someone" });
    if (/\/repos\/someone\/lifelog-data$/.test(url)) return say(200, { default_branch: "main" });
    if (/\/commits/.test(url)) return say(200, []);
    if (req.method() === "PUT") {
      github.puts.push(JSON.parse(Buffer.from(JSON.parse(req.postData()).content, "base64").toString()));
      return say(200, { content: { sha: "sha-" + github.puts.length } });
    }
    return remote ? say(200, { sha: "sha-remote", size: 100, encoding: "base64", content: b64(remote) }) : say(404, { message: "Not Found" });
  });
  // networkidle, not load: the first boot fetches the demo seed and caches
  // it, and under a full run that write could land after the setup below.
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.evaluate(({ cache, gh }) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    if (cache) localStorage.setItem("lifelog-cache-v1", JSON.stringify(cache));
    if (gh) localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
  }, { cache, gh });
  await page.goto("about:blank");
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  return { page, ctx, errs, dialogs, github };
}

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // ---- 1. a browser is still a browser ----
  {
    const { page, ctx, errs: e } = await openApp(browser, { native: false, serviceWorkers: "allow" });
    const r = await page.evaluate(async () => ({
      native: window.LifeLogPlatform.native,
      sw: !!(await navigator.serviceWorker.getRegistration()),
    }));
    check("in a browser nothing thinks it's the app", r.native === false, r);
    check("and the service worker still registers there", r.sw, r);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 2. the app has no service worker ----
  {
    const { page, ctx, errs: e } = await openApp(browser, { serviceWorkers: "allow" });
    const r = await page.evaluate(async () => ({
      native: window.LifeLogPlatform.native,
      regs: (await navigator.serviceWorker.getRegistrations()).length,
      build: window.LifeLogPlatform.build,
    }));
    check("inside the app it knows it's the app", r.native === true, r);
    check("and registers no service worker — its files are already on the phone", r.regs === 0, r);
    check("it reads what its build says about itself", r.build && r.build.repo === BUILD.repo, r.build);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 3. a newer APK is noticed and offered ----
  {
    const { page, ctx, errs: e } = await openApp(browser, { latestTag: "app-v9.9.9" });
    const bar = await page.evaluate(() => ({
      shown: !document.querySelector("#updateBar").hidden,
      text: document.querySelector("#updateBarText").textContent,
      button: document.querySelector("#updateReloadBtn").textContent,
    }));
    check("a newer release puts the update bar up", bar.shown && /9\.9\.9/.test(bar.text), bar);
    check("offering a download rather than a reload, which would change nothing", bar.button === "Download", bar);
    // Clicked from the page rather than by Playwright: if the bar never
    // showed, that is the failure above, not a reason to stop the suite.
    await page.evaluate(() => document.querySelector("#updateReloadBtn").click());
    const opened = await page.evaluate(() => window.__cap.opened);
    check("and the download is the latest release's APK from the repo it was built from",
      opened[0] === "https://github.com/someone/lifelog/releases/latest/download/LifeLog.apk", opened);
    errs.push(...e);
    await ctx.close();
  }
  const OWN = "app-v" + require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "app.js"), "utf8")
    .match(/APP_VERSION = "([^"]+)"/)[1];
  for (const [label, tag] of [["the same version", OWN], ["an older one", "app-v0.0.1"], ["a tag that isn't a version", "nightly"]]) {
    const { page, ctx, errs: e } = await openApp(browser, { latestTag: tag });
    check("no update bar for " + label, await page.evaluate(() => document.querySelector("#updateBar").hidden));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 4. Android's back gesture ----
  {
    const { page, ctx, errs: e } = await openApp(browser);
    check("the back gesture is listened for", await page.evaluate(() => typeof window.__cap.back === "function"));
    await page.click("#settingsBtn");
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => !!document.querySelector(".modal-overlay:not([hidden])"));
    await page.evaluate(() => window.__cap.back && window.__cap.back({ canGoBack: false }));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      open: !!document.querySelector(".modal-overlay:not([hidden])"),
      minimized: window.__cap.minimized,
    }));
    check("with a sheet open, back closes it", before && !after.open, { before, after });
    check("and doesn't leave the app while doing so", after.minimized === 0, after);

    // Nothing is open here if back worked; if it didn't, that already
    // failed above, and the open sheet shouldn't block the next check.
    await page.keyboard.press("Escape");
    await page.click("#addBtn");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__cap.back && window.__cap.back({ canGoBack: false }));
    await page.waitForTimeout(200);
    check("the add menu closes the same way",
      await page.evaluate(() => document.querySelector("#addMenu").hidden && window.__cap.minimized === 0));

    await page.evaluate(() => window.__cap.back && window.__cap.back({ canGoBack: false }));
    await page.waitForTimeout(200);
    check("with nothing open, back puts the app away", await page.evaluate(() => window.__cap.minimized === 1));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 5. joining by pasting a setup link ----
  // A link opens a browser, and the app has no address bar to open one in,
  // so the token box takes the whole link.
  const LINK = "https://someone.github.io/lifelog/#t=ghp_fake&o=someone&r=lifelog-data&p=lifelog.json&b=main";
  const remote = doc([note("r", "From the desktop", "2026-09-10T00:00:00.000Z")], "2026-09-10T00:00:00.000Z");
  async function pasteLink(page) {
    await page.click("#settingsBtn");
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const t = [...document.querySelectorAll(".settings-tabs button, .settings-tabs [data-tab]")].find((b) => /data|sync/i.test(b.textContent));
      if (t) t.click();
    });
    await page.waitForTimeout(200);
    await page.fill("#ghToken", LINK);
    await page.click("#ghConnectBtn");
    await page.waitForTimeout(1800);
  }
  {
    const { page, ctx, errs: e, dialogs, github } = await openApp(browser, { remote, cache: doc([], null) });
    await pasteLink(page);
    const texts = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).notes.map((n) => n.text));
    check("a pasted setup link connects a fresh app", await page.evaluate(() => !!JSON.parse(localStorage.getItem("lifelog-github-v1") || "null")));
    check("and brings the synced log with it", texts.includes("From the desktop"), texts);
    check("without asking which copy should win", dialogs.length === 0, dialogs);
    check("and without ever writing an empty log over the synced one",
      github.puts.every((d) => (d.notes || []).length > 0), github.puts.map((d) => (d.notes || []).length));
    errs.push(...e);
    await ctx.close();
  }
  {
    const offline = doc([note("l", "Written on the train", "2026-09-12T00:00:00.000Z")], "2026-09-12T00:00:00.000Z");
    const { page, ctx, errs: e, dialogs, github } = await openApp(browser, { remote, cache: offline });
    await pasteLink(page);
    const last = github.puts[github.puts.length - 1];
    const texts = last ? last.notes.map((n) => n.text).sort() : [];
    check("an app used before it was connected keeps its own notes and gains the synced ones",
      texts.join("|") === "From the desktop|Written on the train", texts);
    check("again without a which-copy-wins question", dialogs.length === 0, dialogs);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 6. a setup link made inside the app works on another device ----
  {
    const gh = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake", sha: "sha-remote" };
    const { page, ctx, errs: e } = await openApp(browser, { remote, gh });
    await page.click("#settingsBtn");
    await page.waitForTimeout(400);
    const share = await page.evaluate(() => ({
      link: document.querySelector("#ghSetupLink").value,
      localWarn: !document.querySelector("#ghLocalWarn").hidden,
      qr: !document.querySelector("#ghQr").hidden,
    }));
    check("the app's setup link points at the web copy, not at its own localhost",
      share.link.startsWith(BUILD.webUrl + "#"), share.link.slice(0, 60));
    check("so there's no 'this link only works on this computer' warning, and there is a QR code",
      !share.localWarn && share.qr, share);
    errs.push(...e);
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
