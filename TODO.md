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

- **Branch cleanup from a cloud session.** Step 8 of the release checklist
  (`.claude/skills/release-checklist/SKILL.md`) says to delete finished
  branches, but a cloud session's git access refuses it (403 on
  `git push --delete`), and the GitHub tools it has can create branches but
  not delete them. Either change step 8 to list the finished branches for
  the owner to delete, or find an access setting that allows it. GitHub's
  "Automatically delete head branches" only helps with branches merged
  through a PR, which this repo no longer uses.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
