// The Ledger's suggestions (0.309.0): a bill logged by hand spotted above
// Recurring (and not a weekly shop, a wandering price or a bill that's
// already a plan), Make recurring turning the run into one plan's charges,
// Not a bill remembered in the synced skips, the Add expense form taking the
// category a note was filed under last time, and the Summary's "<Month> so
// far" pace card flagging only the category heading over its usual.
// The clock is frozen at 12 November 2026. SHOTS=<dir> saves screenshots.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const T = "2026-06-01T00:00:00.000Z";
const NOW = "2026-11-12T10:00:00";
const e = (id, date, amount, category, note, sub) => ({ id, date, amount, category, note, createdAt: T, ...(sub ? { subcategory: sub } : {}) });
const SEED = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], notes: [], noteCategories: [], projects: [],
  financeCategories: [
    { id: "home", name: "Home", color: "#5b8cff" },
    { id: "food", name: "Food", color: "#4bd07a", subs: [{ id: "g", name: "Groceries", createdAt: T }] },
    { id: "fun", name: "Fun", color: "#c061cb" },
  ],
  financeEntries: [
    // A gym fee by hand: same day, one price change. The bill.
    e("g1", "2026-07-12", 32, "Home", "Gym"), e("g2", "2026-08-12", 32, "Home", "Gym"),
    e("g3", "2026-09-12", 35, "Home", "Gym"), e("g4", "2026-10-12", 35, "Home", "Gym"),
    // Coffee beans on the same day each month, at a different price each time.
    e("c1", "2026-08-03", 18, "Food", "Beans", "Groceries"), e("c2", "2026-09-03", 21, "Food", "Beans", "Groceries"),
    e("c3", "2026-10-03", 19, "Food", "Beans", "Groceries"),
    // Already a plan.
    e("n1", "2026-08-20", 15, "Fun", "Netflix"), e("n2", "2026-09-20", 15, "Fun", "Netflix"), e("n3", "2026-10-20", 15, "Fun", "Netflix"),
    // The usual: groceries 300 a month, fun 30 a month (a cinema trip at a
    // different price each time, so not a bill); November's fun is
    // already 90 by the 12th.
    ...[["08", 28], ["09", 33], ["10", 29]].flatMap(([m, x]) => [e("s" + m, `2026-${m}-05`, 282, "Food", "Shop", "Groceries"), e("f" + m, `2026-${m}-15`, x, "Fun", "Cinema")]),
    e("s11", "2026-11-05", 100, "Food", "Shop", "Groceries"), e("f11", "2026-11-09", 90, "Fun", "Concert"),
  ],
  recurringExpenses: [
    { id: "rent", startDate: "2026-01-01", interval: "monthly", amount: 1000, category: "Home", note: "Rent", createdAt: T },
    { id: "nf", startDate: "2026-11-20", interval: "monthly", amount: 15, category: "Fun", note: "Netflix", createdAt: T },
  ],
  settings: { currency: "USD" },
};

async function app(b, mode) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  page.on("pageerror", (x) => console.log("  pageerror: " + x.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(({ seed, mode }) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: mode }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, { seed: SEED, mode });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { page, ctx };
}

