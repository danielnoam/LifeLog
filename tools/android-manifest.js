// Adds what LifeLog needs to the generated AndroidManifest.xml.
//
//   node tools/android-manifest.js
//
// Two entries:
//
// - The ML Kit meta-data that has Google Play services fetch its
//   barcode-scanner module when the app is installed, rather than the first
//   time someone taps "Scan QR code" (0.175.0). The scanner is Google's own
//   screen, run by Play services, which is why the app needs no camera
//   permission for it. The app still installs the module itself if it's
//   missing, so this is about the first scan being instant.
//
// - REQUEST_INSTALL_PACKAGES, for the in-app updater (0.179.0): without it,
//   Android refuses to install an APK that an app hands it. Play restricts
//   this permission; a sideloaded app is exactly what it's for. The user still
//   approves each install on Android's own screen, and once, in Settings,
//   whether LifeLog may install apps at all.
//
// - The Share sheet (0.250.0): an intent filter on the main activity for
//   text shared from other apps, which the Widgets plugin turns into the
//   share action src/share.js reads. On the activity, not beside it, since
//   Android lists an app in the sheet per activity that takes the intent.
//
// - No cloud backup (0.261.0): allowBackup="false" on <application>. The
//   WebView's storage is the whole log plus the GitHub token and the PIN
//   hash, and the widgets' preferences hold note text; Capacitor's template
//   has allowBackup="true", which puts all of it in the phone's Google
//   backup and in a phone-to-phone transfer. The data comes back from
//   GitHub on a new phone instead. The template's attribute is replaced,
//   not skipped, which is what the `replace` flag below is for.
//
// - Storage for the phone backup (0.215.0), which writes a copy of your data
//   into the phone's shared Documents/LifeLog folder, where the Files app and
//   a PC over USB can see it and where it outlives clearing the app's data.
//   Android 11 and later let an app write files it creates there with no
//   permission at all; 10 needs requestLegacyExternalStorage on
//   <application>; 9 and earlier need WRITE_EXTERNAL_STORAGE, capped at 28
//   so newer phones never show a storage prompt.
//
// Idempotent, and fails loudly if a tag it needs can't be found.
const fs = require("fs");
const path = require("path");

const ENTRIES = [
  { inside: "application", xml: '<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui"/>' },
  { inside: "manifest", xml: '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />' },
  { inside: "manifest", xml: '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />' },
];
// Inside the main activity. The template closes it with a </activity>; a
// self-closing <activity … /> is opened up to take it.
const ACTIVITY = [
  '<intent-filter>\n                <action android:name="android.intent.action.SEND" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <data android:mimeType="text/plain" />\n            </intent-filter>',
];
// Attributes on a tag rather than tags inside one.
const ATTRS = [
  { on: "application", attr: 'android:requestLegacyExternalStorage="true"' },
  { on: "application", attr: 'android:allowBackup="false"', replace: true },
];

function patch(xml) {
  let out = xml;
  for (const { inside, xml: entry } of ENTRIES) {
    const name = entry.match(/android:name="([^"]+)"/)[1];
    if (out.includes('android:name="' + name + '"')) continue;
    const at = out.search(inside === "application" ? /<application\b[^>]*>/ : /<manifest\b[^>]*>/);
    if (at < 0) throw new Error("no <" + inside + "> tag in AndroidManifest.xml");
    const end = out.indexOf(">", at) + 1;
    out = out.slice(0, end) + "\n    " + (inside === "application" ? "    " : "") + entry + out.slice(end);
  }
  for (const entry of ACTIVITY) {
    const name = entry.match(/android:name="([^"]+)"/)[1];
    if (out.includes('android:name="' + name + '"')) continue;
    const m = /<activity\b[^>]*android:name="\.MainActivity"[^>]*?(\/?)>/.exec(out);
    if (!m) throw new Error("no MainActivity <activity> in AndroidManifest.xml");
    const open = m[1] ? m[0].slice(0, -2).trimEnd() + ">" : m[0];
    const tail = m[1] ? "\n        </activity>" : "";
    out = out.slice(0, m.index) + open + "\n            " + entry + tail + out.slice(m.index + m[0].length);
  }
  for (const { on, attr, replace } of ATTRS) {
    const name = attr.split("=")[0];
    const m = new RegExp("<" + on + "\\b[^>]*>").exec(out);
    if (!m) throw new Error("no <" + on + "> tag in AndroidManifest.xml");
    let tag;
    if (m[0].includes(name + "=")) {
      if (!replace || m[0].includes(attr)) continue;
      tag = m[0].replace(new RegExp(name + '="[^"]*"'), attr);
    } else {
      tag = m[0].replace(new RegExp("^<" + on), "<" + on + " " + attr);
    }
    out = out.slice(0, m.index) + tag + out.slice(m.index + m[0].length);
  }
  return out;
}

if (require.main === module) {
  const file = path.resolve(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml");
  const before = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, patch(before));
    const n = ENTRIES.length + ACTIVITY.length + ATTRS.length;
  console.log("android: manifest " + (before === patch(before) ? "already has" : "gained") + " " + n + " LifeLog entr" + (n === 1 ? "y" : "ies"));
}
module.exports = { patch, ENTRIES, ACTIVITY, ATTRS };
