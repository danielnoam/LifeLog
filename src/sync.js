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
  const RELEASE_REFRESH_KEY = "lifelog-release-refresh-v1";
  // How long a fetched GG.deals price stays valid before a backlog re-render
  // re-fetches it; avoids re-querying the rate-limited API on every render.
  const PRICE_CACHE_MS = 15 * 60 * 1000;

  // Shared app plumbing, provided by app.js via init(ctx).
  let state, $, toast, persist, render, afterDataChange, DEFAULT_SETTINGS, isOverridden,
    buildImportItems, reviewAndImport, setBacklogCover, setEntryCover;

  function init(ctx) {
    ({ state, $, toast, persist, render, afterDataChange, DEFAULT_SETTINGS, isOverridden,
      buildImportItems, reviewAndImport, setBacklogCover, setEntryCover } = ctx);
  }

  // Builds the cover/media fields directly from a manually-entered Steam App
  // ID (see media.js — Steam's own search API is CORS-blocked from browsers).
  // Shared by the backlog and journal-entry modals; the backlog branch hands
  // its cover repaint back to backlog.js.
  function applySteamAppId(prefix) {
    const id = $("#" + prefix + "SteamAppId").value.trim();
    const coverUrl = id ? window.LifeLogMedia.steamCoverUrl(id) : "";
    // Pointing an item at a different App ID clears the metadata the old one
    // brought with it — except for anything pinned in Advanced, which is
    // yours and survives every sync path, this one included. (setEntryCover
    // applies the same rule itself for the journal branch.)
    const pinned = (key) => { const box = $("#" + prefix + "Ovr" + key); return !!(box && box.checked); };
    if (prefix === "b") {
      if (!pinned("Cover")) $("#bCoverUrl").value = coverUrl;
      $("#bMediaId").value = id;
      $("#bMediaSource").value = id ? "steam" : "";
      if (!pinned("Release")) {
        $("#bReleaseYear").value = "";
        $("#bReleaseDate").value = "";
      }
      if (!pinned("Rating")) $("#bExternalRating").value = "";
      $("#bSummary").value = "";
      if (!pinned("Length")) $("#bLength").value = "";
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
    // Items you've marked as bought are skipped: their price is no longer
    // rendered anywhere (see appendBacklogMeta in backlog.js), so fetching it
    // would spend GG.deals quota on a number with nowhere to go. The whole
    // backlog goes through here a category at a time, so on a list with a
    // lot of owned games that's most of the batch. Callers that only want
    // the cache warmed for a GG.deals *link* pass a bare { mediaSource,
    // mediaId } with no `bought` on it, so they're unaffected.
    const appIds = [...new Set(
      items.filter((b) => b.mediaSource === "steam" && b.mediaId && !b.bought).map((b) => b.mediaId)
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
  //
  // The same response also carries release_date: { coming_soon, date } —
  // Steam saying in its own words whether a game is out yet, and often in
  // the coarse form it genuinely knows ("Q1 2026"). That beats the fuzzy
  // RAWG title match this used to lean on for dates, so it's read here and
  // returned alongside the name. short_description comes back too: it's the
  // only description a wishlisted game can get without a RAWG key, and
  // wishlist imports were the largest block of backlog items with none. Returns null only when the whole lookup
  // failed; { name: null, ... } is a successful response for an app Steam
  // doesn't recognize.
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  async function fetchSteamAppInfo(proxyUrl, appid, attempt) {
    attempt = attempt || 0;
    try {
      const res = await fetch(`${proxyUrl}/steam-appdetails/${appid}`);
      if (res.status === 429 && attempt < 3) {
        await sleep(1500 * (attempt + 1));
        return fetchSteamAppInfo(proxyUrl, appid, attempt + 1);
      }
      if (!res.ok) return null;
      const data = await res.json();
      const entry = data && data[appid];
      if (!entry || !entry.success || !entry.data) return null;
      const rd = entry.data.release_date || {};
      const parsed = window.LifeLogMedia
        ? window.LifeLogMedia.parseSteamReleaseDate(rd.date)
        : { releaseDate: "", releasePrecision: "tba" };
      return {
        name: entry.data.name || null,
        summary: window.LifeLogMedia
          ? window.LifeLogMedia.firstParagraph(window.LifeLogMedia.stripHtml(entry.data.short_description))
          : "",
        release: {
          ...parsed,
          // Only when Steam actually stated it — a missing release_date block
          // is "we don't know", not "it's out", and shouldn't overrule a
          // date another source did manage to find.
          ...(typeof rd.coming_soon === "boolean"
            ? { releaseStatus: rd.coming_soon ? "upcoming" : "released" }
            : {}),
        },
      };
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
  // Thin wrapper so the release-field merge degrades gracefully if media.js
  // somehow isn't loaded (same defensive shape as the rest of this file's
  // window.LifeLogMedia use).
  function mergeRelease(...sources) {
    return window.LifeLogMedia ? window.LifeLogMedia.mergeRelease(...sources) : {};
  }

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
        const info = await fetchSteamAppInfo(proxyUrl, appid);
        const name = info && info.name;
        const rawg = name ? await fetchRawgInfo(name) : null;
        games.push({
          title: name || `Steam app ${appid}`,
          category,
          mediaSource: "steam",
          mediaId: String(appid),
          coverUrl: window.LifeLogMedia ? window.LifeLogMedia.steamCoverUrl(appid) : "",
          unresolved: !name,
          ...(info?.summary ? { summary: info.summary } : {}),
          ...(rawg?.externalRating ? { externalRating: rawg.externalRating } : {}),
          ...(rawg?.length ? { length: rawg.length } : {}),
          ...(rawg?.year ? { releaseYear: rawg.year } : {}),
          // Steam's own release info wins over RAWG's — it's the store this
          // game came from, not a name-matched guess (see mergeRelease).
          ...mergeRelease(rawg, info && info.release),
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
        const info = await fetchSteamAppInfo(proxyUrl, targets[i].mediaId);
        if (info && info.name) {
          targets[i].title = info.name;
          // The lookup that resolves the title carries the release info too,
          // so a retried item lands with the same data a fresh import gets.
          Object.assign(targets[i], mergeRelease(targets[i], info.release));
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
  function steamGameNeedsRawgInfo(b) {
    return !b.externalRating && !b.length && !b.releaseYear;
  }

  // Anything imported before Steam's own blurb was read (see
  // fetchSteamAppInfo) has no description at all, whatever else it has.
  function steamGamesNeedingInfo() {
    return state.data.backlog.filter((b) =>
      b.mediaSource === "steam" && b.mediaId &&
      b.title !== `Steam app ${b.mediaId}` &&
      (steamGameNeedsRawgInfo(b) || !b.summary)
    );
  }

  // Retroactively fills in what a Steam-sourced backlog item is missing:
  // RAWG's rating/length/release year (same best-effort top-match lookup the
  // sync uses) and Steam's own description, straight off the App ID the item
  // already carries. Each half needs its own credential — a RAWG key, the
  // CORS proxy — and runs only for the items actually missing that half.
  // Never touches title, cover, or mediaId.
  async function backfillRawgForSteamGames() {
    const rawgKey = state.data.settings.mediaKeys?.rawg;
    const proxyUrl = ((state.data.settings.steam || {}).proxyUrl || "").trim().replace(/\/+$/, "");
    if (!rawgKey && !proxyUrl) { toast("Set a RAWG API key or your proxy URL first (Settings → Media)", true); return; }
    const targets = steamGamesNeedingInfo();
    if (!targets.length) { toast("Nothing to backfill"); return; }
    const btn = $("#steamBackfillRawgBtn");
    if (btn) { btn.disabled = true; }
    let filled = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (btn) btn.textContent = `Backfilling… ${i + 1}/${targets.length}`;
        let touched = false;
        const rawg = rawgKey && steamGameNeedsRawgInfo(targets[i]) ? await fetchRawgInfo(targets[i].title) : null;
        if (rawg) {
          if (rawg.externalRating) targets[i].externalRating = rawg.externalRating;
          if (rawg.length) targets[i].length = rawg.length;
          if (rawg.year) targets[i].releaseYear = rawg.year;
          Object.assign(targets[i], mergeRelease(targets[i], rawg));
          touched = !!(rawg.externalRating || rawg.length || rawg.year);
        }
        if (!targets[i].summary && proxyUrl && window.LifeLogMedia) {
          const details = await window.LifeLogMedia.fetchSteamDetails(targets[i].mediaId, proxyUrl);
          if (details && details.summary) { targets[i].summary = details.summary; touched = true; }
        }
        if (touched) {
          targets[i].updatedAt = new Date().toISOString();
          filled++;
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
    const count = steamGamesNeedingInfo().length;
    btn.hidden = !count;
    hint.hidden = !count;
    if (count) btn.textContent = `🎮 Backfill missing game info (${count})`;
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

  // ---------- upcoming release re-check ----------
  // Backlog items waiting on a release are the one thing here that goes stale
  // by itself — a TBA gets a date, a date slips, a season starts airing — and
  // a "what's next" list is only worth reading if it's current. So this
  // re-asks each waiting item's own source, by the media id already stored on
  // it (never by title, so nothing can drift onto a different work).
  // Deliberately narrow: only items that are still unreleased, so a backlog of
  // hundreds costs a handful of requests.
  function backlogAwaitingRelease() {
    const Backlog = window.LifeLogBacklog;
    if (!Backlog) return [];
    // isAwaitingRelease covers an already-airing show with an episode still
    // ahead, not just things that haven't come out — a next-episode date is
    // the fastest-staling thing here, going out of date every week.
    // A pinned release date is excluded outright rather than fetched and
    // discarded: it keeps the button's count honest about how many items
    // this would actually re-check, and saves the requests.
    return state.data.backlog.filter(
      (b) => b.mediaId && b.mediaSource && !isOverridden(b, "release") && Backlog.isAwaitingRelease(b)
    );
  }

  // One item's fresh release info, or null if its source can't be re-asked
  // (no lookup by id, missing key/proxy, or the request failed).
  async function fetchItemRelease(item, keys, proxyUrl) {
    if (item.mediaSource === "steam") {
      if (!proxyUrl) return null;
      const info = await fetchSteamAppInfo(proxyUrl, item.mediaId);
      return info ? info.release : null;
    }
    if (!window.LifeLogMedia) return null;
    // proxyUrl matters for SteamGridDB too — it's CORS-blocked direct, so
    // without one there's nothing its re-check can call.
    return window.LifeLogMedia.fetchRelease(item.mediaId, item.mediaSource, keys, proxyUrl);
  }

  // Writes fresh release info onto an item, returning whether anything
  // actually moved. updatedAt is only stamped on a real change — every
  // stamped item is a merge candidate for the GitHub sync, so a re-check that
  // found nothing new must leave no trace.
  function applyItemRelease(item, fresh) {
    if (isOverridden(item, "release")) return false;
    const merged = mergeRelease(item, fresh);
    const keys = ["releaseDate", "releasePrecision", "releaseStatus", "nextAt", "nextLabel"];
    let changed = false;
    for (const k of keys) {
      const next = merged[k] || "";
      if ((item[k] || "") === next) continue;
      changed = true;
      if (next) item[k] = next; else delete item[k];
    }
    if (changed) item.updatedAt = new Date().toISOString();
    return changed;
  }

  async function refreshUpcomingReleases() {
    const targets = backlogAwaitingRelease();
    if (!targets.length) { toast("Nothing in your backlog is waiting on a release"); return; }
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    const proxyUrl = ((state.data.settings.steam || {}).proxyUrl || "").trim().replace(/\/+$/, "");
    const btn = $("#refreshReleasesBtn");
    if (btn) btn.disabled = true;
    let updated = 0, checked = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (btn) btn.textContent = `Checking… ${i + 1}/${targets.length}`;
        const fresh = await fetchItemRelease(targets[i], keys, proxyUrl);
        if (fresh) {
          checked++;
          if (applyItemRelease(targets[i], fresh)) updated++;
        }
        if (i < targets.length - 1) await sleep(300);
      }
      if (updated) { afterDataChange(); await persist(); }
      markReleasesChecked();
      if (!checked) toast("None of these sources can be re-checked — they have no lookup by id", true);
      else toast(updated
        ? `Updated ${updated} release date${updated === 1 ? "" : "s"} of ${checked} checked`
        : `Checked ${checked} — nothing has changed`);
    } finally {
      if (btn) btn.disabled = false;
      updateRefreshReleasesButton();
    }
  }

  function updateRefreshReleasesButton() {
    const btn = $("#refreshReleasesBtn");
    if (!btn) return;
    const count = backlogAwaitingRelease().length;
    btn.disabled = !count;
    btn.textContent = count
      ? `🔭 Re-check upcoming release dates (${count})`
      : "🔭 Re-check upcoming release dates";
  }

  function markReleasesChecked() {
    try { localStorage.setItem(RELEASE_REFRESH_KEY, JSON.stringify({ lastCheckedAt: new Date().toISOString() })); } catch (e) {}
  }

  // Unlike the Steam/AniList auto-checks, which only count and toast, this one
  // does update items — but it only ever refreshes dates on things already in
  // the backlog, never adds or removes anything, so there's nothing to review.
  // Silent either way: no toast on success, since the point is that the list
  // is simply correct when you open it.
  async function maybeAutoRefreshReleases() {
    const days = parseInt((state.data.settings.releases || {}).autoRefreshDays, 10) || 0;
    if (!days) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(RELEASE_REFRESH_KEY)); } catch (e) {}
    const lastAt = (last && last.lastCheckedAt) ? new Date(last.lastCheckedAt).getTime() : 0;
    if (Date.now() - lastAt < days * 24 * 60 * 60 * 1000) return;
    const targets = backlogAwaitingRelease();
    if (!targets.length) { markReleasesChecked(); return; }
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    const proxyUrl = ((state.data.settings.steam || {}).proxyUrl || "").trim().replace(/\/+$/, "");
    let updated = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const fresh = await fetchItemRelease(targets[i], keys, proxyUrl);
        if (fresh && applyItemRelease(targets[i], fresh)) updated++;
        if (i < targets.length - 1) await sleep(300);
      }
      if (updated) { afterDataChange(); await persist(); render(); }
    } catch (e) {
      // quiet — unattended background work, not a user action
    } finally {
      markReleasesChecked();
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
            ...mergeRelease(m),
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
    refreshUpcomingReleases,
    updateRefreshReleasesButton,
    maybeAutoRefreshReleases,
  };
})();
