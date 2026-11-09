// Zero-dependency tests for the Excalidraw reader in src/docimport.js —
// `node test/excalidraw.test.js`. The compressed drawing below was made by
// LZ-string 1.5.0's compressToBase64 (what Obsidian's Excalidraw plugin
// uses), broken into lines the way the plugin writes it.
const assert = require("assert");
global.window = {};
require("../src/docimport.js");
const D = global.window.LifeLogDocImport;

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const COMPRESSED = `N4IgLgngDgpiBcIYA8DGBDANgSwCYCd0B3EAGhADcZ8BnbAewDsEAmcm+gV3
1TkQAswYKDXgB6MQHNsYfpwBGAOlT0AtmIBeNCtlQbs6RmPry6uA4wC0KDDg
LFLUTJ2nNyMTDFUxGYGggBtUDwEEHwARjJwaD4wmFQwQ0lPKOQEcIAGcghWL
JAiPFlcvP4YbElBdIy8pJT4PJowfHoAaxgAYXpMenxQgGJwmEHBqPl0VBbJZ
s5GXE7u3sQ+gDNl1ABODajl7ExMAGVIOpAOOyjG5raAdUL+VnYYGFwEABY2E
GwaABEPGDAnhDLLA0GAAX1IwWeiDAkXIkFgoX+yDAqQQADY8jl4ABWbHkAq4
IrwTIlMoVFHwFh4kC1PgNJqtDpdHr9YZDODkMYTKZcWbzFnQwiMGhQdD4Hwo
8jLJhgfbYDR8Fh5JEUkAAaRkqFKbnAKDAAEEcJJmIheL5qFEVL50NhGNQAJJ
QsKRcGQ0LYWHRBGIbCqdCSDkgNL1bIIPIEomZcilcqVYl5HaeR2hdDyVAgV0
fJ2SKLw2LihK01EhkBY8O3BDUmPkyvkT4/Tz/KFNThggC6oKAA==`;

const obsidianFile = (block) => `---

excalidraw-plugin: parsed
tags: [excalidraw]

---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==

# Excalidraw Data

## Text Elements
Kitchen ^t1

%%
## Drawing
${block}
%%`;

let n = 0;
const ids = () => "id" + n++;

test("a drawing's pictures: vault files, web pictures, data URLs and crops; SVGs and formulas left out", () => {
  const scene = { type: "excalidraw", elements: [
    { type: "image", fileId: "f1", x: 10, y: 20, width: 200, height: 100, angle: 0 },
    { type: "image", fileId: "f2", x: 0, y: 0, width: 50, height: 50, angle: 0 },
    { type: "image", fileId: "f3", x: 0, y: 0, width: 80, height: 40, angle: 0,
      crop: { x: 100, y: 0, width: 200, height: 100, naturalWidth: 400, naturalHeight: 200 } },
    { type: "image", fileId: "f4", x: 0, y: 0, width: 10, height: 10 },
    { type: "image", fileId: "f5", x: 0, y: 0, width: 10, height: 10 },
    { type: "image", fileId: "nope", x: 0, y: 0, width: 10, height: 10 },
  ], files: { f3: { mimeType: "image/png", dataURL: "data:image/png;base64,iVBORw0KGgo=" } } };
  const file = `---
excalidraw-plugin: parsed
---
# Excalidraw Data

## Embedded Files
f1: [[Attachments/Pasted Image 2024.png]]

f2: https://example.com/cat.jpg

f4: $$E=mc^2$$

f5: [[diagram.svg]]

%%
## Drawing
\`\`\`json
${JSON.stringify(scene)}
\`\`\`
%%`;
  const { board, skipped, pictures } = D.excalidrawToBoard(file, "Pics.excalidraw.md", 0, ids);
  const [a, b, c] = board.elements;
  assert.strictEqual(board.elements.length, 3);
  assert.deepStrictEqual({ ...a, id: 0 }, { id: 0, t: "img", x: 10, y: 20, w: 200, h: 100, miss: "Attachments/Pasted Image 2024.png" });
  assert.deepStrictEqual({ ...b, id: 0 }, { id: 0, t: "img", x: 0, y: 0, w: 50, h: 50, url: "https://example.com/cat.jpg" });
  assert.deepStrictEqual(c.cr, [0.25, 0, 0.5, 0.5]);
  assert.deepStrictEqual(pictures[a.id], { link: "Attachments/Pasted Image 2024.png" });
  assert.deepStrictEqual(pictures[c.id], { data: "data:image/png;base64,iVBORw0KGgo=" });
  assert.deepStrictEqual(skipped, { formula: 1, svg: 1, image: 1 });
  assert.strictEqual(D.skippedText(skipped), "1 formula, 1 SVG picture, 1 image");
});

