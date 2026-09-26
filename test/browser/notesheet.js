// The note sheet (0.199.0): a plain note's optional title, a list's items
// written without ticks or a quick-add switch, and a quote's author and
// source side by side — at phone and desktop widths.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [], notes: [],
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
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));
  const open = async (kind) => {
    await page.evaluate(() => window.LifeLogNotes.openNoteModal(null));
    await page.click(`#noteKindSeg [data-kind="${kind}"]`);
  };
  const save = async () => { await page.click("#noteForm button[type=submit]"); await page.waitForTimeout(300); };
  const shot = (name) => page.screenshot({ path: require("path").join(require("os").tmpdir(), "notesheet-" + name + "-" + width + ".png") });

  // ---- a plain note's title ----
  await open("text");
  check("a plain note offers an optional title" + at, await page.evaluate(() =>
    !document.querySelector("#nTitleLabel").hidden && /optional/.test(document.querySelector("#nTitleLabelText").textContent)));
  await page.fill("#nTitle", "Idea");
  await page.fill("#nText", "Paint the fence blue");
  await shot("text");
  await save();
  let d = await saved();
  check("the title is saved apart from the words" + at, d.notes[0].title === "Idea" && d.notes[0].text === "Paint the fence blue", d.notes[0]);
  check("and heads its card" + at, await page.evaluate(() => {
    const c = document.querySelector(".note-card");
    return c.querySelector(".note-title").textContent === "Idea" && c.querySelector(".note-text").textContent === "Paint the fence blue";
  }));
  await open("text");
  await page.fill("#nTitle", "Just a title");
  await save();
  d = await saved();
  check("a title alone is a note" + at, d.notes.some((n) => n.title === "Just a title" && n.text === ""));

  // ---- a list's items ----
  await open("list");
  check("a list's sheet has no ticks and no quick-add switch" + at, await page.evaluate(() =>
    !document.querySelector("#nListEditor input[type=checkbox]") && !document.querySelector("#nQuickList")));
  await page.fill("#nTitle", "Trip");
  for (const t of ["Passport", "Charger"]) { await page.fill("#nNewItem", t); await page.press("#nNewItem", "Enter"); }
  check("items typed in are rows to edit, still without ticks" + at, await page.evaluate(() =>
    document.querySelectorAll("#nItems .note-list-row input[type=text]").length === 2 && !document.querySelector("#nItems input[type=checkbox]")));
  await shot("list");
  await save();
  d = await saved();
  check("and are saved in order" + at, d.notes.find((n) => n.kind === "list").items.map((i) => i.text).join() === "Passport,Charger");

  // ---- a quote's fields ----
  await open("quote");
  check("a quote has no title" + at, await page.evaluate(() => document.querySelector("#nTitleLabel").hidden));
  check("author and source sit side by side" + at, await page.evaluate(() => {
    const [a, s] = [...document.querySelectorAll("#nQuoteFields label")].map((l) => l.getBoundingClientRect());
    return Math.abs(a.top - s.top) < 2 && a.right <= s.left;
  }));
  await shot("quote");
  await page.click("#cancelNoteBtn");

  check("the page doesn't scroll sideways" + at, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
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
