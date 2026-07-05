---
name: release-checklist
description: Pre-PR checklist for the LifeLog app (danielnoam/lifelog) — bump APP_VERSION, add a matching CHANGELOG.md entry, update TODO.md, keep the vanilla JS/CSS app lean, and verify both mobile and desktop layouts. Use this before opening any PR for LifeLog.
---

# LifeLog release checklist

Run through all of these before opening a PR. Every PR should leave the
version number, CHANGELOG.md, and TODO.md in sync with the actual change —
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

## 3. Update TODO.md

- Remove items this change completes.
- Add any new follow-up ideas that came up while implementing.
- If the list becomes empty, leave just the `todo:` header line.

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

- Commit the version bump + CHANGELOG.md + TODO.md update together with
  the feature changes (or as one small follow-up commit).
- Push to the active work branch.
- Open the PR with a summary that mirrors the new CHANGELOG entry, plus a
  test plan section covering the mobile/desktop verification above.
