// One search across everything (0.251.0): the header's box opens a results
// page over the tab, grouped by where each hit lives; a row opens the item;
// a group's Filter line narrows that tab the old way. Phone and desktop.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const T = (d) => `2026-0${d}-01T09:00:00.000Z`;
const SEED = {
  categories: [{ name: "Games", color: "#58a6ff", kind: "game" }, { name: "Films", color: "#f0883e", kind: "film" }],
  entries: [
    { id: "e1", title: "Heat", category: "Films", year: 2026, month: 2, date: "2026-02-14", rating: 5, notes: "The diner scene with Pacino" },
    { id: "e2", title: "Hades II", category: "Games", year: 2026, month: 3, date: "2026-03", notes: "" },
  ],
  accomplishments: { 2026: [{ id: "a1", text: "Ran a half marathon", notes: "Pacino would not" }] },
  backlog: [
    { id: "b1", title: "Thief", category: "Films", notes: "De Niro, the diner heist", addedAt: T(1) },
    { id: "b2", title: "Zelda: Echoes of Wisdom", category: "Games", addedAt: T(2), startedAt: "2026-04-01" },
  ],
  habits: [{ id: "h1", name: "Read 20 pages", color: "#58a6ff", cadence: "daily", createdAt: T(1) }],
  financeCategories: [{ name: "Food", color: "#3be25a" }],
  financeEntries: [{ id: "f1", date: "2026-05-03", amount: 42, category: "Food", note: "Dinner at the diner" }],
  recurringExpenses: [], projects: [], settings: { currency: "USD" },
  noteCategories: [{ name: "Recipes", color: "#e2b23b", layout: "collection" }],
  notes: [
    { id: "n1", text: "Pacino's coffee: two shots, no sugar", category: "Recipes", createdAt: T(4), updatedAt: T(4) },
    { id: "n2", text: "Call the dentist", createdAt: T(5), updatedAt: T(5) },
    { id: "l1", kind: "list", text: "Shop", createdAt: T(2), updatedAt: T(2), items: [{ id: "s1", text: "Milk" }, { id: "s2", text: "Diner coupons" }] },
  ],
};

