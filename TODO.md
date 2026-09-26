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

- **Notes, stages 2 and 3: the To-do mode becomes list notes.** Stage 1
  (0.195.0) gave notes kinds (plain, list, quote), categories, a kind
  switch and a sort. Decided with the owner: to-do categories are really
  separate lists, so each becomes a list note; the widget and quick-add work
  across every unticked item.
  - **Stage 2, the migration.** Each to-do category → a list note titled
    with it (category-less to-dos → one "To-do" list), items keeping their
    text, ticks, doneAt and order. Two devices migrate on their own, so the
    list and item ids must come out the same on both (derived from the
    category's and the to-do's ids, not minted), and it must run once
    (a marker in settings) and be safe against a device still on an older
    APK writing `todos` after the others moved on — merge those in rather
    than lose them. Keep `todos` until stage 3 ships so a rollback loses
    nothing.
  - **Stage 3, the switch.** The Todos widget reads unticked items across
    list notes, grouped by note, ticking still works from the home screen;
    quick-add ("add-todo"/the widget's +) goes into a default list you pick;
    Recap's "to-dos done" counts list items; then the To-do mode, todos.js,
    `todos`/`todoCategories`, their CSV rows and the to-do category modal go.
  - An "Open items" view — every unticked item across lists — as a chip or
    filter in Notes, since "what's left to do" shouldn't need opening each
    list.

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
