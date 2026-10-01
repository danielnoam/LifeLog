---
name: lifelog-ui-audit
description: Audit LifeLog's UI against its design language (DESIGN.md) with measurements, not impressions — WCAG contrast across all four themes, mobile touch targets, CSS drift from the type/space/radius scales and token rules, reduced-motion coverage, focus and labels, and copy voice. Produces a ranked findings list with file:line references. Use when asked to audit, review, polish or "check the design" of LifeLog or one of its screens, to check accessibility, contrast or tap targets, or before shipping a visual change.
---

# Auditing LifeLog's UI

Measure first, then look. Every finding needs a number or a `file:line`, not
"feels cramped". The design language is `DESIGN.md`. The scripts live in
`scripts/` next to this file. Paths below are from the repo root.

## 1. Scope

Ask (or infer) the scope: the whole app, one view (Timeline, Backlog, Notes,
Finance, Habits, Boards, Settings, Recap), or one diff. For a diff, audit
the screens it touches and run the static checks over the whole stylesheet,
but report only what the diff caused or touched.

## 2. Static checks (no browser)

```bash
node .claude/skills/lifelog-ui-audit/scripts/contrast.js
node .claude/skills/lifelog-ui-audit/scripts/lint-css.js --all
```

- **contrast.js** reads every theme's tokens from `src/styles.css` and checks
  the text and UI pairs against WCAG AA. It exits 1 on a failure. If you add
  a token pair that matters, add it to `PAIRS`.
- **lint-css.js** counts literal colors outside the themes, and spacing,
  font sizes and radii off the scales. These are drift counts, not errors.
  Compare against the baseline in DESIGN.md. A diff must not raise them.

Then grep for what the scripts can't see:

- Transitions or animations without a `prefers-reduced-motion` block near
  them: `grep -n "transition\|animation:" src/styles.css` and check each
  new one.
- Icon-only buttons without labels: `el("button", ..., "✎")` and friends in
  `src/*.js` with no `aria-label` / `title` set afterwards.
- `innerHTML` that takes a variable holding user data.
- Toast and error copy against DESIGN.md §8: `grep -ohE 'toast\("[^"]+"' src/*.js`.
  Flag "Failed", "Error:", "!", trailing periods, and a missing next step on
  errors.

## 3. In the running app

`preview_start` with name "lifelog" (it runs `node server.js` on 5173).

1. **Touch targets.** `resize_window` preset mobile (375×812), open each
   view in scope, and run the contents of `scripts/tap-targets.js` through
   `javascript_tool`. It groups everything under 44×44 by class. Open sheets
   (add entry, backlog item, finance entry, settings pages) and run it again
   there.
2. **Themes.** Switch through Default, Light, Nord and Dracula in Settings →
   Appearance, or with `javascript_tool`:
   `document.documentElement.classList.remove("theme-light","theme-nord","theme-dracula"); document.documentElement.classList.add("theme-nord")`.
   Don't overwrite `className`, because `<html>` also carries `native`,
   `force-mobile` and the like. Screenshot the view in each theme. Look for things contrast.js can't catch: a
   hardcoded color that only breaks in one theme, a category chip
   unreadable on Light, a shadow that vanishes on Nord.
3. **Motion.** `resize_window` with `colorScheme` doesn't cover motion, so
   check reduced motion by reading the CSS (step 2) plus one manual pass if
   the user can toggle it at the OS level.
4. **Desktop.** Reset to preset desktop and repeat the screenshots at
   1280px.
5. `read_console_messages` with `onlyErrors`. Errors are findings too.

Always reset the viewport to desktop and `preview_stop` the server when
done.

## 4. Report

Give a ranked list, most harmful first:

1. **Blocks use:** fails contrast on body text or a primary action, a
   target under 32px that's used often, a broken theme.
2. **Accessibility gaps:** AA failures, targets of 32–43px, missing labels,
   no reduced-motion answer.
3. **Consistency drift:** off-scale values, literal colors, a second
   component that duplicates an existing one, off-voice copy.

Each finding gets what's wrong, the measurement, `file:line`, and the fix in
one line. End with the updated baseline numbers (contrast failures, targets
under 44, drift counts). If they've changed, offer to update DESIGN.md's
measured tables (§2 contrast, §4 drift, §9 targets) with today's date.

Don't fix anything during an audit unless asked. When asked to fix, use the
`lifelog-design` skill and ship with `release-checklist`.
