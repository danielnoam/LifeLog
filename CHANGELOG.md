# Changelog

All notable changes to LifeLog are documented here. The version number
always matches `APP_VERSION` in `src/app.js`, shown as "LifeLog vX.Y.Z" at
the bottom of Settings.

## [0.117.0] - 2026-09-06

### Added
- **Your data now remembers the newest version of LifeLog that has written
  it**, and a device running behind that says so — in the storage line under
  the logo, and once as a message when it first notices. That's the thing
  that would have caught the Early Access flags going missing on the phone
  at the moment it happened, rather than days later.
- It is a **warning and nothing else**. The device still loads, still
  merges, still saves, exactly as before — being behind isn't destructive
  any more (0.116.0 made every sanitizer carry unknown fields through), it
  just means that device can't show or edit whatever the newer one added.
  Nothing is refused and no merge is skipped.
- The recorded version is a high-water mark rather than whoever saved last,
  so a device that's behind can't quietly lower it and stop warning itself.

## [0.116.0] - 2026-09-06

### Fixed
- **A device on an old build no longer wipes fields it doesn't know about.**
  Every sanitizer was a whitelist: it kept the fields that build recognised
  and quietly dropped the rest. So a phone still serving a cached older
  version deleted anything newer — Early Access flags, in this case — and
  because a sync merge compares content rather than timestamps, that
  deletion then won on every other device too. One stale device could strip
  a new field off the whole backlog. Unknown fields now ride through
  untouched, so this can't happen again to the next field added. It can't
  retroactively help a device still on an older build, so let each device
  reach this version at least once.

### Changed
- **Dropped items get their own aside in a category's count** —
  <em>3 (+2 EA, +1 unreleased, +1 dropped)</em>. The asides are now exactly
  the blocks the list sorts into, in the same order and by the same tests,
  so the header and the rows under it can't disagree. Something dropped
  *and* unreleased counts once, under dropped.
- A category header now wraps its count onto a second line when there isn't
  room for both, instead of squeezing the category name down to an ellipsis
  — three asides beside a name didn't fit on a phone.

## [0.115.2] - 2026-09-05

### Changed
- **A category's count sets Early Access aside too** — <em>3 (+2 EA, +1
  unreleased)</em> rather than folding the unfinished games in with the
  ones you could sit down and finish tonight. It's counted off the
  startable half, since you can play an Early Access game today; a game
  whose Early Access launch is itself still ahead stays counted as
  unreleased, not both. Settings → Backlog counts still turns the whole
  split off.

## [0.115.1] - 2026-09-05

### Changed
- **Early Access games sort into their own block**, between the finished
  games and the ones that haven't come out — which is where they actually
  sit. You can start one today, so it doesn't belong down with things that
  don't exist yet; it also isn't the game it's going to be, so it shouldn't
  sit among the ones you could just play. A starred Early Access game stays
  in the starred block, same as a starred unreleased one always has.

## [0.115.0] - 2026-09-05

### Added
- **Games in Early Access are marked as such.** Steam files Early Access as
  a genre rather than a flag, and a game in it is "released" as far as
  every date field is concerned — so an unfinished game read exactly like a
  finished one. Anything Steam knows (a wishlist import, a manually entered
  App ID, or a RAWG/SteamGridDB match that resolved to a Steam page) now
  carries an Early Access mark on its backlog row, in the edit modal and on
  a random pick.
- **The mark clears itself when a game ships 1.0.** Steam drops the marker
  the day a game leaves Early Access, so "🔭 Re-check upcoming release
  dates" now includes your Early Access games in what it re-asks — they
  aren't waiting on a date, but they are waiting on 1.0. They stay out of
  the Next Releases list, which has no date to sort them by.

### Changed
- The CORS proxy now asks Steam for `genres` alongside the basic app
  details. **Re-deploy `proxy/worker.js` for the Early Access mark to
  appear** — until then nothing breaks, Steam just never says either way.

## [0.114.2] - 2026-09-05

### Fixed
- **Discover recognises a title you already have when it's spelled a little
  differently.** The check compared titles exactly, so "Mushoku Tensei -
  Season 3" in your timeline didn't match "Mushoku Tensei Season 3" in the
  list, and an "S4" of your own didn't match a "Season 4" of theirs. Case,
  accents, punctuation, spacing and `&` vs "and" are now all folded away
  before comparing, and the two ways of writing a season number are treated
  as one.
- **A season you own no longer hides a season you don't.** The season number
  is deliberately kept in the comparison rather than stripped out: having
  watched a first season should never take a fourth off the list. Six tests
  pin that down.

## [0.114.1] - 2026-09-05

### Changed
- **Books, audiobooks and music no longer get an empty Discover card.**
  Open Library, Google Books and MusicBrainz publish no popularity list and
  never will, so saying so on every visit was just a dead tile in the grid.
  A card is now only drawn where there's either something in it or something
  you could do — a SteamGridDB category still says a RAWG key would fill it
  in, because that one names the fix.

## [0.114.0] - 2026-09-05

### Added
- **"Hide what I have" in Discover.** Leaves out anything already in your
  backlog or already logged, so the list is only things you haven't got. It
  says how many it dropped rather than just showing you a shorter list, and
  it sticks between sessions (this device only).

### Fixed
- **Games were missing from Discover entirely.** A category set to
  SteamGridDB or to a manual Steam App ID got no card at all, because
  neither publishes a popularity list — and nothing said so. RAWG stands in
  for them now when you have a RAWG key: it's already the database
  SteamGridDB cross-fills its ratings and genres from, and a game added off
  a stood-in list still resolves to a Steam App ID and still gets its
  GG.deals price, so nothing about the item changes.
- **Every category with a source now gets a card, even when there's nothing
  to show in it.** Open Library says it publishes no such list; a
  SteamGridDB category with no RAWG key says a RAWG key would fill it in.
  Silence was the real bug — there was no way to tell "unsupported" from
  "broken".

## [0.113.0] - 2026-09-05

### Added
- **Discover, a third Backlog mode.** Beside By category and Next releases:
  what's popular right now, and what's coming, for the media sources your
  categories already use. A category set to AniList gets AniList's trending
  list; one set to TMDB gets TMDB's. There's nothing new to configure — it
  reads Settings → Media as it stands.
- **Adding from Discover fills the item in properly.** Tapping a row opens
  the add form already carrying the cover, description, rating, release date
  and genres, resolved through exactly the same path a title you searched
  for by hand takes — including the Steam App ID lookup, if the category is
  set to one of the "+ Steam + GG.deals" sources. Rows for things already in
  your backlog or already logged say so.
- **Two lists per source: Popular now and Coming soon.** RAWG, TMDB, AniList
  and Jikan each publish both. Sources that publish neither — Open Library,
  Google Books, MusicBrainz, SteamGridDB — are left out rather than shown
  empty, and Steam's charts are as CORS-blocked as the rest of its API.

Nothing is fetched until you open the mode, and answers are kept for six
hours on the device, so opening the Backlog doesn't call four APIs. ↻ Refresh
ignores that cache.

## [0.112.1] - 2026-09-05

### Changed
- **A backlog card says TBA where the release year would go.** Something
  you're still waiting on but that has no date announced used to leave that
  slot empty, which read as "nothing is known about this" rather than "the
  date isn't out yet". Items that simply have no release information and
  aren't marked as upcoming still show nothing — that's an unknown, not a
  TBA.

