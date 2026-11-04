# Contributing to LifeLog

LifeLog is a personal log: what you did, what's next, what it cost. It is
plain HTML, CSS and JS with **no build step and no dependencies**, served as
static files (the web app on GitHub Pages) and wrapped by Capacitor as the
Android and iOS apps. This file is the rulebook for everyone who works on
it, people and Claude sessions alike. CLAUDE.md adds only what is specific
to Claude.

## Getting started

```sh
git clone https://github.com/danielnoam/LifeLog
cd LifeLog
node server.js                 # http://localhost:5173 (start.cmd on Windows)
node test/run-all.js           # the unit tests
node test/browser/run-all.js   # the browser suites (needs Playwright)
```

Nothing to install for the web app. `npm ci` is only needed for the native
builds (`tools/build-www.js`, Capacitor). Playwright isn't a dependency; see
`test/browser/README.md`.

## Read before you change anything

| File | What it holds |
|---|---|
| `README.md` | Every feature with pictures, the setup, and the project layout. |
| `DESIGN.md` | The design language: tokens, scales, motion, components, voice, accessibility, each rule marked Now or Target. |
| `bridge/README.md`, `bridge/DATA.md` | How other AIs read and change LifeLog, and every field of the data. |
| `NOTES.md` | Why things were built the way they are, up to 2026-11-02 (frozen since). Search it, don't read it whole: it's ~400 KB. Each entry starts with a bold title and its version. |
| `DONE.md` | What the app does, by area, one line per feature with its version. |
| `DROPPED.md` | What was decided against, and why. |
| `CHANGELOG.md` | Every release, in user-facing words. |

Before proposing an idea, check DONE.md, DROPPED.md, the to-do list and the
open issues, so nothing shipped, planned or turned down comes back.

**The to-do list isn't in the repo.** Daniel keeps it in his own planning
space. To propose work or pick something up, open a GitHub issue first so
two people don't build the same thing.

## Decisions that are already made

Don't reopen these without talking to Daniel first.

- **No build step, no dependencies.** Vanilla JS/CSS/HTML; vendored code
  lives only in `src/vendor/` with its licence beside it. Reuse the helpers
  in `src/app.js` (`el`, `groupBy`, `countBy` and the rest).
- **The data is the user's.** It lives in their own GitHub data repo and on
  their devices. Nothing leaves the device unless they turned it on.
- **Icons are Lucide**, all from the one map in `src/icons.js`. No emoji in
  the UI.
- **The bridge's tools are added, never renamed or removed.** Telemachus
  (github.com/danielnoam/telemachus) and other AIs call them by name.

## Rules for every change

**Security and privacy, as far as it can go.** For every change ask what it
sends, to whom, and what a page, file or other site could do with it. Use
the least access (narrow tokens and scopes). Untrusted content stays
sandboxed. Any trade-off is stated plainly in the pull request.

**Every platform.** Everything works on Android and on a computer, and on
iOS later. A feature that can't work somewhere gets that platform's nearest
equivalent. iOS-only work goes on the to-do list's iOS section (or an
issue).

**Speed.** Measure before and after anything that could make it slower.

**Design.** Follow DESIGN.md: colors are tokens, sizes come from the scales,
every animation has a reduced-motion answer, touch targets are 44px on
phones, and every theme (Default, Light, Nord, Dracula) is checked.

**Ask first for big things.** A new look, a reworked screen or a big change
is shown or explained to Daniel (a mockup, a screenshot, a short write-up)
and waits for his OK before it's built. Don't stack extra changes on top of
what was asked without saying so first.

**The AI bridge stays complete.** `bridge/` runs the app's own `src/` code,
so most changes reach it on their own, but not all:

- Any change to the data (a new or renamed field, collection or category
  kind, a sanitizer rule, how spending, recurring charges or streaks are
  counted) updates `bridge/DATA.md` in the same change, and
  `bridge/tools.js` when an AI should be able to read or set it.
  `test/bridge.test.js` fails on a sanitizer field DATA.md doesn't describe.
- Every feature that adds, changes or shows something (data, a stat, an
  insight, a list the app draws) gets bridge tools in the same release.
  Changes go through `change()`/`commit()` so they show in History tagged
  with the AI and can be undone.

**Credits.** Any new library or data service gets a credit in Settings →
About.

**Don't bump the version on a feature branch.** A pull request can get a
test build (see below), and the release installs back over it only while
the two have the same version code. The release PR is the one that bumps
`APP_VERSION`, with `node tools/release.js`.

**"Add to TODO" means plan it, not build it.** It goes on the to-do list
with a short plan of how it would be built, so someone else can pick it up.

## Keeping the notes files right

- **Shipped work** becomes a note in `changes/` (see below) and a line in
  DONE.md under its area. A "no" becomes an entry in DROPPED.md with the
  reason. Take it off the to-do list (or close its issue) at the same time.
- **Why** goes in the commit message and the pull request description,
  where `git blame` finds it. Something that broke and could break again
  gets a comment at the spot in the code. NOTES.md takes no new entries.
- **README.md describes the app as it is.** A change that adds, removes or
  renames a feature, a tab, a file or a setup step updates it, in a few
  lines, with the contents list kept matching the sections. A visible
  change re-takes the shots of the sections it touches with
  `node tools/readme-shots.js <name>` (made-up demo data only); a new
  feature gets its own section with a desktop and a phone shot, added to
  `SHOTS`. Look at every shot before committing, and only re-take what
  changed.

## Versions and releases

**A merge is not a release unless it bumps the version.** Two kinds of pull
request land on `main`:

