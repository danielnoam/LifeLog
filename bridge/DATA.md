# LifeLog's data

Everything LifeLog keeps is one JSON document, `lifelog.json`, in the user's
private GitHub repo (normally `<owner>/lifelog-data`). Every device and the
bridge read and write that one file. A device folds in another's save with a
three-way merge keyed on each item's `id` and `updatedAt`, so an item must
keep its `id` forever, and any change must give it a fresh `updatedAt`. The
bridge does both for you.

General rules:

- Dates are `YYYY-MM-DD` in the user's local time. Timestamps (`createdAt`,
  `updatedAt`, `doneAt`) are ISO 8601 in UTC.
- Ids are short strings like `emuu940cfj78y`. Never reuse or change one.
- `category` and `project` hold a **name**, not an id. They must match an
  existing category or project exactly, which is why tools ask for names from
  `lifelog_overview`.
- Money: `amount` is always in the **home currency** (`settings.currency`,
  default ILS). Something paid in another currency also keeps `currency`,
  `fxAmount` (what was paid in it) and `rate` (home currency per one unit),
  and `amount` is `fxAmount × rate`. All three or none.
- Fields this list doesn't mention may be present: a newer app version wrote
  them. Leave them as they are.
- The top level also holds `version` (the format, 1), `appVersion` (the
  newest app build that has written the file), `exportedAt` (when it was
  last saved) and `settings`.

## Timeline (`entries`)

What was done or finished, filed under a month. A game, book, show, trip,
event or anything else, by category.

- `id`, `createdAt`, `updatedAt`
- `title`: what it was.
- `category`: a name from `categories`.
- `year`, `month` (1-12): the month it's filed under, where it finished.
- `date`: the same month as `YYYY-MM`. Always `year` and `month` together.
- `day`: optional, the day of the month it finished (1-31). Saved since
  0.281.0 but not shown anywhere yet; older entries don't have one.
- `startYear`, `startMonth`: optional. A span that began in an earlier month.
- `startedAt`: optional `YYYY-MM-DD`, the day it was started (carried over
  from the backlog, or picked in the entry's Started field).
- `rating`: optional, 1 to 5 stars.
- `notes`: optional text.
- `coverUrl`, `mediaId`, `mediaSource`, `length`, `genres` (up to 4): what a
  media lookup filled in (cover art, the source's id, how long it is).
- `author`: optional, a book's author. A books lookup (Open Library, Google
  Books) fills it in; the user can type one too.
- `overrides`: values the user set by hand over a lookup's (`cover`,
  `length`, `author`). An author typed by hand has `author: true` here, and
  a lookup then neither replaces it nor ignores it: it searches with it.
- `externalRating`: optional, the lookup source's own score with the
  source named after it ("84 Metacritic", "7.8 TMDB", "85% AniList",
  "4.2 OL" for Open Library, "8.1 Jikan" for MyAnimeList). Carried over
  from the backlog item it was finished from, or set by the entry sheet's
  sync. Shown as a pill on the sheet's cover.
- `hltb`: optional, a Steam game's How Long to Beat times in minutes:
  `story` (main story), `extras` (main + extras), `complete`
  (completionist), `url` (the game's HLTB page) and `at` (`YYYY-MM-DD`,
  when they were last asked). From Augmented Steam's API, by Steam App ID.
  When it has a `story` time, `length` is that time ("32 hrs", "53½ hrs")
  unless the length is pinned. An `hltb` with only `at` means nothing was
  known that day.
