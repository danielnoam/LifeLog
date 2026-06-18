// LifeLog — media enrichment: fetch cover art and metadata from RAWG, TMDB,
// Open Library, AniList, Google Books, and MusicBrainz.
(function () {
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
        source: "rawg",
      }));
    } catch (e) { return []; }
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
          source: "googlebooks",
        };
      });
    } catch (e) { return []; }
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
      if (!title || !source) return [];
      if (source === "rawg") return searchRawg(title, keys.rawg || "");
      if (source === "tmdb-movie") return searchTmdb(title, "movie", keys.tmdb || "");
      if (source === "tmdb-tv") return searchTmdb(title, "tv", keys.tmdb || "");
      if (source === "openlibrary") return searchOpenLibrary(title);
      if (source === "anilist-anime") return searchAniList(title, "ANIME");
      if (source === "anilist-manga") return searchAniList(title, "MANGA");
      if (source === "googlebooks") return searchGoogleBooks(title);
      if (source === "musicbrainz") return searchMusicBrainz(title);
      return [];
    },
  };
})();
