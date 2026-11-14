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
  const ico = (n, c) => window.LifeLogIcons.svg(n, c);
  // Where a week starts and how a date reads (0.301.0). Under Node (the
  // bridge, the tests) nothing loaded dates.js as a script.
  const Dates = () => window.LifeLogDates || require("./dates.js");
  let state, $, el, uid, toast, persist, render, emptyState, activatable,
    backfillUpdatedAt, keepUnknown, CATEGORY_PALETTE, buildCatFilter;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, emptyState, activatable,
      backfillUpdatedAt, keepUnknown, CATEGORY_PALETTE, buildCatFilter } = ctx);
    const CM = window.LifeLogContextMenu;
    if (CM) CM.register("habit", (id, hp) => {
      const h = (state.data.habits || []).find((x) => x.id === id);
      if (!h) return null;
      return [
        { icon: "pencil", label: "Edit", run: () => openHabitModal(h) },
        { icon: "archive", label: h.archivedAt ? "Start again" : "Archive", run: () => archiveHabit(id) },
        hp.divider,
        // The sheet only asks when there's history to lose; a right-click
        // is an easier slip, so it always asks.
        { icon: "trash", label: "Delete", danger: true, run: () => {
          if (!Object.keys(h.marks || {}).length && !confirm(`Delete “${h.name}”?`)) return;
          deleteHabit(id);
        } },
      ];
    });
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
    "startedAt", "archivedAt", "createdAt", "updatedAt", "marks", "avoid", "limit",
    "period", "unit",
  ]);
  // Goals (0.300.0): a target can be counted over a week, a month or a year
  // rather than a day ("the gym, three times a week, any days"), and in
  // minutes rather than times ("an hour on the project"). Both absent is the
  // habit as it always was: times a day.
  const PERIODS = ["week", "month", "year"];
  const MAX_TARGET = 100000;

  function sanitizeHabit(h) {
    const out = {
      id: h.id || uid(),
      name: String(h.name == null ? "" : h.name).trim(),
      color: /^#[0-9a-fA-F]{6}$/.test(h.color || "") ? h.color : "#5b8cff",
      // "daily", or a set of weekdays. A days list that ends up empty means
      // the habit is due on no day at all, which is not a habit — it falls
      // back to daily rather than becoming a thing you can never keep.
      cadence: "daily",
      target: Math.min(MAX_TARGET, Math.max(1, Math.round(+h.target) || 1)),
      order: Number.isFinite(+h.order) ? +h.order : 0,
      startedAt: isDateStr(h.startedAt) ? h.startedAt : todayStr(),
      createdAt: h.createdAt || null,
      updatedAt: backfillUpdatedAt(h),
    };
    const days = h.cadence && Array.isArray(h.cadence.days)
      ? [...new Set(h.cadence.days.map((n) => +n).filter((n) => n >= 0 && n <= 6))].sort()
      : null;
    const period = PERIODS.includes(h.period) ? h.period : null;
    // Certain weekdays only mean something for a daily target: three times a
    // week is any three days, which is the whole point of it.
    if (days && days.length && days.length < 7 && !period) out.cadence = { days };
    if (period) out.period = period;
    if (h.unit === "min") out.unit = "min";
    if (isDateStr(h.archivedAt)) out.archivedAt = h.archivedAt;
    // Something you're keeping away from (0.203.0): marks count slips, and
    // a day is kept while they stay at or under `limit` — 0 for "none at
    // all", 1 for "at most one coffee". Absent on every habit you do.
    if (h.avoid) {
      // Avoiding stays a daily limit of slips; a weekly one is a different
      // feature nobody has asked for.
      delete out.period;
      delete out.unit;
      out.avoid = true;
      out.target = 1;
      out.limit = Math.max(0, Math.min(99, Math.round(+h.limit) || 0));
    }
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
    // Which days are the weekend follows the week (0.301.0): a week that
    // starts on Saturday has Friday and Saturday off.
    const D = Dates();
    const same = (set) => days.length === set.length && set.every((d) => days.includes(d));
    if (same(D.workDays())) return "Weekdays";
    if (same(D.weekendDays())) return "Weekends";
    return D.weekOrder().filter((d) => days.includes(d)).map((d) => DAY_LABELS[d]).join(", ");
  }

  // ---------- goals: periods and minutes ----------
  const periodOf = (habit) => (habit && PERIODS.includes(habit.period) ? habit.period : "day");
  const isPeriodic = (habit) => periodOf(habit) !== "day";
  const isMinutes = (habit) => !!habit && habit.unit === "min";

  // The period a date sits in. A week starts on the day Settings → Dates
  // says, the same as the grid's columns, so a week you look at is a week
  // that's counted.
  function periodRange(period, dateStr) {
    if (period === "week") {
      const from = Dates().startOfWeek(dateStr);
      return [from, addDaysStr(from, 6)];
    }
    const y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7);
    if (period === "month") {
      const mm = String(m).padStart(2, "0");
      return [y + "-" + mm + "-01", y + "-" + mm + "-" + String(new Date(y, m, 0).getDate()).padStart(2, "0")];
    }
    if (period === "year") return [y + "-01-01", y + "-12-31"];
    return [dateStr, dateStr];
  }

  // What's been done between two dates, inside the habit's own life.
  function amountBetween(habit, fromStr, toStr) {
    const range = habit && clipRange(habit, fromStr, toStr);
    if (!range) return 0;
    let n = 0;
    for (const [d, v] of Object.entries(habit.marks || {})) if (d >= range[0] && d <= range[1]) n += +v || 0;
    return n;
  }

  // Where the habit stands in the period `dateStr` is in: how much is done,
  // how much is left, and how many days the period still has after today.
  function progressOf(habit, dateStr) {
    const today = dateStr || todayStr();
    const period = periodOf(habit);
    const [from, to] = periodRange(period, today);
    const done = period === "day" ? markOf(habit, today) : amountBetween(habit, from, to);
    const target = habit.target || 1;
    return { period, from, to, done, target, met: done >= target, left: Math.max(0, target - done), daysLeft: daysApart(today, to) };
  }

  // "1 hour", "90 min", "2 h 30 min".
  function minutesLabel(n) {
    n = Math.max(0, Math.round(+n || 0));
    if (n < 60) return n + " min";
    const h = Math.floor(n / 60), m = n % 60;
    if (!m) return h + (h === 1 ? " hour" : " hours");
    return h + " h " + m + " min";
  }
  // Shorter, for a button: "25m", "1h", "2h30".
  function minutesShort(n) {
    n = Math.max(0, Math.round(+n || 0));
    if (n < 60) return n + "m";
    const h = Math.floor(n / 60), m = n % 60;
    return m ? h + "h" + String(m).padStart(2, "0") : h + "h";
  }
  const amountLabel = (habit, n) => (isMinutes(habit) ? minutesLabel(n) : n === 1 ? "once" : n === 2 ? "twice" : n + " times");

  // "3 times a week", "1 hour a day", "Weekdays · 30 min".
  function goalLabel(habit) {
    if (!habit || habit.avoid) return cadenceLabel(habit);
    const period = periodOf(habit);
    const t = habit.target || 1;
    if (period !== "day") {
      const amount = amountLabel(habit, t);
      return amount.charAt(0).toUpperCase() + amount.slice(1) + " a " + period;
    }
    if (isMinutes(habit)) {
      const c = habit.cadence;
      return (!c || c === "daily") ? minutesLabel(t) + " a day" : cadenceLabel(habit) + " · " + minutesLabel(t);
    }
    return cadenceLabel(habit) + (t > 1 ? " · " + t + "×" : "");
  }

  // How a period reads on a button and in the left-to-do list.
  function periodName(period, dateStr, short) {
    if (period === "week") return "this week";
    if (period === "month") return short ? "in " + MONTHS[+dateStr.slice(5, 7) - 1] : MONTH_NAMES[+dateStr.slice(5, 7) - 1];
    if (period === "year") return short ? "in " + dateStr.slice(0, 4) : dateStr.slice(0, 4);
    return "today";
  }
  const PERIOD_UNIT = { day: ["day", "days"], week: ["week", "weeks"], month: ["month", "months"], year: ["year", "years"] };
  const periodWord = (period, n) => PERIOD_UNIT[period][n === 1 ? 0 : 1];

  // The periods from the one `fromStr` is in to the one `toStr` is in, as
  // [start, end] pairs. Bounded, so corrupt dates can't spin.
  function periodsBetween(period, fromStr, toStr) {
    const out = [];
    let [a, b] = periodRange(period, fromStr);
    for (let guard = 0; guard < MAX_DAYS && a <= toStr; guard++) {
      out.push([a, b]);
      [a, b] = periodRange(period, addDaysStr(b, 1));
    }
    return out;
  }
  const metIn = (habit, p) => amountBetween(habit, p[0], p[1]) >= (habit.target || 1);

  // ---------- marks ----------
  // A habit you do is kept once its marks reach the target. One you avoid is
  // kept until its slips pass the limit — so a day with nothing recorded is
  // a kept day, which is the point: not doing something shouldn't take a tap.
  const markOf = (habit, dateStr) => (habit && habit.marks && +habit.marks[dateStr]) || 0;
  const limitOf = (habit) => Math.max(0, +habit.limit || 0);
  // For a weekly, monthly or yearly goal a date counts as done once the
  // period it's in has reached the target: that's what the tick, the
  // reminders and the widgets ask.
  const isDone = (habit, dateStr) => (habit.avoid
    ? markOf(habit, dateStr) <= limitOf(habit)
    : isPeriodic(habit)
      ? (() => { const r = periodRange(habit.period, dateStr); return amountBetween(habit, r[0], r[1]) >= (habit.target || 1); })()
      : markOf(habit, dateStr) >= (habit.target || 1));
  // Where a tap wraps round: the target for a habit you do, one past the
  // limit (the first slip that breaks the day) for one you avoid.
  // A day of a weekly goal is one more toward it, so a tap there is a tick.
  const capOf = (habit) => (habit.avoid ? limitOf(habit) + 1 : isPeriodic(habit) ? 1 : habit.target || 1);

  // One tap advances by one and wraps round at the cap. For the ordinary
  // habit (target 1) that is exactly a tick: on, then off; for "none at all"
  // it's a slip, then not.
  function nextMark(habit, dateStr) {
    const now = markOf(habit, dateStr);
    return now >= capOf(habit) ? 0 : now + 1;
  }

  // The card's (and the widget's) tick on a weekly, monthly or yearly goal:
  // one more today until the period is met, then today's back to none, so a
  // tap too many is undone by the next.
  function nextPeriodMark(habit, dateStr) {
    if (!isPeriodic(habit)) return nextMark(habit, dateStr);
    return isDone(habit, dateStr) ? 0 : markOf(habit, dateStr) + 1;
  }

  // Switching a habit between doing and avoiding (0.205.0) keeps its history
  // meaning the same thing, so a week's streak is still a week: a day it was
  // kept stays kept, a day it wasn't becomes a slip, and the other way round.
  // Today is left open when it was missed — it isn't over — and carried as
  // done when it was kept, since the streak already counted it. Only due days
  // are written; everything else asks nothing either way.
  function convertMarks(habit, toAvoid, { target = 1, limit = 0 } = {}, todayDateStr) {
    const today = todayDateStr || todayStr();
    const first = firstMarkOf(habit);
    let cursor = first && first < habit.startedAt ? first : habit.startedAt;
    const end = habit.archivedAt && habit.archivedAt < today ? habit.archivedAt : today;
    const out = {};
    for (let guard = 0; guard < MAX_DAYS && cursor && cursor <= end; guard++) {
      if (isDue({ ...habit, startedAt: cursor <= habit.startedAt ? cursor : habit.startedAt }, cursor)) {
        const kept = isPeriodic(habit) ? markOf(habit, cursor) > 0 : isDone(habit, cursor);
        if (toAvoid && !kept && cursor !== today) out[cursor] = Math.max(0, limit) + 1;
        if (!toAvoid && kept) out[cursor] = Math.max(1, target);
      }
      cursor = addDaysStr(cursor, 1);
    }
    return out;
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
    if (isPeriodic(habit)) {
      const cur = periodRange(habit.period, today);
      return runBefore(habit, today) + (metIn(habit, cur) ? 1 : 0);
    }
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

  // Kept due days in a row ending the day before `dateStr`. That day is over,
  // so a due one not kept ends it. streakOf is exactly this plus the day
  // itself when it's kept; the widgets are sent this and add their own today
  // (native/widgets, WidgetStore.streakOn), which lets them count on past a
  // midnight the app didn't see.
  function runBefore(habit, dateStr) {
    if (!habit) return 0;
    const floor = habit.startedAt || "1970-01-01";
    // A goal's run is periods met in a row, ending with the one before
    // `dateStr`'s; the current period, like today, only ever adds.
    if (isPeriodic(habit)) {
      let p = periodRange(habit.period, addDaysStr(periodRange(habit.period, dateStr)[0], -1));
      let run = 0;
      for (let guard = 0; guard < MAX_DAYS && p[1] >= floor; guard++) {
        if (habit.archivedAt && p[0] > habit.archivedAt) { p = periodRange(habit.period, addDaysStr(p[0], -1)); continue; }
        if (!metIn(habit, p)) break;
        run++;
        p = periodRange(habit.period, addDaysStr(p[0], -1));
      }
      return run;
    }
    let cursor = addDaysStr(dateStr, -1);
    let run = 0;
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
    if (isPeriodic(habit)) return bestRunOf(habit, todayDateStr).days;
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
  // One you avoid is the other way round — its marks are the slips, so it's
  // every due day less the ones they broke.
  function keptBetween(habit, fromStr, toStr) {
    if (!habit || !isDateStr(fromStr) || !isDateStr(toStr)) return 0;
    const range = clipRange(habit, fromStr, toStr);
    if (!range) return 0;
    let n = 0;
    for (const d of Object.keys(habit.marks || {})) {
      if (d >= range[0] && d <= range[1] && isDue(habit, d) && isDone(habit, d) !== !!habit.avoid) n++;
    }
    return habit.avoid ? dueBetween(habit, fromStr, toStr) - n : n;
  }

  // How many of the days it asked for were kept, over a window.
  // A goal's window counts periods, not days: each one that ended inside it,
  // plus the one still running if it's already met — an unfinished week
  // isn't a missed one.
  function periodStats(habit, fromStr, toStr) {
    const range = clipRange(habit, fromStr, toStr);
    if (!range) return { due: 0, done: 0, rate: 0 };
    let due = 0, done = 0;
    for (const p of periodsBetween(habit.period, range[0], range[1])) {
      const met = metIn(habit, p);
      if (p[1] > range[1] && !met) continue;
      due++;
      if (met) done++;
    }
    return { due, done, rate: due ? done / due : 0 };
  }

  function statsFor(habit, fromStr, toStr) {
    if (isPeriodic(habit)) return periodStats(habit, fromStr, toStr);
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

  // ---------- insights (0.274.0) ----------
  // The grid shows the pattern; these say it. All over the habit's whole
  // life up to `today`, and all read off the marks the way keptBetween is,
  // so a ten-year habit costs its marks, not its days. A day the habit
  // isn't due is nobody's business, as everywhere else here.

  // Kept rate per weekday, only the weekdays the habit asks for.
  function weekdayRates(habit, todayDateStr) {
    const today = todayDateStr || todayStr();
    const out = [];
    const range = habit && clipRange(habit, habit.startedAt || today, today);
    if (!range || isPeriodic(habit)) return out;
    for (const dow of Dates().weekOrder()) {
      const c = habit.cadence;
      if (c && c !== "daily" && !(c.days || []).includes(dow)) continue;
      // Due days of this weekday in the range: the first one, then weekly.
      const first = (7 + dow - dowOf(range[0])) % 7;
      const span = daysApart(range[0], range[1]);
      const due = first > span ? 0 : Math.floor((span - first) / 7) + 1;
      let kept = 0;
      for (const d of Object.keys(habit.marks || {})) {
        if (d >= range[0] && d <= range[1] && dowOf(d) === dow && isDone(habit, d) !== !!habit.avoid) kept++;
      }
      if (habit.avoid) kept = due - kept;
      out.push({ dow, label: DAY_LABELS[dow], due, kept, rate: due ? kept / due : 0 });
    }
    return out;
  }

  // Kept rate per calendar month, the last `n` months ending with today's.
  function monthRates(habit, todayDateStr, n = 6) {
    const today = todayDateStr || todayStr();
    const out = [];
    // A monthly goal's month is one met-or-not, and a yearly one has no
    // months to speak of: the bars would be all or nothing.
    if (habit && (habit.period === "month" || habit.period === "year")) return out;
    let y = +today.slice(0, 4), m = +today.slice(5, 7);
    for (let i = 0; i < n; i++) {
      const mm = String(m).padStart(2, "0");
      const from = y + "-" + mm + "-01";
      const last = new Date(y, m, 0).getDate();
      const to = y + "-" + mm + "-" + String(last).padStart(2, "0");
      const s = statsFor(habit, from, to > today ? today : to);
      out.unshift({ month: y + "-" + mm, label: MONTHS[m - 1], due: s.due, kept: s.done, rate: s.rate });
      m--; if (m === 0) { m = 12; y--; }
    }
    return out;
  }

  // The longest run and when it was: bestStreakOf with its dates.
  function bestRunOf(habit, todayDateStr) {
    const none = { days: 0, from: null, to: null };
    if (!habit) return none;
    const today = todayDateStr || todayStr();
    // A goal's best run is in periods (`days` keeps its name for the
    // callers), from the first day of the first to the last of the last.
    if (isPeriodic(habit)) {
      const end = habit.archivedAt && habit.archivedAt < today ? habit.archivedAt : today;
      let run = 0, start = null, best = none;
      for (const p of periodsBetween(habit.period, habit.startedAt || end, end)) {
        if (metIn(habit, p)) {
          if (!run) start = p[0];
          run++;
          if (run > best.days) best = { days: run, from: start, to: p[1] };
        } else if (p[1] <= end) run = 0;
      }
      return best;
    }
    const dates = Object.keys(habit.marks || {}).sort();
    const last = dates.length ? dates[dates.length - 1] : today;
    const end = last > today ? last : today;
    let cursor = habit.startedAt || end;
    let run = 0, start = null, best = none;
    for (let guard = 0; guard < MAX_DAYS && cursor <= end; guard++) {
      if (isDue(habit, cursor)) {
        if (isDone(habit, cursor)) {
          if (!run) start = cursor;
          run++;
          if (run > best.days) best = { days: run, from: start, to: cursor };
        } else run = 0;
      }
      cursor = addDaysStr(cursor, 1);
    }
    return best;
  }

  // Marks that sit before the habit's start date: not deleted, but not
  // counted either, because isDue says the habit was asking nothing of them.
  // Moving a start date forward does this silently, which is why the modal
  // says so.
  function orphanedMarks(habit, startStr) {
    return Object.keys(habit && habit.marks || {}).filter((d) => d < startStr).length;
  }

  // Habits is Notes' third mode (0.171.1), so "am I showing?" is a mode
  // question, and it's what the year/category chip rows ask before drawing
  // controls a habit has no use for.
  const isHabitsMode = () => state.view === "notes" && state.notesMode === "habits";

  // The app-wide search, same contract as every other view's.
  function getFilteredHabits() {
    const q = state.search.trim().toLowerCase();
    const live = (state.data.habits || []).filter((h) => !h.archivedAt);
    if (!q) return live;
    return live.filter((h) => h.name.toLowerCase().includes(q));
  }

  // What's still open, for the panel at the top of the page (0.300.0): each
  // habit you do that's due today and not done, or whose week, month or
  // year hasn't reached its target, grouped by the period it has left. A
  // habit you avoid is kept until you say otherwise, so it's never "left".
  function leftToDo(habits, todayDateStr) {
    const today = todayDateStr || todayStr();
    const groups = { day: [], week: [], month: [], year: [] };
    const done = [];
    for (const h of habits || []) {
      if (h.archivedAt || !isDue(h, today)) continue;
      if (h.avoid) { if (isDone(h, today)) done.push(h); continue; }
      const p = progressOf(h, today);
      if (p.met) done.push(h); else groups[p.period].push({ habit: h, ...p });
    }
    return {
      groups: ["day", "week", "month", "year"].filter((k) => groups[k].length).map((k) => ({
        period: k, items: groups[k], daysLeft: daysApart(today, periodRange(k, today)[1]),
      })),
      left: groups.day.length + groups.week.length + groups.month.length + groups.year.length,
      done,
    };
  }

  const byOrder = (a, b) => (a.order - b.order) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));

  // ---------- the view ----------
  // One card per habit, each doing the three things a habit tracker has to:
  // tick today, show the run, show the pattern. Today's tick sits beside the
  // name, the one filled button on the card, because it is the only thing you
  // do daily — the grid and the numbers are there to be read, not operated.
  const GRID_WEEKS = 12;

  function renderHabits(root) {
    const all = getFilteredHabits().slice().sort(byOrder);
    if (!(state.data.habits || []).length) {
      root.appendChild(emptyState({
        glyph: "square-check-big",
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
    const R = window.LifeLogReminders;
    const remindBar = R && R.bar(all);
    if (remindBar) root.appendChild(remindBar);
    const panel = state.visual.habitsLeftPanel !== "hide" && leftPanel(all, today);
    if (panel) root.appendChild(panel);

    if (all.length) {
      // Columns wherever there's room for a second card beside the first.
      const list = el("div", "habit-list");
      for (const h of all) list.appendChild(habitCard(h, today));
      root.appendChild(list);
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
        if (window.LifeLogContextMenu) window.LifeLogContextMenu.attach(row, "habit", h.id);
        wrap.appendChild(row);
      }
      root.appendChild(wrap);
    }
  }

  // ---------- left to do (0.300.0) ----------
  // The answer to "what haven't I done yet": today's open habits, then the
  // weekly, monthly and yearly goals still short, each with how much is
  // left and a button that does the next bit. Replaces the "3 of 6 today"
  // line, which said how many without saying which.
  function leftPanel(habits, today) {
    const L = leftToDo(habits, today);
    if (!L.left && !L.done.length) return null;
    const box = el("section", "habit-left");
    box.setAttribute("aria-label", "Left to do");
    const head = el("div", "habit-left-head");
    if (L.left) {
      head.appendChild(el("span", "habit-today-count", String(L.left)));
      head.appendChild(el("span", "habit-today-label", "left to do"));
    } else {
      head.appendChild(el("span", "habit-today-label habit-left-clear", "Nothing left for now"));
    }
    box.appendChild(head);
    if (L.groups.length) {
      const groups = el("div", "habit-left-groups");
      for (const g of L.groups) {
        const wrap = el("div", "habit-left-group");
        const title = el("div", "habit-left-title");
        title.appendChild(el("span", null, g.period === "day" ? "Today" : g.period === "week" ? "This week"
          : periodName(g.period, today)));
        title.appendChild(el("span", null, g.period === "day" ? "ends tonight"
          : g.daysLeft === 0 ? "last day" : g.daysLeft + (g.daysLeft === 1 ? " day left" : " days left")));
        wrap.appendChild(title);
        for (const it of g.items) wrap.appendChild(leftRow(it, today));
        groups.appendChild(wrap);
      }
      box.appendChild(groups);
    }
    return box;
  }

  function leftRow(it, today) {
    const h = it.habit;
    const row = el("div", "habit-left-row");
    row.style.setProperty("--habit-colour", h.color);
    const dot = el("span", "habit-dot");
    dot.style.background = h.color;
    row.appendChild(dot);
    const name = el("button", "habit-left-name", h.name);
    name.type = "button";
    name.title = "Go to this habit";
    name.onclick = () => {
      const card = document.querySelector('.habit-card[data-id="' + h.id + '"]');
      if (card) card.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    row.appendChild(name);
    const mins = isMinutes(h);
    const left = it.done === 0 && it.target === 1 ? "not yet"
      : mins ? minutesLabel(it.left) + " left"
      : it.period === "day" ? it.done + " of " + it.target
      : it.left + " more";
    row.appendChild(el("span", "habit-left-left", left));
    const btn = el("button", "habit-left-do");
    btn.type = "button";
    if (mins) {
      btn.textContent = "+15";
      btn.setAttribute("aria-label", "Add 15 minutes to " + h.name);
      btn.onclick = () => addMinutes(h.id, today, 15);
    } else if (it.target === 1 && it.period === "day") {
      btn.appendChild(ico("check"));
      btn.setAttribute("aria-label", "Mark " + h.name + " done");
      btn.onclick = () => tick(h.id, today);
    } else {
      btn.textContent = "+1";
      btn.setAttribute("aria-label", "One more for " + h.name);
      btn.onclick = () => (isPeriodic(h) ? tickPeriod(h.id, today) : tick(h.id, today));
    }
    row.appendChild(btn);
    const bar = el("div", "habit-left-bar");
    const fill = el("i");
    fill.style.width = Math.min(100, Math.round(it.done / it.target * 100)) + "%";
    bar.appendChild(fill);
    row.appendChild(bar);
    return row;
  }

  const SHORT_PERIOD = { week: "wk", month: "mo", year: "yr" };

  function habitCard(h, today) {
    const card = el("div", "habit-card");
    card.dataset.id = h.id;
    if (window.LifeLogContextMenu) window.LifeLogContextMenu.attach(card, "habit", h.id);

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
      const s = el("span", "habit-streak");
      s.appendChild(window.LifeLogIcons.labelled("flame", String(run)));
      s.title = run + " " + periodWord(periodOf(h), run) + " in a row";
      head.appendChild(s);
    }
    // In the Android app, its reminder (see reminders.js).
    const remind = window.LifeLogReminders && window.LifeLogReminders.chip(h);
    if (remind) head.appendChild(remind);
    card.appendChild(head);

    const sub = el("div", "habit-sub");
    // One short line (0.205.0): how often, and the best run and the last
    // ninety days as numbers. The longer story is the grid's, and a tap
    // away in the title.
    sub.appendChild(el("span", null, h.avoid
      ? cadenceLabel(h) + " · avoid" + (limitOf(h) ? " · ≤" + limitOf(h) : "")
      : goalLabel(h)));
    const period = periodOf(h);
    const best = bestStreakOf(h, today);
    // A yearly goal has no "last 90 days" worth a number; it gets its life.
    const window90 = period === "year" ? statsFor(h, h.startedAt || today, today) : statsFor(h, addDaysStr(today, -89), today);
    const life = statsFor(h, h.startedAt || today, today);
    const bits = [];
    if (best) bits.push("best " + best + (SHORT_PERIOD[period] ? " " + SHORT_PERIOD[period] : ""));
    if (window90.due) bits.push(Math.round(window90.rate * 100) + "%");
    let right = null;
    if (bits.length) {
      right = el("span", "habit-sub-right", bits.join(" · "));
      right.title = (window90.due && period !== "year" ? Math.round(window90.rate * 100) + "% of the last 90 days. " : "")
        + "Since " + prettyDate(h.startedAt) + ": " + life.done + " of " + life.due + " " + periodWord(period, life.due) + " kept.";
    }
    card.appendChild(sub);

    card.appendChild(grid(h, today));

    // Today's tick, the one control you use every day, under the grid it
    // fills. On a habit you avoid it logs a slip instead.
    const actions = el("div", "habit-actions");
    card.appendChild(actions);
    if (isDue(h, today) && h.avoid) {
      actions.appendChild(slipButton(h, today));
    } else if (isDue(h, today) && (isPeriodic(h) || isMinutes(h))) {
      actions.appendChild(goalButton(h, today));
      if (isMinutes(h)) actions.appendChild(stepButtons(h, today));
    } else if (isDue(h, today)) {
      const n = markOf(h, today);
      const btn = el("button", "habit-tick" + (isDone(h, today) ? " is-done" : ""));
      btn.type = "button";
      btn.dataset.id = h.id;
      // The label says "2 of 3"; a count beside it said the 2 twice.
      const mark = el("span", "habit-tick-mark", "");
      if (isDone(h, today)) mark.appendChild(ico("check"));
      btn.appendChild(mark);
      btn.appendChild(el("span", "habit-tick-label",
        h.target > 1 ? n + " of " + h.target : (isDone(h, today) ? "Done" : "Mark done")));
      btn.style.setProperty("--habit-colour", h.color);
      btn.onclick = () => tick(h.id, today);
      actions.appendChild(btn);
    } else {
      actions.appendChild(el("p", "habit-notdue", "Not due today"));
    }

    // The best run and rate share Insights' line: both are the longer view.
    const foot = el("div", "habit-foot");
    foot.appendChild(insights(h, today));
    if (right) foot.appendChild(right);
    card.appendChild(foot);
    return card;
  }

  // Insights (0.274.0): a fold under the grid that says what the grid
  // shows. Folded by default, and remembered per habit while the page is
  // open, since a tick re-renders the card.
  const insightsOpen = new Set();
  function insights(h, today) {
    const box = el("details", "habit-insights");
    box.open = insightsOpen.has(h.id);
    box.ontoggle = () => { if (box.open) insightsOpen.add(h.id); else insightsOpen.delete(h.id); };
    const sum = el("summary", null);
    sum.appendChild(window.LifeLogIcons.labelled("chart-column", "Insights"));
    box.appendChild(sum);
    const life = statsFor(h, h.startedAt || today, today);
    if (!life.due) {
      box.appendChild(el("p", "hint", "Nothing to say yet — it starts counting from " + prettyDate(h.startedAt) + "."));
      return box;
    }
    const facts = el("div", "habit-facts");
    const fact = (big, small) => {
      const f = el("div", "habit-fact");
      f.appendChild(el("span", "habit-fact-big", big));
      f.appendChild(el("span", "habit-fact-small", small));
      facts.appendChild(f);
    };
    const period = periodOf(h);
    fact(Math.round(life.rate * 100) + "%", life.done + " of " + life.due + " " + periodWord(period, life.due) + " since " + prettyDate(h.startedAt));
    const best = bestRunOf(h, today);
    if (best.days) fact(best.days + " " + periodWord(period, best.days), "longest run, " + dayRangeLabel(best.from, best.to));
    if (isMinutes(h)) {
      const total = amountBetween(h, h.startedAt || today, today);
      if (total) fact(minutesLabel(total), "in all since " + prettyDate(h.startedAt));
    }
    const days = weekdayRates(h, today).filter((d) => d.due);
    if (days.length > 1) {
      const top = days.slice().sort((a, b) => b.rate - a.rate || b.due - a.due);
      const hi = top[0], lo = top[top.length - 1];
      fact(hi.label, "best day, " + Math.round(hi.rate * 100) + "%");
      if (lo.rate < hi.rate) fact(lo.label, "weakest day, " + Math.round(lo.rate * 100) + "%");
    }
    box.appendChild(facts);
    const months = monthRates(h, today).filter((m) => m.due);
    if (months.length > 1) {
      const bars = el("div", "habit-months");
      bars.setAttribute("role", "img");
      bars.setAttribute("aria-label", "Kept per month: " + months.map((m) => m.label + " " + Math.round(m.rate * 100) + "%").join(", "));
      for (const m of months) {
        const col = el("div", "habit-month");
        col.title = m.label + ": " + m.kept + " of " + m.due + " " + periodWord(period, m.due);
        const bar = el("div", "habit-month-bar");
        const fill = el("div", "habit-month-fill");
        fill.style.height = Math.round(m.rate * 100) + "%";
        fill.style.background = h.color;
        bar.appendChild(fill);
        col.appendChild(el("span", "habit-month-pct", Math.round(m.rate * 100) + "%"));
        col.appendChild(bar);
        col.appendChild(el("span", "habit-month-label", m.label));
        bars.appendChild(col);
      }
      box.appendChild(bars);
    }
    return box;
  }

  // A goal's button: how far along this period is, out of what. A count
  // goes up one a tap (and back to none once it's met); minutes open the
  // sheet that says how many.
  function goalButton(h, today) {
    const p = progressOf(h, today);
    const mins = isMinutes(h);
    const btn = el("button", "habit-tick habit-goal" + (p.met ? " is-done" : ""));
    btn.type = "button";
    btn.dataset.id = h.id;
    // One line of one size, like the daily "2 of 3": a big count beside
    // smaller words sat off-centre.
    const done = mins ? minutesShort(p.done) : String(p.done);
    const of = " of " + (mins ? minutesShort(p.target) : p.target);
    // No "this week": the line under the name already says "3 hours a week".
    btn.appendChild(el("span", "habit-tick-label", done + of));
    btn.title = mins ? "Set today's time" : p.met ? "Met — tap to take back today's" : "Tap to add one today";
    btn.style.setProperty("--habit-colour", h.color);
    btn.onclick = () => (mins ? openAmountSheet(h.id, today) : tickPeriod(h.id, today));
    return btn;
  }

  // The quick adds beside a timed habit's goal: the sizes a sitting comes
  // in. Short labels so the goal and all three fit one row on a phone.
  function stepButtons(h, today) {
    const row = el("div", "habit-steps");
    for (const [n, label, full] of [[15, "+15m", "Add 15 minutes"], [30, "+30m", "Add 30 minutes"], [60, "+1h", "Add an hour"]]) {
      const b = el("button", "btn", label);
      b.type = "button";
      b.title = full;
      b.setAttribute("aria-label", full);
      b.onclick = () => addMinutes(h.id, today, n);
      row.appendChild(b);
    }
    return row;
  }

  // An avoided habit's button: kept (so far) until you say otherwise.
  function slipButton(h, today) {
    const n = markOf(h, today), limit = limitOf(h), kept = isDone(h, today);
    const btn = el("button", "habit-tick habit-slip" + (kept ? " is-done" : " is-slip"));
    btn.type = "button";
    btn.dataset.id = h.id;
    const mark = el("span", "habit-tick-mark", kept && limit ? n + "/" + limit : "");
    if (!kept) mark.appendChild(ico("x")); else if (!limit) mark.appendChild(ico("check"));
    btn.appendChild(mark);
    // The mark already carries the count, so the label doesn't repeat it.
    btn.appendChild(el("span", "habit-tick-label", kept ? "Kept" : "Slipped"));
    btn.title = kept ? (limit ? n + " of " + limit + " slips today — tap to log one" : "Tap to log a slip") : "Tap to undo";
    btn.style.setProperty("--habit-colour", h.color);
    btn.onclick = () => tick(h.id, today);
    return btn;
  }

  // Which twelve weeks a card is showing, by habit id. Module-level rather
  // than per-render so a tick — which re-renders the whole view — doesn't
  // throw you back to this week in the middle of filling in last spring.
  const gridOffset = new Map();

  // The first day of the week that opens the window `off` weeks back from
  // today, so every column is a whole week and the rows line up with the
  // weekday labels.
  function windowStart(today, off) {
    const end = addDaysStr(today, -off * 7);
    return Dates().startOfWeek(addDaysStr(end, -(GRID_WEEKS - 1) * 7));
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
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthOf = (s) => MONTHS[+s.slice(5, 7) - 1];
  const prettyDate = (s) => isDateStr(s) ? Dates().day(s) : "";
  // "3–16 Mar 2026", "28 Feb – 3 Mar 2026", "30 Dec 2025 – 2 Jan 2026", or
  // the same in the format Settings → Dates picked.
  const dayRangeLabel = (a, b) => Dates().range(a, b);
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
    const order = Dates().weekOrder();
    const rows = !c || c === "daily" ? order : order.filter((d) => c.days.includes(d));
    // No met-week bar on weekly goals (removed after 0.303.1): over the grid or
    // under it, a 4px row read as a row of cells cut off, and it made those
    // cards taller than their neighbours. The streak and Insights say it.
    for (const row of rows) {
      const line = el("div", "habit-grid-row");
      // Every row named. Until 0.235.0 a full week labelled only Mon, Wed
      // and Fri, the GitHub way, which read as a habit due on those days.
      const lbl = el("span", "habit-grid-day", DAY_LABELS[row].slice(0, 1));
      line.appendChild(lbl);
      for (let col = 0; col < GRID_WEEKS; col++) {
        const date = addDaysStr(start, col * 7 + Dates().weekPos(row));
        const cell = el("button", "habit-cell");
        cell.type = "button";
        cell.dataset.date = date;
        if (date === today) { cell.classList.add("is-today"); cell.setAttribute("aria-current", "date"); }
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
          if (h.avoid) {
            // A kept day you logged nothing on is an outline in the habit's
            // colour (filled, a new habit was a solid wall of "kept" before
            // you'd done anything); a slip under the limit fills lightly,
            // and one over it is the red that stands out.
            if (done) {
              cell.classList.add("is-done");
              if (n) cell.style.background = h.color + "66";
              else { cell.classList.add("is-kept"); cell.style.boxShadow = `inset 0 0 0 2px ${h.color}`; }
            } else cell.classList.add("is-slip");
            cell.title = date + (done ? (n ? ` — ${n} of at most ${limitOf(h)}` : " — kept") : " — slipped");
          } else if (isPeriodic(h)) {
            // A day of a weekly goal isn't missed for having nothing in it,
            // so a blank one stays blank; a day with something is filled.
            if (n) { cell.classList.add("is-done"); cell.style.background = h.color; }
            cell.title = date + (n ? " — " + (isMinutes(h) ? minutesLabel(n) : n === 1 ? "done" : n + " times") : "");
          } else if (isMinutes(h)) {
            if (done) { cell.classList.add("is-done"); cell.style.background = h.color; }
            else if (n) { cell.classList.add("is-part"); cell.style.background = h.color + "66"; }
            cell.title = date + (n ? " — " + minutesLabel(n) + " of " + minutesLabel(h.target) : " — missed");
          } else {
            if (done) { cell.classList.add("is-done"); cell.style.background = h.color; }
            else if (n) { cell.classList.add("is-part"); cell.style.background = h.color + "66"; }
            cell.title = date + (done ? " — done" : n ? ` — ${n} of ${h.target}` : " — missed");
          }
          if (anchor && anchor.id === h.id && anchor.date === date) cell.classList.add("is-anchor");
          cell.onclick = isMinutes(h) ? () => openAmountSheet(h.id, date) : (ev) => onCellPress(h.id, date, ev);
        }
        line.appendChild(cell);
      }
      wrap.appendChild(line);
    }
    if (anchor && anchor.id === h.id) {
      wrap.appendChild(el("p", "habit-range-hint",
        "Tap the day this run ends on — or the same day again to stop."));
    }
    // Filling a run with minutes would be guessing how long each day was.
    if (!isMinutes(h)) longPressCells(wrap, h.id);
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
    // On a habit you avoid, a run is filled with slips: its days are kept
    // already, so that's the only thing a run could need saying.
    const hit = (d) => (h.avoid ? !isDone(h, d) : isDone(h, d));
    const clearing = days.every(hit);
    const marks = { ...(h.marks || {}) };
    // Counted, not assumed: dragging over a run that is mostly done and being
    // told "filled in 8 days" when one day changed is the app describing your
    // gesture back to you instead of what it did.
    let n = 0;
    for (const d of days) {
      const to = clearing ? 0 : capOf(h);
      if ((marks[d] || 0) === to) continue;
      if (to) marks[d] = to; else delete marks[d];
      n++;
    }
    if (!n) { repaintGrid(id); return; }
    if (Object.keys(marks).length) h.marks = marks; else delete h.marks;
    render();
    await persist();
    toast((clearing ? "Cleared " : h.avoid ? "Marked as slipped: " : "Filled in ") + n + (n === 1 ? " day" : " days"), false,
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

  async function setMark(id, dateStr, n) {
    const h = (state.data.habits || []).find((x) => x.id === id);
    if (!h) return null;
    const was = markOf(h, dateStr);
    const marks = { ...(h.marks || {}) };
    if (n > 0) marks[dateStr] = n; else delete marks[dateStr];
    if (Object.keys(marks).length) h.marks = marks; else delete h.marks;
    render();
    await persist();
    return was;
  }

  // A reminder's Done (the Windows toast): today's mark brought up to what
  // the habit still needs, as Android's Done does. False when there's
  // nothing to do: gone, avoided, or already kept.
  async function finishToday(id) {
    const h = (state.data.habits || []).find((x) => x.id === id);
    if (!h || h.avoid || h.archivedAt) return false;
    const today = todayStr();
    const p = progressOf(h, today);
    if (p.met) return false;
    await setMark(id, today, markOf(h, today) + p.left);
    return true;
  }

  async function tickPeriod(id, dateStr) {
    const h = (state.data.habits || []).find((x) => x.id === id);
    if (h) await setMark(id, dateStr, nextPeriodMark(h, dateStr));
  }

  async function addMinutes(id, dateStr, n) {
    const h = (state.data.habits || []).find((x) => x.id === id);
    if (!h) return;
    const next = Math.min(1440, markOf(h, dateStr) + n);
    const was = await setMark(id, dateStr, next);
    const p = progressOf(h, dateStr);
    toast("Added " + minutesLabel(n) + " — " + (p.met ? "done" : minutesLabel(p.left) + " to go") + (p.period === "day" ? "" : " " + periodName(p.period, dateStr, true)),
      false, { label: "Undo", onClick: () => setMark(id, dateStr, was) });
  }

  // ---------- the time sheet ----------
  let amountFor = null; // { id, date }

  function openAmountSheet(id, dateStr) {
    const h = (state.data.habits || []).find((x) => x.id === id);
    if (!h) return;
    amountFor = { id, date: dateStr };
    $("#habitAmountTitle").textContent = h.name;
    const p = progressOf(h, dateStr);
    $("#habitAmountWhen").textContent = (dateStr === todayStr() ? "Today" : prettyDate(dateStr)) + " · goal " + goalLabel(h).toLowerCase()
      + (p.period === "day" ? "" : " · " + minutesLabel(p.done) + " so far " + periodName(p.period, dateStr, true));
    $("#habitAmountInput").value = markOf(h, dateStr) || "";
    $("#habitAmountClear").hidden = !markOf(h, dateStr);
    $("#habitAmountModal").hidden = false;
  }
  function closeAmountModal() { $("#habitAmountModal").hidden = true; amountFor = null; }

  async function saveAmount(ev) {
    if (ev) ev.preventDefault();
    if (!amountFor) return;
    const { id, date } = amountFor;
    const n = Math.max(0, Math.min(1440, Math.round(+$("#habitAmountInput").value) || 0));
    closeAmountModal();
    const was = await setMark(id, date, n);
    if (was !== n) toast(n ? "Saved " + minutesLabel(n) : "Cleared", false, { label: "Undo", onClick: () => setMark(id, date, was) });
  }

  // ---------- the modal ----------
  let editingId = null;
  let startWas = null; // the start date the modal opened with

  function openHabitModal(habit) {
    editingId = habit ? habit.id : null;
    $("#habitModalTitle").textContent = habit ? "Edit habit" : "Add habit";
    $("#habitName").value = habit ? habit.name : "";
    $("#habitKind").value = habit && habit.avoid ? "avoid" : "do";
    // Minutes that make whole hours show as hours: "1 hour a day" is what
    // was meant, and 60 in a box reads as a typo.
    const hours = habit && isMinutes(habit) && habit.target >= 60 && habit.target % 60 === 0;
    $("#habitUnit").value = habit && isMinutes(habit) ? (hours ? "hours" : "min") : "times";
    $("#habitTarget").value = habit ? (habit.avoid ? limitOf(habit) : hours ? habit.target / 60 : habit.target) : 1;
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
    // One "how often" (0.300.1): every day, certain days, or a goal over a
    // week, month or year. 0.300.0 had a second select for the period
    // beside this one, and two questions about how often read as one too many.
    $("#habitCadence").value = habit && isPeriodic(habit) ? habit.period : days ? "days" : "daily";
    // The chips run in the week's own order, and a new habit starts on the
    // working days of that week.
    const D = Dates();
    const wrap = $("#habitDays");
    const boxes = [...wrap.querySelectorAll("input")];
    for (const d of D.weekOrder()) { const b = boxes.find((x) => +x.value === d); if (b) wrap.appendChild(b.closest("label")); }
    boxes.forEach((b) => { b.checked = (days || D.workDays()).includes(+b.value); });
    // After the cadence, not before: the backfill count is counted off the
    // form, and the form still held the last habit's days until now.
    applyStartUI();
    $("#deleteHabitBtn").hidden = !habit;
    $("#archiveHabitBtn").hidden = !habit;
    if (habit && habit.archivedAt) window.LifeLogIcons.setLabel($("#archiveHabitBtn"), "undo-2", "Un-archive"); else window.LifeLogIcons.setLabel($("#archiveHabitBtn"), "archive", "Archive");
    applyKindUI();
    applyGoalUI();
    // Reminders live on the phone, not in the habit (see reminders.js).
    const R = window.LifeLogReminders;
    const remind = !!(R && R.available());
    $("#habitRemindLabel").hidden = !remind || $("#habitKind").value === "avoid";
    $("#habitRemind").value = remind && habit ? R.timeOf(habit.id) : "";
    $("#habitModal").hidden = false;
  }
  function closeHabitModal() { $("#habitModal").hidden = true; editingId = null; }

  const periodFromForm = () => (["week", "month", "year"].includes($("#habitCadence").value) ? $("#habitCadence").value : "day");

  function applyCadenceUI() {
    // Something you avoid stays a daily limit, so it has no goal periods.
    const avoid = $("#habitKind").value === "avoid";
    for (const o of document.querySelectorAll("#habitCadence option[data-goal]")) o.hidden = o.disabled = avoid;
    if (avoid && periodFromForm() !== "day") $("#habitCadence").value = "daily";
    $("#habitDaysLabel").hidden = $("#habitCadence").value !== "days";
  }

  // The goal reads as a sentence, "3 times a week", and the hint under it
  // says what that means in the one case it isn't obvious.
  function applyGoalUI() {
    const avoid = $("#habitKind").value === "avoid";
    $("#habitUnitLabel").hidden = avoid;
    applyCadenceUI();
    const period = periodFromForm();
    const n = targetFromForm();
    const unit = $("#habitUnit").value;
    const amount = unit === "times" ? (n === 1 ? "Once" : n === 2 ? "Twice" : n + " times") : minutesLabel(n);
    const h = editingId ? (state.data.habits || []).find((x) => x.id === editingId) : null;
    const unitChanged = h && !avoid && Object.keys(h.marks || {}).length && isMinutes(h) !== (unit !== "times");
    const bits = [];
    if (!avoid && period !== "day") {
      bits.push(amount + " a " + period + ", on any days." + (period === "week" ? " A week runs " + weekSpan() + ", like the grid's columns." : ""));
    }
    if (unitChanged) bits.push("Days already recorded keep their numbers, so a tick becomes " + (unit === "times" ? "a count" : "a minute") + " — fix any in the grid that matter.");
    $("#habitGoalHint").textContent = bits.join(" ");
    $("#habitGoalHint").hidden = !bits.length;
  }

  // Minutes, whichever unit the box is in.
  function targetFromForm() {
    const n = Math.max(1, Math.round(+$("#habitTarget").value) || 1);
    return $("#habitUnit").value === "hours" ? n * 60 : n;
  }

  // Do or avoid: the number beside it is how many times a day, or how many
  // slips a day still counts as kept.
  // `switched`: the kind was just changed, so the number's default for the
  // other kind (1 a day, none at all) is swapped in.
  function applyKindUI(switched) {
    const avoid = $("#habitKind").value === "avoid";
    $("#habitTargetText").textContent = avoid ? "At most a day" : "Goal";
    const t = $("#habitTarget");
    t.min = avoid ? "0" : "1";
    if (switched) t.value = avoid ? "0" : "1";
    $("#habitName").placeholder = avoid ? "e.g. No coffee" : "e.g. Read before bed";
    const R = window.LifeLogReminders;
    $("#habitRemindLabel").hidden = !(R && R.available()) || avoid;
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

    // A habit you avoid needs no filling in: a day with nothing recorded is
    // already a kept one.
    const avoiding = $("#habitKind").value === "avoid";
    // A weekly goal's past can't be filled in by rule: which three days?
    const periodic = !avoiding && periodFromForm() !== "day";
    const days = !avoiding && !periodic && isDateStr(v) && v < was ? backfillDays(h, v, addDaysStr(was, -1)) : [];
    const target = targetFromForm();
    const mins = $("#habitUnit").value !== "times";
    $("#habitFillText").textContent = days.length
      ? "Mark those " + days.length + (days.length === 1 ? " day" : " days") + " as done" +
        (mins ? " (" + minutesLabel(target) + " each)" : target > 1 ? " (" + target + "× each)" : "")
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

  const checkedDays = () => [...document.querySelectorAll("#habitDays input")]
    .filter((b) => b.checked).map((b) => +b.value).sort((a, b) => a - b);
  // "Sunday to Saturday", "Saturday to Friday".
  function weekSpan() {
    const D = Dates(), o = D.weekOrder();
    return D.WEEKDAY_NAMES[o[0]] + " to " + D.WEEKDAY_NAMES[o[6]];
  }

  function cadenceFromForm() {
    if ($("#habitCadence").value !== "days") return "daily";
    const days = checkedDays();
    return days.length && days.length < 7 ? { days } : "daily";
  }

  async function saveHabitFromForm(ev) {
    ev.preventDefault();
    const name = $("#habitName").value.trim();
    if (!name) return;
    const days = checkedDays();
    if ($("#habitCadence").value === "days" && !days.length) {
      toast("Pick at least one day, or switch back to every day", true);
      return;
    }
    const startedAt = isDateStr($("#habitStart").value) ? $("#habitStart").value : todayStr();
    if (startedAt > todayStr()) { toast("A habit can't start in the future", true); return; }
    const avoid = $("#habitKind").value === "avoid";
    const period = !avoid && periodFromForm() !== "day" ? periodFromForm() : undefined;
    const shape = {
      name,
      color: $("#habitColor").value,
      target: avoid ? 1 : Math.min(MAX_TARGET, targetFromForm()),
      avoid: avoid || undefined,
      limit: avoid ? Math.max(0, Math.round(+$("#habitTarget").value) || 0) : undefined,
      cadence: !period && $("#habitCadence").value === "days" ? { days } : "daily",
      period,
      unit: !avoid && $("#habitUnit").value !== "times" ? "min" : undefined,
      startedAt,
    };
    const fill = !$("#habitFillLabel").hidden && $("#habitFill").checked;
    let filled = 0, undo = null;
    if (editingId) {
      const h = (state.data.habits || []).find((x) => x.id === editingId);
      if (h) {
        const wasFrom = h.startedAt;
        undo = snapshot(h);
        // Do ↔ Avoid: the history is carried across, not reread (see
        // convertMarks), before the habit takes its new shape.
        const switched = !!h.avoid !== avoid;
        const carried = switched ? convertMarks(h, avoid, { target: shape.target, limit: shape.limit || 0 }) : null;
        Object.assign(h, shape);
        if (carried) { if (Object.keys(carried).length) h.marks = carried; else delete h.marks; }
        if (!avoid) { delete h.avoid; delete h.limit; }
        if (!shape.period) delete h.period;
        if (!shape.unit) delete h.unit;
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
    const savedId = editingId || (state.data.habits[state.data.habits.length - 1] || {}).id;
    const R = window.LifeLogReminders;
    if (R && R.available() && savedId) R.setTime(savedId, $("#habitRemind").value);
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
  // From the sheet, or a habit's right-click menu with its id.
  async function archiveHabit(id) {
    const h = (state.data.habits || []).find((x) => x.id === id);
    if (!h) return;
    if (h.archivedAt) delete h.archivedAt; else h.archivedAt = todayStr();
    const was = !!h.archivedAt;
    closeHabitModal();
    render();
    await persist();
    toast(was ? "Archived — its history stays" : "Back in the list");
  }

  async function deleteHabit(id) {
    const h = (state.data.habits || []).find((x) => x.id === id);
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
    $("#deleteHabitBtn").onclick = () => deleteHabit(editingId);
    $("#archiveHabitBtn").onclick = () => archiveHabit(editingId);
    $("#habitCadence").onchange = () => { applyGoalUI(); applyStartUI(); };
    $("#habitKind").onchange = () => { applyKindUI(true); applyGoalUI(); applyStartUI(); };
    $("#habitUnit").onchange = () => { applyGoalUI(); applyStartUI(); };
    $("#habitStart").oninput = applyStartUI;
    $("#habitTarget").oninput = () => { applyGoalUI(); applyStartUI(); };
    $("#habitAmountForm").onsubmit = saveAmount;
    $("#habitAmountCancel").onclick = closeAmountModal;
    $("#habitAmountClear").onclick = () => { $("#habitAmountInput").value = 0; saveAmount(); };
    $("#habitAmountSteps").onclick = (ev) => {
      const b = ev.target.closest && ev.target.closest("[data-add]");
      if (!b) return;
      $("#habitAmountInput").value = Math.min(1440, (Math.round(+$("#habitAmountInput").value) || 0) + +b.dataset.add);
    };
    $("#habitDays").oninput = applyStartUI;
  }

  window.LifeLogHabits = {
    init, wire, renderHabits, openHabitModal, closeHabitModal, closeAmountModal, isHabitsMode, finishToday,
    sanitizeHabit,
    getFilteredHabits,
    // pure, and the point of the feature — see test/habits.test.js
    isDue, cadenceLabel, markOf, isDone, nextMark, capOf, limitOf, convertMarks,
    periodOf, isPeriodic, isMinutes, periodRange, amountBetween, progressOf, goalLabel,
    minutesLabel, minutesShort, nextPeriodMark, periodName, periodWord, leftToDo,
    streakOf, bestStreakOf, runBefore, statsFor, blankDaysBetween,
    weekdayRates, monthRates, bestRunOf,
    dueBetween, keptBetween, dueDaysBetween, orphanedMarks, firstMarkOf,
    windowStart, maxOffset, rangeLabel, dayRangeLabel, prettyDate, GRID_WEEKS,
    localDateStr, todayStr, addDaysStr, byOrder,
    DAY_LABELS,
  };
})();
