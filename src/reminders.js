// LifeLog — habit reminders, in the Android app (0.183.0) and the iOS app
// (0.217.0, scheduled ahead rather than decided at ring time — see
// native/widgets/ios/Shared/LifeLogReminders.swift).
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
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  const KEY = "lifelog-habit-reminders-v1";
  let ctx = null;

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  };
  const write = (v) => {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* kept for this session only */ }
  };
  const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
  // In the computer app src/desktop.js rings them itself, and
  // answers the same permission questions.
  const plugin = () => (ctx && (ctx.Platform.plugin("Widgets")
    || (ctx.Platform.desktop && window.LifeLogDesktop && window.LifeLogDesktop.notifier))) || null;
  const here = () => (ctx && ctx.Platform.desktop ? "computer" : "phone");

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
      ctx.toast(i18n.t("Notifications are off for LifeLog, so reminders can't ring yet"), true,
        { label: i18n.t("Allow"), onClick: () => W.openNotificationSettings() });
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
    face.title = t ? i18n.t("Reminder at {time} — tap to change", { time: t }) : i18n.t("Remind me about this habit");
    face.appendChild(el("span", null)).appendChild(t ? window.LifeLogIcons.labelled(isOn() ? "bell" : "bell-off", t) : window.LifeLogIcons.svg("bell"));
    const input = el("input", "habit-remind-input");
    input.type = "time";
    input.value = t;
    input.setAttribute("aria-label", i18n.t("Reminder time for {name}", { name: habit.name }));
    input.onchange = () => setTime(habit.id, input.value);
    face.appendChild(input);
    wrap.appendChild(face);
    if (t) {
      const clear = el("button", "habit-remind-clear");
      clear.appendChild(window.LifeLogIcons.svg("x"));
      clear.type = "button";
      clear.title = i18n.t("No reminder");
      clear.setAttribute("aria-label", i18n.t("Remove the reminder for {name}", { name: habit.name }));
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
    b.appendChild(el("span", "habit-remind-bar-text")).appendChild(isOn()
      ? window.LifeLogIcons.labelled("bell", here() === "computer" ? i18n.tn(set, "{n} reminder on this computer", "{n} reminders on this computer") : i18n.tn(set, "{n} reminder on this phone", "{n} reminders on this phone"))
      : window.LifeLogIcons.labelled("bell-off", here() === "computer" ? i18n.t("Reminders paused on this computer") : i18n.t("Reminders paused on this phone")));
    const toggle = el("button", "btn btn-sm", isOn() ? i18n.t("Pause") : i18n.t("Resume"));
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
          ? (here() === "computer" ? i18n.t("Notifications are off for LifeLog in the computer's settings, so none of these will ring.") : i18n.t("Notifications are off for LifeLog in the phone's settings, so none of these will ring.")) + " "
          : i18n.t("LifeLog needs your permission before any of these can ring.") + " ";
        const fix = el("button", "btn btn-sm", now === "denied" ? i18n.t("Open settings") : i18n.t("Allow"));
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

  window.LifeLogReminders = { start, available, isOn, setOn, timeOf, remindAt, setTime, chip, bar, isTime, ensureAllowed, KEY };
})();
