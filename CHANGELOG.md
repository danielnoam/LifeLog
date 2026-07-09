# Changelog

All notable changes to LifeLog are documented here. The version number
always matches `APP_VERSION` in `src/app.js`, shown as "LifeLog vX.Y.Z" at
the bottom of Settings.

## [0.67.2] - 2026-07-09

### Fixed
- The search box rebuilt the entire Timeline/Backlog view on every single
  keystroke (render() tears down and rebuilds the whole current view from
  scratch, with no incremental patching) — noticeably laggy while typing
  once there are a few hundred entries. Debounced to 200ms, so a fast
  burst of keystrokes now triggers one render instead of one per
  character.

## [0.67.1] - 2026-07-09

### Fixed
- Settings showed two scrollbars at once on the Data and Media tabs.
  Every settings tab shares one grid cell so switching tabs doesn't jump
  the layout, but only Data and Media had their own internal scroll —
  the other tabs stayed in normal flow (just invisible), so their content
  height still stretched the shared cell, and the outer panel had to
  scroll to reach it on top of Data/Media's own internal scroll. Every
  tab now scrolls internally the same way, so only one scrollbar ever
  shows regardless of which tab is open or how tall its content is.

## [0.67.0] - 2026-07-09

### Changed
- GG.deals price now only ever shows the retail price — third-party
  keyshop prices (currentKeyshops) are no longer considered at all.
- Confirmed against a real API response that GG.deals gives no discount
  percentage or original price, only current and historical-low retail —
  so "on sale" is now shown as a comparison against that historical low:
  "(all-time low)" when the current price is at or below it, "(low
  $X.XX)" showing what the best price has been when it isn't.

## [0.66.0] - 2026-07-09

### Added
- Synced Journal entries and backlog items now show quick-link buttons in
  the bottom-right corner of the cover image, in their edit view: one to
  the item's own page on wherever it's synced from (Steam, RAWG, TMDB,
  AniList, Jikan/MyAnimeList, Open Library, Google Books, MusicBrainz),
  and — Steam-synced items only, once resolved — one to GG.deals. Each
  button only appears once an actual page is known; nothing shows for an
  item with no media connection, or for a source/GG.deals link this
  can't work out a URL for.

## [0.65.0] - 2026-07-09

### Added
- New "RAWG + Steam + GG.deals" media source for Settings → Media →
  Source per category. Searches RAWG as normal, but for whichever result
  you pick, also resolves a Steam App ID via RAWG's own store-link data
  for that game (Steam has no search API of its own — this is the only
  way to find an App ID without pasting one in by hand). When the game
  is on Steam, the entry comes in complete in one search: cover, rating,
  length, release date, Steam App ID, and current GG.deals price — the
  same result a Steam Wishlist import gets, just from typing a title
  instead of syncing a wishlist. Falls back to a plain RAWG entry when
  the game isn't listed on Steam. Works for both backlog and Journal
  entries, single-item and bulk sync alike.

## [0.64.0] - 2026-07-09

### Changed
- Backlog's "not yet released" grouping now captures a full release date
  from every source that provides one (RAWG, TMDB, Jikan, AniList,
  MusicBrainz, Google Books — whatever precision each actually gives) and
  uses it for an exact day-level check, instead of only ever knowing the
  year. A game releasing yesterday and one releasing tomorrow, both this
  year, now correctly land on opposite sides of the divider — previously
  both would've been grouped as "unreleased" for the rest of the year.
  Only the year is ever shown anywhere in the UI, same as before; the
  full date is just backing data for this one check. Falls back to
  year-only for manual entries or sources that don't give a full date
  (Open Library).

## [0.63.0] - 2026-07-09

### Added
- Backlog: items with a release year that hasn't passed yet (any
  category, not just games) now get their own divider — "not yet
  released" — sitting just above the dropped divider, same treatment as
  the existing priority/dropped separators. Release info is only ever
  stored as a year, so this is year-granularity: a same-year release
  stays in this group for the rest of that year.

### Changed
- GG.deals price no longer has its own icon or line — it now sits in the
  same row as rating/length/release year, in the same style, both in the
  backlog list and the edit modal.

## [0.62.1] - 2026-07-09

### Fixed
- The backlog list already showed GG.deals price for Steam-synced games,
  but the "Edit backlog item" modal never did, even though it already
  showed rating/length/release year in the same spot — now shows price
  there too, reusing the list's own cache so it's instant if already
  fetched.

## [0.62.0] - 2026-07-09

### Added
- Steam Wishlist import now also enriches each new game with RAWG's
  rating/length/release year (best-effort, top search match by the
  resolved title) alongside the existing Steam cover art and app ID —
  previously these games only ever got a name and cover, missing all the
  metadata a manually-added game normally has.
- A "🎮 Backfill game info from RAWG" button in Settings → Media
  retroactively fills in that same metadata for Steam-sourced backlog
  items that don't have any of it yet (from before this enrichment
  existed, or a lookup that failed at the time) — never touches title,
  cover, or the Steam app ID, and shows a live count of how many still
  need it.

### Fixed
- GG.deals price lookups were calling `api.gg.deals` directly from the
  browser, which — like Steam's own endpoints — has no
  Access-Control-Allow-Origin, so every request silently failed via a
  caught fetch error. Now routed through the same CORS proxy as the rest
  of Steam Wishlist import (`proxy/worker.js` gets a new `/gg-deals`
  route); falls back to a direct call if no proxy URL is configured.

## [0.61.0] - 2026-07-09

### Added
- Steam Wishlist import: a "🔁 Retry unresolved Steam titles" button in
  Settings → Media re-attempts the title lookup for backlog items already
  imported with a placeholder "Steam app <id>" title — a normal re-sync
  can't fix these since they're already in the backlog and no longer show
  up as "new." Updates titles in place, no re-importing or duplicating;
  the button shows a live count and hides once nothing's left to retry.

### Fixed
- Steam Wishlist import: on a large first sync (hundreds of new games),
  Steam's appdetails endpoint would start rate-limiting partway through,
  and every title lookup after that point failed identically, landing as
  a wall of unresolved placeholders. Rate-limited lookups now retry with
  a backoff (up to 3 attempts) before giving up, instead of failing
  immediately on the first 429.

## [0.60.0] - 2026-07-09

### Added
- Steam Wishlist import: a "Check automatically" setting (Never / Every
  day / Every 3 days / Every week / Every month) runs a quiet check on
  app open, at most that often — just a lightweight wishlist fetch
  diffed against your backlog/Journal, no title lookups. If it finds
  new games, a toast tells you how many; it never opens the review
  picker or adds anything on its own, so Sync Steam Wishlist stays the
  only way anything actually gets imported.
- Steam Wishlist import: the review picker now has a "Hide unresolved
  titles (N)" toggle for when a title lookup didn't resolve to a real
  name and just shows "Steam app <id>" — turning it on hides those rows
  and deselects them, so a large batch of unresolved placeholders
  doesn't clutter the review or get imported by accident. They'll be
  tried again on your next sync since they're not in the backlog yet.

## [0.59.3] - 2026-07-09

