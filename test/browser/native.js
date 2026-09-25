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
  window.__cap = { minimized: 0, opened: [], back: null, scans: 0, installs: 0, progress: [], barStyles: [], browsed: [],
    written: [], shared: [], downloads: [], fsProgress: [], installers: [], deleted: [], inAppTab: [],
    widgetSnaps: [], widgetListeners: {}, askedToNotify: 0, notifySettings: 0, bioAsks: [] };
  // What the widgets have waiting for the app; a test can set it at launch.
  window.__widgetPlan = window.__widgetPlanAtLaunch || { queue: [], action: null };
  // What the file plugins will do; tests change it before acting.
  window.__filePlan = { downloadFails: false, shareCancels: false, installerFails: false, cacheFiles: [] };
  // What the next scan will do; tests set it before pressing the button.
  window.__scanPlan = { available: true, result: null, error: null };
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      App: {
        addListener: (ev, cb) => { if (ev === "backButton") window.__cap.back = cb; return Promise.resolve({ remove() {} }); },
        minimizeApp: () => { window.__cap.minimized++; return Promise.resolve(); },
      },
      // @capacitor/filesystem, as far as LifeLog uses it.
      Filesystem: {
        writeFile: async ({ path, data, directory, encoding }) => {
          window.__cap.written.push({ path, data, directory, encoding });
          return { uri: "file:///data/user/0/app/cache/" + path };
        },
        addListener: async (ev, cb) => {
          if (ev === "progress") window.__cap.fsProgress.push(cb);
          return { remove() { window.__cap.fsProgress = window.__cap.fsProgress.filter((x) => x !== cb); } };
        },
        downloadFile: async ({ url, path, directory, progress }) => {
          window.__cap.downloads.push({ url, path, directory, progress });
          for (const f of [0.25, 0.5, 1]) {
            await new Promise((r) => setTimeout(r, window.__filePlan.slow ? 800 : 90));
            if (window.__filePlan.downloadFails && f === 0.5) throw new Error("connection reset");
            window.__cap.fsProgress.forEach((cb) => cb({ url, bytes: f * 4000000, contentLength: 4000000 }));
          }
          return { path: "/data/user/0/app/cache/" + path };
        },
        getUri: async ({ path }) => ({ uri: "file:///data/user/0/app/cache/" + path }),
        readdir: async () => ({ files: window.__filePlan.cacheFiles.map((name) => ({ name, type: "file" })) }),
        deleteFile: async ({ path }) => { window.__cap.deleted.push(path); },
      },
      // @capawesome-team/capacitor-file-opener: Android's installer, for an APK.
      FileOpener: {
        openFile: async ({ path, mimeType }) => {
          window.__cap.installers.push({ path, mimeType });
          if (window.__filePlan.installerFails) throw new Error("No activity found");
        },
      },
      // @capacitor/share: Android's share sheet.
      Share: {
        share: async (opts) => {
          window.__cap.shared.push(opts);
          if (window.__filePlan.shareCancels) throw new Error("Share canceled");
        },
      },
      // @capacitor/app-launcher: hands a link to Android, which opens the
      // phone's own browser app.
      AppLauncher: { openUrl: async ({ url }) => { window.__cap.browsed.push(url); window.__cap.opened.push(url); return { completed: true }; } },
      // @capacitor/browser (Chrome's in-app tab) — present only so a test can
      // prove it's no longer what outside links use.
      Browser: { open: async ({ url }) => { window.__cap.inAppTab.push(url); } },
      // LifeLog's own widgets plugin (native/widgets/): the snapshot out, the
      // widget's ticks and button presses in.
      Widgets: {
        update: async ({ json }) => { window.__cap.widgetSnaps.push(JSON.parse(json)); },
        takeQueue: async () => { const items = window.__widgetPlan.queue; window.__widgetPlan.queue = []; return { items }; },
        takeLaunchAction: async () => { const a = window.__widgetPlan.action; window.__widgetPlan.action = null; return a ? { action: a } : {}; },
        addListener: async (ev, cb) => { (window.__cap.widgetListeners[ev] = window.__cap.widgetListeners[ev] || []).push(cb); return { remove() {} }; },
        // Android's notification permission, for habit reminders.
        notificationState: async () => ({ state: window.__widgetPlan.notify || "prompt" }),
        askForNotifications: async () => {
          window.__cap.askedToNotify++;
          window.__widgetPlan.notify = window.__widgetPlan.answer || "granted";
          return { state: window.__widgetPlan.notify };
        },
        openNotificationSettings: async () => { window.__cap.notifySettings++; },
        // Android's own fingerprint / face sheet, for the app lock.
        biometricState: async () => ({ state: window.__widgetPlan.bio || "available" }),
        authenticate: async ({ title }) => {
          window.__cap.bioAsks.push(title);
          const a = window.__widgetPlan.bioAnswer || "ok";
          return { ok: a === "ok", reason: a, message: a === "error" ? "Too many attempts" : "" };
        },
      },
      // Capacitor's own SystemBars.
      SystemBars: { setStyle: async ({ style }) => { window.__cap.barStyles.push(style); } },
      // @capacitor-mlkit/barcode-scanning, as far as LifeLog uses it.
      BarcodeScanner: {
        isGoogleBarcodeScannerModuleAvailable: async () => ({ available: !!window.__scanPlan.available }),
        installGoogleBarcodeScannerModule: async () => {
          window.__cap.installs++;
          setTimeout(() => {
            window.__scanPlan.available = true;
            for (const cb of window.__cap.progress.slice()) { cb({ state: 2, progress: 40 }); cb({ state: 4, progress: 100 }); }
          }, 60);
        },
        addListener: async (ev, cb) => {
          if (ev === "googleBarcodeScannerModuleInstallProgress") window.__cap.progress.push(cb);
          return { remove() { window.__cap.progress = window.__cap.progress.filter((x) => x !== cb); } };
        },
        scan: async () => {
          window.__cap.scans++;
          if (!window.__scanPlan.available) throw new Error("module not installed");
          if (window.__scanPlan.error) throw new Error(window.__scanPlan.error);
          return { barcodes: window.__scanPlan.result ? [{ rawValue: window.__scanPlan.result, format: "QR_CODE" }] : [] };
        },
      },
    },
  };
  window.open = (url) => { window.__cap.opened.push(String(url)); return null; };
};

// The page exactly as the app bundles it: tools/build-www.js marks its copy
// of index.html edge-to-edge (viewport-fit=cover, class="native").
const { appIndexHtml } = require("../../tools/build-www.js");
const BUNDLED_HTML = appIndexHtml(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "index.html"), "utf8"));

