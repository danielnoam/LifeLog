# Done

What LifeLog does today, grouped by area, one line per feature with the
version it came in (or was last reshaped in). Built from CHANGELOG.md on
2026-10-17; features that were later removed are left out. CHANGELOG.md has
the details of each release, NOTES.md the reasoning, TODO.md what's left,
DROPPED.md what was turned down.

Every release that adds a feature adds its line here in the same commit.

## The app as a whole

- Five tabs, each with modes: Notebook, Timeline, Backlog, Ledger, Travel (0.126.0, Travel 0.241.0)
- Every tab and mode has its own name: Notebook (Notes, Habits), Timeline (Log, Stats), Backlog (List, Discover, Upcoming), Ledger (Expenses, Summary) (0.231.0)
- Swipe between modes like a pager, and round from the last to the first (0.177.0)
- Press and hold a tab for its modes; tap the current tab to step modes or scroll to the top (0.125.0, 0.264.2)
- Turn off the tabs and modes you don't use, per device (0.168.0)
- Reorder tabs and modes, and choose the mode a tab opens on (0.188.0)
- Remembers the open tab and scroll position across reloads (0.9.4)
- The + menu adds anything from any tab (0.229.0)
- One search across everything, with the tab's own filter kept (0.251.0)
- Keyboard shortcuts: N to add, number keys for tabs, Shift+number for a second mode, / to search, ? for the list (0.86.0, 0.127.0, 0.188.0)
- Lists update in place, move instead of jumping, and rows fade in and out (0.129.0 to 0.139.0)
- Sheets fade and rise in, swipe down to close, and keep focus where it was (0.209.0, 0.222.0, 0.223.0)
- Notices stack as pills (0.267.2)
- Lucide icons everywhere, no emoji in the UI, and the timeline-pin app icon (0.247.0)
- "New version ready" with a Reload button (0.118.0)
- Activity: everything that takes a while in one list, with a ring or pill while it runs (0.244.0)
- Work on the same site waits its turn; different sites run side by side (0.244.0)
- Work the app was closed on is offered again (0.245.0)
- Share into LifeLog from other apps: titles to the Backlog, Maps links to a trip, the rest as a note (0.250.0)
- PWA: installable, works offline, app-icon shortcuts for Add entry and Add expense (0.83.0)

## Timeline (Log)

- Entries grouped by year and month, with per-year accomplishments (0.1.0 or earlier)
- Rating and notes on an entry (0.6.0, 0.7.0)
- Title suggestions from past entries and the backlog (0.5.0, 0.38.0)
- Cover art, genres and length from the media lookups (0.44.0, 0.51.0, 0.72.0)
- Started month, for things that took more than one month (0.95.0)
- In progress card at the top, with ✓ Done logging the months it took (0.218.0)
- Move an entry back to the Backlog (0.51.0)
- More… in the entry sheet (0.220.0)
- Bulk select by long press: move, delete, sync (0.30.0, 0.45.0)
- + on each month card for a quick add (0.34.0)
- Sticky year and month headers on phones, and a quick-jump row (0.28.0, 0.77.0)
- Newest or oldest first, and optional month summaries (0.157.0, 0.143.0)

## Timeline (Stats) and Recap

- Totals by category and year, with filters (0.1.0 or earlier)
- Activity heatmap that jumps to a month (0.9.3, 0.89.0)
- That year in numbers (0.9.3, renamed 0.167.0)
- Most repeated titles (0.5.0)
- Highlights, monthly pattern and genres cards (0.72.0)
- Completed from backlog count (0.82.0)
- Recap: a yearly slideshow offered in December, with covers, notes, habits and spending (0.167.0, 0.170.0, 0.171.0, 0.225.0)

## Backlog

