// Editing a row before it comes in, and seeing what an update writes
// (0.258.0): the pencil turns a row into a small form; Done writes the
// title, month, category and rating back into the item, and the import
// lands with them. An update row lists each value it fills.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ name: "Games", color: "#58a6ff" }, { name: "Films", color: "#f0883e" }],
  entries: [{ id: "e1", title: "Portal", category: "Games", year: 2023, month: 6, mediaSource: "steam", mediaId: "400" }],
  backlog: [], notes: [], accomplishments: {}, habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [], settings: {},
};
const FILE = {
  categories: [{ name: "Games", color: "#58a6ff" }, { name: "Books", color: "#3fb950" }],
  entries: [
    { id: "e1", title: "Portal", category: "Games", year: 2023, month: 6, mediaSource: "steam", mediaId: "400", rating: 4, notes: "Short and perfect", coverUrl: "https://img.test/portal.jpg" },
    { id: "x1", title: "Half-Life", category: "Games", year: 2026, month: 2, date: "2026-02-14" },
  ],
  backlog: [{ id: "b1", title: "Dune", category: "Books" }],
  settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
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

  const fills = await page.evaluate(() => [...document.querySelectorAll("#financePickerList .is-update .picker-fill")].map((f) => f.textContent));
  check("an update row lists what it writes, value by value", fills.some((f) => /rating★★★★/.test(f)) && fills.some((f) => /notes.*Short and perfect/.test(f)) && fills.some((f) => /cover.*a cover/.test(f)), fills);
  check("an update row has no pencil", await page.evaluate(() => !document.querySelector("#financePickerList .is-update .picker-edit")));
  const half = () => page.evaluateHandle(() => [...document.querySelectorAll("#financePickerList .picker-row")].find((r) => /Half-Life/.test(r.textContent)));
  await (await half()).asElement().$eval(".picker-edit", (b) => b.click()); await page.waitForTimeout(200);
  check("the pencil opens the row as a form", await page.isVisible("#financePickerList .picker-editor"));
  const labels = await page.evaluate(() => [...document.querySelectorAll("#financePickerList .picker-editor-field > span:first-child")].map((s) => s.textContent));
  check("an entry offers title, when, category and rating", labels.join() === "Title,When,Category,Rating", labels);
  check("the category list has yours and the import's new one", await page.evaluate(() => [...document.querySelectorAll("#financePickerList .picker-editor-field")].find((f) => /Category/.test(f.textContent)).querySelector("select").options.length) === 4);
  await page.fill("#financePickerList .picker-editor input[type=text]", "Half-Life 2");
  await page.evaluate(() => { const f = [...document.querySelectorAll("#financePickerList .picker-editor-field")]; const when = f.find((x) => /When/.test(x.textContent)); when.querySelector("select").value = "11"; when.querySelector("input").value = "2024"; f.find((x) => /Category/.test(x.textContent)).querySelector("select").value = "Books"; f.find((x) => /Rating/.test(x.textContent)).querySelector("select").value = "5"; });
  await page.click("#financePickerList .picker-editor .btn-primary"); await page.waitForTimeout(200);
  const row = await page.evaluate(() => { const r = [...document.querySelectorAll("#financePickerList .picker-row")].find((x) => /Half-Life 2/.test(x.textContent)); return r && { text: r.textContent.replace(/\s+/g, " ").trim(), edited: r.classList.contains("is-edited") }; });
  check("Done puts the row back with its new words and an edited mark", row && /Nov 2024/.test(row.text) && /Books/.test(row.text) && /edited/.test(row.text) && row.edited, row);
  await page.click("#financePickerConfirmBtn"); await page.waitForTimeout(600);
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));
  const hl = d.entries.find((e) => e.title === "Half-Life 2");
  check("the import lands with the edits", hl && hl.year === 2024 && hl.month === 11 && hl.category === "Books" && hl.rating === 5 && hl.date === undefined, hl);
  check("and nothing called Half-Life came in", !d.entries.some((e) => e.title === "Half-Life"));
  check("no errors", errs.length === 0, errs);
  await ctx.close();
  await b.close();
  done();
})();
