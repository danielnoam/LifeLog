// Pictures on boards: an Obsidian drawing's vault picture kept on import,
// its web picture shown from its address, a missing one a dashed box named
// for its file; the preview drawing them from the files picked; the
// editor's Image button adding one, selected and in the middle; and
// images.js counting a board's pictures as used. At desktop and phone widths.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [], notes: [],
};
// A 40×20 PNG, so a picture's shape can be told from a square.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAe0lEQVR4nO3NkRrCYBiA0Z+iKIpGURSNomg0il6KoigajUZRNAreJ4qiKIpG0WgUjbqKLqTv3MBJSSYylZnMJZOFLGUluaxlI4WUshVkJ3s5yFEqqaWRk5yllYtc5SZ3echTXtLJW3oZ5COjfCVFHHHEEUccccQR/0/8AxlDex1kHMbfAAAAAElFTkSuQmCC", "base64");
const scene = { type: "excalidraw", elements: [
  { id: "r", type: "rectangle", x: 0, y: 0, width: 220, height: 120, strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeWidth: 2, seed: 3 },
  { id: "i1", type: "image", x: 240, y: 0, width: 200, height: 100, fileId: "aa11" },
  { id: "i2", type: "image", x: 0, y: 140, width: 120, height: 60, fileId: "bb22" },
  { id: "i3", type: "image", x: 240, y: 140, width: 160, height: 120, fileId: "cc33" },
] };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifelog-boardimages-"));
const drawing = path.join(dir, "Garden.excalidraw.md");
fs.writeFileSync(drawing, "---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n## Embedded Files\naa11: [[Attachments/Bed.png]]\n\nbb22: https://pictures.example.invalid/web.png\n\ncc33: [[Gone.png]]\n\n%%\n## Drawing\n```json\n" + JSON.stringify(scene) + "\n```\n%%\n");
fs.mkdirSync(path.join(dir, "Attachments"));
const bed = path.join(dir, "Attachments", "Bed.png");
fs.writeFileSync(bed, PNG);

async function run(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  let webAsked = 0;
  await page.route("https://pictures.example.invalid/**", (route) => { webAsked++; route.fulfill({ status: 200, contentType: "image/png", body: PNG }); });
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

  await page.setInputFiles("#importMdInput", [drawing, bed]);
  await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 4000 });
  check("the hint says a drawing's pictures come with it" + at, await page.evaluate(() =>
    /A drawing's pictures come in with it when the image files were picked too/.test(document.querySelector("#financePickerModal").textContent)));
  await page.locator("#financePickerList .picker-row .etitle", { hasText: "Garden" }).click();
  await page.waitForTimeout(500);
  const preview = await page.evaluate(() => {
    const box = document.querySelector(".picker-doc-board");
    const doc = box.closest(".picker-doc");
    return { images: [...box.querySelectorAll("image")].map((i) => i.getAttribute("href").slice(0, 6)), waiting: box.querySelectorAll(".board-pic-wait").length,
      label: [...box.querySelectorAll(".board-pic-label")].map((t) => t.textContent), leftOut: /Left out/.test(doc.textContent) };
  });
  check("the preview draws the vault picture from the file picked and the web one from its address" + at,
    preview.images.length === 2 && preview.images.includes("blob:h") && preview.images.includes("https:"), preview);
  check("the missing one is a dashed box named for its file" + at, preview.waiting === 1 && preview.label.join() === "Gone.png", preview);
  check("nothing is left out" + at, !preview.leftOut, preview);
  if (width < 500) await page.click("#financePickerPreviewBack");
  await page.waitForTimeout(200);

  await page.click("#financePickerConfirmBtn");
  await page.waitForTimeout(900);
  const board = await page.evaluate(() => window.LifeLogBoards.boardsNow()[0]);
  const pics = board.elements.filter((e) => e.t === "img");
  check("the board has its three pictures" + at, pics.length === 3, board.elements);
  check("the vault one is kept, the web one keeps its address, the missing one its name" + at,
    /^[a-z0-9]{8,40}\.png$/.test(pics[0].img || "") && !pics[0].miss && pics[1].url === "https://pictures.example.invalid/web.png" && !pics[1].img && pics[2].miss === "Gone.png", pics);
  check("the toast offers to find the missing one" + at, await page.evaluate(() =>
    [...document.querySelectorAll(".toast")].some((t) => /1 picture in a drawing wasn't among the files picked/.test(t.textContent))));
  check("images.js counts the board's picture as used" + at, await page.evaluate((id) =>
    window.LifeLogImages.usedIds([], window.LifeLogBoards.allBoards()).has(id), pics[0].img));

  // The editor draws it from this device's copy, and the Image button adds one.
  await page.evaluate((id) => window.LifeLogBoards.openBoard(id), board.id);
  await page.waitForTimeout(600);
  const drawn = await page.evaluate(() => [...document.querySelectorAll("#boardSvg .board-world image")].map((i) => i.getAttribute("href").slice(0, 5)));
  check("the editor draws the kept picture and the web one" + at, drawn.length === 2 && drawn.includes("blob:"), drawn);
  if (width >= 500) await page.screenshot({ path: path.join(dir, "board-desktop.png") });
  const chooser = page.waitForEvent("filechooser");
  await page.click('#boardTools [data-tool="image"]');
  await (await chooser).setFiles(bed);
  await page.waitForTimeout(800);
  const added = await page.evaluate(() => {
    const ed = window.LifeLogBoards.allBoards().find((b) => !b.scratch);
    const e = ed.elements[ed.elements.length - 1];
    return { t: e.t, img: e.img, ratio: e.w / e.h, selected: document.querySelectorAll("#boardSvg .board-overlay .board-handle").length };
  });
  check("the Image button adds a picture at its own shape, selected" + at, added.t === "img" && /\.png$/.test(added.img) && Math.abs(added.ratio - 2) < 0.1 && added.selected === 5, added);
  if (width < 500) await page.screenshot({ path: path.join(dir, "board-phone.png") });
  await page.evaluate(() => window.LifeLogBoards.closeBoard());
  await page.waitForTimeout(300);

  // A thumbnail drawn before its picture is read swaps the picture in.
  await page.evaluate(() => {
    const t = window.LifeLogBoards.thumbnail(window.LifeLogBoards.boardsNow()[0]);
    t.id = "thumbCheck";
    document.body.appendChild(t);
  });
  await page.waitForTimeout(400);
  check("a board's thumbnail draws its pictures" + at, await page.evaluate(() => document.querySelectorAll("#thumbCheck image").length) >= 3);
  check("the web picture was only ever asked of its own site" + at, webAsked >= 1, webAsked);
  check("the page doesn't scroll sideways" + at, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check("no errors" + at, errs.length === 0, errs);
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  await run(b, 1280);
  await run(b, 390);
  await b.close();
  if (process.env.KEEP_SHOTS) console.log("shots in " + dir);
  else fs.rmSync(dir, { recursive: true, force: true });
  done();
})();
