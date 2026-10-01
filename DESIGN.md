# LifeLog design language

How LifeLog looks, moves and talks, and the rules that keep it that way. The
code in `src/styles.css` is the implementation; this file is the intent. When
the two disagree, one of them is wrong. Fix whichever one it is, and say which
in NOTES.md.

Each rule is marked:

- **Now:** this is how the app already works. Follow it.
- **Target:** agreed direction, not built yet. New code follows it; old code
  moves toward it when it's being touched anyway.

Neighbours: **NOTES.md** says why a particular piece is built the way it is,
and **TODO.md** holds the work. Two skills apply this file:
`.claude/skills/lifelog-design` (building UI) and
`.claude/skills/lifelog-ui-audit` (checking it).

---

## 1. Character

LifeLog is a private notebook for a life: what you finished, what's next, and
what it cost. You open it many times a day, mostly on a phone, usually for a
few seconds. That decides almost everything below.

1. **Quiet by default, loud on purpose.** The surface is grey on grey. Color
   always *means* something: a category's own color, green or red money, amber
   priority. The accent marks the one thing to do next, and a screen with
   three accent buttons has none.
2. **The data is the interface.** No headers explaining what a screen is, no
   decorative cards around cards. Dense lists, real titles, numbers that line
   up. If a piece of chrome doesn't help you read or change your log, cut it.
3. **One app, three shells.** The same files run as a web app, an Android app
   and an iOS app. It should *behave* natively (sheets, safe areas, touch
   feedback, the share sheet) without *imitating* either platform's look.
4. **Every theme is the real theme.** Default, Light, Nord and Dracula are
   equals. Nobody designs in one and hopes for the rest.
5. **Motion explains, it doesn't decorate.** Something moves to show where it
   came from or where it went, or to confirm a press. Nothing loops, glows or
   bounces just to be seen.
6. **Say what happened, then what to do.** Every message leaves you knowing
   your data is safe and what comes next.

Rulebooks we borrow from, and only for these things:

- **Apple HIG** is the main one: touch targets, sheets, hierarchy and less
  chrome.
- **Shopify Polaris** for forms, validation and error messages.
- **IBM Carbon** for Finance numbers only: tabular figures, right-aligned
  amounts, high-contrast chart colors.

We don't use component libraries (shadcn, Mantine, Aceternity) and don't use
React or Tailwind. LifeLog is plain JS/CSS with no build step; see the README.

---

## 2. Color

### Tokens (Now)

There are two layers. **Raw values** exist only inside `:root` and the
`html.theme-*` blocks. **Every other rule uses a semantic token.** A hex
value anywhere else is a bug. The one exception is pure black or white over a
photo (cover-image buttons).

| Role | Tokens |
|---|---|
| Surfaces, low → high | `--bg` → `--bg-elev` / `--surface-card` → `--bg-elev-2` → `--hover-bg` |
| Lines | `--border`, `--border-strong` |
| Text | `--text` (content), `--text-dim` (secondary: anything you need to read), `--text-faint` (decoration only: glyphs, placeholders, done and disabled items) |
| Text on fills | `--text-on-accent` (accent fills), `--text-on-fill` (category dots, badges) |
| Action | `--accent` (links, active labels, focus, indicators), `--accent-fill` / `--accent-fill-hover` (a fill with text on it: primary buttons, active tabs and chips), `--accent-soft` (tinted callouts, selected rows) |
| Status | `--success`, `--warning`, `--danger` / `--danger-bg` / `--danger-text` |
| Money | `--expense` (an alias of `--danger`, used by `.fnegative`); positive and income amounts use `--success` where they're colored at all |
| Sync LEDs | `--led-idle`, `--led-connected`, `--led-local`, `--led-syncing` |
| Fixed identity | `--priority` (amber stars; deepened on Light only), `CATEGORY_PALETTE` in app.js. These keep their hue in every theme |
| Overlay | `--scrim`, `--shadow`, `--nav-shadow` |

A new theme overrides the same names; it never adds one-off tokens. If a
new token is needed, add it to `:root` *and* define it (or alias it) in every
theme block in the same change.

