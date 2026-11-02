---
name: release-checklist
description: Release checklist for the LifeLog app (danielnoam/lifelog): a branch and pull request per change, a changes/<branch>.md note (folded into CHANGELOG.md by tools/release.js, which also bumps the version in three places), DONE.md, DROPPED.md, the project folder's to-do list and README.md kept current, the bridge in step, the tests, phone and desktop checks, merging on green, test builds by label. Use this before shipping any change to LifeLog.
---

# LifeLog release checklist

Run through all of these before merging a change. It follows
CONTRIBUTING.md's "Versions and releases" (2026-11-02, from Waypage):
`main` only takes pull requests, and only a release PR bumps the version.

## 1. Branch, and decide whether this PR releases

- Work on a branch named for the change (`fix/<what>`, `feature/<what>`,
  `docs/<what>`), never on `main` and not on the session's `claude/...`
  branch.
- A merge releases only if it bumps the version. Daniel's own asks ship as
  a release (several asks grouped into one, or a few). Work landing in
  pieces, or that should go out with another change, doesn't bump: its
  lines go in `changes/<branch>.md` and the next release PR takes them.
- To bump: `node tools/release.js x.y.z`. New user-facing feature → minor
  (`0.X.0` → `0.(X+1).0`); fix, small tweak, styling → patch; a change to
  the saved data old versions can't read (`data.version` in
  `src/storage.js`) → major. Always above the latest release: the updater
  ignores lower numbers. The tool changes `APP_VERSION` in `src/app.js`,
  every `?v=` in `index.html` and `CACHE` in `sw.js` (`lifelog-vN` →
  `vN+1`, so the service worker drops the old cache), and folds every
  `changes/*.md` note into a dated CHANGELOG.md entry, deleting the notes.
  By hand it's the same three places.
- A file added to or removed from `src/` goes in or out of `sw.js`'s
  `ASSETS` too. That list is also exactly what goes into the apps
  (`tools/build-www.js`), and the app build fails if `index.html` loads
  anything the list is missing.
- Don't bump on a branch that isn't the release: a test build installs back
  to the release only while the two have the same version code.

## 2. Change notes, not CHANGELOG.md

- Write the PR's lines to `changes/<branch>.md` (slashes become hyphens)
  under `### Added` / `### Changed` / `### Fixed` / `### Removed`, in plain
  user-facing language. Don't touch CHANGELOG.md: only `tools/release.js`
  writes it, as `## [x.y.z] - YYYY-MM-DD`, newest first. A release for a
  single change writes its note and runs the tool in the same PR.
- The workflow copies the version's entry into the GitHub release as its
  notes. `test/release.test.js` checks the newest entry is `APP_VERSION`,
  every `?v=` matches it, and every note uses those headings.

## 3. Update the notes files

- **The to-do list** (not in the repo; `/mnt/project-files/lifelog/TODO.md`):
  only the work that's left, in sections, each item with a short plan.
  Remove items this change completes, in the same turn; add follow-ups.
- **DONE.md**: a line for every feature this change adds, in its area,
  with the version it ships in. A feature this change removes loses its
  line. Copy it over the project folder's copy if there is one.
- **Why**: in the commit message and the PR description, where `git blame`
  finds it: a decision the code can't explain by itself, an approach tried
  and abandoned, a trade-off. A trap that would bite again gets a comment
  at the spot in the code. NOTES.md is frozen (2026-11-02); search it,
  don't add to it.
- **README.md**: the app as it is. Update it in the same change when it
  adds, removes or renames a feature, a tab, a file, a setup step or how
  it's built. Keep it short, and the contents list at the top matching the
  sections. If the change is visible, re-take the screenshots of the
  sections it touches (`node tools/readme-shots.js <name>`, demo data
  only) and look at each one; a new feature gets its own section and shot
  pair, added to `SHOTS` in that script.
- **DROPPED.md**: decided against (anything Daniel said no to, with his
  reason) or turned out to be impossible. Move an idea here rather than
  deleting it, and write down the *reason*, so it can come back if the
  reason stops being true. If an idea is a live one wrapped in a
  rejection, split it: the workable half stays on the to-do list.

