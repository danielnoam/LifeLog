// Paste into the running app, then call freeSpace(".selector"). For the first
// visible match, reports how far you can go up, down, left and right from its
// edges (up to 30px) before a tap would land on a different control: the most
// an ::after touch area may reach in each direction. Use half of a gap that's
// shared with a neighbour, so neither steals from the other.
//
// It only knows controls (buttons, links, fields, chips, labels…). A row that
// takes a tap through JS on a plain div — a list item's text that edits on a
// tap, a row that reorders on a hold — reads as free space, so look at the
// row's layout before reaching into it.
window.freeSpace = (sel) => {
  const SEL = 'button, [role="button"], summary, a[href], input:not([type=hidden]), select, textarea, .tab, .cat-chip, .chip-edit, .filter-label, .toggle-label, .jump-item, label';
  const n = [...document.querySelectorAll(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width && r.top > 60 && r.bottom < innerHeight - 100; });
  if (!n) return sel + ": nothing visible (scroll it into view)";
  const r = n.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const other = (x, y) => { const e = document.elementFromPoint(x, y); if (!e) return true; const o = e.closest(SEL); return o && o !== n && !n.contains(o) && !o.contains(n); };
  const scan = (dx, dy, start) => { for (let i = 1; i <= 30; i++) if (other(dx ? start + dx * i : cx, dy ? start + dy * i : cy)) return i - 1; return 30; };
  return `${sel}: ${Math.round(r.width)}×${Math.round(r.height)}, free up ${scan(0, -1, r.top)} down ${scan(0, 1, r.bottom)} left ${scan(-1, 0, r.left)} right ${scan(1, 0, r.right)}`;
};
"freeSpace(selector) ready";
