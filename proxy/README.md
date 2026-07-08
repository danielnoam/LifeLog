## LifeLog CORS proxy

A tiny Cloudflare Worker that unblocks the two endpoints confirmed
CORS-blocked directly from the browser: Steam's wishlist data and
SteamGridDB. See `worker.js` for what it does and why.

### Deploy (works fine from a phone browser, no CLI needed)

1. Go to `dash.cloudflare.com` and sign up / log in (free).
2. **Workers & Pages → Create → Create Worker.**
3. Give it any name (e.g. `lifelog-proxy`) → **Deploy** (the default
   "Hello World" one first — that's fine).
4. **Edit code** to open the online editor, delete everything, and
   paste in the contents of `worker.js`.
5. **Save and deploy.**
6. Copy the URL Cloudflare gives you — looks like
   `https://lifelog-proxy.<your-subdomain>.workers.dev`.

That URL goes into LifeLog's Settings once the app-side wiring for
Steam wishlist import / SteamGridDB is in place (see TODO.md).
