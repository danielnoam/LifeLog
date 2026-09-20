const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }],
  financeCategories: [{ id: "food", name: "Food", color: "#4bd07a" }],
  backlog: [],
  entries: [{ id: "e1", title: "Celeste", category: "Games", year: 2026, month: 3,
             createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" }],
  recurringExpenses: [{ id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 10,
             category: "Food", note: "milk", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
  financeEntries: [{ id: "f1", date: "2026-03-04", amount: 20, category: "Food", note: "lunch",
             createdAt: "2026-03-04T00:00:00.000Z" }],
  notes: [], todos: [], projects: [], todoCategories: [], settings: {},
};

const INCOMING = {
  entries: [{ title: "Celeste", category: "Games", year: 2026, month: 3,
    coverUrl: "https://x/celeste.png", length: "8h", genres: ["Platformer"],
    rating: 5, notes: "loved it", mediaSource: "rawg", mediaId: "17572",
    startYear: 2025, startMonth: 11 }],
  recurringExpenses: [{ startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food", note: "milk",
    endDate: "2026-12-01", project: "Switzerland", pauses: [{ from: "2026-06-01", to: "2026-07-01" }],
    overrides: { "2026-04-01": { amount: 12, note: "price rise" } } }],
  financeEntries: [{ date: "2026-03-04", amount: 20, category: "Food", note: "lunch" }],
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const rows = await page.evaluate((inc) => {
    const { items } = window.LifeLogIO.buildImportItems(inc);
    const by = {};
    for (const i of items) by[i.kind] = { dup: i.dup, update: !!i.update, checked: i.checked,
      targetKind: i.targetKind || null, targetId: i.targetId || null,
      fills: (i.fills || []).map((f) => f.key).sort() };
    return by;
  }, INCOMING);
  check("the entry duplicate is a ticked update pointing at the entry",
    rows.entry.update && rows.entry.checked && rows.entry.targetKind === "entry" && rows.entry.targetId === "e1", rows.entry);
  check("naming cover, length, genres, your rating, your notes, the media link and the span",
    JSON.stringify(rows.entry.fills) === JSON.stringify(["coverUrl", "genres", "length", "mediaSource", "notes", "rating", "startYear"]), rows.entry.fills);
  check("the recurring duplicate is a ticked update pointing at the plan",
    rows.recurring.update && rows.recurring.checked && rows.recurring.targetKind === "recurring" && rows.recurring.targetId === "r1", rows.recurring);
  check("naming end date, project, pauses and per-month changes",
    JSON.stringify(rows.recurring.fills) === JSON.stringify(["endDate", "overrides", "pauses", "project"]), rows.recurring.fills);
  check("the finance duplicate stays a plain unticked duplicate",
    rows.finance.dup === true && !rows.finance.update && rows.finance.checked === false, rows.finance);

  // The picker must show all three, with the two updates tagged.
  await page.evaluate((inc) => {
    window.LifeLogIO.reviewAndImport("Kinds", "", window.LifeLogIO.buildImportItems(inc));
  }, INCOMING);
  await page.waitForSelector("#financePickerModal:not([hidden]) .picker-row");
  const picker = await page.evaluate(() => [...document.querySelectorAll("#financePickerList .picker-row")].map((r) => ({
    update: r.classList.contains("is-update"),
    tag: r.querySelector(".update-tag") ? r.querySelector(".update-tag").textContent : null,
    tagW: r.querySelector(".update-tag") ? Math.round(r.querySelector(".update-tag").getBoundingClientRect().width) : 0,
  })));
  check("both updates are listed while duplicates are hidden", picker.filter((r) => r.update).length === 2, picker);
  check("the finance duplicate is hidden with the other plain duplicates", picker.length === 2, picker);
  const recTag = picker.map((r) => r.tag).find((t) => t && /end date/.test(t));
  check("the recurring tag names its own fields in words", !!(recTag && /project/.test(recTag) && /per-month changes/.test(recTag)), recTag);
  check("both tags are actually rendered", picker.every((r) => r.tagW > 20), picker.map((r) => r.tagW));

  await page.evaluate(() => document.querySelector("#financePickerConfirmBtn").click());
  await page.waitForTimeout(700);

  const after = await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
    const e = c.entries.find((x) => x.title === "Celeste") || {};
    const r = c.recurringExpenses.find((x) => x.id === "r1") || {};
    return {
      entryCount: c.entries.length, recurCount: c.recurringExpenses.length, finCount: c.financeEntries.length,
      e: { cover: e.coverUrl || null, length: e.length || null, genres: e.genres || null,
           rating: e.rating || null, notes: e.notes || null,
           mediaSource: e.mediaSource || null, mediaId: e.mediaId || null,
           startYear: e.startYear || null, startMonth: e.startMonth || null,
           updatedAt: e.updatedAt },
      r: { endDate: r.endDate || null, project: r.project || null,
           pauses: r.pauses || null, overrides: r.overrides || null, updatedAt: r.updatedAt },
    };
  });
  check("nothing was duplicated — one entry, one plan, one expense",
    after.entryCount === 1 && after.recurCount === 1 && after.finCount === 1, after);
  check("the entry got every field it was missing",
    after.e.cover === "https://x/celeste.png" && after.e.length === "8h" && after.e.rating === 5
    && after.e.notes === "loved it" && Array.isArray(after.e.genres), after.e);
  check("the media link arrived as a pair", after.e.mediaSource === "rawg" && after.e.mediaId === "17572", after.e);
  check("and so did the month span", after.e.startYear === 2025 && after.e.startMonth === 11, after.e);
  check("the plan got its end date, project, pauses and per-month changes",
    after.r.endDate === "2026-12-01" && after.r.project === "Switzerland"
    && Array.isArray(after.r.pauses) && after.r.pauses.length === 1
    && after.r.overrides && after.r.overrides["2026-04-01"], after.r);
  check("both updated records were re-stamped for sync, without a manual touch call",
    after.e.updatedAt > "2026-03-01T00:00:00.000Z" && after.r.updatedAt > "2026-01-01T00:00:00.000Z",
    { e: after.e.updatedAt, r: after.r.updatedAt });

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