### Fixed
- **A card shows the year even when it only has a full release date.** An
  item carrying a `2027-05-14` but no separate year field showed no date at
  all; it now reads the year off the date, the way Next Releases already
  did.
- **The edit modal's meta line matches the list row.** It was built from the
  form's live fields, which left the release date out entirely, so the same
  item read differently in the list and in its own modal.

## [0.112.0] - 2026-09-05

### Added
- **A category's backlog count sets aside what isn't out yet.** The number
  on a card now reads "12 (+7 unreleased)" rather than a flat 19 — a shelf
  of things you're waiting on isn't the same as a pile you've been putting
  off, and one number counted them as if they were. Categories where
  everything is out, or nothing is, keep the plain number; the split uses
  the same "can't start it yet" test the random pick draws on, so the two
  never disagree. Settings → Appearance → Backlog counts turns it off.

### Fixed
- **The ⚙ no longer wraps to a second row on a phone.** The search box's new
  ✕ made the field wide enough to push it down, since a flex row decides
  what wraps before it decides what shrinks.

## [0.111.0] - 2026-09-05

### Added
- **A Steam App ID can be set on anything now, from Advanced.** The field
  used to appear only for categories whose media source was set to Steam,
  which left everything else with no way to name a Steam app by hand — no
  store link and no GG.deals price for a game a search couldn't map to one.
  It's always there now: still up in the form for a Steam category, where
  the App ID is the item's whole identity, and down in Advanced everywhere
  else, next to the pins that keep your own values safe from it. Both the
  backlog and the timeline entry form.

### Changed
- **Next Releases gives each year its own card.** "Sometime in 2027" and
  "no date announced at all" used to share one card at the end of the list,
  which threw away the difference. Now the month cards are followed by a
  card per year, then a last one for the titles with nothing announced yet.
- **The search box keeps its ✕.** It's ours rather than the browser's own,
  which Chrome only draws while the field has focus — so clearing a search
  you'd clicked away from meant clicking back into it first. It now stays
  for as long as there's something to clear, and it's a bigger target on a
  phone.

### Fixed
- **Adding a backlog item from a title you already have brings its metadata
  with it.** Picking an existing backlog item or a logged entry from the
  suggestion list copied the cover, the media link and the genres and
  stopped there, so the new item arrived with no rating, no release date,
  no length and no description — and, counting as synced, nothing to
  prompt fetching them either. It now copies everything the match knows.

## [0.110.2] - 2026-09-04

### Removed
- **The paragraph explaining "Started month" in the entry form.** The field
  sits under a "Started year" beside it and defaults to "— none —", which
  says the same thing in less space.

## [0.110.1] - 2026-09-04

### Fixed
- **Three stray checkboxes above Notes in the backlog add/edit form.** The
  ★, ✓ and dropped buttons keep their state in hidden checkboxes, and
  0.109.0's custom checkbox gave every one of them a `display` that
  outranked the browser's own rule for hiding them. They're hidden again.

## [0.110.0] - 2026-09-04

### Added
- **"Bought only" in the random pick.** A second switch beside "Favorites
  only" in the pick modal's scope strip, for the evening you'd rather not
  spend anything: it draws only from titles you've already marked bought.
  The two stack, so both on means starred *and* paid for. Like the
  favorites switch it holds its position while the app is open but isn't
  saved, and the wheel spins the same narrowed pool.

## [0.109.0] - 2026-09-04

### Added
- **LifeLog draws its own scrollbars.** A thin rounded thumb on a
  transparent track, in the same greys as the text beside it, so a long
  Settings panel or import list no longer ends in a strip of Windows grey.
  Only where there's a mouse — phones and tablets keep the overlay bar that
  already gets out of the way on its own.
- **A half-ticked "select all" now looks half-ticked.** Select some of a
  month's or a category's items in bulk mode and its header box shows a bar
  instead of sitting there looking untouched.

### Changed
- **Checkboxes are ours now.** Every tick box in the app — bulk select, the
  import pickers, "Favorites only", the sync override fields, the app-lock
  toggle — is drawn from the app's own colors rather than by the operating
  system, so it moves with your theme instead of staying whatever grey
  Windows or iOS felt like. That also fixes them on Nord and Dracula, whose
  pale accents need a dark tick rather than a white one. One size
  everywhere, too: they used to differ by a pixel between screens.

## [0.108.0] - 2026-09-02

### Added
- **Anything can be marked bought, not just favorites.** The ✓ beside the
  star is now always available. On a starred item it still floats the row to
  the top of its block; anywhere else it's simply a note that the money is
  already spent, and it leaves the order alone — a purchase says something
  about your wallet, not about what you want to get to next.

### Changed
- **A bought item says "Bought" where its price used to be.** What a shop is
  charging today is a number about a purchase you've already made, so the
  GG.deals price is replaced by the word in the row, the edit modal and the
  random pick card — and no longer looked up at all, which keeps your
  GG.deals quota for the games you might still buy. The ✓ badge that
  0.107.0 put beside the title is gone with it: the word says the same
  thing, in the place you were already looking for the price.

## [0.107.0] - 2026-09-02

### Added
- **Mark a favorite as already bought.** Star an item in the backlog and a
  **✓** button appears beside the star: use it for the things you've already
  paid for but haven't got to yet. Bought items sort to the top of their
  category's starred block and carry a green ✓ next to the star in the list
  and on a random pick, so the shortest path from "I want to" to actually
  doing it is the first thing you see. It only applies to favorites —
  unstarring an item clears the mark, since there'd be nowhere for it to
  float to.

## [0.106.0] - 2026-09-02

### Added
- **Games picked from SteamGridDB stop landing bare.** SteamGridDB is a
  cover-art database: a match off it is a title, a grid image and a date,
  and nothing else — no rating, no length, no genres, no description,
  because its API carries none of that. That made a game picked from it the
  last thing in the backlog to arrive with an empty card. Picking one now
  cross-fills those four fields from RAWG by title, the same way the Steam
  wishlist import already does. The date stays SteamGridDB's own: RAWG
  dates a game by its earliest platform release, often a console version
  years before the PC one, so there was nothing to gain there.
- **Timeline entries synced from SteamGridDB get a length and genres too.**
  They had been getting neither, so anything logged from SteamGridDB counted
  for nothing in the Stats "Genres" card. Both now come from the same single
  RAWG lookup.
- **A README that matches the app.** Its feature list had stopped at
  Timeline, By Category, Stats and Filters — no Backlog, no Ledger or
  Summary, no media sync, list imports, wheel, bulk actions, app lock or
  offline support, and a project layout naming four files out of fourteen.
  Rewritten, plus a table of which media sources need a key and which need
  the CORS proxy, and how to run the tests.

### Fixed
- **The test suite ran red.** `test/app.test.js` had stopped loading
  entirely when the wheel shipped in 0.105.0 — app.js calls `Wheel.init()`
  at its top level, and the test's stubs didn't include one, so the file
  threw before reaching its first assertion.

## [0.105.0] - 2026-09-01

### Added
- **A wheel to spin.** New in the **+** menu: type in a set of options —
  what to eat, which chore, who goes first — and spin for one. The list is
  kept on this device, so the wheel you spin every week is still there next
  time. **Remove & spin** drops whatever it landed on and goes again, which
  turns it into an elimination round when what you actually want is an
  order. Under reduced-motion it lands straight on its answer, no spin.
