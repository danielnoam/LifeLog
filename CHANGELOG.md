# Changelog

All notable changes to LifeLog are documented here. The version number
always matches `APP_VERSION` in `src/app.js`, shown as "LifeLog vX.Y.Z" at
the bottom of Settings.

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
