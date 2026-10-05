todo:

- **Travel, what's next** (design: the "LifeLog travel tab design" doc).
  - *Import a Google Maps list.* A shared list link
    (maps.app.goo.gl/…) redirects to a google.com/maps URL holding the list
    id after `!2s`; `google.com/maps/preview/entitylist/getlist?…&pb=!1m4!1s<id>!2e1!3m1!1e1!2e2!3e2!4i500!16b1`
    answers `)]}'` + JSON with every place's name, coordinates and Google
    id (tested on a 27-place list, 2026-10-05). Unofficial, so it can
    break. The apps can fetch it through CapacitorHttp; the web needs two
    narrow routes on the Cloudflare worker. Then pick which places belong
    to the trip, since one list spans several trips. `gid` and `source`
    are already in the place's fields for it.
  - *Map view* with Leaflet (vendored) and free tiles: the map on the top
    half, the day's places below, pins numbered by the day's order. Check
    which tile source allows use from an app, and the dark themes.
  - *By area*: places grouped by town or neighbourhood, for open days.
  - Reorder a day's unscheduled places by dragging (`order` is there).
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
