// Zero-dependency tests for src/jobs.js, the queue the long work runs on
// (0.244.0) — run with `node test/jobs.test.js`. Async, so each test is
// awaited in turn.
const assert = require("assert");
global.window = {};
require("../src/jobs.js");
const J = global.window.LifeLogJobs;

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}
const byLabel = (l) => J.list().find((j) => j.label === l);

(async () => {
  await test("jobs in one lane go one after another, other lanes alongside", async () => {
    const order = [];
    const a = J.run({ label: "A", lane: "steam" }, async (job) => { order.push("a start"); await job.sleep(30); order.push("a end"); return 1; });
    const b = J.run({ label: "B", lane: "steam" }, async () => { order.push("b"); return 2; });
    const c = J.run({ label: "C", lane: "media" }, async () => { order.push("c"); return 3; });
    assert.strictEqual(byLabel("B").state, "queued");
    assert.strictEqual(byLabel("C").state, "running");
    assert.deepStrictEqual([await a, await b, await c], [1, 2, 3]);
    assert.deepStrictEqual(order, ["a start", "c", "a end", "b"]);
  });

  await test("a stop keeps what the loop did, and the job reads as stopped", async () => {
    const run = J.run({ label: "D", lane: "z" }, async (job) => {
      let i = 0;
      for (; i < 100 && !job.stopping; i++) { job.progress(i, 100); await job.sleep(10); }
      return i;
    });
    setTimeout(() => byLabel("D").stop(), 35);
    const got = await run;
    assert.ok(got > 0 && got < 100, "stopped partway: " + got);
    assert.strictEqual(byLabel("D").state, "stopped");
  });

  await test("a stop aborts the job's signal, so a fetch in flight ends", async () => {
    let aborted = false;
    const run = J.run({ label: "Sig" }, (job) => new Promise((resolve, reject) => {
      job.signal.addEventListener("abort", () => { aborted = true; reject(new Error("AbortError")); });
    }));
    byLabel("Sig").stop();
    assert.strictEqual(await run, undefined);
    assert.ok(aborted);
    assert.strictEqual(byLabel("Sig").state, "stopped");
  });

  await test("a throw fails the job with its message and reaches the caller", async () => {
    const err = await J.run({ label: "E" }, async () => { throw new Error("Steam answered 429"); }).catch((e) => e.message);
    assert.strictEqual(err, "Steam answered 429");
    assert.strictEqual(byLabel("E").state, "failed");
    assert.strictEqual(byLabel("E").result, "Steam answered 429");
  });

  await test("a job stopped while waiting never runs", async () => {
    let ran = false;
    const first = J.run({ label: "F1", lane: "q" }, (job) => job.sleep(20));
    const second = J.run({ label: "F2", lane: "q" }, async () => { ran = true; });
    byLabel("F2").stop();
    assert.strictEqual(await second, undefined);
    await first;
    assert.ok(!ran);
    assert.strictEqual(byLabel("F2").result, "Stopped before it started");
  });

  await test("a save can't be stopped, and an unlisted job stays out of the list", async () => {
    const job = J.begin({ label: "Saving to GitHub", listed: false, stoppable: false });
    job.stop();
    assert.strictEqual(job.state, "running");
    assert.ok(!J.visible().includes(job));
    assert.ok(J.active().includes(job));
    job.finish();
    assert.strictEqual(job.state, "done");
  });

  await test("time left comes from the pace so far, once there is one", async () => {
    const job = J.begin({ label: "Eta" });
    job.progress(0, 10);
    assert.strictEqual(J.eta(job), null);
    job.startedAt = Date.now() - 10000;
    job.progress(5, 10);
    const left = J.eta(job);
    assert.ok(left > 9000 && left < 11000, String(left));
    job.finish("ok");
  });

  await test("only the last finished jobs are kept, and clearing keeps what's running", async () => {
    for (let i = 0; i < 20; i++) J.begin({ label: "old" + i }).finish();
    assert.ok(J.list().filter((j) => j.state === "done").length <= 15);
    const live = J.begin({ label: "live" });
    J.clearFinished();
    assert.deepStrictEqual(J.list().map((j) => j.label), ["live"]);
    live.finish();
  });

  await test("the phone is told what's going on while anything is, and let go after", async () => {
    const calls = [];
    window.LifeLogPlatform = { native: true, plugin: () => ({
      holdBackground: (s) => { calls.push(["hold", s.title, s.text]); return Promise.resolve(); },
      releaseBackground: () => { calls.push(["release"]); return Promise.resolve(); },
    }) };
    const job = J.begin({ label: "Syncing Steam Wishlist" });
    job.progress(3, 40);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(calls[0], ["hold", "Syncing Steam Wishlist", "3 of 40"]);
    job.finish();
    assert.deepStrictEqual(calls[calls.length - 1], ["release"]);
    delete window.LifeLogPlatform;
  });

  console.log(`\n${passed} passed`);
})();
