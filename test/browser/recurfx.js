// A recurring expense billed in a currency that isn't yours (0.165.0).
//
// The decision this feature turned on is that the rate is per occurrence, not
// per plan — so the suite's centre of gravity is the drift check: editing the
// plan's rate must not restate a charge that already has one of its own.
// api.frankfurter.dev is answered from inside the test, so the batch lookup
// is exercised without a network.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [],
  recurringExpenses: [{
    id: "r1", startDate: "2026-01-15", interval: "monthly",
    amount: 44.96, currency: "USD", fxAmount: 11.99, rate: 3.75,
    rates: { "2026-01-15": 3.4, "2026-02-15": 3.45 },
    category: "Entertainment", note: "Streaming", createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
  }],
  financeCategories: [{ id: "ent", name: "Entertainment", color: "#e2723b", updatedAt: "2026-01-01T00:00:00.000Z" }],
  settings: { currency: "ILS" },
};

// A believable ECB series: business days only, and moving, so a frozen rate
// is visibly different from the plan's fallback.
function seriesBody(start, end) {
  const rates = {};
  const d = new Date(start + "T00:00:00"), last = new Date(end + "T00:00:00");
  let i = 0;
  while (d <= last) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) rates[d.toISOString().slice(0, 10)] = { ILS: +(3.5 + (i % 7) * 0.01).toFixed(4) };
    d.setDate(d.getDate() + 1); i++;
  }
  return { amount: 1, base: "USD", rates };
}

const occRows = (page) => page.evaluate(() => [...document.querySelectorAll("#recOccList .rec-occ-row")].map((r) => ({
  date: r.querySelector(".rec-occ-date").textContent.trim(),
  billed: r.querySelector(".fx-paid") ? r.querySelector(".fx-paid").textContent.trim() : null,
  amount: r.querySelector(".rec-occ-amount").textContent.trim(),
  forecast: r.querySelector(".rec-occ-amount").classList.contains("is-provisional"),
})));

const planOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).recurringExpenses[0]);

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1100 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());

  let seriesCalls = 0, singleCalls = 0;
  await page.route("https://api.frankfurter.dev/**", (route) => {
    const u = new URL(route.request().url());
    const m = /\/v1\/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(u.pathname);
    if (m) { seriesCalls++; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(seriesBody(m[1], m[2])) }); }
    singleCalls++;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rates: { ILS: 3.9 }, date: "2026-06-01" }) });
  });
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.removeItem("lifelog-visual-settings-v1");
    localStorage.removeItem("lifelog-github-v1");
  }, SEED);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".recur-row", { timeout: 8000 });

  // ---- 1. the plan card reads like a foreign charge ----
  const card = await page.evaluate(() => {
    const r = document.querySelector(".recur-row");
    return { billed: r.querySelector(".fx-paid") && r.querySelector(".fx-paid").textContent.trim(),
             home: r.querySelector(".famount").textContent.trim() };
  });
  check("the plan card shows what you're billed beside what it comes to",
    /11\.99/.test(card.billed || "") && /44\.96/.test(card.home), card);

  // ---- 2. the ledger rows do too, without knowing about recurrence ----
  const ledger = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".finance-entry")].find((r) => r.querySelector(".recur-badge"));
    return row ? { billed: row.querySelector(".fx-paid") && row.querySelector(".fx-paid").textContent.trim(),
                   home: row.querySelector(".famount").textContent.trim() } : null;
  });
  check("a generated occurrence carries the foreign figure into the ledger",
    !!ledger && /11\.99/.test(ledger.billed || ""), ledger);

  // ---- 3. the modal opens in the plan's own currency ----
  await page.click(".recur-row");
  await page.waitForSelector("#recurringModal:not([hidden])", { timeout: 5000 });
  const form = await page.evaluate(() => ({
    amount: document.querySelector("#recAmount").value,
    currency: document.querySelector("#recCurrency").value,
    rate: document.querySelector("#recRate").value,
    rateShown: !document.querySelector("#recRateLabel").hidden,
    preview: document.querySelector("#recFxPreview").textContent,
    fetchShown: !document.querySelector("#recFetchRatesBtn").hidden,
  }));
  check("the amount box holds what you're billed, in the plan's currency",
    form.amount === "11.99" && form.currency === "USD" && form.rate === "3.75", form);
  check("the rate row is shown and the preview names it as the fallback",
    form.rateShown && /used for any date without a rate of its own/.test(form.preview), form.preview);
  check("Look up past rates is offered for this plan", form.fetchShown === true, form);

  // ---- 4. every charge starts as a forecast ----
  let rows = await occRows(page);
  check("occurrences are listed in the plan's currency", rows.every((r) => /11\.99/.test(r.billed || "")), rows.slice(0, 2));
  const seeded = rows.filter((r) => ["2026-01-15", "2026-02-15"].includes(r.date.slice(0, 10)));
  check("a charge with a rate of its own is not a forecast",
    seeded.length === 2 && seeded.every((r) => !r.forecast), seeded);
  check("and one still on the plan's fallback rate is",
    rows.filter((r) => r.forecast).length > 0, rows.map((r) => r.forecast));

  // ---- 5. the batch lookup freezes the past, and only the past ----
  await page.click("#recMoreBtn");
  await page.click("#recFetchRatesBtn");
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem("lifelog-cache-v1")).recurringExpenses[0];
    return p.rates && Object.keys(p.rates).length > 0;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const plan = await planOf(page);
  const today = new Date().toISOString().slice(0, 10);
  check("one range request covered the lot, not one per charge", seriesCalls === 1, { seriesCalls, singleCalls });
  check("every frozen date is in the past", Object.keys(plan.rates).every((d) => d <= today), Object.keys(plan.rates));
  check("the rates that were already set by hand were left exactly as they were",
    plan.rates["2026-01-15"] === 3.4 && plan.rates["2026-02-15"] === 3.45,
    { jan: plan.rates["2026-01-15"], feb: plan.rates["2026-02-15"] });
  const fetched = Object.entries(plan.rates).filter(([d]) => !["2026-01-15", "2026-02-15"].includes(d));
  check("the ones it fetched are the series' numbers, not the plan's fallback",
    fetched.length > 0 && fetched.every(([, r]) => r !== 3.75 && r >= 3.5 && r < 3.6), Object.fromEntries(fetched));

  await page.waitForSelector("#recurringModal:not([hidden])", { timeout: 5000 });
  rows = await occRows(page);
  const past = rows.filter((r) => r.date.slice(0, 10) <= today);
  check("past charges stop being forecasts once they have a rate",
    past.length > 0 && past.every((r) => !r.forecast), past.slice(0, 3));
  check("and their home figures moved off the fallback",
    past.every((r) => !/44\.96/.test(r.amount)), past.slice(0, 3));

  // ---- 6. THE POINT: editing the plan's rate cannot restate a frozen charge ----
  const before = (await occRows(page)).filter((r) => !r.forecast).map((r) => r.date + " " + r.amount);
  await page.fill("#recRate", "9");
  await page.click("#recurringForm button[type=submit]");
  await page.waitForSelector("#recurringModal", { state: "hidden", timeout: 5000 });
  await page.waitForTimeout(400);
  await page.click(".recur-row");
  await page.waitForSelector("#recurringModal:not([hidden])", { timeout: 5000 });
  rows = await occRows(page);
  const after = rows.filter((r) => !r.forecast).map((r) => r.date + " " + r.amount);
  check("a charge with its own rate is untouched by changing the plan's",
    before.length > 0 && JSON.stringify(before) === JSON.stringify(after), { before: before.slice(0, 3), after: after.slice(0, 3) });
  check("nothing is left on the fallback rate once every past charge has one",
    rows.every((r) => !r.forecast), rows.map((r) => r.forecast));
  // The plan's own headline figure is the one thing that should follow the
  // new rate — it describes the charge as it stands now, not one already made.
  const cardAfter = await page.evaluate(() => document.querySelector(".recur-row .famount").textContent.trim());
  check("the plan's own figure does follow the new rate", /107\.91/.test(cardAfter), cardAfter);

  // ---- 7. one occurrence edited by hand ----
  const targetDate = rows[rows.length - 1].date.slice(0, 10);
  await page.evaluate((d) => {
    [...document.querySelectorAll("#recOccList .rec-occ-row")]
      .find((r) => r.querySelector(".rec-occ-date").textContent.trim().startsWith(d)).click();
  }, targetDate);
  await page.waitForSelector("#recurringOccModal:not([hidden])", { timeout: 5000 });
  const occForm = await page.evaluate(() => ({
    label: document.querySelector("#recOccAmountLabel").textContent,
    amount: document.querySelector("#recOccAmount").value,
    rateShown: !document.querySelector("#recOccRateLabel").hidden,
    rate: document.querySelector("#recOccRate").value,
  }));
  check("the occurrence editor asks for the billed sum, in the plan's currency",
    /USD/.test(occForm.label) && occForm.amount === "11.99" && occForm.rateShown, occForm);
  await page.fill("#recOccAmount", "20");
  await page.fill("#recOccRate", "4");
  await page.click("#recurringOccForm button[type=submit]");
  await page.waitForSelector("#recurringOccModal", { state: "hidden", timeout: 5000 });
  await page.waitForTimeout(500);
  const edited = await planOf(page);
  check("the override records the billed sum, not the home figure",
    edited.overrides[targetDate].fxAmount === 20 && edited.overrides[targetDate].amount === undefined,
    edited.overrides[targetDate]);
  check("and a rate set by hand is frozen like a fetched one",
    edited.rates[targetDate] === 4, { date: targetDate, rate: edited.rates[targetDate] });

  // ---- 8. switching back to the home currency drops the lot ----
  // Saving an occurrence reopens the template behind it, so the card is
  // already covered — only reach for it when it isn't.
  if (await page.isHidden("#recurringModal")) await page.click(".recur-row");
  await page.waitForSelector("#recurringModal:not([hidden])", { timeout: 5000 });
  await page.selectOption("#recCurrency", "ILS");
  await page.fill("#recAmount", "50");
  await page.click("#recurringForm button[type=submit]");
  await page.waitForSelector("#recurringModal", { state: "hidden", timeout: 5000 });
  await page.waitForTimeout(500);
  const home = await planOf(page);
  check("going home-currency clears currency, fxAmount, rate and the frozen rates",
    !home.currency && !home.fxAmount && !home.rate && !home.rates && home.amount === 50, home);

  await ctx.close();
  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
