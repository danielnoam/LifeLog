// Adds what LifeLog needs to the generated AndroidManifest.xml.
//
//   node tools/android-manifest.js
//
// One entry today: the ML Kit meta-data that has Google Play services fetch
// its barcode-scanner module when the app is installed, rather than the first
// time someone taps "Scan QR code" (0.175.0). The scanner is Google's own
// screen, run by Play services, which is why the app needs no camera
// permission for it — and why this is a manifest line and not a permission.
//
// The app still installs the module itself if it's missing, so this is about
// the first scan being instant rather than about it working at all.
// Idempotent, and fails loudly if <application> can't be found.
const fs = require("fs");
const path = require("path");

const ENTRIES = [
  '<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui"/>',
];

function patch(xml) {
  let out = xml;
  for (const entry of ENTRIES) {
    const name = entry.match(/android:name="([^"]+)"/)[1];
    if (out.includes('android:name="' + name + '"')) continue;
    const at = out.search(/<application\b[^>]*>/);
    if (at < 0) throw new Error("no <application> tag in AndroidManifest.xml");
    const end = out.indexOf(">", at) + 1;
    out = out.slice(0, end) + "\n        " + entry + out.slice(end);
  }
  return out;
}

if (require.main === module) {
  const file = path.resolve(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml");
  const before = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, patch(before));
  console.log("android: manifest " + (before === patch(before) ? "already has" : "gained") + " " + ENTRIES.length + " LifeLog entr" + (ENTRIES.length === 1 ? "y" : "ies"));
}
module.exports = { patch, ENTRIES };
