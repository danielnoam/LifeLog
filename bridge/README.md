# The LifeLog bridge

How any AI reads and edits LifeLog: an MCP server, the same tools as a
command, and a guide to the data. It runs on your computer with Node 18 or
newer, needs nothing installed, and works on the same `lifelog.json` your
phone and the web app sync. A change it makes reaches your devices on their
next sync, merged in like another device's save.

It runs the app's own code (`src/`) rather than a copy of it. An item is
cleaned by the app's sanitizers, a recurring bill's charges come from the
app's `planCharges`, a habit's streak from `streakOf`. Update the code and
the bridge knows what the app knows.

## Connect it to your data

The bridge needs a GitHub token that can read and write your data repo.

**The quick way:** use the app's setup link. In LifeLog open Settings → Sync
→ Add another device, press Copy, and put the link in
`~/.lifelog-bridge/config.json` (or `LIFELOG_LINK`):
`{ "link": "https://…/#t=…" }`. It carries the same token and repo your
devices use, so it works at once. The catch is that it's the same token: the
AI can do whatever your phone can, and revoking it disconnects everything.

**The safer way:** a token for the bridge alone. Make a fine-grained token on GitHub (Settings → Developer settings →
Fine-grained tokens) with access to **only** `lifelog-data`, and the
permission **Contents: Read and write**. Then either:

- put it in `~/.lifelog-bridge/config.json`:
  `{ "token": "github_pat_…", "owner": "you", "repo": "lifelog-data" }`
- or set `LIFELOG_TOKEN` (and `LIFELOG_REPO=you/lifelog-data`) in the
  environment the AI starts it with.

`owner` defaults to the token's account, `repo` to `lifelog-data`, `path` to
`lifelog.json`, and `branch` to the repo's default. To work on a local copy
instead (a backup, or to try things out), set `LIFELOG_LOCAL_FILE` to its
path. `LIFELOG_CONFIG` points at a different config file, and
`LIFELOG_STATE_DIR` at where the undo history is kept (default
`~/.lifelog-bridge`).

## Use it

**An MCP client** (Telemachus, Claude Desktop or Code, Cursor, ...): a stdio
server with the command `node` and the argument
`<path to LifeLog>/bridge/mcp.js`. For Claude Code:

```
claude mcp add lifelog -e LIFELOG_TOKEN=github_pat_… -- node /path/to/LifeLog/bridge/mcp.js
```

**Anything that runs commands** (Codex, a script, a shortcut):

```
node bridge/cli.js                                  # every tool and its options
node bridge/cli.js spending --start_date 2026-09-01 --group_by month
node bridge/cli.js add_expense --amount 42 --category Food --note "Lunch"
```

The guide to the data is `DATA.md`, also served to MCP clients as the
resource `lifelog://guide` and by the tool `lifelog_guide`.

## The tools

Reading: `lifelog_overview` (start here), `lifelog_guide`, `lifelog_search`,
`lifelog_get`, `lifelog_timeline`, `lifelog_backlog`, `lifelog_notes`,
`lifelog_expenses`, `lifelog_spending`, `lifelog_recurring`,
`lifelog_habits`, `lifelog_accomplishments`, `lifelog_boards`,
`lifelog_trips`.

Changing: `lifelog_add_expense`, `lifelog_add_timeline_entry`,
`lifelog_add_backlog_item`, `lifelog_finish_backlog_item`,
`lifelog_add_note`, `lifelog_update_list`, `lifelog_mark_habit`,
`lifelog_update_item`, `lifelog_delete_item`,
`lifelog_add_accomplishment`, `lifelog_update_accomplishment`,
`lifelog_delete_accomplishment`, `lifelog_rename_category`,
`lifelog_edit_recurring_charge`, `lifelog_pause_recurring`,
`lifelog_update_board`, `lifelog_delete_board`, `lifelog_add_trip`,
`lifelog_update_trip`, `lifelog_delete_trip`, `lifelog_add_place`,
`lifelog_update_place`, `lifelog_delete_place`, `lifelog_undo`.

Every change is checked first: categories and projects must exist, and the
result must be something the app itself would keep, or it's refused with the
reason. `lifelog_undo` reverses the last change made through the bridge on
this computer, and won't overwrite an edit made since without `force`.

What it never does: show your settings (they hold API keys), or draw on a
board.

## Files

- `mcp.js`: the MCP server (JSON-RPC over stdio, no SDK).
- `cli.js`: the same tools as a command.
- `tools.js`: the tools themselves, one table for both.
- `store.js`: reading and saving the files (`lifelog.json`, and
  `boards.json` and `travel.json` beside it), on GitHub or local, and the
  undo history.
- `load.js`: loads the app's own modules into Node.
- `DATA.md`: every collection and field.

Tests: `node test/bridge.test.js` (part of `node test/run-all.js`).
