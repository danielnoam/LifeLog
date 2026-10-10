# Browser suites

    node test/browser/run-all.js            every suite
    node test/browser/run-all.js fxrate     one (substring match)
    node test/browser/fxrate.js             one, against a server you started

`run-all.js` serves the repo on a free port and passes it down, so there is
no port to remember and no stale server to collide with. Each suite runs as
its own process: a crash takes that suite down rather than the run, and a
suite killed by the timeout can't leave `localStorage` behind for the next
one — which is how the ad-hoc scripts these grew out of used to drift.

Playwright is not a dependency of this project. `harness.js` looks for it in
the usual global spots and prints how to install it if it can't find one.

## What these are for

The unit tests under `test/` cover pure logic and never touch a DOM. These
cover the things that can only be wrong in a browser, and most of them exist
because something shipped broken that no unit test could have caught:

| suite | what it pins down |
|---|---|
| `synctoast` | the offline warning doesn't fire while the status line says "Synced" |
| `pollpeek` | a poll reads lifelog.json only when the folder listing says its sha moved; the error log in Settings → About |
| `recurtools` | a pasted price's currency, a monthly plan's charge day and its overrides following it, the link offer ticking only lookalikes, plans merging into one history (overlap kept as one-off charges, one row in the list), Undo putting them back, adding and deleting a one-off charge, and a merged bill as one bar in the Summary |
| `fxrate` | rate lookup: URLs, fallback order, date pinning, precision, and the hint's spacing |
| `bandfold` | each set-aside band folds on its own setting, and an all-one-band category still gets a bar |
| `droppedfold` | the Dropped fold, including that its rows are dimmed on the frame they appear |
| `sorting` | every sort option means what it says at every level |
| `everymode` | the bulk bar and progress panel in all five bulk-capable modes |
| `btnaudit` | no pressable anywhere, rows and cards included, draws the browser's tap-highlight |
| `press` | a tap still visibly responds now that the highlight is gone |
| `v151`, `importkinds`, `importmodes` | import updates: what gets filled, for which kinds, and never a duplicate |
| `boards` | the drawing board: every tool with mouse and touch, resize/rotate/fill, undo, a reload, PNG/SVG/JSON out and back, History bringing a board back, the boards file, and boards.json syncing and merging against a fake GitHub |
| `notekinds` | notes' three kinds through the sheet and the cards, categories and their chips, the Types row, the sort, a list working like the old To-do panel (add, edit, delete, reorder, Clear), favourites, bulk move |
| `noteopen` | a note widget's tap opening its note, or saying it's gone; no Open items filter under Lists |
| `mdimport` | Markdown files, a PDF and a folder as notes: one row per file, an unreadable PDF saying why, a file's own category, filing the selected under an existing, new or folder category, lists from task files |
| `collections` | a collection category: its notes off the feed, its chip marked ▦, its own page of cards by name, category chips adding up (several collections are one page of all their cards; one beside a plain category is the feed of both), the reader drawing Markdown (safe links only), Edit from there, the category sheet's switch; Boards as a kind of note, with a category and a ★; selecting in a collection and by holding a note's words |
| `renames` | renaming a project, an expense category or a note category carries every expense, recurring bill, one-off charge, note and board that names it |
| `travel` | the Travel tab: a trip from its empty state, places on a day with and without a time and with none, a day's order, ticking visited, a reload keeping it all, Undo after a delete, the trips as chips (picking, ✎, a second trip) |
| `travelmap` | Travel's Google Maps import (faked proxy routes): a list picked by area, no place added twice, a single place link; a long press into sorting and a place dragged onto a day; the modes by swipe; By area; the map's pins, day chips, route and pin/row link, at phone and desktop width |
| `travelmore` | Travel 0.245.0 (OpenStreetMap and Google Places faked): areas named after their town, asked once and cached; the import map's pins picking places, by keyboard too; Google's rating, hours, reviews and link on a place, only its id saved; Settings → History bringing a trip back, and Undo |
| `notesheet` | a plain note's optional title, a list's items without ticks or a quick-add switch, a quote's author and source side by side |
| `todomigrate` | the To-do mode's lists become list notes: old data, whoever left the app on To-do, and an older device still adding and ticking to-dos through a fake GitHub |
| `tabio` | every tab's JSON and CSV export comes back whole through that tab's import, and the full backup through Everything |
| `match` | auto-sync asks both sources and refuses a near-miss |
| `realloop` | the real bulk-sync loop feeds the progress panel live |
| `ios` | the iOS app: a newer release offered as its page rather than an APK, the QR scan without Google's module, the backup where Files shows it, a widget's lifelog:// link opening the right thing, the widgets' snapshot, Face ID, no folder import |
| `outtoday` | Out today: the card above Next releases for what's out today (not started ones), the list not repeating it, and the once-a-day sheet: shown on the first open, not again, again next day, not on an empty day, off by setting |
| `inprogress` | In progress: started from a backlog row, the sheet and the card's +, off the Backlog and onto the Timeline's card (chips apply), ↩ back, ✓ Done logging the months it took (or one month), and a reload keeping it |
| `phonebackup` | the Android app's copy in Documents/LifeLog: off until turned on, written at once and on every save, a day's copy kept for fourteen days, refused storage said out loud, and no sign of it in a browser |
| `activity` | Activity and background work: a pass shows in the pill and the sheet with its progress, a second pass on the same site waits its turn, Stop keeps what was done, a failure stays up until seen, Settings → Activity, the desktop header button, and in a faked phone app the hold/release calls, the notification's Stop and tap; a pass the app was closed on offered again (Run again, ✕), with what it did saved every 5 |
| `nativehttp` | Steam, SteamGridDB and GG.deals from the app with no proxy: each route reaches the address the worker would, headers and query intact, nothing else relayed, and a browser's proxy untouched |
| `projadd` | the project pill's + opens the form already on that project |
| `tabmenu` | the desktop tab menu: no flash while crossing the bar, open under the pointer from menu back to tab, swapped along the bar; a tab's number again stepping through its modes |
| `anilist` | a show's airing state on its row and in the Still airing band (folding); the AniList sync bringing in Planning, starting Watching, moving Completed off the backlog with Undo; the re-check finishing an ended show |

