# LifeLog

A personal log app (what you did, what's next, what it cost): plain HTML,
CSS and JS with **no build step and no dependencies**, served as static
files. The same files ship as the web app (GitHub Pages), the Android app
and the iOS app (Capacitor). See README.md for the layout.

## Before anything

- `git pull --ff-only` first. A clone here once sat 61 commits behind, and
  a refactor had to be redone.
- Search **NOTES.md** for what you're about to change (a function, class,
  feature or version) before changing something that looks arbitrary; it
  usually isn't. Don't read it whole: it's ~60k tokens. Each entry starts
  with a bold title and its version, so a search finds it. **TODO.md** is
  the work that's left, **DONE.md** what the app already does (one line
  per feature, with its version), **DROPPED.md** what was decided against
  and why, **CHANGELOG.md** every release in user-facing words.

## UI work

- **DESIGN.md** is the design language: tokens, scales, motion,
  components, voice, accessibility, each rule marked Now or Target.
- Building or restyling UI, or writing user-facing text: use the
  `lifelog-design` skill. Checking it (contrast, tap targets, drift): the
  `lifelog-ui-audit` skill and its scripts.
- Colors are tokens, sizes come from the scales, every animation has a
  reduced-motion answer, touch targets are 44px on phones, and every theme
  (Default, Light, Nord, Dracula) is checked.

## The AI bridge

- `bridge/` is how other AIs read and change LifeLog (an MCP server and a
  command line, see bridge/README.md). It runs the app's own `src/` code,
  so most changes reach it on their own, but not all of them.
- Any change to the data keeps the bridge right in the same commit: a new or
  renamed field, collection or category kind; a sanitizer rule; how
  something is counted (spending, recurring charges, streaks). Update
  `bridge/DATA.md`, and `bridge/tools.js` when an AI should be able to read
  or set the new thing. `test/bridge.test.js` fails on any field the
  sanitizers keep that DATA.md doesn't describe.
- Telemachus (github.com/danielnoam/telemachus) runs this bridge. A tool
  renamed or removed here breaks its chats, so add rather than rename.

## Shipping

- Use the `release-checklist` skill for every change: version bump (three
  places), CHANGELOG.md, notes files, README.md, `node test/run-all.js`, verify at
  phone and desktop width, then commit and push straight to `main`.
- `main` is production. A push deploys the web app, and a new
  `APP_VERSION` publishes the APK and IPA. Check the runs went green.

## Working with Daniel

Daniel (danielnoam) owns LifeLog. These rules hold in every session.

### The notes files

- TODO.md holds only what's left, grouped into sections, each item with a
  short plan of how it would be built. When something ships, or Daniel
  says he doesn't want it, take it out in the same commit: shipped work
  becomes a line in DONE.md (and the changelog), a no becomes an entry in
  DROPPED.md with his reason. Remove anything stale or already covered.
  Never leave done work in TODO.md.
- DONE.md gets a line for every feature a release adds, in its area.
- NOTES.md is why things are the way they are, newest first. CHANGELOG.md
  is every release, in plain user-facing words.
- README.md describes the app as it is: when a change adds, removes or
  renames a feature, a tab, a file or a setup step, update README.md in
  the same commit.
- If the project's shared folder has copies of TODO.md and DONE.md, copy
  the repo's versions over them after every change so they match.
- Before suggesting ideas, check DONE.md, TODO.md and DROPPED.md, so
  nothing shipped, planned or turned down is suggested again.
- "Show the todo" means short: the next items numbered, then the later and
  parked groups in one line each.

### How the work is done

- Push to main without asking once the checks are green (the tests and
  the release checklist; then check the CI runs).
- "Don't build yet" or "fixes only": commit locally and don't push until
  he says build.
- "Add to TODO" means plan it, not build it. Small asks listed without
  that get built now.
- Several asks go out as one release, or a few grouped releases, not many
  small ones.
- A new look, a reworked screen or a big change: show or explain it first
  and wait for his OK before building. Don't stack extra changes on top of
  what he asked without saying so first.
- Secure and private as far as it can go: least access (narrow tokens and
  scopes), nothing leaves the device unless he turned it on, untrusted
  content stays sandboxed. Say any trade-off plainly and write it in
  NOTES.md.
- Everything works on Android and on a computer, and on iOS later. What
  can't work on one platform gets that platform's nearest equivalent;
  iOS-only work goes on the iOS list in TODO.md.
- Speed matters: measure before and after anything that could make it
  slower.
- After shipping, tell him in a line or two what to try on his phone,
  especially anything that couldn't be tested without it.
- Be direct. Push back when an idea or plan is weak, and say what was
  checked and what is a guess.

### Project-specific rules

Added here as Daniel gives them.

- Icons are Lucide, from the one map in src/icons.js; no emoji in the UI
  (2026-10-06).
- Any new library or data service gets a credit in Settings → About.
- The bridge's tools stay complete (2026-10-27): every feature that adds,
  changes or shows something (data, a stat, an insight, a list the app
  draws) gets bridge tools in the same release, so an AI can read and edit
  everything the app can. Changes go through `change()`/`commit()` so they
  show in History tagged with the AI and can be undone. Add tools, never
  rename or remove them.
