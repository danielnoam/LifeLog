// Where the half-second before the first row actually goes.
//
// rowcount.js established that the row count isn't it — a ten-fold dataset
// cut doesn't move time to first row. This one takes the load apart: a
// devtools trace at 4x CPU throttle with script evaluation attributed back to
// the file it came from, init() split into its phases by injected marks, and
// a stubbed run that prices the JS weight itself.
//
//   node test/perf/serve-and-run.js boot
//
// Read it as a ranking, not as absolute times — 4x throttle on a desktop is a
// stand-in for a phone, not a phone. Medians of REPS loads, because a single
// load moves by 50ms between runs and invites the wrong conclusion.
const { chromium, BASE } = require("../browser/harness");

const REPS = 5;

const CATS = [
  { id: "g", name: "Games", color: "#5b8cff" }, { id: "f", name: "Film", color: "#e2554b" },
  { id: "b", name: "Books", color: "#4bc46a" }, { id: "t", name: "TV", color: "#d9a441" },
];
const NAMES = ["Bioshock", "Metro 2033", "Dune", "Hyperion", "Disco Elysium", "Outer Wilds",
  "Annihilation", "The Expanse", "Blame!", "Control", "Celeste", "Hades", "Sable", "Tunic"];

function seedData(n, bl) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    const year = 2019 + (i % 7), month = 1 + (i % 12);
    entries.push({
      id: "e" + i, title: NAMES[i % NAMES.length] + " " + i,
      category: CATS[i % CATS.length].name, year, month,
      date: `${year}-${String(month).padStart(2, "0")}`,
      rating: 1 + (i % 5),
      notes: i % 3 === 0 ? "A few words about it, the kind you'd actually type." : "",
      genres: i % 2 ? ["Action", "RPG"] : ["Drama"],
      length: i % 4 ? (10 + (i % 40)) + "h" : "",
      createdAt: `${year}-${String(month).padStart(2, "0")}-05T00:00:00.000Z`,
    });
  }
  const backlog = [];
  for (let i = 0; i < bl; i++) {
    backlog.push({
      id: "b" + i, title: NAMES[i % NAMES.length] + " BL" + i,
      category: CATS[i % CATS.length].name, priority: i % 9 === 0 ? 1 : 0,
      earlyAccess: i % 11 === 0, releaseStatus: i % 13 === 0 ? "upcoming" : "released",
      releaseDate: i % 13 === 0 ? "2027-05-01" : "", dropped: i % 17 === 0,
      createdAt: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    });
  }
  return { categories: CATS, entries, backlog, notes: [], todos: [], todoCategories: [],
    projects: [], financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {} };
}