- How long something is counts in its own unit, never converted
  (`lengthKey` in src/backlog.js): HLTB's `story` time, else the hours,
  pages, episodes, chapters, volumes or seasons read out of `length`.
  Short, Medium and Long (the Pick sheet's chips, `lifelog_backlog` and
  `lifelog_pick`'s `length`) cut each unit on its own: up to 5 hrs, 250
  pages, 13 episodes, 50 chapters, 5 volumes or 1 season is short; 25 hrs,
  500 pages, 40 episodes, 200 chapters, 20 volumes or 5 seasons and up is
  long; no length known is neither.
- `reviews`: optional, a Steam game's scores out of 100, from the same
  place: `opencritic` and `metauser` (Metacritic's user score), each
  `{ score, verdict?, url? }`.
- `backlogAddedAt`: when it was added to the backlog, if it came from there.

## Backlog (`backlog`)

Things to play, read, watch or do next.

- `id`, `createdAt`, `updatedAt`
- `title`, `category` (a name from `categories`), `notes`
- `author`: optional, as on a timeline entry.
- `priority`: 1 when starred; starred ones come first.
- `bought`: true when already owned.
- `priceAlert`: a price in US dollars for a Steam game; the app says when
  GG.deals' retail price is at or under it (a toast, and a notification on
  a phone). Only meaningful with a `mediaSource` of `steam`.
- `dropped`: true when given up on. Kept, but out of the way.
- `startedAt`: `YYYY-MM-DD` when started (it shows as in progress).
- `progress`: episodes watched (chapters read for a manga), a whole number
  above 0, shown on an item in progress where its category's
  `showProgress` is on. `progressAt`: an ISO time, when the count last
  changed (by hand, the bridge or AniList). Set them with
  `lifelog_set_progress`. For an AniList title (`mediaSource`
  `anilist-anime` or `anilist-manga`) the app's two-way sync (0.292.0)
  sends the count to AniList and takes AniList's: the side that changed
  since the two last agreed wins, both changed means the newer time wins,
  and with no time to go by the higher count does. The same goes for
  status: Planning is a plain backlog item, Watching is started, Completed
  is a timeline entry, Paused and Dropped are `dropped`.
- `hltb`, `reviews`: as on a timeline entry, for a Steam game.
- Filled in by media lookups: `coverUrl`, `mediaId`, `mediaSource`,
  `summary`, `releaseYear`, `externalRating`, `length`, `genres`.
- Release dates, from lookups: `releaseDate`, `releasePrecision` (how exact
  the date is), `releaseStatus`, `nextAt` and `nextLabel` (the next episode
  or part), `earlyAccess` (true for a game in early access).
- How far a show or manga has run, from TMDB, AniList or Jikan: `airing`
  (`upcoming`, `airing`, `between` = this season is out and another is
  coming, `finished`, `hiatus`, `cancelled`), `episodesOut` and
  `episodesTotal` (numbers; chapters for a manga; the total only when the
  source knows it), `airingSeason` (TMDB only: the season those two count).
  A show is "fully out" when `airing` is `finished`, `cancelled` or
  `between`.
- `overrides`: values the user set by hand over a lookup's (`release`,
  `cover`, `rating`, `length`, `author`).

Finishing an item moves it to the timeline: a new entry with the same title
and category, its notes kept, and the backlog item removed
(`lifelog_finish_backlog_item`). Moving an entry back to the backlog keeps
its notes too.

## Categories (`categories`, `financeCategories`, `noteCategories`)

Three separate lists of the same shape: `categories` for the timeline and the
backlog, `financeCategories` for expenses and recurring bills,
`noteCategories` for notes.

- `id`, `name`, `color` (`#rrggbb`), `createdAt`, `updatedAt`
- A timeline category (`categories` only) can also hold what its items
  offer. `showInProgress` false hides starting them (In progress) and
  `showBought` false hides marking them bought; both are absent when on.
  `showAuthor` is `true` or `false` once set; absent, an author shows when
  the category's lookup source (`settings.mediaCategorySources`) is
  `openlibrary` or `googlebooks`. `showProgress` (0.292.0) works the same
  way: absent, the episode count shows when the lookup source is
  `anilist-anime` or `anilist-manga`. Off only hides: an item keeps its
  `author`, `bought`, `startedAt` and `progress`.
  `lifelog_rename_category` sets them.
- An expense category (`financeCategories` only) can hold subcategories:
  `subs`, a list of `{ id, name, createdAt, updatedAt }` (Games and Books
  under Entertainment). Names are unique within their category only. One
  level: a subcategory holds none. Two devices' subs merge one by one, and
  two of the same name fold into the older. Change them with
  `lifelog_add_subcategory`, `lifelog_rename_subcategory` and
  `lifelog_delete_subcategory`, not by editing `subs`.

