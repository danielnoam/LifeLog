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
