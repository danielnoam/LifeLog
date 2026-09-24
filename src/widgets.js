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
  function snapshotOf(data, { today, actions = [], remindAt = () => "", runBefore = () => 0 } = {}) {
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

    // The to-do view's panels, in its order: the general list, then each
    // category in the order its list holds them, then any a to-do names that
    // the list has lost — todos.js's panelGroups. Inside each, the same as a
    // panel: open ones by hand order, then the finished ones, newest first,
    // which the widget draws under an "N done" line. Finished ones are capped
    // per panel (DONE_PER_PANEL) — they pile up until cleared, and this goes
    // out on every save; `doneCount` keeps the line honest about the rest.
    const cats = data.todoCategories || [];
    const colorOf = (name) => (cats.find((c) => c.name === name) || {}).color || null;
    const groups = new Map([["", []]]);
    for (const c of cats) groups.set(c.name, []);
    for (const t of data.todos || []) {
      const key = t.category || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    const todos = [];
    const doneCount = {};
    for (const [name, list] of groups) {
      const color = (name && colorOf(name)) || "";
      const row = (t) => ({ id: t.id, text: t.text, category: name, color, done: !!t.done });
      const open = list.filter((t) => !t.done).sort(byOrder);
      const done = list.filter((t) => t.done).sort(byNewestDone);
      if (done.length) doneCount[name] = done.length;
      for (const t of open) todos.push(row(t));
      for (const t of done.slice(0, DONE_PER_PANEL)) todos.push(row(t));
    }
    return { v: 3, today, habits, todos, doneCount, actions };
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
        const t = (data.todos || []).find((x) => x.id === it.id);
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

  function push() {
    clearTimeout(pushTimer);
    pushTimer = null;
    const W = plugin();
    if (!W) return;
    const R = window.LifeLogReminders;
    const H = window.LifeLogHabits;
    const snap = snapshotOf(ctx.state.data, {
      today: localDate(new Date()),
      actions: ctx.quickActions(),
      remindAt: R ? R.remindAt : undefined,
      runBefore: H ? H.runBefore : undefined,
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

  window.LifeLogWidgets = { snapshotOf, applyQueue, start, changed, MARK_DAYS, DONE_PER_PANEL };
})();
