const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const DATA = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [],
  settings: { currency: "ILS" }, exportedAt: "2026-09-20T10:00:00.000Z",
};

// `mode` decides what api.github.com does to the contents GET.
const stub = (mode) => {
  window.__gh = [];
  const real = window.fetch.bind(window);
  let getN = 0;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (!/api\.github\.com/.test(u)) return real(url, opts);
    const method = (opts && opts.method) || "GET";
    window.__gh.push(method + " " + u.replace(/^https:\/\/api\.github\.com/, ""));
    const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
    if (/\/contents\//.test(u) && method === "GET") {
      getN++;
      if (mode === "missing") return new Response("Not Found", { status: 404 });
      if (mode === "blip" && getN === 1) return new Response("boom", { status: 500 });
      if (mode === "down") return new Response("boom", { status: 500 });
      if (mode === "badtoken") return new Response("bad creds", { status: 401 });
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(window.__data))));
      return json({ content, sha: "abc123" });
    }
    if (/\/contents\//.test(u) && method === "PUT") return json({ content: { sha: "def456" } });
    if (/\/commits/.test(u)) return json([]);
    if (/\/user$|\/repos\//.test(u)) return json({ login: "me", default_branch: "main" });
    return json({});
  };
};

const boot = async (page, mode) => {
  await page.evaluate(({ mode, data }) => {
    localStorage.setItem("lifelog-github-v1", JSON.stringify({
      owner: "me", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_test", sha: "abc123",
    }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(data));
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" }));
    window.__bootMode = mode;
    window.__data = data;
  }, { mode, data: DATA });
  await page.addInitScript(`(${stub.toString()})(${JSON.stringify(mode)}); window.__data = ${JSON.stringify(DATA)};`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  return page.evaluate(() => ({
    toasts: [...document.querySelectorAll(".toast, #toast")].map((t) => t.textContent).filter(Boolean),
    status: (document.querySelector(".storage-status") || {}).className || "",
    statusText: (document.querySelector(".storage-status") || {}).textContent || "",
    ghCalls: window.__gh || [],
    readOk: window.LifeLogStorage ? window.LifeLogStorage.githubReadOk : null,
  }));
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 460, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });

  // ---- the reported symptom: warned we're offline, status says synced ----
  let r = await boot(page, "missing");
  const offlineToast = (r2) => r2.toasts.some((t) => /Offline/i.test(t));
  check("a repo with no data file yet does NOT warn about being offline",
    !offlineToast(r), r.toasts);
  check("because GitHub answered — 404 is an answer", r.readOk === true, r);
  check("and the status agrees rather than contradicting a warning",
    /connected/.test(r.status) && /Synced to/.test(r.statusText), r);

  // ---- one blip on the load fetch ----
  await page.evaluate(() => { document.querySelectorAll(".toast, #toast").forEach((t) => t.remove()); });
  r = await boot(page, "blip");
  check("a single transient failure is retried instead of warned about",
    !offlineToast(r), r.toasts);
  check("the retry actually happened", r.ghCalls.filter((c) => /^GET \/repos.*contents/.test(c)).length >= 2, r.ghCalls);
  check("and it ends up reaching GitHub", r.readOk === true, r);

  // ---- genuinely unreachable: the warning must still fire ----
  // A GitHub answering 500 twice. Until 0.173.1 the warning here said
  // "Offline", which is what made a data file past 1MB undiagnosable: every
  // failure that reached GitHub was reported as not having reached it. It
  // still warns; it now says what happened.
  await page.evaluate(() => { document.querySelectorAll(".toast, #toast").forEach((t) => t.remove()); });
  r = await boot(page, "down");
  check("a GitHub that stays down still warns, and doesn't call it being offline",
    r.toasts.some((t) => /Couldn't read from GitHub/.test(t)) && !offlineToast(r), r.toasts);
  check("and says so rather than claiming it was reached", r.readOk === false, r);

  // ---- a rejected token is a decision, not a blip ----
  await page.evaluate(() => { document.querySelectorAll(".toast, #toast").forEach((t) => t.remove()); });
  r = await boot(page, "badtoken");
  check("a rejected token is not retried", r.ghCalls.filter((c) => /^GET \/repos.*contents/.test(c)).length === 1, r.ghCalls);
  check("and the status names it instead of blaming the network",
    /rejected your token/i.test(r.statusText), r.statusText);

  // ---- the happy path is unchanged ----
  await page.evaluate(() => { document.querySelectorAll(".toast, #toast").forEach((t) => t.remove()); });
  r = await boot(page, "ok");
  check("a normal load warns about nothing", !offlineToast(r), r.toasts);
  check("reads GitHub exactly once", r.ghCalls.filter((c) => /^GET \/repos.*contents/.test(c)).length === 1, r.ghCalls);
  check("and shows synced", /connected/.test(r.status) && /Synced to/.test(r.statusText), r);

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
