// A change the AI bridge made shows in Settings → History, tagged with the
// AI's name, and Undo takes back just that change (0.284.0).
//
// The bridge saves straight to GitHub, so no device ever records it: the
// save is only in GitHub's commit log, whose entries History used to list
// only when they were older than the device's own. GitHub is a fake with
// three saves: an older one, then (after this device's own local save) the
// bridge's, a note added by "Telemachus", and another device's after it.
const { chromium, BASE, settled, forgetCopy } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const note = (id, text, stamp) => ({ id, text, createdAt: stamp, updatedAt: stamp });
const doc = (notes, exportedAt) => ({
  categories: [], entries: [], backlog: [], notes, todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], accomplishments: {}, settings: { currency: "ILS" }, exportedAt,
});
const before = doc([note("a", "Old note", "2026-09-01T00:00:00.000Z")], "2026-09-20T00:00:00.000Z");
const bridged = doc([...before.notes, note("b", "From Telemachus", "2026-09-23T18:00:00.000Z")], "2026-09-23T18:00:00.000Z");
const now = doc([...bridged.notes, note("c", "Mine, after it", "2026-09-24T09:00:00.000Z")], "2026-09-24T09:00:00.000Z");

const hoursFromNow = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const COMMITS = [
  { sha: "c3", parents: [{ sha: "c2" }], commit: { message: "Update lifelog (the other device)", author: { date: hoursFromNow(2) } } },
  { sha: "c2", parents: [{ sha: "c1" }], commit: { message: "LifeLog bridge (Telemachus): Saved the note \"From Telemachus\".", author: { date: hoursFromNow(1) } } },
  { sha: "c1", parents: [], commit: { message: "Update lifelog (older)", author: { date: hoursFromNow(-240) } } },
];
const AT = { main: now, c3: now, c2: bridged, c1: before };
const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake", sha: "c3" };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [], dialogs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  const puts = [];
  let sha = "c3";
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = req.url();
    const say = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (/\/commits/.test(url)) return say(200, /lifelog\.json/.test(decodeURIComponent(url)) ? COMMITS : []);
    if (!/lifelog\.json/.test(decodeURIComponent(url))) return say(404, { message: "Not Found" });
    if (req.method() === "PUT") {
      puts.push(JSON.parse(Buffer.from(JSON.parse(req.postData()).content, "base64").toString()));
      sha = "c" + (4 + puts.length);
      return say(200, { content: { sha } });
    }
    const ref = (url.match(/[?&]ref=([^&]+)/) || [])[1] || "main";
    const d = puts.length && ref === "main" ? puts[puts.length - 1] : AT[ref];
    return say(200, { sha: ref === "main" ? sha : ref, size: 100, encoding: "base64", content: Buffer.from(JSON.stringify(d)).toString("base64") });
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await forgetCopy(page);
  await page.evaluate(({ cache, gh }) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(cache));
    localStorage.setItem("lifelog-sync-base-v1", JSON.stringify(cache));
    localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
  }, { cache: now, gh: GH });
  await page.goto("about:blank");
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  // A save on this device, so its own history is newer than every commit:
  // the case that used to hide the bridge's save.
  await page.evaluate(async () => { const S = window.LifeLogStorage; await S.save(await S.cachedCopy()); });
  await page.click("#settingsBtn");
  await page.waitForTimeout(300);
  await page.click('.srow[data-page="history"]');
  await page.waitForTimeout(1200);

  const rows = await page.evaluate(() => [...document.querySelectorAll("#historyList .history-row")].map((r) => ({
    msg: r.querySelector(".history-msg").textContent,
    ai: (r.querySelector(".history-badge-ai") || {}).textContent || "",
    icon: !!r.querySelector(".history-badge-ai svg[data-ico=sparkles]"),
    undo: !!r.querySelector('button[title^="Undo just"]'),
  })));
  const ai = rows.find((r) => r.ai);
  check("the bridge's save is listed though this device's history is newer", !!ai, rows);
  check("tagged with the AI's name and its icon", ai && ai.ai.trim() === "Telemachus" && ai.icon, ai);
  check("its summary is the change, without the bridge prefix", ai && ai.msg === "Saved the note \"From Telemachus\".", ai);
  check("other GitHub saves newer than this device's stay folded away", !rows.some((r) => /the other device/.test(r.msg)) && rows.some((r) => /older/.test(r.msg)), rows.map((r) => r.msg));
  check("it can be undone", ai && ai.undo, ai);

  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#historyList .history-row")].find((r) => r.querySelector(".history-badge-ai"));
    row.querySelector('button[title^="Undo just"]').click();
  });
  await page.waitForTimeout(1200);
  await settled(page);
  const d = await page.evaluate(() => window.LifeLogStorage.cachedCopy());
  const texts = d.notes.map((n) => n.text);
  check("Undo takes back the AI's note", !texts.includes("From Telemachus"), texts);
  check("and keeps what came before and after it", texts.includes("Old note") && texts.includes("Mine, after it"), texts);
  check("it said what it was about to undo", dialogs.some((m) => /Undo the change from/.test(m) && /From Telemachus/.test(m)), dialogs);

  await page.screenshot({ path: require("path").join(require("os").tmpdir(), "bridgehistory-375.png") });
  await ctx.close();
  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
