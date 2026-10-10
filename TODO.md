todo:

- **Security pass follow-ups (0.259.2).** The write-up in the project's
  audits folder (2026-10-09-security-pass.md) ranks these; each one changes
  how data is stored or synced, so each is a decision first. The token flow
  and the keys-out-of-exports shipped in 0.260.0, backups off in 0.261.0,
  the lock hardening in 0.262.0, the CSP in 0.263.0; still open:
  - Optional encryption of the data file before it is committed (see
    DROPPED.md, Data encryption); Daniel leans no.
  - Encrypting the local copy (localStorage) with a key from the PIN, for
    the desktop browser mainly; explained on 2026-10-09, his call.

- **Activity, next, if wanted:** the Markdown and EPUB/PDF imports as
  jobs (local and quick so far). Steam sync in the background was checked
  on Daniel's phone (2026-10-10).

- **Run the tests in CI and gate the release on them.** Nothing runs
  `node test/run-all.js` on a push: android.yml and ios.yml build and
  publish whatever lands on main. Add a test job, make the Android and iOS
  publish steps `needs: test`, and move Pages to the Actions deploy so it
  waits on the tests too (it deploys from the branch today, which can't be
  gated). Settle the fxrate check below first, or it's red on day one.

- **Move the cache and the sync base out of localStorage.**
  `lifelog-cache-v1` and `lifelog-sync-base-v1` are each a whole copy of
  lifelog.json (src/storage.js `_cache` and `_setSyncBase`), the file has
  passed 1MB before, and an origin gets about 5M characters. Both writes
  are `catch (e) {}`, so when it fills nothing says so: an offline edit no
  longer survives a reload and the merge base stops moving. Put both in
  IndexedDB, as boards.json and travel.json already do, with a one-time
  move of the existing keys. Not a data change; the bridge is untouched.

- **fxrate's "sits on the rate's own row" check fails** on main before the
  icon change too (the Look up button's centre is off the rate input's by
  more than 3px at 1280). Either the sheet's layout drifted or the check is
  too tight; look at `#finRateFetchBtn` beside `#finRate` and decide.

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
