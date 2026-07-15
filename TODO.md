todo:

- trash/undo for deletes — a short-lived "Recently deleted" list (entries,
  backlog items, finance/recurring expenses) surfaced in Settings → Data's
  version history tab rather than as a whole separate UI, since that panel
  already lists saves with restore buttons — a deleted item could show up
  there as its own restorable row (or restoring the save right before the
  delete could double as the recovery path) instead of duplicating that
  list/restore machinery. Needs a retention window (e.g. purge after N
  days or N saves) so it doesn't grow forever

- merge conflict visibility — merge.js resolves multi-device sync
  conflicts silently right now; surface a small "here's what got
  merged/dropped" summary when a merge actually had to resolve
  conflicting edits, reusing the version-history's human-readable-summary
  approach rather than inventing a new format

- PWA app shortcuts (manifest.json `shortcuts`) — long-press the
  home-screen icon to jump straight to "Add entry" / "Add expense"
  instead of opening the app then navigating

- "skip this month" shortcut directly on a recurring expense's Ledger row
  (one tap), instead of only reachable through opening the modal to add a
  per-occurrence override

- global search across Journal + Backlog + Finance (title/tag/note text)
  from one input, instead of each view having its own separate filter

- accessibility pass — focus states and ARIA labels on icon-only buttons
  (jump-nav arrows, cover-link buttons, etc.), given how icon-heavy the UI
  is

- import/export test coverage for CSV round-trips specifically (export
  then re-import and diff) — io.js's dedup logic already has solid test
  coverage but the CSV round-trip itself doesn't seem to be

- keyboard shortcuts for common actions — quick-add entry, jump between
  views (Timeline/Backlog/Ledger/Stats), maybe focus the title search.
  Should stay out of the way of typing in inputs/textareas (only fire when
  no field is focused, or use a modifier), and probably want a small
  cheat-sheet (e.g. a "?" overlay) since they're not discoverable otherwise

- clean up Settings → Media naming: the proxy URL field (`#steamProxyUrl`,
  stored at `settings.steam.proxyUrl`) lives inside the "Steam Wishlist
  import" section and is named/labeled as Steam-only, but it's actually
  shared CORS-proxy infrastructure — SteamGridDB cover art and GG.deals
  price lookups both already route through it too (see proxy/worker.js's
  /steamgriddb and /gg-deals routes), and the SteamGridDB key's own hint
  text has to awkwardly point back at "the Steam Wishlist proxy URL set
  below" to explain this. Pull proxy setup into its own section/heading
  (e.g. "CORS proxy" with the proxy URL field and a link to
  proxy/README.md) ahead of the per-source stuff, and rename the Steam
  Wishlist section to just cover the wishlist-specific fields (SteamID64,
  target category, auto-sync, retry/backfill). Keep `settings.steam.proxyUrl`
  as the storage key for now (rethink/migrate only if it becomes worth a
  data-shape change) — this is a UI/labeling cleanup, not a schema change.
  While in there, note what else could use the proxy going forward as APIs
  get added that don't send CORS headers, so it's clear this one field
  isn't Steam-specific
done:

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
