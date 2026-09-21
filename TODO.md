todo:

- virtualising the Timeline and Backlog rows is **not worth doing**, and the
  reason is no longer a guess. Re-measured 2026-09-21 (0.163.1) against the
  0.136.1 baseline recorded in NOTES.md: Chromium at 4x CPU throttle,
  460x1100, Timeline, median of three loads, dataset swept so the row count
  is the only variable.

      entries   elements   first row   RecalcStyle   Layout   Script
        611       5,327       534ms        192ms       78ms    115ms
        300       3,461       642ms        158ms       80ms     73ms
        120       2,381       635ms        149ms       71ms     41ms
         60       1,853       551ms        149ms       72ms     41ms

  Time to first row does not track the row count at all — the 611-entry load
  came in faster than the 60-entry one. A ten-fold cut in the dataset, deeper
  than virtualising could ever make since it removes the data and not just the
  rows, moves it by less than the spread between repeats. The 500-650ms is
  boot: fetching and compiling the JS, reading storage, the first render's own
  chrome. The style and layout columns do fall with row count, but those are
  cumulative totals over the whole 4.6s window, which is the idle trickle
  spending time it has; they are not on the path to the first thing you see.

  `node test/perf/serve-and-run.js` re-runs it.

  Two things in the old entry were wrong and are worth correcting:

  "~30 nodes per entry" was the CDP `Nodes` metric (17,824 today against the
  18,388 recorded then — text nodes included) divided by the entry count. The
  real figure is 6 elements per Timeline row and 7 per Backlog row; Timeline
  over 611 entries is 5,327 elements in total, of which 3,666 are the rows
  themselves. The row is already lean. There is no fat there to cut.

  "which the IntersectionObserver already half does" is not true of Timeline.
  An unbuilt section body collapses to its header's height, so all seven year
  headers stack inside the observer's one-viewport rootMargin on first layout
  and every section builds immediately. Disabling the idle trickle entirely
  changes neither the node count nor the row count. Virtualising would have to
  be row-level, not section-level — a much bigger change than the entry
  implied, in exchange for a first-row time the sweep above cannot tell apart
  from what we already have.

  On the search question, because it comes up: the app's own search would not
  be affected at all. `state.search` is read only by the five pure filters
  (`getFiltered` app.js, `getFilteredBacklog`, `getFilteredFinance`,
  `getFilteredNotes`, `getFilteredTodos`), all of which run over `state.data`
  before anything is rendered, and `updateSearchMatchBadges` counts from those
  same functions rather than from the DOM. Nothing in the app queries the DOM
  for rows. Virtualisation would section an already-filtered list.

  The drawback is browser find-in-page, which is a different thing, and it
  cannot be kept. `hidden="until-found"` and `beforematch` only reveal nodes
  that exist; a row that was never built is not reachable by any API, and
  there is no event for "the user opened find". Intercepting Ctrl+F to focus
  our own search box is a substitute, not a preservation — it misses find
  opened from the browser's menu, and it does nothing for select-all, copy,
  print-to-PDF or a screen reader walking the page.

  And the cheap nine tenths of virtualisation was already taken: 0.136.1 put
  `content-visibility: auto` on `.month-card` and `.backlog-section`, which
  skips style, layout and paint for off-screen cards while leaving the nodes
  in the document — which is exactly why find-in-page still works. That was
  the benefit without the drawback, and it shipped back in 0.136.1.

  So this stays parked, now for a measured reason rather than a suspected one.
  If load ever does need to get faster, the numbers say to look at boot —
  the JS bundle and the storage read — not at the rows.

- projects, now that they exist (0.145.0), have obvious next steps that were
  deliberately left out of the first cut: a budget per project with a
  spent-against-it bar, and a way to turn an existing lump entry
  ("Switzerland — 10,000") into a project with real expenses under it. Both
  want using the feature first — a budget is only useful if you set one
  before you spend, and the converter is a one-off migration whose shape
  depends on how many old lumps turn out to be worth splitting.

  The yearly-lump converter landed in 0.147.0, so what's left of that idea is
  only the bulk case: breaking one lump into many expenses is still manual,
  one Add at a time. Worth revisiting only if you actually convert several.

  Currency-wise (0.146.0), two things were left out deliberately. The rate
  lookup is no longer one of them: 0.160.0 added it to the expense form and
  to Convert, keyless and CORS-direct, so the network dependency that was the
  objection turned out to cost nothing. The reasoning that survives is the
  narrower half — for settling a trip from a statement, the number you want
  is the one your card issuer used, not a published reference rate, which is
  why Convert still leads with "what it came to on your statement".

  Still open: recurring expenses can't be foreign. A subscription billed in
  USD is a real case — most of them are — and it wants either a rate per
  occurrence or a rate that drifts, which is the decision that was never
  made. With a lookup now in place, "per occurrence, fetched at the date the
  occurrence falls on" is a more answerable question than it was.

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
