// LifeLog — habit reminders, in the Android app only (0.183.0).
//
// Dropped once (see NOTES.md) because a browser can't do them well; the app
// can. A reminder is a time per habit, set in the habit itself or all
// together in Settings, and kept on this phone rather than in the synced
// habit: a desktop has nothing to buzz, and two phones can want different
// times.
//
// Nothing is scheduled from here. The times ride out in the widgets'
// snapshot (widgets.js), and the native side (native/widgets, Reminders.java)
// keeps one alarm for the next one and decides when it goes off whether the
// habit is still undone — from the latest snapshot and the widget's own
// ticks, so something kept anywhere that has reached this phone doesn't buzz.
(function () {
  const KEY = "lifelog-habit-reminders-v1";
  let ctx = null;

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  };
  const write = (v) => {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* kept for this session only */ }
  };
  const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
  const plugin = () => (ctx && ctx.Platform.plugin("Widgets")) || null;

  const available = () => !!plugin();
  const isOn = () => read().on !== false;
  const timeOf = (id) => {
    const t = (read().times || {})[id];
    return isTime(t) ? t : "";
  };
  // What the snapshot carries: nothing while they're switched off, so the
  // phone schedules nothing, but the times are kept for switching back on.
  const remindAt = (id) => (isOn() ? timeOf(id) : "");

  function setTime(id, time) {
    const s = read();
    s.times = s.times || {};
    const had = !!Object.values(s.times).some(isTime);
    if (isTime(time)) s.times[id] = time; else delete s.times[id];
    write(s);
    ctx.changed();
    // Asked when the first one is set, not at launch: that's when the
    // question makes sense.
    if (isTime(time) && isOn() && !had) ensureAllowed();
    renderSettings();
  }

  function setOn(on) {
    const s = read();
    s.on = !!on;
    write(s);
    ctx.changed();
    if (on && Object.values(s.times || {}).some(isTime)) ensureAllowed();
    renderSettings();
  }

  async function state() {
    const W = plugin();
    if (!W) return "unavailable";
    try { return (await W.notificationState()).state; } catch (e) { return "unavailable"; }
  }

  async function ensureAllowed() {
    const W = plugin();
    if (!W) return false;
    let now = await state();
    if (now === "prompt") {
      try { now = (await W.askForNotifications()).state; } catch (e) { /* treated as not allowed */ }
    }
    if (now !== "granted") {
      ctx.toast("Notifications are off for LifeLog, so reminders can't show yet", true,
        { label: "Allow", onClick: () => W.openNotificationSettings() });
    }
    renderSettings();
    return now === "granted";
  }

  // The Settings section: the switch, whether Android will show them, and
  // every habit's time in one place.
  let rendering = 0;
  async function renderSettings() {
    if (!ctx || !available()) return;
    const { $, el, state: app } = ctx;
    const section = $("#remindersSection");
    if (!section) return;
    section.hidden = false;
    $("#remindersOn").checked = isOn();

    const list = $("#remindersList");
    list.textContent = "";
    const habits = (app.data.habits || []).filter((h) => !h.archivedAt)
      .slice().sort((a, b) => (a.order - b.order) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    if (!habits.length) list.appendChild(el("p", "hint", "No habits yet — reminders are set per habit."));
    for (const h of habits) {
      const row = el("label", "reminder-row");
      const dot = el("span", "dot");
      dot.style.background = h.color;
      row.appendChild(dot);
      row.appendChild(el("span", "reminder-name", h.name));
      const input = el("input");
      input.type = "time";
      input.value = timeOf(h.id);
      input.disabled = !isOn();
      input.onchange = () => setTime(h.id, input.value);
      row.appendChild(input);
      list.appendChild(row);
    }

    const run = ++rendering;
    const now = await state();
    if (run !== rendering) return;
    const line = $("#remindersState");
    const fix = $("#remindersAllowBtn");
    const anySet = habits.some((h) => timeOf(h.id));
    line.hidden = fix.hidden = !(isOn() && anySet && now !== "granted");
    line.textContent = now === "denied"
      ? "Android is blocking LifeLog's notifications, so no reminder will show."
      : "LifeLog needs your permission to show notifications before any reminder can.";
    fix.textContent = now === "denied" ? "Open Android's settings" : "Allow notifications";
    fix.onclick = () => (now === "denied" ? plugin().openNotificationSettings() : ensureAllowed());
  }

  // ctx: { state, $, el, Platform, toast, changed }
  function start(c) {
    ctx = c;
    if (!available()) return;
    ctx.$("#remindersOn").onchange = (e) => setOn(e.target.checked);
    renderSettings();
  }

  window.LifeLogReminders = { start, available, isOn, timeOf, remindAt, setTime, renderSettings, isTime, KEY };
})();
