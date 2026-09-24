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
  window.__cap = { minimized: 0, opened: [], back: null, scans: 0, installs: 0, progress: [] };
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

async function openApp(browser, { native = true, latestTag = null, cache = doc([], null), gh = null, remote = null, serviceWorkers = "block", hasTouch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers, hasTouch });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  if (native) await page.addInitScript(FAKE_BRIDGE);
  await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BUILD) }));
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

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
