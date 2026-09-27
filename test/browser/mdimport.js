// Markdown files as notes (0.200.0): pick files or a folder, see one row per
// file, file the chosen ones under a category — an existing one, a new one,
// or each file's folder — and import. At phone and desktop widths.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [{ id: "ideas", name: "Ideas", color: "#5b8cff" }],
  notes: [{ id: "have", title: "Already here", text: "same words", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifelog-md-"));
const vault = path.join(dir, "Vault");
fs.mkdirSync(path.join(vault, "Recipes"), { recursive: true });
fs.mkdirSync(path.join(vault, "Travel"), { recursive: true });
fs.writeFileSync(path.join(vault, "Recipes", "Pancakes.md"), "Flour, eggs, milk.");
fs.writeFileSync(path.join(vault, "Travel", "Packing.md"), "# Packing\n- [ ] Passport\n- [x] Charger\n");
fs.writeFileSync(path.join(vault, "loose.md"), "---\ntitle: Loose thought\ncategory: Ideas\n---\nSomething.");
const files = {
  one: path.join(dir, "Standalone.md"), dup: path.join(dir, "Already here.md"), skip: path.join(dir, "image.png"),
};
fs.writeFileSync(files.one, "# Standalone\nWritten elsewhere.");
fs.writeFileSync(files.dup, "same words");
fs.writeFileSync(files.skip, "not markdown");

async function run(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Kitchen" : undefined));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const at = " (" + width + "px)";
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));
  const rows = () => page.evaluate(() => [...document.querySelectorAll("#financePickerList .picker-row")].map((r) => ({
    title: r.querySelector(".etitle").textContent, cat: (r.querySelector(".ecat") || {}).textContent || "", on: r.querySelector("input").checked })));
  // Ticks exactly these rows, and no others.
  const only = async (...titles) => page.evaluate((titles) => {
    for (const r of document.querySelectorAll("#financePickerList .picker-row")) {
      const cb = r.querySelector("input");
      if (cb.checked !== titles.includes(r.querySelector(".etitle").textContent)) cb.click();
    }
  }, titles);

  // ---- files ----
  await page.setInputFiles("#importMdInput", [files.one, files.dup, files.skip]);
  await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 4000 });
  let r = await rows();
  check("one row per Markdown file, the rest left out, a note you have hidden" + at,
    r.length === 1 && r[0].title === "Standalone" && r[0].on, r);
  check("the sheet offers to file them under a category" + at, await page.evaluate(() =>
    !document.querySelector("#financePickerCatBar").hidden && [...document.querySelectorAll("#financePickerCatSelect option")].some((o) => o.value === "Ideas")));
  await page.selectOption("#financePickerCatSelect", "Ideas");
  await page.click("#financePickerCatApply");
  r = await rows();
  check("Apply puts the selected in it" + at, r[0].cat === "Ideas", r);
  await page.click("#financePickerConfirmBtn");
  await page.waitForTimeout(400);
  let d = await saved();
  const standalone = d.notes.find((n) => n.title === "Standalone");
  check("and they come in as notes with their title, words and category" + at,
    !!standalone && standalone.text === "Written elsewhere." && standalone.category === "Ideas", standalone);

  // ---- a folder ----
  if (width > 500) {
    await page.setInputFiles("#importMdFolderInput", vault);
    await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 4000 });
    r = await rows();
    check("a folder brings every file in it, subfolders too" + at,
      r.map((x) => x.title).sort().join() === "Loose thought,Packing,Pancakes", r);
    check("a file's own category comes with it" + at, r.find((x) => x.title === "Loose thought").cat === "Ideas", r);
    await only("Loose thought", "Pancakes", "Packing");
    await page.selectOption("#financePickerCatSelect", "\u0000folder");
    await page.click("#financePickerCatApply");
    r = await rows();
    check("'Each file's folder' files each under its folder, and leaves one with none as it was" + at,
      r.find((x) => x.title === "Pancakes").cat === "Recipes" && r.find((x) => x.title === "Packing").cat === "Travel"
      && r.find((x) => x.title === "Loose thought").cat === "Ideas", r);
    check("and the folders are offered as new categories" + at, await page.evaluate(() =>
      /Recipes/.test(document.querySelector("#financePickerNewCatsList").textContent) && /Travel/.test(document.querySelector("#financePickerNewCatsList").textContent)));
    await only("Pancakes");
    await page.selectOption("#financePickerCatSelect", "\u0000new");
    await page.click("#financePickerCatApply");
    r = await rows();
    check("New category… names one and files the selected under it" + at, r.find((x) => x.title === "Pancakes").cat === "Kitchen", r);
    await only("Loose thought", "Pancakes", "Packing");
    await page.click("#financePickerConfirmBtn");
    await page.waitForTimeout(400);
    d = await saved();
    const packing = d.notes.find((n) => n.kind === "list" && n.text === "Packing");
    check("a file of tasks is a list, ticks kept" + at,
      !!packing && packing.items.map((i) => i.text + (i.done ? "✓" : "")).join() === "Passport,Charger✓" && packing.category === "Travel", packing);
    check("the categories used are created" + at,
      ["Kitchen", "Travel"].every((n) => d.noteCategories.some((c) => c.name === n)), d.noteCategories.map((c) => c.name));
  }

  check("the page doesn't scroll sideways" + at, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check("no errors" + at, errs.length === 0, errs);
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  await run(b, 1280);
  await run(b, 390);
  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  done();
})();
