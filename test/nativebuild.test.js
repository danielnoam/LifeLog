// Zero-dependency tests for the Android build's two tools —
// `node test/nativebuild.test.js`.
//
// Neither can be run end to end here (there is no Android SDK outside CI),
// but the two ways they can quietly produce a broken app can be checked
// without one: a bundle missing a file the page loads, and a versionCode
// that doesn't go up.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { build, assetList, referencedByIndex, appVersion } = require("../tools/build-www.js");
const { versionCode, stamp } = require("../tools/android-version.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lifelog-www-"));
const out = path.join(tmp, "www");
const result = build(out);
const files = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((d) => d.isDirectory() ? files(path.join(dir, d.name), base) : [path.relative(base, path.join(dir, d.name))]);
const shipped = files(out).map((f) => f.split(path.sep).join("/"));

console.log("\nthe bundle");

test("every file index.html loads is in the bundle", () => {
  const missing = referencedByIndex().filter((f) => !shipped.includes(f));
  assert.deepStrictEqual(missing, []);
});

test("the bundle is the offline cache's list and nothing else", () => {
  const extra = shipped.filter((f) => f !== "app-build.json" && !assetList().includes(f));
  assert.deepStrictEqual(extra, []);
});

test("your data file, the tests and the docs never ship inside the app", () => {
  for (const f of ["lifelog.json", "NOTES.md", "CHANGELOG.md", "sw.js", "server.js"]) {
    assert.ok(!shipped.includes(f), f + " was bundled");
  }
  assert.ok(!shipped.some((f) => f.startsWith("test/") || f.startsWith("tools/")), "test/ or tools/ was bundled");
});

test("the platform layer is loaded before anything that asks it a question", () => {
  const order = referencedByIndex().filter((f) => f.endsWith(".js"));
  assert.strictEqual(order[0], "src/platform.js");
});

test("the build says what it is, whose it is and where its web copy lives", () => {
  const info = JSON.parse(fs.readFileSync(path.join(out, "app-build.json"), "utf8"));
  assert.strictEqual(info.version, appVersion());
  assert.strictEqual(info.version, result.info.version);
  if (info.repo) {
    const [owner, name] = info.repo.split("/");
    // Pages lowercases the owner in the host and keeps the repo's own case.
    assert.strictEqual(info.webUrl, "https://" + owner.toLowerCase() + ".github.io/" + name + "/");
  }
});

test("a file index.html loads but the cache list forgot fails the build", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lifelog-root-"));
  fs.copyFileSync(path.join(__dirname, "..", "sw.js"), path.join(root, "sw.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  fs.writeFileSync(path.join(root, "index.html"), html.replace("</body>", '<script src="src/forgotten.js"></script></body>'));
  assert.throws(() => build(path.join(root, "www"), root), /src\/forgotten\.js/);
  assert.ok(!fs.existsSync(path.join(root, "www")), "it copied before it checked");
  fs.rmSync(root, { recursive: true, force: true });
});

test("only the app's copy of index.html goes edge to edge", () => {
  const app = fs.readFileSync(path.join(out, "index.html"), "utf8");
  const web = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(/viewport-fit=cover/.test(app) && /<html[^>]*class="[^"]*\bnative\b/.test(app), "app copy not marked");
  assert.ok(!/viewport-fit/.test(web) && !/class="native"/.test(web), "the web copy was changed");
});

console.log("\nthe version Android sees");

test("versionCode is APP_VERSION as one number", () => {
  assert.strictEqual(versionCode("0.173.1"), 173001);
  assert.strictEqual(versionCode("0.174.0"), 174000);
  assert.strictEqual(versionCode("1.0.0"), 1000000);
});

test("every release is higher than the one before, which is all Android checks", () => {
  const seq = ["0.9.9", "0.99.0", "0.173.1", "0.174.0", "0.174.12", "0.175.0", "1.0.0", "1.2.3"];
  const codes = seq.map(versionCode);
  for (let i = 1; i < codes.length; i++) assert.ok(codes[i] > codes[i - 1], seq[i] + " isn't above " + seq[i - 1]);
});

test("a version the scheme can't hold is refused rather than wrapped", () => {
  assert.throws(() => versionCode("0.1000.0"));
  assert.throws(() => versionCode("0.1.1000"));
  assert.throws(() => versionCode("0.174"));
});

test("stamping replaces the template's version lines", () => {
  const g = path.join(tmp, "build.gradle");
  fs.writeFileSync(g, 'defaultConfig {\n        versionCode 1\n        versionName "1.0"\n}\n');
  assert.strictEqual(stamp(g, "0.174.0"), 174000);
  const after = fs.readFileSync(g, "utf8");
  assert.ok(after.includes("versionCode 174000") && after.includes('versionName "0.174.0"'), after);
});

