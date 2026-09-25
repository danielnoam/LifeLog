---
name: release-checklist
description: Release checklist for the LifeLog app (danielnoam/lifelog) — bump APP_VERSION, add a matching CHANGELOG.md entry, file notes under TODO.md/NOTES.md/DROPPED.md, keep the vanilla JS/CSS app lean, verify mobile and desktop, push to main (which publishes the APK), and delete finished branches. Use this before shipping any change to LifeLog.
---

# LifeLog release checklist

Run through all of these before shipping a change. Every change pushed to
`main` should leave the version number, CHANGELOG.md, and the notes files in
sync with it. Don't push with any step skipped.

## 1. Bump APP_VERSION

- Defined in `src/app.js` (`const APP_VERSION = "x.y.z"`), rendered in
  Settings as "LifeLog vX.Y.Z" — the only version string in the app, and
  the user's main signal that a deploy picked up the new build.
- Bump using semver, based on the change:
  - New user-facing feature → bump minor (`0.X.0` → `0.(X+1).0`), reset patch to 0
  - Bug fix / small tweak / styling-only → bump patch (`0.x.Y` → `0.x.(Y+1)`)
  - Breaking change to the saved data format (`data.version` in `src/storage.js`) → bump major
- Never push to `main` without bumping this, even for small fixes.
- Also update the `?v=x.y.z` cache-busting query string on every
  `<script>`/`<link rel="stylesheet">` tag in `index.html` to match —
  browsers cache these by URL, so leaving the query string stale means
  returning visitors keep serving old JS/CSS after a deploy even though
  the file content changed on the server.
- And bump `CACHE` in `sw.js` (`lifelog-vNN` → `vNN+1`). This step was
  undocumented until 0.166.0 and had silently drifted three releases as a
  result, which is exactly why it is written down now. It is not what keeps
  assets fresh — the `?v=` query above does that — so a stale name doesn't
  serve stale code. What it does is let the service worker's `activate`
  handler drop the previous cache; leave it alone and every superseded
  `app.js?v=…` stays in the user's cache storage forever.
- If a release adds or removes a file under `src/`, add or remove it in
  `sw.js`'s `ASSETS` list too, or it won't be precached for offline use.
  That list is also exactly what goes into the Android app
  (`tools/build-www.js`), and the app build fails if `index.html` loads
  anything the list is missing.
- Changing `APP_VERSION` on `main` publishes a new Android release
  (`app-v<version>`). See step 7.

## 2. Update CHANGELOG.md

- Keep-a-Changelog style: newest version first, `## [x.y.z] - YYYY-MM-DD`
  (use today's date), with `### Added` / `### Changed` / `### Fixed` /
  `### Removed` sections as needed.
- The version heading here must always match `APP_VERSION` in `src/app.js`.
- Write entries in plain, user-facing language. The workflow copies this
  entry into the GitHub release as its notes.

## 3. Update the three notes files

Each holds one kind of thing; put an entry in exactly one of them.

- **TODO.md** — work still worth doing. Remove items this change completes;
  add any new follow-up ideas that came up while implementing. If the list
  empties, leave just the `todo:` header line.
- **NOTES.md** — why what shipped is the way it is. Add an entry whenever a
  change involved a decision the code can't explain by itself: something
  that looks arbitrary but isn't, an approach that was tried and abandoned,
  an invariant two files quietly depend on. Newest first. This is the file
  that stops the next change re-breaking what this one fixed.
- **DROPPED.md** — decided against, or turned out to be impossible. Move an
  idea here rather than deleting it, and write down the *reason*, so it can
  come back if the reason stops being true. If an idea is a live one wrapped
  in a rejection, split it: the workable half stays in TODO.md.

## 4. Keep the app lean

- No build step, no dependencies — stay vanilla JS/CSS/HTML.
- Reuse existing helpers (`el`, `groupBy`, `countBy`, etc. in `src/app.js`)
  instead of adding new ones.
- Remove dead code, leftover debug logging/comments, and temporary test
  files (e.g. the gitignored `lifelog.json` seed, anything under `/tmp`)
  before committing.
- Sanity-check size with `wc -l src/*.js src/*.css index.html` — nothing
  should balloon out of proportion to the change.

## 5. Verify mobile + desktop

- `node --check` every edited `.js` file.
- Start `node server.js` (port 5173) and drive it with Playwright
  (`NODE_PATH=/opt/node22/lib/node_modules node script.js`):
  - Desktop width (~1280px): top bar with view tabs + Add/Settings buttons
  - Mobile width (≤720px, e.g. 390px): fixed bottom nav bar layout
  - Exercise the views/flows touched by this change at both sizes, and
    confirm zero console errors (`page.on('pageerror'/'console')`).
- Kill the dev server and remove any temporary test scripts afterwards.

## 6. Commit & push to main

- Work on `main` directly. No feature branches, no PRs: the owner wants a
  change live as soon as it's done. This overrides a session's default
  "develop on `claude/...`" branch. If a session was started on one, commit
  there, then fast-forward `main` to it and push `main`
  (`git push origin HEAD:main`).
- Commit the version bump + CHANGELOG.md + the notes-file updates together
  with the feature changes (or as one small follow-up commit).
- Before pushing, `git fetch origin main` and rebase onto it if it moved.
  Never force-push `main`.
- `main` is production. The push deploys the web app to GitHub Pages at once
  and, with a new `APP_VERSION`, publishes the APK. So step 5 has to pass
  before the push, not after.

## 7. Ship the APK

- Nothing to build locally. `.github/workflows/android.yml` runs on every
  push to `main`, builds and signs the APK, and publishes it as the GitHub
  release `app-v<APP_VERSION>`. The app's updater downloads it from
  `releases/latest/download/LifeLog.apk`.
- It only publishes when `APP_VERSION` is new (step 1). A push without a
  bump rebuilds but ships nothing to the app.
- A push that only touches `**.md`, `test/**` or `.claude/**` doesn't run
  the workflow at all, which is correct: nothing in the app changed.
- After pushing, check the "Android app" run on `main` went green and the
  `app-v<version>` release exists. If the build failed, fix it in the next
  commit and push again; the app keeps offering the last release until then.

## 8. Clean up branches

- Delete every remote branch except `main` once its work is on `main`,
  including the session branch you just shipped from
  (`git push origin --delete <branch>`).
- Changes land by squash or cherry-pick, so `git branch --merged` and
  `git cherry` both call finished branches unmerged. Check by content: the
  branch's last `APP_VERSION` has a CHANGELOG.md entry on `main`, or its
  diff against `main` holds nothing new.
- A branch with work that isn't on `main`: ask the owner before deleting.
