// LifeLog — the Settings modal: its list of pages and search, the Sync page (local file +
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
    setSyncing, refreshStorageStatus, versionBehind, APP_VERSION, schedulePoll,
    saveVisualSettings, savePrivacySettings, attachSwipe,
    applyMonthLayout, applyFont, applyTheme, applyForceLayout,
    prefersReducedMotion, biometricAvailable, biometricState, hashPin, randomHex, registerBiometric,
    isMobileLayout, switchToView,
    updateSteamRetryUnresolvedButton, updateSteamBackfillRawgButton,
    syncSteamWishlist, retryUnresolvedSteamTitles, backfillRawgForSteamGames,
    syncAniListPlanning,
    refreshUpcomingReleases, updateRefreshReleasesButton,
    DEFAULT_SETTINGS, VIEW_TOGGLES, settleDisabled;

  function init(ctx) {
    ({ state, $, el, toast, persist, render, normalize, afterDataChange,
      setSyncing, refreshStorageStatus, schedulePoll, versionBehind, APP_VERSION,
      saveVisualSettings, savePrivacySettings, attachSwipe,
      applyMonthLayout, applyFont, applyTheme, applyForceLayout,
      prefersReducedMotion, biometricAvailable, biometricState, hashPin, randomHex, registerBiometric,
      isMobileLayout, switchToView,
      VIEW_TOGGLES, settleDisabled,
      updateSteamRetryUnresolvedButton, updateSteamBackfillRawgButton,
      syncSteamWishlist, retryUnresolvedSteamTitles, backfillRawgForSteamGames,
      syncAniListPlanning,
      refreshUpcomingReleases, updateRefreshReleasesButton,
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

  let ghEditing = false;
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
    const on = !!(Storage.githubConnected && gi);
    // Connected, the token box is only for changing the connection, so it
    // waits behind a button, and the how-to goes: it's for getting here.
    if (!on) ghEditing = false;
    $(".gh-fields").classList.toggle("connected", on);
    $(".gh-fields").hidden = on && !ghEditing;
    $("#ghEditBtn").hidden = !on || ghEditing;
    $("#ghDisconnectSection").hidden = !on;
    if (on) {
      info.textContent = "Connected: " + gi.owner + "/" + gi.repo + " (" + gi.path + " on " + gi.branch + "), auto-syncing.";
      conn.textContent = "Update connection";
      disc.hidden = false;
      const frag = Storage.setupFragment();
      if (frag) {
        // Inside the Android app this page lives at https://localhost, which
        // another device can't open — the link points at the web copy the
        // app was built from instead.
        const webUrl = window.LifeLogPlatform && window.LifeLogPlatform.webUrl();
        const link = (webUrl || location.origin + location.pathname) + "#" + frag;
        $("#ghSetupLink").value = link;
        // warn when the current URL isn't reachable from a phone
        const localOnly = !webUrl && (location.protocol === "file:" || /^(localhost$|127\.|0\.0\.0\.0$|\[::1\]$)/.test(location.hostname));
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

  // ---------- version history (Settings → History) ----------
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
    notes: { kind: "Note", label: (n) => (n.text || "").split("\n")[0].slice(0, 60) },
    todos: { kind: "To-do", label: (t) => t.text },
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
        if (i > 0) {
          const only = el("button", "btn btn-small", "Settings only");
          only.type = "button";
          only.title = "Fill in settings that are empty now from this save, and change nothing else";
          only.onclick = () => restoreSettingsFrom(c);
          head.appendChild(only);
        }
        // Undoing needs the save before it, to know what the change was, so
        // the oldest one listed can't be undone.
        const older = combined[i + 1];
        if (older) {
          const undo = el("button", "btn btn-small", "Undo");
          undo.type = "button";
          undo.title = "Undo just this change, and keep everything since";
          undo.onclick = () => undoHistoryChange(c, older);
          head.appendChild(undo);
        }
        const btn = el("button", "btn btn-small", i === 0 ? "Current" : "Restore");
        btn.type = "button";
        btn.disabled = i === 0;
        btn.title = i === 0 ? "" : "Go back to exactly this save, dropping everything since";
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

  // ---------- undoing one change (0.185.0) ----------
  // The toast's Undo lasts eight seconds; this is the one for the next
  // morning. Restore rolls everything back to a save, which takes every later
  // change with it. Undo takes back only what one save changed: a three-way
  // merge with that save as the ancestor, today's data as one side and the
  // save before it as the other — so exactly the difference between the two
  // is reversed onto today, and anything since stays. Something edited again
  // later keeps its later edit, because the merge's rules for "both sides
  // changed it" already decide that.
  async function undoHistoryChange(entry, older) {
    const when = formatHistoryDate(entry.savedAt);
    let after, before;
    try {
      [after, before] = await Promise.all([
        entry.snapshot || Storage.getVersion(entry.sha),
        older.snapshot || Storage.getVersion(older.sha),
      ]);
    } catch (e) { toast("Couldn't read that save: " + (e.message || e), true); return; }
    const M = window.LifeLogMerge;
    const next = normalize(M.mergeAllSources(normalize(structuredClone(after)), state.data, normalize(structuredClone(before))));
    const summary = M.diffSnapshots(state.data, next);
    if (summary === "No changes") {
      toast("Nothing to undo there — later changes have already replaced it");
      return;
    }
    if (!confirm("Undo the change from " + when + "?\n\n" +
      "It was: " + (entry.summary || "(no summary)") + "\n" +
      "Undoing it: " + summary + "\n\n" +
      "Everything since stays as it is.")) return;
    const was = state.data;
    state.data = next;
    afterDataChange();
    await persist();
    await refreshHistoryList();
    refreshTrashList();
    toast("Undid the change from " + when, false, {
      label: "Put it back",
      onClick: async () => { state.data = was; afterDataChange(); await persist(); await refreshHistoryList(); },
    });
  }

  // ---------- bringing back settings a bad merge emptied ----------
  // Restore above rolls the whole log back to a save, which is the wrong tool
  // for "my API keys are gone": everything added since would go with it.
  // These fill in only the settings that are blank now (see
  // LifeLogMerge.fillBlankSettings) — the recovery for 0.174.0, where joining
  // by setup link could push a fresh install's empty settings everywhere.
  const SETTING_LABELS = {
    "mediaKeys.rawg": "RAWG API key", "mediaKeys.tmdb": "TMDB API key",
    "mediaKeys.ggdeals": "GG.deals API key", "mediaKeys.steamgriddb": "SteamGridDB API key",
    "steam.proxyUrl": "Steam proxy URL", "steam.steamId": "Steam ID",
    "steam.wishlistCategory": "Steam wishlist category", "steam.autoSyncDays": "Steam auto-sync",
    "anilist.userName": "AniList user name", "anilist.animeCategory": "AniList anime category",
    "anilist.mangaCategory": "AniList manga category", "anilist.autoSyncDays": "AniList auto-sync",
    "releases.autoRefreshDays": "release-date refresh",
  };
  function settingLabel(path) {
    if (SETTING_LABELS[path]) return SETTING_LABELS[path];
    const m = path.match(/^mediaCategory(Fallback)?Sources\.(.+)$/);
    if (m) return m[2] + (m[1] ? " fallback source" : " media source");
    return path;
  }

  async function settingsOf(entry) {
    const data = entry.snapshot ? entry.snapshot : await Storage.getVersion(entry.sha);
    return (data && data.settings) || {};
  }

  async function restoreSettingsFrom(entry) {
    let older;
    try { older = await settingsOf(entry); }
    catch (e) { toast("Couldn't read that save: " + (e.message || e), true); return; }
    const { settings, filled } = window.LifeLogMerge.fillBlankSettings(state.data.settings, older);
    const when = formatHistoryDate(entry.savedAt);
    if (!filled.length) { toast("That save has nothing that's missing now"); return; }
    const names = filled.map(settingLabel);
    const list = names.slice(0, 10).join("\n  • ") + (names.length > 10 ? "\n  • and " + (names.length - 10) + " more" : "");
    if (!confirm(`Bring back ${filled.length} setting${filled.length === 1 ? "" : "s"} from ${when}?\n\n  • ${list}\n\nOnly settings that are empty now are filled in. Your log and every other setting stay exactly as they are.`)) return;
    state.data.settings = settings;
    afterDataChange();
    updateMediaSettings();
    await persist();
    toast(`Brought back ${filled.length} setting${filled.length === 1 ? "" : "s"} from ${when}`);
  }

  // Walks the history newest first and offers the first save that has
  // anything to give back — so nobody has to guess which one still had the
  // keys. Local snapshots are instant; older GitHub saves are fetched one at
  // a time and the walk stops at the first hit.
  async function fillMissingSettings() {
    const btn = $("#historyFillSettingsBtn");
    btn.disabled = true;
    try {
      if (!historyCache.length) await refreshHistoryList();
      for (const entry of historyCache.slice(1)) {
        let older;
        try { older = await settingsOf(entry); } catch (e) { continue; }
        if (window.LifeLogMerge.fillBlankSettings(state.data.settings, older).filled.length) {
          await restoreSettingsFrom(entry);
          return;
        }
      }
      toast("None of your saved versions has a setting that's missing now");
    } finally {
      btn.disabled = false;
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

  // ---------- pages (0.186.0) ----------
  // Settings opens on a list of pages, each row saying where things stand,
  // rather than on seven tabs that had outgrown a phone's width. On a phone
  // the list and a page take turns, and back (the button, Escape, Android's
  // gesture, a swipe right) returns to the list. On a wider screen the list
  // stays beside the page, so a page is always open there.
  let currentPage = "";
  const box = () => $("#settingsModal .settings-modal");
  const onePane = () => isMobileLayout();

  function showPage(name) {
    currentPage = name || "";
    box().dataset.page = currentPage;
    document.querySelectorAll("#settingsModal .settings-page").forEach((p) => {
      const on = p.dataset.page === currentPage;
      if (!on && p.contains(document.activeElement)) document.activeElement.blur();
      p.hidden = !on;
      if (on && !prefersReducedMotion()) {
        p.classList.remove("view-fade-in");
        void p.offsetWidth; // force reflow so the animation replays
        p.classList.add("view-fade-in");
      }
    });
    document.querySelectorAll("#settingsModal .srow[data-page]").forEach((r) => {
      const on = r.dataset.page === currentPage;
      r.classList.toggle("active", on);
      if (on) r.setAttribute("aria-current", "page"); else r.removeAttribute("aria-current");
    });
    const pages = $("#settingsModal .settings-pages");
    if (pages) pages.scrollTop = 0;
    if (!currentPage) updateStatuses();
  }

  // True when it stepped back to the list, so whoever asked (Escape, back)
  // knows not to close Settings as well.
  function settingsBack() {
    if ($("#settingsModal").hidden || !currentPage || !onePane()) return false;
    showPage("");
    return true;
  }

  // ---------- the status line under each row ----------
  const EVERY = { "1": "every day", "3": "every 3 days", "7": "every week", "30": "every month" };
  const THEMES = { default: "Dark", light: "Light", nord: "Nord", dracula: "Dracula" };
  const FONTS = { system: "system typeface", serif: "serif", mono: "monospace", rounded: "rounded" };
  const KEY_NAMES = { rawg: "RAWG", tmdb: "TMDB", ggdeals: "GG.deals", steamgriddb: "SteamGridDB" };
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  function statusOf(page) {
    const set = state.data.settings || {};
    switch (page) {
      case "sync": {
        const gi = Storage.githubInfo;
        const file = Storage.fileName && !Storage.needsReconnect;
        if (Storage.githubConnected && gi) return { text: "GitHub · " + gi.owner + "/" + gi.repo + (file ? " · backup file" : ""), tone: "ok" };
        if (Storage.fileName && Storage.needsReconnect) return { text: "The backup file needs permission again", tone: "warn" };
        if (file) return { text: "Backup file only · " + Storage.fileName };
        return { text: "Not synced — on this device only", tone: "warn" };
      }
      case "io": return { text: "Back up, or bring in a spreadsheet" };
      case "history": {
        const n = historyCache.length;
        return { text: n ? "Undo or restore any of " + plural(n, "save", "saves") : "Undo or restore a recent save" };
      }
      case "deleted": {
        const n = computeRecentlyDeleted().length;
        return { text: n ? plural(n, "item", "items") + " you can bring back" : "Nothing to bring back" };
      }
      case "lock": {
        const p = state.privacy;
        if (!p.pinHash) return { text: "Off" };
        const how = p.credentialId ? "PIN + fingerprint" : "PIN";
        if (!p.enabled) return { text: how + " set up, not required" };
        const g = +p.graceMinutes || 0;
        return { text: how + " · " + (g ? "asks after " + (g === 60 ? "an hour" : plural(g, "minute", "minutes")) : "asks every time") };
      }
      case "appearance": {
        const v = state.visual;
        const forced = v.forceLayout === "mobile" ? " · phone layout" : v.forceLayout === "pc" ? " · computer layout" : "";
        return { text: (THEMES[v.theme] || THEMES.default) + " · " + (FONTS[v.fontFamily] || FONTS.system) + forced };
      }
      case "tabs": {
        const offViews = state.visual.disabledViews || [];
        const on = VIEW_TOGGLES.filter(([v]) => !offViews.includes(v)).length;
        const offModes = Object.entries(state.visual.disabledModes || {})
          .filter(([v]) => !offViews.includes(v))
          .reduce((n, [, m]) => n + (m || []).length, 0);
        return { text: on === VIEW_TOGGLES.length && !offModes ? "All tabs on"
          : on + " of " + VIEW_TOGGLES.length + " tabs on" + (offModes ? " · " + plural(offModes, "mode", "modes") + " off" : "") };
      }
      case "media": {
        const keys = Object.entries(set.mediaKeys || {}).filter(([, v]) => v).map(([k]) => KEY_NAMES[k] || k);
        const cats = Object.values(set.mediaCategorySources || {}).filter((v) => v && (typeof v === "string" || v.primary)).length;
        if (!keys.length && !cats) return { text: "No sources set up yet" };
        return { text: [keys.length ? keys.join(", ") : "", cats ? plural(cats, "category", "categories") + " set up" : ""].filter(Boolean).join(" · ") };
      }
      case "imports": {
        const parts = [];
        if (set.steam && set.steam.steamId) parts.push("Steam wishlist" + (set.steam.wishlistCategory ? " → " + set.steam.wishlistCategory : ""));
        if (set.anilist && set.anilist.userName) parts.push("AniList");
        return { text: parts.length ? parts.join(" · ") : "Steam wishlist, AniList" };
      }
      case "releases": {
        const d = String((set.releases && set.releases.autoRefreshDays) || "0");
        return { text: EVERY[d] ? "Checked " + EVERY[d] : "Checked when you ask" };
      }
    }
    return null;
  }

  function updateStatuses() {
    document.querySelectorAll("#settingsHome [data-status]").forEach((node) => {
      let s = null;
      try { s = statusOf(node.dataset.status); } catch (e) { /* a status line is never worth an error */ }
      node.textContent = s ? s.text : "";
      node.dataset.tone = (s && s.tone) || "";
    });
  }

  // ---------- search ----------
  // Read off the pages themselves rather than kept as a list here, so a
  // control added to a page is findable without anyone remembering to say so.
  // What a person reads: group headings, each row's title, action rows, and
  // a row's small print, buttons and choices (search "nord" and Color scheme
  // comes up; "csv" finds the Export rows). Not the hints — they'd match half
  // the words in the language. The lists that rows are drawn into (tab
  // switches, history, categories) are data, not settings, and are skipped.
  const DYNAMIC = "#tabToggles, #mediaCatRows, #historyList, #trashList";
  const VIEW_NAMES = { timeline: "Timeline", backlog: "Backlog", finance: "Ledger" };
  const squash = (t) => (t || "").replace(/\s+/g, " ").replace(/[…:]+\s*$/, "").trim();
  const shownIn = (n, root) => { for (let x = n; x && x !== root; x = x.parentElement) if (x.hidden) return false; return true; };

  function searchEntries() {
    const out = [];
    const add = (root, where, go) => {
      for (const n of root.querySelectorAll(".sgroup-label, .sitem")) {
        if (n.closest(DYNAMIC) || !shownIn(n, root)) continue;
        const title = n.querySelector(".sitem-title");
        const text = squash(title ? title.textContent : n.matches(".sitem-stack") ? "" : n.textContent);
        if (!text) continue;
        const group = n.closest(".sgroup");
        const head = group && !n.matches(".sgroup-label") && group.querySelector(".sgroup-label");
        const extra = [...n.querySelectorAll(".sitem-sub, option, .btn")].map((o) => o.textContent).join(" ");
        out.push({ text, where: head && squash(head.textContent) !== text ? where + " → " + squash(head.textContent) : where, go, el: n, extra });
      }
    };
    document.querySelectorAll("#settingsModal .settings-page").forEach((p) => {
      out.push({ text: p.dataset.title, where: "Settings", go: { page: p.dataset.page }, el: null, extra: p.dataset.keywords || "" });
      add(p, p.dataset.title, { page: p.dataset.page });
    });
    document.querySelectorAll("#viewOptionsModal [data-for]").forEach((sec) => {
      const view = sec.dataset.for.split(" ")[0];
      const where = sec.dataset.for.split(" ").map((v) => VIEW_NAMES[v]).join(" and ") + " → View";
      add(sec, where, { view });
    });
    return out;
  }

  function searchSettings(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const seen = new Set();
    const hits = [];
    for (const e of searchEntries()) {
      const title = e.text.toLowerCase();
      const hay = title + " " + e.where.toLowerCase() + " " + e.extra.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      const key = e.text + "|" + e.where;
      if (seen.has(key)) continue;
      seen.add(key);
      const score = title.startsWith(words[0]) ? 0 : words.every((w) => title.includes(w)) ? 1 : 2;
      hits.push({ ...e, score });
    }
    return hits.sort((a, b) => a.score - b.score).slice(0, 30);
  }

  function highlight(text, query) {
    const frag = document.createDocumentFragment();
    const w = query.trim().split(/\s+/)[0] || "";
    const i = w ? text.toLowerCase().indexOf(w.toLowerCase()) : -1;
    if (i < 0) { frag.appendChild(document.createTextNode(text)); return frag; }
    frag.appendChild(document.createTextNode(text.slice(0, i)));
    frag.appendChild(el("mark", "", text.slice(i, i + w.length)));
    frag.appendChild(document.createTextNode(text.slice(i + w.length)));
    return frag;
  }

  function renderSearch() {
    const q = $("#settingsSearch").value;
    const out = $("#settingsResults");
    const searching = !!q.trim();
    $("#settingsHome").hidden = searching;
    out.hidden = !searching;
    out.innerHTML = "";
    if (!searching) return;
    const hits = searchSettings(q);
    out.appendChild(el("div", "sgroup-label", hits.length ? plural(hits.length, "result", "results") : "No results"));
    const card = el("div", "sgroup-card");
    if (!hits.length) card.appendChild(el("p", "srow-empty", "Nothing matches. Try “key”, “sync” or “theme”."));
    for (const h of hits) {
      const row = el("button", "srow srow-result");
      row.type = "button";
      const text = el("span", "srow-text");
      const title = el("span", "srow-title");
      title.appendChild(highlight(h.text, q));
      text.appendChild(title);
      text.appendChild(el("span", "srow-status", h.where));
      row.appendChild(text);
      row.appendChild(el("span", "srow-chev", "›"));
      row.onclick = () => goToResult(h);
      card.appendChild(row);
    }
    out.appendChild(card);
  }

  function flash(node) {
    if (!node) return;
    const d = node.closest("details");
    if (d) d.open = true;
    const target = node;
    target.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    target.classList.remove("search-hit");
    void target.offsetWidth;
    target.classList.add("search-hit");
    setTimeout(() => target.classList.remove("search-hit"), 1600);
    // A phone would open its keyboard over the thing you just found.
    const field = node.matches("label") ? node.querySelector("input:not([type=checkbox]), select") : null;
    if (field && !onePane()) field.focus({ preventScroll: true });
  }

  function goToResult(h) {
    if (h.go.view) {
      closeSettings();
      openViewOptions(h.go.view);
    } else {
      showPage(h.go.page);
    }
    flash(h.el);
  }

  // ---------- a view's own options (the View button) ----------
  const hasViewOptions = (view) => !!document.querySelector('#viewOptionsModal [data-for~="' + view + '"]');

  function fillViewOptions() {
    $("#monthMin").value = state.visual.monthMinWidth;
    $("#monthMax").value = state.visual.monthMaxWidth;
    $("#currency").value = state.data.settings.currency;
    $("#timelineCoverSize").value = state.visual.timelineCoverSize || "small";
    $("#backlogCoverSize").value = state.visual.backlogCoverSize || "big";
    $("#backlogSummaries").value = state.visual.backlogSummaries || "show";
    $("#ledgerMonthSummary").value = state.visual.ledgerMonthSummary || "show";
    $("#timelineMonthSummary").value = state.visual.timelineMonthSummary || "hide";
    $("#backlogCounts").value = state.visual.backlogCounts;
    $("#backlogFoldEa").value = state.visual.backlogFoldEa;
    $("#backlogFoldUnreleased").value = state.visual.backlogFoldUnreleased;
    $("#backlogFoldDropped").value = state.visual.backlogFoldDropped;
  }

  // Opened from a search result for another tab, it goes to that tab first:
  // the options are for seeing their effect, which needs the list under them.
  function openViewOptions(view) {
    view = view || state.view;
    if (!hasViewOptions(view)) return;
    if (view !== state.view && switchToView) switchToView(view);
    fillViewOptions();
    $("#viewOptionsTitle").textContent = (VIEW_NAMES[view] || "View") + " view";
    document.querySelectorAll("#viewOptionsModal [data-for]").forEach((sec) => {
      sec.hidden = !sec.dataset.for.split(" ").includes(view);
    });
    $("#viewOptionsModal").hidden = false;
  }
  function closeViewOptions() { $("#viewOptionsModal").hidden = true; }

  function syncViewOptionsButton(view) {
    const b = $("#viewOptionsBtn");
    if (b) b.hidden = !hasViewOptions(view);
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
      { value: "steamgriddb-steam-gg", label: "SteamGridDB + Steam + GG.deals (games)" },
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
    // The "+ Steam + GG.deals" combos are offered here too: a match found by
    // the fallback wants a Steam App ID just as much as one found by the
    // primary, and excluding them only meant a games fallback quietly
    // produced items with no store link and no price.
    const fallbackSources = sources.filter((s) => s.value && s.value !== "steam");
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

  // One row per tab, each with its modes indented under it. Built rather
  // than written into index.html because the modes are VIEW_MODES' business
  // and a second copy of that list here would be one waiting to disagree
  // with it — the Backlog's three came from backlog.js in the first place.
  function renderTabToggles() {
    const wrap = $("#tabToggles");
    if (!wrap) return;
    wrap.innerHTML = "";
    const offViews = state.visual.disabledViews || [];
    const offModes = state.visual.disabledModes || {};

    // A card per tab: its switch, and its modes' switches under it.
    const switchRow = (cls, label) => {
      const row = el("label", "sitem toggle-label " + cls);
      const text = el("span", "sitem-text");
      text.appendChild(el("span", "sitem-title", label));
      row.appendChild(text);
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "switch";
      row.appendChild(box);
      return [row, box];
    };
    for (const [view, label, modes] of VIEW_TOGGLES) {
      const viewOn = !offViews.includes(view);
      const card = el("div", "sgroup-card");
      const [row, box] = switchRow("tab-toggle-view", label);
      box.checked = viewOn;
      box.onchange = () => setViewEnabled(view, box.checked);
      card.appendChild(row);

      const sub = el("div", "tab-toggle-modes");
      for (const [id, modeLabel] of modes) {
        const [mrow, mbox] = switchRow("tab-toggle-mode", modeLabel);
        mbox.checked = !(offModes[view] || []).includes(id);
        // A mode of a tab you've turned off is not a separate decision —
        // greyed rather than hidden, so turning the tab back on shows you
        // what its modes were still set to.
        mbox.disabled = !viewOn;
        mbox.onchange = () => setModeEnabled(view, id, mbox.checked);
        sub.appendChild(mrow);
      }
      if (modes.length) card.appendChild(sub);
      wrap.appendChild(card);
    }
  }

  // The last tab cannot be turned off, and the last mode of a tab cannot
  // either. Enforced here rather than only in app.js's fallbacks, so the
  // answer is a message saying why instead of a checkbox that silently
  // un-ticks itself.
  function setViewEnabled(view, on) {
    const off = new Set(state.visual.disabledViews || []);
    if (on) off.delete(view); else off.add(view);
    if (off.size >= VIEW_TOGGLES.length) {
      toast("Something has to be on screen — keep at least one tab", true);
      renderTabToggles();
      return;
    }
    state.visual.disabledViews = [...off];
    commitToggles();
  }

  function setModeEnabled(view, mode, on) {
    const all = (VIEW_TOGGLES.find((t) => t[0] === view) || [])[2] || [];
    const map = { ...(state.visual.disabledModes || {}) };
    const off = new Set(map[view] || []);
    if (on) off.delete(mode); else off.add(mode);
    if (off.size >= all.length) {
      toast("A tab needs at least one of its modes", true);
      renderTabToggles();
      return;
    }
    if (off.size) map[view] = [...off]; else delete map[view];
    state.visual.disabledModes = map;
    commitToggles();
  }

  function commitToggles() {
    saveVisualSettings(state.visual);
    // Where you are may no longer exist; app.js owns that question.
    settleDisabled();
    renderTabToggles();
    render();
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
    $("#releasesAutoRefreshDays").value = state.data.settings.releases?.autoRefreshDays || "0";
    updateSteamRetryUnresolvedButton();
    updateSteamBackfillRawgButton();
    updateRefreshReleasesButton();
    renderSteamWishlistCategoryOptions();
    renderAniListCategoryOptions("#anilistAnimeCategory", state.data.settings.anilist?.animeCategory);
    renderAniListCategoryOptions("#anilistMangaCategory", state.data.settings.anilist?.mangaCategory);
    renderMediaCatRows();
  }

  // Shown only while this device is behind the data — the storage line in
  // the topbar ellipses on a phone, and tapping it lands here, so this is
  // where the whole story goes.
  function updateVersionSkew() {
    const behind = versionBehind ? versionBehind() : "";
    $("#versionSkew").hidden = !behind;
    if (!behind) return;
    $("#versionSkewInfo").textContent =
      `This device is running LifeLog v${APP_VERSION}, but your data has already been saved by v${behind} on another device.`;
  }

  // page: open straight onto one (the storage line in the header opens Sync).
  // Otherwise a phone starts on the list and a wider screen on the first page.
  function openSettings(page) {
    $("#settingsSearch").value = "";
    renderSearch();
    ghEditing = false;
    $("#settingsVersion").textContent = "LifeLog v" + APP_VERSION;
    updateVersionSkew();
    updateBackendInfo();
    updateFileInfo();
    updateGithubInfo();
    updateHistoryPanel();
    $("#ghPollInterval").value = String(state.visual.pollInterval);
    $("#fontFamily").value = state.visual.fontFamily;
    $("#themeSelect").value = state.visual.theme || "default";
    $("#forceLayout").value = state.visual.forceLayout || "none";
    fillViewOptions();
    renderTabToggles();
    updateMediaSettings();
    updatePrivacySettings();
    $("#settingsModal").hidden = false;
    showPage(typeof page === "string" ? page : onePane() ? "" : "sync");
    updateStatuses();
  }

  // ---------- privacy / app lock settings ----------
  let bioAvailable = false;

  async function updatePrivacySettings() {
    $("#privacyEnabled").checked = !!state.privacy.enabled;
    $("#privacyGrace").value = String(state.privacy.graceMinutes || 0);
    refreshPrivacyUI();

    // Asked each time Settings opens, not cached: someone told to go and add
    // a fingerprint in Android's settings comes back expecting it to work.
    const bio = await biometricState();
    bioAvailable = bio === "available";
    $("#setBioBtn").hidden = !bioAvailable;
    $("#privacyBioUnavailable").hidden = bioAvailable;
    $("#privacyBioUnavailable").textContent = bio === "none-enrolled"
      ? "This phone has no fingerprint or face unlock set up — add one in Android's settings, then come back here."
      : "Fingerprint/Face ID isn't available on this device or browser.";
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
  function onBacklogSummariesChange() {
    state.visual.backlogSummaries = $("#backlogSummaries").value;
    state.visual.ledgerMonthSummary = $("#ledgerMonthSummary").value;
    state.visual.timelineMonthSummary = $("#timelineMonthSummary").value;
    saveVisualSettings(state.visual);
    render();
  }
  function onMonthSummaryChange() {
    state.visual.ledgerMonthSummary = $("#ledgerMonthSummary").value;
    state.visual.timelineMonthSummary = $("#timelineMonthSummary").value;
    saveVisualSettings(state.visual);
    render();
  }
  function onBacklogCountsChange() {
    state.visual.backlogCounts = $("#backlogCounts").value;
    saveVisualSettings(state.visual);
    render();
  }
  // Clears the per-category folds along with it: they are stored as
  // exceptions to what a setting says a band starts as, so a band you had
  // opened by hand would otherwise ignore the new setting entirely.
  function onBandFoldChange() {
    for (const key of ["backlogFoldEa", "backlogFoldUnreleased", "backlogFoldDropped"]) {
      state.visual[key] = $("#" + key).value;
    }
    state.bandOpen.clear();
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
    // A whole setup link, pasted where the token goes. A link opens a
    // browser, which is fine for joining in a browser and no use at all for
    // the Android app — it has no address bar to open one in. The token box
    // is where people already paste things, so it takes either.
    if (Storage.hashHasSetup(token)) return connectGithubFrom(() =>
      Storage.connectFromHash(token.slice(token.indexOf("#")), state.data), { join: true });
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
    return connectGithubFrom(() => Storage.connectGithub(cfg, state.data));
  }

  async function connectGithubFrom(connect, { join = false } = {}) {
    try {
      toast("Connecting to GitHub…");
      const res = await connect();
      if (join && res && res.existed && res.data) {
        // A setup link joins; it never asks which copy wins. The question
        // below offers "overwrite it with this device's entries", which on a
        // freshly installed app is zero entries and one mis-tap from wiping
        // the synced log. Both copies are merged with no base instead, so
        // anything either side has is kept — for a new device that is simply
        // the remote, and for one that was used offline first it is both.
        const merged = window.LifeLogMerge.mergeAllSources(null, state.data, normalize(res.data));
        state.data = normalize(merged);
        afterDataChange();
        await persist();
      } else if (res.existed && res.data && Array.isArray(res.data.entries)) {
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

  // ---------- scanning a setup QR code (the Android app) ----------
  // The phone's camera opens a QR code's link in the browser, which connects
  // the web copy and leaves the app exactly as it was. Inside the app the
  // code has to be read by the app, so it asks Google's scanner — Play
  // services' own screen, which is why LifeLog needs no camera permission —
  // and hands what it read to the same connect path as a pasted link.
  const scanner = () => (window.LifeLogPlatform && window.LifeLogPlatform.plugin("BarcodeScanner")) || null;

  // The scanner is a Play services module, normally fetched when the app is
  // installed (tools/android-manifest.js). If it isn't there yet, ask for it
  // and wait for the install to finish rather than failing the first scan.
  async function ensureScannerModule(S) {
    const { available } = await S.isGoogleBarcodeScannerModuleAvailable();
    if (available) return;
    toast("Getting the scanner ready…");
    await new Promise((resolve, reject) => {
      let handle = null;
      const done = (fn, arg) => { if (handle) handle.remove(); fn(arg); };
      Promise.resolve(S.addListener("googleBarcodeScannerModuleInstallProgress", (ev) => {
        if (ev.state === 4) done(resolve);                          // COMPLETED
        else if (ev.state === 3 || ev.state === 5) done(reject, new Error("The scanner couldn't be installed"));
      })).then((h) => { handle = h; return S.installGoogleBarcodeScannerModule(); }).catch(reject);
    });
  }

  async function scanSetupQr() {
    const S = scanner();
    if (!S) return;
    let text = "";
    try {
      await ensureScannerModule(S);
      const { barcodes } = await S.scan({ formats: ["QR_CODE"] });
      text = String((barcodes && barcodes[0] && (barcodes[0].rawValue || barcodes[0].displayValue)) || "");
    } catch (e) {
      // Backing out of the scanner is a choice, not an error.
      if (/cancel/i.test(String(e && e.message || e))) return;
      toast("Couldn't scan: " + (e && e.message || e), true);
      return;
    }
    if (!text) return;
    if (!Storage.hashHasSetup(text)) {
      toast("That QR code isn't a LifeLog setup link — use the one in Settings on a connected device", true);
      return;
    }
    $("#ghToken").value = text;
    await connectGithub();
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
    $("#closeSettingsPageBtn").onclick = closeSettings;
    $("#settingsBackBtn").onclick = () => showPage("");
    document.querySelectorAll("#settingsHome .srow[data-page]").forEach((r) => r.onclick = () => showPage(r.dataset.page));
    const search = $("#settingsSearch");
    search.oninput = renderSearch;
    search.onkeydown = (e) => {
      // Escape clears a search before it closes anything.
      if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; renderSearch(); }
      if (e.key === "Enter") { const first = $("#settingsResults .srow-result"); if (first) first.click(); }
    };
    // A swipe right on a page is back, as on the rest of the phone.
    // requireHorizontal keeps a vertical drag down a long page from counting.
    attachSwipe($("#settingsModal .settings-main"), {
      onLeft: () => {},
      onRight: () => settingsBack(),
      threshold: 60,
      requireHorizontal: true,
    });
    $("#ghEditBtn").onclick = () => { ghEditing = true; updateGithubInfo(); $("#ghToken").focus(); };
    $("#viewOptionsBtn").onclick = () => openViewOptions();
    $("#closeViewOptionsBtn").onclick = closeViewOptions;
    $("#connectFileBtn").onclick = connectFile;
    $("#reconnectFileBtn").onclick = reconnectFile;
    $("#disconnectFileBtn").onclick = disconnectFile;
    $("#ghConnectBtn").onclick = connectGithub;
    $("#historyFillSettingsBtn").onclick = fillMissingSettings;
    // Only where there's a scanner to ask: a browser already has the camera.
    $("#ghScanBtn").hidden = !scanner();
    $("#ghScanBtn").onclick = scanSetupQr;
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
    $("#backlogSummaries").onchange = onBacklogSummariesChange;
    $("#backlogCounts").onchange = onBacklogCountsChange;
    $("#backlogFoldEa").onchange = onBandFoldChange;
    $("#backlogFoldUnreleased").onchange = onBandFoldChange;
    $("#backlogFoldDropped").onchange = onBandFoldChange;
    $("#ledgerMonthSummary").onchange = onMonthSummaryChange;
    $("#timelineMonthSummary").onchange = onMonthSummaryChange;
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

    $("#releasesAutoRefreshDays").onchange = async () => {
      if (!state.data.settings.releases) state.data.settings.releases = { ...DEFAULT_SETTINGS.releases };
      state.data.settings.releases.autoRefreshDays = $("#releasesAutoRefreshDays").value;
      await persist();
    };
    $("#refreshReleasesBtn").onclick = refreshUpcomingReleases;

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
      } catch (e) {
        if (e && e.cancelled) return;
        toast("Couldn't set up: " + (e.message || e), true);
      }
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
    settingsBack, // Escape and Android's back step out of a page first
    openViewOptions,
    closeViewOptions,
    syncViewOptionsButton,
  };
})();
