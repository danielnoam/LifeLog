todo:

- **A travel mode: places and an itinerary.** A trip with the places you
  want to go and a day-by-day plan. To decide: whether it's its own tab or
  part of an existing one (the Ledger already has projects, which a trip
  could share for its spending), and what a place holds (name, address or
  map link, notes, visited).

- **Books as notes.** PDFs and EPUBs come in as text since 0.236.0, but
  only up to 300,000 characters, because every note lives in the one data
  file that syncs on each save and is cached in localStorage (about 5MB). A
  whole book needs its text kept apart: in IndexedDB and a file of its own
  in the sync repo, written once, with the note holding the title and a
  reader that loads the rest.

- **An AI chat inside LifeLog.** The data side is done: bridge/ gives any
  AI the tools (0.239.0), and Telemachus is that chat today, on the phone
  over Tailscale. A chat in the app itself would talk to Telemachus, and so
  only work while the PC is on, with CORS and a token opened to the app. Do
  it only if opening Telemachus turns out to be the friction.
- **More for the bridge:** accomplishments, boards, renaming categories,
  editing a recurring bill's single charge (overrides) and pausing one.

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
