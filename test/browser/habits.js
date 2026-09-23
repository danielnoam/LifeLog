// The Habits tab (0.171.0). The cadence and streak maths is covered without a
// browser in test/habits.test.js; this is the part only a browser can answer —
// that a tap records the right day, that the grid lets you fix a day you
// forgot, and that archiving keeps the history rather than throwing it away.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

// 2026-09-23 is a Wednesday. Frozen, so the grid and the streaks are the same
// on every run rather than on the day the suite happens to be run.
const TODAY = "2026-09-23";
const back = (n) => { const d = new Date(TODAY + "T00:00:00"); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

const start40 = back(40);
const base = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {},
};
const habit = (o) => ({
  id: "h1", name: "Read before bed", color: "#5b8cff", cadence: "daily", target: 1, order: 1,
  startedAt: back(40), createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...o,
});

async function app(browser, habits, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 460, height: 1100 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript((iso) => {
    const fixed = new Date(iso).getTime(); const Real = Date;
    Date = class extends Real { constructor(...a) { if (!a.length) super(fixed); else super(...a); } static now() { return fixed; } };
    Date.parse = Real.parse; Date.UTC = Real.UTC;
  }, TODAY + "T10:00:00");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(({ b, h }) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "habits" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify({ ...b, habits: h }));
    localStorage.removeItem("lifelog-visual-settings-v1");
    localStorage.removeItem("lifelog-github-v1");
  }, { b: base, h: habits });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(600);
  return { page, ctx, errs };
}

