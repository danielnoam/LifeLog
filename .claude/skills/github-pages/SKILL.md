---
name: github-pages
description: Build and deploy a no-build static site to GitHub Pages — scaffold the files, get the project-page base path right, optionally add client-side routing (SPA 404 trick) or a PWA layer (manifest + service worker), preview locally, and verify the live deploy. Use when creating a new GitHub Pages site, hosting a static site on Pages, or fixing a Pages site that 404s, ships stale assets, or breaks under its /<repo>/ subpath.
---

# Building a GitHub Pages site

This skill is for **plain static sites with no build step** — vanilla
HTML/CSS/JS served exactly as committed. That's how both reference sites
in this account are built:

- **danielnoam/lifelog** — a static **PWA** (manifest + service worker),
  uses **relative paths**, has a local preview server.
- **danielnoam/portfolio** — a static **SPA** with a client-side router,
  uses the **404 redirect** trick, configures a base path.

Work through the steps that apply. Steps 1–3 and 6–7 apply to every Pages
site; 4 (routing) and 5 (PWA) are opt-in.

## 1. Pick the site type

| Type | What it is | Adds |
|---|---|---|
| **Plain** | One or more real `.html` pages, links go to real files | nothing extra |
| **SPA** | One `index.html`, JS swaps content / a client router owns the URL | step 4 (404 redirect) |
| **PWA** | Installable + offline | step 5 (manifest + service worker) |

No build tooling either way — no npm install, no bundler, no framework
CLI. If the user wants a generator (Jekyll, Astro, Vite, Next export) that
is a different deployment (usually a GitHub Actions build → `gh-pages` or
the `actions/deploy-pages` flow) and out of scope here.

## 2. Repo + Pages setup

1. Put the site files at the **repo root** (`index.html` at the top).
2. Add an empty **`.nojekyll`** file at the root. **Always.** Without it,
   Pages runs Jekyll, which silently drops any folder or file starting
   with `_` and can mangle others. Both reference sites ship it.
3. Turn on Pages: repo **Settings → Pages → Build and deployment →
   Source: Deploy from a branch**, pick the branch (`main`) and `/ (root)`.
4. The URL is **`https://<user>.github.io/<repo>/`** — note the trailing
   `/<repo>/` segment for a project page. This subpath is the source of
   most Pages bugs; see step 3. (A repo named `<user>.github.io` is a
   *user* page served from the domain root with no subpath — then base
   path is a non-issue.)

## 3. Get the base path right — the #1 source of breakage

A project page is served from `…/<repo>/`, **not** the domain root. So a
link like `href="/css/main.css"` resolves to `user.github.io/css/main.css`
— wrong, 404 — instead of `user.github.io/<repo>/css/main.css`. Pick one
strategy and apply it consistently:

### Strategy A — relative paths (preferred for plain/PWA sites)

Reference everything relative to the current document: `./css/main.css`,
`src/app.js`, `./icon.svg`. No leading slash, no repo name anywhere. The
site is then **portable** — it works at the domain root, under `/<repo>/`,
on Netlify, or from `file://` with zero changes. This is how **lifelog**
does it; even its PWA files use it (`manifest.json` → `"start_url": "."`,
`"scope": "."`; `sw.js` precaches `"./"`, `"./index.html"`, `"./src/…"`).

### Strategy B — one configured base constant (for SPA / client routers)

A client-side router needs to know the prefix to build/parse URLs, so a
single source of truth is fine — **as long as it's exactly one place.**
**portfolio** does this with `js/core/config.js → CONFIG.baseUrl =
'/portfolio'`.

> **Pitfall this skill exists to fix:** portfolio leaks the literal
> `/portfolio/` into *four* spots — `index.html` (the favicon `<link>`),
> `config.js` (`defaultPath`), `404.html` (the redirect target), and a
> hard-coded `\/portfolio\/` **regex in `router.js`**. Rename the repo and
> the site breaks in several non-obvious ways. If you use Strategy B,
> route **every** base-path reference through the one constant (and for a
> router, derive the prefix at runtime, e.g. from
> `import.meta.url`/`location`, rather than baking the repo name into a
> regex). When auditing an existing site, grep for the repo name:
> `grep -rn "/<repo>/" --include=*.js --include=*.html --include=*.css .`
> — every hit outside the single config constant is a latent bug.

