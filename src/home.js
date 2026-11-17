// LifeLog — the Home tab: one page of what's going on now. What you're in the
// middle of, what's coming in the next two weeks (releases, new episodes,
// charges, habits still to do), a scratchpad, and the notes you pinned here.
//
// The sections are this device's to arrange and hide (state.visual.homeFloors
// and homeHidden), like the tabs themselves. Home is built from floors: rows
// that split their width evenly between their sections. On a computer a
// section is dragged by its heading into a floor, or between floors to start
// a new one; a floor that's full pushes its last section down to a floor of
// its own. A phone shows the floors one under the other. The scratchpad is synced, as
// settings.scratchpad: it is one string, and two devices editing it at once
// resolve as any setting does, the newer save winning. A pinned note is a
// note with `pinned: true`; it stays in the Notebook too.
(function () {
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  const Dates = () => window.LifeLogDates || require("./dates.js");
  const ico = (n, c) => window.LifeLogIcons.svg(n, c);

  // [id, label, icon, half]. Half sections next to each other in your order
  // share a row on a wide screen (two or three across).
  const SECTIONS = [
    ["progress", i18n.t("In progress"), "play", false],
    ["upcoming", i18n.t("Coming up"), "calendar", true],
    ["scratchpad", i18n.t("Scratchpad"), "notebook-pen", true],
    ["pinned", i18n.t("Pinned notes"), "pin", true],
    ["ledger", i18n.t("Ledger"), "receipt", true],
    ["invest", i18n.t("Investments"), "trending-up", true],
    ["calendar", i18n.t("Calendar"), "calendar-days", true],
    ["pick", i18n.t("Pick for tonight"), "dices", true],
    ["year", i18n.t("Year so far"), "chart-column", true],
  ];
  const SECTION_IDS = SECTIONS.map(([id]) => id);
  const DAYS_AHEAD = 14;

  // ---------- pure (test/home.test.js, and the bridge's lifelog_home) ----------
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const addDays = (day, n) => {
    const d = new Date(day + "T00:00:00");
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // The order a device keeps, cleaned: ids it doesn't know go, and a section
  // added since goes on the end.
  function sectionOrder(saved) {
    const known = [...new Set((Array.isArray(saved) ? saved : []).filter((id) => SECTION_IDS.includes(id)))];
    return known.concat(SECTION_IDS.filter((id) => !known.includes(id)));
  }

  // A section is never narrower than this, so a floor holds as many as fit
  // across the page: three on a laptop, four on a big monitor.
  const MIN_WIDTH = 380, FLOOR_GAP = 24;
  const perFloor = (width) => Math.max(1, Math.floor((width + FLOOR_GAP) / (MIN_WIDTH + FLOOR_GAP)));

  // The rows the old section order made, before floors: halves next to each other
  // shared a row, two or three across.
  const HALVES = new Set(SECTIONS.filter((s) => s[3]).map(([id]) => id));
  const BEFORE_FLOORS = ["progress", "upcoming", "scratchpad", "pinned", "ledger"];
  function legacyFloors(order) {
    order = order.filter((id) => BEFORE_FLOORS.includes(id));
    const out = [];
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j < order.length && HALVES.has(order[j])) j++;
      const run = order.slice(i, Math.max(j, i + 1));
      const size = run.length === 2 || run.length === 4 ? 2 : 3;
      for (let k = 0; k < run.length; k += size) out.push(run.slice(k, k + size));
      i += run.length;
    }
    return out;
  }
  // A new Home (and Reset layout) shows only these three; the rest are
  // there to add from View or a right-click (Daniel, 2026-11-17).
  const DEFAULT_FLOORS = [["progress"], ["upcoming", "scratchpad"]];
  const OLD_DEFAULT_ORDER = ["progress", "upcoming", "scratchpad", "pinned"];

  // The floors a device keeps, cleaned: hidden and unknown sections go, as
  // do floors left empty. What isn't on a saved floor is hidden, so a section
  // added to the app since starts hidden rather than turning up at the
  // bottom. With nothing saved, a device that arranged the old way (an order
  // or hidden sections) keeps the rows that made, Investments below them;
  // one that never did gets the default.
  function floorLayout(saved, { order, hidden } = {}) {
    const off = new Set(Array.isArray(hidden) ? hidden : []);
    const arranged = off.size > 0 || (Array.isArray(order) && order.join() !== OLD_DEFAULT_ORDER.join());
    const from = Array.isArray(saved) ? saved
      : arranged ? legacyFloors(sectionOrder(order).filter((id) => !off.has(id))).concat([["invest"]])
        : DEFAULT_FLOORS;
    const seen = new Set();
    const out = [];
    for (const f of from) {
      if (!Array.isArray(f)) continue;
      const ids = f.filter((id) => SECTION_IDS.includes(id) && !off.has(id) && !seen.has(id));
      ids.forEach((id) => seen.add(id));
      if (ids.length) out.push(ids);
    }
    return out;
  }
  const hiddenOf = (floors) => SECTION_IDS.filter((id) => !floors.some((f) => f.includes(id)));

  // Drops section `id` into `floors`. `place` counts floors as they are with
  // `id` taken out: { floor, at } puts it in that floor before position `at`,
  // { floor, newFloor: true } gives it a floor of its own before that one.
  // A floor holding more than `max` pushes its last section (never the one
  // just dropped) to a new floor right below.
  function placeSection(floors, id, place, max) {
    const out = floors.map((f) => f.filter((x) => x !== id)).filter((f) => f.length);
    const floor = Math.max(0, Math.min(place.floor, out.length));
    if (place.newFloor || floor === out.length) {
      out.splice(floor, 0, [id]);
      return { floors: out, pushed: null };
    }
    const row = out[floor].slice();
    row.splice(Math.max(0, Math.min(place.at, row.length)), 0, id);
    let pushed = null;
    if (row.length > Math.max(1, max || 1)) {
      pushed = row[row.length - 1] === id ? row[row.length - 2] : row[row.length - 1];
      row.splice(row.indexOf(pushed), 1);
      out.splice(floor + 1, 0, [pushed]);
    }
    out[floor] = row;
    return { floors: out, pushed };
  }

  // Where `id` sits now, in placeSection's terms.
  function placeOf(floors, id) {
    const fi = floors.findIndex((f) => f.includes(id));
    if (fi < 0) return { floor: floors.length, newFloor: true };
    return floors[fi].length === 1 ? { floor: fi, newFloor: true } : { floor: fi, at: floors[fi].indexOf(id) };
  }

  // The View sheet's up/down arrows: swap with the neighbour in reading
  // order, each keeping the other's place, so the floors keep their sizes.
  function swapSections(floors, id, delta) {
    const flat = floors.flat();
    const other = flat[flat.indexOf(id) + delta];
    if (flat.indexOf(id) < 0 || !other) return floors;
    return floors.map((f) => f.map((x) => (x === id ? other : x === other ? id : x)));
  }

  function inProgress(data) {
    return (data.backlog || []).filter((b) => !b.dropped && isDate(b.startedAt))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || String(a.title).localeCompare(String(b.title)));
  }

  // Everything dated from today to `days` ahead, soonest first. Only what is
  // known to the day: a release "sometime in November" is the Upcoming
  // page's to list, and here it would read as due today.
  //   { kind: "release" | "episode" | "charge" | "habit" | "task", day, title, ... }
  // Open tasks with a date come too, the overdue ones before today
  // (bucketOf files them under Overdue).
  function comingUp(data, today, { Backlog, Finance, Habits, Tasks, days = DAYS_AHEAD } = {}) {
    const until = addDays(today, days);
    const rows = [];
    if (Tasks) {
      for (const r of Tasks.dueTasks(data, until)) {
        rows.push({ kind: "task", day: r.day, title: r.item.text, category: r.category, list: r.note.text || "", noteId: r.note.id, id: r.item.id,
          time: r.item.time || "", priority: r.item.priority || 0, repeat: !!r.item.repeat });
      }
    }
    if (Backlog) {
      for (const b of data.backlog || []) {
        if (b.dropped) continue;
        const episode = isDate(b.nextAt) && b.nextAt >= today;
        const day = episode ? b.nextAt
          : (b.releasePrecision || "day") === "day" && isDate(String(b.releaseDate || "").slice(0, 10)) ? String(b.releaseDate).slice(0, 10) : "";
        if (!day || day < today || day > until) continue;
        // Out today still counts: it's the day you were waiting for.
        if (!episode && day > today && !Backlog.isAwaitingRelease(b)) continue;
        rows.push({ kind: episode ? "episode" : "release", day, title: b.title, category: b.category, label: episode ? b.nextLabel || "" : "", id: b.id, starred: !!b.priority });
      }
    }
    if (Finance) {
      const all = data.recurringExpenses || [];
      const end = new Date(until + "T00:00:00");
      for (const rec of all) {
        for (const o of Finance.planCharges(rec, end)) {
          if (o.skipped || o.paused || !isDate(o.date) || o.date < today || o.date > until) continue;
          rows.push({
            kind: "charge", day: o.date, id: rec.id, amount: +o.amount || 0,
            title: o.note || rec.note || o.subcategory || o.category || rec.category || i18n.t("Recurring expense"),
            category: o.category || rec.category || "",
          });
        }
      }
    }
    if (Habits) {
      const live = (data.habits || []).slice().sort((x, y) => (x.order || 0) - (y.order || 0));
      for (const g of Habits.leftToDo(live, today).groups) {
        if (g.period === "day") {
          rows.push({ kind: "habit", day: today, period: "day", title: g.items.map((it) => it.habit.name).join(", "), count: g.items.length, ids: g.items.map((it) => it.habit.id) });
        } else {
          for (const it of g.items) rows.push({ kind: "habit", day: addDays(today, g.daysLeft), period: g.period, title: it.habit.name, done: it.done, target: it.target, minutes: Habits.isMinutes(it.habit), ids: [it.habit.id] });
        }
      }
    }
    const order = { task: 0, habit: 1, release: 2, episode: 3, charge: 4 };
    return rows.sort((a, b) => a.day.localeCompare(b.day) || order[a.kind] - order[b.kind]
      || (a.kind === "task" ? (a.time || "99").localeCompare(b.time || "99") || (a.priority || 4) - (b.priority || 4) : 0)
      || String(a.title).localeCompare(String(b.title)));
  }

  // One month as a calendar shows it: the entries finished on each day (the
  // ones with no day set apart, never guessed onto the 1st), open tasks
  // dated in it, and what the backlog has coming out (Backlog.calendarReleases:
  // day ones by day, month and quarter ones in `rel.rough`). The Timeline's
  // calendar, the Home calendar and the bridge's lifelog_calendar all read
  // this, so they never disagree. Google Calendar's events are the app's
  // to add: they live on the device, out of the bridge's sight.
  function calendarMonth(data, y, m, { Backlog, Tasks, entries = data.entries || [], backlog = data.backlog || [], releases = true } = {}) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const days = new Date(y, m, 0).getDate();
    const push = (map, d, x) => { if (!map.has(d)) map.set(d, []); map.get(d).push(x); };
    // Oldest added first, as the Timeline's month cards read when flipped.
    const inMonth = entries.filter((e) => +e.year === y && +e.month === m)
      .sort((a, b) => -String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const byDay = new Map(), undated = [];
    for (const e of inMonth) {
      const d = +e.day;
      if (d >= 1 && d <= days) push(byDay, d, e); else undated.push(e);
    }
    const tasksByDay = new Map();
    if (Tasks) for (const r of Tasks.dueTasks(data, key + "-31")) if (r.day.startsWith(key + "-")) push(tasksByDay, +r.day.slice(8), r);
    const rel = Backlog && releases ? Backlog.calendarReleases(backlog, y, m) : { byDay: new Map(), rough: [] };
    return { key, days, inMonth, byDay, undated, tasksByDay, rel };
  }

  // The year so far: what you finished against last year by the same date
  // (an entry with no day counts once its month is past), by category; tasks
  // ticked this year; what you spent, recurring charges included once due,
  // as on the Ledger; and the best run any habit has had.
  function yearSoFar(data, today, { Finance, Habits } = {}) {
    const y = +today.slice(0, 4), md = today.slice(5), month = +today.slice(5, 7);
    const pad = (n) => String(n).padStart(2, "0");
    const byNow = (e) => (+e.day ? `${pad(e.month)}-${pad(e.day)}` <= md : +e.month < month);
    const entries = (data.entries || []).filter((e) => +e.year === y);
    const lastByNow = (data.entries || []).filter((e) => +e.year === y - 1 && byNow(e)).length;
    const counts = {};
    for (const e of entries) counts[e.category || ""] = (counts[e.category || ""] || 0) + 1;
    const categories = Object.entries(counts).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    // A repeating task never stays done: each tick goes into `ticks` and its
    // date moves on, so those count too. Ticks are UTC; the day is this device's.
    const localDay = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const inYear = (iso) => { const d = localDay(iso); return d.startsWith(y + "-") && d <= today; };
    const tickCount = (t) => (t.done && inYear(t.doneAt) ? 1 : 0) + (Array.isArray(t.ticks) ? t.ticks.filter(inYear).length : 0);
    let tasksDone = 0;
    for (const n of (data.notes || []).filter((x) => x.kind === "list")) {
      // A list counts as a task of its own only once it has its own day.
      if (n.date || n.ticks) tasksDone += tickCount(n);
      for (const t of n.items || []) tasksDone += tickCount(t);
    }
    let spent = 0;
    if (Finance) {
      const end = new Date(today + "T00:00:00");
      const charged = (data.recurringExpenses || []).flatMap((r) => Finance.planCharges(r, end));
      for (const f of [...(data.financeEntries || []), ...charged]) {
        if (!f.skipped && !f.paused && isDate(f.date) && f.date.startsWith(y + "-") && f.date <= today) spent += +f.amount || 0;
      }
    }
    let streak = null;
    if (Habits) {
      for (const h of data.habits || []) {
        const n = Habits.bestStreakOf(h, today);
        if (n > 0 && (!streak || n > streak.n)) streak = { n, name: h.name, unit: Habits.isPeriodic(h) ? h.period : "day" };
      }
    }
    return { year: y, finished: entries.length, lastByNow, hasLast: (data.entries || []).some((e) => +e.year === y - 1), categories, tasksDone, spent, streak };
  }

  // Which heading a day goes under.
  function bucketOf(day, today) {
    if (day < today) return i18n.t("Overdue");
    if (day === today) return i18n.t("Today");
    if (day === addDays(today, 1)) return i18n.t("Tomorrow");
    return day <= addDays(today, 6) ? i18n.t("This week") : i18n.t("Later");
  }

  // This month's spending so far against last month's by the same day of the
  // month (a whole last month would make every 8th look thrifty), where it
  // went, and the latest expenses. Recurring charges count once they're due,
  // as on the Ledger; skipped and paused ones don't.
  function ledgerGlance(data, today, { Finance, latest = 4 } = {}) {
    const end = new Date(today + "T00:00:00");
    const charged = (data.recurringExpenses || []).flatMap((r) => Finance.planCharges(r, end));
    const all = [...(data.financeEntries || []), ...charged]
      .filter((f) => !f.skipped && !f.paused && isDate(f.date) && f.date <= today);
    const month = today.slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const prevDays = new Date(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 0).getDate();
    const byDay = `${prev}-${String(Math.min(+today.slice(8), prevDays)).padStart(2, "0")}`;
    const sum = (list) => list.reduce((t, f) => t + (+f.amount || 0), 0);
    const now = all.filter((f) => f.date.startsWith(month));
    const before = all.filter((f) => f.date.startsWith(prev));
    const cats = {};
    for (const f of now) cats[f.category || ""] = (cats[f.category || ""] || 0) + (+f.amount || 0);
    return {
      month, prev,
      total: sum(now),
      lastByNow: sum(before.filter((f) => f.date <= byDay)),
      lastTotal: sum(before),
      hasLast: before.length > 0,
      categories: Object.entries(cats).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
      latest: all.slice().sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, latest),
    };
  }

  const pinnedNotes = (data) => (data.notes || []).filter((n) => n.pinned)
    .sort((a, b) => String(b.editedAt || b.createdAt || "").localeCompare(String(a.editedAt || a.createdAt || "")));

  // ---------- the view ----------
  let state, $, el, toast, persist, render, saveVisualSettings, switchToView, modeEnabled, viewEnabled, isMobileLayout, todayStr;
  function init(ctx) {
    ({ state, $, el, toast, persist, render, saveVisualSettings, switchToView, modeEnabled, viewEnabled, isMobileLayout, todayStr } = ctx);
    // Google Calendar's events arrive after the Home calendar is drawn.
    const G = window.LifeLogGcal;
    if (G) G.onChange(() => { if (state.view === "home" && floors().some((f) => f.includes("calendar"))) render(); });
  }

  const floors = () => floorLayout(state.visual.homeFloors, { order: state.visual.homeSections, hidden: state.visual.homeHidden });
  function saveFloors(next) {
    state.visual.homeFloors = next;
    if (Array.isArray(next)) state.visual.homeHidden = hiddenOf(next);
    saveVisualSettings(state.visual);
  }

  function sectionHead(id, more) {
    const [, label, icon] = SECTIONS.find(([s]) => s === id);
    const head = el("div", "home-sec-head");
    head.appendChild(el("h2")).appendChild(window.LifeLogIcons.labelled(icon, label));
    if (more) {
      const b = el("button", "home-more", i18n.t("{label} ›", { label: more.label }));
      b.type = "button";
      b.onclick = more.run;
      head.appendChild(b);
    }
    return head;
  }

  function goTo(view, mode) {
    if (!viewEnabled(view)) return null;
    if (mode && !modeEnabled(view, mode)) return null;
    return () => {
      if (mode) {
        if (view === "backlog") state.backlogMode = mode;
        if (view === "notes") state.notesMode = mode;
      }
      switchToView(view);
    };
  }

  function progressSection() {
    const B = window.LifeLogBacklog;
    const items = inProgress(state.data);
    const run = goTo("timeline");
    const sec = el("section", "home-sec home-progress");
    sec.appendChild(sectionHead("progress", run && items.length ? { label: i18n.t("Timeline"), run } : null));
    if (!items.length) {
      sec.appendChild(el("p", "home-empty", i18n.t("Nothing in progress. Start something from your Backlog and it shows here.")));
      return sec;
    }
    const strip = el("div", "home-strip");
    for (const b of items) {
      const tile = B.backlogTile(b, null);
      tile.classList.add("home-tile");
      tile.tabIndex = 0;
      tile.setAttribute("role", "button");
      tile.setAttribute("aria-label", b.title);
      const c = B.progressCount && window.LifeLogJournal.categoryShows(b.category).progress ? B.progressCount(b) : null;
      // How far you are in Waypage (0.313.0), when it's read there.
      const wp = !c && window.LifeLogWaypage ? window.LifeLogWaypage.progressLabel(b) : "";
      if (c || wp) {
        const badge = el("span", "home-tile-count", c ? c.text : wp);
        badge.title = c ? c.words : i18n.t("{progress} in Waypage", { progress: wp });
        tile.querySelector(".bl-tile-art").appendChild(badge);
      }
      const since = el("span", "home-tile-since");
      const dot = el("span", "dot");
      dot.style.background = (state.data.categories.find((x) => x.name === b.category) || {}).color || "";
      since.append(dot, document.createTextNode(i18n.t("Since {date}", { date: Dates().day(b.startedAt, { year: "auto" }) })));
      tile.appendChild(since);
      const open = () => B.openBacklogModal(b);
      tile.onclick = open;
      tile.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } };
      if (window.LifeLogContextMenu) window.LifeLogContextMenu.attach(tile, "progress", b.id);
      strip.appendChild(tile);
    }
    sec.appendChild(strip);
    return sec;
  }

  const KIND_ICON = { release: "star", episode: "tv", charge: "repeat", habit: "square-check-big" };
  // A task's row: its tick where the others have an icon, ticking it right
  // here; the rest of the row opens it.
  function taskRow(r, today) {
    const row = el("div", "home-row is-task");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "todo-check" + (r.priority ? " is-p" + r.priority : "");
    cb.setAttribute("aria-label", i18n.t("Mark as done: {title}", { title: r.title }));
    cb.onchange = () => window.LifeLogNotes.tickItem(r.noteId, r.id, cb.checked);
    const tick = el("span", "home-row-tick");
    tick.appendChild(cb);
    row.appendChild(tick);
    const open = el("button", "home-row-open");
    open.type = "button";
    const text = el("span", "home-row-text");
    text.appendChild(el("span", "home-row-title", r.title));
    const sub = el("span", "home-row-sub");
    if (r.category) {
      const c = (state.data.noteCategories || []).find((x) => x.name === r.category);
      if (c && c.color) { const dot = el("span", "dot"); dot.style.background = c.color; sub.appendChild(dot); }
    }
    sub.appendChild(document.createTextNode([r.list, r.repeat ? i18n.t("repeats") : ""].filter(Boolean).join(" · ")));
    text.appendChild(sub);
    open.appendChild(text);
    const T = window.LifeLogTasks;
    const end = el("span", "home-row-end" + (r.day < today ? " is-late" : ""),
      r.day === today ? (r.time || i18n.t("Today")) : T.shortDay(r.day, today) + (r.time ? " " + r.time : ""));
    open.appendChild(end);
    open.onclick = () => T.openTask(r.noteId, r.id);
    row.appendChild(open);
    return row;
  }
  function upcomingRow(r, today) {
    if (r.kind === "task") return taskRow(r, today);
    const row = el("button", "home-row");
    row.type = "button";
    const ki = el("span", "home-row-ico");
    ki.appendChild(ico(KIND_ICON[r.kind]));
    row.appendChild(ki);
    const text = el("span", "home-row-text");
    text.appendChild(el("span", "home-row-title", r.title));
    const sub = el("span", "home-row-sub");
    const cat = r.category && (r.kind === "charge"
      ? null
      : state.data.categories.find((x) => x.name === r.category));
    if (cat) { const dot = el("span", "dot"); dot.style.background = cat.color; sub.appendChild(dot); }
    const H = window.LifeLogHabits;
    const amt = (n) => (r.minutes ? H.minutesShort(n) : String(n));
    const words = r.kind === "habit"
      ? (r.period === "day" ? i18n.tn(r.count, "1 habit left today", "{n} habits left today") : ({ week: i18n.t("{done} of {target} this week", { done: amt(r.done), target: amt(r.target) }), month: i18n.t("{done} of {target} this month", { done: amt(r.done), target: amt(r.target) }), year: i18n.t("{done} of {target} this year", { done: amt(r.done), target: amt(r.target) }) })[r.period])
      : r.kind === "charge" ? [r.category, i18n.t("charges")].filter(Boolean).join(" · ")
        : [r.category, r.kind === "release" ? (r.day === today ? i18n.t("out today") : i18n.t("release")) : r.label || i18n.t("new episode")].filter(Boolean).join(" · ");
    sub.appendChild(document.createTextNode(words));
    text.appendChild(sub);
    row.appendChild(text);
    const right = el("span", "home-row-end" + (r.kind === "charge" ? " is-money" : ""));
    if (r.kind === "charge") right.textContent = window.LifeLogFinance.amountText(r);
    else if (r.kind === "habit") right.textContent = r.period === "day" ? i18n.tn(r.count, "{n} left", "{n} left") : r.day === today ? i18n.t("Today") : Dates().day(r.day, { year: false });
    else right.textContent = r.day === today ? i18n.t("Today") : bucketOf(r.day, today) === i18n.t("This week") || r.day === addDays(today, 1)
      ? Dates().WEEKDAYS[Dates().parts(r.day).wd] + " " + Dates().parts(r.day).d : Dates().day(r.day, { year: "auto" });
    row.appendChild(right);
    const B = window.LifeLogBacklog;
    if (r.kind === "release" || r.kind === "episode") {
      row.onclick = () => { const b = state.data.backlog.find((x) => x.id === r.id); if (b) B.openBacklogModal(b); };
    } else if (r.kind === "charge") {
      const go = goTo("finance");
      if (go) row.onclick = go; else row.disabled = true;
    } else {
      const go = goTo("notes", "habits");
      if (go) row.onclick = go; else row.disabled = true;
    }
    return row;
  }

  function upcomingSection() {
    const today = todayStr();
    const rows = comingUp(state.data, today, { Backlog: window.LifeLogBacklog, Finance: window.LifeLogFinance, Habits: window.LifeLogHabits, Tasks: window.LifeLogTasks });
    const run = goTo("backlog", "upcoming");
    const sec = el("section", "home-sec home-upcoming");
    sec.appendChild(sectionHead("upcoming", run ? { label: i18n.t("Upcoming"), run } : null));
    if (!rows.length) {
      sec.appendChild(el("p", "home-empty", i18n.t("Nothing dated in the next two weeks.")));
      return sec;
    }
    const card = el("div", "home-card");
    let last = "";
    for (const r of rows) {
      const b = bucketOf(r.day, today);
      if (b !== last) { card.appendChild(el("p", "home-day", b)); last = b; }
      card.appendChild(upcomingRow(r, today));
    }
    sec.appendChild(card);
    return sec;
  }

  // The textarea outlives a render, so a sync landing while you type
  // doesn't take the caret (or a half-typed word) with it.
  let pad = null, padTimer = 0;
  function padField() {
    if (pad) return pad;
    pad = el("textarea", "home-pad");
    pad.id = "homeScratchpad";
    pad.placeholder = i18n.t("Jot something down…");
    pad.setAttribute("aria-label", i18n.t("Scratchpad"));
    pad.oninput = () => {
      fitPad();
      clearTimeout(padTimer);
      padTimer = setTimeout(savePad, 700);
      markPad(i18n.t("Saving…"));
    };
    pad.onblur = () => { if (padTimer) { clearTimeout(padTimer); savePad(); } };
    return pad;
  }
  function fitPad() {
    if (!pad || !pad.isConnected) return;
    pad.style.height = "auto";
    pad.style.height = Math.max(pad.scrollHeight, 240) + "px";
  }
  const markPad = (text) => { const s = $("#homePadState"); if (s) s.textContent = text; };
  async function savePad() {
    padTimer = 0;
    if (!pad) return;
    const v = pad.value;
    if ((state.data.settings.scratchpad || "") === v) { markPad(v ? i18n.t("Saved") : ""); return; }
    if (v) state.data.settings.scratchpad = v; else delete state.data.settings.scratchpad;
    markPad(i18n.t("Saved"));
    await persist();
  }

  // Note or Board (per device, visual.homeScratchMode): the text pad, or a
  // scratch board (boards.js) that opens in the full-screen editor.
  const scratchMode = () => (state.visual.homeScratchMode === "board" && window.LifeLogBoards ? "board" : "note");
  function modeSwitch() {
    const seg = el("div", "seg home-pad-mode");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", i18n.t("Scratchpad kind"));
    for (const [k, icon, label] of [["note", "notebook-pen", i18n.t("Note")], ["board", "presentation", i18n.t("Board")]]) {
      const b = el("button", "seg-btn" + (scratchMode() === k ? " active" : ""));
      b.type = "button";
      b.dataset.mode = k;
      b.setAttribute("aria-pressed", String(scratchMode() === k));
      b.append(ico(icon), document.createTextNode(label));
      b.onclick = () => {
        if (scratchMode() === k) return;
        if (padTimer) { clearTimeout(padTimer); savePad(); }
        state.visual.homeScratchMode = k;
        saveVisualSettings(state.visual);
        render();
      };
      seg.appendChild(b);
    }
    return seg;
  }

  function padFoot() {
    const foot = el("div", "home-pad-foot");
    if (window.LifeLogBoards) foot.appendChild(modeSwitch());
    foot.appendChild(el("span", "spacer"));
    return foot;
  }

  function scratchpadSection() {
    const sec = el("section", "home-sec home-scratch");
    const head = sectionHead("scratchpad");
    // "Saved" sits in the head: Note/Board took its place in the foot, and
    // both there wrapped Save to Notebook onto two lines on a phone.
    if (scratchMode() === "note") {
      const said = el("span", "home-pad-state", state.data.settings.scratchpad ? i18n.t("Saved") : "");
      said.id = "homePadState";
      head.appendChild(said);
    }
    sec.appendChild(head);
    sec.appendChild(scratchMode() === "board" ? boardCard() : noteCard());
    return sec;
  }

  function noteCard() {
    const card = el("div", "home-card");
    const field = padField();
    const saved = state.data.settings.scratchpad || "";
    if (document.activeElement !== field && !padTimer) field.value = saved;
    card.appendChild(field);
    const foot = padFoot();
    const make = el("button", "btn btn-small");
    make.type = "button";
    make.append(ico("plus"), document.createTextNode(" " + i18n.t("Save to Notebook")));
    make.title = i18n.t("Save what's here as a note in your Notebook and clear the scratchpad");
    make.onclick = makeNote;
    foot.appendChild(make);
    card.appendChild(foot);
    requestAnimationFrame(fitPad);
    return card;
  }

  function boardCard() {
    const B = window.LifeLogBoards;
    const card = el("div", "home-card");
    const open = el("button", "home-board");
    open.type = "button";
    open.id = "homeScratchBoard";
    if (!B.isLoaded()) {
      open.appendChild(el("span", "home-board-empty", i18n.t("Loading…")));
      B.ensureLoaded().then(() => { if (state.view === "home") render(); }).catch(() => {});
    } else {
      const b = B.scratchBoard();
      if (b && b.elements.length) {
        open.appendChild(B.thumbnail(b));
        open.setAttribute("aria-label", i18n.t("Open the scratch board"));
      } else open.appendChild(el("span", "home-board-empty", i18n.t("Nothing drawn yet")));
      if (!open.hasAttribute("aria-label")) open.setAttribute("aria-label", i18n.t("Draw on the scratch board"));
    }
    open.onclick = () => B.openScratch();
    card.appendChild(open);
    requestAnimationFrame(() => matchPad(open));
    const foot = padFoot();
    const keep = el("button", "btn btn-small");
    keep.type = "button";
    keep.append(ico("plus"), document.createTextNode(" " + i18n.t("Save to Notebook")));
    keep.title = i18n.t("File this drawing as a board in your Notebook and start a blank one");
    keep.onclick = keepBoard;
    foot.appendChild(keep);
    card.appendChild(foot);
    return card;
  }

  // The board is as tall as the text pad would be here, so switching
  // between Note and Board doesn't move what's under the card.
  function matchPad(open) {
    if (!open.isConnected) return;
    const probe = el("textarea", "home-pad");
    probe.value = state.data.settings.scratchpad || "";
    probe.setAttribute("aria-hidden", "true");
    probe.tabIndex = -1;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.width = open.offsetWidth + "px";
    probe.style.height = "auto";
    open.parentNode.appendChild(probe);
    open.style.height = Math.max(probe.scrollHeight, 240) + "px";
    probe.remove();
  }

  async function keepBoard() {
    const B = window.LifeLogBoards;
    const b = await B.keepScratch();
    if (!b) { toast(i18n.t("The board is empty — draw something first"), true); return; }
    render();
    const canOpen = viewEnabled("notes") && modeEnabled("notes", "boards");
    toast(i18n.t('Kept as "{name}" — the scratch board is blank', { name: b.name }), false, canOpen ? { label: i18n.t("Open"), onClick: () => B.openBoard(b.id) } : null);
  }

  async function makeNote() {
    const text = (pad ? pad.value : state.data.settings.scratchpad || "").trim();
    if (!text) { toast(i18n.t("The scratchpad is empty — write something first"), true); return; }
    clearTimeout(padTimer); padTimer = 0;
    const now = new Date().toISOString();
    const N = window.LifeLogNotes;
    const note = N.sanitizeNote({ text, createdAt: now, updatedAt: now });
    state.data.notes = [note, ...(state.data.notes || [])];
    delete state.data.settings.scratchpad;
    if (pad) pad.value = "";
    render();
    await persist();
    toast(i18n.t("Saved as a note — the scratchpad is clear"), false, viewEnabled("notes") ? { label: i18n.t("Open"), onClick: () => N.openNote(note) } : null);
  }

  function pinnedSection() {
    const N = window.LifeLogNotes;
    const notes = pinnedNotes(state.data);
    const run = goTo("notes", "notes");
    const sec = el("section", "home-sec home-pinned");
    sec.appendChild(sectionHead("pinned", run ? { label: i18n.t("Notebook"), run } : null));
    if (!notes.length) {
      sec.appendChild(el("p", "home-empty", i18n.t("No pinned notes. Open a note and choose Pin to Home from its ⋯ menu.")));
      return sec;
    }
    const grid = el("div", "home-pins");
    for (const n of notes) grid.appendChild(N.pinnedCard(n));
    sec.appendChild(grid);
    return sec;
  }

  function ledgerSection() {
    const F = window.LifeLogFinance;
    const today = todayStr();
    const g = ledgerGlance(state.data, today, { Finance: F });
    const run = goTo("finance", "entries");
    const sec = el("section", "home-sec home-ledger");
    sec.appendChild(sectionHead("ledger", run ? { label: i18n.t("Ledger"), run } : null));
    const money = F.formatMoney;
    const colorOf = (name) => (state.data.financeCategories.find((c) => c.name === name) || {}).color || "";
    const card = el("div", "home-card");
    const top = el("div", "home-ledger-top");
    const D = Dates();
    const monthName = D.MONTH_NAMES[+g.month.slice(5) - 1];
    top.appendChild(el("p", "home-ledger-label", i18n.t("{month} so far", { month: monthName })));
    top.appendChild(el("p", "home-ledger-total", money(g.total)));
    if (g.hasLast) {
      const diff = g.total - g.lastByNow;
      const lastName = D.MONTH_NAMES[+g.prev.slice(5) - 1];
      const words = Math.abs(diff) < 0.005 ? i18n.t("Same as this time in {month}", { month: lastName })
        : (diff > 0 ? i18n.t("{amount} more than this time in {month}", { amount: money(Math.abs(diff)), month: lastName }) : i18n.t("{amount} less than this time in {month}", { amount: money(Math.abs(diff)), month: lastName }));
      const vs = el("p", "home-ledger-vs" + (diff > 0.005 ? " is-up" : ""));
      vs.appendChild(ico(diff > 0.005 ? "trending-up" : "trending-down"));
      vs.appendChild(document.createTextNode(words));
      top.appendChild(vs);
      top.appendChild(el("p", "home-ledger-of", i18n.t("{month} came to {amount}", { month: lastName, amount: money(g.lastTotal) })));
    }
    if (g.total > 0) {
      const bar = el("div", "home-ledger-bar");
      bar.setAttribute("aria-hidden", "true");
      for (const c of g.categories) {
        const seg = el("span");
        seg.style.flexGrow = String(c.amount);
        seg.style.background = colorOf(c.name);
        bar.appendChild(seg);
      }
      top.appendChild(bar);
      const legend = el("ul", "home-ledger-cats");
      for (const c of g.categories.slice(0, 3)) {
        const li = el("li");
        const dot = el("span", "dot");
        dot.style.background = colorOf(c.name);
        li.append(dot, el("span", "home-ledger-cat", c.name || i18n.t("Other")), el("span", "home-ledger-amt", money(c.amount)));
        legend.appendChild(li);
      }
      top.appendChild(legend);
    }
    card.appendChild(top);
    if (g.latest.length) {
      card.appendChild(el("p", "home-day", i18n.t("Latest")));
      for (const f of g.latest) {
        const row = el("button", "home-row");
        row.type = "button";
        const ki = el("span", "home-row-ico");
        ki.appendChild(ico(f.virtual ? "repeat" : "banknote"));
        row.appendChild(ki);
        const text = el("span", "home-row-text");
        text.appendChild(el("span", "home-row-title", f.note || f.subcategory || f.category || i18n.t("Expense")));
        const sub = el("span", "home-row-sub");
        const dot = el("span", "dot");
        dot.style.background = colorOf(f.category);
        sub.append(dot, document.createTextNode([f.subcategory || f.category, f.date === today ? i18n.t("Today") : D.day(f.date, { year: "auto" })].filter(Boolean).join(" · ")));
        text.appendChild(sub);
        row.appendChild(text);
        row.appendChild(el("span", "home-row-end is-money", money(f.amount)));
        if (f.virtual) {
          const rec = (state.data.recurringExpenses || []).find((r) => r.id === f.recurringId);
          row.onclick = () => rec && F.openRecurringModal(rec);
        } else row.onclick = () => F.openFinanceModal(state.data.financeEntries.find((x) => x.id === f.id));
        card.appendChild(row);
      }
    } else card.appendChild(el("p", "home-empty home-ledger-none", i18n.t("No expenses yet this month.")));
    const foot = el("div", "home-pad-foot");
    foot.appendChild(el("span", "spacer"));
    const add = el("button", "btn btn-small");
    add.type = "button";
    add.append(ico("plus"), document.createTextNode(" " + i18n.t("Add expense")));
    add.onclick = () => F.openFinanceModal(null);
    foot.appendChild(add);
    card.appendChild(foot);
    sec.appendChild(card);
    return sec;
  }

  // What you hold and how it did, then each ticker as on the widget: a
  // month's sparkline, its close and the day's move. The numbers are
  // invest.js's own (the widget's), so the two never disagree.
  const INVEST_ROWS = 5;
  function investSection() {
    const I = window.LifeLogInvest;
    const sec = el("section", "home-sec home-invest");
    const toMode = modeEnabled("finance", "invest") && viewEnabled("finance");
    sec.appendChild(sectionHead("invest", toMode ? { label: i18n.t("Investments"), run: () => I.openTicker(null) } : null));
    const card = el("div", "home-card");
    sec.appendChild(card);
    const g = I && I.homeGlance();
    if (!g) { card.appendChild(el("p", "home-empty home-invest-none", i18n.t("Loading your watchlist…"))); return sec; }
    const addBtn = () => {
      const add = el("button", "btn btn-small");
      add.type = "button";
      add.append(ico("plus"), document.createTextNode(" " + i18n.t("Add ticker")));
      add.onclick = () => I.addTicker();
      return add;
    };
    if (!g.count) {
      card.appendChild(el("p", "home-empty home-invest-none", i18n.t("Nothing on your watchlist yet.")));
      const foot = el("div", "home-pad-foot");
      foot.append(el("span", "spacer"), addBtn());
      card.appendChild(foot);
      return sec;
    }
    if (g.hold) {
      const top = el("div", "home-ledger-top");
      top.appendChild(el("p", "home-ledger-label", i18n.t("You hold")));
      top.appendChild(el("p", "home-ledger-total", g.hold.value));
      const gain = el("p", "home-invest-gain " + (g.hold.up ? "invest-up" : "invest-down"));
      gain.appendChild(ico(g.hold.up ? "trending-up" : "trending-down"));
      gain.appendChild(document.createTextNode(i18n.t("{gain} since you bought", { gain: g.hold.gain })));
      top.appendChild(gain);
      if (g.hold.today) top.appendChild(el("p", "home-ledger-of", g.hold.today + (g.hold.todayPct ? " (" + g.hold.todayPct.replace(" today", "") + ")" : "")));
      card.appendChild(top);
    }
    for (const r of g.rows.slice(0, INVEST_ROWS)) {
      const row = el("button", "home-row home-invest-row");
      row.type = "button";
      const text = el("span", "home-row-text");
      const title = el("span", "home-row-title", r.symbol);
      if (r.hit) title.appendChild(el("i", "home-invest-hit", i18n.t("At target")));
      text.appendChild(title);
      text.appendChild(el("span", "home-row-sub", r.sub));
      row.appendChild(text);
      row.appendChild(I.homeSpark(r));
      const end = el("span", "home-invest-end");
      end.appendChild(el("b", null, r.price));
      if (r.day) end.appendChild(el("span", r.up ? "invest-up" : "invest-down", r.day));
      row.appendChild(end);
      row.onclick = () => I.openTicker(r.id);
      card.appendChild(row);
    }
    const foot = el("div", "home-pad-foot");
    foot.appendChild(el("span", "home-invest-closed", g.blocked === "key" ? i18n.t("Add a Tiingo key for prices") : g.count > INVEST_ROWS ? i18n.t("{n} more · {closed}", { n: g.count - INVEST_ROWS, closed: g.closed }) : g.closed));
    foot.appendChild(el("span", "spacer"));
    foot.appendChild(addBtn());
    card.appendChild(foot);
    return sec;
  }

  // ---------- Calendar (0.321.0) ----------
  // The Timeline's calendar, small: a month of days, each marked for what's
  // on it (a bar per Google Calendar event, a dot per entry finished, a
  // dashed ring per release, a ring per open task), and the picked day's
  // list under it. Alone on a wide floor it lays out as the Timeline's does,
  // names in the days and the list beside (styles.css, a container query),
  // so a drag that changes its width needs no new markup. The month and the
  // picked day last for the session, opening on today, as the Timeline's do.
  let calMonth = null, calDay = null;
  const catColor = (name) => (state.data.categories.find((c) => c.name === name) || {}).color || "";

  function calendarSection() {
    const D = Dates(), J = window.LifeLogJournal, G = window.LifeLogGcal, B = window.LifeLogBacklog, T = window.LifeLogTasks;
    const today = todayStr();
    if (!calMonth) calMonth = today.slice(0, 7);
    const [y, m] = calMonth.split("-").map(Number);
    const mo = calendarMonth(state.data, y, m, { Backlog: B, Tasks: T, releases: state.visual.calendarReleases !== "hide" });
    const evs = G && G.on ? G.eventsFor(y, m) : new Map();
    if (G && G.on) G.ensure(y, m);
    const todayD = today.startsWith(calMonth + "-") ? +today.slice(8) : 0;
    if (!calDay || calDay > mo.days) calDay = todayD || 1;
    const dayKey = (d) => calMonth + "-" + String(d).padStart(2, "0");

    const sec = el("section", "home-sec home-calendar");
    const toTimeline = viewEnabled("timeline") && modeEnabled("timeline", "entries") ? () => {
      J.openCalendarAt(y, m, calDay);
      state.visual.timelineLayout = "calendar";
      saveVisualSettings(state.visual);
      state.timelineMode = "entries";
      switchToView("timeline");
    } : null;
    sec.appendChild(sectionHead("calendar", toTimeline ? { label: i18n.t("Timeline"), run: toTimeline } : null));
    const card = el("div", "home-card home-cal");
    const main = el("div", "home-cal-main");
    const head = el("div", "home-cal-head");
    head.appendChild(el("h3", "home-cal-title", D.MONTH_NAMES[m - 1] + " " + y));
    for (const [dir, icon, label] of [[-1, "chevron-left", i18n.t("Previous month")], [1, "chevron-right", i18n.t("Next month")]]) {
      const b = el("button", "btn btn-icon home-cal-step");
      b.type = "button";
      b.appendChild(ico(icon));
      b.title = label;
      b.setAttribute("aria-label", label);
      b.onclick = () => {
        let yy = y, mm = m + dir;
        if (mm < 1) { mm = 12; yy--; } else if (mm > 12) { mm = 1; yy++; }
        calMonth = `${yy}-${String(mm).padStart(2, "0")}`;
        calDay = null;
        render();
      };
      head.appendChild(b);
    }
    main.appendChild(head);

    const grid = el("div", "home-cal-grid");
    for (const d of D.weekOrder()) {
      const w = el("span", "home-cal-wd");
      w.append(el("span", "home-cal-wd-short", D.WEEKDAYS[d].slice(0, 1)), el("span", "home-cal-wd-long", D.WEEKDAYS[d]));
      w.title = D.WEEKDAYS[d];
      grid.appendChild(w);
    }
    const lead = D.weekPos(new Date(y, m - 1, 1).getDay());
    for (let i = 0; i < lead; i++) grid.appendChild(el("span", "home-cal-day is-out"));
    for (let d = 1; d <= mo.days; d++) {
      const fin = mo.byDay.get(d) || [], gev = evs.get(d) || [], outs = mo.rel.byDay.get(d) || [], due = mo.tasksByDay.get(d) || [];
      const cell = el("button", "home-cal-day");
      cell.type = "button";
      cell.dataset.day = d;
      cell.classList.toggle("is-today", d === todayD);
      cell.classList.toggle("is-past", !!todayD && d < todayD);
      cell.classList.toggle("is-picked", d === calDay);
      cell.setAttribute("aria-pressed", String(d === calDay));
      cell.setAttribute("aria-label", D.day(dayKey(d), { year: false }) + (fin.length ? ", " + i18n.t("{n} finished", { n: fin.length }) : "")
        + (gev.length ? ", " + i18n.tn(gev.length, "{n} event", "{n} events") : "")
        + (outs.length ? ", " + i18n.tn(outs.length, "{n} release", "{n} releases") : "")
        + (due.length ? ", " + i18n.tn(due.length, "{n} task", "{n} tasks") : ""));
      cell.appendChild(el("span", "home-cal-n", String(d)));
      const lines = [...gev.map((x) => ["event", x]), ...fin.map((x) => ["entry", x]), ...outs.map((x) => ["release", x]), ...due.map((x) => ["task", x])];
      if (lines.length) {
        const marks = el("span", "home-cal-marks");
        marks.setAttribute("aria-hidden", "true");
        const names = el("span", "cal-names home-cal-names");
        names.setAttribute("aria-hidden", "true");
        for (const [kind, x] of lines.slice(0, 3)) {
          const mk = marks.appendChild(el("span", "home-cal-mark is-" + kind + (kind === "task" && x.item.priority ? " is-p" + x.item.priority : "")));
          if (kind === "event") { const c = G.colorOf(x.cal); if (c) mk.style.setProperty("--mk", c); names.appendChild(J.eventLine(x, G)); continue; }
          const colour = kind === "entry" ? catColor(x.category) : kind === "release" ? catColor(x.b.category) : "";
          if (colour) mk.style.setProperty("--mk", colour);
          const n = el("span", "cal-name" + (kind === "task" ? " is-task" : kind === "release" ? " is-release" : ""),
            kind === "task" ? x.item.text : kind === "release" ? J.releaseName(x) : x.title);
          const dot = el("span", kind === "task" ? "cal-ring" + (x.item.priority ? " is-p" + x.item.priority : "") : "dot");
          if (colour && kind !== "task") dot.style.background = colour;
          if (kind === "release") n.style.setProperty("--rel", colour);
          n.prepend(dot);
          names.appendChild(n);
        }
        if (lines.length > 3) names.appendChild(el("span", "cal-name is-more", i18n.t("+{n} more", { n: lines.length - 3 })));
        cell.append(marks, names);
      }
      cell.onclick = () => { calDay = d; render(); };
      grid.appendChild(cell);
    }
    main.appendChild(grid);
    card.appendChild(main);
    card.appendChild(calendarDayList(mo, evs.get(calDay) || [], dayKey(calDay), today, y, m));
    sec.appendChild(card);
    return sec;
  }

  // The picked day: its events, open tasks (ticked right here), releases,
  // and what was finished on it.
  function calendarDayList(mo, gev, key, today, y, m) {
    const D = Dates(), J = window.LifeLogJournal, G = window.LifeLogGcal;
    const d = +key.slice(8);
    const list = el("div", "home-cal-list");
    list.appendChild(el("p", "home-day", (key === today ? i18n.t("Today") + " · " : "") + D.day(key, { weekday: true, year: false })));
    let any = false;
    for (const ev of gev) {
      any = true;
      const row = list.appendChild(el("button", "home-row home-cal-ev"));
      row.type = "button";
      const c = G.colorOf(ev.cal);
      if (c) row.style.setProperty("--ev", c);
      row.appendChild(el("span", "home-cal-time", ev.allDay ? i18n.t("All day") : ev.time));
      const text = row.appendChild(el("span", "home-row-text"));
      text.appendChild(el("span", "home-row-title", ev.title));
      text.appendChild(el("span", "home-row-sub", ["Google Calendar", G.calName(ev.cal)].filter(Boolean).join(" · ")));
      row.onclick = () => J.openEventSheet(ev);
    }
    for (const r of mo.tasksByDay.get(d) || []) {
      any = true;
      list.appendChild(taskRow({ kind: "task", day: r.day, title: r.item.text, category: r.category, list: r.note.text || "",
        noteId: r.note.id, id: r.item.id, time: r.item.time || "", priority: r.item.priority || 0, repeat: !!r.item.repeat }, today));
    }
    for (const r of mo.rel.byDay.get(d) || []) {
      any = true;
      list.appendChild(upcomingRow({ kind: r.kind, day: key, title: r.b.title, category: r.b.category, label: r.kind === "episode" ? r.b.nextLabel || "" : "", id: r.b.id }, today));
    }
    const finishedRow = (e) => {
      const row = el("button", "home-row");
      row.type = "button";
      row.appendChild(el("span", "home-row-ico")).appendChild(ico("check"));
      const text = row.appendChild(el("span", "home-row-text"));
      text.appendChild(el("span", "home-row-title", e.title));
      const sub = text.appendChild(el("span", "home-row-sub"));
      const dot = sub.appendChild(el("span", "dot"));
      dot.style.background = catColor(e.category);
      sub.appendChild(document.createTextNode(i18n.t("{category} · finished", { category: e.category })));
      row.onclick = () => J.openExisting("entry", e.id);
      return row;
    };
    for (const e of mo.byDay.get(d) || []) {
      any = true;
      list.appendChild(finishedRow(e));
    }
    if (!any) list.appendChild(el("p", "home-empty home-cal-none", i18n.t("Nothing on this day")));
    // The month's entries with no day and its releases known only to the
    // month or quarter, as under the Timeline's calendar.
    if (mo.undated.length) {
      list.appendChild(el("p", "home-day home-cal-undated", i18n.t("No day set") + " · " + mo.undated.length));
      for (const e of mo.undated) list.appendChild(finishedRow(e));
    }
    if (mo.rel.rough.length) {
      list.appendChild(el("p", "home-day home-cal-rough", i18n.t("This month, no day yet") + " · " + mo.rel.rough.length));
      for (const b of mo.rel.rough) {
        const row = list.appendChild(el("button", "home-row"));
        row.type = "button";
        row.appendChild(el("span", "home-row-ico")).appendChild(ico(KIND_ICON.release));
        const text = row.appendChild(el("span", "home-row-text"));
        text.appendChild(el("span", "home-row-title", b.title));
        const sub = text.appendChild(el("span", "home-row-sub"));
        sub.appendChild(el("span", "dot")).style.background = catColor(b.category);
        sub.appendChild(document.createTextNode([b.category, i18n.t("release")].filter(Boolean).join(" · ")));
        row.onclick = () => window.LifeLogBacklog.openBacklogModal(b);
      }
    }
    if (G && G.on && (G.needsTap || G.error)) {
      const b = list.appendChild(el("button", "btn btn-sm home-cal-sync"));
      b.type = "button";
      b.appendChild(ico("refresh-cw"));
      b.appendChild(document.createTextNode(" " + i18n.t("Sync Google Calendar")));
      b.onclick = async () => {
        b.disabled = true;
        try { await G.sync(y, m, true); G.clearError(); } catch (e) { toast(e.message || i18n.t("Google Calendar didn't answer. Try again."), true); }
        render();
      };
    }
    return list;
  }

  // ---------- Pick for tonight (0.321.0) ----------
  // One title from the backlog you could start today, held until Another
  // or Start (backlog.js's homePick, from Pick's own bag), with chips for
  // what it picks from. "Pick ›" opens the full sheet.
  function pickSection() {
    const B = window.LifeLogBacklog, J = window.LifeLogJournal;
    const p = B.homePick(false);
    const sec = el("section", "home-sec home-pick");
    sec.appendChild(sectionHead("pick", p.pool.length ? { label: i18n.t("Pick"), run: () => B.openPickModal(B.homePickPool()) } : null));
    if (!p.pool.length) {
      sec.appendChild(el("p", "home-empty", i18n.t("Nothing in your backlog to pick from. Anything you could start today shows here.")));
      return sec;
    }
    const card = el("div", "home-card");
    const b = p.item;
    if (b) {
      const row = el("div", "home-pick-row");
      const cover = el("button", "home-pick-cover");
      cover.type = "button";
      cover.setAttribute("aria-label", i18n.t("Open {title}", { title: b.title }));
      cover.appendChild(B.pickCover(b));
      cover.onclick = () => B.openBacklogModal(b);
      row.appendChild(cover);
      const text = el("div", "home-pick-text");
      const title = el("button", "home-pick-title", b.title);
      title.type = "button";
      title.onclick = () => B.openBacklogModal(b);
      if (b.priority) {
        const star = ico("star", "home-pick-star");
        star.setAttribute("aria-label", i18n.t("Starred"));
        title.appendChild(star);
      }
      text.appendChild(title);
      const sub = el("p", "home-row-sub");
      const dot = sub.appendChild(el("span", "dot"));
      dot.style.background = (state.data.categories.find((c) => c.name === b.category) || {}).color || "";
      sub.appendChild(document.createTextNode(b.category));
      text.appendChild(sub);
      text.appendChild(B.pickMeta(b));
      if (isDate(String(b.createdAt || "").slice(0, 10))) {
        text.appendChild(el("p", "home-pick-since", i18n.t("In your backlog since {date}", { date: Dates().day(String(b.createdAt).slice(0, 10), { year: "auto" }) })));
      }
      const acts = el("div", "home-pick-actions");
      if (J.categoryShows(b.category).inProgress) {
        const start = acts.appendChild(el("button", "btn btn-sm"));
        start.type = "button";
        start.appendChild(window.LifeLogIcons.labelled("play", i18n.t("Start")));
        start.onclick = () => B.startItem(b.id);
      }
      const again = acts.appendChild(el("button", "btn btn-sm"));
      again.type = "button";
      again.appendChild(window.LifeLogIcons.labelled("dices", i18n.t("Another")));
      again.disabled = p.pool.filter((x) => !p.off.has(x.category)).length < 2;
      again.onclick = () => { B.homePick(true); render(); };
      text.appendChild(acts);
      row.appendChild(text);
      card.appendChild(row);
    } else {
      card.appendChild(el("p", "home-empty home-pick-none", i18n.t("Every category is off. Turn one on to get a pick.")));
    }
    if (p.cats.length > 1) {
      const chips = el("div", "home-pick-cats");
      for (const name of p.cats) {
        const on = !p.off.has(name);
        const c = chips.appendChild(el("button", "cat-chip pick-cat" + (on ? " on" : "")));
        c.type = "button";
        c.setAttribute("aria-pressed", String(on));
        const dot = c.appendChild(el("span", "dot"));
        dot.style.background = (state.data.categories.find((x) => x.name === name) || {}).color || "";
        c.appendChild(document.createTextNode(name));
        c.onclick = () => { B.setHomePickCategory(name, !on); B.homePick(!on ? false : !!(b && b.category === name)); render(); };
      }
      card.appendChild(chips);
    }
    sec.appendChild(card);
    return sec;
  }

  // ---------- Year so far (0.321.0) ----------
  // yearSoFar's numbers; "Recap ›" opens this year's Recap.
  function yearSection() {
    const F = window.LifeLogFinance, R = window.LifeLogRecap;
    const today = todayStr();
    const g = yearSoFar(state.data, today, { Finance: F, Habits: window.LifeLogHabits });
    const sec = el("section", "home-sec home-year");
    const head = sectionHead("year", R ? { label: i18n.t("Recap"), run: () => R.openRecap(g.year) } : null);
    head.querySelector("h2").replaceChildren(window.LifeLogIcons.labelled("chart-column", i18n.t("{year} so far", { year: String(g.year) })));
    sec.appendChild(head);
    const card = el("div", "home-card");
    const top = el("div", "home-ledger-top");
    top.appendChild(el("p", "home-ledger-label", i18n.t("Finished this year")));
    top.appendChild(el("p", "home-ledger-total", String(g.finished)));
    if (g.hasLast) {
      const diff = g.finished - g.lastByNow;
      const D = Dates(), p = D.parts(today);
      const when = D.dayMonth(p.d, p.m);
      const vs = el("p", "home-ledger-vs" + (diff < 0 ? " is-down" : ""));
      if (diff) vs.appendChild(ico(diff > 0 ? "trending-up" : "trending-down"));
      vs.appendChild(document.createTextNode(!diff ? i18n.t("Same as by {date} last year", { date: when })
        : diff > 0 ? i18n.t("{n} more than by {date} last year", { n: diff, date: when }) : i18n.t("{n} fewer than by {date} last year", { n: -diff, date: when })));
      top.appendChild(vs);
    }
    card.appendChild(top);
    if (g.categories.length) {
      const bars = el("div", "home-year-bars");
      const max = g.categories[0].n;
      for (const c of g.categories) {
        const row = bars.appendChild(el("div", "home-year-bar"));
        row.appendChild(el("span", "home-year-name", c.name));
        const fill = row.appendChild(el("span", "home-year-track")).appendChild(el("span", "home-year-fill"));
        fill.style.width = (c.n / max) * 100 + "%";
        fill.style.background = (state.data.categories.find((x) => x.name === c.name) || {}).color || "";
        row.appendChild(el("span", "home-year-n", String(c.n)));
      }
      card.appendChild(bars);
    } else {
      card.appendChild(el("p", "home-empty home-year-none", i18n.t("Nothing finished yet this year.")));
    }
    const facts = el("div", "home-year-facts");
    const fact = (value, label) => { const f = facts.appendChild(el("div", "home-year-fact")); f.append(el("b", null, value), el("span", null, label)); };
    fact(String(g.tasksDone), i18n.tn(g.tasksDone, "task done", "tasks done"));
    fact(F.formatMoney(g.spent), i18n.t("spent"));
    if (g.streak) {
      const n = g.streak.n;
      const len = { day: i18n.tn(n, "1 day", "{n} days"), week: i18n.tn(n, "1 week", "{n} weeks"), month: i18n.tn(n, "1 month", "{n} months"), year: i18n.tn(n, "1 year", "{n} years") }[g.streak.unit] || String(n);
      fact(len, i18n.t("best run · {habit}", { habit: g.streak.name }));
    }
    card.appendChild(facts);
    sec.appendChild(card);
    return sec;
  }

  const BUILD = { progress: progressSection, upcoming: upcomingSection, scratchpad: scratchpadSection, pinned: pinnedSection, ledger: ledgerSection, invest: investSection, calendar: calendarSection, pick: pickSection, year: yearSection };

  function renderHome(root) {
    if (drag) endDrag();
    const page = el("div", "home");
    const head = el("div", "home-head");
    const today = todayStr();
    const p = Dates().parts(today);
    head.appendChild(el("h1", "home-date", Dates().WEEKDAY_NAMES[p.wd] + ", " + Dates().dayMonth(p.d, p.m)));
    page.appendChild(head);
    const layout = floors();
    if (!layout.length) {
      page.appendChild(el("p", "home-empty", i18n.t("Every section is hidden. Turn some back on from the View button, or right-click here.")));
      if (!isMobileLayout()) page.classList.add("can-arrange");
      page.addEventListener("contextmenu", emptyMenu);
      root.appendChild(page);
      return;
    }
    const built = {};
    for (const row of layout) {
      for (const id of row) {
        const sec = BUILD[id]();
        sec.dataset.sec = id;
        built[id] = sec;
      }
    }
    layFloors(page, layout, built);
    if (!isMobileLayout()) page.classList.add("can-arrange");
    page.addEventListener("pointerdown", pressHead);
    page.addEventListener("contextmenu", emptyMenu);
    root.appendChild(page);
  }

  // Puts the sections into floor rows, replacing the ones there. `tags`
  // marks each floor for the drag: its index among the floors without the
  // dragged section, or "own" / "pushed" for floors the drop would make.
  function layFloors(page, layout, built, tags) {
    page.querySelectorAll(".home-floor").forEach((f) => f.remove());
    layout.forEach((row, i) => {
      const f = el("div", "home-floor");
      f.style.setProperty("--n", row.length);
      f.classList.toggle("is-shared", row.length > 1);
      f.dataset.tag = tags ? tags[i] : String(i);
      row.forEach((id) => f.appendChild(built[id]));
      page.appendChild(f);
    });
  }

  // ---------- arranging by dragging (a mouse, on a computer) ----------
  // The page shows where the section would land as you move: the floors are
  // laid out again with it in place (as a dashed slot) and a copy of it
  // follows the pointer. Each layout is worked out from the floors as they
  // were when the drag started, so passing over a full floor and moving on
  // leaves nothing pushed behind.
  let drag = null;
  // How far up into a floor its bottom edge still means "between floors".
  // Not at a floor's top: the headings you grab sit there.
  const EDGE = 14;

  function pressHead(e) {
    if (e.pointerType !== "mouse" || e.button !== 0 || isMobileLayout()) return;
    const head = e.target.closest(".home-sec-head");
    if (!head || e.target.closest("button, a, input, textarea, select, [contenteditable]")) return;
    const sec = head.closest(".home-sec");
    const page = sec && sec.closest(".home");
    if (!page || !sec.dataset.sec) return;
    e.preventDefault();
    drag = { id: sec.dataset.sec, sec, page, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, live: false };
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", dropDrag);
    window.addEventListener("pointercancel", cancelDrag);
    window.addEventListener("keydown", keyDrag, true);
    window.addEventListener("blur", cancelDrag);
  }

  function startDrag() {
    const d = drag;
    const start = floors();
    d.base = start.map((f) => f.filter((x) => x !== d.id)).filter((f) => f.length);
    d.max = perFloor(d.page.clientWidth);
    d.place = placeOf(start, d.id);
    d.key = JSON.stringify(d.place);
    d.built = {};
    d.page.querySelectorAll(".home-sec[data-sec]").forEach((s) => { d.built[s.dataset.sec] = s; });
    const r = d.sec.getBoundingClientRect();
    const w = Math.min(r.width, 420);
    d.dx = Math.min(d.x0 - r.left, w - 24);
    d.dy = d.y0 - r.top;
    d.ghost = d.sec.cloneNode(true);
    d.ghost.className = "home-ghost";
    d.ghost.removeAttribute("data-sec");
    d.ghost.setAttribute("aria-hidden", "true");
    d.ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    d.ghost.style.width = w + "px";
    document.body.appendChild(d.ghost);
    d.sec.classList.add("is-slot");
    document.documentElement.classList.add("home-dragging");
    d.live = true;
    preview(d.place);
  }

  function moveDrag(e) {
    const d = drag;
    if (!d) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.live) {
      if (Math.hypot(d.x - d.x0, d.y - d.y0) < 6) return;
      startDrag();
    }
    d.ghost.style.left = Math.max(0, Math.min(d.x - d.dx, window.innerWidth - d.ghost.offsetWidth)) + "px";
    d.ghost.style.top = d.y - d.dy + "px";
    track();
    edgeScroll();
  }

  function track() {
    const d = drag;
    const place = target(d.x, d.y);
    const key = JSON.stringify(place);
    if (key === d.key) return;
    d.key = key;
    d.place = place;
    preview(place);
  }

  function preview(place) {
    const d = drag;
    const { floors: next, pushed } = placeSection(d.base, d.id, place, d.max);
    const at = Math.min(place.floor, d.base.length);
    const tags = next.map((_, i) => {
      if (place.newFloor || at === d.base.length) return i < at ? String(i) : i === at ? "own" : String(i - 1);
      if (pushed) return i <= at ? String(i) : i === at + 1 ? "pushed" : String(i - 1);
      return String(i);
    });
    layFloors(d.page, next, d.built, tags);
    Object.values(d.built).forEach((s) => s.classList.toggle("is-pushed", s.dataset.sec === pushed));
    d.pushed = pushed;
  }

  // Which floor (by its index without the dragged section) a floor element
  // stands for.
  function baseIndex(f) {
    const tag = f.dataset.tag;
    if (tag === "own") return drag.place.floor;
    if (tag === "pushed") return drag.place.floor + 1;
    return +tag;
  }

  function target(x, y) {
    const d = drag;
    const rows = [...d.page.querySelectorAll(".home-floor")];
    const rects = rows.map((f) => f.getBoundingClientRect());
    // Between floors (or above the first, or below the last): a new floor.
    for (let i = 0; i <= rows.length; i++) {
      const top = i === 0 ? -Infinity : rects[i - 1].bottom - EDGE;
      const bottom = i === rows.length ? Infinity : rects[i].top;
      if (y < top || y >= bottom) continue;
      const below = rows[i];
      if (below && below.dataset.tag === "own") return d.place;
      if (i > 0 && rows[i - 1].dataset.tag === "own" && i === rows.length) return d.place;
      return { floor: below ? baseIndex(below) : d.base.length, newFloor: true };
    }
    const i = rects.findIndex((r) => y >= r.top && y < r.bottom);
    if (i < 0) return d.place;
    const tag = rows[i].dataset.tag;
    if (tag === "own" || tag === "pushed") return d.place;
    const others = [...rows[i].children].filter((s) => s.dataset.sec !== d.id);
    const at = others.filter((s) => {
      const r = s.getBoundingClientRect();
      return y >= r.bottom || (y >= r.top && x > r.left + r.width / 2);
    }).length;
    return { floor: +tag, at };
  }

  // Near the top or bottom of the window, the page scrolls on its own.
  function edgeScroll() {
    const d = drag;
    if (!d || d.scrolling) return;
    const step = () => {
      if (!drag || !drag.live) { d.scrolling = false; return; }
      const zone = 64;
      const v = drag.y < zone ? -(zone - drag.y) / 3 : drag.y > window.innerHeight - zone ? (drag.y - window.innerHeight + zone) / 3 : 0;
      if (!v) { d.scrolling = false; return; }
      window.scrollBy(0, v);
      track();
      requestAnimationFrame(step);
    };
    d.scrolling = true;
    requestAnimationFrame(step);
  }

  function dropDrag() {
    const d = drag;
    if (!d) return;
    if (!d.live) { endDrag(); return; }
    const { floors: next, pushed } = placeSection(d.base, d.id, d.place, d.max);
    endDrag();
    saveFloors(next);
    render();
    if (pushed) toast(i18n.t("{section} moved down — that floor was full", { section: sectionLabel(pushed) }));
  }
  function cancelDrag() {
    const was = drag && drag.live;
    endDrag();
    if (was) render();
  }
  function keyDrag(e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    cancelDrag();
  }
  function endDrag() {
    const d = drag;
    drag = null;
    window.removeEventListener("pointermove", moveDrag);
    window.removeEventListener("pointerup", dropDrag);
    window.removeEventListener("pointercancel", cancelDrag);
    window.removeEventListener("keydown", keyDrag, true);
    window.removeEventListener("blur", cancelDrag);
    if (!d) return;
    if (d.ghost) d.ghost.remove();
    document.documentElement.classList.remove("home-dragging");
    if (d.built) Object.values(d.built).forEach((s) => s.classList.remove("is-slot", "is-pushed"));
  }

  // ---------- right-click on an empty spot: add a hidden section there ----------
  // Beside or under a section in a floor, it joins that floor at that spot
  // (a full floor pushes its last one down, as a drop does); between floors
  // or below the last, it gets a floor of its own there. A section's own
  // area keeps its own menu (or the browser's).
  function emptyMenu(ev) {
    const CM = window.LifeLogContextMenu;
    if (!CM || isMobileLayout() || drag) return;
    if (ev.target.closest(".home-sec, input, textarea, a[href], [contenteditable='true']")) return;
    const page = ev.currentTarget;
    const place = placeAt(page, ev.clientX, ev.clientY);
    const off = hiddenOf(floors());
    ev.preventDefault();
    const items = off.length
      ? [{ head: i18n.t("Add to Home") }].concat(off.map((id) => {
        const [, label, icon] = SECTIONS.find(([s]) => s === id);
        return { icon, label, run: () => addSectionAt(page, id, place) };
      }))
      : [{ head: i18n.t("Every section is on Home") }];
    CM.open(ev.clientX, ev.clientY, items);
  }

  function placeAt(page, x, y) {
    const rows = [...page.querySelectorAll(".home-floor")];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top) return { floor: i, newFloor: true };
      if (y < r.bottom) {
        const at = [...rows[i].children].filter((s) => {
          const b = s.getBoundingClientRect();
          return y >= b.bottom || (y >= b.top && x > b.left + b.width / 2);
        }).length;
        return { floor: i, at };
      }
    }
    return { floor: rows.length, newFloor: true };
  }

  function addSectionAt(page, id, place) {
    const { floors: next, pushed } = placeSection(floors(), id, place, perFloor(page.clientWidth));
    saveFloors(next);
    render();
    if (pushed) toast(i18n.t("{section} moved down — that floor was full", { section: sectionLabel(pushed) }));
  }

  const sectionLabel = (id) => (SECTIONS.find(([s]) => s === id) || [, id])[1];

  // ---------- the View sheet: which sections show, the arrows, Reset ----------
  function fillViewOptions() {
    const wrap = $("#homeSectionRows");
    if (!wrap) return;
    wrap.innerHTML = "";
    const layout = floors();
    const flat = layout.flat();
    const off = hiddenOf(layout);
    const order = flat.concat(SECTION_IDS.filter((id) => !flat.includes(id)));
    order.forEach((id) => {
      const [, label, icon] = SECTIONS.find(([s]) => s === id);
      const i = flat.indexOf(id);
      const row = el("div", "sitem home-sec-row");
      const text = el("span", "sitem-text");
      text.appendChild(el("span", "sitem-title")).appendChild(window.LifeLogIcons.labelled(icon, label));
      row.appendChild(text);
      const arrow = (name, delta, words) => {
        const b = el("button", "btn btn-icon tab-order-btn");
        b.type = "button";
        b.appendChild(ico(name));
        b.title = words; b.setAttribute("aria-label", words);
        b.disabled = i < 0 || !flat[i + delta];
        b.onclick = () => moveSection(id, delta);
        return b;
      };
      row.appendChild(arrow("arrow-up", -1, i18n.t("Move {section} up", { section: label })));
      row.appendChild(arrow("arrow-down", 1, i18n.t("Move {section} down", { section: label })));
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "switch";
      box.checked = !off.includes(id);
      box.setAttribute("aria-label", i18n.t("Show {section}", { section: label }));
      box.onchange = () => setSectionShown(id, box.checked);
      row.appendChild(box);
      wrap.appendChild(row);
    });
    const reset = $("#homeResetLayoutBtn");
    if (reset) {
      const same = JSON.stringify(layout) === JSON.stringify(DEFAULT_FLOORS);
      reset.disabled = same;
      reset.onclick = resetLayout;
    }
  }
  function moveSection(id, delta) {
    const before = floors().flat();
    const i = before.indexOf(id);
    if (i < 0 || !before[i + delta]) return;
    saveFloors(swapSections(floors(), id, delta));
    fillViewOptions();
    const b = $("#homeSectionRows").children[i + delta];
    const again = b && b.querySelectorAll(".tab-order-btn")[delta < 0 ? 0 : 1];
    if (again && !again.disabled) again.focus();
    render();
  }
  function setSectionShown(id, on) {
    const layout = floors();
    // A hidden section leaves its floor; one shown again gets a floor of its own at the bottom.
    saveFloors(on ? layout.concat([[id]]) : floorLayout(layout, { hidden: [id] }));
    fillViewOptions();
    render();
  }
  function resetLayout() {
    const was = { homeFloors: state.visual.homeFloors, homeHidden: state.visual.homeHidden };
    saveFloors(DEFAULT_FLOORS.map((f) => f.slice()));
    fillViewOptions();
    render();
    toast(i18n.t("Home layout reset"), false, { label: i18n.t("Undo"), onClick: () => {
      saveFloors(was.homeFloors);
      state.visual.homeHidden = was.homeHidden || [];
      saveVisualSettings(state.visual);
      fillViewOptions();
      render();
    } });
  }

  const api = {
    init, renderHome, fillViewOptions,
    // pure
    SECTIONS, SECTION_IDS, sectionOrder, inProgress, DEFAULT_FLOORS, hiddenOf, calendarMonth, yearSoFar, MIN_WIDTH, perFloor, legacyFloors, floorLayout, placeSection, placeOf, swapSections, comingUp, bucketOf, pinnedNotes, ledgerGlance,
    taskRow,
  };
  if (typeof window !== "undefined") window.LifeLogHome = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
