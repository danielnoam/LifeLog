// The release bookkeeping (2026-11-02): `node test/release.test.js`.
// tools/release.js bumps the three version places and folds changes/*.md
// into CHANGELOG.md; the checks here keep main's state consistent between
// releases, when pull requests land without a bump (CONTRIBUTING.md).
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { appVersion } = require("../tools/build-www.js");
const { bump, mergeNotes } = require("../tools/release.js");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifelog-release-"));
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

test("CHANGELOG.md's newest numbered entry is APP_VERSION", () => {
  const log = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const m = log.match(/^## \[([^\]]+)\]/m);
  assert.ok(m, "no version heading");
  assert.strictEqual(m[1], appVersion());
  const heads = log.match(/^## .*$/gm);
  assert.ok(heads.length < 2 || !/^## Unreleased/.test(heads[1]), "Unreleased must be the first heading");
});

test("every ?v= in index.html is APP_VERSION", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const vs = [...html.matchAll(/\?v=([\d.]+)/g)].map((m) => m[1]);
  assert.ok(vs.length > 0);
  for (const v of vs) assert.strictEqual(v, appVersion());
});

test("every note in changes/ uses the CHANGELOG's headings", () => {
  const dir = path.join(ROOT, "changes");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md") && x !== "README.md")) {
    assert.ok(mergeNotes([fs.readFileSync(path.join(dir, f), "utf8")]), f + " has no '- ' lines under a ### heading");
  }
});

test("release.js bumps the three places and dates the Unreleased entry", () => {
  const dir = fixture({
    "src/app.js": 'const APP_VERSION = "1.2.3";\n',
    "index.html": '<script src="src/app.js?v=1.2.3"></script>\n<link rel="stylesheet" href="src/styles.css?v=1.2.3">\n',
    "sw.js": 'const CACHE = "lifelog-v7";\n',
    "CHANGELOG.md": "# Changelog\n\n## Unreleased\n\n### Added\n- A thing.\n\n## [1.2.3] - 2026-01-01\n\n### Fixed\n- Old.\n",
  });
  assert.throws(() => bump("1.2.3", { root: dir }), /isn't above/);
  assert.throws(() => bump("1.3", { root: dir }), /x\.y\.z/);
  const r = bump("1.3.0", { root: dir, date: "2026-02-02" });
  assert.strictEqual(r.tags, 2);
  assert.ok(fs.readFileSync(path.join(dir, "src/app.js"), "utf8").includes('APP_VERSION = "1.3.0"'));
  assert.ok(!fs.readFileSync(path.join(dir, "index.html"), "utf8").includes("1.2.3"));
  assert.ok(fs.readFileSync(path.join(dir, "sw.js"), "utf8").includes("lifelog-v8"));
  assert.ok(fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8").startsWith("# Changelog\n\n## [1.3.0] - 2026-02-02\n\n### Added\n- A thing.\n"));
  assert.throws(() => bump("1.4.0", { root: dir }), /nothing to release/);
});

test("release.js writes the entry from changes/ and deletes the notes", () => {
  const dir = fixture({
    "src/app.js": 'const APP_VERSION = "1.2.3";\n',
    "index.html": '<script src="src/app.js?v=1.2.3"></script>\n',
    "sw.js": 'const CACHE = "lifelog-v7";\n',
    "CHANGELOG.md": "# Changelog\n\nIntro.\n\n## [1.2.3] - 2026-01-01\n\n### Fixed\n- Old.\n",
    "changes/README.md": "How to write a note.\n",
    "changes/fix-b.md": "### Fixed\n- Bee, over\n  two lines.\n",
    "changes/feature-a.md": "### Added\n- Ay.\n\n### Fixed\n- Ay fix.\n",
  });
  assert.strictEqual(bump("1.3.0", { root: dir, date: "2026-02-02" }).notes, 2);
  assert.strictEqual(fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8"),
    "# Changelog\n\nIntro.\n\n## [1.3.0] - 2026-02-02\n\n### Added\n- Ay.\n\n### Fixed\n- Ay fix.\n- Bee, over\n  two lines.\n\n## [1.2.3] - 2026-01-01\n\n### Fixed\n- Old.\n");
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, "changes")), ["README.md"]);
  assert.throws(() => mergeNotes(["### Tweaked\n- x\n"]), /unknown heading/);
});

test("a test build is a pre-release the updater never sees", () => {
  const sh = fs.readFileSync(path.join(ROOT, "tools/test-build.sh"), "utf8");
  assert.ok(sh.includes("--prerelease") && sh.includes('gh pr list --head "$BRANCH" --state open'));
  const app = fs.readFileSync(path.join(ROOT, "src/app.js"), "utf8");
  assert.ok(app.includes('"/releases/latest"'), "the updater must keep reading releases/latest, which skips pre-releases");
  const yml = fs.readFileSync(path.join(ROOT, ".github/workflows/android.yml"), "utf8");
  assert.ok(/needs\.gate\.outputs\.test == 'true'\) && secrets\.ANDROID_KEYSTORE_B64/.test(yml), "the release key signs main and labelled test builds only");
});

test("Test builds lists only test- pre-releases, reading the notes' first lines", () => {
  global.window = { LifeLogPlatform: { native: false } };
  global.document = { querySelector: () => null };
  global.location = { hostname: "localhost", pathname: "/" };
  require("../src/testbuilds.js");
  const T = window.LifeLogTestBuilds;
  const body = "version: 0.299.0\nbranch: feature/x\ncommit: abcdef1234567\npr: 31\n\nA test build of pull request #31.";
  assert.deepStrictEqual(T.notesOf(body), { version: "0.299.0", branch: "feature/x", commit: "abcdef1234567", pr: "31" });
  const r = T.parse([
    { tag_name: "app-v0.298.0", prerelease: false, name: "LifeLog 0.298.0", published_at: "2026-10-31T00:00:00Z", assets: [] },
    { tag_name: "test-feature-x", prerelease: true, name: "Test: Feature X", body, published_at: "2026-11-03T00:00:00Z", assets: [{ name: "LifeLog.apk" }] },
    { tag_name: "nightly", prerelease: true, name: "Something else", assets: [] },
    { tag_name: "test-draft", prerelease: true, draft: true, assets: [] },
  ]);
  assert.strictEqual(r.stable, "0.298.0");
  assert.strictEqual(r.list.length, 1);
  assert.deepStrictEqual([r.list[0].title, r.list[0].branch, r.list[0].sha, r.list[0].pr, r.list[0].apk, r.list[0].ipa], ["Feature X", "feature/x", "abcdef1234567", "31", true, false]);
});

test("sw.js serves a browser's test build from its commit and keeps the release's cache apart", () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.ok(sw.includes('const PREVIEW = "lifelog-preview"'));
  assert.ok(sw.includes("https://raw.githubusercontent.com/"));
  assert.ok(sw.includes('!k.startsWith(PREVIEW)'), "activate must not drop the preview cache");
  assert.ok(sw.includes('url.searchParams.has("release")'), "./?release leaves the preview");
  assert.ok(sw.includes('"./src/testbuilds.js"'));
});

console.log(`\n${passed} passed`);