- **A PR that bumps the version** is a release: when it merges, the Android
  workflow publishes `app-v<version>` with the APK, the desktop workflow
  attaches the Windows installer, and every updater offers it. The IPA and
  the Linux files come only when Daniel asks for them (below). Only Daniel decides when to release
  (2026-11-03): he cuts one himself or asks for it.
- **A PR that doesn't** just lands. Its lines go in its own file,
  `changes/<branch>.md` (`feature/more-sites` → `feature-more-sites.md`),
  never in CHANGELOG.md, so two branches never clash there. It ships with
  the next release. This is the default for every change, Daniel's own
  asks included.

**To release what has gathered:** on an up-to-date branch run
`node tools/release.js 0.300.0` (new feature: minor; fix or tweak: patch;
a saved-data change old versions can't read, `data.version` in
`src/storage.js`: major, and always above the latest release, since the
updater ignores lower numbers). It bumps the three version places, folds
every `changes/*.md` note into one `## [0.300.0] - date` entry in
CHANGELOG.md and deletes the notes. Look at the diff, commit it as
"Release 0.300.0", open the PR, merge on green. A release for a single
change can write its note and run the tool in the same PR.

**The three places,** so a bump by hand is the same as the tool's:

1. `APP_VERSION` in `src/app.js`, shown in Settings → About.
2. The `?v=x.y.z` on every `<script>` and `<link rel="stylesheet">` in
   `index.html`, so browsers fetch the changed files.
3. `CACHE` in `sw.js` (`lifelog-vN` → `vN+1`), so the old offline cache is
   dropped. A file added to or removed from `src/` also goes in or out of
   `sw.js`'s `ASSETS`, which is the list that goes into the apps; the
   build fails if `index.html` loads a file it lacks.

Notes and CHANGELOG.md entries use `### Added` / `Changed` / `Fixed` /
`Removed`, in user-facing words; the release workflow copies the entry into
the GitHub release notes. Only a release PR edits CHANGELOG.md.
`test/release.test.js` checks that the newest entry is `APP_VERSION`, that
every `?v=` matches it, and that every note in `changes/` uses those
headings.

**How a change gets in:** `main` takes only pull requests. Push a branch
(`fix/<what>`, `feature/<what>` or `docs/<what>`), open a PR, and merge it
when the **Tests** check is green (`.github/workflows/tests.yml` runs the
unit tests and the browser suites on every PR; a PR that only changes
Markdown skips the browser suites). No review is required: anyone with
write access merges on green, and Daniel decides who has write access. If
`main` moved, merge it into the branch rather than rebasing. Never
force-push `main`.

**What a merge does:**

- A merge to **`main`** deploys the web app (`pages.yml`, once the tests
  pass), version bump or not.
- **What builds by default (2026-11-04):** the web app, the APK and the
  Windows app, nothing else unless Daniel asks. `android.yml` and
  `desktop.yml` (Windows) build `main` on every push. `ios.yml` builds
  only when run by hand (Actions → iOS app → Run workflow), and Linux only
  when `desktop.yml` is run by hand with **Linux too** ticked; on `main`
  either attaches to the current version's release. Pushes that only
  touch `**.md`, `test/**`, `.claude/**`, `docs/**` or
  `tools/readme-shots.js` don't run them.
- On `main`, when `APP_VERSION` has no release yet and the signing secrets
  are set, the Android workflow publishes the release `app-v<version>` with
  `LifeLog.apk`, and the desktop workflow attaches `LifeLog-setup.exe`
  (and `latest.json` for the desktop updater, when its key is set).
- The app's built-in updater reads the repo's latest release (the repo is
  public for this reason) and offers any version **higher** than its own.

**Test builds.** A pull request labelled `test` gets an APK and the
Windows app, `test-android` or `test-desktop` just one (sooner);
`test-ios` (an IPA) and `test-linux` (Windows plus Linux) only when asked. Adding the label builds the
branch (`.github/workflows/test-builds.yml`) and every push after that
rebuilds it, onto the pre-release `test-<branch>` (`tools/test-build.sh`).
Taking the label off, closing the PR or deleting the branch removes it. A
branch without a test label doesn't build at all. A pre-release is never
the latest release, so the updater never offers it; Settings → About →
Test builds lists them. There, Android installs one through the updater's
own download, an iPhone opens its release page, and a browser on the web
app opens it in place (`sw.js` serves that commit's files from
raw.githubusercontent.com until Back to the release). It's signed with the release key, so it installs over the
app you have and keeps your data. **It also syncs with your real data**:
a test build that writes something wrong is taken back with Settings →
History → Undo. A PR from a fork runs the tests too, but without the repo's
secrets, so it can't sign or publish anything.

**Before a release:** `node --check` every edited `.js`, run
`node test/run-all.js` and the browser suites that cover the change, then
run `node server.js` and check at phone width (375px) and desktop width
(~1280px) with zero console errors. Some things can only be checked on a
phone (native HTTP, widgets, notifications, the share sheet): say so when a
change touches them and wasn't run on one. After merging, check that the
workflow runs went green.

**Two releases at once.** If someone else released while your release PR
was open, their number is taken: merge `main` in, run `tools/release.js`
again with the next free number, and push.

## Signing and secrets

The Android release key is in the repo secrets `ANDROID_KEYSTORE_B64` and
`ANDROID_KEYSTORE_PASSWORD`, alias `lifelog`. Every APK must be signed with
it to install over the last one. It signs `main` and labelled test builds
only; any other build gets a throwaway key. Never commit a key, token or
password; never print one in a workflow log.
