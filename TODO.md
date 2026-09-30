todo:

- **In progress: what you're on now.** A card at the top of the Timeline,
  like the ★ Favourites in Notes, for entries you've started but not
  finished: between the Backlog and the Timeline.
  - Move something there from the Backlog (a button on the item, and in
    its sheet), or start one there directly.
  - A way to mark one done, which moves it into the Timeline.
  - Remember when it went in and when it came out, so the entry's start
    month and month are filled in from those dates (the multi-month span
    entries already have) unless you set them yourself.
  - To decide: whether it's a flag on a backlog item or a status on an
    entry, and what happens on the Backlog side (does it stay listed
    there, marked, or leave?).

- **A travel mode: places and an itinerary.** A trip with the places you
  want to go and a day-by-day plan. To decide: whether it's its own tab or
  part of an existing one (the Ledger already has projects, which a trip
  could share for its spending), and what a place holds (name, address or
  map link, notes, visited).

- **Notes: choosing more than one category.** Reported as "can't select
  more than one". The chip row itself does multi-select (Work, Home and
  No category together narrow to all three, checked 0.217.0), so it's
  likely one of:
  - a collection's chip, which opens that collection on its own and so
    clears the others (by design since 0.206.0, but it reads as broken);
  - giving one note several categories, which the data can't hold today
    (a note has one `category`) and would be a change to the note format.
  Find out which, then fix or build it.

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
