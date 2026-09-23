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

  let build = null;
  const ready = native
    ? fetch("app-build.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => { build = b; return b; })
        .catch(() => null)
    : Promise.resolve(null);

  window.LifeLogPlatform = {
    native,
    ready,
    get build() { return build; },
    // A native plugin, or null in a browser or when the build doesn't carry it.
    plugin(name) { return (native && cap.Plugins && cap.Plugins[name]) || null; },
    // Where the web copy lives, for links that have to work on another device.
    webUrl() { return (build && build.webUrl) || null; },
    releasesUrl() { return build && build.repo ? "https://github.com/" + build.repo + "/releases/latest" : null; },
    apkUrl() { return build && build.repo ? "https://github.com/" + build.repo + "/releases/latest/download/LifeLog.apk" : null; },
  };
})();
