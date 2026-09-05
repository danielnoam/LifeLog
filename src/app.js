// LifeLog — main app logic (vanilla JS, no build step).
(function () {
  const Storage = window.LifeLogStorage;
  const Finance = window.LifeLogFinance;
  const SettingsUI = window.LifeLogSettings;
  const Backlog = window.LifeLogBacklog;
  const Journal = window.LifeLogJournal;
  const IO = window.LifeLogIO;
  const Sync = window.LifeLogSync;
  const Wheel = window.LifeLogWheel;
  const MONTHS = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const DEFAULT_SETTINGS = { monthOrder: "asc", currency: "ILS", mediaCategorySources: {}, mediaCategoryFallbackSources: {}, mediaKeys: { rawg: "", tmdb: "", ggdeals: "", steamgriddb: "" }, steam: { proxyUrl: "", steamId: "", wishlistCategory: "", autoSyncDays: "0" }, anilist: { userName: "", animeCategory: "", mangaCategory: "", autoSyncDays: "0" }, releases: { autoRefreshDays: "0" } }; // monthOrder, currency, mediaCategorySources, mediaCategoryFallbackSources, mediaKeys, steam, anilist, releases — synced
  const DEFAULT_VISUAL = { monthMinWidth: 180, monthMaxWidth: 0, fontFamily: "system", pollInterval: 30, forceLayout: "none", theme: "default", timelineCoverSize: "small", backlogCoverSize: "big", backlogSummaries: "show" }; // maxWidth 0 = stretch — local to this device, not synced
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
    rawg: "RAWG", "rawg-steam-gg": "RAWG",
    steamgriddb: "SteamGridDB", "steamgriddb-steam-gg": "SteamGridDB",
    "tmdb-movie": "TMDB", "tmdb-tv": "TMDB",
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
  const APP_VERSION = "0.114.2"; // bump with each shipped change so it's visible in Settings

  const CATEGORY_PALETTE = ["#e23b3b", "#e2723b", "#e2b23b", "#9fe23b", "#3be25a", "#3bb2e2", "#5b8cff", "#723be2", "#b23be2", "#e23b72", "#7a8a99"];

  // Left-to-right order of the mobile bottom tab bar (see the `order:`
  // values on .tab in styles.css) — used for swipe-to-switch, so a swipe
  // moves to the visually adjacent tab, not just the next one in DOM order.
  const VIEW_ORDER = ["stats", "timeline", "backlog", "finance", "finance-stats"];
  // Number-key shortcuts (see wire()'s keydown handler) — deliberately the
  // on-screen tab order (left-to-right in #viewTabs), not VIEW_ORDER above,
  // since that's what the shortcuts cheat-sheet shows and what a user
  // scanning the tab bar would expect "3" etc. to mean.
  const SHORTCUT_VIEWS = { 1: "timeline", 2: "stats", 3: "backlog", 4: "finance", 5: "finance-stats" };

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
    try { localStorage.setItem(UI_KEY, JSON.stringify({ view: state.view, backlogMode: state.backlogMode, scrollY: window.scrollY })); } catch (e) {}
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
    // Which of the Backlog view's two layouts is showing: "category" (the
    // default — everything grouped by category) or "upcoming" (only what
    // hasn't come out yet, in date order). Remembered per device like `view`.
    backlogMode: "category",
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

  // Makes a non-<button> element keyboard-operable the way a real button is:
  // focusable, announced as a button, and fired by Enter or Space (Space
  // otherwise scrolls the page). Used on the chip-like spans that can't be
  // plain <button>s — the filter chips nest an edit control inside the toggle,
  // so both need to be independently focusable. `handler` runs for a pointer
  // click and for keyboard activation alike; the keyboard path passes the
  // keydown event through, so handlers that stopPropagation() (e.g. the nested
  // ✎ pencil, keeping Enter off the surrounding chip) keep working. `label`
  // sets an aria-label for glyph-only controls whose visible text isn't a name.
  // The [tabindex]:focus-visible rule in styles.css draws the focus ring.
  function activatable(node, handler, label) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    if (label) node.setAttribute("aria-label", label);
    node.addEventListener("click", handler);
    node.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); handler(ev); }
    });
    return node;
  }

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
  // Mobile quick-jump nav's current section list and position (see
  // updateJumpNav below) — the list is rebuilt on every render() so it
  // always matches what's actually on screen. The index is tracked as
  // state rather than re-derived from scroll position on every click:
  // window.scrollTo({behavior:"smooth"}) is async, so a quick second tap
  // would otherwise re-measure a scroll animation that hasn't caught up
  // yet and appear to do nothing.
  let jumpSections = [];
  let jumpCurrentIndex = 0; // last settled index — matches what's rendered whenever nothing is animating
  let jumpTargetIndex = 0; // where a tap/swipe has committed to head, even mid-animation — equals jumpCurrentIndex when idle
  let jumpBusy = false; // true while the track is actively transitioning (a step or a drag settling)
  let jumpQueuedDelta = null; // one pending ±1 step to run the instant the current animation finishes
  let jumpScrollRaf = 0; // rAF handle coalescing scroll events into one jump-nav sync per frame
  let jumpProgrammaticScrollUntil = 0; // performance.now() ceiling: ignore scroll-sync while a ◀/▶ jump's own smooth scroll is still settling

  // Lazy section rendering (see renderLazySections below) — the controller
  // for whichever view is currently on screen, so render() can tear down
  // the previous one before building a new one, and jumpScrollTo can force
  // a not-yet-built section to build before scrolling to it.
  let activeLazySections = null;
  // Set by render() right before dispatching to a view: null on a real tab
  // switch (the lazy top section should be index 0), or — on an in-view
  // re-render (add/edit/filter) — a { index, top } snapshot of the section
  // the user is currently parked on (its header's viewport offset before the
  // rebuild). render() force-builds that section eagerly and afterward
  // scrolls it back to the same offset, so the user stays put. A plain
  // absolute-scrollY restore doesn't work here: the lazily-built sections
  // above the anchor collapse to header height on rebuild, so the old
  // scrollY no longer lines up with the same content and gets clamped.
  let scrollAnchor = null;
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

  // Shared by the tab click handler and the mobile tab-bar swipe gesture.
  // Silently ignores an invalid/out-of-range view (e.g. swiping past the
  // first or last tab) instead of switching to nothing.
  function switchToView(view) {
    if (!view || !VIEW_ORDER.includes(view)) return;
    state.view = view;
    state.bulk.active = false;
    state.bulk.selected.clear();
    buildYearFilter();
    buildCatFilter();
    render();
    saveUiState();
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
      if (q && !e.title.toLowerCase().includes(q) && !(e.notes || "").toLowerCase().includes(q)) return false;
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

  // ---------- lazy section rendering ----------
  // Shared by Timeline/Ledger (year sections) and Backlog (category
  // sections): each caller builds every section's header synchronously (so
  // sticky headers and the jump-nav's querySelectorAll keep working exactly
  // as before) but defers building the body — the actual rows/cover art —
  // until it's actually needed: the one section that matters right now,
  // whichever section scrolls near the viewport, or a slow background
  // trickle through whatever's left otherwise.
  //
  // sections: [{ key, header: HTMLElement, node: HTMLElement,
  //              bodyEl: HTMLElement, build: () => void }]
  //   node is already fully built and appended to root by the caller loop,
  //   holding header + an empty bodyEl; build() fills bodyEl in place and
  //   is only ever invoked once per section (guarded here, callers don't
  //   need to worry about being called twice).
  //
  // Deliberately does NOT reserve an estimated min-height on unbuilt
  // bodyEls (e.g. from an item count): Timeline/Ledger's body is a CSS grid
  // of month-cards (entries wrap into columns, so "N entries" isn't "N
  // rows" — a count-based estimate badly overshoots), while Backlog's is a
  // plain vertical list where it'd be closer but still off (rows vary in
  // height, plus divider elements). An inaccurate reserved height is worse
  // than none: it leaves a stale gap/overlap once the real content replaces
  // it and can throw off jump-nav's scroll-target math for sections beyond
  // it. Unbuilt sections instead just collapse to their header's height,
  // which is fine — it means a few extra sections may fall inside the
  // IntersectionObserver's lookahead band on first layout, not a
  // correctness problem.
  function renderLazySections(root, sections) {
    sections.forEach((s) => root.appendChild(s.node));

    const built = new Array(sections.length).fill(false);
    const buildAt = (i) => {
      if (built[i]) return;
      built[i] = true;
      sections[i].build();
    };

    // Small collections and bulk mode (where "select all"/drag-paint need
    // every row live in the DOM right away) skip the machinery entirely.
    if (state.bulk.active || sections.length < 2) {
      sections.forEach((_, i) => buildAt(i));
      activeLazySections = { ensureBuilt() {}, destroy() {} };
      return activeLazySections;
    }

    // Build the section the user is parked on first (see scrollAnchor), so
    // render()'s post-rebuild scroll restore lands on real rows instead of
    // an empty header-only shell. Its index was captured from the live DOM
    // before the clear (captureScrollAnchor) — more reliable than
    // re-measuring here against a scroll position the clear already clamped.
    let eagerIndex = 0;
    if (scrollAnchor) eagerIndex = Math.max(0, Math.min(sections.length - 1, scrollAnchor.index));
    buildAt(eagerIndex);

    const io = new IntersectionObserver((observedEntries) => {
      for (const oe of observedEntries) {
        if (!oe.isIntersecting) continue;
        const i = sections.findIndex((s) => s.node === oe.target);
        if (i >= 0) { buildAt(i); io.unobserve(oe.target); }
      }
    }, { rootMargin: "100% 0px 100% 0px" }); // ~1 viewport of lookahead/lookbehind
    sections.forEach((s, i) => { if (i !== eagerIndex) io.observe(s.node); });

    // Background trickle so ordinary use (and jump-nav Next/Prev) converges
    // to fully-built within a couple seconds even without scrolling —
    // radiates outward from eagerIndex (forward first, then backward)
    // rather than strictly left-to-right, since forward is the common
    // browsing direction and this way a backward jump also heals quickly.
    let fwd = eagerIndex + 1, back = eagerIndex - 1, idleHandle = null;
    const idleTick = () => {
      idleHandle = null;
      while (fwd < sections.length && built[fwd]) fwd++;
      while (back >= 0 && built[back]) back--;
      if (fwd < sections.length) buildAt(fwd++);
      else if (back >= 0) buildAt(back--);
      if (fwd < sections.length || back >= 0) scheduleIdle();
    };
    function scheduleIdle() {
      idleHandle = window.requestIdleCallback
        ? window.requestIdleCallback(idleTick, { timeout: 500 })
        : setTimeout(idleTick, 200);
    }
    scheduleIdle();

    activeLazySections = {
      ensureBuilt(i) { if (sections[i]) buildAt(i); },
      destroy() {
        io.disconnect();
        if (idleHandle == null) return;
        if (window.cancelIdleCallback) window.cancelIdleCallback(idleHandle);
        else clearTimeout(idleHandle);
      },
    };
    return activeLazySections;
  }

  // ---------- rendering ----------
  function render() {
    // Clearing #content below momentarily collapses the page to whatever
    // height the topbar/nav alone take up, and browsers clamp window.scrollY
    // down to fit — permanently, even once the full content is rebuilt right
    // after. Restore position afterward for an in-view re-render
    // (add/edit/filter), where the user expects to stay put; skip it on a
    // real view switch, where landing at the top is the expected behavior.
    // scrollAnchor is captured here from the *live* (pre-clear) DOM so the
    // restore has an accurate section to pin to; prevScrollY is the fallback
    // for fixed-layout views (Stats/Summary) that have no lazy sections.
    const sameView = state.view === lastRenderedView;
    const prevScrollY = window.scrollY;
    scrollAnchor = sameView ? captureScrollAnchor() : null;
    if (activeLazySections) { activeLazySections.destroy(); activeLazySections = null; }
    try {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.view === state.view);
      });
      updateTabUnderline();
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
      // Anchor-relative restore where we have one (Timeline/Backlog/Ledger);
      // fall back to the plain scrollY for fixed-layout views, or if the
      // anchored section vanished (e.g. a filter change dropped it).
      if (sameView && !(scrollAnchor && restoreScrollAnchor(scrollAnchor)) && prevScrollY) {
        window.scrollTo(0, prevScrollY);
      }
      updateJumpNav();
      updateSearchMatchBadges();
    }
  }

  // While actively searching, badges the tabs you're NOT currently looking
  // at with how many of their own items also match — the search box is
  // shared across views (state.search persists across tab switches), but
  // without this there's no way to tell a search also hits Backlog/Ledger
  // items short of clicking over to check.
  function updateSearchMatchBadges() {
    const q = state.search.trim();
    const counts = q ? {
      timeline: getFiltered().length,
      backlog: Backlog.getFilteredBacklog().length,
      finance: Finance.getFilteredFinance().length,
    } : null;
    for (const key of ["timeline", "backlog", "finance"]) {
      const tab = document.querySelector(`.tab[data-view="${key}"]`);
      if (!tab) continue;
      let badge = tab.querySelector(".tab-match-badge");
      const n = counts && key !== state.view ? counts[key] : 0;
      if (n > 0) {
        if (!badge) { badge = el("span", "tab-match-badge"); tab.appendChild(badge); }
        badge.textContent = String(n);
      } else if (badge) badge.remove();
    }
  }

  // ---------- mobile quick-jump nav ----------
  // A second row in the mobile bottom bar (see .jump-nav in styles.css) for
  // paging between the sticky year headers (Timeline/Ledger) or category
  // headers (Backlog) a long scroll would otherwise bury — Stats/Summary
  // are fixed card layouts with nothing to page through, so they get none.
  // Rebuilt on every render() so it always matches what's actually on
  // screen; the shown label also tracks a manual scroll via
  // syncJumpNavToScroll below.
  function jumpSectionSelector() {
    if (state.view === "backlog") return ".backlog-section-head";
    if (state.view === "timeline" || state.view === "finance") return ".year-head";
    return null;
  }
  function jumpLabelFor(sectionEl) {
    const el = state.view === "backlog"
      ? sectionEl.querySelector(".backlog-section-name")
      : sectionEl.querySelector("h2");
    return el ? el.textContent : "";
  }
  // Snapshot the section the viewport is currently anchored on, for render()
  // to restore after an in-view rebuild — the last section header at or
  // above the topbar line, plus that header's viewport offset. Returns null
  // for fixed-layout views (Stats/Summary have no lazy sections; render()
  // falls back to the plain scrollY there).
  function captureScrollAnchor() {
    const selector = jumpSectionSelector();
    if (!selector) return null;
    const heads = [...document.querySelectorAll("#content " + selector)];
    if (!heads.length) return null;
    const offset = $(".topbar").getBoundingClientRect().height + 4;
    let index = 0;
    for (let i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top <= offset) index = i; else break;
    }
    return { index, top: heads[index].getBoundingClientRect().top };
  }
  // Undo the scroll clamp a content rebuild causes: put the anchored section
  // header back at the same viewport offset it held before. Positions
  // relative to the (eagerly-built) anchor section rather than an absolute
  // scrollY, so it holds even though the sections above it collapsed to
  // header height. Returns false if the section is gone (e.g. a filter
  // change dropped it), letting render() fall back to the old scrollY.
  function restoreScrollAnchor(anchor) {
    const selector = jumpSectionSelector();
    if (!selector) return false;
    const head = document.querySelectorAll("#content " + selector)[anchor.index];
    if (!head) return false;
    window.scrollBy(0, head.getBoundingClientRect().top - anchor.top);
    return true;
  }
  // Keeps the jump-nav's shown section label in step with a manual scroll
  // (it used to only re-sync on tap/render, so it went stale scrolling past
  // the sticky headers). rAF-throttled, and a no-op while a tap/swipe
  // animation owns the carousel (jumpBusy/jumpDrag) or while a ◀/▶ jump's
  // own smooth scroll is still settling, so it never fights those.
  function syncJumpNavToScroll() {
    if (jumpScrollRaf) return;
    jumpScrollRaf = requestAnimationFrame(() => {
      jumpScrollRaf = 0;
      if (performance.now() < jumpProgrammaticScrollUntil) return;
      const nav = $("#jumpNav");
      if (!nav || !nav.classList.contains("is-active")) return;
      if (jumpBusy || jumpDrag || jumpSections.length < 2) return;
      const idx = jumpIndexFromScroll();
      if (idx !== jumpCurrentIndex) setJumpIndex(idx);
    });
  }
  function updateJumpNav() {
    const nav = $("#jumpNav");
    if (!nav) return;
    const selector = jumpSectionSelector();
    jumpSections = selector ? [...document.querySelectorAll("#content " + selector)] : [];
    if (jumpSections.length < 2) { nav.classList.remove("is-active"); return; }
    jumpSections.forEach((el, i) => { el.dataset.jumpIndex = i; });
    nav.classList.add("is-active");
    setJumpIndex(jumpIndexFromScroll());
  }
  // Which section has scrolled up to (or past) the sticky topbar right now
  // — the last one whose top is at or above that line, defaulting to the
  // very first section if we haven't scrolled that far yet (e.g. right
  // after a view switch). Only called at render time to (re)sync
  // jumpCurrentIndex with reality — ◀/▶ clicks use that tracked value
  // instead, not this, so a quick second tap isn't measuring a scroll
  // animation still in flight from the first.
  function jumpIndexFromScroll() {
    const offset = $(".topbar").getBoundingClientRect().height + 4;
    let idx = 0;
    for (const el of jumpSections) {
      if (el.getBoundingClientRect().top <= offset) idx = +el.dataset.jumpIndex;
      else break;
    }
    return idx;
  }
  // Driven by jumpTargetIndex, not jumpCurrentIndex — jumpTargetIndex
  // updates the instant a tap/swipe commits (see jumpTo), while
  // jumpCurrentIndex only catches up once its animation finishes. Gating
  // on the latter left ◀/▶ briefly, wrongly disabled right after a tap
  // moved off a boundary — e.g. tapping ▶ from the very first section
  // should immediately allow ◀ again, not ~180ms later once the slide
  // visually lands.
  function updateJumpButtons() {
    $("#jumpPrevBtn").disabled = jumpTargetIndex <= 0;
    $("#jumpNextBtn").disabled = jumpTargetIndex >= jumpSections.length - 1;
  }
  function setJumpIndex(index) {
    jumpCurrentIndex = Math.max(0, Math.min(jumpSections.length - 1, index));
    jumpTargetIndex = jumpCurrentIndex;
    jumpBusy = false;
    jumpQueuedDelta = null;
    updateJumpButtons();
    renderJumpCarousel();
  }
  // Sliding accent-colored indicator under the active tab, tracking its
  // position/width (see the CSS transition on .tab-underline) whenever the
  // active tab changes, whether by tap or by swipe, so the motion itself
  // reads as confirmation something moved.
  function updateTabUnderline() {
    const underline = $("#tabUnderline");
    const active = document.querySelector("#viewTabs .tab.active");
    if (!underline || !active) return;
    underline.style.transition = "";
    underline.style.left = active.offsetLeft + "px";
    underline.style.width = active.offsetWidth + "px";
    underline.hidden = false;
  }
  // Live drag-follow for the tab underline. Rather than tracking the
  // finger 1:1 in raw pixels (which let it overshoot past the target tab,
  // or run off the edge of the screen at the first/last tab), this
  // measures the actual target tab's box up front and morphs the
  // underline's left/width from the active tab's box toward it as a 0–1
  // progress fraction — so it can never travel further than the target
  // and always lands exactly on it. tabDrag caches that target (and the
  // starting box) for the rest of the gesture; null means either no drag
  // is in progress yet, or one started at a boundary with no tab to head
  // toward (in which case the underline just doesn't move).
  let tabDrag = null;
  function tabDragMove(dx) {
    const underline = $("#tabUnderline");
    if (!underline) return;
    if (!tabDrag) {
      const active = document.querySelector("#viewTabs .tab.active");
      if (!active) return;
      const idx = VIEW_ORDER.indexOf(state.view);
      const targetView = dx < 0 ? VIEW_ORDER[idx + 1] : VIEW_ORDER[idx - 1];
      const targetEl = targetView ? document.querySelector('#viewTabs .tab[data-view="' + targetView + '"]') : null;
      if (!targetEl) return; // at a boundary — nothing to drag toward
      tabDrag = {
        baseLeft: active.offsetLeft, baseWidth: active.offsetWidth,
        targetLeft: targetEl.offsetLeft, targetWidth: targetEl.offsetWidth,
      };
      underline.style.transition = "none";
    }
    const span = tabDrag.targetLeft - tabDrag.baseLeft;
    const progress = span === 0 ? 0 : Math.max(0, Math.min(1, -dx / span));
    underline.style.left = (tabDrag.baseLeft + span * progress) + "px";
    underline.style.width = (tabDrag.baseWidth + (tabDrag.targetWidth - tabDrag.baseWidth) * progress) + "px";
  }
  // Builds one slot of the jump-nav carousel — blank (but still occupying
  // a slot) past either end of jumpSections, so a slide toward a
  // boundary shows an empty neighbor instead of nothing.
  function jumpItemEl(index, isActive) {
    const div = document.createElement("div");
    div.className = "jump-item" + (isActive ? " is-active" : "");
    const el = jumpSections[index];
    div.textContent = el ? jumpLabelFor(el) : "";
    return div;
  }
  // Resets the carousel track to its resting 3-slot state (prev/current/
  // next around jumpCurrentIndex) with no transition — the instantaneous
  // "landed" frame that both a completed slide and a cancelled drag
  // converge back to.
  function renderJumpCarousel() {
    const track = $("#jumpTrack");
    if (!track) return;
    track.style.transition = "none";
    track.replaceChildren(
      jumpItemEl(jumpCurrentIndex - 1, false),
      jumpItemEl(jumpCurrentIndex, true),
      jumpItemEl(jumpCurrentIndex + 1, false)
    );
    track.style.transform = "translateX(0px)";
    void track.offsetWidth; // flush the transition:none before re-enabling it
    track.style.transition = "";
  }
  // Scrolls so the target section's sticky header lands right below the
  // topbar — plain scrollIntoView would align it to the very top of the
  // viewport, tucking it behind the topbar instead.
  //
  // Measures the section's *container* (.year-block / .backlog-section),
  // not the sticky header itself: a position:sticky element's own
  // getBoundingClientRect() only reflects its true document position
  // while it hasn't started sticking yet (i.e. still below the viewport,
  // not yet reached) — once you've scrolled past it, the browser reports
  // its current sticky-pushed position instead, which isn't the same
  // number and made this land partway into the section rather than at
  // its start whenever the target was above the current scroll position
  // (jumping backward). The header's plain, non-sticky parent doesn't
  // have that problem — its rect is always the element's real position,
  // approaching from either direction — and the header sits flush at its
  // top either way, so aligning to the parent's top lands in the same spot.
  function jumpScrollTo(index) {
    const el = jumpSections[index];
    if (!el) return;
    // Force the target section's rows to exist before measuring/scrolling —
    // otherwise a jump straight to a section the lazy IO/idle loop hasn't
    // reached yet would land on an (at best under-measured) empty shell.
    if (activeLazySections) activeLazySections.ensureBuilt(index);
    const offset = $(".topbar").getBoundingClientRect().height;
    const anchor = el.parentElement || el;
    const top = anchor.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
    // Let this jump's own smooth scroll settle before scroll-sync resumes,
    // so it doesn't briefly rewind the label to a section being scrolled past.
    jumpProgrammaticScrollUntil = performance.now() + 800;
  }
  // Jump from a Stats heatmap cell straight to that month in the Timeline:
  // switch views, then scroll the matching .month-card just below the
  // topbar. The Timeline shares the same active filters as the Stats view
  // the heatmap was drawn from, so any month with a lit (clickable) cell is
  // guaranteed to have a card here. The target year's rows are lazily
  // built, so force that section's build first (its index = its position
  // among the year blocks, which renderLazySections appends in order),
  // otherwise we'd measure an unbuilt, header-only shell. Passed into
  // Journal via init(ctx) since the heatmap lives there.
  function jumpToTimelineMonth(year, month) {
    if (state.view !== "timeline") switchToView("timeline");
    const block = document.querySelector(`#content .year-block[data-year="${year}"]`);
    if (!block) return;
    const blocks = [...document.querySelectorAll("#content .year-block")];
    const idx = blocks.indexOf(block);
    if (idx >= 0 && activeLazySections) activeLazySections.ensureBuilt(idx);
    const target = block.querySelector(`.month-card[data-month="${month}"]`) || block;
    const offset = $(".topbar").getBoundingClientRect().height;
    const top = target.getBoundingClientRect().top + window.scrollY - offset - 4;
    window.scrollTo({ top, behavior: "smooth" });
  }
  // Prepares the track for a one-slot carousel slide in `delta`'s direction
  // (+1 = next, appended past the right edge; -1 = prev, prepended past
  // the left edge) and animates it to completion, landing on
  // jumpCurrentIndex + delta. Shared by ◀/▶ taps and a completed swipe
  // (see jumpDragSettle) — a tap just skips straight to the animated slide
  // instead of following a finger there first.
  //
  // Assumes the caller (jumpRequestStep) has already confirmed nothing
  // else is animating — jumpBusy guards the whole thing, since starting a
  // second slide while the track still has the previous one's extra slot
  // and in-flight transform would corrupt both (this is what caused taps
  // during an animation to sometimes appear to do nothing, or land on the
  // wrong section, before this guard existed).
  function jumpAnimateStep(delta) {
    const track = $("#jumpTrack");
    const carousel = $("#jumpCarousel");
    if (!track || !carousel) { jumpCurrentIndex += delta; jumpTargetIndex = jumpCurrentIndex; return; }
    jumpBusy = true;
    const slotWidth = carousel.clientWidth / 3;
    track.style.transition = "none";
    if (delta > 0) {
      track.appendChild(jumpItemEl(jumpCurrentIndex + 2, false));
      track.style.transform = "translateX(0px)";
    } else {
      track.insertBefore(jumpItemEl(jumpCurrentIndex - 2, false), track.firstChild);
      track.style.transform = "translateX(" + -slotWidth + "px)";
    }
    void track.offsetWidth;
    track.style.transition = "";
    track.style.transform = "translateX(" + (delta > 0 ? -slotWidth : 0) + "px)";
    const finish = () => {
      track.removeEventListener("transitionend", finish);
      jumpCurrentIndex += delta;
      renderJumpCarousel();
      jumpBusy = false;
      jumpDrainQueue();
    };
    track.addEventListener("transitionend", finish);
  }
  // Runs the next queued step, if any, once the track is free. Called from
  // both animation-finish paths (a completed tap-step and a completed
  // drag-settle) so either kind of animation can hand off to a queued tap.
  function jumpDrainQueue() {
    if (!jumpQueuedDelta) return;
    const next = Math.sign(jumpQueuedDelta);
    jumpQueuedDelta -= next;
    if (jumpQueuedDelta === 0) jumpQueuedDelta = null;
    jumpAnimateStep(next);
  }
  // Entry point for a single programmatic step (◀/▶ tap or a carousel-item
  // tap) — queues instead of firing immediately if the track is already
  // mid-animation, so a fast run of taps all eventually land instead of
  // later ones overwriting/dropping earlier ones (or, worse, corrupting
  // the in-flight animation by touching the track at the same time — see
  // jumpAnimateStep). Queued amounts accumulate (jumpQueuedDelta is a
  // running total, not just the latest tap) and are drained one slot-step
  // at a time as each animation finishes, so opposite-direction taps
  // (next then prev) net out instead of both being honored as separate
  // overshoot-then-correct steps.
  function jumpRequestStep(delta) {
    if (jumpBusy) { jumpQueuedDelta = (jumpQueuedDelta || 0) + delta; return; }
    jumpAnimateStep(delta);
  }
  function jumpTo(index) {
    const clamped = Math.max(0, Math.min(jumpSections.length - 1, index));
    const delta = Math.sign(clamped - jumpTargetIndex);
    if (delta === 0) return;
    jumpTargetIndex += delta;
    updateJumpButtons();
    jumpScrollTo(jumpTargetIndex);
    jumpRequestStep(delta);
  }
  // Live drag-follow for the carousel, mirroring the tab underline's
  // tabDragMove/onSettle pattern but sliding actual content instead of
  // an indicator. jumpDrag caches which direction the DOM was prepared
  // for (see jumpAnimateStep) so later moves in the same gesture keep
  // offsetting from that fixed baseline rather than re-deriving it. A
  // drag can't begin while jumpBusy (a tap-triggered step, or a previous
  // drag's settle, is still animating) — the next pointermove after that
  // clears will pick it up cleanly instead of racing the in-flight one.
  let jumpDrag = null;
  function jumpDragMove(dx) {
    const track = $("#jumpTrack");
    const carousel = $("#jumpCarousel");
    if (!track || !carousel) return;
    if (!jumpDrag) {
      if (jumpBusy) return;
      const delta = dx < 0 ? 1 : -1;
      if (delta > 0 && jumpCurrentIndex >= jumpSections.length - 1) return;
      if (delta < 0 && jumpCurrentIndex <= 0) return;
      const slotWidth = carousel.clientWidth / 3;
      jumpBusy = true;
      track.style.transition = "none";
      if (delta > 0) {
        track.appendChild(jumpItemEl(jumpCurrentIndex + 2, false));
        jumpDrag = { delta, slotWidth, baseline: 0, current: 0 };
      } else {
        track.insertBefore(jumpItemEl(jumpCurrentIndex - 2, false), track.firstChild);
        jumpDrag = { delta, slotWidth, baseline: -slotWidth, current: -slotWidth };
      }
      track.style.transform = "translateX(" + jumpDrag.baseline + "px)";
    }
    const clamped = Math.max(-jumpDrag.slotWidth, Math.min(0, jumpDrag.baseline + dx));
    jumpDrag.current = clamped;
    track.style.transform = "translateX(" + clamped + "px)";
  }
  // committed: whether the swipe crossed the threshold in the direction
  // the carousel was actually prepared for (see the mismatch guard in
  // wire() — a reversed drag settles back instead of committing the wrong
  // way). Finishes the slide (or reverses it) with a real transition, then
  // rebuilds the resting 3-slot state once it lands.
  function jumpDragSettle(committed) {
    const track = $("#jumpTrack");
    const drag = jumpDrag;
    if (!track || !drag) { jumpDrag = null; return; }
    const target = committed ? (drag.delta > 0 ? -drag.slotWidth : 0) : drag.baseline;
    const finish = () => {
      track.removeEventListener("transitionend", finish);
      if (committed) {
        jumpCurrentIndex += drag.delta;
        // Drags bypass jumpTo (the only other place jumpTargetIndex moves),
        // so it needs an explicit resync here — folding in any delta a
        // concurrent tap queued mid-drag rather than just overwriting it,
        // in case a second finger tapped ◀/▶ while this one was dragging.
        jumpTargetIndex = jumpCurrentIndex + (jumpQueuedDelta || 0);
        updateJumpButtons();
        jumpScrollTo(jumpCurrentIndex);
      }
      renderJumpCarousel();
      jumpDrag = null;
      jumpBusy = false;
      jumpDrainQueue();
    };
    track.style.transition = "";
    track.style.transform = "translateX(" + target + "px)";
    // A deep enough drag can already be sitting exactly at the target by
    // release time (the live drag clamps at the same boundary this
    // settles to) — re-setting an unchanged transform fires no
    // transitionend, so without this, finish() would never run: jumpBusy
    // stays wedged true and the extra slot never gets cleaned out of the
    // track, silently breaking every jump-nav interaction after it.
    if (drag.current === target) finish();
    else track.addEventListener("transitionend", finish);
  }

  // Mirrors the CSS mobile-detection rules (html:not(.force-pc) under the
  // 720px breakpoint, or html.force-mobile unconditionally) — swiping to
  // navigate isn't a desktop mouse convention, so the gesture handlers
  // below only engage in the same layout the bottom bar itself appears in.
  function isMobileLayout() {
    const root = document.documentElement;
    if (root.classList.contains("force-mobile")) return true;
    if (root.classList.contains("force-pc")) return false;
    return window.innerWidth <= 720;
  }
  // Horizontal swipe-to-navigate for a fixed (non-scrolling) bar — pointer
  // events cover touch and mouse alike. A swipe naturally ends with the
  // finger over a different child than it started on (e.g. sliding onto
  // the jump-nav's own ◀/▶, or onto a neighboring tab), and pointerup
  // fires on whatever's actually underneath at release — not on `el` —
  // so without capture the gesture's end would be silently missed.
  // setPointerCapture redirects it back to `el` once real drag movement
  // is seen; a plain tap never crosses that threshold, so button clicks
  // are untouched. Vertical drift disqualifies a swipe too, so an
  // accidental diagonal touch doesn't fire either side.
  // onMove(dx), if given, fires continuously once a real drag starts (see
  // tabDragMove/jumpDragMove) so the underline/carousel can track the
  // finger instead of only moving once the gesture completes. onSettle,
  // if given, fires when a drag ends without crossing the threshold (or
  // is cancelled) so the caller can animate whatever onMove displaced
  // back to rest.
  function attachSwipe(el, { onLeft, onRight, onMove, onSettle, threshold = 40 }) {
    let startX = null, startY = null, captured = false;
    el.addEventListener("pointerdown", (e) => {
      if (!isMobileLayout()) return;
      startX = e.clientX; startY = e.clientY; captured = false;
    });
    el.addEventListener("pointermove", (e) => {
      if (startX == null) return;
      if (!captured) {
        if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
          el.setPointerCapture(e.pointerId);
          captured = true;
          // Once it's a real horizontal drag (not a tap, not vertical
          // scroll), stop the browser's own touch handling from also
          // reacting to the same gesture — left unchecked it could start
          // a text selection or show a press-and-hold highlight partway
          // through, which read as a stray flash/lag on the tab you
          // ended up landing on.
          e.preventDefault();
        } else return;
      } else {
        e.preventDefault();
      }
      if (onMove) onMove(e.clientX - startX);
    });
    el.addEventListener("pointerup", (e) => {
      if (startX == null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const dragged = captured;
      startX = null; captured = false;
      const swiped = Math.abs(dx) >= threshold && Math.abs(dx) >= Math.abs(dy);
      if (swiped) (dx < 0 ? onLeft : onRight)();
      else if (dragged && onSettle) onSettle();
    });
    el.addEventListener("pointercancel", () => {
      const dragged = captured;
      startX = null; captured = false;
      if (dragged && onSettle) onSettle();
    });
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
      // Some-but-not-all shows the tri-state bar instead of an empty box,
      // so a partly-selected group doesn't read as untouched.
      cb.indeterminate = !allSelected && selectableItems.some((b) => state.bulk.selected.has(b.id));
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
      addBtn.setAttribute("aria-label", addBtn.title);
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
  let linkRenderSeq = 0;
  function renderCoverLinkButtons(container, mediaSource, mediaId) {
    if (!container) return;
    container.innerHTML = "";
    if (!mediaSource || !mediaId) return;
    // The GG.deals button can only be added once a price lookup comes back,
    // by which time this container may have been re-rendered for a different
    // item (or moved, below) — so a late arrival checks it is still filling
    // the render it was started for rather than appending a stray button.
    const stamp = String(++linkRenderSeq);
    container.dataset.linkRender = stamp;
    const addLink = (label, url) => {
      if (!url || container.dataset.linkRender !== stamp) return;
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

  // Which of a modal's two link rows gets filled. The overlay row sits inside
  // the cover block, which is hidden for an item with no artwork — and for
  // one whose cover URL turns out to be a dead image — so the links used to
  // disappear along with a picture they have nothing to do with. They fall
  // back to a plain row under the modal title instead. Only one row is ever
  // filled; the other is emptied, so nothing shows twice.
  function renderMediaLinks(overlayEl, rowEl, hasCover, mediaSource, mediaId) {
    const other = hasCover ? rowEl : overlayEl;
    if (other) other.innerHTML = "";
    renderCoverLinkButtons(hasCover ? overlayEl : rowEl, mediaSource, mediaId);
  }

  // ---------- per-item sync overrides ----------
  // Media metadata is re-fetched freely — a bulk sync, a re-pick, the 🔭
  // release re-check — and every refresh rewrites whatever it finds. That is
  // the point, right up until a source is simply wrong about something and
  // you want your own value to stick. Ticking a field in a modal's Advanced
  // foldout records it here as `overrides: { release: true, … }`, and every
  // sync path writes around the ticked ones. Absent on items that never use
  // it, so nothing changes for anything that doesn't.
  function isOverridden(item, key) {
    return !!(item && item.overrides && item.overrides[key]);
  }

  // Kept as an object rather than a list so it reads the same as it stores;
  // dropped entirely when nothing is ticked, so an item that has never used
  // the foldout stays byte-identical to how it saved before this existed.
  function sanitizeOverrides(overrides, keys) {
    const out = {};
    for (const key of keys) if (overrides && overrides[key]) out[key] = true;
    return Object.keys(out).length ? out : null;
  }

  // The four functions below drive a modal's foldout from a spec its own
  // module supplies — one entry per overridable field, each naming its
  // checkbox and value inputs plus a `pull` (copy the current synced value
  // into the foldout) and a `push` (copy the ticked value back into the form
  // the save reads). Keeping pull/push with the module means a compound
  // field like a release date — a date, a precision and a status behind one
  // tick — stays where its parsing lives, and this stays generic.

  // Modal open: show every field's current value, tick what the item has
  // pinned. Pulls even the ticked ones, since on open the stored value *is*
  // the pinned value.
  function initOverrideFields(spec, item) {
    spec.forEach((f) => { f.pull(); $(f.check).checked = isOverridden(item, f.key); });
    refreshOverrideFields(spec);
  }

  // After anything repaints the form (a sync landing, a tick changing): an
  // unticked field follows whatever the sync now says, a ticked one is left
  // showing what you typed.
  function refreshOverrideFields(spec) {
    spec.forEach((f) => {
      const on = $(f.check).checked;
      f.inputs.forEach((id) => { const input = $(id); if (input) input.disabled = !on; });
      if (!on) f.pull();
    });
  }

  // Save: ticked fields overwrite the form's synced values, so the rest of
  // the save path reads them without knowing any of this happened.
  function pushOverrideValues(spec) {
    spec.forEach((f) => { if ($(f.check).checked) f.push(); });
  }

  function readOverrideChecks(spec) {
    const out = {};
    spec.forEach((f) => { if ($(f.check).checked) out[f.key] = true; });
    return Object.keys(out).length ? out : null;
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
      activatable(chip, () => {
        if (activeYears.has(y)) activeYears.delete(y);
        else activeYears.add(y);
        buildYearFilter();
        render();
      });
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
      activatable(edit, (ev) => { ev.stopPropagation(); finance ? Finance.openFinanceCatModal(c) : Journal.openCategoryModal(c); }, "Edit category " + c.name);
      chip.appendChild(edit);
      activatable(chip, () => {
        if (activeCats.has(c.name)) activeCats.delete(c.name);
        else activeCats.add(c.name);
        buildCatFilter();
        render();
      });
      wrap.appendChild(chip);
    });
    equalizeChipWidths(wrap);
    const addChip = el("span", "cat-chip add-chip", "+");
    const addLabel = finance ? "Add finance category" : "Add category";
    addChip.title = addLabel;
    activatable(addChip, (ev) => {
      ev.stopPropagation();
      finance ? Finance.openFinanceCatModal(null) : Journal.openCategoryModal(null);
    }, addLabel);
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
    // A 401/403 from GitHub is a *persistent* failure (revoked/expired token,
    // or one missing the `repo` scope) — "will sync when online" is misleading
    // there, because it never will until the token is fixed, leaving the user
    // to believe their data is safely synced when it only lives in this browser.
    // Any other failure (offline, 5xx, network) stays transient/retryable.
    const ghErr = ghOn ? Storage.githubError : null;
    const ghAuthFailed = ghErr && (ghErr.status === 401 || ghErr.status === 403);
    if (ghAuthFailed) {
      cls = "storage-status error";
      txt = "GitHub rejected your token — saved to this browser only. Reconnect in Settings.";
    } else if (state.pendingSync && (ghOn || fileOn)) {
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

  // Global one-key shortcuts (see wire()'s keydown handler) only fire
  // outside of text entry — otherwise typing a title/note/search term
  // starting with "n" or a digit would trigger one instead of being typed.
  function isTypingTarget(node) {
    if (!node) return false;
    const tag = node.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
  }
  function openShortcutsModal() { $("#shortcutsModal").hidden = false; }
  function closeShortcutsModal() { $("#shortcutsModal").hidden = true; }

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
      let merged = remoteData, contributedLocally = false, summary = "", conflictSummary = "";
      if (window.LifeLogMerge) {
        try {
          const syncBase = Storage.getSyncBase();
          merged = normalize(window.LifeLogMerge.mergeAllSources(syncBase, state.data, remoteData));
          summary = window.LifeLogMerge.diffSnapshots(state.data, merged);
          contributedLocally = window.LifeLogMerge.diffSnapshots(remoteData, merged) !== "No changes";
          conflictSummary = window.LifeLogMerge.summarizeConflicts(syncBase, state.data, remoteData);
        } catch (e) { merged = remoteData; }
      }
      state.data = merged;
      Storage._cache(state.data);
      afterDataChange();
      if (contributedLocally) await persist(); // push the reconciled result back so it durably converges
      else refreshStorageStatus();
      let msg = summary && summary !== "No changes" ? "Merged " + summary + " from your other device" : "Updated from another device";
      if (conflictSummary) msg += " — " + conflictSummary;
      toast(msg, !!conflictSummary);
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
      releases: { ...DEFAULT_SETTINGS.releases, ...(incomingSettings.releases || {}) },
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
    // Rendered under the ⚙ button in the top bar; the brand already says
    // "LifeLog" right there, so just the version reads cleaner.
    $("#appVersion").textContent = "v" + APP_VERSION;
    $("#appVersion").title = "LifeLog v" + APP_VERSION;

    // Sticky timeline year/month headers (see .year-head / .month-card h3 in
    // styles.css) anchor below the topbar — its height changes with wrapping,
    // so track it live rather than hardcoding a pixel value.
    const topbar = $(".topbar");
    const setTopbarH = () => document.documentElement.style.setProperty("--topbar-h", topbar.getBoundingClientRect().height + "px");
    new ResizeObserver(setTopbarH).observe(topbar);
    setTopbarH();

    // Same idea for the mobile bottom bar — its height changes as the
    // jump-nav row (see updateJumpNav) animates open/closed, and .content's
    // bottom padding / the FAB / toast / bulk-bar all anchor off it so none
    // of them pop when that happens.
    const bottomBar = $("#topbarBottom");
    const setBottomBarH = () => document.documentElement.style.setProperty("--bottombar-h", bottomBar.getBoundingClientRect().height + "px");
    new ResizeObserver(setBottomBarH).observe(bottomBar);
    setBottomBarH();

    // ◀/▶ and item taps all target jumpTargetIndex, not jumpCurrentIndex —
    // mid-animation those differ (target is where a queued step is
    // headed; current is where the track visually still is), and going
    // off target is what makes a fast second tap land correctly instead
    // of being measured against a not-yet-settled position.
    $("#jumpPrevBtn").onclick = () => jumpTo(jumpTargetIndex - 1);
    $("#jumpNextBtn").onclick = () => jumpTo(jumpTargetIndex + 1);
    // Tapping either dimmed neighbor slot jumps straight to it, same as
    // ◀/▶ — delegated on the track since its slots are rebuilt on every
    // render (renderJumpCarousel/jumpAnimateStep/jumpDragSettle all
    // replace them). A tap that lands on the currently-active (centered)
    // slot is a no-op. jumpDrag being set means a real swipe is/was in
    // progress on this same pointer sequence, not a plain tap — several
    // touch browsers still fire a trailing click after a drag despite the
    // movement, so this skips acting on that synthetic one too. jumpBusy
    // means the track doesn't currently hold the plain 3-slot layout this
    // handler's slot-index math assumes (a 4th slot is in there mid-
    // animation), so a tap during that window is ignored rather than
    // acted on against the wrong slot.
    $("#jumpTrack").addEventListener("click", (e) => {
      if (jumpDrag || jumpBusy) return;
      const item = e.target.closest(".jump-item");
      if (!item || item.classList.contains("is-active")) return;
      const items = [...$("#jumpTrack").children];
      const slot = items.indexOf(item); // 0 = prev, 1 = current, 2 = next in the resting 3-slot state
      if (slot === 0) jumpTo(jumpTargetIndex - 1);
      else if (slot === 2) jumpTo(jumpTargetIndex + 1);
    });
    attachSwipe($("#jumpNav"), {
      // A drag's committed direction is decided by jumpDragMove from the
      // gesture's first move (see jumpDrag.delta) — if the finger reverses
      // enough late in the gesture to flip which threshold attachSwipe
      // sees crossed, that no longer matches what the carousel was
      // prepared to slide to, so treat it as a cancel rather than commit
      // the wrong direction.
      onLeft: () => jumpDragSettle(!!jumpDrag && jumpDrag.delta === 1),
      onRight: () => jumpDragSettle(!!jumpDrag && jumpDrag.delta === -1),
      onMove: (dx) => jumpDragMove(dx),
      onSettle: () => jumpDragSettle(false),
    });
    attachSwipe($("#viewTabs"), {
      onLeft: () => {
        tabDrag = null;
        const next = VIEW_ORDER[VIEW_ORDER.indexOf(state.view) + 1];
        if (next) switchToView(next); else updateTabUnderline();
      },
      onRight: () => {
        tabDrag = null;
        const prev = VIEW_ORDER[VIEW_ORDER.indexOf(state.view) - 1];
        if (prev) switchToView(prev); else updateTabUnderline();
      },
      onMove: (dx) => tabDragMove(dx),
      onSettle: () => { tabDrag = null; updateTabUnderline(); },
    });

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
        // Tapping the tab you're already on scrolls back to the top, the way
        // every mobile app's tab bar does. Without this it ran a full
        // switchToView to the same view, and since render() deliberately
        // restores scroll position on a same-view rebuild, the tap looked
        // like it did nothing at all.
        if (t.dataset.view === state.view) {
          window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
          return;
        }
        switchToView(t.dataset.view);
      });
    // The storage status doubles as a shortcut into Settings → Data, so its
    // hints ("Reconnect in Settings", "set up Data in Settings", "GitHub
    // rejected your token…") are one tap away from where you'd act on them.
    $("#storageStatus").onclick = () => SettingsUI.openSettings();

    let scrollSaveTimer;
    window.addEventListener("scroll", () => {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(saveUiState, 300);
      syncJumpNavToScroll();
    }, { passive: true });
    // Debounced — render() rebuilds the whole current view from scratch, so
    // re-running it on every keystroke gets noticeably laggy once there are
    // a few hundred entries. 200ms feels instant while typing but collapses
    // a fast burst of keystrokes into a single render.
    let searchRenderTimer;
    // The ✕ tracks the value, not the focus, so a search you've clicked away
    // from is still one press from gone. Clearing renders straight away
    // rather than through the debounce below — that delay is there to
    // collapse a burst of keystrokes, and a single click isn't one.
    const syncSearchClear = () => { $("#searchClear").hidden = !$("#search").value; };
    $("#search").oninput = (e) => {
      state.search = e.target.value;
      syncSearchClear();
      clearTimeout(searchRenderTimer);
      searchRenderTimer = setTimeout(render, 200);
    };
    $("#searchClear").onclick = () => {
      $("#search").value = "";
      state.search = "";
      syncSearchClear();
      clearTimeout(searchRenderTimer);
      render();
      $("#search").focus();
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
      else if (b.dataset.add === "wheel") {
        // No pool of its own: the + menu's wheel is the list you typed, which
        // is why it opens straight into its editor when there isn't one yet.
        Wheel.openWheel({ custom: true, title: "Spin a wheel", hint: "Your own options — spin to let it decide." });
      }
    });
    document.addEventListener("click", closeAddMenu);

    wireCategorySelect("#fCategory", "#entryModal", false);

    Journal.wire(); // timeline entry modal, achievements, category management
    Finance.wire(); // finance/recurring/finance-category modals + finance import/export
    Backlog.wire(); // backlog modal: sync, priority/dropped, title suggestions
    Wheel.wire(); // the random wheel modal (Backlog "🎡 Spin" + the + menu)
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

    $("#closeShortcutsBtn").onclick = closeShortcutsModal;

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        Journal.closeEntryModal(); Journal.closeAchModal(); Journal.cancelCategoryModal(); Backlog.closeBacklogModal();
        Backlog.closePickModal(); Wheel.closeWheel();
        Finance.closeFinanceModal(); Finance.closeRecurringModal(); Finance.closeChangePlanModal();
        Finance.closePauseModal(); Finance.cancelFinanceCatModal(); SettingsUI.closeSettings();
        closeShortcutsModal();
        $("#addMenu").hidden = true;
        return;
      }
      // Everything below is a bare, unmodified key — skip while typing in a
      // field, a modal's already open (its own form fields aside — e.g. a
      // button inside one could still be focused), or a modifier is held,
      // so Ctrl/Cmd/Alt combos pass straight through to the browser.
      if (isTypingTarget(document.activeElement) || isAnyModalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") { e.preventDefault(); openShortcutsModal(); return; }
      if (e.key === "/") { e.preventDefault(); $("#search").focus(); return; }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); Journal.openEntryModal(null); return; }
      if (SHORTCUT_VIEWS[e.key]) { e.preventDefault(); switchToView(SHORTCUT_VIEWS[e.key]); return; }
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
    if (savedUi?.backlogMode) state.backlogMode = savedUi.backlogMode;

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
    else if (source === "merged") {
      toast(result.conflictSummary
        ? "Merged from your other device — " + result.conflictSummary
        : "Merged changes from your other device", !!result.conflictSummary);
    }
    else if (Storage.githubConnected && !githubReached) {
      toast("Offline — showing last saved copy; will sync when GitHub is reachable", true);
    }

    // PWA app shortcuts (manifest.json's `shortcuts`, long-press the
    // home-screen icon): ?action=… opens the matching add modal straight
    // away, skipping the open-then-navigate step. Stripped from the URL
    // immediately so a refresh/back-nav doesn't reopen it.
    const action = new URLSearchParams(location.search).get("action");
    if (action) {
      history.replaceState(null, "", location.pathname + location.hash);
      if (action === "add-entry") Journal.openEntryModal(null);
      else if (action === "add-expense") Finance.openFinanceModal(null);
    }

    if (state.pendingSync) retrySync();
    schedulePoll();
    Sync.maybeAutoCheckSteamWishlist(); // fire-and-forget, doesn't block startup
    Sync.maybeAutoCheckAniList(); // same — quiet background check, never blocks startup
    Sync.maybeAutoRefreshReleases(); // same — keeps upcoming release dates current in the background

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
    state, $, toast, persist, render, afterDataChange, DEFAULT_SETTINGS, isOverridden,
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
    refreshUpcomingReleases: Sync.refreshUpcomingReleases,
    updateRefreshReleasesButton: Sync.updateRefreshReleasesButton,
    DEFAULT_SETTINGS,
  });
  Journal.init({
    state, $, el, uid, activatable, toast, persist, render, renderLazySections, groupBy, countBy, colorOf,
    emptyCoverEl, monthCardHeader, bulkActionBar, bulkCheckbox, toggleBulkItem,
    attachLongPressSelect, animatedNumberText, barRow, fillSelect,
    fillCategorySelect, wireCategorySelect, resolvePendingCatSelect,
    rebuildColorMap, buildYearFilter, buildCatFilter, renderCoverLinkButtons, renderMediaLinks,
    isOverridden, sanitizeOverrides, initOverrideFields, refreshOverrideFields,
    pushOverrideValues, readOverrideChecks,
    applySteamAppId: Sync.applySteamAppId, backfillUpdatedAt, MONTHS, MONTHS_SHORT, MEDIA_SOURCE_LABELS,
    DEFAULT_SETTINGS, jumpToTimelineMonth,
  });
  Backlog.init({
    state, $, el, uid, toast, persist, render, renderLazySections, groupBy, colorOf,
    MEDIA_SOURCE_LABELS, saveVisualSettings,
    emptyState, emptyCoverEl, bulkActionBar, bulkCheckbox, toggleBulkItem,
    toggleBulkCategoryAll, attachLongPressSelect,
    openEntryModal: Journal.openEntryModal,
    fillCategorySelect, wireCategorySelect,
    titleSuggestions: Journal.titleSuggestions,
    backlogSuggestions: Journal.backlogSuggestions,
    makeMediaAcItem: Journal.makeMediaAcItem,
    fetchMediaSuggestions: Journal.fetchMediaSuggestions,
    renderStreamedSuggestions: Journal.renderStreamedSuggestions,
    resolveMediaIdentity: Journal.resolveMediaIdentity,
    updateSyncBtnVisibility: Journal.updateSyncBtnVisibility,
    showSyncStatus: Journal.showSyncStatus,
    renderCoverLinkButtons, renderMediaLinks, isOverridden, sanitizeOverrides,
    initOverrideFields, refreshOverrideFields, pushOverrideValues, readOverrideChecks,
    loadBacklogPrices: Sync.loadBacklogPrices, applySteamAppId: Sync.applySteamAppId,
    backfillUpdatedAt, saveUiState, MONTHS_SHORT, DEFAULT_SETTINGS,
  });
  Wheel.init({ $, toast, prefersReducedMotion, palette: CATEGORY_PALETTE });
  Finance.init({
    state, $, el, uid, groupBy, countBy, toast, persist, render, renderLazySections,
    buildYearFilter, buildCatFilter, monthCardHeader, emptyState,
    bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
    animatedNumberText, barRow, fillCategorySelect, wireCategorySelect,
    resolvePendingCatSelect, download: IO.download, csvEsc: IO.csvEsc, parseCsv: IO.parseCsv,
    buildImportItems: IO.buildImportItems, reviewAndImport: IO.reviewAndImport, openImportPicker: IO.openImportPicker,
    backfillUpdatedAt, MONTHS,
  });

  // Test-support export (mirrors every other module's window.LifeLogXxx
  // pattern) — lets test/app.test.js exercise normalize()'s migrations and
  // its small pure helpers directly via require(), without needing this
  // whole file's real bootstrap (Storage.load, wire()'s DOM wiring, etc).
  window.LifeLogApp = { normalize, backfillUpdatedAt, emptyData, ensureCategories };
  if (typeof module !== "undefined" && module.exports) module.exports = window.LifeLogApp;

  // `module` only exists under CommonJS (a Node `require()`, e.g. from a
  // test file) — never in a plain <script> browser load, so this only skips
  // the real bootstrap during a test require and changes nothing for the
  // actual app.
  if (typeof module === "undefined") init();
})();
