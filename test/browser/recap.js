// The year Recap (0.167.0): a full-screen player over all four views.
// The unit tests cover what it says; this covers the parts only a browser
// can answer — that it opens, moves, ends, offers itself in December exactly
// once, and doesn't do so in June.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const Y = 2026;
const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }, { id: "f", name: "Film", color: "#e2554b" }],
  entries: [
    ...Array.from({ length: 9 }, (_, i) => ({
      id: "e" + i, title: "Game " + (i % 4), category: i % 2 ? "Games" : "Film",
      year: Y, month: 1 + (i % 4) + (i < 5 ? 6 : 0), date: `${Y}-0${Math.min(9, 1 + (i % 4))}`,
      rating: i === 0 ? 5 : 3, createdAt: `${Y}-03-01T00:00:00.000Z`, updatedAt: `${Y}-03-01T00:00:00.000Z`,
      ...(i === 1 ? { backlogAddedAt: "2024-01-01T00:00:00.000Z" } : {}),
    })),
    { id: "p1", title: "Old", category: "Games", year: Y - 1, month: 2, date: `${Y - 1}-02`,
      createdAt: `${Y - 1}-02-01T00:00:00.000Z`, updatedAt: `${Y - 1}-02-01T00:00:00.000Z` },
  ],
  backlog: [], notes: [{ id: "n1", text: "A note", createdAt: `${Y}-04-01T00:00:00.000Z`, updatedAt: `${Y}-04-01T00:00:00.000Z` }],
  todos: [], todoCategories: [], projects: [],
  financeEntries: [{ id: "f1", title: "Coffee", amount: 42, category: "Food", date: `${Y}-03-02`, updatedAt: `${Y}-01-01T00:00:00.000Z` }],
  recurringExpenses: [],
  financeCategories: [{ id: "food", name: "Food", color: "#4bc46a", updatedAt: `${Y}-01-01T00:00:00.000Z` }],
  settings: { currency: "ILS" },
  accomplishments: { [Y]: [{ id: "a1", text: "Ran a half marathon" }] },
};

async function app(browser, { now, seed = SEED, visual } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1100 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  // Freeze the clock before any app code runs, so "is it December" is the
  // test's decision and not the day the suite happens to be run.
  if (now) {
    await page.addInitScript((iso) => {
      const fixed = new Date(iso).getTime();
      const Real = Date;
      // eslint-disable-next-line no-global-assign
      Date = class extends Real {
        constructor(...a) { if (!a.length) super(fixed); else super(...a); }
        static now() { return fixed; }
      };
      Date.parse = Real.parse; Date.UTC = Real.UTC;
    }, now);
  }
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(({ s, v }) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "stats" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
    localStorage.removeItem("lifelog-github-v1");
    if (v) localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v));
    else localStorage.removeItem("lifelog-visual-settings-v1");
  }, { s: seed, v: visual });
  await page.reload({ waitUntil: "load" });
  return { page, ctx, errs };
}

