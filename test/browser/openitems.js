// Open items (0.199.0): every unticked item across the lists, a filter
// under Lists in the Notes mode bar, and the note widgets' way back into the app
// (?action=open-note:<id>, which is what a widget's tap runs). At phone and
// desktop widths.
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
  const cards = () => page.evaluate(() => [...document.querySelectorAll(".note-card:not(.ll-exit)")].map((c) => c.dataset.id));

  check("Open isn't one of the kinds, and isn't offered off Lists" + at, await page.evaluate(() =>
    ![...document.querySelectorAll(".notes-kind")].some((b) => /Open/.test(b.textContent)) && !document.querySelector(".notes-subfilter")));
  await page.locator(".notes-kind", { hasText: "Quotes" }).click();
  await page.waitForTimeout(200);
  check("nor under Quotes" + at, !(await page.$(".notes-subfilter")));
  await page.locator(".notes-kind", { hasText: "Lists" }).click();
  await page.waitForTimeout(200);
  const chip = page.locator(".notes-subkind", { hasText: "Open" });
  check("under Lists, a filter below the bar counts what's left to tick" + at, (await chip.textContent()).trim() === "Open items · 3");
  await chip.click();
  await page.waitForTimeout(300);
  check("Open shows only the lists with something left, in the to-do widget's order" + at,
    JSON.stringify(await cards()) === JSON.stringify(["work", "shop"]), await cards());
  check("with no finished rows and no Clear" + at, await page.evaluate(() =>
    !document.querySelector(".note-card .todo-row.is-done") && !document.querySelector(".todo-done-sep")
    && ![...document.querySelectorAll(".note-card .btn")].some((x) => x.textContent === "Clear")));
  check("and no years: one block that says how much is left" + at, await page.evaluate(() =>
    document.querySelectorAll(".year-block").length === 1 && /3 in 2 lists/.test(document.querySelector(".year-block .ycount").textContent)));
  check("the page doesn't scroll sideways" + at, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await page.locator('.note-card[data-id="work"] .todo-check').click();
  await page.waitForTimeout(500);
  check("ticking a list's last item takes the list off Open" + at, JSON.stringify(await cards()) === JSON.stringify(["shop"]), await cards());
  check("and the count follows" + at, (await chip.textContent()).trim() === "Open items · 2");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));
  check("the tick is saved like any other" + at, saved.notes.find((n) => n.id === "work").items[0].done === true);

  await page.locator('.note-card[data-id="shop"] .note-list-compose input').fill("Butter");
  await page.locator('.note-card[data-id="shop"] .note-list-compose input').press("Enter");
  await page.waitForTimeout(300);
  check("adding from Open lands in the list" + at, await page.evaluate(() =>
    [...document.querySelectorAll('.note-card[data-id="shop"] .todo-text')].map((x) => x.textContent).join() === "Milk,Eggs,Butter"));
  await page.screenshot({ path: require("path").join(require("os").tmpdir(), "openitems-" + width + ".png"), fullPage: false });

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
