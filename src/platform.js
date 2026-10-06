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
  // Which phone, since the iOS app (0.216.0): most of the app is the same on
  // both, and what isn't — the APK updater, Google's QR scanner, the widgets
  // plugin, the storage flags — asks this rather than assuming Android.
  const os = native ? String((cap.getPlatform && cap.getPlatform()) || "android") : "web";

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

  // Anything that leaves the app — the token page, a release, a store link —
  // opens in the phone's own browser, as its own app, rather than inside
  // LifeLog. Loaded into the app's WebView it would have no address bar, and
  // back would put the whole app away. 0.178.0 used Chrome's in-app tab (the
  // Browser plugin) for this, and that still reads as being inside LifeLog —
  // so it hands the link to Android instead (AppLauncher: a plain "view this"
  // intent), which opens whatever browser the phone uses. Both ways out are
  // routed: clicks on outside <a> links, and window.open.
  const isOutside = (url) => {
    try {
      const u = new URL(String(url), location.href);
      return /^https?:$/.test(u.protocol) && u.origin !== location.origin;
    } catch (e) { return false; }
  };
  const launcher = () => (native && cap.Plugins && cap.Plugins.AppLauncher) || null;
  const nativeOpen = window.open.bind(window);
  function openOutside(url) {
    const L = launcher();
    if (L) {
      // If Android can't find anything to open it with, fall back to the
      // WebView's own hand-off, which also goes out to the browser.
      Promise.resolve(L.openUrl({ url: String(url) }))
        .then((r) => { if (r && r.completed === false) nativeOpen(url, "_blank"); })
        .catch(() => nativeOpen(url, "_blank"));
      return true;
    }
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
  // `base64: true` writes `text` as the bytes it encodes (a PNG) — the
  // Filesystem plugin takes base64 for binary when no encoding is given.
  async function saveAndShare(filename, text, opts = {}) {
    const FS = native && cap.Plugins && cap.Plugins.Filesystem;
    const SH = native && cap.Plugins && cap.Plugins.Share;
    if (!FS || !SH) return false;
    const file = { path: filename, data: text, directory: "CACHE" };
    if (!opts.base64) file.encoding = "utf8";
    const { uri } = await FS.writeFile(file);
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
    if (os !== "android") return null;
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

  // ---- Steam and friends without the proxy (0.215.0) ----
  // (Google Maps links and lists joined them in 0.242.0, for Travel's import.)
  // Steam's store API, SteamGridDB and GG.deals send no CORS headers, so a
  // browser needs proxy/worker.js in front of them. The app doesn't: its
  // native HTTP (CapacitorHttp, part of Capacitor itself) isn't a browser
  // request and CORS doesn't apply. So with no proxy URL set, the app gets a
  // stand-in one, and its fetch answers the stand-in's routes itself, mapped
  // to the same upstream addresses the worker uses — every caller that builds
  // `proxyUrl + "/steam-appdetails/…"` and checks for a proxy works unchanged.
  // In the app this wins over a proxy URL you've set: the setting is synced,
  // so it's there for your browsers, and clearing it on the phone would clear
  // it for them too. The .invalid domain never resolves: if the interception
  // were ever missed, the request fails instead of going somewhere.
  const NATIVE_PROXY = "https://native-proxy.lifelog.invalid";
  const nativeHttp = () => (native && cap.Plugins && cap.Plugins.CapacitorHttp) || null;
  function upstreamFor(url) {
    const u = new URL(url);
    let m = /^\/steam-wishlist\/(\d{17})$/.exec(u.pathname);
    if (m) return "https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=" + m[1];
    m = /^\/steam-appdetails\/(\d+)$/.exec(u.pathname);
    if (m) return "https://store.steampowered.com/api/appdetails?appids=" + m[1] + "&filters=basic,genres";
    if (u.pathname.startsWith("/steamgriddb/")) return "https://www.steamgriddb.com/api/v2/" + u.pathname.slice("/steamgriddb/".length) + u.search;
    if (u.pathname === "/gg-deals") return "https://api.gg.deals/v1/prices/by-steam-app-id/" + u.search;
    m = /^\/gmaps-link\/([A-Za-z0-9_-]{4,64})$/.exec(u.pathname);
    if (m) return "https://maps.app.goo.gl/" + m[1];
    m = /^\/gmaps-list\/([A-Za-z0-9_-]{16,64})$/.exec(u.pathname);
    if (m) return "https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=us&pb=!1m4!1s" + m[1] + "!2e1!3m1!1e1!2e2!3e2!4i500!16b1";
    return null;
  }
  function steamProxy(value) {
    if (nativeHttp()) return NATIVE_PROXY;
    return String(value || "").trim().replace(/\/+$/, "");
  }
  // Every native request gives up rather than waiting forever: with no
  // read timeout, a server that keeps the connection open left the caller
  // spinning (Travel's Google import, 0.243.2).
  const NATIVE_TIMEOUTS = { connectTimeout: 15000, readTimeout: 20000 };
  const headerOf = (res, name) => {
    const h = (res && res.headers) || {};
    const key = Object.keys(h).find((k) => k.toLowerCase() === name);
    return key ? String(h[key]) : "";
  };
  async function nativeRequest(opts) {
    try {
      return await nativeHttp().request({ method: "GET", responseType: "text", ...NATIVE_TIMEOUTS, ...opts });
    } catch (e) {
      throw new TypeError("Failed to fetch (" + ((e && e.message) || e) + ")");
    }
  }
  // A short link, answered as the worker does: where it leads, read off the
  // redirect rather than followed. Following it loaded Google Maps' whole
  // page (and on Android could hang there) just to learn its address.
  async function resolveShort(target) {
    let at = target;
    for (let hop = 0; hop < 4; hop++) {
      const res = await nativeRequest({ url: at, disableRedirects: true });
      const next = headerOf(res, "location");
      if (!next) {
        // Answered with a page after all: its final address, and any list
        // id the page carries.
        const body = typeof res.data === "string" ? res.data : "";
        const hint = /!11m\d+!2s[A-Za-z0-9_-]{16,}|placelists\/list\/[A-Za-z0-9_-]{16,}/.exec(body);
        return { url: String(res.url || at) + (hint ? " " + hint[0] : ""), status: res.status };
      }
      at = new URL(next, at).toString();
      if (!/^https:\/\/(maps\.app\.goo\.gl|goo\.gl)\//.test(at)) return { url: at };
    }
    return { url: at };
  }
  async function viaNative(url, init) {
    const target = upstreamFor(url);
    if (!target) return new Response("Not found", { status: 404 });
    const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
    if (target.startsWith("https://maps.app.goo.gl/")) {
      const out = await resolveShort(target);
      return out.status && out.status >= 400 ? json({ error: "HTTP " + out.status }, out.status) : json({ url: out.url });
    }
    const headers = {};
    new Headers((init && init.headers) || {}).forEach((v, k) => { headers[k] = v; });
    const res = await nativeRequest({ url: target, headers });
    const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return new Response(body, { status: res.status || 502, headers: { "Content-Type": "application/json" } });
  }
  if (native) {
    const webFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input && input.url;
      if (url && url.startsWith(NATIVE_PROXY + "/") && nativeHttp()) return viaNative(url, init);
      return webFetch(input, init);
    };
  }

  window.LifeLogPlatform = {
    native,
    ios: os === "ios",
    android: os === "android",
    ready,
    get build() { return build; },
    // A native plugin, or null in a browser or when the build doesn't carry it.
    plugin(name) { return (native && cap.Plugins && cap.Plugins[name]) || null; },
    openOutside,
    saveAndShare,
    // The Steam proxy to use: the app's own native route, else yours.
    steamProxy,
    get steamDirect() { return !!nativeHttp(); },
    downloadUpdate,
    openInstaller,
    clearOldUpdates,
    // Where the web copy lives, for links that have to work on another device.
    webUrl() { return (build && build.webUrl) || null; },
    releasesUrl() { return build && build.repo ? "https://github.com/" + build.repo + "/releases/latest" : null; },
    apkUrl() { return build && build.repo ? "https://github.com/" + build.repo + "/releases/latest/download/LifeLog.apk" : null; },
  };
})();
