// Which browser suites a pull request runs (test/browser/affected.js and
// areas.json): every suite and every src file has a place in the map, and
// anything the map doesn't know runs everything.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pick, suiteNames, AREAS } = require("./browser/affected.js");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

const suites = suiteNames();
const mapped = new Set([...AREAS.always, ...Object.values(AREAS.areas).flatMap((a) => a.suites)]);

test("every browser suite is in an area or runs always", () => {
  assert.deepStrictEqual(suites.filter((s) => !mapped.has(s)), []);
});

test("every suite the map names exists", () => {
  assert.deepStrictEqual([...mapped].filter((s) => !suites.includes(s)), []);
});

test("every src file is in an area or runs everything", () => {
  const known = (f) => AREAS.everything.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p))
    || Object.values(AREAS.areas).some((a) => a.files.includes(f));
  const src = fs.readdirSync(path.join(ROOT, "src")).filter((f) => /\.(js|css)$/.test(f)).map((f) => "src/" + f);
  assert.deepStrictEqual(src.filter((f) => !known(f)), []);
});

test("an area's file runs its suites and the always ones, not the rest", () => {
  const r = pick(["src/travel.js"]);
  assert.ok(Array.isArray(r));
  for (const s of ["travel", "travelmap", "travelmore", ...AREAS.always]) assert.ok(r.includes(s), s);
  assert.ok(!r.includes("boards"));
});

test("a shared file runs everything", () => {
  assert.strictEqual(pick(["src/travel.js", "src/app.js"]), "all");
  assert.strictEqual(pick(["src/styles.css"]), "all");
  assert.strictEqual(pick(["index.html"]), "all");
});

test("a file the map doesn't know runs everything", () => {
  assert.strictEqual(pick(["src/brandnew.js"]), "all");
  assert.strictEqual(pick(["somewhere/else.txt"]), "all");
});

test("docs, the bridge and unit tests run no browser suites", () => {
  assert.strictEqual(pick(["README.md", "bridge/server.js", "test/finance.test.js", "changes/x.md"]), "none");
});

test("a changed suite runs itself", () => {
  const r = pick(["test/browser/boards.js"]);
  assert.ok(r.includes("boards") && r.includes("a11y") && !r.includes("travel"));
});

console.log(`${passed} test(s) passed.`);
