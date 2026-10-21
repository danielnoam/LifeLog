// LifeLog — the app run with no screen (0.279.0): Background refresh on
// Android (native/widgets/android/.../HeadlessRefresh.java).
//
// Every so often, with the app put away, Android opens a second, invisible
// WebView on these same files at the app's own address, so it shares the
// device's copy, the sync base and the per-phone choices with the app
// proper. There is no Capacitor in that WebView, only a small Java object,
// `LifeLogHeadless`, so this file stands in for the bridge as far as the
// headless run uses it: the Widgets plugin's update, notification state and
// pins; native HTTP for the Steam routes the proxy would answer; and done()
// to say the run is over. Loaded before platform.js, which then sees a
// native build like any other.
//
// Not loaded as the app: only a page opened with ?headless=1 by a WebView
// that carries the Java object. In a browser or in the real app this does
// nothing at all.
(function () {
  const H = window.LifeLogHeadless;
  if (!H || !/[?&]headless=1(&|$)/.test(location.search) || window.Capacitor) return;

  // Native HTTP, answered by Java on its own thread and handed back through
  // LifeLogHeadlessFetched. Only what platform.js's nativeRequest asks for:
  // GET, headers, whether to follow redirects.
  const pending = new Map();
  let n = 0;
  window.LifeLogHeadlessFetched = (id, json) => {
    const p = pending.get(String(id));
    pending.delete(String(id));
    if (!p) return;
    try {
      const r = JSON.parse(json);
      if (r && r.error) p.reject(new Error(r.error)); else p.resolve(r);
    } catch (e) { p.reject(e); }
  };
  const request = (opts) => new Promise((resolve, reject) => {
    const id = String(++n);
    pending.set(id, { resolve, reject });
    try {
      H.fetch(id, String(opts.url || ""), JSON.stringify(opts.headers || {}), !!opts.disableRedirects);
    } catch (e) { pending.delete(id); reject(e); }
  });

  const state = () => { try { return { state: String(H.notificationState() || "unavailable") }; } catch (e) { return { state: "unavailable" }; } };
  const nothing = () => Promise.resolve({ remove() {} });

  window.Capacitor = {
    headless: true,
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      CapacitorHttp: { request },
      Widgets: {
        update: ({ json }) => { H.update(String(json)); return Promise.resolve(); },
        notePins: () => { try { return Promise.resolve({ ids: JSON.parse(H.notePins() || "[]") }); } catch (e) { return Promise.resolve({ ids: [] }); } },
        notificationState: () => Promise.resolve(state()),
        askForNotifications: () => Promise.resolve(state()),
        openNotificationSettings: () => Promise.resolve(),
        holdBackground: () => Promise.resolve(),
        releaseBackground: () => Promise.resolve(),
        addListener: nothing,
      },
    },
  };

  // A WebView nobody looks at never paints, so a frame callback may never
  // come; a few things on the boot path wait for one.
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);

  // Whatever goes wrong, the run ends and the WebView is let go of; the next
  // one starts clean.
  window.addEventListener("error", (e) => { try { H.log("error: " + (e && e.message)); } catch (x) {} });
  window.addEventListener("unhandledrejection", (e) => { try { H.log("rejection: " + (e && e.reason && (e.reason.message || e.reason))); } catch (x) {} });
})();
