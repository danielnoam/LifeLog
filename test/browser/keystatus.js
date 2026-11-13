// Settings → Media lookups: each key shows whether it works (checked when
// the page opens and again after an edit), and the setup links are links.
// Every service is answered here, one per state, so nothing leaves the
// machine. RAWG never answers, like its week-long outage in November 2026.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };
const SHOTS = process.env.SHOTS || "";

const SEED = {
  categories: [], backlog: [], entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [],
  settings: {
    mediaKeys: { rawg: "rk", tmdb: "tk", ggdeals: "gk", steamgriddb: "sk", igdb: "clientid123", googlePlaces: "", nyt: "nk", tiingo: "ik" },
    steam: { proxyUrl: "https://proxy.lifelog.test" },
  },
};

async function run(b, viewport, name) {
  const page = await b.newPage({ viewport, deviceScaleFactor: SHOTS ? 2 : 1 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const asked = [];
  const reply = (route, status, body) => route.fulfill({
    status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" }, body: JSON.stringify(body),
  });
  await page.route(/api\.rawg\.io|themoviedb|proxy\.lifelog\.test|nytimes|googleapis/, (route) => {
    const url = route.request().url();
    if (route.request().method() === "OPTIONS") return reply(route, 204, {});
    asked.push(url);
    if (url.includes("api.rawg.io")) return; // never answers
    if (url.includes("themoviedb")) return reply(route, 200, { images: {} });
    if (url.includes("/gg-deals")) return reply(route, 200, { success: true, data: {} });
    if (url.includes("/steamgriddb/")) return reply(route, 401, { success: false, errors: ["Invalid API key"] });
    if (url.includes("/tiingo-meta/")) return reply(route, 200, { ticker: "SPY", name: "SPDR S&P 500 ETF" });
    if (url.includes("nytimes")) return reply(route, 429, { fault: { faultstring: "Rate limit quota violation" } });
    return reply(route, 404, {});
  });
  // The real timeout is 15s; the page's own AbortSignal.timeout is shortened
  // so the hang reads as "No answer" without the suite waiting for it.
  await page.addInitScript(() => {
    const t = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms) => t(Math.min(ms, 1500));
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)), SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.LifeLogSettings.openSettings("media"));
  await page.waitForFunction(() => document.querySelector('[data-key-status="rawg"]').classList.contains("key-down"), null, { timeout: 6000 }).catch(() => {});
  const status = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-key-status]")]
    .map((n) => [n.dataset.keyStatus, n.hidden ? "" : n.className.replace("key-status key-", "") + ":" + n.textContent.trim()])));
  check(name + ": each key shows its own state", JSON.stringify(status) === JSON.stringify({
    rawg: "down:No answer", tmdb: "ok:Working", ggdeals: "ok:Working", steamgriddb: "bad:Key refused", igdb: "warn:Needs the secret", googlePlaces: "", nyt: "warn:Limit reached", tiingo: "ok:Working",
  }), status);
  const links = await page.evaluate(() => [...document.querySelectorAll('.settings-page[data-page="media"] .sitem-stack .sitem-sub a')].map((a) => a.href));
  check(name + ": every key's setup page is a link", links.length === 8 && links.every((h) => h.startsWith("https://")), links);
  if (SHOTS) {
    await page.evaluate(() => document.querySelector('[data-key-status="rawg"]').closest(".sgroup").scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + "/key-status-" + name + ".png" });
  }

  // An edit re-checks after a pause, and a working key isn't asked twice.
  const before = asked.length;
  await page.fill("#steamgriddbKey", "sk2");
  await page.waitForTimeout(1800);
  check(name + ": a changed key is checked again", asked.slice(before).filter((u) => u.includes("/steamgriddb/")).length === 1, asked.slice(before));
  await page.evaluate(() => { window.LifeLogSettings.openSettings(""); window.LifeLogSettings.openSettings("media"); });
  await page.waitForTimeout(400);
  check(name + ": a working key is remembered", !asked.slice(before).some((u) => u.includes("themoviedb")), asked.slice(before));
  check(name + ": no page errors", !errs.length, errs);
  await page.close();
}

(async () => {
  const b = await chromium.launch();
  await run(b, { width: 1280, height: 900 }, "desktop");
  await run(b, { width: 375, height: 812 }, "phone");
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
