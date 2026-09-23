// Stamps APP_VERSION into the generated Android project.
//
//   node tools/android-version.js
//
// Android installs an update over an existing app only if its versionCode is
// not lower, and Capacitor's template ships versionCode 1 forever. The code
// is derived from APP_VERSION — major·1,000,000 + minor·1,000 + patch, so
// 0.173.1 is 173001 — which makes every release strictly higher than the one
// before without anyone having to remember a second number.
//
// Fails, rather than warns, if the template's lines have moved: an APK that
// silently kept versionCode 1 would install once and then refuse every update.
const fs = require("fs");
const path = require("path");
const { appVersion } = require("./build-www");

function versionCode(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error("APP_VERSION " + v + " isn't major.minor.patch");
  const [maj, min, pat] = m.slice(1).map(Number);
  if (min > 999 || pat > 999) throw new Error("APP_VERSION " + v + " overflows the versionCode scheme");
  return maj * 1000000 + min * 1000 + pat;
}

function stamp(gradlePath, v) {
  const src = fs.readFileSync(gradlePath, "utf8");
  const code = versionCode(v);
  const out = src
    .replace(/versionCode \d+/, "versionCode " + code)
    .replace(/versionName "[^"]*"/, 'versionName "' + v + '"');
  if (!out.includes("versionCode " + code) || !out.includes('versionName "' + v + '"')) {
    throw new Error("couldn't find versionCode/versionName in " + gradlePath);
  }
  fs.writeFileSync(gradlePath, out);
  return code;
}

if (require.main === module) {
  const v = appVersion();
  const gradle = path.resolve(__dirname, "..", "android", "app", "build.gradle");
  console.log("android: versionName " + v + ", versionCode " + stamp(gradle, v));
}
module.exports = { versionCode, stamp };
