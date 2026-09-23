// LifeLog — Habits: the things you keep doing, as opposed to the things you
// finish.
//
// Every other list in this app is organised by an ending. A backlog item
// graduates into an entry; a to-do is ticked and stops mattering; an expense
// is a fact about a date. A habit has no ending — it comes back tomorrow, and
// what it's worth is the pattern rather than any single tick. That is why it
// is its own list rather than a second kind of to-do.
//
// It lives as the Notes tab's third mode: the three things you keep yourself,
// as against the things you log. It spent 0.171.0 as a fifth tab; see
// NOTES.md for why that was the wrong shape.
//
// The shape it borrows is the recurring expense's: a template that says when
// it is due, plus a per-date record of what actually happened. Marks live on
// the habit as a plain { date: count } map rather than as their own
// collection — a daily habit over three years is ~1,100 of them, and at
// ~16 bytes each that is 18KB where id-carrying records would be five or six
// times that, in a file that syncs whole on every save.
//
// Everything above renderHabits() is pure and has no DOM: the cadence, the
// streaks and the rates are what this feature actually is, and they are
// covered by test/habits.test.js without a browser.
(function () {
  let state, $, el, uid, toast, persist, render, emptyState, activatable,
    backfillUpdatedAt, keepUnknown, CATEGORY_PALETTE, buildCatFilter;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, emptyState, activatable,
      backfillUpdatedAt, keepUnknown, CATEGORY_PALETTE, buildCatFilter } = ctx);
  }

  // Local rather than imported, the same way backlog.js and finance.js each
  // carry their own: three lines of date maths is not worth a dependency
  // between two view modules that otherwise know nothing about each other.
  function localDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function todayStr() { return localDateStr(new Date()); }
  function addDaysStr(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    d.setDate(d.getDate() + n);
    return localDateStr(d);
  }
  function dowOf(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return isNaN(d.getTime()) ? -1 : d.getDay(); // 0 = Sunday
  }
  const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  function daysApart(a, b) {
    return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
  }
  // One number for every "don't spin on corrupt data" guard in this file,
  // rather than four that disagree. Twenty years is longer than anyone has
  // been keeping a habit in an app, and backfilling is what made a decade of
  // history reachable at all — the old 4000-day guards would have truncated
  // it silently, which is the worst of both.
  const MAX_DAYS = 7500;
  const MAX_WEEKS = 1070;

  // ---------- the model ----------
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const KNOWN_HABIT_KEYS = new Set([
    "id", "name", "color", "cadence", "target", "order",
    "startedAt", "archivedAt", "createdAt", "updatedAt", "marks",
  ]);

  function sanitizeHabit(h) {
    const out = {
      id: h.id || uid(),
      name: String(h.name == null ? "" : h.name).trim(),
      color: /^#[0-9a-fA-F]{6}$/.test(h.color || "") ? h.color : "#5b8cff",
      // "daily", or a set of weekdays. A days list that ends up empty means
      // the habit is due on no day at all, which is not a habit — it falls
      // back to daily rather than becoming a thing you can never keep.
      cadence: "daily",
      target: Math.max(1, Math.round(+h.target) || 1),
      order: Number.isFinite(+h.order) ? +h.order : 0,
      startedAt: isDateStr(h.startedAt) ? h.startedAt : todayStr(),
      createdAt: h.createdAt || null,
      updatedAt: backfillUpdatedAt(h),
    };
    const days = h.cadence && Array.isArray(h.cadence.days)
      ? [...new Set(h.cadence.days.map((n) => +n).filter((n) => n >= 0 && n <= 6))].sort()
      : null;
    if (days && days.length && days.length < 7) out.cadence = { days };
    if (isDateStr(h.archivedAt)) out.archivedAt = h.archivedAt;
    const marks = {};
    for (const [date, v] of Object.entries(h.marks || {})) {
      const n = Math.round(+v);
      if (isDateStr(date) && n > 0) marks[date] = n;
    }
    if (Object.keys(marks).length) out.marks = marks;
    return keepUnknown(h, out, KNOWN_HABIT_KEYS);
  }

  // ---------- cadence ----------
  // Whether the habit asks anything of this date. Outside its own life
  // (before it started, after it was archived) it asks nothing, which is what
  // keeps an archived habit from showing as an unbroken run of misses.
  function isDue(habit, dateStr) {
    if (!habit || !isDateStr(dateStr)) return false;
    if (habit.startedAt && dateStr < habit.startedAt) return false;
    if (habit.archivedAt && dateStr > habit.archivedAt) return false;
    const c = habit.cadence;
    if (!c || c === "daily") return true;
    return Array.isArray(c.days) && c.days.includes(dowOf(dateStr));
  }

  function cadenceLabel(habit) {
    const c = habit && habit.cadence;
    if (!c || c === "daily") return "Every day";
    const days = c.days || [];
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return "Weekdays";
    if (days.length === 2 && days.includes(0) && days.includes(6)) return "Weekends";
    return days.map((d) => DAY_LABELS[d]).join(", ");
  }

  // ---------- marks ----------
  const markOf = (habit, dateStr) => (habit && habit.marks && +habit.marks[dateStr]) || 0;
  const isDone = (habit, dateStr) => markOf(habit, dateStr) >= (habit.target || 1);

  // One tap advances by one and wraps round at the target. For the ordinary
  // habit (target 1) that is exactly a tick: on, then off.
  function nextMark(habit, dateStr) {
    const target = habit.target || 1;
    const now = markOf(habit, dateStr);
    return now >= target ? 0 : now + 1;
  }

  // ---------- streaks ----------
  // A run of consecutive DUE days that were kept. A weekdays-only habit is
  // not broken by a Saturday, which is the whole reason cadence exists here:
  // a streak that counts calendar days would tell someone doing exactly what
  // they planned that they keep failing.
  //
  // Today is deliberately not counted against you. If it is due and not yet
  // done, the run up to the previous due day still stands — the day isn't
  // over, and a tracker that zeroes your streak at midnight is a tracker that
  // punishes you for looking at it in the morning.
  function streakOf(habit, todayDateStr) {
    if (!habit) return 0;
    const today = todayDateStr || todayStr();
    let cursor = today;
    if (isDue(habit, today) && !isDone(habit, today)) cursor = addDaysStr(today, -1);
    const floor = habit.startedAt || "1970-01-01";
    let run = 0;
    // Bounded by the habit's own life, so a corrupt startedAt can't spin.
    for (let guard = 0; guard < MAX_DAYS && cursor >= floor; guard++) {
      if (isDue(habit, cursor)) {
        if (!isDone(habit, cursor)) break;
        run++;
      }
      cursor = addDaysStr(cursor, -1);
    }
    return run;
  }

  // The best run it has ever had, walked forward from the start date to the
  // last day it has any mark for (or today, whichever is later).
  function bestStreakOf(habit, todayDateStr) {
    if (!habit) return 0;
    const dates = Object.keys(habit.marks || {});
    const last = dates.length ? dates.sort()[dates.length - 1] : (todayDateStr || todayStr());
    const end = last > (todayDateStr || todayStr()) ? last : (todayDateStr || todayStr());
    let cursor = habit.startedAt || end;
    let run = 0, best = 0;
    for (let guard = 0; guard < MAX_DAYS && cursor <= end; guard++) {
      if (isDue(habit, cursor)) {
        if (isDone(habit, cursor)) { run++; if (run > best) best = run; }
        else run = 0;
      }
      cursor = addDaysStr(cursor, 1);
    }
    return best;
  }

  // Both halves of a window, counted rather than walked. Walking was fine
  // while a window was ninety days; backfilling makes "since you started" a
  // real question, and a ten-year card would have walked 3,650 days per
  // habit on every render — including every tick.
  //
  // The window is clipped to the habit's own life first, so the two agree
  // about what is even askable.
  function clipRange(habit, fromStr, toStr) {
    let a = fromStr, b = toStr;
    if (habit.startedAt && a < habit.startedAt) a = habit.startedAt;
    if (habit.archivedAt && b > habit.archivedAt) b = habit.archivedAt;
    return a > b ? null : [a, b];
  }

  // Whole weeks contribute a fixed number of due days whatever the cadence,
  // so only the ragged tail needs looking at.
  function dueBetween(habit, fromStr, toStr) {
    if (!habit || !isDateStr(fromStr) || !isDateStr(toStr)) return 0;
    const range = clipRange(habit, fromStr, toStr);
    if (!range) return 0;
    const total = daysApart(range[0], range[1]) + 1;
    const c = habit.cadence;
    if (!c || c === "daily") return total;
    const days = c.days || [];
    if (!days.length) return 0;
    const weeks = Math.floor(total / 7);
    let n = weeks * days.length;
    const dow = dowOf(range[0]);
    for (let i = 0; i < total - weeks * 7; i++) if (days.includes((dow + i) % 7)) n++;
    return n;
  }

  // Counted off the marks rather than the calendar: a habit has far fewer
  // recorded days than elapsed ones, even when it has been kept perfectly.
  function keptBetween(habit, fromStr, toStr) {
    if (!habit || !isDateStr(fromStr) || !isDateStr(toStr)) return 0;
    const range = clipRange(habit, fromStr, toStr);
    if (!range) return 0;
    const target = habit.target || 1;
    let n = 0;
    for (const [d, v] of Object.entries(habit.marks || {})) {
      if (d >= range[0] && d <= range[1] && v >= target && isDue(habit, d)) n++;
    }
    return n;
  }

  // How many of the days it asked for were kept, over a window.
  function statsFor(habit, fromStr, toStr) {
    const due = dueBetween(habit, fromStr, toStr);
    const done = keptBetween(habit, fromStr, toStr);
    return { due, done, rate: due ? done / due : 0 };
  }

  // The due days in a range, in order — what a range fill acts on, and short
  // by construction (it is a stretch of a grid you are looking at).
  function dueDaysBetween(habit, fromStr, toStr) {
    const out = [];
    const range = clipRange(habit, fromStr, toStr);
    if (!range || !isDateStr(fromStr) || !isDateStr(toStr)) return out;
    let cursor = range[0];
    for (let guard = 0; guard < MAX_DAYS && cursor <= range[1]; guard++) {
      if (isDue(habit, cursor)) out.push(cursor);
      cursor = addDaysStr(cursor, 1);
    }
    return out;
  }

  const firstMarkOf = (habit) => Object.keys(habit.marks || {}).sort()[0] || null;

  // Marks that sit before the habit's start date: not deleted, but not
  // counted either, because isDue says the habit was asking nothing of them.
  // Moving a start date forward does this silently, which is why the modal
  // says so.
  function orphanedMarks(habit, startStr) {
    return Object.keys(habit && habit.marks || {}).filter((d) => d < startStr).length;
  }

  // Habits is Notes' third mode (0.171.1), so "am I showing?" is a mode
  // question. Mirrors Todos.isTodoMode, and is what the year/category chip
  // rows ask before drawing controls a habit has no use for.
  const isHabitsMode = () => state.view === "notes" && state.notesMode === "habits";

  // The app-wide search, same contract as every other view's.
  function getFilteredHabits() {
    const q = state.search.trim().toLowerCase();
    const live = (state.data.habits || []).filter((h) => !h.archivedAt);
    if (!q) return live;
    return live.filter((h) => h.name.toLowerCase().includes(q));
  }

  const byOrder = (a, b) => (a.order - b.order) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));

  // ---------- the view ----------
  // One card per habit, each doing the three things a habit tracker has to:
  // tick today, show the run, show the pattern. Today's tick is the biggest
  // thing on the card because it is the only one you do daily — the grid and
  // the numbers are there to be read, not operated.
  const GRID_WEEKS = 12;

  function renderHabits(root) {
    const all = getFilteredHabits().slice().sort(byOrder);
    if (!(state.data.habits || []).length) {
      root.appendChild(emptyState({
        glyph: "✓",
        title: "No habits yet",
        body: "A habit is something you keep doing rather than something you finish — reading before bed, running on Tuesdays, no screens after ten. Tick it each day and the streak takes care of itself.",
        action: "Add your first habit",
        onAction: () => openHabitModal(null),
      }));
      return;
    }
    // No early return here. Archiving your only habit used to land on "no
    // habits match your search" with the archived section never rendered —
    // the habit, and its whole history, simply unreachable. Whatever is or
    // isn't in the live list, the archived list below still draws.
    const today = todayStr();
    const due = all.filter((h) => isDue(h, today));
    const kept = due.filter((h) => isDone(h, today));
    if (due.length) {
      const bar = el("div", "habit-today");
      bar.appendChild(el("span", "habit-today-count", kept.length + " of " + due.length));
      bar.appendChild(el("span", "habit-today-label",
        kept.length === due.length ? "done today — all of it" : "done today"));
      root.appendChild(bar);
    }

    if (all.length) {
      for (const h of all) root.appendChild(habitCard(h, today));
    } else {
      root.appendChild(emptyState(state.search.trim()
        ? "No habits match your search."
        : "Every habit is archived. Open one below to start it again."));
    }

    const archived = (state.data.habits || []).filter((x) => x.archivedAt);
    if (archived.length) {
      const wrap = el("div", "habit-archived");
      wrap.appendChild(el("p", "hint", archived.length + (archived.length === 1 ? " archived habit" : " archived habits")));
      for (const h of archived.sort(byOrder)) {
        const row = el("button", "habit-archived-row");
        row.type = "button";
        const dot = el("span", "habit-dot");
        dot.style.background = h.color;
        row.appendChild(dot);
        row.appendChild(el("span", "habit-archived-name", h.name));
        row.appendChild(el("span", "habit-archived-when", "stopped " + h.archivedAt));
        row.onclick = () => openHabitModal(h);
        wrap.appendChild(row);
      }
      root.appendChild(wrap);
    }
  }

  function habitCard(h, today) {
    const card = el("div", "habit-card");
    card.dataset.id = h.id;

    const head = el("div", "habit-head");
    const dot = el("span", "habit-dot");
    dot.style.background = h.color;
    head.appendChild(dot);
    const name = el("button", "habit-name", h.name);
    name.type = "button";
    name.title = "Edit this habit";
    name.onclick = () => openHabitModal(h);
    head.appendChild(name);
    const run = streakOf(h, today);
    if (run) {
      const s = el("span", "habit-streak", "🔥 " + run);
      s.title = run + (run === 1 ? " day" : " days") + " in a row";
      head.appendChild(s);
    }
    card.appendChild(head);

    const sub = el("div", "habit-sub");
    sub.appendChild(el("span", null, cadenceLabel(h) + (h.target > 1 ? " · " + h.target + "× a day" : "")));
    const best = bestStreakOf(h, today);
    const window90 = statsFor(h, addDaysStr(today, -89), today);
    const bits = [];
    if (best) bits.push("best " + best);
    if (window90.due) bits.push(Math.round(window90.rate * 100) + "% of the last 90 days");
    if (bits.length) sub.appendChild(el("span", "habit-sub-right", bits.join(" · ")));
    card.appendChild(sub);

    // What the card is otherwise silent about: everything longer than the
    // last ninety days. Backfilling two years of history and watching the
    // card look exactly as it did is the moment you wonder why you bothered.
    const life = statsFor(h, h.startedAt || today, today);
    if (life.due > window90.due) {
      card.appendChild(el("p", "habit-life",
        "Since " + prettyDate(h.startedAt) + " · " + life.done + " of " + life.due + " days kept"));
    }

    // Today's tick, the one control you use every day.
    if (isDue(h, today)) {
      const n = markOf(h, today);
      const btn = el("button", "habit-tick" + (isDone(h, today) ? " is-done" : ""));
      btn.type = "button";
      btn.dataset.id = h.id;
      btn.appendChild(el("span", "habit-tick-mark", isDone(h, today) ? "✓" : (h.target > 1 ? String(n) : "")));
      btn.appendChild(el("span", "habit-tick-label",
        h.target > 1 ? n + " of " + h.target + " today" : (isDone(h, today) ? "Done today" : "Tick for today")));
      btn.style.setProperty("--habit-colour", h.color);
      btn.onclick = () => tick(h.id, today);
      card.appendChild(btn);
    } else {
      card.appendChild(el("p", "habit-notdue", "Not due today — " + cadenceLabel(h)));
    }

    card.appendChild(grid(h, today));
    return card;
  }

  // Which twelve weeks a card is showing, by habit id. Module-level rather
  // than per-render so a tick — which re-renders the whole view — doesn't
  // throw you back to this week in the middle of filling in last spring.
  const gridOffset = new Map();

  // The Sunday that opens the window `off` weeks back from today, so every
  // column is a whole week and the rows line up with the weekday labels.
  function windowStart(today, off) {
    const end = addDaysStr(today, -off * 7);
    return addDaysStr(addDaysStr(end, -(GRID_WEEKS - 1) * 7), -dowOf(end));
  }

  // The furthest back worth going: the first window whose start has passed
  // the day the habit began. Anything beyond it is twelve columns of nothing.
  function maxOffset(h, today) {
    const floor = h.startedAt || "1970-01-01";
    const first = windowStart(today, 0);
    if (first <= floor) return 0;
    const days = Math.round((new Date(first + "T00:00:00") - new Date(floor + "T00:00:00")) / 86400000);
    return Math.min(MAX_WEEKS, Math.ceil(days / 7));
  }

  // A press moves a whole window, the way a calendar pages by month rather
  // than by day. 0.172.0 moved one week, which made a year ago fifty-two
  // presses away — the arrows worked and were useless, and the test that
  // clicked twenty-five times to reach a day four months back was saying so.
  function pageGrid(id, delta) {
    const h = (state.data.habits || []).find((x) => x.id === id);
    if (!h) return;
    const today = todayStr();
    const off = Math.min(maxOffset(h, today), Math.max(0, (gridOffset.get(id) || 0) + delta * GRID_WEEKS));
    gridOffset.set(id, off);
    // Repaint this one card's grid rather than the whole view: nothing else
    // on the page changed, and a full render would scroll under you.
    repaintGrid(id);
    const card = document.querySelector('.habit-card[data-id="' + id + '"]');
    const again = card && card.querySelector('.habit-page[data-dir="' + delta + '"]');
    if (again && !again.disabled) again.focus();
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthOf = (s) => MONTHS[+s.slice(5, 7) - 1];
  const prettyDate = (s) => isDateStr(s) ? +s.slice(8, 10) + " " + monthOf(s) + " " + s.slice(0, 4) : "";
  function rangeLabel(a, b) {
    const ya = a.slice(0, 4), yb = b.slice(0, 4);
    if (ya !== yb) return monthOf(a) + " " + ya + " – " + monthOf(b) + " " + yb;
    const ma = monthOf(a), mb = monthOf(b);
    return (ma === mb ? ma : ma + " – " + mb) + " " + yb;
  }

  // Twelve weeks of days, newest column last, one row per weekday. Tapping a
  // cell fixes a day you forgot to tick, which is the only way a tracker
  // survives a day you were away from your phone. Older than twelve weeks,
  // the arrows walk the window back as far as the habit's start date — a
  // start date you can move back is worth nothing if the days it uncovers
  // are off the end of the grid.
  function grid(h, today) {
    const wrap = el("div", "habit-grid");
    const max = maxOffset(h, today);
    const off = Math.min(max, gridOffset.get(h.id) || 0);
    gridOffset.set(h.id, off);
    const start = windowStart(today, off);
    // No arrows on a habit whose whole life fits in one window: two dead
    // controls read as a broken card.
    if (max > 0) {
      const nav = el("div", "habit-grid-nav");
      const back = el("button", "habit-page", "‹");
      back.type = "button";
      back.dataset.dir = "1";
      back.title = "Earlier weeks";
      back.disabled = off >= max;
      back.onclick = () => pageGrid(h.id, 1);
      const fwd = el("button", "habit-page", "›");
      fwd.type = "button";
      fwd.dataset.dir = "-1";
      fwd.title = "Later weeks";
      fwd.disabled = off === 0;
      fwd.onclick = () => pageGrid(h.id, -1);
      nav.appendChild(back);
      nav.appendChild(el("span", "habit-page-range", rangeLabel(start, addDaysStr(start, GRID_WEEKS * 7 - 1))));
      nav.appendChild(fwd);
      wrap.appendChild(nav);
    }
    // Only the weekdays this habit is ever due on. A Mon/Wed/Fri habit drawn
    // on seven rows is four permanently empty ones — a lot of card spent
    // saying nothing, and it reads as though the grid is broken.
    const c = h.cadence;
    const rows = !c || c === "daily" ? [0, 1, 2, 3, 4, 5, 6] : c.days;
    for (const row of rows) {
      const line = el("div", "habit-grid-row");
      const lbl = el("span", "habit-grid-day",
        rows.length > 4 ? (row % 2 ? DAY_LABELS[row].slice(0, 1) : "") : DAY_LABELS[row].slice(0, 1));
      line.appendChild(lbl);
      for (let col = 0; col < GRID_WEEKS; col++) {
        const date = addDaysStr(start, col * 7 + row);
        const cell = el("button", "habit-cell");
        cell.type = "button";
        cell.dataset.date = date;
        if (date > today) {
          cell.classList.add("is-future");
          cell.disabled = true;
        } else if (!isDue(h, date)) {
          cell.classList.add("is-off");
          cell.disabled = true;
          cell.title = date + " — not due";
        } else {
          const n = markOf(h, date);
          const done = isDone(h, date);
          if (done) { cell.classList.add("is-done"); cell.style.background = h.color; }
          else if (n) { cell.classList.add("is-part"); cell.style.background = h.color + "66"; }
          cell.title = date + (done ? " — done" : n ? ` — ${n} of ${h.target}` : " — missed");
          if (anchor && anchor.id === h.id && anchor.date === date) cell.classList.add("is-anchor");
          cell.onclick = (ev) => onCellPress(h.id, date, ev);
        }
        line.appendChild(cell);
      }
      wrap.appendChild(line);
    }
    if (anchor && anchor.id === h.id) {
      wrap.appendChild(el("p", "habit-range-hint",
        "Tap the day this run ends on — or the same day again to stop."));
    }
    longPressCells(wrap, h.id);
    return wrap;
  }

  // ---------- filling a run ----------
  // The start date covers the history you had before the app knew about the
  // habit, which happens once. The run you missed while you were away
  // happens over and over, and tapping nine cells across two columns is the
  // point at which people stop bothering.
  //
  // Held-then-tapped rather than dragged: a drag needs `touch-action: none`
  // over the grid, which is more than half the height of every card, and
  // that is the surface you scroll the list with.
  let anchor = null;

  // Delegated to the grid rather than bound per cell: a card is 84 cells, and
  // four listeners each is 336 for a thing that can only be happening to one
  // of them at a time.
  function longPressCells(wrap, id) {
    let timer = null, from = null;
    const stop = () => { if (timer) clearTimeout(timer); timer = null; from = null; };
    wrap.addEventListener("pointerdown", (ev) => {
      const cell = ev.target.closest && ev.target.closest(".habit-cell");
      if (!cell || cell.disabled || !cell.dataset.date) return;
      from = { x: ev.clientX, y: ev.clientY };
      const date = cell.dataset.date;
      timer = setTimeout(() => {
        timer = null;
        // `at` is how the click the browser sends after the press gets
        // ignored. A flag doesn't work: setting the anchor repaints the grid,
        // so that click may land on a different node, on nothing at all, or
        // (on touch) never come — and a flag left standing swallows the next
        // real tap instead, which is the one choosing the other end.
        anchor = { id, date, at: performance.now() };
        repaintGrid(id);
      }, 500);
    });
    // Cancelled by movement, so a press that turns into a scroll doesn't
    // leave an anchor behind on the way past.
    wrap.addEventListener("pointermove", (ev) => {
      if (from && (Math.abs(ev.clientX - from.x) > 10 || Math.abs(ev.clientY - from.y) > 10)) stop();
    });
    wrap.addEventListener("pointerup", stop);
    wrap.addEventListener("pointercancel", stop);
  }

  function onCellPress(id, date, ev) {
    if (anchor && anchor.id === id && performance.now() - anchor.at < 350) return;
    if (anchor && anchor.id === id) {
      const from = anchor.date;
      anchor = null;
      if (from === date) { repaintGrid(id); return; }
      return fillRange(id, from < date ? from : date, from < date ? date : from);
    }
    // Shift-click is the same thing without the wait, for anyone on a mouse.
    if (ev && ev.shiftKey && lastPressed && lastPressed.id === id && lastPressed.date !== date) {
      const from = lastPressed.date;
      return fillRange(id, from < date ? from : date, from < date ? date : from);
    }
    lastPressed = { id, date };
    return tick(id, date);
  }
  let lastPressed = null;

  // Fill unless the whole run is already kept, in which case clear it. One
  // rule, and the outcome is the one you wanted either way: "make this run
  // done" and "no, undo that" are the only two things anyone means.
  async function fillRange(id, fromStr, toStr) {
    const h = (state.data.habits || []).find((x) => x.id === id);
    if (!h) return;
    const days = dueDaysBetween(h, fromStr, toStr);
    if (!days.length) { repaintGrid(id); return; }
    const undo = snapshot(h);
    const clearing = days.every((d) => isDone(h, d));
    const marks = { ...(h.marks || {}) };
    // Counted, not assumed: dragging over a run that is mostly done and being
    // told "filled in 8 days" when one day changed is the app describing your
    // gesture back to you instead of what it did.
    let n = 0;
    for (const d of days) {
      const to = clearing ? 0 : h.target || 1;
      if ((marks[d] || 0) === to) continue;
      if (to) marks[d] = to; else delete marks[d];
      n++;
    }
    if (!n) { repaintGrid(id); return; }
    if (Object.keys(marks).length) h.marks = marks; else delete h.marks;
    render();
    await persist();
    toast((clearing ? "Cleared " : "Filled in ") + n + (n === 1 ? " day" : " days"), false,
      { label: "Undo", onClick: () => revert(undo) });
  }

  function repaintGrid(id) {
    const h = (state.data.habits || []).find((x) => x.id === id);
    const card = document.querySelector('.habit-card[data-id="' + id + '"]');
    const old = card && card.querySelector(".habit-grid");
    if (!h || !old) { render(); return; }
    old.replaceWith(grid(h, todayStr()));
  }

  // Resolved by id at click time rather than over a captured habit: a render
  // can replace the node under the handler, and a captured object goes stale
  // the moment it does (the same trap noteCard fell into — see NOTES.md).
  async function tick(id, dateStr) {
    const h = (state.data.habits || []).find((x) => x.id === id);
    if (!h) return;
    const n = nextMark(h, dateStr);
    const marks = { ...(h.marks || {}) };
    if (n > 0) marks[dateStr] = n; else delete marks[dateStr];
    if (Object.keys(marks).length) h.marks = marks; else delete h.marks;
    render();
    await persist();
  }

  // ---------- the modal ----------
  let editingId = null;
  let startWas = null; // the start date the modal opened with

  function openHabitModal(habit) {
    editingId = habit ? habit.id : null;
    $("#habitModalTitle").textContent = habit ? "Edit habit" : "Add habit";
    $("#habitName").value = habit ? habit.name : "";
    $("#habitTarget").value = habit ? habit.target : 1;
    $("#habitColor").value = habit ? habit.color : (CATEGORY_PALETTE[(state.data.habits || []).length % CATEGORY_PALETTE.length] || "#5b8cff");
    // Backfilling starts here: a habit you have been keeping for months
    // before you told the app about it has a start date in the past, and
    // until 0.172.0 this was pinned to the day you created it with no way to
    // move it — which made every earlier day permanently un-tickable.
    startWas = habit ? habit.startedAt : todayStr();
    $("#habitStart").value = startWas;
    $("#habitStart").max = todayStr();
    $("#habitFill").checked = false;
    const days = habit && habit.cadence && habit.cadence.days;
    $("#habitCadence").value = days ? "days" : "daily";
    const boxes = [...document.querySelectorAll("#habitDays input")];
    boxes.forEach((b, i) => { b.checked = days ? days.includes(i) : [1, 2, 3, 4, 5].includes(i); });
    // After the cadence, not before: the backfill count is counted off the
    // form, and the form still held the last habit's days until now.
    applyStartUI();
    $("#deleteHabitBtn").hidden = !habit;
    $("#archiveHabitBtn").hidden = !habit;
    $("#archiveHabitBtn").textContent = habit && habit.archivedAt ? "↩ Un-archive" : "⏸ Archive";
    applyCadenceUI();
    $("#habitModal").hidden = false;
  }
  function closeHabitModal() { $("#habitModal").hidden = true; editingId = null; }

  function applyCadenceUI() {
    $("#habitDaysLabel").hidden = $("#habitCadence").value !== "days";
  }

  // The two things a start date can do, both answered before you press Save
  // rather than in a native dialog after it.
  //
  // 0.172.0 asked with confirm() on save, which had two faults: you met the
  // question after committing to it, and "no" was final — the offer only ever
  // fired on a date change, so declining it left no way back except moving
  // the date away and back again. A checkbox you can see, uncheck and check
  // is the same question without either.
  function applyStartUI() {
    const hint = $("#habitStartHint");
    const label = $("#habitFillLabel");
    const v = $("#habitStart").value;
    const h = editingId ? (state.data.habits || []).find((x) => x.id === editingId) : null;
    const was = startWas || todayStr();

    // Moving it forward doesn't delete anything, but isDue stops asking about
    // those days, so the record quietly stops counting. Say so.
    const orphans = isDateStr(v) && v > was && h ? orphanedMarks(h, v) : 0;
    hint.textContent = orphans
      ? orphans + (orphans === 1 ? " recorded day is" : " recorded days are") +
        " before this date. They're kept, but stop counting until you move it back."
      : "";
    hint.hidden = !orphans;

    const days = isDateStr(v) && v < was ? backfillDays(h, v, addDaysStr(was, -1)) : [];
    const target = Math.max(1, Math.round(+$("#habitTarget").value) || 1);
    $("#habitFillText").textContent = days.length
      ? "Mark those " + days.length + (days.length === 1 ? " day" : " days") + " as done" +
        (target > 1 ? " (" + target + "× each)" : "")
      : "";
    label.hidden = !days.length;
    if (!days.length) $("#habitFill").checked = false;
  }

  // The days a start date of `fromStr` would uncover: due, and with nothing
  // recorded. For a habit that doesn't exist yet, every day in the range.
  function backfillDays(habit, fromStr, toStr) {
    // The cadence as the form currently has it, not as it was saved: the
    // count has to be about the habit you are about to press Save on.
    return blankDaysBetween({
      cadence: cadenceFromForm(),
      target: 1,
      startedAt: fromStr,
      archivedAt: habit && habit.archivedAt,
      marks: (habit && habit.marks) || {},
    }, fromStr, toStr);
  }

  function cadenceFromForm() {
    if ($("#habitCadence").value !== "days") return "daily";
    const days = [...document.querySelectorAll("#habitDays input")]
      .map((b, i) => (b.checked ? i : -1)).filter((i) => i >= 0);
    return days.length && days.length < 7 ? { days } : "daily";
  }

  async function saveHabitFromForm(ev) {
    ev.preventDefault();
    const name = $("#habitName").value.trim();
    if (!name) return;
    const days = [...document.querySelectorAll("#habitDays input")]
      .map((b, i) => (b.checked ? i : -1)).filter((i) => i >= 0);
    if ($("#habitCadence").value === "days" && !days.length) {
      toast("Pick at least one day, or switch back to every day", true);
      return;
    }
    const startedAt = isDateStr($("#habitStart").value) ? $("#habitStart").value : todayStr();
    if (startedAt > todayStr()) { toast("A habit can't start in the future", true); return; }
    const shape = {
      name,
      color: $("#habitColor").value,
      target: Math.max(1, Math.round(+$("#habitTarget").value) || 1),
      cadence: $("#habitCadence").value === "days" ? { days } : "daily",
      startedAt,
    };
    const fill = !$("#habitFillLabel").hidden && $("#habitFill").checked;
    let filled = 0, undo = null;
    if (editingId) {
      const h = (state.data.habits || []).find((x) => x.id === editingId);
      if (h) {
        const wasFrom = h.startedAt;
        undo = snapshot(h);
        Object.assign(h, shape);
        // Moving the start back uncovers days that now ask for something and
        // have nothing recorded. Ticking fifty cells by hand is the
        // difference between backfilling being possible and being done — but
        // the app does not get to decide you kept a habit, so it only
        // happens because the box was ticked.
        if (fill && startedAt < wasFrom) filled = applyBackfill(h, startedAt, addDaysStr(wasFrom, -1));
      }
    } else {
      const order = (state.data.habits || []).reduce((m, h) => Math.max(m, h.order || 0), 0) + 1;
      const made = sanitizeHabit({ ...shape, order, createdAt: new Date().toISOString() });
      state.data.habits.push(made);
      undo = snapshot(made);
      if (fill && startedAt < todayStr()) filled = applyBackfill(made, startedAt, addDaysStr(todayStr(), -1));
    }
    const wasEditing = editingId;
    closeHabitModal();
    render();
    await persist();
    if (filled) {
      toast("Filled in " + filled + (filled === 1 ? " day" : " days"), false,
        { label: "Undo", onClick: () => revert(undo) });
    } else {
      toast(wasEditing ? "Habit updated" : "Habit added");
    }
  }

  // Enough of a habit to put back the way it was. Only the two things a bulk
  // write touches, so an undo can't clobber an unrelated edit made since.
  const snapshot = (h) => ({ id: h.id, startedAt: h.startedAt, marks: { ...(h.marks || {}) } });

  async function revert(snap) {
    const h = (state.data.habits || []).find((x) => x.id === snap.id);
    if (!h) return;
    h.startedAt = snap.startedAt;
    if (Object.keys(snap.marks).length) h.marks = { ...snap.marks }; else delete h.marks;
    render();
    await persist();
    toast("Put back");
  }

  function applyBackfill(habit, fromStr, toStr) {
    const blank = blankDaysBetween(habit, fromStr, toStr);
    if (!blank.length) return 0;
    const marks = { ...(habit.marks || {}) };
    for (const d of blank) marks[d] = habit.target || 1;
    habit.marks = marks;
    return blank.length;
  }

  // Every day in the range the habit now asks for and has nothing recorded
  // against.
  function blankDaysBetween(habit, fromStr, toStr) {
    const blank = [];
    if (!isDateStr(fromStr) || !isDateStr(toStr)) return blank;
    let cursor = fromStr;
    for (let guard = 0; guard < 4000 && cursor <= toStr; guard++) {
      if (isDue(habit, cursor) && !markOf(habit, cursor)) blank.push(cursor);
      cursor = addDaysStr(cursor, 1);
    }
    return blank;
  }


  // Archiving, not deleting, is the ordinary way to stop: the point of a
  // habit is its history, and a year of ticks is not something to throw away
  // because you stopped in March.
  async function archiveCurrentHabit() {
    const h = (state.data.habits || []).find((x) => x.id === editingId);
    if (!h) return;
    if (h.archivedAt) delete h.archivedAt; else h.archivedAt = todayStr();
    const was = !!h.archivedAt;
    closeHabitModal();
    render();
    await persist();
    toast(was ? "Archived — its history stays" : "Back in the list");
  }

  async function deleteCurrentHabit() {
    const h = (state.data.habits || []).find((x) => x.id === editingId);
    if (!h) return;
    const n = Object.keys(h.marks || {}).length;
    if (n && !confirm(`Delete “${h.name}”? Its ${n} recorded ${n === 1 ? "day goes" : "days go"} with it. Archive instead to keep them.`)) return;
    state.data.habits = state.data.habits.filter((x) => x.id !== h.id);
    closeHabitModal();
    render();
    await persist();
    toast("Habit deleted");
  }

  function wire() {
    $("#habitForm").onsubmit = saveHabitFromForm;
    $("#cancelHabitBtn").onclick = closeHabitModal;
    $("#deleteHabitBtn").onclick = deleteCurrentHabit;
    $("#archiveHabitBtn").onclick = archiveCurrentHabit;
    $("#habitCadence").onchange = () => { applyCadenceUI(); applyStartUI(); };
    $("#habitStart").oninput = applyStartUI;
    $("#habitTarget").oninput = applyStartUI;
    $("#habitDays").oninput = applyStartUI;
  }

  window.LifeLogHabits = {
    init, wire, renderHabits, openHabitModal, closeHabitModal, isHabitsMode,
    sanitizeHabit,
    getFilteredHabits,
    // pure, and the point of the feature — see test/habits.test.js
    isDue, cadenceLabel, markOf, isDone, nextMark,
    streakOf, bestStreakOf, statsFor, blankDaysBetween,
    dueBetween, keptBetween, dueDaysBetween, orphanedMarks, firstMarkOf,
    windowStart, maxOffset, rangeLabel, prettyDate, GRID_WEEKS,
    localDateStr, todayStr, addDaysStr, byOrder,
    DAY_LABELS,
  };
})();
