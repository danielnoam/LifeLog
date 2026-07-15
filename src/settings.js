// LifeLog — the Settings modal: tab switching, the Data panel (local file +
// GitHub sync connections, backend info, version history), Appearance
// controls, media source/key settings incl. the Steam wishlist section's
// inputs, and the privacy/app-lock panel. Extracted from app.js; shared app
// plumbing is handed in via init(ctx) — the Steam wishlist *machinery* and
// the privacy crypto helpers stay in app.js (the lock screen uses them too)
// and arrive through ctx. Storage is read off window.LifeLogStorage directly,
// same as app.js does.
(function () {
  const Storage = window.LifeLogStorage;

  // Shared app plumbing, provided by app.js via init(ctx).
  let state, $, el, toast, persist, render, normalize, afterDataChange,
    setSyncing, refreshStorageStatus, schedulePoll,
    saveVisualSettings, savePrivacySettings,
    applyMonthLayout, applyFont, applyTheme, applyForceLayout,
    prefersReducedMotion, biometricAvailable, hashPin, randomHex, registerBiometric,
    updateSteamRetryUnresolvedButton, updateSteamBackfillRawgButton,
    syncSteamWishlist, retryUnresolvedSteamTitles, backfillRawgForSteamGames,
    syncAniListPlanning,
    DEFAULT_SETTINGS;

  function init(ctx) {
    ({ state, $, el, toast, persist, render, normalize, afterDataChange,
      setSyncing, refreshStorageStatus, schedulePoll,
      saveVisualSettings, savePrivacySettings,
      applyMonthLayout, applyFont, applyTheme, applyForceLayout,
      prefersReducedMotion, biometricAvailable, hashPin, randomHex, registerBiometric,
      updateSteamRetryUnresolvedButton, updateSteamBackfillRawgButton,
      syncSteamWishlist, retryUnresolvedSteamTitles, backfillRawgForSteamGames,
      syncAniListPlanning,
      DEFAULT_SETTINGS } = ctx);
  }

  function updateBackendInfo() {
    const info = $("#backendInfo");
    if (!info) return;
    const ghOn = Storage.githubConnected;
    const fileOn = Storage.fileConnected;
    const gi = Storage.githubInfo;
    if (ghOn && fileOn) {
      info.textContent = "Live sync: GitHub → " + gi.owner + "/" + gi.repo + ". Your local file (" + Storage.fileName + ") mirrors every save as an on-disk backup.";
    } else if (ghOn) {
      info.textContent = "Live sync: GitHub → " + gi.owner + "/" + gi.repo + ". Add a local file below for an automatic on-disk backup too.";
    } else if (fileOn) {
      info.textContent = "Saving to local file → " + Storage.fileName + ". Connect GitHub below to also sync to your phone (it becomes the live source, the file stays as backup).";
    } else {
      info.textContent = "Browser storage only. Connect a local file and/or GitHub below — data is written to every one you connect.";
    }
  }

  function updateGithubInfo() {
    const info = $("#ghInfo");
    const conn = $("#ghConnectBtn");
    const disc = $("#ghDisconnectBtn");
    const share = $("#ghShare");
    const gi = Storage.githubInfo;
    if (gi) { // prefill known fields (token is never read back)
      $("#ghRepo").value = gi.owner + "/" + gi.repo;
      $("#ghPath").value = gi.path;
      $("#ghBranch").value = gi.branch;
    }
    if (Storage.githubConnected && gi) {
      info.textContent = "Connected: " + gi.owner + "/" + gi.repo + " (" + gi.path + " on " + gi.branch + "), auto-syncing.";
      conn.textContent = "Update connection";
      disc.hidden = false;
      const frag = Storage.setupFragment();
      if (frag) {
        const link = location.origin + location.pathname + "#" + frag;
        $("#ghSetupLink").value = link;
        // warn when the current URL isn't reachable from a phone
        const localOnly = location.protocol === "file:" || /^(localhost$|127\.|0\.0\.0\.0$|\[::1\]$)/.test(location.hostname);
        $("#ghLocalWarn").hidden = !localOnly;
        // render QR (hidden when local-only or text too long for a v1-9 code)
        const qr = $("#ghQr");
        const tooLong = !localOnly && window.LifeLogQR && !window.LifeLogQR.fits(link);
        const svg = (!localOnly && window.LifeLogQR && !tooLong) ? window.LifeLogQR.svg(link, { size: 200 }) : null;
        if (svg) { qr.innerHTML = svg; qr.hidden = false; } else { qr.innerHTML = ""; qr.hidden = true; }
        $("#ghQrTooLong").hidden = !tooLong;
        share.hidden = false;
      } else share.hidden = true;
    } else {
      info.textContent = "Not connected. Syncs your log to a private GitHub repo so your phone and desktop stay in sync.";
      conn.textContent = "Connect GitHub";
      disc.hidden = true;
      share.hidden = true;
    }
  }

  // ---------- version history (Settings → Data tab) ----------
  let historyCache = []; // last fetched list, so restore can look it up

  function formatHistoryDate(iso) {
    if (!iso) return "Unknown time";
    return new Date(iso).toLocaleString();
  }

  async function updateHistoryPanel() {
    await refreshHistoryList();
    refreshTrashList();
  }

  // ---------- recently deleted (derived from local history, not a separate store) ----------
  // Only collections a "delete" is a normal, everyday action on — not
  // categories, whose removal usually reassigns/cascades into other items
  // rather than being a simple "oops, undo" case.
  const TRASH_COLLECTIONS = {
    entries: { kind: "Entry", label: (e) => e.title },
    backlog: { kind: "Backlog item", label: (b) => b.title },
    financeEntries: { kind: "Finance entry", label: (f) => f.note || f.category },
    recurringExpenses: { kind: "Recurring expense", label: (r) => r.note || r.category },
  };

  // Walks adjacent pairs of local history snapshots (oldest→newest) to spot
  // ids present in one save and gone in the next — that's a deletion, and
  // the previous snapshot still has the item's full data. Anything since
  // re-added (its id is back in the live state.data) is dropped from the
  // list; no separate trash store, no separate retention window — it rides
  // on the same capped local history everything else here already uses.
  function computeRecentlyDeleted() {
    const local = historyCache
      .filter((e) => e.source === "local" && e.snapshot)
      .slice()
      .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
    const deleted = new Map(); // "key:id" -> { key, item, deletedAt }
    for (let i = 1; i < local.length; i++) {
      const prev = local[i - 1].snapshot, next = local[i].snapshot;
      for (const key of Object.keys(TRASH_COLLECTIONS)) {
        const nextIds = new Set((next[key] || []).map((x) => x.id));
        for (const item of prev[key] || []) {
          if (!nextIds.has(item.id)) deleted.set(key + ":" + item.id, { key, item, deletedAt: local[i].savedAt });
        }
      }
    }
    const out = [];
    for (const d of deleted.values()) {
      if (!(state.data[d.key] || []).some((x) => x.id === d.item.id)) out.push(d);
    }
    out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return out;
  }

  function refreshTrashList() {
    const empty = $("#trashEmptyState");
    const list = $("#trashList");
    list.innerHTML = "";
    const items = computeRecentlyDeleted();
    empty.hidden = !!items.length;
    items.forEach((d) => {
      const meta = TRASH_COLLECTIONS[d.key];
      const row = el("div", "history-row");
      const head = el("div", "history-row-head");
      head.appendChild(el("span", "history-date", meta.kind + " · " + formatHistoryDate(d.deletedAt)));
      const btn = el("button", "btn btn-small", "Restore");
      btn.type = "button";
      btn.onclick = () => restoreDeletedItem(d);
      head.appendChild(btn);
      row.appendChild(head);
      row.appendChild(el("div", "history-msg", meta.label(d.item) || "(untitled)"));
      list.appendChild(row);
    });
  }

  async function restoreDeletedItem(d) {
    const meta = TRASH_COLLECTIONS[d.key];
    const label = meta.label(d.item) || "(untitled)";
    if (!confirm(`Restore "${label}"?`)) return;
    if ((state.data[d.key] || []).some((x) => x.id === d.item.id)) {
      toast("Already restored", true);
      refreshTrashList();
      return;
    }
    state.data[d.key] = state.data[d.key] || [];
    state.data[d.key].push({ ...d.item, updatedAt: new Date().toISOString() });
    render();
    await persist();
    refreshTrashList();
    toast("Restored " + label);
  }

  // Normalizes a local history entry ({id, savedAt, summary, snapshot}) and
  // a GitHub commit ({sha, date, message}) into one common shape so they can
  // share a single list and restore path.
  function normalizeHistoryEntry(e, source) {
    if (source === "local") return { id: e.id, savedAt: e.savedAt, summary: e.summary, source, snapshot: e.snapshot };
    return { id: "gh-" + e.sha, savedAt: e.date, summary: e.message || "(no message)", source: "github", sha: e.sha };
  }

  async function refreshHistoryList() {
    const empty = $("#historyEmptyState");
    const controls = $("#historyControls");
    const status = $("#historyStatus");
    const list = $("#historyList");
    status.textContent = "Loading…";
    list.innerHTML = "";
    try {
      const local = (await Storage.listLocalHistory()).map((e) => normalizeHistoryEntry(e, "local"));
      let combined = local;
      // GitHub's deeper commit log fills in anything older than local's
      // window (local history is capped locally; GitHub's isn't) — it's
      // never the primary source anymore, just an extension of it.
      if (Storage.githubConnected) {
        try {
          const oldestLocal = local.length ? local[local.length - 1].savedAt : null;
          const ghExtra = (await Storage.listHistory())
            .map((c) => normalizeHistoryEntry(c, "github"))
            .filter((c) => !oldestLocal || c.savedAt < oldestLocal);
          combined = local.concat(ghExtra);
        } catch (e) { /* GitHub unreachable — local history still shown below */ }
      }
      combined.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
      historyCache = combined;

      empty.hidden = !!combined.length;
      controls.hidden = !combined.length;
      if (!combined.length) { status.textContent = ""; return; }

      status.textContent = `Showing the last ${combined.length} save${combined.length === 1 ? "" : "s"}.`;
      combined.forEach((c, i) => {
        const row = el("div", "history-row");
        const head = el("div", "history-row-head");
        head.appendChild(el("span", "history-date", formatHistoryDate(c.savedAt)));
        if (i === 0) head.appendChild(el("span", "history-badge", "Current"));
        const btn = el("button", "btn btn-small", i === 0 ? "Current" : "Restore");
        btn.type = "button";
        btn.disabled = i === 0;
        btn.onclick = () => restoreHistoryVersion(c);
        head.appendChild(btn);
        row.appendChild(head);
        row.appendChild(el("div", "history-msg", c.summary || "(no summary)"));
        list.appendChild(row);
      });
    } catch (e) {
      empty.hidden = true;
      controls.hidden = false;
      status.textContent = "";
      list.innerHTML = "";
      list.appendChild(el("p", "warn", "Couldn't load history: " + (e.message || e)));
    }
  }

  async function restoreHistoryVersion(entry) {
    const when = formatHistoryDate(entry.savedAt);
    if (!confirm(
      "Restore the version from " + when + "?\n\n" +
      "This loads that version's data and saves it as your new current state " +
      "(it becomes a new save — nothing already in your history is deleted)."
    )) return;
    try {
      setSyncing("Restoring…");
      const data = entry.snapshot ? structuredClone(entry.snapshot) : await Storage.getVersion(entry.sha);
      state.data = normalize(data);
      afterDataChange();
      await persist();
      await refreshHistoryList();
      refreshTrashList();
      toast("Restored version from " + when);
    } catch (e) {
      toast("Restore failed: " + (e.message || e), true);
      refreshStorageStatus();
    }
  }

  function updateFileInfo() {
    const info = $("#fileInfo");
    const connect = $("#connectFileBtn");
    const recon = $("#reconnectFileBtn");
    const disc = $("#disconnectFileBtn");
    if (!Storage.fsSupported) {
      info.innerHTML =
        "Saving to a chosen file isn't enabled in this browser." +
        "<br>• Chrome and Edge support it out of the box." +
        "<br>• Some browsers (e.g. Brave) ship it off by default — enable it from that browser's flags page (search “File System Access API”, set to Enabled, relaunch), then reload." +
        "<br>• Until then your data is saved in this browser only — use <strong>Export JSON</strong> for backups.";
      connect.hidden = true; recon.hidden = true; disc.hidden = true;
      return;
    }
    if (Storage.fileName && !Storage.needsReconnect) {
      info.textContent = "Connected: " + Storage.fileName + " (auto-saving here).";
      connect.textContent = "Change data file…";
      recon.hidden = true; disc.hidden = false;
    } else if (Storage.fileName && Storage.needsReconnect) {
      info.textContent = "File “" + Storage.fileName + "” needs permission again (browsers ask after a restart).";
      recon.hidden = false; disc.hidden = false;
      connect.textContent = "Choose a different file…";
    } else {
      info.textContent = "No file connected. Data is auto-saved in this browser only.";
      connect.textContent = "Choose data file…";
      recon.hidden = true; disc.hidden = true;
    }
  }

  function setSettingsTab(name) {
    document.querySelectorAll(".stab").forEach((t) => t.classList.toggle("active", t.dataset.stab === name));
    document.querySelectorAll(".settings-panel").forEach((p) => {
      const isActive = p.dataset.panel === name;
      p.classList.toggle("active", isActive);
      if (!isActive && p.contains(document.activeElement)) document.activeElement.blur();
      if (isActive && !prefersReducedMotion()) {
        p.classList.remove("view-fade-in");
        void p.offsetWidth; // force reflow so the animation replays
        p.classList.add("view-fade-in");
      }
    });
  }

  function renderMediaCatRows() {
    const container = $("#mediaCatRows");
    if (!container) return;
    container.innerHTML = "";
    const sources = [
      { value: "", label: "None" },
      { value: "rawg", label: "RAWG (games)" },
      { value: "rawg-steam-gg", label: "RAWG + Steam + GG.deals (games)" },
      { value: "steamgriddb", label: "SteamGridDB (games)" },
      { value: "steam", label: "Steam (manual App ID)" },
      { value: "tmdb-movie", label: "TMDB (movie)" },
      { value: "tmdb-tv", label: "TMDB (TV)" },
      { value: "anilist-anime", label: "AniList (anime)" },
      { value: "jikan-anime", label: "Jikan (anime)" },
      { value: "anilist-manga", label: "AniList (manga)" },
      { value: "jikan-manga", label: "Jikan (manga)" },
      { value: "openlibrary", label: "Open Library (books)" },
      { value: "googlebooks", label: "Google Books (books)" },
      { value: "musicbrainz", label: "MusicBrainz (music)" },
    ];
    // Fallback dropdown offers every source (minus whatever's picked as
    // primary and minus Steam, which has no search to fall back to/from —
    // manual App ID only) — no restriction to "compatible" types, so it's
    // on you to leave it at "No fallback" for a category where a second
    // source doesn't make sense (e.g. Movies, until something else covers TMDB).
    const fallbackSources = sources.filter((s) => s.value && s.value !== "steam" && s.value !== "rawg-steam-gg");
    if (!state.data.categories.length) {
      container.appendChild(el("p", "muted", "No categories yet — add categories first."));
      return;
    }
    for (const cat of state.data.categories) {
      const row = el("div", "media-cat-row");
      row.appendChild(el("span", "media-cat-name", cat.name));

      const selWrap = el("div", "media-cat-sels");
      const sel = el("select", "media-cat-sel");
      sources.forEach((s) => {
        const opt = el("option", null, s.label);
        opt.value = s.value;
        if ((state.data.settings.mediaCategorySources || {})[cat.name] === s.value) opt.selected = true;
        sel.appendChild(opt);
      });

      const arrow = el("span", "media-cat-arrow", "→");
      const fallbackSel = el("select", "media-cat-sel media-cat-fallback");
      const noneOpt = el("option", null, "No fallback");
      noneOpt.value = "";
      fallbackSel.appendChild(noneOpt);
      fallbackSources.forEach((s) => {
        const opt = el("option", null, s.label);
        opt.value = s.value;
        if ((state.data.settings.mediaCategoryFallbackSources || {})[cat.name] === s.value) opt.selected = true;
        fallbackSel.appendChild(opt);
      });

      sel.onchange = async () => {
        if (!state.data.settings.mediaCategorySources) state.data.settings.mediaCategorySources = {};
        state.data.settings.mediaCategorySources[cat.name] = sel.value;
        await persist();
      };
      fallbackSel.onchange = async () => {
        if (!state.data.settings.mediaCategoryFallbackSources) state.data.settings.mediaCategoryFallbackSources = {};
        state.data.settings.mediaCategoryFallbackSources[cat.name] = fallbackSel.value;
        await persist();
      };

      selWrap.appendChild(sel);
      selWrap.appendChild(arrow);
      selWrap.appendChild(fallbackSel);
      row.appendChild(selWrap);
      container.appendChild(row);
    }
  }

  function renderSteamWishlistCategoryOptions() {
    const sel = $("#steamWishlistCategory");
    if (!sel) return;
    const current = state.data.settings.steam?.wishlistCategory || sel.value;
    sel.innerHTML = "";
    state.data.categories.forEach((cat) => {
      const opt = el("option", null, cat.name);
      opt.value = cat.name;
      sel.appendChild(opt);
    });
    if (current && state.data.categories.some((c) => c.name === current)) sel.value = current;
  }

  // Fills one of the two AniList category selects. Unlike the Steam picker,
  // each leads with a "Don't import" blank option so a user can sync only
  // anime, only manga, or both.
  function renderAniListCategoryOptions(selId, current) {
    const sel = $(selId);
    if (!sel) return;
    const cur = current || sel.value;
    sel.innerHTML = "";
    const none = el("option", null, "Don't import");
    none.value = "";
    sel.appendChild(none);
    state.data.categories.forEach((cat) => {
      const opt = el("option", null, cat.name);
      opt.value = cat.name;
      sel.appendChild(opt);
    });
    sel.value = (cur && state.data.categories.some((c) => c.name === cur)) ? cur : "";
  }

  function updateMediaSettings() {
    if (!$("#rawgKey")) return;
    $("#rawgKey").value = state.data.settings.mediaKeys?.rawg || "";
    $("#tmdbKey").value = state.data.settings.mediaKeys?.tmdb || "";
    $("#ggdealsKey").value = state.data.settings.mediaKeys?.ggdeals || "";
    $("#steamgriddbKey").value = state.data.settings.mediaKeys?.steamgriddb || "";
    $("#steamProxyUrl").value = state.data.settings.steam?.proxyUrl || "";
    $("#steamId64").value = state.data.settings.steam?.steamId || "";
    $("#steamAutoSyncDays").value = state.data.settings.steam?.autoSyncDays || "0";
    $("#anilistUserName").value = state.data.settings.anilist?.userName || "";
    $("#anilistAutoSyncDays").value = state.data.settings.anilist?.autoSyncDays || "0";
    updateSteamRetryUnresolvedButton();
    updateSteamBackfillRawgButton();
    renderSteamWishlistCategoryOptions();
    renderAniListCategoryOptions("#anilistAnimeCategory", state.data.settings.anilist?.animeCategory);
    renderAniListCategoryOptions("#anilistMangaCategory", state.data.settings.anilist?.mangaCategory);
    renderMediaCatRows();
  }

  function openSettings() {
    setSettingsTab("storage");
    updateBackendInfo();
    updateFileInfo();
    updateGithubInfo();
    updateHistoryPanel();
    $("#ghPollInterval").value = String(state.visual.pollInterval);
    $("#monthMin").value = state.visual.monthMinWidth;
    $("#monthMax").value = state.visual.monthMaxWidth;
    $("#fontFamily").value = state.visual.fontFamily;
    $("#themeSelect").value = state.visual.theme || "default";
    $("#forceLayout").value = state.visual.forceLayout || "none";
    $("#currency").value = state.data.settings.currency;
    $("#timelineCoverSize").value = state.visual.timelineCoverSize || "small";
    $("#backlogCoverSize").value = state.visual.backlogCoverSize || "big";
    updateMediaSettings();
    updatePrivacySettings();
    $("#settingsModal").hidden = false;
  }

  // ---------- privacy / app lock settings ----------
  let bioAvailable = null; // cached after the first check (per page load)

  async function updatePrivacySettings() {
    $("#privacyEnabled").checked = !!state.privacy.enabled;
    $("#privacyGrace").value = String(state.privacy.graceMinutes || 0);
    refreshPrivacyUI();

    if (bioAvailable === null) bioAvailable = await biometricAvailable();
    $("#setBioBtn").hidden = !bioAvailable;
    $("#privacyBioUnavailable").hidden = bioAvailable;
  }

  function refreshPrivacyUI() {
    $("#privacyPinStatus").textContent = state.privacy.pinHash
      ? "A PIN is set on this device." : "No PIN set yet.";
    $("#setPinBtn").textContent = state.privacy.pinHash ? "Change PIN" : "Set PIN";
    $("#removePinBtn").hidden = !state.privacy.pinHash;

    $("#setBioBtn").disabled = !state.privacy.pinHash;
    $("#setBioBtn").title = state.privacy.pinHash ? "" : "Set a PIN first";
    $("#privacyBioStatus").textContent = state.privacy.credentialId
      ? "Fingerprint/Face ID is set up on this device."
      : (state.privacy.pinHash ? "Not set up yet." : "Set a PIN first to enable this.");
    $("#removeBioBtn").hidden = !state.privacy.credentialId;
  }

  function hidePinForm() {
    $("#privacyPinForm").hidden = true;
    $("#setPinBtn").hidden = false;
    $("#savePinBtn").hidden = true;
    $("#cancelPinBtn").hidden = true;
    $("#newPin").value = ""; $("#confirmPin").value = "";
  }

  // ---------- appearance / behavior controls ----------
  function onPollIntervalChange() {
    state.visual.pollInterval = parseInt($("#ghPollInterval").value, 10) || 0;
    saveVisualSettings(state.visual);
    schedulePoll();
  }

  function onLayoutChange() {
    const min = Math.max(80, Math.min(600, parseInt($("#monthMin").value, 10) || 180));
    let max = parseInt($("#monthMax").value, 10);
    if (isNaN(max) || max < 0) max = 0;
    state.visual.monthMinWidth = min;
    state.visual.monthMaxWidth = max;
    saveVisualSettings(state.visual);
    applyMonthLayout();
  }
  function onFontChange() {
    state.visual.fontFamily = $("#fontFamily").value;
    saveVisualSettings(state.visual);
    applyFont();
  }
  function onForceLayoutChange() {
    state.visual.forceLayout = $("#forceLayout").value;
    saveVisualSettings(state.visual);
    applyForceLayout();
  }
  function onThemeChange() {
    state.visual.theme = $("#themeSelect").value;
    saveVisualSettings(state.visual);
    applyTheme();
  }
  function onTimelineCoverSizeChange() {
    state.visual.timelineCoverSize = $("#timelineCoverSize").value;
    saveVisualSettings(state.visual);
    render();
  }
  function onBacklogCoverSizeChange() {
    state.visual.backlogCoverSize = $("#backlogCoverSize").value;
    saveVisualSettings(state.visual);
    render();
  }
  function closeSettings() { $("#settingsModal").hidden = true; }

  // ---------- storage connections ----------
  async function connectFile() {
    try {
      const name = await Storage.connectFile(state.data);
      refreshStorageStatus();
      updateBackendInfo(); updateFileInfo();
      toast(Storage.githubConnected ? "Local backup file connected: " + name : "Connected & saved to " + name);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      toast("Couldn't connect file: " + (e.message || e), true);
    }
  }
  async function reconnectFile() {
    const ok = await Storage.reconnect();
    if (ok) {
      const fresh = await (await Storage.load()).data; // re-read from file
      if (fresh) { state.data = normalize(fresh); afterDataChange(); }
      await persist();
      refreshStorageStatus(); updateBackendInfo(); updateFileInfo();
      toast("Reconnected");
    } else toast("Permission denied", true);
  }
  async function disconnectFile() {
    await Storage.disconnect();
    refreshStorageStatus();
    updateBackendInfo(); updateFileInfo();
    toast(Storage.githubConnected ? "Local backup file disconnected (GitHub still syncing)" : "Local file disconnected (browser storage only)");
  }

  async function connectGithub() {
    const token = $("#ghToken").value.trim();
    if (!token) { toast("Paste your access token", true); return; }
    // Repo is optional (Advanced); blank → owner derived from token, repo = lifelog-data.
    let owner = "", repo = "";
    const repoRaw = $("#ghRepo").value.trim();
    if (repoRaw) {
      const m = repoRaw.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
      if (!m) { toast("Advanced repo must be owner/repo", true); return; }
      owner = m[1]; repo = m[2];
    }
    const cfg = {
      owner: owner, repo: repo,
      path: $("#ghPath").value.trim() || "lifelog.json",
      branch: $("#ghBranch").value.trim() || "main",
      token: token,
    };
    try {
      toast("Connecting to GitHub…");
      const res = await Storage.connectGithub(cfg, state.data);
      if (res.existed && res.data && Array.isArray(res.data.entries)) {
        const useRemote = confirm(
          "That repo already has a log with " + res.data.entries.length + " entries.\n\n" +
          "OK = load it onto this device.\n" +
          "Cancel = overwrite it with this device's " + state.data.entries.length + " entries."
        );
        if (useRemote) { state.data = normalize(res.data); afterDataChange(); }
        else { await persist(); } // overwrite remote with local
      }
      $("#ghToken").value = "";
      refreshStorageStatus();
      updateBackendInfo(); updateGithubInfo(); updateFileInfo(); updateHistoryPanel();
      schedulePoll();
      toast(Storage.fileConnected ? "GitHub connected — syncing, file kept as backup" : "GitHub connected — syncing here");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      toast("GitHub: " + (e.message || e), true);
    }
  }

  async function disconnectGithub() {
    await Storage.disconnectGithub();
    refreshStorageStatus();
    updateBackendInfo(); updateGithubInfo(); updateFileInfo(); updateHistoryPanel();
    schedulePoll();
    toast(Storage.fileConnected ? "GitHub disconnected (still saving to local file)" : "GitHub disconnected (browser storage only)");
  }

  // ---------- events ----------
  // Settings-modal DOM wiring; called from app.js's wire(). Journal
  // import/export buttons also live in the Settings modal but are wired
  // from app.js, where those handlers live.
  function wire() {
    $("#settingsBtn").onclick = openSettings;
    $("#closeSettingsBtn").onclick = closeSettings;
    document.querySelectorAll(".stab").forEach((t) => t.onclick = () => setSettingsTab(t.dataset.stab));
    $("#connectFileBtn").onclick = connectFile;
    $("#reconnectFileBtn").onclick = reconnectFile;
    $("#disconnectFileBtn").onclick = disconnectFile;
    $("#ghConnectBtn").onclick = connectGithub;
    $("#ghDisconnectBtn").onclick = disconnectGithub;
    $("#historyRefreshBtn").onclick = updateHistoryPanel;
    $("#ghPollInterval").onchange = onPollIntervalChange;
    $("#ghCopyLinkBtn").onclick = async () => {
      const v = $("#ghSetupLink").value;
      try { await navigator.clipboard.writeText(v); toast("Setup link copied"); }
      catch (e) { $("#ghSetupLink").select(); try { document.execCommand("copy"); } catch (_) {} toast("Setup link copied"); }
    };
    $("#monthMin").onchange = onLayoutChange;
    $("#monthMax").onchange = onLayoutChange;
    $("#fontFamily").onchange = onFontChange;
    $("#themeSelect").onchange = onThemeChange;
    $("#forceLayout").onchange = onForceLayoutChange;
    $("#timelineCoverSize").onchange = onTimelineCoverSizeChange;
    $("#backlogCoverSize").onchange = onBacklogCoverSizeChange;
    $("#currency").onchange = async () => {
      state.data.settings.currency = $("#currency").value;
      render();
      await persist();
    };
    const setMediaKey = async (field, value) => {
      if (!state.data.settings.mediaKeys) state.data.settings.mediaKeys = { ...DEFAULT_SETTINGS.mediaKeys };
      state.data.settings.mediaKeys[field] = value;
      await persist();
    };
    $("#rawgKey").oninput = () => setMediaKey("rawg", $("#rawgKey").value);
    $("#tmdbKey").oninput = () => setMediaKey("tmdb", $("#tmdbKey").value);
    $("#ggdealsKey").oninput = () => setMediaKey("ggdeals", $("#ggdealsKey").value);
    $("#steamgriddbKey").oninput = () => setMediaKey("steamgriddb", $("#steamgriddbKey").value);

    const setSteamSetting = async (field, value) => {
      if (!state.data.settings.steam) state.data.settings.steam = { ...DEFAULT_SETTINGS.steam };
      state.data.settings.steam[field] = value;
      await persist();
    };
    $("#steamProxyUrl").oninput = () => setSteamSetting("proxyUrl", $("#steamProxyUrl").value.trim());
    $("#steamId64").oninput = () => setSteamSetting("steamId", $("#steamId64").value.trim());
    $("#steamWishlistCategory").onchange = () => setSteamSetting("wishlistCategory", $("#steamWishlistCategory").value);
    $("#steamAutoSyncDays").onchange = () => setSteamSetting("autoSyncDays", $("#steamAutoSyncDays").value);
    $("#steamWishlistSyncBtn").onclick = syncSteamWishlist;
    $("#steamRetryUnresolvedBtn").onclick = retryUnresolvedSteamTitles;
    $("#steamBackfillRawgBtn").onclick = backfillRawgForSteamGames;

    const setAniListSetting = async (field, value) => {
      if (!state.data.settings.anilist) state.data.settings.anilist = { ...DEFAULT_SETTINGS.anilist };
      state.data.settings.anilist[field] = value;
      await persist();
    };
    $("#anilistUserName").oninput = () => setAniListSetting("userName", $("#anilistUserName").value.trim());
    $("#anilistAnimeCategory").onchange = () => setAniListSetting("animeCategory", $("#anilistAnimeCategory").value);
    $("#anilistMangaCategory").onchange = () => setAniListSetting("mangaCategory", $("#anilistMangaCategory").value);
    $("#anilistAutoSyncDays").onchange = () => setAniListSetting("autoSyncDays", $("#anilistAutoSyncDays").value);
    $("#anilistSyncBtn").onclick = syncAniListPlanning;

    $("#privacyEnabled").onchange = () => {
      const checked = $("#privacyEnabled").checked;
      if (checked && !state.privacy.pinHash) {
        toast("Set a PIN first", true);
        $("#privacyEnabled").checked = false;
        return;
      }
      state.privacy.enabled = checked;
      savePrivacySettings();
    };
    $("#privacyGrace").onchange = () => {
      state.privacy.graceMinutes = parseInt($("#privacyGrace").value, 10) || 0;
      savePrivacySettings();
    };
    $("#setPinBtn").onclick = () => {
      $("#privacyPinForm").hidden = false;
      $("#setPinBtn").hidden = true;
      $("#savePinBtn").hidden = false;
      $("#cancelPinBtn").hidden = false;
      $("#newPin").focus();
    };
    $("#cancelPinBtn").onclick = hidePinForm;
    $("#savePinBtn").onclick = async () => {
      const a = $("#newPin").value, b = $("#confirmPin").value;
      if (!/^\d{4,8}$/.test(a)) { toast("PIN must be 4–8 digits", true); return; }
      if (a !== b) { toast("PINs don't match", true); return; }
      const salt = randomHex(16);
      state.privacy.pinSalt = salt;
      state.privacy.pinHash = await hashPin(a, salt);
      savePrivacySettings();
      hidePinForm();
      refreshPrivacyUI();
      toast("PIN set");
    };
    $("#removePinBtn").onclick = () => {
      const alsoBio = !!state.privacy.credentialId;
      const msg = alsoBio
        ? "Remove the PIN from this device? Fingerprint/Face ID requires a PIN fallback, so this will remove that too."
        : "Remove the PIN from this device?";
      if (!confirm(msg)) return;
      state.privacy.pinHash = null; state.privacy.pinSalt = null;
      if (alsoBio) state.privacy.credentialId = null;
      state.privacy.enabled = false;
      savePrivacySettings();
      refreshPrivacyUI();
    };
    $("#setBioBtn").onclick = async () => {
      if (!state.privacy.pinHash) { toast("Set a PIN first", true); return; }
      try {
        state.privacy.credentialId = await registerBiometric();
        savePrivacySettings();
        refreshPrivacyUI();
        toast("Fingerprint/Face ID set up");
      } catch (e) { toast("Couldn't set up: " + (e.message || e), true); }
    };
    $("#removeBioBtn").onclick = () => {
      if (!confirm("Remove Fingerprint/Face ID from this device?")) return;
      state.privacy.credentialId = null;
      savePrivacySettings();
      refreshPrivacyUI();
    };
  }

  window.LifeLogSettings = {
    init,
    wire,
    openSettings,
    closeSettings, // Escape handler in app.js
  };
})();
