// Zero-dependency tests for src/boards.js's pure geometry and for the board
// merge in src/merge.js — run with `node test/boards.test.js`.
const assert = require("assert");
global.window = {};
require("../src/boards.js");
const M = require("../src/merge.js");
const B = global.window.LifeLogBoards;
B.init({ uid: (() => { let n = 0; return () => "u" + (n++); })() });

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

// ---------- pictures ----------
test("a picture keeps only a kept id, an https address or a missing file's name", () => {
  const els = B.sanitizeBoard({ id: "p", name: "P", elements: [
    { id: "a", t: "img", x: 1, y: 2, w: 30, h: 20, img: "abcdefgh12.png", extra: "x", cr: [0.1, 0, 0.5, 1] },
    { id: "b", t: "img", x: 0, y: 0, w: 10, h: 10, img: "../../evil.png" },
    { id: "c", t: "img", x: 0, y: 0, w: 10, h: 10, url: "javascript:alert(1)" },
    { id: "d", t: "img", x: 0, y: 0, w: 10, h: 10, url: "http://example.com/a.png" },
    { id: "e", t: "img", x: 0, y: 0, w: 10, h: 10, url: "https://example.com/a.png" },
    { id: "f", t: "img", x: 0, y: 0, w: 10, h: 10, miss: "Pasted Image.png", cr: [0, 0, 1, 1] },
  ] }).elements;
  assert.deepStrictEqual(els.map((e) => e.id), ["a", "e", "f"]);
  // A field this build doesn't know rides along (a newer build's); the
  // ones it does know are still checked.
  assert.deepStrictEqual(els[0], { id: "a", t: "img", x: 1, y: 2, w: 30, h: 20, img: "abcdefgh12.png", extra: "x", cr: [0.1, 0, 0.5, 1] });
  assert.ok(!("cr" in els[2]), "a crop of the whole picture is no crop");
});

test("a picture is hit anywhere in its box, turns, and keeps its shape when resized", () => {
  const e = { id: "i", t: "img", x: 0, y: 0, w: 100, h: 50, img: "abcdefgh12.png" };
  assert.ok(B.hitTest(e, 50, 25, 2));
  assert.ok(!B.hitTest(e, 150, 25, 2));
  assert.deepStrictEqual(B.bbox(e), { x: 0, y: 0, w: 100, h: 50 });
  const big = B.scaled(e, 0, 0, 2, 2);
  assert.deepStrictEqual([big.x, big.y, big.w, big.h], [0, 0, 200, 100]);
  const turned = B.rotated(e, 50, 25, Math.PI / 2);
  assert.strictEqual(turned.a, 1.5708);
  assert.ok(B.hitTest(turned, 50, 70, 2), "turned upright, it reaches below its old box");
});

// ---------- strokes ----------
test("a board keeps a field this build doesn't know", () => {
  const b = B.sanitizeBoard({ id: "t", name: "T", tags: ["trip"], elements: [] });
  assert.deepStrictEqual(b.tags, ["trip"]);
});

test("the scratch flag (Home's scratch board) survives sanitizing, and only when set", () => {
  assert.strictEqual(B.sanitizeBoard({ id: "a", name: "S", scratch: true }).scratch, true);
  assert.ok(!("scratch" in B.sanitizeBoard({ id: "b", name: "B", scratch: false })));
});

test("a straight stroke simplifies to its two ends", () => {
  const pts = Array.from({ length: 50 }, (_, i) => [i * 2, i]);
  assert.deepStrictEqual(B.simplify(pts, 0.5), [[0, 0], [98, 49]]);
});
test("a curve keeps enough points to stay within the tolerance", () => {
  const pts = Array.from({ length: 120 }, (_, i) => [i, Math.round(Math.sin(i / 10) * 40)]);
  const out = B.simplify(pts, 1);
  assert.ok(out.length < pts.length / 3, "about a quarter or fewer: " + out.length);
  for (const [x, y] of pts) {
    const near = out.some((p, i) => i && B.segDist(x, y, out[i - 1][0], out[i - 1][1], p[0], p[1]) <= 1.01);
    assert.ok(near, `point ${x},${y} drifted`);
  }
});
test("points round-trip through the delta encoding, as integers", () => {
  const pts = [[10.4, 20.6], [15, 18], [-3, 40.2]];
  const enc = B.encodePoints(pts);
  assert.deepStrictEqual(enc, [10, 21, 5, -3, -18, 22]);
  assert.deepStrictEqual(B.decodePoints(enc), [[10, 21], [15, 18], [-3, 40]]);
});
test("a stroke of 90 samples stores in well under a kilobyte once simplified", () => {
  const pts = Array.from({ length: 90 }, (_, i) => [200 + i * 4, 300 + Math.sin(i / 8) * 60]);
  const el = { id: "abc123", t: "pen", c: "ink", sw: 4, p: B.encodePoints(B.simplify(pts, 0.8)) };
  assert.ok(JSON.stringify(el).length < 400, JSON.stringify(el).length + " bytes");
});

