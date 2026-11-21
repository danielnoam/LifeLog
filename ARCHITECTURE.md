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
src/tasks.js        Tasks: a checklist item's fields, repeats, the task and Date sheets
src/boards.js       drawing boards (boards.json)
src/habits.js       Habits
src/finance.js      Ledger: expenses, recurring bills, Summary
src/invest.js       The Ledger's Investments mode: watchlist and pins (investments.json)
src/home.js         Home: in progress, coming up, the scratchpad and pinned notes
src/pin.js          The pinned window (computer app): Today, Coming up, Notes, Scratchpad, quick add
src/recap.js        the yearly Recap
src/search.js       one search across everything
src/media.js        cover art and metadata from the media sources
src/sync.js         Steam import, the two-way AniList sync, GG.deals prices, release re-checks
src/letterboxd.js   the Letterboxd import
src/stremio.js      the Stremio sync, read only
src/trello.js       Trello lists as task lists, both ways
src/io.js           JSON/CSV import and export, and the shared review screen
src/docimport.js    PDF and EPUB read as text, for notes
src/markdown.js     Markdown for notes in a collection
src/images.js       images in notes: shrunk, kept on the device, synced
src/jobs.js         Activity: the work that takes a while
src/share.js        what other apps share into LifeLog
src/storage.js      persistence: GitHub, local file, IndexedDB
src/drive.js        Google Drive backups: keel's drive.js set up for LifeLog
src/gcal.js         Google Calendar's events, read only, kept on the device
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
src/keel/platform.js  where it runs (phone, desktop, browser), app-build.json, links out to the device's browser (from keel); src/platform.js builds on it
src/keel/motion.js  the motion engine: springs sampled into CSS linear(), press feedback, reduced motion and Animations off (from keel)
src/motion.js       LifeLog's springs given to keel's engine (window.LifeLogMotion); styles.css's --spring-* come from it
src/keel/i18n.js    languages: picks one, sets lang and dir on <html>, t()/tn() (from keel; runs in <head>)
src/language.js     LifeLog's languages (English, Hebrew); English-only i18n for Node
src/lang/he.js      the Hebrew for every English key, loaded only when Hebrew is on
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
src/keel/github.js, src/keel/drive.js, src/keel/errlog.js, src/keel/platform.js, src/keel/motion.js, src/keel/i18n.js, src/keel/releases.js,
src/keel/sw-preview.js,
tools/release.js, tools/android-version.js, tools/keel-sync.js, tools/keel-checks.js (the contrast and CSP checks the tests use),
test/keel.test.js, RULES.md, the github-pages skill) come from keel. Don't edit
them here: `test/keel.test.js` fails. Change them in keel, tag a
release there, then `node tools/keel-sync.js v<version>` in a PR here.

## Right to left

LifeLog is in English and Hebrew (Settings → Appearance → Language, kept
per device in localStorage `lifelog.lang`; changing it reloads).
`src/language.js` sets `lang` and `dir` on `<html>` before first paint, and
everything else follows from it:

- Every word the app shows goes through `i18n.t("English")` or
  `i18n.tn(n, "one", "other")`; markup carries `data-t` / `data-t-attr`.
  The English is the key, `src/lang/he.js` the Hebrew, and
  `test/i18n.test.js` fails on a key with no Hebrew, Hebrew for a key that's
  gone, or a placeholder that doesn't match. Only literal calls are found:
  a table of strings has to be a table of `t()` / `tn()` calls.
- What's stored stays English: default category names, Scratchpad,
  lengths ("35 hrs"), CSV headers, merge summaries, commit messages, and
  everything the bridge says. A user's own titles and names are never
  translated.
- Hebrew is gender-neutral: nouns and infinitives ("הוספת פריט", "צריך
  לבחור"), never a "you" verb.
- Text of the user's that may be in another script (titles, names, tags)
  gets `unicode-bidi: plaintext` in the RTL block, so an English title
  keeps its order and is cut at its end. A signed number ("+2.5%", "+3
  more") is wrapped in a left-to-right isolate (U+2066…U+2069), in the
  code (invest.js) or in the Hebrew itself, or its sign moves to the other
  end. Board text stays anchored at its left edge.

- styles.css uses logical sides (`inset-inline-start`, `margin-inline-end`,
  `text-align: start`), so the layout mirrors by itself. The exceptions are
  elements JS places by `style.left` or the pointer's `clientX` (tab menu,
  mode strip, home ghost, text measurer) and the Investments chart, which
  reads left to right in every language. `test/rtl.test.js` fails on a new
  physical side anywhere else. A physical `left` with `right` and `width`
  also set is ignored right to left, which is why JS-placed boxes stay physical.
- Swipes and drags decide by `rtlX(dx)` in app.js (negated right to left),
  so a finger moving toward the next tab still reaches it; recap.js and
  io.js do the same. Arrow keys follow the screen.
- Month and day names come from `Intl` in any language but English
  (dates.js); money and numbers format with the language's locale
  (`numLocale()` in finance.js and invest.js).
- Icons that point a way (chevrons, undo/redo, log in/out) flip in the
  `:root[dir="rtl"]` block at the end of styles.css, and so do the switch
  knob and the mode slide.

## The app's home

index.html's `keel-site` and `keel-repo` metas name where the web copy
lives and its repo: installed copies look for unreleased builds there and
link to it. Before moving the repo to an organization or a custom domain,
change both and ship a release; GitHub redirects the repo, not its Pages
address (keel README, "Moving an app").

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
