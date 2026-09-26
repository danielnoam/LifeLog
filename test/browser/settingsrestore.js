// Getting settings back from History after a bad merge emptied them.
//
// 0.174.0's join by setup link, together with settings merging as one blob,
// could push a fresh install's empty settings to every device — API keys,
// media sources, Steam, AniList all blank. Every save is a commit, so they
// were never gone; but Restore rolls the whole log back to a save, taking
// everything added since with it. Undo on the save that emptied them is the
// tool for that. ("Bring back missing settings" and each save's "Settings
// only" did the same job from another angle and went in 0.199.0.)//
// GitHub is a fake with three saves: the current one (keys empty, plus a note
// added after the wipe), the wipe itself, and an older one with the keys.
const { chromium, BASE, settled } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const note = (id, text, stamp) => ({ id, text, createdAt: stamp, updatedAt: stamp });
const EMPTY_KEYS = { rawg: "", tmdb: "", ggdeals: "", steamgriddb: "" };
const settings = (o, at) => ({
  timelineSort: "newest", ledgerSort: "newest", backlogSort: "title", currency: "ILS",
  mediaCategorySources: {}, mediaCategoryFallbackSources: {}, mediaKeys: { ...EMPTY_KEYS },
  steam: { proxyUrl: "", steamId: "", wishlistCategory: "", autoSyncDays: "0" },
  anilist: { userName: "", animeCategory: "", mangaCategory: "", autoSyncDays: "0" },
  releases: { autoRefreshDays: "0" }, ...o, updatedAt: at,
});
const doc = (notes, s, exportedAt) => ({
  categories: [], entries: [], backlog: [], notes, todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], accomplishments: {}, settings: s, exportedAt,
});

const withKeys = doc([note("a", "Old note", "2026-09-01T00:00:00.000Z")], settings({
  backlogSort: "release",
  mediaKeys: { ...EMPTY_KEYS, rawg: "RAWG-SECRET", tmdb: "TMDB-SECRET" },
  mediaCategorySources: { Games: "rawg", Movies: "tmdb-movie" },
  steam: { proxyUrl: "https://proxy.example", steamId: "7656", wishlistCategory: "", autoSyncDays: "0" },
}, "2026-09-20T00:00:00.000Z"), "2026-09-20T00:00:00.000Z");
const wiped = doc(withKeys.notes, settings({}, "2026-09-23T18:00:00.000Z"), "2026-09-23T18:00:00.000Z");
// Since the wipe: a note added, and the backlog sort changed on purpose.
const now = doc([...withKeys.notes, note("b", "Added after the wipe", "2026-09-23T19:00:00.000Z")],
  settings({ backlogSort: "added-new" }, "2026-09-23T19:00:00.000Z"), "2026-09-23T19:00:00.000Z");

const COMMITS = [
  { sha: "c3", commit: { message: "Update lifelog (now)", author: { date: "2026-09-23T19:00:00Z" } } },
  { sha: "c2", commit: { message: "Update lifelog (the wipe)", author: { date: "2026-09-23T18:00:00Z" } } },
  { sha: "c1", commit: { message: "Update lifelog (keys)", author: { date: "2026-09-20T00:00:00Z" } } },
];
const AT = { main: now, c3: now, c2: wiped, c1: withKeys };
const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake", sha: "c3" };

async function openApp(browser) {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1000 }, serviceWorkers: "block" });
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
    if (/\/commits/.test(url)) return say(200, COMMITS);
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
  await page.click("#settingsBtn");
  await page.waitForTimeout(300);
  await page.click('.srow[data-page="history"]');
  await page.waitForTimeout(1200);
  return { page, ctx, errs, dialogs, puts };
}

const cached = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // ---- History is saves, deleted items and nothing else (0.199.0) ----
  {
    const { page, ctx, errs: e } = await openApp(browser);
    check("no 'Bring back missing settings' and no 'Settings only' on any save", await page.evaluate(() =>
      !document.querySelector("#historyFillSettingsBtn") && !/Settings only/.test(document.querySelector("#historyList").innerText)));
    check("Recently deleted is a section of History, not a page of its own", await page.evaluate(() =>
      !!document.querySelector('.settings-page[data-page="history"] #trashList') && !document.querySelector('[data-page="deleted"]')));
    errs.push(...e);
    await ctx.close();
  }

  // ---- undoing one save: the wipe itself (0.185.0) ----
  // Restore would take the note added since with it; Undo takes back only
  // what the wipe changed.
  {
    const { page, ctx, errs: e, dialogs } = await openApp(browser);
    const rows = await page.evaluate(() => [...document.querySelectorAll(".history-row")].map((r) => ({
      msg: r.querySelector(".history-msg").textContent, undo: !!r.querySelector('button[title^="Undo just"]'),
    })));
    check("every save but the oldest listed can be undone on its own",
      rows.length >= 3 && rows.slice(0, -1).every((r) => r.undo) && !rows[rows.length - 1].undo, rows);
    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".history-row")].find((r) => /the wipe/.test(r.querySelector(".history-msg").textContent));
      row.querySelector('button[title^="Undo just"]').click();
    });
    await page.waitForTimeout(1200);
    await settled(page);
    const d = await cached(page);
    check("undoing the wipe brings the keys back", d.settings.mediaKeys.rawg === "RAWG-SECRET" && d.settings.mediaKeys.tmdb === "TMDB-SECRET", d.settings.mediaKeys);
    check("and the media sources the wipe emptied", d.settings.mediaCategorySources.Games === "rawg", d.settings.mediaCategorySources);
    check("while the note added since stays", d.notes.some((n) => n.text === "Added after the wipe"), d.notes.map((n) => n.text));
    check("and so does a setting changed on purpose since", d.settings.backlogSort === "added-new", d.settings.backlogSort);
    check("it said what it was about to take back before doing it", dialogs.some((m) => /Undo the change from/.test(m) && /Everything since stays/.test(m)), dialogs);
    errs.push(...e);
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
