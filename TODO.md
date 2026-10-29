# To do

Only the work that's left. When an item ships it leaves this file in the
same commit and becomes a line in DONE.md (and the changelog); when Daniel
says no, it moves to DROPPED.md with his reason.

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

## Backlog

- **Browse the backlog as covers (asked 2026-10-29).** Daniel wants a
  view to look through the backlog like a library, with the filters he
  already has (category chips, the Show row, search), and wasn't sure
  between swipeable cards and a grid.
  Recommendation: build the grid first, and do the swipe inside the card
  you open from it, not as a screen of its own.
  - Why grid: it's the one that shows something the List can't, the whole
    shelf at a glance, and it reuses what's there (the Out today sheet's
    `.out-grid`/`.out-tile` 2:3 cover wall, `coverEl`/`emptyCoverEl` with
    the category-tinted block for items without art, getFilteredBacklog).
  - Why not a swipe deck as the view: a sideways swipe on #content already
    switches List / Next releases / Discover (attachSwipe, modeSwipe in
    app.js), so a deck there fights the same gesture, the reason row
    swipes were dropped (DROPPED.md, Swipe actions on rows). A deck also
    shows one title at a time, which is what Pick random already does;
    for a backlog of hundreds, browsing one by one is slower than a list.
  - Plan, grid: a List/Covers icon toggle in the mode bar beside the sort
    (List mode only), kept per device in `state.visual.backlogLayout`.
    Same category sections and headers as the List, the same sort and
    bands (Unreleased / Early Access / Dropped tiles dimmed or folded the
    way the bands fold), tiles 3 across on a phone (44px is easily met),
    auto-fill on desktop. Small corner marks on the tile for starred,
    bought and price alert, title under the cover. Tap opens the item's
    sheet, hold selects (bulk mode works the same as rows). Images lazy;
    measure the first draw with a few hundred items against the List.
  - Plan, swipe: tapping a tile opens a read-only card (the Pick random
    card's layout: big cover, title, category, links, Open / Start / Done)
    and a sideways swipe inside that sheet steps to the next or previous
    title in the grid's order. Inside a sheet the swipe doesn't compete
    with the mode switch, and it gives the "swipe around" feel without a
    second view. The same card could later let Pick random swipe to the
    next draw instead of pressing Reroll.
  - Check before building: Steam/SteamGridDB game art can be landscape;
    see how it crops into 2:3 and fall back to the tinted block with the
    title over it if it looks bad. Every theme, phone and desktop width.
  - Bridge: shows the same items as `lifelog_backlog`, so no new data or
    tool; the layout is a device setting, not data.

## iOS

- **Upcoming and In progress widgets.** Android got them in 0.277.0; the
  rows are already in the snapshot (`upcoming`, `inProgress`, see
  widgets.js backlogRows). Plan: two timeline providers in
  LifeLogWidgets.swift drawing the same rows, counting down from the
  phone's date like the Android ones (BacklogWidgets.java), opening
  `open-upcoming` / `open-timeline`.
- **Background refresh.** Android got it in 0.279.0 (the app run with no
  screen by a periodic job, see headless.js and HeadlessRefresh.java).
  Plan: a BGAppRefreshTask in the iOS app that opens the same invisible
  WKWebView on the bundle at the app's origin (`capacitor://localhost`)
  with a WKScriptMessageHandler in place of the Java object, then
  reschedules itself; iOS decides whether and when it runs, so the setting
  should say so.
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
