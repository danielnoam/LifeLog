// LifeLog service worker — makes the app installable and usable offline.
// Strategy: network-first for this app's own files (so code updates aren't
// stale), with a cache fallback when offline. Third-party API calls
// (GitHub, RAWG/TMDB/Steam/GG.deals/etc.) are never touched — intercepting
// those and falling back to index.html on failure previously turned a real
// network/CORS error into a fake 200 OK full of HTML, masking the actual
// failure from the app's own error handling.
const CACHE = "lifelog-v23";
// Note: lifelog.json is intentionally NOT precached — it isn't deployed (your
// data is private). The app fetches it at runtime with a graceful fallback.
const ASSETS = [
  "./", "./index.html",
  "./src/styles.css", "./src/app.js", "./src/finance.js", "./src/settings.js", "./src/backlog.js", "./src/journal.js", "./src/merge.js", "./src/storage.js", "./src/media.js", "./src/qr.js",
  "./manifest.json", "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;            // writes pass straight through
  if (url.origin !== self.location.origin) return;   // never intercept third-party requests

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