- **The Backlog's random pick can be spun for too.** "Pick random" has a
  **🎡 Spin** button beside "Pick again": the titles the picker was about to
  hand you go on the wheel — coloured by category, and narrowed by the same
  scope strip — and the one it lands on becomes the pick card, metadata,
  links and all. The wheel holds twelve slices; a bigger pool puts its
  least-recently-seen twelve up.

### Changed
- **The random picker stopped repeating itself.** Every "Pick again" was an
  independent coin flip, so on a 40-title backlog it would hand you the same
  three titles all evening while most of the list never came up at all.
  Draws now come out of a bag: nothing repeats until everything in scope has
  had its turn. The bag also remembers what it drew across sittings (on this
  device — it isn't synced), so re-opening the picker doesn't lead with the
  title you shrugged at last night. Narrowing the scope drops what left it
  and switching a category back on puts it straight back in the running.

## [0.104.0] - 2026-08-28

### Added
- **Every Ledger month now shows where its money went.** Above the month's
  total sits a line per category with what it came to — largest first, and
  only categories that actually have entries that month, so a card stays as
  short as the month was varied. A skipped or paused occurrence counts
  towards neither the lines nor the total, so the breakdown always adds up
  to the figure under it. The "Yearly" bucket gets the same treatment.

## [0.103.0] - 2026-08-28

### Added
- **Next Releases can be multi-edited too.** The upcoming view was
  select-free — the only way to act on a run of titles was to switch back to
  By category and find them again, scattered across their categories. It now
  takes the same selection gesture as the rest of the app: long-press a row
  to enter bulk mode, tap to add more, or tick a month card's header
  checkbox to take everything releasing that month at once. The action bar
  offers the same three it always has — move to a category, re-sync, or
  delete — which is the point, since a month's worth of upcoming titles is
  exactly the run whose dates you want to re-check together. Switching
  layouts still clears a selection in progress.

## [0.102.0] - 2026-08-28

### Added
- **The random picker shows what it's drawing from.** A strip at the top of
  the card lists every category in play as a chip you can switch off, so a
  draw can be narrowed to "just games" without closing the modal and
  re-filtering the whole backlog behind it. Beside it, a **Favorites only**
  switch limits the draw to starred items, and a count says how many titles
  are in scope. Switch everything off and the card says so rather than
  leaving the last pick on screen looking like a fresh one. The scope resets
  each time you open the picker; the favorites switch keeps its position
  while the app stays open. The chip row hides itself when there is only one
  category to draw from.

### Changed
- **"Open" is back on the right**, with "Close" beside it and "Pick again"
  on the left.
- **Genres now sit above the description** rather than under it.

### Fixed
- **The picker could offer you something that hasn't started yet.** A title
  with no release date of its own but a first episode already scheduled —
  an announced show, typically — had no release window to be judged by, so
  it read as out and could come up in a draw. It's ruled out now. Something
  already airing, with a past release and a next episode ahead, still counts
  as pickable.

## [0.101.2] - 2026-08-28

### Changed
- **The random picker's buttons moved again.** "Pick again" is now on the
  left, with "Open" (still the accent one) and "Close" on the right.
- **A pick's store links sit on its cover.** Steam · RAWG · TMDB · AniList ·
  GG.deals now overlay the cover art the way they do in the edit modal,
  rather than always taking a row of their own under the title. An item with
  no cover — or one whose cover URL turns out to be a dead image — still
  falls back to that row, so the links never disappear with the picture.

## [0.101.1] - 2026-08-28

### Changed
- **The backlog's random picker is plainer.** The button above the list now
  reads "Pick random" instead of "🎲 Pick something for me" — shorter, and
  without the dice, which the rest of the toggle strip doesn't use either.
- **"Open" is the picker modal's main action.** It sits at the far right in
  the accent colour, where every other modal puts the button you actually
  came to press; "Pick again" (also un-diced) steps back to a plain button
  beside it.

## [0.101.0] - 2026-08-21

### Added
- **Games get a description now.** A game was the one thing in the backlog
  that could never land with a blurb, however complete the rest of its data
  looked — RAWG's search endpoint simply doesn't carry one, and SteamGridDB
  carries nothing but a name, a cover and a date. Picking a RAWG match now
  makes the same kind of second per-title call the app already made for
  TMDB, which is where the description lives (and re-reads the rating and
  playtime while it's there, so a game reviewed since your last sync fills
  those in too). The blurb is trimmed to its opening paragraph — the list
  shows two lines of it and the store-page boilerplate helps nobody.
- **A Steam-linked game uses Steam's own blurb.** Steam's app details
  response has always carried `short_description`; only the name and the
  release date were being read off it. Now a wishlist import lands with a
  description with no RAWG key involved at all, and so does any game a pick
  resolves to a Steam App ID — its store paragraph beats a name-matched
  source's take on the same game.
- **Settings → Appearance → Backlog descriptions.** Set it to Hide and the
  backlog list goes back to one tight line per item. Nothing is deleted —
  open the item, or "Pick something for me", and the description is right
  there. Per device, like the cover-size settings above it.

### Changed
- **"Backfill game info from RAWG" is now "Backfill missing game info"**, and
  fills in descriptions as well: RAWG's rating/length/release year for
  Steam-synced games with none of it (needs a RAWG key), and Steam's own
  description for the ones with none (needs your proxy URL). Either half runs
  on its own, so a proxy with no RAWG key is now enough to use it.

### Fixed
- **A re-sync no longer wipes the description it can't replace.** Every sync
  path wrote the matched source's summary over whatever was there, and most
  sources have no summary at all — so re-syncing a game, or bulk-syncing a
  shelf of them, quietly deleted blurbs and anything you'd written yourself.
  Only real text overwrites now.
- **Escaped text in a description reads as text.** `Baldur&#39;s Gate` and a
  stray `<i>` from Steam's and AniList's HTML now come out as the characters
  they stand for.

## [0.100.1] - 2026-08-16

### Fixed
- **A starred backlog item now sits in the starred block even when it hasn't
  come out yet.** Starring something says "this one matters", but the
  released/still-to-come split was applied first, so starring a game you were
  waiting on moved it *down* — into the upcoming block halfway down its
  category, away from everything else you'd starred. The star now outranks
  that split. Dropped items stay last either way: that's something you've
  given up on, star or no star.

## [0.100.0] - 2026-08-16

### Added
- **Advanced → keep my own value**, a foldout at the bottom of the entry and
  backlog modals. Tick a field and it becomes yours: every sync path — a
  re-pick, a bulk sync, a pasted Steam App ID, and the 🔭 release re-check —
  writes around it instead of overwriting it. Useful wherever a source is
  simply wrong and keeps insisting on it.
  - Backlog items can pin the **release date**, **cover image**, **rating**
    and **length**. The date box takes whatever precision you actually know
    — `2027-05-14`, `2027-05`, `2027-Q1` or `2027`, blank for TBA — and a
    vague date stays vague rather than being rounded into a specific day.
    You can also state outright whether it's out yet, which is the one thing
    a bare year can't say for itself.
  - Timeline entries can pin the **cover image** and **length**. They have no
    release date to pin: an entry is dated by when you finished the thing,
    which no sync has ever touched.
  - An item with a pinned release date is skipped by the 🔭 re-check
    entirely, so its count is honest about how much it would actually check.
  - Unsyncing an item now keeps its pinned values. They're yours, so they
    outlive the media link they originally arrived through.
  - Opening an item that has something pinned opens the foldout with it, so
    a pin can't quietly explain why a field never updates.

### Fixed
- **Store and source links now show on items with no cover art.** The
  Steam / RAWG / TMDB / GG.deals buttons live over the cover image, and the
  cover block is hidden when there's no picture — so an item that had a
  perfectly good Steam link but no artwork showed no links at all. They now
  fall back to a row under the title, which also covers the case that hid
  them most often: a cover URL that 404s, taking the whole block with it.
  The rating/year/length line and the summary come along for the same ride.

## [0.99.7] - 2026-08-16

### Fixed
- **Games get their release date right.** Three separate holes, all of which
  showed up as a game with a missing or wrong date:
  - A SteamGridDB match arrived with **no date at all** — SGDB dates every
    game in its search response and the app simply wasn't reading the field.
    It is now, so a SteamGridDB pick lands with a real release date and year.
  - A game that resolves to a Steam App ID now takes **Steam's own date**.
    RAWG dates a game by its *earliest* platform release — often a console
    version years before the PC one — which is where most of the wrong years
    came from. Steam also says outright whether a game is out yet, and is
    honestly vague ("Q1 2026") where the other sources invent a specific day.
  - 🔭 **Re-check upcoming release dates** now covers SteamGridDB items.
    They were previously among the ones it had to skip for having "no lookup
    by id", so a SteamGridDB game's date never refreshed once set.

### Changed
- **Tapping the tab you're already on scrolls back to the top**, the way every
  mobile app's tab bar does. It previously re-rendered the view in place and,
  because a same-view rebuild deliberately restores your scroll position, the
  tap looked like it did nothing.

## [0.99.6] - 2026-08-16

### Added
- **"SteamGridDB + Steam + GG.deals" is now its own media source**, alongside
  the RAWG combo it mirrors: SteamGridDB's grid art plus a resolved Steam App
  ID, so the item gets a Steam store link and a GG.deals price. Plain
  "SteamGridDB" goes back to being cover art only — v0.99.5 made every
  SteamGridDB match resolve an App ID, which left no way to ask for just the
  art. Pick the combo in Settings → Media for the categories you want prices
  on.
- Both "+ Steam + GG.deals" sources can now be chosen as a category's
  *fallback*, not just its primary. A match found by the fallback wants a
  Steam App ID as much as one found by the primary; excluding them only meant
  a games fallback quietly produced items with no store link and no price.

### Fixed
- **The bulk 🔄 Sync button no longer dies silently.** If anything threw
  part-way through — a source erroring, a network drop — the button stayed
  greyed out and the bar sat there unchanged, which from the outside looked
  exactly like a button that does nothing. It now says what went wrong,
  keeps whatever it had already synced, and hands the button back.

## [0.99.5] - 2026-08-16

### Fixed
- **A game matched through SteamGridDB now gets its Steam App ID too**, so it
  links to the Steam store page and shows a GG.deals price like a
  wishlist-imported game does. SteamGridDB's own game id can't drive either of
  those, and nothing was asking it for the Steam one — it's now looked up (via
  the same CORS proxy) the moment you pick a match. Games SteamGridDB has no
  Steam listing for are unaffected, and the SteamGridDB cover art is kept
  either way. Existing SteamGridDB-matched items pick this up when you re-run
  🔄 Sync on them.

