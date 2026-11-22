// Starting or ending a selection on a phone leaves the row you held where
// it was. Notes near the foot of a long feed used to jump ~200px (the tick
// column makes every card taller, and fresh month cards stood at their
// 300px content-visibility guess while the scroll was put back), the Ledger
// ~20px, the Timeline 4px.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();
const errs = [];

const day = (i) => new Date(Date.UTC(2026, 10, 20) - i * 3 * 86400000).toISOString().slice(0, 10);
const T = "2026-01-01T00:00:00.000Z";
const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }, { id: "b", name: "Books", color: "#e2b23b" }],
  entries: Array.from({ length: 120 }, (_, i) => ({ id: "e" + i, title: "Entry " + i, category: i % 2 ? "Games" : "Books", date: day(i), createdAt: T })),
  backlog: [],
  notes: Array.from({ length: 60 }, (_, i) => i % 4 === 0
    ? { id: "n" + i, kind: "list", text: "List " + i, createdAt: T, updatedAt: day(i) + "T00:00:00.000Z",
      items: Array.from({ length: 2 + (i % 5) }, (_, j) => ({ id: `i${i}_${j}`, text: "Item " + j })) }
    : { id: "n" + i, kind: "note", text: "Some words ".repeat(1 + (i % 7) * 6), createdAt: T, updatedAt: day(i) + "T00:00:00.000Z" }),
  financeEntries: Array.from({ length: 150 }, (_, i) => ({ id: "f" + i, description: "Expense " + i, amount: 10 + i, currency: "USD", category: "Food", date: day(i), createdAt: T })),
  financeCategories: [{ name: "Food", color: "#5b8cff" }],
  todos: [], todoCategories: [], projects: [], recurringExpenses: [], settings: {},
};

async function trial(page, { name, ui, lang, y }) {
  await page.evaluate(({ s, ui, lang }) => {
    localStorage.setItem("lifelog.lang", lang);
    localStorage.setItem("lifelog-ui-v1", JSON.stringify(ui));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
  }, { s: SEED, ui, lang });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => {
    const line = document.querySelector(".topbar").getBoundingClientRect().bottom;
    const row = [...document.querySelectorAll("#viewBody [data-id]")].find((e) => {
      const r = e.getBoundingClientRect();
      return r.height > 20 && r.top > Math.max(line + 40, innerHeight * 0.3) && r.bottom < innerHeight - 160;
    });
    if (!row) return null;
    const r = row.getBoundingClientRect();
    // Every frame from the press to well after Cancel: the worst offset seen.
    window.__worst = 0;
    let n = 0;
    const tick = () => {
      const e = document.querySelector(`#viewBody [data-id="${row.dataset.id}"]`);
      if (e) window.__worst = Math.max(window.__worst, Math.abs(e.getBoundingClientRect().top - r.top));
      if (++n < 60) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return { id: row.dataset.id, x: r.left + 30, y: r.top + 10 };
  });
  check(`${name}: a row to hold`, !!t);
  if (!t) return;
  await page.mouse.move(t.x, t.y);
  await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await page.waitForTimeout(350);
  const worst = await page.evaluate(() => window.__worst);
  const bulk = await page.evaluate(() => !!document.querySelector(".bulk-bar"));
  check(`${name}: holding a row starts selecting`, bulk);
  check(`${name}: the held row stays put (worst ${Math.round(worst)}px)`, worst <= 2, worst);
  // Cancel: the row last ticked (the held one) is the one kept.
  const keep = await page.evaluate((id) => ({ id, top: document.querySelector(`#viewBody [data-id="${id}"]`).getBoundingClientRect().top }), t.id);
  await page.evaluate(() => [...document.querySelectorAll(".bulk-bar .btn")].pop().click());
  await page.waitForTimeout(300);
  const after = await page.evaluate((id) => document.querySelector(`#viewBody [data-id="${id}"]`).getBoundingClientRect().top, keep.id);
  check(`${name}: Cancel keeps the held row put`, Math.abs(after - keep.top) <= 2, { before: keep.top, after });
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await trial(page, { name: "Notes, foot of the feed", ui: { view: "notes", notesMode: "notes" }, lang: "en", y: 1e6 });
  await trial(page, { name: "Notes, Hebrew", ui: { view: "notes", notesMode: "notes" }, lang: "he", y: 2500 });
  await trial(page, { name: "Ledger", ui: { view: "finance", financeMode: "entries" }, lang: "en", y: 5000 });
  await trial(page, { name: "Timeline", ui: { view: "timeline" }, lang: "en", y: 2500 });
  await b.close();
  done(errs);
})();
