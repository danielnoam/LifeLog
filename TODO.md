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

- cover images are rebuilt on every row refill (adopt replaces children
  wholesale), so a re-render costs a decode per visible cover. Cached, so no
  download. Only worth special-casing if it shows up in a measurement — the
  row surviving is what the rework was for, and preserving one child by src
  means per-field patching that nothing else needs yet.

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

- one parameterised add/edit-category modal instead of three. The journal's,
  Finance's and the to-do list's are the same form over a different
  collection. #todoCatModal was written as a knowing third copy (0.128.2)
  rather than doing this refactor in the middle of a feature.

  The three `open` functions are near-identical — ids, title, the "uses"
  count and its noun, the default colour, and whether the name input takes
  focus. That half is mechanical.

  The save paths are not, and this is why it hasn't been done: they diverge
  in three ways that a shared form would have to *resolve*, not just absorb.
  Finance's duplicate check is case-sensitive and To-do's is case-insensitive
  (so Finance will take both "Games" and "games"). Finance generates an id by
  slugging the name, To-do calls uid(). Finance stamps createdAt, To-do
  stamps updatedAt — the item above.

  Each of those is a decision, and the last one changes the shape of a synced
  collection. Do the whole thing or leave the three honest copies: a shared
  form with three divergent save paths behind it is worse than either, because
  it implies a sameness that isn't there.

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

- Notes, deliberately left out of the first cut: no bulk select (the
  timeline's long-press machinery would carry over), and no way to turn a
  note into a timeline entry — "started Silksong" becoming a finished entry
  is an obvious bridge, but it wants using the feed first to know what shape
  it should take. Whether the year -> month grouping earns its keep at a few
  hundred notes is the other thing only use will answer

- Discover could answer "what's hot on the services I actually have" via
  TMDB's watch-provider filter (/discover with with_watch_providers +
  watch_region). The nearest thing to the Netflix browsing this was
  originally asked for (see DROPPED.md)

---

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
