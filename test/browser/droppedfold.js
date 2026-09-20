const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [
    { id: "games", name: "Games", color: "#5b8cff" },
    { id: "film", name: "Film", color: "#e2554b" },
    { id: "books", name: "Books", color: "#4bd07a" },
  ],
  backlog: [
    { id: "g1", title: "Kept One", category: "Games", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "g2", title: "Kept Two", category: "Games", priority: true, createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "g3", title: "Dropped A", category: "Games", dropped: true, createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "g4", title: "Dropped B", category: "Games", dropped: true, createdAt: "2026-01-04T00:00:00.000Z" },
    { id: "g5", title: "Dropped C", category: "Games", dropped: true, createdAt: "2026-01-05T00:00:00.000Z" },
    // A category that is nothing BUT dropped — the case with no band boundary.
    { id: "f1", title: "All Gone", category: "Film", dropped: true, createdAt: "2026-01-06T00:00:00.000Z" },
    { id: "f2", title: "Also Gone", category: "Film", dropped: true, createdAt: "2026-01-07T00:00:00.000Z" },
    // A category with no dropped items at all — must show no bar.
    { id: "k1", title: "Still Reading", category: "Books", createdAt: "2026-01-08T00:00:00.000Z" },
  ],
  entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [], settings: {},
};