(async () => {
  const b = await chromium.launch();
  let { page, ctx } = await app(b, "entries");
  const saved = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());
  const cards = () => page.evaluate(() => [...document.querySelectorAll(".bill-suggest b")].map((x) => x.textContent));
  let c = await cards();
  check("the gym fee is spotted as a monthly bill", c.length === 1 && c[0] === "Gym looks like a monthly bill", c);
  check("it lists the four charges", await page.evaluate(() => document.querySelectorAll(".bill-suggest-dates span").length) === 4);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/suggest-390.png" });

  await page.click(".bill-suggest .btn-primary");
  await page.waitForTimeout(300);
  const form = await page.evaluate(() => ({ open: !document.querySelector("#recurringModal").hidden, start: document.querySelector("#recStart").value,
    interval: document.querySelector("#recInterval").value, amount: document.querySelector("#recAmount").value, note: document.querySelector("#recNote").value }));
  check("Make recurring opens the plan form filled from the run", form.open && form.start === "2026-07-12" && form.interval === "monthly" && +form.amount === 35 && form.note === "Gym", form);
  await page.evaluate(() => document.querySelector("#recurringForm").requestSubmit());
  await page.waitForTimeout(600);
  let d = await saved();
  const plan = d.recurringExpenses.find((r) => r.note === "Gym");
  check("saving makes the plan and takes the four expenses off the list", !!plan && !d.financeEntries.some((x) => x.note === "Gym"), d.financeEntries.filter((x) => x.note === "Gym"));
  check("the old price stays on the charges that paid it", plan && plan.overrides && Object.values(plan.overrides).filter((o) => o.amount === 32).length === 2, plan && plan.overrides);
  check("the card is gone once it's a plan", (await cards()).length === 0, await cards());
  await ctx.close();

  ({ page, ctx } = await app(b, "entries"));
  await page.click(".bill-suggest .btn:not(.btn-primary)");
  await page.waitForTimeout(400);
  d = await page.evaluate(() => window.LifeLogStorage.cachedCopy());
  check("Not a bill hides the card", (await page.evaluate(() => document.querySelectorAll(".bill-suggest").length)) === 0);
  check("and is kept in the synced skips", ((d.settings.importSkips || {}).bills || []).includes("Home|gym"), d.settings.importSkips);

  // Category memory in Add expense.
  await page.evaluate(() => window.LifeLogFinance.openFinanceModal ? window.LifeLogFinance.openFinanceModal(null) : null);
  await page.waitForTimeout(200);
  if (await page.evaluate(() => document.querySelector("#financeModal").hidden)) {
    await page.click(".fab >> visible=true"); await page.waitForTimeout(200);
    await page.getByText("Expense", { exact: true }).locator("visible=true").first().click();
    await page.waitForTimeout(300);
  }
  const before = await page.evaluate(() => document.querySelector("#finCategory").value);
  await page.fill("#finNote", "beans");
  let f = await page.evaluate(() => ({ v: document.querySelector("#finCategory").value, hint: document.querySelector("#finCatHint").hidden ? "" : document.querySelector("#finCatHint").textContent }));
  check("a note filed before takes its category and subcategory", f.v === "Food\u001fGroceries" && /Food › Groceries/.test(f.hint) && /3 Oct/.test(f.hint), f);
  await page.fill("#finNote", "beanstalk");
  f = await page.evaluate(() => ({ v: document.querySelector("#finCategory").value, hidden: document.querySelector("#finCatHint").hidden }));
  check("a note that stops matching puts the category back", f.v === before && f.hidden, { f, before });
  await page.selectOption("#finCategory", "Fun");
  await page.fill("#finNote", "Gym");
  f = await page.evaluate(() => document.querySelector("#finCategory").value);
  check("a category picked by hand is left alone", f === "Fun", f);
  await ctx.close();

  ({ page, ctx } = await app(b, "summary"));
  const pace = await page.evaluate(() => {
    const card = document.querySelector(".pace-card");
    if (!card) return null;
    return { head: card.querySelector("h2").textContent, rows: [...card.querySelectorAll(".pace-row")].map((r) => [r.querySelector(".pace-name").textContent, r.classList.contains("is-over"), r.querySelector(".pace-say").textContent]) };
  });
  check("Summary has the month-so-far card", pace && /November so far/.test(pace.head) && /day 12 of 30/.test(pace.head), pace);
  const row = (n) => pace && pace.rows.find((r) => r[0] === n);
  check("Fun, already three times its usual, is flagged first", pace && pace.rows[0][0] === "Fun" && row("Fun")[1], pace && pace.rows);
  check("rent on the 1st isn't paced into thirty rents", row("Home") && !row("Home")[1] && /On track/.test(row("Home")[2]), row("Home"));
  check("groceries on their usual course aren't flagged", row("Food") && !row("Food")[1], row("Food"));
  if (process.env.SHOTS) { await page.evaluate(() => document.querySelector(".pace-card").scrollIntoView()); await page.screenshot({ path: process.env.SHOTS + "/pace-390.png" }); }
  await ctx.close();

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