- What you mean to get to, grouped by category, with ✓ Done moving it to the Timeline (0.3.0)
- Duplicate check against the backlog and the Timeline when adding (0.39.0)
- Prioritize star, Dropped, Bought (0.51.1, 0.41.0, 0.108.0)
- Bands: prioritized, regular, Early Access, Unreleased, Dropped, each folding by its own setting (0.158.0, 0.159.0)
- Not-yet-released items set aside, with TBA for no date (0.63.0, 0.112.0)
- Early Access marked, cleared at 1.0, settable by hand (0.115.0, 0.138.0)
- How far a show has run, and a Still airing band (0.265.0)
- Authors on books (0.267.0)
- Choose what a category's items offer: In progress, Bought, Author (0.267.0)
- Sort control inside each band: name, release date, price (0.157.0)
- Pick random and Spin, scoped to the filters, with Bought only (0.82.0, 0.105.0, 0.110.0)
- How long an item has sat there (0.82.0)
- Game descriptions, Steam's own for Steam games (0.101.0)
- GG.deals retail price on Steam games (0.18.0, 0.67.0)
- Store and source links on the cover (0.66.0, 0.92.1)
- Bulk select with drag, move, delete, sync (0.12.0, 0.12.1, 0.13.0)
- Discover mode: Popular now and Coming soon per source, Hide what I have (0.113.0, 0.114.0)
- NYT bestsellers as Discover's Popular list for books, with a NYT key (0.272.0)
- Upcoming mode: what's coming by month, with how much of the date is known, countdowns and next episodes (0.99.0, 0.98.0)
- Out today card and sheet, and Out in the last 7 days (0.226.0, 0.227.0, 0.259.0)
- A notification on release day, for starred items or everything (Android, iPhone) (0.272.0)

## Media lookups

- A media source per category, with a fallback source (0.9.5, 0.54.0)
- Sources: RAWG, TMDB, AniList, Jikan, Open Library, Google Books, MusicBrainz, Steam, SteamGridDB (0.9.5, 0.11.0, 0.18.0, 0.74.0)
- RAWG or SteamGridDB + Steam + GG.deals game sources (0.65.0, 0.99.6)
- Sync button shows matches from both sources as each answers (0.88.0, 0.99.3)
- Season and book markers stripped before searching (0.48.0)
- Advanced: keep my own value, set a Steam App ID by hand (0.100.0, 0.111.0)
- Release dates re-checked, keeping up with airing shows (0.98.0, 0.265.0)
- Re-checked again on the day an episode or a release is due, and the day after (0.271.0)
- Source choices and API keys sync between devices (0.16.0, 0.17.0)
- Self-hosted CORS proxy for Steam and SteamGridDB on the web; no proxy needed on Android (0.59.0, 0.215.0)

## Imports and exports

- Steam wishlist import, with automatic checks and retries (0.59.0, 0.60.0, 0.61.0)
- Steam games you've played, with a minimum play time (0.253.0, 0.255.0)
- AniList: every list, Completed as timeline history, Paused and Dropped as dropped (0.73.0, 0.265.0, 0.268.0)
- Letterboxd import (0.252.0)
- Google Maps lists and places into a trip (0.242.0, 0.245.0)
- Markdown, PDF and EPUB files as notes, run as Activity jobs (0.200.0, 0.236.0, 0.268.0)
- One review screen for every import: pick rows, edit a row, see what an update writes (0.24.0, 0.258.0)
- Imports can update what you have, only filling gaps (0.151.0, 0.154.0)
- Imports remember what you skipped, and can be undone (0.257.0, 0.256.0)
- JSON and CSV export and import per tab, and everything as one CSV (0.191.0, 0.192.0)

## Notebook (Notes)

- Notes with date and time, edited mark, and optional titles (0.119.0, 0.199.0)
- Three kinds of note: plain, list, quote (0.195.0)
- Lists are the checklist: items tick, merge item by item between devices, reorder by long press (0.197.0, 0.122.0)
- Drawing boards, as a kind of note (0.193.0, 0.194.0, 0.204.0)
- Note categories, collections that open notes as pages, favourites (0.195.0, 0.204.0, 0.196.0)
- Show, sort and type filters (0.195.0, 0.214.0)
- Bulk select, and make a note into a timeline entry (0.142.0)

## Notebook (Habits)

- Habits to do or to avoid, every day or certain days, times a day (0.171.0, 0.203.0)
- One tap to tick today, a grid you can page back through (0.171.0, 0.172.0)
- Backfill a run of days, a start date you can move, undo (0.172.0, 0.173.0)
- Streaks and how long you've kept it (0.173.0)
- Archive rather than delete (0.171.0)
- Ticks merge per date between devices (0.171.0)
- Habit reminders on Android and iPhone (0.183.0, 0.217.0)

## Ledger

