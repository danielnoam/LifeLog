// Habits (0.171.1), Notes' third mode. The cadence and streak maths is covered without a
// browser in test/habits.test.js; this is the part only a browser can answer —
// that a tap records the right day, that the grid lets you fix a day you
// forgot, and that archiving keeps the history rather than throwing it away.
const { chromium, BASE, settled } = require("./harness");
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
  // Recorded as well as answered: the backfill offer is only worth anything
  // if it says how many days it is about to fill in.
  const dialogs = [];
  const ask = { accept: true };
  page.on("dialog", (d) => { dialogs.push(d.message()); ask.accept ? d.accept() : d.dismiss(); });
  await page.addInitScript((iso) => {
    const fixed = new Date(iso).getTime(); const Real = Date;
    Date = class extends Real { constructor(...a) { if (!a.length) super(fixed); else super(...a); } static now() { return fixed; } };
    Date.parse = Real.parse; Date.UTC = Real.UTC;
  }, TODAY + "T10:00:00");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(({ b, h }) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "habits" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify({ ...b, habits: h }));
    localStorage.removeItem("lifelog-visual-settings-v1");
    localStorage.removeItem("lifelog-github-v1");
  }, { b: base, h: habits });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(600);
  return { page, ctx, errs, dialogs, ask };
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
    await settled(page);
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

  // ---- 7b. Notes' third mode, and the way back from the old tab ----
  {
    const { page, ctx, errs: e } = await app(browser, [habit({})]);
    const bar = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll("#viewTabs .tab")].filter((t) => !t.hidden).map((t) => t.dataset.view),
      notesDots: document.querySelectorAll('#viewTabs .tab[data-view="notes"] .tab-mode-dot').length,
      active: (document.querySelector("#viewTabs .tab.active") || {}).dataset,
    }));
    check("habits has no tab of its own", !bar.tabs.includes("habits") && bar.tabs.length === 4, bar.tabs);
    check("it is Notes' third mode", bar.notesDots === 3 && bar.active.view === "notes", bar);
    check("and the card still renders there", await page.evaluate(() => !!document.querySelector(".habit-card")));

    // Anyone who left the app on 0.171.0's tab has view: "habits" saved.
    await page.evaluate(() => localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "habits" })));
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(700);
    const landed = await page.evaluate(() => ({
      view: (document.querySelector("#viewTabs .tab.active") || {}).dataset.view,
      card: !!document.querySelector(".habit-card"),
    }));
    check("a saved 'habits' tab lands in its new home rather than nowhere",
      landed.view === "notes" && landed.card, landed);
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

  // ---- 9. backfilling: a start date you can move, and the offer beside it ----
  // Until 0.172.0 the start date was pinned to the day you created the habit,
  // so a habit you had kept for months arrived with no history and no way to
  // give it any. 0.173.0 moved the offer out of a native confirm and into the
  // modal, where you meet it before pressing Save rather than after.
  {
    const { page, ctx, errs: e } = await app(browser, [habit({ startedAt: back(40) })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    await page.click(".habit-name");
    await page.waitForSelector("#habitModal:not([hidden])", { timeout: 5000 });
    const field = await page.evaluate(() => ({
      value: document.querySelector("#habitStart").value,
      max: document.querySelector("#habitStart").max,
      offer: getComputedStyle(document.querySelector("#habitFillLabel")).display,
      hint: !document.querySelector("#habitStartHint").hidden,
    }));
    check("the modal opens on the habit's real start date, capped at today",
      field.value === back(40) && field.max === TODAY, field);
    check("and offers nothing until you move it", field.offer === "none" && !field.hint, field);

    await page.evaluate((d) => {
      const i = document.querySelector("#habitStart");
      i.value = d; i.oninput({ target: i });
    }, back(100));
    await page.waitForTimeout(150);
    const offer = await page.evaluate(() => ({
      shown: getComputedStyle(document.querySelector("#habitFillLabel")).display !== "none",
      text: document.querySelector("#habitFillText").textContent,
      checked: document.querySelector("#habitFill").checked,
    }));
    check("moving the start back offers the days it uncovered, with the count",
      offer.shown && /\b60 days\b/.test(offer.text), offer);
    check("and the offer starts unticked — the app doesn't assume you kept it",
      offer.checked === false, offer);

    // Leave it unticked: the date is a fact, the marks are a claim.
    await page.click("#habitForm button[type=submit]");
    await page.waitForSelector("#habitModal", { state: "hidden", timeout: 5000 });
    await page.waitForTimeout(600);
    let h = (await stored(page))[0];
    check("saving without ticking it moves the date", h.startedAt === back(100), h.startedAt);
    check("and records nothing you didn't claim", !h.marks || !Object.keys(h.marks).length, h.marks);

    // Declining doesn't put it out of reach: the offer comes back with the
    // next move, and a run can be filled from the grid without touching the
    // date at all (section 11).
    await page.click(".habit-name");
    await page.waitForSelector("#habitModal:not([hidden])", { timeout: 5000 });
    await page.evaluate((d) => {
      const i = document.querySelector("#habitStart");
      i.value = d; i.oninput({ target: i });
    }, back(160));
    await page.waitForTimeout(150);
    await page.check("#habitFill");
    await page.click("#habitForm button[type=submit]");
    await page.waitForSelector("#habitModal", { state: "hidden", timeout: 5000 });
    await page.waitForTimeout(600);
    h = (await stored(page))[0];
    const filled = Object.keys(h.marks || {}).sort();
    check("ticking it fills every uncovered day and none of the later ones",
      filled.length === 60 && filled[0] === back(160) && filled[59] === back(101),
      { n: filled.length, first: filled[0], last: filled[59] });

    // ---- and it can be taken back ----
    const toastText = await page.evaluate(() => document.querySelector("#toast").innerText);
    check("the toast says what it did and offers to undo it",
      /Filled in 60 days/.test(toastText) && /Undo/.test(toastText), toastText);
    await page.click(".toast-action");
    await page.waitForTimeout(600);
    h = (await stored(page))[0];
    check("undo puts the marks back the way they were",
      !h.marks || !Object.keys(h.marks).length, h.marks);
    check("and the start date with them — a mistyped year is one press, not sixty",
      h.startedAt === back(100), h.startedAt);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 9b. moving the start forward says what it costs ----
  {
    const { page, ctx, errs: e } = await app(browser,
      [habit({ startedAt: back(40), marks: { [back(30)]: 1, [back(29)]: 1, [back(5)]: 1 } })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    await page.click(".habit-name");
    await page.waitForSelector("#habitModal:not([hidden])", { timeout: 5000 });
    await page.evaluate((d) => {
      const i = document.querySelector("#habitStart");
      i.value = d; i.oninput({ target: i });
    }, back(20));
    await page.waitForTimeout(150);
    const warn = await page.evaluate(() => ({
      shown: !document.querySelector("#habitStartHint").hidden,
      text: document.querySelector("#habitStartHint").textContent,
      offer: getComputedStyle(document.querySelector("#habitFillLabel")).display,
    }));
    check("moving it forward warns that recorded days stop counting",
      warn.shown && /\b2 recorded days\b/.test(warn.text), warn);
    check("and offers no backfill, because nothing was uncovered", warn.offer === "none", warn);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 9c. a habit born with a past start is offered the same deal ----
  {
    const { page, ctx, errs: e } = await app(browser, []);
    await page.click("#addBtn");
    await page.waitForTimeout(250);
    await page.click('#addMenu [data-add="habit"]');
    await page.waitForSelector("#habitModal:not([hidden])", { timeout: 5000 });
    await page.fill("#habitName", "Walk");
    await page.fill("#habitTarget", "3");
    await page.evaluate((d) => {
      const i = document.querySelector("#habitStart");
      i.value = d; i.oninput({ target: i });
    }, back(9));
    await page.waitForTimeout(150);
    const text = await page.evaluate(() => document.querySelector("#habitFillText").textContent);
    check("a new habit that started last week is offered its history",
      /\b9 days\b/.test(text), text);
    check("and the offer says it means three times each, rather than hiding it",
      /3× each/.test(text), text);
    await page.check("#habitFill");
    await page.click("#habitForm button[type=submit]");
    await page.waitForSelector("#habitModal", { state: "hidden", timeout: 5000 });
    await page.waitForTimeout(600);
    const h = (await stored(page))[0];
    const days = Object.keys(h.marks || {});
    check("and gets it, at the target, up to but not including today",
      days.length === 9 && !days.includes(TODAY) && h.marks[back(9)] === 3, h.marks);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 9d. the card says what the history is worth ----
  {
    const marks = {};
    for (let i = 1; i <= 200; i++) if (i % 4) marks[back(i)] = 1;
    const { page, ctx, errs: e } = await app(browser, [habit({ startedAt: back(200), marks })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    const life = await page.evaluate(() => {
      const n = document.querySelector(".habit-life");
      return n ? n.textContent : null;
    });
    // 200 days of life, 150 of them kept — none of which the 90-day figure says.
    check("a habit older than the 90-day window says how long and how much",
      life && /Since /.test(life) && /150 of 201 days kept/.test(life), life);
    await ctx.close();
    errs.push(...e);
  }

  // ---- 9e. and says nothing when there is nothing longer to say ----
  {
    const { page, ctx, errs: e } = await app(browser, [habit({ startedAt: back(20) })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    check("a young habit gets no lifetime line, because it would repeat the other one",
      await page.evaluate(() => !document.querySelector(".habit-life")));
    await ctx.close();
    errs.push(...e);
  }

  // ---- 10. the grid reaches the days the start date uncovered ----
  // The third thing. Twelve weeks of columns and no way past them makes a
  // movable start date decorative.
  {
    const { page, ctx, errs: e } = await app(browser, [habit({ startedAt: back(30) })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    check("a habit whose whole life fits the grid gets no arrows at all",
      await page.evaluate(() => !document.querySelector(".habit-grid-nav")));
    await ctx.close();
    errs.push(...e);
  }

  {
    const { page, ctx, errs: e } = await app(browser, [habit({ startedAt: back(300) })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    const nav0 = await page.evaluate(() => {
      const n = document.querySelector(".habit-grid-nav");
      if (!n) return null;
      const b = [...n.querySelectorAll(".habit-page")];
      return { back: b[0].disabled, fwd: b[1].disabled, range: n.querySelector(".habit-page-range").textContent };
    });
    check("a longer-lived habit gets arrows, starting at the present",
      nav0 && nav0.back === false && nav0.fwd === true, nav0);

    const far = back(120);
    let clicks = 0;
    while (clicks < 25 && !(await page.evaluate((d) => !!document.querySelector('.habit-cell[data-date="' + d + '"]'), far))) {
      await page.click('.habit-page[data-dir="1"]');
      await page.waitForTimeout(120);
      clicks++;
    }
    // One press is one window, not one week. At a week a press, a day four
    // months back was five presses away and a year back was fifty-two — the
    // arrows worked and were useless. This assertion is the difference.
    check("one press moves a whole window, so four months back is one press", clicks === 1, clicks);
    const nav1 = await page.evaluate(() => {
      const n = document.querySelector(".habit-grid-nav");
      return { fwd: n.querySelector('.habit-page[data-dir="-1"]').disabled, range: n.querySelector(".habit-page-range").textContent };
    });
    check("and the way forward opens up once you have gone back", nav1.fwd === false, nav1);
    check("the window says which months you are looking at", nav1.range !== nav0.range && /\d{4}/.test(nav1.range), nav1.range);

    await page.click('.habit-cell[data-date="' + far + '"]');
    await page.waitForTimeout(600);
    const h = (await stored(page))[0];
    check("and a cell that far back records the day you tapped", (h.marks || {})[far] === 1, h.marks);
    check("the card stays where you left it rather than snapping back to this week",
      await page.evaluate((d) => !!document.querySelector('.habit-cell[data-date="' + d + '"]'), far));

    // All the way back, and no further: the far end is the habit's own start.
    for (let i = 0; i < 40; i++) {
      if (await page.evaluate(() => document.querySelector('.habit-page[data-dir="1"]').disabled)) break;
      await page.click('.habit-page[data-dir="1"]');
      await page.waitForTimeout(80);
    }
    const end = await page.evaluate(() => ({
      stuck: document.querySelector('.habit-page[data-dir="1"]').disabled,
      first: (document.querySelector(".habit-grid-row .habit-cell") || {}).dataset.date || "",
    }));
    check("paging stops at the habit's start rather than running off into nothing",
      end.stuck && end.first <= back(300), end);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 11. fixing a run of days without tapping each one ----
  // The start date covers the history you had before the app knew about the
  // habit, which happens once per habit. The week you were away happens over
  // and over, and nine taps across two columns is where people stop bothering.
  {
    const { page, ctx, errs: e } = await app(browser, [habit({ startedAt: back(40) })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    const press = async (date, settle = 450) => {
      const box = await page.locator('.habit-cell[data-date="' + date + '"]').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
      await page.waitForTimeout(settle);
    };
    await press(back(9));
    const held = await page.evaluate(() => ({
      anchor: (document.querySelector(".habit-cell.is-anchor") || {}).dataset,
      hint: !!document.querySelector(".habit-range-hint"),
    }));
    check("holding a day marks it as one end of a run and says what to do next",
      held.anchor && held.anchor.date === back(9) && held.hint, held);

    await page.click('.habit-cell[data-date="' + back(1) + '"]');
    await page.waitForTimeout(600);
    let h = (await stored(page))[0];
    let days = Object.keys(h.marks || {}).sort();
    check("tapping the other end fills the whole run, inclusive",
      days.length === 9 && days[0] === back(9) && days[8] === back(1), days);
    check("and the run is undoable like any other bulk write",
      /Filled in 9 days/.test(await page.evaluate(() => document.querySelector("#toast").innerText)));

    // Held again over a run that is already kept, it clears instead — one
    // rule, and the outcome is the one you meant either way.
    await press(back(9));
    await page.click('.habit-cell[data-date="' + back(5) + '"]');
    await page.waitForTimeout(600);
    h = (await stored(page))[0];
    days = Object.keys(h.marks || {}).sort();
    check("holding over a run that is already kept clears it", days.length === 4 && days[0] === back(4), days);
    await page.click(".toast-action");
    await page.waitForTimeout(600);
    h = (await stored(page))[0];
    check("and that is undoable too", Object.keys(h.marks || {}).length === 9, h.marks);

    // The press's own click must not count as the second tap. This browser
    // drops that click (the grid node it started on was replaced when the
    // anchor was set, so there is no common ancestor for a click) — a touch
    // device sends it at the touch point regardless, so it is simulated here
    // rather than trusted not to happen. Without the guard this cancels.
    await press(back(20), 0);
    await page.click('.habit-cell[data-date="' + back(20) + '"]');
    await page.waitForTimeout(200);
    const still = await page.evaluate(() => !!document.querySelector(".habit-cell.is-anchor"));
    check("the click a touch device sends after a long press doesn't cancel it", still);
    await page.waitForTimeout(400);
    await page.click('.habit-cell[data-date="' + back(20) + '"]');
    await page.waitForTimeout(300);
    check("but tapping the held day again does",
      await page.evaluate(() => !document.querySelector(".habit-cell.is-anchor")));
    check("and cancelling records nothing",
      Object.keys((await stored(page))[0].marks || {}).length === 9);

    // The recovery path for "no, I'll do it later": hold one end, page the
    // grid to where the other end is, tap it. The anchor is a date, not a
    // cell, so it survives the window moving under it.
    await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
      c.habits[0].startedAt = "2026-01-01";
      c.habits[0].marks = {};
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(c));
    });
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(700);
    await press(back(2));
    await page.click('.habit-page[data-dir="1"]');
    await page.waitForTimeout(300);
    const kept = await page.evaluate(() => ({
      anchored: !!document.querySelector(".habit-range-hint"),
      oldest: (document.querySelector(".habit-grid-row .habit-cell") || {}).dataset.date,
    }));
    check("the held day survives paging the grid to find the other end", kept.anchored, kept);
    await page.click('.habit-cell[data-date="' + kept.oldest + '"]');
    await page.waitForTimeout(700);
    const spanned = Object.keys((await stored(page))[0].marks || {}).sort();
    check("and the run spans both windows", spanned.length > 12 * 7 &&
      spanned[0] === kept.oldest && spanned[spanned.length - 1] === back(2), spanned.length);

    // A weekends habit asked nothing of the weekdays in between.
    await settled(page);
    await page.evaluate((s) => {
      const c = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
      c.habits[0].cadence = { days: [0, 6] };
      c.habits[0].marks = {};
      c.habits[0].startedAt = s;
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(c));
    }, back(40));
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(700);
    // Both ends on a Sunday: a weekends habit has no Tuesday row to hold.
    await press(back(17));
    await page.click('.habit-cell[data-date="' + back(3) + '"]');
    await page.waitForTimeout(600);
    h = (await stored(page))[0];
    const dows = Object.keys(h.marks || {}).map((d) => new Date(d + "T00:00:00").getDay());
    check("a run only fills the days the habit actually asked for",
      dows.length > 0 && dows.every((d) => d === 0 || d === 6), Object.keys(h.marks || {}));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 11c. the count is what changed, not how far you reached ----
  {
    const marks = {};
    for (let i = 1; i <= 5; i++) marks[back(i)] = 1;
    const { page, ctx, errs: e } = await app(browser, [habit({ startedAt: back(40), marks })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    const box = await page.locator('.habit-cell[data-date="' + back(8) + '"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(450);
    await page.click('.habit-cell[data-date="' + back(1) + '"]');
    await page.waitForTimeout(600);
    const said = await page.evaluate(() => document.querySelector("#toast").innerText);
    // Eight days reached over, five of them already kept.
    check("a run over days that were already kept counts only what it changed",
      /Filled in 3 days/.test(said), said);
    check("and the whole run is kept afterwards either way",
      Object.keys((await stored(page))[0].marks || {}).length === 8);
    errs.push(...e);
    await ctx.close();
  }

  // ---- 11b. shift-click is the same thing without the wait ----
  {
    const { page, ctx, errs: e } = await app(browser, [habit({ startedAt: back(40) })]);
    await page.waitForSelector(".habit-card", { timeout: 8000 });
    await page.click('.habit-cell[data-date="' + back(12) + '"]');
    await page.waitForTimeout(400);
    await page.click('.habit-cell[data-date="' + back(8) + '"]', { modifiers: ["Shift"] });
    await page.waitForTimeout(600);
    const days = Object.keys((await stored(page))[0].marks || {}).sort();
    check("shift-clicking extends from the last day you tapped",
      days.length === 5 && days[0] === back(12) && days[4] === back(8), days);
    errs.push(...e);
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