// ---------- hit testing ----------
const pen = { id: "p", t: "pen", sw: 4, p: B.encodePoints([[0, 0], [100, 0]]) };
const rect = { id: "r", t: "rect", sw: 2, x: 0, y: 0, w: 100, h: 50 };
const ell = { id: "e", t: "ellipse", sw: 2, x: 0, y: 0, w: 100, h: 50 };
const arrow = { id: "a", t: "arrow", sw: 2, x: 0, y: 0, x2: 100, y2: 100 };
const text = { id: "t", t: "text", sw: 4, x: 10, y: 10, text: "hello\nworld" };
test("a stroke is hit near its line and missed away from it", () => {
  assert.ok(B.hitTest(pen, 50, 3, 2));
  assert.ok(!B.hitTest(pen, 50, 20, 2));
});
test("shapes are hit on their outline, not inside", () => {
  assert.ok(B.hitTest(rect, 50, 1, 3));
  assert.ok(!B.hitTest(rect, 50, 25, 3));
  assert.ok(B.hitTest(ell, 50, 1, 3), "top of the ellipse");
  assert.ok(!B.hitTest(ell, 50, 25, 3), "its middle");
  assert.ok(B.hitTest(arrow, 50, 51, 3) && !B.hitTest(arrow, 50, 80, 3));
});
test("text is hit anywhere in its box", () => {
  assert.ok(B.hitTest(text, 20, 40, 2));
  assert.ok(!B.hitTest(text, 20, 200, 2));
});
test("moving shifts every kind of element, and a stroke only by its first point", () => {
  assert.deepStrictEqual(B.moved(pen, 10, 5).p, [10, 5, 100, 0]);
  const a = B.moved(arrow, 10, 5);
  assert.deepStrictEqual([a.x, a.y, a.x2, a.y2], [10, 5, 110, 105]);
});
test("bounds cover every element", () => {
  const b = B.boundsOf([rect, arrow]);
  assert.deepStrictEqual([b.x, b.y, b.w, b.h], [0, 0, 100, 100]);
  assert.strictEqual(B.boundsOf([]), null);
});

// ---------- resize, rotate, fill (0.194.0) ----------
test("resizing from a corner scales every kind about the opposite corner", () => {
  const r = B.scaled(rect, 0, 0, 2, 3);
  assert.deepStrictEqual([r.x, r.y, r.w, r.h], [0, 0, 200, 150]);
  const a = B.scaled(arrow, 0, 0, 0.5, 0.5);
  assert.deepStrictEqual([a.x2, a.y2], [50, 50]);
  assert.deepStrictEqual(B.decodePoints(B.scaled(pen, 0, 0, 2, 1).p), [[0, 0], [200, 0]]);
});
test("resizing text changes its size and keeps its proportions", () => {
  const t = B.scaled({ id: "t", t: "text", sw: 4, x: 0, y: 0, text: "hi" }, 0, 0, 2, 2);
  assert.strictEqual(t.fs, 52);
});
test("a quarter turn turns a line's ends and a shape's angle", () => {
  const l = B.rotated({ id: "l", t: "line", sw: 2, x: 0, y: 0, x2: 100, y2: 0 }, 0, 0, Math.PI / 2);
  assert.deepStrictEqual([l.x2, l.y2], [0, 100]);
  const r = B.rotated(rect, 50, 25, Math.PI / 2);
  assert.ok(Math.abs(r.a - Math.PI / 2) < 1e-3);
  assert.deepStrictEqual([r.x, r.y, r.w, r.h], [0, 0, 100, 50], "turned about its own centre, it stays put");
});
test("a full turn leaves no angle behind", () => {
  const r = B.rotated(B.rotated(rect, 50, 25, Math.PI), 50, 25, Math.PI);
  assert.ok(!("a" in r));
});
test("a turned shape's bounds and hits follow the turn", () => {
  const turned = { ...rect, a: Math.PI / 2 }; // 100x50 stood on end: 50 wide, 100 tall, same centre
  const b = B.bbox(turned);
  assert.deepStrictEqual([Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)], [25, -25, 50, 100]);
  assert.ok(B.hitTest(turned, 25, 50, 3), "its left edge, where it now is");
  assert.ok(!B.hitTest(turned, 0, 25, 3), "not where its old edge was");
});
test("a filled shape is hit inside as well as on its edge", () => {
  assert.ok(B.hitTest({ ...rect, f: true }, 50, 25, 3));
  assert.ok(B.hitTest({ ...ell, f: true }, 50, 25, 3));
  assert.ok(!B.hitTest({ ...ell, f: true }, 2, 2, 1), "a filled ellipse's corner is still outside it");
});

