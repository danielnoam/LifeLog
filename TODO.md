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

  What was decided against outright is in DROPPED.md: reminders, and habits
  feeding the to-do list. A habits tab of its own is there too, now that it
  has been tried.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
