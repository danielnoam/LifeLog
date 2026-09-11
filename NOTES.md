# Notes

Why things in LifeLog are the way they are: the reasoning behind decisions
that are already shipped, kept because the code can say *what* it does but
rarely *what else was tried*. This is the file to read before changing
something that looks arbitrary — usually it isn't, and the entry says so.

Newest first. It used to be the `done:` half of TODO.md, which had grown to
forty times the length of the actual to-do list. Entries near the bottom are
terse one-liners because they started life as to-do items and were struck
through when finished; the longer ones further up are notes written to be
read again.

Two neighbours: **TODO.md** is work still worth doing, and **DROPPED.md** is
what was decided against and why.

---

- Discover converted in 0.137.0, finishing the views, and it is the one that
  breaks the rule the other four established.

  Everywhere else a row's click handler resolves its item by id at click
  time, because a captured object goes stale when adopt() refills the node.
  Discover cannot: a result is not stored anywhere, `r` *is* the data straight
  off the network, and a refresh replaces the object behind a given id with a
  new one. So the current result rides on the node in a WeakMap and the
  handler reads it there. That is the exception, not a pattern to copy — if a
  future view can look its item up in state.data, it should.

  Rows are keyed by source + result id, not result id alone. Two sources can
  return the same id for different things and the cards share no key space,
  so the source has to be in the key.

  The card keeps the head/.backlog-list shape every other backlog section
  has, rather than being flattened into one reconciled list — the first
  attempt did flatten it, which silently dropped .backlog-list and the CSS
  that hangs off it.

- the Discover category filter (0.137.0) was a real bug, not a missing
  feature: discoverSourceMap() walked state.data.categories unconditionally
  and never looked at state.activeCats, so the chip row rendered above a grid
  it had no effect on. It now uses getFilteredBacklog's rule — an empty chip
  set means everything. The empty state had to split in two as a result:
  "you have not set up a source that publishes a list" and "nothing in the
  categories you narrowed to has one" are different problems, and only the
  second has a fix the reader can act on immediately (click the chip off).

- what 0.136.1's measurements ruled *out*, which is the more useful half and
  is easy to lose. At 4x CPU throttle over 611 entries, the browser's own
  counters put ScriptDuration at 24ms against RecalcStyle 136ms and Layout
  65ms. So: the app's JS is not the cost, and neither is parsing and
  compiling its 690KB across fifteen files — a plan to split the modules and
  load the optional ones late would have bought almost nothing. The cost is
  style and layout over 18,388 nodes, and the only way down is fewer nodes.
  TODO.md carries that as the virtualisation entry, with the numbers.

  Two other theories died the same way. The tab underline animating
  left/width was not why the bottom bar stuttered — the main thread was busy.
  And the idle trickle does not jank: one ~150ms frame across a whole 3s load
  at 4x, and that frame is the first render, not the trickle.

- 0.136.1 is a performance pass, and it was measured rather than guessed —
  worth recording, because two of the three obvious suspects were wrong.

  A CPU profile of one category-chip toggle over 611 entries and 250 backlog
  items put getBoundingClientRect at 318ms of a ~500ms busy window, with the
  browser's own layout time beside it. Not row construction, not the diff.

  Fix one: FLIP now only measures when the op list actually contains a move.
  A filter change, a search keystroke or a chip toggle produces inserts and
  removes — nothing moves — and the animation layer was measuring every row in
  every month card anyway. Arrivals are not gated by this, since the enter
  animation is a CSS class and costs no measurement. 318ms -> 186ms.

  Fix two: content-visibility: auto on .month-card and .backlog-section. The
  remaining 186ms was not many reads — instrumenting the page counted only 22
  layout reads in the whole toggle — but each one forced a full layout of a
  document holding 611 rows. Taking off-screen cards out of layout makes every
  one of those reads cheap. 186ms -> 2ms, and the browser's layout time
  dropped from 304ms to 85ms.

  contain-intrinsic-size uses the `auto` keyword so each card remembers the
  height it last rendered at; the 300px is only the first guess for a card
  never yet painted. Sticky headers survive it — .month-card h3 and
  .backlog-section-head both sit *inside* contained elements and were the
  obvious thing to break, so they are covered by their own test.

  What this also fixed, which is the part worth remembering: the bottom bar's
  lag. Measured frame intervals across four tab switches went from worst
  frames of 100ms and 300ms with 18 dropped, to zero dropped and a worst of
  16.8ms. The underline was never the problem — it janked because the main
  thread was busy laying out six hundred rows underneath it. See the entry
  below on why the underline is still animating left/width: that reasoning
  now has a measurement behind it rather than an assertion.

  The --year-head-h loop was also batched (all the reads, then all the
  writes). Small on its own — eight sections — but it was alternating read and
  write, which is the shape that makes a browser flush layout per iteration.

- the payoff, 0.136.0: reconcile() grew FLIP for moves and a fade for
  arrivals. Notes on the shape of it, because several parts look optional and
  are not:

  It is opt-in per call (`animate: true`), not global. Measuring costs two
  forced layouts per reconcile, and a container whose contents change
  wholesale — a chip row switching between category lists, a section list
  rebuilt after a filter — has nothing worth animating. Only the row-level
  lists opt in.

  It skips when the container is off-document. A view holds its root across a
  render now, so reconcile runs while detached, where every rect reads zero
  and the "movement" would be the whole list flying in from the corner.

  A node already mid-animation has its FLIP cleared before being measured,
  otherwise the second measurement reads a position part-way through the
  first transition and inverts against its own transform.

  Removals are deliberately not animated. Holding a node in the flow while it
  leaves means the list doesn't close up until the animation ends, and every
  caller's bookkeeping would be briefly out of step with the DOM. A row
  vanishing is much less jarring than a row teleporting, which was the actual
  complaint.

  Two loose ends. The chip rows are reconciled but not animated — chips
  jiggling as you type is noise, not feedback. And buildYearFilter and
  buildCatFilter no longer clear their container: they used to open with
  `wrap.innerHTML = ""`, which handed reconcile an empty container every time
  and made its stale-node guard rebuild everything. That was the whole bug
  behind "chips rebuild on every keystroke" surviving the first conversion
  attempt.

- the tab underline was going to move from animating left/width to a
  transform, listed as a free win. It isn't one, and it is not being done.
  updateTabUnderline sets left/width directly and the live drag-follow morphs
  the same two properties as a 0-1 progress fraction toward a measured target
  box, so both would have to be rewritten together — and scaleX on a 2px bar
  with a border-radius distorts the radius as it stretches. Real work and a
  visual risk, for a bar that animates on a tab switch.

- the Ledger converted in 0.135.0, finishing the list views. Three things
  particular to it:

  A row's click has to resolve through getEffectiveFinanceEntries(), not
  state.data.financeEntries, because a recurring occurrence is *generated* and
  isn't stored anywhere to look up. Whether a row is virtual is fixed for the
  life of its node — a generated occurrence keys as `${rec.id}:${n}` and a
  real entry as a uid, so the two key spaces are disjoint and a key never
  changes sides. That invariant is what makes it safe for createFinanceRow to
  decide at create time whether to attach the long-press.

  The month total is the one node built in create() and updated in place
  rather than refilled. animatedNumberText counts it up over ~550ms, and
  adopt() replacing the span it animates would cut that off on any render
  landing mid-flight. Everything else in the card is refilled as usual.

  The month's category breakdown and its total ride in the same keyed list as
  the rows, under __cats and __total, the same reserved-key trick To-do's
  header and the Backlog's band separators use. Worth knowing because they are
  easy to lose: they sat *after* the row loop in the old build, so a
  conversion that only moves the rows drops them silently — which is exactly
  what happened on the first pass here, caught by asserting the breakdown and
  total are still on screen rather than only counting rows.

- Backlog converted in 0.134.0 — Entries and Next releases. It is the view the
  plan called the intricate one, and it earned that in three specific ways:

  backlogCoverSize IS an epoch, where timelineCoverSize turned out not to be
  (see 0.133.0 below). backlogRow dispatches to backlogRowRich and the two
  return *different root elements* — div.entry versus div.backlog-item-rich —
  so a reused node would be the wrong element wearing the right data. That is
  the distinction: an epoch is for a setting that changes a node's root, never
  for one that only changes what is inside it. rowShapeFor() returns the root
  class and doubles as the epoch value, so the two can't drift apart.

  Band separators ride in the same keyed list as the rows, keyed "sep-<band>".
  Bands are ordered and a boundary into a given band happens at most once per
  list, so those keys are unique. Left unkeyed they would drift out of place
  the first time a row crossed a band — which is exactly what starring
  something does, so this was not a theoretical worry. A separator's class is
  fixed by its key, so it needs no update() at all.

  All three row builders (backlogRow, backlogRowRich, upcomingRow) ended in
  the identical two lines binding row.onclick and attachLongPressSelect. They
  now share createBacklogRow, which binds by id. attachLongPressSelect keeps
  taking a bare { id } for the reason given under 0.133.0.

  Discover is deliberately NOT converted. Its rows come from the network and
  turn over wholesale on each fetch, so keyed reuse buys nearly nothing there,
  and it is the one backlog surface with no editing, no reordering and no band
  to cross. TODO.md carries it as its own small item rather than leaving it
  looking forgotten.

  Worth knowing when reading the tests: the separator *count* follows the bands
  present, not the row count — Games spanning bands 0, 1, 3 and 4 has three
  separators. The invariant to assert is that no band separator appears twice,
  which is what an unkeyed one would do.

- Timeline converted in 0.133.0, to the Notes template exactly: view root held
  across renders, `keepBody` sections, month cards keyed year-month, rows keyed
  by entry id. Three things it settled that are worth not re-deriving:

  entryRow had the same stale-handler bug noteCard did — `row.onclick` closed
  over the entry — and it is fixed the same way, in createEntryRow, by id.
  attachLongPressSelect, sitting right beside it, is *not* a bug: it only ever
  reads `.id`, and a node's id is fixed by the key it is reconciled under, so
  handing it a bare `{ id }` is correct. Don't "fix" it.

  timelineCoverSize does NOT need an epoch, which the plan predicted it would.
  An epoch is for a setting that changes a node's *shape*; this one changes
  what is inside the row, and the row root is `div.entry` either way. adopt()
  handles the contents. Same for bulk mode adding a checkbox child. The epoch
  is still the right tool where the *root* differs — To-do's reorder rows are
  the real case, since they carry different listeners.

  Cover images are rebuilt on every refill, because adopt() replaces children
  wholesale. The row surviving is what matters for animation, so this was left
  alone rather than special-cased; a cached image costs a decode, not a
  download. TODO.md carries it in case it ever shows up in a measurement.

  One testing note: month-card counts are timing-dependent. Sections build
  lazily, so a year below the fold arrives on the idle trickle a beat after
  load — assert on the settled count, not the one immediately after render.

- Notes converted in 0.132.0, and it is the template the remaining three
  views copy: hold the view root across a render, mark each section
  `keepBody`, and reconcile month cards by `year-month` and rows by item id.

  It also caught the hazard that the To-do conversion got away with by luck.
  noteCard bound `card.onclick` and `card.onkeydown` on the card *root*,
  closed over the note object. adopt() carries attributes across a refill but
  not properties, so a reused card kept a handler pointing at the note as it
  was when the card was first built: edit a note, click it, and the pre-edit
  text opened. It is now bound once in createNoteCard and resolves the note by
  id at click time, which cannot go stale.

  To-do never hit this because all its handlers sit on children (the
  checkbox, the text, the ✕), and children travel with childNodes. Anything
  bound to a row's own element is the thing to check when converting Timeline,
  Backlog and the Ledger.

  One consequence of `keepBody` worth knowing: a reused section whose body is
  no longer cleared shows the *previous* render's rows until its build() runs.
  Off-screen sections are built by the IntersectionObserver and the idle
  trickle within a second or two, so the window is short, and stale-but-present
  reads better than the blank a cleared body left. It does mean a deleted item
  can linger briefly in a section you cannot see.