## 3b. Keep the AI bridge in step

- If the change touches the data (a field, a collection, a sanitizer rule,
  or how spending, recurring charges or streaks are worked out), update
  `bridge/DATA.md` and, where an AI should use it, `bridge/tools.js`, with
  a test in `test/bridge.test.js`. The test already fails on a sanitizer
  field DATA.md doesn't describe.
- Not only data: a new feature that shows something (a stat, an insight,
  a list or view the app works out) gets a read tool too, so the bridge can
  do everything the app does (Daniel's rule, 2026-10-27). Check the tool
  list in bridge/README.md against what the release adds.
- Never rename or remove a bridge tool or argument without need: Telemachus
  and any other AI set up against it call them by name.

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

- `node --check` every edited `.js` file, then `node test/run-all.js`
  (the unit tests; all must pass).
- Browser suites: `node test/browser/run-all.js <suite>` for any suite in
  `test/browser/README.md` that covers the change. They need Playwright,
  which isn't a project dependency; if it isn't installed, say so in the
  report rather than skipping silently, and grep `test/browser` for any
  id, class or label the change renamed or removed. A suite that asserts
  behaviour the change deliberately alters gets updated in the same commit.
- Drive the app itself (the preview tool's "lifelog" server, or
  `node server.js` on 5173):
  - Desktop width (~1280px): top bar with view tabs + Add/Settings buttons
  - Mobile width (≤720px, e.g. 375px): fixed bottom nav bar layout
  - Exercise the views/flows touched by this change at both sizes, and
    confirm zero console errors.
  - The `lifelog-ui-audit` skill's "Working in the preview" covers the
    traps: cached assets after a version bump, transitions frozen in
    screenshots, and seeding (then restoring) test data.
- If the change is visual (CSS, a new or restyled control, user-facing
  copy), it follows `DESIGN.md` (the `lifelog-design` skill), and
  `node .claude/skills/lifelog-ui-audit/scripts/lint-css.js` shows no count
  higher than before. Touching a theme value also means running
  `contrast.js` from the same folder.
- Kill the dev server and remove any temporary test scripts afterwards.

## 6. Commit, open a PR, merge on green

- Commit the change, its `changes/` note (or the release bump) and the
  notes files together. Push the branch and open a PR; the "why" goes in
  its description.
- Merge it (squash) once the **Tests** check is green, without asking.
  "Don't build yet" or "fixes only" means open the PR but don't merge
  until Daniel says build.
- If `main` moved, merge it into the branch (a squash merge makes an old
  tip unmergeable by fast-forward, so merge, don't rebase or force-push).
  Never force-push `main`. Two releases at once: merge `main` in and run
  `tools/release.js` again with the next free number.
- `main` is production. A merge deploys the web app (`pages.yml`, once the
  tests pass) and, with a new `APP_VERSION`, publishes the APK and IPA.
  So step 5 has to pass before the merge, not after.

## 7. Builds: test builds and the release

- **Test builds:** label the PR `test` (APK and IPA), `test-android` or
  `test-ios` (one, sooner). `test-builds.yml` starts the build, and every
  push after rebuilds it onto the pre-release `test-<branch>`
  (`tools/test-build.sh`), signed with the release key so it installs over
  Daniel's app. It syncs with his real data. Unlabelling, closing the PR or
  deleting the branch removes it. A branch without a label doesn't build.
- **The release:** `android.yml` builds every push to `main`, signs it and
  publishes the release `app-v<APP_VERSION>` when the version is new. The
  app's updater reads `releases/latest`, which never names a pre-release.
  `ios.yml` builds an unsigned `LifeLog.ipa` on a Mac runner and uploads it
  into that same release once the Android job has created it.
- A push that only touches `**.md`, `test/**`, `.claude/**`, `docs/**` or
  `tools/readme-shots.js` doesn't run the app workflows, which is correct:
  nothing in the app changed.
- After merging, check the "Android app", "iOS app" and "Web app" runs on
  `main` went green and the `app-v<version>` release has both files. If the
  build failed, fix it in a new PR; the app keeps offering the last release
  until then.
