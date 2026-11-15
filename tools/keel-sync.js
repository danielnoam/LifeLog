// keel: brings this app's shared files up to a keel release, and checks
// they haven't been edited here since.
//
//   node tools/keel-sync.js v0.2.0          the files of keel's tag v0.2.0
//   node tools/keel-sync.js --from ../keel  the files of a local keel checkout
//   node tools/keel-sync.js --check         are they as keel.lock.json says?
//
// keel.files.json (in keel) lists the shared files. They are written here
// as plain committed files, so the web copy and the native builds need no
// step of their own. keel.lock.json records the release and each file's
// hash; test/keel.test.js runs --check, so a shared file changed in an app
// fails its tests. Fix it in keel, tag a release, sync each app.
//
// A file edited here since the last sync is never written over: the sync
// stops and names it, unless --force (the edit is then lost).
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const LOCK = "keel.lock.json";
const SOURCE = "https://github.com/danielnoam/keel.git";

// Line endings don't count: a Windows checkout with autocrlf is the same file.
const hash = (buf) => crypto.createHash("sha256").update(buf.toString("utf8").replace(/\r\n/g, "\n")).digest("hex");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}

function check(root = ROOT) {
  const lock = readJson(path.join(root, LOCK), null);
  if (!lock) return { lock: null, changed: [], missing: [] };
  const changed = [], missing = [];
  for (const [rel, want] of Object.entries(lock.files)) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) missing.push(rel);
    else if (hash(fs.readFileSync(file)) !== want) changed.push(rel);
  }
  return { lock, changed, missing };
}

function sync(from, { root = ROOT, force = false } = {}) {
  const list = readJson(path.join(from, "keel.files.json"), null);
  if (!list || !Array.isArray(list.files)) throw new Error(from + " has no keel.files.json");
  const before = check(root);
  if (before.changed.length && !force) {
    throw new Error("edited here since the last sync (" + before.changed.join(", ") + "). Move the change into keel first, or run again with --force to drop it.");
  }
  const files = {};
  for (const rel of list.files) {
    const src = path.join(from, rel);
    if (!fs.existsSync(src)) throw new Error("keel " + list.version + " lists " + rel + " but doesn't have it");
    const to = path.join(root, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(src, to);
    if (rel.endsWith(".sh")) fs.chmodSync(to, 0o755);
    files[rel] = hash(fs.readFileSync(to));
  }
  // A file keel no longer has goes too, unless it was edited here.
  const removed = [];
  if (before.lock) {
    for (const rel of Object.keys(before.lock.files)) {
      if (files[rel] || before.changed.includes(rel)) continue;
      const file = path.join(root, rel);
      if (fs.existsSync(file)) { fs.unlinkSync(file); removed.push(rel); }
    }
  }
  fs.writeFileSync(path.join(root, LOCK), JSON.stringify({ version: list.version, files }, null, 2) + "\n");
  return { was: before.lock && before.lock.version, version: list.version, count: list.files.length, removed };
}

// A tag of keel, cloned into a temporary folder. git uses whatever access
// this machine already has to the private repo.
function fetchTag(tag, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keel-"));
  execFileSync("git", ["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", tag, source, dir], { stdio: ["ignore", "ignore", "inherit"] });
  return dir;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const at = args.indexOf("--from");
  try {
    if (args.includes("--check")) {
      const r = check();
      if (!r.lock) { console.log("no " + LOCK + ": this app doesn't use keel"); process.exit(0); }
      const bad = r.changed.map((f) => "  changed: " + f).concat(r.missing.map((f) => "  missing: " + f));
      console.log(bad.length ? "keel " + r.lock.version + ": shared files differ from the release\n" + bad.join("\n") : "keel " + r.lock.version + ": " + Object.keys(r.lock.files).length + " shared files as released");
      process.exit(bad.length ? 1 : 0);
    }
    const tag = at < 0 ? args.find((a) => !a.startsWith("--")) : null;
    if (at < 0 && !tag) throw new Error("usage: node tools/keel-sync.js <tag> | --from <keel folder> | --check");
    const config = readJson(path.join(ROOT, "keel.config.json"), {});
    const from = at >= 0 ? path.resolve(args[at + 1]) : fetchTag(tag, config.source || SOURCE);
    const r = sync(from, { force });
    if (at < 0) fs.rmSync(from, { recursive: true, force: true });
    console.log("keel " + (r.was || "none") + " -> " + r.version + ": " + r.count + " files" + (r.removed.length ? ", removed " + r.removed.join(", ") : "") + ". Look at the diff, then commit.");
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { check, sync, hash };
