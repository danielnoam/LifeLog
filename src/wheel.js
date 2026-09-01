// LifeLog — the random wheel: a canvas spinner shared by two callers. The
// Backlog's "Pick random" modal hands it the titles it would otherwise draw
// silently, and the + menu opens it on a list you type yourself (saved to
// this device, so the list you spin every week is still there next time).
// Self-contained apart from the usual app plumbing handed in by init(ctx).
(function () {
  let $, toast, prefersReducedMotion, palette;

  function init(ctx) {
    ({ $, toast, prefersReducedMotion, palette } = ctx);
  }

  const WHEEL_KEY = "lifelog-wheel-v1";
  // Past this many slices the labels stop being readable at phone width, so
  // a longer list is sampled down to this rather than drawn as a barcode.
  const MAX_SEGMENTS = 12;
  const SPIN_MS = 4200;

  // Segments currently on the wheel: { label, color, data }. `data` is
  // whatever the caller wants back in onResult (a backlog item, or nothing).
  let segments = [];
  let angle = 0;          // current wheel rotation, radians
  let spinning = false;
  let winner = null;
  let onResult = null;    // caller's action for the landed segment, if any
  let actionLabel = "";
  let custom = false;     // typed-list mode: the options editor is the point
  // Bumped by every open and close, so an animation still in flight when the
  // modal is dismissed (the overlay closes it mid-spin) drops out instead of
  // turning the wheel the next opening put up.
  let spinToken = 0;

  function loadSaved() {
    try {
      const raw = JSON.parse(localStorage.getItem(WHEEL_KEY));
      if (raw && Array.isArray(raw.options)) return raw.options.map(String);
    } catch (e) {}
    return [];
  }
  function saveOptions(options) {
    try { localStorage.setItem(WHEEL_KEY, JSON.stringify({ options })); } catch (e) {}
  }

  function colorAt(i) { return palette[i % palette.length]; }

  // Label ink per slice: the category ramp runs from deep red to pale lime,
  // and white on the lime end is unreadable. `dim` accounts for the shade
  // laid over every other slice below.
  function labelInk(hex, dim) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return { fill: "#fff", shadow: "rgba(0,0,0,.55)" };
    const n = parseInt(m[1], 16);
    const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) * dim;
    return lum > 150
      ? { fill: "#141821", shadow: "rgba(255,255,255,.45)" }
      : { fill: "#fff", shadow: "rgba(0,0,0,.55)" };
  }

  function toSegments(labels) {
    return labels.map((label, i) => ({ label: String(label), color: colorAt(i), data: null }));
  }

  // ---------- drawing ----------
  // The canvas is sized from its own laid-out width every paint: the modal is
  // fluid, and a backing store fixed at open time would blur on rotate.
  function canvasSize(cv) {
    const dpr = window.devicePixelRatio || 1;
    const css = Math.max(160, Math.round(cv.clientWidth || 280));
    const px = Math.round(css * dpr);
    // Both dimensions, every time: a canvas defaults to 300×150, so a stage
    // that happens to land on a 300px width would otherwise keep the 150px
    // backing store and draw the wheel stretched to half height.
    if (cv.width !== px || cv.height !== px) { cv.width = px; cv.height = px; }
    return { css, dpr };
  }

  // Cut a label down to what fits the slice's radial run, ellipsis included,
  // rather than letting it run out over the rim.
  function fitLabel(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(out + "…").width > maxWidth) out = out.slice(0, -1);
    return out + "…";
  }

  function draw() {
    const cv = $("#wheelCanvas");
    if (!cv) return;
    const { css, dpr } = canvasSize(cv);
    const ctx = cv.getContext("2d");
    const r = (css / 2) - 4;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, css, css);
    ctx.save();
    ctx.translate(css / 2, css / 2);
    ctx.rotate(angle);

    const n = segments.length;
    if (!n) { ctx.restore(); return; }
    const step = (Math.PI * 2) / n;
    const rim = getComputedStyle(document.documentElement).getPropertyValue("--bg-elev").trim() || "#1a1f29";

    ctx.font = "600 " + Math.max(10, Math.min(15, Math.round(css / 22))) + "px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let i = 0; i < n; i++) {
      const from = i * step;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, from, from + step);
      ctx.closePath();
      ctx.fillStyle = segments[i].color;
      ctx.fill();
      // Backlog slices are colored by category, so neighbours from the same
      // one would be a single wedge; every other slice gets a shade over it.
      if (i % 2) { ctx.fillStyle = "rgba(0,0,0,.16)"; ctx.fill(); }
      // Hairline so the boundary survives even between two shaded pairs.
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.save();
      // Labels run along the radius, but a slice on the left of the wheel
      // would have its text upside-down — so that half is drawn flipped and
      // anchored at the rim from the other side. Re-decided every frame off
      // the slice's live angle, so the wheel is readable wherever it stops.
      const flipped = Math.cos(from + step / 2 + angle) < 0;
      ctx.rotate(from + step / 2);
      if (flipped) ctx.rotate(Math.PI);
      const ink = labelInk(segments[i].color, i % 2 ? 0.84 : 1);
      ctx.fillStyle = ink.fill;
      ctx.shadowColor = ink.shadow;
      ctx.shadowBlur = 3;
      ctx.textAlign = flipped ? "left" : "right";
      const label = fitLabel(ctx, segments[i].label, r - 46);
      ctx.fillText(label, flipped ? -(r - 14) : r - 14, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // ---------- spinning ----------
  // The winner is drawn first and the animation is then aimed at it, which
  // keeps the odds exactly uniform however the easing lands — the spin is
  // the reveal, not the randomness.
  function spin() {
    if (spinning || !segments.length) return;
    const n = segments.length;
    const index = Math.floor(Math.random() * n);
    const step = (Math.PI * 2) / n;
    // Where that slice's centre has to end up: under the pointer at 12
    // o'clock, give or take a little so it doesn't land dead-centre every
    // time. The 8% inset keeps the jitter clear of the slice edges.
    const jitter = (Math.random() - 0.5) * step * 0.84;
    const mid = (index + 0.5) * step;
    const turns = 4 + Math.floor(Math.random() * 3);
    let target = -Math.PI / 2 - mid + jitter;
    while (target < angle + turns * Math.PI * 2) target += Math.PI * 2;

    setResult(null);
    if (prefersReducedMotion()) {
      angle = target;
      draw();
      land(index);
      return;
    }

    spinning = true;
    syncButtons();
    const token = ++spinToken;
    const from = angle, delta = target - angle, start = performance.now();
    const step2 = (ts) => {
      if (token !== spinToken) return;
      const t = Math.min(1, (ts - start) / SPIN_MS);
      angle = from + delta * (1 - Math.pow(1 - t, 4)); // ease-out-quart
      draw();
      if (t < 1) { requestAnimationFrame(step2); return; }
      angle = ((target % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      spinning = false;
      land(index);
    };
    requestAnimationFrame(step2);
  }

  function land(index) {
    setResult(segments[index]);
    syncButtons();
  }

  function setResult(seg) {
    winner = seg;
    const box = $("#wheelResult");
    box.hidden = !seg;
    $("#wheelResultText").textContent = seg ? seg.label : "";
  }

  // Drop the landed slice and go again — an elimination round, and the only
  // sane way to use the wheel for "put these in an order".
  function removeWinner() {
    if (!winner || spinning) return;
    segments = segments.filter((s) => s !== winner);
    if (custom) saveOptions(segments.map((s) => s.label));
    setResult(null);
    if (!segments.length) { syncButtons(); draw(); return; }
    recolor();
    draw();
    syncButtons();
    spin();
  }

  // Slice colors are positional, so anything that changes the list has to
  // re-run them or the wheel ends up with two neighbours the same color.
  function recolor() {
    if (custom) segments.forEach((s, i) => { s.color = colorAt(i); });
  }

  function syncButtons() {
    const has = segments.length > 0;
    $("#wheelSpinBtn").disabled = spinning || !has;
    $("#wheelSpinBtn").textContent = spinning ? "…" : (winner ? "Again" : "Spin");
    $("#wheelRemoveBtn").hidden = !winner || !has;
    $("#wheelRemoveBtn").disabled = spinning || segments.length < 2;
    const action = $("#wheelActionBtn");
    action.hidden = !winner || !onResult;
    action.textContent = actionLabel || "Open";
    action.disabled = spinning;
    $("#wheelEmpty").hidden = has;
  }

  // ---------- options editor (typed-list mode) ----------
  function openEditor(show) {
    const box = $("#wheelEdit");
    box.hidden = show === undefined ? !box.hidden : !show;
    if (!box.hidden) {
      $("#wheelOptions").value = segments.map((s) => s.label).join("\n");
      $("#wheelOptions").focus();
    }
    $("#wheelEditBtn").setAttribute("aria-expanded", String(!box.hidden));
  }

  function applyOptions() {
    const labels = $("#wheelOptions").value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 60);
    if (!labels.length) { toast("Add at least one option", true); return; }
    custom = true;
    onResult = null;
    segments = toSegments(labels);
    saveOptions(labels);
    setResult(null);
    openEditor(false);
    draw();
    syncButtons();
  }

  // ---------- open / close ----------
  // opts: { title, hint, labels | items, actionLabel, onResult, custom }
  // `items` are { label, color, data } already — the Backlog passes its own
  // category colors so a slice matches the chip it came from.
  function openWheel(opts) {
    const o = opts || {};
    custom = !!o.custom;
    onResult = o.onResult || null;
    actionLabel = o.actionLabel || "";
    spinning = false;
    spinToken++;
    winner = null;

    if (o.items) segments = o.items.slice(0, MAX_SEGMENTS);
    else if (o.labels) segments = toSegments(o.labels.slice(0, MAX_SEGMENTS));
    else segments = toSegments(loadSaved());

    $("#wheelTitle").textContent = o.title || "Spin the wheel";
    const hint = $("#wheelHint");
    hint.textContent = o.hint || "";
    hint.hidden = !o.hint;
    $("#wheelEditBtn").hidden = !custom;
    $("#wheelModal").hidden = false;
    setResult(null);
    openEditor(custom && !segments.length);
    // Laid out only once the overlay is visible — the canvas has no width
    // to measure before that.
    requestAnimationFrame(() => { draw(); syncButtons(); });
  }

  function closeWheel() {
    $("#wheelModal").hidden = true;
    spinning = false;
    spinToken++;
  }
  function isOpen() { return !$("#wheelModal").hidden; }

  function wire() {
    $("#wheelSpinBtn").onclick = spin;
    $("#wheelRemoveBtn").onclick = removeWinner;
    $("#wheelCloseBtn").onclick = closeWheel;
    $("#wheelEditBtn").onclick = () => openEditor();
    $("#wheelApplyBtn").onclick = applyOptions;
    $("#wheelActionBtn").onclick = () => {
      if (!winner || !onResult) return;
      const seg = winner, cb = onResult;
      closeWheel();
      cb(seg);
    };
    window.addEventListener("resize", () => { if (isOpen()) draw(); });
  }

  window.LifeLogWheel = { init, wire, openWheel, closeWheel, isOpen, MAX_SEGMENTS };
})();
