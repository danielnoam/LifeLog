// LifeLog — the Android app's home-screen widgets, from the app's side.
//
// The widgets themselves are native (native/widgets/, a local Capacitor
// plugin) and can't run any of this app. So the traffic is two one-way
// streams through the Widgets plugin:
//
//   - out: a snapshot of what the widgets show — today's habits and their
//     marks, the open to-dos in the app's own order, which quick-add buttons
//     make sense — sent whenever the data changes;
//   - in: ticks made on a widget, queued natively and applied here the next
//     time the app runs, where they save and sync like any other tick.
//
// The widget can't reach GitHub, which is the one thing a user has to be told:
// a tick made there shows at once but only syncs when the app next runs. The
// widget says so itself while it has ticks waiting.
//
// snapshotOf and applyQueue are pure and tested in test/widgets.test.js; the
// rest is wiring that only runs in the app.
(function () {
  // Marks sent per habit: enough for today and a day either side of a
  // midnight the app didn't see. The whole map would be ~1,100 dates for a
  // habit kept three years, sent on every save.
  const MARK_DAYS = 7;
  const DONE_PER_PANEL = 30;
  // The note widgets' share (0.199.0). A widget shows a few hundred
  // characters at most, so that's all a note sends; and the whole lot stops
  // at a budget, pinned notes first, then favourites, then newest, since
  // this goes out on every save and is parsed on every widget redraw.
  const NOTE_CHARS = 400;
  const NOTE_ITEMS = 8;
  const NOTES_BUDGET = 150000;

  const pad = (n) => String(n).padStart(2, "0");
  const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (dateStr, n) => {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return localDate(d);
  };
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

  const byNewestDone = (a, b) => String(b.doneAt || "").localeCompare(String(a.doneAt || ""));
  const byOrder = (a, b) => (+a.order || 0) - (+b.order || 0) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));

  // What every widget draws from. `actions` are the quick-add buttons worth
  // showing — a button for a tab you've turned off opens nothing.
  // remindAt and runBefore come from reminders.js and habits.js in the app;
  // left out, nothing is reminded and every run starts at nought.
  function snapshotOf(data, { today, actions = [], remindAt = () => "", runBefore = () => 0, spend = null, pins = [] } = {}) {
    const since = addDays(today, -MARK_DAYS);
    const until = addDays(today, 1);
    const habits = (data.habits || [])
      .filter((h) => !h.archivedAt)
      .slice()
      .sort(byOrder)
      .map((h) => {
        const marks = {};
        for (const [d, v] of Object.entries(h.marks || {})) if (d >= since && d <= until) marks[d] = v;
        return {
          id: h.id,
          name: h.name,
          color: h.color,
          target: h.target || 1,
          days: h.cadence && Array.isArray(h.cadence.days) ? h.cadence.days : null,
          startedAt: h.startedAt || "",
          marks,
          runBefore: runBefore(h, today),
          remind: remindAt(h.id) || "",
        };
      });

    // The to-do widget's panels are the list notes (0.197.0): a panel per
    // list, favourites first, then oldest first — so the lists that came from
    // the To-do mode keep the order its panels had. The rows are the shape
    // the widget has always drawn (a panel is its `category`), so no new APK
    // is needed. Inside each: open items in the list's order, then the
    // finished ones, newest first, under an "N done" line. Finished ones are
    // capped per panel (DONE_PER_PANEL) — they pile up until cleared, and this
    // goes out on every save; `doneCount` keeps the line honest about the
    // rest. Two lists with one title get told apart, since the widget groups
    // by the name.
    const noteCats = data.noteCategories || [];
    const colorOf = (name) => (noteCats.find((c) => c.name === name) || {}).color || "";
    const lists = (data.notes || []).filter((n) => n.kind === "list")
      .sort((a, b) => (!!b.fav - !!a.fav) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const todos = [];
    const doneCount = {};
    // Every list, empty ones too, for the widget's settings to offer and a
    // one-list widget to name (0.199.0). Rows say which list by id.
    const listsOut = [];
    const seen = new Map();
    for (const n of lists) {
      const base = n.text || "List";
      const k = (seen.get(base) || 0) + 1;
      seen.set(base, k);
      const name = k > 1 ? `${base} (${k})` : base;
      const color = n.category ? colorOf(n.category) : "";
      listsOut.push({ id: n.id, name, color });
      const row = (it) => ({ id: it.id, text: it.text, category: name, list: n.id, color, done: !!it.done });
      const items = n.items || [];
      const open = items.filter((it) => !it.done);
      const done = items.filter((it) => it.done).sort(byNewestDone);
      if (done.length) doneCount[name] = done.length;
      for (const it of open) todos.push(row(it));
      for (const it of done.slice(0, DONE_PER_PANEL)) todos.push(row(it));
    }
    return { v: 4, today, habits, todos, doneCount, lists: listsOut, actions, spend, ...notesOf(data, pins) };
  }

  // What the note widgets pick from: each note cut to what a widget can
  // show, a list as its title and first open items. `date` is formatted
  // here, where the locale is the app's.
  function notesOf(data, pins) {
    const noteCats = data.noteCategories || [];
    const colorOf = (name) => (noteCats.find((c) => c.name === name) || {}).color || "";
    const cut = (t, n) => { t = String(t || "").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
    const pinned = new Set(pins);
    const rank = (n) => (pinned.has(n.id) ? 2 : 0) + (n.fav ? 1 : 0);
    const sorted = (data.notes || []).slice()
      .sort((a, b) => rank(b) - rank(a) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const notes = [];
    let used = 0;
    for (const n of sorted) {
      const kind = n.kind === "list" || n.kind === "quote" ? n.kind : "text";
      const out = { id: n.id, kind, text: cut(n.text, NOTE_CHARS) };
      if (kind === "text" && n.title) out.title = cut(n.title, 120);
      if (n.category) { out.category = n.category; out.color = colorOf(n.category); }
      if (n.fav) out.fav = true;
      if (kind === "quote") for (const k of ["author", "source"]) if (n[k]) out[k] = cut(n[k], 80);
      if (kind === "list") {
        const open = (n.items || []).filter((it) => !it.done);
        out.items = open.slice(0, NOTE_ITEMS).map((it) => cut(it.text, 80));
        out.open = open.length;
      }
      const d = new Date(n.createdAt || 0);
      if (n.createdAt && !isNaN(d)) out.date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      if (!out.text && !out.title && !(out.items || []).length) continue;
      used += JSON.stringify(out).length;
      if (used > NOTES_BUDGET && !pinned.has(n.id)) break;
      notes.push(out);
    }
    return { notes, noteCount: (data.notes || []).length, noteCats: noteCats.map((c) => ({ name: c.name, color: c.color || "" })) };
  }

  // Ticks from a widget, onto the data. Anything that has gone since the
  // tick (deleted on another device, say) is skipped rather than recreated.
  // Returns how many actually changed something.
  function applyQueue(data, items) {
    let changed = 0;
    for (const it of items || []) {
      if (!it || !it.id) continue;
      if (it.kind === "habit") {
        const h = (data.habits || []).find((x) => x.id === it.id);
        if (!h || !isDate(it.date)) continue;
        const v = Math.max(0, Math.round(+it.value) || 0);
        const marks = { ...(h.marks || {}) };
        if ((+marks[it.date] || 0) === v) continue;
        if (v) marks[it.date] = v; else delete marks[it.date];
        if (Object.keys(marks).length) h.marks = marks; else delete h.marks;
        changed++;
      } else if (it.kind === "todo") {
        // An item of a list note now (0.197.0); the widget still calls it a to-do.
        let t = null;
        for (const n of data.notes || []) {
          if (n.kind === "list") t = (n.items || []).find((x) => x.id === it.id) || t;
          if (t) break;
        }
        if (!t || !!t.done === !!it.done) continue;
        if (it.done) { t.done = true; t.doneAt = it.at || new Date().toISOString(); }
        else { delete t.done; delete t.doneAt; }
        changed++;
      }
    }
    return changed;
  }

  // ---------- the app's side ----------
  let ctx = null;
  let pushTimer = null;
  const plugin = () => (ctx && ctx.Platform.plugin("Widgets")) || null;

  async function push() {
    clearTimeout(pushTimer);
    pushTimer = null;
    const W = plugin();
    if (!W) return;
    // The notes pinned to a widget always travel, however far down the
    // budget they'd fall. An APK older than 0.199.0 hasn't the method.
    let pins = [];
    try { pins = ((await W.notePins()) || {}).ids || []; } catch (e) { /* none */ }
    const R = window.LifeLogReminders;
    const H = window.LifeLogHabits;
    const snap = snapshotOf(ctx.state.data, {
      today: localDate(new Date()),
      actions: ctx.quickActions(),
      remindAt: R ? R.remindAt : undefined,
      runBefore: H ? H.runBefore : undefined,
      spend: ctx.spend ? ctx.spend() : null,
      pins,
    });
    Promise.resolve(W.update({ json: JSON.stringify(snap) })).catch(() => { /* the widget keeps its last copy */ });
  }

  // Called on every data change; one snapshot for a burst of them.
  function changed() {
    if (!plugin()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 400);
  }

  let draining = null;
  function drain() {
    const W = plugin();
    if (!W) return Promise.resolve();
    if (draining) return draining;
    draining = (async () => {
      try {
        const res = await W.takeQueue();
        const n = applyQueue(ctx.state.data, (res && res.items) || []);
        if (n) {
          ctx.afterDataChange();
          await ctx.persist();
          ctx.toast(n === 1 ? "Added a tick from your home-screen widget" : "Added " + n + " ticks from your home-screen widget");
        }
      } catch (e) { /* the queue stays for next time */ }
      finally { draining = null; }
      push();
    })();
    return draining;
  }

  async function takeAction() {
    const W = plugin();
    if (!W) return;
    try {
      const res = await W.takeLaunchAction();
      if (res && res.action) ctx.runAction(res.action);
    } catch (e) { /* nothing to open */ }
  }

  // ctx: { state, Platform, persist, afterDataChange, toast, runAction, quickActions }
  function start(c) {
    ctx = c;
    const W = plugin();
    if (!W) return;
    W.addListener("queued", () => drain());
    W.addListener("action", () => takeAction());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") drain();
      else push(); // leaving: the widget should show what was just done
    });
    drain();
    takeAction();
  }

  window.LifeLogWidgets = { snapshotOf, applyQueue, start, changed, MARK_DAYS, DONE_PER_PANEL, NOTE_CHARS, NOTES_BUDGET };
})();
