// Four Ledger changes from 0.228.0: a pasted price's currency symbol sets the
// currency, a monthly plan has a charge day of its own, logged expenses that
// look like a plan are offered for linking, and plans combine into one row.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const T = "2026-01-01T00:00:00.000Z";
const SEED = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [
    { id: "e1", date: "2025-11-03", type: "expense", amount: 39.9, category: "Entertainment", note: "Netflix", createdAt: T, updatedAt: T },
    { id: "e2", date: "2025-12-03", type: "expense", amount: 39.9, category: "Entertainment", note: "Netflix", createdAt: T, updatedAt: T },
    { id: "e3", date: "2025-12-10", type: "expense", amount: 400, category: "Entertainment", note: "Concert", createdAt: T, updatedAt: T },
  ],
  recurringExpenses: [
    { id: "net", startDate: "2026-01-01", interval: "monthly", amount: 39.9, category: "Entertainment", note: "Netflix",
      overrides: { "2026-02-01": { note: "Netflix, price test" } }, createdAt: T, updatedAt: T },
    { id: "gym", startDate: "2026-01-05", interval: "yearly", amount: 1200, category: "Entertainment", note: "Gym", createdAt: T, updatedAt: T },
    { id: "gymx", startDate: "2026-01-05", interval: "monthly", amount: 50, category: "Entertainment", note: "Gym classes", createdAt: T, updatedAt: T },
  ],
  financeCategories: [{ id: "ent", name: "Entertainment", color: "#e2723b", updatedAt: T }],
  settings: { currency: "ILS" },
};

const plan = (page, id) => page.evaluate((id) => JSON.parse(localStorage.getItem("lifelog-cache-v1")).recurringExpenses.find((r) => r.id === id), id);
const openPlan = async (page, note) => {
  await page.locator(".recur-row", { hasText: note }).first().click();
  await page.waitForSelector("#recurringModal:not([hidden])");
};
const paste = (page, sel, text) => page.evaluate(([sel, text]) => {
  const dt = new DataTransfer();
  dt.setData("text", text);
  document.querySelector(sel).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, [sel, text]);

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.route("https://**", (route) => route.abort());

  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.removeItem("lifelog-github-v1");
  }, SEED);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".recur-row", { timeout: 8000 });

  // ---- 1. a pasted "$12.50" becomes 12.5 in dollars ----
  await page.evaluate(() => window.LifeLogFinance.openFinanceModal(null));
  await paste(page, "#finAmount", "$12.50");
  const pasted = await page.evaluate(() => ({ amount: document.querySelector("#finAmount").value, cur: document.querySelector("#finCurrency").value,
    rateShown: !document.querySelector("#finRateLabel").hidden }));
  check("a pasted price loses its symbol and sets the currency", pasted.amount === "12.5" && pasted.cur === "USD" && pasted.rateShown, pasted);
  await paste(page, "#finAmount", "40");
  check("a bare number pastes as usual", await page.evaluate(() => document.querySelector("#finCurrency").value) === "USD");
  await page.evaluate(() => window.LifeLogFinance.closeFinanceModal());

  // ---- 2. charge day ----
  await openPlan(page, "Netflix");
  check("a plan started on the 1st reads as charged on the 1st", await page.inputValue("#recChargeDay") === "1");
  await page.selectOption("#recChargeDay", "15");
  await page.click("#recurringForm button[type=submit]");
  await page.waitForTimeout(300);
  let net = await plan(page, "net");
  check("picking the 15th stores it as the charge day", net.chargeDay === 15 && net.startDate === "2026-01-01", net);
  check("the override follows its charge to the 15th", !!(net.overrides && net.overrides["2026-02-15"]) && !net.overrides["2026-02-01"], net.overrides);
  await openPlan(page, "Netflix");
  const occ = await page.evaluate(() => [...document.querySelectorAll("#recOccList .rec-occ-date")].map((e) => e.textContent.trim()).slice(-2));
  check("its charges fall on the 15th", occ.every((d) => /-15/.test(d)), occ);
  await page.selectOption("#recInterval", "yearly");
  check("a yearly plan has no charge day to pick", await page.evaluate(() => document.querySelector("#recChargeDayLabel").hidden));
  await page.selectOption("#recInterval", "monthly");

  // ---- 3. the link offer ----
  const offer = await page.evaluate(() => ({ shown: !document.querySelector("#recLinkOffer").hidden, text: document.querySelector("#recLinkOfferText").textContent }));
  check("the sheet offers the two Netflix expenses", offer.shown && /^2 /.test(offer.text), offer);
  await page.click("#recLinkOfferBtn");
  await page.waitForSelector("#financePickerModal:not([hidden]), .picker-row", { timeout: 4000 });
  const ticked = await page.evaluate(() => [...document.querySelectorAll(".picker-row")].filter((r) => r.querySelector("input").checked).map((r) => r.querySelector(".etitle").textContent));
  check("the lookalikes are ticked and the concert isn't", ticked.length === 2 && ticked.every((t) => t === "Netflix"), ticked);
  await page.click("#financePickerConfirmBtn");
  await page.waitForTimeout(400);
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).financeEntries.map((e) => e.id));
  net = await plan(page, "net");
  check("linking removes them and starts the plan earlier", left.join() === "e3" && net.startDate === "2025-11-03", { left, start: net.startDate });
  await page.click("#cancelRecurringBtn");

  // ---- 4. combine ----
  await openPlan(page, "Gym");
  await page.click("#recMoreBtn");
  await page.click("#combineBtn");
  await page.waitForTimeout(200);
  await page.locator(".picker-row", { hasText: "Gym classes" }).locator("input").check();
  await page.click("#financePickerConfirmBtn");
  await page.waitForTimeout(400);
  check("the part joins the plan it was combined with", (await plan(page, "gymx")).combinedWith === "gym");
  check("the sheet lists the other part", await page.evaluate(() => /Gym classes/.test(document.querySelector("#recCombinedList").textContent)
    && !document.querySelector("#recCombined").hidden));
  await page.click("#cancelRecurringBtn");
  const rows = await page.evaluate(() => [...document.querySelectorAll(".recur-row")].map((r) => r.textContent));
  const gymRows = rows.filter((t) => /Gym/.test(t));
  check("the two read as one row, a month's worth together", gymRows.length === 1 && /2 plans/.test(gymRows[0]) && /150/.test(gymRows[0]), gymRows);

  await openPlan(page, "Gym");
  await page.click("#recMoreBtn");
  await page.click("#separateBtn");
  await page.waitForTimeout(400);
  check("separating leaves two plans of their own", !(await plan(page, "gymx")).combinedWith && !(await plan(page, "gym")).combinedWith);

  await browser.close();
  done(errs);
})();
