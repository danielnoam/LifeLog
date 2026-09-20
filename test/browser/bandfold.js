const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }, { id: "f", name: "Film", color: "#e2554b" }],
  backlog: [
    { id: "r1", title: "Ready One", category: "Games", releaseStatus: "released", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "s1", title: "Starred", category: "Games", priority: 1, releaseStatus: "released", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "e1", title: "EA One", category: "Games", earlyAccess: true, releaseStatus: "released", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "e2", title: "EA Two", category: "Games", earlyAccess: true, releaseStatus: "released", createdAt: "2026-01-04T00:00:00.000Z" },
    { id: "u1", title: "Waiting One", category: "Games", releaseStatus: "upcoming", releaseDate: "2027-05-01", createdAt: "2026-01-05T00:00:00.000Z" },
    { id: "u2", title: "Waiting Two", category: "Games", releaseStatus: "upcoming", releaseDate: "2027-06-01", createdAt: "2026-01-06T00:00:00.000Z" },
    { id: "u3", title: "Waiting Three", category: "Games", releaseStatus: "upcoming", releaseDate: "2027-07-01", createdAt: "2026-01-07T00:00:00.000Z" },
    { id: "d1", title: "Gone", category: "Games", dropped: true, createdAt: "2026-01-08T00:00:00.000Z" },
    // A category that is nothing but unreleased — no band boundary is ever
    // crossed into it, so this is the case that needs a bar of its own.
    { id: "fu1", title: "Film Soon", category: "Film", releaseStatus: "upcoming", releaseDate: "2027-01-01", createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "fu2", title: "Film Later", category: "Film", releaseStatus: "upcoming", releaseDate: "2027-02-01", createdAt: "2026-02-02T00:00:00.000Z" },
  ],
  entries: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {},
};

const readCat = (page, cat) => page.evaluate((cat) => {
  const sec = [...document.querySelectorAll(".backlog-section")]
    .find((s) => s.querySelector(".backlog-section-name").textContent === cat);
  if (!sec) return null;
  return {
    titles: [...sec.querySelectorAll(".bl-title")].map((t) => t.textContent),
    bars: [...sec.querySelectorAll(".backlog-dropped-toggle")].map((b) => ({
      band: b.dataset.band, text: b.querySelector(".bdt-label").textContent,
      open: b.classList.contains("is-open"), aria: b.getAttribute("aria-expanded"),
    })),
    plainSeps: [...sec.querySelectorAll(".backlog-ea-sep, .backlog-upcoming-sep")].length,
  };
}, cat);

