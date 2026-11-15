// The page's Content-Security-Policy (0.263.0): scripts and styles come
// from the app's own files only, so a script that gets into the page some
// other way (a crafted note, an import, a link) doesn't run. These checks
// keep index.html in the shape the policy needs.
const fs = require("fs");
const path = require("path");

const { csp } = require("../tools/keel-checks.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const dir = path.join(__dirname, "..", "src");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f))
  .concat(fs.readdirSync(path.join(dir, "vendor")).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, "vendor", f)))
  .concat(fs.readdirSync(path.join(dir, "keel")).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, "keel", f)));

// keel's check (tools/keel-checks.js): the policy, where it sits, nothing
// inline in index.html, and no code that sets style or on* attributes or
// uses eval (el.style.x = … is fine under style-src 'self').
const problems = csp.check(html, files);
if (problems.length) {
  console.log("not ok - the policy and the code under it\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("ok - the policy and the code under it");