### Meaning (Now)

- **Accent** marks the primary action, the active tab or chip, focus rings and
  links. Never decoration.
- **Category color** belongs to the category: its dot, chip and month bar.
  Don't reuse a category hue to mean anything else.
- **Green and red are for money** (income and expense, positive and negative
  net) and for success and danger. Never both meanings on the same screen.
- **Amber** is priority and warning. Stars are the only place it's large.

### Contrast (Now)

WCAG AA: **4.5:1** for text, **3:1** for icons, control borders and large or
bold text. `lifelog-ui-audit/scripts/contrast.js` checks every theme and
exits non-zero on a failure. **All four themes pass** as of 0.219.0, from 17
failures before it.

The rules that keep it passing:

- **Readable text is `--text` or `--text-dim`.** `--text-faint` is held to
  the 3:1 icon bar only, so it may draw glyphs (✕ › grips), placeholders,
  done and disabled items, and hover borders, never information.
- **Text on an accent fill sits on `--accent-fill`**, not `--accent`. They
  differ in the Default theme only: its blue is right for links on dark
  surfaces and too light under white text. Fills without text (checkbox,
  switch, dots, bars) use `--accent`.
- **Red text is `--danger`**, which each theme sets light enough to read on
  a card. On Nord that comes out pink (`#ea9aa1`): any red that passes on
  Nord's mid-grey surfaces does.
- A new theme, or any change to a theme value, reruns `contrast.js` in the
  same change. A new token pair that carries text goes into its `PAIRS`.

---

## 3. Type

### Family (Now)

The system UI font (`--font-family`, chosen in Settings → Font: system,
serif, mono, rounded). There's no brand typeface, on purpose: the app should
feel like part of the phone it's on. `--font-mono` is for codes and keys.
Boards use Virgil for their hand-drawn look, and only there.

### Scale (Now; every font size is a token since 0.223.0)

Every `font-size` in styles.css is a `var(--fs-*)`; the lint counts
anything else as drift (zero as of 0.223.0). The scale was widened in
0.223.0 to the roles the app actually has (reading text at 15, page titles
at 20, stat numbers at 26), rather than forcing those onto neighbours:

| Token | px | Use |
|---|---|---|
| `--fs-3xs` | 10 | micro labels: bottom-nav labels, chart axes, tiny tags |
| `--fs-2xs` | 11 | badges, eyebrows (uppercase, +0.04em tracking), chart labels |
| `--fs-xs` | 12 | meta lines, secondary buttons |
| `--fs-sm` | 13 | **body**: rows, buttons, chips, toasts |
| `--fs-md` | 14 | row titles, emphasized body |
| `--fs-read` | 15 | reading text: note bodies, card and habit titles, quotes |
| `--fs-lg` | 16 | card and section headings; **every field on a phone** (iOS zooms below 16) |
| `--fs-xl` | 18 | sheet titles, nav glyphs |
| `--fs-title` | 20 | page titles: empty states, Settings pages, collections |
| `--fs-2xl` | 22 | view titles |
| `--fs-stat` | 26 | stat numbers |
| `--fs-3xl` | 30 | big totals (Finance), large glyphs |
| `--fs-display-sm` / `--fs-display` / `--fs-display-lg` | 42 / 52 / 64 | Recap and empty-state glyphs only |

Weights: **450** body, **550** buttons and controls, **600** titles and labels,
**700** big numbers. 800 is for Recap only.

### Numbers (Now, Carbon)

Any number that sits in a column or changes in place uses
`font-variant-numeric: tabular-nums`. Amounts are right-aligned, and the
currency sits with the number (₪). Totals that change count up with
`animatedNumberText()`.

---

## 4. Space, shape, depth

### Spacing (Now; on the scale since 0.223.0)

**2px steps up to 16, then 4px steps up to 64** (0, 2, 4 … 16, 20, 24 … 64),
plus 1px for hairlines. A 2px base suits LifeLog's density; above 16 the
steps get coarser. Past 64 a value is a layout constant (a bar's height, a
fallback for a measured one), not spacing, and isn't checked. 0.223.0
moved every stray onto the scale with one rule: odd values up by 1px,
larger ones to the nearest 4 (ties up), so pairs such as a sheet's 22px
padding and its cover's −22px margin moved together (both to 24).
`--space-2` … `--space-48` exist for new rules; existing shorthands stay px.

