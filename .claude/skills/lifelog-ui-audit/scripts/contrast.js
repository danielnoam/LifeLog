#!/usr/bin/env node
// WCAG contrast for every LifeLog theme, read straight from src/styles.css.
// Usage: node .claude/skills/lifelog-ui-audit/scripts/contrast.js [path/to/styles.css]
// Exit code 1 if any pair marked "text" falls under 4.5:1 or any "ui" pair under 3:1.
// test/contrast.test.js runs the same pairs; the measuring is keel's
// (tools/keel-checks.js).

const fs = require("fs");
const path = require("path");
const { contrast } = require("../../../../tools/keel-checks.js");

// The :root palette is "default"; each html.theme-x block overrides part of it.
const THEMES = {
  base: ":root",
  themes: { default: ":root", light: "html.theme-light", nord: "html.theme-nord", dracula: "html.theme-dracula" },
};

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

if (require.main === module) {
  const cssPath = process.argv[2] || path.join(__dirname, "../../../../src/styles.css");
  const themes = contrast.themes(fs.readFileSync(cssPath, "utf8"), THEMES);
  let failures = 0;
  for (const [name, vars] of Object.entries(themes)) {
    console.log(`\n${name}`);
    for (const [fg, bg, kind] of PAIRS) {
      const r = contrast.ratio(contrast.resolve(vars, fg), contrast.resolve(vars, bg));
      if (r == null) { console.log(`  ?    ${fg} on ${bg} (unresolved)`); continue; }
      const need = kind === "text" ? 4.5 : 3;
      const ok = r >= need;
      if (!ok) failures++;
      console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}:1  ${fg} on ${bg}  (${kind}, needs ${need})`);
    }
  }
  console.log(failures ? `\n${failures} pair(s) below WCAG AA` : "\nAll pairs pass WCAG AA");
  process.exit(failures ? 1 : 0);
}

module.exports = { THEMES, PAIRS };
