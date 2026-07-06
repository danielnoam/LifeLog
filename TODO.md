todo:

- improve the Finance summary section (richer breakdown, not just the
  current Overview/By category/By year/Per month average cards)
- when setting up fingerprint/Face ID app lock, require a PIN to be set
  too (as a fallback), not just the biometric
- rework version history so restoring works fully offline / without
  GitHub connected — every action needs to be restorable, and restoring
  needs to work perfectly regardless of connection
- make sure sync correctly reconciles actions done while offline with
  actions done on other devices during that same offline period, once
  back online
- add playtime for games, length for movies, episode/season counts for
  shows, and book length if possible — most important for backlog
  entries, not just logged ones
- auto wishlist import for Steam, and GG.deals cost support for it

done:

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
