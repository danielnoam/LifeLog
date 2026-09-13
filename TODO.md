todo:

- virtualising the Timeline and Backlog rows, if load ever needs to get
  faster again. Measured at 4x CPU throttle over 611 entries and 250 backlog
  items (0.136.1): first row ~320-660ms, and of the browser's own time
  RecalcStyle was 136ms and Layout 65ms against **18,388 DOM nodes** —
  ScriptDuration was 24ms, so neither the app's own logic nor compiling its
  690KB of JS is the cost. The load is one ~150ms frame and then smooth; the
  idle trickle behaves.

  The only lever left is building fewer nodes: ~30 per entry is what makes
  style recalc expensive. That means not building rows for sections nowhere
  near the viewport, which the IntersectionObserver already half does — the
  trickle deliberately fills the rest so the document reaches its true height
  and the scrollbar stops moving under you. Virtualising means owning that
  height yourself (estimated row heights, a spacer per unbuilt section), and
  it costs find-in-page over unbuilt rows. Not worth it at this size; the
  numbers above are the baseline to beat if it ever is.

- projects, now that they exist (0.145.0), have obvious next steps that were
  deliberately left out of the first cut: a budget per project with a
  spent-against-it bar, and a way to turn an existing lump entry
  ("Switzerland — 10,000") into a project with real expenses under it. Both
  want using the feature first — a budget is only useful if you set one
  before you spend, and the converter is a one-off migration whose shape
  depends on how many old lumps turn out to be worth splitting.

  Currency-wise (0.146.0), two things were left out deliberately: recurring
  expenses can't be foreign (a subscription billed in USD is a real case, but
  it wants a rate per occurrence or a rate that drifts, and neither is a
  five-minute decision), and there is no rate lookup — every rate is one you
  typed. An FX API would add a network dependency to a view that has none,
  and for the main use (settling a trip from the statement) the number you
  want isn't a published rate anyway.

  Projects are also finance-only on purpose. A holiday is a thing you log
  entries and notes about too, and a project that spanned all four views is a
  much bigger idea than this one — don't grow this into that by accident.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
