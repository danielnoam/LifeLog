// LifeLog — where this copy of the app is running: a browser, or the Android
// app built from these same files (0.174.0).
//
// The app is one set of files with two homes. GitHub Pages serves them to
// browsers; Capacitor bundles them into an APK (see tools/build-www.js and
// .github/workflows/android.yml). Almost nothing differs between the two,
// and what does is decided here rather than sniffed ad hoc across modules:
//
//   - the app has no service worker: its files are already on the device,
//     and a new version arrives as a new APK rather than a background fetch;
//   - so "a new version is ready" means a newer APK on the repo's Releases
//     page, which the app checks for itself;
//   - the app's own origin is https://localhost, which is no use in a setup
//     link meant for another device, so links point at the web copy instead.
//
// `build` is app-build.json, written into the bundle at build time. It only
// exists inside the app; in a browser it is null and nothing asks for it.
(function () {
  const cap = window.Capacitor;
  const native = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());

  // Also baked into the app's index.html by tools/build-www.js, so the
  // edge-to-edge padding applies from the first frame; this is the same
  // thing again for anything that loads the page some other way.
  if (native) document.documentElement.classList.add("native");

  let build = null;
  const ready = native
    ? fetch("app-build.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => { build = b; return b; })
        .catch(() => null)
    : Promise.resolve(null);

  // Anything that leaves the app — the token page, a release, the APK, a
  // store link — opens in Chrome's in-app tab (the Browser plugin), with its
  // own close button, rather than being loaded into the app's WebView. There
  // it would have no address bar, and back would put the whole app away
  // instead of returning from the page. Capacitor most likely hands such
  // links to the browser already; "most likely" isn't good enough for the
  // one thing that can strand you, so both ways out are routed explicitly:
  // clicks on outside <a> links, and window.open.
  const isOutside = (url) => {
    try {
      const u = new URL(String(url), location.href);
      return /^https?:$/.test(u.protocol) && u.origin !== location.origin;
    } catch (e) { return false; }
  };
  const browser = () => (native && cap.Plugins && cap.Plugins.Browser) || null;
  const nativeOpen = window.open.bind(window);
  function openOutside(url) {
    const B = browser();
    if (B) { B.open({ url: String(url) }); return true; }
    nativeOpen(url, "_blank");
    return true;
  }
  if (native) {
    window.open = (url, target, features) => (isOutside(url) ? (openOutside(url), null) : nativeOpen(url, target, features));
    document.addEventListener("click", (e) => {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a || a.hasAttribute("download") || !isOutside(a.href)) return;
      e.preventDefault();
      openOutside(a.href);
    }, true);
  }

  // ---- files out of the app (0.179.0) ----
  // A browser saves a file when a page clicks a download link; the app's
  // WebView ignores such links, so every export in the app did nothing. In
  // the app the file is written to the app's cache and handed to Android's
  // share sheet — Drive, Files, email, whatever the phone has. Returns false
  // when the plugins aren't there (a browser, or an older app), so the caller
  // falls back to the link.
  async function saveAndShare(filename, text) {
    const FS = native && cap.Plugins && cap.Plugins.Filesystem;
    const SH = native && cap.Plugins && cap.Plugins.Share;
    if (!FS || !SH) return false;
    const { uri } = await FS.writeFile({ path: filename, data: text, directory: "CACHE", encoding: "utf8" });
    try {
      await SH.share({ title: filename, files: [uri], dialogTitle: "Save or send " + filename });
    } catch (e) {
      // Closing the share sheet is a choice, not a failure.
      if (!/cancel/i.test(String(e && e.message || e))) throw e;
    }
    return true;
  }

  // ---- updating the app in place (0.179.0) ----
  // Downloads the release's APK into the app's cache, reporting progress, and
  // hands it to Android's installer — no browser tab, no Downloads folder.
  // The installer is Android's own screen: it asks once whether LifeLog may
  // install apps, and then to install. Because the APK is signed with the
  // same key it installs over the top and keeps everything. Resolves to the
  // file's uri, so a cancelled installer can be reopened without downloading
  // again; null when the plugins aren't there (an app older than this).
  const APK_MIME = "application/vnd.android.package-archive";
  async function downloadUpdate(version, onProgress) {
    const FS = native && cap.Plugins && cap.Plugins.Filesystem;
    if (!FS || !(cap.Plugins && cap.Plugins.FileOpener) || !build || !build.repo) return null;
    const url = "https://github.com/" + build.repo + "/releases/download/app-v" + version + "/LifeLog.apk";
    const path = "LifeLog-" + version + ".apk";
    const listener = await FS.addListener("progress", (p) => {
      if (onProgress && p && p.contentLength > 0) onProgress(Math.min(1, p.bytes / p.contentLength));
    });
    try {
      await FS.downloadFile({ url, path, directory: "CACHE", progress: true });
    } finally {
      if (listener && listener.remove) listener.remove();
    }
    return (await FS.getUri({ path, directory: "CACHE" })).uri;
  }
  function openInstaller(uri) {
    return cap.Plugins.FileOpener.openFile({ path: uri, mimeType: APK_MIME });
  }
  // APKs for versions already installed have done their job.
  async function clearOldUpdates(currentVersion, isNewer) {
    const FS = native && cap.Plugins && cap.Plugins.Filesystem;
    if (!FS) return;
    try {
      const { files } = await FS.readdir({ path: "", directory: "CACHE" });
      for (const f of files || []) {
        const name = typeof f === "string" ? f : f.name;
        const m = /^LifeLog-(\d+\.\d+\.\d+)\.apk$/.exec(name || "");
        if (m && !isNewer(m[1], currentVersion)) await FS.deleteFile({ path: name, directory: "CACHE" });
      }
    } catch (e) { /* nothing to tidy */ }
  }

  window.LifeLogPlatform = {
    native,
    ready,
    get build() { return build; },
    // A native plugin, or null in a browser or when the build doesn't carry it.
    plugin(name) { return (native && cap.Plugins && cap.Plugins[name]) || null; },
    openOutside,
    saveAndShare,
    downloadUpdate,
    openInstaller,
    clearOldUpdates,
    // Where the web copy lives, for links that have to work on another device.
    webUrl() { return (build && build.webUrl) || null; },
    releasesUrl() { return build && build.repo ? "https://github.com/" + build.repo + "/releases/latest" : null; },
    apkUrl() { return build && build.repo ? "https://github.com/" + build.repo + "/releases/latest/download/LifeLog.apk" : null; },
  };
})();
