// LifeLog — external wishlist/planning-list sync: the Steam wishlist and
// AniList Planning imports, which both follow the same shape (fetch an
// external list, dedupe against the backlog/Journal, route through the
// shared review picker, plus a quiet background auto-check) so they share
// one module rather than each getting a thin file of their own. Also holds
// the manual Steam App ID cover-art helper shared by the backlog/journal
// modals, and GG.deals price lookups/caching. Extracted from app.js; shared
// app plumbing and the cross-module cover setters it needs arrive via
// init(ctx), and everything app.js/settings.js still call directly is
// exposed on window.LifeLogSync.
(function () {
  // Local-only (per-device) — when this device last ran each quiet
  // background check, so the cadence in Settings isn't re-evaluated on
  // every app open. Deliberately not synced: each device paces its own
  // checks, and Steam/AniList are paced independently of each other.
  const STEAM_SYNC_KEY = "lifelog-steam-autosync-v1";
  const ANILIST_SYNC_KEY = "lifelog-anilist-autosync-v1";
  // How long a fetched GG.deals price stays valid before a backlog re-render
  // re-fetches it; avoids re-querying the rate-limited API on every render.
  const PRICE_CACHE_MS = 15 * 60 * 1000;

  // Shared app plumbing, provided by app.js via init(ctx).
  let state, $, toast, persist, afterDataChange, DEFAULT_SETTINGS,
    buildImportItems, reviewAndImport, setBacklogCover, setEntryCover;

  function init(ctx) {
    ({ state, $, toast, persist, afterDataChange, DEFAULT_SETTINGS,
      buildImportItems, reviewAndImport, setBacklogCover, setEntryCover } = ctx);
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
      setBacklogCover();
    } else {
      setEntryCover(coverUrl, id, id ? "steam" : "", "");
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

  // Whether a price lookup for this mediaId has already landed (successful
  // or not) — lets a caller decide between showing the GG.deals link now vs.
  // kicking off loadBacklogPrices first, without reaching into priceCache.
  function hasPriceCached(mediaId) {
    return priceCache.has(mediaId);
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

  window.LifeLogSync = {
    init,
    applySteamAppId,
    loadBacklogPrices,
    ggDealsPageUrl,
    hasPriceCached,
    syncSteamWishlist,
    retryUnresolvedSteamTitles,
    updateSteamRetryUnresolvedButton,
    backfillRawgForSteamGames,
    updateSteamBackfillRawgButton,
    maybeAutoCheckSteamWishlist,
    syncAniListPlanning,
    maybeAutoCheckAniList,
  };
})();
