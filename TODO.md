todo:

- the category chips should narrow Discover, and today they don't.
  discoverSourceMap() walks state.data.categories unconditionally and never
  looks at state.activeCats, so narrowing to Games still shows the book and
  anime cards beside it — the one backlog surface where the chip row above it
  does nothing. Filtering the map by activeCats (when the set is non-empty) is
  most of the change; the rest is deciding what an empty result should say,
  since "no categories match" is a different message from the existing "none
  of your sources publishes a popularity list".

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
  (0.133.0), the Backlog (0.134.0) and the Ledger (0.135.0) have landed —
  every list view. What's left:

  1. Discover, on its own and last of the views. Its rows come from the
     network and turn over wholesale on each fetch, so reuse buys little —
     the win would be that the grid stops flashing on every refresh, which
     is worth having but is not what the rest of this was for. Key the cards
     by source and the rows by source + result id.
  2. The chrome that still rebuilds wholesale — the year/category chip rows
     (buildYearFilter/buildCatFilter), the jump-nav carousel, the bulk bar.
     Small, but they're what you watch while typing in the search box.
  3. Then the actual point: FLIP moves, enter/leave transitions, and View
     Transitions kept to view/mode switches only.
  4. Last, not first: render() drops `#viewBody.innerHTML = ""`, once no view
     depends on being handed an empty root. See NOTES.md for why this moved
     from the front of the list to the back.

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
