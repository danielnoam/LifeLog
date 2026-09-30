// Adds what LifeLog needs to the generated iOS project, and stamps the version.
//
//   node tools/ios-project.js
//
// The iOS counterpart of android-manifest.js and android-version.js, in one
// step since both edit files `npx cap add ios` has just written.
//
// Info.plist gains:
//
// - UIFileSharingEnabled and LSSupportsOpeningDocumentsInPlace, so the phone
//   backup (Settings → Sync) is in the Files app under On My iPhone → LifeLog.
//   Without them the app's Documents folder exists but nobody can see it,
//   which is no backup at all.
// - NSCameraUsageDescription, for scanning a setup QR code. On Android that's
//   Google's scanner, run by Play services, and LifeLog asks for nothing; on
//   iOS the plugin opens the camera itself, and iOS closes an app that does
//   so without saying why.
// - ITSAppUsesNonExemptEncryption = false: the app uses only the system's
//   HTTPS. Harmless for a sideloaded build, and it spares a question on every
//   upload once there's a developer account and TestFlight.
//
// project.pbxproj gets MARKETING_VERSION = APP_VERSION and
// CURRENT_PROJECT_VERSION = the same number Android's versionCode is, so a
// build is always higher than the one before without a second counter.
//
// The oldest iOS is raised from the template's 15.0 to 15.5, in the project
// and the Podfile alike: Google's ML Kit (the QR scanner) needs 15.5, and
// pod install refuses a project that asks for less than a pod does.
//
// Idempotent, and fails loudly if what it edits isn't where it expects.
const fs = require("fs");
const path = require("path");
const { appVersion } = require("./build-www");
const { versionCode } = require("./android-version");

const PLIST = [
  ["UIFileSharingEnabled", "<true/>"],
  ["LSSupportsOpeningDocumentsInPlace", "<true/>"],
  ["NSCameraUsageDescription", "<string>LifeLog uses the camera to read the setup QR code from another device.</string>"],
  ["ITSAppUsesNonExemptEncryption", "<false/>"],
];

function patchPlist(xml) {
  let out = xml;
  for (const [key, value] of PLIST) {
    if (out.includes("<key>" + key + "</key>")) continue;
    const end = out.lastIndexOf("</dict>");
    if (end < 0 || !/<plist\b/.test(out)) throw new Error("Info.plist has no top-level <dict>");
    out = out.slice(0, end) + "\t<key>" + key + "</key>\n\t" + value + "\n" + out.slice(end);
  }
  return out;
}

const MIN_IOS = "15.5";

function raiseMinIos(podfile) {
  if (!/platform :ios, '[\d.]+'/.test(podfile)) throw new Error("Podfile has no platform :ios line");
  return podfile.replace(/platform :ios, '[\d.]+'/, "platform :ios, '" + MIN_IOS + "'");
}

function stampPbxproj(src, v) {
  const build = versionCode(v);
  if (!/MARKETING_VERSION = [^;]+;/.test(src) || !/CURRENT_PROJECT_VERSION = [^;]+;/.test(src)) {
    throw new Error("project.pbxproj has no MARKETING_VERSION / CURRENT_PROJECT_VERSION to stamp");
  }
  return src
    .replace(/MARKETING_VERSION = [^;]+;/g, "MARKETING_VERSION = " + v + ";")
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, "CURRENT_PROJECT_VERSION = " + build + ";")
    .replace(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, "IPHONEOS_DEPLOYMENT_TARGET = " + MIN_IOS + ";");
}

if (require.main === module) {
  const app = path.resolve(__dirname, "..", "ios", "App");
  const plist = path.join(app, "App", "Info.plist");
  const pbx = path.join(app, "App.xcodeproj", "project.pbxproj");
  const v = appVersion();
  fs.writeFileSync(plist, patchPlist(fs.readFileSync(plist, "utf8")));
  fs.writeFileSync(pbx, stampPbxproj(fs.readFileSync(pbx, "utf8"), v));
  const podfile = path.join(app, "Podfile");
  fs.writeFileSync(podfile, raiseMinIos(fs.readFileSync(podfile, "utf8")));
  console.log("ios: Info.plist has " + PLIST.length + " LifeLog keys; version " + v + " (" + versionCode(v) + "); iOS " + MIN_IOS + " and later");
}
module.exports = { patchPlist, stampPbxproj, raiseMinIos, PLIST, MIN_IOS };