### Fixed
- Bulk import's duplicate check (used by Steam Wishlist import, and every
  JSON/CSV import) only compared incoming backlog items against your
  existing backlog, not your Journal timeline — so a game already logged
  as finished could still show up as "new" in the review picker if it
  happened to still be on your Steam wishlist. It now also checks the
  Journal by title+category, and by Steam app ID for anything tagged
  mediaSource: "steam", matching what the single-item add form already
  checked for.

## [0.59.2] - 2026-07-08

### Fixed
- Steam Wishlist import: the bulk id->name lookup (`ISteamApps/GetAppList`)
  used to resolve titles turned out to be retired by Valve, and its
  replacement (`IStoreService/GetAppList`) needs a Steam Partner key
  regular users don't have — both dead ends. Titles are now resolved one
  game at a time via the storefront's `appdetails` endpoint instead, with
  a throttled delay between requests to stay under Steam's rate limit and
  a progress readout on the sync button ("Fetching titles… 12/347"). Games
  already in your backlog are now skipped before this lookup runs at all
  (matched by Steam app ID), so repeat syncs only pay this cost for
  genuinely new wishlist additions. A failed individual lookup falls back
  to a placeholder title instead of failing the whole sync. If you already
  deployed the Worker, redeploy it with the updated `proxy/worker.js`.

## [0.59.1] - 2026-07-08

### Fixed
- Steam Wishlist import: the classic `wishlist/profiles/.../wishlistdata/`
  JSON endpoint the proxy originally targeted turned out to be retired by
  Valve — it now just serves the store homepage, which broke the sync
  with a "not valid JSON" error. Switched to the endpoint that replaced
  it (`IWishlistService/GetWishlist`, no API key needed), which only
  returns app IDs — titles are now resolved via Steam's full app list
  (`ISteamApps/GetAppList`, one request, cached in memory for the
  session) instead. If you already deployed the Worker, redeploy it with
  the updated `proxy/worker.js` for this to work.

## [0.59.0] - 2026-07-08

### Added
- Steam Wishlist import: Settings → Media → "Steam Wishlist import" now
  has a proxy URL + SteamID64 field (with a link to find yours) and a
  "Sync Steam Wishlist" button. It pulls your whole wishlist in one
  request through a small CORS proxy you deploy yourself (see
  `proxy/worker.js` and `proxy/README.md`), then routes it through the
  same review picker used everywhere else in the app — nothing is added
  automatically, and titles already in your backlog are hidden by
  default. Imported games get cover art and, once a GG.deals key is set,
  current lowest prices, the same way a manually-entered Steam App ID
  already did.

## [0.58.1] - 2026-07-08

### Fixed
- Version history rows on mobile: the summary text used to sit on the
  same line as the date and Restore button, truncated with an ellipsis
  and wide enough to push the button off-screen. The summary now sits
  on its own line below the date, fully readable, with the date/badge/
  button staying together on one line above it.

## [0.58.0] - 2026-07-08

