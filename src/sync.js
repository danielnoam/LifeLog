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
  // How long a fetched GG.deals price stays valid before a backlog re-render
  // re-fetches it; avoids re-querying the rate-limited API on every render.
  const PRICE_CACHE_MS = 15 * 60 * 1000;

  // Shared app plumbing, provided by app.js via init(ctx).
  let state, $, toast, persist, render, afterDataChange, DEFAULT_SETTINGS, isOverridden,
    buildImportItems, importItemIncomplete, reviewAndImport, setBacklogCover, setEntryCover;

  function init(ctx) {
    ({ state, $, toast, persist, render, afterDataChange, DEFAULT_SETTINGS, isOverridden,
      buildImportItems, importItemIncomplete, reviewAndImport, setBacklogCover, setEntryCover } = ctx);
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
      priceEpoch++;
    }
    applyCachedPrices(items);
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
  // Three lists, one review (0.265.0). Planning comes in as backlog items,
  // as it always has. Watching comes in as backlog items already in
  // progress, or starts the one you already have. Completed is asked only
  // about what's in your backlog, and moves each one to the timeline the way
  // Done does, in the month AniList says you finished it, with your score.
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
      const source = ANILIST_SOURCE[type];
      const completedIds = state.data.backlog.filter((b) => b.mediaSource === source && b.mediaId).map((b) => b.mediaId);
      // null is a hard failure (network, private list, unknown user), kept
      // distinct from an empty-but-reachable list.
      const media = await window.LifeLogMedia.fetchAniListLists(ctx.userName, type, completedIds);
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
    const done = /^\d{4}-\d{2}-\d{2}$/.test(m.completedAt || "") ? m.completedAt : today();
    const year = +done.slice(0, 4), month = +done.slice(5, 7);
    const e = { title: b.title, category: b.category, year, month, date: year + "-" + pad2(month), backlogAddedAt: b.createdAt || null };
    for (const k of ["coverUrl", "mediaId", "mediaSource", "length", "genres"]) if (b[k]) e[k] = b[k];
    const started = /^\d{4}-\d{2}-\d{2}$/.test(b.startedAt || "") ? b.startedAt : (m.startedAt || "");
    if (started && started <= done) {
      e.startedAt = started;
      const sy = +started.slice(0, 4), sm = +started.slice(5, 7);
      if (sy * 12 + sm < year * 12 + month) { e.startYear = sy; e.startMonth = sm; }
    }
    if (m.score >= 1) e.rating = Math.min(5, m.score);
    return e;
  }

  // Raw records to review rows. Rows that finish a backlog item carry its id
  // as `finishes` (io.js moves it off the backlog when the row is imported);
  // a Watching title you already have, not started here, becomes an update
  // that fills in the day it was started.
  function buildAniList(raw) {
    const byMedia = new Map(state.data.backlog.filter((b) => b.mediaSource && b.mediaId)
      .map((b) => [b.mediaSource + ":" + b.mediaId, b]));
    const backlog = [], entries = [], finishes = new Map();
    for (const { m, category } of raw) {
      const key = m.source + ":" + m.id;
      if (m.listStatus === "completed") {
        const b = byMedia.get(key);
        if (!b) continue;
        entries.push(aniListFinishedEntry(b, m));
        finishes.set(key, b.id);
      } else if (m.listStatus === "planning" || m.listStatus === "current") {
        backlog.push(aniListBacklogItem(m, category));
      }
    }
    const built = buildImportItems({ backlog, entries, categories: [] });
    for (const it of built.items) {
      const key = (it.entry.mediaSource || "") + ":" + (it.entry.mediaId || "");
      if (it.kind === "entry") { if (finishes.has(key) && !it.dup) it.finishes = finishes.get(key); continue; }
      if (it.kind !== "backlog" || !it.dup || !it.entry.startedAt) continue;
      const target = byMedia.get(key);
      if (!target || target.startedAt || target.dropped) continue;
      if (it.update && (it.targetKind !== "backlog" || it.targetId !== target.id)) continue;
      const fills = (it.update ? it.fills : []).concat({ key: "startedAt", label: "started" });
      Object.assign(it, { update: true, targetId: target.id, targetKind: "backlog", fills, checked: true });
    }
    return built;
  }

  const anilistSource = {
    id: "anilistSyncBtn",
    label: "AniList",
    lane: "anilist",
    skipKey: "anilist",
    hint: "Review what to bring in from your Planning and Watching lists, and which backlog titles you've completed there (those move to your timeline). Anything you already have is marked; if this sync can fill in something it's missing, that row says so and is ticked.",
    plan() {
      const cfg = state.data.settings.anilist || DEFAULT_SETTINGS.anilist;
      const userName = (cfg.userName || "").trim();
      const animeCategory = cfg.animeCategory || "";
      const mangaCategory = cfg.mangaCategory || "";
      if (!userName) return { error: "Enter your AniList username first" };
      if (!animeCategory && !mangaCategory) return { error: "Pick a category for anime and/or manga first" };
      if (!window.LifeLogMedia) return { error: "Media lookups aren't available" };
      return { ctx: { userName, animeCategory, mangaCategory } };
    },
    async fetch(ctx, report, job) {
      const out = await fetchAniList(ctx, report, job);
      if (out === null) {
        const err = window.LifeLogMedia.getLastError();
        toast(err ? "AniList sync failed — " + err : "AniList sync failed", true);
      }
      return out;
    },
    build: buildAniList,
    empty: () => "Your AniList lists came back empty — check the username, and that your lists are public",
  };

  const syncSteamWishlist = () => runImport(steamWishlistSource);
  const syncAniListPlanning = () => runImport(anilistSource);

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
    return state.data.backlog.filter(needsReleaseRecheck);
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
    const proxyUrl = window.LifeLogPlatform.steamProxy((state.data.settings.steam || {}).proxyUrl);
    let updated = 0;
    try {
      await window.LifeLogJobs.run({ label: "Re-checking release dates", lane: "media" }, async (job) => {
        for (let i = 0; i < targets.length && !job.stopping; i++) {
          job.progress(i, targets.length, targets[i].title);
          const fresh = await fetchItemRelease(targets[i], keys, proxyUrl);
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
  // The AniList equivalent of maybeAutoCheckSteamWishlist, paced by Settings →
  // Media → AniList "Check automatically" (days between checks; 0 = never).
  // Fetches the AniList lists for whichever type(s) have a category chosen
  // and counts what the sync would offer — new titles, titles to start,
  // backlog titles you've completed there — toasting that count. It never
  // opens the review picker or changes anything on its own. Counted off the
  // same rows the sync builds, skips included, so the number is the number
  // you'd get. Runs unattended, so failures stay silent.
  async function maybeAutoCheckAniList() {
    const cfg = state.data.settings.anilist || DEFAULT_SETTINGS.anilist;
    const days = parseInt(cfg.autoSyncDays, 10) || 0;
    if (!days) return;
    const userName = (cfg.userName || "").trim();
    if (!userName || !anilistPulls(cfg).length) return;
    if (!window.LifeLogMedia) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(ANILIST_SYNC_KEY)); } catch (e) {}
    const lastAt = (last && last.lastCheckedAt) ? new Date(last.lastCheckedAt).getTime() : 0;
    if (Date.now() - lastAt < days * 24 * 60 * 60 * 1000) return;
    try {
      await window.LifeLogJobs.run({ label: "Checking your AniList lists", lane: "anilist" }, async (job) => {
        const raw = await fetchAniList({ userName, animeCategory: cfg.animeCategory, mangaCategory: cfg.mangaCategory }, null, job);
        if (!raw || !raw.length) { job.finish("Nothing new on your lists"); return; }
        const skips = new Set(((state.data.settings.importSkips || {}).anilist) || []);
        const n = buildAniList(raw).items.filter((it) => (!it.dup || it.update)
          && !skips.has((it.entry.mediaSource || "") + ":" + (it.entry.mediaId || ""))).length;
        if (n > 0) toast(`${n} AniList change${n === 1 ? "" : "s"} to review — Settings → Imports to sync`);
        job.finish(n ? `${n} to review` : "Nothing new on your lists");
      });
    } catch (e) {
      // quiet — this is an unattended background check, not a user action
    } finally {
      try { localStorage.setItem(ANILIST_SYNC_KEY, JSON.stringify({ lastCheckedAt: new Date().toISOString() })); } catch (e) {}
    }
  }

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
    applyItemRelease,
    ownedToEntry, syncSteamOwned,
    aniListBacklogItem, aniListFinishedEntry, buildAniList,
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
  };
})();
