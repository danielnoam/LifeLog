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

- a **+** on each month panel in Notes, as a fast path to writing one. The
  month card header takes an onAdd today (monthCardHeader's opts) and Notes
  deliberately passes null, with the comment that a note is stamped with the
  moment it's written so there is no such thing as adding one to March.
  That reasoning still holds for *filing* — so the + should open the new-note
  modal as it always does and let the note stamp itself now, rather than
  backdating into the month whose header was clicked. Worth deciding whether
  a + that ignores its own month reads as a bug from the outside, or whether
  it should only appear on the current month's card.

- the rendering rework, continued. reconcile.js (0.129.0), the shared section
  plumbing (0.131.0), To-do (0.130.0), Notes (0.132.0) and the Timeline
  (0.133.0), the Backlog (0.134.0), the Ledger (0.135.0) the movement it
  was all for (0.136.0) and Discover (0.137.0) have landed — every view.
  What's left is cleanup:

  1. The jump-nav carousel and the bulk action bar, the last two bits of
     chrome still rebuilt wholesale. Note the 0.136.1 profile found neither
     of them costly, so this is tidiness rather than speed. The chip rows went in 0.136.0; these two
     are smaller and less often on screen, which is why they waited.
  2. Leave animations. Moves and arrivals shipped in 0.136.0; a row leaving
     still vanishes. Doing it means holding the node in the flow while it
     goes, which puts every caller's bookkeeping briefly out of step with the
     DOM — see NOTES.md. Worth it only if a vanishing row starts to read as a
     glitch.
  3. View Transitions for view/mode switches, where the whole page really does
     change. The existing view-fade-in and mode-slide-* keyframes may simply
     be replaced by it. Feature-detect.
  4. Last, not first: render() drops `#viewBody.innerHTML = ""`, once no view
     depends on being handed an empty root. See NOTES.md for why this moved
     from the front of the list to the back.

     Worth knowing before starting: this is now *tidiness*, not speed.
     content-visibility (0.136.1) made the layout this was going to save
     cheap enough that a profile no longer sees it. The clear still collapses
     #viewBody for an instant, so captureScrollAnchor/restoreScrollAnchor
     stay until it goes — but they are propping up a correctness problem now,
     not a performance one. Every view holds exactly one root node, so the
     shape of the fix is a registry of those roots that render() keeps while
     removing everything else.

  `epoch` is for a setting that changes a node's *root*, not its contents —
  adopt() handles contents. timelineCoverSize turned out not to need one;
  backlogCoverSize does, because it switches between two different root
  elements. See NOTES.md (0.133.0).

- one parameterised add/edit-category modal instead of three. The journal's,
  Finance's and the to-do list's are the same form over a different
  collection, with different cascades on rename and delete. #todoCatModal was
  written as a knowing third copy (0.128.2) rather than doing this refactor in
  the middle of a feature.

- a chip for the general to-do panel in the Categories row. You can narrow to
  any category but not to "no category", because the row is built from the
  category list and the general panel isn't in it.

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

- an Early Access flag can only ever be set by a Steam sync. Every other
  release field can be pinned by hand in the backlog modal's Advanced
  foldout — date, precision, status — but earlyAccess has no input, so a
  GOG or itch game in Early Access can't say so and Steam can't be
  corrected when it's wrong. The pin machinery already covers the field
  (MEDIA_FIELD_PINS maps it to "release"); it needs a checkbox in
  OVERRIDE_FIELDS' release entry and its pull/push

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
