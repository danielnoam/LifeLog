todo:

- **Released today: a card that catches it before it leaves Next
  releases.** When something on your backlog comes out today, it should
  get its own card, "Out today", the way In progress has one, before it
  drops off Next releases (Backlog's ◷ mode, `upcomingItems()` in
  backlog.js). Plus a button on Next releases that brings that card back
  if you missed it (dismissed it, or it's no longer today but still
  recent). To decide: where the card lives (top of the Timeline like In
  progress, top of Next releases, or both), how long "today" lasts (the
  day, or until you've seen it), and what its rows offer (▶ start, ✓ done,
  dismiss).

- **Yearly recap: explain the spending.** Today there's one big number
  ("spent across N expenses", the `spend` slide in recap.js). Break it
  down per category and per month: which categories took the most, and
  how the year moved month to month. Also, the slide headed "What you
  spent it on" (`categories` in recap.js) actually counts *logged
  entries* by category (games, shows…), not money; retitle it ("What you
  spent your time on"?) or let the new money slide own that line.

- **Yearly recap: "Everything you logged" is broken.** The gallery slide
  (`gallery` in recap.js): cover art in it can overlap, and it's one long
  wall sorted by category then rating, capped at `GALLERY_MAX`. Organise it
  as you scroll, per category or per month (with a header for each group),
  and fix the overlapping covers. Reproduce the overlap first: check
  phone and desktop, covers vs. the tinted no-art tiles, and long titles.

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
