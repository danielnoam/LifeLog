## LifeLog CORS proxy

A tiny Cloudflare Worker that unblocks the endpoints confirmed
CORS-blocked directly from the browser: Steam's wishlist/app-details
data and SteamGridDB. See `worker.js` for what it does and why.

### Git-connected deploys (already set up)

`lifelog-worker` is connected to this repo's `main` branch with its
root directory set to `proxy` — every push that touches this folder
redeploys the Worker automatically within a minute or two. No manual
copy-pasting into Cloudflare's editor needed for routine changes.

### Manual deploy (if you'd rather not connect Git, or for a first test)

1. Go to `dash.cloudflare.com` and sign up / log in (free).
2. **Workers & Pages → Create → Create Worker.**
3. Give it any name (e.g. `lifelog-worker`) → **Deploy** (the default
   "Hello World" one first — that's fine).
4. **Edit code** to open the online editor, delete everything, and
   paste in the contents of `worker.js`.
5. **Save and deploy.**
6. Copy the URL Cloudflare gives you — looks like
   `https://lifelog-worker.<your-subdomain>.workers.dev`.

That URL goes into LifeLog's Settings → Media → "Steam Wishlist
import" → Proxy URL.
