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

- **Notes, stage 3: remove the To-do mode's leftovers.** Stage 2 (0.197.0)
  moved every to-do into list notes and switched the widget, quick add,
  Recap, search and import over. What's left is dead code and data: the
  To-do mode's UI in todos.js, the to-do category modal and its CSS,
  `todos`/`todoCategories` in the data (the fold in `normalize()` stays
  until no device runs an APK older than 0.197.0), and the to-do rows in
  the CSV export. Also worth doing then: an "Open items" filter in Notes —
  every unticked item across lists — since "what's left" shouldn't need
  opening each list.

- **Note widgets (Android).**
  - **A note widget:** one note you pick, shown on the home screen, tapping
    through to it in the app. Configured when placed (Android's widget
    configure activity), like choosing which habit a widget shows.
  - **A random note widget:** a different note each time, for resurfacing
    old ones. Settings: which categories and kinds it draws from
    (note categories shipped in 0.195.0; a quotes-only one is the obvious
    setting), how often it changes (every hour, day, or on tap),
    and whether it shows the date. Tapping opens the note; a small ↻ draws
    another.
  Both read the widget snapshot widgets.js already sends (WidgetStore);
  notes would join it, capped in size, since a snapshot of every note in
  full could get large. Built like TodosWidget/ListWidget, with small and
  large layouts like the others (WidgetSize).

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
