// Paste into the running app (the Browser pane's javascript_tool, or DevTools)
// at a phone width. Lists every visible pressable smaller than 44×44 CSS px,
// the HIG minimum (DESIGN.md, Accessibility). The selector mirrors PRESSABLE
// in src/app.js plus links, inputs and selects. A target may be smaller than
// 44 when its *hit area* is padded out (::before/::after, a wrapping label);
// the report can't see that, so check the flagged ones by hand.
(() => {
  const SEL = 'button, [role="button"], summary, a[href], input:not([type=hidden]), select, .tab, .cat-chip, .chip-edit, .filter-label, .toggle-label, .jump-item';
  const MIN = 44;
  const seen = new Map();
  for (const n of document.querySelectorAll(SEL)) {
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height || n.closest("[hidden]")) continue;
    const cs = getComputedStyle(n);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (r.width >= MIN && r.height >= MIN) continue;
    const label = (n.getAttribute("aria-label") || n.title || n.textContent || n.name || "").trim().replace(/\s+/g, " ").slice(0, 30);
    const key = n.tagName.toLowerCase() + (n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\s+/).join(".") : "");
    const e = seen.get(key) || { selector: key, count: 0, size: `${Math.round(r.width)}×${Math.round(r.height)}`, example: label };
    e.count++;
    seen.set(key, e);
  }
  const rows = [...seen.values()].sort((a, b) => b.count - a.count);
  return { viewport: `${innerWidth}×${innerHeight}`, under44: rows.reduce((s, r) => s + r.count, 0), byClass: rows };
})();