## [0.99.4] - 2026-08-14

### Fixed
- The 🔄 Sync button's busy animation now spins the icon rather than the whole
  button, so its border and background stay still while a lookup runs.

## [0.99.3] - 2026-08-14

### Changed
- **Sync matches now appear the moment their source answers**, rather than the
  fallback's being held back until the primary had finished. Nothing waits its
  turn, so whichever source is quicker shows up first — when the primary is the
  slow one, the first match now lands in about a quarter of a second instead of
  two and a half. Every match is tagged with its source, so the order it
  arrived in doesn't cost you anything.
- The "Searching…" line names every source still outstanding and narrows as
  each answers ("Searching RAWG, Open Library…" → "Searching RAWG…").

## [0.99.2] - 2026-08-14

### Fixed
- **The 🔄 Sync button responds the instant you press it.** It used to sit
  there doing nothing visible until the first API answered, which made every
  lookup feel slower than it was. The list now opens immediately with
  "Searching RAWG…", and the button itself spins while the lookup runs.
- **Both sources are now queried at the same time.** The fallback used to wait
  for the primary to finish before it even started, so a lookup cost the two
  APIs *added together* — and they vary a lot in speed (Open Library takes
  around 2.5 seconds where most take a quarter of that). Results are still
  listed primary-first; only the waiting overlaps. With two typical sources a
  full lookup went from about half a second to a quarter.
- One source failing no longer abandons the other — each is handled on its
  own, so a rate-limited or unreachable API just contributes no matches
  instead of emptying the list.

## [0.99.1] - 2026-08-14

### Fixed
- **The 🔄 Sync button now says where each match came from.** Since v0.87.0 it
  has listed the category's primary *and* fallback sources together, but with
  nothing to tell them apart — so two results for the same title were
  indistinguishable, even though picking one silently decides the item's
  source, and with it the cover art, the store/source link buttons, and (for
  Steam) the price. Each match is now tagged with its source.
- **Matches appear as they arrive instead of all at once at the end.** The
  primary source's results render the moment they land, with a "Searching
  SteamGridDB…" line holding the place of the one still in flight — rather
  than every lookup taking as long as the slower of the two APIs.
- A fallback set to the same source as the primary no longer causes that
  source to be searched twice.

### Changed
- Settings' description of the fallback ("only tried when the primary finds no
  matches") now covers only bulk sync and the background auto-checks, which is
  all it ever actually described; the manual Sync button's behaviour of showing
  both is spelled out separately.

## [0.99.0] - 2026-08-14

### Added
- **Next Releases** — a second layout for the Backlog, holding just the things
  you're still waiting on, in date order. Switch with the toggle at the top of
  the Backlog; the choice is remembered per device.
- One card per month, so what's landing this month sits together and the rest
  reads forward from there. Exact dates come first inside a month, in day
  order, with the vaguer "sometime in August" ones settled underneath — never
  interleaved on a day nobody actually promised.
- Each row says exactly as much as is known: a weekday and date, "Q1 2027",
  "Sometime in September", or "No date announced". Exact dates also get a
  countdown — today, tomorrow, in 9 days, in 6 weeks.
- Shows that are already airing appear under their **next episode** ("S2E7 ·
  Tue, Aug 18"), not the year they premiered.
- Anything announced with nothing firmer than a year collects in a trailing
  "No date yet" card rather than being filed under a month it may never hit.
- Search and the category filters apply here too, and the mobile quick-jump
  row pages through the months.

### Changed
- The "🎲 Pick something for me" button moved into the new toggle strip,
  putting one row above the backlog instead of two.

## [0.98.0] - 2026-08-14

### Added
- **Release dates now record how much of the date is actually known.** Every
  source knows a different amount — TMDB has an exact day, Open Library only a
  year, Steam sometimes only "Q1 2026" — and all of it used to be squashed
  into one date string. Items now carry a precision of day / month / quarter /
  year / TBA alongside the date, so an approximate date can be shown as
  approximate instead of pretending to be a specific day.
- Where a source says outright whether something is out yet, that's recorded
  too and trusted over the date. Steam's "coming soon" flag, AniList's and
  Jikan's status, TMDB's production status.
- **Steam wishlist imports get their release date from Steam itself**, read
  from the same request that resolves the title. Previously the only date a
  wishlisted game could get came from a fuzzy RAWG search on its name.
- **Currently-airing shows record their next episode**, from AniList and from
  TMDB's per-title details — for something already airing, the next episode is
  the date that means anything; when it first aired years ago doesn't.
- **Settings → Media → Upcoming releases**: a re-check that re-asks each
  waiting backlog item's own source, by the media ID already stored on it, and
  updates only its release date. Optionally runs quietly when you open the
  app, at most once every N days. It never renames, re-covers, adds, or
  removes anything, and only checks items still waiting on a release.

### Fixed
- A game released in January no longer counts as "unreleased" for the rest of
  the year. Anything with only a year to go on used to be treated as upcoming
  until December 31st; now a source that states its status settles it, and the
  rest is judged on the last day the release window could still be open.
- RAWG's placeholder dates for unannounced games (usually December 31st of the
  target year) are no longer taken at face value — RAWG's own "TBA" flag wins.
