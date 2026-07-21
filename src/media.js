// LifeLog — media enrichment: fetch cover art and metadata from RAWG,
// SteamGridDB, TMDB, Open Library, AniList, Jikan, Google Books, and
// MusicBrainz.
(function () {
  // Set whenever a search/price fetch fails outright (network error, CORS
  // block, bad key, rate limit) so the UI can show *why* nothing came back
  // instead of a generic "no matches" — most failures here are silent
  // browser-side CORS rejections that never reach devtools-less users.
  let lastError = "";

  function stripHtml(s) {
    return (s || "").replace(/<[^>]*>/g, "");
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
  async function searchRawg(title, apiKey) {
    if (!apiKey) return [];
    try {
      const url = "https://api.rawg.io/api/games?search=" + encodeURIComponent(title) +
        "&key=" + encodeURIComponent(apiKey) + "&page_size=5";
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).map((g) => ({
        id: g.slug || "",
        title: g.name || "",
        coverUrl: g.background_image || "",
        year: g.released ? parseInt(g.released, 10) : null,
        releaseDate: g.released || "",
        summary: "",
        externalRating: g.metacritic
          ? g.metacritic + " Metacritic"
          : (g.rating ? (Math.round(g.rating * 20)) + "% users" : ""),
        length: g.playtime ? g.playtime + " hrs" : "",
        genres: normGenres((g.genres || []).map((x) => x.name)),
        source: "rawg",
      }));
    } catch (e) { return []; }
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

  // TMDB's search endpoint has no runtime/season data — that only exists on
  // the per-title details endpoint, so it's a separate on-demand call (see
  // fetchTmdbDetails below), fired only when a specific title is picked.
  async function fetchTmdbDetails(id, type, apiKey) {
    if (!apiKey || !id) return "";
    try {
      const url = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(id) +
        "?api_key=" + encodeURIComponent(apiKey);
      const res = await fetch(url);
      if (!res.ok) return "";
      const data = await res.json();
      if (type === "movie") {
        if (!data.runtime) return "";
        const h = Math.floor(data.runtime / 60), m = data.runtime % 60;
        return (h ? h + "h " : "") + (m || !h ? m + "m" : "");
      }
      const seasons = data.number_of_seasons, episodes = data.number_of_episodes;
      if (!seasons && !episodes) return "";
      const parts = [];
      if (seasons) parts.push(seasons + (seasons === 1 ? " season" : " seasons"));
      if (episodes) parts.push(episodes + (episodes === 1 ? " episode" : " episodes"));
      return parts.join(" · ");
    } catch (e) { return ""; }
  }

  async function searchTmdb(title, type, apiKey) {
    if (!apiKey) return [];
    try {
      const url = "https://api.themoviedb.org/3/search/" + type +
        "?query=" + encodeURIComponent(title) + "&api_key=" + encodeURIComponent(apiKey);
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const imgBase = "https://image.tmdb.org/t/p/w92";
      const genreMap = type === "movie" ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
      return (data.results || []).slice(0, 5).map((r) => {
        const t = r.title || r.name || "";
        const dateStr = r.release_date || r.first_air_date || "";
        const year = dateStr ? parseInt(dateStr, 10) : null;
        return {
          id: String(r.id),
          title: t,
          coverUrl: r.poster_path ? imgBase + r.poster_path : "",
          year,
          releaseDate: dateStr || "",
          summary: r.overview || "",
          externalRating: r.vote_average
            ? (Math.round(r.vote_average * 10) / 10) + " TMDB"
            : "",
          genres: normGenres((r.genre_ids || []).map((id) => genreMap[id]).filter(Boolean)),
          source: type === "movie" ? "tmdb-movie" : "tmdb-tv",
        };
      });
    } catch (e) { return []; }
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
        releaseDate: d.first_publish_year ? String(d.first_publish_year) : "",
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

  async function searchAniList(title, type) {
    try {
      const query = "query ($search: String, $type: MediaType) { Page(perPage: 5) { media(search: $search, type: $type) { id title { romaji english } startDate { year month day } coverImage { medium } description(asHtml: false) averageScore genres } } }";
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { search: title, type } }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const media = (data.data && data.data.Page && data.data.Page.media) || [];
      return media.map((m) => {
        const sd = m.startDate;
        const releaseDate = sd && sd.year
          ? sd.year + (sd.month ? "-" + String(sd.month).padStart(2, "0") + (sd.day ? "-" + String(sd.day).padStart(2, "0") : "") : "")
          : "";
        return {
          id: String(m.id),
          title: (m.title && (m.title.english || m.title.romaji)) || "",
          coverUrl: (m.coverImage && m.coverImage.medium) || "",
          year: (sd && sd.year) || null,
          releaseDate,
          summary: stripHtml(m.description),
          externalRating: m.averageScore ? m.averageScore + "% AniList" : "",
          genres: normGenres(m.genres),
          source: type === "MANGA" ? "anilist-manga" : "anilist-anime",
        };
      });
    } catch (e) { return []; }
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
      const query = "query ($userName: String, $type: MediaType) { MediaListCollection(userName: $userName, type: $type, status: PLANNING) { lists { entries { media { id title { romaji english } coverImage { medium } startDate { year month day } averageScore genres episodes chapters volumes } } } } }";
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
          const sd = m.startDate;
          const releaseDate = sd && sd.year
            ? sd.year + (sd.month ? "-" + String(sd.month).padStart(2, "0") + (sd.day ? "-" + String(sd.day).padStart(2, "0") : "") : "")
            : "";
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
            year: (sd && sd.year) || null,
            releaseDate,
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
      return (data.data || []).map((d) => {
        const dateProp = type === "anime" ? d.aired : d.published;
        const year = (dateProp && dateProp.prop && dateProp.prop.from && dateProp.prop.from.year) || null;
        // dateProp.from is a full ISO datetime ("2013-04-06T00:00:00+00:00")
        // alongside the structured .prop breakdown used for `year` above.
        const releaseDate = (dateProp && dateProp.from) ? dateProp.from.slice(0, 10) : "";
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
          year,
          releaseDate,
          summary: d.synopsis || "",
          externalRating: d.score ? d.score + " Jikan" : "",
          length,
          genres: normGenres((d.genres || []).map((x) => x.name)),
          source: type === "manga" ? "jikan-manga" : "jikan-anime",
        };
      });
    } catch (e) { return []; }
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
          releaseDate: v.publishedDate || "",
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
        return {
          id: String(g.id),
          title: g.name || "",
          coverUrl,
          year: null,
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
          releaseDate: rg["first-release-date"] || "",
          summary: "",
          externalRating: "",
          source: "musicbrainz",
        };
      });
    } catch (e) { return []; }
  }

  window.LifeLogMedia = {
    async search(title, source, keys, proxyUrl) {
      lastError = "";
      if (!title || !source) return [];
      if (source === "rawg") return searchRawg(title, keys.rawg || "");
      if (source === "rawg-steam-gg") return searchRawgSteamGg(title, keys.rawg || "");
      if (source === "steamgriddb") return searchSteamGridDB(title, keys.steamgriddb || "", proxyUrl || "");
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
    async fetchPrices(appIds, apiKey, proxyUrl) {
      lastError = "";
      return fetchGgDealsPrices(appIds, apiKey, proxyUrl);
    },
    async fetchLength(id, source, apiKey) {
      if (source === "tmdb-movie") return fetchTmdbDetails(id, "movie", apiKey);
      if (source === "tmdb-tv") return fetchTmdbDetails(id, "tv", apiKey);
      return "";
    },
    async fetchRawgSteamAppId(rawgId, apiKey) {
      return fetchRawgSteamAppId(rawgId, apiKey);
    },
    async fetchAniListPlanning(userName, type) {
      lastError = "";
      return fetchAniListPlanning(userName, type);
    },
    getLastError: () => lastError,
    steamCoverUrl,
    // pure helpers (exported for test/media.test.js)
    normGenres,
    stripHtml,
  };
})();
