// LifeLog service worker — makes the app installable and usable offline.
//
// Strategy: stale-while-revalidate for this app's own files. A repeat launch
// paints instantly from cache, while a fresh copy is fetched in the background
// to serve the *next* launch. Freshness is preserved by the `?v=x.y.z` query
// on every <script>/<link> in index.html: a release bumps those, so changed
// assets are brand-new URLs that miss the cache and are fetched fresh, while
// the unversioned HTML shell propagates within one extra load. (This replaced
// a network-first strategy that made every launch wait on the network first.)
//
// Third-party API calls (GitHub, RAWG/TMDB/Steam/GG.deals/etc.) are never
// touched — intercepting those and falling back to index.html on failure
// previously turned a real network/CORS error into a fake 200 OK full of HTML,
// masking the actual failure from the app's own error handling.
const CACHE = "lifelog-v41";
// Note: lifelog.json is intentionally NOT precached — it isn't deployed (your
// data is private). The app fetches it at runtime with a graceful fallback.
const ASSETS = [
  "./", "./index.html",
  "./src/styles.css", "./src/app.js", "./src/finance.js", "./src/settings.js", "./src/backlog.js", "./src/wheel.js", "./src/journal.js", "./src/io.js", "./src/sync.js", "./src/merge.js", "./src/storage.js", "./src/media.js", "./src/qr.js",
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
    caches.open(CACHE).then((cache) =>
      cache.match(e.request).then((cached) => {
        // Revalidate in the background: update the cache for next time. A
        // failure here (offline) is fine — we still serve `cached` below.
        const fetching = fetch(e.request)
          .then((res) => { if (res && res.ok) cache.put(e.request, res.clone()); return res; })
          .catch(() => null);
        // Cache hit → instant response now, fresh copy lands for the next load.
        // Miss → wait on the network, then fall back: the unversioned precache
        // (ignoreSearch, so `app.js?v=…` still matches a precached `app.js`
        // when offline before its first fetch), and finally the app shell.
        return cached || fetching.then((res) =>
          res || caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")));
      })
    )
  );
});
