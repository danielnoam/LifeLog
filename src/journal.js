// LifeLog — the Journal: the Timeline and Stats views, the entry add/edit
// modal (with title suggestions + media sync/cover machinery shared with the
// backlog modal), timeline entry bulk actions, achievements, category
// management, and the entry sanitizer. Extracted from app.js; shared app
// plumbing arrives via init(ctx). The shared media helpers (title suggestions,
// fetchMediaSuggestions, makeMediaAcItem, sync-status/button visibility,
// setEntryCover) live here and are re-forwarded into backlog.js by app.js.
(function () {
  // Shared app plumbing, provided by app.js via init(ctx).
  let state, $, el, uid, activatable, toast, persist, render, renderLazySections, groupBy, countBy, colorOf,
    emptyCoverEl, monthCardHeader, bulkActionBar, bulkCheckbox, toggleBulkItem,
    attachLongPressSelect, animatedNumberText, barRow, fillSelect,
    fillCategorySelect, wireCategorySelect, resolvePendingCatSelect,
    rebuildColorMap, buildYearFilter, buildCatFilter, renderCoverLinkButtons, renderMediaLinks,
    isOverridden, sanitizeOverrides, initOverrideFields, refreshOverrideFields,
    pushOverrideValues, readOverrideChecks,
    applySteamAppId, backfillUpdatedAt, MONTHS, MONTHS_SHORT, MEDIA_SOURCE_LABELS,
    DEFAULT_SETTINGS, jumpToTimelineMonth;

  function init(ctx) {
    ({ state, $, el, uid, activatable, toast, persist, render, renderLazySections, groupBy, countBy, colorOf,
      emptyCoverEl, monthCardHeader, bulkActionBar, bulkCheckbox, toggleBulkItem,
      attachLongPressSelect, animatedNumberText, barRow, fillSelect,
      fillCategorySelect, wireCategorySelect, resolvePendingCatSelect,
      rebuildColorMap, buildYearFilter, buildCatFilter, renderCoverLinkButtons, renderMediaLinks,
    isOverridden, sanitizeOverrides, initOverrideFields, refreshOverrideFields,
    pushOverrideValues, readOverrideChecks,
      applySteamAppId, backfillUpdatedAt, MONTHS, MONTHS_SHORT, MEDIA_SOURCE_LABELS,
      DEFAULT_SETTINGS, jumpToTimelineMonth } = ctx);
  }

  // ---------- timeline view ----------
  function renderTimeline(root, entries) {
    root.appendChild(timelineToolbar());

    const byYear = groupBy(entries, (e) => e.year);
    const sections = [];
    for (const y of Object.keys(byYear).sort((a, b) => b - a)) {
      const block = el("div", "year-block");
      block.dataset.year = y; // lets the Stats heatmap scroll straight to this year
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
          activatable(chip, () => openAchModal({ year: +y, index: i, text: acc.text, createdAt: acc.createdAt, notes: acc.notes }), "Edit achievement: " + acc.text);
          a.appendChild(chip);
        });
        head.appendChild(a);
      }
      block.appendChild(head);

      const grid = el("div", "month-grid");
      block.appendChild(grid);

      sections.push({
        key: y, header: head, node: block, bodyEl: grid,
        build: () => {
          const byMonth = groupBy(byYear[y], (e) => e.month);
          const monthSort = state.data.settings.monthOrder === "desc" ? (a, b) => b - a : (a, b) => a - b;
          for (const m of Object.keys(byMonth).sort(monthSort)) {
            const card = el("div", "month-card");
            const yy = +y, mm = +m;
            card.dataset.year = yy; card.dataset.month = mm; // heatmap-cell jump target
            card.appendChild(monthCardHeader(MONTHS[m], byMonth[m].length, byMonth[m], {
              onAdd: () => openEntryModal(null, null, { year: yy, month: mm }),
            }));
            byMonth[m].forEach((e) => card.appendChild(entryRow(e)));
            grid.appendChild(card);
          }
        },
      });
    }
    renderLazySections(root, sections);
    // All sections are attached to the document by now (renderLazySections
    // appends every node up front, before building any bodies), so headers
    // can be measured here regardless of which sections have built their
    // rows yet. getBoundingClientRect (not offsetHeight) keeps the
    // sub-pixel remainder, which otherwise rounds away and leaves a
    // hairline gap under the sticky header.
    sections.forEach((s) => s.node.style.setProperty("--year-head-h", s.header.getBoundingClientRect().height + "px"));
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
        img.loading = "lazy";
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
    const sp = spanLabel(e);
    if (sp) {
      const chip = el("span", "espan", sp);
      chip.title = "Spanned " + sp;
      row.appendChild(chip);
    }
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
    try {
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
            // Fields pinned in the entry's Advanced foldout are left alone.
            if (!isOverridden(item, "cover")) item.coverUrl = r.coverUrl || "";
            // TMDB needs a second per-title call for runtime/season data — the
            // search endpoint doesn't include it (see fetchEntryExtras in
            // media.js) — and a SteamGridDB match has neither a length nor
            // genres until RAWG is asked by title, which is what the title
            // argument is for.
            const extras = await window.LifeLogMedia.fetchEntryExtras(r.id, r.source, keys, r.title);
            if (!isOverridden(item, "length")) item.length = extras.length || r.length || "";
            // extras.genres is filled only by the SteamGridDB cross-fill, and
            // only for a source that stated none of its own — so a search
            // result that did come with genres still wins.
            const genres = extras.genres.length ? extras.genres : r.genres;
            if (genres && genres.length) item.genres = genres.slice(); else delete item.genres;
            const resolved = await resolveMediaIdentity(r, keys);
            item.mediaSource = resolved.mediaSource;
            item.mediaId = resolved.mediaId;
            synced++;
          }
        }
        if (progress) progress.textContent = `${synced + skipped}/${ids.length} synced`;
      }
    } catch (e) {
      // Anything thrown in here used to leave the button disabled and the bar
      // sitting there unchanged — from the outside, indistinguishable from the
      // button doing nothing at all. Whatever it was, say so and hand the
      // button back; entries already synced above keep their metadata.
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
    bigRow.appendChild(statItem(entries.filter((e) => e.backlogAddedAt).length, "completed from backlog"));
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
    renderHighlights(root, entries);
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

    renderMonthlyPattern(root, entries);
    renderGenreBreakdown(root, entries);
    renderHeatmap(root, entries);
    renderYearInReview(root, state.data.entries);
  }

  // A few computed one-liners: the single busiest month, the longest run of
  // consecutive months with at least one entry, the most-logged category, and
  // this year's count vs last year's. All derived from data Stats already has.
  function renderHighlights(root, entries) {
    if (entries.length < 2) return; // too little to say anything interesting

    // month index = year*12 + (month-1), so consecutive calendar months are
    // consecutive integers — used for both "busiest" and the streak below.
    const monthCounts = {};
    for (const e of entries) { const k = e.year * 12 + (e.month - 1); monthCounts[k] = (monthCounts[k] || 0) + 1; }
    const keys = Object.keys(monthCounts).map(Number);
    let bestK = keys[0];
    for (const k of keys) if (monthCounts[k] > monthCounts[bestK]) bestK = k;

    const sorted = [...keys].sort((a, b) => a - b);
    let streak = 1, bestStreak = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) { streak++; if (streak > bestStreak) bestStreak = streak; }
      else streak = 1;
    }

    const catCounts = countBy(entries, (e) => e.category);
    const topCat = Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a])[0];

    const thisYear = new Date().getFullYear();
    const delta = entries.filter((e) => e.year === thisYear).length
      - entries.filter((e) => e.year === thisYear - 1).length;

    const card = el("div", "card");
    // Sits directly below the Overview card (both plain .card, no grid gap
    // between them), so it needs the same 20px top margin the other stacked
    // cards get — without it the two panels butt together with no padding.
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Highlights"));
    const row = el("div", "stat-big");
    row.appendChild(statItem(`${MONTHS_SHORT[(bestK % 12) + 1]} ${Math.floor(bestK / 12)}`, `busiest month (${monthCounts[bestK]})`, "hl:busiest"));
    row.appendChild(statItem(bestStreak, "month streak", "hl:streak"));
    row.appendChild(statItem(topCat, "top category", "hl:cat"));
    row.appendChild(statItem((delta > 0 ? "+" : "") + delta, `vs ${thisYear - 1}`, "hl:yoy"));
    card.appendChild(row);
    root.appendChild(card);
  }

  // Seasonality: total entries per calendar month (Jan–Dec) summed across
  // every year, so recurring monthly patterns stand out in a way the
  // per-year heatmap grid doesn't make obvious.
  function renderMonthlyPattern(root, entries) {
    if (entries.length < 2) return;
    const counts = new Array(13).fill(0);
    for (const e of entries) counts[e.month]++;
    const max = Math.max(1, ...counts.slice(1));
    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Monthly pattern"));
    for (let m = 1; m <= 12; m++) card.appendChild(barRow(MONTHS[m], counts[m], max, "var(--accent)"));
    root.appendChild(card);
  }

  // Genre breakdown — only appears once some entries carry a genres[] field
  // (media sources fill it in on sync; older entries stay blank until
  // re-synced), so an all-blank library shows nothing rather than an empty card.
  function renderGenreBreakdown(root, entries) {
    const counts = {};
    for (const e of entries) for (const g of (e.genres || [])) counts[g] = (counts[g] || 0) + 1;
    const names = Object.keys(counts);
    if (!names.length) return;
    const card = el("div", "card");
    card.style.marginTop = "20px";
    card.appendChild(el("h2", null, "Genres"));
    const max = Math.max(1, ...Object.values(counts));
    names.sort((a, b) => counts[b] - counts[a]).slice(0, 12)
      .forEach((n) => card.appendChild(barRow(n, counts[n], max, "var(--accent)")));
    root.appendChild(card);
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
          const label = `${count} ${count === 1 ? "entry" : "entries"} · ${MONTHS_SHORT[m]} ${year}`;
          cell.title = label;
          // A lit cell jumps to that month in the Timeline (see
          // jumpToTimelineMonth). activatable makes it keyboard-reachable too.
          cell.classList.add("is-clickable");
          activatable(cell, () => jumpToTimelineMonth(year, m), "Show " + label + " in Timeline");
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
    const ratedYear = yearEntries.filter((e) => e.rating);
    const fromBacklog = yearEntries.filter((e) => e.backlogAddedAt).length;
    const highlights = el("div", "yir-highlights");
    highlights.appendChild(statItem(yearEntries.length, "entries", "yir:entries"));
    highlights.appendChild(statItem(uniqueTitles, "unique titles", "yir:unique"));
    if (topMonth) highlights.appendChild(statItem(MONTHS_SHORT[+topMonth[0]], "best month", "yir:month"));
    // avg rating as a fixed-1-decimal string so 4.2 doesn't round to 4
    if (ratedYear.length) {
      const avg = ratedYear.reduce((s, e) => s + e.rating, 0) / ratedYear.length;
      highlights.appendChild(statItem(avg.toFixed(1) + "★", "avg rating", "yir:avg"));
    }
    if (fromBacklog) highlights.appendChild(statItem(fromBacklog, "from backlog", "yir:backlog"));
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

    // Top rated — best-loved titles of the year. Dedupe by title (a replay
    // logged twice shouldn't take two slots), keeping the highest rating seen.
    if (ratedYear.length) {
      const bestByTitle = new Map();
      for (const e of ratedYear) {
        const key = e.title.trim().toLowerCase();
        const cur = bestByTitle.get(key);
        if (!cur || e.rating > cur.rating) bestByTitle.set(key, { title: e.title, rating: e.rating, category: e.category });
      }
      const top = [...bestByTitle.values()].sort((a, b) => b.rating - a.rating).slice(0, 5);
      const sec = el("div", "yir-section");
      sec.appendChild(el("h3", null, "Top rated"));
      for (const r of top) {
        const item = el("div", "yir-rated");
        const dot = el("span", "yir-rated-dot");
        dot.style.background = colorOf(r.category);
        item.appendChild(dot);
        const t = el("span", "yir-rated-title", r.title);
        t.title = r.title;
        item.appendChild(t);
        item.appendChild(ratingBadge(r.rating));
        sec.appendChild(item);
      }
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
    // Optional "Started" month for a multi-month span — a blank "— none —" by
    // default (single month). Start year defaults to the finish year, so the
    // common case (spanned within one year) is a single tap on the month.
    fillSelect($("#fStartMonth"),
      [{ value: "", label: "— none —" }].concat(MONTHS.slice(1).map((m, i) => ({ value: i + 1, label: m }))),
      editing && entry.startMonth ? entry.startMonth : "");
    $("#fStartYear").value = editing && entry.startYear ? entry.startYear
      : (editing ? entry.year : (presetDate ? presetDate.year : new Date().getFullYear()));
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
    const genresSrc = editing ? (entry.genres || []) : (fromBacklog ? (fromBacklog.genres || []) : []);
    lastSyncedEntryTitle = editing ? entry.title : (fromBacklog ? fromBacklog.title : "");
    entrySyncLocked = !!mediaSrc;
    // Seeded before setEntryCover, which honours whatever is pinned here —
    // an entry being opened fresh has nothing pinned until its own ticks are
    // read back below.
    $("#fOvrCover").checked = false;
    $("#fOvrLength").checked = false;
    setEntryCover(coverSrc, mediaId, mediaSrc, lengthSrc, genresSrc);
    initOverrideFields(OVERRIDE_FIELDS, editing ? entry : null);
    // Open when something is pinned, so it isn't invisible — see the same
    // call in openBacklogModal.
    $("#fAdvanced").open = !!(editing && entry.overrides);
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
              coverUrl: e.coverUrl || "", mediaId: e.mediaId || "", mediaSource: e.mediaSource || "", length: e.length || "", genres: e.genres || [] };
        groups.set(key, g);
      }
      g.count++;
      if (e.year > g.year || (e.year === g.year && e.month > g.month)) {
        g.title = e.title; g.category = e.category; g.year = e.year; g.month = e.month;
        g.coverUrl = e.coverUrl || ""; g.mediaId = e.mediaId || ""; g.mediaSource = e.mediaSource || ""; g.length = e.length || ""; g.genres = e.genres || [];
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
  // True once the entry's media link came from an explicit pick (a Sync-button
  // match, or a local/backlog suggestion) or was already set on an opened
  // entry. While it's set, renaming the title won't silently drop the link —
  // only the "✕ Unsync" button clears it. Mirrors how editing an existing
  // synced entry already behaves; see the guard in renderTitleSuggestions.
  let entrySyncLocked = false;

  function hasMediaSourceFor(category) {
    return !!((state.data.settings.mediaCategorySources || {})[category]);
  }

  // Strips a trailing "S1"/"Season 1"/"B1"/"Book 1" style marker some people
  // append to entry titles to tell apart e.g. individual seasons or books of
  // the same show/series — a media source's search has no idea what to do
  // with that suffix, so it's dropped before searching (the entry's own
  // title, and what gets saved, are never touched). The separator chars
  // share one repeatable class with the whitespace so a separator glued
  // directly onto the title (e.g. "Foo: Book 3") strips as cleanly as a
  // spaced one (e.g. "Foo - Book 3") — a version requiring whitespace
  // strictly before the separator left a dangling colon in the former case.
  const MEDIA_SEARCH_SUFFIX_RE = /[-–—:\s]+(?:season|s|book|b)\s*\.?\s*\d+\s*$/i;
  function stripMediaSearchSuffix(title) {
    const stripped = title.replace(MEDIA_SEARCH_SUFFIX_RE, "").trim();
    return stripped || title;
  }

  // What {mediaSource, mediaId} a picked search result should be stored as.
  // For most sources that's just the result as-is. The two "+ Steam +
  // GG.deals" combo sources are the exception: both want to land on a Steam
  // App ID where one exists, since that id — not either source's own — is
  // what drives the Steam store link and the GG.deals price lookup. Steam
  // has no search API of its own (CORS-blocked, see media.js), so each combo
  // asks its own source for the mapping:
  //   rawg-steam-gg        → RAWG's per-game store links, scanned for a Steam one
  //   steamgriddb-steam-gg → SGDB's external_platform_data for the game
  // Either can come back empty (plenty of games aren't on Steam), and then
  // the item falls back to that source's plain identity — without an App ID
  // a combo result is just a RAWG or a SteamGridDB match, and storing it
  // under the combo key would only give the rest of the app a mediaSource it
  // has no page URL for.
  // Also returns `release` — Steam's own release info for whatever App ID it
  // landed on, or null — and `summary`, the store blurb from the same
  // response (backlog items show it; the journal has no field for it). A game's date is the one field these sources are
  // worst at: RAWG dates by earliest platform (a console release years before
  // the PC one), SGDB by whatever its entry says, and neither will admit to a
  // vague "Q1 2026" the way Steam does. Callers that store release fields
  // (the backlog) merge it last so it wins; the journal ignores it, since a
  // timeline entry is dated by when *you* finished the thing.
  async function resolveMediaIdentity(r, keys) {
    const plain = { mediaSource: r.source || "", mediaId: r.id || "", release: null, summary: "" };
    if (!window.LifeLogMedia) return plain;
    const proxyUrl = (state.data.settings.steam?.proxyUrl || "").trim().replace(/\/+$/, "");
    const onSteam = async (appId) => {
      // One response, two answers: mergeRelease reads only the release keys
      // off it, the summary is pulled out separately.
      const details = await window.LifeLogMedia.fetchSteamDetails(appId, proxyUrl);
      return { mediaSource: "steam", mediaId: appId, release: details, summary: (details && details.summary) || "" };
    };
    if (r.source === "rawg-steam-gg") {
      const appId = await window.LifeLogMedia.fetchRawgSteamAppId(r.id, keys.rawg);
      return appId ? onSteam(appId) : { mediaSource: "rawg", mediaId: r.id || "", release: null, summary: "" };
    }
    if (r.source === "steamgriddb-steam-gg") {
      const appId = await window.LifeLogMedia.fetchSteamGridDbSteamAppId(r.id, keys.steamgriddb, proxyUrl);
      // The SGDB grid art already on the result is kept either way — it's the
      // reason to use this source at all, and it's stored on the item
      // independently of which id ends up identifying it.
      return appId ? onSteam(appId) : { mediaSource: "steamgriddb", mediaId: r.id || "", release: null, summary: "" };
    }
    return plain;
  }

  // Shared setup for both lookup paths below: which sources a category is
  // configured to use, and a search closure that first retries the title with
  // any trailing "(2019)"-style suffix stripped.
  function mediaSearchFor(title, category) {
    const source = (state.data.settings.mediaCategorySources || {})[category];
    if (!source || !window.LifeLogMedia) return null;
    const fallbackSource = (state.data.settings.mediaCategoryFallbackSources || {})[category];
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    // SteamGridDB is the only source that needs the CORS proxy for its own
    // search (it's CORS-blocked direct); every other source ignores this arg.
    const proxyUrl = (state.data.settings.steam?.proxyUrl || "").trim().replace(/\/+$/, "");
    const stripped = stripMediaSearchSuffix(title);
    async function trySource(src) {
      if (!src) return [];
      if (stripped !== title) {
        const results = await window.LifeLogMedia.search(stripped, src, keys, proxyUrl);
        if (results.length) return results;
      }
      return window.LifeLogMedia.search(title, src, keys, proxyUrl);
    }
    // A fallback set to the same source as the primary is nothing to fall back
    // to — searching it again would just repeat the request.
    const hasFallback = !!fallbackSource && fallbackSource !== source;
    return { source, fallbackSource: hasFallback ? fallbackSource : "", trySource };
  }

  // Looks up a category's media source for `title`, used by bulk sync and the
  // background auto-checks, which just auto-take the first result. Only if the
  // primary comes back completely empty does it fall back to the category's
  // configured fallback — the fallback fills a gap, it never overrides a
  // primary that found something.
  async function fetchMediaSuggestions(title, category) {
    const search = mediaSearchFor(title, category);
    if (!search) return [];
    try {
      const results = await search.trySource(search.source);
      if (results.length || !search.fallbackSource) return results;
      return await search.trySource(search.fallbackSource);
    } catch (e) { return []; }
  }

  // The manual "🔄 Sync" button's lookup: both sources, so you can pick from
  // either in one list — but streamed rather than awaited together. The
  // primary's matches are handed over the moment they land and the fallback's
  // follow when its (often slower, rate-limited) request finishes, instead of
  // making every lookup as slow as the worse of the two APIs.
  //
  // handlers.onStart(sourceKeys) fires synchronously, before any request is
  // awaited, so the list can say what it's doing straight away.
  // handlers.onBatch(results, sourceKey) then fires once per source, in
  // whichever order they answer. Resolves with the total number of matches.
  async function streamMediaSuggestions(title, category, handlers) {
    const search = mediaSearchFor(title, category);
    if (!search) return 0;
    const sources = [search.source];
    if (search.fallbackSource) sources.push(search.fallbackSource);
    handlers.onStart(sources);
    // Both requests go out at once and each renders the moment it lands —
    // nothing is held back to preserve an order. The APIs vary wildly (Open
    // Library takes ~2.5s where most take ~250ms), so making the quicker one
    // wait its turn just meant staring at an empty list for no reason. Each
    // is caught on its own so one source failing can't take out the other.
    let total = 0;
    await Promise.all(sources.map((src) =>
      search.trySource(src)
        .catch(() => [])
        .then((results) => {
          total += results.length;
          handlers.onBatch(results, src);
        })
    ));
    return total;
  }

  // Fills a suggestion list from a streamed lookup. A "Searching …" line naming
  // every source still in flight goes up the instant the button is pressed — a
  // click with no visible response reads as slower than it is — and each
  // source's matches are appended as it answers. Rows are only ever appended
  // above that line, so nothing already on screen moves under the pointer.
  async function renderStreamedSuggestions(list, title, category, onPick, btn) {
    list.innerHTML = "";
    const waiting = new Set();
    let pendingRow = null;
    const syncPending = () => {
      if (pendingRow) { pendingRow.remove(); pendingRow = null; }
      if (waiting.size) {
        // Deduped: a primary and fallback can share a display name (TMDB
        // covers both movies and TV), and "Searching TMDB, TMDB…" reads as a bug.
        const names = [...new Set([...waiting].map((k) => MEDIA_SOURCE_LABELS[k] || k))].join(", ");
        pendingRow = el("div", "ac-pending", "Searching " + names + "…");
        list.appendChild(pendingRow);
      }
      list.hidden = !list.children.length;
    };
    if (btn) btn.classList.add("busy");
    try {
      const total = await streamMediaSuggestions(title, category, {
        onStart: (sources) => { sources.forEach((s) => waiting.add(s)); syncPending(); },
        onBatch: (results, sourceKey) => {
          if (pendingRow) { pendingRow.remove(); pendingRow = null; }
          results.forEach((r) => list.appendChild(makeMediaAcItem(r, () => onPick(r))));
          waiting.delete(sourceKey);
          syncPending();
        },
      });
      if (!total) {
        list.hidden = true;
        const err = window.LifeLogMedia && window.LifeLogMedia.getLastError();
        toast(err ? "No matches found — " + err : "No matches found", !!err);
      }
      return total;
    } finally {
      if (btn) btn.classList.remove("busy");
    }
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
    // Which API this match came from, tagged on the right. The Sync button
    // lists a category's primary and fallback sources together, and picking
    // one silently decides the item's mediaSource — which drives its cover,
    // its store/source links, and (for Steam) its price — so the list has to
    // say which is which. Absent on the backlog/journal title suggestions,
    // whose entries carry no source.
    if (r.source) item.appendChild(el("span", "ac-source", MEDIA_SOURCE_LABELS[r.source] || r.source));
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
    // The App ID field used to exist only for a Steam-sourced category, which
    // left every other one with no way to name a Steam app by hand — no store
    // link and no GG.deals price for anything a search couldn't map to one.
    // It's always available now; what changes is where it sits. A Steam
    // category identifies its items by App ID and nothing else, so there it
    // stays in the form proper; anywhere else it's a manual override and
    // belongs in Advanced, beside the pins that protect your own values from
    // it.
    const steamField = $("#" + prefix + "SteamField");
    if (!steamField) return;
    const slot = $("#" + prefix + (isSteam ? "SteamTop" : "SteamAdv"));
    if (slot && steamField.parentNode !== slot) slot.appendChild(steamField);
    steamField.hidden = false;
  }

  // An entry has no release date of its own — it's dated by when you
  // finished the thing, which you set by hand and no sync ever touches — so
  // only the two fields a sync does rewrite are pinnable here. Same shape
  // as the backlog's spec; see app.js for what pull/push are for.
  const OVERRIDE_KEYS = ["cover", "length"];
  const OVERRIDE_FIELDS = [
    {
      key: "cover", check: "#fOvrCover", inputs: ["#fOvrCoverUrl"],
      pull() { $("#fOvrCoverUrl").value = $("#fCoverUrl").value; },
      push() { $("#fCoverUrl").value = $("#fOvrCoverUrl").value.trim(); },
    },
    {
      key: "length", check: "#fOvrLength", inputs: ["#fOvrLengthValue"],
      pull() { $("#fOvrLengthValue").value = $("#fLength").value; },
      push() { $("#fLength").value = $("#fOvrLengthValue").value.trim(); },
    },
  ];

  function isPinned(key) {
    const box = $("#fOvr" + key.charAt(0).toUpperCase() + key.slice(1));
    return !!(box && box.checked);
  }

  function setEntryCover(coverUrl, mediaId, mediaSource, length, genres) {
    // A pinned field ignores whatever is being set here — this is the one
    // place every sync path in this module funnels its results through.
    if (!isPinned("cover")) $("#fCoverUrl").value = coverUrl || "";
    $("#fMediaId").value = mediaId || "";
    $("#fMediaSource").value = mediaSource || "";
    if (!isPinned("length")) $("#fLength").value = length || "";
    $("#fGenres").value = (genres || []).join("|");
    const coverDiv = $("#entryCover");
    const coverImg = $("#entryCoverImg");
    const shownCover = $("#fCoverUrl").value;
    const shownLength = $("#fLength").value;
    refreshOverrideFields(OVERRIDE_FIELDS);
    // The length line and the store links describe the entry, not its
    // artwork, so they move to a plain row under the title when there's no
    // cover to sit under — including when the cover URL is a dead image and
    // the block below hides itself.
    const paint = (hasCover) => {
      const coverMeta = $("#entryCoverMeta"), rowMeta = $("#entryMetaRow");
      coverMeta.innerHTML = ""; rowMeta.innerHTML = "";
      if (shownLength) (hasCover ? coverMeta : rowMeta).appendChild(el("span", "bl-meta", shownLength));
      renderMediaLinks($("#entryCoverLinks"), $("#entryLinks"), hasCover, mediaSource, mediaId);
    };
    coverImg.onerror = () => { coverDiv.hidden = true; paint(false); };
    if (shownCover) { coverImg.src = shownCover; coverDiv.hidden = false; paint(true); }
    else { coverDiv.hidden = true; coverImg.src = ""; paint(false); }
    showSyncStatus("f", mediaSource);
  }

  function renderTitleSuggestions() {
    const list = $("#fTitleSuggest");
    const query = $("#fTitle").value;
    const isAdding = !$("#entryId").value;

    // If user is typing new content (not just after a local-match pick), clear cover —
    // unless it's a manually-entered Steam App ID, which isn't derived from the title.
    // Only while adding, and only if the link isn't locked by an explicit sync:
    // renaming an already-synced entry shouldn't silently drop its media link —
    // that takes an explicit "✕ Unsync" now, whether adding or editing.
    if (isAdding && !entrySyncLocked && query !== lastSyncedEntryTitle && $("#fCoverUrl").value && $("#fMediaSource").value !== "steam") {
      setEntryCover("", "", "", "", []);
    }

    const localMatches = titleSuggestions(query, $("#entryId").value || null);
    const backlogMatches = isAdding ? backlogSuggestions(query) : [];
    list.innerHTML = "";

    localMatches.forEach((m) => {
      const item = makeMediaAcItem(
        { title: m.title, coverUrl: m.coverUrl, year: null, externalRating: null },
        () => {
          lastSyncedEntryTitle = m.title;
          entrySyncLocked = true;
          $("#fTitle").value = m.title;
          if (state.data.categories.some((c) => c.name === m.category)) $("#fCategory").value = m.category;
          setEntryCover(m.coverUrl, m.mediaId, m.mediaSource, m.length || "", m.genres || []);
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
          entrySyncLocked = true;
          $("#fTitle").value = b.title;
          if (state.data.categories.some((c) => c.name === b.category)) $("#fCategory").value = b.category;
          setEntryCover(b.coverUrl || "", b.mediaId || "", b.mediaSource || "", b.length || "", b.genres || []);
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
    const keys = state.data.settings.mediaKeys || DEFAULT_SETTINGS.mediaKeys;
    await renderStreamedSuggestions(list, title, category, async (r) => {
      // Picking a match adopts that media's title, and locks the link so a
      // later title edit won't drop it (only "✕ Unsync" does).
      $("#fTitle").value = r.title;
      lastSyncedEntryTitle = r.title;
      entrySyncLocked = true;
      const extras = await window.LifeLogMedia.fetchEntryExtras(r.id, r.source, keys, r.title);
      const { mediaId, mediaSource } = await resolveMediaIdentity(r, keys);
      setEntryCover(r.coverUrl, mediaId, mediaSource, extras.length || r.length || "",
        extras.genres.length ? extras.genres : (r.genres || []));
      list.hidden = true;
    }, $("#fSyncBtn"));
  }

  function unsyncEntry() {
    setEntryCover("", "", "", "", []);
    $("#fSteamAppId").value = "";
    entrySyncLocked = false;
    $("#fTitleSuggest").hidden = true;
  }

  async function saveEntryFromForm(ev) {
    ev.preventDefault();
    // Ticked overrides land in the hidden fields first, so everything below
    // reads one set of values (see saveBacklogFromForm for the same move).
    pushOverrideValues(OVERRIDE_FIELDS);
    const overrides = readOverrideChecks(OVERRIDE_FIELDS);
    const id = $("#entryId").value;
    const fromBacklogId = $("#entryFromBacklog").value;
    const backlogItem = fromBacklogId ? state.data.backlog.find((b) => b.id === fromBacklogId) : null;
    const title = $("#fTitle").value.trim();
    const category = $("#fCategory").value;
    const year = parseInt($("#fYear").value, 10);
    const month = parseInt($("#fMonth").value, 10);
    // Optional multi-month span. Only an actually-earlier start counts; a start
    // at or after the anchor month is a single-month entry, so we store nothing
    // (and clear any prior span when editing).
    const startMonth = $("#fStartMonth").value ? parseInt($("#fStartMonth").value, 10) : null;
    const startYear = startMonth ? (parseInt($("#fStartYear").value, 10) || year) : null;
    const isSpan = !!(startMonth && (startYear * 12 + startMonth) < (year * 12 + month));
    const rating = parseInt($("#fRating").dataset.value, 10) || 0;
    const notes = $("#fNotes").value.trim();
    const coverUrl = $("#fCoverUrl").value;
    const mediaId = $("#fMediaId").value;
    const mediaSource = $("#fMediaSource").value;
    const length = $("#fLength").value;
    const genresStr = $("#fGenres").value;
    const genres = genresStr ? genresStr.split("|") : [];
    if (!title) return;
    if (id) {
      const e = state.data.entries.find((x) => x.id === id);
      Object.assign(e, { title, category, year, month, date: `${year}-${String(month).padStart(2, "0")}` });
      if (isSpan) { e.startMonth = startMonth; e.startYear = startYear; } else { delete e.startMonth; delete e.startYear; }
      if (rating) e.rating = rating; else delete e.rating;
      if (notes) e.notes = notes; else delete e.notes;
      if (coverUrl) e.coverUrl = coverUrl; else delete e.coverUrl;
      if (mediaId) e.mediaId = mediaId; else delete e.mediaId;
      if (mediaSource) e.mediaSource = mediaSource; else delete e.mediaSource;
      if (length) e.length = length; else delete e.length;
      if (genres.length) e.genres = genres; else delete e.genres;
      if (overrides) e.overrides = overrides; else delete e.overrides;
      if (backlogItem) e.backlogAddedAt = backlogItem.createdAt || null;
    } else {
      const newEntry = {
        id: uid(), title, category, year, month,
        date: `${year}-${String(month).padStart(2, "0")}`,
        createdAt: new Date().toISOString(),
      };
      if (isSpan) { newEntry.startMonth = startMonth; newEntry.startYear = startYear; }
      if (rating) newEntry.rating = rating;
      if (notes) newEntry.notes = notes;
      if (coverUrl) newEntry.coverUrl = coverUrl;
      if (mediaId) newEntry.mediaId = mediaId;
      if (mediaSource) newEntry.mediaSource = mediaSource;
      if (length) newEntry.length = length;
      if (genres.length) newEntry.genres = genres;
      if (overrides) newEntry.overrides = overrides;
      if (backlogItem) newEntry.backlogAddedAt = backlogItem.createdAt || null;
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
    if (entry.genres && entry.genres.length) item.genres = entry.genres.slice();
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
    if (Array.isArray(e.genres) && e.genres.length) out.genres = e.genres.map((g) => String(g)).slice(0, 4);
    if (e.backlogAddedAt) out.backlogAddedAt = e.backlogAddedAt;
    const overrides = sanitizeOverrides(e.overrides, OVERRIDE_KEYS);
    if (overrides) out.overrides = overrides;
    // Optional multi-month span: a start earlier than the anchor {year, month}
    // (the month the entry is filed under — where it finished). Kept only when
    // both parts are present and strictly before the anchor; missing, equal, or
    // later starts mean a single-month entry, so they're dropped here so the
    // rest of the app (spanLabel, etc.) can trust the invariant.
    const sm = +e.startMonth, sy = +e.startYear;
    if (sm >= 1 && sm <= 12 && sy && (sy * 12 + sm) < (out.year * 12 + out.month)) {
      out.startMonth = sm; out.startYear = sy;
    }
    return out;
  }

  // Compact "start–finish" label for a multi-month entry — "Jun–Aug" within a
  // year, "Nov 2024–Feb 2025" across a year boundary. Empty string when the
  // entry has no earlier start, so single-month entries render no chip.
  function spanLabel(e) {
    if (!e || !e.startMonth || !e.startYear) return "";
    if (!(e.startYear * 12 + e.startMonth < e.year * 12 + e.month)) return "";
    const sameYear = +e.startYear === +e.year;
    const s = MONTHS_SHORT[e.startMonth] + (sameYear ? "" : " " + e.startYear);
    const f = MONTHS_SHORT[e.month] + (sameYear ? "" : " " + e.year);
    return s + "–" + f;
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
    OVERRIDE_FIELDS.forEach((f) => { $(f.check).onchange = () => refreshOverrideFields(OVERRIDE_FIELDS); });
    // Live preview for a pasted cover, same as the backlog modal's.
    $("#fOvrCoverUrl").oninput = () => {
      if (!isPinned("cover")) return;
      // Written straight to the form field, since setEntryCover deliberately
      // refuses to write a pinned one from its argument.
      $("#fCoverUrl").value = $("#fOvrCoverUrl").value.trim();
      setEntryCover($("#fCoverUrl").value, $("#fMediaId").value, $("#fMediaSource").value,
        $("#fLength").value, $("#fGenres").value ? $("#fGenres").value.split("|") : []);
    };
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
    renderStreamedSuggestions,
    resolveMediaIdentity,
    updateSyncBtnVisibility,
    showSyncStatus,
    setEntryCover, // app.js's applySteamAppId repaints the entry cover through this
    // data lifecycle (app.js's normalize)
    sanitizeEntry,
    // pure helpers (exported for test/journal.test.js)
    stripMediaSearchSuffix,
    heatColor,
    spanLabel,
  };
})();
