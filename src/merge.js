// LifeLog — pure data-reconciliation primitives: diffing, timestamp
// stamping, and three-way merging of id-keyed collections. No DOM/fetch/
// IndexedDB access on purpose, so this runs identically in the browser and
// in plain Node (see test/merge.test.js) — the merge logic is exactly what
// gets tested, not a simulation of it.
(function () {
  const COLLECTION_KEYS = ["entries", "backlog", "financeEntries", "recurringExpenses", "categories", "financeCategories"];

  function byId(arr) {
    const m = new Map();
    for (const item of arr || []) if (item && item.id) m.set(item.id, item);
    return m;
  }

  // Same content, ignoring updatedAt itself (that's the thing being decided
  // here, not part of what's being compared).
  function sameContent(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const restA = { ...a }; delete restA.updatedAt;
    const restB = { ...b }; delete restB.updatedAt;
    return JSON.stringify(restA) === JSON.stringify(restB);
  }

  function flattenAccomplishments(acc) {
    const out = [];
    for (const year of Object.keys(acc || {})) for (const a of acc[year] || []) out.push({ ...a, __year: String(year) });
    return out;
  }
  function unflattenAccomplishments(list) {
    const out = {};
    for (const a of list) {
      const rest = { ...a };
      const year = rest.__year;
      delete rest.__year;
      (out[year] = out[year] || []).push(rest);
    }
    return out;
  }

  // Version strings compared part by part as numbers, so "0.116.0" sorts
  // below "0.117.0" and both below "1.0.0". A part that isn't a number counts
  // as 0, so junk in a hand-edited file can't claim to come from the future.
  function compareVersions(a, b) {
    const parts = (v) => String(v || "").split(".").map((n) => parseInt(n, 10) || 0);
    const pa = parts(a), pb = parts(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }
  function maxVersion(a, b) {
    return compareVersions(a, b) >= 0 ? (a || b || "") : (b || "");
  }

  // Stamps updatedAt = now on anything in `next` that's new or changed
  // relative to `prev`, mutating `next`'s items in place. Called right
  // before a save so every real edit carries an accurate timestamp without
  // threading a manual "touch" call through every mutation site in the app.
  function stampChangedItems(prev, next, now) {
    now = now || new Date().toISOString();
    if (!next) return next;
    if (!prev) return next; // nothing to compare against yet (first save ever)
    for (const key of COLLECTION_KEYS) {
      const prevMap = byId(prev[key]);
      for (const item of next[key] || []) {
        const before = prevMap.get(item.id);
        if (!before || !sameContent(before, item)) item.updatedAt = now;
      }
    }
    const prevAccMap = byId(flattenAccomplishments(prev.accomplishments));
    for (const year of Object.keys(next.accomplishments || {})) {
      for (const a of next.accomplishments[year]) {
        const before = prevAccMap.get(a.id);
        const beforeSameYear = before && before.__year === String(year) ? before : null;
        if (!beforeSameYear || !sameContent(beforeSameYear, { ...a, __year: String(year) })) a.updatedAt = now;
      }
    }
    if (next.settings && (!prev.settings || !sameContent(prev.settings, next.settings))) {
      next.settings.updatedAt = now;
    }
    return next;
  }

  // 2-way diff between two snapshots of one collection — what's new,
  // removed, or edited. Powers both the merge algorithm's per-side change
  // detection and the human-readable history/merge summaries.
  function diffCollection(beforeArr, afterArr) {
    const b = byId(beforeArr), a = byId(afterArr);
    const added = [], removed = [], edited = [];
    for (const id of a.keys()) if (!b.has(id)) added.push(id);
    for (const id of b.keys()) if (!a.has(id)) removed.push(id);
    for (const id of a.keys()) if (b.has(id) && !sameContent(a.get(id), b.get(id))) edited.push(id);
    return { added, removed, edited };
  }

  const COLLECTION_LABELS = {
    entries: ["entry", "entries"],
    backlog: ["backlog item", "backlog items"],
    financeEntries: ["finance entry", "finance entries"],
    recurringExpenses: ["recurring expense", "recurring expenses"],
    categories: ["category", "categories"],
    financeCategories: ["finance category", "finance categories"],
  };

  // Human-readable summary of what changed between two whole-document
  // snapshots — used as the label for a history entry and for merge toasts.
  function diffSnapshots(before, after) {
    before = before || {}; after = after || {};
    const parts = [];
    for (const key of COLLECTION_KEYS) {
      const [singular, plural] = COLLECTION_LABELS[key];
      const d = diffCollection(before[key] || [], after[key] || []);
      if (d.added.length) parts.push(`+${d.added.length} ${d.added.length === 1 ? singular : plural}`);
      if (d.removed.length) parts.push(`-${d.removed.length} ${d.removed.length === 1 ? singular : plural}`);
      if (d.edited.length) parts.push(`edited ${d.edited.length} ${d.edited.length === 1 ? singular : plural}`);
    }
    const accDiff = diffCollection(flattenAccomplishments(before.accomplishments), flattenAccomplishments(after.accomplishments));
    if (accDiff.added.length) parts.push(`+${accDiff.added.length} achievement${accDiff.added.length === 1 ? "" : "s"}`);
    if (accDiff.removed.length) parts.push(`-${accDiff.removed.length} achievement${accDiff.removed.length === 1 ? "" : "s"}`);
    if (accDiff.edited.length) parts.push(`edited ${accDiff.edited.length} achievement${accDiff.edited.length === 1 ? "" : "s"}`);
    if (before.settings && after.settings && !sameContent(before.settings, after.settings)) parts.push("changed settings");
    return parts.length ? parts.join(", ") : "No changes";
  }

  // Human-readable summary of real conflicts a merge had to resolve — where
  // one side's own edit or deletion was silently overridden by the other —
  // as opposed to diffSnapshots' plain added/removed/edited counts, which
  // don't distinguish a conflict from an ordinary one-sided change. Recomputes
  // mergeCollection per collection (cheap for personal-log-sized data) rather
  // than threading extra fields through mergeAllSources' returned document,
  // which is written verbatim to disk and shouldn't carry a non-data field.
  function summarizeConflicts(base, local, remote) {
    base = base || {}; local = local || {}; remote = remote || {};
    const editParts = [], deleteParts = [];
    for (const key of COLLECTION_KEYS) {
      const [singular, plural] = COLLECTION_LABELS[key];
      const r = mergeCollection(base[key] || [], local[key] || [], remote[key] || []);
      if (r.editConflicts.length) editParts.push(`${r.editConflicts.length} ${r.editConflicts.length === 1 ? singular : plural}`);
      if (r.deleteOverridden.length) deleteParts.push(`${r.deleteOverridden.length} ${r.deleteOverridden.length === 1 ? singular : plural}`);
    }
    const out = [];
    if (editParts.length) out.push(`kept the newer edit for ${editParts.join(", ")}`);
    if (deleteParts.length) out.push(`restored ${deleteParts.join(", ")} deleted on one side but edited on the other`);
    return out.join("; ");
  }

  // Three-way merge of one id-keyed collection. base = last commonly-synced
  // state (may be empty/undefined on a device's first-ever sync — see the
  // no-base fallback this naturally produces below); local/remote = the two
  // sides that may have diverged from it since.
  function mergeCollection(baseArr, localArr, remoteArr) {
    const baseMap = byId(baseArr), localMap = byId(localArr), remoteMap = byId(remoteArr);
    const allIds = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
    const merged = [], added = [], removed = [], updatedFromRemote = [], updatedFromLocal = [];
    // Real conflicts only: cases where a side's own change was silently
    // discarded rather than cleanly combined — editConflicts (both sides
    // edited the same item; the older edit is dropped) and deleteOverridden
    // (one side deleted it, but the other edited it since, so the deletion
    // is discarded and the item resurrected). Plain one-sided updates above
    // (only one side changed anything) lose nothing and aren't conflicts.
    const editConflicts = [], deleteOverridden = [];

    for (const id of allIds) {
      const b = baseMap.get(id), l = localMap.get(id), r = remoteMap.get(id);

      if (!b) {
        // No base record: a pure addition on one or both sides (no base at
        // all — e.g. first sync ever — means every existing item lands here,
        // which is exactly the safe "union, no deletions inferred" fallback).
        if (l && r) { merged.push((l.updatedAt || "") >= (r.updatedAt || "") ? l : r); }
        else if (l) { merged.push(l); added.push(id); }
        else if (r) { merged.push(r); added.push(id); }
        continue;
      }
      if (!l && !r) continue; // deleted on both sides — stays gone
      if (!l && r) {
        // local deleted it — did remote change it since base?
        if (sameContent(r, b)) { removed.push(id); continue; } // remote unchanged → deletion wins
        merged.push(r); updatedFromRemote.push(id); deleteOverridden.push(id); // edit-wins-over-delete (resurrect)
        continue;
      }
      if (l && !r) {
        // remote deleted it — did local change it since base?
        if (sameContent(l, b)) { removed.push(id); continue; } // local unchanged → deletion wins
        merged.push(l); deleteOverridden.push(id);              // edit-wins-over-delete (keep local)
        continue;
      }
      // present in all three
      const localChanged = !sameContent(l, b), remoteChanged = !sameContent(r, b);
      if (!localChanged && !remoteChanged) merged.push(l);
      else if (!localChanged) { merged.push(r); updatedFromRemote.push(id); }
      else if (!remoteChanged) { merged.push(l); updatedFromLocal.push(id); }
      else {
        // true conflict: both sides changed the same item since base —
        // whole-item newer-updatedAt-wins (no field-level merge).
        const winner = (l.updatedAt || "") >= (r.updatedAt || "") ? l : r;
        merged.push(winner);
        (winner === r ? updatedFromRemote : updatedFromLocal).push(id);
        editConflicts.push(id);
      }
    }
    return { merged, added, removed, updatedFromRemote, updatedFromLocal, editConflicts, deleteOverridden };
  }

  function mergeAccomplishmentYears(base, local, remote) {
    const { merged } = mergeCollection(flattenAccomplishments(base), flattenAccomplishments(local), flattenAccomplishments(remote));
    return unflattenAccomplishments(merged);
  }

  // settings has no per-field timestamps — treated as one atomic blob: if
  // only one side changed it since base, take that side; if both did,
  // newer settings.updatedAt wins wholesale (no per-field merge).
  function mergeSettings(base, local, remote) {
    base = base || {}; local = local || {}; remote = remote || {};
    const localChanged = !sameContent(local, base), remoteChanged = !sameContent(remote, base);
    if (!localChanged && !remoteChanged) return local;
    if (!localChanged) return remote;
    if (!remoteChanged) return local;
    return (local.updatedAt || "") >= (remote.updatedAt || "") ? local : remote;
  }

  function mergeAllSources(base, local, remote) {
    base = base || {}; local = local || {}; remote = remote || {};
    const out = {};
    for (const key of COLLECTION_KEYS) out[key] = mergeCollection(base[key] || [], local[key] || [], remote[key] || []).merged;
    out.accomplishments = mergeAccomplishmentYears(base.accomplishments, local.accomplishments, remote.accomplishments);
    out.settings = mergeSettings(base.settings, local.settings, remote.settings);
    out.version = local.version || remote.version || 1;
    // The newest build that has ever written this document, carried across
    // the merge as a high-water mark rather than "whoever saved last" — a
    // device running behind must not be able to lower it, or the device that
    // is up to date would stop being able to tell. It describes the file, not
    // any item, which is why it sits out here rather than in a collection.
    const writer = maxVersion(local.appVersion, remote.appVersion);
    if (writer) out.appVersion = writer;
    return out;
  }

  const api = {
    COLLECTION_KEYS, byId, sameContent, flattenAccomplishments, unflattenAccomplishments,
    compareVersions, maxVersion,
    stampChangedItems, diffCollection, diffSnapshots, summarizeConflicts,
    mergeCollection, mergeAccomplishmentYears, mergeSettings, mergeAllSources,
  };

  if (typeof window !== "undefined") window.LifeLogMerge = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
