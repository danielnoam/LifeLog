// RULES.md (keel): tests wait for the condition, never a fixed sleep for a
// side effect: `node test/waits.test.js`. native.js 5b waited a fixed 1.8s
// for a write to GitHub and flaked on main (2026-11-17). Fixed waits of a
// second or more may only go down: lower MAX when you remove one, never
// raise it; wait for the element, request or write instead.
const fs = require("fs");
const path = require("path");
const { waits } = require("../tools/keel-checks.js");

const MAX = 67;
const dir = path.join(__dirname, "browser");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));
const found = waits.find(files, 1000);
if (found.length > MAX) {
  console.log("  FAIL - " + found.length + " fixed waits of 1s or more in test/browser (at most " + MAX + "): wait for the element, request or write instead\n    "
    + found.map((w) => path.basename(w.file) + ":" + w.line + " (" + w.ms + "ms)").join("\n    "));
  process.exitCode = 1;
} else console.log("  ok - " + found.length + " long fixed waits in test/browser (at most " + MAX + ")\n\n1 test(s) passed.");