- Jikan dates that only ever specified a month or year are no longer padded
  out to a fake exact day.
- Dropping a backlog item's media link now clears its stale length along with
  the rest of the fetched metadata.

## [0.97.0] - 2026-08-11

### Added
- **Pause a recurring expense** over a stretch of time — a gym membership on
  hold, a subscription frozen for the summer. "⏸ Pause…" in the edit sheet
  takes a *from* date and an optional *until*; occurrences in that range stop
  being generated and drop out of every total, while staying visible in the
  Ledger marked **Paused**. Previously the only option was skipping one
  occurrence at a time.
- Leaving *Until* blank pauses **indefinitely** — the case per-occurrence
  skipping couldn't express at all, since the occurrences you'd need to skip
  haven't happened yet. The button then becomes **▶ Resume now**, which ends
  the pause and picks the schedule back up.
- Pausing never re-anchors the schedule: a bill on the 5th resumes on the 5th,
  not on whatever day you happened to resume.
- Paused stretches are listed in the edit sheet and can be edited or removed
  at any time — removing one brings its occurrences straight back. A currently
  paused expense is tagged **paused** (or **paused until …**) in the Recurring
  expenses card.
- Pauses survive a plan change: one that straddles the change date is split
  across both plans rather than lost.

### Fixed
- The two-date rows in the recurring and pause sheets no longer overflow their
  modal on a narrow phone — native date inputs refuse to shrink below their
  natural width, which pushed the row about 20px past the edge.

## [0.96.0] - 2026-08-11

### Added
- **Change plan** for recurring expenses. When a bill's terms actually change —
  a price rise, a monthly subscription going yearly, a move to a different
  category — you no longer have to rewrite its whole history to record it.
  "↻ Change plan…" in the edit sheet asks when the new terms take effect
  (defaulting to the next billing date) and starts a fresh plan from there.
  Everything before that date keeps the amount, schedule, category and
  per-occurrence edits it was actually paid at. Both plans stay linked as one
  bill, shown as a **Plan history** strip you can click through.
- A **Stops on** date for recurring expenses, so a cancelled subscription can
  simply stop generating occurrences instead of having to be deleted.
- **↻ Make recurring** on an existing finance entry — turns a one-off expense
  you've been logging by hand into a recurring one, prefilled from that entry,
  which becomes its first occurrence.
- **⇄ Convert to entries** on a recurring expense — the reverse trip: every
  occurrence it generated becomes an ordinary, individually editable entry and
  the template goes away. Skipped occurrences are left out.
- Stopped and superseded plans now appear in an **Ended** group under the
  Recurring expenses card, so their history stays one click away.

### Changed
- **Delete** on a recurring expense now removes it along with the occurrences
  it generated, and says how many that is. Keeping the history is what
  "Convert to entries" is for — previously Delete did both jobs at once and
  there was no way to remove a recurring expense added by mistake.

### Fixed
- Converting a recurring expense to one-off entries no longer resurrects
  occurrences you'd marked as skipped, which had been excluded from every
  total.

## [0.95.0] - 2026-07-31

### Added
- Multi-month entries. An entry that spanned several months — a long game, a
  trip, a book read over a while — can now carry an optional **Started month**
  in the add/edit sheet, in addition to the month it finished. When the two
  differ, its Timeline row shows a quiet span chip like **Jun–Aug** (or
  **Nov 2024–Feb 2025** across a year boundary). The entry still lives in one
  month card — the month it finished — and still counts exactly once, so every
  total, streak, "busiest month", and the activity heatmap are unchanged.
  Leave Started blank for an ordinary single-month entry and no chip appears.

## [0.94.0] - 2026-07-28

### Changed
- Faster launches. Repeat visits now paint instantly from the offline cache
  and quietly refresh in the background (stale-while-revalidate), instead of
  waiting on the network every time. A version bump still propagates within
  one extra load, so you're never stuck on an old build. The app's scripts
  also load in parallel now (via `defer`) rather than one after another,
  shaving the first-load time.
- The storage-status line under the logo is now clickable — tapping it opens
  Settings → Data, where you connect or reconnect sync, so its hints are one
  tap from where you'd act on them.

### Fixed
- A rejected GitHub token (revoked, expired, or missing the `repo` scope) no
  longer masquerades as a temporary "unsynced changes, will sync when online"
  state. It now shows a distinct red "GitHub rejected your token — saved to
  this browser only. Reconnect in Settings." so you know your data is only in
  this browser and that action is needed, rather than believing it's safely
  synced.

## [0.93.0] - 2026-07-28

### Added
- The Amount field when adding a finance entry, a recurring expense, or
  editing a single recurring occurrence now understands basic math, so you
  can type an expression like `50-25`, `12.5*3`, or `(10+5)/2` instead of
  working the sum out yourself. It waits about a second after you stop
  typing (and also when you leave the field or save) and replaces what you
  typed with the result, rounded to the nearest cent, with a brief
  highlight. Plain numbers are left exactly as-is.

## [0.92.1] - 2026-07-19

### Added
- The backlog random-picker card now includes the source/store link buttons
  too — Steam, RAWG, TMDB, AniList, and so on (plus GG.deals for Steam
  games), the same links the edit modal overlays on the cover, shown here as
  a standalone row so they're there even when an item has no cover art.

## [0.92.0] - 2026-07-19

### Changed
- The backlog's "🎲 Pick something for me" card now shows the full picture
  for whatever it lands on, not just the title and cover: a ★ marker when
  the item is a favorite (prioritized), the rating · release year · length
  line, the current GG.deals price (for Steam-linked games), the
  description, its genres, and your own note. The rating/price/summary block
  is the same one the backlog list rows and edit modal already use, so it
  stays consistent everywhere (factored into a shared helper).

## [0.91.1] - 2026-07-19

### Changed
- Settings → Media: the proxy URL field moved out of the "Steam Wishlist
  import" section into its own **CORS proxy** heading at the top of Media
  sources, since it isn't Steam-specific — SteamGridDB cover art, GG.deals
  prices, and the Steam Wishlist import all route through the same proxy.
  Its explainer now says as much (and that any future CORS-blocked source
  will use it too), the SteamGridDB and GG.deals key hints point at the
  shared proxy above instead of a Steam-only field below, and the Steam
  Wishlist section now just references it. Storage is unchanged — the value
  still lives at `settings.steam.proxyUrl`, so nothing needs re-entering.

## [0.91.0] - 2026-07-19

