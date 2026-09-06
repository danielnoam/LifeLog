---
name: release-checklist
description: Pre-PR checklist for the LifeLog app (danielnoam/lifelog) — bump APP_VERSION, add a matching CHANGELOG.md entry, file notes under TODO.md/NOTES.md/DROPPED.md, keep the vanilla JS/CSS app lean, and verify both mobile and desktop layouts. Use this before opening any PR for LifeLog.
---

# LifeLog release checklist

Run through all of these before opening a PR. Every PR should leave the
version number, CHANGELOG.md, and the notes files in sync with the change —
don't open a PR with any step skipped.

## 1. Bump APP_VERSION

- Defined in `src/app.js` (`const APP_VERSION = "x.y.z"`), rendered in
  Settings as "LifeLog vX.Y.Z" — the only version string in the app, and
  the user's main signal that a deploy picked up the new build.
- Bump using semver, based on the change:
  - New user-facing feature → bump minor (`0.X.0` → `0.(X+1).0`), reset patch to 0
  - Bug fix / small tweak / styling-only → bump patch (`0.x.Y` → `0.x.(Y+1)`)
  - Breaking change to the saved data format (`data.version` in `src/storage.js`) → bump major
- Never open a PR without bumping this, even for small fixes.
- Also update the `?v=x.y.z` cache-busting query string on every
  `<script>`/`<link rel="stylesheet">` tag in `index.html` to match —
  browsers cache these by URL, so leaving the query string stale means
  returning visitors keep serving old JS/CSS after a deploy even though
  the file content changed on the server.

## 2. Update CHANGELOG.md

- Keep-a-Changelog style: newest version first, `## [x.y.z] - YYYY-MM-DD`
  (use today's date), with `### Added` / `### Changed` / `### Fixed` /
  `### Removed` sections as needed.
- The version heading here must always match `APP_VERSION` in `src/app.js`.
- Write entries in plain, user-facing language — they double as the basis
  for the PR summary.

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

## 6. Commit & push

- Commit the version bump + CHANGELOG.md + the notes-file updates together
  with the feature changes (or as one small follow-up commit).
- Push to the active work branch.
- Open the PR with a summary that mirrors the new CHANGELOG entry, plus a
  test plan section covering the mobile/desktop verification above.
