// The note sheet (0.199.0): a plain note's optional title, a list's items
// written without ticks or a quick-add switch, and a quote's author and
// source side by side — at phone and desktop widths.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
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
  await forgetCopy(page);
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const at = " (" + width + "px)";
  const saved = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());
  const open = async (kind) => {
    await page.evaluate(() => window.LifeLogNotes.openNoteModal(null));
    await page.click(`#noteKindSeg [data-kind="${kind}"]`);
  };
  const save = async () => { await page.click("#noteModal button[type=submit]"); await page.waitForTimeout(300); };
  const shot = (name) => page.screenshot({ path: require("path").join(require("os").tmpdir(), "notesheet-" + name + "-" + width + ".png") });

  // ---- a plain note's title ----
  await open("text");
  check("a plain note offers an optional title" + at, await page.evaluate(() =>
    !document.querySelector("#nTitleLabel").hidden && document.querySelector("#nTitle").placeholder === "Title"));
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

  // ---- moving a list's items in the sheet (0.304.0) ----
  await page.evaluate(() => window.LifeLogNotes.openNoteModal(window.LifeLogStorage.cachedCopy().notes.find((n) => n.kind === "list")));
  for (const t of ["Tickets"]) { await page.fill("#nNewItem", t); await page.press("#nNewItem", "Enter"); }
  check("each row has a handle" + at, await page.evaluate(() => document.querySelectorAll("#nItems .note-list-grip").length === 3));
  check("and the sheet says what it's for" + at, await page.evaluate(() => !document.querySelector("#nListHint").hidden));
  const g = await page.locator("#nItems .note-list-grip").nth(2).boundingBox();
  const top = await page.locator("#nItems .note-list-row").nth(0).boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, top.y + 4, { steps: 8 });
  await page.mouse.up();
  const order = () => page.evaluate(() => [...document.querySelectorAll("#nItems .note-list-row input")].map((i) => i.value).join());
  check("dragging the last item's handle to the top moves it there" + at, await order() === "Tickets,Passport,Charger", await order());
  await page.focus("#nItems .note-list-row:nth-child(1) .note-list-grip");
  await page.keyboard.press("ArrowDown");
  check("the arrow keys move it one step" + at, await order() === "Passport,Tickets,Charger", await order());
  check("keeping the handle focused" + at, await page.evaluate(() => document.activeElement === document.querySelectorAll("#nItems .note-list-grip")[1]));
  await save();
  d = await saved();
  check("the new order is saved" + at, d.notes.find((n) => n.kind === "list").items.map((i) => i.text).join() === "Passport,Tickets,Charger");
  check("a checklist offers no image" + at, await page.evaluate(() => {
    window.LifeLogNotes.openNoteModal(window.LifeLogStorage.cachedCopy().notes.find((n) => n.kind === "list"));
    const hidden = (s) => getComputedStyle(document.querySelector(s)).display === "none";
    return hidden("#nAddImageBtn") && hidden("#nImages");
  }));
  await page.click("#cancelNoteBtn");

  // ---- reading and editing, and the line numbers (0.304.0) ----
  await page.evaluate(() => window.LifeLogNotes.openNote(window.LifeLogStorage.cachedCopy().notes.find((n) => n.title === "Idea")));
  check("a note opens to read by default" + at, await page.evaluate(() => !document.querySelector("#noteReader").hidden && document.querySelector("#noteModal").hidden));
  await page.click("#editNoteReaderBtn");
  check("Edit swaps to the editor" + at, await page.evaluate(() => document.querySelector("#noteReader").hidden && !document.querySelector("#noteModal").hidden));
  check("the dates sit in the foot" + at, await page.evaluate(() => !!document.querySelector(".nv-foot #noteStampLine:not([hidden])")));
  check("no line numbers until they're on" + at, await page.evaluate(() => getComputedStyle(document.querySelector("#nGutter")).display === "none"));
  await page.fill("#nText", "One\nTwo that is long enough to wrap on a phone screen, and then some more words after that\n\nFour");
  await page.evaluate(() => window.LifeLogSettings.openViewOptions("notes"));
  await page.selectOption("#noteLineNumbers", "on");
  await page.click("#closeViewOptionsBtn");
  const nums = await page.evaluate(() => [...document.querySelectorAll("#nGutter > span")].map((s) => [s.textContent, s.getBoundingClientRect().height]));
  check("one number per line typed" + at, nums.map((n) => n[0]).join() === "1,2,3,4", nums);
  check("a wrapped line's number is as tall as it" + (width < 500 ? at : " (wide: one row)" + at),
    width < 500 ? nums[1][1] > nums[0][1] * 1.5 : nums[1][1] >= nums[0][1] - 1, nums);
  check("the textarea grows rather than scrolls" + at, await page.evaluate(() => { const t = document.querySelector("#nText"); return t.scrollHeight <= t.clientHeight + 2; }));
  await page.click("#noteReadBtn");
  await page.waitForTimeout(300);
  check("Read saves and swaps back" + at, await page.evaluate(() => !document.querySelector("#noteReader").hidden && document.querySelector("#noteModal").hidden && /Four/.test(document.querySelector("#noteReaderBody").textContent)));
  d = await saved();
  check("with the text kept" + at, /Four$/.test(d.notes.find((n) => n.title === "Idea").text));
  await page.click("#closeNoteReaderBtn");
  await page.evaluate(() => window.LifeLogSettings.openViewOptions("notes"));
  await page.selectOption("#noteOpenIn", "edit");
  await page.click("#closeViewOptionsBtn");
  await page.evaluate(() => window.LifeLogNotes.openNote(window.LifeLogStorage.cachedCopy().notes.find((n) => n.title === "Idea")));
  check("Open a note in: Edit view opens the editor" + at, await page.evaluate(() => document.querySelector("#noteReader").hidden && !document.querySelector("#noteModal").hidden));
  await page.click("#noteMoreBtn");
  check("the ⋯ menu holds the kind, Make entry and Delete" + at, await page.evaluate(() => {
    const m = document.querySelector("#noteMoreMenu");
    const shown = (s) => { const e = m.querySelector(s); return !!e && e.getClientRects().length > 0; };
    return !m.hidden && shown('[data-kind="quote"]') && !shown('[data-kind="board"]') && shown("#noteToEntryBtn") && shown("#deleteNoteBtn");
  }));
  await page.keyboard.press("Escape");
  check("Escape shuts the menu, not the note" + at, await page.evaluate(() => document.querySelector("#noteMoreMenu").hidden && !document.querySelector("#noteModal").hidden));
  await page.click("#cancelNoteBtn");

  // ---- a quote's fields ----
  await open("quote");
  check("a quote has no title" + at, await page.evaluate(() => document.querySelector("#nTitleLabel").hidden));
  check("author and source sit side by side" + at, await page.evaluate(() => {
    const [a, s] = [...document.querySelectorAll("#nQuoteFields label")].map((l) => l.getBoundingClientRect());
    return Math.abs(a.top - s.top) < 2 && a.right <= s.left;
  }));
  await shot("quote");
  await page.click("#cancelNoteBtn");

  // ---- 0.304.x phone fixes ----
  await page.evaluate(() => window.LifeLogNotes.openNoteModal(null));
  check("the whole category chip is the picker, not a label over it" + at, await page.evaluate(() => {
    const c = document.querySelector("#noteModal .nv-cat").getBoundingClientRect();
    return [c.left + 3, c.left + c.width / 2, c.right - 3].every((x) => document.elementFromPoint(x, c.top + c.height / 2).id === "nCategory");
  }));
  check("a note has no View button of its own; Notebook's View has the options" + at,
    await page.evaluate(() => !document.querySelector("#noteModal .nv-bar [aria-label='View options'], #noteReader .nv-bar [aria-label='View options']")));
  await page.keyboard.press("Escape");
  check("Escape (and phone Back) shuts the editor" + at, await page.evaluate(() => document.querySelector("#noteModal").hidden));
  await page.evaluate(() => window.LifeLogNotes.openNoteReader(window.LifeLogStorage.cachedCopy().notes.find((n) => n.title === "Idea").id));
  await page.keyboard.press("Escape");
  check("and the reader" + at, await page.evaluate(() => document.querySelector("#noteReader").hidden));
  await page.evaluate(() => window.LifeLogNotes.openNoteReader(window.LifeLogStorage.cachedCopy().notes.find((n) => n.title === "Idea").id));
  await page.click("#editNoteReaderBtn");
  await page.waitForTimeout(50);
  check("switching to Edit doesn't put the cursor in the text (no keyboard)" + at,
    await page.evaluate(() => !document.querySelector("#noteModal").hidden && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)));
  await page.click("#cancelNoteBtn");

  if (width < 720) {
    // In the phone app the sheet fills the screen to its edges and keeps
    // only its own bar and foot clear of the status and gesture bars; the
    // padding every other sheet gets on native would float it over the page.
    const fit = await page.evaluate(() => {
      const html = document.documentElement;
      html.classList.add("native");
      html.style.setProperty("--safe-area-inset-top", "40px");
      html.style.setProperty("--safe-area-inset-bottom", "30px");
      window.LifeLogNotes.openNoteModal(null);
      const m = document.querySelector("#noteModal > .modal").getBoundingClientRect();
      const bar = document.querySelector("#noteModal .nv-bar").getBoundingClientRect();
      const foot = document.querySelector("#noteModal .nv-foot").getBoundingClientRect();
      return { m: [m.top, m.bottom], bar: bar.top, foot: foot.bottom, h: innerHeight };
    });
    check("on native the note fills the screen, its bar and foot clear of the system bars" + at,
      fit.m[0] === 0 && fit.m[1] === fit.h && fit.bar === 40 && fit.foot === fit.h - 30, fit);
    await page.click("#cancelNoteBtn");
    await page.evaluate(() => document.documentElement.classList.remove("native"));
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
  done();
})();
