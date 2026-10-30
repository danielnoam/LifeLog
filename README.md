# LifeLog

A personal log of what you did, what's next and what it cost: the games,
shows, films, books and trips you finished, the backlog you haven't got to,
your notes and habits, and your spending. One JSON file you own, synced
through a private GitHub repo.

Plain HTML, CSS and JS with no build step and no dependencies. The same
files are the web app (GitHub Pages), the Android app and the iOS app
(Capacitor).

## Contents

- [Getting around](#getting-around)
- [Notebook](#notebook): [Notes](#notes), [Habits](#habits)
- [Timeline](#timeline): [Log](#log), [Layouts](#timeline-layouts-covers-and-calendar), [Stats and Recap](#stats-and-recap)
- [Backlog](#backlog): [List](#list), [Covers](#covers), [An item's sheet](#an-items-sheet), [Next releases](#next-releases), [Discover](#discover)
- [Ledger](#ledger): [Expenses](#expenses), [Summary](#summary)
- [Travel](#travel)
- [Search](#search)
- [Settings](#settings)
- [Throughout the app](#throughout-the-app)
- [Setup](#setup): [Run it](#run-it), [Where your data lives](#where-your-data-lives), [Use it on your phone](#use-it-on-your-phone), [Android](#the-android-app), [iOS](#the-ios-app)
- [Media sources and keys](#media-sources-and-keys)
- [The AI bridge](#the-ai-bridge)
- [Project layout](#project-layout)
- [Tests](#tests)
- [Screenshots](#screenshots)

Every screenshot is made-up demo data. Left is a computer, right a phone.

## Getting around

Five tabs, each with modes: Notebook, Timeline, Backlog, Ledger and Travel.
On a computer the tabs sit along the top and hovering one drops its modes
out; on a phone they're the bar at the bottom, and holding a tab raises its
modes. Swiping across the page moves between modes on both, and tapping
the tab you're on steps through them. Tabs and modes can be turned off,
reordered and set to open on a given mode, per device. The + button adds
anything from anywhere.

<table><tr>
<td><img src="docs/screenshots/tabs-desktop.webp" alt="A tab's modes on a computer" width="620"></td>
<td><img src="docs/screenshots/tabs-phone.webp" alt="A held tab's modes on a phone" width="200"></td>
</tr></table>

## Notebook

### Notes

Plain notes (Markdown), checklists and quotes, plus drawing boards with a
hand-drawn look. Note categories, favourites, and collections that open
their notes as pages. A checklist's items tick, reorder by long press and
merge item by item between devices. A note can become a Timeline entry.

<table><tr>
<td><img src="docs/screenshots/notes-desktop.webp" alt="Notes on a computer" width="620"></td>
<td><img src="docs/screenshots/notes-phone.webp" alt="Notes on a phone" width="200"></td>
</tr></table>

### Habits

Habits to do or to avoid, every day or on set days, once or several times a
day. One tap ticks today; the grid pages back for backfilling. Streaks, a
best run, and Insights (kept rate, longest run, best and weakest weekday,
six months as bars). Reminders on Android and iPhone.

<table><tr>
<td><img src="docs/screenshots/habits-desktop.webp" alt="Habits on a computer" width="620"></td>
<td><img src="docs/screenshots/habits-phone.webp" alt="Habits on a phone" width="200"></td>
</tr></table>

## Timeline

### Log

What you finished, by year and month, with each year's accomplishments.
An entry has a rating, notes, cover art, genres, a length and when you
started it. What you're in the middle of sits in the In progress card at
the top; ✓ there logs it with the months it took.

<table><tr>
<td><img src="docs/screenshots/timeline-desktop.webp" alt="The Timeline on a computer" width="620"></td>
<td><img src="docs/screenshots/timeline-phone.webp" alt="The Timeline on a phone" width="200"></td>
</tr></table>

### Timeline layouts: Covers and Calendar

View → Layout draws the Log as cover art, or as a calendar of the days you
finished things. A picked day lists its entries; entries without a day wait
in No day set.

<table><tr>
<td><img src="docs/screenshots/timeline-calendar-desktop.webp" alt="The Timeline's calendar on a computer" width="620"></td>
<td><img src="docs/screenshots/timeline-calendar-phone.webp" alt="The Timeline's calendar on a phone" width="200"></td>
</tr></table>

### Stats and Recap

Totals by category and year, highlights, the monthly pattern, genres, an
activity heatmap, the most repeated titles and that year in numbers.
**Recap** turns a year into a slideshow, offered in December.

<table><tr>
<td><img src="docs/screenshots/stats-desktop.webp" alt="Stats on a computer" width="620"></td>
<td><img src="docs/screenshots/stats-phone.webp" alt="Stats on a phone" width="200"></td>
</tr></table>

## Backlog

### List

What you mean to get to, by category, in bands that each fold away:
starred, ready, Early Access or Still airing, unreleased, dropped. Rows
show the score, year, length, price and whether it's bought. Sort inside
each band (name, added, release date, price, length), narrow it with the
Show row (Starred, Bought, Not bought, Price alert), or let Pick random or
Spin choose. ▷ starts an item (it moves to In progress), ✓ logs it on the
Timeline.

<table><tr>
<td><img src="docs/screenshots/backlog-desktop.webp" alt="The Backlog on a computer" width="620"></td>
<td><img src="docs/screenshots/backlog-phone.webp" alt="The Backlog on a phone" width="200"></td>
</tr></table>

### Covers

View → Layout → Covers draws any Backlog mode as a wall of cover art, with
marks for starred, bought and price alert. A cover opens like a row.

<table><tr>
<td><img src="docs/screenshots/backlog-covers-desktop.webp" alt="Backlog covers on a computer" width="620"></td>
<td><img src="docs/screenshots/backlog-covers-phone.webp" alt="Backlog covers on a phone" width="200"></td>
</tr></table>

### An item's sheet

Every item and entry opens in a sheet: the cover with its scores, length and
store links, the description, notes, and Sync to fill it from a media
source. For a Steam game: How Long to Beat times, OpenCritic and Metacritic
user scores, the GG.deals price, and a price alert in US dollars.

<table><tr>
<td><img src="docs/screenshots/item-sheet-desktop.webp" alt="A backlog item's sheet on a computer" width="620"></td>
<td><img src="docs/screenshots/item-sheet-phone.webp" alt="A backlog item's sheet on a phone" width="200"></td>
</tr></table>

### Next releases

What's coming, by month, with as much of the date as is known, countdowns
and next episodes, and an Out today card. On the phones, a notification on
release day if you want one, and one when a Steam game drops to your price.
Release dates are re-checked, and again on the day something is due.

<table><tr>
<td><img src="docs/screenshots/next-releases-desktop.webp" alt="Next releases on a computer" width="620"></td>
<td><img src="docs/screenshots/next-releases-phone.webp" alt="Next releases on a phone" width="200"></td>
</tr></table>

### Discover

What's popular now and coming soon from the sources your categories use,
with Hide what I have. Books get the NYT bestseller lists with a free New
York Times key. Logging a synced title offers the next one in its series.
(No screenshot: it needs the live sources.)

## Ledger

### Expenses

Spending by year and month. Amounts do basic math and take other
currencies at the day's rate. Recurring bills charge on a day you pick
(a weekday, a day of the month, or a date each year) and have pauses, plan
changes, one-off charges, merges and per-charge edits. Projects group a
burst of spending, like a trip; a category can hold subcategories. On the
phones, a reminder before a bill charges; on Android, Google Wallet
payments are offered in.

<table><tr>
<td><img src="docs/screenshots/ledger-desktop.webp" alt="The Ledger on a computer" width="620"></td>
<td><img src="docs/screenshots/ledger-phone.webp" alt="The Ledger on a phone" width="200"></td>
</tr></table>

### Summary

Highlights, recurring, by month, by category (with subcategories) and the
largest expenses.

<table><tr>
<td><img src="docs/screenshots/ledger-summary-desktop.webp" alt="The Ledger's summary on a computer" width="620"></td>
<td><img src="docs/screenshots/ledger-summary-phone.webp" alt="The Ledger's summary on a phone" width="200"></td>
</tr></table>

## Travel

Off by default (Settings → Tabs). Trips with places planned By time, By
area or on a Map, with times, days, a visited tick and drag to arrange.
Places come in from Google Maps lists or links, and show Google's rating,
hours and reviews when you add your own Places key.

<table><tr>
<td><img src="docs/screenshots/travel-desktop.webp" alt="A trip on a computer" width="620"></td>
<td><img src="docs/screenshots/travel-phone.webp" alt="A trip on a phone" width="200"></td>
</tr></table>

## Search

One box over everything: entries, backlog, notes, habits, boards, expenses,
trips, places and Settings pages, grouped by tab. Filter on a group narrows
that tab instead, for bulk work.

<table><tr>
<td><img src="docs/screenshots/search-desktop.webp" alt="Search on a computer" width="620"></td>
<td><img src="docs/screenshots/search-phone.webp" alt="Search on a phone" width="200"></td>
</tr></table>

## Settings

Pages with their own search: sync, import and export, history, app lock,
four themes (Default, Light, Nord, Dracula), fonts and layout, tabs, media
lookups, imports, release dates, notifications on the phones, and About
with what's new, the credits and the errors on this device.

<table><tr>
<td><img src="docs/screenshots/settings-desktop.webp" alt="Settings on a computer" width="620"></td>
<td><img src="docs/screenshots/settings-phone.webp" alt="Settings on a phone" width="200"></td>
</tr></table>

## Throughout the app

- **Media lookups**: cover art, scores, release dates, genres, descriptions
  and lengths, from a primary and a fallback source per category. See
  [Media sources and keys](#media-sources-and-keys).
- **Imports**: Steam wishlist and played games, AniList, Letterboxd, Google
  Maps lists, Markdown, PDF and EPUB as notes, and JSON or CSV per tab.
  Every import goes through one review screen and can be undone.
- **AniList**: the import reads every list. Planning goes to the Backlog,
  Watching starts an item, Completed logs it on the Timeline, Paused and
  Dropped mark it dropped. Shows and manga keep how far they've run.
- **Activity**: anything that takes a while runs in one list, keeps going
  with the app put away on Android, and is offered again if the app was
  closed on it.
- **Share into LifeLog** from other apps on Android and iPhone, and into the
  installed web app: titles go to the Backlog, Maps links to a trip,
  anything else to a note.
- **Bulk actions**: long-press to select, then move, sync or delete.
- **Sync and history**: GitHub and a local file, merged between devices,
  every save in Settings → History to restore or undo, and Recently deleted.
- **App lock**: a PIN, with fingerprint or face where the device has it.
- **Widgets**: on Android, checklist, habits, quick add, spending, note,
  random note, upcoming and in progress, with an optional background
  refresh; on iPhone, habits, checklist, quick add, this month and a note.
- **Keyboard**: N adds, number keys switch tabs, / searches, ? lists the rest.
- **Offline**: an installable PWA that works with no connection and syncs
  when there is one.

## Setup

### Run it

Double-click **`start.cmd`** (or run `node server.js`) and open
<http://localhost:5173>. Needs [Node.js](https://nodejs.org), and a
Chromium browser (Chrome or Edge) for saving to a local file.

### Where your data lives

The app keeps a working copy on the device and, on every save, writes to
every target connected in **Settings → Sync**:

- **GitHub** (works on phones): `lifelog.json` in a **private repo**, so
  every device shares one log and every save is a commit. Boards and trips
  sit beside it in `boards.json` and `travel.json`.
- **Local file** (desktop Chrome and Edge): a `.json` file you pick, for
  example in your Google Drive folder.

With both, GitHub is the live source and the file a backup that mirrors
every save. With neither, the log stays in the browser; Export JSON and CSV
are there for manual backups.

### Use it on your phone

The app is an installable PWA, so once it's hosted over HTTPS it can go on
the home screen and works offline.

1. **Host it** (free): push this folder to GitHub and set repo Settings →
   Pages → Source to **GitHub Actions**; `.github/workflows/pages.yml`
   deploys it once the tests pass. Any static host works too.
2. **Connect sync** on the first device, in Settings → Sync: create a
   private repo named `lifelog-data`, then a fine-grained token with *Only
   select repositories* → `lifelog-data` and *Contents: Read and write*.
   Paste it and press Connect. The token stays in that browser and can't
   reach any other repo.
3. **Add your other devices**: Settings → Sync → Set up another device →
   Copy gives a link that carries the connection. Open it on the phone (or
   scan its QR code in the Android app), then Add to Home Screen.

> The setup link contains your access token. Only open or share it on your
> own devices.

### The Android app

The same files, built into an APK by [Capacitor](https://capacitorjs.com).

- **Getting it**: download `LifeLog.apk` from the repo's Releases page on
  the phone and allow the install. Connect sync with a setup link.
- **Updates**: the app checks for a newer release when it opens and installs
  it over the top, keeping your data.
- **Backups**: the app stays out of Google's backups and phone-to-phone
  transfers, since it holds the log and the token. A setup link brings
  everything back on a new phone. Settings can keep a copy in
  Documents/LifeLog.
- **How it's built**: `.github/workflows/android.yml`, on every push to
  `main` once the tests pass. `tools/build-www.js` copies the files in
  `sw.js`'s `ASSETS` list into `www/`, Capacitor wraps them, and a release
  `app-v<version>` is published whenever `APP_VERSION` is new.
- **Signing**: releases are signed with the key in the repository secrets
  `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASSWORD` (alias `lifelog`).
  Without them CI builds a test APK and publishes nothing.
- **Building locally** (needs the Android SDK): `npm install`,
  `npm run android:sync`, then open `android/` in Android Studio.

### The iOS app

Built by `.github/workflows/ios.yml` on a Mac runner and attached to each
release as `LifeLog.ipa`.

- **It's unsigned**: without Apple's developer programme it's installed
  with [AltStore](https://altstore.io) or [SideStore](https://sidestore.io),
  which sign it with your own Apple ID and renew it every 7 days.
- **Widgets, reminders, Face ID and the share sheet** are there; the
  widgets' source is in `native/widgets/ios`, added by `tools/ios-widgets.rb`.
- **What differs from Android**: an update is offered as a link to the
  release, the phone backup is in Files → On My iPhone → LifeLog, and
  there's no Markdown folder import.
- Safari's Add to Home Screen still works as the web app.

## Media sources and keys

Everything works without a key; a source that needs one stays quiet until
you add it in **Settings → Media lookups**.

| Source | Key needed | Good for |
| --- | --- | --- |
| RAWG | yes (free) | games: ratings, playtime, genres, descriptions |
| SteamGridDB | yes (free) + CORS proxy | games: better cover art |
| TMDB | yes (free) | films and TV, with next-episode dates |
| GG.deals | yes (free); proxy if CORS-blocked | current game prices |
| Augmented Steam | no; CORS proxy | Steam games: How Long to Beat times, OpenCritic and Metacritic user scores |
| New York Times | yes (free) | books: bestseller lists in Discover |
| Google Places | yes (your own) | Travel: a place's rating, hours and reviews |
| Open Library, AniList, Jikan, Google Books, MusicBrainz | no | books, anime and manga, music |

Steam's endpoints and SteamGridDB send no CORS headers, so on the web the
wishlist import, Steam dates, prices and game times need a proxy you host:
`proxy/` is a Cloudflare Worker for a free account. See
[`proxy/README.md`](proxy/README.md). The Android app needs no proxy.

## The AI bridge

`bridge/` lets other AIs read and change LifeLog: an MCP server and a
command line that run the app's own code against the same `lifelog.json`.
Its changes show in Settings → History tagged with the AI's name, and each
can be undone. See [`bridge/README.md`](bridge/README.md) and
[`bridge/DATA.md`](bridge/DATA.md).

## Project layout

```
index.html          app shell and every sheet
src/app.js          shell: state, tabs and modes, filters, shared helpers
src/journal.js      Timeline: Log, Stats, the entry sheet, accomplishments
src/backlog.js      Backlog: List, Next releases, Discover, the item sheet
src/notes.js        Notes: the feed, the sheet, lists and quotes
src/boards.js       drawing boards (boards.json)
src/habits.js       Habits
src/finance.js      Ledger: expenses, recurring bills, Summary
src/travel.js       Travel: trips and places (travel.json)
src/recap.js        the yearly Recap
src/search.js       one search across everything
src/media.js        cover art and metadata from the media sources
src/sync.js         Steam and AniList imports, GG.deals prices, release re-checks
src/letterboxd.js   the Letterboxd import
src/io.js           JSON/CSV import and export, and the shared review screen
src/docimport.js    PDF and EPUB read as text, for notes
src/markdown.js     Markdown for notes in a collection
src/jobs.js         Activity: the work that takes a while
src/share.js        what other apps share into LifeLog
src/storage.js      persistence: GitHub, local file, IndexedDB
src/merge.js        the three-way merge between devices
src/reconcile.js    keyed list updates in place
src/settings.js     the Settings sheet
src/alerts.js       charge and release-day notifications
src/reminders.js    habit reminder times, kept on the phone
src/payments.js     Google Wallet payments offered to the Ledger (Android)
src/widgets.js      the home-screen widgets, from the app's side
src/headless.js     Android's background refresh
src/platform.js     browser or native app, and native HTTP
src/icons.js        the Lucide icon map
src/errlog.js       the errors this device has hit
src/qr.js, wheel.js QR codes for setup links; the Spin wheel
src/vendor/         Leaflet (maps), rough.js and the Virgil font (boards)
src/styles.css      every style and the four themes
native/             Android and iOS widgets, reminders, share extension
bridge/             the AI bridge: MCP server, command line, data guide
proxy/              optional Cloudflare Worker: CORS proxy for Steam
tools/              native build helpers, and readme-shots.js for these screenshots
docs/screenshots/   the README's screenshots
test/               zero-dependency tests: node test/run-all.js
server.js, start.cmd tiny static server
manifest.json, sw.js PWA manifest and service worker
DESIGN.md           the design language; read before UI work
.claude/skills/     how to build (lifelog-design), check (lifelog-ui-audit)
                    and ship (release-checklist) a change
TODO.md             the work that's left, each item with a plan
DONE.md             every feature, by area, with the version it came in
NOTES.md            why things are the way they are
DROPPED.md          decided against, and why
CHANGELOG.md        every release, in user-facing words
```

## Tests

```bash
node test/run-all.js            # unit tests, plain Node assert
node test/browser/run-all.js    # browser suites, needs Playwright
```

The unit tests cover the data logic: sanitizers, the merge, release dates,
finance maths, sync passes and the media layer against a stubbed `fetch`.
The browser suites ([`test/browser/README.md`](test/browser/README.md))
drive the real app in Chromium. CI runs both through
`.github/workflows/tests.yml`, and the Android, iOS and Pages workflows
wait on it: a failing test publishes nothing.

## Screenshots

`node tools/readme-shots.js` takes every screenshot in this README from
made-up demo data, at 1280×800 and at phone size, into `docs/screenshots/`.
`node tools/readme-shots.js backlog` takes only the shots whose name holds
"backlog". It needs Playwright, like the browser suites, and blocks every
request off the machine. A new feature with something to see gets a shot
here: add it to `SHOTS` in the script, with demo data that shows it.
