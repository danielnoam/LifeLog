todo:

Ideas that turned out not to be worth doing, or not to be possible, live in
DROPPED.md rather than sitting here unread.

- Notes: a running feed of things you write as you notice them, as a second
  mode of Timeline rather than a sixth tab — the phone's bottom nav is full,
  which is the same reason Discover became a mode of Backlog (NOTES.md).
  No images; why not is in DROPPED.md.

  A note is text and nothing else. No title, no category, no rating: the
  point is that writing one costs nothing.

    id         as everywhere else
    text       the note
    createdAt  full ISO, time included — a note is a moment, not a month
    editedAt   set only when *you* save an edit, and shown as "edited …"
    updatedAt  the sync layer's, stamped on any content change

  editedAt is deliberately not updatedAt: stampChangedItems touches
  updatedAt for any change at all, a field migration included, and "you
  edited this" has to mean you did.

  Most of the wiring is already there. `notes` in COLLECTION_KEYS
  (merge.js) buys three-way merge, per-note conflict resolution and undelete
  for free; sanitizeNote + keepUnknown match every other collection;
  TRASH_COLLECTIONS (settings.js) and the shared search want a line each.

  Layout: a mode switch in timelineToolbar (Entries / Notes), notes grouped
  year → month like entries so the view keeps its shape, each note a panel
  showing day and time, newest first. state.timelineMode rides in UI_KEY
  next to backlogMode. New module src/notes.js rather than growing
  journal.js, which is already 1481 lines.

  Open: whether a note can be turned into a timeline entry, and whether the
  month grouping earns its keep once there are a few hundred of them.

- an Early Access flag can only ever be set by a Steam sync. Every other
  release field can be pinned by hand in the backlog modal's Advanced
  foldout — date, precision, status — but earlyAccess has no input, so a
  GOG or itch game in Early Access can't say so and Steam can't be
  corrected when it's wrong. The pin machinery already covers the field
  (MEDIA_FIELD_PINS maps it to "release"); it needs a checkbox in
  OVERRIDE_FIELDS' release entry and its pull/push

- Discover could answer "what's hot on the services I actually have" via
  TMDB's watch-provider filter (/discover with with_watch_providers +
  watch_region). The nearest thing to the Netflix browsing this was
  originally asked for (see DROPPED.md)

---

Two neighbours: **NOTES.md** carries the reasoning behind what's already
shipped — read it before changing something that looks arbitrary — and
**DROPPED.md** is what was decided against, so the same idea doesn't get
re-litigated every few months.
