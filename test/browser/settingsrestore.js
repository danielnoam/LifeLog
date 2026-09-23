// Bringing back settings a bad merge emptied (0.175.0).
//
// 0.174.0's join by setup link, together with settings merging as one blob,
// could push a fresh install's empty settings to every device — API keys,
// media sources, Steam, AniList all blank. Every save is a commit, so they
// were never gone; but Restore rolls the whole log back to a save, taking
// everything added since with it. This is the other tool: fill in what's
// empty now, from the newest save that has it, and touch nothing else.
//
// GitHub is a fake with three saves: the current one (keys empty, plus a note
// added after the wipe), the wipe itself, and an older one with the keys.
const { chromium, BASE } = require("./harness");
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
  await page.click('.stab[data-stab="history"]');
  await page.waitForTimeout(1200);
  return { page, ctx, errs, dialogs, puts };
}

const cached = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // ---- 1. one button finds the save that still had them ----
  {
    const { page, ctx, errs: e, dialogs, puts } = await openApp(browser);
    await page.click("#historyFillSettingsBtn");
    await page.waitForTimeout(1500);
    const d = await cached(page);
    check("the missing API keys come back", d.settings.mediaKeys.rawg === "RAWG-SECRET" && d.settings.mediaKeys.tmdb === "TMDB-SECRET", d.settings.mediaKeys);
    check("and the media sources and Steam settings with them",
      d.settings.mediaCategorySources.Games === "rawg" && d.settings.mediaCategorySources.Movies === "tmdb-movie" &&
      d.settings.steam.proxyUrl === "https://proxy.example", d.settings);
    check("it skipped the wipe itself and found the save before it",
      dialogs.some((m) => /Bring back \d+ settings/.test(m)), dialogs);
    check("a note added since the wipe is still there — the log isn't rolled back",
      d.notes.some((n) => n.text === "Added after the wipe"), d.notes.map((n) => n.text));
    check("a setting changed on purpose since isn't reverted", d.settings.backlogSort === "added-new", d.settings.backlogSort);
    check("the question names what comes back without showing the keys themselves",
      dialogs.some((m) => /RAWG API key/.test(m) && /Games media source/.test(m) && !/SECRET/.test(m)), dialogs);
    const last = puts[puts.length - 1];
    check("and the restored settings are saved to GitHub for every device",
      !!last && last.settings.mediaKeys.rawg === "RAWG-SECRET" && last.notes.length === 2, last && last.settings.mediaKeys);
    await page.click('.stab[data-stab="media"]');
    await page.waitForTimeout(300);
    check("the Media tab shows them straight away", await page.evaluate(() => document.querySelector("#rawgKey").value === "RAWG-SECRET"));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 2. a save with nothing to give says so, and changes nothing ----
  {
    const { page, ctx, errs: e, dialogs, puts } = await openApp(browser);
    const rows = await page.$$(".history-row");
    let clicked = false;
    for (const r of rows) {
      if (/the wipe/.test(await r.innerText())) {
        const b = await r.$("button:has-text('Settings only')");
        if (b) { await b.click(); clicked = true; }
        break;
      }
    }
    await page.waitForTimeout(800);
    const t = await page.evaluate(() => { const x = document.querySelector("#toast"); return x && !x.hidden ? x.textContent : ""; });
    check("'Settings only' on a save without the keys says there's nothing to bring back",
      clicked && /nothing that's missing/.test(t) && dialogs.length === 0, { clicked, t, dialogs });
    check("and saves nothing", puts.length === 0, puts.length);
    check("the current save has no 'Settings only' button — it is what's there now",
      await page.evaluate(() => !document.querySelector(".history-row").innerText.includes("Settings only")));
    errs.push(...e);
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
