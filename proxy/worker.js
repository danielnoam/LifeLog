// LifeLog CORS proxy — deploy as a Cloudflare Worker (free tier).
//
// Steam's wishlist/app-list endpoints and SteamGridDB's API don't send an
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
//     -> https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=<steamid64>
//     The classic store.steampowered.com/wishlist/.../wishlistdata/ JSON
//     endpoint this originally targeted has been retired by Valve — it
//     now just serves the store homepage. This is the endpoint that
//     replaced it; no API key needed. Returns only {appid, priority,
//     date_added} per item, no title — see /steam-applist below.
//
//   GET /steam-applist
//     -> https://api.steampowered.com/ISteamApps/GetAppList/v2/
//     The full id->name list for every app on Steam (a few MB, one
//     request), used to resolve wishlist app IDs to titles client-side
//     instead of one request per game (which would be slow and likely
//     rate-limited).
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
      const target = `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${wishlistMatch[1]}`;
      return proxyJson(target);
    }

    if (url.pathname === "/steam-applist") {
      return proxyJson("https://api.steampowered.com/ISteamApps/GetAppList/v2/");
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
