const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }],
  backlog: [
    { id: "b1", title: "Bioshock", category: "Games", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b2", title: "Metro 2033", category: "Games", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "b3", title: "Portal 2", category: "Games", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "b4", title: "The Witcher 3", category: "Games", createdAt: "2026-01-04T00:00:00.000Z" },
  ],
  entries: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [],
  settings: {
    mediaCategorySources: { Games: "rawg" },
    mediaCategoryFallbackSources: { Games: "steamgriddb" },
  },
};

// The reported reality: RAWG has an opinion about everything and is wrong
// about Bioshock; the second source has the actual game; nobody has an exact
// Metro 2033. Every call is recorded so we can prove which sources were asked.
const STUB = () => {
  const M = window.LifeLogMedia;
  window.__calls = [];
  M.getLastError = () => "";
  M.search = async (title, source) => {
    window.__calls.push(source + ":" + title);
    await new Promise((r) => setTimeout(r, 30));
    if (source === "rawg") {
      if (/^bioshock$/i.test(title)) return [{ id: "r1", source: "rawg", title: "BioShock Infinite", coverUrl: "https://x/wrong.png", externalRating: "10" }];
      if (/^metro 2033$/i.test(title)) return [{ id: "r2", source: "rawg", title: "Metro 2033 Redux", coverUrl: "https://x/redux.png" }];
      if (/^portal 2$/i.test(title)) return [{ id: "r3", source: "rawg", title: "Portal 2", coverUrl: "https://x/portal.png", externalRating: "95" }];
      if (/^the witcher 3$/i.test(title)) return [{ id: "r4", source: "rawg", title: "The Witcher 3: Wild Hunt", coverUrl: "https://x/witcher.png" }];
      return [];
    }
    if (source === "steamgriddb") {
      if (/^bioshock$/i.test(title)) return [{ id: "g1", source: "steamgriddb", title: "BIOSHOCK™", coverUrl: "https://x/right.png", externalRating: "88" }];
      if (/^metro 2033$/i.test(title)) return [{ id: "g2", source: "steamgriddb", title: "Metro: Last Light", coverUrl: "https://x/nope.png" }];
      return [];
    }
    return [];
  };
  M.fetchDetails = async () => ({ length: "12h", genres: [], summary: "", externalRating: "" });
  M.fetchEntryExtras = async () => ({ length: "12h", genres: [] });
  M.mergeRelease = () => ({});
  M.fetchRawgSteamAppId = async () => null;
  M.fetchSteamGridDbSteamAppId = async () => null;
};

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
  await page.waitForSelector(".backlog-item, .backlog-item-rich");
  await page.waitForTimeout(400);
  await page.evaluate(STUB);

  // Select everything and run the real bulk sync.
  const row = await page.$(".backlog-item, .backlog-item-rich");
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 8, box.y + Math.min(14, box.height / 2));
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await page.waitForSelector(".bulk-bar");
  await page.evaluate(() => document.querySelectorAll(".bulk-check").forEach((c) => { if (!c.checked) c.click(); }));
  await page.waitForTimeout(200);

  const out = await page.evaluate(async () => {
    [...document.querySelectorAll(".bulk-bar .btn")].find((x) => /Sync/.test(x.textContent)).click();
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 60));
      const run = window.LifeLogApp.getBulkRun();
      if (run && !run.active) break;
    }
    const run = window.LifeLogApp.getBulkRun();
    const c = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
    const pick = (t) => c.backlog.find((x) => x.title === t) || {};
    return {
      rows: run.rows.map((r) => ({ title: r.title, state: r.state, detail: r.detail })),
      calls: window.__calls,
      bioshock: { cover: pick("Bioshock").coverUrl || null, rating: pick("Bioshock").externalRating || null,
                  source: pick("Bioshock").mediaSource || null },
      metro: { cover: pick("Metro 2033").coverUrl || null, source: pick("Metro 2033").mediaSource || null },
      witcher: { cover: pick("The Witcher 3").coverUrl || null, source: pick("The Witcher 3").mediaSource || null },
      portal: { cover: pick("Portal 2").coverUrl || null, source: pick("Portal 2").mediaSource || null },
    };
  });
  const by = Object.fromEntries(out.rows.map((r) => [r.title, r]));

  // --- Bioshock: primary had an opinion but not the game; fallback had it ---
  check("Bioshock: both sources were asked, even though RAWG returned a result",
    out.calls.includes("rawg:Bioshock") && out.calls.includes("steamgriddb:Bioshock"), out.calls);
  check("Bioshock: the second source's match was taken", by["Bioshock"].state === "done", by["Bioshock"]);
  check("Bioshock: and it is the right game's art, not BioShock Infinite's",
    out.bioshock.cover === "https://x/right.png" && out.bioshock.source === "steamgriddb", out.bioshock);
  check("Bioshock: BioShock Infinite's rating was not attached",
    out.bioshock.rating === "88", out.bioshock);

  // --- Metro 2033: neither source has it; nothing may be picked ---
  check("Metro 2033: both sources were asked",
    out.calls.includes("rawg:Metro 2033") && out.calls.includes("steamgriddb:Metro 2033"), out.calls);
  check("Metro 2033: nothing was selected", by["Metro 2033"].state === "skipped", by["Metro 2033"]);
  check("Metro 2033: the item was left completely untouched",
    out.metro.cover === null && out.metro.source === null, out.metro);
  check("Metro 2033: the row says what it nearly picked",
    /Metro 2033 Redux/.test(by["Metro 2033"].detail), by["Metro 2033"].detail);

  // --- Portal 2: the primary nailed it; don't spend a second request ---
  check("Portal 2: matched on the primary", by["Portal 2"].state === "done" && out.portal.source === "rawg", by["Portal 2"]);
  check("Portal 2: the fallback was never asked, since the primary was exact",
    !out.calls.includes("steamgriddb:Portal 2"), out.calls);

  // --- The Witcher 3: a subtitle is no longer close enough (0.153.0) ---
  check("The Witcher 3: a subtitled result is not taken", by["The Witcher 3"].state === "skipped", by["The Witcher 3"]);
  check("The Witcher 3: left untouched, with the near-miss named",
    out.witcher.cover === null && /Wild Hunt/.test(by["The Witcher 3"].detail), { w: out.witcher, d: by["The Witcher 3"].detail });

  console.log("\ncalls:", out.calls.join(", "));
  console.log("errors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