### Added
- The Ledger's **Summary** view gained two insight cards. A **Highlights**
  strip (mirroring the Journal Stats one) shows your real average spend per
  active month, the single biggest month, your top spending category, and
  this calendar year's total versus last year's. And a **Spend trend** card
  charts the last twelve calendar months on one continuous timeline — with
  empty months shown as zero bars — so the direction of your spending is
  visible at a glance rather than one year at a time. Yearly ad-hoc entries
  (which carry no month) are left out of the monthly figures but still count
  toward category and year-over-year totals.

## [0.90.0] - 2026-07-19

### Fixed
- Adding or editing an entry (or any other in-view re-render) no longer
  jumps the page back to the top — you stay parked on the same spot. The
  restore now pins the section you were looking at back to its exact
  on-screen position instead of a raw scroll offset, which the browser was
  clamping away whenever the lazily-built sections above it had collapsed
  during the rebuild.

### Changed
- On mobile, the jump-nav's section label (the year/category shown in the
  bottom bar) now updates live as you scroll, instead of only when you tap
  ◀/▶ or the view re-renders — so it always names whichever section is
  currently under the top bar.

## [0.89.0] - 2026-07-19

### Added
- The Stats **Activity** heatmap is now interactive — clicking (or
  keyboard-activating) any lit month cell jumps straight to that month in
  the Timeline, scrolling it just below the top bar. Cells with no entries
  stay inert. The Timeline it lands on keeps whatever filters the Stats view
  was showing, so a lit cell always has a matching month card to land on.
- **Year in Review** gained more at-a-glance detail: an **avg rating**
  highlight (shown to one decimal) and a **from backlog** count (entries
  completed from the backlog that year) alongside the existing entries /
  unique-titles / best-month stats, plus a new **Top rated** section listing
  the year's highest-rated titles (deduped by title, keeping the best rating)
  with their category dot and star badge.

## [0.88.0] - 2026-07-17

### Changed
- The app version moved out of the bottom of Settings and up into the top
  bar, sitting directly under the ⚙ Settings button (shown as "v0.88.0",
  with the full "LifeLog v0.88.0" on hover) — so a deploy is visible at a
  glance without opening Settings.
- Picking a match from the "🔄 Sync" button now updates the title to the
  chosen media's name, so a roughly-typed title (e.g. "celest") becomes the
  proper one ("Celeste"). Editing the title afterwards no longer drops the
  media link — that only happens via the "✕ Unsync" button now, matching how
  an already-synced entry already behaved. Applies to both timeline entries
  and backlog items.
- The "🔄 Sync" button now shows matches from both the category's primary
  media source and its configured fallback (if any) in one list, so you can
  pick from either — instead of only seeing the fallback's results when the
  primary found nothing. Bulk sync and the background auto-checks are
  unchanged (they still take the primary's first result, fallback only when
  the primary is empty).

## [0.87.0] - 2026-07-17

### Added
- Keyboard reachability for the chip-style controls that were mouse/touch-only
  — the year and category filter chips, the "✎" edit-category pencil, the "+"
  add-category chip, and the per-year achievement chips. Each is now
  focusable, announced as a button (with a label on the glyph-only ✎/+
  controls), and activated with <kbd>Enter</kbd> or <kbd>Space</kbd>, using
  the same focus ring as the rest of the app. Tabbing onto a filter chip and
  pressing <kbd>Enter</kbd> toggles that filter; the ✎ inside a chip opens the
  edit modal without also toggling the filter.

## [0.86.0] - 2026-07-16

### Added
- Keyboard shortcuts — <kbd>N</kbd> to quick-add an entry, <kbd>1</kbd>–<kbd>5</kbd>
  to jump between Timeline/Stats/Backlog/Ledger/Summary, <kbd>/</kbd> to
  focus search, and <kbd>?</kbd> to open a cheat-sheet listing them all
  (also noted in Settings). They only fire when you're not typing in a
  field and no modal is already open, so they stay out of the way of
  titles, notes, and search text.
- Accessibility pass on icon-only buttons — added missing ARIA labels
  (Settings, close Settings, the cover-sync and backlog-priority buttons,
  each section's "+" quick-add) and a visible focus ring on every
  button/link/input, which previously had none beyond the browser's bare
  default.

### Changed
- Added CSV round-trip test coverage for Journal import/export (export
  then re-import and diff) — io.js's dedup logic already had solid
  coverage but the CSV round-trip itself didn't.

## [0.85.0] - 2026-07-15

### Added
- "Recently deleted" in Settings → History — entries, backlog items, and
  finance/recurring expenses deleted within your last ~40 local saves now
  show up there individually, each restorable on its own without
  reverting anything else. Derived entirely from the existing local save
  history (no separate trash store, no new retention window to manage).
- Multi-device sync conflicts are no longer silent. When a merge actually
  has to override one side's edit or resurrect something it deleted (the
  other side had touched it since), that's now called out specifically —
  in the merge toast (on load and on background sync) and in the version
  history entry it produces — instead of only showing a generic
  added/removed/edited count that couldn't tell a real conflict apart
  from an ordinary one-sided change.

## [0.84.1] - 2026-07-15

### Changed
- Removed the quick "Skip" button from a recurring expense's Ledger row —
  skipping an occurrence is now only done through the occurrence-edit
  modal's checkbox. A skipped occurrence no longer disappears from the
  Ledger entirely; it still shows as a row (faded, labeled "Skipped") so
  it stays visible and easy to click back open, while still being
  excluded from every count/total.

## [0.84.0] - 2026-07-15

### Added
- "Skip this occurrence" on a recurring expense — a one-tap "Skip" button
  right on its Ledger row excludes that month from the Ledger and Stats
  entirely (no expense recorded), without opening any modal. Reversible
  from the recurring template's own occurrence list, which now also shows
  which ones are skipped; the occurrence-edit modal gained the same
  toggle for parity.
- Search now also matches notes text, not just titles, on Timeline and
  Backlog (Ledger already searched notes). Since the search box is shared
  across every view, switching tabs while a search is active now shows a
  small badge on the other tabs with how many of their own items also
  match — previously you had to click over to each one to check.

## [0.83.0] - 2026-07-15

### Added
- PWA app shortcuts — long-press (or right-click) the installed app's icon
  for "Add entry" / "Add expense" shortcuts straight into the matching add
  modal, skipping the open-then-navigate step. Backed by a `?action=…`
  query param the app checks once on load and strips from the URL right
  after.

## [0.82.0] - 2026-07-15

### Added
- "Pick something for me" on the Backlog — a button above the list
  randomly picks one item (scoped to the active category/search filters,
  and skipping dropped/not-yet-released items), shown in a small modal
  with a re-roll button and a shortcut into that item's own edit modal.
- Backlog item edit modal now shows how long it's been sitting there
  ("Added Jan 3, 2026 — 3 months ago").
- Stats' Overview card now counts how many logged entries originated from
  the backlog ("completed from backlog") — entries moved over via the
  Backlog's "✓ Done" flow (or an auto-linked title match) now carry the
  backlog item's original add date (`backlogAddedAt`) so this, and future
  aging-over-time stats, can be computed.

## [0.81.3] - 2026-07-14

### Changed
- Backlog items within each group (prioritized, regular, upcoming/unreleased,
  dropped) now sort alphabetically by title instead of by when they were
  added.

## [0.81.2] - 2026-07-14

### Fixed
- A media-search title stripped of its trailing "Season N"/"Book N" marker
  (used when looking up cover art/metadata) left a dangling colon behind for
  a title written like "Foo: Book 3" (stripped to "Foo:" instead of "Foo").

