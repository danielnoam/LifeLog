# LifeLog

A standalone web app for the log of what you've done and what you mean to do
next — the games, shows, movies, books and trips you've finished, the backlog
you haven't, and what you've been spending. Originally imported from a Google
Sheet; now stored in a plain JSON file you own.

No build step, no dependencies, no framework: it's vanilla HTML, CSS and JS
served as static files.

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

Five views, in two groups.

**Journal**

- **Timeline** – what you've finished, grouped by year → month, with per-year
  accomplishments. An entry can carry a rating, notes, cover art, genres, a
  length, and a start month for anything that took more than one.
- **Stats** – totals by category and year, a highlights strip (busiest month,
  longest streak, this year vs last), seasonality, genres, an activity
  heatmap, most-repeated titles, and a year-in-review card.
- **Backlog** – what you mean to get to, as **By category** or **Next
  releases**. Items sort into starred → ready → Early Access → unreleased →
  dropped bands, and the category count sets the last three aside so it reads
  as things you could actually finish. **Pick random** draws one for you out
  of a bag, so nothing repeats until everything in scope has had a turn.
- **Discover** – the third Backlog mode, and the only screen that looks
  outward: what is popular right now and what is coming, read from the same
  media sources your categories already use. Adding from it fills the item
  in exactly as a manual sync would.

**Finance**

- **Ledger** – expenses by year → month, each month broken down by category.
- **Summary** – total spend, average and biggest month, top category, a
  12-month trend, one-off vs recurring, and your largest expenses.
- **Recurring expenses** – with pauses, per-occurrence overrides, plan
  changes over time, and a picker for linking past expenses to a plan.

**Throughout**

- **Media sync** – fill in cover art, ratings, release dates, genres,
  descriptions and lengths from RAWG, SteamGridDB, TMDB, Open Library,
  AniList, Jikan, Google Books and MusicBrainz. Set a primary and a fallback
  source per category in **Settings → Media**; the "+ Steam + GG.deals"
  combo sources also resolve a Steam App ID for a store link and a price.
- **List imports** – pull your **Steam wishlist** or your **AniList
  Planning** list straight into the backlog, dup-checked against what's
  already there. A quiet background check keeps release dates current.
- **A wheel to spin** – in the **+** menu for a list you type yourself, and
  beside the backlog's random pick.
- **Filters** – year and category chips, plus a search across titles and
  notes.
- **Bulk actions** – long-press to select, then edit, sync, or delete many
  items at once.
- **Category management** – add / rename / recolour / reorder / delete, for
  both journal and finance categories.
- **Import / export** – JSON and CSV, both directions, each routed through a
  review screen so you see what will land before it does.
- **App lock** – an optional PIN, with fingerprint / Face ID where the
  device offers it.
- **Offline** – an installable PWA with a service worker, so it works with
  no connection and syncs when there is one.

## Project layout

```
index.html          app shell + every modal
src/styles.css      styling (dark theme)
src/app.js          shell: state, routing, filters, shared helpers
src/journal.js      Timeline + Stats views, entry modal, achievements
src/backlog.js      Backlog view, backlog modal, the random picker
src/finance.js      Ledger + Summary views, expenses, recurring expenses
src/media.js        cover art + metadata from the eight media sources
src/sync.js         Steam wishlist / AniList Planning imports, GG.deals prices
src/wheel.js        the canvas spin wheel
src/storage.js      persistence: local-file / GitHub / localStorage backends
src/merge.js        pure three-way merge for reconciling two devices' edits
src/io.js           JSON/CSV import + export, and the shared review picker
src/settings.js     the Settings modal
src/qr.js           self-contained QR encoder for the device setup link
server.js           tiny static server
proxy/              optional Cloudflare Worker: CORS proxy for Steam/SteamGridDB
test/               zero-dependency Node tests — `node test/run-all.js`
manifest.json       PWA manifest (installable)
sw.js               service worker (offline cache)
icon.svg            app icon
lifelog.json        your data (seed = imported sheet)
data/               one-time import: raw CSV + parse.js (kept for reference)
```

## Media sources and keys

Everything works without a key; the sources that need one just stay quiet
until you add it in **Settings → Media**.

| Source | Key needed | Good for |
| --- | --- | --- |
| RAWG | yes (free) | games — ratings, playtime, genres, descriptions |
| SteamGridDB | yes (free) + CORS proxy | games — much better cover art |
| TMDB | yes (free) | movies and TV, incl. next-episode dates |
| GG.deals | yes (free); proxy if CORS-blocked | current game prices |
| Open Library, AniList, Jikan, Google Books, MusicBrainz | no | books, anime/manga, music |

Steam's own endpoints and SteamGridDB send no CORS headers, so the wishlist
import, Steam release dates and prices need a proxy you host yourself —
`proxy/` is a Cloudflare Worker that does it in a free account. See
[`proxy/README.md`](proxy/README.md).

## Tests

```bash
node test/run-all.js
```

Plain Node `assert`, no framework and no install step. They cover the pure
data logic — sanitizers, the three-way merge, release-date parsing, finance
maths — plus the media layer's request routing, against a stubbed `fetch`.

## Re-importing from the sheet

`data/parse.js` decoded the exported sheet CSV (`data/raw_log.b64`) into
`lifelog.json`. It's kept only for reference; day-to-day you edit in the app.

### Note on "Other" entries

Cells like `Other | 7` in the sheet (a count of misc items that month) were
imported literally as Other entries titled "7". Adjust as you like in the app.