Defaults: a row is padded 6×8, a card 12×14, a sheet 24×24. Mobile content
padding is 14. Gaps between rows are 2–4, between groups 12–16, between
sections 24.

### Radius (Now; every radius is a token since 0.223.0)

| Token | px | Use |
|---|---|---|
| `--r-hair` | 2 | hairline bars (tab underline, progress segments) |
| `--r-xs` | 4 | focus rings, tiny badges, thumbnails |
| `--r-sm` | 6 | rows, list items, inner controls |
| `--r-md` | 8 | buttons, inputs, segmented controls |
| `--r-lg` | 10 (`--radius`) | cards, month cards, toasts |
| `--r-card` | 12 | larger cards: settings groups, habit and board cards, covers |
| `--r-xl` | 14 | sheets, modals |
| `--r-sheet` | 18 | the top corners of a bottom sheet |
| `--r-pill` | 999 | chips, pills; 50% for dots and avatars |

Nested corners: an inner radius equals the outer radius minus the padding
between them, so a row in a card never looks rounder than the card.

### Elevation (Now)

Depth comes from surface color, not shadow. Page `--bg` → card `--bg-elev`
→ control or input `--bg-elev-2` → hover `--hover-bg`. **Only floating things
get `--shadow`:** sheets, toasts, menus, the FAB. A card on the page has a
border and no shadow.

Blur (`backdrop-filter`) is allowed on things that float over moving content:
the bottom nav and buttons over cover images. Not on sheets, and not on
lists. It's expensive in the Android WebView.

---

## 5. Motion

### Tokens (Now)

| Token | Value | For |
|---|---|---|
| `--dur-fast` | .12s | hover, color, press release |
| `--dur` | .18s | small state changes |
| `--ll-move-dur` | .3s | rows moving to a new place (`reconcile.js`, `animate: true`) |
| `--ease` | `cubic-bezier(.4,0,.2,1)` | leaving, closing, color |
| `--ll-move-ease` | `cubic-bezier(.22,1,.36,1)` | **settle**: arriving, opening, moving |
| press spring | `cubic-bezier(.34,1.56,.64,1)` | the release overshoot in `wirePressFeedback()` |

### Rules (Now)

- **Arrive with settle, leave with ease, and leave faster** (about .14s out
  against .2–.24s in).
- Sheets **translate**, never scale: scaling throws off anything that
  measures itself on open, such as the wheel.
- **Presses are interruptible.** `wirePressFeedback()` animates `scale` with
  the Web Animations API and springs back from wherever the press was. Any
  new pressable joins `PRESSABLE`; don't write a second mechanism.
- Lists move with `reconcile.js` and its `.ll-enter`, which owns `opacity` on
  rows. Don't animate a row's opacity anywhere else.
- **Every** transition and animation has a `prefers-reduced-motion: reduce`
  answer next to it. Reduced motion means no movement; a plain fade is fine.
- Nothing animates on load, on a timer, or in a loop. The one exception is
  the syncing LED, which is a status.

### Springs (Now, 0.222.0)

`--spring-snappy` (~12% overshoot, for ~.35s) and `--spring-soft` (~1.5%,
for ~.4s) are damped springs sampled into CSS `linear()`, so a plain
transition can overshoot and settle. They're tied to the duration they were
sampled for; don't stretch them. Swipe-down on sheets (`wireSheetSwipe` in
app.js) follows the finger with plain touch events and springs back with
`--spring-soft`: no physics library. Bring one in (Motion's plain-JS
`animate()`, copied into `src/vendor`) only if a gesture needs to carry its
speed into the settle, which nothing does yet.

---

## 6. Components

Build from these. Each is a class in `styles.css`, plus a helper in `app.js`
where one exists. A new component goes in this list in the same change.

