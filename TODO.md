todo:

- sync latency, remaining: SteamGridDB does an autocomplete request and then a
  second round of per-game cover fetches, both through the user's CORS proxy —
  two proxy round-trips deep before it can return anything. Could emit the
  name matches immediately and fill covers in progressively. Unmeasured (needs
  a key + proxy to test)

- the random pick weights nothing: a starred title is either the only kind
  you can draw ("Favorites only") or exactly as likely as everything else.
  Weighting stars up instead of filtering everything else out would let the
  draw lean towards what you actually want without cutting the pool

- nothing about a pick knows how long you have. `length` is free text off
  whichever media source filled it in ("12 hours", "2h 15m", "8 episodes"),
  so a "what fits in an evening" filter would need parsing that first

done:

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

- titleKey is deliberately not fuzzy: "Re:ZERO -Starting Life in Another
  World-" and "ReZero Starting Life in Another World" still key apart,
  because "re zero" and "rezero" differ once punctuation goes. Edit-distance
  matching would catch it and would also start hiding things that only look
  similar — not worth it unless the misses pile up

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

- still no source for "hot books" or "hot music": Open Library and Google
  Books publish no popularity data and MusicBrainz none at all. The NYT
  Books API (free key, bestseller lists) is the only candidate that would
  actually add something, and it'd be a new key to set up

- Rotten Tomatoes, Metacritic and Netflix were asked for and are not
  possible: none has a public API. The Netflix half is better served by
  TMDB's watch-provider filter (/discover with with_watch_providers +
  watch_region), which would make Discover answer "what's hot on the
  services I actually have" — not built, but it's the natural next step

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
