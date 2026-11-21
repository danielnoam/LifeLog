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
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  // Settings → Dates (0.301.0). Under Node nothing loaded dates.js.
  const Dates = () => window.LifeLogDates || require("./dates.js");

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
  // The two Backlog widgets' rows (0.277.0), by the app's own rules:
  // `upcomingAt` and `releaseLabel` are backlog.js's, handed in like
  // remindAt, so a widget can't disagree with the Upcoming mode. Capped:
  // a home screen shows a handful, and this goes out on every save.
  const BACKLOG_ROWS = 12;
  function backlogRows(data, today, upcomingAt, releaseLabel) {
    const cats = data.categories || [];
    const colorOf = (name) => (cats.find((c) => c.name === name) || {}).color || "";
    const backlog = (data.backlog || []).filter((b) => !b.dropped);
    const upcoming = backlog
      .map((b) => ({ b, day: String(upcomingAt(b) || "") }))
      .filter((x) => x.day && x.day >= today)
      .sort((x, y) => x.day.localeCompare(y.day) || (!!y.b.priority - !!x.b.priority) || String(x.b.title).localeCompare(String(y.b.title)))
      .slice(0, BACKLOG_ROWS)
      .map(({ b, day }) => {
        // A next episode and a day-exact release are dated to the day, and
        // the widget counts down to them itself (it has a clock; the
        // snapshot may be days old). Anything vaguer carries its words.
        const exact = b.nextAt === day || ((b.releasePrecision || "day") === "day" && String(b.releaseDate || "").slice(0, 10) === day);
        return {
          id: b.id, title: b.title, category: b.category, color: colorOf(b.category), day, exact,
          // Written here so the widget's dates read like the app's (0.301.0).
          dayText: Dates().day(day, { year: day.slice(0, 4) !== today.slice(0, 4) }),
          when: exact ? "" : String(releaseLabel(b) || "").replace(/^Sometime in /, ""),
          label: b.nextAt === day ? (b.nextLabel || "") : "",
          starred: !!b.priority,
        };
      });
    const inProgress = backlog
      .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(String(b.startedAt || "")))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || String(a.title).localeCompare(String(b.title)))
      .slice(0, BACKLOG_ROWS)
      .map((b) => ({ id: b.id, title: b.title, category: b.category, color: colorOf(b.category), startedAt: b.startedAt, startedText: Dates().day(b.startedAt, { year: b.startedAt.slice(0, 4) !== today.slice(0, 4) }), length: b.length || "" }));
    return { upcoming: withTasks(upcoming, data, today), inProgress };
  }
  // Dated open tasks join the Upcoming widget (0.317.0), as Home's Coming
  // up has them: overdue ones first, then by day among the releases, up to
  // a fortnight ahead. `kind: "task"` tells the widget to keep an overdue
  // one rather than drop it as past, and to word its day itself.
  const TASK_DAYS = 14;
  function withTasks(upcoming, data, today) {
    const T = typeof window !== "undefined" && window.LifeLogTasks;
    if (!T) return upcoming;
    const tasks = T.dueTasks(data, addDays(today, TASK_DAYS)).map((r) => {
      const t = { id: r.item.id, kind: "task", title: r.item.text, list: r.note.text || "", day: r.day,
        dayText: Dates().day(r.day, { year: r.day.slice(0, 4) !== today.slice(0, 4) }) };
      if (r.item.time) t.time = r.item.time;
      if (r.item.priority) t.priority = r.item.priority;
      return t;
    });
    return [...tasks, ...upcoming].sort((a, b) => a.day.localeCompare(b.day) || (a.kind === "task" ? -1 : 0) - (b.kind === "task" ? -1 : 0))
      .slice(0, BACKLOG_ROWS);
  }

  // The Calendar widget (Nov 2026): every day from the start of last month
  // to the end of the month after next, each as the Home calendar has it
  // (Home.calendarMonth: tasks due, backlog releases and next episodes,
  // entries finished) plus Google Calendar's events, which live on this
  // device only. `monthOf(y, m)` is calendarMonth bound to the app's
  // modules; `eventsOf(y, m)` gcal.js's eventsFor and `calColor` its
  // colorOf. A day sends its first CAL_PER_DAY; the widget says "N more".
  // Each item: k ("event" | "task" | "release" | "done"), t, time, c (a
  // colour), and on an event `all` for all day.
  const CAL_PER_DAY = 8;
  function calendarDays(data, today, { monthOf, eventsOf = () => new Map(), calColor = () => "" } = {}) {
    const cats = data.categories || [];
    const colorOf = (name) => (cats.find((c) => c.name === name) || {}).color || "";
    const [ty, tm] = today.split("-").map(Number);
    const days = {};
    for (let i = -1; i <= 2; i++) {
      const d0 = new Date(ty, tm - 1 + i, 1);
      const y = d0.getFullYear(), m = d0.getMonth() + 1;
      const mo = monthOf ? monthOf(y, m) : null;
      const evs = eventsOf(y, m) || new Map();
      const last = new Date(y, m, 0).getDate();
      for (let d = 1; d <= last; d++) {
        const out = [];
        for (const ev of evs.get(d) || []) {
          const x = { k: "event", t: String(ev.title || ""), c: calColor(ev.cal) || "" };
          if (ev.allDay) x.all = true;
          else if (ev.time) x.time = ev.start === `${y}-${pad(m)}-${pad(d)}` ? ev.time : "";
          out.push(x);
        }
        if (mo) {
          for (const r of mo.tasksByDay.get(d) || []) {
            const x = { k: "task", t: String(r.item.text || "") };
            if (r.item.time) x.time = r.item.time;
            if (r.item.priority) x.p = r.item.priority;
            out.push(x);
          }
          for (const r of mo.rel.byDay.get(d) || []) {
            const b = r.b;
            out.push({ k: "release", t: String(b.title || "") + (r.kind === "episode" && b.nextLabel ? " · " + b.nextLabel : ""), c: colorOf(b.category) });
          }
          for (const e of mo.byDay.get(d) || []) out.push({ k: "done", t: String(e.title || ""), c: colorOf(e.category) });
        }
        if (!out.length) continue;
        // All day first, then by the clock; untimed after, in the order above.
        const rank = (x) => (x.all ? "0" : x.time ? "1" + x.time : "2");
        const order = out.map((x, i) => [x, i]).sort((a, b) => rank(a[0]).localeCompare(rank(b[0])) || a[1] - b[1]).map((p) => p[0]);
        days[`${y}-${pad(m)}-${pad(d)}`] = { n: order.length, items: order.slice(0, CAL_PER_DAY) };
      }
    }
    return days;
  }

  function snapshotOf(data, { today, actions = [], remindAt = () => "", runBefore = () => 0, spend = null, pins = [], upcomingAt = () => "", releaseLabel = () => "", currencySymbol = "" } = {}) {
    const since = addDays(today, -MARK_DAYS);
    const until = addDays(today, 1);
    // A weekly, monthly or yearly goal (0.300.0) is counted over its whole
    // period, so it sends every mark since the period began; the widget
    // works out which period it's in by itself, as it does what's due.
    const periodFrom = (period) => {
      if (period === "week") return Dates().startOfWeek(today);
      if (period === "month") return today.slice(0, 8) + "01";
      if (period === "year") return today.slice(0, 5) + "01-01";
      return today;
    };
    const PERIODS = ["week", "month", "year"];
    const habits = (data.habits || [])
      .filter((h) => !h.archivedAt)
      .slice()
      .sort(byOrder)
      .map((h) => {
        const marks = {};
        const period = !h.avoid && PERIODS.includes(h.period) ? h.period : null;
        const from = period ? periodFrom(period) : since;
        const first = from < since ? from : since;
        for (const [d, v] of Object.entries(h.marks || {})) if (d >= first && d <= until) marks[d] = v;
        return {
          id: h.id,
          name: h.name,
          color: h.color,
          target: h.target || 1,
          days: h.cadence && Array.isArray(h.cadence.days) ? h.cadence.days : null,
          startedAt: h.startedAt || "",
          marks,
          runBefore: runBefore(h, today),
          remind: h.avoid ? "" : remindAt(h.id) || "",
          // Something you avoid (0.203.0): the marks are slips, kept while
          // they stay at or under the limit.
          ...(h.avoid ? { avoid: true, limit: +h.limit || 0 } : {}),
          // A goal: `runBefore` is then periods met in a row before the one
          // `periodFrom` starts, and a timed habit's marks are minutes.
          // weekStart (0.301.0): the widget works out the current week itself.
          ...(period ? { period, periodFrom: from, ...(period === "week" ? { weekStart: Dates().weekStart() } : {}) } : {}),
          ...(!h.avoid && h.unit === "min" ? { unit: "min" } : {}),
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
    // What else the app's task line shows (0.319.1), for a widget that
    // shows details: the repeat in words, a reminder, the deadline, the
    // task's own category when it isn't its list's, its tags, and the first
    // line of its description. The widget can turn each part off.
    const T = typeof window !== "undefined" && window.LifeLogTasks;
    const taskDetails = (n, it, head) => {
      const out = {};
      if (it.repeat && T) out.repeatText = T.repeatText(it.repeat);
      if (it.remind != null && it.date) out.remind = true;
      if (it.deadline) {
        out.deadline = it.deadline;
        out.deadlineText = Dates().day(it.deadline, { year: it.deadline.slice(0, 4) !== today.slice(0, 4) });
      }
      if (!head) {
        const own = T ? T.categoryOf(n, it) : it.category || "";
        if (own && own !== (n.category || "")) { out.own = own; const c = colorOf(own); if (c) out.ownColor = c; }
        if (Array.isArray(it.tags) && it.tags.length) out.tags = it.tags.slice(0, 4);
      }
      const desc = String(it.note || "").split("\n").map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\[[ xX]\]\s+)*/, "").replace(/[*_`~]/g, "").trim()).find(Boolean);
      if (desc) out.desc = desc.slice(0, 140);
      return out;
    };
    const lists = (data.notes || []).filter((n) => n.kind === "list" && !n.template)
      .sort((a, b) => (!!b.fav - !!a.fav) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const todos = [];
    const doneCount = {};
    // Every list, empty ones too, for the widget's settings to offer and a
    // one-list widget to name (0.199.0). Rows say which list by id.
    const listsOut = [];
    const seen = new Map();
    for (const n of lists) {
      const base = n.text || "Tasks";
      const k = (seen.get(base) || 0) + 1;
      seen.set(base, k);
      const name = k > 1 ? `${base} (${k})` : base;
      const color = n.category ? colorOf(n.category) : "";
      // The list is a task itself (0.318.0): its heading carries its own
      // tick, priority and day, as the card's head does.
      const head = { id: n.id, name, color };
      if (n.done) head.done = true;
      else {
        if (n.priority) head.priority = n.priority;
        if (n.date) { head.date = n.date; head.dateText = Dates().day(n.date, { year: n.date.slice(0, 4) !== today.slice(0, 4) }); }
        if (n.time && n.date) head.time = n.time;
        if (n.repeat) head.meta = "repeats";
        Object.assign(head, taskDetails(n, n, true));
      }
      listsOut.push(head);
      // Tasks (tasks.js): a task's second line (0.317.0) is its date, then
      // whether it repeats. Rows don't nest since 0.318.0.
      // The date goes as a day, not words: the widget words it by the
      // phone's clock ("Overdue", "Today 18:00"), since this snapshot can be
      // days old by the time it's read. `dateText` is for a day further off.
      const all = n.items || [];
      const row = (it) => {
        const out = { id: it.id, text: it.text, category: name, list: n.id, color, done: !!it.done };
        if (it.done) return out;
        const meta = it.repeat ? "repeats" : "";
        if (it.date) { out.date = it.date; out.dateText = Dates().day(it.date, { year: it.date.slice(0, 4) !== today.slice(0, 4) }); }
        if (it.time && it.date) out.time = it.time;
        if (meta) out.meta = meta;
        if (it.priority) out.priority = it.priority;
        return Object.assign(out, taskDetails(n, it, false));
      };
      const items = all;
      const open = items.filter((it) => !it.done);
      const done = items.filter((it) => it.done).sort(byNewestDone);
      if (done.length) doneCount[name] = done.length;
      for (const it of open) todos.push(row(it));
      for (const it of done.slice(0, DONE_PER_PANEL)) todos.push(row(it));
    }
    // `currency` (0.238.0): a Google Wallet payment in it gets an Add button
    // on the phone; one in any other needs the form, for its rate.
    const currency = (data.settings && data.settings.currency) || "ILS";
    return { v: 4, today, habits, todos, doneCount, lists: listsOut, actions, spend, currency, currencySymbol, ...quickChoices(data), ...notesOf(data, pins), ...backlogRows(data, today, upcomingAt, releaseLabel) };
  }

  // What the quick-add window (QuickAddActivity) offers to pick from: the
  // timeline's categories (an entry's and a backlog item's) and the
  // Ledger's, with their subcategories. The note categories and the lists
  // already travel for the note and to-do widgets.
  function quickChoices(data) {
    return {
      entryCats: (data.categories || []).map((c) => ({ name: c.name, color: c.color || "" })),
      financeCats: (data.financeCategories || []).map((c) => ({ name: c.name, color: c.color || "", subs: (c.subs || []).map((s) => s.name) })),
    };
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
    const sorted = (data.notes || []).filter((n) => !n.template)
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
      if (n.createdAt && !isNaN(d)) out.date = Dates().day(d);
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
  //
  // The quick-add window's adds ride the same queue: an entry, a backlog
  // item, a note, a list item, or an expense with its category picked.
  // Each carries an id made on the phone, so one drained twice is added
  // once. A category that has gone since falls back the way a form would:
  // the first one (an expense: where its note went last time).
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
          if (n.kind === "list") t = (n.id === it.id ? n : (n.items || []).find((x) => x.id === it.id)) || t;
          if (t) break;
        }
        if (!t || !!t.done === !!it.done) continue;
        // A reminder's Done (0.317.0) is for the date it rang about; a
        // repeating task ticked since has moved on, and stays as it is.
        if (it.due && t.date && t.date !== it.due) continue;
        // Through tasks.js where it's loaded, so a repeating task ticked on
        // the widget moves to its next date and a task's subtasks tick too.
        const list = (data.notes || []).find((n) => n.kind === "list" && (n === t || (n.items || []).includes(t)));
        if (window.LifeLogTasks && list) window.LifeLogTasks.tick(list, t.id, !!it.done, it.at ? new Date(it.at) : new Date());
        else if (it.done) { t.done = true; t.doneAt = it.at || new Date().toISOString(); }
        else { delete t.done; delete t.doneAt; }
        changed++;
      } else if (it.kind === "expense") {
        // A Google Wallet payment's Add (0.238.0), in the home currency.
        // Its id is the queue's, so one drained twice is added once. The
        // category (and its subcategory) is the one this merchant got last
        // time, if any, unless the quick-add window picked one.
        const entries = data.financeEntries || (data.financeEntries = []);
        const amount = Math.round(parseFloat(String(it.amount).replace(",", ".")) * 100) / 100;
        if (!(amount > 0) || !isDate(it.date) || entries.some((f) => f.id === it.id)) continue;
        const note = String(it.note || "").trim().slice(0, 200);
        const picked = (data.financeCategories || []).find((c) => c.name === it.category);
        const filed = picked ? { category: picked.name, subcategory: (picked.subs || []).some((s) => s.name === it.subcategory) ? it.subcategory : "" } : filingFor(data, note);
        const item = { id: it.id, date: it.date, amount, category: filed ? filed.category : categoryFor(data, note), createdAt: it.at || new Date().toISOString() };
        if (filed && filed.subcategory) item.subcategory = filed.subcategory;
        if (note) item.note = note;
        entries.push(item);
        changed++;
      } else if (it.kind === "entry" || it.kind === "backlog") {
        const title = String(it.title || "").trim().slice(0, 300);
        const list = it.kind === "entry" ? (data.entries || (data.entries = [])) : (data.backlog || (data.backlog = []));
        if (!title || list.some((x) => x.id === it.id)) continue;
        const cats = (data.categories || []).map((c) => c.name);
        const category = cats.includes(it.category) ? it.category : cats[0] || "Other";
        const item = { id: it.id, title, category, createdAt: it.at || new Date().toISOString() };
        const notes = String(it.notes || "").trim();
        if (notes) item.notes = notes;
        if (it.kind === "entry") {
          if (!isDate(it.date)) continue;
          item.year = +it.date.slice(0, 4);
          item.month = +it.date.slice(5, 7);
          item.date = it.date.slice(0, 7);
          item.day = +it.date.slice(8, 10);
          const rating = Math.round(+it.rating || 0);
          if (rating >= 1 && rating <= 5) item.rating = rating;
        } else if (it.starred) item.priority = 1;
        list.push(item);
        changed++;
      } else if (it.kind === "note") {
        const notes = data.notes || (data.notes = []);
        const text = String(it.text || "").trim();
        if (!text || notes.some((n) => n.id === it.id)) continue;
        const at = it.at || new Date().toISOString();
        const note = { id: it.id, text, createdAt: at, editedAt: at };
        const title = String(it.title || "").trim();
        if (title) note.title = title;
        if ((data.noteCategories || []).some((c) => c.name === it.category)) note.category = it.category;
        notes.unshift(note);
        changed++;
      } else if (it.kind === "list") {
        // A new tasks list from the quick-add window's "+" (0.318.1), on top
        // as the app's own new notes go. Items the window adds to it come
        // after it in the queue.
        const notes = data.notes || (data.notes = []);
        const text = String(it.text || "").trim();
        if (!text || notes.some((n) => n.id === it.id)) continue;
        const at = it.at || new Date().toISOString();
        notes.unshift({ id: it.id, kind: "list", text, items: [], createdAt: at, editedAt: at });
        changed++;
      } else if (it.kind === "item") {
        // After the list's open items, as the list's own add line puts it.
        const n = (data.notes || []).find((x) => x.id === it.list && x.kind === "list");
        const text = String(it.text || "").trim();
        if (!n || !text) continue;
        const items = n.items || (n.items = []);
        if (items.some((x) => x.id === it.id)) continue;
        items.splice(items.map((x) => !x.done).lastIndexOf(true) + 1, 0, { id: it.id, text });
        if (n.done) { delete n.done; delete n.doneAt; }
        changed++;
      }
    }
    return changed;
  }

  // Where an expense with this exact note was filed last time (0.309.0):
  // its category, subcategory and date, or null. Shared by the Wallet drain,
  // the Add expense form and the bridge, so all three remember alike. A
  // recurring plan counts as a filing from its start date; an entry or plan
  // whose category no longer exists doesn't.
  function filingFor(data, note) {
    const key = String(note || "").trim().toLowerCase();
    if (!key) return null;
    const cats = new Map((data.financeCategories || []).map((c) => [c.name, c]));
    let best = null;
    const consider = (category, subcategory, date) => {
      const cat = cats.get(category);
      if (!cat || !date) return;
      const sub = subcategory && (cat.subs || []).some((x) => x.name === subcategory) ? subcategory : "";
      if (!best || String(date) > best.date) best = { category, subcategory: sub, date: String(date) };
    };
    for (const f of data.financeEntries || []) if (String(f.note || "").trim().toLowerCase() === key) consider(f.category, f.subcategory, f.date);
    for (const r of data.recurringExpenses || []) if (String(r.note || "").trim().toLowerCase() === key) consider(r.category, r.subcategory, r.startDate);
    return best;
  }

  // What an expense at `note` was filed under last time, or the first category.
  function categoryFor(data, note) {
    const cats = (data.financeCategories || []).map((c) => c.name);
    const key = String(note || "").trim().toLowerCase();
    const last = key && (data.financeEntries || [])
      .filter((f) => String(f.note || "").trim().toLowerCase() === key && cats.includes(f.category))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    return last ? last.category : cats[0] || "Other";
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
      upcomingAt: window.LifeLogBacklog ? window.LifeLogBacklog.upcomingAt : undefined,
      releaseLabel: window.LifeLogBacklog ? window.LifeLogBacklog.releaseLabel : undefined,
      currencySymbol: window.LifeLogFinance && window.LifeLogFinance.currencyGlyph ? window.LifeLogFinance.currencyGlyph() : "",
      pins,
    });
    // With the lock on and "hide in widgets" set (0.262.0), the widgets get
    // the counts and the habits but no note or to-do text: a home screen
    // doesn't ask for a PIN. The lists come back on the next push once the
    // setting or the lock goes.
    const hidden = !!(ctx.hidden && ctx.hidden());
    if (hidden) {
      snap.todos = []; snap.lists = []; snap.notes = []; snap.upcoming = []; snap.inProgress = []; snap.hidden = true;
    }
    // The Ledger's Investments (invest.js): what you hold and the watchlist,
    // amounts left out when hidden. Null without a watchlist or the mode.
    if (window.LifeLogInvest && ctx.investOn && ctx.investOn()) {
      try { snap.invest = window.LifeLogInvest.widgetSnapshot(hidden); } catch (e) { snap.invest = null; }
    }
    // Charge and release-day heads-ups (0.272.0), rung beside the habit
    // reminders. An APK or IPA older than that ignores the key.
    try { snap.calendar = calendarSnapshot(snap.today, hidden); } catch (e) { snap.calendar = null; }
    if (window.LifeLogAlerts) {
      try { snap.alerts = window.LifeLogAlerts.current(ctx.state.data, snap.today, hidden); } catch (e) { snap.alerts = []; }
    }
    return Promise.resolve(W.update({ json: JSON.stringify(snap) })).catch(() => { /* the widget keeps its last copy */ });
  }

  // The Calendar widget's share: the days, the words it shows in the app's
  // language (the widget can't translate), and the week's first day. Locked
  // and hidden, it gets the words and no days. Google's events for this
  // month and next are fetched quietly when they're old, as the Home
  // calendar does for the month it shows; that fetch pushes again.
  function calendarSnapshot(today, hidden) {
    const G = window.LifeLogGcal, Home = window.LifeLogHome, D = Dates();
    const [y, m] = today.split("-").map(Number);
    if (G && G.on && !hidden) { G.ensure(y, m); G.ensure(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1); }
    const words = {
      title: i18n.t("Calendar"), today: i18n.t("Today"), tomorrow: i18n.t("Tomorrow"), allDay: i18n.t("All day"),
      more: i18n.t("{n} more", { n: "{n}" }), nothing: i18n.t("Nothing today"), empty: i18n.t("Nothing on the calendar in the next two weeks"),
      settings: i18n.t("Calendar widget"), layout: i18n.t("Layout"), agenda: i18n.t("Agenda: today and the days ahead"), month: i18n.t("Month: the whole month, with marks"),
      source: i18n.t("Calendars"), sourceApp: i18n.t("LifeLog's Google Calendar connection"), sourcePhone: i18n.t("This phone's calendars"),
      sourceHint: i18n.t("This phone's calendars are read on the phone and never leave it. They're always up to date and include every account on the phone. LifeLog's connection is only as fresh as the last time the app ran."),
      allow: i18n.t("Allow LifeLog to read your calendars in the widget's settings"), locked: i18n.t("Hidden while LifeLog is locked"),
    };
    const cal = { lang: i18n.lang, rtl: i18n.dir === "rtl", weekStart: D.weekStart ? D.weekStart() : 0, words };
    if (hidden) { cal.hidden = true; return cal; }
    const data = ctx.state.data;
    const B = window.LifeLogBacklog, T = window.LifeLogTasks;
    cal.days = calendarDays(data, today, {
      monthOf: Home ? (yy, mm) => Home.calendarMonth(data, yy, mm, { Backlog: B, Tasks: T, releases: (ctx.state.visual || {}).calendarReleases !== "hide" }) : null,
      eventsOf: G && G.on ? (yy, mm) => G.eventsFor(yy, mm) : undefined,
      calColor: G ? G.colorOf : undefined,
    });
    return cal;
  }

  // The background refresh's one send (0.279.0): the snapshot as the headless
  // run ends, with none of start()'s listening or draining, which belong to
  // an app someone is looking at. Resolves once the widgets have it.
  function pushNow(c) {
    ctx = c;
    return push();
  }

  // Called on every data change; one snapshot for a burst of them. Not
  // while the app is out of sight, though (0.237.0): the sync started when
  // you opened it often lands after you've left, and by then a timer may
  // never fire, since Android freezes an app's process seconds after it
  // goes to the background. The widget kept what the app had before the
  // sync until the next time it was opened, which is why it could show old
  // data after you'd just looked at the new.
  function changed() {
    if (!plugin()) return;
    clearTimeout(pushTimer);
    if (document.visibilityState === "hidden") { push(); return; }
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
        const data = ctx.state.data;
        const items = (res && res.items) || [];
        const n = applyQueue(data, items);
        if (n) {
          ctx.afterDataChange();
          await ctx.persist();
          ctx.toast(drainText(data, items));
        }
      } catch (e) { /* the queue stays for next time */ }
      finally { draining = null; }
      push();
    })();
    return draining;
  }

  // What the toast says the queue brought: ticks, things added from the
  // quick-add window, Google Wallet payments. Counted from what's now in
  // the data, so a skipped one (its list deleted, say) isn't claimed.
  function drainText(data, items) {
    const has = (it) => {
      if (it.kind === "expense") return (data.financeEntries || []).some((f) => f.id === it.id);
      if (it.kind === "entry") return (data.entries || []).some((x) => x.id === it.id);
      if (it.kind === "backlog") return (data.backlog || []).some((x) => x.id === it.id);
      if (it.kind === "note" || it.kind === "list") return (data.notes || []).some((x) => x.id === it.id);
      if (it.kind === "item") return (data.notes || []).some((x) => (x.items || []).some((i) => i.id === it.id));
      return false;
    };
    let ticks = 0, added = 0, paid = 0;
    for (const it of items) {
      if (!it) continue;
      if (it.kind === "habit" || it.kind === "todo") ticks++;
      else if (!has(it)) continue;
      else if (it.kind === "expense" && it.from !== "quick") paid++;
      else added++;
    }
    const said = [];
    if (added) said.push(i18n.tn(added, "{n} thing from your home screen", "{n} things from your home screen"));
    if (ticks) said.push(i18n.tn(ticks, "a tick from your home-screen widget", "{n} ticks from your home-screen widget"));
    if (paid) said.push(i18n.tn(paid, "a Google Wallet payment to the Ledger", "{n} Google Wallet payments to the Ledger"));
    return said.length ? i18n.t("Added {what}", { what: i18n.join(said) }) : i18n.t("Your home-screen widget is up to date");
  }

  // One ask at a time: at launch the start-up ask and a lifelog:// link's
  // can land together, and a share taken twice would open twice.
  let taking = false;
  async function takeAction() {
    const W = plugin();
    if (!W || taking) return;
    taking = true;
    try {
      const res = await W.takeLaunchAction();
      if (res && res.action) ctx.runAction(res.action);
    } catch (e) { /* nothing to open */ }
    finally { taking = false; }
  }

  // iOS (0.217.0): a widget opens lifelog://action/<action> — the App
  // plugin hands the link over, whether it started the app or woke it.
  // A query stays encoded (0.238.0): "add-expense?amount=4.50&note=A%26B"
  // is read by runAction, and decoding it here would split "A&B" in two.
  const actionOfUrl = (url) => {
    const m = /^lifelog:\/\/action\/([^?]+)(\?.*)?$/.exec(String(url || ""));
    if (!m) return "";
    try { return decodeURIComponent(m[1]) + (m[2] || ""); } catch (e) { return ""; }
  };
  function listenForLinks() {
    const App = ctx.Platform.plugin("App");
    if (!App) return;
    // lifelog://action/share carries nothing itself (0.250.0): the share
    // extension left what was shared with the plugin, as a launch action.
    const go = (url) => { const a = actionOfUrl(url); if (a === "share") takeAction(); else if (a) ctx.runAction(a); };
    App.addListener("appUrlOpen", (e) => go(e && e.url));
    if (App.getLaunchUrl) Promise.resolve(App.getLaunchUrl()).then((r) => go(r && r.url)).catch(() => {});
  }

  // ---- the background refresh (0.279.0) ----
  // How often Android runs the app with no screen to bring the widgets and
  // the alerts up to date (see headless.js). A choice of this phone, like
  // the reminder times, and off until asked for: it costs a little battery.
  // The plugin keeps the job itself; the choice is told to it again at
  // every launch, so an app updated or restored keeps its schedule.
  const BACKGROUND_KEY = "lifelog-background-v1";
  const BACKGROUND_CHOICES = [["0", i18n.t("Off")], ["15", i18n.t("Every 15 minutes")], ["30", i18n.t("Every 30 minutes")], ["60", i18n.t("Every hour")], ["180", i18n.t("Every 3 hours")]];
  const backgroundMinutes = () => {
    try { return Math.max(0, parseInt(JSON.parse(localStorage.getItem(BACKGROUND_KEY)).minutes, 10) || 0); } catch (e) { return 0; }
  };
  const backgroundAvailable = () => { const W = plugin(); return !!(W && typeof W.setBackgroundRefresh === "function" && ctx.Platform.android); };
  function tellBackground(minutes) {
    const W = plugin();
    if (!W || typeof W.setBackgroundRefresh !== "function") return Promise.resolve();
    return Promise.resolve(W.setBackgroundRefresh({ minutes })).catch(() => {});
  }
  function setBackgroundMinutes(minutes) {
    const m = Math.max(0, parseInt(minutes, 10) || 0);
    try { localStorage.setItem(BACKGROUND_KEY, JSON.stringify({ minutes: m })); } catch (e) { /* kept for this session only */ }
    return tellBackground(m);
  }
  function assertBackground() {
    if (!backgroundAvailable()) return;
    const m = backgroundMinutes();
    if (m) tellBackground(m);
  }

  // ctx: { state, Platform, persist, afterDataChange, toast, runAction, quickActions, hidden }
  function start(c) {
    ctx = c;
    const W = plugin();
    if (!W) return;
    if (ctx.Platform.ios) listenForLinks();
    W.addListener("queued", () => drain());
    W.addListener("action", () => takeAction());
    // Google Calendar's events are the device's, not data: a fetch tells
    // the Calendar widget itself.
    if (window.LifeLogGcal) window.LifeLogGcal.onChange(() => changed());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") { drain(); takeAction(); }
      else push(); // leaving: the widget should show what was just done
    });
    drain();
    takeAction();
  }

  window.LifeLogWidgets = { snapshotOf, applyQueue, calendarDays, CAL_PER_DAY, categoryFor, filingFor, actionOfUrl, start, changed, pushNow, backgroundMinutes, setBackgroundMinutes, backgroundAvailable, assertBackground, BACKGROUND_CHOICES, MARK_DAYS, DONE_PER_PANEL, NOTE_CHARS, NOTES_BUDGET };
})();
