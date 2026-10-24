// One date picker per entry date (0.281.0): Finished and Started, each a
// day, in place of a year box and a month list. The entry is still filed by
// year and month; the day is kept (`day`, `startedAt`) for later. An entry
// from before has no day, and saving it untouched mustn't invent one.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  entries: [
    { id: "old", title: "Old one", category: "Games", year: 2025, month: 6, date: "2025-06", createdAt: "2025-06-01T00:00:00.000Z" },
    { id: "span", title: "Long one", category: "Games", year: 2025, month: 9, date: "2025-09", startYear: 2025, startMonth: 7, createdAt: "2025-09-01T00:00:00.000Z" },
  ],
  backlog: [], accomplishments: {}, notes: [], habits: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const width of [390, 1280]) {
    const at = " (" + width + "px)";
    const page = await b.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "entries" }));
    }, SEED);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const entry = (id) => page.evaluate((i) => window.LifeLogStorage.cachedCopy().entries.find((e) => e.id === i || e.title === i), id);
    const open = (id) => page.evaluate((i) => window.LifeLogJournal.openEntryModal(window.LifeLogStorage.cachedCopy().entries.find((e) => e.id === i)), id);
    const save = async () => { await page.click('#entryForm button[type="submit"]'); await page.waitForTimeout(400); };
    const fields = () => page.evaluate(() => ({ done: document.getElementById("fDate").value, start: document.getElementById("fStartDate").value }));

    check("the sheet has one picker per date, and no year or month boxes" + at, await page.evaluate(() =>
      document.getElementById("fDate").type === "date" && document.getElementById("fStartDate").type === "date"
      && !document.getElementById("fYear") && !document.getElementById("fMonth") && !document.getElementById("fStartMonth")));

    // ---- a new entry keeps today's day ----
    await page.evaluate(() => window.LifeLogJournal.openEntryModal(null));
    await page.waitForTimeout(200);
    const now = new Date(), pad = (n) => String(n).padStart(2, "0");
    const today = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    check("a new entry starts on today, with no start" + at, JSON.stringify(await fields()) === JSON.stringify({ done: today, start: "" }), await fields());
    await page.screenshot({ path: require("path").join(require("os").tmpdir(), "entrydate-" + width + ".png") });
    await page.fill("#fTitle", "New one");
    await page.fill("#fStartDate", "2026-01-15");
    await page.fill("#fDate", "2026-03-04");
    await save();
    let e = await entry("New one");
    check("it's filed by year and month, and keeps the day" + at, e && e.year === 2026 && e.month === 3 && e.date === "2026-03" && e.day === 4, e);
    check("a start months before is a span, with its day" + at, e && e.startYear === 2026 && e.startMonth === 1 && e.startedAt === "2026-01-15", e);

    // ---- an old entry, saved untouched, gains no day ----
    await open("old");
    await page.waitForTimeout(200);
    check("an entry with no day shows its month's 1st" + at, (await fields()).done === "2025-06-01", await fields());
    await save();
    e = await entry("old");
    check("and saved untouched, it still has no day" + at, e.day === undefined && e.month === 6 && e.year === 2025, e);
    await open("old");
    await page.fill("#fDate", "2025-07-20");
    await save();
    e = await entry("old");
    check("a picked date moves it and keeps the day" + at, e.year === 2025 && e.month === 7 && e.day === 20 && e.date === "2025-07", e);

    // ---- an old span keeps its months, and can be cleared ----
    await open("span");
    await page.waitForTimeout(200);
    check("an old span's start shows its month" + at, (await fields()).start === "2025-07-01", await fields());
    await save();
    e = await entry("span");
    check("saved untouched, the span stays and no start day is made up" + at, e.startMonth === 7 && e.startYear === 2025 && !e.startedAt, e);
    await open("span");
    await page.fill("#fStartDate", "");
    await save();
    e = await entry("span");
    check("clearing Started makes it one month" + at, !e.startMonth && !e.startYear && !e.startedAt, e);

    // ---- a start after the finish isn't a start ----
    await open("span");
    await page.fill("#fStartDate", "2025-12-01");
    await save();
    e = await entry("span");
    check("a start after the finish is dropped" + at, !e.startMonth && !e.startedAt, e);
    await page.close();
  }
  await b.close();
  done(errs);
})();
