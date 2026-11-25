// LifeLog — the Ledger's Investments mode: a watchlist of US stocks and ETFs,
// each with a price chart, an optional target price and note, date pins to
// see how the price moved between them, and the buys and sells you made, for
// what you hold and how it's doing. Prices are in dollars only.
//
// The watchlist and its pins live in investments.json beside lifelog.json
// (Storage.invest): a build older than this one merging lifelog.json would
// drop a root key it doesn't know, and that deletion would then win on every
// device. An older build never opens investments.json at all.
//
// Prices come from Tiingo with your own key, through the CORS proxy (or the
// app's native one). Each ticker's daily closes are kept on this device only,
// not synced: they're the service's data, can be fetched again, and would
// make every save of the watchlist heavy. A ticker is asked for once for its
// whole history, then only for the days since its last close.
(function () {
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  // Numbers in the reader's language (src/language.js); en-US where
  // there's no page (the bridge, Node tests), as before.
  const numLocale = () => (typeof window === "object" && window.i18n && window.i18n.lang !== "en" ? window.i18n.lang : "en-US");
  const Dates = () => window.LifeLogDates || require("./dates.js");
  const { isRealDay: isDay, today: todayStr } = Dates();
  const ico = (n) => window.LifeLogIcons.svg(n);
  let state, $, el, uid, toast, emptyState, render, Storage, updateFilterbarVisibility, openSettings, openInvest;

  function init(ctx) {
    ({ state, $, el, uid, toast, emptyState, render, Storage, updateFilterbarVisibility, openSettings, openInvest } = ctx);
  }

  // ---------- pure: cleaning and price maths (test/invest.test.js) ----------
  const KNOWN_WATCH_KEYS = new Set(["id", "symbol", "name", "target", "targetAbove", "note", "buys", "createdAt", "updatedAt"]);
  const KNOWN_BUY_KEYS = new Set(["id", "date", "units", "price", "fee", "sell", "note", "createdAt", "updatedAt"]);
  const KNOWN_PIN_KEYS = new Set(["id", "watch", "date", "label", "createdAt", "updatedAt"]);
  // Fields this build doesn't know are carried through, so a newer build's
  // additions survive an older one saving (the same rule as app.js's).
  function keepUnknown(src, out, known) {
    for (const key of Object.keys(src || {})) if (!known.has(key)) out[key] = src[key];
    return out;
  }
  const newId = () => (uid ? uid() : "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
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
    // A target rings at or under its price (a price to buy at), or with
    // targetAbove at or over it (a price to sell at).
    if (target && w.targetAbove === true) out.targetAbove = true;
    const note = text(w.note);
    if (note) out.note = note.slice(0, 500);
    // Buys ride on the ticker rather than in a list of their own: 0.310.0
    // keeps a ticker's unknown fields but drops an unknown list, so this is
    // the shape an older build saving the file can't lose.
    const buys = (Array.isArray(w.buys) ? w.buys : []).map(sanitizeBuy).filter(Boolean);
    if (buys.length) out.buys = sortBuys(buys);
    return keepUnknown(w, out, KNOWN_WATCH_KEYS);
  }
  // A buy (or, with sell, a sale): the day, how many shares and the price
  // paid for each. Fractions of a share are fine; Blink sells them.
  function cleanUnits(v) {
    const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(/[,\s]/g, ""));
    return isFinite(n) && n > 0 ? Math.round(n * 1e6) / 1e6 : null;
  }
  // The broker's fee on a buy or a sale, in dollars: blank or 0 is none,
  // anything else not a number at or above zero is NaN, for the form to refuse.
  function cleanFee(v) {
    const t = String(v == null ? "" : v).replace(/[$,\s]/g, "");
    if (!t) return null;
    const n = typeof v === "number" ? v : parseFloat(t);
    if (!isFinite(n) || n < 0 || (typeof v !== "number" && !/^\d*\.?\d+$/.test(t))) return NaN;
    return n ? Math.round(n * 100) / 100 : null;
  }
  function sanitizeBuy(b) {
    b = b || {};
    const units = cleanUnits(b.units), price = cleanPrice(b.price);
    if (!isDay(b.date) || !units || !price) return null;
    const out = {
      id: b.id || newId(),
      date: b.date, units, price,
      createdAt: b.createdAt || null,
      updatedAt: b.updatedAt || b.createdAt || "1970-01-01T00:00:00.000Z",
    };
    const fee = cleanFee(b.fee);
    if (fee > 0) out.fee = fee;
    if (b.sell) out.sell = true;
    const note = text(b.note);
    if (note) out.note = note.slice(0, 200);
    return keepUnknown(b, out, KNOWN_BUY_KEYS);
  }
  const sortBuys = (list) => [...list].sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
  // A ticker's splits and cash dividends, from Tiingo's daily rows:
  // [[day, cash a share, split factor]], oldest first, only the days with
  // one. Kept beside the closes on this device (refresh), so the buys can
  // be worked out in the shares and dollars they were made in.
  const sortEvents = (list) => (Array.isArray(list) ? list : []).filter((e) => Array.isArray(e) && isDay(e[0])).sort((a, b) => a[0].localeCompare(b[0]));
  // What the buys add up to, at average cost, in today's shares: a split
  // after a buy multiplies its shares (the cost stays), a cash dividend
  // pays the shares held the day before it, and a sale takes shares out at
  // the average paid so far, what it made over that being realized. A fee
  // adds to what a buy cost and comes off what a sale brought in. `last` is
  // the latest price, for the value and the gain on what's still held.
  // Without `events` (no prices yet), no splits or dividends are known.
  // `flows` is the money in and out by day, for the yearly return.
  function holdingOf(buys, last, events) {
    let units = 0, cost = 0, realized = 0, bought = 0, dividends = 0, fees = 0;
    const flows = [];
    const evs = sortEvents(events);
    let k = 0;
    // An event on a trade's own day comes first: buying on a split's day
    // buys the new shares, and on a dividend's day misses it (selling then
    // doesn't).
    const upTo = (day) => {
      for (; k < evs.length && evs[k][0] <= day; k++) {
        const [d, cash, split] = evs[k];
        if (split > 0 && split !== 1) units *= split;
        if (cash > 0 && units > 1e-9) { dividends += units * cash; flows.push([d, units * cash]); }
      }
    };
    for (const b of sortBuys(buys || [])) {
      upTo(b.date);
      const fee = b.fee || 0;
      if (b.sell) {
        const take = Math.min(b.units, units);
        if (!take) continue;
        const avg = cost / units;
        const got = take * b.price - fee * (take / b.units);
        realized += got - take * avg;
        cost -= take * avg;
        units -= take;
        fees += fee;
        flows.push([b.date, got]);
        if (units < 1e-9) { units = 0; cost = 0; }
      } else {
        const paid = b.units * b.price + fee;
        units += b.units;
        cost += paid;
        bought += paid;
        fees += fee;
        flows.push([b.date, -paid]);
      }
    }
    upTo("9999-12-31");
    const value = last != null && units ? units * last : null;
    const gain = value != null ? value - cost : null;
    return {
      units: Math.round(units * 1e6) / 1e6,
      cost, avg: units ? cost / units : null, bought, realized, dividends, fees,
      value, gain,
      gainPct: value != null && cost ? value / cost - 1 : null,
      // All in: what's held, what sales brought and the dividends, against
      // everything paid. Null without a price for what's still held.
      total: units && value == null ? null : (gain || 0) + realized + dividends,
      flows,
    };
  }
  // The first sale the buys before it can't cover, or null: holdingOf
  // would quietly sell only what was held (nothing, for a sale logged before
  // a same-day buy), so the form doesn't let the list get that way. A split
  // between a buy and a sale counts, so selling the new shares is fine.
  function shortSale(buys, events) {
    let units = 0, k = 0;
    const evs = sortEvents(events);
    for (const b of sortBuys(buys || [])) {
      for (; k < evs.length && evs[k][0] <= b.date; k++) if (evs[k][2] > 0 && evs[k][2] !== 1) units *= evs[k][2];
      if (!b.sell) { units += b.units; continue; }
      if (b.units > units + 1e-9) return { sale: b, held: Math.max(0, units) };
      units -= b.units;
    }
    return null;
  }
  // The yearly rate that makes the money in and out (holdingOf's flows,
  // and what's held now as money out on `day`) come to nothing: the
  // money-weighted return, so a buy made last month counts for a month.
  // Null with nothing both in and out, or under a year (a month's 2% isn't
  // "27% a year").
  const YEAR_MS = 365.25 * 864e5;
  function yearlyReturn(flows, value, day) {
    const f = (flows || []).filter((x) => x && isDay(x[0]) && isFinite(x[1]) && x[1]).slice();
    if (value > 0 && isDay(day)) f.push([day, value]);
    if (!f.some((x) => x[1] < 0) || !f.some((x) => x[1] > 0)) return null;
    f.sort((a, b) => a[0].localeCompare(b[0]));
    const t0 = Date.parse(f[0][0] + "T00:00:00Z");
    const ts = f.map((x) => [(Date.parse(x[0] + "T00:00:00Z") - t0) / YEAR_MS, x[1]]);
    if (ts[ts.length - 1][0] < 1) return null;
    const npv = (r) => ts.reduce((s2, [t, v]) => s2 + v / Math.pow(1 + r, t), 0);
    let lo = -0.9999, hi = 1;
    while (npv(hi) > 0 && hi < 1e4) hi *= 2;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let i = 0; i < 200 && hi - lo > 1e-9; i++) {
      const mid = (lo + hi) / 2;
      if (npv(mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // What everything you held was worth on each day, beside the money put
  // in so far (buys and fees, less what sales brought back): [[day, worth,
  // put in]], from the first buy on, on the days with prices. Each ticker's
  // shares are the ones held that day, at that day's price as it was then
  // (not adjusted), so a split doesn't show as a drop. A day a ticker held
  // has no price for yet is left out rather than drawn as a dip.
  // items: [{ buys, points, events }].
  function worthSeries(items) {
    const held = (items || []).filter((it) => it.buys && it.buys.length);
    if (!held.length) return null;
    const tracks = held.map((it) => {
      const steps = [];
      let units = 0, put = 0, k = 0;
      const evs = sortEvents(it.events);
      for (const b of sortBuys(it.buys)) {
        for (; k < evs.length && evs[k][0] <= b.date; k++) if (evs[k][2] > 0 && evs[k][2] !== 1) { units *= evs[k][2]; steps.push([evs[k][0], units, put]); }
        const fee = b.fee || 0;
        if (b.sell) { const take = Math.min(b.units, units); units -= take; put -= take * b.price - fee * (b.units ? take / b.units : 0); }
        else { units += b.units; put += b.units * b.price + fee; }
        steps.push([b.date, units, put]);
      }
      for (; k < evs.length; k++) if (evs[k][2] > 0 && evs[k][2] !== 1) { units *= evs[k][2]; steps.push([evs[k][0], units, put]); }
      return { steps, raw: (it.points || []).map((p) => [p[0], rawOf(p)]) };
    });
    const first = tracks.map((t) => t.steps[0][0]).sort()[0];
    const days = [...new Set(tracks.flatMap((t) => t.raw.map((p) => p[0]).filter((d) => d >= first)))].sort();
    if (!days.length) return null;
    const out = [];
    for (const day of days) {
      let worth = 0, put = 0, ok = true;
      for (const t of tracks) {
        let s2 = null;
        for (let i = t.steps.length - 1; i >= 0; i--) if (t.steps[i][0] <= day) { s2 = t.steps[i]; break; }
        if (!s2) continue;
        put += s2[2];
        if (s2[1] > 1e-9) {
          const price = priceOn(t.raw, day);
          if (price == null) { ok = false; break; }
          worth += s2[1] * price;
        }
      }
      if (!ok) continue;
      out.push([day, Math.round(worth * 100) / 100, Math.round(put * 100) / 100]);
    }
    return out.length ? out : null;
  }
  // Whether a price is at the ticker's target, whichever way it points.
  const atTarget = (w, price) => !!(w && w.target && price != null && (w.targetAbove ? price >= w.target : price <= w.target));
  const targetWords = (w) => (w.targetAbove ? i18n.t("Target {price} and up", { price: usd(w.target) }) : i18n.t("Target {price}", { price: usd(w.target) }));
  function unitsText(n) {
    const s = (Math.round(n * 1e4) / 1e4).toLocaleString(numLocale(), { maximumFractionDigits: 4 });
    return n === 1 ? i18n.t("{n} share", { n: s }) : i18n.t("{n} shares", { n: s });
  }
  // Two points on a ticker's line, either way round: the change from the
  // earlier to the later, in % and dollars, and how long between.
  function compareDays(points, a, b) {
    const [from, to] = a <= b ? [a, b] : [b, a];
    const p1 = priceOn(points, from), p2 = priceOn(points, to);
    return { from, to, fromPrice: p1, toPrice: p2, change: changeOf(p1, p2), diff: p1 != null && p2 != null ? p2 - p1 : null, days: daysBetween(from, to) };
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
      if (keep.target == null && drop.target != null) { keep.target = drop.target; if (drop.targetAbove) keep.targetAbove = true; }
      for (const k of ["name", "note"]) if (keep[k] == null && drop[k] != null) keep[k] = drop[k];
      if (drop.buys) {
        const ids = new Set((keep.buys || []).map((b) => b.id));
        const more = drop.buys.filter((b) => !ids.has(b.id));
        if (more.length) keep.buys = sortBuys([...(keep.buys || []), ...more]);
      }
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
    if (days < 1) return i18n.t("the same day");
    if (days < 60) return i18n.tn(days, "1 day", "{n} days");
    if (days < 730) { const m = Math.round(days / 30.44); return i18n.tn(m, "1 month", "{n} months"); }
    const y = days / 365.25;
    return i18n.t("{n} years", { n: String(Math.round(y * 10) / 10) });
  }
  // A sign in front of a number in Hebrew text moves to its other end
  // without an isolate around the number.
  const ltr = (s) => (s && i18n.dir === "rtl" ? "\u2066" + s + "\u2069" : s);
  const pct = (v) => (v == null ? "" : ltr((v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(Math.abs(v) < 0.01 ? 2 : 1) + "%"));
  function usd(v) {
    if (v == null || !isFinite(v)) return "";
    const digits = Math.abs(v) < 1 ? 4 : 2;
    return (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString(numLocale(), { minimumFractionDigits: 2, maximumFractionDigits: digits });
  }
  // A difference, to the cent.
  const signedUsd = (v) => (v == null ? "" : ltr((v >= 0 ? "+" : "") + usd(Math.round(v * 100) / 100)));

  // Tiingo's daily rows → [[day, close]]. The adjusted close, so a split
  // doesn't draw as a crash and a dividend counts as part of the return;
  // the day's price as it was then rides third when it differs ([day,
  // adjusted, as it was]), for filling in a buy and what you held was worth.
  const round4 = (v) => Math.round(v * 10000) / 10000;
  function parseTiingo(rows) {
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const r of rows) {
      const day = r && typeof r.date === "string" ? r.date.slice(0, 10) : "";
      const close = r && (isFinite(r.adjClose) && r.adjClose > 0 ? +r.adjClose : isFinite(r.close) && r.close > 0 ? +r.close : null);
      if (!isDay(day) || !close) continue;
      const raw = r && isFinite(r.close) && r.close > 0 ? round4(+r.close) : null;
      out.push(raw != null && raw !== round4(close) ? [day, round4(close), raw] : [day, round4(close)]);
    }
    return out.sort((a, b) => a[0].localeCompare(b[0]));
  }
  // A close as it was on its day (a point's third value, else its only one).
  const rawOf = (p) => (p.length > 2 ? p[2] : p[1]);
  const rawSeries = (points) => (points || []).map((p) => [p[0], rawOf(p)]);
  function parseEvents(rows) {
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const r of rows) {
      const day = r && typeof r.date === "string" ? r.date.slice(0, 10) : "";
      const cash = r && isFinite(r.divCash) && +r.divCash > 0 ? Math.round(+r.divCash * 1e6) / 1e6 : 0;
      const split = r && isFinite(r.splitFactor) && +r.splitFactor > 0 && +r.splitFactor !== 1 ? +r.splitFactor : 1;
      if (isDay(day) && (cash || split !== 1)) out.push([day, cash, split]);
    }
    return sortEvents(out);
  }
  // Kept events with a later answer's laid over them, a day at a time.
  function joinEvents(old, fresh) {
    const m = new Map();
    for (const e of sortEvents(old)) m.set(e[0], e);
    for (const e of sortEvents(fresh)) m.set(e[0], e);
    return [...m.values()].sort((a, b) => a[0].localeCompare(b[0]));
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

  // ---------- pure: the New York market clock ----------
  // NYSE's full-day holidays, worked out by rule (a Saturday holiday is
  // kept the Friday before, a Sunday one the Monday after, but a Saturday
  // New Year's Day isn't kept at all). Half days (13:00 closes) aren't
  // known: on those the app only expects the close later than it comes.
  const holidayCache = new Map();
  function marketHolidays(year) {
    if (holidayCache.has(year)) return holidayCache.get(year);
    const day = (m, d) => new Date(Date.UTC(year, m - 1, d));
    const iso = (t) => t.toISOString().slice(0, 10);
    const nth = (m, weekday, n) => { const t = day(m, 1); t.setUTCDate(1 + ((weekday - t.getUTCDay() + 7) % 7) + (n - 1) * 7); return t; };
    const lastOf = (m, weekday) => { const t = day(m + 1, 0); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() - weekday + 7) % 7)); return t; };
    const kept = (t) => { const w = t.getUTCDay(); if (w === 6) t.setUTCDate(t.getUTCDate() - 1); else if (w === 0) t.setUTCDate(t.getUTCDate() + 1); return t; };
    // Easter Sunday (the Gregorian computus), for Good Friday.
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const easter = day(Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
    const goodFriday = new Date(easter); goodFriday.setUTCDate(easter.getUTCDate() - 2);
    const out = new Set();
    const newYear = day(1, 1);
    if (newYear.getUTCDay() !== 6) out.add(iso(kept(newYear)));
    for (const t of [nth(1, 1, 3), nth(2, 1, 3), goodFriday, lastOf(5, 1), nth(9, 1, 1), nth(11, 4, 4)]) out.add(iso(t));
    for (const [mo, dd] of [[7, 4], [12, 25]]) out.add(iso(kept(day(mo, dd))));
    if (year >= 2022) out.add(iso(kept(day(6, 19))));
    holidayCache.set(year, out);
    return out;
  }
  function isTradingDay(day) {
    const w = new Date(day + "T12:00:00Z").getUTCDay();
    return w !== 0 && w !== 6 && !marketHolidays(+day.slice(0, 4)).has(day);
  }
  const nextDay = (day) => { const t = new Date(day + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
  function nextTradingDay(day) {
    let d = nextDay(day);
    while (!isTradingDay(d)) d = nextDay(d);
    return d;
  }
  // New York's wall clock for a moment, and a moment for New York's wall
  // clock (its offset found by asking Intl, so summer time takes care of itself).
  let nyFormat = null;
  function nyParts(ms) {
    nyFormat = nyFormat || new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const p = {};
    for (const x of nyFormat.formatToParts(new Date(ms))) p[x.type] = x.value;
    return { day: p.year + "-" + p.month + "-" + p.day, minutes: (+p.hour % 24) * 60 + +p.minute };
  }
  function nyTime(day, minutes) {
    const [y, mo, d] = day.split("-").map(Number);
    const wall = Date.UTC(y, mo - 1, d, 0, minutes);
    const offsetAt = (ms) => { const p = nyParts(ms); const [py, pm, pd] = p.day.split("-").map(Number); return Date.UTC(py, pm - 1, pd, 0, p.minutes) - Math.floor(ms / 60000) * 60000; };
    let t = wall - offsetAt(wall + 5 * 3600e3);
    t = wall - offsetAt(t);
    return t;
  }
  const OPEN_MIN = 9 * 60 + 30;
  // Tiingo has the day's closes by about 17:30 New York time (a guess from
  // its docs' "after the close", not measured), so a close is asked for then.
  const READY_MIN = 17 * 60 + 30;
  // When the close after `lastDay` should be at Tiingo.
  const closeDueAt = (lastDay) => nyTime(nextTradingDay(lastDay), READY_MIN);
  // Prices are fresh until the next close should be out; past that, asked
  // for again, and every two hours after while it doesn't come (a half day,
  // a late feed, a holiday the rules above don't know).
  const RETRY_MS = 2 * 3600 * 1000;
  function pricesStale(entry, now) {
    if (!entry || !entry.points || !entry.points.length || !entry.at) return true;
    const at = Date.parse(entry.at);
    if (!isFinite(at)) return true;
    const due = closeDueAt(entry.points[entry.points.length - 1][0]);
    return now >= due && (at < due || now - at >= RETRY_MS);
  }
  // Whether the market is trading now, and if not, when it next opens.
  function marketNow(now) {
    const p = nyParts(now);
    if (isTradingDay(p.day) && p.minutes >= OPEN_MIN && p.minutes < 16 * 60) return { open: true, day: p.day };
    let d = isTradingDay(p.day) && p.minutes < OPEN_MIN ? p.day : nextTradingDay(p.day);
    return { open: false, day: p.day, opensAt: nyTime(d, OPEN_MIN) };
  }
  // A wait in words: "25 min", "3 h 10 min", "2 days".
  function waitWords(ms) {
    const min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return i18n.t("{n} min", { n: min });
    if (min < 36 * 60) return i18n.t("{h} h {m} min", { h: Math.floor(min / 60), m: min % 60 });
    return i18n.tn(Math.round(min / 1440), "1 day", "{n} days");
  }

  // ---------- pure: the same money in the S&P 500 ----------
  // What your buys and sales on a ticker would have come to in SPY: each
  // buy's dollars (its fee too) buy SPY at that day's close, each sale takes
  // the dollars it brought back out (no more than is there). SPY's closes
  // are adjusted, so its dividends count as reinvested; yours count as the
  // cash they paid. `events` are the ticker's splits and dividends.
  // Null when SPY's prices don't reach back to the first buy.
  const BENCHMARK = "SPY";
  const SAME_INDEX = new Set(["SPY", "VOO", "IVV", "SPLG"]);
  function benchmarkOf(buys, spy, last, events) {
    const list = sortBuys(buys || []);
    if (!list.length || !spy || !spy.length || list[0].date < spy[0][0] || last == null) return null;
    const evs = sortEvents(events);
    let held = 0, cash = 0, paid = 0, spyUnits = 0, spyCash = 0, k = 0;
    for (const b of list) {
      for (; k < evs.length && evs[k][0] <= b.date; k++) if (evs[k][2] > 0 && evs[k][2] !== 1) held *= evs[k][2];
      const at = priceOn(spy, b.date);
      if (!at) return null;
      const fee = b.fee || 0;
      if (b.sell) {
        const take = Math.min(b.units, held);
        const got = take * b.price - fee * (take / b.units);
        held -= take; cash += got;
        const out = Math.min(got / at, spyUnits);
        spyUnits -= out; spyCash += out * at;
      } else {
        const money = b.units * b.price + fee;
        held += b.units; paid += money;
        spyUnits += money / at;
      }
    }
    if (!paid) return null;
    // What you hold now is holdingOf's, the one place holdings are worked out.
    const h = holdingOf(list, last, events);
    const mine = (h.value || 0) + cash + h.dividends;
    const theirs = spyUnits * spy[spy.length - 1][1] + spyCash;
    return { paid, mine, theirs, gainPct: mine / paid - 1, spyGainPct: theirs / paid - 1, ahead: mine - theirs, asOf: spy[spy.length - 1][0] };
  }
  // The same over several tickers' buys together (the "You hold" line).
  function benchmarkAll(items, spy) {
    let paid = 0, mine = 0, theirs = 0, any = false;
    for (const { buys, last, events } of items) {
      const b = benchmarkOf(buys, spy, last, events);
      if (!b) { if (buys && buys.length) return null; continue; }
      any = true; paid += b.paid; mine += b.mine; theirs += b.theirs;
    }
    return any ? { paid, mine, theirs, gainPct: mine / paid - 1, spyGainPct: theirs / paid - 1, ahead: mine - theirs } : null;
  }

  // ---------- pure: today's price, from Tiingo's IEX feed ----------
  // One ticker's answer → { price, day, at } or null. tngoLast is Tiingo's
  // own last price (the last trade, or the quote's middle when that's the
  // better guess), and becomes the official close once that's printed.
  function parseLive(rows) {
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r || typeof r !== "object") return null;
    const price = [r.tngoLast, r.last, r.mid].map(Number).find((v) => isFinite(v) && v > 0);
    const at = Date.parse(r.timestamp || r.lastSaleTimestamp || "");
    if (!price || !isFinite(at)) return null;
    return { price: Math.round(price * 10000) / 10000, day: nyParts(at).day, at };
  }
  // The closes with today's price laid on the end, when it's from a day
  // after the last close. The live point is marked so the page can say so.
  function withLive(points, live) {
    if (!live || !points || !points.length || live.day <= points[points.length - 1][0]) return points || [];
    const out = points.concat([[live.day, live.price]]);
    out.live = live;
    return out;
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
      noteTargets();
      if (dirty) scheduleSave(0);
      return doc;
    }).catch((e) => { loadError = e; if (!doc) doc = { watchlist: [], pins: [] }; return doc; })
      .finally(() => { loading = null; });
    return loading;
  }
  function changed(item) {
    if (item) item.updatedAt = new Date().toISOString();
    noteTargets();
    widgetsChanged();
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
  // A Google Drive restore: the watchlist and pins as the backup has them,
  // stamped now so a merge with another device's copy keeps them.
  async function replaceDoc(d) {
    await ensureLoaded();
    const at = new Date().toISOString();
    const next = sanitizeDoc(d);
    next.watchlist = next.watchlist.map((w) => ({ ...w, updatedAt: at }));
    doc = next;
    changed();
    await flush();
    if (isOpen()) render({ keepSnapshots: true });
  }
  const isOpen = () => state.view === "finance" && state.financeMode === "invest";
  const onHome = () => state.view === "home";

  // ---------- this device's view: range and the ticker shown ----------
  const UI_KEY = "lifelog-invest-ui";
  let ui = null;
  function uiState() {
    if (ui) return ui;
    try { ui = JSON.parse(localStorage.getItem(UI_KEY) || "{}") || {}; } catch (e) { ui = {}; }
    if (!RANGES.includes(ui.range)) ui.range = "1Y";
    if (typeof ui.bench !== "boolean") ui.bench = true;
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
  const eventsOf = (symbol) => (prices && prices[symbol] && prices[symbol].events) || [];
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
      const err = new Error(res.status === 401 || res.status === 403 ? i18n.t("Tiingo turned the key down")
        : res.status === 404 ? i18n.t("Tiingo doesn't know that ticker")
          : res.status === 429 ? i18n.t("Tiingo's limit for the hour is used up — try again later")
            : i18n.t("Tiingo answered {status}", { status: res.status }) + (said ? ": " + String(said).slice(0, 120) : ""));
      err.status = res.status;
      throw err;
    }
    return body;
  }
  // The closes only change once a trading day, and the free plan allows 50
  // requests an hour: a ticker is asked for again only once its next close
  // should be out (pricesStale), so a weekend or a holiday asks nothing.
  const stale = (symbol) => pricesStale(prices && prices[symbol], Date.now());
  function refresh(symbol, force) {
    if (blocker()) return Promise.resolve(false);
    if (fetching.has(symbol)) return fetching.get(symbol);
    const job = (async () => {
      await loadPrices();
      if (!force && !stale(symbol)) return false;
      const had = prices[symbol];
      // A copy from before splits and dividends were kept (no events) is
      // asked for in full once, on its next due close: no extra request.
      const since = had && had.points && had.points.length && had.events && !force ? had.points[had.points.length - 1][0] : "1980-01-01";
      try {
        let rows = await tiingo("/tiingo-prices/" + encodeURIComponent(symbol) + "?startDate=" + since);
        let points = parseTiingo(rows);
        if (had && had.points && had.points.length && since !== "1980-01-01" && rewritesHistory(rows.slice(1))) {
          rows = await tiingo("/tiingo-prices/" + encodeURIComponent(symbol) + "?startDate=1980-01-01");
          points = parseTiingo(rows);
          prices[symbol] = { at: new Date().toISOString(), points, events: parseEvents(rows) };
        } else if (since === "1980-01-01") {
          prices[symbol] = { at: new Date().toISOString(), points, events: parseEvents(rows) };
        } else {
          prices[symbol] = { at: new Date().toISOString(), points: joinSeries(had.points, points), events: joinEvents(had.events, parseEvents(rows)) };
        }
        lastProblem.delete(symbol);
        savePrices();
        const w = watchlist().find((x) => x.symbol === symbol);
        if (w) checkTarget(w);
        widgetsChanged();
        return true;
      } catch (e) {
        lastProblem.set(symbol, (e && e.name === "TimeoutError") ? i18n.t("Tiingo didn't answer — try again in a bit") : (e && e.message) || i18n.t("Couldn't reach Tiingo"));
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
        if (got && (isOpen() || onHome())) render({ keepSnapshots: true });
      }
      if (wantsBench() && !watchlist().some((w) => w.symbol === BENCHMARK) && await refresh(BENCHMARK)) {
        any = true;
        if (isOpen()) render({ keepSnapshots: true });
      }
    } finally { refreshingAll = false; }
    if (!any && isOpen() && watchlist().some((w) => lastProblem.has(w.symbol))) render({ keepSnapshots: true });
  }
  // SPY's closes too, for the S&P 500 line and the same-money comparison:
  // one more ticker, asked for on the same clock as the rest.
  const benchPoints = () => seriesOf(BENCHMARK);
  const wantsBench = () => watchlist().some((w) => !SAME_INDEX.has(w.symbol));

  // ---------- today's price, while the market trades ----------
  // Asked for while Investments or Home is on screen, from the open of the
  // day after the last close until that close is in, at most every 15
  // minutes a ticker (further apart with many, so the hour's 50 requests
  // keep room for the closes). Kept in memory only: the close replaces it.
  // Targets still go by closes, so a dip within the day doesn't ring.
  const live = new Map();
  let liveRunning = false, liveTimer = null;
  const liveGap = () => Math.max(15, Math.ceil((watchlist().length + 1) * 60 / 30)) * 60000;
  const liveOf = (symbol) => { const l = live.get(symbol); return l && l.price ? l : null; };
  const seriesOf = (symbol) => withLive(pointsOf(symbol), liveOf(symbol));
  const liveWindow = (symbol, now) => { const all = pointsOf(symbol); return all.length > 0 && now >= nyTime(nextTradingDay(all[all.length - 1][0]), OPEN_MIN); };
  async function refreshLive() {
    if (liveRunning || blocker() || !prices || !(isOpen() || onHome())) return;
    liveRunning = true;
    let any = false;
    try {
      const now = Date.now(), gap = liveGap();
      const symbols = watchlist().map((w) => w.symbol);
      if (wantsBench() && !symbols.includes(BENCHMARK)) symbols.push(BENCHMARK);
      for (const symbol of symbols) {
        if (!liveWindow(symbol, now)) { live.delete(symbol); continue; }
        const had = live.get(symbol);
        if (had && now - had.asked < gap) continue;
        try {
          const got = parseLive(await tiingo("/tiingo-iex/" + encodeURIComponent(symbol)));
          live.set(symbol, got ? { ...got, asked: now } : { asked: now });
          if (got && (!had || had.price !== got.price || had.at !== got.at)) any = true;
        } catch (e) {
          live.set(symbol, { ...(had || {}), asked: now });
        }
      }
    } finally { liveRunning = false; }
    if (any) {
      widgetsChanged();
      if (isOpen() || onHome()) render({ keepSnapshots: true });
    }
    clearTimeout(liveTimer);
    if (watchlist().some((w) => liveWindow(w.symbol, Date.now())) && (isOpen() || onHome())) liveTimer = setTimeout(refreshLive, liveGap());
  }
  const clockTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
      c.appendChild(el("div", "empty", i18n.t("Loading your watchlist…")));
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
        title: i18n.t("Nothing on your watchlist yet"),
        body: i18n.t("Follow US stocks and ETFs here: a price chart for each, a target price and a note, and pins on the days you want to compare."),
        action: i18n.t("Add ticker"),
        onAction: () => openWatchModal(null),
        hint: blocker() === "key" ? i18n.t("Prices come from Tiingo with a free key of your own — Settings → Media lookups.") : "",
      }));
      return;
    }
    const w = selected();
    if (!compare || compare.watch !== w.id) compare = null;
    const wrap = el("div", "invest");
    const block = blocker();
    if (block) wrap.appendChild(setupCard(block));
    wrap.appendChild(tickerStrip(w));
    wrap.appendChild(chartCard(w));
    wrap.appendChild(listCard(w));
    c.appendChild(wrap);
    if (prices) refreshAll().then(refreshLive);
  }

  // On a phone the Watching list sits under the chart and the pins, so the
  // tickers also run as a row of chips over the chart (hidden on a computer).
  function tickerStrip(current) {
    const row = el("div", "invest-strip no-swipe");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", i18n.t("Tickers"));
    const range = uiState().range;
    for (const w of watchlist()) {
      const all = seriesOf(w.symbol);
      const pts = sliceRange(all, range);
      const ch = pts.length > 1 ? changeOf(pts[0][1], all[all.length - 1][1]) : null;
      const chip = el("button", "invest-chip" + (w === current ? " on" : ""));
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(w === current));
      chip.appendChild(el("b", null, w.symbol));
      if (ch != null) chip.appendChild(el("span", ch >= 0 ? "invest-up" : "invest-down", pct(ch)));
      chip.onclick = () => { setUi({ selected: w.id }); render({ keepSnapshots: true }); };
      row.appendChild(chip);
    }
    const add = el("button", "invest-chip invest-chip-add");
    add.type = "button";
    add.setAttribute("aria-label", i18n.t("Add ticker"));
    add.appendChild(ico("plus"));
    add.onclick = () => openWatchModal(null);
    row.appendChild(add);
    // The picked chip in view, for a list wider than the phone.
    requestAnimationFrame(() => { const on = row.querySelector(".on"); if (on && row.scrollWidth > row.clientWidth) row.scrollLeft = on.offsetLeft - 16; });
    return row;
  }

  function setupCard(block) {
    const card = el("div", "card invest-setup");
    const tx = el("div", "invest-setup-text");
    tx.appendChild(el("b", null, block === "key" ? i18n.t("Add a Tiingo key to see prices") : i18n.t("Prices need the CORS proxy")));
    tx.appendChild(el("span", null, block === "key"
      ? i18n.t("Free at tiingo.com, for personal use. Paste it under Media lookups; it syncs like your other keys.")
      : i18n.t("A browser can't call Tiingo directly. Set the proxy URL under Media lookups, or use the phone or desktop app.")));
    card.appendChild(tx);
    const btn = el("button", "btn", i18n.t("Open Media lookups"));
    btn.type = "button";
    btn.onclick = () => openSettings && openSettings("media");
    card.appendChild(btn);
    return card;
  }

  function chartCard(w) {
    const card = el("div", "card invest-chart-card");
    const all = seriesOf(w.symbol);
    const range = uiState().range;
    const pts = sliceRange(all, range);
    const last = all.length ? all[all.length - 1] : null;

    const head = el("div", "invest-head");
    head.appendChild(el("span", "invest-sym", w.symbol));
    if (w.name) head.appendChild(el("span", "invest-name", w.name));
    const edit = el("button", "btn btn-icon invest-edit");
    edit.type = "button";
    edit.appendChild(ico("pencil"));
    edit.setAttribute("aria-label", i18n.t("Edit {name}", { name: w.symbol }));
    edit.title = i18n.t("Target, note, remove");
    edit.onclick = () => openWatchModal(w);
    // The S&P 500 line on the chart, on or off for this device.
    if (!SAME_INDEX.has(w.symbol)) {
      const on = uiState().bench;
      const b = el("button", "btn btn-sm invest-bench-btn" + (on ? " on" : ""), i18n.t("S&P 500"));
      b.type = "button";
      b.setAttribute("aria-pressed", String(on));
      b.title = i18n.t("Show the S&P 500 beside the ticker");
      b.onclick = () => { setUi({ bench: !uiState().bench }); render({ keepSnapshots: true }); };
      head.appendChild(b);
    }
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
      card.appendChild(el("div", "invest-meta", metaLine(all)));
    }
    if (w.target || w.note) {
      const note = el("div", "invest-note");
      if (w.target) {
        // Measured from the last close: the target rings on closes, not
        // on today's price.
        const closes = pointsOf(w.symbol);
        const close = closes.length ? closes[closes.length - 1][1] : null;
        const gap = close != null ? changeOf(w.target, close) : null;
        const words = gap == null ? "" : " · " + (Math.abs(gap) < 0.0005 ? i18n.t("at it") : gap > 0 ? i18n.t("{pct}% above", { pct: Math.abs(gap * 100).toFixed(1) }) : i18n.t("{pct}% below", { pct: Math.abs(gap * 100).toFixed(1) }));
        note.appendChild(el("span", "invest-target" + (atTarget(w, close) ? " is-hit" : ""), targetWords(w) + words));
      }
      if (w.note) note.appendChild(el("span", "invest-note-text", w.note));
      card.appendChild(note);
    }

    const problem = lastProblem.get(w.symbol);
    if (pts.length > 1) card.appendChild(chart(w, pts, all, last));
    else {
      const msg = blocker() ? i18n.t("No prices yet.") : problem ? problem : fetching.has(w.symbol) || !prices ? i18n.t("Getting prices…") : i18n.t("No prices for this range.");
      card.appendChild(el("div", "invest-chart-empty", msg));
    }
    if (problem && pts.length > 1) card.appendChild(el("p", "invest-problem", problem + ". " + i18n.t("Showing the prices kept on this device.")));
    card.appendChild(holdingBlock(w, all, last));
    const bench = benchBlock(w);
    if (bench) card.appendChild(bench);
    card.appendChild(pinsBlock(w, all));
    return card;
  }
  // Under the price: the last close and that day's move, or today's price
  // so far while the market trades; then when it next opens or closes.
  function metaLine(all, now = Date.now()) {
    const last = all[all.length - 1];
    const prev = all.length > 1 ? all[all.length - 2][1] : null;
    const m = marketNow(now);
    const bits = [];
    if (all.live) {
      bits.push(i18n.t("As of {time}", { time: clockTime(all.live.at) }));
      if (prev) bits.push(i18n.t("{amount} today", { amount: pct(changeOf(prev, last[1])) }));
      if (m.open) bits.push(i18n.t("Closes in {wait}", { wait: waitWords(nyTime(m.day, 16 * 60) - now) }));
    } else {
      bits.push(i18n.t("Closed {date}", { date: Dates().day(last[0], { weekday: true, year: "auto" }) }));
      if (prev) bits.push(i18n.t("{pct} that day", { pct: pct(changeOf(prev, last[1])) }));
      if (!m.open) bits.push(i18n.t("Opens in {wait}", { wait: waitWords(m.opensAt - now) }));
    }
    return bits.join(" · ");
  }
  // The same money in the S&P 500: what your buys and sales on this
  // ticker would be worth had they gone into SPY on the same days.
  function benchBlock(w) {
    if (SAME_INDEX.has(w.symbol) || !(w.buys && w.buys.length)) return null;
    const all = seriesOf(w.symbol);
    const b = benchmarkOf(w.buys, benchPoints(), all.length ? all[all.length - 1][1] : null, eventsOf(w.symbol));
    if (!b) return null;
    const p = el("p", "invest-bench");
    p.appendChild(ico("activity"));
    const tx = el("span");
    tx.appendChild(document.createTextNode(i18n.t("The same money in the S&P 500 would be worth {amount} ({pct}).", { amount: usd(b.theirs), pct: pct(b.spyGainPct) }) + " "));
    const ahead = Math.abs(b.ahead) < 0.005 ? i18n.t("You're even with it.") : b.ahead > 0 ? i18n.t("You're {amount} ahead.", { amount: usd(b.ahead) }) : i18n.t("You're {amount} behind.", { amount: usd(-b.ahead) });
    tx.appendChild(el("b", b.ahead >= 0 ? "invest-up" : "invest-down", ahead));
    p.appendChild(tx);
    p.title = i18n.t("SPY bought with each buy's dollars on its day and sold with each sale's, dividends reinvested.");
    return p;
  }
  function rangeWords(range) {
    return { "1M": i18n.t("past month"), "3M": i18n.t("past 3 months"), "6M": i18n.t("past 6 months"), "YTD": i18n.t("this year"), "1Y": i18n.t("past year"), "5Y": i18n.t("past 5 years"), "Max": i18n.t("all time") }[range] || "";
  }

  // The chart: a line of closes over the range, a dashed line at the target
  // when it's near enough to share the scale, and the pins as numbered flags.
  // Hovering (or dragging a finger) shows a day's close; a click or tap holds
  // it, with buttons to pin that day or log a buy on it, and the next drag
  // reads the move from the held day.
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
  // SPY's closes on a range's days, scaled to start at the ticker's first
  // close there; null when it's off, the ticker is the index itself, or
  // SPY's prices don't cover the range.
  function benchSeries(w, pts) {
    if (!uiState().bench || SAME_INDEX.has(w.symbol) || pts.length < 2) return null;
    const spy = benchPoints();
    const base = priceOn(spy, pts[0][0]);
    if (!base) return null;
    return pts.map((p) => pts[0][1] * (priceOn(spy, p[0]) || base) / base);
  }
  function chart(w, pts, all, lastPt) {
    // A sideways drag here scrubs the days, so it mustn't also switch Ledger mode.
    const outer = el("div", "invest-chart-wrap");
    const box = el("div", "invest-chart no-swipe");
    outer.appendChild(box);
    const W = 1000, H = 300;
    const hold = holdingOf(w.buys, lastPt ? lastPt[1] : null, eventsOf(w.symbol));
    let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
    // A target (or your average cost) close to the range joins the scale; one
    // far off would flatten the line to fit it, so it's left to the chip above.
    const span0 = hi - lo || hi * 0.02 || 1;
    const near = (v) => v && v > lo - span0 * 0.35 && v < hi + span0 * 0.35;
    const showTarget = near(w.target);
    const showAvg = hold.units > 0 && near(hold.avg);
    if (showTarget) { lo = Math.min(lo, w.target); hi = Math.max(hi, w.target); }
    if (showAvg) { lo = Math.min(lo, hold.avg); hi = Math.max(hi, hold.avg); }
    // The S&P 500 (SPY) over the same days, started at this ticker's first
    // price so the two lines part where one did better. It joins the scale.
    const bench = benchSeries(w, pts);
    if (bench) for (const v of bench) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
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
    if (showAvg) svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: y(hold.avg), y2: y(hold.avg) }, "invest-avgline"));
    if (bench) svg.appendChild(svgEl("path", { d: bench.map((v, i) => (i ? "L" : "M") + x(i).toFixed(2) + "," + y(v).toFixed(2)).join("") }, "invest-benchline"));
    svg.appendChild(svgEl("path", { d }, "invest-line " + (up ? "up" : "down")));
    const anchorLine = svgEl("line", { x1: 0, x2: 0, y1: 0, y2: H }, "invest-anchor");
    anchorLine.style.display = "none";
    svg.appendChild(anchorLine);
    const cross = svgEl("line", { x1: 0, x2: 0, y1: 0, y2: H }, "invest-cross");
    cross.style.display = "none";
    svg.appendChild(cross);
    box.appendChild(svg);
    const buys = (w.buys || []).filter((b) => b.date >= pts[0][0] && b.date <= pts[n - 1][0]);

    // Labels in pixels, placed once the box has a size.
    const place = () => {
      for (const n2 of box.querySelectorAll(".invest-yl, .invest-xl, .invest-flag, .invest-pindot, .invest-tlabel, .invest-buymark, .invest-benchlabel")) n2.remove();
      const cw = svg.clientWidth, ch = svg.clientHeight;
      if (!cw || !ch) return;
      for (const v of ticks) {
        const l = el("span", "invest-yl", "$" + (step < 1 ? v.toFixed(2) : Math.round(v).toLocaleString(numLocale())));
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
      // Buys as small marks under the line, sells over it.
      for (const b of buys) {
        const i = indexOfDay(b.date);
        const m = el("span", "invest-buymark" + (b.sell ? " is-sell" : ""));
        m.style.left = (i / (n - 1) * cw) + "px";
        m.style.top = (y(pts[i][1]) / H * ch) + "px";
        m.title = (b.sell ? i18n.t("Sold {units} at {price}", { units: unitsText(b.units), price: usd(b.price) }) : i18n.t("Bought {units} at {price}", { units: unitsText(b.units), price: usd(b.price) })) + " · " + Dates().day(b.date);
        box.appendChild(m);
      }
      if (bench) {
        const t = el("span", "invest-benchlabel", i18n.t("S&P 500 {pct}", { pct: pct(changeOf(bench[0], bench[n - 1])) }));
        t.style.top = (y(bench[n - 1]) / H * ch) + "px";
        box.appendChild(t);
      }
      if (showTarget) {
        const t = el("span", "invest-tlabel", targetWords(w));
        t.style.top = (y(w.target) / H * ch) + "px";
        box.appendChild(t);
      }
      if (showAvg) {
        const t = el("span", "invest-tlabel is-avg", i18n.t("Your average {price}", { price: usd(hold.avg) }));
        t.style.top = (y(hold.avg) / H * ch) + "px";
        // Off to the right when it would sit on the target's label.
        if (showTarget && Math.abs(y(hold.avg) - y(w.target)) / H * ch < 22) t.classList.add("is-right");
        box.appendChild(t);
      }
    };
    requestAnimationFrame(place);
    // One chart on screen at a time, so one observer: the last render's goes.
    if (chartObserver) chartObserver.disconnect();
    if (window.ResizeObserver) { let last = 0; chartObserver = new ResizeObserver(() => { const wdt = svg.clientWidth; if (wdt !== last) { last = wdt; place(); } }); chartObserver.observe(svg); }

    // The day under the pointer, measured from the start of the range, or
    // from the held day once one is held (a tap or a click holds it; a drag
    // then reads the move between the two).
    const tip = el("div", "invest-tip");
    tip.hidden = true;
    const dot = el("span", "invest-dot");
    dot.hidden = true;
    const anchorDot = el("span", "invest-dot is-anchor");
    anchorDot.hidden = true;
    box.appendChild(anchorDot);
    box.appendChild(dot);
    box.appendChild(tip);
    const bar = el("div", "invest-held");
    bar.hidden = true;
    outer.appendChild(bar);
    let held = null;
    const indexAt = (clientX, r) => Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1))));
    const show = (clientX) => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const i = indexAt(clientX, r);
      const [day, close] = pts[i];
      const px = i / (n - 1) * r.width, py = y(close) / H * r.height;
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.style.display = "";
      dot.hidden = false; dot.style.left = px + "px"; dot.style.top = py + "px";
      tip.innerHTML = "";
      tip.appendChild(el("b", null, usd(close)));
      tip.appendChild(el("span", null, Dates().day(day, { weekday: true })));
      if (held != null && held !== i) {
        const c = compareDays(pts, pts[held][0], day);
        const line = el("span", "invest-tip-cmp");
        line.appendChild(el("span", c.change >= 0 ? "invest-up" : "invest-down", pct(c.change)));
        line.appendChild(document.createTextNode(" " + (day < pts[held][0] ? i18n.t("{amount} over {span} to {date}", { amount: signedUsd(c.diff), span: spanLabel(c.days), date: Dates().day(pts[held][0], { year: "auto" }) }) : i18n.t("{amount} over {span} from {date}", { amount: signedUsd(c.diff), span: spanLabel(c.days), date: Dates().day(pts[held][0], { year: "auto" }) }))));
        tip.appendChild(line);
      } else if (held == null) {
        tip.appendChild(el("span", null, i18n.t("{pct} from {date}", { pct: pct(changeOf(pts[0][1], close)), date: Dates().day(pts[0][0], { year: "auto" }) })));
        if (bench) tip.appendChild(el("span", "invest-tip-bench", i18n.t("S&P 500 {pct}", { pct: pct(changeOf(bench[0], bench[i])) })));
      }
      tip.hidden = false;
      const half = Math.min(130, r.width / 2);
      tip.style.left = Math.min(Math.max(px, half), r.width - half) + "px";
      tip.style.top = py + "px";
      tip.classList.toggle("below", py < 90);
    };
    const hide = () => { tip.hidden = true; dot.hidden = true; cross.style.display = "none"; };
    const release = () => {
      held = null; bar.hidden = true; anchorDot.hidden = true; anchorLine.style.display = "none";
    };
    const holdAt = (clientX) => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      held = indexAt(clientX, r);
      const [day, close] = pts[held];
      anchorLine.setAttribute("x1", x(held)); anchorLine.setAttribute("x2", x(held)); anchorLine.style.display = "";
      anchorDot.hidden = false;
      anchorDot.style.left = (held / (n - 1) * r.width) + "px";
      anchorDot.style.top = (y(close) / H * r.height) + "px";
      bar.innerHTML = "";
      const t = el("span", "invest-held-t");
      t.appendChild(el("b", null, usd(close)));
      t.appendChild(el("span", null, Dates().day(day, { weekday: true, year: "auto" }) + " · " + i18n.t("{pct} to the latest close", { pct: pct(changeOf(close, pts[n - 1][1])) })));
      bar.appendChild(t);
      const pinBtn = el("button", "btn btn-sm invest-pin-btn");
      pinBtn.type = "button";
      pinBtn.appendChild(ico("pin"));
      pinBtn.appendChild(document.createTextNode(i18n.t("Pin this day")));
      pinBtn.onclick = (ev) => { ev.stopPropagation(); openPinModal(null, w, day); };
      bar.appendChild(pinBtn);
      const buyBtn = el("button", "btn btn-sm invest-buy-here");
      buyBtn.type = "button";
      buyBtn.appendChild(document.createTextNode(i18n.t("+ Buy on this day")));
      buyBtn.onclick = (ev) => { ev.stopPropagation(); openBuyModal(null, w, day); };
      bar.appendChild(buyBtn);
      const x2 = el("button", "btn btn-icon btn-sm invest-held-x");
      x2.type = "button";
      x2.setAttribute("aria-label", i18n.t("Let the day go"));
      x2.appendChild(ico("x"));
      x2.onclick = (ev) => { ev.stopPropagation(); release(); };
      bar.appendChild(x2);
      bar.hidden = false;
    };
    svg.addEventListener("pointermove", (e) => show(e.clientX));
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    // A finger lifted after scrubbing lets the readout go; the held day stays.
    svg.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") hide(); });
    svg.addEventListener("pointercancel", (e) => { if (e.pointerType !== "mouse") hide(); });
    svg.addEventListener("click", (e) => { holdAt(e.clientX); if (e.pointerType === "mouse" || !e.pointerType) show(e.clientX); });
    document.addEventListener("pointerdown", function off(e) {
      if (!outer.isConnected) { document.removeEventListener("pointerdown", off); return; }
      if (held != null && !outer.contains(e.target) && !e.target.closest(".modal-overlay")) release();
    });
    svg.style.touchAction = "pan-y";
    return outer;
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

  // Under the four numbers: the dividends paid, the yearly return and, when
  // sales or dividends make it differ from the gain, everything together.
  // `h` is holdingOf's (or the same fields summed); null with none to say.
  function returnsLine(h, yearly) {
    const bits = [];
    if (h.dividends >= 0.005) bits.push([i18n.t("Dividends"), usd(h.dividends), "", i18n.t("Cash dividends on the shares held the day before each, before tax")]);
    if (yearly != null) bits.push([i18n.t("A year"), pct(yearly), yearly >= 0 ? "invest-up" : "invest-down", i18n.t("The money-weighted return a year: each buy, sale and dividend counted from its own day")]);
    if (h.total != null && (Math.abs(h.realized) >= 0.005 || h.dividends >= 0.005)) bits.push([i18n.t("All in"), signedUsd(h.total), h.total >= 0 ? "invest-up" : "invest-down", i18n.t("What's held, what sales brought and the dividends, against all that was paid")]);
    if (!bits.length) return null;
    const p = el("p", "invest-returns");
    for (const [label, value, cls, tip] of bits) {
      const span = el("span", "invest-return");
      span.title = tip;
      span.appendChild(document.createTextNode(label + " "));
      span.appendChild(el("b", cls || null, value));
      p.appendChild(span);
    }
    return p;
  }

  // What you hold of a ticker: from the buys and sells you've logged, at
  // average cost. Typed in by hand (Blink has no export), so it stays small:
  // the four numbers, then the buys, each opening to edit.
  function holdingBlock(w, all, last) {
    const block = el("div", "invest-hold");
    const h = el("h3");
    h.appendChild(ico("coins"));
    h.appendChild(document.createTextNode(i18n.t("Holding")));
    const add = el("button", "btn invest-addbuy", i18n.t("+ Add buy"));
    add.type = "button";
    add.onclick = () => openBuyModal(null, w, last ? last[0] : todayStr());
    h.appendChild(add);
    block.appendChild(h);
    const buys = w.buys || [];
    if (!buys.length) {
      block.appendChild(el("p", "invest-pins-empty", i18n.t("Log what you bought (and sold) to see what you hold, what it cost and how it's doing.")));
      return block;
    }
    const hd = holdingOf(buys, last ? last[1] : null, eventsOf(w.symbol));
    const stats = el("div", "invest-hold-stats");
    const stat = (label, value, cls) => {
      const s2 = el("div", "invest-stat");
      s2.appendChild(el("span", null, label));
      s2.appendChild(el("b", cls || null, value));
      stats.appendChild(s2);
    };
    stat(i18n.t("Shares"), hd.units ? (Math.round(hd.units * 1e4) / 1e4).toLocaleString(numLocale(), { maximumFractionDigits: 4 }) : "0");
    stat(i18n.t("Average cost"), hd.avg != null ? usd(hd.avg) : "—");
    stat(i18n.t("Value"), hd.value != null ? usd(hd.value) : hd.units ? "—" : usd(0));
    stat(i18n.t("Gain"), hd.gain != null ? signedUsd(hd.gain) + (hd.gainPct != null ? " (" + pct(hd.gainPct) + ")" : "") : "—",
      hd.gain == null ? "" : hd.gain >= 0 ? "invest-up" : "invest-down");
    block.appendChild(stats);
    if (Math.abs(hd.realized) >= 0.005) {
      block.appendChild(el("p", "invest-hold-note", i18n.t("Sales so far made {amount} over what those shares cost.", { amount: signedUsd(hd.realized) })));
    }
    const more = returnsLine(hd, yearlyReturn(hd.flows, hd.value, last && last[0]));
    if (more) block.appendChild(more);
    const list = el("div", "invest-buys");
    for (const b of [...sortBuys(buys)].reverse()) {
      const row = el("button", "invest-buy" + (b.sell ? " is-sell" : ""));
      row.type = "button";
      row.appendChild(el("span", "invest-buy-k", b.sell ? i18n.t("Sell") : i18n.t("Buy")));
      const l = el("span", "invest-pin-l");
      l.appendChild(el("b", null, i18n.t("{units} at {price}", { units: unitsText(b.units), price: usd(b.price) })));
      l.appendChild(el("span", null, Dates().day(b.date) + (b.fee ? " · " + i18n.t("{amount} fee", { amount: usd(b.fee) }) : "") + (b.note ? " · " + b.note : "")));
      row.appendChild(l);
      row.appendChild(el("span", "invest-pin-v", usd(b.units * b.price + (b.sell ? -1 : 1) * (b.fee || 0))));
      row.setAttribute("aria-label", (b.sell ? i18n.t("Edit sale on {date}", { date: Dates().day(b.date) }) : i18n.t("Edit buy on {date}", { date: Dates().day(b.date) })));
      row.onclick = () => openBuyModal(b, w);
      list.appendChild(row);
    }
    block.appendChild(list);
    return block;
  }

  // Any two pins (or a pin and the latest close) compared: Compare turns
  // the rows into picks, and the change between the two shows under them.
  let compare = null;
  function pinsBlock(w, all) {
    const block = el("div", "invest-pins");
    const h = el("h3");
    h.appendChild(ico("pin"));
    h.appendChild(document.createTextNode(i18n.t("Pins")));
    const pins = pinsOf(w.id);
    const comparing = compare && compare.watch === w.id;
    if (pins.length >= 2 || (pins.length === 1 && all.length)) {
      const cmp = el("button", "btn invest-compare-btn" + (comparing ? " on" : ""));
      cmp.type = "button";
      cmp.setAttribute("aria-pressed", String(!!comparing));
      cmp.appendChild(ico(comparing ? "check" : "arrow-left-right"));
      cmp.appendChild(document.createTextNode(comparing ? i18n.t("Done") : i18n.t("Compare")));
      cmp.onclick = () => { compare = comparing ? null : { watch: w.id, picked: [] }; render({ keepSnapshots: true }); };
      h.appendChild(cmp);
    }
    const add = el("button", "btn invest-addpin", i18n.t("+ Pin a date"));
    add.type = "button";
    add.onclick = () => openPinModal(null, w, all.length ? all[all.length - 1][0] : todayStr());
    h.appendChild(add);
    block.appendChild(h);
    if (!pins.length) {
      block.appendChild(el("p", "invest-pins-empty", i18n.t("Pin a day to compare the price then and now — when you bought, a dip, a piece of news. Tap the chart to pin the day under your finger.")));
      return block;
    }
    const s = pinSteps(pins, all);
    const gap = (change, from, to, days) => {
      const row = el("div", "invest-gap");
      if (change != null) {
        row.appendChild(el("span", change >= 0 ? "invest-up" : "invest-down", pct(change)));
        row.appendChild(el("span", null, i18n.t("{amount} over {span}", { amount: signedUsd(to - from), span: spanLabel(days) })));
      } else row.appendChild(el("span", null, i18n.t("No price for one of these days")));
      return row;
    };
    const pickKey = (st) => (st === "now" ? "now" : st.pin.id);
    const isPicked = (key) => comparing && compare.picked.includes(key);
    const pick = (key) => {
      const p = compare.picked;
      if (p.includes(key)) p.splice(p.indexOf(key), 1);
      else { p.push(key); if (p.length > 2) p.shift(); }
      render({ keepSnapshots: true });
    };
    if (comparing) {
      const picked = compare.picked;
      const dayOf = (key) => (key === "now" ? (s.now && s.now.day) : (pins.find((p) => p.id === key) || {}).date);
      const nameOf = (key) => {
        if (key === "now") return i18n.t("the latest close");
        const k = s.steps.findIndex((st) => st.pin.id === key);
        return k < 0 ? "" : (s.steps[k].pin.label || i18n.t("Pin {n}", { n: k + 1 }));
      };
      const box = el("div", "invest-compare");
      if (picked.length < 2) box.appendChild(el("span", null, picked.length ? i18n.t("Now pick a second one.") : i18n.t("Pick two pins, or a pin and the latest close.")));
      else {
        const [a, b] = [...picked].sort((x, y) => String(dayOf(x)).localeCompare(String(dayOf(y))));
        const c = compareDays(all, dayOf(a), dayOf(b));
        const head = el("span", "invest-compare-h", nameOf(a) + " → " + nameOf(b));
        box.appendChild(head);
        const line = el("span", "invest-compare-v");
        if (c.change != null) {
          line.appendChild(el("b", c.change >= 0 ? "invest-up" : "invest-down", pct(c.change)));
          line.appendChild(document.createTextNode(" " + i18n.t("{amount} a share over {span}", { amount: signedUsd(c.diff), span: spanLabel(c.days) })));
        } else line.appendChild(document.createTextNode(i18n.t("No price for one of these days")));
        box.appendChild(line);
      }
      block.appendChild(box);
    }
    s.steps.forEach((st, k) => {
      if (k) { const prev = s.steps[k - 1]; block.appendChild(gap(st.change, prev.price, st.price, st.days)); }
      const row = el("button", "invest-pin" + (isPicked(pickKey(st)) ? " is-picked" : ""));
      row.type = "button";
      row.appendChild(el("span", "invest-pin-n", String(k + 1)));
      const l = el("span", "invest-pin-l");
      l.appendChild(el("b", null, st.pin.label || i18n.t("Pin {n}", { n: k + 1 })));
      l.appendChild(el("span", null, Dates().day(st.pin.date)));
      row.appendChild(l);
      row.appendChild(el("span", "invest-pin-v", st.price != null ? usd(st.price) : "—"));
      if (comparing) {
        row.setAttribute("aria-pressed", String(isPicked(pickKey(st))));
        row.setAttribute("aria-label", i18n.t("Compare pin {n}", { n: k + 1 }));
        row.onclick = () => pick(pickKey(st));
      } else {
        row.setAttribute("aria-label", i18n.t("Edit pin {n}", { n: k + 1 }));
        row.onclick = () => openPinModal(st.pin, w);
      }
      block.appendChild(row);
    });
    if (s.now) {
      const lastStep = s.steps[s.steps.length - 1];
      block.appendChild(gap(s.now.change, lastStep.price, s.now.price, s.now.days));
      const row = el(comparing ? "button" : "div", "invest-pin is-now" + (isPicked("now") ? " is-picked" : ""));
      if (comparing) {
        row.type = "button";
        row.setAttribute("aria-pressed", String(isPicked("now")));
        row.onclick = () => pick("now");
      }
      const n = el("span", "invest-pin-n is-now");
      n.appendChild(ico("clock"));
      row.appendChild(n);
      const l = el("span", "invest-pin-l");
      l.appendChild(el("b", null, i18n.t("Latest close")));
      l.appendChild(el("span", null, Dates().day(s.now.day)));
      row.appendChild(l);
      row.appendChild(el("span", "invest-pin-v", usd(s.now.price)));
      block.appendChild(row);
    }
    if (s.total != null) {
      const t = el("div", "invest-total");
      t.appendChild(el("span", null, i18n.t("Since pin 1 ({span})", { span: spanLabel(s.totalDays) })));
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
    h.appendChild(document.createTextNode(i18n.t("Watching")));
    const add = el("button", "btn", i18n.t("+ Add ticker"));
    add.type = "button";
    add.onclick = () => openWatchModal(null);
    h.appendChild(add);
    card.appendChild(h);
    const range = uiState().range;
    // Everything you hold, together, when any ticker has buys.
    const every = watchlist().filter((w) => w.buys && w.buys.length).map((w) => { const all = seriesOf(w.symbol); return { w, last: all.length ? all[all.length - 1] : null, h: holdingOf(w.buys, all.length ? all[all.length - 1][1] : null, eventsOf(w.symbol)) }; });
    const held = every.map((x) => x.h).filter((x) => x.units > 0);
    if (held.length) {
      const value = held.reduce((t, x) => t + (x.value || 0), 0);
      const cost = held.filter((x) => x.value != null).reduce((t, x) => t + x.cost, 0);
      const gain = value - cost;
      const sum = el("div", "invest-sum");
      sum.appendChild(el("span", null, i18n.t("You hold")));
      sum.appendChild(el("b", null, usd(value)));
      if (cost) sum.appendChild(el("span", gain >= 0 ? "invest-up" : "invest-down", signedUsd(gain) + " (" + pct(gain / cost) + ")"));
      card.appendChild(sum);
      // The dividends, yearly return and all in over every ticker bought,
      // sold out of ones too; no yearly figure while one held has no price.
      const tot = { dividends: 0, realized: 0, total: 0 };
      const flows = [];
      let day = "", priced = true;
      for (const x of every) {
        tot.dividends += x.h.dividends; tot.realized += x.h.realized;
        if (x.h.total == null) priced = false; else tot.total += x.h.total;
        flows.push(...x.h.flows);
        if (x.last && x.last[0] > day) day = x.last[0];
      }
      if (!priced) tot.total = null;
      const more = returnsLine(tot, priced ? yearlyReturn(flows, value, day) : null);
      if (more) { more.classList.add("invest-sum-returns"); card.appendChild(more); }
      // Everything bought and sold, against the same money in SPY.
      const all = benchmarkAll(every.map((x) => ({ buys: x.w.buys, last: x.last ? x.last[1] : null, events: eventsOf(x.w.symbol) })), benchPoints());
      if (all) {
        const line = el("p", "invest-bench invest-bench-sum");
        line.appendChild(ico("activity"));
        line.appendChild(el("span", null, i18n.t("All you bought: {mine}. The same money in the S&P 500: {theirs}.", { mine: pct(all.gainPct), theirs: pct(all.spyGainPct) })));
        card.appendChild(line);
      }
      const worth = worthCard(every.map((x) => x.w), range);
      if (worth) card.appendChild(worth);
    }
    for (const w of watchlist()) {
      const all = seriesOf(w.symbol);
      const pts = sliceRange(all, range);
      const last = all.length ? all[all.length - 1][1] : null;
      const ch = pts.length > 1 ? changeOf(pts[0][1], last) : null;
      const row = el("button", "invest-row" + (w === current ? " sel" : ""));
      row.type = "button";
      row.setAttribute("aria-pressed", String(w === current));
      const t = el("span", "invest-row-t");
      const sym = el("b", null, w.symbol);
      if (w.target) {
        const closes = pointsOf(w.symbol);
        const hit = atTarget(w, closes.length ? closes[closes.length - 1][1] : null);
        sym.appendChild(el("i", hit ? "is-hit" : "", hit ? i18n.t("At target {price}", { price: usd(w.target) }) : targetWords(w)));
      }
      t.appendChild(sym);
      const hd = holdingOf(w.buys, last, eventsOf(w.symbol));
      t.appendChild(el("span", null, hd.units > 0 ? unitsText(hd.units) + (hd.value != null ? " · " + usd(hd.value) : "") : (w.name || "")));
      row.appendChild(t);
      row.appendChild(sparkline(pts, ch == null || ch >= 0));
      const p = el("span", "invest-row-p");
      p.appendChild(el("b", null, last != null ? usd(last) : "—"));
      p.appendChild(el("span", ch == null ? "" : ch >= 0 ? "invest-up" : "invest-down", ch == null ? "" : pct(ch)));
      row.appendChild(p);
      row.onclick = () => { setUi({ selected: w.id }); render({ keepSnapshots: true }); };
      card.appendChild(row);
    }
    card.appendChild(el("p", "invest-foot", i18n.t("Prices from Tiingo: closes adjusted for splits and dividends, and today's price from IEX every 15 minutes or so while the US market is open. Only the tickers are sent.")));
    return card;
  }

  // What everything held was worth on each day of the range, beside the
  // money put in by then; hovering (or a finger) reads a day.
  function worthCard(list, range) {
    const series = worthSeries(list.map((w) => ({ buys: w.buys, points: seriesOf(w.symbol), events: eventsOf(w.symbol) })));
    const pts = series ? sliceRange(series, range) : [];
    if (pts.length < 2) return null;
    const wrap = el("div", "invest-worth");
    const head = el("div", "invest-worth-h");
    head.appendChild(el("b", null, i18n.t("Worth, {range}", { range: rangeWords(range) })));
    const key = el("span", "invest-worth-key");
    key.appendChild(el("i", "is-worth"));
    key.appendChild(el("span", null, i18n.t("Worth")));
    key.appendChild(el("i", "is-put"));
    key.appendChild(el("span", null, i18n.t("Put in")));
    head.appendChild(key);
    wrap.appendChild(head);
    const box = el("div", "invest-worth-chart no-swipe");
    const W = 1000, H = 120, n = pts.length;
    let lo = Math.min(...pts.map((p) => Math.min(p[1], p[2]))), hi = Math.max(...pts.map((p) => Math.max(p[1], p[2])));
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const x = (i) => (i / (n - 1)) * W;
    const y = (v) => (1 - (v - lo) / (hi - lo)) * H;
    const line = (k) => pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(2) + "," + y(p[k]).toFixed(2)).join("");
    const up = pts[n - 1][1] >= pts[n - 1][2];
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" });
    const d = line(1);
    svg.appendChild(svgEl("path", { d: d + `L${W},${H}L0,${H}Z` }, "invest-area " + (up ? "up" : "down")));
    svg.appendChild(svgEl("path", { d: line(2) }, "invest-putline"));
    key.firstChild.classList.add(up ? "up" : "down");
    svg.appendChild(svgEl("path", { d }, "invest-line " + (up ? "up" : "down")));
    const cross = svgEl("line", { x1: 0, x2: 0, y1: 0, y2: H }, "invest-cross");
    cross.style.display = "none";
    svg.appendChild(cross);
    box.appendChild(svg);
    const tip = el("div", "invest-tip");
    tip.hidden = true;
    const dot = el("span", "invest-dot");
    dot.hidden = true;
    box.appendChild(dot);
    box.appendChild(tip);
    const show = (clientX) => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const i = Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1))));
      const [day, worth, put] = pts[i];
      const px = i / (n - 1) * r.width, py = y(worth) / H * r.height;
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.style.display = "";
      dot.hidden = false; dot.style.left = px + "px"; dot.style.top = py + "px";
      tip.innerHTML = "";
      tip.appendChild(el("b", null, usd(worth)));
      tip.appendChild(el("span", null, Dates().day(day, { weekday: true, year: "auto" })));
      tip.appendChild(el("span", null, i18n.t("Put in {amount}", { amount: usd(put) })));
      tip.hidden = false;
      const half = Math.min(110, r.width / 2);
      tip.style.left = Math.min(Math.max(px, half), r.width - half) + "px";
      tip.style.top = py + "px";
      tip.classList.toggle("below", py < 70);
    };
    const hide = () => { tip.hidden = true; dot.hidden = true; cross.style.display = "none"; };
    svg.addEventListener("pointermove", (e) => show(e.clientX));
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    svg.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") hide(); });
    svg.addEventListener("pointercancel", hide);
    svg.style.touchAction = "pan-y";
    wrap.appendChild(box);
    // The ends, and how far the worth is over (or under) what was put in:
    // a change in % would count new buys as growth.
    const first = pts[0], last = pts[n - 1];
    const foot = el("div", "invest-worth-foot");
    foot.appendChild(el("span", null, Dates().day(first[0], { year: "auto" })));
    const now = el("span");
    const over = last[1] - last[2];
    now.appendChild(el("b", up ? "invest-up" : "invest-down", usd(Math.abs(Math.round(over * 100) / 100))));
    now.appendChild(document.createTextNode(" " + (up ? i18n.t("over what's put in") : i18n.t("under what's put in"))));
    now.title = i18n.t("Worth {worth}, put in {put}", { worth: usd(last[1]), put: usd(last[2]) });
    foot.appendChild(now);
    wrap.appendChild(foot);
    return wrap;
  }


  // ---------- the ticker sheet ----------
  let editingWatch = null, picked = null, searchAsk = 0, searchTimer = null;
  async function openWatchModal(w) {
    await ensureLoaded();
    editingWatch = w || null;
    picked = null;
    $("#watchModalTitle").textContent = w ? i18n.t("Edit {name}", { name: w.symbol }) : i18n.t("Add ticker");
    $("#watchSymbolRow").hidden = !!w;
    $("#watchSymbol").value = "";
    $("#watchResults").innerHTML = "";
    $("#watchResults").hidden = true;
    $("#watchTarget").value = w && w.target ? String(w.target) : "";
    setTargetDir(w && w.targetAbove ? "above" : "below");
    $("#watchNote").value = (w && w.note) || "";
    $("#deleteWatchBtn").hidden = !w;
    $("#watchSaveBtn").textContent = w ? i18n.t("Save") : i18n.t("Add to watchlist");
    $("#watchHint").textContent = !w && blocker() === "key" ? i18n.t("Without a Tiingo key the ticker is added as typed, and its prices come once you add one.") : "";
    $("#watchModal").hidden = false;
    setTimeout(() => (w ? $("#watchTarget") : $("#watchSymbol")).focus(), 0);
  }
  // Which way the target rings: at or under it (to buy), or at or over (to sell).
  let targetDir = "below";
  function setTargetDir(dir) {
    targetDir = dir === "above" ? "above" : "below";
    for (const b of document.querySelectorAll("#watchTargetDir .seg-btn")) {
      const on = b.dataset.dir === targetDir;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
  }
  function closeWatchModal() { $("#watchModal").hidden = true; editingWatch = null; picked = null; searchAsk++; }
  // Each query's matches, kept for the session, so typing back over a word
  // answers at once and costs no request.
  const searchCache = new Map();
  function showResults(list, status) {
    const box = $("#watchResults");
    box.innerHTML = "";
    box.hidden = !list.length && !status;
    if (status) box.appendChild(el("p", "invest-results-status", status));
    for (const r of list.slice(0, 6)) {
      const b = el("button", "invest-result");
      b.type = "button";
      b.appendChild(el("b", null, r.symbol));
      b.appendChild(el("span", null, [r.name, r.type].filter(Boolean).join(" · ")));
      b.onclick = () => { picked = r; $("#watchSymbol").value = r.symbol; box.hidden = true; $("#watchTarget").focus(); };
      box.appendChild(b);
    }
  }
  // The search, and when it fails or finds nothing, the typed text tried as
  // an exact ticker: that route is the one prices already use, so a proxy
  // without /tiingo-search still completes VOO.
  async function findMatches(q) {
    let list = [], problem = null;
    try { list = await search(q); } catch (e) { problem = e; }
    if (problem && (problem.status === 401 || problem.status === 403 || problem.status === 429)) throw problem;
    const exact = cleanSymbol(q);
    if (exact && !list.length) {
      try { const m = await lookup(exact); list.unshift({ symbol: m.symbol, name: m.name, type: "", active: true, country: "" }); }
      catch (e) { /* not a ticker; the search's answer stands */ }
    }
    if (problem && !list.length) throw problem;
    return list;
  }
  function onSymbolInput() {
    picked = null;
    clearTimeout(searchTimer);
    const q = $("#watchSymbol").value.trim();
    const ask = ++searchAsk;
    if (!q) { showResults([]); return; }
    const block = blocker();
    if (block) { showResults([], block === "key" ? i18n.t("Add a Tiingo key in Settings → Media lookups to search as you type") : i18n.t("Searching needs the CORS proxy, in Settings → Media lookups")); return; }
    const key = q.toLowerCase();
    if (searchCache.has(key)) { const hit = searchCache.get(key); showResults(hit, hit.length ? "" : i18n.t("No US tickers match “{q}”", { q })); return; }
    if ($("#watchResults").hidden || !$("#watchResults").querySelector(".invest-result")) showResults([], i18n.t("Searching…"));
    searchTimer = setTimeout(async () => {
      let list = [], status = "";
      try {
        list = await findMatches(q);
        searchCache.set(key, list);
        if (!list.length) status = i18n.t("No US tickers match “{q}”", { q });
      } catch (e) {
        status = (e && e.name === "TimeoutError") ? i18n.t("Tiingo didn't answer — try again in a bit")
          : e && e.status === 404 ? i18n.t("Search isn't on your proxy yet — redeploy proxy/worker.js")
            : (e && e.message) || i18n.t("Couldn't reach Tiingo");
      }
      if (ask === searchAsk && !$("#watchModal").hidden) showResults(list, status);
    }, 250);
  }
  async function saveWatchFromForm() {
    await ensureLoaded();
    const targetRaw = $("#watchTarget").value.trim();
    const target = targetRaw ? cleanPrice(targetRaw) : null;
    if (targetRaw && !target) { toast(i18n.t("A target is a price above zero, like 550"), true); return; }
    const note = $("#watchNote").value;
    if (editingWatch) {
      const w = findWatch(editingWatch.id);
      if (w) {
        const next = sanitizeWatch({ ...w, target: target || undefined, targetAbove: targetDir === "above", note });
        for (const k of ["target", "targetAbove", "note"]) if (next[k] == null) delete w[k];
        Object.assign(w, next);
        changed(w);
        checkTarget(w);
      }
      closeWatchModal();
      render({ keepSnapshots: true });
      return;
    }
    const symbol = cleanSymbol(picked ? picked.symbol : $("#watchSymbol").value);
    if (!symbol) { toast(i18n.t("Type a ticker, like VOO or AAPL"), true); return; }
    const had = watchlist().find((x) => x.symbol === symbol);
    if (had) { setUi({ selected: had.id }); closeWatchModal(); render({ keepSnapshots: true }); toast(i18n.t("{symbol} is already on your watchlist", { symbol })); return; }
    let name = picked ? picked.name : "";
    if (!picked && !blocker()) {
      $("#watchSaveBtn").disabled = true;
      try { const m = await lookup(symbol); name = m.name; }
      catch (e) {
        $("#watchSaveBtn").disabled = false;
        if (e && e.status === 404) { toast(i18n.t("Tiingo doesn't know {symbol} — check the ticker", { symbol }), true); return; }
      }
      $("#watchSaveBtn").disabled = false;
    }
    const now = new Date().toISOString();
    const w = sanitizeWatch({ id: newId(), symbol, name, target: target || undefined, targetAbove: targetDir === "above", note, createdAt: now, updatedAt: now });
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
    toast(i18n.t("Removed {symbol} from your watchlist", { symbol: w.symbol }), false, {
      label: i18n.t("Undo"),
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
    $("#investPinModalTitle").textContent = pin ? i18n.t("Edit pin") : i18n.t("Pin a date");
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
    if (!isDay(date)) { toast(i18n.t("Pick a date for the pin"), true); return; }
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
    toast(i18n.t("Pin removed"), false, { label: i18n.t("Undo"), onClick: () => { doc.pins.push(p); changed(p); render({ keepSnapshots: true }); } });
  }

  // ---------- the buy sheet ----------
  let editingBuy = null, buyWatch = null, buyKind = "buy";
  function setBuyKind(kind) {
    buyKind = kind === "sell" ? "sell" : "buy";
    for (const b of document.querySelectorAll("#investBuyForm .seg-btn")) {
      const on = b.dataset.kind === buyKind;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    $("#investBuyModalTitle").textContent = buyKind === "sell" ? (editingBuy ? i18n.t("Edit sale") : i18n.t("Add sale")) : (editingBuy ? i18n.t("Edit buy") : i18n.t("Add buy"));
    buyTotal();
  }
  function buyTotal() {
    const u = cleanUnits($("#investBuyUnits").value), p = cleanPrice($("#investBuyPrice").value);
    const fee = cleanFee($("#investBuyFee").value) || 0;
    const total = u && p ? u * p + (buyKind === "sell" ? -fee : fee) : null;
    $("#investBuyTotal").textContent = total != null && !isNaN(total) ? (buyKind === "sell" ? i18n.t("You got {amount} in all.", { amount: usd(total) }) : i18n.t("You paid {amount} in all.", { amount: usd(total) })) : i18n.t("The close on that day is filled in; change it to what you paid.");
  }
  function closeOn(day) {
    // The price as it was that day, not adjusted for later splits and
    // dividends: what the broker charged.
    const all = buyWatch ? rawSeries(pointsOf(buyWatch.symbol)) : [];
    const p = priceOn(all, day);
    return p != null ? String(Math.round(p * 100) / 100) : "";
  }
  async function openBuyModal(buy, w, day) {
    await ensureLoaded();
    editingBuy = buy || null;
    buyWatch = w || null;
    if (!buyWatch) return;
    $("#investBuyTicker").textContent = buyWatch.symbol + (buyWatch.name ? " · " + buyWatch.name : "");
    $("#investBuyDate").value = buy ? buy.date : (day || todayStr());
    $("#investBuyDate").max = todayStr();
    $("#investBuyUnits").value = buy ? String(buy.units) : "";
    $("#investBuyPrice").value = buy ? String(buy.price) : closeOn($("#investBuyDate").value);
    $("#investBuyFee").value = buy && buy.fee ? String(buy.fee) : "";
    $("#investBuyNote").value = (buy && buy.note) || "";
    $("#deleteInvestBuyBtn").hidden = !buy;
    setBuyKind(buy && buy.sell ? "sell" : "buy");
    $("#investBuyModal").hidden = false;
    setTimeout(() => $("#investBuyUnits").focus(), 0);
  }
  function closeBuyModal() { $("#investBuyModal").hidden = true; editingBuy = null; buyWatch = null; }
  function saveBuyFromForm() {
    const w = buyWatch && findWatch(buyWatch.id);
    if (!w) { closeBuyModal(); return; }
    const date = $("#investBuyDate").value;
    if (!isDay(date)) { toast(buyKind === "sell" ? i18n.t("Pick the day of the sale") : i18n.t("Pick the day of the buy"), true); return; }
    if (!cleanUnits($("#investBuyUnits").value)) { toast(i18n.t("Shares is a number above zero, like 2.5"), true); return; }
    if (!cleanPrice($("#investBuyPrice").value)) { toast(i18n.t("The price is a number above zero, like 550"), true); return; }
    const fee = cleanFee($("#investBuyFee").value);
    if (Number.isNaN(fee)) { toast(i18n.t("The fee is a number in dollars, like 1.50"), true); return; }
    if (buyKind === "sell" && fee && fee >= cleanUnits($("#investBuyUnits").value) * cleanPrice($("#investBuyPrice").value)) { toast(i18n.t("The fee is more than the sale brought in"), true); return; }
    const now = new Date().toISOString();
    const fields = { date, units: $("#investBuyUnits").value, price: $("#investBuyPrice").value, fee: fee || "", sell: buyKind === "sell", note: $("#investBuyNote").value, updatedAt: now };
    const list = (w.buys || []).slice();
    if (buyKind === "sell") {
      const others = list.filter((b) => !editingBuy || b.id !== editingBuy.id);
      if (!(holdingOf(others.filter((b) => b.date <= date), null, eventsOf(w.symbol)).units > 0)) { toast(i18n.t("Nothing held on that day to sell: log the buy first"), true); return; }
    }
    if (editingBuy) {
      const i = list.findIndex((b) => b.id === editingBuy.id);
      const next = sanitizeBuy({ ...(i >= 0 ? list[i] : editingBuy), ...fields });
      if (!next.sell) delete next.sell;
      if (!next.note) delete next.note;
      if (i >= 0) list[i] = next; else list.push(next);
    } else {
      list.push(sanitizeBuy({ id: newId(), ...fields, createdAt: now }));
    }
    const short = shortSale(list, eventsOf(w.symbol));
    if (short) {
      toast(i18n.t("The sale on {date} would be more than the {units} held then. Check the dates and shares.", { date: Dates().day(short.sale.date, { year: "auto" }), units: unitsText(short.held) }), true);
      return;
    }
    w.buys = sortBuys(list);
    changed(w);
    closeBuyModal();
    render({ keepSnapshots: true });
  }
  function deleteBuy() {
    const w = buyWatch && findWatch(buyWatch.id);
    if (!w || !editingBuy) return;
    const gone = (w.buys || []).find((b) => b.id === editingBuy.id);
    if (!gone) return;
    if (!gone.sell && shortSale(w.buys.filter((b) => b.id !== gone.id), eventsOf(w.symbol))) {
      toast(i18n.t("A later sale needs this buy: change or remove the sale first"), true);
      return;
    }
    w.buys = w.buys.filter((b) => b.id !== gone.id);
    if (!w.buys.length) delete w.buys;
    changed(w);
    closeBuyModal();
    render({ keepSnapshots: true });
    toast(gone.sell ? i18n.t("Sale removed") : i18n.t("Buy removed"), false, {
      label: i18n.t("Undo"),
      onClick: () => { const x = findWatch(w.id); if (!x) return; x.buys = sortBuys([...(x.buys || []), gone]); changed(x); render({ keepSnapshots: true }); },
    });
  }

  // ---------- target alerts ----------
  // A ticker's latest close at its target (at or under it, or with
  // targetAbove at or over it) is recorded once per crossing (alerts.js): a
  // toast here, and on a phone or the desktop app a notification. A close
  // back on the other side, or no target, clears it. Closes only, never
  // today's price: a swing within the day that's gone by the close is noise.
  function checkTarget(w) {
    const A = window.LifeLogAlerts;
    if (!A || !A.targetHit) return;
    const all = pointsOf(w.symbol);
    const last = all.length ? all[all.length - 1][1] : null;
    if (!atTarget(w, last)) { A.targetClear(w.id); return; }
    if (!A.targetHit(w, last)) return;
    const vals = { symbol: w.symbol, price: usd(last), target: usd(w.target) };
    toast(w.targetAbove ? i18n.t("{symbol} closed at {price}, over your {target} target", vals) : i18n.t("{symbol} closed at {price}, under your {target} target", vals), false,
      { label: i18n.t("Show"), onClick: () => { select(w.id); if (openInvest) openInvest(); } });
  }
  // At launch, on coming back to the app and in Android's background run:
  // the tickers with a target, their prices asked for only once their next
  // close should be out, so this costs Tiingo a request a ticker a day.
  // Only on a device that has seen a target, so a launch doesn't ask GitHub
  // for investments.json when nobody watches anything.
  const TARGETS_FLAG = "lifelog-invest-targets", WATCH_FLAG = "lifelog-invest-watch";
  function noteTargets() {
    try {
      if (watchlist().some((w) => w.target)) localStorage.setItem(TARGETS_FLAG, "1");
      else localStorage.removeItem(TARGETS_FLAG);
      if (watchlist().length) localStorage.setItem(WATCH_FLAG, "1");
      else localStorage.removeItem(WATCH_FLAG);
    } catch (e) { /* private window */ }
  }
  // On a phone the same pass keeps the Investments widget's prices fresh:
  // every ticker, not only the targeted ones, on the same clock.
  async function checkTargets() {
    const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    let go = false;
    try { go = !!localStorage.getItem(TARGETS_FLAG) || (native && !!localStorage.getItem(WATCH_FLAG)); } catch (e) { return; }
    if (!go) return;
    try {
      await ensureLoaded();
      noteTargets();
      await loadPrices();
      for (const w of [...watchlist()]) {
        if (!w.target && window.LifeLogAlerts && window.LifeLogAlerts.targetClear) window.LifeLogAlerts.targetClear(w.id);
        if (!w.target && !native) continue;
        await refresh(w.symbol);
        if (w.target) checkTarget(w);
      }
      widgetsChanged();
    } catch (e) { /* the next launch tries again */ }
  }

  // ---------- the Android widget (widgets.js carries it as `invest`) ----------
  // What you hold, then a row per ticker: its close, the day's move and a
  // month's sparkline (0..1, oldest first). Worked out here, where the
  // prices are; the widget only draws it. With the lock's "hide in widgets"
  // on, the tickers stay and the amounts go.
  const WIDGET_ROWS = 8, SPARK_POINTS = 32;
  function widgetOf(list, priceMap, { hidden = false } = {}) {
    if (!list || !list.length) return null;
    let value = 0, cost = 0, today = 0, any = false, lastDay = "", liveAt = 0;
    const rows = [];
    for (const w of list) {
      const entry = (priceMap && priceMap[w.symbol]) || {};
      const closes = entry.points || [];
      const all = withLive(closes, entry.live);
      if (all.live && all.live.at > liveAt) liveAt = all.live.at;
      const last = all.length ? all[all.length - 1] : null;
      const prev = all.length > 1 ? all[all.length - 2][1] : null;
      if (last && last[0] > lastDay) lastDay = last[0];
      const hd = holdingOf(w.buys, last ? last[1] : null, entry.events);
      if (hd.units > 0 && hd.value != null) {
        any = true;
        value += hd.value; cost += hd.cost;
        if (prev != null) today += hd.units * (last[1] - prev);
      }
      const dayCh = last && prev ? changeOf(prev, last[1]) : null;
      const month = sliceRange(all, "1M");
      let spark = [];
      if (month.length > 1) {
        const every = Math.max(1, Math.ceil(month.length / SPARK_POINTS));
        const pts = month.filter((_, i) => i % every === 0 || i === month.length - 1).map((p) => p[1]);
        const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
        spark = pts.map((v) => Math.round(((v - lo) / span) * 1000) / 1000);
      }
      const held = hd.units > 0;
      if (rows.length < WIDGET_ROWS) rows.push({
        id: w.id,
        symbol: w.symbol,
        sub: hidden ? (held ? i18n.t("Holding") : (w.name || "")) : held ? unitsText(hd.units) + (hd.value != null ? " · " + usd(hd.value) : "") : (w.name || ""),
        price: hidden ? "•••" : last ? usd(last[1]) : "—",
        day: hidden || dayCh == null ? "" : pct(dayCh),
        up: dayCh == null || dayCh >= 0,
        sparkUp: month.length < 2 || month[month.length - 1][1] >= month[0][1],
        hit: atTarget(w, closes.length ? closes[closes.length - 1][1] : null),
        spark: hidden ? [] : spark,
      });
    }
    const gain = value - cost, base = value - today;
    const hold = any ? {
      value: hidden ? "•••••" : usd(value),
      short: hidden ? "•••••" : "$" + Math.round(value).toLocaleString(numLocale()),
      gain: hidden ? "" : signedUsd(gain) + (cost ? " (" + pct(gain / cost) + ")" : ""),
      gainPct: hidden || !cost ? "" : pct(gain / cost),
      up: gain >= 0,
      today: hidden ? "" : i18n.t("{amount} today", { amount: signedUsd(today) }),
      todayPct: hidden || !base ? "" : i18n.t("{amount} today", { amount: pct(today / base) }),
      todayUp: today >= 0,
    } : null;
    const closed = liveAt ? i18n.t("As of {time}", { time: clockTime(liveAt) }) : lastDay ? i18n.t("Closed {date}", { date: Dates().day(lastDay, { weekday: true, year: "auto" }) }) : "";
    return { day: lastDay, closed, hold, rows };
  }
  // The snapshot's `invest`, from what's loaded, else what was worked out
  // last time (the watchlist and prices load after the first push).
  const WIDGET_KEY = "lifelog-invest-widget";
  function widgetSnapshot(hidden) {
    if (doc && prices) {
      const map = pricesFor(watchlist());
      const out = widgetOf(watchlist(), map, { hidden: false });
      try { if (out) localStorage.setItem(WIDGET_KEY, JSON.stringify(watchlist().length ? { list: watchlist(), prices: map } : null)); else localStorage.removeItem(WIDGET_KEY); } catch (e) { /* private window */ }
      return hidden ? widgetOf(watchlist(), map, { hidden: true }) : out;
    }
    try {
      const kept = JSON.parse(localStorage.getItem(WIDGET_KEY) || "null");
      return kept ? widgetOf(kept.list, kept.prices, { hidden }) : null;
    } catch (e) { return null; }
  }
  // A month and a day of closes per ticker is all the widget needs, and
  // today's price while there is one (a live price older than the newest
  // close is dropped by withLive).
  function pricesFor(list) {
    const out = {};
    for (const w of list) {
      const all = pointsOf(w.symbol);
      out[w.symbol] = { points: sliceRange(all, "1M").length > 1 ? all.slice(-Math.max(2, sliceRange(all, "1M").length + 1)) : all.slice(-2) };
      // Splits and dividends since the first buy, for the shares held.
      const first = w.buys && w.buys.length ? sortBuys(w.buys)[0].date : null;
      const evs = first ? eventsOf(w.symbol).filter((e) => e[0] >= first) : [];
      if (evs.length) out[w.symbol].events = evs;
      const l = liveOf(w.symbol);
      if (l) out[w.symbol].live = { price: l.price, day: l.day, at: l.at };
    }
    return out;
  }
  const widgetsChanged = () => { if (typeof window !== "undefined" && window.LifeLogWidgets && window.LifeLogWidgets.changed) window.LifeLogWidgets.changed(); };
  function select(id) {
    const w = findWatch(id) || watchlist().find((x) => x.symbol === id);
    setUi({ selected: w ? w.id : id });
  }

  // ---------- Home's Investments section (home.js draws it) ----------
  // The widget's numbers, from what's loaded; null while the watchlist and
  // prices load, with a repaint of Home once they have.
  function homeGlance() {
    if (doc && prices) {
      setTimeout(refreshLive, 0);
      return { ...widgetOf(watchlist(), pricesFor(watchlist())) || { hold: null, rows: [], closed: "" }, count: watchlist().length, blocked: blocker() };
    }
    Promise.all([ensureLoaded(), loadPrices()]).then(() => { if (onHome()) render({ keepSnapshots: true }); }).catch(() => {});
    return null;
  }
  const homeSpark = (row) => sparkline(row.spark.map((v, i) => [i, v]), row.sparkUp);
  function openTicker(id) {
    if (id) select(id);
    if (openInvest) openInvest();
  }

  async function addTicker() { await ensureLoaded(); openWatchModal(null); }

  function wire() {
    $("#watchForm").addEventListener("submit", (e) => { e.preventDefault(); saveWatchFromForm(); });
    $("#cancelWatchBtn").onclick = closeWatchModal;
    $("#deleteWatchBtn").onclick = () => { if (editingWatch) deleteWatch(editingWatch); };
    $("#watchSymbol").addEventListener("input", onSymbolInput);
    for (const b of document.querySelectorAll("#watchTargetDir .seg-btn")) b.onclick = () => setTargetDir(b.dataset.dir);
    $("#investPinForm").addEventListener("submit", (e) => { e.preventDefault(); savePinFromForm(); });
    $("#cancelInvestPinBtn").onclick = closePinModal;
    $("#deleteInvestPinBtn").onclick = () => { if (editingPin) deletePin(editingPin); };
    $("#investBuyForm").addEventListener("submit", (e) => { e.preventDefault(); saveBuyFromForm(); });
    $("#cancelInvestBuyBtn").onclick = closeBuyModal;
    $("#deleteInvestBuyBtn").onclick = deleteBuy;
    for (const b of document.querySelectorAll("#investBuyForm .seg-btn")) b.onclick = () => setBuyKind(b.dataset.kind);
    $("#investBuyUnits").addEventListener("input", buyTotal);
    $("#investBuyPrice").addEventListener("input", buyTotal);
    $("#investBuyFee").addEventListener("input", buyTotal);
    $("#investBuyDate").addEventListener("change", () => { if (!editingBuy) { const p = closeOn($("#investBuyDate").value); if (p) $("#investBuyPrice").value = p; } buyTotal(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && saveTimer) flush(); });
    window.addEventListener("pagehide", () => { if (saveTimer) flush(); });
  }

  const api = {
    init, wire, renderInvest, buildRangeFilter, ensureLoaded, flush, addTicker, replaceDoc,
    openWatchModal, closeWatchModal, openPinModal, closePinModal, openBuyModal, closeBuyModal,
    checkTargets, select, widgetSnapshot, homeGlance, homeSpark, openTicker,
    // pure, for tests and the bridge
    sanitizeWatch, sanitizePin, sanitizeBuy, sanitizeDoc, cleanSymbol, cleanPrice, cleanUnits, cleanFee,
    holdingOf, shortSale, yearlyReturn, worthSeries, parseEvents, joinEvents, rawSeries, compareDays, unitsText, signedUsd, widgetOf,
    RANGES, rangeStart, sliceRange, priceOn, changeOf, pinSteps, spanLabel, pct, usd,
    parseTiingo, rewritesHistory, joinSeries, parseSearch,
    atTarget, benchmarkOf, benchmarkAll, BENCHMARK, SAME_INDEX,
    marketHolidays, isTradingDay, nextTradingDay, nyTime, nyParts, closeDueAt, pricesStale, marketNow, waitWords, parseLive, withLive,
  };
  if (typeof window !== "undefined") window.LifeLogInvest = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
