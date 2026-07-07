// LifeLog — media enrichment: fetch cover art and metadata from RAWG, TMDB,
// Open Library, AniList, Jikan, Google Books, and MusicBrainz.
(function () {
  // Set whenever a search/price fetch fails outright (network error, CORS
  // block, bad key, rate limit) so the UI can show *why* nothing came back
  // instead of a generic "no matches" — most failures here are silent
  // browser-side CORS rejections that never reach devtools-less users.
  let lastError = "";

  function stripHtml(s) {
    return (s || "").replace(/<[^>]*>/g, "");
  }
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
        summary: "",
        externalRating: g.metacritic
          ? g.metacritic + " Metacritic"
          : (g.rating ? (Math.round(g.rating * 20)) + "% users" : ""),
        length: g.playtime ? g.playtime + " hrs" : "",
        source: "rawg",
      }));
    } catch (e) { return []; }
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
      return (data.results || []).slice(0, 5).map((r) => {
        const t = r.title || r.name || "";
        const dateStr = r.release_date || r.first_air_date || "";
        const year = dateStr ? parseInt(dateStr, 10) : null;
        return {
          id: String(r.id),
          title: t,
          coverUrl: r.poster_path ? imgBase + r.poster_path : "",
          year,
          summary: r.overview || "",
          externalRating: r.vote_average
            ? (Math.round(r.vote_average * 10) / 10) + " TMDB"
            : "",
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
        summary: "",
        externalRating: d.ratings_average
          ? (Math.round(d.ratings_average * 10) / 10) + " OL"
          : "",
        length: d.number_of_pages_median ? d.number_of_pages_median + " pages" : "",
        source: "openlibrary",
      }));
    } catch (e) { return []; }
  }

  async function searchAniList(title, type) {
    try {
      const query = "query ($search: String, $type: MediaType) { Page(perPage: 5) { media(search: $search, type: $type) { id title { romaji english } startDate { year } coverImage { medium } description(asHtml: false) averageScore } } }";
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { search: title, type } }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const media = (data.data && data.data.Page && data.data.Page.media) || [];
      return media.map((m) => ({
        id: String(m.id),
        title: (m.title && (m.title.english || m.title.romaji)) || "",
        coverUrl: (m.coverImage && m.coverImage.medium) || "",
        year: (m.startDate && m.startDate.year) || null,
        summary: stripHtml(m.description),
        externalRating: m.averageScore ? m.averageScore + "% AniList" : "",
        source: type === "MANGA" ? "anilist-manga" : "anilist-anime",
      }));
    } catch (e) { return []; }
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
          summary: d.synopsis || "",
          externalRating: d.score ? d.score + " Jikan" : "",
          length,
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
          summary: v.description || "",
          externalRating: v.averageRating ? v.averageRating + " Google Books" : "",
          length: v.pageCount ? v.pageCount + " pages" : "",
          source: "googlebooks",
        };
      });
    } catch (e) { return []; }
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
  async function fetchGgDealsPrices(appIds, apiKey) {
    if (!apiKey || !appIds.length) return {};
    try {
      const url = "https://api.gg.deals/v1/prices/by-steam-app-id/?ids=" +
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
          summary: "",
          externalRating: "",
          source: "musicbrainz",
        };
      });
    } catch (e) { return []; }
  }

  window.LifeLogMedia = {
    async search(title, source, keys) {
      lastError = "";
      if (!title || !source) return [];
      if (source === "rawg") return searchRawg(title, keys.rawg || "");
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
    async fetchPrices(appIds, apiKey) {
      lastError = "";
      return fetchGgDealsPrices(appIds, apiKey);
    },
    async fetchLength(id, source, apiKey) {
      if (source === "tmdb-movie") return fetchTmdbDetails(id, "movie", apiKey);
      if (source === "tmdb-tv") return fetchTmdbDetails(id, "tv", apiKey);
      return "";
    },
    getLastError: () => lastError,
    steamCoverUrl,
  };
})();
