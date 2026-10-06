todo:

- **Activity, next.** Check on Daniel's phone that a Steam sync carries on
  with the app put away and the screen off, and that the notification's
  Stop and tap work (not testable here). Then, if wanted: a job that was
  interrupted by the app being killed offered again on the next open; the
  Markdown and EPUB/PDF imports as jobs (local and quick so far).

- **Travel, what's next** (design: the "LifeLog travel tab design" doc).
  - Name the "Near …" areas: a list's places often have no address, so
    By area can only name those groups after a place. A reverse geocoder
    (Nominatim, with its 1-a-second limit, cached) would give the town.
  - The map in the import sheet, to pick a list's places by area on a map
    rather than by group.
  - Settings → History for trips, and travel.json in the desktop file
    backup: Storage.travel already has both; nothing in Settings shows
    them yet.
  - Later, if wanted: a trip's Ledger project, Google's reviews and hours
    (Places API, needs a key; reviews can't be stored).

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