### Added
- More test coverage for pure/near-pure logic: CSV parsing, the import
  duplicate-detection strategies, title-suggestion matching, and a few
  smaller data helpers — no user-facing change, internal only.

## [0.81.1] - 2026-07-14

### Added
- Test coverage for finance recurring-expense math (overrides, month/leap-year
  clamping, endDate cutoffs), the entry/backlog/finance sanitizers, and
  `normalize()`'s data migrations — no user-facing change, internal only.

## [0.81.0] - 2026-07-14

### Changed
- Timeline, Ledger, and Backlog now render lazily instead of building
  every year/category up front on every switch: only the section you land
  on builds immediately, the rest stream in shortly after (as you scroll
  near them, or quietly in the background), so switching tabs or making
  an edit stays fast regardless of how much history you've logged.
  Sticky year/category headers, the mobile jump-nav, and bulk editing all
  keep working the same as before — jump-nav forces a section to build on
  demand if you jump straight to it, and bulk mode still builds everything
  up front so select-all and drag-select keep working.
- Cover art images now load lazily (`loading="lazy"`) instead of every
  image on screen firing its request at once.

## [0.80.2] - 2026-07-13

### Fixed
- Tapping the jump-nav's ◀/▶ or a carousel neighbor while it was already
  mid-slide could get dropped, feel delayed, or (on a deep swipe) leave
  it permanently stuck and unresponsive. Presses now queue up correctly
  and always land, and a swipe that drags all the way to its target no
  longer wedges the carousel.
- On mobile, tapping a tab could leave a stray highlighted box stuck on
  it — a known mobile-browser quirk where a `:hover` style meant for a
  mouse gets "stuck" after a touch, since touch never fires the leave
  event that would normally clear it.

## [0.80.1] - 2026-07-13

### Added
- The jump-nav carousel's dimmed neighbor slots are now tappable, not
  just ◀/▶ — tap "2025" to jump straight to it instead of pressing next.

### Changed
- More breathing room around the jump-nav's ◀/▶ buttons so they're not
  flush against the screen edges.

### Fixed
- The tab bar's swipe underline could overshoot past the tab it was
  sliding toward, or run off-screen entirely, if you dragged further
  than the distance between tabs. It's now clamped to travel exactly
  from the current tab's box to the target's and no further.
- Pressing a tab or a jump-nav item could flash a stray text-selection
  highlight and a beat of lag before responding.

## [0.80.0] - 2026-07-13

### Changed
- The mobile jump-nav row now shows a 3-up carousel — the current year/
  category centered between its neighbors — instead of a single label
  with an underline. Swiping (or tapping ◀/▶) slides it like a real
  carousel: the neighbor slides into the center as the current one slides
  out, following your finger during the drag and snapping back to rest
  if the swipe doesn't go far enough to switch.

## [0.79.2] - 2026-07-13

### Fixed
- The tab bar and jump-nav underlines moved the wrong way while dragging
  — following the raw finger direction instead of sliding toward the tab
  or section the swipe was actually heading to (e.g. swiping left toward
  the next tab moved the underline left, away from it, since the next
  tab sits to the right).

## [0.79.1] - 2026-07-13

### Changed
- The mobile jump-nav row is taller, and its sliding underline now sits
  with a clear, consistent gap below the label instead of nearly
  touching it.
- On mobile, the tab bar and jump-nav underlines now track your finger
  in real time while swiping, instead of only jumping to their new spot
  once the gesture ends — and they snap smoothly back to rest if a swipe
  doesn't go far enough to switch.

### Fixed
- The "+" add button overlapped the jump-nav row on mobile Timeline/
  Ledger/Backlog instead of floating clear above it.

## [0.79.0] - 2026-07-13

### Added
- A sliding accent-colored underline under the active tab, and another
  under the jump-nav's current year/category label, so switching by swipe
  reads as motion instead of an instant, silent change.

### Fixed
- On mobile, the jump-nav row and the tab bar had no visible separator
  between them, and the jump-nav briefly rendered above the tabs instead
  of below (a desktop-only flex `order` rule was leaking into the mobile
  layout). The jump-nav row now consistently sits above the tab row with
  a clear divider between them.

## [0.78.1] - 2026-07-13

### Fixed
- The mobile jump-nav's ◀ Prev button landed partway into the previous
  section instead of at its start (Next always landed correctly). The
  scroll target was measured from the section's own sticky header, whose
  `getBoundingClientRect()` only reflects its true position before it's
  started sticking — once you've scrolled past a section, the browser
  reports its current sticky-pushed position instead, which isn't the
  same number. Now measures from the section's plain (non-sticky) parent
  container, whose position is consistent approaching from either
  direction.

## [0.78.0] - 2026-07-13

### Added
- Swipe left/right to navigate on mobile: on the jump-nav row, swipe to
  move between years/categories instead of only tapping ◀/▶; on the tab
  bar itself, swipe to switch views (Timeline ↔ Stats ↔ Backlog ↔ Ledger
  ↔ Summary), stopping at the first/last tab rather than wrapping around.

### Changed
- The mobile jump-nav row now genuinely collapses (with a short, ~180ms
  transition) on tabs that don't use it — Stats and Summary — instead of
  always reserving its space; the bottom bar, the FAB, toast, and
  bulk-edit bar all shrink back to their original height there rather than
  staying padded for a row that isn't shown. Added a thin separator line
  between the tab row and the jump-nav row while it's open.

## [0.77.0] - 2026-07-13

### Added
- Mobile: a quick-jump row (◀ prev / current / next ▶) below the bottom
  tab bar on Timeline and Ledger (jump by year) and Backlog (jump by
  category) — a long category or year otherwise meant scrolling through
  everything to reach the next one. Stats and Summary don't get it, since
  they're fixed card layouts with nothing to page through. The row's
  space is always reserved in the bottom bar so switching tabs never
  shifts the bar's height; it just goes visually inactive on tabs that
  don't use it. Desktop never shows it — it already has a multi-column
  layout and visible sticky headers, so paging isn't needed there.

## [0.76.2] - 2026-07-13

### Fixed
- Quick-adding a finance entry via a month card's "+" button always
  defaulted the date field to the 1st of that month, even when the card
  was the current month — it now defaults to today's actual date when the
  quick-add month matches the current month, and only falls back to the
  1st when adding into a different (past) month.

## [0.76.1] - 2026-07-12

