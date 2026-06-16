// LifeLog — media enrichment: fetch cover art and metadata from RAWG, TMDB, Open Library.
(function () {
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

  window.LifeLogMedia = {
    async search(title, source, keys) {
      if (!title || !source) return [];
      if (source === "rawg") return searchRawg(title, keys.rawg || "");
      if (source === "tmdb-movie") return searchTmdb(title, "movie", keys.tmdb || "");
      if (source === "tmdb-tv") return searchTmdb(title, "tv", keys.tmdb || "");
      if (source === "openlibrary") return searchOpenLibrary(title);
      return [];
    },
  };
})();
