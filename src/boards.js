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
// `c` is a colour, or "ink" for the theme's text colour, so a board drawn in
// the dark theme still reads in the light one. `seed` keeps a rough shape's
// wobble the same every time it's drawn.
(function () {
  let state, $, el, toast, uid, emptyState, download, Storage, render;

  function init(ctx) {
    ({ state, $, el, toast, uid, emptyState, download, Storage, render } = ctx);
  }

  const COLORS = ["ink", "#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5"];
  const WIDTHS = [2, 4, 8];
  const TEXT_SIZE = { 2: 18, 4: 26, 8: 40 };
  const TOOLS = [
    ["select", "↖", "Select (V)", "v"], ["hand", "✋", "Move the board (H)", "h"],
    ["pen", "✎", "Pen (P)", "p"], ["eraser", "⌫", "Eraser (E)", "e"],
    ["rect", "▭", "Rectangle (R)", "r"], ["ellipse", "◯", "Ellipse (O)", "o"],
    ["arrow", "→", "Arrow (A)", "a"], ["line", "╱", "Line (L)", "l"], ["text", "T", "Text (T)", "t"],
  ];

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
  const ROTATES = new Set(["rect", "ellipse", "text"]);
  // A shape's own box, before any rotation: what `a` turns about its centre.
  function rawBox(e) {
    if (e.t === "rect" || e.t === "ellipse") return norm(e.x, e.y, e.w, e.h);
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
    } else { out.w = Math.max(1, Math.round(w)); out.h = Math.max(1, Math.round(h)); }
    out.x = Math.round(cx - w / 2); out.y = Math.round(cy - h / 2);
    return out;
  }
  // Rotating by `da` about (cx, cy). Lines and strokes turn their points;
  // shapes and text move their centre round and add to their angle.
  function rotated(e, cx, cy, da) {
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
  function sanitizeBoard(b) {
    const out = {
      id: b.id || (uid ? uid() : "b" + Date.now().toString(36)),
      name: String(b.name == null ? "" : b.name).trim() || "Untitled board",
      createdAt: b.createdAt || null,
      updatedAt: b.updatedAt || b.createdAt || "1970-01-01T00:00:00.000Z",
      elements: Array.isArray(b.elements) ? b.elements.filter((e) => e && e.id && e.t) : [],
    };
    return out;
  }

  // ---------- the document ----------
  let doc = null, loading = null, loadedAt = 0;
  let saveTimer = null, saving = null, changedSince = 0;
  const boards = () => (doc ? doc.boards : []);
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
    saving = Storage.boards.save({ boards: sent }).then((res) => {
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
  async function boardsForExport() {
    await ensureLoaded();
    return JSON.parse(JSON.stringify(boards()));
  }

  // ---------- history (Settings → History → Boards) ----------
  // Versions of boards.json, this device's and GitHub's. Opening one lists
  // its boards against what you have now; any that changed or has gone can
  // be brought back on its own, without rolling the other boards back.
  const sameBoard = (a, b) => a && b && a.name === b.name && JSON.stringify(a.elements) === JSON.stringify(b.elements);
  async function renderHistory(list, status) {
    status.hidden = false;
    status.textContent = "Loading…";
    list.innerHTML = "";
    let versions;
    try { await ensureLoaded(); versions = await Storage.boards.history(); }
    catch (e) { status.textContent = "Couldn't load board history: " + (e.message || e); return; }
    if (!versions.length) { status.textContent = "No board saves yet."; list.hidden = true; return; }
    status.hidden = true;
    list.hidden = false;
    for (const v of versions) {
      const row = el("div", "sitem board-hist-row");
      const text = el("span", "sitem-text");
      text.appendChild(el("span", "sitem-title", new Date(v.savedAt).toLocaleString()));
      text.appendChild(el("span", "sitem-sub", v.source === "github" ? "GitHub" : "This device"));
      row.appendChild(text);
      const btns = el("span", "sitem-btns");
      const open = el("button", "btn btn-small", "Open");
      open.type = "button";
      btns.appendChild(open);
      row.appendChild(btns);
      const inner = el("div", "board-hist-boards");
      inner.hidden = true;
      open.onclick = async () => {
        if (!inner.hidden) { inner.hidden = true; open.textContent = "Open"; return; }
        open.disabled = true;
        try { fillVersion(inner, await Storage.boards.version(v), v); inner.hidden = false; open.textContent = "Close"; }
        catch (e) { toast("Couldn't read that version: " + (e.message || e), true); }
        open.disabled = false;
      };
      list.appendChild(row);
      list.appendChild(inner);
    }
  }
  function fillVersion(inner, version, v) {
    inner.innerHTML = "";
    const then = (version.boards || []).map(sanitizeBoard);
    if (!then.length) { inner.appendChild(el("p", "muted board-hist-empty", "No boards in this version.")); return; }
    for (const b of then) {
      const now = findBoard(b.id);
      const row = el("div", "sitem board-hist-board");
      const text = el("span", "sitem-text");
      text.appendChild(el("span", "sitem-title", b.name));
      const status = !now ? "Deleted since" : sameBoard(now, b) ? "Same as now" : "Changed since";
      text.appendChild(el("span", "sitem-sub", `${b.elements.length} element${b.elements.length === 1 ? "" : "s"} · ${status}`));
      row.appendChild(text);
      if (!sameBoard(now, b)) {
        const btns = el("span", "sitem-btns");
        const back = el("button", "btn btn-small", "Bring back");
        back.type = "button";
        back.onclick = async () => { if (await restoreBoard(b, v)) { back.remove(); text.lastChild.textContent = `${b.elements.length} elements · Brought back`; } };
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
    const when = new Date(v.savedAt).toLocaleString();
    if (!confirm(now ? `Put "${b.name}" back to how it was on ${when}? What's on it now is replaced.` : `Bring back "${b.name}" as it was on ${when}?`)) return false;
    const copy = { ...JSON.parse(JSON.stringify(b)), updatedAt: new Date().toISOString() };
    if (now) doc.boards = doc.boards.map((x) => (x.id === b.id ? copy : x));
    else doc.boards.push(copy);
    changedSince++;
    await flush();
    toast(`Brought back "${b.name}"`);
    if (isBoardsMode()) render();
    return true;
  }

  // ---------- the Boards mode ----------
  const isBoardsMode = () => state.view === "notes" && state.notesMode === "boards";
  function renderBoards(root) {
    if (!doc) {
      root.appendChild(el("p", "muted boards-loading", "Loading boards…"));
      ensureLoaded().then(() => { if (isBoardsMode()) render(); });
      return;
    }
    // Picks up another device's drawing when you come back to the list.
    if (Date.now() - loadedAt > 60000 && !editing && !changedSince) {
      ensureLoaded(true).then(() => { if (isBoardsMode() && !editing) render(); });
    }
    fontReady().then((fresh) => { if (fresh && isBoardsMode() && !editing) render(); });
    const q = (state.search || "").trim().toLowerCase();
    const list = boards().filter((b) => !q || b.name.toLowerCase().includes(q))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (!boards().length) {
      root.appendChild(emptyState({
        glyph: "✎", title: "No boards yet",
        body: "A board is a page to draw on: sketches, diagrams, arrows and notes, in a hand-drawn style.",
        action: "New board", onAction: () => newBoard(),
      }));
      return;
    }
    const grid = el("div", "board-grid");
    const add = el("button", "board-card board-new");
    add.type = "button";
    add.appendChild(el("span", "board-new-plus", "+"));
    add.appendChild(el("span", "board-new-label", "New board"));
    add.onclick = () => newBoard();
    grid.appendChild(add);
    for (const b of list) {
      const card = el("button", "board-card");
      card.type = "button";
      card.dataset.id = b.id;
      const thumb = el("div", "board-thumb");
      thumb.appendChild(boardSvg(b.elements, { thumb: true }));
      card.appendChild(thumb);
      const meta = el("div", "board-meta");
      meta.appendChild(el("span", "board-name", b.name));
      meta.appendChild(el("span", "board-when", when(b.updatedAt)));
      card.appendChild(meta);
      card.onclick = () => openBoard(b.id);
      grid.appendChild(card);
    }
    if (q && !list.length) root.appendChild(el("p", "muted", "No board is called that."));
    root.appendChild(grid);
  }
  function when(iso) {
    const d = new Date(iso);
    if (isNaN(d) || d.getFullYear() < 1971) return "";
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  }

  async function newBoard() {
    await ensureLoaded();
    const now = new Date().toISOString();
    const n = boards().length + 1;
    const b = sanitizeBoard({ id: uid(), name: "Board " + n, createdAt: now, updatedAt: now, elements: [] });
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
    const key = JSON.stringify([e.t, e.x, e.y, e.w, e.h, e.x2, e.y2, e.sw, e.seed, !!e.f]);
    const hit = roughCache.get(e.id);
    if (hit && hit.key === key) return hit.paths;
    // "S" and "F" stand in for the stroke and fill colour: the colour itself
    // is applied at draw time, so a recolour or a theme change needs no new
    // paths. A fill is rough.js's hachure — strokes, drawn in the fill colour.
    const o = { seed: e.seed || 1, roughness: 1.1, bowing: 1, strokeWidth: e.sw, stroke: "S" };
    if (e.f) Object.assign(o, { fill: "F", fillStyle: "hachure", hachureGap: 5 + e.sw, fillWeight: Math.max(1, e.sw / 2) });
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
  function drawElement(e) {
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
      for (const p of paths) g.appendChild(svgEl("path", { d: p.d, stroke: p.stroke ? color : "none", fill: p.fill ? color : "none", "stroke-width": p.w }));
    } else if (e.t === "rect") g.appendChild(svgEl("rect", norm(e.x, e.y, e.w, e.h)));
    else if (e.t === "ellipse") g.appendChild(svgEl("ellipse", { cx: e.x + e.w / 2, cy: e.y + e.h / 2, rx: Math.abs(e.w / 2), ry: Math.abs(e.h / 2) }));
    else {
      g.appendChild(svgEl("line", { x1: e.x, y1: e.y, x2: e.x2, y2: e.y2 }));
      if (e.t === "arrow") for (const [hx, hy] of arrowHead(e)) g.appendChild(svgEl("line", { x1: e.x2, y1: e.y2, x2: hx, y2: hy }));
    }
    return g;
  }
  function turn(e) {
    if (!e.a || !ROTATES.has(e.t)) return null;
    const r = rawBox(e);
    return `rotate(${e.a * 180 / Math.PI} ${r.x + r.w / 2} ${r.y + r.h / 2})`;
  }
  // A board as a standalone SVG: the list's thumbnails, and the export.
  function boardSvg(elements, { thumb = false, pad = 24 } = {}) {
    const b = boundsOf(elements) || { x: 0, y: 0, w: 320, h: 200 };
    const svg = svgEl("svg", { viewBox: `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`, class: thumb ? "board-thumb-svg" : null });
    if (thumb) svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    for (const e of elements) svg.appendChild(drawElement(e));
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
  let svg, world, overlay, liveLayer;

  function openBoard(id) {
    const b = findBoard(id);
    if (!b) return;
    editing = b;
    selection = new Set(); undoStack = []; redoStack = []; op = null; pointers.clear(); pinch = null;
    $("#boardName").value = b.name;
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
  function closeBoard() {
    if (!editing) return;
    commitText();
    const name = $("#boardName").value.trim() || "Untitled board";
    if (name !== editing.name) { editing.name = name; changed(editing); }
    editing = null;
    $("#boardEditor").hidden = true;
    flush();
    if (isBoardsMode()) render();
  }
  const isEditing = () => !!editing;

  function applyView() {
    world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
    overlay.setAttribute("transform", world.getAttribute("transform"));
    liveLayer.setAttribute("transform", world.getAttribute("transform"));
    svg.style.backgroundPosition = `${view.x}px ${view.y}px`;
    $("#boardZoomBtn").textContent = Math.round(view.k * 100) + "%";
    svg.style.backgroundSize = `${24 * view.k}px ${24 * view.k}px`;
    if (textInput && !textInput.hidden) placeTextInput();
  }
  function redraw() {
    world.innerHTML = "";
    for (const e of editing.elements) {
      if (textEditing && e.id === textEditing.id) continue;
      world.appendChild(drawElement(e));
    }
    drawSelection();
    applyView();
    $("#boardUndo").disabled = !undoStack.length;
    $("#boardRedo").disabled = !redoStack.length;
    $("#boardDelete").hidden = !selection.size;
  }
  function redrawAfterMerge() {
    const fresh = findBoard(editing.id);
    if (!fresh) { closeBoard(); toast("This board was deleted on another device"); return; }
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
      overlay.appendChild(svgEl("rect", { ...norm(op.x0, op.y0, op.x1 - op.x0, op.y1 - op.y0), class: "board-box" }));
    }
    const busy = op && (op.kind === "box" || (op.kind === "move" && op.moved));
    if (tool !== "select" || !els.length || busy) return;
    const B = boundsOf(els), pad = 8 / view.k, hs = 5 / view.k;
    const x1 = B.x - pad, y1 = B.y - pad, x2 = B.x + B.w + pad, y2 = B.y + B.h + pad;
    if (els.length > 1) overlay.appendChild(svgEl("rect", { x: x1, y: y1, width: x2 - x1, height: y2 - y1, class: "board-sel board-sel-group" }));
    // A corner handle sits `pad` outside the selection, but scales it by its
    // own corners — so the drawing's edge follows the finger exactly.
    const bx1 = B.x, by1 = B.y, bx2 = B.x + B.w, by2 = B.y + B.h;
    for (const [corner, hx, hy, cx, cy, ax, ay] of [
      ["nw", x1, y1, bx1, by1, bx2, by2], ["ne", x2, y1, bx2, by1, bx1, by2],
      ["se", x2, y2, bx2, by2, bx1, by1], ["sw", x1, y2, bx1, by2, bx2, by1]]) {
      handles.push({ kind: "resize", corner, x: hx, y: hy, cx, cy, ax, ay });
      overlay.appendChild(svgEl("rect", { x: hx - hs, y: hy - hs, width: hs * 2, height: hs * 2, class: "board-handle", "data-handle": corner }));
    }
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
    if (!selection.size) return;
    remember();
    editing.elements = editing.elements.filter((e) => !selection.has(e.id));
    selection = new Set();
    changed(editing); redraw();
  }

  function onPointerDown(ev) {
    if (!editing || (ev.button && ev.button !== 1)) return;
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
    if (tool === "select") {
      const h = handleAt(x, y, tolerance(ev));
      const orig = () => editing.elements.filter((e) => selection.has(e.id)).map((e) => ({ ...e }));
      if (h && h.kind === "resize") { op = { kind: "resize", h, orig: orig(), moved: false }; return; }
      if (h && h.kind === "rotate") { op = { kind: "rotate", h, a0: Math.atan2(y - h.cy, x - h.cx), orig: orig(), moved: false }; return; }
      const hit = topHit(x, y, tolerance(ev));
      if (hit) {
        if (!selection.has(hit.id)) selection = ev.shiftKey ? new Set([...selection, hit.id]) : new Set([hit.id]);
        op = { kind: "move", x0: x, y0: y, orig: editing.elements.filter((e) => selection.has(e.id)).map((e) => ({ ...e })), moved: false, tapped: hit };
      } else {
        if (!ev.shiftKey) selection = new Set();
        op = { kind: "box", x0: x, y0: y, x1: x, y1: y };
      }
      redraw();
      return;
    }
    // A shape: drawn live from where the pointer went down.
    const e = { id: uid(), t: tool, c: color, sw: width, seed: Math.floor(Math.random() * 2 ** 31) };
    if (fill && (tool === "rect" || tool === "ellipse")) e.f = true;
    if (tool === "rect" || tool === "ellipse") Object.assign(e, { x: Math.round(x), y: Math.round(y), w: 0, h: 0 });
    else Object.assign(e, { x: Math.round(x), y: Math.round(y), x2: Math.round(x), y2: Math.round(y) });
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
    const [x, y] = pointerWorld(ev);
    if (op.kind === "pan") {
      view = { ...op.view, x: op.view.x + ev.clientX - op.sx, y: op.view.y + ev.clientY - op.sy };
      applyView();
    } else if (op.kind === "pen") {
      // Coalesced events keep a fast stroke smooth where the browser batches.
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const c of evs.length ? evs : [ev]) op.pts.push(pointerWorld(c));
      op.node.setAttribute("d", penPath(op.pts));
    } else if (op.kind === "erase") {
      // Along the way from the last position, not just at it: a quick swipe
      // arrives in a few far-apart events and would jump over a stroke.
      const tol = tolerance(ev), [lx, ly] = op.last;
      const steps = Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / tol));
      for (let i = 1; i <= steps; i++) eraseAt(lx + (x - lx) * i / steps, ly + (y - ly) * i / steps, tol);
      op.last = [x, y];
    } else if (op.kind === "move") {
      const dx = x - op.x0, dy = y - op.y0;
      if (!op.moved && Math.hypot(dx, dy) * view.k < 3) return;
      if (!op.moved) { remember(); op.moved = true; }
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
        const onlyText = op.orig.every((e) => e.t === "text");
        if (ev.shiftKey || onlyText) sx = sy = Math.max(sx, sy);
        next = (e) => scaled(e, ax, ay, sx, sy);
      } else {
        let da = Math.atan2(y - op.h.cy, x - op.h.cx) - op.a0;
        if (ev.shiftKey) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12);
        next = (e) => rotated(e, op.h.cx, op.h.cy, da);
      }
      const byId = new Map(op.orig.map((e) => [e.id, next(e)]));
      editing.elements = editing.elements.map((e) => byId.get(e.id) || e);
      redraw();
    } else if (op.kind === "box") {
      op.x1 = x; op.y1 = y;
      drawSelection();
    } else if (op.kind === "shape") {
      const e = op.e;
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
      const pts = simplify(done.pts, 0.8 / view.k);
      remember();
      editing.elements.push({ id: uid(), t: "pen", c: color, sw: width, p: encodePoints(pts) });
      changed(editing); redraw();
    } else if (done.kind === "erase") {
      if (done.gone.size) changed(editing);
    } else if (done.kind === "resize" || done.kind === "rotate") {
      if (done.moved) changed(editing);
      redraw();
    } else if (done.kind === "move") {
      if (done.moved) changed(editing);
      else if (done.tapped && done.tapped.t === "text") {
        // A pointerup's `detail` is always 0, so a double tap is timed here.
        const now = Date.now();
        if (lastTap && lastTap.id === done.tapped.id && now - lastTap.at < 450) { lastTap = null; editText(done.tapped); }
        else lastTap = { id: done.tapped.id, at: now };
      }
    } else if (done.kind === "box") {
      const r = norm(done.x0, done.y0, done.x1 - done.x0, done.y1 - done.y0);
      if (r.w > 2 || r.h > 2) {
        for (const e of editing.elements) {
          const b = bbox(e);
          if (b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h) selection.add(e.id);
        }
      }
      redraw();
    } else if (done.kind === "shape") {
      liveLayer.innerHTML = "";
      const e = done.e;
      const size = e.t === "rect" || e.t === "ellipse" ? Math.hypot(e.w, e.h) : Math.hypot(e.x2 - e.x, e.y2 - e.y);
      if (size * view.k < 4) return;
      if (e.t === "rect" || e.t === "ellipse") Object.assign(e, norm(e.x, e.y, e.w, e.h));
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
    if (!hit) return;
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
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) zoomAt(ev.clientX - r.left, ev.clientY - r.top, view.k * Math.exp(-ev.deltaY * 0.01));
    else { view = { ...view, x: view.x - ev.deltaX, y: view.y - ev.deltaY }; applyView(); }
  }

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

  // ---------- chrome ----------
  function syncToolbar() {
    document.querySelectorAll("#boardTools [data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === tool));
    document.querySelectorAll("#boardStyle [data-color]").forEach((b) => b.classList.toggle("on", b.dataset.color === color));
    document.querySelectorAll("#boardStyle [data-width]").forEach((b) => b.classList.toggle("on", +b.dataset.width === width));
    $("#boardFill").classList.toggle("on", fill);
    $("#boardFill").setAttribute("aria-pressed", String(fill));
    svg.dataset.tool = tool;
  }
  function setTool(t) {
    commitText();
    tool = t;
    if (t !== "select") selection = new Set();
    syncToolbar();
    if (editing) redraw();
  }
  // Colour, width and fill apply to what's selected as well as to what's
  // drawn next — fill only to the shapes that can hold one, and a width to a
  // resized text puts it back on the three sizes.
  function restyle(patch) {
    const fits = (e) => !("f" in patch) || e.t === "rect" || e.t === "ellipse";
    if (!editing || !editing.elements.some((e) => selection.has(e.id) && fits(e))) return;
    remember();
    editing.elements = editing.elements.map((e) => {
      if (!selection.has(e.id) || !fits(e)) return e;
      const out = { ...e, ...patch };
      if (out.f === false) delete out.f;
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
      if (menus.length) menus.forEach((m) => { m.hidden = true; });
      else if (textEditing) commitText();
      else if (selection.size) { selection = new Set(); redraw(); }
      else closeBoard();
      return true;
    }
    if (typing || document.activeElement === $("#boardName")) return true;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return true; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return true; }
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setTool("select"); selection = new Set(editing.elements.map((x) => x.id)); redraw(); return true; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); return true; }
    if (e.key === " ") { spaceDown = true; svg.classList.add("panning"); e.preventDefault(); return true; }
    if (!mod && (e.key === "+" || e.key === "=")) { zoomBy(1.25); return true; }
    if (!mod && e.key === "-") { zoomBy(1 / 1.25); return true; }
    if (!mod && e.key === "0") { fitView(); applyView(); return true; }
    if (!mod && !e.altKey) {
      const t = TOOLS.find(([, , , key]) => key === e.key.toLowerCase());
      if (t) { setTool(t[0]); return true; }
    }
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
  async function resolvedSvg(b) {
    const out = boardSvg(b.elements, { pad: 32 });
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
    img.onerror = () => toast("Couldn't make a PNG of this board", true);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(node));
  }
  async function deleteBoard() {
    if (!editing) return;
    if (!confirm(`Delete "${editing.name}"? You can bring it back from Settings → History → Boards.`)) return;
    // What was drawn in the last moments goes out first, so the version
    // History keeps is the board as you last saw it.
    if (saveTimer || changedSince) await flush();
    const id = editing.id;
    editing = null;
    $("#boardEditor").hidden = true;
    doc.boards = doc.boards.filter((b) => b.id !== id);
    changedSince++;
    await flush();
    toast("Board deleted");
    if (isBoardsMode()) render();
  }

  function wire() {
    svg = $("#boardSvg");
    world = svg.querySelector(".board-world");
    liveLayer = svg.querySelector(".board-live");
    overlay = svg.querySelector(".board-overlay");
    textInput = $("#boardTextInput");

    const tools = $("#boardTools");
    for (const [id, icon, label] of TOOLS) {
      const b = el("button", "board-tool", icon);
      b.type = "button"; b.dataset.tool = id; b.title = label; b.setAttribute("aria-label", label);
      b.onclick = () => setTool(id);
      tools.appendChild(b);
    }
    const style = $("#boardStyle");
    for (const c of COLORS) {
      const b = el("button", "board-swatch");
      b.type = "button"; b.dataset.color = c; b.title = c === "ink" ? "Ink" : c;
      b.setAttribute("aria-label", "Colour " + b.title);
      b.style.setProperty("--swatch", c === "ink" ? "var(--text)" : c);
      b.onclick = () => { color = c; syncToolbar(); restyle({ c }); };
      style.appendChild(b);
    }
    for (const w of WIDTHS) {
      const b = el("button", "board-width");
      b.type = "button"; b.dataset.width = w; b.title = ["Thin", "Medium", "Bold"][WIDTHS.indexOf(w)];
      b.setAttribute("aria-label", b.title);
      b.appendChild(el("span", "board-width-dot")).style.height = w + 1 + "px";
      b.onclick = () => { width = w; syncToolbar(); restyle({ sw: w }); };
      style.appendChild(b);
    }
    style.appendChild($("#boardFill"));

    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
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

    // Closed by anything else — a widget's action clearing the way, say —
    // still saves.
    new MutationObserver(() => { if ($("#boardEditor").hidden && editing) { editing = null; flush(); } })
      .observe($("#boardEditor"), { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && saveTimer) flush(); });
    window.addEventListener("pagehide", () => { if (saveTimer) flush(); });
    syncToolbar();
  }

  window.LifeLogBoards = {
    init, wire,
    renderBoards, newBoard, openBoard, closeBoard, isEditing, handleKey, isBoardsMode, renderHistory,
    ensureLoaded, flush, addBoards, boardsForExport, sanitizeBoard, boardsNow: () => boards(),
    // pure helpers (test/boards.test.js)
    simplify, encodePoints, decodePoints, hitTest, bbox, boundsOf, moved, scaled, rotated, penPath, segDist,
  };
})();
