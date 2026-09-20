const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }],
  backlog: [
    { id: "b1", title: "Hades", category: "Games", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b2", title: "Celeste", category: "Games", coverUrl: "https://x/c.png", externalRating: "91",
      length: "8h", releaseYear: 2018, releaseDate: "2018-01-25", releaseStatus: "released",
      summary: "s", genres: ["Platformer"], mediaSource: "steam", mediaId: "504230",
      createdAt: "2026-01-01T00:00:00.000Z" },
  ],
  entries: [], financeEntries: [], recurringExpenses: [], notes: [], todos: [], projects: [],
  settings: { mediaCategorySources: { Games: "rawg" } },
};

const INCOMING = [
  { title: "Hades", category: "Games", coverUrl: "https://x/h.png", externalRating: "93", releaseDate: "2020-09-17" },
  { title: "Celeste", category: "Games", coverUrl: "https://x/other.png" },
  { title: "Tunic", category: "Games", coverUrl: "https://x/t.png" },
];

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".backlog-item, .backlog-item-rich, .empty");
  await page.waitForTimeout(400);

  // ---- 1. what buildImportItems makes of an incoming batch ----
  const built = await page.evaluate((inc) => {
    const { items } = window.LifeLogIO.buildImportItems({ backlog: inc });
    return items.filter((i) => i.kind === "backlog").map((i) => ({
      title: i.entry.title, dup: i.dup, update: !!i.update, checked: i.checked,
      targetId: i.targetId || null, targetKind: i.targetKind || null,
      fills: (i.fills || []).map((f) => f.key).sort(),
    }));
  }, INCOMING);
  const hades = built.find((i) => i.title === "Hades");
  const celeste = built.find((i) => i.title === "Celeste");
  const tunic = built.find((i) => i.title === "Tunic");
  check("a duplicate with gaps becomes a ticked update row",
    !!(hades && hades.update && hades.dup === true && hades.checked), built);
  check("pointing at the item it would enrich",
    !!(hades && hades.targetId === "b1" && hades.targetKind === "backlog"), hades);
  check("and naming exactly the fields it would fill",
    !!(hades && JSON.stringify(hades.fills) === JSON.stringify(["coverUrl", "externalRating", "releaseDate"])), hades);
  check("a complete duplicate stays a plain unticked duplicate",
    !!(celeste && !celeste.update && celeste.dup === true && !celeste.checked), celeste);
  check("a new item is a plain add", !!(tunic && !tunic.update && tunic.dup === false && tunic.checked), tunic);

  // ---- 2. the picker: update rows are visible, tagged, and survive the toggle ----
  await page.evaluate((inc) => {
    // reviewAndImport, not openImportPicker: the apply step is the half of
    // this that actually touches your data.
    window.LifeLogIO.reviewAndImport("Test import", "", window.LifeLogIO.buildImportItems({ backlog: inc }));
  }, INCOMING);
  await page.waitForSelector("#financePickerModal:not([hidden]) .picker-row");
  const readRows = () => page.evaluate(() => ({
    rows: [...document.querySelectorAll("#financePickerList .picker-row")].map((r) => ({
      title: r.querySelector(".etitle") ? r.querySelector(".etitle").textContent : "",
      update: r.classList.contains("is-update"),
      dupTag: r.querySelector(".dup-tag") ? r.querySelector(".dup-tag").textContent : null,
      tag: r.querySelector(".update-tag") ? r.querySelector(".update-tag").textContent : null,
      tagW: r.querySelector(".update-tag") ? r.querySelector(".update-tag").getBoundingClientRect().width : 0,
      checked: r.querySelector("input[type=checkbox]").checked,
    })),
    dupRowShown: !document.querySelector("#financePickerDupRow").hidden,
    count: document.querySelector("#financePickerCount").textContent,
  }));
  const hidden = await readRows();
  const upRow = hidden.rows.find((r) => r.update);
  check("with duplicates hidden, the update row is still listed", !!upRow, hidden.rows);
  check("and the plain duplicate is not", !hidden.rows.some((r) => r.title === "Celeste"), hidden.rows);
  check("carrying a tag naming what it adds",
    !!(upRow && /^\+ /.test(upRow.tag) && /cover/.test(upRow.tag) && /rating/.test(upRow.tag) && /release date/.test(upRow.tag)), upRow);
  check("the tag is actually on screen, not a zero-width leftover", !!(upRow && upRow.tagW > 20), upRow && upRow.tagW);
  check("an update row is not labelled \"already added\"", !!(upRow && upRow.dupTag !== "already added"), upRow);
  check("the hide-duplicates row is offered, since there is a real duplicate to hide", hidden.dupRowShown === true, hidden.dupRowShown);
  check("both the update and the add come pre-ticked", hidden.rows.every((r) => r.checked), hidden.rows);

  await page.evaluate(() => {
    const cb = document.querySelector("#financePickerShowDup");
    cb.checked = true; cb.onchange();
  });
  const shown = await readRows();
  check("showing duplicates adds the plain one back", shown.rows.some((r) => r.title === "Celeste"), shown.rows);
  check("and the update row is still there exactly once",
    shown.rows.filter((r) => r.update).length === 1, shown.rows);

  // ---- 3. confirming applies the fill in place, adding no new row ----
  await page.evaluate(() => document.querySelector("#financePickerConfirmBtn").click());
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const cache = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
    const h = cache.backlog.filter((x) => x.title === "Hades");
    return {
      hadesCount: h.length,
      total: cache.backlog.length,
      cover: h[0] ? h[0].coverUrl : null,
      rating: h[0] ? h[0].externalRating : null,
      release: h[0] ? h[0].releaseDate : null,
      celesteCover: (cache.backlog.find((x) => x.title === "Celeste") || {}).coverUrl,
      hasTunic: cache.backlog.some((x) => x.title === "Tunic"),
    };
  });
  check("the update did not add a second Hades", after.hadesCount === 1, after);
  check("it filled the gaps it named",
    after.cover === "https://x/h.png" && after.rating === "93" && after.release === "2020-09-17", after);
  check("it left the complete duplicate's own cover alone", after.celesteCover === "https://x/c.png", after);
  check("and the genuinely new item was added", after.hasTunic && after.total === 3, after);

  // ---- 4. the bulk progress panel ----
  const panel = await page.evaluate(() => ({
    exists: !!document.querySelector("#bulkProgressModal"),
    hidden: document.querySelector("#bulkProgressModal").hidden,
    parts: ["#bulkProgressTitle", "#bulkProgressSummary", "#bulkProgressList", "#closeBulkProgressBtn"]
      .filter((s) => !document.querySelector(s)),
  }));
  check("the progress modal exists and starts hidden", panel.exists && panel.hidden === true, panel);
  check("with every part renderBulkProgressPanel writes into", panel.parts.length === 0, panel.parts);

  const tracked = await page.evaluate(() => {
    const A = window.LifeLogApp;
    A.startBulkRun([{ id: "1", title: "One" }, { id: "2", title: "Two" }, { id: "3", title: "Three" }]);
    A.openBulkProgressPanel();
    const read = () => ({
      title: document.querySelector("#bulkProgressTitle").textContent,
      summary: document.querySelector("#bulkProgressSummary").textContent,
      rows: [...document.querySelectorAll("#bulkProgressList .bulkp-row")].map((r) => ({
        cls: r.className, name: r.querySelector(".bulkp-name").textContent,
        glyph: r.querySelector(".bulkp-glyph").textContent,
        glyphColor: getComputedStyle(r.querySelector(".bulkp-glyph")).color,
        detail: r.querySelector(".bulkp-detail") ? r.querySelector(".bulkp-detail").textContent : "",
      })),
      hidden: document.querySelector("#bulkProgressModal").hidden,
    });
    const atStart = read();
    A.markBulkItem("1", "done", "cover, rating");
    const afterOne = read();
    A.markBulkItem("2", "skipped", "no match found");
    A.markBulkItem("3", "failed", "network down");
    A.finishBulkRun();
    return { atStart, afterOne, atEnd: read() };
  });
  check("the panel opens showing every item as pending",
    tracked.atStart.rows.length === 3 && tracked.atStart.rows.every((r) => /is-pending/.test(r.cls)), tracked.atStart.rows);
  check("the title counts the run", /0 of 3/.test(tracked.atStart.title), tracked.atStart.title);
  check("a finished item flips live, with what it filled",
    /is-done/.test(tracked.afterOne.rows[0].cls) && tracked.afterOne.rows[0].detail === "cover, rating", tracked.afterOne.rows[0]);
  check("and the count ticks with it", /1 of 3/.test(tracked.afterOne.title), tracked.afterOne.title);
  check("the rest stay pending until they are reached",
    tracked.afterOne.rows.slice(1).every((r) => /is-pending/.test(r.cls)), tracked.afterOne.rows);
  check("a skip says why", /is-skipped/.test(tracked.atEnd.rows[1].cls) && tracked.atEnd.rows[1].detail === "no match found", tracked.atEnd.rows[1]);
  check("a failure carries the error", /is-failed/.test(tracked.atEnd.rows[2].cls) && tracked.atEnd.rows[2].detail === "network down", tracked.atEnd.rows[2]);
  check("the finished title stops counting", /Finished/.test(tracked.atEnd.title), tracked.atEnd.title);
  check("the summary breaks the run down",
    /1 updated/.test(tracked.atEnd.summary) && /1 skipped/.test(tracked.atEnd.summary) && /1 failed/.test(tracked.atEnd.summary), tracked.atEnd.summary);
  check("the panel stays open after a run with skips", tracked.atEnd.hidden === false, tracked.atEnd.hidden);
  const colors = tracked.atEnd.rows.map((r) => r.glyphColor);
  check("the three outcomes read as three different colours, not three identical ticks",
    new Set(colors).size === 3, colors);
  check("and three different glyphs",
    new Set(tracked.atEnd.rows.map((r) => r.glyph)).size === 3, tracked.atEnd.rows.map((r) => r.glyph));

  // ---- 5. the pill in the bar ----
  await page.evaluate(() => { window.LifeLogApp.closeBulkProgressPanel(); });
  const row = await page.$(".backlog-item, .backlog-item-rich");
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width - 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForSelector(".bulk-bar", { timeout: 3000 });
  const idle = await page.evaluate(() => {
    const p = document.querySelector(".bulk-progress");
    return { tag: p ? p.tagName : null, hidden: p ? p.hidden : null };
  });
  check("with no run, the pill is a button that keeps out of the way",
    idle.tag === "BUTTON" && idle.hidden === true, idle);
  check("entering bulk mode does not inherit the previous run's count",
    (await page.evaluate(() => window.LifeLogApp.getBulkRun())) === null, "stale run still there");

  const pill = await page.evaluate(async () => {
    window.LifeLogApp.startBulkRun([{ id: "x", title: "X" }, { id: "y", title: "Y" }]);
    window.LifeLogApp.markBulkItem("x", "done", "cover");
    const r = document.querySelector("#viewBody");
    // force the bar through a re-render, the way a mid-run render() does
    document.querySelector(".bulk-check").click();
    document.querySelector(".bulk-check").click();
    await new Promise((res) => setTimeout(res, 150));
    const p = document.querySelector(".bulk-progress");
    if (!p) return { gone: true };
    const before = { text: p.textContent, hidden: p.hidden,
      others: [...document.querySelectorAll(".bulk-bar .btn, .bulk-bar select")].map((x) => x.disabled) };
    p.click();
    await new Promise((res) => setTimeout(res, 120));
    return Object.assign(before, { opened: !document.querySelector("#bulkProgressModal").hidden });
  });
  check("mid-run the pill appears reading N/total", !pill.gone && pill.hidden === false && /1\/2/.test(pill.text), pill);
  check("pressing it opens the panel", pill.opened === true, pill);
  check("and every other bar control is disabled while the run is going",
    !!(pill.others && pill.others.length && pill.others.every((d) => d === true)), pill.others);

  const done = await page.evaluate(async () => {
    window.LifeLogApp.markBulkItem("y", "skipped", "no match");
    window.LifeLogApp.finishBulkRun();
    document.querySelector(".bulk-check").click();
    document.querySelector(".bulk-check").click();
    await new Promise((res) => setTimeout(res, 150));
    const p = document.querySelector(".bulk-progress");
    return { text: p ? p.textContent : null,
      others: [...document.querySelectorAll(".bulk-bar .btn, .bulk-bar select")].map((x) => x.disabled) };
  });
  check("once finished the pill says so", /2\/2/.test(done.text) && /done/.test(done.text), done.text);
  check("and the bar's controls come back", done.others.some((d) => d === false), done.others);

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
