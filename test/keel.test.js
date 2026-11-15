// keel: the shared files are as keel released them (`node test/keel.test.js`).
// A failure here means a file from keel was edited in this app: move the
// change into keel, tag a release and run tools/keel-sync.js, or undo it.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { check } = require("../tools/keel-sync.js");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + e.message); }
}

if (fs.existsSync(path.join(ROOT, "keel.lock.json"))) {
  test("the shared files match keel.lock.json", () => {
    const r = check(ROOT);
    assert.deepStrictEqual(r.changed, [], "edited here: " + r.changed.join(", "));
    assert.deepStrictEqual(r.missing, [], "missing: " + r.missing.join(", "));
  });
} else {
  // keel itself: every file it lists is there to be synced.
  test("every file in keel.files.json exists", () => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, "keel.files.json"), "utf8"));
    const missing = list.files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
    assert.deepStrictEqual(missing, []);
  });
}
console.log(passed + " passed");
