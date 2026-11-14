// LifeLog — media enrichment: fetch cover art and metadata from RAWG,
// SteamGridDB, TMDB, Open Library, AniList, Jikan, Google Books, and
// MusicBrainz.
(function () {
  // Set whenever a search/price fetch fails outright (network error, CORS
  // block, bad key, rate limit) so the UI can show *why* nothing came back
  // instead of a generic "no matches" — most failures here are silent
  // browser-side CORS rejections that never reach devtools-less users.
  let lastError = "";

  // No request here waits forever. A browser fetch has no timeout of its
  // own, so an API that accepts the connection and then never answers held
  // a pick (and the Add behind it) for minutes; native requests already give
  // up after 15+20s (platform.js), web ones now do too.
  const FETCH_TIMEOUT_MS = 15000;
  function get(url, init) {
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : null;
    return fetch(url, signal ? { ...(init || {}), signal } : init);
  }

  // Why a RAWG request came back empty, in words, for the "No matches" toast
  // and the error log. RAWG failures used to be swallowed, so a dead key, a
  // spent monthly quota and an outage all read as "No matches found".
  async function rawgHttpError(res) {
    let said = "";
    try {
      const body = await res.json();
      said = String((body && (body.error || body.detail)) || "").slice(0, 160);
    } catch (e) { /* not JSON — the status says enough */ }
    const why = res.status === 401 || res.status === 403
      ? "RAWG refused the API key"
      : res.status === 429 ? "RAWG's rate limit or monthly quota is used up" : "RAWG request failed";
    return why + " (HTTP " + res.status + (said ? ": " + said : "") + ")";
  }
  function rawgNetError(e) {
    return e && e.name === "TimeoutError"
      ? "RAWG didn't answer within " + FETCH_TIMEOUT_MS / 1000 + "s"
      : "RAWG request failed (" + ((e && e.message) || "network error") + ")";
  }
  function noteRawgError(msg) {
    lastError = msg;
    if (typeof window !== "undefined" && window.LifeLogErrors) window.LifeLogErrors.record(msg);
  }

  // Tags out, then the handful of entities a source's escaped text can
  // leave behind — Steam's short_description and AniList's description are both
  // HTML, so "Baldur&#39;s Gate" would otherwise reach a backlog row verbatim.
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
  function stripHtml(s) {
    return (s || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m, name) => ENTITIES[name]);
  }

  // A store-page description is several paragraphs long; a backlog blurb is
  // two clamped lines in the list and a short paragraph in the modals. This
  // keeps the opening paragraph, cut at a word boundary, so a game item
  // doesn't carry kilobytes of marketing copy through every GitHub sync.
  function firstParagraph(text, max) {
    const para = String(text || "").trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
    const limit = max || 600;
    if (para.length <= limit) return para;
    const cut = para.slice(0, limit);
    const sp = cut.lastIndexOf(" ");
    return (sp > limit * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:—-]+$/, "") + "…";
  }

  // Normalizes any source's raw genre list into a deduped array of up to 4
  // trimmed name strings — keeps the Stats genre breakdown from drowning in
  // a book's dozen Open Library subjects while still capturing the useful ones.
  function normGenres(names) {
    const out = [];
    for (const n of names || []) {
      const s = String(n || "").trim();
      if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
      if (out.length >= 4) break;
    }
    return out;
  }

  // ---------- release dates ----------
  // Every source knows a different *amount* about when something comes out:
  // TMDB has an exact day, Open Library only a year, Steam sometimes only
  // "Q1 2026". Squashing all of that into one date string loses the part
  // that matters most for an upcoming-releases list — how much of the date
  // is real. So each adapter emits `releasePrecision` alongside the date:
  //
  //   day     "2026-03-15" — exact
  //   month   "2026-03"    — sometime that month
  //   quarter "2026-01"    — stored as the quarter's FIRST month
  //   year    "2026"       — sometime that year
  //   tba     ""           — announced, no date at all
  //
  // and, where a source says so outright, `releaseStatus` ("upcoming" or
  // "released") — always more trustworthy than comparing a fuzzy date to
  // today, and the only way to know a bare "2026" has already happened.
  // Steam alone adds `earlyAccess`: a game that's out and playable but not
  // finished, which is a state neither a date nor releaseStatus can express.
  function datePrecision(s) {
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return "day";
    if (/^\d{4}-\d{2}$/.test(s)) return "month";
    if (/^\d{4}$/.test(s)) return "year";
    return "";
  }

  // Normalizes a source's free-form date string to { releaseDate,
  // releasePrecision }, trimming anything past the day (Jikan hands over a
  // full ISO datetime) and downgrading to "tba" when it isn't a date at all.
  function releaseFromString(s) {
    const str = String(s || "").trim();
    const precision = datePrecision(str);
    if (!precision) return { releaseDate: "", releasePrecision: "tba" };
    return { releaseDate: precision === "day" ? str.slice(0, 10) : str, releasePrecision: precision };
  }

  // Same, from the separate year/month/day fields AniList and Jikan expose —
  // no string sniffing needed, they state the precision by which parts are null.
  function releaseFromParts(y, m, d) {
    if (!y) return { releaseDate: "", releasePrecision: "tba" };
    if (!m) return { releaseDate: String(y), releasePrecision: "year" };
    const ym = y + "-" + String(m).padStart(2, "0");
    if (!d) return { releaseDate: ym, releasePrecision: "month" };
    return { releaseDate: ym + "-" + String(d).padStart(2, "0"), releasePrecision: "day" };
  }

  const PRECISION_RANK = { tba: 0, year: 1, quarter: 2, month: 3, day: 4 };

  // How far a show (or a manga) has run, where the source can say (0.265.0).
  // releaseStatus only answers "can I start it", and a show three episodes
  // into twelve is as "released" as one that ended years ago. So:
  //
  //   airing         upcoming · airing · between · finished · hiatus · cancelled
  //                  ("between": the last season is out, another is coming)
  //   episodesOut    how many are out (in airingSeason, for TMDB)
  //   episodesTotal  how many there will be, when the source knows
  //   airingSeason   TMDB only: the season those two count
  //
  // A manga counts chapters in the same two fields; AniList only knows the
  // total once it has finished.
  const AIRING_COUNTS = ["episodesOut", "episodesTotal", "airingSeason"];

  // Folds several sources' release info into one set of fields, keeping the
  // most precise date on offer — a Steam wishlist game, for instance, is
  // described by both Steam itself and a RAWG name match, and neither is
  // reliably better than the other. Later arguments win ties, so callers
  // pass their most trusted source last. Empty values are left out entirely
  // rather than written as "", matching how items are stored elsewhere.
  function mergeRelease(...sources) {
    const out = {};
    let bestRank = -1;
    for (const s of sources) {
      if (!s) continue;
      if (s.releaseStatus) out.releaseStatus = s.releaseStatus;
      // The one field a source can meaningfully state as false: Steam drops
      // the Early Access marker the day a game ships 1.0, and the later
      // source has to win that the same way it wins a date. It's dropped
      // rather than written as false, matching how every other empty value
      // here is left out — which is also what makes a re-check clear the
      // flag off an item (see applyItemRelease in sync.js).
      if (typeof s.earlyAccess === "boolean") {
        if (s.earlyAccess) out.earlyAccess = true; else delete out.earlyAccess;
      }
      // A source that states how far a show has run (airing, finished…)
      // states all of it: its counts replace the old ones outright, and no
      // next episode from it means there isn't one. Without that, a finished
      // show kept its last "Episode 12 · Mar 3" forever (0.265.0).
      if (s.airing) {
        out.airing = s.airing;
        for (const k of AIRING_COUNTS) { if (s[k]) out[k] = s[k]; else delete out[k]; }
        if (!s.nextAt) { delete out.nextAt; delete out.nextLabel; }
      }
      if (s.nextAt) { out.nextAt = s.nextAt; if (s.nextLabel) out.nextLabel = s.nextLabel; }
      const rank = PRECISION_RANK[s.releasePrecision];
      if (rank === undefined || rank < bestRank) continue;
      bestRank = rank;
      out.releasePrecision = s.releasePrecision;
      if (s.releaseDate) out.releaseDate = s.releaseDate; else delete out.releaseDate;
    }
    return out;
  }

  // SteamGridDB dates a game with a single `release_date` field, documented
  // as a unix timestamp in seconds — but a value that large is easy to ship
  // in milliseconds by mistake, and some entries carry a plain date string
  // instead, so all three shapes are accepted and anything else is treated
  // as "no date" rather than turned into 1970. SGDB only ever knows the day
  // a game came out, never a coarser "Q1 2026", so a timestamp is always
  // day precision.
  function releaseFromSgdb(raw) {
    if (typeof raw === "string") return releaseFromString(raw);
    const n = Number(raw);
    if (!n || !isFinite(n) || n <= 0) return { releaseDate: "", releasePrecision: "tba" };
    // Anything past the year ~2286 in seconds is really milliseconds.
    const sec = n > 1e11 ? Math.floor(n / 1000) : n;
    const dateStr = unixToDateStr(sec);
    return dateStr ? { releaseDate: dateStr, releasePrecision: "day" } : { releaseDate: "", releasePrecision: "tba" };
  }

  // AniList times airings as a unix timestamp; read back through local
  // calendar fields (not toISOString) so an evening airing doesn't land on
  // the previous day for anyone west of UTC.
  function unixToDateStr(sec) {
    if (!sec) return "";
    const d = new Date(sec * 1000);
    if (isNaN(d)) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  const MONTH_NUM = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  // Steam's appdetails `release_date.date` is free text, not a date field, and
  // it's the *only* place a wishlisted game's date can come from without a
  // fuzzy title match against RAWG. Handles the shapes Steam actually ships in
  // English: "12 Mar, 2026", "Mar 12, 2026", "March 2026", "Q1 2026", "2026",
  // and the various no-date placeholders ("Coming soon", "TBA", "To be
  // announced"), which fall through to tba rather than guessing.
  function parseSteamReleaseDate(raw) {
    const s = String(raw || "").trim();
    if (!s) return { releaseDate: "", releasePrecision: "tba" };
    const q = s.match(/Q([1-4])\s*,?\s*(\d{4})/i) || (() => {
      const alt = s.match(/(\d{4})\s*Q([1-4])/i);
      return alt ? [alt[0], alt[2], alt[1]] : null;
    })();
    if (q) {
      const month = (parseInt(q[1], 10) - 1) * 3 + 1;
      return { releaseDate: q[2] + "-" + String(month).padStart(2, "0"), releasePrecision: "quarter" };
    }
    const mon = s.match(/([A-Za-z]{3})[a-z]*/);
    const month = mon ? MONTH_NUM[mon[1].toLowerCase()] : null;
    const year = (s.match(/\b(\d{4})\b/) || [])[1];
    if (!year) return { releaseDate: "", releasePrecision: "tba" };
    if (!month) return { releaseDate: year, releasePrecision: "year" };
    // The day, if present, is the standalone 1–2 digit number — either side of
    // the month name depending on Steam's regional ordering.
    const day = (s.replace(/\b\d{4}\b/, "").match(/\b(\d{1,2})\b/) || [])[1];
    return releaseFromParts(+year, month, day ? +day : null);
  }

  // TMDB search returns only genre_ids, not names — these are TMDB's stable,
  // documented id→name maps (movie and TV lists differ), so no extra request
  // is needed to resolve them.
  const TMDB_MOVIE_GENRES = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
    878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  };
  const TMDB_TV_GENRES = {
    10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids", 9648: "Mystery",
    10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap",
    10767: "Talk", 10768: "War & Politics", 37: "Western",
  };
  // RAWG states a game's score in two different places and promises
  // neither: `metacritic` exists only for games Metacritic actually
  // reviewed, and `rating` only once RAWG's own users have scored one — an
  // unannounced indie has neither, which is why a games backlog shows a mix
  // of "84 Metacritic", "76% users" and nothing at all. `playtime` is the
  // same story: an average of player-reported hours, 0 until enough people
  // have logged one. Shared by the search and the per-game endpoints, which
  // report all three identically.
  function rawgMeta(g) {
    return {
      externalRating: g.metacritic
        ? g.metacritic + " Metacritic"
        : (g.rating ? Math.round(g.rating * 20) + "% users" : ""),
      length: g.playtime ? g.playtime + " hrs" : "",
    };
  }

  async function searchRawg(title, apiKey) {
    if (!apiKey) return [];
    try {
      const url = "https://api.rawg.io/api/games?search=" + encodeURIComponent(title) +
        "&key=" + encodeURIComponent(apiKey) + "&page_size=5";
      const res = await get(url);
      if (!res.ok) { noteRawgError(await rawgHttpError(res)); return []; }
      const data = await res.json();
      return (data.results || []).map(mapRawgResult);
    } catch (e) { noteRawgError(rawgNetError(e)); return []; }
  }

  // One row of a RAWG list, search or discover.
  function mapRawgResult(g) {
    return {
      id: g.slug || "",
      title: g.name || "",
      coverUrl: g.background_image || "",
      year: g.released ? parseInt(g.released, 10) : null,
      // RAWG flags undated games with `tba` and then still hands back a
      // placeholder date for them (usually Dec 31 of the target year) —
      // taking that at face value would put unannounced games on a
      // specific day. The flag wins.
      ...(g.tba
        ? { releaseDate: "", releasePrecision: "tba", releaseStatus: "upcoming" }
        : releaseFromString(g.released)),
      // RAWG's search endpoint carries no description — only the per-game
      // endpoint does, so the blurb arrives later via fetchRawgDetails.
      summary: "",
      ...rawgMeta(g),
      genres: normGenres((g.genres || []).map((x) => x.name)),
      source: "rawg",
    };
  }

  // "RAWG + Steam + GG.deals" combo source: same search as plain RAWG
  // (cover/rating/length/date), just tagged so app.js knows to also try
  // resolving a Steam App ID for whichever result gets picked — Steam
  // itself has no search API, so fetchRawgSteamAppId below (RAWG's own
  // per-game store links) is the only way to find one without asking the
  // user to paste it in manually. Once found, a manually-added entry gets
  // the same cover/price wiring a Steam Wishlist import already gets.
  async function searchRawgSteamGg(title, apiKey) {
    const results = await searchRawg(title, apiKey);
    return results.map((r) => ({ ...r, source: "rawg-steam-gg" }));
  }

  // RAWG's /games/{id}/stores endpoint lists every storefront a game is
  // sold on, each with its actual store URL — scanning those for a Steam
  // one and pulling the app ID out of it is the only way to get a Steam
  // App ID from a title search, since Steam's own search has no CORS
  // allowance. Returns "" if RAWG has no Steam listing for this game.
  async function fetchRawgSteamAppId(rawgId, apiKey) {
    if (!apiKey || !rawgId) return "";
    try {
      const url = "https://api.rawg.io/api/games/" + encodeURIComponent(rawgId) +
        "/stores?key=" + encodeURIComponent(apiKey);
      const res = await get(url);
      if (!res.ok) return "";
      const data = await res.json();
      for (const entry of data.results || []) {
        const m = (entry.url || "").match(/store\.steampowered\.com\/app\/(\d+)/);
        if (m) return m[1];
      }
      return "";
    } catch (e) { return ""; }
  }

  // The games' equivalent of fetchTmdbDetails below: one extra request on
  // the picked title, because RAWG's search endpoint is missing the one
  // field it can't fake — the description. That's why a game used to be the
  // only thing in the backlog that never landed with a blurb, however
  // complete the rest of its data looked. The same response re-states the
  // rating, playtime and date, so a game that got reviewed (or dated) since
  // the last sync fills those in on a re-sync too.
  async function fetchRawgDetails(id, apiKey) {
    if (!apiKey || !id) return { ...EMPTY_DETAILS };
    try {
      const url = "https://api.rawg.io/api/games/" + encodeURIComponent(id) +
        "?key=" + encodeURIComponent(apiKey);
      const res = await get(url);
      if (!res.ok) return { ...EMPTY_DETAILS };
      const g = await res.json();
      return {
        ...EMPTY_DETAILS,
        ...rawgMeta(g),
        // description_raw is the plain-text twin of `description`; a few
        // entries only carry the HTML one.
        summary: firstParagraph(g.description_raw || stripHtml(g.description)),
        // Same `tba` trap as the search (see searchRawg) — the flag wins over
        // the placeholder date RAWG ships alongside it.
        ...(g.tba
          ? { releaseDate: "", releasePrecision: "tba", releaseStatus: "upcoming" }
          : releaseFromString(g.released)),
      };
    } catch (e) { return { ...EMPTY_DETAILS }; }
  }

  // TMDB's search endpoint has no runtime/season data — that only exists on
  // the per-title details endpoint, so it's a separate on-demand call (see
  // fetchTmdbDetails below), fired only when a specific title is picked.
  // The same response also carries the two things a "what's next" list needs
  // and search can't give: the show's production status, and the air date of
  // the next episode — which, for anything already airing, is the date you
  // actually care about (first_air_date is just when it premiered, years ago).
  // summary/externalRating are here because RAWG's details endpoint fills
  // them too (see fetchRawgDetails) — every caller reads them as
  // `details.summary || r.summary`, so a source that has nothing to add just
  // leaves them empty. `genres` is filled only by the SteamGridDB cross-fill
  // (see fetchSteamGridDbCrossFill): every other source states its genres
  // during the search, so for them it stays the empty array and callers keep
  // the ones already on the result.
  const EMPTY_DETAILS = { length: "", releaseStatus: "", nextAt: "", nextLabel: "", releaseDate: "", releasePrecision: "", summary: "", externalRating: "", genres: [] };
  async function fetchTmdbDetails(id, type, apiKey) {
    if (!apiKey || !id) return { ...EMPTY_DETAILS };
    try {
      const url = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(id) +
        "?api_key=" + encodeURIComponent(apiKey);
      const res = await get(url);
      if (!res.ok) return { ...EMPTY_DETAILS };
      const data = await res.json();
      // The date is re-read here, not just in search, so a re-check months
      // later picks up a delay or a firmed-up date.
      const out = { ...EMPTY_DETAILS, ...releaseFromString(data.release_date || data.first_air_date) };
      if (type === "movie") {
        // TMDB movie status: Rumored / Planned / In Production / Post
        // Production / Released / Canceled.
        if (data.status) out.releaseStatus = data.status === "Released" ? "released" : "upcoming";
        if (data.runtime) {
          const h = Math.floor(data.runtime / 60), m = data.runtime % 60;
          out.length = (h ? h + "h " : "") + (m || !h ? m + "m" : "");
        }
        return out;
      }
      // TV status: Returning Series / Planned / In Production / Ended /
      // Canceled / Pilot. Whether anything has aired is read off the
      // episodes rather than the status: "In Production" is used both for a
      // show yet to start and for one between seasons.
      Object.assign(out, tmdbAiring(data));
      if (out.airing) out.releaseStatus = out.airing === "upcoming" ? "upcoming" : "released";
      const next = data.next_episode_to_air;
      if (next && next.air_date) {
        out.nextAt = String(next.air_date).slice(0, 10);
        out.nextLabel = next.season_number
          ? "S" + next.season_number + "E" + next.episode_number
          : "Episode " + next.episode_number;
      }
      const seasons = data.number_of_seasons, episodes = data.number_of_episodes;
      const parts = [];
      if (seasons) parts.push(seasons + (seasons === 1 ? " season" : " seasons"));
      if (episodes) parts.push(episodes + (episodes === 1 ? " episode" : " episodes"));
      out.length = parts.join(" · ");
      return out;
    } catch (e) { return { ...EMPTY_DETAILS }; }
  }

  // TMDB numbers episodes within a season, so the counts are a season's:
  // "S3 · 7 of 10" mid-season, "S3 · 10" between seasons. An ended show
  // counts the whole run instead.
  function tmdbAiring(data) {
    const last = data.last_episode_to_air, next = data.next_episode_to_air;
    if (data.status === "Ended" || data.status === "Canceled") {
      const out = { airing: data.status === "Ended" ? "finished" : "cancelled" };
      if (data.number_of_episodes) out.episodesOut = out.episodesTotal = data.number_of_episodes;
      return out;
    }
    if (!last || !last.season_number) return data.status ? { airing: "upcoming" } : {};
    const season = last.season_number;
    const listed = (data.seasons || []).find((x) => x.season_number === season);
    const total = listed && listed.episode_count;
    // Mid-season is the next episode being in the same season, or the
    // season still having episodes to come with no date on them yet.
    const midSeason = next ? next.season_number === season : !!total && total > last.episode_number;
    const out = { airing: midSeason ? "airing" : "between", airingSeason: season };
    if (last.episode_number) out.episodesOut = last.episode_number;
    if (total) out.episodesTotal = total;
    return out;
  }

  // An IMDb id to its TMDB title (the Stremio sync): Stremio files
  // movies and shows under their IMDb id, and TMDB's /find maps one across.
  // `type` is "movie" or "tv". undefined means TMDB couldn't be asked (no
  // key, network), null that it was asked and has no such title.
  async function findTmdbByImdb(imdbId, type, apiKey) {
    if (!apiKey || !/^tt\d+$/.test(imdbId || "")) return undefined;
    try {
      const url = "https://api.themoviedb.org/3/find/" + encodeURIComponent(imdbId) +
        "?external_source=imdb_id&api_key=" + encodeURIComponent(apiKey);
      const res = await get(url);
      if (!res.ok) return undefined;
      const data = await res.json();
      const hit = (data[type === "movie" ? "movie_results" : "tv_results"] || [])[0];
      return hit ? mapTmdbResult(hit, type) : null;
    } catch (e) { return undefined; }
  }

  // How many episodes each season of a show has, and how far it has aired,
  // so a Stremio "S2E5" can be turned into a count of episodes watched.
  async function fetchTmdbSeasons(id, apiKey) {
    if (!apiKey || !id) return null;
    try {
      const res = await get("https://api.themoviedb.org/3/tv/" + encodeURIComponent(id) + "?api_key=" + encodeURIComponent(apiKey));
      if (!res.ok) return null;
      const data = await res.json();
      return {
        seasons: (data.seasons || []).filter((x) => x.season_number > 0).map((x) => ({ season: x.season_number, episodes: x.episode_count || 0 })),
        ...tmdbAiring(data),
      };
    } catch (e) { return null; }
  }

  async function searchTmdb(title, type, apiKey) {
    if (!apiKey) return [];
    try {
      const url = "https://api.themoviedb.org/3/search/" + type +
        "?query=" + encodeURIComponent(title) + "&api_key=" + encodeURIComponent(apiKey);
      const res = await get(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).slice(0, 5).map((r) => mapTmdbResult(r, type));
    } catch (e) { return []; }
  }

  // One row of a TMDB list, search or discover — both endpoints hand back
  // the same object, so the shape only needs describing once.
  function mapTmdbResult(r, type) {
    const genreMap = type === "movie" ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
    const dateStr = r.release_date || r.first_air_date || "";
    return {
      id: String(r.id),
      title: r.title || r.name || "",
      coverUrl: r.poster_path ? "https://image.tmdb.org/t/p/w92" + r.poster_path : "",
      year: dateStr ? parseInt(dateStr, 10) : null,
      ...releaseFromString(dateStr),
      summary: r.overview || "",
      externalRating: r.vote_average
        ? (Math.round(r.vote_average * 10) / 10) + " TMDB"
        : "",
      genres: normGenres((r.genre_ids || []).map((id) => genreMap[id]).filter(Boolean)),
      source: type === "movie" ? "tmdb-movie" : "tmdb-tv",
    };
  }

  // `author` (0.267.0) narrows the search when the item already names one:
  // a common title ("Circe", "Dune") is a different book per author.
  async function searchOpenLibrary(title, author) {
    try {
      const url = "https://openlibrary.org/search.json?title=" + encodeURIComponent(title) +
        (author ? "&author=" + encodeURIComponent(author) : "") + "&limit=5";
      const res = await get(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.docs || []).slice(0, 5).map((d) => ({
        id: d.key || "",
        title: d.title || "",
        coverUrl: d.cover_i
          ? "https://covers.openlibrary.org/b/id/" + d.cover_i + "-M.jpg"
          : "",
        year: d.first_publish_year || null,
        // Open Library's search endpoint only ever gives a year, no full date.
        ...releaseFromParts(d.first_publish_year, null, null),
        summary: "",
        externalRating: d.ratings_average
          ? (Math.round(d.ratings_average * 10) / 10) + " OL"
          : "",
        length: d.number_of_pages_median ? d.number_of_pages_median + " pages" : "",
        genres: normGenres(d.subject),
        author: (d.author_name || [])[0] || "",
        source: "openlibrary",
      }));
    } catch (e) { return []; }
  }

  // AniList status is FINISHED / RELEASING / NOT_YET_RELEASED / CANCELLED /
  // HIATUS — only NOT_YET_RELEASED means "hasn't started". For anything
  // mid-run, nextAiringEpisode is the date worth listing, and the episode
  // before it is how many are out.
  const ANILIST_AIRING = { NOT_YET_RELEASED: "upcoming", RELEASING: "airing", FINISHED: "finished", HIATUS: "hiatus", CANCELLED: "cancelled" };
  function aniListStatus(m) {
    const out = {};
    if (m.status) out.releaseStatus = m.status === "NOT_YET_RELEASED" ? "upcoming" : "released";
    const airing = ANILIST_AIRING[m.status];
    if (airing) out.airing = airing;
    const total = m.type === "MANGA" ? m.chapters : m.episodes;
    if (total) out.episodesTotal = total;
    if (airing === "finished" && total) out.episodesOut = total;
    const next = m.nextAiringEpisode;
    if (next && next.airingAt) {
      const at = unixToDateStr(next.airingAt);
      if (at) { out.nextAt = at; out.nextLabel = "Episode " + next.episode; }
      if (next.episode > 1) out.episodesOut = next.episode - 1;
    }
    return out;
  }

  async function searchAniList(title, type) {
    try {
      // status + nextAiringEpisode ride along on the search request at no
      // extra cost, and say outright what a date comparison can only guess:
      // whether it's out yet, and when the next episode lands.
      const query = "query ($search: String, $type: MediaType) { Page(perPage: 5) { media(search: $search, type: $type) { " + ANILIST_FIELDS + " } } }";
      const res = await get("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { search: title, type } }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const media = (data.data && data.data.Page && data.data.Page.media) || [];
      return media.map((m) => mapAniListResult(m, type));
    } catch (e) { return []; }
  }

  // The fields every AniList media query asks for. Shared so a discover
  // query can't drift from the search one and hand back a half-filled row.
  const ANILIST_FIELDS = "id title { romaji english } startDate { year month day } status type episodes chapters nextAiringEpisode { airingAt episode } coverImage { medium } description(asHtml: false) averageScore genres";

  function mapAniListResult(m, type) {
    const sd = m.startDate || {};
    return {
      id: String(m.id),
      title: (m.title && (m.title.english || m.title.romaji)) || "",
      coverUrl: (m.coverImage && m.coverImage.medium) || "",
      year: sd.year || null,
      ...releaseFromParts(sd.year, sd.month, sd.day),
      ...aniListStatus(m),
      summary: stripHtml(m.description),
      externalRating: m.averageScore ? m.averageScore + "% AniList" : "",
      genres: normGenres(m.genres),
      source: type === "MANGA" ? "anilist-manga" : "anilist-anime",
    };
  }

  // Reads a public AniList user's lists for one media type — no auth needed
  // for public lists, and AniList sends CORS headers, so no proxy is
  // required (unlike the Steam wishlist). Items come back in the same
  // normalized shape searchAniList produces (so cover art, rating, genres all
  // wire up the same way), or null on a hard failure (network, private list,
  // unknown user) so the caller can tell "empty list" from "couldn't reach it".
  //
  // Every status list comes whole, in one request (0.268.0; before, Completed
  // was asked only about the backlog's own titles). Each item carries
  // `listStatus` ("planning", "current", "completed", "paused", "dropped")
  // and, from the list entry, `startedAt`, `completedAt` (YYYY-MM-DD, when
  // the day is known) and `score` (1-5, 0 for unscored).
  const ANILIST_LIST_MEDIA = "id type title { romaji english } coverImage { medium } startDate { year month day } status nextAiringEpisode { airingAt episode } averageScore genres episodes chapters volumes";
  const ANILIST_LIST_ENTRY = "status progress updatedAt score(format: POINT_5) startedAt { year month day } completedAt { year month day } media { " + ANILIST_LIST_MEDIA + " }";
  const ANILIST_LIST_STATUS = { PLANNING: "planning", CURRENT: "current", COMPLETED: "completed", PAUSED: "paused", DROPPED: "dropped" };

  // With a token (0.292.0) the request is the signed-in user's: it can read
  // a private list and write to it.
  async function aniListQuery(query, variables, token) {
    const res = await get("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) { lastError = "AniList request failed (HTTP " + res.status + ")"; return null; }
    const data = await res.json();
    if (data.errors && data.errors.length) {
      lastError = "AniList: " + (data.errors[0].message || "user not found or list is private");
      return null;
    }
    return data.data || null;
  }

  function fuzzyDay(d) {
    if (!d || !d.year || !d.month || !d.day) return "";
    return d.year + "-" + String(d.month).padStart(2, "0") + "-" + String(d.day).padStart(2, "0");
  }

  function mapAniListListEntry(e, type) {
    const m = e.media;
    const sd = m.startDate || {};
    let length = "";
    if (type === "ANIME") {
      length = m.episodes ? m.episodes + (m.episodes === 1 ? " episode" : " episodes") : "";
    } else {
      const parts = [];
      if (m.volumes) parts.push(m.volumes + (m.volumes === 1 ? " volume" : " volumes"));
      if (m.chapters) parts.push(m.chapters + (m.chapters === 1 ? " chapter" : " chapters"));
      length = parts.join(" · ");
    }
    return {
      id: String(m.id),
      title: (m.title && (m.title.english || m.title.romaji)) || "",
      coverUrl: (m.coverImage && m.coverImage.medium) || "",
      year: sd.year || null,
      ...releaseFromParts(sd.year, sd.month, sd.day),
      ...aniListStatus({ type, ...m }),
      externalRating: m.averageScore ? m.averageScore + "% AniList" : "",
      length,
      genres: normGenres(m.genres),
      source: type === "MANGA" ? "anilist-manga" : "anilist-anime",
      listStatus: ANILIST_LIST_STATUS[e.status] || "",
      startedAt: fuzzyDay(e.startedAt),
      completedAt: fuzzyDay(e.completedAt),
      score: Math.round(+e.score || 0),
      // Episodes (chapters for a manga) you're through, and when the list
      // entry last changed, in ms (0.292.0, for the two-way sync).
      progress: Math.max(0, Math.round(+e.progress || 0)),
      updatedAt: (+e.updatedAt || 0) * 1000,
      ...(type === "MANGA" ? (m.chapters ? { total: m.chapters } : {}) : (m.episodes ? { total: m.episodes } : {})),
    };
  }

  async function fetchAniListLists(userName, type, token) {
    if (!userName) { lastError = "Enter your AniList username"; return null; }
    try {
      const query = "query ($userName: String, $type: MediaType) { MediaListCollection(userName: $userName, type: $type, status_in: [PLANNING, CURRENT, COMPLETED, PAUSED, DROPPED]) { lists { isCustomList entries { " + ANILIST_LIST_ENTRY + " } } } }";
      const data = await aniListQuery(query, { userName, type }, token);
      if (!data) return null;
      const lists = (data.MediaListCollection && data.MediaListCollection.lists) || [];
      const out = [];
      const seen = new Set();
      // A custom list repeats entries that are already on a status list.
      for (const list of lists) {
        if (list.isCustomList) continue;
        for (const e of list.entries || []) {
          if (!e.media || seen.has(e.media.id)) continue;
          seen.add(e.media.id);
          out.push(mapAniListListEntry(e, type));
        }
      }
      return out;
    } catch (e) {
      lastError = "AniList request failed (" + ((e && e.message) || "network error") + ")";
      return null;
    }
  }

  // Who a token belongs to: the check the token box runs when one is
  // pasted. null when it's refused or AniList can't be reached.
  async function aniListViewer(token) {
    try {
      const data = await aniListQuery("query { Viewer { id name } }", {}, token);
      return data && data.Viewer ? { id: data.Viewer.id, name: data.Viewer.name } : null;
    } catch (e) {
      lastError = "AniList request failed (" + ((e && e.message) || "network error") + ")";
      return null;
    }
  }

  // Writes one title's list entry: `status` (PLANNING, CURRENT, COMPLETED,
  // DROPPED), `progress`, and `startedAt` / `completedAt` as YYYY-MM-DD or
  // YYYY-MM. A field left out is left as AniList has it. Returns the entry
  // as AniList now has it ({ status, progress, updatedAt in ms }), or null.
  const fuzzyInput = (s) => {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s || "");
    return m ? { year: +m[1], month: +m[2], day: m[3] ? +m[3] : null } : undefined;
  };
  async function saveAniListEntry(token, mediaId, fields) {
    const vars = { mediaId: +mediaId };
    if (fields.status) vars.status = fields.status;
    if (fields.progress != null) vars.progress = Math.max(0, Math.round(+fields.progress || 0));
    const started = fuzzyInput(fields.startedAt), completed = fuzzyInput(fields.completedAt);
    if (started) vars.startedAt = started;
    if (completed) vars.completedAt = completed;
    const query = "mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) { SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, startedAt: $startedAt, completedAt: $completedAt) { status progress updatedAt } }";
    try {
      const data = await aniListQuery(query, vars, token);
      const e = data && data.SaveMediaListEntry;
      return e ? { status: ANILIST_LIST_STATUS[e.status] || "", progress: +e.progress || 0, updatedAt: (+e.updatedAt || 0) * 1000 } : null;
    } catch (e) {
      lastError = "AniList request failed (" + ((e && e.message) || "network error") + ")";
      return null;
    }
  }

  // Fallback for AniList (anime/manga) — an unofficial MyAnimeList API proxy,
  // no auth needed. Kept stricter on rate limits than AniList (it throttles
  // hard since it's proxying MAL), so it's only ever queried as a fallback,
  // never the primary source.
  async function searchJikan(title, type) {
    try {
      const url = "https://api.jikan.moe/v4/" + type + "?q=" + encodeURIComponent(title) + "&limit=5";
      const res = await get(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map((d) => mapJikanResult(d, type));
    } catch (e) { return []; }
  }

  // One row of a Jikan list, search or discover.
  function mapJikanResult(d, type) {
    const dateProp = type === "anime" ? d.aired : d.published;
    // .prop.from breaks the date into nullable year/month/day parts, so
    // precision comes straight from the source — better than slicing
    // dateProp.from, which pads a month-only date out to a fake day.
    const from = (dateProp && dateProp.prop && dateProp.prop.from) || {};
    let length = "";
    if (type === "anime") {
      length = d.episodes ? d.episodes + (d.episodes === 1 ? " episode" : " episodes") : "";
    } else {
      const parts = [];
      if (d.volumes) parts.push(d.volumes + (d.volumes === 1 ? " volume" : " volumes"));
      if (d.chapters) parts.push(d.chapters + (d.chapters === 1 ? " chapter" : " chapters"));
      length = parts.join(" · ");
    }
    return {
      id: String(d.mal_id || ""),
      title: d.title_english || d.title || "",
      coverUrl: (d.images && d.images.jpg && (d.images.jpg.image_url || d.images.jpg.small_image_url)) || "",
      year: from.year || null,
      ...releaseFromParts(from.year, from.month, from.day),
      // Jikan status is free text — "Not yet aired", "Currently Airing",
      // "Finished Airing" for anime; "Upcoming", "Publishing", "Finished"
      // for manga.
      ...(d.status
        ? { releaseStatus: /^(not yet|upcoming)/i.test(d.status) ? "upcoming" : "released" }
        : {}),
      ...jikanAiring(d, type),
      summary: d.synopsis || "",
      externalRating: d.score ? d.score + " Jikan" : "",
      length,
      genres: normGenres((d.genres || []).map((x) => x.name)),
      source: type === "manga" ? "jikan-manga" : "jikan-anime",
    };
  }

  // The same free text, as how far it has run. Jikan has no "how many are
  // out" for something still airing, only the total once it's known.
  function jikanAiring(d, type) {
    const st = String(d.status || "");
    const airing = /^(not yet|upcoming)/i.test(st) ? "upcoming"
      : /^(currently|publishing)/i.test(st) ? "airing"
      : /^finished/i.test(st) ? "finished"
      : /hiatus/i.test(st) ? "hiatus"
      : /discontinued/i.test(st) ? "cancelled" : "";
    if (!airing) return {};
    const out = { airing };
    const total = type === "manga" ? d.chapters : d.episodes;
    if (total) out.episodesTotal = total;
    if (airing === "finished" && total) out.episodesOut = total;
    return out;
  }

  async function searchGoogleBooks(title, author) {
    try {
      const url = "https://www.googleapis.com/books/v1/volumes?q=" +
        encodeURIComponent("intitle:" + title + (author ? " inauthor:" + author : "")) + "&maxResults=5";
      const res = await get(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).slice(0, 5).map((it) => {
        const v = it.volumeInfo || {};
        const thumb = (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || "";
        return {
          id: it.id || "",
          title: v.title || "",
          coverUrl: thumb.replace(/^http:/, "https:"),
          year: v.publishedDate ? parseInt(v.publishedDate, 10) : null,
          // Precision varies by book — "YYYY", "YYYY-MM", or "YYYY-MM-DD".
          ...releaseFromString(v.publishedDate),
          summary: v.description || "",
          externalRating: v.averageRating ? v.averageRating + " Google Books" : "",
          length: v.pageCount ? v.pageCount + " pages" : "",
          genres: normGenres(v.categories),
          author: (v.authors || [])[0] || "",
          source: "googlebooks",
        };
      });
    } catch (e) { return []; }
  }

  // Games fallback (behind RAWG) — cover-art focused, so results carry no
  // year/rating, just a title match and a grid-style cover. SteamGridDB's API
  // sends no Access-Control-Allow-Origin header, so a browser can't call it
  // directly (confirmed CORS-blocked on a real device) — it goes through the
  // same self-hosted CORS proxy as the Steam wishlist, whose /steamgriddb/<path>
  // route forwards the request server-side and passes the Authorization header
  // through. Without a proxy configured there's nothing to try, so it returns
  // [] with a lastError explaining why rather than failing silently.
  async function searchSteamGridDB(title, apiKey, proxyUrl) {
    if (!apiKey) return [];
    if (!proxyUrl) {
      lastError = "SteamGridDB needs the CORS proxy URL set (Settings → Media lookups) — it's CORS-blocked without it";
      return [];
    }
    const auth = { Authorization: "Bearer " + apiKey };
    try {
      const url = proxyUrl + "/steamgriddb/search/autocomplete/" + encodeURIComponent(title);
      const res = await get(url, { headers: auth });
      if (!res.ok) { lastError = "SteamGridDB lookup failed (HTTP " + res.status + ")"; return []; }
      const data = await res.json();
      if (!data || !data.success) { lastError = "SteamGridDB lookup failed (bad response)"; return []; }
      const games = (data.data || []).slice(0, 5);
      // The autocomplete endpoint returns name matches only; each pick's
      // cover comes from a second per-game call to the grids endpoint, done
      // lazily up front here (small batch, capped at 5) rather than only on
      // pick, so the picker list itself shows real art like every other source.
      const withCovers = await Promise.all(games.map(async (g) => {
        let coverUrl = "";
        try {
          const gridRes = await get(proxyUrl + "/steamgriddb/grids/game/" + g.id, { headers: auth });
          if (gridRes.ok) {
            const gridData = await gridRes.json();
            coverUrl = (gridData.success && gridData.data && gridData.data[0] && (gridData.data[0].thumb || gridData.data[0].url)) || "";
          }
        } catch (e) { /* missing cover isn't fatal — the title match still stands */ }
        // SGDB's autocomplete does date each game — it just wasn't being
        // read, so every SteamGridDB match used to land with no date at all.
        const release = releaseFromSgdb(g.release_date);
        return {
          id: String(g.id),
          title: g.name || "",
          coverUrl,
          year: release.releaseDate ? parseInt(release.releaseDate, 10) : null,
          ...release,
          summary: "",
          externalRating: "",
          source: "steamgriddb",
        };
      }));
      return withCovers;
    } catch (e) {
      lastError = "SteamGridDB lookup failed (" + ((e && e.message) || "network/CORS error") + ")";
      return [];
    }
  }

  // "SteamGridDB + Steam + GG.deals" combo source: same search as plain
  // SteamGridDB (its grid art is the reason to pick it over RAWG), just
  // tagged so the pick also resolves a Steam App ID — the direct equivalent
  // of the RAWG combo above, and the same trade: one extra request on the
  // picked game in exchange for a store link and a price.
  async function searchSteamGridDbSteamGg(title, apiKey, proxyUrl) {
    const results = await searchSteamGridDB(title, apiKey, proxyUrl);
    return results.map((r) => ({ ...r, source: "steamgriddb-steam-gg" }));
  }

  // SteamGridDB is a cover-art database, so a match off it is a title, a grid
  // image and a date and nothing else — no rating, no length, no genres, no
  // description, because its API carries none of that. That made a game
  // picked from it the last kind of backlog item to land bare. This fills the
  // gap from RAWG by title, exactly the way the Steam wishlist import already
  // does (fetchRawgInfo in sync.js): one search, top match, and only the
  // fields SGDB left empty are taken.
  // Deliberately not the date: RAWG dates a game by its *earliest* platform
  // release (see searchRawg), often a console version years before the PC
  // one, while SGDB dates the entry you actually picked — so a cross-filled
  // date would be a downgrade, not a gap being filled.
  // The description costs a second request, RAWG's search endpoint having
  // none (see fetchRawgDetails), so it's spent only when the caller says
  // nothing better is coming: a steamgriddb-steam-gg pick that resolves to a
  // Steam App ID is already fetching Steam's own store blurb, which wins over
  // RAWG's anyway, and the journal has no description field at all.
  // Silent on every failure — no RAWG key, no match, a network error — since
  // both calls below already answer with empties rather than throwing. This
  // is a nice-to-have on top of a pick that has otherwise succeeded.
  async function fetchSteamGridDbCrossFill(title, apiKey, wantSummary) {
    if (!apiKey || !title) return { ...EMPTY_DETAILS };
    const top = (await searchRawg(title, apiKey))[0];
    if (!top) return { ...EMPTY_DETAILS };
    const out = {
      ...EMPTY_DETAILS,
      externalRating: top.externalRating || "",
      length: top.length || "",
      genres: top.genres || [],
      // So a caller that skipped the blurb can still ask for it by RAWG id
      // once it knows nothing better is coming (pickDetails in journal.js).
      rawgId: top.id || "",
    };
    if (!wantSummary) return out;
    const details = await fetchRawgDetails(top.id, apiKey);
    return { ...out, summary: details.summary || "" };
  }

  // One SteamGridDB game by its SGDB id, asked for with its storefront ids
  // attached (?platformdata=steam). Same CORS proxy as the search. Returns
  // null if it can't be fetched — every caller treats that as "SGDB has
  // nothing more to say", never as an error worth surfacing.
  async function fetchSteamGridDbGame(sgdbId, apiKey, proxyUrl) {
    if (!apiKey || !proxyUrl || !sgdbId) return null;
    try {
      const url = proxyUrl + "/steamgriddb/games/id/" + encodeURIComponent(sgdbId) + "?platformdata=steam";
      const res = await get(url, { headers: { Authorization: "Bearer " + apiKey } });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.success) return null;
      // `data.data` is documented as the game object, but the endpoint has
      // also been seen answering with a single-element array — both shapes
      // are cheap to accept, and guessing wrong just silently loses the id.
      return (Array.isArray(data.data) ? data.data[0] : data.data) || null;
    } catch (e) { return null; }
  }

  // A SteamGridDB pick is only half an identity: its game id is SGDB's own,
  // so an item tagged with it gets no Steam store link and no GG.deals price
  // (both are keyed on a Steam App ID). SGDB knows the mapping though, and
  // returns it under external_platform_data. Returns "" for games SGDB has
  // no Steam listing for (plenty are itch.io or console-only), which leaves
  // the item on its plain SteamGridDB identity.
  async function fetchSteamGridDbSteamAppId(sgdbId, apiKey, proxyUrl) {
    const game = await fetchSteamGridDbGame(sgdbId, apiKey, proxyUrl);
    const steam = game && game.external_platform_data && game.external_platform_data.steam;
    const appId = steam && steam[0] && steam[0].id;
    return appId ? String(appId) : "";
  }

  // Re-check by SGDB id, for a backlog item still waiting on a release (see
  // fetchRelease below). Without this, a SteamGridDB-sourced item was one of
  // the ones the 🔭 re-check had to skip for having "no lookup by id".
  async function fetchSteamGridDbRelease(sgdbId, apiKey, proxyUrl) {
    const game = await fetchSteamGridDbGame(sgdbId, apiKey, proxyUrl);
    if (!game) return null;
    const rel = releaseFromSgdb(game.release_date);
    return rel.releaseDate ? rel : null;
  }

  // Steam files Early Access as a genre (id 70) rather than a flag, and
  // removes it the day a game ships 1.0 — so the marker's absence says as
  // much as its presence, but only on a response that carried the genres
  // list at all (the proxy has to ask for it; see proxy/worker.js). An
  // older proxy that doesn't states nothing either way, which is why this
  // returns an empty object rather than `false` in that case. Matching on
  // the id, not `description`: that string is localized.
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function steamEarlyAccess(data) {
    const genres = data && data.genres;
    if (!Array.isArray(genres)) return {};
    return { earlyAccess: genres.some((g) => String(g && g.id) === "70") };
  }

  // Once a game has a Steam App ID, Steam itself is the best source for when
  // it comes out, and for what it is — RAWG dates a game by its *earliest*
  // platform release (often a console version years before the PC one), and
  // SteamGridDB dates it by whatever its own entry says. Steam also states
  // outright whether a game is out yet (coming_soon), is happy to be vague in
  // the honest way ("Q1 2026") where the others invent a specific day, and
  // says in its genres list whether the game is in Early Access (see
  // steamEarlyAccess above). short_description comes along for the ride: it's
  // Steam's own one-paragraph blurb, and for a game that resolved to an App
  // ID it beats anything a name-matched source could offer.
  //
  // This is the only place that response is read. It used to be written out
  // twice — once here, once in sync.js for the wishlist import — which meant
  // every field added to it had to be added in both, and the Early Access
  // marker nearly wasn't. The one real difference between the two callers is
  // `retries`: an import walks hundreds of app ids and gets rate-limited
  // partway through, so it backs off and tries again, while a single lookup
  // behind one pick has nothing to gain from waiting and fails fast.
  //
  // Returns null when the lookup itself failed. `{ name: null, … }` is a
  // *successful* response for an app Steam doesn't recognize — a different
  // thing, and the import distinguishes them.
  // How Long to Beat's times and two review scores (0.282.0), by Steam App
  // ID, from Augmented Steam's API: the same answer its browser extension
  // shows on a store page. HLTB itself has no public API, and its site
  // search only answers requests dressed up as its own page, which LifeLog
  // doesn't do; this is a plain request, through the proxy (or the app's
  // native HTTP) like the other Steam routes. Times are minutes, as
  // Augmented Steam gives them. { hltb, reviews }, either one null when it
  // has nothing; throws when the request itself fails, so a caller can tell
  // "nothing known" from "couldn't ask".
  const REVIEW_SITES = {
    opencritic: /^https:\/\/opencritic\.com\//,
    metauser: /^https:\/\/(www\.)?metacritic\.com\//,
  };
  async function fetchGameInfo(appId, proxyUrl) {
    if (!proxyUrl || !/^\d+$/.test(String(appId || ""))) return { hltb: null, reviews: null };
    const res = await get(proxyUrl + "/augsteam-app/" + appId);
    // A game Augmented Steam doesn't know is an answer, not a failure. The
    // worker's own "Not found" (an old worker without the route) is plain
    // text; Augmented Steam's is JSON.
    if (res.status === 404 && /json/.test(res.headers.get("content-type") || "")) return { hltb: null, reviews: null };
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = (await res.json()) || {};
    const min = (v) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : 0);
    const h = data.hltb || {};
    let hltb = { story: min(h.story), extras: min(h.extras), complete: min(h.complete) };
    if (!hltb.story && !hltb.extras && !hltb.complete) hltb = null;
    else if (/^https:\/\/howlongtobeat\.com\/game\/\d+$/.test(h.url || "")) hltb.url = h.url;
    let reviews = {};
    for (const [site, ok] of Object.entries(REVIEW_SITES)) {
      const r = (data.reviews || {})[site];
      const score = r && Math.round(+r.score);
      if (!(score > 0 && score <= 100)) continue;
      reviews[site] = { score };
      if (typeof r.verdict === "string" && r.verdict) reviews[site].verdict = r.verdict.slice(0, 40);
      if (ok.test(r.url || "")) reviews[site].url = r.url;
    }
    if (!Object.keys(reviews).length) reviews = null;
    return { hltb, reviews };
  }
  // "32 hrs", "53½ hrs": HLTB's own rounding, to the nearest half hour.
  function gameHours(minutes) {
    const halves = Math.round((+minutes || 0) / 30);
    if (!halves) return "";
    const whole = Math.floor(halves / 2);
    return (whole ? String(whole) : "") + (halves % 2 ? "½" : "") + " hrs";
  }

  async function fetchSteamAppDetails(appId, proxyUrl, retries, attempt) {
    if (!appId || !proxyUrl) return null;
    retries = retries || 0;
    attempt = attempt || 0;
    try {
      const res = await get(proxyUrl + "/steam-appdetails/" + encodeURIComponent(appId));
      if (res.status === 429 && attempt < retries) {
        await sleep(1500 * (attempt + 1));
        return fetchSteamAppDetails(appId, proxyUrl, retries, attempt + 1);
      }
      if (!res.ok) return null;
      const data = await res.json();
      const entry = data && data[appId];
      if (!entry || !entry.success || !entry.data) return null;
      const rd = entry.data.release_date || {};
      return {
        name: entry.data.name || null,
        summary: firstParagraph(stripHtml(entry.data.short_description)),
        release: {
          ...parseSteamReleaseDate(rd.date),
          // Only when Steam actually stated it — a missing release_date block
          // is "we don't know", not "it's out", and shouldn't overrule a date
          // another source did manage to find.
          ...(typeof rd.coming_soon === "boolean"
            ? { releaseStatus: rd.coming_soon ? "upcoming" : "released" }
            : {}),
          ...steamEarlyAccess(entry.data),
        },
      };
    } catch (e) { return null; }
  }

  // The release fields plus the blurb, flattened — what a caller holding one
  // App ID wants, with no name to resolve and no import to pace.
  async function fetchSteamDetails(appId, proxyUrl) {
    const info = await fetchSteamAppDetails(appId, proxyUrl);
    return info ? { ...info.release, summary: info.summary } : null;
  }

  // Steam's own storesearch API has no CORS allowance for third-party origins,
  // so it can never be called from a browser — there is no search here.
  // Instead the app asks for a Steam App ID directly (found in the game's
  // store URL) and builds the cover image straight from Steam's CDN, since
  // <img> tags aren't subject to CORS the way fetch() is.
  function steamCoverUrl(appId) {
    return "https://cdn.akamai.steamstatic.com/steam/apps/" + encodeURIComponent(appId) + "/header.jpg";
  }

  // Looks up current/historical lowest prices for Steam app IDs via the
  // GG.deals API. appIds are Steam app IDs (the same id searchSteam returns).
  // GG.deals has no Access-Control-Allow-Origin either, so this needs the
  // same CORS proxy as Steam's own endpoints (see proxy/worker.js) — falls
  // back to a direct call only if no proxy URL is configured.
  async function fetchGgDealsPrices(appIds, apiKey, proxyUrl) {
    if (!apiKey || !appIds.length) return {};
    try {
      const base = proxyUrl ? proxyUrl + "/gg-deals" : "https://api.gg.deals/v1/prices/by-steam-app-id/";
      const url = base + "?ids=" +
        appIds.join(",") + "&key=" + encodeURIComponent(apiKey) + "&region=us";
      const res = await get(url);
      if (!res.ok) { lastError = "GG.deals price lookup failed (HTTP " + res.status + ")"; return {}; }
      const data = await res.json();
      if (!data || !data.success) { lastError = "GG.deals price lookup failed (bad response)"; return {}; }
      return data.data || {};
    } catch (e) {
      lastError = "GG.deals price lookup failed (" + ((e && e.message) || "network/CORS error") + ")";
      return {};
    }
  }

  // ---------- re-checking an already-linked title ----------
  // A backlog item that's waiting on a release is the one thing in the app
  // that goes stale on its own: a TBA gets a date, a date slips a quarter, a
  // season starts airing. These re-ask the source by the id already stored on
  // the item — no title matching, so nothing can drift onto a different work
  // — and return just the release fields, or null if the source can't say.
  // Same per-game request as fetchRawgDetails — the re-check only reads the
  // release fields off it (applyItemRelease in sync.js copies those and
  // nothing else), and an empty precision is how a failed lookup reads.
  async function fetchRawgRelease(id, apiKey) {
    const d = await fetchRawgDetails(id, apiKey);
    return d.releasePrecision ? d : null;
  }

  async function fetchAniListRelease(id) {
    if (!id) return null;
    try {
      const query = "query ($id: Int) { Media(id: $id) { startDate { year month day } status type episodes chapters nextAiringEpisode { airingAt episode } } }";
      const res = await get("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { id: parseInt(id, 10) } }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const m = data && data.data && data.data.Media;
      if (!m) return null;
      const sd = m.startDate || {};
      return { ...releaseFromParts(sd.year, sd.month, sd.day), ...aniListStatus(m) };
    } catch (e) { return null; }
  }

  async function searchMusicBrainz(title) {
    try {
      const url = "https://musicbrainz.org/ws/2/release-group/?query=" +
        encodeURIComponent(title) + "&fmt=json&limit=5";
      const res = await get(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data["release-groups"] || []).slice(0, 5).map((rg) => {
        const artist = (rg["artist-credit"] && rg["artist-credit"][0] && rg["artist-credit"][0].name) || "";
        const year = rg["first-release-date"] ? parseInt(rg["first-release-date"], 10) : null;
        return {
          id: rg.id || "",
          title: artist ? rg.title + " — " + artist : rg.title || "",
          coverUrl: rg.id ? "https://coverartarchive.org/release-group/" + rg.id + "/front-250" : "",
          year,
          // Precision varies — sometimes just a year, sometimes a full date.
          ...releaseFromString(rg["first-release-date"]),
          summary: "",
          externalRating: "",
          source: "musicbrainz",
        };
      });
    } catch (e) { return []; }
  }

  // A title reduced to something two spellings of the same thing agree on:
  // case, accents, punctuation and spacing folded away, and any trailing
  // season/book marker turned into a number rather than dropped.
  //
  // Keeping the number is the whole point. Dropping it — which is what
  // stripMediaSearchSuffix does, correctly, for a *search* — would make
  // "Slime S1" and "Slime Season 4" the same title, and an owned first
  // season would hide a fourth nobody has seen. No marker at all counts as
  // 1, which is what lets "Attack on Titan S1" recognise plain "Attack on
  // Titan". "3rd Season" is folded into "Season 3" first, since AniList
  // writes it both ways.
  const TITLE_ORDINAL_RE = /(\d+)(?:st|nd|rd|th)\s+(season|part)\s*$/i;
  const TITLE_PART_RE = /[-–—:\s]+(?:season|s|book|b|part|p|vol|volume)\s*\.?\s*(\d+)\s*$/i;
  function titleKey(title) {
    let t = String(title == null ? "" : title).trim().replace(TITLE_ORDINAL_RE, "$2 $1");
    const m = t.match(TITLE_PART_RE);
    const part = m ? parseInt(m[1], 10) : 1;
    if (m) t = t.slice(0, m.index);
    const base = t
      // Before NFKD, which decomposes ™ into the letters "TM" and would
      // turn Steam's "BIOSHOCK™" into "bioshocktm" — a title that matches
      // nothing. Store names carry these constantly.
      .replace(/[™®©℗℠]/g, " ")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return base ? base + "|" + part : "";
  }

  // ---------- IGDB ----------
  // Twitch's game database: a second games source beside RAWG, so a games
  // category still finds things when RAWG is down (it was out for a week in
  // November 2026). It signs in through Twitch with a client ID and secret
  // (Settings → Media lookups) traded for an app token that lasts about 60
  // days, kept on this device only. Its API takes POSTed queries and sends
  // no CORS headers, so it goes through the proxy like SteamGridDB: your
  // worker in a browser, the app's own native route on a phone or computer
  // (platform.js). It knows what RAWG knows, plus a real early access status
  // for any game, not just Steam ones, and a typical play time.
  const IGDB_TOKEN_KEY = "lifelog-igdb-token-v1";
  let igdbToken = null;
  function igdbErr(msg) {
    lastError = msg;
    if (typeof window !== "undefined" && window.LifeLogErrors) window.LifeLogErrors.record(msg);
  }
  function igdbCreds(keys) {
    const k = keys || {};
    const id = String(k.igdb || "").trim(), secret = String(k.igdbSecret || "").trim();
    return id && secret ? { id, secret } : null;
  }
  function readIgdbToken() {
    if (igdbToken) return igdbToken;
    try { igdbToken = JSON.parse(localStorage.getItem(IGDB_TOKEN_KEY) || "null"); } catch (e) { igdbToken = null; }
    return igdbToken;
  }
  function saveIgdbToken(t) {
    igdbToken = t;
    try { if (t) localStorage.setItem(IGDB_TOKEN_KEY, JSON.stringify(t)); else localStorage.removeItem(IGDB_TOKEN_KEY); } catch (e) { /* kept in memory */ }
  }
  // A day's margin, so a token never runs out halfway through a sync.
  async function igdbAccessToken(creds, proxyUrl, fresh) {
    const t = readIgdbToken();
    if (!fresh && t && t.clientId === creds.id && t.expiresAt > Date.now() + 86400000) return t.token;
    const res = await get(proxyUrl + "/igdb-token", { headers: { "Client-ID": creds.id, Authorization: "Secret " + creds.secret } });
    let body = null;
    try { body = await res.json(); } catch (e) { /* the status says it */ }
    if (!res.ok || !body || !body.access_token) {
      saveIgdbToken(null);
      const said = body && (body.message || body.error);
      const err = new Error("Twitch refused the IGDB client ID or secret (HTTP " + res.status + (said ? ": " + String(said).slice(0, 120) : "") + ")");
      err.status = res.status;
      throw err;
    }
    saveIgdbToken({ clientId: creds.id, token: body.access_token, expiresAt: Date.now() + (+body.expires_in || 0) * 1000 });
    return body.access_token;
  }
  // One query against one endpoint, as rows. A 401 means the token was
  // revoked or ran out early: one fresh token, one more try.
  async function igdbQuery(endpoint, query, keys, proxyUrl) {
    const creds = igdbCreds(keys);
    if (!creds) return [];
    if (!proxyUrl) { igdbErr("IGDB needs the CORS proxy URL set (Settings → Media lookups) — it's CORS-blocked without it"); return []; }
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await igdbAccessToken(creds, proxyUrl, attempt > 0);
        const res = await get(proxyUrl + "/igdb/" + endpoint + "?q=" + encodeURIComponent(query), {
          headers: { "Client-ID": creds.id, Authorization: "Bearer " + token },
        });
        if (res.status === 401 && attempt === 0) continue;
        if (!res.ok) {
          igdbErr(res.status === 429 ? "IGDB's rate limit is used up for now (HTTP 429)" : "IGDB request failed (HTTP " + res.status + ")");
          return [];
        }
        const rows = await res.json();
        return Array.isArray(rows) ? rows : [];
      }
      return [];
    } catch (e) {
      igdbErr(e && e.name === "TimeoutError"
        ? "IGDB didn't answer within " + FETCH_TIMEOUT_MS / 1000 + "s"
        : (e && e.status ? e.message : "IGDB request failed (" + ((e && e.message) || "network error") + ")"));
      return [];
    }
  }
  // A search phrase inside IGDB's query language, which quotes with ".
  const igdbText = (s) => String(s || "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

  const IGDB_FIELDS = "name,slug,cover.image_id,first_release_date,release_dates.date,release_dates.human," +
    "aggregated_rating,aggregated_rating_count,rating,rating_count,genres.name,status,game_status.status";
  function igdbCover(g) {
    const id = g.cover && g.cover.image_id;
    return /^[A-Za-z0-9_]+$/.test(id || "") ? "https://images.igdb.com/igdb/image/upload/t_cover_big/" + id + ".jpg" : "";
  }
  // IGDB writes each platform's date for people ("Mar 15, 2026", "Mar
  // 2026", "Q1 2026", "2026", "TBD"), and that wording is the only place it
  // admits how vague a date is: the numeric `date` beside a "2026" is a
  // placeholder Dec 31. So the earliest dated release is read from the words.
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function releaseFromIgdbHuman(human) {
    const h = String(human || "").trim().toLowerCase();
    const mm = (name) => String(MONTHS.indexOf(name.slice(0, 3)) + 1).padStart(2, "0");
    let m = /^([a-z]{3})[a-z]* (\d{1,2}), (\d{4})$/.exec(h);
    if (m && MONTHS.includes(m[1])) return { releaseDate: m[3] + "-" + mm(m[1]) + "-" + m[2].padStart(2, "0"), releasePrecision: "day" };
    m = /^([a-z]{3})[a-z]* (\d{4})$/.exec(h);
    if (m && MONTHS.includes(m[1])) return { releaseDate: m[2] + "-" + mm(m[1]), releasePrecision: "month" };
    m = /^q([1-4]) (\d{4})$/.exec(h);
    if (m) return { releaseDate: m[2] + "-" + String((+m[1] - 1) * 3 + 1).padStart(2, "0"), releasePrecision: "quarter" };
    m = /^(\d{4})$/.exec(h);
    if (m) return { releaseDate: m[1], releasePrecision: "year" };
    return null;
  }
  function releaseFromIgdb(g) {
    const dated = (g.release_dates || []).filter((r) => r && r.human)
      .map((r) => ({ r, rel: releaseFromIgdbHuman(r.human) }))
      .filter((x) => x.rel)
      .sort((a, b) => (a.rel.releaseDate < b.rel.releaseDate ? -1 : a.rel.releaseDate > b.rel.releaseDate ? 1 : 0));
    let rel = dated.length ? dated[0].rel : null;
    // IGDB's timestamps are UTC midnights, so read in UTC: a local reading
    // west of Greenwich is the day before.
    if (!rel && +g.first_release_date > 0) rel = { releaseDate: new Date(g.first_release_date * 1000).toISOString().slice(0, 10), releasePrecision: "day" };
    if (!rel) return { releaseDate: "", releasePrecision: "tba", releaseStatus: "upcoming" };
    const today = ymd(new Date());
    // A vague date is upcoming until its whole span has passed: "2026" is
    // still coming on Dec 1, 2026.
    const end = rel.releasePrecision === "day" ? rel.releaseDate
      : rel.releasePrecision === "year" ? rel.releaseDate + "-12-31"
      : rel.releasePrecision === "quarter" ? rel.releaseDate.slice(0, 5) + String(+rel.releaseDate.slice(5) + 2).padStart(2, "0") + "-31"
      : rel.releaseDate + "-31";
    return { ...rel, ...(end > today ? { releaseStatus: "upcoming" } : rel.releaseDate <= today && rel.releasePrecision === "day" ? { releaseStatus: "released" } : {}) };
  }
  // Early access as IGDB states it: its newer game_status name, or the old
  // status number (4) on entries not moved over yet. Said as false only when
  // IGDB says outright that the game is out, so a game with no status at
  // all doesn't clear a flag Steam set.
  function igdbEarlyAccess(g) {
    const name = String((g.game_status && g.game_status.status) || "").toLowerCase();
    if (name) return name === "early access" ? { earlyAccess: true } : name === "released" ? { earlyAccess: false } : {};
    if (g.status === 4) return { earlyAccess: true };
    if (g.status === 0) return { earlyAccess: false };
    return {};
  }
  // Critics first, as RAWG's Metacritic is: "84 IGDB" is the critics'
  // average, "76% IGDB users" the players'. Too few votes says nothing.
  function igdbRating(g) {
    if (g.aggregated_rating && (g.aggregated_rating_count || 0) >= 3) return Math.round(g.aggregated_rating) + " IGDB";
    if (g.rating && (g.rating_count || 0) >= 5) return Math.round(g.rating) + "% IGDB users";
    return "";
  }
  function mapIgdbResult(g) {
    const rel = releaseFromIgdb(g);
    return {
      id: String(g.id || ""),
      title: g.name || "",
      coverUrl: igdbCover(g),
      year: rel.releaseDate ? parseInt(rel.releaseDate, 10) : null,
      ...rel,
      ...igdbEarlyAccess(g),
      summary: "",
      externalRating: igdbRating(g),
      length: "",
      genres: normGenres((g.genres || []).map((x) => x && x.name)),
      source: "igdb",
    };
  }

  async function searchIgdb(title, keys, proxyUrl) {
    const q = igdbText(title);
    if (!q) return [];
    const rows = await igdbQuery("games", 'search "' + q + '"; fields ' + IGDB_FIELDS + "; limit 8;", keys, proxyUrl);
    return rows.map(mapIgdbResult);
  }
  async function searchIgdbSteamGg(title, keys, proxyUrl) {
    return (await searchIgdb(title, keys, proxyUrl)).map((r) => ({ ...r, source: "igdb-steam-gg" }));
  }

  // The per-game extras: the description, a fresh rating and date, and a
  // typical play time from IGDB's time-to-beat table (its "normally", what
  // most players took), asked for at the same time.
  async function fetchIgdbDetails(id, keys, proxyUrl) {
    if (!/^\d+$/.test(String(id || ""))) return { ...EMPTY_DETAILS };
    const [games, times] = await Promise.all([
      igdbQuery("games", "fields " + IGDB_FIELDS + ",summary; where id = " + id + ";", keys, proxyUrl),
      igdbQuery("game_time_to_beats", "fields normally,hastily; where game_id = " + id + ";", keys, proxyUrl),
    ]);
    const g = games[0];
    if (!g) return { ...EMPTY_DETAILS };
    const r = mapIgdbResult(g);
    const t = times[0] || {};
    const secs = +t.normally || +t.hastily || 0;
    return {
      ...EMPTY_DETAILS,
      externalRating: r.externalRating,
      length: secs > 0 ? gameHours(secs / 60) : "",
      summary: firstParagraph(g.summary || ""),
      releaseDate: r.releaseDate, releasePrecision: r.releasePrecision, releaseStatus: r.releaseStatus || "",
      ...igdbEarlyAccess(g),
    };
  }
  async function fetchIgdbRelease(id, keys, proxyUrl) {
    const d = await fetchIgdbDetails(id, keys, proxyUrl);
    return d.releasePrecision ? d : null;
  }

  // The Steam App ID for an IGDB game, for "IGDB + Steam + GG.deals": its
  // external ids where IGDB files one under Steam (source 1, or category 1
  // on older entries), else a Steam store link among its websites.
  async function fetchIgdbSteamAppId(id, keys, proxyUrl) {
    if (!/^\d+$/.test(String(id || ""))) return "";
    const g = (await igdbQuery("games", "fields external_games.uid,external_games.category,external_games.external_game_source,websites.url; where id = " + id + ";", keys, proxyUrl))[0];
    if (!g) return "";
    for (const x of g.external_games || []) {
      const src = x && (typeof x.external_game_source === "object" ? x.external_game_source.id : x.external_game_source);
      if ((src === 1 || x.category === 1) && /^\d+$/.test(String(x.uid || ""))) return String(x.uid);
    }
    for (const w of g.websites || []) {
      const m = /store\.steampowered\.com\/app\/(\d+)/.exec((w && w.url) || "");
      if (m) return m[1];
    }
    return "";
  }

  // Discover's two lists. IGDB has no "trending" either, so popular is the
  // past year's games by how many players rated them, and upcoming the next
  // two years' by how many are waiting for them (IGDB's "hypes").
  async function discoverIgdb(kind, keys, proxyUrl) {
    const now = Math.floor(Date.now() / 1000);
    const year = 365 * 86400;
    const q = kind === "upcoming"
      ? "fields " + IGDB_FIELDS + "; where first_release_date > " + now + " & first_release_date < " + (now + 2 * year) + " & hypes > 0; sort hypes desc; limit 20;"
      : "fields " + IGDB_FIELDS + "; where first_release_date > " + (now - year) + " & first_release_date < " + now + " & rating_count > 0; sort rating_count desc; limit 20;";
    return (await igdbQuery("games", q, keys, proxyUrl)).map(mapIgdbResult);
  }

  // Next in series: the games IGDB groups with this one (its collections),
  // the earliest dated after it, as RAWG's series list is read.
  async function nextIgdb(id, keys, proxyUrl) {
    if (!/^\d+$/.test(String(id || ""))) return null;
    const self = (await igdbQuery("games", "fields collections,first_release_date,release_dates.date,release_dates.human; where id = " + id + ";", keys, proxyUrl))[0];
    const cols = ((self && self.collections) || []).filter((c) => Number.isInteger(c)).slice(0, 5);
    if (!cols.length) return null;
    const rows = (await igdbQuery("games", "fields " + IGDB_FIELDS + "; where collections = (" + cols.join(",") + ") & id != " + id + "; limit 50;", keys, proxyUrl)).map(mapIgdbResult);
    const rel = releaseFromIgdb(self);
    return earliestAfter(rows, rel.releasePrecision === "tba" ? "" : rel.releaseDate);
  }

  // ---------- Hardcover ----------
  // A books source with what Open Library and Google Books lack: which
  // series a book is in, and where, so a finished book can offer the next
  // one. It's a GraphQL API behind a personal token (hardcover.app →
  // Settings → Hardcover API), which expires when you said it would and
  // may be reset while the API is in beta. Its docs say queries mustn't run
  // in a browser, so it goes through the proxy like IGDB: your worker in a
  // browser, the app's own native route on a phone or computer.
  // Rate limit: 60 requests a minute, and search gives up after 2s.
  function noteError(msg) {
    lastError = msg;
    if (typeof window !== "undefined" && window.LifeLogErrors) window.LifeLogErrors.record(msg);
  }
  function hardcoverToken(keys) {
    return String((keys || {}).hardcover || "").trim().replace(/^bearer\s+/i, "");
  }
  async function hardcoverQuery(query, variables, keys, proxyUrl) {
    const token = hardcoverToken(keys);
    if (!token) return null;
    if (!proxyUrl) { noteError("Hardcover needs the CORS proxy URL set (Settings → Media lookups)"); return null; }
    try {
      const body = JSON.stringify({ query, variables: variables || {} });
      const res = await get(proxyUrl + "/hardcover?q=" + encodeURIComponent(body), { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) {
        noteError(res.status === 401 || res.status === 403 ? "Hardcover refused the token (HTTP " + res.status + ") — it may have expired"
          : res.status === 429 ? "Hardcover's rate limit is used up for now (HTTP 429)" : "Hardcover request failed (HTTP " + res.status + ")");
        return null;
      }
      const data = await res.json();
      if (data && data.errors && data.errors.length) {
        noteError("Hardcover: " + String(data.errors[0].message || "query failed").slice(0, 160));
        return null;
      }
      return (data && data.data) || null;
    } catch (e) {
      noteError(e && e.name === "TimeoutError" ? "Hardcover didn't answer within " + FETCH_TIMEOUT_MS / 1000 + "s"
        : "Hardcover request failed (" + ((e && e.message) || "network error") + ")");
      return null;
    }
  }
  // Too few readers' votes say nothing, as with IGDB's.
  function hardcoverRating(rating, count) {
    return +rating > 0 && (+count || 0) >= 3 ? (Math.round(+rating * 10) / 10) + " Hardcover" : "";
  }
  // One book, from a search hit (Typesense's document) or a GraphQL row.
  // A row is read through the cached_* columns rather than the image and
  // contributions relations: the API refuses queries more than three
  // levels deep, and a series' books are already two down. Its id is the
  // slug, since that's what its page address is made of
  // (hardcover.app/books/<slug>).
  function mapHardcoverBook(d) {
    const img = d.image || d.cached_image || {};
    const people = d.author_names || (Array.isArray(d.cached_contributors) ? d.cached_contributors.map((c) => c && c.author && c.author.name).filter(Boolean) : []);
    const series = d.featured_series && d.featured_series.series ? d.featured_series.series.name : (d.series_names || [])[0];
    const pos = d.featured_series && d.featured_series.position != null ? d.featured_series.position : d.featured_series_position;
    return {
      id: String(d.slug || ""),
      title: d.title || "",
      coverUrl: /^https:\/\//.test(img.url || "") ? img.url : "",
      year: +d.release_year || null,
      ...releaseFromParts(+d.release_year || null, null, null),
      summary: firstParagraph(d.description || ""),
      externalRating: hardcoverRating(d.rating, d.ratings_count),
      length: +d.pages > 0 ? d.pages + " pages" : "",
      genres: normGenres(d.genres),
      author: people[0] || "",
      ...(series ? { series: String(series) + (pos != null && pos !== "" ? " #" + pos : "") } : {}),
      source: "hardcover",
    };
  }
  const HARDCOVER_BOOK = "slug title release_year pages rating ratings_count description cached_image cached_contributors";

  async function searchHardcover(title, author, keys, proxyUrl) {
    const q = String(title || "").trim() + (author ? " " + String(author).trim() : "");
    if (!q.trim()) return [];
    const data = await hardcoverQuery('query ($q: String!) { search(query: $q, query_type: "Book", per_page: 8) { results } }', { q: q.slice(0, 200) }, keys, proxyUrl);
    let results = data && data.search && data.search.results;
    if (typeof results === "string") { try { results = JSON.parse(results); } catch (e) { results = null; } }
    return ((results && results.hits) || []).map((h) => h && h.document).filter((d) => d && d.title && d.slug).map(mapHardcoverBook);
  }

  // Next in the series: the first book filed after this one in its first
  // series, by position. Hardcover can list one book twice at a position
  // (two editions under different titles), so this one's own title is
  // passed over. A book in no series, or the last, answers null.
  async function nextHardcover(slug, keys, proxyUrl) {
    if (!/^[a-z0-9-]{1,200}$/i.test(String(slug || ""))) return null;
    const mine = await hardcoverQuery("query ($s: String!) { books(where: {slug: {_eq: $s}}, limit: 1) { title book_series(limit: 3) { position series_id } } }", { s: slug }, keys, proxyUrl);
    const self = mine && mine.books && mine.books[0];
    const entry = ((self && self.book_series) || []).find((x) => Number.isInteger(x.series_id) && Number.isFinite(+x.position));
    if (!entry) return null;
    const after = await hardcoverQuery("{ book_series(where: {series_id: {_eq: " + entry.series_id + "}, position: {_gt: " + (+entry.position) + "}}, order_by: {position: asc}, limit: 5) { position book { " + HARDCOVER_BOOK + " } } }", null, keys, proxyUrl);
    const own = titleKey(self.title || "");
    const book = ((after && after.book_series) || []).map((x) => x && x.book).find((b) => b && b.title && b.slug && titleKey(b.title) !== own);
    return book ? mapHardcoverBook(book) : null;
  }

  // Discover's Popular: the books most added on Hardcover this past month.
  // No Coming soon, the way NYT's lists have none.
  async function discoverHardcover(kind, keys, proxyUrl) {
    if (kind === "upcoming") return [];
    const to = new Date(), from = new Date(Date.now() - 30 * 86400000);
    const trend = await hardcoverQuery('{ books_trending(from: "' + ymd(from) + '", to: "' + ymd(to) + '", limit: 20, offset: 0) { ids } }', null, keys, proxyUrl);
    const ids = ((trend && trend.books_trending && trend.books_trending.ids) || []).filter((n) => Number.isInteger(n)).slice(0, 20);
    if (!ids.length) return [];
    const data = await hardcoverQuery("{ books(where: {id: {_in: [" + ids.join(",") + "]}}) { id " + HARDCOVER_BOOK + " } }", null, keys, proxyUrl);
    const byId = new Map(((data && data.books) || []).map((b) => [b.id, b]));
    return ids.map((i) => byId.get(i)).filter((b) => b && b.slug).map(mapHardcoverBook);
  }

  // ---------- discover ----------
  // The lists behind the Backlog's Discover mode: what's big right now, and
  // what's coming. Every one of them returns the same normalized rows a
  // search does, so a discovered title is added through exactly the path a
  // picked search match takes — no second code path, and nothing new stored
  // on an item to say where it was found.
  //
  // Only sources that publish such a list are here. Open Library, Google
  // Books and MusicBrainz have no popularity data at all, SteamGridDB is an
  // artwork database, and Steam's charts are CORS-blocked like the rest of
  // its API. Those return nothing rather than something misleading.
  const DISCOVER_SOURCES = [
    "rawg", "rawg-steam-gg", "igdb", "igdb-steam-gg", "hardcover", "tmdb-movie", "tmdb-tv",
    "anilist-anime", "anilist-manga", "jikan-anime", "jikan-manga",
  ];

  function ymd(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function shiftedDate(years, days) {
    const d = new Date();
    if (years) d.setFullYear(d.getFullYear() + years);
    if (days) d.setDate(d.getDate() + days);
    return d;
  }

  // RAWG has no "trending" of its own, so popularity is "how many people
  // added it recently, among things actually out" — a year-wide window
  // ordered by adds, which is what its own front page does. Upcoming is the
  // same ordering over a forward window, so it's the anticipated ones rather
  // than everything with a future date on it.
  async function discoverRawg(kind, apiKey) {
    if (!apiKey) return [];
    const dates = kind === "upcoming"
      ? ymd(shiftedDate(0, 1)) + "," + ymd(shiftedDate(2, 0))
      : ymd(shiftedDate(-1, 0)) + "," + ymd(new Date());
    try {
      const url = "https://api.rawg.io/api/games?key=" + encodeURIComponent(apiKey) +
        "&dates=" + dates + "&ordering=-added&page_size=20";
      const res = await get(url);
      if (!res.ok) { noteRawgError(await rawgHttpError(res)); return []; }
      const data = await res.json();
      return (data.results || []).map(mapRawgResult);
    } catch (e) { noteRawgError(rawgNetError(e)); return []; }
  }

  // TMDB's own /trending is the "hot right now" list. For what's coming it
  // has /movie/upcoming but no TV equivalent, so both use /discover instead:
  // one shape, sorted by popularity, dated from today forward.
  async function discoverTmdb(kind, type, apiKey) {
    if (!apiKey) return [];
    const key = "api_key=" + encodeURIComponent(apiKey);
    const base = "https://api.themoviedb.org/3/";
    const url = kind === "upcoming"
      ? base + "discover/" + type + "?sort_by=popularity.desc&" +
        (type === "movie" ? "primary_release_date.gte=" : "first_air_date.gte=") +
        ymd(new Date()) + "&" + key
      : base + "trending/" + type + "/week?" + key;
    try {
      const res = await get(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).slice(0, 20).map((r) => mapTmdbResult(r, type));
    } catch (e) { return []; }
  }

  // AniList's TRENDING_DESC is a real "being talked about this week" signal
  // rather than an all-time popularity ranking, which is the difference
  // between a discover list and a hall of fame.
  async function discoverAniList(kind, type) {
    const filter = kind === "upcoming"
      ? "status: NOT_YET_RELEASED, sort: POPULARITY_DESC"
      : "sort: TRENDING_DESC";
    const query = "query ($type: MediaType) { Page(perPage: 20) { media(type: $type, " +
      filter + ") { " + ANILIST_FIELDS + " } } }";
    try {
      const res = await get("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { type } }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const media = (data.data && data.data.Page && data.data.Page.media) || [];
      return media.map((m) => mapAniListResult(m, type));
    } catch (e) { return []; }
  }

  // Jikan's top lists take a filter, so both kinds are the same endpoint —
  // "airing"/"publishing" for what's running now, "upcoming" for what isn't.
  async function discoverJikan(kind, type) {
    const filter = kind === "upcoming" ? "upcoming" : (type === "anime" ? "airing" : "publishing");
    try {
      const url = "https://api.jikan.moe/v4/top/" + type + "?filter=" + filter + "&limit=20";
      const res = await get(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map((d) => mapJikanResult(d, type));
    } catch (e) { return []; }
  }

  // The New York Times bestseller lists (0.272.0), the one popularity list
  // books have: Open Library and Google Books publish none. One request
  // for every current list; fiction and non-fiction (print and e-book
  // combined) are the two worth reading. NYT has no "coming soon", and its
  // books carry no Open Library or Google id, so each row is a title and an
  // author to look up in the category's own source when it's added
  // (`lookup`). NYT writes titles in capitals.
  const NYT_LISTS = ["combined-print-and-e-book-fiction", "combined-print-and-e-book-nonfiction"];
  function nytTitle(s) {
    return String(s || "").toLowerCase().replace(/(^|[\s(:\-"'])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  function mapNytBook(b) {
    return {
      id: "nyt-" + (b.primary_isbn13 || b.primary_isbn10 || titleKey(b.title)),
      title: nytTitle(b.title),
      author: b.author || "",
      coverUrl: b.book_image || "",
      year: null,
      releaseDate: "", releasePrecision: "",
      summary: b.description || "",
      externalRating: "",
      length: "",
      genres: [],
      lookup: true,
    };
  }
  async function discoverNyt(kind, apiKey) {
    if (!apiKey || kind === "upcoming") return [];
    try {
      const res = await get("https://api.nytimes.com/svc/books/v3/lists/overview.json?api-key=" + encodeURIComponent(apiKey));
      if (!res.ok) return [];
      const data = await res.json();
      const lists = (data.results && data.results.lists) || [];
      const rows = [];
      for (const name of NYT_LISTS) {
        const list = lists.find((l) => l.list_name_encoded === name);
        for (const b of (list && list.books) || []) rows.push(mapNytBook(b));
      }
      const seen = new Set();
      return rows.filter((r) => { const k = titleKey(r.title); if (!k || seen.has(k)) return false; seen.add(k); return true; });
    } catch (e) { return []; }
  }

  // ---------- is this result actually the thing you asked for? ----------
  // A search API always has an opinion. Ask RAWG for "BioShock" and it will
  // happily lead with "BioShock Infinite" — so "did it return anything" is not
  // the same question as "did it find it", and an auto-pick that takes
  // results[0] will confidently attach the wrong game's cover, rating and
  // length.
  //
  // The bar is the same title and nothing else, once case, accents,
  // punctuation, "&"/"and", trademark symbols and season/part markers are
  // normalised away (titleKey). 0.152.0 also accepted that title plus a
  // separated subtitle — "The Witcher 3" answered by "The Witcher 3: Wild
  // Hunt" — which is usually right and occasionally picks a spin-off. It was
  // dropped in 0.153.0 in favour of leaving a title alone and saying so: a
  // gap you can see beats a match you have to audit.
  function isTitleMatch(query, resultTitle) {
    const q = titleKey(query);
    return !!q && titleKey(resultTitle) === q;
  }

  // The result that IS `query`, or null. Never the closest thing: a caller
  // with nothing to show is expected to say so, not to settle.
  function pickMatch(results, query) {
    for (const r of results || []) if (isTitleMatch(query, r && r.title)) return r;
    return null;
  }

  // ---------- next in the series (0.275.0) ----------
  // The one title that follows `id` in its own series, in the search-result
  // shape, or null when the source knows of none. Each source says it
  // differently: RAWG has a per-game series list (every entry, prequels and
  // remasters included, so the pick is the earliest dated after this one),
  // TMDB groups films into collections (same pick, by release date), and
  // AniList states SEQUEL relations outright. TV shows have seasons, not
  // sequels, and Hardcover files a book in its series by position. Books
  // from other sources and music have no such link, so
  // those answer null without a request. A Steam-linked game has no RAWG
  // id, only a title, so RAWG is asked for the title first and only an
  // exact match is trusted (see pickMatch) — the wrong game's sequel is
  // worse than no offer.
  function earliestAfter(rows, afterDate) {
    const dated = rows.filter((r) => r.releaseDate && (!afterDate || r.releaseDate > afterDate))
      .sort((a, b) => a.releaseDate < b.releaseDate ? -1 : 1);
    return dated[0] || rows.find((r) => r.releasePrecision === "tba") || null;
  }

  async function nextRawg(id, apiKey) {
    if (!apiKey || !id) return null;
    try {
      const base = "https://api.rawg.io/api/games/" + encodeURIComponent(id);
      const key = "key=" + encodeURIComponent(apiKey);
      const [self, series] = await Promise.all([get(base + "?" + key), get(base + "/game-series?" + key + "&page_size=40")]);
      if (!self.ok || !series.ok) return null;
      const g = await self.json();
      const rows = ((await series.json()).results || []).map(mapRawgResult);
      return earliestAfter(rows, g.tba ? "" : (g.released || ""));
    } catch (e) { return null; }
  }

  async function nextTmdbMovie(id, apiKey) {
    if (!apiKey || !id) return null;
    try {
      const key = "api_key=" + encodeURIComponent(apiKey);
      const res = await get("https://api.themoviedb.org/3/movie/" + encodeURIComponent(id) + "?" + key);
      if (!res.ok) return null;
      const m = await res.json();
      const coll = m.belongs_to_collection;
      if (!coll || !coll.id) return null;
      const cres = await get("https://api.themoviedb.org/3/collection/" + encodeURIComponent(coll.id) + "?" + key);
      if (!cres.ok) return null;
      const parts = ((await cres.json()).parts || []).filter((p) => String(p.id) !== String(id));
      return earliestAfter(parts.map((p) => mapTmdbResult(p, "movie")), m.release_date || "");
    } catch (e) { return null; }
  }

  async function nextAniList(id, type) {
    if (!id) return null;
    try {
      const query = "query ($id: Int) { Media(id: $id) { relations { edges { relationType node { " + ANILIST_FIELDS + " } } } } }";
      const res = await get("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { id: parseInt(id, 10) } }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const edges = (data && data.data && data.data.Media && data.data.Media.relations && data.data.Media.relations.edges) || [];
      const seq = edges.find((e) => e.relationType === "SEQUEL" && e.node && e.node.type === type);
      return seq ? mapAniListResult(seq.node, type) : null;
    } catch (e) { return null; }
  }

  async function nextInSeries(id, source, keys, title, proxyUrl) {
    const k = keys || {};
    if (source === "rawg" || source === "rawg-steam-gg") {
      const r = await nextRawg(id, k.rawg || "");
      return r ? { ...r, source } : null;
    }
    if (source === "igdb" || source === "igdb-steam-gg") {
      const r = await nextIgdb(id, k, proxyUrl || "");
      return r ? { ...r, source } : null;
    }
    if (source === "steam") {
      const match = pickMatch(await searchRawg(title || "", k.rawg || ""), title || "");
      const r = match ? await nextRawg(match.id, k.rawg) : null;
      if (r) return { ...r, source: "rawg-steam-gg" };
      // No RAWG key, or RAWG down: IGDB, by the same exact-title rule.
      const alt = igdbCreds(k) && proxyUrl ? pickMatch(await searchIgdb(title || "", k, proxyUrl), title || "") : null;
      const n = alt ? await nextIgdb(alt.id, k, proxyUrl) : null;
      return n ? { ...n, source: "igdb-steam-gg" } : null;
    }
    if (source === "hardcover") return nextHardcover(id, k, proxyUrl || "");
    if (source === "tmdb-movie") return nextTmdbMovie(id, k.tmdb || "");
    if (source === "anilist-anime") return nextAniList(id, "ANIME");
    if (source === "anilist-manga") return nextAniList(id, "MANGA");
    return null;
  }

  // Settings → Media lookups shows whether each key works (one cheap request
  // per key). Each check asks for something small and, for Google, free:
  // Place Details with only the id in its field mask is the free "IDs only"
  // tier, so checking never costs a billed request. GG.deals and SteamGridDB
  // are CORS-blocked, so like their real lookups they go through the proxy.
  const enc = encodeURIComponent;
  const KEY_CHECKS = {
    rawg: (k) => ({ url: "https://api.rawg.io/api/genres?page_size=1&key=" + enc(k) }),
    tmdb: (k) => ({ url: "https://api.themoviedb.org/3/configuration?api_key=" + enc(k) }),
    ggdeals: (k, proxy) => proxy && { url: proxy + "/gg-deals?ids=620&key=" + enc(k) + "&region=us", success: true },
    steamgriddb: (k, proxy) => proxy && {
      url: proxy + "/steamgriddb/search/autocomplete/portal",
      init: { headers: { Authorization: "Bearer " + k } }, success: true,
    },
    googlePlaces: (k) => ({
      url: "https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4",
      init: { headers: { "X-Goog-Api-Key": k, "X-Goog-FieldMask": "id" } },
    }),
    nyt: (k) => ({ url: "https://api.nytimes.com/svc/books/v3/lists/names.json?api-key=" + enc(k) }),
    tiingo: (k, proxy) => proxy && { url: proxy + "/tiingo-meta/SPY", init: { headers: { Authorization: "Token " + k } } },
    // Hardcover's: who the token belongs to. A bad token is a GraphQL error
    // inside an HTTP 200, so the check reads the body.
    hardcover: (k, proxy) => proxy && {
      url: proxy + "/hardcover?q=" + enc(JSON.stringify({ query: "{ me { username } }" })),
      init: { headers: { Authorization: "Bearer " + String(k).trim().replace(/^bearer\s+/i, "") } },
      graphql: true,
    },
    // IGDB's check is the Twitch sign-in itself, so a working pair leaves a
    // token behind for the first search.
    igdb: (k, proxy, keys) => proxy && {
      url: proxy + "/igdb-token",
      init: { headers: { "Client-ID": k, Authorization: "Secret " + String(keys.igdbSecret || "").trim() } },
      igdb: true,
    },
  };
  // { state, label, detail }: state is ok, bad (the key is the problem),
  // warn (fixable elsewhere: limit, proxy) or down (the service didn't answer).
  async function checkKey(kind, key, proxyUrl, keys) {
    const make = KEY_CHECKS[kind];
    if (!make || !key) return null;
    if (kind === "igdb" && !String((keys || {}).igdbSecret || "").trim()) {
      return { state: "warn", label: "Needs the secret", detail: "Paste the client secret too — IGDB signs in with both" };
    }
    const req = make(String(key).trim(), proxyUrl, keys || {});
    if (!req) return { state: "warn", label: "Needs the proxy", detail: "Set the CORS proxy URL below — this service can't be reached without it" };
    let res;
    try { res = await get(req.url, req.init); }
    catch (e) {
      return e && e.name === "TimeoutError"
        ? { state: "down", label: "No answer", detail: "The service didn't answer within " + FETCH_TIMEOUT_MS / 1000 + "s — it may be down" }
        : { state: "down", label: "Can't reach", detail: "Couldn't reach the service — check your connection" };
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* the status decides */ }
    const said = body && ((body.error && (body.error.message || body.error)) || body.status_message || body.detail || body.fault && body.fault.faultstring || body.message);
    const refused = res.status === 401 || res.status === 403 || (res.status === 400 && /key|client/i.test(String(said || "")));
    if (refused || (res.ok && req.success && body && body.success === false)) {
      return { state: "bad", label: "Key refused", detail: "The service turned the key down" + (said ? ": " + String(said).slice(0, 160) : "") };
    }
    if (req.graphql && res.ok && body && body.errors && body.errors.length) {
      return { state: "bad", label: "Key refused", detail: "The service turned the key down: " + String(body.errors[0].message || "").slice(0, 160) };
    }
    if (res.status === 429) return { state: "warn", label: "Limit reached", detail: "The key works, but its rate limit or quota is used up for now" };
    if (!res.ok) return { state: "down", label: "Error " + res.status, detail: "The service answered HTTP " + res.status + (said ? ": " + String(said).slice(0, 160) : "") };
    if (req.igdb && body && body.access_token) saveIgdbToken({ clientId: String(key).trim(), token: body.access_token, expiresAt: Date.now() + (+body.expires_in || 0) * 1000 });
    return { state: "ok", label: "Working", detail: "The key works" };
  }

  window.LifeLogMedia = {
    checkKey,
    nextInSeries,
    async search(title, source, keys, proxyUrl, author) {
      lastError = "";
      if (!title || !source) return [];
      if (source === "rawg") return searchRawg(title, keys.rawg || "");
      if (source === "rawg-steam-gg") return searchRawgSteamGg(title, keys.rawg || "");
      if (source === "steamgriddb") return searchSteamGridDB(title, keys.steamgriddb || "", proxyUrl || "");
      if (source === "steamgriddb-steam-gg") return searchSteamGridDbSteamGg(title, keys.steamgriddb || "", proxyUrl || "");
      if (source === "igdb") return searchIgdb(title, keys, proxyUrl || "");
      if (source === "igdb-steam-gg") return searchIgdbSteamGg(title, keys, proxyUrl || "");
      if (source === "tmdb-movie") return searchTmdb(title, "movie", keys.tmdb || "");
      if (source === "tmdb-tv") return searchTmdb(title, "tv", keys.tmdb || "");
      if (source === "openlibrary") return searchOpenLibrary(title, author);
      if (source === "anilist-anime") return searchAniList(title, "ANIME");
      if (source === "anilist-manga") return searchAniList(title, "MANGA");
      if (source === "jikan-anime") return searchJikan(title, "anime");
      if (source === "jikan-manga") return searchJikan(title, "manga");
      if (source === "googlebooks") return searchGoogleBooks(title, author);
      if (source === "hardcover") return searchHardcover(title, author, keys, proxyUrl || "");
      if (source === "musicbrainz") return searchMusicBrainz(title);
      return [];
    },
    // The Discover mode’s two lists. `source` is the one the category is
    // configured with, and it is stamped back onto every row: a category set
    // to "RAWG + Steam + GG.deals" wants its discovered games resolved to a
    // Steam App ID on the way in, exactly as a searched one would be, and
    // the mappers only ever know their own bare source.
    async discover(source, kind, keys, proxyUrl) {
      lastError = "";
      const k = keys || {};
      let rows = [];
      if (source === "rawg" || source === "rawg-steam-gg") rows = await discoverRawg(kind, k.rawg || "");
      else if (source === "igdb" || source === "igdb-steam-gg") rows = await discoverIgdb(kind, k, proxyUrl || "");
      else if (source === "hardcover") rows = await discoverHardcover(kind, k, proxyUrl || "");
      else if (source === "tmdb-movie") rows = await discoverTmdb(kind, "movie", k.tmdb || "");
      else if (source === "tmdb-tv") rows = await discoverTmdb(kind, "tv", k.tmdb || "");
      else if (source === "anilist-anime") rows = await discoverAniList(kind, "ANIME");
      else if (source === "anilist-manga") rows = await discoverAniList(kind, "MANGA");
      else if (source === "jikan-anime") rows = await discoverJikan(kind, "anime");
      else if (source === "jikan-manga") rows = await discoverJikan(kind, "manga");
      // "nyt-openlibrary" and "nyt-googlebooks": NYT's lists, for a books
      // category, with the rows stamped as that category's own source.
      else if (source.startsWith("nyt-")) return (await discoverNyt(kind, k.nyt || "")).map((r) => ({ ...r, source: source.slice(4) }));
      return rows.map((r) => ({ ...r, source }));
    },
    supportsDiscover(source) { return DISCOVER_SOURCES.includes(source); },
    nytTitle, mapNytBook,
    fetchGameInfo, gameHours,
    async fetchPrices(appIds, apiKey, proxyUrl) {
      lastError = "";
      return fetchGgDealsPrices(appIds, apiKey, proxyUrl);
    },
    // Per-title extras that a search response can't include: TMDB's
    // runtime/season counts, production status and next episode, RAWG's
    // description, and for SteamGridDB — which states none of it — a RAWG
    // cross-fill of the lot. Takes the whole mediaKeys object, since which
    // key it needs depends on the source. `opts.title` is what that
    // cross-fill matches on (an SGDB id means nothing to RAWG) and
    // `opts.wantSummary` is the caller saying whether it has a better
    // description already coming, defaulting to yes for a caller that
    // doesn't say. Every other source already said everything it knows
    // during the search.
    async fetchDetails(id, source, keys, opts) {
      const k = keys || {};
      const o = opts || {};
      if (source === "igdb" || source === "igdb-steam-gg") return fetchIgdbDetails(id, k, o.proxyUrl || "");
      if (source === "tmdb-movie") return fetchTmdbDetails(id, "movie", k.tmdb || "");
      if (source === "tmdb-tv") return fetchTmdbDetails(id, "tv", k.tmdb || "");
      if (source === "rawg" || source === "rawg-steam-gg") return fetchRawgDetails(id, k.rawg || "");
      if (source === "steamgriddb" || source === "steamgriddb-steam-gg") {
        return fetchSteamGridDbCrossFill(o.title || "", k.rawg || "", o.wantSummary !== false);
      }
      return { ...EMPTY_DETAILS };
    },
    // The subset of the per-title extras a *journal* entry has fields for:
    // a length and genres, never a description or a release date — a
    // timeline entry is dated by when you finished the thing, not by when it
    // came out. RAWG is skipped outright: its playtime and its genres are
    // both exactly what the search already returned, so the request would
    // buy a timeline entry nothing. SteamGridDB is the opposite case, its
    // search stating neither, so it cross-fills — and one RAWG search
    // answers both fields at once, which is why this is a single call and
    // not a length lookup with a genre lookup behind it. Never the second
    // request a description would cost: there's nowhere here to put one.
    async fetchEntryExtras(id, source, keys, title, proxyUrl) {
      if (source === "rawg" || source === "rawg-steam-gg") return { length: "", genres: [] };
      const d = await this.fetchDetails(id, source, keys, { title, wantSummary: false, proxyUrl });
      return { length: d.length, genres: d.genres };
    },
    // Re-checks one item's release info by its stored media id. Returns null
    // for sources with no id-based lookup worth making — books and music
    // effectively never sit in a backlog waiting to come out, and re-running
    // a title search for them risks matching a different edition entirely.
    async fetchRelease(id, source, keys, proxyUrl) {
      lastError = "";
      if (source === "rawg" || source === "rawg-steam-gg") return fetchRawgRelease(id, (keys && keys.rawg) || "");
      if (source === "igdb" || source === "igdb-steam-gg") return fetchIgdbRelease(id, keys || {}, proxyUrl || "");
      if (source === "anilist-anime" || source === "anilist-manga") return fetchAniListRelease(id);
      if (source === "steamgriddb" || source === "steamgriddb-steam-gg") {
        return fetchSteamGridDbRelease(id, (keys && keys.steamgriddb) || "", proxyUrl || "");
      }
      if (source === "tmdb-movie" || source === "tmdb-tv") {
        const d = await fetchTmdbDetails(id, source === "tmdb-movie" ? "movie" : "tv", (keys && keys.tmdb) || "");
        return d.releasePrecision || d.releaseStatus || d.nextAt ? d : null;
      }
      return null;
    },
    async fetchRawgSteamAppId(rawgId, apiKey) {
      return fetchRawgSteamAppId(rawgId, apiKey);
    },
    async fetchIgdbSteamAppId(igdbId, keys, proxyUrl) {
      return fetchIgdbSteamAppId(igdbId, keys, proxyUrl);
    },
    async fetchSteamGridDbSteamAppId(sgdbId, apiKey, proxyUrl) {
      return fetchSteamGridDbSteamAppId(sgdbId, apiKey, proxyUrl);
    },
    async fetchSteamDetails(appId, proxyUrl) {
      return fetchSteamDetails(appId, proxyUrl);
    },
    async fetchSteamAppDetails(appId, proxyUrl, retries) {
      return fetchSteamAppDetails(appId, proxyUrl, retries);
    },
    async fetchAniListLists(userName, type, token) {
      lastError = "";
      return fetchAniListLists(userName, type, token);
    },
    getLastError: () => lastError,
    async aniListViewer(token) { lastError = ""; return aniListViewer(token); },
    async saveAniListEntry(token, mediaId, fields) { lastError = ""; return saveAniListEntry(token, mediaId, fields); },
    async hardcoverQuery(query, variables, keys, proxyUrl) { lastError = ""; return hardcoverQuery(query, variables, keys, proxyUrl); },
    steamCoverUrl,
    // pure helpers (used by sync.js/backlog.js, and by test/media.test.js)
    parseSteamReleaseDate,
    steamEarlyAccess,
    releaseFromString,
    releaseFromParts,
    releaseFromSgdb,
    mergeRelease,
    aniListStatus,
    tmdbAiring,
    findTmdbByImdb,
    fetchTmdbSeasons,
    jikanAiring,
    mapAniListListEntry,
    normGenres,
    titleKey,
    isTitleMatch,
    pickMatch,
    stripHtml,
    firstParagraph,
    rawgMeta,
    mapIgdbResult,
    mapHardcoverBook,
    releaseFromIgdbHuman,
  };
})();