const readCat = (page, cat) => page.evaluate((cat) => {
  const sec = [...document.querySelectorAll(".backlog-section")]
    .find((s) => s.querySelector(".backlog-section-name").textContent === cat);
  if (!sec) return null;
  const btn = sec.querySelector(".backlog-dropped-toggle");
  const r = btn ? btn.getBoundingClientRect() : null;
  return {
    titles: [...sec.querySelectorAll(".bl-title, .backlog-item-rich .bl-title")].map((t) => t.textContent),
    rows: sec.querySelectorAll(".backlog-item, .backlog-item-rich").length,
    bar: btn ? {
      text: btn.querySelector(".bdt-label").textContent,
      tag: btn.tagName, open: btn.classList.contains("is-open"),
      aria: btn.getAttribute("aria-expanded"),
      w: Math.round(r.width), h: Math.round(r.height),
      full: Math.abs(r.width - sec.querySelector(".backlog-list").getBoundingClientRect().width) < 6,
    } : null,
    plainSeps: sec.querySelectorAll(".backlog-priority-sep, .backlog-ea-sep, .backlog-upcoming-sep").length,
  };
}, cat);

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".backlog-section");
  await page.waitForTimeout(400);

  // --- 1. collapsed by default ---
  let games = await readCat(page, "Games");
  check("dropped rows are not rendered at all by default",
    games.rows === 2 && !games.titles.includes("Dropped A"), games);
  check("the bar is there, counting them", !!(games.bar && /Dropped 3/.test(games.bar.text)), games.bar);
  check("and reads as closed", games.bar.open === false && games.bar.aria === "false" && /▸/.test(games.bar.text), games.bar);
  check("it is a button, spanning the list like the other separators",
    games.bar.tag === "BUTTON" && games.bar.full && games.bar.h > 8, games.bar);
  check("the other band separators are untouched", games.plainSeps === 1, games);

  // --- 2. pressing it opens ---
  await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".backlog-section")]
      .find((s) => s.querySelector(".backlog-section-name").textContent === "Games");
    sec.querySelector(".backlog-dropped-toggle").click();
  });
  await page.waitForTimeout(350);
  games = await readCat(page, "Games");
  check("pressing it reveals every dropped row",
    games.rows === 5 && ["Dropped A", "Dropped B", "Dropped C"].every((t) => games.titles.includes(t)), games);
  check("the bar now reads as open", games.bar.open === true && games.bar.aria === "true" && /▾/.test(games.bar.text), games.bar);
  check("and still counts", /Dropped 3/.test(games.bar.text), games.bar);
  check("the dropped rows look dropped",
    (await page.evaluate(() => document.querySelectorAll(".backlog-section .is-dropped").length)) >= 3);

  // --- 3. pressing again closes ---
  await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".backlog-section")]
      .find((s) => s.querySelector(".backlog-section-name").textContent === "Games");
    sec.querySelector(".backlog-dropped-toggle").click();
  });
  await page.waitForTimeout(350);
  games = await readCat(page, "Games");
  check("pressing again collapses it", games.rows === 2 && games.bar.open === false, games);

  // --- 4. the edge cases ---
  const film = await readCat(page, "Film");
  check("a category with nothing but dropped items still gets a bar",
    !!(film.bar && /Dropped 2/.test(film.bar.text)), film);
  check("and its rows are reachable — they are not stranded", film.rows === 0, film);
  await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".backlog-section")]
      .find((s) => s.querySelector(".backlog-section-name").textContent === "Film");
    sec.querySelector(".backlog-dropped-toggle").click();
  });
  await page.waitForTimeout(350);
  check("opening an all-dropped category shows them", (await readCat(page, "Film")).rows === 2);

  const books = await readCat(page, "Books");
  check("a category with no dropped items shows no bar", books.bar === null && books.rows === 1, books);

  // --- 5. each category folds on its own ---
  const both = await page.evaluate(() => [...document.querySelectorAll(".backlog-dropped-toggle")]
    .map((b) => ({ cat: b.dataset.cat, open: b.classList.contains("is-open") })));
  check("Film is open while Games stays closed",
    both.find((x) => x.cat === "Film").open === true && both.find((x) => x.cat === "Games").open === false, both);

  // --- 6. bulk select-all must not reach what you cannot see ---
  const row = await page.$(".backlog-section .backlog-item, .backlog-section .backlog-item-rich");
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 8, box.y + Math.min(14, box.height / 2));
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await page.waitForSelector(".bulk-bar");
  const sel = await page.evaluate(async () => {
    const sec = [...document.querySelectorAll(".backlog-section")]
      .find((s) => s.querySelector(".backlog-section-name").textContent === "Games");
    sec.querySelector(".backlog-section-head .bulk-check").click();
    await new Promise((r) => setTimeout(r, 250));
    const ids = [...window.LifeLogApp.getBulkSelection ? window.LifeLogApp.getBulkSelection() : []];
    return { count: document.querySelector(".bulk-count").textContent,
             visible: sec.querySelectorAll(".backlog-list .bulk-check:checked").length };
  });
  check("select-all in a category with a collapsed Dropped block takes only the visible rows",
    /^2 selected/.test(sel.count), sel);

  // --- 7. a dropped row must read as dropped the instant it appears ---
  // .ll-enter animates opacity 0 -> 1 for 300ms, and a running animation
  // outranks a normal declaration, so dimming via `opacity` left the row at
  // full brightness for the whole animation and then snapped.
  await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".backlog-section")]
      .find((s) => s.querySelector(".backlog-section-name").textContent === "Games");
    if (sec.querySelector(".backlog-dropped-toggle").classList.contains("is-open")) return;
  });
  const dim = await page.evaluate(async () => {
    const sec = () => [...document.querySelectorAll(".backlog-section")]
      .find((s) => s.querySelector(".backlog-section-name").textContent === "Games");
    if (sec().querySelector(".backlog-dropped-toggle").classList.contains("is-open")) {
      sec().querySelector(".backlog-dropped-toggle").click();
      await new Promise((r) => requestAnimationFrame(r));
    }
    sec().querySelector(".backlog-dropped-toggle").click();
    // One frame later: mid-animation, which is where the old bug lived.
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const row = [...sec().querySelectorAll(".backlog-item, .backlog-item-rich")]
      .find((r) => r.classList.contains("is-dropped"));
    if (!row) return { noRow: true };
    const cs = getComputedStyle(row);
    const early = { filter: cs.filter, opacity: cs.opacity, entering: row.classList.contains("ll-enter"),
                    strike: getComputedStyle(row.querySelector(".bl-title")).textDecorationLine };
    await new Promise((r) => setTimeout(r, 450));
    const cs2 = getComputedStyle(row);
    return { early, late: { filter: cs2.filter, opacity: cs2.opacity } };
  });
  check("the dropped row is on screen mid-animation", !dim.noRow && dim.early.entering === true, dim);
  check("and is already dimmed on the frame it appears",
    /opacity\(0\.55\)/.test(dim.early.filter), dim.early);
  check("struck through straight away too", /line-through/.test(dim.early.strike), dim.early);
  check("the dimming does not change once the animation ends",
    dim.early.filter === dim.late.filter, dim);

  // --- 8. the bar must not draw a selection/tap-highlight rect ---
  const press = await page.evaluate(() => {
    const btn = document.querySelector(".backlog-dropped-toggle");
    const cs = getComputedStyle(btn);
    const label = getComputedStyle(btn.querySelector(".bdt-label"));
    return {
      userSelect: cs.userSelect || cs.webkitUserSelect,
      labelSelect: label.userSelect || label.webkitUserSelect,
      tapHighlight: cs.webkitTapHighlightColor,
      focusOutline: cs.outlineStyle,
    };
  });
  check("the bar's text can't be selected by a lingering press", press.userSelect === "none", press);
  check("nor its label specifically", press.labelSelect === "none", press);
  check("the browser's tap-highlight rect is suppressed",
    /rgba\(0, 0, 0, 0\)|transparent/.test(press.tapHighlight), press);

  // A real drag across the label must select nothing.
  await page.evaluate(() => document.getSelection().removeAllRanges());
  const bar = await page.evaluate(() => {
    const r = document.querySelector(".backlog-dropped-toggle").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.move(bar.x + bar.w / 2 - 40, bar.y + bar.h / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.w / 2 + 40, bar.y + bar.h / 2, { steps: 8 });
  await page.mouse.up();
  const dragSel = await page.evaluate(() => String(document.getSelection()));
  check("dragging across the bar selects no text", dragSel === "", JSON.stringify(dragSel));

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
