// LifeLog — heads-ups on the phone (0.272.0): a recurring charge coming up,
// what in the Backlog is out today, and (0.276.0) a Steam game that has
// dropped to the price you asked for.
//
// Same road as the habit reminders (reminders.js): what to say and when is
// worked out here, where the data is, and rides out in the widgets'
// snapshot as `alerts`. The native side only rings them: Android's one
// alarm takes the soonest alert or habit reminder (Reminders.java), iOS
// schedules them ahead (LifeLogReminders.swift). So a date that moves, a
// plan that's skipped or stopped, or a release that slips moves its alert
// the next time the app saves.
//
// The choices are kept on this phone, like reminder times: a desktop has
// nothing to buzz, and the data file stays as it was, so nothing changes
// for the bridge.
(function () {
  const KEY = "lifelog-alerts-v1";
  // When they ring. One fixed time: these are a morning's heads-up, not
  // appointments.
  const AT = "09:00";
  // How far ahead the snapshot looks. A phone not opened for longer than
  // this runs out of alerts, so it's generous; MAX keeps iOS well under
  // its 64 pending notifications, with the habit reminders beside them.
  const WINDOW_DAYS = 40;
  const MAX = 24;
  const CHARGE_DAYS = [["", "Off"], ["0", "On the day"], ["1", "The day before"], ["3", "3 days before"], ["7", "A week before"]];
  const RELEASE_MODES = [["off", "Off"], ["starred", "Starred"], ["all", "Everything"]];

  const pad = (n) => String(n).padStart(2, "0");
  const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => {
    const d = new Date(s + "T00:00:00");
    d.setDate(d.getDate() + n);
    return localDate(d);
  };
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  };
  const write = (v) => {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* kept for this session only */ }
  };

  // ---------- what to ring, and when (pure; test/alerts.test.js) ----------

  // A charge's heads-up is keyed by the first plan in its chain, so a
  // "Change plan" (a new plan with a prevId) keeps the reminder.
  function chargeAlerts(data, today, charges, F, fmt) {
    const all = data.recurringExpenses || [];
    const out = [];
    for (const rec of all) {
      const root = (F.planChain(all, rec)[0] || rec).id;
      const days = charges[root];
      if (days == null || days === "") continue;
      const before = +days || 0;
      const until = new Date(addDays(today, WINDOW_DAYS + before) + "T00:00:00");
      for (const o of F.planCharges(rec, until)) {
        if (o.skipped || o.paused || !isDate(o.date) || o.date < today) continue;
        const day = addDays(o.date, -before);
        if (day < today) continue;
        const name = o.note || rec.note || o.category || rec.category || "A recurring expense";
        const when = before === 0 ? "today" : before === 1 ? "tomorrow" : "in " + before + " days";
        out.push({
          id: "charge-" + rec.id + "-" + o.date,
          kind: "charge",
          day, time: AT,
          title: name + " charges " + when,
          body: fmt.money(o.amount) + " on " + fmt.day(o.date),
          action: "open-finance",
        });
      }
    }
    return out;
  }

  // The day something is out, when it's known to the day: the next episode,
  // else the release itself.
  function outDay(b) {
    if (isDate(b.nextAt)) return b.nextAt;
    return isDate(b.releaseDate) && (!b.releasePrecision || b.releasePrecision === "day") ? b.releaseDate : "";
  }

  // One a day, however many things land on it.
  function releaseAlerts(data, today, mode) {
    if (mode !== "starred" && mode !== "all") return [];
    const last = addDays(today, WINDOW_DAYS);
    const byDay = new Map();
    for (const b of data.backlog || []) {
      if (b.dropped || (mode === "starred" && b.priority !== 1)) continue;
      const day = outDay(b);
      if (!day || day < today || day > last) continue;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(b.nextAt === day && b.nextLabel ? b.title + " " + b.nextLabel : b.title);
    }
    const out = [];
    for (const [day, names] of byDay) {
      out.push({
        id: "release-" + day,
        kind: "release",
        day, time: AT,
        title: names.length === 1 ? names[0] + " is out today" : names.length + " things are out today",
        body: names.length === 1 ? "From your Backlog" : names.join(", "),
        action: "open-upcoming",
      });
    }
    return out;
  }

  // A price hit is recorded the moment the app sees it (priceHit below),
  // stamped with that minute, and rides out at once: the phone rings
  // whatever in the snapshot is still ahead of it. A hit stays on the list
  // while the item still asks for it, so the snapshot is stable across
  // pushes and a rung alert is not rung twice (the natives skip a time
  // already past); yesterday's and older are dropped, since they can only
  // ever take a slot.
  function priceAlerts(data, today, hits) {
    const out = [];
    const since = addDays(today, -1);
    for (const b of data.backlog || []) {
      const h = hits[b.id];
      if (!h || !(b.priceAlert > 0) || b.bought || b.dropped || !isDate(h.day) || h.day < since) continue;
      out.push({
        id: "price-" + b.id,
        kind: "price",
        day: h.day, time: h.time,
        title: b.title + " is $" + Number(h.price).toFixed(2),
        body: "Under your $" + Number(b.priceAlert).toFixed(2) + " on GG.deals",
        action: "open-backlog",
      });
    }
    return out;
  }

  // `hidden`: the lock is on with "hide in widgets" (0.262.0). A
  // notification shows on the lock screen, so it says what kind of thing,
  // not which.
  const HIDDEN_BODY = { charge: "A recurring charge is coming up", release: "Something in your Backlog is out today", price: "A game in your Backlog is on sale" };
  function alertsOf(data, { today, charges = {}, releases = "off", prices = {}, finance, fmt, hidden = false } = {}) {
    const list = [
      ...(finance ? chargeAlerts(data, today, charges, finance, fmt) : []),
      ...releaseAlerts(data, today, releases),
      ...priceAlerts(data, today, prices),
    ].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id)).slice(0, MAX);
    if (!hidden) return list;
    return list.map((a) => ({ ...a, title: "LifeLog", body: HIDDEN_BODY[a.kind] || "LifeLog has something for you" }));
  }

  // ---------- this phone's choices ----------
  let ctx = null;
  const available = () => !!(window.LifeLogReminders && window.LifeLogReminders.available());

  function chargeDays(rootId) {
    const v = (read().charges || {})[rootId];
    return v == null ? "" : String(v);
  }
  function setChargeDays(rootId, days) {
    if (!rootId) return;
    const s = read();
    s.charges = s.charges || {};
    const had = s.charges[rootId] != null;
    if (days === "" || days == null) delete s.charges[rootId]; else s.charges[rootId] = String(days);
    write(s);
    if (ctx) ctx.changed();
    if (days !== "" && days != null && !had && window.LifeLogReminders) window.LifeLogReminders.ensureAllowed();
  }
  function releaseMode() {
    const m = read().releases;
    return m === "starred" || m === "all" ? m : "off";
  }
  function setReleaseMode(mode) {
    const s = read();
    s.releases = mode === "starred" || mode === "all" ? mode : "off";
    write(s);
    if (ctx) ctx.changed();
    if (s.releases !== "off" && window.LifeLogReminders) window.LifeLogReminders.ensureAllowed();
  }

  // A Steam price at or under the item's target, seen by the app
  // (checkPriceAlerts in sync.js). Recorded once per dip: true when this is
  // news, false while the earlier hit stands. priceClear is the price going
  // back above the target, after which the next dip rings again.
  function priceHit(item, price) {
    const s = read();
    s.prices = s.prices || {};
    if (s.prices[item.id]) return false;
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1);
    s.prices[item.id] = { day: localDate(now), time: pad(now.getHours()) + ":" + pad(now.getMinutes()), price };
    write(s);
    if (ctx) ctx.changed();
    if (window.LifeLogReminders) window.LifeLogReminders.ensureAllowed();
    return true;
  }
  function priceClear(id) {
    const s = read();
    if (!s.prices || !s.prices[id]) return;
    delete s.prices[id];
    write(s);
    if (ctx) ctx.changed();
  }
  function priceHitOf(id) { return (read().prices || {})[id] || null; }

  // What the snapshot carries, from the app's state (widgets.js calls this).
  function current(data, today, hidden) {
    const F = window.LifeLogFinance;
    const s = read();
    return alertsOf(data, {
      today,
      charges: s.charges || {},
      releases: releaseMode(),
      prices: s.prices || {},
      finance: F,
      fmt: ctx ? ctx.fmt : { money: String, day: String },
      hidden,
    });
  }

  // ctx: { changed, fmt: { money, day } }
  function start(c) { ctx = c; }

  window.LifeLogAlerts = {
    start, available, current, alertsOf, outDay,
    chargeDays, setChargeDays, releaseMode, setReleaseMode,
    priceHit, priceClear, priceHitOf,
    CHARGE_DAYS, RELEASE_MODES, KEY, AT,
  };
})();
