// Saves are coalesced (0.180.0): a burst of edits is one write to GitHub.
//
// Until then every persist() was its own PUT, so its own commit in the data
// repo — an API key typed into Settings was a commit per keystroke, and the
// PUTs raced each other against one sha, so most of a burst came back 409
// and was retried. That is how GitHub's limit on content writes (80 a
// minute) became reachable. What has to hold now:
//
//   - a burst is one PUT, and nothing waits on it: the cache has every edit
//     straight away;
//   - the status line doesn't say "Synced" while an edit is still queued;
//   - a long run of edits still saves before it stops (the max wait);
//   - going to the background sends what's queued;
//   - an edit made while a save is in flight goes in a second save, never a
//     racing one;
//   - an edit that never got sent (the app killed first) reaches GitHub on
//     the next launch.
const { chromium, BASE, settled } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const STAMP = "2026-09-01T00:00:00.000Z";
const DOC = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {}, exportedAt: STAMP,
};
const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake", sha: "sha-0" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s) => JSON.parse(Buffer.from(s, "base64").toString());

// GitHub, with a stale sha answered 409 and every PUT's overlap recorded.
function fakeGitHub(page, { putDelay = 0, dropPuts = false } = {}) {
  const gh = { remote: DOC, sha: "sha-0", puts: [], conflicts: 0, open: 0, maxOpen: 0 };
  return page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const say = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "PUT") {
      if (dropPuts) return route.abort();
      gh.open++; gh.maxOpen = Math.max(gh.maxOpen, gh.open);
      if (putDelay) await new Promise((r) => setTimeout(r, putDelay));
      gh.open--;
      const body = JSON.parse(req.postData());
      if (body.sha !== gh.sha) { gh.conflicts++; return say(409, { message: "does not match" }); }
      gh.remote = unb64(body.content);
      gh.sha = "sha-" + (gh.puts.length + 1);
      gh.puts.push({ at: Date.now(), data: gh.remote });
      return say(200, { content: { sha: gh.sha } });
    }
    if (/\/commits/.test(req.url())) return say(200, []);
    // Read before waiting, so a slow answer is what GitHub held when asked.
    const answer = { sha: gh.sha, size: 1000, encoding: "base64", content: b64(gh.remote) };
    if (gh.getDelay) await new Promise((r) => setTimeout(r, gh.getDelay));
    return say(200, answer);
  }).then(() => gh);
}

async function openApp(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1000 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(({ doc, gh }) => {
    localStorage.clear();
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(doc));
    localStorage.setItem("lifelog-sync-base-v1", JSON.stringify(doc));
    localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
  }, { doc: DOC, gh: GH });
  const gh = await fakeGitHub(page, opts);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  return { page, ctx, errs, gh };
}

