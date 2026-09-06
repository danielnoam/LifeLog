// LifeLog — media enrichment: fetch cover art and metadata from RAWG,
// SteamGridDB, TMDB, Open Library, AniList, Jikan, Google Books, and
// MusicBrainz.
(function () {
  // Set whenever a search/price fetch fails outright (network error, CORS
  // block, bad key, rate limit) so the UI can show *why* nothing came back
  // instead of a generic "no matches" — most failures here are silent
  // browser-side CORS rejections that never reach devtools-less users.
  let lastError = "";

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
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).map(mapRawgResult);
    } catch (e) { return []; }
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
      const res = await fetch(url);
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
      const res = await fetch(url);
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
      const res = await fetch(url);
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
      // Canceled / Pilot. Only "Planned" means nothing has aired yet.
      if (data.status) out.releaseStatus = data.status === "Planned" ? "upcoming" : "released";
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

  async function searchTmdb(title, type, apiKey) {
    if (!apiKey) return [];
    try {
      const url = "https://api.themoviedb.org/3/search/" + type +
        "?query=" + encodeURIComponent(title) + "&api_key=" + encodeURIComponent(apiKey);
      const res = await fetch(url);
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

  async function searchOpenLibrary(title) {
    try {
      const url = "https://openlibrary.org/search.json?title=" + encodeURIComponent(title) + "&limit=5";
      const res = await fetch(url);
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
        source: "openlibrary",
      }));
    } catch (e) { return []; }
  }

  // AniList status is FINISHED / RELEASING / NOT_YET_RELEASED / CANCELLED /
  // HIATUS — only the first of those means "hasn't started". For anything
  // mid-run, nextAiringEpisode is the date worth listing.
  function aniListStatus(m) {
    const out = {};
    if (m.status) out.releaseStatus = m.status === "NOT_YET_RELEASED" ? "upcoming" : "released";
    const next = m.nextAiringEpisode;
    if (next && next.airingAt) {
      const at = unixToDateStr(next.airingAt);
      if (at) { out.nextAt = at; out.nextLabel = "Episode " + next.episode; }
    }
    return out;
  }

  async function searchAniList(title, type) {
    try {
      // status + nextAiringEpisode ride along on the search request at no
      // extra cost, and say outright what a date comparison can only guess:
      // whether it's out yet, and when the next episode lands.
      const query = "query ($search: String, $type: MediaType) { Page(perPage: 5) { media(search: $search, type: $type) { " + ANILIST_FIELDS + " } } }";
      const res = await fetch("https://graphql.anilist.co", {
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
  const ANILIST_FIELDS = "id title { romaji english } startDate { year month day } status nextAiringEpisode { airingAt episode } coverImage { medium } description(asHtml: false) averageScore genres";

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

  // Pulls a public AniList user's "Planning" (plan-to-watch/plan-to-read)
  // list for one media type in a single GraphQL request — no auth needed for
  // public lists, and AniList sends CORS headers, so no proxy is required
  // (unlike the Steam wishlist). Returns items in the same normalized shape
  // searchAniList produces (so cover art, rating, genres all wire up the same
  // way), or null on a hard failure (network, private list, unknown user) so
  // the caller can tell "empty list" from "couldn't reach it".
  async function fetchAniListPlanning(userName, type) {
    if (!userName) { lastError = "Enter your AniList username"; return null; }
    try {
      const query = "query ($userName: String, $type: MediaType) { MediaListCollection(userName: $userName, type: $type, status: PLANNING) { lists { entries { media { id title { romaji english } coverImage { medium } startDate { year month day } status nextAiringEpisode { airingAt episode } averageScore genres episodes chapters volumes } } } } }";
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { userName, type } }),
      });
      if (!res.ok) { lastError = "AniList request failed (HTTP " + res.status + ")"; return null; }
      const data = await res.json();
      if (data.errors && data.errors.length) {
        lastError = "AniList: " + (data.errors[0].message || "user not found or list is private");
        return null;
      }
      const lists = (data.data && data.data.MediaListCollection && data.data.MediaListCollection.lists) || [];
      const out = [];
      for (const list of lists) {
        for (const e of list.entries || []) {
          const m = e.media;
          if (!m) continue;
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
          out.push({
            id: String(m.id),
            title: (m.title && (m.title.english || m.title.romaji)) || "",
            coverUrl: (m.coverImage && m.coverImage.medium) || "",
            year: sd.year || null,
            ...releaseFromParts(sd.year, sd.month, sd.day),
            ...aniListStatus(m),
            externalRating: m.averageScore ? m.averageScore + "% AniList" : "",
            length,
            genres: normGenres(m.genres),
            source: type === "MANGA" ? "anilist-manga" : "anilist-anime",
          });
        }
      }
      return out;
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
      const res = await fetch(url);
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
      summary: d.synopsis || "",
      externalRating: d.score ? d.score + " Jikan" : "",
      length,
      genres: normGenres((d.genres || []).map((x) => x.name)),
      source: type === "manga" ? "jikan-manga" : "jikan-anime",
    };
  }

  async function searchGoogleBooks(title) {
    try {
      const url = "https://www.googleapis.com/books/v1/volumes?q=" +
        encodeURIComponent("intitle:" + title) + "&maxResults=5";
      const res = await fetch(url);
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
      lastError = "SteamGridDB needs the CORS proxy URL set (Settings → Media) — it's CORS-blocked without it";
      return [];
    }
    const auth = { Authorization: "Bearer " + apiKey };
    try {
      const url = proxyUrl + "/steamgriddb/search/autocomplete/" + encodeURIComponent(title);
      const res = await fetch(url, { headers: auth });
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
          const gridRes = await fetch(proxyUrl + "/steamgriddb/grids/game/" + g.id, { headers: auth });
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
      const res = await fetch(url, { headers: { Authorization: "Bearer " + apiKey } });
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
  async function fetchSteamAppDetails(appId, proxyUrl, retries, attempt) {
    if (!appId || !proxyUrl) return null;
    retries = retries || 0;
    attempt = attempt || 0;
    try {
      const res = await fetch(proxyUrl + "/steam-appdetails/" + encodeURIComponent(appId));
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
      const res = await fetch(url);
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
      const query = "query ($id: Int) { Media(id: $id) { startDate { year month day } status nextAiringEpisode { airingAt episode } } }";
      const res = await fetch("https://graphql.anilist.co", {
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
      const res = await fetch(url);
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
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return base ? base + "|" + part : "";
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
    "rawg", "rawg-steam-gg", "tmdb-movie", "tmdb-tv",
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
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).map(mapRawgResult);
    } catch (e) { return []; }
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
      const res = await fetch(url);
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
      const res = await fetch("https://graphql.anilist.co", {
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
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map((d) => mapJikanResult(d, type));
    } catch (e) { return []; }
  }

  window.LifeLogMedia = {
    async search(title, source, keys, proxyUrl) {
      lastError = "";
      if (!title || !source) return [];
      if (source === "rawg") return searchRawg(title, keys.rawg || "");
      if (source === "rawg-steam-gg") return searchRawgSteamGg(title, keys.rawg || "");
      if (source === "steamgriddb") return searchSteamGridDB(title, keys.steamgriddb || "", proxyUrl || "");
      if (source === "steamgriddb-steam-gg") return searchSteamGridDbSteamGg(title, keys.steamgriddb || "", proxyUrl || "");
      if (source === "tmdb-movie") return searchTmdb(title, "movie", keys.tmdb || "");
      if (source === "tmdb-tv") return searchTmdb(title, "tv", keys.tmdb || "");
      if (source === "openlibrary") return searchOpenLibrary(title);
      if (source === "anilist-anime") return searchAniList(title, "ANIME");
      if (source === "anilist-manga") return searchAniList(title, "MANGA");
      if (source === "jikan-anime") return searchJikan(title, "anime");
      if (source === "jikan-manga") return searchJikan(title, "manga");
      if (source === "googlebooks") return searchGoogleBooks(title);
      if (source === "musicbrainz") return searchMusicBrainz(title);
      return [];
    },
    // The Discover mode’s two lists. `source` is the one the category is
    // configured with, and it is stamped back onto every row: a category set
    // to "RAWG + Steam + GG.deals" wants its discovered games resolved to a
    // Steam App ID on the way in, exactly as a searched one would be, and
    // the mappers only ever know their own bare source.
    async discover(source, kind, keys) {
      lastError = "";
      const k = keys || {};
      let rows = [];
      if (source === "rawg" || source === "rawg-steam-gg") rows = await discoverRawg(kind, k.rawg || "");
      else if (source === "tmdb-movie") rows = await discoverTmdb(kind, "movie", k.tmdb || "");
      else if (source === "tmdb-tv") rows = await discoverTmdb(kind, "tv", k.tmdb || "");
      else if (source === "anilist-anime") rows = await discoverAniList(kind, "ANIME");
      else if (source === "anilist-manga") rows = await discoverAniList(kind, "MANGA");
      else if (source === "jikan-anime") rows = await discoverJikan(kind, "anime");
      else if (source === "jikan-manga") rows = await discoverJikan(kind, "manga");
      return rows.map((r) => ({ ...r, source }));
    },
    supportsDiscover(source) { return DISCOVER_SOURCES.includes(source); },
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
    async fetchEntryExtras(id, source, keys, title) {
      if (source === "rawg" || source === "rawg-steam-gg") return { length: "", genres: [] };
      const d = await this.fetchDetails(id, source, keys, { title, wantSummary: false });
      return { length: d.length, genres: d.genres };
    },
    // Re-checks one item's release info by its stored media id. Returns null
    // for sources with no id-based lookup worth making — books and music
    // effectively never sit in a backlog waiting to come out, and re-running
    // a title search for them risks matching a different edition entirely.
    async fetchRelease(id, source, keys, proxyUrl) {
      lastError = "";
      if (source === "rawg" || source === "rawg-steam-gg") return fetchRawgRelease(id, (keys && keys.rawg) || "");
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
    async fetchSteamGridDbSteamAppId(sgdbId, apiKey, proxyUrl) {
      return fetchSteamGridDbSteamAppId(sgdbId, apiKey, proxyUrl);
    },
    async fetchSteamDetails(appId, proxyUrl) {
      return fetchSteamDetails(appId, proxyUrl);
    },
    async fetchSteamAppDetails(appId, proxyUrl, retries) {
      return fetchSteamAppDetails(appId, proxyUrl, retries);
    },
    async fetchAniListPlanning(userName, type) {
      lastError = "";
      return fetchAniListPlanning(userName, type);
    },
    getLastError: () => lastError,
    steamCoverUrl,
    // pure helpers (used by sync.js/backlog.js, and by test/media.test.js)
    parseSteamReleaseDate,
    steamEarlyAccess,
    releaseFromString,
    releaseFromParts,
    releaseFromSgdb,
    mergeRelease,
    normGenres,
    titleKey,
    stripHtml,
    firstParagraph,
    rawgMeta,
  };
})();
