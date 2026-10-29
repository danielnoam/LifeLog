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

## The Android app

The same files, built into an APK by
[Capacitor](https://capacitorjs.com). The web version is unaffected: it
doesn't load or depend on anything the app build adds.

- **Getting it:** open the repo's **Releases** page on the phone, download
  `LifeLog.apk`, and allow your browser to install apps the first time it
  asks. Connect sync by pasting a **setup link** from another device into
  **Settings → Access token**.
- **Updates:** the app checks for a newer release each time it opens and
  offers it. Updates install over the top and keep your data.
- **Backups:** the app keeps itself out of Google's and iCloud's backups
  and out of phone-to-phone transfers (0.261.0), since its storage holds
  the log and the sync token. A new phone starts empty; a setup link from
  another device brings everything back.
- **Share sheet** (0.250.0): LifeLog takes text and links shared from other
  apps. A title from Letterboxd, Steam, IMDb and the like opens the Backlog
  sheet with the lookup running, a Google Maps link goes into the open trip,
  and anything else asks whether it's a Backlog item or a note. The
  installed web app has the same, through the manifest's share target.
- **How it's built:** `.github/workflows/android.yml`, on every push to
  `main`, once the tests pass. `tools/build-www.js` copies the files in `sw.js`'s `ASSETS` list
  into `www/`, Capacitor wraps them, and a release `app-v<version>` is
  published whenever `APP_VERSION` is new.
- **Signing:** Android only installs an update over an app signed with the
  same key, so releases are signed with a key held in two repository
  secrets, `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASSWORD` (alias
  `lifelog`). Without them CI still builds a test APK but publishes nothing.
- **Building locally** (needs the Android SDK): `npm install`,
  `npm run android:sync`, then open `android/` in Android Studio.

## The iOS app

The same files again, built for iPhone by `.github/workflows/ios.yml` on a
Mac runner and attached to each release as `LifeLog.ipa`.

- **It's unsigned.** Without Apple's developer programme ($99/year) there's
  no way to sign it for other phones, so it's installed with
  [AltStore](https://altstore.io) or [SideStore](https://sidestore.io),
  which sign it with your own Apple ID. Apps installed that way last 7
  days; AltStore/SideStore renew them in the background.
- **Widgets** (0.217.0): Habits and Checklist, which tick from the home screen
  (iOS 17), Quick add, This month and a Note. They read the snapshot the
  app writes into an App Group; ticks wait there until the app opens.
  Source in `native/widgets/ios`, added to the generated project by
  `tools/ios-widgets.rb`. Habit reminders and Face ID for the app lock are
  there too.
- **Share sheet** (0.250.0): a share extension (`native/widgets/ios/Share`)
  that leaves what was shared in the App Group and opens the app, which
  takes it from there. Same routing as Android.
- **What differs from Android:** a newer release is offered as a link to
  the release page, since an app can't install another; the phone backup
  is in Files → On My iPhone → LifeLog; no Markdown folder import.
- **With a developer account** the workflow is where signing and a
  TestFlight upload would go.
- Until then, Safari's Add to Home Screen still works as it always has.

## Use it on your phone

The app is an installable **PWA** (manifest + service worker), so once it's
hosted over HTTPS you can add it to your home screen and it works offline.

**1. Host the static files** (free) — push this folder to a GitHub repo and turn
on **GitHub Pages** with Source set to **GitHub Actions** (repo Settings →
Pages), so `.github/workflows/pages.yml` deploys it once the tests pass. You'll get a
`https://<you>.github.io/<repo>/` URL. (Any static host works: Netlify, Vercel,
Cloudflare Pages.)

**2. Connect cloud sync** (first device), in **Settings → Sync**:
- **1. Create a private repo on GitHub** → name it `lifelog-data`, keep it
  private, create.
- **2. Create a token for that repo only** → a fine-grained token with *Only
  select repositories* → `lifelog-data` and *Contents: Read and write*.
  Generate, copy.
- Paste it in and press **Connect**. The app uploads your current log. The
  token is stored only in that browser, and it can't touch any other repo
  of yours. (Under **Repository, file and branch** there is still the
  classic-token path, which lets the app create the repo for you at the
  price of a token that reaches every repo you own.)

**3. Add your other devices** — still in **Settings → Cloud sync**, use
**Set up another device → Copy** to get a link that carries the whole
connection. Open that link on your phone and it connects automatically (no
retyping the token; the token is removed from the URL right after). Then use the
browser's *Add to Home Screen* / *Install app*.

> The setup link contains your access token — only open/share it on your own
> devices.

## Features

Five tabs, each with modes: swipe across the page, press and hold the tab
(hover it on a desktop), or tap the tab you're on to move between them.
Tabs and modes can be turned off, reordered, and set to open on a given
mode, per device. **DONE.md** lists every feature with the version it came
in; this is the tour.

- **Notebook**
  - **Notes** – plain notes, lists (the checklist: items tick, reorder by
    long press, and merge item by item between devices), quotes and
    drawing boards. Note categories, collections that open notes as pages,
    favourites, and a note can become a timeline entry.
  - **Habits** – to do or to avoid, every day or certain days, times a
    day. One tap ticks today; a grid pages back for backfilling, with
    streaks, a start date and undo. Reminders on Android and iPhone.
- **Timeline**
  - **Log** – what you've finished, by year and month, with per-year
    accomplishments. An entry carries a rating, notes, cover art, genres,
    a length and a start month; what you've started sits in an In
    progress card at the top.
  - **Stats** – totals by category and year, highlights, seasonality,
    genres, an activity heatmap, most-repeated titles, and that year in
    numbers. **Recap** turns a year into a slideshow, offered in December.
- **Backlog**
  - **List** – what you mean to get to, by category, in bands: starred,
    ready, Early Access or Still airing, unreleased, dropped, each folding
    away. Bought, authors and In progress per category, sorts inside each
    band, Pick random and Spin. A Show row narrows it to Starred, Bought
    or both.
  - **Discover** – what's popular now and coming soon from the sources your
    categories use, with Hide what I have. Books get the NYT bestseller
    lists with a free New York Times key. Logging a synced title as done
    offers the next one in its series.
  - **Upcoming** – what's coming, by month, with as much of the date as is
    known, countdowns, next episodes, and an Out today card. On the
    phones, a notification on release day if you want one, and one when a
    Steam game drops to the price you set on it.
- **Ledger**
  - **Expenses** – by year and month, broken down by category. Amounts do
    basic math and take other currencies at the day's rate. Recurring
    expenses are charged on a day you pick (a weekday, a day of the month,
    or a date each year) and have pauses, plan changes, one-off charges, merges and
    per-occurrence edits; projects group a burst of spending. On the
    phones, a reminder before a plan charges. On Android, Google Wallet
    payments are offered in.
  - **Summary** – highlights, recurring, by month, by category and the
    largest expenses.
- **Travel** (off by default) – trips with places By time, By area or on a
  Map, imported from Google Maps lists, with Google's rating, hours and
  reviews when you add your own Places key.

**Throughout**

- **Search** – one box over everything: entries, backlog, notes, habits,
  boards, expenses, trips and places, Settings pages. "Filter" on a group
  narrows that tab instead, for bulk work.
- **Media lookups** – cover art, ratings, release dates, genres,
  descriptions and lengths from RAWG, SteamGridDB, TMDB, Open Library,
  AniList, Jikan, Google Books and MusicBrainz, with a primary and a
  fallback source per category; the "+ Steam + GG.deals" sources add a
  store link and a price. See [Media sources and keys](#media-sources-and-keys).
- **Imports** – Steam wishlist and played games, AniList (every list),
  Letterboxd, Google Maps lists, Markdown, PDF and EPUB as notes, and JSON
  or CSV per tab. Every import goes through one review screen (edit a row,
  see what an update writes) and can be undone.
- **Activity** – anything that takes a while (imports, bulk syncs, lookups)
  runs in one list, keeps going with the app put away on Android, and is
  offered again if the app was closed on it.
- **Share into LifeLog** – from other apps on Android and iPhone, and into
  the installed web app.
- **Bulk actions** – long-press to select, then move, sync or delete.
- **Sync and history** – GitHub and a local file, merged between devices,
  with every save in Settings → History to restore or undo (an AI's
  changes through the bridge too, tagged with its name), and Recently
  deleted.
- **App lock** – a PIN, with fingerprint or face where the device has it.
- **Settings** – pages with search, four themes (Default, Light, Nord,
  Dracula), fonts and layout per device, a Notifications page on the
  phones, and About with what's new, the credits and the errors on this
  device.
- **Widgets** – checklist, habits, quick add, spending, note, random
  note, upcoming releases and in progress on Android; habits, checklist,
  quick add, this month and a note on iPhone. On Android an optional
  background refresh runs the app with no screen on a schedule, so the
  widgets and the phone's alerts catch up with the app closed.
- **Offline** – an installable PWA with a service worker, so it works with
  no connection and syncs when there is one.

## Project layout

```
index.html          app shell + every modal
src/styles.css      styling (dark theme)
src/app.js          shell: state, routing, filters, shared helpers
src/journal.js      Timeline and its Stats mode, entry modal, achievements
src/notes.js        Notes: the feed, the sheet, lists (the old To-do) and quotes
src/backlog.js      Backlog view, backlog modal, the random picker
src/finance.js      Ledger and its Summary mode, expenses, recurring
src/media.js        cover art + metadata from the eight media sources
src/sync.js         Steam wishlist / AniList Planning imports, GG.deals prices
src/wheel.js        the canvas spin wheel
src/storage.js      persistence: local-file / GitHub / localStorage backends
src/merge.js        pure three-way merge for reconciling two devices' edits
src/reconcile.js    keyed list reconciliation — update the DOM in place, not by rebuilding
src/io.js           JSON/CSV import + export, and the shared review picker
src/docimport.js    PDF and EPUB files read as text, for importing them as notes
src/payments.js     the Android switch for Google Wallet payments offered to the Ledger
src/reminders.js    habit reminder times, kept on the phone
src/alerts.js       charge and release-day notifications: what to ring, and when
src/settings.js     the Settings modal
src/qr.js           self-contained QR encoder for the device setup link
bridge/             how other AIs read and change LifeLog: MCP server, command line,
                    data guide (bridge/README.md)
server.js           tiny static server
proxy/              optional Cloudflare Worker: CORS proxy for Steam/SteamGridDB
test/               zero-dependency Node tests — `node test/run-all.js`
DESIGN.md           the design language: tokens, type/space/radius scales, motion,
                    components, voice, accessibility. Read before UI work
.claude/skills/     how to build (lifelog-design), check (lifelog-ui-audit) and
                    ship (release-checklist) a change
TODO.md             the work that's left, each item with a plan
DONE.md             what the app does, by area, with the version each came in
NOTES.md            why what shipped is the way it is — read before changing
                    something that looks arbitrary
DROPPED.md          decided against, and why, so it isn't re-litigated
manifest.json       PWA manifest (installable)
sw.js               service worker (offline cache)
icon.svg            app icon (assets/logo.svg is the same mark for the Android
                    and iOS builds)
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
| Augmented Steam | no; CORS proxy | games on Steam — How Long to Beat times, OpenCritic and Metacritic user scores |
| Open Library, AniList, Jikan, Google Books, MusicBrainz | no | books, anime/manga, music |

Steam's own endpoints and SteamGridDB send no CORS headers, so the wishlist
import, Steam release dates, prices and game times need a proxy you host yourself —
`proxy/` is a Cloudflare Worker that does it in a free account. See
[`proxy/README.md`](proxy/README.md).

## Tests

```bash
node test/run-all.js
```

Plain Node `assert`, no framework and no install step. They cover the pure
data logic — sanitizers, the three-way merge, release-date parsing, release
states, finance maths, which items a sync pass touches — plus the media
layer's request routing, against a stubbed `fetch`.

The browser suites (`node test/browser/run-all.js`, see
[`test/browser/README.md`](test/browser/README.md)) drive the real app in
Chromium. CI runs both through `.github/workflows/tests.yml`, and the
Android, iOS and Pages workflows wait on it: a failing test publishes
nothing.

## Re-importing from the sheet

`data/parse.js` decoded the exported sheet CSV (`data/raw_log.b64`) into
`lifelog.json`. It's kept only for reference; day-to-day you edit in the app.

### Note on "Other" entries

Cells like `Other | 7` in the sheet (a count of misc items that month) were
imported literally as Other entries titled "7". Adjust as you like in the app.
