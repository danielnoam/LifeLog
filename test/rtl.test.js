// Right-to-left groundwork: `node test/rtl.test.js`.
// styles.css lays out with logical sides (inset-inline-start, margin-inline-end,
// text-align: start) so a Hebrew or Arabic page mirrors with dir="rtl" alone.
// The exceptions are elements JS places with style.left / clientX (a physical
// left with right and width set is ignored in RTL), charts that read left to
// right in every language, centering with left: 50%, and symmetric borders.
// A new physical side anywhere else fails here: use the logical one, or add the
// selector below with the reason.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const ALLOWED = [
  /\.tab-menu(?![-\w])/, // dropped under its tab by JS from the tab's rect
  /\.mode-layer\b/,      // the mode strip is moved in physical px by app.js
  /\.mode-peek-label\b/, // the peek label sits on the physical side it's dragged from
  /\.nv-measure\b/,      // off-screen text measurer
  /\.home-ghost\b/,      // follows the pointer by clientX
  /\.invest-/,           // charts read left to right in every language
  /\.wheel-pointer\b/,   // symmetric triangle, centred
  /:root\[dir="rtl"\]/,  // the RTL block itself
];
const PHYSICAL = /(?:^|;)\s*((?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?|left|right|text-align)\s*:\s*([^;}]*)/g;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name + "\n    " + e.message); process.exitCode = 1; }
}

test("styles.css uses logical sides outside the listed exceptions", () => {
  const bad = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim(), body = m[2];
    if (ALLOWED.some((re) => re.test(sel))) continue;
    for (const p of body.matchAll(PHYSICAL)) {
      const prop = p[1], val = p[2].trim();
      if (prop === "text-align" && !/^(left|right)\b/.test(val)) continue;
      if (prop === "left" && /^50%/.test(val)) continue;
      if ((prop === "left" || prop === "right") && val === "auto") continue;
      bad.push(sel.split("\n").pop() + " { " + prop + ": " + val + " }");
    }
  }
  assert.deepStrictEqual(bad, [], "physical sides in styles.css:\n    " + bad.join("\n    "));
});

test("the language is set before first paint", () => {
  const head = html.slice(0, html.indexOf("</head>"));
  for (const src of ["src/keel/i18n.js", "src/language.js"]) {
    const tag = head.match(new RegExp('<script[^>]*src="' + src.replace(/[./]/g, "\\$&") + '[^"]*"[^>]*>'));
    assert.ok(tag, src + " is not loaded in <head>");
    assert.ok(!/\b(defer|async|type="module")/.test(tag[0]), src + " must run before the body renders");
  }
  assert.ok(head.indexOf("src/keel/i18n.js") < head.indexOf("src/language.js"), "i18n.js loads before language.js");
});

test("language.js offers English and Hebrew", () => {
  const src = fs.readFileSync(path.join(root, "src", "language.js"), "utf8");
  assert.match(src, /langs:\s*\[\s*"en",\s*"he"\s*\]/);
});

console.log("\n" + passed + " test(s) passed.");
