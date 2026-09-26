# Notes

Why things in LifeLog are the way they are: the reasoning behind decisions
that are already shipped, kept because the code can say *what* it does but
rarely *what else was tried*. This is the file to read before changing
something that looks arbitrary — usually it isn't, and the entry says so.

Newest first. It used to be the `done:` half of TODO.md, which had grown to
forty times the length of the actual to-do list. Entries near the bottom are
terse one-liners because they started life as to-do items and were struck
through when finished; the longer ones further up are notes written to be
read again.

Two neighbours: **TODO.md** is work still worth doing, and **DROPPED.md** is
what was decided against and why.

---

- **Note kinds are a field on a note, not three collections (0.195.0).**
  `kind` is absent for a plain note — every note from before — and "list"
  or "quote" otherwise, so nothing had to be migrated and an older APK
  still reads every note as text (keepUnknown carries the rest through).
  A list's `text` is its title and `items` its checklist, each item with an
  id: merge.js's mergeNotes merges a list both sides still have item by
  item (the habits-marks / board-elements pattern), or a phone and a laptop
  ticking different items would lose one. Ticking isn't editing — editedAt
  moves only when what the note says changes, and filing it under a
  category doesn't count either.
  - *Categories* are a fourth list, `noteCategories`, with the to-do list's
    rules (no fallback; deleting leaves notes uncategorised) and its own
    modal rather than a shared one — the to-do modal goes away with the To-do
    mode in stage 3 (see TODO.md).
  - *Sort* is `settings.noteSort`; unset, it falls back to timelineSort,
    which is what Notes followed before — so an upgrade moves nothing.
    "Recently edited" files a note under its editedAt month. There's no
    A–Z: most notes have no title to sort by.
  - This is stage 1 of three. Stage 2 turns the To-do mode's lists into
    list notes (one per to-do category); stage 3 moves the widget, quick-add
    and Recap over and removes the To-do mode.

- **Boards round two, and what boards really weigh (0.194.0).**
  - *Measured sizes*, replacing the TODO's estimates: 1,000 synthetic
    handwriting strokes (0.3–1s at 60Hz, letter-sized) kept 24% of their
    samples and stored in **108KB** — 110 bytes a stroke, 20KB gzipped,
    which is roughly what a commit adds. A 50-element diagram is **5KB**.
    The estimates were 300KB and 10KB; the delta encoding does better than
    they assumed. `node tools/measure-boards.js` re-runs it.
  - *Rotation* is an angle `a` only on rect, ellipse and text, turned about
    their own centre; lines and strokes have their points turned instead,
    so they stay plain. Bounds and hit tests take the angle into account.
    Resizing a turned shape scales it in its own axes — exact when upright,
    close when turned, the same trade Excalidraw makes for groups.
  - *Resize handles* sit 8px outside the selection but scale by its own
    corners, so the edge follows the finger exactly; the first cut scaled
    the padded box and a 100px drag grew a shape 93px.
  - *Fill* is rough.js hachure, rendered from placeholder colours ("S", "F")
    swapped at draw time, so a recolour or theme change reuses the paths.
  - *Virgil* (SIL OFL 1.1, licence in src/vendor) replaces the system font
    on boards. Exports embed it as base64 because an SVG — and the PNG
    drawn from one — can't reach the app's copy.
  - *History* is a third IndexedDB store (boardsHistory, IDB version 3),
    capped at 30, skipping a save identical to the last by a fingerprint in
    localStorage rather than reading the last snapshot back. GitHub's side
    is the commits to boards.json. Bringing back restores one board, never
    the whole file. Deleting a board flushes first, or a board drawn and
    deleted inside the 2.5s save delay had no version to come back to.
  - *The boards file* is a second File System Access handle: a page can't
    create a file beside the one it was given. Read on load only when this
    device has no boards of its own yet.
- **Restore settings from a backup (0.194.0)** is `settingsFromBackup`
  beside fillBlankSettings: it also changes what's set, since asking for it
  is the point, but a blank in the file never clears a value — a backup
  from before a key existed mustn't take the key away.

- **Boards are SVG, in their own file, merged per element (0.193.0).**
  - *Own file:* boards.json sits beside lifelog.json with its own sha and
    merge base (Storage.boards), both in IndexedDB — localStorage's 5MB
    would fill with a few handwritten boards. Unlike lifelog.json, a merge
    after a 409 is adopted straight away (boards.js swaps it in, merging
    anything drawn while the save was out), so the sha and base move to it.
    Saves wait 2.5s after the last change so a burst of strokes is one
    commit; closing the board, leaving the app or hiding it sends at once.
  - *Merge:* `mergeBoards` decides which boards survive on the whole board
    (so one deleted here but drawn on there comes back), then merges a
    surviving board's elements with `mergeCollection`. Elements carry no
    updatedAt; the rare element both sides changed goes to this device.
  - *SVG, not canvas:* export is the DOM serialised, text stays text, and a
    board of a few thousand paths redraws fast enough. rough.js (vendored,
    MIT, 28KB) draws the shapes, seeded per element so they don't wobble
    between redraws; freehand strokes are our own quadratic path through
    the samples' midpoints, simplified on pointerup (Ramer–Douglas–Peucker,
    0.8px on screen) and stored as integer deltas — about a quarter of the
    raw size, which is what the TODO's size estimates assumed.
  - *The editor is a .modal-overlay,* so the scroll lock, Escape and
    Android's back, pull to refresh and the one-key shortcuts all treat it
    as open without knowing about it. Boards.handleKey takes every key while
    it's up.
  - *A fourth mode* broke "a tab opens on its middle mode": landingMode now
    uses the chosen default, then DEFAULT_LANDING (Notes still opens on
    Notes), then the first.
  - *Not there yet:* History and the local-file backup cover lifelog.json
    only, and elements can't be resized — see TODO.md.

- **The everything CSV is the tab sheets stacked, not one merged sheet
  (0.192.0).** One set of columns for every kind would have meant a second
  CSV format to read and write, next to the per-tab ones. Stacking reuses
  them: `allCsvText` joins the Notes, Timeline+Backlog and Ledger sheets,
  and `parseAllCsv` starts a new block at every row whose first cell is
  "Kind" and hands each block to the parser whose header it has. The price
  is that in a spreadsheet the columns change meaning at each header row.
  It relies on the tab sheets' kinds never overlapping and on each parser
  skipping rows that aren't its own — the Ledger's didn't until this change.

- **Import & export is per tab, with one importer underneath (0.191.0).**
  `TAB_KINDS` in io.js says which kinds a tab owns; a tab's export writes all
  of them and a tab's import passes them to `buildImportItems(incoming,
  kinds)`, which ignores the rest of the file. That's why any LifeLog file
  works in any tab's import, and why the old Journal/Finance buttons could go
  without breaking their files. Notes, to-dos and habits have no fill-in
  update path (IMPORT_FILLABLE): they match on their words or name, or on id,
  and a match is simply "already added". Projects and to-do categories ride
  the new-categories list with a `scope`, like journal and finance
  categories. CSV is one sheet per tab with a Kind column; a habit's history
  fits in one cell ("2026-01-05*2 2026-01-07"). The Ledger CSV stays in
  finance.js because it shares a parser with the Sheets pivot import.
  Settings (the `settings` key) are exported in the full backup but never
  imported: they're this device's preferences, not data.

- **In the Android app the page scrollbar is ours (0.190.2).** The
  WebView's own is drawn by Android's View, over the whole WebView, and no
  CSS reaches it: not the `body::-webkit-scrollbar` inset from 0.190.1, not
  the `(pointer: fine)` styles. `WidgetsPlugin.load()` turns it off
  (`setVerticalScrollBarEnabled(false)`) and `wireScrollThumb()` draws a
  fixed thumb inside `--topbar-h` / `--bottombar-h`. Sheets and other inner
  scrollers keep Blink's overlay bars, which that call doesn't touch.
  On a computer the scrollbar's strip sits beside the bars rather than under
  them, so `body::-webkit-scrollbar` paints its two ends as the bars (1px
  border included); without it they looked 12px short of the window.

- **The page scrollbar is inset by the bars, styled through `body` (0.190.1).**
  The app scrolls as the document, so the window's scrollbar spans the full
  height behind the sticky `.topbar` and the fixed mobile `#topbarBottom`.
  `body::-webkit-scrollbar-track` takes a top/bottom margin of `--topbar-h`
  / `--bottombar-h` (both measured live in app.js). It has to be `body`:
  Chromium reads the viewport scrollbar's style from the body, and
  `html::`/`:root::` rules for it are silently ignored. Making `#content` its
  own scroll container would have fixed Firefox too, but every sticky header,
  the mode pager and all the `window.scrollY` bookkeeping assume document
  scroll — not worth that for a scrollbar.

- **Small widgets pick their own layout by size (0.189.0).** Read from the
  widget's options (portrait's width and height) on every draw and redrawn
  in onAppWidgetOptionsChanged, on every Android version, rather than
  Android 12's size-keyed RemoteViews. That map would let the launcher pick,
  but the to-do list keeps its scroll through partial updates, and a
  partial update can't aim at one size of a map. So the to-do widget's
  partial updates are built per widget, each in the layout that widget has,
  and the compact layout keeps the header's views hidden rather than
  dropping them. The thresholds are pure functions in each provider
  (compact, chipGrid, chipDetail, iconsOnly, detail) and are tested in
  WidgetLogicTest; what they look like on a real launcher still has to be
  checked on a phone. The compact habits grid gives up per-habit "open"
  (a chip is the tick's target, all of it) — opening is the space around.

- **Tab and mode order, and where a tab opens (0.188.0).** Two orders and
  a default per tab, all device-local like turning tabs off, all read
  through app.js's enabledViews/modeEntries/landingMode so every consumer
  (bar, swipes, dots, fan, number keys, Settings) agrees without knowing.
  A saved order is merged against what exists: unknown ids dropped, new ones
  appended, so a mode added later can't be lost to an old preference. The
  three-mode rule — open on the middle — came from wanting the other two a
  swipe either side of where you land. It makes "default" and "order" one
  thing for those tabs, so the ★ moves a mode to the middle rather than
  being a second setting that could contradict the order. The out-of-the-box
  orders put Notes and Entries in the middle so nothing opens differently
  on update. Number keys follow the bar's order now rather than being fixed
  to views: "on-screen order" was always the stated rule, and reordering
  made the fixed map stop meaning that. jumpSectionSelector asks for the
  view's first *defined* mode (the list with year headers), not the first in
  your order.

- **Settings rows (0.187.0).** Inside a page the list's cards carry on:
  `.sitem` is a row (label left, control right), `.sitem-stack` puts a text
  field under its label, `.sitem-go` is an action with a chevron. Actions
  that other code relabels ("Checking… 3/12", "Change PIN") are plain-text
  buttons with the chevron drawn by CSS, so setting textContent can't break
  them. Search reads `.sitem-title`, so a new row is findable if it has one.
  Checkboxes that are on/off settings are `.switch`; the app's own checkbox
  styling stays for picking items from a list.

- **Settings is a list, and a view's options live on the view (0.186.0).**
  Seven tabs scrolled sideways on a phone and gave each page equal weight,
  which is why two reshuffles of their contents didn't help. The list is
  the pattern Android's own Settings, Daylio and Obsidian use, and each row
  carries a status line so the list is useful before anything is opened.
  What changes how one tab looks (cover size, breakdowns, folding, month
  widths) went to that tab's View button, the way reminders moved onto the
  habit cards in 0.184.0: an option next to its effect is found without
  looking for it. Currency went with the Ledger even though it syncs — it's
  where it shows. Search reads headings, labels, buttons and menu choices
  off the pages themselves, never a hand-kept list, so a new control is
  findable the day it's added; hints are left out because they'd match
  everything. The how-to for connecting GitHub hides once connected rather
  than being deleted: it's still the first thing a new device needs. Every
  control id stayed the same, so no handler moved. One pane or two follows
  the same rule as the rest of the app's mobile layout (720px, or Appearance
  → Layout), read through isMobileLayout rather than restated.

- **undo is a merge with the save as the ancestor (0.185.0).** The toast's
  Undo lasts eight seconds; the one for the next morning lives in History.
  Restore already existed and is the wrong tool for "take that back": it
  rolls everything back to a save, taking every later change with it. Undo
  runs mergeAllSources(after, today, before) — the save as the common
  ancestor, today as one side, the save before it as the other — so exactly
  the difference between the two saves is reversed onto today and nothing
  else moves. No new machinery: an item edited again since is "changed on
  both sides", and the merge's existing rule keeps the later edit; habit
  marks go through mergeHabits like any sync. merge.test.js pins the five
  cases. The before-state is simply the next older entry in the list, local
  snapshot or GitHub commit, which is why the oldest listed has no Undo.

- **GitHub's sha is taken only when its data is (0.185.0).** checkRemote used
  to adopt the new sha the moment it saw one, and the poll then sometimes
  backed off before merging — a save in flight, a form just opened. That
  left the device holding GitHub's sha without GitHub's data, so its next
  save matched the sha, got no 409, and wrote the other device's changes
  away. checkRemote now only reports the sha; the poll takes it with
  acceptRemote at the moment it adopts the merge. Boot's reconcile reads
  through load(), which moves the sha and the merge ancestor as it goes, so
  when it has to back off it puts both back (syncPoint / restoreSyncPoint).
  savecoalesce.js section 7 stages it — the change found, a form opened
  mid-read — and loses the note on the old code.

