// A data file past 1MB, and the status line telling the truth about GitHub.
//
// GitHub's contents endpoint stops carrying a file's bytes at 1MB: between 1
// and 100MB it answers with the metadata and `content: ""`, `encoding:
// "none"`, and the bytes are only reachable as the git blob the sha names.
// Until 0.173.1 the app ran JSON.parse on the empty field. Every read failed,
// the status line said "unsynced changes, will sync when online" to someone
// who was online, a save after the other device had saved could never
// recover, and a setup link died with "Unexpected end of JSON input".
//
// GitHub here is a small fake that behaves like the real one on the three
// things that matter: large files come back empty, blobs come back by sha,
// and a PUT against a stale sha is a 409.
const { chromium, BASE, settled } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const note = (id, text, stamp) => ({ id, text, createdAt: stamp, updatedAt: stamp });
const doc = (notes, exportedAt) => ({
  categories: [], entries: [], backlog: [], notes, todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {}, exportedAt,
});
const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s) => JSON.parse(Buffer.from(s, "base64").toString());

// The fake. `fault(req)` may answer first, to stage a failure.
function fakeGitHub(page, remote, { fault } = {}) {
  const gh = { remote, sha: "sha-remote", puts: [], blobReads: 0 };
  return page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = req.url();
    const say = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const staged = fault && fault(req);
    if (staged) return say(staged.status, staged.body);
    if (/\/user$/.test(url)) return say(200, { login: "someone" });
    if (/\/repos\/someone\/lifelog-data$/.test(url)) return say(200, { default_branch: "main" });
    if (/\/commits/.test(url)) return say(200, []);
    if (/\/git\/blobs\//.test(url)) {
      gh.blobReads++;
      return url.endsWith("/" + gh.sha)
        ? say(200, { sha: gh.sha, encoding: "base64", content: b64(gh.remote), size: 1500000 })
        : say(404, { message: "Not Found" });
    }
    if (req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      if (body.sha !== gh.sha) return say(409, { message: "lifelog.json does not match " + body.sha });
      gh.remote = unb64(body.content);
      gh.sha = "sha-" + (gh.puts.length + 1);
      gh.puts.push({ sha: body.sha, data: gh.remote });
      return say(200, { content: { sha: gh.sha } });
    }
    // The contents GET, for a file past 1MB.
    return say(200, { sha: gh.sha, size: 1500000, encoding: "none", content: "" });
  }).then(() => gh);
}

async function openApp(browser, { cache, remote, fault, hash = "", connect = true, staleSha = true }) {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1000 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|409|401|403|500|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(({ cache, gh, connect }) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    if (cache) {
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(cache));
      localStorage.setItem("lifelog-sync-base-v1", JSON.stringify(cache));
    }
    if (connect) localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
  }, { cache, gh: { ...GH, sha: staleSha ? "sha-old" : "sha-remote" }, connect });
  const gh = await fakeGitHub(page, remote, { fault });
  // Via about:blank, because the same URL plus a #fragment is a fragment
  // jump rather than a load, and the app would never boot on the link.
  await page.goto("about:blank");
  await page.goto(BASE + "/" + hash, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  return { page, ctx, errs, gh };
}