test("a compressed Obsidian drawing becomes a board: shapes kept, images counted, deleted ones gone", () => {
  const file = obsidianFile("```compressed-json\n" + COMPRESSED + "\n```");
  assert.ok(D.isExcalidraw("Plans/Kitchen.excalidraw.md", ""));
  assert.ok(D.isExcalidraw("Kitchen.md", file), "the front matter says so even when the name doesn't");
  assert.ok(!D.isExcalidraw("Kitchen.md", "---\ntitle: x\n---\nhi"));
  const { board, skipped } = D.excalidrawToBoard(file, "Plans/Kitchen.excalidraw.md", Date.UTC(2026, 10, 1), ids);
  assert.strictEqual(board.name, "Kitchen");
  assert.strictEqual(board.createdAt, "2026-11-01T00:00:00.000Z");
  assert.deepStrictEqual(skipped, { image: 1 });
  assert.strictEqual(D.skippedText(skipped), "1 image");
  const [rect, text] = board.elements;
  assert.strictEqual(board.elements.length, 2);
  assert.deepStrictEqual({ ...rect, id: 0 }, { id: 0, t: "rect", c: "ink", sw: 2, seed: 42, x: 10, y: 20, w: 200, h: 100, f: true, fc: "#ffc9c9" });
  assert.deepStrictEqual({ ...text, id: 0 }, { id: 0, t: "text", c: "ink", sw: 4, fs: 20, x: 60, y: 55, text: "Kitchen" });
});

test("an uncompressed ```json drawing and a plain .excalidraw file read the same", () => {
  const scene = JSON.parse(D.lzBase64(COMPRESSED));
  const a = D.excalidrawToBoard(obsidianFile("```json\n" + JSON.stringify(scene, null, 2) + "\n```"), "K.excalidraw.md", 0, ids);
  const b = D.excalidrawToBoard(JSON.stringify(scene), "K.excalidraw", 0, ids);
  const strip = (r) => r.board.elements.map((e) => ({ ...e, id: 0 }));
  assert.deepStrictEqual(strip(a), strip(b));
  assert.strictEqual(b.board.name, "K");
});

test("a diamond is four sides, an arrow of three points two segments with the head on the last", () => {
  const { elements } = D.excalidrawToElements({ elements: [
    { type: "diamond", x: 0, y: 0, width: 100, height: 60, strokeColor: "#e03131", backgroundColor: "transparent", strokeWidth: 1, seed: 7 },
    { type: "arrow", x: 200, y: 0, width: 100, height: 50, points: [[0, 0], [100, 0], [100, 50]], strokeColor: "#1971c2", strokeWidth: 2, endArrowhead: "arrow", startArrowhead: null },
  ] }, ids);
  const sides = elements.slice(0, 4);
  assert.ok(sides.every((e) => e.t === "line" && e.c === "#e03131" && e.sw === 1));
  assert.deepStrictEqual(sides.map((e) => [e.x, e.y, e.x2, e.y2]), [[50, 0, 100, 30], [100, 30, 50, 60], [50, 60, 0, 30], [0, 30, 50, 0]]);
  assert.deepStrictEqual(elements.slice(4).map((e) => [e.t, e.x, e.y, e.x2, e.y2]), [["line", 200, 0, 300, 0], ["arrow", 300, 0, 300, 50]]);
});