## Writing one

Assert on what the eye reads, not on the property you changed. Three visual
regressions shipped green past tests that checked a single property — the
lesson is in NOTES.md and the shape is: compare colour *and* weight *and*
geometry, sample mid-animation when the bug is a timing one, and check that
the test fails without the fix before trusting it.
| `share` | share into LifeLog (0.250.0): the three doors meet in one action; a Maps link imports into a trip, a media link opens the Backlog sheet, anything else offers item or note |
| `search` | one search across everything (0.251.0): results grouped by tab, rows opening the thing, Filter lines narrowing the tab, Escape and arrow keys |
| `letterboxd` | the Letterboxd export zip into the review: diary as dated, rated entries, watched without a diary line, the watchlist as backlog, duplicates hidden |
| `steamowned` | Steam played-games backfill (0.253.0): the keyed owned-games route, every played game as an entry in the review, two hours or more ticked, duplicates and never-played hidden, a second run offering only what was left |
| `a11y` | screen readers and keyboards (0.254.0): every sheet a named aria-modal dialog that takes focus on open, Tab wrapping inside it, focus back to the opener, the toast's words in the live region, the tab bar a tablist the arrows move through |
| `importreview` | the review on a long import (0.255.0): years with months behind a chevron, counts on the chips, Import on screen on a phone, search and sort, the by-kind count line |
| `importundo` | Undo in the import toast (0.256.0): added rows go, filled fields return to empty, a created category goes when unused, what was there stays |
| `importedit` | editing a row before import (0.258.0): the pencil's form, Done writing title, month, category and rating back, the edited mark, an update row's values |
| `outweek` | Out in the last 7 days (0.259.0): the Upcoming bar's button and count, the sheet as Out this week with dated tiles, three in a row, and one release as one large tile |
