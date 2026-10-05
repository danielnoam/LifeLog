// LifeLog's own code, loaded into Node for the bridge.
//
// The bridge never re-implements what the app decides: an item is cleaned by
// the app's own sanitizer, a recurring plan's charges come from planCharges,
// a streak from streakOf, a save is stamped by merge.js. Loading them is the
// same trick test/app.test.js uses: just enough window/document/localStorage
// for the modules' top-level code to run, and app.js's `module` guard skips
// the browser bootstrap. So when the app changes how something works, the
// bridge changes with it, from the same files.
"use strict";

let loaded = null;

function load() {
  if (loaded) return loaded;
  const mem = new Map();
  global.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  global.document = {
    documentElement: { style: { setProperty: () => {} }, classList: { toggle: () => {} } },
    querySelector: () => null,
  };
  global.window = global.window || {};
  window.LifeLogWheel = { init: () => {} };
  const src = (f) => require("../src/" + f);
  const Merge = src("merge.js");
  src("finance.js");
  src("journal.js");
  src("backlog.js");
  src("notes.js");
  src("habits.js");
  src("recap.js");
  src("boards.js");
  src("travel.js");
  src("widgets.js");
  window.LifeLogIO = { init: () => {} };
  window.LifeLogSync = { init: () => {} };
  window.LifeLogSettings = { init: () => {} };
  window.LifeLogStorage = {};
  const uid = () => "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const backfillUpdatedAt = (item) => item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z";
  for (const m of ["LifeLogFinance", "LifeLogJournal", "LifeLogBacklog"]) window[m].init({ uid, backfillUpdatedAt });
  const App = src("app.js");
  const appSource = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "app.js"), "utf8");
  const version = (/APP_VERSION = "([^"]+)"/.exec(appSource) || [])[1] || "";
  loaded = {
    App, Merge, uid, version,
    Finance: window.LifeLogFinance,
    Journal: window.LifeLogJournal,
    Backlog: window.LifeLogBacklog,
    Notes: window.LifeLogNotes,
    Habits: window.LifeLogHabits,
    Widgets: window.LifeLogWidgets,
    Boards: window.LifeLogBoards,
    Travel: window.LifeLogTravel,
  };
  return loaded;
}

module.exports = { load };
