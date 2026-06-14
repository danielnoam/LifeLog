# LifeLog

A standalone web app to view, edit, and count your media/experience log
(Games, Shows, Movies, Books, Trips, …) — imported from your Google Sheet,
stored in a plain JSON file you own.

## Run it

Double-click **`start.cmd`** (or run `node server.js`) and open
<http://localhost:5173>. Requires [Node.js](https://nodejs.org) and a
Chromium browser (Chrome/Edge) for the "save to a file" feature.

## Where your data lives

The app keeps a working copy in the browser and, on every save, writes to
**every target you've connected** (in **Settings → Data**). A `localStorage`
cache always sits underneath as an offline fallback.

- **GitHub cloud sync** *(works on phones)* — saves `lifelog.json` into a
  **private GitHub repo** so your phone and desktop share one log. Every save is
  a commit, so you get free version history. See
  [Use it on your phone](#use-it-on-your-phone).
- **Local file** *(desktop Chrome/Edge only)* — a `.json` file you pick (e.g.
  inside your **Google Drive** folder).

You can connect **both at once**: GitHub is then the *live sync source* (it wins
when the app loads, and freshens the file), and the local file is kept as an
automatic **on-disk backup** that mirrors every save. Connect just one, or
neither (browser-only) and use **Export JSON / Export CSV** for manual backups.

Your original Google Sheet is never touched.

## Use it on your phone

The app is an installable **PWA** (manifest + service worker), so once it's
hosted over HTTPS you can add it to your home screen and it works offline.

**1. Host the static files** (free) — push this folder to a GitHub repo and turn
on **GitHub Pages** (repo Settings → Pages → deploy from branch). You'll get a
`https://<you>.github.io/<repo>/` URL. (Any static host works: Netlify, Vercel,
Cloudflare Pages.)

**2. Connect cloud sync** (first device):
- Open the app → **Settings → Cloud sync** → **Create a token on GitHub →**
  (the link is pre-filled with the right scope) → **Generate token** → copy it.
- Paste it in and press **Connect**. The app **creates the private `lifelog-data`
  repo for you** and uploads your current log. (Use **Advanced** if you want a
  different repo/branch.) The token is stored only in that browser.

**3. Add your other devices** — still in **Settings → Cloud sync**, use
**Set up another device → Copy** to get a link that carries the whole
connection. Open that link on your phone and it connects automatically (no
retyping the token; the token is removed from the URL right after). Then use the
browser's *Add to Home Screen* / *Install app*.

> The setup link contains your access token — only open/share it on your own
> devices.

## Features

- **Timeline** – entries grouped by year → month, with per-year accomplishments.
- **By Category** – collapsible lists with counts per type.
- **Stats** – totals per category and per year, with bar charts.
- **Filters** – year dropdown, category chips, and title search.
- **Category management** – add / rename / recolor / reorder / delete types
  (Settings).

## Project layout

```
index.html        app shell
src/styles.css    styling (dark theme)
src/storage.js    persistence: local-file / GitHub / localStorage backends
src/app.js        app logic & views
server.js         tiny static server
manifest.json     PWA manifest (installable)
sw.js             service worker (offline cache)
icon.svg          app icon
lifelog.json      your data (seed = imported sheet)
data/             one-time import: raw CSV + parse.js (kept for reference)
```

## Re-importing from the sheet

`data/parse.js` decoded the exported sheet CSV (`data/raw_log.b64`) into
`lifelog.json`. It's kept only for reference; day-to-day you edit in the app.

### Note on "Other" entries

Cells like `Other | 7` in the sheet (a count of misc items that month) were
imported literally as Other entries titled "7". Adjust as you like in the app.
