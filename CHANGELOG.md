# Changelog

All notable changes to LifeLog are documented here. The version number
always matches `APP_VERSION` in `src/app.js`, shown as "LifeLog vX.Y.Z" at
the bottom of Settings.

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
