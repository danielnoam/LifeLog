const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }, { id: "art", name: "Art", color: "#e2b23b" }],
  backlog: [
    { id: "b1", title: "Good One", category: "Games", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b2", title: "No Match", category: "Games", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "b3", title: "Boom", category: "Games", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "b4", title: "No Source", category: "Art", createdAt: "2026-01-04T00:00:00.000Z" },
  ],
  entries: [
    { id: "e1", title: "Good One", category: "Games", year: 2026, month: 3, createdAt: "2026-03-01T00:00:00.000Z" },
    { id: "e2", title: "Boom", category: "Games", year: 2026, month: 3, createdAt: "2026-03-02T00:00:00.000Z" },
    { id: "e3", title: "No Match", category: "Games", year: 2026, month: 3, createdAt: "2026-03-03T00:00:00.000Z" },
  ],
  notes: [], todos: [], financeEntries: [], recurringExpenses: [], projects: [], todoCategories: [],
  financeCategories: [],
  settings: { mediaCategorySources: { Games: "rawg" } },
};

// Replaces the whole media layer so a real bulkSync* loop can be run without
// a network: one success, one no-match, one throw, one category with no source.
// Replaces the media layer at the only seam that works: journal.js captures
// fetchMediaSuggestions at init(), so reassigning the export does nothing —
// but every call into window.LifeLogMedia.* is looked up at call time.
const STUB = () => {
  const M = window.LifeLogMedia;
  M.getLastError = () => "RAWG said nothing";
  const slow = () => new Promise((r) => setTimeout(r, 220));
  M.search = async (title) => {
    await slow();
    if (/No Match/.test(title)) return [];
    // The result has to BE the title now: since 0.152.0 a near-miss is
    // refused rather than auto-picked, so "<title> (matched)" would be a
    // skip. A second, wrong row is included to prove the picker skips it.
    return [
      { id: "0", source: "rawg", title: title + " Deluxe Edition", coverUrl: "https://x/wrong.png" },
      { id: "1", source: "rawg", title, coverUrl: "https://x/c.png",
        externalRating: "88", length: "12h", year: 2021, genres: ["RPG"] },
    ];
  };
  // The one place a throw can still reach the loop: fetchMediaSuggestions
  // swallows its own, so a search failure is a skip, not a failure.
  M.fetchEntryExtras = async (id, src, keys, title) => {
    if (/Boom/.test(title || "")) throw new Error("upstream exploded");
    return { length: "12h", genres: ["RPG"] };
  };
  M.fetchDetails = async (id, src, keys, opts) => {
    if (/Boom/.test((opts && opts.title) || "")) throw new Error("upstream exploded");
    return { length: "12h", genres: ["RPG"], summary: "words", externalRating: "88", releaseStatus: "released" };
  };
  M.mergeRelease = () => ({ releaseYear: 2021 });
  M.resolveSteamAppId = async () => null;
  M.fetchAniListPlanning = async () => [];
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/", { waitUntil: "networkidle" });

  for (const [label, ui, rowSel] of [
    ["Backlog", { view: "backlog", backlogMode: "entries" }, ".backlog-item, .backlog-item-rich"],
    ["Timeline", { view: "timeline", timelineMode: "entries" }, ".entry"],
  ]) {
    await page.evaluate(({ ui, seed }) => {
      localStorage.setItem("lifelog-ui-v1", JSON.stringify(ui));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    }, { ui, seed: SEED });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.evaluate(STUB);

    // Select everything via long-press + the section "select all" checkboxes,
    // then intercept the media search and press the bar's real Sync button.
    const rows = await page.$$(rowSel);
    const box = await rows[0].boundingBox();
    await page.mouse.move(box.x + 8, box.y + Math.min(14, box.height / 2));
    await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
    await page.waitForSelector(".bulk-bar");
    await page.evaluate(() => {
      document.querySelectorAll(".bulk-check").forEach((c) => { if (!c.checked) c.click(); });
    });
    await page.waitForTimeout(200);

    const out = await page.evaluate(async () => {
      const syncBtn = [...document.querySelectorAll(".bulk-bar .btn")].find((x) => /Sync/.test(x.textContent));
      if (!syncBtn) return { noSync: true };
      // Section headers carry a select-all .bulk-check of their own; only the
      // ones inside a row stand for an item.
      const selected = [...document.querySelectorAll(".bulk-check:checked")]
        .filter((c) => !c.closest(".backlog-section-head, .month-card > h3, .mc")).length;
      syncBtn.click();
      // Watch the panel mid-run: open it as soon as the tracker has a run.
      let snapshot = null;
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 60));
        const run = window.LifeLogApp.getBulkRun();
        if (run && run.done >= 1 && run.active && !snapshot) {
          window.LifeLogApp.openBulkProgressPanel();
          snapshot = {
            title: document.querySelector("#bulkProgressTitle").textContent,
            states: [...document.querySelectorAll("#bulkProgressList .bulkp-row")].map((r) => r.className.replace("bulkp-row ", "")),
          };
        }
        if (run && !run.active) break;
      }
      const run = window.LifeLogApp.getBulkRun();
      return {
        selected, snapshot,
        final: run && run.rows.map((r) => ({ title: r.title, state: r.state, detail: r.detail })),
        active: run && run.active,
        panelOpen: !document.querySelector("#bulkProgressModal").hidden,
        panelTitle: document.querySelector("#bulkProgressTitle").textContent,
        summary: document.querySelector("#bulkProgressSummary").textContent,
      };
    });

    if (out.noSync) { check(`${label}: has a Sync button`, false); continue; }
    check(`${label}: the real loop feeds the tracker`, Array.isArray(out.final) && out.final.length === out.selected, out);
    check(`${label}: the panel was live mid-run, with some rows still pending`,
      !!(out.snapshot && out.snapshot.states.some((s) => /is-pending/.test(s)) && /of/.test(out.snapshot.title)), out.snapshot);
    const byTitle = Object.fromEntries((out.final || []).map((r) => [r.title, r]));
    check(`${label}: a match is marked done and says what it filled`,
      !!(byTitle["Good One"] && byTitle["Good One"].state === "done" && /Good One/.test(byTitle["Good One"].detail)), byTitle["Good One"]);
    check(`${label}: a no-match is skipped with the source's reason`,
      !!(byTitle["No Match"] && byTitle["No Match"].state === "skipped" && byTitle["No Match"].detail.length > 0), byTitle["No Match"]);
    check(`${label}: a throw is caught per item and carries the error`,
      !!(byTitle["Boom"] && byTitle["Boom"].state === "failed" && /exploded/.test(byTitle["Boom"].detail)), byTitle["Boom"]);
    if (label === "Backlog") {
      check(`${label}: a category with no media source is skipped saying so`,
        !!(byTitle["No Source"] && byTitle["No Source"].state === "skipped" && /no media source/i.test(byTitle["No Source"].detail)), byTitle["No Source"]);
    }
    check(`${label}: the run ends and the panel opened itself (there were skips)`,
      out.active === false && out.panelOpen === true && /Finished/.test(out.panelTitle), out);
    check(`${label}: the summary counts all three outcomes`,
      /updated/.test(out.summary) && /skipped/.test(out.summary) && /failed/.test(out.summary), out.summary);

    // The whole point: the rows behind the panel actually changed.
    const persisted = await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
      const pick = (arr, t) => arr.find((x) => x.title === t) || {};
      return { blCover: pick(c.backlog, "Good One").coverUrl, enCover: pick(c.entries, "Good One").coverUrl,
        untouched: pick(c.backlog, "No Match").coverUrl || null };
    });
    check(`${label}: the matched item really was written`,
      (label === "Backlog" ? persisted.blCover : persisted.enCover) === "https://x/c.png", persisted);
    check(`${label}: the skipped one was left alone`, persisted.untouched === null, persisted);
    check(`${label}: the near-miss row in the same result set was not the one taken`,
      (label === "Backlog" ? persisted.blCover : persisted.enCover) !== "https://x/wrong.png", persisted);
    await page.evaluate(() => window.LifeLogApp.closeBulkProgressPanel());
  }

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
