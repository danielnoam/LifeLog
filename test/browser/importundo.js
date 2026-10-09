// Undo after import (0.256.0): the toast's Undo takes back exactly what one
// import did: the rows it added, the fields it filled, the categories it
// created, and nothing else.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ name: "Games", color: "#58a6ff" }],
  entries: [{ id: "e1", title: "Portal", category: "Games", year: 2023, month: 6, date: "2023-06-06", mediaSource: "steam", mediaId: "400" }, { id: "e2", title: "Mine", category: "Games", year: 2024, month: 1 }],
  backlog: [], notes: [], accomplishments: {}, habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [], settings: {},
};
const FILE = {
  categories: [{ name: "Games", color: "#58a6ff" }, { name: "Films", color: "#f0883e" }],
  entries: [
    { id: "e1", title: "Portal", category: "Games", year: 2023, month: 6, date: "2023-06-06", mediaSource: "steam", mediaId: "400", rating: 4, notes: "Great" },
    { id: "x1", title: "Heat", category: "Films", year: 2026, month: 2, date: "2026-02-14", rating: 5 },
  ],
  backlog: [{ id: "b1", title: "Collateral", category: "Films" }],
  notes: [{ id: "n1", title: "A note", text: "words", createdAt: "2026-01-05T10:00:00.000Z" }],
  accomplishments: { 2026: [{ id: "a1", text: "Ran a 10k" }] },
  settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)); }, SEED);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(300);
  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  await page.click('.srow[data-page="io"]'); await page.waitForTimeout(300);
  await page.setInputFiles("#importJsonInput", { name: "lifelog.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(FILE)) });
  await page.waitForSelector("#financePickerModal:not([hidden])"); await page.waitForTimeout(300);
  const data = () => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));
  await page.click("#financePickerConfirmBtn"); await page.waitForTimeout(700);
  let d = await data();
  check("the import landed: two more entries' worth, a backlog item, a note, an achievement, a category", d.entries.length === 3 && d.backlog.length === 1 && d.notes.length === 1 && (d.accomplishments["2026"] || []).length === 1 && d.categories.some((c) => c.name === "Films"), { e: d.entries.length, b: d.backlog.length, n: d.notes.length, c: d.categories.map((c) => c.name) });
  const portal = d.entries.find((e) => e.id === "e1");
  check("and Portal was filled in", portal.rating === 4 && portal.notes === "Great", portal);
  const toast = await page.evaluate(() => ({ text: document.querySelector("#toast").textContent, undo: !!document.querySelector("#toast .toast-action"), label: (document.querySelector("#toast .toast-action") || {}).textContent }));
  check("the toast offers Undo", /^Imported/.test(toast.text) && toast.undo && toast.label === "Undo", toast);

  await page.click("#toast .toast-action"); await page.waitForTimeout(700);
  d = await data();
  check("Undo removes what was added", d.entries.length === 2 && d.backlog.length === 0 && d.notes.length === 0 && !(d.accomplishments["2026"] || []).length, { e: d.entries.map((e) => e.title), b: d.backlog.length, n: d.notes.length });
  const portal2 = d.entries.find((e) => e.id === "e1");
  check("and puts the filled fields back to empty", portal2 && portal2.rating === undefined && portal2.notes === undefined, portal2);
  check("the category it created goes too, now that nothing uses it", d.categories.map((c) => c.name).join() === "Games", d.categories);
  check("what was there before is untouched", d.entries.some((e) => e.id === "e2"), d.entries);
  check("the toast says so", /undone/.test(await page.textContent("#toast")));
  check("no errors", errs.length === 0, errs);
  await ctx.close();
  await b.close();
  done();
})();
