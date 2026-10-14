const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();
const errs = [];

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }, { id: "a", name: "Art", color: "#e2b23b" }],
  backlog: [
    // Missing everything a source could fill, in a category that has one.
    { id: "m1", title: "Hollow Thing", category: "Games", releaseStatus: "released", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "m2", title: "Another Gap", category: "Games", releaseStatus: "released", createdAt: "2026-01-02T00:00:00.000Z" },
    // Complete — nothing to fill.
    { id: "ok1", title: "Complete One", category: "Games", coverUrl: "c.png", externalRating: "90",
      length: "10h", releaseYear: 2020, releaseDate: "2020-01-01", releaseStatus: "released",
      summary: "s", genres: ["RPG"], mediaSource: "rawg", mediaId: "1", createdAt: "2026-01-03T00:00:00.000Z" },
    // Incomplete, but its category has no media source: nothing could fill it.
    { id: "art1", title: "A Sketchbook", category: "Art", releaseStatus: "released", createdAt: "2026-01-04T00:00:00.000Z" },
    // Incomplete and unreleased — lands in a band that can be folded away.
    { id: "u1", title: "Waiting Gap", category: "Games", releaseStatus: "upcoming", releaseDate: "2027-05-01", createdAt: "2026-01-05T00:00:00.000Z" },
  ],
  entries: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [],
  settings: { mediaCategorySources: { Games: "rawg" } },
};

const load = async (page, visual) => {
  await page.evaluate(({ s, v }) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
    if (v) localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v));
    else localStorage.removeItem("lifelog-visual-settings-v1");
  }, { s: SEED, v: visual });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".backlog-section");
  await page.waitForTimeout(400);
};

const enterBulk = async (page) => {
  const row = await page.$(".backlog-item, .backlog-item-rich");
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 8, box.y + Math.min(14, box.height / 2));
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await page.waitForSelector(".bulk-bar");
};

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 520, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });

  // The "Incomplete N" one-press selection was removed in 0.267.1: Daniel
  // never used it. Bulk mode is select, then Move, Sync or Delete.
  await load(page);
  await enterBulk(page);
  const v = await page.evaluate(() => ({
    preset: !!document.querySelector(".bulk-preset"),
    btns: [...document.querySelectorAll(".bulk-bar .btn")].map((x) => x.textContent.trim()),
  }));
  check("bulk mode no longer offers an Incomplete selection",
    !v.preset && !v.btns.some((t) => /Incomplete/.test(t)), v);
  check("Sync, Delete and Cancel are still there",
    ["Sync", "Delete", "Cancel"].every((t) => v.btns.some((x) => x.includes(t))), v);

  await page.evaluate(() => document.querySelector(".backlog-list .bulk-check").click());
  await page.waitForTimeout(200);
  check("selecting a row by hand still works", await page.evaluate(() =>
    /^1 selected/.test(document.querySelector(".bulk-count").textContent)));

  await b.close();
  done(errs);
})();
