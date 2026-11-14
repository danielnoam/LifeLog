// The reading log from Waypage (0.313.0): with a repo and token set, the app
// reads activity/reading.json from GitHub's API (stood in for here), starts
// the backlog book it matches, adds one it doesn't have, moves a finished one
// to the Timeline, fills the minutes habit, lists a re-read for review, and
// answering the review adds it. The ETag is sent back on the next read.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const T = "2026-01-01T00:00:00.000Z";
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const FILE = JSON.stringify({ schema: 1, app: "waypage", updatedAt: T, timeZone: "UTC",
  items: [
    { id: "c1", kind: "book", title: "The Quiet Orbit", author: "", progress: 0.62, startedAt: day(4), finishedAt: null, minutes: 200 },
    { id: "c2", kind: "audiobook", title: "Saltmarsh Letters", author: "A. Lindqvist", progress: 0.2, chapters: { read: 3, total: 17 }, startedAt: day(2), finishedAt: null, minutes: 60 },
    { id: "c3", kind: "book", title: "Paper Harbor", author: "", progress: 1, startedAt: day(9), finishedAt: day(1), minutes: 400 },
    { id: "c4", kind: "book", title: "Wren", author: "", progress: 0.1, startedAt: day(1), finishedAt: null, minutes: 15 },
    { id: "a1", kind: "article", title: "An essay", author: "", progress: 1, startedAt: day(1), finishedAt: day(1), minutes: 9 },
  ],
  days: { [day(1)]: { read: 30, listened: 15 }, [day(0)]: { read: 12, listened: 0 } } });

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const asks = [];
  await page.route("https://api.github.com/repos/me/waypage-data/contents/activity/reading.json", (r) => {
    asks.push(r.request().headers());
    if (r.request().headers()["if-none-match"] === '"v1"') return r.fulfill({ status: 304, headers: { "access-control-allow-origin": "*" }, body: "" });
    r.fulfill({ status: 200, headers: { "content-type": "application/json", etag: '"v1"', "access-control-allow-origin": "*", "access-control-expose-headers": "ETag" }, body: FILE });
  });
  await page.route(/^https:\/\/(?!api\.github\.com\/repos\/me\/)/, (r) => r.abort());
  await page.goto(BASE + "/", { waitUntil: "load" });
  await forgetCopy(page);
  await page.evaluate(({ T, d1 }) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify({
    categories: [{ name: "Books", color: "#3fb950" }, { name: "Audiobooks", color: "#e2723b" }],
    entries: [{ id: "e1", title: "Wren", category: "Books", year: 2025, month: 3, date: "2025-03", createdAt: T }],
    backlog: [
      { id: "b1", title: "The Quiet Orbit", category: "Books", notes: "mine", createdAt: T },
      { id: "b2", title: "Paper Harbor", category: "Books", createdAt: T }],
    habits: [{ id: "h1", name: "Read", color: "#3fb950", cadence: "daily", unit: "min", target: 20, order: 0, startedAt: "2026-01-01", marks: { [d1]: 10 }, createdAt: T }],
    notes: [],
    settings: { waypage: { repo: "me/waypage-data", token: "github_pat_test", connectedAt: T, habit: "h1",
      kinds: { book: "Books", audiobook: "Audiobooks", comic: "Books", serial: "Books", article: "" } } } })); }, { T, d1: day(1) });
  await page.reload({ waitUntil: "load" }); await page.waitForTimeout(1500);
  const data = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());

  let d = await data();
  check("it asked GitHub with the token, for the raw file", asks.length >= 1 && asks[0].authorization === "Bearer github_pat_test" && /raw/.test(asks[0].accept), asks[0]);
  const orbit = d.backlog.find((x) => x.id === "b1");
  check("the backlog book it matched is started, with its % and your notes", orbit && orbit.startedAt === day(4) && orbit.waypageProgress === 0.62 && orbit.notes === "mine", orbit);
  const salt = d.backlog.find((x) => x.waypageId === "c2");
  check("one you don't have comes in, in its kind's category", salt && salt.category === "Audiobooks" && salt.startedAt === day(2), salt);
  check("a finished one leaves the backlog for the Timeline", !d.backlog.some((x) => x.id === "b2") && d.entries.some((e) => e.title === "Paper Harbor" && e.waypageId === "c3"));
  check("articles stay out", !JSON.stringify(d).includes("An essay"));
  const h = d.habits[0];
  check("minutes fill the habit on top of what was there", h.marks[day(1)] === 55 && h.marks[day(0)] === 12, h.marks);
  check("a re-read waits for review", d.settings.waypage.review && d.settings.waypage.review.c4 && d.settings.waypage.review.c4.reason === "logged");

  await page.evaluate(() => document.querySelector('.tab[data-view="home"]').click()); await page.waitForTimeout(500);
  const tile = await page.evaluate(() => [...document.querySelectorAll(".home-tile")].map((t) => t.getAttribute("aria-label") + ":" + (t.querySelector(".home-tile-count") || {}).textContent));
  check("Home shows how far you are", tile.includes("The Quiet Orbit:62%") && tile.includes("Saltmarsh Letters:ch 3/17"), tile);

  await page.evaluate(() => window.LifeLogSettings.openSettings("conn-waypage")); await page.waitForTimeout(500);
  const labels = await page.$$eval("#waypageKinds .sitem-title", (xs) => xs.map((x) => x.textContent));
  check("Settings lists each kind with its category", labels.join(",") === "Books,Audiobooks,Comics,Serials,Articles", labels);
  check("and the review row", await page.isVisible("#waypageReview") && /Wren/.test(await page.textContent("#waypageReviewList")));
  await page.click("#waypageReviewList button:has-text('Add')"); await page.waitForTimeout(500);
  d = await data();
  check("Add brings the re-read in as in progress", d.backlog.some((x) => x.waypageId === "c4" && x.startedAt) && !d.settings.waypage.review.c4);
  check("and the row is gone", await page.isHidden("#waypageReview"));

  const before = asks.length;
  await page.click("#waypageCheckBtn"); await page.waitForTimeout(800);
  check("Check now reads again", asks.length === before + 1);
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem("lifelog-waypage-v1")); c.checkedAt = 0; localStorage.setItem("lifelog-waypage-v1", JSON.stringify(c)); });
  await page.evaluate(() => window.LifeLogWaypage.check()); await page.waitForTimeout(600);
  check("a later read sends the ETag back", asks[asks.length - 1]["if-none-match"] === '"v1"', asks[asks.length - 1]);
  d = await data();
  check("and nothing came in twice", d.backlog.filter((x) => x.waypageId === "c2").length === 1 && d.entries.filter((e) => e.waypageId === "c3").length === 1);

  await b.close();
  done(errs);
})();