- Expenses by year and month with a running total per month (0.20.0, 0.32.0, 0.34.0)
- Amount field does basic math, and takes a pasted price with its currency (0.93.0, 0.228.0)
- Spend in another currency, with rates looked up for the expense's date (0.146.0, 0.160.0)
- Recurring expenses: weekly, monthly, yearly, with a charged-on day (0.24.0, 0.228.0)
- Edit or skip one occurrence, link past expenses (0.57.0, 0.84.0, 0.56.0)
- Change plan, stop, pause, resume, make recurring, convert to entries (0.96.0, 0.97.0)
- Recurring expenses billed in another currency, with per-charge rates (0.165.0)
- Merge recurring expenses into one plan, with one-off charges on it (0.232.0, 0.233.0)
- A reminder before a recurring charge, per plan and per phone (Android, iPhone) (0.272.0)
- Projects to group and total one-off spending, with a filter and a + on each pill (0.145.0, 0.149.0, 0.156.0)
- Where each month's money went (0.104.0)
- Summary: highlights, recurring, by month, by category, top expenses (0.50.0, 0.91.0, 0.57.1)
- Google Wallet payments offered to the Ledger, and expenses from a link (Android) (0.238.0)

## Travel

- Travel tab with trips, off by default (0.241.0, 0.248.0)
- By time, By area and Map modes, and Arrange (0.242.0, 0.243.0)
- Areas named after their town (0.245.0)
- Google rating, opening hours and reviews on a place, with your Places key (0.245.0)
- Trips have history and the file backup (0.245.0)

## Sync and data

- GitHub sync to a private repo, with a local file as a mirror (0.1.0 or earlier)
- Pick which copy to keep when copies disagree (0.2.0)
- Unsynced changes shown and retried when back online (0.8.0)
- Check for other devices' changes on a timer, now light (0.8.0, 0.264.0)
- Real merges between devices, with conflicts called out (0.58.0, 0.85.0)
- History of saves, restore one, undo one change (0.26.0, 0.58.0, 0.185.0)
- Recently deleted, in History (0.85.0, 0.199.0)
- Draws your own copy first, then reconciles in the background (0.94.0, 0.164.0)
- A burst of edits is one save (0.180.0)
- Data remembers the newest version that wrote it, and warns a device that's behind (0.117.0)
- This device's copy in IndexedDB (0.268.0)
- Setup link to add another device (0.174.0)
- Restore settings from a backup (0.194.0)

## Privacy and security

- App lock with a PIN, fingerprint or face, and a stay-unlocked window (0.10.0, 0.15.0, 0.53.0)
- Lock hardened, with Ask as the app opens and phone-only switches (0.262.0)
- Sync setup asks for a fine-grained token for one repo, and refuses a public repo (0.260.0, 0.259.2)
- A setup link asks before connecting (0.259.2)
- Exports and the phone backup leave out API keys (0.260.0)
- The apps stay out of the phone's cloud backup (0.261.0)
- Content Security Policy (0.263.0)

## Settings

- Settings as a list of pages, with search (0.186.0)
- Themes: Default, Light, Nord, Dracula (0.36.0)
- Fonts and layout per device (0.4.0, 0.186.0)
- Cover art size per view (0.45.0)
- Currency (0.22.0)
- About: what's new, repo links, credits, and errors on this device (0.232.0, 0.246.0, 0.264.0)

## Android app

- LifeLog for Android, built and published on every release (0.174.0)
- Updates itself (0.179.0)
- Back closes what's open first, edge to edge, pull down to sync (0.174.0, 0.178.0, 0.176.0)
- Scan a QR code to connect (0.175.0)
- Fingerprint and face unlock (0.184.0)
- A backup on the phone (0.215.0)
- Widgets: checklist, habits, quick add, spending, note, random note (0.181.0, 0.185.0, 0.199.0)
- Widgets shrink to small sizes, show previews, use the app's icons (0.189.0, 0.185.0, 0.269.0)
- Widget settings: pick and order lists, habits and quick add buttons (0.199.0, 0.201.0, 0.266.0, 0.270.0)

## iOS app

- An iPhone app, unsigned, for sideloading with AltStore or SideStore (0.216.0)
- Widgets, habit reminders and Face ID (0.217.0)
- Share sheet extension (0.250.0)

## The AI bridge

- An MCP server and command line for other AIs to read and change LifeLog (0.239.0, 0.240.0)
- Connects with the app's setup link (0.239.1)
- Trips: read a plan, add, move, schedule and remove places, read Google Maps lists (0.241.0, 0.242.0)

## Building and shipping

- Tests gate every publish: the APK, the IPA and the web app wait on the unit and browser tests in CI (0.271.0)

## Accessibility

- Contrast checked in every theme, 44px touch targets on phones (0.219.0, 0.220.0, 0.222.0)
- Keyboard reach for chips, labels on icon buttons, focus rings (0.86.0, 0.87.0)
- Screen reader and keyboard pass (0.254.0)
- Reduce motion turns off every animation (0.136.0)
- Consistent type and spacing scales (0.223.0)