// Each band has its own select now, so the helper takes which one.
const setFold = async (page, which, value) => {
  await page.evaluate(({ which, v }) => {
    const s = document.querySelector("#backlogFold" + which);
    s.value = v; s.onchange();
  }, { which, v: value });
  await page.waitForTimeout(400);
};
const setAll = async (page, value) => {
  for (const w of ["Ea", "Unreleased", "Dropped"]) await setFold(page, w, value);
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 460, height: 1100 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.removeItem("lifelog-visual-settings-v1");
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".backlog-section");
  await page.waitForTimeout(400);

  // ---- 1. default: EA and Unreleased foldable and open, Dropped closed ----
  let g = await readCat(page, "Games");
  check("all three set-aside bands have a bar", g.bars.length === 3, g.bars);
  check("each names its band and counts it",
    g.bars.map((x) => x.text.replace(/^[▸▾] /, "")).join("|") === "Early Access 2|Unreleased 3|Dropped 1", g.bars);
  check("Early Access and Unreleased start open",
    g.bars[0].open === true && g.bars[1].open === true, g.bars);
  check("Dropped starts closed, since that is its own setting's default", g.bars[2].open === false, g.bars);
  check("so their rows are on screen and the dropped one isn't",
    g.titles.includes("EA One") && g.titles.includes("Waiting One") && !g.titles.includes("Gone"), g.titles);
  check("no plain rules are left where a bar now goes", g.plainSeps === 0, g.plainSeps);

  // ---- 2. folding one by hand ----
  await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".backlog-section")]
      .find((s) => s.querySelector(".backlog-section-name").textContent === "Games");
    sec.querySelector('.backlog-dropped-toggle[data-band="3"]').click();
  });
  await page.waitForTimeout(350);
  g = await readCat(page, "Games");
  check("folding Unreleased removes its rows", !g.titles.includes("Waiting One") && g.titles.includes("EA One"), g.titles);
  check("and only that bar closes", g.bars[1].open === false && g.bars[0].open === true, g.bars);
  check("the bar still counts what it is hiding", /Unreleased 3/.test(g.bars[1].text), g.bars[1]);

  // ---- 3. a category with nothing but unreleased still gets a bar ----
  const f = await readCat(page, "Film");
  check("an all-unreleased category gets a bar of its own", f.bars.length === 1 && f.bars[0].band === "3", f.bars);
  check("open, so its rows are reachable", f.bars[0].open === true && f.titles.length === 2, f);

  // ---- 4. "start folded" ----
  await setAll(page, "collapsed");
  g = await readCat(page, "Games");
  check("start-folded closes Early Access and Unreleased",
    g.bars[0].open === false && g.bars[1].open === false, g.bars);
  check("leaving only the plain bands on screen",
    JSON.stringify(g.titles) === JSON.stringify(["Starred", "Ready One"]), g.titles);
  check("changing the setting overrides a fold you set by hand",
    g.bars[1].open === false, g.bars);

  // ---- 5. each band is its own setting ----
  await setFold(page, "Ea", "always");
  g = await readCat(page, "Games");
  check("setting Early Access to always-open takes away only its bar",
    g.bars.length === 2 && g.bars.map((x) => x.band).join() === "3,4", g.bars);
  check("leaving it as a plain rule again", g.plainSeps === 1, g.plainSeps);
  check("with its rows on screen", g.titles.includes("EA One") && g.titles.includes("EA Two"), g.titles);
  check("and the other two still folded, because their own settings say so",
    g.bars[0].open === false && g.bars[1].open === false, g.bars);

  // Dropped is no longer special-cased — it takes the same three choices.
  await setFold(page, "Dropped", "open");
  g = await readCat(page, "Games");
  check("Dropped can now start open like the rest",
    g.bars.find((x) => x.band === "4").open === true, g.bars);
  check("so its row is on screen", g.titles.includes("Gone"), g.titles);
  await setFold(page, "Dropped", "always");
  g = await readCat(page, "Games");
  check("and Dropped can be always-open too, which it could not before",
    !g.bars.some((x) => x.band === "4") && g.titles.includes("Gone"), g);

  await setAll(page, "always");
  g = await readCat(page, "Games");
  check("all three always-open leaves no bars at all", g.bars.length === 0, g.bars);
  check("as three plain dashed rules", g.plainSeps === 2, g.plainSeps);
  check("with every row on screen", g.titles.length === 8, g.titles);

  await setAll(page, "open");

  // ---- 6. the settings stick ----
  await setFold(page, "Unreleased", "collapsed");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(450);
  g = await readCat(page, "Games");
  check("each choice survives a reload on its own",
    g.bars.length === 3 && g.bars[0].open === true && g.bars[1].open === false && g.bars[2].open === true, g.bars);
  await setAll(page, "open");
  await setFold(page, "Dropped", "collapsed");
  // A hand-fold is a look, not a preference: it lives in memory only, so a
  // reload puts every band back to what the setting says it starts as.
  await setAll(page, "open");
  await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".backlog-section")]
      .find((s) => s.querySelector(".backlog-section-name").textContent === "Games");
    sec.querySelector('.backlog-dropped-toggle[data-band="2"]').click();
  });
  await page.waitForTimeout(300);
  check("a band folded by hand is folded", (await readCat(page, "Games")).bars[0].open === false);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(450);
  g = await readCat(page, "Games");
  check("but a hand-fold does not survive a reload — it is a look, not a preference",
    g.bars[0].open === true && g.bars[1].open === true, g.bars);
  check("while the setting itself did survive it", g.bars.length === 3, g.bars);

  // ---- 7. select-all must not reach a folded band ----
  await setAll(page, "collapsed");
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
    return document.querySelector(".bulk-count").textContent;
  });
  check("select-all takes only the rows a folded category is showing", /^2 selected/.test(sel), sel);

  // ---- 8. a device on 0.158.0's single setting ----
  await page.evaluate(() => {
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ backlogBandFold: "collapsed" }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  g = await readCat(page, "Games");
  check("the old single setting becomes the two bands it used to cover",
    g.bars[0].open === false && g.bars[1].open === false, g.bars);
  check("and leaves Dropped on its own default", g.bars[2].open === false, g.bars);
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-visual-settings-v1")));
  check("the settings screen shows the migrated values", await page.evaluate(() => {
    window.LifeLogSettings && window.LifeLogSettings.openSettings && window.LifeLogSettings.openSettings();
    const r = { ea: document.querySelector("#backlogFoldEa").value,
                un: document.querySelector("#backlogFoldUnreleased").value,
                dr: document.querySelector("#backlogFoldDropped").value };
    document.querySelector("#settingsModal").hidden = true;
    return r.ea === "collapsed" && r.un === "collapsed" && r.dr === "collapsed";
  }), migrated);

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
