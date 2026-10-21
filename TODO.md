# To do

Only the work that's left. When an item ships it leaves this file in the
same commit and becomes a line in DONE.md (and the changelog); when Daniel
says no, it moves to DROPPED.md with his reason.

## Next

From the sweep of 2026-10-21 (every tab and mode, the sheets and every
Settings page, at 375px and 1280px, in Default, Light, Nord and Dracula;
contrast.js and lint-css.js clean, no console errors, nothing wider than
the viewport). Fixes only; Daniel says when to build.

- **The top bar on a computer shows the mode lines under the tabs.** The
  dots under a tab that has modes (`.tab-modes`, the current one a pill)
  are built on every layout by `updateTabModeDots()` but shown only by the
  phone layout (styles.css: `.tab-modes { display: none }` near line 487,
  switched on at the two phone blocks near lines 2655 and 2792). Plan:
  show the row on desktop too, inside the pill tab — give `.tab` a little
  more bottom padding (8px 14px 11px) and sit the dots at `bottom: 4px` so
  they read as part of the pill rather than a line under it; they take
  `currentColor`, so on the active (accent-filled) tab they're
  `--text-on-accent` and faint elsewhere. Check `.tab-menu`'s `top: 100%`
  still abuts the tab, `--topbar-h` is re-measured (the tabs get taller),
  and all four themes at 1280px.
- **The tab menus on a computer blink and close while the pointer moves
  along the bar.** Reproduced with a script against the current code (the
  0.264.2 fix holds for a pointer crossing the bar top to bottom; this is
  sideways). Two causes: (1) with one menu open, entering the next tab
  calls `closeTabMenu()` then builds a fresh menu that starts at
  `opacity: 0; translateY(-4px)` and fades in over .12s — so every tab the
  pointer crosses is a blink off and on, where a menubar slides one menu
  along; (2) the tabs sit 4px apart (`.views { gap: 4px }`) and the
  pointer lands on the nav in the gap: `pointerleave` arms the 160ms
  close, so a pointer that pauses in the gap, or crosses the tabs' bottom
  edge on the way to a menu, closes the menu, and re-entering a tab opens
  it again only after the 200ms first-open delay — on, off, on. Plan: one
  menu element moved and refilled on a swap, with the fade only on the
  first open; hover handled on `#viewTabs` (`pointerover` →
  `closest(".tab")`) rather than per tab, closing only when the pointer
  leaves the nav (the menu is inside the tab, so that covers it), so the
  gap no longer counts as leaving; keep `TAB_MENU_DELAY`. Add to
  test/browser/tabmenu.js: crossing three tabs with a menu open adds one
  `.tab-menu`, not three, and jittering across the gap never closes it.
  What couldn't be checked here is Daniel's exact pointer path and screen
  scaling; if it still flickers after this, the next suspect is Windows'
  pointer events on a 125% display, where `pointerenter`/`leave` can fire
  on a subpixel edge.
- **The edit sheets' buttons don't fit on a phone.** Delete · More… ·
  Cancel · Save in the entry, backlog and recurring-expense sheets run
  31px past the modal at 375px (Save's right edge at 361px in a modal
  that ends at 355; 21px clipped at 360px). Plan: on phones let
  `.modal-actions` wrap (`flex-wrap: wrap`, the `.spacer` taking a full
  row so Cancel/Save go to a second line right-aligned), or fold Delete
  into the More… menu below 400px. Measure at 360 and 375 after.
- **The recurring-expense sheet's date fields are cut off at 375px.**
  Start date and Stops on sit in two 137px columns; Chrome's date field
  shows "01/01/202" and "mm/dd/yyy". Plan: one field per row on phones
  for that pair (the `.row` pair in index.html:738 → one column under 720px), or
  `min-width: 150px` on `input[type=date]` with the pair allowed to wrap.
- **Amount and Currency are cut off in the expense sheets.** Amount's
  placeholder "e.g. 12.50 or 50-25" and the currency's "ILS · ₪ (yours)"
  are both clipped at 375px, and the currency is clipped at 1280px too
  (finance.js:1610 adds " (yours)" to the home currency's label in a
  119px select). Plan: shorter placeholder ("12.50 or 50-25"), and the
  home currency marked with a ★ or listed first instead of a suffix.
- **A backlog row's length wraps inside itself.** "30 h" breaks between
  the number and the unit when it ends the meta line (Hades II at both
  widths: "★ 4.2 · 2021 · 30" then "h · Season complete · more coming").
  Plan: a non-breaking space in the length where the meta line is built
  (backlog.js ~108) or `white-space: nowrap` on each part.
- **The search box's placeholder is cut off on a phone when the View
  button shows.** "Search everythi" — 117px of room for 145px of text on
  the tabs that have View options. Plan: on the phone layout the
  placeholder is "Search…" (set in the layout switch in app.js, or via
  `--search-placeholder` read by the input's wiring), full text on a
  computer.
- **An avoided habit's button says the count twice.** "0/1  0 of 1"
  (habits.js slipButton: the mark shows n/limit and the label n of limit).
  Plan: the mark shows the check or the count, the label says Kept, and
  "0 of 1 slips" lives in the title.
- **Note cards print Markdown punctuation.** The feed card shows the
  source ("# Heading", "**Markdown**", "[link](url)") while a collection's
  cards use `plainPreview` and the reader draws it (notes.js:412 vs
  ~1047). Plan: draw the card's text through LifeLogMarkdown with the
  reader's sanitizer and links turned into plain text (a tap on the card
  must still open the note), falling back to `plainPreview` when the
  Markdown is just a line. Check what test/browser/notekinds.js and
  collections.js read from `.note-text`.
- **A list note is "Untitled" in search results but "Untitled list" in
  the feed.** Plan: search.js names a list through the same helper the
  card uses.

## Decisions waiting on Daniel

From the security pass (audits/2026-10-09-security-pass.md in the project
folder). Each changes how data is stored, so each is his call first.

- **Optional encryption of the data file before it is committed.** Daniel
  leans no; mandatory encryption is in DROPPED.md (Data encryption).
  Plan if yes (the audit's item 6): the whole file encrypted with a random
  data key (AES-GCM, Web Crypto), that key wrapped by a PBKDF2 key from a
  passphrase, with a printed recovery key; History decrypts GitHub's saves
  in-app, and the bridge needs the passphrase to read. Cost: a forgotten
  passphrase and lost recovery key is the data gone, and the file mirror
  and GitHub's diffs become ciphertext.
- **Encrypting this device's copy (IndexedDB) with a key from the PIN.**
  Mainly for the desktop browser. Plan if yes: derive a key from the app
  lock PIN (PBKDF2, needs a 6+ digit PIN), encrypt the stored copy, decrypt
  after unlock. Cost: a forgotten PIN means re-syncing from GitHub, and
  launch waits for the unlock before drawing.

## iOS

- **A tapped notification opens the right place.** On iPhone a habit
  reminder, a charge heads-up or a release-day notification only opens the
  app; Android goes to the habit, the Ledger or Upcoming. Plan: a
  UNUserNotificationCenterDelegate in the app (tools/ios-project.js adds
  it to the AppDelegate) that leaves `userInfo.action` where
  `takeLaunchAction` reads it, the way the share extension does.
- **An Apple developer account ($99/year)**, if the iOS app is ever used
  for real. Plan: sign in CI with the account's certificate and profile,
  upload to TestFlight from ios.yml, drop the AltStore/SideStore 7-day
  re-signing. Everything else for iOS is built (0.216.0 the app, 0.217.0
  widgets, reminders and Face ID).
