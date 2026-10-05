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
  let state, $, el, uid, toast, emptyState, render, Storage, monthCardHeader;

  function init(ctx) {
    ({ state, $, el, uid, toast, emptyState, render, Storage, monthCardHeader } = ctx);
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

  // Where "Open in Google Maps" goes: the link you gave it, else its
  // coordinates, else a search for its name and address.
  function mapsUrl(p) {
    if (p.url) return p.url;
    if (p.lat != null && p.lng != null) return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([p.name, p.address].filter(Boolean).join(", "));
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

  // ---------- which trip is open (this device's, like the tab you're on) ----------
  const UI_KEY = "lifelog-travel-ui";
  let openTripId = null;
  try { openTripId = JSON.parse(localStorage.getItem(UI_KEY) || "{}").trip || null; } catch (e) {}
  function setOpenTrip(id) {
    openTripId = id || null;
    try { localStorage.setItem(UI_KEY, JSON.stringify({ trip: openTripId })); } catch (e) {}
  }
  const openTrip = () => (openTripId ? findTrip(openTripId) : null);

  // ---------- the tab ----------
  function renderTravel(c) {
    if (!doc) {
      c.appendChild(el("p", "travel-loading muted", "Loading your trips…"));
      ensureLoaded().then(() => { if (state.view === "travel") render(); });
      return;
    }
    // Picks up another device's changes on the way in, at most once a minute.
    if (Date.now() - loadedAt > 60000 && !changedSince && !loading) {
      ensureLoaded(true).then(() => { if (state.view === "travel") render({ keepSnapshots: true }); });
    }
    const trip = openTrip();
    if (trip) renderTrip(c, trip);
    else { if (openTripId) setOpenTrip(null); renderTripList(c); }
  }

  function renderTripList(c) {
    if (!trips().length) {
      c.appendChild(emptyState({
        glyph: "✈︎",
        title: "No trips yet",
        body: "Plan a trip: the places you want to go, and which day you'll go to each — as tightly or as loosely as you like.",
        action: "Plan a trip",
        onAction: () => openTripModal(null),
      }));
      if (loadError) c.appendChild(el("p", "hint", "Couldn't reach GitHub — showing the trips saved on this device"));
      return;
    }
    const t0 = today();
    const list = el("div", "trip-list");
    for (const trip of sortTrips(trips(), t0)) {
      const places = placesOf(trip.id);
      const card = el("button", "trip-card");
      card.type = "button";
      const head = el("span", "trip-card-head");
      head.appendChild(el("span", "trip-card-name", trip.name));
      const status = tripStatus(trip, t0);
      if (status === "now") head.appendChild(el("span", "trip-badge is-now", "Now"));
      else if (status === "upcoming") {
        const n = dayNum(trip.start) - dayNum(t0);
        head.appendChild(el("span", "trip-badge", n === 1 ? "Tomorrow" : `In ${n} days`));
      }
      card.appendChild(head);
      const meta = [rangeLabel(trip.start, trip.end) || "No dates yet", placesCount(places.length)];
      const planned = new Set(places.filter((p) => p.day).map((p) => p.day)).size;
      if (planned) meta.push(planned === 1 ? "1 day planned" : `${planned} days planned`);
      card.appendChild(el("span", "trip-card-meta", meta.join(" · ")));
      card.onclick = () => { setOpenTrip(trip.id); render(); window.scrollTo(0, 0); };
      list.appendChild(card);
    }
    c.appendChild(list);
  }
  const placesCount = (n) => (n === 1 ? "1 place" : `${n} places`);

  function renderTrip(c, trip) {
    const places = placesOf(trip.id);
    const head = el("div", "trip-head");
    const back = el("button", "btn trip-back", "‹ Trips");
    back.type = "button";
    back.onclick = () => { setOpenTrip(null); render(); };
    head.appendChild(back);
    const titles = el("div", "trip-titles");
    titles.appendChild(el("h2", "trip-name", trip.name));
    titles.appendChild(el("p", "trip-range", [rangeLabel(trip.start, trip.end) || "No dates yet", placesCount(places.length)].join(" · ")));
    head.appendChild(titles);
    const edit = el("button", "btn btn-icon", "✎");
    edit.type = "button";
    edit.title = "Edit trip";
    edit.setAttribute("aria-label", "Edit trip");
    edit.onclick = () => openTripModal(trip);
    head.appendChild(edit);
    c.appendChild(head);

    if (!places.length && !trip.start) {
      c.appendChild(emptyState({
        glyph: "⌖",
        title: "No places yet",
        body: "Add the places you want to go. Give one a day to plan it, and a time to schedule it.",
        action: "Add a place",
        onAction: () => openPlaceModal(null, { trip: trip.id }),
      }));
      return;
    }
    const days = tripDays(trip, places);
    const wrap = el("div", "trip-days");
    days.forEach((day, i) => {
      const inDay = sortDay(places.filter((p) => p.day === day));
      const outside = (trip.start && day < trip.start) || (trip.end && day > trip.end);
      const label = `Day ${i + 1} · ${dayLabel(day)}` + (outside ? " (outside the trip)" : "");
      wrap.appendChild(dayCard(trip, label, inDay, day));
    });
    const loose = sortDay(places.filter((p) => !p.day));
    wrap.appendChild(dayCard(trip, "No day yet", loose, ""));
    c.appendChild(wrap);
  }

  function dayCard(trip, label, places, day) {
    const card = el("section", "month-card trip-day");
    if (day === today()) card.classList.add("is-today");
    card.appendChild(monthCardHeader(label, places.length, [], { onAdd: () => openPlaceModal(null, { trip: trip.id, day }) }));
    if (!places.length) {
      card.appendChild(el("p", "trip-day-empty", day ? "Nothing planned yet" : "Every place has a day"));
      return card;
    }
    for (const p of places) card.appendChild(placeRow(p));
    return card;
  }

  function placeRow(p) {
    const row = el("div", "entry place-row");
    if (p.visited) row.classList.add("is-visited");
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
    if (p.time) row.appendChild(el("span", "place-time", timeLabel(p)));
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
    row.onclick = () => openPlaceModal(p);
    return row;
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
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && saveTimer) flush(); });
    window.addEventListener("pagehide", () => { if (saveTimer) flush(); });
  }

  // For Settings' export: what travel.json holds.
  async function tripsForExport() { await ensureLoaded(); return JSON.parse(JSON.stringify(doc)); }

  const api = {
    init, wire, renderTravel, ensureLoaded, flush, addTrip, addPlace, tripsForExport,
    openTripModal, closeTripModal, openPlaceModal, closePlaceModal,
    // pure, for tests and the bridge
    sanitizeTrip, sanitizePlace, sanitizeDoc, tripDays, sortDay, tripStatus, sortTrips,
    dayLabel, rangeLabel, timeLabel, mapsUrl,
  };
  if (typeof window !== "undefined") window.LifeLogTravel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
