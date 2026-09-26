// LifeLog — pure data-reconciliation primitives: diffing, timestamp
// stamping, and three-way merging of id-keyed collections. No DOM/fetch/
// IndexedDB access on purpose, so this runs identically in the browser and
// in plain Node (see test/merge.test.js) — the merge logic is exactly what
// gets tested, not a simulation of it.
(function () {
  const COLLECTION_KEYS = ["entries", "backlog", "notes", "todos", "financeEntries", "recurringExpenses", "categories", "todoCategories", "noteCategories", "financeCategories", "projects", "habits"];

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
    notes: ["note", "notes"],
    todos: ["to-do", "to-dos"],
    financeEntries: ["finance entry", "finance entries"],
    recurringExpenses: ["recurring expense", "recurring expenses"],
    categories: ["category", "categories"],
    todoCategories: ["to-do category", "to-do categories"],
    financeCategories: ["finance category", "finance categories"],
    projects: ["project", "projects"],
    habits: ["habit", "habits"],
  };

  // Human-readable summary of what changed between two whole-document
  // snapshots — used as the label for a history entry and for merge toasts.
  function diffSnapshots(before, after) {
    before = before || {}; after = after || {};
    const parts = [];
    for (const key of COLLECTION_KEYS) {
      const [singular, plural] = COLLECTION_LABELS[key] || [key, key];
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
      const [singular, plural] = COLLECTION_LABELS[key] || [key, key];
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

  // settings merges field by field, recursing into its nested objects
  // (mediaKeys, steam, anilist, mediaCategorySources…), three-way like the
  // collections: a field only one side changed since the base takes that
  // side, and only a field both sides changed falls back to the newer
  // settings.updatedAt.
  //
  // Until 0.175.0 it was one atomic blob, newer wins wholesale — and the
  // blob holds sort orders and the currency beside the media sources. So
  // setting a RAWG key on the desktop and then changing the backlog's sort
  // on the phone put the phone's whole blob on every device, key and all
  // gone: "media sources don't sync". Per field, the two edits never meet.
  //
  // Without a base (a device joining by setup link), there is no telling
  // which side changed a field, so a value beats a blank: a freshly installed
  // app's empty defaults must not win over a real key just because its first
  // save was more recent. Where both sides hold different real values, the
  // newer settings.updatedAt decides, as before.
  const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const isBlank = (v) => v === undefined || v === null || v === "";
  const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function mergeSettingValue(base, local, remote, hasBase, localNewer) {
    if (isPlainObject(local) && isPlainObject(remote)) {
      const b = isPlainObject(base) ? base : undefined;
      const out = {};
      for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
        if (k === "updatedAt") continue;
        const v = mergeSettingValue(b ? b[k] : undefined, local[k], remote[k], hasBase && !!b, localNewer);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    if (sameValue(local, remote)) return local;
    if (hasBase && base !== undefined) {
      if (sameValue(local, base)) return remote;
      if (sameValue(remote, base)) return local;
    } else {
      if (isBlank(local)) return remote;
      if (isBlank(remote)) return local;
    }
    return localNewer ? local : remote;
  }

  // Brings back settings that are blank now from an older version — and
  // nothing else. For recovering what a bad merge emptied (0.174.0's join by
  // setup link could push a fresh install's empty settings everywhere) without
  // rolling the whole log back to that version, which is what Restore does.
  // A setting set to something now is never touched, even if the older one
  // differs: this only fills holes. Returns the settings and the paths filled.
  function fillBlankSettings(current, older) {
    const filled = [];
    const walk = (cur, old, path) => {
      if (isPlainObject(old)) {
        const out = isPlainObject(cur) ? { ...cur } : {};
        for (const k of Object.keys(old)) {
          if (k === "updatedAt" && !path) continue;
          const v = walk(out[k], old[k], path ? path + "." + k : k);
          if (v !== undefined) out[k] = v;
        }
        return out;
      }
      if (isBlank(cur) && !isBlank(old)) { filled.push(path); return old; }
      return cur;
    };
    const settings = walk(current || {}, older || {}, "");
    if (current && current.updatedAt) settings.updatedAt = current.updatedAt;
    return { settings, filled };
  }

  // Settings restored on purpose from a backup file (Settings → Import &
  // export → Restore settings). Unlike fillBlankSettings this also changes
  // what's set now to what the file says — that's the point of asking for
  // it — but a blank in the file never empties something that's set: a
  // backup from before a key existed shouldn't take the key away. Returns
  // the settings and which paths it filled and which it changed.
  function settingsFromBackup(current, incoming) {
    const filled = [], changed = [];
    const walk = (cur, inc, path) => {
      if (isPlainObject(inc)) {
        const out = isPlainObject(cur) ? { ...cur } : {};
        for (const k of Object.keys(inc)) {
          if (k === "updatedAt" && !path) continue;
          const v = walk(out[k], inc[k], path ? path + "." + k : k);
          if (v !== undefined) out[k] = v;
        }
        return out;
      }
      if (isBlank(inc) || sameValue(cur, inc)) return cur;
      (isBlank(cur) ? filled : changed).push(path);
      return inc;
    };
    const settings = walk(current || {}, incoming || {}, "");
    if (current && current.updatedAt) settings.updatedAt = current.updatedAt;
    return { settings, filled, changed };
  }

  function mergeSettings(base, local, remote) {
    if (!local) return remote || {};
    if (!remote) return local;
    const localNewer = (local.updatedAt || "") >= (remote.updatedAt || "");
    const out = mergeSettingValue(base || undefined, local, remote, !!base, localNewer);
    const stamp = localNewer ? local.updatedAt : remote.updatedAt;
    if (stamp) out.updatedAt = stamp;
    return out;
  }

  // Habits need one thing on top of the ordinary collection merge: their
  // marks are a { date: count } map, and mergeCollection treats an item as
  // atomic. Two phones ticking two different days is the single most likely
  // thing that will ever happen to this collection, and left alone it would
  // resolve as an edit conflict — one of the two days simply gone.
  //
  // So the habit's own fields merge as usual, and then its marks are merged
  // per date, three-way like everything else here: a date only one side
  // touched takes that side, which is what makes unticking a day work rather
  // than being undone by the other device's stale copy. Where both sides
  // changed the same date, the larger count wins — "I did it" beats "I
  // didn't record it", and the loser can untick again. See NOTES.md.
  function mergeMarks(base, local, remote) {
    base = base || {}; local = local || {}; remote = remote || {};
    const out = {};
    for (const date of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const b = +base[date] || 0, l = +local[date] || 0, r = +remote[date] || 0;
      let v;
      if (l === r) v = l;
      else if (l === b) v = r;
      else if (r === b) v = l;
      else v = Math.max(l, r);
      if (v > 0) out[date] = v;
    }
    return out;
  }

  function mergeHabits(baseArr, localArr, remoteArr) {
    const merged = mergeCollection(baseArr || [], localArr || [], remoteArr || []).merged;
    const b = byId(baseArr), l = byId(localArr), r = byId(remoteArr);
    return merged.map((h) => {
      const marks = mergeMarks((b.get(h.id) || {}).marks, (l.get(h.id) || {}).marks, (r.get(h.id) || {}).marks);
      const out = { ...h };
      if (Object.keys(marks).length) out.marks = marks; else delete out.marks;
      return out;
    });
  }

  // A checklist note (0.195.0) holds its items, and mergeCollection treats a
  // note as atomic: a phone ticking one item and a laptop ticking another
  // would be an edit conflict, one tick simply gone. So which notes survive
  // is decided as for any item, and a checklist both sides still have merges
  // its items one by one — the same shape as a habit's marks or a board's
  // elements. An item both sides changed goes to this device.
  function mergeNotes(baseArr, localArr, remoteArr) {
    const merged = mergeCollection(baseArr || [], localArr || [], remoteArr || []).merged;
    const b = byId(baseArr), l = byId(localArr), r = byId(remoteArr);
    return merged.map((n) => {
      const ln = l.get(n.id), rn = r.get(n.id);
      if (!ln || !rn || !(Array.isArray(ln.items) || Array.isArray(rn.items))) return n;
      const bn = b.get(n.id);
      const items = mergeCollection((bn && bn.items) || [], ln.items || [], rn.items || []).merged;
      return { ...n, items: inChosenOrder(items, (bn && bn.items) || [], ln.items || [], rn.items || []) };
    });
  }
  // A list's order is the order of its items, and dragging one changes no
  // item — so mergeCollection, which walks the ancestor's order first, would
  // quietly undo a reorder. The side that reordered wins (this device if
  // both did); items it doesn't have keep their merged place at the end.
  function inChosenOrder(items, base, local, remote) {
    const ids = (arr) => arr.map((i) => i.id);
    const kept = new Set(ids(items));
    const seq = (arr) => ids(arr).filter((id) => kept.has(id));
    const baseSeq = JSON.stringify(seq(base));
    const ref = JSON.stringify(seq(local)) !== baseSeq ? local : JSON.stringify(seq(remote)) !== baseSeq ? remote : local;
    const at = new Map(ids(ref).map((id, i) => [id, i]));
    return items.map((it, i) => [it, at.has(it.id) ? at.get(it.id) : ref.length + i])
      .sort((a, b) => a[1] - b[1]).map(([it]) => it);
  }

  function mergeAllSources(base, local, remote) {
    base = base || {}; local = local || {}; remote = remote || {};
    const out = {};
    for (const key of COLLECTION_KEYS) out[key] = mergeCollection(base[key] || [], local[key] || [], remote[key] || []).merged;
    // ...except habits, whose marks map has to survive both sides editing it.
    out.habits = mergeHabits(base.habits, local.habits, remote.habits);
    out.notes = mergeNotes(base.notes, local.notes, remote.notes);
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

  // Boards (boards.json, 0.193.0) merge in two steps. Which boards survive is
  // decided on the whole board, so a board one device deleted while the other
  // drew on it comes back rather than vanishing with the new strokes. Then a
  // board both sides still have merges element by element: two devices
  // drawing on the same board keep both sets of strokes, and one erasing a
  // stroke the other never touched stays erased. The name and the rest of the
  // board's own fields come from whichever side changed them (the newer on a
  // clash), as for any other item.
  function mergeBoards(base, local, remote) {
    base = base || []; local = local || []; remote = remote || [];
    const baseMap = byId(base), localMap = byId(local), remoteMap = byId(remote);
    const meta = (b) => { if (!b) return b; const m = { ...b }; delete m.elements; return m; };
    const kept = mergeCollection(base, local, remote).merged;
    return kept.map((board) => {
      const b = baseMap.get(board.id), l = localMap.get(board.id), r = remoteMap.get(board.id);
      if (!l || !r) return board;
      const fields = mergeCollection(b ? [meta(b)] : [], [meta(l)], [meta(r)]).merged[0] || meta(board);
      const elements = mergeCollection(b ? b.elements : [], l.elements, r.elements).merged;
      return { ...fields, elements };
    });
  }

  const api = {
    COLLECTION_KEYS, byId, mergeBoards, sameContent, flattenAccomplishments, unflattenAccomplishments,
    compareVersions, maxVersion,
    stampChangedItems, diffCollection, diffSnapshots, summarizeConflicts,
    mergeCollection, mergeAccomplishmentYears, mergeSettings, mergeAllSources, fillBlankSettings, settingsFromBackup,
    mergeHabits, mergeMarks, mergeNotes,
  };

  if (typeof window !== "undefined") window.LifeLogMerge = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