// ---------- merging boards ----------
const board = (id, elements, extra) => ({ id, name: "B", updatedAt: "2026-01-01", elements, ...extra });
const s = (id) => ({ id, t: "pen", c: "ink", sw: 2, p: [0, 0, 1, 1] });
test("two devices drawing on the same board keep both sets of strokes", () => {
  const base = [board("b1", [s("a")])];
  const local = [board("b1", [s("a"), s("l")], { updatedAt: "2026-01-02" })];
  const remote = [board("b1", [s("a"), s("r")], { updatedAt: "2026-01-03" })];
  const out = M.mergeBoards(base, local, remote);
  assert.deepStrictEqual(out[0].elements.map((e) => e.id).sort(), ["a", "l", "r"]);
});
test("a stroke erased on one device stays erased when the other only added", () => {
  const base = [board("b1", [s("a"), s("b")])];
  const local = [board("b1", [s("b")])];
  const remote = [board("b1", [s("a"), s("b"), s("r")])];
  assert.deepStrictEqual(M.mergeBoards(base, local, remote)[0].elements.map((e) => e.id).sort(), ["b", "r"]);
});
test("a board deleted on one device but drawn on by the other comes back", () => {
  const base = [board("b1", [s("a")])];
  const remote = [board("b1", [s("a"), s("r")], { updatedAt: "2026-02-01" })];
  const out = M.mergeBoards(base, [], remote);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].elements.length, 2);
});
test("a board deleted on one device and untouched on the other stays deleted", () => {
  const base = [board("b1", [s("a")])];
  assert.deepStrictEqual(M.mergeBoards(base, [], base), []);
});
test("a rename on one side and drawing on the other both survive", () => {
  const base = [board("b1", [s("a")])];
  const local = [board("b1", [s("a")], { name: "Plans", updatedAt: "2026-01-02" })];
  const remote = [board("b1", [s("a"), s("r")], { updatedAt: "2026-01-03" })];
  const out = M.mergeBoards(base, local, remote)[0];
  assert.strictEqual(out.name, "Plans");
  assert.deepStrictEqual(out.elements.map((e) => e.id), ["a", "r"]);
});
test("with no base at all, boards and strokes from both sides are united", () => {
  const out = M.mergeBoards(null, [board("b1", [s("l")])], [board("b1", [s("r")]), board("b2", [])]);
  assert.deepStrictEqual(out.map((b) => b.id).sort(), ["b1", "b2"]);
  assert.deepStrictEqual(out.find((b) => b.id === "b1").elements.map((e) => e.id).sort(), ["l", "r"]);
});

// ---------- Nov 2026: smoothing, guides, sticky arrows, groups, crop ----------
test("smoothing keeps the ends and calms a zig-zag", () => {
  const pts = [[0, 0], [10, 10], [20, 0], [30, 10], [40, 0], [50, 10]];
  const out = B.smoothPoints(pts, 2);
  assert.deepStrictEqual(out[0], [0, 0]);
  assert.deepStrictEqual(out[out.length - 1], [50, 10]);
  const swing = (p) => Math.max(...p.slice(1, -1).map((q) => q[1])) - Math.min(...p.slice(1, -1).map((q) => q[1]));
  assert.ok(swing(out) < swing(pts));
});

