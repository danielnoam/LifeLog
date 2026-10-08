// Collections (0.204.0): a note category kept by name rather than by date —
// its notes leave the dated feed (its chip, marked ▦, opens them), open as a page of
// their own, and read as formatted Markdown. At phone and desktop widths.
const { chromium, BASE, tally } = require("./harness");
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
  check("and the feed keeps only what isn't in one" + at, JSON.stringify(await feed()) === JSON.stringify(["day", "mtg"]), await feed());
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
    JSON.stringify(await feed()) === JSON.stringify(["day", "mtg"]), await feed());
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
  await page.evaluate(() => window.LifeLogNotes.openNoteCatModal(JSON.parse(localStorage.getItem("lifelog-cache-v1")).noteCategories.find((c) => c.name === "Work")));
  await page.check("#noteCatCollection");
  await page.click("#noteCatForm button[type=submit]");
  await page.waitForTimeout(400);
  check("a category's sheet makes it a collection, and its notes leave the feed" + at,
    (await page.evaluate(() => document.querySelectorAll("#catFilter .cat-chip.is-collection").length)) === 2
    && JSON.stringify(await feed()) === JSON.stringify(["day"]), await feed());
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).noteCategories.find((c) => c.name === "Work"));
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
  await page.evaluate(() => window.LifeLogNotes.openNoteModal(null));
  await page.click('#noteKindSeg [data-kind="board"]');
  await page.waitForTimeout(800);
  check("Board in the note sheet opens a new board to draw on" + at, await page.evaluate(() =>
    !document.querySelector("#boardEditor").hidden && document.querySelector("#noteModal").hidden && window.LifeLogBoards.boardsNow().length === 1));
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
  check("filed in a collection, it leaves the feed and joins the collection's cards" + at,
    stored === "Recipes" && !(await page.$(".note-card.is-board")), stored);
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
    JSON.parse(localStorage.getItem("lifelog-cache-v1")).notes.filter((n) => n.category === "Work").length === 3));
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
    !window.LifeLogBoards.boardsNow().length && !JSON.parse(localStorage.getItem("lifelog-cache-v1")).notes.some((n) => n.id === "day")));

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
