// Copies the app into www/, which is what Capacitor bundles into the APK.
//
//   node tools/build-www.js [outDir]
//
// The list of files is sw.js's ASSETS — the same list the browser's offline
// cache is built from — so there is one statement of what the app is made
// of, and a file missing from it is missing from both. Before copying, every
// local file index.html loads is checked against that list, and a miss fails
// the build rather than shipping an app that 404s on its own script.
//
// Also writes www/app-build.json: the version, the repo the build came from
// (so the app knows whose Releases to check for a newer APK) and the web
// copy's address (so a setup link made inside the app opens somewhere
// another device can reach). See src/platform.js for what reads it.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(ROOT, process.argv[2] || "www");

function assetList(root = ROOT) {
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const m = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!m) throw new Error("sw.js has no ASSETS list");
  return [...m[1].matchAll(/"\.\/([^"]*)"/g)].map((x) => x[1]).filter(Boolean);
}

// Every same-origin file index.html pulls in by src= or href=.
function referencedByIndex(root = ROOT) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const refs = new Set();
  for (const [, url] of html.matchAll(/\b(?:src|href)="([^"#]+)"/g)) {
    if (/^(?:[a-z]+:)?\/\//i.test(url) || /^(?:mailto|data|javascript):/i.test(url)) continue;
    refs.add(url.split("?")[0].replace(/^\.\//, ""));
  }
  return [...refs].filter(Boolean);
}

function appVersion(root = ROOT) {
  const m = fs.readFileSync(path.join(root, "src", "app.js"), "utf8").match(/const APP_VERSION = "([^"]+)"/);
  if (!m) throw new Error("src/app.js has no APP_VERSION");
  return m[1];
}

// owner/repo: from Actions when building there, else from the git remote.
function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execSync("git remote get-url origin", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const m = url.replace(/\.git$/, "").match(/([^/:]+)\/([^/]+)$/);
    return m ? m[1] + "/" + m[2] : null;
  } catch (e) { return null; }
}

function build(out = OUT, root = ROOT) {
  const assets = assetList(root);
  const missing = referencedByIndex(root).filter((f) => !assets.includes(f));
  if (missing.length) {
    throw new Error("index.html loads files sw.js's ASSETS doesn't list, so neither the offline cache " +
      "nor the app would have them: " + missing.join(", "));
  }
  fs.rmSync(out, { recursive: true, force: true });
  for (const rel of assets) {
    const from = path.join(root, rel);
    if (!fs.existsSync(from)) throw new Error("sw.js lists " + rel + ", which doesn't exist");
    const to = path.join(out, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  const repo = repoSlug();
  const [owner, name] = repo ? repo.split("/") : [];
  const info = {
    version: appVersion(root),
    repo,
    // GitHub Pages: the host is the owner lowercased, the path the repo as named.
    webUrl: repo ? "https://" + owner.toLowerCase() + ".github.io/" + name + "/" : null,
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, "app-build.json"), JSON.stringify(info, null, 2) + "\n");
  return { out, files: assets.length + 1, info };
}

if (require.main === module) {
  const r = build();
  console.log("www: " + r.files + " files → " + path.relative(ROOT, r.out) + " (" + r.info.version + ", " + (r.info.repo || "no repo") + ")");
}
module.exports = { build, assetList, referencedByIndex, appVersion };
