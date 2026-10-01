#!/usr/bin/env node
// WCAG contrast for every LifeLog theme, read straight from src/styles.css.
// Usage: node .claude/skills/lifelog-ui-audit/scripts/contrast.js [path/to/styles.css]
// Exit code 1 if any pair marked "text" falls under 4.5:1 or any "ui" pair under 3:1.

const fs = require("fs");
const path = require("path");

const cssPath = process.argv[2] || path.join(__dirname, "../../../../src/styles.css");
const css = fs.readFileSync(cssPath, "utf8");

// The :root palette is "default"; each html.theme-x block overrides part of it.
function block(selector) {
  const i = css.indexOf(selector + " {");
  if (i < 0) return {};
  const body = css.slice(i, css.indexOf("\n}", i));
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}
const root = block(":root");
const themes = {
  default: root,
  light: { ...root, ...block("html.theme-light") },
  nord: { ...root, ...block("html.theme-nord") },
  dracula: { ...root, ...block("html.theme-dracula") },
};

function resolve(vars, name, depth = 0) {
  let v = vars[name];
  if (!v || depth > 8) return null;
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(vars, ref[1], depth + 1) : v;
}
function parse(c) {
  if (!c) return null;
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.replace(/./g, (x) => x + x);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(",").map((s) => parseFloat(s));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  return null;
}
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1);
function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground, background, kind]. "text" needs 4.5:1, "ui" (borders of
// controls, focus rings, large/bold text, icons) needs 3:1. --text-faint is
// "ui": since 0.219.0 it only draws glyphs, placeholders and done/disabled
// items; anything to be read is --text-dim (DESIGN.md §2).
const PAIRS = [
  ["text", "bg", "text"], ["text-dim", "bg", "text"], ["text-faint", "bg", "ui"],
  ["text", "bg-elev", "text"], ["text-dim", "bg-elev", "text"], ["text-faint", "bg-elev", "ui"],
  ["text-dim", "bg-elev-2", "text"], ["text-faint", "bg-elev-2", "ui"],
  ["text-on-accent", "accent-fill", "text"], ["text-on-accent", "accent-fill-hover", "text"],
  ["accent", "bg", "text"], ["accent", "bg-elev", "text"],
  ["danger", "bg-elev", "text"], ["success", "bg-elev", "ui"], ["warning", "bg-elev", "ui"],
  ["priority", "bg-elev", "ui"],
];

let failures = 0;
for (const [name, vars] of Object.entries(themes)) {
  console.log(`\n${name}`);
  for (const [fg, bg, kind] of PAIRS) {
    const b = parse(resolve(vars, bg));
    let f = parse(resolve(vars, fg));
    if (!f || !b) { console.log(`  ?    ${fg} on ${bg} (unresolved)`); continue; }
    if (f[3] < 1) f = over(f, b);
    const r = ratio(f, b);
    const need = kind === "text" ? 4.5 : 3;
    const ok = r >= need;
    if (!ok) failures++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}:1  ${fg} on ${bg}  (${kind}, needs ${need})`);
  }
}
console.log(failures ? `\n${failures} pair(s) below WCAG AA` : "\nAll pairs pass WCAG AA");
process.exit(failures ? 1 : 0);
