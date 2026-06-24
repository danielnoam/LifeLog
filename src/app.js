// LifeLog — main app logic (vanilla JS, no build step).
(function () {
  const Storage = window.LifeLogStorage;
  const MONTHS = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const DEFAULT_SETTINGS = { monthOrder: "asc", currency: "ILS", mediaCategorySources: {}, mediaKeys: { rawg: "", tmdb: "", ggdeals: "" } }; // monthOrder, currency, mediaCategorySources, mediaKeys — synced
  const CURRENCY_SYMBOLS = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };
  const DEFAULT_VISUAL = { monthMinWidth: 180, monthMaxWidth: 0, fontFamily: "system", pollInterval: 30, mediaEnabled: false }; // maxWidth 0 = stretch — local to this device, not synced
  const FONT_STACKS = {
    system: '"Segoe UI", system-ui, -apple-system, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"Consolas", "SF Mono", Menlo, monospace',
    rounded: '"Trebuchet MS", Verdana, sans-serif',
  };
  const VISUAL_KEY = "lifelog-visual-settings-v1";
  const PENDING_KEY = "lifelog-pending-sync-v1";
  const UI_KEY = "lifelog-ui-v1";
  const MEDIA_KEY = "lifelog-media-settings-v1";
  const DEFAULT_MEDIA = {}; // legacy local-only shape; rawgKey/tmdbKey migrated into synced settings on load (see normalize())
  const MEDIA_SOURCE_LABELS = {
    rawg: "RAWG", "tmdb-movie": "TMDB", "tmdb-tv": "TMDB",
    "anilist-anime": "AniList", "anilist-manga": "AniList",
    openlibrary: "Open Library", googlebooks: "Google Books", musicbrainz: "MusicBrainz",
    steam: "Steam",
  };
  // How long a fetched GG.deals price stays valid before a backlog re-render
  // re-fetches it; avoids re-querying the rate-limited API on every render.
  const PRICE_CACHE_MS = 15 * 60 * 1000;
  const PRIVACY_KEY = "lifelog-privacy-v1";
  // App lock: gates opening the app on this device. Local-only, never synced
  // (a PIN/credential set up on one device wouldn't make sense on another).
  // method: 'pin' | 'biometric'. pinHash/pinSalt: SHA-256 of salt+PIN, so the
  // PIN itself is never stored. credentialId: base64 WebAuthn credential id.
  // graceMinutes/lastUnlockAt: if set, a refresh within graceMinutes of the
  // last successful unlock skips the prompt instead of asking again.
  const DEFAULT_PRIVACY = { enabled: false, method: "pin", pinHash: null, pinSalt: null, credentialId: null, graceMinutes: 0, lastUnlockAt: 0 };
  const APP_VERSION = "0.28.0"; // bump with each shipped change so it's visible in Settings

  // Seeded so a first-time switch to the Finance tab starts from a familiar
  // set of categories instead of empty — fully editable/deletable afterward.
  const DEFAULT_FINANCE_CATEGORY_NAMES = ["Entertainment", "Food", "Fuel", "Clothing", "Health", "Smoking", "Other"];
  const FINANCE_PALETTE = ["#e2723b", "#3bb2e2", "#9fe23b", "#b23be2", "#e23b72", "#6b7384", "#7a8a99"];
  const CATEGORY_PALETTE = ["#e23b3b", "#e2723b", "#e2b23b", "#9fe23b", "#3be25a", "#3bb2e2", "#5b8cff", "#723be2", "#b23be2", "#e23b72", "#7a8a99"];
  function seedFinanceCategories() {
    return DEFAULT_FINANCE_CATEGORY_NAMES.map((name, i) => ({
      id: name.toLowerCase(), name, color: FINANCE_PALETTE[i % FINANCE_PALETTE.length],
    }));
  }

  function loadVisualSettings() {
    try {
      const raw = localStorage.getItem(VISUAL_KEY);
      if (raw) return Object.assign({ ...DEFAULT_VISUAL }, JSON.parse(raw));
    } catch (e) {}
    return null;
  }
  function saveVisualSettings(v) {
    try { localStorage.setItem(VISUAL_KEY, JSON.stringify(v)); } catch (e) {}
  }
  function saveUiState() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ view: state.view, scrollY: window.scrollY })); } catch (e) {}
  }

  function loadMediaSettings() {
    try {
      const raw = localStorage.getItem(MEDIA_KEY);
      if (raw) return Object.assign({ ...DEFAULT_MEDIA }, JSON.parse(raw));
    } catch (e) {}
    return { ...DEFAULT_MEDIA };
  }
  function saveMediaSettings() {
    try { localStorage.setItem(MEDIA_KEY, JSON.stringify(state.media)); } catch (e) {}
  }

  function loadPrivacySettings() {
    try {
      const raw = localStorage.getItem(PRIVACY_KEY);
      if (raw) return Object.assign({ ...DEFAULT_PRIVACY }, JSON.parse(raw));
    } catch (e) {}
    return { ...DEFAULT_PRIVACY };
  }
  function savePrivacySettings() {
    try { localStorage.setItem(PRIVACY_KEY, JSON.stringify(state.privacy)); } catch (e) {}
  }

  // ---------- app lock: PIN hashing + WebAuthn biometric ----------
  function randomHex(nBytes) {
    const arr = new Uint8Array(nBytes);
    crypto.getRandomValues(arr);
    return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function hashPin(pin, salt) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + pin));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function bufToB64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  function b64ToBuf(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  async function biometricAvailable() {
    return !!(window.PublicKeyCredential &&
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)));
  }
  async function registerBiometric() {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "LifeLog" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "lifelog", displayName: "LifeLog" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000,
        attestation: "none",
      },
    });
    return bufToB64(cred.rawId);
  }
  async function verifyBiometric(credentialId) {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: b64ToBuf(credentialId), type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
      },
    });
  }

  // Whether the last save didn't reach every connected target (e.g. made
  // offline) — persisted so the indicator survives a reload until it syncs.
  function loadPendingSync() {
    try { return localStorage.getItem(PENDING_KEY) === "1"; } catch (e) { return false; }
  }
  function savePendingSync(v) {
    try {
      if (v) localStorage.setItem(PENDING_KEY, "1");
      else localStorage.removeItem(PENDING_KEY);
    } catch (e) {}
  }

  const state = {
    data: emptyData(),
    visual: loadVisualSettings() || { ...DEFAULT_VISUAL },
    media: loadMediaSettings(),
    privacy: loadPrivacySettings(),
    pendingSync: loadPendingSync(),
    view: "timeline",
    search: "",
    activeYears: new Set(),
    activeCats: new Set(),
    financeActiveYears: new Set(),
    financeActiveCats: new Set(),
    statsYear: null,
    bulk: { active: false, selected: new Set() },
  };
  let catColor = {}; // name -> color
  let financeCatColor = {}; // name -> color

  function emptyData() {
    return {
      version: 1, categories: [], entries: [], backlog: [], accomplishments: {},
      financeCategories: seedFinanceCategories(), financeEntries: [], recurringExpenses: [],
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const uid = () => "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function rebuildColorMap() {
    catColor = {};
    for (const c of state.data.categories) catColor[c.name] = c.color;
  }
  const colorOf = (name) => catColor[name] || "#7a8a99";

  function rebuildFinanceColorMap() {
    financeCatColor = {};
    for (const c of state.data.financeCategories) financeCatColor[c.name] = c.color;
  }
  const financeColorOf = (name) => financeCatColor[name] || "#7a8a99";

  // Manual formatting instead of Intl.NumberFormat("he-IL", {style:"currency"}) —
  // that locale injects invisible RTL bidi marks and puts the symbol after the
  // number ("1,302.00 ₪"), not matching the source sheet's "₪1,302.00".
  function formatMoney(n) {
    const sign = n < 0 ? "-" : "";
    const symbol = CURRENCY_SYMBOLS[state.data.settings.currency] || CURRENCY_SYMBOLS.ILS;
    return sign + symbol + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function financeYearOf(f) { return +String(f.date).slice(0, 4); }

  // ---------- recurring expenses ----------
  // Recurring expenses are stored as a single template (start date, interval,
  // amount/category/note) rather than as individual finance entries. Their
  // occurrences are computed on the fly, from the start date up through
  // today, every time finance data is read — nothing is written to
  // state.data.financeEntries for them. This keeps the template the single
  // source of truth: editing it changes every past and future occurrence,
  // and there's no per-occurrence row to clean up if it's stopped or edited.
  function addMonthsClamped(date, n, day) {
    const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, daysInMonth));
    return d;
  }
  function nextRecurringDate(date, interval, anchorDay) {
    if (interval === "weekly") { const d = new Date(date); d.setDate(d.getDate() + 7); return d; }
    if (interval === "yearly") { const d = new Date(date); d.setFullYear(d.getFullYear() + 1); return d; }
    return addMonthsClamped(date, 1, anchorDay);
  }
  // generates every occurrence of a recurring template from its start date
  // up to (and including) `until`, capped at the template's stop date if set
  function recurringOccurrences(rec, until) {
    const start = new Date(rec.startDate + "T00:00:00");
    if (isNaN(start.getTime())) return [];
    const stop = rec.endDate ? new Date(rec.endDate + "T00:00:00") : null;
    const cutoff = stop && stop < until ? stop : until;
    const anchorDay = start.getDate();
    const out = [];
    let d = start;
    let n = 0;
    while (d <= cutoff) {
      out.push({
        id: `${rec.id}:${n}`, date: d.toISOString().slice(0, 10), type: "expense",
        amount: rec.amount, category: rec.category, note: rec.note, createdAt: rec.createdAt,
        recurringId: rec.id, virtual: true,
      });
      n++;
      d = nextRecurringDate(d, rec.interval, anchorDay);
    }
    return out;
  }
  // real finance entries plus every recurring template's occurrences through
  // today — the merged list everything else (list view, stats, filters)
  // should read instead of state.data.financeEntries directly
  function getEffectiveFinanceEntries() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const virtual = (state.data.recurringExpenses || []).flatMap((r) => recurringOccurrences(r, today));
    return [...state.data.financeEntries, ...virtual];
  }
  function financeYears() {
    const ys = new Set(getEffectiveFinanceEntries().map(financeYearOf));
    return [...ys].sort((a, b) => b - a);
  }

  function getFilteredFinance() {
    const q = state.search.trim().toLowerCase();
    return getEffectiveFinanceEntries().filter((f) => {
      if (state.financeActiveYears.size && !state.financeActiveYears.has(financeYearOf(f))) return false;
      if (state.financeActiveCats.size && !state.financeActiveCats.has(f.category)) return false;
      if (q && !(f.note || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function years() {
    const ys = new Set(state.data.entries.map((e) => e.year));
    return [...ys].sort((a, b) => b - a);
  }

  function getFiltered() {
    const q = state.search.trim().toLowerCase();
    const yf = state.activeYears;
    const cf = state.activeCats;
    return state.data.entries.filter((e) => {
      if (yf.size && !yf.has(e.year)) return false;
      if (cf.size && !cf.has(e.category)) return false;
      if (q && !e.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function getFilteredBacklog() {
    const q = state.search.trim().toLowerCase();
    const cf = state.activeCats;
    return state.data.backlog.filter((b) => {
      if (cf.size && !cf.has(b.category)) return false;
      if (q && !b.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function toast(msg, isErr) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), isErr ? 6000 : 2600);
  }

  async function persist() {
    state.data.exportedAt = new Date().toISOString();
    setSyncing("Saving…");
    syncInFlight = true;
    try {
      const where = await Storage.save(state.data);
      refreshStorageStatus(where);
    } finally {
      syncInFlight = false;
    }
  }

  // ---------- rendering ----------
  function render() {
    let activeLabel = "";
    document.querySelectorAll(".tab").forEach((t) => {
      const active = t.dataset.view === state.view;
      t.classList.toggle("active", active);
      if (active) activeLabel = t.textContent;
    });
    $("#viewCurrent").textContent = activeLabel;
    const c = $("#content");
    c.innerHTML = "";
    if (state.view === "backlog") { renderBacklog(c); return; }
    if (state.view === "finance") { renderFinanceEntries(c); return; }
    if (state.view === "finance-stats") { renderFinanceStats(c); return; }
    const entries = getFiltered();
    if (!state.data.entries.length) {
      c.appendChild(emptyState("No entries yet. Click “+ Add” to start, or import data from Settings."));
      return;
    }
    if (!entries.length) {
      c.appendChild(emptyState("No entries match your filters."));
      return;
    }
    if (state.view === "timeline") renderTimeline(c, entries);
    else renderStats(c, entries);
  }

  function emptyState(msg) { return el("div", "empty", msg); }

  function renderTimeline(root, entries) {
    root.appendChild(timelineToolbar());

    const byYear = groupBy(entries, (e) => e.year);
    for (const y of Object.keys(byYear).sort((a, b) => b - a)) {
      const block = el("div", "year-block");
      const head = el("div", "year-head");
      head.appendChild(el("h2", null, y));
      head.appendChild(el("span", "ycount", `${byYear[y].length} entries`));
      const accs = (state.data.accomplishments && state.data.accomplishments[y]) || [];
      if (accs.length) {
        const a = el("div", "accs");
        a.appendChild(document.createTextNode("★"));
        accs.forEach((acc, i) => {
          const chip = el("span", "acc", acc.text);
          chip.title = "Edit achievement";
          chip.onclick = () => openAchModal({ year: +y, index: i, text: acc.text, createdAt: acc.createdAt, notes: acc.notes });
          a.appendChild(chip);
        });
        head.appendChild(a);
      }
      block.appendChild(head);
      root.appendChild(block); // attach now so head.offsetHeight reflects real layout
      block.style.setProperty("--year-head-h", head.offsetHeight + "px");

      const grid = el("div", "month-grid");
      const byMonth = groupBy(byYear[y], (e) => e.month);
      const monthSort = state.data.settings.monthOrder === "desc" ? (a, b) => b - a : (a, b) => a - b;
      for (const m of Object.keys(byMonth).sort(monthSort)) {
        const card = el("div", "month-card");
        const h = el("h3");
        h.appendChild(el("span", null, MONTHS[m]));
        h.appendChild(el("span", "mc", String(byMonth[m].length)));
        card.appendChild(h);
        byMonth[m].forEach((e) => card.appendChild(entryRow(e)));
        grid.appendChild(card);
      }
      block.appendChild(grid);
    }
  }

  function entryRow(e) {
    const row = el("div", "entry");
    const bar = el("div", "bar");
    bar.style.background = colorOf(e.category);
    row.appendChild(bar);
    const t = el("span", "etitle", e.title);
    t.title = e.title;
    row.appendChild(t);
    if (e.rating) row.appendChild(ratingBadge(e.rating));
    row.appendChild(el("span", "ecat", e.category));
    row.onclick = () => openEntryModal(e);
    return row;
  }

  function ratingBadge(rating) {
    const span = el("span", "erating", "★".repeat(rating));
    span.title = rating + "/5";
    return span;
  }

  // Title last attached to synced media metadata, so a manual edit (vs. a
  // sync pick) is detected and clears the now-stale cover/metadata.
  let lastSyncedBacklogTitle = "";

  function onBacklogTitleInput() {
    const query = $("#bTitle").value;
    // A manually-entered Steam App ID isn't derived from the title, so editing
    // the title shouldn't clear it the way it clears a search-based sync.
    if (query !== lastSyncedBacklogTitle && $("#bMediaSource").value !== "steam") {
      ["#bCoverUrl", "#bMediaId", "#bMediaSource", "#bSummary", "#bReleaseYear", "#bExternalRating"]
        .forEach((id) => { const f = $(id); if (f) f.value = ""; });
      setBacklogCover();
    }
  }

  // Builds the cover/media fields directly from a manually-entered Steam App
  // ID (see media.js — Steam's own search API is CORS-blocked from browsers).
  function applySteamAppId(prefix) {
    const id = $("#" + prefix + "SteamAppId").value.trim();
    const coverUrl = id ? window.LifeLogMedia.steamCoverUrl(id) : "";
    if (prefix === "b") {
      $("#bCoverUrl").value = coverUrl;
      $("#bMediaId").value = id;
      $("#bMediaSource").value = id ? "steam" : "";
      $("#bReleaseYear").value = "";
      $("#bExternalRating").value = "";
      $("#bSummary").value = "";
      setBacklogCover();
    } else {
      setEntryCover(coverUrl, id, id ? "steam" : "");
    }
  }

  async function syncBacklogTitle() {
    const title = $("#bTitle").value.trim();
    const category = $("#bCategory").value;
    if (!title) return;
    const list = $("#bTitleSuggest");
    const results = await fetchMediaSuggestions(title, category);
    list.innerHTML = "";
    if (!results.length) {
      list.hidden = true;
      const err = window.LifeLogMedia && window.LifeLogMedia.getLastError();
      toast(err ? "No matches found — " + err : "No matches found", !!err);
      return;
    }
    results.forEach((r) => {
      list.appendChild(makeMediaAcItem(r, () => {
        lastSyncedBacklogTitle = $("#bTitle").value;
        $("#bCoverUrl").value = r.coverUrl || "";
        $("#bMediaId").value = r.id || "";
        $("#bMediaSource").value = r.source || "";
        $("#bSummary").value = r.summary || "";
        $("#bReleaseYear").value = r.year ? String(r.year) : "";
        $("#bExternalRating").value = r.externalRating || "";
        setBacklogCover();
        list.hidden = true;
      }));
    });
    list.hidden = false;
  }

  function unsyncBacklogItem() {
    ["#bCoverUrl", "#bMediaId", "#bMediaSource", "#bSummary", "#bReleaseYear", "#bExternalRating"]
      .forEach((id) => { const f = $(id); if (f) f.value = ""; });
    $("#bSteamAppId").value = "";
    setBacklogCover();
    $("#bTitleSuggest").hidden = true;
  }

  function renderBacklog(root) {
    if (!state.data.backlog.length) {
      root.appendChild(emptyState(`Your backlog is empty. Use "+ Add" → "Add to backlog" for things to watch, play, or read later, then mark them "✓ Done" once you finish.`));
      return;
    }
    const items = getFilteredBacklog()
      .slice().sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    if (!items.length) {
      root.appendChild(emptyState("No backlog items match your filters."));
      return;
    }
    root.appendChild(backlogToolbar());
    const byCat = groupBy(items, (b) => b.category);
    const order = state.data.categories.map((c) => c.name).filter((n) => byCat[n]);
    for (const n of Object.keys(byCat)) if (!order.includes(n)) order.push(n);
    const grid = el("div", "backlog-grid");
    for (const catName of order) {
      const catItems = byCat[catName];
      const section = el("div", "backlog-section");
      const head = el("div", "backlog-section-head");
      if (state.bulk.active) {
        const allSelected = catItems.every((b) => state.bulk.selected.has(b.id));
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "bulk-check"; cb.checked = allSelected;
        cb.title = "Select all in " + catName;
        cb.onclick = (ev) => { ev.stopPropagation(); toggleBulkCategoryAll(catItems); };
        head.appendChild(cb);
      }
      const dot = el("span", "dot"); dot.style.background = colorOf(catName);
      head.appendChild(dot);
      head.appendChild(el("span", "backlog-section-name", catName));
      head.appendChild(el("span", "backlog-section-count", String(catItems.length)));
      section.appendChild(head);
      const list = el("div", "backlog-list");
      catItems.forEach((b) => list.appendChild(backlogRow(b)));
      section.appendChild(list);
      grid.appendChild(section);
    }
    root.appendChild(grid);
    if (state.bulk.active && state.bulk.selected.size) root.appendChild(bulkActionBar());
    loadBacklogPrices(items);
  }

  // In-memory only (not persisted/synced) — prices change over time and are
  // cheap to re-fetch next session, so there's no need to store them.
  const priceCache = new Map();

  function bestCurrentPrice(p) {
    const vals = [p.currentRetail, p.currentKeyshops]
      .map((v) => (v != null ? parseFloat(v) : null))
      .filter((v) => v != null && !isNaN(v));
    return vals.length ? Math.min(...vals) : null;
  }

  // Fetches GG.deals prices for any visible backlog items synced via Steam,
  // skipping ones already cached recently, and patches their price badge in
  // place once results arrive (no full re-render needed).
  async function loadBacklogPrices(items) {
    const apiKey = state.data.settings.mediaKeys?.ggdeals;
    if (!apiKey || !window.LifeLogMedia) return;
    const now = Date.now();
    const appIds = [...new Set(
      items.filter((b) => b.mediaSource === "steam" && b.mediaId).map((b) => b.mediaId)
    )].filter((id) => {
      const cached = priceCache.get(id);
      return !cached || now - cached.ts > PRICE_CACHE_MS;
    });
    if (!appIds.length) {
      applyCachedPrices(items);
      return;
    }
    for (let i = 0; i < appIds.length; i += 100) {
      const chunk = appIds.slice(i, i + 100);
      const result = await window.LifeLogMedia.fetchPrices(chunk, apiKey);
      const err = window.LifeLogMedia.getLastError();
      if (err && !priceErrorToasted) { priceErrorToasted = true; toast(err, true); }
      for (const id of chunk) priceCache.set(id, { ts: now, data: result[id] || null });
    }
    applyCachedPrices(items);
  }

  // Toasted at most once per session — loadBacklogPrices reruns on every
  // backlog render/poll, and a persistent failure (bad key, CORS) shouldn't
  // re-announce itself every time.
  let priceErrorToasted = false;

  function applyCachedPrices(items) {
    for (const b of items) {
      if (b.mediaSource !== "steam" || !b.mediaId) continue;
      const cached = priceCache.get(b.mediaId);
      if (!cached || !cached.data) continue;
      const best = bestCurrentPrice(cached.data.prices || {});
      if (best == null) continue;
      document.querySelectorAll(`.bl-price[data-appid="${b.mediaId}"]`).forEach((elm) => {
        elm.textContent = "💰 $" + best.toFixed(2);
      });
    }
  }

  function backlogToolbar() {
    const bar = el("div", "timeline-toolbar");
    const btn = el("button", "btn btn-sm", state.bulk.active ? "✕ Cancel select" : "☑ Select");
    btn.type = "button";
    btn.onclick = toggleBulkMode;
    bar.appendChild(btn);
    return bar;
  }

  function toggleBulkMode() {
    state.bulk.active = !state.bulk.active;
    state.bulk.selected.clear();
    render();
  }

  function setBulkItem(id, value, opts) {
    if (state.bulk.selected.has(id) === value) return;
    if (value) state.bulk.selected.add(id); else state.bulk.selected.delete(id);
    if (opts && opts.skipRender) {
      // Mid-drag: update the checkbox in place instead of re-rendering, since a
      // full render() while the pointer is still down can detach the element the
      // gesture started on and cause mobile browsers to cancel the touch early.
      document.querySelectorAll(`.bulk-check[data-bl-id="${id}"]`).forEach((cb) => { cb.checked = value; });
      return;
    }
    render();
  }

  function toggleBulkItem(id) { setBulkItem(id, !state.bulk.selected.has(id)); }

  function toggleBulkCategoryAll(catItems) {
    const allSelected = catItems.every((b) => state.bulk.selected.has(b.id));
    catItems.forEach((b) => {
      if (allSelected) state.bulk.selected.delete(b.id);
      else state.bulk.selected.add(b.id);
    });
    render();
  }

  function bulkActionBar() {
    const bar = el("div", "bulk-bar");
    bar.appendChild(el("span", "bulk-count", `${state.bulk.selected.size} selected`));
    const moveSel = document.createElement("select");
    moveSel.className = "bulk-move-select";
    fillSelect(moveSel, [
      { value: "", label: "Move to category…" },
      ...state.data.categories.map((c) => ({ value: c.name, label: c.name })),
    ], "");
    moveSel.onchange = async () => {
      if (!moveSel.value) return;
      await bulkMoveSelected(moveSel.value);
    };
    bar.appendChild(moveSel);
    const syncBtn = el("button", "btn btn-sm", "🔄 Sync");
    syncBtn.type = "button";
    syncBtn.onclick = () => bulkSyncSelected(syncBtn);
    bar.appendChild(syncBtn);
    const delBtn = el("button", "btn btn-sm btn-danger", "Delete");
    delBtn.type = "button";
    delBtn.onclick = bulkDeleteSelected;
    bar.appendChild(delBtn);
    const cancelBtn = el("button", "btn btn-sm", "Cancel");
    cancelBtn.type = "button";
    cancelBtn.onclick = toggleBulkMode;
    bar.appendChild(cancelBtn);
    return bar;
  }

  // Syncs each selected backlog item to media metadata, auto-picking the top
  // search result (no per-item review, since reviewing N items individually
  // would defeat the point of a bulk action).
  async function bulkSyncSelected(btn) {
    const ids = [...state.bulk.selected];
    btn.disabled = true;
    btn.textContent = "Syncing…";
    let synced = 0, skipped = 0, lastErr = "";
    for (const id of ids) {
      const item = state.data.backlog.find((b) => b.id === id);
      // Steam has no search (CORS-blocked) — its App ID can only be entered
      // manually per item, so it's skipped here rather than attempted.
      const source = item && (state.data.settings.mediaCategorySources || {})[item.category];
      if (!item || !source || source === "steam") { skipped++; continue; }
      const results = await fetchMediaSuggestions(item.title, item.category);
      if (!results.length) {
        skipped++;
        lastErr = (window.LifeLogMedia && window.LifeLogMedia.getLastError()) || lastErr;
        continue;
      }
      const r = results[0];
      item.coverUrl = r.coverUrl || "";
      item.mediaId = r.id || "";
      item.mediaSource = r.source || "";
      item.summary = r.summary || "";
      if (r.year) item.releaseYear = r.year; else delete item.releaseYear;
      item.externalRating = r.externalRating || "";
      synced++;
    }
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    const base = skipped ? `Synced ${synced} item${synced === 1 ? "" : "s"}, skipped ${skipped}` : `Synced ${synced} item${synced === 1 ? "" : "s"}`;
    toast(lastErr ? base + " — " + lastErr : base, !!(skipped && lastErr));
  }

  async function bulkMoveSelected(categoryName) {
    const ids = state.bulk.selected;
    state.data.backlog.forEach((b) => { if (ids.has(b.id)) b.category = categoryName; });
    const n = ids.size;
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Moved ${n} item${n === 1 ? "" : "s"} to “${categoryName}”`);
  }

  async function bulkDeleteSelected() {
    const ids = state.bulk.selected;
    const n = ids.size;
    if (!confirm(`Remove ${n} item${n === 1 ? "" : "s"} from your backlog?`)) return;
    state.data.backlog = state.data.backlog.filter((b) => !ids.has(b.id));
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Removed ${n} item${n === 1 ? "" : "s"} from backlog`);
  }

  function backlogRow(b) {
    if (b.coverUrl) return backlogRowRich(b);
    const row = el("div", "entry");
    if (state.bulk.active) row.appendChild(bulkCheckbox(b));
    const t = el("span", "etitle", b.title); t.title = b.title;
    row.appendChild(t);
    if (!state.bulk.active) {
      const doneBtn = el("button", "btn btn-sm", "✓ Done");
      doneBtn.type = "button";
      doneBtn.title = "Move to your log";
      doneBtn.onclick = (ev) => { ev.stopPropagation(); openEntryModal(null, b); };
      row.appendChild(doneBtn);
    }
    row.onclick = () => state.bulk.active ? toggleBulkItem(b.id) : openBacklogModal(b);
    attachLongPressSelect(row, b);
    return row;
  }

  function backlogRowRich(b) {
    const row = el("div", "backlog-item-rich");
    if (state.bulk.active) row.appendChild(bulkCheckbox(b));
    const img = document.createElement("img");
    img.src = b.coverUrl; img.alt = b.title; img.className = "bl-cover";
    img.onerror = () => { img.style.display = "none"; };
    row.appendChild(img);
    const body = el("div", "bl-body");
    body.appendChild(el("span", "bl-title", b.title));
    const meta = [];
    if (b.externalRating) meta.push("★ " + b.externalRating);
    if (b.releaseYear) meta.push(String(b.releaseYear));
    if (meta.length) body.appendChild(el("span", "bl-meta", meta.join(" · ")));
    if (b.summary) body.appendChild(el("p", "bl-summary", b.summary));
    if (b.mediaSource === "steam" && b.mediaId) {
      const price = el("span", "bl-price");
      price.dataset.appid = b.mediaId;
      body.appendChild(price);
    }
    row.appendChild(body);
    // Done button at the right — same position as plain backlog rows
    if (!state.bulk.active) {
      const doneBtn = el("button", "btn btn-sm", "✓ Done");
      doneBtn.type = "button"; doneBtn.title = "Move to your log";
      doneBtn.onclick = (ev) => { ev.stopPropagation(); openEntryModal(null, b); };
      row.appendChild(doneBtn);
    }
    row.onclick = () => state.bulk.active ? toggleBulkItem(b.id) : openBacklogModal(b);
    attachLongPressSelect(row, b);
    return row;
  }

  // Long-pressing a backlog row (touch only — desktop already has the
  // "☑ Select" button) enters bulk mode with that item pre-selected, without
  // needing the toolbar button first. Cancelled by movement past a small
  // threshold so it doesn't fire mid-scroll.
  function attachLongPressSelect(row, b) {
    let timer = null, start = null;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } start = null; };
    row.addEventListener("pointerdown", (ev) => {
      if (state.bulk.active || ev.pointerType === "mouse") return;
      start = { x: ev.clientX, y: ev.clientY };
      timer = setTimeout(() => {
        timer = null;
        state.bulk.active = true;
        state.bulk.selected.clear();
        state.bulk.selected.add(b.id);
        render();
      }, 500);
    });
    row.addEventListener("pointermove", (ev) => {
      if (!start) return;
      if (Math.abs(ev.clientX - start.x) > 10 || Math.abs(ev.clientY - start.y) > 10) cancel();
    });
    row.addEventListener("pointerup", cancel);
    row.addEventListener("pointercancel", cancel);
  }

  // While a pointer is held down on a bulk checkbox, dragging over other
  // checkboxes paints them to the same selected/unselected state — lets you
  // select a run of items by pressing and moving instead of tapping each one.
  let dragPaint = null;

  function bulkCheckbox(b) {
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.className = "bulk-check";
    cb.checked = state.bulk.selected.has(b.id);
    cb.dataset.blId = b.id;
    cb.onclick = (ev) => ev.preventDefault(); // selection is driven by pointerdown below
    cb.onpointerdown = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const value = !state.bulk.selected.has(b.id);
      dragPaint = { value };
      setBulkItem(b.id, value, { skipRender: true });
    };
    return cb;
  }

  // ---------- finance ----------
  function renderFinanceEntries(root) {
    renderRecurringCard(root);
    if (!state.data.financeEntries.length && !state.data.recurringExpenses.length) {
      root.appendChild(emptyState(`No finance entries yet. Use "+ Add" → "Add finance entry" to log income or expenses.`));
      return;
    }
    const items = getFilteredFinance();
    if (!items.length) {
      root.appendChild(emptyState("No finance entries match your filters."));
      return;
    }
    const byYear = groupBy(items, financeYearOf);
    for (const y of Object.keys(byYear).sort((a, b) => b - a)) {
      const block = el("div", "year-block");
      const head = el("div", "year-head");
      head.appendChild(el("h2", null, y));
      head.appendChild(el("span", "ycount", `${byYear[y].length} entries`));
      block.appendChild(head);
      const list = el("div", "finance-list");
      byYear[y].slice().sort((a, b) => b.date.localeCompare(a.date)).forEach((f) => list.appendChild(financeRow(f)));
      block.appendChild(list);
      root.appendChild(block);
    }
  }

  function financeRow(f) {
    const row = el("div", "entry finance-entry" + (f.yearly ? " yearly-expense" : ""));
    const bar = el("div", "bar");
    bar.style.background = financeColorOf(f.category);
    row.appendChild(bar);
    row.appendChild(el("span", "fdate" + (f.yearly ? " fyearly" : ""), f.yearly ? `${f.date} · yearly` : f.date));
    const t = el("span", "etitle", f.note || f.category);
    t.title = f.note || f.category;
    row.appendChild(t);
    row.appendChild(el("span", "ecat", f.category));
    if (f.virtual) row.appendChild(el("span", "recur-badge", "↻"));
    const sign = f.type === "income" ? "+" : "-";
    const amt = el("span", "famount " + (f.type === "income" ? "fpositive" : "fnegative"), sign + formatMoney(f.amount));
    row.appendChild(amt);
    row.onclick = f.virtual
      ? () => openRecurringModal(state.data.recurringExpenses.find((r) => r.id === f.recurringId))
      : () => openFinanceModal(f);
    return row;
  }

  function renderFinanceStats(root) {
    if (!state.data.financeEntries.length && !state.data.recurringExpenses.length) {
      root.appendChild(emptyState("No finance entries yet — add some on the Timeline tab to see stats here."));
      return;
    }
    const items = getFilteredFinance();
    if (!items.length) {
      root.appendChild(emptyState("No finance entries match your filters."));
      return;
    }

    const income = items.filter((f) => f.type === "income").reduce((s, f) => s + f.amount, 0);
    const expense = items.filter((f) => f.type === "expense").reduce((s, f) => s + f.amount, 0);

    const big = el("div", "card");
    big.appendChild(el("h2", null, "Overview"));
    const bigRow = el("div", "stat-big");
    bigRow.appendChild(moneyStatItem(income, "income"));
    bigRow.appendChild(moneyStatItem(expense, "expenses"));
    bigRow.appendChild(moneyStatItem(income - expense, "net"));
    big.appendChild(bigRow);
    root.appendChild(big);

    const grid = el("div", "stats-grid");
    const expenseItems = items.filter((f) => f.type === "expense");

    const catCard = el("div", "card");
    catCard.appendChild(el("h2", null, "By category"));
    const catTotals = {};
    for (const f of expenseItems) catTotals[f.category] = (catTotals[f.category] || 0) + f.amount;
    let catOrder = state.data.financeCategories.map((c) => c.name).filter((n) => catTotals[n]);
    for (const n of Object.keys(catTotals)) if (!catOrder.includes(n)) catOrder.push(n);
    const catMax = Math.max(1, ...Object.values(catTotals));
    catOrder.sort((a, b) => catTotals[b] - catTotals[a])
      .forEach((n) => catCard.appendChild(barRow(n, catTotals[n], catMax, financeColorOf(n), null, formatMoney)));
    grid.appendChild(catCard);

    const yearCard = el("div", "card");
    yearCard.appendChild(el("h2", null, "By year"));
    const yearTotals = {};
    for (const f of expenseItems) {
      const y = financeYearOf(f);
      yearTotals[y] = (yearTotals[y] || 0) + f.amount;
    }
    const yearMax = Math.max(1, ...Object.values(yearTotals));
    Object.keys(yearTotals).sort((a, b) => b - a)
      .forEach((y) => yearCard.appendChild(barRow(y, yearTotals[y], yearMax, "#5b8cff", null, formatMoney)));
    grid.appendChild(yearCard);

    root.appendChild(grid);

    // Mirrors the source sheet's own "Per Month" row (yearly total ÷ 12).
    const pmCard = el("div", "card");
    pmCard.style.marginTop = "20px";
    pmCard.appendChild(el("h2", null, "Per month average"));
    Object.keys(yearTotals).sort((a, b) => b - a)
      .forEach((y) => pmCard.appendChild(moneyRow(y, yearTotals[y] / 12)));
    root.appendChild(pmCard);
  }

  function moneyStatItem(n, l) {
    const i = el("div", "item");
    i.appendChild(el("div", "n", formatMoney(n)));
    i.appendChild(el("div", "l", l));
    return i;
  }
  function moneyRow(label, amount) {
    const row = el("div", "money-row");
    row.appendChild(el("span", "lbl", String(label)));
    row.appendChild(el("span", "val", formatMoney(amount)));
    return row;
  }

  function renderStats(root, entries) {
    const ys = [...new Set(entries.map((e) => e.year))];
    const thisYear = new Date().getFullYear();
    const big = el("div", "card");
    const bigRow = el("div", "stat-big");
    bigRow.appendChild(statItem(entries.length, "entries"));
    bigRow.appendChild(statItem(entries.filter((e) => e.year === thisYear).length, `in ${thisYear}`));
    bigRow.appendChild(statItem(ys.length, "years"));
    bigRow.appendChild(statItem(new Set(entries.map((e) => e.category)).size, "categories"));
    big.appendChild(el("h2", null, "Overview"));
    big.appendChild(bigRow);

    const grid = el("div", "stats-grid");

    // by category
    const catCard = el("div", "card");
    catCard.appendChild(el("h2", null, "Categories"));
    const catCounts = countBy(entries, (e) => e.category);
    const byCat = groupBy(entries, (e) => e.category);
    const catUnique = {};
    for (const n of Object.keys(catCounts)) catUnique[n] = new Set(byCat[n].map((e) => e.title.trim().toLowerCase())).size;
    const catOrder = state.data.categories.map((c) => c.name).filter((n) => catCounts[n]);
    for (const n of Object.keys(catCounts)) if (!catOrder.includes(n)) catOrder.push(n);
    const catMax = Math.max(1, ...Object.values(catCounts));
    catOrder.sort((a, b) => catCounts[b] - catCounts[a])
      .forEach((n) => catCard.appendChild(barRow(n, catCounts[n], catMax, colorOf(n), catUnique[n])));

    // by year
    const yearCard = el("div", "card");
    yearCard.appendChild(el("h2", null, "Years"));
    const yearCounts = countBy(entries, (e) => e.year);
    const yearMax = Math.max(1, ...Object.values(yearCounts));
    Object.keys(yearCounts).sort((a, b) => b - a)
      .forEach((y) => yearCard.appendChild(barRow(y, yearCounts[y], yearMax, "#5b8cff")));

    grid.appendChild(catCard);
    grid.appendChild(yearCard);
    root.appendChild(big);
    root.appendChild(grid);

    // most re-logged titles (rewatches/replays/rereads)
    const byTitle = new Map();
    for (const e of entries) {
      const key = e.title.trim().toLowerCase();
      let g = byTitle.get(key);
      if (!g) { g = { title: e.title, count: 0, category: e.category }; byTitle.set(key, g); }
      g.count++;
    }
    const repeats = [...byTitle.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count).slice(0, 5);
    if (repeats.length) {
      const repCard = el("div", "card");
      repCard.appendChild(el("h2", null, "Most repeated"));
      const repMax = Math.max(1, ...repeats.map((r) => r.count));
      repeats.forEach((r) => {
        const row = barRow(r.title, r.count, repMax, colorOf(r.category));
        row.querySelector(".lbl").title = r.title;
        repCard.appendChild(row);
      });
      root.appendChild(repCard);
    }

    renderHeatmap(root, entries);
    renderYearInReview(root, state.data.entries);
  }

  function heatColor(count, max) {
    const t = max <= 1 ? 1 : Math.max(0.2, count / max);
    return `rgb(${Math.round(0x22 + (0x5b - 0x22) * t)},${Math.round(0x28 + (0x8c - 0x28) * t)},${Math.round(0x36 + (0xff - 0x36) * t)})`;
  }

  function renderHeatmap(root, allEntries) {
    if (!allEntries.length) return;
    const counts = {};
    let maxCount = 0;
    for (const e of allEntries) {
      const k = `${e.year}-${e.month}`;
      counts[k] = (counts[k] || 0) + 1;
      if (counts[k] > maxCount) maxCount = counts[k];
    }
    const thisYear = new Date().getFullYear();
    const allYears = [...new Set([...allEntries.map((e) => e.year), thisYear])].sort((a, b) => a - b);

    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Activity"));
    const wrap = el("div", "heatmap");

    const header = el("div", "heatmap-row");
    header.appendChild(el("span", "heatmap-year-lbl"));
    for (const m of MONTHS_SHORT.slice(1)) header.appendChild(el("span", "heatmap-month-lbl", m));
    wrap.appendChild(header);

    for (const year of [...allYears].reverse()) {
      const row = el("div", "heatmap-row");
      row.appendChild(el("span", "heatmap-year-lbl", String(year)));
      for (let m = 1; m <= 12; m++) {
        const count = counts[`${year}-${m}`] || 0;
        const cell = el("div", "heatmap-cell");
        if (count) {
          cell.style.background = heatColor(count, maxCount);
          cell.title = `${count} ${count === 1 ? "entry" : "entries"} · ${MONTHS_SHORT[m]} ${year}`;
        }
        row.appendChild(cell);
      }
      wrap.appendChild(row);
    }
    card.appendChild(wrap);
    root.appendChild(card);
  }

  function renderYearInReview(root, allEntries) {
    const allYears = [...new Set(allEntries.map((e) => e.year))].sort((a, b) => b - a);
    if (!allYears.length) return;
    if (!state.statsYear || !allYears.includes(state.statsYear)) state.statsYear = allYears[0];

    const card = el("div", "card yir-card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Year in Review"));

    const yearNav = el("div", "yir-years");
    for (const y of allYears) {
      const btn = el("button", "yir-year-btn" + (y === state.statsYear ? " active" : ""), String(y));
      btn.type = "button";
      btn.onclick = () => { state.statsYear = y; render(); };
      yearNav.appendChild(btn);
    }
    card.appendChild(yearNav);

    const yearEntries = allEntries.filter((e) => e.year === state.statsYear);
    const achs = state.data.accomplishments[state.statsYear] || [];

    if (!yearEntries.length && !achs.length) {
      card.appendChild(el("p", "muted", `No entries logged in ${state.statsYear}.`));
      root.appendChild(card);
      return;
    }

    const uniqueTitles = new Set(yearEntries.map((e) => e.title.trim().toLowerCase())).size;
    const monthCounts = countBy(yearEntries, (e) => e.month);
    const topMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0];
    const highlights = el("div", "yir-highlights");
    highlights.appendChild(statItem(yearEntries.length, "entries"));
    highlights.appendChild(statItem(uniqueTitles, "unique titles"));
    if (topMonth) highlights.appendChild(statItem(MONTHS_SHORT[+topMonth[0]], "best month"));
    card.appendChild(highlights);

    if (yearEntries.length) {
      const catCounts = countBy(yearEntries, (e) => e.category);
      const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const catMax = topCats[0][1];
      const sec = el("div", "yir-section");
      sec.appendChild(el("h3", null, "Top categories"));
      for (const [name, count] of topCats) sec.appendChild(barRow(name, count, catMax, colorOf(name)));
      card.appendChild(sec);
    }

    const byTitle = new Map();
    for (const e of yearEntries) {
      const key = e.title.trim().toLowerCase();
      let g = byTitle.get(key);
      if (!g) { g = { title: e.title, count: 0, category: e.category }; byTitle.set(key, g); }
      g.count++;
    }
    const repeats = [...byTitle.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count).slice(0, 5);
    if (repeats.length) {
      const repMax = repeats[0].count;
      const sec = el("div", "yir-section");
      sec.appendChild(el("h3", null, "Most repeated"));
      for (const r of repeats) {
        const row = barRow(r.title, r.count, repMax, colorOf(r.category));
        row.querySelector(".lbl").title = r.title;
        sec.appendChild(row);
      }
      card.appendChild(sec);
    }

    if (achs.length) {
      const sec = el("div", "yir-section");
      sec.appendChild(el("h3", null, `Achievements (${achs.length})`));
      for (const a of achs) {
        const item = el("div", "yir-ach");
        item.appendChild(el("span", "yir-ach-bullet", "✦"));
        item.appendChild(el("span", null, a.text));
        sec.appendChild(item);
      }
      card.appendChild(sec);
    }

    root.appendChild(card);
  }

  function statItem(n, l) {
    const i = el("div", "item");
    i.appendChild(el("div", "n", String(n)));
    i.appendChild(el("div", "l", l));
    return i;
  }
  function barRow(label, val, max, color, uniqueVal, fmt) {
    const row = el("div", "bar-row");
    row.appendChild(el("div", "lbl", label));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill");
    fill.style.width = (val / max * 100) + "%";
    fill.style.background = color;
    track.appendChild(fill);
    row.appendChild(track);
    const valEl = el("div", "val");
    const display = fmt ? fmt(val) : String(val);
    if (fmt) row.classList.add("money");
    if (uniqueVal != null && uniqueVal !== val) {
      valEl.appendChild(el("span", "val-total", display));
      valEl.appendChild(el("span", "val-unique", String(uniqueVal)));
      valEl.appendChild(el("span", "val-unique-lbl", "unique"));
    } else {
      valEl.textContent = display;
    }
    row.appendChild(valEl);
    return row;
  }

  // ---------- grouping utils ----------
  function groupBy(arr, fn) {
    const o = {};
    for (const x of arr) { const k = fn(x); (o[k] = o[k] || []).push(x); }
    return o;
  }
  function countBy(arr, fn) {
    const o = {};
    for (const x of arr) { const k = fn(x); o[k] = (o[k] || 0) + 1; }
    return o;
  }

  // ---------- filter bar ----------
  // The same #yearFilter/#catFilter chip bar is shared by every view (it was
  // already loosely reused this way — e.g. backlog shows year chips it
  // doesn't filter by) — finance views swap in their own data/active-set.
  function isFinanceView() { return state.view === "finance" || state.view === "finance-stats"; }

  function buildYearFilter() {
    const wrap = $("#yearFilter");
    wrap.innerHTML = "";
    const finance = isFinanceView();
    const ys = finance ? financeYears() : years();
    const activeYears = finance ? state.financeActiveYears : state.activeYears;
    for (const y of activeYears) if (!ys.includes(y)) activeYears.delete(y);
    ys.forEach((y) => {
      const chip = el("span", "cat-chip year-chip" + (activeYears.has(y) ? " on" : ""), String(y));
      chip.onclick = () => {
        if (activeYears.has(y)) activeYears.delete(y);
        else activeYears.add(y);
        buildYearFilter();
        render();
      };
      wrap.appendChild(chip);
    });
  }
  function buildCatFilter() {
    const wrap = $("#catFilter");
    wrap.innerHTML = "";
    const finance = isFinanceView();
    const cats = finance ? state.data.financeCategories : state.data.categories;
    const activeCats = finance ? state.financeActiveCats : state.activeCats;
    cats.forEach((c) => {
      const chip = el("span", "cat-chip" + (activeCats.has(c.name) ? " on" : ""));
      const dot = el("span", "dot"); dot.style.background = c.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(c.name));
      if (activeCats.has(c.name)) chip.style.background = c.color + "22";
      const edit = el("span", "chip-edit", "✎");
      edit.title = "Edit category";
      edit.onclick = (ev) => { ev.stopPropagation(); finance ? openFinanceCatModal(c) : openCategoryModal(c); };
      chip.appendChild(edit);
      chip.onclick = () => {
        if (activeCats.has(c.name)) activeCats.delete(c.name);
        else activeCats.add(c.name);
        buildCatFilter();
        render();
      };
      wrap.appendChild(chip);
    });
  }

  // Clicking the "Years"/"Categories" label selects all chips; clicking again
  // when everything is already selected deselects all.
  function toggleAllYears() {
    const finance = isFinanceView();
    const ys = finance ? financeYears() : years();
    const activeYears = finance ? state.financeActiveYears : state.activeYears;
    if (activeYears.size === ys.length) activeYears.clear();
    else { activeYears.clear(); ys.forEach((y) => activeYears.add(y)); }
    buildYearFilter();
    render();
  }
  function toggleAllCats() {
    const finance = isFinanceView();
    const names = (finance ? state.data.financeCategories : state.data.categories).map((c) => c.name);
    const activeCats = finance ? state.financeActiveCats : state.activeCats;
    if (activeCats.size === names.length) activeCats.clear();
    else { activeCats.clear(); names.forEach((n) => activeCats.add(n)); }
    buildCatFilter();
    render();
  }

  // ---------- entry modal ----------
  function fillSelect(sel, opts, val) {
    sel.innerHTML = "";
    opts.forEach((o) => {
      const opt = el("option", null, o.label); opt.value = o.value;
      sel.appendChild(opt);
    });
    if (val != null) sel.value = val;
  }

  function openEntryModal(entry, fromBacklog) {
    const editing = !!entry;
    $("#entryModalTitle").textContent = editing ? "Edit entry" : "Add entry";
    $("#entryId").value = editing ? entry.id : "";
    $("#entryFromBacklog").value = fromBacklog ? fromBacklog.id : "";
    $("#fTitle").value = editing ? entry.title : (fromBacklog ? fromBacklog.title : "");
    fillSelect($("#fCategory"),
      state.data.categories.map((c) => ({ value: c.name, label: c.name })),
      editing ? entry.category : (fromBacklog ? fromBacklog.category : (state.data.categories[0] && state.data.categories[0].name)));
    fillSelect($("#fMonth"),
      MONTHS.slice(1).map((m, i) => ({ value: i + 1, label: m })),
      editing ? entry.month : (new Date().getMonth() + 1));
    $("#fYear").value = editing ? entry.year : new Date().getFullYear();
    $("#deleteEntryBtn").hidden = !editing;
    const added = $("#addedLine");
    if (editing && entry.createdAt) {
      added.textContent = "Added " + new Date(entry.createdAt).toLocaleDateString(undefined,
        { year: "numeric", month: "short", day: "numeric" });
      added.hidden = false;
    } else added.hidden = true;
    setRating(editing ? (entry.rating || 0) : 0);
    $("#fNotes").value = editing ? (entry.notes || "") : "";
    const coverSrc = editing ? (entry.coverUrl || "") : (fromBacklog ? (fromBacklog.coverUrl || "") : "");
    const mediaSrc = editing ? (entry.mediaSource || "") : (fromBacklog ? (fromBacklog.mediaSource || "") : "");
    const mediaId = editing ? (entry.mediaId || "") : (fromBacklog ? (fromBacklog.mediaId || "") : "");
    lastSyncedEntryTitle = editing ? entry.title : (fromBacklog ? fromBacklog.title : "");
    setEntryCover(coverSrc, mediaId, mediaSrc);
    $("#fSteamAppId").value = mediaSrc === "steam" ? mediaId : "";
    updateSyncBtnVisibility("f", $("#fCategory").value);
    $("#fTitleSuggest").hidden = true;
    $("#fTitleSuggest").innerHTML = "";
    $("#entryModal").hidden = false;
  }
  function closeEntryModal() { $("#entryModal").hidden = true; }

  function setRating(value) {
    const wrap = $("#fRating");
    wrap.dataset.value = String(value);
    wrap.querySelectorAll(".star").forEach((s) => {
      s.classList.toggle("filled", parseInt(s.dataset.star, 10) <= value);
    });
  }

  // Suggest previously-logged titles matching what's being typed, so a
  // re-entry (rewatch/replay/reread) reuses the exact same title/category.
  // Also carries cover media fields so re-entries inherit existing art.
  function titleSuggestions(query, excludeId) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const groups = new Map();
    for (const e of state.data.entries) {
      if (e.id === excludeId) continue;
      const key = e.title.trim().toLowerCase();
      if (!key.includes(q)) continue;
      let g = groups.get(key);
      if (!g) {
        g = { title: e.title, count: 0, category: e.category, year: e.year, month: e.month,
              coverUrl: e.coverUrl || "", mediaId: e.mediaId || "", mediaSource: e.mediaSource || "" };
        groups.set(key, g);
      }
      g.count++;
      if (e.year > g.year || (e.year === g.year && e.month > g.month)) {
        g.title = e.title; g.category = e.category; g.year = e.year; g.month = e.month;
        g.coverUrl = e.coverUrl || ""; g.mediaId = e.mediaId || ""; g.mediaSource = e.mediaSource || "";
      }
    }
    return [...groups.values()]
      .sort((a, b) => a.title.toLowerCase().indexOf(q) - b.title.toLowerCase().indexOf(q) || b.count - a.count)
      .slice(0, 6);
  }

  // Title last attached to synced media metadata, so a manual edit (vs. a
  // local-match or sync pick) is detected and clears the now-stale cover.
  let lastSyncedEntryTitle = "";

  function hasMediaSourceFor(category) {
    return !!(state.visual.mediaEnabled && (state.data.settings.mediaCategorySources || {})[category]);
  }

  async function fetchMediaSuggestions(title, category) {
    if (!state.visual.mediaEnabled) return [];
    const source = (state.data.settings.mediaCategorySources || {})[category];
    if (!source || !window.LifeLogMedia) return [];
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    try { return await window.LifeLogMedia.search(title, source, keys); } catch (e) { return []; }
  }

  function makeMediaAcItem(r, onPick) {
    const item = el("div", r.coverUrl ? "ac-item ac-media" : "ac-item");
    if (r.coverUrl) {
      const img = document.createElement("img");
      img.src = r.coverUrl; img.alt = ""; img.className = "ac-thumb";
      img.onerror = () => { img.style.display = "none"; };
      item.appendChild(img);
    }
    const info = el("div", "ac-info");
    info.appendChild(el("span", "ac-title", r.title));
    const meta = [];
    if (r.year) meta.push(String(r.year));
    if (r.externalRating) meta.push("★ " + r.externalRating);
    if (meta.length) info.appendChild(el("span", "ac-meta", meta.join(" · ")));
    item.appendChild(info);
    item.onclick = onPick;
    return item;
  }

  function showSyncStatus(prefix, source) {
    const statusDiv = $("#" + prefix + "SyncStatus");
    const statusText = $("#" + prefix + "SyncStatusText");
    if (!statusDiv) return;
    if (source) {
      statusText.textContent = "Synced via " + (MEDIA_SOURCE_LABELS[source] || source);
      statusDiv.hidden = false;
    } else {
      statusDiv.hidden = true;
    }
  }

  function updateSyncBtnVisibility(prefix, category) {
    const isSteam = (state.data.settings.mediaCategorySources || {})[category] === "steam";
    const btn = $("#" + prefix + "SyncBtn");
    if (btn) btn.hidden = isSteam || !hasMediaSourceFor(category);
    const steamField = $("#" + prefix + "SteamField");
    if (steamField) steamField.hidden = !isSteam;
  }

  function setEntryCover(coverUrl, mediaId, mediaSource) {
    $("#fCoverUrl").value = coverUrl || "";
    $("#fMediaId").value = mediaId || "";
    $("#fMediaSource").value = mediaSource || "";
    const coverDiv = $("#entryCover");
    const coverImg = $("#entryCoverImg");
    coverImg.onerror = () => { coverDiv.hidden = true; };
    if (coverUrl) { coverImg.src = coverUrl; coverDiv.hidden = false; }
    else { coverDiv.hidden = true; coverImg.src = ""; }
    showSyncStatus("f", mediaSource);
  }

  function setBacklogCover() {
    const coverUrl = $("#bCoverUrl").value;
    const coverDiv = $("#backlogCover");
    const coverImg = $("#backlogCoverImg");
    const meta = $("#backlogCoverMeta");
    meta.innerHTML = "";
    showSyncStatus("b", $("#bMediaSource").value);
    if (!coverUrl) { coverDiv.hidden = true; coverImg.src = ""; return; }
    coverImg.onerror = () => { coverDiv.hidden = true; };
    coverImg.src = coverUrl;
    const line = [];
    const rating = $("#bExternalRating").value;
    const year = $("#bReleaseYear").value;
    if (rating) line.push("★ " + rating);
    if (year) line.push(year);
    if (line.length) meta.appendChild(el("span", "bl-meta", line.join(" · ")));
    const summary = $("#bSummary").value;
    if (summary) meta.appendChild(el("p", "bl-summary", summary));
    coverDiv.hidden = false;
  }

  function renderTitleSuggestions() {
    const list = $("#fTitleSuggest");
    const query = $("#fTitle").value;

    // If user is typing new content (not just after a local-match pick), clear cover —
    // unless it's a manually-entered Steam App ID, which isn't derived from the title.
    if (query !== lastSyncedEntryTitle && $("#fCoverUrl").value && $("#fMediaSource").value !== "steam") {
      setEntryCover("", "", "");
    }

    const localMatches = titleSuggestions(query, $("#entryId").value || null);
    list.innerHTML = "";

    localMatches.forEach((m) => {
      const item = makeMediaAcItem(
        { title: m.title, coverUrl: m.coverUrl, year: null, externalRating: null },
        () => {
          lastSyncedEntryTitle = m.title;
          $("#fTitle").value = m.title;
          if (state.data.categories.some((c) => c.name === m.category)) $("#fCategory").value = m.category;
          setEntryCover(m.coverUrl, m.mediaId, m.mediaSource);
          updateSyncBtnVisibility("f", $("#fCategory").value);
          list.hidden = true;
        }
      );
      // Replace the generated ac-meta with the reentry-style meta
      const info = item.querySelector(".ac-info");
      const existing = info.querySelector(".ac-meta");
      if (existing) existing.remove();
      info.appendChild(el("span", "ac-meta", `×${m.count} · last ${MONTHS_SHORT[m.month]} ${m.year}`));
      list.appendChild(item);
    });

    list.hidden = !localMatches.length;
  }

  async function syncEntryTitle() {
    const title = $("#fTitle").value.trim();
    const category = $("#fCategory").value;
    if (!title) return;
    const list = $("#fTitleSuggest");
    const results = await fetchMediaSuggestions(title, category);
    list.innerHTML = "";
    if (!results.length) {
      list.hidden = true;
      const err = window.LifeLogMedia && window.LifeLogMedia.getLastError();
      toast(err ? "No matches found — " + err : "No matches found", !!err);
      return;
    }
    results.forEach((r) => {
      list.appendChild(makeMediaAcItem(r, () => {
        setEntryCover(r.coverUrl, r.id, r.source);
        list.hidden = true;
      }));
    });
    list.hidden = false;
  }

  function unsyncEntry() {
    setEntryCover("", "", "");
    $("#fSteamAppId").value = "";
    $("#fTitleSuggest").hidden = true;
  }

  async function saveEntryFromForm(ev) {
    ev.preventDefault();
    const id = $("#entryId").value;
    const fromBacklogId = $("#entryFromBacklog").value;
    const title = $("#fTitle").value.trim();
    const category = $("#fCategory").value;
    const year = parseInt($("#fYear").value, 10);
    const month = parseInt($("#fMonth").value, 10);
    const rating = parseInt($("#fRating").dataset.value, 10) || 0;
    const notes = $("#fNotes").value.trim();
    const coverUrl = $("#fCoverUrl").value;
    const mediaId = $("#fMediaId").value;
    const mediaSource = $("#fMediaSource").value;
    if (!title) return;
    if (id) {
      const e = state.data.entries.find((x) => x.id === id);
      Object.assign(e, { title, category, year, month, date: `${year}-${String(month).padStart(2, "0")}` });
      if (rating) e.rating = rating; else delete e.rating;
      if (notes) e.notes = notes; else delete e.notes;
      if (coverUrl) e.coverUrl = coverUrl; else delete e.coverUrl;
      if (mediaId) e.mediaId = mediaId; else delete e.mediaId;
      if (mediaSource) e.mediaSource = mediaSource; else delete e.mediaSource;
    } else {
      const newEntry = {
        id: uid(), title, category, year, month,
        date: `${year}-${String(month).padStart(2, "0")}`,
        createdAt: new Date().toISOString(),
      };
      if (rating) newEntry.rating = rating;
      if (notes) newEntry.notes = notes;
      if (coverUrl) newEntry.coverUrl = coverUrl;
      if (mediaId) newEntry.mediaId = mediaId;
      if (mediaSource) newEntry.mediaSource = mediaSource;
      state.data.entries.push(newEntry);
    }
    if (fromBacklogId) state.data.backlog = state.data.backlog.filter((b) => b.id !== fromBacklogId);
    closeEntryModal();
    buildYearFilter();
    render();
    await persist();
    toast(id ? "Entry updated" : (fromBacklogId ? "Moved to log" : "Entry added"));
  }

  async function deleteCurrentEntry() {
    const id = $("#entryId").value;
    if (!id) return;
    if (!confirm("Delete this entry?")) return;
    state.data.entries = state.data.entries.filter((x) => x.id !== id);
    closeEntryModal();
    buildYearFilter();
    render();
    await persist();
    toast("Entry deleted");
  }

  // ---------- achievements ----------
  function openAchModal(ach) {
    const editing = !!ach;
    $("#achModalTitle").textContent = editing ? "Edit achievement" : "Add achievement";
    $("#achOrig").value = editing ? `${ach.year}|${ach.index}` : "";
    $("#aText").value = editing ? ach.text : "";
    $("#aYear").value = editing ? ach.year : new Date().getFullYear();
    $("#deleteAchBtn").hidden = !editing;
    const added = $("#achAddedLine");
    if (editing && ach.createdAt) {
      added.textContent = "Added " + new Date(ach.createdAt).toLocaleDateString(undefined,
        { year: "numeric", month: "short", day: "numeric" });
      added.hidden = false;
    } else added.hidden = true;
    $("#aNotes").value = editing ? (ach.notes || "") : "";
    $("#achModal").hidden = false;
  }
  function closeAchModal() { $("#achModal").hidden = true; }

  async function saveAchFromForm(ev) {
    ev.preventDefault();
    const text = $("#aText").value.trim();
    const year = parseInt($("#aYear").value, 10);
    const notes = $("#aNotes").value.trim();
    if (!text || !year) return;
    const accs = state.data.accomplishments;
    const orig = $("#achOrig").value;
    let createdAt = new Date().toISOString();
    if (orig) { // editing: preserve original date, then remove the original
      const [oy, oi] = orig.split("|");
      if (accs[oy] && accs[oy][+oi]) createdAt = accs[oy][+oi].createdAt; // may be null (imported)
      if (accs[oy]) { accs[oy].splice(+oi, 1); if (!accs[oy].length) delete accs[oy]; }
    }
    const ach = { text, createdAt };
    if (notes) ach.notes = notes;
    (accs[year] = accs[year] || []).push(ach);
    closeAchModal();
    render();
    await persist();
    toast(orig ? "Achievement updated" : "Achievement added");
  }

  async function deleteCurrentAch() {
    const orig = $("#achOrig").value;
    if (!orig) return;
    if (!confirm("Delete this achievement?")) return;
    const [oy, oi] = orig.split("|");
    const accs = state.data.accomplishments;
    if (accs[oy]) { accs[oy].splice(+oi, 1); if (!accs[oy].length) delete accs[oy]; }
    closeAchModal();
    render();
    await persist();
    toast("Achievement deleted");
  }

  // ---------- categories management ----------
  function openCategoryModal(cat) {
    const editing = !!cat;
    $("#catModalTitle").textContent = editing ? "Edit category" : "Add category";
    $("#catOrigName").value = editing ? cat.name : "";
    $("#cName").value = editing ? cat.name : "";
    $("#cColor").value = editing ? cat.color : "#3bb2e2";
    const uses = $("#cUses");
    if (editing) {
      const entryCount = countBy(state.data.entries, (e) => e.category)[cat.name] || 0;
      const backlogCount = countBy(state.data.backlog, (b) => b.category)[cat.name] || 0;
      const n = entryCount + backlogCount;
      uses.textContent = n + (n === 1 ? " item uses this" : " items use this");
      uses.hidden = false;
    } else uses.hidden = true;
    $("#deleteCatBtn").hidden = !editing;
    $("#catModal").hidden = false;
  }
  function closeCategoryModal() { $("#catModal").hidden = true; }

  async function saveCategoryFromForm(ev) {
    ev.preventDefault();
    const orig = $("#catOrigName").value;
    const newName = $("#cName").value.trim();
    const color = $("#cColor").value;
    if (!newName) return;

    if (!orig) { // adding a new category
      if (state.data.categories.some((c) => c.name === newName)) {
        toast("That category already exists", true);
        return;
      }
      state.data.categories.push({ id: newName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: newName, color });
      closeCategoryModal();
      rebuildColorMap(); buildCatFilter(); render();
      await persist();
      toast("Category added");
      return;
    }

    const cat = state.data.categories.find((c) => c.name === orig);
    if (!cat) return;
    if (newName !== cat.name && state.data.categories.some((c) => c !== cat && c.name === newName)) {
      toast("A category with that name already exists", true);
      return;
    }
    cat.color = color;
    if (newName !== cat.name) {
      const old = cat.name;
      cat.name = newName;
      cat.id = newName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      state.data.entries.forEach((e) => { if (e.category === old) e.category = newName; });
      state.data.backlog.forEach((b) => { if (b.category === old) b.category = newName; });
      if (state.activeCats.has(old)) { state.activeCats.delete(old); state.activeCats.add(newName); }
    }
    closeCategoryModal();
    rebuildColorMap(); buildCatFilter(); render();
    await persist();
    toast("Category saved");
  }

  function deleteCurrentCategory() {
    const cat = state.data.categories.find((c) => c.name === $("#catOrigName").value);
    if (!cat) return;
    closeCategoryModal();
    deleteCategory(cat); // handles confirm, reassign-to-Other, persist & render
  }

  async function deleteCategory(cat) {
    const counts = countBy(state.data.entries, (e) => e.category);
    const backlogCounts = countBy(state.data.backlog, (b) => b.category);
    const n = (counts[cat.name] || 0) + (backlogCounts[cat.name] || 0);
    if (n > 0) {
      if (cat.name === "Other") {
        toast("Can't delete “Other” while it's in use", true);
        return;
      }
      if (!confirm(`“${cat.name}” is used by ${n} item${n === 1 ? "" : "s"}. Move them to “Other” and delete?`)) return;
      let other = state.data.categories.find((c) => c.name === "Other");
      if (!other) { other = { id: "other", name: "Other", color: "#7a8a99" }; state.data.categories.push(other); }
      state.data.entries.forEach((e) => { if (e.category === cat.name) e.category = "Other"; });
      state.data.backlog.forEach((b) => { if (b.category === cat.name) b.category = "Other"; });
    } else {
      if (!confirm(`Delete category “${cat.name}”?`)) return;
    }
    state.data.categories = state.data.categories.filter((c) => c !== cat);
    state.activeCats.delete(cat.name);
    rebuildColorMap();
    buildCatFilter(); render();
    await persist();
    toast("Category deleted");
  }

  // ---------- backlog ----------
  function openBacklogModal(item) {
    const editing = !!item;
    $("#backlogModalTitle").textContent = editing ? "Edit backlog item" : "Add to backlog";
    $("#backlogId").value = editing ? item.id : "";
    $("#bTitle").value = editing ? item.title : "";
    fillSelect($("#bCategory"),
      state.data.categories.map((c) => ({ value: c.name, label: c.name })),
      editing ? item.category : (state.data.categories[0] && state.data.categories[0].name));
    $("#bNotes").value = editing ? (item.notes || "") : "";
    $("#bCoverUrl").value = editing ? (item.coverUrl || "") : "";
    $("#bMediaId").value = editing ? (item.mediaId || "") : "";
    $("#bMediaSource").value = editing ? (item.mediaSource || "") : "";
    $("#bSummary").value = editing ? (item.summary || "") : "";
    $("#bReleaseYear").value = editing && item.releaseYear ? String(item.releaseYear) : "";
    $("#bExternalRating").value = editing ? (item.externalRating || "") : "";
    lastSyncedBacklogTitle = editing ? item.title : "";
    $("#bSteamAppId").value = editing && item.mediaSource === "steam" ? (item.mediaId || "") : "";
    $("#bTitleSuggest").innerHTML = "";
    $("#bTitleSuggest").hidden = true;
    $("#deleteBacklogBtn").hidden = !editing;
    setBacklogCover();
    updateSyncBtnVisibility("b", $("#bCategory").value);
    $("#backlogModal").hidden = false;
  }
  function closeBacklogModal() { $("#backlogModal").hidden = true; }

  async function saveBacklogFromForm(ev) {
    ev.preventDefault();
    const id = $("#backlogId").value;
    const title = $("#bTitle").value.trim();
    const category = $("#bCategory").value;
    const notes = $("#bNotes").value.trim();
    const coverUrl = $("#bCoverUrl").value;
    const mediaId = $("#bMediaId").value;
    const mediaSource = $("#bMediaSource").value;
    const summary = $("#bSummary").value;
    const releaseYear = $("#bReleaseYear").value;
    const externalRating = $("#bExternalRating").value;
    if (!title) return;
    if (id) {
      const b = state.data.backlog.find((x) => x.id === id);
      Object.assign(b, { title, category });
      if (notes) b.notes = notes; else delete b.notes;
      if (coverUrl) b.coverUrl = coverUrl; else delete b.coverUrl;
      if (mediaId) b.mediaId = mediaId; else delete b.mediaId;
      if (mediaSource) b.mediaSource = mediaSource; else delete b.mediaSource;
      if (summary) b.summary = summary; else delete b.summary;
      if (releaseYear) b.releaseYear = parseInt(releaseYear, 10); else delete b.releaseYear;
      if (externalRating) b.externalRating = externalRating; else delete b.externalRating;
    } else {
      const item = { id: uid(), title, category, createdAt: new Date().toISOString() };
      if (notes) item.notes = notes;
      if (coverUrl) item.coverUrl = coverUrl;
      if (mediaId) item.mediaId = mediaId;
      if (mediaSource) item.mediaSource = mediaSource;
      if (summary) item.summary = summary;
      if (releaseYear) item.releaseYear = parseInt(releaseYear, 10);
      if (externalRating) item.externalRating = externalRating;
      state.data.backlog.push(item);
    }
    closeBacklogModal();
    render();
    await persist();
    toast(id ? "Backlog item updated" : "Added to backlog");
  }

  async function deleteCurrentBacklogItem() {
    const id = $("#backlogId").value;
    if (!id) return;
    if (!confirm("Remove this from your backlog?")) return;
    state.data.backlog = state.data.backlog.filter((x) => x.id !== id);
    closeBacklogModal();
    render();
    await persist();
    toast("Removed from backlog");
  }

  // ---------- finance entries ----------
  function applyFinanceYearlyUI() {
    const yearly = $("#finYearly").checked;
    $("#finDateLabel").hidden = yearly;
    $("#finYearLabel").hidden = !yearly;
    $("#finTypeLabel").hidden = yearly;
    $("#finDate").required = !yearly;
    $("#finYear").required = yearly;
  }
  function openFinanceModal(entry) {
    const editing = !!entry;
    const yearly = editing && !!entry.yearly;
    $("#financeModalTitle").textContent = editing ? "Edit finance entry" : "Add finance entry";
    $("#financeId").value = editing ? entry.id : "";
    $("#finYearly").checked = yearly;
    $("#finDate").value = (editing && !yearly) ? entry.date : new Date().toISOString().slice(0, 10);
    $("#finYear").value = yearly ? entry.date : "";
    $("#finType").value = editing ? entry.type : "expense";
    $("#finAmount").value = editing ? entry.amount : "";
    fillSelect($("#finCategory"),
      state.data.financeCategories.map((c) => ({ value: c.name, label: c.name })),
      editing ? entry.category : (state.data.financeCategories[0] && state.data.financeCategories[0].name));
    $("#finNote").value = editing ? (entry.note || "") : "";
    $("#deleteFinanceBtn").hidden = !editing;
    applyFinanceYearlyUI();
    $("#financeModal").hidden = false;
  }
  function closeFinanceModal() { $("#financeModal").hidden = true; }

  async function saveFinanceFromForm(ev) {
    ev.preventDefault();
    const id = $("#financeId").value;
    const yearly = $("#finYearly").checked;
    const date = yearly ? $("#finYear").value : $("#finDate").value;
    const type = yearly ? "expense" : ($("#finType").value === "income" ? "income" : "expense");
    const amount = Math.abs(parseFloat($("#finAmount").value)) || 0;
    const category = $("#finCategory").value;
    const note = $("#finNote").value.trim();
    if (!date || !amount) return;
    if (yearly && !/^\d{4}$/.test(date)) return;
    if (id) {
      const f = state.data.financeEntries.find((x) => x.id === id);
      Object.assign(f, { date, type, amount, category });
      if (note) f.note = note; else delete f.note;
      if (yearly) f.yearly = true; else delete f.yearly;
    } else {
      const item = { id: uid(), date, type, amount, category, createdAt: new Date().toISOString() };
      if (note) item.note = note;
      if (yearly) item.yearly = true;
      state.data.financeEntries.push(item);
    }
    closeFinanceModal();
    buildYearFilter();
    render();
    await persist();
    toast(id ? "Finance entry updated" : "Finance entry added");
  }

  async function deleteCurrentFinanceEntry() {
    const id = $("#financeId").value;
    if (!id) return;
    if (!confirm("Delete this finance entry?")) return;
    state.data.financeEntries = state.data.financeEntries.filter((x) => x.id !== id);
    closeFinanceModal();
    buildYearFilter();
    render();
    await persist();
    toast("Finance entry deleted");
  }

  // ---------- recurring expenses ----------
  function openRecurringModal(rec) {
    const editing = !!rec;
    $("#recurringModalTitle").textContent = editing ? "Edit recurring expense" : "Add recurring expense";
    $("#recId").value = editing ? rec.id : "";
    $("#recStart").value = editing ? rec.startDate : new Date().toISOString().slice(0, 10);
    $("#recInterval").value = editing ? rec.interval : "monthly";
    $("#recAmount").value = editing ? rec.amount : "";
    fillSelect($("#recCategory"),
      state.data.financeCategories.map((c) => ({ value: c.name, label: c.name })),
      editing ? rec.category : (state.data.financeCategories[0] && state.data.financeCategories[0].name));
    $("#recNote").value = editing ? (rec.note || "") : "";
    $("#stopRecurringBtn").hidden = !editing;
    $("#recurringModal").hidden = false;
  }
  function closeRecurringModal() { $("#recurringModal").hidden = true; }

  async function saveRecurringFromForm(ev) {
    ev.preventDefault();
    const id = $("#recId").value;
    const startDate = $("#recStart").value;
    const interval = $("#recInterval").value;
    const amount = Math.abs(parseFloat($("#recAmount").value)) || 0;
    const category = $("#recCategory").value;
    const note = $("#recNote").value.trim();
    if (!startDate || !amount) return;
    if (id) {
      const r = state.data.recurringExpenses.find((x) => x.id === id);
      Object.assign(r, { startDate, interval, amount, category });
      if (note) r.note = note; else delete r.note;
    } else {
      const item = { id: uid(), startDate, interval, amount, category, createdAt: new Date().toISOString() };
      if (note) item.note = note;
      state.data.recurringExpenses.push(item);
    }
    closeRecurringModal();
    buildYearFilter();
    render();
    await persist();
    toast(id ? "Recurring expense updated" : "Recurring expense added");
  }

  // stops a recurring expense without erasing the occurrences it already
  // generated: capping it at today (rather than deleting the template)
  // keeps everything up to now intact in stats/history
  async function stopCurrentRecurring() {
    const id = $("#recId").value;
    if (!id) return;
    if (!confirm("Stop this recurring expense? Past occurrences stay in your history; no new ones will be generated.")) return;
    const r = state.data.recurringExpenses.find((x) => x.id === id);
    if (r) r.endDate = new Date().toISOString().slice(0, 10);
    closeRecurringModal();
    buildYearFilter();
    render();
    await persist();
    toast("Recurring expense stopped");
  }

  function renderRecurringCard(root) {
    const active = (state.data.recurringExpenses || []).filter((r) => !r.endDate || r.endDate >= new Date().toISOString().slice(0, 10));
    if (!active.length) return;
    const card = el("div", "recur-card");
    const head = el("div", "year-head");
    head.appendChild(el("h2", null, "Recurring expenses"));
    head.appendChild(el("span", "ycount", `${active.length} active`));
    card.appendChild(head);
    active.slice().sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach((r) => {
      const row = el("div", "recur-row");
      const bar = el("div", "bar");
      bar.style.background = financeColorOf(r.category);
      row.appendChild(bar);
      row.appendChild(el("span", "recur-badge", "↻ " + r.interval));
      const t = el("span", "etitle", r.note || r.category);
      t.title = r.note || r.category;
      row.appendChild(t);
      row.appendChild(el("span", "ecat", r.category));
      row.appendChild(el("span", "famount fnegative", "-" + formatMoney(r.amount)));
      row.onclick = () => openRecurringModal(r);
      card.appendChild(row);
    });
    root.appendChild(card);
  }

  // ---------- finance categories management ----------
  function openFinanceCatModal(cat) {
    const editing = !!cat;
    $("#financeCatModalTitle").textContent = editing ? "Edit finance category" : "Add finance category";
    $("#finCatOrigName").value = editing ? cat.name : "";
    $("#finCatName").value = editing ? cat.name : "";
    $("#finCatColorInput").value = editing ? cat.color : "#3bb2e2";
    const uses = $("#finCatUses");
    if (editing) {
      const n = (countBy(state.data.financeEntries, (f) => f.category)[cat.name] || 0)
        + (countBy(state.data.recurringExpenses, (r) => r.category)[cat.name] || 0);
      uses.textContent = n + (n === 1 ? " entry uses this" : " entries use this");
      uses.hidden = false;
    } else uses.hidden = true;
    $("#deleteFinanceCatBtn").hidden = !editing;
    $("#financeCatModal").hidden = false;
  }
  function closeFinanceCatModal() { $("#financeCatModal").hidden = true; }

  async function saveFinanceCatFromForm(ev) {
    ev.preventDefault();
    const orig = $("#finCatOrigName").value;
    const newName = $("#finCatName").value.trim();
    const color = $("#finCatColorInput").value;
    if (!newName) return;

    if (!orig) { // adding a new category
      if (state.data.financeCategories.some((c) => c.name === newName)) {
        toast("That category already exists", true);
        return;
      }
      state.data.financeCategories.push({ id: newName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: newName, color });
      closeFinanceCatModal();
      rebuildFinanceColorMap(); buildCatFilter(); render();
      await persist();
      toast("Finance category added");
      return;
    }

    const cat = state.data.financeCategories.find((c) => c.name === orig);
    if (!cat) return;
    if (newName !== cat.name && state.data.financeCategories.some((c) => c !== cat && c.name === newName)) {
      toast("A category with that name already exists", true);
      return;
    }
    cat.color = color;
    if (newName !== cat.name) {
      const old = cat.name;
      cat.name = newName;
      cat.id = newName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      state.data.financeEntries.forEach((f) => { if (f.category === old) f.category = newName; });
      state.data.recurringExpenses.forEach((r) => { if (r.category === old) r.category = newName; });
      if (state.financeActiveCats.has(old)) { state.financeActiveCats.delete(old); state.financeActiveCats.add(newName); }
    }
    closeFinanceCatModal();
    rebuildFinanceColorMap(); buildCatFilter(); render();
    await persist();
    toast("Finance category saved");
  }

  function deleteCurrentFinanceCategory() {
    const cat = state.data.financeCategories.find((c) => c.name === $("#finCatOrigName").value);
    if (!cat) return;
    closeFinanceCatModal();
    deleteFinanceCategory(cat);
  }

  async function deleteFinanceCategory(cat) {
    const counts = countBy(state.data.financeEntries, (f) => f.category);
    const recurCounts = countBy(state.data.recurringExpenses, (r) => r.category);
    const n = (counts[cat.name] || 0) + (recurCounts[cat.name] || 0);
    if (n > 0) {
      if (cat.name === "Other") {
        toast("Can't delete “Other” while it's in use", true);
        return;
      }
      if (!confirm(`“${cat.name}” is used by ${n} entr${n === 1 ? "y" : "ies"}. Move them to “Other” and delete?`)) return;
      let other = state.data.financeCategories.find((c) => c.name === "Other");
      if (!other) { other = { id: "other", name: "Other", color: "#7a8a99" }; state.data.financeCategories.push(other); }
      state.data.financeEntries.forEach((f) => { if (f.category === cat.name) f.category = "Other"; });
      state.data.recurringExpenses.forEach((r) => { if (r.category === cat.name) r.category = "Other"; });
    } else {
      if (!confirm(`Delete category “${cat.name}”?`)) return;
    }
    state.data.financeCategories = state.data.financeCategories.filter((c) => c !== cat);
    state.financeActiveCats.delete(cat.name);
    rebuildFinanceColorMap();
    buildCatFilter(); render();
    await persist();
    toast("Finance category deleted");
  }

  // ---------- settings / storage ----------
  function setStorageStatus(cls, txt) {
    const s = $("#storageStatus");
    s.innerHTML = "";
    s.appendChild(el("span", "led"));
    s.className = cls;
    s.appendChild(document.createTextNode(txt));
  }

  // Transient state while a load/save is in flight (pulsing led).
  function setSyncing(label) {
    setStorageStatus("storage-status syncing", label);
  }

  // Reflects every connected target ("up to date" once this resolves). Pass
  // the result of Storage.save() to flag when a connected target couldn't be
  // reached (offline) — this updates the persisted pending-sync flag too.
  function refreshStorageStatus(savedWhere) {
    const ghOn = Storage.githubConnected;
    const fileOn = Storage.fileConnected;
    const gi = Storage.githubInfo;

    if (!ghOn && !fileOn) setPendingSync(false);

    if (savedWhere) {
      const ghPending = ghOn && savedWhere !== "github" && savedWhere !== "github+file";
      const filePending = fileOn && savedWhere !== "file" && savedWhere !== "github+file";
      setPendingSync(ghPending || filePending);
    }

    let txt, cls = "storage-status connected";
    if (ghOn && fileOn) txt = "Synced to " + (gi ? gi.owner + "/" + gi.repo : "GitHub") + " + file backup";
    else if (ghOn) txt = "Synced to " + (gi ? gi.owner + "/" + gi.repo : "GitHub");
    else if (fileOn) txt = "Saved to " + (Storage.fileName || "file");
    else if (Storage.fileName && Storage.needsReconnect) { cls = "storage-status local"; txt = "File needs reconnect — open Settings"; }
    else { cls = "storage-status local"; txt = Storage.fsSupported ? "Browser only — set up Data in Settings" : "Browser storage (this browser only)"; }
    if (state.pendingSync && (ghOn || fileOn)) {
      cls = "storage-status pending";
      txt += " — unsynced changes, will sync when online";
    }
    setStorageStatus(cls, txt);
  }

  // Update the persisted pending-sync flag (only writes to storage on change).
  function setPendingSync(val) {
    if (state.pendingSync === val) return;
    state.pendingSync = val;
    savePendingSync(val);
  }

  // ---------- background sync: retry pending saves, poll for remote updates ----------
  let syncInFlight = false;
  let pollTimer = null;

  // Re-attempt a save that previously only landed in the local cache.
  async function retrySync() {
    if (!state.pendingSync || syncInFlight) return;
    await persist();
  }

  function isAnyModalOpen() {
    return !!document.querySelector(".modal-overlay:not([hidden])");
  }

  // Periodic check for changes made on another device. If we have unsynced
  // local edits, push those first; otherwise pull in a newer remote copy.
  async function pollForUpdates() {
    if (!Storage.githubConnected || syncInFlight || isAnyModalOpen()) return;
    if (state.pendingSync) { await retrySync(); return; }
    const res = await Storage.checkRemote();
    if (res && res.changed) {
      // Re-check: a save may have started while checkRemote() was in flight.
      if (syncInFlight || isAnyModalOpen() || state.pendingSync) return;
      state.data = normalize(res.data);
      Storage._cache(state.data);
      afterDataChange();
      refreshStorageStatus();
      toast("Updated from another device");
    }
  }

  // (Re)start the polling timer based on the current setting and connection.
  function schedulePoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    const secs = state.visual.pollInterval;
    if (!secs || !Storage.githubConnected) return;
    pollTimer = setInterval(pollForUpdates, secs * 1000);
  }

  function updateBackendInfo() {
    const info = $("#backendInfo");
    if (!info) return;
    const ghOn = Storage.githubConnected;
    const fileOn = Storage.fileConnected;
    const gi = Storage.githubInfo;
    if (ghOn && fileOn) {
      info.textContent = "Live sync: GitHub → " + gi.owner + "/" + gi.repo + ". Your local file (" + Storage.fileName + ") mirrors every save as an on-disk backup.";
    } else if (ghOn) {
      info.textContent = "Live sync: GitHub → " + gi.owner + "/" + gi.repo + ". Add a local file below for an automatic on-disk backup too.";
    } else if (fileOn) {
      info.textContent = "Saving to local file → " + Storage.fileName + ". Connect GitHub below to also sync to your phone (it becomes the live source, the file stays as backup).";
    } else {
      info.textContent = "Browser storage only. Connect a local file and/or GitHub below — data is written to every one you connect.";
    }
  }

  function updateGithubInfo() {
    const info = $("#ghInfo");
    const conn = $("#ghConnectBtn");
    const disc = $("#ghDisconnectBtn");
    const share = $("#ghShare");
    const gi = Storage.githubInfo;
    if (gi) { // prefill known fields (token is never read back)
      $("#ghRepo").value = gi.owner + "/" + gi.repo;
      $("#ghPath").value = gi.path;
      $("#ghBranch").value = gi.branch;
    }
    if (Storage.githubConnected && gi) {
      info.textContent = "Connected: " + gi.owner + "/" + gi.repo + " (" + gi.path + " on " + gi.branch + "), auto-syncing.";
      conn.textContent = "Update connection";
      disc.hidden = false;
      const frag = Storage.setupFragment();
      if (frag) {
        const link = location.origin + location.pathname + "#" + frag;
        $("#ghSetupLink").value = link;
        // warn when the current URL isn't reachable from a phone
        const localOnly = location.protocol === "file:" || /^(localhost$|127\.|0\.0\.0\.0$|\[::1\]$)/.test(location.hostname);
        $("#ghLocalWarn").hidden = !localOnly;
        // render QR (hidden when local-only or text too long for a v1-9 code)
        const qr = $("#ghQr");
        const tooLong = !localOnly && window.LifeLogQR && !window.LifeLogQR.fits(link);
        const svg = (!localOnly && window.LifeLogQR && !tooLong) ? window.LifeLogQR.svg(link, { size: 200 }) : null;
        if (svg) { qr.innerHTML = svg; qr.hidden = false; } else { qr.innerHTML = ""; qr.hidden = true; }
        $("#ghQrTooLong").hidden = !tooLong;
        share.hidden = false;
      } else share.hidden = true;
    } else {
      info.textContent = "Not connected. Syncs your log to a private GitHub repo so your phone and desktop stay in sync.";
      conn.textContent = "Connect GitHub";
      disc.hidden = true;
      share.hidden = true;
    }
  }

  // ---------- version history (Settings → History tab) ----------
  let historyCache = []; // last fetched list, so restore can look it up

  function formatHistoryDate(iso) {
    if (!iso) return "Unknown time";
    return new Date(iso).toLocaleString();
  }

  async function updateHistoryPanel() {
    const empty = $("#historyEmptyState");
    const controls = $("#historyControls");
    if (!Storage.githubConnected) {
      empty.hidden = false;
      controls.hidden = true;
      return;
    }
    empty.hidden = true;
    controls.hidden = false;
    await refreshHistoryList();
  }

  async function refreshHistoryList() {
    const status = $("#historyStatus");
    const list = $("#historyList");
    status.textContent = "Loading…";
    list.innerHTML = "";
    try {
      historyCache = await Storage.listHistory();
      status.textContent = historyCache.length
        ? `Showing the last ${historyCache.length} save${historyCache.length === 1 ? "" : "s"}.`
        : "No history yet — make a save first.";
      historyCache.forEach((c, i) => {
        const row = el("div", "history-row");
        row.appendChild(el("span", "history-date", formatHistoryDate(c.date)));
        row.appendChild(el("span", "history-msg", c.message || "(no message)"));
        if (i === 0) row.appendChild(el("span", "history-badge", "Current"));
        const btn = el("button", "btn btn-small", i === 0 ? "Current" : "Restore");
        btn.type = "button";
        btn.disabled = i === 0;
        btn.onclick = () => restoreHistoryVersion(c.sha, c.date);
        row.appendChild(btn);
        list.appendChild(row);
      });
    } catch (e) {
      status.textContent = "";
      list.innerHTML = "";
      list.appendChild(el("p", "warn", "Couldn't load history: " + (e.message || e)));
    }
  }

  async function restoreHistoryVersion(sha, date) {
    const when = formatHistoryDate(date);
    if (!confirm(
      "Restore the version from " + when + "?\n\n" +
      "This loads that version's data and saves it as your new current state " +
      "(it becomes a new commit — nothing in GitHub's history is deleted)."
    )) return;
    try {
      setSyncing("Restoring…");
      const data = await Storage.getVersion(sha);
      state.data = normalize(data);
      afterDataChange();
      await persist();
      await refreshHistoryList();
      toast("Restored version from " + when);
    } catch (e) {
      toast("Restore failed: " + (e.message || e), true);
      refreshStorageStatus();
    }
  }

  function updateFileInfo() {
    const info = $("#fileInfo");
    const connect = $("#connectFileBtn");
    const recon = $("#reconnectFileBtn");
    const disc = $("#disconnectFileBtn");
    if (!Storage.fsSupported) {
      info.innerHTML =
        "Saving to a chosen file isn't enabled in this browser." +
        "<br><strong>Using Brave?</strong> It ships this feature off by default. Turn it on: " +
        "open <code>brave://flags</code> → search <em>“File System Access API”</em> → set to " +
        "<strong>Enabled</strong> → <strong>Relaunch</strong>, then reload this page." +
        "<br>Chrome and Edge support it out of the box." +
        "<br>Until then your data is saved in this browser — use <strong>Export JSON</strong> for backups.";
      connect.hidden = true; recon.hidden = true; disc.hidden = true;
      return;
    }
    if (Storage.fileName && !Storage.needsReconnect) {
      info.textContent = "Connected: " + Storage.fileName + " (auto-saving here).";
      connect.textContent = "Change data file…";
      recon.hidden = true; disc.hidden = false;
    } else if (Storage.fileName && Storage.needsReconnect) {
      info.textContent = "File “" + Storage.fileName + "” needs permission again (browsers ask after a restart).";
      recon.hidden = false; disc.hidden = false;
      connect.textContent = "Choose a different file…";
    } else {
      info.textContent = "No file connected. Data is auto-saved in this browser only.";
      connect.textContent = "Choose data file…";
      recon.hidden = true; disc.hidden = true;
    }
  }

  function setSettingsTab(name) {
    document.querySelectorAll(".stab").forEach((t) => t.classList.toggle("active", t.dataset.stab === name));
    document.querySelectorAll(".settings-panel").forEach((p) => {
      const isActive = p.dataset.panel === name;
      p.classList.toggle("active", isActive);
      if (!isActive && p.contains(document.activeElement)) document.activeElement.blur();
    });
  }

  function toggleMediaSections(enabled) {
    $("#mediaKeysSection").hidden = !enabled;
    $("#mediaCatSection").hidden = !enabled;
    $("#mediaDisabledHint").hidden = !!enabled;
  }

  function renderMediaCatRows() {
    const container = $("#mediaCatRows");
    if (!container) return;
    container.innerHTML = "";
    const sources = [
      { value: "", label: "None" },
      { value: "rawg", label: "RAWG (games)" },
      { value: "steam", label: "Steam (manual App ID)" },
      { value: "tmdb-movie", label: "TMDB (movie)" },
      { value: "tmdb-tv", label: "TMDB (TV)" },
      { value: "anilist-anime", label: "AniList (anime)" },
      { value: "anilist-manga", label: "AniList (manga)" },
      { value: "openlibrary", label: "Open Library (books)" },
      { value: "googlebooks", label: "Google Books (books)" },
      { value: "musicbrainz", label: "MusicBrainz (music)" },
    ];
    if (!state.data.categories.length) {
      container.appendChild(el("p", "muted", "No categories yet — add categories first."));
      return;
    }
    for (const cat of state.data.categories) {
      const row = el("div", "media-cat-row");
      row.appendChild(el("span", "media-cat-name", cat.name));
      const sel = el("select", "media-cat-sel");
      sources.forEach((s) => {
        const opt = el("option", null, s.label);
        opt.value = s.value;
        if ((state.data.settings.mediaCategorySources || {})[cat.name] === s.value) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.onchange = async () => {
        if (!state.data.settings.mediaCategorySources) state.data.settings.mediaCategorySources = {};
        state.data.settings.mediaCategorySources[cat.name] = sel.value;
        await persist();
      };
      row.appendChild(sel);
      container.appendChild(row);
    }
  }

  function updateMediaSettings() {
    if (!$("#rawgKey")) return;
    $("#rawgKey").value = state.data.settings.mediaKeys?.rawg || "";
    $("#tmdbKey").value = state.data.settings.mediaKeys?.tmdb || "";
    $("#ggdealsKey").value = state.data.settings.mediaKeys?.ggdeals || "";
    toggleMediaSections(!!state.visual.mediaEnabled);
    renderMediaCatRows();
  }

  function openSettings() {
    setSettingsTab("storage");
    updateBackendInfo();
    updateFileInfo();
    updateGithubInfo();
    updateHistoryPanel();
    $("#ghPollInterval").value = String(state.visual.pollInterval);
    $("#monthMin").value = state.visual.monthMinWidth;
    $("#monthMax").value = state.visual.monthMaxWidth;
    $("#fontFamily").value = state.visual.fontFamily;
    $("#currency").value = state.data.settings.currency;
    $("#mediaEnabled").checked = !!state.visual.mediaEnabled;
    updateMediaSettings();
    updatePrivacySettings();
    $("#settingsModal").hidden = false;
  }

  // ---------- privacy / app lock settings ----------
  let bioAvailable = null; // cached after the first check (per page load)

  async function updatePrivacySettings() {
    $("#privacyEnabled").checked = !!state.privacy.enabled;
    $("#privacyGrace").value = String(state.privacy.graceMinutes || 0);
    $("#privacyMethod").value = state.privacy.method || "pin";
    refreshPrivacyMethodUI();

    if (bioAvailable === null) bioAvailable = await biometricAvailable();
    $("#privacyMethod").querySelector('option[value="biometric"]').disabled = !bioAvailable;
    $("#privacyBioUnavailable").hidden = bioAvailable;
  }

  function refreshPrivacyMethodUI() {
    const method = $("#privacyMethod").value;
    $("#privacyPinControls").hidden = method !== "pin";
    $("#privacyBioControls").hidden = method !== "biometric";

    $("#privacyPinStatus").textContent = state.privacy.pinHash
      ? "A PIN is set on this device." : "No PIN set yet.";
    $("#setPinBtn").textContent = state.privacy.pinHash ? "Change PIN" : "Set PIN";
    $("#removePinBtn").hidden = !state.privacy.pinHash;

    $("#privacyBioStatus").textContent = state.privacy.credentialId
      ? "Fingerprint/Face ID is set up on this device." : "Not set up yet.";
    $("#removeBioBtn").hidden = !state.privacy.credentialId;
  }

  function hidePinForm() {
    $("#privacyPinForm").hidden = true;
    $("#setPinBtn").hidden = false;
    $("#savePinBtn").hidden = true;
    $("#cancelPinBtn").hidden = true;
    $("#newPin").value = ""; $("#confirmPin").value = "";
  }

  function onPollIntervalChange() {
    state.visual.pollInterval = parseInt($("#ghPollInterval").value, 10) || 0;
    saveVisualSettings(state.visual);
    schedulePoll();
  }

  function onLayoutChange() {
    const min = Math.max(80, Math.min(600, parseInt($("#monthMin").value, 10) || 180));
    let max = parseInt($("#monthMax").value, 10);
    if (isNaN(max) || max < 0) max = 0;
    state.visual.monthMinWidth = min;
    state.visual.monthMaxWidth = max;
    saveVisualSettings(state.visual);
    applyMonthLayout();
  }
  function onFontChange() {
    state.visual.fontFamily = $("#fontFamily").value;
    saveVisualSettings(state.visual);
    applyFont();
  }
  function closeSettings() { $("#settingsModal").hidden = true; }

  async function connectFile() {
    try {
      const name = await Storage.connectFile(state.data);
      refreshStorageStatus();
      updateBackendInfo(); updateFileInfo();
      toast(Storage.githubConnected ? "Local backup file connected: " + name : "Connected & saved to " + name);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      toast("Couldn't connect file: " + (e.message || e), true);
    }
  }
  async function reconnectFile() {
    const ok = await Storage.reconnect();
    if (ok) {
      const fresh = await (await Storage.load()).data; // re-read from file
      if (fresh) { state.data = normalize(fresh); afterDataChange(); }
      await persist();
      refreshStorageStatus(); updateBackendInfo(); updateFileInfo();
      toast("Reconnected");
    } else toast("Permission denied", true);
  }
  async function disconnectFile() {
    await Storage.disconnect();
    refreshStorageStatus();
    updateBackendInfo(); updateFileInfo();
    toast(Storage.githubConnected ? "Local backup file disconnected (GitHub still syncing)" : "Local file disconnected (browser storage only)");
  }

  async function connectGithub() {
    const token = $("#ghToken").value.trim();
    if (!token) { toast("Paste your access token", true); return; }
    // Repo is optional (Advanced); blank → owner derived from token, repo = lifelog-data.
    let owner = "", repo = "";
    const repoRaw = $("#ghRepo").value.trim();
    if (repoRaw) {
      const m = repoRaw.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
      if (!m) { toast("Advanced repo must be owner/repo", true); return; }
      owner = m[1]; repo = m[2];
    }
    const cfg = {
      owner: owner, repo: repo,
      path: $("#ghPath").value.trim() || "lifelog.json",
      branch: $("#ghBranch").value.trim() || "main",
      token: token,
    };
    try {
      toast("Connecting to GitHub…");
      const res = await Storage.connectGithub(cfg, state.data);
      if (res.existed && res.data && Array.isArray(res.data.entries)) {
        const useRemote = confirm(
          "That repo already has a log with " + res.data.entries.length + " entries.\n\n" +
          "OK = load it onto this device.\n" +
          "Cancel = overwrite it with this device's " + state.data.entries.length + " entries."
        );
        if (useRemote) { state.data = normalize(res.data); afterDataChange(); }
        else { await persist(); } // overwrite remote with local
      }
      $("#ghToken").value = "";
      refreshStorageStatus();
      updateBackendInfo(); updateGithubInfo(); updateFileInfo(); updateHistoryPanel();
      schedulePoll();
      toast(Storage.fileConnected ? "GitHub connected — syncing, file kept as backup" : "GitHub connected — syncing here");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      toast("GitHub: " + (e.message || e), true);
    }
  }

  async function disconnectGithub() {
    await Storage.disconnectGithub();
    refreshStorageStatus();
    updateBackendInfo(); updateGithubInfo(); updateFileInfo(); updateHistoryPanel();
    schedulePoll();
    toast(Storage.fileConnected ? "GitHub disconnected (still saving to local file)" : "GitHub disconnected (browser storage only)");
  }

  // ---------- import / export ----------
  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = el("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  function exportJson() {
    download("lifelog.json", JSON.stringify(state.data, null, 2), "application/json");
  }
  function csvEsc(s) {
    s = String(s == null ? "" : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportJournalJson() {
    const payload = { entries: state.data.entries, backlog: state.data.backlog, categories: state.data.categories };
    download("lifelog-journal.json", JSON.stringify(payload, null, 2), "application/json");
  }
  function exportFinanceJson() {
    const payload = {
      financeEntries: state.data.financeEntries,
      financeCategories: state.data.financeCategories,
      recurringExpenses: state.data.recurringExpenses,
    };
    download("lifelog-finance.json", JSON.stringify(payload, null, 2), "application/json");
  }
  // journal CSV covers both Timeline entries (dated, Year+Month) and Backlog
  // items (undated) — the Kind column tells them apart on re-import
  function exportJournalCsv() {
    const rows = [["Kind", "Year", "Month", "Category", "Title", "Added"]];
    state.data.entries.slice()
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .forEach((e) => rows.push(["Entry", e.year, MONTHS[e.month], e.category, e.title,
        e.createdAt ? e.createdAt.slice(0, 10) : ""]));
    state.data.backlog.slice()
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
      .forEach((b) => rows.push(["Backlog", "", "", b.category, b.title,
        b.createdAt ? b.createdAt.slice(0, 10) : ""]));
    download("lifelog-journal.csv", rows.map((r) => r.map(csvEsc).join(",")).join("\n"), "text/csv");
  }
  const MONTH_NAME_TO_NUM = MONTHS.reduce((m, name, i) => { if (name) m[name.toLowerCase()] = i; return m; }, {});
  function parseJournalCsv(text) {
    const rows = parseCsv(text);
    const entries = [];
    const backlog = [];
    for (const row of rows) {
      const kind = (row[0] || "").trim().toLowerCase();
      if (kind !== "entry" && kind !== "backlog") continue; // skips header row + blank lines
      const category = (row[3] || "Other").trim() || "Other";
      const title = (row[4] || "").trim();
      const createdAt = (row[5] || "").trim();
      if (!title) continue;
      if (kind === "entry") {
        const year = parseInt(row[1], 10);
        const month = MONTH_NAME_TO_NUM[(row[2] || "").trim().toLowerCase()];
        if (!year || !month) continue;
        entries.push({ title, category, year, month, createdAt: createdAt ? new Date(createdAt).toISOString() : null });
      } else {
        backlog.push({ title, category, createdAt: createdAt ? new Date(createdAt).toISOString() : null });
      }
    }
    if (!entries.length && !backlog.length) throw new Error("No rows found — is this a Journal CSV export?");
    return { entries, backlog };
  }

  // ---------- unified import review ----------
  // Builds the mixed-kind item list + new-category list for the picker,
  // scoped to "journal" (entries/backlog), "finance" (finance/recurring), or
  // "all" (everything) — shared by every JSON/CSV importer below.
  function buildNewCategoryList(items, incomingCats, knownCategories) {
    const known = new Set(knownCategories.map((c) => c.name));
    const colorByName = {};
    for (const c of incomingCats || []) if (c.name) colorByName[c.name] = c.color;
    const names = new Set((incomingCats || []).map((c) => c.name).filter(Boolean));
    for (const it of items) if (it.entry.category) names.add(it.entry.category);
    const out = [];
    let pi = 0;
    names.forEach((name) => {
      if (known.has(name)) return;
      out.push({ name, color: colorByName[name] || CATEGORY_PALETTE[pi++ % CATEGORY_PALETTE.length], scope: knownCategories === state.data.financeCategories ? "finance" : "journal", add: true });
    });
    return out;
  }
  function buildImportItems({ entries, backlog, financeEntries, recurringExpenses, categories, financeCategories }) {
    const items = [];
    const entryKey = (e) => `${(e.title || "").toLowerCase()}|${(e.category || "").toLowerCase()}|${+e.year}|${+e.month}`;
    const backlogKey = (b) => `${(b.title || "").toLowerCase()}|${(b.category || "").toLowerCase()}`;
    const existingEntryKeys = new Set(state.data.entries.map(entryKey));
    const existingBacklogKeys = new Set(state.data.backlog.map(backlogKey));
    const existingFinanceKeys = new Set(state.data.financeEntries.map(financeKey));
    const existingRecurKeys = new Set(state.data.recurringExpenses.map(recurringKey));

    (entries || []).map(sanitizeEntry).forEach((e) => {
      const dup = existingEntryKeys.has(entryKey(e));
      items.push({ kind: "entry", entry: e, dup, checked: !dup });
    });
    (backlog || []).map(sanitizeBacklog).forEach((b) => {
      const dup = existingBacklogKeys.has(backlogKey(b));
      items.push({ kind: "backlog", entry: b, dup, checked: !dup });
    });
    (financeEntries || []).map(sanitizeFinanceEntry).forEach((f) => {
      const dup = existingFinanceKeys.has(financeKey(f));
      items.push({ kind: "finance", entry: f, dup, checked: !dup });
    });
    (recurringExpenses || []).map(sanitizeRecurring).forEach((r) => {
      const dup = existingRecurKeys.has(recurringKey(r));
      items.push({ kind: "recurring", entry: r, dup, checked: !dup });
    });

    const newCategories = [
      ...buildNewCategoryList(items.filter((i) => i.kind === "entry" || i.kind === "backlog"), categories, state.data.categories),
      ...buildNewCategoryList(items.filter((i) => i.kind === "finance" || i.kind === "recurring"), financeCategories, state.data.financeCategories),
    ];
    return { items, newCategories };
  }
  // applies a confirmed picker selection: registers opted-in new categories,
  // pushes each selected item into its matching state array, and reports a
  // single summary toast across every kind that was touched
  async function applyImportSelection(selected, addCats) {
    if (!selected.length) { toast("Nothing selected"); return; }
    for (const c of addCats) {
      const target = c.scope === "finance" ? state.data.financeCategories : state.data.categories;
      if (!target.some((x) => x.name === c.name)) target.push({ id: c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: c.name, color: c.color });
    }
    const byKind = { entry: [], backlog: [], finance: [], recurring: [] };
    selected.forEach((i) => byKind[i.kind].push(i.entry));
    state.data.entries.push(...byKind.entry);
    state.data.backlog.push(...byKind.backlog);
    state.data.financeEntries.push(...byKind.finance);
    state.data.recurringExpenses.push(...byKind.recurring);
    ensureCategories(state.data.categories, [...byKind.entry, ...byKind.backlog]);
    ensureCategories(state.data.financeCategories, [...byKind.finance, ...byKind.recurring]);

    afterDataChange();
    await persist();
    const parts = [];
    if (byKind.entry.length) parts.push(`${byKind.entry.length} entries`);
    if (byKind.backlog.length) parts.push(`${byKind.backlog.length} backlog items`);
    if (byKind.finance.length) parts.push(`${byKind.finance.length} finance entries`);
    if (byKind.recurring.length) parts.push(`${byKind.recurring.length} recurring expenses`);
    toast(`Imported ${parts.join(", ")}`);
  }
  function mergeAccomplishments(accIn) {
    let added = 0;
    for (const y of Object.keys(accIn || {})) {
      state.data.accomplishments[y] = state.data.accomplishments[y] || [];
      const existingTexts = new Set(state.data.accomplishments[y].map((a) => (a.text || "").toLowerCase()));
      for (const a of accIn[y] || []) {
        const out = typeof a === "string" ? { text: a, createdAt: null } : { text: a.text || "", createdAt: a.createdAt || null, ...(a.notes ? { notes: a.notes } : {}) };
        if (out.text && !existingTexts.has(out.text.toLowerCase())) { state.data.accomplishments[y].push(out); existingTexts.add(out.text.toLowerCase()); added++; }
      }
    }
    return added;
  }
  function reviewAndImport(title, hint, built, extraOnConfirm) {
    if (!built.items.length) { toast("No items found in this file"); return; }
    openImportPicker({
      title, hint, mode: "import", items: built.items, newCategories: built.newCategories,
      confirmLabel: "Import",
      onConfirm: async (selected, addCats) => {
        await applyImportSelection(selected, addCats);
        if (extraOnConfirm) extraOnConfirm();
      },
    });
  }
  function importJsonAll(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!Array.isArray(incoming.entries) && !Array.isArray(incoming.backlog) && !Array.isArray(incoming.financeEntries)) throw new Error("not a LifeLog file");
        const built = buildImportItems(incoming);
        reviewAndImport("Import full backup", "Review what to bring in — pick individual items, toggle whole periods on/off, and choose which new categories to add. Items already in your data are hidden by default.", built, () => {
          const added = mergeAccomplishments(incoming.accomplishments);
          if (added) toast(`Also imported ${added} accomplishment${added === 1 ? "" : "s"}`);
        });
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
  }
  function importJournalJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!Array.isArray(incoming.entries) && !Array.isArray(incoming.backlog)) throw new Error("not a Journal export");
        const built = buildImportItems(incoming);
        reviewAndImport("Import journal data", "Review what to bring in — pick individual items, toggle whole periods on/off, and choose which new categories to add. Items already in your data are hidden by default.", built);
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
  }
  function importJournalCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { entries, backlog } = parseJournalCsv(reader.result);
        const built = buildImportItems({ entries, backlog });
        reviewAndImport("Import journal CSV", "Review what to bring in — pick individual items, toggle whole periods on/off, and choose which new categories to add. Items already in your data are hidden by default.", built);
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
  }
  function importFinanceJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!Array.isArray(incoming.financeEntries) && !Array.isArray(incoming.recurringExpenses)) throw new Error("not a Finance export");
        const built = buildImportItems(incoming);
        reviewAndImport("Import finance data", "Review what to bring in — pick individual items, toggle whole periods on/off, and choose which new categories to add. Items already in your data are hidden by default.", built);
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
  }

  // parses CSV text into rows of cells, honoring quoted fields (with
  // "" escapes) that may contain commas or newlines — needed because
  // money cells like "₪1,302.00" are quoted due to the embedded comma
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n") {
        row.push(field); field = ""; rows.push(row); row = [];
      } else if (c === "\r") {
        // ignore; \n follows
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function parseMoneyCell(s) {
    return parseFloat(String(s || "").replace(/[^0-9.\-]/g, "")) || 0;
  }
  // parses a yearly pivot-report export: each year has a 12-month x 3-column
  // (Amount, Category, Note) grid for real line items, a redundant
  // monthly-totals/category-totals matrix, and trailing ad-hoc big purchases
  // with a year-level amount + label but no month
  function parseFinanceCsv(text) {
    const rows = parseCsv(text);
    // category-totals, grand-total, and per-month-average rows repeat the
    // same label across every month column with zero/blank cells — they're
    // redundant aggregates, not real transactions, so skip the whole row
    const rowSkipLabels = new Set([
      ...state.data.financeCategories.map((c) => c.name),
      "Total", "Per Month",
    ]);
    // month-totals rows (the first 12 rows of each year block) carry a real
    // transaction in one of their month columns *and* a month name in the
    // trailing label — that label should only be excluded from the yearly
    // ad-hoc-expense check below, not used to skip the row's own monthly data
    const reservedLabels = new Set([...MONTHS.slice(1), ...rowSkipLabels]);
    const monthly = [];
    const yearly = [];
    let currentYear = null;
    for (const row of rows) {
      const yearMatch = (row[1] || "").trim().match(/^(\d{4}):$/);
      if (yearMatch) { currentYear = yearMatch[1]; continue; }
      if (!currentYear) continue;
      const label = (row[37] || "").trim();
      if (label && rowSkipLabels.has(label)) continue;
      for (let m = 0; m < 12; m++) {
        const amount = parseMoneyCell(row[0 + m * 3]);
        if (!amount) continue;
        const category = (row[1 + m * 3] || "").trim() || "Other";
        const note = (row[2 + m * 3] || "").trim();
        monthly.push({ date: `${currentYear}-${String(m + 1).padStart(2, "0")}-01`, type: "expense", amount, category, note });
      }
      if (label && !reservedLabels.has(label)) {
        const amount = parseMoneyCell(row[36]);
        if (amount) yearly.push({ date: currentYear, type: "expense", amount, category: "Other", note: label, yearly: true });
      }
    }
    if (currentYear === null) throw new Error("No year blocks found — is this the right CSV export?");
    return { monthly, yearly };
  }
  function importFinanceCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { monthly, yearly } = parseFinanceCsv(reader.result);
        const incoming = [...monthly, ...yearly];
        const built = buildImportItems({ financeEntries: incoming });
        reviewAndImport("Import Finance CSV", "Pick which entries to add, disable whole years/months at once, and choose which new categories to bring in. Entries already in your data are hidden by default — turn on the toggle below to review and re-import them anyway.", built);
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
  }
  function exportFinanceCsv() {
    if (!state.data.financeEntries.length) { toast("No finance entries to export"); return; }
    const items = state.data.financeEntries.map((entry) => ({ kind: "finance", entry, dup: false, checked: true }));
    openImportPicker({
      title: "Export Finance CSV",
      hint: "Pick which entries to export.",
      mode: "export",
      items,
      confirmLabel: "Export",
      onConfirm: (selected) => {
        if (!selected.length) { toast("Nothing selected"); return; }
        const rows = [["Date", "Type", "Amount", "Category", "Note", "Yearly"]];
        selected.map((i) => i.entry).sort((a, b) => b.date.localeCompare(a.date)).forEach((f) =>
          rows.push([f.date, f.type, f.amount, f.category, f.note || "", f.yearly ? "yes" : ""]));
        download("lifelog-finance.csv", rows.map((r) => r.map(csvEsc).join(",")).join("\n"), "text/csv");
        toast(`Exported ${selected.length} entr${selected.length === 1 ? "y" : "ies"}`);
      },
    });
  }

  // ---------- shared import/export review picker ----------
  // Used by every importer/exporter above. Items are { kind, entry, dup,
  // checked } where kind is "entry" (journal), "backlog", "finance", or
  // "recurring" — rendered with a kind-appropriate row, grouped into
  // year/month "period" chips that bulk-toggle their items on/off, with an
  // optional "new categories found" checklist shown above the list (import
  // only).
  function importItemDateStr(item) {
    const e = item.entry;
    if (item.kind === "finance") return e.date || "";
    if (item.kind === "entry") return `${e.year}-${String(e.month).padStart(2, "0")}`;
    if (item.kind === "recurring") return e.startDate || "";
    return ""; // backlog has no date
  }
  function importBucketKey(item) {
    const ds = importItemDateStr(item);
    if (!ds) return null;
    return ds.length === 4 ? ds : ds.slice(0, 7);
  }
  function importBucketLabel(key) {
    if (key.length === 4) return `${key} · yearly`;
    const [y, m] = key.split("-");
    return `${MONTHS_SHORT[+m]} ${y}`;
  }
  function importRowFor(item, onChange) {
    const e = item.entry;
    const finance = item.kind === "finance" || item.kind === "recurring";
    const row = el("label", "entry picker-row" + (item.dup ? " is-dup" : "") + (finance ? " finance-entry" : "") + (e.yearly ? " yearly-expense" : ""));
    const cb = el("input"); cb.type = "checkbox"; cb.checked = item.checked;
    cb.onchange = () => { item.checked = cb.checked; onChange(); };
    row.appendChild(cb);
    const bar = el("div", "bar");
    bar.style.background = finance ? financeColorOf(e.category) : colorOf(e.category);
    row.appendChild(bar);
    if (item.kind === "finance") {
      row.appendChild(el("span", "fdate" + (e.yearly ? " fyearly" : ""), e.yearly ? `${e.date} · yearly` : e.date));
      const t = el("span", "etitle", e.note || e.category); t.title = e.note || e.category; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      const sign = e.type === "income" ? "+" : "-";
      row.appendChild(el("span", "famount " + (e.type === "income" ? "fpositive" : "fnegative"), sign + formatMoney(e.amount)));
    } else if (item.kind === "recurring") {
      row.appendChild(el("span", "fdate", e.startDate));
      row.appendChild(el("span", "recur-badge", "↻ " + e.interval));
      const t = el("span", "etitle", e.note || e.category); t.title = e.note || e.category; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      row.appendChild(el("span", "famount fnegative", "-" + formatMoney(e.amount)));
    } else if (item.kind === "entry") {
      row.appendChild(el("span", "fdate", `${MONTHS_SHORT[e.month]} ${e.year}`));
      const t = el("span", "etitle", e.title); t.title = e.title; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
    } else { // backlog
      row.appendChild(el("span", "fdate", "—"));
      const t = el("span", "etitle", e.title); t.title = e.title; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      row.appendChild(el("span", "dup-tag", "backlog"));
    }
    if (item.dup) row.appendChild(el("span", "dup-tag", "already added"));
    return row;
  }
  function openImportPicker({ title, hint, mode, items, newCategories, confirmLabel, onConfirm }) {
    items = items.slice().sort((a, b) => importItemDateStr(b).localeCompare(importItemDateStr(a)));
    newCategories = newCategories || [];
    $("#financePickerTitle").textContent = title;
    $("#financePickerHint").textContent = hint;
    $("#financePickerConfirmBtn").textContent = confirmLabel;
    const dupRow = $("#financePickerDupRow");
    const showDupCb = $("#financePickerShowDup");
    dupRow.hidden = mode !== "import" || !items.some((i) => i.dup);
    showDupCb.checked = false;
    const list = $("#financePickerList");
    const bucketsWrap = $("#financePickerBuckets");
    const newCatsWrap = $("#financePickerNewCats");
    const newCatsList = $("#financePickerNewCatsList");

    newCatsWrap.hidden = !newCategories.length;
    newCatsList.innerHTML = "";
    newCategories.forEach((nc) => {
      const row = el("label", "toggle-label");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = nc.add;
      cb.onchange = () => { nc.add = cb.checked; };
      row.appendChild(cb);
      const dot = el("span", "dot"); dot.style.background = nc.color;
      dot.style.width = "9px"; dot.style.height = "9px"; dot.style.borderRadius = "50%"; dot.style.display = "inline-block";
      row.appendChild(dot);
      row.appendChild(document.createTextNode(nc.name));
      newCatsList.appendChild(row);
    });

    function visibleItems() { return items.filter((i) => !i.dup || showDupCb.checked); }
    function renderBuckets() {
      const map = new Map();
      visibleItems().forEach((i) => {
        const key = importBucketKey(i);
        if (key) (map.get(key) || map.set(key, []).get(key)).push(i);
      });
      bucketsWrap.innerHTML = "";
      bucketsWrap.hidden = map.size < 2;
      [...map.keys()].sort((a, b) => b.localeCompare(a)).forEach((key) => {
        const its = map.get(key);
        const allOn = its.every((i) => i.checked);
        const chip = el("span", "cat-chip" + (allOn ? " on" : ""), importBucketLabel(key));
        chip.title = "Toggle this period on/off";
        chip.onclick = () => { const v = !allOn; its.forEach((i) => (i.checked = v)); render(); };
        bucketsWrap.appendChild(chip);
      });
    }
    function updateCount() {
      const checked = visibleItems().filter((i) => i.checked).length;
      $("#financePickerCount").textContent = `${checked} selected`;
    }
    function render() {
      list.innerHTML = "";
      visibleItems().forEach((item) => list.appendChild(importRowFor(item, updateCount)));
      renderBuckets();
      updateCount();
    }

    showDupCb.onchange = render;
    $("#financePickerSelectAll").onclick = () => { visibleItems().forEach((i) => (i.checked = true)); render(); };
    $("#financePickerSelectNone").onclick = () => { visibleItems().forEach((i) => (i.checked = false)); render(); };
    $("#financePickerCancelBtn").onclick = () => { $("#financePickerModal").hidden = true; };
    $("#financePickerConfirmBtn").onclick = async () => {
      const selected = items.filter((i) => i.checked);
      const addCats = newCategories.filter((nc) => nc.add);
      $("#financePickerModal").hidden = true;
      await onConfirm(selected, addCats);
    };

    render();
    $("#financePickerModal").hidden = false;
  }

  // ---------- data lifecycle ----------
  function sanitizeEntry(e) {
    const out = {
      id: e.id || uid(),
      title: e.title || "",
      category: e.category || "Other",
      year: +e.year,
      month: +e.month,
      date: e.date || `${e.year}-${String(e.month).padStart(2, "0")}`,
      createdAt: e.createdAt || null,
    };
    if (e.rating) out.rating = +e.rating;
    if (e.notes) out.notes = e.notes;
    if (e.coverUrl) out.coverUrl = e.coverUrl;
    if (e.mediaId) out.mediaId = e.mediaId;
    if (e.mediaSource) out.mediaSource = e.mediaSource;
    return out;
  }
  function sanitizeBacklog(b) {
    const out = {
      id: b.id || uid(),
      title: b.title || "",
      category: b.category || "Other",
      createdAt: b.createdAt || null,
    };
    if (b.notes) out.notes = b.notes;
    if (b.coverUrl) out.coverUrl = b.coverUrl;
    if (b.mediaId) out.mediaId = b.mediaId;
    if (b.mediaSource) out.mediaSource = b.mediaSource;
    if (b.summary) out.summary = b.summary;
    if (b.releaseYear) out.releaseYear = b.releaseYear;
    if (b.externalRating) out.externalRating = b.externalRating;
    return out;
  }
  function sanitizeFinanceEntry(f) {
    const out = {
      id: f.id || uid(),
      date: f.date || "",
      type: f.type === "income" ? "income" : "expense",
      amount: Math.abs(+f.amount) || 0,
      category: f.category || "Other",
      createdAt: f.createdAt || null,
    };
    if (f.yearly) {
      out.yearly = true;
      out.type = "expense";
      out.date = String(out.date).slice(0, 4);
    }
    if (f.note) out.note = f.note;
    return out;
  }
  const financeKey = (f) => `${(f.date || "").toLowerCase()}|${f.type}|${+f.amount}|${(f.category || "").toLowerCase()}|${(f.note || "").toLowerCase()}|${f.yearly ? 1 : 0}`;
  function sanitizeRecurring(r) {
    const out = {
      id: r.id || uid(),
      startDate: r.startDate || "",
      interval: ["weekly", "monthly", "yearly"].includes(r.interval) ? r.interval : "monthly",
      amount: Math.abs(+r.amount) || 0,
      category: r.category || "Other",
      createdAt: r.createdAt || null,
    };
    if (r.note) out.note = r.note;
    if (r.endDate) out.endDate = r.endDate;
    return out;
  }
  const recurringKey = (r) => `${r.startDate}|${r.interval}|${+r.amount}|${(r.category || "").toLowerCase()}|${(r.note || "").toLowerCase()}`;
  // adds a category entry (with a palette color) for any category name used
  // by entries/backlog items that isn't already known
  function ensureCategories(categories, items) {
    const known = new Set(categories.map((c) => c.name));
    const palette = CATEGORY_PALETTE;
    let pi = categories.length;
    for (const item of items) if (!known.has(item.category)) {
      known.add(item.category);
      categories.push({ id: item.category.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: item.category, color: palette[pi++ % palette.length] });
    }
  }
  function normalize(data) {
    data = data || emptyData();
    data.categories = data.categories || [];
    data.entries = (data.entries || []).map(sanitizeEntry);
    data.backlog = (data.backlog || []).map(sanitizeBacklog);
    const incomingSettings = data.settings || {};
    // One-time migration: visual layout prefs used to be synced as part of
    // data.settings. Pull them into this device's local-only settings if it
    // doesn't have its own yet, then drop them from the synced data.
    if (localStorage.getItem(VISUAL_KEY) == null &&
        (incomingSettings.monthMinWidth != null || incomingSettings.monthMaxWidth != null)) {
      state.visual = {
        monthMinWidth: incomingSettings.monthMinWidth ?? DEFAULT_VISUAL.monthMinWidth,
        monthMaxWidth: incomingSettings.monthMaxWidth ?? DEFAULT_VISUAL.monthMaxWidth,
      };
      saveVisualSettings(state.visual);
    }
    // One-time migration: the media-enrichment on/off toggle and its
    // per-category source assignments used to both live in local-only
    // media settings. The toggle stays local (each device can opt in/out
    // independently); the assignments move into data.settings so they sync
    // and don't need redoing per device.
    if (state.media.enabled !== undefined) {
      state.visual.mediaEnabled = !!state.media.enabled;
      delete state.media.enabled;
      saveVisualSettings(state.visual);
    }
    let mediaCategorySources = incomingSettings.mediaCategorySources;
    if (mediaCategorySources === undefined) mediaCategorySources = state.media.categorySources || {};
    if (state.media.categorySources !== undefined) {
      delete state.media.categorySources;
      saveMediaSettings();
    }
    // One-time migration: API keys used to live in local-only media settings,
    // kept separate from synced data for privacy. Now they sync like
    // everything else, so pasting a key once covers every device.
    let mediaKeys = incomingSettings.mediaKeys
      ? { ...DEFAULT_SETTINGS.mediaKeys, ...incomingSettings.mediaKeys }
      : { ...DEFAULT_SETTINGS.mediaKeys, rawg: state.media.rawgKey || "", tmdb: state.media.tmdbKey || "" };
    if (state.media.rawgKey !== undefined || state.media.tmdbKey !== undefined) {
      delete state.media.rawgKey;
      delete state.media.tmdbKey;
      saveMediaSettings();
    }
    data.settings = {
      monthOrder: incomingSettings.monthOrder || DEFAULT_SETTINGS.monthOrder,
      currency: incomingSettings.currency || DEFAULT_SETTINGS.currency,
      mediaCategorySources,
      mediaKeys,
    };
    const accIn = data.accomplishments || {};
    data.accomplishments = {};
    for (const y of Object.keys(accIn)) {
      data.accomplishments[y] = (accIn[y] || []).map((a) => {
        if (typeof a === "string") return { text: a, createdAt: null };
        const out = { text: a.text || "", createdAt: a.createdAt || null };
        if (a.notes) out.notes = a.notes;
        return out;
      });
    }
    // ensure every used category exists
    ensureCategories(data.categories, [...data.entries, ...data.backlog]);

    if (data.financeCategories === undefined) data.financeCategories = seedFinanceCategories();
    data.financeEntries = (data.financeEntries || []).map(sanitizeFinanceEntry);
    data.recurringExpenses = (data.recurringExpenses || []).map(sanitizeRecurring);
    ensureCategories(data.financeCategories, [...data.financeEntries, ...data.recurringExpenses]);

    return data;
  }

  function afterDataChange() {
    rebuildColorMap();
    rebuildFinanceColorMap();
    applyMonthLayout();
    applyFont();
    buildYearFilter();
    buildCatFilter();
    render();
  }

  function applyMonthLayout() {
    const s = state.visual || DEFAULT_VISUAL;
    const min = Math.max(80, parseInt(s.monthMinWidth, 10) || 180);
    const max = parseInt(s.monthMaxWidth, 10) || 0;
    document.documentElement.style.setProperty("--month-min", min + "px");
    document.documentElement.style.setProperty("--month-max", max > 0 ? Math.max(min, max) + "px" : "1fr");
  }

  function applyFont() {
    const s = state.visual || DEFAULT_VISUAL;
    document.documentElement.style.setProperty("--font-family", FONT_STACKS[s.fontFamily] || FONT_STACKS.system);
  }

  function timelineToolbar() {
    const bar = el("div", "timeline-toolbar");
    const desc = state.data.settings.monthOrder === "desc";
    const btn = el("button", "btn btn-sm", desc ? "↑ Oldest first" : "↓ Newest first");
    btn.type = "button";
    btn.title = desc
      ? "Showing newest month first within each year — click for oldest first"
      : "Showing oldest month first within each year — click for newest first";
    btn.onclick = toggleMonthOrder;
    bar.appendChild(btn);
    return bar;
  }

  async function toggleMonthOrder() {
    state.data.settings.monthOrder = state.data.settings.monthOrder === "desc" ? "asc" : "desc";
    render();
    await persist();
  }

  // ---------- events ----------
  function wire() {
    $("#appVersion").textContent = "LifeLog v" + APP_VERSION;

    // Sticky timeline year/month headers (see .year-head / .month-card h3 in
    // styles.css) anchor below the topbar — its height changes with wrapping,
    // so track it live rather than hardcoding a pixel value.
    const topbar = $(".topbar");
    const setTopbarH = () => document.documentElement.style.setProperty("--topbar-h", topbar.offsetHeight + "px");
    new ResizeObserver(setTopbarH).observe(topbar);
    setTopbarH();

    // Bulk-select drag-paint: while dragPaint is set (started by a
    // checkbox's pointerdown), moving over other checkboxes paints them to
    // the same value. Uses elementFromPoint instead of event.target since
    // re-rendering mid-drag swaps out the actual DOM nodes.
    document.addEventListener("pointermove", (ev) => {
      if (!dragPaint) return;
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const cb = target && target.closest(".bulk-check");
      if (!cb) return;
      setBulkItem(cb.dataset.blId, dragPaint.value, { skipRender: true });
    });
    const endDragPaint = () => { if (dragPaint) { dragPaint = null; render(); } };
    document.addEventListener("pointerup", endDragPaint);
    document.addEventListener("pointercancel", endDragPaint);
    const viewTabs = $("#viewTabs");
    // On mobile the active view shows as a button outside #viewTabs; tapping
    // it opens a menu of the other views (see .views.open in styles.css).
    $("#viewCurrent").onclick = (e) => {
      e.stopPropagation();
      const isOpen = viewTabs.classList.toggle("open");
      if (isOpen) {
        const btn = e.currentTarget;
        viewTabs.style.left = btn.offsetLeft + "px";
        viewTabs.style.width = btn.offsetWidth + "px";
      }
    };
    document.querySelectorAll(".tab").forEach((t) =>
      t.onclick = (e) => {
        e.stopPropagation();
        viewTabs.classList.remove("open");
        state.view = t.dataset.view;
        buildYearFilter();
        buildCatFilter();
        render();
        saveUiState();
      });
    let scrollSaveTimer;
    window.addEventListener("scroll", () => {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(saveUiState, 300);
    }, { passive: true });
    $("#search").oninput = (e) => { state.search = e.target.value; render(); };
    $("#yearFilterLabel").onclick = toggleAllYears;
    $("#catFilterLabel").onclick = toggleAllCats;

    const addMenu = $("#addMenu");
    const closeAddMenu = () => { addMenu.hidden = true; };
    $("#addBtn").onclick = (e) => { e.stopPropagation(); addMenu.hidden = !addMenu.hidden; };
    addMenu.querySelectorAll("button").forEach((b) => b.onclick = () => {
      closeAddMenu();
      if (b.dataset.add === "entry") openEntryModal(null);
      else if (b.dataset.add === "achievement") openAchModal(null);
      else if (b.dataset.add === "backlog") openBacklogModal(null);
      else if (b.dataset.add === "finance") openFinanceModal(null);
      else if (b.dataset.add === "recurring") openRecurringModal(null);
      else if (b.dataset.add === "finance-category") openFinanceCatModal(null);
      else openCategoryModal(null);
    });
    document.addEventListener("click", closeAddMenu);
    document.addEventListener("click", () => viewTabs.classList.remove("open"));

    $("#cancelEntryBtn").onclick = closeEntryModal;
    $("#entryForm").onsubmit = saveEntryFromForm;
    $("#deleteEntryBtn").onclick = deleteCurrentEntry;
    $("#fTitle").oninput = renderTitleSuggestions;
    $("#fCategory").onchange = () => updateSyncBtnVisibility("f", $("#fCategory").value);
    $("#fSyncBtn").onclick = syncEntryTitle;
    $("#fUnsyncBtn").onclick = unsyncEntry;
    $("#fSteamAppId").oninput = () => applySteamAppId("f");
    $("#fRating").querySelectorAll(".star").forEach((s) => {
      s.onclick = () => {
        const v = parseInt(s.dataset.star, 10);
        setRating(v === parseInt($("#fRating").dataset.value, 10) ? 0 : v);
      };
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".ac-wrap")) $("#fTitleSuggest").hidden = true;
    });

    $("#cancelAchBtn").onclick = closeAchModal;
    $("#achForm").onsubmit = saveAchFromForm;
    $("#deleteAchBtn").onclick = deleteCurrentAch;

    $("#cancelCatBtn").onclick = closeCategoryModal;
    $("#catForm").onsubmit = saveCategoryFromForm;
    $("#deleteCatBtn").onclick = deleteCurrentCategory;

    $("#cancelFinanceBtn").onclick = closeFinanceModal;
    $("#financeForm").onsubmit = saveFinanceFromForm;
    $("#deleteFinanceBtn").onclick = deleteCurrentFinanceEntry;
    $("#finYearly").onchange = applyFinanceYearlyUI;

    $("#cancelRecurringBtn").onclick = closeRecurringModal;
    $("#recurringForm").onsubmit = saveRecurringFromForm;
    $("#stopRecurringBtn").onclick = stopCurrentRecurring;

    $("#cancelFinanceCatBtn").onclick = closeFinanceCatModal;
    $("#financeCatForm").onsubmit = saveFinanceCatFromForm;
    $("#deleteFinanceCatBtn").onclick = deleteCurrentFinanceCategory;

    $("#cancelBacklogBtn").onclick = closeBacklogModal;
    $("#backlogForm").onsubmit = saveBacklogFromForm;
    $("#deleteBacklogBtn").onclick = deleteCurrentBacklogItem;
    $("#bTitle").oninput = onBacklogTitleInput;
    $("#bCategory").onchange = () => updateSyncBtnVisibility("b", $("#bCategory").value);
    $("#bSyncBtn").onclick = syncBacklogTitle;
    $("#bUnsyncBtn").onclick = unsyncBacklogItem;
    $("#bSteamAppId").oninput = () => applySteamAppId("b");
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#backlogModal .ac-wrap")) {
        const bs = $("#bTitleSuggest");
        if (bs) bs.hidden = true;
      }
    });

    $("#settingsBtn").onclick = openSettings;
    $("#closeSettingsBtn").onclick = closeSettings;
    document.querySelectorAll(".stab").forEach((t) => t.onclick = () => setSettingsTab(t.dataset.stab));
    $("#connectFileBtn").onclick = connectFile;
    $("#reconnectFileBtn").onclick = reconnectFile;
    $("#disconnectFileBtn").onclick = disconnectFile;
    $("#ghConnectBtn").onclick = connectGithub;
    $("#ghDisconnectBtn").onclick = disconnectGithub;
    $("#historyRefreshBtn").onclick = refreshHistoryList;
    $("#ghPollInterval").onchange = onPollIntervalChange;
    $("#ghCopyLinkBtn").onclick = async () => {
      const v = $("#ghSetupLink").value;
      try { await navigator.clipboard.writeText(v); toast("Setup link copied"); }
      catch (e) { $("#ghSetupLink").select(); try { document.execCommand("copy"); } catch (_) {} toast("Setup link copied"); }
    };
    $("#monthMin").onchange = onLayoutChange;
    $("#monthMax").onchange = onLayoutChange;
    $("#fontFamily").onchange = onFontChange;
    $("#currency").onchange = async () => {
      state.data.settings.currency = $("#currency").value;
      render();
      await persist();
    };
    $("#mediaEnabled").onchange = () => {
      state.visual.mediaEnabled = $("#mediaEnabled").checked;
      saveVisualSettings(state.visual);
      toggleMediaSections(state.visual.mediaEnabled);
    };
    const setMediaKey = async (field, value) => {
      if (!state.data.settings.mediaKeys) state.data.settings.mediaKeys = { ...DEFAULT_SETTINGS.mediaKeys };
      state.data.settings.mediaKeys[field] = value;
      await persist();
    };
    $("#rawgKey").oninput = () => setMediaKey("rawg", $("#rawgKey").value);
    $("#tmdbKey").oninput = () => setMediaKey("tmdb", $("#tmdbKey").value);
    $("#ggdealsKey").oninput = () => setMediaKey("ggdeals", $("#ggdealsKey").value);

    $("#privacyEnabled").onchange = () => {
      const checked = $("#privacyEnabled").checked;
      if (checked) {
        const method = state.privacy.method;
        const ready = method === "biometric" ? !!state.privacy.credentialId : !!state.privacy.pinHash;
        if (!ready) {
          toast("Set up a PIN or Fingerprint/Face ID first", true);
          $("#privacyEnabled").checked = false;
          return;
        }
      }
      state.privacy.enabled = checked;
      savePrivacySettings();
    };
    $("#privacyGrace").onchange = () => {
      state.privacy.graceMinutes = parseInt($("#privacyGrace").value, 10) || 0;
      savePrivacySettings();
    };
    $("#privacyMethod").onchange = () => {
      state.privacy.method = $("#privacyMethod").value;
      savePrivacySettings();
      refreshPrivacyMethodUI();
    };
    $("#setPinBtn").onclick = () => {
      $("#privacyPinForm").hidden = false;
      $("#setPinBtn").hidden = true;
      $("#savePinBtn").hidden = false;
      $("#cancelPinBtn").hidden = false;
      $("#newPin").focus();
    };
    $("#cancelPinBtn").onclick = hidePinForm;
    $("#savePinBtn").onclick = async () => {
      const a = $("#newPin").value, b = $("#confirmPin").value;
      if (!/^\d{4,8}$/.test(a)) { toast("PIN must be 4–8 digits", true); return; }
      if (a !== b) { toast("PINs don't match", true); return; }
      const salt = randomHex(16);
      state.privacy.pinSalt = salt;
      state.privacy.pinHash = await hashPin(a, salt);
      state.privacy.method = "pin";
      savePrivacySettings();
      hidePinForm();
      $("#privacyMethod").value = "pin";
      refreshPrivacyMethodUI();
      toast("PIN set");
    };
    $("#removePinBtn").onclick = () => {
      if (!confirm("Remove the PIN from this device?")) return;
      state.privacy.pinHash = null; state.privacy.pinSalt = null;
      if (state.privacy.method === "pin") state.privacy.enabled = false;
      savePrivacySettings();
      refreshPrivacyMethodUI();
    };
    $("#setBioBtn").onclick = async () => {
      try {
        state.privacy.credentialId = await registerBiometric();
        state.privacy.method = "biometric";
        savePrivacySettings();
        $("#privacyMethod").value = "biometric";
        refreshPrivacyMethodUI();
        toast("Fingerprint/Face ID set up");
      } catch (e) { toast("Couldn't set up: " + (e.message || e), true); }
    };
    $("#removeBioBtn").onclick = () => {
      if (!confirm("Remove Fingerprint/Face ID from this device?")) return;
      state.privacy.credentialId = null;
      if (state.privacy.method === "biometric") state.privacy.enabled = false;
      savePrivacySettings();
      refreshPrivacyMethodUI();
    };
    $("#exportJsonBtn").onclick = exportJson;
    $("#importJsonBtn").onclick = () => $("#importJsonInput").click();
    $("#importJsonInput").onchange = (e) => { if (e.target.files[0]) importJsonAll(e.target.files[0]); e.target.value = ""; };

    $("#exportJournalJsonBtn").onclick = exportJournalJson;
    $("#exportJournalCsvBtn").onclick = exportJournalCsv;
    $("#importJournalJsonBtn").onclick = () => $("#importJournalJsonInput").click();
    $("#importJournalJsonInput").onchange = (e) => { if (e.target.files[0]) importJournalJson(e.target.files[0]); e.target.value = ""; };
    $("#importJournalCsvBtn").onclick = () => $("#importJournalCsvInput").click();
    $("#importJournalCsvInput").onchange = (e) => { if (e.target.files[0]) importJournalCsv(e.target.files[0]); e.target.value = ""; };

    $("#exportFinanceJsonBtn").onclick = exportFinanceJson;
    $("#exportFinanceCsvBtn").onclick = exportFinanceCsv;
    $("#importFinanceJsonBtn").onclick = () => $("#importFinanceJsonInput").click();
    $("#importFinanceJsonInput").onchange = (e) => { if (e.target.files[0]) importFinanceJson(e.target.files[0]); e.target.value = ""; };
    $("#importFinanceCsvBtn").onclick = () => $("#importFinanceCsvInput").click();
    $("#importFinanceCsvInput").onchange = (e) => { if (e.target.files[0]) importFinanceCsv(e.target.files[0]); e.target.value = ""; };

    // close modals on overlay click / Escape (the conflict picker is modal —
    // it must be resolved via its buttons, not dismissed)
    document.querySelectorAll(".modal-overlay").forEach((ov) => {
      if (ov.id === "conflictModal") return;
      ov.addEventListener("click", (e) => { if (e.target === ov) ov.hidden = true; });
    });

    // Lock background scroll while any modal is visible. A single
    // MutationObserver watches every overlay's `hidden` attribute so this
    // covers every open/close path (button, backdrop, Escape) for all
    // modals without touching each open/close function individually.
    const syncModalOpenState = () => document.body.classList.toggle("modal-open", isAnyModalOpen());
    const modalObserver = new MutationObserver(syncModalOpenState);
    document.querySelectorAll(".modal-overlay").forEach((ov) => {
      modalObserver.observe(ov, { attributes: true, attributeFilter: ["hidden"] });
    });
    syncModalOpenState();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeEntryModal(); closeAchModal(); closeCategoryModal(); closeBacklogModal();
        closeFinanceModal(); closeFinanceCatModal(); closeSettings();
        $("#addMenu").hidden = true;
        viewTabs.classList.remove("open");
      }
    });

    // Retry a pending save and check for remote updates as soon as the
    // connection comes back, and again when the tab regains focus. Pause
    // the poll timer while the tab is hidden and restart it on return.
    function onReconnectOrFocus() { retrySync(); pollForUpdates(); }
    window.addEventListener("online", onReconnectOrFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") { onReconnectOrFocus(); schedulePoll(); }
      else if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    });
  }

  // Show the app-lock screen and resolve once the user unlocks it. Blocks
  // the rest of init() so no data is loaded/rendered until then.
  function showLockScreen() {
    return new Promise((resolve) => {
      const screen = $("#lockScreen");
      const form = $("#lockPinForm");
      const input = $("#lockPinInput");
      const bioBtn = $("#lockBioBtn");
      const errorEl = $("#lockError");
      const resetBtn = $("#lockResetBtn");
      const isPin = state.privacy.method !== "biometric";

      screen.hidden = false;
      document.body.style.overflow = "hidden";
      form.hidden = !isPin;
      bioBtn.hidden = isPin;
      errorEl.hidden = true;
      $("#lockHint").textContent = isPin
        ? "Enter your PIN to continue."
        : "Use your device's fingerprint or Face ID to continue.";
      if (isPin) setTimeout(() => input.focus(), 50);

      function showError(msg) {
        errorEl.textContent = msg;
        errorEl.hidden = false;
      }
      function cleanup() {
        screen.hidden = true;
        document.body.style.overflow = "";
        form.onsubmit = null;
        bioBtn.onclick = null;
        resetBtn.onclick = null;
      }
      function unlocked() {
        state.privacy.lastUnlockAt = Date.now();
        savePrivacySettings();
        cleanup();
        resolve();
      }
      form.onsubmit = async (e) => {
        e.preventDefault();
        const hash = await hashPin(input.value, state.privacy.pinSalt);
        input.value = "";
        if (hash === state.privacy.pinHash) unlocked();
        else { showError("Incorrect PIN"); input.focus(); }
      };
      bioBtn.onclick = async () => {
        errorEl.hidden = true;
        try { await verifyBiometric(state.privacy.credentialId); unlocked(); }
        catch (e) { showError("Couldn't verify — try again"); }
      };
      // Forgotten PIN / lost biometric: a reset that just removed the lock and
      // left the data sitting there would be a free bypass for anyone, so
      // resetting also wipes this device's local copy + connections. If
      // GitHub or a local file is connected, their actual contents are
      // untouched — reconnecting afterward in Settings restores everything.
      // If neither is connected, this device's data has no other copy and
      // the wipe is permanent.
      resetBtn.onclick = async () => {
        const recoverable = Storage.githubConnected || Storage.fileConnected;
        const msg = recoverable
          ? "Reset app lock on this device? This clears the PIN/fingerprint and wipes this device's local copy of your data, and disconnects GitHub/the local file — their actual contents are untouched. You'll start from an empty log here; reconnect in Settings → Sync/Backup afterward to get your data back."
          : "Reset app lock on this device? This device isn't connected to GitHub or a backup file, so this will permanently delete all your data with no way to recover it.";
        if (!confirm(msg)) return;
        const typed = prompt('Type "reset" to confirm — this cannot be undone from this device.');
        if ((typed || "").trim().toLowerCase() !== "reset") { toast("Reset cancelled"); return; }
        await Storage.forgetDevice();
        state.privacy = { ...DEFAULT_PRIVACY };
        savePrivacySettings();
        state.data = emptyData();
        cleanup();
        resolve();
        toast(recoverable ? "Local data cleared — reconnect in Settings to restore it" : "All data on this device permanently deleted");
      };
      if (!isPin) bioBtn.onclick();
    });
  }

  // Show the version-conflict picker and resolve once the user chooses one.
  function pickVersion(candidates) {
    return new Promise((resolve) => {
      const list = $("#conflictList");
      list.innerHTML = "";
      for (const c of candidates) {
        const item = el("div", "conflict-item");
        const info = el("div", "conflict-info");
        info.appendChild(el("strong", null, c.label));
        const count = (c.data.entries || []).length;
        const when = c.data.exportedAt ? new Date(c.data.exportedAt).toLocaleString() : "unknown time";
        info.appendChild(el("span", "muted", "Saved " + when + " · " + count + " entries"));
        item.appendChild(info);
        const btn = el("button", "btn btn-primary", "Use this");
        btn.type = "button";
        btn.onclick = () => { $("#conflictModal").hidden = true; resolve(c); };
        item.appendChild(btn);
        list.appendChild(item);
      }
      $("#conflictModal").hidden = false;
    });
  }

  // ---------- init ----------
  function withinUnlockGrace() {
    if (!state.privacy.graceMinutes || !state.privacy.lastUnlockAt) return false;
    return Date.now() - state.privacy.lastUnlockAt < state.privacy.graceMinutes * 60 * 1000;
  }

  async function init() {
    wire();
    if (state.privacy.enabled && !withinUnlockGrace()) await showLockScreen();
    setSyncing("Loading…");

    // One-link device setup: open the app with #t=… (or legacy #setup=…) and it auto-connects.
    let setupMsg = null, setupErr = false;
    if (Storage.hashHasSetup(location.hash)) {
      const savedHash = location.hash;
      history.replaceState(null, "", location.pathname + location.search); // drop the token from the URL
      try { await Storage.connectFromHash(savedHash, null); setupMsg = "Connected to your GitHub sync"; }
      catch (e) { setupMsg = "Setup link failed: " + (e.message || e); setupErr = true; }
    }

    let savedUi = null;
    try { savedUi = JSON.parse(localStorage.getItem(UI_KEY)); } catch (e) {}
    if (savedUi?.view) state.view = savedUi.view;

    const result = await Storage.load();
    let source, githubReached;
    if (result.conflict) {
      const chosen = await pickVersion(result.conflict);
      const resolved = await Storage.resolveConflict(chosen);
      state.data = normalize(resolved.data);
      source = resolved.source;
      githubReached = result.conflict.some((c) => c.source === "github");
    } else {
      state.data = result.data ? normalize(result.data) : emptyData();
      source = result.source;
      githubReached = source === "github";
    }
    afterDataChange();
    if (savedUi?.scrollY) setTimeout(() => window.scrollTo(0, savedUi.scrollY), 0);

    refreshStorageStatus();

    if (setupMsg) toast(setupMsg, setupErr);
    else if (source === "seed") toast("Loaded " + state.data.entries.length + " entries from your sheet");
    else if (Storage.githubConnected && !githubReached) {
      toast("Offline — showing last saved copy; will sync when GitHub is reachable", true);
    }

    if (state.pendingSync) retrySync();
    schedulePoll();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  init();
})();