test("an arrow with a head at each end of one segment is drawn from its middle out", () => {
  const { elements } = D.excalidrawToElements({ elements: [
    { type: "arrow", x: 0, y: 0, width: 100, height: 0, points: [[0, 0], [100, 0]], startArrowhead: "arrow", endArrowhead: "arrow" },
  ] }, ids);
  assert.deepStrictEqual(elements.map((e) => [e.t, e.x, e.y, e.x2, e.y2]), [["arrow", 50, 0, 0, 0], ["arrow", 50, 0, 100, 0]]);
});

test("a turned rectangle keeps its angle; a turned line turns its points about its centre", () => {
  const { elements } = D.excalidrawToElements({ elements: [
    { type: "rectangle", x: 0, y: 0, width: 10, height: 10, angle: Math.PI / 4 },
    { type: "line", x: 0, y: 0, width: 100, height: 0, angle: Math.PI / 2, points: [[0, 0], [100, 0]] },
  ] }, ids);
  assert.strictEqual(elements[0].a, 0.7854);
  assert.deepStrictEqual([elements[1].x, elements[1].y, elements[1].x2, elements[1].y2], [50, -50, 50, 50]);
});

test("a freehand stroke is a pen stroke of integer deltas, a little wider", () => {
  const { elements } = D.excalidrawToElements({ elements: [
    { type: "freedraw", x: 10, y: 10, width: 5, height: 5, strokeWidth: 2, strokeColor: "#2f9e44", points: [[0, 0], [0, 0], [2.4, 1], [5, 5]] },
  ] }, ids);
  assert.deepStrictEqual({ ...elements[0], id: 0 }, { id: 0, t: "pen", c: "#2f9e44", sw: 5, p: [10, 10, 2, 1, 3, 4] });
});

test("a centred label of two lines is a text per line, each centred by its length", () => {
  const { elements } = D.excalidrawToElements({ elements: [
    { type: "text", x: 0, y: 0, width: 100, height: 50, fontSize: 20, textAlign: "center", text: "abcd\nab" },
  ] }, ids);
  assert.deepStrictEqual(elements.map((e) => [e.x, e.y, e.text]), [[0, 0, "abcd"], [25, 25, "ab"]]);
});

test("a shape with no outline takes its fill's colour; odd colours fall back to ink", () => {
  const { elements } = D.excalidrawToElements({ elements: [
    { type: "ellipse", x: 0, y: 0, width: 10, height: 10, strokeColor: "transparent", backgroundColor: "#a5d8ff", fillStyle: "hachure" },
    { type: "rectangle", x: 0, y: 0, width: 10, height: 10, strokeColor: "url(javascript:x)", backgroundColor: "transparent" },
  ] }, ids);
  assert.strictEqual(elements[0].c, "#a5d8ff");
  assert.strictEqual(elements[0].fc, "#a5d8ff");
  assert.strictEqual(elements[1].c, "ink");
  assert.ok(!elements[1].f);
});

test("a drawing with nothing a board can show says why; damaged data says so", () => {
  assert.throws(() => D.excalidrawToBoard(JSON.stringify({ elements: [{ type: "image" }, { type: "frame" }] }), "a.excalidraw"), /Nothing on this drawing a board can show \(1 image, 1 frame\)/);
  assert.throws(() => D.excalidrawToBoard(JSON.stringify({ elements: [] }), "a.excalidraw"), /empty/);
  assert.throws(() => D.excalidrawToBoard(obsidianFile("```compressed-json\nAAAA\n```"), "a.excalidraw.md"), /can't be read|damaged/);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log("  ok - " + name); }
    catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
  }
  console.log(`\n${passed} test(s) passed.`);
})();
