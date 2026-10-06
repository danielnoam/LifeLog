// LifeLog — trips (0.241.0): the Travel tab. A trip is a name, an optional
// start and end date, and the places you mean to go. A place can have a day,
// and a time on that day; one with a time is scheduled, one with only a day
// is "sometime that day", and one with neither is "sometime this trip". So a
// day is as planned as you make it, with no mode to switch.
//
// Trips live in their own file, travel.json beside lifelog.json (see
// Storage.travel), loaded the first time the tab wants them. Why not inside
// lifelog.json: a build older than this one merging that file would drop any
// root key it doesn't know, and the deletion would then win everywhere.
(function () {
  let state, $, el, uid, toast, emptyState, render, Storage, monthCardHeader, activatable, updateFilterbarVisibility;

  function init(ctx) {
    ({ state, $, el, uid, toast, emptyState, render, Storage, monthCardHeader, activatable, updateFilterbarVisibility } = ctx);
  }

  // ---------- pure: cleaning, dates, ordering (test/travel.test.js) ----------
  const KNOWN_TRIP_KEYS = new Set(["id", "name", "start", "end", "createdAt", "updatedAt"]);
  const KNOWN_PLACE_KEYS = new Set([
    "id", "trip", "name", "lat", "lng", "address", "note", "url", "day", "time", "endTime",
    "order", "visited", "gid", "source", "createdAt", "updatedAt",
  ]);
  // Fields this build doesn't know are carried through, so a newer build's
  // additions survive an older one saving (the same rule as app.js's).
  function keepUnknown(src, out, known) {
    for (const key of Object.keys(src || {})) if (!known.has(key)) out[key] = src[key];
    return out;
  }
  const newId = () => (uid ? uid() : "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  // Round-tripped, because Date.parse reads "2027-02-30" as 2 March.
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const text = (v) => String(v == null ? "" : v).trim();
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() && isFinite(+v) ? +v : null));

  function sanitizeTrip(t) {
    t = t || {};
    const out = {
      id: t.id || newId(),
      name: text(t.name) || "Untitled trip",
      createdAt: t.createdAt || null,
      updatedAt: t.updatedAt || t.createdAt || "1970-01-01T00:00:00.000Z",
    };
    if (isDay(t.start)) out.start = t.start;
    if (isDay(t.end)) out.end = t.end;
    // An end before the start is a typo, not a trip that runs backwards.
    if (out.start && out.end && out.end < out.start) [out.start, out.end] = [out.end, out.start];
    return keepUnknown(t, out, KNOWN_TRIP_KEYS);
  }

  function sanitizePlace(p) {
    p = p || {};
    const out = {
      id: p.id || newId(),
      trip: text(p.trip),
      name: text(p.name) || "Untitled place",
      createdAt: p.createdAt || null,
      updatedAt: p.updatedAt || p.createdAt || "1970-01-01T00:00:00.000Z",
    };
    const lat = num(p.lat), lng = num(p.lng);
    if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { out.lat = lat; out.lng = lng; }
    for (const k of ["address", "note", "url", "gid", "source"]) { const v = text(p[k]); if (v) out[k] = v; }
    if (isDay(p.day)) out.day = p.day;
    // A time only means something on a day; an end time only after a start.
    if (out.day && isTime(p.time)) {
      out.time = p.time;
      if (isTime(p.endTime) && p.endTime > p.time) out.endTime = p.endTime;
    }
    const order = num(p.order);
    if (order != null) out.order = order;
    if (p.visited) out.visited = true;
    return keepUnknown(p, out, KNOWN_PLACE_KEYS);
  }

  // Trips and places together, as travel.json holds them. A place whose trip
  // is gone is dropped: deleting a trip takes its places with it, and one a
  // merge left behind has nowhere to be shown.
  function sanitizeDoc(d) {
    const trips = ((d && d.trips) || []).filter((t) => t && typeof t === "object").map(sanitizeTrip);
    const ids = new Set(trips.map((t) => t.id));
    const places = ((d && d.places) || []).filter((p) => p && typeof p === "object").map(sanitizePlace).filter((p) => ids.has(p.trip));
    return { trips, places };
  }

  const DAY_MS = 86400000;
  const dayNum = (day) => Date.parse(day + "T00:00:00Z") / DAY_MS;
  const dayOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
  const MAX_TRIP_DAYS = 366;

  // Every day the trip covers, then any day a place sits on outside it, in
  // order. A trip with no dates has only its places' days.
  function tripDays(trip, places) {
    const days = new Set();
    if (trip.start && trip.end && dayNum(trip.end) - dayNum(trip.start) < MAX_TRIP_DAYS) {
      for (let n = dayNum(trip.start); n <= dayNum(trip.end); n++) days.add(dayOf(n));
    } else {
      if (trip.start) days.add(trip.start);
      if (trip.end) days.add(trip.end);
    }
    for (const p of places) if (p.day) days.add(p.day);
    return [...days].sort();
  }

  // A day's places: the scheduled ones by time, then the rest in the order
  // they were put there.
  function sortDay(places) {
    const timed = places.filter((p) => p.time).sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
    const open = places.filter((p) => !p.time).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)
      || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    return timed.concat(open);
  }

  // Where a trip stands against today: under way, ahead, behind, or not
  // dated yet. The trip list reads it for its order and its labels.
  function tripStatus(trip, today) {
    const s = trip.start, e = trip.end || trip.start;
    if (!s) return "undated";
    if (e < today) return "past";
    if (s > today) return "upcoming";
    return "now";
  }
  const STATUS_RANK = { now: 0, upcoming: 1, undated: 2, past: 3 };
  function sortTrips(trips, today) {
    return trips.slice().sort((a, b) => {
      const sa = tripStatus(a, today), sb = tripStatus(b, today);
      if (sa !== sb) return STATUS_RANK[sa] - STATUS_RANK[sb];
      if (sa === "past") return b.start.localeCompare(a.start);
      if (sa === "undated") return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      return a.start.localeCompare(b.start);
    });
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const parts = (day) => ({ y: +day.slice(0, 4), m: +day.slice(5, 7), d: +day.slice(8, 10) });
  function dayLabel(day) {
    const { m, d } = parts(day);
    return `${WEEKDAYS[new Date(day + "T00:00:00Z").getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
  }
  // "12–18 Oct 2026", "30 Sep – 3 Oct 2026", "28 Dec 2026 – 4 Jan 2027".
  function rangeLabel(start, end) {
    if (!start) return "";
    const a = parts(start);
    if (!end || end === start) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
    const b = parts(end);
    if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
    if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
    return `${a.d}–${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  }
  const timeLabel = (p) => (p.time ? p.time + (p.endTime ? "–" + p.endTime : "") : "");

  // Where "Open in Google Maps" goes: the link you gave it, else Google's own
  // page for it, else its coordinates, else a search for its name and address.
  function mapsUrl(p) {
    if (p.url) return p.url;
    if (p.gid) return "https://www.google.com/maps?ftid=" + p.gid;
    if (p.lat != null && p.lng != null) return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([p.name, p.address].filter(Boolean).join(", "));
  }

  // ---------- Google Maps links (0.242.0) ----------
  // Google has no API for saved lists. A shared list's short link redirects
  // to a google.com/maps URL holding the list's id, and the endpoint Maps'
  // own page reads the list from answers ")]}'" and then JSON. Unofficial:
  // if Google changes it, this is the one place to change. A shared single
  // place resolves to a /maps/place/ or ?ftid= URL, read here too.
  const LIST_ID = "[A-Za-z0-9_-]{16,}";
  const decodeAll = (s) => {
    s = String(s || "");
    for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(s); if (d === s) break; s = d; } catch (e) { break; } }
    return s;
  };
  // The list id in anything that holds one: the long URL (also inside a
  // consent page's ?continue=), a /placelists/list/ link, or the bare id.
  function googleListId(s) {
    const t = decodeAll(s).trim();
    const m = new RegExp("!11m\\d+!2s(" + LIST_ID + ")").exec(t) || new RegExp("placelists/list/(" + LIST_ID + ")").exec(t);
    if (m) return m[1];
    return new RegExp("^" + LIST_ID + "$").test(t) && !/^https?:/i.test(t) ? t : null;
  }
  // maps.app.goo.gl/<code> and goo.gl/maps/<code>, the links Share gives.
  function googleShortCode(s) {
    const m = /^(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/([A-Za-z0-9_-]+)/i.exec(String(s || "").trim());
    return m ? m[1] : null;
  }
  const googleListUrl = (id) => "https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=us&pb=!1m4!1s"
    + encodeURIComponent(id) + "!2e1!3m1!1e1!2e2!3e2!4i500!16b1";
  // Google's place id is two 64-bit numbers. The list sends them as signed
  // decimals; Maps' links write them as unsigned hex, "0x…:0x…".
  function gidOf(pair) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    try { return pair.slice(0, 2).map((n) => "0x" + BigInt.asUintN(64, BigInt(String(n))).toString(16)).join(":"); }
    catch (e) { return null; }
  }
  const at = (o, ...path) => path.reduce((x, k) => (x != null ? x[k] : undefined), o);

  // The list endpoint's answer, as {id, name, places}. Each place keeps only
  // what a trip uses: the list also names its owner, and that stays out.
  function parseGoogleList(body) {
    let root;
    try { root = JSON.parse(String(body || "").replace(/^\)\]\}'\s*/, "")); }
    catch (e) { throw new Error("That isn't a Google Maps list"); }
    const list = at(root, 0);
    if (!Array.isArray(list) || !Array.isArray(list[8])) throw new Error("That isn't a Google Maps list");
    const places = [];
    for (const p of list[8]) {
      const name = text(at(p, 2));
      if (!name) continue;
      const out = { name };
      const lat = num(at(p, 1, 5, 2)), lng = num(at(p, 1, 5, 3));
      if (lat != null && lng != null) { out.lat = lat; out.lng = lng; }
      const address = text(at(p, 1, 4)), note = text(at(p, 3)), gid = gidOf(at(p, 1, 6));
      if (address) out.address = address;
      if (note) out.note = note;
      if (gid) out.gid = gid;
      places.push(out);
    }
    return { id: text(at(list, 0, 0)), name: text(list[4]) || "Google Maps list", places };
  }

  // One shared place, from the URL its short link resolves to:
  // /maps/place/<name>/@…/data=…!1s0x…:0x…!8m2!3d<lat>!4d<lng>, or
  // /maps?q=<name, address>&ftid=0x…:0x….
  function parseGooglePlaceUrl(s) {
    const t = decodeAll(s);
    let u;
    try { u = new URL(t.replace(/^.*?(https?:\/\/[a-z.]*google\.[^\s]+).*$/s, "$1")); } catch (e) { return null; }
    if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname)) return null;
    const gidRe = /0x[0-9a-f]+:0x[0-9a-f]+/i;
    const named = /\/maps\/place\/([^/@]+)/.exec(u.pathname);
    if (named) {
      const out = { name: text(named[1].replace(/\+/g, " ")) };
      const lat = /!3d(-?\d+(?:\.\d+)?)/.exec(t), lng = /!4d(-?\d+(?:\.\d+)?)/.exec(t);
      if (lat && lng) { out.lat = +lat[1]; out.lng = +lng[1]; }
      else { const c = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(t); if (c) { out.lat = +c[1]; out.lng = +c[2]; } }
      const g = gidRe.exec(t);
      if (g) out.gid = g[0].toLowerCase();
      return out.name ? out : null;
    }
    const q = text(u.searchParams.get("q")), ftid = text(u.searchParams.get("ftid"));
    if (q && gidRe.test(ftid)) {
      const comma = q.indexOf(",");
      const out = { name: comma > 0 ? q.slice(0, comma).trim() : q, gid: ftid.toLowerCase() };
      if (comma > 0 && q.slice(comma + 1).trim()) out.address = q.slice(comma + 1).trim();
      return out;
    }
    return null;
  }

  // From a pasted link to {name, places, source}: a list's places, or one
  // place. `get(kind, arg)` does the network part, which differs between the
  // app, a browser (the proxy) and the bridge (Node): "resolve" turns a
  // short link's code into where it leads, "list" fetches a list by id.
  async function fetchGoogle(link, get) {
    link = String(link || "").trim();
    if (!link) throw new Error("Paste a Google Maps link first");
    let where = link;
    const code = googleShortCode(link);
    if (code) where = await get("resolve", code);
    const id = googleListId(where);
    if (id) {
      const list = parseGoogleList(await get("list", id));
      return { name: list.name, source: id, places: list.places };
    }
    const one = parseGooglePlaceUrl(where);
    if (one) return { name: one.name, source: "", places: [one], url: code ? link : "" };
    throw new Error("That link isn't a Google Maps list or place");
  }

  // Already in the trip: the same Google place, or failing an id, the same
  // name within 50 m.
  function samePlace(a, b) {
    if (a.gid && b.gid) return a.gid === b.gid;
    if (text(a.name).toLowerCase() !== text(b.name).toLowerCase()) return false;
    if (a.lat == null || b.lat == null) return true;
    return distanceKm(a, b) < 0.05;
  }

  // ---------- areas (By area, and the import's groups) ----------
  function distanceKm(a, b) {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // The town in a Google-style address: the part with the postcode, with
  // the postcode and any region code taken out ("00187 Roma RM" is Roma).
  // When that leaves nothing ("IL 62701"), the part before it; with no
  // postcode, the last part before the country.
  function townOf(address) {
    const parts = text(address).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return "";
    parts.pop();
    const strip = (part) => part.split(/\s+/).filter((w) => !/\d/.test(w) && !/^[A-Z]{2,3}$/.test(w)).join(" ");
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!/\d/.test(parts[i])) continue;
      return strip(parts[i]) || (i > 0 ? strip(parts[i - 1]) : "");
    }
    return strip(parts[parts.length - 1]);
  }
  const AREA_KM = 15;
  // Places in groups a day's travel apart: anything within AREA_KM of a
  // place in a group joins it. Each group is named after the town most of
  // its addresses give, else "Near" its most central place, and is in
  // walking order: from one end, always to the nearest place not yet seen.
  // Places with no location join the town their address names, else "No
  // location" at the end.
  function areas(places) {
    const located = places.filter((p) => p.lat != null && p.lng != null);
    const parent = located.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < located.length; i++)
      for (let j = i + 1; j < located.length; j++)
        if (distanceKm(located[i], located[j]) <= AREA_KM) parent[root(i)] = root(j);
    const groups = new Map();
    located.forEach((p, i) => { const k = root(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    const out = [...groups.values()].map((list) => {
      const towns = new Map();
      for (const p of list) { const t = townOf(p.address); if (t) towns.set(t, (towns.get(t) || 0) + 1); }
      const town = [...towns.entries()].sort((a, b) => b[1] - a[1])[0];
      const c = { lat: list.reduce((s, p) => s + p.lat, 0) / list.length, lng: list.reduce((s, p) => s + p.lng, 0) / list.length };
      const central = list.slice().sort((a, b) => distanceKm(a, c) - distanceKm(b, c))[0];
      return { name: town ? town[0] : "Near " + central.name, places: walkOrder(list, c) };
    });
    const rest = [];
    for (const p of places) {
      if (p.lat != null && p.lng != null) continue;
      const t = townOf(p.address), g = t && out.find((a) => a.name === t);
      (g ? g.places : rest).push(p);
    }
    out.sort((a, b) => b.places.length - a.places.length || a.name.localeCompare(b.name));
    if (rest.length) out.push({ name: "No location", places: rest });
    return out;
  }
  function walkOrder(list, centre) {
    if (list.length < 3) return list.slice();
    const left = list.slice();
    // Start at the place furthest from the middle, so the walk runs end to end.
    left.sort((a, b) => distanceKm(b, centre) - distanceKm(a, centre));
    const path = [left.shift()];
    while (left.length) {
      const last = path[path.length - 1];
      let best = 0;
      for (let i = 1; i < left.length; i++) if (distanceKm(last, left[i]) < distanceKm(last, left[best])) best = i;
      path.push(left.splice(best, 1)[0]);
    }
    return path;
  }

  // ---------- the document ----------
  let doc = null, loading = null, loadedAt = 0, loadError = null;
  let saveTimer = null, saving = null, changedSince = 0, lastSent = null;
  const trips = () => (doc ? doc.trips : []);
  const placesOf = (tripId) => (doc ? doc.places.filter((p) => p.trip === tripId) : []);
  const findTrip = (id) => trips().find((t) => t.id === id);
  const findPlace = (id) => (doc ? doc.places.find((p) => p.id === id) : null);
  const today = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };

  function ensureLoaded(force) {
    if (doc && !force) return Promise.resolve(doc);
    if (loading) return loading;
    loading = Storage.travel.load().then(({ doc: d, dirty }) => {
      d = sanitizeDoc(d);
      // Anything changed while the load was out is kept, merged over what
      // came back with what this device last sent as the ancestor.
      doc = doc && changedSince ? sanitizeDoc(window.LifeLogMerge.mergeTravel(lastSent, doc, d)) : d;
      loadedAt = Date.now(); loadError = null;
      if (dirty) scheduleSave(0);
      return doc;
    }).catch((e) => { loadError = e; if (!doc) doc = { trips: [], places: [] }; return doc; })
      .finally(() => { loading = null; });
    return loading;
  }

  function changed(item) {
    if (item) item.updatedAt = new Date().toISOString();
    changedSince++;
    scheduleSave(800);
  }
  function scheduleSave(ms) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, ms);
  }
  async function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!doc) return;
    if (saving) { await saving; if (!changedSince) return; }
    const sent = JSON.parse(JSON.stringify(doc));
    const mark = changedSince;
    saving = Storage.travel.save(sent).then((res) => {
      if (res.merged) {
        // Another device saved first and got merged in. Take the merge, and
        // keep whatever changed here while the save was out.
        doc = sanitizeDoc(changedSince !== mark ? window.LifeLogMerge.mergeTravel(sent, doc, res.doc) : res.doc);
        if (state.view === "travel") render({ keepSnapshots: true });
      }
      lastSent = sent;
      if (changedSince === mark) changedSince = 0;
    }).catch(() => {}).finally(() => { saving = null; });
    await saving;
    if (changedSince) scheduleSave(800);
  }

  // ---------- which trip is shown (this device's, like the tab you're on) ----------
  const UI_KEY = "lifelog-travel-ui";
  // A trip's three ways to look at it: the tab's modes (app.js VIEW_MODES).
  const MODES = [["time", "By time", "◷"], ["area", "By area", "◎"], ["map", "Map", "⌖"]];
  const mode = () => (state && state.travelMode) || "time";
  let openTripId = null;
  // The map's day ("all", a date, or "" for no day), the place picked on it,
  // and whether the rows are out to be dragged: all for this visit only.
  let mapDay = "all", selectedId = null, arranging = false;
  try { openTripId = JSON.parse(localStorage.getItem(UI_KEY) || "{}").trip || null; } catch (e) {}
  function setOpenTrip(id) {
    openTripId = id || null;
    mapDay = "all"; selectedId = null; arranging = false;
    try { localStorage.setItem(UI_KEY, JSON.stringify({ trip: openTripId })); } catch (e) {}
  }
  // The trip picked in the chips, else the one under way or coming up next.
  const openTrip = () => (openTripId && findTrip(openTripId)) || sortTrips(trips(), today())[0] || null;
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ---------- the tab ----------
  function renderTravel(c) {
    if (!doc) {
      syncTripChips(null);
      c.appendChild(el("p", "travel-loading muted", "Loading your trips…"));
      ensureLoaded().then(() => { if (state.view === "travel") render(); });
      return;
    }
    // Picks up another device's changes on the way in, at most once a minute.
    // Not while rows are out to be dragged: a refill would drop one mid-drag.
    if (Date.now() - loadedAt > 60000 && !changedSince && !loading && !arranging) {
      ensureLoaded(true).then(() => { if (state.view === "travel") render({ keepSnapshots: true }); });
    }
    if (mode() !== "time") arranging = false;
    const trip = openTrip();
    syncTripChips(trip);
    if (trip) { renderTrip(c, trip); return; }
    c.appendChild(emptyState({
      glyph: "✈︎",
      title: "No trips yet",
      body: "Plan a trip: the places you want to go, and which day you'll go to each — as tightly or as loosely as you like.",
      action: "Plan a trip",
      onAction: () => openTripModal(null),
    }));
    if (loadError) c.appendChild(el("p", "hint", "Couldn't reach GitHub — showing the trips saved on this device"));
  }

  // The trips are the tab's chip row (0.243.0), where the other tabs have
  // their years and categories: one is shown at a time, ✎ edits it, + adds
  // one. Under way and coming up first, past ones last (sortTrips).
  function syncTripChips(shown) {
    const group = $("#tripFilterGroup"), wrap = $("#tripFilter");
    if (!group || !wrap) return;
    const list = doc ? sortTrips(trips(), today()) : [];
    group.hidden = !list.length;
    wrap.replaceChildren();
    for (const trip of list) {
      const chip = el("span", "cat-chip trip-chip" + (shown && trip.id === shown.id ? " on" : ""));
      activatable(chip, () => {
        if (shown && trip.id === shown.id) return;
        setOpenTrip(trip.id);
        render();
        window.scrollTo(0, 0);
      });
      chip.setAttribute("aria-pressed", String(!!(shown && trip.id === shown.id)));
      const status = tripStatus(trip, today());
      if (status === "now") chip.appendChild(el("span", "dot trip-now-dot"));
      chip.appendChild(document.createTextNode(trip.name));
      const edit = el("span", "chip-edit", "✎");
      edit.title = "Edit trip";
      activatable(edit, (ev) => { ev.stopPropagation(); openTripModal(trip); }, "Edit trip " + trip.name);
      chip.appendChild(edit);
      wrap.appendChild(chip);
    }
    const add = el("span", "cat-chip add-chip", "+");
    add.title = "Plan a trip";
    activatable(add, (ev) => { ev.stopPropagation(); openTripModal(null); }, "Plan a trip");
    wrap.appendChild(add);
    updateFilterbarVisibility();
  }
  const placesCount = (n) => (n === 1 ? "1 place" : `${n} places`);
  function whenLabel(trip) {
    const status = tripStatus(trip, today());
    if (status === "now") return "under way";
    if (status !== "upcoming") return "";
    const n = dayNum(trip.start) - dayNum(today());
    return n === 1 ? "tomorrow" : `in ${n} days`;
  }

  function renderTrip(c, trip) {
    const places = placesOf(trip.id);
    const head = el("div", "trip-meta");
    const when = whenLabel(trip);
    head.appendChild(el("p", "trip-range", [rangeLabel(trip.start, trip.end) || "No dates yet", placesCount(places.length), when].filter(Boolean).join(" · ")));
    if (arranging) {
      head.appendChild(el("span", "trip-sort-hint", "Drag a place into order, or onto another day"));
      const done = el("button", "btn btn-sm btn-primary", "Done");
      done.type = "button";
      done.onclick = () => { arranging = false; render({ keepSnapshots: true }); };
      head.appendChild(done);
      head.classList.add("is-sorting");
    } else {
      const imp = el("button", "btn btn-sm trip-import", "⇣ Import");
      imp.type = "button";
      imp.title = "Import from Google Maps";
      imp.onclick = () => openImportModal(trip);
      head.appendChild(imp);
    }
    c.appendChild(head);

    if (!places.length && !trip.start) {
      const empty = emptyState({
        glyph: "⌖",
        title: "No places yet",
        body: "Add the places you want to go, or bring them in from a list you saved in Google Maps. Give one a day to plan it, and a time to schedule it.",
        action: "Add a place",
        onAction: () => openPlaceModal(null, { trip: trip.id }),
      });
      const fromGoogle = el("button", "btn trip-empty-import", "⇣ Import from Google Maps");
      fromGoogle.type = "button";
      fromGoogle.onclick = () => openImportModal(trip);
      empty.appendChild(fromGoogle);
      c.appendChild(empty);
      return;
    }
    if (mode() === "area") renderAreas(c, trip, places);
    else if (mode() === "map") renderMapMode(c, trip, places);
    else {
      const wrap = el("div", "trip-days" + (arranging ? " is-arranging" : ""));
      for (const card of dayCards(trip, places, null)) wrap.appendChild(card);
      c.appendChild(wrap);
    }
  }

  // The day cards: every day of the trip and No day yet, or with `only` set
  // (the map's day) just that one, its rows numbered as its pins are.
  function dayCards(trip, places, only) {
    const days = tripDays(trip, places);
    const cards = [];
    days.forEach((day, i) => {
      if (only != null && only !== day) return;
      const inDay = sortDay(places.filter((p) => p.day === day));
      const outside = (trip.start && day < trip.start) || (trip.end && day > trip.end);
      const label = `Day ${i + 1} · ${dayLabel(day)}` + (outside ? " (outside the trip)" : "");
      cards.push(dayCard(trip, label, inDay, day, only != null));
    });
    if (only == null || only === "") cards.push(dayCard(trip, "No day yet", sortDay(places.filter((p) => !p.day)), "", only != null));
    return cards;
  }

  function dayCard(trip, label, places, day, numbered) {
    const card = el("section", "month-card trip-day");
    card.dataset.day = day;
    if (day === today()) card.classList.add("is-today");
    card.appendChild(monthCardHeader(label, places.length, [], arranging ? {} : { onAdd: () => openPlaceModal(null, { trip: trip.id, day }) }));
    if (!places.length) {
      if (!arranging) card.appendChild(el("p", "trip-day-empty", day ? "Nothing planned yet" : "Every place has a day"));
      return card;
    }
    places.forEach((p, i) => card.appendChild(placeRow(p, { num: numbered ? i + 1 : null })));
    return card;
  }

  // By area: the trip's places grouped by where they are, each group in an
  // order you could walk it, each row saying which day it's on.
  function renderAreas(c, trip, places) {
    const days = tripDays(trip, places);
    const wrap = el("div", "trip-days");
    for (const area of areas(places)) {
      const card = el("section", "month-card trip-day trip-area");
      card.appendChild(monthCardHeader(area.name, area.places.length, [], {}));
      for (const p of area.places) {
        const tag = p.day ? `Day ${days.indexOf(p.day) + 1}` + (p.time ? " · " + p.time : "") : "No day";
        card.appendChild(placeRow(p, { tag }));
      }
      wrap.appendChild(card);
    }
    c.appendChild(wrap);
  }

  function placeRow(p, ctx) {
    ctx = ctx || {};
    const row = el("div", "entry place-row");
    row.dataset.id = p.id;
    if (p.visited) row.classList.add("is-visited");
    if (arranging) {
      row.classList.add("is-arrange", "no-swipe");
      if (p.time) row.appendChild(el("span", "place-time", timeLabel(p)));
      const body = el("span", "place-body");
      body.appendChild(el("span", "place-name", p.name));
      row.appendChild(body);
      const grip = el("span", "place-grip", "⠿");
      grip.setAttribute("aria-hidden", "true");
      row.appendChild(grip);
      row.addEventListener("pointerdown", (ev) => beginDrag(ev, row));
      return row;
    }
    const tick = el("button", "place-tick", p.visited ? "✓" : "");
    tick.type = "button";
    tick.setAttribute("aria-label", p.visited ? `Mark ${p.name} as not visited` : `Mark ${p.name} as visited`);
    tick.setAttribute("aria-pressed", p.visited ? "true" : "false");
    tick.onclick = (ev) => {
      ev.stopPropagation();
      if (p.visited) delete p.visited; else p.visited = true;
      changed(p);
      render({ keepSnapshots: true });
    };
    row.appendChild(tick);
    if (ctx.num != null) row.appendChild(el("span", "place-num", String(ctx.num)));
    if (ctx.tag) row.appendChild(el("span", "place-time place-tag" + (p.day ? "" : " is-loose"), ctx.tag));
    else if (p.time) row.appendChild(el("span", "place-time", timeLabel(p)));
    const body = el("span", "place-body");
    body.appendChild(el("span", "place-name", p.name));
    const meta = [p.address, p.note].filter(Boolean).join(" · ");
    if (meta) body.appendChild(el("span", "place-meta", meta));
    row.appendChild(body);
    const go = el("a", "place-go", "↗");
    go.href = mapsUrl(p);
    go.target = "_blank";
    go.rel = "noopener";
    go.title = "Open in Google Maps";
    go.setAttribute("aria-label", `Open ${p.name} in Google Maps`);
    go.onclick = (ev) => ev.stopPropagation();
    row.appendChild(go);
    if (mode() === "map" && p.id === selectedId) row.classList.add("is-selected");
    // On the map, the first tap finds it there and a second opens it.
    row.onclick = () => {
      if (mode() === "map" && p.lat != null && selectedId !== p.id) selectPlace(p.id, "row");
      else openPlaceModal(p);
    };
    if (mode() === "time") attachLongPress(row);
    return row;
  }

  // ---------- arranging: drag rows into order, or onto another day ----------
  // A long press on a row (the To-do list's gesture) puts every row out with
  // a grip, until Done; then a row follows the finger across
  // the day cards. Listeners on the window, not a pointer capture, because
  // moving the row in the DOM drops a capture (NOTES.md, the To-do list).
  const LONG_PRESS_MS = 500;
  function attachLongPress(row) {
    let timer = null, start = null;
    const cancel = () => { clearTimeout(timer); timer = null; start = null; };
    row.addEventListener("pointerdown", (ev) => {
      if (ev.button > 0 || ev.target.closest(".place-tick, .place-go")) return;
      start = { x: ev.clientX, y: ev.clientY };
      timer = setTimeout(() => {
        timer = null;
        arranging = true;
        if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) {}
        render({ keepSnapshots: true });
      }, LONG_PRESS_MS);
    });
    row.addEventListener("pointermove", (ev) => {
      if (start && (Math.abs(ev.clientX - start.x) > 10 || Math.abs(ev.clientY - start.y) > 10)) cancel();
    });
    row.addEventListener("pointerup", cancel);
    row.addEventListener("pointercancel", cancel);
  }

  function beginDrag(ev, row) {
    if (ev.button > 0) return;
    ev.preventDefault();
    row.classList.add("is-dragging");
    let x = ev.clientX, y = ev.clientY, raf = 0;
    const css = getComputedStyle(document.documentElement);
    const top = (parseFloat(css.getPropertyValue("--topbar-h")) || 0) + 56;
    const bottom = window.innerHeight - (parseFloat(css.getPropertyValue("--bottombar-h")) || 0) - 56;
    const moveRow = () => {
      const under = document.elementFromPoint(x, y);
      const card = under && under.closest(".trip-day[data-day]");
      if (!card) return;
      const rows = [...card.querySelectorAll(".place-row")].filter((r) => r !== row);
      const before = rows.find((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
      if (before) { if (before.previousElementSibling !== row) card.insertBefore(row, before); }
      else if (card.lastElementChild !== row) card.appendChild(row);
    };
    // Near the top or bottom of the screen the page scrolls, so a place can
    // go to a day that's out of sight.
    const tick = () => {
      const step = y < top ? -12 : y > bottom ? 12 : 0;
      if (step) { window.scrollBy(0, step); moveRow(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onMove = (e) => { if (e.pointerId !== ev.pointerId) return; x = e.clientX; y = e.clientY; moveRow(); };
    const onUp = (e) => {
      if (e.pointerId !== ev.pointerId) return;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      row.classList.remove("is-dragging");
      commitArrange();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // Each card's rows as they now stand: a place that changed card takes that
  // day (no day drops its time), and the unscheduled ones take their order.
  // Scheduled ones keep going by their time.
  function commitArrange() {
    let moved = 0;
    for (const card of document.querySelectorAll(".trip-day[data-day]")) {
      const day = card.dataset.day;
      let order = 0;
      for (const r of card.querySelectorAll(".place-row")) {
        const p = findPlace(r.dataset.id);
        if (!p) continue;
        const next = { ...p };
        if ((p.day || "") !== day) {
          if (day) next.day = day;
          else { delete next.day; delete next.time; delete next.endTime; }
        }
        if (!next.time) next.order = order++;
        const clean = sanitizePlace(next);
        if (["day", "time", "endTime", "order"].every((k) => clean[k] === p[k])) continue;
        for (const k of Object.keys(p)) if (!(k in clean)) delete p[k];
        Object.assign(p, clean);
        changed(p);
        moved++;
      }
    }
    render({ keepSnapshots: true });
    return moved;
  }

  // Escape, like Done. True when there was a sort to end.
  function endSort() {
    if (!arranging) return false;
    arranging = false;
    render({ keepSnapshots: true });
    return true;
  }

  // ---------- the map (Leaflet, loaded the first time it's wanted) ----------
  // Tiles are CARTO's basemaps from OpenStreetMap data: free for
  // non-commercial use with the credit shown, with a dark set for the dark
  // themes. OpenStreetMap's own tile server asks apps not to use it.
  const TILES = {
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  };
  const TILE_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
  let leaflet = null, map = null, mapEl = null, tiles = null, tilesDark = null, pinLayer = null, lastFit = "";
  const pins = new Map();
  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leaflet) return leaflet;
    leaflet = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "src/vendor/leaflet.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = "src/vendor/leaflet.js";
      js.onload = () => resolve(window.L);
      js.onerror = () => { leaflet = null; css.remove(); js.remove(); reject(new Error("leaflet")); };
      document.head.appendChild(js);
    });
    return leaflet;
  }
  // One map for the life of the page, moved into each render's layout, so a
  // re-render doesn't reload its tiles.
  function mapNode() {
    if (!mapEl) {
      mapEl = el("div", "trip-map");
      mapEl.setAttribute("role", "region");
      mapEl.setAttribute("aria-label", "Map of the trip's places");
    }
    return mapEl;
  }

  function renderMapMode(c, trip, places) {
    const days = tripDays(trip, places);
    if (mapDay !== "all" && mapDay !== "" && !days.includes(mapDay)) mapDay = "all";
    if (mapDay === "" && !places.some((p) => !p.day)) mapDay = "all";
    const layout = el("div", "trip-map-layout");
    const side = el("div", "trip-map-side no-swipe");
    const chips = el("div", "trip-map-days");
    const chip = (key, label) => {
      const b = el("button", "cat-chip" + (mapDay === key ? " on" : ""), label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(mapDay === key));
      b.onclick = () => { mapDay = key; selectedId = null; render({ keepSnapshots: true }); };
      chips.appendChild(b);
    };
    chip("all", "All days");
    days.forEach((d, i) => chip(d, `Day ${i + 1}`));
    if (places.some((p) => !p.day)) chip("", "No day");
    side.appendChild(chips);
    side.appendChild(mapNode());
    layout.appendChild(side);

    const one = mapDay !== "all";
    const shown = one ? sortDay(places.filter((p) => (p.day || "") === mapDay)) : places;
    const points = [];
    shown.forEach((p, i) => {
      if (p.lat == null) return;
      const label = one ? String(i + 1) : (p.day ? String(days.indexOf(p.day) + 1) : "·");
      points.push({ place: p, label });
    });
    const list = el("div", "trip-days trip-map-list");
    for (const card of dayCards(trip, places, one ? mapDay : null)) list.appendChild(card);
    layout.appendChild(list);
    if (!points.length) side.appendChild(el("p", "trip-map-none", "None of these places has a location — places from Google Maps do"));
    c.appendChild(layout);
    drawMap(points, one ? points.map((pt) => [pt.place.lat, pt.place.lng]) : [], (one ? mapDay : "all") + ":" + points.map((pt) => pt.place.id).join(","));
  }

  function drawMap(points, route, fitKey) {
    const node = mapNode();
    if (!window.L || !window.L.map) {
      loadLeaflet()
        .then(() => { if (state.view === "travel" && mode() === "map") render({ keepSnapshots: true }); })
        .catch(() => { node.textContent = ""; node.appendChild(el("p", "trip-map-none", "Couldn't load the map — check your connection")); });
      return;
    }
    const L = window.L;
    if (!map) {
      node.textContent = "";
      map = L.map(node, { worldCopyJump: true, zoomSnap: 0.5 });
      map.setView([30, 10], 2);
      pinLayer = L.layerGroup().addTo(map);
    }
    const dark = !document.documentElement.classList.contains("theme-light");
    if (!tiles || tilesDark !== dark) {
      if (tiles) tiles.remove();
      tiles = L.tileLayer(dark ? TILES.dark : TILES.light, { attribution: TILE_CREDIT, subdomains: "abcd", maxZoom: 20 }).addTo(map);
      tilesDark = dark;
    }
    pinLayer.clearLayers();
    pins.clear();
    if (route.length > 1) pinLayer.addLayer(L.polyline(route, { className: "trip-route", interactive: false }));
    for (const { place: p, label } of points) {
      const icon = L.divIcon({
        className: "trip-pin" + (p.visited ? " is-visited" : "") + (p.id === selectedId ? " is-selected" : ""),
        html: el("span", null, label), iconSize: [28, 28], iconAnchor: [14, 14],
      });
      const m = L.marker([p.lat, p.lng], { icon, title: p.name, alt: p.name, riseOnHover: true, zIndexOffset: p.id === selectedId ? 1000 : 0 });
      m.on("click", () => selectPlace(p.id, "pin"));
      pinLayer.addLayer(m);
      pins.set(p.id, m);
    }
    // The node was just moved into a new layout: measure it again once it's
    // laid out, and frame the pins whenever which pins are shown changes.
    requestAnimationFrame(() => {
      if (!map) return;
      map.invalidateSize(false);
      if (fitKey === lastFit || !points.length) return;
      lastFit = fitKey;
      const ll = points.map((pt) => [pt.place.lat, pt.place.lng]);
      if (ll.length === 1) map.setView(ll[0], 15, { animate: false });
      else map.fitBounds(ll, { padding: [32, 32], maxZoom: 16, animate: false });
    });
  }

  // A pin and its row are one place: picking either marks both, and brings
  // the other into view.
  function selectPlace(id, from) {
    selectedId = id;
    for (const [pid, m] of pins) {
      const e = m.getElement();
      if (e) e.classList.toggle("is-selected", pid === id);
      m.setZIndexOffset(pid === id ? 1000 : 0);
    }
    let row = null;
    for (const r of document.querySelectorAll(".trip-map-list .place-row")) {
      r.classList.toggle("is-selected", r.dataset.id === id);
      if (r.dataset.id === id) row = r;
    }
    const m = pins.get(id);
    if (from === "row" && m && map) map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: !reducedMotion() });
    if (from === "pin" && row) row.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  // ---------- the import sheet: a Google Maps list or place into a trip ----------
  // Paste a link, see what it holds grouped by area, tick what belongs to
  // this trip. One list usually spans several trips, so nothing starts
  // ticked; a place that's already in the trip can't be added twice.
  const IMPORT_HINT = "A list brings all its places to choose from. A place brings just that one.";
  let importTrip = null, found = null, picks = [], importBusy = false;
  function openImportModal(trip) {
    importTrip = trip || openTrip();
    if (!importTrip) { openTripModal(null); return; }
    $("#importTripName").textContent = importTrip.name;
    $("#importLink").value = "";
    resetImport();
    $("#importPlacesModal").hidden = false;
    setTimeout(() => $("#importLink").focus(), 0);
  }
  function closeImportModal() { $("#importPlacesModal").hidden = true; importTrip = null; found = null; picks = []; }
  function resetImport() {
    found = null; picks = [];
    $("#importPick").hidden = true;
    $("#importPick").textContent = "";
    importHint(IMPORT_HINT);
    syncImportButton();
  }
  function importHint(msg, isErr) {
    const h = $("#importHint");
    h.textContent = msg;
    h.hidden = !msg;
    h.classList.toggle("is-error", !!isErr);
  }
  function syncImportButton() {
    const btn = $("#importGoBtn");
    if (!found) { btn.textContent = importBusy ? "Finding places…" : "Find places"; btn.disabled = importBusy; return; }
    const n = picks.filter((x) => x.on).length;
    btn.textContent = n ? `Add ${placesCount(n)}` : "Add places";
    btn.disabled = !n;
  }

  // The network half of fetchGoogle in the app: the proxy's two Google
  // routes. In the phone apps that "proxy" is the app's own native request
  // (platform.js), so only a browser needs one set up.
  async function appGet(kind, arg) {
    const P = window.LifeLogPlatform;
    const steam = (state.data.settings && state.data.settings.steam) || {};
    const proxy = P ? P.steamProxy(steam.proxyUrl) : "";
    if (!proxy) throw new Error("A browser can't read Google Maps lists by itself — add the proxy URL in Settings → Media, or import from the phone app");
    let res;
    try { res = await fetch(proxy + (kind === "resolve" ? "/gmaps-link/" : "/gmaps-list/") + encodeURIComponent(arg)); }
    catch (e) { throw new Error("Couldn't reach Google Maps — check your connection and try again"); }
    if (!res.ok) {
      throw new Error(kind === "resolve"
        ? "Couldn't open that link — copy it again from Share in Google Maps"
        : "Google Maps didn't send that list — check it's shared (Share → Copy link)");
    }
    if (kind === "resolve") return String((await res.json()).url || "");
    return res.text();
  }

  async function submitImport() {
    if (importBusy || !importTrip) return;
    if (found) { addPicked(); return; }
    importBusy = true;
    syncImportButton();
    importHint("");
    try {
      found = await fetchGoogle($("#importLink").value, appGet);
      showPicks();
    } catch (e) {
      found = null;
      importHint((e && e.message) || "Couldn't read that link", true);
    } finally {
      importBusy = false;
      syncImportButton();
    }
  }

  function showPicks() {
    const have = placesOf(importTrip.id);
    picks = found.places.map((p) => ({ p, had: have.some((h) => samePlace(h, p)), on: false }));
    if (picks.length === 1 && !picks[0].had) picks[0].on = true;
    const had = picks.filter((x) => x.had).length;
    if (!picks.length) importHint(`"${found.name}" has no places in it`, true);
    else if (picks.length === 1) importHint(had ? "That place is already in this trip" : "");
    else importHint(`${found.name}: ${placesCount(picks.length)}${had ? `, ${had} already in this trip` : ""}. Pick the ones for this trip.`);
    const box = $("#importPick");
    box.textContent = "";
    box.hidden = !picks.length;
    const byPlace = new Map(picks.map((x) => [x.p, x]));
    const groups = picks.length > 1 ? areas(found.places) : [{ name: "", places: found.places }];
    for (const g of groups) {
      const items = g.places.map((p) => byPlace.get(p));
      const group = el("div", "import-group");
      let all = null;
      if (g.name && groups.length > 1) {
        const row = el("label", "import-row import-all");
        all = el("input");
        all.type = "checkbox";
        row.appendChild(all);
        row.appendChild(el("span", "import-name", g.name));
        row.appendChild(el("span", "import-count", String(items.length)));
        group.appendChild(row);
      }
      const boxes = [];
      const syncAll = () => {
        if (!all) return;
        const open = items.filter((x) => !x.had);
        all.disabled = !open.length;
        all.checked = open.length ? open.every((x) => x.on) : true;
        all.indeterminate = open.some((x) => x.on) && !open.every((x) => x.on);
      };
      for (const x of items) {
        const row = el("label", "import-row");
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = x.had || x.on;
        cb.disabled = x.had;
        cb.onchange = () => { x.on = cb.checked; syncAll(); syncImportButton(); };
        boxes.push([cb, x]);
        row.appendChild(cb);
        const t = el("span", "import-text");
        t.appendChild(el("span", "import-name", x.p.name));
        const meta = x.had ? "Already in this trip" : [x.p.address, x.p.note].filter(Boolean).join(" · ");
        if (meta) t.appendChild(el("span", "import-meta", meta));
        row.appendChild(t);
        group.appendChild(row);
      }
      if (all) {
        all.onchange = () => {
          for (const [cb, x] of boxes) if (!x.had) { x.on = all.checked; cb.checked = all.checked; }
          syncAll(); syncImportButton();
        };
        syncAll();
      }
      box.appendChild(group);
    }
    syncImportButton();
  }

  function addPicked() {
    const trip = findTrip(importTrip.id);
    if (!trip || !found) return;
    const chosen = picks.filter((x) => x.on && !x.had).map((x) => x.p);
    if (!chosen.length) return;
    const now = new Date().toISOString();
    let order = nextOrder(trip.id, "");
    const added = chosen.map((g) => sanitizePlace({
      ...g, id: newId(), trip: trip.id, order: order++, createdAt: now,
      source: found.source || undefined, url: found.url || undefined,
    }));
    doc.places.push(...added);
    for (const p of added) changed(p);
    closeImportModal();
    if (openTripId !== trip.id) setOpenTrip(trip.id);
    render({ keepSnapshots: true });
    toast(`Added ${placesCount(added.length)} — they're under No day yet`, false, {
      label: "Undo",
      onClick: () => {
        const ids = new Set(added.map((p) => p.id));
        doc.places = doc.places.filter((p) => !ids.has(p.id));
        changed();
        render({ keepSnapshots: true });
      },
    });
  }

  // The + menu's "From Google Maps": into the open trip, like its "Place".
  async function importPlaces() {
    await ensureLoaded();
    const trip = openTrip() || sortTrips(trips(), today())[0];
    if (!trip) { openTripModal(null); return; }
    if (state.view === "travel" && !openTrip()) { setOpenTrip(trip.id); render(); }
    openImportModal(trip);
  }

  // ---------- the trip sheet ----------
  let editingTrip = null;
  function openTripModal(trip) {
    editingTrip = trip || null;
    $("#tripModalTitle").textContent = trip ? "Edit trip" : "New trip";
    $("#tripName").value = trip ? trip.name : "";
    $("#tripStart").value = (trip && trip.start) || "";
    $("#tripEnd").value = (trip && trip.end) || "";
    $("#deleteTripBtn").hidden = !trip;
    $("#tripModal").hidden = false;
    setTimeout(() => $("#tripName").focus(), 0);
  }
  function closeTripModal() { $("#tripModal").hidden = true; editingTrip = null; }

  async function saveTripFromForm() {
    await ensureLoaded();
    const start = $("#tripStart").value, end = $("#tripEnd").value;
    const fields = { name: $("#tripName").value, start: start || undefined, end: end || start || undefined };
    if (editingTrip) {
      const t = findTrip(editingTrip.id);
      if (t) {
        const next = sanitizeTrip({ ...t, ...fields });
        for (const k of ["start", "end"]) if (!next[k]) delete t[k];
        Object.assign(t, next);
        changed(t);
      }
    } else {
      const now = new Date().toISOString();
      const t = sanitizeTrip({ ...fields, id: newId(), createdAt: now });
      doc.trips.push(t);
      changed(t);
      setOpenTrip(t.id);
    }
    closeTripModal();
    render();
  }

  function deleteTrip(trip) {
    const t = findTrip(trip.id);
    if (!t) return;
    const gone = { trip: t, places: placesOf(t.id) };
    doc.trips = doc.trips.filter((x) => x.id !== t.id);
    doc.places = doc.places.filter((p) => p.trip !== t.id);
    changed();
    setOpenTrip(null);
    closeTripModal();
    render();
    toast(`Deleted "${t.name}"`, false, {
      label: "Undo",
      onClick: () => {
        doc.trips.push(gone.trip);
        doc.places.push(...gone.places);
        changed(gone.trip);
        setOpenTrip(gone.trip.id);
        render();
      },
    });
  }

  // ---------- the place sheet ----------
  let editingPlace = null, placeTrip = null;
  function openPlaceModal(place, opts) {
    opts = opts || {};
    editingPlace = place || null;
    placeTrip = findTrip(place ? place.trip : opts.trip) || openTrip();
    if (!placeTrip) { openTripModal(null); return; }
    const p = place || { day: opts.day || "" };
    $("#placeModalTitle").textContent = place ? "Edit place" : "Add a place";
    $("#placeTripName").textContent = placeTrip.name;
    $("#placeName").value = p.name || "";
    $("#placeDay").value = p.day || "";
    $("#placeDay").min = placeTrip.start || "";
    $("#placeDay").max = placeTrip.end || "";
    $("#placeTime").value = p.time || "";
    $("#placeEndTime").value = p.endTime || "";
    $("#placeAddress").value = p.address || "";
    $("#placeUrl").value = p.url || "";
    $("#placeNote").value = p.note || "";
    $("#placeVisited").checked = !!p.visited;
    syncTimeFields();
    $("#deletePlaceBtn").hidden = !place;
    $("#placeModal").hidden = false;
    setTimeout(() => $("#placeName").focus(), 0);
  }
  function closePlaceModal() { $("#placeModal").hidden = true; editingPlace = null; placeTrip = null; }
  // A time is for a day: without one the time fields wait, rather than take
  // a time the save would then throw away.
  function syncTimeFields() {
    const hasDay = !!$("#placeDay").value;
    $("#placeTime").disabled = !hasDay;
    $("#placeEndTime").disabled = !hasDay || !$("#placeTime").value;
    $("#placeTimeHint").hidden = hasDay;
  }

  async function savePlaceFromForm() {
    await ensureLoaded();
    if (!placeTrip) return;
    const fields = {
      name: $("#placeName").value, day: $("#placeDay").value, time: $("#placeTime").value,
      endTime: $("#placeEndTime").value, address: $("#placeAddress").value, url: $("#placeUrl").value,
      note: $("#placeNote").value, visited: $("#placeVisited").checked,
    };
    if (editingPlace) {
      const p = findPlace(editingPlace.id);
      if (p) {
        // A place moved to another day joins the end of that day's list.
        const moved = p.day !== (fields.day || undefined);
        const next = sanitizePlace({ ...p, ...fields, order: moved ? nextOrder(p.trip, fields.day) : p.order });
        for (const k of Object.keys(p)) if (!(k in next)) delete p[k];
        Object.assign(p, next);
        changed(p);
      }
    } else {
      const now = new Date().toISOString();
      const p = sanitizePlace({ ...fields, id: newId(), trip: placeTrip.id, order: nextOrder(placeTrip.id, fields.day), createdAt: now });
      doc.places.push(p);
      changed(p);
    }
    closePlaceModal();
    render({ keepSnapshots: true });
  }
  function nextOrder(tripId, day) {
    const same = placesOf(tripId).filter((p) => (p.day || "") === (day || "") && p.order != null);
    return same.length ? Math.max(...same.map((p) => p.order)) + 1 : 0;
  }

  function deletePlace(place) {
    const p = findPlace(place.id);
    if (!p) return;
    doc.places = doc.places.filter((x) => x.id !== p.id);
    changed();
    closePlaceModal();
    render({ keepSnapshots: true });
    toast(`Removed "${p.name}"`, false, {
      label: "Undo",
      onClick: () => { doc.places.push(p); changed(p); render({ keepSnapshots: true }); },
    });
  }

  // The + menu's "Place": into the trip that's open, else the next one
  // coming up, else a new trip first.
  async function addPlace() {
    await ensureLoaded();
    const trip = openTrip() || sortTrips(trips(), today())[0];
    if (!trip) { openTripModal(null); return; }
    if (state.view === "travel" && !openTrip()) { setOpenTrip(trip.id); render(); }
    openPlaceModal(null, { trip: trip.id });
  }
  async function addTrip() { await ensureLoaded(); openTripModal(null); }

  function wire() {
    $("#tripForm").addEventListener("submit", (e) => { e.preventDefault(); saveTripFromForm(); });
    $("#cancelTripBtn").onclick = closeTripModal;
    $("#deleteTripBtn").onclick = () => { if (editingTrip) deleteTrip(editingTrip); };
    // An end date that hasn't been set yet starts from the start date's
    // month, rather than today's, when its picker opens.
    $("#tripStart").addEventListener("change", () => {
      const s = $("#tripStart").value, e = $("#tripEnd");
      e.min = s || "";
      if (s && (!e.value || e.value < s)) e.value = s;
    });
    $("#placeForm").addEventListener("submit", (e) => { e.preventDefault(); savePlaceFromForm(); });
    $("#cancelPlaceBtn").onclick = closePlaceModal;
    $("#deletePlaceBtn").onclick = () => { if (editingPlace) deletePlace(editingPlace); };
    $("#placeDay").addEventListener("input", syncTimeFields);
    $("#placeTime").addEventListener("input", syncTimeFields);
    $("#importPlacesForm").addEventListener("submit", (e) => { e.preventDefault(); submitImport(); });
    $("#cancelImportBtn").onclick = closeImportModal;
    // A changed link is a new search: what was found for the old one goes.
    $("#importLink").addEventListener("input", () => { if (found) resetImport(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && saveTimer) flush(); });
    window.addEventListener("pagehide", () => { if (saveTimer) flush(); });
  }

  // For Settings' export: what travel.json holds.
  async function tripsForExport() { await ensureLoaded(); return JSON.parse(JSON.stringify(doc)); }

  const api = {
    MODES, init, wire, renderTravel, endSort, ensureLoaded, flush, addTrip, addPlace, tripsForExport,
    openTripModal, closeTripModal, openPlaceModal, closePlaceModal, openImportModal, closeImportModal, importPlaces,
    // pure, for tests and the bridge
    sanitizeTrip, sanitizePlace, sanitizeDoc, tripDays, sortDay, tripStatus, sortTrips,
    dayLabel, rangeLabel, timeLabel, mapsUrl,
    googleListId, googleShortCode, googleListUrl, gidOf, parseGoogleList, parseGooglePlaceUrl, fetchGoogle,
    samePlace, distanceKm, townOf, areas,
  };
  if (typeof window !== "undefined") window.LifeLogTravel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
