// The unreleased channel's files: the newest build of main, which isn't a
// release, served from the app's GitHub Pages site under unreleased/ and
// never put on the Releases page.
//
//   node tools/unreleased.js note android App.apk > unreleased-android.json
//     in a build of main (android.yml, desktop.yml): what this build is
//     ({ kind, file, version, sha, at }), uploaded beside the file as the
//     artifact unreleased-<kind>;
//
//   node tools/unreleased.js fetch <outDir>
//     in the Pages deploy (pages.yml): the newest unreleased-<kind> artifact
//     of main for each kind, its file put in <outDir> with build.json
//     ({ android: { version, sha, at, file }, windows: ... }), which
//     Keel.releases.check() reads. A kind with no artifact (not built yet,
//     or past the artifacts' 90 days) is left out; the deploy goes on.
//
// Hidden, not private: on a public repo anyone with the address can
// download these. Needs gh, GH_TOKEN and GITHUB_REPOSITORY for fetch.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const KINDS = ["android", "windows"];
const SAFE = /^[\w.-]+$/;

function note(kind, file, { version, sha = process.env.GITHUB_SHA || "", at = new Date().toISOString() } = {}) {
  if (!KINDS.includes(kind)) throw new Error("no such kind: " + kind + " (" + KINDS.join(", ") + ")");
  const name = path.basename(file);
  if (!SAFE.test(name)) throw new Error("file name " + name + " isn't plain");
  if (!version) version = require(path.resolve(__dirname, "build-www")).appVersion();
  return { kind, file: name, version, sha, at };
}

// The newest artifact of main for each kind, from GitHub's artifacts list.
function newest(artifacts, kind) {
  return (artifacts || [])
    .filter((a) => a && a.name === "unreleased-" + kind && !a.expired && a.workflow_run && a.workflow_run.head_branch === "main")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] || null;
}

// The notes found → build.json. A note whose file isn't there is dropped.
function manifest(notes, has = () => true) {
  const out = {};
  for (const n of notes) {
    if (!n || !KINDS.includes(n.kind) || !SAFE.test(String(n.file || "")) || !has(n.file)) continue;
    out[n.kind] = { version: String(n.version || ""), sha: String(n.sha || ""), at: String(n.at || ""), file: n.file };
  }
  return out;
}

function fetchAll(outDir, { repo = process.env.GITHUB_REPOSITORY, gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }) } = {}) {
  if (!repo) throw new Error("GITHUB_REPOSITORY isn't set");
  fs.mkdirSync(outDir, { recursive: true });
  const notes = [];
  for (const kind of KINDS) {
    try {
      const list = JSON.parse(gh(["api", "repos/" + repo + "/actions/artifacts?name=unreleased-" + kind + "&per_page=30"]));
      const a = newest(list.artifacts, kind);
      if (!a) { console.error("unreleased: no " + kind + " build of main yet"); continue; }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unreleased-"));
      gh(["run", "download", String(a.workflow_run.id), "-R", repo, "-n", a.name, "-D", tmp]);
      const n = JSON.parse(fs.readFileSync(path.join(tmp, "unreleased-" + kind + ".json"), "utf8"));
      if (n.kind !== kind || !SAFE.test(String(n.file || "")) || !fs.existsSync(path.join(tmp, n.file))) throw new Error("the artifact's note doesn't match its file");
      fs.copyFileSync(path.join(tmp, n.file), path.join(outDir, n.file));
      notes.push(n);
      console.error("unreleased: " + kind + " " + n.version + " at " + String(n.sha).slice(0, 7));
    } catch (e) {
      console.error("unreleased: couldn't get the " + kind + " build: " + (e && e.message || e));
    }
  }
  const m = manifest(notes, (f) => fs.existsSync(path.join(outDir, f)));
  fs.writeFileSync(path.join(outDir, "build.json"), JSON.stringify(m, null, 2) + "\n");
  return m;
}

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "note" && a && b) console.log(JSON.stringify(note(a, b), null, 2));
  else if (cmd === "fetch" && a) fetchAll(a);
  else { console.error("usage: unreleased.js note <android|windows> <file> | fetch <outDir>"); process.exitCode = 2; }
}
module.exports = { note, newest, manifest, fetchAll, KINDS };
