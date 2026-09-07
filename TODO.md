todo:

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

- an Early Access flag can only ever be set by a Steam sync. Every other
  release field can be pinned by hand in the backlog modal's Advanced
  foldout — date, precision, status — but earlyAccess has no input, so a
  GOG or itch game in Early Access can't say so and Steam can't be
  corrected when it's wrong. The pin machinery already covers the field
  (MEDIA_FIELD_PINS maps it to "release"); it needs a checkbox in
  OVERRIDE_FIELDS' release entry and its pull/push

- Notes, deliberately left out of the first cut: no bulk select (the
  timeline's long-press machinery would carry over), and no way to turn a
  note into a timeline entry — "started Silksong" becoming a finished entry
  is an obvious bridge, but it wants using the feed first to know what shape
  it should take. Whether the year -> month grouping earns its keep at a few
  hundred notes is the other thing only use will answer

- Discover could answer "what's hot on the services I actually have" via
  TMDB's watch-provider filter (/discover with with_watch_providers +
  watch_region). The nearest thing to the Netflix browsing this was
  originally asked for (see DROPPED.md)

---

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