test("guides nudge a box onto another's edge or middle within the tolerance, else not at all", () => {
  const g = B.guideSnap({ x: 103, y: 300, w: 50, h: 50 }, [{ x: 100, y: 0, w: 80, h: 40 }], 6);
  assert.strictEqual(g.dx, -3);
  assert.strictEqual(g.dy, null);
  assert.deepStrictEqual(g.lines[0].slice(0, 1), [100]);
  const mid = B.guideSnap({ x: 0, y: 18, w: 10, h: 4 }, [{ x: 200, y: 0, w: 40, h: 40 }], 3);
  assert.strictEqual(mid.dy, 0);
  assert.strictEqual(B.guideSnap({ x: 0, y: 0, w: 10, h: 10 }, [{ x: 100, y: 100, w: 10, h: 10 }], 5).lines.length, 0);
});

test("an arrow's ends stick to shapes and follow them when they move", () => {
  const box = { id: "r", t: "rect", x: 100, y: 100, w: 100, h: 50, sw: 2 };
  const b = B.bindAt([box], 200, 125, 5);
  assert.deepStrictEqual(b, { id: "r", fx: 1, fy: 0.5 });
  assert.strictEqual(B.bindAt([box], 400, 400, 5), null);
  const arrow = { id: "a", t: "arrow", x: 0, y: 0, x2: 200, y2: 125, sw: 2, b2: b };
  const els = [box, arrow];
  assert.strictEqual(B.followBindings(els), els, "nothing moved, nothing new");
  const after = B.followBindings([{ ...box, x: 300 }, arrow]);
  assert.deepStrictEqual([after[1].x2, after[1].y2], [400, 125]);
  assert.deepStrictEqual([after[1].x, after[1].y], [0, 0]);
  const gone = [arrow];
  assert.strictEqual(B.followBindings(gone), gone, "a missing shape leaves the end where it was");
});

test("picking one of a group picks the group; a paste gives groups and stuck ends new ids", () => {
  const els = [{ id: "a", gp: "g1" }, { id: "b", gp: "g1" }, { id: "c" }];
  assert.deepStrictEqual([...B.withGroups(els, new Set(["a"]))].sort(), ["a", "b"]);
  assert.deepStrictEqual([...B.withGroups(els, new Set(["c"]))], ["c"]);
  let n = 0;
  const out = B.reid([{ id: "a", gp: "g1" }, { id: "b", gp: "g1" }, { id: "l", t: "arrow", b1: { id: "a", fx: 0, fy: 0 }, b2: { id: "zz", fx: 1, fy: 1 } }], () => "n" + n++);
  assert.notStrictEqual(out[0].gp, "g1");
  assert.strictEqual(out[0].gp, out[1].gp);
  assert.strictEqual(out[2].b1.id, out[0].id);
  assert.strictEqual(out[2].b2, undefined);
});

test("a crop is the drawn box over the whole picture, and back", () => {
  const e = { x: 50, y: 20, w: 100, h: 40, cr: [0.25, 0.5, 0.5, 0.5] };
  const full = B.fullPictureBox(e);
  assert.deepStrictEqual(full, { x: 0, y: -20, w: 200, h: 80 });
  assert.deepStrictEqual(B.cropFrom(full, { x: 50, y: 20, w: 100, h: 40 }), [0.25, 0.5, 0.5, 0.5]);
  assert.strictEqual(B.cropFrom(full, full), null);
});

test("lock, group, link and stuck ends are kept only in their shape", () => {
  const els = B.sanitizeBoard({ id: "x", elements: [
    { id: "a", t: "rect", x: 0, y: 0, w: 1, h: 1, lk: true, gp: "g", ln: "note:abc" },
    { id: "b", t: "rect", x: 0, y: 0, w: 1, h: 1, lk: "yes", gp: 5, ln: "javascript:alert(1)", b1: { id: "a", fx: 0, fy: 0 } },
    { id: "c", t: "arrow", x: 0, y: 0, x2: 1, y2: 1, b1: { id: "a", fx: 2, fy: -1 }, b2: { id: 3 } },
  ] }).elements;
  assert.deepStrictEqual([els[0].lk, els[0].gp, els[0].ln], [true, "g", "note:abc"]);
  assert.deepStrictEqual([els[1].lk, els[1].gp, els[1].ln, els[1].b1], [undefined, undefined, undefined, undefined]);
  assert.deepStrictEqual(els[2].b1, { id: "a", fx: 1, fy: 0 });
  assert.strictEqual(els[2].b2, undefined);
  assert.strictEqual(B.boardText({ elements: [{ t: "text", text: "Day 1" }, { t: "rect" }, { t: "text", text: "Camp" }] }), "Day 1\nCamp");
});