### Added
- Version history moved into its own Settings tab, and works fully
  offline now — every save is recorded locally (not just as a GitHub
  commit), with a plain-language summary of what changed ("+2 entries,
  edited 1 recurring expense") instead of a bare timestamp. When GitHub
  sync is connected, older saves beyond the local window still fill in
  from its commit log, but it's no longer the only way version history
  works at all.
- Sync between devices now does a real merge instead of one whole
  snapshot silently overwriting another: if you edit LifeLog offline on
  two devices and reconnect, both sets of changes combine automatically
  (new items from both, newer edit wins on anything genuinely
  conflicting, an edit made elsewhere after a local delete is kept
  rather than lost) — you just get a toast summarizing what merged in.
  The old "pick a version to keep" screen still exists, but only for
  genuinely irreconcilable cases now, not routine multi-device sync.

### Fixed
- Renaming a category used to regenerate its internal id, and editing
  an achievement used to lose its original identity entirely (it was
  removed and a new one added) — both were silently invisible before,
  but would have broken the new sync merge, so both now keep a stable
  identity across edits.

## [0.57.1] - 2026-07-07

### Changed
- Finance Summary: the "Recurring vs one-off" card is now just
  "Recurring" — instead of one lumped total for all recurring expenses
  against all one-off ones, it lists each recurring expense's own
  total for the period, largest first.

## [0.57.0] - 2026-07-07

### Added
- Recurring expenses: individual occurrences can now be edited on their
  own — click any generated occurrence (in the Ledger, or in the
  template's own occurrence list) to open a small editor for just that
  date's amount/note, stored as an override without touching the
  template or any other occurrence. Overridden dates show a `↻*` badge
  instead of the usual `↻`, and a "Reset to template" button clears the
  override. Linking past expenses now preserves each one's original
  amount/note as one of these overrides too, instead of flattening it
  to the template's current amount — a bill that changed price over
  time keeps its real history.

## [0.56.0] - 2026-07-07

### Added
- Recurring expenses: a new "🔗 Link past expenses" button in the edit
  modal opens a searchable picker (same review-list style as the
  import screens) over your existing expenses in that category, for
  folding old manually-logged entries — from before the recurring
  expense existed, or a stray duplicate of a period it already covers
  — into the template. Linked entries are removed, and if any predate
  the template's start date, the start date moves back to cover them,
  so that history now shows up as the template's own generated
  occurrences at its current amount/category/note.

## [0.55.1] - 2026-07-07

### Removed
- SteamGridDB as a games source — confirmed on a real device that its
  API is CORS-blocked from browser-side `fetch()` (a "Failed to fetch"
  error), the same dead end as TheGamesDB/OMDb. Pulled the source, its
  API key field, and its dropdown entries back out rather than leave a
  non-functional option in Settings.

## [0.55.0] - 2026-07-07

### Added
- SteamGridDB as a games cover-art source, selectable as a fallback (or
  primary) alongside RAWG. Whether it actually works from a browser is
  unconfirmed — SteamGridDB's CORS support couldn't be verified ahead
  of time, so this ships as a "try it and see" option; every source
  here already fails silently if a fetch is blocked, so there's no
  downside to having it available.

### Changed
- Media sources: the fallback-source dropdown for each category now
  offers every source, not just ones "compatible" with the primary's
  media type — pick whatever you want, including no fallback for
  categories that don't need one (like Movies).

## [0.54.0] - 2026-07-07

### Added
- Media sources: each category can now have a fallback source, tried
  automatically only when the primary source finds no matches for a
  title — no more manually re-picking a different source and searching
  again by hand. Anime/manga can fall back from AniList to a new Jikan
  (MyAnimeList) source, and books can fall back from Open Library to
  Google Books. A fallback is only offered where a second compatible
  source actually exists for that media type, so games and movies/TV
  (currently single-source) show just the one dropdown as before.

## [0.53.0] - 2026-07-07

### Changed
- App lock: Fingerprint/Face ID now always requires a PIN to be set up
  first, as a mandatory fallback — you can no longer set up biometric
  unlock on its own. Removing a PIN that has biometrics attached now
  removes both, since biometric unlock isn't allowed to exist without
  its fallback.
- App lock screen: if a device has both a PIN and Fingerprint/Face ID
  set up, both now show on the same unlock screen (a PIN pad plus a
  "Use Fingerprint / Face ID" button below an "or" divider) instead of
  only one method being available at a time.
- App lock screen: entering the correct PIN now unlocks immediately —
  no need to also press Unlock or hit Enter.

## [0.52.0] - 2026-07-07

### Removed
- Income tracking in Finance is gone — the Type (Expense/Income) field
  on finance entries, the Overview income/expense/net stats, the
  savings-rate stat, and the "Income by category" card have all been
  removed. Every amount now shows as a plain expense (no +/- sign);
  the Overview card is now a single "Expenses" total. Finance CSV
  export no longer has a "Type" column. If your existing data has any
  entries saved with `type: "income"`, they'll be treated as ordinary
  expenses (folded into the same totals) the next time they're saved
  or re-imported — this app only tracks expenses now.

## [0.51.2] - 2026-07-07

### Changed
- Backlog rows: the priority star now sits inline with the title
  instead of on its own line, so the rating/year/length line moves up
  one row — no more wasted vertical space for a single "★".
- Backlog editor: the "★ Prioritize" toggle moved from its own form row
  into a compact star button next to the title field.

## [0.51.1] - 2026-07-07

### Changed
- Backlog priority is now a single "★ Prioritize" toggle instead of a
  1-5 star rating — items are either prioritized or not, no levels.
- The backlog "Dropped" checkbox is now a "Mark as dropped"/"Restore"
  button next to Delete in the backlog editor, instead of a checkbox
  further up the form.
- The bulk-sync button no longer changes its own label to "Syncing…"
  while running — that extra width was pushing the Cancel button onto
  its own line on narrower screens. Live progress ("N/M synced") now
  shows next to the selected-item count instead.

### Fixed
- Bulk sync's Cancel button dropping to its own row on mobile once a
  sync was in progress.

## [0.51.0] - 2026-07-07

### Added
- Backlog items and journal entries now carry a synced "length" for the
  media they're linked to: playtime for games (RAWG), runtime for
  movies, season/episode counts for shows (both via TMDB), and page
  count for books (Open Library/Google Books) — shown alongside the
  existing rating/year line wherever a cover is shown.
- Journal entries can now be moved back to the backlog: a "Move to
  backlog" button next to Delete in the entry editor, the reverse of
  the existing "✓ Done" button that moves a backlog item into the log.

## [0.50.0] - 2026-07-07

### Added
- Finance Summary got five additions: a savings-rate stat on the
  Overview card, a new "Income by category" breakdown (income had no
  breakdown at all before), a real "By month" card with a year-tab
  picker showing actual signed monthly totals (replacing the old flat
  "yearly total ÷ 12" average), a "Recurring vs one-off" split, and a
  "Top expenses" card listing the 5 largest transactions in range.
- The category breakdown cards (expense and income) now show a
  transaction count on hover, same as the Journal Stats category card.

## [0.49.2] - 2026-07-06

### Changed
- Renamed the Finance tab formerly called "Timeline" to "Ledger" — both
  the Journal and Finance sections had a tab named "Timeline", which was
  ambiguous in references outside the nav itself (e.g. Settings, TODO).

## [0.49.1] - 2026-07-06

### Changed
- Moved Currency back under Appearance (it had just moved to Data in the
  previous Settings reorg).
- Trimmed a lot of repetitive Settings copy: dropped the redundant
  "(this device)" tag on Local file, merged Theme/Font's identical
  hints into one line under "Look", cut duplicate "this device only"
  phrasing from Force layout/Cover art/App lock, and shortened several
  other hints.
- The "browser doesn't support saving to a file" message no longer
  singles out Brave by name — it's now phrased as "some browsers" with
  the fix as a bullet point, matching the style of other multi-point hints.
- On mobile, the Journal Timeline tab now sits one position to the right
  in the bottom nav (swapped with Stats) instead of being the leftmost tab.

## [0.49.0] - 2026-07-06

### Changed
- Reorganized Settings: merged the History tab into Data (as a "Version
  history" section alongside storage backend and GitHub sync settings),
  moved Currency from Appearance into Data, combined Theme and Font into
  one "Look" section, and merged Privacy's "App lock"/"Unlock method" and
  Media's "API keys"/"Source per category" into single sections with
  subheadings — 6 tabs down to 5, and every tab's sections now group more
  tightly related controls together instead of listing loosely-related
  ones as peers.

## [0.48.1] - 2026-07-06

### Changed
- Backlog entries now get a divider between prioritized and unprioritized
  items within a category, the same way dropped items already get one.
- Entries/backlog items with no cover art (or a broken cover URL) now show
  a small icon on a background tinted to their category's color, instead
  of a blank box.
- Selecting a category in the filter bar now highlights it with the same
  solid accent pill used for selected years, instead of tinting the pill
  with that category's own color.

## [0.48.0] - 2026-07-05

### Added
- Media sync now strips a trailing "S1"/"Season 1"/"B1"/"Book 1" style
  marker from the title before searching, so entries you tag with your
  own season/book number (e.g. "Breaking Bad S1") still find a match —
  it falls back to the untouched title if the stripped search comes up
  empty, and only the search query is affected, never the saved title.

### Changed
- Gave the sync status line under the logo a bit more breathing room
  from "LifeLog" and trimmed the excess empty space the header was
  reserving below it.

## [0.47.2] - 2026-07-05

### Changed
- Moved the sync status text from a floating pill under the Settings
  button to plain text under the LifeLog logo on the left — the pill
  look is gone and the header now reserves real space for it, so it no
  longer overlaps the filter bar underneath.

## [0.47.1] - 2026-07-05

### Fixed
- The sync status text was making the Settings button drop onto its own
  line on mobile — it's now absolutely positioned below the button
  instead of stacked in normal flow, so it no longer affects the
  header's wrapping.

## [0.47.0] - 2026-07-05

### Added
- Backlog now keeps the current category's header pinned under the top bar
  while you scroll it on mobile, same as the Timeline's sticky year/month
  headers.
- Timeline and Backlog rows with no cover art (or a cover that fails to
  load) now show an empty placeholder in its place, so every row in a
  list is the same height instead of the covered ones standing taller.

### Fixed
- Renaming an entry or backlog item no longer disconnects its synced
  media — the cover/rating/summary link now only clears via the explicit
  "✕ Unsync" button.
- Picking a match from the "🔄 Sync" search button now sticks the same
  way a title-suggestion pick already did, so editing the title right
  afterward doesn't immediately undo it.

## [0.46.1] - 2026-07-05

### Changed
- Moved the sync status indicator (the storage-status LED) out of the
  filter bar and up into the top bar, in a small section right under the
  Settings button — same spot on both desktop and mobile.

## [0.46.0] - 2026-07-05

### Changed
- Settings → Appearance → Cover art: the separate "Show cover art in
  Timeline/Backlog" toggles are gone — pick "None" in the Timeline/Backlog
  cover size dropdown instead, so each view has one control instead of two.
- Removed the "Enable media enrichment on this device" toggle — it was
  redundant with the per-category source dropdowns in the Media tab
  (now always visible), which are the only on/off switch: set a category
  to "None" there to stop fetching metadata for it.

## [0.45.0] - 2026-07-05

### Added
- Bulk edit for Timeline entries now has a "Sync" action, matching
  Backlog — re-fetches cover art and metadata for every selected entry
  from its category's configured media source.
- Settings → Appearance → Cover art: independent "Timeline cover size"
  and "Backlog cover size" dropdowns (Small/Big). Previously Timeline
  covers were always small and Backlog covers always big with no way to
  change either; defaults match the prior look so nothing changes until
  you pick something else.

## [0.44.3] - 2026-07-05

### Fixed
- The bulk-edit action bar could fail to show up, or show up in the
  wrong place, on the Timeline/Backlog/Finance views: the view-switch
  fade-in animation left a `transform` applied to the content area even
  after finishing (a CSS animation fill-mode quirk), which turned it
  into a positioning container for the bar's `position: fixed` — so it
  floated relative to the content box instead of being pinned to the
  bottom of the screen. The animation class is now cleared once it ends.
- Adding an entry (or any other in-view change, e.g. a filter toggle)
  reset the scroll position back to the top every time. Rebuilding the
  view's content on every render briefly collapses the page's height,
  and browsers don't restore the scroll position once content grows back
  — it's now explicitly restored for in-view re-renders, while switching
  views (which should reset to the top) is unaffected.
- Long-pressing an entry's title text to enter bulk-edit mode blocked
  selecting/copying that text. Long-pressing the title now selects the
  text as before; long-pressing anywhere else on the row (category chip,
  badge, padding) still enters bulk mode.

## [0.44.2] - 2026-07-05

### Fixed
- Bulk editing wasn't entering select mode at all on touch devices —
  the long-press was losing the race against the browser's native
  text-selection/callout gesture on the row text. Rows now disable
  text selection so the custom long-press handler gets a clean shot.
- Bulk editing: tapping a row's own checkbox toggled it and then
  immediately toggled it back, because the click event bubbled up to
  the row's click handler after the checkbox's pointerdown handler had
  already applied the change. Selecting/deselecting entries now sticks.

## [0.44.1] - 2026-07-05

### Fixed
- The `?v=` cache-busting query string on `index.html`'s script/stylesheet
  tags hadn't been bumped since v0.40.0 — returning visitors' browsers kept
  serving that old cached JS/CSS after every deploy since, even though the
  server had the new files. Now synced to the app version again.

## [0.44.0] - 2026-07-04

### Added
- Journal Timeline entries now show cover art (not just Backlog), with a
  Settings → Appearance → "Cover art" toggle to turn it on/off; Backlog
  covers got a matching show/hide toggle in the same section.

### Changed
- Mobile bottom nav is slightly taller and now has a subtle drop shadow
  above it, for more visual separation from the content.

## [0.43.0] - 2026-07-04

### Changed
- Mobile bottom nav is now a persistent bar showing all 5 views (Timeline,
  Stats, Backlog, Finance Timeline, Finance Summary) with icon + label at
  once, instead of a collapsed "current view" pill you had to tap open
  first — one tap to switch views instead of two.

## [0.42.0] - 2026-07-04

### Added
- Rich first-run empty states for Timeline, Backlog, and Finance — an icon
  badge, title, body copy, a primary "add" action, and a hint line, instead
  of a single plain sentence.
- Lock screen now has an on-screen numeric keypad with animated PIN-progress
  dots and a shake animation on a wrong PIN, alongside the existing PIN
  field (typing still works for keyboard/desktop users).
- Mobile bottom nav now shows a small icon next to each view's label (in the
  expanded drawer and the collapsed current-view pill).
- Import review picker: a tinted callout with a live count for "N new
  categories found," and "already added" now renders as a bordered badge.
- Settings tabs and the main view now fade in on switch instead of snapping.
- Finance Overview numbers (income/expenses/net) are now color-coded
  green/red/neutral, and Stats/Finance totals count up instead of snapping
  to their new value.

### Changed
- Reconciled the app's color variables onto a two-layer token system
  (surfaces/text/accent/status), fixing several cross-theme contrast bugs:
  accent-filled buttons/tabs used hardcoded white text that was unreadable
  on Nord's light cyan and Dracula's light violet; category filter chips
  used hardcoded white text that was invisible on the Light theme's white
  background; the "By year" stat charts were hardcoded to the old default
  blue instead of following the active theme's accent; Dracula's
  success/warning colors now use its own palette instead of a generic hex
  shared with every theme.
- Mobile content padding tightened to 14px (was inheriting the desktop
  22px/20px), and the month/backlog "+" quick-add button is slightly larger
  on mobile for an easier tap target.

## [0.41.0] - 2026-07-03

### Added
- Backlog items can now be marked "Dropped" (no longer plan to finish
  it) from the Add/Edit backlog modal. Dropped items sink to the bottom
  of their category section, below a separator, and show dimmed with a
  strikethrough title so they're clearly out of the active queue without
  having to delete them.

## [0.40.0] - 2026-07-02

### Added
- Backlog items now have a "Priority" star rating (separate from the
  external critic rating pulled from RAWG/TMDB) — set it in the Add/Edit
  backlog modal, and higher-priority items float to the top of their
  category section so you can see what to tackle first at a glance.
- A "+" quick-add button on each Backlog category section header, same
  as the one on each Timeline month card, for adding directly into that
  category.

### Changed
- Star rating pickers (journal entry rating, backlog priority) now show
  a distinct hover color from the selected/filled color, so it's clearer
  which stars are already chosen versus just under the cursor. Backlog
  priority stars use their own amber color scheme matching the priority
  badge shown on backlog rows, instead of the blue used for entry
  ratings.

## [0.39.0] - 2026-06-25

### Added
- Adding a backlog item now checks whether that title already exists —
  either as another backlog item (duplicate) or as an entry already in
  your journal timeline (already logged). Matches show up in the title
  suggestion dropdown ("📋 Already in backlog" / "✓ Logged ×N · last
  MMM YYYY"), and typing the exact title shows an informational banner
  ("This title is already in your backlog / already logged in your
  timeline") — purely a heads-up, it doesn't block saving.

## [0.38.0] - 2026-06-25

### Added
- Adding a journal entry now also checks your backlog for a matching
  title, not just previous entries. Matching backlog items show up in
  the title suggestion dropdown (tagged "📋 In backlog"); picking one, or
  just typing the exact backlog title, links the entry to it and shows a
  banner confirming it'll be removed from the backlog when you save —
  with a "✕ Don't remove" button to opt out. The existing "✓ Done" button
  on backlog rows now shows the same banner instead of removing silently.

## [0.37.1] - 2026-06-25

### Fixed
- Theme, font, timeline layout and force-layout now apply immediately on
  load instead of after the data finishes loading, removing the brief
  flash of the default look on every page load/reload.

## [0.37.0] - 2026-06-25

### Changed
- Repositioned the global Add and Settings buttons so they don't compete
  for attention: Add is now a floating "+" button anchored to the
  bottom-right corner on every layout, and Settings moved into its own
  spot in the header corner, away from Add and the view tabs.

## [0.36.0] - 2026-06-25

### Added
- Settings → Appearance → "Theme" lets you pick a color scheme: Default,
  Light, Nord, or Dracula. Device-local, not synced.

## [0.35.0] - 2026-06-25

### Added
- Settings → Appearance → "Force layout" lets you pin the app to Mobile
  or PC layout on this device regardless of actual screen size (or leave
  it on "None" for automatic). Useful for previewing the other layout, or
  for pinning one in place on an in-between-sized screen. Device-local,
  not synced.

## [0.34.1] - 2026-06-25

### Fixed
- Finance timeline entries now show the category pill on the left
  (before the title), matching the Journal entry layout instead of
  having it sit between the title and the amount.

## [0.34.0] - 2026-06-24

### Added
- Each month panel (Journal Timeline and Finance) now has a "+" button
  in the top right for quick-adding an entry directly to that month.
- Bulk edit (long-press to select) now also works on Finance entries:
  move to category or delete. Recurring occurrences aren't selectable —
  edit those through the recurring expense itself.
- Bulk edit's month header now has a "select all" checkbox so you can
  select every entry in that month at once, on both Journal and Finance.
- Each Finance month card shows a running total (income minus expenses)
  at the bottom.

## [0.33.0] - 2026-06-24

### Changed
- Finance timeline entries now look like Journal entries: title on the
  left, a colored pill-shaped category chip on the right, and the amount
  staying at the far right. The per-entry date is no longer shown (the
  month card it's grouped under already conveys that).

## [0.32.0] - 2026-06-24

### Changed
- Finance timeline now matches the Journal timeline: entries are grouped
  into year blocks with month cards, with the same sticky year/month
  headers on mobile. Ad-hoc "yearly" entries (no real month) are bucketed
  into a trailing "Yearly" card instead of being mixed into a month.
- Recurring expense edit modal now lists every occurrence it has
  generated so far.
- "Stop repeating" is replaced by a single "Delete" action: it removes
  the recurring template (so no new occurrences are generated) but first
  saves every occurrence it already produced as real finance entries, so
  none of that history disappears.

## [0.31.0] - 2026-06-24

### Changed
- "Add category" and "Add finance category" are no longer in the top
  "+ Add" menu. Instead, a "+" pill at the end of the Categories filter
  row (Journal and Finance) opens the same add-category modal.
- Every category dropdown (Entry, Backlog, Finance entry, Recurring
  expense) now has a trailing "+ Add new category…" option. Picking it
  opens the add-category modal inline and returns you to the form you
  were filling out — with the new category selected on save, or your
  prior selection restored on cancel.

## [0.30.1] - 2026-06-24

### Changed
- Year/category filter pills are now all padded out to the width of the
  widest one in their group, so they line up evenly instead of each
  hugging its own text. Pill text is also always white now, regardless
  of selected state.

## [0.30.0] - 2026-06-24

### Added
- Bulk editing (move to category, delete) for Journal Timeline entries,
  matching the existing Backlog bulk-edit mechanism.

### Changed
- Bulk mode (Timeline and Backlog) is now entered by long-pressing a row
  instead of a separate "☑ Select" button — works for touch and mouse
  alike. The bulk action bar now always stays visible while bulk mode is
  active, even with nothing selected, since Cancel is the only way out.

## [0.29.0] - 2026-06-24

### Changed
- Journal Timeline entry rows now show the category as a small colored
  chip in front of the title, instead of a thin color bar plus faint
  trailing text. Easier to scan which category an entry belongs to at a
  glance, and reuses the same chip style as the category filters.

## [0.28.2] - 2026-06-24

### Fixed
- Hairline gap that could appear between the sticky year and month headers
  in Timeline on mobile, caused by rounding the measured header height to
  a whole pixel; now measured with sub-pixel precision.

## [0.28.1] - 2026-06-24

### Changed
- Timeline year and month headers got more vertical padding, and month
  headers now have a separator line below them to set them apart from the
  entries underneath.

## [0.28.0] - 2026-06-24

### Added
- Sticky year/month headers in the Timeline view on mobile (≤720px). While
  scrolling, the year and month you're currently in stay pinned near the
  top of the screen instead of scrolling away, so it's easier to tell where
  you are in a long timeline. Desktop's multi-column grid is unaffected.

## [0.27.0] - 2026-06-24

### Removed
- Journal "Categories" tab. Editing a category now happens via the ✎
  button on its filter chip, same as Finance categories — no separate tab
  needed. Per-category entry counts (previously shown there) already live
  in journal Stats.

### Changed
- Category reordering (the old tab's ▲/▼ buttons) was dropped along with
  the tab, so journal categories now behave like Finance categories:
  add/edit/delete only, ordered by creation.

## [0.26.0] - 2026-06-23

### Added
- Settings → History tab: browse your last ~20 saves (for GitHub-synced
  data) and restore one with a click. Restoring loads that version's data
  and saves it forward as a new commit — nothing in GitHub's history is
  ever deleted or rewritten. Requires GitHub sync; other backends show an
  explanatory message pointing to the Data tab.

## [0.25.2] - 2026-06-23

### Changed
- Renamed the Finance "Entries" tab to "Timeline", mirroring Journal's
  own Timeline tab.
- Restyled the Journal/Finance tab group headers: each header now
  carries its own divider as part of the same element (a vertical rule
  on desktop, flanking horizontal rules on the mobile dropdown) instead
  of a separate separator element next to plain text.

## [0.25.1] - 2026-06-23

### Changed
- Renamed the "Finance" and "Finance Stats" tabs to "Entries" and
  "Summary" — the new "Finance" group header already says it, so the
  tab labels no longer repeat it (matching Journal's Timeline/Categories/
  Stats/Backlog, none of which repeat "Journal").

## [0.25.0] - 2026-06-23

### Changed
- View tabs are now grouped under "Journal" (Timeline, Categories, Stats,
  Backlog) and "Finance" (Finance, Finance Stats) headers, on both the
  desktop tab bar and the mobile dropdown menu — matching the same
  Journal/Finance grouping already used in Settings → Import / Export.

## [0.24.0] - 2026-06-23

### Added
- Recurring expenses: add a weekly, monthly, or yearly recurring expense
  (Add menu → Add recurring expense) and it automatically appears in the
  Finance list and stats up through today, marked with a ↻ badge. Nothing
  is stored per-occurrence — occurrences are computed on the fly from the
  template, so editing the template (amount, category, note) updates every
  past and future occurrence at once. Stop a recurring expense to keep its
  history but halt future occurrences.
- Centralized import/export in Settings → Import / Export: Journal data
  (Timeline, Categories, Backlog) and Finance data (entries, categories,
  recurring expenses) each now support both JSON and CSV export/import,
  alongside the existing full-backup JSON.
- Every import (full backup, Journal, Finance) now goes through the same
  review screen used by Finance CSV import: pick individual items,
  bulk-toggle whole years/months on or off with one click, and opt in to
  any new categories found in the file before anything is added.

### Changed
- Removed the old entries-only "Export CSV" button in favor of the
  Journal/Finance-scoped export buttons above.

## [0.23.0] - 2026-06-22

### Added
- Finance CSV import now opens a checkbox preview instead of importing
  everything immediately: review each entry, uncheck any you don't want,
  and a "Show entries already in your data" toggle lets you reveal (and,
  if you choose, deliberately re-import) rows that match an existing
  entry. Nothing is force-reimported unless you check it yourself.
- New Export Finance CSV… button (Settings → Import / Export) opens the
  same checkbox picker to choose exactly which Finance entries to
  include in the exported CSV.

## [0.22.1] - 2026-06-22

### Fixed
- Finance CSV import dropped real transactions that had no note (e.g.
  routine fuel fill-ups logged with just an amount). The importer now
  identifies redundant summary rows (category totals, grand total,
  per-month average) by their row label instead of by blank notes, so
  genuine transactions without a note are imported correctly.

## [0.22.0] - 2026-06-22

### Added
- Currency setting (Settings → Appearance): choose between ILS, USD,
  EUR, and GBP — controls the symbol shown on all Finance amounts and
  syncs across devices.

### Changed
- Merged the "Storage" and "Sync" Settings tabs into a single "Data" tab.
- Renamed the "Backup" Settings tab to "Import / Export".

## [0.21.2] - 2026-06-22

### Changed
- Added a visual divider in the "+ Add" menu between the
  media/lifelog entries (Entry, Achievement, Category, Backlog) and the
  finance entries (Finance entry, Finance category).

## [0.21.1] - 2026-06-22

### Fixed
- Finance CSV import always reported "Nothing new to import" on real
  spreadsheet exports — it read transaction columns at the wrong offset
  (off by one), so every real line item's Note cell came back blank and
  got skipped. Also broadened the redundant-row exclusion: the importer
  now correctly skips category-totals, grand-total, and per-month-average
  rows (previously only month-totals rows were excluded), preventing
  those from being wrongly imported as phantom yearly expenses.

## [0.21.0] - 2026-06-19

### Added
- Yearly expenses: a finance entry can now be tied to a year only, with no
  specific month — toggle "Yearly expense" in the Add/Edit Finance Entry
  form to swap the Date field for a Year field (Type is forced to
  Expense). Yearly expenses show up in their year's group in the Finance
  list tagged "· yearly" and roll into the Finance Stats by-year totals
  like any other expense.
- Settings → Backup is now split into "General data" (Export/Import JSON,
  Export CSV — unchanged) and a new "Finance data" section with an
  "Import Finance CSV…" button that reads the yearly pivot-report format
  exported from the source spreadsheet: it pulls real line items out of
  the 12-month transaction grid (skipping the redundant totals/category
  summary rows), defaults their date to the 1st of the month, and turns
  any trailing one-off big purchase (no month, just a year-level amount +
  label) into a yearly expense. Duplicate entries are skipped on re-import.

### Fixed
- Importing a JSON backup never merged finance entries or finance
  categories, so re-importing a full backup silently dropped all finance
  data. Import JSON now merges finance data the same way it already
  merged entries/backlog/categories, with the same duplicate-skipping
  behavior.

## [0.20.0] - 2026-06-19

### Added
- Finance logging: two new tabs, "Finance" and "Finance Stats", visually
  separated from the media/lifelog tabs by a divider. Log income/expense
  entries with date, amount, category, and an optional note; entries are
  filterable by year and category using the same chip filters as the
  Timeline view. Categories are seeded with 7 defaults (Entertainment,
  Food, Fuel, Clothing, Health, Smoking, Other) and are fully editable/
  deletable like any category. Finance Stats shows income/expense/net
  totals, per-category and per-year breakdowns, and a per-month average
  per year. Amounts are formatted as ₪ (Israeli New Shekel).

## [0.19.0] - 2026-06-19

### Changed
- Replaced the "Steam" media source's title search with manual Steam App ID
  entry — Steam's storesearch API has no CORS allowance for browser
  requests, so it could never actually return results (confirmed via
  testing: every search failed with "Failed to fetch"). Categories set to
  "Steam" now show a Steam App ID field instead of the search box; paste
  the ID from the game's store URL (`store.steampowered.com/app/<id>/…`)
  and the cover art is pulled directly from Steam's CDN. GG.deals price
  lookups are unaffected — they already worked from the App ID, not a
  search result.

## [0.18.2] - 2026-06-19

### Fixed
- The service worker intercepted *every* fetch, including calls to RAWG,
  TMDB, Steam, GG.deals, etc., and silently served the app's own
  `index.html` whenever the real request failed (e.g. a CORS block) —
  turning a real network error into a fake 200 OK full of HTML, which
  broke JSON parsing and masked the actual failure reason behind a
  confusing "Unexpected token '<'" error. The service worker now only
  ever touches this app's own files; third-party requests are untouched
  and fail honestly.

## [0.18.1] - 2026-06-19

### Fixed
- Syncing via Steam or fetching GG.deals prices that failed (bad key, rate
  limit, or a browser CORS block) silently showed "No matches found" or
  nothing at all, with no way to tell why short of opening devtools. Sync
  toasts and the price lookup now include the actual failure reason.

## [0.18.0] - 2026-06-18

### Added
- New "Steam" media source for the Games category: syncing a backlog game
  auto-resolves its Steam App ID via Steam's store search, the same flow
  as RAWG/TMDB/etc.
- New GG.deals API key field in Settings → Media. With a key set, backlog
  cards for games synced via Steam show a current lowest-price badge
  (best of retail/keyshop price, sourced from GG.deals).

## [0.17.0] - 2026-06-18

### Changed
- Settings → Media → API keys (RAWG, TMDB) now sync across your devices
  too, like the category-source assignments — paste a key once and it's
  available everywhere, instead of re-entering it on every device.
  Existing local keys are carried over to the synced copy automatically.

## [0.16.0] - 2026-06-18

### Changed
- Settings → Media: the per-category source assignments (which API each
  category uses) now sync across your devices like the rest of your data,
  so you don't have to redo them on every device. API keys still stay in
  this browser only, as before.
- The "Enable media enrichment" toggle moved to Settings → Appearance and
  is now explicitly per-device — each device decides independently
  whether to use the (now-synced) category assignments, e.g. to skip
  fetching on a phone's mobile data while keeping it on at home. Existing
  setups carry their current on/off state and category assignments over
  automatically.

## [0.15.1] - 2026-06-18

### Fixed
- Pairing a new device via the one-link/QR setup could wipe a GitHub-synced
  log: the link-based connect seeded GitHub with this (new, empty) device's
  data as a fallback whenever it couldn't confirm a file already existed at
  the configured path/branch — which could silently overwrite real data on
  a transient API hiccup or branch mismatch. Pairing now only ever joins an
  existing sync target; if it can't find one, it shows an error instead of
  creating/overwriting anything. (Connecting GitHub manually from Settings
  is unaffected — that flow already asks before overwriting either side.)

### Changed
- Lock screen's "Forgot PIN? Reset this device" now requires typing "reset"
  in a follow-up prompt, in addition to the existing confirmation dialog,
  before it wipes this device's local data.

## [0.15.0] - 2026-06-18

### Added
- Settings → Privacy → App lock: a "Stay unlocked for" option (off / 1 / 5 /
  15 minutes / 1 hour) skips the PIN/biometric prompt on this device if you
  already unlocked within that window — covers refreshing the page or
  reopening the app without locking again immediately. Defaults to "Always
  require unlock" so existing app-lock setups are unaffected unless you
  opt in.

## [0.14.0] - 2026-06-18

### Added
- Long-pressing a backlog item (touch devices) now enters bulk-select mode
  with that item pre-selected, as a faster alternative to the "☑ Select"
  toolbar button.
- Backlog now lays out category sections in a responsive grid, like
  Timeline's month-cards — on wide screens, multiple categories sit
  side-by-side instead of always stacking in a single centered column.

### Fixed
- Bulk-select drag-to-paint (press a checkbox and drag across others to
  select/deselect a run) was unreliable on mobile: every checkbox toggled
  mid-drag triggered a full re-render, which could detach the element the
  touch gesture started on and cause the browser to cancel it early. The
  drag now updates checkboxes directly during the gesture and only
  re-renders once it ends.

## [0.13.0] - 2026-06-18

### Changed
- Media sync (cover art, year, summary, rating) is no longer fetched
  automatically while typing a title in the entry/backlog modal. Instead, a
  "🔄" button next to the Title field looks it up on demand, and picking a
  result no longer overwrites the title you typed — it only attaches the
  metadata. A "Synced via [source]" label (with an "✕ Unsync" option) shows
  inside the form under the title once something's attached. Local
  suggestions from your own previously-logged titles are unaffected — typing
  still surfaces and auto-fills those as before.

### Added
- Backlog bulk select: a "🔄 Sync" button in the bulk action bar syncs all
  selected items at once, auto-picking the top match for each (no per-item
  review, since syncing many items individually would defeat the purpose).

## [0.12.1] - 2026-06-18

### Added
- Backlog bulk select: press and drag across checkboxes to select (or
  deselect) a run of items in one motion instead of tapping each one.

## [0.12.0] - 2026-06-18

### Added
- Bulk editing in Backlog: a "☑ Select" toggle above the list reveals a
  checkbox on every item plus a "select all" checkbox on each category
  header. With items selected, a sticky bar lets you move them all to a
  different category or delete them all at once. (Timeline may get the
  same treatment later; Categories and Stats don't need it.)

## [0.11.0] - 2026-06-18

### Added
- Three new media enrichment sources (Settings → Media), all free and requiring
  no API key: **AniList** for anime and manga (better title/cover matching
  than TMDB's general TV search), **Google Books** for books (often better
  cover art and summaries than Open Library), and **MusicBrainz** for a new
  Music/Albums category. Assign any of these per category alongside the
  existing RAWG/TMDB/Open Library sources.

### Changed
- Renamed the "TMDB (TV / anime)" category-source option to "TMDB (TV)" now
  that AniList is available and a better fit for anime/manga.

## [0.10.2] - 2026-06-18

### Fixed
- App lock "Forgot PIN?" reset (added in 0.10.1) only removed the
  PIN/fingerprint requirement and left the data sitting there — meaning
  anyone without the PIN could bypass the lock for free by clicking reset.
  It now wipes this device's local copy of the data and disconnects
  GitHub/the local file when resetting; if either was connected, their
  actual contents are untouched and reconnecting in Settings afterward
  restores everything, otherwise the wipe is permanent. The button is now
  labeled "Forgot PIN? Reset this device" to reflect this.

## [0.10.1] - 2026-06-17

### Added
- App lock screen: a "Forgot PIN? Reset app lock" option clears the
  PIN/fingerprint requirement on that device without touching your data
  (the lock is stored separately from your data, so this can't lose
  anything) — covers a forgotten PIN or unavailable biometric.

## [0.10.0] - 2026-06-17

### Added
- Privacy → App lock: optionally require a PIN or your device's
  fingerprint/Face ID (via WebAuthn) to open LifeLog. This is a per-device
  setting — it's stored locally and never synced to GitHub or a backup
  file, so each device can have its own PIN/biometric (or none at all).
  Note this locks access to the app on this device; it doesn't encrypt the
  underlying data.

## [0.9.5.11] - 2026-06-17

### Changed
- Settings panel box is slightly taller for more breathing room.

## [0.9.5.10] - 2026-06-17

### Fixed
- Settings panel height was driven by the longest tab (Sync, Media) — so
  every tab, even short ones like Backup, inherited a scrollbar sized to
  content it didn't have. The panel now sizes itself to the shorter,
  similarly-sized tabs (Storage/Backup/Appearance); Sync and Media scroll
  within themselves only when their own content actually needs it, and the
  modal no longer resizes when switching tabs.

### Changed
- Settings tab row (Storage/Sync/Backup/Appearance/Media) is now centered
  instead of left-aligned.

## [0.9.5.9] - 2026-06-17

### Fixed
- Settings: the version tag ("LifeLog vX.Y.Z") now stays pinned at the
  bottom of the modal instead of scrolling away with the tab content.
- Settings: tabs whose content fits within the modal no longer show a
  scrollbar — only a tab whose content genuinely exceeds the available
  height scrolls (previously every tab inherited scrollability driven by
  the tallest tab, Sync).

## [0.9.5.8] - 2026-06-17

### Changed
- Settings tab panels now size themselves to their actual content
  instead of using fixed/measured heights — more robust and self-correcting
  if content changes later, while still keeping all 5 tabs the same height
  so switching tabs doesn't resize the modal.

### Fixed
- Modals (Settings and others) no longer let background page scroll leak
  through when their content doesn't need to scroll — the background is
  now locked while any modal is open.

## [0.9.5.7] - 2026-06-17

### Changed
- Settings tabs no longer use one flat tight squeeze across the whole
  mobile range — spacing now eases in gradually with screen width, so
  common phones (390-430px) get comfortable spacing instead of looking
  "snapped together", while only genuinely narrow screens (≤350px) get
  the tightest sizing.
- All Settings tab panels (Storage/Sync/Backup/Appearance/Media) now
  share the same minimum height, so switching tabs no longer
  resizes/jumps the modal.

## [0.9.5.6] - 2026-06-17

### Changed
- Settings tab row (Storage/Sync/Backup/Appearance/Media) now fits on a
  single line on narrow screens instead of scrolling — tabs shrink
  slightly to fit, no more side-scrolling. Also added more breathing room
  between modal headers and their content so the close button doesn't
  feel cramped against what's below it.

## [0.9.5.5] - 2026-06-17

### Fixed
- Settings tab row (Storage/Sync/Backup/Appearance/Media) no longer shows a
  visible scrollbar when the tabs overflow on narrow screens — it still
  scrolls, just without the ugly scrollbar track.

## [0.9.5.4] - 2026-06-16

### Fixed
- Settings → Backup says importing a JSON file "merges with your current
  data — it does not replace it", but it actually replaced everything.
  Import now does what the label says: new entries, backlog items,
  categories, and achievements are added, exact duplicates are skipped, and
  nothing existing is removed or overwritten.

## [0.9.5.3] - 2026-06-16

### Added
- Filter bar: clicking the "Years" or "Categories" label selects all chips;
  clicking again when everything is already selected deselects all.

### Changed
- Backlog: the category header and its items now share a single bordered
  panel instead of two separate boxes.
- Backlog: plain (no-cover) items no longer show a category-colored bar —
  redundant with the section's color dot.

## [0.9.5.2] - 2026-06-16

### Changed
- Backlog: items are grouped under a bordered category panel (same style as
  the Categories tab), so the per-item category label was removed — it was
  redundant with the section header.
- Opening Add/Edit for an entry, achievement, category, or backlog item no
  longer auto-focuses the first field, so it won't pop the on-screen
  keyboard on mobile.
- Backlog edit modal now shows the fetched cover, rating, year, and summary
  (when the item has them), matching what's shown on the backlog card.

## [0.9.5.1] - 2026-06-16

### Fixed
- A previous edit had introduced smart/curly quotes as string delimiters in
  `renderBacklog()`, causing a `SyntaxError` that silently broke the entire
  app (blank screen, nothing loads). Fixed.
- Script/style tags and the service-worker cache name are now versioned, so
  a deploy is no longer at risk of serving a stale cached copy of the app
  code from the browser. Going forward, small fixes bump the version with a
  trailing `.0`/`.1` etc. so you can confirm a new build loaded from the
  version shown at the bottom of Settings.

## [0.9.5] - 2026-06-16

### Added
- **Media enrichment** (opt-in via Settings → Media): while typing a title in the entry or
  backlog modal, LifeLog can fetch cover art, release year, summary, and external ratings
  from third-party APIs and display enriched autocomplete suggestions with thumbnails.
  - **RAWG** for games, **TMDB** for movies and TV/anime, **Open Library** for books (no
    key required). API keys are stored in this browser only — never synced.
  - Per-category source mapping: each category can be assigned an API source (or none).
  - Cover art is shown in the **entry edit modal** header when an entry has one.
  - **Backlog cards** with a cover image display a rich layout: poster, rating, release year,
    and a 2-line summary.
  - Re-entries inherit the cover art from the most recent logged instance automatically,
    without an extra API call.

## [0.9.4] - 2026-06-16

### Added
- The app now remembers which tab you had open and how far you had scrolled.
  Refreshing the page or returning to it later brings you back to the same
  view and scroll position (stored in `localStorage`, per device).

## [0.9.3] - 2026-06-16

### Added
- **Activity heatmap** in Stats: a month-level calendar grid (rows = years newest-first,
  columns = Jan → Dec) coloured by entry count. Hovering a cell shows the exact count and
  period. Always reflects the full unfiltered log so the overall activity pattern is visible
  regardless of active category/year filters.
- **Year in Review** in Stats: year-selector pills default to the most recent year; shows
  total entries, unique title count, best month, top-5 categories (bar chart), most-repeated
  titles, and achievements logged that year.

## [0.9.2] - 2026-06-16

### Fixed
- Settings: removed spurious vertical scrollbar from the tab navigation bar.
- Settings: rewrote descriptions in all four panels (Storage, Sync, Backup,
  Appearance) with clearer language; Appearance now uses bullet points.
- Stats: hovering a category bar row now shows the unique title count with a
  small "unique" label beneath it, making the number self-explanatory.
- Bottom bar (mobile): removed the ▾ arrow icon from the active-view button.
- Bottom bar (mobile): the view-switcher popup now sizes and anchors itself
  to the active-view button instead of spanning full screen width.
- Filter bar: "Years" and "Categories" labels now share a fixed min-width so
  filter chips start at the same indent on every row.

## [0.9.1] - 2026-06-15

### Fixed
- Mobile bottom nav: tapping the active view (e.g. "Timeline ▾") no longer
  hides its button and reshows it in the popup menu. The button now stays in
  place, and the menu that opens above it lists only the other views.

## [0.9.0] - 2026-06-15

### Changed
- Settings is now organized into four tabs — Storage, Sync, Backup, and
  Appearance — instead of two. The old "Cloud sync" section (which mixed
  GitHub connection setup, device pairing via QR code, and sync-polling
  frequency) is now split into separate "Cloud sync", "Share with another
  device", and "Sync frequency" sections under the new Sync tab.

## [0.8.0] - 2026-06-15

### Added
- The sync status indicator now shows when a save didn't reach GitHub or your
  local file backup ("unsynced changes, will sync when online"), and keeps
  showing it across reloads until it's resolved.
- Pending saves are automatically retried as soon as the connection comes
  back or the tab regains focus — no need to make another edit to re-trigger
  a sync.
- Settings → Data → Cloud sync: a "Check for updates from other devices"
  option (off / 10s / 30s / 1 min / 5 min) periodically polls GitHub while
  connected and pulls in changes saved from another device automatically.

## [0.7.0] - 2026-06-15

### Added
- Rating and notes are now available when *adding* a new entry too, not
  just when editing one.
- Notes field for backlog items, so you can jot down why something's on
  your list.
- Notes field for achievements, for extra details about how you got there.

## [0.6.0] - 2026-06-15

### Added
- Rating and notes for entries: when editing an existing entry, give it a
  1-5 star rating and an optional note/review, shown below the other
  fields. Rated entries show their stars on the Timeline and Categories
  views.

## [0.5.0] - 2026-06-15

### Added
- When adding/editing an entry, typing a title now suggests matching titles
  you've logged before (with how many times and when you last logged it).
  Picking one fills in the exact title and category — handy for rewatches,
  replays, or rereads.
- Stats: a new "Most repeated" card lists titles you've logged more than
  once, ordered by how many times.

## [0.4.0] - 2026-06-15

### Added
- Font choice in Settings → Visual: pick Default (system), Serif, Monospace,
  or Rounded. Applies throughout the app and is remembered on this device.

### Changed
- Mobile bottom bar now shows only the active tab (e.g. "Timeline ▾");
  tapping it opens a menu with the other views, and tapping a view or
  outside the menu closes it.
- The `+ Add` and ⚙ Settings buttons are accent-colored again on both
  desktop and mobile.

## [0.3.0] - 2026-06-15

### Added
- New "Backlog" tab for things you want to watch, play, or read later.
  Add items via "+ Add" → "Add to backlog", then click "✓ Done" on an item
  to move it into your log (opens the Add entry form pre-filled with its
  title and category).

## [0.2.2] - 2026-06-15

### Changed
- Timeline layout (month-card min/max width, in Settings → Visual) is now
  stored locally on this device instead of syncing with the rest of your
  data — each device can have its own preferred layout. Existing synced
  values are migrated to this device automatically on first load.

## [0.2.1] - 2026-06-15

### Changed
- Categories tab: the expand arrow now sits to the right of the category
  name instead of between the color dot and the name.
- The "Oldest first / Newest first" month-order toggle moved out of the
  filter bar (where it showed even on Categories/Stats) into its own
  toolbar above the Timeline.

### Fixed
- Year achievements that are numerous or have long text no longer overflow
  or break the timeline layout — they now wrap onto multiple lines.

## [0.2.0] - 2026-06-15

### Added
- On load, if GitHub, the connected local file, and this browser's cache
  hold data saved at different times, show a picker listing each version
  with its save time and entry count so you can choose which one to keep.
  The chosen version is then copied to all the other connected targets.

## [0.1.0] - 2026-06-15

### Added
- Version label ("LifeLog vX.Y.Z") at the bottom of Settings, so you can
  confirm which build is currently loaded after a deploy.

### Changed
- Taller mobile bottom navigation bar with more breathing room.
- The `+ Add` and ⚙ Settings buttons now use the same neutral color on
  both desktop and mobile (previously Add was accent-colored).
