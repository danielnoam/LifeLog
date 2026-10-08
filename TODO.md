todo:

- **Share into LifeLog, on the phones (0.250.0).** Built without a device:
  check on Android that Chrome's Share → LifeLog opens the Backlog sheet
  with the title, and on iOS that LifeLog appears in the Share sheet at all
  and that the app opens by itself after the share (if it doesn't, the
  share should still appear the next time the app is opened).
- **Activity, next.** Check on Daniel's phone that a Steam sync carries on
  with the app put away and the screen off, and that the notification's
  Stop and tap work (not testable here), and that Run again shows after
  swiping the app away mid-sync. Then, if wanted: the Markdown and EPUB/PDF
  imports as jobs (local and quick so far).

- **fxrate's "sits on the rate's own row" check fails** on main before the
  icon change too (the Look up button's centre is off the rate input's by
  more than 3px at 1280). Either the sheet's layout drifted or the check is
  too tight; look at `#finRateFetchBtn` beside `#finRate` and decide.

- **Travel, check with real services.** Town names (OpenStreetMap) and
  Google's rating, hours and reviews were only tested against fakes here.
  Paste a Places key and open a few places, in the app and on the Pages
  site, and import a list with places that have no address.

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