async function run(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 900 }, hasTouch: width < 600 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ disabledViews: [] }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const at = " (" + width + "px)";
  const type = async (q) => { await page.fill("#search", q); await page.waitForTimeout(350); };
  const groups = () => page.evaluate(() => [...document.querySelectorAll("#searchResults .search-group")].map((g) => g.dataset.view + ":" + g.querySelectorAll(".search-row").length));
  const titles = () => page.evaluate(() => [...document.querySelectorAll("#searchResults .search-row-title")].map((t) => t.textContent));

  // ---- one word, everywhere it lives ----
  await type("diner");
  check("typing opens the results page over the tab" + at, await page.evaluate(() =>
    !document.querySelector("#searchResults").hidden && getComputedStyle(document.querySelector("#content")).display === "none"));
  const g1 = await groups();
  check("the hits are grouped by tab, the current tab first" + at, g1[0] === "backlog:1" && g1.includes("timeline:1") && g1.includes("finance:1") && g1.includes("notes:1"), g1);
  check("a note's list item, an entry's notes and a Ledger note all count" + at, JSON.stringify((await titles()).sort()) === JSON.stringify(["Dinner at the diner", "Heat", "Shop", "Thief"].sort()), await titles());
  check("the match is quoted and marked" + at, await page.evaluate(() => {
    const s = [...document.querySelectorAll("#searchResults .search-row-snippet")].find((x) => /Pacino/.test(x.textContent));
    return !!s && s.querySelector("mark") && s.querySelector("mark").textContent.toLowerCase() === "diner";
  }));
  check("the tab's own filter is untouched: no match badges, feed not narrowed" + at, await page.evaluate(() => !document.querySelector(".tab-match-badge")));

  // ---- a row opens the thing ----
  await page.click("#searchResults .search-group[data-view=timeline] .search-row");
  await page.waitForTimeout(300);
  check("a Timeline hit opens the entry sheet" + at, await page.evaluate(() => !document.querySelector("#entryModal").hidden && document.querySelector("#fTitle").value === "Heat"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  check("Escape closes the sheet and leaves the results up" + at, await page.evaluate(() => document.querySelector("#entryModal").hidden && !document.querySelector("#searchResults").hidden));

  // ---- Pacino: an achievement, a collection note, an entry ----
  await type("pacino");
  const g2 = await groups();
  check("achievements and collection notes are searched too" + at, g2.includes("timeline:2") && g2.includes("notes:1"), g2);
  check("an in-progress Backlog item is tagged" + at, (await type("zelda"), await page.evaluate(() => /In progress/.test(document.querySelector("#searchResults .search-row-meta").textContent))));
  await page.click("#searchResults .search-group[data-view=backlog] .search-row"); await page.waitForTimeout(300);
  check("a Backlog hit opens its sheet" + at, await page.evaluate(() => !document.querySelector("#backlogModal").hidden && document.querySelector("#bTitle").value.startsWith("Zelda")));
  await page.keyboard.press("Escape");

  // ---- Ledger amount and habit ----
  await type("42");
  check("an amount finds the expense" + at, (await titles()).includes("Dinner at the diner"), await titles());
  await type("read 20");
  check("every word has to match, in any field" + at, JSON.stringify(await titles()) === JSON.stringify(["Read 20 pages"]), await titles());
  await page.click("#searchResults .search-row"); await page.waitForTimeout(300);
  check("a habit hit opens the habit sheet" + at, await page.evaluate(() => !document.querySelector("#habitModal").hidden));
  await page.keyboard.press("Escape");

  // ---- Settings pages are in the same list ----
  await type("theme");
  check("a Settings page is a hit too" + at, (await groups()).some((g) => g.startsWith("settings:")), await groups());
  await page.click("#searchResults .search-group[data-view=settings] .search-row"); await page.waitForTimeout(400);
  check("and opens Settings on it" + at, await page.evaluate(() => !document.querySelector("#settingsModal").hidden));
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await page.waitForTimeout(200);

  // ---- nothing ----
  await type("xyzzy");
  check("no hits says so" + at, await page.evaluate(() => /Nothing matches/.test(document.querySelector("#searchResults").textContent)));

  // ---- Filter the tab: the old behaviour, on purpose ----
  await type("diner");
  await page.click('#searchResults [data-filter="timeline"]'); await page.waitForTimeout(400);
  check("Filter narrows that tab and closes the page" + at, await page.evaluate(() =>
    document.querySelector("#searchResults").hidden && document.querySelector('.tab[data-view="timeline"]').classList.contains("active")
    && document.querySelectorAll("#viewBody .entry").length === 1 && /Heat/.test(document.querySelector("#viewBody .entry").textContent)));
  check("the badges come back in filter mode" + at, await page.evaluate(() => !!document.querySelector('.tab[data-view="finance"] .tab-match-badge')));
  check("a line says the tab is narrowed" + at, await page.evaluate(() => !document.querySelector("#searchFilterNote").hidden && /diner/.test(document.querySelector("#searchFilterNote").textContent)));
  await page.click("#searchFilterNote button:first-of-type"); await page.waitForTimeout(300);
  check("All results reopens the page with the same text" + at, await page.evaluate(() => !document.querySelector("#searchResults").hidden && document.querySelector("#search").value === "diner"));

  // ---- keyboard ----
  await page.focus("#search");
  await page.keyboard.press("ArrowDown");
  check("ArrowDown from the box lands on the first result" + at, await page.evaluate(() => document.activeElement.classList.contains("search-row")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  check("Escape clears the search" + at, await page.evaluate(() => document.querySelector("#searchResults").hidden && document.querySelector("#search").value === "" && getComputedStyle(document.querySelector("#content")).display !== "none"));

  // ---- the clear button ----
  await type("heat");
  await page.click("#searchClear"); await page.waitForTimeout(200);
  check("✕ clears it too" + at, await page.evaluate(() => document.querySelector("#searchResults").hidden && !document.querySelector(".tab-match-badge")));

  // ---- a disabled tab has no group ----
  await page.evaluate(() => localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ disabledViews: ["travel", "finance"] })));
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(300);
  await type("diner");
  check("a tab turned off has no group" + at, !(await groups()).some((g) => g.startsWith("finance:")), await groups());

  if (width < 600) {
    const box = await (await page.$("#searchResults .search-row")).boundingBox();
    check("rows are thumb-sized" + at, box.height >= 44, box);
  }
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