const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).habits);

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // ---- 1. an empty tab explains what a habit is ----
  {
    const { page, ctx, errs: e } = await app(browser, []);
    const txt = await page.evaluate(() => document.querySelector("#viewBody").innerText);
    check("with no habits it says what one is, and offers to add one",
      /keep doing rather than something you finish/.test(txt) && /Add your first habit/.test(txt), txt.slice(0, 60));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 2. ticking today ----
  {
    const marks = {}; for (const n of [1, 2, 3]) marks[back(n)] = 1;
    const { page, ctx, errs: e } = await app(browser, [habit({ marks })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });

    const before = await page.evaluate(() => ({
      streak: document.querySelector(".habit-streak").textContent.trim(),
      tick: document.querySelector(".habit-tick").textContent.trim(),
      done: document.querySelector(".habit-tick").classList.contains("is-done"),
      today: document.querySelector(".habit-today").innerText.replace(/\s+/g, " "),
    }));
    // Three days up to yesterday, today untouched: the run still stands,
    // because the day isn't over.
    check("yesterday's run shows before today is ticked", /3/.test(before.streak) && !before.done, before);
    check("and the header counts today honestly", /0 of 1/.test(before.today), before.today);

    await page.click(".habit-tick");
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      streak: document.querySelector(".habit-streak").textContent.trim(),
      done: document.querySelector(".habit-tick").classList.contains("is-done"),
      today: document.querySelector(".habit-today").innerText.replace(/\s+/g, " "),
    }));
    check("a tap ticks today and extends the streak", /4/.test(after.streak) && after.done, after);
    check("and the header follows", /1 of 1/.test(after.today), after.today);
    check("the right day was recorded, not some other one",
      (await stored(page))[0].marks[TODAY] === 1, (await stored(page))[0].marks);

    await page.click(".habit-tick");
    await page.waitForTimeout(500);
    check("tapping again unticks it, and the day leaves the record entirely",
      !(TODAY in (await stored(page))[0].marks), (await stored(page))[0].marks);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 3. a target counts up rather than toggling ----
  {
    const { page, ctx, errs: e } = await app(browser, [habit({ name: "Water", target: 3 })]);
    await page.waitForSelector(".habit-tick", { timeout: 8000 });
    const read = () => page.evaluate(() => ({
      label: document.querySelector(".habit-tick").innerText.replace(/\s+/g, " "),
      done: document.querySelector(".habit-tick").classList.contains("is-done"),
    }));
    check("it starts at none of the target", /0 of 3 today/.test((await read()).label), (await read()).label);
    for (const want of [1, 2, 3]) {
      await page.click(".habit-tick");
      await page.waitForTimeout(400);
      const r = await read();
      if (want < 3) check(`${want} of 3 is counted but not done`, new RegExp(want + " of 3").test(r.label) && !r.done, r);
      else check("reaching the target is done", r.done, r);
    }
    await page.click(".habit-tick");
    await page.waitForTimeout(400);
    check("and one more tap wraps back round to none",
      /0 of 3 today/.test((await read()).label), (await read()).label);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 4. the grid: fixing a day you forgot ----
  {
    const { page, ctx, errs: e } = await app(browser, [habit({})]);
    await page.waitForSelector(".habit-grid", { timeout: 8000 });
    const shape = await page.evaluate(() => ({
      rows: document.querySelectorAll(".habit-grid-row").length,
      future: document.querySelectorAll(".habit-cell.is-future").length,
      futureDisabled: [...document.querySelectorAll(".habit-cell.is-future")].every((c) => c.disabled),
    }));
    check("a daily habit gets all seven weekday rows", shape.rows === 7, shape);
    check("days that haven't happened yet are there but not tappable",
      shape.future > 0 && shape.futureDisabled, shape);

    // Tap the cell for three days ago.
    await page.evaluate((d) => {
      const cell = [...document.querySelectorAll(".habit-cell")].find((c) => (c.title || "").startsWith(d));
      cell.click();
    }, back(3));
    await page.waitForTimeout(500);
    check("tapping a past day records that day",
      (await stored(page))[0].marks[back(3)] === 1, (await stored(page))[0].marks);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 5. a cadence shows only the days it asks for ----
  {
    const { page, ctx, errs: e } = await app(browser, [habit({ name: "Run", cadence: { days: [1, 3, 5] } })]);
    await page.waitForSelector(".habit-grid", { timeout: 8000 });
    const g = await page.evaluate(() => ({
      rows: document.querySelectorAll(".habit-grid-row").length,
      sub: document.querySelector(".habit-sub").innerText.replace(/\s+/g, " "),
      offCells: document.querySelectorAll(".habit-cell.is-off").length,
    }));
    // Mon/Wed/Fri drawn on seven rows is four permanently empty ones.
    check("a three-day habit draws three rows, not seven with gaps", g.rows === 3, g);
    check("and says which days in words", /Mon, Wed, Fri/.test(g.sub), g.sub);
    // Off-cells do appear in those rows, but only for days before the habit
    // existed — it asked nothing of those either.
    check("every off-day in those rows predates the habit",
      await page.evaluate((start) => [...document.querySelectorAll(".habit-cell.is-off")]
        .every((c) => (c.title || "").slice(0, 10) < start), start40),
      g.offCells);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 6. not due today says so instead of offering a tick ----
  {
    // TODAY is a Wednesday; this one only runs at weekends.
    const { page, ctx, errs: e } = await app(browser, [habit({ name: "Long walk", cadence: { days: [0, 6] } })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    check("a habit not due today offers no tick, and explains why",
      await page.evaluate(() => !document.querySelector(".habit-tick") && /Not due today/.test(document.querySelector(".habit-notdue").textContent)));
    check("and it isn't counted in today's tally either",
      await page.evaluate(() => !document.querySelector(".habit-today")));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 7. add, edit, archive ----
  {
    const { page, ctx, errs: e } = await app(browser, []);
    await page.click("#addBtn");
    await page.waitForTimeout(250);
    await page.click('#addMenu [data-add="habit"]');
    await page.waitForSelector("#habitModal:not([hidden])", { timeout: 5000 });
    await page.fill("#habitName", "Stretch");
    await page.selectOption("#habitCadence", "days");
    await page.waitForTimeout(200);
    check("picking certain days reveals the day pickers",
      await page.evaluate(() => !document.querySelector("#habitDaysLabel").hidden));
    await page.evaluate(() => {
      const boxes = [...document.querySelectorAll("#habitDays input")];
      boxes.forEach((b, i) => { b.checked = (i === 2 || i === 4); });
    });
    await page.click("#habitForm button[type=submit]");
    await page.waitForSelector("#habitModal", { state: "hidden", timeout: 5000 });
    await page.waitForTimeout(500);
    const made = (await stored(page))[0];
    check("the habit is created with the days you picked",
      made.name === "Stretch" && JSON.stringify(made.cadence) === JSON.stringify({ days: [2, 4] }), made);
    check("and it starts today, not at the epoch", made.startedAt === TODAY, made.startedAt);

    // Archive it, and check the record survives.
    await page.evaluate(() => {
      const h = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
      h.habits[0].marks = { "2026-09-22": 1 };
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(h));
    });
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(600);
    await page.click(".habit-name");
    await page.waitForSelector("#habitModal:not([hidden])", { timeout: 5000 });
    await page.click("#archiveHabitBtn");
    await page.waitForTimeout(600);
    const archived = (await stored(page))[0];
    check("archiving keeps the habit and its record", archived.archivedAt === TODAY && archived.marks["2026-09-22"] === 1, archived);
    check("and it drops out of the live list into its own section",
      await page.evaluate(() => !document.querySelector(".habit-card") && !!document.querySelector(".habit-archived-row")));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 8. search narrows the tab, and badges it from elsewhere ----
  {
    const { page, ctx, errs: e } = await app(browser, [habit({ id: "a", name: "Read" }), habit({ id: "b", name: "Run", order: 2 })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    await page.evaluate(() => { const s = document.querySelector("#search"); s.value = "Read"; s.oninput({ target: s }); });
    await page.waitForTimeout(500);
    const names = await page.evaluate(() => [...document.querySelectorAll(".habit-name")].map((n) => n.textContent));
    check("search narrows the habits like every other view", names.length === 1 && names[0] === "Read", names);
    errs.push(...e);
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
