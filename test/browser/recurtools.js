// Four Ledger changes from 0.228.0: a pasted price's currency symbol sets the
// currency, a monthly plan has a charge day of its own, logged expenses that
// look like a plan are offered for linking, and plans merge into one history.
// One-off charges on a plan came with the merge rework in 0.233.0.
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
    { id: "old", startDate: "2025-06-01", endDate: "2025-10-31", interval: "monthly", amount: 30, category: "Entertainment", note: "Streaming", createdAt: T, updatedAt: T },
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

  // ---- 4. merge ----
  await openPlan(page, "Gym classes");
  await page.click("#recMoreBtn");
  await page.click("#mergeBtn");
  await page.waitForTimeout(200);
  await page.locator(".picker-row", { hasText: "Gym" }).filter({ hasNotText: "classes" }).locator("input").check();
  await page.click("#financePickerConfirmBtn");
  await page.waitForTimeout(400);
  const gym = await plan(page, "gym"), gymx = await plan(page, "gymx");
  const merged = (gymx.prevId === "gym" && gym.endDate === "2026-01-04") || (gym.prevId === "gymx" && gymx.endDate === "2026-01-04");
  check("the plans become one history, the earlier ending the day before", merged, { gym, gymx });
  const later = gymx.prevId === "gym" ? gymx : gym;
  check("nothing is dropped: the overlap is kept as one-off charges", (later.extras || []).length > 0, later.extras);
  check("the sheet shows the history", await page.evaluate(() => !document.querySelector("#recPlanTrail").hidden));
  check("the list shows the merged bill once", await page.locator(".recur-row", { hasText: "Gym" }).count() === 1);
  await page.click(".toast-action");
  await page.waitForTimeout(400);
  const undone = await plan(page, "gymx");
  check("Undo puts both plans back", !undone.prevId && !(await plan(page, "gym")).endDate && !undone.extras, undone);
  check("and both rows are back", await page.locator(".recur-row", { hasText: "Gym" }).count() === 2);

  // ---- 5. a one-off charge ----
  await openPlan(page, "Netflix");
  await page.click("#recMoreBtn");
  await page.click("#addExtraBtn");
  await page.waitForSelector("#recurringOccModal:not([hidden])");
  check("the one-off sheet asks for a date and has no skip", await page.evaluate(() =>
    !document.querySelector("#recOccDateLabel").hidden && document.querySelector("#recOccSkipLabel").hidden));
  await page.fill("#recOccDate", "2026-01-20");
  await page.fill("#recOccAmount", "15");
  await page.fill("#recOccNote", "Netflix extra screen");
  await page.click("#recurringOccForm button[type=submit]");
  await page.waitForTimeout(400);
  net = await plan(page, "net");
  check("it is stored on the plan", net.extras && net.extras.length === 1 && net.extras[0].amount === 15 && net.extras[0].note === "Netflix extra screen", net.extras);
  const row = page.locator("#recOccList .rec-occ-row", { hasText: "one-off" });
  check("the sheet lists it among the charges", await row.count() === 1);
  check("the Ledger shows it", await page.locator(".finance-entry", { hasText: "Netflix extra screen" }).count() === 1);
  await row.click();
  await page.waitForSelector("#recurringOccModal:not([hidden])");
  await page.click("#resetRecOccBtn");
  await page.waitForTimeout(400);
  check("Delete removes it", !(await plan(page, "net")).extras);

  // ---- 6. a merged bill is one bar in the Summary ----
  await page.click("#cancelRecurringBtn");
  await openPlan(page, "Netflix");
  await page.click("#recMoreBtn");
  await page.click("#mergeBtn");
  await page.waitForTimeout(200);
  await page.locator(".picker-row", { hasText: "Streaming" }).locator("input").check();
  await page.click("#financePickerConfirmBtn");
  await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "summary" })));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(800);
  const bars = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".card")].find((c) => c.querySelector("h2") && c.querySelector("h2").textContent === "Recurring");
    return card ? [...card.querySelectorAll(".lbl")].map((l) => l.textContent) : null;
  });
  check("the Summary counts the merged plans as one bill", bars && bars.includes("Netflix") && !bars.includes("Streaming"), bars);

  await browser.close();
  done(errs);
})();
