todo:

- **Security pass follow-ups (0.259.2).** The write-up in the project's
  audits folder (2026-10-09-security-pass.md) ranks these; each one changes
  how data is stored or synced, so each is a decision first:
  - Fine-grained GitHub token (one repo, Contents only) instead of the
    classic `repo` scope the pre-filled link asks for.
  - API keys (RAWG, TMDB, GG.deals, SteamGridDB, Places, Steam) out of the
    synced data and out of the GitHub commits, export and phone backup.
  - Android `allowBackup`/`dataExtractionRules`, iOS complete file
    protection on the App Group files.
  - The lock: re-lock on resume, PBKDF2 for the PIN, attempt backoff,
    widgets and the exported widget activities honouring it, privacy screen.
  - A Content-Security-Policy, tested on the Android app first (Capacitor
    injects its bridge as an inline script).
  - Optional encryption of the data file before it is committed (see
    DROPPED.md, Data encryption).

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
