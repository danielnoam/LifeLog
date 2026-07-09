## LifeLog CORS proxy

A tiny Cloudflare Worker that unblocks the endpoints confirmed
CORS-blocked directly from the browser: Steam's wishlist/app-details
data and SteamGridDB. See `worker.js` for what it does and why.

### One-time setup: connect it to this repo (recommended)

Do this once and every future change to `proxy/worker.js` (pushed to
`main`) deploys itself automatically — no more copy-pasting code into
Cloudflare's editor by hand.

1. Go to `dash.cloudflare.com` → your existing `lifelog-worker` Worker.
2. Open its **Settings** (or **Build** ) tab and look for **"Connect to
   Git"** / **"Git integration"**.
3. Authorize Cloudflare's GitHub App and pick this repo
   (`danielnoam/LifeLog`) and the `main` branch.
4. Set the **root directory** to `proxy` — that's where `wrangler.toml`
   and `worker.js` live, which is how Cloudflare knows what to deploy
   and under what name.
5. Save. Cloudflare will do an initial deploy from the current `main`,
   and from then on, every push that touches `proxy/` redeploys it
   within a minute or two, automatically.

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
