// LifeLog — habit reminders, in the Android app only (0.183.0).
//
// Dropped once (see NOTES.md) because a browser can't do them well; the app
// can. A reminder is a time per habit, set on its card in the Habits view
// or in its edit form, and kept on this phone rather than in the synced
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
    ctx.render();
  }

  function setOn(on) {
    const s = read();
    s.on = !!on;
    write(s);
    ctx.changed();
    if (on && Object.values(s.times || {}).some(isTime)) ensureAllowed();
    ctx.render();
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
      ctx.toast("Notifications are off for LifeLog, so reminders can't ring yet", true,
        { label: "Allow", onClick: () => W.openNotificationSettings() });
    }
    ctx.render();
    return now === "granted";
  }

  // ---------- in the Habits view (0.184.0 — they started in Settings) ----------

  // On each habit's card: its time, tapped to set or change it. The time
  // input sits invisibly over the chip, so the tap opens Android's own time
  // picker; the ✕ beside a set time clears it.
  function chip(habit) {
    if (!available()) return null;
    const { el } = ctx;
    const t = timeOf(habit.id);
    const wrap = el("span", "habit-remind" + (t ? " is-set" : "") + (t && !isOn() ? " is-paused" : ""));
    const face = el("label", "habit-remind-face");
    face.title = t ? "Reminder at " + t + " — tap to change" : "Remind me about this habit";
    face.appendChild(el("span", null, t ? (isOn() ? "🔔 " : "🔕 ") + t : "🔔"));
    const input = el("input", "habit-remind-input");
    input.type = "time";
    input.value = t;
    input.setAttribute("aria-label", "Reminder time for " + habit.name);
    input.onchange = () => setTime(habit.id, input.value);
    face.appendChild(input);
    wrap.appendChild(face);
    if (t) {
      const clear = el("button", "habit-remind-clear", "✕");
      clear.type = "button";
      clear.title = "No reminder";
      clear.setAttribute("aria-label", "Remove the reminder for " + habit.name);
      clear.onclick = () => setTime(habit.id, "");
      wrap.appendChild(clear);
    }
    return wrap;
  }

  // Above the cards, once any habit has a time: how many, a switch for all
  // of them, and — if Android is holding them back — why, and the way out.
  function bar(habits) {
    if (!available()) return null;
    const set = habits.filter((h) => timeOf(h.id)).length;
    if (!set) return null;
    const { el } = ctx;
    const b = el("div", "habit-remind-bar");
    b.appendChild(el("span", "habit-remind-bar-text", isOn()
      ? "🔔 " + set + (set === 1 ? " reminder" : " reminders") + " on this phone"
      : "🔕 Reminders paused on this phone"));
    const toggle = el("button", "btn btn-sm", isOn() ? "Pause" : "Resume");
    toggle.type = "button";
    toggle.onclick = () => setOn(!isOn());
    b.appendChild(toggle);
    if (isOn()) {
      const warn = el("p", "habit-remind-warn");
      warn.hidden = true;
      b.appendChild(warn);
      state().then((now) => {
        if (now === "granted" || now === "unavailable" || !warn.isConnected) return;
        warn.hidden = false;
        warn.textContent = now === "denied"
          ? "Android is blocking LifeLog's notifications, so none of these will ring. "
          : "LifeLog needs your permission before any of these can ring. ";
        const fix = el("button", "btn btn-sm", now === "denied" ? "Open Android's settings" : "Allow");
        fix.type = "button";
        fix.onclick = () => (now === "denied" ? plugin().openNotificationSettings() : ensureAllowed());
        warn.appendChild(fix);
      });
    }
    return b;
  }

  // ctx: { $, el, Platform, toast, changed, render }
  function start(c) {
    ctx = c;
    // The first render has already happened by now, without the bells.
    if (available()) ctx.render();
  }

  window.LifeLogReminders = { start, available, isOn, setOn, timeOf, remindAt, setTime, chip, bar, isTime, KEY };
})();
