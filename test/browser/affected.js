// Which browser suites a pull request needs, from the files it changes
// (test/browser/areas.json). Prints "all", "none", or the suites joined by
// commas. Anything the map doesn't know runs everything, so a new file is
// never silently left untested; main, releases and hand-run workflows don't
// ask this at all and run every suite.
//
//   git diff --name-only origin/main HEAD | node test/browser/affected.js
const fs = require("fs");
const path = require("path");

const AREAS = require("./areas.json");

function suiteNames() {
  return fs.readdirSync(__dirname)
    .filter((f) => f.endsWith(".js") && !["run-all.js", "harness.js", "affected.js"].includes(f))
    .map((f) => f.replace(/\.js$/, ""));
}

const matches = (file, list) => list.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p));

function pick(files, suites = suiteNames(), areas = AREAS) {
  const chosen = new Set();
  for (const file of files.map((f) => f.trim()).filter(Boolean)) {
    if (file.endsWith(".md")) continue;
    if (matches(file, areas.everything)) return "all";
    const own = /^test\/browser\/([^/]+)\.js$/.exec(file);
    if (own && suites.includes(own[1])) { chosen.add(own[1]); continue; }
    if (matches(file, areas.nothing)) continue;
    if (/^test\/[^/]+\.test\.js$/.test(file)) continue;
    const hit = Object.values(areas.areas).filter((a) => a.files.includes(file));
    if (!hit.length) return "all";
    for (const a of hit) a.suites.forEach((s) => chosen.add(s));
  }
  if (!chosen.size) return "none";
  areas.always.forEach((s) => chosen.add(s));
  return [...chosen].filter((s) => suites.includes(s)).sort();
}

module.exports = { pick, suiteNames, AREAS };

if (require.main === module) {
  const input = process.argv.length > 2 ? process.argv.slice(2) : fs.readFileSync(0, "utf8").split("\n");
  const r = pick(input);
  console.log(Array.isArray(r) ? r.join(",") : r);
}