- the section contract changed shape in 0.131.0: build() now takes the body
  element to fill, `build(bodyEl)`, instead of closing over the one it was
  created beside. This looks like a pointless parameter — it is the whole
  reason section reuse is possible.

  A section used to be built as a fresh block/head/grid trio with
  `build: () => { ...grid.appendChild(card) }` closing over that fresh grid.
  Reuse means keeping the *previous* render's node, so its build() would have
  been filling an element that had already been thrown away. Passing the body
  in lets renderLazySections hand it the surviving one.

  Two things fell out of this that are worth knowing before converting a view:

  renderLazySections reconciles by section key now, but every view still hands
  it a root that render() cleared on the way in, so reconcile finds an empty
  container and does exactly what the old append loop did. That is deliberate
  — it means this could land ahead of any view conversion. A view starts
  benefiting the moment it holds its root across a render, the way To-do does.

  reconcile() drops a remembered node whose parentNode is no longer the
  container. Without that guard, a container that someone else cleared (which
  is what render() still does to #viewBody) would have its old detached nodes
  re-inserted, resurrecting stale content. Note the guard is about the
  container being *emptied*, not about the container itself being detached: a
  whole subtree parked off-document is still internally intact, which is
  exactly what lets a view hold its root.

  `keepBody` on a section is the opt-out for a converted view:
  renderLazySections clears a reused body before build() refills it, which is
  right while build() appends, and wrong the moment build() reconciles.

- the rework's phase order was wrong, and this is where it was corrected.
  render() dropping `#viewBody.innerHTML = ""` was planned as the keystone
  every view conversion would build on. It is actually the *last* step, not
  the first: views append a mix of things into that root (a toolbar, an empty
  state, a bulk bar, the section container) with no keys, and their build()
  closures pointed at fresh nodes. Nothing could reuse anything until each
  view owned its own subtree. So each view converts independently — To-do
  already has, via a root it holds across renders — and the clear comes out
  at the end, when nothing is left relying on it.

- To-do is the first view rendered through reconcile.js (0.130.0), and it went
  first because it is the smallest one whose interactions are the nastiest: a
  long-press that swaps every row for a different kind of row, and a drag that
  rearranges the DOM itself and only then asks for a render.

  Four things in there that will read as arbitrary from the outside:

  The card's header, its "Nothing here."/"All done." note and the done
  separator ride in the *same* keyed list as the rows, under reserved keys
  (__head, __note, __sep). The alternative was a wrapper element around just
  the rows, which would have meant new CSS for a shape that already works.
  Reserved keys keep the card's DOM exactly what it was. The Backlog's band
  separators want the same trick when that view converts.

  Open rows and done rows are keyed by the to-do's own id, not by which group
  they are in. That is the whole point of the release: ticking one is then a
  *move* across the separator rather than a delete above it and an insert
  below, so there is a surviving node to animate later.

  reordering is a per-panel epoch (reorderMode && open.length > 1), not a
  global one. A panel with one open row has nothing to reorder and keeps its
  nodes while its neighbours rebuild — which is correct, and is why a test
  asserting "everything rebuilt on long-press" would be wrong.

  todoRootEl is held across renders on purpose. app.js still clears #viewBody
  on its way through, and clearing a parent detaches these nodes without
  destroying them, so holding the reference and appending it again is what
  lets the whole subtree survive. That prop goes away when render() stops
  clearing; until then, removing it silently un-does this release.

  One rule the module now depends on: element-level listeners live in
  create(), never update(). update() works by adopting a freshly built node's
  contents and dropping that node, so a listener bound there would be bound to
  the discarded element and leak one per render.

- src/reconcile.js (0.129.0) is deliberately two halves in one file. diffKeys
  is pure — key lists in, ops out — so it runs under the existing Node
  harness, which has no DOM; reconcile() is the thin part that applies those
  ops with insertBefore. That split is why the interesting logic has tests at
  all, and it's worth keeping as views convert onto it.

  Three decisions in there that look arbitrary and aren't:

  Keys are item ids, never object identity. merge.js rebuilds every
  collection from a Set of ids on each sync (see the mergeCollection entry
  below), so the objects do not survive a reconciliation between two devices.
  Anything keyed on identity — a WeakMap of item to node, or a signals/proxy
  layer — would silently detach the first time two devices met. That is also
  the reason this is a reconciler and not fine-grained reactivity.

  The longest-increasing-subsequence pass isn't premature cleverness. It's
  what makes one row dragged to the front report as one move instead of five,
  and the animation layer drives straight off the op list, so a sloppier diff
  would animate the whole list for a one-row drag.

  The insert loop walks backwards and re-checks the live DOM
  (node.nextSibling !== anchor) rather than trusting its own recorded order.
  The to-do drag reorders rows under the finger with insertBefore and only
  then asks for a render, so the DOM is legitimately ahead of what the last
  reconcile recorded. Reading the DOM makes that self-correcting instead of a
  bug.

  Two rules callers have to know: element-level listeners belong in create(),
  which runs once per node, never in update(), which runs on every render —
  adopt() keeps the existing node and drops the freshly built one, taking its
  listeners with it. And a setting that changes a row's *shape* rather than
  its content has to go through `epoch`, or a reused node is the wrong node
  wearing the right data.

- #todoCatModal is the third add/edit-category modal (0.128.2) — the
  journal's, Finance's, and now this. It is deliberately the simplest of the
  three: a to-do category cascades to one collection, and there is no "Other"
  for orphaned to-dos to land in, so deleting one just clears the field and
  they fall into the general panel. TODO.md carries the note that these three
  want one parameterised modal; writing that abstraction across three modules
  mid-change was the riskier move, so this is a knowing third copy.
  buildCatFilter now picks between three (list, active set, edit handler)
  triples rather than two. Todos.wire() is split from Todos.init() for the
  same reason every other module splits them: init runs in the Node tests,
  which have no DOM.

- to-do categories are a third category collection, state.data.todoCategories
  (0.128.2), alongside the journal's and finance's, in COLLECTION_KEYS like
  both. They started out sharing the journal's list, which was wrong on its
  own terms: "Errands" says nothing about what you watched. normalize runs
  ensureCategories over the to-dos that carry a category, which both fills
  the list on first load and carries across the to-dos that briefly named a
  journal category. Unused ones aren't pruned — pruning on load is a write
  that two devices can disagree about, and an unused category costs a line in
  a picker and no panel at all.
  Creating one from a picker needed a re-render, not just a push: the select's
  options are built when it is, so it has no option to select for a category
  that didn't exist a moment ago, and the value silently fell back to "".

- the reorder slide is FLIP (slideDisplaced, todos.js, 0.128.2): measure
  every row's top, do the insertBefore, put the moved ones back where they
  were with a transform, then release it and let CSS carry them home. Two
  requestAnimationFrames before releasing, not one — in a single frame the
  style change coalesces with the move and nothing animates at all. The
  dragged row is excluded on purpose: it is the one under the finger, and
  animating it would be lying about where it is. The transition is .17s
  because it has to finish before the finger reaches the next neighbour's
  midpoint.

- a `<select>` swapped in on click has to be told to open (catChip, 0.128.2).
  focus() alone leaves it shut on both desktop and phone, so the category dot
  read as a control that did nothing until you clicked it a second time;
  showPicker() in a try/catch is the whole fix, and where it isn't available
  the focused select is exactly where this started.

- the to-do long-press could never have fired (fixed 0.128.1). Its
  pointerdown skipped `.todo-text, .todo-check, .todo-del` "so the text can
  still be long-pressed to select or copy" — but a row *is* a checkbox, its
  text and a ✕, so every press hit an exemption and only the few pixels of
  row padding were live. The exemption list is the two controls now, and
  .todo-row carries user-select: none so a held finger doesn't start a
  selection instead. Worth remembering as a shape: an opt-out list that
  covers every child is an opt-out of the whole feature.

- to-do panels are per category, each with its own completed tail
  (panelGroups + panel in todos.js, 0.128.1). Two things that needed care:
  `order` is one field across every panel, so commitOrder deals the dragged
  panel's *existing* order values back out in the new sequence rather than
  renumbering 0..n, which would collide with another panel's; and the
  completed rows are left out of the card while it is being reordered,
  because the drag walks .todo-row midpoints and a finished row would be a
  place to drop something that then can't hold where it was dropped.
  A to-do naming a category the app no longer has still gets a panel — the
  alternative is a to-do that exists but is on no screen.

- the wheel draws its own palette, not CATEGORY_PALETTE (0.128.0). That ramp
  runs deep red to pale lime and is built for a 10px dot beside a name;
  eight filled wedges of it read as a fairground prize wheel dropped into a
  quiet dark app, and its lightness range meant the label ink flipped between
  black and white slice to slice. OWN_COLORS in wheel.js is one family at a
  shared lightness — every one dark enough for white type, so the labels stop
  flickering between inks. Backlog spins still pass their own colours, which
  carry category meaning. The wheel is a ring, not a pie: the hub used to sit
  on the point where every wedge meets, which is the busiest part of the
  drawing and the one place no label can go.

- MODE_MIGRATIONS in app.js (0.128.0) is the mode-level twin of
  UI_MIGRATIONS: `backlog.category -> entries`. Without it the stored value
  fails the modeIds check and the view falls back to its first mode — the
  same screen here, so it would have looked correct by luck rather than on
  purpose, and the next rename would not be so lucky.

- the Journal / Finance grouping is gone entirely (0.127.2), markup
  included. It survived one version as two `.tab-group-label` spans that the
  phone block restyled into a 1px divider, which is why the desktop rule read
  `display: none` rather than the elements simply not existing. At four tabs
  split three and one there was nothing left to group.

- #modeSlot moved inside #content, under the filterbar (0.127.1). It was
  chrome above the filters for one reason: it held the mode switch, and the
  switch decided which chips showed, so a press moved it ~100px out from
  under the pointer. With the switch on the tab, what's left in the slot (the
  Notes count, the Backlog's Spin and Pick random) changes no filters, so it
  can sit where it belongs — under the chips, above the list, travelling with
  the mode it describes. placeFilterbar inserts the filterbar before the
  slot, not before #viewBody, or Notes would put its count above its years.

- `.backlog-mode-bar > :only-child { margin-left: auto }` (0.127.1): the bar
  is space-between, which held the switch at one end and the Pick random /
  waiting count at the other. With the switch gone to the tab, the survivor
  is usually the bar's only child, and space-between puts a lone child at the
  *start* — so everything silently moved left. Discover is the exception that
  still has two children, and it is the position the others are matching.
  🎡 Spin joined Pick random there and left the + menu; the wheel's custom
  mode (openWheel({custom:true}), the Edit button, loadSaved) has no caller
  now — dead until it is given a home or removed.

- the mode switch is on the tab on both layouts (0.127.0): held on a phone
  (openModeFan), hovered on a desktop (openTabMenu). Nothing above the
  content any more — the slot keeps only what isn't the switch, which is the
  Notes count and the Backlog's Pick random. Three things this needed:
  the tab menu is appended to the .tab, not to #viewTabs, because .tab is
  the positioned ancestor and `min-width: 100%` against the nav made every
  menu span the whole bar; both the menu and the fan measure themselves after
  append and pull back inside the window, since an edge tab would otherwise
  push half a label off screen; and the phone's .topbar had to go to
  z-index 40, not the bottom bar inside it — z-index: 20 on .topbar makes it
  a stacking context, so the fan could not paint over .fab-wrap (35) no
  matter what value the fan itself carried. That one only showed up in a
  screenshot; every declared z-index looked right.
  The fan lists the tab's own mode as well now, nearest the thumb, so the
  shortest slide gives what a plain tap would have.

- four tabs, each pairing a list with a second reading of it (0.126.0):
  Notes/To-do, Timeline/Stats, Backlog's three, Ledger/Summary. Stats and
  Summary were tabs of their own, but render() already read
  `const entries = getFiltered(); … renderTimeline(c, entries) : renderStats(c,
  entries)` — same filtered set, same chips, same empty states, differing in
  the final call. They were modes wearing tab buttons, so merging them was
  mostly deleting an `if`. Notes/To-do went the other way for the same
  reason: separate collections that carry no category, so Timeline's filter
  bar appeared and disappeared as you swiped its modes. Now each tab's chrome
  holds still across its own modes. It also makes the fan and the dots
  universal rather than a gesture that works on two tabs out of five — and
  gives Stats and Summary a swipe from the list they aggregate, which is the
  whole point of them.
  The cost, taken knowingly: Stats and Summary are a second tap rather than a
  first. The migration in applySavedUi is the part that could have bitten —
  `state.view` came straight off a stored string with no validation, so the
  old "stats"/"finance-stats"/timelineMode:"notes" values had to become
  (view, mode) pairs or those devices would have reopened onto nothing.

- switchToView resets the mode of the view it is leaving, and is the only
  place that does. The dots under an inactive tab are a promise about what
  tapping it does, and a remembered mode broke that promise: Backlog's dots
  said Next releases while a tap landed in By category. Resetting on the way
  out rather than on the way in is what lets activateTab stay a plain
  switchToView, and leaves the fan alone — the fan sets the mode of the view
  it is switching *into*, which this never touches. The cost, taken
  knowingly: an inactive tab's dots now only say how many modes it has.

- a tab press has three meanings, resolved in one place (activateTab /
  stepMode / the .tab onclick, app.js): another tab is that view in its own
  mode; the current tab scrolled down is back to the top; the current tab
  already at the top is the next mode. The third only exists because the
  second had nothing to do there. stepMode wraps where a swipe doesn't — a
  swipe has a direction, so its ends are ends, but a tap has none and would
  go dead on the last mode, which is exactly where you'd tap again.

- the mode dots under a tab are absolutely positioned, not another row in
  its flex column (.tab-modes, styles.css). The tabs stretch to a shared
  height and each centres its own contents, so an extra row in flow on two
  tabs out of five lifted their icon and label out of line with the other
  three — measured, not guessed. They take currentColor, which is what makes
  an inactive tab state its mode quietly and the active one state it in the
  accent, with no second rule. Built on every layout by updateTabModeDots
  and hidden by CSS off the phone, so toggling the forced layout can't leave
  a stale row behind.

- the fan carries the tab's view, not just its mode spec (closeModeFan,
  app.js). Long-pressing a tab you aren't on is ordinary, and the pick has
  to switch views as well as set the mode — commitModeChange alone rerenders
  wherever you already were. Its sibling: fanConsumedClick is cleared on the
  next pointerdown rather than only when a click arrives, because a release
  on a fan item is a release off the tab and synthesises no click at all, so
  the flag latched and swallowed the next real tap.

