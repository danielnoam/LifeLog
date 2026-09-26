// How much a board weighs: a handwritten page and a diagram through the same
// simplify + encodePoints pipeline boards.js stores with (0.194.0). Synthetic,
// seeded strokes, so the numbers repeat. Run: node tools/measure-boards.js
global.window = {};
require(require('path').join(__dirname, '..', 'src', 'boards.js'));
const B = window.LifeLogBoards;
let n = 0; B.init({ uid: () => "e" + (n++).toString(36).padStart(8, "0") });
// Seeded random so the numbers are repeatable.
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const id = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
// A handwritten stroke: 0.3–1s at 60Hz, a letter-sized wander (~25px) with curvature.
function handStroke(ox, oy) {
  const samples = Math.round(18 + rnd() * 42), pts = [];
  let x = ox, y = oy, a = rnd() * Math.PI * 2, turn = (rnd() - 0.5) * 0.5;
  for (let i = 0; i < samples; i++) { a += turn + (rnd() - 0.5) * 0.25; x += Math.cos(a) * 1.4; y += Math.sin(a) * 1.4; pts.push([x + rnd() * 0.3, y + rnd() * 0.3]); }
  return pts;
}
const el = (pts, simplify) => ({ id: id(), t: "pen", c: "ink", sw: 2, p: B.encodePoints(simplify ? B.simplify(pts, 0.8) : pts) });
const rawEl = (pts) => ({ id: id(), t: "pen", c: "ink", sw: 2, p: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) });
const page = []; for (let i = 0; i < 1000; i++) page.push(handStroke(40 + (i % 40) * 18, 40 + Math.floor(i / 40) * 34));
const size = (els) => JSON.stringify({ id: "b", name: "Board", createdAt: "", updatedAt: "", elements: els }).length;
const samples = page.reduce((s, p) => s + p.length, 0);
const kept = page.map((p) => B.simplify(p, 0.8)).reduce((s, p) => s + p.length, 0);
const shapes = []; for (let i = 0; i < 50; i++) { const t = ["rect", "ellipse", "arrow", "line", "text"][i % 5];
  shapes.push(t === "text" ? { id: id(), t, c: "ink", sw: 4, x: i * 30, y: i * 12, text: "Label " + i } : t === "rect" || t === "ellipse" ? { id: id(), t, c: "ink", sw: 4, seed: 123456789, x: i * 30, y: i * 12, w: 120, h: 80 } : { id: id(), t, c: "ink", sw: 4, seed: 123456789, x: i * 30, y: i * 12, x2: i * 30 + 90, y2: i * 12 + 40 }); }
const kb = (b) => (b / 1024).toFixed(1) + " KB";
console.log("handwritten page, 1000 strokes, " + samples + " samples → " + kept + " kept (" + (100 * kept / samples).toFixed(0) + "%)");
console.log("  raw, as [x,y] pairs at 0.1px:", kb(size(page.map(rawEl))));
console.log("  stored (simplified, integer deltas):", kb(size(page.map((p) => el(p, true)))));
console.log("  per stroke:", Math.round(size(page.map((p) => el(p, true))) / 1000), "bytes");
console.log("50-element diagram:", kb(size(shapes)), "(" + Math.round(size(shapes) / 50) + " bytes each)");
const zlib = require("zlib");
console.log("  page gzipped (roughly what a git commit stores):", kb(zlib.gzipSync(JSON.stringify(page.map((p) => el(p, true)))).length));
