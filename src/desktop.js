// LifeLog — what only the Windows and Linux app does (Tauri, src-tauri/).
// platform.js already covers what it shares with the phones: the files in
// the bundle, HTTP without CORS, links out to the browser, the Save dialog.
// This is the rest:
//
//   - the tray's Add entry / Add expense, run as the phones' shortcuts are;
//   - habit reminders and the charge, release-day and price heads-ups,
//     worked out from the same lists the phones get (reminders.js,
//     alerts.js) and rung by the app itself. A phone hands them to the
//     system to ring later; here nothing rings unless LifeLog is running,
//     which is why closing the window keeps it in the tray and Start at
//     login exists;
//   - start at login, into the tray;
//   - updating: Tauri's updater when the release carries its signed files,
//     else the release page.
(function () {
  const P = window.LifeLogPlatform;
  const T = () => (P && P.desktop && P.tauri) || null;
  const FIRED_KEY = "lifelog-desktop-rung-v1";
  // A reminder whose time went by while LifeLog wasn't running still rings
  // when it opens, up to this long after; past that it's yesterday's news.
  const LATE_HABIT_MIN = 60;
  const LATE_ALERT_MIN = 12 * 60;
  const TICK_MS = 30 * 1000;
  let ctx = null;
  let timer = null;

  const pad = (n) => String(n).padStart(2, "0");
  const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const minutesOf = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };

  const readFired = () => {
    try { return JSON.parse(localStorage.getItem(FIRED_KEY)) || {}; } catch (e) { return {}; }
  };
  const writeFired = (v) => {
    try { localStorage.setItem(FIRED_KEY, JSON.stringify(v)); } catch (e) { /* rings again next launch at worst */ }
  };

  // ---------- the notifications ----------
  // The shape reminders.js asks of the phones' plugin, so its bar, its chip
  // and Settings → Notifications work here unchanged.
  const notifier = {
    async notificationState() {
      const N = T() && T().notification;
      if (!N) return { state: "unavailable" };
      try { return { state: (await N.isPermissionGranted()) ? "granted" : "prompt" }; } catch (e) { return { state: "unavailable" }; }
    },
    async askForNotifications() {
      const N = T() && T().notification;
      if (!N) return { state: "unavailable" };
      try {
        const r = await N.requestPermission();
        return { state: r === "granted" ? "granted" : r === "denied" ? "denied" : "prompt" };
      } catch (e) { return { state: "denied" }; }
    },
    // Windows and Linux have no one page for an app's notifications that
    // a link reaches, so there's nothing to open.
    openNotificationSettings() {},
  };

  function ring(title, body) {
    const N = T() && T().notification;
    if (!N) return;
    try { N.sendNotification({ title: String(title), body: String(body || "") }); } catch (e) { /* missed, not fatal */ }
  }

  // What's due by now and hasn't rung yet (pure; test/desktop.test.js).
  // habits: [{ id, name, period }] still left to do today, timeOf(id) its
  // reminder time or ""; alerts: alerts.js's list. fired: key → day rung.
  function dueNow({ today, now, habits = [], timeOf = () => "", alerts = [], fired = {} }) {
    const out = [];
    const nowMin = minutesOf(now);
    for (const h of habits) {
      const t = timeOf(h.id);
      if (!t) continue;
      const late = nowMin - minutesOf(t);
      const key = "habit:" + h.id + ":" + today;
      if (late < 0 || late > LATE_HABIT_MIN || fired[key]) continue;
      const when = !h.period || h.period === "day" ? "today" : "this " + h.period;
      out.push({ key, title: h.name, body: "Still to do " + when });
    }
    for (const a of alerts) {
      if (!a || a.day !== today || !a.time || fired["alert:" + a.id]) continue;
      const late = nowMin - minutesOf(a.time);
      if (late < 0 || late > LATE_ALERT_MIN) continue;
      out.push({ key: "alert:" + a.id, title: a.title, body: a.body });
    }
    return out;
  }

  function tick() {
    if (!ctx) return;
    const H = window.LifeLogHabits, R = window.LifeLogReminders, A = window.LifeLogAlerts;
    const data = ctx.state.data;
    if (!data) return;
    const d = new Date();
    const today = localDate(d);
    const now = pad(d.getHours()) + ":" + pad(d.getMinutes());
    let habits = [];
    if (H && R && R.isOn()) {
      for (const g of H.leftToDo(data.habits || [], today).groups) {
        for (const it of g.items) habits.push({ id: it.habit.id, name: it.habit.name, period: g.period });
      }
    }
    let alerts = [];
    if (A) {
      try { alerts = A.current(data, today, !!(ctx.hidden && ctx.hidden())); } catch (e) { alerts = []; }
    }
    const fired = readFired();
    const due = dueNow({ today, now, habits, timeOf: R ? R.remindAt : () => "", alerts, fired });
    if (!due.length) return;
    for (const n of due) {
      ring(n.title, n.body);
      fired[n.key] = today;
    }
    // Only the last few days are kept: an older key can't come round again.
    const keep = localDate(new Date(d.getTime() - 3 * 86400000));
    for (const k of Object.keys(fired)) if (fired[k] < keep) delete fired[k];
    writeFired(fired);
  }

  // ---------- start at login ----------
  async function startsAtLogin() {
    const S = T() && T().autostart;
    if (!S) return null;
    try { return !!(await S.isEnabled()); } catch (e) { return null; }
  }
  async function setStartsAtLogin(on) {
    const S = T() && T().autostart;
    if (!S) return false;
    if (on) await S.enable(); else await S.disable();
    return true;
  }

  // ---------- updating ----------
  // Resolves true once the new version is installed and the app restarts,
  // false when Tauri's updater has nothing for this copy (the release has no
  // signed update files yet, or this is a .deb), so the caller can send you
  // to the release page instead.
  async function installUpdate(onProgress) {
    const U = T() && T().updater;
    if (!U) return false;
    let update = null;
    try { update = await U.check(); } catch (e) { return false; }
    if (!update) return false;
    let total = 0, got = 0;
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = (e.data && e.data.contentLength) || 0;
      else if (e.event === "Progress") { got += (e.data && e.data.chunkLength) || 0; if (total && onProgress) onProgress(Math.min(1, got / total)); }
    });
    if (T().process) await T().process.relaunch();
    return true;
  }

  // ctx: { state, runAction, hidden }
  function start(c) {
    ctx = c;
    const t = T();
    if (!t) return;
    if (t.event) t.event.listen("lifelog-action", (e) => { if (e && typeof e.payload === "string") ctx.runAction(e.payload); });
    clearInterval(timer);
    timer = setInterval(tick, TICK_MS);
    setTimeout(tick, 3000);
  }

  window.LifeLogDesktop = {
    available: () => !!T(),
    notifier, start, tick, dueNow,
    startsAtLogin, setStartsAtLogin, installUpdate,
    FIRED_KEY,
  };
})();
