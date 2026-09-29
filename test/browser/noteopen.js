// The note widgets' way back into the app (0.199.0): ?action=open-note:<id>,
// which is what a widget's tap runs. At phone and desktop widths.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const T = (d) => `2026-0${d}-01T09:00:00.000Z`;
const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [],
  notes: [
    { id: "shop", kind: "list", text: "Shop", createdAt: T(2), updatedAt: T(2), items: [
      { id: "s1", text: "Milk" }, { id: "s2", text: "Eggs" }, { id: "s3", text: "Bread", done: true, doneAt: T(3) }] },
    { id: "work", kind: "list", text: "Work", createdAt: T(1), updatedAt: T(1), items: [{ id: "w1", text: "Taxes" }] },
    { id: "fin", kind: "list", text: "Finished", createdAt: T(3), updatedAt: T(3), items: [{ id: "f1", text: "Done", done: true, doneAt: T(3) }] },
    { id: "plain", text: "A plain note", createdAt: T(4), updatedAt: T(4) },
  ],
};

async function run(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const at = " (" + width + "px)";
  // Lists show every item, ticked or not: the Open items filter (0.199.0)
  // went in 0.206.0.
  check("Lists has no Open items filter" + at, await page.evaluate(() =>
    !document.querySelector(".notes-subkind") && ![...document.querySelectorAll("#kindFilter .cat-chip")].some((b) => /Open/.test(b.textContent))));

  // ---- a note widget's tap ----
  await page.goto(BASE + "/?action=open-note:plain", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  check("a note widget's tap opens its note" + at, await page.evaluate(() =>
    !document.querySelector("#noteModal").hidden && document.querySelector("#nText").value === "A plain note"));
  await page.goto(BASE + "/?action=open-note:gone", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  check("and says so when the note has gone since" + at, await page.evaluate(() =>
    document.querySelector("#noteModal").hidden && /deleted/.test(document.body.textContent)));

  check("no errors" + at, errs.length === 0, errs);
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  await run(b, 1280);
  await run(b, 390);
  await b.close();
  done();
})();
