// LifeLog — drawing boards (0.193.0): the Notes tab's Boards mode. A board is
// a list of elements drawn on an SVG — freehand strokes, rectangles,
// ellipses, lines, arrows and text — with rough.js giving the shapes their
// hand-drawn look. Boards live in their own file (boards.json, see
// Storage.boards) rather than in lifelog.json, so drawing never slows an
// ordinary save; this module owns loading, saving and merging them, the
// board list, and the full-screen editor.
//
// Elements are kept small, because freehand strokes are most of a board:
//   pen    { id, t: "pen", c, sw, p: [x0, y0, dx1, dy1, …] }   integer deltas
//   rect / ellipse { id, t, c, sw, seed, x, y, w, h }
//   line / arrow   { id, t, c, sw, seed, x, y, x2, y2 }
//   text   { id, t: "text", c, sw, x, y, text }                 sw picks the size
//   img    { id, t: "img", x, y, w, h, img, cr, url, miss }
// A picture (img) is one of images.js's, on the lifelog-images branch like
// a note's: `img` is its id. `cr` [x, y, w, h], fractions of the picture,
// is the part shown when it was cropped in Excalidraw. A web picture from
// an Excalidraw drawing isn't kept: `url` is its address, loaded from there
// each time it's shown (Daniel's call, 2026-11-09). One an import couldn't
// find has `miss`, the file it named, for Find in folder.
// A rect or ellipse with `f` is filled with the board's hatching; one
// brought in from Excalidraw with a solid fill also has `fc`, its fill's own
// colour, drawn solid (softened in the dark themes so ink text on it reads).
// `c` is a colour, or "ink" for the theme's text colour, so a board drawn in
// the dark theme still reads in the light one. `seed` keeps a rough shape's
// wobble the same every time it's drawn.
//
// Nov 2026, on any element: `lk` true when locked (can't be moved, turned,
// resized, erased or deleted until unlocked), `gp` a group id (picking one
// picks the group), `ln` "note:<id>" or "board:<id>" (a link, opened from
// its icon). A line or arrow can stick to shapes: `b1` and `b2`, its start
// and end, are { id, fx, fy }, a point on that element's box by fractions,
// so the end follows the shape when it moves, turns or resizes.
//
// Live elements (Nov 2026), boxes of HTML over the drawing:
//   card   { id, t: "card", x, y, w, h, ref, item }  a note, quote or
//          tasks list (`ref`, its id), or one task in a list (`item`),
//          shown as it is now and edited in place
//   embed  { id, t: "embed", x, y, w, h, url }  a YouTube, Spotify or
//          SoundCloud link, a player only once tapped
//   panel  { id, t: "panel", x, y, w, h, kind }  one of Home's sections
// Each also carries x2, y2 (its far corner), so an older build that
// doesn't know them draws a line there rather than failing on the board.
(function () {
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  // Settings → Dates (0.301.0). Under Node nothing loaded dates.js.
  const Dates = () => window.LifeLogDates || require("./dates.js");
  const Tags = () => window.LifeLogTags || require("./tags.js");

  const ico = (n, c) => window.LifeLogIcons.svg(n, c);
  let state, $, el, toast, uid, emptyState, download, Storage, render, bulkCheckbox, toggleBulkItem, attachLongPressSelect;

  function init(ctx) {
    ({ state, $, el, toast, uid, emptyState, download, Storage, render, bulkCheckbox, toggleBulkItem, attachLongPressSelect } = ctx);
  }

  const COLORS = ["ink", "#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5"];
  const WIDTHS = [2, 4, 8];
  const TEXT_SIZE = { 2: 18, 4: 26, 8: 40 };
  // Each tool's key is in Settings → Keyboard (src/keys.js, "board:<id>").
  const TOOLS = [
    ["select", "mouse-pointer-2", i18n.t("Select")], ["hand", "hand", i18n.t("Move the board")],
    ["pen", "pencil", i18n.t("Pen")], ["eraser", "eraser", i18n.t("Eraser")],
    ["rect", "square", i18n.t("Rectangle")], ["ellipse", "circle", i18n.t("Ellipse")],
    ["arrow", "arrow-up-right", i18n.t("Arrow")], ["line", "slash", i18n.t("Line")], ["text", "type", i18n.t("Text")],
    ["image", "image", i18n.t("Image"), " " + i18n.t("— or paste or drop one")],
    ["card", "notebook-text", i18n.t("Note, quote or task card")],
    ["embed", "play", i18n.t("Video or music link")],
    ["panel", "layout-grid", i18n.t("Home panel")],
  ];
  // What the style bar offers: colour and width for anything drawn (width
  // is a text's size), fill only for the shapes that hold one. The select
  // tool offers what fits the unlocked part of the selection; the hand,
  // the eraser and the adding tools offer none.
  const STYLED = new Set(["pen", "rect", "ellipse", "arrow", "line", "text"]);
  const FILLED = new Set(["rect", "ellipse"]);
  function styleFor(tool, sel = []) {
    const kinds = tool === "select" ? sel.filter((e) => !e.lk).map((e) => e.t) : [tool];
    const color = kinds.some((t) => STYLED.has(t));
    return { color, width: color, fill: kinds.some((t) => FILLED.has(t)), size: color && kinds.every((t) => t === "text" || !STYLED.has(t)) };
  }
  // Tools that add something at once rather than drawing.
  const ADDS = new Set(["image", "card", "embed", "panel"]);
  const Keys = () => (typeof window !== "undefined" && window.LifeLogKeys) || null;
  // "Pen (P)", with the key as Settings → Keyboard has it now.
  function toolTitle([id, , label, more = ""]) {
    const K = Keys(), key = K ? K.boardKeyLabel(id) : "";
    return label + (key ? " (" + key + ")" : "") + more;
  }

  // ---------- pure geometry (test/boards.test.js) ----------
  // Ramer–Douglas–Peucker: the fewest points that stay within `eps` of the
  // line the finger drew. Cuts a stroke to about a quarter of its samples.
  function simplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1, far = 0;
      for (let i = a + 1; i < b; i++) {
        const d = segDist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
        if (d > far) { far = d; best = i; }
      }
      if (best > 0 && far > eps) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function encodePoints(pts) {
    const out = [];
    let px = 0, py = 0;
    pts.forEach(([x, y], i) => {
      const rx = Math.round(x), ry = Math.round(y);
      out.push(i ? rx - px : rx, i ? ry - py : ry);
      px = rx; py = ry;
    });
    return out;
  }
  function decodePoints(p) {
    const out = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < p.length; i += 2) {
      x += p[i]; y += p[i + 1];
      out.push([x, y]);
    }
    return out;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  const textLines = (e) => String(e.text || "").split("\n");
  // `fs` once a text has been resized; its width's size until then.
  const textSize = (e) => e.fs || TEXT_SIZE[e.sw] || TEXT_SIZE[4];
  // Measured rather than guessed when a DOM is there to measure with; the
  // guess (a little over half an em per character) is what tests and a
  // first draw get.
  let measureCtx = null;
  function textWidth(line, size) {
    if (typeof document !== "undefined") {
      measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
      if (measureCtx) {
        measureCtx.font = size + "px " + BOARD_FONT;
        return measureCtx.measureText(line).width;
      }
    }
    return line.length * size * 0.56;
  }
  // Virgil (vendored, SIL OFL 1.1) is Excalidraw's hand-drawn face. It has
  // Latin only; Hebrew and the rest fall through to the system font.
  const FONT_URL = "src/vendor/Virgil.woff2";
  const BOARD_FONT = "Virgil, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const ROTATES = new Set(["rect", "ellipse", "text", "img"]);
  // A shape's own box, before any rotation: what `a` turns about its centre.
  const LIVE = new Set(["card", "embed", "panel"]);
  function rawBox(e) {
    if (e.t === "rect" || e.t === "ellipse" || e.t === "img" || LIVE.has(e.t)) return norm(e.x, e.y, e.w, e.h);
    const size = textSize(e), lines = textLines(e);
    return { x: e.x, y: e.y, w: Math.max(size / 2, ...lines.map((l) => textWidth(l, size))), h: lines.length * size * 1.25 };
  }
  function rotatePt(x, y, cx, cy, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
  }
  function bbox(e) {
    if (ROTATES.has(e.t)) {
      const r = rawBox(e);
      if (!e.a) return r;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => rotatePt(x, y, cx, cy, e.a));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    if (LIVE.has(e.t)) return rawBox(e);
    if (e.t === "pen") {
      const pts = decodePoints(e.p);
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [x, y] of pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
      const h = e.sw / 2;
      return { x: x1 - h, y: y1 - h, w: x2 - x1 + e.sw, h: y2 - y1 + e.sw };
    }
    return norm(e.x, e.y, e.x2 - e.x, e.y2 - e.y);
  }
  function norm(x, y, w, h) {
    return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
  }
  function boundsOf(elements) {
    if (!elements.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const e of elements) {
      const b = bbox(e);
      x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  // Whether (x, y) is on the element, within `tol`. An unfilled shape is hit
  // on its outline, like Excalidraw's: tapping inside a box selects what's
  // in it, not the box. A filled one is hit anywhere. A rotated one is
  // tested in its own frame.
  function hitTest(e, x, y, tol) {
    if (e.a && ROTATES.has(e.t)) {
      const r = rawBox(e);
      [x, y] = rotatePt(x, y, r.x + r.w / 2, r.y + r.h / 2, -e.a);
      e = { ...e, a: 0 };
    }
    const reach = tol + (e.sw || 0) / 2;
    if (LIVE.has(e.t)) { const b = rawBox(e); return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol; }
    if (e.t === "pen") {
      const pts = decodePoints(e.p);
      if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= reach;
      for (let i = 1; i < pts.length; i++) if (segDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= reach) return true;
      return false;
    }
    if (e.t === "line" || e.t === "arrow") return segDist(x, y, e.x, e.y, e.x2, e.y2) <= reach;
    if (e.t === "rect") {
      const b = norm(e.x, e.y, e.w, e.h);
      if (e.f && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
      const c = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
      return c.some((p, i) => segDist(x, y, p[0], p[1], c[(i + 1) % 4][0], c[(i + 1) % 4][1]) <= reach);
    }
    if (e.t === "ellipse") {
      const b = norm(e.x, e.y, e.w, e.h);
      const rx = b.w / 2, ry = b.h / 2;
      if (!rx || !ry) return segDist(x, y, b.x, b.y, b.x + b.w, b.y + b.h) <= reach;
      const dx = (x - b.x - rx) / rx, dy = (y - b.y - ry) / ry;
      if (e.f && Math.hypot(dx, dy) <= 1) return true;
      return Math.abs(Math.hypot(dx, dy) - 1) * Math.min(rx, ry) <= reach;
    }
    const b = bbox(e);
    return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
  }
  function moved(e, dx, dy) {
    const out = { ...e };
    if (e.t === "pen") { out.p = e.p.slice(); out.p[0] += Math.round(dx); out.p[1] += Math.round(dy); return out; }
    out.x = Math.round(e.x + dx); out.y = Math.round(e.y + dy);
    if (e.t === "line" || e.t === "arrow") { out.x2 = Math.round(e.x2 + dx); out.y2 = Math.round(e.y2 + dy); }
    if (LIVE.has(e.t)) { out.x2 = out.x + out.w; out.y2 = out.y + out.h; }
    return out;
  }
  // Resizing: every point pushed away from (or towards) the anchor corner by
  // sx, sy. A shape keeps its rotation and scales in its own axes, which is
  // exact for an upright one and close for a turned one; text keeps its
  // proportions and changes size.
  function scaled(e, ax, ay, sx, sy) {
    const S = (x, y) => [ax + (x - ax) * sx, ay + (y - ay) * sy];
    const out = { ...e };
    if (e.t === "pen") { out.p = encodePoints(decodePoints(e.p).map(([x, y]) => S(x, y))); return out; }
    if (e.t === "line" || e.t === "arrow") {
      [out.x, out.y] = S(e.x, e.y).map(Math.round);
      [out.x2, out.y2] = S(e.x2, e.y2).map(Math.round);
      return out;
    }
    const r = rawBox(e);
    const [cx, cy] = S(r.x + r.w / 2, r.y + r.h / 2);
    let w = r.w * sx, h = r.h * sy;
    if (e.t === "text") {
      const k = Math.sqrt(Math.abs(sx * sy));
      out.fs = Math.max(6, Math.round(textSize(e) * k));
      w = r.w * k; h = r.h * k;
    } else { out.w = Math.max(LIVE.has(e.t) ? 40 : 1, Math.round(w)); out.h = Math.max(LIVE.has(e.t) ? 40 : 1, Math.round(h)); }
    out.x = Math.round(cx - w / 2); out.y = Math.round(cy - h / 2);
    if (LIVE.has(e.t)) { out.x2 = out.x + out.w; out.y2 = out.y + out.h; }
    return out;
  }
  // Rotating by `da` about (cx, cy). Lines and strokes turn their points;
  // shapes and text move their centre round and add to their angle.
  function rotated(e, cx, cy, da) {
    if (LIVE.has(e.t)) return e;
    const R = (x, y) => rotatePt(x, y, cx, cy, da);
    const out = { ...e };
    if (e.t === "pen") { out.p = encodePoints(decodePoints(e.p).map(([x, y]) => R(x, y))); return out; }
    if (e.t === "line" || e.t === "arrow") {
      [out.x, out.y] = R(e.x, e.y).map(Math.round);
      [out.x2, out.y2] = R(e.x2, e.y2).map(Math.round);
      return out;
    }
    const r = rawBox(e);
    const [nx, ny] = R(r.x + r.w / 2, r.y + r.h / 2);
    out.x = Math.round(nx - r.w / 2); out.y = Math.round(ny - r.h / 2);
    const TAU = Math.PI * 2;
    const a = (((e.a || 0) + da) % TAU + TAU) % TAU;
    if (a < 1e-3 || TAU - a < 1e-3) delete out.a; else out.a = Math.round(a * 1e4) / 1e4;
    return out;
  }
  // A freehand path through the midpoints between samples, so a stroke drawn
  // with a few points still reads as a curve rather than a zig-zag.
  function penPath(pts) {
    if (!pts.length) return "";
    if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]}l0.01 0`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += `Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    }
    const last = pts[pts.length - 1];
    return d + `L${last[0]} ${last[1]}`;
  }
  // The pen's own smoothing: each point the average of its neighbours, the
  // ends kept, so a shaky hand draws a calmer line. `r` is how many on
  // each side.
  function smoothPoints(pts, r = 2) {
    if (pts.length < 3 || r < 1) return pts.slice();
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const k = Math.min(r, i, pts.length - 1 - i);
      let x = 0, y = 0;
      for (let j = i - k; j <= i + k; j++) { x += pts[j][0]; y += pts[j][1]; }
      out.push([x / (2 * k + 1), y / (2 * k + 1)]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  // Alignment guides: how far to nudge `box` so an edge or the middle lines
  // up with another element's, within `tol`, and the lines to draw for it.
  function guideSnap(box, others, tol) {
    const xs = (b) => [b.x, b.x + b.w / 2, b.x + b.w], ys = (b) => [b.y, b.y + b.h / 2, b.y + b.h];
    let bx = null, by = null;
    for (const o of others) {
      for (const a of xs(box)) for (const t of xs(o)) { const d = t - a; if (Math.abs(d) <= tol && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, at: t }; }
      for (const a of ys(box)) for (const t of ys(o)) { const d = t - a; if (Math.abs(d) <= tol && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, at: t }; }
    }
    const dx = bx ? bx.d : 0, dy = by ? by.d : 0;
    const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
    const lines = [];
    const near = (v) => Math.abs(v) < 0.5;
    if (bx) {
      const on = others.filter((o) => xs(o).some((t) => near(t - bx.at)));
      const y1 = Math.min(moved.y, ...on.map((o) => o.y)), y2 = Math.max(moved.y + moved.h, ...on.map((o) => o.y + o.h));
      lines.push([bx.at, y1, bx.at, y2]);
    }
    if (by) {
      const on = others.filter((o) => ys(o).some((t) => near(t - by.at)));
      const x1 = Math.min(moved.x, ...on.map((o) => o.x)), x2 = Math.max(moved.x + moved.w, ...on.map((o) => o.x + o.w));
      lines.push([x1, by.at, x2, by.at]);
    }
    return { dx: bx ? dx : null, dy: by ? dy : null, lines };
  }
  const snapTo = (v, g) => Math.round(v / g) * g;
  // Sticky arrows: what a line's end at (x, y) sticks to, the topmost shape,
  // text or picture whose box holds the point (within `tol`), or null.
  const STICKS = new Set(["rect", "ellipse", "text", "img", "card", "embed", "panel"]);
  function bindAt(elements, x, y, tol, skip) {
    for (let i = elements.length - 1; i >= 0; i--) {
      const e = elements[i];
      if (!STICKS.has(e.t) || e.id === skip) continue;
      const r = rawBox(e);
      let [lx, ly] = [x, y];
      if (e.a) [lx, ly] = rotatePt(x, y, r.x + r.w / 2, r.y + r.h / 2, -e.a);
      if (lx < r.x - tol || lx > r.x + r.w + tol || ly < r.y - tol || ly > r.y + r.h + tol) continue;
      const f = (v, a, w) => (w ? Math.round(Math.max(0, Math.min(1, (v - a) / w)) * 1000) / 1000 : 0.5);
      return { id: e.id, fx: f(lx, r.x, r.w), fy: f(ly, r.y, r.h) };
    }
    return null;
  }
  function bindPoint(target, b) {
    const r = rawBox(target);
    const x = r.x + r.w * b.fx, y = r.y + r.h * b.fy;
    return target.a ? rotatePt(x, y, r.x + r.w / 2, r.y + r.h / 2, target.a) : [x, y];
  }
  // Every stuck end put back on its shape. The same array when nothing
  // moved, so a redraw costs nothing; a shape that's gone leaves the end
  // where it was (undo brings both back).
  function followBindings(elements) {
    let byId = null, out = null;
    elements.forEach((e, i) => {
      if ((e.t !== "line" && e.t !== "arrow") || (!e.b1 && !e.b2)) return;
      byId = byId || new Map(elements.map((x) => [x.id, x]));
      let next = e;
      for (const [key, px, py] of [["b1", "x", "y"], ["b2", "x2", "y2"]]) {
        const b = e[key], t = b && byId.get(b.id);
        if (!t) continue;
        const [x, y] = bindPoint(t, b).map(Math.round);
        if (x !== next[px] || y !== next[py]) next = { ...next, [px]: x, [py]: y };
      }
      if (next !== e) { out = out || elements.slice(); out[i] = next; }
    });
    return out || elements;
  }
  // A selection's ids grown to whole groups.
  function withGroups(elements, ids) {
    const gps = new Set(elements.filter((e) => ids.has(e.id) && e.gp).map((e) => e.gp));
    if (!gps.size) return ids;
    return new Set([...ids, ...elements.filter((e) => e.gp && gps.has(e.gp)).map((e) => e.id)]);
  }
  // Pasted or imported elements get new ids: groups and stuck ends follow
  // to the new ids, and an end stuck to something left behind comes loose.
  function reid(list, uidFn) {
    const ids = new Map(list.map((e) => [e.id, uidFn()]));
    const gps = new Map();
    return list.map((e) => {
      const out = { ...e, id: ids.get(e.id) };
      if (e.gp) { if (!gps.has(e.gp)) gps.set(e.gp, uidFn()); out.gp = gps.get(e.gp); }
      for (const k of ["b1", "b2"]) {
        if (!e[k]) continue;
        if (ids.has(e[k].id)) out[k] = { ...e[k], id: ids.get(e[k].id) }; else delete out[k];
      }
      return out;
    });
  }
  // A picture's crop as the box it's drawn in: the whole picture's box (what
  // the crop handles can't leave), and back again.
  function fullPictureBox(e) {
    const [cx, cy, cw, ch] = e.cr || [0, 0, 1, 1];
    const W = e.w / cw, H = e.h / ch;
    return { x: e.x - cx * W, y: e.y - cy * H, w: W, h: H };
  }
  function cropFrom(full, box) {
    const r = (v) => Math.round(v * 1e4) / 1e4;
    const cr = [r((box.x - full.x) / full.w), r((box.y - full.y) / full.h), r(box.w / full.w), r(box.h / full.h)];
    return cr[0] === 0 && cr[1] === 0 && cr[2] === 1 && cr[3] === 1 ? null : cr;
  }

  // A board's words, for search: its text elements, in drawing order.
  const boardText = (b) => (b.elements || []).filter((e) => e.t === "text" && e.text).map((e) => e.text).join("\n");

  // A picture's fields hold only what they're for: an id of images.js's
  // shape, an https address, a file name. Nothing else is ever drawn.
  const PIC_ID = /^[a-z0-9]{8,40}\.(jpg|png|gif|webp)$/;
  // A picture's and a board's own fields are checked; anything else rides
  // along untouched, so a device on an older build doesn't strip what a
  // newer one added (tags are coming to boards) when it saves.
  const KNOWN_PICTURE_KEYS = new Set(["id", "t", "x", "y", "w", "h", "a", "img", "url", "miss", "cr"]);
  const KNOWN_BOARD_KEYS = new Set(["id", "name", "createdAt", "updatedAt", "elements", "category", "fav", "scratch", "tags"]);
  const keepOthers = (src, out, known) => {
    for (const k of Object.keys(src || {})) if (!known.has(k)) out[k] = src[k];
    return out;
  };
  function cleanPicture(e) {
    if (e.t !== "img") return e;
    const out = keepOthers(e, { id: e.id, t: "img", x: +e.x || 0, y: +e.y || 0, w: Math.max(1, +e.w || 1), h: Math.max(1, +e.h || 1) }, KNOWN_PICTURE_KEYS);
    if (e.a) out.a = +e.a || 0;
    if (PIC_ID.test(String(e.img || ""))) out.img = e.img;
    if (/^https:\/\/[^\s"<>]+$/i.test(String(e.url || "")) && e.url.length <= 2000) out.url = e.url;
    if (e.miss) out.miss = String(e.miss).slice(0, 300);
    if (Array.isArray(e.cr) && e.cr.length === 4 && e.cr.every((v) => Number.isFinite(+v))) {
      const [cx, cy, cw, ch] = e.cr.map(Number);
      if (cw > 0 && ch > 0 && (cx || cy || cw < 1 || ch < 1)) out.cr = [cx, cy, cw, ch];
    }
    return out.img || out.url || out.miss ? out : null;
  }
  // The Nov 2026 fields any element can carry, each kept only in its shape.
  const LINK = /^(note|board):[\w-]{1,80}$/;
  function cleanShared(e) {
    if (!("lk" in e || "gp" in e || "ln" in e || "b1" in e || "b2" in e)) return e;
    const out = { ...e };
    if (out.lk !== true) delete out.lk;
    if (typeof out.gp !== "string" || !out.gp || out.gp.length > 80) delete out.gp;
    if (!LINK.test(String(out.ln || ""))) delete out.ln;
    for (const k of ["b1", "b2"]) {
      const v = out[k];
      if (!v || typeof v.id !== "string" || !Number.isFinite(+v.fx) || !Number.isFinite(+v.fy) || (e.t !== "line" && e.t !== "arrow")) delete out[k];
      else out[k] = { id: v.id, fx: Math.max(0, Math.min(1, +v.fx)), fy: Math.max(0, Math.min(1, +v.fy)) };
    }
    return out;
  }
  // A live element's fields, checked: a player only for the three sites it
  // knows, a panel only for a Home section, a card only with an id.
  const PANEL_KINDS = ["progress", "upcoming", "scratchpad", "pinned", "ledger", "invest", "calendar", "pick", "year"];
  function cleanLive(e) {
    if (!LIVE.has(e.t)) return e;
    const out = { ...e, x: Math.round(+e.x || 0), y: Math.round(+e.y || 0), w: Math.max(40, Math.round(+e.w || 0)), h: Math.max(40, Math.round(+e.h || 0)) };
    out.x2 = out.x + out.w; out.y2 = out.y + out.h;
    if (e.t === "card") {
      if (typeof e.ref !== "string" || !e.ref || e.ref.length > 80) return null;
      if (e.item != null && (typeof e.item !== "string" || e.item.length > 80)) delete out.item;
    }
    if (e.t === "embed" && !playerOf(e.url)) return null;
    if (e.t === "panel" && !PANEL_KINDS.includes(e.kind)) return null;
    return out;
  }
  // A link a player can be made from: { site, src, ratio, tall } or null.
  // Nothing is fetched from the site until the player is tapped.
  function playerOf(url) {
    let u;
    try { u = new URL(String(url || "")); } catch (e) { return null; }
    if (u.protocol !== "https:" || String(url).length > 500) return null;
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtube.com" || host === "youtu.be") {
      const id = host === "youtu.be" ? u.pathname.slice(1).split("/")[0]
        : u.pathname === "/watch" ? u.searchParams.get("v") : (/^\/(?:shorts|embed|live)\/([^/]+)/.exec(u.pathname) || [])[1];
      if (!/^[\w-]{6,20}$/.test(id || "")) return null;
      const t = parseInt(u.searchParams.get("t") || u.searchParams.get("start") || "", 10);
      return { site: "YouTube", src: "https://www.youtube-nocookie.com/embed/" + id + (t > 0 ? "?start=" + t : ""), ratio: 16 / 9 };
    }
    if (host === "open.spotify.com") {
      const m = /^\/(?:intl-[\w-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,40})/.exec(u.pathname);
      if (!m) return null;
      return { site: "Spotify", src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, tall: m[1] !== "track" && m[1] !== "episode" };
    }
    if (host === "soundcloud.com") {
      if (!/^\/[\w-]+\/[\w-]+/.test(u.pathname)) return null;
      return { site: "SoundCloud", src: "https://w.soundcloud.com/player/?url=" + encodeURIComponent("https://soundcloud.com" + u.pathname) + "&visual=true" };
    }
    return null;
  }
  function sanitizeBoard(b) {
    const out = {
      id: b.id || (uid ? uid() : "b" + Date.now().toString(36)),
      name: String(b.name == null ? "" : b.name).trim() || "Untitled board",
      createdAt: b.createdAt || null,
      updatedAt: b.updatedAt || b.createdAt || "1970-01-01T00:00:00.000Z",
      elements: Array.isArray(b.elements) ? b.elements.filter((e) => e && e.id && e.t).map(cleanPicture).filter(Boolean).map(cleanLive).filter(Boolean).map(cleanShared) : [],
    };
    // A note category (0.206.0), so a board sits in the feed and in a
    // collection beside the notes it belongs with.
    const cat = String(b.category == null ? "" : b.category).trim();
    if (cat) out.category = cat;
    // Tags (Nov 2026), shared with notes and tasks; see tags.js.
    const tags = Tags().clean(b.tags);
    if (tags.length) out.tags = tags;
    // ★, as a note has (0.208.0): first on the Boards page and in Favourites.
    if (b.fav) out.fav = true;
    // Home's scratchpad in Board mode: kept out of the Boards list and the
    // feed until Save to Notebook files it.
    if (b.scratch) out.scratch = true;
    return keepOthers(b, out, KNOWN_BOARD_KEYS);
  }

  // ---------- the document ----------
  let doc = null, loading = null, loadedAt = 0;
  let saveTimer = null, saving = null, changedSince = 0;
  const boards = () => (doc ? doc.boards : []);
  const listed = () => boards().filter((b) => !b.scratch);
  const findBoard = (id) => boards().find((b) => b.id === id);

  function ensureLoaded(force) {
    if (doc && !force) return Promise.resolve(doc);
    if (loading) return loading;
    loading = Storage.boards.load().then(({ doc: d, dirty }) => {
      d = { boards: (d.boards || []).map(sanitizeBoard) };
      // Anything drawn while the load was out is kept, merged over what came
      // back with what this device had before as the ancestor.
      doc = doc && changedSince ? { boards: window.LifeLogMerge.mergeBoards(lastSent, doc.boards, d.boards) } : d;
      loadedAt = Date.now();
      if (dirty) scheduleSave(0);
      return doc;
    }).finally(() => { loading = null; });
    return loading;
  }

  // Every change stamps its board and asks for a save shortly after: a board
  // is drawn in bursts, and a commit per stroke would bury the file's
  // history. Leaving the editor, the mode or the app sends it at once.
  let lastSent = null;
  function changed(board) {
    board.updatedAt = new Date().toISOString();
    changedSince++;
    scheduleSave(2500);
  }
  function scheduleSave(ms) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, ms);
  }
  async function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!doc) return;
    if (saving) { await saving; if (!changedSince) return; }
    const sent = JSON.parse(JSON.stringify(doc.boards));
    const mark = changedSince;
    // Pictures go up before the boards that show them, as a note's do
    // before lifelog.json; one that fails waits for the next save.
    const pics = window.LifeLogImages && sent.some((b) => b.elements.some((e) => e.t === "img" && e.img))
      ? window.LifeLogImages.uploadPending(state && state.data).catch(() => {}) : Promise.resolve();
    saving = pics.then(() => Storage.boards.save({ boards: sent })).then((res) => {
      if (res.merged) {
        // Another device saved first and got merged in. Take the merge, and
        // keep whatever was drawn here while the save was out.
        doc = { boards: changedSince !== mark
          ? window.LifeLogMerge.mergeBoards(sent, doc.boards, res.doc.boards)
          : res.doc.boards.map(sanitizeBoard) };
        if (editing) redrawAfterMerge();
        else if (isBoardsMode()) render();
      }
      lastSent = sent;
      if (changedSince === mark) changedSince = 0;
    }).catch(() => {}).finally(() => { saving = null; });
    await saving;
    if (changedSince) scheduleSave(2500);
  }

  async function addBoards(list) {
    await ensureLoaded();
    const ids = new Set(boards().map((b) => b.id));
    for (const raw of list) {
      const b = sanitizeBoard(raw);
      if (ids.has(b.id)) b.id = uid();
      ids.add(b.id);
      doc.boards.push(b);
    }
    changedSince++;
    await flush();
    if (isBoardsMode()) render();
  }
  // ---------- Home's scratch board ----------
  // One board flagged scratch. Two devices that each started one before
  // syncing leave two: the newest stays the scratchpad and the others
  // become ordinary boards, so nothing drawn is hidden for good.
  function scratchBoard() {
    const all = boards().filter((b) => b.scratch)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for (const extra of all.slice(1)) { delete extra.scratch; changed(extra); }
    return all[0] || null;
  }
  async function openScratch() {
    await ensureLoaded();
    let b = scratchBoard();
    if (!b) {
      const now = new Date().toISOString();
      b = sanitizeBoard({ id: uid(), name: "Scratchpad", scratch: true, createdAt: now, updatedAt: now, elements: [] });
      doc.boards.push(b);
      changed(b);
    }
    openBoard(b.id);
  }
  // Files the drawing as a board of its own; the next Board-mode tap
  // starts a blank one.
  async function keepScratch() {
    await ensureLoaded();
    const b = scratchBoard();
    if (!b || !b.elements.length) return null;
    delete b.scratch;
    if (b.name === "Scratchpad") b.name = i18n.t("Board {n}", { n: listed().length });
    changed(b);
    await flush();
    return b;
  }

  function toggleFav(id) {
    const b = findBoard(id);
    if (!b) return;
    if (b.fav) delete b.fav; else b.fav = true;
    changed(b);
    render();
  }
  // Selecting boards with notes (0.208.0): the bulk bar's Move and Delete.
  // The caller asks before deleting and re-renders after.
  async function setCategory(ids, category) {
    await ensureLoaded();
    let n = 0;
    for (const b of boards()) {
      if (!ids.includes(b.id)) continue;
      if (category) b.category = category; else delete b.category;
      changed(b);
      n++;
    }
    if (n) await flush();
    return n;
  }
  // A note category renamed, or deleted (`to` null), in the Notes tab: the
  // boards filed under it follow, as its notes do. Pure on a list, for the
  // AI bridge, which edits boards.json itself; the boards changed come back.
  function renameCategoryIn(list, from, to) {
    const hit = list.filter((b) => b.category === from);
    for (const b of hit) { if (to) b.category = to; else delete b.category; }
    return hit;
  }
  // A tag renamed, or deleted (`to` empty), from All tags: the boards
  // carrying it follow. Pure on a list for the bridge, like renameCategoryIn.
  function renameTagIn(list, from, to) {
    const hit = [];
    for (const b of list) {
      const r = Tags().renamed(b.tags, from, to);
      if (!r) continue;
      if (r.length) b.tags = r; else delete b.tags;
      hit.push(b);
    }
    return hit;
  }
  async function renameTag(from, to) {
    try { await ensureLoaded(); } catch (e) { return; }
    const hit = renameTagIn(boards(), from, to);
    hit.forEach(changed);
    if (hit.length) await flush();
  }
  async function renameCategory(from, to) {
    try { await ensureLoaded(); } catch (e) { return; }
    const hit = renameCategoryIn(boards(), from, to);
    hit.forEach(changed);
    if (hit.length) await flush();
  }
  async function deleteBoards(ids) {
    await ensureLoaded();
    const before = boards().length;
    doc.boards = doc.boards.filter((b) => !ids.includes(b.id));
    const n = before - doc.boards.length;
    if (n) { changedSince++; await flush(); }
    return n;
  }
  // Pictures an import couldn't find, by board, for Find in folder.
  async function missingPictures(ids) {
    await ensureLoaded();
    return boards().filter((b) => !ids || ids.includes(b.id))
      .flatMap((b) => b.elements.filter((e) => e.t === "img" && !e.img && e.miss).map((e) => ({ board: b.id, id: e.id, miss: e.miss })));
  }
  // found: [{ board, id, img }]: each picture now kept, put on its board.
  async function linkPictures(found) {
    await ensureLoaded();
    let n = 0;
    for (const f of found) {
      const b = findBoard(f.board);
      const i = b ? b.elements.findIndex((e) => e.id === f.id) : -1;
      if (i < 0) continue;
      const { miss, url, ...rest } = b.elements[i];
      b.elements[i] = { ...rest, img: f.img };
      changed(b);
      n++;
    }
    if (n) { await flush(); if (editing) redraw(); else if (isBoardsMode()) render(); }
    return n;
  }
  async function boardsForExport() {
    await ensureLoaded();
    return JSON.parse(JSON.stringify(boards()));
  }

  // A Google Drive restore: every board as the backup has it, stamped now
  // so a merge with another device's copy keeps them.
  async function replaceAll(list) {
    await ensureLoaded();
    const at = new Date().toISOString();
    doc.boards = list.map((b) => ({ ...sanitizeBoard(b), updatedAt: at }));
    changedSince++;
    await flush();
    if (isBoardsMode()) render();
  }

  // ---------- history (Settings → History → Boards) ----------
  // Versions of boards.json, this device's and GitHub's. Opening one lists
  // its boards against what you have now; any that changed or has gone can
  // be brought back on its own, without rolling the other boards back.
  const sameBoard = (a, b) => a && b && a.name === b.name && (a.category || "") === (b.category || "") && !!a.fav === !!b.fav && JSON.stringify(a.tags || []) === JSON.stringify(b.tags || []) && JSON.stringify(a.elements) === JSON.stringify(b.elements);
  async function renderHistory(list, status) {
    status.hidden = false;
    status.textContent = i18n.t("Loading…");
    list.innerHTML = "";
    let versions;
    try { await ensureLoaded(); versions = await Storage.boards.history(); }
    catch (e) { status.textContent = i18n.t("Couldn't load board history: {error}", { error: e.message || e }); return; }
    if (!versions.length) { status.textContent = i18n.t("No board saves yet."); list.hidden = true; return; }
    status.hidden = true;
    list.hidden = false;
    for (const v of versions) {
      const row = el("div", "sitem board-hist-row");
      const text = el("span", "sitem-text");
      text.appendChild(el("span", "sitem-title", Dates().dateTime(v.savedAt)));
      text.appendChild(el("span", "sitem-sub", v.bridge ? (v.bridge.by || "AI") + " · " + v.bridge.summary : v.source === "github" ? "GitHub" : i18n.t("This device")));
      row.appendChild(text);
      const btns = el("span", "sitem-btns");
      const open = el("button", "btn btn-small", i18n.t("Open"));
      open.type = "button";
      btns.appendChild(open);
      row.appendChild(btns);
      const inner = el("div", "board-hist-boards");
      inner.hidden = true;
      open.onclick = async () => {
        if (!inner.hidden) { inner.hidden = true; open.textContent = i18n.t("Open"); return; }
        open.disabled = true;
        try { fillVersion(inner, await Storage.boards.version(v), v); inner.hidden = false; open.textContent = i18n.t("Close"); }
        catch (e) { toast(i18n.t("Couldn't read that version: {error}", { error: e.message || e }), true); }
        open.disabled = false;
      };
      list.appendChild(row);
      list.appendChild(inner);
    }
  }
  function fillVersion(inner, version, v) {
    inner.innerHTML = "";
    const then = (version.boards || []).map(sanitizeBoard);
    if (!then.length) { inner.appendChild(el("p", "muted board-hist-empty", i18n.t("No boards in this version."))); return; }
    for (const b of then) {
      const now = findBoard(b.id);
      const row = el("div", "sitem board-hist-board");
      const text = el("span", "sitem-text");
      text.appendChild(el("span", "sitem-title", b.name));
      const status = !now ? i18n.t("Deleted since") : sameBoard(now, b) ? i18n.t("Same as now") : i18n.t("Changed since");
      text.appendChild(el("span", "sitem-sub", i18n.tn(b.elements.length, "{n} element", "{n} elements") + " · " + status));
      row.appendChild(text);
      if (!sameBoard(now, b)) {
        const btns = el("span", "sitem-btns");
        const back = el("button", "btn btn-small", i18n.t("Bring back"));
        back.type = "button";
        back.onclick = async () => { if (await restoreBoard(b, v)) { back.remove(); text.lastChild.textContent = i18n.tn(b.elements.length, "{n} element", "{n} elements") + " · " + i18n.t("Brought back"); } };
        btns.appendChild(back);
        row.appendChild(btns);
      }
      inner.appendChild(row);
    }
  }
  // Puts a past version of one board back: over the board where it still
  // exists, as it was where it doesn't.
  async function restoreBoard(b, v) {
    await ensureLoaded();
    const now = findBoard(b.id);
    const when = Dates().dateTime(v.savedAt);
    if (!confirm(now ? i18n.t("Put \"{name}\" back to how it was on {when}? What's on it now is replaced.", { name: b.name, when }) : i18n.t("Bring back \"{name}\" as it was on {when}?", { name: b.name, when }))) return false;
    const copy = { ...JSON.parse(JSON.stringify(b)), updatedAt: new Date().toISOString() };
    if (now) doc.boards = doc.boards.map((x) => (x.id === b.id ? copy : x));
    else doc.boards.push(copy);
    changedSince++;
    await flush();
    toast(i18n.t("Brought back \"{name}\"", { name: b.name }));
    if (isBoardsMode()) render();
    return true;
  }

  // ---------- boards in Notes ----------
  // A mode of its own until 0.204.0; now the Boards kind in the Notes mode's
  // switch, beside Notes, Lists and Quotes.
  const isBoardsMode = () => state.view === "notes" && state.notesMode === "notes"
    && state.noteKinds.size === 1 && state.noteKinds.has("board");
  function renderBoards(root) {
    if (!doc) {
      root.appendChild(el("p", "muted boards-loading", i18n.t("Loading boards…")));
      ensureLoaded().then(() => { if (isBoardsMode()) render({ keepSnapshots: true }); });
      return;
    }
    // Picks up another device's drawing when you come back to the list.
    if (Date.now() - loadedAt > 60000 && !editing && !changedSince) {
      ensureLoaded(true).then(() => { if (isBoardsMode() && !editing) render({ keepSnapshots: true }); });
    }
    fontReady().then((fresh) => { if (fresh && isBoardsMode() && !editing) render({ keepSnapshots: true }); });
    // #tag in the search asks for a tag, as in the feed.
    const parsed = Tags().parseQuery(state.search || "");
    const q = parsed.text.toLowerCase();
    // The note category chips narrow boards too (0.207.0); "" is no category.
    const cf = state.noteActiveCats;
    // So do the tag chips (Nov 2026): any of them.
    const tf = new Set([...(state.noteActiveTags || []), ...parsed.tags].map(Tags().key));
    const list = listed().filter((b) => (!q || b.name.toLowerCase().includes(q) || (b.tags || []).some((t) => t.toLowerCase().includes(q)))
      && (!cf || !cf.size || cf.has(b.category || "")) && (!tf.size || Tags().hasAny(b.tags, tf)))
      .sort((a, b) => (!!b.fav - !!a.fav) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (!listed().length) {
      root.appendChild(emptyState({
        glyph: "presentation", title: i18n.t("No boards yet"),
        body: i18n.t("A board is a page to draw on: sketches, diagrams, arrows and notes, in a hand-drawn style."),
        action: i18n.t("New board"), onAction: askNewBoard,
      }));
      return;
    }
    const grid = el("div", "board-grid");
    const bulk = state.bulk.active;
    if (!bulk) {
      const add = el("button", "board-card board-new");
      add.type = "button";
      add.appendChild(el("span", "board-new-plus", "+"));
      add.appendChild(el("span", "board-new-label", i18n.t("New board")));
      add.onclick = askNewBoard;
      grid.appendChild(add);
    }
    for (const b of list) {
      // Selected under the same "board:<id>" the feed's stand-ins use, so
      // one bulk bar (notes.js) moves and deletes notes and boards alike.
      const key = "board:" + b.id;
      const card = el("div", "board-card");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.dataset.id = b.id;
      const activate = () => (state.bulk.active ? toggleBulkItem(key) : openBoard(b.id));
      card.onkeydown = (ev) => { if (ev.target === card && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); activate(); } };
      if (bulk) {
        card.classList.add("is-bulk");
        card.classList.toggle("is-selected", state.bulk.selected.has(key));
        card.appendChild(bulkCheckbox({ id: key }));
      } else attachLongPressSelect(card, { id: key }, "note");
      const thumb = el("div", "board-thumb");
      thumb.appendChild(boardSvg(b.elements, { thumb: true }));
      card.appendChild(thumb);
      const meta = el("div", "board-meta");
      meta.appendChild(el("span", "board-name", b.name));
      if (b.category) {
        const cat = (state.data.noteCategories || []).find((c) => c.name === b.category);
        const tag = el("span", "board-cat");
        const dot = el("span", "dot"); dot.style.background = (cat && cat.color) || "#7a8a99";
        tag.append(dot, document.createTextNode(b.category));
        meta.appendChild(tag);
      }
      if (b.tags) meta.appendChild(window.LifeLogNotes.tagPills(b.tags));
      meta.appendChild(el("span", "board-when", when(b.updatedAt)));
      card.appendChild(meta);
      if (!bulk) card.appendChild(favButton(b));
      card.onclick = activate;
      grid.appendChild(card);
    }
    if (!list.length) root.appendChild(el("p", "muted", q ? i18n.t("No board is called that.") : tf.size ? i18n.t("No boards with that tag.") : i18n.t("No boards in that category.")));
    root.appendChild(grid);
  }
  function favButton(b) {
    const fav = el("button", "note-fav board-fav" + (b.fav ? " on" : ""));
    fav.appendChild(ico("star", b.fav ? "is-fill" : ""));
    fav.type = "button";
    fav.title = b.fav ? i18n.t("Remove from favourites") : i18n.t("Add to favourites");
    fav.setAttribute("aria-label", fav.title);
    fav.setAttribute("aria-pressed", String(!!b.fav));
    fav.onclick = (ev) => { ev.stopPropagation(); toggleFav(b.id); };
    return fav;
  }
  function when(iso) {
    const d = new Date(iso);
    if (isNaN(d) || d.getFullYear() < 1971) return "";
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return Dates().day(d, { year: "auto" });
  }

  // A new board is named and filed first, in the notes sheet (0.314.0);
  // tapping the blank board there makes it.
  const askNewBoard = () => window.LifeLogNotes.openNoteModal(null, "board");
  const nextName = () => i18n.t("Board {n}", { n: listed().length + 1 });
  async function newBoard({ name, category, tags } = {}) {
    await ensureLoaded();
    const now = new Date().toISOString();
    const b = sanitizeBoard({ id: uid(), name: name || nextName(), category, tags, createdAt: now, updatedAt: now, elements: [] });
    doc.boards.push(b);
    changed(b);
    openBoard(b.id);
  }

  // ---------- drawing ----------
  const SVG = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  };
  const inkOf = (c) => (c === "ink" ? "currentColor" : c);
  let roughGen = null;
  const roughCache = new Map();
  function roughPaths(e) {
    if (!window.rough) return null;
    roughGen = roughGen || window.rough.generator();
    const key = JSON.stringify([e.t, e.x, e.y, e.w, e.h, e.x2, e.y2, e.sw, e.seed, !!e.f, !!e.fc]);
    const hit = roughCache.get(e.id);
    if (hit && hit.key === key) return hit.paths;
    // "S" and "F" stand in for the stroke and fill colour: the colour itself
    // is applied at draw time, so a recolour or a theme change needs no new
    // paths. A fill is rough.js's hachure — strokes, drawn in the fill colour.
    const o = { seed: e.seed || 1, roughness: 1.1, bowing: 1, strokeWidth: e.sw, stroke: "S" };
    if (e.f && e.fc) Object.assign(o, { fill: "F", fillStyle: "solid" });
    else if (e.f) Object.assign(o, { fill: "F", fillStyle: "hachure", hachureGap: 5 + e.sw, fillWeight: Math.max(1, e.sw / 2) });
    let drawables;
    if (e.t === "rect") drawables = [roughGen.rectangle(e.x, e.y, e.w, e.h, o)];
    else if (e.t === "ellipse") drawables = [roughGen.ellipse(e.x + e.w / 2, e.y + e.h / 2, Math.abs(e.w), Math.abs(e.h), o)];
    else {
      drawables = [roughGen.line(e.x, e.y, e.x2, e.y2, o)];
      if (e.t === "arrow") for (const [hx, hy] of arrowHead(e)) drawables.push(roughGen.line(e.x2, e.y2, hx, hy, o));
    }
    const paths = drawables.flatMap((d) => roughGen.toPaths(d))
      .map((p) => ({ d: p.d, stroke: p.stroke !== "none", fill: !!p.fill && p.fill !== "none", w: p.strokeWidth }));
    roughCache.set(e.id, { key, paths });
    return paths;
  }
  function arrowHead(e) {
    const len = Math.hypot(e.x2 - e.x, e.y2 - e.y);
    const size = Math.min(len * 0.35, 12 + e.sw * 3);
    const ang = Math.atan2(e.y2 - e.y, e.x2 - e.x);
    return [ang + Math.PI * 0.82, ang - Math.PI * 0.82].map((a) => [e.x2 + Math.cos(a) * size, e.y2 + Math.sin(a) * size]);
  }
  // ---------- pictures ----------
  // Where each picture is shown from, once known: an object URL from
  // images.js (this device, else fetched from GitHub once), or null when
  // it's in neither place yet. Drawing never waits: a picture still on its
  // way is a placeholder, swapped for the picture wherever it's drawn when
  // it comes.
  // One not found anywhere is asked for again a minute later, as another
  // device may upload it meanwhile.
  const picUrls = new Map(), picMissed = new Map();
  const picWaiting = new Set();
  function pictureUrl(id) {
    if (picUrls.has(id)) return picUrls.get(id);
    if (!picWaiting.has(id) && window.LifeLogImages && !(Date.now() - (picMissed.get(id) || 0) < 60000)) {
      picWaiting.add(id);
      window.LifeLogImages.url(id).catch(() => null).then((u) => {
        picWaiting.delete(id);
        if (!u) { picMissed.set(id, Date.now()); return; }
        picUrls.set(id, u);
        refreshPictures((n) => n.__el.img === id);
      });
    }
    return null;
  }
  function refreshPictures(which) {
    if (typeof document === "undefined") return;
    for (const n of document.querySelectorAll("[data-pic]")) {
      if (n.__el && which(n)) n.replaceWith(drawElement(n.__el, n.__opts));
    }
  }
  // A picture: the image inside its own box, cropped by the box's viewBox.
  // `opts.picture(e)` is an import's preview, a picture read from the files
  // picked and not kept yet.
  function drawPicture(e, opts) {
    const r = norm(e.x, e.y, e.w, e.h);
    const g = svgEl("g", { "data-id": e.id, "data-pic": e.img || e.url || e.miss || "", transform: turn(e) });
    g.__el = e; g.__opts = opts;
    let href = e.img ? pictureUrl(e.img) : null;
    if (!href && opts && opts.picture) {
      const pre = opts.preview && opts.preview.get(e.id);
      if (pre) href = pre;
      else if (opts.preview && !opts.preview.has(e.id)) {
        opts.preview.set(e.id, null);
        Promise.resolve(opts.picture(e)).catch(() => null).then((u) => {
          if (!u) return;
          opts.preview.set(e.id, u);
          refreshPictures((n) => n.__el === e);
        });
      }
    }
    if (!href && !e.img && e.url) href = e.url;
    if (href) {
      const [cx, cy, cw, ch] = e.cr || [0, 0, 1, 1];
      const box = svgEl("svg", { x: r.x, y: r.y, width: r.w, height: r.h, viewBox: `${cx} ${cy} ${cw} ${ch}`, preserveAspectRatio: "none", overflow: "hidden" });
      const img = svgEl("image", { x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: "none", href });
      // A web address that doesn't answer is a placeholder after all.
      if (href === e.url) img.addEventListener("error", () => { g.replaceChildren(...placeholder(e, r)); }, { once: true });
      box.appendChild(img);
      g.appendChild(box);
      return g;
    }
    g.append(...placeholder(e, r));
    return g;
  }
  // Dashed, with the image icon and what it was, so a picture that hasn't
  // come yet still takes its room and can be moved or deleted.
  function placeholder(e, r) {
    const out = [svgEl("rect", { x: r.x, y: r.y, width: r.w, height: r.h, class: "board-pic-wait", rx: 6 })];
    const s = Math.min(48, r.w * 0.4, r.h * 0.4);
    if (s >= 12) {
      const icon = svgEl("svg", { x: r.x + r.w / 2 - s / 2, y: r.y + r.h / 2 - s / 2 - (e.miss || e.url ? s * 0.3 : 0), width: s, height: s,
        viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", class: "board-pic-icon" });
      const ico = window.LifeLogIcons && window.LifeLogIcons.svg("image");
      if (ico) for (const c of [...ico.childNodes]) icon.appendChild(c);
      out.push(icon);
    }
    const name = e.miss || e.url;
    if (name && r.w > 80 && r.h > 60) {
      const fs = Math.max(10, Math.min(14, r.w / 18));
      const label = String(name).replace(/^.*[\\/]/, "");
      const max = Math.floor(r.w / (fs * 0.6)) - 2;
      const t = svgEl("text", { x: r.x + r.w / 2, y: r.y + r.h / 2 + s * 0.55 + fs, "font-size": fs, "text-anchor": "middle", class: "board-pic-label" });
      t.textContent = label.length > max ? label.slice(0, Math.max(1, max - 1)) + "…" : label;
      out.push(t);
    }
    return out;
  }
  function drawElement(e, opts) {
    if (e.t === "img") return drawPicture(e, opts);
    if (LIVE.has(e.t)) return drawLiveStill(e);
    const color = inkOf(e.c);
    if (e.t === "pen") {
      return svgEl("path", { d: penPath(decodePoints(e.p)), stroke: color, "stroke-width": e.sw, fill: "none",
        "stroke-linecap": "round", "stroke-linejoin": "round", "data-id": e.id });
    }
    if (e.t === "text") {
      const size = textSize(e);
      const t = svgEl("text", { x: e.x, y: e.y, fill: color, "font-size": size, "data-id": e.id, class: "board-text", transform: turn(e) });
      textLines(e).forEach((line, i) => {
        const span = svgEl("tspan", { x: e.x, dy: i ? size * 1.25 : size * 0.95 });
        span.textContent = line || " ";
        t.appendChild(span);
      });
      return t;
    }
    const g = svgEl("g", { "data-id": e.id, stroke: color, "stroke-width": e.sw, fill: "none", "stroke-linecap": "round", transform: turn(e) });
    const paths = roughPaths(e);
    if (paths) {
      for (const p of paths) {
        const solid = p.fill && e.f && e.fc;
        g.appendChild(svgEl("path", { d: p.d, stroke: p.stroke ? color : "none", fill: p.fill ? (solid ? inkOf(e.fc) : color) : "none",
          "fill-opacity": solid ? solidOpacity() : null, "stroke-width": p.w }));
      }
    } else if (e.t === "rect" || e.t === "ellipse") {
      const solid = e.f && e.fc ? { fill: inkOf(e.fc), "fill-opacity": solidOpacity() } : {};
      g.appendChild(e.t === "rect" ? svgEl("rect", { ...(({ x, y, w, h }) => ({ x, y, width: w, height: h }))(norm(e.x, e.y, e.w, e.h)), ...solid })
        : svgEl("ellipse", { cx: e.x + e.w / 2, cy: e.y + e.h / 2, rx: Math.abs(e.w / 2), ry: Math.abs(e.h / 2), ...solid }));
    }
    else {
      g.appendChild(svgEl("line", { x1: e.x, y1: e.y, x2: e.x2, y2: e.y2 }));
      if (e.t === "arrow") for (const [hx, hy] of arrowHead(e)) g.appendChild(svgEl("line", { x1: e.x2, y1: e.y2, x2: hx, y2: hy }));
    }
    return g;
  }
  // A live element where HTML can't go (thumbnails, PNG and SVG export): a
  // card with its name, so the picture still says what was there.
  function drawLiveStill(e) {
    const g = svgEl("g", { "data-id": e.id, class: "board-still" });
    g.appendChild(svgEl("rect", { x: e.x, y: e.y, width: e.w, height: e.h, rx: 12 }));
    const label = svgEl("text", { x: e.x + 14, y: e.y + 26, "font-size": 15 });
    label.textContent = cut(liveTitle(e), Math.max(4, Math.floor((e.w - 28) / 8)));
    g.appendChild(label);
    return g;
  }
  const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  function liveTitle(e) {
    if (e.t === "embed") { const p = playerOf(e.url); return (p ? p.site + " · " : "") + e.url.replace(/^https:\/\/(www\.)?/, ""); }
    if (e.t === "panel") { const H = typeof window !== "undefined" && window.LifeLogHome; const sec = H && H.SECTIONS.find(([id]) => id === e.kind); return sec ? sec[1] : e.kind; }
    const n = cardNote(e);
    if (!n) return i18n.t("A note that's gone");
    if (e.item) { const it = (n.items || []).find((i) => i.id === e.item); return it ? it.text : i18n.t("A task that's gone"); }
    const N = typeof window !== "undefined" && window.LifeLogNotes;
    return (N && N.linkTitle ? N.linkTitle(n) : "") || String(n.text || "").split("\n")[0] || i18n.t("Untitled");
  }
  const cardNote = (e) => ((state && state.data && state.data.notes) || []).find((n) => n.id === e.ref) || null;

  // Excalidraw's fills are pale, picked for a white page: full strength in
  // the Light theme, toned down on a dark one so the ink on them reads.
  const solidOpacity = () => (typeof document !== "undefined" && document.documentElement.classList.contains("theme-light") ? 1 : 0.4);
  function turn(e) {
    if (!e.a || !ROTATES.has(e.t)) return null;
    const r = rawBox(e);
    return `rotate(${e.a * 180 / Math.PI} ${r.x + r.w / 2} ${r.y + r.h / 2})`;
  }
  // A board as a standalone SVG: the list's thumbnails, and the export.
  function boardSvg(elements, { thumb = false, pad = 24, picture = null } = {}) {
    const b = boundsOf(elements) || { x: 0, y: 0, w: 320, h: 200 };
    const svg = svgEl("svg", { viewBox: `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`, class: thumb ? "board-thumb-svg" : null });
    if (thumb) svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const opts = picture ? { picture, preview: new Map() } : null;
    for (const e of elements) svg.appendChild(drawElement(e, opts));
    return svg;
  }

  // ---------- the editor ----------
  let editing = null;        // the board open in the editor
  let view = { x: 0, y: 0, k: 1 };
  let tool = "pen", color = "ink", width = 4, fill = false;
  let selection = new Set();
  let undoStack = [], redoStack = [];
  let op = null;             // what the pointer is doing
  const pointers = new Map();
  let pinch = null;
  let spaceDown = false;
  let lastTap = null;
  let svg, world, overlay, liveLayer, liveEls;
  let cropping = null;       // { id, full }: a picture being cropped
  // Board options (Nov 2026), per device: the grid behind the drawing,
  // snapping to it, alignment guides, arrows that stick, the pen's smoothing.
  const OPTS_KEY = "lifelog-board-opts-v1";
  const OPT_DEFAULTS = { grid: false, snap: false, guides: true, stick: true, smooth: true };
  const GRID = 24;
  let opts = { ...OPT_DEFAULTS };
  try { opts = { ...OPT_DEFAULTS, ...JSON.parse(localStorage.getItem(OPTS_KEY) || "{}") }; } catch (e) { /* the defaults */ }
  function setOpt(k, v) {
    opts = { ...opts, [k]: !!v };
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(opts)); } catch (e) { /* this session only */ }
    syncOpts();
    if (editing) redraw();
  }
  function syncOpts() {
    if (!svg) return;
    svg.classList.toggle("board-grid", opts.grid);
    document.querySelectorAll("#boardOpts [data-opt]").forEach((i) => { i.checked = !!opts[i.dataset.opt]; });
  }

  function openBoard(id) {
    const b = findBoard(id);
    if (!b) return;
    editing = b;
    selection = new Set(); undoStack = []; redoStack = []; op = null; pointers.clear(); pinch = null; cropping = null;
    clearLive(); playing.clear();
    closeLinkPick();
    $("#boardName").value = b.name;
    fillCategory(b.category || "");
    syncTagsBtn();
    const ov = $("#boardEditor");
    ov.hidden = false;
    fitView();
    redraw();
    syncToolbar();
    fontReady().then((fresh) => { if (fresh && editing) redraw(); });
  }
  // Text is measured for its box, so the first draw before Virgil arrives
  // is redone once it has. Resolves true the first time only.
  let fontLoaded = false;
  function fontReady() {
    if (fontLoaded || typeof document === "undefined" || !document.fonts) return Promise.resolve(false);
    return document.fonts.load("26px Virgil").then(() => { const first = !fontLoaded; fontLoaded = true; return first; }, () => false);
  }
  // Starts where the drawing is: centred on it at 100%, or smaller if it
  // doesn't fit.
  function fitView() {
    const r = svg.getBoundingClientRect();
    const w = r.width || innerWidth, h = r.height || innerHeight;
    const b = boundsOf(editing.elements);
    if (!b) { view = { x: w / 2 - 200, y: h / 3, k: 1 }; return; }
    const k = Math.min(1, (w - 60) / Math.max(b.w, 1), (h - 180) / Math.max(b.h, 1));
    view = { k: Math.max(0.1, k), x: 0, y: 0 };
    view.x = w / 2 - (b.x + b.w / 2) * view.k;
    view.y = h / 2 - (b.y + b.h / 2) * view.k;
  }
  // The note categories, for a board to be filed under.
  function fillCategory(value) {
    const sel = $("#boardCategory");
    sel.innerHTML = "";
    const opt = (v, label) => { const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o); };
    opt("", i18n.t("No category"));
    for (const c of state.data.noteCategories || []) opt(c.name, c.name);
    sel.value = (state.data.noteCategories || []).some((c) => c.name === value) ? value : "";
  }
  // The board's tags: a tag button in the top bar, with how many it has,
  // opening the Tags… sheet.
  function syncTagsBtn() {
    const n = editing && editing.tags ? editing.tags.length : 0;
    $("#boardTagsN").textContent = n ? String(n) : "";
    $("#boardTagsBtn").title = n ? i18n.t("Tags: {tags}", { tags: editing.tags.join(", ") }) : i18n.t("Tags");
    $("#boardTagsItem").textContent = Tags().itemLabel(editing && editing.tags);
  }
  function openBoardTags() {
    if (!editing) return;
    Tags().sheet({
      title: i18n.t("Board tags"),
      get: () => (editing && editing.tags) || [],
      set: (v) => { if (editing && Tags().setOn(editing, v)) { changed(editing); syncTagsBtn(); } },
      known: () => window.LifeLogNotes.tagCounts(),
    });
  }
  const closeBoardTags = () => Tags().closeSheet();
  function closeBoard() {
    if (!editing) return;
    closeBoardTags();
    closeLinkPick();
    commitText();
    endCrop();
    const name = $("#boardName").value.trim() || "Untitled board";
    if (name !== editing.name) { editing.name = name; changed(editing); }
    editing = null;
    clearLive(); playing.clear();
    $("#boardEditor").hidden = true;
    flush();
    // Boards show in the notes feed too (0.206.0), so any Notes page redraws.
    if (state.view === "notes" || state.view === "home") render();
  }
  const isEditing = () => !!editing;

  function applyView() {
    world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
    liveEls.setAttribute("transform", world.getAttribute("transform"));
    overlay.setAttribute("transform", world.getAttribute("transform"));
    liveLayer.setAttribute("transform", world.getAttribute("transform"));
    svg.style.backgroundPosition = `${view.x}px ${view.y}px`;
    $("#boardZoomBtn").textContent = Math.round(view.k * 100) + "%";
    svg.style.backgroundSize = `${24 * view.k}px ${24 * view.k}px`;
    if (textInput && !textInput.hidden) placeTextInput();
  }
  function redraw() {
    editing.elements = followBindings(editing.elements);
    world.innerHTML = "";
    for (const e of editing.elements) {
      if ((textEditing && e.id === textEditing.id) || LIVE.has(e.t)) continue;
      if (cropping && e.id === cropping.id) {
        // The whole picture, dimmed, behind the part that's kept.
        const f = cropping.full;
        const ghost = drawElement({ ...e, id: e.id + "~", x: f.x, y: f.y, w: f.w, h: f.h, cr: undefined, a: 0 });
        ghost.setAttribute("opacity", ".3");
        ghost.removeAttribute("data-id");
        world.appendChild(ghost);
      }
      world.appendChild(drawElement(e));
    }
    for (const e of editing.elements) if (e.ln) world.appendChild(linkBadge(e));
    syncLive();
    drawSelection();
    applyView();
    $("#boardUndo").disabled = !undoStack.length;
    $("#boardRedo").disabled = !redoStack.length;
    syncStyleBar();
  }
  const selected = () => editing.elements.filter((e) => selection.has(e.id));
  // The selection's own buttons: Group, Lock, Link to…, Crop.
  function syncSelButtons(sel) {
    const g = $("#boardGroup"), l = $("#boardLock"), k = $("#boardLink"), c = $("#boardCrop");
    if (!g) return;
    const grouped = sel.length > 1 && sel[0].gp && sel.every((e) => e.gp === sel[0].gp);
    g.hidden = sel.length < 2;
    g.replaceChildren(ico(grouped ? "ungroup" : "group"));
    g.title = grouped ? i18n.t("Ungroup") : i18n.t("Group");
    g.setAttribute("aria-label", g.title);
    const locked = sel.length && sel.every((e) => e.lk);
    l.hidden = !sel.length;
    l.replaceChildren(ico(locked ? "lock-open" : "lock"));
    l.title = locked ? i18n.t("Unlock it") : i18n.t("Lock");
    l.setAttribute("aria-label", l.title);
    l.classList.toggle("on", !!locked);
    k.hidden = !sel.some((e) => e.t !== "pen" && e.t !== "line" && e.t !== "arrow");
    k.classList.toggle("on", sel.some((e) => e.ln));
    const pic = sel.length === 1 && sel[0].t === "img" && !sel[0].a && !sel[0].lk;
    c.hidden = !pic && !cropping;
    c.classList.toggle("on", !!cropping);
    c.title = cropping ? i18n.t("Done cropping") : i18n.t("Crop");
    c.setAttribute("aria-label", c.title);
    $("#boardCropReset").hidden = !cropping;
  }
  // A link's icon, at the top end of what carries it; a tap on it opens it.
  const BADGE = 22;
  function badgeBox(e) {
    const b = bbox(e), s = BADGE / Math.max(view.k, 0.5);
    return { x: b.x + b.w + 4 / view.k, y: b.y - s * 0.2, s };
  }
  function linkBadge(e) {
    const { x, y, s } = badgeBox(e);
    const g = svgEl("g", { class: "board-link-badge" + (linkTarget(e.ln) ? "" : " is-missing") });
    g.appendChild(svgEl("rect", { x, y, width: s, height: s, rx: s / 4 }));
    const icon = svgEl("svg", { x: x + s * 0.18, y: y + s * 0.18, width: s * 0.64, height: s * 0.64, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" });
    for (const c of [...ico("link").childNodes]) icon.appendChild(c);
    g.appendChild(icon);
    return g;
  }
  function linkAt(x, y) {
    for (let i = editing.elements.length - 1; i >= 0; i--) {
      const e = editing.elements[i];
      if (!e.ln) continue;
      const b = badgeBox(e), pad = 6 / view.k;
      if (x >= b.x - pad && x <= b.x + b.s + pad && y >= b.y - pad && y <= b.y + b.s + pad) return e;
    }
    return null;
  }
  function redrawAfterMerge() {
    const fresh = findBoard(editing.id);
    if (!fresh) { closeBoard(); toast(i18n.t("This board was deleted on another device")); return; }
    editing = fresh;
    selection = new Set([...selection].filter((id) => editing.elements.some((e) => e.id === id)));
    redraw();
  }
  // The selection's handles: a square at each corner to resize from, and a
  // round one above to turn it by. Sized in screen pixels, so they stay a
  // finger's width at any zoom.
  let handles = [];
  function drawSelection() {
    overlay.innerHTML = "";
    handles = [];
    const els = editing.elements.filter((e) => selection.has(e.id));
    for (const e of els) {
      const b = bbox(e);
      overlay.appendChild(svgEl("rect", { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, class: "board-sel" }));
    }
    if (op && op.kind === "box") {
      const r = norm(op.x0, op.y0, op.x1 - op.x0, op.y1 - op.y0);
      overlay.appendChild(svgEl("rect", { x: r.x, y: r.y, width: r.w, height: r.h, class: "board-box" }));
    }
    if (op && op.guides) for (const [x1, y1, x2, y2] of op.guides) overlay.appendChild(svgEl("line", { x1, y1, x2, y2, class: "board-guide" }));
    for (const e of els) {
      if (!e.lk) continue;
      const b = bbox(e), s = 18 / view.k;
      const g = svgEl("g", { class: "board-lock-badge" });
      g.appendChild(svgEl("circle", { cx: b.x + b.w + 4 / view.k, cy: b.y + b.h + 4 / view.k, r: s / 2 + 3 / view.k }));
      const icon = svgEl("svg", { x: b.x + b.w + 4 / view.k - s * 0.35, y: b.y + b.h + 4 / view.k - s * 0.35, width: s * 0.7, height: s * 0.7, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" });
      for (const c of [...ico("lock").childNodes]) icon.appendChild(c);
      g.appendChild(icon);
      overlay.appendChild(g);
    }
    if (cropping) {
      const e = editing.elements.find((x) => x.id === cropping.id);
      if (!e) return;
      const hs = 6 / view.k;
      for (const [corner, hx, hy] of [["nw", e.x, e.y], ["ne", e.x + e.w, e.y], ["se", e.x + e.w, e.y + e.h], ["sw", e.x, e.y + e.h]]) {
        handles.push({ kind: "crop", corner, x: hx, y: hy });
        overlay.appendChild(svgEl("rect", { x: hx - hs, y: hy - hs, width: hs * 2, height: hs * 2, class: "board-handle board-crop-handle", "data-handle": corner }));
      }
      return;
    }
    const boxing = op && op.kind === "box", moving = op && op.kind === "move" && op.moved;
    if (tool !== "select" || !els.length || boxing || els.some((e) => e.lk)) return;
    const B = boundsOf(els), pad = 8 / view.k, hs = 5 / view.k;
    const x1 = B.x - pad, y1 = B.y - pad, x2 = B.x + B.w + pad, y2 = B.y + B.h + pad;
    if (els.length > 1) overlay.appendChild(svgEl("rect", { x: x1, y: y1, width: x2 - x1, height: y2 - y1, class: "board-sel board-sel-group" }));
    if (moving) return;
    // A corner handle sits `pad` outside the selection, but scales it by its
    // own corners — so the drawing's edge follows the finger exactly.
    const bx1 = B.x, by1 = B.y, bx2 = B.x + B.w, by2 = B.y + B.h;
    for (const [corner, hx, hy, cx, cy, ax, ay] of [
      ["nw", x1, y1, bx1, by1, bx2, by2], ["ne", x2, y1, bx2, by1, bx1, by2],
      ["se", x2, y2, bx2, by2, bx1, by1], ["sw", x1, y2, bx1, by2, bx2, by1]]) {
      handles.push({ kind: "resize", corner, x: hx, y: hy, cx, cy, ax, ay });
      overlay.appendChild(svgEl("rect", { x: hx - hs, y: hy - hs, width: hs * 2, height: hs * 2, class: "board-handle", "data-handle": corner }));
    }
    if (els.some((e) => LIVE.has(e.t))) return;
    const rx = (x1 + x2) / 2, ry = y1 - 26 / view.k;
    handles.push({ kind: "rotate", x: rx, y: ry, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 });
    overlay.appendChild(svgEl("line", { x1: rx, y1: ry, x2: rx, y2: y1, class: "board-sel" }));
    overlay.appendChild(svgEl("circle", { cx: rx, cy: ry, r: hs * 1.2, class: "board-handle", "data-handle": "rotate" }));
  }
  function handleAt(x, y, tol) {
    return handles.find((h) => Math.hypot(x - h.x, y - h.y) <= tol + 6 / view.k) || null;
  }

  const toWorld = (sx, sy) => [(sx - view.x) / view.k, (sy - view.y) / view.k];
  function pointerWorld(ev) {
    const r = svg.getBoundingClientRect();
    return toWorld(ev.clientX - r.left, ev.clientY - r.top);
  }
  const tolerance = (ev) => (ev.pointerType === "touch" ? 14 : 7) / view.k;
  function topHit(x, y, tol) {
    for (let i = editing.elements.length - 1; i >= 0; i--) {
      if (LIVE.has(editing.elements[i].t) && hitTest(editing.elements[i], x, y, tol)) return editing.elements[i];
    }
    for (let i = editing.elements.length - 1; i >= 0; i--) {
      if (hitTest(editing.elements[i], x, y, tol)) return editing.elements[i];
    }
    return null;
  }

  function remember() {
    undoStack.push(JSON.stringify(editing.elements));
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(editing.elements));
    editing.elements = JSON.parse(undoStack.pop());
    selection = new Set();
    changed(editing); redraw();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(editing.elements));
    editing.elements = JSON.parse(redoStack.pop());
    selection = new Set();
    changed(editing); redraw();
  }
  function deleteSelection() {
    if (!selection.size || !selected().some((e) => !e.lk)) return;
    remember();
    editing.elements = editing.elements.filter((e) => !selection.has(e.id) || e.lk);
    selection = new Set(editing.elements.filter((e) => selection.has(e.id)).map((e) => e.id));
    changed(editing); redraw();
  }

  // The ids of what a drag box fully contains.
  function boxHits(o) {
    const r = norm(o.x0, o.y0, o.x1 - o.x0, o.y1 - o.y0);
    if (!(r.w > 2 || r.h > 2)) return [];
    return editing.elements.filter((e) => {
      if (e.lk) return false;
      const b = bbox(e);
      return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
    }).map((e) => e.id);
  }

  function onPointerDown(ev) {
    if (!editing || (ev.button && ev.button !== 1)) return;
    // Inside a card, player or panel, the select tool works what's there:
    // a tick, a button, the text. Its head is what moves it.
    if (tool === "select" && !spaceDown && ev.button !== 1 && ev.target.closest && ev.target.closest(".board-live-body")) return;
    commitText();
    // Throws for a pointer that's already gone; drawing on without capture
    // beats dropping the touch.
    try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* see above */ }
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) {
      // A second finger: whatever the first one started is a pinch instead.
      op = null; liveLayer.innerHTML = "";
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], view: { ...view } };
      drawSelection();
      return;
    }
    if (pointers.size > 2) return;
    const [x, y] = pointerWorld(ev);
    if (tool === "hand" || spaceDown || ev.button === 1) { op = { kind: "pan", sx: ev.clientX, sy: ev.clientY, view: { ...view } }; return; }
    if (tool === "pen") {
      op = { kind: "pen", pts: [[x, y]], node: svgEl("path", { stroke: inkOf(color), "stroke-width": width, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }) };
      liveLayer.appendChild(op.node);
      op.node.setAttribute("d", penPath(op.pts));
      return;
    }
    if (tool === "eraser") { op = { kind: "erase", gone: new Set(), last: [x, y] }; eraseAt(x, y, tolerance(ev)); return; }
    if (tool === "text") { op = { kind: "text", x, y }; return; }
    if (tool === "select" || tool === "hand") {
      const linked = !spaceDown && ev.button !== 1 && linkAt(x, y);
      if (linked) { op = null; pointers.delete(ev.pointerId); openLink(linked.ln); return; }
    }
    if (tool === "select" && cropping) {
      const h = handleAt(x, y, tolerance(ev));
      const e = editing.elements.find((v) => v.id === cropping.id);
      if (h && h.kind === "crop") { remember(); op = { kind: "crop", h, orig: { ...e } }; return; }
      if (e && hitTest({ ...e, a: 0 }, x, y, 0)) { remember(); op = { kind: "croppan", x0: x, y0: y, orig: { ...e } }; return; }
      endCrop();
    }
    if (tool === "select") {
      const h = handleAt(x, y, tolerance(ev));
      const orig = () => editing.elements.filter((e) => selection.has(e.id)).map((e) => ({ ...e }));
      if (h && h.kind === "resize") { op = { kind: "resize", h, orig: orig(), moved: false }; return; }
      if (h && h.kind === "rotate") { op = { kind: "rotate", h, a0: Math.atan2(y - h.cy, x - h.cx), orig: orig(), moved: false }; return; }
      const hit = topHit(x, y, tolerance(ev));
      if (hit) {
        if (!selection.has(hit.id)) selection = withGroups(editing.elements, ev.shiftKey ? new Set([...selection, hit.id]) : new Set([hit.id]));
        op = { kind: "move", x0: x, y0: y, orig: editing.elements.filter((e) => selection.has(e.id) && !e.lk).map((e) => ({ ...e })), moved: false, tapped: hit };
      } else {
        if (!ev.shiftKey) selection = new Set();
        op = { kind: "box", x0: x, y0: y, x1: x, y1: y, base: new Set(selection) };
      }
      redraw();
      return;
    }
    // A shape: drawn live from where the pointer went down.
    const e = { id: uid(), t: tool, c: color, sw: width, seed: Math.floor(Math.random() * 2 ** 31) };
    if (fill && (tool === "rect" || tool === "ellipse")) e.f = true;
    const lineish = tool === "line" || tool === "arrow";
    // A line's start on a shape sticks there; elsewhere it snaps to the grid.
    const b1 = lineish && opts.stick ? bindAt(editing.elements, x, y, tolerance(ev)) : null;
    const [sx, sy] = b1 ? [x, y] : snapPt(x, y);
    if (tool === "rect" || tool === "ellipse") Object.assign(e, { x: sx, y: sy, w: 0, h: 0 });
    else Object.assign(e, { x: sx, y: sy, x2: sx, y2: sy });
    if (b1) e.b1 = b1;
    op = { kind: "shape", e };
  }
  function onPointerMove(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const r = svg.getBoundingClientRect();
      const k = clampZoom(pinch.view.k * dist / (pinch.dist || 1));
      const wx = (pinch.mid[0] - r.left - pinch.view.x) / pinch.view.k, wy = (pinch.mid[1] - r.top - pinch.view.y) / pinch.view.k;
      view = { k, x: mid[0] - r.left - wx * k, y: mid[1] - r.top - wy * k };
      applyView();
      return;
    }
    if (!op) return;
    let [x, y] = pointerWorld(ev);
    if (op.kind === "pan") {
      view = { ...op.view, x: op.view.x + ev.clientX - op.sx, y: op.view.y + ev.clientY - op.sy };
      applyView();
    } else if (op.kind === "pen") {
      // Coalesced events keep a fast stroke smooth where the browser batches.
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const c of evs.length ? evs : [ev]) op.pts.push(pointerWorld(c));
      op.node.setAttribute("d", penPath(opts.smooth ? smoothPoints(op.pts, 2) : op.pts));
    } else if (op.kind === "erase") {
      // Along the way from the last position, not just at it: a quick swipe
      // arrives in a few far-apart events and would jump over a stroke.
      const tol = tolerance(ev), [lx, ly] = op.last;
      const steps = Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / tol));
      for (let i = 1; i <= steps; i++) eraseAt(lx + (x - lx) * i / steps, ly + (y - ly) * i / steps, tol);
      op.last = [x, y];
    } else if (op.kind === "move") {
      let dx = x - op.x0, dy = y - op.y0;
      if (!op.orig.length) return;
      if (!op.moved && Math.hypot(dx, dy) * view.k < 3) return;
      if (!op.moved) {
        remember(); op.moved = true;
        // An arrow moved on its own comes loose from what it stuck to.
        const ids = new Set(op.orig.map((e) => e.id));
        op.orig = op.orig.map((e) => {
          if (!e.b1 && !e.b2) return e;
          const out = { ...e };
          for (const k of ["b1", "b2"]) if (out[k] && !ids.has(out[k].id)) delete out[k];
          return out;
        });
        op.box = boundsOf(op.orig);
        op.others = editing.elements.filter((e) => !ids.has(e.id) && !(e.b1 && ids.has(e.b1.id)) && !(e.b2 && ids.has(e.b2.id))).slice(-400).map(bbox);
      }
      op.guides = null;
      const box = { ...op.box, x: op.box.x + dx, y: op.box.y + dy };
      let gx = null, gy = null;
      if (opts.guides && !ev.altKey) {
        const g = guideSnap(box, op.others, 6 / view.k);
        gx = g.dx; gy = g.dy;
        if (g.lines.length) op.guides = g.lines;
      }
      if (gx != null) dx += gx; else if (opts.snap && !ev.altKey) dx += snapTo(box.x, GRID) - box.x;
      if (gy != null) dy += gy; else if (opts.snap && !ev.altKey) dy += snapTo(box.y, GRID) - box.y;
      const byId = new Map(op.orig.map((e) => [e.id, moved(e, dx, dy)]));
      editing.elements = editing.elements.map((e) => byId.get(e.id) || e);
      redraw();
    } else if (op.kind === "resize" || op.kind === "rotate") {
      if (!op.moved) { remember(); op.moved = true; }
      let next;
      if (op.kind === "resize") {
        const { ax, ay, cx, cy, x: hx, y: hy } = op.h;
        const ux = x - (hx - cx), uy = y - (hy - cy);
        // Never through zero: past the anchor it would turn inside out.
        let sx = Math.max(0.05, (ux - ax) / ((cx - ax) || 1)), sy = Math.max(0.05, (uy - ay) / ((cy - ay) || 1));
        // Text always keeps its proportions; a picture does unless Shift
        // is held; a shape only while it is.
        const onlyText = op.orig.every((e) => e.t === "text");
        const pictures = op.orig.some((e) => e.t === "img") && op.orig.every((e) => e.t === "text" || e.t === "img");
        if (onlyText || (pictures ? !ev.shiftKey : ev.shiftKey)) sx = sy = Math.max(sx, sy);
        next = (e) => scaled(e, ax, ay, sx, sy);
      } else {
        let da = Math.atan2(y - op.h.cy, x - op.h.cx) - op.a0;
        if (ev.shiftKey) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12);
        next = (e) => rotated(e, op.h.cx, op.h.cy, da);
      }
      const byId = new Map(op.orig.map((e) => [e.id, next(e)]));
      editing.elements = editing.elements.map((e) => byId.get(e.id) || e);
      redraw();
    } else if (op.kind === "crop" || op.kind === "croppan") {
      const f = cropping.full, o = op.orig, min = 8;
      let r;
      if (op.kind === "croppan") {
        const nx = Math.max(f.x, Math.min(f.x + f.w - o.w, o.x + x - op.x0));
        const ny = Math.max(f.y, Math.min(f.y + f.h - o.h, o.y + y - op.y0));
        r = { x: nx, y: ny, w: o.w, h: o.h };
      } else {
        let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
        const c = op.h.corner, cx = Math.max(f.x, Math.min(f.x + f.w, x)), cy = Math.max(f.y, Math.min(f.y + f.h, y));
        if (c.includes("w")) x1 = Math.min(cx, x2 - min); else x2 = Math.max(cx, x1 + min);
        if (c.includes("n")) y1 = Math.min(cy, y2 - min); else y2 = Math.max(cy, y1 + min);
        r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      const r2 = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
      const cr = cropFrom(f, r2);
      editing.elements = editing.elements.map((e) => {
        if (e.id !== o.id) return e;
        const out = { ...e, ...r2 };
        if (cr) out.cr = cr; else delete out.cr;
        return out;
      });
      redraw();
    } else if (op.kind === "box") {
      op.x1 = x; op.y1 = y;
      // What the box covers lights up as it grows, not only on release.
      selection = withGroups(editing.elements, new Set([...op.base, ...boxHits(op)]));
      drawSelection();
    } else if (op.kind === "shape") {
      const e = op.e;
      if (e.t !== "line" && e.t !== "arrow") [x, y] = snapPt(x, y);
      else if (!(opts.stick && bindAt(editing.elements, x, y, tolerance(ev), e.b1 && e.b1.id))) [x, y] = snapPt(x, y);
      if (e.t === "rect" || e.t === "ellipse") {
        e.w = Math.round(x - e.x); e.h = Math.round(y - e.y);
        if (ev.shiftKey) { const s = Math.max(Math.abs(e.w), Math.abs(e.h)); e.w = Math.sign(e.w || 1) * s; e.h = Math.sign(e.h || 1) * s; }
      } else { e.x2 = Math.round(x); e.y2 = Math.round(y); }
      liveLayer.innerHTML = "";
      liveLayer.appendChild(drawElement(e));
    }
  }
  function onPointerUp(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    if (pinch) { if (!pointers.size) pinch = null; return; }
    const done = op; op = null;
    if (!done) return;
    if (done.kind === "pen") {
      liveLayer.innerHTML = "";
      const pts = simplify(opts.smooth ? smoothPoints(done.pts, 2) : done.pts, 0.8 / view.k);
      remember();
      editing.elements.push({ id: uid(), t: "pen", c: color, sw: width, p: encodePoints(pts) });
      changed(editing); redraw();
    } else if (done.kind === "erase") {
      if (done.gone.size) changed(editing);
    } else if (done.kind === "resize" || done.kind === "rotate") {
      if (done.moved) changed(editing);
      redraw();
    } else if (done.kind === "crop" || done.kind === "croppan") {
      changed(editing); redraw();
    } else if (done.kind === "move") {
      if (done.moved) { changed(editing); redraw(); }
      else if (done.tapped && (done.tapped.t === "text" || done.tapped.t === "img") && !done.tapped.lk) {
        // A pointerup's `detail` is always 0, so a double tap is timed here.
        const now = Date.now();
        if (lastTap && lastTap.id === done.tapped.id && now - lastTap.at < 450) {
          lastTap = null;
          if (done.tapped.t === "text") editText(done.tapped); else startCrop(done.tapped.id);
        } else lastTap = { id: done.tapped.id, at: now };
      }
    } else if (done.kind === "box") {
      selection = withGroups(editing.elements, new Set([...done.base, ...boxHits(done)]));
      redraw();
    } else if (done.kind === "shape") {
      liveLayer.innerHTML = "";
      const e = done.e;
      const size = e.t === "rect" || e.t === "ellipse" ? Math.hypot(e.w, e.h) : Math.hypot(e.x2 - e.x, e.y2 - e.y);
      if (size * view.k < 4) return;
      if (e.t === "rect" || e.t === "ellipse") Object.assign(e, norm(e.x, e.y, e.w, e.h));
      else if (opts.stick) {
        const b2 = bindAt(editing.elements, e.x2, e.y2, tolerance(ev), e.b1 && e.b1.id);
        if (b2) e.b2 = b2;
      }
      if (!opts.stick) { delete e.b1; delete e.b2; }
      remember();
      editing.elements.push(e);
      changed(editing); redraw();
    } else if (done.kind === "text") {
      const [x, y] = [done.x, done.y];
      const hit = editing.elements.slice().reverse().find((e) => e.t === "text" && hitTest(e, x, y, tolerance(ev)));
      editText(hit || { id: uid(), t: "text", c: color, sw: width, x: Math.round(x), y: Math.round(y - textSize({ sw: width }) * 0.6), text: "" });
    }
  }
  function eraseAt(x, y, tol) {
    const hit = topHit(x, y, tol);
    if (!hit || hit.lk) return;
    if (!op.gone.size) remember();
    op.gone.add(hit.id);
    editing.elements = editing.elements.filter((e) => e !== hit);
    redraw();
  }
  const clampZoom = (k) => Math.min(8, Math.max(0.1, k));
  function zoomBy(f) {
    const r = svg.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, view.k * f);
  }
  function zoomAt(sx, sy, k) {
    k = clampZoom(k);
    const wx = (sx - view.x) / view.k, wy = (sy - view.y) / view.k;
    view = { k, x: sx - wx * k, y: sy - wy * k };
    applyView();
  }
  function onWheel(ev) {
    if (!editing) return;
    const body = !(ev.ctrlKey || ev.metaKey) && ev.target.closest && ev.target.closest(".board-live-body");
    if (body && body.scrollHeight > body.clientHeight + 1) return;
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) zoomAt(ev.clientX - r.left, ev.clientY - r.top, view.k * Math.exp(-ev.deltaY * 0.01));
    else { view = { ...view, x: view.x - ev.deltaX, y: view.y - ev.deltaY }; applyView(); }
  }

  // A point on the grid when Snap to grid is on.
  const snapPt = (x, y) => (opts.snap ? [snapTo(x, GRID), snapTo(y, GRID)] : [Math.round(x), Math.round(y)]);

  // ---------- group, lock ----------
  function toggleGroup() {
    const sel = selected();
    if (sel.length < 2) return;
    const grouped = sel[0].gp && sel.every((e) => e.gp === sel[0].gp);
    const gp = grouped ? null : uid();
    remember();
    editing.elements = editing.elements.map((e) => {
      if (!selection.has(e.id)) return e;
      const out = { ...e };
      if (gp) out.gp = gp; else delete out.gp;
      return out;
    });
    changed(editing); redraw();
    toast(gp ? i18n.t("Grouped. Picking one picks them all") : i18n.t("Ungrouped"));
  }
  function toggleLock() {
    const sel = selected();
    if (!sel.length) return;
    const lock = !sel.every((e) => e.lk);
    remember();
    editing.elements = editing.elements.map((e) => {
      if (!selection.has(e.id)) return e;
      const out = { ...e };
      if (lock) out.lk = true; else delete out.lk;
      return out;
    });
    if (lock) endCrop();
    changed(editing); redraw();
  }

  // ---------- crop ----------
  // A picture's crop is the box it's drawn in: the handles move that box
  // over the whole picture (dimmed behind it), and `cr` follows.
  function startCrop(id) {
    const e = editing && editing.elements.find((x) => x.id === id);
    if (!e || e.t !== "img" || e.a || e.lk) return;
    commitText();
    tool = "select";
    selection = new Set([id]);
    cropping = { id, full: fullPictureBox(e) };
    syncToolbar(); redraw();
  }
  function endCrop() {
    if (!cropping) return;
    cropping = null;
    if (editing) redraw();
  }
  function resetCrop() {
    if (!cropping) return;
    const f = cropping.full;
    remember();
    editing.elements = editing.elements.map((e) => {
      if (e.id !== cropping.id) return e;
      const out = { ...e, x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h) };
      delete out.cr;
      return out;
    });
    changed(editing); redraw();
  }

  // ---------- links ----------
  // "note:<id>" or "board:<id>": what it opens, or null when it's gone.
  function linkTarget(ln) {
    const m = /^(note|board):(.+)$/.exec(ln || "");
    if (!m) return null;
    if (m[1] === "board") { const b = findBoard(m[2]); return b ? { board: b } : null; }
    const n = (state.data.notes || []).find((x) => x.id === m[2]);
    return n ? { note: n } : null;
  }
  function openLink(ln) {
    const hit = linkTarget(ln);
    if (!hit) { toast(i18n.t("What this linked to is gone. Link to… picks another")); return; }
    if (hit.board) { if (editing && hit.board.id === editing.id) return; closeBoard(); openBoard(hit.board.id); return; }
    closeBoard();
    window.LifeLogNotes.openNote(hit.note);
  }
  const linkName = (n) => (window.LifeLogNotes.linkTitle ? window.LifeLogNotes.linkTitle(n) : n.title || n.text) || "";
  // Link to…: the notes and boards, newest first, narrowed by what's typed.
  function linkChoices(q) {
    q = String(q || "").trim().toLowerCase();
    const out = [];
    for (const n of state.data.notes || []) {
      if (n.template) continue;
      const name = n.kind === "quote" ? String(n.text || "").split("\n")[0] : linkName(n);
      if (!name) continue;
      out.push({ ln: "note:" + n.id, name, icon: n.kind === "list" ? "list-checks" : n.kind === "quote" ? "quote" : "notebook-text", sub: n.category || "", at: n.updatedAt || n.createdAt || "" });
    }
    for (const b of listed()) {
      if (editing && b.id === editing.id) continue;
      out.push({ ln: "board:" + b.id, name: b.name, icon: "presentation", sub: i18n.t("Board"), at: b.updatedAt || "" });
    }
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const hits = q ? out.filter((c) => c.name.toLowerCase().includes(q)) : out;
    return hits.slice(0, 30);
  }
  function openLinkPick() {
    if (!editing || !selection.size) return;
    pickMode = "link";
    const input0 = $("#boardLinkQuery");
    input0.placeholder = i18n.t("Link to a note or board");
    input0.setAttribute("aria-label", input0.placeholder);
    input0.type = "search";
    const pop = $("#boardLinkPick");
    pop.hidden = false;
    pop.classList.remove("is-leaving");
    const input = $("#boardLinkQuery");
    input.value = "";
    drawLinkPick();
    setTimeout(() => input.focus(), 0);
  }
  function closeLinkPick() {
    const pop = typeof document !== "undefined" && $ && $("#boardLinkPick");
    if (!pop || pop.hidden) return false;
    pop.hidden = true;
    return true;
  }
  function drawLinkPick() {
    const list = $("#boardLinkList");
    list.replaceChildren();
    const row = (icon, name, sub, run) => {
      const b = el("button", "link-pick-row");
      b.type = "button";
      b.appendChild(ico(icon));
      b.appendChild(el("span", "link-pick-name", name));
      if (sub) b.appendChild(el("small", null, sub));
      b.onclick = run;
      list.appendChild(b);
    };
    const q = $("#boardLinkQuery").value;
    if (pickMode === "card") {
      const choices = cardChoices(q);
      if (!choices.length) list.appendChild(el("p", "link-pick-empty", i18n.t("No notes, quotes or tasks match")));
      for (const c of choices) row(c.icon, c.name, c.sub, () => { closeLinkPick(); placeLive({ t: "card", ref: c.ref, ...(c.item ? { item: c.item } : {}), ...cardSize(c) }); });
      return;
    }
    if (pickMode === "panel") {
      const H = window.LifeLogHome, want = q.trim().toLowerCase();
      for (const [id, label, icon] of H ? H.SECTIONS : []) {
        if (!PANEL_KINDS.includes(id) || (want && !label.toLowerCase().includes(want))) continue;
        const [w, h] = PANEL_SIZE[id] || [380, 320];
        row(icon, label, "", () => { closeLinkPick(); placeLive({ t: "panel", kind: id, w, h }); });
      }
      if (!list.childNodes.length) list.appendChild(el("p", "link-pick-empty", i18n.t("No Home panel is called that")));
      return;
    }
    if (pickMode === "embed") {
      const p = playerOf(q.trim());
      if (!q.trim()) list.appendChild(el("p", "link-pick-empty", i18n.t("A YouTube video, or a Spotify or SoundCloud track, album or playlist. It plays on the board when tapped.")));
      else if (!p) list.appendChild(el("p", "link-pick-empty", i18n.t("That isn't a YouTube, Spotify or SoundCloud link")));
      else row("play", i18n.t("Add the {site} player", { site: p.site }), q.trim().replace(/^https:\/\/(www\.)?/, ""), () => { closeLinkPick(); placeLive({ t: "embed", url: q.trim(), ...playerSize(p) }); });
      return;
    }
    const has = selected().some((e) => e.ln);
    if (has) {
      const off = el("button", "link-pick-row board-link-off");
      off.type = "button";
      off.appendChild(ico("x"));
      off.appendChild(el("span", "link-pick-name", i18n.t("Remove the link")));
      off.onclick = () => setLink(null);
      list.appendChild(off);
    }
    const choices = linkChoices($("#boardLinkQuery").value);
    if (!choices.length) list.appendChild(el("p", "link-pick-empty", i18n.t("No notes or boards match")));
    for (const c of choices) {
      const b = el("button", "link-pick-row");
      b.type = "button";
      b.appendChild(ico(c.icon));
      b.appendChild(el("span", "link-pick-name", c.name));
      if (c.sub) b.appendChild(el("small", null, c.sub));
      b.onclick = () => setLink(c.ln);
      list.appendChild(b);
    }
  }
  function setLink(ln) {
    closeLinkPick();
    const can = (e) => e.t !== "pen" && e.t !== "line" && e.t !== "arrow";
    if (!editing || !selected().some(can)) return;
    remember();
    editing.elements = editing.elements.map((e) => {
      if (!selection.has(e.id) || !can(e)) return e;
      const out = { ...e };
      if (ln) out.ln = ln; else delete out.ln;
      return out;
    });
    changed(editing); redraw();
  }

  // ---------- live elements: cards, players, panels ----------
  // They sit in a layer of their own over the drawing, and their HTML is
  // kept between redraws (a player that's playing goes on playing while the
  // board is moved round it); only where they are is set each time. What's
  // inside is built again when the note or Home changes (refreshLive).
  const live = new Map();     // id → { fo, sig }
  const playing = new Set();  // players tapped open, this session only
  function syncLive() {
    const want = editing.elements.filter((e) => LIVE.has(e.t));
    const ids = new Set(want.map((e) => e.id));
    for (const [id, v] of live) if (!ids.has(id)) { v.fo.remove(); live.delete(id); }
    want.forEach((e) => {
      let v = live.get(e.id);
      const sig = liveSig(e);
      if (!v) {
        const fo = svgEl("foreignObject", { "data-live": e.id });
        v = { fo, sig: null };
        live.set(e.id, v);
      }
      if (v.fo.parentNode !== liveEls || liveEls.lastChild !== v.fo) liveEls.appendChild(v.fo);
      for (const [k, val] of [["x", e.x], ["y", e.y], ["width", e.w], ["height", e.h]]) if (v.fo.getAttribute(k) !== String(val)) v.fo.setAttribute(k, val);
      if (v.sig !== sig) { v.sig = sig; fillLive(v.fo, e); }
    });
  }
  const liveSig = (e) => JSON.stringify([e.t, e.ref, e.item, e.url, e.kind, playing.has(e.id)]);
  function clearLive() {
    for (const v of live.values()) v.fo.remove();
    live.clear();
  }
  // The note or Home changed (a tick, an edit, another device): every card
  // and panel is built again, except one being typed in.
  function refreshLive() {
    if (!editing) return;
    for (const [id, v] of live) {
      const a = document.activeElement;
      if (v.fo.contains(a) && a.matches("textarea, input, [contenteditable='true']")) continue;
      const e = editing.elements.find((x) => x.id === id);
      if (e && e.t !== "embed") fillLive(v.fo, e);
    }
  }
  function fillLive(fo, e) {
    const box = el("div", "board-live board-live-" + e.t);
    if (e.t === "card") cardInto(box, e);
    else if (e.t === "embed") playerInto(box, e);
    else panelInto(box, e);
    fo.replaceChildren(box);
  }
  function liveHead(icon, label, extra) {
    const h = el("div", "board-live-head");
    h.appendChild(ico(icon));
    h.appendChild(el("span", "board-live-label", label));
    if (extra) h.appendChild(extra);
    return h;
  }
  function openBtn(run) {
    const b = el("button", "board-live-open", i18n.t("Open"));
    b.type = "button";
    b.appendChild(ico("external-link"));
    b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    b.onclick = (ev) => { ev.stopPropagation(); run(); };
    return b;
  }
  const N = () => window.LifeLogNotes;
  function cardInto(box, e) {
    const n = cardNote(e);
    const it = n && e.item ? (n.items || []).find((i) => i.id === e.item) : null;
    if (!n || (e.item && !it)) {
      box.appendChild(liveHead("notebook-text", i18n.t("Note")));
      box.appendChild(el("p", "board-live-body board-live-gone", e.item ? i18n.t("This task is gone. Delete the card, or undo if that wasn't meant.") : i18n.t("This note is gone. Delete the card, or undo if that wasn't meant.")));
      return;
    }
    const kind = n.kind === "list" ? "list" : n.kind === "quote" ? "quote" : "text";
    const open = openBtn(() => { closeBoard(); N().openNote(n); });
    const body = el("div", "board-live-body");
    if (it) {
      box.appendChild(liveHead("square-check-big", i18n.t("Task"), open));
      body.appendChild(taskRow(n, it));
      if (it.note) body.appendChild(el("p", "board-card-desc", it.note));
      body.appendChild(el("p", "board-card-from", linkName(n) || i18n.t("Untitled list")));
    } else if (kind === "list") {
      box.appendChild(liveHead("list-checks", i18n.t("Tasks"), open));
      body.appendChild(el("h4", "board-card-title", n.text || i18n.t("Untitled list")));
      const items = n.items || [];
      for (const i of items.filter((x) => !x.parent)) {
        body.appendChild(taskRow(n, i));
        for (const sub of items.filter((x) => x.parent === i.id)) body.appendChild(taskRow(n, sub, true));
      }
      if (!items.length) body.appendChild(el("p", "board-card-desc", i18n.t("No tasks yet")));
    } else if (kind === "quote") {
      box.appendChild(liveHead("quote", i18n.t("Quote"), open));
      body.appendChild(el("p", "board-card-quote", "“" + String(n.text || "").trim() + "”"));
      const by = [n.author, n.source].filter(Boolean).join(", ");
      if (by) body.appendChild(el("p", "board-card-by", "— " + by));
      editable(body, n, "text");
    } else {
      box.appendChild(liveHead("notebook-text", i18n.t("Note"), open));
      if (n.title) body.appendChild(el("h4", "board-card-title", n.title));
      const md = el("div", "md board-card-md");
      const M = window.LifeLogMarkdown;
      if (M) md.appendChild(M.render(String(n.text || ""), { wiki: (w) => el("span", "md-wiki", w.label || w.target) }));
      else md.textContent = n.text || "";
      body.appendChild(md);
      editable(body, n, "text");
    }
    box.appendChild(body);
  }
  function taskRow(n, it, sub) {
    const row = el("div", "board-task" + (it.done ? " is-done" : "") + (sub ? " is-sub" : ""));
    const tick = el("button", "board-tick" + (it.done ? " on" : ""));
    tick.type = "button";
    tick.setAttribute("role", "checkbox");
    tick.setAttribute("aria-checked", String(!!it.done));
    tick.setAttribute("aria-label", it.text);
    if (it.done) tick.appendChild(ico("check"));
    tick.onclick = async (ev) => { ev.stopPropagation(); await N().tickItem(n.id, it.id, !it.done); refreshLive(); };
    row.append(tick, el("span", "board-task-text", it.text));
    return row;
  }
  // A note's or quote's words, edited where they are: a double-click (or a
  // double tap) turns the card's body into a text box; leaving it saves.
  function editable(body, n, field) {
    body.title = i18n.t("Double-click to edit");
    body.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      if (body.querySelector("textarea")) return;
      const ta = el("textarea", "board-card-edit");
      ta.value = n[field] || "";
      ta.setAttribute("aria-label", i18n.t("Edit"));
      body.replaceChildren(ta);
      ta.focus();
      const done = async (save) => {
        ta.onblur = null;
        if (save && ta.value !== (n[field] || "")) await N().setNoteText(n.id, ta.value);
        const v = [...live.values()].find((x) => x.fo.contains(body));
        if (v) { const e = editing && editing.elements.find((x) => x.id === v.fo.dataset.live); if (e) fillLive(v.fo, e); }
      };
      ta.onblur = () => done(true);
      ta.addEventListener("keydown", (k) => {
        k.stopPropagation();
        if (k.key === "Escape") { k.preventDefault(); done(false); }
        if (k.key === "Enter" && (k.ctrlKey || k.metaKey)) { k.preventDefault(); ta.blur(); }
      });
    });
  }
  function playerInto(box, e) {
    const p = playerOf(e.url);
    box.appendChild(liveHead("play", p ? p.site : i18n.t("Player"), openBtn(() => window.open(e.url, "_blank", "noopener"))));
    const body = el("div", "board-live-body board-player");
    if (playing.has(e.id) && p) {
      const f = document.createElement("iframe");
      f.src = p.src + (p.src.includes("?") ? "&" : "?") + "autoplay=1";
      f.title = p.site;
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write";
      f.referrerPolicy = "strict-origin-when-cross-origin";
      f.setAttribute("allowfullscreen", "");
      f.loading = "lazy";
      body.appendChild(f);
    } else {
      const b = el("button", "board-play");
      b.type = "button";
      b.appendChild(el("span", "board-play-btn")).appendChild(ico("play"));
      b.appendChild(el("span", "board-play-site", p ? p.site : ""));
      b.appendChild(el("span", "board-play-url", e.url.replace(/^https:\/\/(www\.)?/, "")));
      b.appendChild(el("span", "board-play-note", i18n.t("Tap to play. Nothing loads from {site} until then.", { site: p ? p.site : "" })));
      b.onclick = (ev) => { ev.stopPropagation(); playing.add(e.id); redraw(); };
      body.appendChild(b);
    }
    box.appendChild(body);
  }
  function panelInto(box, e) {
    const H = window.LifeLogHome;
    const [, label, icon] = (H && H.SECTIONS.find(([id]) => id === e.kind)) || [e.kind, e.kind, "layout-grid"];
    box.appendChild(liveHead(icon, label));
    const body = el("div", "board-live-body board-panel home");
    const sec = H && H.buildPanel(e.kind);
    if (sec) {
      const head = sec.querySelector(".home-sec-head");
      if (head) head.remove();
      body.appendChild(sec);
    }
    box.appendChild(body);
  }

  // A player for a note's Read view: the same tap-to-load box, as HTML.
  function embedWidget(url) {
    const p = playerOf(url);
    if (!p) return null;
    const box = el("div", "note-player");
    const b = el("button", "board-play");
    b.type = "button";
    b.appendChild(el("span", "board-play-btn")).appendChild(ico("play"));
    b.appendChild(el("span", "board-play-site", p.site));
    b.appendChild(el("span", "board-play-url", String(url).replace(/^https:\/\/(www\.)?/, "")));
    b.appendChild(el("span", "board-play-note", i18n.t("Tap to play. Nothing loads from {site} until then.", { site: p.site })));
    b.onclick = () => {
      const f = document.createElement("iframe");
      f.src = p.src + (p.src.includes("?") ? "&" : "?") + "autoplay=1";
      f.title = p.site;
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write";
      f.referrerPolicy = "strict-origin-when-cross-origin";
      f.setAttribute("allowfullscreen", "");
      box.replaceChildren(f);
    };
    box.style.setProperty("--ratio", p.ratio ? String(p.ratio) : p.tall ? "0.9" : p.site === "Spotify" ? "2.2" : "1.8");
    box.appendChild(b);
    return box;
  }

  // ---------- adding cards, players and panels ----------
  // The same picker as Link to…, listing what each adds. Each lands in the
  // middle of the screen, selected.
  let pickMode = "link";
  function placeLive(e) {
    if (!editing) return;
    const r = svg.getBoundingClientRect();
    const [cx, cy] = toWorld(r.width / 2, r.height / 2);
    const off = (editing.elements.filter((x) => LIVE.has(x.t)).length % 5) * 24;
    Object.assign(e, { id: uid(), x: Math.round(cx - e.w / 2 + off), y: Math.round(cy - e.h / 2 + off) });
    const clean = cleanLive(e);
    if (!clean) return;
    remember();
    editing.elements.push(clean);
    tool = "select";
    selection = new Set([clean.id]);
    syncToolbar();
    changed(editing); redraw();
  }
  function startAdd(kind) {
    if (!editing) return;
    commitText();
    pickMode = kind;
    const pop = $("#boardLinkPick");
    pop.hidden = false;
    const input = $("#boardLinkQuery");
    input.value = "";
    input.placeholder = kind === "card" ? i18n.t("Find a note, quote or task") : kind === "embed" ? i18n.t("Paste a YouTube, Spotify or SoundCloud link") : i18n.t("Find a Home panel");
    input.setAttribute("aria-label", input.placeholder);
    input.type = kind === "embed" ? "url" : "search";
    drawLinkPick();
    setTimeout(() => input.focus(), 0);
  }
  function cardChoices(q) {
    q = String(q || "").trim().toLowerCase();
    const out = [];
    for (const n of state.data.notes || []) {
      if (n.template) continue;
      const name = n.kind === "quote" ? String(n.text || "").split("\n")[0] : linkName(n) || (n.kind === "list" ? i18n.t("Untitled list") : "");
      if (name) out.push({ ref: n.id, name, icon: n.kind === "list" ? "list-checks" : n.kind === "quote" ? "quote" : "notebook-text", sub: n.category || "", at: n.updatedAt || n.createdAt || "" });
      if (n.kind === "list") for (const i of n.items || []) if (!i.done && i.text) out.push({ ref: n.id, item: i.id, name: i.text, icon: "square-check-big", sub: n.text || i18n.t("Untitled list"), at: n.updatedAt || "" });
    }
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return (q ? out.filter((c) => c.name.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q)) : out).slice(0, 30);
  }
  function cardSize(c) {
    const n = (state.data.notes || []).find((x) => x.id === c.ref);
    if (c.item) return { w: 260, h: 110 };
    if (n && n.kind === "quote") return { w: 260, h: 150 };
    if (n && n.kind === "list") return { w: 260, h: Math.min(420, 90 + 30 * (n.items || []).length) };
    return { w: 280, h: 220 };
  }
  function playerSize(p) {
    if (p.site === "YouTube") return { w: 360, h: Math.round(360 / p.ratio) + 32 };
    if (p.site === "Spotify") return { w: 340, h: p.tall ? 384 : 184 };
    return { w: 360, h: 200 };
  }
  const PANEL_SIZE = { calendar: [560, 520], progress: [560, 300], upcoming: [380, 380], scratchpad: [380, 300], pinned: [380, 320], ledger: [380, 360], invest: [380, 360], pick: [380, 360], year: [420, 380] };

  // ---------- text ----------
  let textInput = null, textEditing = null;
  function editText(e) {
    textEditing = e;
    textInput.hidden = false;
    textInput.value = e.text || "";
    textInput.style.color = e.c === "ink" ? "" : e.c;
    placeTextInput();
    redraw();
    setTimeout(() => textInput.focus(), 0);
  }
  function placeTextInput() {
    const e = textEditing;
    const size = textSize(e) * view.k;
    Object.assign(textInput.style, {
      left: (view.x + e.x * view.k) + "px", top: (view.y + e.y * view.k) + "px",
      fontSize: size + "px", lineHeight: "1.25",
    });
    const lines = textInput.value.split("\n");
    const longest = Math.max(0, ...lines.map((l) => textWidth(l, textSize(e)))) * view.k;
    textInput.style.width = Math.max(size * 3, longest + size) + "px";
    textInput.style.height = lines.length * size * 1.25 + "px";
  }
  function commitText() {
    if (!textEditing) return;
    const e = textEditing, text = textInput.value.replace(/\s+$/, "");
    textEditing = null;
    textInput.hidden = true;
    const i = editing.elements.findIndex((x) => x.id === e.id);
    if (text !== (e.text || "")) {
      remember();
      if (!text) { if (i >= 0) editing.elements.splice(i, 1); }
      else if (i >= 0) editing.elements[i] = { ...e, text };
      else editing.elements.push({ ...e, text });
      changed(editing);
    }
    redraw();
  }

  // ---------- adding pictures ----------
  // The Image button's file picker, a paste, or files dropped on the board.
  // Each is kept by images.js (shrunk, waiting to upload) and placed where
  // it was dropped, else in the middle of the screen, no bigger than about
  // half of it.
  function pickPictures() {
    if (!editing) return;
    commitText();
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => addPictures([...input.files]);
    input.click();
  }
  async function addPictures(files, at) {
    const I = window.LifeLogImages;
    const list = files.filter((f) => f && (/^image\//.test(f.type || "") || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name || "")));
    if (!editing || !I || !list.length) return;
    const board = editing;
    const r = svg.getBoundingClientRect();
    const [cx, cy] = at || toWorld(r.width / 2, r.height / 2);
    const room = Math.min(r.width, r.height) * 0.5 / view.k;
    const added = [];
    let failed = null;
    for (const f of list) {
      try {
        const p = await I.addSized(f);
        const k = Math.min(1, room / Math.max(p.w, p.h, 1));
        const w = Math.max(8, Math.round(p.w * k)), h = Math.max(8, Math.round(p.h * k));
        const off = added.length * 24 / view.k;
        added.push({ id: uid(), t: "img", img: p.id, x: Math.round(cx - w / 2 + off), y: Math.round(cy - h / 2 + off), w, h });
      } catch (e) { failed = (e && e.message) || String(e); }
    }
    if (failed) toast(added.length ? i18n.t("{n} of those couldn't be added — {why}", { n: list.length - added.length, why: failed }) : failed, true);
    if (!added.length || editing !== board) return;
    remember();
    editing.elements.push(...added);
    tool = "select";
    selection = new Set(added.map((e) => e.id));
    syncToolbar();
    changed(editing); redraw();
  }
  // ---------- copy, cut, paste ----------
  // Items travel as JSON text on the system clipboard, so they cross boards
  // and the web and desktop apps; `clip` is the in-app copy for when the
  // clipboard is blocked.
  const CLIP_MARK = "board-elements";
  let clip = null, pasteCount = 0;
  const selectedJson = () => JSON.stringify({ lifelog: CLIP_MARK, v: 1, elements: editing.elements.filter((e) => selection.has(e.id)) });
  function parseClip(text) {
    try {
      const o = JSON.parse(text);
      return o && o.lifelog === CLIP_MARK && Array.isArray(o.elements) ? o.elements : null;
    } catch (e) { return null; }
  }
  function boardKeys() {
    const a = document.activeElement;
    return editing && !$("#boardEditor").hidden && a !== textInput && a !== $("#boardName");
  }
  function onCopy(ev) {
    if (!boardKeys() || !selection.size) return;
    clip = selectedJson(); pasteCount = 0;
    ev.clipboardData.setData("text/plain", clip);
    ev.preventDefault();
    syncStyleBar();
  }
  function onCut(ev) {
    if (!boardKeys() || !selection.size) return;
    onCopy(ev);
    deleteSelection();
  }
  async function copyNow() {
    if (!editing || !selection.size) return;
    clip = selectedJson(); pasteCount = 0;
    try { await navigator.clipboard.writeText(clip); } catch (e) { /* the in-app copy still works */ }
    syncStyleBar();
    toast(i18n.t("Copied"));
  }
  async function pasteNow() {
    let list = null;
    try { list = parseClip(await navigator.clipboard.readText()); } catch (e) { /* blocked: use the in-app copy */ }
    if (!list && clip) list = parseClip(clip);
    pasteElements(list);
  }
  function pasteElements(list) {
    if (!editing) return;
    const clean = list ? B_sanitize(list) : [];
    if (!clean.length) { toast(i18n.t("Nothing to paste")); return; }
    commitText();
    const box = boundsOf(clean), r = svg.getBoundingClientRect();
    const [vx1, vy1] = toWorld(0, 0), [vx2, vy2] = toWorld(r.width, r.height);
    const visible = box.x < vx2 && box.x + box.w > vx1 && box.y < vy2 && box.y + box.h > vy1;
    let dx, dy;
    if (visible) dx = dy = (pasteCount + 1) * 16;
    else { dx = Math.round((vx1 + vx2) / 2 - (box.x + box.w / 2)); dy = Math.round((vy1 + vy2) / 2 - (box.y + box.h / 2)); }
    const added = reid(clean.map((e) => moved(e, dx, dy)), uid);
    remember();
    editing.elements.push(...added);
    pasteCount++;
    tool = "select";
    selection = new Set(added.map((e) => e.id));
    syncToolbar();
    changed(editing); redraw();
  }
  const B_sanitize = (list) => sanitizeBoard({ id: "x", elements: list.filter((e) => e && typeof e === "object") }).elements;
  function syncClipButtons() {
    const c = $("#boardCopy"), p = $("#boardPaste");
    if (c) c.hidden = !selection.size;
    if (p) p.hidden = !clip || (tool !== "select" && tool !== "hand");
  }
  // Only what the tool (or the selection) can use. A bar left with nothing
  // fades out still showing its last buttons, so it doesn't shrink first.
  let styleShown = [], styleFading = false;
  function syncStyleBar() {
    const bar = $("#boardStyle");
    if (!bar || !svg) return;
    const sel = editing ? selected() : [];
    $("#boardDelete").hidden = !sel.some((e) => !e.lk);
    syncClipButtons();
    syncSelButtons(sel);
    const s = styleFor(tool, tool === "select" ? sel : []);
    bar.querySelectorAll("[data-color]").forEach((b) => { b.hidden = !s.color; });
    bar.querySelectorAll("[data-width]").forEach((b, i) => {
      b.hidden = !s.width;
      b.title = (s.size ? [i18n.t("Small"), i18n.t("Medium"), i18n.t("Large")] : [i18n.t("Thin"), i18n.t("Medium"), i18n.t("Bold")])[i];
      b.setAttribute("aria-label", b.title);
    });
    $("#boardFill").hidden = !s.fill;
    const shown = [...bar.children].filter((b) => !b.hidden);
    if (shown.length) {
      styleShown = shown; styleFading = false;
      bar.classList.remove("is-off");
      bar.removeAttribute("aria-hidden");
      return;
    }
    if (!bar.classList.contains("is-off")) {
      bar.classList.add("is-off");
      bar.setAttribute("aria-hidden", "true");
      styleFading = true;
    }
    if (styleFading) styleShown.forEach((b) => { b.hidden = false; });
  }

  function onPaste(ev) {
    if (!editing || $("#boardEditor").hidden) return;
    const a = document.activeElement;
    if (a === textInput || a === $("#boardName")) return;
    const text = ev.clipboardData && ev.clipboardData.getData ? ev.clipboardData.getData("text/plain") : "";
    const list = text ? parseClip(text) : null;
    if (list) { ev.preventDefault(); pasteElements(list); return; }
    const files = [...((ev.clipboardData && ev.clipboardData.items) || [])].filter((i) => i.kind === "file" && /^image\//.test(i.type)).map((i) => i.getAsFile()).filter(Boolean);
    if (!files.length) return;
    ev.preventDefault();
    addPictures(files);
  }

  // ---------- chrome ----------
  function syncToolbar() {
    document.querySelectorAll("#boardTools [data-tool]").forEach((b) => {
      b.classList.toggle("on", b.dataset.tool === tool);
      const t = TOOLS.find(([id]) => id === b.dataset.tool);
      if (!t) return;
      b.title = toolTitle(t);
      // The key in the corner, only where there's a keyboard to press it on.
      const K = Keys(), combo = K && K.onComputer() ? K.keysFor("board:" + t[0])[0] : null;
      let cap = b.querySelector(".board-tool-key");
      if (!combo) { if (cap) cap.remove(); return; }
      if (!cap) { cap = el("span", "board-tool-key"); cap.setAttribute("aria-hidden", "true"); b.appendChild(cap); }
      cap.textContent = K.parts(combo).join("+");
    });
    document.querySelectorAll("#boardStyle [data-color]").forEach((b) => b.classList.toggle("on", b.dataset.color === color));
    document.querySelectorAll("#boardStyle [data-width]").forEach((b) => b.classList.toggle("on", +b.dataset.width === width));
    $("#boardFill").classList.toggle("on", fill);
    $("#boardFill").setAttribute("aria-pressed", String(fill));
    svg.dataset.tool = tool;
    syncStyleBar();
  }
  function setTool(t) {
    commitText();
    if (t !== "select") endCrop();
    tool = t;
    if (t !== "select") selection = new Set();
    syncToolbar();
    if (editing) redraw();
  }
  // Colour, width and fill apply to what's selected as well as to what's
  // drawn next — fill only to the shapes that can hold one, and a width to a
  // resized text puts it back on the three sizes.
  function restyle(patch) {
    const fits = (e) => STYLED.has(e.t) && !e.lk && (!("f" in patch) || FILLED.has(e.t));
    if (!editing || !editing.elements.some((e) => selection.has(e.id) && fits(e))) return;
    remember();
    editing.elements = editing.elements.map((e) => {
      if (!selection.has(e.id) || !fits(e)) return e;
      const out = { ...e, ...patch };
      if (out.f === false) { delete out.f; delete out.fc; }
      if ("sw" in patch && e.t === "text") delete out.fs;
      return out;
    });
    changed(editing); redraw();
  }

  function handleKey(e) {
    if (!editing) return false;
    const typing = textEditing && document.activeElement === textInput;
    if (e.key === "Escape") {
      e.preventDefault();
      const menus = ["#boardMenu", "#boardZoomMenu"].map((m) => $(m)).filter((m) => !m.hidden);
      if (closeBoardTags()) { /* the tags sheet first */ }
      else if (closeLinkPick()) { /* then the link picker */ }
      else if (menus.length) menus.forEach((m) => { m.hidden = true; });
      else if (cropping) endCrop();
      else if (textEditing) commitText();
      else if (selection.size) { selection = new Set(); redraw(); }
      else closeBoard();
      return true;
    }
    if (typing || document.activeElement === $("#boardName") || !$("#tagSheet").hidden || !$("#boardLinkPick").hidden) return true;
    if (cropping && e.key === "Enter") { e.preventDefault(); endCrop(); return true; }
    const mod = e.ctrlKey || e.metaKey;
    const letter = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
    if (mod && letter === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return true; }
    if (mod && letter === "y") { e.preventDefault(); redo(); return true; }
    if (mod && letter === "g") { e.preventDefault(); toggleGroup(); return true; }
    if (mod && letter === "l") { e.preventDefault(); toggleLock(); return true; }
    if (mod && letter === "a") { e.preventDefault(); setTool("select"); selection = new Set(editing.elements.filter((x) => !x.lk).map((x) => x.id)); redraw(); return true; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); return true; }
    if (e.key === " ") { spaceDown = true; svg.classList.add("panning"); e.preventDefault(); return true; }
    if (!mod && (e.key === "+" || e.key === "=")) { zoomBy(1.25); return true; }
    if (!mod && e.key === "-") { zoomBy(1 / 1.25); return true; }
    if (!mod && e.key === "0") { fitView(); applyView(); return true; }
    // By the physical key (src/keys.js), so a Hebrew layout still finds them.
    const t = Keys() && Keys().matchBoard(e);
    if (t) { e.preventDefault(); if (t === "image") pickPictures(); else if (ADDS.has(t)) startAdd(t); else setTool(t); return true; }
    return true;
  }
  function handleKeyUp(e) {
    if (e.key === " ") { spaceDown = false; if (svg) svg.classList.remove("panning"); }
  }

  // ---------- export ----------
  // An exported SVG — and the PNG, which is drawn from one — can't reach the
  // app's copy of Virgil, so a board with text carries the font inside it.
  let fontData = null;
  async function embeddedFont() {
    if (fontData) return fontData;
    const buf = await (await fetch(FONT_URL)).arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    fontData = btoa(bin);
    return fontData;
  }
  // An exported file can't reach the app's pictures either: each goes in as
  // a data: URL. A web picture stays its address.
  const asDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  async function inlinePictures(node) {
    for (const img of node.querySelectorAll("image")) {
      const href = img.getAttribute("href");
      if (!href || !href.startsWith("blob:")) continue;
      try { img.setAttribute("href", await asDataUrl(await (await fetch(href)).blob())); }
      catch (e) { /* see above */ }
    }
  }
  async function resolvedSvg(b) {
    const I = window.LifeLogImages;
    if (I) {
      await Promise.all(b.elements.filter((e) => e.t === "img" && e.img && !picUrls.has(e.img)).map(async (e) => {
        const u = await I.url(e.img).catch(() => null);
        if (u) picUrls.set(e.img, u);
      }));
    }
    const out = boardSvg(b.elements, { pad: 32 });
    await inlinePictures(out);
    if (b.elements.some((e) => e.t === "text")) {
      try {
        const style = svgEl("style", {});
        style.textContent = `@font-face{font-family:Virgil;src:url(data:font/woff2;base64,${await embeddedFont()}) format("woff2")}`;
        out.insertBefore(style, out.firstChild);
      } catch (e) { /* the system font, then */ }
    }
    const cs = getComputedStyle(document.body);
    out.setAttribute("xmlns", SVG);
    out.setAttribute("color", cs.color);
    out.setAttribute("font-family", BOARD_FONT);
    const vb = out.getAttribute("viewBox").split(" ").map(Number);
    out.setAttribute("width", Math.round(vb[2])); out.setAttribute("height", Math.round(vb[3]));
    out.insertBefore(svgEl("rect", { x: vb[0], y: vb[1], width: vb[2], height: vb[3], fill: cs.backgroundColor }), out.querySelector(":scope > :not(style)"));
    return { node: out, w: vb[2], h: vb[3] };
  }
  const fileName = (b, ext) => (b.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "board") + "." + ext;
  async function exportSvg() {
    if (!editing) return;
    const { node } = await resolvedSvg(editing);
    download(fileName(editing, "svg"), new XMLSerializer().serializeToString(node), "image/svg+xml");
  }
  async function exportPng() {
    if (!editing) return;
    const b = editing;
    const { node, w, h } = await resolvedSvg(b);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(2, 4096 / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      download(fileName(b, "png"), canvas.toDataURL("image/png").split(",")[1], "image/png", { base64: true });
    };
    img.onerror = () => toast(i18n.t("Couldn't make a PNG of this board"), true);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(node));
  }
  async function deleteBoard() {
    if (!editing) return;
    if (!confirm(i18n.t("Delete \"{name}\"? You can bring it back from Settings → History → Boards.", { name: editing.name }))) return;
    // What was drawn in the last moments goes out first, so the version
    // History keeps is the board as you last saw it.
    if (saveTimer || changedSince) await flush();
    const id = editing.id;
    editing = null;
    $("#boardEditor").hidden = true;
    doc.boards = doc.boards.filter((b) => b.id !== id);
    changedSince++;
    await flush();
    toast(i18n.t("Board deleted"));
    if (isBoardsMode()) render();
  }

  function wire() {
    svg = $("#boardSvg");
    world = svg.querySelector(".board-world");
    liveLayer = svg.querySelector(".board-live");
    liveEls = svg.querySelector(".board-live-els");
    overlay = svg.querySelector(".board-overlay");
    textInput = $("#boardTextInput");

    const tools = $("#boardTools");
    for (const t of TOOLS) {
      const [id, icon, label] = t;
      const b = el("button", "board-tool" + (ADDS.has(id) && id !== "image" ? " board-tool-add" : ""));
      b.appendChild(ico(icon));
      b.type = "button"; b.dataset.tool = id; b.title = toolTitle(t); b.setAttribute("aria-label", label);
      b.onclick = (ev) => { ev.stopPropagation(); if (id === "image") pickPictures(); else if (ADDS.has(id)) startAdd(id); else setTool(id); };
      tools.appendChild(b);
    }
    // A phone has no room for every tool: the ones that add something go
    // behind one "+" there (styles.css hides one set or the other).
    const plus = el("button", "board-tool board-add-more");
    plus.type = "button";
    plus.appendChild(ico("plus"));
    plus.title = i18n.t("Add");
    plus.setAttribute("aria-label", plus.title);
    plus.setAttribute("aria-haspopup", "menu");
    const addMenu = el("div", "menu-pop board-add-menu");
    addMenu.id = "boardAddMenu";
    addMenu.hidden = true;
    for (const t of TOOLS.filter(([id]) => ADDS.has(id) && id !== "image")) {
      const b = el("button");
      b.type = "button";
      b.appendChild(ico(t[1]));
      b.appendChild(document.createTextNode(t[2]));
      b.onclick = (ev) => { ev.stopPropagation(); addMenu.hidden = true; startAdd(t[0]); };
      addMenu.appendChild(b);
    }
    plus.onclick = (ev) => { ev.stopPropagation(); addMenu.hidden = !addMenu.hidden; };
    document.addEventListener("click", () => { addMenu.hidden = true; });
    tools.appendChild(plus);
    $("#boardEditor").appendChild(addMenu);
    const style = $("#boardStyle");
    for (const c of COLORS) {
      const b = el("button", "board-swatch");
      b.type = "button"; b.dataset.color = c; b.title = c === "ink" ? i18n.t("Ink") : c;
      b.setAttribute("aria-label", i18n.t("Colour {name}", { name: b.title }));
      b.style.setProperty("--swatch", c === "ink" ? "var(--text)" : c);
      b.onclick = () => { color = c; syncToolbar(); restyle({ c }); };
      style.appendChild(b);
    }
    for (const w of WIDTHS) {
      const b = el("button", "board-width");
      b.type = "button"; b.dataset.width = w; b.title = [i18n.t("Thin"), i18n.t("Medium"), i18n.t("Bold")][WIDTHS.indexOf(w)];
      b.setAttribute("aria-label", b.title);
      b.appendChild(el("span", "board-width-dot")).style.height = w + 1 + "px";
      b.onclick = () => { width = w; syncToolbar(); restyle({ sw: w }); };
      style.appendChild(b);
    }
    style.appendChild($("#boardFill"));
    style.addEventListener("transitionend", (ev) => {
      if (ev.target !== style || !style.classList.contains("is-off") || !styleFading) return;
      styleFading = false;
      styleShown.forEach((b) => { b.hidden = true; });
    });

    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("dragover", (ev) => { if (editing && [...(ev.dataTransfer && ev.dataTransfer.types) || []].includes("Files")) ev.preventDefault(); });
    svg.addEventListener("drop", (ev) => {
      if (!editing || !ev.dataTransfer || !ev.dataTransfer.files.length) return;
      ev.preventDefault();
      addPictures([...ev.dataTransfer.files], pointerWorld(ev));
    });
    document.addEventListener("paste", onPaste);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    $("#boardCopy").onclick = copyNow;
    $("#boardGroup").onclick = toggleGroup;
    $("#boardLock").onclick = toggleLock;
    $("#boardLink").onclick = (e) => { e.stopPropagation(); if ($("#boardLinkPick").hidden) openLinkPick(); else closeLinkPick(); };
    $("#boardCrop").onclick = () => { if (cropping) endCrop(); else { const one = selected()[0]; if (one) startCrop(one.id); } };
    $("#boardCropReset").onclick = resetCrop;
    $("#boardLinkQuery").addEventListener("input", drawLinkPick);
    $("#boardLinkQuery").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); const first = $("#boardLinkList .link-pick-row:not(.board-link-off)"); if (first) first.click(); }
    });
    $("#boardLinkPick").addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => closeLinkPick());
    for (const i of document.querySelectorAll("#boardOpts [data-opt]")) i.addEventListener("change", () => setOpt(i.dataset.opt, i.checked));
    $("#boardOpts").addEventListener("click", (e) => e.stopPropagation());
    $("#boardPaste").onclick = pasteNow;
    textInput.addEventListener("input", placeTextInput);
    textInput.addEventListener("blur", () => commitText());
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); }
    });
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("resize", () => { if (editing) applyView(); });

    $("#boardBack").onclick = closeBoard;
    $("#boardUndo").onclick = undo;
    $("#boardRedo").onclick = redo;
    $("#boardDelete").onclick = deleteSelection;
    // Zoom lives behind one button showing the zoom, rather than three
    // floating over the drawing; the menu stays open for a run of presses.
    $("#boardZoomIn").onclick = (e) => { e.stopPropagation(); zoomBy(1.25); };
    $("#boardZoomOut").onclick = (e) => { e.stopPropagation(); zoomBy(1 / 1.25); };
    $("#boardZoomReset").onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1); };
    $("#boardFit").onclick = () => { fitView(); applyView(); };
    const menu = $("#boardMenu"), zoomMenu = $("#boardZoomMenu");
    $("#boardMenuBtn").onclick = (e) => { e.stopPropagation(); zoomMenu.hidden = true; menu.hidden = !menu.hidden; };
    $("#boardZoomBtn").onclick = (e) => { e.stopPropagation(); menu.hidden = true; zoomMenu.hidden = !zoomMenu.hidden; };
    document.addEventListener("click", () => { menu.hidden = true; zoomMenu.hidden = true; });
    $("#boardFill").onclick = () => { fill = !fill; syncToolbar(); restyle({ f: fill }); };
    $("#boardExportPng").onclick = exportPng;
    $("#boardExportSvg").onclick = exportSvg;
    $("#boardDeleteBoard").onclick = deleteBoard;
    $("#boardName").addEventListener("change", () => {
      if (!editing) return;
      const name = $("#boardName").value.trim() || "Untitled board";
      if (name !== editing.name) { editing.name = name; changed(editing); }
    });
    $("#boardTagsBtn").onclick = openBoardTags;
    $("#boardTagsItem").onclick = () => { $("#boardMenu").hidden = true; openBoardTags(); };
    $("#boardCategory").addEventListener("change", () => {
      if (!editing) return;
      const cat = $("#boardCategory").value;
      if (cat === (editing.category || "")) return;
      if (cat) editing.category = cat; else delete editing.category;
      changed(editing);
    });

    // Closed by anything else — a widget's action clearing the way, say —
    // still saves.
    new MutationObserver(() => { if ($("#boardEditor").hidden && editing) { editing = null; flush(); } })
      .observe($("#boardEditor"), { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && saveTimer) flush(); });
    window.addEventListener("pagehide", () => { if (saveTimer) flush(); });
    syncToolbar();
    syncOpts();
  }

  window.LifeLogBoards = {
    init, wire,
    renderBoards, newBoard, nextName, openBoard, closeBoard, isEditing, handleKey, isBoardsMode, renderHistory,
    thumbnail: (b, opts) => boardSvg(b.elements, { thumb: true, ...(opts || {}) }), isLoaded: () => !!doc,
    allBoards: () => (doc ? boards() : null), missingPictures, linkPictures,
    ensureLoaded, flush, addBoards, boardsForExport, replaceAll, sanitizeBoard, boardsNow: () => listed(), toggleFav,
    scratchBoard: () => (doc ? scratchBoard() : null), openScratch, keepScratch, setCategory, deleteBoards, renameCategory, renameCategoryIn, renameTag, renameTagIn, closeBoardTags,
    // pure helpers (test/boards.test.js)
    refreshLive, playerOf, styleFor, cleanLive, embedWidget,
    smoothPoints, guideSnap, bindAt, bindPoint, followBindings, withGroups, reid, fullPictureBox, cropFrom, cleanShared, linkTarget, boardText,
    parseClip, simplify, encodePoints, decodePoints, hitTest, bbox, boundsOf, moved, scaled, rotated, penPath, segDist,
  };
})();
