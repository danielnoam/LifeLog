// Notes, round two (0.195.0): three kinds of note — plain, checklist, quote —
// with categories of their own, the chip row filtering by them, a kind
// switch and a sort of their own. Driven through the note sheet and the
// cards the way a person would, then checked in what was saved.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const T = (d) => `2026-0${d}-01T09:00:00.000Z`;
const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], todos: [], todoCategories: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [],
  notes: [
    { id: "old", text: "An older note", createdAt: T(1), updatedAt: T(1), editedAt: "2026-09-20T09:00:00.000Z" },
    { id: "mid", text: "A middle note", createdAt: T(5), updatedAt: T(5) },
  ],
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
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
  await page.waitForTimeout(500);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));
  // Not the ones animating out (reconcile marks them ll-exit on their way).
  const cards = () => page.evaluate(() => [...document.querySelectorAll(".note-card:not(.ll-exit)")].map((c) => c.dataset.id));
  const openNew = async (kind) => {
    await page.click('.month-add-btn, [data-add="note"]').catch(() => {});
    await page.evaluate(() => { if (document.querySelector("#noteModal").hidden) window.LifeLogNotes.openNoteModal(null); });
    await page.click(`#noteKindSeg [data-kind="${kind}"]`);
  };
  const save = async () => { await page.click("#noteForm button[type=submit]"); await page.waitForTimeout(250); };

  // ---- a checklist, under a category made from the sheet ----
  await openNew("list");
  check("the List kind shows a title and a checklist, not the note box or the quote's fields", await page.evaluate(() =>
    !document.querySelector("#nTitleLabel").hidden && !document.querySelector("#nListEditor").hidden &&
    document.querySelector("#nTextLabel").hidden && getComputedStyle(document.querySelector("#nQuoteFields")).display === "none"));
  await page.fill("#nTitle", "Packing");
  for (const t of ["Passport", "Charger", "Jacket"]) { await page.fill("#nNewItem", t); await page.press("#nNewItem", "Enter"); }
  await page.fill("#nNewItem", "Socks"); // typed, never Entered: still meant
  await page.selectOption("#nCategory", "\u0000new");
  await page.fill("#noteCatName", "Trip");
  await page.click("#noteCatForm button[type=submit]");
  await page.waitForTimeout(150);
  check("a category made from the sheet is chosen in it", await page.inputValue("#nCategory") === "Trip");
  await save();
  let d = await saved();
  const list = d.notes.find((n) => n.kind === "list");
  check("the list is saved with its title, every item (the un-Entered one too) and its category",
    list && list.text === "Packing" && list.items.map((i) => i.text).join() === "Passport,Charger,Jacket,Socks" && list.category === "Trip", list);
  check("and the category exists", d.noteCategories.some((c) => c.name === "Trip"));

  // ---- a quote ----
  await openNew("quote");
  await page.fill("#nText", "The best way out is always through.");
  await page.fill("#nAuthor", "Robert Frost");
  await save();
  d = await saved();
  const quote = d.notes.find((n) => n.kind === "quote");
  check("a quote keeps its words and author", quote && quote.author === "Robert Frost");
  check("and is shown in quote marks with its author", await page.evaluate(() => {
    const c = document.querySelector(".note-card.is-quote");
    return !!c && /Robert Frost/.test(c.querySelector(".note-author").textContent) && !!c.querySelector("blockquote");
  }));

  // ---- ticking on the card ----
  const listId = list.id;
  await page.locator(`.note-card[data-id="${listId}"] .note-item`).first().click();
  await page.waitForTimeout(250);
  d = await saved();
  const ticked = d.notes.find((n) => n.id === listId);
  check("an item ticks straight from the card, without opening the note",
    ticked.items[0].done === true && !!ticked.items[0].doneAt && await page.evaluate(() => document.querySelector("#noteModal").hidden));
  check("and a tick isn't an edit", !ticked.editedAt);
  check("the card then counts it as done", /1 done/.test(await page.locator(`.note-card[data-id="${listId}"]`).textContent()));

  // ---- filters ----
  await page.click('.notes-kind:has-text("Lists")');
  check("the kind switch narrows to lists", JSON.stringify(await cards()) === JSON.stringify([listId]), await cards());
  await page.click('.notes-kind:has-text("All")');
  await page.locator("#catFilter .cat-chip", { hasText: "Trip" }).click();
  await page.waitForTimeout(150);
  check("a category chip narrows to its notes", JSON.stringify(await cards()) === JSON.stringify([listId]), await cards());
  await page.locator("#catFilter .cat-chip", { hasText: "Trip" }).click();
  await page.locator("#catFilter .cat-chip", { hasText: "No category" }).click();
  await page.waitForTimeout(150);
  check("and No category to the ones without", !(await cards()).includes(listId) && (await cards()).length === 3, await cards());
  await page.locator("#catFilter .cat-chip", { hasText: "No category" }).click();
  await page.fill("#search", "charger");
  await page.waitForTimeout(400);
  check("search finds a checklist by one of its items", JSON.stringify(await cards()) === JSON.stringify([listId]), await cards());
  await page.fill("#search", "frost");
  await page.waitForTimeout(400);
  check("and a quote by its author", JSON.stringify(await cards()) === JSON.stringify([quote.id]), await cards());
  await page.fill("#search", "");
  await page.waitForTimeout(400);

  // ---- sort ----
  const order = () => cards();
  await page.selectOption(".notes-toolbar .sort-select", "oldest");
  await page.waitForTimeout(200);
  check("Oldest first puts the oldest note first", (await order())[0] === "old", await order());
  await page.selectOption(".notes-toolbar .sort-select", "edited");
  await page.waitForTimeout(200);
  const edited = await order();
  check("Recently edited files a note by when it was last edited", edited.indexOf("old") < edited.indexOf("mid"), edited);
  check("and the choice is saved", (await saved()).settings.noteSort === "edited");

  // ---- editing: kinds change, and what counts as an edit ----
  await page.locator('.note-card[data-id="mid"]').click();
  await page.waitForTimeout(150);
  await page.selectOption("#nCategory", "Trip");
  await save();
  d = await saved();
  check("filing a note under a category isn't an edit", d.notes.find((n) => n.id === "mid").category === "Trip" && !d.notes.find((n) => n.id === "mid").editedAt);
  await page.locator('.note-card[data-id="mid"]').click();
  await page.waitForTimeout(150);
  check("Make entry is offered on a plain note", await page.evaluate(() => !document.querySelector("#noteToEntryBtn").hidden));
  await page.click('#noteKindSeg [data-kind="quote"]');
  check("but not on a quote", await page.evaluate(() => document.querySelector("#noteToEntryBtn").hidden));
  await page.fill("#nAuthor", "Me");
  await save();
  d = await saved();
  const turned = d.notes.find((n) => n.id === "mid");
  check("a note can become a quote, which is an edit", turned.kind === "quote" && turned.author === "Me" && !!turned.editedAt, turned);

  // ---- bulk: move to a category ----
  // Held on the date line: a long-press on the note's own words is left to
  // selecting text.
  await page.locator('.note-card[data-id="old"] .note-stamp').click({ delay: 700 });
  await page.waitForTimeout(200);
  const bulk = await page.evaluate(() => !!document.querySelector(".bulk-bar .bulk-move-select"));
  check("selecting notes offers Move to category", bulk);
  if (bulk) {
    await page.selectOption(".bulk-bar .bulk-move-select", "Trip");
    await page.waitForTimeout(300);
    check("which files them there", (await saved()).notes.find((n) => n.id === "old").category === "Trip");
  }

  // ---- what survives ----
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check("every kind is drawn again after a reload", await page.evaluate(() =>
    !!document.querySelector(".note-card.is-list") && !!document.querySelector(".note-card.is-quote")));

  await ctx.close();
  await b.close();
  done(errs);
})();
