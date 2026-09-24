todo:

- habits shipped in 0.171.0, moved into Notes as its third mode in 0.171.1,
  and learned to backfill in 0.172.0–0.173.0. Two things were left out of the
  first cut deliberately rather than forgotten.

  **Times-per-week** ("the gym, three times, any days") is the cadence that
  didn't make it. It is not a third option on the same control: a streak
  stops being a run of days and becomes a run of satisfied weeks, which is
  different logic and a different thing to explain on the card. Worth adding
  once the daily and days-of-week ones have been lived with.

  **A milestone becoming an accomplishment** — a hundred-day run offering to
  write itself into the year's "things you're proud of" — is a nice
  connection the app is already shaped for. Left out of the first cut because
  it should be an offer rather than something that happens to you, and where
  that offer belongs is easier to answer after using the tab for a while.

  **An undo that lasts longer than a toast.** 0.173.0 gave the app its first
  undo, for the two habit actions that write a lot of days at once. It lives
  as long as the toast does, which is right for "wait, no" and no use at all
  the next morning. A real one is a different piece of machinery — a stack, a
  serialised before-state, a decision about what syncing does with it — and
  worth doing only if the toast one turns out not to be enough.

  **Still only verifiable on a phone** (0.178.0 made each right by
  construction and tested what the page decides): the status bar really
  taking the top bar's colour, outside links opening in the phone's browser, the
  back gesture reaching the app, the in-app update reaching Android's
  installer (0.179.0 — first testable on the update *after* it),
  exports reaching the share sheet, habit reminders (0.183.0) ringing on
  time and staying quiet for a habit already kept, and the widgets (0.181.0) — whether
  they draw at all, tick in place, and turn over at midnight. Their Java
  is compiled against the real framework before it ships and their XML
  checked by nativebuild.test.js, but only a home screen inflates them.

  **What the app could do that a browser can't**, in the order it's worth
  doing: native HTTP (`CapacitorHttp` — Steam without the proxy), a real
  file backup on the phone (the Filesystem plugin as a fourth backend in
  storage.js — 0.179.0's export already writes files with that plugin and
  shares them, so this is the same pair on a schedule), and home-screen
  widgets — which have their own entry below.

  **iOS.** The same wrapper, plus $99/year for Apple's developer program and
  a macOS build job. Until there's a native feature worth that, iOS stays on
  Safari's Add to Home Screen, which already works.

  What was decided against outright is in DROPPED.md: habits feeding the
  to-do list, and a habits tab of its own, now that it has been tried.
  Reminders were there too until the Android app gave them a way in; they
  shipped in 0.183.0.

- **settings, again.** 0.169.0 regrouped Settings by where each change lands,
  and it still doesn't look good — Appearance was the specific complaint the
  first time. Before touching it, pin down what reads badly: spacing and
  hierarchy inside a panel, the tab strip on a phone, controls of mismatched
  sizes sitting in one row, or long hint paragraphs doing a label's job. A
  screenshot of each panel at 390px and at desktop width, marked up, is the
  place to start rather than another reshuffle.

- **Widgets, second round** (the first shipped in 0.181.0: habits, to-do,
  quick add). This month's spend was the fourth candidate and was left out
  of the first cut: it needs Finance's month total, currency and all, worked
  out in JavaScript and carried in the snapshot, and it's the one of the
  four you'd read rather than touch. Also worth doing once the three have
  been lived with: Android 12's RemoteCollectionItems instead of the
  deprecated list service (it's 12+ only, so it would sit beside the old
  path, not replace it), and a preview image for the widget picker.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
