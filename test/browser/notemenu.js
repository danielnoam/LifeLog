// A note's ⋯ menu, in Read and in Edit: Copy text puts the note's words on
// the clipboard (a checklist as task lines, a quote with who said it, the
// editor's unsaved words too), the star beside ⋯ makes it a favourite, and
// on a phone a sideways swipe flips Read and Edit.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [],
  notes: [
    { id: "t1", title: "Idea", text: "Paint the fence **blue**", createdAt: "2026-11-01T10:00:00.000Z" },
    { id: "q1", kind: "quote", text: "Less, but better.", author: "Dieter Rams", source: "Ten principles", createdAt: "2026-11-02T10:00:00.000Z" },
    { id: "l1", kind: "list", text: "Packing", items: [{ id: "a", text: "Socks", done: true }, { id: "b", text: "Charger" }], createdAt: "2026-11-03T10:00:00.000Z" },
  ],
};

async function run(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
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
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  const clear = () => page.evaluate(() => navigator.clipboard.writeText(""));
  const shown = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);
  const read = (id) => page.evaluate((i) => window.LifeLogNotes.openNoteReader(i), id);

  // ---- Read ----
  await read("t1");
  await page.click("#noteReaderMoreBtn");
  check("Read's ⋯ has Copy text, and the star sits beside ⋯" + at, await shown("#noteReaderCopyBtn") && await shown("#noteReaderFavBtn")
    && await page.evaluate(() => !document.querySelector("#noteReaderFavBtn").closest("#noteReaderMenu")));
  await clear();
  await page.click("#noteReaderCopyBtn");
  await page.waitForTimeout(150);
  check("a note copies its title and its words as written" + at, (await clip()) === "Idea\n\nPaint the fence **blue**", await clip());
  check("the menu shuts after copying" + at, await page.evaluate(() => document.querySelector("#noteReaderMenu").hidden));

  await page.click("#noteReaderFavBtn");
  await page.waitForTimeout(300);
  let d = await page.evaluate(() => window.LifeLogStorage.cachedCopy());
  check("Favourite from the reader stars the note" + at, d.notes.find((n) => n.id === "t1").fav === true);
  check("and the star is lit and offers Unfavourite" + at, await page.evaluate(() => {
    const f = document.querySelector("#noteReaderFavBtn");
    return f.getAttribute("aria-label") === "Unfavourite" && f.classList.contains("on");
  }));
  await page.click("#closeNoteReaderBtn");

  await read("q1");
  await page.click("#noteReaderMoreBtn");
  await clear();
  await page.click("#noteReaderCopyBtn");
  await page.waitForTimeout(150);
  check("a quote copies with who said it" + at, (await clip()) === "Less, but better.\n— Dieter Rams, Ten principles", await clip());
  await page.click("#closeNoteReaderBtn");

  // ---- Edit ----
  const openEdit = (id) => page.evaluate((i) => {
    window.LifeLogNotes.openNoteReader(i);
    document.querySelector("#editNoteReaderBtn").click();
  }, id);

  await openEdit("t1");
  await page.fill("#nText", "Paint the fence green");
  await page.click("#noteMoreBtn");
  check("Edit's ⋯ has Copy text, and the lit star beside it says Unfavourite" + at, await shown("#noteCopyBtn")
    && await page.evaluate(() => { const f = document.querySelector("#noteFavBtn"); return f.getAttribute("aria-label") === "Unfavourite" && f.classList.contains("on") && !f.closest("#noteMoreMenu"); }));
  await clear();
  await page.click("#noteCopyBtn");
  await page.waitForTimeout(150);
  check("the editor copies the words not saved yet" + at, (await clip()) === "Idea\n\nPaint the fence green", await clip());
  await page.click("#noteFavBtn");
  await page.waitForTimeout(150);
  await page.click("#cancelNoteBtn");
  await page.waitForTimeout(300);
  d = await page.evaluate(() => window.LifeLogStorage.cachedCopy());
  const t1 = d.notes.find((n) => n.id === "t1");
  check("Unfavourite in the editor sticks through the save" + at, !t1.fav && t1.text === "Paint the fence green", t1);

  await openEdit("l1");
  await page.click("#noteMoreBtn");
  await clear();
  await page.click("#noteCopyBtn");
  await page.waitForTimeout(150);
  check("a checklist copies as task lines" + at, (await clip()) === "Packing\n\n- [x] Socks\n- [ ] Charger", await clip());
  await page.click("#cancelNoteBtn");
  await page.waitForTimeout(200);

  await page.evaluate(() => window.LifeLogNotes.openNoteModal(null));
  check("a new note has no Copy text or Favourite" + at, await page.evaluate(() =>
    document.querySelector("#noteCopyBtn").hidden && document.querySelector("#noteFavBtn").hidden));
  await page.click("#cancelNoteBtn");
  await page.waitForTimeout(200);

  // ---- swipe ----
  if (width < 700) {
    const drag = async (sel, dx) => {
      const box = await page.locator(sel).boundingBox();
      const x0 = box.x + box.width / 2, y0 = box.y + Math.min(200, box.height / 2);
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + (dx * i) / 10, y0 + i * 0.3);
      await page.mouse.up();
      await page.waitForTimeout(400);
    };
    await read("t1");
    await drag("#noteReader .nv-scroll", -150);
    check("swiping left in Read opens Edit" + at, await page.evaluate(() =>
      document.querySelector("#noteReader").hidden && !document.querySelector("#noteModal").hidden));
    await page.fill("#nText", "Swiped words");
    await drag("#noteForm", 150);
    check("swiping right in Edit saves and goes back to Read" + at, await page.evaluate(() =>
      !document.querySelector("#noteReader").hidden && document.querySelector("#noteModal").hidden
      && document.querySelector("#noteReaderBody").textContent.includes("Swiped words")));
    await page.mouse.move(100, 300); await page.mouse.down(); await page.mouse.move(110, 500, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(300);
    check("a vertical drag in Read stays in Read" + at, await page.evaluate(() => !document.querySelector("#noteReader").hidden));
    await page.click("#closeNoteReaderBtn");
  }

  await ctx.close();
  return errs;
}

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const w of [390, 1280]) errs.push(...await run(b, w));
  await b.close();
  done(errs);
})();
