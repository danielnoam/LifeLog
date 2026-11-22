### Added
- A Trello board comes in as one task list, with each of its lists a section that folds under its name, instead of a task list per list. Moving a task to another section (in its sheet's Trello list row, or by dragging it while reordering) moves its card to that list, and ticking one moves its card to the board's Done list (unless ticking archives). Your Trello task lists join up into their board's at the next sync, keeping every task.
- Settings → Connections → Trello: each board has a Bring in this board switch, a One task list for the board switch (off gives a task list per list, as before), and a switch for each of its lists. The board's Done list has none: it's where ticked tasks go.
- The bridge: lifelog_task_section moves a task between sections; lifelog_trello shows each list's section.

### Changed
- The Tasks widget lists a board's tasks section by section. It doesn't draw the section names yet.
