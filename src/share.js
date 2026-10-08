// Share into LifeLog (0.250.0): what the phone's Share sheet hands the app.
//
// Three doors deliver the same thing, a title, a text and a link, and all
// three end here as `share?title=…&text=…&url=…`, the shape of an action
// (see runAction in app.js):
//
// - the installed web app, through manifest.json's share_target, which
//   arrives as ?title=&text=&url= on the page;
// - the Android app, through an ACTION_SEND intent the Widgets plugin
//   turns into that action string (ShareIntent.java);
// - the iOS app, when it gets a share extension, through lifelog://action/.
//
// Where it goes is decided from the link: a Google Maps link is a place for
// Travel, a link to a site that lists titles (Letterboxd, Steam, IMDb…) is a
// Backlog item with the lookup already running, and anything else asks,
// Backlog or Note, since text with no link could be either.
(() => {
  const MAPS = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i;
  // Sites a share is a title from. `slug` is the part of the path that spells
  // the title, when the site puts it there; the shared text usually carries
  // it too, and wins, since a slug drops punctuation.
  const MEDIA = [
    { host: /(^|\.)letterboxd\.com$/i, slug: /\/film\/([^/?#]+)/ },
    { host: /^boxd\.it$/i },
    { host: /(^|\.)imdb\.com$/i },
    { host: /^store\.steampowered\.com$/i, slug: /\/app\/\d+\/([^/?#]+)/ },
    { host: /(^|\.)myanimelist\.net$/i, slug: /\/(?:anime|manga)\/\d+\/([^/?#]+)/ },
    { host: /(^|\.)anilist\.co$/i, slug: /\/(?:anime|manga)\/\d+\/([^/?#]+)/ },
    { host: /(^|\.)themoviedb\.org$/i, slug: /\/(?:movie|tv)\/\d+-([^/?#]+)/ },
    { host: /(^|\.)goodreads\.com$/i, slug: /\/book\/show\/\d+[-.]([^/?#]+)/ },
    { host: /(^|\.)openlibrary\.org$/i, slug: /\/(?:works|books)\/[^/]+\/([^/?#]+)/ },
    { host: /(^|\.)rawg\.io$/i, slug: /\/games\/([^/?#]+)/ },
    { host: /(^|\.)youtube\.com$|^youtu\.be$/i },
  ];
  // What apps append to a page title when they share it.
  const SUFFIX = /\s*[-|–—·:]\s*(IMDb|Letterboxd|YouTube|Steam|MyAnimeList|AniList|TMDB|The Movie Database|Goodreads|Open Library|RAWG)\s*$/i;

  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const site = (url) => { const h = hostOf(url); return h ? MEDIA.find((m) => m.host.test(h)) : null; };

  function titleFromSlug(url, m) {
    if (!m || !m.slug) return "";
    let path = "";
    try { path = decodeURIComponent(new URL(url).pathname); } catch (e) { return ""; }
    const hit = m.slug.exec(path);
    if (!hit) return "";
    return hit[1].replace(/[-_+]+/g, " ").replace(/\s+(19|20)\d\d$/, "").trim()
      .replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }

  // The pieces of a share, tidied: the link pulled out of the text if it was
  // only there, the title without the sharing app's own name, and when
  // nothing named the thing, its name read off the link.
  function parse(query) {
    const p = new URLSearchParams(String(query || ""));
    let url = (p.get("url") || "").trim();
    let text = (p.get("text") || "").trim();
    let title = (p.get("title") || "").trim();
    if (!/^https?:\/\//i.test(url)) url = "";
    if (!url) {
      const m = /https?:\/\/[^\s<>"']+/.exec(text);
      if (m) url = m[0];
    }
    if (url) text = text.split(url).join("").replace(/\n{3,}/g, "\n\n").trim();
    if (!title) title = (text.split("\n")[0] || "").trim();
    title = title.replace(SUFFIX, "").trim();
    if (title === text) text = "";
    const where = url ? site(url) : null;
    if (!title && url) title = titleFromSlug(url, where) || (hostOf(url) && !MAPS.test(url) ? hostOf(url) : "");
    const kind = !url ? "text" : MAPS.test(url) ? "place" : where ? "media" : "link";
    // "Heat (1995)": the year the site appended, which the lookup takes as
    // part of the name.
    if (kind === "media") title = title.replace(/\s*\((19|20)\d\d\)$/, "").trim();
    return { title, text, url, kind };
  }

  let ctx = null;
  const $ = (s) => document.querySelector(s);

  function toBacklog(s) {
    const notes = [s.text, s.url].filter(Boolean).join("\n");
    ctx.Backlog.openBacklogModal(null, null, { title: s.title, notes, sync: s.kind === "media" });
  }
  function toNote(s) {
    ctx.Notes.openNoteModal(null);
    $("#nTitle").value = s.text ? s.title : "";
    $("#nText").value = [s.text || s.title, s.url].filter(Boolean).join("\n");
  }

  function open(query) {
    const s = parse(query);
    if (!s.title && !s.text && !s.url) return;
    const backlog = ctx.viewEnabled("backlog");
    const notes = ctx.modeEnabled("notes", "notes");
    if (s.kind === "place" && ctx.viewEnabled("travel")) { ctx.Travel.importSharedLink(s.url); return; }
    if (s.kind === "media" && backlog) { toBacklog(s); return; }
    if (backlog && !notes) { toBacklog(s); return; }
    if (notes && !backlog) { toNote(s); return; }
    if (!backlog && !notes) { ctx.toast("Backlog and Notes are both off — turn one on in Settings → Tabs to share into it", true); return; }
    pending = s;
    $("#sharePreview").textContent = [s.title, s.text !== s.title ? s.text : "", s.url].filter(Boolean).join("\n");
    $("#shareModal").hidden = false;
  }
  let pending = null;
  function close() { $("#shareModal").hidden = true; pending = null; }

  function start(c) {
    ctx = c;
    $("#shareToBacklog").onclick = () => { const s = pending; close(); if (s) toBacklog(s); };
    $("#shareToNote").onclick = () => { const s = pending; close(); if (s) toNote(s); };
    $("#cancelShareBtn").onclick = close;
  }

  const api = { parse, open, close, start };
  if (typeof window !== "undefined") window.LifeLogShare = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
