todo:

- **What the Android app could do that a browser can't**, in the order it's
  worth doing: native HTTP (`CapacitorHttp` — Steam without the proxy), a real
  file backup on the phone (the Filesystem plugin as a fourth backend in
  storage.js — 0.179.0's export already writes files with that plugin and
  shares them, so this is the same pair on a schedule). Widgets shipped in
  0.181.0–0.185.0.

  **iOS.** The same wrapper, plus $99/year for Apple's developer program and
  a macOS build job. Until there's a native feature worth that, iOS stays on
  Safari's Add to Home Screen, which already works.

  What was decided against outright is in DROPPED.md: habits feeding the
  to-do list, a habits tab of its own, times-per-week habits and streak
  milestones. Reminders were there too until the Android app gave them a
  way in; they shipped in 0.183.0.

- **Data encryption.** Nothing is encrypted today. The data file sits in a
  private GitHub repo in plain JSON, readable by GitHub and by anything
  holding the token; the browser's copy and the phone's are plain too. The
  app lock guards opening the app, not the data. Decide which of these it's
  for before building, because they're different jobs:
  - **At rest on GitHub (end to end).** Encrypt the file before it's pushed
    (Web Crypto, AES-GCM, key from a passphrase via PBKDF2 or similar), and
    decrypt on load. Merging still works, since it happens on the decrypted
    copy on each device. The costs: every device needs the passphrase, which
    a setup link must not carry beside the token; a lost passphrase means
    the data is gone with no recovery; GitHub's history becomes opaque blobs,
    so History's GitHub entries (restore, undo, bring back settings) have to
    decrypt too; and the 1MB large-file path reads the blob the same way.
  - **At rest on the device.** localStorage, IndexedDB history and the
    widgets' snapshot are plain. Encrypting them means the key has to be in
    memory to show anything, which ties it to the app lock (PIN or
    fingerprint unlocks the key) — and the widgets and reminders, which run
    without the app, could no longer read their snapshot, or would need a
    plain copy of just what they show.
  Probably worth doing only the first, with a clear warning about the
  passphrase, and leaving device storage to the phone's own encryption.

- **Widgets that look right when small.** At their smallest sizes the
  widgets are the big layouts squeezed: the habits and to-do headers crowd
  the rows, quick add's five buttons get cramped labels, the spend total
  wraps. Give each a compact layout of its own rather than shrinking the one
  it has — e.g. habits as ticks with streaks and no header text, to-do as the
  list alone, quick add as icons only, spend as the total and the month.
  Android 12+ picks between layouts by size itself (a RemoteViews map keyed
  by SizeF); before 12, choose in onAppWidgetOptionsChanged from
  OPTION_APPWIDGET_MIN_WIDTH / MAX_HEIGHT, the way the habits widget already
  counts how many rows fit.

- **settings, again.** 0.169.0 regrouped Settings by where each change lands,
  and it still doesn't look good — Appearance was the specific complaint the
  first time. Before touching it, pin down what reads badly: spacing and
  hierarchy inside a panel, the tab strip on a phone, controls of mismatched
  sizes sitting in one row, or long hint paragraphs doing a label's job. A
  screenshot of each panel at 390px and at desktop width, marked up, is the
  place to start rather than another reshuffle.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
