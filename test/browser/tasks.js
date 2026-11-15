// Tasks: a checklist's items with a description, priority, date, repeat,
// reminder, and the list as a task itself (tasks.js). Driven through the card, the task sheet
// and the Date sheet on a phone-sized page, then checked in what was saved.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const pad = (n) => String(n).padStart(2, "0");
const day = (k) => { const x = new Date(); x.setDate(x.getDate() + k); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const T = "2026-01-01T09:00:00.000Z";
const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], todos: [], todoCategories: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [{ id: "c1", name: "Work", color: "#4f8cff" }],
  notes: [
    { id: "L", kind: "list", text: "Weekend", createdAt: T, updatedAt: T, items: [
      { id: "w", text: "Water the plants", date: day(0), repeat: { every: 3, unit: "day" } },
      { id: "p", text: "Pack" },
      { id: "late", text: "Return books", date: day(-1) },
    ] },
    { id: "M", kind: "list", text: "Errands", createdAt: T, updatedAt: T, items: [{ id: "s", text: "Stamps" }] },
  ],
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
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
  await page.waitForTimeout(500);
  const saved = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());
  const item = async (list, id) => (await saved()).notes.find((n) => n.id === list).items.find((i) => i.id === id);
  const L = '.note-card[data-id="L"]';

  check("a dated task shows its date under it, overdue in red", await page.evaluate((L) => {
    const late = document.querySelector(`${L} [data-item="late"] .todo-meta .is-late`);
    return !!late && /Yesterday/.test(late.textContent);
  }, L));
  check("a plain task is a plain row", await page.evaluate((L) => !document.querySelector(`${L} [data-item="p"] .todo-meta`), L));

  await page.click(`${L} [data-item="w"] .todo-check`);
  await page.waitForTimeout(300);
  const w = await item("L", "w");
  check("ticking a repeating task moves it on rather than finishing it", w.date === day(3) && !w.done && w.ticks.length === 1, w);
  check("and says where to, with Undo", /Next:/.test(await page.textContent("#toast")) && /Undo/.test(await page.textContent("#toast")));

  await page.click(`${L} [data-item="p"] .todo-body`);
  await page.waitForTimeout(300);
  check("tapping the words opens the task sheet", await page.evaluate(() => !document.querySelector("#taskModal").hidden));
  await page.fill("#taskText", "Pack the car");
  await page.fill("#taskNote", "Tent first");
  await page.selectOption("#taskPriority", "1");
  await page.selectOption("#taskCategory", "Work");
  await page.waitForTimeout(200);
  await page.click("#taskDateBtn");
  await page.waitForTimeout(300);
  await page.click(".task-quick-btn.is-tomorrow");
  await page.fill("#taskTime", "08:30");
  await page.dispatchEvent("#taskTime", "change");
  await page.selectOption("#taskRemind", "15");
  await page.fill("#taskDeadline", day(5));
  await page.dispatchEvent("#taskDeadline", "change");
  await page.click("#taskDateDone");
  await page.waitForTimeout(300);
  let p = await item("L", "p");
  check("the sheet's fields are saved", p.text === "Pack the car" && p.note === "Tent first" && p.priority === 1 && p.category === "Work"
    && p.date === day(1) && p.time === "08:30" && p.remind === 15 && p.deadline === day(5), p);
  check("the sheet has no subtasks of its own (the list is the task)", !(await page.$("#taskSubs")));
  await page.selectOption("#taskList", "M");
  await page.waitForTimeout(300);
  const d = await saved();
  check("moving a task to another list takes just that row", d.notes.find((n) => n.id === "M").items.map((i) => i.text).join() === "Stamps,Pack the car"
    && !d.notes.find((n) => n.id === "L").items.some((i) => i.id === "p"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape closes it", await page.evaluate(() => document.querySelector("#taskModal").hidden));

  const M = '.note-card[data-id="M"]';
  await page.click(`${M} .note-list-tick`);
  await page.waitForTimeout(300);
  const m = (await saved()).notes.find((n) => n.id === "M");
  check("ticking the list itself ticks all its rows", m.done === true && m.items.every((i) => i.done), m);
  await page.click(`${M} .note-list-tick`);
  await page.waitForTimeout(300);

  // Home's Coming up.
  await page.evaluate(() => { const t = [...document.querySelectorAll("nav button, .tab")].find((x) => /Home/.test(x.textContent)); t && t.click(); });
  await page.waitForTimeout(500);
  check("Home lists an overdue task under Overdue", await page.evaluate(() => {
    const sec = document.querySelector(".home-upcoming");
    return !!sec && /Overdue/i.test(sec.textContent) && /Return books/.test(sec.textContent);
  }));

  await ctx.close();
  await b.close();
  done(errs);
})();
