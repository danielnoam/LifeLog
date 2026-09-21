# Dropped

Things decided against, and things that turned out not to be possible. Kept
here so the same idea doesn't get re-litigated every few months, and so
TODO.md stays a list of work actually worth doing.

Nothing here is forbidden forever — each entry says *why*, so if the reason
stops being true (an API opens up, the misses pile up, the shape of the app
changes) it can move back to TODO.md. What it isn't is an idea waiting for a
free afternoon.

Format: what it was, and the reason it isn't happening.

---

## Virtualising the Timeline and Backlog rows

Parked in TODO.md since 0.136.1 on a suspicion, re-measured 2026-09-21 on
0.163.1, and dropped on the numbers. Chromium at 4x CPU throttle, 460x1100,
Timeline, median of three loads, dataset swept so the row count is the only
variable (`node test/perf/serve-and-run.js`):

    entries   elements   first row   RecalcStyle   Layout   Script
      611       5,327       534ms        192ms       78ms    115ms
      300       3,461       642ms        158ms       80ms     73ms
      120       2,381       635ms        149ms       71ms     41ms
       60       1,853       551ms        149ms       72ms     41ms

Time to first row does not track the row count at all — the 611-entry load
came in faster than the 60-entry one. A ten-fold cut in the dataset, deeper
than virtualising could ever make since it removes the data and not just the
rows, moves it by less than the spread between repeats.

Two things the old entry asserted were wrong. "~30 nodes per entry" was the
CDP `Nodes` metric (text nodes included) divided by the entry count; a row is
6 elements on Timeline and 7 on Backlog, and there is no fat in it. And "the
IntersectionObserver already half does it" is untrue of Timeline: an unbuilt
section body collapses to its header's height, so all seven year headers fall
inside the observer's one-viewport rootMargin on first layout and everything
builds anyway. Disabling the idle trickle changes neither the node count nor
the row count, so virtualising would have to be row-level rather than
section-level — a far bigger change than the entry implied.

On the search question, since it is the first thing anyone asks: the app's own
search would be unaffected. `state.search` is read only by the five pure
filters (`getFiltered`, `getFilteredBacklog`, `getFilteredFinance`,
`getFilteredNotes`, `getFilteredTodos`), all of which run over `state.data`
before anything renders, and `updateSearchMatchBadges` counts from those same
functions rather than the DOM. Nothing in the app queries the DOM for rows.

Browser find-in-page is the casualty, and it cannot be saved.
`hidden="until-found"` and `beforematch` only reveal nodes that exist; a row
never built is unreachable by any API, and there is no event for "the user
opened find". Intercepting Ctrl+F to focus our own search box is a substitute,
not a preservation — it misses find opened from the browser menu, and does
nothing for select-all, copy, print-to-PDF or a screen reader.

And the cheap nine tenths was already taken in 0.136.1: `content-visibility:
auto` on `.month-card` and `.backlog-section` skips style, layout and paint
for off-screen cards while leaving the nodes in the document — which is
exactly why find-in-page still works there.

The reason could stop being true: a dataset several times this one, where the
sweep above starts to show a slope. The rig is still in `test/perf/` to check.

## Project budgets, and bulk-splitting a lump into many expenses

