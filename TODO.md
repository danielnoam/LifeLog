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

  **One commit per edit.** Every persist() is its own PUT, and so its own
  commit in the data repo: ticking ten habit cells is ten commits in a few
  seconds. That is how GitHub's secondary rate limit (80 content writes a
  minute) becomes reachable, and 0.173.1 only made the status line honest
  about it. Coalescing saves — a short trailing debounce, one write for a
  burst — would fix the cause. It touches every save path, and some callers
  may rely on the save having happened when the promise resolves, so it
  wants its own change rather than riding along with a fix.

  **The Android app, after its first real launch.** 0.174.0 is tested
  against a faked bridge only (see NOTES.md). Things to look at on a phone:
  links with `target="_blank"` (the token page, release notes) should open
  in the browser rather than inside the app; the back gesture; the status
  bar. The status bar follows the phone's light/dark setting rather than
  LifeLog's theme, and matching it means edge-to-edge (`viewport-fit=cover`
  and safe-area padding), which changes the web layout too.

  **What the app could do that a browser can't**, in the order it's worth
  doing: native HTTP (`CapacitorHttp` — Steam without the proxy), a real
  file backup on the phone (the Filesystem plugin as a fourth backend in
  storage.js), and home-screen widgets — which have their own entry below.

  **iOS.** The same wrapper, plus $99/year for Apple's developer program and
  a macOS build job. Until there's a native feature worth that, iOS stays on
  Safari's Add to Home Screen, which already works.

  What was decided against outright is in DROPPED.md: habits feeding the
  to-do list, and a habits tab of its own, now that it has been tried.
  Reminders were there too until the Android app gave them a way in — see
  below.

- **settings, again.** 0.169.0 regrouped Settings by where each change lands,
  and it still doesn't look good — Appearance was the specific complaint the
  first time. Before touching it, pin down what reads badly: spacing and
  hierarchy inside a panel, the tab strip on a phone, controls of mismatched
  sizes sitting in one row, or long hint paragraphs doing a label's job. A
  screenshot of each panel at 390px and at desktop width, marked up, is the
  place to start rather than another reshuffle.

- **Android widgets.** The one thing the app can do that a browser can't.
  Candidates, most useful first: today's habits with a tick per habit; the
  to-do list, scrollable, with a tick per item and its categories; quick-add
  buttons (entry, expense, note — the manifest's shortcuts already name the
  first two); this month's spend. Shape of it:
  - Widgets are native (Kotlin, `AppWidgetProvider` + RemoteViews), and
    `android/` is generated in CI and not committed. Put the widget code in a
    small local Capacitor plugin (say `native/widgets/`, a `file:`
    dependency) so `android/` can stay generated.
  - A widget can't run the web app. The app writes what the widget shows
    (today's due habits and their marks, the open to-dos in their order)
    into SharedPreferences through that plugin whenever the data changes,
    and the widget draws from that.
  - The to-do list is a *collection* widget: a ListView fed by a
    RemoteViewsService, which is what lets it scroll, unlike a plain widget
    layout. Ticking an item goes through the same queue as a habit tick
    below. Adding an item from the widget is a quick-add that opens the app
    on the to-do sheet; typing inside a widget isn't something Android offers.
  - A tick on the widget can't reach GitHub by itself. Queue it natively, show
    it ticked straight away, and have the app apply the queue on its next
    launch or resume — it then syncs like any other tick. Say so somewhere,
    because a tick that only lands next time you open the app is a surprise
    otherwise.
  - Quick-add opens the app on the right sheet; that's the easy half.

- **Habit reminders — Android app only.** Dropped in 0.171.0 (see git
  history of DROPPED.md) because a *browser* can't do them well: a service
  worker waking on a schedule, permission prompts, an iOS story that
  historically didn't work, and a whole class of "why did it buzz twice" bug
  — bigger than the tracker. The app removes the main objection:
  `@capacitor/local-notifications` schedules on-device notifications with no
  server and no service worker. What stays true:
  - A reminder time per habit, on its due days only, set on the phone and
    kept local to it (a desktop has nothing to buzz) — so it lives beside the
    habit, not in the synced habit.
  - Android 13+ asks for notification permission; ask when the first reminder
    is set, not at launch. Inexact scheduling is fine for "remind me around
    21:00" and avoids the exact-alarm permission.
  - A reminder shouldn't nag about a habit already ticked. Cancel today's
    when it's ticked on the phone; a tick made on the desktop only reaches
    the phone at its next sync, so either accept the occasional stale buzz or
    re-check on resume. Decide which before building.
  - The browser version shows no reminder controls at all.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
