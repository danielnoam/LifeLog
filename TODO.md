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

- **Boards, round two** (they shipped in 0.193.0). In rough order of worth:
  - **Resize and rotate** a selected element: handles on the selection box.
    Today a shape can only be moved, or redrawn.
  - **History for boards.** The History page and its undo/restore cover
    lifelog.json only; boards.json's commits are on GitHub but nowhere in
    the app. A lost board today comes back only from GitHub's web UI.
  - **The local-file backup** (File System Access) mirrors lifelog.json
    only; boards.json could be a second file beside it.
  - **Fill** for rectangles and ellipses (rough.js hachure), and a
    hand-drawn font for text, which would finish the Excalidraw look.
  - **Measure the real sizes** against the estimates the board item had
    (a diagram ≈ 10KB, a handwritten page ≈ 300KB once simplified).

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
