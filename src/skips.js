// What you left unticked in an import's review, and where the title was
// then (Nov 2026). settings.importSkips[source] is a list of strings, synced
// like any setting: "anilist:123#5" is a title skipped at 5 episodes,
// "anilist:123#done" one skipped finished, and a bare "anilist:123" one
// skipped before skips knew their state (it picks one up the next time
// that review is confirmed).
//
// A skipped title stays out until it moves forward: more progress, or
// finished. Anything else (paused, dropped, the same count) leaves it out.
(function () {
  "use strict";
  const DONE = "done";

  // { progress, done } → the string kept after "#". "" says the source has
  // nothing that moves (a wishlist): that skip stays a skip.
  function stateOf(s) {
    if (!s) return "";
    if (s.done) return DONE;
    const p = Math.floor(+s.progress || 0);
    return p > 0 ? String(p) : "0";
  }
  function parse(str) {
    const s = String(str || "");
    const at = s.lastIndexOf("#");
    return at < 0 ? { key: s, state: null } : { key: s.slice(0, at), state: s.slice(at + 1) };
  }
  const entry = (key, state) => (state ? key + "#" + state : key);

  // Has it moved on from the state it was skipped at?
  function ahead(was, now) {
    if (was === null || was === undefined || !now || was === DONE) return false;
    if (now === DONE) return true;
    return (+now || 0) > (+was || 0);
  }

  // The list as a map key → state it was skipped at (null: unknown).
  function index(list) {
    const map = new Map();
    for (const s of list || []) { const p = parse(s); if (p.key) map.set(p.key, p.state); }
    return map;
  }

  // "skipped": still left out; "back": skipped once, moved on since;
  // "": never skipped. `was` is the state it was skipped at.
  function check(map, key, state) {
    if (!map.has(key)) return { status: "", was: null };
    const was = map.get(key);
    return { status: ahead(was, state) ? "back" : "skipped", was };
  }

  // After a review: what was ticked is forgotten, what wasn't is kept at
  // the state it has now. `rows` are { key, state, chosen }.
  function remember(list, rows) {
    const map = index(list);
    for (const r of rows) {
      if (!r.key) continue;
      if (r.chosen) map.delete(r.key); else map.set(r.key, r.state || "");
    }
    return [...map].map(([k, s]) => entry(k, s));
  }

  // Adds a key without a review (a title deleted here): kept at the state
  // given, or as it was if it's already there.
  function add(list, key, state) {
    const map = index(list);
    if (map.has(key)) return list || [];
    map.set(key, state || "");
    return [...map].map(([k, s]) => entry(k, s));
  }
  function forget(list, key) {
    const map = index(list);
    map.delete(key);
    return [...map].map(([k, s]) => entry(k, s));
  }

  // Marks built import rows: a skipped one is unticked and hidden behind
  // "Show what you skipped before"; one that came back says so and is never
  // added without the review. keyOf(it) / stateOf(it) read a row; `unit`
  // says what the number counts when it isn't episodes or chapters ("hrs").
  function mark(items, list, keyOf, stateOfRow, unit) {
    const map = index(list);
    for (const it of items) {
      if (it.dup || it.update) continue;
      const key = keyOf(it);
      if (!key) continue;
      const c = check(map, key, stateOfRow ? stateOfRow(it) : "");
      if (c.status) { it.skippedAt = c.was || ""; if (unit) it.skipUnit = unit; }
      if (c.status === "skipped") { it.skipped = true; it.checked = false; }
      else if (c.status === "back") it.cameBack = true;
    }
    return items;
  }

  const api = { DONE, stateOf, parse, entry, ahead, index, check, remember, add, forget, mark };
  if (typeof window !== "undefined") window.LifeLogSkips = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
