// LifeLog — the Backlog: the view (category sections with priority/
// unreleased/dropped ordering and separators), plain + rich rows, the
// add/edit modal with title suggestions and media sync, backlog bulk
// actions, and the backlog sanitizer. Extracted from app.js; shared app
// plumbing arrives via init(ctx). The GG.deals price cluster, cover-link
// buttons, and applySteamAppId stay in app.js — the journal entry modal
// uses them too — and are handed in through ctx.
(function () {
  // Shared app plumbing, provided by app.js via init(ctx).
  let state, $, el, uid, toast, persist, render, renderLazySections, groupBy, colorOf,
    emptyState, emptyCoverEl, bulkActionBar, bulkCheckbox, toggleBulkItem,
    toggleBulkCategoryAll, attachLongPressSelect, openEntryModal,
    fillCategorySelect, wireCategorySelect, titleSuggestions,
    backlogSuggestions, makeMediaAcItem, fetchMediaSuggestions, renderStreamedSuggestions,
    resolveMediaIdentity, updateSyncBtnVisibility, showSyncStatus,
    renderCoverLinkButtons, renderMediaLinks, isOverridden, sanitizeOverrides,
    initOverrideFields, refreshOverrideFields, pushOverrideValues, readOverrideChecks,
    loadBacklogPrices, applySteamAppId,
    backfillUpdatedAt, saveUiState, MONTHS_SHORT, DEFAULT_SETTINGS;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, renderLazySections, groupBy, colorOf,
      emptyState, emptyCoverEl, bulkActionBar, bulkCheckbox, toggleBulkItem,
      toggleBulkCategoryAll, attachLongPressSelect, openEntryModal,
      fillCategorySelect, wireCategorySelect, titleSuggestions,
      backlogSuggestions, makeMediaAcItem, fetchMediaSuggestions, renderStreamedSuggestions,
      resolveMediaIdentity, updateSyncBtnVisibility, showSyncStatus,
      renderCoverLinkButtons, renderMediaLinks, isOverridden, sanitizeOverrides,
    initOverrideFields, refreshOverrideFields, pushOverrideValues, readOverrideChecks,
    loadBacklogPrices, applySteamAppId,
      backfillUpdatedAt, saveUiState, MONTHS_SHORT, DEFAULT_SETTINGS } = ctx);
  }

  // Coarse "N days/months/years ago" for the backlog edit modal's aging line.
  function agingText(iso) {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days < 1) return "today";
    if (days === 1) return "1 day ago";
    if (days < 30) return days + " days ago";
    const months = Math.floor(days / 30);
    if (months < 12) return months === 1 ? "1 month ago" : months + " months ago";
    const years = Math.floor(months / 12);
    return years === 1 ? "1 year ago" : years + " years ago";
  }

  function priorityBadge() {
    const span = el("span", "bpriority", "★");
    span.title = "Prioritized";
    return span;
  }

  // Shared media-metadata block for a backlog item — "★ rating · year ·
  // length · price" on one line, then the summary paragraph. Used by the
  // rich list row, the edit-modal cover, and the "pick something for me"
  // modal so all three stay in sync. Fields are read off a plain object so
  // callers can pass either a stored item or live form values. The GG.deals
  // price span fills in later (async); returns whether there is one so the
  // caller can kick off the fetch — this helper only builds DOM.
  // opts.summary === false drops the description paragraph — the backlog
  // list passes it for anyone who'd rather keep the rows compact (Settings →
  // Backlog descriptions). The modals and the pick card always show it:
  // that's the "open it and read it" half of that setting.
  function appendBacklogMeta(container, item, opts) {
    const parts = [];
    if (item.externalRating) parts.push("★ " + item.externalRating);
    if (item.releaseYear) parts.push(String(item.releaseYear));
    if (item.length) parts.push(item.length);
    const hasSteamPrice = item.mediaSource === "steam" && !!item.mediaId;
    if (parts.length || hasSteamPrice) {
      const metaLine = el("span", "bl-meta");
      if (parts.length) metaLine.appendChild(document.createTextNode(parts.join(" · ")));
      if (hasSteamPrice) {
        const price = el("span", "bl-price");
        price.dataset.appid = item.mediaId;
        if (parts.length) price.dataset.sep = "1";
        metaLine.appendChild(price);
      }
      container.appendChild(metaLine);
    }
    if (item.summary && (!opts || opts.summary !== false)) {
      container.appendChild(el("p", "bl-summary", item.summary));
    }
    return hasSteamPrice;
  }

  function getFilteredBacklog() {
    const q = state.search.trim().toLowerCase();
    const cf = state.activeCats;
    return state.data.backlog.filter((b) => {
      if (cf.size && !cf.has(b.category)) return false;
      if (q && !b.title.toLowerCase().includes(q) && !(b.notes || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }

  // Every media-derived field on the backlog form. They're cleared as a set
  // whenever the media link is dropped, so no stale metadata — a release
  // date especially — outlives the sync it came from.
  const MEDIA_FIELD_IDS = [
    "#bCoverUrl", "#bMediaId", "#bMediaSource", "#bSummary", "#bReleaseYear",
    "#bReleaseDate", "#bReleasePrecision", "#bReleaseStatus", "#bNextAt",
    "#bNextLabel", "#bExternalRating", "#bLength", "#bGenres",
  ];
  // Which pin, if any, protects each of those fields from being cleared —
  // unsyncing drops the source, but a value you pinned by hand is yours and
  // outlives the link it originally came from.
  const MEDIA_FIELD_PINS = {
    "#bCoverUrl": "cover", "#bReleaseYear": "release", "#bReleaseDate": "release",
    "#bReleasePrecision": "release", "#bReleaseStatus": "release", "#bNextAt": "release",
    "#bNextLabel": "release", "#bExternalRating": "rating", "#bLength": "length",
  };
  function clearMediaFields() {
    MEDIA_FIELD_IDS.forEach((id) => {
      const pin = MEDIA_FIELD_PINS[id];
      if (pin && isPinned(pin)) return;
      const f = $(id);
      if (f) f.value = "";
    });
  }

  // Writes a merged release object (see media.js's mergeRelease) into the
  // form's hidden fields, blanking whatever it doesn't carry so a re-sync
  // can't leave half of the previous match's dates behind.
  function setReleaseFields(rel) {
    $("#bReleaseDate").value = (rel && rel.releaseDate) || "";
    $("#bReleasePrecision").value = (rel && rel.releasePrecision) || "";
    $("#bReleaseStatus").value = (rel && rel.releaseStatus) || "";
    $("#bNextAt").value = (rel && rel.nextAt) || "";
    $("#bNextLabel").value = (rel && rel.nextLabel) || "";
  }

  // Title last attached to synced media metadata, so a manual edit (vs. a
  // sync pick) is detected and clears the now-stale cover/metadata.
  let lastSyncedBacklogTitle = "";
  // True once the item's media link came from an explicit pick (a Sync-button
  // match, or a backlog/journal suggestion) or was already set on an opened
  // item. While set, renaming the title won't drop the link — only "✕ Unsync"
  // does. Mirrors the entry modal's entrySyncLocked.
  let backlogSyncLocked = false;

  function renderBacklogTitleSuggestions() {
    const query = $("#bTitle").value;
    const isAdding = !$("#backlogId").value;
    // A manually-entered Steam App ID isn't derived from the title, so editing
    // the title shouldn't clear it the way it clears a search-based sync. And
    // only while adding, and only if the link isn't locked by an explicit sync:
    // renaming an already-synced item shouldn't silently drop its media link —
    // that takes an explicit "✕ Unsync" now.
    if (isAdding && !backlogSyncLocked && query !== lastSyncedBacklogTitle && $("#bMediaSource").value !== "steam") {
      clearMediaFields();
      setBacklogCover();
    }

    const list = $("#bTitleSuggest");
    const selfId = $("#backlogId").value || null;
    const backlogMatches = backlogSuggestions(query, selfId);
    const journalMatches = titleSuggestions(query, null);
    list.innerHTML = "";

    backlogMatches.forEach((b) => {
      const item = makeMediaAcItem(
        { title: b.title, coverUrl: b.coverUrl || "", year: null, externalRating: null },
        () => {
          lastSyncedBacklogTitle = b.title;
          backlogSyncLocked = true;
          $("#bTitle").value = b.title;
          if (state.data.categories.some((c) => c.name === b.category)) $("#bCategory").value = b.category;
          $("#bCoverUrl").value = b.coverUrl || "";
          $("#bMediaId").value = b.mediaId || "";
          $("#bMediaSource").value = b.mediaSource || "";
          $("#bGenres").value = (b.genres || []).join("|");
          setBacklogCover();
          updateSyncBtnVisibility("b", $("#bCategory").value);
          list.hidden = true;
          updateBacklogDuplicateBanner();
        }
      );
      const info = item.querySelector(".ac-info");
      const existing = info.querySelector(".ac-meta");
      if (existing) existing.remove();
      info.appendChild(el("span", "ac-meta", `📋 Already in backlog · ${b.category}`));
      list.appendChild(item);
    });

    if (backlogMatches.length && journalMatches.length) list.appendChild(el("div", "ac-divider"));

    journalMatches.forEach((m) => {
      const item = makeMediaAcItem(
        { title: m.title, coverUrl: m.coverUrl, year: null, externalRating: null },
        () => {
          lastSyncedBacklogTitle = m.title;
          backlogSyncLocked = true;
          $("#bTitle").value = m.title;
          if (state.data.categories.some((c) => c.name === m.category)) $("#bCategory").value = m.category;
          $("#bCoverUrl").value = m.coverUrl || "";
          $("#bMediaId").value = m.mediaId || "";
          $("#bMediaSource").value = m.mediaSource || "";
          $("#bGenres").value = (m.genres || []).join("|");
          setBacklogCover();
          updateSyncBtnVisibility("b", $("#bCategory").value);
          list.hidden = true;
          updateBacklogDuplicateBanner();
        }
      );
      const info = item.querySelector(".ac-info");
      const existing = info.querySelector(".ac-meta");
      if (existing) existing.remove();
      info.appendChild(el("span", "ac-meta", `✓ Logged ×${m.count} · last ${MONTHS_SHORT[m.month]} ${m.year}`));
      list.appendChild(item);
    });

    list.hidden = !backlogMatches.length && !journalMatches.length;

    updateBacklogDuplicateBanner();
  }

  // Purely informational: shows whether the typed title already exists in
  // the backlog (excluding the item being edited) and/or is already logged,
  // so duplicates and "you've already done this" can be caught before save.
  function updateBacklogDuplicateBanner() {
    const title = $("#bTitle").value.trim().toLowerCase();
    const selfId = $("#backlogId").value;
    const status = $("#bDuplicateStatus");
    if (!title) { status.hidden = true; return; }
    const inBacklog = state.data.backlog.some((b) => b.id !== selfId && b.title.trim().toLowerCase() === title);
    const inJournal = state.data.entries.some((e) => e.title.trim().toLowerCase() === title);
    if (!inBacklog && !inJournal) { status.hidden = true; return; }
    const parts = [];
    if (inBacklog) parts.push("already in your backlog");
    if (inJournal) parts.push("already logged in your timeline");
    $("#bDuplicateStatusText").textContent = "📋 This title is " + parts.join(" and ") + ".";
    status.hidden = false;
  }

  async function syncBacklogTitle() {
    const title = $("#bTitle").value.trim();
    const category = $("#bCategory").value;
    if (!title) return;
    const list = $("#bTitleSuggest");
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    await renderStreamedSuggestions(list, title, category, async (r) => {
      // Adopt the picked media's title, and lock the link so a later title
      // edit won't drop it (only "✕ Unsync" does).
      $("#bTitle").value = r.title;
      lastSyncedBacklogTitle = r.title;
      backlogSyncLocked = true;
      // Fields pinned in Advanced are skipped here and below: a pick is
      // still a sync, and the whole point of pinning is that no sync
      // overwrites it.
      if (!isPinned("cover")) $("#bCoverUrl").value = r.coverUrl || "";
      // Only real text overwrites a description: several sources (every
      // search endpoint, SteamGridDB entirely) simply have none, and blanking
      // the field for them meant a re-sync silently deleted the blurb — or
      // your own words — that was already there.
      if (r.summary) $("#bSummary").value = r.summary;
      if (!isPinned("release")) $("#bReleaseYear").value = r.year ? String(r.year) : "";
      if (!isPinned("rating")) $("#bExternalRating").value = r.externalRating || "";
      $("#bGenres").value = (r.genres || []).join("|");
      // The per-title second call: TMDB's runtime/season counts plus the
      // show's status and next episode air date — everything the Next
      // Releases list needs — and, for a game, RAWG's description and a
      // re-read of its rating (see fetchDetails in media.js).
      const details = await window.LifeLogMedia.fetchDetails(r.id, r.source, keys);
      if (!isPinned("length")) $("#bLength").value = details.length || r.length || "";
      if (!isPinned("rating") && details.externalRating) $("#bExternalRating").value = details.externalRating;
      const resolved = await resolveMediaIdentity(r, keys);
      // Steam's own blurb wins for a game that turned out to be on Steam: one
      // paragraph written for its store page, against the opening paragraph
      // of RAWG's much longer article.
      const summary = resolved.summary || details.summary;
      if (summary) $("#bSummary").value = summary;
      $("#bMediaSource").value = resolved.mediaSource;
      $("#bMediaId").value = resolved.mediaId;
      // resolved.release goes last: for a game that turned out to be on Steam,
      // Steam's own date beats what the search source guessed (see
      // resolveMediaIdentity). It's null for everything else, and mergeRelease
      // ignores nulls.
      if (!isPinned("release")) setReleaseFields(window.LifeLogMedia.mergeRelease(r, details, resolved.release));
      setBacklogCover();
      updateBacklogDuplicateBanner();
      list.hidden = true;
    }, $("#bSyncBtn"));
  }

  function unsyncBacklogItem() {
    clearMediaFields();
    $("#bSteamAppId").value = "";
    backlogSyncLocked = false;
    setBacklogCover();
    $("#bTitleSuggest").hidden = true;
  }

  // ---------- release dates ----------
  // Items carry as much of a release date as their source actually knew:
  // `releaseDate` plus a `releasePrecision` of day/month/quarter/year/tba,
  // and — where the source said so outright — a `releaseStatus` of
  // "upcoming" or "released" (see media.js for how each source fills these).
  // Items saved before precision existed have none, so it's re-derived from
  // the date's shape; that reproduces the old behavior exactly, which is why
  // nothing needs migrating.
  function precisionOf(b) {
    if (b.releasePrecision) return b.releasePrecision;
    if (b.releaseDate) {
      if (/^\d{4}-\d{2}-\d{2}/.test(b.releaseDate)) return "day";
      if (/^\d{4}-\d{2}$/.test(b.releaseDate)) return "month";
      if (/^\d{4}$/.test(b.releaseDate)) return "year";
    }
    return b.releaseYear ? "year" : "";
  }

  function localDateStr(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }
  function todayStr() { return localDateStr(new Date()); }
  // Day 0 of the *next* month is the last day of this one.
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function isRealDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return false;
    const mo = +m[2];
    return mo >= 1 && mo <= 12 && +m[3] >= 1 && +m[3] <= daysInMonth(+m[1], mo);
  }

  // The span of days the release could fall in, as { start, end } — a single
  // day for exact dates, the whole month/quarter/year otherwise. Everything
  // downstream compares plain YYYY-MM-DD strings rather than Date objects,
  // so no timezone shift can drag a release across midnight. Returns null
  // when there's no usable date at all (TBA, or nothing recorded).
  function releaseWindow(b) {
    const precision = precisionOf(b);
    if (!precision || precision === "tba") return null;
    const raw = b.releaseDate || (b.releaseYear ? String(b.releaseYear) : "");
    const year = parseInt(raw, 10) || +b.releaseYear || 0;
    if (!year) return null;
    if (precision === "day" && isRealDate(raw.slice(0, 10))) {
      const day = raw.slice(0, 10);
      return { start: day, end: day };
    }
    if (precision === "month" || precision === "quarter") {
      const month = parseInt(raw.slice(5, 7), 10);
      if (month >= 1 && month <= 12) {
        // Quarter dates are stored as the quarter's first month, so a
        // quarter simply runs two months longer than a month does.
        const last = Math.min(12, month + (precision === "quarter" ? 2 : 0));
        return {
          start: raw.slice(0, 7) + "-01",
          end: year + "-" + String(last).padStart(2, "0") + "-" + daysInMonth(year, last),
        };
      }
    }
    // Year precision, and the fallback for a date whose month/day turned out
    // not to be a real calendar date — in which case a separately recorded
    // releaseYear is the more trustworthy of the two.
    const y = precision === "year" ? year : (+b.releaseYear || year);
    return { start: y + "-01-01", end: y + "-12-31" };
  }

  // Which block of a category a row sits in, in render order. A star is a
  // deliberate "this one matters", so it outranks the released/unreleased
  // split rather than sorting underneath it: a starred game you're waiting
  // on belongs at the top with the rest of your starred things, not buried
  // in the upcoming block halfway down. Dropped stays last either way —
  // that's an item you've given up on, star or no star.
  const BAND_SEPARATORS = ["", "backlog-priority-sep", "backlog-upcoming-sep", "backlog-dropped-sep"];
  function bandOf(b) {
    if (b.dropped) return 3;
    if (b.priority) return 0;
    return isUnreleased(b) ? 2 : 1;
  }

  // ---------- manual release overrides ----------
  // What the Advanced foldout's date box accepts, turned into the same
  // { releaseDate, releasePrecision } shape every source adapter emits — so
  // a date you typed is indistinguishable downstream from a synced one, and
  // "2027" stays a year rather than becoming the 1st of January. Anything
  // unparseable, blank included, is TBA: that's already how the release
  // views render "no date known".
  function parseReleaseInput(str) {
    const s = (str || "").trim();
    let m;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { releaseDate: s, releasePrecision: "day" };
    if (/^\d{4}-\d{2}$/.test(s)) return { releaseDate: s, releasePrecision: "month" };
    // Quarters are stored as the quarter's first month (see releaseWindow),
    // which is also how Steam's own vague dates arrive.
    if ((m = /^(\d{4})-?[Qq]([1-4])$/.exec(s))) {
      return { releaseDate: m[1] + "-" + String((+m[2] - 1) * 3 + 1).padStart(2, "0"), releasePrecision: "quarter" };
    }
    if (/^\d{4}$/.test(s)) return { releaseDate: s, releasePrecision: "year" };
    return { releaseDate: "", releasePrecision: "tba" };
  }

  // The inverse, for showing what's currently stored in that same box.
  function formatReleaseInput(b) {
    const precision = precisionOf(b);
    const raw = b.releaseDate || (b.releaseYear ? String(b.releaseYear) : "");
    if (precision === "tba") return "";
    if (precision === "quarter" && /^\d{4}-\d{2}/.test(raw)) {
      return raw.slice(0, 4) + "-Q" + (Math.floor((parseInt(raw.slice(5, 7), 10) - 1) / 3) + 1);
    }
    return raw;
  }

  // The backlog item fields you can pin against sync, and how each moves
  // between the foldout and the form's hidden fields. `release` covers the
  // whole set of dates behind one tick — date, precision, status, the year
  // shown in the metadata line, and the next-episode fields — because they
  // are only ever meaningful together.
  const OVERRIDE_KEYS = ["release", "cover", "rating", "length"];
  const OVERRIDE_FIELDS = [
    {
      key: "release", check: "#bOvrRelease", inputs: ["#bOvrReleaseDate", "#bOvrReleaseStatus"],
      pull() {
        $("#bOvrReleaseDate").value = formatReleaseInput({
          releaseDate: $("#bReleaseDate").value,
          releasePrecision: $("#bReleasePrecision").value,
          releaseYear: $("#bReleaseYear").value,
        });
        $("#bOvrReleaseStatus").value = $("#bReleaseStatus").value;
      },
      push() {
        const parsed = parseReleaseInput($("#bOvrReleaseDate").value);
        $("#bReleaseDate").value = parsed.releaseDate;
        $("#bReleasePrecision").value = parsed.releasePrecision;
        $("#bReleaseStatus").value = $("#bOvrReleaseStatus").value;
        // releaseYear is what the metadata line shows and what releaseWindow
        // falls back on, so it has to move with the date rather than keep
        // pointing at whatever the source last said.
        $("#bReleaseYear").value = parsed.releaseDate ? parsed.releaseDate.slice(0, 4) : "";
      },
    },
    {
      key: "cover", check: "#bOvrCover", inputs: ["#bOvrCoverUrl"],
      pull() { $("#bOvrCoverUrl").value = $("#bCoverUrl").value; },
      push() { $("#bCoverUrl").value = $("#bOvrCoverUrl").value.trim(); },
    },
    {
      key: "rating", check: "#bOvrRating", inputs: ["#bOvrRatingValue"],
      pull() { $("#bOvrRatingValue").value = $("#bExternalRating").value; },
      push() { $("#bExternalRating").value = $("#bOvrRatingValue").value.trim(); },
    },
    {
      key: "length", check: "#bOvrLength", inputs: ["#bOvrLengthValue"],
      pull() { $("#bOvrLengthValue").value = $("#bLength").value; },
      push() { $("#bLength").value = $("#bOvrLengthValue").value.trim(); },
    },
  ];

  // Whether a field is pinned right now in the open modal, as opposed to on
  // a stored item (isOverridden) — the two sync paths that run against the
  // form rather than against saved items need this one.
  function isPinned(key) {
    const box = $("#bOvr" + key.charAt(0).toUpperCase() + key.slice(1));
    return !!(box && box.checked);
  }

  // The stored counterpart to setReleaseFields: copies the release fields
  // onto an item, deleting rather than blanking the empty ones so items stay
  // free of "" keys (matching how every other optional field is stored).
  const RELEASE_FIELDS = ["releaseDate", "releasePrecision", "releaseStatus", "nextAt", "nextLabel"];
  function applyRelease(item, rel) {
    for (const key of RELEASE_FIELDS) {
      if (rel && rel[key]) item[key] = rel[key]; else delete item[key];
    }
  }

  // Unreleased = the last day it could still be coming hasn't passed yet.
  // A source that stated its status outright overrules the date entirely —
  // that's the only way to know a bare "2026" has already happened, and it's
  // what stops a January release from reading as upcoming until December.
  function isUnreleased(b) {
    if (b.releaseStatus === "released") return false;
    if (b.releaseStatus === "upcoming") return true;
    const window = releaseWindow(b);
    if (!window) return precisionOf(b) === "tba";
    return window.end >= todayStr();
  }

  // The day this item is actually waiting on, for sorting and grouping the
  // Next Releases list: the next episode where one is scheduled (for
  // something already airing, that's the only date that means anything),
  // otherwise the start of its release window — clamped to today, so an item
  // partway through its month/quarter sorts as imminent rather than overdue.
  // "" for anything with no day-level footing (year-only, TBA).
  function upcomingAt(b) {
    const today = todayStr();
    if (b.nextAt && isRealDate(b.nextAt) && b.nextAt >= today) return b.nextAt;
    const precision = precisionOf(b);
    if (precision !== "day" && precision !== "month" && precision !== "quarter") return "";
    const window = releaseWindow(b);
    if (!window || window.end < today) return "";
    return window.start > today ? window.start : today;
  }

  // ---------- backlog view ----------
  // ---------- "pick something for me" ----------
  // Pool the modal's reroll draws from — set once when opened, from
  // whatever's currently eligible (scoped to the active category/search
  // filters, same as the view itself).
  let pickPool = [];

  function eligibleForPick(items) {
    return items.filter((b) => !b.dropped && !isUnreleased(b));
  }

  // Lives in the mode bar's right-hand slot rather than a row of its own —
  // one strip above the list instead of two, which matters most on a phone.
  function makePickButton(items) {
    const eligible = eligibleForPick(items);
    if (!eligible.length) return null;
    const btn = el("button", "btn btn-sm", "🎲 Pick something for me");
    btn.type = "button";
    btn.onclick = () => openPickModal(eligible);
    return btn;
  }

  function openPickModal(pool) {
    pickPool = pool;
    rerollPick();
    $("#pickModal").hidden = false;
  }
  function closePickModal() { $("#pickModal").hidden = true; }

  function rerollPick() {
    if (!pickPool.length) return;
    const b = pickPool[Math.floor(Math.random() * pickPool.length)];

    // Title, with a ★ favorite marker when the item is prioritized.
    const titleEl = $("#pickModalTitle");
    titleEl.textContent = b.title;
    if (b.priority) {
      titleEl.appendChild(document.createTextNode(" "));
      const fav = priorityBadge();
      fav.title = "Favorite (prioritized)";
      titleEl.appendChild(fav);
    }
    $("#pickModalCategory").textContent = b.category;

    const cover = $("#pickCover");
    if (b.coverUrl) { $("#pickCoverImg").src = b.coverUrl; cover.hidden = false; }
    else cover.hidden = true;

    // The full pulled metadata — rating/year/length/price + summary (shared
    // with the list row and edit modal), plus genres and your own note,
    // so a pick shows everything we know about it, not just the title.
    const meta = $("#pickMeta");
    meta.textContent = "";
    const hasSteamPrice = appendBacklogMeta(meta, b);
    if (b.genres && b.genres.length) {
      const genres = el("div", "pick-genres");
      b.genres.forEach((g) => genres.appendChild(el("span", "pick-genre", g)));
      meta.appendChild(genres);
    }
    if (b.notes) meta.appendChild(el("p", "pick-note", b.notes));
    if (hasSteamPrice) loadBacklogPrices([{ mediaSource: b.mediaSource, mediaId: b.mediaId }]);

    // Source/store links (Steam · RAWG · TMDB · AniList · …, plus GG.deals
    // for Steam games) — the same buttons the edit modal overlays on the
    // cover, but as a standalone row here so they show even without a cover.
    renderCoverLinkButtons($("#pickLinks"), b.mediaSource, b.mediaId);

    $("#pickOpenBtn").onclick = () => { closePickModal(); openBacklogModal(b); };
  }

  // ---------- Next Releases ----------
  // Precision ordering for the tie-break below: on the same day, an exact
  // date should sit above something merely narrowed to that month.
  const PRECISION_ORDER = { day: 0, month: 1, quarter: 2, year: 3, tba: 4 };

  // A show that started airing years ago is "released", but its next episode
  // is still ahead — and that's exactly what a "what's next" list is for. So
  // waiting-on-something is broader than unreleased.
  function hasUpcomingEpisode(b) {
    return !!b.nextAt && isRealDate(b.nextAt) && b.nextAt >= todayStr();
  }
  function isAwaitingRelease(b) {
    return !b.dropped && (isUnreleased(b) || hasUpcomingEpisode(b));
  }

  function upcomingItems() {
    return getFilteredBacklog().filter(isAwaitingRelease);
  }

  // "Fri 12 Sep" — the year is deliberately left off, since every row sits
  // under a month heading that already carries it.
  function formatDay(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  // Whole days from today, on the calendar rather than the clock — both ends
  // are read at local midday, so a DST shift in between can't round the gap
  // to the wrong day.
  function daysUntil(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const then = new Date(y, m - 1, d, 12);
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    return Math.round((then - now) / 86400000);
  }

  function countdownText(dateStr) {
    const days = daysUntil(dateStr);
    if (days <= 0) return "today";
    if (days === 1) return "tomorrow";
    if (days < 21) return "in " + days + " days";
    if (days < 60) return "in " + Math.round(days / 7) + " weeks";
    return "";
  }

  // What a row says about its date, phrased to match how much is actually
  // known — never a specific day for something only pinned to a quarter.
  function releaseLabel(b) {
    const today = todayStr();
    if (b.nextAt && isRealDate(b.nextAt) && b.nextAt >= today) {
      return (b.nextLabel ? b.nextLabel + " · " : "") + formatDay(b.nextAt);
    }
    const precision = precisionOf(b);
    const raw = b.releaseDate || "";
    if (precision === "day" && isRealDate(raw.slice(0, 10))) return formatDay(raw.slice(0, 10));
    const month = parseInt(raw.slice(5, 7), 10);
    if (precision === "quarter" && month >= 1 && month <= 12) {
      return "Q" + (Math.floor((month - 1) / 3) + 1) + " " + raw.slice(0, 4);
    }
    if (precision === "month" && month >= 1 && month <= 12) {
      return "Sometime in " + MONTHS_SHORT[month] + " " + raw.slice(0, 4);
    }
    const year = parseInt(raw, 10) || b.releaseYear;
    return year ? "Sometime in " + year : "No date announced";
  }

  function upcomingRow(b) {
    const rich = state.visual.backlogCoverSize !== "none";
    const row = el("div", rich ? "backlog-item-rich up-row" : "entry up-row");
    if (rich && b.coverUrl) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = b.coverUrl; img.alt = b.title;
      img.className = "bl-cover cover-sm";
      img.onerror = () => { img.replaceWith(emptyCoverEl("bl-cover cover-empty cover-sm", b.category)); };
      row.appendChild(img);
    } else if (rich) {
      row.appendChild(emptyCoverEl("bl-cover cover-empty cover-sm", b.category));
    }
    const body = el("div", "bl-body");
    const titleRow = el("div", "bl-title-row");
    const dot = el("span", "up-cat-dot"); dot.style.background = colorOf(b.category);
    dot.title = b.category;
    titleRow.appendChild(dot);
    const title = el("span", "bl-title", b.title); title.title = b.title;
    titleRow.appendChild(title);
    if (b.priority) titleRow.appendChild(priorityBadge());
    body.appendChild(titleRow);
    const meta = el("div", "up-when");
    meta.appendChild(el("span", "up-date", releaseLabel(b)));
    // Only ever counts down to a real day — "in 2 days" against a date known
    // no better than its month would be inventing precision.
    const at = upcomingAt(b);
    const countdown = at && (hasUpcomingEpisode(b) || precisionOf(b) === "day") ? countdownText(at) : "";
    if (countdown) meta.appendChild(el("span", "up-countdown", countdown));
    body.appendChild(meta);
    row.appendChild(body);
    // No bulk selection here, unlike the category list: this is a read-only
    // "what's coming" view, and moving/deleting by category is what the other
    // layout is for. Switching modes clears any selection in progress.
    row.onclick = () => openBacklogModal(b);
    return row;
  }

  // One card per month, in date order, then a single trailing card for
  // everything with no month to put it in. Items are grouped by the day
  // they're actually waiting on (see upcomingAt), so a show mid-season lands
  // on its next episode rather than the month it premiered years ago.
  function renderUpcoming(root) {
    const items = upcomingItems();
    if (!items.length) {
      // Distinguish "nothing is coming" from "your filters hid it" — the
      // advice below only makes sense for the former.
      if (state.data.backlog.some(isAwaitingRelease)) {
        root.appendChild(emptyState("Nothing upcoming matches your filters."));
        return;
      }
      root.appendChild(emptyState({
        glyph: "🔭",
        title: "Nothing on the horizon",
        body: "Backlog items that haven't come out yet show up here in date order — the next episode of something airing, a game with a release date, a film still months away.",
        hint: "Release dates arrive with the cover art when you sync an item to a media source. Settings → Media → Upcoming releases keeps them current.",
      }));
      return;
    }
    const dated = [], undated = [];
    for (const b of items) (upcomingAt(b) ? dated : undated).push(b);
    // Month first, then exactness: within a month card, the days you can
    // circle on a calendar come first in date order, and the "sometime in
    // August" ones settle underneath rather than interleaving on the
    // arbitrary day their window happens to open.
    dated.sort((a, b) => {
      const at = upcomingAt(a), bt = upcomingAt(b);
      const am = at.slice(0, 7), bm = bt.slice(0, 7);
      if (am !== bm) return am < bm ? -1 : 1;
      const ap = hasUpcomingEpisode(a) ? 0 : (PRECISION_ORDER[precisionOf(a)] ?? 9);
      const bp = hasUpcomingEpisode(b) ? 0 : (PRECISION_ORDER[precisionOf(b)] ?? 9);
      if (ap !== bp) return ap - bp;
      if (at !== bt) return at < bt ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
    undated.sort((a, b) =>
      ((parseInt(a.releaseDate, 10) || a.releaseYear || 9999) - (parseInt(b.releaseDate, 10) || b.releaseYear || 9999))
      || a.title.localeCompare(b.title));

    const byMonth = groupBy(dated, (b) => upcomingAt(b).slice(0, 7));
    const grid = el("div", "backlog-grid");
    const sections = [];
    const thisMonth = todayStr().slice(0, 7);
    for (const key of Object.keys(byMonth)) {
      const monthItems = byMonth[key];
      const [year, month] = key.split("-");
      sections.push(makeUpcomingSection(
        key,
        key === thisMonth ? "This month" : MONTHS_SHORT[+month] + " " + year,
        key === thisMonth ? MONTHS_SHORT[+month] + " " + year : "",
        monthItems
      ));
    }
    if (undated.length) {
      sections.push(makeUpcomingSection("undated", "No date yet",
        "Announced, but nothing firmer than a year", undated));
    }
    root.appendChild(grid);
    renderLazySections(grid, sections);
  }

  function makeUpcomingSection(key, title, subtitle, items) {
    const section = el("div", "backlog-section");
    const head = el("div", "backlog-section-head");
    head.appendChild(el("span", "backlog-section-name", title));
    if (subtitle) head.appendChild(el("span", "up-section-sub", subtitle));
    head.appendChild(el("span", "backlog-section-count", String(items.length)));
    section.appendChild(head);
    const list = el("div", "backlog-list");
    section.appendChild(list);
    return {
      key, header: head, node: section, bodyEl: list,
      build: () => { items.forEach((b) => list.appendChild(upcomingRow(b))); },
    };
  }

  // The Backlog view's two layouts. Kept as a mode switch rather than a sixth
  // tab: it's the same items either way, and the bottom nav on a phone has no
  // room to spare.
  function renderBacklogModeBar(root, items) {
    const bar = el("div", "backlog-mode-bar");
    const group = el("div", "seg");
    const modes = [["category", "By category"], ["upcoming", "Next releases"]];
    for (const [mode, label] of modes) {
      const btn = el("button", "seg-btn", label);
      btn.type = "button";
      const active = state.backlogMode === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
      btn.onclick = () => {
        if (state.backlogMode === mode) return;
        state.backlogMode = mode;
        state.bulk.active = false;
        state.bulk.selected.clear();
        render();
        saveUiState();
      };
      group.appendChild(btn);
    }
    bar.appendChild(group);
    if (state.backlogMode === "upcoming") {
      const n = upcomingItems().length;
      if (n) bar.appendChild(el("span", "backlog-mode-count", n + (n === 1 ? " title" : " titles") + " waiting"));
    } else {
      const pick = makePickButton(items);
      if (pick) bar.appendChild(pick);
    }
    root.appendChild(bar);
  }

  function renderBacklog(root) {
    if (!state.data.backlog.length) {
      root.appendChild(emptyState({
        glyph: "★",
        title: "Your backlog is empty",
        body: "Add things you want to get to. They sit here grouped by category and sorted by priority, until the day you log them.",
        action: "Add to backlog",
        onAction: () => openBacklogModal(null),
        hint: "Higher-priority items rise to the top of their category.",
      }));
      return;
    }
    const items = getFilteredBacklog()
      .slice().sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    renderBacklogModeBar(root, items);
    if (state.backlogMode === "upcoming") { renderUpcoming(root); return; }
    if (!items.length) {
      root.appendChild(emptyState("No backlog items match your filters."));
      return;
    }
    const byCat = groupBy(items, (b) => b.category);
    const order = state.data.categories.map((c) => c.name).filter((n) => byCat[n]);
    for (const n of Object.keys(byCat)) if (!order.includes(n)) order.push(n);
    const grid = el("div", "backlog-grid");
    const sections = [];
    for (const catName of order) {
      const catItems = byCat[catName];
      const section = el("div", "backlog-section");
      const head = el("div", "backlog-section-head");
      if (state.bulk.active) {
        const allSelected = catItems.every((b) => state.bulk.selected.has(b.id));
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "bulk-check"; cb.checked = allSelected;
        cb.title = "Select all in " + catName;
        cb.onclick = (ev) => { ev.stopPropagation(); toggleBulkCategoryAll(catItems); };
        head.appendChild(cb);
      }
      const dot = el("span", "dot"); dot.style.background = colorOf(catName);
      head.appendChild(dot);
      head.appendChild(el("span", "backlog-section-name", catName));
      head.appendChild(el("span", "backlog-section-count", String(catItems.length)));
      if (!state.bulk.active) {
        const addBtn = el("button", "month-add-btn", "+");
        addBtn.type = "button";
        addBtn.title = "Add to " + catName;
        addBtn.setAttribute("aria-label", addBtn.title);
        addBtn.onclick = (ev) => { ev.stopPropagation(); openBacklogModal(null, catName); };
        head.appendChild(addBtn);
      }
      section.appendChild(head);
      const list = el("div", "backlog-list");
      section.appendChild(list);

      sections.push({
        key: catName, header: head, node: section, bodyEl: list,
        build: () => {
          const sorted = catItems.slice().sort((a, b) => {
            const bandDiff = bandOf(a) - bandOf(b);
            if (bandDiff) return bandDiff;
            return (b.priority || 0) - (a.priority || 0) || a.title.localeCompare(b.title);
          });
          // One dashed separator per boundary the category actually has —
          // named for the band being entered, so a list missing a band in
          // the middle still reads correctly.
          let lastBand = -1;
          sorted.forEach((b) => {
            const band = bandOf(b);
            if (lastBand !== -1 && band !== lastBand) list.appendChild(el("div", BAND_SEPARATORS[band]));
            lastBand = band;
            list.appendChild(backlogRow(b));
          });
          // Scoped to just this category's items — the old single call over
          // everything patched .bl-price spans that, under lazy sections,
          // mostly don't exist in the DOM yet. priceCache is shared/keyed by
          // mediaId, so sections that build later resolve through its cached
          // fast path instead of re-fetching.
          loadBacklogPrices(catItems);
        },
      });
    }
    root.appendChild(grid);
    renderLazySections(grid, sections);
    if (state.bulk.active) {
      root.appendChild(bulkActionBar({
        categories: state.data.categories,
        onMove: bulkMoveSelected,
        onDelete: bulkDeleteSelected,
        onSync: bulkSyncSelected,
      }));
    }
  }

  function backlogRow(b) {
    if (state.visual.backlogCoverSize !== "none") return backlogRowRich(b);
    const row = el("div", "entry");
    if (b.dropped) row.classList.add("is-dropped");
    if (state.bulk.active) row.appendChild(bulkCheckbox(b));
    const t = el("span", "etitle", b.title); t.title = b.title;
    row.appendChild(t);
    if (b.priority) row.appendChild(priorityBadge());
    if (!state.bulk.active) {
      const doneBtn = el("button", "btn btn-sm", "✓ Done");
      doneBtn.type = "button";
      doneBtn.title = "Move to your log";
      doneBtn.onclick = (ev) => { ev.stopPropagation(); openEntryModal(null, b); };
      row.appendChild(doneBtn);
    }
    row.onclick = () => state.bulk.active ? toggleBulkItem(b.id) : openBacklogModal(b);
    attachLongPressSelect(row, b);
    return row;
  }

  function backlogRowRich(b) {
    const row = el("div", "backlog-item-rich");
    if (b.dropped) row.classList.add("is-dropped");
    if (state.bulk.active) row.appendChild(bulkCheckbox(b));
    const sizeClass = state.visual.backlogCoverSize === "small" ? "cover-sm" : "cover-lg";
    if (b.coverUrl) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = b.coverUrl; img.alt = b.title;
      img.className = "bl-cover " + sizeClass;
      // On a broken URL, swap in the same empty placeholder used for items
      // with no cover at all, instead of collapsing the space it held.
      img.onerror = () => { img.replaceWith(emptyCoverEl("bl-cover cover-empty " + sizeClass, b.category)); };
      row.appendChild(img);
    } else {
      row.appendChild(emptyCoverEl("bl-cover cover-empty " + sizeClass, b.category));
    }
    const body = el("div", "bl-body");
    const titleRow = el("div", "bl-title-row");
    titleRow.appendChild(el("span", "bl-title", b.title));
    if (b.priority) titleRow.appendChild(priorityBadge());
    body.appendChild(titleRow);
    // Price (if any) arrives later via the batched loadBacklogPrices() in
    // renderBacklog and gets patched into the .bl-price span this builds.
    appendBacklogMeta(body, b, { summary: state.visual.backlogSummaries !== "hide" });
    row.appendChild(body);
    // Done button at the right — same position as plain backlog rows
    if (!state.bulk.active) {
      const doneBtn = el("button", "btn btn-sm", "✓ Done");
      doneBtn.type = "button"; doneBtn.title = "Move to your log";
      doneBtn.onclick = (ev) => { ev.stopPropagation(); openEntryModal(null, b); };
      row.appendChild(doneBtn);
    }
    row.onclick = () => state.bulk.active ? toggleBulkItem(b.id) : openBacklogModal(b);
    attachLongPressSelect(row, b);
    return row;
  }

  // ---------- bulk actions ----------
  // Syncs each selected backlog item to media metadata, auto-picking the top
  // search result (no per-item review, since reviewing N items individually
  // would defeat the point of a bulk action).
  async function bulkSyncSelected(btn) {
    const ids = [...state.bulk.selected];
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    const progress = $(".bulk-progress");
    btn.disabled = true;
    let synced = 0, skipped = 0, lastErr = "";
    try {
      for (const id of ids) {
        const item = state.data.backlog.find((b) => b.id === id);
        // Steam has no search (CORS-blocked) — its App ID can only be entered
        // manually per item, so it's skipped here rather than attempted.
        const source = item && (state.data.settings.mediaCategorySources || {})[item.category];
        if (!item || !source || source === "steam") {
          skipped++;
        } else {
          const results = await fetchMediaSuggestions(item.title, item.category);
          if (!results.length) {
            skipped++;
            lastErr = (window.LifeLogMedia && window.LifeLogMedia.getLastError()) || lastErr;
          } else {
            const r = results[0];
            // Same rule as the single-item sync: a field pinned in the item's
            // Advanced foldout is left exactly as it is.
            if (!isOverridden(item, "cover")) item.coverUrl = r.coverUrl || "";
            if (!isOverridden(item, "release")) {
              if (r.year) item.releaseYear = r.year; else delete item.releaseYear;
            }
            if (!isOverridden(item, "rating")) item.externalRating = r.externalRating || "";
            // TMDB needs a second per-title call for runtime/season data — the
            // search endpoint doesn't include it (see fetchDetails in media.js),
            // and the same response carries the status/next-episode dates. For
            // a game it's where the description comes from.
            const details = await window.LifeLogMedia.fetchDetails(r.id, r.source, keys);
            if (!isOverridden(item, "length")) item.length = details.length || r.length || "";
            if (!isOverridden(item, "rating") && details.externalRating) item.externalRating = details.externalRating;
            if (r.genres && r.genres.length) item.genres = r.genres.slice(); else delete item.genres;
            const resolved = await resolveMediaIdentity(r, keys);
            // Same rule as the single-item pick: a source with no description
            // of its own leaves the existing one alone instead of wiping it.
            const summary = resolved.summary || details.summary || r.summary;
            if (summary) item.summary = summary;
            item.mediaSource = resolved.mediaSource;
            item.mediaId = resolved.mediaId;
            // Steam's own date last, where the game turned out to be on Steam
            // — same ordering as the single-item pick above.
            if (!isOverridden(item, "release")) {
              applyRelease(item, window.LifeLogMedia.mergeRelease(r, details, resolved.release));
            }
            synced++;
          }
        }
        if (progress) progress.textContent = `${synced + skipped}/${ids.length} synced`;
      }
    } catch (e) {
      // Anything thrown in here used to leave the button disabled and the bar
      // sitting there unchanged — from the outside, indistinguishable from the
      // button doing nothing at all. Whatever it was, say so and hand the
      // button back; items already synced above keep their metadata.
      btn.disabled = false;
      if (progress) progress.textContent = "";
      toast("Bulk sync failed" + ((e && e.message) ? " — " + e.message : ""), true);
      await persist();
      return;
    }
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    const base = skipped ? `Synced ${synced} item${synced === 1 ? "" : "s"}, skipped ${skipped}` : `Synced ${synced} item${synced === 1 ? "" : "s"}`;
    toast(lastErr ? base + " — " + lastErr : base, !!(skipped && lastErr));
  }

  async function bulkMoveSelected(categoryName) {
    const ids = state.bulk.selected;
    state.data.backlog.forEach((b) => { if (ids.has(b.id)) b.category = categoryName; });
    const n = ids.size;
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Moved ${n} item${n === 1 ? "" : "s"} to “${categoryName}”`);
  }

  async function bulkDeleteSelected() {
    const ids = state.bulk.selected;
    const n = ids.size;
    if (!confirm(`Remove ${n} item${n === 1 ? "" : "s"} from your backlog?`)) return;
    state.data.backlog = state.data.backlog.filter((b) => !ids.has(b.id));
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Removed ${n} item${n === 1 ? "" : "s"} from backlog`);
  }

  // ---------- backlog modal ----------
  function setBacklogCover() {
    const coverUrl = $("#bCoverUrl").value;
    const coverDiv = $("#backlogCover");
    const coverImg = $("#backlogCoverImg");
    const mediaSource = $("#bMediaSource").value;
    const mediaId = $("#bMediaId").value;
    showSyncStatus("b", mediaSource);
    refreshOverrideFields(OVERRIDE_FIELDS);
    // The rating/year/length/price line, the summary and the store links all
    // describe the item rather than its artwork, so they render either way:
    // under the cover when there is one, in a plain row under the title when
    // there isn't — which includes a cover URL that turns out to be a dead
    // image, since that hides the whole block from under them.
    const paint = (hasCover) => {
      const coverMeta = $("#backlogCoverMeta"), rowMeta = $("#backlogMetaRow");
      coverMeta.innerHTML = ""; rowMeta.innerHTML = "";
      const hasSteamPrice = appendBacklogMeta(hasCover ? coverMeta : rowMeta, {
        externalRating: $("#bExternalRating").value,
        releaseYear: $("#bReleaseYear").value,
        length: $("#bLength").value,
        mediaSource, mediaId,
        summary: $("#bSummary").value,
      });
      if (hasSteamPrice) {
        // Same lookup the backlog list uses — reuses its cache (instant if
        // this item's price was already fetched there) and patches the
        // price span above via the shared .bl-price[data-appid] selector.
        loadBacklogPrices([{ mediaSource, mediaId }]);
      }
      renderMediaLinks($("#backlogCoverLinks"), $("#backlogLinks"), hasCover, mediaSource, mediaId);
    };
    coverImg.onerror = () => { coverDiv.hidden = true; paint(false); };
    if (coverUrl) { coverImg.src = coverUrl; coverDiv.hidden = false; paint(true); }
    else { coverDiv.hidden = true; coverImg.src = ""; paint(false); }
  }

  function openBacklogModal(item, presetCategory) {
    const editing = !!item;
    $("#backlogModalTitle").textContent = editing ? "Edit backlog item" : "Add to backlog";
    $("#backlogId").value = editing ? item.id : "";
    $("#bTitle").value = editing ? item.title : "";
    fillCategorySelect($("#bCategory"), state.data.categories,
      editing ? item.category : (presetCategory || (state.data.categories[0] && state.data.categories[0].name)));
    $("#bNotes").value = editing ? (item.notes || "") : "";
    $("#bCoverUrl").value = editing ? (item.coverUrl || "") : "";
    $("#bMediaId").value = editing ? (item.mediaId || "") : "";
    $("#bMediaSource").value = editing ? (item.mediaSource || "") : "";
    $("#bSummary").value = editing ? (item.summary || "") : "";
    $("#bReleaseYear").value = editing && item.releaseYear ? String(item.releaseYear) : "";
    setReleaseFields(editing ? item : null);
    $("#bExternalRating").value = editing ? (item.externalRating || "") : "";
    $("#bLength").value = editing ? (item.length || "") : "";
    $("#bGenres").value = editing ? (item.genres || []).join("|") : "";
    $("#bPriority").checked = editing ? !!item.priority : false;
    updatePriorityBtn();
    $("#bDropped").checked = editing ? !!item.dropped : false;
    updateDroppedBtnLabel();
    const aging = $("#backlogAgingLine");
    if (editing && item.createdAt) {
      aging.textContent = "Added " + new Date(item.createdAt).toLocaleDateString(undefined,
        { year: "numeric", month: "short", day: "numeric" }) + " — " + agingText(item.createdAt);
      aging.hidden = false;
    } else aging.hidden = true;
    lastSyncedBacklogTitle = editing ? item.title : "";
    backlogSyncLocked = editing ? !!item.mediaSource : false;
    $("#bSteamAppId").value = editing && item.mediaSource === "steam" ? (item.mediaId || "") : "";
    $("#bTitleSuggest").innerHTML = "";
    $("#bTitleSuggest").hidden = true;
    $("#deleteBacklogBtn").hidden = !editing;
    // After every hidden field above is populated — the foldout shows what
    // they currently hold, so ticking a box pins the value you can see.
    initOverrideFields(OVERRIDE_FIELDS, editing ? item : null);
    // Opened only for an item that has something pinned — otherwise a pin is
    // invisible until you go looking for it, which is a poor way to find out
    // why a sync isn't updating a field.
    $("#bAdvanced").open = !!(editing && item.overrides);
    setBacklogCover();
    updateSyncBtnVisibility("b", $("#bCategory").value);
    updateBacklogDuplicateBanner();
    $("#backlogModal").hidden = false;
  }
  function closeBacklogModal() { $("#backlogModal").hidden = true; }

  function updateDroppedBtnLabel() {
    $("#toggleDroppedBtn").textContent = $("#bDropped").checked ? "Restore" : "Mark as dropped";
  }
  function toggleDropped() {
    $("#bDropped").checked = !$("#bDropped").checked;
    updateDroppedBtnLabel();
  }

  function updatePriorityBtn() {
    const on = $("#bPriority").checked;
    const btn = $("#bPriorityBtn");
    btn.textContent = on ? "★" : "☆";
    btn.classList.toggle("active", on);
    btn.title = on ? "Prioritized — click to remove" : "Prioritize";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-pressed", String(on));
  }
  function togglePriority() {
    $("#bPriority").checked = !$("#bPriority").checked;
    updatePriorityBtn();
  }

  async function saveBacklogFromForm(ev) {
    ev.preventDefault();
    // Ticked overrides are written into the hidden fields first, so
    // everything below reads one set of values and neither knows nor cares
    // which of them came from a sync and which you typed.
    pushOverrideValues(OVERRIDE_FIELDS);
    const overrides = readOverrideChecks(OVERRIDE_FIELDS);
    const id = $("#backlogId").value;
    const title = $("#bTitle").value.trim();
    const category = $("#bCategory").value;
    const notes = $("#bNotes").value.trim();
    const coverUrl = $("#bCoverUrl").value;
    const mediaId = $("#bMediaId").value;
    const mediaSource = $("#bMediaSource").value;
    const summary = $("#bSummary").value;
    const releaseYear = $("#bReleaseYear").value;
    const release = {
      releaseDate: $("#bReleaseDate").value,
      releasePrecision: $("#bReleasePrecision").value,
      releaseStatus: $("#bReleaseStatus").value,
      nextAt: $("#bNextAt").value,
      nextLabel: $("#bNextLabel").value,
    };
    const externalRating = $("#bExternalRating").value;
    const length = $("#bLength").value;
    const genresStr = $("#bGenres").value;
    const genres = genresStr ? genresStr.split("|") : [];
    const priority = $("#bPriority").checked ? 1 : 0;
    const dropped = $("#bDropped").checked;
    if (!title) return;
    if (id) {
      const b = state.data.backlog.find((x) => x.id === id);
      Object.assign(b, { title, category });
      if (notes) b.notes = notes; else delete b.notes;
      if (coverUrl) b.coverUrl = coverUrl; else delete b.coverUrl;
      if (mediaId) b.mediaId = mediaId; else delete b.mediaId;
      if (mediaSource) b.mediaSource = mediaSource; else delete b.mediaSource;
      if (summary) b.summary = summary; else delete b.summary;
      if (releaseYear) b.releaseYear = parseInt(releaseYear, 10); else delete b.releaseYear;
      applyRelease(b, release);
      if (externalRating) b.externalRating = externalRating; else delete b.externalRating;
      if (length) b.length = length; else delete b.length;
      if (genres.length) b.genres = genres; else delete b.genres;
      if (priority) b.priority = priority; else delete b.priority;
      if (dropped) b.dropped = true; else delete b.dropped;
      if (overrides) b.overrides = overrides; else delete b.overrides;
    } else {
      const item = { id: uid(), title, category, createdAt: new Date().toISOString() };
      if (notes) item.notes = notes;
      if (coverUrl) item.coverUrl = coverUrl;
      if (mediaId) item.mediaId = mediaId;
      if (mediaSource) item.mediaSource = mediaSource;
      if (summary) item.summary = summary;
      if (releaseYear) item.releaseYear = parseInt(releaseYear, 10);
      applyRelease(item, release);
      if (externalRating) item.externalRating = externalRating;
      if (length) item.length = length;
      if (genres.length) item.genres = genres;
      if (priority) item.priority = priority;
      if (dropped) item.dropped = true;
      if (overrides) item.overrides = overrides;
      state.data.backlog.push(item);
    }
    closeBacklogModal();
    render();
    await persist();
    toast(id ? "Backlog item updated" : "Added to backlog");
  }

  async function deleteCurrentBacklogItem() {
    const id = $("#backlogId").value;
    if (!id) return;
    if (!confirm("Remove this from your backlog?")) return;
    state.data.backlog = state.data.backlog.filter((x) => x.id !== id);
    closeBacklogModal();
    render();
    await persist();
    toast("Removed from backlog");
  }

  // ---------- data lifecycle ----------
  function sanitizeBacklog(b) {
    const out = {
      id: b.id || uid(),
      title: b.title || "",
      category: b.category || "Other",
      createdAt: b.createdAt || null,
      updatedAt: backfillUpdatedAt(b),
    };
    if (b.notes) out.notes = b.notes;
    if (b.coverUrl) out.coverUrl = b.coverUrl;
    if (b.mediaId) out.mediaId = b.mediaId;
    if (b.mediaSource) out.mediaSource = b.mediaSource;
    if (b.summary) out.summary = b.summary;
    if (b.releaseYear) out.releaseYear = b.releaseYear;
    for (const key of RELEASE_FIELDS) if (b[key]) out[key] = String(b[key]);
    if (b.externalRating) out.externalRating = b.externalRating;
    if (b.length) out.length = b.length;
    if (Array.isArray(b.genres) && b.genres.length) out.genres = b.genres.map((g) => String(g)).slice(0, 4);
    if (b.priority) out.priority = +b.priority;
    if (b.dropped) out.dropped = true;
    const overrides = sanitizeOverrides(b.overrides, OVERRIDE_KEYS);
    if (overrides) out.overrides = overrides;
    return out;
  }

  // ---------- events ----------
  // Backlog-modal DOM wiring; called from app.js's wire().
  function wire() {
    wireCategorySelect("#bCategory", "#backlogModal", false);

    $("#cancelBacklogBtn").onclick = closeBacklogModal;
    $("#backlogForm").onsubmit = saveBacklogFromForm;
    $("#deleteBacklogBtn").onclick = deleteCurrentBacklogItem;
    $("#toggleDroppedBtn").onclick = toggleDropped;
    $("#bPriorityBtn").onclick = togglePriority;
    $("#bTitle").oninput = renderBacklogTitleSuggestions;
    $("#bCategory").onchange = () => updateSyncBtnVisibility("b", $("#bCategory").value);
    $("#bSyncBtn").onclick = syncBacklogTitle;
    $("#bUnsyncBtn").onclick = unsyncBacklogItem;
    $("#bSteamAppId").oninput = () => applySteamAppId("b");
    OVERRIDE_FIELDS.forEach((f) => { $(f.check).onchange = () => refreshOverrideFields(OVERRIDE_FIELDS); });
    // Live preview: a pinned cover URL is usually being pasted precisely
    // because the synced one was wrong, so show what you typed straight away
    // rather than only after a save-and-reopen.
    $("#bOvrCoverUrl").oninput = () => {
      if (!isPinned("cover")) return;
      $("#bCoverUrl").value = $("#bOvrCoverUrl").value.trim();
      setBacklogCover();
    };
    $("#pickRerollBtn").onclick = rerollPick;
    $("#pickCloseBtn").onclick = closePickModal;
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#backlogModal .ac-wrap")) {
        const bs = $("#bTitleSuggest");
        if (bs) bs.hidden = true;
      }
    });
  }

  window.LifeLogBacklog = {
    init,
    wire,
    // view (dispatched from app.js's render())
    renderBacklog,
    // cross-view search match count (app.js's tab match badges)
    getFilteredBacklog,
    // modal (add menu, "✓ Done" flow, Escape close)
    openBacklogModal,
    closeBacklogModal,
    // "pick something for me" modal (Escape close)
    closePickModal,
    // cover panel (applySteamAppId in app.js writes the fields, then repaints)
    setBacklogCover,
    // data lifecycle (app.js's normalize/import infra)
    sanitizeBacklog,
    // pure release-date logic (sync.js's re-check, and test/backlog.test.js)
    isUnreleased,
    isAwaitingRelease,
    upcomingAt,
    // manual release-date overrides (test/backlog.test.js)
    parseReleaseInput,
    formatReleaseInput,
    // which block of a category a row lands in (test/backlog.test.js)
    bandOf,
  };
})();
