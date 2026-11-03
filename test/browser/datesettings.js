// Settings → Appearance → Dates (0.301.0): the week start and the date
// format, chosen in Settings and followed by the calendar and the habits.
// Also the foot of Settings: no version, the ? hint only with a mouse, and
// ? working while Settings is open.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }],
  entries: [
    { id: "c", title: "Late Game", category: "Games", year: 2025, month: 3, day: 28, createdAt: "2025-03-28T00:00:00.000Z" },
  ],
  habits: [
    { id: "g", name: "Gym", color: "#f66151", period: "week", target: 3, cadence: "daily", startedAt: "2025-01-01", order: 0, marks: {} },
  ],
  backlog: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [], settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "entries" }));
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ timelineLayout: "calendar", outTodaySheet: "hide" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const firstDayIndex = () => page.evaluate(() => [...document.querySelectorAll(".cal-day")].findIndex((d) => d.dataset.day === "1"));
  check("by default the calendar starts on Sunday (1 March 2025 is a Saturday)", (await firstDayIndex()) === 6);
  check("and the day card reads 28 Mar", (await page.textContent(".cal-daycard h3")).startsWith("Fri 28 Mar"), await page.textContent(".cal-daycard h3"));

  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  const foot = await page.textContent(".settings-foot");
  check("the foot of Settings has no version", !/v\d+\.\d+/.test(foot) && /keyboard shortcuts/.test(foot), foot);
  check("and shows on a computer", await page.isVisible(".settings-foot"));
  await page.keyboard.press("?"); await page.waitForTimeout(300);
  check("? with Settings open opens the shortcuts", !(await page.isHidden("#shortcutsModal")) && await page.isHidden("#settingsModal"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);

  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  await page.click('.srow[data-page="appearance"]'); await page.waitForTimeout(300);
  const labels = await page.$$eval("#dateFormat option", (o) => o.map((x) => x.textContent));
  check("the formats show a real date each", labels.join("|") === "3 Nov 2026|Nov 3, 2026|03/11/2026|11/03/2026|2026-11-03", labels);
  check("Sunday is picked until you choose", (await page.inputValue("#weekStart")) === "0");
  await page.selectOption("#weekStart", "6"); await page.waitForTimeout(200);
  await page.selectOption("#dateFormat", "dmy-num"); await page.waitForTimeout(300);
  const saved = await page.evaluate(() => { const d = window.LifeLogStorage.cachedCopy(); return d && d.settings; });
  check("both are saved in the synced settings", saved && saved.weekStart === 6 && saved.dateFormat === "dmy-num", saved);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  check("the calendar now starts on Saturday", (await firstDayIndex()) === 0 && (await page.textContent(".cal-wd")) === "Sat");
  check("and the day card reads 28/03", (await page.textContent(".cal-daycard h3")).startsWith("Fri 28/03"), await page.textContent(".cal-daycard h3"));

  await page.evaluate(() => { localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "habits" })); });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const firstRow = await page.$eval(".habit-card .habit-grid-row .habit-cell", (c) => c.dataset.date);
  check("a habit grid's top row is Saturday, after a reload", new Date(firstRow + "T00:00:00").getDay() === 6, firstRow);

  const phone = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto(BASE + "/", { waitUntil: "networkidle" });
  await phone.waitForTimeout(400);
  await phone.click("#settingsBtn"); await phone.waitForTimeout(300);
  check("on a phone the ? hint is hidden", await phone.isHidden(".settings-foot"));

  check("no console errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
