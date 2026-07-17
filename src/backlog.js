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
    backlogSuggestions, makeMediaAcItem, fetchMediaSuggestions,
    resolveRawgSteamAppId, updateSyncBtnVisibility, showSyncStatus,
    renderCoverLinkButtons, loadBacklogPrices, applySteamAppId,
    backfillUpdatedAt, MONTHS_SHORT, DEFAULT_SETTINGS;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, renderLazySections, groupBy, colorOf,
      emptyState, emptyCoverEl, bulkActionBar, bulkCheckbox, toggleBulkItem,
      toggleBulkCategoryAll, attachLongPressSelect, openEntryModal,
      fillCategorySelect, wireCategorySelect, titleSuggestions,
      backlogSuggestions, makeMediaAcItem, fetchMediaSuggestions,
      resolveRawgSteamAppId, updateSyncBtnVisibility, showSyncStatus,
      renderCoverLinkButtons, loadBacklogPrices, applySteamAppId,
      backfillUpdatedAt, MONTHS_SHORT, DEFAULT_SETTINGS } = ctx);
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

  function getFilteredBacklog() {
    const q = state.search.trim().toLowerCase();
    const cf = state.activeCats;
    return state.data.backlog.filter((b) => {
      if (cf.size && !cf.has(b.category)) return false;
      if (q && !b.title.toLowerCase().includes(q) && !(b.notes || "").toLowerCase().includes(q)) return false;
      return true;
    });
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
      ["#bCoverUrl", "#bMediaId", "#bMediaSource", "#bSummary", "#bReleaseYear", "#bReleaseDate", "#bExternalRating", "#bGenres"]
        .forEach((id) => { const f = $(id); if (f) f.value = ""; });
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
    const results = await fetchMediaSuggestions(title, category, { combineFallback: true });
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
        // Adopt the picked media's title, and lock the link so a later title
        // edit won't drop it (only "✕ Unsync" does).
        $("#bTitle").value = r.title;
        lastSyncedBacklogTitle = r.title;
        backlogSyncLocked = true;
        $("#bCoverUrl").value = r.coverUrl || "";
        $("#bMediaId").value = r.id || "";
        $("#bMediaSource").value = r.source || "";
        $("#bSummary").value = r.summary || "";
        $("#bReleaseYear").value = r.year ? String(r.year) : "";
        $("#bReleaseDate").value = r.releaseDate || "";
        $("#bExternalRating").value = r.externalRating || "";
        $("#bGenres").value = (r.genres || []).join("|");
        $("#bLength").value = (await window.LifeLogMedia.fetchLength(r.id, r.source, keys.tmdb)) || r.length || "";
        if (r.source === "rawg-steam-gg") {
          const resolved = await resolveRawgSteamAppId(r, keys.rawg);
          $("#bMediaSource").value = resolved.mediaSource;
          $("#bMediaId").value = resolved.mediaId;
        }
        setBacklogCover();
        updateBacklogDuplicateBanner();
        list.hidden = true;
      }));
    });
    list.hidden = false;
  }

  function unsyncBacklogItem() {
    ["#bCoverUrl", "#bMediaId", "#bMediaSource", "#bSummary", "#bReleaseYear", "#bReleaseDate", "#bExternalRating", "#bLength", "#bGenres"]
      .forEach((id) => { const f = $(id); if (f) f.value = ""; });
    $("#bSteamAppId").value = "";
    backlogSyncLocked = false;
    setBacklogCover();
    $("#bTitleSuggest").hidden = true;
  }

  // releaseDate (full date, whatever precision the source actually gave —
  // see media.js) is used for an exact day-level check when available;
  // only releaseYear (always just a plain year) is ever shown in the UI.
  // Sources/manual entries without a full date fall back to year-only,
  // which reads as "unreleased" for the whole calendar year. Applies to
  // any backlog category with a release year set, not just games.
  function isUnreleased(b) {
    if (b.releaseDate && /^\d{4}-\d{2}-\d{2}/.test(b.releaseDate)) {
      const d = new Date(b.releaseDate.slice(0, 10));
      if (!isNaN(d)) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return d >= today;
      }
    }
    return !!b.releaseYear && +b.releaseYear >= new Date().getFullYear();
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

  function renderPickBar(items) {
    const eligible = eligibleForPick(items);
    if (!eligible.length) return null;
    const bar = el("div", "backlog-pick-bar");
    const btn = el("button", "btn btn-sm", "🎲 Pick something for me");
    btn.type = "button";
    btn.onclick = () => openPickModal(eligible);
    bar.appendChild(btn);
    return bar;
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
    $("#pickModalTitle").textContent = b.title;
    $("#pickModalCategory").textContent = b.category;
    const cover = $("#pickCover");
    if (b.coverUrl) { $("#pickCoverImg").src = b.coverUrl; cover.hidden = false; }
    else cover.hidden = true;
    $("#pickOpenBtn").onclick = () => { closePickModal(); openBacklogModal(b); };
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
    if (!items.length) {
      root.appendChild(emptyState("No backlog items match your filters."));
      return;
    }
    const pickBar = renderPickBar(items);
    if (pickBar) root.appendChild(pickBar);
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
            if (!!a.dropped !== !!b.dropped) return a.dropped ? 1 : -1;
            if (!a.dropped) {
              const aUp = isUnreleased(a), bUp = isUnreleased(b);
              if (aUp !== bUp) return aUp ? 1 : -1;
            }
            return (b.priority || 0) - (a.priority || 0) || a.title.localeCompare(b.title);
          });
          let sawActive = false, sepAdded = false, sawPriority = false, prioritySepAdded = false, upcomingSepAdded = false;
          sorted.forEach((b) => {
            if (b.dropped) {
              if (sawActive && !sepAdded) { list.appendChild(el("div", "backlog-dropped-sep")); sepAdded = true; }
            } else if (isUnreleased(b)) {
              if (sawActive && !upcomingSepAdded) { list.appendChild(el("div", "backlog-upcoming-sep")); upcomingSepAdded = true; }
              sawActive = true;
            } else {
              if (b.priority) sawPriority = true;
              else if (sawPriority && !prioritySepAdded) { list.appendChild(el("div", "backlog-priority-sep")); prioritySepAdded = true; }
              sawActive = true;
            }
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
    const metaParts = [];
    if (b.externalRating) metaParts.push("★ " + b.externalRating);
    if (b.releaseYear) metaParts.push(String(b.releaseYear));
    if (b.length) metaParts.push(b.length);
    const hasSteamPrice = b.mediaSource === "steam" && !!b.mediaId;
    if (metaParts.length || hasSteamPrice) {
      const metaLine = el("span", "bl-meta");
      if (metaParts.length) metaLine.appendChild(document.createTextNode(metaParts.join(" · ")));
      if (hasSteamPrice) {
        // Price arrives later (async GG.deals fetch) and gets patched into
        // this same span by applyCachedPrices — kept in one line with the
        // rest of the meta instead of its own row, sep only added if there
        // was other meta text before it, empty until a price resolves.
        const price = el("span", "bl-price");
        price.dataset.appid = b.mediaId;
        if (metaParts.length) price.dataset.sep = "1";
        metaLine.appendChild(price);
      }
      body.appendChild(metaLine);
    }
    if (b.summary) body.appendChild(el("p", "bl-summary", b.summary));
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
          item.coverUrl = r.coverUrl || "";
          item.mediaId = r.id || "";
          item.mediaSource = r.source || "";
          item.summary = r.summary || "";
          if (r.year) item.releaseYear = r.year; else delete item.releaseYear;
          if (r.releaseDate) item.releaseDate = r.releaseDate; else delete item.releaseDate;
          item.externalRating = r.externalRating || "";
          // TMDB needs a second per-title call for runtime/season data — the
          // search endpoint doesn't include it (see fetchLength in media.js).
          item.length = (await window.LifeLogMedia.fetchLength(r.id, r.source, keys.tmdb)) || r.length || "";
          if (r.genres && r.genres.length) item.genres = r.genres.slice(); else delete item.genres;
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
    const meta = $("#backlogCoverMeta");
    meta.innerHTML = "";
    showSyncStatus("b", $("#bMediaSource").value);
    if (!coverUrl) { coverDiv.hidden = true; coverImg.src = ""; $("#backlogCoverLinks").innerHTML = ""; return; }
    coverImg.onerror = () => { coverDiv.hidden = true; };
    coverImg.src = coverUrl;
    const line = [];
    const rating = $("#bExternalRating").value;
    const year = $("#bReleaseYear").value;
    const length = $("#bLength").value;
    if (rating) line.push("★ " + rating);
    if (year) line.push(year);
    if (length) line.push(length);
    const mediaSource = $("#bMediaSource").value;
    const mediaId = $("#bMediaId").value;
    const hasSteamPrice = mediaSource === "steam" && !!mediaId;
    if (line.length || hasSteamPrice) {
      const metaLine = el("span", "bl-meta");
      if (line.length) metaLine.appendChild(document.createTextNode(line.join(" · ")));
      if (hasSteamPrice) {
        const priceEl = el("span", "bl-price");
        priceEl.dataset.appid = mediaId;
        if (line.length) priceEl.dataset.sep = "1";
        metaLine.appendChild(priceEl);
      }
      meta.appendChild(metaLine);
    }
    const summary = $("#bSummary").value;
    if (summary) meta.appendChild(el("p", "bl-summary", summary));
    if (hasSteamPrice) {
      // Same lookup the backlog list uses — reuses its cache (instant if
      // this item's price was already fetched there) and patches the
      // price span above via the shared .bl-price[data-appid] selector.
      loadBacklogPrices([{ mediaSource, mediaId }]);
    }
    renderCoverLinkButtons($("#backlogCoverLinks"), mediaSource, mediaId);
    coverDiv.hidden = false;
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
    $("#bReleaseDate").value = editing ? (item.releaseDate || "") : "";
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
    const id = $("#backlogId").value;
    const title = $("#bTitle").value.trim();
    const category = $("#bCategory").value;
    const notes = $("#bNotes").value.trim();
    const coverUrl = $("#bCoverUrl").value;
    const mediaId = $("#bMediaId").value;
    const mediaSource = $("#bMediaSource").value;
    const summary = $("#bSummary").value;
    const releaseYear = $("#bReleaseYear").value;
    const releaseDate = $("#bReleaseDate").value;
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
      if (releaseDate) b.releaseDate = releaseDate; else delete b.releaseDate;
      if (externalRating) b.externalRating = externalRating; else delete b.externalRating;
      if (length) b.length = length; else delete b.length;
      if (genres.length) b.genres = genres; else delete b.genres;
      if (priority) b.priority = priority; else delete b.priority;
      if (dropped) b.dropped = true; else delete b.dropped;
    } else {
      const item = { id: uid(), title, category, createdAt: new Date().toISOString() };
      if (notes) item.notes = notes;
      if (coverUrl) item.coverUrl = coverUrl;
      if (mediaId) item.mediaId = mediaId;
      if (mediaSource) item.mediaSource = mediaSource;
      if (summary) item.summary = summary;
      if (releaseYear) item.releaseYear = parseInt(releaseYear, 10);
      if (releaseDate) item.releaseDate = releaseDate;
      if (externalRating) item.externalRating = externalRating;
      if (length) item.length = length;
      if (genres.length) item.genres = genres;
      if (priority) item.priority = priority;
      if (dropped) item.dropped = true;
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
    if (b.releaseDate) out.releaseDate = b.releaseDate;
    if (b.externalRating) out.externalRating = b.externalRating;
    if (b.length) out.length = b.length;
    if (Array.isArray(b.genres) && b.genres.length) out.genres = b.genres.map((g) => String(g)).slice(0, 4);
    if (b.priority) out.priority = +b.priority;
    if (b.dropped) out.dropped = true;
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
    // pure release-date check (exported for test/backlog.test.js)
    isUnreleased,
  };
})();
