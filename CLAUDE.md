# LifeLog

A personal log app (what you did, what's next, what it cost): plain HTML,
CSS and JS with **no build step and no dependencies**, served as static
files. The same files ship as the web app (GitHub Pages), the Android app
and the iOS app (Capacitor). See README.md for the layout.

## Before anything

- `git pull --ff-only` first. A clone here once sat 61 commits behind, and
  a refactor had to be redone.
- Read the relevant entries in **NOTES.md** before changing something that
  looks arbitrary; it usually isn't. **TODO.md** is the work, **DROPPED.md**
  what was decided against and why.

## UI work

- **DESIGN.md** is the design language: tokens, scales, motion,
  components, voice, accessibility, each rule marked Now or Target.
- Building or restyling UI, or writing user-facing text: use the
  `lifelog-design` skill. Checking it (contrast, tap targets, drift): the
  `lifelog-ui-audit` skill and its scripts.
- Colors are tokens, sizes come from the scales, every animation has a
  reduced-motion answer, touch targets are 44px on phones, and every theme
  (Default, Light, Nord, Dracula) is checked.

## Shipping

- Use the `release-checklist` skill for every change: version bump (three
  places), CHANGELOG.md, notes files, `node test/run-all.js`, verify at
  phone and desktop width, then commit and push straight to `main`.
- `main` is production. A push deploys the web app, and a new
  `APP_VERSION` publishes the APK and IPA. Check the runs went green.
