// Travel's 0.245.0 additions: areas named after their town (OpenStreetMap's
// Nominatim, faked here), the import's map whose pins pick places, Google's
// rating, hours and reviews on a place with a Places key (faked), and
// Settings → History bringing a trip back as it was.
const { chromium, BASE, tally } = require("./harness");
const { googleList, LIST_ID } = require("../fixtures/google-list.js");
const { check, done } = tally();

const PROXY = "https://fake-proxy.test";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const SEED = {
  categories: [], entries: [], backlog: [], notes: [], noteCategories: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [],
  settings: { steam: { proxyUrl: PROXY }, mediaKeys: { googlePlaces: "test-key" } },
};
const GOOGLE_PLACE = {
  id: "ChIJ-test-colosseo", displayName: { text: "Colosseum" },
  location: { latitude: 41.8903, longitude: 12.4924 },
  rating: 4.7, userRatingCount: 412345,
  currentOpeningHours: { openNow: true },
  regularOpeningHours: { weekdayDescriptions: ["Monday: 9:00 AM – 7:00 PM", "Tuesday: 9:00 AM – 7:00 PM"] },
  reviews: [{ rating: 5, text: { text: "Go early, book ahead." }, authorAttribution: { displayName: "A visitor" }, relativePublishTimeDescription: "a month ago" }],
  googleMapsUri: "https://maps.google.com/?cid=1",
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 400, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.route(PROXY + "/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/gmaps-link/ShareCode1") return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ url: `https://www.google.com/maps/@/data=!4m3!11m2!2s${LIST_ID}!3e3` }) });
    if (path === "/gmaps-list/" + LIST_ID) return route.fulfill({ headers: CORS, contentType: "application/json", body: googleList() });
    return route.fulfill({ headers: CORS, status: 404, body: "" });
  });
  const towns = [];
  await page.route("https://nominatim.openstreetmap.org/**", (route) => {
    const u = new URL(route.request().url());
    towns.push(u.searchParams.get("lat") + "," + u.searchParams.get("lon"));
    return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ name: "Roma", address: { city: "Roma", country: "Italia" } }) });
  });
  const google = [];
  await page.route("https://places.googleapis.com/**", (route) => {
    const r = route.request();
    if (r.method() === "OPTIONS") return route.fulfill({ headers: CORS, status: 204, body: "" });
    google.push({ method: r.method(), url: r.url(), key: r.headers()["x-goog-api-key"], body: r.postData() });
    return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify(r.method() === "POST" ? { places: [GOOGLE_PLACE] } : GOOGLE_PLACE) });
  });
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
  await page.evaluate(() => document.querySelector("#tripForm").requestSubmit());
  await page.waitForSelector(".trip-chip.on");

  // ---- the import: towns and the map ----
  await page.click(".trip-import");
  await page.fill("#importLink", "https://maps.app.goo.gl/ShareCode1");
  await page.click("#importGoBtn");
  await page.waitForSelector("#importPick:not([hidden]) .import-row", { timeout: 5000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".import-all .import-name")].some((n) => n.textContent === "Roma"), null, { timeout: 5000 })
    .catch(() => {});
  const groups = await page.$$eval(".import-all .import-name", (n) => n.map((x) => x.textContent));
  check("places with no address are grouped under their town", JSON.stringify(groups) === JSON.stringify(["Roma", "Milano"]), groups);
  check("OpenStreetMap is asked once, about the area's centre", towns.length === 1, towns);
  check("and its answer is kept on this device", await page.evaluate(() => /Roma/.test(localStorage.getItem("lifelog-towns-v1") || "")));

  await page.waitForSelector("#importMap:not([hidden]) .import-pin", { timeout: 8000 });
  check("the list's places show on a map", (await page.$$("#importMap .import-pin")).length === 5);
  // Rome's pins overlap at the whole list's zoom, so by keyboard: a pin is a
  // button either way.
  const tap = (name) => page.focus(`#importMap .import-pin[title="${name}"]`).then(() => page.keyboard.press("Enter"));
  await tap("Colosseo");
  check("tapping a pin picks its place", (await page.textContent("#importGoBtn")) === "Add 1 place"
    && await page.isChecked('.import-row:has-text("Colosseo") input'));
  check("and the pin shows it's picked", await page.isVisible('#importMap .import-pin.is-on[title="Colosseo"]'));
  await page.click('.import-row:has-text("Pantheon") input');
  check("ticking a row lights its pin", await page.isVisible('#importMap .import-pin.is-on[title="Pantheon"]'));
  await tap("Pantheon");
  check("and tapping it again un-picks it", !(await page.isChecked('.import-row:has-text("Pantheon") input')));
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/travel-importmap-phone.png" });
  await page.click("#importGoBtn");
  await page.waitForTimeout(200);
  let d = await state();
  const colosseo = d.places.find((p) => p.name === "Colosseo");
  check("the place added carries its town", colosseo && colosseo.town === "Roma", colosseo);
  check("closing the import takes its map with it", await page.isHidden("#importMap"));

  // ---- Google on the place ----
  await page.click(".place-row");
  await page.waitForSelector("#placeGoogle .place-google-rating", { timeout: 5000 });
  check("an opened place shows Google's rating", (await page.textContent("#placeGoogle .place-google-rating")).startsWith("★ 4.7 · 412"));
  check("whether it's open now", (await page.textContent("#placeGoogle .place-google-open")) === "Open now");
  check("its hours, folded", (await page.$$("#placeGoogle .place-google-hours li")).length === 2 && !(await page.getAttribute("#placeGoogle details", "open") !== null));
  check("its reviews", (await page.textContent("#placeGoogle .place-google-review-text")) === "Go early, book ahead.");
  check("and a link to Google's page", (await page.getAttribute("#placeGoogle .place-google-link", "href")) === GOOGLE_PLACE.googleMapsUri);
  check("found by name near where it is, with the key", google.length === 1 && google[0].method === "POST" && google[0].key === "test-key"
    && /"textQuery":"Colosseo"/.test(google[0].body) && /"latitude":41\.89/.test(google[0].body), google);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/travel-google-phone.png", fullPage: true });
  d = await state();
  check("only Google's id for it is saved", d.places.find((p) => p.name === "Colosseo").placeId === GOOGLE_PLACE.id
    && !JSON.stringify(d).includes("book ahead"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.click(".place-row");
  await page.waitForSelector("#placeGoogle .place-google-rating", { timeout: 5000 });
  check("opened again, it isn't asked about again", google.length === 1, google.length);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ---- History: a trip brought back ----
  await page.evaluate(() => window.LifeLogTravel.flush());
  await page.waitForTimeout(300);
  await page.click('.trip-chip:has-text("Italy") .chip-edit');
  await page.fill("#tripName", "Italia");
  await page.evaluate(() => document.querySelector("#tripForm").requestSubmit());
  await page.waitForTimeout(200);
  await page.evaluate(() => window.LifeLogTravel.flush());
  await page.waitForTimeout(300);
  await page.click("#settingsBtn");
  await page.click('.srow[data-page="history"]');
  await page.click("#travelHistoryBtn");
  await page.waitForSelector("#travelHistoryList:not([hidden]) .board-hist-row");
  const rows = await page.$$("#travelHistoryList .board-hist-row");
  check("trips' saves are listed, newest first", rows.length >= 2, rows.length);
  await page.click("#travelHistoryList .board-hist-row:nth-of-type(1) button");
  const newest = await page.textContent("#travelHistoryList .board-hist-boards:not([hidden])");
  check("the newest is the trip as it is", /Italia/.test(newest) && /Same as now/.test(newest), newest);
  const older = page.locator("#travelHistoryList .board-hist-row").nth(rows.length - 1);
  await older.locator("button").click();
  const olderBox = page.locator("#travelHistoryList .board-hist-boards:not([hidden])").last();
  await olderBox.waitFor();
  check("an older one shows it changed since", /Italy/.test(await olderBox.textContent()) && /Changed since/.test(await olderBox.textContent()), await olderBox.textContent());
  await olderBox.locator("button", { hasText: "Bring back" }).click();
  await page.waitForTimeout(100);
  d = await state();
  check("Bring back puts the trip back as it was", d.trips.length === 1 && d.trips[0].name === "Italy", d.trips);
  check("and says so", /Brought back/.test(await olderBox.textContent()));
  await page.click(".toast-action");
  await page.waitForTimeout(100);
  d = await state();
  check("Undo puts back what was there", d.trips[0].name === "Italia" && d.places.length === 1, { trips: d.trips, n: d.places.length });

  await b.close();
  done(errs);
})();
