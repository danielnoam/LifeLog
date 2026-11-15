// Every theme's text and controls meet WCAG AA on their grounds (DESIGN.md
// §2): `node test/contrast.test.js`. The pairs are the lifelog-ui-audit
// skill's (its contrast.js prints every ratio); the measuring is keel's.
const fs = require("fs");
const path = require("path");
const { THEMES, PAIRS } = require("../.claude/skills/lifelog-ui-audit/scripts/contrast.js");
const { contrast } = require("../tools/keel-checks.js");

const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");
const fails = contrast.check(contrast.themes(css, THEMES), PAIRS);
if (fails.length) {
  console.log("not ok - every theme meets WCAG AA\n  " + fails.join("\n  "));
  process.exit(1);
}
console.log("ok - every theme meets WCAG AA (" + Object.keys(THEMES.themes).length + " themes, " + PAIRS.length + " pairs)");
