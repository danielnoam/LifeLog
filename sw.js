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
const CACHE = "lifelog-v267";
// Note: lifelog.json is intentionally NOT precached — it isn't deployed (your
// data is private). The app fetches it at runtime with a graceful fallback.
const ASSETS = [
  "./", "./index.html",
  "./src/styles.css", "./src/errlog.js", "./src/dates.js", "./src/keys.js", "./src/headless.js", "./src/platform.js", "./src/desktop.js", "./src/testbuilds.js", "./src/icons.js", "./src/jobs.js", "./src/app.js", "./src/reconcile.js", "./src/finance.js", "./src/settings.js", "./src/backlog.js", "./src/wheel.js", "./src/journal.js", "./src/notes.js", "./src/markdown.js", "./src/images.js", "./src/docimport.js", "./src/io.js", "./src/sync.js", "./src/habits.js", "./src/recap.js", "./src/merge.js", "./src/storage.js", "./src/media.js", "./src/qr.js", "./src/widgets.js", "./src/share.js", "./src/search.js", "./src/letterboxd.js", "./src/payments.js", "./src/reminders.js", "./src/alerts.js", "./src/boards.js", "./src/travel.js", "./src/home.js", "./src/vendor/rough.js", "./src/vendor/leaflet.js", "./src/vendor/leaflet.css", "./src/vendor/Virgil.woff2",
  "./manifest.json", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./CHANGELOG.md",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && !k.startsWith(PREVIEW)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A test build in the browser (0.299.0, from Waypage's 1.49.0). Settings →
// About → Test builds puts the picked build in the cache PREVIEW as
// preview.json ({ repo, sha, title, pr }). While it's there, every file of
// this copy comes from that commit on raw.githubusercontent.com, given its
// type (raw serves everything as text/plain), and is kept in PREVIEW-<sha>
// for offline. A file the commit doesn't have (lifelog.json) comes from here
// as usual. Same origin, so the data is the one this browser has, and it
// syncs as the release does. index.html gets a bar at the top with Back to
// the release (./?release), styled by a stylesheet served from here, so it
// works whatever the branch's own code is and stays inside the page's CSP.
// This file itself is never a preview's: the browser checks it against the
// site, which is main.
const PREVIEW = "lifelog-preview";
const PREVIEW_BAR_CSS = "lifelog-preview-bar.css";
const TYPES = {
  html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json",
  md: "text/markdown", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", webp: "image/webp", woff2: "font/woff2",
};
const previewState = () => caches.open(PREVIEW).then((c) => c.match("./preview.json")).then((r) => (r ? r.json() : null)).catch(() => null);
const leavePreview = () => caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREVIEW)).map((k) => caches.delete(k))));
const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const BAR_CSS = ".lifelog-preview-bar{position:fixed;z-index:2147483647;top:calc(env(safe-area-inset-top) + 6px);left:50%;transform:translateX(-50%);"
  + "max-width:calc(100% - 32px);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:4px 12px;border-radius:999px;"
  + "font:12px/1.4 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.78);text-decoration:none}";
async function fromPreview(p, url, e) {
  const base = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(base)) return fetch(e.request);
  const rel = url.pathname.slice(base.length) || "index.html";
  if (rel === PREVIEW_BAR_CSS) return new Response(BAR_CSS, { headers: { "Content-Type": "text/css" } });
  const cache = await caches.open(PREVIEW + "-" + p.sha);
  let res = await cache.match("./" + rel);
  if (!res) {
    let got;
    try {
      got = await fetch("https://raw.githubusercontent.com/" + p.repo + "/" + p.sha + "/" + rel.split("/").map(encodeURIComponent).join("/"));
    } catch (err) {
      return new Response("Offline, and this test build's file isn't saved yet.", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
    if (got.status === 404) return fromRelease(e);
    if (!got.ok) return new Response("", { status: got.status });
    res = new Response(await got.arrayBuffer(), { headers: { "Content-Type": TYPES[rel.split(".").pop().toLowerCase()] || "application/octet-stream" } });
    await cache.put("./" + rel, res.clone());
  }
  if (rel !== "index.html") return res;
  const name = p.title || (p.pr ? "#" + p.pr : "a branch");
  const bar = '<link rel="stylesheet" href="./' + PREVIEW_BAR_CSS + '" /><a class="lifelog-preview-bar" href="./?release">Test build: ' + escHtml(name) + " · Back to the release</a>";
  return new Response((await res.text()).replace(/<\/body>/i, bar + "</body>"), { headers: { "Content-Type": "text/html" } });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;            // writes pass straight through
  if (url.origin !== self.location.origin) return;   // never intercept third-party requests
  e.respondWith(previewState().then((p) => {
    if (p && e.request.mode === "navigate" && url.searchParams.has("release")) return leavePreview().then(() => Response.redirect(self.registration.scope, 302));
    return p && p.repo && p.sha ? fromPreview(p, url, e) : fromRelease(e);
  }));
});

function fromRelease(e) {
  return (
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
}