test("a template whose version lines moved fails instead of shipping versionCode 1", () => {
  const g = path.join(tmp, "moved.gradle");
  fs.writeFileSync(g, "defaultConfig {\n        versionCode = 1\n}\n");
  assert.throws(() => stamp(g, "0.174.0"));
});

console.log("\nthe manifest");
const { patch } = require("../tools/android-manifest.js");
const TEMPLATE = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:theme="@style/AppTheme">
        <activity android:name=".MainActivity" />
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>`;

test("the scanner module is asked for inside <application>, not beside it", () => {
  const out = patch(TEMPLATE);
  const app = out.slice(out.indexOf("<application"), out.indexOf("</application>"));
  assert.ok(app.includes('android:name="com.google.mlkit.vision.DEPENDENCIES"') && app.includes('android:value="barcode_ui"'), out);
});

test("patching twice doesn't add it twice", () => {
  const twice = patch(patch(TEMPLATE));
  assert.strictEqual(twice.split("com.google.mlkit.vision.DEPENDENCIES").length - 1, 1);
});

test("no camera permission: Google's scanner runs the camera, not LifeLog", () => {
  assert.ok(!patch(TEMPLATE).includes("android.permission.CAMERA"));
});

test("the app may hand Android an APK to install — the in-app updater needs it", () => {
  const out = patch(TEMPLATE);
  const beforeApp = out.slice(0, out.indexOf("<application"));
  assert.ok(beforeApp.includes('<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />'), out);
  assert.strictEqual(patch(out).split("REQUEST_INSTALL_PACKAGES").length - 1, 1);
});

test("a manifest without <application> fails instead of shipping without the scanner", () => {
  assert.throws(() => patch("<manifest></manifest>"), /application/);
});

console.log("\nthe widgets");
// Nothing here can inflate a widget, and a mistake in one isn't a build
// error: Android draws "Can't load widget" on the home screen instead. So
// what can be checked from the files is checked here.
const WIDGETS = path.join(__dirname, "..", "native", "widgets", "android", "src", "main");
const JAVA = path.join(WIDGETS, "java", "io", "github", "danielnoam", "lifelog", "widgets");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
const javaSrc = fs.readdirSync(JAVA).filter((f) => f.endsWith(".java")).map((f) => read(JAVA, f)).join("\n");
const layouts = fs.readdirSync(path.join(WIDGETS, "res", "layout"));

// The views RemoteViews can inflate on every Android the app supports
// (minSdk 24). Anything else — a plain <View> divider, a CheckBox before 12 —
// is the "Can't load widget" box.
const REMOTABLE = new Set(["FrameLayout", "LinearLayout", "RelativeLayout", "GridLayout",
  "TextView", "ImageView", "Button", "ImageButton", "ProgressBar", "ListView", "GridView",
  "StackView", "AdapterViewFlipper", "ViewFlipper", "Chronometer", "AnalogClock", "ViewStub"]);

// Views widgets gained in Android 12, allowed only in a layout the Java
// reaches for behind a version check — elsewhere they'd be the same box on
// every phone older than that.
const FROM_12 = { "widget_row_check.xml": ["CheckBox"] };

test("every widget layout uses only views a home-screen widget can show", () => {
  for (const f of layouts) {
    const tags = [...read(WIDGETS, "res", "layout", f).matchAll(/<([A-Za-z][\w.]*)[\s>/]/g)].map((m) => m[1]);
    const bad = tags.filter((t) => !REMOTABLE.has(t) && !(FROM_12[f] || []).includes(t));
    assert.deepStrictEqual(bad, [], f);
  }
});

test("a layout that needs Android 12 is only ever used behind a check for it", () => {
  for (const f of Object.keys(FROM_12)) {
    const name = f.replace(/\.xml$/, "");
    const uses = [...javaSrc.matchAll(new RegExp("R\\.layout\\." + name + "\\b", "g"))];
    assert.ok(uses.length, name + " is never used");
    // The one method that inflates it is only called behind SDK_INT >= S.
    assert.ok(/SDK_INT >= Build\.VERSION_CODES\.S\) return checkboxRow\(/.test(javaSrc), "checkboxRow isn't guarded");
    const start = javaSrc.search(/RemoteViews checkboxRow\(/);
    assert.ok(start > -1, "no checkboxRow");
    const owner = javaSrc.slice(start, javaSrc.indexOf("\n    }\n", start));
    assert.ok(owner.includes("R.layout." + name), name + " isn't inflated in checkboxRow");
    assert.strictEqual(uses.length, 1, name + " is used outside checkboxRow");
  }
});

test("every view the Java reaches for is in a layout", () => {
  const declared = new Set();
  for (const f of layouts) for (const m of read(WIDGETS, "res", "layout", f).matchAll(/@\+id\/(\w+)/g)) declared.add(m[1]);
  const used = [...new Set([...javaSrc.matchAll(/R\.id\.(\w+)/g)].map((m) => m[1]))];
  assert.deepStrictEqual(used.filter((id) => !declared.has(id)), []);
});

test("every layout, drawable and colour the Java names exists", () => {
  const have = (kind, name) => kind === "color"
    ? /<color name="/.test(read(WIDGETS, "res", "values", "colors.xml")) && read(WIDGETS, "res", "values", "colors.xml").includes('name="' + name + '"')
    : fs.existsSync(path.join(WIDGETS, "res", kind, name + ".xml"));
  const missing = [...javaSrc.matchAll(/R\.(layout|drawable|color)\.(\w+)/g)].filter((m) => !have(m[1], m[2])).map((m) => m[0]);
  assert.deepStrictEqual([...new Set(missing)], []);
});

test("dark mode redefines every widget colour, so none is left light-on-dark", () => {
  const names = (f) => [...read(WIDGETS, "res", f, "colors.xml").matchAll(/<color name="(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(names("values-night"), names("values"));
});

test("each widget is declared, with its definition, and the list service is bound", () => {
  const manifest = read(WIDGETS, "AndroidManifest.xml");
  for (const w of ["HabitsWidget", "TodosWidget", "QuickAddWidget", "SpendWidget"]) {
    const block = manifest.slice(manifest.indexOf("widgets." + w + '"'), manifest.indexOf("</receiver>", manifest.indexOf("widgets." + w + '"')));
    assert.ok(block.includes("android.appwidget.action.APPWIDGET_UPDATE"), w + " never hears it should draw");
    const info = (block.match(/@xml\/(\w+)/) || [])[1];
    assert.ok(info && fs.existsSync(path.join(WIDGETS, "res", "xml", info + ".xml")), w + " has no definition");
    assert.ok(javaSrc.includes("class " + w + " extends AppWidgetProvider"), w + " isn't a provider");
  }
  assert.ok(/ListService"[\s\S]*?android:permission="android.permission.BIND_REMOTEVIEWS"/.test(manifest), "the list service is open to anyone");
});

test("reminders can post, and come back after a reboot, an update or a clock change", () => {
  const manifest = read(WIDGETS, "AndroidManifest.xml");
  for (const p of ["POST_NOTIFICATIONS", "RECEIVE_BOOT_COMPLETED"]) {
    assert.ok(manifest.includes('android:name="android.permission.' + p + '"'), p);
  }
  const block = manifest.slice(manifest.indexOf("widgets.ReminderReceiver"), manifest.indexOf("</receiver>", manifest.indexOf("widgets.ReminderReceiver")));
  for (const a of ["BOOT_COMPLETED", "MY_PACKAGE_REPLACED", "TIME_SET", "TIMEZONE_CHANGED"]) {
    assert.ok(block.includes("android.intent.action." + a), a);
  }
  assert.ok(javaSrc.includes("class ReminderReceiver extends BroadcastReceiver"));
});

test("the page asks the plugin only for what the plugin has", () => {
  const methods = new Set([...javaSrc.matchAll(/@PluginMethod\s+public void (\w+)\(/g)].map((m) => m[1]));
  const js = ["widgets.js", "reminders.js"].map((f) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8")).join("\n");
  const called = [...new Set([...js.matchAll(/\bW\.(\w+)\(/g), ...js.matchAll(/plugin\(\)\.(\w+)\(/g)].map((m) => m[1]))]
    .filter((m) => m !== "addListener");
  assert.ok(called.length >= 6, called);
  assert.deepStrictEqual(called.filter((m) => !methods.has(m)), []);
});

test("the app loads the plugin by the name the page calls it", () => {
  const name = (javaSrc.match(/@CapacitorPlugin\(\s*name = "(\w+)"/) || [])[1];
  assert.strictEqual(name, "Widgets");
  assert.ok(/plugin\("Widgets"\)/.test(fs.readFileSync(path.join(__dirname, "..", "src", "widgets.js"), "utf8")));
  const pkg = require("../package.json");
  assert.strictEqual(pkg.devDependencies["lifelog-widgets"], "file:native/widgets");
});

test("every action a widget sends is one the app knows what to do with", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
  const run = app.slice(app.indexOf("function runAction("), app.indexOf("const quickActions"));
  // "open-habit:" + an id is sent as a prefix, and handled as one.
  const sent = [...new Set([...javaSrc.matchAll(/"((?:add|open)-[a-z]+:?)"/g)].map((m) => m[1]))];
  assert.ok(sent.length >= 7 && sent.includes("open-habit:"), sent);
  assert.deepStrictEqual(sent.filter((a) => !run.includes('"' + a + '"')), []);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