const slide = (page) => page.evaluate(() => {
  const st = document.querySelector("#recapStage");
  const s = st && st.firstElementChild;
  if (!s) return null;
  return {
    kind: [...s.classList].find((c) => /^recap-(title|big|bars|list)$/.test(c)),
    text: s.innerText.replace(/\s+/g, " ").trim(),
    count: document.querySelector("#recapCount").textContent,
    segs: document.querySelectorAll("#recapBar .recap-seg").length,
    done: document.querySelectorAll("#recapBar .recap-seg.is-done").length,
  };
});

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  // ---- 1. the card is renamed and offers the way in ----
  {
    const { page, ctx, errs: e } = await app(browser, { now: "2026-06-15T12:00:00" });
    await page.waitForSelector(".yir-card", { timeout: 8000 });
    const head = await page.evaluate(() => ({
      title: document.querySelector(".yir-card h2").textContent,
      btn: !!document.querySelector(".recap-open-btn"),
      anyOldName: document.body.innerText.includes("Year in Review"),
    }));
    check("the stats card is no longer called Year in Review", head.title === "That year in numbers" && !head.anyOldName, head);
    check("and it carries the button that opens the recap", head.btn, head);

    // ---- 2. it does not volunteer itself in June ----
    await page.waitForTimeout(1400);
    check("nothing opens on its own in June", await page.isHidden("#recapScreen"));

    // ---- 3. opening, moving, and the progress bar ----
    await page.click(".recap-open-btn");
    await page.waitForSelector("#recapScreen:not([hidden])", { timeout: 5000 });
    const first = await slide(page);
    check("it opens on the year itself", first.kind === "recap-title" && /2026/.test(first.text), first);
    check("the progress bar has one segment per slide", first.segs > 3 && first.done === 1, first);
    check("and the counter agrees with it", first.count === "1 / " + first.segs, first);

    await page.click("#recapNextBtn");
    await page.waitForTimeout(250);
    const second = await slide(page);
    check("tapping the right-hand zone moves forward", second.count === "2 / " + first.segs, second);
    check("the second slide is the count of what you logged", /9 things logged/.test(second.text), second.text);
    check("and it compares with last year", /up 8 on last year/.test(second.text), second.text);

    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(250);
    check("← goes back", (await slide(page)).count === "1 / " + first.segs);
    check("and it can't go back past the first slide", (await page.evaluate(() => document.querySelector("#recapPrevBtn").disabled)) === true);

    // ---- 4. every slide has something on it ----
    const seen = [];
    for (let i = 0; i < first.segs; i++) {
      const s = await slide(page);
      if (s) seen.push(s.text);
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(160);
    }
    check("no slide is blank", seen.length === first.segs && seen.every((t) => t.length > 3), seen.map((t) => t.slice(0, 22)));
    check("the four views are all represented",
      seen.some((t) => /logged/.test(t)) && seen.some((t) => /note/.test(t))
      && seen.some((t) => /42/.test(t)) && seen.some((t) => /half marathon/.test(t)),
      seen.map((t) => t.slice(0, 30)));
    check("past the last slide it closes rather than trapping you", await page.isHidden("#recapScreen"));

    // ---- 4b. the slides that show things rather than count them ----
  {
    const cover = (h) => "data:image/svg+xml;base64," + Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="hsl(${h} 50% 40%)"/></svg>`
    ).toString("base64");
    const seed = {
      ...SEED,
      entries: [
        ...Array.from({ length: 7 }, (_, i) => ({
          id: "gx" + i, title: "Shown " + i, category: "Games", year: Y, month: 1 + i,
          date: `${Y}-0${1 + i}`, rating: i < 3 ? 5 : 2,
          coverUrl: i % 2 ? cover(i * 40) : "",
          createdAt: `${Y}-03-01T00:00:00.000Z`, updatedAt: `${Y}-03-01T00:00:00.000Z` })),
        // Logged twice, once with art: one tile, and it keeps the picture.
        { id: "d1", title: "Twice", category: "Film", year: Y, month: 2, date: `${Y}-02`, rating: 3,
          createdAt: `${Y}-03-01T00:00:00.000Z`, updatedAt: `${Y}-03-01T00:00:00.000Z` },
        { id: "d2", title: "Twice", category: "Film", year: Y, month: 5, date: `${Y}-05`, rating: 4,
          coverUrl: cover(300), createdAt: `${Y}-03-01T00:00:00.000Z`, updatedAt: `${Y}-03-01T00:00:00.000Z` },
      ],
      notes: [
        { id: "n1", text: "First line\nsecond line", createdAt: `${Y}-08-14T00:00:00.000Z`, updatedAt: `${Y}-08-14T00:00:00.000Z` },
        { id: "n2", text: "An older thought", createdAt: `${Y}-02-02T00:00:00.000Z`, updatedAt: `${Y}-02-02T00:00:00.000Z` },
      ],
    };
    const { page, ctx, errs: e } = await app(browser, { now: "2026-06-15T12:00:00", seed });
    await page.waitForSelector(".recap-open-btn", { timeout: 8000 });
    await page.click(".recap-open-btn");
    await page.waitForSelector("#recapScreen:not([hidden])", { timeout: 5000 });

    const find = async (cls) => {
      for (let i = 0; i < 20; i++) {
        if (await page.isHidden("#recapScreen")) return false;
        const hit = await page.evaluate((c) => {
          const s = document.querySelector("#recapStage").firstElementChild;
          return !!(s && s.classList.contains(c));
        }, cls);
        if (hit) return true;
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(140);
      }
      return false;
    };

    check("there is a wall of everything you logged", await find("recap-gallery"));
    const wall = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll(".recap-tile")];
      const grid = document.querySelector(".recap-grid");
      return {
        n: tiles.length,
        withArt: tiles.filter((t) => t.querySelector("img")).length,
        names: tiles.map((t) => t.querySelector(".recap-tile-name").textContent),
        scrolls: getComputedStyle(grid).overflowY,
        touch: getComputedStyle(grid).touchAction,
        pointer: getComputedStyle(grid).pointerEvents,
      };
    });
    check("one tile per title, not one per logging", wall.n === 8 && new Set(wall.names).size === 8, wall.n);
    check("the ones with art show it, the rest still get a tile",
      wall.withArt === 4 && wall.names.every((x) => x.trim().length > 0), wall);
    check("a title logged twice keeps the picture it had once",
      await page.evaluate(() => {
        const t = [...document.querySelectorAll(".recap-tile")]
          .find((x) => x.querySelector(".recap-tile-name").textContent === "Twice");
        return !!(t && t.querySelector("img"));
      }));
    // The gesture contract: scrolls vertically, leaves the horizontal axis to
    // the player so a swipe still moves on.
    check("the wall scrolls without stealing the swipe that advances the recap",
      wall.scrolls === "auto" && wall.touch === "pan-y" && wall.pointer === "auto", wall);

    check("and there is a slide of the notes themselves", await find("recap-cards"));
    const notes = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".recap-note")];
      return {
        n: cards.length,
        texts: cards.map((c) => c.querySelector(".recap-note-text").textContent),
        dates: cards.map((c) => c.querySelector(".recap-note-date").textContent),
        headline: document.querySelector(".recap-headline").textContent,
        wrap: getComputedStyle(document.querySelector(".recap-note-text")).whiteSpace,
      };
    });
    check("the notes are shown, newest first, not just counted",
      notes.n === 2 && notes.texts[0].startsWith("First line") && /2 notes/.test(notes.headline), notes);
    check("each note is dated", notes.dates.every((d) => /\w/.test(d)), notes.dates);
    check("a note keeps the line breaks you typed",
      notes.texts[0].includes("\n") && notes.wrap === "pre-wrap", { t: notes.texts[0], wrap: notes.wrap });
    errs.push(...e);
    await ctx.close();
  }

  // ---- 5. Escape closes it ----
    await page.click(".recap-open-btn");
    await page.waitForSelector("#recapScreen:not([hidden])", { timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check("Escape closes it", await page.isHidden("#recapScreen"));
    check("and the page can be scrolled again afterwards",
      !(await page.evaluate(() => document.body.classList.contains("modal-open"))));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 6. December: it offers itself, once ----
  {
    const { page, ctx, errs: e } = await app(browser, { now: "2026-12-05T10:00:00" });
    await page.waitForSelector("#recapScreen:not([hidden])", { timeout: 9000 });
    const s = await slide(page);
    check("in December it opens on its own, for this year", /2026/.test(s.text), s.text);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const seen = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-visual-settings-v1") || "{}").recapSeen);
    check("closing it records the year as seen", !!(seen && seen["2026"]), seen);

    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1800);
    check("and it does not come back on the next launch", await page.isHidden("#recapScreen"));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 7. early January looks back at the year just gone ----
  {
    const { page, ctx, errs: e } = await app(browser, { now: "2027-01-06T10:00:00" });
    await page.waitForSelector("#recapScreen:not([hidden])", { timeout: 9000 });
    check("the first fortnight of January recaps the year that just ended", /2026/.test((await slide(page)).text));
    errs.push(...e);
    await ctx.close();
  }

  // ---- 8. a year with nothing in it is never offered ----
  {
    const empty = { ...SEED, entries: [], notes: [], todos: [], financeEntries: [], accomplishments: {} };
    const { page, ctx, errs: e } = await app(browser, { now: "2026-12-05T10:00:00", seed: empty });
    await page.waitForTimeout(2000);
    check("an empty year is not offered a recap", await page.isHidden("#recapScreen"));
    const seen = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-visual-settings-v1") || "{}").recapSeen);
    check("and is not marked seen, so it still opens once there is something",
      !(seen && seen["2026"]), seen);
    errs.push(...e);
    await ctx.close();
  }

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
