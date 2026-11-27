// A sync landing while you type redraws the page under you, and used to take
// the caret (and a phone's keyboard) with it. The field you were in keeps
// focus, the caret stays where it was, and what you typed stays typed.
const { chromium, BASE, forgetCopy } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const T = "2026-01-01T00:00:00.000Z";
const DATA = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], projects: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [],
  notes: [{ id: "L", kind: "list", text: "Shopping", createdAt: T, updatedAt: T, items: [{ id: "a", text: "Apples" }] }],
  settings: { currency: "ILS" }, exportedAt: "2026-09-20T10:00:00.000Z",
};

const stub = () => {
  window.__remoteSha = "abc123";
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (!/api\.github\.com/.test(u)) return real(url, opts);
    const method = (opts && opts.method) || "GET";
    const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
    if (/\/contents\?ref=/.test(u)) return json([{ name: "lifelog.json", path: "lifelog.json", sha: window.__remoteSha, type: "file" }]);
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
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message + " " + (e.stack || "").split("\n").slice(1, 4).join(" ")));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((data) => {
    localStorage.clear();
    localStorage.setItem("lifelog-github-v1", JSON.stringify({
      owner: "me", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_test", sha: "abc123",
    }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(data));
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "home" }));
  }, DATA);
  await page.addInitScript(`(${stub.toString()})(); window.__data = ${JSON.stringify(DATA)};`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#homeScratchpad");

  // Another device adds a note; the poll merges it in and redraws.
  let n = 0;
  const remoteChange = async () => {
    n++;
    await page.evaluate((n) => {
      window.__data = JSON.parse(JSON.stringify(window.__data));
      window.__data.notes.push({ id: "r" + n, text: "From the phone " + n, createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" });
      window.__remoteSha = "remote" + n;
    }, n);
    // A save still going out (the scratchpad's, on leaving it) comes first,
    // and the poll after it brings the change in.
    for (let i = 0; i < 4 && !(await synced()); i++) {
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.waitForTimeout(700);
    }
  };
  const synced = () => page.evaluate((n) => (window.LifeLogStorage.cachedCopy() || { notes: [] }).notes.some((x) => x.id === "r" + n), n);

  // ---- Home's scratchpad ----
  const pad = page.locator("#homeScratchpad");
  await pad.click();
  await page.keyboard.type("half a thou");
  await pad.evaluate((t) => t.setSelectionRange(4, 4));
  await remoteChange();
  check("the sync landed", await synced());
  let s = await page.evaluate(() => {
    const a = document.activeElement;
    return { id: a.id, value: a.value, at: a.selectionStart };
  });
  check("the scratchpad keeps focus through a sync", s.id === "homeScratchpad", s);
  check("and the caret where it was", s.at === 4, s);
  check("and the words typed", s.value === "half a thou", s);
  await page.keyboard.type("X");
  check("typing goes on in the same place", (await pad.inputValue()) === "halfX a thou");
  await pad.evaluate((t) => t.blur());

  // ---- a list's add line on Notes (a node the redraw replaces) ----
  await page.evaluate(() => document.querySelector('.tab[data-view="notes"]').click());
  await page.waitForTimeout(500);
  const COMPOSE = '.note-card[data-id="L"] .note-list-compose input';
  await page.locator(COMPOSE).click();
  await page.keyboard.type("Bread");
  const before = await page.locator(COMPOSE).elementHandle();
  await remoteChange();
  check("the sync landed on Notes", await synced());
  s = await page.evaluate((sel) => {
    const a = document.activeElement, box = document.querySelector(sel);
    return { same: a === box, value: box && box.value, at: a.selectionStart, add: box && !box.nextElementSibling.disabled };
  }, COMPOSE);
  check("the redrawn add line has focus", s.same, s);
  check("with the item typed and the caret at its end", s.value === "Bread" && s.at === 5, s);
  check("and Add still on", s.add, s);
  check("it is a new field, not the old one moved", await before.evaluate((x) => !x.isConnected));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const items = await page.evaluate(() => Promise.resolve(window.LifeLogStorage.cachedCopy()).then((d) => d.notes.find((x) => x.id === "L").items.map((i) => i.text)));
  check("Enter adds it", items.includes("Bread"), items);

  // ---- a field you only sat in takes what the sync brought ----
  await page.evaluate(() => { document.activeElement.blur(); });
  await page.evaluate(() => document.querySelector('.tab[data-view="home"]').click());
  await page.waitForTimeout(400);
  await page.locator("#homeScratchpad").click();
  await remoteChange();
  s = await page.evaluate(() => document.activeElement.id);
  check("focus kept without typing too", s === "homeScratchpad", s);

  check("no page errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
