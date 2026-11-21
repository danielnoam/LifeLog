// keel: installing the app's own update, on window.Keel.update. The
// releases.js check finds the update; this fetches and installs it.
//
//   const U = Keel.update.create({ name: "Waypage" });
//   U.clearOld({ version: APP_VERSION, sha: build.sha });  // at launch
//   const uri = await U.download(u, (f, bytes, total) => ...);  // null: can't here
//   await U.install(uri);  // Android's installer
//   U.offer(u, { bar, text, btn, close }, t);  // or the whole bar, done for you
//
// `u` is what releases.check() returns ({ channel, version } or
// { channel: "unreleased", sha, url }), or a test build: { tag, key }
// (key "test-<branch>-<sha>"). The release's APK is <name>.apk on the
// tag app-v<version>, named by the tag, never `latest`, so a release
// published mid-download can't swap the file.
//
// Android: the APK downloads into the app's cache with its progress
// (Capacitor's Filesystem plugin), then goes to Android's installer
// (@capawesome-team/capacitor-file-opener's FileOpener). Android asks once
// whether the app may install apps (REQUEST_INSTALL_PACKAGES in the
// manifest), then to install; signed with the same key, it installs over
// the top and keeps everything. The file is kept, so a dismissed installer
// reopens without downloading again. An app built without those plugins,
// iOS (sideloaded builds update from AltStore or SideStore) get the file
// or the release page in the browser instead.
//
// The desktop app (Tauri): findDesktop() asks Tauri's updater for the
// release's latest.json (signed files; none when the release has none),
// installDesktop(found, onProgress) downloads, installs and restarts. An
// app with its own way (LifeLog's portable exe swap) passes
// desktop: { find(), install(found, onProgress) }; an install that fails
// with "readonly" means the app's folder can't be written to.
//
// create() options: name (the release assets' name), platform (default
// Keel.platform), repo() (default app-build.json's), newer (default
// Keel.releases.newer), fetch(url, path, onProgress) (an app's own
// downloader, tried first: its uri, or null to use Filesystem), keepBuilds
// (clearOld keeps test and unreleased APKs that aren't this build), skipKey
// (where offer() keeps a closed bar's version; default "<name>.update.skip"),
// desktop (the desktop app's own find and install, above).
(function () {
  const APK_MIME = "application/vnd.android.package-archive";
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function create(o) {
    const K = (typeof window !== "undefined" && window.Keel) || {};
    const NAME = o.name;
    const P = o.platform || K.platform;
    // Looked up when used: releases.js may load after this.
    const newer = (a, b) => (o.newer || K.releases.newer)(a, b);
    const plugin = (n) => (P.plugin ? P.plugin(n) : (P.native && P.cap && P.cap.Plugins && P.cap.Plugins[n]) || null);
    const repo = () => (o.repo && o.repo()) || (P.build && P.build.repo) || null;
    const SKIP = o.skipKey || String(NAME).toLowerCase() + ".update.skip";
    const short = (sha) => String(sha || "").slice(0, 7);

    // What this update is called: its version, unreleased-<sha> or a test build's key.
    const keyOf = (u) => u.key || (u.channel === "unreleased" ? "unreleased-" + short(u.sha) : u.version);
    const apkUrl = (u) => u.url || (repo() ? "https://github.com/" + repo() + "/releases/download/" + (u.tag || "app-v" + u.version) + "/" + NAME + ".apk" : null);
    const fileName = (u) => NAME + "-" + keyOf(u) + ".apk";
    const pageUrl = (u) => (u.url && !u.tag ? u.url : "https://github.com/" + repo() + "/releases/tag/" + (u.tag || "app-v" + u.version));
    const canInstall = () => P.os === "android" && !!plugin("Filesystem") && !!plugin("FileOpener") && !!repo();

    // The downloaded file's uri, or null where the app can't install it.
    // onProgress(fraction, bytes, total).
    async function download(u, onProgress) {
      if (!canInstall()) return null;
      const url = apkUrl(u);
      const path = fileName(u);
      if (o.fetch) {
        const got = await o.fetch(url, path, onProgress);
        if (got) return got;
      }
      const FS = plugin("Filesystem");
      const listener = await FS.addListener("progress", (p) => {
        if (onProgress && p && p.contentLength > 0) onProgress(Math.min(1, p.bytes / p.contentLength), p.bytes, p.contentLength);
      });
      try {
        await FS.downloadFile({ url, path, directory: "CACHE", progress: true });
      } finally {
        if (listener && listener.remove) listener.remove();
      }
      return (await FS.getUri({ path, directory: "CACHE" })).uri;
    }

    const install = (uri) => plugin("FileOpener").openFile({ path: uri, mimeType: APK_MIME });

    // Whether a file in the cache has done its job: a release this build
    // is at or past, or a test or unreleased build (with keepBuilds, only
    // when it's this build).
    const RELEASE = new RegExp("^" + esc(NAME) + "-(\\d+\\.\\d+\\.\\d+)\\.apk(\\.part)?$");
    const BUILD = new RegExp("^" + esc(NAME) + "-(?:test|preview|unreleased)-(?:.*-)?([0-9a-f]{7})\\.apk(\\.part)?$|^" + esc(NAME) + "-(?:test|preview|unreleased)-.+\\.apk(\\.part)?$");
    function stale(name, mine) {
      const v = typeof mine === "string" ? mine : mine && mine.version;
      const here = short(mine && mine.sha);
      const m = RELEASE.exec(name || "");
      if (m) return !newer(m[1], v || "0.0.0");
      const b = BUILD.exec(name || "");
      if (!b) return false;
      return o.keepBuilds ? !!here && b[1] === here : true;
    }
    async function clearOld(mine) {
      const FS = plugin("Filesystem");
      if (!FS) return;
      try {
        const { files } = await FS.readdir({ path: "", directory: "CACHE" });
        for (const f of files || []) {
          const name = typeof f === "string" ? f : f && f.name;
          if (stale(name, mine)) await FS.deleteFile({ path: name, directory: "CACHE" });
        }
      } catch (e) { /* nothing to tidy */ }
    }

    // ---- the desktop app ----
    const tauri = () => (P.desktop && P.tauri) || null;
    async function findDesktop() {
      if (!tauri()) return null;
      if (o.desktop) { try { return (await o.desktop.find()) || null; } catch (e) { return null; } }
      if (!tauri().updater) return null;
      try { return (await tauri().updater.check()) || null; } catch (e) { return null; }
    }
    // Resolves true once the new version is in place (the app restarts).
    async function installDesktop(found, onProgress) {
      const update = found || await findDesktop();
      if (!update) return false;
      if (o.desktop) return !!(await o.desktop.install(update, onProgress));
      let total = 0, got = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = (e.data && e.data.contentLength) || 0;
        else if (e.event === "Progress") { got += (e.data && e.data.chunkLength) || 0; if (total && onProgress) onProgress(Math.min(1, got / total)); }
      });
      if (tauri().process) await tauri().process.relaunch();
      return true;
    }
    const readOnly = (e) => String((e && e.message) || e) === "readonly";

    const skipped = () => { try { return localStorage.getItem(SKIP); } catch (e) { return null; } };
    const skip = (key) => { try { localStorage.setItem(SKIP, key); } catch (e) { /* shown again next launch */ } };

    // The update bar: { bar, text, btn, close } elements, t the app's
    // i18n.t. Update downloads with the % on the button, then opens the
    // installer; Install reopens it; a failed step offers Try again; ×
    // hides the bar until a newer update. False when that one was closed.
    function offer(u, els, t) {
      const { bar, text, btn, close } = els;
      const unreleased = u.channel === "unreleased";
      const sha = short(u.sha);
      const key = unreleased ? u.sha : u.version;
      if (key && skipped() === key) return false;
      const say = (msg, label, busy) => {
        text.textContent = msg;
        btn.textContent = label;
        btn.disabled = !!busy;
      };
      const isOut = () => (unreleased ? t("A newer unreleased build is ready ({sha}).", { sha }) : t("Version {version} is out.", { version: u.version }));
      if (close) close.onclick = () => { bar.hidden = true; if (key) skip(key); };
      bar.hidden = false;

      const page = () => P.openOutside(pageUrl(u));
      // The desktop app updates itself and restarts when the release has
      // its signed files; else the release page. An unreleased build has
      // the release's version, which the updater would skip: its file
      // opens in the browser.
      if (tauri() && !unreleased) {
        let pageOnly = false;
        const toPage = (msg) => { pageOnly = true; say(msg || isOut(), t("Open page")); };
        say(isOut(), t("Update"));
        btn.onclick = async () => {
          if (pageOnly) return page();
          say(t("Checking…"), "…", true);
          const found = await findDesktop();
          if (!found) { toPage(); return page(); }
          say(t("Downloading version {version}…", { version: u.version }), "0%", true);
          try {
            if (!(await installDesktop(found, (f) => { btn.textContent = Math.round(f * 100) + "%"; }))) toPage();
          } catch (e) {
            if (readOnly(e)) return toPage(t("The app's folder is read-only, so it can't update itself."));
            say(t("The update didn't finish."), t("Try again"));
          }
        };
        return true;
      }

      if (!canInstall()) {
        const android = P.os === "android";
        say(isOut(), android ? t("Download") : t("Get it"));
        btn.onclick = () => (android ? P.openOutside(apkUrl(u)) : page());
        return true;
      }

      let uri = null;
      const opener = async () => {
        say(t("Opening the installer…"), t("Install"), true);
        try {
          await install(uri);
          say(unreleased ? t("Build {sha} is ready to install.", { sha }) : t("Version {version} is ready to install.", { version: u.version }), t("Install"));
        } catch (e) {
          say(t("Couldn't open the installer."), t("Try again"));
        }
      };
      say(isOut(), t("Update"));
      btn.onclick = async () => {
        if (uri) return opener();
        say(unreleased ? t("Downloading build {sha}…", { sha }) : t("Downloading version {version}…", { version: u.version }), "0%", true);
        try {
          uri = await download(u, (f) => { btn.textContent = Math.round(f * 100) + "%"; });
        } catch (e) {
          say(t("The download didn't finish."), t("Try again"));
          return;
        }
        return opener();
      };
      return true;
    }

    return { canInstall, download, install, clearOld, findDesktop, installDesktop, readOnly, offer, apkUrl, pageUrl, fileName, stale, skipped, skip };
  }

  const api = { create, APK_MIME };
  if (typeof window !== "undefined") {
    window.Keel = window.Keel || {};
    window.Keel.update = api;
  }
})();
