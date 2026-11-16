// keel: motion, on window.Keel.motion. Springs sampled into CSS linear()
// curves, since there's no animation library, and the moves the apps make
// with them. Each app makes its own engine with its own springs; which
// moves it uses, and how, its DESIGN.md says.
//
//   const M = window.Keel.motion.create({
//     touch:   { sheet: [400, 32], control: [600, 40] },        // [stiffness, damping]
//     desktop: { sheet: [700, "critical"], control: [1000, "critical"] },  // or null: no desktop tier
//     desktopQuery: "(min-width: 1024px) and (pointer: fine)",
//     reducedMs: 120,       // the fade every move becomes under reduced motion
//     cssPrefix: "--spring", // --spring-sheet, --spring-sheet-ms, ... or null
//   });
//
// Nothing passed gets the values above. Every move returns a promise
// that settles when it ends or is cancelled, and none blocks input.
// Under prefers-reduced-motion every move is a short fade; with
// data-motion="off" on <html> (setStill) nothing moves at all. What slides
// in from an edge uses the spring stopped at 1, so it never overshoots the
// edge. Only transform, opacity, clip-path and scale move.
//
// Sideways moves follow the page's direction, read from <html dir> at each
// move: right to left, a screen is pushed in from the left edge, a sidebar
// comes from the right, the next page from the left. `from` (where a drag
// left something) stays in screen pixels either way. rtl() and x(n) (n,
// negated when right to left) are for the app's own drag code.
(function () {
  // A spring from rest at 0 to 1, sampled every frame into linear().
  function spring(k, c) {
    if (c === "critical") c = 2 * Math.sqrt(k);
    let x = 0, v = 0, t = 0;
    const pts = [0];
    while (t < 2) {
      for (let i = 0; i < 4; i++) { const a = -k * (x - 1) - c * v; v += a / 240; x += v / 240; }
      t += 1 / 60;
      pts.push(+x.toFixed(4));
      if (Math.abs(1 - x) < 0.002 && Math.abs(v) < 0.02) break;
    }
    pts[pts.length - 1] = 1;
    return { ms: Math.round(t * 1000), curve: "linear(" + pts.join(", ") + ")", pts };
  }
  // The same spring stopped at 1, for what slides in from an edge or sits
  // against one: its overshoot carried a screen, bar or sheet a few pixels
  // past where it rests, and what was behind flickered through the gap.
  function edge(s) {
    const pts = s.pts.map((x) => Math.min(1, x));
    return { ms: s.ms, curve: "linear(" + pts.join(", ") + ")", pts };
  }

  const DEFAULTS = {
    touch: { sheet: [400, 32], control: [600, 40] },
    desktop: { sheet: [700, "critical"], control: [1000, "critical"] },
    desktopQuery: "(min-width: 1024px) and (pointer: fine)",
    reducedMs: 120,
    cssPrefix: "--spring",
  };
  // Older WebViews without linear(): the nearest cubic-bezier, no overshoot.
  const FALLBACK = "cubic-bezier(0.2, 0.9, 0.3, 1)";

  function create(options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const springs = (s) => {
      const sheet = spring(s.sheet[0], s.sheet[1]), control = spring(s.control[0], s.control[1]);
      return { sheet, control, sheetEdge: edge(sheet), controlEdge: edge(control) };
    };
    const TOUCH = springs(o.touch);
    const DESK = o.desktop ? springs(o.desktop) : TOUCH;
    const RMS = o.reducedMs;
    const hasLinear = !!(window.CSS && CSS.supports && CSS.supports("transition-timing-function", "linear(0, 1)"));
    const hasClip = !!(window.CSS && CSS.supports && CSS.supports("clip-path", "inset(1px round 2px)"));
    const mq = (q) => (window.matchMedia ? matchMedia(q) : { matches: false, addEventListener() {} });
    const reducedQ = mq("(prefers-reduced-motion: reduce)");
    const deskQ = o.desktop ? mq(o.desktopQuery) : { matches: false, addEventListener() {} };
    const still = () => document.documentElement.dataset.motion === "off";
    const reduced = () => !!reducedQ.matches || still();
    function setStill(on) {
      if (on) document.documentElement.dataset.motion = "off";
      else delete document.documentElement.dataset.motion;
    }
    const desk = () => !!deskQ.matches;
    const rtl = () => document.documentElement.dir === "rtl";
    const x = (n) => (rtl() ? -n : n);

    function timing(kind) {
      if (reduced()) return { duration: RMS, easing: "linear" };
      const set = desk() ? DESK : TOUCH;
      const s = set[kind] || set.sheet;
      return { duration: s.ms, easing: hasLinear ? s.curve : FALLBACK };
    }

    // How many moves are running, so work that can wait (a redraw) waits.
    let moving = 0;
    const busy = () => moving > 0;
    // frames move on the spring; under reduced motion only a fade runs,
    // in when `show` is true, out when false, none when null.
    function run(els, kind, show, end) {
      const list = els.filter((x) => x && x[0] && x[0].animate);
      if (!list.length || still()) { if (end) end(); return Promise.resolve(); }
      const done = [];
      if (reduced()) {
        if (show != null) done.push(list[0][0].animate([{ opacity: show ? 0 : 1 }, { opacity: show ? 1 : 0 }], { duration: RMS, easing: "linear", fill: "both" }));
      } else list.forEach(([el, frames]) => done.push(el.animate(frames, { ...timing(kind), fill: "both" })));
      moving++;
      return Promise.all(done.map((a) => a.finished)).then(() => { if (end) end(); done.forEach((a) => a.cancel()); }, () => {}).finally(() => { moving--; });
    }
    const one = (el, frames, kind, show) => run([[el, frames]], kind, show);
    const back = (f) => f.slice().reverse();
    const box = (el) => el.getBoundingClientRect();

    // A screen pushed over another: in from the end edge (the right, or
    // the left right to left). On touch the screen under it drifts a
    // quarter the other way; on a desktop it stays.
    const drift = () => "translateX(" + x(-25) + "%)";
    function push(el, under) {
      const f = [{ transform: "translateX(" + x(100) + "%)" }, { transform: "none" }];
      return run([[el, f], !desk() && under && [under, [{ transform: "none" }, { transform: drift() }]]], "sheetEdge", true);
    }
    function pop(el, under, from = 0) {
      const f = [{ transform: "translateX(" + from + "px)" }, { transform: "translateX(" + x(100) + "%)" }];
      return run([[el, f], !desk() && under && [under, [{ transform: drift() }, { transform: "none" }]]], "sheetEdge", false);
    }

    // A screen opened from a card: it settles in from slightly small,
    // centred on the card that was tapped, as it fades up; closing runs it
    // the other way. The card never stretches into the screen: the two
    // share nothing to morph between. With no card it's a push or pop.
    const growing = new WeakMap();
    const SETTLE = 0.92;
    function grows(el, r, open, end) {
      if (!r || !r.width) return (open ? push(el) : pop(el)).then(() => { if (end) end(); });
      if (reduced()) return run([[el, []]], "sheet", open, end);
      const was = growing.get(el);
      if (was) was.anims.forEach((a) => a.cancel());
      const T = box(el);
      const k = 1 - SETTLE;
      const dx = (r.left + r.width / 2 - (T.left + T.width / 2)) * k, dy = (r.top + r.height / 2 - (T.top + T.height / 2)) * k;
      const small = "translate(" + dx + "px, " + dy + "px) scale(" + SETTLE + ")";
      const t = { ...timing("sheet"), fill: "both" };
      const blend = { duration: t.duration * (open ? 0.3 : 0.45), easing: "ease-out", fill: "both" };
      el.classList.add("zooming");
      const anims = [
        el.animate(open ? [{ transform: small }, { transform: "none" }] : [{ transform: "none" }, { transform: small }], open ? t : { ...t, duration: blend.duration }),
        el.animate(open ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], blend),
      ];
      const me = { anims };
      growing.set(el, me);
      moving++;
      return Promise.all(anims.map((a) => a.finished)).then(() => {
        if (end) end();
        anims.forEach((a) => a.cancel());
        el.classList.remove("zooming");
      }, () => {}).finally(() => { moving--; if (growing.get(el) === me) growing.delete(el); });
    }
    // rad and panel are kept for the old call shape and not used.
    const grow = (el, r) => grows(el, r, true);
    const shrink = (el, r, rad, panel, end) => grows(el, r, false, end);

    // A sheet from the bottom edge; closing goes on from where a drag left it.
    function rise(el) {
      return one(el, [{ transform: "translateY(100%)" }, { transform: "none" }], "sheetEdge", true);
    }
    function sink(el, from = 0) {
      return one(el, [{ transform: "translateY(" + from + "px)" }, { transform: "translateY(100%)" }], "sheet", false);
    }
    function settle(el, from) {
      return one(el, [{ transform: "translateY(" + from + "px)" }, { transform: "none" }], "controlEdge", null);
    }
    // The dimming behind a sheet, a sidebar or a dialog, on the same
    // spring, from where a drag left it.
    function dim(el, show, from) {
      if (!el) return Promise.resolve();
      const left = el.style.opacity;
      el.style.opacity = "";
      const a = from != null ? from : left !== "" ? parseFloat(left) : show ? 0 : 1;
      return one(el, [{ opacity: a }, { opacity: show ? 1 : 0 }], "sheet", show);
    }

    // A sidebar from the start edge (the left, or the right right to
    // left); closing goes on from where a drag left it, and a short drag
    // springs back. What's under it (one element or several) drifts away
    // from it a fifth of its width.
    const sideDrift = (side) => "translateX(" + x(Math.round(side.offsetWidth * 0.2)) + "px)";
    // How much of the way open a sidebar dragged to `from` px still is.
    const sideLeft = (el, from) => (el.offsetWidth ? 1 + x(from) / el.offsetWidth : 1);
    const unders = (under, frames) => (!under ? [] : Array.isArray(under) ? under : [under]).map((u) => [u, frames]);
    function slideIn(el, under) {
      return run([[el, [{ transform: "translateX(" + x(-100) + "%)" }, { transform: "none" }]], ...unders(under, [{ transform: "none" }, { transform: sideDrift(el) }])], "sheetEdge", true);
    }
    function slideOut(el, from = 0, under) {
      const k = sideLeft(el, from);
      return run([[el, [{ transform: "translateX(" + from + "px)" }, { transform: "translateX(" + x(-100) + "%)" }]],
        ...unders(under, [{ transform: "translateX(" + x(Math.round(el.offsetWidth * 0.2 * k)) + "px)" }, { transform: "none" }])], from ? "controlEdge" : "sheetEdge", false);
    }
    function slideBack(el, from, under) {
      const k = sideLeft(el, from);
      return run([[el, [{ transform: "translateX(" + from + "px)" }, { transform: "none" }]],
        ...unders(under, [{ transform: "translateX(" + x(Math.round(el.offsetWidth * 0.2 * k)) + "px)" }, { transform: sideDrift(el) }])], "controlEdge", null);
    }

    // A menu grows out of the button that opened it, from that button's
    // corner, and shrinks back into it. popGeom is the menu's shape at the
    // button; popAt(g, k) is k of the way to full.
    function popGeom(el, anchor) {
      const P = box(el), B = anchor;
      if (!B || !B.width || !P.width || !hasClip) return null;
      const w = Math.min(B.width, P.width), h = Math.min(B.height, P.height);
      const left = Math.max(0, Math.min(P.width - w, B.left - P.left));
      const below = B.top < P.top + P.height / 2;
      const top = below ? 0 : P.height - h;
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      return { top, right: P.width - left - w, bottom: P.height - top - h, left, round: Math.min(r, h / 2), r, dy: below ? B.top - P.top : B.bottom - P.bottom };
    }
    function popAt(g, k) {
      const at = (v) => (v * (1 - k)).toFixed(2) + "px";
      return { clipPath: "inset(" + [g.top, g.right, g.bottom, g.left].map(at).join(" ") + " round " + (g.round + (g.r - g.round) * k).toFixed(2) + "px)",
        transform: k >= 1 ? "none" : "translateY(" + at(g.dy) + ")" };
    }
    function popFrames(el, anchor) {
      const g = popGeom(el, anchor);
      if (!g) return [{ transform: "scale(0.6)", transformOrigin: "50% 0" }, { transform: "none", transformOrigin: "50% 0" }];
      return [popAt(g, 0), popAt(g, 1)];
    }
    // A dialog opened from a button: it fades in as it settles from 96%,
    // leaning toward its button, and fades out the same way, quicker.
    function fadeFrames(el, B) {
      const P = box(el);
      const ox = B && B.width && P.width ? Math.max(0, Math.min(P.width, B.left + B.width / 2 - P.left)) + "px" : "50%";
      const oy = B && B.width && P.width ? Math.max(0, Math.min(P.height, B.top + B.height / 2 - P.top)) + "px" : "50%";
      const origin = ox + " " + oy;
      return [{ transform: "scale(0.96)", transformOrigin: origin, opacity: 0 }, { opacity: 1, offset: 0.45 }, { transform: "none", transformOrigin: origin, opacity: 1 }];
    }
    const dialogIn = (el, anchor) => one(el, fadeFrames(el, anchor), "control", true);
    const dialogOut = (el, anchor) => {
      const f = fadeFrames(el, anchor);
      return one(el, [f[2], { opacity: 0, offset: 0.7 }, { ...f[0], transform: "scale(0.98)", opacity: 0 }], "control", false);
    };
    const popFrom = (el, anchor) => one(el, popFrames(el, anchor), "control", true);
    const popInto = (el, anchor) => one(el, back(popFrames(el, anchor)), "control", false);
    // A drop-down leaves by only the last stretch of its arrival, run
    // backwards, and is gone before it reaches the button.
    function popOut(el, anchor) {
      const g = popGeom(el, anchor);
      const frames = g ? [{ ...popAt(g, 1), opacity: 1 }, { ...popAt(g, 0.75), opacity: 0 }]
        : [{ transform: "none", transformOrigin: "50% 0", opacity: 1 }, { transform: "scale(0.9)", transformOrigin: "50% 0", opacity: 0 }];
      return one(el, frames, "control", false);
    }

    // Bars and toasts come in past the screen's edge they sit nearest and
    // leave the same way. side: top, bottom, left, right, or start / end,
    // which follow the page's direction.
    function fromPast(r, side) {
      if (side === "start") side = rtl() ? "right" : "left";
      else if (side === "end") side = rtl() ? "left" : "right";
      if (side === "top") return "translateY(" + -Math.ceil(r.bottom + 8) + "px)";
      if (side === "left") return "translateX(" + -Math.ceil(r.right + 8) + "px)";
      if (side === "right") return "translateX(" + Math.ceil(innerWidth - r.left + 8) + "px)";
      return "translateY(" + Math.ceil(innerHeight - r.top + 8) + "px)";
    }
    const edgeIn = (el, side = "bottom") => one(el, [{ transform: fromPast(box(el), side) }, { transform: "none" }], "sheetEdge", true);
    const edgeOut = (el, side = "bottom") => one(el, [{ transform: "none" }, { transform: fromPast(box(el), side) }], "sheet", false);

    // One thing opening out of a part of another (a card from a player's
    // play button): only `part` shows at first, sitting on `r`, then the
    // rest opens out around it as it travels, clipped. `into` runs it back.
    function morph(el, r, into, part) {
      if (!r || !r.width) return into ? edgeOut(el, "bottom") : edgeIn(el, "bottom");
      const a = box(el), p = part ? box(part) : a;
      const s = r.width / p.width;
      const dx = r.left + r.width / 2 - (p.left + p.width / 2), dy = r.top + r.height / 2 - (p.top + p.height / 2);
      const t = p.top - a.top, l = p.left - a.left, b = a.bottom - p.bottom, w = a.right - p.right;
      const rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const origin = l + p.width / 2 + "px " + (t + p.height / 2) + "px";
      // The open end reaches past the element, so its shadow isn't cut off.
      const f = [
        { transform: "translate(" + dx + "px, " + dy + "px) scale(" + s + ")", transformOrigin: origin, clipPath: "inset(" + t + "px " + w + "px " + b + "px " + l + "px round " + p.height / 2 + "px)" },
        { transform: "none", transformOrigin: origin, clipPath: "inset(-40px round " + (rad + 40) + "px)" },
      ];
      return one(el, into ? back(f) : f, "sheet", !into);
    }

    // Something new in a list grows from nothing where it lands; something
    // removed shrinks to nothing. Its neighbours slide (flip).
    const appear = (el) => one(el, [{ transform: "scale(0)" }, { transform: "none" }], "sheet", true);
    const vanish = (el) => one(el, [{ transform: "none" }, { transform: "scale(0)" }], "control", false);

    // Where things are now; then flip slides each one that moved from
    // there to where it is after a change. `enter` adds [el, frames] runs.
    function measure(els) {
      const m = new Map();
      for (const el of els) { const r = box(el); if (r.width || r.height) m.set(el, r); }
      return m;
    }
    function flip(before, enter) {
      const runs = [];
      for (const [el, r] of before) {
        if (!el.isConnected) continue;
        const a = box(el), dx = r.left - a.left, dy = r.top - a.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        if ((a.bottom < 0 && r.bottom < 0) || (a.top > innerHeight && r.top > innerHeight)) continue;
        runs.push([el, [{ transform: "translate(" + dx + "px, " + dy + "px)" }, { transform: "none" }]]);
      }
      for (const [el, frames] of enter || []) runs.push([el, frames]);
      return run(runs, "sheet", null);
    }
    // What leaves in a flip: a copy of it, fixed where it was, goes past
    // the top, bottom, left, right, start or end edge and is removed.
    function ghostOut(el, r, side, layer) {
      const g = el.cloneNode(true);
      g.removeAttribute("id");
      g.setAttribute("aria-hidden", "true");
      g.inert = true;
      Object.assign(g.style, { position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", margin: "0", pointerEvents: "none", zIndex: "1", boxSizing: "border-box" });
      (layer || document.body).appendChild(g);
      const to = fromPast(r, ["top", "left", "right", "start", "end"].includes(side) ? side : "bottom");
      return one(g, [{ transform: "none" }, { transform: to }], "sheet", false).finally(() => g.remove());
    }

    // Going on to the next page: sideways (`side`) the page leaves past
    // the start edge and the next comes in from the end (from the right,
    // or the left right to left); otherwise the next comes up from the
    // bottom. dir -1 runs it the other way.
    const along = (side, d) => (side ? "translateX(" + x(d) : "translateY(" + d) + "%)";
    // from: where a sideways swipe left it, in px.
    function pageOut(el, side = true, dir = 1, from = 0) {
      return one(el, [{ transform: from ? "translateX(" + from + "px)" : "none" }, { transform: along(side, -100 * dir) }], "control", false)
        .then(() => { el.style.visibility = "hidden"; });
    }
    // A swipe that wasn't far enough: back where it was.
    function pageBack(el, from) {
      return one(el, [{ transform: "translateX(" + from + "px)" }, { transform: "none" }], "controlEdge", null);
    }
    function pageIn(el, side = true, dir = 1) {
      el.style.visibility = "";
      return one(el, [{ transform: along(side, 100 * dir) }, { transform: "none" }], "sheetEdge", true);
    }

    // Press feedback: whatever matches `selector` sinks a few pixels under
    // the finger and springs back on the control spring when let go. By
    // pixels rather than a ratio, so a chip dips visibly and a full-width
    // row barely moves; the `scale` property composes with any transform
    // already there. skip(node) leaves one out. Returns a function that
    // unwires it.
    function press(selector, { skip, px = 4, most = 0.1 } = {}) {
      let held = null;
      const release = () => {
        if (!held) return;
        const { node, anim, to } = held;
        held = null;
        const p = (anim.effect && anim.effect.getComputedTiming().progress) || 0;
        const from = 1 + (to - 1) * p;
        anim.cancel();
        if (!reduced()) node.animate([{ scale: from }, { scale: 1 }], timing("control"));
      };
      const down = (e) => {
        release();
        if (e.button > 0 || reduced()) return;
        const node = e.target && e.target.closest && e.target.closest(selector);
        if (!node || node.disabled || (skip && skip(node)) || !node.animate) return;
        const r = node.getBoundingClientRect();
        const to = 1 - Math.min(most, px / Math.max(r.width, r.height, 1));
        const anim = node.animate([{ scale: 1 }, { scale: to }], { duration: 90, easing: "ease-out", fill: "forwards" });
        held = { node, anim, to };
      };
      const ups = ["pointerup", "pointercancel", "blur"];
      document.addEventListener("pointerdown", down, true);
      for (const t of ups) window.addEventListener(t, release, true);
      return () => {
        release();
        document.removeEventListener("pointerdown", down, true);
        for (const t of ups) window.removeEventListener(t, release, true);
      };
    }

    // The springs as CSS custom properties, for the transitions the app's
    // CSS owns (presses, progress bars, switches); they follow the tier.
    function paintVars() {
      if (!o.cssPrefix) return;
      const set = desk() ? DESK : TOUCH, root = document.documentElement.style, p = o.cssPrefix;
      root.setProperty(p + "-sheet", hasLinear ? set.sheet.curve : FALLBACK);
      root.setProperty(p + "-sheet-ms", set.sheet.ms + "ms");
      root.setProperty(p + "-control", hasLinear ? set.control.curve : FALLBACK);
      root.setProperty(p + "-control-ms", set.control.ms + "ms");
      root.setProperty(p + "-control-edge", hasLinear ? set.controlEdge.curve : FALLBACK);
    }
    paintVars();
    deskQ.addEventListener("change", paintVars);

    return {
      springs: { touch: TOUCH, desktop: DESK },
      busy, timing, reduced, still, setStill, desk, rtl, x, push, pop, grow, shrink, rise, sink, settle, dim, slideIn, slideOut, slideBack,
      popFrom, popInto, popOut, dialogIn, dialogOut, edgeIn, edgeOut, morph, appear, vanish, measure, flip, ghostOut, fromPast,
      pageOut, pageBack, pageIn, sideDrift, press,
    };
  }

  window.Keel = window.Keel || {};
  window.Keel.motion = { create, spring, edge, DEFAULTS };
})();
