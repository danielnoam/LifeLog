todo:

- **rework the Settings panel.** It has grown by accretion — every feature
  that needed a switch added one where it fitted, and the result reads as a
  list of everything the app can be told rather than as anything designed.
  Appearance is the worst of it: theme, font, month layout, cover size, the
  three band-fold dropdowns and the force-layout override all sit as
  equal-weight rows, so the two you actually change are buried among the ones
  you set once. Worth starting from what a person opens Settings *to do*
  rather than from the fields that exist.

- **let each tab, and each mode within a tab, be turned off.** Not everyone
  wants four tabs: someone using this purely as a ledger should be able to
  have Finance and nothing else, and someone who only journals shouldn't
  carry Backlog's chrome. Same one level down — Timeline without Stats,
  Finance without Summary, Notes without the to-do list.

  Things it has to not break, all of which currently assume every view
  exists: `VIEW_ORDER` and the tab bar, `VIEW_MODES` and the swipe between
  modes (`modeIds`), the mode dots and the mode fan, `updateSearchMatchBadges`
  (which counts matches in views you're not looking at — a hidden view should
  presumably not badge), the jump-nav's per-view selector, and whatever the
  app lands on at boot if the saved `state.view` is now disabled. The last
  one is the trap: turning off the tab you were last on must not open to a
  blank page.

- **a real year in review, one per year, that arrives in December.** The
  present "Year in Review" card in Journal Stats is a stats block with a year
  picker on top — accurate, and nothing anyone looks forward to. The thing
  worth building is the Steam/Spotify recap shape: a sequence you move
  through, one fact at a time, each one framed rather than tabulated — what
  you finished, what took longest, the month you did most, the thing you
  rated highest, how it compares with last year — drawing on all four views,
  since the point of this app is that they are one record.

  It should offer itself in December rather than waiting to be found, and be
  openable for any past year afterwards, not only the current one.

  And the existing card needs a different name once this exists, because two
  things called "Year in Review" is worse than either. It is a per-year
  breakdown of the Journal — "That year in numbers", or fold it into Stats as
  a year filter and let the recap own the name.

---

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
