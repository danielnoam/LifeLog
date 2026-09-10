todo:

- the rendering rework, continued. reconcile.js (0.129.0) and To-do (0.130.0)
  are the first two steps of a longer conversion; the remaining views each
  convert on their own, in this order, because each one gets cheaper once the
  one before it lands:

  1. Timeline entries, following Notes (0.132.0) exactly: hold the view root,
     mark sections `keepBody`, reconcile month cards by year-month and rows
     by item id, and keep the dataset.year/month the Stats heatmap jumps to.
     Check entryRow for handlers bound to the row's *root* rather than its
     children — that was the one real bug the Notes conversion turned up.
  3. Backlog (all three modes). The intricate one: two row builders switched
     by state.visual.backlogCoverSize, band separators that need synthetic
     keys, and Discover's async fills.
  4. Ledger. Virtual recurring occurrences already key stably as
     `${rec.id}:${n}`, so they reconcile like anything else.
  5. The chrome that still rebuilds wholesale — the year/category chip rows
     (buildYearFilter/buildCatFilter), the jump-nav carousel, the bulk bar.
     Small, but they're what you watch while typing in the search box.
  6. Then the actual point: FLIP moves, enter/leave transitions, and View
     Transitions kept to view/mode switches only.
  7. Last, not first: render() drops `#viewBody.innerHTML = ""`, once no view
     depends on being handed an empty root. See NOTES.md for why this moved
     from the front of the list to the back.

  Anything that changes a row's *shape* rather than its content has to go
  through `epoch` — state.visual carries seven such settings.

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
