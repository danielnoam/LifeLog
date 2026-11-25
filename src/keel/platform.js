// keel: where this copy of the app is running, on window.Keel.platform.
// The same files run in a browser (GitHub Pages), in the phone apps
// (Capacitor) and in a desktop app (Tauri); what differs between them is
// decided here, not sniffed across the app. Load it before the app's own
// platform.js, which keeps everything that is only that app's.
//
//   const K = window.Keel.platform;
//   K.native     a phone app (Capacitor)
//   K.os         "android", "ios" or "web"
//   K.desktop    the desktop app (Tauri), K.desktopOs "windows" or "linux"
//   K.device     "android", "ios", "mac", "windows", "linux" or "other":
//                the app's own os, or a browser's best guess from what it
//                reports (an iPad may report a Mac); K.phone when it's
//                android or ios. For offers, never for security
//   K.bundled    the files are on the device: phone or desktop. No service
//                worker, a new version is a new install, links leave the app
//   K.plugin(n)  a Capacitor plugin, or null
//   K.ready      resolves to app-build.json (written by the app's build), or
//                null in a browser; K.build is it once loaded
//   K.openOutside(url)  opens a web or mail address in the device's browser
//   K.deadline(promise, ms)  rejects with a TypeError("Timed out") after ms
//
// In a bundled app every link and window.open to another site goes to
// the device's browser: inside the app's WebView it would have no address
// bar, and Back would put the app away. Only http(s) and mailto leave, so
// an address from a backup or a sync can't run as javascript: with the
// app's plugins.
(function () {
  const cap = window.Capacitor;
  const native = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  const os = native ? String((cap.getPlatform && cap.getPlatform()) || "android") : "web";
  const plugin = (name) => (native && cap.Plugins && cap.Plugins[name]) || null;
  const tauri = !native && window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__ : null;
  const desktop = !!tauri;
  const desktopOs = desktop ? (/Windows/i.test(navigator.userAgent) ? "windows" : "linux") : "";
  const bundled = native || desktop;
  const nav = typeof navigator === "object" && navigator ? navigator : {};
  const device = native ? os : desktop ? desktopOs : (() => {
    const ua = String(nav.userAgent || "");
    const pl = String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || "");
    if (/android/i.test(ua + " " + pl)) return "android";
    if (/iphone|ipad|ipod/i.test(ua) || /^ios$/i.test(pl)) return "ios";
    if (/mac/i.test(pl + " " + ua)) return nav.maxTouchPoints > 1 ? "ios" : "mac";
    if (/win/i.test(pl + " " + ua)) return "windows";
    if (/linux|cros|x11/i.test(pl + " " + ua)) return "linux";
    return "other";
  })();
  const phone = device === "android" || device === "ios";

  if (native) document.documentElement.classList.add("native");

  let build = null;
  const ready = bundled
    ? fetch("app-build.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => { build = b; return b; })
        .catch(() => null)
    : Promise.resolve(null);

  const isOutside = (url) => {
    try {
      const u = new URL(String(url), location.href);
      return /^https?:$/.test(u.protocol) && u.origin !== location.origin;
    } catch (e) { return false; }
  };
  const nativeOpen = window.open.bind(window);
  function openOutside(url) {
    if (!/^(https?|mailto):/i.test(String(url || "").trim())) return false;
    if (desktop && tauri.opener) {
      Promise.resolve(tauri.opener.openUrl(String(url))).catch(() => nativeOpen(url, "_blank"));
      return true;
    }
    const L = plugin("AppLauncher");
    if (L) {
      // Nothing on the phone to open it with: the WebView's own hand-off.
      Promise.resolve(L.openUrl({ url: String(url) }))
        .then((r) => { if (r && r.completed === false) nativeOpen(url, "_blank"); })
        .catch(() => nativeOpen(url, "_blank"));
      return true;
    }
    nativeOpen(url, "_blank");
    return true;
  }
  if (bundled) {
    window.open = (url, target, features) => (isOutside(url) ? (openOutside(url), null) : nativeOpen(url, target, features));
    document.addEventListener("click", (e) => {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a || a.hasAttribute("download") || !isOutside(a.href)) return;
      e.preventDefault();
      openOutside(a.href);
    }, true);
  }

  // Native requests have no deadline of their own.
  function deadline(promise, ms) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new TypeError("Timed out")), ms); }),
    ]).finally(() => clearTimeout(timer));
  }

  window.Keel = window.Keel || {};
  window.Keel.platform = {
    cap, native, os, plugin, tauri, desktop, desktopOs, device, phone, bundled, ready, isOutside, openOutside, deadline,
    get build() { return build; },
  };
})();