async function openApp(browser, { native = true, latestTag = null, cache = doc([], null), gh = null, remote = null, serviceWorkers = "block", hasTouch = false, bundled = false, visual = null, widgets = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers, hasTouch });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  // Before the bridge, which picks it up: what the widgets hold at launch.
  // Only for the second load below — the first boots on the demo seed, which
  // has to-dos of its own for a queue to land on.
  if (widgets) await page.addInitScript((plan) => {
    const n = +(sessionStorage.getItem("__boots") || 0) + 1;
    sessionStorage.setItem("__boots", String(n));
    if (n >= 2) window.__widgetPlanAtLaunch = plan;
  }, widgets);
  if (native) await page.addInitScript(FAKE_BRIDGE);
  await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BUILD) }));
  if (bundled) await page.route(BASE + "/", (r) => r.fulfill({ status: 200, contentType: "text/html", body: BUNDLED_HTML }));
  // `remote`, `sha` and `down` can be changed mid-test to stage what the
  // other device did, or GitHub being unreachable.
  const github = { puts: [], remote, sha: "sha-remote", down: false, reads: 0, delay: 0 };
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = req.url();
    const say = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (/\/releases\/latest$/.test(url)) return latestTag ? say(200, { tag_name: latestTag }) : say(404, { message: "Not Found" });
    if (github.down) return route.abort();
    if (/\/user$/.test(url)) return say(200, { login: "someone" });
    if (/\/repos\/someone\/lifelog-data$/.test(url)) return say(200, { default_branch: "main" });
    if (/\/commits/.test(url)) return say(200, []);
    if (req.method() === "PUT") {
      github.puts.push(JSON.parse(Buffer.from(JSON.parse(req.postData()).content, "base64").toString()));
      github.remote = github.puts[github.puts.length - 1];
      github.sha = "sha-" + github.puts.length;
      return say(200, { content: { sha: github.sha } });
    }
    github.reads++;
    if (github.delay) await new Promise((r) => setTimeout(r, github.delay));
    return github.remote ? say(200, { sha: github.sha, size: 100, encoding: "base64", content: b64(github.remote) }) : say(404, { message: "Not Found" });
  });
  // networkidle, not load: the first boot fetches the demo seed and caches
  // it, and under a full run that write could land after the setup below.
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.evaluate(({ cache, gh, visual }) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    if (cache) localStorage.setItem("lifelog-cache-v1", JSON.stringify(cache));
    if (gh) localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
    if (visual) localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(visual));
  }, { cache, gh, visual });
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

  // ---- 3. a newer version is noticed, downloaded in the app, and installed ----
  // No browser tab and no Downloads folder: the app fetches the release's APK
  // itself with its progress on the bar, then opens Android's installer.
  const barNow = (page) => page.evaluate(() => ({
    shown: !document.querySelector("#updateBar").hidden,
    text: document.querySelector("#updateBarText").textContent,
    button: document.querySelector("#updateReloadBtn").textContent,
    busy: document.querySelector("#updateReloadBtn").disabled,
  }));
  const pressUpdate = (page) => page.evaluate(() => document.querySelector("#updateReloadBtn").click());
  {
    const { page, ctx, errs: e } = await openApp(browser, { latestTag: "app-v9.9.9" });
    let bar = await barNow(page);
    check("a newer release puts the update bar up", bar.shown && /9\.9\.9/.test(bar.text), bar);
    check("offering to update, rather than a reload that would change nothing", bar.button === "Update", bar);
    await pressUpdate(page);
    await page.waitForTimeout(140);
    const mid = await barNow(page);
    check("it downloads inside the app, showing how far it's got", /Downloading/.test(mid.text) && /^\d+%$/.test(mid.button) && mid.busy, mid);
    await page.waitForTimeout(500);
    const cap = await page.evaluate(() => ({ ...window.__cap, fsProgress: window.__cap.fsProgress.length }));
    check("the download is that release's APK, into the app's own cache",
      cap.downloads.length === 1 && cap.downloads[0].url === "https://github.com/someone/lifelog/releases/download/app-v9.9.9/LifeLog.apk" &&
      cap.downloads[0].directory === "CACHE" && cap.downloads[0].progress === true, cap.downloads);
    check("then Android's installer is opened on it",
      cap.installers.length === 1 && /LifeLog-9\.9\.9\.apk$/.test(cap.installers[0].path) &&
      cap.installers[0].mimeType === "application/vnd.android.package-archive", cap.installers);
    check("without a browser tab anywhere in it", cap.browsed.length === 0, cap.browsed);
    check("and without leaving its progress listener behind", cap.fsProgress === 0, cap.fsProgress);
    bar = await barNow(page);
    check("if the installer is dismissed, the bar can reopen it", /ready to install/.test(bar.text) && bar.button === "Install" && !bar.busy, bar);
    await pressUpdate(page);
    await page.waitForTimeout(200);
    const again = await page.evaluate(() => ({ downloads: window.__cap.downloads.length, installers: window.__cap.installers.length }));
    check("reopening it doesn't download it all again", again.downloads === 1 && again.installers === 2, again);
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser, { latestTag: "app-v9.9.9" });
    await page.evaluate(() => { window.__filePlan.downloadFails = true; });
    await pressUpdate(page);
    await page.waitForTimeout(600);
    const bar = await barNow(page);
    const installers = await page.evaluate(() => window.__cap.installers.length);
    check("a download that breaks off says so and offers to retry", /didn't finish/.test(bar.text) && bar.button === "Retry" && !bar.busy, bar);
    check("and never hands a half-downloaded APK to the installer", installers === 0, installers);
    await page.evaluate(() => { window.__filePlan.downloadFails = false; });
    await pressUpdate(page);
    await page.waitForTimeout(600);
    check("retrying goes through", await page.evaluate(() => window.__cap.installers.length === 1));
    errs.push(...e);
    await ctx.close();
  }
  {
    // An app from before 0.179.0 has none of the file plugins: for that one
    // update, the bar still goes to the download in Chrome's tab.
    const { page, ctx, errs: e } = await openApp(browser, { latestTag: "app-v9.9.9" });
    await page.evaluate(() => { delete window.Capacitor.Plugins.FileOpener; });
    await pressUpdate(page);
    await page.waitForTimeout(300);
    const cap = await page.evaluate(() => ({ downloads: window.__cap.downloads.length, browsed: window.__cap.browsed }));
    check("an app without the in-app updater falls back to the download in the browser",
      cap.downloads === 0 && cap.browsed[0] === "https://github.com/someone/lifelog/releases/latest/download/LifeLog.apk", cap);
    errs.push(...e);
    await ctx.close();
  }
  {
    // APKs already installed are cleared out of the cache on launch.
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.addInitScript(FAKE_BRIDGE);
    await page.addInitScript(() => { window.__filePlan = { cacheFiles: ["LifeLog-0.0.1.apk", "LifeLog-99.0.0.apk", "lifelog.json"] }; });
    await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BUILD) }));
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.waitForTimeout(900);
    const deleted = await page.evaluate(() => window.__cap.deleted);
    check("on launch, APKs for versions already installed are cleared from the cache — and nothing else",
      deleted.length === 1 && deleted[0] === "LifeLog-0.0.1.apk", deleted);
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

  // ---- 5b. joining never trades your media sources for a fresh app's blanks ----
  // Settings merged as one blob, newer wins, until 0.175.0 — and a new
  // install that has saved anything has the newest blob there is.
  {
    const synced = { ...remote, settings: {
      backlogSort: "title", mediaKeys: { rawg: "RAWG-KEY", tmdb: "TMDB-KEY", ggdeals: "", steamgriddb: "" },
      mediaCategorySources: { Games: "rawg" }, steam: { proxyUrl: "https://proxy.example", steamId: "7656" },
      updatedAt: "2026-09-10T00:00:00.000Z",
    } };
    const freshCache = { ...doc([], null), settings: {
      backlogSort: "title", mediaKeys: { rawg: "", tmdb: "", ggdeals: "", steamgriddb: "" },
      mediaCategorySources: {}, steam: { proxyUrl: "", steamId: "" },
      updatedAt: new Date().toISOString(), // saved just now, so "newer" than everything
    } };
    const { page, ctx, errs: e, github } = await openApp(browser, { remote: synced, cache: freshCache });
    await pasteLink(page);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).settings);
    const pushed = github.puts.length ? github.puts[github.puts.length - 1].settings : null;
    check("a freshly installed app joining keeps the synced media keys",
      kept.mediaKeys.rawg === "RAWG-KEY" && kept.mediaKeys.tmdb === "TMDB-KEY" && kept.steam.proxyUrl === "https://proxy.example", kept);
    check("and what it writes back to GitHub still has them",
      !!pushed && pushed.mediaKeys.rawg === "RAWG-KEY" && pushed.mediaCategorySources.Games === "rawg", pushed);
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

  // ---- 7. connecting by scanning the QR code, inside the app ----
  // The phone's camera opens the QR's link in the browser — it connects the
  // web copy and leaves the app untouched. So the app reads the code itself.
  const openSync = async (page) => {
    await page.click("#settingsBtn");
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const t = [...document.querySelectorAll(".settings-tabs button, .settings-tabs [data-tab]")].find((b) => /data|sync/i.test(b.textContent));
      if (t) t.click();
    });
    await page.waitForTimeout(200);
  };
  const scanShown = (page) => page.evaluate(() => {
    const b = document.querySelector("#ghScanBtn");
    return !!b && getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0;
  });
  {
    const { page, ctx, errs: e } = await openApp(browser, { native: false });
    await openSync(page);
    check("a browser has no Scan button — its camera already does this", !(await scanShown(page)));
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e, dialogs, github } = await openApp(browser, { remote, cache: doc([], null) });
    await openSync(page);
    check("the app has a Scan QR code button", await scanShown(page));
    await page.evaluate((link) => { window.__scanPlan.result = link; }, LINK);
    await page.click("#ghScanBtn");
    await page.waitForTimeout(1800);
    const texts = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).notes.map((n) => n.text));
    check("scanning a setup QR connects the app", await page.evaluate(() => !!JSON.parse(localStorage.getItem("lifelog-github-v1") || "null")));
    check("and brings the synced log, merged like a pasted link, without a question",
      texts.includes("From the desktop") && dialogs.length === 0, { texts, dialogs });
    check("the token box isn't left holding the link", await page.evaluate(() => document.querySelector("#ghToken").value === ""));
    check("and nothing empty was ever written over the synced log", github.puts.every((d) => (d.notes || []).length > 0));
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser, { remote });
    await openSync(page);
    await page.evaluate(() => { window.__scanPlan.error = "scan canceled."; });
    await page.click("#ghScanBtn");
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => { const x = document.querySelector("#toast"); return x && !x.hidden ? x.textContent : ""; });
    check("backing out of the scanner is quiet — it's a choice, not an error", !/Couldn't|isn't/.test(t), t);
    check("and connects nothing", await page.evaluate(() => !localStorage.getItem("lifelog-github-v1")));

    await page.evaluate(() => { window.__scanPlan.error = null; window.__scanPlan.result = "https://example.com/menu"; });
    await page.click("#ghScanBtn");
    await page.waitForTimeout(500);
    const t2 = await page.evaluate(() => { const x = document.querySelector("#toast"); return x && !x.hidden ? x.textContent : ""; });
    check("some other QR code says it isn't a setup link", /isn't a LifeLog setup link/.test(t2), t2);
    check("and still connects nothing", await page.evaluate(() => !localStorage.getItem("lifelog-github-v1")));
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser, { remote, cache: doc([], null) });
    await openSync(page);
    await page.evaluate((link) => { window.__scanPlan.available = false; window.__scanPlan.result = link; }, LINK);
    await page.click("#ghScanBtn");
    await page.waitForTimeout(2000);
    const r = await page.evaluate(() => ({
      installs: window.__cap.installs, scans: window.__cap.scans,
      connected: !!localStorage.getItem("lifelog-github-v1"), listeners: window.__cap.progress.length,
    }));
    check("with the scanner module missing, it's installed first", r.installs === 1, r);
    check("and the scan goes ahead once it has, rather than failing the first try", r.scans === 1 && r.connected, r);
    check("without leaving its progress listener behind", r.listeners === 0, r);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 8. pull down to sync ----
  // A browser's pull reloads the page, and the reload is what syncs. The app
  // has no such gesture, so it has its own — which syncs rather than reloads.
  const pull = (page, { dy = 240, dx = 0, steps = 8 } = {}) => page.evaluate(async ({ dy, dx, steps }) => {
    const t = (x, y) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
    const fire = (type, x, y) => document.body.dispatchEvent(new TouchEvent(type, {
      touches: type === "touchend" ? [] : [t(x, y)], changedTouches: [t(x, y)], bubbles: true, cancelable: true,
    }));
    const seen = [];
    fire("touchstart", 200, 150);
    for (let i = 1; i <= steps; i++) {
      fire("touchmove", 200 + (dx * i) / steps, 150 + (dy * i) / steps);
      await new Promise((r) => requestAnimationFrame(r));
      const t = getComputedStyle(document.querySelector("#content")).translate;
      const y = t === "none" ? 0 : parseFloat(t.split(" ")[1] || "0");
      // Tolerates a missing arrow, so a build without one fails these
      // checks instead of taking the rest of the suite down with it.
      const icon = document.querySelector("#pullIcon");
      const ir = icon ? icon.getBoundingClientRect() : {};
      const ics = icon ? getComputedStyle(icon) : { display: "none" };
      const svg = icon && icon.querySelector("svg");
      const top = Math.min(...["#filterSlot", "#content"].map((q) => document.querySelector(q).getBoundingClientRect().top));
      seen.push({
        y, shown: y > 0, armed: document.documentElement.classList.contains("pull-armed"),
        icon: { shown: ics.display !== "none", top: ir.top, bottom: ir.bottom, bg: ics.backgroundColor, shadow: ics.boxShadow,
          turn: svg ? getComputedStyle(svg).transform : "none" },
        pageTop: top, barBottom: document.querySelector(".topbar").getBoundingClientRect().bottom,
      });
    }
    fire("touchend", 200 + dx, 150 + dy);
    seen.push({ statusAtRelease: (document.querySelector(".storage-status") || {}).textContent || "" });
    return seen;
  }, { dy, dx, steps });
  const toastNow = (page) => page.evaluate(() => { const x = document.querySelector("#toast"); return x && !x.hidden ? x.textContent : ""; });
  const connected = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake", sha: "sha-remote" };
  {
    const { page, ctx, errs: e, github } = await openApp(browser, { remote, cache: remote, gh: connected, hasTouch: true });
    check("the app turns off the WebView's own overscroll, so the two don't fight",
      await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY === "none"));

    const readsBefore = github.reads;
    const seen = await pull(page);
    const moves = seen.filter((x) => "y" in x);
    check("pulling down from the top moves the page itself with the finger",
      moves[0].y > 0 && moves.every((m, i) => i === 0 || m.y >= moves[i - 1].y), moves.map((m) => Math.round(m.y)));
    check("against a resistance — the page travels less than the finger did",
      moves[moves.length - 1].y < 240 * 0.5, moves[moves.length - 1].y);
    const last = moves[moves.length - 1];
    check("the arrow is drawn on the background — no bubble behind it",
      last.icon.shown && /rgba\(0, 0, 0, 0\)|transparent/.test(last.icon.bg) && last.icon.shadow === "none", last.icon);
    check("it sits in the gap the pull opened, under the top bar and above the page",
      last.icon.top >= last.barBottom - 1 && last.icon.bottom <= last.pageTop + 1, { icon: last.icon, pageTop: last.pageTop, bar: last.barBottom });
    const gaps = moves.filter((m) => m.icon.shown).map((m) => Math.round(m.pageTop - m.icon.bottom));
    check("and comes down with the page, the same distance above it the whole way",
      gaps.length > 2 && gaps.every((g) => Math.abs(g - gaps[0]) <= 1), gaps);
    check("winding round as you pull", new Set(moves.map((m) => m.icon.turn)).size > 3, moves.map((m) => m.icon.turn));
    check("pulled far enough, it counts", moves[moves.length - 1].armed, moves[moves.length - 1]);
    check("and the status line says it's syncing the moment you let go",
      /Syncing/.test(seen[seen.length - 1].statusAtRelease), seen[seen.length - 1]);
    await page.waitForTimeout(1200);
    check("letting go syncs", github.reads > readsBefore, { before: readsBefore, after: github.reads });
    check("and with nothing new, it says so rather than nothing", /Up to date/.test(await toastNow(page)), await toastNow(page));
    check("the page springs back home, holding nothing that would pin fixed children",
      await page.evaluate(() => getComputedStyle(document.querySelector("#content")).translate === "none" &&
        !document.documentElement.classList.contains("pulling") &&
        (!document.querySelector("#pullIcon") || getComputedStyle(document.querySelector("#pullIcon")).display === "none")));

    // A slow GitHub, to watch it think: the page holds a little way down and
    // the arrow spins in place until the answer comes, then both go home.
    github.delay = 1200;
    await pull(page);
    await page.waitForTimeout(500);
    const thinking = await page.evaluate(() => {
      const t = getComputedStyle(document.querySelector("#content")).translate;
      const icon = document.querySelector("#pullIcon");
      const ir = icon ? icon.getBoundingClientRect() : {};
      return {
        y: t === "none" ? 0 : parseFloat(t.split(" ")[1] || "0"),
        spinning: icon ? getComputedStyle(icon.querySelector("svg")).animationName : "none",
        iconShown: !!icon && getComputedStyle(icon).display !== "none",
        iconBottom: ir.bottom,
        pageTop: document.querySelector("#content").getBoundingClientRect().top,
        status: document.querySelector(".storage-status").textContent,
      };
    });
    check("while it syncs, the page holds a little way down instead of snapping back", Math.abs(thinking.y - 52) < 3, thinking);
    check("and the arrow spins in place there, so you can see it working",
      thinking.iconShown && thinking.spinning === "pull-spin" && thinking.iconBottom <= thinking.pageTop + 1, thinking);
    check("with the status line saying so", /Syncing/.test(thinking.status), thinking.status);
    await page.waitForTimeout(1400);
    const done = await page.evaluate(() => ({
      translate: getComputedStyle(document.querySelector("#content")).translate,
      icon: document.querySelector("#pullIcon") ? getComputedStyle(document.querySelector("#pullIcon")).display : "none",
      classes: document.documentElement.className,
    }));
    check("when the answer comes, page and arrow go back up together and leave nothing behind",
      done.translate === "none" && done.icon === "none" && !/pull/.test(done.classes), done);
    github.delay = 0;

    // The other device saves something; the pull brings it in.
    github.remote = doc([...remote.notes, note("n2", "Saved on the desktop a moment ago", "2026-09-23T20:00:00.000Z")], "2026-09-23T20:00:00.000Z");
    github.sha = "sha-desktop";
    await pull(page);
    await page.waitForTimeout(1500);
    check("a pull after the other device saved brings its change in",
      /Saved on the desktop a moment ago/.test(await page.evaluate(() => document.querySelector("#viewBody").innerText)));
    check("and says what it merged", /Merged/.test(await toastNow(page)), await toastNow(page));

    // Short pulls, sideways drags and pulls from further down do nothing.
    let r0 = github.reads;
    await pull(page, { dy: 90 });
    await page.waitForTimeout(700);
    check("a short pull that never reached the mark syncs nothing", github.reads === r0, { r0, now: github.reads });
    r0 = github.reads;
    const side = await pull(page, { dy: 60, dx: -260 });
    await page.waitForTimeout(700);
    check("a sideways drag is the mode swipe's, not a pull", side.every((x) => !x.shown) && github.reads === r0, side);
    await page.evaluate(() => { document.querySelector("#viewBody").style.minHeight = "3000px"; window.scrollTo(0, 400); });
    r0 = github.reads;
    const mid = await pull(page);
    await page.waitForTimeout(700);
    check("pulling down anywhere but the top just scrolls", mid.every((x) => !x.shown) && github.reads === r0, mid);
    await page.evaluate(() => window.scrollTo(0, 0));

    await page.click("#settingsBtn");
    await page.waitForTimeout(300);
    r0 = github.reads;
    const over = await pull(page);
    await page.waitForTimeout(700);
    check("and a pull over an open sheet does nothing", over.every((x) => !x.shown) && github.reads === r0, over);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    github.down = true;
    await pull(page);
    await page.waitForTimeout(1200);
    check("with GitHub unreachable it says so, instead of 'Up to date'",
      /offline|Couldn't sync/.test(await toastNow(page)) && !/Up to date/.test(await toastNow(page)), await toastNow(page));
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser, { native: false, remote, cache: remote, gh: connected, hasTouch: true });
    const seen = await pull(page);
    check("a browser keeps its own pull — the app's isn't added there",
      seen.every((x) => !x.shown) && await page.evaluate(() => !document.documentElement.classList.contains("native")), seen);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 9. first launch: edges, status bar, outside links, back ----
  // The things that can only be *seen* on a phone, checked here for what the
  // page decides: that it runs edge to edge with its content clear of the
  // bars, that the bar icons follow LifeLog's theme, that nothing outside
  // the app can load inside it, and that back returns before it leaves.
  {
    const { page, ctx, errs: e } = await openApp(browser, { bundled: true, visual: { forceLayout: "mobile" } });
    const vp = await page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
    check("the app's page asks to run under the status and gesture bars", /viewport-fit=cover/.test(vp), vp);
    check("and keeps asking after the layout setting rewrites the viewport", /width=400/.test(vp) && /viewport-fit=cover/.test(vp), vp);

    // Capacitor injects the real bar sizes as CSS variables.
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-inset-top", "24px");
      document.documentElement.style.setProperty("--safe-area-inset-bottom", "20px");
    });
    await page.waitForTimeout(100);
    const edge = await page.evaluate(() => {
      const bar = document.querySelector(".topbar");
      const cs = getComputedStyle(bar);
      const logo = bar.querySelector(".brand, h1, .logo") || bar.firstElementChild;
      const nav = document.querySelector(".topbar-bottom");
      return {
        border: parseFloat(cs.borderTopWidth), borderColor: cs.borderTopColor, bg: cs.backgroundColor,
        logoTop: logo.getBoundingClientRect().top,
        navPad: nav ? parseFloat(getComputedStyle(nav).paddingBottom) : null,
      };
    });
    check("the top bar's own colour fills the status bar", edge.border === 24 && edge.borderColor === edge.bg, edge);
    check("and its contents start below it", edge.logoTop >= 24, edge.logoTop);
    check("the bottom tab bar keeps clear of the gesture bar", edge.navPad === 20, edge.navPad);
    await page.click("#settingsBtn");
    await page.waitForTimeout(300);
    const sheet = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("#settingsModal, .modal-overlay:not([hidden])")).paddingTop));
    check("a sheet opens clear of the status bar too", sheet === 44, sheet);

    // Outside links go to Chrome's tab; nothing loads into the app itself.
    const here = page.url();
    await page.evaluate(() => {
      const a = [...document.querySelectorAll("a[href^='https://github.com']")].find((x) => x.offsetParent);
      (a || document.querySelector("a[href^='https://github.com']")).click();
    });
    await page.waitForTimeout(200);
    const browsed = await page.evaluate(() => window.__cap.browsed);
    check("an outside link opens in the phone's own browser, as its own app", browsed.some((u) => /^https:\/\/github\.com\//.test(u)), browsed);
    check("not in Chrome's in-app tab, which still reads as being inside LifeLog",
      (await page.evaluate(() => window.__cap.inAppTab.length)) === 0, await page.evaluate(() => window.__cap.inAppTab));
    check("and the app's own page stays where it was", page.url() === here, page.url());
    await page.evaluate(() => window.open("https://example.com/somewhere"));
    check("window.open to the outside goes the same way",
      (await page.evaluate(() => window.__cap.browsed)).includes("https://example.com/somewhere"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // Status bar icons follow LifeLog's theme, not the phone's.
    const darkStyles = await page.evaluate(() => window.__cap.barStyles.slice());
    check("on LifeLog's dark theme the bar icons are light", darkStyles[darkStyles.length - 1] === "DARK", darkStyles);

    // Back, if the page has somewhere to go back to, goes there first.
    const went = await page.evaluate(() => {
      let backed = 0; const real = history.back.bind(history);
      history.back = () => { backed++; };
      const before = window.__cap.minimized;
      window.__cap.back({ canGoBack: true });
      history.back = real;
      return { backed, minimized: window.__cap.minimized - before };
    });
    check("back returns from a page the app navigated to, rather than leaving the app", went.backed === 1 && went.minimized === 0, went);
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser, { bundled: true, visual: { theme: "light" } });
    const styles = await page.evaluate(() => window.__cap.barStyles.slice());
    check("on LifeLog's light theme the bar icons are dark", styles[styles.length - 1] === "LIGHT", styles);
    errs.push(...e);
    await ctx.close();
  }
  {
    // The web copy: none of it.
    const { page, ctx, errs: e } = await openApp(browser, { native: false });
    await page.evaluate(() => document.documentElement.style.setProperty("--safe-area-inset-top", "24px"));
    const web = await page.evaluate(() => ({
      vp: document.querySelector('meta[name="viewport"]').content,
      border: parseFloat(getComputedStyle(document.querySelector(".topbar")).borderTopWidth),
    }));
    check("the web copy doesn't go edge to edge or grow a top border", !/viewport-fit/.test(web.vp) && web.border === 0, web);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 10. exports ----
  // A download link does nothing in the app's WebView, so exports went
  // nowhere. In the app they're written to the cache and handed to Android's
  // share sheet — Drive, Files, email — and in a browser they stay a download.
  const exportFrom = async (page) => {
    await page.click("#settingsBtn");
    await page.waitForTimeout(300);
    await page.click('.stab[data-stab="backup"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.__linkDownloads = [];
      const real = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute("download")) window.__linkDownloads.push(this.download); else real.call(this); };
    });
    await page.click("#exportJsonBtn");
    await page.waitForTimeout(400);
  };
  {
    const withNotes = doc([note("x", "Exported note", "2026-09-01T00:00:00.000Z")], "2026-09-01T00:00:00.000Z");
    const { page, ctx, errs: e } = await openApp(browser, { cache: withNotes });
    await exportFrom(page);
    const r = await page.evaluate(() => ({ written: window.__cap.written, shared: window.__cap.shared, links: window.__linkDownloads }));
    const w = r.written[0] || {};
    let parsed = null;
    try { parsed = JSON.parse(w.data); } catch (err) { /* checked below */ }
    check("exporting in the app writes the file to the app's cache",
      w.path === "lifelog.json" && w.directory === "CACHE" && w.encoding === "utf8", { path: w.path, directory: w.directory, encoding: w.encoding });
    check("with the whole log in it", !!parsed && parsed.notes.some((n) => n.text === "Exported note"), (w.data || "").slice(0, 80));
    check("and hands it to Android's share sheet", r.shared.length === 1 && r.shared[0].files[0] === "file:///data/user/0/app/cache/lifelog.json", r.shared);
    check("rather than a download link the app would ignore", r.links.length === 0, r.links);
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser);
    await page.evaluate(() => { window.__filePlan.shareCancels = true; });
    await exportFrom(page);
    const t = await page.evaluate(() => { const x = document.querySelector("#toast"); return x && !x.hidden ? x.textContent : ""; });
    check("closing the share sheet is a choice, not an error", !/Couldn't export/.test(t), t);
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser, { native: false });
    await exportFrom(page);
    const links = await page.evaluate(() => window.__linkDownloads);
    check("in a browser, exporting is still an ordinary download", links.length === 1 && links[0] === "lifelog.json", links);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 11. a pull also checks for a newer app ----
  {
    const { page, ctx, errs: e } = await openApp(browser, { remote, cache: remote, gh: connected, hasTouch: true });
    check("with nothing newer out, there's no update bar", await page.evaluate(() => document.querySelector("#updateBar").hidden));
    // A release goes out while the app is open.
    await page.route("https://api.github.com/repos/someone/lifelog/releases/latest",
      (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tag_name: "app-v9.9.9" }) }));
    await pull(page);
    await page.waitForTimeout(1300);
    const bar = await page.evaluate(() => ({ hidden: document.querySelector("#updateBar").hidden, text: document.querySelector("#updateBarText").textContent }));
    check("pulling to refresh finds a release that came out since the app opened", !bar.hidden && /9\.9\.9/.test(bar.text), bar);
    // Halfway through downloading it, pull again: the bar must carry on.
    await page.evaluate(() => { window.__filePlan.slow = true; document.querySelector("#updateReloadBtn").click(); });
    await page.waitForTimeout(120);
    await pull(page);
    await page.waitForTimeout(80);
    const during = await page.evaluate(() => ({ text: document.querySelector("#updateBarText").textContent, busy: document.querySelector("#updateReloadBtn").disabled }));
    check("and a second pull doesn't reset a download that's under way", /Downloading/.test(during.text) && during.busy, during);
    errs.push(...e);
    await ctx.close();
  }
  {
    // Not connected to GitHub sync at all: the app update check still runs.
    const { page, ctx, errs: e } = await openApp(browser, { hasTouch: true });
    await page.route("https://api.github.com/repos/someone/lifelog/releases/latest",
      (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tag_name: "app-v9.9.9" }) }));
    await pull(page);
    await page.waitForTimeout(1300);
    check("a pull checks for a newer app even on a device that isn't syncing",
      await page.evaluate(() => !document.querySelector("#updateBar").hidden && /9\.9\.9/.test(document.querySelector("#updateBarText").textContent)));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 12. home-screen widgets ----
  {
    const today = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); })();
    const withLists = () => ({
      ...doc([], "2026-09-01T00:00:00.000Z"),
      habits: [{ id: "h1", name: "Stretch", color: "#22aa66", cadence: "daily", target: 1, order: 0, startedAt: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
      todos: [
        { id: "t1", text: "Buy milk", order: 0, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
        { id: "t2", text: "Post the letter", order: 1, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      ],
    });
    const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));
    const lastSnap = (page) => page.evaluate(() => window.__cap.widgetSnaps[window.__cap.widgetSnaps.length - 1] || null);

    // Ticks made on the widgets while the app was closed.
    const { page, ctx, errs: e } = await openApp(browser, {
      cache: withLists(),
      widgets: { queue: [
        { kind: "habit", id: "h1", date: today, value: 1, at: "2026-09-24T07:00:00.000Z" },
        { kind: "todo", id: "t1", done: true, at: "2026-09-24T07:01:00.000Z" },
      ], action: null },
    });
    await page.waitForTimeout(600);
    let d = await stored(page);
    check("a habit ticked on the widget is ticked in the app when it opens", d.habits[0].marks && d.habits[0].marks[today] === 1, d.habits[0]);
    check("and a to-do ticked there is done, as of when it was ticked",
      d.todos[0].done === true && d.todos[0].doneAt === "2026-09-24T07:01:00.000Z", d.todos[0]);
    check("the app says where the ticks came from", /2 ticks from your home-screen widget/.test(await page.evaluate(() => document.querySelector("#toast").textContent)));
    let snap = await lastSnap(page);
    check("the widgets are sent the list with the ticks in it",
      !!snap && snap.todos.filter((t) => !t.done).map((t) => t.id).join() === "t2" && snap.habits[0].marks[today] === 1, snap);
    check("the finished one goes too, under the open ones, for the widget's done list",
      !!snap && snap.todos.map((t) => t.id + (t.done ? "✓" : "")).join() === "t2,t1✓" && snap.doneCount[""] === 1, snap && snap.todos);
    check("and the quick-add buttons for every tab that's on",
      !!snap && ["add-entry", "add-expense", "add-note", "add-todo"].every((a) => snap.actions.includes(a)), snap && snap.actions);

    // A tick while the app is running arrives as a nudge.
    await page.evaluate((today) => {
      window.__widgetPlan.queue.push({ kind: "todo", id: "t2", done: true, at: "2026-09-24T08:00:00.000Z" });
      (window.__cap.widgetListeners.queued || []).forEach((cb) => cb({}));
    }, today);
    await page.waitForTimeout(700);
    d = await stored(page);
    check("a tick made while the app is open lands straight away", d.todos[1].done === true, d.todos[1]);

    // The widget's +, with the app already open.
    const before = await page.evaluate(() => window.__cap.widgetSnaps.length);
    await page.evaluate(() => {
      window.__widgetPlan.action = "add-todo";
      (window.__cap.widgetListeners.action || []).forEach((cb) => cb({}));
    });
    await page.waitForTimeout(500);
    const ui = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-ui-v1")));
    check("the widget's + opens the to-do list, ready to type into",
      ui.view === "notes" && ui.notesMode === "todo" && await page.evaluate(() => (document.activeElement || {}).id === "todoCompose"), ui);
    await page.fill("#todoCompose", "From the widget's +");
    await page.press("#todoCompose", "Enter");
    await page.waitForTimeout(900);
    snap = await lastSnap(page);
    check("and what's added in the app goes back out to the widget",
      (await page.evaluate(() => window.__cap.widgetSnaps.length)) > before && snap.todos.some((t) => t.text === "From the widget's +"), snap && snap.todos);
    errs.push(...e);
    await ctx.close();
  }
  {
    // A widget button that launched the app, and tabs that are turned off.
    const { page, ctx, errs: e } = await openApp(browser, { visual: { disabledViews: ["finance"] }, widgets: { queue: [], action: "open-habits" } });
    await page.waitForTimeout(500);
    const ui = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-ui-v1")));
    check("a widget header that launched the app lands on habits", ui.view === "notes" && ui.notesMode === "habits", ui);
    const snap = await page.evaluate(() => window.__cap.widgetSnaps[window.__cap.widgetSnaps.length - 1]);
    check("a quick-add button for a tab that's off isn't offered", !!snap && !snap.actions.includes("add-expense") && snap.actions.includes("add-note"), snap && snap.actions);
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser, { native: false });
    check("a browser has no widgets to talk to, and nothing tries", await page.evaluate(() => !window.__cap));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 13. habit reminders, and the rest of the quick-add buttons ----
  {
    const withHabit = {
      ...doc([], "2026-09-01T00:00:00.000Z"),
      habits: [
        { id: "h1", name: "Stretch", color: "#22aa66", cadence: "daily", target: 1, order: 0, startedAt: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "h2", name: "Read", color: "#aa2266", cadence: "daily", target: 1, order: 1, startedAt: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    };
    const lastSnap = (page) => page.evaluate(() => window.__cap.widgetSnaps[window.__cap.widgetSnaps.length - 1] || null);
    const { page, ctx, errs: e } = await openApp(browser, { cache: withHabit });
    // Set in the habit itself.
    await page.evaluate(() => window.LifeLogHabits.openHabitModal(window.LifeLogHabits.getFilteredHabits().find((h) => h.id === "h1")));
    check("the habit form offers a reminder time in the app", await page.evaluate(() => !document.querySelector("#habitRemindLabel").hidden));
    await page.fill("#habitRemind", "21:30");
    await page.click("#habitForm button[type=submit]");
    await page.waitForTimeout(900);
    let snap = await lastSnap(page);
    const h1 = snap && snap.habits.find((h) => h.id === "h1");
    check("the time goes to the phone with the habit", !!h1 && h1.remind === "21:30", h1);
    check("and only that habit's", !!snap && snap.habits.find((h) => h.id === "h2").remind === "", snap && snap.habits);
    check("the first reminder asks for permission to notify, once", await page.evaluate(() => window.__cap.askedToNotify) === 1);
    check("it stays on this phone rather than in the synced habit",
      await page.evaluate(() => !("remind" in JSON.parse(localStorage.getItem("lifelog-cache-v1")).habits[0]) && JSON.parse(localStorage.getItem("lifelog-habit-reminders-v1")).times.h1 === "21:30"));
    check("the widget is sent the run to count its streak on from", !!h1 && typeof h1.runBefore === "number", h1);

    // On the cards themselves.
    await page.evaluate(() => { localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "habits" })); });
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1000);
    const chips = await page.evaluate(() => [...document.querySelectorAll(".habit-card")].map((c) => [c.dataset.id, (c.querySelector(".habit-remind-face") || {}).textContent || null]));
    check("each habit card shows its reminder, or a bell to set one", JSON.stringify(chips) === JSON.stringify([["h1", "🔔 21:30"], ["h2", "🔔"]]), chips);
    await page.evaluate(() => {
      const input = document.querySelector('.habit-card[data-id="h2"] .habit-remind-input');
      input.value = "07:15";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(700);
    snap = await lastSnap(page);
    check("a time set on the card goes to the phone", snap.habits.find((h) => h.id === "h2").remind === "07:15", snap.habits);
    check("and the card says so", await page.evaluate(() => document.querySelector('.habit-card[data-id="h2"] .habit-remind-face').textContent === "🔔 07:15"));
    check("one line above the cards counts them", await page.evaluate(() => /2 reminders on this phone/.test(document.querySelector(".habit-remind-bar").textContent)));
    await page.click('.habit-card[data-id="h2"] .habit-remind-clear');
    await page.waitForTimeout(700);
    snap = await lastSnap(page);
    check("the ✕ takes a reminder off", snap.habits.find((h) => h.id === "h2").remind === "" &&
      await page.evaluate(() => !document.querySelector('.habit-card[data-id="h2"] .habit-remind-clear')), snap.habits);
    await page.click(".habit-remind-bar button");
    await page.waitForTimeout(700);
    snap = await lastSnap(page);
    check("pausing them sends no times, so nothing rings", snap.habits.every((h) => h.remind === ""), snap.habits);
    check("and the line and the card say they're paused",
      await page.evaluate(() => /paused/.test(document.querySelector(".habit-remind-bar").textContent) && /🔕/.test(document.querySelector('.habit-card[data-id="h1"] .habit-remind-face').textContent)));
    check("the time is kept for resuming", await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-habit-reminders-v1")).times.h1 === "21:30"));
    await page.click(".habit-remind-bar button");
    await page.waitForTimeout(500);
    check("with permission given there's nothing to warn about", await page.evaluate(() => document.querySelector(".habit-remind-warn").hidden));
    check("and Settings has no reminders section any more", await page.evaluate(() => !document.querySelector("#remindersSection")));
    errs.push(...e);
    await ctx.close();
  }
  {
    // Said no to Android's question: the line over the cards says so, and where to fix it.
    const { page, ctx, errs: e } = await openApp(browser, { widgets: { queue: [], action: null, notify: "denied" } });
    await page.evaluate(() => {
      localStorage.setItem("lifelog-habit-reminders-v1", JSON.stringify({ on: true, times: { x: "09:00" } }));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "habits" }));
      const d = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
      d.habits = [{ id: "x", name: "Walk", color: "#2266aa", cadence: "daily", target: 1, order: 0, startedAt: "2026-01-01" }];
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(d));
    });
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1200);
    const warn = await page.evaluate(() => { const w = document.querySelector(".habit-remind-warn"); return w && !w.hidden ? w.textContent : ""; });
    check("blocked notifications are named over the habits, with the way to Android's settings", /blocking/.test(warn) && /Android's settings/.test(warn), warn);
    await page.click(".habit-remind-warn button");
    check("which the button opens", await page.evaluate(() => window.__cap.notifySettings) === 1);
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser, { widgets: { queue: [], action: "add-backlog" } });
    await page.waitForTimeout(500);
    check("the quick-add widget's Backlog button opens the backlog form", await page.evaluate(() => !document.querySelector("#backlogModal").hidden));
    const snap = await page.evaluate(() => window.__cap.widgetSnaps[window.__cap.widgetSnaps.length - 1]);
    check("and is offered while the Backlog tab is on", !!snap && snap.actions.includes("add-backlog"), snap && snap.actions);
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser, { native: false });
    await page.evaluate(() => window.LifeLogHabits.openHabitModal(null));
    check("a browser shows no reminder field and no bell",
      await page.evaluate(() => document.querySelector("#habitRemindLabel").hidden && !document.querySelector(".habit-remind")));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 14b. the spend widget's numbers ----
  {
    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date();
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    const thisM = y + "-" + pad(m), prevY = m === 1 ? y - 1 : y, prevM = m === 1 ? 12 : m - 1;
    const lastM = prevY + "-" + pad(prevM);
    const fe = (id, date, amount, category) => ({ id, date, amount, category, note: "", createdAt: date + "T10:00:00.000Z", updatedAt: date + "T10:00:00.000Z" });
    const withMoney = {
      ...doc([], "2026-09-01T00:00:00.000Z"),
      settings: { currency: "ILS" },
      financeCategories: [{ name: "Groceries", color: "#3bb2e2" }, { name: "Rent", color: "#e2723b" }, { name: "Books", color: "#b23be2" }, { name: "Fun", color: "#22aa66" }],
      financeEntries: [
        fe("a", thisM + "-01", 1200, "Rent"),
        fe("b", thisM + "-01", 340.4, "Groceries"),
        fe("c", thisM + "-01", 90, "Books"),
        fe("d", thisM + "-01", 20, "Fun"),
        fe("e", lastM + "-01", 500, "Groceries"),
        // Later in last month than today's date: not "by this day".
        ...(day < 28 ? [fe("f", lastM + "-28", 9999, "Groceries")] : []),
      ],
    };
    const { page, ctx, errs: e } = await openApp(browser, { cache: withMoney, widgets: { queue: [], action: null } });
    await page.waitForTimeout(600);
    const snap = await page.evaluate(() => window.__cap.widgetSnaps[window.__cap.widgetSnaps.length - 1]);
    const sp = snap && snap.spend;
    check("the spend widget gets this month's total, in whole shekels", !!sp && sp.total === "₪1,650" && sp.month === thisM, sp);
    check("against last month by this day, not the whole of it", !!sp && /^₪500 by this day in /.test(sp.compare), sp && sp.compare);
    check("and the three categories most of it went on, with their colours",
      !!sp && sp.cats.map((c) => c.name + " " + c.amount).join(", ") === "Rent ₪1,200, Groceries ₪340, Books ₪90" && sp.cats[0].color === "#e2723b", sp && sp.cats);
    await page.evaluate(() => {
      window.__widgetPlan.action = "open-finance";
      (window.__cap.widgetListeners.action || []).forEach((cb) => cb({}));
    });
    await page.waitForTimeout(300);
    check("tapping it opens the Ledger", await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-ui-v1")).view === "finance"));
    errs.push(...e);
    await ctx.close();
  }
  {
    const { page, ctx, errs: e } = await openApp(browser, { visual: { disabledViews: ["finance"] }, widgets: { queue: [], action: null } });
    await page.waitForTimeout(500);
    const snap = await page.evaluate(() => window.__cap.widgetSnaps[window.__cap.widgetSnaps.length - 1]);
    check("with the Ledger turned off, there's no spending to send", !!snap && snap.spend === null, snap && snap.spend);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 14a. a habit tapped on the widget opens on that habit ----
  {
    const withHabits = {
      ...doc([], "2026-09-01T00:00:00.000Z"),
      habits: ["Stretch", "Read", "Walk", "Water", "Sleep", "Write"].map((name, i) => ({
        id: "h" + i, name, color: "#22aa66", cadence: "daily", target: 1, order: i,
        startedAt: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      })),
    };
    const { page, ctx, errs: e } = await openApp(browser, { cache: withHabits, widgets: { queue: [], action: null } });
    // The app is open on Notes; the habit is tapped on the home screen.
    await page.evaluate(() => {
      window.__widgetPlan.action = "open-habit:h5";
      (window.__cap.widgetListeners.action || []).forEach((cb) => cb({}));
    });
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => {
      const ui = JSON.parse(localStorage.getItem("lifelog-ui-v1"));
      const card = document.querySelector('.habit-card[data-id="h5"]');
      const r = card && card.getBoundingClientRect();
      return { view: ui.view, mode: ui.notesMode, lit: !!card && card.classList.contains("habit-flash"),
        onScreen: !!r && r.top >= 0 && r.bottom <= innerHeight };
    });
    check("tapping a habit on the widget opens the app on that habit, in view and lit",
      st.view === "notes" && st.mode === "habits" && st.lit && st.onScreen, st);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 14. the app lock's fingerprint, with Android's own sheet ----
  {
    // PIN 1234, hashed the way app.js's hashPin does it.
    const PIN = { pinSalt: "abcd", pinHash: "ef53952abc7954443575c3ee91322dce7d70e261ddc310a7cc9e5475309e30df" };
    const locked = (extra) => ({ enabled: true, graceMinutes: 0, lastUnlockAt: 0, credentialId: null, ...PIN, ...extra });
    const reopen = async (page, privacy) => {
      await page.evaluate((p) => localStorage.setItem("lifelog-privacy-v1", JSON.stringify(p)), privacy);
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(900);
    };
    const lockUp = (page) => page.evaluate(() => !document.querySelector("#lockScreen").hidden);

    // Setting it up, in Settings.
    const a = await openApp(browser, { widgets: { queue: [], action: null } });
    await a.page.evaluate((p) => localStorage.setItem("lifelog-privacy-v1", JSON.stringify(p)), { ...locked(), enabled: false });
    await a.page.reload({ waitUntil: "load" });
    await a.page.waitForTimeout(900);
    await a.page.evaluate(() => { document.querySelector("#settingsBtn").click(); });
    await a.page.click('.stab[data-stab="privacy"]');
    await a.page.waitForTimeout(300);
    check("the app offers fingerprint unlock, which the WebView alone never could",
      await a.page.evaluate(() => !document.querySelector("#setBioBtn").hidden && document.querySelector("#privacyBioUnavailable").hidden));
    await a.page.click("#setBioBtn");
    await a.page.waitForTimeout(300);
    const saved = await a.page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-privacy-v1")));
    check("setting it up asks Android's sheet once, and remembers it's Android's",
      saved.credentialId === "android-biometric" && (await a.page.evaluate(() => window.__cap.bioAsks.length)) === 1, { saved, asks: await a.page.evaluate(() => window.__cap.bioAsks) });
    errs.push(...a.errs);
    await a.ctx.close();

    // Opening a locked app: the sheet comes up by itself and a finger opens it.
    const b = await openApp(browser, { widgets: { queue: [], action: null } });
    await reopen(b.page, locked({ credentialId: "android-biometric" }));
    check("a locked app asks for a finger as it opens", await b.page.evaluate(() => window.__cap.bioAsks[0] === "Unlock LifeLog"), await b.page.evaluate(() => window.__cap.bioAsks));
    check("and a recognised one lets you in", !(await lockUp(b.page)));
    errs.push(...b.errs);
    await b.ctx.close();

    // Choosing the PIN instead isn't a failure.
    const c = await openApp(browser, { widgets: { queue: [], action: null, bioAnswer: "cancelled" } });
    await reopen(c.page, locked({ credentialId: "android-biometric" }));
    const st = await c.page.evaluate(() => ({ locked: !document.querySelector("#lockScreen").hidden, err: document.querySelector("#lockError").hidden ? "" : document.querySelector("#lockError").textContent }));
    check("backing out to the PIN leaves the lock up, without an error", st.locked && st.err === "", st);
    await c.page.fill("#lockPinInput", "1234");
    await c.page.press("#lockPinInput", "Enter");
    await c.page.waitForTimeout(400);
    check("and the PIN still opens it", !(await lockUp(c.page)));
    errs.push(...c.errs);
    await c.ctx.close();

    // A sensor that refuses is.
    const d = await openApp(browser, { widgets: { queue: [], action: null, bioAnswer: "error" } });
    await reopen(d.page, locked({ credentialId: "android-biometric" }));
    check("a finger Android won't take says so", await d.page.evaluate(() => /Couldn't verify/.test(document.querySelector("#lockError").textContent) && !document.querySelector("#lockError").hidden));
    errs.push(...d.errs);
    await d.ctx.close();

    // A phone that could, with nothing set up.
    const f = await openApp(browser, { widgets: { queue: [], action: null, bio: "none-enrolled" } });
    await f.page.evaluate(() => { document.querySelector("#settingsBtn").click(); });
    await f.page.click('.stab[data-stab="privacy"]');
    await f.page.waitForTimeout(300);
    check("with no fingerprint on the phone, Settings says where to add one",
      await f.page.evaluate(() => !document.querySelector("#privacyBioUnavailable").hidden && /Android's settings/.test(document.querySelector("#privacyBioUnavailable").textContent) && document.querySelector("#setBioBtn").hidden));
    errs.push(...f.errs);
    await f.ctx.close();

    // The browser keeps its own way (WebAuthn), which headless Chromium lacks.
    const g = await openApp(browser, { native: false });
    await g.page.evaluate(() => { document.querySelector("#settingsBtn").click(); });
    await g.page.click('.stab[data-stab="privacy"]');
    await g.page.waitForTimeout(300);
    check("a browser still asks WebAuthn, not the app's plugin",
      await g.page.evaluate(() => !window.__cap && /this device or browser/.test(document.querySelector("#privacyBioUnavailable").textContent)));
    errs.push(...g.errs);
    await g.ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
