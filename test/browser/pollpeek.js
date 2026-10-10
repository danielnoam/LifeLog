// A poll asks for the folder listing first and reads lifelog.json only when
// its sha moved (0.264.0); a listing that doesn't answer falls back to the
// read. And the error log: an uncaught error shows under Settings → About.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const DATA = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [],
  settings: { currency: "ILS" }, exportedAt: "2026-09-20T10:00:00.000Z",
};

const stub = () => {
  window.__gh = [];
  window.__listing = "ok";
  window.__remoteSha = "abc123";
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (!/api\.github\.com/.test(u)) return real(url, opts);
    const method = (opts && opts.method) || "GET";
    window.__gh.push(method + " " + u.replace(/^https:\/\/api\.github\.com/, ""));
    const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
    if (/\/contents\?ref=/.test(u)) {
      if (window.__listing === "down") return new Response("boom", { status: 500 });
      return json([{ name: "lifelog.json", path: "lifelog.json", sha: window.__remoteSha, type: "file" }]);
    }
    if (/\/contents\/lifelog\.json/.test(u) && method === "GET") {
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(window.__data))));
      return json({ content, sha: window.__remoteSha });
    }
    if (/\/contents\//.test(u) && method === "PUT") return json({ content: { sha: "def456" } });
    if (/\/contents\//.test(u)) return new Response("Not Found", { status: 404 });
    if (/\/commits/.test(u)) return json([]);
    if (/\/user$|\/repos\//.test(u)) return json({ login: "me", default_branch: "main" });
    return json({});
  };
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 460, height: 900 } });
  page.on("pageerror", (e) => { if (!/pollpeek test error/.test(e.message)) errs.push("pageerror: " + e.message); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((data) => {
    localStorage.clear();
    localStorage.setItem("lifelog-github-v1", JSON.stringify({
      owner: "me", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_test", sha: "abc123",
    }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(data));
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" }));
  }, DATA);
  await page.addInitScript(`(${stub.toString()})(); window.__data = ${JSON.stringify(DATA)};`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const poll = async () => {
    await page.evaluate(() => { window.__gh = []; window.dispatchEvent(new Event("online")); });
    await page.waitForTimeout(600);
    return page.evaluate(() => window.__gh.filter((c) => c.startsWith("GET")));
  };
  const reads = (calls) => calls.filter((c) => /contents\/lifelog\.json/.test(c)).length;
  const lists = (calls) => calls.filter((c) => /contents\?ref=/.test(c)).length;

  let calls = await poll();
  check("an unchanged poll asks for the listing", lists(calls) === 1, calls);
  check("and doesn't download the log", reads(calls) === 0, calls);

  await page.evaluate(() => {
    window.__remoteSha = "zzz999";
    window.__data = Object.assign({}, window.__data, { notes: [{ id: "n1", text: "from the other device", createdAt: "2026-10-10T10:00:00.000Z", updatedAt: "2026-10-10T10:00:00.000Z" }] });
  });
  calls = await poll();
  check("a moved sha reads the file", reads(calls) === 1, calls);
  const got = await page.evaluate(() => (window.LifeLogStorage.githubInfo || {}).sha || null);
  check("and takes the new version", await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("lifelog-cache-v1") || "{}");
    return (s.notes || []).some((n) => n.id === "n1");
  }), got);

  await page.evaluate(() => { window.__listing = "down"; });
  calls = await poll();
  check("a listing that fails falls back to reading the file", reads(calls) === 1, calls);

  // ---- the error log ----
  await page.evaluate(() => { setTimeout(() => { throw new Error("pollpeek test error"); }, 0); });
  await page.waitForTimeout(200);
  const logged = await page.evaluate(() => window.LifeLogErrors.list());
  check("an uncaught error is recorded", logged.length === 1 && logged[0].msg.includes("pollpeek test error"), logged);
  check("with the build it happened on", /^\d+\.\d+\.\d+$/.test(logged[0] && logged[0].v), logged);
  check("and the stack it came from", /\bat\b/.test((logged[0] && logged[0].where) || ""), logged);
  await page.evaluate(() => { setTimeout(() => { throw new Error("pollpeek test error"); }, 0); });
  await page.waitForTimeout(200);
  const again = await page.evaluate(() => window.LifeLogErrors.list());
  check("the same error twice is one row, counted", again.length === 1 && again[0].n === 2, again);

  await page.click("#settingsBtn").catch(() => {});
  await page.evaluate(() => window.LifeLogSettings && window.LifeLogSettings.showPage ? window.LifeLogSettings.showPage("about") : document.querySelector('.srow[data-page="about"]').click());
  await page.waitForTimeout(400);
  const shown = await page.evaluate(() => ({
    hint: document.querySelector("#errLogHint").textContent,
    rows: [...document.querySelectorAll("#errLogList .sitem-title")].map((t) => t.textContent),
    actions: !document.querySelector("#errLogActions").hidden,
  }));
  check("About lists it", shown.rows.length === 1 && /pollpeek test error/.test(shown.rows[0]), shown);
  check("with Copy and Clear", shown.actions, shown);
  await page.click("#errLogClearBtn");
  await page.waitForTimeout(200);
  check("Clear empties it", await page.evaluate(() => window.LifeLogErrors.list().length === 0 && document.querySelector("#errLogList").hidden));

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
