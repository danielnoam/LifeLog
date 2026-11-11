// LifeLog — the Ledger's Investments mode: a watchlist of US stocks and ETFs,
// each with a price chart, an optional target price and note, and date pins
// to see how the price moved between them. Prices are in dollars only.
//
// The watchlist and its pins live in investments.json beside lifelog.json
// (Storage.invest), for the same reason travel.json does: a build older than
// this one merging lifelog.json would drop a root key it doesn't know, and
// that deletion would then win on every device. An older build never opens
// investments.json at all.
//
// Prices come from Tiingo with your own key, through the CORS proxy (or the
// app's native one). Each ticker's daily closes are kept on this device only,
// not synced: they're the service's data, can be fetched again, and would
// make every save of the watchlist heavy. A ticker is asked for once for its
// whole history, then only for the days since its last close.
(function () {
  const Dates = () => window.LifeLogDates || require("./dates.js");
  const ico = (n) => window.LifeLogIcons.svg(n);
  let state, $, el, uid, toast, emptyState, render, Storage, updateFilterbarVisibility, openSettings;

  function init(ctx) {
    ({ state, $, el, uid, toast, emptyState, render, Storage, updateFilterbarVisibility, openSettings } = ctx);
  }

  // ---------- pure: cleaning and price maths (test/invest.test.js) ----------
  const KNOWN_WATCH_KEYS = new Set(["id", "symbol", "name", "target", "note", "createdAt", "updatedAt"]);
  const KNOWN_PIN_KEYS = new Set(["id", "watch", "date", "label", "createdAt", "updatedAt"]);
  // Fields this build doesn't know are carried through, so a newer build's
  // additions survive an older one saving (the same rule as app.js's).
  function keepUnknown(src, out, known) {
    for (const key of Object.keys(src || {})) if (!known.has(key)) out[key] = src[key];
    return out;
  }
  const newId = () => (uid ? uid() : "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  const text = (v) => String(v == null ? "" : v).trim();
  // "brk.b" → "BRK.B". Letters, digits, dots and dashes: Tiingo's tickers.
  function cleanSymbol(s) {
    const t = text(s).toUpperCase();
    return /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(t) ? t : "";
  }
  function cleanPrice(v) {
    const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(/[$,\s]/g, ""));
    return isFinite(n) && n > 0 ? Math.round(n * 10000) / 10000 : null;
  }

  function sanitizeWatch(w) {
    w = w || {};
    const out = {
      id: w.id || newId(),
      symbol: cleanSymbol(w.symbol) || "?",
      createdAt: w.createdAt || null,
      updatedAt: w.updatedAt || w.createdAt || "1970-01-01T00:00:00.000Z",
    };
    const name = text(w.name);
    if (name) out.name = name.slice(0, 120);
    const target = cleanPrice(w.target);
    if (target) out.target = target;
    const note = text(w.note);
    if (note) out.note = note.slice(0, 500);
    return keepUnknown(w, out, KNOWN_WATCH_KEYS);
  }
  function sanitizePin(p) {
    p = p || {};
    const out = {
      id: p.id || newId(),
      watch: text(p.watch),
      date: isDay(p.date) ? p.date : "",
      createdAt: p.createdAt || null,
      updatedAt: p.updatedAt || p.createdAt || "1970-01-01T00:00:00.000Z",
    };
    const label = text(p.label);
    if (label) out.label = label.slice(0, 120);
    return keepUnknown(p, out, KNOWN_PIN_KEYS);
  }
  // Two devices each adding VOO before they synced would show it twice: the
  // one added first stays, and the other's pins move over to it. Pins whose
  // ticker is gone, or with no date, go.
  function sanitizeDoc(d) {
    d = d || {};
    const seen = new Map(), moved = new Map();
    const watchlist = [];
    const sorted = (Array.isArray(d.watchlist) ? d.watchlist : []).map(sanitizeWatch)
      .filter((w) => w.symbol !== "?");
    for (const w of sorted) {
      const first = seen.get(w.symbol);
      if (!first) { seen.set(w.symbol, w); watchlist.push(w); continue; }
      const keep = String(w.createdAt || "") < String(first.createdAt || "") ? w : first;
      const drop = keep === w ? first : w;
      if (keep === w) { watchlist[watchlist.indexOf(first)] = w; seen.set(w.symbol, w); }
      for (const k of ["name", "target", "note"]) if (keep[k] == null && drop[k] != null) keep[k] = drop[k];
      moved.set(drop.id, keep.id);
    }
    const ids = new Set(watchlist.map((w) => w.id));
    const pins = (Array.isArray(d.pins) ? d.pins : []).map(sanitizePin)
      .map((p) => (moved.has(p.watch) ? { ...p, watch: moved.get(p.watch) } : p))
      .filter((p) => p.date && ids.has(p.watch));
    return { watchlist, pins };
  }

  // A price series is [[day, close], …], oldest first.
  const RANGES = ["1M", "3M", "6M", "YTD", "1Y", "5Y", "Max"];
  function shiftDay(day, months) {
    const [y, m, d] = day.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + months, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(d, last));
    return t.toISOString().slice(0, 10);
  }
  // The first day a range covers, counted back from the last close.
  function rangeStart(range, lastDay) {
    if (!lastDay || range === "Max") return null;
    if (range === "YTD") return lastDay.slice(0, 4) + "-01-01";
    const months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "5Y": 60 }[range];
    return months ? shiftDay(lastDay, -months) : null;
  }
  // The closes a range shows, starting from the last close on or before its
  // first day, so "1Y" measures from a year ago even when that was a Sunday.
  function sliceRange(points, range) {
    if (!points || !points.length) return [];
    const start = rangeStart(range, points[points.length - 1][0]);
    if (!start) return points;
    let i = points.findIndex((p) => p[0] >= start);
    if (i < 0) return points.slice(-1);
    if (i > 0 && points[i][0] > start) i--;
    return points.slice(i);
  }
  // The close on a day, or the last one before it (a weekend, a holiday).
  // Null before the series starts.
  function priceOn(points, day) {
    if (!points || !points.length || !day || day < points[0][0]) return null;
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (points[mid][0] <= day) lo = mid; else hi = mid - 1;
    }
    return points[lo][1];
  }
  const changeOf = (from, to) => (from && to ? to / from - 1 : null);
  // A ticker's pins in date order, each with its price and the move from the
  // one before; then where it stands now against the last pin and the first.
  function pinSteps(pins, points) {
    const sorted = [...pins].sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const last = points && points.length ? points[points.length - 1] : null;
    let prev = null;
    const steps = sorted.map((p) => {
      const price = priceOn(points, p.date);
      const step = { pin: p, price, change: prev && prev.price != null && price != null ? changeOf(prev.price, price) : null, days: prev ? daysBetween(prev.pin.date, p.date) : null };
      prev = step;
      return step;
    });
    const first = steps.find((s) => s.price != null);
    return {
      steps,
      now: last && prev ? { day: last[0], price: last[1], change: prev.price != null ? changeOf(prev.price, last[1]) : null, days: daysBetween(prev.pin.date, last[0]) } : null,
      total: last && first && first !== prev ? changeOf(first.price, last[1]) : null,
      totalDays: last && first ? daysBetween(first.pin.date, last[0]) : null,
    };
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
  }
  function spanLabel(days) {
    if (days == null) return "";
    if (days < 1) return "the same day";
    if (days < 60) return days === 1 ? "1 day" : days + " days";
    if (days < 730) { const m = Math.round(days / 30.44); return m + (m === 1 ? " month" : " months"); }
    const y = days / 365.25;
    return (Math.round(y * 10) / 10) + " years";
  }
  const pct = (v) => (v == null ? "" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(Math.abs(v) < 0.01 ? 2 : 1) + "%");
  function usd(v) {
    if (v == null || !isFinite(v)) return "";
    const digits = Math.abs(v) < 1 ? 4 : 2;
    return (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
  }
  const signedUsd = (v) => (v == null ? "" : (v >= 0 ? "+" : "") + usd(v));

  // Tiingo's daily rows → [[day, close]]. The adjusted close, so a split
  // doesn't draw as a crash and a dividend counts as part of the return.
  function parseTiingo(rows) {
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const r of rows) {
      const day = r && typeof r.date === "string" ? r.date.slice(0, 10) : "";
      const close = r && (isFinite(r.adjClose) && r.adjClose > 0 ? +r.adjClose : isFinite(r.close) && r.close > 0 ? +r.close : null);
      if (isDay(day) && close) out.push([day, Math.round(close * 10000) / 10000]);
    }
    return out.sort((a, b) => a[0].localeCompare(b[0]));
  }
  // A split or a dividend in the new rows rewrites every adjusted close
  // before it, so the whole history is asked for again rather than patched.
  const rewritesHistory = (rows) => Array.isArray(rows) && rows.some((r) => r && ((+r.divCash || 0) > 0 || (r.splitFactor != null && +r.splitFactor !== 1)));
  // New closes laid over the kept ones: from the first new day on, the new.
  function joinSeries(old, fresh) {
    if (!old || !old.length) return fresh || [];
    if (!fresh || !fresh.length) return old;
    const from = fresh[0][0];
    return old.filter((p) => p[0] < from).concat(fresh);
  }
  function parseSearch(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({ symbol: cleanSymbol(r && (r.ticker || r.symbol)), name: text(r && r.name), type: text(r && r.assetType), active: !(r && r.isActive === false), country: text(r && r.countryCode) }))
      .filter((r) => r.symbol && r.active && (!r.country || r.country === "US"));
  }

  // ---------- the document ----------
  let doc = null, loading = null, loadError = null, loadedAt = 0;
  let saveTimer = null, saving = null, changedSince = 0, lastSent = null;
  const watchlist = () => (doc ? doc.watchlist : []);
  const findWatch = (id) => watchlist().find((w) => w.id === id);
  const pinsOf = (id) => (doc ? doc.pins.filter((p) => p.watch === id) : []);
  const mergeDocs = (base, local, remote) => window.LifeLogMerge.mergeInvest(base, local, remote);

  function ensureLoaded(force) {
    if (doc && !force) return Promise.resolve(doc);
    if (loading) return loading;
    loading = Storage.invest.load().then(({ doc: d, dirty }) => {
      d = sanitizeDoc(d);
      doc = doc && changedSince ? sanitizeDoc(mergeDocs(lastSent, doc, d)) : d;
      loadError = null; loadedAt = Date.now();
      if (dirty) scheduleSave(0);
      return doc;
    }).catch((e) => { loadError = e; if (!doc) doc = { watchlist: [], pins: [] }; return doc; })
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
    saving = Storage.invest.save(sent).then((res) => {
      if (res.merged) {
        doc = sanitizeDoc(changedSince !== mark ? mergeDocs(sent, doc, res.doc) : res.doc);
        if (isOpen()) render({ keepSnapshots: true });
      }
      lastSent = sent;
      if (changedSince === mark) changedSince = 0;
    }).catch(() => {}).finally(() => { saving = null; });
    await saving;
    if (changedSince) scheduleSave(800);
  }
  const isOpen = () => state.view === "finance" && state.financeMode === "invest";

  // ---------- this device's view: range and the ticker shown ----------
  const UI_KEY = "lifelog-invest-ui";
  let ui = null;
  function uiState() {
    if (ui) return ui;
    try { ui = JSON.parse(localStorage.getItem(UI_KEY) || "{}") || {}; } catch (e) { ui = {}; }
    if (!RANGES.includes(ui.range)) ui.range = "1Y";
    return ui;
  }
  function setUi(patch) {
    Object.assign(uiState(), patch);
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* private window */ }
  }
  function selected() {
    const list = watchlist();
    return list.find((w) => w.id === uiState().selected) || list[0] || null;
  }

  // ---------- prices: Tiingo, kept on this device ----------
  const PRICES_KEY = "investPrices";
  let prices = null, pricesLoading = null;
  const fetching = new Map();
  const lastProblem = new Map();
  function loadPrices() {
    if (prices) return Promise.resolve(prices);
    if (pricesLoading) return pricesLoading;
    pricesLoading = Storage.deviceGet(PRICES_KEY).then((v) => { prices = v && typeof v === "object" ? v : {}; return prices; })
      .catch(() => { prices = {}; return prices; }).finally(() => { pricesLoading = null; });
    return pricesLoading;
  }
  let savePricesTimer = null;
  function savePrices() {
    clearTimeout(savePricesTimer);
    savePricesTimer = setTimeout(() => { Storage.deviceSet(PRICES_KEY, prices).catch(() => {}); }, 300);
  }
  const keyOf = () => String((state.data.settings.mediaKeys || {}).tiingo || "").trim();
  const proxyOf = () => window.LifeLogPlatform.steamProxy(state.data.settings.steam && state.data.settings.steam.proxyUrl);
  const pointsOf = (symbol) => (prices && prices[symbol] && prices[symbol].points) || [];
  // What stands between you and prices, in words, or "" when nothing does.
  function blocker() {
    if (!keyOf()) return "key";
    if (!proxyOf()) return "proxy";
    return "";
  }
  async function tiingo(path) {
    const res = await fetch(proxyOf() + path, { headers: { Authorization: "Token " + keyOf() }, signal: AbortSignal.timeout(20000) });
    let body = null;
    try { body = await res.json(); } catch (e) { /* the status decides */ }
    if (!res.ok) {
      const said = body && (body.detail || body.error);
      const err = new Error(res.status === 401 || res.status === 403 ? "Tiingo turned the key down"
        : res.status === 404 ? "Tiingo doesn't know that ticker"
          : res.status === 429 ? "Tiingo's limit for the hour is used up — try again later"
            : "Tiingo answered " + res.status + (said ? ": " + String(said).slice(0, 120) : ""));
      err.status = res.status;
      throw err;
    }
    return body;
  }
  // Fresh means asked within the last six hours: the close only moves once a
  // day, and the free plan allows 50 requests an hour.
  const FRESH_MS = 6 * 3600 * 1000;
  function stale(symbol) {
    const p = prices && prices[symbol];
    return !p || !p.points || !p.points.length || !p.at || Date.now() - Date.parse(p.at) > FRESH_MS;
  }
  function refresh(symbol, force) {
    if (blocker()) return Promise.resolve(false);
    if (fetching.has(symbol)) return fetching.get(symbol);
    const job = (async () => {
      await loadPrices();
      if (!force && !stale(symbol)) return false;
      const had = prices[symbol];
      const since = had && had.points && had.points.length && !force ? had.points[had.points.length - 1][0] : "1980-01-01";
      try {
        let rows = await tiingo("/tiingo-prices/" + encodeURIComponent(symbol) + "?startDate=" + since);
        let points = parseTiingo(rows);
        if (had && had.points && had.points.length && since !== "1980-01-01" && rewritesHistory(rows.slice(1))) {
          rows = await tiingo("/tiingo-prices/" + encodeURIComponent(symbol) + "?startDate=1980-01-01");
          points = parseTiingo(rows);
          prices[symbol] = { at: new Date().toISOString(), points };
        } else {
          prices[symbol] = { at: new Date().toISOString(), points: since === "1980-01-01" ? points : joinSeries(had.points, points) };
        }
        lastProblem.delete(symbol);
        savePrices();
        return true;
      } catch (e) {
        lastProblem.set(symbol, (e && e.name === "TimeoutError") ? "Tiingo didn't answer — try again in a bit" : (e && e.message) || "Couldn't reach Tiingo");
        return false;
      }
    })().finally(() => fetching.delete(symbol));
    fetching.set(symbol, job);
    return job;
  }
  // Every ticker, one after another (the free plan has an hourly cap), and a
  // repaint once anything new came in.
  let refreshingAll = false;
  async function refreshAll() {
    if (refreshingAll || blocker()) return;
    refreshingAll = true;
    let any = false;
    try {
      for (const w of [...watchlist()]) {
        const got = await refresh(w.symbol);
        if (got) any = true;
        if (got && isOpen()) render({ keepSnapshots: true });
      }
    } finally { refreshingAll = false; }
    if (!any && isOpen() && watchlist().some((w) => lastProblem.has(w.symbol))) render({ keepSnapshots: true });
  }
  async function search(query) {
    if (blocker()) return [];
    return parseSearch(await tiingo("/tiingo-search?query=" + encodeURIComponent(query)));
  }
  async function lookup(symbol) {
    const meta = await tiingo("/tiingo-meta/" + encodeURIComponent(symbol));
    return { symbol: cleanSymbol(meta && meta.ticker) || symbol, name: text(meta && meta.name) };
  }

  // ---------- the filter row: Range ----------
  function buildRangeFilter() {
    const wrap = $("#rangeFilter");
    if (!wrap) return;
    const group = $("#rangeFilterGroup");
    group.hidden = !isOpen() || !watchlist().length;
    wrap.innerHTML = "";
    if (group.hidden) return;
    for (const r of RANGES) {
      const chip = el("span", "cat-chip year-chip" + (uiState().range === r ? " on" : ""), r);
      chip.tabIndex = 0;
      chip.setAttribute("role", "button");
      chip.setAttribute("aria-pressed", String(uiState().range === r));
      const pick = () => { setUi({ range: r }); render({ keepSnapshots: true }); };
      chip.addEventListener("click", pick);
      chip.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } });
      wrap.appendChild(chip);
    }
  }

  // ---------- the mode ----------
  function renderInvest(c) {
    if (!doc) {
      c.appendChild(el("div", "empty", "Loading your watchlist…"));
      ensureLoaded().then(() => { if (isOpen()) render({ keepSnapshots: true }); });
      return;
    }
    // Picks up another device's changes on the way in, at most once a minute.
    if (Date.now() - loadedAt > 60000 && !changedSince && !loading) {
      ensureLoaded(true).then(() => { if (isOpen()) render({ keepSnapshots: true }); });
    }
    if (!prices) {
      loadPrices().then(() => { if (isOpen()) render({ keepSnapshots: true }); });
    }
    buildRangeFilter();
    updateFilterbarVisibility();
    if (!watchlist().length) {
      c.appendChild(emptyState({
        glyph: "trending-up",
        title: "Nothing on your watchlist yet",
        body: "Follow US stocks and ETFs here: a price chart for each, a target price and a note, and pins on the days you want to compare.",
        action: "Add a ticker",
        onAction: () => openWatchModal(null),
        hint: blocker() === "key" ? "Prices come from Tiingo with a free key of your own — Settings → Media lookups." : "",
      }));
      return;
    }
    const w = selected();
    const wrap = el("div", "invest");
    const block = blocker();
    if (block) wrap.appendChild(setupCard(block));
    wrap.appendChild(chartCard(w));
    wrap.appendChild(listCard(w));
    c.appendChild(wrap);
    if (prices) refreshAll();
  }

  function setupCard(block) {
    const card = el("div", "card invest-setup");
    const tx = el("div", "invest-setup-text");
    tx.appendChild(el("b", null, block === "key" ? "Add a Tiingo key to see prices" : "Prices need the CORS proxy"));
    tx.appendChild(el("span", null, block === "key"
      ? "Free at tiingo.com, for personal use. Paste it under Media lookups; it syncs like your other keys."
      : "A browser can't call Tiingo directly. Set the proxy URL under Media lookups, or use the phone or desktop app."));
    card.appendChild(tx);
    const btn = el("button", "btn", "Open Media lookups");
    btn.type = "button";
    btn.onclick = () => openSettings && openSettings("media");
    card.appendChild(btn);
    return card;
  }

  function chartCard(w) {
    const card = el("div", "card invest-chart-card");
    const all = pointsOf(w.symbol);
    const range = uiState().range;
    const pts = sliceRange(all, range);
    const last = all.length ? all[all.length - 1] : null;

    const head = el("div", "invest-head");
    head.appendChild(el("span", "invest-sym", w.symbol));
    if (w.name) head.appendChild(el("span", "invest-name", w.name));
    const edit = el("button", "btn btn-icon invest-edit");
    edit.type = "button";
    edit.appendChild(ico("pencil"));
    edit.setAttribute("aria-label", "Edit " + w.symbol);
    edit.title = "Target, note, remove";
    edit.onclick = () => openWatchModal(w);
    head.appendChild(edit);
    card.appendChild(head);

    if (last) {
      const row = el("div", "invest-price");
      row.appendChild(el("b", null, usd(last[1])));
      const ch = pts.length > 1 ? changeOf(pts[0][1], last[1]) : null;
      if (ch != null) {
        const span = el("span", ch >= 0 ? "invest-up" : "invest-down", signedUsd(last[1] - pts[0][1]) + " (" + pct(ch) + ") " + rangeWords(range));
        row.appendChild(span);
      }
      card.appendChild(row);
      const prev = all.length > 1 ? all[all.length - 2][1] : null;
      card.appendChild(el("div", "invest-meta", "Closed " + Dates().day(last[0], { weekday: true, year: "auto" }) + (prev ? " · " + pct(changeOf(prev, last[1])) + " that day" : "")));
    }
    if (w.target || w.note) {
      const note = el("div", "invest-note");
      if (w.target) {
        const gap = last ? changeOf(w.target, last[1]) : null;
        const words = gap == null ? "" : Math.abs(gap) < 0.0005 ? " · at it" : " · " + Math.abs(gap * 100).toFixed(1) + "% " + (gap > 0 ? "above" : "below");
        note.appendChild(el("span", "invest-target" + (gap != null && gap <= 0 ? " is-hit" : ""), "Target " + usd(w.target) + words));
      }
      if (w.note) note.appendChild(el("span", "invest-note-text", w.note));
      card.appendChild(note);
    }

    const problem = lastProblem.get(w.symbol);
    if (pts.length > 1) card.appendChild(chart(w, pts, all));
    else {
      const msg = blocker() ? "No prices yet." : problem ? problem : fetching.has(w.symbol) || !prices ? "Getting prices…" : "No prices for this range.";
      card.appendChild(el("div", "invest-chart-empty", msg));
    }
    if (problem && pts.length > 1) card.appendChild(el("p", "invest-problem", problem + ". Showing the prices kept on this device."));
    card.appendChild(pinsBlock(w, all));
    return card;
  }
  function rangeWords(range) {
    return { "1M": "past month", "3M": "past 3 months", "6M": "past 6 months", "YTD": "this year", "1Y": "past year", "5Y": "past 5 years", "Max": "all time" }[range] || "";
  }

  // The chart: a line of closes over the range, a dashed line at the target
  // when it's near enough to share the scale, and the pins as numbered flags.
  // Hovering (or dragging a finger) shows a day's close; a click or tap holds
  // it, with a button to pin that day.
  const SVGNS = "http://www.w3.org/2000/svg";
  let chartObserver = null;
  function svgEl(tag, attrs, cls) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (cls) n.setAttribute("class", cls);
    return n;
  }
  function niceStep(span) {
    const raw = span / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
    return 10 * mag;
  }
  function chart(w, pts, all) {
    // A sideways drag here scrubs the days, so it mustn't also switch Ledger mode.
    const box = el("div", "invest-chart no-swipe");
    const W = 1000, H = 300;
    let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
    // A target close to the range joins the scale; one far off would flatten
    // the line to fit it, so it's left to the chip above.
    const span0 = hi - lo || hi * 0.02 || 1;
    const showTarget = w.target && w.target > lo - span0 * 0.35 && w.target < hi + span0 * 0.35;
    if (showTarget) { lo = Math.min(lo, w.target); hi = Math.max(hi, w.target); }
    const step = niceStep(hi - lo || hi * 0.02 || 1);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    if (hi === lo) hi = lo + step;
    const n = pts.length;
    const x = (i) => (i / (n - 1)) * W;
    const y = (v) => (1 - (v - lo) / (hi - lo)) * H;
    const up = pts[n - 1][1] >= pts[0][1];
    const d = pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(2) + "," + y(p[1]).toFixed(2)).join("");

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" });
    const grid = svgEl("g", {}, "invest-grid");
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    for (const v of ticks) grid.appendChild(svgEl("line", { x1: 0, x2: W, y1: y(v), y2: y(v) }));
    svg.appendChild(grid);
    svg.appendChild(svgEl("path", { d: d + `L${W},${H}L0,${H}Z` }, "invest-area " + (up ? "up" : "down")));
    const pins = pinsOf(w.id).filter((p) => p.date >= pts[0][0] && p.date <= pts[n - 1][0]);
    const order = [...pinsOf(w.id)].sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const indexOfDay = (day) => { let i = pts.findIndex((p) => p[0] >= day); if (i < 0) i = n - 1; else if (pts[i][0] > day && i > 0) i--; return i; };
    for (const p of pins) { const xi = x(indexOfDay(p.date)); svg.appendChild(svgEl("line", { x1: xi, x2: xi, y1: 0, y2: H }, "invest-pinline")); }
    if (showTarget) svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: y(w.target), y2: y(w.target) }, "invest-targetline"));
    svg.appendChild(svgEl("path", { d }, "invest-line " + (up ? "up" : "down")));
    const cross = svgEl("line", { x1: 0, x2: 0, y1: 0, y2: H }, "invest-cross");
    cross.style.display = "none";
    svg.appendChild(cross);
    box.appendChild(svg);

    // Labels in pixels, placed once the box has a size.
    const place = () => {
      for (const n2 of box.querySelectorAll(".invest-yl, .invest-xl, .invest-flag, .invest-pindot, .invest-tlabel")) n2.remove();
      const cw = svg.clientWidth, ch = svg.clientHeight;
      if (!cw || !ch) return;
      for (const v of ticks) {
        const l = el("span", "invest-yl", "$" + (step < 1 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US")));
        l.style.top = (y(v) / H * ch) + "px";
        box.appendChild(l);
      }
      const labels = axisLabels(pts, cw);
      for (const a of labels) {
        const l = el("span", "invest-xl", a.label);
        l.style.left = (a.i / (n - 1) * cw) + "px";
        box.appendChild(l);
      }
      for (const p of pins) {
        const i = indexOfDay(p.date), px = i / (n - 1) * cw;
        const flag = el("span", "invest-flag", String(order.indexOf(p) + 1));
        flag.style.left = px + "px";
        flag.title = (p.label ? p.label + " · " : "") + Dates().day(p.date);
        box.appendChild(flag);
        const dot = el("span", "invest-pindot");
        dot.style.left = px + "px"; dot.style.top = (y(pts[i][1]) / H * ch) + "px";
        box.appendChild(dot);
      }
      if (showTarget) {
        const t = el("span", "invest-tlabel", "Target " + usd(w.target));
        t.style.top = (y(w.target) / H * ch) + "px";
        box.appendChild(t);
      }
    };
    requestAnimationFrame(place);
    // One chart on screen at a time, so one observer: the last render's goes.
    if (chartObserver) chartObserver.disconnect();
    if (window.ResizeObserver) { let last = 0; chartObserver = new ResizeObserver(() => { const wdt = svg.clientWidth; if (wdt !== last) { last = wdt; place(); } }); chartObserver.observe(svg); }

    // The day under the pointer.
    const tip = el("div", "invest-tip");
    tip.hidden = true;
    const dot = el("span", "invest-dot");
    dot.hidden = true;
    box.appendChild(dot);
    box.appendChild(tip);
    let held = false;
    const show = (clientX, hold) => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const i = Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1))));
      const [day, close] = pts[i];
      const px = i / (n - 1) * r.width, py = y(close) / H * r.height;
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.style.display = "";
      dot.hidden = false; dot.style.left = px + "px"; dot.style.top = py + "px";
      tip.innerHTML = "";
      tip.appendChild(el("b", null, usd(close)));
      tip.appendChild(el("span", null, Dates().day(day, { weekday: true }) + " · " + pct(changeOf(pts[0][1], close)) + " from " + Dates().day(pts[0][0], { year: "auto" })));
      if (hold) {
        const pinBtn = el("button", "btn invest-pin-btn");
        pinBtn.type = "button";
        pinBtn.appendChild(ico("pin"));
        pinBtn.appendChild(document.createTextNode("Pin this day"));
        pinBtn.onclick = (ev) => { ev.stopPropagation(); openPinModal(null, w, day); };
        tip.appendChild(pinBtn);
      }
      tip.hidden = false;
      tip.classList.toggle("is-held", !!hold);
      const half = Math.min(130, r.width / 2);
      tip.style.left = Math.min(Math.max(px, half), r.width - half) + "px";
      tip.style.top = py + "px";
      tip.classList.toggle("below", py < 90);
    };
    const hide = () => { if (held) return; tip.hidden = true; dot.hidden = true; cross.style.display = "none"; };
    svg.addEventListener("pointermove", (e) => { if (!held) show(e.clientX, false); });
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    // A finger lifted after scrubbing lets the day go; a tap still holds it (click comes after).
    svg.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") hide(); });
    svg.addEventListener("pointercancel", (e) => { if (e.pointerType !== "mouse") hide(); });
    svg.addEventListener("click", (e) => { held = true; show(e.clientX, true); });
    document.addEventListener("pointerdown", function off(e) {
      if (!box.isConnected) { document.removeEventListener("pointerdown", off); return; }
      if (held && !tip.contains(e.target) && e.target !== svg && !svg.contains(e.target)) { held = false; hide(); }
    });
    svg.style.touchAction = "pan-y";
    return box;
  }
  // Month names (or years, on a long range) spaced so they don't collide.
  function axisLabels(pts, width) {
    const n = pts.length;
    const days = daysBetween(pts[0][0], pts[n - 1][0]);
    const byYear = days > 800;
    const out = [];
    let lastKey = null;
    for (let i = 0; i < n; i++) {
      const day = pts[i][0];
      const key = byYear ? day.slice(0, 4) : day.slice(0, 7);
      if (key !== lastKey && i > 0) out.push({ i, label: byYear ? key : Dates().MONTHS[+day.slice(5, 7) - 1] });
      lastKey = key;
    }
    const room = Math.max(1, Math.floor(width / 64));
    const every = Math.max(1, Math.ceil(out.length / room));
    return out.filter((_, k) => k % every === 0).filter((a) => a.i / (n - 1) < 0.96);
  }

  function pinsBlock(w, all) {
    const block = el("div", "invest-pins");
    const h = el("h3");
    h.appendChild(ico("pin"));
    h.appendChild(document.createTextNode("Pins"));
    const add = el("button", "btn", "+ Pin a date");
    add.type = "button";
    add.onclick = () => openPinModal(null, w, all.length ? all[all.length - 1][0] : todayStr());
    h.appendChild(add);
    block.appendChild(h);
    const pins = pinsOf(w.id);
    if (!pins.length) {
      block.appendChild(el("p", "invest-pins-empty", "Pin a day to compare the price then and now — when you bought, a dip, a piece of news. Tap the chart to pin the day under your finger."));
      return block;
    }
    const s = pinSteps(pins, all);
    const gap = (change, from, to, days) => {
      const row = el("div", "invest-gap");
      if (change != null) {
        row.appendChild(el("span", change >= 0 ? "invest-up" : "invest-down", pct(change)));
        row.appendChild(el("span", null, signedUsd(to - from) + " over " + spanLabel(days)));
      } else row.appendChild(el("span", null, "No price for one of these days"));
      return row;
    };
    s.steps.forEach((st, k) => {
      if (k) { const prev = s.steps[k - 1]; block.appendChild(gap(st.change, prev.price, st.price, st.days)); }
      const row = el("button", "invest-pin");
      row.type = "button";
      row.appendChild(el("span", "invest-pin-n", String(k + 1)));
      const l = el("span", "invest-pin-l");
      l.appendChild(el("b", null, st.pin.label || "Pin " + (k + 1)));
      l.appendChild(el("span", null, Dates().day(st.pin.date)));
      row.appendChild(l);
      row.appendChild(el("span", "invest-pin-v", st.price != null ? usd(st.price) : "—"));
      row.setAttribute("aria-label", "Edit pin " + (k + 1));
      row.onclick = () => openPinModal(st.pin, w);
      block.appendChild(row);
    });
    if (s.now) {
      const lastStep = s.steps[s.steps.length - 1];
      block.appendChild(gap(s.now.change, lastStep.price, s.now.price, s.now.days));
      const row = el("div", "invest-pin is-now");
      const n = el("span", "invest-pin-n is-now");
      n.appendChild(ico("clock"));
      row.appendChild(n);
      const l = el("span", "invest-pin-l");
      l.appendChild(el("b", null, "Latest close"));
      l.appendChild(el("span", null, Dates().day(s.now.day)));
      row.appendChild(l);
      row.appendChild(el("span", "invest-pin-v", usd(s.now.price)));
      block.appendChild(row);
    }
    if (s.total != null) {
      const t = el("div", "invest-total");
      t.appendChild(el("span", null, "Since pin 1 (" + spanLabel(s.totalDays) + ")"));
      t.appendChild(el("span", s.total >= 0 ? "invest-up" : "invest-down", pct(s.total)));
      block.appendChild(t);
    }
    return block;
  }

  function sparkline(points, up) {
    const svg = svgEl("svg", { viewBox: "0 0 84 30", preserveAspectRatio: "none", "aria-hidden": "true" }, "invest-spark");
    if (points.length < 2) return svg;
    const vals = points.map((p) => p[1]);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    // At most ~120 points: a sparkline is 84px wide.
    const every = Math.max(1, Math.floor(points.length / 120));
    const sample = points.filter((_, i) => i % every === 0 || i === points.length - 1);
    const d = sample.map((p, i) => (i ? "L" : "M") + (i / (sample.length - 1) * 84).toFixed(1) + "," + (2 + (1 - (p[1] - lo) / span) * 26).toFixed(1)).join("");
    svg.appendChild(svgEl("path", { d }, "invest-line " + (up ? "up" : "down")));
    return svg;
  }

  function listCard(current) {
    const card = el("div", "card invest-list");
    const h = el("h2");
    h.appendChild(document.createTextNode("Watching"));
    const add = el("button", "btn", "+ Add ticker");
    add.type = "button";
    add.onclick = () => openWatchModal(null);
    h.appendChild(add);
    card.appendChild(h);
    const range = uiState().range;
    for (const w of watchlist()) {
      const all = pointsOf(w.symbol);
      const pts = sliceRange(all, range);
      const last = all.length ? all[all.length - 1][1] : null;
      const ch = pts.length > 1 ? changeOf(pts[0][1], last) : null;
      const row = el("button", "invest-row" + (w === current ? " sel" : ""));
      row.type = "button";
      row.setAttribute("aria-pressed", String(w === current));
      const t = el("span", "invest-row-t");
      const sym = el("b", null, w.symbol);
      if (w.target) {
        const hit = last != null && last <= w.target;
        sym.appendChild(el("i", hit ? "is-hit" : "", (hit ? "At target " : "Target ") + usd(w.target)));
      }
      t.appendChild(sym);
      t.appendChild(el("span", null, w.name || ""));
      row.appendChild(t);
      row.appendChild(sparkline(pts, ch == null || ch >= 0));
      const p = el("span", "invest-row-p");
      p.appendChild(el("b", null, last != null ? usd(last) : "—"));
      p.appendChild(el("span", ch == null ? "" : ch >= 0 ? "invest-up" : "invest-down", ch == null ? "" : pct(ch)));
      row.appendChild(p);
      row.onclick = () => { setUi({ selected: w.id }); render({ keepSnapshots: true }); };
      card.appendChild(row);
    }
    card.appendChild(el("p", "invest-foot", "Prices from Tiingo, adjusted for splits and dividends, updated once a day after the US market closes. Only the tickers are sent."));
    return card;
  }

  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };

  // ---------- the ticker sheet ----------
  let editingWatch = null, picked = null, searchAsk = 0, searchTimer = null;
  async function openWatchModal(w) {
    await ensureLoaded();
    editingWatch = w || null;
    picked = null;
    $("#watchModalTitle").textContent = w ? "Edit " + w.symbol : "Watch a ticker";
    $("#watchSymbolRow").hidden = !!w;
    $("#watchSymbol").value = "";
    $("#watchResults").innerHTML = "";
    $("#watchResults").hidden = true;
    $("#watchTarget").value = w && w.target ? String(w.target) : "";
    $("#watchNote").value = (w && w.note) || "";
    $("#deleteWatchBtn").hidden = !w;
    $("#watchSaveBtn").textContent = w ? "Save" : "Add to watchlist";
    $("#watchHint").textContent = !w && blocker() === "key" ? "Without a Tiingo key the ticker is added as typed, and its prices come once you add one." : "";
    $("#watchModal").hidden = false;
    setTimeout(() => (w ? $("#watchTarget") : $("#watchSymbol")).focus(), 0);
  }
  function closeWatchModal() { $("#watchModal").hidden = true; editingWatch = null; picked = null; searchAsk++; }
  function showResults(list) {
    const box = $("#watchResults");
    box.innerHTML = "";
    box.hidden = !list.length;
    for (const r of list.slice(0, 6)) {
      const b = el("button", "invest-result");
      b.type = "button";
      b.appendChild(el("b", null, r.symbol));
      b.appendChild(el("span", null, [r.name, r.type].filter(Boolean).join(" · ")));
      b.onclick = () => { picked = r; $("#watchSymbol").value = r.symbol; box.hidden = true; $("#watchTarget").focus(); };
      box.appendChild(b);
    }
  }
  function onSymbolInput() {
    picked = null;
    clearTimeout(searchTimer);
    const q = $("#watchSymbol").value.trim();
    const ask = ++searchAsk;
    if (q.length < 1 || blocker()) { showResults([]); return; }
    searchTimer = setTimeout(async () => {
      let list = [];
      try { list = await search(q); } catch (e) { list = []; }
      if (ask === searchAsk && !$("#watchModal").hidden) showResults(list);
    }, 350);
  }
  async function saveWatchFromForm() {
    await ensureLoaded();
    const targetRaw = $("#watchTarget").value.trim();
    const target = targetRaw ? cleanPrice(targetRaw) : null;
    if (targetRaw && !target) { toast("A target is a price above zero, like 550", true); return; }
    const note = $("#watchNote").value;
    if (editingWatch) {
      const w = findWatch(editingWatch.id);
      if (w) {
        const next = sanitizeWatch({ ...w, target: target || undefined, note });
        for (const k of ["target", "note"]) if (next[k] == null) delete w[k];
        Object.assign(w, next);
        changed(w);
      }
      closeWatchModal();
      render({ keepSnapshots: true });
      return;
    }
    const symbol = cleanSymbol(picked ? picked.symbol : $("#watchSymbol").value);
    if (!symbol) { toast("Type a ticker, like VOO or AAPL", true); return; }
    const had = watchlist().find((x) => x.symbol === symbol);
    if (had) { setUi({ selected: had.id }); closeWatchModal(); render({ keepSnapshots: true }); toast(symbol + " is already on your watchlist"); return; }
    let name = picked ? picked.name : "";
    if (!picked && !blocker()) {
      $("#watchSaveBtn").disabled = true;
      try { const m = await lookup(symbol); name = m.name; }
      catch (e) {
        $("#watchSaveBtn").disabled = false;
        if (e && e.status === 404) { toast("Tiingo doesn't know " + symbol + " — check the ticker", true); return; }
      }
      $("#watchSaveBtn").disabled = false;
    }
    const now = new Date().toISOString();
    const w = sanitizeWatch({ id: newId(), symbol, name, target: target || undefined, note, createdAt: now, updatedAt: now });
    doc.watchlist.push(w);
    changed(w);
    setUi({ selected: w.id });
    closeWatchModal();
    render({ keepSnapshots: true });
    refresh(symbol).then((got) => { if (isOpen()) render({ keepSnapshots: true }); return got; });
  }
  function deleteWatch(target) {
    const w = findWatch(target.id);
    if (!w) return;
    const gone = { watch: w, pins: pinsOf(w.id) };
    doc.watchlist = doc.watchlist.filter((x) => x.id !== w.id);
    doc.pins = doc.pins.filter((p) => p.watch !== w.id);
    changed();
    closeWatchModal();
    render({ keepSnapshots: true });
    toast(`Removed ${w.symbol} from your watchlist`, false, {
      label: "Undo",
      onClick: () => {
        doc.watchlist.push(gone.watch);
        doc.pins.push(...gone.pins);
        changed(gone.watch);
        setUi({ selected: gone.watch.id });
        render({ keepSnapshots: true });
      },
    });
  }

  // ---------- the pin sheet ----------
  let editingPin = null, pinWatch = null;
  async function openPinModal(pin, w, day) {
    await ensureLoaded();
    editingPin = pin || null;
    pinWatch = w || (pin && findWatch(pin.watch)) || null;
    if (!pinWatch) return;
    $("#investPinModalTitle").textContent = pin ? "Edit pin" : "Pin a date";
    $("#investPinTicker").textContent = pinWatch.symbol + (pinWatch.name ? " · " + pinWatch.name : "");
    $("#investPinDate").value = pin ? pin.date : (day || todayStr());
    $("#investPinDate").max = todayStr();
    $("#investPinLabel").value = (pin && pin.label) || "";
    $("#deleteInvestPinBtn").hidden = !pin;
    $("#investPinModal").hidden = false;
    setTimeout(() => $("#investPinLabel").focus(), 0);
  }
  function closePinModal() { $("#investPinModal").hidden = true; editingPin = null; pinWatch = null; }
  function savePinFromForm() {
    const date = $("#investPinDate").value;
    if (!isDay(date)) { toast("Pick a date for the pin", true); return; }
    const label = $("#investPinLabel").value;
    if (editingPin) {
      const p = doc.pins.find((x) => x.id === editingPin.id);
      if (p) {
        const next = sanitizePin({ ...p, date, label });
        if (next.label == null) delete p.label;
        Object.assign(p, next);
        changed(p);
      }
    } else {
      const now = new Date().toISOString();
      const p = sanitizePin({ id: newId(), watch: pinWatch.id, date, label, createdAt: now, updatedAt: now });
      doc.pins.push(p);
      changed(p);
    }
    closePinModal();
    render({ keepSnapshots: true });
  }
  function deletePin(target) {
    const p = doc.pins.find((x) => x.id === target.id);
    if (!p) return;
    doc.pins = doc.pins.filter((x) => x.id !== p.id);
    changed();
    closePinModal();
    render({ keepSnapshots: true });
    toast("Pin removed", false, { label: "Undo", onClick: () => { doc.pins.push(p); changed(p); render({ keepSnapshots: true }); } });
  }

  async function addTicker() { await ensureLoaded(); openWatchModal(null); }

  function wire() {
    $("#watchForm").addEventListener("submit", (e) => { e.preventDefault(); saveWatchFromForm(); });
    $("#cancelWatchBtn").onclick = closeWatchModal;
    $("#deleteWatchBtn").onclick = () => { if (editingWatch) deleteWatch(editingWatch); };
    $("#watchSymbol").addEventListener("input", onSymbolInput);
    $("#investPinForm").addEventListener("submit", (e) => { e.preventDefault(); savePinFromForm(); });
    $("#cancelInvestPinBtn").onclick = closePinModal;
    $("#deleteInvestPinBtn").onclick = () => { if (editingPin) deletePin(editingPin); };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && saveTimer) flush(); });
    window.addEventListener("pagehide", () => { if (saveTimer) flush(); });
  }

  const api = {
    init, wire, renderInvest, buildRangeFilter, ensureLoaded, flush, addTicker,
    openWatchModal, closeWatchModal, openPinModal, closePinModal,
    // pure, for tests and the bridge
    sanitizeWatch, sanitizePin, sanitizeDoc, cleanSymbol, cleanPrice,
    RANGES, rangeStart, sliceRange, priceOn, changeOf, pinSteps, spanLabel, pct, usd,
    parseTiingo, rewritesHistory, joinSeries, parseSearch,
  };
  if (typeof window !== "undefined") window.LifeLogInvest = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