- **widgets, second round (0.185.0).** The spend widget draws strings the
  app formats (widgetSpend in app.js: the currency and recurring charges
  live there), and counts what left the account — projects included, the
  Ledger's question rather than the summary's — against last month up to
  the same day, since a whole month against part of one always looks
  thrifty. When the month has turned over since the app last ran it says so
  instead of showing the old total. From Android 12 the to-do list is filled
  with RemoteCollectionItems in the update itself, with ids that stay put
  (a to-do's is its own, a heading's is its panel's) so a partial update
  hands the rows to the list's existing adapter and the scroll holds; the
  service stays for 11 and below, and both draw with ListService.rowView.
  Picker previews are static layouts (previewLayout, Android 12+).

- **reminders are set on the habit cards, not in Settings (0.184.0).**
  0.183.0 put the switch, the permission state and every habit's time in
  Settings → Views. A reminder is a property of one habit, and Settings is
  somewhere you go on purpose, so it moved to where the habit already is: a
  bell chip on each card (a time input lying invisibly over it, so the tap
  opens Android's own picker; ✕ clears), and one line above the cards once
  any is set — the count, Pause/Resume for all, and Android blocking them if
  it is. reminders.js draws both (chip, bar) and habits.js only places them,
  so the page has one owner of reminder UI. The edit form keeps its field.

- **the app lock's fingerprint is Android's own sheet in the app, WebAuthn in a
  browser (0.184.0).** The lock was built on WebAuthn, and the app's WebView
  doesn't offer it: newer WebViews can, but only to a site that proves it
  belongs to the app, and the app's pages come from https://localhost. So
  the app always said "not available". The plugin now wraps the framework's
  BiometricPrompt (Biometrics.java) — not androidx.biometric, to add no
  dependency, which is why it needs Android 10 (BiometricManager). There is
  no credential to store: Android holds the fingerprints, so the setting is
  just "android-biometric", written once a check succeeds. It stays what
  the WebAuthn version was: a faster way past the PIN, never instead of it,
  guarding the app's opening rather than encrypting anything. The plugin
  always resolves { ok, reason } rather than rejecting, and "cancelled"
  (backing out, or "Use PIN") shows no error.

  Its first build failed in CI on BiometricPrompt.BIOMETRIC_ERROR_NEGATIVE_BUTTON,
  which compiled here: the local check compiles against Robolectric's
  android-all, the real framework — hidden members and all. It proves an API
  exists, not that it's public. CI's compile, against the SDK's android.jar,
  is the one that answers that; the constant only exists in androidx.

- **the habits widget is plain rows, not a list (0.184.0).** A habit row
  needs two taps: the tick, which must stay on the home screen, and the row,
  which opens the app on that habit. Every row of a list widget sends its
  taps through one shared PendingIntent template, so both would have to be a
  broadcast — and whether a broadcast receiver may then start an activity
  depends on background-launch rules that have tightened with each Android
  (14 made the sender opt in), which can't be checked from here. Plain
  views each get their own PendingIntent: a broadcast for the tick (with a
  per-habit data URI, or every row would share the first one's), an activity
  for the row. The price is scrolling, so rows are fitted to the widget's
  reported height (OPTION_APPWIDGET_MAX_HEIGHT, redrawn on resize) with a
  "+N more" line. The to-do widget keeps its list: it scrolls through many
  more items, and its rows only ever need the one tap.

- **habit reminders are one alarm, and it decides when it rings (0.183.0).**
  The plan in TODO was @capacitor/local-notifications. It would schedule
  fine, but a notification it has scheduled goes off whether or not the
  habit has been kept since — and a tick on the widget, or one synced from
  the desktop, would each have had to reach in and cancel it. Instead the
  times ride out in the widgets' snapshot (reminders.js → widgets.js), and
  the plugin keeps a single inexact alarm for the next one. When it goes
  off, it looks at the latest snapshot and the widget's queue and rings for
  what is due today, past its time and still not kept — decided at that
  moment, so anything kept anywhere that has reached the phone stays quiet.
  One alarm, rescheduled on every snapshot and on boot, update and clock
  changes, means there is nothing to keep in step. The window is "since the
  last check": a snapshot from the app resets it, so nothing earlier today
  rings late, while after a reboot a missed one still comes through.

  Times are per phone, in localStorage, not in the habit: a desktop can't
  buzz, and two phones can want different times. The permission is asked
  when the first time is set. Before Android 13 there is nothing to ask,
  only the app's switch in Android's settings, which is what "granted" means
  there. The notification's Done fills the habit to its target through the
  widget's queue, the same road a widget tick takes.

  The widget's streak is the app's: the snapshot carries runBefore (kept due
  days ending the day before its own today — streakOf minus today, which
  habits.test.js pins as an identity), and the Java walks the days since
  from the week of marks plus its own ticks, then adds today if it's kept.
  So it stays right on the morning after, before the app has run.

  Those parts are Java that runs with the app closed, so they are tested
  where they run: WidgetLogicTest, JUnit in the plugin, run by CI before
  every APK (`gradlew :lifelog-widgets:testDebugUnitTest`). That meant
  WidgetStore's row logic could call nothing from android.* — unit tests get
  a framework of stubs that throw — so parseColor is plain Java now.

- **a widget list keeps its place, and its checkboxes animate themselves
  (0.182.0).** 0.181.0 redrew a widget whole on every change —
  updateAppWidget with a fresh RemoteViews — and a whole redraw hands the
  ListView a new adapter, which puts it back at the top. So a tick three
  categories down lost your place, and the app's snapshot on every save
  (and on leaving the app) did the same. Now only onUpdate — placed,
  rebooted, app updated — draws whole; everything else is
  partiallyUpdateAppWidget for the header plus
  notifyAppWidgetViewDataChanged for the list, which keeps the scroll.

  A widget can't run the app's animations: RemoteViews has no layout
  transitions, and the list redraws rows rather than moving them. What
  Android 12 added is a real CheckBox in a widget, and a CheckBox animates
  its own tick on the home screen before anything reaches us
  (setOnCheckedChangeResponse, with RemoteViews.EXTRA_CHECKED saying which
  way it went — the queue takes that rather than flipping, so it can't
  disagree with the box). The row then waits SETTLE_MS (goAsync, so the
  broadcast lives that long) before the list moves it under the done line:
  the same "let the tick land, then move" the app's reconcile animation
  does, minus the slide. (The wait went in 0.183.0: it read as lag.) It's
  a separate layout, widget_row_check, used only
  behind SDK_INT >= S; nativebuild.test.js holds both halves of that rule.

  Finished to-dos travel in the snapshot now, newest first and capped per
  panel (DONE_PER_PANEL), with doneCount carrying the real total for the
  "N done" line. The row logic is a pure todoRows(snapshot, queue), run on
  the JVM against the real org.json before it shipped.

- **widgets are a local plugin that draws from a snapshot and hands back a
  queue (0.181.0).** Widgets are native (AppWidgetProvider + RemoteViews)
  and android/ is generated in CI, so their code lives in native/widgets/,
  a Capacitor plugin linked as a `file:` dependency — Capacitor finds it,
  links the module and registers WidgetsPlugin like any other. Java, not
  Kotlin: the generated project already builds Java, and a Kotlin plugin
  would bring its own Gradle plugin into the build.

  A widget can't run the web app, so neither direction goes through it.
  The app sends a snapshot (src/widgets.js snapshotOf) on every data
  change; a tick on a widget is queued natively, shown at once by
  overlaying the queue on the snapshot, and applied by the app the next
  time it runs (applyQueue), where it saves and syncs like any tick. The
  queue keeps one entry per thing ticked, the latest, so tick-untick is one
  entry. Habit ticks carry the value the widget showed next, not "a tap":
  replaying taps against data another device changed in between would land
  somewhere nobody chose.

  Due-today is worked out in Java from each habit's days and start date,
  not taken from the snapshot, so the habits widget turns over at midnight
  (updatePeriodMillis, every half hour) without the app. That is why the
  snapshot carries a week of marks rather than today's: a midnight the app
  never saw still has the right day's mark to hand.

  Checked without a phone, three ways. The Java is compiled against
  Robolectric's android-all (the real framework, from Maven Central — the
  SDK's own host is blocked here) with stubs for Capacitor's classes, which
  is how the org.json trap was found: optString turns a JSON null into
  "null", which sorts after every date, so a habit with no start date would
  have silently never been due. nativebuild.test.js checks what only a home
  screen would otherwise find out: every layout uses views RemoteViews can
  inflate (anything else is "Can't load widget"), every id and resource the
  Java names exists, dark mode redefines every colour, and every action a
  button sends is one runAction handles. browser/native.js drives the app's
  side against a fake plugin.

- **a stale sha is merged, not overwritten — and the merge's sha isn't
  taken as seen (0.180.0).** A 409 means another device saved since this
  one read. ghSave used to answer it by writing this copy over theirs,
  on the theory that the next poll would reconcile. It couldn't: their new
  items were gone from GitHub, and on their next poll base had them, remote
  didn't and local hadn't changed them — a deletion, by the merge's own
  rules — so they were deleted there too. Now this copy is three-way merged
  onto GitHub's (sync base as ancestor) and that is written.

  The easy version of this takes the merge's sha as its own, and
  savecoalesce.js section 6 shows why that loses the same items one save
  later: state.data still lacks them, so the next save — against a sha that
  now matches — writes them away without a 409 to stop it. Instead neither
  gh.sha nor the sync base moves to the merge. The poll the save kicks off
  sees GitHub changed and brings the items in through its usual merge,
  guards and all (it won't swap data under an open form). And any save before that
  poll lands comes back 409 and merges again. Adopting the merge directly
  in flushSave was the alternative, and was turned down for the reason the
  poll has that guard: an open modal holds references to items that
  replacing state.data would detach. resolveConflict passes merge: false,
  because there the user explicitly chose which version wins.

- **saves are coalesced: an edit is kept at once, and GitHub hears about a
  burst of them once (0.180.0).** Every persist() used to be its own PUT,
  so its own commit, and nothing serialised them: ten quick habit ticks
  were ten PUTs against the same sha, most came back 409 and were retried,
  and with a slow connection the last to land could be an older copy
  (savecoalesce.js reproduces this on 0.179.1: GitHub ended on "ONE" when
  the screen said "ONETWO"). The fix splits persist() in two. The cheap,
  synchronous half — stamp updatedAt, write the cache — happens on every
  edit, so a reload or a crash never loses one. The network half waits for
  1.5s without edits (8s at most), then sends one snapshot; one save is in
  flight at a time, and edits made during it go in the next.

  persist() now resolves when the edit is kept on this device, not when
  GitHub has it. Every caller only toasts or re-renders after it, so none
  needed more — and their toasts stopped waiting on the network. Going to
  the background (visibilitychange, pagehide) sends a queued save straight
  away. If the app dies before that, nothing special is needed: the cache's
  exportedAt is newer than GitHub's, so the next launch merges and pushes it
  like an offline edit.

  Two rules make it safe to leave the poll alone. The stamping snapshot
  (lastPersistedSnapshot) moves with each persist(), not each save, so a
  queued edit is already stamped in state.data and a poll's merge keeps it.
  And a poll that finds a remote change while an edit is queued merges
  rather than backing off, because checkRemote() has already moved the sha
  on and the queued save would otherwise replace GitHub's copy unseen.

- **the app updates itself and exports through the share sheet — with plain
  plugin calls, no bundler.** Both are the same problem: a file has to leave
  the WebView. A download link can't do it (the WebView ignores them, which
  meant every export had silently done nothing), and a browser tab for an
  update is a detour through the Downloads folder.
  - **Exports:** the file is written to the app's cache (Filesystem), then
    handed to Android's share sheet (Share). All of them go through
    `IO.download`, so that is the one place that knows. Closing the sheet is
    a choice, not an error.
  - **Updates:** the release's APK is downloaded into the cache with
    progress (Filesystem.downloadFile), then opened with Android's installer
    (capawesome's FileOpener, through the app's existing FileProvider, whose
    cache path the template already declares). The manifest needs
    `REQUEST_INSTALL_PACKAGES` or Android refuses the hand-off. Android still
    asks, on its own screen, for each install and once for permission. The
    download targets the specific tag, not `latest`, so a release published
    mid-download can't swap the file under it. A dismissed installer can be
    reopened from the same file, and old APKs are cleared on launch.

  `Filesystem.downloadFile` is deprecated in favour of
  `@capacitor/file-transfer`, and deliberately used anyway: file-transfer's
  JavaScript layer installs a helper (`CapacitorUtils.Synapse`) when it's
  imported, and LifeLog has no build step to import it. Every plugin here is
  called through `Capacitor.Plugins.X`, which is what a plain-script app
  gets. Revisit if downloadFile is ever removed.

  The first update this can do is the one *after* 0.179.0: the app that
  receives 0.179.0 doesn't have the downloader yet, so the bar falls back to
  Chrome's tab when the plugins aren't there.

- **the Android app runs edge to edge, and the app's copy of index.html is
  what says so.** Matching the status bar to LifeLog's theme means drawing
  the page under it: `viewport-fit=cover`, with the top bar's colour filling
  the space and the icons set by `syncSystemBars` from the top bar's actual
  background (a new theme can't be forgotten there). Capacitor's SystemBars
  reads the viewport tag *once*, when the first frame becomes visible
  (`onPageCommitVisible`). Setting it from a script would race that, so
  tools/build-www.js writes `viewport-fit=cover` and `class="native"` into
  the app's copy of index.html instead. The web copy keeps neither, because
  a browser has bars of its own.

  Two things quietly depended on the viewport tag staying put.
  `applyForceLayout` rewrote it wholesale and would have dropped
  `viewport-fit`, pulling the page out from under the status bar while the
  top bar kept the padding meant for it. It now keeps whatever `viewport-fit`
  it found.

  The top bar grows a *border* in its own colour rather than more padding,
  so nothing inside it moves and the measured `--topbar-h` includes the lot.
  Sizes come from Capacitor's injected `--safe-area-inset-*`, with `env()`
  as the fallback.

  **A `let` declared beside the function that reads it can still crash at
  load.** `syncSystemBars` compared against `systemBarsStyle`, declared
  just above it, but `applyTheme` — which calls it — runs at load, hundreds
  of lines earlier. In a browser the function returned before reaching the
  variable, since there's no SystemBars plugin, so nothing noticed. In the app
  it was a ReferenceError that stopped the whole app starting. Only the
  faked-bridge suite could see it.

  **Outside links are routed explicitly.** Capacitor most likely hands
  outside URLs to the system browser already, but a link that did load
  inside the app would strand you: no address bar, and back would put the
  app away. So outside `<a>` clicks and `window.open` are routed by hand,
  and back returns when the page has somewhere to go back to. 0.178.0
  routed them to the Browser plugin — Chrome's in-app tab — and that was
  the wrong call: it opens over the app, so it reads as being *inside*
  LifeLog. The point was to leave, so 0.179.1 hands them to Android with
  AppLauncher (a plain view intent), which opens the phone's own browser as
  its own app.

- **the mode swipe is a pager built from snapshots, not two live renders.**
  A pager needs the neighbouring mode on screen while the finger is down, and
  `render()` can't draw it: it owns the whole page (the tab bar, the filter
  chips, the scroll position, the lazy sections and their observers), so a
  second mode can't be rendered beside the first without the two fighting
  over all of that. So the neighbour is a *picture*: a copy of `#content`
  taken the last time you swiped away from that mode, drawn in a fixed,
  clipped, inert layer beside the page. The first time there's no picture
  yet, so it shows the mode's name and icon. On release, the page as it was
  becomes a picture too, the real next mode renders into `#content` one
  page-width along, and the two move together — so the strip always lands on
  the true page, and the picture is never there long enough to be caught
  out. Any render that isn't a mode change (an edit, a filter, a sync) drops
  the pictures, since it may have changed what the other modes show.

  The copies keep their ids, because the stylesheet targets `#content` and
  `#viewBody`. The layer is appended last in the document, so
  `querySelector` and `getElementById` still find the real page first.

  The first version put the name-and-icon placeholder in the centre of the
  neighbouring page, which is exactly the half the finger hasn't uncovered
  yet, so a normal-length drag never showed it. The test passed anyway,
  because `innerText` reads clipped text. It now asserts where the label is
  on screen; the screenshot is what caught it — the same lesson as 0.169.2.

  **Modes wrap, tabs don't.** Four tabs are a row you can see, and the edge
  means something there. A view's modes are a small loop you can't see, and
  hitting a wall there only meant turning round.

- **pull to refresh: the page and an arrow on the background, driven by
  one value.** The look since 0.177.1 is Chrome's and Brave's: the page
  comes down, and in the gap it opens an arrow — drawn on the background, no
  bubble — comes down with it, winds up as you pull, then spins in place
  while the page holds a little way down, until the sync answers. The
  holding matters most: 0.177.0 sprang straight back on release, so a slow
  sync looked like nothing had happened.

  Page and arrow both read `--pull` on `<html>`, registered with `@property`
  so it can animate. Settling to the hold and back up is then one animation
  both follow, instead of two that could drift apart. The arrow sits under
  the top bar in z-order, so it comes out from behind it rather than
  appearing. The spin has a 700ms floor, so a quick "Up to date" still reads
  as the app having checked.

  Earlier, 0.176.0 dropped a circle in over the top bar, which worked and
  looked like something from another app, and 0.177.0 took every indicator
  away. Now `#content` and the filter slot come down with the finger
  against a rubber-band curve (easy at first, never past 180px). It uses the
  `translate` property rather than `transform`, so it can't collide with the
  mode swipe moving the same content sideways. It's set inline only while
  pulling, because any value but `none` would make `#content` a containing
  block for its fixed children — the bulk bar trap from view-fade-in.

- **pull to refresh in the app syncs; it doesn't reload.** In Chrome the
  gesture reloads the page, and it's the boot after the reload that pulls
  from GitHub — so "pull to refresh" has always really meant "pull to sync".
  The app's files are on the phone, so a reload there would only rebuild the
  same screen. The pull runs `pollForUpdates()` and reports what happened,
  which meant making the poll say so: it returns an outcome now, and
  `checkRemote` stopped swallowing errors — before, a pull with GitHub
  unreachable would have said "Up to date", the same wrong comfort the
  status line used to give. The interval and focus callers ignore the result.

  It claims a drag only once it's clearly a downward pull from the very top:
  a sideways one belongs to the mode swipe, and one that starts lower down is
  the page scrolling. `html.native` sets `overscroll-behavior-y: none`, or
  the WebView's own glow answers the same finger.

- **settings merge field by field.** They were one atomic blob — if both
  sides changed anything, the newer `settings.updatedAt` won wholesale —
  which was fine while settings were a sort order and a currency. They grew
  to hold the media sources: API keys, per-category sources and fallbacks,
  Steam, AniList. Then any casual change on one device (a sort order) erased
  a deliberate one on another (a key), and the report was simply "media
  sources don't sync". Now each field, recursing into nested objects, merges
  three-way like the collections do; only a field both sides changed falls
  back to the newer stamp.

  **Without a base, a value beats a blank.** Joining by setup link (0.174.0)
  merges with no sync base, so there's no telling which side changed a
  field. The wholesale rule turned that into a wipe: a fresh install that had
  saved anything held the newest blob, all empty defaults, and pushed it
  everywhere — test/browser/native.js shows the empty keys arriving on
  GitHub under the old merge. With a base, a cleared key is still a real
  change and stays cleared; "blank loses" applies only where nothing tells
  a deliberate clear from never having been set.

  This was caught because the settings bug and the join both touched the
  same path, and the scanner (0.175.0) was about to make joining a one-tap
  thing. It went out with the scanner rather than after it — but not before
  it had already emptied someone's keys, which is what 0.175.1's **Bring back
  missing settings** is for. Restore was the wrong tool for that: it rolls the
  whole log back to a save. `fillBlankSettings` fills only what's blank now,
  and the button walks the history newest first so nobody has to guess which
  save still had the keys. Blank-only is deliberate: a key someone changed
  since is theirs, and anything they cleared on purpose they can clear again.

- **the app reads setup QR codes itself, with Google's scanner rather than
  its own camera view.** A QR code is a link, and the phone's camera hands
  links to the browser, so scanning the setup code connected the web copy in
  Chrome and never touched the APK. Android App Links would route the link
  to the app instead, but they need `/.well-known/assetlinks.json` at the
  *root* of the host, which for a project site on `github.io` means a
  different repository, and they'd still send desktops and iPhones the same
  link. So the app asks
  `@capacitor-mlkit/barcode-scanning`'s `scan()`: Play services' own scanner
  screen, which needs no camera permission from LifeLog — the manifest gains
  one meta-data line (tools/android-manifest.js) so the scanner module is
  fetched at install time, and the app installs it itself if it's missing.
  What it reads goes into the token box and down the pasted-link path, so a
  scanned code merges exactly like a pasted one.

  Two outcomes that look like failures aren't. Backing out of the scanner
  rejects with "scan canceled.", which is a choice and gets no toast. Some
  other QR code is refused before it gets anywhere near Connect —
  test/browser/native.js shows that without the check, a menu's URL goes
  through as if it were a token.

- **the Android app is the same files, bundled, not a thin shell over
  Pages.** Two shapes were on the table. Loading the Pages site inside the
  shell keeps today's update path — a push reaches the phone on its next
  launch — but the first launch needs a connection, Capacitor doesn't
  support a remote `server.url` for release builds, and it gets fragile on
  iOS. Bundling makes the app open instantly and offline like any other app,
  at the cost that a change reaches the phone only as a new APK. That cost
  is paid down rather than accepted: every version bump on `main` publishes
  a release, and the app asks the Releases API about it on launch.

  What differs between the two homes lives in `src/platform.js` and nowhere
  else: no service worker in the app (its files are already on the device,
  and a worker's "new version" wouldn't be the app's), the update bar
  offering a download instead of a reload, and setup links pointing at the
  web copy because the app's own origin is `https://localhost`.

  **`sw.js`'s `ASSETS` is the one list of what the app is made of.** The
  browser's offline cache is built from it and so is the APK's bundle, and
  `tools/build-www.js` fails if `index.html` loads anything the list is
  missing — a file that falls off it is now a failed build rather than an app
  that 404s on its own script offline.

  **Signing is the part that can't be fixed later.** Android installs an
  update only over an app signed with the same key. CI runners make a fresh
  debug key every time, so an APK signed that way installs once and then
  refuses every update — and uninstalling to get past that wipes the app's
  local copy. Releases are signed with a key held in repository secrets, and
  without them the workflow still builds a test APK but will not publish it:
  a throwaway-signed release would be the one every later update can't
  install over. For the same reason `versionCode` comes from `APP_VERSION`
  (major·1e6 + minor·1e3 + patch) instead of the template's constant 1.

  **Joining by link merges; it never asks which copy wins.** Settings'
  connect flow asks "load it, or overwrite it with this device's N
  entries?". On a freshly installed app N is zero, and the question is one
  mis-tap from wiping the synced log. A pasted setup link merges both copies
  with no base, so each side keeps everything it has. test/browser/native.js
  shows the old prompt's exact text when the merge is removed.

  **What the tests can't cover.** There's no Android in this environment, so
  test/browser/native.js fakes the bridge the way Capacitor presents it and
  checks what the page decides for itself. Whether Android's WebView agrees —
  status-bar colours, `target="_blank"` links opening outside, the back
  gesture reaching the listener — is the first real launch's job. One known
  gap: the status bar follows the phone's light/dark setting, not LifeLog's
  theme. Matching it means going edge-to-edge (`viewport-fit=cover` plus
  safe-area padding), which changes the web layout too, and wasn't worth
  doing blind.

- **sync broke at 1MB, and the app spent the whole time saying the wrong
  thing about it.** GitHub's contents endpoint carries a file's bytes up to
  1MB; between 1 and 100MB it answers with the metadata, `content: ""` and
  `encoding: "none"`. `ghGetFile` ran `JSON.parse(b64decode(j.content))` on
  that and threw "Unexpected end of JSON input". A single device keeps
  working — its PUTs carry the sha it last wrote, so they land without ever
  reading — which is how the file got past 1MB in the first place. The
  moment a second device saves, the first one's sha is stale, the 409
  recovery path reads the file to get the current sha, and that read is the
  one that fails. From there it never recovers.

  The fix reads with the `object` media type, and when the content isn't in
  the answer, fetches `/git/blobs/{sha}` for the sha that same answer named
  — so the data merged and the sha the next save writes against can't be
  from two different versions of the file. History restores go through the
  same function, since a file past 1MB now was probably past it then.

  **The report was "sync is not working, I'm not sure why".** The app knew
  why. It had exactly two stories: a 401 or 403 was "GitHub rejected your
  token", and anything else was "will sync when online". The first is false
  for a secondary rate limit (a 403 that fixes itself in a minute, and easy
  to hit now that ticking habit cells is one commit per tap). The second is
  false for everything except being offline, and it was what the screen said
  here. Errors now carry a `kind` — auth, ratelimit, server, other, offline —
  and only a fetch that never reached GitHub is called offline. The
  diagnosis took a mocked GitHub reproducing the exact line on the user's
  screen; the next one should take reading the line.

  test/browser/ghlarge.js runs against a small fake GitHub that behaves like
  the real one where it matters — large files come back empty, blobs come
  back by sha, a stale-sha PUT is a 409 — and on the old code it reproduces
  both messages the user sent, word for word.

- **a control that works and is useless is a thing tests will happily confirm.**
  0.172.0 gave the habit grid arrows that moved one week per press. Every
  assertion about them passed: they appeared only when there was somewhere to
  go, they stopped at the habit's start, the window label was right. The test
  that reached a day four months back clicked twenty-five times in a loop and
  called that a pass, because what it asserted was `clicks < 25` — a loop
  bound written to keep the test from hanging, sitting exactly where the
  complaint should have been. A press is now a whole window, the way a
  calendar pages by month, and the assertion is `clicks === 1`.

  The general form: a bound you wrote to stop a test spinning is not a
  statement about the product, and it will sit there looking like one.

- **the offer moved out of `confirm()` and into the modal.** Three things were
  wrong with asking after Save. You met the question having already committed
  to it; "no" was final, because the offer only fired on a date change; and a
  native dialog is the one surface in this app that can't say "60 days (3×
  each)" and let you look at it. A checkbox next to the field it is about says
  the same thing before the fact and can be unticked. The app still doesn't
  get to decide you kept a habit — the box starts empty.

  What did not move: `confirm()` is still right for deleting a habit. The
  difference is that deleting is a yes/no about something you already did,
  and backfilling is a claim about the past that you might want to look at
  first.

- **held-then-tapped, not dragged, for filling a run.** Dragging across the
  grid is the obvious gesture and it was the wrong one: it needs
  `touch-action: none` over the grid, the grid is more than half the height
  of every card, and that is the surface you scroll the list with. Holding one
  end and tapping the other costs one extra tap, works identically on touch
  and desktop, and leaves scrolling alone. Shift-click is the mouse shortcut.

  The subtle part is the click the browser sends *after* a long press. A
  boolean flag ("swallow the next click") doesn't work, because setting the
  anchor repaints the grid: the click may land on a replaced node, on nothing,
  or — on touch — never arrive, and a flag left standing then swallows the
  next real tap, which is the one choosing the other end. The anchor carries a
  `performance.now()` stamp instead and ignores clicks for 350ms. It is
  `performance.now()` rather than `Date.now()` because the browser suites
  freeze `Date`, and a frozen clock makes an elapsed-time guard permanent.

- **statsFor counts instead of walking.** It walked the window a day at a
  time, which was fine while every window was ninety days. Backfilling makes
  "since you started" a real question and a ten-year card would have walked
  3,650 days per habit on every render, including every tick. Whole weeks
  contribute a fixed number of due days whatever the cadence, so only the
  ragged tail needs looking at, and the kept half is counted off the marks,
  which are far fewer than the days. The old walking version lives on in
  test/habits.test.js as the reference a property test checks the new one
  against over four thousand random habits — that is what makes the rewrite
  safe to have done at all.

- **backfilling a habit was impossible for three reasons at once**, and any
  one of them left on its own would have kept it impossible. The start date
  was pinned to the day you created the habit with no field to move it;
  `isDue` correctly answers *no* for every day before the start date, so
  those cells were drawn disabled; and the grid was twelve fixed weeks ending
  today, so even a moved start date put the uncovered days off the end of it.

  None of those is a bug. Each is a reasonable line read on its own, and the
  code contains no comment saying "you cannot backfill" because no single
  place decided that — it fell out of three correct decisions meeting. This
  is the kind of thing that is only visible by asking the question from the
  outside ("what if I want to backfill?") and then *running* it rather than
  reading it: printing `isDue(h, lastMonth)` took a minute and turned a
  suspicion into three concrete blockers.

  What the fix does **not** do is assume. Moving the start back asks once,
  with the count in it, and a no still moves the date — the date is a fact
  about when you started, the marks are a claim about what you did, and the
  app only gets to save you the taps once you make the claim. Anything you
  actually missed is unticked afterwards, which is far less work than
  ticking sixty cells by hand.

  The grid's paging offset lives in a module-level `Map` keyed by habit id
  rather than in the render. Ticking a cell re-renders the whole view, and a
  per-render offset snaps you back to this week in the middle of filling in
  last spring — the sort of thing that reads as the app fighting you.

- habits are the Notes tab's **third mode**, and they spent exactly one
  version (0.171.0) as a fifth tab before moving. Both halves of that are
  worth keeping, because the reasoning that put them in a tab was sound and
  still produced the wrong answer.

  The argument for a list of their own holds and is unchanged: every other
  list here is organised by an ending — a backlog item graduates into an
  entry, a to-do is ticked and stops mattering, an expense is a fact about a
  date — and a habit has no ending. It comes back tomorrow, and it is worth
  the pattern rather than any single tick. That is a fourth kind of ending,
  so it is a fourth kind of list.

  **What did not follow is that a fourth list needs a fourth tab.** The
  objection considered beforehand was room, and it was measured rather than
  assumed — five tabs are 75px each at 390px and 61px at 320px, nothing
  clipped — so it was dismissed. The objection that actually mattered never
  came up until the thing was on screen: four tabs is what the bottom bar
  reads as, and a fifth makes it a menu. Measuring the wrong objection is a
  way of feeling rigorous while still guessing.

  Notes now holds the three things you keep yourself — what you wrote, what
  you mean to do once, what you mean to keep doing — against the three tabs
  that hold what you log. That reads better than a fifth peer did, and it is
  the shape the tab's own header comment already described before habits
  existed.

  The cost is real and was the reason for recommending a tab: ticking is one
  tap deeper. It is softened by `notesMode` persisting, so the tab opens
  where you left it — if Habits is where you live, it is one tap from
  anywhere, same as before.

  **Moving it was cheap, and the reason is worth noting.** `UI_MIGRATIONS`
  already existed for exactly this (Stats and Finance-stats were tabs once
  too), so a saved `view: "habits"` lands in the new home rather than
  nowhere; a browser test covers it, and removing the one line drops you on
  Timeline with no card. What had to change beyond that was small: the
  view/mode checks became mode checks (`isHabitsMode`, mirroring
  `Todos.isTodoMode`), the recap slides went from `view: "habits"` to
  `view: "notes", mode: "habits"`, and the Notes mode bar learned not to put
  a to-do count above a habits screen.

  The fifth view did break three things on the way in and out, all of which a
  sixth would break again: `VIEW_TOGGLES` in Settings assumed every view has
  a `VIEW_MODES` entry; the year and category chip rows drew over a screen
  that has neither; and two counts in `tabtoggle.js` had "four tabs" and
  "nine modes" written into them. Those now read the tab list and the mode
  dots off the bar instead of being told.

  On the data side, which the move did not touch: marks live on the habit as
  a `{ date: count }` map rather than their own collection — ~1,100 of them
  for a daily habit over three years, 18KB, where id-carrying records would
  be five or six times that in a file that syncs whole on every save. That
  costs one thing and it had to be right: `mergeCollection` treats an item as
  atomic, so two phones ticking two different days would resolve as an edit
  conflict with one day simply gone, which is the single most likely thing
  that will ever happen to this collection. `mergeHabits` merges the fields
  normally and the marks **per date**, three-way: a date only one side
  touched takes that side, which is what makes unticking work rather than
  being undone by the other device's stale copy; both sides on the same date
  takes the larger count.

  **Two rules in the streak maths are judgement calls**, both there to stop
  the tracker punishing you for being honest with it. A day the cadence never
  asked for does not break a run, so a weekdays habit survives the weekend —
  a streak counted in calendar days would tell someone doing exactly what
  they planned that they keep failing. And today is never counted against
  you: if it is due and not yet done, the run up to yesterday still stands,
  because a tracker that zeroes your streak at midnight punishes you for
  looking at it in the morning. Both have tests that say so in words.

  And one real bug the browser suite caught: archiving your only habit landed
  on "no habits match your search" **with the archived section never
  rendered** — the habit and its whole history unreachable. The live list
  being empty is no longer an early return.


- 0.170.0 gave the Recap two slide kinds that show things instead of counting
  them — `gallery` (the wall of covers) and `cards` (the notes themselves).
  The pure/render split from 0.167.0 held: both are specs out of `buildRecap`,
  so what the wall contains and how the notes are ordered are unit-tested
  without a browser, and only the look needed a screenshot.

  **The gesture problem is the interesting part.** The player owns the whole
  screen: tap-zones advance, a horizontal swipe advances, and `.recap-stage`
  is `pointer-events: none` so taps fall through to the zones. A slide you can
  scroll has to take pointer events back, which would eat the swipe.

  `touch-action: pan-y` on the scroller is what settles it. The browser
  handles the vertical axis itself and leaves the horizontal one alone, so a
  horizontal swipe still reaches `#recapScreen`'s touchend handler and moves
  on. A vertical drag has a tiny `dx`, so the 45px threshold already ignored
  it. The cost is that a tap in the middle of a wall no longer advances — it
  lands on the scroller — which is right: tapping a thing you are looking at
  should not skip past it. The margins, the arrows and the swipe all still do.
  A browser test asserts that contract (`overflow-y`, `touch-action`,
  `pointer-events`) rather than trusting it.

  Two things the screenshots caught that the assertions did not, which is now
  three releases running:

  "Most of them in February" on four notes in four different months. The
  entries slide had a floor for exactly this (`busiestMonth` returns null
  under two) and the notes slide, written later, didn't. A leader now has to
  have at least two and to actually beat second place.

  And rows in the best-of list were different heights depending on which
  titles had art, because the no-art case fell back to a small dot. The empty
  state is now the same box as a cover, tinted with the category — same
  lesson as the recap tiles: an absent picture should leave the layout alone.


- 0.169.3 swept for the rest of 0.169.2's bug and turned the sweep into
  `test/browser/hiddenaudit.js`, which is the part that matters.

  Three more were hiding, all in every layout rather than just the phone:
  `.menu-wrap` (so a brand-new recurring plan showed a More… button whose
  menu then refused to open, since `setRecToolsOpen` reads the same
  `.hidden` — the present-and-dead control again, and mine from 0.163.0),
  `.gh-qr` and `.picker-buckets` (both left an empty flex row still spending
  its margin). The stylesheet now carries 32 companion
  `X[hidden] { display: none; }` rules; four of those were added only after
  something visibly broke, which is the case for checking rather than
  remembering.

  **How the sweep works, because the method is reusable.** Don't reason about
  specificity — that is the thing that goes wrong. Ask the browser: set
  `hidden` on an element, read `getComputedStyle().display`, and anything
  that isn't `none` is a bug. The only real work is deciding *which*
  elements, and the answer is two sources — every element carrying a `hidden`
  attribute in index.html, since that attribute is the app declaring the
  element gets shown and hidden, plus anything else caught by a patched
  `hidden` setter while the app is driven around. That comes to about a
  hundred, which is small enough to check exhaustively in four layouts.

  Two things the first cut of the suite got wrong, both worth remembering.
  Auditing *every* element in the document rather than the hide-able ones
  produced forty findings that were all noise — a `<select>` nobody ever
  hides is not a bug. And seeding with nothing disabled meant `.tab` never
  entered the set, so the suite could not catch the very bug it was written
  for; it now seeds a disabled view and a disabled mode deliberately.


- 0.169.2: a tab turned off in Settings still drew its icon in the phone's
  bottom bar. Two separate mistakes, and the second is the one worth keeping.

  The bug itself is this file's oldest trap, which it already carries a
  companion rule for in five other places: `html:not(.force-pc) .tab
  { display: flex }` outranks the UA stylesheet's `[hidden] { display: none }`,
  so setting `tab.hidden = true` did nothing on the phone layout. Desktop was
  fine because nothing sets an author `display` on `.tab` there — which is
  exactly why it read as "works" while being half broken. Both mobile blocks
  now carry `.tab[hidden] { display: none; }`, the same companion the
  checkbox, the filter group and the menu-pop rules already have.

  **The test was the real failure.** It asked `!t.hidden` — a property the
  app sets itself, so it could only ever agree with the app. It ran at 460px,
  in the very layout where the bug lived, and passed. An assertion phrased in
  terms of the thing under test is not a test; ask the layout instead —
  `getBoundingClientRect().width` and `getComputedStyle().display`. Rewritten
  that way it fails hard on the old CSS, and the suite now runs the bar checks
  at 1280 and 390 rather than at one width, since the two layouts style `.tab`
  differently and only one of them was ever broken.


- 0.169.1 is the other half of 0.168.0, and the gap between them is the
  lesson: **taking a tab out of the tab bar is not the same as taking it out
  of the app.** The first pass routed every *navigation* surface through
  `enabledViews()` — the bar, the swipe, the dots, the fan, the badges, the
  shortcuts — and stopped there, because those were the places that walked a
  list of views. What it missed is everything that names one view without
  enumerating them: the + menu's six items, six lines of static HTML in the
  cheat sheet, the Recap's slides, the PWA manifest's shortcuts, and a
  heatmap cell in Stats that jumps into the Timeline's Entries mode.

  None of those iterate over VIEW_ORDER, so no amount of routing through a
  filtered list would have caught them. Finding them took grepping for the
  tab names in user-visible strings and for cross-module `open*Modal` calls,
  which is the check worth repeating if another view is ever added.

  Two shapes came out of it, both worth keeping:

  `data-view` on the markup. The + menu's items and the divider that heads
  its Finance group each carry the tab they file into, so `syncAddMenu()` is
  one loop over `[data-view]` rather than six conditions that must each be
  remembered. The divider carrying one is the detail that makes the group
  disappear cleanly.

  **Hide the affordance, don't just guard the handler.** The Stats heatmap
  could have kept its click and done nothing; instead the cell is not made
  clickable at all. A control that is present and dead is worse than one that
  is absent — it reads as a bug. `jumpToTimelineMonth` *also* refuses, but
  that is a second line of defence, not the fix.

  The Recap needed one more rule than the rest: its opening and closing cards
  belong to no view, so a filter that removed everything else left them
  standing. "2026" followed by "That was 2026." is two cards of nothing, so
  it is all or nothing.


- the Settings rework (0.169.0) is a regrouping, not a redesign, and the
  principle it turns on is worth stating: **group by where the effect lands,
  not by what kind of control it is.**

  Appearance had ten sections because every feature that needed a switch
  added one, and "it is a setting about how things look" was enough to get in.
  That put "what colour is the app" beside "does the Backlog show
  descriptions" at identical weight. Splitting by scope instead — the whole
  app in Appearance, one list at a time in Views — cuts Appearance to three
  sections and puts the Backlog's four scattered settings in one group.
  Nothing was renamed or reset; the ids are untouched, so settings.js needed
  no changes at all beyond the toggles it already had.

  Two placements worth defending. Force-layout went behind a `<details>`
  rather than out: it is a troubleshooting escape hatch you set once if ever,
  and a whole section at the same weight as the colour scheme was the clearest
  case of the problem. And currency moved to Views → Ledger even though it is
  the one setting on either page that *syncs* — because "where would I look
  for it" beats "what kind of setting is it", and the hint now says so out
  loud rather than leaving it as a trap.

- `.modal label { display: block }` (0,1,1) outranked `.toggle-label`
  (0,1,0), so the flex row that gives a checkbox its 8px gap had never
  applied anywhere in the app. Every `.toggle-label` lives inside a modal, so
  every one of them — the privacy toggle, the import picker rows — had shipped
  with the box jammed against its text.

  Worth recording because of how it surfaced. The stylesheet looked right,
  the rule was there, and no test touched it. It came out of *looking at a
  screenshot* of a panel that had just been rebuilt, which is the third time
  this month a screenshot has caught something the assertions could not (the
  Recap's repeated number, the FX preview's spacing). The test that now holds
  it measures the distance between the checkbox's right edge and the first
  glyph of the label — asserting the rule exists would have passed all along.


- disabling tabs and modes (0.168.0) is four lines of feature and a long list
  of things that quietly assumed four tabs. The shape that made it tractable:
  two functions, `enabledViews()` and `modeEntries()/modeIds()`, and then
  every consumer routed through them rather than through `VIEW_ORDER` and
  `spec.modes` directly.

  That was worth doing deliberately. The alternative — teaching the tab bar,
  the swipe, the drag-underline, the mode fan, the tab menu, the mode dots,
  the search badges, the keyboard shortcuts and `applySavedUi` each to check
  the setting — is nine places that must all remember the same rule, and the
  one that forgets fails silently. `modeIds` was already the funnel for most
  of the mode work; giving each VIEW_MODES entry a `key` is what let it look
  up what had been turned off without every call site passing the view in.

  **Both functions refuse to return nothing.** A stylesheet with no tabs is
  not a preference, it is a bricked app, and the setting is a plain object in
  localStorage that a hand edit or a stale sync could set to anything. So
  Settings blocks turning off the last tab (with a message, rather than a
  checkbox that silently springs back), and `enabledViews()` falls back to
  the full list if it is ever handed an empty one anyway. Two layers, because
  only one of them is in code the user can't reach.

  **The trap is where you open.** The tab you were last on is exactly the one
  you are most likely to turn off, and `applySavedUi` would happily restore
  it. `settleDisabled()` runs at the end of that, and again whenever the
  setting changes, so "where am I now" has one answer rather than one per
  entry point. A browser test covers it by opening with `view: "backlog"`
  saved and Backlog disabled; removing the call fails it.

  One thing the tests got wrong first, worth knowing for the next suite:
  `attachSwipe` listens on **pointer** events, not touch, and only in the
  mobile layout. A synthesised TouchEvent reaches nothing — drive it with
  `page.mouse` instead. And a mode falling back is visible on screen before
  it is in localStorage, since `saveUiState` only runs on a change; assert on
  what is rendered, not on the file.


- the Recap (0.167.0) is split so that *what it says* is testable without a
  browser: `buildRecap(data, year, fmt)` is pure and returns an array of slide
  specs, and the player only decides how a spec looks. That split is what let
  21 unit tests pin the wording, the thresholds and the year-on-year
  comparisons before any markup existed.

  Three rules it is built on, all of which are the difference between a recap
  and the stats card it sits beside:

  A slide that returns null is dropped. There is no "0 notes written" slide, no
  "your busiest month was January (1 thing)". Every builder has a floor below
  which it bows out — three entries for a busiest month, two categories for a
  breakdown, four stars for a highlight, three to-dos for a tick-off — because
  a recap that pads itself is a report again.

  It never says the same number twice. A "big" slide is one figure and a
  phrase that completes it: **14** / *things logged*. The first cut read "14"
  and then "14 things logged", which is a stutter, and no assertion caught it
  — a screenshot did. There is now a test that walks every big slide and
  fails if its value appears in its own headline.

  Money is formatted by the caller. `buildRecap` takes `fmt` and never learns
  what a currency is, which is also why the tests can assert on exact strings.

  Two smaller decisions worth keeping. The spending slide reads
  `getEffectiveFinanceEntries()`, not `state.data.financeEntries` — a
  recurring plan's charges are generated rather than stored, and a year's
  spending that omitted every subscription would be wrong by the most regular
  thing in it. And `recapSeen` lives in the visual settings, which are
  device-local and never sync: being shown your year twice is a far smaller
  cost than never being shown it because another device ticked it off while
  you weren't looking. A year with no slides is never marked seen either, so
  a quiet December that fills up later still gets its recap.


- 0.166.0 was a cleanup, and the part worth recording is how unreliable the
  obvious way of finding dead code turned out to be.

  Grepping a class name to see whether anything produces it fails twice over
  in this codebase. `\bcat-row\b` matches inside `media-cat-row`, because a
  hyphen is a word boundary — so a dead class looked alive. And pairing
  quotes to extract string literals drifts the moment prose contains an
  apostrophe, which in files this heavily commented means most literals after
  the first "don't" are mis-parsed — so live classes looked dead. Both
  failures point the same way: treat the output as a candidate list and let
  a precise grep be the arbiter, one name at a time.

  The same trap in reverse for ids: `$("#" + prefix + "SyncStatus")` builds
  `fSyncStatus` and `bSyncStatus`, so a search for either finds nothing. Any
  audit here has to consider prefix-built AND suffix-built selectors, and the
  honest check for "did this removal matter" is not the analysis at all —
  it is screenshotting every view, mode and modal at both widths before and
  after and comparing the images. That is what was actually relied on.

  What went, once verified: the whole `.cat-manager`/`.cat-row`/`.add-cat`
  block (an in-place category editor replaced long ago by the three modals),
  `.view-current`, `.recur-stop`, `.version-tag` (not to be confused with the
  live `.version-badge`), `.bulkp-row.is-pending`, eleven vestigial `id`
  attributes whose elements are all styled by class, and `b64urlEncode`,
  whose decode half is still used by the setup-link path.

- `sw.js`'s `CACHE` constant is bumped once per release, and 0.166.0 is where
  that stopped being folklore. It had drifted three releases on `v87` because
  the release checklist never mentioned it; the checklist now does.

  Worth being clear about what it is and isn't for, since the drift did no
  harm and that is easy to misread as "it doesn't matter". Freshness comes
  from the `?v=x.y.z` query on every script and stylesheet — changed assets
  are new URLs that miss the cache regardless of its name. What the name
  controls is the `activate` handler's purge: it deletes every cache that
  isn't the current one, so leaving the name alone means every superseded
  `app.js?v=…` stays in the user's cache storage indefinitely.


- 0.165.0 made recurring expenses foreign, and the decision TODO.md had been
  parking for three versions — "a rate per occurrence or a rate that drifts" —
  came out on the side of per occurrence. The reasoning, because the cheaper
  option is the obvious one and it is wrong.

  A single `rate` on the template would have been four lines of code. It also
  means every charge the plan has ever made is priced at whatever that field
  currently says. Update it because the dollar moved, and three years of a
  subscription silently restate themselves — last July's total is a different
  number today than it was yesterday, for no reason the reader can see. That
  is precisely the drift the frozen-rate rule at the top of finance.js exists
  to prevent, and it applies to a recurring charge exactly as it does to a
  one-off: a charge cost what it cost.

  So a plan carries `rates: { date: rate }`, one per occurrence, and `rate` is
  only the fallback for a date that has none yet. `occurrenceFx` is where the
  two meet, and `rateFrozen` is what the `~` in the occurrence list reads.

  **Why `rates` is its own map and not part of `overrides`.** They look alike
  and they are not. An override is something you changed by hand, and the
  list marks those with a `*` and offers to reset them. Freezing a rate is
  bookkeeping — after "Look up past rates" every past date would carry an
  override, every row would be starred, and the mark would stop meaning
  anything. One map for your decisions, one for the record.

  **Why the batch range starts a week before the first missing charge.** The
  ECB quotes business days. A charge on the 15th that lands on a Saturday has
  no quote of its own and takes the preceding Friday's — which is outside the
  range if the range begins on the charge itself, so the very first date was
  the one date the batch could never answer. It fell through to the per-date
  fallback and got today's rate instead of its own. The browser suite caught
  it; reverting the padding fails it.

  **What did not need changing, and why that is the point.** `fxOf`, the
  Ledger row, the totals, the export, the import: none of them know a
  recurring occurrence from an ordinary expense, because `recurringOccurrences`
  emits the same three fields a foreign expense carries — spread last, so a
  home-currency plan adds literally nothing and every reader sees exactly what
  it saw before. That is the storage rule at the top of finance.js paying for
  itself a second time.

  Two places that would have quietly lost the currency and now don't:
  `splitRecurring` builds the new plan from scratch rather than spreading the
  old one, so a price rise had to be taught to carry `currency`/`fxAmount`/
  `rate` across; and switching a plan back to the home currency deletes
  `rates` rather than orphaning it, or the old readings would come back to
  life — repricing history — the moment it was switched back.

  Also fixed here, in passing: `test()` in finance.test.js called its function
  and never awaited it, so an async test printed "ok" while its rejection
  escaped as an unhandled rejection. Two of this change's tests are async.
  `test()` now refuses a promise outright and `atest()` handles those.


- 0.164.0 renders from the cache first, and the two things that made it
  correct are both invisible in the diff, so they are written down here.

  The change itself is small: `init()` draws `Storage.loadCache()` — a plain
  localStorage read, nothing awaited — and then runs `reconcileFromSources()`
  behind it, which is `pollForUpdates`' job done once at startup. It goes
  through `Storage.load()` rather than `checkRemote()` so the local-file
  source, the conflict picker and `githubReadOk` are all still covered.

  **Trap one: the local side of the merge has to be stamped first.** An edit
  made while GitHub is still answering lives in `state.data` with whatever
  `updatedAt` it had before, because stamping is `persist()`'s job and
  `persist()` is queued behind the reconcile. Hand that document to
  `mergeAllSources` and the edit reads as unchanged-since-the-base, so a
  remote edit of the same item wins and the user's typing silently reverts.
  So `Storage.load(getLocal)` takes a *function*, called at the merge point,
  and that function runs `stampChangedItems` before returning `state.data`.

  This is worth knowing because the obvious test does not catch it. If the
  remote did not touch the same item, the merge keeps the local copy whether
  or not its stamp is accurate — the first version of `bootcache.js` passed
  with the stamping deleted. It takes a case where *both* sides edited the
  same entry to make the timestamp the deciding fact. That case is now case
  3b in the suite, and removing the stamp fails it.

  **Trap two: a save must not overtake the first reconcile.** A push is a
  whole-file write. Boot used to render only after it had seen GitHub, so
  this could not arise; rendering first opens a window where the user edits,
  `persist()` fires, and this device overwrites the remote file with a
  document that has never seen it — anything only GitHub knew about is gone.
  `persist()` therefore awaits `firstReconcile` before it does anything. The
  edit has already landed in `state.data` and on screen; only the save waits,
  and only for the remainder of a wait the user used to sit through staring
  at nothing.

  Two smaller things that look like oversights and aren't. The `"merged"`
  toast moved out of the cold-load branch entirely, because a merge needs
  this device's own copy as one of its two sides and that branch is by
  definition the case where there isn't one. And `reconcileFromSources` hands
  `mergeAllSources` a *normalized* local against a *raw* sync base, which
  looks like it should manufacture differences — it doesn't, because
  `normalize` is deterministic and additive by design (see
  `backfillUpdatedAt`'s comment), and `pollForUpdates` has merged on exactly
  that footing since it was written.

  What did *not* change: the cold path. A device with no cached copy still
  awaits `Storage.load()`, because it has nothing to draw and pretending
  otherwise would mean flashing an empty state at someone whose data is
  about to arrive.

  The profiling that found this is worth keeping, because most of it cleared
  suspects rather than convicting one, and the cleared ones are the things
  anybody would try first. `node test/perf/serve-and-run.js boot` re-runs it;
  `… sync-block` re-runs the latency sweep, which now reads 318 / 320 / 296 /
  333ms as GitHub's answer goes 0 / 50 / 150 / 400ms — flat, where it used to
  be 312 / 408 / 503 / 770.

  - **The JS weight is not the cost.** 924KB across 16 files, and stubbing
    the ten that no first paint needs (finance, backlog, media, settings,
    sync, io, qr, wheel, notes, todos — 349KB) moved DOMContentLoaded from
    163ms to 161ms. V8 streams and parses off-thread and compiles lazily;
    main-thread compile+evaluate for the whole app is ~30ms, 26 of it
    app.js. Splitting the bundle or loading per tab would buy nothing, which
    is the opposite of what the file sizes suggest.
  - **The 21 hidden modals are a minor part.** They are 849 of the shell's
    1,099 elements and 63KB of index.html's 74KB. Serving the page without
    them takes domInteractive from 215ms to 57ms but DOMContentLoaded only
    from 274ms to 243ms — the script fetch overlaps the HTML parse and
    becomes the critical path instead. ~30ms for moving 21 modals out of
    static markup is a bad trade.
  - `wire()` 25ms, `normalize()` 10ms, the snapshot clone 8ms, the filters
    19ms, the first render 60ms. Nothing there is worth attacking alone.
  - `UpdateLayoutTree` is 59ms up to the first rows and 285ms across a 3s
    window, so most style recalc happens after you are already reading —
    the idle trickle doing its job. The stylesheet is 803 selectors with one
    universal and no deep descendant chains; nothing pathological in it.
  - The IndexedDB open for the local-file handle is still on
    `Storage.load()`'s path, worth ~50ms, but that path is background now,
    so nobody can see it. Not worth moving.

- Convert still leads with "what it came to on your statement" rather than
  offering to fetch a rate, and that is deliberate even though 0.160.0 put a
  keyless rate lookup one button away.

  A published reference rate and the rate you were actually charged are not
  the same number. For settling a trip against a card statement the figure
  you want is your issuer's — their spread, on their value date — and a
  lookup that quoted the ECB would be confidently wrong in a way that is hard
  to notice, because it looks right. So the lookup is offered where the rate
  is genuinely unknown (the expense form, a recurring plan's past charges)
  and not where you are holding the real one in your hand.


- **a disclosure and a menu say different things (0.163.1).** Folding the
  recurring plan's four errands behind a button was right; making that button
  a disclosure was not. An inline row that appears in the middle of a form
  reads as *more form* — another section you might need to fill in — when
  what it holds is four things you go and do. A menu says "pick one and
  leave", which is what these are.

  The visual came from extracting `.menu-pop` out of `.add-menu` rather than
  copying it. That was the actual work: two popup menus that merely look
  alike become two that don't, one release later.

- **a form's job is the form (0.163.0).** The recurring modal showed four
  occasional actions — change plan, pause, convert, link past expenses — on
  every open, alongside a plan trail, a pause list and every occurrence the
  plan had generated. Most opens are to change a note or an amount, and all
  of that was in the way of the two fields that were the point.

  Folding them behind "More…" costs a press on the rare visit and saves a
  screenful on the common one. It re-closes on every open rather than
  remembering: an errand is something you arrive knowing you want, so there
  is nothing to remember — and a toggle that persists would mean the form
  looks different depending on what you did to a *different* plan last time.

  The one wrinkle is that the tools sit above the button that reveals them,
  so opening from the bottom of a scrolled modal can put them off-screen;
  `scrollIntoView({ block: "nearest" })` on open covers it without yanking
  anything that was already visible.

- **a dropdown option with nothing behind it (0.162.1).** The recurring form
  offered "+ New project…" because it shares `fillProjectSelect` with the
  expense form, which builds that option into every project dropdown. Only
  the expense form had a handler for it. The save path even had a branch for
  the case — `value === ADD_PROJECT_OPTION ? "" : value` — which is what made
  it silent rather than broken: picking it stored no project, exactly as if
  you had chosen "none".

  Worth remembering: a shared builder that emits an *action* item makes every
  consumer responsible for that action, and the one that forgets fails
  quietly. `pendingProjectSelect` was a boolean meaning "#financeModal", which
  is the same mistake one level up — it now carries which form and which
  field to return to, so a third caller can't inherit the wrong one.

- **grouped, not run-merged (0.162.1).** The Ledger merges *consecutive*
  same-project rows because its months are date-ordered and a trip's expenses
  genuinely sit together. The recurring list is ordered by start date, where
  a project's two subscriptions are almost never adjacent — run-merging there
  would have meant never grouping at all. Same pill, different rule, and the
  rule follows from what the list is sorted by.

- **an overview has to hand the problem over (0.161.0 → 0.162.0).** The
  partial states the app accumulates — an import whose title never resolved,
  a backlog item a source could still fill, an expense on an unsettled
  project — are real and were invisible. Gathering them into a panel was the
  obvious move and the wrong one: it could only *tell* you, and its one
  action put you in front of the same list with nothing selected.

  The version that works does a single group and stages the fix: inside bulk
  mode the Backlog offers "⚠ Incomplete 12", which selects exactly those,
  next to the Sync button that resolves them. The other two groups had no
  such pairing, which is the tell — they shared a mood, not a fix, and
  grouping by mood is what made it a report.

  Two exclusions keep the count honest, and both were worth more than the
  grouping was. A category with no media source can't have gaps, only
  absences, so counting those buries the actionable ones. And a row inside a
  folded band is excluded because bulk mode must never act on what you can't
  see (0.155.0) — which has the happy side effect that the number on the
  button is the number you get.

- **the browser suites were perishable (0.161.0).** Fifteen suites and ~294
  checks had been living in a session-scoped temp directory with nothing in
  the repo. Several of them exist *because* they caught something no unit
  test could: a reconcile key collision that left stale fold bars on screen,
  a CSS animation outranking the class meant to dim a row, a toast
  contradicting the status line beside it. Losing those means re-deriving
  them from the same bugs.

  `run-all.js` serves the repo itself on a free port, so there is no port to
  remember, and runs each suite as its own process — a crash takes one suite
  down rather than the run, and a suite killed by the timeout can't leave
  localStorage behind for the next one, which is exactly how the ad-hoc
  scripts used to drift. Ten older scripts were deliberately left out; see
  DROPPED.md for why a red-on-arrival suite is worse than none.

- **"did it win" is not "did it answer" (0.160.2).** The offline warning on
  load was computed from the load's `source` — github / file / cache /
  merged — which describes which copy the app decided to use. Whether GitHub
  was reachable is a different fact, and the two disagree in both directions:
  a 404 (no data file in the repo yet) is a perfectly good answer that
  contributes no winning candidate, and a merge whose remote was the local
  file, because the GitHub read threw, still reported `merged`. So the
  warning fired when GitHub was fine and stayed silent when it wasn't.

  Storage now says outright whether the read completed, and the warning reads
  that. The general shape: when a boolean is derived from an enum that was
  built to answer something else, it will be wrong wherever the two questions
  come apart — and the enum's name won't warn you, because it is accurate
  about its own question.

  The other half was staleness. A toast asserts something about a moment; the
  status line asserts the present. One failed request would toast, the next
  save would succeed and turn the status green, and both would be on screen
  together saying opposite things. Retrying once removes the class rather
  than the symptom — and a 401/403 is deliberately not retried, since that
  failure is a decision and the status line already explains it.

- **a caption binds to whichever neighbour is closer (0.160.1).** The FX
  conversion line inherited `.hint`'s 10px-top / 0-bottom margin, which put it
  0px from the Category field below and made it read as Category's caption.
  Proximity is the only thing saying what a line of small grey text belongs
  to, so the asymmetry has to point at its subject.

  The fix had to go on the bottom, not the top: an adjacent sibling's bottom
  margin collapses with this element's top margin, so the gap above is the
  form's 12px field spacing and cannot be shrunk from the hint alone. Growing
  the gap below to 20px produces the same asymmetry without a negative margin
  or a `:has()` rule. The test asserts `below > above` rather than a specific
  pixel value, so it keeps meaning the same thing if the form's spacing
  changes.

- **the rate you want is the one that applied when you spent it (0.160.0).**
  The ask was a button for "the current rate". Built literally that would put
  today's number on a June expense — a rate that was never true for it. The
  lookup takes the expense's own date, which for a new expense is today
  anyway, so the literal reading is the common case of the correct one. ECB
  publishes on business days, so a weekend resolves to the Friday before it;
  the hint names the date it actually used rather than letting you assume it
  matched.

  Six significant figures, not four decimals: 4dp is ample for 4.1234 and
  destroys 0.00234568, which is a real supported currency pair (KRW) and
  would be wrong by 2%.

  Where the button can appear is decided by something that was already there:
  the rate box is hidden when a project already prices the expense, because
  "you said Switzerland is CHF at 3.9 once and shouldn't be asked again". So
  the button reaches an ad-hoc foreign expense and the first one on a
  project — exactly the cases where nobody else knows the number — and
  Convert covers the project case. Found by a test whose fixture put the
  expense on a priced project and got a hidden row; the fixture was wrong,
  and the boundary is now asserted rather than assumed.

- **verified against documented shapes, not a live call (0.160.0).** This
  sandbox's egress policy blocks every FX host, so the browser tests stub
  both services in their documented response shapes and assert the URLs the
  app builds. That proves the parsing, the fallback order, the date pinning
  and the direction — and proves nothing about the services being up. First
  real use is the test that matters.

- **one setting for three bands was one too few (0.159.0).** 0.158.0 gave
  Early Access and Unreleased a shared fold setting and left Dropped on a
  hardcoded rule, on the reasoning that "waiting on" and "gave up on" are
  different intents. The intents are different; that was an argument for
  three settings, not for two-plus-a-special-case. The grouping was doing the
  work a comment should have done, and it made Dropped the only band that
  couldn't be always-open.

  Each band now names its own key in FOLD_BANDS, and every rule that used to
  branch on `band === 4` reads that key instead. The special case is gone
  rather than moved.

- **two node types under one reconcile key (0.158.0).** The fold bar and the
  plain dashed rule for a band were both pushed as `sep-<band>`, on the
  reasoning that they occupy the same slot. They do — but `create()` only
  runs for a key reconcile has not seen, so switching the setting from
  foldable to always-open reused the existing `<button>` and the update pass,
  which only knew how to fill a bar, silently left it there. The list said
  "always open" and showed three collapsed bars.

  The rule: a key identifies a *node*, not a position. Two things that would
  need different `create()` calls need different keys, however alike their
  places in the list look.

- **a fold is a look; the setting is the preference (0.158.0).** Per-category
  fold state is held in memory and cleared on reload and whenever the setting
  changes, and it is stored as an *exception* ("this one was opened") rather
  than as the truth ("this one is open"). Storing the truth would mean a band
  you once touched ignoring every later change to the setting, which is the
  bug where a preference silently stops applying to the parts you have
  interacted with most.

- **a control that labels the action and a tooltip that labels the state
  (0.157.0).** The Timeline's order button read "↑ Oldest first" while
  showing newest-first, and its tooltip read "Showing newest month first —
  click for oldest first". Both were accurate; they just answered different
  questions, so whichever you read the other one contradicted it. That is the
  whole of why the naming felt wrong, and it is why every sort option is now
  a finished phrase in a list: a list of states can't disagree with itself
  about which one you are in.

  The behaviour underneath was worse than the label. `monthOrder` ordered
  months while years stayed pinned newest-first, so "oldest first" gave
  2026: Jan, Sep then 2024: Feb, Nov — neither oldest-first nor newest-first,
  just inconsistent at two levels. Fixing the naming without fixing that
  would have made the label an accurate description of something incoherent.

  Scope is part of each option's meaning and differs per view, which is why
  SORTS carries a comment rather than just a list: the Ledger's time options
  run the whole ledger, but "Largest first" reorders rows inside a month and
  leaves the months alone — because it is a statement about expenses, not
  about months.

- **an ordering that depends on data arriving later has to ask for a redraw
  (0.157.0).** Backlog prices are fetched after the render that wants them
  and the loader only patches the price spans in place, which is fine when
  price is something a row *shows* and wrong the moment it is what the list
  is *ordered by*. The fix is a counter bumped on every cache write, with the
  backlog redrawing once when it is sorted by price and the counter has
  moved — the guard being what stops the redraw from re-requesting prices and
  redrawing forever.

- **sorting inside the bands, not across them (0.157.0).** Offered the choice,
  the call was to keep the backlog's bands absolute and let a sort reorder
  within them. It is the smaller change and it keeps the list answering "what
  could I start today" first, which is what the bands are for — the cost is
  that "Added longest ago" shows the oldest starred thing before the oldest
  thing, which in practice reads as pinned-items-first and is what you would
  want anyway.

- **suppressing a tap highlight is only half a fix (0.156.0).** The blue rect
  a browser paints over a tapped control is ugly and it was on all 105
  pressables in the app — but it is also, on touch, the *only* thing telling
  you the press registered. Grepping for `:active` found exactly one rule in
  the whole stylesheet, on the wheel hub. Removing the highlight on its own
  would have traded an ugly response for no response, which is the worse of
  the two. The rule that suppresses it adds a press state in the same breath.

  `opacity` is fine for that state even though 0.155.1's lesson was that
  `.ll-enter` owns opacity: a press is transient and nothing is animating for
  its duration. The rule from that entry is about *state that must stay
  visible*, not about every use of the property.

  The audit is worth keeping as a shape: rather than grep the CSS, walk every
  view and every modal in a real browser and read `getComputedStyle` for
  `-webkit-tap-highlight-color` and `user-select` on everything matching a
  pressable selector. Grep would have found the four hand-fixed spots and
  told me nothing about the other 105, because the absence of a declaration
  is what was wrong.

- **a CSS animation outranks the declaration it collides with (0.155.1).**
  Dimming a dropped row with `opacity: .55` looked correct in every static
  screenshot and was wrong in motion: `.ll-enter` animates opacity 0 → 1, and
  for the 300ms that animation is running its value wins over the class's, so
  an arriving dropped row was fully bright and then snapped. `filter:
  opacity(.55)` sits in a different property the animation never mentions, so
  the two compose — the row fades in *to* dimmed.

  Worth keeping in mind generally: any property `.ll-enter` or `.ll-exit`
  touches (opacity, transform) cannot also be used to express a row's state,
  because for the length of the animation the keyframe is the authority. Pick
  a property outside the keyframe, or the state will be invisible exactly
  when the row is most likely to be looked at.

  The test for it has to sample mid-animation — two `requestAnimationFrame`s
  after the click, with `ll-enter` still on the node — which is also why the
  original bug got through: every check written after `waitForTimeout` sees
  the settled, correct value.

- **the Dropped band is the one separator that can't be a boundary marker
  (0.155.0).** The backlog's dashed rules are emitted on a band *transition*:
  walk the sorted rows, and whenever the band changes, push a separator named
  for the band being entered. That is exactly right for a rule whose job is
  to say "a different kind of thing starts here", and exactly wrong for a bar
  that has to be pressable — a category holding nothing but dropped items
  crosses no boundary, so it would get no bar, and collapsing would strand
  its rows with no way back. Dropped is now split out of the walk and emitted
  whenever the band is non-empty.

  Collapsed means the rows aren't in the keyed part list at all, rather than
  rendered and hidden. Cheaper, and it keeps the reconciler honest: a row
  that isn't in the list is a row whose cover was never fetched.

  The knock-on was bulk mode. A per-category select-all handed
  `toggleBulkCategoryAll` every item in the category, which with the block
  shut meant ticking rows you can't see and then deleting them on the next
  button. It takes the visible set now. Worth remembering as a shape: any
  time a list learns to hide part of itself, every "all" in that list has to
  be re-read as "all of what, exactly".

- **what an import can fill is decided by what the dup check matched on
  (0.154.0).** Extending update rows past the backlog turned out to be less
  about writing code than about answering one question per kind: given that
  this record was called a duplicate, what is left that could differ? The
  answer comes straight from the key.

  Entries match on title+category+year+month, so everything descriptive is
  outside it — cover, length, genres, and your own rating and notes. Recurring
  plans match on startDate+interval+amount+category+note, so the end date,
  project, pauses, per-occurrence overrides and the prevId chain are all
  outside it, and all of them are things a restore can silently lose.

  Finance entries were the interesting one: `financeKey` spans date, amount,
  category, note, project, currency and fxAmount, which is the entire record
  except `rate` — which cannot be absent when a currency is set, because
  sanitizeFinanceEntry drops the whole trio otherwise — and `rateConfirmed`,
  a claim rather than a gap. So there is nothing to fill, and the honest
  implementation was to not build one. Narrowing the key to create gaps would
  have meant treating two identical same-day expenses as one, which is a real
  thing that happens (two coffees) and a much worse failure than a duplicate
  row you can untick. The test that asserts finance never produces an update
  row is there so a later change to financeKey has to think about this again.

  The other rule worth keeping: an entry is only offered fields the app reads
  back. An incoming entry can carry `summary`/`releaseDate`/`externalRating`
  and `keepUnknown` will store them, but nothing ever displays them on an
  entry — so offering them would be a row promising a change you could never
  see.

- **updatedAt is not yours to set (0.154.0).** The first version of the
  in-place fill stamped `target.updatedAt = now`, reasoning that a changed
  record has to say so or the next item-level merge would prefer the other
  device's older copy. The reasoning was right and the code was wrong:
  `persist()` calls `merge.stampChangedItems` first, which times every item
  whose content actually changed, and its own comment says it exists so that
  no mutation site has to thread a manual touch call. This one had been
  re-deriving a solved problem. There is a browser test asserting the fill
  lands re-stamped, so the guarantee is checked rather than assumed.

- **the subtitle tier lasted one release (0.153.0).** 0.152.0's matcher had
  two tiers: exact, and "that title plus a separated subtitle". The second was
  the only judgement call in the whole thing and it was dropped a release
  later, on purpose rather than because it misfired. The reasoning: its wins
  ("The Witcher 3" → "The Witcher 3: Wild Hunt") are cases you would also be
  happy to fix by hand once, and its losses (a spin-off or collection sharing
  a stem) are silent and permanent. Asymmetric costs, so the strict side wins.

  It also shrank the code to the thing it actually is — `isTitleMatch`, a
  boolean — instead of a rank scale with one live value, which is what the
  tier had been propping up.

- **"did it return anything" is not "did it find it" (0.152.0).** Auto-sync
  had two rules that were each reasonable alone and wrong together: fall back
  to the second source only when the first returns an empty list, and take
  `results[0]`. A search API always has an opinion, so the first rule almost
  never fired — "BioShock" gets "BioShock Infinite", which is not an empty
  list — and the second then committed to it. The two reported cases were
  exactly these: a title the fallback source had and was never asked for, and
  a title neither source has, filled in with a near-miss anyway.

  `matchRank` is the whole fix and it is deliberately blunt: 2 for the same
  title after normalisation, 1 for that title plus a *separated* subtitle, 0
  otherwise. The separator is what makes it safe — "BioShock" → "BioShock:
  The Collection" is the same game narrowed, "BioShock" → "BioShock Infinite"
  is a different one, and without requiring a `:` or ` - ` there is no way to
  tell those apart. Rank 1 is the only judgement call in here; if it ever
  picks something wrong, deleting it leaves an exact-only matcher and nothing
  else has to change.

  Both sources are now asked unless the first returns a rank-2 match. That
  costs one extra request per imperfect title and none at all for the ones
  that matched cleanly, which is the common case on a re-sync.

  The knock-on worth remembering: refusing to guess means *fewer* fields get
  filled than before. That is the trade being made on purpose — a missing
  rating looks missing and gets fixed, a wrong one looks fine forever.

- **NFKD is not a safe normaliser for store names (0.152.0).** `titleKey` ran
  `.normalize("NFKD")` to fold accents, which also decomposes `™` into the
  letters `TM`: "BIOSHOCK™" became "bioshocktm" and matched nothing. Steam
  names carry `™` and `®` constantly. They are stripped before the NFKD step
  now. Discover's already-have check shares this key, so it had been failing
  to hide duplicates for every trademarked title.

- **imports became one system with two adapters (0.151.0).** `syncSteamWishlist`
  and `syncAniListPlanning` were 90% the same function: fetch, map to backlog
  shape, `buildImportItems`, `reviewAndImport`, toast, persist — in a slightly
  different order each, with their own bugs in the parts that differed. A
  source is now a description (`plan`, `fetch`, `toItem`, `empty`) and
  `runImport` is the only thing that knows the order. The point isn't line
  count, it's that a fix to the shared half can only be made once now.

- **an import that can only add or skip is missing its most useful third
  option (0.151.0).** The old duplicate check answered "do you have this?" and
  stopped. But "I have it" and "I have everything about it" are different
  questions, and the gap between them is exactly where a re-sync is worth
  running. `fillableFields(target, incoming)` asks the second one and returns
  the list. An update row is pre-ticked on purpose: it cannot overwrite
  anything, it cannot touch a pinned field, and the only thing it can do is
  put something in an empty slot — so there is nothing to weigh up.

  The Steam side had to change with it. Its fetch skipped every appid already
  in the backlog, so the update path would have been dead code for every item
  that could have used it. It now looks up anything `importItemIncomplete()`
  says is still missing something.

- **a bulk media pull is a minute of network with nothing to look at
  (0.151.0).** The old feedback was one string, `"7/20 synced"`, which told you
  it was alive and nothing else — not which item, not whether the seven were
  successes or seven silent skips. `bulkRun` records a row per item as it
  happens and the count in the bar opens it. The three states were chosen to
  answer three different questions: *done* says what it filled and what it
  matched (so a wrong match is visible), *skipped* says why (which is usually
  a setting you can change — no media source for that category), *failed*
  carries the error verbatim.

  Two things fell out of building it. The loop used to have one try/catch
  around the whole thing, so the first throw ended the run and you couldn't
  tell from the outside which item did it or that anything was left. Now each
  item is caught on its own — with a three-consecutive-failures stop, because
  an invalid key fails identically on all fifty and there's no reason to prove
  it fifty times. And the bar's buttons had to learn about the run: they were
  disabled by a local flag the caller set once, which every mid-run `render()`
  then reset, so a second run could be started on top of the first. They read
  `bulkRun.active` now, which is the thing that's actually true.

- **`bulkRun` is cleared on entering bulk mode, not on finishing (0.151.0).**
  A finished run has to survive the end of the loop or the pill would vanish
  with the answer still in it. But it belongs to the selection that made it —
  carrying "12/12 · done" into an unrelated selection later is worse than
  showing nothing.

- yearly expenses are gone entirely (0.150.0), after two releases of being
  edit-only. What made them expensive was never the feature, it was the special
  cases: a bare-year `date`, a pseudo-month 0 that two sorts had to shepherd to
  the end, a label branch in three places, exclusion from financeMonthlyTotals,
  a guard against seeding a recurring expense, an extra CSV column, and a whole
  bridge (makeProjectFromYearly) for getting out of one. All of that is out.

  A legacy row migrates rather than being deleted: `/^\d{4}$/` on the date
  becomes 1 January of that year. The month is invented, which is a real cost,
  but the alternative is a row whose every month lookup is NaN — and deleting
  rows to retire a feature is not on the table.

  The one place keepUnknown is deliberately overridden: `delete kept.yearly`.
  keepUnknown exists so a build older than the data can't drop what a newer one
  added, and a *retired* field is the opposite case. Left in, every migrated
  row would carry a flag telling an older build to truncate the date it had
  just been given back to a bare year.

  This is the second retired-field decision in two days and they went opposite
  ways: project startDate/endDate were left to pass through (inert, nothing
  reads them), `yearly` is deleted (actively contradicts a field that changed
  alongside it). The test is not "is it retired" but "does leaving it make some
  reader wrong".

- the cards in Summary and Stats space themselves with an inline
  `card.style.marginTop = "20px"`, repeated at eleven sites across finance.js
  and journal.js. It is a fragile convention — a new card that forgets it is
  invisible in review and obvious on screen — and the Projects card forgot,
  sitting flush against Spend trend and reading as an overlap.

  Left as a convention rather than moved to CSS: there are 17 `.card`
  creations and no container class that distinguishes the stats stack from the
  Ledger's Recurring card, so a `#content .card` rule would leak. What makes it
  safe instead is test/panelgaps (scratchpad), which walks the stack's adjacent
  siblings and asserts the gaps are uniform. It names the offending pair, and
  was confirmed to fail with the margin removed.

  Measure adjacent *siblings*, not consecutive cards: the first version of that
  check compared card to card and read the whole .stats-grid between two of
  them as a 330px gap. A margin governs siblings; that is the thing to assert
  on.

- .content's bottom padding on a phone is `--bottombar-h + --fab-clear`, not
  just the bar. The bar is fixed and so is the + button 12px above it; padding
  for the first leaves the second floating over the last 64px of every view.
  --fab-clear exists as a token because three numbers have to agree — the 12px
  offset, the button's 52px, and 12px so the last row isn't flush against it —
  and they live in different rules.

  It presented as "Summary and Stats overlap on mobile" and was in every
  scrolling view; those two just end with a tall card whose right edge carries
  a number, so it was visible rather than merely present. test/mobilefit
  (scratchpad) asserts the last card of all seven views clears both the button
  and the bar at three phone sizes, and fails 15 checks with the padding
  reverted — checked, because a layout test that passes either way is how the
  bold and the invisible-tag regressions both got through.

  One knock-on worth knowing: adding 76px makes a short page technically
  scrollable, which broke a jump-nav assertion guarded on
  `scrollHeight > innerHeight + 4`. That guard was meant to ask "is there
  content to page through" and was answering "is there padding". It now wants
  240px.

- the project filter is two chips — No project / Project — and not one per
  project, which is what it shipped as for a few hours. A chip per project
  looked like the obvious parallel to the category row and was wrong for a
  reason the category row doesn't have: categories are a small fixed set you
  chose, projects accumulate with every trip, so the row grows forever. And
  narrowing to one specific project is already answered twice over — its edit
  form lists its expenses, Summary totals it. The question the ledger actually
  has is binary.

  The "₪0.00 excluding projects" line came out of the same look: that line is
  a *contrast*, so it only belongs on a month that has both kinds of spending.
  Gating it on projectTotal alone meant an all-project month asserted that
  ordinary spending was zero, which is true and useless — and filtering to
  Project made every month say it at once.

- a project has no currency, rate or settlement state of its own (0.149.0).
  It had all three, and each was a second copy of something the expenses
  already knew: the currency and rate existed only so a new expense could
  inherit them, which meant two answers to keep in step, and the project-level
  `rateConfirmed` could not express a half-settled trip through two countries.

  projectFx(name) now reads the currency and rate off the project's own
  expenses, most recently created first — the rate you last decided was right
  is the one the next expense should use. The cost is that the *first* expense
  in a new project has to have its currency and rate typed; every one after
  inherits. That is the right trade for deleting a configuration step.

  Settlement moved onto the expense as `rateConfirmed`, set only by Convert
  and never by the expense form — a rate you type when adding a trip expense
  is exactly the guess Convert exists to settle. An edit that leaves the rate
  alone keeps the flag; changing the rate clears it.

  Convert therefore works per currency: projectCurrencies() lists what a
  project was spent in, biggest total first, and the dialog shows a picker
  when there is more than one.

- a recurring expense can carry a project, and every occurrence it generates
  inherits it — so it groups into the pill and counts in the project's total
  with no special casing anywhere downstream. It deliberately cannot carry a
  *currency*: a foreign recurring expense needs either a rate per occurrence
  or one that drifts, which is still parked in TODO.md. That is also why
  projectExpenses() (Convert's input) filters to real entries: a generated
  occurrence has nothing to restamp.

- "present" is not "visible", again. The Top-expenses project tag was first
  appended inside .lbl — a 120px ellipsised grid column — where it rendered at
  zero width, and the browser check passed because it only asked whether the
  element existed. It now asserts the tag has real width and sits inside the
  card. Second time this exact shape of false pass has happened (see the
  not-bold entry below); when the ask is visual, measure geometry.

- "not bold" is not only font-weight. The project line in a month's breakdown
  was un-bolded in 0.147.0 and still read as emphasised, because the rule also
  set the name to --text-dim while every line around it is --text-faint. The
  browser test passed throughout: it compared computed fontWeight and nothing
  else. It now compares colour and size too.

  Worth generalising when a visual fix is asked for: assert on what the eye
  actually reads — weight, colour, size together — or the test certifies the
  half of the change you happened to think of.

- projects had a start and end date until 0.148.0, and the reason they went is
  worth keeping: the dates were argued for on one use — projectForDate offering
  the right project for an expense dated inside the range — and that use was
  quietly killed by a later change. 0.147.0 made a new expense default to no
  project (correctly: preselecting one was too eager), which left the offer
  firing only on a `change` event on the date field. During a trip you open
  Add, the date already says today, you never change it, and nothing is
  offered. The one case the dates existed for became the one case that didn't
  fire.

  What remained was a range label in Summary and a filter keeping unspent
  dated projects visible — neither worth two date fields on every project.

  The lesson for the next feature argued for on a single downstream use: when
  that use changes, re-check whether the thing supporting it still earns its
  keep. Nothing failed here; the feature just quietly stopped paying for
  itself, and only got noticed because it was questioned.

  startDate/endDate are no longer in KNOWN_PROJECT_KEYS, which means
  keepUnknown carries any already in the data through untouched. Removing a
  feature is not a reason to delete what people already saved.

- yearly expenses are edit-only as of 0.147.0. The checkbox and the Yearly
  bucket's "+" are gone for new entries, but the field, the sanitizer, the
  pseudo-month-0 bucketing and the save path all stay: the data exists, CSV
  import still produces it, and a legacy lump has to keep opening and saving.
  What changed is only that there is no longer a way to make a new one, and
  "Make project" is the way out of an old one.

  That conversion keeps the entry yearly rather than giving it a date. It has
  no month, and inventing one would file it in a month you didn't spend it in.
  It adopts the entry via pendingYearlyEntryId, which openProjectModal clears
  unless it was opened with { fromYearly: true } — otherwise the next project
  you created by any route would quietly swallow that lump.

- the rate box only appears when nothing else supplies the rate
  (ratingProject). Having said "Switzerland is in CHF at 3.9" once, being
  asked again on every expense is the app forgetting what you told it. The
  rate is still stored per expense — Convert needs somewhere to write — it is
  just not asked for when the project already answers.

- flex-basis follows the main axis, which is why .field-row resets
  `flex` as well as `flex-direction` in its narrow-screen media query. The
  8.5rem that is a sensible *width* for the currency field in a row became a
  136px *height* in a column, leaving a gap under it that looked like a
  hidden element still taking space. It wasn't; every [hidden] in that form
  measures 0.

- `amount` on a finance entry is ALWAYS in the home currency. This is the
  single decision the whole multi-currency feature rests on. A foreign expense
  carries three extra fields describing where that number came from —
  `fxAmount` (what you actually paid), `currency`, and `rate` (home per 1
  foreign unit) — and `amount` is their product, frozen.

  The alternative, storing the foreign figure in `amount` and deriving the
  home one at read time, would have meant auditing every total, breakdown,
  chart, sort, export and dedupe that reads `.amount` — and any one missed
  would silently add francs to shekels. This way a reader that knows nothing
  about currency is still correct, which is why this feature touched the
  rendering and almost nothing else.

  Rates are frozen rather than looked up. A past expense cost what it cost; if
  the home figure were re-derived from a live rate, last July's total would
  drift every time you opened the app. That is also why there is no FX API
  here and no network dependency added to a view that had none.

- a rate is "provisional" when its project hasn't been converted yet, and that
  is *derived*, not stored on the entry (isProvisional). "Has this trip been
  settled up" is a fact about the trip; a per-entry copy would be one more
  thing for Convert to keep in sync. A one-off foreign expense outside any
  project is never provisional — you typed that rate yourself, nothing is
  waiting on it.

- Convert takes either a rate or the total the trip actually came to, and
  derives one from the other. The second is the one worth having: your card
  statement includes the bank's spread and fees, which no published rate does,
  so "it came to ₪4,400" is a more accurate basis than any mid-market number.
  Convert restamps `rate` and `amount` on every matching expense and sets
  `rateConfirmed` on the project; `fxAmount` is never touched, so a wrong rate
  is always fixable by converting again.

  Editing the rate by hand in the project form deliberately does NOT restamp
  anything — it only changes what the next expense inherits. Silently
  rewriting settled figures because someone opened a form and typed would be
  the worst available surprise.

- the expense form adopts a project's currency whenever the *project* changes,
  including when a date inside its range selects it. The first cut only seeded
  currency in openFinanceModal, which runs before there is a date to match on,
  so picking a date brought the project across without its currency. Both
  paths now go through inheritProjectCurrency.

- sanitizeFinanceEntry takes all three currency fields or none. A currency
  without a rate cannot produce the home amount, and half a conversion is
  worse than none — a junk trio is dropped and `amount` stands alone, which
  is simply a plain expense.

- projects are a second name-referenced collection beside financeCategories,
  not a free-text field and not a flag. The shape is deliberate: an entry
  stores `project: "Switzerland"` as a *name*, exactly as it stores `category`,
  so the rename cascade in saveProjectFromForm is the one the finance category
  modal already had, and the id stays put across a rename because it is the
  merge identity. ensureProjects mirrors ensureCategories: a project an entry
  names but the list has lost gets rebuilt rather than the expense silently
  losing its grouping.

  It is knowingly the *fourth* copy of the add/edit-category modal. DROPPED.md
  argues why the three weren't unified, and this one diverges further still —
  it carries a date range nothing else has, and deleting it un-groups expenses
  rather than moving them to a fallback, because there is no "Other project"
  and an expense without one is a perfectly ordinary expense.

- the pill groups *runs*, not a groupBy. groupRunsByProject walks the month's
  rows in their existing date order and starts a new run whenever the project
  changes, so a non-project expense in the middle of a holiday splits it into
  two pills. That is the correct answer rather than a limitation: a month card
  is sorted by date, and gathering scattered rows into one pill would mean
  reordering the month to make the grouping look tidy — the ledger lying about
  when things happened.

  The group's reconcile key carries the run's first row id, not just the
  project name, because one project can legitimately have two runs in a month
  and the two must not collide. The cost is that adding an expense *above* a
  run's current head changes the key and rebuilds that pill instead of
  animating it; cheap, and rare next to a key collision.

  The pill head shows no amount, deliberately. A run is a partial figure — a
  project spans months and can split within one — so a number there would sit
  beside the month's project line in the breakdown and disagree with it. The
  month's figure is in the breakdown; the project's is in Summary.

- a project's spending leaves its category lines in the month breakdown and
  gets a line of its own, so the lines still sum to the total underneath.
  Counting a Switzerland dinner under both "Food" and "Switzerland" would make
  the breakdown add up to more than the month, which is the one thing a
  breakdown has to get right.

  financeMonthlyTotals skips projects for the same reason it already skipped
  yearly entries: the average, the trend and "biggest month" are describing
  the shape of a normal month, and one holiday makes all three answer a
  question nobody asked. The Ledger still counts them — that is where you go
  to see what actually left your account.

- adding a collection to merge.js's COLLECTION_KEYS used to be a two-file
  change that crashed if you forgot the second: COLLECTION_LABELS was read by
  destructuring, so a key with no label threw on `const [singular, plural] =
  undefined`. Both readers now fall back to the key itself. Found by adding
  `projects` and watching six unrelated merge tests fail.

- the jump row (#jumpNav) is the app's secondary navbar, and jumpSectionSelector
  decides where it appears. Its rule used to be "the view's first mode only",
  which was standing in for "this mode is a stack of sections you can page
  between". That proxy holds for the other three views — Stats, Summary and
  To-do are fixed layouts sharing a tab with a list — but not for the Backlog,
  whose three modes are all section stacks with the same `.backlog-section-head`
  markup. So Next releases and Discover had no row, and were exactly the
  lists that wanted one: a dozen release months, a card per media source.
  Backlog is now checked before the first-mode rule rather than after it.

  The same function feeds captureScrollAnchor, so both modes also gained
  anchored scroll restore across re-renders — which matters most in Discover,
  where cards are rebuilt as fetches land.

  Two things about the row that are easy to get wrong when testing it: it is
  mobile-only (`.jump-nav { display: none }` outside the mobile media query
  and `html.force-mobile`), so the is-active class alone says nothing about
  whether it is on screen; and at maximum scroll the last sections share one
  screenful, so paging back moves the index without moving scrollY.

  0.143.0 built a pill switcher for this instead — one section shown at a
  time — which was the wrong thing: the ask was for the bar Entries already
  had. It is gone, along with the Discover single-source fetching that only
  made sense while one card was visible.

- the Timeline's month summary is off by default and the Ledger's is on,
  which is not an oversight. The Ledger's shipped on and turning it off for
  everyone would be a change nobody asked for; the Timeline's is new, and
  adding two lines to every month card in the view by default is a change
  nobody asked for either. Both are computed only when shown — the work runs
  per month card per render, so the setting gates the groupBy, not just the
  markup.

  Neither draws for a single category: the month header already carries the
  count, and one line repeating it under a coloured dot is noise. That rule
  lives in monthCatRows (journal.js) and is why a Timeline month can have the
  setting on and still show nothing.

- Settings tab swiping does not wrap, while the bottom tab bar's stepMode
  does. A swipe is a nudge in a direction and jumping from Data to Media
  because you nudged once more is not what that gesture means; a tap on a tab
  you are already on is a discrete "next" and wrapping is what makes the whole
  set reachable. cycleMode makes the same choice as the swipe for the same
  reason.

- the rendering rework, start to finish. reconcile.js (0.129.0), the shared
  section plumbing (0.131.0), To-do (0.130.0), Notes (0.132.0), the Timeline
  (0.133.0), the Backlog (0.134.0), the Ledger (0.135.0), movement (0.136.0),
  the layout-cost pass (0.136.1), Discover (0.137.0) and leave animations
  (0.139.0). Two planned steps were dropped rather than built — View
  Transitions and render() losing its innerHTML clear — and DROPPED.md says
  why for both. The jump-nav carousel is the one thing still rebuilt
  wholesale, and it measured free.

  `epoch` is for a setting that changes a node's *root*, not its contents —
  adopt() handles contents. timelineCoverSize turned out not to need one;
  backlogCoverSize does, because it switches between two different root
  elements. See the 0.133.0 entry below.

  (Kept here rather than in TODO.md, where it sat until 0.143.0: nothing in
  it is work, and a to-do list is for things still to do.)

- Notes' bulk select reuses the timeline's machinery whole, with three
  adjustments worth knowing about. bulkActionBar's Move control became
  optional (it was unconditional) because a note has no category, and a
  permanently disabled dropdown is worse than no dropdown.
  attachLongPressSelect's "don't steal a long-press over text" guard gained
  `.note-text` alongside `.etitle` and `.bl-title`, so holding a note's body
  still selects the text. And createNoteCard takes the id as an argument
  rather than reading it off the node, for the same reason createEntryRow
  does: attachLongPressSelect binds once and captures `.id`, so it has to be
  the reconcile key, which is fixed for the node's life.

  The selected tint is kept in sync during a drag-paint by setBulkItem
  toggling `is-selected` on the checkbox's *parent*, not on a named card
  class. The skipRender path exists so a render can't detach the element
  mid-gesture, which means the class has to be set by hand there; going
  through the parent keeps app.js from naming a view's markup, and the class
  is inert on rows that don't style it.

- note -> entry copies rather than moves, and stores no link between the two.
  A note carries a moment (createdAt, to the minute); an entry is filed under
  a month. Deleting the note to "promote" it would throw the moment away, and
  a link field would go into a collection that syncs — which is a merge
  question, a UI question and a migration, to answer something use hasn't
  asked yet. The title/notes split is first line against the rest, capped at
  80 characters, and the cap keeps the whole first line in the notes field
  when it trips so nothing you wrote is lost on the way across.

- commitModeChange clears the bulk selection. A selection belongs to the list
  it was made in, and the Notes view's two modes (feed and To-do) are two
  different lists — selecting notes and switching to To-do previously left
  bulk mode on with no bar on screen to cancel it. switchToView already did
  this for tab changes; this is the same rule one level down.

- Finance's category ids are slugged from the name (`"Board Games"` ->
  `board-games`) while the journal's and the to-do list's call uid(). That is
  why Finance's duplicate check being case-sensitive (fixed in 0.141.0) was a
  sync bug and not a tidiness one: "Games" and "games" were two categories
  with one id, and the id is what mergeCollection matches on. Everywhere else
  a case-variant duplicate would just look silly.

  The slug also explains the comment in the rename path about deliberately
  keeping the old id. Renaming a Finance category changes the thing its id was
  derived from, so regenerating it would hand the category a new sync
  identity and orphan the copy on every other device. The name cascades
  across financeEntries and recurringExpenses; the id does not move.

  This divergence is the main reason the one-shared-category-modal refactor
  went to DROPPED.md rather than getting built.

- categories got a sanitizer in 0.140.0, and the hole was wider than the TODO
  entry that found it said. All three collections are in merge.js's
  COLLECTION_KEYS, so all three sync — but *none* of them was sanitized on
  load, and three of the five places that create one stamped the wrong thing:
  the journal's and Finance's add-category forms both wrote createdAt and no
  updatedAt, and journal.js's "Other" fallback wrote neither. Only
  ensureCategories (for a category a row names but the list lacks) and
  todoCategories, added later, were right.

  Without updatedAt, mergeCollection has nothing to tie-break on, so two
  devices that each added a category resolved arbitrarily.

  sanitizeCategory promotes createdAt to updatedAt where that is all there is,
  and falls back to the epoch where there is neither — deliberately, so any
  real edit on either device beats an unstamped one rather than the other way
  round.

  One thing to know when testing this: the localStorage cache written on first
  load is the *raw* fetched JSON. normalize() runs on the in-memory copy, and
  the cache only catches up from the first save onwards. That is benign — the
  cache is re-normalized on the next load either way — but it means asserting
  on the cache straight after a cold load reads pre-sanitize data and looks
  like a failure.

- leave animations landed in 0.139.0 after being filed as "only if a vanishing
  row starts to read as a glitch". The version that works takes the node *out
  of the flow* at the exact place it was sitting and fades it there, so the
  list closes up immediately and the survivors FLIP into the space while the
  leaver fades over it. Keeping it in the flow — the obvious implementation —
  means the list not closing until the fade ends, which reads as lag rather
  than as motion. That was the objection recorded against doing this at all,
  and taking it out of flow is what answers it.

  MAX_EXITS caps it at a handful. Filtering six hundred rows down to ten
  should not animate five hundred and ninety departures; past a few, exits
  stop being feedback and become a wave.

  The bulk bar is now one shared node held in app.js rather than one per view
  — there is only ever one on screen. Its per-view callbacks ride on the
  control nodes (`sel.__onMove` and friends) because the bar outlives the view
  that built it, which is the same problem Discover's rows have and the same
  answer.

  The jump-nav carousel is deliberately left alone: three nodes that slide as
  a unit, a transition:none/offsetWidth flush doing precise work, and a
  profile that says it costs nothing.

- three small gaps closed in 0.138.0, each with a decision in it:

  The To-do "No category" chip keys as "" — getFilteredTodos already read
  `cats.has(t.category || "")`, so only the chip was ever missing. It gets no
  ✎ because there is nothing to edit: it is not a category, it is where a
  to-do lands when it doesn't name one.

  The Notes + appears on the current month's card only. The old comment said
  there should be no + at all, because a note is stamped with the moment it is
  written and there is no such thing as adding one to March. That reasoning
  holds for *filing* and not for a shortcut — but a + on March's card that
  produced a September note would read as a bug, so it only shows where it
  means what it looks like.

  Early Access rides with the existing release pin rather than earning a pin
  of its own. MEDIA_FIELD_PINS already mapped the field to "release", and it
  is part of the same "what is the state of this release" answer as the date
  and the status. The override machinery in app.js turned out to be entirely
  generic — f.inputs just gets disabled/enabled — so a checkbox slotted in
  beside the two text inputs with no changes to it.

- Discover converted in 0.137.0, finishing the views, and it is the one that
  breaks the rule the other four established.

  Everywhere else a row's click handler resolves its item by id at click
  time, because a captured object goes stale when adopt() refills the node.
  Discover cannot: a result is not stored anywhere, `r` *is* the data straight
  off the network, and a refresh replaces the object behind a given id with a
  new one. So the current result rides on the node in a WeakMap and the
  handler reads it there. That is the exception, not a pattern to copy — if a
  future view can look its item up in state.data, it should.

  Rows are keyed by source + result id, not result id alone. Two sources can
  return the same id for different things and the cards share no key space,
  so the source has to be in the key.

  The card keeps the head/.backlog-list shape every other backlog section
  has, rather than being flattened into one reconciled list — the first
  attempt did flatten it, which silently dropped .backlog-list and the CSS
  that hangs off it.

- the Discover category filter (0.137.0) was a real bug, not a missing
  feature: discoverSourceMap() walked state.data.categories unconditionally
  and never looked at state.activeCats, so the chip row rendered above a grid
  it had no effect on. It now uses getFilteredBacklog's rule — an empty chip
  set means everything. The empty state had to split in two as a result:
  "you have not set up a source that publishes a list" and "nothing in the
  categories you narrowed to has one" are different problems, and only the
  second has a fix the reader can act on immediately (click the chip off).

- what 0.136.1's measurements ruled *out*, which is the more useful half and
  is easy to lose. At 4x CPU throttle over 611 entries, the browser's own
  counters put ScriptDuration at 24ms against RecalcStyle 136ms and Layout
  65ms. So: the app's JS is not the cost, and neither is parsing and
  compiling its 690KB across fifteen files — a plan to split the modules and
  load the optional ones late would have bought almost nothing. The cost is
  style and layout over 18,388 nodes, and the only way down is fewer nodes.
  TODO.md carries that as the virtualisation entry, with the numbers.

  Two other theories died the same way. The tab underline animating
  left/width was not why the bottom bar stuttered — the main thread was busy.
  And the idle trickle does not jank: one ~150ms frame across a whole 3s load
  at 4x, and that frame is the first render, not the trickle.

- 0.136.1 is a performance pass, and it was measured rather than guessed —
  worth recording, because two of the three obvious suspects were wrong.

  A CPU profile of one category-chip toggle over 611 entries and 250 backlog
  items put getBoundingClientRect at 318ms of a ~500ms busy window, with the
  browser's own layout time beside it. Not row construction, not the diff.

  Fix one: FLIP now only measures when the op list actually contains a move.
  A filter change, a search keystroke or a chip toggle produces inserts and
  removes — nothing moves — and the animation layer was measuring every row in
  every month card anyway. Arrivals are not gated by this, since the enter
  animation is a CSS class and costs no measurement. 318ms -> 186ms.

  Fix two: content-visibility: auto on .month-card and .backlog-section. The
  remaining 186ms was not many reads — instrumenting the page counted only 22
  layout reads in the whole toggle — but each one forced a full layout of a
  document holding 611 rows. Taking off-screen cards out of layout makes every
  one of those reads cheap. 186ms -> 2ms, and the browser's layout time
  dropped from 304ms to 85ms.

  contain-intrinsic-size uses the `auto` keyword so each card remembers the
  height it last rendered at; the 300px is only the first guess for a card
  never yet painted. Sticky headers survive it — .month-card h3 and
  .backlog-section-head both sit *inside* contained elements and were the
  obvious thing to break, so they are covered by their own test.

  What this also fixed, which is the part worth remembering: the bottom bar's
  lag. Measured frame intervals across four tab switches went from worst
  frames of 100ms and 300ms with 18 dropped, to zero dropped and a worst of
  16.8ms. The underline was never the problem — it janked because the main
  thread was busy laying out six hundred rows underneath it. See the entry
  below on why the underline is still animating left/width: that reasoning
  now has a measurement behind it rather than an assertion.

  The --year-head-h loop was also batched (all the reads, then all the
  writes). Small on its own — eight sections — but it was alternating read and
  write, which is the shape that makes a browser flush layout per iteration.

- the payoff, 0.136.0: reconcile() grew FLIP for moves and a fade for
  arrivals. Notes on the shape of it, because several parts look optional and
  are not:

  It is opt-in per call (`animate: true`), not global. Measuring costs two
  forced layouts per reconcile, and a container whose contents change
  wholesale — a chip row switching between category lists, a section list
  rebuilt after a filter — has nothing worth animating. Only the row-level
  lists opt in.

  It skips when the container is off-document. A view holds its root across a
  render now, so reconcile runs while detached, where every rect reads zero
  and the "movement" would be the whole list flying in from the corner.

  A node already mid-animation has its FLIP cleared before being measured,
  otherwise the second measurement reads a position part-way through the
  first transition and inverts against its own transform.

  Removals are deliberately not animated. Holding a node in the flow while it
  leaves means the list doesn't close up until the animation ends, and every
  caller's bookkeeping would be briefly out of step with the DOM. A row
  vanishing is much less jarring than a row teleporting, which was the actual
  complaint.

  Two loose ends. The chip rows are reconciled but not animated — chips
  jiggling as you type is noise, not feedback. And buildYearFilter and
  buildCatFilter no longer clear their container: they used to open with
  `wrap.innerHTML = ""`, which handed reconcile an empty container every time
  and made its stale-node guard rebuild everything. That was the whole bug
  behind "chips rebuild on every keystroke" surviving the first conversion
  attempt.

- the tab underline was going to move from animating left/width to a
  transform, listed as a free win. It isn't one, and it is not being done.
  updateTabUnderline sets left/width directly and the live drag-follow morphs
  the same two properties as a 0-1 progress fraction toward a measured target
  box, so both would have to be rewritten together — and scaleX on a 2px bar
  with a border-radius distorts the radius as it stretches. Real work and a
  visual risk, for a bar that animates on a tab switch.

- the Ledger converted in 0.135.0, finishing the list views. Three things
  particular to it:

  A row's click has to resolve through getEffectiveFinanceEntries(), not
  state.data.financeEntries, because a recurring occurrence is *generated* and
  isn't stored anywhere to look up. Whether a row is virtual is fixed for the
  life of its node — a generated occurrence keys as `${rec.id}:${n}` and a
  real entry as a uid, so the two key spaces are disjoint and a key never
  changes sides. That invariant is what makes it safe for createFinanceRow to
  decide at create time whether to attach the long-press.

  The month total is the one node built in create() and updated in place
  rather than refilled. animatedNumberText counts it up over ~550ms, and
  adopt() replacing the span it animates would cut that off on any render
  landing mid-flight. Everything else in the card is refilled as usual.

  The month's category breakdown and its total ride in the same keyed list as
  the rows, under __cats and __total, the same reserved-key trick To-do's
  header and the Backlog's band separators use. Worth knowing because they are
  easy to lose: they sat *after* the row loop in the old build, so a
  conversion that only moves the rows drops them silently — which is exactly
  what happened on the first pass here, caught by asserting the breakdown and
  total are still on screen rather than only counting rows.

- Backlog converted in 0.134.0 — Entries and Next releases. It is the view the
  plan called the intricate one, and it earned that in three specific ways:

  backlogCoverSize IS an epoch, where timelineCoverSize turned out not to be
  (see 0.133.0 below). backlogRow dispatches to backlogRowRich and the two
  return *different root elements* — div.entry versus div.backlog-item-rich —
  so a reused node would be the wrong element wearing the right data. That is
  the distinction: an epoch is for a setting that changes a node's root, never
  for one that only changes what is inside it. rowShapeFor() returns the root
  class and doubles as the epoch value, so the two can't drift apart.

  Band separators ride in the same keyed list as the rows, keyed "sep-<band>".
  Bands are ordered and a boundary into a given band happens at most once per
  list, so those keys are unique. Left unkeyed they would drift out of place
  the first time a row crossed a band — which is exactly what starring
  something does, so this was not a theoretical worry. A separator's class is
  fixed by its key, so it needs no update() at all.

  All three row builders (backlogRow, backlogRowRich, upcomingRow) ended in
  the identical two lines binding row.onclick and attachLongPressSelect. They
  now share createBacklogRow, which binds by id. attachLongPressSelect keeps
  taking a bare { id } for the reason given under 0.133.0.

  Discover is deliberately NOT converted. Its rows come from the network and
  turn over wholesale on each fetch, so keyed reuse buys nearly nothing there,
  and it is the one backlog surface with no editing, no reordering and no band
  to cross. TODO.md carries it as its own small item rather than leaving it
  looking forgotten.

  Worth knowing when reading the tests: the separator *count* follows the bands
  present, not the row count — Games spanning bands 0, 1, 3 and 4 has three
  separators. The invariant to assert is that no band separator appears twice,
  which is what an unkeyed one would do.

- Timeline converted in 0.133.0, to the Notes template exactly: view root held
  across renders, `keepBody` sections, month cards keyed year-month, rows keyed
  by entry id. Three things it settled that are worth not re-deriving:

  entryRow had the same stale-handler bug noteCard did — `row.onclick` closed
  over the entry — and it is fixed the same way, in createEntryRow, by id.
  attachLongPressSelect, sitting right beside it, is *not* a bug: it only ever
  reads `.id`, and a node's id is fixed by the key it is reconciled under, so
  handing it a bare `{ id }` is correct. Don't "fix" it.

  timelineCoverSize does NOT need an epoch, which the plan predicted it would.
  An epoch is for a setting that changes a node's *shape*; this one changes
  what is inside the row, and the row root is `div.entry` either way. adopt()
  handles the contents. Same for bulk mode adding a checkbox child. The epoch
  is still the right tool where the *root* differs — To-do's reorder rows are
  the real case, since they carry different listeners.

  Cover images are rebuilt on every refill, because adopt() replaces children
  wholesale. The row surviving is what matters for animation, so this was left
  alone rather than special-cased; a cached image costs a decode, not a
  download. TODO.md carries it in case it ever shows up in a measurement.

  One testing note: month-card counts are timing-dependent. Sections build
  lazily, so a year below the fold arrives on the idle trickle a beat after
  load — assert on the settled count, not the one immediately after render.

- Notes converted in 0.132.0, and it is the template the remaining three
  views copy: hold the view root across a render, mark each section
  `keepBody`, and reconcile month cards by `year-month` and rows by item id.

  It also caught the hazard that the To-do conversion got away with by luck.
  noteCard bound `card.onclick` and `card.onkeydown` on the card *root*,
  closed over the note object. adopt() carries attributes across a refill but
  not properties, so a reused card kept a handler pointing at the note as it
  was when the card was first built: edit a note, click it, and the pre-edit
  text opened. It is now bound once in createNoteCard and resolves the note by
  id at click time, which cannot go stale.

  To-do never hit this because all its handlers sit on children (the
  checkbox, the text, the ✕), and children travel with childNodes. Anything
  bound to a row's own element is the thing to check when converting Timeline,
  Backlog and the Ledger.

  One consequence of `keepBody` worth knowing: a reused section whose body is
  no longer cleared shows the *previous* render's rows until its build() runs.
  Off-screen sections are built by the IntersectionObserver and the idle
  trickle within a second or two, so the window is short, and stale-but-present
  reads better than the blank a cleared body left. It does mean a deleted item
  can linger briefly in a section you cannot see.

- the section contract changed shape in 0.131.0: build() now takes the body
  element to fill, `build(bodyEl)`, instead of closing over the one it was
  created beside. This looks like a pointless parameter — it is the whole
  reason section reuse is possible.

  A section used to be built as a fresh block/head/grid trio with
  `build: () => { ...grid.appendChild(card) }` closing over that fresh grid.
  Reuse means keeping the *previous* render's node, so its build() would have
  been filling an element that had already been thrown away. Passing the body
  in lets renderLazySections hand it the surviving one.

  Two things fell out of this that are worth knowing before converting a view:

  renderLazySections reconciles by section key now, but every view still hands
  it a root that render() cleared on the way in, so reconcile finds an empty
  container and does exactly what the old append loop did. That is deliberate
  — it means this could land ahead of any view conversion. A view starts
  benefiting the moment it holds its root across a render, the way To-do does.

  reconcile() drops a remembered node whose parentNode is no longer the
  container. Without that guard, a container that someone else cleared (which
  is what render() still does to #viewBody) would have its old detached nodes
  re-inserted, resurrecting stale content. Note the guard is about the
  container being *emptied*, not about the container itself being detached: a
  whole subtree parked off-document is still internally intact, which is
  exactly what lets a view hold its root.

  `keepBody` on a section is the opt-out for a converted view:
  renderLazySections clears a reused body before build() refills it, which is
  right while build() appends, and wrong the moment build() reconciles.

- the rework's phase order was wrong, and this is where it was corrected.
  render() dropping `#viewBody.innerHTML = ""` was planned as the keystone
  every view conversion would build on. It is actually the *last* step, not
  the first: views append a mix of things into that root (a toolbar, an empty
  state, a bulk bar, the section container) with no keys, and their build()
  closures pointed at fresh nodes. Nothing could reuse anything until each
  view owned its own subtree. So each view converts independently — To-do
  already has, via a root it holds across renders — and the clear comes out
  at the end, when nothing is left relying on it.

- To-do is the first view rendered through reconcile.js (0.130.0), and it went
  first because it is the smallest one whose interactions are the nastiest: a
  long-press that swaps every row for a different kind of row, and a drag that
  rearranges the DOM itself and only then asks for a render.

  Four things in there that will read as arbitrary from the outside:

  The card's header, its "Nothing here."/"All done." note and the done
  separator ride in the *same* keyed list as the rows, under reserved keys
  (__head, __note, __sep). The alternative was a wrapper element around just
  the rows, which would have meant new CSS for a shape that already works.
  Reserved keys keep the card's DOM exactly what it was. The Backlog's band
  separators want the same trick when that view converts.

  Open rows and done rows are keyed by the to-do's own id, not by which group
  they are in. That is the whole point of the release: ticking one is then a
  *move* across the separator rather than a delete above it and an insert
  below, so there is a surviving node to animate later.

  reordering is a per-panel epoch (reorderMode && open.length > 1), not a
  global one. A panel with one open row has nothing to reorder and keeps its
  nodes while its neighbours rebuild — which is correct, and is why a test
  asserting "everything rebuilt on long-press" would be wrong.

  todoRootEl is held across renders on purpose. app.js still clears #viewBody
  on its way through, and clearing a parent detaches these nodes without
  destroying them, so holding the reference and appending it again is what
  lets the whole subtree survive. That prop goes away when render() stops
  clearing; until then, removing it silently un-does this release.

  One rule the module now depends on: element-level listeners live in
  create(), never update(). update() works by adopting a freshly built node's
  contents and dropping that node, so a listener bound there would be bound to
  the discarded element and leak one per render.

- src/reconcile.js (0.129.0) is deliberately two halves in one file. diffKeys
  is pure — key lists in, ops out — so it runs under the existing Node
  harness, which has no DOM; reconcile() is the thin part that applies those
  ops with insertBefore. That split is why the interesting logic has tests at
  all, and it's worth keeping as views convert onto it.

  Three decisions in there that look arbitrary and aren't:

  Keys are item ids, never object identity. merge.js rebuilds every
  collection from a Set of ids on each sync (see the mergeCollection entry
  below), so the objects do not survive a reconciliation between two devices.
  Anything keyed on identity — a WeakMap of item to node, or a signals/proxy
  layer — would silently detach the first time two devices met. That is also
  the reason this is a reconciler and not fine-grained reactivity.

  The longest-increasing-subsequence pass isn't premature cleverness. It's
  what makes one row dragged to the front report as one move instead of five,
  and the animation layer drives straight off the op list, so a sloppier diff
  would animate the whole list for a one-row drag.

  The insert loop walks backwards and re-checks the live DOM
  (node.nextSibling !== anchor) rather than trusting its own recorded order.
  The to-do drag reorders rows under the finger with insertBefore and only
  then asks for a render, so the DOM is legitimately ahead of what the last
  reconcile recorded. Reading the DOM makes that self-correcting instead of a
  bug.

  Two rules callers have to know: element-level listeners belong in create(),
  which runs once per node, never in update(), which runs on every render —
  adopt() keeps the existing node and drops the freshly built one, taking its
  listeners with it. And a setting that changes a row's *shape* rather than
  its content has to go through `epoch`, or a reused node is the wrong node
  wearing the right data.

- #todoCatModal is the third add/edit-category modal (0.128.2) — the
  journal's, Finance's, and now this. It is deliberately the simplest of the
  three: a to-do category cascades to one collection, and there is no "Other"
  for orphaned to-dos to land in, so deleting one just clears the field and
  they fall into the general panel. TODO.md carries the note that these three
  want one parameterised modal; writing that abstraction across three modules
  mid-change was the riskier move, so this is a knowing third copy.
  buildCatFilter now picks between three (list, active set, edit handler)
  triples rather than two. Todos.wire() is split from Todos.init() for the
  same reason every other module splits them: init runs in the Node tests,
  which have no DOM.

- to-do categories are a third category collection, state.data.todoCategories
  (0.128.2), alongside the journal's and finance's, in COLLECTION_KEYS like
  both. They started out sharing the journal's list, which was wrong on its
  own terms: "Errands" says nothing about what you watched. normalize runs
  ensureCategories over the to-dos that carry a category, which both fills
  the list on first load and carries across the to-dos that briefly named a
  journal category. Unused ones aren't pruned — pruning on load is a write
  that two devices can disagree about, and an unused category costs a line in
  a picker and no panel at all.
  Creating one from a picker needed a re-render, not just a push: the select's
  options are built when it is, so it has no option to select for a category
  that didn't exist a moment ago, and the value silently fell back to "".

- the reorder slide is FLIP (slideDisplaced, todos.js, 0.128.2): measure
  every row's top, do the insertBefore, put the moved ones back where they
  were with a transform, then release it and let CSS carry them home. Two
  requestAnimationFrames before releasing, not one — in a single frame the
  style change coalesces with the move and nothing animates at all. The
  dragged row is excluded on purpose: it is the one under the finger, and
  animating it would be lying about where it is. The transition is .17s
  because it has to finish before the finger reaches the next neighbour's
  midpoint.

- a `<select>` swapped in on click has to be told to open (catChip, 0.128.2).
  focus() alone leaves it shut on both desktop and phone, so the category dot
  read as a control that did nothing until you clicked it a second time;
  showPicker() in a try/catch is the whole fix, and where it isn't available
  the focused select is exactly where this started.

- the to-do long-press could never have fired (fixed 0.128.1). Its
  pointerdown skipped `.todo-text, .todo-check, .todo-del` "so the text can
  still be long-pressed to select or copy" — but a row *is* a checkbox, its
  text and a ✕, so every press hit an exemption and only the few pixels of
  row padding were live. The exemption list is the two controls now, and
  .todo-row carries user-select: none so a held finger doesn't start a
  selection instead. Worth remembering as a shape: an opt-out list that
  covers every child is an opt-out of the whole feature.

- to-do panels are per category, each with its own completed tail
  (panelGroups + panel in todos.js, 0.128.1). Two things that needed care:
  `order` is one field across every panel, so commitOrder deals the dragged
  panel's *existing* order values back out in the new sequence rather than
  renumbering 0..n, which would collide with another panel's; and the
  completed rows are left out of the card while it is being reordered,
  because the drag walks .todo-row midpoints and a finished row would be a
  place to drop something that then can't hold where it was dropped.
  A to-do naming a category the app no longer has still gets a panel — the
  alternative is a to-do that exists but is on no screen.

- the wheel draws its own palette, not CATEGORY_PALETTE (0.128.0). That ramp
  runs deep red to pale lime and is built for a 10px dot beside a name;
  eight filled wedges of it read as a fairground prize wheel dropped into a
  quiet dark app, and its lightness range meant the label ink flipped between
  black and white slice to slice. OWN_COLORS in wheel.js is one family at a
  shared lightness — every one dark enough for white type, so the labels stop
  flickering between inks. Backlog spins still pass their own colours, which
  carry category meaning. The wheel is a ring, not a pie: the hub used to sit
  on the point where every wedge meets, which is the busiest part of the
  drawing and the one place no label can go.

- MODE_MIGRATIONS in app.js (0.128.0) is the mode-level twin of
  UI_MIGRATIONS: `backlog.category -> entries`. Without it the stored value
  fails the modeIds check and the view falls back to its first mode — the
  same screen here, so it would have looked correct by luck rather than on
  purpose, and the next rename would not be so lucky.

- the Journal / Finance grouping is gone entirely (0.127.2), markup
  included. It survived one version as two `.tab-group-label` spans that the
  phone block restyled into a 1px divider, which is why the desktop rule read
  `display: none` rather than the elements simply not existing. At four tabs
  split three and one there was nothing left to group.

- #modeSlot moved inside #content, under the filterbar (0.127.1). It was
  chrome above the filters for one reason: it held the mode switch, and the
  switch decided which chips showed, so a press moved it ~100px out from
  under the pointer. With the switch on the tab, what's left in the slot (the
  Notes count, the Backlog's Spin and Pick random) changes no filters, so it
  can sit where it belongs — under the chips, above the list, travelling with
  the mode it describes. placeFilterbar inserts the filterbar before the
  slot, not before #viewBody, or Notes would put its count above its years.

- `.backlog-mode-bar > :only-child { margin-left: auto }` (0.127.1): the bar
  is space-between, which held the switch at one end and the Pick random /
  waiting count at the other. With the switch gone to the tab, the survivor
  is usually the bar's only child, and space-between puts a lone child at the
  *start* — so everything silently moved left. Discover is the exception that
  still has two children, and it is the position the others are matching.
  🎡 Spin joined Pick random there and left the + menu; the wheel's custom
  mode (openWheel({custom:true}), the Edit button, loadSaved) has no caller
  now — dead until it is given a home or removed.

- the mode switch is on the tab on both layouts (0.127.0): held on a phone
  (openModeFan), hovered on a desktop (openTabMenu). Nothing above the
  content any more — the slot keeps only what isn't the switch, which is the
  Notes count and the Backlog's Pick random. Three things this needed:
  the tab menu is appended to the .tab, not to #viewTabs, because .tab is
  the positioned ancestor and `min-width: 100%` against the nav made every
  menu span the whole bar; both the menu and the fan measure themselves after
  append and pull back inside the window, since an edge tab would otherwise
  push half a label off screen; and the phone's .topbar had to go to
  z-index 40, not the bottom bar inside it — z-index: 20 on .topbar makes it
  a stacking context, so the fan could not paint over .fab-wrap (35) no
  matter what value the fan itself carried. That one only showed up in a
  screenshot; every declared z-index looked right.
  The fan lists the tab's own mode as well now, nearest the thumb, so the
  shortest slide gives what a plain tap would have.

- four tabs, each pairing a list with a second reading of it (0.126.0):
  Notes/To-do, Timeline/Stats, Backlog's three, Ledger/Summary. Stats and
  Summary were tabs of their own, but render() already read
  `const entries = getFiltered(); … renderTimeline(c, entries) : renderStats(c,
  entries)` — same filtered set, same chips, same empty states, differing in
  the final call. They were modes wearing tab buttons, so merging them was
  mostly deleting an `if`. Notes/To-do went the other way for the same
  reason: separate collections that carry no category, so Timeline's filter
  bar appeared and disappeared as you swiped its modes. Now each tab's chrome
  holds still across its own modes. It also makes the fan and the dots
  universal rather than a gesture that works on two tabs out of five — and
  gives Stats and Summary a swipe from the list they aggregate, which is the
  whole point of them.
  The cost, taken knowingly: Stats and Summary are a second tap rather than a
  first. The migration in applySavedUi is the part that could have bitten —
  `state.view` came straight off a stored string with no validation, so the
  old "stats"/"finance-stats"/timelineMode:"notes" values had to become
  (view, mode) pairs or those devices would have reopened onto nothing.

- switchToView resets the mode of the view it is leaving, and is the only
  place that does. The dots under an inactive tab are a promise about what
  tapping it does, and a remembered mode broke that promise: Backlog's dots
  said Next releases while a tap landed in By category. Resetting on the way
  out rather than on the way in is what lets activateTab stay a plain
  switchToView, and leaves the fan alone — the fan sets the mode of the view
  it is switching *into*, which this never touches. The cost, taken
  knowingly: an inactive tab's dots now only say how many modes it has.

- a tab press has three meanings, resolved in one place (activateTab /
  stepMode / the .tab onclick, app.js): another tab is that view in its own
  mode; the current tab scrolled down is back to the top; the current tab
  already at the top is the next mode. The third only exists because the
  second had nothing to do there. stepMode wraps where a swipe doesn't — a
  swipe has a direction, so its ends are ends, but a tap has none and would
  go dead on the last mode, which is exactly where you'd tap again.

- the mode dots under a tab are absolutely positioned, not another row in
  its flex column (.tab-modes, styles.css). The tabs stretch to a shared
  height and each centres its own contents, so an extra row in flow on two
  tabs out of five lifted their icon and label out of line with the other
  three — measured, not guessed. They take currentColor, which is what makes
  an inactive tab state its mode quietly and the active one state it in the
  accent, with no second rule. Built on every layout by updateTabModeDots
  and hidden by CSS off the phone, so toggling the forced layout can't leave
  a stale row behind.

- the fan carries the tab's view, not just its mode spec (closeModeFan,
  app.js). Long-pressing a tab you aren't on is ordinary, and the pick has
  to switch views as well as set the mode — commitModeChange alone rerenders
  wherever you already were. Its sibling: fanConsumedClick is cleared on the
  next pointerdown rather than only when a click arrives, because a release
  on a fan item is a release off the tab and synthesises no click at all, so
  the flag latched and swallowed the next real tap.

- the phone's mode switch is a fan off the tab bar, not a row on the page
  (openModeFan/armModeFanAt/closeModeFan, app.js). A long-press on the tab
  raises the other modes above it; a slide arms whichever one is under the
  finger via elementFromPoint, and release takes it. Four things this had to
  get right: the fan is appended to #topbarBottom rather than the tab row,
  so it clears the jump-nav strip instead of landing on it; the pointerup
  that ends a long-press is followed by a synthesised click on the tab, so
  fanConsumedClick swallows exactly one; the move/up listeners live on
  window, registered once outside the per-tab loop, because the finger
  leaves the tab as soon as the fan is up; and .views went from
  touch-action: pan-y to none, since the upward slide would otherwise be
  handed to the browser as a scroll. renderTimelineModeBar and
  renderBacklogModeBar return early on a phone rather than the CSS hiding
  them, so the same control is never built twice.

- the mode switch lives in #modeSlot, chrome between the topbar and the
  filterbar, rather than in #content. The filters are a consequence of the
  mode (categories and years hide themselves in Notes and To-do), so a
  switch below them moved 201 -> 125 -> 100px as you pressed it — measured,
  not guessed. Both Timeline and Backlog render their whole bar into the
  slot, Backlog's extras included; app.js clears it each render and hides it
  for a view with no modes. It also simplified the animation: with the bar
  outside #content, a mode change animates #content whole, exactly like a
  view change, instead of per-child-except-the-bar.

- the swipe drags #content with the finger (modeDragMove/Settle/Commit,
  app.js) rather than animating after release — the page sitting still
  through the gesture and then moving on its own read as two movements
  where the hand made one. Commit carries on in the same direction for
  130ms, then --mode-enter-x tells the incoming keyframes to start from
  where the outgoing content left the screen, so the halves join up. A
  button press leaves that property unset and gets the small 16px default:
  there was no travel to continue. The property is cleared on animationend
  so a swipe can't leak its distance into the next button press.
  Resistance past the last mode is 0.25 rather than a hard stop, and the
  commit threshold is 60px rather than the tab bar's 40 — this shares a
  surface with the page's own scrolling.

- the mode-change animation reads its direction from the mode indices
  (fadeInOnViewChange, app.js) rather than being told which way it went, so
  a swipe, a tap on the switch and the Backlog's own bar all animate
  correctly without any of them knowing the animation exists.
  It's applied per child of #content, skipping .backlog-mode-bar: the bar
  lives inside #content, and animating the container would slide the switch
  out from under the finger that just pressed it. That also means it has to
  run after the content exists, which is why it's a pending class played in
  render()'s finally rather than done in fadeInOnViewChange itself — and why
  it re-reads $("#content") there, since the `c` above is scoped to the try.

- body has overflow-x: clip because the mode slide translates #content
  sideways, and content past the right edge makes the *document* wider than
  the viewport: the page becomes horizontally scrollable, the layout
  viewport grows, and the fixed bottom bar — which is sized to that viewport
  — grows and shifts with it. Measured at 395px wide on a 390px screen
  mid-animation. `clip`, not `hidden`: hidden would make body a scroll
  container and every sticky year/month header in the app sticks through
  here.
  Only reproducible with real touch events (CDP Input.dispatchTouchEvent)
  and a screenshot — getBoundingClientRect on a mouse-driven drag showed
  nothing wrong, which cost two rounds of chasing the wrong thing.

- render()'s `inPlace` is view *and* mode: a mode change is a new page, not
  an in-place re-render, so it must not restore the scroll offset. It used
  to, and the offset meant nothing in the new mode — the browser clamped it
  to whatever fitted, which landed differently every time depending on the
  two modes' heights, so the page appeared to lurch under the fixed bars by
  a different amount each switch. It also no longer *leans* on that clamp
  for landing at the top: a non-in-place render scrolls to 0 explicitly,
  because the clamp stopped being reliable the moment #content had a
  min-height and a filterbar of its own to stand on.
  Worth remembering that "the navbar jumps" was the symptom and the scroll
  restore was the cause; the jump-nav's height change is a real but separate
  thing, and chasing it first cost a round trip.

- where the filterbar lives is decided per view by placeFilterbar()
  (0.126.1); #viewBody is the thing a render actually clears either way. It
  went inside #content in 0.123.0 because Timeline's chips changed between
  its modes, so a bar outside would have sat still while everything it
  filtered slid sideways. The four-tab layout took that reason away
  everywhere but Notes: Timeline, the Backlog and the Ledger each filter
  both their modes by the same things, so sliding those chips was movement
  that said nothing. Notes keeps it inside (chipsVaryByMode on its spec) —
  its years come from the notes and To-do has no chips at all.
  Two specificity traps in doing it, both from the phone rules being
  `html:not(.force-pc) .content`, which outranks a bare second class: both
  `.content.no-filters` and `.filter-slot:empty` needed phone-scoped twins or
  the padding stayed and the gap doubled. The mode swipe is attached to the
  slot as well as #content, so a drag starting on the chips still moves the
  view behind them.
  Its own visibility is JS (updateFilterbarVisibility) rather than a :has()
  rule; nothing else here leans on :has(), and both builders can be the one
  that empties it.

- timeline entries sort byNewestAdded within a month (journal.js), matching
  the Ledger. They previously had no explicit order, which looked stable —
  new entries are pushed to the end — right up until a sync, because
  merge.js rebuilds each collection from a Set of ids and reshuffled the
  month. Same reasoning as the finance rows' createdAt tiebreaker, and the
  same trap: array order is never durable in this app.

- to-do hand ordering is an `order` field, not array position: a sync merge
  rebuilds every collection from an id set (mergeCollection), so array order
  doesn't survive a round trip between devices. assignMissingOrder runs in
  normalize and numbers anything from before the field by createdAt — the
  order it was already displayed in, and a pure function of the data, so two
  devices deriving it independently can't manufacture a conflict.
  commitOrder renumbers sequentially from the DOM rather than fractionally.
  It marks every moved row changed instead of one; on a list this size
  that's a few hundred bytes of sync against a whole class of
  drifting-float bugs.
  The drag listens on `window`, deliberately not via setPointerCapture on
  the row: insertBefore *moves* the row, which counts as a removal, and a
  captured element that leaves the DOM loses its capture. The first version
  did capture and the list shuffled by exactly one position and then went
  dead — pointerup landed somewhere else and nothing was ever saved. It
  looked like a geometry bug for a while; it wasn't.

- To-do (src/todos.js) is the Notes tab's second mode (it was Timeline's
  third until 0.126.0), and deliberately not part
  of Backlog: a backlog item is something you mean to experience and it
  graduates into the log when you finish it, while a to-do is ticked and
  stops mattering. Different endings, different lists.
  `done` is dropped rather than stored as false, like every other flag.
  doneAt is separate from createdAt because the Done panel sorts by when you
  ticked it — a to-do written first is easily finished last — and a to-do
  ticked before doneAt existed falls back to its own updatedAt so it still
  sorts somewhere. Editing is inline rather than a modal: a to-do is one
  line, and a modal to fix a typo in one line is more ceremony than the line
  is worth. An emptied edit box is a cancel, not a delete; deleting is the ✕,
  which skips the confirm because Settings → Recently deleted has it.

- swipe-between-modes (attachSwipe's requireHorizontal, app.js) shares a
  surface with the page's own vertical scrolling, which is why the gesture
  has to prove it's horizontal *before* it takes the pointer — capturing on
  any movement, as the tab-bar swipe does, would swallow the scroll. A
  gesture that starts vertical is abandoned outright rather than watched: a
  scroll that drifts sideways halfway down the page is still a scroll.
  Three things had to be true for it to work, and only the first is obvious:
    - touch-action: pan-y on .content, or the browser claims the gesture and
      the swipe fires only by accident;
    - the selection is cleared when a swipe is recognised — a drag across
      text leaves one behind, and the next pointerdown landing on it is a
      drag of *that*, which ate every second swipe;
    - .content has a min-height, because the handler is on .content and on a
      short view (empty To-do, a Discover card 300px tall) a swipe in the
      lower half of the screen was landing on <html> and doing nothing.
  VIEW_MODES reads Backlog.MODE_IDS rather than restating the backlog's mode
  list, so a swipe and its own bar can't disagree about what comes next.
  No wrap at the ends, matching the tab swipe.

- Notes (src/notes.js) started as Timeline's second mode, on the reasoning
  that the phone's bottom nav was full — the same reason Discover became a
  mode of Backlog. 0.126.0 gave it a tab of its own once Stats and Summary
  freed two slots; see the entry on the four-tab layout for why that pairing
  was wrong. The mode bar is still rendered by app.js *before* any mode
  draws, because a view's empty state returns early — drawn inside it, the
  switch would strand a new user in a mode with no way out.
  editedAt is deliberately not updatedAt: stampChangedItems touches
  updatedAt on any content change at all, so "edited" would start meaning
  "a migration ran". saveNoteFromForm sets editedAt only when the text
  actually differs, so reopening a note and pressing Save leaves it alone.
  noteDate falls back from createdAt to updatedAt because a hand-edited or
  badly imported note still has to land in a year rather than vanish.
  `notes` in COLLECTION_KEYS is what buys merge, conflict resolution and
  undelete; there is no notes-specific sync code at all.
  The category chips are hidden in this mode via .filter-group[hidden],
  which has to be said explicitly — .filter-group sets display:flex, and
  that outranks the UA stylesheet's [hidden] rule. Caught in the browser,
  not by a test.
  No bulk select and no per-month "+": a note is stamped with the moment
  it's written, so there's no such thing as adding one to March.

- Early Access, off Steam's genre id 70 (steamEarlyAccess in media.js) — a
  genre, not a flag, and matched by id because `description` is localized.
  Its *absence* is the meaningful half: Steam removes the marker at 1.0, so
  mergeRelease lets a later source drop the key and applyItemRelease (sync.js)
  turns a dropped key into a deleted field, which is what makes the flag
  clear itself. Requires the proxy to ask for `genres` — an older deploy
  states nothing either way, which steamEarlyAccess returns as {} rather
  than false so it can't wrongly clear a flag.
  Early Access items were added to the re-check set in sync.js but
  deliberately not to isAwaitingRelease: they'd land in Next Releases with
  no 1.0 date to sort or group them by.
  They also get their own band in bandOf, between released and unreleased.
  An EA game whose EA launch is still ahead of it stays in the unreleased
  band — isUnreleased is checked first, since you can't start that one
  today either. backlogCountEl splits into the same bands in the same order
  (dropped, then unreleased, then EA off what's left), so nothing lands in
  two asides at once.

- data.appVersion is the newest build that has ever written the file —
  maxVersion in merge.js, raised in persist() and carried across
  mergeAllSources (which builds a fresh object, so a root key not copied
  there is a root key lost). versionBehind() in app.js compares it to
  APP_VERSION; the storage line says so for as long as it's true and
  noticeVersionSkew toasts once per version noticed.
  Deliberately advisory: it refuses no load, drops no merge and blocks no
  save. keepUnknown is what actually protects the data now, so the guard's
  only job is telling you a device needs updating. A blocking mode would
  have to be worth losing offline edits for, and it isn't.
  compareVersions parses parts as numbers because "0.9.0" sorts above
  "0.116.0" as a string, and treats junk as 0 so a hand-edited file can't
  claim to be from the future and lock a device out of its own warning.

- every sanitizer now ends in keepUnknown (app.js): the whitelists stay, but
  anything they don't name is copied through instead of dropped. They were
  the reason a phone left on a cached older build deleted the earlyAccess
  flags — and mergeCollection compares content, not timestamps, so that
  deletion won on every device. Only protects fields added from 0.116.0 on;
  nothing can retroactively teach an older build about a newer field, which
  is what the version guard below is for.

- the service worker's update is announced rather than waited for:
  watchForUpdate (app.js) listens for a worker reaching `installed` while
  another already controls the page — an update, not a first install — and
  shows #updateBar. By then the new shell is already cached, so a plain
  location.reload() picks it up. Deliberately never automatic.

- Discover's Early Access badge costs two requests per title (RAWG's store
  links, then Steam's genres), so it's cached per RAWG slug for a week in
  lifelog-discover-ea-v1 and only runs for rawg-steam-gg with a proxy set.
  A game with no Steam page is cached as `false` on purpose — without that
  every repaint would re-ask a question that has no answer. Only the
  *visible* rows are enriched: a title you already own is filtered out, and
  asking about it would buy a badge nobody sees.

- releaseStateOf (backlog.js) is the single answer to "what state is this
  in": ready / early-access / waiting. bandOf, backlogCountEl and
  eligibleForPick all read it instead of each asking their own version —
  which is how an announced show with only a nextAt ended up in the ready
  band while the header counted it unreleased. isAwaitingRelease stays
  separate on purpose: "worth re-asking" is a different question from "can
  I start it", and a mid-season show answers them differently.

- the category header wraps the count onto a second line rather than
  ellipsing the name. Dot and name live in .backlog-section-title so the dot
  can't wrap away from the name when that happens; the floor that triggers
  the wrap is .backlog-section-title's min-width.

- Discover's "you already have this" check compares titleKey(), a new pure
  helper in media.js: case/accents/punctuation/spacing/& folded away, "3rd
  Season" folded into "Season 3", and a trailing season/book/part marker
  turned into a *number* rather than dropped — no marker counting as 1, so
  "Attack on Titan S1" keys the same as "Attack on Titan" while "Slime
  Season 4" keys differently from "Slime". That last part is the whole
  point and is easy to get wrong: stripMediaSearchSuffix in journal.js drops
  the number, which is right for feeding a search and would be wrong here,
  since an owned first season would then hide an unseen fourth. Tested in
  test/media.test.js (6 cases, including the differ() ones).
  The owned set is built once per render (discoverOwnedIndex) rather than
  rescanned per row.

- Discover draws a card only where there is something in it or something the
  reader can act on: discoverSourceMap's second map is `needsKey` (sources a
  RAWG key away from a list) rather than "everything that can't answer".
  Open Library / Google Books / MusicBrainz fall out of both maps and get no
  card — there is nothing to be done about books having no charts, so the
  note was pure clutter. The all-empty message had to change with it: a
  source can now be set and still produce nothing

- Discover covers every category that has a source set, not just the ones
  that can answer. discoverSourceMap returns two maps — the sources with a
  list, and the configured ones without — so an unsupported source gets a
  card explaining itself instead of silently not being there. DISCOVER_STANDIN
  maps steamgriddb/steamgriddb-steam-gg/steam onto RAWG when a RAWG key is
  set, carrying the "-steam-gg" tail over so an added game still resolves to
  a Steam App ID and still gets its price

- "Hide what I have" (state.visual.discoverHideOwned, device-local) filters
  Discover rows through the same discoverOwnedTag test the tag uses, so the
  two can't disagree, and reports the count it dropped

- the kind bar's toggle and Refresh live in one .dsc-bar-right group: the bar
  is justify-content:space-between, and hanging a third item off margin-left
  auto pushed Refresh off the edge of a phone instead of wrapping

- RAWG could not be reached from the dev sandbox at all (api.rawg.io fails
  DNS/CORS there while TMDB, AniList and Open Library are fine), so the RAWG
  discover URLs — /api/games with dates + ordering=-added — are written from
  the docs and have never run against the live API. TMDB and AniList are
  confirmed working. If a RAWG-backed card ever comes back empty with a key
  set, that URL is the first thing to check

- Discover is the Backlog's third mode: per-source "Popular now" / "Coming
  soon" lists, driven off mediaCategorySources so there's no second place to
  configure sources. media.js grew a `discover(source, kind, keys)` beside
  `search`, returning the same normalized rows — which is what lets an added
  row go through applyMediaResult, the block extracted out of
  syncBacklogTitle's callback, so a discovered title gets the same identity
  resolution, the same details second call and the same respect for pinned
  fields as a searched one. The four search result mappers were extracted
  (mapRawgResult/mapTmdbResult/mapAniListResult/mapJikanResult) and the
  AniList field selection pulled into ANILIST_FIELDS, so a discover query
  can't drift from the search one and hand back a half-filled row.
  Answers cache in localStorage for 6h under lifelog-discover-v1, device
  local. discoverRuns doubles as the "already asked" set, which is what
  stops render→ensureDiscover→render looping; the cache-hit branch has to
  schedule a repaint of its own, or a warm load sits on "Loading…" forever
  over a full set of rows.

- the NYT Books API (free key, bestseller lists) is the only candidate that
  would give Discover a "hot books" list. Another key to set up. Why the
  other book/music sources can't: see DROPPED.md

- a backlog card's meta line fills the release slot for an item still ahead
  of you: yearOf first (so a bare releaseDate still yields its year), then
  "TBA" when isUnreleased says it's coming but nothing dates it. An item with
  no release info at all and no upcoming status stays blank on purpose —
  that's an unknown rather than a TBA. setBacklogCover now passes
  releaseDate/releasePrecision/releaseStatus into appendBacklogMeta too,
  since it builds its synthetic item from the live form fields and was
  leaving the release trio out, so the modal and the list row disagreed

- a backlog category card's count splits into "12 (+7 unreleased)" via
  backlogCountEl, gated on state.visual.backlogCounts (Settings → Appearance,
  device-local, defaults to "split"). It reuses notOutYet — the random pick's
  own "can't start it yet" test — rather than isUnreleased, so the two views
  can't disagree about what's waiting, and it falls back to the plain total
  when everything or nothing in a category is pending, since the split would
  otherwise say the same number twice

- the topbar's search wrapper takes flex-basis 0 on mobile, not auto: a flex
  row picks what wraps from hypothetical sizes before it shrinks anything, so
  a basis of "as wide as the input wants" put the ⚙ on a second row as soon
  as the ✕'s padding widened the field. Worth remembering if anything else
  is ever added to that row

- the Steam App ID field is available for every category, not just the ones
  whose source is "steam". It's one node that moves: #b/#fSteamTop in the
  form for a Steam category (where the App ID is the item's whole identity)
  and #b/#fSteamAdv inside Advanced everywhere else, swapped by
  updateSyncBtnVisibility. Two slots rather than two fields, so there's
  still one input, one id and one applySteamAppId wiring to keep straight

- picking a title you already have now copies every media field, via
  fillMediaFields — the mirror of clearMediaFields, walking the same
  MEDIA_FIELD_IDS list and honouring the same pins (each id is its item key
  with "#b" cut off). It used to set cover/mediaId/mediaSource/genres by
  hand and drop rating, release, length and summary on the floor

- Next Releases splits the old "No date yet" card: a card per year for the
  ones narrowed no further than that (yearOf), then a last card for the ones
  with nothing announced at all

- the search box's ✕ is ours (.search-clear over a .search-wrap) rather than
  ::-webkit-search-cancel-button, which Chrome only draws while the field
  has focus and can't be talked out of it from author CSS. The mobile
  layout rules moved from .search to .search-wrap, since the wrapper is what
  the topbar lays out now

- the entry form's "Started month" explainer paragraph is gone; the labelled
  pair and its "— none —" default carry it

- the random pick's scope strip has a "Bought only" switch next to
  "Favorites only". Both are one `&&` clause each in pickCandidates(), which
  is the single place a draw is narrowed — the reroll, the empty-state card
  and the wheel all read from it, so nothing else had to learn about the new
  switch. The empty-state line now names whichever switches are on
  ("Nothing in the categories you have on is starred and already bought"),
  with no-categories-at-all still taking precedence since that's the thing
  to fix first. `.pick-fav` became `.pick-scope-toggle` now that two of them
  share the row

- the app's checkboxes and scrollbars are its own now, drawn from the same
  tokens as everything else rather than by the OS. The checkbox is a single
  global `input[type="checkbox"]` rule — the per-screen width/height/
  accent-color declarations that used to disagree by a pixel are gone, and
  the full-width rules for text fields (`.modal label input`, `.ovr input`)
  exclude it rather than being undone by an `!important` further down. The
  tick is a clipped block, not a background SVG, so it can take
  `--text-on-accent` and stay legible on Nord's and Dracula's pale accents.
  A partly-selected "select all" header now sets `.indeterminate` (three
  sites: the month card header, and the backlog's category and upcoming
  sections), which is what the tri-state bar is for.
  Scrollbars are `::-webkit-scrollbar` on Chromium/Safari with the standard
  `scrollbar-width`/`-color` handed only to Firefox: Chromium drops every
  `::-webkit-` rule the moment `scrollbar-width` isn't `auto`, so the two
  can't both be declared. Both sit behind `(hover: hover) and (pointer:
  fine)` — asking for a width on a touch browser converts its transient
  overlay bar into a permanent one that eats layout width
  (0.110.1: the global rule needs an `input[type="checkbox"][hidden]`
  companion — an author `display` outranks the UA stylesheet’s
  `[hidden] { display: none }`, which surfaced the three state-holding
  checkboxes behind the backlog modal’s ★/✓/dropped buttons)

- a backlog item can be marked "already bought", which puts a green ✓ beside
  the title and, on a starred item, floats it to the top of its category's
  starred block. The flag is independent of the star (it shipped tied to it
  in 0.107.0 and came loose again in 0.108.0), but the *ordering* is not:
  compareBacklog only reads `bought` inside band 0, so marking an unstarred
  item doesn't quietly promote it up a list you never asked to reorder.
  The inline sort comparator in renderBacklog's build came out as
  compareBacklog() so that rule is testable rather than trapped in a closure

- a bought item says "Bought" in the slot its price occupied, and doesn't
  get a price fetched. Both gates are single points: appendBacklogMeta
  builds every .bl-price span in the app and returns whether it made one
  (so its callers skip the lookup), and loadBacklogPrices filters `bought`
  out of the batched per-category fetch the list kicks off. The two layouts
  with no metadata line of their own — the plain row and Next Releases —
  get the word beside the title instead, via boughtTag(). The GG.deals
  *link* is deliberately left alone: it's a store link like the Steam one,
  not a price

- SteamGridDB picks cross-fill their rating, length, genres and description
  from RAWG by title, so a game off it no longer lands bare. The extra
  request is really two — RAWG's search has no description, only its
  per-game endpoint does — so the second one is spent only when nothing
  better is coming: resolveMediaIdentity now runs *before* fetchDetails at
  both pick sites, and a steamgriddb-steam-gg pick that resolves to a Steam
  App ID says wantSummary:false, since Steam's own store blurb is already
  on its way and wins anyway. RAWG's date is deliberately dropped (it dates
  by earliest platform release, SGDB dates the entry you picked).
  The journal gets the same treatment: media.js's fetchLength returned a
  bare string and threw away the genres the same RAWG search had already
  fetched, so a SteamGridDB-synced timeline entry went into the Stats
  "Genres" card counting for nothing. Replaced by fetchEntryExtras, which
  returns { length, genres } — the two fields a timeline entry actually
  has, still off one request, and still skipping RAWG outright since its
  search already stated both

- the README's feature list had stopped at Timeline/By Category/Stats/
  Filters, and its project layout named four files out of fourteen —
  rewritten against what the app actually does now

- test/app.test.js had been dead since the wheel landed: app.js calls
  Wheel.init() at its top level and the test stubbed every other module
  but that one, so the file threw on require before its first assertion
  and run-all.js had been reporting a red suite

- a random wheel, in the + menu and beside the Backlog's random pick. Feed
  it your own options (kept on the device) or let the picker feed it the
  titles it was about to draw — either way the spin is only the reveal: the
  winner is drawn first and the animation aimed at it, so the odds stay flat
  however the easing lands. Twelve slices max, since more than that stops
  being readable at phone width

- backlog picks come out of a bag instead of a fresh coin flip each reroll,
  so nothing repeats until everything in scope has had a turn, and the bag
  carries a device-local memory of what it drew last time so a fresh sitting
  doesn't lead with last night's rejects

- games were the only backlog items that never got a description, and the
  metascore/length on the ones that did have data came and went: RAWG's
  search endpoint has no description at all, and its `metacritic`/`playtime`
  are null and 0 for anything unreviewed or unplayed. Added a per-game RAWG
  details call on pick (the games' fetchTmdbDetails), read Steam's own
  short_description wherever an App ID is known, stopped every sync path
  from blanking a description it had nothing to replace with, and put a
  show/hide switch for descriptions in the backlog list under Appearance

- starred backlog items were sorted below the released/unreleased split, so
  starring an unreleased item pushed it into the upcoming block instead of up
  with the other starred ones. Replaced the ad-hoc separator bookkeeping in
  renderBacklog's build with a single bandOf() (starred / ready / upcoming /
  dropped) driving both the sort and the separators — the old three-flag
  version could also emit two separators at one boundary when a category was
  missing a middle band.

- per-item sync overrides + store links without a cover. The links lived in
  an overlay inside the cover block, so anything without artwork (or with a
  cover URL that 404s, which hides the block via onerror) lost them; they now
  fall back to a row under the modal title, metadata included. The Advanced
  foldout stores `overrides: { release: true, … }` on the item and every sync
  path checks it — the two in-modal ones read the checkboxes directly, the
  bulk syncs and the 🔭 re-check read the saved item. The generic pull/push
  plumbing is in app.js; each modal supplies its own field spec so compound
  fields (a release date is a date + precision + status + year behind one
  tick) stay next to the parsing they need.


- game release dates, three holes at once. (1) searchSteamGridDB never read
  the `release_date` SGDB returns on every search hit, so every SteamGridDB
  match landed with no date and no year — releaseFromSgdb() now parses it,
  defensively (unix seconds, a milliseconds value, or a plain string; anything
  else is tba rather than a 1970 release). (2) A game that resolves to a Steam
  App ID now takes Steam's own date via appdetails: RAWG dates by *earliest
  platform*, which is where the wrong years came from, and Steam is the only
  one of the three that admits to "Q1 2026" instead of inventing a day.
  resolveMediaIdentity returns it as `release` and the backlog merges it last
  so it wins ties; the journal ignores it (an entry is dated by when you
  finished the thing). (3) fetchRelease now handles steamgriddb, so those
  items stop being skipped by the 🔭 re-check — needed a proxyUrl arg, since
  SGDB is CORS-blocked direct. fetchSteamGridDbSteamAppId and the new
  release lookup share one fetchSteamGridDbGame().

- tapping the active tab scrolls to top. It used to call switchToView with the
  view it was already on, and render() restores scroll on a same-view rebuild
  by design, so the tap was a visible no-op. Handled in the tab click handler
  rather than inside switchToView, which the swipe gesture also calls.

- "SteamGridDB + Steam + GG.deals" as its own source, mirroring the RAWG
  combo, + the same bulk-sync silent-failure fix. v0.99.5 had made *every*
  SteamGridDB match resolve an App ID, which left no way to ask for just the
  grid art — a combo source keyed "steamgriddb-steam-gg" is the shape this
  app already had for exactly this, so plain "steamgriddb" went back to being
  cover-art-only. Also dropped the fallback dropdown's exclusion of the combo
  sources: a fallback match wants an App ID as much as a primary one does,
  and excluding them meant a RAWG-primary/SGDB-fallback games setup quietly
  produced items with no price. Separately, both bulk syncs now wrap their
  loop in try/catch — a throw used to leave the button disabled and the bar
  untouched, which is indistinguishable from a button that does nothing
  (which is exactly how it was reported).

- a SteamGridDB pick now resolves a Steam App ID, like the RAWG combo source
  already did. SGDB's game id drives neither the store link nor GG.deals
  pricing (both key on the App ID), so a game matched through it landed with
  no price and a link to SGDB's own page. SGDB does know the mapping — the
  per-game endpoint returns it under external_platform_data given
  ?platformdata=steam (the proxy already relays query strings), so it's one
  extra request on the picked game only, not on every row in the list. Folded
  the four copies of the old `if (r.source === "rawg-steam-gg")` block into one
  resolveMediaIdentity(r, keys) that every pick path calls unconditionally, so
  a third source needing the same treatment is one branch, not four. Games
  with no Steam listing keep their plain SGDB identity, and the SGDB cover art
  is kept regardless — it's stored on the item, not derived from mediaSource.

- sync results render in arrival order — dropped the primary-first ordering
  added a version earlier. Holding a finished fallback back to preserve the
  order cost the whole difference between the two APIs whenever the primary was
  the slower one (measured: first result 2506ms → 259ms with a 2.5s primary and
  a 250ms fallback). streamMediaSuggestions now maps both sources through
  Promise.all and emits each batch in its own .then, so nothing waits its turn;
  the source tags are what keep an arrival-ordered list legible. The pending row
  became a Set of outstanding sources rather than a single "next" one, deduped
  by display name (tmdb-movie + tmdb-tv would otherwise read "TMDB, TMDB"), and
  narrows as each source answers. Rows are only ever appended above it, so
  nothing already on screen moves under the pointer mid-lookup.

- sync button latency — measured the real APIs first rather than guessing:
  AniList/Jikan/MusicBrainz ~250ms, Google Books ~670ms, Open Library ~2500ms.
  Two fixes. (1) Perceived: renderStreamedSuggestions now paints a "Searching
  <source>…" row synchronously, before anything is awaited, and puts the sync
  button in a .busy spin — previously the click had no visible effect at all
  until the first API answered. (2) Actual: streamMediaSuggestions fires the
  primary and fallback requests together instead of starting the fallback only
  after the primary resolved, so a lookup costs max(a,b) rather than a+b.
  Rendering order is unchanged (still strictly primary-first) — only the
  waiting overlaps. Measured with stubs at the real latencies: two typical
  sources 500ms → 264ms; fast primary + Open Library fallback 2750ms → 2507ms
  with the first result on screen at 260ms. Each request also gets its own
  .catch now, so one source failing no longer aborts the other (the old shared
  try/catch dropped both).

- sync button source labelling + streaming — the combined primary/fallback list
  (added v0.87.0) gave no way to tell the two sources apart, which matters
  because the pick sets mediaSource and that drives cover art, the source/store
  link buttons, and GG.deals pricing. makeMediaAcItem now tags each row with
  MEDIA_SOURCE_LABELS[r.source], right-aligned so row height is unchanged
  (added "rawg-steam-gg" to that map, which was missing). Deliberately no dedup
  across sources: SteamGridDB exists precisely to offer *different* art for a
  title RAWG also has, so collapsing them would remove the choice the combined
  list is for. Replaced the combineFallback flag with streamMediaSuggestions(),
  which emits one batch per source, plus renderStreamedSuggestions() shared by
  both Sync buttons — primary results paint immediately and an .ac-pending row
  holds the fallback's place, instead of the whole lookup waiting on the slower
  API. Extracted mediaSearchFor() as the shared setup, which also fixed a
  fallback set to the same source as the primary being searched twice. Bulk
  sync and the auto-checks still use fetchMediaSuggestions (fallback only when
  the primary is empty) and are untouched.

- next releases view — a second Backlog layout (`state.backlogMode`, remembered
  in the UI localStorage key next to `view`) rather than a sixth tab: same
  items either way, and the phone's bottom nav has no room. Grouped into one
  card per month keyed on upcomingAt() — the day the item is actually waiting
  on, which is the next episode for anything mid-season, so an airing show
  lands on next Tuesday rather than the year it premiered. isAwaitingRelease()
  is therefore broader than isUnreleased(): a released-but-airing show belongs
  here too, and sync.js's re-check uses the same predicate (a next-episode
  date is the fastest-staling thing in the app). Within a month, exact dates
  sort first in day order and coarser ones settle underneath, instead of
  interleaving at the arbitrary day their window opens; countdowns are only
  ever shown against a real day. Year-only/TBA items collect in a trailing "No
  date yet" card. Reuses .backlog-section/.backlog-grid, so the sticky headers
  and the mobile jump-nav carousel picked it up for free. Deliberately no bulk
  select here (read-only view; switching modes clears any selection). The dice
  button moved into the mode bar to keep one strip above the list rather than
  two. Follow-up ideas: a "notify me" / calendar export for a dated row; fold
  released-since-last-visit items into a "just out" card at the top

- release-date precision — every media source knows a different amount about a
  release, so items now carry `releasePrecision` (day/month/quarter/year/tba)
  next to `releaseDate`, plus `releaseStatus` ("upcoming"/"released") wherever
  a source states it outright, and `nextAt`/`nextLabel` for a currently-airing
  show's next episode. Precision is derived from the source's own shape, not
  sniffed from a string: AniList/Jikan expose nullable year/month/day parts,
  Steam's free-text date is parsed (parseSteamReleaseDate handles both day
  orderings, "Q1 2026", month-only, and the "Coming soon"/TBA placeholders),
  RAWG's `tba` flag overrides its Dec-31 placeholder date. isUnreleased() now
  reads "the last day the window could still be open hasn't passed", with an
  explicit status overruling the date entirely — which is what finally fixes a
  January release reading as upcoming until December. No migration: items
  saved before this re-derive their precision from the date's shape, which
  reproduces the old behavior exactly. mergeRelease() folds several sources
  together keeping the most precise date (Steam wishlist items are described
  by both Steam and a RAWG name match). Steam's appdetails `coming_soon` +
  `date` are now read in the same request that resolves the title, replacing
  the fuzzy RAWG-by-name date. Follow-up ideas: surface precision in the
  backlog row meta line ("Q1 2026" rather than just the year); let a manual
  edit set an approximate date without inventing a day

- re-check upcoming release dates — Settings → Media → Upcoming releases.
  Re-asks each still-unreleased backlog item's source by its stored media id
  (never by title, so nothing drifts onto a different work); RAWG/AniList get
  new by-id endpoints, TMDB reuses the details endpoint, Steam reuses
  appdetails. Sources with no id lookup worth making (Open Library, Google
  Books, MusicBrainz, Jikan) are skipped rather than title-searched. Only
  stamps updatedAt when something actually moved, so a no-op re-check leaves
  nothing for the GitHub sync to merge. Optional quiet auto-run on app open,
  paced per-device in localStorage like the Steam/AniList checks. Follow-up
  idea: a per-item "last checked" so a stale entry can be spotted

- pausing a recurring expense — new optional `rec.pauses`, a list of
  { from, to? } inclusive ranges. recurringOccurrences() marks occurrences
  inside one `paused: true` and rides them on the existing `skipped` flag, so
  every total/count downstream already excluded them with no changes. An
  absent `to` means "still paused" — the case a per-occurrence skip can't
  express, since those occurrences don't exist yet — and flips the tool button
  to "Resume now", which closes the range at yesterday. The schedule keeps its
  anchor day underneath, so resuming lands on the normal billing date rather
  than re-anchoring. normalizePauses() sorts/fuses overlapping and adjacent
  ranges (an open-ended one absorbs everything after it) and runs in
  sanitizeRecurring too, so an imported file can't carry a tangle. Pauses are
  clipped across a plan change instead of dropped, unlike overrides — a range
  doesn't need the schedule to land on it to mean something. The occurrence
  modal locks its skip checkbox on a paused date and refuses to read it, which
  would otherwise bake in a skip override that outlived the pause. Follow-up
  ideas: show paused stretches as gaps in the Summary trend; a "pause for N
  months" shortcut instead of picking the end date by hand

- fixed the two-date rows (start/stop, pause from/until) overflowing their
  modal by ~20px on a narrow phone — flex items default to min-width:auto and
  a native date input reports a wide intrinsic width, so neither would shrink;
  `.modal .row label` now sets min-width:0

- recurring expense plan changes — a recurring expense's terms can now change
  without rewriting what came before. "Change plan" splits the template: the
  old one gets an endDate the day before the change and keeps generating its
  history verbatim (including its overrides), a new one takes over from that
  date and links back via a new `prevId` field, and planChain() walks that
  link in both directions to render the Plan history strip. Overrides on/after
  the split move to the new plan only if its schedule still lands on that exact
  date — otherwise they're dropped and the count is reported, since an override
  for a date nothing generates is invisible. Also exposed the endDate the data
  model already supported as a "Stops on" field; added one-off → recurring
  ("Make recurring", prefilled from the entry, which is only removed once the
  template saves) and recurring → one-off ("Convert to entries"); split Delete
  off from that conversion so a mistakenly-added recurring expense can actually
  be removed; and listed ended/superseded plans in the recurring card so they
  stay reachable. splitRecurring/planChain/addDaysStr/nextOccurrenceDateAfter
  are pure and covered in finance.test.js. Follow-up ideas: show a plan change
  as a marker in the Summary trend; let a plan change also move the anchor day
  (it currently inherits the new start date's day, which is usually right)

- multi-month entries (Option A) — entries gained an optional startMonth/startYear
  ("Started" month + year in the add/edit sheet). When it's strictly before the
  anchor {year, month}, the Timeline row renders a faint span chip via a new pure
  spanLabel() helper ("Jun–Aug" same-year, "Nov 2024–Feb 2025" cross-year);
  otherwise nothing is stored/shown. sanitizeEntry validates + drops any
  missing/equal/after/out-of-range span so the rest of the app can trust the
  invariant. The entry still lives in one card and counts once — stats/heatmap/
  streaks/merge untouched. Added .espan chip CSS and journal.test.js coverage
  (retention, drop cases, cross-year, label formatting). CSV stays the lean
  summary it already was (JSON export carries the span). Follow-up ideas: a
  Stats surface for "longest spans"; optional span display in the backlog picker

- faster launches + clearer sync failures — the service worker now uses
  stale-while-revalidate for the app's own files (instant repeat load from
  cache, background refresh for next time; the ?v= query on scripts/styles
  keeps versioned assets fresh, HTML propagates within one extra load).
  Scripts load in parallel via `defer`. A 401/403 from GitHub (bad/expired/
  under-scoped token) now surfaces as a distinct red storage status —
  "GitHub rejected your token — saved to this browser only. Reconnect in
  Settings." — instead of the misleading "will sync when online" pending
  state, and the storage-status line is now clickable to open Settings → Data

- math in the Ledger amount fields — the Amount input in the finance entry,
  recurring expense, and per-occurrence override modals now accepts a basic
  arithmetic expression ("50-25", "12.5*3", "(10+5)/2") as well as a plain
  number. It auto-resolves to the result ~800ms after you stop typing (and on
  blur/submit), rounded to cents. Added a small CSP-safe recursive-descent
  evaluator (evalMathExpr) and a readAmount() helper in finance.js — no eval()/
  Function — plus a math-eval-flash highlight; the inputs became
  type="text" inputmode="decimal" so operators are typeable. Tests cover
  precedence, parentheses, incomplete/invalid input, and division by zero
- richer backlog random picker — the "🎲 Pick something for me" card now
  shows a ★ favorite marker (priority), the rating/year/length line, the
  GG.deals price (Steam items), the description/summary, genres, your own
  note, and the source/store link buttons (Steam · RAWG · TMDB · AniList · …
  plus GG.deals), instead of just title + cover. Factored the
  rating/price/summary block into a shared appendBacklogMeta() helper reused
  by the rich list row, the edit-modal cover, and the pick modal; the links
  reuse renderCoverLinkButtons in a standalone row so they show without a cover
- Settings → Media naming cleanup: pulled the proxy URL field out of the
  "Steam Wishlist import" section into its own "CORS proxy" heading at the
  top of Media sources, since SteamGridDB cover art, GG.deals prices, and
  the Steam Wishlist import all route through it (proxy/worker.js's
  /steamgriddb + /gg-deals routes). Reworded its explainer (incl. that
  future CORS-blocked sources will use it too), pointed the SteamGridDB /
  GG.deals key hints and the Steam Wishlist section at the shared proxy
  above, and updated the SteamGridDB "needs the proxy" error string. Kept
  `settings.steam.proxyUrl` as the storage key (id unchanged) — pure
  UI/labeling, no schema change
- Ledger Summary insights — a "Highlights" card (real avg spend per active
  month, biggest month, top category, this-year-vs-last delta) and a "Spend
  trend" card charting the last up-to-12 calendar months on one continuous
  timeline (zero bars for empty months). Monthly figures skip yearly ad-hoc
  entries; category/year totals still include them. Reuses the existing
  moneyStatItem/barRow helpers (renderFinanceHighlights/renderFinanceTrendCard
  in finance.js)
- adding/editing an entry no longer snaps the page to the top — an in-view
  re-render now pins the section you were parked on back to its exact
  on-screen offset (captureScrollAnchor/restoreScrollAnchor in app.js,
  scrolling relative to the eagerly-built anchor section) instead of a raw
  scrollY the browser was clamping away once the lazy sections above it
  collapsed to header height during the rebuild
- mobile jump-nav label now tracks the scroll position live, not just on
  tap/render — an rAF-throttled scroll handler (syncJumpNavToScroll) runs
  jumpIndexFromScroll and keeps the active carousel slot on whichever
  section is under the top bar, suppressed while a ◀/▶ jump's own smooth
  scroll is still settling so it doesn't fight it
- moved the app version out of the bottom of Settings into the top bar,
  under the ⚙ button (a .settings-corner wrapper + absolutely-positioned
  .version-badge, mirroring how the sync-status line hangs under the logo);
  shows "vX.Y.Z" with the full "LifeLog vX.Y.Z" as its hover title
- "🔄 Sync" pick now adopts the matched media's title on both entries and
  backlog items (so a sloppy typed title becomes the canonical one), and a
  later title edit no longer drops the media link — only "✕ Unsync" does.
  Added an entrySyncLocked/backlogSyncLocked flag set on any explicit media
  pick (Sync-button match, local/backlog suggestion) or when opening an
  already-synced item, gating the add-flow's rename-clears-cover behavior;
  cleared on unsync
- "🔄 Sync" now returns matches from the category's primary source AND its
  configured fallback in one list (fetchMediaSuggestions gained a
  { combineFallback: true } opt, passed only by the two manual Sync buttons)
  instead of showing the fallback's results only when the primary was empty;
  bulk/auto-check callers keep the cheaper primary-first-then-gap-fill path
- keyboard-reachability for the app's clickable-but-not-<button> controls
  (year + category filter chips, the chip-edit "✎" pencil, the "+"
  add-category chip, achievement chips) — a shared activatable() helper
  (app.js) gives each a tabindex, role="button", an aria-label on the
  glyph-only ✎/+ controls, and Enter/Space activation firing the same
  handler as a pointer click; the existing [tabindex]:focus-visible rule
  draws the focus ring. The keyboard path passes the keydown event
  through, so the ✎ pencil's stopPropagation() still keeps Enter off the
  surrounding filter chip. Wired into journal.js via ctx for the
  achievement chips
- keyboard shortcuts — N to quick-add an entry, 1–5 to jump between
  Timeline/Stats/Backlog/Ledger/Summary, / to focus search, and ? to open
  a small cheat-sheet listing them all (also noted in Settings, since
  otherwise there's no on-screen hint they exist). Skipped while typing
  in a field, while a modal is open, or with a modifier held, so they
  never fight with entering a title/note/search term
- accessibility pass on icon-only buttons — ARIA labels added wherever a
  button's only content was a glyph and it didn't already have one
  (Settings gear, close-Settings, the cover-sync buttons, the backlog
  priority toggle incl. aria-pressed, each section's "+" quick-add), plus
  an app-wide :focus-visible outline (buttons/links/inputs had none
  beyond the browser's bare default before this). cover-link-btn and
  mobile jump-nav buttons get an inset offset instead, since both sit
  inside an overflow:hidden ancestor that would've clipped the ring
- CSV round-trip test coverage for Journal import/export — journalCsvText
  (a pure function split out of exportJournalCsv, which previously only
  built rows inline before handing them to download()) piped through
  parseJournalCsv and diffed against the original entries/backlog,
  covering exact-value preservation, embedded commas/quotes/newlines, and
  a mixed entries+backlog export
- trash/undo for deletes — "Recently deleted" in Settings → History,
  derived entirely from the existing local save-history log (no separate
  trash store or retention window): walks adjacent local history
  snapshots to spot ids present in one save and gone in the next, keeps
  whichever's still absent from the live data, and offers a per-item
  Restore that pushes just that one item back rather than reverting a
  whole snapshot. Covers entries, backlog items, and finance/recurring
  expenses (not categories — their removal usually cascades/reassigns
  rather than being a simple undo case)
- merge conflict visibility — mergeCollection (merge.js) now flags real
  conflicts specifically: editConflicts (both sides edited the same item;
  the older edit is discarded) and deleteOverridden (one side deleted an
  item the other side edited since, so the deletion is discarded and the
  item resurrected) — as opposed to a plain one-sided change, which loses
  nothing. A new summarizeConflicts() turns those into a short
  human-readable phrase, surfaced in the merge toast (on load and on
  background poll) and folded into the version-history entry a merge
  produces, instead of only the generic added/removed/edited count that
  couldn't tell a conflict apart from an ordinary merge
- "skip this occurrence" for a recurring expense — sets a `skip` flag on
  that date's rec.overrides patch via a checkbox in the occurrence-edit
  modal (no separate quick-skip button on the Ledger row; toggling only
  happens through that one modal). A skipped occurrence still shows as a
  row in the Ledger (faded out, "Skipped" label, click to reopen the
  modal and toggle it back) rather than disappearing outright, but is
  excluded from every count/total — month/year entry counts and totals in
  the Ledger, and all of Stats. Also shown/toggleable from the recurring
  template's own occurrence list, which labels skipped ones
- global search — Timeline and Backlog's search now also matches notes
  text (Ledger already did). Since the search box is shared across every
  view already (state.search persists across tab switches), added a small
  match-count badge on the tabs you're not currently looking at whenever
  a search is active, so you can tell it also hits Backlog/Ledger/Timeline
  items without clicking over to check each one
- PWA app shortcuts (manifest.json `shortcuts`) — long-press/right-click
  the installed app's icon for "Add entry" / "Add expense", each pointing
  at `?action=add-entry` / `?action=add-expense`; app.js's init() checks
  that query param once after data loads, opens the matching add modal,
  and strips it from the URL right after. Service worker cache bumped
  (v33 → v34) since manifest.json's content changed
- "pick something for me" on the Backlog (a button above the list, scoped
  to the active category/search filters and skipping dropped/unreleased
  items, opening a small modal with a re-roll button and a way into that
  item's own edit modal) and a backlog-aging line in the backlog item edit
  modal ("Added Jan 3, 2026 — 3 months ago"). Entries moved over via the
  Backlog's "✓ Done" flow (or an auto-linked title match) now also carry
  the backlog item's original add date as `backlogAddedAt`, which Stats'
  Overview card surfaces as a new "completed from backlog" count — and
  which future aging-over-time stats can build on
- backlog items within each group (prioritized, regular, upcoming/unreleased,
  dropped) now sort alphabetically by title within that group instead of by
  createdAt — the final tiebreaker in renderBacklog's sort comparator
  (backlog.js) went from an implicit stable-sort fallback on insertion order
  to an explicit `a.title.localeCompare(b.title)`
- fixed journal.js's stripMediaSearchSuffix leaving a dangling colon behind
  for a title written as "Foo: Book 3" (stripped to "Foo:" instead of
  "Foo") — the separator-char group only matched a "-"/":" that came after
  whitespace (e.g. "Foo - Book 3"), not one already glued onto the base
  title before the space. Folded the separator chars into the same
  repeatable class as the whitespace so both forms strip the same way; a
  strict generalization of the old pattern, so every previously-passing
  case still passes
- extended the plain-node test pattern to the rest of the pure/near-pure
  helpers the earlier coverage survey had logged as a follow-up:
  test/io.test.js (parseCsv/csvEsc, buildImportItems's three dedup
  strategies — exact key, cross-kind title+category, mediaSource+mediaId —
  importItemDateStr/importBucketKey); journal.js's
  titleSuggestions/backlogSuggestions/heatColor added to test/journal.test.js;
  finance.js's closestOccurrenceDate/parseMoneyCell/monthSortAsc added to
  test/finance.test.js; media.js's normGenres/stripHtml/steamCoverUrl in a
  new test/media.test.js (media.js needs no init() stubbing at all — fully
  self-contained like merge.js). Skipped TMDB's genre-id lookup tables
  (plain data, not logic) and everything network/fetch-based, unchanged
  from the original survey's scope call. 108 tests across 7 files now

- extended test/merge.test.js's plain-node test pattern (plain Node
  `assert`, no framework) to the rest of the data-touching code named in
  the TODO: finance recurringOccurrences (overrides, month/leap-year
  clamping, endDate cutoffs) plus its date-math helpers in
  test/finance.test.js; the entry/backlog/finance sanitizers in
  test/finance.test.js, test/journal.test.js, and test/backlog.test.js;
  and normalize()'s migrations (visual-settings one-time migration,
  accomplishments legacy-string→id backfill, category backfill) in
  test/app.test.js — the hardest of the three since app.js runs its real
  bootstrap (Storage.load, wire()'s DOM wiring) unconditionally at the
  bottom of its IIFE; a `module`-only guard (mirroring merge.js's own
  `module.exports` check) skips that under a Node `require()` without
  changing anything for a real browser load. Folded in a few equally
  self-contained pure functions the coverage survey surfaced right next to
  these (stripMediaSearchSuffix, isUnreleased). Added test/run-all.js to
  run all five test files in one shot (each spawned as its own process —
  they all reset `global.window` and re-require their src files, which
  Node's require() cache would silently no-op on a second in-process
  require)

- Timeline, Ledger, and Backlog now render lazily instead of building
  every year/category up front on every render() call — a shared
  renderLazySections() helper (app.js) builds every section's header
  synchronously (so sticky headers and the jump-nav's querySelectorAll
  keep working unchanged) but defers each section's body until it's
  needed: the one nearest the current scroll position builds immediately,
  the rest build via IntersectionObserver as they scroll near, or a
  background requestIdleCallback trickle otherwise. jump-nav ◀/▶ forces
  its target section to build before scrolling to it; bulk mode (where
  select-all/drag-paint need every row live) skips the lazy path and
  builds everything up front, same as before. Cover art `<img>`s also
  got `loading="lazy"` so they don't all fire their network request the
  moment a section builds.

- mobile: quick-jump row (◀ current ▶) below the bottom tab bar — jump by
  year on Timeline/Ledger, by category on Backlog, so a long list doesn't
  mean scrolling through everything to reach the next section. Section
  list rebuilds on every render() (via updateJumpNav() in app.js) and gets
  tagged with data-jump-index; the current position is tracked as state
  (jumpCurrentIndex) rather than re-derived from scroll position on every
  click, since window.scrollTo's smooth animation is async and a quick
  second tap would otherwise measure an animation still in flight. Jumping
  computes the scroll target manually (topbar height offset) rather than
  relying on scrollIntoView, which would tuck the sticky header behind the
  fixed topbar. The row's space is always reserved in the bottom bar
  (visibility, not display, toggles) so switching to Stats/Summary (which
  don't use it) never shifts the bar's height. Mobile-only; not shown on
  desktop since it already has multi-column layouts and visible sticky
  headers
- fixed recurring expenses landing on the wrong day of the month for
  anyone in a timezone ahead of UTC — recurringOccurrences() (and a few
  related "today" spots: the finance-entry date field default, a new
  recurring expense's start date, and the recurring-card active/expired
  check) built date strings by converting a local-time Date through
  .toISOString(), which round-trips through UTC and could shift local
  midnight back a calendar day. Added a localDateStr()/todayStr() pair
  that reads local calendar fields directly, no UTC conversion, and swapped
  every call site over
- fixed finance entries on the same date inconsistently appearing at the
  top or bottom of the month's list — the Ledger sorted by date only, so
  same-date entries fell back to their position in the underlying array,
  which merge.js's mergeCollection() reshuffles on every multi-device sync
  (it rebuilds the array from a Set of ids, not insertion order). The sort
  now breaks same-date ties by createdAt, so display order stays
  deterministic across merges
- app.js modularization follow-up: pulled the import/export + import-picker
  cluster into src/io.js (download/export/import for JSON+CSV, the
  buildImportItems dup-checker, and the shared review picker modal), and
  the Steam wishlist + AniList Planning sync machinery into src/sync.js —
  both follow the same fetch/dedupe/review-picker/auto-check shape, so they
  share one module instead of each getting a thin file of its own (manual
  Steam App ID cover helper, GG.deals price cache, wishlist sync,
  unresolved-title retry, RAWG backfill, and both auto-checks). Both new
  modules follow the same init(ctx) pattern as finance/settings/backlog/
  journal, cross-module sanitizers and cover setters arrive via ctx rather
  than reaching for other modules' window globals directly. app.js is down
  to ~1,385 lines from ~2,290. No behavior change
- AniList Planning auto-check (Settings → Media → AniList "Check
  automatically") — mirrors maybeAutoCheckSteamWishlist: a quiet cadence
  (Never/day/3 days/week/month, stored on settings.anilist.autoSyncDays)
  that on app open, at most that often, fetches the Planning list(s) and
  counts how many titles aren't already in the backlog/Journal yet, then
  just toasts the count — never opens the picker or adds anything. Uses a
  local-only last-checked key (ANILIST_SYNC_KEY, mirroring STEAM_SYNC_KEY),
  a maybeAutoCheckAniList() fired from init() alongside the Steam one, and
  the same source+id / title+category dedup the import uses
- Stats: fixed the Highlights card butting against the Overview card above
  it with no gap — it now gets the same 20px top margin the other stacked
  cards have
- SteamGridDB back as a games cover-art source/fallback — routed through the
  Steam Wishlist CORS proxy's /steamgriddb/<path> route (it's CORS-blocked
  direct), wired back into media.js's source list, the Settings source
  dropdown, and a SteamGridDB API key field; needs both the key and the
  proxy URL set to work

- AniList Planning import (Settings → Media): pulls plan-to-watch (anime)
  and plan-to-read (manga) into the backlog, each into its own chosen
  category, no proxy/key/auth needed. Routed through the shared review
  picker; dup-checked against the backlog and the Journal by title+category
  and by AniList media id. Generalized the picker's "already added" media-id
  check from Steam-only to any source. Items carry cover/rating/length/genres
- Stats: three new cards — Highlights (busiest month, longest month
  streak, top category, year-over-year delta), Monthly pattern (entries
  per calendar month across all years), and Genres (breakdown by a new
  genres[] field the media sources now capture on sync — RAWG/TMDB via
  its genre-id maps/AniList/Jikan/Open Library subjects/Google Books
  categories, capped at 4; older entries stay blank until re-synced, and
  the card hides itself when there's no genre data). Genres persist
  through the sanitizers and ride along on re-entry suggestions and the
  entry↔backlog transfer
- split the Journal out of app.js into src/journal.js (~1,050 lines):
  Timeline + Stats views (heatmap, Year in Review), the entry modal,
  timeline bulk actions, achievements, category management, the entry
  sanitizer, and the shared title-suggestion/media-cover machinery
  (re-forwarded into backlog.js) — app.js is now a ~2,150-line shell,
  completing the per-view modularization; no behavior change
- split the Backlog out of app.js into src/backlog.js (~650 lines):
  view + rows, add/edit modal with sync, bulk move/delete/sync, and the
  backlog sanitizer — app.js down to ~3,100 lines, no behavior change
- split the Settings modal out of app.js into src/settings.js (~620
  lines): tabs, Data panel (file/GitHub connections + version history),
  Appearance, media source/key settings incl. Steam wishlist inputs,
  and the privacy panel — app.js is down to ~3,700 lines, no behavior
  change
- split all finance code out of app.js into src/finance.js (~1,000
  lines): Ledger + Summary views, finance/recurring/finance-category
  modals (incl. per-occurrence overrides and link-past-expenses),
  finance import/export, and the finance sanitizers — app.js is down
  to ~4,300 lines with no behavior change; also fixed the service
  worker precache list missing merge.js
- Steam Wishlist import: a small self-hosted CORS proxy (free Cloudflare
  Worker, see proxy/worker.js + proxy/README.md) unblocks Steam's
  wishlist endpoint, which sends no CORS header. Settings → Media has a
  new "Steam Wishlist import" section (proxy URL, SteamID64 with a
  find-yours link, target category, sync button) that pulls the whole
  wishlist in one request and routes it through the existing shared
  import/export review picker — dup-checked against the backlog by
  title+category and, for items already imported once, by Steam app ID
  too (so a later local rename doesn't make it look new again); nothing
  is added until confirmed. Imported items are tagged mediaSource:
  "steam" + mediaId: <appid>, the same shape a manually-entered Steam
  App ID already used, so cover art and GG.deals pricing (both already
  wired to that shape) pick them up with no extra work. Wishlist
  removals don't auto-remove the backlog item — only additions sync
  automatically.
- fix version history rows overflowing the panel on mobile — the
  summary now sits on its own line below the date instead of sharing
  a line with the date and Restore button
- reworked sync/version history to be robust offline and across devices:
  every entry/backlog item/finance entry/recurring expense/accomplishment/
  category now carries an updatedAt, deterministically backfilled for
  existing data; version history moved into its own local-first store
  (IndexedDB) with a human-readable summary per save ("+2 entries, edited
  1 recurring expense"), so restoring works fully offline regardless of
  GitHub connection, with GitHub's commit log filling in further back
  when connected; two devices that both edit offline and reconnect now
  get a real three-way merge (union of additions, newer-wins on true
  conflicts, edits-over-deletes) instead of one whole snapshot silently
  overwriting the other — the old "pick a version" picker only shows up
  now for genuinely irreconcilable cases; also fixed two identity bugs
  that would've broken merging: accomplishments had no stable id across
  edits, and renaming a category regenerated its id
- Finance Summary: "Recurring vs one-off" is now just "Recurring" —
  lists each recurring expense's own total for the period instead of
  one lumped total against all one-off spending
- recurring expenses: occurrences can now be edited individually — click
  one (in the Ledger or the template's own list) to set a per-date
  amount/note override without changing the template or any other
  occurrence, shown with a ↻* badge; linking past expenses now preserves
  each one's original amount/note this way too, instead of flattening
  it to the template's current amount
- recurring expenses: added a "🔗 Link past expenses" button in the edit
  modal — a searchable picker (styled like the import review screens)
  over your existing expenses in that category, so old manually-logged
  entries from before the recurring expense existed can be folded into
  it; linked entries are removed and the start date backdates to cover
  them, generated from then on by the template itself
- confirmed SteamGridDB is CORS-blocked from the browser (real-device
  test: "Failed to fetch") and removed it — the source function, its
  Settings API key field, and its dropdown entries; games stays RAWG-only
- each category's media source can now have an optional fallback,
  tried automatically when the primary finds no matches — the
  fallback dropdown offers every source, not just ones "compatible"
  with the primary's type, so it's on you to leave it at "No fallback"
  where a second source doesn't make sense; added Jikan (anime/manga,
  behind AniList) as a new source
- app lock: Fingerprint/Face ID now requires a PIN to be set up first as
  a mandatory fallback, instead of being usable on its own; the lock
  screen shows both the PIN pad and a Fingerprint/Face ID button
  together when both are set up, instead of only one method at a time;
  and entering the correct PIN unlocks immediately without needing to
  press Unlock
- removed income tracking from Finance entirely — the Type field on
  entries, the income/expense/net stats, the savings-rate stat, and
  the "Income by category" card are all gone; every amount now shows
  as a plain expense with no +/- sign, and CSV export dropped its
  "Type" column
- backlog priority star now sits inline with the title in list rows
  instead of wasting its own line; the "★ Prioritize" toggle in the
  backlog editor moved from a form row into a compact button next to
  the title field

- simplified backlog priority to a single "★ Prioritize" toggle instead
  of a 1-5 star rating; moved the "Dropped" checkbox into a "Mark as
  dropped"/"Restore" button next to Delete; bulk sync now shows live
  "N/M synced" progress next to the selected count instead of changing
  the Sync button's own label (which was pushing Cancel onto its own
  row on mobile)
- added length metadata for backlog items and journal entries: playtime
  (games), runtime (movies), season/episode counts (shows), page count
  (books) — synced via RAWG/TMDB/Open Library/Google Books
- journal entries can be moved back to the backlog via a new "Move to
  backlog" button next to Delete, the reverse of the "✓ Done" button
- improved Finance Summary: savings-rate stat, an Income by category
  breakdown, a real By month card (replacing the flat yearly/12
  average), a Recurring vs one-off split, and a Top expenses card
- renamed the Finance tab formerly called "Timeline" to "Ledger" — both
  Journal and Finance had a tab named "Timeline", which was ambiguous
- trimmed a lot of repetitive Settings hint text (dropped the redundant
  "(this device)" tag on Local file, merged Theme/Font's identical
  hints, cut duplicate "this device only" phrasing, generalized the
  Brave-specific browser message into a bullet point) and moved Currency
  back under Appearance
- on mobile, the Journal Timeline tab moved one position to the right in
  the bottom nav (swapped with Stats), so it's no longer the leftmost tab
- cleaned up Settings: merged the History tab into Data, moved Currency
  from Appearance into Data, combined Theme/Font into one "Look" section,
  and merged Privacy's and Media's paired sections into single sections
  with subheadings — 6 tabs down to 5, tighter groupings throughout
- backlog entries get a divider between prioritized and unprioritized
  items within a category, same as the existing dropped-items divider
- category filter pills use the same solid accent highlight as selected
  year pills when active, instead of tinting with the category's own color
- Timeline and Backlog entries with no cover art (or a broken cover URL)
  now show an icon on a category-tinted background instead of a blank box
- media sync strips a trailing "S1"/"Season 1"/"B1"/"Book 1" style
  marker from the title before searching (falls back to the untouched
  title if that comes up empty), so personal season/book numbering
  doesn't block a match
- sync status line under the logo: more gap from "LifeLog", less
  leftover empty space below it in the header
- backlog keeps the current category header sticky under the top bar
  while scrolling on mobile, matching the Timeline's sticky year/month
  headers
- fix media sync disconnecting automatically when renaming an entry or
  backlog item — it now only clears via the explicit "✕ Unsync" button;
  picking a match from the "🔄 Sync" button also now sticks the same way
  a title-suggestion pick already did
- moved the sync status indicator (the storage-status LED) out of the
  filter bar and up into the top bar, in a section right under the
  Settings button
- bulk edit for Timeline entries now has a "Sync" action too, same as
  Backlog — re-fetches cover art/metadata for every selected entry from
  its category's configured media source
- Settings → Appearance → Cover art: independent "Timeline cover size"
  and "Backlog cover size" dropdowns, each with None/Small/Big — merged
  the separate show/hide toggle into the size dropdown itself (None
  replaces it) instead of having both a toggle and a dropdown per view
- removed the separate "Enable media enrichment on this device" toggle
  in Settings → Appearance — it was redundant with the per-category
  source dropdowns in the Media tab, which are now always visible and
  are the only on/off switch (set a category to "None" to disable it)

- fix the bulk-edit action bar not showing up / appearing in the wrong
  place — a lingering CSS animation transform on the content area was
  making it a containing block for the bar's `position: fixed`, so it
  floated relative to the content box instead of the viewport
- fix the view jumping/resetting to the top after adding an entry (or
  any other in-view change) — clearing and rebuilding the page's content
  on every render momentarily collapsed its height, and the browser's
  scroll position never recovered; it's now restored afterward
- long-pressing an entry's title text now still lets you select/copy it
  instead of entering bulk mode — long-pressing anywhere else on the row
  (the category chip, badge, padding) enters bulk mode as before
- fix bulk editing not showing up on touch devices — long-pressing an
  entry was fighting the browser's native text-selection/callout gesture
  instead of triggering select mode; rows now disable text selection so
  the long-press timer gets a clean shot at it
- fix bulk editing: tapping a row's checkbox is no longer immediately
  undone by a stray click bubbling up to the row and re-toggling it
- show media pictures (cover art) for journal entries in the Timeline, not
  just the Backlog — with a Settings → Appearance toggle to turn it on/off;
  added the same show/hide toggle for Backlog covers
- mobile navbar: added a subtle shadow and made it slightly taller

- backlog items can now be marked "Dropped" — sinks to the bottom of
  its category section below a separator, shown dimmed with a
  strikethrough title, without deleting it
- backlog items now have a priority star rating (separate from the
  external critic rating) — set it on add/edit, and higher-priority
  items sort to the top of their category section
- a "+" quick-add button on each Backlog category header, same as the
  one on each Timeline month card
- star rating pickers (entry rating, backlog priority) now show a
  distinct hover color vs. the selected/filled color; backlog priority
  uses its own amber scheme matching the priority badge on backlog rows
- adding a backlog item now checks if that title already exists, either
  as another backlog item (duplicate) or as something already logged in
  the journal timeline — surfaced in the title suggestion dropdown and
  an informational banner on exact match; doesn't block saving
- adding a journal entry now also checks the backlog for a matching
  title (not just previous entries): matches show up in the title
  suggestion dropdown tagged "in backlog"; picking one, or typing the
  exact backlog title, links the entry to it and shows a banner saying
  it'll be removed from the backlog on save, with a way to opt out; the
  existing "✓ Done" button on backlog rows now shows the same banner too
- fix a brief flash of the default theme/font/layout on every page
  load/reload — those now apply immediately instead of waiting on the
  data load to finish
- reposition the global Add and Settings buttons: Add is now a floating
  "+" button anchored to the bottom-right corner on every layout;
  Settings moved into its own spot in the header corner, away from Add
  and the view tabs
- Settings → Appearance → "Theme" (Default/Light/Nord/Dracula) color
  scheme picker
- Settings → Appearance → "Force layout" (None/Mobile/PC) to pin the
  responsive layout on this device regardless of actual screen size
- add a "+" button to the top right of each month panel (Journal
  Timeline and Finance) for quick-adding an entry directly to that month
- bulk edit: add a "select all" checkbox to the month header so you can
  select every entry in that month at once (Journal and Finance)
- bulk editing for finance entries (move to category, delete) — same
  long-press mechanism as Journal/Backlog; recurring occurrences aren't
  selectable
- each Finance month card shows a running total (income minus expenses)
  at the bottom
- finance timeline entries now look like journal entries: pill-shaped
  category chip on the right, amount stays on the right, no per-entry
  date (the month card already conveys that)
- make the Finance timeline match the Journal timeline — same sticky
  year/month headers on mobile, and the same year/month panel grouping
- recurring expenses: edit modal now lists every occurrence it has
  generated; replaced "Stop repeating" with a single "Delete" that
  removes the template but keeps everything it already created in
  your history (materialized as real finance entries first)
- bulk editing for timeline entries (move to category, delete) — entered
  via long-press, same mechanism as Backlog; bulk action bar always shows
  while active so Cancel is reachable even with nothing selected
- rework timeline visual: sticky year/month headers on mobile so the
  current year/month stays pinned near the top while scrolling
- remove the journal Categories tab — editing a category now happens via
  the ✎ button on its filter chip (matching Finance); per-category counts
  already live in journal Stats
- version/change history in Settings: keep a small rollback history (not a full audit log) so you can revert to a recent prior state of your data
- add repeating expenses
- centralize import/export in Settings: both the journal data (Timeline/Categories/Backlog) and Finance data should support import/export as CSV and JSON, not just JSON for one and CSV for the other
- tabs menu: group the journal tabs (Timeline, Categories, Stats, Backlog) under a "Journal" header and the finance tabs (Finance, Finance Stats) under a "Finance" header, instead of renaming each individual tab
