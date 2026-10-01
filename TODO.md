todo:

- **Design language: what's left** (DESIGN.md). Contrast, tap targets
  across every view, phone fields, scale tokens, springs and swipe-down are
  done (0.219.0–0.222.0). Left, all small:
  - Off-scale values still in styles.css (lint-css.js: ~170 spacing, ~100
    font sizes, ~50 radii). Move each onto the nearest step when its rule
    is touched; no sweep.
  - Focus returning to whatever opened a sheet, checked sheet by sheet.
  - Swipe actions on rows (Target in DESIGN.md §10), if they're wanted.
  - Filter chips stay 34px tall by choice (2026-10-01); the habit grid's
    day cells stay 16px by necessity.

- **A travel mode: places and an itinerary.** A trip with the places you
  want to go and a day-by-day plan. To decide: whether it's its own tab or
  part of an existing one (the Ledger already has projects, which a trip
  could share for its spending), and what a place holds (name, address or
  map link, notes, visited).

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
