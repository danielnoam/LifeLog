// Excalidraw drawings in the Markdown import: an Obsidian `.excalidraw.md`
// picked beside notes is a board row, previewed as the board it becomes,
// filed like the notes, and imported into boards.json; a second import of it
// is a duplicate. At phone and desktop widths.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [{ id: "ideas", name: "Ideas", color: "#5b8cff" }], notes: [],
};

const scene = { type: "excalidraw", elements: [
  { id: "r", type: "rectangle", x: 0, y: 0, width: 220, height: 120, strokeColor: "#1e1e1e", backgroundColor: "#ffc9c9", fillStyle: "solid", strokeWidth: 2, seed: 3 },
  { id: "t", type: "text", x: 70, y: 45, width: 80, height: 25, fontSize: 20, text: "Island", textAlign: "center", strokeColor: "#1e1e1e" },
  { id: "a", type: "arrow", x: 240, y: 60, width: 120, height: 0, points: [[0, 0], [120, 0]], strokeColor: "#1971c2", strokeWidth: 2, endArrowhead: "arrow" },
  { id: "d", type: "diamond", x: 380, y: 10, width: 100, height: 100, strokeColor: "#e03131", backgroundColor: "transparent", strokeWidth: 2 },
  { id: "f", type: "freedraw", x: 0, y: 150, width: 100, height: 20, strokeColor: "#2f9e44", strokeWidth: 1, points: [[0, 0], [30, 20], [60, 0], [100, 20]] },
  { id: "i", type: "image", x: 0, y: 200, width: 50, height: 50, fileId: "x" },
] };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifelog-excalidraw-"));
const drawing = path.join(dir, "Kitchen.excalidraw.md");
fs.writeFileSync(drawing, "---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n# Excalidraw Data\n## Text Elements\nIsland ^t\n\n%%\n## Drawing\n```json\n" + JSON.stringify(scene, null, 1) + "\n```\n%%\n");
const note = path.join(dir, "Shopping.md");
fs.writeFileSync(note, "Tiles, grout.");
const broken = path.join(dir, "Broken.excalidraw.md");
fs.writeFileSync(broken, "---\nexcalidraw-plugin: parsed\n---\n## Drawing\n```json\n{ not json\n```\n");

async function run(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const at = " (" + width + "px)";
  const rows = () => page.evaluate(() => [...document.querySelectorAll("#financePickerList .picker-row")].map((r) => ({
    title: r.querySelector(".etitle").textContent, cat: (r.querySelector(".ecat") || {}).textContent || "", on: r.querySelector("input").checked })));

  await page.setInputFiles("#importMdInput", [drawing, note, broken]);
  await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 4000 });
  let r = await rows();
  check("the drawing is a row beside the note" + at, r.length === 2 && r.some((x) => x.title === "Kitchen" && x.on) && r.some((x) => x.title === "Shopping"), r);
  check("the broken drawing says why" + at, await page.evaluate(() =>
    [...document.querySelectorAll(".toast")].some((t) => /Broken\.excalidraw\.md: This Excalidraw drawing's data can't be read/.test(t.textContent))));
  check("the hint says it becomes a board, and what's left out" + at, await page.evaluate(() =>
    /One file is an Excalidraw drawing and becomes a board; one has parts a board can't show/.test(document.querySelector("#financePickerModal").textContent)));

  // The preview: the board itself, and what it leaves out.
  await page.locator("#financePickerList .picker-row .etitle", { hasText: "Kitchen" }).click();
  await page.waitForTimeout(300);
  const preview = await page.evaluate(() => {
    const box = document.querySelector(".picker-doc-board");
    const doc = box && box.closest(".picker-doc");
    return box ? { paths: box.querySelectorAll("path").length, note: doc.textContent, w: box.getBoundingClientRect().width } : null;
  });
  check("the preview draws the board" + at, !!preview && preview.paths > 5 && preview.w > 100, preview);
  check("and names what it leaves out" + at, !!preview && /Left out, as a board can't show them: 1 image/.test(preview.note), preview && preview.note);
  if (width < 500) await page.click("#financePickerPreviewBack");
  await page.waitForTimeout(200);

  // Filed under a category with the note, then imported.
  await page.selectOption("#financePickerCatSelect", "Ideas");
  await page.click("#financePickerCatApply");
  r = await rows();
  check("Apply files the drawing too" + at, r.every((x) => x.cat === "Ideas"), r);
  await page.click("#financePickerConfirmBtn");
  await page.waitForTimeout(600);
  const boards = await page.evaluate(() => window.LifeLogBoards.boardsNow().map((b) => ({ name: b.name, category: b.category, ts: b.elements.map((e) => e.t + (e.fc ? ":" + e.fc : "")) })));
  check("it comes in as a board with its shapes" + at, boards.length === 1 && boards[0].name === "Kitchen" && boards[0].category === "Ideas"
    && boards[0].ts.join() === "rect:#ffc9c9,text,arrow,line,line,line,line,pen", boards);
  check("the toast counts the board and the note" + at, await page.evaluate(() =>
    [...document.querySelectorAll(".toast")].some((t) => /Imported 1 note, 1 board/.test(t.textContent))));

  // The solid fill is drawn in its own colour, softened on the dark theme.
  await page.evaluate(() => { const b = window.LifeLogBoards.boardsNow()[0]; window.LifeLogBoards.openBoard(b.id); });
  await page.waitForTimeout(400);
  const fillPaint = await page.evaluate(() => {
    const p = [...document.querySelectorAll("#boardEditor svg path")].find((x) => x.getAttribute("fill") === "#ffc9c9");
    return p ? p.getAttribute("fill-opacity") : null;
  });
  check("the rectangle's fill is its own colour, toned down on a dark theme" + at, fillPaint === "0.4", fillPaint);
  await page.evaluate(() => window.LifeLogBoards.closeBoard());
  await page.waitForTimeout(300);

  // Again: already there.
  await page.setInputFiles("#importMdInput", [drawing]);
  await page.waitForTimeout(800);
  const again = await page.evaluate(() => !document.querySelector("#financePickerModal").hidden
    ? [...document.querySelectorAll("#financePickerList .picker-row")].map((x) => x.querySelector("input").checked) : "closed");
  check("imported again, it's a duplicate, not ticked" + at, Array.isArray(again) ? again.every((x) => !x) : true, again);

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
