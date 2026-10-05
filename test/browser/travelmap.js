// Travel's import, views and arranging (0.242.0): a Google Maps list
// brought in through the proxy routes (faked here) and picked by area, a
// second import that can't add the same place twice, a single shared place,
// By area, dragging a place onto a day, and the map with its day chips, pins
// and pin-to-row link, at phone and desktop width.
const { chromium, BASE } = require("./harness");
const { googleList, LIST_ID } = require("../fixtures/google-list.js");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

// Another origin, as the real worker is: the app's service worker would
// answer a same-origin one before the fake could.
const PROXY = "https://fake-proxy.test";
const CORS = { "Access-Control-Allow-Origin": "*" };
const SEED = {
  categories: [], entries: [], backlog: [], notes: [], noteCategories: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [],
  settings: { steam: { proxyUrl: PROXY } },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 400, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const asked = [];
  await page.route(PROXY + "/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    asked.push(path);
    if (path === "/gmaps-link/ShareCode1") {
      return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ url: `https://www.google.com/maps/@/data=!4m3!11m2!2s${LIST_ID}!3e3` }) });
    }
    if (path === "/gmaps-list/" + LIST_ID) return route.fulfill({ headers: CORS, contentType: "application/json", body: googleList() });
    return route.fulfill({ headers: CORS, status: 404, body: "Not found" });
  });
  // No tiles from here: the map's pins and layout are what's checked.
  await page.route(/basemaps\.cartocdn\.com/, (route) => route.fulfill({ status: 204, body: "" }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "travel" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".empty-state, .trip-list", { timeout: 8000 });
  const state = () => page.evaluate(() => window.LifeLogTravel.tripsForExport());

  await page.click("#viewBody .btn-primary");
  await page.fill("#tripName", "Italy");
  await page.fill("#tripStart", "2027-04-10");
  await page.fill("#tripEnd", "2027-04-11");
  await page.evaluate(() => document.querySelector("#tripForm").requestSubmit());
  await page.waitForSelector(".trip-head");

  // ---- import a list ----
  await page.click('.trip-head [aria-label="Import from Google Maps"]');
  check("the import sheet opens", await page.isVisible("#importPlacesModal"));
  await page.fill("#importLink", "https://maps.app.goo.gl/ShareCode1?g_st=ac");
  await page.click("#importGoBtn");
  await page.waitForSelector("#importPick:not([hidden]) .import-row", { timeout: 5000 });
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/travel-import-phone.png" });
  check("the short link is resolved, then the list fetched", JSON.stringify(asked) === JSON.stringify(["/gmaps-link/ShareCode1", "/gmaps-list/" + LIST_ID]), asked);
  const groups = await page.$$eval(".import-all .import-name", (n) => n.map((x) => x.textContent));
  check("its places come grouped by area", JSON.stringify(groups) === JSON.stringify(["Near Trevi", "Milano"]), groups);
  check("nothing is ticked to begin with", (await page.textContent("#importGoBtn")) === "Add places" && await page.isDisabled("#importGoBtn"));
  check("the hint says what the list is", (await page.textContent("#importHint")).startsWith("Italy: 5 places"));
  await page.locator(".import-all", { hasText: "Milano" }).click();
  check("a group's box ticks its places", (await page.textContent("#importGoBtn")) === "Add 2 places");
  await page.click("#importGoBtn");
  await page.waitForTimeout(200);
  let d = await state();
  check("two places, under No day yet", d.places.length === 2 && d.places.every((p) => !p.day), d.places);
  const duomo = d.places.find((p) => p.name === "Duomo di Milano");
  check("each keeps its Google id, list and location", duomo && duomo.gid === "0x1334f4aad1240001:0x2a" && duomo.source === LIST_ID && duomo.lat === 45.4642, duomo);
  check("its ↗ opens Google's page for it", (await page.getAttribute(`.place-row[data-id="${duomo.id}"] .place-go`, "href")) === "https://www.google.com/maps?ftid=0x1334f4aad1240001:0x2a");

  // ---- the same list again: what's in the trip can't be added twice ----
  await page.click('.trip-head [aria-label="Import from Google Maps"]');
  await page.fill("#importLink", "https://maps.app.goo.gl/ShareCode1");
  await page.click("#importGoBtn");
  await page.waitForSelector("#importPick:not([hidden]) .import-row");
  const already = await page.$$eval(".import-row input:disabled", (n) => n.length);
  check("what's already in the trip is ticked and fixed", already >= 2 && (await page.textContent("#importHint")).includes("2 already in this trip"), already);
  await page.locator(".import-row:not(.import-all)", { hasText: "Colosseo" }).click();
  await page.click("#importGoBtn");
  await page.waitForTimeout(200);
  d = await state();
  check("only the new one is added", d.places.length === 3, d.places.map((p) => p.name));

  // ---- a single place, by its long link ----
  await page.click("#addBtn");
  await page.click('[data-add="import-places"]');
  await page.fill("#importLink", "https://www.google.com/maps/place/Pantheon/@41.8986,12.4769,17z/data=!4m6!3m5!1s0x132f604f678640a9:0xcad165fa2036ce2c!8m2!3d41.8986!4d12.4769");
  await page.click("#importGoBtn");
  await page.waitForSelector("#importPick:not([hidden]) .import-row");
  check("a place link is one place, already ticked", (await page.textContent("#importGoBtn")) === "Add 1 place");
  await page.click("#importGoBtn");
  await page.waitForTimeout(200);
  check("and it's added", (await state()).places.length === 4);

  // ---- arranging: drag a place onto Day 1 ----
  await page.click(".trip-arrange");
  check("Arrange puts grips on the rows", (await page.$$(".place-row.is-arrange .place-grip")).length === 4);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/travel-arrange-phone.png" });
  const src = await page.locator(".trip-day[data-day=''] .place-row", { hasText: "Colosseo" }).boundingBox();
  const dst = await page.locator('.trip-day[data-day="2027-04-10"]').boundingBox();
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(src.x + src.width / 2, src.y + (dst.y + dst.height / 2 - src.y) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(200);
  d = await state();
  check("dropped on Day 1, it's on Day 1", d.places.find((p) => p.name === "Colosseo").day === "2027-04-10", d.places.map((p) => [p.name, p.day]));
  const loose = d.places.filter((p) => !p.day).map((p) => p.order);
  check("No day yet's places are numbered in order again", JSON.stringify(loose) === "[0,1,2]", loose);
  await page.click(".trip-arrange");
  check("Done puts the ticks back", (await page.$$(".place-row .place-tick")).length === 4);

  // ---- By area ----
  await page.click('.trip-bar .seg-btn:has-text("By area")');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/travel-area-phone.png" });
  const areaHeads = await page.$$eval(".trip-area h3 .mc-left", (n) => n.map((x) => x.textContent));
  check("By area groups the places by town", JSON.stringify(areaHeads.slice().sort()) === JSON.stringify(["Milano", "Near Pantheon"]), areaHeads);
  const tags = await page.$$eval(".trip-area .place-tag", (n) => n.map((x) => x.textContent).sort());
  check("each row says its day", JSON.stringify(tags) === JSON.stringify(["Day 1", "No day", "No day", "No day"]), tags);

  // ---- the map ----
  await page.click('.trip-bar .seg-btn:has-text("Map")');
  await page.waitForSelector(".trip-map.leaflet-container .trip-pin", { timeout: 8000 });
  check("every place with a location has a pin", (await page.$$(".trip-pin")).length === 4);
  const side = await page.locator(".trip-map-side").boundingBox();
  check("on a phone the map is the top half, full width", side.width > 360 && side.height > 380 && side.height < 480, side);
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(100);
  const stuck = await page.locator(".trip-map-side").boundingBox();
  const topbar = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 0);
  check("and stays there as the list scrolls under it", Math.abs(stuck.y - topbar) < 2, { stuck, topbar });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.trip-map-days .cat-chip:has-text("Day 1")');
  await page.waitForTimeout(100);
  const pinText = await page.$$eval(".trip-pin", (n) => n.map((x) => x.textContent));
  check("a day shows its own pins, numbered", JSON.stringify(pinText) === '["1"]', pinText);
  check("and only its card", (await page.$$(".trip-map-list .trip-day")).length === 1);
  await page.click('.trip-map-days .cat-chip:has-text("No day")');
  await page.waitForTimeout(100);
  check("No day yet's places draw a route", (await page.$$(".trip-route")).length === 1);
  await page.locator('.trip-pin[title="Pantheon"]').click();
  const picked = await page.$$eval(".trip-map-list .place-row.is-selected .place-name", (n) => n.map((x) => x.textContent));
  check("tapping a pin picks its row", picked.length === 1, picked);
  const rowName = await page.locator(".trip-map-list .place-row").first().locator(".place-name").textContent();
  await page.locator(".trip-map-list .place-row").first().click();
  check("tapping a row picks its pin, not its sheet", await page.isHidden("#placeModal") && (await page.$$(".trip-pin.is-selected")).length === 1);
  await page.locator(".trip-map-list .place-row").first().click();
  check("a second tap opens it", await page.isVisible("#placeModal") && (await page.inputValue("#placeName")) === rowName);
  await page.click("#cancelPlaceBtn");
  await page.waitForTimeout(400);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/travel-map-phone.png" });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  const wide = await page.locator(".trip-map-side").boundingBox();
  const list = await page.locator(".trip-map-list").boundingBox();
  check("on a desktop the map sits beside the list", wide.x > list.x + list.width - 1 && wide.height > 600, { wide, list });
  if (process.env.SHOTS) {
    for (const theme of ["", "light", "nord", "dracula"]) {
      await page.evaluate((t) => {
        for (const c of ["theme-light", "theme-nord", "theme-dracula"]) document.documentElement.classList.remove(c);
        if (t) document.documentElement.classList.add("theme-" + t);
      }, theme);
      await page.waitForTimeout(150);
      await page.screenshot({ path: process.env.SHOTS + `/travel-map-desktop${theme ? "-" + theme : ""}.png` });
    }
    await page.evaluate(() => { for (const c of ["theme-light", "theme-nord", "theme-dracula"]) document.documentElement.classList.remove(c); });
  }

  // ---- a proxy that can't be reached says so ----
  await page.route(PROXY + "/**", (route) => route.abort());
  await page.click('.trip-head [aria-label="Import from Google Maps"]');
  await page.fill("#importLink", "https://maps.app.goo.gl/Other");
  await page.click("#importGoBtn");
  await page.waitForSelector("#importHint.is-error");
  check("a failed fetch says what to do", (await page.textContent("#importHint")).includes("Couldn't reach Google Maps"));

  check("no page errors", !errs.length, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
