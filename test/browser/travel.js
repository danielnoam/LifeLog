// The Travel tab (0.241.0): a trip from its empty state, places on a day
// with and without a time and with no day at all, the order a day shows
// them in, ticking one as visited, a reload keeping all of it (travel.json's
// device cache), Undo after a delete, and the trip list's card.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [], entries: [], backlog: [], notes: [], noteCategories: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 400, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "travel" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".empty-state, .trip-list", { timeout: 8000 });
  const state = () => page.evaluate(() => window.LifeLogTravel.tripsForExport());

  check("the Travel tab is in the bar", await page.isVisible('.tab[data-view="travel"]'));
  check("no year or category chips over it", await page.evaluate(() => document.querySelector("#filterbar").hidden));
  check("an empty state offers a trip", (await page.textContent("#viewBody")).includes("No trips yet"));

  await page.click("#viewBody .btn-primary");
  await page.fill("#tripName", "Rome");
  await page.fill("#tripStart", "2027-04-10");
  await page.fill("#tripEnd", "2027-04-12");
  await page.evaluate(() => document.querySelector("#tripForm").requestSubmit());
  await page.waitForSelector(".trip-head");
  check("saving opens the trip", (await page.textContent(".trip-name")) === "Rome");
  const heads = await page.$$eval(".trip-day h3 .mc-left", (n) => n.map((x) => x.textContent));
  check("every day of the trip, then No day yet", JSON.stringify(heads) === JSON.stringify(["Day 1 · Sat 10 Apr", "Day 2 · Sun 11 Apr", "Day 3 · Mon 12 Apr", "No day yet"]), heads);

  // Day 2's +: an open place first, then a timed one, which goes above it.
  const addOnDay = async (i, name, time, end) => {
    await page.click(`.trip-day:nth-child(${i}) .month-add-btn`);
    check(`${name}: the sheet opens on that day`, (await page.inputValue("#placeDay")) === "2027-04-11");
    await page.fill("#placeName", name);
    if (time) { await page.fill("#placeTime", time); await page.fill("#placeEndTime", end); }
    await page.evaluate(() => document.querySelector("#placeForm").requestSubmit());
    await page.waitForTimeout(200);
  };
  await addOnDay(2, "Trastevere walk");
  await addOnDay(2, "Colosseum", "10:00", "11:30");
  const day2 = await page.$$eval(".trip-day:nth-child(2) .place-row", (n) => n.map((x) => x.textContent));
  check("a timed place comes before an open one", day2.length === 2 && day2[0].startsWith("10:00–11:30Colosseum") && day2[1].includes("Trastevere walk"), day2);

  // The + menu's Place, with no day: the time fields wait for one.
  await page.click("#addBtn");
  await page.click('[data-add="place"]');
  check("without a day the time is off", await page.isDisabled("#placeTime"));
  await page.fill("#placeName", "Gelato at Giolitti");
  await page.evaluate(() => document.querySelector("#placeForm").requestSubmit());
  await page.waitForTimeout(200);
  const loose = await page.$$eval(".trip-day:last-child .place-name", (n) => n.map((x) => x.textContent));
  check("a place with no day sits under No day yet", JSON.stringify(loose) === JSON.stringify(["Gelato at Giolitti"]), loose);

  await page.locator(".trip-day:nth-child(2) .place-tick").first().click();
  check("ticking marks it visited", await page.isVisible(".trip-day:nth-child(2) .place-row.is-visited"));
  let d = await state();
  check("the data has the trip and three places", d.trips.length === 1 && d.places.length === 3, d);
  check("the visited one is stored as visited", d.places.find((p) => p.name === "Colosseum").visited === true);

  await page.waitForTimeout(1200); // the save waits a moment after the last change
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".trip-head", { timeout: 8000 });
  check("a reload comes back to the open trip", (await page.textContent(".trip-name")) === "Rome");
  check("with its places", (await page.$$(".place-row")).length === 3);

  await page.click(".trip-day:last-child .place-row");
  await page.click("#deletePlaceBtn");
  check("deleting removes it", (await page.$$(".place-row")).length === 2);
  await page.click(".toast-action");
  check("Undo puts it back", (await page.$$(".place-row")).length === 3);

  await page.click(".trip-back");
  const card = await page.textContent(".trip-card");
  check("the trip list's card", card.includes("Rome") && card.includes("10–12 Apr 2027") && card.includes("3 places") && card.includes("1 day planned"), card);

  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/travel-list-phone.png" });
  await page.click(".trip-card");
  await page.waitForSelector(".trip-head");
  if (process.env.SHOTS) {
    await page.screenshot({ path: process.env.SHOTS + "/travel-trip-phone.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: process.env.SHOTS + "/travel-trip-desktop.png", fullPage: true });
  }

  check("no page errors", !errs.length, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
