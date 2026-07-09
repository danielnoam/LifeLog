// LifeLog — main app logic (vanilla JS, no build step).
(function () {
  const Storage = window.LifeLogStorage;
  const MONTHS = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const DEFAULT_SETTINGS = { monthOrder: "asc", currency: "ILS", mediaCategorySources: {}, mediaCategoryFallbackSources: {}, mediaKeys: { rawg: "", tmdb: "", ggdeals: "" }, steam: { proxyUrl: "", steamId: "", wishlistCategory: "", autoSyncDays: "0" } }; // monthOrder, currency, mediaCategorySources, mediaCategoryFallbackSources, mediaKeys, steam — synced
  const CURRENCY_SYMBOLS = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };
  const DEFAULT_VISUAL = { monthMinWidth: 180, monthMaxWidth: 0, fontFamily: "system", pollInterval: 30, forceLayout: "none", theme: "default", timelineCoverSize: "small", backlogCoverSize: "big" }; // maxWidth 0 = stretch — local to this device, not synced
  const THEMES = ["light", "nord", "dracula"]; // "default" has no class — it's the bare :root palette
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
  // Local-only (per-device) — when this device last ran the quiet background
  // wishlist check, so the cadence in Settings isn't re-evaluated on every
  // app open. Deliberately not synced: each device paces its own checks.
  const STEAM_SYNC_KEY = "lifelog-steam-autosync-v1";
  const DEFAULT_MEDIA = {}; // legacy local-only shape; rawgKey/tmdbKey migrated into synced settings on load (see normalize())
  const MEDIA_SOURCE_LABELS = {
    rawg: "RAWG", "tmdb-movie": "TMDB", "tmdb-tv": "TMDB",
    "anilist-anime": "AniList", "anilist-manga": "AniList",
    "jikan-anime": "Jikan", "jikan-manga": "Jikan",
    openlibrary: "Open Library", googlebooks: "Google Books", musicbrainz: "MusicBrainz",
    steam: "Steam",
  };
  // How long a fetched GG.deals price stays valid before a backlog re-render
  // re-fetches it; avoids re-querying the rate-limited API on every render.
  const PRICE_CACHE_MS = 15 * 60 * 1000;
  const PRIVACY_KEY = "lifelog-privacy-v1";
  // App lock: gates opening the app on this device. Local-only, never synced
  // (a PIN/credential set up on one device wouldn't make sense on another).
  // A PIN is always the base requirement; pinHash/pinSalt: SHA-256 of
  // salt+PIN, so the PIN itself is never stored. credentialId (base64
  // WebAuthn credential id) is an optional addition on top of the PIN, never
  // a replacement for it, so the PIN is always available as a fallback.
  // graceMinutes/lastUnlockAt: if set, a refresh within graceMinutes of the
  // last successful unlock skips the prompt instead of asking again.
  const DEFAULT_PRIVACY = { enabled: false, pinHash: null, pinSalt: null, credentialId: null, graceMinutes: 0, lastUnlockAt: 0 };
  const APP_VERSION = "0.62.1"; // bump with each shipped change so it's visible in Settings

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
    financeStatsYear: null,
    bulk: { active: false, selected: new Set() },
  };
  let catColor = {}; // name -> color
  let financeCatColor = {}; // name -> color

  // Applied immediately (before any data load/await) so the right theme,
  // font, layout and force-layout are in place before first paint — these
  // are device-local settings already known synchronously from
  // localStorage, so there's no reason to wait on afterDataChange() and
  // show a flash of the default look first.
  applyMonthLayout();
  applyFont();
  applyTheme();
  applyForceLayout();

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

  // ---------- motion: count-up numbers + view fade-in ----------
  // Mirrors the design system's AnimatedNumber/FadeIn: short, eased-out,
  // no bounce, and skipped entirely under prefers-reduced-motion.
  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const numberAnimCache = new Map();
  // Tweens `node`'s text from the previously-seen value under `key` to `value`
  // (550ms, ease-out-cubic). Non-numeric values (e.g. "Jan") just render as-is.
  function animatedNumberText(node, key, value, formatFn) {
    const prev = numberAnimCache.get(key);
    numberAnimCache.set(key, value);
    if (typeof value !== "number" || prev == null || prev === value || prefersReducedMotion()) {
      node.textContent = formatFn(value);
      return;
    }
    const duration = 550, start = performance.now(), from = prev, to = value;
    node.textContent = formatFn(from); // paint the starting frame immediately, don't wait on the first rAF
    const step = (ts) => {
      const p = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = formatFn(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  let lastRenderedView = null;
  // Replays the view-fade-in animation on `root` only when the active view
  // actually changed (not on every in-view re-render, e.g. after an edit).
  function fadeInOnViewChange(root) {
    if (state.view === lastRenderedView) return;
    lastRenderedView = state.view;
    if (prefersReducedMotion()) return;
    root.classList.remove("view-fade-in");
    void root.offsetWidth; // force reflow so the animation restarts
    root.classList.add("view-fade-in");
    // The animation's fill-mode holds its final `transform` computed value on
    // `root` indefinitely once it ends, which makes `root` a containing block
    // for any `position: fixed` descendant (e.g. the bulk-edit bar) — pinning
    // it to root's box instead of the viewport. Drop the class once the
    // animation finishes so that stops.
    root.addEventListener("animationend", () => root.classList.remove("view-fade-in"), { once: true });
  }

  function rebuildColorMap() {
    catColor = {};
    for (const c of state.data.categories) catColor[c.name] = c.color;
  }
  const colorOf = (name) => catColor[name] || "#7a8a99";

  // Placeholder for entries/backlog items with no cover art (or a broken
  // cover URL) — tinted to the item's category so it's not just a blank box.
  function emptyCoverEl(cls, category) {
    const span = el("span", cls, "🖼");
    const color = colorOf(category);
    span.style.background = color + "22";
    span.style.color = color;
    return span;
  }

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
  // yearly ad-hoc entries (imported big purchases) carry just a year, no
  // month — they get bucketed into a pseudo-month (0) rendered as "Yearly"
  function financeMonthOf(f) { return f.yearly ? 0 : +String(f.date).slice(5, 7); }

  // ---------- recurring expenses ----------
  // Recurring expenses are stored as a single template (start date, interval,
  // amount/category/note) rather than as individual finance entries. Their
  // occurrences are computed on the fly, from the start date up through
  // today, every time finance data is read — nothing is written to
  // state.data.financeEntries for them. This keeps the template the single
  // source of truth: editing it changes every past and future occurrence,
  // and there's no per-occurrence row to clean up if it's stopped or edited.
  // rec.overrides (optional) keys a sparse { amount?, note? } patch by
  // occurrence date, for the rare month that genuinely differed (a price
  // change, a one-off note) without dragging every other occurrence along.
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
      const dateStr = d.toISOString().slice(0, 10);
      const ov = (rec.overrides || {})[dateStr];
      out.push({
        id: `${rec.id}:${n}`, date: dateStr, type: "expense",
        amount: ov && ov.amount != null ? ov.amount : rec.amount,
        category: rec.category,
        note: ov && ov.note != null ? ov.note : rec.note,
        createdAt: rec.createdAt,
        recurringId: rec.id, virtual: true, overridden: !!ov,
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

  // Snapshot of state.data as of the last successful save, used only to
  // detect (via LifeLogMerge.stampChangedItems) which items changed since
  // then — so every real edit gets an accurate updatedAt without threading
  // a manual "touch" call through every mutation site in the app. Seeded
  // once data first loads (see init()) and refreshed after every persist().
  let lastPersistedSnapshot = null;

  async function persist() {
    if (window.LifeLogMerge) window.LifeLogMerge.stampChangedItems(lastPersistedSnapshot, state.data);
    state.data.exportedAt = new Date().toISOString();
    setSyncing("Saving…");
    syncInFlight = true;
    try {
      const where = await Storage.save(state.data);
      refreshStorageStatus(where);
      lastPersistedSnapshot = structuredClone(state.data);
    } finally {
      syncInFlight = false;
    }
  }

  // ---------- rendering ----------
  function render() {
    // Clearing #content below momentarily collapses the page to whatever
    // height the topbar/nav alone take up, and browsers clamp window.scrollY
    // down to fit — permanently, even once the full content is rebuilt right
    // after. Restore it afterward for an in-view re-render (add/edit/filter),
    // where the user expects to stay put; skip it on a real view switch,
    // where landing at the top is the expected behavior.
    const sameView = state.view === lastRenderedView;
    const prevScrollY = window.scrollY;
    try {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.view === state.view);
      });
      const c = $("#content");
      c.innerHTML = "";
      fadeInOnViewChange(c);
      if (state.view === "backlog") { renderBacklog(c); return; }
      if (state.view === "finance") { renderFinanceEntries(c); return; }
      if (state.view === "finance-stats") { renderFinanceStats(c); return; }
      const entries = getFiltered();
      if (!state.data.entries.length) {
        c.appendChild(emptyState({
          glyph: "☰",
          title: "Nothing logged yet",
          body: "Log the things you experience — a game you finished, a book you read, a trip you took. They'll stack up here by year and month.",
          action: "Add your first entry",
          onAction: () => openEntryModal(null),
          hint: "Tip: you can also import an existing lifelog.json from Settings → Import / Export.",
        }));
        return;
      }
      if (!entries.length) {
        c.appendChild(emptyState("No entries match your filters."));
        return;
      }
      if (state.view === "timeline") renderTimeline(c, entries);
      else renderStats(c, entries);
    } finally {
      if (sameView && prevScrollY) window.scrollTo(0, prevScrollY);
    }
  }

  // Plain string → the old faint one-liner (used for "nothing matches your
  // filters", where there's no useful add action). An object → the richer
  // first-run empty state: icon badge, title, body, primary CTA, hint line.
  function emptyState(msg) {
    if (typeof msg === "string") return el("div", "empty", msg);
    const { glyph, title, body, action, onAction, hint } = msg;
    const wrap = el("div", "empty-state");
    wrap.appendChild(el("div", "empty-glyph", glyph));
    wrap.appendChild(el("h2", null, title));
    wrap.appendChild(el("p", "empty-body", body));
    const btn = el("button", "btn btn-primary", "+ " + action);
    btn.type = "button";
    btn.onclick = onAction;
    wrap.appendChild(btn);
    if (hint) wrap.appendChild(el("p", "empty-hint", hint));
    return wrap;
  }

  // Shared month-card header for Timeline and Finance: a label + count on
  // the left/right, plus an optional bulk "select all in this month"
  // checkbox (replacing the optional quick-add "+" while bulk mode is on,
  // since both live in the same corner).
  function monthCardHeader(label, count, selectableItems, opts) {
    const h = el("h3");
    const left = el("span", "mc-left");
    if (state.bulk.active && selectableItems.length) {
      const allSelected = selectableItems.every((b) => state.bulk.selected.has(b.id));
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.className = "bulk-check";
      cb.checked = allSelected;
      cb.title = "Select all in " + label;
      cb.onclick = (ev) => { ev.stopPropagation(); toggleBulkCategoryAll(selectableItems); };
      left.appendChild(cb);
    }
    left.appendChild(el("span", null, label));
    h.appendChild(left);
    const right = el("span", "mc-right");
    right.appendChild(el("span", "mc", String(count)));
    if (opts && opts.onAdd && !state.bulk.active) {
      const addBtn = el("button", "month-add-btn", "+");
      addBtn.type = "button";
      addBtn.title = "Add to " + label;
      addBtn.onclick = (ev) => { ev.stopPropagation(); opts.onAdd(); };
      right.appendChild(addBtn);
    }
    h.appendChild(right);
    return h;
  }

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

      const grid = el("div", "month-grid");
      const byMonth = groupBy(byYear[y], (e) => e.month);
      const monthSort = state.data.settings.monthOrder === "desc" ? (a, b) => b - a : (a, b) => a - b;
      for (const m of Object.keys(byMonth).sort(monthSort)) {
        const card = el("div", "month-card");
        const yy = +y, mm = +m;
        card.appendChild(monthCardHeader(MONTHS[m], byMonth[m].length, byMonth[m], {
          onAdd: () => openEntryModal(null, null, { year: yy, month: mm }),
        }));
        byMonth[m].forEach((e) => card.appendChild(entryRow(e)));
        grid.appendChild(card);
      }
      block.appendChild(grid);
      root.appendChild(block); // attach now, fully built, so its real layout can be measured
      // getBoundingClientRect (not offsetHeight) keeps the sub-pixel remainder,
      // which otherwise rounds away and leaves a hairline gap under the sticky header.
      block.style.setProperty("--year-head-h", head.getBoundingClientRect().height + "px");
    }
    if (state.bulk.active) {
      root.appendChild(bulkActionBar({
        categories: state.data.categories,
        onMove: bulkMoveEntriesSelected,
        onDelete: bulkDeleteEntriesSelected,
        onSync: bulkSyncEntriesSelected,
      }));
    }
  }

  function entryRow(e) {
    const row = el("div", "entry");
    if (state.bulk.active) row.appendChild(bulkCheckbox(e));
    if (state.visual.timelineCoverSize !== "none") {
      const sizeClass = state.visual.timelineCoverSize === "big" ? "cover-lg" : "cover-sm";
      if (e.coverUrl) {
        const img = document.createElement("img");
        img.src = e.coverUrl; img.alt = "";
        img.className = "etn-cover " + sizeClass;
        // On a broken URL, swap in the same empty placeholder used for entries
        // with no cover at all, instead of collapsing the space it held.
        img.onerror = () => { img.replaceWith(emptyCoverEl("etn-cover cover-empty " + sizeClass, e.category)); };
        row.appendChild(img);
      } else {
        row.appendChild(emptyCoverEl("etn-cover cover-empty " + sizeClass, e.category));
      }
    }
    const color = colorOf(e.category);
    const chip = el("span", "entry-cat");
    chip.style.background = color + "22";
    chip.style.color = color;
    const dot = el("span", "dot");
    dot.style.background = color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(e.category));
    row.appendChild(chip);
    const t = el("span", "etitle", e.title);
    t.title = e.title;
    row.appendChild(t);
    if (e.rating) row.appendChild(ratingBadge(e.rating));
    row.onclick = () => state.bulk.active ? toggleBulkItem(e.id) : openEntryModal(e);
    attachLongPressSelect(row, e);
    return row;
  }

  function ratingBadge(rating) {
    const span = el("span", "erating", "★".repeat(rating));
    span.title = rating + "/5";
    return span;
  }

  function priorityBadge() {
    const span = el("span", "bpriority", "★");
    span.title = "Prioritized";
    return span;
  }

  // Title last attached to synced media metadata, so a manual edit (vs. a
  // sync pick) is detected and clears the now-stale cover/metadata.
  let lastSyncedBacklogTitle = "";

  function renderBacklogTitleSuggestions() {
    const query = $("#bTitle").value;
    const isAdding = !$("#backlogId").value;
    // A manually-entered Steam App ID isn't derived from the title, so editing
    // the title shouldn't clear it the way it clears a search-based sync. And
    // only while adding: renaming an already-synced existing item shouldn't
    // silently drop its media link — that takes an explicit "✕ Unsync" now.
    if (isAdding && query !== lastSyncedBacklogTitle && $("#bMediaSource").value !== "steam") {
      ["#bCoverUrl", "#bMediaId", "#bMediaSource", "#bSummary", "#bReleaseYear", "#bExternalRating"]
        .forEach((id) => { const f = $(id); if (f) f.value = ""; });
      setBacklogCover();
    }

    const list = $("#bTitleSuggest");
    const selfId = $("#backlogId").value || null;
    const backlogMatches = backlogSuggestions(query, selfId);
    const journalMatches = titleSuggestions(query, null);
    list.innerHTML = "";

    backlogMatches.forEach((b) => {
      const item = makeMediaAcItem(
        { title: b.title, coverUrl: b.coverUrl || "", year: null, externalRating: null },
        () => {
          lastSyncedBacklogTitle = b.title;
          $("#bTitle").value = b.title;
          if (state.data.categories.some((c) => c.name === b.category)) $("#bCategory").value = b.category;
          $("#bCoverUrl").value = b.coverUrl || "";
          $("#bMediaId").value = b.mediaId || "";
          $("#bMediaSource").value = b.mediaSource || "";
          setBacklogCover();
          updateSyncBtnVisibility("b", $("#bCategory").value);
          list.hidden = true;
          updateBacklogDuplicateBanner();
        }
      );
      const info = item.querySelector(".ac-info");
      const existing = info.querySelector(".ac-meta");
      if (existing) existing.remove();
      info.appendChild(el("span", "ac-meta", `📋 Already in backlog · ${b.category}`));
      list.appendChild(item);
    });

    if (backlogMatches.length && journalMatches.length) list.appendChild(el("div", "ac-divider"));

    journalMatches.forEach((m) => {
      const item = makeMediaAcItem(
        { title: m.title, coverUrl: m.coverUrl, year: null, externalRating: null },
        () => {
          lastSyncedBacklogTitle = m.title;
          $("#bTitle").value = m.title;
          if (state.data.categories.some((c) => c.name === m.category)) $("#bCategory").value = m.category;
          $("#bCoverUrl").value = m.coverUrl || "";
          $("#bMediaId").value = m.mediaId || "";
          $("#bMediaSource").value = m.mediaSource || "";
          setBacklogCover();
          updateSyncBtnVisibility("b", $("#bCategory").value);
          list.hidden = true;
          updateBacklogDuplicateBanner();
        }
      );
      const info = item.querySelector(".ac-info");
      const existing = info.querySelector(".ac-meta");
      if (existing) existing.remove();
      info.appendChild(el("span", "ac-meta", `✓ Logged ×${m.count} · last ${MONTHS_SHORT[m.month]} ${m.year}`));
      list.appendChild(item);
    });

    list.hidden = !backlogMatches.length && !journalMatches.length;

    updateBacklogDuplicateBanner();
  }

  // Purely informational: shows whether the typed title already exists in
  // the backlog (excluding the item being edited) and/or is already logged,
  // so duplicates and "you've already done this" can be caught before save.
  function updateBacklogDuplicateBanner() {
    const title = $("#bTitle").value.trim().toLowerCase();
    const selfId = $("#backlogId").value;
    const status = $("#bDuplicateStatus");
    if (!title) { status.hidden = true; return; }
    const inBacklog = state.data.backlog.some((b) => b.id !== selfId && b.title.trim().toLowerCase() === title);
    const inJournal = state.data.entries.some((e) => e.title.trim().toLowerCase() === title);
    if (!inBacklog && !inJournal) { status.hidden = true; return; }
    const parts = [];
    if (inBacklog) parts.push("already in your backlog");
    if (inJournal) parts.push("already logged in your timeline");
    $("#bDuplicateStatusText").textContent = "📋 This title is " + parts.join(" and ") + ".";
    status.hidden = false;
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
      $("#bLength").value = "";
      setBacklogCover();
    } else {
      setEntryCover(coverUrl, id, id ? "steam" : "", "");
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
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    results.forEach((r) => {
      list.appendChild(makeMediaAcItem(r, async () => {
        lastSyncedBacklogTitle = $("#bTitle").value;
        $("#bCoverUrl").value = r.coverUrl || "";
        $("#bMediaId").value = r.id || "";
        $("#bMediaSource").value = r.source || "";
        $("#bSummary").value = r.summary || "";
        $("#bReleaseYear").value = r.year ? String(r.year) : "";
        $("#bExternalRating").value = r.externalRating || "";
        $("#bLength").value = (await window.LifeLogMedia.fetchLength(r.id, r.source, keys.tmdb)) || r.length || "";
        setBacklogCover();
        list.hidden = true;
      }));
    });
    list.hidden = false;
  }

  function unsyncBacklogItem() {
    ["#bCoverUrl", "#bMediaId", "#bMediaSource", "#bSummary", "#bReleaseYear", "#bExternalRating", "#bLength"]
      .forEach((id) => { const f = $(id); if (f) f.value = ""; });
    $("#bSteamAppId").value = "";
    setBacklogCover();
    $("#bTitleSuggest").hidden = true;
  }

  function renderBacklog(root) {
    if (!state.data.backlog.length) {
      root.appendChild(emptyState({
        glyph: "★",
        title: "Your backlog is empty",
        body: "Add things you want to get to. They sit here grouped by category and sorted by priority, until the day you log them.",
        action: "Add to backlog",
        onAction: () => openBacklogModal(null),
        hint: "Higher-priority items rise to the top of their category.",
      }));
      return;
    }
    const items = getFilteredBacklog()
      .slice().sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    if (!items.length) {
      root.appendChild(emptyState("No backlog items match your filters."));
      return;
    }
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
      if (!state.bulk.active) {
        const addBtn = el("button", "month-add-btn", "+");
        addBtn.type = "button";
        addBtn.title = "Add to " + catName;
        addBtn.onclick = (ev) => { ev.stopPropagation(); openBacklogModal(null, catName); };
        head.appendChild(addBtn);
      }
      section.appendChild(head);
      const list = el("div", "backlog-list");
      const sorted = catItems.slice().sort((a, b) => {
        if (!!a.dropped !== !!b.dropped) return a.dropped ? 1 : -1;
        return (b.priority || 0) - (a.priority || 0);
      });
      let sawActive = false, sepAdded = false, sawPriority = false, prioritySepAdded = false;
      sorted.forEach((b) => {
        if (b.dropped) {
          if (sawActive && !sepAdded) { list.appendChild(el("div", "backlog-dropped-sep")); sepAdded = true; }
        } else {
          if (b.priority) sawPriority = true;
          else if (sawPriority && !prioritySepAdded) { list.appendChild(el("div", "backlog-priority-sep")); prioritySepAdded = true; }
          sawActive = true;
        }
        list.appendChild(backlogRow(b));
      });
      section.appendChild(list);
      grid.appendChild(section);
    }
    root.appendChild(grid);
    if (state.bulk.active) {
      root.appendChild(bulkActionBar({
        categories: state.data.categories,
        onMove: bulkMoveSelected,
        onDelete: bulkDeleteSelected,
        onSync: bulkSyncSelected,
      }));
    }
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
    const proxyUrl = (state.data.settings.steam?.proxyUrl || "").trim().replace(/\/+$/, "");
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
      const result = await window.LifeLogMedia.fetchPrices(chunk, apiKey, proxyUrl);
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
      document.querySelectorAll(`.bulk-check[data-bulk-id="${id}"]`).forEach((cb) => { cb.checked = value; });
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

  function bulkActionBar(opts) {
    const { categories, onMove, onDelete, onSync } = opts;
    const empty = state.bulk.selected.size === 0;
    const bar = el("div", "bulk-bar");
    bar.appendChild(el("span", "bulk-count", `${state.bulk.selected.size} selected`));
    bar.appendChild(el("span", "bulk-progress"));
    const moveSel = document.createElement("select");
    moveSel.className = "bulk-move-select";
    moveSel.disabled = empty;
    fillSelect(moveSel, [
      { value: "", label: "Move to category…" },
      ...categories.map((c) => ({ value: c.name, label: c.name })),
    ], "");
    moveSel.onchange = async () => {
      if (!moveSel.value) return;
      await onMove(moveSel.value);
    };
    bar.appendChild(moveSel);
    if (onSync) {
      const syncBtn = el("button", "btn btn-sm", "🔄 Sync");
      syncBtn.type = "button";
      syncBtn.disabled = empty;
      syncBtn.onclick = () => onSync(syncBtn);
      bar.appendChild(syncBtn);
    }
    const delBtn = el("button", "btn btn-sm btn-danger", "Delete");
    delBtn.type = "button";
    delBtn.disabled = empty;
    delBtn.onclick = onDelete;
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
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    const progress = $(".bulk-progress");
    btn.disabled = true;
    let synced = 0, skipped = 0, lastErr = "";
    for (const id of ids) {
      const item = state.data.backlog.find((b) => b.id === id);
      // Steam has no search (CORS-blocked) — its App ID can only be entered
      // manually per item, so it's skipped here rather than attempted.
      const source = item && (state.data.settings.mediaCategorySources || {})[item.category];
      if (!item || !source || source === "steam") {
        skipped++;
      } else {
        const results = await fetchMediaSuggestions(item.title, item.category);
        if (!results.length) {
          skipped++;
          lastErr = (window.LifeLogMedia && window.LifeLogMedia.getLastError()) || lastErr;
        } else {
          const r = results[0];
          item.coverUrl = r.coverUrl || "";
          item.mediaId = r.id || "";
          item.mediaSource = r.source || "";
          item.summary = r.summary || "";
          if (r.year) item.releaseYear = r.year; else delete item.releaseYear;
          item.externalRating = r.externalRating || "";
          // TMDB needs a second per-title call for runtime/season data — the
          // search endpoint doesn't include it (see fetchLength in media.js).
          item.length = (await window.LifeLogMedia.fetchLength(r.id, r.source, keys.tmdb)) || r.length || "";
          synced++;
        }
      }
      if (progress) progress.textContent = `${synced + skipped}/${ids.length} synced`;
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

  async function bulkMoveEntriesSelected(categoryName) {
    const ids = state.bulk.selected;
    state.data.entries.forEach((e) => { if (ids.has(e.id)) e.category = categoryName; });
    const n = ids.size;
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Moved ${n} entr${n === 1 ? "y" : "ies"} to “${categoryName}”`);
  }

  async function bulkDeleteEntriesSelected() {
    const ids = state.bulk.selected;
    const n = ids.size;
    if (!confirm(`Delete ${n} entr${n === 1 ? "y" : "ies"} from your timeline?`)) return;
    state.data.entries = state.data.entries.filter((e) => !ids.has(e.id));
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Deleted ${n} entr${n === 1 ? "y" : "ies"}`);
  }

  // Syncs each selected timeline entry to media metadata, auto-picking the top
  // search result (no per-item review, since reviewing N items individually
  // would defeat the point of a bulk action) — same approach as the Backlog's
  // bulk sync.
  async function bulkSyncEntriesSelected(btn) {
    const ids = [...state.bulk.selected];
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    const progress = $(".bulk-progress");
    btn.disabled = true;
    let synced = 0, skipped = 0, lastErr = "";
    for (const id of ids) {
      const item = state.data.entries.find((e) => e.id === id);
      // Steam has no search (CORS-blocked) — its App ID can only be entered
      // manually per item, so it's skipped here rather than attempted.
      const source = item && (state.data.settings.mediaCategorySources || {})[item.category];
      if (!item || !source || source === "steam") {
        skipped++;
      } else {
        const results = await fetchMediaSuggestions(item.title, item.category);
        if (!results.length) {
          skipped++;
          lastErr = (window.LifeLogMedia && window.LifeLogMedia.getLastError()) || lastErr;
        } else {
          const r = results[0];
          item.coverUrl = r.coverUrl || "";
          item.mediaId = r.id || "";
          item.mediaSource = r.source || "";
          // TMDB needs a second per-title call for runtime/season data — the
          // search endpoint doesn't include it (see fetchLength in media.js).
          item.length = (await window.LifeLogMedia.fetchLength(r.id, r.source, keys.tmdb)) || r.length || "";
          synced++;
        }
      }
      if (progress) progress.textContent = `${synced + skipped}/${ids.length} synced`;
    }
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    const base = skipped ? `Synced ${synced} entr${synced === 1 ? "y" : "ies"}, skipped ${skipped}` : `Synced ${synced} entr${synced === 1 ? "y" : "ies"}`;
    toast(lastErr ? base + " — " + lastErr : base, !!(skipped && lastErr));
  }

  async function bulkMoveFinanceSelected(categoryName) {
    const ids = state.bulk.selected;
    state.data.financeEntries.forEach((f) => { if (ids.has(f.id)) f.category = categoryName; });
    const n = ids.size;
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Moved ${n} entr${n === 1 ? "y" : "ies"} to “${categoryName}”`);
  }

  async function bulkDeleteFinanceSelected() {
    const ids = state.bulk.selected;
    const n = ids.size;
    if (!confirm(`Delete ${n} entr${n === 1 ? "y" : "ies"} from your finance log?`)) return;
    state.data.financeEntries = state.data.financeEntries.filter((f) => !ids.has(f.id));
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Deleted ${n} entr${n === 1 ? "y" : "ies"}`);
  }

  function backlogRow(b) {
    if (state.visual.backlogCoverSize !== "none") return backlogRowRich(b);
    const row = el("div", "entry");
    if (b.dropped) row.classList.add("is-dropped");
    if (state.bulk.active) row.appendChild(bulkCheckbox(b));
    const t = el("span", "etitle", b.title); t.title = b.title;
    row.appendChild(t);
    if (b.priority) row.appendChild(priorityBadge());
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
    if (b.dropped) row.classList.add("is-dropped");
    if (state.bulk.active) row.appendChild(bulkCheckbox(b));
    const sizeClass = state.visual.backlogCoverSize === "small" ? "cover-sm" : "cover-lg";
    if (b.coverUrl) {
      const img = document.createElement("img");
      img.src = b.coverUrl; img.alt = b.title;
      img.className = "bl-cover " + sizeClass;
      // On a broken URL, swap in the same empty placeholder used for items
      // with no cover at all, instead of collapsing the space it held.
      img.onerror = () => { img.replaceWith(emptyCoverEl("bl-cover cover-empty " + sizeClass, b.category)); };
      row.appendChild(img);
    } else {
      row.appendChild(emptyCoverEl("bl-cover cover-empty " + sizeClass, b.category));
    }
    const body = el("div", "bl-body");
    const titleRow = el("div", "bl-title-row");
    titleRow.appendChild(el("span", "bl-title", b.title));
    if (b.priority) titleRow.appendChild(priorityBadge());
    body.appendChild(titleRow);
    const meta = [];
    if (b.externalRating) meta.push("★ " + b.externalRating);
    if (b.releaseYear) meta.push(String(b.releaseYear));
    if (b.length) meta.push(b.length);
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

  // Long-pressing a row is the only way into bulk mode (there's no separate
  // toggle button) — works for touch and mouse alike. Cancelled by movement
  // past a small threshold so it doesn't fire mid-scroll/mid-drag.
  function attachLongPressSelect(row, b) {
    let timer = null, start = null;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } start = null; };
    row.addEventListener("pointerdown", (ev) => {
      if (state.bulk.active) return;
      // A long-press on the title text itself is left alone so it can still be
      // used to select/copy the text — only the rest of the row enters bulk mode.
      if (ev.target.closest(".etitle, .bl-title")) return;
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
    cb.dataset.bulkId = b.id;
    // Selection is driven by pointerdown below — the click that follows it must
    // not bubble to the row's onclick, or it re-toggles the value right back.
    cb.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
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
      root.appendChild(emptyState({
        glyph: CURRENCY_SYMBOLS[state.data.settings.currency] || CURRENCY_SYMBOLS.ILS,
        title: "No finance entries yet",
        body: "Track an expense and LifeLog starts building your monthly summary, category breakdown and spend trend.",
        action: "Add finance entry",
        onAction: () => openFinanceModal(null),
        hint: "Recurring expenses can generate their entries automatically.",
      }));
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

      const grid = el("div", "month-grid");
      grid.style.setProperty("--month-min", "260px"); // finance rows need more room (date + amount columns)
      const byMonth = groupBy(byYear[y], financeMonthOf);
      const monthSort = (a, b) => {
        a = +a; b = +b;
        if (a === 0) return 1; // yearly ad-hoc bucket always last
        if (b === 0) return -1;
        return state.data.settings.monthOrder === "desc" ? b - a : a - b;
      };
      for (const m of Object.keys(byMonth).sort(monthSort)) {
        const card = el("div", "month-card");
        const yy = +y, mm = +m;
        const monthItems = byMonth[m];
        const label = mm === 0 ? "Yearly" : MONTHS[m];
        card.appendChild(monthCardHeader(label, monthItems.length, monthItems.filter((f) => !f.virtual), {
          onAdd: () => openFinanceModal(null, { year: yy, month: mm }),
        }));
        monthItems.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach((f) => card.appendChild(financeRow(f)));
        const total = monthItems.reduce((s, f) => s + f.amount, 0);
        const totalRow = el("div", "month-total");
        totalRow.appendChild(el("span", null, "Total"));
        const totalAmt = el("span", "famount fnegative");
        animatedNumberText(totalAmt, "fin-month-total:" + yy + "-" + mm, total, formatMoney);
        totalRow.appendChild(totalAmt);
        card.appendChild(totalRow);
        grid.appendChild(card);
      }
      block.appendChild(grid);
      root.appendChild(block); // attach now, fully built, so its real layout can be measured
      // getBoundingClientRect (not offsetHeight) keeps the sub-pixel remainder,
      // which otherwise rounds away and leaves a hairline gap under the sticky header.
      block.style.setProperty("--year-head-h", head.getBoundingClientRect().height + "px");
    }
    if (state.bulk.active) {
      root.appendChild(bulkActionBar({
        categories: state.data.financeCategories,
        onMove: bulkMoveFinanceSelected,
        onDelete: bulkDeleteFinanceSelected,
      }));
    }
  }

  function financeRow(f) {
    const row = el("div", "entry finance-entry" + (f.yearly ? " yearly-expense" : ""));
    if (state.bulk.active && !f.virtual) row.appendChild(bulkCheckbox(f));
    const color = financeColorOf(f.category);
    const chip = el("span", "entry-cat");
    chip.style.background = color + "22";
    chip.style.color = color;
    const dot = el("span", "dot");
    dot.style.background = color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(f.category));
    row.appendChild(chip);
    const t = el("span", "etitle", f.note || f.category);
    t.title = f.note || f.category;
    row.appendChild(t);
    if (f.virtual) {
      const badge = el("span", "recur-badge", f.overridden ? "↻*" : "↻");
      badge.title = f.overridden ? "Recurring — custom amount/note for this date" : "Recurring";
      row.appendChild(badge);
    }
    const amt = el("span", "famount fnegative", formatMoney(f.amount));
    row.appendChild(amt);
    row.onclick = f.virtual
      ? () => {
          const rec = state.data.recurringExpenses.find((r) => r.id === f.recurringId);
          if (rec) openRecurringOccModal(rec, f);
        }
      : () => (state.bulk.active ? toggleBulkItem(f.id) : openFinanceModal(f));
    if (!f.virtual) attachLongPressSelect(row, f);
    return row;
  }

  function renderFinanceStats(root) {
    if (!state.data.financeEntries.length && !state.data.recurringExpenses.length) {
      root.appendChild(emptyState({
        glyph: CURRENCY_SYMBOLS[state.data.settings.currency] || CURRENCY_SYMBOLS.ILS,
        title: "No finance entries yet",
        body: "Track an expense and LifeLog starts building your monthly summary, category breakdown and spend trend.",
        action: "Add finance entry",
        onAction: () => openFinanceModal(null),
        hint: "Recurring expenses can generate their entries automatically.",
      }));
      return;
    }
    const items = getFilteredFinance();
    if (!items.length) {
      root.appendChild(emptyState("No finance entries match your filters."));
      return;
    }

    const expense = items.reduce((s, f) => s + f.amount, 0);

    const big = el("div", "card");
    big.appendChild(el("h2", null, "Expenses"));
    const bigRow = el("div", "stat-big");
    bigRow.appendChild(moneyStatItem(expense, "total", "var(--expense)"));
    big.appendChild(bigRow);
    root.appendChild(big);

    const grid = el("div", "stats-grid");
    grid.appendChild(financeCategoryCard("By category", items));

    const yearCard = el("div", "card");
    yearCard.appendChild(el("h2", null, "By year"));
    const yearTotals = {};
    for (const f of items) {
      const y = financeYearOf(f);
      yearTotals[y] = (yearTotals[y] || 0) + f.amount;
    }
    const yearMax = Math.max(1, ...Object.values(yearTotals));
    Object.keys(yearTotals).sort((a, b) => b - a)
      .forEach((y) => yearCard.appendChild(barRow(y, yearTotals[y], yearMax, "var(--accent)", null, formatMoney)));
    grid.appendChild(yearCard);

    root.appendChild(grid);

    renderFinanceMonthCard(root, items);
    renderRecurringSplitCard(root, items);
    renderTopExpensesCard(root, items);
  }

  // Builds the "By category" breakdown card (bar per category, sorted by total).
  function financeCategoryCard(title, catItems) {
    const card = el("div", "card");
    card.appendChild(el("h2", null, title));
    const totals = {};
    const counts = {};
    for (const f of catItems) {
      totals[f.category] = (totals[f.category] || 0) + f.amount;
      counts[f.category] = (counts[f.category] || 0) + 1;
    }
    let order = state.data.financeCategories.map((c) => c.name).filter((n) => totals[n]);
    for (const n of Object.keys(totals)) if (!order.includes(n)) order.push(n);
    const max = Math.max(1, ...Object.values(totals));
    order.sort((a, b) => totals[b] - totals[a])
      .forEach((n) => card.appendChild(barRow(n, totals[n], max, financeColorOf(n), counts[n], formatMoney, "entries")));
    return card;
  }

  const monthSortAsc = (a, b) => {
    a = +a; b = +b;
    if (a === 0) return 1; // yearly ad-hoc bucket always last
    if (b === 0) return -1;
    return a - b;
  };

  // Real per-month expense total, replacing the old flat
  // yearTotal/12 "Per month average" — one year at a time via a tab
  // picker, same pattern as the Journal Stats "Year in Review" card.
  function renderFinanceMonthCard(root, items) {
    const allYears = [...new Set(items.map(financeYearOf))].sort((a, b) => b - a);
    if (!allYears.length) return;
    if (!state.financeStatsYear || !allYears.includes(state.financeStatsYear)) state.financeStatsYear = allYears[0];

    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "By month"));

    const yearNav = el("div", "yir-years");
    for (const y of allYears) {
      const btn = el("button", "yir-year-btn" + (y === state.financeStatsYear ? " active" : ""), String(y));
      btn.type = "button";
      btn.onclick = () => { state.financeStatsYear = y; render(); };
      yearNav.appendChild(btn);
    }
    card.appendChild(yearNav);

    const yearItems = items.filter((f) => financeYearOf(f) === state.financeStatsYear);
    const byMonth = groupBy(yearItems, financeMonthOf);
    Object.keys(byMonth).sort(monthSortAsc).forEach((m) => {
      const mm = +m;
      const label = mm === 0 ? "Yearly" : MONTHS[mm];
      const total = byMonth[m].reduce((s, f) => s + f.amount, 0);
      card.appendChild(financeMoneyRow(label, total));
    });
    root.appendChild(card);
  }

  // Total spent this period through each recurring expense, broken out
  // individually (largest first) rather than lumped into one bucket.
  function renderRecurringSplitCard(root, expenseItems) {
    const recurring = expenseItems.filter((f) => f.virtual);
    if (!recurring.length) return;
    const byRec = groupBy(recurring, (f) => f.recurringId);
    const rows = Object.keys(byRec).map((id) => {
      const group = byRec[id];
      const rec = state.data.recurringExpenses.find((r) => r.id === id);
      const label = (rec && (rec.note || rec.category)) || group[0].note || group[0].category;
      const color = financeColorOf((rec && rec.category) || group[0].category);
      return { label, color, total: group.reduce((s, f) => s + f.amount, 0), count: group.length };
    }).sort((a, b) => b.total - a.total);

    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Recurring"));
    const max = Math.max(1, ...rows.map((r) => r.total));
    rows.forEach((r) => card.appendChild(barRow(r.label, r.total, max, r.color, r.count, formatMoney, "entries")));
    root.appendChild(card);
  }

  // Top 5 largest single expense transactions in the filtered range.
  function renderTopExpensesCard(root, expenseItems) {
    const top = expenseItems.slice().sort((a, b) => b.amount - a.amount).slice(0, 5);
    if (!top.length) return;
    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Top expenses"));
    const max = Math.max(1, ...top.map((f) => f.amount));
    top.forEach((f) => {
      const label = f.note || f.category;
      const row = barRow(label, f.amount, max, financeColorOf(f.category), null, formatMoney);
      row.querySelector(".lbl").title = label;
      card.appendChild(row);
    });
    root.appendChild(card);
  }

  function moneyStatItem(n, l, color) {
    const i = el("div", "item");
    const nEl = el("div", "n");
    if (color) nEl.style.color = color;
    animatedNumberText(nEl, "finstat:" + l, n, formatMoney);
    i.appendChild(nEl);
    i.appendChild(el("div", "l", l));
    return i;
  }
  function financeMoneyRow(label, amount) {
    const row = el("div", "month-total");
    row.appendChild(el("span", null, String(label)));
    row.appendChild(el("span", "famount fnegative", formatMoney(amount)));
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
      .forEach((y) => yearCard.appendChild(barRow(y, yearCounts[y], yearMax, "var(--accent)")));

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
    highlights.appendChild(statItem(yearEntries.length, "entries", "yir:entries"));
    highlights.appendChild(statItem(uniqueTitles, "unique titles", "yir:unique"));
    if (topMonth) highlights.appendChild(statItem(MONTHS_SHORT[+topMonth[0]], "best month", "yir:month"));
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

  function statItem(n, l, key) {
    const i = el("div", "item");
    const nEl = el("div", "n");
    animatedNumberText(nEl, "stat:" + (key || l), n, (v) => typeof v === "number" ? String(Math.round(v)) : String(v));
    i.appendChild(nEl);
    i.appendChild(el("div", "l", l));
    return i;
  }
  function barRow(label, val, max, color, uniqueVal, fmt, uniqueLabel = "unique") {
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
      valEl.appendChild(el("span", "val-unique-lbl", uniqueLabel));
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
    equalizeChipWidths(wrap);
  }

  // Pads every chip in a filter group out to the width of its widest sibling,
  // so e.g. "Books" and "Video Games" line up as even-length pills instead of
  // hugging their own text.
  function equalizeChipWidths(wrap) {
    const chips = [...wrap.querySelectorAll(".cat-chip")];
    if (chips.length < 2) return;
    chips.forEach((c) => { c.style.minWidth = ""; });
    const max = Math.max(...chips.map((c) => c.offsetWidth));
    chips.forEach((c) => { c.style.minWidth = max + "px"; });
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
    equalizeChipWidths(wrap);
    const addChip = el("span", "cat-chip add-chip", "+");
    addChip.title = finance ? "Add finance category" : "Add category";
    addChip.onclick = (ev) => {
      ev.stopPropagation();
      finance ? openFinanceCatModal(null) : openCategoryModal(null);
    };
    wrap.appendChild(addChip);
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

  // Category <select>s get a trailing "+ Add new category…" option so a
  // new category can be created without leaving the form that's using it.
  const ADD_CATEGORY_OPTION = "__add_category__";
  function fillCategorySelect(sel, cats, val) {
    fillSelect(sel,
      cats.map((c) => ({ value: c.name, label: c.name }))
        .concat([{ value: ADD_CATEGORY_OPTION, label: "+ Add new category…" }]),
      val);
    sel.dataset.prevValue = val || "";
  }

  // Picking that option hides the current modal, opens the add-category
  // modal, and remembers where to return to: with the new category selected
  // on save, or back to the prior selection on cancel.
  let pendingCatSelect = null; // { selectId, modalId, finance }
  function wireCategorySelect(selId, modalId, finance) {
    const sel = $(selId);
    sel.addEventListener("change", () => {
      if (sel.value !== ADD_CATEGORY_OPTION) { sel.dataset.prevValue = sel.value; return; }
      pendingCatSelect = { selectId: selId, modalId, finance };
      $(modalId).hidden = true;
      finance ? openFinanceCatModal(null) : openCategoryModal(null);
    });
  }
  function resolvePendingCatSelect(newName) {
    if (!pendingCatSelect) return;
    const { selectId, modalId, finance } = pendingCatSelect;
    pendingCatSelect = null;
    const sel = $(selectId);
    if (sel) {
      const cats = finance ? state.data.financeCategories : state.data.categories;
      fillCategorySelect(sel, cats, newName != null ? newName : sel.dataset.prevValue);
    }
    $(modalId).hidden = false;
  }

  function openEntryModal(entry, fromBacklog, presetDate) {
    const editing = !!entry;
    $("#entryModalTitle").textContent = editing ? "Edit entry" : "Add entry";
    $("#entryId").value = editing ? entry.id : "";
    $("#entryFromBacklog").value = fromBacklog ? fromBacklog.id : "";
    $("#fTitle").value = editing ? entry.title : (fromBacklog ? fromBacklog.title : "");
    fillCategorySelect($("#fCategory"), state.data.categories,
      editing ? entry.category : (fromBacklog ? fromBacklog.category : (state.data.categories[0] && state.data.categories[0].name)));
    fillSelect($("#fMonth"),
      MONTHS.slice(1).map((m, i) => ({ value: i + 1, label: m })),
      editing ? entry.month : (presetDate ? presetDate.month : (new Date().getMonth() + 1)));
    $("#fYear").value = editing ? entry.year : (presetDate ? presetDate.year : new Date().getFullYear());
    $("#deleteEntryBtn").hidden = !editing;
    $("#moveToBacklogBtn").hidden = !editing;
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
    const lengthSrc = editing ? (entry.length || "") : (fromBacklog ? (fromBacklog.length || "") : "");
    lastSyncedEntryTitle = editing ? entry.title : (fromBacklog ? fromBacklog.title : "");
    setEntryCover(coverSrc, mediaId, mediaSrc, lengthSrc);
    $("#fSteamAppId").value = mediaSrc === "steam" ? mediaId : "";
    updateSyncBtnVisibility("f", $("#fCategory").value);
    $("#fTitleSuggest").hidden = true;
    $("#fTitleSuggest").innerHTML = "";
    updateBacklogLinkBanner();
    $("#entryModal").hidden = false;
  }
  function closeEntryModal() { $("#entryModal").hidden = true; }

  function setStars(sel, value) {
    const wrap = $(sel);
    wrap.dataset.value = String(value);
    wrap.querySelectorAll(".star").forEach((s) => {
      s.classList.toggle("filled", parseInt(s.dataset.star, 10) <= value);
    });
  }
  function setRating(value) { setStars("#fRating", value); }

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
              coverUrl: e.coverUrl || "", mediaId: e.mediaId || "", mediaSource: e.mediaSource || "", length: e.length || "" };
        groups.set(key, g);
      }
      g.count++;
      if (e.year > g.year || (e.year === g.year && e.month > g.month)) {
        g.title = e.title; g.category = e.category; g.year = e.year; g.month = e.month;
        g.coverUrl = e.coverUrl || ""; g.mediaId = e.mediaId || ""; g.mediaSource = e.mediaSource || ""; g.length = e.length || "";
      }
    }
    return [...groups.values()]
      .sort((a, b) => a.title.toLowerCase().indexOf(q) - b.title.toLowerCase().indexOf(q) || b.count - a.count)
      .slice(0, 6);
  }

  // Suggest matching backlog items, so adding an entry surfaces the fact
  // it's already sitting in the backlog and offers to remove it on save.
  function backlogSuggestions(query, excludeId) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return state.data.backlog
      .filter((b) => b.id !== excludeId && b.title.trim().toLowerCase().includes(q))
      .sort((a, b) => a.title.toLowerCase().indexOf(q) - b.title.toLowerCase().indexOf(q))
      .slice(0, 6);
  }

  // Title last attached to synced media metadata, so a manual edit (vs. a
  // local-match or sync pick) is detected and clears the now-stale cover.
  let lastSyncedEntryTitle = "";

  function hasMediaSourceFor(category) {
    return !!((state.data.settings.mediaCategorySources || {})[category]);
  }

  // Strips a trailing "S1"/"Season 1"/"B1"/"Book 1" style marker some people
  // append to entry titles to tell apart e.g. individual seasons or books of
  // the same show/series — a media source's search has no idea what to do
  // with that suffix, so it's dropped before searching (the entry's own
  // title, and what gets saved, are never touched).
  const MEDIA_SEARCH_SUFFIX_RE = /\s+[-–—:]?\s*(?:season|s|book|b)\s*\.?\s*\d+\s*$/i;
  function stripMediaSearchSuffix(title) {
    const stripped = title.replace(MEDIA_SEARCH_SUFFIX_RE, "").trim();
    return stripped || title;
  }

  // Tries the category's primary media source first; only if that comes back
  // completely empty does it fall back to the category's configured fallback
  // source (if any) — the fallback never overrides a primary that actually
  // found something, it just fills the gap when the primary has nothing.
  async function fetchMediaSuggestions(title, category) {
    const source = (state.data.settings.mediaCategorySources || {})[category];
    if (!source || !window.LifeLogMedia) return [];
    const fallbackSource = (state.data.settings.mediaCategoryFallbackSources || {})[category];
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    const stripped = stripMediaSearchSuffix(title);
    async function trySource(src) {
      if (!src) return [];
      if (stripped !== title) {
        const results = await window.LifeLogMedia.search(stripped, src, keys);
        if (results.length) return results;
      }
      return window.LifeLogMedia.search(title, src, keys);
    }
    try {
      const results = await trySource(source);
      if (results.length) return results;
      return await trySource(fallbackSource);
    } catch (e) { return []; }
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

  function setEntryCover(coverUrl, mediaId, mediaSource, length) {
    $("#fCoverUrl").value = coverUrl || "";
    $("#fMediaId").value = mediaId || "";
    $("#fMediaSource").value = mediaSource || "";
    $("#fLength").value = length || "";
    const coverDiv = $("#entryCover");
    const coverImg = $("#entryCoverImg");
    const meta = $("#entryCoverMeta");
    meta.innerHTML = "";
    if (length) meta.appendChild(el("span", "bl-meta", length));
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
    const length = $("#bLength").value;
    if (rating) line.push("★ " + rating);
    if (year) line.push(year);
    if (length) line.push(length);
    if (line.length) meta.appendChild(el("span", "bl-meta", line.join(" · ")));
    const summary = $("#bSummary").value;
    if (summary) meta.appendChild(el("p", "bl-summary", summary));
    const mediaSource = $("#bMediaSource").value;
    const mediaId = $("#bMediaId").value;
    if (mediaSource === "steam" && mediaId) {
      const priceEl = el("span", "bl-price");
      priceEl.dataset.appid = mediaId;
      meta.appendChild(priceEl);
      // Same lookup the backlog list uses — reuses its cache (instant if
      // this item's price was already fetched there) and patches this
      // exact element via the shared .bl-price[data-appid] selector.
      loadBacklogPrices([{ mediaSource, mediaId }]);
    }
    coverDiv.hidden = false;
  }

  function renderTitleSuggestions() {
    const list = $("#fTitleSuggest");
    const query = $("#fTitle").value;
    const isAdding = !$("#entryId").value;

    // If user is typing new content (not just after a local-match pick), clear cover —
    // unless it's a manually-entered Steam App ID, which isn't derived from the title.
    // Only while adding: renaming an already-synced existing entry shouldn't silently
    // drop its media link — that takes an explicit "✕ Unsync" now.
    if (isAdding && query !== lastSyncedEntryTitle && $("#fCoverUrl").value && $("#fMediaSource").value !== "steam") {
      setEntryCover("", "", "", "");
    }

    const localMatches = titleSuggestions(query, $("#entryId").value || null);
    const backlogMatches = isAdding ? backlogSuggestions(query) : [];
    list.innerHTML = "";

    localMatches.forEach((m) => {
      const item = makeMediaAcItem(
        { title: m.title, coverUrl: m.coverUrl, year: null, externalRating: null },
        () => {
          lastSyncedEntryTitle = m.title;
          $("#fTitle").value = m.title;
          if (state.data.categories.some((c) => c.name === m.category)) $("#fCategory").value = m.category;
          setEntryCover(m.coverUrl, m.mediaId, m.mediaSource, m.length || "");
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

    if (localMatches.length && backlogMatches.length) list.appendChild(el("div", "ac-divider"));

    backlogMatches.forEach((b) => {
      const item = makeMediaAcItem(
        { title: b.title, coverUrl: b.coverUrl || "", year: null, externalRating: null },
        () => {
          lastSyncedEntryTitle = b.title;
          $("#fTitle").value = b.title;
          if (state.data.categories.some((c) => c.name === b.category)) $("#fCategory").value = b.category;
          setEntryCover(b.coverUrl || "", b.mediaId || "", b.mediaSource || "", b.length || "");
          updateSyncBtnVisibility("f", $("#fCategory").value);
          $("#entryFromBacklog").value = b.id;
          updateBacklogLinkBanner();
          list.hidden = true;
        }
      );
      const info = item.querySelector(".ac-info");
      const existing = info.querySelector(".ac-meta");
      if (existing) existing.remove();
      info.appendChild(el("span", "ac-meta", `📋 In backlog · ${b.category}`));
      list.appendChild(item);
    });

    list.hidden = !localMatches.length && !backlogMatches.length;

    // Exact typed match against the backlog auto-links it, without a click —
    // but only ever sets the link, never clears one already set (e.g. from
    // the ✓ Done button), so a later edit to the title can't silently undo it.
    if (isAdding && !$("#entryFromBacklog").value) {
      const q = query.trim().toLowerCase();
      if (q) {
        const exact = state.data.backlog.find((b) => b.title.trim().toLowerCase() === q);
        if (exact) $("#entryFromBacklog").value = exact.id;
      }
    }

    updateBacklogLinkBanner();
  }

  // Shows/hides the "will be removed from backlog on save" banner based on
  // #entryFromBacklog, however it got set (✓ Done button, suggestion click,
  // or exact-typed-title auto-link) — and wires the opt-out unlink button.
  function updateBacklogLinkBanner() {
    const id = $("#entryFromBacklog").value;
    const linked = id && state.data.backlog.some((b) => b.id === id);
    $("#fBacklogLinkStatus").hidden = !linked;
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
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    results.forEach((r) => {
      list.appendChild(makeMediaAcItem(r, async () => {
        lastSyncedEntryTitle = $("#fTitle").value.trim();
        const length = (await window.LifeLogMedia.fetchLength(r.id, r.source, keys.tmdb)) || r.length || "";
        setEntryCover(r.coverUrl, r.id, r.source, length);
        list.hidden = true;
      }));
    });
    list.hidden = false;
  }

  function unsyncEntry() {
    setEntryCover("", "", "", "");
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
    const length = $("#fLength").value;
    if (!title) return;
    if (id) {
      const e = state.data.entries.find((x) => x.id === id);
      Object.assign(e, { title, category, year, month, date: `${year}-${String(month).padStart(2, "0")}` });
      if (rating) e.rating = rating; else delete e.rating;
      if (notes) e.notes = notes; else delete e.notes;
      if (coverUrl) e.coverUrl = coverUrl; else delete e.coverUrl;
      if (mediaId) e.mediaId = mediaId; else delete e.mediaId;
      if (mediaSource) e.mediaSource = mediaSource; else delete e.mediaSource;
      if (length) e.length = length; else delete e.length;
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
      if (length) newEntry.length = length;
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

  async function moveEntryToBacklog() {
    const id = $("#entryId").value;
    if (!id) return;
    const entry = state.data.entries.find((e) => e.id === id);
    if (!entry) return;
    if (!confirm("Move this entry to your backlog?")) return;
    const item = { id: uid(), title: entry.title, category: entry.category, createdAt: new Date().toISOString() };
    if (entry.notes) item.notes = entry.notes;
    if (entry.coverUrl) item.coverUrl = entry.coverUrl;
    if (entry.mediaId) item.mediaId = entry.mediaId;
    if (entry.mediaSource) item.mediaSource = entry.mediaSource;
    if (entry.length) item.length = entry.length;
    state.data.backlog.push(item);
    state.data.entries = state.data.entries.filter((e) => e.id !== id);
    closeEntryModal();
    buildYearFilter();
    render();
    await persist();
    toast("Moved to backlog");
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
    let id = uid();
    if (orig) { // editing: preserve original date + identity, then remove the original
      const [oy, oi] = orig.split("|");
      if (accs[oy] && accs[oy][+oi]) {
        createdAt = accs[oy][+oi].createdAt; // may be null (imported)
        id = accs[oy][+oi].id || uid();
      }
      if (accs[oy]) { accs[oy].splice(+oi, 1); if (!accs[oy].length) delete accs[oy]; }
    }
    // updatedAt isn't set here — persist() stamps it automatically for any
    // item that changed since the last save (see stampChangedItems).
    const ach = { id, text, createdAt };
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
  function cancelCategoryModal() { closeCategoryModal(); resolvePendingCatSelect(); }

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
      state.data.categories.push({ id: newName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: newName, color, createdAt: new Date().toISOString() });
      closeCategoryModal();
      rebuildColorMap(); buildCatFilter(); render();
      await persist();
      toast("Category added");
      resolvePendingCatSelect(newName);
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
      // id stays put across a rename (it's the merge/sync identity for this
      // category) — only the display name and the cascade below change.
      // (updatedAt on cat/entries/backlog isn't set here — persist() stamps
      // it automatically for anything that changed since the last save.)
      const old = cat.name;
      cat.name = newName;
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
  function openBacklogModal(item, presetCategory) {
    const editing = !!item;
    $("#backlogModalTitle").textContent = editing ? "Edit backlog item" : "Add to backlog";
    $("#backlogId").value = editing ? item.id : "";
    $("#bTitle").value = editing ? item.title : "";
    fillCategorySelect($("#bCategory"), state.data.categories,
      editing ? item.category : (presetCategory || (state.data.categories[0] && state.data.categories[0].name)));
    $("#bNotes").value = editing ? (item.notes || "") : "";
    $("#bCoverUrl").value = editing ? (item.coverUrl || "") : "";
    $("#bMediaId").value = editing ? (item.mediaId || "") : "";
    $("#bMediaSource").value = editing ? (item.mediaSource || "") : "";
    $("#bSummary").value = editing ? (item.summary || "") : "";
    $("#bReleaseYear").value = editing && item.releaseYear ? String(item.releaseYear) : "";
    $("#bExternalRating").value = editing ? (item.externalRating || "") : "";
    $("#bLength").value = editing ? (item.length || "") : "";
    $("#bPriority").checked = editing ? !!item.priority : false;
    updatePriorityBtn();
    $("#bDropped").checked = editing ? !!item.dropped : false;
    updateDroppedBtnLabel();
    lastSyncedBacklogTitle = editing ? item.title : "";
    $("#bSteamAppId").value = editing && item.mediaSource === "steam" ? (item.mediaId || "") : "";
    $("#bTitleSuggest").innerHTML = "";
    $("#bTitleSuggest").hidden = true;
    $("#deleteBacklogBtn").hidden = !editing;
    setBacklogCover();
    updateSyncBtnVisibility("b", $("#bCategory").value);
    updateBacklogDuplicateBanner();
    $("#backlogModal").hidden = false;
  }
  function closeBacklogModal() { $("#backlogModal").hidden = true; }

  function updateDroppedBtnLabel() {
    $("#toggleDroppedBtn").textContent = $("#bDropped").checked ? "Restore" : "Mark as dropped";
  }
  function toggleDropped() {
    $("#bDropped").checked = !$("#bDropped").checked;
    updateDroppedBtnLabel();
  }

  function updatePriorityBtn() {
    const on = $("#bPriority").checked;
    const btn = $("#bPriorityBtn");
    btn.textContent = on ? "★" : "☆";
    btn.classList.toggle("active", on);
    btn.title = on ? "Prioritized — click to remove" : "Prioritize";
  }
  function togglePriority() {
    $("#bPriority").checked = !$("#bPriority").checked;
    updatePriorityBtn();
  }

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
    const length = $("#bLength").value;
    const priority = $("#bPriority").checked ? 1 : 0;
    const dropped = $("#bDropped").checked;
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
      if (length) b.length = length; else delete b.length;
      if (priority) b.priority = priority; else delete b.priority;
      if (dropped) b.dropped = true; else delete b.dropped;
    } else {
      const item = { id: uid(), title, category, createdAt: new Date().toISOString() };
      if (notes) item.notes = notes;
      if (coverUrl) item.coverUrl = coverUrl;
      if (mediaId) item.mediaId = mediaId;
      if (mediaSource) item.mediaSource = mediaSource;
      if (summary) item.summary = summary;
      if (releaseYear) item.releaseYear = parseInt(releaseYear, 10);
      if (externalRating) item.externalRating = externalRating;
      if (length) item.length = length;
      if (priority) item.priority = priority;
      if (dropped) item.dropped = true;
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
    $("#finDate").required = !yearly;
    $("#finYear").required = yearly;
  }
  function openFinanceModal(entry, presetDate) {
    const editing = !!entry;
    const yearly = editing ? !!entry.yearly : (presetDate && presetDate.month === 0);
    $("#financeModalTitle").textContent = editing ? "Edit finance entry" : "Add finance entry";
    $("#financeId").value = editing ? entry.id : "";
    $("#finYearly").checked = yearly;
    $("#finDate").value = (editing && !yearly) ? entry.date
      : (!yearly && presetDate ? `${presetDate.year}-${String(presetDate.month).padStart(2, "0")}-01` : new Date().toISOString().slice(0, 10));
    $("#finYear").value = yearly ? (editing ? entry.date : (presetDate ? String(presetDate.year) : "")) : "";
    $("#finAmount").value = editing ? entry.amount : "";
    fillCategorySelect($("#finCategory"), state.data.financeCategories,
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
    const amount = Math.abs(parseFloat($("#finAmount").value)) || 0;
    const category = $("#finCategory").value;
    const note = $("#finNote").value.trim();
    if (!date || !amount) return;
    if (yearly && !/^\d{4}$/.test(date)) return;
    if (id) {
      const f = state.data.financeEntries.find((x) => x.id === id);
      Object.assign(f, { date, amount, category });
      if (note) f.note = note; else delete f.note;
      if (yearly) f.yearly = true; else delete f.yearly;
    } else {
      const item = { id: uid(), date, amount, category, createdAt: new Date().toISOString() };
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
    fillCategorySelect($("#recCategory"), state.data.financeCategories,
      editing ? rec.category : (state.data.financeCategories[0] && state.data.financeCategories[0].name));
    $("#recNote").value = editing ? (rec.note || "") : "";
    $("#deleteRecurringBtn").hidden = !editing;
    const occWrap = $("#recOccurrences");
    if (editing) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const occ = recurringOccurrences(rec, today).slice().sort((a, b) => b.date.localeCompare(a.date));
      const list = $("#recOccList");
      list.innerHTML = "";
      occ.forEach((o) => {
        const row = el("div", "rec-occ-row" + (o.overridden ? " is-overridden" : ""));
        row.appendChild(el("span", "rec-occ-date", o.date + (o.overridden ? " *" : "")));
        row.appendChild(el("span", "rec-occ-amount", "-" + formatMoney(o.amount)));
        row.title = "Edit this occurrence";
        row.onclick = () => openRecurringOccModal(rec, o);
        list.appendChild(row);
      });
      occWrap.hidden = false;
    } else {
      occWrap.hidden = true;
    }
    $("#recurringModal").hidden = false;
  }
  function closeRecurringModal() { $("#recurringModal").hidden = true; }

  // Edits one generated occurrence's amount/note without touching the
  // template or any other occurrence — stored as a sparse patch on
  // rec.overrides, keyed by that occurrence's date.
  function openRecurringOccModal(rec, occ) {
    $("#recurringOccModalTitle").textContent = occ.date;
    $("#recOccRecId").value = rec.id;
    $("#recOccDate").value = occ.date;
    $("#recOccAmount").value = occ.amount;
    $("#recOccNote").value = occ.note || "";
    $("#resetRecOccBtn").hidden = !occ.overridden;
    $("#recurringOccModal").hidden = false;
  }
  function closeRecurringOccModal() { $("#recurringOccModal").hidden = true; }

  async function saveRecurringOccFromForm(ev) {
    ev.preventDefault();
    const rec = state.data.recurringExpenses.find((x) => x.id === $("#recOccRecId").value);
    if (!rec) return;
    const date = $("#recOccDate").value;
    const amount = Math.abs(parseFloat($("#recOccAmount").value)) || 0;
    const note = $("#recOccNote").value.trim();
    const ov = {};
    if (amount !== rec.amount) ov.amount = amount;
    if (note !== (rec.note || "")) ov.note = note;
    if (Object.keys(ov).length) {
      if (!rec.overrides) rec.overrides = {};
      rec.overrides[date] = ov;
    } else if (rec.overrides) {
      delete rec.overrides[date];
      if (!Object.keys(rec.overrides).length) delete rec.overrides;
    }
    const reopenTemplate = !$("#recurringModal").hidden;
    closeRecurringOccModal();
    render();
    await persist();
    toast("Occurrence updated");
    if (reopenTemplate) openRecurringModal(rec);
  }
  async function resetRecurringOcc() {
    const rec = state.data.recurringExpenses.find((x) => x.id === $("#recOccRecId").value);
    const date = $("#recOccDate").value;
    if (rec && rec.overrides) {
      delete rec.overrides[date];
      if (!Object.keys(rec.overrides).length) delete rec.overrides;
    }
    const reopenTemplate = !$("#recurringModal").hidden;
    closeRecurringOccModal();
    render();
    await persist();
    toast("Reset to template amount");
    if (reopenTemplate && rec) openRecurringModal(rec);
  }

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

  // Deleting a recurring expense removes the template (so no new occurrences
  // get generated) but first materializes every occurrence it already
  // produced into real finance entries, so none of that history disappears.
  async function deleteCurrentRecurring() {
    const id = $("#recId").value;
    if (!id) return;
    if (!confirm("Delete this recurring expense? It will stop generating new occurrences, but everything it already created stays in your history.")) return;
    const r = state.data.recurringExpenses.find((x) => x.id === id);
    if (r) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      recurringOccurrences(r, today).forEach((o) => {
        const entry = { id: uid(), date: o.date, type: "expense", amount: o.amount, category: o.category, createdAt: new Date().toISOString() };
        if (o.note) entry.note = o.note;
        state.data.financeEntries.push(entry);
      });
      state.data.recurringExpenses = state.data.recurringExpenses.filter((x) => x.id !== id);
    }
    closeRecurringModal();
    buildYearFilter();
    render();
    await persist();
    toast("Recurring expense deleted");
  }

  // Finds, among a template's generated occurrences, the one closest in
  // time to a given date — used to map a linked real entry onto whichever
  // occurrence date the template actually lands on for that period, since
  // the entry's own date (e.g. the 3rd) doesn't necessarily match the
  // template's anchor day (e.g. the 5th).
  function closestOccurrenceDate(occs, targetDateStr) {
    const target = new Date(targetDateStr + "T00:00:00").getTime();
    let best = null, bestDiff = Infinity;
    for (const o of occs) {
      const diff = Math.abs(new Date(o.date + "T00:00:00").getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = o.date; }
    }
    return best;
  }

  // Lets old, manually-logged finance entries (from before this recurring
  // expense existed, or a stray real entry that duplicates a since-covered
  // period) be folded into the template: picked entries are deleted, and if
  // any predate the template's start, the start date moves back to cover
  // them. Each linked entry's own amount/note is preserved as a
  // per-occurrence override rather than silently snapping to the
  // template's current amount — a bill that changed price over time
  // shouldn't have its history rewritten by linking it.
  function openLinkPastExpensesPicker(rec) {
    // Yearly big-purchase entries only carry a bare year (no month/day), so
    // they're excluded both because a template's startDate needs a real
    // date and because a one-off yearly purchase isn't really an instance
    // of a periodic bill anyway.
    const candidates = state.data.financeEntries.filter((e) => e.category === rec.category && !e.yearly);
    if (!candidates.length) { toast("No existing expenses in this category to link", true); return; }
    const items = candidates.map((e) => ({ kind: "finance", entry: e, dup: false, checked: false }));
    openImportPicker({
      title: "Link past expenses",
      hint: `Pick expenses you logged before this recurring expense existed (or a stray duplicate of one it already covers). Linked ones are removed — if any predate ${rec.startDate}, the start date moves back to cover them. Each one keeps its own original amount/note as an override, so a price that changed over time isn't flattened to the template's current amount.`,
      mode: "link",
      items,
      searchable: true,
      confirmLabel: "Link",
      onConfirm: async (selected) => {
        if (!selected.length) return;
        const ids = new Set(selected.map((i) => i.entry.id));
        state.data.financeEntries = state.data.financeEntries.filter((e) => !ids.has(e.id));
        const minDate = selected.map((i) => i.entry.date).sort()[0];
        const movedStart = minDate < rec.startDate;
        if (movedStart) rec.startDate = minDate;

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const occs = recurringOccurrences(rec, today);
        selected.forEach((i) => {
          const e = i.entry;
          const ov = {};
          if (e.amount !== rec.amount) ov.amount = e.amount;
          if ((e.note || "") !== (rec.note || "")) ov.note = e.note || "";
          if (Object.keys(ov).length) {
            const occDate = closestOccurrenceDate(occs, e.date) || e.date;
            if (!rec.overrides) rec.overrides = {};
            rec.overrides[occDate] = ov;
          }
        });

        buildYearFilter();
        render();
        await persist();
        toast(`Linked ${selected.length} expense${selected.length === 1 ? "" : "s"}` + (movedStart ? ` — now starts ${minDate}` : ""));
        openRecurringModal(rec);
      },
    });
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
  function cancelFinanceCatModal() { closeFinanceCatModal(); resolvePendingCatSelect(); }

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
      state.data.financeCategories.push({ id: newName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: newName, color, createdAt: new Date().toISOString() });
      closeFinanceCatModal();
      rebuildFinanceColorMap(); buildCatFilter(); render();
      await persist();
      toast("Finance category added");
      resolvePendingCatSelect(newName);
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
      // id stays put across a rename (it's the merge/sync identity for this
      // category) — only the display name and the cascade below change.
      // (updatedAt isn't set here — persist() stamps it automatically for
      // anything that changed since the last save.)
      const old = cat.name;
      cat.name = newName;
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
    s.title = txt;
    const label = el("span", "stxt");
    label.textContent = txt;
    s.appendChild(label);
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
      const remoteData = normalize(res.data);
      // Merge rather than blindly adopting remote — cheap insurance against
      // the narrow window where this device has local edits not yet marked
      // "pending" (e.g. between a mutation and its persist() call landing).
      let merged = remoteData, contributedLocally = false, summary = "";
      if (window.LifeLogMerge) {
        try {
          merged = normalize(window.LifeLogMerge.mergeAllSources(Storage.getSyncBase(), state.data, remoteData));
          summary = window.LifeLogMerge.diffSnapshots(state.data, merged);
          contributedLocally = window.LifeLogMerge.diffSnapshots(remoteData, merged) !== "No changes";
        } catch (e) { merged = remoteData; }
      }
      state.data = merged;
      Storage._cache(state.data);
      afterDataChange();
      if (contributedLocally) await persist(); // push the reconciled result back so it durably converges
      else refreshStorageStatus();
      toast(summary && summary !== "No changes" ? "Merged " + summary + " from your other device" : "Updated from another device");
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

  // ---------- version history (Settings → Data tab) ----------
  let historyCache = []; // last fetched list, so restore can look it up

  function formatHistoryDate(iso) {
    if (!iso) return "Unknown time";
    return new Date(iso).toLocaleString();
  }

  async function updateHistoryPanel() {
    await refreshHistoryList();
  }

  // Normalizes a local history entry ({id, savedAt, summary, snapshot}) and
  // a GitHub commit ({sha, date, message}) into one common shape so they can
  // share a single list and restore path.
  function normalizeHistoryEntry(e, source) {
    if (source === "local") return { id: e.id, savedAt: e.savedAt, summary: e.summary, source, snapshot: e.snapshot };
    return { id: "gh-" + e.sha, savedAt: e.date, summary: e.message || "(no message)", source: "github", sha: e.sha };
  }

  async function refreshHistoryList() {
    const empty = $("#historyEmptyState");
    const controls = $("#historyControls");
    const status = $("#historyStatus");
    const list = $("#historyList");
    status.textContent = "Loading…";
    list.innerHTML = "";
    try {
      const local = (await Storage.listLocalHistory()).map((e) => normalizeHistoryEntry(e, "local"));
      let combined = local;
      // GitHub's deeper commit log fills in anything older than local's
      // window (local history is capped locally; GitHub's isn't) — it's
      // never the primary source anymore, just an extension of it.
      if (Storage.githubConnected) {
        try {
          const oldestLocal = local.length ? local[local.length - 1].savedAt : null;
          const ghExtra = (await Storage.listHistory())
            .map((c) => normalizeHistoryEntry(c, "github"))
            .filter((c) => !oldestLocal || c.savedAt < oldestLocal);
          combined = local.concat(ghExtra);
        } catch (e) { /* GitHub unreachable — local history still shown below */ }
      }
      combined.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
      historyCache = combined;

      empty.hidden = !!combined.length;
      controls.hidden = !combined.length;
      if (!combined.length) { status.textContent = ""; return; }

      status.textContent = `Showing the last ${combined.length} save${combined.length === 1 ? "" : "s"}.`;
      combined.forEach((c, i) => {
        const row = el("div", "history-row");
        const head = el("div", "history-row-head");
        head.appendChild(el("span", "history-date", formatHistoryDate(c.savedAt)));
        if (i === 0) head.appendChild(el("span", "history-badge", "Current"));
        const btn = el("button", "btn btn-small", i === 0 ? "Current" : "Restore");
        btn.type = "button";
        btn.disabled = i === 0;
        btn.onclick = () => restoreHistoryVersion(c);
        head.appendChild(btn);
        row.appendChild(head);
        row.appendChild(el("div", "history-msg", c.summary || "(no summary)"));
        list.appendChild(row);
      });
    } catch (e) {
      empty.hidden = true;
      controls.hidden = false;
      status.textContent = "";
      list.innerHTML = "";
      list.appendChild(el("p", "warn", "Couldn't load history: " + (e.message || e)));
    }
  }

  async function restoreHistoryVersion(entry) {
    const when = formatHistoryDate(entry.savedAt);
    if (!confirm(
      "Restore the version from " + when + "?\n\n" +
      "This loads that version's data and saves it as your new current state " +
      "(it becomes a new save — nothing already in your history is deleted)."
    )) return;
    try {
      setSyncing("Restoring…");
      const data = entry.snapshot ? structuredClone(entry.snapshot) : await Storage.getVersion(entry.sha);
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
        "<br>• Chrome and Edge support it out of the box." +
        "<br>• Some browsers (e.g. Brave) ship it off by default — enable it from that browser's flags page (search “File System Access API”, set to Enabled, relaunch), then reload." +
        "<br>• Until then your data is saved in this browser only — use <strong>Export JSON</strong> for backups.";
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
      if (isActive && !prefersReducedMotion()) {
        p.classList.remove("view-fade-in");
        void p.offsetWidth; // force reflow so the animation replays
        p.classList.add("view-fade-in");
      }
    });
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
      { value: "jikan-anime", label: "Jikan (anime)" },
      { value: "anilist-manga", label: "AniList (manga)" },
      { value: "jikan-manga", label: "Jikan (manga)" },
      { value: "openlibrary", label: "Open Library (books)" },
      { value: "googlebooks", label: "Google Books (books)" },
      { value: "musicbrainz", label: "MusicBrainz (music)" },
    ];
    // Fallback dropdown offers every source (minus whatever's picked as
    // primary and minus Steam, which has no search to fall back to/from —
    // manual App ID only) — no restriction to "compatible" types, so it's
    // on you to leave it at "No fallback" for a category where a second
    // source doesn't make sense (e.g. Movies, until something else covers TMDB).
    const fallbackSources = sources.filter((s) => s.value && s.value !== "steam");
    if (!state.data.categories.length) {
      container.appendChild(el("p", "muted", "No categories yet — add categories first."));
      return;
    }
    for (const cat of state.data.categories) {
      const row = el("div", "media-cat-row");
      row.appendChild(el("span", "media-cat-name", cat.name));

      const selWrap = el("div", "media-cat-sels");
      const sel = el("select", "media-cat-sel");
      sources.forEach((s) => {
        const opt = el("option", null, s.label);
        opt.value = s.value;
        if ((state.data.settings.mediaCategorySources || {})[cat.name] === s.value) opt.selected = true;
        sel.appendChild(opt);
      });

      const arrow = el("span", "media-cat-arrow", "→");
      const fallbackSel = el("select", "media-cat-sel media-cat-fallback");
      const noneOpt = el("option", null, "No fallback");
      noneOpt.value = "";
      fallbackSel.appendChild(noneOpt);
      fallbackSources.forEach((s) => {
        const opt = el("option", null, s.label);
        opt.value = s.value;
        if ((state.data.settings.mediaCategoryFallbackSources || {})[cat.name] === s.value) opt.selected = true;
        fallbackSel.appendChild(opt);
      });

      sel.onchange = async () => {
        if (!state.data.settings.mediaCategorySources) state.data.settings.mediaCategorySources = {};
        state.data.settings.mediaCategorySources[cat.name] = sel.value;
        await persist();
      };
      fallbackSel.onchange = async () => {
        if (!state.data.settings.mediaCategoryFallbackSources) state.data.settings.mediaCategoryFallbackSources = {};
        state.data.settings.mediaCategoryFallbackSources[cat.name] = fallbackSel.value;
        await persist();
      };

      selWrap.appendChild(sel);
      selWrap.appendChild(arrow);
      selWrap.appendChild(fallbackSel);
      row.appendChild(selWrap);
      container.appendChild(row);
    }
  }

  function renderSteamWishlistCategoryOptions() {
    const sel = $("#steamWishlistCategory");
    if (!sel) return;
    const current = state.data.settings.steam?.wishlistCategory || sel.value;
    sel.innerHTML = "";
    state.data.categories.forEach((cat) => {
      const opt = el("option", null, cat.name);
      opt.value = cat.name;
      sel.appendChild(opt);
    });
    if (current && state.data.categories.some((c) => c.name === current)) sel.value = current;
  }

  function updateMediaSettings() {
    if (!$("#rawgKey")) return;
    $("#rawgKey").value = state.data.settings.mediaKeys?.rawg || "";
    $("#tmdbKey").value = state.data.settings.mediaKeys?.tmdb || "";
    $("#ggdealsKey").value = state.data.settings.mediaKeys?.ggdeals || "";
    $("#steamProxyUrl").value = state.data.settings.steam?.proxyUrl || "";
    $("#steamId64").value = state.data.settings.steam?.steamId || "";
    $("#steamAutoSyncDays").value = state.data.settings.steam?.autoSyncDays || "0";
    updateSteamRetryUnresolvedButton();
    updateSteamBackfillRawgButton();
    renderSteamWishlistCategoryOptions();
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
    $("#themeSelect").value = state.visual.theme || "default";
    $("#forceLayout").value = state.visual.forceLayout || "none";
    $("#currency").value = state.data.settings.currency;
    $("#timelineCoverSize").value = state.visual.timelineCoverSize || "small";
    $("#backlogCoverSize").value = state.visual.backlogCoverSize || "big";
    updateMediaSettings();
    updatePrivacySettings();
    $("#settingsModal").hidden = false;
  }

  // ---------- privacy / app lock settings ----------
  let bioAvailable = null; // cached after the first check (per page load)

  async function updatePrivacySettings() {
    $("#privacyEnabled").checked = !!state.privacy.enabled;
    $("#privacyGrace").value = String(state.privacy.graceMinutes || 0);
    refreshPrivacyUI();

    if (bioAvailable === null) bioAvailable = await biometricAvailable();
    $("#setBioBtn").hidden = !bioAvailable;
    $("#privacyBioUnavailable").hidden = bioAvailable;
  }

  function refreshPrivacyUI() {
    $("#privacyPinStatus").textContent = state.privacy.pinHash
      ? "A PIN is set on this device." : "No PIN set yet.";
    $("#setPinBtn").textContent = state.privacy.pinHash ? "Change PIN" : "Set PIN";
    $("#removePinBtn").hidden = !state.privacy.pinHash;

    $("#setBioBtn").disabled = !state.privacy.pinHash;
    $("#setBioBtn").title = state.privacy.pinHash ? "" : "Set a PIN first";
    $("#privacyBioStatus").textContent = state.privacy.credentialId
      ? "Fingerprint/Face ID is set up on this device."
      : (state.privacy.pinHash ? "Not set up yet." : "Set a PIN first to enable this.");
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
  function onForceLayoutChange() {
    state.visual.forceLayout = $("#forceLayout").value;
    saveVisualSettings(state.visual);
    applyForceLayout();
  }
  function onThemeChange() {
    state.visual.theme = $("#themeSelect").value;
    saveVisualSettings(state.visual);
    applyTheme();
  }
  function onTimelineCoverSizeChange() {
    state.visual.timelineCoverSize = $("#timelineCoverSize").value;
    saveVisualSettings(state.visual);
    render();
  }
  function onBacklogCoverSizeChange() {
    state.visual.backlogCoverSize = $("#backlogCoverSize").value;
    saveVisualSettings(state.visual);
    render();
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
    // A wishlisted game already logged as finished in the Journal (title
    // match, ignoring year/month/date since a backlog item has none of
    // those yet) is just as much a duplicate as one already sitting in
    // the backlog — same check the single-item add form already does
    // (updateBacklogDuplicateBanner) that bulk import was missing.
    const titleCatKey = (t, c) => `${(t || "").toLowerCase()}|${(c || "").toLowerCase()}`;
    const existingEntryTitleKeys = new Set(state.data.entries.map((e) => titleCatKey(e.title, e.category)));
    // Steam app IDs are a stronger identity than title — catches a wishlist
    // item whose title was edited locally after an earlier import (a plain
    // title/category match would otherwise treat it as new again), checked
    // against both the backlog and the Journal.
    const existingSteamIds = new Set(
      [...state.data.backlog, ...state.data.entries]
        .filter((x) => x.mediaSource === "steam" && x.mediaId)
        .map((x) => x.mediaId)
    );

    (entries || []).map(sanitizeEntry).forEach((e) => {
      const dup = existingEntryKeys.has(entryKey(e));
      items.push({ kind: "entry", entry: e, dup, checked: !dup });
    });
    (backlog || []).forEach((raw) => {
      const b = sanitizeBacklog(raw);
      const dup = existingBacklogKeys.has(backlogKey(b)) ||
        existingEntryTitleKeys.has(titleCatKey(b.title, b.category)) ||
        (b.mediaSource === "steam" && b.mediaId && existingSteamIds.has(b.mediaId));
      items.push({ kind: "backlog", entry: b, dup, checked: !dup, unresolved: !!raw.unresolved });
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

  // The wishlist endpoint (IWishlistService/GetWishlist) only returns
  // {appid, priority, date_added} per item, no title. Steam's bulk
  // id->name list turned out to be a dead end (ISteamApps/GetAppList is
  // retired, its replacement IStoreService/GetAppList needs a
  // Steam Partner key regular users don't have), so titles are resolved
  // one game at a time via the storefront's appdetails endpoint instead
  // — slower, but the only option left that doesn't need special access.
  // A null return (bad response after retries, or a genuinely unknown app)
  // just falls back to a placeholder title rather than failing the whole
  // sync. A 429 specifically gets a few backed-off retries first, since on
  // a large wishlist Steam starts rate-limiting partway through and every
  // request after that point would otherwise fail identically.
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  async function fetchSteamAppName(proxyUrl, appid, attempt) {
    attempt = attempt || 0;
    try {
      const res = await fetch(`${proxyUrl}/steam-appdetails/${appid}`);
      if (res.status === 429 && attempt < 3) {
        await sleep(1500 * (attempt + 1));
        return fetchSteamAppName(proxyUrl, appid, attempt + 1);
      }
      if (!res.ok) return null;
      const data = await res.json();
      const entry = data && data[appid];
      return (entry && entry.success && entry.data && entry.data.name) || null;
    } catch (e) {
      return null;
    }
  }

  // Steam's appdetails only gives a name — no rating/length/release year,
  // the stuff RAWG normally provides for a manually-added game. Games
  // pulled in via wishlist import would otherwise be the only entries
  // missing that data, so this does a best-effort RAWG search by the
  // now-resolved title and takes the top match. Silent on any failure
  // (no RAWG key set, no match, network error) — this is a nice-to-have
  // on top of a game that's already been imported successfully.
  async function fetchRawgInfo(title) {
    const rawgKey = state.data.settings.mediaKeys?.rawg;
    if (!rawgKey || !window.LifeLogMedia) return null;
    try {
      const results = await window.LifeLogMedia.search(title, "rawg", { rawg: rawgKey });
      return (results && results[0]) || null;
    } catch (e) {
      return null;
    }
  }

  // Pulls the whole wishlist in one request via the user's own CORS proxy
  // (Steam's wishlist endpoint has no Access-Control-Allow-Origin, see
  // proxy/worker.js), skips anything already imported (matched by Steam
  // app ID, so no wasted lookups on a repeat sync), resolves titles for
  // what's left one at a time with a small delay between requests to
  // stay under Steam's rate limit, then routes the result through the
  // same review picker used for every other import — dup-checked by
  // title+category too, nothing added until confirmed. Each item is
  // tagged mediaSource: "steam" + mediaId: <appid>, the same shape a
  // manually entered Steam App ID produces, so cover art and GG.deals
  // pricing (both already wired to that shape) pick it up with no
  // further work.
  async function syncSteamWishlist() {
    const cfg = state.data.settings.steam || DEFAULT_SETTINGS.steam;
    const proxyUrl = (cfg.proxyUrl || "").trim().replace(/\/+$/, "");
    const steamId = (cfg.steamId || "").trim();
    const category = cfg.wishlistCategory || "";
    if (!proxyUrl || !steamId) { toast("Set your proxy URL and SteamID64 first", true); return; }
    if (!category) { toast("Choose a category to import into first", true); return; }
    const btn = $("#steamWishlistSyncBtn");
    const label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
    try {
      const res = await fetch(`${proxyUrl}/steam-wishlist/${encodeURIComponent(steamId)}`);
      if (!res.ok) { toast(`Steam wishlist fetch failed (HTTP ${res.status})`, true); return; }
      const data = await res.json();
      const items = (data && data.response && data.response.items) || [];
      if (!items.length) {
        toast("Wishlist came back empty — check it's set to Public in your Steam privacy settings", true);
        return;
      }
      const existingSteamIds = new Set(
        state.data.backlog.filter((b) => b.mediaSource === "steam" && b.mediaId).map((b) => b.mediaId)
      );
      const newItems = items.filter((it) => !existingSteamIds.has(String(it.appid)));
      if (!newItems.length) {
        toast("Nothing new — every wishlisted game is already in your backlog");
        return;
      }
      const games = [];
      for (let i = 0; i < newItems.length; i++) {
        const appid = newItems[i].appid;
        if (btn) btn.textContent = `Fetching titles & info… ${i + 1}/${newItems.length}`;
        const name = await fetchSteamAppName(proxyUrl, appid);
        const rawg = name ? await fetchRawgInfo(name) : null;
        games.push({
          title: name || `Steam app ${appid}`,
          category,
          mediaSource: "steam",
          mediaId: String(appid),
          coverUrl: window.LifeLogMedia ? window.LifeLogMedia.steamCoverUrl(appid) : "",
          unresolved: !name,
          ...(rawg?.externalRating ? { externalRating: rawg.externalRating } : {}),
          ...(rawg?.length ? { length: rawg.length } : {}),
          ...(rawg?.year ? { releaseYear: rawg.year } : {}),
        });
        if (i < newItems.length - 1) await sleep(500);
      }
      const built = buildImportItems({ backlog: games, categories: [] });
      reviewAndImport(
        "Steam Wishlist",
        "Review which wishlisted games to add to your backlog — titles already in your backlog are hidden by default.",
        built
      );
    } catch (e) {
      toast("Steam wishlist fetch failed (" + ((e && e.message) || "network error") + ")", true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  // Backlog items still stuck on the "Steam app <id>" placeholder title —
  // exact match against what syncSteamWishlist generates, so this can't
  // false-positive on something a user genuinely titled that way.
  function unresolvedSteamBacklogItems() {
    return state.data.backlog.filter(
      (b) => b.mediaSource === "steam" && b.mediaId && b.title === `Steam app ${b.mediaId}`
    );
  }

  // Re-attempts the title lookup for backlog items already imported with a
  // placeholder title (see unresolvedSteamBacklogItems) — a normal re-sync
  // won't touch these since they're already in the backlog and thus no
  // longer show up as "new" wishlist items. Updates titles in place; never
  // adds, removes, or duplicates anything.
  async function retryUnresolvedSteamTitles() {
    const cfg = state.data.settings.steam || DEFAULT_SETTINGS.steam;
    const proxyUrl = (cfg.proxyUrl || "").trim().replace(/\/+$/, "");
    if (!proxyUrl) { toast("Set your proxy URL first", true); return; }
    const targets = unresolvedSteamBacklogItems();
    if (!targets.length) { toast("Nothing unresolved to retry"); return; }
    const btn = $("#steamRetryUnresolvedBtn");
    if (btn) { btn.disabled = true; }
    let resolved = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (btn) btn.textContent = `Retrying… ${i + 1}/${targets.length}`;
        const name = await fetchSteamAppName(proxyUrl, targets[i].mediaId);
        if (name) {
          targets[i].title = name;
          targets[i].updatedAt = new Date().toISOString();
          resolved++;
        }
        if (i < targets.length - 1) await sleep(500);
      }
      afterDataChange();
      await persist();
      toast(`Resolved ${resolved} of ${targets.length} title${targets.length === 1 ? "" : "s"}`);
    } finally {
      // Recomputes text/visibility from the actual current count, whether
      // the loop finished, partially finished, or threw — rather than
      // restoring the pre-click label, which would be stale either way.
      if (btn) btn.disabled = false;
      updateSteamRetryUnresolvedButton();
      updateSteamBackfillRawgButton(); // a newly-resolved title is now eligible for RAWG backfill too
    }
  }

  function updateSteamRetryUnresolvedButton() {
    const btn = $("#steamRetryUnresolvedBtn");
    const hint = $("#steamRetryUnresolvedHint");
    if (!btn) return;
    const count = unresolvedSteamBacklogItems().length;
    btn.hidden = !count;
    hint.hidden = !count;
    if (count) btn.textContent = `🔁 Retry unresolved Steam titles (${count})`;
  }

  // Steam-sourced backlog items with a real title but none of RAWG's
  // extra fields — either imported before RAWG enrichment was added to
  // the sync, or a RAWG lookup that failed at the time. Deliberately
  // requires all three fields blank, so a game with a partial manual
  // edit isn't silently overwritten.
  function steamGamesNeedingRawgInfo() {
    return state.data.backlog.filter((b) =>
      b.mediaSource === "steam" && b.mediaId &&
      b.title !== `Steam app ${b.mediaId}` &&
      !b.externalRating && !b.length && !b.releaseYear
    );
  }

  // Retroactively fills in RAWG's rating/length/release year for
  // Steam-sourced backlog items that don't have any of it yet — same
  // best-effort top-match lookup the sync uses, just run afterward for
  // whatever's missing it. Never touches title, cover, or mediaId.
  async function backfillRawgForSteamGames() {
    const rawgKey = state.data.settings.mediaKeys?.rawg;
    if (!rawgKey) { toast("Set a RAWG API key first (Settings → Media)", true); return; }
    const targets = steamGamesNeedingRawgInfo();
    if (!targets.length) { toast("Nothing to backfill"); return; }
    const btn = $("#steamBackfillRawgBtn");
    if (btn) { btn.disabled = true; }
    let filled = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (btn) btn.textContent = `Backfilling… ${i + 1}/${targets.length}`;
        const rawg = await fetchRawgInfo(targets[i].title);
        if (rawg) {
          if (rawg.externalRating) targets[i].externalRating = rawg.externalRating;
          if (rawg.length) targets[i].length = rawg.length;
          if (rawg.year) targets[i].releaseYear = rawg.year;
          if (rawg.externalRating || rawg.length || rawg.year) {
            targets[i].updatedAt = new Date().toISOString();
            filled++;
          }
        }
        if (i < targets.length - 1) await sleep(300);
      }
      afterDataChange();
      await persist();
      toast(`Filled in info for ${filled} of ${targets.length} game${targets.length === 1 ? "" : "s"}`);
    } finally {
      if (btn) btn.disabled = false;
      updateSteamBackfillRawgButton();
    }
  }

  function updateSteamBackfillRawgButton() {
    const btn = $("#steamBackfillRawgBtn");
    const hint = $("#steamBackfillRawgHint");
    if (!btn) return;
    const count = steamGamesNeedingRawgInfo().length;
    btn.hidden = !count;
    hint.hidden = !count;
    if (count) btn.textContent = `🎮 Backfill game info from RAWG (${count})`;
  }

  // A quiet periodic check, paced by Settings → Media → "Check
  // automatically" (days between checks; 0 = never runs). Only counts how
  // many wishlist games aren't in the backlog/Journal yet and toasts that
  // count — never opens the review picker or adds anything on its own, and
  // never fetches titles (that's the slow part, only worth it once you
  // actually choose to sync). Failures are silent since this runs
  // unattended on every app open; a real problem still surfaces the next
  // time the user taps Sync Steam Wishlist manually.
  async function maybeAutoCheckSteamWishlist() {
    const cfg = state.data.settings.steam || DEFAULT_SETTINGS.steam;
    const days = parseInt(cfg.autoSyncDays, 10) || 0;
    if (!days) return;
    const proxyUrl = (cfg.proxyUrl || "").trim().replace(/\/+$/, "");
    const steamId = (cfg.steamId || "").trim();
    if (!proxyUrl || !steamId) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(STEAM_SYNC_KEY)); } catch (e) {}
    const lastAt = (last && last.lastCheckedAt) ? new Date(last.lastCheckedAt).getTime() : 0;
    if (Date.now() - lastAt < days * 24 * 60 * 60 * 1000) return;
    try {
      const res = await fetch(`${proxyUrl}/steam-wishlist/${encodeURIComponent(steamId)}`);
      if (res.ok) {
        const data = await res.json();
        const items = (data && data.response && data.response.items) || [];
        const existingSteamIds = new Set(
          [...state.data.backlog, ...state.data.entries]
            .filter((x) => x.mediaSource === "steam" && x.mediaId)
            .map((x) => x.mediaId)
        );
        const newCount = items.filter((it) => !existingSteamIds.has(String(it.appid))).length;
        if (newCount > 0) {
          toast(`🎮 ${newCount} new Steam wishlist game${newCount === 1 ? "" : "s"} — Settings → Media to sync`);
        }
      }
    } catch (e) {
      // quiet — this is an unattended background check, not a user action
    } finally {
      try { localStorage.setItem(STEAM_SYNC_KEY, JSON.stringify({ lastCheckedAt: new Date().toISOString() })); } catch (e) {}
    }
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
        monthly.push({ date: `${currentYear}-${String(m + 1).padStart(2, "0")}-01`, amount, category, note });
      }
      if (label && !reservedLabels.has(label)) {
        const amount = parseMoneyCell(row[36]);
        if (amount) yearly.push({ date: currentYear, amount, category: "Other", note: label, yearly: true });
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
        const rows = [["Date", "Amount", "Category", "Note", "Yearly"]];
        selected.map((i) => i.entry).sort((a, b) => b.date.localeCompare(a.date)).forEach((f) =>
          rows.push([f.date, f.amount, f.category, f.note || "", f.yearly ? "yes" : ""]));
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
      row.appendChild(el("span", "famount fnegative", formatMoney(e.amount)));
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
  function openImportPicker({ title, hint, mode, items, newCategories, confirmLabel, onConfirm, searchable }) {
    items = items.slice().sort((a, b) => importItemDateStr(b).localeCompare(importItemDateStr(a)));
    newCategories = newCategories || [];
    $("#financePickerTitle").textContent = title;
    $("#financePickerHint").textContent = hint;
    $("#financePickerConfirmBtn").textContent = confirmLabel;
    const dupRow = $("#financePickerDupRow");
    const showDupCb = $("#financePickerShowDup");
    dupRow.hidden = mode !== "import" || !items.some((i) => i.dup);
    showDupCb.checked = false;
    const unresolvedRow = $("#financePickerUnresolvedRow");
    const hideUnresolvedCb = $("#financePickerHideUnresolved");
    const unresolvedCount = items.filter((i) => i.unresolved).length;
    unresolvedRow.hidden = mode !== "import" || !unresolvedCount;
    hideUnresolvedCb.checked = false;
    $("#financePickerUnresolvedCount").textContent = unresolvedCount ? `(${unresolvedCount})` : "";
    const searchInput = $("#financePickerSearch");
    searchInput.hidden = !searchable;
    searchInput.value = "";
    let searchTerm = "";
    const list = $("#financePickerList");
    const bucketsWrap = $("#financePickerBuckets");
    const newCatsWrap = $("#financePickerNewCats");
    const newCatsList = $("#financePickerNewCatsList");

    newCatsWrap.hidden = !newCategories.length;
    $("#financePickerNewCatsEyebrow").textContent =
      `${newCategories.length} new categor${newCategories.length === 1 ? "y" : "ies"} found — pick which ones to add`;
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

    function matchesSearch(i) {
      if (!searchTerm) return true;
      const e = i.entry;
      const hay = [e.note, e.category, String(e.amount)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(searchTerm);
    }
    function visibleItems() {
      return items.filter((i) =>
        (!i.dup || showDupCb.checked) &&
        (!i.unresolved || !hideUnresolvedCb.checked) &&
        matchesSearch(i)
      );
    }
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
    hideUnresolvedCb.onchange = () => {
      // Hiding also deselects — otherwise a checked-but-hidden item would
      // still get imported despite looking "off" in the visible count.
      if (hideUnresolvedCb.checked) items.forEach((i) => { if (i.unresolved) i.checked = false; });
      render();
    };
    searchInput.oninput = () => { searchTerm = searchInput.value.trim().toLowerCase(); render(); };
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
  // Deterministic per-item timestamp backfill for legacy data saved before
  // updatedAt existed — falls back to createdAt (or, failing that, the
  // epoch, so it's always "older than any real edit"). Must stay
  // deterministic: two devices normalizing the same legacy document need to
  // compute the identical value, or a routine reload would manufacture a
  // spurious sync conflict on data that hasn't actually diverged.
  function backfillUpdatedAt(item) {
    return item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z";
  }
  function sanitizeEntry(e) {
    const out = {
      id: e.id || uid(),
      title: e.title || "",
      category: e.category || "Other",
      year: +e.year,
      month: +e.month,
      date: e.date || `${e.year}-${String(e.month).padStart(2, "0")}`,
      createdAt: e.createdAt || null,
      updatedAt: backfillUpdatedAt(e),
    };
    if (e.rating) out.rating = +e.rating;
    if (e.notes) out.notes = e.notes;
    if (e.coverUrl) out.coverUrl = e.coverUrl;
    if (e.mediaId) out.mediaId = e.mediaId;
    if (e.mediaSource) out.mediaSource = e.mediaSource;
    if (e.length) out.length = e.length;
    return out;
  }
  function sanitizeBacklog(b) {
    const out = {
      id: b.id || uid(),
      title: b.title || "",
      category: b.category || "Other",
      createdAt: b.createdAt || null,
      updatedAt: backfillUpdatedAt(b),
    };
    if (b.notes) out.notes = b.notes;
    if (b.coverUrl) out.coverUrl = b.coverUrl;
    if (b.mediaId) out.mediaId = b.mediaId;
    if (b.mediaSource) out.mediaSource = b.mediaSource;
    if (b.summary) out.summary = b.summary;
    if (b.releaseYear) out.releaseYear = b.releaseYear;
    if (b.externalRating) out.externalRating = b.externalRating;
    if (b.length) out.length = b.length;
    if (b.priority) out.priority = +b.priority;
    if (b.dropped) out.dropped = true;
    return out;
  }
  function sanitizeFinanceEntry(f) {
    const out = {
      id: f.id || uid(),
      date: f.date || "",
      amount: Math.abs(+f.amount) || 0,
      category: f.category || "Other",
      createdAt: f.createdAt || null,
      updatedAt: backfillUpdatedAt(f),
    };
    if (f.yearly) {
      out.yearly = true;
      out.date = String(out.date).slice(0, 4);
    }
    if (f.note) out.note = f.note;
    return out;
  }
  const financeKey = (f) => `${(f.date || "").toLowerCase()}|${+f.amount}|${(f.category || "").toLowerCase()}|${(f.note || "").toLowerCase()}|${f.yearly ? 1 : 0}`;
  function sanitizeRecurring(r) {
    const out = {
      id: r.id || uid(),
      startDate: r.startDate || "",
      interval: ["weekly", "monthly", "yearly"].includes(r.interval) ? r.interval : "monthly",
      amount: Math.abs(+r.amount) || 0,
      category: r.category || "Other",
      createdAt: r.createdAt || null,
      updatedAt: backfillUpdatedAt(r),
    };
    if (r.note) out.note = r.note;
    if (r.endDate) out.endDate = r.endDate;
    if (r.overrides && typeof r.overrides === "object") {
      const overrides = {};
      for (const [date, ov] of Object.entries(r.overrides)) {
        if (!ov || typeof ov !== "object") continue;
        const clean = {};
        if (ov.amount != null) clean.amount = Math.abs(+ov.amount) || 0;
        if (ov.note != null) clean.note = String(ov.note);
        if (Object.keys(clean).length) overrides[date] = clean;
      }
      if (Object.keys(overrides).length) out.overrides = overrides;
    }
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
      categories.push({ id: item.category.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: item.category, color: palette[pi++ % palette.length], updatedAt: backfillUpdatedAt({}) });
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
    // One-time migration: media enrichment used to have a separate on/off
    // toggle, stored here; it's gone now (per-category source assignments
    // below are the only on/off switch — "None" disables a category).
    if (state.media.enabled !== undefined) delete state.media.enabled;
    let mediaCategorySources = incomingSettings.mediaCategorySources;
    if (mediaCategorySources === undefined) mediaCategorySources = state.media.categorySources || {};
    if (state.media.categorySources !== undefined) {
      delete state.media.categorySources;
      saveMediaSettings();
    }
    const mediaCategoryFallbackSources = incomingSettings.mediaCategoryFallbackSources || {};
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
      mediaCategoryFallbackSources,
      mediaKeys,
      steam: { ...DEFAULT_SETTINGS.steam, ...(incomingSettings.steam || {}) },
    };
    const accIn = data.accomplishments || {};
    data.accomplishments = {};
    for (const y of Object.keys(accIn)) {
      data.accomplishments[y] = (accIn[y] || []).map((a) => {
        // Legacy accomplishments (or a plain string, the oldest shape) have
        // no id — synthesize one deterministically from year+text (the same
        // identity key mergeAccomplishments already uses for dedup) so two
        // devices normalizing the same legacy data agree on it, instead of
        // each minting a random one that would look like two different items.
        if (typeof a === "string") {
          return { id: "a-" + y + "-" + a.toLowerCase().replace(/[^a-z0-9]+/g, "-"), text: a, createdAt: null, updatedAt: "1970-01-01T00:00:00.000Z" };
        }
        const id = a.id || ("a-" + y + "-" + (a.text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
        const out = { id, text: a.text || "", createdAt: a.createdAt || null, updatedAt: backfillUpdatedAt(a) };
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
    applyTheme();
    applyForceLayout();
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

  function applyTheme() {
    const s = state.visual || DEFAULT_VISUAL;
    THEMES.forEach((t) => document.documentElement.classList.toggle("theme-" + t, s.theme === t));
  }

  // Forces the mobile/desktop layout regardless of actual screen size.
  // html.force-mobile/.force-pc directly toggle the matching CSS rules in
  // styles.css (works on any browser engine). The viewport meta is also
  // updated as a "Request desktop site"-style aid: real mobile browsers
  // honor its width and auto-zoom the page to fit, which desktop browsers
  // ignore — hence needing the class switch to cover that direction too.
  function applyForceLayout() {
    const s = state.visual || DEFAULT_VISUAL;
    document.documentElement.classList.toggle("force-mobile", s.forceLayout === "mobile");
    document.documentElement.classList.toggle("force-pc", s.forceLayout === "pc");
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    if (s.forceLayout === "mobile") meta.content = "width=400, initial-scale=1.0";
    else if (s.forceLayout === "pc") meta.content = "width=1280, initial-scale=1.0";
    else meta.content = "width=device-width, initial-scale=1.0";
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
    const setTopbarH = () => document.documentElement.style.setProperty("--topbar-h", topbar.getBoundingClientRect().height + "px");
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
      setBulkItem(cb.dataset.bulkId, dragPaint.value, { skipRender: true });
    });
    const endDragPaint = () => { if (dragPaint) { dragPaint = null; render(); } };
    document.addEventListener("pointerup", endDragPaint);
    document.addEventListener("pointercancel", endDragPaint);
    document.querySelectorAll(".tab").forEach((t) =>
      t.onclick = (e) => {
        e.stopPropagation();
        state.view = t.dataset.view;
        state.bulk.active = false;
        state.bulk.selected.clear();
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
    });
    document.addEventListener("click", closeAddMenu);

    wireCategorySelect("#fCategory", "#entryModal", false);
    wireCategorySelect("#bCategory", "#backlogModal", false);
    wireCategorySelect("#finCategory", "#financeModal", true);
    wireCategorySelect("#recCategory", "#recurringModal", true);

    $("#cancelEntryBtn").onclick = closeEntryModal;
    $("#entryForm").onsubmit = saveEntryFromForm;
    $("#deleteEntryBtn").onclick = deleteCurrentEntry;
    $("#moveToBacklogBtn").onclick = moveEntryToBacklog;
    $("#fTitle").oninput = renderTitleSuggestions;
    $("#fCategory").onchange = () => updateSyncBtnVisibility("f", $("#fCategory").value);
    $("#fSyncBtn").onclick = syncEntryTitle;
    $("#fUnsyncBtn").onclick = unsyncEntry;
    $("#fBacklogUnlinkBtn").onclick = () => { $("#entryFromBacklog").value = ""; updateBacklogLinkBanner(); };
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

    $("#cancelCatBtn").onclick = cancelCategoryModal;
    $("#catForm").onsubmit = saveCategoryFromForm;
    $("#deleteCatBtn").onclick = deleteCurrentCategory;

    $("#cancelFinanceBtn").onclick = closeFinanceModal;
    $("#financeForm").onsubmit = saveFinanceFromForm;
    $("#deleteFinanceBtn").onclick = deleteCurrentFinanceEntry;
    $("#finYearly").onchange = applyFinanceYearlyUI;

    $("#cancelRecurringBtn").onclick = closeRecurringModal;
    $("#recurringForm").onsubmit = saveRecurringFromForm;
    $("#deleteRecurringBtn").onclick = deleteCurrentRecurring;
    $("#linkPastExpensesBtn").onclick = () => {
      const rec = state.data.recurringExpenses.find((x) => x.id === $("#recId").value);
      if (rec) openLinkPastExpensesPicker(rec);
    };
    $("#cancelRecOccBtn").onclick = closeRecurringOccModal;
    $("#recurringOccForm").onsubmit = saveRecurringOccFromForm;
    $("#resetRecOccBtn").onclick = resetRecurringOcc;
    $("#editRecTemplateBtn").onclick = () => {
      const rec = state.data.recurringExpenses.find((x) => x.id === $("#recOccRecId").value);
      closeRecurringOccModal();
      if (rec) openRecurringModal(rec);
    };

    $("#cancelFinanceCatBtn").onclick = cancelFinanceCatModal;
    $("#financeCatForm").onsubmit = saveFinanceCatFromForm;
    $("#deleteFinanceCatBtn").onclick = deleteCurrentFinanceCategory;

    $("#cancelBacklogBtn").onclick = closeBacklogModal;
    $("#backlogForm").onsubmit = saveBacklogFromForm;
    $("#deleteBacklogBtn").onclick = deleteCurrentBacklogItem;
    $("#toggleDroppedBtn").onclick = toggleDropped;
    $("#bPriorityBtn").onclick = togglePriority;
    $("#bTitle").oninput = renderBacklogTitleSuggestions;
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
    $("#themeSelect").onchange = onThemeChange;
    $("#forceLayout").onchange = onForceLayoutChange;
    $("#timelineCoverSize").onchange = onTimelineCoverSizeChange;
    $("#backlogCoverSize").onchange = onBacklogCoverSizeChange;
    $("#currency").onchange = async () => {
      state.data.settings.currency = $("#currency").value;
      render();
      await persist();
    };
    const setMediaKey = async (field, value) => {
      if (!state.data.settings.mediaKeys) state.data.settings.mediaKeys = { ...DEFAULT_SETTINGS.mediaKeys };
      state.data.settings.mediaKeys[field] = value;
      await persist();
    };
    $("#rawgKey").oninput = () => setMediaKey("rawg", $("#rawgKey").value);
    $("#tmdbKey").oninput = () => setMediaKey("tmdb", $("#tmdbKey").value);
    $("#ggdealsKey").oninput = () => setMediaKey("ggdeals", $("#ggdealsKey").value);

    const setSteamSetting = async (field, value) => {
      if (!state.data.settings.steam) state.data.settings.steam = { ...DEFAULT_SETTINGS.steam };
      state.data.settings.steam[field] = value;
      await persist();
    };
    $("#steamProxyUrl").oninput = () => setSteamSetting("proxyUrl", $("#steamProxyUrl").value.trim());
    $("#steamId64").oninput = () => setSteamSetting("steamId", $("#steamId64").value.trim());
    $("#steamWishlistCategory").onchange = () => setSteamSetting("wishlistCategory", $("#steamWishlistCategory").value);
    $("#steamAutoSyncDays").onchange = () => setSteamSetting("autoSyncDays", $("#steamAutoSyncDays").value);
    $("#steamWishlistSyncBtn").onclick = syncSteamWishlist;
    $("#steamRetryUnresolvedBtn").onclick = retryUnresolvedSteamTitles;
    $("#steamBackfillRawgBtn").onclick = backfillRawgForSteamGames;

    $("#privacyEnabled").onchange = () => {
      const checked = $("#privacyEnabled").checked;
      if (checked && !state.privacy.pinHash) {
        toast("Set a PIN first", true);
        $("#privacyEnabled").checked = false;
        return;
      }
      state.privacy.enabled = checked;
      savePrivacySettings();
    };
    $("#privacyGrace").onchange = () => {
      state.privacy.graceMinutes = parseInt($("#privacyGrace").value, 10) || 0;
      savePrivacySettings();
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
      savePrivacySettings();
      hidePinForm();
      refreshPrivacyUI();
      toast("PIN set");
    };
    $("#removePinBtn").onclick = () => {
      const alsoBio = !!state.privacy.credentialId;
      const msg = alsoBio
        ? "Remove the PIN from this device? Fingerprint/Face ID requires a PIN fallback, so this will remove that too."
        : "Remove the PIN from this device?";
      if (!confirm(msg)) return;
      state.privacy.pinHash = null; state.privacy.pinSalt = null;
      if (alsoBio) state.privacy.credentialId = null;
      state.privacy.enabled = false;
      savePrivacySettings();
      refreshPrivacyUI();
    };
    $("#setBioBtn").onclick = async () => {
      if (!state.privacy.pinHash) { toast("Set a PIN first", true); return; }
      try {
        state.privacy.credentialId = await registerBiometric();
        savePrivacySettings();
        refreshPrivacyUI();
        toast("Fingerprint/Face ID set up");
      } catch (e) { toast("Couldn't set up: " + (e.message || e), true); }
    };
    $("#removeBioBtn").onclick = () => {
      if (!confirm("Remove Fingerprint/Face ID from this device?")) return;
      state.privacy.credentialId = null;
      savePrivacySettings();
      refreshPrivacyUI();
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
      ov.addEventListener("click", (e) => {
        if (e.target !== ov) return;
        if (ov.id === "catModal") cancelCategoryModal();
        else if (ov.id === "financeCatModal") cancelFinanceCatModal();
        else ov.hidden = true;
      });
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
        closeEntryModal(); closeAchModal(); cancelCategoryModal(); closeBacklogModal();
        closeFinanceModal(); cancelFinanceCatModal(); closeSettings();
        $("#addMenu").hidden = true;
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
      const box = screen.querySelector(".lock-box");
      const form = $("#lockPinForm");
      const input = $("#lockPinInput");
      const dots = $("#lockPinDots");
      const keypad = $("#lockKeypad");
      const divider = $("#lockDivider");
      const bioBtn = $("#lockBioBtn");
      const errorEl = $("#lockError");
      const resetBtn = $("#lockResetBtn");
      const hasPin = !!state.privacy.pinHash;
      const hasBio = !!state.privacy.credentialId;

      screen.hidden = false;
      document.body.style.overflow = "hidden";
      form.hidden = !hasPin;
      bioBtn.hidden = !hasBio;
      divider.hidden = !(hasPin && hasBio);
      errorEl.hidden = true;
      $("#lockHint").textContent = hasPin && hasBio
        ? "Enter your PIN or use fingerprint/Face ID to continue."
        : hasBio
        ? "Use your device's fingerprint or Face ID to continue."
        : "Enter your PIN to continue.";
      if (hasPin) setTimeout(() => input.focus(), 50);

      // On-screen keypad mirrors the PIN into `input` (still typable directly
      // too, e.g. with a physical keyboard) — dots show progress without
      // revealing the digits. A matching PIN unlocks immediately, without
      // needing to also press Unlock/Enter.
      function renderDots() {
        const len = input.value.length;
        const count = Math.max(4, len); // grows past 4 for longer PINs
        dots.innerHTML = "";
        for (let i = 0; i < count; i++) dots.appendChild(el("span", i < len ? "filled" : null));
      }
      async function onPinChanged() {
        renderDots();
        if (!input.value) return;
        const hash = await hashPin(input.value, state.privacy.pinSalt);
        if (hash === state.privacy.pinHash) unlocked();
      }
      renderDots();
      input.addEventListener("input", onPinChanged);
      keypad.onclick = (e) => {
        const btn = e.target.closest("button[data-key]");
        if (!btn) return;
        const k = btn.dataset.key;
        if (k === "del") input.value = input.value.slice(0, -1);
        else if (input.value.length < 8) input.value += k;
        onPinChanged();
      };

      function showError(msg) {
        errorEl.textContent = msg;
        errorEl.hidden = false;
        box.classList.remove("shake");
        void box.offsetWidth; // force reflow so the shake replays each time
        box.classList.add("shake");
      }
      function cleanup() {
        screen.hidden = true;
        document.body.style.overflow = "";
        form.onsubmit = null;
        bioBtn.onclick = null;
        resetBtn.onclick = null;
        keypad.onclick = null;
        input.removeEventListener("input", onPinChanged);
        box.classList.remove("shake");
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
        renderDots();
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
      // Auto-prompt biometrics on open when available — the PIN form (if also
      // set up) stays visible underneath as a fallback if it's cancelled/fails.
      if (hasBio) bioBtn.onclick();
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
      // "merged" only happens after successfully reaching a remote
      // candidate (GitHub, when connected) to merge against.
      githubReached = source === "github" || (source === "merged" && Storage.githubConnected);
    }
    afterDataChange();
    lastPersistedSnapshot = structuredClone(state.data);
    if (savedUi?.scrollY) setTimeout(() => window.scrollTo(0, savedUi.scrollY), 0);

    refreshStorageStatus();

    if (setupMsg) toast(setupMsg, setupErr);
    else if (source === "seed") toast("Loaded " + state.data.entries.length + " entries from your sheet");
    else if (source === "merged") toast("Merged changes from your other device");
    else if (Storage.githubConnected && !githubReached) {
      toast("Offline — showing last saved copy; will sync when GitHub is reachable", true);
    }

    if (state.pendingSync) retrySync();
    schedulePoll();
    maybeAutoCheckSteamWishlist(); // fire-and-forget, doesn't block startup

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  init();
})();