- the phone's mode switch is a fan off the tab bar, not a row on the page
  (openModeFan/armModeFanAt/closeModeFan, app.js). A long-press on the tab
  raises the other modes above it; a slide arms whichever one is under the
  finger via elementFromPoint, and release takes it. Four things this had to
  get right: the fan is appended to #topbarBottom rather than the tab row,
  so it clears the jump-nav strip instead of landing on it; the pointerup
  that ends a long-press is followed by a synthesised click on the tab, so
  fanConsumedClick swallows exactly one; the move/up listeners live on
  window, registered once outside the per-tab loop, because the finger
  leaves the tab as soon as the fan is up; and .views went from
  touch-action: pan-y to none, since the upward slide would otherwise be
  handed to the browser as a scroll. renderTimelineModeBar and
  renderBacklogModeBar return early on a phone rather than the CSS hiding
  them, so the same control is never built twice.

- the mode switch lives in #modeSlot, chrome between the topbar and the
  filterbar, rather than in #content. The filters are a consequence of the
  mode (categories and years hide themselves in Notes and To-do), so a
  switch below them moved 201 -> 125 -> 100px as you pressed it — measured,
  not guessed. Both Timeline and Backlog render their whole bar into the
  slot, Backlog's extras included; app.js clears it each render and hides it
  for a view with no modes. It also simplified the animation: with the bar
  outside #content, a mode change animates #content whole, exactly like a
  view change, instead of per-child-except-the-bar.

- the swipe drags #content with the finger (modeDragMove/Settle/Commit,
  app.js) rather than animating after release — the page sitting still
  through the gesture and then moving on its own read as two movements
  where the hand made one. Commit carries on in the same direction for
  130ms, then --mode-enter-x tells the incoming keyframes to start from
  where the outgoing content left the screen, so the halves join up. A
  button press leaves that property unset and gets the small 16px default:
  there was no travel to continue. The property is cleared on animationend
  so a swipe can't leak its distance into the next button press.
  Resistance past the last mode is 0.25 rather than a hard stop, and the
  commit threshold is 60px rather than the tab bar's 40 — this shares a
  surface with the page's own scrolling.

- the mode-change animation reads its direction from the mode indices
  (fadeInOnViewChange, app.js) rather than being told which way it went, so
  a swipe, a tap on the switch and the Backlog's own bar all animate
  correctly without any of them knowing the animation exists.
  It's applied per child of #content, skipping .backlog-mode-bar: the bar
  lives inside #content, and animating the container would slide the switch
  out from under the finger that just pressed it. That also means it has to
  run after the content exists, which is why it's a pending class played in
  render()'s finally rather than done in fadeInOnViewChange itself — and why
  it re-reads $("#content") there, since the `c` above is scoped to the try.

- body has overflow-x: clip because the mode slide translates #content
  sideways, and content past the right edge makes the *document* wider than
  the viewport: the page becomes horizontally scrollable, the layout
  viewport grows, and the fixed bottom bar — which is sized to that viewport
  — grows and shifts with it. Measured at 395px wide on a 390px screen
  mid-animation. `clip`, not `hidden`: hidden would make body a scroll
  container and every sticky year/month header in the app sticks through
  here.
  Only reproducible with real touch events (CDP Input.dispatchTouchEvent)
  and a screenshot — getBoundingClientRect on a mouse-driven drag showed
  nothing wrong, which cost two rounds of chasing the wrong thing.

- render()'s `inPlace` is view *and* mode: a mode change is a new page, not
  an in-place re-render, so it must not restore the scroll offset. It used
  to, and the offset meant nothing in the new mode — the browser clamped it
  to whatever fitted, which landed differently every time depending on the
  two modes' heights, so the page appeared to lurch under the fixed bars by
  a different amount each switch. It also no longer *leans* on that clamp
  for landing at the top: a non-in-place render scrolls to 0 explicitly,
  because the clamp stopped being reliable the moment #content had a
  min-height and a filterbar of its own to stand on.
  Worth remembering that "the navbar jumps" was the symptom and the scroll
  restore was the cause; the jump-nav's height change is a real but separate
  thing, and chasing it first cost a round trip.

- where the filterbar lives is decided per view by placeFilterbar()
  (0.126.1); #viewBody is the thing a render actually clears either way. It
  went inside #content in 0.123.0 because Timeline's chips changed between
  its modes, so a bar outside would have sat still while everything it
  filtered slid sideways. The four-tab layout took that reason away
  everywhere but Notes: Timeline, the Backlog and the Ledger each filter
  both their modes by the same things, so sliding those chips was movement
  that said nothing. Notes keeps it inside (chipsVaryByMode on its spec) —
  its years come from the notes and To-do has no chips at all.
  Two specificity traps in doing it, both from the phone rules being
  `html:not(.force-pc) .content`, which outranks a bare second class: both
  `.content.no-filters` and `.filter-slot:empty` needed phone-scoped twins or
  the padding stayed and the gap doubled. The mode swipe is attached to the
  slot as well as #content, so a drag starting on the chips still moves the
  view behind them.
  Its own visibility is JS (updateFilterbarVisibility) rather than a :has()
  rule; nothing else here leans on :has(), and both builders can be the one
  that empties it.

- timeline entries sort byNewestAdded within a month (journal.js), matching
  the Ledger. They previously had no explicit order, which looked stable —
  new entries are pushed to the end — right up until a sync, because
  merge.js rebuilds each collection from a Set of ids and reshuffled the
  month. Same reasoning as the finance rows' createdAt tiebreaker, and the
  same trap: array order is never durable in this app.

- to-do hand ordering is an `order` field, not array position: a sync merge
  rebuilds every collection from an id set (mergeCollection), so array order
  doesn't survive a round trip between devices. assignMissingOrder runs in
  normalize and numbers anything from before the field by createdAt — the
  order it was already displayed in, and a pure function of the data, so two
  devices deriving it independently can't manufacture a conflict.
  commitOrder renumbers sequentially from the DOM rather than fractionally.
  It marks every moved row changed instead of one; on a list this size
  that's a few hundred bytes of sync against a whole class of
  drifting-float bugs.
  The drag listens on `window`, deliberately not via setPointerCapture on
  the row: insertBefore *moves* the row, which counts as a removal, and a
  captured element that leaves the DOM loses its capture. The first version
  did capture and the list shuffled by exactly one position and then went
  dead — pointerup landed somewhere else and nothing was ever saved. It
  looked like a geometry bug for a while; it wasn't.

- To-do (src/todos.js) is the Notes tab's second mode (it was Timeline's
  third until 0.126.0), and deliberately not part
  of Backlog: a backlog item is something you mean to experience and it
  graduates into the log when you finish it, while a to-do is ticked and
  stops mattering. Different endings, different lists.
  `done` is dropped rather than stored as false, like every other flag.
  doneAt is separate from createdAt because the Done panel sorts by when you
  ticked it — a to-do written first is easily finished last — and a to-do
  ticked before doneAt existed falls back to its own updatedAt so it still
  sorts somewhere. Editing is inline rather than a modal: a to-do is one
  line, and a modal to fix a typo in one line is more ceremony than the line
  is worth. An emptied edit box is a cancel, not a delete; deleting is the ✕,
  which skips the confirm because Settings → Recently deleted has it.