// The trace nests: a Layout inside an EvaluateScript is already counted in the
// script's duration. Self time is what each event costs on its own. Only the
// renderer's main thread is aggregated — script parsing happens on a
// background thread and blames the wrong thing if mixed in.
function mainThreadSelfTime(events, splitAtMs) {
  const mainTids = new Set(events
    .filter((e) => e.ph === "M" && e.name === "thread_name" && e.args && e.args.name === "CrRendererMain")
    .map((e) => e.pid + ":" + e.tid));
  const pool = mainTids.size ? events.filter((e) => mainTids.has(e.pid + ":" + e.tid)) : events;
  const done = pool.filter((e) => e.ph === "X" && typeof e.dur === "number")
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const t0 = done.length ? done[0].ts : 0;
  const byName = new Map(), byScript = new Map(), before = new Map(), stack = [];
  for (const e of done) {
    while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
    const node = { end: e.ts + e.dur, self: e.dur };
    if (stack.length) stack[stack.length - 1].self -= e.dur;
    stack.push(node);
    e.__node = node;
  }
  for (const e of done) {
    const ms = e.__node.self / 1000;
    if (ms < 0.01) continue;
    byName.set(e.name, (byName.get(e.name) || 0) + ms);
    // Split at the moment the first rows are on screen: everything after is
    // the idle trickle and the user is already reading.
    if (splitAtMs != null && (e.ts - t0) / 1000 <= splitAtMs) before.set(e.name, (before.get(e.name) || 0) + ms);
    if (/^(EvaluateScript|v8\.compile)$/.test(e.name)) {
      const d = (e.args && e.args.data) || {};
      const url = (d.url || d.fileName || "").replace(/^.*\//, "").replace(/\?.*$/, "") || "(no url)";
      byScript.set(url, (byScript.get(url) || 0) + ms);
    }
  }
  return { byName, byScript, before };
}

// Each of these is planted at a call site the boot path actually runs.
// afterDataChange's body is replaced whole: every line in it appears at three
// call sites, and String.replace would take the first, which is not this one.
const MARKS = [
  ["wire()", "    wire();", "    performance.mark('a'); wire(); performance.measure('wire()', 'a');"],
  ["Storage.load()", "    const result = await Storage.load();",
   "    performance.mark('b'); const result = await Storage.load(); performance.measure('Storage.load()', 'b');"],
  ["normalize()", "      state.data = result.data ? normalize(result.data) : emptyData();",
   "      performance.mark('c'); state.data = result.data ? normalize(result.data) : emptyData(); performance.measure('normalize()', 'c');"],
  ["afterDataChange()", "githubReached = Storage.githubReadOk;\n    afterDataChange();",
   "githubReached = Storage.githubReadOk;\n    performance.mark('d'); afterDataChange(); performance.measure('afterDataChange()', 'd');"],
  ["snapshot clone", "    lastPersistedSnapshot = structuredClone(state.data);\n    if (savedUi",
   "    performance.mark('f'); lastPersistedSnapshot = structuredClone(state.data); performance.measure('snapshot clone', 'f');\n    if (savedUi"],
  ["afterDataChange body",
   "    applyForceLayout();\n    buildYearFilter();\n    buildCatFilter();\n    buildProjectFilter();\n    render();\n  }",
   "    applyForceLayout();\n    performance.mark('g');\n    buildYearFilter();\n    buildCatFilter();\n    buildProjectFilter();\n"
   + "    performance.measure('  ↳ filters', 'g'); performance.mark('e');\n    render();\n"
   + "    performance.measure('  ↳ first render', 'e');\n  }"],
];

// Nothing here is needed to draw the Timeline — every one of them is
// first-use-of-that-tab code. Stubbing them prices the 808KB: the app throws
// once it wants one, which is after every number this run reads.
const NOT_FIRST_PAINT = ["finance.js", "backlog.js", "media.js", "settings.js",
  "sync.js", "io.js", "qr.js", "wheel.js", "notes.js", "todos.js"];

async function boot(browser, { stub = false, trace = false } = {}) {
  // The service worker serves src/*.js from its cache on every visit after the
  // first — the normal case for an installed PWA, and why transferSize reads
  // zero otherwise. Blocked here so the marks can be injected at all.
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1100 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.split("\n")[0]));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "timeline" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.removeItem("lifelog-visual-settings-v1");
  }, seedData(611, 250));

  await page.route("**/src/app.js*", async (route) => {
    let body = await (await route.fetch()).text();
    for (const [label, from, to] of MARKS) {
      if (!body.includes(from)) throw new Error("phase mark did not apply: " + label);
      body = body.replace(from, to);
    }
    route.fulfill({ status: 200, headers: { "content-type": "text/javascript" }, body });
  });
  if (stub) {
    await page.route("**/src/*.js*", (route) => {
      const f = route.request().url().replace(/^.*\//, "").replace(/\?.*$/, "");
      if (!NOT_FIRST_PAINT.includes(f)) return route.fallback();
      route.fulfill({ status: 200, headers: { "content-type": "text/javascript" }, body: "" });
    });
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const events = [];
  let traceDone = Promise.resolve();
  if (trace) {
    cdp.on("Tracing.dataCollected", (d) => events.push(...d.value));
    traceDone = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
    await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "blink.user_timing"] } });
  }

  const t0 = Date.now();
  await page.reload({ waitUntil: "load" });
  let firstRowMs = null;
  try { await page.waitForSelector(".entry", { timeout: 8000 }); firstRowMs = Date.now() - t0; } catch (e) {}
  await page.waitForTimeout(trace ? 3000 : 600);
  if (trace) { await cdp.send("Tracing.end"); await traceDone; }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const out = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const paint = performance.getEntriesByType("paint");
    return {
      responseEnd: +n.responseEnd.toFixed(0),
      domInteractive: +n.domInteractive.toFixed(0),
      domContentLoaded: +n.domContentLoadedEventEnd.toFixed(0),
      firstPaint: paint[0] ? +paint[0].startTime.toFixed(0) : null,
      phases: performance.getEntriesByType("measure")
        .map((m) => ({ name: m.name, start: +m.startTime.toFixed(0), ms: +m.duration.toFixed(1) })),
      resources: performance.getEntriesByType("resource")
        .filter((r) => /\.(js|css)(\?|$)/.test(r.name))
        .map((r) => ({ file: r.name.replace(/^.*\//, "").replace(/\?.*$/, ""),
          ms: +r.duration.toFixed(1), kb: +(r.encodedBodySize / 1024).toFixed(1) })),
    };
  });
  await ctx.close();
  return { ...out, firstRowMs, errs, events };
}

