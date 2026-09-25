todo:

- **What the Android app could do that a browser can't**, in the order it's
  worth doing: native HTTP (`CapacitorHttp` — Steam without the proxy), a real
  file backup on the phone (the Filesystem plugin as a fourth backend in
  storage.js — 0.179.0's export already writes files with that plugin and
  shares them, so this is the same pair on a schedule). Widgets shipped in
  0.181.0–0.185.0.

  **iOS.** The same wrapper, plus $99/year for Apple's developer program and
  a macOS build job. Until there's a native feature worth that, iOS stays on
  Safari's Add to Home Screen, which already works.

  What was decided against outright is in DROPPED.md: habits feeding the
  to-do list, a habits tab of its own, times-per-week habits and streak
  milestones. Reminders were there too until the Android app gave them a
  way in; they shipped in 0.183.0.

- **Restore settings from a backup.** The full backup (JSON) carries the
  `settings` key, but no import applies it: importing adds data and never
  replaces, and settings are one device's preferences, so bringing them in
  unasked would overwrite another device's (see NOTES.md, 0.191.0). What's
  missing is an explicit way to do it on purpose: a "Restore settings from
  this file" step in the import review, or a button beside Everything's
  import, showing what would change before it does. History's "bring back
  settings" already restores them from a save, so the merge logic exists.

- **Branch cleanup from a cloud session.** Step 8 of the release checklist
  (`.claude/skills/release-checklist/SKILL.md`) says to delete finished
  branches, but a cloud session's git access refuses it (403 on
  `git push --delete`), and the GitHub tools it has can create branches but
  not delete them. Either change step 8 to list the finished branches for
  the owner to delete, or find an access setting that allows it. GitHub's
  "Automatically delete head branches" only helps with branches merged
  through a PR, which this repo no longer uses.

- **A drawing board, something like Excalidraw.** Possibly a fourth mode in
  the Notes tab ("Boards"), or a drawing attached to a note. Decide first
  which of two ways:
  - **Excalidraw itself** (`@excalidraw/excalidraw`). The real thing, but a
    React library of a few MB: against the no-build, no-dependency rule,
    and the Android app would have to bundle it to work offline.
  - **Our own, on a `<canvas>`.** Freehand pen, rectangles/ellipses/arrows,
    text, select and move, pan and zoom, undo, and touch that doesn't fight
    the mode swipe or pull to refresh. The hand-drawn look is rough.js
    (~30KB), which would be the one library, loaded like any other file.
    Fits the app; a big job to make feel right, especially on a phone.
  Either way the drawing is data that syncs through GitHub, and freehand
  strokes get big fast: simplify each stroke's points on save, and consider
  keeping boards in a file of their own beside lifelog.json so a heavy
  board doesn't slow every save (the 1MB large-file path would otherwise be
  hit early). Exports need a place too: PNG/SVG out, and boards in the
  Notes tab's JSON.

  Rough sizes, as vectors in JSON (estimates, not measured):
  - A shape, arrow or text box: ~100–200 bytes. A 50-shape diagram ≈ 10 KB.
  - A freehand stroke, raw: ~1–1.5 KB (a 1.5 s stroke sampled at ~60 Hz is
    ~90 points at ~12 bytes each). Simplified on save to 15–25 points:
    ~250–400 bytes, about a quarter.
  - 200 strokes: ≈ 250 KB raw, ≈ 60 KB simplified. A handwritten page of
    ~1,000 strokes, simplified: ≈ 300 KB. A PNG of the same is 50–300 KB,
    so vectors win for diagrams and roughly tie for dense handwriting.
  What decides where boards live is that every save uploads the whole data
  file: inside lifelog.json, ticking a habit re-sends every board, and two
  or three handwritten pages would push it past GitHub's 1 MB mark. History
  is not the worry: JSON compresses 5–10x, so a 300 KB board adds roughly
  30–60 KB of repo per save.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
