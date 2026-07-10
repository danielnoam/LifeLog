todo:

- continue breaking app.js into per-view modules, same init(ctx) +
  window-global pattern as finance.js/media.js/qr.js, until app.js is
  just the shell (boot/data load, tab routing, shared state + helpers):
    1. src/settings.js — settings modal rendering + all its tabs
    2. src/backlog.js — backlog view (covers, priority, dropped,
       duplicate checks, wishlist import hooks)
    3. src/journal.js — journal timeline, stats, and entry modal
       (what's left is the shell)
- extend test/merge.test.js's plain-node test pattern to the other
  data-touching code: finance recurringOccurrences (overrides, month
  clamping, end dates), the sanitizers, and normalize()'s migrations
- SteamGridDB back as a games cover-art source/fallback (removed earlier
  for being CORS-blocked with no proxy in front of it) — the CORS proxy
  (`proxy/worker.js`) already has a `/steamgriddb/<path>` route ready for
  this, it just needs wiring back into media.js's source list and the
  Settings API key field
- Stats: trends over time — line/bar view of entries per month or per
  year, per category, using data Stats already has (no new fields needed)
- Stats: auto-generated insight callouts — a few computed one-liners
  each time Stats opens (busiest month, longest active streak,
  highest-rated category, year-over-year delta) — no new fields needed
- Stats: genre/tag breakdown — add a genres[] field alongside the
  existing coverUrl/length/rating fields each media source already
  fills in (RAWG has genres, AniList has genres, TMDB needs one extra
  genre-id lookup, Jikan has genres, Open Library/Google Books via
  subjects where available); backfilled only on next sync, no
  migration needed for existing entries; then a breakdown view in Stats

done:

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