| Component | Where | Notes |
|---|---|---|
| Element builder | `el(tag, cls, txt)` | Build dynamic DOM with it. `innerHTML` is only for fixed markup, and never with user data (titles, notes, category names) in the string. |
| Button | `.btn`, `.btn-primary`, `.btn-danger`, `.btn-icon` | One `.btn-primary` per sheet or screen. Danger is outlined, not filled. Disabled is 45% opacity and doesn't press. |
| Segmented control | `.seg` > `.seg-btn` | For 2–4 mutually exclusive views or modes. |
| Chip | `.cat-chip` (+ `.chip-edit` ✎, `.add-chip`, `.year-chip`) | Filters and categories. Active = accent fill. Category chips carry a `.dot`. |
| Tab and nav | `.tab` with `data-icon` | Text pills on desktop. On mobile the glyph from `data-icon` is drawn above the label (`.tab::before`, mobile blocks only). |
| Card | `.card`, `.month-card` | Border, no shadow. `monthCardHeader()` for month groups. |
| Row | `.entry`, `.backlog-item-rich`, `.recur-row` | The whole row is the tap target. It darkens on press. |
| Sheet | `.modal-overlay` > `.modal` | Rises in and fades out (pure CSS, `@starting-style`). Full-screen on mobile for writing (notes); a bottom sheet for options (`.view-options`). Safe-area padding under `html.native`. On a phone it swipes down to close (`wireSheetSwipe`, app.js), through the backdrop's own click. |
| Menu | `.menu-pop` | Opens upward from its trigger and rises into place. A sheet's More… is `.menu-wrap.sheet-more` with a `.sheet-more-btn`; app.js wires every one, and each item saves the sheet and acts at once. |
| Toast | `toast(msg, isErr, action)` | 2.6s, 6s for an error, 8s with an action. **Undo is a toast action**, never a confirm dialog after the fact. |
| Empty state | `emptyState({ glyph, title, body, action, onAction, hint })` | A rich empty state for a view with no data yet. Pass a plain string for "nothing matches your filters", which gets no button. |
| Animated number | `animatedNumberText(node, key, value, fmt)` | For totals that change in place. |
| View switch | `fadeInOnViewChange(root)`, `.view-fade-in`, `.mode-slide-fwd/back` | Slides follow the direction you moved in. |

### Icons (Now)

Two kinds, each with its own job:

- **Unicode glyphs** inline with text and on controls: ☰ ▤ ★ ₪ ◑ ✎ ✓ ✕ +
  ↻. They inherit the text color, follow the user's font, cost nothing, and
  look like the rest of the text. One glyph per meaning, reused everywhere
  (✎ = edit, ✕ = remove, ✓ = done, + = add).
- **Inline SVG** (24×24 viewBox, `currentColor`, `aria-hidden="true"`) only
  where a glyph can't draw the idea and the icon stands alone as a row's
  leading mark: the Settings rows (`.srow-ic`). No icon font, and no SVG
  sprite library.

An icon-only button **must** have an `aria-label` or a `title`.

---

## 7. Patterns

- **Adding** is always one tap from where you are: the month's +, the FAB, a
  widget or a shortcut (Now). The form opens ready to type, with the cursor in
  the first field (Target, check each form).
- **Destructive actions act at once and offer Undo** in the toast. A confirm
  dialog is only for things Undo can't bring back (reset, disconnecting sync,
  deleting a board with content).
- **Bulk mode** replaces the + in a month header with a select-all box, and
  its bar stays pinned while it's on. It's a mode, so it has to be obvious
  that it's on and how to leave it.
- **Sheets close** on Esc, the scrim, the back gesture (Android) and swipe
  down (0.222.0; not the board editor, the wheel or the conflict picker).
  Focus goes back to whatever opened them (Target, check each sheet).
- **Settings** is a list of pages. On mobile you get one page at a time with
  a back header.
- **Sync is always visible but never in the way**: an LED for state, and a
  toast only when something needs you.

---

## 8. Voice

The app talks like a friend who's good with computers: short, specific, calm,
and never blaming.

- **Sentence case** everywhere, buttons included. Toasts have no final
  period.
