// Share into LifeLog (0.250.0): ?title=&text=&url= from the Share sheet,
// routed by the link — a Maps link to Travel, a title site to Backlog with
// the lookup running, plain text to the Backlog-or-Note sheet. At phone and
// desktop widths.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const T = (d) => `2026-0${d}-01T09:00:00.000Z`;
const SEED = {
  categories: [{ name: "Games", color: "#58a6ff", kind: "game" }], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [], notes: [{ id: "plain", text: "A plain note", createdAt: T(4), updatedAt: T(4) }],
};

async function run(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  // No real lookups: the media services answer nothing.
  await page.route(/api\.rawg\.io|themoviedb|openlibrary|anilist|jikan|googleapis|steampowered|musicbrainz|steamgriddb/, (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ disabledViews: [] }));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const at = " (" + width + "px)";

  const share = async (q) => {
    await page.goto(BASE + "/?" + q, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
  };

  // ---- a title from Letterboxd ----
  await share("url=" + encodeURIComponent("https://letterboxd.com/film/heat-1995/"));
  check("a Letterboxd link opens the Backlog sheet with the title" + at, await page.evaluate(() =>
    !document.querySelector("#backlogModal").hidden && document.querySelector("#bTitle").value === "Heat"));
  check("and keeps the link in the notes" + at, await page.evaluate(() => /letterboxd\.com/.test(document.querySelector("#bNotes").value)));
  check("the address is cleaned of the share" + at, await page.evaluate(() => location.search === ""));

  // ---- Steam, as the Steam app shares it: text only, the title in the slug ----
  await share("text=" + encodeURIComponent("https://store.steampowered.com/app/1245620/ELDEN_RING/"));
  check("a Steam link reads the title off the address" + at, await page.evaluate(() =>
    !document.querySelector("#backlogModal").hidden && document.querySelector("#bTitle").value === "ELDEN RING"));

  // ---- a Google Maps place, before any trip exists ----
  await page.route(/gmaps-link|gmaps-list/, (r) => r.fulfill({ status: 404, body: "" }));
  await share("text=" + encodeURIComponent("Check this out\nhttps://maps.app.goo.gl/abc123"));
  check("a Maps link with no trip yet asks for the trip first" + at, await page.evaluate(() =>
    !document.querySelector("#tripModal").hidden && document.querySelector("#importPlacesModal").hidden && document.querySelector("#backlogModal").hidden));
  await page.fill("#tripName", "Lisbon");
  await page.evaluate(() => document.querySelector("#tripForm").requestSubmit());
  await page.waitForTimeout(500);
  check("and once the trip is saved the import opens with the link" + at, await page.evaluate(() =>
    !document.querySelector("#importPlacesModal").hidden && document.querySelector("#importLink").value === "https://maps.app.goo.gl/abc123"
    && document.querySelector("#importTripName").textContent === "Lisbon"));
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.LifeLogTravel.flush());

  // ---- the same link, with the trip in place but Travel not yet opened this session ----
  await share("url=" + encodeURIComponent("https://maps.app.goo.gl/abc123"));
  check("a Maps link goes straight into the open trip" + at, await page.evaluate(() =>
    !document.querySelector("#importPlacesModal").hidden && document.querySelector("#importLink").value === "https://maps.app.goo.gl/abc123"));
  await page.keyboard.press("Escape");

  // ---- plain text: the chooser ----
  await share("text=" + encodeURIComponent("Call the dentist"));
  check("plain text asks Backlog or Note" + at, await page.evaluate(() =>
    !document.querySelector("#shareModal").hidden && /Call the dentist/.test(document.querySelector("#sharePreview").textContent)));
  const btn = await page.$("#shareToNote");
  const box = await btn.boundingBox();
  check("the choices are thumb-sized" + at, width > 600 || box.height >= 44, box);
  await btn.click(); await page.waitForTimeout(300);
  check("Note opens with the text" + at, await page.evaluate(() =>
    document.querySelector("#shareModal").hidden && !document.querySelector("#noteModal").hidden && document.querySelector("#nText").value === "Call the dentist"));
  await page.keyboard.press("Escape");

  // ---- an article: title + link, chooser, then Backlog ----
  await share("title=" + encodeURIComponent("Some article") + "&url=" + encodeURIComponent("https://example.com/post"));
  await page.click("#shareToBacklog"); await page.waitForTimeout(300);
  check("Backlog from the chooser carries title and link" + at, await page.evaluate(() =>
    !document.querySelector("#backlogModal").hidden && document.querySelector("#bTitle").value === "Some article" && document.querySelector("#bNotes").value === "https://example.com/post"));
  await page.keyboard.press("Escape");

  // ---- Escape closes the chooser ----
  await share("text=hello");
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  check("Escape closes the chooser" + at, await page.evaluate(() => document.querySelector("#shareModal").hidden));

  // ---- with Travel off, a Maps link is just a link ----
  await page.evaluate(() => localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ disabledViews: ["travel"] })));
  await share("url=" + encodeURIComponent("https://maps.app.goo.gl/abc123"));
  check("with Travel off a Maps link goes to the chooser" + at, await page.evaluate(() =>
    !document.querySelector("#shareModal").hidden && document.querySelector("#importPlacesModal").hidden));

  check("no errors" + at, errs.length === 0, errs);
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  await run(b, 1280);
  await run(b, 390);
  await b.close();
  done();
})();
