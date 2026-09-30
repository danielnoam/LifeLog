// The iOS app (0.216.0): the same files, inside Capacitor on an iPhone. What
// differs from Android is decided by LifeLogPlatform.ios, and this pins those
// differences down with the bridge faked as iOS presents itself — no APK
// updater, no Play services scanner module, no widgets plugin, and the
// backup in the app's own Documents, which the Files app shows as
// On My iPhone → LifeLog. What it can't prove is WKWebView itself: that's
// the first sideloaded launch's job.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const BUILD = { version: "0.0.0", repo: "someone/lifelog", webUrl: "https://someone.github.io/lifelog/" };
const DOC = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], projects: [], habits: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {},
  notes: [{ id: "n1", text: "On an iPhone", createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z" }],
};

const FAKE_IOS = () => {
  window.__ios = { opened: [], scans: 0, askedModule: 0, downloads: 0, files: {} };
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
    Plugins: {
      App: {
        addListener: (ev, cb) => { if (ev === "appUrlOpen") window.__ios.urlOpen = cb; return Promise.resolve({ remove() {} }); },
        // Opened from a widget: the link it was opened with (0.217.0).
        getLaunchUrl: async () => (window.__launchUrl ? { url: window.__launchUrl } : undefined),
      },
      // The iOS Widgets plugin (native/widgets/ios): snapshot out, queue in.
      Widgets: {
        update: async ({ json }) => { window.__ios.snaps = (window.__ios.snaps || 0) + 1; window.__ios.lastSnap = JSON.parse(json); },
        takeQueue: async () => ({ items: (window.__ios.queue || []).splice(0) }),
        takeLaunchAction: async () => ({}),
        notePins: async () => ({ ids: [] }),
        addListener: async () => ({ remove() {} }),
        biometricState: async () => ({ state: "available" }),
        notificationState: async () => ({ state: "granted" }),
      },
      AppLauncher: { openUrl: async ({ url }) => { window.__ios.opened.push(url); return { completed: true }; } },
      Filesystem: {
        requestPermissions: async () => ({ publicStorage: "granted" }),
        writeFile: async ({ path, data, directory }) => { window.__ios.files[directory + ":" + path] = data; return { uri: "file:///" + path }; },
        readdir: async () => ({ files: [] }),
        deleteFile: async () => {},
        downloadFile: async () => { window.__ios.downloads++; return {}; },
      },
      BarcodeScanner: {
        // Android-only: calling it on iOS is the bug this guards against.
        isGoogleBarcodeScannerModuleAvailable: async () => { window.__ios.askedModule++; throw new Error("Not implemented on iOS."); },
        scan: async () => { window.__ios.scans++; return { barcodes: [{ rawValue: "not a setup link" }] }; },
      },
    },
  };
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.addInitScript(FAKE_IOS);
  await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BUILD) }));
  // The catch-all first: Playwright asks the most recently added route first.
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route("https://api.github.com/repos/someone/lifelog/releases/latest",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tag_name: "app-v9.9.9" }) }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((d) => {
    localStorage.clear();
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(d));
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
  }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  check("the app knows it's on iOS", await page.evaluate(() =>
    window.LifeLogPlatform.native && window.LifeLogPlatform.ios && !window.LifeLogPlatform.android
    && document.documentElement.classList.contains("native")));

  // ---- a newer release ----
  await page.waitForFunction(() => !document.getElementById("updateBar").hidden, null, { timeout: 5000 }).catch(() => {});
  const bar = await page.evaluate(() => ({ hidden: document.getElementById("updateBar").hidden,
    text: document.getElementById("updateBarText").textContent, btn: document.getElementById("updateReloadBtn").textContent }));
  check("a newer release is offered", !bar.hidden && /9\.9\.9/.test(bar.text), bar);
  await page.click("#updateReloadBtn");
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__ios);
  check("and opens the release page rather than downloading an APK an iPhone can't install",
    bar.btn === "Get it" && after.opened.includes("https://github.com/someone/lifelog/releases/latest") && after.downloads === 0, { bar, after });

  // ---- scanning a setup code ----
  await page.click("#settingsBtn");
  await page.waitForTimeout(300);
  await page.click('.srow[data-page="sync"]');
  await page.waitForTimeout(300);
  check("Scan QR code is offered", await page.evaluate(() => !document.getElementById("ghScanBtn").hidden));
  await page.click("#ghScanBtn");
  await page.waitForTimeout(400);
  const scan = await page.evaluate(() => ({ ...window.__ios, toast: document.getElementById("toast").textContent }));
  check("it scans with the camera and never asks for Google's scanner module", scan.scans === 1 && scan.askedModule === 0, scan);
  check("and reads what it scanned like Android does", /isn't a LifeLog setup link/.test(scan.toast), scan.toast);

  // ---- the backup ----
  check("the phone backup is offered, and the desktop file isn't", await page.evaluate(() =>
    !document.getElementById("phoneBackupSection").hidden && document.getElementById("backupFileSection").hidden));
  await page.click('label:has(#phoneBackupSwitch)');
  await page.waitForTimeout(500);
  const files = await page.evaluate(() => window.__ios.files);
  check("it writes to the app's own Documents, which Files shows as On My iPhone → LifeLog",
    /On an iPhone/.test(files["DOCUMENTS:lifelog.json"] || "") && Object.keys(files).some((k) => k.startsWith("DOCUMENTS:daily/"))
    && !Object.keys(files).some((k) => k.startsWith("DOCUMENTS:LifeLog/")), Object.keys(files));
  check("and says where to find it", await page.evaluate(() =>
    /On My iPhone → LifeLog/.test(document.getElementById("phoneBackupInfo").textContent)),
    await page.evaluate(() => document.getElementById("phoneBackupInfo").textContent));

  // ---- opened from a widget ----
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.addInitScript(() => { window.__launchUrl = "lifelog://action/add-note"; });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  check("opened by a widget's link, the app goes where the widget said", await page.evaluate(() => !document.getElementById("noteModal").hidden));
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__ios.urlOpen({ url: "lifelog://action/open-habits" }));
  await page.waitForTimeout(500);
  check("and a link that arrives while it's open does too", await page.evaluate(() =>
    document.querySelector('#viewTabs .tab[data-view="notes"]').classList.contains("active") && !!document.querySelector(".habit-today, .empty-state")));
  check("the widgets get their snapshot", await page.evaluate(() => window.__ios.snaps > 0 && Array.isArray(window.__ios.lastSnap.notes)));
  check("Face ID is offered for the app lock", await page.evaluate(async () => {
    document.getElementById("settingsBtn").click();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('.srow[data-page="lock"]').click();
    await new Promise((r) => setTimeout(r, 400));
    return !document.getElementById("setBioBtn").hidden && document.getElementById("privacyBioUnavailable").hidden;
  }));
  check("and no folder import an iPhone can't do", await page.evaluate(() => document.getElementById("importMdFolderBtn").hidden));

  await b.close();
  done(errs);
})();
