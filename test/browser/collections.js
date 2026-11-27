// Collections (0.204.0): a note category kept by name rather than by date —
// its chip, marked ▦, opens its notes as a page of their own, read as formatted
// Markdown. They stay in the dated feed too (they left it until 2026-11-27). At phone and desktop widths.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const T = (d) => `2026-0${d}-01T09:00:00.000Z`;
const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [
    { id: "recipes", name: "Recipes", color: "#e03131", layout: "collection" },
    { id: "work", name: "Work", color: "#1971c2" },
  ],
  notes: [
    { id: "pan", title: "Pancakes", text: "## Ingredients\n- [ ] flour\n- [x] eggs\n\n**Mix** well, see [this](https://example.com) and [that](javascript:alert(1)).\n\n```\nheat = 180\n```", category: "Recipes", createdAt: T(1), updatedAt: T(1) },
    { id: "bread", text: "# Bread\nFlour, water, salt.", category: "Recipes", createdAt: T(3), updatedAt: T(3) },
    { id: "day", text: "Went for a walk", createdAt: T(5), updatedAt: T(5) },
    { id: "mtg", text: "Standup notes", category: "Work", createdAt: T(4), updatedAt: T(4) },
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
  await forgetCopy(page);
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const at = " (" + width + "px)";
  const shot = (name) => page.screenshot({ path: require("path").join(require("os").tmpdir(), "coll-" + name + "-" + width + ".png") });
  const feed = () => page.evaluate(() => [...document.querySelectorAll(".note-card:not(.ll-exit)")].map((c) => c.dataset.id).sort());

  // No shelf since 0.206.0: the chip row already lists the categories, so a
  // collection's chip is marked and opens it.
  const collChip = (name) => page.locator("#catFilter .cat-chip.is-collection", { hasText: name });
  check("a collection's chip is marked as one, and there's no second list of them" + at, await page.evaluate(() =>
    [...document.querySelectorAll("#catFilter .cat-chip.is-collection")].map((c) => c.textContent.trim()).join() === "Recipes"
    && !document.querySelector(".notes-shelf")));
  check("and the feed keeps every note, collections' too" + at, JSON.stringify(await feed()) === JSON.stringify(["bread", "day", "mtg", "pan"]), await feed());
  await shot("feed");

  await collChip("Recipes").click();
  await page.waitForTimeout(300);
  check("a collection is a page of cards, by name" + at, await page.evaluate(() =>
    [...document.querySelectorAll(".coll-card-title")].map((t) => t.textContent).join() === "Bread,Pancakes"));
  check("a card previews the words, not the Markdown" + at, await page.evaluate(() =>
    !/[#*`]/.test(document.querySelector('.coll-card[data-id="pan"] .coll-card-text').textContent)));
  check("the feed's year sections step aside" + at, (await feed()).length === 0, await feed());
  await shot("collection");

  await page.click('.coll-card[data-id="pan"]');
  await page.waitForSelector("#noteReader:not([hidden])", { timeout: 3000 });
  check("a note opens as a page with its Markdown drawn" + at, await page.evaluate(() => {
    const b = document.querySelector("#noteReaderBody");
    return document.querySelector("#noteReaderTitle").textContent === "Pancakes" && !!b.querySelector("h3") &&
      b.querySelectorAll("li.md-task").length === 2 && !!b.querySelector("li.md-task.is-done") && !!b.querySelector("strong") && !!b.querySelector("pre code");
  }));
  check("an http link is a link, a javascript: one isn't" + at, await page.evaluate(() => {
    const links = [...document.querySelectorAll("#noteReaderBody a")];
    return links.length === 1 && links[0].href === "https://example.com/" && links[0].rel.includes("noopener");
  }));
  await shot("reader");
  await page.click("#editNoteReaderBtn");
  await page.waitForTimeout(200);
  check("Edit opens the note sheet on it" + at, await page.evaluate(() =>
    document.querySelector("#noteReader").hidden && !document.querySelector("#noteModal").hidden && document.querySelector("#nTitle").value === "Pancakes"));
  await page.click("#cancelNoteBtn");

  await page.click('.coll-card[data-id="bread"]');
  await page.waitForSelector("#noteReader:not([hidden])", { timeout: 3000 });
  check("with no title, the first line is the title and stays out of the body" + at, await page.evaluate(() =>
    document.querySelector("#noteReaderTitle").textContent === "Bread" && document.querySelector("#noteReaderBody").textContent.trim() === "Flour, water, salt."));
  await page.click("#closeNoteReaderBtn");

  await page.click(".coll-head .btn-primary");
  await page.waitForTimeout(200);
  check("a note added from a collection starts in it" + at, await page.evaluate(() => document.querySelector("#nCategory").value === "Recipes"));
  await page.click("#cancelNoteBtn");

  await page.click(".coll-head .btn:not(.btn-primary)");
  await page.waitForTimeout(300);
  check("back to all notes brings the feed back" + at,
    JSON.stringify(await feed()) === JSON.stringify(["bread", "day", "mtg", "pan"]), await feed());
  await page.locator("#catFilter .cat-chip", { hasText: "Work" }).click();
  await page.waitForTimeout(200);
  await collChip("Recipes").click();
  await page.waitForTimeout(300);
  // Chips add up, collections too (0.221.0): a plain category beside a
  // collection is the feed, filtered to both.
  check("a collection's chip adds to the others, and with a plain one it's the feed of both" + at, await page.evaluate(() =>
    !document.querySelector(".coll-head") && [...document.querySelectorAll("#catFilter .cat-chip.on")].length === 2)
    && (await feed()).includes("mtg") && (await feed()).includes("bread"), await feed());
  await page.locator("#catFilter .cat-chip", { hasText: "Work" }).click();
  await collChip("Recipes").click();
  await page.waitForTimeout(300);

  // Typing opens the results page (0.251.0); Filter narrows the tab the old way.
  await page.fill("#search", "flour");
  await page.waitForTimeout(400);
  await page.click('#searchResults [data-filter="notes"]');
  await page.waitForTimeout(400);
  check("a search looks in the collections too" + at, (await feed()).includes("bread"), await feed());

  await page.click("#searchClear");
  await page.evaluate(() => window.LifeLogNotes.openNoteCatModal(window.LifeLogStorage.cachedCopy().noteCategories.find((c) => c.name === "Work")));
  await page.check("#noteCatCollection");
  await page.click("#noteCatForm button[type=submit]");
  await page.waitForTimeout(400);
  check("a category's sheet makes it a collection, and its notes stay in the feed" + at,
    (await page.evaluate(() => document.querySelectorAll("#catFilter .cat-chip.is-collection").length)) === 2
    && JSON.stringify(await feed()) === JSON.stringify(["bread", "day", "mtg", "pan"]), await feed());
  const saved = await page.evaluate(() => window.LifeLogStorage.cachedCopy().noteCategories.find((c) => c.name === "Work"));
  check("and it's saved on the category" + at, saved.layout === "collection", saved);

  // Two collections on are one page of both, each card naming its own.
  await collChip("Work").click();
  await collChip("Recipes").click();
  await page.waitForTimeout(300);
  const both = await page.evaluate(() => ({
    title: (document.querySelector(".coll-title") || {}).textContent || "",
    cards: [...document.querySelectorAll(".coll-card")].map((c) => c.dataset.id),
    meta: [...document.querySelectorAll(".coll-card-meta")].map((m) => m.textContent),
  }));
  check("two collections open as one page of both, each card saying which" + at,
    both.title.includes("Work") && both.title.includes("Recipes") && both.cards.includes("mtg") && both.cards.includes("bread")
    && both.meta.some((m) => m.startsWith("Work")) && both.meta.some((m) => m.startsWith("Recipes")), both);
  await page.locator(".coll-head .btn:not(.btn-primary)").click();
  await page.waitForTimeout(300);

  // ---- boards are a kind of note (0.204.0) ----
  await page.locator("#kindFilter .cat-chip", { hasText: "Boards" }).click();
  await page.waitForTimeout(600);
  check("Boards is a kind beside Notes, Lists and Quotes, and shows the boards, with the category chips" + at, await page.evaluate(() =>
    /No boards yet/.test(document.querySelector("#viewBody").textContent) && !document.querySelector("#catFilterGroup").hidden));
  check("with no Boards mode left" + at, await page.evaluate(() =>
    document.querySelectorAll('#viewTabs .tab[data-view="notes"] .tab-mode-dot').length === 2));
  await page.locator("#kindFilter .cat-chip.on").click();
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelector("#addBtn").click(); document.querySelector('#addMenu [data-add="board"]').click(); });
  await page.waitForTimeout(400);
  check("Board in the add menu asks a name and a category first, and makes nothing yet" + at, await page.evaluate(() =>
    !document.querySelector("#noteModal").hidden && !document.querySelector("#nBoardPad").hidden && document.querySelector("#nTextLabel").hidden
    && document.querySelector("#noteModalTitle").textContent === "New board" && window.LifeLogBoards.boardsNow().length === 0));
  await page.click("#cancelNoteBtn");
  await page.waitForTimeout(300);
  check("closing it makes no board" + at, await page.evaluate(() => document.querySelector("#noteModal").hidden && window.LifeLogBoards.boardsNow().length === 0));
  await page.evaluate(() => { document.querySelector("#addBtn").click(); document.querySelector('#addMenu [data-add="board"]').click(); });
  await page.waitForTimeout(300);
  await page.fill("#nTitle", "Garden plan");
  await page.click("#nBoardPad");
  await page.waitForTimeout(800);
  check("the blank board opens the editor on a board with that name" + at, await page.evaluate(() => {
    const b = window.LifeLogBoards.boardsNow();
    return !document.querySelector("#boardEditor").hidden && document.querySelector("#noteModal").hidden && b.length === 1 && b[0].name === "Garden plan";
  }));
  check("a board picks its category in the editor" + at, await page.evaluate(() =>
    [...document.querySelectorAll("#boardCategory option")].map((o) => o.value).join() === ",Recipes,Work"));
  await page.evaluate(() => window.LifeLogBoards.closeBoard());
  await page.waitForTimeout(400);
  await page.locator("#kindFilter .cat-chip.on").click();
  await page.waitForTimeout(400);
  check("and shows in All with the notes, as its picture" + at, await page.evaluate(() => {
    const card = [...document.querySelectorAll(".note-card.is-board")];
    return card.length === 1 && !!card[0].querySelector(".board-thumb-inline svg");
  }));
  await page.click(".note-card.is-board");
  await page.waitForTimeout(400);
  check("which opens the board" + at, await page.evaluate(() => !document.querySelector("#boardEditor").hidden));
  await page.selectOption("#boardCategory", "Recipes");
  await page.evaluate(() => window.LifeLogBoards.closeBoard());
  await page.waitForTimeout(400);
  const stored = await page.evaluate(() => window.LifeLogBoards.boardsNow()[0].category);
  check("filed in a collection, it stays in the feed and joins the collection's cards" + at,
    stored === "Recipes" && !!(await page.$(".note-card.is-board")), stored);
  await page.locator("#catFilter .cat-chip.is-collection", { hasText: "Recipes" }).click();
  await page.waitForTimeout(300);
  check("where it's a card like the notes" + at, await page.evaluate(() =>
    [...document.querySelectorAll(".coll-card")].some((c) => c.querySelector('.ico[data-ico="presentation"]') && c.querySelector("svg:not(.ico)"))));
  await page.locator(".coll-head .btn:not(.btn-primary)").click();
  await page.waitForTimeout(300);

  // The Boards page narrows by the chips too (0.207.0).
  await page.locator("#kindFilter .cat-chip", { hasText: "Boards" }).click();
  await page.waitForTimeout(400);
  check("a board shows its category on the Boards page" + at, await page.evaluate(() =>
    /Recipes/.test((document.querySelector(".board-card:not(.board-new) .board-cat") || {}).textContent || "")));
  await page.locator("#catFilter .cat-chip", { hasText: "Work" }).click();
  await page.waitForTimeout(300);
  check("and a category chip narrows the boards" + at, await page.evaluate(() =>
    !document.querySelector(".board-card:not(.board-new)") && /No boards in that category/.test(document.querySelector("#viewBody").textContent)));
  await page.locator("#catFilter .cat-chip", { hasText: "Work" }).click();
  await page.waitForTimeout(300);

  // ---- a board's ★, selecting in a collection and in a kind (0.208.0) ----
  await page.click(".board-card:not(.board-new) .board-fav");
  await page.waitForTimeout(300);
  check("a board can be a favourite, from the Boards page" + at, await page.evaluate(() =>
    window.LifeLogBoards.boardsNow()[0].fav === true && document.querySelector("#boardEditor").hidden
    && !!document.querySelector(".board-card:not(.board-new) .board-fav .ico.is-fill")));
  await page.locator("#kindFilter .cat-chip.on").click();
  await page.waitForTimeout(300);
  await collChip("Recipes").click();
  await page.waitForTimeout(300);
  check("and shows it where it's filed, first" + at, await page.evaluate(() => {
    const first = document.querySelector(".coll-card");
    return first.querySelector('.ico[data-ico="presentation"]') && first.querySelector(".note-fav.on");
  }));
  await page.locator(".coll-card .note-fav.on").click();
  await page.waitForTimeout(300);
  check("where ★ takes it off again" + at, await page.evaluate(() => !window.LifeLogBoards.boardsNow()[0].fav && document.querySelector("#boardEditor").hidden));

  await page.locator('.coll-card[data-id="pan"]').click({ delay: 700 });
  await page.waitForTimeout(300);
  await page.locator('.coll-card[data-id="bread"]').click();
  await page.waitForTimeout(300);
  check("holding a collection's card selects it, and a tap adds the next" + at, await page.evaluate(() =>
    !!document.querySelector(".bulk-bar") && document.querySelectorAll(".coll-card.is-selected").length === 2 && document.querySelector("#noteReader").hidden));
  await page.selectOption(".bulk-bar .bulk-move-select", "Work");
  await page.waitForTimeout(400);
  check("and Move files them elsewhere" + at, await page.evaluate(() =>
    window.LifeLogStorage.cachedCopy().notes.filter((n) => n.category === "Work").length === 3));
  await page.locator(".coll-head .btn:not(.btn-primary)").click();
  await page.waitForTimeout(300);
  if (await page.$(".bulk-bar")) await page.locator(".bulk-bar button", { hasText: "Cancel" }).click();

  await page.locator("#catFilter .cat-chip", { hasText: "No category" }).click();
  await page.locator("#kindFilter .cat-chip", { hasText: "Notes" }).click();
  await page.waitForTimeout(300);
  await page.locator('.note-card[data-id="day"] .note-text').click({ delay: 700 });
  await page.waitForTimeout(300);
  check("in a kind, holding a note's words selects it" + at, await page.evaluate(() =>
    !!document.querySelector(".bulk-bar") && !!document.querySelector('.note-card.is-selected[data-id="day"]')));
  await page.locator(".bulk-bar button", { hasText: "Cancel" }).click();
  await page.locator("#catFilter .cat-chip", { hasText: "No category" }).click();

  // Boards are selected like notes: on the Boards page, and in the feed.
  // Types add up since 0.214.0, so Notes goes off first: Boards alone is the page.
  await page.locator("#kindFilter .cat-chip", { hasText: "Notes" }).click();
  await page.locator("#kindFilter .cat-chip", { hasText: "Boards" }).click();
  await page.waitForTimeout(300);
  await page.locator(".board-card:not(.board-new) .board-thumb").click({ delay: 700 });
  await page.waitForTimeout(300);
  check("holding a board on the Boards page selects it" + at, await page.evaluate(() =>
    !!document.querySelector(".board-card.is-selected .bulk-check") && !!document.querySelector(".bulk-bar") && document.querySelector("#boardEditor").hidden));
  await page.selectOption(".bulk-bar .bulk-move-select", "Work");
  await page.waitForTimeout(500);
  check("and Move sets its category" + at, await page.evaluate(() => window.LifeLogBoards.boardsNow()[0].category === "Work"));
  await page.evaluate(() => window.LifeLogBoards.setCategory([window.LifeLogBoards.boardsNow()[0].id], ""));
  await page.locator("#kindFilter .cat-chip.on").click();
  await page.waitForTimeout(400);
  await page.locator(".note-card.is-board .board-thumb-inline").click({ delay: 700 });
  await page.waitForTimeout(300);
  check("in All a board stays while selecting, and can be selected" + at, await page.evaluate(() =>
    !!document.querySelector(".note-card.is-board.is-selected") && document.querySelector("#boardEditor").hidden));
  await page.locator('.note-card[data-id="day"]').click();
  await page.waitForTimeout(200);
  await page.locator(".bulk-bar button", { hasText: "Delete" }).click();
  await page.waitForTimeout(600);
  check("and Delete takes boards and notes together" + at, await page.evaluate(() =>
    !window.LifeLogBoards.boardsNow().length && !window.LifeLogStorage.cachedCopy().notes.some((n) => n.id === "day")));

  check("the page doesn't scroll sideways" + at, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check("no errors" + at, errs.length === 0, errs);
  await ctx.close();
}

// A list in a collection shows its tasks as rows (2026-11-24): a packing
// list that was all ticked read "All done" and nothing else.
const it = (id, text, done) => ({ id, text, done: !!done, ...(done ? { doneAt: T(2) } : {}) });
const LISTS = {
  ...SEED,
  noteCategories: [{ id: "pack", name: "Packing", color: "#2f9e44", layout: "collection" }],
  notes: [
    { id: "army", kind: "list", text: "Army", category: "Packing", items: [it("a1", "Boots", 1), it("a2", "Socks", 1)], createdAt: T(1), updatedAt: T(1) },
    { id: "ski", kind: "list", text: "Ski", category: "Packing", items: [it("s1", "Jackets"), it("s2", "Gloves", 1), ...[3, 4, 5, 6, 7, 8].map((k) => it("s" + k, "Thing " + k))], createdAt: T(1), updatedAt: T(1) },
    { id: "none", kind: "list", text: "Empty", category: "Packing", items: [], createdAt: T(1), updatedAt: T(1) },
  ],
};
async function runLists(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, LISTS);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const at = " (" + width + "px)";
  await page.locator("#catFilter .cat-chip.is-collection", { hasText: "Packing" }).click();
  await page.waitForTimeout(300);
  const rows = (id) => page.evaluate((id) => [...document.querySelectorAll(`.coll-card[data-id="${id}"] .todo-row`)]
    .map((r) => (r.classList.contains("is-done") ? "x " : "") + r.textContent), id);
  check("an all-done list shows its ticked tasks" + at, JSON.stringify(await rows("army")) === JSON.stringify(["x Boots", "x Socks"]), await rows("army"));
  const ski = await rows("ski");
  check("open tasks come first, six at most, with how many more" + at, ski.length === 6 && ski[0] === "Jackets" && !ski.some((r) => r.startsWith("x"))
    && /2/.test(await page.textContent('.coll-card[data-id="ski"] .coll-card-more')), ski);
  check("an empty list says so" + at, (await rows("none")).length === 0 && /Nothing here/.test(await page.textContent('.coll-card[data-id="none"]')));
  await page.click('.coll-card[data-id="ski"] .todo-row:first-child .todo-check');
  await page.waitForTimeout(300);
  check("a tick on the card ticks the task, without opening the list" + at, await page.evaluate(() =>
    window.LifeLogStorage.cachedCopy().notes.find((n) => n.id === "ski").items.find((i) => i.id === "s1").done
    && document.querySelector("#noteModal").hidden));
  await page.click('.coll-card[data-id="army"] .coll-card-title .note-list-tick');
  await page.waitForTimeout(300);
  check("the list's own tick on its card ticks the list" + at, await page.evaluate(() =>
    window.LifeLogStorage.cachedCopy().notes.find((n) => n.id === "army").done === true
    && document.querySelector('.coll-card[data-id="army"] .coll-card-title').classList.contains("is-done")
    && document.querySelector("#noteModal").hidden));
  // The list's page ticks its rows too (2026-11-24), saved at once.
  await page.click('.coll-card[data-id="ski"] .coll-card-title');
  await page.waitForTimeout(400);
  const sheetTicks = () => page.evaluate(() => [...document.querySelectorAll("#nItems .note-list-check")].map((c) => c.checked));
  check("the list's page has a tick on each row" + at, (await sheetTicks()).length === 8, await sheetTicks());
  await page.locator("#nItems .note-list-row").nth(1).locator(".note-list-check").click();
  await page.waitForTimeout(300);
  check("ticking one there saves it on the list and strikes the row" + at, await page.evaluate(() =>
    !window.LifeLogStorage.cachedCopy().notes.find((n) => n.id === "ski").items.find((i) => i.id === "s2").done
    && !document.querySelectorAll("#nItems .note-list-row")[1].classList.contains("is-done")));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("and leaving the page keeps the ticks" + at, await page.evaluate(() => {
    const items = window.LifeLogStorage.cachedCopy().notes.find((n) => n.id === "ski").items;
    return items.find((i) => i.id === "s1").done && !items.find((i) => i.id === "s2").done;
  }));
  await page.click('.coll-card[data-id="ski"] .coll-card-title');
  await page.waitForTimeout(400);
  await page.click("#nListTick");
  await page.waitForTimeout(300);
  check("the list's own tick on its page ticks it and every row" + at, await page.evaluate(() => {
    const n = window.LifeLogStorage.cachedCopy().notes.find((x) => x.id === "ski");
    return n.done && n.items.every((i) => i.done) && [...document.querySelectorAll("#nItems .note-list-check")].every((c) => c.checked);
  }));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("and it stays ticked after leaving" + at, await page.evaluate(() => window.LifeLogStorage.cachedCopy().notes.find((x) => x.id === "ski").done === true));
  check("no errors" + at, errs.length === 0, errs);
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  await run(b, 1280);
  await run(b, 390);
  await runLists(b, 1280);
  await runLists(b, 390);
  await b.close();
  done();
})();