Renaming one renames it on every item that uses it: a timeline category on
entries and backlog items (and its lookup source in
`settings.mediaCategorySources` and `mediaCategoryFallbackSources`, which
are keyed by the category's name), an expense category on expenses,
recurring bills and their one-off charges, a note category on notes and
boards. The `id` stays put. `lifelog_rename_category` does this (and changes colours); don't
rename by editing items one at a time.

## Notes (`notes`)

Newest first. Three kinds:

- `kind` absent: a text note. `text` is Markdown, `title` optional.
- `kind: "list"`: a checklist. `items` is a list of
  `{ id, text, done?, doneAt? }`. `text` on the note is unused, and a list
  has no `title`.
- `kind: "quote"`: `text` is the quote, with optional `author` and `source`.

Fields: `id`, `createdAt`, `updatedAt`, `editedAt` (when the text last
changed), `kind`, `text`, `title`, `category` (optional, from
`noteCategories`), `fav` (true when favourited), `items`, `author`, `source`.

## Expenses (`financeEntries`)

One-off spending. The Ledger also counts the charges recurring bills make;
those aren't stored here (see below).

- `id`, `createdAt`, `updatedAt`
- `date`: `YYYY-MM-DD`.
- `amount`: in the home currency, always positive.
- `category`: a name from `financeCategories`.
- `subcategory`: optional, the name of one of that category's `subs`.
  Absent means the category alone. Every total by category includes its
  subcategories; `lifelog_spending` splits them with `group_by:
  "subcategory"`. Moving an expense to another category drops it.
- `note`: optional, what or where.
- `project`: optional, a name from `projects` (a trip, a renovation).
- `currency`, `fxAmount`, `rate`: when paid in another currency.
- `rateConfirmed`: true once the user has checked the rate against the real
  charge (the Ledger's Convert).

## Recurring bills (`recurringExpenses`)

Rent, subscriptions and the like: a plan that charges on a schedule. Its
charges aren't stored; they're worked out from the plan (`planCharges` in
src/finance.js), which is how the bridge's spending totals include them.

- `id`, `createdAt`, `updatedAt`
- `startDate`: the first charge. `endDate`: optional, the last.
- `interval`: `weekly`, `monthly` or `yearly`.
- `chargeDay`: a monthly plan's day of the month when it isn't the start
  date's (a 31st falls on the month's last day).
- `chargeWeekday`: a weekly plan's weekday (0 = Sunday) when it isn't the
  start date's.
- `chargeMonth` with `chargeDay`: a yearly plan's month (1-12) and day when
  they aren't the start date's (29 February falls on the 28th in other years).
  The first charge is the first time that date comes round on or after the
  start.
- `amount`: per charge, in the home currency. `category`, `subcategory`,
  `note`, `project`, as on an expense; every charge carries them.
- `currency`, `fxAmount`, `rate`: billed in another currency; `rates` holds a
  rate frozen per charge date (`{ "YYYY-MM-DD": rate }`).
- `overrides`: per charge date, `{ amount?, fxAmount?, note?, skip? }`. A
  skipped charge counts for nothing.
- `pauses`: `[{ from, to? }]`, ranges with no charges (`to` absent means
  paused from then on).

Change one charge with `lifelog_edit_recurring_charge` and pause or resume a
bill with `lifelog_pause_recurring`, rather than writing `overrides`,
`rates` or `pauses` by hand: a charge of a bill whose price changed belongs
to the older plan in its chain, which those tools find.
- `extras`: one-off charges on the same bill, outside its schedule:
  `[{ id, date, amount, note?, category?, subcategory?, currency?, fxAmount?, rate? }]`.
  `subcategory` only with `category`; without one the charge takes the
  bill's category and subcategory.
- `prevId`: the plan this one replaced when the price or schedule changed.
  A bill's history is a chain of plans; the Ledger shows only the last one.
- `combinedWith`: an old way of grouping bills (0.228.0 to 0.231.0), dropped
  on load. Never write it.

## Projects (`projects`)

Groups of expenses, like a trip: `id`, `name`, `color`, `createdAt`,
`updatedAt`. Expenses and bills point at one by `name`; renaming a project
(`lifelog_rename_category`, kind `project`) carries them with it.

## Habits (`habits`)

- `id`, `createdAt`, `updatedAt`
- `name`, `color`, `order` (position in the list)
- `cadence`: `"daily"`, or `{ days: [0-6] }` for set weekdays (0 is Sunday).
- `target`: how many times a day counts as done (default 1).
- `marks`: `{ "YYYY-MM-DD": count }`, only days with a count above 0.
- `avoid`: true for something kept away from (no coffee). Then the marks
  count slips, and a day is kept while they stay at or under `limit`. A day
  with no mark is a kept day.
- `limit`: for an avoided habit, how many slips a day still keeps.
- `startedAt`: the first day it counts. `archivedAt`: the day it stopped.

A streak counts consecutive due days kept; a day the habit isn't due doesn't
break one, and today not done yet doesn't either.

## Accomplishments (`accomplishments`)

The timeline's year highlights, by year: `{ "2026": [ ... ] }`. Each has
`id`, `text`, `notes` (optional), `createdAt` and `updatedAt`. `__year`
exists only inside the merge. A year with none left is removed. Read them
with `lifelog_accomplishments`; add, edit (or move to another year) and
delete with the `lifelog_*_accomplishment` tools.

## Settings (`settings`)

Synced preferences. The bridge never shows these to an AI, because
`mediaKeys`, `steam` (proxy URL, SteamID64 and the Web API key) and
`anilist` hold API keys and account names. The one
that matters for data is `currency`, which `lifelog_overview` gives. The
Export JSON and the phone's Documents copy carry `mediaKeys`,
`steam.apiKey` (0.260.0) and `anilist.token` (0.292.0) blanked; the synced
file has them. `anilist` holds `userName`, `animeCategory`,
`mangaCategory`, `autoSyncDays` ("0" never, "open" every time the app
opens, or days between syncs), and for sending changes back `clientId`,
`token` (an AniList access token, a year long) and `connectedAt` (when it
was pasted; titles added after it are added to AniList too).

Keys: `currency`, `timelineSort`, `ledgerSort`, `backlogSort`,
`mediaCategorySources`, `mediaCategoryFallbackSources`, `mediaKeys`, `steam`,
`anilist`, `releases`, `importSkips` (per import source, the `source:id`
keys of items left unticked in a review, so they stay hidden next time),
`updatedAt`. `steam.gameTimes` is "off", or how many days a Steam game's How Long to
Beat times stay fresh before they're asked again: "1", "3", "7" or "30"
(the default). "on", from 0.282.0–0.282.2, means "30". Old files may still carry `monthOrder`,
`monthMinWidth` and `monthMaxWidth`, which the app drops or moves on load.

## Boards (`boards.json`)

The Notes tab's drawing boards, in a file of their own beside
`lifelog.json` (so drawing never slows a save), written compact:
`{ "boards": [ ... ] }`. Each board has `id`, `name`, `createdAt`,
`updatedAt`, `elements`, and optionally `category` (a note category's name)
and `fav` (starred). Elements are strokes, shapes and text
(`{ id, t: "text", text, x, y, ... }`); only the text says anything an AI
can use. `lifelog_boards` lists them with their text;
`lifelog_update_board` renames, files and stars one; `lifelog_delete_board`
deletes one. Nothing draws.

## Trips (`travel.json`)

The Travel tab's trips, in a file of their own beside `lifelog.json`,
written compact: `{ "trips": [ ... ], "places": [ ... ] }`. Kept apart
because a build older than 0.241.0, merging `lifelog.json`, would drop a
root key it doesn't know.

- A trip has `id`, `name`, `createdAt`, `updatedAt`, and optionally `start`
  and `end` (dates; an end before the start is swapped).
- A place has `id`, `trip` (its trip's id), `name`, `createdAt`,
  `updatedAt`, and optionally:
  - `day`: the date it's planned for. Without one it's somewhere to get to
    sometime during the trip.
  - `time` and `endTime` (`HH:MM`): a place with a `time` is scheduled. A
    time is only kept with a day, and an end only after the start.
  - `order`: sorts a day's unscheduled places; scheduled ones go by time,
    first.
  - `address`, `note`, `url` (a Google Maps link), `lat` and `lng`,
    `visited` (true when been there), `gid` (Google's place id, as Maps
    writes it: `0x…:0x…`) and `source` (the id of the Google Maps list it
    was imported from).
  - `town`: the town it's in, looked up from where it is (OpenStreetMap)
    for a place whose address doesn't name one. The app fills it in.
  - `placeId`: its id in Google's Places API, saved the first time its
    sheet looks it up with a Places key. The rating, hours and reviews that
    come with it are never stored (Google's terms), only fetched.
- A place whose trip is gone is dropped when the file is read; deleting a
  trip deletes its places.

`lifelog_trips` lists trips, or one trip's plan day by day.
`lifelog_add_trip`, `lifelog_update_trip`, `lifelog_delete_trip`,
`lifelog_add_place`, `lifelog_update_place` and `lifelog_delete_place`
change them. `lifelog_google_list` reads a shared Google Maps list (or one
place) and `lifelog_import_google_list` adds its places to a trip with no
day, skipping any already there (same `gid`, or the same name within 50 m).

The app's By area view and `lifelog_google_list` group places the same way
(`Travel.areas`): places within 15 km of each other are one area, named
after the town most of their places give (from the address, else `town`),
else "Near" its most central place. Areas themselves aren't stored.

## Not in this file

- Each device's look and layout (theme, tabs, widths) stay on that device.
- Habit reminder times are per phone.
