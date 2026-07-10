// LifeLog — the Journal: the Timeline and Stats views, the entry add/edit
// modal (with title suggestions + media sync/cover machinery shared with the
// backlog modal), timeline entry bulk actions, achievements, category
// management, and the entry sanitizer. Extracted from app.js; shared app
// plumbing arrives via init(ctx). The shared media helpers (title suggestions,
// fetchMediaSuggestions, makeMediaAcItem, sync-status/button visibility,
// setEntryCover) live here and are re-forwarded into backlog.js by app.js.
(function () {
  // Shared app plumbing, provided by app.js via init(ctx).
  let state, $, el, uid, toast, persist, render, groupBy, countBy, colorOf,
    emptyCoverEl, monthCardHeader, bulkActionBar, bulkCheckbox, toggleBulkItem,
    attachLongPressSelect, animatedNumberText, barRow, fillSelect,
    fillCategorySelect, wireCategorySelect, resolvePendingCatSelect,
    rebuildColorMap, buildYearFilter, buildCatFilter, renderCoverLinkButtons,
    applySteamAppId, backfillUpdatedAt, MONTHS, MONTHS_SHORT, MEDIA_SOURCE_LABELS,
    DEFAULT_SETTINGS;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, groupBy, countBy, colorOf,
      emptyCoverEl, monthCardHeader, bulkActionBar, bulkCheckbox, toggleBulkItem,
      attachLongPressSelect, animatedNumberText, barRow, fillSelect,
      fillCategorySelect, wireCategorySelect, resolvePendingCatSelect,
      rebuildColorMap, buildYearFilter, buildCatFilter, renderCoverLinkButtons,
      applySteamAppId, backfillUpdatedAt, MONTHS, MONTHS_SHORT, MEDIA_SOURCE_LABELS,
      DEFAULT_SETTINGS } = ctx);
  }

  // ---------- timeline view ----------
  function renderTimeline(root, entries) {
    root.appendChild(timelineToolbar());

    const byYear = groupBy(entries, (e) => e.year);
    for (const y of Object.keys(byYear).sort((a, b) => b - a)) {
      const block = el("div", "year-block");
      const head = el("div", "year-head");
      head.appendChild(el("h2", null, y));
      head.appendChild(el("span", "ycount", `${byYear[y].length} entries`));
      const accs = (state.data.accomplishments && state.data.accomplishments[y]) || [];
      if (accs.length) {
        const a = el("div", "accs");
        a.appendChild(document.createTextNode("★"));
        accs.forEach((acc, i) => {
          const chip = el("span", "acc", acc.text);
          chip.title = "Edit achievement";
          chip.onclick = () => openAchModal({ year: +y, index: i, text: acc.text, createdAt: acc.createdAt, notes: acc.notes });
          a.appendChild(chip);
        });
        head.appendChild(a);
      }
      block.appendChild(head);

      const grid = el("div", "month-grid");
      const byMonth = groupBy(byYear[y], (e) => e.month);
      const monthSort = state.data.settings.monthOrder === "desc" ? (a, b) => b - a : (a, b) => a - b;
      for (const m of Object.keys(byMonth).sort(monthSort)) {
        const card = el("div", "month-card");
        const yy = +y, mm = +m;
        card.appendChild(monthCardHeader(MONTHS[m], byMonth[m].length, byMonth[m], {
          onAdd: () => openEntryModal(null, null, { year: yy, month: mm }),
        }));
        byMonth[m].forEach((e) => card.appendChild(entryRow(e)));
        grid.appendChild(card);
      }
      block.appendChild(grid);
      root.appendChild(block); // attach now, fully built, so its real layout can be measured
      // getBoundingClientRect (not offsetHeight) keeps the sub-pixel remainder,
      // which otherwise rounds away and leaves a hairline gap under the sticky header.
      block.style.setProperty("--year-head-h", head.getBoundingClientRect().height + "px");
    }
    if (state.bulk.active) {
      root.appendChild(bulkActionBar({
        categories: state.data.categories,
        onMove: bulkMoveEntriesSelected,
        onDelete: bulkDeleteEntriesSelected,
        onSync: bulkSyncEntriesSelected,
      }));
    }
  }

  function entryRow(e) {
    const row = el("div", "entry");
    if (state.bulk.active) row.appendChild(bulkCheckbox(e));
    if (state.visual.timelineCoverSize !== "none") {
      const sizeClass = state.visual.timelineCoverSize === "big" ? "cover-lg" : "cover-sm";
      if (e.coverUrl) {
        const img = document.createElement("img");
        img.src = e.coverUrl; img.alt = "";
        img.className = "etn-cover " + sizeClass;
        // On a broken URL, swap in the same empty placeholder used for entries
        // with no cover at all, instead of collapsing the space it held.
        img.onerror = () => { img.replaceWith(emptyCoverEl("etn-cover cover-empty " + sizeClass, e.category)); };
        row.appendChild(img);
      } else {
        row.appendChild(emptyCoverEl("etn-cover cover-empty " + sizeClass, e.category));
      }
    }
    const color = colorOf(e.category);
    const chip = el("span", "entry-cat");
    chip.style.background = color + "22";
    chip.style.color = color;
    const dot = el("span", "dot");
    dot.style.background = color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(e.category));
    row.appendChild(chip);
    const t = el("span", "etitle", e.title);
    t.title = e.title;
    row.appendChild(t);
    if (e.rating) row.appendChild(ratingBadge(e.rating));
    row.onclick = () => state.bulk.active ? toggleBulkItem(e.id) : openEntryModal(e);
    attachLongPressSelect(row, e);
    return row;
  }

  function ratingBadge(rating) {
    const span = el("span", "erating", "★".repeat(rating));
    span.title = rating + "/5";
    return span;
  }

  function timelineToolbar() {
    const bar = el("div", "timeline-toolbar");
    const desc = state.data.settings.monthOrder === "desc";
    const btn = el("button", "btn btn-sm", desc ? "↑ Oldest first" : "↓ Newest first");
    btn.type = "button";
    btn.title = desc
      ? "Showing newest month first within each year — click for oldest first"
      : "Showing oldest month first within each year — click for newest first";
    btn.onclick = toggleMonthOrder;
    bar.appendChild(btn);
    return bar;
  }

  async function toggleMonthOrder() {
    state.data.settings.monthOrder = state.data.settings.monthOrder === "desc" ? "asc" : "desc";
    render();
    await persist();
  }

  // ---------- timeline bulk actions ----------
  async function bulkMoveEntriesSelected(categoryName) {
    const ids = state.bulk.selected;
    state.data.entries.forEach((e) => { if (ids.has(e.id)) e.category = categoryName; });
    const n = ids.size;
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Moved ${n} entr${n === 1 ? "y" : "ies"} to “${categoryName}”`);
  }

  async function bulkDeleteEntriesSelected() {
    const ids = state.bulk.selected;
    const n = ids.size;
    if (!confirm(`Delete ${n} entr${n === 1 ? "y" : "ies"} from your timeline?`)) return;
    state.data.entries = state.data.entries.filter((e) => !ids.has(e.id));
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Deleted ${n} entr${n === 1 ? "y" : "ies"}`);
  }

  // Syncs each selected timeline entry to media metadata, auto-picking the top
  // search result (no per-item review, since reviewing N items individually
  // would defeat the point of a bulk action) — same approach as the Backlog's
  // bulk sync.
  async function bulkSyncEntriesSelected(btn) {
    const ids = [...state.bulk.selected];
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    const progress = $(".bulk-progress");
    btn.disabled = true;
    let synced = 0, skipped = 0, lastErr = "";
    for (const id of ids) {
      const item = state.data.entries.find((e) => e.id === id);
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
          item.coverUrl = r.coverUrl || "";
          item.mediaId = r.id || "";
          item.mediaSource = r.source || "";
          // TMDB needs a second per-title call for runtime/season data — the
          // search endpoint doesn't include it (see fetchLength in media.js).
          item.length = (await window.LifeLogMedia.fetchLength(r.id, r.source, keys.tmdb)) || r.length || "";
          if (r.source === "rawg-steam-gg") {
            const resolved = await resolveRawgSteamAppId(r, keys.rawg);
            item.mediaSource = resolved.mediaSource;
            item.mediaId = resolved.mediaId;
          }
          synced++;
        }
      }
      if (progress) progress.textContent = `${synced + skipped}/${ids.length} synced`;
    }
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    const base = skipped ? `Synced ${synced} entr${synced === 1 ? "y" : "ies"}, skipped ${skipped}` : `Synced ${synced} entr${synced === 1 ? "y" : "ies"}`;
    toast(lastErr ? base + " — " + lastErr : base, !!(skipped && lastErr));
  }

  // ---------- stats view ----------
  function renderStats(root, entries) {
    const ys = [...new Set(entries.map((e) => e.year))];
    const thisYear = new Date().getFullYear();
    const big = el("div", "card");
    const bigRow = el("div", "stat-big");
    bigRow.appendChild(statItem(entries.length, "entries"));
    bigRow.appendChild(statItem(entries.filter((e) => e.year === thisYear).length, `in ${thisYear}`));
    bigRow.appendChild(statItem(ys.length, "years"));
    bigRow.appendChild(statItem(new Set(entries.map((e) => e.category)).size, "categories"));
    big.appendChild(el("h2", null, "Overview"));
    big.appendChild(bigRow);

    const grid = el("div", "stats-grid");

    // by category
    const catCard = el("div", "card");
    catCard.appendChild(el("h2", null, "Categories"));
    const catCounts = countBy(entries, (e) => e.category);
    const byCat = groupBy(entries, (e) => e.category);
    const catUnique = {};
    for (const n of Object.keys(catCounts)) catUnique[n] = new Set(byCat[n].map((e) => e.title.trim().toLowerCase())).size;
    const catOrder = state.data.categories.map((c) => c.name).filter((n) => catCounts[n]);
    for (const n of Object.keys(catCounts)) if (!catOrder.includes(n)) catOrder.push(n);
    const catMax = Math.max(1, ...Object.values(catCounts));
    catOrder.sort((a, b) => catCounts[b] - catCounts[a])
      .forEach((n) => catCard.appendChild(barRow(n, catCounts[n], catMax, colorOf(n), catUnique[n])));

    // by year
    const yearCard = el("div", "card");
    yearCard.appendChild(el("h2", null, "Years"));
    const yearCounts = countBy(entries, (e) => e.year);
    const yearMax = Math.max(1, ...Object.values(yearCounts));
    Object.keys(yearCounts).sort((a, b) => b - a)
      .forEach((y) => yearCard.appendChild(barRow(y, yearCounts[y], yearMax, "var(--accent)")));

    grid.appendChild(catCard);
    grid.appendChild(yearCard);
    root.appendChild(big);
    root.appendChild(grid);

    // most re-logged titles (rewatches/replays/rereads)
    const byTitle = new Map();
    for (const e of entries) {
      const key = e.title.trim().toLowerCase();
      let g = byTitle.get(key);
      if (!g) { g = { title: e.title, count: 0, category: e.category }; byTitle.set(key, g); }
      g.count++;
    }
    const repeats = [...byTitle.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count).slice(0, 5);
    if (repeats.length) {
      const repCard = el("div", "card");
      repCard.appendChild(el("h2", null, "Most repeated"));
      const repMax = Math.max(1, ...repeats.map((r) => r.count));
      repeats.forEach((r) => {
        const row = barRow(r.title, r.count, repMax, colorOf(r.category));
        row.querySelector(".lbl").title = r.title;
        repCard.appendChild(row);
      });
      root.appendChild(repCard);
    }

    renderHeatmap(root, entries);
    renderYearInReview(root, state.data.entries);
  }

  function heatColor(count, max) {
    const t = max <= 1 ? 1 : Math.max(0.2, count / max);
    return `rgb(${Math.round(0x22 + (0x5b - 0x22) * t)},${Math.round(0x28 + (0x8c - 0x28) * t)},${Math.round(0x36 + (0xff - 0x36) * t)})`;
  }

  function renderHeatmap(root, allEntries) {
    if (!allEntries.length) return;
    const counts = {};
    let maxCount = 0;
    for (const e of allEntries) {
      const k = `${e.year}-${e.month}`;
      counts[k] = (counts[k] || 0) + 1;
      if (counts[k] > maxCount) maxCount = counts[k];
    }
    const thisYear = new Date().getFullYear();
    const allYears = [...new Set([...allEntries.map((e) => e.year), thisYear])].sort((a, b) => a - b);

    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Activity"));
    const wrap = el("div", "heatmap");

    const header = el("div", "heatmap-row");
    header.appendChild(el("span", "heatmap-year-lbl"));
    for (const m of MONTHS_SHORT.slice(1)) header.appendChild(el("span", "heatmap-month-lbl", m));
    wrap.appendChild(header);

    for (const year of [...allYears].reverse()) {
      const row = el("div", "heatmap-row");
      row.appendChild(el("span", "heatmap-year-lbl", String(year)));
      for (let m = 1; m <= 12; m++) {
        const count = counts[`${year}-${m}`] || 0;
        const cell = el("div", "heatmap-cell");
        if (count) {
          cell.style.background = heatColor(count, maxCount);
          cell.title = `${count} ${count === 1 ? "entry" : "entries"} · ${MONTHS_SHORT[m]} ${year}`;
        }
        row.appendChild(cell);
      }
      wrap.appendChild(row);
    }
    card.appendChild(wrap);
    root.appendChild(card);
  }

  function renderYearInReview(root, allEntries) {
    const allYears = [...new Set(allEntries.map((e) => e.year))].sort((a, b) => b - a);
    if (!allYears.length) return;
    if (!state.statsYear || !allYears.includes(state.statsYear)) state.statsYear = allYears[0];

    const card = el("div", "card yir-card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Year in Review"));

    const yearNav = el("div", "yir-years");
    for (const y of allYears) {
      const btn = el("button", "yir-year-btn" + (y === state.statsYear ? " active" : ""), String(y));
      btn.type = "button";
      btn.onclick = () => { state.statsYear = y; render(); };
      yearNav.appendChild(btn);
    }
    card.appendChild(yearNav);

    const yearEntries = allEntries.filter((e) => e.year === state.statsYear);
    const achs = state.data.accomplishments[state.statsYear] || [];

    if (!yearEntries.length && !achs.length) {
      card.appendChild(el("p", "muted", `No entries logged in ${state.statsYear}.`));
      root.appendChild(card);
      return;
    }

    const uniqueTitles = new Set(yearEntries.map((e) => e.title.trim().toLowerCase())).size;
    const monthCounts = countBy(yearEntries, (e) => e.month);
    const topMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0];
    const highlights = el("div", "yir-highlights");
    highlights.appendChild(statItem(yearEntries.length, "entries", "yir:entries"));
    highlights.appendChild(statItem(uniqueTitles, "unique titles", "yir:unique"));
    if (topMonth) highlights.appendChild(statItem(MONTHS_SHORT[+topMonth[0]], "best month", "yir:month"));
    card.appendChild(highlights);

    if (yearEntries.length) {
      const catCounts = countBy(yearEntries, (e) => e.category);
      const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const catMax = topCats[0][1];
      const sec = el("div", "yir-section");
      sec.appendChild(el("h3", null, "Top categories"));
      for (const [name, count] of topCats) sec.appendChild(barRow(name, count, catMax, colorOf(name)));
      card.appendChild(sec);
    }

    const byTitle = new Map();
    for (const e of yearEntries) {
      const key = e.title.trim().toLowerCase();
      let g = byTitle.get(key);
      if (!g) { g = { title: e.title, count: 0, category: e.category }; byTitle.set(key, g); }
      g.count++;
    }
    const repeats = [...byTitle.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count).slice(0, 5);
    if (repeats.length) {
      const repMax = repeats[0].count;
      const sec = el("div", "yir-section");
      sec.appendChild(el("h3", null, "Most repeated"));
      for (const r of repeats) {
        const row = barRow(r.title, r.count, repMax, colorOf(r.category));
        row.querySelector(".lbl").title = r.title;
        sec.appendChild(row);
      }
      card.appendChild(sec);
    }

    if (achs.length) {
      const sec = el("div", "yir-section");
      sec.appendChild(el("h3", null, `Achievements (${achs.length})`));
      for (const a of achs) {
        const item = el("div", "yir-ach");
        item.appendChild(el("span", "yir-ach-bullet", "✦"));
        item.appendChild(el("span", null, a.text));
        sec.appendChild(item);
      }
      card.appendChild(sec);
    }

    root.appendChild(card);
  }

  function statItem(n, l, key) {
    const i = el("div", "item");
    const nEl = el("div", "n");
    animatedNumberText(nEl, "stat:" + (key || l), n, (v) => typeof v === "number" ? String(Math.round(v)) : String(v));
    i.appendChild(nEl);
    i.appendChild(el("div", "l", l));
    return i;
  }

  // ---------- entry modal ----------
  function openEntryModal(entry, fromBacklog, presetDate) {
    const editing = !!entry;
    $("#entryModalTitle").textContent = editing ? "Edit entry" : "Add entry";
    $("#entryId").value = editing ? entry.id : "";
    $("#entryFromBacklog").value = fromBacklog ? fromBacklog.id : "";
    $("#fTitle").value = editing ? entry.title : (fromBacklog ? fromBacklog.title : "");
    fillCategorySelect($("#fCategory"), state.data.categories,
      editing ? entry.category : (fromBacklog ? fromBacklog.category : (state.data.categories[0] && state.data.categories[0].name)));
    fillSelect($("#fMonth"),
      MONTHS.slice(1).map((m, i) => ({ value: i + 1, label: m })),
      editing ? entry.month : (presetDate ? presetDate.month : (new Date().getMonth() + 1)));
    $("#fYear").value = editing ? entry.year : (presetDate ? presetDate.year : new Date().getFullYear());
    $("#deleteEntryBtn").hidden = !editing;
    $("#moveToBacklogBtn").hidden = !editing;
    const added = $("#addedLine");
    if (editing && entry.createdAt) {
      added.textContent = "Added " + new Date(entry.createdAt).toLocaleDateString(undefined,
        { year: "numeric", month: "short", day: "numeric" });
      added.hidden = false;
    } else added.hidden = true;
    setRating(editing ? (entry.rating || 0) : 0);
    $("#fNotes").value = editing ? (entry.notes || "") : "";
    const coverSrc = editing ? (entry.coverUrl || "") : (fromBacklog ? (fromBacklog.coverUrl || "") : "");
    const mediaSrc = editing ? (entry.mediaSource || "") : (fromBacklog ? (fromBacklog.mediaSource || "") : "");
    const mediaId = editing ? (entry.mediaId || "") : (fromBacklog ? (fromBacklog.mediaId || "") : "");
    const lengthSrc = editing ? (entry.length || "") : (fromBacklog ? (fromBacklog.length || "") : "");
    lastSyncedEntryTitle = editing ? entry.title : (fromBacklog ? fromBacklog.title : "");
    setEntryCover(coverSrc, mediaId, mediaSrc, lengthSrc);
    $("#fSteamAppId").value = mediaSrc === "steam" ? mediaId : "";
    updateSyncBtnVisibility("f", $("#fCategory").value);
    $("#fTitleSuggest").hidden = true;
    $("#fTitleSuggest").innerHTML = "";
    updateBacklogLinkBanner();
    $("#entryModal").hidden = false;
  }
  function closeEntryModal() { $("#entryModal").hidden = true; }

  function setStars(sel, value) {
    const wrap = $(sel);
    wrap.dataset.value = String(value);
    wrap.querySelectorAll(".star").forEach((s) => {
      s.classList.toggle("filled", parseInt(s.dataset.star, 10) <= value);
    });
  }
  function setRating(value) { setStars("#fRating", value); }

  // ---------- shared media/title-suggestion machinery (entry + backlog) ----------
  // Suggest previously-logged titles matching what's being typed, so a
  // re-entry (rewatch/replay/reread) reuses the exact same title/category.
  // Also carries cover media fields so re-entries inherit existing art.
  function titleSuggestions(query, excludeId) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const groups = new Map();
    for (const e of state.data.entries) {
      if (e.id === excludeId) continue;
      const key = e.title.trim().toLowerCase();
      if (!key.includes(q)) continue;
      let g = groups.get(key);
      if (!g) {
        g = { title: e.title, count: 0, category: e.category, year: e.year, month: e.month,
              coverUrl: e.coverUrl || "", mediaId: e.mediaId || "", mediaSource: e.mediaSource || "", length: e.length || "" };
        groups.set(key, g);
      }
      g.count++;
      if (e.year > g.year || (e.year === g.year && e.month > g.month)) {
        g.title = e.title; g.category = e.category; g.year = e.year; g.month = e.month;
        g.coverUrl = e.coverUrl || ""; g.mediaId = e.mediaId || ""; g.mediaSource = e.mediaSource || ""; g.length = e.length || "";
      }
    }
    return [...groups.values()]
      .sort((a, b) => a.title.toLowerCase().indexOf(q) - b.title.toLowerCase().indexOf(q) || b.count - a.count)
      .slice(0, 6);
  }

  // Suggest matching backlog items, so adding an entry surfaces the fact
  // it's already sitting in the backlog and offers to remove it on save.
  function backlogSuggestions(query, excludeId) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return state.data.backlog
      .filter((b) => b.id !== excludeId && b.title.trim().toLowerCase().includes(q))
      .sort((a, b) => a.title.toLowerCase().indexOf(q) - b.title.toLowerCase().indexOf(q))
      .slice(0, 6);
  }

  // Title last attached to synced media metadata, so a manual edit (vs. a
  // local-match or sync pick) is detected and clears the now-stale cover.
  let lastSyncedEntryTitle = "";

  function hasMediaSourceFor(category) {
    return !!((state.data.settings.mediaCategorySources || {})[category]);
  }

  // Strips a trailing "S1"/"Season 1"/"B1"/"Book 1" style marker some people
  // append to entry titles to tell apart e.g. individual seasons or books of
  // the same show/series — a media source's search has no idea what to do
  // with that suffix, so it's dropped before searching (the entry's own
  // title, and what gets saved, are never touched).
  const MEDIA_SEARCH_SUFFIX_RE = /\s+[-–—:]?\s*(?:season|s|book|b)\s*\.?\s*\d+\s*$/i;
  function stripMediaSearchSuffix(title) {
    const stripped = title.replace(MEDIA_SEARCH_SUFFIX_RE, "").trim();
    return stripped || title;
  }

  // For a "rawg-steam-gg" combo result: Steam has no search API of its own
  // (CORS-blocked, see media.js), so the only way to get an App ID without
  // asking the user to paste one manually is via RAWG's own store-links
  // data for this specific game. Falls back to the plain RAWG identity if
  // RAWG has no Steam listing for it (not every game is on Steam).
  async function resolveRawgSteamAppId(r, rawgKey) {
    const appId = window.LifeLogMedia ? await window.LifeLogMedia.fetchRawgSteamAppId(r.id, rawgKey) : "";
    return appId ? { mediaSource: "steam", mediaId: appId } : { mediaSource: "rawg", mediaId: r.id || "" };
  }

  // Tries the category's primary media source first; only if that comes back
  // completely empty does it fall back to the category's configured fallback
  // source (if any) — the fallback never overrides a primary that actually
  // found something, it just fills the gap when the primary has nothing.
  async function fetchMediaSuggestions(title, category) {
    const source = (state.data.settings.mediaCategorySources || {})[category];
    if (!source || !window.LifeLogMedia) return [];
    const fallbackSource = (state.data.settings.mediaCategoryFallbackSources || {})[category];
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    const stripped = stripMediaSearchSuffix(title);
    async function trySource(src) {
      if (!src) return [];
      if (stripped !== title) {
        const results = await window.LifeLogMedia.search(stripped, src, keys);
        if (results.length) return results;
      }
      return window.LifeLogMedia.search(title, src, keys);
    }
    try {
      const results = await trySource(source);
      if (results.length) return results;
      return await trySource(fallbackSource);
    } catch (e) { return []; }
  }

  function makeMediaAcItem(r, onPick) {
    const item = el("div", r.coverUrl ? "ac-item ac-media" : "ac-item");
    if (r.coverUrl) {
      const img = document.createElement("img");
      img.src = r.coverUrl; img.alt = ""; img.className = "ac-thumb";
      img.onerror = () => { img.style.display = "none"; };
      item.appendChild(img);
    }
    const info = el("div", "ac-info");
    info.appendChild(el("span", "ac-title", r.title));
    const meta = [];
    if (r.year) meta.push(String(r.year));
    if (r.externalRating) meta.push("★ " + r.externalRating);
    if (meta.length) info.appendChild(el("span", "ac-meta", meta.join(" · ")));
    item.appendChild(info);
    item.onclick = onPick;
    return item;
  }

  function showSyncStatus(prefix, source) {
    const statusDiv = $("#" + prefix + "SyncStatus");
    const statusText = $("#" + prefix + "SyncStatusText");
    if (!statusDiv) return;
    if (source) {
      statusText.textContent = "Synced via " + (MEDIA_SOURCE_LABELS[source] || source);
      statusDiv.hidden = false;
    } else {
      statusDiv.hidden = true;
    }
  }

  function updateSyncBtnVisibility(prefix, category) {
    const isSteam = (state.data.settings.mediaCategorySources || {})[category] === "steam";
    const btn = $("#" + prefix + "SyncBtn");
    if (btn) btn.hidden = isSteam || !hasMediaSourceFor(category);
    const steamField = $("#" + prefix + "SteamField");
    if (steamField) steamField.hidden = !isSteam;
  }

  function setEntryCover(coverUrl, mediaId, mediaSource, length) {
    $("#fCoverUrl").value = coverUrl || "";
    $("#fMediaId").value = mediaId || "";
    $("#fMediaSource").value = mediaSource || "";
    $("#fLength").value = length || "";
    const coverDiv = $("#entryCover");
    const coverImg = $("#entryCoverImg");
    const meta = $("#entryCoverMeta");
    meta.innerHTML = "";
    if (length) meta.appendChild(el("span", "bl-meta", length));
    coverImg.onerror = () => { coverDiv.hidden = true; };
    if (coverUrl) { coverImg.src = coverUrl; coverDiv.hidden = false; }
    else { coverDiv.hidden = true; coverImg.src = ""; }
    renderCoverLinkButtons($("#entryCoverLinks"), mediaSource, mediaId);
    showSyncStatus("f", mediaSource);
  }

  function renderTitleSuggestions() {
    const list = $("#fTitleSuggest");
    const query = $("#fTitle").value;
    const isAdding = !$("#entryId").value;

    // If user is typing new content (not just after a local-match pick), clear cover —
    // unless it's a manually-entered Steam App ID, which isn't derived from the title.
    // Only while adding: renaming an already-synced existing entry shouldn't silently
    // drop its media link — that takes an explicit "✕ Unsync" now.
    if (isAdding && query !== lastSyncedEntryTitle && $("#fCoverUrl").value && $("#fMediaSource").value !== "steam") {
      setEntryCover("", "", "", "");
    }

    const localMatches = titleSuggestions(query, $("#entryId").value || null);
    const backlogMatches = isAdding ? backlogSuggestions(query) : [];
    list.innerHTML = "";

    localMatches.forEach((m) => {
      const item = makeMediaAcItem(
        { title: m.title, coverUrl: m.coverUrl, year: null, externalRating: null },
        () => {
          lastSyncedEntryTitle = m.title;
          $("#fTitle").value = m.title;
          if (state.data.categories.some((c) => c.name === m.category)) $("#fCategory").value = m.category;
          setEntryCover(m.coverUrl, m.mediaId, m.mediaSource, m.length || "");
          updateSyncBtnVisibility("f", $("#fCategory").value);
          list.hidden = true;
        }
      );
      // Replace the generated ac-meta with the reentry-style meta
      const info = item.querySelector(".ac-info");
      const existing = info.querySelector(".ac-meta");
      if (existing) existing.remove();
      info.appendChild(el("span", "ac-meta", `×${m.count} · last ${MONTHS_SHORT[m.month]} ${m.year}`));
      list.appendChild(item);
    });

    if (localMatches.length && backlogMatches.length) list.appendChild(el("div", "ac-divider"));

    backlogMatches.forEach((b) => {
      const item = makeMediaAcItem(
        { title: b.title, coverUrl: b.coverUrl || "", year: null, externalRating: null },
        () => {
          lastSyncedEntryTitle = b.title;
          $("#fTitle").value = b.title;
          if (state.data.categories.some((c) => c.name === b.category)) $("#fCategory").value = b.category;
          setEntryCover(b.coverUrl || "", b.mediaId || "", b.mediaSource || "", b.length || "");
          updateSyncBtnVisibility("f", $("#fCategory").value);
          $("#entryFromBacklog").value = b.id;
          updateBacklogLinkBanner();
          list.hidden = true;
        }
      );
      const info = item.querySelector(".ac-info");
      const existing = info.querySelector(".ac-meta");
      if (existing) existing.remove();
      info.appendChild(el("span", "ac-meta", `📋 In backlog · ${b.category}`));
      list.appendChild(item);
    });

    list.hidden = !localMatches.length && !backlogMatches.length;

    // Exact typed match against the backlog auto-links it, without a click —
    // but only ever sets the link, never clears one already set (e.g. from
    // the ✓ Done button), so a later edit to the title can't silently undo it.
    if (isAdding && !$("#entryFromBacklog").value) {
      const q = query.trim().toLowerCase();
      if (q) {
        const exact = state.data.backlog.find((b) => b.title.trim().toLowerCase() === q);
        if (exact) $("#entryFromBacklog").value = exact.id;
      }
    }

    updateBacklogLinkBanner();
  }

  // Shows/hides the "will be removed from backlog on save" banner based on
  // #entryFromBacklog, however it got set (✓ Done button, suggestion click,
  // or exact-typed-title auto-link) — and wires the opt-out unlink button.
  function updateBacklogLinkBanner() {
    const id = $("#entryFromBacklog").value;
    const linked = id && state.data.backlog.some((b) => b.id === id);
    $("#fBacklogLinkStatus").hidden = !linked;
  }

  async function syncEntryTitle() {
    const title = $("#fTitle").value.trim();
    const category = $("#fCategory").value;
    if (!title) return;
    const list = $("#fTitleSuggest");
    const results = await fetchMediaSuggestions(title, category);
    list.innerHTML = "";
    if (!results.length) {
      list.hidden = true;
      const err = window.LifeLogMedia && window.LifeLogMedia.getLastError();
      toast(err ? "No matches found — " + err : "No matches found", !!err);
      return;
    }
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    results.forEach((r) => {
      list.appendChild(makeMediaAcItem(r, async () => {
        lastSyncedEntryTitle = $("#fTitle").value.trim();
        const length = (await window.LifeLogMedia.fetchLength(r.id, r.source, keys.tmdb)) || r.length || "";
        let mediaId = r.id, mediaSource = r.source;
        if (r.source === "rawg-steam-gg") {
          const resolved = await resolveRawgSteamAppId(r, keys.rawg);
          mediaSource = resolved.mediaSource;
          mediaId = resolved.mediaId;
        }
        setEntryCover(r.coverUrl, mediaId, mediaSource, length);
        list.hidden = true;
      }));
    });
    list.hidden = false;
  }

  function unsyncEntry() {
    setEntryCover("", "", "", "");
    $("#fSteamAppId").value = "";
    $("#fTitleSuggest").hidden = true;
  }

  async function saveEntryFromForm(ev) {
    ev.preventDefault();
    const id = $("#entryId").value;
    const fromBacklogId = $("#entryFromBacklog").value;
    const title = $("#fTitle").value.trim();
    const category = $("#fCategory").value;
    const year = parseInt($("#fYear").value, 10);
    const month = parseInt($("#fMonth").value, 10);
    const rating = parseInt($("#fRating").dataset.value, 10) || 0;
    const notes = $("#fNotes").value.trim();
    const coverUrl = $("#fCoverUrl").value;
    const mediaId = $("#fMediaId").value;
    const mediaSource = $("#fMediaSource").value;
    const length = $("#fLength").value;
    if (!title) return;
    if (id) {
      const e = state.data.entries.find((x) => x.id === id);
      Object.assign(e, { title, category, year, month, date: `${year}-${String(month).padStart(2, "0")}` });
      if (rating) e.rating = rating; else delete e.rating;
      if (notes) e.notes = notes; else delete e.notes;
      if (coverUrl) e.coverUrl = coverUrl; else delete e.coverUrl;
      if (mediaId) e.mediaId = mediaId; else delete e.mediaId;
      if (mediaSource) e.mediaSource = mediaSource; else delete e.mediaSource;
      if (length) e.length = length; else delete e.length;
    } else {
      const newEntry = {
        id: uid(), title, category, year, month,
        date: `${year}-${String(month).padStart(2, "0")}`,
        createdAt: new Date().toISOString(),
      };
      if (rating) newEntry.rating = rating;
      if (notes) newEntry.notes = notes;
      if (coverUrl) newEntry.coverUrl = coverUrl;
      if (mediaId) newEntry.mediaId = mediaId;
      if (mediaSource) newEntry.mediaSource = mediaSource;
      if (length) newEntry.length = length;
      state.data.entries.push(newEntry);
    }
    if (fromBacklogId) state.data.backlog = state.data.backlog.filter((b) => b.id !== fromBacklogId);
    closeEntryModal();
    buildYearFilter();
    render();
    await persist();
    toast(id ? "Entry updated" : (fromBacklogId ? "Moved to log" : "Entry added"));
  }

  async function deleteCurrentEntry() {
    const id = $("#entryId").value;
    if (!id) return;
    if (!confirm("Delete this entry?")) return;
    state.data.entries = state.data.entries.filter((x) => x.id !== id);
    closeEntryModal();
    buildYearFilter();
    render();
    await persist();
    toast("Entry deleted");
  }

  async function moveEntryToBacklog() {
    const id = $("#entryId").value;
    if (!id) return;
    const entry = state.data.entries.find((e) => e.id === id);
    if (!entry) return;
    if (!confirm("Move this entry to your backlog?")) return;
    const item = { id: uid(), title: entry.title, category: entry.category, createdAt: new Date().toISOString() };
    if (entry.notes) item.notes = entry.notes;
    if (entry.coverUrl) item.coverUrl = entry.coverUrl;
    if (entry.mediaId) item.mediaId = entry.mediaId;
    if (entry.mediaSource) item.mediaSource = entry.mediaSource;
    if (entry.length) item.length = entry.length;
    state.data.backlog.push(item);
    state.data.entries = state.data.entries.filter((e) => e.id !== id);
    closeEntryModal();
    buildYearFilter();
    render();
    await persist();
    toast("Moved to backlog");
  }

  // ---------- achievements ----------
  function openAchModal(ach) {
    const editing = !!ach;
    $("#achModalTitle").textContent = editing ? "Edit achievement" : "Add achievement";
    $("#achOrig").value = editing ? `${ach.year}|${ach.index}` : "";
    $("#aText").value = editing ? ach.text : "";
    $("#aYear").value = editing ? ach.year : new Date().getFullYear();
    $("#deleteAchBtn").hidden = !editing;
    const added = $("#achAddedLine");
    if (editing && ach.createdAt) {
      added.textContent = "Added " + new Date(ach.createdAt).toLocaleDateString(undefined,
        { year: "numeric", month: "short", day: "numeric" });
      added.hidden = false;
    } else added.hidden = true;
    $("#aNotes").value = editing ? (ach.notes || "") : "";
    $("#achModal").hidden = false;
  }
  function closeAchModal() { $("#achModal").hidden = true; }

  async function saveAchFromForm(ev) {
    ev.preventDefault();
    const text = $("#aText").value.trim();
    const year = parseInt($("#aYear").value, 10);
    const notes = $("#aNotes").value.trim();
    if (!text || !year) return;
    const accs = state.data.accomplishments;
    const orig = $("#achOrig").value;
    let createdAt = new Date().toISOString();
    let id = uid();
    if (orig) { // editing: preserve original date + identity, then remove the original
      const [oy, oi] = orig.split("|");
      if (accs[oy] && accs[oy][+oi]) {
        createdAt = accs[oy][+oi].createdAt; // may be null (imported)
        id = accs[oy][+oi].id || uid();
      }
      if (accs[oy]) { accs[oy].splice(+oi, 1); if (!accs[oy].length) delete accs[oy]; }
    }
    // updatedAt isn't set here — persist() stamps it automatically for any
    // item that changed since the last save (see stampChangedItems).
    const ach = { id, text, createdAt };
    if (notes) ach.notes = notes;
    (accs[year] = accs[year] || []).push(ach);
    closeAchModal();
    render();
    await persist();
    toast(orig ? "Achievement updated" : "Achievement added");
  }

  async function deleteCurrentAch() {
    const orig = $("#achOrig").value;
    if (!orig) return;
    if (!confirm("Delete this achievement?")) return;
    const [oy, oi] = orig.split("|");
    const accs = state.data.accomplishments;
    if (accs[oy]) { accs[oy].splice(+oi, 1); if (!accs[oy].length) delete accs[oy]; }
    closeAchModal();
    render();
    await persist();
    toast("Achievement deleted");
  }

  // ---------- categories management ----------
  function openCategoryModal(cat) {
    const editing = !!cat;
    $("#catModalTitle").textContent = editing ? "Edit category" : "Add category";
    $("#catOrigName").value = editing ? cat.name : "";
    $("#cName").value = editing ? cat.name : "";
    $("#cColor").value = editing ? cat.color : "#3bb2e2";
    const uses = $("#cUses");
    if (editing) {
      const entryCount = countBy(state.data.entries, (e) => e.category)[cat.name] || 0;
      const backlogCount = countBy(state.data.backlog, (b) => b.category)[cat.name] || 0;
      const n = entryCount + backlogCount;
      uses.textContent = n + (n === 1 ? " item uses this" : " items use this");
      uses.hidden = false;
    } else uses.hidden = true;
    $("#deleteCatBtn").hidden = !editing;
    $("#catModal").hidden = false;
  }
  function closeCategoryModal() { $("#catModal").hidden = true; }
  function cancelCategoryModal() { closeCategoryModal(); resolvePendingCatSelect(); }

  async function saveCategoryFromForm(ev) {
    ev.preventDefault();
    const orig = $("#catOrigName").value;
    const newName = $("#cName").value.trim();
    const color = $("#cColor").value;
    if (!newName) return;

    if (!orig) { // adding a new category
      if (state.data.categories.some((c) => c.name === newName)) {
        toast("That category already exists", true);
        return;
      }
      state.data.categories.push({ id: newName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: newName, color, createdAt: new Date().toISOString() });
      closeCategoryModal();
      rebuildColorMap(); buildCatFilter(); render();
      await persist();
      toast("Category added");
      resolvePendingCatSelect(newName);
      return;
    }

    const cat = state.data.categories.find((c) => c.name === orig);
    if (!cat) return;
    if (newName !== cat.name && state.data.categories.some((c) => c !== cat && c.name === newName)) {
      toast("A category with that name already exists", true);
      return;
    }
    cat.color = color;
    if (newName !== cat.name) {
      // id stays put across a rename (it's the merge/sync identity for this
      // category) — only the display name and the cascade below change.
      // (updatedAt on cat/entries/backlog isn't set here — persist() stamps
      // it automatically for anything that changed since the last save.)
      const old = cat.name;
      cat.name = newName;
      state.data.entries.forEach((e) => { if (e.category === old) e.category = newName; });
      state.data.backlog.forEach((b) => { if (b.category === old) b.category = newName; });
      if (state.activeCats.has(old)) { state.activeCats.delete(old); state.activeCats.add(newName); }
    }
    closeCategoryModal();
    rebuildColorMap(); buildCatFilter(); render();
    await persist();
    toast("Category saved");
  }

  function deleteCurrentCategory() {
    const cat = state.data.categories.find((c) => c.name === $("#catOrigName").value);
    if (!cat) return;
    closeCategoryModal();
    deleteCategory(cat); // handles confirm, reassign-to-Other, persist & render
  }

  async function deleteCategory(cat) {
    const counts = countBy(state.data.entries, (e) => e.category);
    const backlogCounts = countBy(state.data.backlog, (b) => b.category);
    const n = (counts[cat.name] || 0) + (backlogCounts[cat.name] || 0);
    if (n > 0) {
      if (cat.name === "Other") {
        toast("Can't delete “Other” while it's in use", true);
        return;
      }
      if (!confirm(`“${cat.name}” is used by ${n} item${n === 1 ? "" : "s"}. Move them to “Other” and delete?`)) return;
      let other = state.data.categories.find((c) => c.name === "Other");
      if (!other) { other = { id: "other", name: "Other", color: "#7a8a99" }; state.data.categories.push(other); }
      state.data.entries.forEach((e) => { if (e.category === cat.name) e.category = "Other"; });
      state.data.backlog.forEach((b) => { if (b.category === cat.name) b.category = "Other"; });
    } else {
      if (!confirm(`Delete category “${cat.name}”?`)) return;
    }
    state.data.categories = state.data.categories.filter((c) => c !== cat);
    state.activeCats.delete(cat.name);
    rebuildColorMap();
    buildCatFilter(); render();
    await persist();
    toast("Category deleted");
  }

  // ---------- data lifecycle ----------
  function sanitizeEntry(e) {
    const out = {
      id: e.id || uid(),
      title: e.title || "",
      category: e.category || "Other",
      year: +e.year,
      month: +e.month,
      date: e.date || `${e.year}-${String(e.month).padStart(2, "0")}`,
      createdAt: e.createdAt || null,
      updatedAt: backfillUpdatedAt(e),
    };
    if (e.rating) out.rating = +e.rating;
    if (e.notes) out.notes = e.notes;
    if (e.coverUrl) out.coverUrl = e.coverUrl;
    if (e.mediaId) out.mediaId = e.mediaId;
    if (e.mediaSource) out.mediaSource = e.mediaSource;
    if (e.length) out.length = e.length;
    return out;
  }

  // ---------- events ----------
  // Entry/achievement/category modal DOM wiring; called from app.js's wire().
  function wire() {
    wireCategorySelect("#fCategory", "#entryModal", false);

    $("#cancelEntryBtn").onclick = closeEntryModal;
    $("#entryForm").onsubmit = saveEntryFromForm;
    $("#deleteEntryBtn").onclick = deleteCurrentEntry;
    $("#moveToBacklogBtn").onclick = moveEntryToBacklog;
    $("#fTitle").oninput = renderTitleSuggestions;
    $("#fCategory").onchange = () => updateSyncBtnVisibility("f", $("#fCategory").value);
    $("#fSyncBtn").onclick = syncEntryTitle;
    $("#fUnsyncBtn").onclick = unsyncEntry;
    $("#fBacklogUnlinkBtn").onclick = () => { $("#entryFromBacklog").value = ""; updateBacklogLinkBanner(); };
    $("#fSteamAppId").oninput = () => applySteamAppId("f");
    $("#fRating").querySelectorAll(".star").forEach((s) => {
      s.onclick = () => {
        const v = parseInt(s.dataset.star, 10);
        setRating(v === parseInt($("#fRating").dataset.value, 10) ? 0 : v);
      };
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".ac-wrap")) $("#fTitleSuggest").hidden = true;
    });

    $("#cancelAchBtn").onclick = closeAchModal;
    $("#achForm").onsubmit = saveAchFromForm;
    $("#deleteAchBtn").onclick = deleteCurrentAch;

    $("#cancelCatBtn").onclick = cancelCategoryModal;
    $("#catForm").onsubmit = saveCategoryFromForm;
    $("#deleteCatBtn").onclick = deleteCurrentCategory;
  }

  window.LifeLogJournal = {
    init,
    wire,
    // views (dispatched from app.js's render())
    renderTimeline,
    renderStats,
    // modals (add menu, month-card "+", entry empty-state, filter-chip edit, Escape)
    openEntryModal,
    closeEntryModal,
    openAchModal,
    closeAchModal, // Escape handler in app.js
    openCategoryModal,
    cancelCategoryModal,
    // shared media machinery re-forwarded into backlog.js by app.js
    titleSuggestions,
    backlogSuggestions,
    makeMediaAcItem,
    fetchMediaSuggestions,
    resolveRawgSteamAppId,
    updateSyncBtnVisibility,
    showSyncStatus,
    setEntryCover, // app.js's applySteamAppId repaints the entry cover through this
    // data lifecycle (app.js's normalize)
    sanitizeEntry,
  };
})();