Don't mix strategies in the same `<head>`: portfolio's `index.html` has
both an absolute `href="/portfolio/assets/…/favicon.ico"` and a relative
`href="css/main.css"` — inconsistent, and the absolute one is the fragile
one.

## 4. Client-side routing (SPA only): the 404 redirect trick

Pages has no server-side rewrites, so deep links like
`…/<repo>/some-page` hit a real 404 — Pages serves your **`404.html`** for
any unknown path. Exploit that to hand the path back to your SPA:

1. **`404.html`** stashes the requested path and bounces to the app root:
   ```html
   <script>
     localStorage.setItem('redirectPath', location.pathname);
     location.replace('/<repo>/');   // or '/' for a user page
   </script>
   ```
2. On boot, the router reads and clears it, then loads the right view —
   see portfolio's `index.html` inline script + `Router.handleRedirect()`
   /`handleInitialRoute()` in `js/core/router.js`.

(`sessionStorage` or a `?redirect=` query param work too; localStorage is
what portfolio uses.) A plain multi-page site doesn't need any of this —
real files resolve directly.

## 5. PWA layer (optional): installable + offline

Only if the user wants "add to home screen" / offline. Mirror **lifelog**:

- **`manifest.json`** — `name`, `short_name`, `display: "standalone"`,
  `theme_color`/`background_color`, an icon (an SVG `"sizes": "any"
  "purpose": "any maskable"` works), and **relative** `start_url`/`scope`
  (`"."`). Link it: `<link rel="manifest" href="manifest.json">`.
- **`sw.js`** service worker — register it, then follow lifelog's hard-won
  rules (the comments in its `sw.js` document why):
  - **Versioned cache name** (`lifelog-v15`); on `activate`, delete every
    cache that isn't the current one. Bump the version to ship updates.
  - **Network-first** for your own files so code changes aren't served
    stale, falling back to cache only when offline. (`skipWaiting()` +
    `clients.claim()` makes a new SW take over promptly.)
  - **Only intercept same-origin GET.** Let third-party/API requests and
    non-GET pass straight through — intercepting them and falling back to
    `index.html` turns a real network/CORS failure into a fake `200` full
    of HTML and hides the error from the app.
  - **Don't precache private/user data** — keep it out of the asset list
    and fetch it at runtime with a graceful fallback.

## 6. Preview locally before pushing

Open `file://` for a quick look, but module scripts, fetch, and service
workers need a real origin. Use a tiny static server like lifelog's
`server.js` (zero-dependency Node, correct MIME table — the part people
get wrong) on `http://localhost:5173`. Check the browser console for path
404s and module errors **before** deploying, since the live subpath is
unforgiving.

> Note: a flat local server serves from `/`, so relative-path sites match
> production but **base-path bugs may hide locally** and only appear under
> `/<repo>/` live. After deploy, always load the real Pages URL and watch
> the Network tab (step 8).

## 7. Hygiene

- **No build step, no dependencies** — keep it vanilla. If you pull a
  library, prefer a committed vendor file (portfolio vendors Prism under
  `js/vendors/`) or a pinned CDN URL; remember CDN scripts won't work
  offline.
- **Keep secrets and private data out of the repo** — Pages is public.
  `.gitignore` anything personal (lifelog ignores `lifelog.json` and
  `data/`; its real data lives in a separate private repo).
- Provide a **`404.html`** even for plain sites — a friendly page beats the
  default Pages 404.

## 8. Verify the live deploy

After Pages builds (watch the green check in **Settings → Pages**, or the
"pages build and deployment" run):

- Load `https://<user>.github.io/<repo>/` and open DevTools **Network** —
  zero 404s on CSS/JS/icons/manifest (catches base-path mistakes).
- Hard-refresh (or bump the SW cache version) if you changed assets — a
  stale service worker is the usual "my fix didn't deploy" culprit.
- SPA: deep-link directly to a sub-route and confirm the 404 redirect
  restores the right view, and that Back/Forward work.
- PWA: confirm it's installable (address-bar install prompt) and that the
  manifest + SW load with no console errors.
- Test once on mobile width too — Pages sites are commonly opened on phones.
