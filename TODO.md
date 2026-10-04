todo:

- **A travel mode: places and an itinerary.** A trip with the places you
  want to go and a day-by-day plan. To decide: whether it's its own tab or
  part of an existing one (the Ledger already has projects, which a trip
  could share for its spending), and what a place holds (name, address or
  map link, notes, visited).

- **Widgets that are current without opening the app.** Sometimes a widget
  still shows old data after the app is opened. Find why, then whether the
  widgets can sync on their own (a periodic background fetch) so opening
  the app isn't what brings them up to date.

- **Markdown, PDF and EPUB files as notes.** Import or attach them so they
  open and read as notes.

- **A custom look for the widgets' settings screens.** They're plain
  framework dialogs built in code (0.201.0); give them LifeLog's own
  visuals.

- **Distinct names for each tab and each mode inside a tab**, where a mode
  shares its tab's name today.

- **Faster ways to add an expense.** Look at reading the Google Pay (or
  bank) notification on Android to prefill or log one.

- **The habits panel doesn't show all the days.** Find which days go
  missing and fix it.

- **The changelog inside the app.** A "What's new" in Settings (by the
  version line) that shows CHANGELOG.md's entries, newest first.

- **An Apple developer account ($99/year)**, if the iOS app is ever used
  for real: sign in CI, upload to TestFlight, and the 7-day re-signing that
  AltStore/SideStore do goes away. Everything else for iOS is built (0.216.0
  the app, 0.217.0 the widgets, reminders and Face ID).

  What was decided against outright is in DROPPED.md: habits feeding the
  to-do list, a habits tab of its own, times-per-week habits and streak
  milestones. Reminders were there too until the Android app gave them a
  way in; they shipped in 0.183.0.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
