// keel: a test build in the browser, the service worker's half (sw.js
// loads it with importScripts). The page's half is Keel.releases.open().
//
// While the cache "<name>-preview" holds preview.json ({ repo, sha, title,
// pr }), every file of this copy comes from that commit on
// raw.githubusercontent.com, given its type (raw serves everything as
// text/plain), and is kept in "<name>-preview-<sha>" for offline. A file
// the commit doesn't have comes from the release as usual. Same origin,
// so the data is the one this browser has. index.html gets a bar at the
// top with Back to the release (./?release), styled by a stylesheet served
// from here, so it works whatever the branch's own code is and stays
// inside the page's CSP. sw.js itself is never a preview's: the browser
// checks it against the site, which is main.
//
//   importScripts("src/keel/sw-preview.js");
//   const preview = KeelPreview.create("waypage-preview");
//   self.addEventListener("fetch", (e) => { ... e.respondWith(preview.respond(e, fromRelease)); });
self.KeelPreview = (function () {
  const BAR_CSS_FILE = "keel-preview-bar.css";
  const TYPES = {
    html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json",
    md: "text/markdown", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", webp: "image/webp", woff2: "font/woff2",
  };
  const BAR_CSS = ".keel-preview-bar{position:fixed;z-index:2147483647;top:calc(env(safe-area-inset-top) + 6px);left:50%;transform:translateX(-50%);"
    + "max-width:calc(100% - 32px);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:4px 12px;border-radius:999px;"
    + "font:12px/1.4 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.78);text-decoration:none}";
  const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function create(PREVIEW) {
    const state = () => caches.open(PREVIEW).then((c) => c.match("./preview.json")).then((r) => (r ? r.json() : null)).catch(() => null);
    const leave = () => caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREVIEW)).map((k) => caches.delete(k))));

    async function fromPreview(p, url, e, fromRelease) {
      const base = new URL(self.registration.scope).pathname;
      if (!url.pathname.startsWith(base)) return fetch(e.request);
      const rel = url.pathname.slice(base.length) || "index.html";
      if (rel === BAR_CSS_FILE) return new Response(BAR_CSS, { headers: { "Content-Type": "text/css" } });
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
      const bar = '<link rel="stylesheet" href="./' + BAR_CSS_FILE + '" /><a class="keel-preview-bar" href="./?release">Test build: ' + escHtml(name) + " · Back to the release</a>";
      return new Response((await res.text()).replace(/<\/body>/i, bar + "</body>"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // The answer to a same-origin GET: the test build's file while one is
    // open, ./?release leaves it, and otherwise fromRelease(e).
    function respond(e, fromRelease) {
      const url = new URL(e.request.url);
      return state().then((p) => {
        if (p && e.request.mode === "navigate" && url.searchParams.has("release")) return leave().then(() => Response.redirect(self.registration.scope, 302));
        return p && p.repo && p.sha ? fromPreview(p, url, e, fromRelease) : fromRelease(e);
      });
    }
    return { respond, state, leave };
  }

  return { create, TYPES };
})();
