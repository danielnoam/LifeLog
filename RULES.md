# Rules that stop drift

Shared by every app on keel (synced from danielnoam/keel; change it
there). Each rule is one a real bug or inconsistency broke. The app's
own DESIGN.md and CONTRIBUTING.md name its classes, tokens and helpers;
these are the rules behind them. `tools/keel-checks.js` enforces the
ones marked **(checked)**.

## Every language, every screen

- A feature is done when it works in every language the app has
  (right to left included) and on every screen and platform it ships
  to: a phone, a wide window, each app build, and its widgets when it
  touches what they show. Check each one before calling it done.
- Built for one platform on purpose is fine, but say so where people
  look: the pull request, the release note ("Android only: ...") and the
  feature's docs say it was never built for the others. Silence reads
  as a bug.
- UI text goes through the language table, never a string literal set
  straight into the page. Text that stays English on purpose (a brand,
  a version) says `// en-only: <why>` on its line. **(checked)**

## Motion

- Anything that opens also leaves: a menu, list or sheet plays its exit
  before it goes, never a bare `remove()` or `hidden`.
- Direction follows the move: deeper slides forward, back (Back, Esc,
  up a level) slides back, at every level, not only the top one.
- Arrive with the settle curve, leave with the ease curve, and leave
  faster (about .14s out against .2–.24s in).
- Curves are the app's tokens, never a literal `cubic-bezier()` or a
  keyword like `ease-out`. A status loop (`infinite`) is the one
  exception. **(checked)**
- Animate `transform`, `opacity`, `scale`, `translate` and colors. Never
  `font-size`, `line-height`, `letter-spacing`, `padding` or `margin`:
  they re-lay out the page every frame. To grow text, scale it.
  **(checked)**
- Every animation has its reduced-motion answer beside it.

## Components

- One class per job. Search the CSS before adding one; two
  near-identical classes (`btn-small` and `btn-sm`) are a bug, not a
  choice.
- Controls side by side in a bar are one height.
- Every sheet with a grab handle swipes down, the app's own pickers
  included.
- One mechanism per behaviour (press feedback, sheet swipe, list moves).
  A second copy drifts from the first.

## Looks that read as machine-made

From Hallmark's list of the defaults a model falls into
(github.com/nutlope/hallmark). An app's DESIGN.md can overrule one with
its reason written down.

- No labels in tracked capitals or small caps: section heads, captions,
  table heads, tags and tabs are sentence case, untracked, a step
  smaller and semibold if they need weight. No eyebrow (a small label
  above a heading that repeats it).
- Details are joined by commas or set as separate lines, not middle dots
  ("Bar 3, 40% trouble", not "Bar 3 · 40% trouble"). No arrows glued to
  link text.
- No colour past the token block: shadows, backdrops and overlays are
  tokens too, with their dark-mode values.
- No card inside a card, no purple-to-blue gradient, no emoji as an icon,
  no one coloured or italic word inside a heading.
- A status dot only where it carries a state (connected, synced), never
  as decoration.
- No made-up numbers, quotes or logos in demo data or screenshots.

## Words

- One thing, one name: its title, button, toast, home panel, widget and
  translation all use the same word. Search the language table for the
  name already in use before writing a new one.
- Titles and buttons are a verb and a noun with no article: "Add
  ticker", "Edit expense". An add button with words is "+ Add X" in
  text, not a plus icon; the icon is for icon-only buttons.
- An empty choice says what it means ("No project"), never "— none —"
  or a blank.
- A notification's title and body never repeat each other.

## Behaviour

- A Save that can't save says why, beside the field or in an error
  toast. A bare `return` from a save handler is a bug.
- Every way to a destructive result (an emptied name, a bulk action,
  a select set to none) goes through the same delete, with its confirm
  or Undo.
- Refuse bad data when it's written, with a message. Never skip or
  clamp it quietly when it's read.
- Changing one control never resets another: picking "Custom" keeps the
  current value and opens its fields.

## Data and state

- An edit screen saves only what it changed, merged over the record as
  it is now. A reminder, widget, sync or AI may have changed it while
  the screen was open.
- Derived state (done, totals, holdings) is worked out in one function,
  and every surface that changes its parts calls it: the app, widgets,
  the AI bridge, the desktop app.
- A fix in one surface is checked in the others the same day.
- A stat or check covers every shape of its data (repeating, no date,
  nested, sold, another currency), each with a test.
- Read input before calling anything that changes it. Test a paste of
  several values, blanks, spaces and right-to-left text.

## Time and async

- A check that runs every N seconds looks back at least N seconds; never
  compare a due time to "now" to the second.
- Wait for the request for the thing you need (that month, that id), not
  whatever is loading.

## Tests

- Every bug fix comes with a test that fails without it.
- Wait for the condition (the element, the request, the write), never a
  fixed sleep for a side effect. Long fixed waits may only go down.
  **(checked)**
