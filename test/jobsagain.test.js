// src/jobs.js across an app kill (0.245.0): a pass with `again` is noted
// while it runs, and the next page finds the note and offers it again.
// Its own file, since the leftovers are read once, as jobs.js loads.
const assert = require("assert");
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
// What a page that was killed mid-pass left behind.
store["lifelog-jobs-running-v1"] = JSON.stringify([{ page: "old", id: 3, again: "steamRetry", label: "Retrying unresolved Steam titles", at: 1 }]);
global.window = {};
require("../src/jobs.js");
const J = global.window.LifeLogJobs;

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}

(async () => {
  await test("a pass left running by a killed app is offered once its runner is known", async () => {
    assert.strictEqual(J.unfinished().length, 0, "nothing to run it with yet");
    let ran = 0;
    J.onAgain("steamRetry", () => { ran++; });
    assert.strictEqual(J.unfinished().length, 1);
    assert.strictEqual(J.unfinished()[0].label, "Retrying unresolved Steam titles");
    assert.ok(!store["lifelog-jobs-running-v1"], "the old page's note is let go");
    J.runAgain(J.unfinished()[0]);
    assert.strictEqual(ran, 1);
    assert.strictEqual(J.unfinished().length, 0);
  });

  await test("a pass with `again` is noted while it runs and forgotten when it ends", async () => {
    let seen = null;
    await J.run({ label: "Re-checking release dates", again: "releases" }, async () => {
      seen = JSON.parse(store["lifelog-jobs-running-v1"]);
    });
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].again, "releases");
    assert.ok(!store["lifelog-jobs-running-v1"]);
    await J.run({ label: "No again" }, async () => { assert.ok(!store["lifelog-jobs-running-v1"]); });
  });

  await test("a failed or stopped pass isn't offered again either", async () => {
    await J.run({ label: "F", again: "releases" }, async () => { throw new Error("x"); }).catch(() => {});
    assert.ok(!store["lifelog-jobs-running-v1"]);
  });

  console.log(`\n${passed} passed`);
})();
