// LifeLog — main app logic (vanilla JS, no build step).
(function () {
  const Storage = window.LifeLogStorage;
  const Finance = window.LifeLogFinance;
  const SettingsUI = window.LifeLogSettings;
  const Backlog = window.LifeLogBacklog;
  const Journal = window.LifeLogJournal;
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
  // Local-only (per-device) — when this device last ran the quiet background
  // wishlist check, so the cadence in Settings isn't re-evaluated on every
  // app open. Deliberately not synced: each device paces its own checks.
  const STEAM_SYNC_KEY = "lifelog-steam-autosync-v1";
  // Same idea for the AniList Planning check — local-only, per-device, so each
  // device paces its own quiet background check independently of the others.
  const ANILIST_SYNC_KEY = "lifelog-anilist-autosync-v1";
  const DEFAULT_MEDIA = {}; // legacy local-only shape; rawgKey/tmdbKey migrated into synced settings on load (see normalize())
  const MEDIA_SOURCE_LABELS = {
    rawg: "RAWG", steamgriddb: "SteamGridDB", "tmdb-movie": "TMDB", "tmdb-tv": "TMDB",
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
  const APP_VERSION = "0.74.0"; // bump with each shipped change so it's visible in Settings

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

  // Builds the cover/media fields directly from a manually-entered Steam App
  // ID (see media.js — Steam's own search API is CORS-blocked from browsers).
  // Shared by the backlog and journal-entry modals; the backlog branch hands
  // its cover repaint back to backlog.js.
  function applySteamAppId(prefix) {
    const id = $("#" + prefix + "SteamAppId").value.trim();
    const coverUrl = id ? window.LifeLogMedia.steamCoverUrl(id) : "";
    if (prefix === "b") {
      $("#bCoverUrl").value = coverUrl;
      $("#bMediaId").value = id;
      $("#bMediaSource").value = id ? "steam" : "";
      $("#bReleaseYear").value = "";
      $("#bReleaseDate").value = "";
      $("#bExternalRating").value = "";
      $("#bSummary").value = "";
      $("#bLength").value = "";
      $("#bGenres").value = "";
      Backlog.setBacklogCover();
    } else {
      Journal.setEntryCover(coverUrl, id, id ? "steam" : "", "");
    }
  }

  // In-memory only (not persisted/synced) — prices change over time and are
  // cheap to re-fetch next session, so there's no need to store them.
  const priceCache = new Map();

  // Retail only — keyshops (third-party key resellers) deliberately excluded.
  function currentRetailPrice(p) {
    const v = p.currentRetail != null ? parseFloat(p.currentRetail) : null;
    return v != null && !isNaN(v) ? v : null;
  }

  function historicalLowRetailPrice(p) {
    const v = p.historicalRetail != null ? parseFloat(p.historicalRetail) : null;
    return v != null && !isNaN(v) ? v : null;
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
      const prices = cached.data.prices || {};
      const current = currentRetailPrice(prices);
      if (current == null) continue;
      const low = historicalLowRetailPrice(prices);
      // GG.deals gives current + historical-low retail, no discount % or
      // original price — this is the closest thing to "is it on sale"
      // derivable from that: at/near the all-time low reads as one, a
      // current price still above it shows what the low actually was.
      let text = "$" + current.toFixed(2);
      if (low != null) {
        text += current <= low + 0.01 ? " (all-time low)" : ` (low $${low.toFixed(2)})`;
      }
      document.querySelectorAll(`.bl-price[data-appid="${b.mediaId}"]`).forEach((elm) => {
        elm.textContent = (elm.dataset.sep ? " · " : "") + text;
      });
    }
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

  // GG.deals' price response may carry a link to the game's own page on
  // their site — the exact field name is unconfirmed (can't be tested
  // against the live API from here), so this checks a few plausible spots
  // and returns "" if none match, rather than guessing at a URL shape that
  // might 404.
  function ggDealsPageUrl(mediaId) {
    const cached = priceCache.get(mediaId);
    const d = cached && cached.data;
    return (d && (d.url || d.link || d.shop_url)) || "";
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
      const cached = priceCache.get(mediaId);
      if (cached) {
        addLink("GG.deals", ggDealsPageUrl(mediaId));
      } else {
        loadBacklogPrices([{ mediaSource, mediaId }]).then(() => addLink("GG.deals", ggDealsPageUrl(mediaId)));
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
    const existingFinanceKeys = new Set(state.data.financeEntries.map(Finance.financeKey));
    const existingRecurKeys = new Set(state.data.recurringExpenses.map(Finance.recurringKey));
    // A wishlisted game already logged as finished in the Journal (title
    // match, ignoring year/month/date since a backlog item has none of
    // those yet) is just as much a duplicate as one already sitting in
    // the backlog — same check the single-item add form already does
    // (updateBacklogDuplicateBanner) that bulk import was missing.
    const titleCatKey = (t, c) => `${(t || "").toLowerCase()}|${(c || "").toLowerCase()}`;
    const existingEntryTitleKeys = new Set(state.data.entries.map((e) => titleCatKey(e.title, e.category)));
    // A synced item's media source+id is a stronger identity than its title —
    // catches an imported item (Steam wishlist, AniList Planning) whose title
    // was edited locally after an earlier import, which a plain title/category
    // match would otherwise treat as new again. Keyed by "<source>:<id>" and
    // checked against both the backlog and the Journal, so it works uniformly
    // for every source, not just Steam.
    const existingMediaIds = new Set(
      [...state.data.backlog, ...state.data.entries]
        .filter((x) => x.mediaSource && x.mediaId)
        .map((x) => x.mediaSource + ":" + x.mediaId)
    );

    (entries || []).map(Journal.sanitizeEntry).forEach((e) => {
      const dup = existingEntryKeys.has(entryKey(e));
      items.push({ kind: "entry", entry: e, dup, checked: !dup });
    });
    (backlog || []).forEach((raw) => {
      const b = Backlog.sanitizeBacklog(raw);
      const dup = existingBacklogKeys.has(backlogKey(b)) ||
        existingEntryTitleKeys.has(titleCatKey(b.title, b.category)) ||
        (b.mediaSource && b.mediaId && existingMediaIds.has(b.mediaSource + ":" + b.mediaId));
      items.push({ kind: "backlog", entry: b, dup, checked: !dup, unresolved: !!raw.unresolved });
    });
    (financeEntries || []).map(Finance.sanitizeFinanceEntry).forEach((f) => {
      const dup = existingFinanceKeys.has(Finance.financeKey(f));
      items.push({ kind: "finance", entry: f, dup, checked: !dup });
    });
    (recurringExpenses || []).map(Finance.sanitizeRecurring).forEach((r) => {
      const dup = existingRecurKeys.has(Finance.recurringKey(r));
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
          ...(rawg?.releaseDate ? { releaseDate: rawg.releaseDate } : {}),
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

  // Pulls a public AniList user's Planning (plan-to-watch / plan-to-read)
  // list — anime and manga separately, each into its own chosen category, so
  // you can import one type, the other, or both. AniList sends CORS headers
  // and public lists need no auth, so unlike Steam there's no proxy or title
  // resolution step: one GraphQL request per type returns everything. The
  // result is routed through the same review picker as every other import —
  // dup-checked by title+category and by AniList media id (so a later local
  // rename doesn't make an item look new again), against both the backlog and
  // the Journal — and nothing is added until confirmed. Each item is tagged
  // mediaSource: "anilist-anime"/"anilist-manga" + mediaId, the same shape a
  // normal AniList sync produces, so cover art and the genre breakdown pick
  // it up with no extra work.
  async function syncAniListPlanning() {
    const cfg = state.data.settings.anilist || DEFAULT_SETTINGS.anilist;
    const userName = (cfg.userName || "").trim();
    const animeCategory = cfg.animeCategory || "";
    const mangaCategory = cfg.mangaCategory || "";
    if (!userName) { toast("Enter your AniList username first", true); return; }
    if (!animeCategory && !mangaCategory) { toast("Pick a category for anime and/or manga first", true); return; }
    if (!window.LifeLogMedia) return;
    const btn = $("#anilistSyncBtn");
    const label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
    try {
      // Only the types with a category chosen are fetched. Each fetch returns
      // null on a hard failure (network, private list, unknown user), which is
      // kept distinct from an empty-but-reachable list.
      let failed = false;
      const backlogItems = [];
      const pulls = [];
      if (animeCategory) pulls.push(["ANIME", animeCategory]);
      if (mangaCategory) pulls.push(["MANGA", mangaCategory]);
      for (const [type, category] of pulls) {
        const media = await window.LifeLogMedia.fetchAniListPlanning(userName, type);
        if (media === null) { failed = true; continue; }
        for (const m of media) {
          backlogItems.push({
            title: m.title || "",
            category,
            mediaSource: m.source,
            mediaId: m.id,
            coverUrl: m.coverUrl || "",
            unresolved: !m.title,
            ...(m.externalRating ? { externalRating: m.externalRating } : {}),
            ...(m.length ? { length: m.length } : {}),
            ...(m.year ? { releaseYear: m.year } : {}),
            ...(m.releaseDate ? { releaseDate: m.releaseDate } : {}),
            ...(m.genres && m.genres.length ? { genres: m.genres } : {}),
          });
        }
      }
      if (!backlogItems.length) {
        if (failed) {
          const err = window.LifeLogMedia.getLastError();
          toast(err ? "AniList sync failed — " + err : "AniList sync failed", true);
        } else {
          toast("Planning list came back empty — check the username, and that your list is public");
        }
        return;
      }
      const built = buildImportItems({ backlog: backlogItems, categories: [] });
      reviewAndImport(
        "AniList Planning",
        "Review which plan-to-watch/read titles to add to your backlog — anything already in your backlog or already logged is tagged and hidden by default.",
        built
      );
    } catch (e) {
      toast("AniList sync failed (" + ((e && e.message) || "network error") + ")", true);
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
          if (rawg.releaseDate) targets[i].releaseDate = rawg.releaseDate;
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

  // The AniList equivalent of maybeAutoCheckSteamWishlist, paced by Settings →
  // Media → AniList "Check automatically" (days between checks; 0 = never).
  // Fetches the Planning list(s) for whichever type(s) have a category chosen
  // and just counts how many titles aren't already in the backlog/Journal,
  // toasting that count — it never opens the review picker or adds anything on
  // its own. Uses the same source+id / title+category dedup the import does, so
  // an item renamed locally after an earlier import doesn't count as new again.
  // Cheaper than the Steam check (one GraphQL request per type, no per-item
  // title lookups), but still runs unattended, so failures stay silent.
  async function maybeAutoCheckAniList() {
    const cfg = state.data.settings.anilist || DEFAULT_SETTINGS.anilist;
    const days = parseInt(cfg.autoSyncDays, 10) || 0;
    if (!days) return;
    const userName = (cfg.userName || "").trim();
    const animeCategory = cfg.animeCategory || "";
    const mangaCategory = cfg.mangaCategory || "";
    if (!userName || (!animeCategory && !mangaCategory)) return;
    if (!window.LifeLogMedia) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(ANILIST_SYNC_KEY)); } catch (e) {}
    const lastAt = (last && last.lastCheckedAt) ? new Date(last.lastCheckedAt).getTime() : 0;
    if (Date.now() - lastAt < days * 24 * 60 * 60 * 1000) return;
    try {
      const existingMediaIds = new Set(
        [...state.data.backlog, ...state.data.entries]
          .filter((x) => x.mediaSource && x.mediaId)
          .map((x) => x.mediaSource + ":" + x.mediaId)
      );
      const titleCatKey = (t, c) => `${(t || "").toLowerCase()}|${(c || "").toLowerCase()}`;
      const existingTitleKeys = new Set(
        [...state.data.backlog, ...state.data.entries].map((x) => titleCatKey(x.title, x.category))
      );
      const pulls = [];
      if (animeCategory) pulls.push(["ANIME", animeCategory]);
      if (mangaCategory) pulls.push(["MANGA", mangaCategory]);
      let newCount = 0;
      for (const [type, category] of pulls) {
        const media = await window.LifeLogMedia.fetchAniListPlanning(userName, type);
        if (media === null) continue; // hard failure on this type — skip, stay quiet
        for (const m of media) {
          if (existingMediaIds.has(m.source + ":" + m.id)) continue;
          if (existingTitleKeys.has(titleCatKey(m.title, category))) continue;
          newCount++;
        }
      }
      if (newCount > 0) {
        toast(`📺 ${newCount} new AniList planning title${newCount === 1 ? "" : "s"} — Settings → Media to sync`);
      }
    } catch (e) {
      // quiet — this is an unattended background check, not a user action
    } finally {
      try { localStorage.setItem(ANILIST_SYNC_KEY, JSON.stringify({ lastCheckedAt: new Date().toISOString() })); } catch (e) {}
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
    bar.style.background = finance ? Finance.financeColorOf(e.category) : colorOf(e.category);
    row.appendChild(bar);
    if (item.kind === "finance") {
      row.appendChild(el("span", "fdate" + (e.yearly ? " fyearly" : ""), e.yearly ? `${e.date} · yearly` : e.date));
      const t = el("span", "etitle", e.note || e.category); t.title = e.note || e.category; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      row.appendChild(el("span", "famount fnegative", Finance.formatMoney(e.amount)));
    } else if (item.kind === "recurring") {
      row.appendChild(el("span", "fdate", e.startDate));
      row.appendChild(el("span", "recur-badge", "↻ " + e.interval));
      const t = el("span", "etitle", e.note || e.category); t.title = e.note || e.category; row.appendChild(t);
      row.appendChild(el("span", "ecat", e.category));
      row.appendChild(el("span", "famount fnegative", "-" + Finance.formatMoney(e.amount)));
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

    $("#exportJsonBtn").onclick = exportJson;
    $("#importJsonBtn").onclick = () => $("#importJsonInput").click();
    $("#importJsonInput").onchange = (e) => { if (e.target.files[0]) importJsonAll(e.target.files[0]); e.target.value = ""; };

    $("#exportJournalJsonBtn").onclick = exportJournalJson;
    $("#exportJournalCsvBtn").onclick = exportJournalCsv;
    $("#importJournalJsonBtn").onclick = () => $("#importJournalJsonInput").click();
    $("#importJournalJsonInput").onchange = (e) => { if (e.target.files[0]) importJournalJson(e.target.files[0]); e.target.value = ""; };
    $("#importJournalCsvBtn").onclick = () => $("#importJournalCsvInput").click();
    $("#importJournalCsvInput").onchange = (e) => { if (e.target.files[0]) importJournalCsv(e.target.files[0]); e.target.value = ""; };


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
    maybeAutoCheckSteamWishlist(); // fire-and-forget, doesn't block startup
    maybeAutoCheckAniList(); // same — quiet background check, never blocks startup

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  // Hand each extracted module the shared app plumbing it renders/saves
  // through. Must run before init() — normalize() and the views call into
  // Finance, and wire() calls into SettingsUI.
  SettingsUI.init({
    state, $, el, toast, persist, render, normalize, afterDataChange,
    setSyncing, refreshStorageStatus, schedulePoll,
    saveVisualSettings, savePrivacySettings,
    applyMonthLayout, applyFont, applyTheme, applyForceLayout,
    prefersReducedMotion, biometricAvailable, hashPin, randomHex, registerBiometric,
    updateSteamRetryUnresolvedButton, updateSteamBackfillRawgButton,
    syncSteamWishlist, retryUnresolvedSteamTitles, backfillRawgForSteamGames,
    syncAniListPlanning,
    DEFAULT_SETTINGS,
  });
  Journal.init({
    state, $, el, uid, toast, persist, render, groupBy, countBy, colorOf,
    emptyCoverEl, monthCardHeader, bulkActionBar, bulkCheckbox, toggleBulkItem,
    attachLongPressSelect, animatedNumberText, barRow, fillSelect,
    fillCategorySelect, wireCategorySelect, resolvePendingCatSelect,
    rebuildColorMap, buildYearFilter, buildCatFilter, renderCoverLinkButtons,
    applySteamAppId, backfillUpdatedAt, MONTHS, MONTHS_SHORT, MEDIA_SOURCE_LABELS,
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
    renderCoverLinkButtons, loadBacklogPrices, applySteamAppId,
    backfillUpdatedAt, MONTHS_SHORT, DEFAULT_SETTINGS,
  });
  Finance.init({
    state, $, el, uid, groupBy, countBy, toast, persist, render,
    buildYearFilter, buildCatFilter, monthCardHeader, emptyState,
    bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
    animatedNumberText, barRow, fillCategorySelect, wireCategorySelect,
    resolvePendingCatSelect, download, csvEsc, parseCsv,
    buildImportItems, reviewAndImport, openImportPicker,
    backfillUpdatedAt, MONTHS,
  });
  init();
})();
