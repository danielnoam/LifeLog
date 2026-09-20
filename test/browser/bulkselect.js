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

const bar = (page) => page.evaluate(() => {
  const p = document.querySelector(".bulk-preset");
  const btns = [...document.querySelectorAll(".bulk-bar .btn")].map((b) => b.textContent.trim());
  return {
    preset: p ? { text: p.textContent.trim(), title: p.title, disabled: p.disabled,
                  beforeSync: btns.indexOf(p.textContent.trim()) < btns.findIndex((t) => /Sync/.test(t)) } : null,
    count: (document.querySelector(".bulk-count") || {}).textContent || "",
    checked: [...document.querySelectorAll(".backlog-list .bulk-check:checked")]
      .map((c) => c.closest(".backlog-item, .backlog-item-rich"))
      .map((r) => r && r.querySelector(".bl-title") ? r.querySelector(".bl-title").textContent : "?"),
  };
});

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 520, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });

  // ---- no chrome outside bulk mode ----
  await load(page);
  check("nothing is added to the view until you are bulk-editing",
    (await page.$(".bulk-preset")) === null && (await page.$("#attentionPill")) === null);

  // ---- inside bulk mode it offers the selection ----
  await enterBulk(page);
  let v = await bar(page);
  check("bulk mode offers the incomplete selection", !!v.preset, v);
  check("counting only what a source could actually fill",
    /^⚠ Incomplete 3$/.test(v.preset.text), v.preset);
  check("and saying what pressing it does", /press Sync/.test(v.preset.title), v.preset);
  check("it sits before the actions it changes the target of", v.preset.beforeSync === true, v.preset);

  await page.evaluate(() => document.querySelector(".bulk-preset").click());
  await page.waitForTimeout(350);
  v = await bar(page);
  check("pressing it selects exactly those", /^3 selected/.test(v.count), v);
  check("naming the incomplete ones", ["Hollow Thing", "Another Gap", "Waiting Gap"].every((t) => v.checked.includes(t)), v.checked);
  check("a complete item is not selected", !v.checked.includes("Complete One"), v.checked);
  check("nor one nothing could fill — its category has no source", !v.checked.includes("A Sketchbook"), v.checked);
  check("and Sync is there to act on it", await page.evaluate(() =>
    [...document.querySelectorAll(".bulk-bar .btn")].some((x) => /Sync/.test(x.textContent) && !x.disabled)));

  // ---- it replaces the selection rather than adding to it ----
  await page.evaluate(() => {
    const c = document.querySelector(".backlog-list .bulk-check");
    if (!c.checked) c.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector(".bulk-preset").click());
  await page.waitForTimeout(300);
  v = await bar(page);
  check("pressing it again means what it says — exactly the incomplete ones",
    /^3 selected/.test(v.count), v);

  // ---- never selects a row a fold is hiding ----
  await load(page, { backlogFoldUnreleased: "collapsed" });
  await enterBulk(page);
  v = await bar(page);
  check("a folded band's rows are not counted", /^⚠ Incomplete 2$/.test(v.preset.text), v.preset);
  await page.evaluate(() => document.querySelector(".bulk-preset").click());
  await page.waitForTimeout(300);
  v = await bar(page);
  check("nor selected — bulk mode never acts on what you can't see",
    /^2 selected/.test(v.count) && !v.checked.includes("Waiting Gap"), v);

  // ---- nothing to fix, nothing offered ----
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
    c.backlog = c.backlog.filter((x) => x.id === "ok1");
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(c));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await enterBulk(page);
  check("with nothing incomplete the button isn't there at all",
    (await page.$(".bulk-preset")) === null);

  await b.close();
  done(errs);
})();
