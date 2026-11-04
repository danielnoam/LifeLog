// The desktop app's release files (.github/workflows/desktop.yml).
//
//   node tools/desktop-files.js linux|windows <outDir>
//     copies what `tauri build` made into <outDir> under fixed names
//     (LifeLog.AppImage, LifeLog.deb and LifeLog-setup.exe, with a
//     .sig beside each when the updater key signed them), so a release's
//     download links read the same from one version to the next;
//
//   node tools/desktop-files.js manifest <version> <sigDir>
//     prints latest.json, which Tauri's updater reads from the latest
//     release: per system, where the new version is and its signature.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BUNDLE = path.join(ROOT, "src-tauri", "target", "release", "bundle");
const REPO = process.env.GITHUB_REPOSITORY || "danielnoam/LifeLog";

// [bundle folder, file ending, fixed name]
const FILES = {
  linux: [["appimage", ".AppImage", "LifeLog.AppImage"], ["deb", ".deb", "LifeLog.deb"]],
  // No MSI: Windows Installer caps the version's middle number at 255.
  windows: [["nsis", "-setup.exe", "LifeLog-setup.exe"]],
};

// Where the updater looks for each system: the installer-specific key first,
// and the plain one for an updater that doesn't send its installer.
const UPDATER = [
  ["LifeLog-setup.exe", ["windows-x86_64-nsis", "windows-x86_64"]],
  ["LifeLog.AppImage", ["linux-x86_64-appimage", "linux-x86_64"]],
  ["LifeLog.deb", ["linux-x86_64-deb"]],
];

function collect(system, out, bundle = BUNDLE) {
  const wanted = FILES[system];
  if (!wanted) throw new Error("no such system: " + system);
  fs.mkdirSync(out, { recursive: true });
  const copied = [];
  for (const [dir, ending, name] of wanted) {
    const from = path.join(bundle, dir);
    const made = fs.existsSync(from) ? fs.readdirSync(from).filter((f) => f.endsWith(ending)) : [];
    if (made.length !== 1) throw new Error("expected one " + ending + " in " + from + ", found " + (made.join(", ") || "none"));
    fs.copyFileSync(path.join(from, made[0]), path.join(out, name));
    copied.push(name);
    if (fs.existsSync(path.join(from, made[0] + ".sig"))) {
      fs.copyFileSync(path.join(from, made[0] + ".sig"), path.join(out, name + ".sig"));
      copied.push(name + ".sig");
    }
  }
  return copied;
}

function manifest(version, sigDir, { repo = REPO, notes = "", date = new Date().toISOString() } = {}) {
  const platforms = {};
  for (const [file, keys] of UPDATER) {
    const sig = path.join(sigDir, file + ".sig");
    if (!fs.existsSync(sig)) continue;
    const entry = {
      signature: fs.readFileSync(sig, "utf8").trim(),
      url: "https://github.com/" + repo + "/releases/download/app-v" + version + "/" + file,
    };
    for (const k of keys) platforms[k] = entry;
  }
  return { version, notes, pub_date: date, platforms };
}

if (require.main === module) {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === "manifest") {
    process.stdout.write(JSON.stringify(manifest(a, b), null, 2) + "\n");
  } else {
    const out = collect(mode, path.resolve(a || "out"));
    console.log("desktop files: " + out.join(", "));
  }
}
module.exports = { collect, manifest, FILES, UPDATER };
