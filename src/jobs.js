// LifeLog — the work that takes a while (0.244.0): imports, re-checks,
// backfills, bulk syncs, saves to GitHub. Each one runs as a job here, so
// there is one place that knows what is going on, how far along it is, and
// how to stop it, and the Activity sheet (app.js) only has to draw that.
//
// A job's lane is what it leans on (Steam, the media sites, Google). Jobs in
// the same lane run one after another, since the sites behind them
// rate-limit and two passes at once only fail each other; different lanes
// run side by side. A job without a lane starts at once.
//
// On a phone, while anything is queued or running, the app asks to keep
// working when it is put away: Android runs a foreground service with a
// notification (its only way to keep a backgrounded app's process from being
// frozen), iOS gives about 30 seconds. See holdBackground in the Widgets
// plugin.
//
// Stopping is cooperative: a job's loop checks `stopping` between items and
// keeps what it already did. `signal` aborts a fetch in flight, `sleep`
// cuts its wait short.
(function () {
  const KEEP_FINISHED = 15;
  const BACKGROUND_EVERY_MS = 1000;
  const ACTIVE = new Set(["queued", "running"]);

  let seq = 0;
  const jobs = [];
  const listeners = new Set();

  function emit() {
    for (const fn of listeners) { try { fn(); } catch (e) { /* a listener's own problem */ } }
    background();
  }

  function trim() {
    const finished = jobs.filter((j) => !ACTIVE.has(j.state));
    for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) {
      jobs.splice(jobs.indexOf(j), 1);
    }
  }

  function make(spec) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const job = {
      id: ++seq,
      label: spec.label || "Working",
      lane: spec.lane || "",
      listed: spec.listed !== false,
      stoppable: spec.stoppable !== false,
      state: "queued",
      done: 0, total: 0, detail: "",
      result: "", failed: false,
      queuedAt: Date.now(), startedAt: 0, endedAt: 0,
      stopping: false,
      signal: ctl ? ctl.signal : undefined,
      progress(done, total, detail) {
        if (!ACTIVE.has(job.state)) return;
        job.done = done;
        if (total != null) job.total = total;
        if (detail != null) job.detail = detail;
        emit();
      },
      note(detail) { job.progress(job.done, null, detail); },
      // A pause between requests that a Stop cuts short.
      sleep(ms) {
        return new Promise((resolve) => {
          if (job.stopping) return resolve();
          const t = setTimeout(done, ms);
          function done() { clearTimeout(t); if (job.signal) job.signal.removeEventListener("abort", done); resolve(); }
          if (job.signal) job.signal.addEventListener("abort", done);
        });
      },
      finish(result) { end(job, job.stopping ? "stopped" : "done", result); },
      fail(err) { end(job, job.stopping ? "stopped" : "failed", messageOf(err)); },
      stop() {
        if (!ACTIVE.has(job.state) || !job.stoppable || job.stopping) return;
        job.stopping = true;
        if (ctl) ctl.abort();
        if (job.state === "queued") { end(job, "stopped", "Stopped before it started"); return; }
        emit();
      },
    };
    jobs.push(job);
    return job;
  }

  function messageOf(err) {
    if (!err) return "";
    if (typeof err === "string") return err;
    return err.message || String(err);
  }

  function end(job, outcome, result) {
    if (!ACTIVE.has(job.state)) return;
    job.state = outcome;
    job.failed = outcome === "failed";
    if (result != null && result !== "") job.result = result;
    job.endedAt = Date.now();
    if (job.wake) { const w = job.wake; job.wake = null; w(); }
    trim();
    emit();
    pump();
  }

  function start(job) {
    job.state = "running";
    job.startedAt = Date.now();
    emit();
  }

  const laneBusy = (lane) => jobs.some((j) => j.lane === lane && j.state === "running");

  // Starts whatever queued job's lane has come free, oldest first.
  function pump() {
    for (const j of jobs) {
      if (j.state !== "queued" || !j.wake) continue;
      if (j.lane && laneBusy(j.lane)) continue;
      const w = j.wake;
      j.wake = null;
      start(j);
      w();
    }
  }

  // Runs work(job) once its lane is free and returns what work returned, or
  // undefined if it was stopped while queued. A throw is the job failing
  // (a Stop's abort is the job stopping), and is passed on to the caller.
  async function run(spec, work) {
    const job = make(spec);
    if (job.lane && laneBusy(job.lane)) {
      emit();
      await new Promise((resolve) => { job.wake = resolve; });
      if (job.state !== "running") return undefined;
    } else {
      start(job);
    }
    try {
      const out = await work(job);
      job.finish();
      return out;
    } catch (e) {
      job.fail(e);
      if (job.state === "stopped") return undefined;
      throw e;
    }
  }

  // For work whose start and end live in different places (the bulk syncs):
  // running at once, ended by its own finish() or fail().
  function begin(spec) {
    const job = make(spec);
    start(job);
    return job;
  }

  const list = () => jobs.slice();
  const active = () => jobs.filter((j) => ACTIVE.has(j.state));
  const visible = () => jobs.filter((j) => j.listed);
  function busy(lane) { return jobs.some((j) => j.lane === lane && ACTIVE.has(j.state)); }
  function stopAll() { for (const j of active()) j.stop(); }
  function clearFinished() {
    for (let i = jobs.length - 1; i >= 0; i--) if (!ACTIVE.has(jobs[i].state)) jobs.splice(i, 1);
    emit();
  }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // How long is left, from the pace so far; null until there's a pace.
  function eta(job, now = Date.now()) {
    if (job.state !== "running" || !job.total || job.done < 1 || job.done >= job.total) return null;
    const spent = now - job.startedAt;
    if (spent < 2000) return null;
    return Math.round((spent / job.done) * (job.total - job.done));
  }

  // ---------- keeping the phone app working while it's put away ----------
  let held = false, lastSent = 0, sendTimer = null;
  const plugin = () => {
    const P = window.LifeLogPlatform;
    return (P && P.native && P.plugin("Widgets")) || null;
  };
  function summary() {
    const now = active();
    const running = now.filter((j) => j.state === "running");
    const lead = running.find((j) => j.listed) || running[0] || now[0];
    if (!lead) return null;
    const others = now.length - 1;
    let text = lead.total ? `${lead.done} of ${lead.total}` : (lead.detail || "Working…");
    if (others > 0) text += ` · ${others} more`;
    return { title: lead.label, text, done: lead.done, total: lead.total || 0 };
  }
  function background() {
    const W = plugin();
    if (!W || typeof W.holdBackground !== "function") return;
    const want = active().length > 0;
    if (!want) {
      clearTimeout(sendTimer); sendTimer = null;
      if (held) { held = false; Promise.resolve(W.releaseBackground()).catch(() => {}); }
      return;
    }
    const wait = held ? Math.max(0, lastSent + BACKGROUND_EVERY_MS - Date.now()) : 0;
    if (sendTimer) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      const s = summary();
      if (!s) return;
      held = true;
      lastSent = Date.now();
      Promise.resolve(W.holdBackground(s)).catch(() => {});
    }, wait);
  }
  function wireNative() {
    const W = plugin();
    if (W && typeof W.addListener === "function") {
      try { W.addListener("stopWork", () => stopAll()); } catch (e) { /* older build */ }
    }
  }
  if (typeof document !== "undefined" && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireNative);
  } else {
    wireNative();
  }

  window.LifeLogJobs = { run, begin, list, active, visible, busy, stopAll, clearFinished, subscribe, eta, summary };
})();
