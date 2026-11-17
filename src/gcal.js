// LifeLog: Google Calendar's events on the Timeline's calendar, read only
// (0.320.0). Nothing is written to Google. A tap on an event opens a sheet
// that copies it into LifeLog as an entry, a task or a note.
//
// The events stay on this device (localStorage), never in the synced data:
// a whole calendar in the GitHub data repo would be a privacy cost and a
// commit on every sync. So each device connects on its own, and the bridge
// doesn't see them; what's copied in is ordinary data and it does.
//
// Sign-in uses the Drive backups' Google Cloud project and clients
// (src/drive.js), with its own token and these two scopes, which Google
// counts as sensitive: until the app is verified, Google shows "Google
// hasn't verified this app" before the consent screen (Advanced → continue).
//   - Android: the Drive plugin (native/widgets) asks Play Services for
//     these scopes instead of Drive's.
//   - A browser: Google's page in a small window, a token for an hour and no
//     refresh. After that the calendar shows the last copy until Sync now.
//   - The computer app: the browser and a one-off 127.0.0.1 address (the
//     app's oauth_listen/oauth_wait), PKCE, and a refresh token kept here.
//
// Disconnect forgets the token here but doesn't revoke it at Google: the
// grant is the same client's as Drive's, and revoking it ends both.
(function () {
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  const SCOPES = ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.readonly"];
  const API = "https://www.googleapis.com/calendar/v3";
  const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  const TOKEN_URL = "https://oauth2.googleapis.com/token";
  const TAG = "llgcal";
  const K = { cfg: "lifelog-gcal-v1", token: "lifelog-gcal-token-v1", hand: "lifelog-gcal-hand", ask: "lifelog-gcal-ask", events: "lifelog-gcal-events-v1" };
  // A month is fetched again when its copy is older than this.
  const FRESH = 15 * 60 * 1000;
  const MONTHS_KEPT = 6;

  class GcalError extends Error {
    constructor(message, code) { super(message); this.code = code || ""; }
  }

  // ---- Pure parts (test/gcal.test.js) ----

  const pad = (n) => String(n).padStart(2, "0");
  const localDay = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const localTime = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes());
  function addDay(day, n) {
    const [y, m, d] = day.split("-").map(Number);
    return localDay(new Date(y, m - 1, d + n));
  }

  // Google's events as LifeLog reads them: { id, cal, title, start, end
  // (the last day, inclusive), time, endTime, allDay, place, text, link }.
  // Times are this device's own.
  function readEvents(items, cal) {
    const out = [];
    for (const it of items || []) {
      if (!it || it.status === "cancelled" || !it.start) continue;
      const allDay = !!it.start.date;
      let start, end, time = "", endTime = "";
      if (allDay) {
        start = it.start.date;
        end = it.end && it.end.date ? addDay(it.end.date, -1) : start;
      } else {
        const s = new Date(it.start.dateTime);
        if (isNaN(s)) continue;
        const e = it.end && it.end.dateTime ? new Date(it.end.dateTime) : s;
        start = localDay(s);
        time = localTime(s);
        // An end on midnight belongs to the day before.
        const last = new Date(Math.max(+s, +e - 1));
        end = localDay(last);
        if (+e > +s) endTime = localTime(e);
      }
      if (end < start) end = start;
      out.push({ id: String(it.id || ""), cal: cal || "", title: String(it.summary || "").trim() || i18n.t("(No title)"),
        start, end, time, endTime, allDay, place: String(it.location || ""), text: String(it.description || ""), link: String(it.htmlLink || "") });
    }
    return out;
  }

  // One month's days → their events, all-day ones first, then by time.
  // An event over several days is on each of them.
  function byDay(events, y, m) {
    const key = y + "-" + pad(m);
    const first = key + "-01", last = key + "-" + pad(new Date(y, m, 0).getDate());
    const map = new Map();
    for (const ev of events) {
      if (ev.end < first || ev.start > last) continue;
      let day = ev.start < first ? first : ev.start;
      const stop = ev.end > last ? last : ev.end;
      for (let i = 0; day <= stop && i < 31; i++, day = addDay(day, 1)) {
        const d = +day.slice(8);
        if (!map.has(d)) map.set(d, []);
        map.get(d).push(ev);
      }
    }
    const order = (a, b) => (b.allDay - a.allDay) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title);
    for (const list of map.values()) list.sort(order);
    return map;
  }

  // An event's when, in words: "All day", "19:30–22:00", "Mon 16 Nov – Wed 18 Nov".
  function whenText(ev, D) {
    const day = (s) => (D ? D.day(s, { weekday: true, year: false }) : s);
    if (ev.allDay) return ev.start === ev.end ? day(ev.start) + " · " + i18n.t("All day") : day(ev.start) + " – " + day(ev.end);
    if (ev.start !== ev.end) return day(ev.start) + " " + ev.time + " – " + day(ev.end) + " " + ev.endTime;
    return day(ev.start) + " · " + ev.time + (ev.endTime && ev.endTime !== ev.time ? "–" + ev.endTime : "");
  }

  // A description is Google's HTML: as plain text, line breaks kept.
  function plainText(html) {
    const s = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n");
    let text;
    if (typeof DOMParser === "function") text = new DOMParser().parseFromString(s, "text/html").body.textContent || "";
    else text = s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  if (typeof window !== "object" || typeof document !== "object") {
    module.exports = { readEvents, byDay, whenText, plainText, addDay, SCOPES };
    return;
  }

  // ---- Where things are kept ----

  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const keep = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not kept */ } };
  let cfg = load(K.cfg, null); // { email, calendars: [{ id, name, color, on }], at }
  let months = load(K.events, {}); // "2026-11" → { at, events }
  let token = null; // { token, exp }
  const live = (t) => !!(t && t.token && t.exp > Date.now());
  const expiry = (s) => Date.now() + ((Number(s) || 3600) - 120) * 1000;
  const P = () => window.LifeLogPlatform || {};
  const native = () => !!P().native;
  const desktop = () => !!P().desktop;
  const browser = () => !native() && !desktop();
  const plugin = () => (native() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Drive) || null;
  const tauri = () => (desktop() && window.__TAURI__) || null;
  const clients = () => (window.LifeLogDrive && window.LifeLogDrive.clients) || {};
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const randomText = (n) => b64url(crypto.getRandomValues(new Uint8Array(n))).replace(/[^A-Za-z0-9]/g, "x");
  async function challengeOf(v) { return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))); }
  const saveCfg = () => keep(K.cfg, cfg);
  const saveMonths = () => {
    const keys = Object.keys(months).sort((a, b) => (months[b].at || 0) - (months[a].at || 0));
    for (const k of keys.slice(MONTHS_KEPT)) delete months[k];
    keep(K.events, months);
  };

  // ---- Coming back from Google's page (a browser) ----
  // #state=llgcal.<p|r>.<nonce>[.then]&access_token=…: p from the small
  // window, which closes again; r when this tab went to Google itself.
  const back = (() => {
    if (!browser() || location.hash.indexOf("state=" + TAG + ".") < 0) return null;
    const q = new URLSearchParams(location.hash.slice(1));
    if (!(q.get("state") || "").startsWith(TAG + ".")) return null;
    history.replaceState(history.state, "", location.pathname + location.search);
    const [, how, nonce, then] = q.get("state").split(".");
    const got = { nonce, then: then || "", error: q.get("error") || (q.get("access_token") ? "" : "none"),
      token: q.get("access_token") || "", exp: expiry(q.get("expires_in")) };
    keep(K.hand, got);
    try { const ch = new BroadcastChannel("lifelog.gcal"); ch.postMessage(got); ch.close(); } catch (e) { /* the storage event says it too */ }
    if (how === "p") setTimeout(() => window.close(), 60);
    return { popup: how === "p", got };
  })();

  if (browser()) { const t = load(K.token, null); if (live(t)) token = t; }
  const setToken = (t) => { token = t; if (browser()) keep(K.token, t); };
  const hint = () => (cfg && cfg.email ? { login_hint: cfg.email } : {});

  let waiting = null;
  function signInBrowser(then) {
    const c = clients();
    if (!c.web) return Promise.reject(new GcalError(i18n.t("Google Calendar isn't set up in this copy."), "setup"));
    const nonce = randomText(12);
    keep(K.ask, nonce);
    keep(K.hand, null);
    const redirect = location.origin + location.pathname.replace(/[^/]*$/, "");
    const url = (how) => AUTH_URL + "?" + new URLSearchParams({
      client_id: c.web, redirect_uri: redirect, response_type: "token", scope: SCOPES.join(" "),
      state: TAG + "." + how + "." + nonce + (how === "r" && then ? "." + then : ""), ...hint(),
    });
    const w = window.open(url("p"), "lifelog-gcal", "popup,width=480,height=640");
    if (!w) { location.assign(url("r")); return new Promise(() => {}); }
    if (waiting) waiting.no(new GcalError("Asked again.", "again"));
    return new Promise((ok, no) => {
      waiting = { ok, no };
      waiting.timer = setTimeout(() => { if (waiting) { waiting = null; no(new GcalError(i18n.t("Google didn't answer."), "timeout")); } }, 5 * 6e4);
    });
  }
  function handed(got) {
    if (!got || got.nonce !== load(K.ask, null)) return;
    keep(K.ask, null);
    keep(K.hand, null);
    const w = waiting;
    waiting = null;
    if (w) clearTimeout(w.timer);
    if (got.error) { if (w) w.no(new GcalError(i18n.t("Not allowed."), "declined")); return; }
    setToken({ token: got.token, exp: got.exp });
    if (w) w.ok(got.token);
  }
  if (browser()) {
    addEventListener("storage", (e) => { if (e.key === K.hand && e.newValue) handed(load(K.hand, null)); });
    try { new BroadcastChannel("lifelog.gcal").onmessage = (e) => handed(e.data); } catch (e) { /* storage event instead */ }
    if (back && !back.popup) handed(back.got);
  }

  async function tokenRequest(fields) {
    const c = clients();
    let res;
    try {
      res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: c.desktop, client_secret: c.secret || "", ...fields }).toString() });
    } catch (e) { throw new GcalError(i18n.t("Couldn't reach Google. Check the connection and try again."), "network"); }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.access_token) {
      if (body && body.error === "invalid_grant") { keep(K.token, null); throw new GcalError(i18n.t("Connect Google Calendar again."), "signin"); }
      throw new GcalError(i18n.t("Google said no ({why}).", { why: (body && body.error) || res.status }), "declined");
    }
    return body;
  }
  async function signInDesktop() {
    const c = clients();
    if (!c.desktop) throw new GcalError(i18n.t("Google Calendar isn't set up in this copy."), "setup");
    const t = tauri();
    const port = await t.core.invoke("oauth_listen");
    const redirect = "http://127.0.0.1:" + port;
    const verifier = randomText(48);
    const state = randomText(12);
    const url = AUTH_URL + "?" + new URLSearchParams({
      client_id: c.desktop, redirect_uri: redirect, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent",
      code_challenge: await challengeOf(verifier), code_challenge_method: "S256", state, ...hint(),
    });
    const answer = t.core.invoke("oauth_wait");
    P().openOutside(url);
    let q;
    try { q = new URLSearchParams(await answer); }
    catch (e) { throw new GcalError(/time/i.test(String(e)) ? i18n.t("Google didn't answer.") : i18n.t("Sign-in stopped."), "timeout"); }
    if (q.get("state") !== state) throw new GcalError(i18n.t("That sign-in wasn't this one. Try again."), "declined");
    if (q.get("error") || !q.get("code")) throw new GcalError(i18n.t("Not allowed."), "declined");
    const got = await tokenRequest({ code: q.get("code"), code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect });
    if (got.refresh_token) keep(K.token, { refresh: got.refresh_token });
    setToken({ token: got.access_token, exp: expiry(got.expires_in) });
    return got.access_token;
  }

  // A token, asking the person only when `ask` (a tap: a browser can open
  // its sign-in window only then). Throws "signin" otherwise.
  async function getToken(ask, then) {
    if (live(token)) return token.token;
    const D = plugin();
    if (D) {
      try {
        const r = await D.authorize({ ask: !!ask, scopes: SCOPES });
        setToken({ token: r.token, exp: Date.now() + 50 * 6e4 });
        return r.token;
      } catch (e) {
        if (e && e.code === "consent") throw new GcalError(i18n.t("Connect Google Calendar again."), "signin");
        if (e && e.code === "declined") throw new GcalError(i18n.t("Not allowed."), "declined");
        throw new GcalError(i18n.t("Couldn't reach Google. Check the connection and try again."), "network");
      }
    }
    if (tauri()) {
      const kept = load(K.token, null);
      if (kept && kept.refresh) {
        const got = await tokenRequest({ refresh_token: kept.refresh, grant_type: "refresh_token" });
        setToken({ token: got.access_token, exp: expiry(got.expires_in) });
        return got.access_token;
      }
      if (!ask) throw new GcalError(i18n.t("Connect Google Calendar again."), "signin");
      return signInDesktop();
    }
    if (!ask) throw new GcalError(i18n.t("Sign in to Google again."), "signin");
    return signInBrowser(then);
  }

  async function api(path, ask) {
    const t = await getToken(ask);
    let res;
    try { res = await fetch(API + path, { headers: { Authorization: "Bearer " + t } }); }
    catch (e) { throw new GcalError(i18n.t("Couldn't reach Google. Check the connection and try again."), "network"); }
    if (res.status === 401) {
      token = null;
      if (browser()) keep(K.token, null);
      const D = plugin();
      if (D && D.clearToken) await D.clearToken({ token: t }).catch(() => {});
      throw new GcalError(i18n.t("Sign in to Google again."), "signin");
    }
    if (res.status === 403) {
      const body = await res.json().catch(() => null);
      const reason = body && body.error && ((body.error.errors || [])[0] || {}).reason;
      if (reason === "accessNotConfigured" || /SERVICE_DISABLED/.test(JSON.stringify(body || ""))) throw new GcalError(i18n.t("The Google Calendar API isn't turned on in LifeLog's Google Cloud project."), "setup");
      throw new GcalError(i18n.t("Google Calendar said no. Connect it again to allow reading your calendars."), "scope");
    }
    if (!res.ok) throw new GcalError(i18n.t("Google Calendar said no ({why}). Try again later.", { why: res.status }), String(res.status));
    return res.json();
  }

  // Your calendars, keeping which ones you turned off. New ones come in
  // as Google has them ticked in its own list.
  async function loadCalendars(ask) {
    const got = await api("/users/me/calendarList?minAccessRole=reader&maxResults=250&fields=" + encodeURIComponent("items(id,summary,summaryOverride,backgroundColor,primary,selected)"), ask);
    const was = new Map(((cfg && cfg.calendars) || []).map((c) => [c.id, c]));
    const items = got.items || [];
    const primary = items.find((c) => c.primary);
    cfg = cfg || {};
    if (primary) cfg.email = primary.id;
    cfg.calendars = items.map((c) => ({
      id: c.id, name: c.summaryOverride || c.summary || c.id, color: /^#[0-9a-f]{6}$/i.test(c.backgroundColor || "") ? c.backgroundColor : "",
      on: was.has(c.id) ? was.get(c.id).on : c.primary || c.selected !== false,
    })).sort((a, b) => (b.id === cfg.email) - (a.id === cfg.email) || a.name.localeCompare(b.name));
    saveCfg();
  }

  async function fetchMonth(y, m, ask) {
    const key = y + "-" + pad(m);
    const from = new Date(y, m - 1, 1), to = new Date(y, m, 1);
    const events = [];
    for (const cal of (cfg.calendars || []).filter((c) => c.on)) {
      let page = "";
      for (let i = 0; i < 10; i++) {
        const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: "2500", timeMin: from.toISOString(), timeMax: to.toISOString(),
          fields: "items(id,status,summary,start,end,location,description,htmlLink),nextPageToken" });
        if (page) q.set("pageToken", page);
        const got = await api("/calendars/" + encodeURIComponent(cal.id) + "/events?" + q, ask);
        events.push(...readEvents(got.items, cal.id));
        page = got.nextPageToken || "";
        if (!page) break;
      }
    }
    months[key] = { at: Date.now(), events };
    cfg.at = Date.now();
    saveCfg();
    saveMonths();
  }

  // ---- What the app calls ----

  let busy = null;
  const listeners = new Set();
  const changed = () => listeners.forEach((f) => { try { f(); } catch (e) { /* one view's trouble */ } });

  async function connect() {
    await getToken(true, "connect");
    await loadCalendars(true);
    months = {};
    saveMonths();
    const now = new Date();
    await fetchMonth(now.getFullYear(), now.getMonth() + 1, true).catch(() => {});
    changed();
    return cfg.email;
  }
  function disconnect() {
    cfg = null; months = {}; token = null;
    keep(K.cfg, null); keep(K.token, null); keep(K.events, null);
    changed();
  }
  // Fetches a month again. `ask`: a tap, which may sign in again.
  // A sync of another month already under way is waited out, not returned
  // as this one's (a tap on Sync now while the last month was still loading).
  let busyKey = "";
  async function sync(y, m, ask) {
    if (!cfg) return false;
    const key = y + "-" + pad(m);
    if (busy && busyKey === key && !ask) return busy;
    while (busy) await busy.catch(() => {});
    if (!cfg) return false;
    busyKey = key;
    busy = (async () => {
      if (ask) await loadCalendars(true);
      await fetchMonth(y, m, ask);
      changed();
      return true;
    })().finally(() => { busy = null; });
    return busy;
  }
  // The calendar asks as it draws: a month with no copy, or an old one, is
  // fetched quietly when a token is at hand; on a browser past its hour
  // the old copy stays, and Sync now asks.
  const quiet = new Set();
  let lastError = null;
  function ensure(y, m) {
    if (!cfg || busy) return;
    const key = y + "-" + pad(m);
    const copy = months[key];
    if (copy && Date.now() - copy.at < FRESH) return;
    if (quiet.has(key)) return;
    if (browser() && !live(token)) return;
    quiet.add(key);
    setTimeout(() => quiet.delete(key), FRESH);
    sync(y, m, false).then(() => { lastError = null; }, (e) => { lastError = e; changed(); });
  }

  function setCalendar(id, on) {
    if (!cfg) return;
    const c = (cfg.calendars || []).find((x) => x.id === id);
    if (!c) return;
    c.on = !!on;
    saveCfg();
    months = {};
    saveMonths();
    changed();
  }

  function eventsFor(y, m) {
    if (!cfg) return new Map();
    const copy = months[y + "-" + pad(m)];
    const on = new Set((cfg.calendars || []).filter((c) => c.on).map((c) => c.id));
    return byDay(copy ? copy.events.filter((e) => on.has(e.cal)) : [], y, m);
  }
  const colorOf = (calId) => { const c = cfg && (cfg.calendars || []).find((x) => x.id === calId); return (c && c.color) || ""; };
  const calName = (calId) => { const c = cfg && (cfg.calendars || []).find((x) => x.id === calId); return (c && c.name) || ""; };

  window.LifeLogGcal = {
    GcalError, SCOPES, readEvents, byDay, whenText, plainText,
    connect, disconnect, sync, ensure, setCalendar, eventsFor, colorOf, calName, getToken,
    onChange: (f) => listeners.add(f),
    // A way in: the plugin on a phone, the Desktop client on a computer,
    // the Web client in a browser over https (or localhost).
    get available() {
      const c = clients();
      if (native()) return !!plugin();
      if (desktop()) return !!c.desktop && !!tauri();
      return !!c.web && (location.protocol === "https:" || location.hostname === "localhost");
    },
    get on() { return !!cfg; },
    get email() { return (cfg && cfg.email) || ""; },
    get calendars() { return (cfg && cfg.calendars) || []; },
    get at() { return (cfg && cfg.at) || 0; },
    get busy() { return !!busy; },
    get error() { return lastError; },
    clearError() { lastError = null; },
    // A browser past its hour needs a tap to fetch again.
    get needsTap() { return !!cfg && browser() && !live(token); },
    get closing() { return !!(back && back.popup); },
    get resume() { return back && !back.popup && !back.got.error ? back.got.then : ""; },
  };
})();
