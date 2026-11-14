// Settings → Connections: a list with one screen per app, each with its
// own back step, and Hardcover's two-way sync against a faked Hardcover
// (pulls a start, sends a local one, offers what's new for review). Also
// that every connection screen opens without an error, and the Waypage
// and Stremio controls are there.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const PROXY = "https://proxy.lifelog.test";
const SEED = {
  categories: [{ id: "books", name: "Books", color: "#5b8cff" }, { id: "movies", name: "Movies", color: "#e0b341" }],
  backlog: [
    { id: "b1", title: "Dune", category: "Books", author: "Frank Herbert", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "b2", title: "Ronin Book", category: "Books", mediaSource: "hardcover", mediaId: "ronin-book", startedAt: "2026-11-10", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z" },
  ],
  entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [], projects: [], todoCategories: [], financeCategories: [],
  settings: {
    mediaKeys: { hardcover: "hctok" },
    steam: { proxyUrl: PROXY },
    hardcover: { category: "Books", autoSyncDays: "0", connectedAt: "2026-11-01T00:00:00.000Z" },
    waypage: { repo: "me/waypage-data", token: "github_pat_x", kinds: { book: "Books" } },
  },
};
const book = (id, slug, title, author) => ({ id, slug, title, pages: 400, release_year: 1965, cached_image: {}, cached_contributors: [{ author: { name: author } }] });
const ROWS = [
  { id: 11, status_id: 2, updated_at: "2026-11-12T00:00:00Z", date_added: "2026-01-01", first_started_reading_date: "2026-11-11", last_read_date: null, rating: null, book: book(1, "dune", "Dune", "Frank Herbert") },
  { id: 12, status_id: 1, updated_at: "2026-11-01T00:00:00Z", date_added: "2026-01-01", first_started_reading_date: null, last_read_date: null, rating: null, book: book(2, "ronin-book", "Ronin Book", "A. Writer") },
  { id: 13, status_id: 1, updated_at: "2026-11-01T00:00:00Z", date_added: "2026-01-01", first_started_reading_date: null, last_read_date: null, rating: null, book: book(3, "emma", "Emma", "Jane Austen") },
];

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const width of [375, 1280]) {
    const at = " @" + width;
    const page = await b.newPage({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    const sent = [];
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route(/proxy\.lifelog\.test/, (route) => {
      const url = route.request().url();
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
      const body = JSON.parse(decodeURIComponent((/[?&]q=([^&]*)/.exec(url) || [])[1] || "{}"));
      const q = body.query || "";
      const json = (data) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ data }) });
      if (/^mutation/.test(q)) { sent.push({ q, v: body.variables }); return json({ update_user_book: { error: null, user_book: { id: 12 } }, insert_user_book_read: { error: null } }); }
      if (/me \{/.test(q)) return json({ me: [{ id: 7, username: "reader" }] });
      if (/user_books\(/.test(q)) return json({ user_books: ROWS });
      return json({});
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-hardcover-base-v1", JSON.stringify({ "ronin-book": "want" }));
    }, SEED);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const data = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());
    const shown = (p) => page.evaluate((p) => { const n = document.querySelector(`.settings-page[data-page="${p}"]`); return !!n && !n.hidden; }, p);

    await page.evaluate(() => LifeLogSettings.openSettings("imports"));
    await page.waitForTimeout(300);
    const rows = await page.$$eval('.settings-page[data-page="imports"] .srow:not([hidden]) .srow-title', (n) => n.map((x) => x.textContent));
    check("Connections lists each app" + at, JSON.stringify(rows) === JSON.stringify(["Hardcover", "AniList", "Stremio", "Waypage", "Steam", "Letterboxd"]), rows);
    const hcStatus = await page.textContent('[data-conn-status="hardcover"]');
    check("a row says where it stands" + at, /Books, both ways/.test(hcStatus), hcStatus);

    for (const k of ["anilist", "stremio", "waypage", "steam", "letterboxd", "hardcover"]) {
      await page.click(`.srow[data-page="conn-${k}"]`);
      await page.waitForTimeout(150);
      check(k + " opens its own screen" + at, await shown("conn-" + k));
      if (k !== "hardcover") {
        if (width < 500) await page.click("#settingsBackBtn"); else await page.click(`.settings-page[data-page="conn-${k}"] .settings-crumb`);
        await page.waitForTimeout(150);
        check("back from " + k + " is Connections" + at, await shown("imports"));
      }
    }
    if (width < 500) check("the phone's back step names Connections" + at, (await page.textContent("#settingsBackBtn")).includes("Connections"));
    else check("Connections stays lit in the list" + at, await page.evaluate(() => document.querySelector('#settingsHome .srow[data-page="imports"]').classList.contains("active")));

    const switches = await page.$$eval("#hardcoverComesIn .switch", (n) => n.length);
    check("Hardcover has What comes in" + at, switches === 5, switches);
    check("AniList and Stremio have it too" + at, await page.evaluate(() => document.querySelectorAll("#anilistComesIn .switch").length === 5 && document.querySelectorAll("#stremioComesIn .switch").length === 4));
    check("Stremio has the Up next switch" + at, !!(await page.$("#stremioUpNext")));

    // Hardcover, both ways.
    await page.click("#hardcoverSyncBtn");
    await page.waitForTimeout(1500);
    let d = await data();
    const dune = d.backlog.find((x) => x.id === "b1");
    check("a start on Hardcover starts the matched book here" + at, dune.startedAt === "2026-11-11" && dune.mediaSource === "hardcover" && dune.mediaId === "dune", dune);
    const upd = sent.find((x) => /update_user_book/.test(x.q));
    check("a start here goes to Hardcover" + at, upd && upd.v.id === 12 && upd.v.s === 2, sent);
    const review = await page.evaluate(() => [...document.querySelectorAll(".modal-overlay:not([hidden])")].map((n) => n.textContent).join(" "));
    check("a new Hardcover book waits in the review" + at, /Emma/.test(review), review.slice(0, 200));
    await page.click("#financePickerCloseBtn");
    await page.waitForTimeout(300);

    await page.evaluate(() => LifeLogSettings.openSettings("conn-hardcover"));
    await page.waitForTimeout(200);
    await page.locator("#hardcoverComesIn label.toggle-label").nth(4).click();
    await page.waitForTimeout(300);
    d = await data();
    check("Send my changes off is kept" + at, d.settings.hardcover.send === false, d.settings.hardcover);

    await page.evaluate(() => LifeLogSettings.openSettings("conn-waypage"));
    await page.waitForTimeout(200);
    check("Waypage reads as on" + at, await page.isChecked("#waypageOn"));
    await page.click("label:has(#waypageOn)");
    await page.waitForTimeout(300);
    d = await data();
    check("turning Waypage off is kept" + at, d.settings.waypage.paused === true, d.settings.waypage);
    check("the list says so" + at, await page.evaluate(() => window.LifeLogConnections.status("waypage").text === "Turned off"));
    await page.close();
  }
  check("no page errors", !errs.length, errs);
  await b.close();
  done();
})();