const status = (page) => page.evaluate(() => (document.querySelector(".storage-status") || {}).textContent || "");
const toastText = (page) => page.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden ? t.textContent : ""; });
const noteTexts = (page) => page.evaluate(() => document.querySelector("#viewBody").innerText);
async function writeNote(page, text) {
  await page.click("#addBtn");
  await page.waitForTimeout(250);
  await page.click('#addMenu [data-add="note"]');
  await page.waitForSelector("#noteModal:not([hidden])", { timeout: 5000 });
  await page.fill("#nText", text);
  await page.click("#noteForm button[type=submit]");
  await settled(page);
}

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const here = doc([note("a", "Written on this phone", "2026-09-01T00:00:00.000Z")], "2026-09-01T00:00:00.000Z");
  const there = doc([
    note("a", "Written on this phone", "2026-09-01T00:00:00.000Z"),
    note("b", "Written on the other device", "2026-09-10T00:00:00.000Z"),
  ], "2026-09-10T00:00:00.000Z");

  // ---- 1. a large file reads, and what's in it arrives ----
  {
    const { page, ctx, errs: e, gh } = await openApp(browser, { cache: here, remote: there });
    const body = await noteTexts(page);
    check("a data file past 1MB is read through its blob", gh.blobReads > 0, gh.blobReads);
    check("and the other device's note arrives", /Written on the other device/.test(body), body.slice(0, 200));
    const t = await toastText(page);
    check("nobody is told they're offline", !/Offline/.test(t), t);
    check("and the status line doesn't say it's waiting to sync", !/unsynced|Not syncing|rejected/.test(await status(page)), await status(page));

    // ---- 2. a save after the other device saved goes through ----
    await writeNote(page, "Written after the fix");
    const last = gh.puts[gh.puts.length - 1];
    const texts = last ? last.data.notes.map((n) => n.text) : [];
    check("a save lands on GitHub against the sha it actually read",
      !!last && gh.puts.every((p) => p.sha !== "sha-old"), gh.puts.map((p) => p.sha));
    check("and what it writes keeps the other device's note as well as the new one",
      texts.includes("Written on the other device") && texts.includes("Written after the fix"), texts);
    check("the line says synced, with nothing pending", !/unsynced|Not syncing/.test(await status(page)), await status(page));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 3. a setup link against a large file ----
  // This is the exact message that arrived from a real device:
  // "Setup link failed: Unexpected end of JSON input".
  {
    const { page, ctx, errs: e } = await openApp(browser, {
      cache: null, remote: there, connect: false,
      hash: "#t=ghp_fake&o=someone&r=lifelog-data&p=lifelog.json&b=main",
    });
    await page.waitForTimeout(800);
    const t = await toastText(page);
    check("a setup link joins a sync target whose file is past 1MB", !/Setup link failed/.test(t), t);
    check("and the device comes up with the data",
      /Written on the other device/.test(await noteTexts(page)), (await noteTexts(page)).slice(0, 200));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 4. the status line says what actually went wrong ----
  // Each of these used to be one of two stories, and for the first two the
  // story was false.
  {
    const limited = (req) => req.method() === "PUT"
      ? { status: 403, body: { message: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again." } } : null;
    const { page, ctx, errs: e } = await openApp(browser, { cache: here, remote: here, fault: limited, staleSha: false });
    await writeNote(page, "Too fast");
    const s = await status(page);
    check("a rate limit is not a rejected token", !/rejected your token/.test(s) && /limiting saves/.test(s), s);
    errs.push(...e);
    await ctx.close();
  }
  {
    const broken = (req) => req.method() === "PUT" ? { status: 500, body: { message: "Server Error" } } : null;
    const { page, ctx, errs: e } = await openApp(browser, { cache: here, remote: here, fault: broken, staleSha: false });
    await writeNote(page, "Into the void");
    const s = await status(page);
    check("a GitHub failure says so and says why, instead of 'when online'",
      /Not syncing/.test(s) && /Server Error/.test(s) && !/when online/.test(s), s);
    errs.push(...e);
    await ctx.close();
  }
  {
    const expired = () => ({ status: 401, body: { message: "Bad credentials" } });
    const { page, ctx, errs: e } = await openApp(browser, { cache: here, remote: here, fault: expired });
    check("a token GitHub really rejects is still called that", /rejected your token/.test(await status(page)), await status(page));
    const t = await toastText(page);
    check("and the boot toast doesn't call it being offline", !/Offline/.test(t), t);
    errs.push(...e);
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 460, height: 1000 }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(({ cache, gh }) => {
      localStorage.clear();
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(cache));
      localStorage.setItem("lifelog-sync-base-v1", JSON.stringify(cache));
      localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
    }, { cache: here, gh: { ...GH, sha: "sha-remote" } });
    await page.route("https://api.github.com/**", (route) => route.abort());
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    check("actually being offline is still called offline", /Offline/.test(await toastText(page)), await toastText(page));
    await writeNote(page, "On a plane");
    check("with the changes waiting for the connection", /will sync when online/.test(await status(page)), await status(page));
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