test("players are made only from YouTube, Spotify and SoundCloud links, as their own embeds", () => {
  assert.strictEqual(B.playerOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42").src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42");
  assert.strictEqual(B.playerOf("https://youtu.be/dQw4w9WgXcQ").site, "YouTube");
  assert.strictEqual(B.playerOf("https://www.youtube.com/shorts/abcdefghijk").src, "https://www.youtube-nocookie.com/embed/abcdefghijk");
  assert.strictEqual(B.playerOf("https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=x").src, "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC");
  assert.strictEqual(B.playerOf("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").tall, true);
  assert.match(B.playerOf("https://soundcloud.com/artist/a-song").src, /^https:\/\/w\.soundcloud\.com\/player\/\?url=https%3A%2F%2Fsoundcloud\.com%2Fartist%2Fa-song/);
  for (const bad of ["http://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://evil.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=<script>", "javascript:alert(1)", "https://open.spotify.com/user/x", ""]) {
    assert.strictEqual(B.playerOf(bad), null, bad);
  }
});

test("cards, players and panels keep their far corner for older builds, and drop what they can't show", () => {
  const els = B.sanitizeBoard({ id: "x", elements: [
    { id: "c", t: "card", x: 10, y: 20, w: 200, h: 100, ref: "n1" },
    { id: "c2", t: "card", x: 0, y: 0, w: 10, h: 10 },
    { id: "e", t: "embed", x: 0, y: 0, w: 320, h: 200, url: "https://youtu.be/dQw4w9WgXcQ" },
    { id: "e2", t: "embed", x: 0, y: 0, w: 320, h: 200, url: "https://evil.com/x" },
    { id: "p", t: "panel", x: 0, y: 0, w: 300, h: 300, kind: "calendar" },
    { id: "p2", t: "panel", x: 0, y: 0, w: 300, h: 300, kind: "nope" },
  ] }).elements;
  assert.deepStrictEqual(els.map((e) => e.id), ["c", "e", "p"]);
  assert.deepStrictEqual([els[0].x2, els[0].y2], [210, 120]);
  const m = B.moved(els[0], 5, 5);
  assert.deepStrictEqual([m.x2, m.y2], [215, 125]);
  assert.strictEqual(B.rotated(els[0], 0, 0, 1), els[0]);
  assert.ok(B.hitTest(els[0], 100, 60, 1));
  assert.deepStrictEqual(B.bindAt([els[0]], 210, 70, 2), { id: "c", fx: 1, fy: 0.5 });
});

// ---------- the style bar ----------
test("the style bar offers only what the tool or selection can use", () => {
  const off = { color: false, width: false, fill: false, size: false };
  for (const t of ["hand", "eraser", "image", "card", "embed", "panel"]) assert.deepStrictEqual(B.styleFor(t), off, t);
  assert.deepStrictEqual(B.styleFor("pen"), { color: true, width: true, fill: false, size: false });
  assert.deepStrictEqual(B.styleFor("rect"), { color: true, width: true, fill: true, size: false });
  assert.deepStrictEqual(B.styleFor("arrow"), { color: true, width: true, fill: false, size: false });
  assert.deepStrictEqual(B.styleFor("text"), { color: true, width: true, fill: false, size: true });
  assert.deepStrictEqual(B.styleFor("select", []), off);
  assert.deepStrictEqual(B.styleFor("select", [{ t: "img" }, { t: "card" }]), off);
  assert.deepStrictEqual(B.styleFor("select", [{ t: "ellipse", lk: 1 }]), off, "a locked shape isn't restyled");
  assert.deepStrictEqual(B.styleFor("select", [{ t: "ellipse" }, { t: "pen" }]), { color: true, width: true, fill: true, size: false });
  assert.deepStrictEqual(B.styleFor("select", [{ t: "text" }, { t: "img" }]), { color: true, width: true, fill: false, size: true });
});

console.log(`\n${passed} test(s) passed.`);

// ---------- clipboard ----------
test("parseClip takes only LifeLog's own board JSON", () => {
  const text = JSON.stringify({ lifelog: "board-elements", v: 1, elements: [{ id: "a", t: "rect", x: 0, y: 0, w: 5, h: 5 }] });
  assert.strictEqual(B.parseClip(text).length, 1);
  assert.strictEqual(B.parseClip("hello"), null);
  assert.strictEqual(B.parseClip('{"lifelog":"other","elements":[]}'), null);
  assert.strictEqual(B.parseClip("null"), null);
});
