# LifeLog

A personal log app (what you did, what's next, what it cost): plain HTML,
CSS and JS with **no build step and no dependencies**, served as static
files. The same files ship as the web app (GitHub Pages), the Android app
and the iOS app (Capacitor). See README.md for the layout.

## Before anything

- `git pull --ff-only` first. A clone here once sat 61 commits behind, and
  a refactor had to be redone.
- Read **CONTRIBUTING.md**. It holds the rules everyone working on LifeLog
  follows: the decisions already made, the rules for every change
  (security, platforms, speed, design, the AI bridge), keeping the notes
  files right, and how pull requests, versions, releases and test builds
  work. Everything below is only what's specific to Claude sessions.
- Read **RULES.md** (from keel): the short rules that stop bugs and UI
  drift. DESIGN.md and CONTRIBUTING.md give LifeLog's names for them.
- Before changing something that looks arbitrary, check `git log` and the
  PR descriptions for why; it usually isn't. ARCHITECTURE.md has the
  project layout. Old comments that say "see NOTES.md" mean the removed
  file: `git show 2f6df11:NOTES.md`.

## UI work

- Building or restyling UI, or writing user-facing text: use the
  `lifelog-design` skill. Checking it (contrast, tap targets, drift): the
  `lifelog-ui-audit` skill and its scripts.

## The AI bridge

- Telemachus (github.com/danielnoam/telemachus) runs `bridge/`. A tool
  renamed or removed here breaks its chats, so add rather than rename.

## Shipping

- Use the `release-checklist` skill for every change. It follows
  CONTRIBUTING.md's "Versions and releases".
- `main` is production and takes only pull requests (2026-11-02, as in
  Waypage). A merge deploys the web app; only a merge with a new
  `APP_VERSION` publishes the APK and the Windows app (`node tools/release.js x.y.z`).
  Daniel cuts releases himself (2026-11-03): by default a PR doesn't bump
  the version, it writes its lines to `changes/<branch>.md` (never
  CHANGELOG.md) and merges itself on green (auto-merge), with no release built. Run
  `tools/release.js` only when he asks for a release. Check the runs went
  green.
- When Daniel wants to try a change on his phone before it's merged, add
  the `test` label (or `test-android` / `test-desktop`) to its PR and tell him
  the build is on the `test-<branch>` pre-release.
- Builds are the web app, Windows and the APK only (2026-11-04). iOS
  (`ios.yml` by hand, or `test-ios`) and Linux (`desktop.yml` by hand with
  Linux ticked, or `test-linux`) only when Daniel asks.

## Branch names

- Don't use the claude/... branch the session was handed. Before the first
  commit, make a branch named for the change: fix/<what>, feature/<what> or
  docs/<what>, a few lowercase words with hyphens (fix/drive-row,
  feature/pick-sheet). Push only to that branch. A thread with an open PR
  keeps its branch.

## Working with Daniel

Daniel (danielnoam) owns LifeLog. These rules hold in every session.

### The notes files

- The to-do list is not in the repo; Daniel keeps it himself. When
  something ships, it becomes a line in DONE.md (and a note in
  `changes/`); when Daniel says he doesn't want something, it becomes an
  entry in DROPPED.md with his reason.
- If the project's shared folder has a copy of DONE.md, copy the repo's
  version over it after every change so they match.
- Before suggesting ideas, check DONE.md, the to-do list and DROPPED.md,
  so nothing shipped, planned or turned down is suggested again.
- "Show the todo" means short: the next items numbered, then the later and
  parked groups in one line each.

### How the work is done

- Auto-merge (2026-11-18): as soon as a PR's work is done, turn on
  auto-merge (squash), release PRs included; it merges itself when Tests
  go green. `auto-merge.yml` does this for any PR of his that opens
  ready, so open unfinished work as a draft. Don't end a turn waiting on
  the run; check the CI runs once it merges.
- "Don't build yet" or "fixes only": push the branch and open the PR as a
  draft (or turn auto-merge off), and don't merge until he says build.
- "Add to TODO" means plan it, not build it. Small asks listed without
  that get built now.
- Merge to main, don't release (2026-11-03): he wants changes merged and
  will cut the release later himself. No version bump unless he asks.
- A new look, a reworked screen or a big change: show or explain it first
  and wait for his OK before building. Don't stack extra changes on top of
  what he asked without saying so first.
- Any security or privacy trade-off: say it plainly to him and write it in
  the PR description.
- After shipping, tell him in a line or two what to try on his phone,
  especially anything that couldn't be tested without it.
- Be direct. Push back when an idea or plan is weak, and say what was
  checked and what is a guess.

### Project-specific rules

Added here as Daniel gives them; the ones that hold for everyone go in
CONTRIBUTING.md.

- Icons are Lucide, from the one map in src/icons.js; no emoji in the UI
  (2026-10-06).
- Any new library or data service gets a credit in Settings → About.
- The bridge's tools stay complete (2026-10-27): every feature that adds,
  changes or shows something gets bridge tools in the same release
  (CONTRIBUTING.md, "The AI bridge stays complete"). Add tools, never
  rename or remove them.
- README screenshots stay current (2026-10-30): see CONTRIBUTING.md,
  "Keeping the notes files right". Demo data only, never Daniel's.