- swipe-between-modes (attachSwipe's requireHorizontal, app.js) shares a
  surface with the page's own vertical scrolling, which is why the gesture
  has to prove it's horizontal *before* it takes the pointer — capturing on
  any movement, as the tab-bar swipe does, would swallow the scroll. A
  gesture that starts vertical is abandoned outright rather than watched: a
  scroll that drifts sideways halfway down the page is still a scroll.
  Three things had to be true for it to work, and only the first is obvious:
    - touch-action: pan-y on .content, or the browser claims the gesture and
      the swipe fires only by accident;
    - the selection is cleared when a swipe is recognised — a drag across
      text leaves one behind, and the next pointerdown landing on it is a
      drag of *that*, which ate every second swipe;
    - .content has a min-height, because the handler is on .content and on a
      short view (empty To-do, a Discover card 300px tall) a swipe in the
      lower half of the screen was landing on <html> and doing nothing.
  VIEW_MODES reads Backlog.MODE_IDS rather than restating the backlog's mode
  list, so a swipe and its own bar can't disagree about what comes next.
  No wrap at the ends, matching the tab swipe.

- Notes (src/notes.js) started as Timeline's second mode, on the reasoning
  that the phone's bottom nav was full — the same reason Discover became a
  mode of Backlog. 0.126.0 gave it a tab of its own once Stats and Summary
  freed two slots; see the entry on the four-tab layout for why that pairing
  was wrong. The mode bar is still rendered by app.js *before* any mode
  draws, because a view's empty state returns early — drawn inside it, the
  switch would strand a new user in a mode with no way out.
  editedAt is deliberately not updatedAt: stampChangedItems touches
  updatedAt on any content change at all, so "edited" would start meaning
  "a migration ran". saveNoteFromForm sets editedAt only when the text
  actually differs, so reopening a note and pressing Save leaves it alone.
  noteDate falls back from createdAt to updatedAt because a hand-edited or
  badly imported note still has to land in a year rather than vanish.
  `notes` in COLLECTION_KEYS is what buys merge, conflict resolution and
  undelete; there is no notes-specific sync code at all.
  The category chips are hidden in this mode via .filter-group[hidden],
  which has to be said explicitly — .filter-group sets display:flex, and
  that outranks the UA stylesheet's [hidden] rule. Caught in the browser,
  not by a test.
  No bulk select and no per-month "+": a note is stamped with the moment
  it's written, so there's no such thing as adding one to March.

- Early Access, off Steam's genre id 70 (steamEarlyAccess in media.js) — a
  genre, not a flag, and matched by id because `description` is localized.
  Its *absence* is the meaningful half: Steam removes the marker at 1.0, so
  mergeRelease lets a later source drop the key and applyItemRelease (sync.js)
  turns a dropped key into a deleted field, which is what makes the flag
  clear itself. Requires the proxy to ask for `genres` — an older deploy
  states nothing either way, which steamEarlyAccess returns as {} rather
  than false so it can't wrongly clear a flag.
  Early Access items were added to the re-check set in sync.js but
  deliberately not to isAwaitingRelease: they'd land in Next Releases with
  no 1.0 date to sort or group them by.
  They also get their own band in bandOf, between released and unreleased.
  An EA game whose EA launch is still ahead of it stays in the unreleased
  band — isUnreleased is checked first, since you can't start that one
  today either. backlogCountEl splits into the same bands in the same order
  (dropped, then unreleased, then EA off what's left), so nothing lands in
  two asides at once.

- data.appVersion is the newest build that has ever written the file —
  maxVersion in merge.js, raised in persist() and carried across
  mergeAllSources (which builds a fresh object, so a root key not copied
  there is a root key lost). versionBehind() in app.js compares it to
  APP_VERSION; the storage line says so for as long as it's true and
  noticeVersionSkew toasts once per version noticed.
  Deliberately advisory: it refuses no load, drops no merge and blocks no
  save. keepUnknown is what actually protects the data now, so the guard's
  only job is telling you a device needs updating. A blocking mode would
  have to be worth losing offline edits for, and it isn't.
  compareVersions parses parts as numbers because "0.9.0" sorts above
  "0.116.0" as a string, and treats junk as 0 so a hand-edited file can't
  claim to be from the future and lock a device out of its own warning.

- every sanitizer now ends in keepUnknown (app.js): the whitelists stay, but
  anything they don't name is copied through instead of dropped. They were
  the reason a phone left on a cached older build deleted the earlyAccess
  flags — and mergeCollection compares content, not timestamps, so that
  deletion won on every device. Only protects fields added from 0.116.0 on;
  nothing can retroactively teach an older build about a newer field, which
  is what the version guard below is for.

- the service worker's update is announced rather than waited for:
  watchForUpdate (app.js) listens for a worker reaching `installed` while
  another already controls the page — an update, not a first install — and
  shows #updateBar. By then the new shell is already cached, so a plain
  location.reload() picks it up. Deliberately never automatic.

- Discover's Early Access badge costs two requests per title (RAWG's store
  links, then Steam's genres), so it's cached per RAWG slug for a week in
  lifelog-discover-ea-v1 and only runs for rawg-steam-gg with a proxy set.
  A game with no Steam page is cached as `false` on purpose — without that
  every repaint would re-ask a question that has no answer. Only the
  *visible* rows are enriched: a title you already own is filtered out, and
  asking about it would buy a badge nobody sees.

- releaseStateOf (backlog.js) is the single answer to "what state is this
  in": ready / early-access / waiting. bandOf, backlogCountEl and
  eligibleForPick all read it instead of each asking their own version —
  which is how an announced show with only a nextAt ended up in the ready
  band while the header counted it unreleased. isAwaitingRelease stays
  separate on purpose: "worth re-asking" is a different question from "can
  I start it", and a mid-season show answers them differently.

- the category header wraps the count onto a second line rather than
  ellipsing the name. Dot and name live in .backlog-section-title so the dot
  can't wrap away from the name when that happens; the floor that triggers
  the wrap is .backlog-section-title's min-width.

- Discover's "you already have this" check compares titleKey(), a new pure
  helper in media.js: case/accents/punctuation/spacing/& folded away, "3rd
  Season" folded into "Season 3", and a trailing season/book/part marker
  turned into a *number* rather than dropped — no marker counting as 1, so
  "Attack on Titan S1" keys the same as "Attack on Titan" while "Slime
  Season 4" keys differently from "Slime". That last part is the whole
  point and is easy to get wrong: stripMediaSearchSuffix in journal.js drops
  the number, which is right for feeding a search and would be wrong here,
  since an owned first season would then hide an unseen fourth. Tested in
  test/media.test.js (6 cases, including the differ() ones).
  The owned set is built once per render (discoverOwnedIndex) rather than
  rescanned per row.

- Discover draws a card only where there is something in it or something the
  reader can act on: discoverSourceMap's second map is `needsKey` (sources a
  RAWG key away from a list) rather than "everything that can't answer".
  Open Library / Google Books / MusicBrainz fall out of both maps and get no
  card — there is nothing to be done about books having no charts, so the
  note was pure clutter. The all-empty message had to change with it: a
  source can now be set and still produce nothing

- Discover covers every category that has a source set, not just the ones
  that can answer. discoverSourceMap returns two maps — the sources with a
  list, and the configured ones without — so an unsupported source gets a
  card explaining itself instead of silently not being there. DISCOVER_STANDIN
  maps steamgriddb/steamgriddb-steam-gg/steam onto RAWG when a RAWG key is
  set, carrying the "-steam-gg" tail over so an added game still resolves to
  a Steam App ID and still gets its price

- "Hide what I have" (state.visual.discoverHideOwned, device-local) filters
  Discover rows through the same discoverOwnedTag test the tag uses, so the
  two can't disagree, and reports the count it dropped

- the kind bar's toggle and Refresh live in one .dsc-bar-right group: the bar
  is justify-content:space-between, and hanging a third item off margin-left
  auto pushed Refresh off the edge of a phone instead of wrapping

- RAWG could not be reached from the dev sandbox at all (api.rawg.io fails
  DNS/CORS there while TMDB, AniList and Open Library are fine), so the RAWG
  discover URLs — /api/games with dates + ordering=-added — are written from
  the docs and have never run against the live API. TMDB and AniList are
  confirmed working. If a RAWG-backed card ever comes back empty with a key
  set, that URL is the first thing to check

- Discover is the Backlog's third mode: per-source "Popular now" / "Coming
  soon" lists, driven off mediaCategorySources so there's no second place to
  configure sources. media.js grew a `discover(source, kind, keys)` beside
  `search`, returning the same normalized rows — which is what lets an added
  row go through applyMediaResult, the block extracted out of
  syncBacklogTitle's callback, so a discovered title gets the same identity
  resolution, the same details second call and the same respect for pinned
  fields as a searched one. The four search result mappers were extracted
  (mapRawgResult/mapTmdbResult/mapAniListResult/mapJikanResult) and the
  AniList field selection pulled into ANILIST_FIELDS, so a discover query
  can't drift from the search one and hand back a half-filled row.
  Answers cache in localStorage for 6h under lifelog-discover-v1, device
  local. discoverRuns doubles as the "already asked" set, which is what
  stops render→ensureDiscover→render looping; the cache-hit branch has to
  schedule a repaint of its own, or a warm load sits on "Loading…" forever
  over a full set of rows.

- the NYT Books API (free key, bestseller lists) is the only candidate that
  would give Discover a "hot books" list. Another key to set up. Why the
  other book/music sources can't: see DROPPED.md

- a backlog card's meta line fills the release slot for an item still ahead
  of you: yearOf first (so a bare releaseDate still yields its year), then
  "TBA" when isUnreleased says it's coming but nothing dates it. An item with
  no release info at all and no upcoming status stays blank on purpose —
  that's an unknown rather than a TBA. setBacklogCover now passes
  releaseDate/releasePrecision/releaseStatus into appendBacklogMeta too,
  since it builds its synthetic item from the live form fields and was
  leaving the release trio out, so the modal and the list row disagreed

- a backlog category card's count splits into "12 (+7 unreleased)" via
  backlogCountEl, gated on state.visual.backlogCounts (Settings → Appearance,
  device-local, defaults to "split"). It reuses notOutYet — the random pick's
  own "can't start it yet" test — rather than isUnreleased, so the two views
  can't disagree about what's waiting, and it falls back to the plain total
  when everything or nothing in a category is pending, since the split would
  otherwise say the same number twice

- the topbar's search wrapper takes flex-basis 0 on mobile, not auto: a flex
  row picks what wraps from hypothetical sizes before it shrinks anything, so
  a basis of "as wide as the input wants" put the ⚙ on a second row as soon
  as the ✕'s padding widened the field. Worth remembering if anything else
  is ever added to that row

- the Steam App ID field is available for every category, not just the ones
  whose source is "steam". It's one node that moves: #b/#fSteamTop in the
  form for a Steam category (where the App ID is the item's whole identity)
  and #b/#fSteamAdv inside Advanced everywhere else, swapped by
  updateSyncBtnVisibility. Two slots rather than two fields, so there's
  still one input, one id and one applySteamAppId wiring to keep straight

- picking a title you already have now copies every media field, via
  fillMediaFields — the mirror of clearMediaFields, walking the same
  MEDIA_FIELD_IDS list and honouring the same pins (each id is its item key
  with "#b" cut off). It used to set cover/mediaId/mediaSource/genres by
  hand and drop rating, release, length and summary on the floor

- Next Releases splits the old "No date yet" card: a card per year for the
  ones narrowed no further than that (yearOf), then a last card for the ones
  with nothing announced at all

- the search box's ✕ is ours (.search-clear over a .search-wrap) rather than
  ::-webkit-search-cancel-button, which Chrome only draws while the field
  has focus and can't be talked out of it from author CSS. The mobile
  layout rules moved from .search to .search-wrap, since the wrapper is what
  the topbar lays out now

- the entry form's "Started month" explainer paragraph is gone; the labelled
  pair and its "— none —" default carry it

- the random pick's scope strip has a "Bought only" switch next to
  "Favorites only". Both are one `&&` clause each in pickCandidates(), which
  is the single place a draw is narrowed — the reroll, the empty-state card
  and the wheel all read from it, so nothing else had to learn about the new
  switch. The empty-state line now names whichever switches are on
  ("Nothing in the categories you have on is starred and already bought"),
  with no-categories-at-all still taking precedence since that's the thing
  to fix first. `.pick-fav` became `.pick-scope-toggle` now that two of them
  share the row

- the app's checkboxes and scrollbars are its own now, drawn from the same
  tokens as everything else rather than by the OS. The checkbox is a single
  global `input[type="checkbox"]` rule — the per-screen width/height/
  accent-color declarations that used to disagree by a pixel are gone, and
  the full-width rules for text fields (`.modal label input`, `.ovr input`)
  exclude it rather than being undone by an `!important` further down. The
  tick is a clipped block, not a background SVG, so it can take
  `--text-on-accent` and stay legible on Nord's and Dracula's pale accents.
  A partly-selected "select all" header now sets `.indeterminate` (three
  sites: the month card header, and the backlog's category and upcoming
  sections), which is what the tri-state bar is for.
  Scrollbars are `::-webkit-scrollbar` on Chromium/Safari with the standard
  `scrollbar-width`/`-color` handed only to Firefox: Chromium drops every
  `::-webkit-` rule the moment `scrollbar-width` isn't `auto`, so the two
  can't both be declared. Both sit behind `(hover: hover) and (pointer:
  fine)` — asking for a width on a touch browser converts its transient
  overlay bar into a permanent one that eats layout width
  (0.110.1: the global rule needs an `input[type="checkbox"][hidden]`
  companion — an author `display` outranks the UA stylesheet’s
  `[hidden] { display: none }`, which surfaced the three state-holding
  checkboxes behind the backlog modal’s ★/✓/dropped buttons)

- a backlog item can be marked "already bought", which puts a green ✓ beside
  the title and, on a starred item, floats it to the top of its category's
  starred block. The flag is independent of the star (it shipped tied to it
  in 0.107.0 and came loose again in 0.108.0), but the *ordering* is not:
  compareBacklog only reads `bought` inside band 0, so marking an unstarred
  item doesn't quietly promote it up a list you never asked to reorder.
  The inline sort comparator in renderBacklog's build came out as
  compareBacklog() so that rule is testable rather than trapped in a closure

- a bought item says "Bought" in the slot its price occupied, and doesn't
  get a price fetched. Both gates are single points: appendBacklogMeta
  builds every .bl-price span in the app and returns whether it made one
  (so its callers skip the lookup), and loadBacklogPrices filters `bought`
  out of the batched per-category fetch the list kicks off. The two layouts
  with no metadata line of their own — the plain row and Next Releases —
  get the word beside the title instead, via boughtTag(). The GG.deals
  *link* is deliberately left alone: it's a store link like the Steam one,
  not a price

- SteamGridDB picks cross-fill their rating, length, genres and description
  from RAWG by title, so a game off it no longer lands bare. The extra
  request is really two — RAWG's search has no description, only its
  per-game endpoint does — so the second one is spent only when nothing
  better is coming: resolveMediaIdentity now runs *before* fetchDetails at
  both pick sites, and a steamgriddb-steam-gg pick that resolves to a Steam
  App ID says wantSummary:false, since Steam's own store blurb is already
  on its way and wins anyway. RAWG's date is deliberately dropped (it dates
  by earliest platform release, SGDB dates the entry you picked).
  The journal gets the same treatment: media.js's fetchLength returned a
  bare string and threw away the genres the same RAWG search had already
  fetched, so a SteamGridDB-synced timeline entry went into the Stats
  "Genres" card counting for nothing. Replaced by fetchEntryExtras, which
  returns { length, genres } — the two fields a timeline entry actually
  has, still off one request, and still skipping RAWG outright since its
  search already stated both

- the README's feature list had stopped at Timeline/By Category/Stats/
  Filters, and its project layout named four files out of fourteen —
  rewritten against what the app actually does now

- test/app.test.js had been dead since the wheel landed: app.js calls
  Wheel.init() at its top level and the test stubbed every other module
  but that one, so the file threw on require before its first assertion
  and run-all.js had been reporting a red suite

- a random wheel, in the + menu and beside the Backlog's random pick. Feed
  it your own options (kept on the device) or let the picker feed it the
  titles it was about to draw — either way the spin is only the reveal: the
  winner is drawn first and the animation aimed at it, so the odds stay flat
  however the easing lands. Twelve slices max, since more than that stops
  being readable at phone width

- backlog picks come out of a bag instead of a fresh coin flip each reroll,
  so nothing repeats until everything in scope has had a turn, and the bag
  carries a device-local memory of what it drew last time so a fresh sitting
  doesn't lead with last night's rejects

- games were the only backlog items that never got a description, and the
  metascore/length on the ones that did have data came and went: RAWG's
  search endpoint has no description at all, and its `metacritic`/`playtime`
  are null and 0 for anything unreviewed or unplayed. Added a per-game RAWG
  details call on pick (the games' fetchTmdbDetails), read Steam's own
  short_description wherever an App ID is known, stopped every sync path
  from blanking a description it had nothing to replace with, and put a
  show/hide switch for descriptions in the backlog list under Appearance

- starred backlog items were sorted below the released/unreleased split, so
  starring an unreleased item pushed it into the upcoming block instead of up
  with the other starred ones. Replaced the ad-hoc separator bookkeeping in
  renderBacklog's build with a single bandOf() (starred / ready / upcoming /
  dropped) driving both the sort and the separators — the old three-flag
  version could also emit two separators at one boundary when a category was
  missing a middle band.

- per-item sync overrides + store links without a cover. The links lived in
  an overlay inside the cover block, so anything without artwork (or with a
  cover URL that 404s, which hides the block via onerror) lost them; they now
  fall back to a row under the modal title, metadata included. The Advanced
  foldout stores `overrides: { release: true, … }` on the item and every sync
  path checks it — the two in-modal ones read the checkboxes directly, the
  bulk syncs and the 🔭 re-check read the saved item. The generic pull/push
  plumbing is in app.js; each modal supplies its own field spec so compound
  fields (a release date is a date + precision + status + year behind one
  tick) stay next to the parsing they need.


- game release dates, three holes at once. (1) searchSteamGridDB never read
  the `release_date` SGDB returns on every search hit, so every SteamGridDB
  match landed with no date and no year — releaseFromSgdb() now parses it,
  defensively (unix seconds, a milliseconds value, or a plain string; anything
  else is tba rather than a 1970 release). (2) A game that resolves to a Steam
  App ID now takes Steam's own date via appdetails: RAWG dates by *earliest
  platform*, which is where the wrong years came from, and Steam is the only
  one of the three that admits to "Q1 2026" instead of inventing a day.
  resolveMediaIdentity returns it as `release` and the backlog merges it last
  so it wins ties; the journal ignores it (an entry is dated by when you
  finished the thing). (3) fetchRelease now handles steamgriddb, so those
  items stop being skipped by the 🔭 re-check — needed a proxyUrl arg, since
  SGDB is CORS-blocked direct. fetchSteamGridDbSteamAppId and the new
  release lookup share one fetchSteamGridDbGame().

- tapping the active tab scrolls to top. It used to call switchToView with the
  view it was already on, and render() restores scroll on a same-view rebuild
  by design, so the tap was a visible no-op. Handled in the tab click handler
  rather than inside switchToView, which the swipe gesture also calls.

- "SteamGridDB + Steam + GG.deals" as its own source, mirroring the RAWG
  combo, + the same bulk-sync silent-failure fix. v0.99.5 had made *every*
  SteamGridDB match resolve an App ID, which left no way to ask for just the
  grid art — a combo source keyed "steamgriddb-steam-gg" is the shape this
  app already had for exactly this, so plain "steamgriddb" went back to being
  cover-art-only. Also dropped the fallback dropdown's exclusion of the combo
  sources: a fallback match wants an App ID as much as a primary one does,
  and excluding them meant a RAWG-primary/SGDB-fallback games setup quietly
  produced items with no price. Separately, both bulk syncs now wrap their
  loop in try/catch — a throw used to leave the button disabled and the bar
  untouched, which is indistinguishable from a button that does nothing
  (which is exactly how it was reported).

- a SteamGridDB pick now resolves a Steam App ID, like the RAWG combo source
  already did. SGDB's game id drives neither the store link nor GG.deals
  pricing (both key on the App ID), so a game matched through it landed with
  no price and a link to SGDB's own page. SGDB does know the mapping — the
  per-game endpoint returns it under external_platform_data given
  ?platformdata=steam (the proxy already relays query strings), so it's one
  extra request on the picked game only, not on every row in the list. Folded
  the four copies of the old `if (r.source === "rawg-steam-gg")` block into one
  resolveMediaIdentity(r, keys) that every pick path calls unconditionally, so
  a third source needing the same treatment is one branch, not four. Games
  with no Steam listing keep their plain SGDB identity, and the SGDB cover art
  is kept regardless — it's stored on the item, not derived from mediaSource.

- sync results render in arrival order — dropped the primary-first ordering
  added a version earlier. Holding a finished fallback back to preserve the
  order cost the whole difference between the two APIs whenever the primary was
  the slower one (measured: first result 2506ms → 259ms with a 2.5s primary and
  a 250ms fallback). streamMediaSuggestions now maps both sources through
  Promise.all and emits each batch in its own .then, so nothing waits its turn;
  the source tags are what keep an arrival-ordered list legible. The pending row
  became a Set of outstanding sources rather than a single "next" one, deduped
  by display name (tmdb-movie + tmdb-tv would otherwise read "TMDB, TMDB"), and
  narrows as each source answers. Rows are only ever appended above it, so
  nothing already on screen moves under the pointer mid-lookup.

- sync button latency — measured the real APIs first rather than guessing:
  AniList/Jikan/MusicBrainz ~250ms, Google Books ~670ms, Open Library ~2500ms.
  Two fixes. (1) Perceived: renderStreamedSuggestions now paints a "Searching
  <source>…" row synchronously, before anything is awaited, and puts the sync
  button in a .busy spin — previously the click had no visible effect at all
  until the first API answered. (2) Actual: streamMediaSuggestions fires the
  primary and fallback requests together instead of starting the fallback only
  after the primary resolved, so a lookup costs max(a,b) rather than a+b.
  Rendering order is unchanged (still strictly primary-first) — only the
  waiting overlaps. Measured with stubs at the real latencies: two typical
  sources 500ms → 264ms; fast primary + Open Library fallback 2750ms → 2507ms
  with the first result on screen at 260ms. Each request also gets its own
  .catch now, so one source failing no longer aborts the other (the old shared
  try/catch dropped both).

- sync button source labelling + streaming — the combined primary/fallback list
  (added v0.87.0) gave no way to tell the two sources apart, which matters
  because the pick sets mediaSource and that drives cover art, the source/store
  link buttons, and GG.deals pricing. makeMediaAcItem now tags each row with
  MEDIA_SOURCE_LABELS[r.source], right-aligned so row height is unchanged
  (added "rawg-steam-gg" to that map, which was missing). Deliberately no dedup
  across sources: SteamGridDB exists precisely to offer *different* art for a
  title RAWG also has, so collapsing them would remove the choice the combined
  list is for. Replaced the combineFallback flag with streamMediaSuggestions(),
  which emits one batch per source, plus renderStreamedSuggestions() shared by
  both Sync buttons — primary results paint immediately and an .ac-pending row
  holds the fallback's place, instead of the whole lookup waiting on the slower
  API. Extracted mediaSearchFor() as the shared setup, which also fixed a
  fallback set to the same source as the primary being searched twice. Bulk
  sync and the auto-checks still use fetchMediaSuggestions (fallback only when
  the primary is empty) and are untouched.

- next releases view — a second Backlog layout (`state.backlogMode`, remembered
  in the UI localStorage key next to `view`) rather than a sixth tab: same
  items either way, and the phone's bottom nav has no room. Grouped into one
  card per month keyed on upcomingAt() — the day the item is actually waiting
  on, which is the next episode for anything mid-season, so an airing show
  lands on next Tuesday rather than the year it premiered. isAwaitingRelease()
  is therefore broader than isUnreleased(): a released-but-airing show belongs
  here too, and sync.js's re-check uses the same predicate (a next-episode
  date is the fastest-staling thing in the app). Within a month, exact dates
  sort first in day order and coarser ones settle underneath, instead of
  interleaving at the arbitrary day their window opens; countdowns are only
  ever shown against a real day. Year-only/TBA items collect in a trailing "No
  date yet" card. Reuses .backlog-section/.backlog-grid, so the sticky headers
  and the mobile jump-nav carousel picked it up for free. Deliberately no bulk
  select here (read-only view; switching modes clears any selection). The dice
  button moved into the mode bar to keep one strip above the list rather than
  two. Follow-up ideas: a "notify me" / calendar export for a dated row; fold
  released-since-last-visit items into a "just out" card at the top

- release-date precision — every media source knows a different amount about a
  release, so items now carry `releasePrecision` (day/month/quarter/year/tba)
  next to `releaseDate`, plus `releaseStatus` ("upcoming"/"released") wherever
  a source states it outright, and `nextAt`/`nextLabel` for a currently-airing
  show's next episode. Precision is derived from the source's own shape, not
  sniffed from a string: AniList/Jikan expose nullable year/month/day parts,
  Steam's free-text date is parsed (parseSteamReleaseDate handles both day
  orderings, "Q1 2026", month-only, and the "Coming soon"/TBA placeholders),
  RAWG's `tba` flag overrides its Dec-31 placeholder date. isUnreleased() now
  reads "the last day the window could still be open hasn't passed", with an
  explicit status overruling the date entirely — which is what finally fixes a
  January release reading as upcoming until December. No migration: items
  saved before this re-derive their precision from the date's shape, which
  reproduces the old behavior exactly. mergeRelease() folds several sources
  together keeping the most precise date (Steam wishlist items are described
  by both Steam and a RAWG name match). Steam's appdetails `coming_soon` +
  `date` are now read in the same request that resolves the title, replacing
  the fuzzy RAWG-by-name date. Follow-up ideas: surface precision in the
  backlog row meta line ("Q1 2026" rather than just the year); let a manual
  edit set an approximate date without inventing a day

- re-check upcoming release dates — Settings → Media → Upcoming releases.
  Re-asks each still-unreleased backlog item's source by its stored media id
  (never by title, so nothing drifts onto a different work); RAWG/AniList get
  new by-id endpoints, TMDB reuses the details endpoint, Steam reuses
  appdetails. Sources with no id lookup worth making (Open Library, Google
  Books, MusicBrainz, Jikan) are skipped rather than title-searched. Only
  stamps updatedAt when something actually moved, so a no-op re-check leaves
  nothing for the GitHub sync to merge. Optional quiet auto-run on app open,
  paced per-device in localStorage like the Steam/AniList checks. Follow-up
  idea: a per-item "last checked" so a stale entry can be spotted

- pausing a recurring expense — new optional `rec.pauses`, a list of
  { from, to? } inclusive ranges. recurringOccurrences() marks occurrences
  inside one `paused: true` and rides them on the existing `skipped` flag, so
  every total/count downstream already excluded them with no changes. An
  absent `to` means "still paused" — the case a per-occurrence skip can't
  express, since those occurrences don't exist yet — and flips the tool button
  to "Resume now", which closes the range at yesterday. The schedule keeps its
  anchor day underneath, so resuming lands on the normal billing date rather
  than re-anchoring. normalizePauses() sorts/fuses overlapping and adjacent
  ranges (an open-ended one absorbs everything after it) and runs in
  sanitizeRecurring too, so an imported file can't carry a tangle. Pauses are
  clipped across a plan change instead of dropped, unlike overrides — a range
  doesn't need the schedule to land on it to mean something. The occurrence
  modal locks its skip checkbox on a paused date and refuses to read it, which
  would otherwise bake in a skip override that outlived the pause. Follow-up
  ideas: show paused stretches as gaps in the Summary trend; a "pause for N
  months" shortcut instead of picking the end date by hand

- fixed the two-date rows (start/stop, pause from/until) overflowing their
  modal by ~20px on a narrow phone — flex items default to min-width:auto and
  a native date input reports a wide intrinsic width, so neither would shrink;
  `.modal .row label` now sets min-width:0

- recurring expense plan changes — a recurring expense's terms can now change
  without rewriting what came before. "Change plan" splits the template: the
  old one gets an endDate the day before the change and keeps generating its
  history verbatim (including its overrides), a new one takes over from that
  date and links back via a new `prevId` field, and planChain() walks that
  link in both directions to render the Plan history strip. Overrides on/after
  the split move to the new plan only if its schedule still lands on that exact
  date — otherwise they're dropped and the count is reported, since an override
  for a date nothing generates is invisible. Also exposed the endDate the data
  model already supported as a "Stops on" field; added one-off → recurring
  ("Make recurring", prefilled from the entry, which is only removed once the
  template saves) and recurring → one-off ("Convert to entries"); split Delete
  off from that conversion so a mistakenly-added recurring expense can actually
  be removed; and listed ended/superseded plans in the recurring card so they
  stay reachable. splitRecurring/planChain/addDaysStr/nextOccurrenceDateAfter
  are pure and covered in finance.test.js. Follow-up ideas: show a plan change
  as a marker in the Summary trend; let a plan change also move the anchor day
  (it currently inherits the new start date's day, which is usually right)

- multi-month entries (Option A) — entries gained an optional startMonth/startYear
  ("Started" month + year in the add/edit sheet). When it's strictly before the
  anchor {year, month}, the Timeline row renders a faint span chip via a new pure
  spanLabel() helper ("Jun–Aug" same-year, "Nov 2024–Feb 2025" cross-year);
  otherwise nothing is stored/shown. sanitizeEntry validates + drops any
  missing/equal/after/out-of-range span so the rest of the app can trust the
  invariant. The entry still lives in one card and counts once — stats/heatmap/
  streaks/merge untouched. Added .espan chip CSS and journal.test.js coverage
  (retention, drop cases, cross-year, label formatting). CSV stays the lean
  summary it already was (JSON export carries the span). Follow-up ideas: a
  Stats surface for "longest spans"; optional span display in the backlog picker

- faster launches + clearer sync failures — the service worker now uses
  stale-while-revalidate for the app's own files (instant repeat load from
  cache, background refresh for next time; the ?v= query on scripts/styles
  keeps versioned assets fresh, HTML propagates within one extra load).
  Scripts load in parallel via `defer`. A 401/403 from GitHub (bad/expired/
  under-scoped token) now surfaces as a distinct red storage status —
  "GitHub rejected your token — saved to this browser only. Reconnect in
  Settings." — instead of the misleading "will sync when online" pending
  state, and the storage-status line is now clickable to open Settings → Data

- math in the Ledger amount fields — the Amount input in the finance entry,
  recurring expense, and per-occurrence override modals now accepts a basic
  arithmetic expression ("50-25", "12.5*3", "(10+5)/2") as well as a plain
  number. It auto-resolves to the result ~800ms after you stop typing (and on
  blur/submit), rounded to cents. Added a small CSP-safe recursive-descent
  evaluator (evalMathExpr) and a readAmount() helper in finance.js — no eval()/
  Function — plus a math-eval-flash highlight; the inputs became
  type="text" inputmode="decimal" so operators are typeable. Tests cover
  precedence, parentheses, incomplete/invalid input, and division by zero
- richer backlog random picker — the "🎲 Pick something for me" card now
  shows a ★ favorite marker (priority), the rating/year/length line, the
  GG.deals price (Steam items), the description/summary, genres, your own
  note, and the source/store link buttons (Steam · RAWG · TMDB · AniList · …
  plus GG.deals), instead of just title + cover. Factored the
  rating/price/summary block into a shared appendBacklogMeta() helper reused
  by the rich list row, the edit-modal cover, and the pick modal; the links
  reuse renderCoverLinkButtons in a standalone row so they show without a cover
- Settings → Media naming cleanup: pulled the proxy URL field out of the
  "Steam Wishlist import" section into its own "CORS proxy" heading at the
  top of Media sources, since SteamGridDB cover art, GG.deals prices, and
  the Steam Wishlist import all route through it (proxy/worker.js's
  /steamgriddb + /gg-deals routes). Reworded its explainer (incl. that
  future CORS-blocked sources will use it too), pointed the SteamGridDB /
  GG.deals key hints and the Steam Wishlist section at the shared proxy
  above, and updated the SteamGridDB "needs the proxy" error string. Kept
  `settings.steam.proxyUrl` as the storage key (id unchanged) — pure
  UI/labeling, no schema change
- Ledger Summary insights — a "Highlights" card (real avg spend per active
  month, biggest month, top category, this-year-vs-last delta) and a "Spend
  trend" card charting the last up-to-12 calendar months on one continuous
  timeline (zero bars for empty months). Monthly figures skip yearly ad-hoc
  entries; category/year totals still include them. Reuses the existing
  moneyStatItem/barRow helpers (renderFinanceHighlights/renderFinanceTrendCard
  in finance.js)
- adding/editing an entry no longer snaps the page to the top — an in-view
  re-render now pins the section you were parked on back to its exact
  on-screen offset (captureScrollAnchor/restoreScrollAnchor in app.js,
  scrolling relative to the eagerly-built anchor section) instead of a raw
  scrollY the browser was clamping away once the lazy sections above it
  collapsed to header height during the rebuild
- mobile jump-nav label now tracks the scroll position live, not just on
  tap/render — an rAF-throttled scroll handler (syncJumpNavToScroll) runs
  jumpIndexFromScroll and keeps the active carousel slot on whichever
  section is under the top bar, suppressed while a ◀/▶ jump's own smooth
  scroll is still settling so it doesn't fight it
- moved the app version out of the bottom of Settings into the top bar,
  under the ⚙ button (a .settings-corner wrapper + absolutely-positioned
  .version-badge, mirroring how the sync-status line hangs under the logo);
  shows "vX.Y.Z" with the full "LifeLog vX.Y.Z" as its hover title
- "🔄 Sync" pick now adopts the matched media's title on both entries and
  backlog items (so a sloppy typed title becomes the canonical one), and a
  later title edit no longer drops the media link — only "✕ Unsync" does.
  Added an entrySyncLocked/backlogSyncLocked flag set on any explicit media
  pick (Sync-button match, local/backlog suggestion) or when opening an
  already-synced item, gating the add-flow's rename-clears-cover behavior;
  cleared on unsync
- "🔄 Sync" now returns matches from the category's primary source AND its
  configured fallback in one list (fetchMediaSuggestions gained a
  { combineFallback: true } opt, passed only by the two manual Sync buttons)
  instead of showing the fallback's results only when the primary was empty;
  bulk/auto-check callers keep the cheaper primary-first-then-gap-fill path
- keyboard-reachability for the app's clickable-but-not-<button> controls
  (year + category filter chips, the chip-edit "✎" pencil, the "+"
  add-category chip, achievement chips) — a shared activatable() helper
  (app.js) gives each a tabindex, role="button", an aria-label on the
  glyph-only ✎/+ controls, and Enter/Space activation firing the same
  handler as a pointer click; the existing [tabindex]:focus-visible rule
  draws the focus ring. The keyboard path passes the keydown event
  through, so the ✎ pencil's stopPropagation() still keeps Enter off the
  surrounding filter chip. Wired into journal.js via ctx for the
  achievement chips
- keyboard shortcuts — N to quick-add an entry, 1–5 to jump between
  Timeline/Stats/Backlog/Ledger/Summary, / to focus search, and ? to open
  a small cheat-sheet listing them all (also noted in Settings, since
  otherwise there's no on-screen hint they exist). Skipped while typing
  in a field, while a modal is open, or with a modifier held, so they
  never fight with entering a title/note/search term
- accessibility pass on icon-only buttons — ARIA labels added wherever a
  button's only content was a glyph and it didn't already have one
  (Settings gear, close-Settings, the cover-sync buttons, the backlog
  priority toggle incl. aria-pressed, each section's "+" quick-add), plus
  an app-wide :focus-visible outline (buttons/links/inputs had none
  beyond the browser's bare default before this). cover-link-btn and
  mobile jump-nav buttons get an inset offset instead, since both sit
  inside an overflow:hidden ancestor that would've clipped the ring
- CSV round-trip test coverage for Journal import/export — journalCsvText
  (a pure function split out of exportJournalCsv, which previously only
  built rows inline before handing them to download()) piped through
  parseJournalCsv and diffed against the original entries/backlog,
  covering exact-value preservation, embedded commas/quotes/newlines, and
  a mixed entries+backlog export
- trash/undo for deletes — "Recently deleted" in Settings → History,
  derived entirely from the existing local save-history log (no separate
  trash store or retention window): walks adjacent local history
  snapshots to spot ids present in one save and gone in the next, keeps
  whichever's still absent from the live data, and offers a per-item
  Restore that pushes just that one item back rather than reverting a
  whole snapshot. Covers entries, backlog items, and finance/recurring
  expenses (not categories — their removal usually cascades/reassigns
  rather than being a simple undo case)
- merge conflict visibility — mergeCollection (merge.js) now flags real
  conflicts specifically: editConflicts (both sides edited the same item;
  the older edit is discarded) and deleteOverridden (one side deleted an
  item the other side edited since, so the deletion is discarded and the
  item resurrected) — as opposed to a plain one-sided change, which loses
  nothing. A new summarizeConflicts() turns those into a short
  human-readable phrase, surfaced in the merge toast (on load and on
  background poll) and folded into the version-history entry a merge
  produces, instead of only the generic added/removed/edited count that
  couldn't tell a conflict apart from an ordinary merge
- "skip this occurrence" for a recurring expense — sets a `skip` flag on
  that date's rec.overrides patch via a checkbox in the occurrence-edit
  modal (no separate quick-skip button on the Ledger row; toggling only
  happens through that one modal). A skipped occurrence still shows as a
  row in the Ledger (faded out, "Skipped" label, click to reopen the
  modal and toggle it back) rather than disappearing outright, but is
  excluded from every count/total — month/year entry counts and totals in
  the Ledger, and all of Stats. Also shown/toggleable from the recurring
  template's own occurrence list, which labels skipped ones
- global search — Timeline and Backlog's search now also matches notes
  text (Ledger already did). Since the search box is shared across every
  view already (state.search persists across tab switches), added a small
  match-count badge on the tabs you're not currently looking at whenever
  a search is active, so you can tell it also hits Backlog/Ledger/Timeline
  items without clicking over to check each one
- PWA app shortcuts (manifest.json `shortcuts`) — long-press/right-click
  the installed app's icon for "Add entry" / "Add expense", each pointing
  at `?action=add-entry` / `?action=add-expense`; app.js's init() checks
  that query param once after data loads, opens the matching add modal,
  and strips it from the URL right after. Service worker cache bumped
  (v33 → v34) since manifest.json's content changed
- "pick something for me" on the Backlog (a button above the list, scoped
  to the active category/search filters and skipping dropped/unreleased
  items, opening a small modal with a re-roll button and a way into that
  item's own edit modal) and a backlog-aging line in the backlog item edit
  modal ("Added Jan 3, 2026 — 3 months ago"). Entries moved over via the
  Backlog's "✓ Done" flow (or an auto-linked title match) now also carry
  the backlog item's original add date as `backlogAddedAt`, which Stats'
  Overview card surfaces as a new "completed from backlog" count — and
  which future aging-over-time stats can build on
- backlog items within each group (prioritized, regular, upcoming/unreleased,
  dropped) now sort alphabetically by title within that group instead of by
  createdAt — the final tiebreaker in renderBacklog's sort comparator
  (backlog.js) went from an implicit stable-sort fallback on insertion order
  to an explicit `a.title.localeCompare(b.title)`
- fixed journal.js's stripMediaSearchSuffix leaving a dangling colon behind
  for a title written as "Foo: Book 3" (stripped to "Foo:" instead of
  "Foo") — the separator-char group only matched a "-"/":" that came after
  whitespace (e.g. "Foo - Book 3"), not one already glued onto the base
  title before the space. Folded the separator chars into the same
  repeatable class as the whitespace so both forms strip the same way; a
  strict generalization of the old pattern, so every previously-passing
  case still passes
- extended the plain-node test pattern to the rest of the pure/near-pure
  helpers the earlier coverage survey had logged as a follow-up:
  test/io.test.js (parseCsv/csvEsc, buildImportItems's three dedup
  strategies — exact key, cross-kind title+category, mediaSource+mediaId —
  importItemDateStr/importBucketKey); journal.js's
  titleSuggestions/backlogSuggestions/heatColor added to test/journal.test.js;
  finance.js's closestOccurrenceDate/parseMoneyCell/monthSortAsc added to
  test/finance.test.js; media.js's normGenres/stripHtml/steamCoverUrl in a
  new test/media.test.js (media.js needs no init() stubbing at all — fully
  self-contained like merge.js). Skipped TMDB's genre-id lookup tables
  (plain data, not logic) and everything network/fetch-based, unchanged
  from the original survey's scope call. 108 tests across 7 files now

- extended test/merge.test.js's plain-node test pattern (plain Node
  `assert`, no framework) to the rest of the data-touching code named in
  the TODO: finance recurringOccurrences (overrides, month/leap-year
  clamping, endDate cutoffs) plus its date-math helpers in
  test/finance.test.js; the entry/backlog/finance sanitizers in
  test/finance.test.js, test/journal.test.js, and test/backlog.test.js;
  and normalize()'s migrations (visual-settings one-time migration,
  accomplishments legacy-string→id backfill, category backfill) in
  test/app.test.js — the hardest of the three since app.js runs its real
  bootstrap (Storage.load, wire()'s DOM wiring) unconditionally at the
  bottom of its IIFE; a `module`-only guard (mirroring merge.js's own
  `module.exports` check) skips that under a Node `require()` without
  changing anything for a real browser load. Folded in a few equally
  self-contained pure functions the coverage survey surfaced right next to
  these (stripMediaSearchSuffix, isUnreleased). Added test/run-all.js to
  run all five test files in one shot (each spawned as its own process —
  they all reset `global.window` and re-require their src files, which
  Node's require() cache would silently no-op on a second in-process
  require)

- Timeline, Ledger, and Backlog now render lazily instead of building
  every year/category up front on every render() call — a shared
  renderLazySections() helper (app.js) builds every section's header
  synchronously (so sticky headers and the jump-nav's querySelectorAll
  keep working unchanged) but defers each section's body until it's
  needed: the one nearest the current scroll position builds immediately,
  the rest build via IntersectionObserver as they scroll near, or a
  background requestIdleCallback trickle otherwise. jump-nav ◀/▶ forces
  its target section to build before scrolling to it; bulk mode (where
  select-all/drag-paint need every row live) skips the lazy path and
  builds everything up front, same as before. Cover art `<img>`s also
  got `loading="lazy"` so they don't all fire their network request the
  moment a section builds.

- mobile: quick-jump row (◀ current ▶) below the bottom tab bar — jump by
  year on Timeline/Ledger, by category on Backlog, so a long list doesn't
  mean scrolling through everything to reach the next section. Section
  list rebuilds on every render() (via updateJumpNav() in app.js) and gets
  tagged with data-jump-index; the current position is tracked as state
  (jumpCurrentIndex) rather than re-derived from scroll position on every
  click, since window.scrollTo's smooth animation is async and a quick
  second tap would otherwise measure an animation still in flight. Jumping
  computes the scroll target manually (topbar height offset) rather than
  relying on scrollIntoView, which would tuck the sticky header behind the
  fixed topbar. The row's space is always reserved in the bottom bar
  (visibility, not display, toggles) so switching to Stats/Summary (which
  don't use it) never shifts the bar's height. Mobile-only; not shown on
  desktop since it already has multi-column layouts and visible sticky
  headers
- fixed recurring expenses landing on the wrong day of the month for
  anyone in a timezone ahead of UTC — recurringOccurrences() (and a few
  related "today" spots: the finance-entry date field default, a new
  recurring expense's start date, and the recurring-card active/expired
  check) built date strings by converting a local-time Date through
  .toISOString(), which round-trips through UTC and could shift local
  midnight back a calendar day. Added a localDateStr()/todayStr() pair
  that reads local calendar fields directly, no UTC conversion, and swapped
  every call site over
- fixed finance entries on the same date inconsistently appearing at the
  top or bottom of the month's list — the Ledger sorted by date only, so
  same-date entries fell back to their position in the underlying array,
  which merge.js's mergeCollection() reshuffles on every multi-device sync
  (it rebuilds the array from a Set of ids, not insertion order). The sort
  now breaks same-date ties by createdAt, so display order stays
  deterministic across merges
- app.js modularization follow-up: pulled the import/export + import-picker
  cluster into src/io.js (download/export/import for JSON+CSV, the
  buildImportItems dup-checker, and the shared review picker modal), and
  the Steam wishlist + AniList Planning sync machinery into src/sync.js —
  both follow the same fetch/dedupe/review-picker/auto-check shape, so they
  share one module instead of each getting a thin file of its own (manual
  Steam App ID cover helper, GG.deals price cache, wishlist sync,
  unresolved-title retry, RAWG backfill, and both auto-checks). Both new
  modules follow the same init(ctx) pattern as finance/settings/backlog/
  journal, cross-module sanitizers and cover setters arrive via ctx rather
  than reaching for other modules' window globals directly. app.js is down
  to ~1,385 lines from ~2,290. No behavior change
- AniList Planning auto-check (Settings → Media → AniList "Check
  automatically") — mirrors maybeAutoCheckSteamWishlist: a quiet cadence
  (Never/day/3 days/week/month, stored on settings.anilist.autoSyncDays)
  that on app open, at most that often, fetches the Planning list(s) and
  counts how many titles aren't already in the backlog/Journal yet, then
  just toasts the count — never opens the picker or adds anything. Uses a
  local-only last-checked key (ANILIST_SYNC_KEY, mirroring STEAM_SYNC_KEY),
  a maybeAutoCheckAniList() fired from init() alongside the Steam one, and
  the same source+id / title+category dedup the import uses
- Stats: fixed the Highlights card butting against the Overview card above
  it with no gap — it now gets the same 20px top margin the other stacked
  cards have
- SteamGridDB back as a games cover-art source/fallback — routed through the
  Steam Wishlist CORS proxy's /steamgriddb/<path> route (it's CORS-blocked
  direct), wired back into media.js's source list, the Settings source
  dropdown, and a SteamGridDB API key field; needs both the key and the
  proxy URL set to work

- AniList Planning import (Settings → Media): pulls plan-to-watch (anime)
  and plan-to-read (manga) into the backlog, each into its own chosen
  category, no proxy/key/auth needed. Routed through the shared review
  picker; dup-checked against the backlog and the Journal by title+category
  and by AniList media id. Generalized the picker's "already added" media-id
  check from Steam-only to any source. Items carry cover/rating/length/genres
- Stats: three new cards — Highlights (busiest month, longest month
  streak, top category, year-over-year delta), Monthly pattern (entries
  per calendar month across all years), and Genres (breakdown by a new
  genres[] field the media sources now capture on sync — RAWG/TMDB via
  its genre-id maps/AniList/Jikan/Open Library subjects/Google Books
  categories, capped at 4; older entries stay blank until re-synced, and
  the card hides itself when there's no genre data). Genres persist
  through the sanitizers and ride along on re-entry suggestions and the
  entry↔backlog transfer
- split the Journal out of app.js into src/journal.js (~1,050 lines):
  Timeline + Stats views (heatmap, Year in Review), the entry modal,
  timeline bulk actions, achievements, category management, the entry
  sanitizer, and the shared title-suggestion/media-cover machinery
  (re-forwarded into backlog.js) — app.js is now a ~2,150-line shell,
  completing the per-view modularization; no behavior change
- split the Backlog out of app.js into src/backlog.js (~650 lines):
  view + rows, add/edit modal with sync, bulk move/delete/sync, and the
  backlog sanitizer — app.js down to ~3,100 lines, no behavior change
- split the Settings modal out of app.js into src/settings.js (~620
  lines): tabs, Data panel (file/GitHub connections + version history),
  Appearance, media source/key settings incl. Steam wishlist inputs,
  and the privacy panel — app.js is down to ~3,700 lines, no behavior
  change
- split all finance code out of app.js into src/finance.js (~1,000
  lines): Ledger + Summary views, finance/recurring/finance-category
  modals (incl. per-occurrence overrides and link-past-expenses),
  finance import/export, and the finance sanitizers — app.js is down
  to ~4,300 lines with no behavior change; also fixed the service
  worker precache list missing merge.js
- Steam Wishlist import: a small self-hosted CORS proxy (free Cloudflare
  Worker, see proxy/worker.js + proxy/README.md) unblocks Steam's
  wishlist endpoint, which sends no CORS header. Settings → Media has a
  new "Steam Wishlist import" section (proxy URL, SteamID64 with a
  find-yours link, target category, sync button) that pulls the whole
  wishlist in one request and routes it through the existing shared
  import/export review picker — dup-checked against the backlog by
  title+category and, for items already imported once, by Steam app ID
  too (so a later local rename doesn't make it look new again); nothing
  is added until confirmed. Imported items are tagged mediaSource:
  "steam" + mediaId: <appid>, the same shape a manually-entered Steam
  App ID already used, so cover art and GG.deals pricing (both already
  wired to that shape) pick them up with no extra work. Wishlist
  removals don't auto-remove the backlog item — only additions sync
  automatically.
- fix version history rows overflowing the panel on mobile — the
  summary now sits on its own line below the date instead of sharing
  a line with the date and Restore button
- reworked sync/version history to be robust offline and across devices:
  every entry/backlog item/finance entry/recurring expense/accomplishment/
  category now carries an updatedAt, deterministically backfilled for
  existing data; version history moved into its own local-first store
  (IndexedDB) with a human-readable summary per save ("+2 entries, edited
  1 recurring expense"), so restoring works fully offline regardless of
  GitHub connection, with GitHub's commit log filling in further back
  when connected; two devices that both edit offline and reconnect now
  get a real three-way merge (union of additions, newer-wins on true
  conflicts, edits-over-deletes) instead of one whole snapshot silently
  overwriting the other — the old "pick a version" picker only shows up
  now for genuinely irreconcilable cases; also fixed two identity bugs
  that would've broken merging: accomplishments had no stable id across
  edits, and renaming a category regenerated its id
- Finance Summary: "Recurring vs one-off" is now just "Recurring" —
  lists each recurring expense's own total for the period instead of
  one lumped total against all one-off spending
- recurring expenses: occurrences can now be edited individually — click
  one (in the Ledger or the template's own list) to set a per-date
  amount/note override without changing the template or any other
  occurrence, shown with a ↻* badge; linking past expenses now preserves
  each one's original amount/note this way too, instead of flattening
  it to the template's current amount
- recurring expenses: added a "🔗 Link past expenses" button in the edit
  modal — a searchable picker (styled like the import review screens)
  over your existing expenses in that category, so old manually-logged
  entries from before the recurring expense existed can be folded into
  it; linked entries are removed and the start date backdates to cover
  them, generated from then on by the template itself
- confirmed SteamGridDB is CORS-blocked from the browser (real-device
  test: "Failed to fetch") and removed it — the source function, its
  Settings API key field, and its dropdown entries; games stays RAWG-only
- each category's media source can now have an optional fallback,
  tried automatically when the primary finds no matches — the
  fallback dropdown offers every source, not just ones "compatible"
  with the primary's type, so it's on you to leave it at "No fallback"
  where a second source doesn't make sense; added Jikan (anime/manga,
  behind AniList) as a new source
- app lock: Fingerprint/Face ID now requires a PIN to be set up first as
  a mandatory fallback, instead of being usable on its own; the lock
  screen shows both the PIN pad and a Fingerprint/Face ID button
  together when both are set up, instead of only one method at a time;
  and entering the correct PIN unlocks immediately without needing to
  press Unlock
- removed income tracking from Finance entirely — the Type field on
  entries, the income/expense/net stats, the savings-rate stat, and
  the "Income by category" card are all gone; every amount now shows
  as a plain expense with no +/- sign, and CSV export dropped its
  "Type" column
- backlog priority star now sits inline with the title in list rows
  instead of wasting its own line; the "★ Prioritize" toggle in the
  backlog editor moved from a form row into a compact button next to
  the title field

- simplified backlog priority to a single "★ Prioritize" toggle instead
  of a 1-5 star rating; moved the "Dropped" checkbox into a "Mark as
  dropped"/"Restore" button next to Delete; bulk sync now shows live
  "N/M synced" progress next to the selected count instead of changing
  the Sync button's own label (which was pushing Cancel onto its own
  row on mobile)
- added length metadata for backlog items and journal entries: playtime
  (games), runtime (movies), season/episode counts (shows), page count
  (books) — synced via RAWG/TMDB/Open Library/Google Books
- journal entries can be moved back to the backlog via a new "Move to
  backlog" button next to Delete, the reverse of the "✓ Done" button
- improved Finance Summary: savings-rate stat, an Income by category
  breakdown, a real By month card (replacing the flat yearly/12
  average), a Recurring vs one-off split, and a Top expenses card
- renamed the Finance tab formerly called "Timeline" to "Ledger" — both
  Journal and Finance had a tab named "Timeline", which was ambiguous
- trimmed a lot of repetitive Settings hint text (dropped the redundant
  "(this device)" tag on Local file, merged Theme/Font's identical
  hints, cut duplicate "this device only" phrasing, generalized the
  Brave-specific browser message into a bullet point) and moved Currency
  back under Appearance
- on mobile, the Journal Timeline tab moved one position to the right in
  the bottom nav (swapped with Stats), so it's no longer the leftmost tab
- cleaned up Settings: merged the History tab into Data, moved Currency
  from Appearance into Data, combined Theme/Font into one "Look" section,
  and merged Privacy's and Media's paired sections into single sections
  with subheadings — 6 tabs down to 5, tighter groupings throughout
- backlog entries get a divider between prioritized and unprioritized
  items within a category, same as the existing dropped-items divider
- category filter pills use the same solid accent highlight as selected
  year pills when active, instead of tinting with the category's own color
- Timeline and Backlog entries with no cover art (or a broken cover URL)
  now show an icon on a category-tinted background instead of a blank box
- media sync strips a trailing "S1"/"Season 1"/"B1"/"Book 1" style
  marker from the title before searching (falls back to the untouched
  title if that comes up empty), so personal season/book numbering
  doesn't block a match
- sync status line under the logo: more gap from "LifeLog", less
  leftover empty space below it in the header
- backlog keeps the current category header sticky under the top bar
  while scrolling on mobile, matching the Timeline's sticky year/month
  headers
- fix media sync disconnecting automatically when renaming an entry or
  backlog item — it now only clears via the explicit "✕ Unsync" button;
  picking a match from the "🔄 Sync" button also now sticks the same way
  a title-suggestion pick already did
- moved the sync status indicator (the storage-status LED) out of the
  filter bar and up into the top bar, in a section right under the
  Settings button
- bulk edit for Timeline entries now has a "Sync" action too, same as
  Backlog — re-fetches cover art/metadata for every selected entry from
  its category's configured media source
- Settings → Appearance → Cover art: independent "Timeline cover size"
  and "Backlog cover size" dropdowns, each with None/Small/Big — merged
  the separate show/hide toggle into the size dropdown itself (None
  replaces it) instead of having both a toggle and a dropdown per view
- removed the separate "Enable media enrichment on this device" toggle
  in Settings → Appearance — it was redundant with the per-category
  source dropdowns in the Media tab, which are now always visible and
  are the only on/off switch (set a category to "None" to disable it)

- fix the bulk-edit action bar not showing up / appearing in the wrong
  place — a lingering CSS animation transform on the content area was
  making it a containing block for the bar's `position: fixed`, so it
  floated relative to the content box instead of the viewport
- fix the view jumping/resetting to the top after adding an entry (or
  any other in-view change) — clearing and rebuilding the page's content
  on every render momentarily collapsed its height, and the browser's
  scroll position never recovered; it's now restored afterward
- long-pressing an entry's title text now still lets you select/copy it
  instead of entering bulk mode — long-pressing anywhere else on the row
  (the category chip, badge, padding) enters bulk mode as before
- fix bulk editing not showing up on touch devices — long-pressing an
  entry was fighting the browser's native text-selection/callout gesture
  instead of triggering select mode; rows now disable text selection so
  the long-press timer gets a clean shot at it
- fix bulk editing: tapping a row's checkbox is no longer immediately
  undone by a stray click bubbling up to the row and re-toggling it
- show media pictures (cover art) for journal entries in the Timeline, not
  just the Backlog — with a Settings → Appearance toggle to turn it on/off;
  added the same show/hide toggle for Backlog covers
- mobile navbar: added a subtle shadow and made it slightly taller

- backlog items can now be marked "Dropped" — sinks to the bottom of
  its category section below a separator, shown dimmed with a
  strikethrough title, without deleting it
- backlog items now have a priority star rating (separate from the
  external critic rating) — set it on add/edit, and higher-priority
  items sort to the top of their category section
- a "+" quick-add button on each Backlog category header, same as the
  one on each Timeline month card
- star rating pickers (entry rating, backlog priority) now show a
  distinct hover color vs. the selected/filled color; backlog priority
  uses its own amber scheme matching the priority badge on backlog rows
- adding a backlog item now checks if that title already exists, either
  as another backlog item (duplicate) or as something already logged in
  the journal timeline — surfaced in the title suggestion dropdown and
  an informational banner on exact match; doesn't block saving
- adding a journal entry now also checks the backlog for a matching
  title (not just previous entries): matches show up in the title
  suggestion dropdown tagged "in backlog"; picking one, or typing the
  exact backlog title, links the entry to it and shows a banner saying
  it'll be removed from the backlog on save, with a way to opt out; the
  existing "✓ Done" button on backlog rows now shows the same banner too
- fix a brief flash of the default theme/font/layout on every page
  load/reload — those now apply immediately instead of waiting on the
  data load to finish
- reposition the global Add and Settings buttons: Add is now a floating
  "+" button anchored to the bottom-right corner on every layout;
  Settings moved into its own spot in the header corner, away from Add
  and the view tabs
- Settings → Appearance → "Theme" (Default/Light/Nord/Dracula) color
  scheme picker
- Settings → Appearance → "Force layout" (None/Mobile/PC) to pin the
  responsive layout on this device regardless of actual screen size
- add a "+" button to the top right of each month panel (Journal
  Timeline and Finance) for quick-adding an entry directly to that month
- bulk edit: add a "select all" checkbox to the month header so you can
  select every entry in that month at once (Journal and Finance)
- bulk editing for finance entries (move to category, delete) — same
  long-press mechanism as Journal/Backlog; recurring occurrences aren't
  selectable
- each Finance month card shows a running total (income minus expenses)
  at the bottom
- finance timeline entries now look like journal entries: pill-shaped
  category chip on the right, amount stays on the right, no per-entry
  date (the month card already conveys that)
- make the Finance timeline match the Journal timeline — same sticky
  year/month headers on mobile, and the same year/month panel grouping
- recurring expenses: edit modal now lists every occurrence it has
  generated; replaced "Stop repeating" with a single "Delete" that
  removes the template but keeps everything it already created in
  your history (materialized as real finance entries first)
- bulk editing for timeline entries (move to category, delete) — entered
  via long-press, same mechanism as Backlog; bulk action bar always shows
  while active so Cancel is reachable even with nothing selected
- rework timeline visual: sticky year/month headers on mobile so the
  current year/month stays pinned near the top while scrolling
- remove the journal Categories tab — editing a category now happens via
  the ✎ button on its filter chip (matching Finance); per-category counts
  already live in journal Stats
- version/change history in Settings: keep a small rollback history (not a full audit log) so you can revert to a recent prior state of your data
- add repeating expenses
- centralize import/export in Settings: both the journal data (Timeline/Categories/Backlog) and Finance data should support import/export as CSV and JSON, not just JSON for one and CSV for the other
- tabs menu: group the journal tabs (Timeline, Categories, Stats, Backlog) under a "Journal" header and the finance tabs (Finance, Finance Stats) under a "Finance" header, instead of renaming each individual tab
