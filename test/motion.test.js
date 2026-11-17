// RULES.md's motion rules (keel) in src/styles.css: `node test/motion.test.js`.
// Curves are the tokens (DESIGN.md §5), and nothing animates font-size,
// padding or margin, which re-lay out the page every frame (the phone's
// jump bar did, until 2026-11-17).
const fs = require("fs");
const path = require("path");
const { motion } = require("../tools/keel-checks.js");

const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");
const bad = motion.check(css);
if (bad.length) {
  console.log("  FAIL - src/styles.css breaks RULES.md's motion rules\n    " + bad.join("\n    "));
  process.exitCode = 1;
} else console.log("  ok - curves are tokens and nothing animates layout\n\n1 test(s) passed.");