// The RAWG key box saves on every keystroke, which is what makes it the
// plainest burst in the app.
const typeKey = (page, text, gap = 60) => page.evaluate(async ({ text, gap }) => {
  const box = document.querySelector("#rawgKey");
  for (const ch of text) {
    box.value += ch;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, gap));
  }
}, { text, gap });
const cachedKey = (page) => page.evaluate(() => ((JSON.parse(localStorage.getItem("lifelog-cache-v1")).settings || {}).mediaKeys || {}).rawg);
const status = (page) => page.evaluate(() => (document.querySelector(".storage-status") || {}).textContent || "");
const keysOf = (gh) => gh.puts.map((p) => ((p.data.settings || {}).mediaKeys || {}).rawg);

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // ---- 1. a burst is one write ----
  {
    const { page, ctx, errs: e, gh } = await openApp(browser);
    check("nothing is written just for opening the app", gh.puts.length === 0, gh.puts.length);
    await typeKey(page, "ABCDEFGHIJKL");
    check("every keystroke is kept on the device straight away", (await cachedKey(page)) === "ABCDEFGHIJKL", await cachedKey(page));
    check("while it's queued the line says it's saving, not that it's synced", /Saving/.test(await status(page)), await status(page));
    await settled(page);
    check("twelve keystrokes are one commit, not twelve", gh.puts.length === 1, keysOf(gh));
    check("and that commit has the whole key", keysOf(gh)[0] === "ABCDEFGHIJKL", keysOf(gh));
    check("with no write racing another", gh.conflicts === 0 && gh.maxOpen <= 1, { conflicts: gh.conflicts, maxOpen: gh.maxOpen });
    check("and once it lands the line says synced", /Synced/.test(await status(page)) && !/unsynced/.test(await status(page)), await status(page));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 2. a long run of edits still saves before it stops ----
  {
    const { page, ctx, errs: e, gh } = await openApp(browser);
    await typeKey(page, "0123456789ABCDEFGHIJ", 500); // ten seconds, never a pause long enough
    check("edits that never pause still reach GitHub while they go on", gh.puts.length >= 1, gh.puts.length);
    await settled(page);
    check("and the last of them arrives once they stop", keysOf(gh).slice(-1)[0] === "0123456789ABCDEFGHIJ", keysOf(gh));
    check("still a handful of commits, not twenty", gh.puts.length <= 3, gh.puts.length);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 3. going to the background sends what's queued ----
  {
    const { page, ctx, errs: e, gh } = await openApp(browser);
    await typeKey(page, "HIDE");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(400); // well inside the wait it would otherwise have had
    check("switching away sends a queued save at once", gh.puts.length === 1 && keysOf(gh)[0] === "HIDE", keysOf(gh));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 4. an edit during a save goes in the next one ----
  {
    const { page, ctx, errs: e, gh } = await openApp(browser, { putDelay: 1200 });
    await typeKey(page, "ONE");
    await page.waitForTimeout(1700); // the save is now in flight
    await typeKey(page, "TWO");
    await page.waitForTimeout(400);
    await settled(page);
    check("an edit made while a save is in flight is saved after it", keysOf(gh).join(",") === "ONE,ONETWO", keysOf(gh));
    check("without two writes at once or a 409 between them", gh.conflicts === 0 && gh.maxOpen === 1, { conflicts: gh.conflicts, maxOpen: gh.maxOpen });
    errs.push(...e);
    await ctx.close();
  }

  // ---- 5. an edit that never got sent arrives next launch ----
  {
    const { page, ctx, errs: e } = await openApp(browser, { dropPuts: true });
    await typeKey(page, "KILLED");
    // The app goes before the save gets through: the next launch is a fresh
    // page against a GitHub that never heard of the edit.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const gh = await fakeGitHub(page);
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1500);
    await settled(page);
    check("the next launch pushes the edit that was only on this device", keysOf(gh).slice(-1)[0] === "KILLED", keysOf(gh));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 6. another device saved first ----
  // Until 0.180.0 the 409 was answered by writing this copy over theirs:
  // their note was gone from GitHub, and their next poll deleted it on their
  // side too.
  {
    const { page, ctx, errs: e, gh } = await openApp(browser);
    const theirs = { id: "b1", text: "From the other device", createdAt: STAMP, updatedAt: "2026-09-02T00:00:00.000Z" };
    gh.remote = { ...gh.remote, notes: [theirs], exportedAt: "2026-09-02T00:00:00.000Z" };
    gh.sha = "sha-B";
    await typeKey(page, "MINE");
    await settled(page);
    await page.waitForTimeout(800); // the poll the merge asks for
    const first = gh.puts[0] ? gh.puts[0].data : { notes: [], settings: {} };
    check("a save that finds GitHub moved on keeps the other device's note",
      first.notes.some((n) => n.id === "b1"), first.notes);
    check("and still carries this device's edit", ((first.settings || {}).mediaKeys || {}).rawg === "MINE", first.settings);
    const cachedNotes = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).notes.map((n) => n.id));
    check("then this device fetches the merge and has the note too", cachedNotes.includes("b1"), cachedNotes);
    await typeKey(page, "2");
    await settled(page);
    const last = gh.puts[gh.puts.length - 1].data;
    check("and its next save doesn't drop it again",
      last.notes.some((n) => n.id === "b1") && last.settings.mediaKeys.rawg === "MINE2", { notes: last.notes.map((n) => n.id), key: last.settings.mediaKeys.rawg });
    errs.push(...e);
    await ctx.close();
  }
  // Same, but the second edit goes out before any poll could bring the
  // merge in: it must merge again, not write over the note it hasn't seen.
  {
    const { page, ctx, errs: e, gh } = await openApp(browser);
    gh.remote = { ...gh.remote, notes: [{ id: "b1", text: "From the other device", createdAt: STAMP, updatedAt: "2026-09-02T00:00:00.000Z" }], exportedAt: "2026-09-02T00:00:00.000Z" };
    gh.sha = "sha-B";
    // An open modal holds the poll off (it never swaps data under a form).
    await page.evaluate(() => { document.querySelector("#shortcutsModal").hidden = false; });
    await typeKey(page, "ONE");
    await settled(page);
    await typeKey(page, "TWO");
    await settled(page);
    const last = gh.puts[gh.puts.length - 1].data;
    check("with the poll held off, the device still hasn't seen the note",
      await page.evaluate(() => !JSON.parse(localStorage.getItem("lifelog-cache-v1")).notes.some((n) => n.id === "b1")));
    check("a save made before the merge was fetched merges again instead of dropping the note",
      last.notes.some((n) => n.id === "b1") && last.settings.mediaKeys.rawg === "ONETWO", { notes: last.notes.map((n) => n.id), key: last.settings.mediaKeys.rawg });
    errs.push(...e);
    await ctx.close();
  }

  // ---- 7. a poll that finds a change and then has to back off ----
  // Until 0.185.0 the poll took GitHub's new sha as soon as it saw it. If it
  // then backed off — here, a form opened while GitHub was answering — this
  // device held the new sha without the new data, and its next save went
  // through with no 409 and wrote the other device's note away.
  {
    const { page, ctx, errs: e, gh } = await openApp(browser);
    gh.remote = { ...gh.remote, notes: [{ id: "b1", text: "From the other device", createdAt: STAMP, updatedAt: "2026-09-02T00:00:00.000Z" }], exportedAt: "2026-09-02T00:00:00.000Z" };
    gh.sha = "sha-B";
    gh.getDelay = 700;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.querySelector("#shortcutsModal").hidden = false; });
    await page.waitForTimeout(900);
    await page.evaluate(() => { document.querySelector("#shortcutsModal").hidden = true; });
    check("with a form open, the poll backed off without taking the note in",
      await page.evaluate(() => !JSON.parse(localStorage.getItem("lifelog-cache-v1")).notes.some((n) => n.id === "b1")));
    gh.getDelay = 0;
    await typeKey(page, "AFTER");
    await settled(page);
    await page.waitForTimeout(800);
    const last = gh.puts[gh.puts.length - 1].data;
    check("the next save still keeps the other device's note", last.notes.some((n) => n.id === "b1"), last.notes);
    check("because it met a 409 and merged, rather than writing straight over", gh.conflicts >= 1, gh.conflicts);
    check("and has this device's edit", last.settings.mediaKeys.rawg === "AFTER", last.settings.mediaKeys);
    errs.push(...e);
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
