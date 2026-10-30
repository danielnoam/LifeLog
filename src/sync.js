// LifeLog — external wishlist/planning-list sync: the Steam wishlist and
// AniList list imports, which both follow the same shape (fetch an
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
  // Per item, when this device last re-asked its source (0.271.0), so a date
  // that has just arrived is asked about once or twice, not on every open.
  const RELEASE_ASKED_KEY = "lifelog-release-asked-v1";
  // How long a fetched GG.deals price stays valid before a backlog re-render
  // re-fetches it; avoids re-querying the rate-limited API on every render.
  const PRICE_CACHE_MS = 15 * 60 * 1000;

  // Shared app plumbing, provided by app.js via init(ctx).
  let state, $, toast, persist, render, afterDataChange, DEFAULT_SETTINGS, isOverridden,
    buildImportItems, importItemIncomplete, reviewAndImport, setBacklogCover, setEntryCover, whenSynced;

  function init(ctx) {
    ({ state, $, toast, persist, render, afterDataChange, DEFAULT_SETTINGS, isOverridden,
      buildImportItems, importItemIncomplete, reviewAndImport, setBacklogCover, setEntryCover, whenSynced } = ctx);
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
  // App IDs a fetch is out for. At launch the Backlog's render and the
  // price-alert check (0.276.0) both ask within the same tick, before
  // either answer is in the cache; the second asker leaves those to the
  // first, whose landing patches and checks its own items.
  const priceInFlight = new Set();

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
    const proxyUrl = window.LifeLogPlatform.steamProxy(state.data.settings.steam?.proxyUrl);
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
      if (priceInFlight.has(id)) return false;
      const cached = priceCache.get(id);
      return !cached || now - cached.ts > PRICE_CACHE_MS;
    });
    if (!appIds.length) {
      applyCachedPrices(items);
      checkPriceAlerts(items);
      return;
    }
    for (let i = 0; i < appIds.length; i += 100) {
      const chunk = appIds.slice(i, i + 100);
      chunk.forEach((id) => priceInFlight.add(id));
      let result = {};
      try {
        result = await window.LifeLogMedia.fetchPrices(chunk, apiKey, proxyUrl);
      } finally {
        chunk.forEach((id) => priceInFlight.delete(id));
      }
      const err = window.LifeLogMedia.getLastError();
      if (err && !priceErrorToasted) { priceErrorToasted = true; toast(err, true); }
      for (const id of chunk) priceCache.set(id, { ts: now, data: result[id] || null });
      priceEpoch++;
    }
    applyCachedPrices(items);
    checkPriceAlerts(items);
  }

  // Price alerts (0.276.0): an item with `priceAlert` (a USD target, set in
  // its sheet) is compared with the retail price every time one lands.
  // At or under it, the hit is recorded once (alerts.js) — a toast here,
  // and on a phone a notification a minute later off the snapshot — and
  // stays recorded until the price climbs back over the target, so one
  // sale rings once. Bought items are not fetched at all (see above), so
  // they never get here.
  function checkPriceAlerts(items) {
    const A = window.LifeLogAlerts;
    if (!A) return;
    for (const b of items) {
      if (!(b.priceAlert > 0) || !b.id || b.dropped) continue;
      const current = backlogPriceOf(b);
      if (current == null) continue;
      if (current > b.priceAlert) { A.priceClear(b.id); continue; }
      if (!A.priceHit(b, current)) continue;
      toast(b.title + " is $" + current.toFixed(2) + ", under your $" + Number(b.priceAlert).toFixed(2), false,
        { label: "Show", onClick: () => window.LifeLogBacklog && window.LifeLogBacklog.openBacklogModal(b) });
    }
  }

  // As the app opens and each time it comes back: the watched games only,
  // so a backlog that never shows its prices still gets its alerts. One
  // request for up to a hundred of them, and none within the cache's
  // quarter hour.
  function maybeCheckPriceAlerts() {
    const watched = state.data.backlog.filter((b) => b.priceAlert > 0 && b.mediaSource === "steam" && b.mediaId && !b.bought && !b.dropped);
    return watched.length ? loadBacklogPrices(watched) : Promise.resolve();
  }

  // ---------- How Long to Beat times and review scores (0.282.0) ----------
  // A Steam game's three times (story, story + extras, completionist, in
  // minutes) and its OpenCritic and Metacritic user scores, from Augmented
  // Steam's API (media.js fetchGameInfo), kept on the item as `hltb` (with
  // the day they were asked, `at`) and `reviews`. The story time becomes the
  // game's length in place of RAWG's average playtime, unless the length is
  // pinned. Games with no Steam App ID keep whatever length they had.
  // Asked again after a month (times settle as people log them); a game
  // with nothing known is remembered on this device for two weeks so it
  // isn't asked on every launch, and one whose lookup failed waits a day
  // (0.282.3), so a game the route keeps failing on can't hold the same
  // forty in front of every launch. Settings → Imports turns it off.
  const GAME_TIMES_KEY = "lifelog-gametimes-v1";
  const GAME_TIMES_MISS_DAYS = 14, GAME_TIMES_FAIL_DAYS = 1, GAME_TIMES_PER_RUN = 40;
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); };
  const daysSince = (day) => (/^\d{4}-\d{2}-\d{2}$/.test(day || "") ? (Date.now() - new Date(day + "T00:00:00").getTime()) / dayMs : Infinity);
  // `steam.gameTimes` is "off" or how many days a game's times stay fresh:
  // "1", "3", "7" or "30" (0.282.3). "on", from before there was a choice,
  // is a month.
  const gameTimesSetting = () => String((state.data.settings.steam || {}).gameTimes || "30");
  const gameTimesOn = () => gameTimesSetting() !== "off";
  const gameTimesFreshDays = () => { const n = parseInt(gameTimesSetting(), 10); return n > 0 ? n : 30; };
  const hasSteamId = (x) => x && x.mediaSource === "steam" && /^\d+$/.test(String(x.mediaId || ""));
  function gameTimesMisses() {
    try { return JSON.parse(localStorage.getItem(GAME_TIMES_KEY)) || {}; } catch (e) { return {}; }
  }
  // Each entry is the day a game came back empty, or "f:" + the day its
  // lookup failed.
  const missWaited = (v) => (String(v || "").startsWith("f:")
    ? daysSince(v.slice(2)) > GAME_TIMES_FAIL_DAYS
    : daysSince(v) > GAME_TIMES_MISS_DAYS);
  function noteGameTimesMiss(appId, missed, failed) {
    const all = gameTimesMisses();
    if (failed) all[appId] = "f:" + todayStr();
    else if (missed) all[appId] = todayStr();
    else delete all[appId];
    for (const k of Object.keys(all)) if (missWaited(all[k])) delete all[k];
    try { localStorage.setItem(GAME_TIMES_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function gameTimesDue(x, misses) {
    if (!hasSteamId(x)) return false;
    if (x.hltb && daysSince(x.hltb.at) < gameTimesFreshDays()) return false;
    return missWaited((misses || gameTimesMisses())[x.mediaId]);
  }
  // Writes an answer onto the item; true when anything it shows changed.
  // A game with reviews but no times still gets `hltb: { at }`, so the
  // month's wait applies to it too.
  function applyGameTimes(x, info) {
    const shown = () => JSON.stringify([x.hltb && { ...x.hltb, at: "" }, x.reviews, x.length]);
    const before = shown();
    const { hltb, reviews } = info || {};
    x.hltb = { ...(hltb || {}), at: todayStr() };
    if (reviews) x.reviews = reviews;
    if (hltb && hltb.story && !isOverridden(x, "length")) x.length = window.LifeLogMedia.gameHours(hltb.story);
    return shown() !== before;
  }
  // One game, now: what a sheet asks for when it opens on a Steam game with
  // no times, or old ones. Resolves to { hltb, reviews } or null, never
  // throws.
  async function gameTimesFor(appId) {
    if (!gameTimesOn() || !window.LifeLogMedia || !/^\d+$/.test(String(appId || ""))) return null;
    const proxyUrl = window.LifeLogPlatform.steamProxy((state.data.settings.steam || {}).proxyUrl);
    if (!proxyUrl) return null;
    try {
      const info = await window.LifeLogMedia.fetchGameInfo(appId, proxyUrl);
      noteGameTimesMiss(appId, !info.hltb && !info.reviews);
      return info;
    } catch (e) {
      return null;
    }
  }
  // Quietly in the background, as the app opens: the Steam games in the
  // Backlog and the Timeline with no times or month-old ones, a few dozen a
  // launch so a big library fills in over a few days instead of in one
  // burst. Not in the background refresh: it's a nicety, not a heads-up.
  let gameTimesRunning = false;
  async function maybeFillGameTimes() {
    if (gameTimesRunning || !gameTimesOn() || !window.LifeLogMedia || window.LifeLogPlatform.headless) return;
    const proxyUrl = window.LifeLogPlatform.steamProxy((state.data.settings.steam || {}).proxyUrl);
    if (!proxyUrl) return;
    const misses = gameTimesMisses();
    const targets = [...state.data.backlog, ...state.data.entries].filter((x) => gameTimesDue(x, misses)).slice(0, GAME_TIMES_PER_RUN);
    if (!targets.length) return;
    gameTimesRunning = true;
    let updated = 0, answered = 0, failedInARow = 0, lastError = null;
    try {
      await window.LifeLogJobs.run({ label: "Game times from How Long to Beat", lane: "media" }, async (job) => {
        for (let i = 0; i < targets.length && !job.stopping; i++) {
          job.progress(i, targets.length, targets[i].title);
          let info;
          try {
            info = await window.LifeLogMedia.fetchGameInfo(targets[i].mediaId, proxyUrl);
            noteGameTimesMiss(targets[i].mediaId, !info.hltb && !info.reviews);
            answered++; failedInARow = 0;
          } catch (e) {
            // That game waits a day. Three in a row and the route itself is
            // down (an old proxy, offline): stop rather than ask forty times
            // to hear the same thing.
            lastError = e;
            noteGameTimesMiss(targets[i].mediaId, true, true);
            if (++failedInARow >= 3) break;
            continue;
          }
          // The item may have been edited or removed while this waited.
          const live = [...state.data.backlog, ...state.data.entries].find((x) => x.id === targets[i].id);
          if (live && applyGameTimes(live, info)) updated++;
          job.progress(i + 1, targets.length);
          if (i < targets.length - 1) await job.sleep(400);
        }
        if (updated) { afterDataChange(); await persist(); render(); }
        // Said in Activity, with what went wrong, rather than a quiet
        // "Nothing new" that looks like it worked.
        if (!answered && lastError) throw new Error("Couldn't reach Augmented Steam: " + (lastError.message || lastError));
        job.finish(updated ? `Times for ${updated} game${updated === 1 ? "" : "s"}` : "Nothing new");
      });
    } catch (e) {
      // quiet — unattended background work
    } finally {
      gameTimesRunning = false;
    }
  }

  // Toasted at most once per session — loadBacklogPrices reruns on every
  // backlog render/poll, and a persistent failure (bad key, CORS) shouldn't
  // re-announce itself every time.
  let priceErrorToasted = false;

  // The number behind the "$12.34 (low $7.99)" string, for sorting by it.
  // null means "no price known" — not free, and not zero, which is why the
  // sort has to put these somewhere deliberate rather than treat them as 0.
  function backlogPriceOf(b) {
    if (!b || b.mediaSource !== "steam" || !b.mediaId) return null;
    const cached = priceCache.get(b.mediaId);
    if (!cached || !cached.data) return null;
    const current = currentRetailPrice(cached.data.prices || {});
    return current == null ? null : current;
  }

  // Bumped whenever a fetch puts something new in the cache. Prices arrive
  // long after the render that asked for them, and applyCachedPrices only
  // patches the price spans in place — so a list *ordered* by price would
  // stay in its priceless order until something else redrew it. The backlog
  // watches this to redraw itself once, and only when it is sorted by price.
  let priceEpoch = 0;

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
      if (b.priceAlert > 0 && current <= b.priceAlert) text += " · under your $" + Number(b.priceAlert).toFixed(2);
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
  // just falls back to a placeholder title rather than failing the whole sync.
  //
  // Parsing that response is media.js's job (fetchSteamAppDetails), which is
  // also where the release fields, the blurb and the Early Access marker are
  // read off it — this used to be a second copy of all of that, and a field
  // added to one was a field missing from the other. The retry count is the
  // one thing that belongs here rather than there: an import walks a whole
  // wishlist, Steam starts rate-limiting partway through, and every request
  // after that point would otherwise fail identically.
  async function fetchSteamAppInfo(proxyUrl, appid) {
    if (!window.LifeLogMedia) return null;
    return window.LifeLogMedia.fetchSteamAppDetails(appid, proxyUrl, 3);
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
      // pickMatch, not results[0]: this game's identity is already settled by
      // its Steam App ID, and RAWG is only being asked to fill in a rating,
      // length and year. Taking its top guess meant BioShock could quietly
      // end up with BioShock Infinite's numbers — worse than having none,
      // because nothing about the item then looks wrong.
      return window.LifeLogMedia.pickMatch(results, title) || null;
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
  // The passes over the backlog keep what they've done every few items, so
  // the app being killed halfway loses little, and running one again (from
  // Activity, 0.245.0) only does what's left.
  const SAVE_EVERY = 5;

  // ---------- the import runner ----------
  // Steam and AniList were two bespoke flows that did the same four things in
  // the same order and shared none of it: validate the settings, fetch with
  // some progress showing, map each result to a backlog item, hand the lot to
  // the review picker. A source now declares only what differs.
  //
  //   id       button to disable and relabel while it runs
  //   label    what the review screen is called
  //   hint     what it says under that
  //   plan()   validates settings; returns { ctx } or { error } — the error
  //            is the toast, so a source words its own missing-setup message
  //   fetch(ctx, report)  returns raw records, calling report(done, total)
  //            as it goes; returns null to mean "the source itself failed",
  //            which is kept distinct from "reachable, but empty"
  //   toItem(raw, ctx)    one raw record to one backlog item
  //   empty(ctx)          the toast when it came back reachable but empty
  //
  // Everything else — the button state, the try/finally, the error wording,
  // the build-and-review handoff — happens once, here.
  //
  // It runs as a job (src/jobs.js), so it shows in Activity, keeps going with
  // the phone app put away, and can be stopped: a stopped fetch hands over
  // what it had fetched so far, to review like a finished one.
  async function runImport(source) {
    const plan = source.plan();
    if (plan.error) { toast(plan.error, true); return; }
    const ctx = plan.ctx;
    const btn = $("#" + source.id);
    const label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = window.LifeLogJobs.busy(source.lane) ? "Waiting…" : "Syncing…"; }
    try {
      await window.LifeLogJobs.run({ label: "Syncing " + source.label, lane: source.lane, again: source.id }, async (job) => {
        if (btn) btn.textContent = "Syncing…";
        const report = (done, total, detail) => {
          job.progress(done, total, detail);
          if (btn) btn.textContent = total ? `Fetching… ${done}/${total}` : "Syncing…";
        };
        let raw;
        try { raw = await source.fetch(ctx, report, job); }
        catch (e) {
          const msg = source.label + " failed (" + ((e && e.message) || "network error") + ")";
          if (!job.stopping) toast(msg, true);
          throw new Error(msg);
        }
        if (raw === null) { job.fail(source.label + " couldn't be reached"); return; } // fetch() has already said why
        if (job.stopping && !raw.length) { job.finish("Stopped before anything was fetched"); return; }
        if (!raw.length) { const m = source.empty(ctx); toast(m); job.finish(m); return; }
        // A source makes backlog items unless it says "entry" (the Steam
        // backfill, 0.253.0: things you have played are things you did).
        // A source that makes more than one kind builds its own rows
        // (AniList, 0.265.0: backlog items, and timeline entries for what
        // you've finished).
        const kind = source.kind || "backlog";
        const built = source.build ? source.build(raw, ctx) : (() => {
          const mapped = raw.map((r) => source.toItem(r, ctx));
          return buildImportItems(kind === "entry" ? { entries: mapped, categories: [] } : { backlog: mapped, categories: [] });
        })();
        if (!built.items.length) { const m = kind === "entry" ? "Nothing new — every game is already logged" : "Nothing new — everything is already in your backlog"; toast(m); job.finish(m); return; }
        // Which new rows start ticked: the review's default is every new
        // one, and a source with a lot of noise in it says otherwise.
        if (source.ticked) for (const it of built.items) if (!it.dup) it.checked = source.ticked(it.entry);
        // What you left unticked last time stays out of the way (0.257.0):
        // hidden behind "Show skipped", unticked, until you tick it there.
        const skipKey = (it) => (it.entry.mediaSource || "") + ":" + (it.entry.mediaId || "");
        const skips = new Set(((state.data.settings.importSkips || {})[source.skipKey] || []));
        for (const it of built.items) if (!it.dup && it.entry.mediaId && skips.has(skipKey(it))) { it.skipped = true; it.checked = false; }
        job.finish(job.stopping ? `Stopped — ${raw.length} fetched, sent to review` : `${built.items.length} to review`);
        const rememberSkips = async (selected) => {
          if (!source.skipKey) return;
          const chosen = new Set(selected);
          const next = new Set(skips);
          for (const it of built.items) {
            if (it.dup || !it.entry.mediaId) continue;
            if (chosen.has(it)) next.delete(skipKey(it)); else next.add(skipKey(it));
          }
          const all = { ...(state.data.settings.importSkips || {}) };
          if (next.size) all[source.skipKey] = [...next]; else delete all[source.skipKey];
          state.data.settings.importSkips = all;
          await persist();
        };
        reviewAndImport(source.label, source.hint, built, rememberSkips, source.picker ? source.picker(built) : undefined);
      });
    } catch (e) {
      // Already said in a toast, and kept in Activity.
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  // ---------- Steam wishlist ----------
  const steamWishlistSource = {
    id: "steamWishlistSyncBtn",
    label: "Steam Wishlist",
    lane: "steam",
    skipKey: "steamWishlist",
    hint: "Review which wishlisted games to add. Anything already in your backlog is marked — if this sync can fill in a cover, rating or release date it doesn't have, that row says so and is ticked.",
    plan() {
      const cfg = state.data.settings.steam || DEFAULT_SETTINGS.steam;
      const proxyUrl = window.LifeLogPlatform.steamProxy(cfg.proxyUrl);
      const steamId = (cfg.steamId || "").trim();
      const category = cfg.wishlistCategory || "";
      if (!proxyUrl || !steamId) return { error: "Set your proxy URL and SteamID64 first" };
      if (!category) return { error: "Choose a category to import into first" };
      return { ctx: { proxyUrl, steamId, category } };
    },
    async fetch(ctx, report, job) {
      // window.fetch spelled out: this method is itself called `fetch`, and
      // although shorthand doesn't bind the name, reading it here shouldn't
      // require knowing that.
      report(0, 0, "Reading your wishlist…");
      const res = await window.fetch(`${ctx.proxyUrl}/steam-wishlist/${encodeURIComponent(ctx.steamId)}`, { signal: job.signal });
      if (!res.ok) { toast(`Couldn't read your Steam wishlist (Steam answered ${res.status}) — check it's public and try again`, true); return null; }
      const data = await res.json();
      const items = (data && data.response && data.response.items) || [];
      ctx.wishlistCount = items.length;
      if (!items.length) return [];
      // The per-app lookups are the slow part — two requests and a courtesy
      // pause each — so they are spent on two kinds of appid only: ones not in
      // the backlog at all, and ones that are but are still missing something
      // an import could fill. A wishlisted game already sitting there complete
      // is skipped, which is most of them on every sync after the first.
      //
      // Skipping the incomplete ones as well (which the first version of this
      // did) would have made the update feature useless for Steam: the items
      // most likely to need a cover or a rating are exactly the ones already
      // imported.
      const bySteamId = new Map(
        state.data.backlog.filter((b) => b.mediaSource === "steam" && b.mediaId).map((b) => [b.mediaId, b])
      );
      const fresh = items.filter((it) => {
        const have = bySteamId.get(String(it.appid));
        return !have || importItemIncomplete(have);
      });
      const out = [];
      for (let i = 0; i < fresh.length && !job.stopping; i++) {
        report(i, fresh.length, "Looking up app " + fresh[i].appid);
        const appid = fresh[i].appid;
        const info = await fetchSteamAppInfo(ctx.proxyUrl, appid);
        const name = info && info.name;
        if (job.stopping) break;
        const rawg = name ? await fetchRawgInfo(name) : null;
        out.push({ appid, info, rawg, name });
        report(i + 1, fresh.length, name || "");
        if (i < fresh.length - 1) await job.sleep(500);
      }
      return out;
    },
    toItem({ appid, info, rawg, name }, ctx) {
      return {
        title: name || `Steam app ${appid}`,
        category: ctx.category,
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
      };
    },
    // Two different nothings: a wishlist that came back empty (usually a
    // privacy setting) and a wishlist where every game is already in your
    // backlog with nothing left to fill. Telling the second one to check its
    // privacy settings sends you looking for a problem you don't have.
    empty: (ctx) => (ctx.wishlistCount
      ? "Nothing new — every wishlisted game is already in your backlog, with nothing left to fill in"
      : "Wishlist came back empty — check it's set to Public in your Steam privacy settings"),
  };

  // ---------- Steam: the games you've played (0.253.0) ----------
  // Steam knows what you own and how long you played it, and nothing about
  // finishing, so this can't write "finished in March". What it can do is
  // the backfill, once: every game with time in it, as an entry in the
  // month it was last played, with the hours as its length. The review
  // starts with the ones you gave two hours or more ticked; the rest are
  // there to tick. Needs a Steam Web API key (steamcommunity.com/dev/apikey)
  // since GetOwnedGames is keyed, unlike the wishlist.
  const PLAYED_TICK_MINUTES = 120;
  function ownedToEntry(game, category, now) {
    const when = game.rtime_last_played ? new Date(game.rtime_last_played * 1000) : (now || new Date());
    const y = when.getFullYear(), m = when.getMonth() + 1, d = when.getDate();
    const hours = Math.round((game.playtime_forever || 0) / 60 * 10) / 10;
    const e = {
      title: game.name || `Steam app ${game.appid}`, category,
      year: y, month: m, date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      mediaSource: "steam", mediaId: String(game.appid),
      coverUrl: window.LifeLogMedia ? window.LifeLogMedia.steamCoverUrl(game.appid) : "",
      createdAt: when.toISOString(),
    };
    if (hours) e.length = (hours >= 10 ? Math.round(hours) : hours) + " hrs";
    if (!game.rtime_last_played) e.notes = "Last played: Steam didn't say";
    return e;
  }
  const steamOwnedSource = {
    id: "steamOwnedSyncBtn",
    label: "Steam games played",
    lane: "steam",
    skipKey: "steamOwned",
    kind: "entry",
    hint: "Every game with time in it, as an entry in the month you last played it, hours as its length. Two hours or more starts ticked; the rest you can tick. Games already in your Timeline or Backlog are hidden.",
    plan() {
      const cfg = state.data.settings.steam || DEFAULT_SETTINGS.steam;
      const proxyUrl = window.LifeLogPlatform.steamProxy(cfg.proxyUrl);
      const steamId = (cfg.steamId || "").trim();
      const apiKey = (cfg.apiKey || "").trim();
      const category = cfg.wishlistCategory || "";
      if (!proxyUrl || !steamId) return { error: "Set your proxy URL and SteamID64 first" };
      if (!apiKey) return { error: "Paste your Steam Web API key first — Steam only lists owned games with one" };
      if (!category) return { error: "Choose a category to import into first" };
      return { ctx: { proxyUrl, steamId, apiKey, category } };
    },
    async fetch(ctx, report, job) {
      report(0, 0, "Reading your games…");
      const res = await window.fetch(`${ctx.proxyUrl}/steam-owned/${encodeURIComponent(ctx.steamId)}?key=${encodeURIComponent(ctx.apiKey)}`, { signal: job.signal });
      if (!res.ok) { toast(`Couldn't read your Steam games (Steam answered ${res.status}) — check the key, and that Game details are public`, true); return null; }
      const data = await res.json();
      const games = (data && data.response && data.response.games) || [];
      ctx.ownedCount = games.length;
      const have = new Set([...state.data.backlog, ...state.data.entries].filter((x) => x.mediaSource === "steam" && x.mediaId).map((x) => x.mediaId));
      return games.filter((g) => g.playtime_forever > 0 && !have.has(String(g.appid))).sort((a, b) => b.playtime_forever - a.playtime_forever);
    },
    toItem: (game, ctx) => ownedToEntry(game, ctx.category),
    ticked: (entry) => parseFloat(entry.length) * 60 >= PLAYED_TICK_MINUTES,
    // The review's "Played at least N hrs" line: what's under it is hidden
    // and unticked, so the one-minute demos never need unticking by hand.
    picker: () => ({ threshold: { label: "Played at least", unit: "hrs", value: 1, step: 0.5, sortLabel: "Most played", of: (item) => parseFloat(item.entry.length) || 0 } }),
    empty: (ctx) => (ctx.ownedCount
      ? "Nothing new — every game you've played is already logged"
      : "Steam listed no games — check the key, and that Game details are Public in your privacy settings"),
  };
  const syncSteamOwned = () => runImport(steamOwnedSource);

  // ---------- AniList ----------
  // Every list, one review (0.265.0, the rest in 0.268.0). Planning comes in
  // as backlog items, as it always has. Watching comes in as backlog items
  // already in progress, or starts the one you already have. A Completed
  // title in your backlog moves to the timeline the way Done does, in the
  // month AniList says you finished it, with your score; one you have
  // nowhere comes in as timeline history. Paused and Dropped come in as
  // dropped backlog items, or drop the one you have.
  const pad2 = (n) => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); };
  const ANILIST_SOURCE = { ANIME: "anilist-anime", MANGA: "anilist-manga" };

  function anilistPulls(cfg) {
    const pulls = [];
    if (cfg.animeCategory) pulls.push(["ANIME", cfg.animeCategory]);
    if (cfg.mangaCategory) pulls.push(["MANGA", cfg.mangaCategory]);
    return pulls;
  }

  // Raw records for every type with a category, or null when every type
  // failed (one failing still hands over the other).
  async function fetchAniList(ctx, report, job) {
    const pulls = anilistPulls(ctx);
    let failed = false;
    const out = [];
    for (let i = 0; i < pulls.length && !job.stopping; i++) {
      const [type, category] = pulls[i];
      if (report) report(i, pulls.length, type === "ANIME" ? "Reading your anime lists…" : "Reading your manga lists…");
      // null is a hard failure (network, private list, unknown user), kept
      // distinct from an empty-but-reachable list.
      const media = await window.LifeLogMedia.fetchAniListLists(ctx.userName, type, ctx.token);
      if (media === null) { failed = true; continue; }
      for (const m of media) out.push({ m, category });
      if (report) report(i + 1, pulls.length);
    }
    return !out.length && failed ? null : out;
  }

  function aniListBacklogItem(m, category) {
    return {
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
      ...(m.listStatus === "current" ? { startedAt: m.startedAt || today() } : {}),
    };
  }

  // The timeline entry a Completed title becomes: the backlog item's own
  // title, category and media, filed under the month AniList has it
  // finished (this month when it has no date), spanning back to when it was
  // started, rated with your AniList score.
  function aniListFinishedEntry(b, m) {
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(m.completedAt || "");
    const done = dated ? m.completedAt : today();
    const year = +done.slice(0, 4), month = +done.slice(5, 7);
    const e = { title: b.title, category: b.category, year, month, date: year + "-" + pad2(month), backlogAddedAt: b.createdAt || null };
    if (dated) e.day = +done.slice(8, 10);
    for (const k of ["coverUrl", "mediaId", "mediaSource", "length", "genres", "author", "notes", "externalRating"]) if (b[k]) e[k] = b[k];
    const started = /^\d{4}-\d{2}-\d{2}$/.test(b.startedAt || "") ? b.startedAt : (m.startedAt || "");
    if (started && started <= done) {
      e.startedAt = started;
      const sy = +started.slice(0, 4), sm = +started.slice(5, 7);
      if (sy * 12 + sm < year * 12 + month) { e.startYear = sy; e.startMonth = sm; }
    }
    if (m.score >= 1) e.rating = Math.min(5, m.score);
    return e;
  }

  // A Completed title you have nowhere, as timeline history: filed under
  // the month AniList has it finished, or started when it has no finish.
  // With neither it goes under this month, unticked and saying why, since
  // a whole list imported from elsewhere can carry no dates at all.
  function aniListHistoryEntry(m, category) {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const when = day.test(m.completedAt || "") ? m.completedAt : day.test(m.startedAt || "") ? m.startedAt : "";
    const done = when || today();
    const year = +done.slice(0, 4), month = +done.slice(5, 7);
    const e = { title: m.title || "", category, year, month, date: year + "-" + pad2(month), mediaSource: m.source, mediaId: m.id };
    if (day.test(m.completedAt || "")) e.day = +m.completedAt.slice(8, 10);
    for (const k of ["coverUrl", "length", "genres"]) if (m[k] && (!Array.isArray(m[k]) || m[k].length)) e[k] = m[k];
    if (when && day.test(m.startedAt || "") && m.startedAt < when) {
      e.startedAt = m.startedAt;
      const sy = +m.startedAt.slice(0, 4), sm = +m.startedAt.slice(5, 7);
      if (sy * 12 + sm < year * 12 + month) { e.startYear = sy; e.startMonth = sm; }
    }
    if (m.score >= 1) e.rating = Math.min(5, m.score);
    if (!when) e.notes = "Finished: AniList didn't say when";
    return e;
  }

  // Raw records to review rows. Rows that finish a backlog item carry its id
  // as `finishes` (io.js moves it off the backlog when the row is imported);
  // a Watching title you already have, not started here, becomes an update
  // that fills in the day it was started, and a Paused or Dropped one an
  // update that drops it. A backlog item matches on its AniList id, or on
  // its title and category when it was added by hand.
  function buildAniList(raw) {
    const nameKey = (title, category) => String(title || "").trim().toLowerCase() + "\u0000" + category;
    const index = (list) => {
      const map = new Map();
      for (const x of list) {
        if (x.mediaSource && x.mediaId) map.set(x.mediaSource + ":" + x.mediaId, x);
        if (!map.has(nameKey(x.title, x.category))) map.set(nameKey(x.title, x.category), x);
      }
      return map;
    };
    const inBacklog = index(state.data.backlog), onTimeline = index(state.data.entries);
    const find = (map, m, category) => map.get(m.source + ":" + m.id) || map.get(nameKey(m.title, category));
    const backlog = [], entries = [], finishes = new Map(), drops = new Map(), undated = new Set();
    for (const { m, category } of raw) {
      const key = m.source + ":" + m.id;
      const b = find(inBacklog, m, category);
      if (m.listStatus === "completed") {
        if (b) { entries.push(aniListFinishedEntry(b, m)); finishes.set(key, b.id); continue; }
        if (find(onTimeline, m, category)) continue;
        const e = aniListHistoryEntry(m, category);
        if (e.notes) undated.add(key);
        entries.push(e);
      } else if (m.listStatus === "planning" || m.listStatus === "current") {
        backlog.push(aniListBacklogItem(m, category));
      } else if (m.listStatus === "paused" || m.listStatus === "dropped") {
        if (b) { if (!b.dropped) drops.set(key, b); continue; }
        if (find(onTimeline, m, category)) continue;
        backlog.push({ ...aniListBacklogItem(m, category), dropped: true });
      }
    }
    const built = buildImportItems({ backlog, entries, categories: [] });
    for (const it of built.items) {
      const key = (it.entry.mediaSource || "") + ":" + (it.entry.mediaId || "");
      if (it.kind === "entry") {
        if (finishes.has(key) && !it.dup) it.finishes = finishes.get(key);
        if (undated.has(key) && !it.dup) it.checked = false;
        continue;
      }
      if (it.kind !== "backlog" || !it.dup || !it.entry.startedAt) continue;
      const target = inBacklog.get(key);
      if (!target || target.startedAt || target.dropped) continue;
      if (it.update && (it.targetKind !== "backlog" || it.targetId !== target.id)) continue;
      const fills = (it.update ? it.fills : []).concat({ key: "startedAt", label: "started" });
      Object.assign(it, { update: true, targetId: target.id, targetKind: "backlog", fills, checked: true });
    }
    // Dropping one you have is its own row: the item as it is, plus dropped.
    for (const b of drops.values()) {
      built.items.push({ kind: "backlog", entry: { ...b, dropped: true }, dup: true, update: true, targetId: b.id, targetKind: "backlog",
        fills: [{ key: "dropped", label: "dropped" }], checked: true });
    }
    return built;
  }

  const syncSteamWishlist = () => runImport(steamWishlistSource);

  // Backlog items still stuck on the "Steam app <id>" placeholder title —
  // exact match against what syncSteamWishlist generates, so this can't
  // false-positive on something a user genuinely titled that way.
  function unresolvedSteamBacklogItems() {
    return state.data.backlog.filter(isUnresolvedSteamItem);
  }

  // The per-item halves of the three "which items does this pass touch?"
  // questions below, split out from the state.data.backlog filters so they
  // can be reasoned about — and tested — one item at a time. See
  // test/sync.test.js; the filters themselves need a whole app to exist.
  const steamPlaceholderTitle = (b) => b.title === `Steam app ${b.mediaId}`;
  function isUnresolvedSteamItem(b) {
    return b.mediaSource === "steam" && !!b.mediaId && steamPlaceholderTitle(b);
  }

  // Re-attempts the title lookup for backlog items already imported with a
  // placeholder title (see unresolvedSteamBacklogItems) — a normal re-sync
  // won't touch these since they're already in the backlog and thus no
  // longer show up as "new" wishlist items. Updates titles in place; never
  // adds, removes, or duplicates anything.
  async function retryUnresolvedSteamTitles() {
    const cfg = state.data.settings.steam || DEFAULT_SETTINGS.steam;
    const proxyUrl = window.LifeLogPlatform.steamProxy(cfg.proxyUrl);
    if (!proxyUrl) { toast("Set your proxy URL first", true); return; }
    const targets = unresolvedSteamBacklogItems();
    if (!targets.length) { toast("Nothing unresolved to retry"); return; }
    const btn = $("#steamRetryUnresolvedBtn");
    if (btn) { btn.disabled = true; btn.textContent = window.LifeLogJobs.busy("steam") ? "Waiting…" : "Retrying…"; }
    let resolved = 0, tried = 0;
    try {
      await window.LifeLogJobs.run({ label: "Retrying unresolved Steam titles", lane: "steam", again: "steamRetry" }, async (job) => {
        for (let i = 0; i < targets.length && !job.stopping; i++) {
          if (btn) btn.textContent = `Retrying… ${i + 1}/${targets.length}`;
          job.progress(i, targets.length, targets[i].title);
          const info = await fetchSteamAppInfo(proxyUrl, targets[i].mediaId);
          tried++;
          if (info && info.name) {
            targets[i].title = info.name;
            // The lookup that resolves the title carries the release info too,
            // so a retried item lands with the same data a fresh import gets.
            Object.assign(targets[i], mergeRelease(targets[i], info.release));
            targets[i].updatedAt = new Date().toISOString();
            resolved++;
            if (resolved % SAVE_EVERY === 0) persist();
          }
          job.progress(i + 1, targets.length);
          if (i < targets.length - 1) await job.sleep(500);
        }
        afterDataChange();
        await persist();
        const msg = job.stopping
          ? `Stopped after ${tried} of ${targets.length} — resolved ${resolved}`
          : `Resolved ${resolved} of ${targets.length} title${targets.length === 1 ? "" : "s"}`;
        toast(msg);
        job.finish(msg);
      });
    } catch (e) {
      toast("Retrying the Steam titles stopped partway (" + ((e && e.message) || "network error") + ") — what it resolved is kept", true);
      if (resolved) { afterDataChange(); persist(); }
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
    if (count) window.LifeLogIcons.setLabel(btn, "repeat", `Retry unresolved Steam titles (${count})`);
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
  function steamGameNeedsInfo(b) {
    return b.mediaSource === "steam" && !!b.mediaId && !steamPlaceholderTitle(b) &&
      (steamGameNeedsRawgInfo(b) || !b.summary);
  }
  function steamGamesNeedingInfo() {
    return state.data.backlog.filter(steamGameNeedsInfo);
  }

  // Retroactively fills in what a Steam-sourced backlog item is missing:
  // RAWG's rating/length/release year (same best-effort top-match lookup the
  // sync uses) and Steam's own description, straight off the App ID the item
  // already carries. Each half needs its own credential — a RAWG key, the
  // CORS proxy — and runs only for the items actually missing that half.
  // Never touches title, cover, or mediaId.
  async function backfillRawgForSteamGames() {
    const rawgKey = state.data.settings.mediaKeys?.rawg;
    const proxyUrl = window.LifeLogPlatform.steamProxy((state.data.settings.steam || {}).proxyUrl);
    if (!rawgKey && !proxyUrl) { toast("Set a RAWG API key or your proxy URL first (Settings → Media lookups)", true); return; }
    const targets = steamGamesNeedingInfo();
    if (!targets.length) { toast("Nothing to backfill"); return; }
    const btn = $("#steamBackfillRawgBtn");
    if (btn) { btn.disabled = true; btn.textContent = window.LifeLogJobs.busy("steam") ? "Waiting…" : "Backfilling…"; }
    let filled = 0, tried = 0;
    try {
      await window.LifeLogJobs.run({ label: "Filling in missing game info", lane: "steam", again: "steamBackfill" }, async (job) => {
        for (let i = 0; i < targets.length && !job.stopping; i++) {
          if (btn) btn.textContent = `Backfilling… ${i + 1}/${targets.length}`;
          job.progress(i, targets.length, targets[i].title);
          tried++;
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
            if (filled % SAVE_EVERY === 0) persist();
          }
          job.progress(i + 1, targets.length);
          if (i < targets.length - 1) await job.sleep(300);
        }
        afterDataChange();
        await persist();
        const msg = job.stopping
          ? `Stopped after ${tried} of ${targets.length} — filled in ${filled}`
          : `Filled in info for ${filled} of ${targets.length} game${targets.length === 1 ? "" : "s"}`;
        toast(msg);
        job.finish(msg);
      });
    } catch (e) {
      toast("Filling in game info stopped partway (" + ((e && e.message) || "network error") + ") — what it found is kept", true);
      if (filled) { afterDataChange(); persist(); }
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
    if (count) window.LifeLogIcons.setLabel(btn, "gamepad-2", `Backfill missing game info (${count})`);
  }

  // A quiet periodic check, paced by Settings → Imports → "Check
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
    const proxyUrl = window.LifeLogPlatform.steamProxy(cfg.proxyUrl);
    const steamId = (cfg.steamId || "").trim();
    if (!proxyUrl || !steamId) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(STEAM_SYNC_KEY)); } catch (e) {}
    const lastAt = (last && last.lastCheckedAt) ? new Date(last.lastCheckedAt).getTime() : 0;
    if (Date.now() - lastAt < days * 24 * 60 * 60 * 1000) return;
    try {
      await window.LifeLogJobs.run({ label: "Checking your Steam wishlist", lane: "steam" }, async (job) => {
        const res = await fetch(`${proxyUrl}/steam-wishlist/${encodeURIComponent(steamId)}`, { signal: job.signal });
        if (!res.ok) throw new Error(`Steam answered ${res.status}`);
        const data = await res.json();
        const items = (data && data.response && data.response.items) || [];
        const existingSteamIds = new Set(
          [...state.data.backlog, ...state.data.entries]
            .filter((x) => x.mediaSource === "steam" && x.mediaId)
            .map((x) => x.mediaId)
        );
        const newCount = items.filter((it) => !existingSteamIds.has(String(it.appid))).length;
        if (newCount > 0) {
          toast(`${newCount} new Steam wishlist game${newCount === 1 ? "" : "s"} — Settings → Imports to sync`);
        }
        job.finish(newCount ? `${newCount} new on your wishlist` : "Nothing new on your wishlist");
      });
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
    const due = new Set(releasesDueNow(true));
    return state.data.backlog.filter((b) => due.has(b) || needsReleaseRecheck(b));
  }

  // Whether one item is worth re-asking.
  //
  // isAwaitingRelease covers an already-airing show with an episode still
  // ahead, not just things that haven't come out — a next-episode date is the
  // fastest-staling thing here, going out of date every week. It's read off
  // window.LifeLogBacklog rather than taken as an argument, so there is one
  // definition of "awaiting a release" in the app and this can't drift from
  // the list it's supposed to agree with.
  //
  // A pinned release date is excluded outright rather than fetched and
  // discarded: it keeps the button's count honest about how many items this
  // would actually re-check, and saves the requests.
  //
  // Early Access items are already "released" as far as isAwaitingRelease is
  // concerned, but they're the whole reason the flag has to be re-asked:
  // Steam drops the marker at 1.0 and nothing else would notice. They're
  // included here rather than in isAwaitingRelease itself, which drives the
  // Next Releases list — an EA game has no 1.0 date to list.
  //
  // A show is re-asked until it has finished (0.265.0), not only while it
  // has a next episode on the calendar: that's what moves "airing · 7 of 12"
  // along and, at the end, turns it into "Complete". One with no airing
  // state yet (synced before 0.265.0) is asked once to get one.
  const AIRING_SOURCES = new Set(["tmdb-tv", "anilist-anime", "anilist-manga"]);
  function airingUnsettled(b) {
    return AIRING_SOURCES.has(b.mediaSource) && !b.dropped
      && b.airing !== "finished" && b.airing !== "cancelled";
  }
  function needsReleaseRecheck(b) {
    const Backlog = window.LifeLogBacklog;
    if (!Backlog) return false;
    return !!b.mediaId && !!b.mediaSource && !isOverridden(b, "release")
      && (Backlog.isAwaitingRelease(b) || !!b.earlyAccess || airingUnsettled(b));
  }

  // The day an item's own date says something happens: the next episode, or
  // the release when it's known to the day. A month or a year has no day to
  // wait for; the cadence keeps asking about those.
  function dueDay(b) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(b.nextAt || "")) return b.nextAt;
    const r = String(b.releaseDate || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(r) ? r : "";
  }
  function dayStr(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // Whether an item's date has arrived since its source was last asked
  // (0.271.0). The cadence in Settings re-asks everything waiting, but a
  // date passing is when the answer is most likely to have moved: the
  // episode is out (and the next one has a date), the release happened or
  // slipped. And an item whose date has passed reads as released, so the
  // cadence check had stopped asking about it at exactly that moment.
  //
  // Asked on the day, it stays due until it's asked again a day later:
  // sources often catch up a day behind, an evening episode in another time
  // zone among them. At most every 6 hours, and only for two weeks after
  // the date, so a source that never updates stops being asked.
  const DUE_GAP_MS = 6 * 60 * 60 * 1000;
  const DUE_FOR_DAYS = 14;
  function releaseDue(b, asked, now, anyGap) {
    if (!b.mediaId || !b.mediaSource || b.dropped || isOverridden(b, "release")) return false;
    const day = dueDay(b);
    const today = new Date(now);
    const from = new Date(now);
    from.setDate(from.getDate() - DUE_FOR_DAYS);
    if (!day || day > dayStr(today) || day < dayStr(from)) return false;
    const at = Date.parse((asked || {})[b.id] || "");
    if (!at) return true;
    if (!anyGap && now - at < DUE_GAP_MS) return false;
    return dayStr(new Date(at)) <= day;
  }
  function readAsked() {
    try { return JSON.parse(localStorage.getItem(RELEASE_ASKED_KEY)) || {}; } catch (e) { return {}; }
  }
  function markAsked(items) {
    const asked = readAsked();
    const at = new Date().toISOString();
    for (const b of items) asked[b.id] = at;
    const ids = new Set(state.data.backlog.map((b) => b.id));
    for (const id of Object.keys(asked)) if (!ids.has(id)) delete asked[id];
    try { localStorage.setItem(RELEASE_ASKED_KEY, JSON.stringify(asked)); } catch (e) { /* asked again next time */ }
  }
  function releasesDueNow(anyGap) {
    const asked = readAsked(), now = Date.now();
    return state.data.backlog.filter((b) => releaseDue(b, asked, now, anyGap));
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
    // earlyAccess rides along in that merge: Steam stating the game has left
    // Early Access drops the key, and the loop below turns a dropped key
    // into a deleted field — so the flag clears itself at 1.0.
    const keys = ["releaseDate", "releasePrecision", "releaseStatus", "nextAt", "nextLabel", "earlyAccess",
      "airing", "episodesOut", "episodesTotal", "airingSeason"];
    let changed = false;
    for (const k of keys) {
      const next = merged[k] || "";
      if (String(item[k] || "") === String(next)) continue;
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
    const proxyUrl = window.LifeLogPlatform.steamProxy((state.data.settings.steam || {}).proxyUrl);
    const btn = $("#refreshReleasesBtn");
    if (btn) { btn.disabled = true; btn.textContent = window.LifeLogJobs.busy("media") ? "Waiting…" : "Checking…"; }
    let updated = 0, checked = 0;
    try {
      await window.LifeLogJobs.run({ label: "Re-checking release dates", lane: "media", again: "releases" }, async (job) => {
        for (let i = 0; i < targets.length && !job.stopping; i++) {
          if (btn) btn.textContent = `Checking… ${i + 1}/${targets.length}`;
          job.progress(i, targets.length, targets[i].title);
          const fresh = await fetchItemRelease(targets[i], keys, proxyUrl);
          markAsked([targets[i]]);
          if (fresh) {
            checked++;
            if (applyItemRelease(targets[i], fresh) && ++updated % SAVE_EVERY === 0) persist();
          }
          job.progress(i + 1, targets.length);
          if (i < targets.length - 1) await job.sleep(300);
        }
        if (updated) { afterDataChange(); await persist(); }
        if (!job.stopping) markReleasesChecked();
        const stopped = job.stopping ? ` — stopped after ${job.done} of ${targets.length}` : "";
        if (!checked && !job.stopping) {
          const m = "None of these sources can be re-checked — they have no lookup by id";
          toast(m, true);
          job.fail(m);
          return;
        }
        const msg = (updated
          ? `Updated ${updated} release date${updated === 1 ? "" : "s"} of ${checked} checked`
          : `Checked ${checked} — nothing has changed`) + stopped;
        toast(msg);
        job.finish(msg);
      });
    } catch (e) {
      toast("Re-checking release dates stopped partway (" + ((e && e.message) || "network error") + ") — what it updated is kept", true);
      if (updated) { afterDataChange(); persist(); }
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
    window.LifeLogIcons.setLabel(btn, "telescope", count ? `Re-check release dates (${count})` : "Re-check release dates");
  }

  function markReleasesChecked() {
    try { localStorage.setItem(RELEASE_REFRESH_KEY, JSON.stringify({ lastCheckedAt: new Date().toISOString() })); } catch (e) {}
  }

  // Unlike the Steam/AniList auto-checks, which only count and toast, this one
  // does update items — but it only ever refreshes dates on things already in
  // the backlog, never adds or removes anything, so there's nothing to review.
  // Silent either way: no toast on success, since the point is that the list
  // is simply correct when you open it.
  //
  // Between those sweeps it asks only about items whose date has arrived
  // (releaseDue), as the app opens and each time it comes back to the
  // screen, since a phone app can stay open for days without a fresh start.
  let autoRefreshing = false;
  async function maybeAutoRefreshReleases() {
    const days = parseInt((state.data.settings.releases || {}).autoRefreshDays, 10) || 0;
    if (!days || autoRefreshing) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(RELEASE_REFRESH_KEY)); } catch (e) {}
    const lastAt = (last && last.lastCheckedAt) ? new Date(last.lastCheckedAt).getTime() : 0;
    const sweep = Date.now() - lastAt >= days * 24 * 60 * 60 * 1000;
    const targets = sweep ? backlogAwaitingRelease() : releasesDueNow(false);
    if (!targets.length) { if (sweep) markReleasesChecked(); return; }
    autoRefreshing = true;
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    const proxyUrl = window.LifeLogPlatform.steamProxy((state.data.settings.steam || {}).proxyUrl);
    let updated = 0;
    try {
      await window.LifeLogJobs.run({ label: "Re-checking release dates", lane: "media" }, async (job) => {
        for (let i = 0; i < targets.length && !job.stopping; i++) {
          job.progress(i, targets.length, targets[i].title);
          const fresh = await fetchItemRelease(targets[i], keys, proxyUrl);
          markAsked([targets[i]]);
          if (fresh && applyItemRelease(targets[i], fresh)) updated++;
          job.progress(i + 1, targets.length);
          if (i < targets.length - 1) await job.sleep(300);
        }
        if (updated) { afterDataChange(); await persist(); render(); }
        job.finish(updated ? `Updated ${updated} release date${updated === 1 ? "" : "s"}` : "Nothing has changed");
      });
    } catch (e) {
      // quiet — unattended background work, not a user action
    } finally {
      autoRefreshing = false;
      if (sweep) markReleasesChecked();
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
  // ---------- AniList, both ways (0.292.0) ----------
  // A title you have and AniList has is compared field by field, status
  // (planning, current, completed, dropped; AniList's Paused counts as
  // dropped) and episode count, against what this device saw the last time
  // the two agreed: the base, kept per device. The side that moved since
  // wins. When both moved, the newer change wins, AniList's updatedAt
  // against the item's updatedAt (status) or progressAt (count). With no
  // base, or a time missing, the further one wins: Completed over Watching
  // over Planning, more episodes over fewer. A status change with no base
  // never goes by time, since an item's updatedAt says when anything about
  // it changed, not its status. A local win is sent to AniList when there's
  // a token and kept here when there isn't, so the next sync weighs it again.
  // Deleting never reaches AniList, and a title removed here isn't brought
  // back by the next sync (its base is still there, or it's in the skips).
  const ANILIST_BASE_KEY = "lifelog-anilist-base-v1";
  const ANILIST_OPEN_GAP = 10 * 60 * 1000;
  const ANILIST_UP = { planning: "PLANNING", current: "CURRENT", completed: "COMPLETED", dropped: "DROPPED" };
  const STATUS_RANK = { planning: 0, current: 1, completed: 2 };
  const isAniListSource = (src) => src === "anilist-anime" || src === "anilist-manga";
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const timeOf = (s) => Date.parse(s || "") || 0;
  // Made from the title's key, so two devices bringing in the same title
  // (or finishing it on the same day) make one item that sync folds, not two.
  const aniListItemId = (key, suffix) => ("al-" + key + (suffix ? "-" + suffix : "")).replace(/[^a-z0-9-]+/gi, "-");

  function readAniListBase() { try { return JSON.parse(localStorage.getItem(ANILIST_BASE_KEY)) || {}; } catch (e) { return {}; } }
  function writeAniListBase(base) { try { localStorage.setItem(ANILIST_BASE_KEY, JSON.stringify(base)); } catch (e) {} }

  function aniListLocalState(b, e) {
    if (b) return { status: b.dropped ? "dropped" : isDay(b.startedAt) ? "current" : "planning", progress: Math.max(0, +b.progress || 0), at: timeOf(b.updatedAt), progressAt: timeOf(b.progressAt) };
    return { status: "completed", progress: null, at: timeOf(e.createdAt), progressAt: 0 };
  }

  // Which side wins one field, or null when they agree.
  function aniListSide(l, r, base, lt, rt, timed, further) {
    if (l === r) return null;
    if (base !== undefined) { if (l === base) return "remote"; if (r === base) return "local"; }
    if ((base !== undefined || timed) && lt && rt && lt !== rt) return lt > rt ? "local" : "remote";
    return further(l, r);
  }
  const furtherStatus = (l, r) => (l in STATUS_RANK && r in STATUS_RANK && STATUS_RANK[l] > STATUS_RANK[r] ? "local" : "remote");
  const furtherCount = (l, r) => (l > r ? "local" : "remote");

  // One title: the status and count both sides end on, and which of the two
  // come from AniList (pull) or go to it (push). `b` is the backlog item,
  // `e` the timeline entry when there's no backlog item (it's completed).
  function decideAniList(m, b, e, base) {
    const l = aniListLocalState(b, e);
    const remote = m.listStatus === "paused" ? "dropped" : m.listStatus;
    const statusSide = aniListSide(l.status, remote, base && base.s, l.at, m.updatedAt, false, furtherStatus);
    const status = statusSide === "local" ? l.status : remote;
    const rp = +m.progress || 0;
    let progressSide = null;
    if (status !== "completed") {
      progressSide = l.progress === null ? (rp ? "remote" : null)
        : aniListSide(l.progress, rp, base ? base.p : undefined, l.progressAt, m.updatedAt, true, furtherCount);
    }
    const progress = status === "completed" ? null : progressSide === "local" ? l.progress : l.progress === null || progressSide === "remote" ? rp : l.progress;
    return { status, progress, pullStatus: statusSide === "remote", pullProgress: progressSide === "remote", pushStatus: statusSide === "local", pushProgress: progressSide === "local" };
  }

  // Every title on your lists against what you have: `titles` you have
  // (matched by AniList id, or by title and category for one added by hand,
  // which then gets linked), and `fresh` ones you have nowhere and haven't
  // removed or skipped.
  function planAniList(raw, data, base, skips) {
    const nameKey = (t, c) => String(t || "").trim().toLowerCase() + "\u0000" + c;
    const keyOf = (x) => x.mediaSource + ":" + x.mediaId;
    const bKey = new Map(), bName = new Map(), eKey = new Map(), eName = new Map();
    for (const x of data.backlog || []) {
      if (isAniListSource(x.mediaSource) && x.mediaId) bKey.set(keyOf(x), x);
      else if (!x.mediaId && !bName.has(nameKey(x.title, x.category))) bName.set(nameKey(x.title, x.category), x);
    }
    // The newest entry stands for a title logged more than once.
    const newer = (map, k, x) => { const y = map.get(k); if (!y || String(x.date || "") > String(y.date || "")) map.set(k, x); };
    for (const x of data.entries || []) {
      if (isAniListSource(x.mediaSource) && x.mediaId) newer(eKey, keyOf(x), x);
      else if (!x.mediaId) newer(eName, nameKey(x.title, x.category), x);
    }
    const titles = [], fresh = [];
    for (const { m, category } of raw) {
      const key = m.source + ":" + m.id;
      let b = bKey.get(key) || null, e = b ? null : eKey.get(key) || null, link = null;
      if (!b && !e) {
        const n = nameKey(m.title, category);
        b = bName.get(n) || null;
        e = b ? null : eName.get(n) || null;
        link = b || e;
        if (b) bName.delete(n); else if (e) eName.delete(n);
      }
      if (!b && !e) {
        if (!base[key] && !skips.has(key)) fresh.push({ m, category });
        continue;
      }
      titles.push({ key, m, b, e, link, ...decideAniList(m, b, e, base[key]) });
    }
    return { titles, fresh };
  }

  // Makes the plan's pulls, and adds the fresh rows given, in state.data.
  // Returns what changed, counted, and what Undo needs.
  function applyAniListPlan(plan, rows) {
    const d = state.data;
    const undo = { added: { backlog: [], entries: [] }, removed: [], prev: [] };
    const counts = { started: 0, finished: 0, dropped: 0, back: 0, progress: 0, added: 0 };
    const now = new Date().toISOString();
    const remember = (list, x) => {
      if (undo.added[list].includes(x.id) || undo.prev.some((p) => p.id === x.id && p.list === list)) return;
      undo.prev.push({ list, id: x.id, before: JSON.parse(JSON.stringify(x)) });
    };
    for (const t of plan.titles) {
      const m = t.m;
      let b = t.b;
      if (t.link) {
        remember(b ? "backlog" : "entries", t.link);
        t.link.mediaSource = m.source;
        t.link.mediaId = m.id;
      }
      if (t.pullStatus && b && t.status === "completed") {
        const entry = { ...aniListFinishedEntry(b, m), id: aniListItemId(t.key, m.completedAt || today()), createdAt: now };
        d.entries.push(entry);
        undo.added.entries.push(entry.id);
        undo.removed.push(b);
        d.backlog = d.backlog.filter((x) => x !== b);
        b = null;
        counts.finished++;
      } else if (t.pullStatus && b) {
        remember("backlog", b);
        if (t.status === "current") { if (!isDay(b.startedAt)) b.startedAt = m.startedAt || today(); delete b.dropped; counts.started++; }
        else if (t.status === "dropped") { b.dropped = true; delete b.startedAt; counts.dropped++; }
        else { delete b.startedAt; delete b.dropped; counts.back++; }
      } else if (t.pullStatus && t.e) {
        // Back on a list after you finished it: watching it again.
        b = { ...aniListBacklogItem({ ...m, listStatus: t.status }, t.e.category), id: aniListItemId(t.key, today()), createdAt: now };
        if (t.status === "dropped") b.dropped = true;
        d.backlog.push(b);
        undo.added.backlog.push(b.id);
        if (t.status === "current") counts.started++; else counts.added++;
      }
      if (t.pullProgress && b) {
        remember("backlog", b);
        b.progress = t.progress;
        b.progressAt = new Date(m.updatedAt || Date.now()).toISOString();
        counts.progress++;
      }
    }
    for (const it of rows) {
      const list = it.kind === "entry" ? "entries" : "backlog";
      const key = it.entry.mediaSource + ":" + it.entry.mediaId;
      const rec = { ...it.entry, id: aniListItemId(key, list === "entries" ? (it.entry.date || "") : ""), createdAt: now };
      const raw = plan.freshByKey && plan.freshByKey.get(key);
      if (list === "backlog" && raw && raw.progress) { rec.progress = raw.progress; rec.progressAt = new Date(raw.updatedAt || Date.now()).toISOString(); }
      if (d[list].some((x) => x.id === rec.id)) continue;
      d[list].push(rec);
      undo.added[list].push(rec.id);
      counts.added++;
    }
    const changed = undo.prev.length || undo.removed.length || undo.added.backlog.length || undo.added.entries.length;
    return { changed: !!changed, counts, undo };
  }

  async function undoAniListPlan(undo) {
    const d = state.data;
    for (const list of ["backlog", "entries"]) {
      const gone = new Set(undo.added[list]);
      d[list] = d[list].filter((x) => !gone.has(x.id));
    }
    for (const p of undo.prev) {
      const at = d[p.list].findIndex((x) => x.id === p.id);
      if (at >= 0) d[p.list][at] = p.before;
    }
    for (const b of undo.removed) if (!d.backlog.some((x) => x.id === b.id)) d.backlog.push(b);
    afterDataChange();
    await persist();
    toast("AniList changes undone here — the next sync sends that to AniList");
  }

  // What to send AniList for a title you have: its status with the dates
  // that go with it, and the count. Completing sends the whole count when
  // AniList knows it, as its own site does.
  function aniListPushFields(status, b, e, progress, total, withStatus, withProgress) {
    const f = {};
    if (withStatus) {
      f.status = ANILIST_UP[status];
      const started = b ? b.startedAt : e && e.startedAt;
      if (isDay(started)) f.startedAt = started;
      if (status === "completed" && e && e.year && e.month) f.completedAt = e.year + "-" + pad2(e.month) + (e.day ? "-" + pad2(e.day) : "");
      if (status === "completed" && total) f.progress = total;
    }
    if (withProgress && progress != null) f.progress = progress;
    return f;
  }

  // Titles you added here after signing in that AniList doesn't have on
  // any list: they go to it. Older ones are left alone; signing in isn't
  // asking to copy your whole history over.
  function aniListLocalOnly(data, remoteKeys, cfg, base) {
    const since = timeOf(cfg.connectedAt);
    if (!since) return [];
    const cats = new Set(anilistPulls(cfg).map(([, c]) => c));
    const out = [], seen = new Set();
    const consider = (x, isEntry) => {
      if (!isAniListSource(x.mediaSource) || !x.mediaId || !cats.has(x.category)) return;
      const key = x.mediaSource + ":" + x.mediaId;
      if (remoteKeys.has(key) || seen.has(key) || base[key] || timeOf(x.createdAt) < since) return;
      seen.add(key);
      out.push({ key, mediaId: x.mediaId, b: isEntry ? null : x, e: isEntry ? x : null });
    };
    for (const b of data.backlog || []) consider(b, false);
    for (const e of data.entries || []) consider(e, true);
    return out;
  }

  // One sync: read your lists, apply what AniList won, send what this side
  // won. `manual` is the Sync AniList button: it says what went wrong and
  // opens the review for what still needs a look. Otherwise it's quiet
  // unless something changed here.
  let aniListRun = null, aniListAgain = false;
  function syncAniList(opts = {}) {
    if (aniListRun) { aniListAgain = aniListAgain || !opts.manual; if (opts.manual) toast("AniList is already syncing"); return aniListRun; }
    aniListRun = runAniListSync(opts).finally(() => {
      aniListRun = null;
      if (aniListAgain) { aniListAgain = false; syncAniList({ nudge: true }); }
    });
    return aniListRun;
  }
  async function runAniListSync({ manual } = {}) {
    const cfg = state.data.settings.anilist || DEFAULT_SETTINGS.anilist;
    const userName = (cfg.userName || "").trim();
    const say = (msg) => { if (manual) toast(msg, true); };
    if (!userName) return say("Enter your AniList username first");
    if (!anilistPulls(cfg).length) return say("Pick a category for anime and/or manga first");
    if (!window.LifeLogMedia) return say("Media lookups aren't available");
    // What GitHub has first: a title finished on another device is already
    // here, not finished a second time from AniList.
    if (whenSynced) await whenSynced();
    const token = (cfg.token || "").trim();
    const btn = manual ? $("#anilistSyncBtn") : null;
    const label = btn ? [...btn.childNodes].map((n) => n.cloneNode(true)) : null;
    if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
    try {
      await window.LifeLogJobs.run({ label: manual ? "Syncing AniList" : "Checking your AniList lists", lane: "anilist", again: "anilistSyncBtn" }, async (job) => {
        const raw = await fetchAniList({ userName, animeCategory: cfg.animeCategory, mangaCategory: cfg.mangaCategory, token }, manual ? (a, b, c) => job.progress(a, b, c) : null, job);
        if (raw === null) {
          const err = window.LifeLogMedia.getLastError();
          say(err ? "AniList sync failed — " + err : "AniList sync failed");
          job.fail("AniList couldn't be reached");
          return;
        }
        if (job.stopping) { job.finish("Stopped"); return; }
        const base = readAniListBase();
        const skips = new Set(((state.data.settings.importSkips || {}).anilist) || []);
        const plan = planAniList(raw, state.data, base, skips);
        plan.freshByKey = new Map(plan.fresh.map(({ m }) => [m.source + ":" + m.id, m]));
        const built = plan.fresh.length ? buildAniList(plan.fresh) : { items: [], newCategories: [] };
        const rows = built.items.filter((it) => !it.dup && !it.update && it.checked);
        const leftovers = built.items.filter((it) => !it.dup && !it.update && !it.checked);
        const result = applyAniListPlan(plan, rows);
        for (const it of rows) {
          const m = plan.freshByKey.get(it.entry.mediaSource + ":" + it.entry.mediaId);
          if (m) base[m.source + ":" + m.id] = { s: m.listStatus === "paused" ? "dropped" : m.listStatus, p: m.listStatus === "completed" ? null : +m.progress || 0 };
        }
        // Sending: each title this side won, then the ones only here.
        let sent = 0, failed = 0, waiting = 0;
        const send = async (key, mediaId, fields, agreed) => {
          if (!Object.keys(fields).length) { base[key] = agreed; return; }
          if (!token) { waiting++; return; }
          const r = await window.LifeLogMedia.saveAniListEntry(token, mediaId, fields);
          if (r) { sent++; base[key] = agreed; } else failed++;
        };
        for (const t of plan.titles) {
          if (job.stopping) break;
          const b = t.status === "completed" ? null : state.data.backlog.find((x) => x.mediaSource + ":" + x.mediaId === t.key) || null;
          const e = t.status === "completed" ? (t.e || state.data.entries.find((x) => x.mediaSource + ":" + x.mediaId === t.key)) : null;
          const fields = aniListPushFields(t.status, b, e, t.progress, t.m.total, t.pushStatus, t.pushProgress);
          await send(t.key, t.m.id, fields, { s: t.status, p: t.progress });
        }
        const remoteKeys = new Set(raw.map(({ m }) => m.source + ":" + m.id));
        for (const x of token ? aniListLocalOnly(state.data, remoteKeys, cfg, base) : []) {
          if (job.stopping) break;
          const st = aniListLocalState(x.b, x.e);
          await send(x.key, x.mediaId, aniListPushFields(st.status, x.b, x.e, st.progress, 0, true, !!x.b), { s: st.status, p: st.progress });
        }
        writeAniListBase(base);
        if (failed && token) {
          const err = window.LifeLogMedia.getLastError();
          toast("Couldn't update AniList" + (err ? " — " + err : "") + ". It's tried again next sync.", true);
        }
        const c = result.counts;
        const parts = [];
        if (c.added) parts.push(c.added + " new");
        if (c.started) parts.push(c.started + " started");
        if (c.finished) parts.push(c.finished + " finished");
        if (c.dropped) parts.push(c.dropped + " dropped");
        if (c.back) parts.push(c.back + " back to the backlog");
        if (c.progress) parts.push(c.progress + (c.progress === 1 ? " episode count" : " episode counts"));
        if (result.changed) {
          afterDataChange();
          await persist();
          toast("AniList: " + parts.join(", "), false, { label: "Undo", onClick: () => undoAniListPlan(result.undo) });
        } else if (manual) {
          toast(sent ? `AniList is up to date — sent ${sent} change${sent === 1 ? "" : "s"}` : waiting ? "Up to date here — sign in to AniList to send your changes" : "Your AniList lists are up to date");
        }
        if (leftovers.length) {
          const review = () => reviewAndImport("AniList", "Completed titles AniList has no dates for. Tick the ones to log; they go under this month.", { items: leftovers, newCategories: [] }, (selected) => rememberAniListSkips(leftovers, selected));
          if (manual) review();
          else if (!result.changed) toast(`${leftovers.length} AniList title${leftovers.length === 1 ? "" : "s"} without dates to review`, false, { label: "Review", onClick: review });
        }
        job.finish([parts.join(", "), sent && `sent ${sent}`, leftovers.length && `${leftovers.length} to review`].filter(Boolean).join(" · ") || "Up to date");
      });
    } catch (e) {
      // Already said, and kept in Activity.
    } finally {
      if (btn) { btn.disabled = false; btn.replaceChildren(...label); }
    }
  }

  // Unticked in the review, they stay out of the way next time, as the
  // other imports' skips do.
  async function rememberAniListSkips(rows, selected) {
    const chosen = new Set(selected);
    const all = { ...(state.data.settings.importSkips || {}) };
    const next = new Set(all.anilist || []);
    for (const it of rows) {
      const key = it.entry.mediaSource + ":" + it.entry.mediaId;
      if (chosen.has(it)) next.delete(key); else next.add(key);
    }
    if (next.size) all.anilist = [...next]; else delete all.anilist;
    state.data.settings.importSkips = all;
    await persist();
  }

  // Settings → Imports → AniList → Sync automatically: "open" (every time
  // the app opens or comes back, ANILIST_OPEN_GAP apart at most), days
  // between syncs, or "0" for never. Per device, like the other checks.
  function aniListDue(setting, lastAt, now = Date.now()) {
    if (setting === "open") return now - lastAt >= ANILIST_OPEN_GAP;
    const days = parseInt(setting, 10) || 0;
    return days > 0 && now - lastAt >= days * 24 * 60 * 60 * 1000;
  }
  async function maybeAutoCheckAniList() {
    const cfg = state.data.settings.anilist || DEFAULT_SETTINGS.anilist;
    if (!(cfg.userName || "").trim() || !anilistPulls(cfg).length) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(ANILIST_SYNC_KEY)); } catch (e) {}
    const lastAt = (last && last.lastCheckedAt) ? new Date(last.lastCheckedAt).getTime() : 0;
    if (!aniListDue(String(cfg.autoSyncDays || "0"), lastAt)) return;
    try { localStorage.setItem(ANILIST_SYNC_KEY, JSON.stringify({ lastCheckedAt: new Date().toISOString() })); } catch (e) {}
    await syncAniList();
  }

  // Something you did here to an AniList title (a count, a start, Done):
  // with a token it goes out a few seconds later, after any taps that
  // follow it, whatever the automatic setting says.
  let aniListNudge = null;
  function aniListChanged(item) {
    const cfg = state.data.settings.anilist || {};
    if (!item || !isAniListSource(item.mediaSource) || !(cfg.token || "").trim()) return;
    clearTimeout(aniListNudge);
    aniListNudge = setTimeout(() => syncAniList({ nudge: true }), 3000);
  }
  // A title deleted here stays gone: the next sync, on any device, leaves it
  // out instead of bringing it back from your list. The caller persists.
  function aniListRemoved(item) {
    if (!item || !isAniListSource(item.mediaSource) || !item.mediaId) return;
    const key = item.mediaSource + ":" + item.mediaId;
    const all = { ...(state.data.settings.importSkips || {}) };
    if ((all.anilist || []).includes(key)) return;
    all.anilist = [...(all.anilist || []), key];
    state.data.settings.importSkips = all;
  }
  const syncAniListPlanning = () => syncAniList({ manual: true });
  if (window.LifeLogJobs) {
    window.LifeLogJobs.onAgain("steamWishlistSyncBtn", () => syncSteamWishlist());
    window.LifeLogJobs.onAgain("anilistSyncBtn", () => syncAniListPlanning());
    window.LifeLogJobs.onAgain("steamRetry", () => retryUnresolvedSteamTitles());
    window.LifeLogJobs.onAgain("steamBackfill", () => backfillRawgForSteamGames());
    window.LifeLogJobs.onAgain("releases", () => refreshUpcomingReleases());
  }

  window.LifeLogSync = {
    init,
    // pure per-item logic, for test/sync.test.js — the flows that use these
    // need a browser, a proxy and a wishlist; these are the decisions inside
    // them that don't.
    needsReleaseRecheck,
    releaseDue,
    applyItemRelease,
    ownedToEntry, syncSteamOwned,
    aniListBacklogItem, aniListFinishedEntry, aniListHistoryEntry, buildAniList,
    decideAniList, planAniList, aniListPushFields, aniListDue, aniListLocalOnly,
    syncAniList, aniListChanged, aniListRemoved,
    isUnresolvedSteamItem,
    steamGameNeedsInfo,
    steamGameNeedsRawgInfo,
    applySteamAppId,
    loadBacklogPrices,
    backlogPriceOf,
    priceEpoch: () => priceEpoch,
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
    maybeCheckPriceAlerts,
    maybeFillGameTimes, gameTimesFor, gameTimesDue, applyGameTimes,
  };
})();
