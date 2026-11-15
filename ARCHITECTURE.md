# LifeLog architecture

Where the code lives, how it's tested and how the README's screenshots are
taken. What the app does is in [README.md](README.md); how to work on it is
in [CONTRIBUTING.md](CONTRIBUTING.md).

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
src/invest.js       The Ledger's Investments mode: watchlist and pins (investments.json)
src/home.js         Home: in progress, coming up, the scratchpad and pinned notes
src/recap.js        the yearly Recap
src/search.js       one search across everything
src/media.js        cover art and metadata from the media sources
src/sync.js         Steam import, the two-way AniList sync, GG.deals prices, release re-checks
src/letterboxd.js   the Letterboxd import
src/stremio.js      the Stremio sync, read only
src/io.js           JSON/CSV import and export, and the shared review screen
src/docimport.js    PDF and EPUB read as text, for notes
src/markdown.js     Markdown for notes in a collection
src/images.js       images in notes: shrunk, kept on the device, synced
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
src/platform.js     browser, phone or computer app, and native HTTP
src/desktop.js      the Windows and Linux app: tray, reminders, updates
src/dates.js        where a week starts and how a date is written
src/datefield.js    every date box drawn in that format
src/icons.js        the Lucide icon map
src/select.js       the app's own dropdown list for every <select>
src/keel/errlog.js  the errors this device has hit (from keel; set up by its tag in index.html)
src/wheel.js        the Spin wheel
src/keel/           from keel (danielnoam/keel): the setup link's QR codes,
                    github.js, the GitHub calls storage.js makes, errlog.js,
                    the errors this device hit, releases.js, the update check's
                    and Test builds' look at the releases (sw-preview.js is
                    sw.js's half), and drive.js (not loaded yet)
src/vendor/         rough.js and the Virgil font (boards)
src/styles.css      every style and the four themes
native/             Android and iOS widgets, reminders, share extension
src-tauri/          the Windows and Linux app's shell (Tauri)
bridge/             the AI bridge: MCP server, command line, data guide
proxy/              optional Cloudflare Worker: CORS proxy for Steam
tools/              native build helpers, release.js and test-build.sh, and readme-shots.js
docs/screenshots/   the README's screenshots
test/               zero-dependency tests: node test/run-all.js
server.js, start.cmd tiny static server
manifest.json, sw.js PWA manifest and service worker
DESIGN.md           the design language; read before UI work
.claude/skills/     how to build (lifelog-design), check (lifelog-ui-audit)
                    and ship (release-checklist) a change
CONTRIBUTING.md     how to work on LifeLog: the rules, pull requests, releases
ARCHITECTURE.md     this file: the layout, the tests, the screenshots
changes/            each pull request's changelog lines until the next release
DONE.md             every feature, by area, with the version it came in
DROPPED.md          decided against, and why
CHANGELOG.md        every release, in user-facing words
keel.config.json,   the files shared with Waypage through keel
keel.lock.json      (danielnoam/keel): see below
```

The files listed in `keel.lock.json` (server.js, src/keel/qr.js,
src/keel/github.js, src/keel/drive.js, src/keel/errlog.js, src/keel/releases.js,
src/keel/sw-preview.js,
tools/release.js, tools/android-version.js, tools/keel-sync.js,
test/keel.test.js, the github-pages skill) come from keel. Don't edit
them here: `test/keel.test.js` fails. Change them in keel, tag a
release there, then `node tools/keel-sync.js v<version>` in a PR here.

## Tests

```bash
node test/run-all.js            # unit tests, plain Node assert
node test/browser/run-all.js    # browser suites, needs Playwright
```

The unit tests cover the data logic: sanitizers, the merge, release dates,
finance maths, sync passes and the media layer against a stubbed `fetch`.
The browser suites ([`test/browser/README.md`](test/browser/README.md))
drive the real app in Chromium. CI runs them through
`.github/workflows/tests.yml`, in eight shards: a pull request runs the unit
tests and only the browser suites its files need (`test/browser/areas.json`
and `affected.js`), while a merge to main and a release run every suite.
The Android, iOS and Pages workflows wait on it: a failing test publishes
nothing.

## Screenshots

`node tools/readme-shots.js` takes every screenshot in the README from
made-up demo data, at 1280×800 and at phone size, into `docs/screenshots/`.
`node tools/readme-shots.js backlog` takes only the shots whose name holds
"backlog". It needs Playwright, like the browser suites, and blocks every
request off the machine. A new feature with something to see gets a shot
in the README: add it to `SHOTS` in the script, with demo data that shows it.

## Older notes

NOTES.md held the reasons behind the code up to 2026-11-02 and was removed
on 2026-11-14. Some code comments and workflows still say "see NOTES.md";
read it from git history with `git show 2f6df11:NOTES.md`. Newer reasons
are in commit messages and pull request descriptions.
