// Zero-dependency tests for src/drive.js's pure parts: which backups are
// kept, when one is due, the file name, Drive's list read as rows, the
// multipart body, Google's errors and the PKCE challenge —
// `node test/drive.test.js`.
const assert = require("assert");
global.window = {};
const D = require("../src/drive.js");

let passed = 0;
const pending = [];
function test(name, fn) {
  const done = () => { passed++; console.log("  ok - " + name); };
  const fail = (e) => { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; };
  try { const r = fn(); if (r && r.then) pending.push(r.then(done, fail)); else done(); } catch (e) { fail(e); }
}

const DAY = D.DAY;
const NOW = Date.UTC(2026, 10, 15, 9);
const at = (days) => ({ id: "f" + days, at: NOW - days * DAY });

test("keeps the newest three when backups are weekly or rarer", () => {
  const all = [0, 7, 14, 21, 28].map(at);
  assert.deepStrictEqual([...D.toKeep(all, 7)].map((f) => f.id), ["f0", "f7", "f14"]);
});

test("daily backups keep one a week old as well", () => {
  const all = [0, 1, 2, 3, 4, 8, 9].map(at);
  assert.deepStrictEqual([...D.toKeep(all, 1)].map((f) => f.id), ["f0", "f1", "f2", "f8"]);
});

test("nothing to keep from nothing", () => {
  assert.strictEqual(D.toKeep([], 1).size, 0);
});

test("due after `every` days from the last backup, or from connecting", () => {
  assert.strictEqual(D.isDue(null, NOW), false);
  assert.strictEqual(D.isDue({ auto: false, every: 1, since: NOW - 30 * DAY }, NOW), false);
  assert.strictEqual(D.isDue({ auto: true, every: 7, since: NOW - 6 * DAY }, NOW), false);
  assert.strictEqual(D.isDue({ auto: true, every: 7, since: NOW - 7 * DAY }, NOW), true);
  assert.strictEqual(D.isDue({ auto: true, every: 3, since: NOW - 30 * DAY, last: { at: NOW - 2 * DAY } }, NOW), false);
  assert.strictEqual(D.isDue({ auto: true, every: 1, last: { at: NOW - DAY + 1800 * 1000 } }, NOW), true, "an hour's slack, so a daily one doesn't slip a day");
  assert.strictEqual(D.isDue({ auto: true, every: 5, since: NOW - 6 * DAY }, NOW), false, "an unknown interval reads as weekly");
});

test("the file name carries the date and time", () => {
  assert.strictEqual(D.backupName(new Date(2026, 0, 5, 7, 3)), "lifelog-2026-01-05-0703.json");
});

test("Drive's files read as rows, newest first", () => {
  const rows = D.readList([
    { id: "a", name: "old", size: "10", createdTime: "2026-11-01T10:00:00Z", appProperties: { device: "Pixel" } },
    { id: "b", name: "new", size: "20", createdTime: "2026-11-10T10:00:00Z" },
  ]);
  assert.deepStrictEqual(rows.map((r) => [r.id, r.size, r.from]), [["b", 20, ""], ["a", 10, "Pixel"]]);
  assert.deepStrictEqual(D.readList(undefined), []);
});

test("the multipart body has the details, then the file", () => {
  const body = D.multipart({ name: "x.json" }, '{"a":1}', "CUT");
  assert.ok(body.startsWith("--CUT\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{\"name\":\"x.json\"}\r\n--CUT\r\n"));
  assert.ok(body.endsWith('{"a":1}\r\n--CUT--\r\n'));
});

test("Google's errors read in plain words", () => {
  assert.strictEqual(D.failure(401, null).code, "signin");
  assert.strictEqual(D.failure(403, { error: { errors: [{ reason: "storageQuotaExceeded" }] } }).code, "full");
  assert.strictEqual(D.failure(404, null).code, "gone");
  const e = D.failure(500, null);
  assert.ok(e instanceof D.DriveError);
  assert.strictEqual(e.code, "500");
});

test("the PKCE challenge is the verifier's SHA-256 in base64url", async () => {
  const v = "dBjftJeZ4CVP-mB92K-uz5jkLvwZ7KMSbPUa9DHPbVM";
  assert.strictEqual(await D.challengeOf(v), require("crypto").createHash("sha256").update(v).digest("base64url"));
});

Promise.all(pending).then(() => console.log(`\n${passed} passed`));
