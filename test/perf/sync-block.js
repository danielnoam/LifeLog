// The finding boot.js could not see: init() awaits Storage.load() before it
// renders anything, and Storage.load() goes to GitHub first when sync is
// connected. So for a synced user — which is the real user — time to first
// row includes a full GitHub round-trip, on top of everything else.
//
//   node test/perf/serve-and-run.js sync-block
//
// Measured by connecting a fake sync config and answering api.github.com
// after a fixed delay, so the network is the only variable.
const { chromium, BASE } = require("../browser/harness");

const CATS = [{ id: "g", name: "Games", color: "#5b8cff" }, { id: "f", name: "Film", color: "#e2554b" }];
function seedData(n) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    const year = 2019 + (i % 7), month = 1 + (i % 12);
    entries.push({ id: "e" + i, title: "Thing " + i, category: CATS[i % 2].name, year, month,
      date: `${year}-${String(month).padStart(2, "0")}`, rating: 1 + (i % 5),
      createdAt: `${year}-${String(month).padStart(2, "0")}-05T00:00:00.000Z` });
  }
  return { categories: CATS, entries, backlog: [], notes: [], todos: [], todoCategories: [],
    projects: [], financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {},
    exportedAt: "2026-09-01T00:00:00.000Z" };
}

async function run(browser, { connected, latencyMs, idb }) {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1100 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const data = seedData(611);
  await page.evaluate(({ seed, connected }) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "timeline" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.removeItem("lifelog-visual-settings-v1");
    if (connected) {
      localStorage.setItem("lifelog-github-v1", JSON.stringify({
        owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake", sha: "abc",
      }));
    } else localStorage.removeItem("lifelog-github-v1");
  }, { seed: data, connected });

  // Answer GitHub with the same copy the cache holds, after a set delay —
  // a hit on a warm connection, not a worst case.
  await page.route("https://api.github.com/**", async (route) => {
    await new Promise((r) => setTimeout(r, latencyMs));
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      sha: "abc", content: Buffer.from(JSON.stringify(data)).toString("base64"), encoding: "base64",
    }) });
  });

  // Mark the moment rows exist, from inside the page — waitForSelector's
  // polling adds a few hundred ms of its own and would swamp the effect.
  await page.addInitScript(() => {
    const tick = () => {
      if (document.querySelector(".entry")) { window.__firstRow = performance.now(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (idb === false) await page.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__firstRow != null, null, { timeout: 15000 });
  const ms = await page.evaluate(() => Math.round(window.__firstRow));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await ctx.close();
  return ms;
}

const med = (xs) => { const v = xs.slice().sort((a, b) => a - b); return v[v.length >> 1]; };

(async () => {
  const browser = await chromium.launch();
  const cases = [
    ["sync off (the measurement boot.js made)", { connected: false, latencyMs: 0 }],
    ["sync on, GitHub answers in  50ms", { connected: true, latencyMs: 50 }],
    ["sync on, GitHub answers in 150ms", { connected: true, latencyMs: 150 }],
    ["sync on, GitHub answers in 400ms", { connected: true, latencyMs: 400 }],
    ["sync off, File System API absent", { connected: false, latencyMs: 0, idb: false }],
  ];
  console.log("\ntime to first row, ms from navigationStart (4x CPU, 611 entries, median of 3)\n");
  for (const [label, opts] of cases) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await run(browser, opts));
    console.log("  " + label.padEnd(40) + String(med(runs)).padStart(6) + " ms   " + runs.join(" / "));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
