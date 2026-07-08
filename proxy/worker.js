// LifeLog CORS proxy — deploy as a Cloudflare Worker (free tier).
//
// Steam's wishlist endpoint and SteamGridDB's API don't send an
// Access-Control-Allow-Origin header, so the browser refuses to let
// LifeLog call them directly (confirmed CORS-blocked; see TODO.md).
// This Worker sits in front of both: it forwards the request
// server-to-server (not subject to CORS) and adds the missing header
// on the way back. It doesn't store or look at any of your data —
// every request is just relayed straight through.
//
// Routes are deliberately narrow (exact path shapes, fixed target
// hosts) rather than a generic "fetch whatever URL I'm given" proxy,
// so this can't be used to reach arbitrary sites even if someone else
// found the URL.
//
//   GET /steam-wishlist/<steamid64>
//     -> https://store.steampowered.com/wishlist/profiles/<steamid64>/wishlistdata/
//
//   GET /steamgriddb/<anything>
//     -> https://www.steamgriddb.com/api/v2/<anything>
//     Your SteamGridDB API key stays in LifeLog's Settings and is sent
//     as an Authorization header on each request — this Worker never
//     stores it, just passes it through to SteamGridDB.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    const wishlistMatch = url.pathname.match(/^\/steam-wishlist\/(\d{17})$/);
    if (wishlistMatch) {
      const target = `https://store.steampowered.com/wishlist/profiles/${wishlistMatch[1]}/wishlistdata/`;
      return proxyJson(target);
    }

    if (url.pathname.startsWith("/steamgriddb/")) {
      const subpath = url.pathname.slice("/steamgriddb/".length);
      const target = `https://www.steamgriddb.com/api/v2/${subpath}${url.search}`;
      const auth = request.headers.get("Authorization");
      return proxyJson(target, auth ? { Authorization: auth } : {});
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};

async function proxyJson(target, extraHeaders) {
  try {
    const res = await fetch(target, { headers: extraHeaders || {} });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "proxy fetch failed", detail: String(e && e.message || e) }),
      { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }
}
