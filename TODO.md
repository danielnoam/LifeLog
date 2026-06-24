todo:

- add a "+" button to the top right of each month panel (Timeline) for
  quick-adding an entry directly to that month
- bulk edit: add a "select all" checkbox to the month header so you can
  select every entry in that month at once

done:

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
