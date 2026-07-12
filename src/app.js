// LifeLog — main app logic (vanilla JS, no build step).
(function () {
  const Storage = window.LifeLogStorage;
  const Finance = window.LifeLogFinance;
  const SettingsUI = window.LifeLogSettings;
  const Backlog = window.LifeLogBacklog;
  const Journal = window.LifeLogJournal;
  const IO = window.LifeLogIO;
  const Sync = window.LifeLogSync;
  const MONTHS = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const DEFAULT_SETTINGS = { monthOrder: "asc", currency: "ILS", mediaCategorySources: {}, mediaCategoryFallbackSources: {}, mediaKeys: { rawg: "", tmdb: "", ggdeals: "", steamgriddb: "" }, steam: { proxyUrl: "", steamId: "", wishlistCategory: "", autoSyncDays: "0" }, anilist: { userName: "", animeCategory: "", mangaCategory: "", autoSyncDays: "0" } }; // monthOrder, currency, mediaCategorySources, mediaCategoryFallbackSources, mediaKeys, steam, anilist — synced
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
  const DEFAULT_MEDIA = {}; // legacy local-only shape; rawgKey/tmdbKey migrated into synced settings on load (see normalize())
  const MEDIA_SOURCE_LABELS = {
    rawg: "RAWG", steamgriddb: "SteamGridDB", "tmdb-movie": "TMDB", "tmdb-tv": "TMDB",
    "anilist-anime": "AniList", "anilist-manga": "AniList",
    "jikan-anime": "Jikan", "jikan-manga": "Jikan",
    openlibrary: "Open Library", googlebooks: "Google Books", musicbrainz: "MusicBrainz",
    steam: "Steam",
  };
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
  const APP_VERSION = "0.76.1"; // bump with each shipped change so it's visible in Settings

  const CATEGORY_PALETTE = ["#e23b3b", "#e2723b", "#e2b23b", "#9fe23b", "#3be25a", "#3bb2e2", "#5b8cff", "#723be2", "#b23be2", "#e23b72", "#7a8a99"];

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
      financeCategories: Finance.seedFinanceCategories(), financeEntries: [], recurringExpenses: [],
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
      if (state.view === "backlog") { Backlog.renderBacklog(c); return; }
      if (state.view === "finance") { Finance.renderFinanceEntries(c); return; }
      if (state.view === "finance-stats") { Finance.renderFinanceStats(c); return; }
      const entries = getFiltered();
      if (!state.data.entries.length) {
        c.appendChild(emptyState({
          glyph: "☰",
          title: "Nothing logged yet",
          body: "Log the things you experience — a game you finished, a book you read, a trip you took. They'll stack up here by year and month.",
          action: "Add your first entry",
          onAction: () => Journal.openEntryModal(null),
          hint: "Tip: you can also import an existing lifelog.json from Settings → Import / Export.",
        }));
        return;
      }
      if (!entries.length) {
        c.appendChild(emptyState("No entries match your filters."));
        return;
      }
      if (state.view === "timeline") Journal.renderTimeline(c, entries);
      else Journal.renderStats(c, entries);
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

  // The actual page for a synced item, so the cover overlay can link out to
  // it — returns "" for anything not derivable (no mediaId, or a source
  // this doesn't know), so the caller can skip showing a button rather
  // than link to a URL that doesn't exist.
  function mediaPageUrl(mediaSource, mediaId) {
    if (!mediaSource || !mediaId) return "";
    const enc = encodeURIComponent(mediaId);
    switch (mediaSource) {
      case "steam": return `https://store.steampowered.com/app/${enc}`;
      case "rawg": return `https://rawg.io/games/${enc}`;
      case "steamgriddb": return `https://www.steamgriddb.com/game/${enc}`;
      case "tmdb-movie": return `https://www.themoviedb.org/movie/${enc}`;
      case "tmdb-tv": return `https://www.themoviedb.org/tv/${enc}`;
      case "anilist-anime": return `https://anilist.co/anime/${enc}`;
      case "anilist-manga": return `https://anilist.co/manga/${enc}`;
      case "jikan-anime": return `https://myanimelist.net/anime/${enc}`;
      case "jikan-manga": return `https://myanimelist.net/manga/${enc}`;
      case "openlibrary": return `https://openlibrary.org${mediaId.startsWith("/") ? "" : "/"}${mediaId}`;
      case "googlebooks": return `https://books.google.com/books?id=${enc}`;
      case "musicbrainz": return `https://musicbrainz.org/release-group/${enc}`;
      default: return "";
    }
  }

  // Cover-overlay quick links (bottom-right of the image) for a synced
  // item: one to the source's own page (Steam, RAWG, TMDB, etc.), and —
  // only for Steam-sourced items, only once resolved — one to GG.deals.
  // Each only ever appears once an actual URL is known; nothing renders
  // for an item with no connection or a source this can't link out to.
  function renderCoverLinkButtons(container, mediaSource, mediaId) {
    if (!container) return;
    container.innerHTML = "";
    if (!mediaSource || !mediaId) return;
    const addLink = (label, url) => {
      if (!url) return;
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.className = "cover-link-btn";
      a.textContent = label;
      a.onclick = (ev) => ev.stopPropagation();
      container.appendChild(a);
    };
    addLink(MEDIA_SOURCE_LABELS[mediaSource] || mediaSource, mediaPageUrl(mediaSource, mediaId));
    if (mediaSource === "steam") {
      if (Sync.hasPriceCached(mediaId)) {
        addLink("GG.deals", Sync.ggDealsPageUrl(mediaId));
      } else {
        Sync.loadBacklogPrices([{ mediaSource, mediaId }]).then(() => addLink("GG.deals", Sync.ggDealsPageUrl(mediaId)));
      }
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
    const ys = finance ? Finance.financeYears() : years();
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
      edit.onclick = (ev) => { ev.stopPropagation(); finance ? Finance.openFinanceCatModal(c) : Journal.openCategoryModal(c); };
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
      finance ? Finance.openFinanceCatModal(null) : Journal.openCategoryModal(null);
    };
    wrap.appendChild(addChip);
  }

  // Clicking the "Years"/"Categories" label selects all chips; clicking again
  // when everything is already selected deselects all.
  function toggleAllYears() {
    const finance = isFinanceView();
    const ys = finance ? Finance.financeYears() : years();
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
      finance ? Finance.openFinanceCatModal(null) : Journal.openCategoryModal(null);
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
    data.entries = (data.entries || []).map(Journal.sanitizeEntry);
    data.backlog = (data.backlog || []).map(Backlog.sanitizeBacklog);
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
      anilist: { ...DEFAULT_SETTINGS.anilist, ...(incomingSettings.anilist || {}) },
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

    if (data.financeCategories === undefined) data.financeCategories = Finance.seedFinanceCategories();
    data.financeEntries = (data.financeEntries || []).map(Finance.sanitizeFinanceEntry);
    data.recurringExpenses = (data.recurringExpenses || []).map(Finance.sanitizeRecurring);
    ensureCategories(data.financeCategories, [...data.financeEntries, ...data.recurringExpenses]);

    return data;
  }

  function afterDataChange() {
    rebuildColorMap();
    Finance.rebuildFinanceColorMap();
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
    // Debounced — render() rebuilds the whole current view from scratch, so
    // re-running it on every keystroke gets noticeably laggy once there are
    // a few hundred entries. 200ms feels instant while typing but collapses
    // a fast burst of keystrokes into a single render.
    let searchRenderTimer;
    $("#search").oninput = (e) => {
      state.search = e.target.value;
      clearTimeout(searchRenderTimer);
      searchRenderTimer = setTimeout(render, 200);
    };
    $("#yearFilterLabel").onclick = toggleAllYears;
    $("#catFilterLabel").onclick = toggleAllCats;

    const addMenu = $("#addMenu");
    const closeAddMenu = () => { addMenu.hidden = true; };
    $("#addBtn").onclick = (e) => { e.stopPropagation(); addMenu.hidden = !addMenu.hidden; };
    addMenu.querySelectorAll("button").forEach((b) => b.onclick = () => {
      closeAddMenu();
      if (b.dataset.add === "entry") Journal.openEntryModal(null);
      else if (b.dataset.add === "achievement") Journal.openAchModal(null);
      else if (b.dataset.add === "backlog") Backlog.openBacklogModal(null);
      else if (b.dataset.add === "finance") Finance.openFinanceModal(null);
      else if (b.dataset.add === "recurring") Finance.openRecurringModal(null);
    });
    document.addEventListener("click", closeAddMenu);

    wireCategorySelect("#fCategory", "#entryModal", false);

    Journal.wire(); // timeline entry modal, achievements, category management
    Finance.wire(); // finance/recurring/finance-category modals + finance import/export
    Backlog.wire(); // backlog modal: sync, priority/dropped, title suggestions
    SettingsUI.wire(); // the Settings modal: tabs, data/storage, appearance, media, privacy

    $("#exportJsonBtn").onclick = IO.exportJson;
    $("#importJsonBtn").onclick = () => $("#importJsonInput").click();
    $("#importJsonInput").onchange = (e) => { if (e.target.files[0]) IO.importJsonAll(e.target.files[0]); e.target.value = ""; };

    $("#exportJournalJsonBtn").onclick = IO.exportJournalJson;
    $("#exportJournalCsvBtn").onclick = IO.exportJournalCsv;
    $("#importJournalJsonBtn").onclick = () => $("#importJournalJsonInput").click();
    $("#importJournalJsonInput").onchange = (e) => { if (e.target.files[0]) IO.importJournalJson(e.target.files[0]); e.target.value = ""; };
    $("#importJournalCsvBtn").onclick = () => $("#importJournalCsvInput").click();
    $("#importJournalCsvInput").onchange = (e) => { if (e.target.files[0]) IO.importJournalCsv(e.target.files[0]); e.target.value = ""; };


    // close modals on overlay click / Escape (the conflict picker is modal —
    // it must be resolved via its buttons, not dismissed)
    document.querySelectorAll(".modal-overlay").forEach((ov) => {
      if (ov.id === "conflictModal") return;
      ov.addEventListener("click", (e) => {
        if (e.target !== ov) return;
        if (ov.id === "catModal") Journal.cancelCategoryModal();
        else if (ov.id === "financeCatModal") Finance.cancelFinanceCatModal();
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
        Journal.closeEntryModal(); Journal.closeAchModal(); Journal.cancelCategoryModal(); Backlog.closeBacklogModal();
        Finance.closeFinanceModal(); Finance.cancelFinanceCatModal(); SettingsUI.closeSettings();
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
    Sync.maybeAutoCheckSteamWishlist(); // fire-and-forget, doesn't block startup
    Sync.maybeAutoCheckAniList(); // same — quiet background check, never blocks startup

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  // Hand each extracted module the shared app plumbing it renders/saves
  // through. Must run before init() — normalize() and the views call into
  // Finance, and wire() calls into SettingsUI. IO and Sync go first since
  // Sync's Steam/AniList flows call back into IO's
  // buildImportItems/reviewAndImport, and both need the cross-module
  // sanitizers/cover setters the other view modules expose.
  IO.init({
    state, $, el, toast, persist, afterDataChange, ensureCategories,
    CATEGORY_PALETTE, MONTHS, MONTHS_SHORT, colorOf,
    financeColorOf: Finance.financeColorOf, formatMoney: Finance.formatMoney,
    financeKey: Finance.financeKey, recurringKey: Finance.recurringKey,
    sanitizeFinanceEntry: Finance.sanitizeFinanceEntry, sanitizeRecurring: Finance.sanitizeRecurring,
    sanitizeEntry: Journal.sanitizeEntry, sanitizeBacklog: Backlog.sanitizeBacklog,
  });
  Sync.init({
    state, $, toast, persist, afterDataChange, DEFAULT_SETTINGS,
    buildImportItems: IO.buildImportItems, reviewAndImport: IO.reviewAndImport,
    setBacklogCover: Backlog.setBacklogCover, setEntryCover: Journal.setEntryCover,
  });
  SettingsUI.init({
    state, $, el, toast, persist, render, normalize, afterDataChange,
    setSyncing, refreshStorageStatus, schedulePoll,
    saveVisualSettings, savePrivacySettings,
    applyMonthLayout, applyFont, applyTheme, applyForceLayout,
    prefersReducedMotion, biometricAvailable, hashPin, randomHex, registerBiometric,
    updateSteamRetryUnresolvedButton: Sync.updateSteamRetryUnresolvedButton,
    updateSteamBackfillRawgButton: Sync.updateSteamBackfillRawgButton,
    syncSteamWishlist: Sync.syncSteamWishlist,
    retryUnresolvedSteamTitles: Sync.retryUnresolvedSteamTitles,
    backfillRawgForSteamGames: Sync.backfillRawgForSteamGames,
    syncAniListPlanning: Sync.syncAniListPlanning,
    DEFAULT_SETTINGS,
  });
  Journal.init({
    state, $, el, uid, toast, persist, render, groupBy, countBy, colorOf,
    emptyCoverEl, monthCardHeader, bulkActionBar, bulkCheckbox, toggleBulkItem,
    attachLongPressSelect, animatedNumberText, barRow, fillSelect,
    fillCategorySelect, wireCategorySelect, resolvePendingCatSelect,
    rebuildColorMap, buildYearFilter, buildCatFilter, renderCoverLinkButtons,
    applySteamAppId: Sync.applySteamAppId, backfillUpdatedAt, MONTHS, MONTHS_SHORT, MEDIA_SOURCE_LABELS,
    DEFAULT_SETTINGS,
  });
  Backlog.init({
    state, $, el, uid, toast, persist, render, groupBy, colorOf,
    emptyState, emptyCoverEl, bulkActionBar, bulkCheckbox, toggleBulkItem,
    toggleBulkCategoryAll, attachLongPressSelect,
    openEntryModal: Journal.openEntryModal,
    fillCategorySelect, wireCategorySelect,
    titleSuggestions: Journal.titleSuggestions,
    backlogSuggestions: Journal.backlogSuggestions,
    makeMediaAcItem: Journal.makeMediaAcItem,
    fetchMediaSuggestions: Journal.fetchMediaSuggestions,
    resolveRawgSteamAppId: Journal.resolveRawgSteamAppId,
    updateSyncBtnVisibility: Journal.updateSyncBtnVisibility,
    showSyncStatus: Journal.showSyncStatus,
    renderCoverLinkButtons, loadBacklogPrices: Sync.loadBacklogPrices, applySteamAppId: Sync.applySteamAppId,
    backfillUpdatedAt, MONTHS_SHORT, DEFAULT_SETTINGS,
  });
  Finance.init({
    state, $, el, uid, groupBy, countBy, toast, persist, render,
    buildYearFilter, buildCatFilter, monthCardHeader, emptyState,
    bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
    animatedNumberText, barRow, fillCategorySelect, wireCategorySelect,
    resolvePendingCatSelect, download: IO.download, csvEsc: IO.csvEsc, parseCsv: IO.parseCsv,
    buildImportItems: IO.buildImportItems, reviewAndImport: IO.reviewAndImport, openImportPicker: IO.openImportPicker,
    backfillUpdatedAt, MONTHS,
  });
  init();
})();
