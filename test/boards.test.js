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

// ---------- strokes ----------
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

console.log(`\n${passed} test(s) passed.`);
