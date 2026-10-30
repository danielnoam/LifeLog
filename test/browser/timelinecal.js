// The Timeline's calendar layout (0.291.0).
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const art = (fill) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${fill}"/></svg>`);
const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }, { id: "books", name: "Books", color: "#3fb27f" }],
  entries: [
    { id: "a", title: "Early Game", category: "Games", year: 2025, month: 3, day: 9, coverUrl: art("#2d4f8f"), createdAt: "2025-03-09T00:00:00.000Z" },
    { id: "b", title: "Same Day Book", category: "Books", year: 2025, month: 3, day: 9, createdAt: "2025-03-09T01:00:00.000Z" },
    { id: "c", title: "Late Game", category: "Games", year: 2025, month: 3, day: 28, rating: 4, coverUrl: art("#6b3f8f"), createdAt: "2025-03-28T00:00:00.000Z" },
    { id: "d", title: "No Day Book", category: "Books", year: 2025, month: 3, createdAt: "2025-03-02T00:00:00.000Z" },
    { id: "e", title: "February Game", category: "Games", year: 2025, month: 2, day: 14, createdAt: "2025-02-14T00:00:00.000Z" },
  ],
  backlog: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [], settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const shots = process.env.LIFELOG_SHOTS;
  const page = await b.newPage({ viewport: { width: 400, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  await page.click("#viewOptionsBtn"); await page.waitForTimeout(300);
  await page.selectOption("#timelineLayout", "calendar"); await page.waitForTimeout(300);
  await page.click("#closeViewOptionsBtn"); await page.waitForTimeout(400);

  check("View → Layout → Calendar opens on the latest month with entries", (await page.textContent(".cal-title")) === "March 2025", await page.textContent(".cal-title"));
  check("the month cards and the sort are out of the way", await page.isHidden(".timeline-toolbar") && (await page.$$("#viewBody .year-block:visible")).length === 0);
  check("the month starts on its weekday (1 March 2025 is a Saturday)",
    await page.evaluate(() => [...document.querySelectorAll(".cal-day")].findIndex((d) => d.dataset.day === "1")) === 6);
  check("a day with two shows its first cover and +1",
    !!(await page.$('.cal-day[data-day="9"] img.cal-cover')) && (await page.textContent('.cal-day[data-day="9"] .cal-more')) === "+1");
  check("the latest day with entries starts picked", (await page.getAttribute('.cal-day[data-day="28"]', "aria-pressed")) === "true");
  check("its entries list beside it", (await page.textContent(".cal-daycard h3")).includes("28 Mar") && (await page.$$(".cal-daycard .entry")).length === 1);
  check("an entry with no day sits in No day set", (await page.textContent(".cal-undated h3")) === "No day set · 1" && (await page.textContent(".cal-undated")).includes("No Day Book"));
  if (shots) await page.screenshot({ path: shots + "/cal-phone.png", fullPage: true });

  await page.click('.cal-day[data-day="9"]'); await page.waitForTimeout(300);
  check("tapping a day lists what you finished on it", (await page.$$(".cal-daycard .entry")).length === 2);
  await page.click('.cal-daycard .entry[data-id="b"]'); await page.waitForTimeout(400);
  check("and an entry opens its sheet", !(await page.isHidden("#entryModal")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  await page.click('.cal-step[aria-label="Previous month"]'); await page.waitForTimeout(300);
  check("‹ goes to the month before", (await page.textContent(".cal-title")) === "February 2025" && !!(await page.$('.cal-day[data-day="14"].has-entries')));
  await page.click('.cal-step[aria-label="Next month"]'); await page.waitForTimeout(300);

  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(400);
  check("a desktop cell names its entries", (await page.textContent('.cal-day[data-day="9"] .cal-names')).includes("Same Day Book"));
  if (shots) await page.screenshot({ path: shots + "/cal-desktop.png" });

  check("no console errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
