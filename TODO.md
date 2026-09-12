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

- the rendering rework is finished. reconcile.js (0.129.0), the shared
  section plumbing (0.131.0), To-do (0.130.0), Notes (0.132.0), the Timeline
  (0.133.0), the Backlog (0.134.0), the Ledger (0.135.0), movement (0.136.0),
  the layout-cost pass (0.136.1), Discover (0.137.0) and leave animations
  (0.139.0) have all landed. Two planned steps were dropped rather than built
  — View Transitions and render() losing its innerHTML clear — and DROPPED.md
  says why for both. The jump-nav carousel is the one thing still rebuilt
  wholesale, and it measured free.

  `epoch` is for a setting that changes a node's *root*, not its contents —
  adopt() handles contents. timelineCoverSize turned out not to need one;
  backlogCoverSize does, because it switches between two different root
  elements. See NOTES.md (0.133.0).

- whether Notes' year -> month grouping earns its keep at a few hundred
  notes. The last open question from the first cut — bulk select and
  note -> entry both landed in 0.142.0 — and the one only use can answer: a
  feed you read top-down may want a flat list, or month cards may be exactly
  what makes it scannable. Nothing to build until that's known.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
