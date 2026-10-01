// Paste into the running app (the Browser pane's javascript_tool, or DevTools)
// at a phone width. Lists every visible pressable whose *tappable* area is
// smaller than 44×44 CSS px, the HIG minimum (DESIGN.md §9).
//
// The tappable area is measured, not read off the box: from the control's
// centre it probes outwards with elementFromPoint until a tap would land on
// something else. So a 20px glyph with a padded ::after counts at the size a
// finger actually gets, and a control half-covered by a sticky header counts
// at what's left. `steals` lists controls whose own visible box resolves to a
// different control somewhere, which is what an over-wide hit area does to its
// neighbour. Only controls fully on screen and clear of the top/bottom bars
// are measured, so scroll through a view and run it again to cover all of it.
// Measure after a screenshot: a pane that isn't painting freezes transitions
// mid-way and reports sizes from the middle of them.
(() => {
  const SEL = 'button, [role="button"], summary, a[href], input:not([type=hidden]), select, .tab, .cat-chip, .chip-edit, .filter-label, .toggle-label, .jump-item';
  const MIN = 44;
  const owner = (x, y) => { const e = document.elementFromPoint(x, y); return e && e.closest(SEL); };
  const reach = (n, cx, cy, dx, dy, max) => { let i = 0; while (i < max && owner(cx + dx * (i + 1), cy + dy * (i + 1)) === n) i++; return i; };
  const onScreen = (r) => r.width && r.height && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;

  const small = new Map();
  const steals = [];
  let measured = 0;
  for (const n of document.querySelectorAll(SEL)) {
    const r = n.getBoundingClientRect();
    if (!onScreen(r) || n.closest("[hidden]")) continue;
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    if (owner(cx, cy) !== n) continue; // covered (sticky header, an overlay): not tappable here
    measured++;
    const w = reach(n, cx, cy, -1, 0, 40) + reach(n, cx, cy, 1, 0, 40) + 1;
    const h = reach(n, cx, cy, 0, -1, 40) + reach(n, cx, cy, 0, 1, 40) + 1;
    for (const [fx, fy] of [[.1, .15], [.5, .15], [.9, .15], [.1, .85], [.5, .85], [.9, .85]]) {
      const o = owner(r.x + r.width * fx, r.y + r.height * fy);
      if (o && o !== n && !n.contains(o) && !o.contains(n)) { steals.push(`${describe(n)} ← ${describe(o)}`); break; }
    }
    if (w >= MIN && h >= MIN) continue;
    const key = n.tagName.toLowerCase() + (typeof n.className === "string" && n.className.trim() ? "." + n.className.trim().split(/\s+/).join(".") : "");
    const e = small.get(key) || { selector: key, count: 0, looks: `${Math.round(r.width)}×${Math.round(r.height)}`, tappable: `${w}×${h}`, example: describe(n) };
    e.count++;
    small.set(key, e);
  }
  function describe(n) {
    return (n.getAttribute("aria-label") || n.title || n.textContent || n.name || n.className || "").trim().replace(/\s+/g, " ").slice(0, 30);
  }
  const rows = [...small.values()].sort((a, b) => b.count - a.count);
  return { viewport: `${innerWidth}×${innerHeight}`, measured, under44: rows.reduce((s, r) => s + r.count, 0), steals, byClass: rows };
})();
