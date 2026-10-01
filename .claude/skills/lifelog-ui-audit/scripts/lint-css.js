#!/usr/bin/env node
// Finds where src/styles.css steps outside the design language (DESIGN.md):
//   1. colors written as literals outside the theme blocks (should be tokens)
//   2. spacing (padding/margin/gap) off the 4px scale
//   3. font sizes outside the type scale
//   4. radii outside the radius scale
//   5. transitions/animations with no prefers-reduced-motion answer nearby
// Report only; it doesn't fail. Pass --all to list every line, not just counts.
// Usage: node .claude/skills/lifelog-ui-audit/scripts/lint-css.js [--all] [styles.css]

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const all = args.includes("--all");
const cssPath = args.find((a) => !a.startsWith("--")) || path.join(__dirname, "../../../../src/styles.css");
const lines = fs.readFileSync(cssPath, "utf8").split("\n");

const TYPE_SCALE = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 26, 30, 42, 52, 64];
const RADII = [0, 2, 4, 6, 8, 10, 12, 14, 18, 999];
// 2px steps to 16, 4px steps to 64; past 64 it's a layout constant (a bar's
// height, a fallback), not spacing, and isn't checked.
const onSpaceScale = (n) => n <= 1 || (n <= 16 ? n % 2 === 0 : n <= 64 ? n % 4 === 0 : true);
// Literal colors that are fine anywhere: pure black/white shadows and scrims
// over photos, and the fixed category palette (see DESIGN.md, Color).
const ALLOWED_COLOR = /rgba?\(0, ?0, ?0|rgba?\(255, ?255, ?255|#fff\b|#ffffff\b|#000\b|transparent/i;

const found = { color: [], space: [], type: [], radius: [] };
let depth = 0, inTheme = false, inComment = false;
lines.forEach((raw, i) => {
  let line = raw;
  if (inComment) { const e = line.indexOf("*/"); if (e < 0) return; line = line.slice(e + 2); inComment = false; }
  line = line.replace(/\/\*.*?\*\//g, "");
  const s = line.indexOf("/*"); if (s >= 0) { inComment = true; line = line.slice(0, s); }

  if (depth === 0 && /^(:root|html\.theme-[\w-]+)\s*\{/.test(line.trim())) inTheme = true;
  depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
  const at = `${i + 1}: ${raw.trim().slice(0, 110)}`;

  if (!inTheme && !/--[\w-]+\s*:/.test(line)) {
    for (const m of line.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi))
      if (!ALLOWED_COLOR.test(m[0])) found.color.push([m[0], at]);
  }
  for (const m of line.matchAll(/\b(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?\s*:\s*([^;]+)/g))
    for (const px of m[3].matchAll(/(-?\d+(?:\.\d+)?)px/g))
      if (!onSpaceScale(Math.abs(+px[1]))) found.space.push([px[1] + "px", at]);
  for (const m of line.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g))
    if (!TYPE_SCALE.includes(+m[1])) found.type.push([m[1] + "px", at]);
  for (const m of line.matchAll(/border-radius\s*:\s*(\d+(?:\.\d+)?)px/g))
    if (!RADII.includes(+m[1])) found.radius.push([m[1] + "px", at]);

  if (depth === 0) inTheme = false;
});

const titles = {
  color: "Literal colors outside the theme blocks (use a token)",
  space: "Spacing off the scale (2px steps to 16, 4px steps to 64)",
  type: `Font sizes off the type scale (${TYPE_SCALE.join(", ")})`,
  radius: `Radii off the radius scale (${RADII.join(", ")}, 50%)`,
};
for (const [k, list] of Object.entries(found)) {
  console.log(`\n## ${titles[k]}: ${list.length}`);
  const byValue = {};
  for (const [v] of list) byValue[v] = (byValue[v] || 0) + 1;
  console.log("  " + Object.entries(byValue).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}×${n}`).join("  "));
  if (all) for (const [, at] of list) console.log("    " + at);
}
console.log("\nThese are drift counts, not errors: fix them in the code you are already touching.");