Two ideas that sat in TODO.md from 0.145.0: a budget per project with a
spent-against-it bar, and a way to break one lump entry ("Switzerland —
10,000") into many real expenses in one go. Both were written as "want using
the feature first". The feature has now been used for twenty versions and
neither has been missed, so they are not work waiting on an afternoon.

The yearly-lump converter landed in 0.147.0 and covers the single case, which
is the one that actually comes up; what was left was only the bulk case,
worth revisiting only if several lumps ever turn out to need splitting.

## Projects spanning all four views

Projects are finance-only on purpose. A holiday is something you log entries
and notes about too, and it is tempting to grow the field outward one view at
a time. A project that meant something in Timeline, Backlog and Notes as well
is a much larger idea than the one that shipped — different grouping, a
different picker in four places, and a different answer to "what is a project"
in each. Worth doing deliberately as its own thing, or not at all; what it
must not be is something this one drifts into by accident.


## A "Needs attention" pill and panel

Shipped in 0.161.0, removed in 0.162.0. A ⚠ count in the header opened a
panel grouping everything the app knew was unfinished — unresolved Steam
imports, backlog items a sync could fill, expenses on a guessed rate — each
group with a "Take me there" button.

It was a list that could only tell you. "Take me there" switched view and
left you facing the same list you'd have scrolled anyway, with nothing
selected and no action staged. The information was right; the shape was a
report, and a report you have to act on manually is one you stop opening.

What replaced it does one of the three groups and does it properly: inside
bulk mode the Backlog's bar offers "⚠ Incomplete 12", which selects exactly
those, with Sync already next to it. The other two groups had no equivalent
— a guessed rate is settled by Convert, which is per-project, and
unresolved Steam titles already have a retry button — and gathering things
that share a mood rather than a fix is what made the panel a report in the
first place.

Worth remembering before building another overview: an overview earns its
place when it can hand the problem to the thing that solves it. If the best
it can offer is a signpost, the signpost belongs where the work is.

## Committing the ten older ad-hoc browser scripts

Fourteen browser suites came into `test/browser/` in 0.161.0. Ten others
from the same scratchpad did not: `features`, `allviews`, `tabs`, `jump`,
`jumpbehave`, `swipe`, `summaries`, `chips`, `fixes`, `v149`.

They were written against a seed file that no longer exists, and they fail
on arrival — wrong section counts, wrong row counts, selectors for markup
that has since changed. Their whole value was *differential*: run them
before a change and after it, and identical output meant the change touched
nothing it shouldn't. That works for a scratch script and not for a
committed suite, because a suite that is red on arrival teaches you to skim
past red.

Fixing their fixtures means reconstructing a seed from their assertions,
which is guesswork, and the areas they cover are mostly covered by the
fourteen that did land. If one of those areas regresses, write a fresh
suite with a seed it owns rather than reviving these.

## View Transitions for the view and mode switches

**Not possible without losing something better.** Planned as the last flourish
of the rendering rework: replace the hand-written `view-fade-in` and
`mode-slide-*` keyframes with `document.startViewTransition()`.

The mode switch is swipe-driven and follows your finger — attachSwipe's
`onMove(dx)` fires continuously through the drag, so the page tracks the
gesture and letting go finishes the slide. A View Transition is snapshot-based
and discrete: it captures before and after and animates between them. It
cannot track a drag at all, so adopting it for the mode switch would trade a
gesture that follows your hand for one that plays a canned animation after you
let go.

That leaves it usable only for the tab switch, where the existing fade is
already cheap and already works — and having one of the two switches animate
by a different mechanism than the other is worse than having both hand-written.

## render() dropping `#viewBody.innerHTML = ""`

**Both reasons for it turned out to be wrong.** It was the keystone of the
rendering rework's plan, then its last step, and now it isn't happening.

The first reason was speed: clearing collapses the page, which forces the
scroll-anchor dance. content-visibility (0.136.1) made that layout cheap
enough that a CPU profile no longer sees it — the clear costs one detach and
reattach of nodes that survive it anyway, since every view holds its own root.

The second reason was that removing it would let captureScrollAnchor and
restoreScrollAnchor go with it. It wouldn't. Those don't exist to undo the
collapse — restoreScrollAnchor repositions relative to the anchored *section*,
which is what keeps you in place when the content above you changes height. A
filter that drops rows above your scroll position still shifts everything
under you, reconciled or not. That machinery earns its keep either way.

So what's left is a registry of every view's root node threaded through five
modules, to remove a line that costs nothing and frees nothing.

## Income tracking (Finance)

**Removed in v0.85.0.** The Type field on entries, the income/expense/net
stats, the savings-rate stat and the "Income by category" card are all gone;
every amount is a plain expense with no +/- sign, and CSV export dropped its
Type column.

Finance here answers "what am I spending", and income made every screen carry
a second axis to answer a question already answered better by a bank app. A
handful of irregular income rows never told the truth about a salary, so the
net and savings-rate numbers it enabled were confidently wrong.

Not coming back unless the app's purpose changes — a real budgeting tool is a
different app, not a wider Finance tab.

## Fuzzy title matching

`titleKey` (media.js) folds case, accents, punctuation, spacing and `&` vs
"and", and normalizes season markers. It deliberately stops short of
edit-distance matching, so "Re:ZERO -Starting Life in Another World-" and
"ReZero Starting Life in Another World" still key apart — "re zero" and
"rezero" differ once punctuation goes.

Edit distance would catch that pair and would also start hiding things that
only *look* similar, which is the worse failure: a Discover row silently
missing because it resembles something already owned. Revisit only if the
misses actually pile up.

## Rotten Tomatoes, Metacritic and Netflix as sources

**Not possible.** None has a public API. Metacritic scores do arrive
second-hand through RAWG, which is where the app's game ratings come from.

The Netflix half — "what's hot on the services I actually have" — is
answerable through TMDB's watch-provider filter instead, and that idea lives
in TODO.md as real work.

## "Hot books" and "hot music" in Discover

**No source.** Open Library and Google Books publish no popularity data and
MusicBrainz none at all, so those categories get no Discover list.

The NYT Books API (free key, bestseller lists) is the one candidate that
would actually add something; it's in TODO.md rather than here, because it's
possible — just another key to set up.

## Early Access for non-Steam games

Early Access is readable only through Steam, which files it as genre id 70
(see `steamEarlyAccess` in media.js). A RAWG- or SteamGridDB-only game has no
way to say so: RAWG has no field for it — its `early-access` tag is a stale
mirror of Steam's that never clears at 1.0 — and SteamGridDB states nothing
but artwork and a date.

IGDB has a real `status` enum that includes it, but wiring IGDB means a whole
new media source behind Twitch OAuth for one boolean. Not worth it. Games
without a Steam App ID simply don't get the flag.

## Progressive loading for SteamGridDB search

SteamGridDB does an autocomplete request and then a second round of per-game
cover fetches, both through the user's CORS proxy — two proxy round-trips
deep before it can return anything. It could emit the name matches
immediately and fill the covers in progressively.

The cost was never measured, and can't be from the dev sandbox: it needs a
SteamGridDB key and a live proxy. Rebuilding the search flow around a
speculative win isn't worth it. If the wait ever feels long in real use,
measure first and this comes back.

## Weighting the random pick

A star currently either filters everything else out ("Favorites only") or
counts for nothing — nothing in between, so the draw can't lean towards what
you want without cutting the pool.

Weighting would trade away the thing the pick actually gives you: it draws
from a bag, so nothing repeats until everything in scope has had a turn.
Making some titles likelier means some come up rarely or never, which is the
behaviour the bag was built to avoid.

## "What fits in an evening"

Filtering the pick by how much time you have needs a length in minutes.
`length` is free text off whichever of eight media sources filled it in —
"12 hours", "2h 15m", "8 episodes", "320 pages" — so this is a parser for
eight vocabularies, guessing at episode and page lengths, before the filter
itself exists. The filter is the small half.

## Images in notes

Notes were going to take photos alongside the text. They can't, while the
app stores everything the way it does.

The whole document is one JSON file, base64-encoded and PUT to GitHub in
full on *every* save. There is no binary anywhere in the app today — cover
art is a remote URL, never a file. Embedding photos would mean:

- every save re-uploads every photo (twenty of them is an ~80 MB upload to
  fix a typo), and every commit stores another full copy;
- the localStorage cache, which is the offline fallback, dies at ~5 MB —
  and `_cache` swallows the quota error silently, so it would just stop
  working with no message;
- the 40-snapshot local history multiplies all of it again.

The version that would work is one file per image in the same data repo
(`notes/<id>/<uuid>.jpg`), with only the path in the JSON — same token,
same repo, no new service — plus a client-side downscale, and an
authenticated fetch into a blob URL because the repo is private. That's a
real upload layer, and it isn't wanted enough to build one.

## Blocking saves when a device is behind

The version guard (v0.117.0) warns and nothing more. A blocking mode — refuse
to save from a device older than the data — would have to be worth losing
offline edits for, and since v0.116.0 made every sanitizer carry unknown
fields through, being behind isn't destructive any more.

The hook is there if this ever changes: `versionBehind()` is one call away
from `persist()`.

## One parameterised add/edit-category modal instead of three

**The three copies are honest; the abstraction wouldn't be.** The journal's,
Finance's and the to-do list's category modals are the same form over a
different collection, and #todoCatModal was written as a knowing third copy
(0.128.2) rather than doing this refactor in the middle of a feature. It sat
in TODO.md until 0.141.0 on the assumption that it was just deferred work.

The `open` half really is mechanical — ids, title, the "uses" count and its
noun, the default colour, whether the name input takes focus. The save half
is where it falls down, and the three divergences aren't accidents:

- **Finance slugs its id from the name** (`"Board Games"` → `board-games`);
  the other two call `uid()`. That isn't a style difference. It means a
  Finance category's sync identity is derived from something the user can
  see, so the rename path has to deliberately *keep* the old id while
  cascading the name across financeEntries and recurringExpenses. A shared
  save path would have to either impose one scheme on all three — changing
  the merge identity of a collection that's already synced to a device — or
  branch, which is the three copies again with extra indirection.
- **The cascade differs.** Renaming a Finance category rewrites two arrays of
  entries that store the name as a string. The journal's rewrites entries;
  the to-do list's rewrites todos. Same idea, three different sets of arrays
  and field names.
- **What each stamps** was the one genuine inconsistency — createdAt versus
  updatedAt — and 0.140.0 fixed it in `sanitizeCategory` without touching a
  single modal, which is the tell: the part that was actually wrong was the
  part that didn't need the refactor.

So the bar was: do the whole thing (unify the id scheme, unify the cascade)
or leave three honest copies. Unifying the id scheme is not worth a migration
on a synced collection to save a form. And a shared form with three divergent
save paths behind it is worse than either, because it tells the next reader
these things are the same when they aren't.

What did come out of it: 0.141.0 made Finance's duplicate check
case-insensitive like the other two. That was a real bug — Finance slugs the
id from the lowercased name, so "Games" and "games" produced two categories
sharing the id `games`, which is exactly what mergeCollection keys on.

If the id schemes ever converge for another reason, this is worth reopening.

## Preserving cover images across a row refill

**Built it, measured it, threw it away.** adopt() replaces a row's children
wholesale, so the <img> a refill installs is a different element from the one
before it. The TODO entry asking for this assumed that costs a decode per
visible cover, and guessed it might also flash — a fresh <img> with no bitmap
paints nothing.

Neither is true. The implementation was a reuseImages() pass in adopt():
match the fresh tree's `img[src]` against the existing one's, keep the node
that already holds the bitmap, carry the fresh attributes and onerror onto
it. It worked — element identity survived a re-render, covers still swapped
when the src changed, neighbours stayed put. Then, against a control build
with the pass disabled:

| | before | after |
|---|---|---|
| same <img> element after a re-render | 0/120 | 120/120 |
| covers with a bitmap to paint, same task | **120/120** | **120/120** |
| reconcile time, 120 rows | **4.3-7.4ms** | **6.8-17ms** |

The middle row is the whole argument and it says no. Chrome hands back a
memory-cached image synchronously: the fresh <img> is already `complete` with
a non-zero naturalWidth on the same task that created it, so there is no
frame where the art is missing and nothing to fix. Measured at 12 small
covers and again at 120 incompressible 600x600 PNGs (~1.4 MB of decoded
bitmap each, ~168 MB total) to force memory-cache pressure — still 120/120.

What it did buy was a consistent slowdown, because the pass walks both trees
with querySelectorAll on every row that has an image, and a new hazard: a
reused node runs the *fresh* handler, so any onerror closing over its own
`img` would fire against the detached one and silently do nothing. Four
handlers had to be rewritten to say `this`.

So: a measurable cost, a new trap, and zero benefit. The TODO entry set the
bar at "only worth special-casing if it shows up in a measurement" — this is
that measurement. Reopen only if a profile ever shows image decode on the
render path, which would mean something about how Chrome caches has changed.

## Discover via TMDB's watch-provider filter

**Decided against.** Discover could have answered "what's hot on the services
I actually have" through /discover with `with_watch_providers` +
`watch_region` — the nearest this app was going to get to the Netflix-style
browsing that prompted Discover in the first place (the original idea, and
why it wasn't possible, is further up this file).

Dropped on the owner's call rather than on a technical finding: it is a
second discovery mode to build and maintain, on top of a Discover that
already works, for a browsing habit the app doesn't otherwise serve. The API
support is real and unchanged, so if Discover ever becomes something used
often enough to want steering by subscription, this is still the way to do
it.
