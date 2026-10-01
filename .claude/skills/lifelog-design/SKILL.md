---
name: lifelog-design
description: LifeLog's design language applied — how to build or change any UI in the LifeLog app (danielnoam/lifelog) so it matches DESIGN.md. Covers tokens and themes, the type/space/radius scales, motion rules, the existing components and helpers to build from (el, emptyState, toast, .btn, .cat-chip, .modal-overlay sheets, reconcile.js), copy voice for buttons, toasts and errors, touch targets and contrast. Use whenever adding or restyling a view, sheet, form, button, chip, card, empty state, toast or error message in LifeLog, or writing any user-facing text in it.
---

# Building UI in LifeLog

`DESIGN.md` at the repo root is the design language. This skill is the
working order for applying it. Read the sections of DESIGN.md that match
what you're building before writing code. Don't rely on memory: the measured
numbers there (contrast, tap targets, drift) are the current truth.

LifeLog is vanilla HTML, CSS and JS with no build step and no dependencies.
Nothing here changes that: no React, no Tailwind, no component library, no
npm package in the app itself.

## 1. Find what already exists

Before writing a new component, look for the existing one (DESIGN.md §6):

- DOM: `el(tag, cls, txt)` in `src/app.js`.
- Buttons `.btn` / `.btn-primary` / `.btn-danger` / `.btn-icon`; segmented
  control `.seg` > `.seg-btn`; chips `.cat-chip`; cards `.card` /
  `.month-card` + `monthCardHeader()`.
- Sheets: a `.modal-overlay[hidden]` > `.modal` in `index.html`. Open and
  close by flipping `hidden`; the CSS animates it. Add its close call to the
  Escape handler in `app.js` (search `e.key === "Escape"`).
- Feedback: `toast(msg, isErr, { label, onClick })`; `emptyState({...})`.
- Motion: `animatedNumberText`, `fadeInOnViewChange`, `reconcile.js` with
  `animate: true` for lists, `PRESSABLE` + `wirePressFeedback()` for presses.

Grep `styles.css` for a similar selector before adding one. Extend the
existing class with a modifier instead of starting a parallel one.

## 2. Hard rules (a change that breaks one isn't done)

1. **Colors are tokens.** No hex or rgb outside `:root` / `html.theme-*`. A
   new token goes into `:root` and gets a value or alias in all three theme
   blocks in the same change.
2. **Text you need to read is `--text` or `--text-dim`.** `--text-faint` is
   only for things you could hide without losing information. Text on an
   accent-colored fill sits on `--accent-fill`, never `--accent`.
3. **Sizes come from the scales:** font 11/12/13/14/16/18/22/30, spacing
   0/2/4/6/8/10/12/14/16/20/24/32…, radius 4/6/8/10/14/999. No 12.5px, 7px or
   5px in new code.
4. **Touch targets are 44×44 on mobile.** A small glyph is fine if its hit
   area is padded out (an inset `::before`, a wrapping label, padding with
   a negative margin).
5. **One `.btn-primary` per sheet or screen.** Danger is outlined.
6. **Every animation has a `prefers-reduced-motion` answer** right beside
   it. Arrive with `--ll-move-ease`, leave with `--ease` and faster. Sheets
   translate, never scale. Don't animate row `opacity` (`.ll-enter` owns it).
7. **Icon-only controls have an `aria-label`.** Sheets have `role="dialog"`
   + `aria-labelledby`.
8. **Text inputs are 16px or more on mobile** (iOS zoom).
9. **No `innerHTML` with user data.**
10. **Mobile and desktop both:** check the `@media (max-width: 720px)` block
    *and* its `html.force-mobile` mirror. They're kept in sync by hand. Under
    `html.native`, pad for `--sat` / `--sab`.

## 3. Writing the words

The full voice is DESIGN.md §8. The short version:

- Sentence case. No period at the end of a toast. No "!", no "Oops".
- Say what happened, then the consequence after an em dash: "Removed from
  backlog", "Started — it's at the top of your Timeline".
- Errors say what to do: "Couldn't reach GitHub — your changes are saved
  here and will sync when you're back online". Never "Error:", "Failed to",
  or a bare status code.
- Buttons are verbs: "Add to backlog", "✓ Done", "+ Add entry". Never "OK"
  or "Submit".
- Deleting acts at once and offers **Undo** in the toast action. Ask for
  confirmation only when nothing can bring the data back.
- Glyphs: ✎ edit, ✕ remove, ✓ done, + add. One glyph per meaning.

## 4. Check it

1. `node --check` every edited `.js`.
2. `node .claude/skills/lifelog-ui-audit/scripts/contrast.js` if you touched
   any theme value or token.
3. `node .claude/skills/lifelog-ui-audit/scripts/lint-css.js`. Your change
   shouldn't raise any count. If you were in that area anyway, lower one.
4. Preview it (`preview_start` "lifelog"): 1280px and 375px wide, in Default,
   Light, Nord and Dracula (Settings → Appearance), and once with
   `prefers-reduced-motion`. Run `lifelog-ui-audit/scripts/tap-targets.js`
   in the page at 375px for anything pressable you added.
5. Screenshot the result for the user.

## 5. When the rule is wrong

If following DESIGN.md makes something worse, don't quietly break it. Make
the case to the user. If they agree, change DESIGN.md in the same commit and
write the reason in NOTES.md. Then ship with the `release-checklist` skill.
