// LifeLog — Health Connect ticks habits (Android only).
//
// Android's health store (Samsung Health, Google Fit, Strava and the rest
// write into it) is read on the phone: steps, workouts and sleep. A habit
// links to one of them with a bar ("Walk" = 8,000 steps, "Gym" = any
// strength workout, "Sleep" = 7 hours) and ticks itself. Only the ticks
// sync; the health data stays on the phone. The web and Windows apps can
// make and change links and see the ticks, but never read anything.
//
// The link is on the habit (`health`, cleaned by habits.js), so it syncs.
// What Health Connect put into each day is kept apart, per habit, in
// settings.healthConnect.filled, the way Waypage keeps its minutes, so
// unlinking takes out only Health Connect's part. A gym session ticked by
// hand and then also seen by the watch counts once (setDay).
//
// Reads: on open and on coming back (at most every 15 minutes), Read now,
// and, with Read in the background on, in the background refresh's run with
// no screen (headless.js, HeadlessRefresh.java). The last 7 days each time;
// 30 for a habit just linked, which is as far back as Health Connect lets an
// app read without the history permission.
//
// Everything above "the app side" is pure, for test/health.test.js and the
// bridge.
(function () {
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  const Connections = () => (typeof window === "object" && window.LifeLogConnections) || require("./connections.js");
  const { localDay, addDays, today: todayStr } = (typeof window === "object" && window.LifeLogDates) || require("./dates.js");
  const Habits = () => { if (!window.LifeLogHabits) require("./habits.js"); return window.LifeLogHabits; };

  // ---------- the model ----------
  const SOURCES = ["steps", "workout", "sleep"];
  // Health Connect's ExerciseSessionRecord types for each kind you can pick.
  const KIND_TYPES = {
    strength: [70, 81, 13], // strength training, weightlifting, calisthenics
    running: [56, 57], // running, treadmill
    walking: [79, 37], // walking, hiking
    cycling: [8, 9], // biking, stationary
    swimming: [73, 74], // open water, pool
    yoga: [83, 48, 71], // yoga, pilates, stretching
    hiit: [36, 10], // HIIT, boot camp
  };
  const KIND_NAMES = {
    any: i18n.t("Any workout"), strength: i18n.t("Strength training"), running: i18n.t("Running"), walking: i18n.t("Walking"),
    cycling: i18n.t("Cycling"), swimming: i18n.t("Swimming"), yoga: i18n.t("Yoga and stretching"), hiit: i18n.t("HIIT"),
  };
  const KIND_SHORT = {
    any: i18n.t("Workout"), strength: i18n.t("Strength"), running: i18n.t("Running"), walking: i18n.t("Walking"),
    cycling: i18n.t("Cycling"), swimming: i18n.t("Swimming"), yoga: i18n.t("Yoga"), hiit: i18n.t("HIIT"),
  };
  const ICONS = { steps: "footprints", workout: "dumbbell", sleep: "moon" };
  const WINDOW = 7;
  const FIRST_WINDOW = 30;
  const DAY_MS = 86400000;
  const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dayOf = (ms) => localDay(new Date(ms));

  // settings.healthConnect: { filled: { habitId: { date: [added, read] } } }:
  // what Health Connect added to that day's mark, and the count it read.
  function cleanConfig(c) {
    const filled = {};
    const src = c && typeof c === "object" && c.filled && typeof c.filled === "object" ? c.filled : {};
    for (const [hid, days] of Object.entries(src)) {
      if (!days || typeof days !== "object") continue;
      const out = {};
      for (const [d, v] of Object.entries(days)) {
        const [add, got] = (Array.isArray(v) ? v : [v, v]).map((x) => Math.max(0, Math.round(+x) || 0));
        if (isDateStr(d) && (add || got)) out[d] = [Math.min(add, got), got];
      }
      if (Object.keys(out).length) filled[hid] = out;
    }
    return { ...(c && typeof c === "object" ? c : {}), filled };
  }

  // Overlapping sessions are one: a run logged by the watch's own app and by
  // Strava, or a night written by two sleep trackers, count once.
  function merged(list) {
    const xs = (Array.isArray(list) ? list : [])
      .map((x) => ({ start: +x.start, end: +x.end, types: [+x.type || 0] }))
      .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
      .sort((a, b) => a.start - b.start);
    const out = [];
    for (const x of xs) {
      const last = out[out.length - 1];
      if (last && x.start < last.end) {
        last.end = Math.max(last.end, x.end);
        for (const t of x.types) if (!last.types.includes(t)) last.types.push(t);
      } else out.push(x);
    }
    return out;
  }

  // What the plugin read, by local day: { date: { steps, sleepMin, workouts: [{ types, min }] } }.
  // A workout counts on the day it started; a night on the morning it ended.
  function daysFrom(raw) {
    const days = {};
    const day = (d) => (days[d] = days[d] || { steps: 0, sleepMin: 0, workouts: [] });
    for (const s of (raw && raw.steps) || []) {
      if (isDateStr(s.date) && +s.count > 0) day(s.date).steps += Math.round(+s.count);
    }
    for (const w of merged(raw && raw.workouts)) {
      day(dayOf(w.start)).workouts.push({ types: w.types, min: Math.round((w.end - w.start) / 60000) });
    }
    for (const s of merged(raw && raw.sleep)) day(dayOf(s.end)).sleepMin += Math.round((s.end - s.start) / 60000);
    return days;
  }

  const kindMatches = (kind, types) => kind === "any" || !KIND_TYPES[kind] || types.some((t) => KIND_TYPES[kind].includes(t));

  // What a day is worth to this habit: a tick (1) or not for steps and a
  // night's sleep; one per session for workouts, or their minutes on a
  // timed habit, as a night's minutes are.
  function amountFor(habit, day) {
    const link = habit && habit.health;
    if (!link || !day) return 0;
    const minutes = habit.unit === "min";
    if (link.from === "steps") return !minutes && day.steps >= link.min ? 1 : 0;
    if (link.from === "sleep") return minutes ? day.sleepMin : day.sleepMin >= link.hours * 60 ? 1 : 0;
    if (link.from === "workout") {
      const ws = day.workouts.filter((w) => kindMatches(link.kind, w.types));
      return minutes ? ws.reduce((n, w) => n + w.min, 0) : ws.length;
    }
    return 0;
  }

  // Health Connect's part of one day, replaced. Returns whether it changed.
  // What it read that you had already ticked by hand counts once: the first
  // time a day is read, the hand ticks up to its count are taken as the same
  // sessions. A tick added by hand after that is one more, so it stays on
  // top. `filled[date]` is [what it added, what it read].
  function setDay(habit, filled, date, now) {
    habit.marks = habit.marks || {};
    const [added, got] = filled[date] || [0, 0];
    const mark = +habit.marks[date] || 0;
    const hand = Math.max(0, mark - added);
    const same = filled[date] ? Math.min(got - added, hand, now) : Math.min(hand, now);
    const mine = now - same;
    const next = hand + mine;
    if (next === mark && mine === added && now === got) return 0;
    if (next) habit.marks[date] = next; else delete habit.marks[date];
    if (mine || now) filled[date] = [mine, now]; else delete filled[date];
    return next !== mark ? 2 : 1;
  }

  // The days read, from `from` to `to`, into every linked habit. A day in
  // that range with nothing read takes Health Connect's part out (a workout
  // deleted there). Habits linked before and no longer: their part comes out
  // whole. Returns how many days' marks changed, and whether anything
  // (its own record included) did.
  function apply(data, cfg, days, from, to) {
    let n = 0, changed = false;
    const count = (r) => { if (r) changed = true; if (r === 2) n++; };
    const linked = new Set();
    for (const h of data.habits || []) {
      if (!h.health || h.avoid || h.archivedAt) continue;
      linked.add(h.id);
      const filled = cfg.filled[h.id] || {};
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (h.startedAt && d < h.startedAt) continue;
        count(setDay(h, filled, d, amountFor(h, days[d])));
      }
      // Past the window, a day where it added nothing has nothing to take
      // out later, so it isn't kept (the file syncs whole).
      for (const d of Object.keys(filled)) if (d < from && !filled[d][0]) { delete filled[d]; changed = true; }
      if (Object.keys(filled).length) cfg.filled[h.id] = filled; else delete cfg.filled[h.id];
    }
    for (const hid of Object.keys(cfg.filled)) if (!linked.has(hid)) { n += takeOut(data, cfg, hid); changed = true; }
    return { days: n, changed };
  }

  // Health Connect's part of a habit, all of it, out.
  function takeOut(data, cfg, hid) {
    const filled = cfg.filled[hid];
    delete cfg.filled[hid];
    const h = (data.habits || []).find((x) => x.id === hid);
    if (!h || !filled) return 0;
    let n = 0;
    for (const d of Object.keys(filled)) if (setDay(h, filled, d, 0) === 2) n++;
    return n;
  }

  // Link, change or unlink (link null). A changed link starts over: its old
  // part comes out, and the next read fills the last 30 days its new way.
  function setLink(data, cfg, hid, link) {
    const h = (data.habits || []).find((x) => x.id === hid);
    if (!h) return false;
    const next = link ? Habits().cleanHealthLink(link) : null;
    if (JSON.stringify(next) === JSON.stringify(h.health || null)) return false;
    takeOut(data, cfg, hid);
    if (next) h.health = next; else delete h.health;
    return true;
  }

  // How far back a read goes: 30 days when a linked habit has nothing from
  // Health Connect yet, else a week.
  function windowFor(data, cfg, today) {
    const fresh = (data.habits || []).some((h) => h.health && !h.avoid && !h.archivedAt && !cfg.filled[h.id]);
    return addDays(today, -((fresh ? FIRST_WINDOW : WINDOW) - 1));
  }
  // Which of the three anything needs.
  function needed(data) {
    const want = new Set();
    for (const h of data.habits || []) if (h.health && !h.avoid && !h.archivedAt) want.add(h.health.from);
    return want;
  }

  // "8,000 steps a day", "Any strength workout", "7 hours a night".
  const num = (n) => Math.round(n).toLocaleString(i18n.lang);
  function linkLabel(link) {
    if (!link) return "";
    if (link.from === "steps") return i18n.t("{n} steps a day", { n: num(link.min) });
    if (link.from === "sleep") return i18n.t("{n} hours a night", { n: link.hours.toLocaleString(i18n.lang) });
    return link.kind === "any" ? i18n.t("Any workout") : i18n.t("Any {kind} workout", { kind: (KIND_SHORT[link.kind] || "").toLowerCase() });
  }

  // ---------- the app side ----------
  const LOCAL_KEY = "lifelog-health-v1";
  const PERMS = {
    steps: "android.permission.health.READ_STEPS",
    workout: "android.permission.health.READ_EXERCISE",
    sleep: "android.permission.health.READ_SLEEP",
    background: "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
  };
  const RECHECK_MS = 15 * 60 * 1000;
  let ctx = null;
  let $ = (s) => document.querySelector(s);
  let status = null; // { sdk, granted } from the plugin
  let reading = null;

  const plugin = () => (ctx && ctx.Platform && ctx.Platform.android && ctx.Platform.plugin("Health")) || null;
  const available = () => !!plugin();
  function local() {
    try { return { on: false, background: false, lastRead: 0, today: null, ...(JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}) }; } catch (e) { return { on: false, background: false, lastRead: 0, today: null }; }
  }
  function saveLocal(patch) {
    const next = { ...local(), ...patch };
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch (e) { /* this session only */ }
    return next;
  }
  const cfgNow = () => cleanConfig(ctx.state.data.settings.healthConnect);

  async function refreshStatus() {
    const P = plugin();
    if (!P) { status = null; return null; }
    try { status = await P.status(); } catch (e) { status = { sdk: "unavailable", granted: [] }; }
    if (!Array.isArray(status.granted)) status.granted = [];
    return status;
  }
  const granted = (perm) => !!(status && status.granted.includes(perm));

  // One read. `manual` is Read now: it says what happened.
  function read(opts = {}) {
    if (reading) return reading;
    reading = run(opts).finally(() => { reading = null; });
    return reading;
  }
  async function run({ manual, background } = {}) {
    const P = plugin();
    const me = local();
    if (!P || !me.on) return;
    if (!manual && !background && Date.now() - (me.lastRead || 0) < RECHECK_MS) return;
    const data = ctx.state.data;
    const want = needed(data);
    if (!want.size) {
      saveLocal({ lastRead: Date.now() });
      if (manual) toast(i18n.t("Link a habit first"), true);
      paint();
      return;
    }
    if (ctx.whenSynced) await ctx.whenSynced();
    const today = todayStr();
    let cfg = cfgNow();
    const from = windowFor(data, cfg, today);
    let raw;
    try {
      raw = await P.read({ from, to: today, steps: want.has("steps"), workouts: want.has("workout"), sleep: want.has("sleep") });
    } catch (e) {
      saveLocal({ error: (e && e.message) || "failed" });
      if (manual) toast(i18n.t("Couldn't read Health Connect: {error}", { error: (e && e.message) || e }), true);
      paint();
      return;
    }
    const days = daysFrom(raw);
    cfg = cfgNow();
    const { days: n, changed } = apply(ctx.state.data, cfg, days, from, today);
    saveLocal({ lastRead: Date.now(), error: "", today: { date: today, ...(days[today] || { steps: 0, sleepMin: 0, workouts: [] }) } });
    if (changed) {
      ctx.state.data.settings.healthConnect = cfg;
      ctx.afterDataChange();
      await ctx.persist();
    }
    if (!background) ctx.render();
    paint();
    if (manual) toast(n ? i18n.tn(n, "Health Connect: {n} day updated", "Health Connect: {n} days updated") : i18n.t("Health Connect: nothing new"));
  }
  const toast = (msg, err) => ctx && ctx.toast(msg, err);

  // The background refresh's run with no screen: a read, if it's allowed to.
  async function backgroundRead() {
    if (!available()) return;
    const me = local();
    if (!me.on || !me.background) return;
    await read({ background: true });
  }

  // Asks Android for what the links need (all three, so a link made later
  // doesn't have to ask again), and the background one when it's wanted.
  async function connect() {
    const P = plugin();
    if (!P) return;
    const st = await refreshStatus();
    if (!st || st.sdk === "missing" || st.sdk === "update") {
      try { await P.openSettings({ install: true }); } catch (e) { /* nothing to open */ }
      paint();
      return;
    }
    try {
      const r = await P.request({ background: local().background });
      status.granted = (r && r.granted) || status.granted;
    } catch (e) {
      toast(i18n.t("Couldn't ask Health Connect: {error}", { error: (e && e.message) || e }), true);
    }
    const any = [PERMS.steps, PERMS.workout, PERMS.sleep].some(granted);
    saveLocal({ on: any });
    paint();
    if (any) read({ manual: true });
    else toast(i18n.t("Health Connect didn't allow anything"), true);
  }

  async function setBackground(on) {
    saveLocal({ background: on });
    if (!on) { paint(); return; }
    const P = plugin();
    if (P) {
      try {
        const r = await P.request({ background: true });
        if (r && r.granted && status) status.granted = r.granted;
      } catch (e) { /* the row below says it isn't allowed */ }
    }
    // The run it reads in is the background refresh: on, and hourly at
    // most, so the ticks are never more than about an hour behind.
    const W = window.LifeLogWidgets;
    if (W && W.backgroundAvailable()) {
      const m = W.backgroundMinutes();
      if (!m || m > 60) await W.setBackgroundMinutes(60);
    }
    paint();
    if (!granted(PERMS.background)) toast(i18n.t("Health Connect hasn't allowed reading in the background"), true);
  }

  // ---------- the habit card's chip ----------
  function chip(habit, today) {
    const link = habit && !habit.avoid && habit.health;
    if (!link || !ctx) return null;
    const me = local();
    const day = me.on && me.today && me.today.date === today ? me.today : null;
    let text;
    if (link.from === "steps") text = day ? num(day.steps) + " / " + num(link.min) : i18n.t("{n} steps", { n: num(link.min) });
    else if (link.from === "sleep") text = day && day.sleepMin ? Habits().minutesShort(day.sleepMin) : i18n.t("{n} h", { n: link.hours.toLocaleString(i18n.lang) });
    else text = KIND_SHORT[link.kind] || KIND_SHORT.any;
    const met = !!day && amountFor(habit, day) > 0 && (link.from !== "steps" || day.steps >= link.min);
    const c = ctx.el("span", "habit-health" + (met ? " is-met" : ""));
    if (link.from === "steps" && day) {
      // "5,230 / 8,000" stays in that order in Hebrew too: a bare slash between
      // numbers is turned around in a right-to-left line.
      c.appendChild(window.LifeLogIcons.svg(ICONS[link.from]));
      const n = ctx.el("bdi", null, text);
      n.dir = "ltr";
      c.appendChild(n);
    } else c.appendChild(window.LifeLogIcons.labelled(ICONS[link.from], text));
    c.title = i18n.t("Ticks itself from Health Connect: {what}", { what: linkLabel(link) });
    return c;
  }

  // ---------- Settings › Connections › Health Connect ----------
  function agoText(ms) {
    if (!ms) return "";
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return i18n.t("read just now");
    if (min < 60) return i18n.t("read {n} min ago", { n: min });
    const h = Math.round(min / 60);
    return h < 48 ? i18n.t("read {n} h ago", { n: h }) : i18n.t("read {date}", { date: new Date(ms).toLocaleDateString(i18n.lang) });
  }
  function statusText() {
    if (!available()) return i18n.t("On your Android phone");
    const me = local();
    if (status && status.sdk === "missing") return i18n.t("Health Connect isn't installed");
    if (status && status.sdk === "update") return i18n.t("Health Connect needs an update");
    if (status && status.sdk === "unavailable") return i18n.t("Not available on this phone");
    if (!me.on) return i18n.t("Not connected");
    if (me.error) return i18n.t("Couldn't read: {error}", { error: me.error });
    return i18n.t("Connected") + (me.lastRead ? " · " + agoText(me.lastRead) : "");
  }
  // The line under its row in Connections.
  function rowStatus() {
    const n = ctx ? (ctx.state.data.habits || []).filter((h) => h.health && !h.avoid && !h.archivedAt).length : 0;
    if (!available()) return { text: n ? i18n.tn(n, "{n} habit linked · on your phone", "{n} habits linked · on your phone") : i18n.t("On your Android phone") };
    const me = local();
    if (!me.on) return { text: i18n.t("Not connected") };
    if (me.error) return { text: i18n.t("Couldn't read"), tone: "warn" };
    return { text: i18n.t("Steps, workouts, sleep") + (me.lastRead ? " · " + agoText(me.lastRead) : "") };
  }

  function linkedHabits() {
    return (ctx.state.data.habits || []).filter((h) => h.health && !h.avoid && !h.archivedAt).sort(Habits().byOrder);
  }

  function paint() {
    if (!ctx || !$("#healthGroup")) return;
    const el = ctx.el;
    const android = available();
    const me = local();
    $("#healthWebHint").hidden = android;
    $("#healthGroup").hidden = !android;
    $("#healthPermsGroup").hidden = !android || !me.on;
    $("#healthHints").hidden = !android;
    if (android) {
      $("#healthOn").checked = me.on;
      $("#healthStatus").textContent = statusText();
      $("#healthBackground").checked = !!me.background;
      $("#healthBackgroundRow").hidden = !me.on;
      $("#healthReadBtn").hidden = !me.on;
      const box = $("#healthPerms");
      box.replaceChildren();
      for (const [key, label] of [["steps", i18n.t("Steps")], ["workout", i18n.t("Workouts")], ["sleep", i18n.t("Sleep")], ["background", i18n.t("In the background")]]) {
        const row = el("div", "sitem");
        const ic = el("span", "health-perm-ic");
        ic.appendChild(window.LifeLogIcons.svg(ICONS[key] || "heart-pulse"));
        const t = el("span", "sitem-text");
        t.appendChild(el("span", "sitem-title", label));
        const ok = granted(PERMS[key]);
        const st = el("span", "health-perm" + (ok ? " is-ok" : ""), ok ? i18n.t("Allowed") : i18n.t("Not allowed"));
        row.append(ic, t, st);
        box.appendChild(row);
      }
    }
    const list = $("#healthLinked");
    list.replaceChildren();
    for (const h of linkedHabits()) {
      const row = el("button", "srow");
      row.type = "button";
      const ic = el("span", "srow-ic");
      const dot = el("span", "health-dot");
      dot.style.background = h.color;
      ic.appendChild(dot);
      const t = el("span", "srow-text");
      t.appendChild(el("span", "srow-title", h.name));
      const sub = el("span", "srow-status");
      sub.appendChild(window.LifeLogIcons.labelled(ICONS[h.health.from], linkLabel(h.health)));
      t.appendChild(sub);
      const chev = el("span", "srow-chev", "›");
      chev.setAttribute("aria-hidden", "true");
      row.append(ic, t, chev);
      row.onclick = () => openLink(h.id);
      list.appendChild(row);
    }
    const add = el("button", "sitem sitem-go");
    add.type = "button";
    add.appendChild(window.LifeLogIcons.labelled("plus", i18n.t("Link a habit")));
    add.onclick = () => openLink(null);
    list.appendChild(add);
  }

  async function renderSettings() {
    if (!ctx || !$("#healthGroup")) return;
    paint();
    if (available()) { await refreshStatus(); paint(); }
  }

  // ---------- the link sheet ----------
  let linkFor = null;
  function linkable(hid) {
    return (ctx.state.data.habits || []).filter((h) => !h.avoid && !h.archivedAt && (!h.health || h.id === hid)).sort(Habits().byOrder);
  }
  function openLink(hid) {
    const habits = linkable(hid);
    if (!habits.length) { toast(i18n.t("Add a habit to do first"), true); return; }
    linkFor = hid;
    const h = habits.find((x) => x.id === hid);
    $("#healthLinkTitle").textContent = h ? h.name : i18n.t("Link a habit");
    const sel = $("#healthLinkHabit");
    sel.replaceChildren(...habits.map((x) => new Option(x.name, x.id)));
    sel.value = h ? h.id : habits[0].id;
    const link = (h && h.health) || { from: "steps", min: 8000 };
    $("#healthLinkFrom").value = link.from;
    $("#healthLinkSteps").value = link.from === "steps" ? link.min : 8000;
    $("#healthLinkKind").value = link.from === "workout" ? link.kind : "any";
    $("#healthLinkHours").value = link.from === "sleep" ? link.hours : 7;
    $("#healthUnlinkBtn").hidden = !h;
    applyLinkUI();
    $("#healthLinkModal").hidden = false;
  }
  function closeLink() { if ($("#healthLinkModal")) $("#healthLinkModal").hidden = true; linkFor = null; }
  function handleEscape() {
    if (!$("#healthLinkModal") || $("#healthLinkModal").hidden) return false;
    closeLink();
    return true;
  }
  function applyLinkUI() {
    const h = (ctx.state.data.habits || []).find((x) => x.id === $("#healthLinkHabit").value);
    const minutes = !!h && h.unit === "min";
    // Steps make a tick; a timed habit counts minutes, so it takes the other two.
    const stepsOpt = $("#healthLinkFrom").querySelector('option[value="steps"]');
    stepsOpt.hidden = stepsOpt.disabled = minutes;
    if (minutes && $("#healthLinkFrom").value === "steps") $("#healthLinkFrom").value = "workout";
    const from = $("#healthLinkFrom").value;
    $("#healthLinkStepsLabel").hidden = from !== "steps";
    $("#healthLinkKindLabel").hidden = from !== "workout";
    $("#healthLinkHoursLabel").hidden = from !== "sleep" || minutes;
    const periodic = !!h && h.period && h.period !== "day";
    $("#healthLinkHint").textContent = [
      from === "workout" && !minutes ? i18n.t("Each workout counts as one{goal}.", { goal: periodic ? i18n.t(", toward the goal") : "" }) : "",
      from === "workout" && minutes ? i18n.t("Each workout adds its minutes.") : "",
      from === "sleep" ? (minutes ? i18n.t("A night adds its minutes, on the morning you wake up.") : i18n.t("A night counts on the morning you wake up.")) : "",
      i18n.t("A day you already ticked by hand isn't counted twice."),
    ].filter(Boolean).join(" ");
  }
  async function saveLink(link) {
    const hid = $("#healthLinkHabit").value;
    const cfg = cfgNow();
    // Moving a link to another habit unlinks the one it was on.
    if (linkFor && linkFor !== hid) setLink(ctx.state.data, cfg, linkFor, null);
    const changed = setLink(ctx.state.data, cfg, hid, link);
    closeLink();
    if (!changed && !(linkFor && linkFor !== hid)) return;
    ctx.state.data.settings.healthConnect = cfg;
    ctx.afterDataChange();
    await ctx.persist();
    ctx.render();
    paint();
    if (link) read({ manual: false, background: true });
  }

  function wire() {
    if (!$("#healthGroup")) return;
    $("#healthOn").onchange = async () => {
      if ($("#healthOn").checked) await connect();
      else { saveLocal({ on: false }); paint(); }
    };
    $("#healthBackground").onchange = () => setBackground($("#healthBackground").checked);
    $("#healthReadBtn").onclick = () => read({ manual: true });
    $("#healthChangeBtn").onclick = async () => {
      const P = plugin();
      if (P) { try { await P.openSettings({}); } catch (e) { toast(i18n.t("Couldn't open Health Connect"), true); } }
    };
    $("#healthLinkHabit").onchange = applyLinkUI;
    $("#healthLinkFrom").onchange = applyLinkUI;
    $("#healthLinkCancel").onclick = closeLink;
    $("#healthUnlinkBtn").onclick = () => saveLink(null);
    $("#healthLinkForm").onsubmit = (e) => {
      e.preventDefault();
      const from = $("#healthLinkFrom").value;
      saveLink(from === "steps" ? { from, min: +$("#healthLinkSteps").value }
        : from === "workout" ? { from, kind: $("#healthLinkKind").value }
        : { from: "sleep", hours: +$("#healthLinkHours").value });
    };
    $("#healthLinkModal").addEventListener("mousedown", (e) => { if (e.target === $("#healthLinkModal")) closeLink(); });
  }

  // ctx: { state, $, el, toast, persist, afterDataChange, render, Platform, whenSynced }
  function init(c) {
    ctx = c;
    if (c.$) $ = c.$;
  }
  function start() {
    if (!available()) return;
    refreshStatus().then(() => {
      // Health Connect taken away in its own settings: the switch says so.
      const me = local();
      if (me.on && status && ![PERMS.steps, PERMS.workout, PERMS.sleep].some(granted)) saveLocal({ on: false });
      read();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshStatus().then(() => { read(); paint(); });
    });
  }

  Connections().register("health", {
    status: () => rowStatus(),
    renderSettings: () => renderSettings(),
    onOpen: () => { start(); },
  });

  const api = {
    init, wire, start, read, backgroundRead, renderSettings, rowStatus, chip, handleEscape, openLink, available,
    // pure, for tests and the bridge
    SOURCES, KIND_TYPES, KIND_NAMES, ICONS, WINDOW, FIRST_WINDOW, PERMS,
    cleanConfig, merged, daysFrom, amountFor, apply, takeOut, setLink, windowFor, needed, linkLabel, dayOf, addDays,
  };
  if (typeof window !== "undefined") window.LifeLogHealth = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
