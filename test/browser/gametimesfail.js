// Game times when the lookup fails (0.282.3): a game whose lookup failed
// waits a day instead of being asked again on every launch, three failures
// in a row stop the run and say why in Activity, and a game Augmented Steam
// doesn't know (its JSON 404) counts as an answer.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const seed = () => ({
  categories: [{ name: "Games", color: "#3fb950" }], entries: [],
  backlog: Array.from({ length: 6 }, (_, i) => ({ id: "b" + i, title: "Game " + i, category: "Games", mediaSource: "steam", mediaId: String(100 + i), createdAt: "2026-01-01T00:00:00.000Z" })),
  notes: [], accomplishments: {}, habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: { steam: { proxyUrl: "https://proxy.test" } },
});

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  let mode = "down";
  const asked = [];
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.route("https://proxy.test/**", (r) => {
    const id = r.request().url().split("/").pop();
    asked.push(id);
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (mode === "down") return r.fulfill({ status: 502, headers: cors, contentType: "application/json", body: "{}" });
    if (id === "103") return r.fulfill({ status: 404, headers: cors, contentType: "application/json", body: '{"error":"not found"}' });
    r.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ hltb: { story: 600, extras: 900, complete: 1200 } }) });
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify(s)); }, seed());
  const launch = async () => { asked.length = 0; await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(3500); };
  const job = () => page.evaluate(() => window.LifeLogJobs.list().filter((j) => /How Long to Beat/.test(j.label)).map((j) => j.state + ": " + (j.result || j.error || "")).join(" | "));

  // ---- the route is down ----
  await launch();
  check("three failures in a row stop the run", asked.length === 3, asked);
  const j = await job();
  check("and Activity says it failed, with why", /failed/.test(j) && /Couldn't reach Augmented Steam: HTTP 502/.test(j), j);
  await launch();
  check("the next launch skips the three that just failed and tries the rest", asked.length === 3 && !asked.some((id) => ["100", "101", "102"].includes(id)), asked);

  // ---- a day later, with the route back ----
  mode = "up";
  await page.evaluate(() => {
    const k = "lifelog-gametimes-v1", all = JSON.parse(localStorage.getItem(k) || "{}");
    for (const id of Object.keys(all)) all[id] = "f:2020-01-01";
    localStorage.setItem(k, JSON.stringify(all));
  });
  await launch();
  check("once the day is up they're all asked again", asked.length === 6, asked);
  const items = await page.evaluate(() => window.LifeLogStorage.cachedCopy().backlog);
  check("and the answers land", items.filter((x) => x.hltb && x.hltb.story === 600).length === 5, items.map((x) => x.hltb));
  const misses = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-gametimes-v1") || "{}"));
  check("a game Augmented Steam doesn't know is a miss, not a failure", /^\d{4}-\d{2}-\d{2}$/.test(misses["103"] || ""), misses);
  await launch();
  check("and the launch after asks nothing", asked.length === 0, asked);

  await b.close();
  done(errs);
})();
