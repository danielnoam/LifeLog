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
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  // Where it runs (phone, desktop, browser), app-build.json and links out
  // to the device's browser are keel's (src/keel/platform.js).
  // Not `native` for the desktop: that still means a phone, with its
  // widgets, bars and APK updater. What the desktop shares with the phones
  // (files in the bundle, no service worker, native HTTP, links out to the
  // browser) asks `bundled` instead.
  const K = window.Keel.platform;
  const { cap, native, os, tauri, desktop, desktopOs, bundled, ready, openOutside } = K;

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
    if (desktop) return saveOnDesktop(filename, text, opts);
    const FS = native && cap.Plugins && cap.Plugins.Filesystem;
    const SH = native && cap.Plugins && cap.Plugins.Share;
    if (!FS || !SH) return false;
    const file = { path: filename, data: text, directory: "CACHE" };
    if (!opts.base64) file.encoding = "utf8";
    const { uri } = await FS.writeFile(file);
    try {
      await SH.share({ title: filename, files: [uri], dialogTitle: i18n.t("Save or send {file}", { file: filename }) });
    } catch (e) {
      // Closing the share sheet is a choice, not a failure.
      if (!/cancel/i.test(String(e && e.message || e))) throw e;
    }
    return true;
  }

  // On a computer: the system's own Save dialog, then the file. A cancelled
  // dialog is a choice, so it's still "done" and no link is clicked after it.
  async function saveOnDesktop(filename, text, opts) {
    if (!tauri.dialog || !tauri.fs) return false;
    const ext = (/\.([A-Za-z0-9]+)$/.exec(filename) || [])[1];
    const where = await tauri.dialog.save({ defaultPath: filename, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
    if (!where) return true;
    if (opts.base64) {
      const bin = atob(text);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await tauri.fs.writeFile(where, bytes);
    } else {
      await tauri.fs.writeTextFile(where, String(text));
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
  // A test build (0.299.0) comes from its pre-release `tag` instead, and
  // `version` is then the file's name part (test-<branch>-<sha>).
  // An unreleased build (2026-11-18) passes its own `url` (the site's
  // unreleased/LifeLog.apk), and `version` is unreleased-<sha>.
  async function downloadUpdate(version, onProgress, tag, url) {
    tag = tag || "app-v" + version;
    if (os !== "android") return null;
    const FS = native && cap.Plugins && cap.Plugins.Filesystem;
    if (!FS || !(cap.Plugins && cap.Plugins.FileOpener) || !K.build || !K.build.repo) return null;
    url = url || "https://github.com/" + K.build.repo + "/releases/download/" + tag + "/LifeLog.apk";
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
  // APKs for versions already installed have done their job, and so has any
  // test build's: it's asked for again from Test builds if wanted.
  async function clearOldUpdates(currentVersion, isNewer) {
    const FS = native && cap.Plugins && cap.Plugins.Filesystem;
    if (!FS) return;
    try {
      const { files } = await FS.readdir({ path: "", directory: "CACHE" });
      for (const f of files || []) {
        const name = typeof f === "string" ? f : f.name;
        const m = /^LifeLog-(\d+\.\d+\.\d+)\.apk$/.exec(name || "");
        if ((m && !isNewer(m[1], currentVersion)) || /^LifeLog-(test|unreleased)-.+\.apk$/.test(name || "")) await FS.deleteFile({ path: name, directory: "CACHE" });
      }
    } catch (e) { /* nothing to tidy */ }
  }

  // ---- Steam and friends without the proxy (0.215.0) ----
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
  // On a computer it's Tauri's HTTP plugin, given the same request as
  // CapacitorHttp and answering the same shape. Its scope (src-tauri/
  // capabilities/default.json) lists the hosts upstreamFor maps to, and
  // nothing else.
  // Asked for at each request: a plugin's API may attach after this file runs.
  const tauriHttp = desktop && {
    async request({ url, method, headers, data, disableRedirects, connectTimeout, readTimeout }) {
      const res = await tauri.http.fetch(url, {
        method: method || "GET", headers: headers || {}, connectTimeout,
        ...(data != null ? { body: typeof data === "string" ? data : JSON.stringify(data) } : {}),
        signal: AbortSignal.timeout((connectTimeout || 0) + (readTimeout || 20000)),
        ...(disableRedirects ? { maxRedirections: 0 } : {}),
      });
      const out = {};
      res.headers.forEach((v, k) => { out[k] = v; });
      return { status: res.status, headers: out, url: res.url || url, data: await res.text() };
    },
  };
  const nativeHttp = () => (native && cap.Plugins && cap.Plugins.CapacitorHttp) || (tauriHttp && tauri.http ? tauriHttp : null);
  function upstreamFor(url) {
    const u = new URL(url);
    let m = /^\/steam-wishlist\/(\d{17})$/.exec(u.pathname);
    if (m) return "https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=" + m[1];
    m = /^\/steam-owned\/(\d{17})$/.exec(u.pathname);
    if (m) return "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=" + encodeURIComponent(u.searchParams.get("key") || "") + "&steamid=" + m[1] + "&include_appinfo=1&include_played_free_games=1&format=json";
    m = /^\/steam-appdetails\/(\d+)$/.exec(u.pathname);
    if (m) return "https://store.steampowered.com/api/appdetails?appids=" + m[1] + "&filters=basic,genres";
    if (u.pathname.startsWith("/steamgriddb/")) return "https://www.steamgriddb.com/api/v2/" + u.pathname.slice("/steamgriddb/".length) + u.search;
    if (u.pathname === "/gg-deals") return "https://api.gg.deals/v1/prices/by-steam-app-id/" + u.search;
    m = /^\/tiingo-prices\/([A-Za-z0-9.-]{1,12})$/.exec(u.pathname);
    if (m) return "https://api.tiingo.com/tiingo/daily/" + m[1] + "/prices" + tiingoQuery(u, ["startDate"]);
    m = /^\/tiingo-meta\/([A-Za-z0-9.-]{1,12})$/.exec(u.pathname);
    if (m) return "https://api.tiingo.com/tiingo/daily/" + m[1];
    m = /^\/tiingo-iex\/([A-Za-z0-9.-]{1,12})$/.exec(u.pathname);
    if (m) return "https://api.tiingo.com/iex/" + m[1];
    if (u.pathname === "/tiingo-search") return "https://api.tiingo.com/tiingo/utilities/search" + tiingoQuery(u, ["query"]);
    // IGDB and Hardcover are the POSTs: the worker turns these GETs into
    // their own shape, and so does this.
    if (u.pathname === "/igdb-token") return { url: "https://id.twitch.tv/oauth2/token", method: "POST", igdbToken: true };
    m = /^\/igdb\/(games|external_games|game_time_to_beats)$/.exec(u.pathname);
    if (m) return { url: "https://api.igdb.com/v4/" + m[1], method: "POST", data: (u.searchParams.get("q") || "").slice(0, 4000) };
    if (u.pathname === "/hardcover") {
      let body = null;
      try { body = JSON.parse((u.searchParams.get("q") || "").slice(0, 6000)); } catch (e) { /* sent as nothing */ }
      return { url: "https://api.hardcover.app/v1/graphql", method: "POST", data: body || {}, contentType: "application/json" };
    }
    // Stremio's API (the Stremio sync) is all POSTs of JSON, so the body is
    // the caller's own, passed on as it is (see viaNative).
    m = /^\/stremio\/(login|logout|datastoreGet)$/.exec(u.pathname);
    if (m) return { url: "https://api.strem.io/api/" + m[1], method: "POST", bodyFromInit: true, contentType: "application/json" };
    m = /^\/augsteam-app\/(\d+)$/.exec(u.pathname);
    if (m) return "https://api.augmentedsteam.com/app/" + m[1] + "/v2";
    return null;
  }
  // Only the parameters a Tiingo route takes are passed on.
  function tiingoQuery(u, names) {
    const q = new URLSearchParams();
    for (const n of names) { const v = u.searchParams.get(n); if (v) q.set(n, v); }
    const s = q.toString();
    return s ? "?" + s : "";
  }
  // The web build's proxy url is a synced setting, so an imported or merged
  // file could point it anywhere, and the Steam and SteamGridDB keys travel
  // with every request: only https (or localhost, for a proxy run beside the
  // dev server) is used (0.259.2).
  function steamProxy(value) {
    if (nativeHttp()) return NATIVE_PROXY;
    const v = String(value || "").trim().replace(/\/+$/, "");
    return /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/i.test(v) ? v : "";
  }
  // Every native request gives up rather than waiting forever: with no
  // read timeout, a server that keeps the connection open left the caller
  // spinning (0.243.2).
  const NATIVE_TIMEOUTS = { connectTimeout: 15000, readTimeout: 20000 };
  async function nativeRequest(opts) {
    try {
      return await nativeHttp().request({ method: "GET", responseType: "text", ...NATIVE_TIMEOUTS, ...opts });
    } catch (e) {
      throw new TypeError("Failed to fetch (" + ((e && e.message) || e) + ")");
    }
  }
  async function viaNative(url, init) {
    const target = upstreamFor(url);
    if (!target) return new Response("Not found", { status: 404 });
    const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
    const headers = {};
    new Headers((init && init.headers) || {}).forEach((v, k) => { headers[k] = v; });
    let req = { url: target, headers };
    if (target.igdbToken) {
      const id = headers["client-id"] || "";
      const secret = (headers.authorization || "").replace(/^Secret\s+/i, "");
      if (!/^[A-Za-z0-9]{8,64}$/.test(id) || !/^[A-Za-z0-9]{8,64}$/.test(secret)) return json({ error: "A Twitch client ID and secret are needed" }, 400);
      req = { url: target.url + "?client_id=" + id + "&client_secret=" + secret + "&grant_type=client_credentials", method: "POST", headers: {} };
    } else if (target.bodyFromInit) {
      let body = {};
      try { body = JSON.parse(String((init && init.body) || "{}").slice(0, 4000)); } catch (e) { /* sent as nothing */ }
      req = { url: target.url, method: "POST", data: body, headers: { "Content-Type": "application/json", Accept: "application/json" } };
    } else if (typeof target === "object") {
      // A JSON body goes as an object: CapacitorHttp serializes it itself.
      req = { url: target.url, method: target.method, data: target.data, headers: { ...headers, "Content-Type": target.contentType || "text/plain", Accept: "application/json" } };
    }
    const res = await nativeRequest(req);
    const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return new Response(body, { status: res.status || 502, headers: { "Content-Type": "application/json" } });
  }
  if (bundled) {
    const webFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input && input.url;
      if (url && url.startsWith(NATIVE_PROXY + "/") && nativeHttp()) return viaNative(url, init);
      return webFetch(input, init);
    };
  }

  window.LifeLogPlatform = {
    native,
    // The background refresh's invisible run of the app (headless.js):
    // a native build with no screen and no Capacitor behind it.
    headless: !!(native && cap.headless),
    ios: os === "ios",
    android: os === "android",
    // The Windows and Linux app, and Tauri's API there (src/desktop.js).
    desktop,
    windows: desktopOs === "windows",
    linux: desktopOs === "linux",
    get tauri() { return tauri; },
    ready,
    get build() { return K.build; },
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
    webUrl() { return (K.build && K.build.webUrl) || null; },
    releasesUrl() { return K.build && K.build.repo ? "https://github.com/" + K.build.repo + "/releases/latest" : null; },
    apkUrl() { return K.build && K.build.repo ? "https://github.com/" + K.build.repo + "/releases/latest/download/LifeLog.apk" : null; },
    // A browser on Windows, the one place offered the Windows app: there is
    // no app-build.json in a browser, so the repo is named here. The zip
    // (the portable app, 2026-11-20) keeps its name from one release to
    // the next (desktop.yml).
    windowsBrowser: !bundled && (/^windows$/i.test((navigator.userAgentData && navigator.userAgentData.platform) || "") || /Windows NT/i.test(navigator.userAgent)),
    windowsAppUrl: "https://github.com/danielnoam/LifeLog/releases/latest/download/LifeLog-portable.zip",
  };
})();
