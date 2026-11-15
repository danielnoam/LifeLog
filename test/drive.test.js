// Zero-dependency tests for src/drive.js, LifeLog's set-up of keel's Drive
// (src/keel/drive.js, tested in keel): the names and keys it gives keel,
// a backup sent as JSON text that becomes `last`, and one read back —
// `node test/drive.test.js`.
const assert = require("assert");

let passed = 0;
const pending = [];
function test(name, fn) {
  const done = () => { passed++; console.log("  ok - " + name); };
  const fail = (e) => { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; };
  try { const r = fn(); if (r && r.then) pending.push(r.then(done, fail)); else done(); } catch (e) { fail(e); }
}

let opts = null;
const fake = { last: {}, sent: null, on: true, async upload(src, info) { fake.sent = { src, info }; return { id: "f1", size: 0 }; },
  async download() { return { text: async () => '{"backupOf":"lifelog","entries":[]}' }; } };
global.window = {
  LifeLogPlatform: { native: false, desktop: false },
  Keel: { drive: { DriveError: class extends Error { constructor(m, c) { super(m); this.code = c; } }, create(o) { opts = o; return fake; } } },
};
require("../src/drive.js");
const D = window.LifeLogDrive;

test("keel's Drive is set up for LifeLog", () => {
  assert.strictEqual(opts.name, "LifeLog");
  assert.strictEqual(opts.tag, "lldrive");
  assert.strictEqual(opts.mime, "application/json");
  assert.deepStrictEqual(Object.keys(opts.keys).sort(), ["ask", "cfg", "hand", "token"]);
  assert.ok(Object.values(opts.keys).every((k) => k.startsWith("lifelog-drive")));
});

test("no backup yet reads as none, not as an empty one", () => {
  assert.strictEqual(D.last, null);
});

test("a backup goes as JSON text and becomes `last`", async () => {
  const out = await D.upload('{"a":1}', "Windows");
  assert.deepStrictEqual(fake.sent, { src: { text: '{"a":1}' }, info: { device: "Windows" } });
  assert.strictEqual(out.id, "f1");
  assert.strictEqual(out.size, 7, "Drive's size, or the text's when it gives none");
  assert.strictEqual(fake.last, out);
  assert.strictEqual(D.last, out);
});

test("a backup comes back parsed", async () => {
  assert.deepStrictEqual(await D.download("f1"), { backupOf: "lifelog", entries: [] });
});

Promise.all(pending).then(() => console.log(`\n${passed} passed`));
