// Date boxes in the app's date format (src/datefield.js), and a list note
// keeping its items on its card while selecting.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();
const errs = [];

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  entries: [{ id: "e1", title: "Hollow Thing", category: "Games", year: 2026, month: 3, day: 9, startedAt: "2026-02-14", createdAt: "2026-03-09T00:00:00.000Z" }],
  backlog: [],
  notes: [
    { id: "l1", kind: "list", text: "Groceries", items: [{ id: "i1", text: "Milk" }, { id: "i2", text: "Eggs", done: true, doneAt: "2026-03-01T00:00:00.000Z" }], createdAt: "2026-03-01T00:00:00.000Z" },
    { id: "n1", text: "A plain note", createdAt: "2026-03-02T00:00:00.000Z" },
  ],
  todos: [], todoCategories: [], projects: [], financeEntries: [], recurringExpenses: [], financeCategories: [],
  settings: { dateFormat: "mdy" },
};

const load = async (page, ui) => {
  await page.evaluate(({ s, ui }) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify(ui));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
  }, { s: SEED, ui });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
};
const faces = (page) => page.evaluate(() => ["#fStartDate", "#fDate"].map((id) => {
  const i = document.querySelector(id);
  return { value: i.value, face: i.parentElement.querySelector(".date-face").textContent };
}));

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });

  await load(page, { view: "timeline" });
  await page.locator(".entry").first().click();
  await page.waitForSelector("#entryForm .date-face");
  let f = await faces(page);
  check("Started and Finished read in the chosen format", f[0].face === "Feb 14, 2026" && f[1].face === "Mar 9, 2026", f);
  check("the boxes keep their ISO values", f[0].value === "2026-02-14" && f[1].value === "2026-03-09", f);

  await page.evaluate(() => {
    const i = document.querySelector("#fDate");
    i.value = "2026-04-01";
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  f = await faces(page);
  check("a new day redraws the face", f[1].face === "Apr 1, 2026", f);

  await page.evaluate(() => { document.querySelector("#fStartDate").value = ""; });
  f = await faces(page);
  check("an empty Started has an empty face", f[0].face === "", f);

  const typed = await page.evaluate(() => {
    const i = document.querySelector("#fDate");
    i.focus();
    i.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    const on = i.parentElement.classList.contains("is-typing");
    i.blur();
    return { on, off: !i.parentElement.classList.contains("is-typing") };
  });
  check("typing shows the box's own fields until it's left", typed.on && typed.off, typed);
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    window.LifeLogDates.bind(() => ({ dateFormat: "iso" }));
    window.LifeLogDateField.refresh();
  });
  check("a format change redraws every face", await page.evaluate(() =>
    document.querySelector("#fDate").parentElement.querySelector(".date-face").textContent === "2026-04-01"));

  // Selecting notes: a list keeps its items, read-only.
  await load(page, { view: "notes", notesMode: "notes" });
  await page.evaluate(() => document.querySelector('.note-card[data-id="n1"]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 400, clientY: 300 })));
  await page.waitForTimeout(200);
  const sel = page.locator(".menu-pop button, .menu-pop [role=menuitem]").filter({ hasText: /^Select/ });
  if (await sel.count()) await sel.first().click();
  await page.waitForSelector(".note-card.is-bulk");
  const list = await page.evaluate(() => {
    const card = document.querySelector('.note-card[data-id="l1"]');
    return {
      items: [...card.querySelectorAll(".todo-text")].map((t) => t.textContent),
      done: card.querySelectorAll(".todo-row.is-done").length,
      compose: !!card.querySelector(".todo-compose"),
      disabled: [...card.querySelectorAll(".todo-check")].every((c) => c.disabled),
    };
  });
  check("a list keeps its items on its card while selecting", list.items.join() === "Milk,Eggs" && list.done === 1, list);
  check("they're read-only there, with no add line", !list.compose && list.disabled, list);
  await page.locator('.note-card[data-id="l1"] .todo-text').first().click();
  check("a press on an item selects the list", await page.evaluate(() =>
    document.querySelector('.note-card[data-id="l1"]').classList.contains("is-selected")));

  await b.close();
  done(errs);
})();