- **Lead with what happened, then add the consequence after an em dash:**
  "Started — it's at the top of your Timeline".
- **"Your"** for the person's things ("your backlog"). "We" only for the app's
  own mistakes.
- **Errors (Polaris):** what went wrong in plain words, then what to do.
  "This device isn't syncing with GitHub — connect it in Settings". Say
  "Couldn't …", not "Failed to …" or "Error:". Never show a raw status code or
  stack trace on its own; put it after the plain sentence if it helps
  support.
- **Validation** sits next to the field and names the rule: "The stop date
  can't be before the start date".
- **Buttons are verbs** saying what will happen: "Add to backlog", "Connect",
  "✓ Done". Not "OK" or "Submit". The add glyph is part of the label: "+ Add
  entry".
- **Empty states** tell you what goes here and how to start, in one sentence
  each.
- No exclamation marks, no "Oops", no emoji except the established glyphs.

---

## 9. Accessibility

- **Touch targets are at least 44×44px** on mobile (Now, with the
  exceptions below). A small
  *visual* is fine: give it an empty absolutely-positioned `::after` sized to
  the free space around it (half the gap to each neighbour, so areas never
  overlap), and `z-index` a control that sits inside another one. Measure
  with `tap-targets.js`, which probes what a finger actually reaches.
  Measured at 375px across Timeline, Backlog, Notes, Habits, Ledger,
  Settings and the sheets (0.219.0–0.222.0): Timeline went from 111
  controls under 44 to a handful. Fields (search, sheet fields) are
  44 tall on phones. What's still short, and why:
  - filter chips, 34 tall: 44 would mean visibly bigger chips, declined;
  - the habit grid's day cells, 16px: hundreds of days can't each be 44;
  - a list's ☐ ✕ (22×27, 28×30) and ✓ ↩ on coverless rows (35): they fill
    their row, and the row is that tall;
  - rating stars, 22 wide: they sit 4px apart;
  - the habit name, 41 tall, and the year header's achievement pills, 24.
  The Boards editor hasn't been measured.
- **Focus:** one global `:focus-visible` ring (2px accent, 2px offset)
  covers every button, link and field (Now). Don't remove an outline without
  replacing it.
- **Contrast:** see §2. Run `contrast.js` after touching any theme value.
- **Labels:** every icon-only control has an `aria-label`, and every sheet
  has `role="dialog"` and `aria-labelledby`.
- **Motion:** `prefers-reduced-motion` is honored everywhere (Now, about 20
  blocks). Keep it that way.
- **Fields on a phone are 44px tall with 16px text** (0.222.0: the search
  and every field in a sheet), so they're easy to hit. Sort is the
  exception: a compact 36px, 13px menu beside the buttons it sits with
  (0.224.0). iOS's zoom-on-focus for small text is stopped by
  `maximum-scale=1`, added on iPhone/iPad only in app.js (iOS still allows
  pinch-zoom; on Android the same setting would block it).
- **A bar's right-hand group stays on the right**, also when a narrow
  screen wraps it (`.backlog-mode-bar > .dsc-bar-right`), and is kept short
  enough not to wrap at 375px: icon-only buttons with their words in
  `aria-label` and `title`.
- **Color is never the only signal.** A category has a name as well as a
  dot, and money has a sign as well as a color.

---

## 10. Platforms

| | Web (desktop) | Web (phone) / Android / iOS |
|---|---|---|
| Layout | top bar, pill tabs, grid of month cards | one column, bottom nav with glyph tabs, FAB, 14px padding |
| Breakpoint | > 720px | ≤ 720px (`html.force-mobile` / `force-pc` override it) |
| Sheets | centered, 420px wide | bottom sheet or full screen |
| Input | hover states, keyboard shortcuts (see the `?` sheet) | press feedback, long-press, swipe-down on sheets (0.222.0). No swipe actions on rows (DROPPED.md) |
| Native extras | none | `html.native`: safe-area padding (`--sat`/`--sab`), no WebView overscroll glow, the share sheet for exports |

Test every UI change at **1280px and 375px**, in **all four themes**, and
once with reduced motion on.