### Fixed
- Recurring expenses could land on the wrong day of the month for anyone in
  a timezone ahead of UTC (most of Europe/Asia/Australia) — a expense
  started on, say, the 12th could generate the 11th instead. The date
  string for each occurrence was built by converting a local-time `Date`
  through `.toISOString()`, which round-trips through UTC and can shift
  local midnight back a calendar day. Occurrence dates (and a few related
  "today" defaults — the finance-entry date field, a new recurring
  expense's start date, and the recurring-card active/expired check) now
  build their date strings from local calendar fields directly, with no UTC
  conversion.
- Finance entries logged on the same date could appear at the top or
  bottom of the month's list inconsistently — the Ledger sorted by date
  only, so same-date entries fell back to their position in the underlying
  array. That position is stable during a session but gets reshuffled by
  the multi-device merge (it rebuilds the array from a `Set` of ids, not
  insertion order), so the display order would flip after a sync. Same-date
  entries now break ties by `createdAt`, so the order stays deterministic
  regardless of merges.

## [0.76.0] - 2026-07-12

### Changed
- Renamed `src/steam.js` to `src/sync.js` and folded the AniList Planning
  sync (`syncAniListPlanning`, `maybeAutoCheckAniList`) into it alongside
  the Steam wishlist sync — both follow the same shape (fetch an external
  list, dedupe against the backlog/Journal, route through the shared review
  picker, plus a quiet background auto-check), so they share one module
  instead of AniList getting a thin file of its own. `window.LifeLogSteam`
  is now `window.LifeLogSync`. No behavior change.

## [0.75.0] - 2026-07-12

### Changed
- Two more pieces moved out of `src/app.js` into their own modules, the
  optional follow-up noted after the finance/settings/backlog/journal
  modularization: `src/io.js` (JSON/CSV export and import for the full
  backup and the journal, the dup-checked import-item builder, and the
  shared import/export review picker used everywhere — including finance's
  own CSV flow) and `src/steam.js` (the manual Steam App ID cover helper
  shared with the backlog/journal modals, GG.deals price lookups/caching,
  the wishlist sync, the unresolved-title retry and RAWG-backfill
  follow-ups, and the quiet background auto-check). Both follow the same
  `init(ctx)` pattern as the earlier extractions — cross-module sanitizers
  and cover setters arrive via `ctx` rather than reaching for another
  module's `window` global directly. `app.js` is down to ~1,500 lines, from
  ~2,290 before this change. No behavior change.

## [0.74.0] - 2026-07-12

### Added
- AniList Planning auto-check (Settings → Media → AniList "Check
  automatically"): a quiet cadence (Never / daily / every 3 days / weekly /
  monthly) that, at most that often when you open the app, fetches your
  Planning list(s) and counts how many titles aren't already in your backlog
  or Journal, then just toasts that count — it never opens the review picker
  or adds anything on its own. Mirrors the existing Steam Wishlist
  auto-check, uses the same source+id / title+category dedup as the import,
  and paces each device independently (the last-checked timestamp is stored
  locally, not synced).
- SteamGridDB is back as a games cover-art source and fallback. It's
  CORS-blocked from the browser, so it now routes through the same
  self-hosted CORS proxy as the Steam Wishlist import (its
  `/steamgriddb/<path>` route) — set the SteamGridDB API key and the proxy
  URL in Settings → Media, then pick "SteamGridDB (games)" as a category's
  source or fallback.

### Fixed
- Stats: the Highlights card sat flush against the Overview card above it
  with no gap (they overlapped at small widths) — it now has the same top
  margin as the other stacked cards.

## [0.73.0] - 2026-07-11

### Added
- AniList Planning import (Settings → Media): pulls your AniList
  plan-to-watch (anime) and plan-to-read (manga) lists into your backlog.
  No proxy or API key needed — AniList allows browser requests and public
  lists need no auth. Anime and manga are pulled separately into whichever
  categories you choose (leave one as "Don't import" to sync only the
  other), and each imported item carries its cover, AniList rating,
  episode/volume count, and genres. Routed through the same review picker
  as every other import: nothing is added until you confirm, and items
  already in your backlog or already logged in your Journal are tagged and
  hidden by default. Re-syncing later won't re-add them — matched by
  title+category and, more strongly, by AniList media id, so a title you
  renamed locally after an earlier import still isn't treated as new.

### Changed
- The import review picker's "already added" duplicate check now matches on
  media source+id for every source, not just Steam — so an AniList (or any
  future ID-bearing source) item renamed locally is still recognized as a
  duplicate on re-import.

## [0.72.0] - 2026-07-11

### Added
- Stats → Highlights card: a few computed one-liners each time Stats opens
  — busiest single month, longest run of consecutive months with at least
  one entry, top category, and this year's count vs last year's — all from
  data Stats already had.
- Stats → Monthly pattern card: total entries per calendar month (Jan–Dec)
  summed across every year, so seasonal habits stand out in a way the
  per-year activity heatmap doesn't.
- Stats → Genres card: a breakdown of entries by genre. Media sources now
  capture a genres[] field on sync (RAWG, TMDB — via its documented genre-id
  maps, no extra request — AniList, Jikan, Open Library subjects, and Google
  Books categories; capped at 4 per item). Existing entries stay blank until
  re-synced, and the card only appears once some entries have genres, so an
  all-blank library shows nothing rather than an empty card. Genres ride
  along through re-entry suggestions and the entry↔backlog transfer the same
  way cover art and length already do.

## [0.71.0] - 2026-07-10

### Changed
- The Journal moved out of `src/app.js` into a new `src/journal.js` module:
  the Timeline and Stats views (heatmap + Year in Review), the entry
  add/edit modal, timeline entry bulk actions, achievements, category
  management, and the entry sanitizer — plus the shared title-suggestion
  and media cover/sync machinery, which the backlog modal also uses and now
  receives (re-forwarded through `app.js`) via `LifeLogBacklog.init(ctx)`.
  This completes breaking app.js into per-view modules: it's now a ~2,150-line
  shell (boot, storage/sync, the filter bar, shared bulk-select and modal
  plumbing, import/export, and the data lifecycle) down from ~5,200 lines,
  with finance/settings/backlog/journal each in their own file. No behavior
  change.

## [0.70.0] - 2026-07-10

### Changed
- The Backlog moved out of `src/app.js` into a new `src/backlog.js` module:
  the view (category sections with priority/unreleased/dropped ordering and
  separators), plain + rich rows, the add/edit modal with title suggestions
  and media sync, backlog bulk actions (move/delete/sync), and the backlog
  sanitizer. No behavior change — step three of breaking app.js into
  per-view modules (finance.js, settings.js were the first two). The
  GG.deals price cluster, cover-link buttons, and the shared
  `applySteamAppId` stay in app.js (the journal entry modal uses them too)
  and are handed in via `LifeLogBacklog.init(ctx)`. app.js is down to
  ~3,100 lines, from ~5,200 before this modularization began.

## [0.69.0] - 2026-07-10

### Changed
- The Settings modal moved out of `src/app.js` into a new `src/settings.js`
  module: tab switching, the Data panel (local file + GitHub connections,
  backend info, version history with restore), Appearance controls, media
  source/key settings including the Steam wishlist inputs, and the
  privacy/app-lock panel. No behavior change — step two of breaking app.js
  into per-view modules (finance.js was step one). The Steam wishlist
  sync machinery and the PIN/biometric crypto helpers stay in app.js (the
  lock screen shares them) and are handed in via `LifeLogSettings.init(ctx)`.

## [0.68.0] - 2026-07-10

### Changed
- All finance code moved out of `src/app.js` into a new `src/finance.js`
  module (the Ledger and Summary views, finance/recurring/finance-category
  modals including per-occurrence overrides and the link-past-expenses
  picker, finance import/export, and the finance sanitizers) — app.js
  drops from ~5,200 to ~4,300 lines. No behavior change; this is the
  first step of breaking app.js into per-view modules the way media.js
  and qr.js already are. The module receives shared app helpers via
  `LifeLogFinance.init(ctx)` and exposes what app.js still calls
  (view renderers, modal openers, sanitizers) on `window.LifeLogFinance`.

### Fixed
- The service worker's offline precache list was missing `src/merge.js`
  (loaded by index.html since the sync/merge rework), so a first visit
  that went offline before ever re-fetching it could load an app shell
  with no merge module. `src/finance.js` and `src/merge.js` are both
  precached now.

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
