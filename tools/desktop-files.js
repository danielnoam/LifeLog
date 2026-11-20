// The desktop app's release files (.github/workflows/desktop.yml).
//
//   node tools/desktop-files.js linux|windows <outDir>
//     copies what `tauri build` made into <outDir> under fixed names
//     (LifeLog.AppImage, LifeLog.deb and LifeLog-setup.exe, with a
//     .sig beside each when the updater key signed them), so a release's
//     download links read the same from one version to the next. Windows
//     also gets the portable app (2026-11-20): LifeLog.exe, which the app's
//     own updater downloads (src-tauri/src/portable.rs; the workflow signs
//     it), and LifeLog-windows.zip, a LifeLog folder holding it, which is
//     what people download. The installer stays only as the update for
//     copies it installed, which move to the portable updater with it.
//
//   node tools/desktop-files.js manifest <version> <sigDir>
//     prints latest.json, which Tauri's updater reads from the latest
//     release: per system, where the new version is and its signature.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

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
  ["LifeLog.exe", ["windows-x86_64-portable"]],
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

// A zip of [name, Buffer] entries, deflated. Enough for one exe; no library.
function zip(entries, date = new Date()) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name, "utf8");
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(dosTime, 10);
    head.writeUInt16LE(dosDate, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(dosTime, 12);
    dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(head, n, packed);
    central.push(dir, n);
    offset += 30 + n.length + packed.length;
  }
  const size = central.reduce((t, b) => t + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

// The portable app: the exe `tauri build` left in target/release (Cargo's
// name, lifelog.exe, or the product's), as LifeLog.exe and zipped in a
// LifeLog folder.
function portable(out, release = path.dirname(BUNDLE)) {
  const made = fs.existsSync(release) ? fs.readdirSync(release).filter((f) => /^lifelog\.exe$/i.test(f)) : [];
  if (made.length !== 1) throw new Error("expected one LifeLog.exe in " + release + ", found " + (made.join(", ") || "none"));
  const exe = fs.readFileSync(path.join(release, made[0]));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "LifeLog.exe"), exe);
  fs.writeFileSync(path.join(out, "LifeLog-windows.zip"), zip([["LifeLog/LifeLog.exe", exe]]));
  return ["LifeLog.exe", "LifeLog-windows.zip"];
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
    const dir = path.resolve(a || "out");
    const out = collect(mode, dir);
    if (mode === "windows") out.push(...portable(dir));
    console.log("desktop files: " + out.join(", "));
  }
}
module.exports = { collect, portable, zip, manifest, FILES, UPDATER };
