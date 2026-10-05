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
- `startYear`, `startMonth`: optional. A span that began in an earlier month.
- `startedAt`: optional `YYYY-MM-DD`, when it was started (carried over from
  the backlog).
- `rating`: optional, 1 to 5 stars.
- `notes`: optional text.
- `coverUrl`, `mediaId`, `mediaSource`, `length`, `genres` (up to 4): what a
  media lookup filled in (cover art, the source's id, how long it is).
- `overrides`: values the user set by hand over a lookup's (`cover`, `length`).
- `backlogAddedAt`: when it was added to the backlog, if it came from there.

## Backlog (`backlog`)

Things to play, read, watch or do next.

- `id`, `createdAt`, `updatedAt`
- `title`, `category` (a name from `categories`), `notes`
- `priority`: 1 when starred; starred ones come first.
- `bought`: true when already owned.
- `dropped`: true when given up on. Kept, but out of the way.
- `startedAt`: `YYYY-MM-DD` when started (it shows as in progress).
- Filled in by media lookups: `coverUrl`, `mediaId`, `mediaSource`,
  `summary`, `releaseYear`, `externalRating`, `length`, `genres`.
- Release dates, from lookups: `releaseDate`, `releasePrecision` (how exact
  the date is), `releaseStatus`, `nextAt` and `nextLabel` (the next episode
  or part), `earlyAccess` (true for a game in early access).
- `overrides`: values the user set by hand over a lookup's (`release`,
  `cover`, `rating`, `length`).

Finishing an item moves it to the timeline: a new entry with the same title
and category, and the backlog item removed (`lifelog_finish_backlog_item`).

## Categories (`categories`, `financeCategories`, `noteCategories`)

Three separate lists of the same shape: `categories` for the timeline and the
backlog, `financeCategories` for expenses and recurring bills,
`noteCategories` for notes.

- `id`, `name`, `color` (`#rrggbb`), `createdAt`, `updatedAt`

Renaming one renames it on every item that uses it: a timeline category on
entries and backlog items, an expense category on expenses, recurring bills
and their one-off charges, a note category on notes and boards. The `id`
stays put. `lifelog_rename_category` does this (and changes colours); don't
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
- `amount`: per charge, in the home currency. `category`, `note`, `project`.
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
  `[{ id, date, amount, note?, category?, currency?, fxAmount?, rate? }]`.
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
`mediaKeys`, `steam` and `anilist` hold API keys and account names. The one
that matters for data is `currency`, which `lifelog_overview` gives.

Keys: `currency`, `timelineSort`, `ledgerSort`, `backlogSort`,
`mediaCategorySources`, `mediaCategoryFallbackSources`, `mediaKeys`, `steam`,
`anilist`, `releases`, `updatedAt`. Old files may still carry `monthOrder`,
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

## Not in this file

- Each device's look and layout (theme, tabs, widths) stay on that device.
- Habit reminder times are per phone.
