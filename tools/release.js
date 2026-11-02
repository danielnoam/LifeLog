// Makes a release commit's edits: `node tools/release.js 0.299.0`
// (2026-11-02, from Waypage's).
//
// A version lives in three places (CONTRIBUTING.md, "Versions and
// releases"): APP_VERSION in src/app.js, the ?v= on index.html's tags and
// CACHE in sw.js. This bumps all three and writes CHANGELOG.md's
// "## [x.y.z] - <today>" entry from the notes in changes/ (one file per
// pull request, so branches never clash over CHANGELOG.md), plus any
// older "## Unreleased" section, then deletes those files. Nothing is
// committed: look at the diff, then commit and open the release PR. A
// merge with the new version publishes the APK and IPA (android.yml).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function bump(version, { root = ROOT, date = new Date().toISOString().slice(0, 10) } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("version must be x.y.z, got " + version);
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const write = (f, s) => fs.writeFileSync(path.join(root, f), s);

  const app = read("src/app.js");
  const was = (app.match(/const APP_VERSION = "([^"]+)"/) || [])[1];
  if (!was) throw new Error("src/app.js has no APP_VERSION");
  if (!newer(version, was)) throw new Error(version + " isn't above " + was + " (the updater ignores lower numbers)");
  write("src/app.js", app.replace(/const APP_VERSION = "[^"]+"/, 'const APP_VERSION = "' + version + '"'));

  const index = read("index.html");
  const tags = (index.match(/\?v=[^"]+"/g) || []).length;
  if (!tags) throw new Error("index.html has no ?v= tags");
  write("index.html", index.replace(/\?v=[^"]+"/g, "?v=" + version + '"'));

  const sw = read("sw.js");
  const cache = sw.match(/const CACHE = "lifelog-v(\d+)"/);
  if (!cache) throw new Error("sw.js has no CACHE");
  write("sw.js", sw.replace(cache[0], 'const CACHE = "lifelog-v' + (Number(cache[1]) + 1) + '"'));

  let log = read("CHANGELOG.md");
  const heading = /^## Unreleased[^\n]*\n/m;
  const texts = [];
  if (heading.test(log)) {
    texts.push(log.split(heading)[1].split(/^## /m)[0]);
    log = log.replace(/^## Unreleased[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m, "");
  }
  const dir = path.join(root, "changes");
  const notes = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort() : [];
  for (const f of notes) texts.push(fs.readFileSync(path.join(dir, f), "utf8"));
  const entry = mergeNotes(texts);
  if (!entry) throw new Error("nothing to release: no notes in changes/ and no '## Unreleased' in CHANGELOG.md");
  const first = log.search(/^## /m);
  const at = first < 0 ? log.length : first;
  write("CHANGELOG.md", log.slice(0, at).replace(/\n*$/, "\n\n") + "## [" + version + "] - " + date + "\n\n" + entry + "\n" + log.slice(at));
  for (const f of notes) fs.unlinkSync(path.join(dir, f));

  return { was, version, cache: "lifelog-v" + (Number(cache[1]) + 1), tags, notes: notes.length };
}

// Notes ("### Added" and its "- " lines, and so on) merged under one
// heading each, in the CHANGELOG's order; a line that runs on to the next
// is kept with its item.
const SECTIONS = ["Added", "Changed", "Fixed", "Removed"];
function mergeNotes(texts) {
  const got = new Map(SECTIONS.map((s) => [s, []]));
  for (const t of texts) {
    let cur = null;
    for (const line of t.split("\n")) {
      const h = line.match(/^###\s+(.+?)\s*$/);
      if (h) {
        if (!got.has(h[1])) throw new Error("unknown heading '### " + h[1] + "' (use " + SECTIONS.join(", ") + ")");
        cur = got.get(h[1]);
        continue;
      }
      if (/^- /.test(line)) { if (!cur) throw new Error("a note line comes before any ### heading: " + line); cur.push(line); }
      else if (/^\s+\S/.test(line) && cur && cur.length) cur[cur.length - 1] += "\n" + line;
    }
  }
  return SECTIONS.filter((s) => got.get(s).length).map((s) => "### " + s + "\n" + got.get(s).join("\n") + "\n").join("\n");
}

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

if (require.main === module) {
  const r = bump(process.argv[2] || "");
  console.log(r.was + " -> " + r.version + ": src/app.js, " + r.tags + " tags in index.html, sw.js " + r.cache + ", CHANGELOG.md written from " + r.notes + " notes in changes/. Now commit and open the release PR.");
}

module.exports = { bump, newer, mergeNotes };
