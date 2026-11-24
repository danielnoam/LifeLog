// The Windows app's unreleased update (2026-11-24): the signed LifeLog.exe
// of the same build of main that build.json names, and a latest.json that
// points Tauri's updater at it (src-tauri/src/portable.rs, UNRELEASED).
//
//   node tools/unreleased-update.js fetch <outDir>
//     in the Pages deploy (pages.yml), after keel's tools/unreleased.js
//     fetch: the artifact unreleased-windows-exe (LifeLog.exe and its .sig,
//     desktop.yml) of build.json's windows commit, LifeLog.exe put in
//     <outDir> and latest.json written beside it. No artifact, no signature
//     or no windows build: nothing is written, the app opens the zip instead.
//
// LifeLog's own, beside keel's: keel's channel serves one file per kind.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ARTIFACT = "unreleased-windows-exe";
const EXE = "LifeLog.exe";
const TARGET = "windows-x86_64-portable";

// The artifact of main built from `sha`, or null.
function match(artifacts, sha) {
  return (artifacts || [])
    .filter((a) => a && a.name === ARTIFACT && !a.expired && a.workflow_run && a.workflow_run.head_branch === "main" && a.workflow_run.head_sha === sha)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] || null;
}

function manifest(win, signature, site) {
  return {
    version: String(win.version),
    notes: "",
    pub_date: String(win.at || new Date().toISOString()),
    platforms: { [TARGET]: { signature: String(signature).trim(), url: site + "unreleased/" + EXE } },
  };
}

function siteOf(repo) {
  const [owner, name] = String(repo || "").split("/");
  return "https://" + owner.toLowerCase() + ".github.io/" + name + "/";
}

function fetchExe(outDir, { repo = process.env.GITHUB_REPOSITORY, gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }) } = {}) {
  if (!repo) throw new Error("GITHUB_REPOSITORY isn't set");
  let build = {};
  try { build = JSON.parse(fs.readFileSync(path.join(outDir, "build.json"), "utf8")); } catch (e) { /* no channel yet */ }
  const win = build.windows;
  if (!win || !/^[0-9a-f]{40}$/.test(String(win.sha)) || !/^\d+\.\d+\.\d+$/.test(String(win.version))) {
    console.error("unreleased update: no windows build in build.json");
    return null;
  }
  const list = JSON.parse(gh(["api", "repos/" + repo + "/actions/artifacts?name=" + ARTIFACT + "&per_page=30"]));
  const a = match(list.artifacts, win.sha);
  if (!a) { console.error("unreleased update: no " + ARTIFACT + " for " + win.sha.slice(0, 7)); return null; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unreleased-exe-"));
  gh(["run", "download", String(a.workflow_run.id), "-R", repo, "-n", ARTIFACT, "-D", tmp]);
  const sig = path.join(tmp, EXE + ".sig");
  if (!fs.existsSync(path.join(tmp, EXE)) || !fs.existsSync(sig)) {
    console.error("unreleased update: the build wasn't signed, so no latest.json");
    return null;
  }
  fs.copyFileSync(path.join(tmp, EXE), path.join(outDir, EXE));
  const m = manifest(win, fs.readFileSync(sig, "utf8"), siteOf(repo));
  fs.writeFileSync(path.join(outDir, "latest.json"), JSON.stringify(m, null, 2) + "\n");
  console.error("unreleased update: windows " + win.version + " at " + win.sha.slice(0, 7));
  return m;
}

if (require.main === module) {
  const [cmd, dir] = process.argv.slice(2);
  if (cmd === "fetch" && dir) {
    try { fetchExe(dir); } catch (e) { console.error("unreleased update: " + (e && e.message || e)); }
  } else {
    console.error("usage: node tools/unreleased-update.js fetch <outDir>");
    process.exit(2);
  }
}
module.exports = { match, manifest, siteOf, fetchExe, ARTIFACT, EXE, TARGET };