const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? +v[v.length >> 1].toFixed(1) : null; };
const pad = (s, n) => String(s).padEnd(n);

(async () => {
  const browser = await chromium.launch();

  const full = [], stubbed = [];
  for (let i = 0; i < REPS; i++) full.push(await boot(browser, {}));
  for (let i = 0; i < REPS; i++) stubbed.push(await boot(browser, { stub: true }));
  const traced = await boot(browser, { trace: true });
  await browser.close();

  const col = (runs, k) => med(runs.map((r) => r[k]));
  console.log("\n=== the load, medians of " + REPS + " (ms from navigationStart, 4x CPU, 611 entries) ===");
  console.log("  " + pad("", 22) + pad("all 15 scripts", 18) + "first-paint scripts only");
  for (const k of ["responseEnd", "firstPaint", "domInteractive", "domContentLoaded", "firstRowMs"]) {
    console.log("  " + pad(k, 22) + pad(col(full, k), 18) + col(stubbed, k));
  }
  console.log("\n  Stubbed run drops " + NOT_FIRST_PAINT.join(", "));
  console.log("  and throws " + (stubbed[0].errs[0] || "nothing") + " once the app wants one.");

  console.log("\n=== init()'s own phases, medians of " + REPS + " ===");
  const names = [];
  for (const p of full[0].phases) if (!names.includes(p.name)) names.push(p.name);
  for (const n of names) {
    const ms = med(full.map((r) => (r.phases.find((p) => p.name === n) || {}).ms));
    const at = med(full.map((r) => (r.phases.find((p) => p.name === n) || {}).start));
    console.log("  " + pad(n, 22) + String(ms).padStart(7) + " ms   (starts at " + at + "ms)");
  }

  const renderEnd = (() => {
    const r = traced.phases.find((p) => /first render/.test(p.name));
    return r ? r.start + r.ms : null;
  })();
  const { byName, byScript, before } = mainThreadSelfTime(traced.events, renderEnd);
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log("\n=== main-thread self time, one traced load (ms) ===");
  console.log("  " + pad("", 34) + pad("to first rows", 16) + "whole 3s window");
  for (const [k, v] of top(byName, 12)) {
    console.log("  " + pad(k, 34) + pad((before.get(k) || 0).toFixed(1), 16) + v.toFixed(1));
  }
  console.log("\n  (split at " + (renderEnd == null ? "?" : renderEnd.toFixed(0)) + "ms, when the first render returned;"
    + " everything after it is the idle trickle)");
  console.log("\n=== of which, script compile + evaluate by file ===");
  for (const [k, v] of top(byScript, 8)) console.log("  " + pad(k, 34) + v.toFixed(1));

  console.log("\n=== assets (uncompressed body, fetch duration) ===");
  const res = traced.resources.sort((a, b) => b.kb - a.kb);
  for (const r of res) console.log("  " + pad(r.file, 18) + String(r.kb).padStart(8) + " KB " + String(r.ms).padStart(8) + " ms");
  console.log("  " + pad("TOTAL", 18) + res.reduce((a, r) => a + r.kb, 0).toFixed(1).padStart(8) + " KB");
})().catch((e) => { console.error(e); process.exit(1); });
