// Steam played-games backfill (0.253.0): with a key set, the Imports button
// reads GetOwnedGames through the proxy and opens the import review with
// every played game as a Timeline entry, the long ones ticked. Confirming
// writes entries with the Steam link, the hours and the month last played.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const AT = (y, m, d) => Date.UTC(y, m - 1, d, 12) / 1000;
const OWNED = { response: { game_count: 5, games: [
  { appid: 620, name: "Portal 2", playtime_forever: 547, rtime_last_played: AT(2024, 5, 17) },
  { appid: 1245620, name: "ELDEN RING", playtime_forever: 6031, rtime_last_played: AT(2026, 3, 2) },
  { appid: 413150, name: "Stardew Valley", playtime_forever: 95, rtime_last_played: AT(2025, 11, 9) },
  { appid: 70, name: "Half-Life", playtime_forever: 0, rtime_last_played: AT(2020, 1, 1) },
  { appid: 400, name: "Portal", playtime_forever: 300, rtime_last_played: AT(2023, 6, 6) },
  { appid: 999, name: "Some Demo", playtime_forever: 12, rtime_last_played: AT(2026, 1, 1) },
] } };

const SEED = {
  categories: [{ name: "Games", color: "#58a6ff" }, { name: "Films", color: "#f0883e" }],
  entries: [{ id: "e1", title: "Portal", category: "Games", year: 2023, month: 6, date: "2023-06-06", mediaSource: "steam", mediaId: "400" }],
  accomplishments: {}, backlog: [], habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [], notes: [],
  settings: { steam: { proxyUrl: "https://proxy.test", steamId: "76561198000000001", apiKey: "ABCDEF0123456789ABCDEF0123456789", wishlistCategory: "Games", autoSyncDays: "0" } },
};

(async () => {
  const b = await chromium.launch();
  const errs = [], hits = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.route("https://proxy.test/**", (r) => { hits.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OWNED) }); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)); }, SEED);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(300);

  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  await page.click('.srow[data-page="imports"]'); await page.waitForTimeout(300);
  check("the Imports page offers the played-games backfill", await page.isVisible("#steamOwnedSyncBtn"));
  check("the API key field shows the saved key without revealing it", (await page.inputValue("#steamApiKey")) === SEED.settings.steam.apiKey && (await page.getAttribute("#steamApiKey", "type")) === "password");
  await page.click("#steamOwnedSyncBtn");
  await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 8000 });
  check("the owned-games route is called with the id and the key", hits.length === 1 && /\/steam-owned\/76561198000000001\?key=ABCDEF/.test(hits[0]), hits);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#financePickerList label")].map((r) => ({ text: r.textContent.replace(/\s+/g, " ").trim(), on: r.querySelector("input[type=checkbox]")?.checked })));
  const row = (re) => rows.find((r) => re.test(r.text));
  check("every game with time in it is listed", row(/Portal 2/) && row(/ELDEN RING/) && row(/Stardew/), rows);
  check("a game never played is left out", !row(/Half-Life/), rows);
  check("a game already in the Timeline is left out", !rows.some((r) => /^Portal\b/.test(r.text) && !/Portal 2/.test(r.text)), rows);
  check("two hours or more starts ticked", row(/Portal 2/).on === true && row(/ELDEN RING/).on === true, rows);
  check("under two hours starts unticked", row(/Stardew/).on === false, rows);
  check("the hint says what the list is", /month you last played/.test(await page.textContent("#financePickerHint")));
  // The "Played at least N hrs" line (0.255.0): a twelve-minute demo is
  // under the default hour and never shows; raising it hides more.
  const thr = await page.evaluate(() => ({ shown: !document.querySelector("#financePickerThresholdRow").hidden, value: document.querySelector("#financePickerThreshold").value, label: document.querySelector("#financePickerThresholdLabel").textContent, hidden: document.querySelector("#financePickerThresholdHidden").textContent, sort: document.querySelector("#financePickerSort").value }));
  check("the review offers a minimum play time, an hour to start", thr.shown && thr.value === "1" && /Played at least/.test(thr.label), thr);
  check("the twelve-minute demo is under it and hidden", !row(/Some Demo/) && /1 hidden/.test(thr.hidden), thr);
  check("the list is sorted most played first", thr.sort === "measure" && /ELDEN RING/.test(rows[0].text), thr);
  await page.fill("#financePickerThreshold", "2"); await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ titles: [...document.querySelectorAll("#financePickerList .etitle")].map((t) => t.textContent), hidden: document.querySelector("#financePickerThresholdHidden").textContent }));
  check("raising it to two hours hides Stardew as well", !after.titles.some((t) => /Stardew/.test(t)) && /2 hidden/.test(after.hidden), after);
  await page.fill("#financePickerThreshold", "1"); await page.waitForTimeout(200);
  check("lowering it brings Stardew back, unticked", await page.evaluate(() => { const l = [...document.querySelectorAll("#financePickerList label")].find((r) => /Stardew/.test(r.textContent)); return l && !l.querySelector("input").checked; }));

  await page.click("#financePickerConfirmBtn"); await page.waitForTimeout(600);
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));
  const portal2 = data.entries.find((e) => e.title === "Portal 2");
  check("Portal 2 is an entry in May 2024 with its hours and Steam link", portal2 && portal2.year === 2024 && portal2.month === 5 && portal2.length === "9.1 hrs" && portal2.mediaSource === "steam" && portal2.mediaId === "620" && portal2.category === "Games", portal2);
  const elden = data.entries.find((e) => e.title === "ELDEN RING");
  check("long play times are whole hours", elden && elden.length === "101 hrs" && /1245620/.test(elden.coverUrl || ""), elden);
  check("the unticked game was not added", !data.entries.some((e) => e.title === "Stardew Valley"));
  check("Portal is still one entry", data.entries.filter((e) => e.title === "Portal").length === 1);
  check("the key never reaches the Timeline", !JSON.stringify(data.entries).includes("ABCDEF0123456789"));

  // A second run offers only what was left unticked.
  await page.click("#steamOwnedSyncBtn");
  await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 8000 });
  const again = await page.evaluate(() => [...document.querySelectorAll("#financePickerList label")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
  check("running it again offers only the game left unticked", again.length === 1 && /Stardew/.test(again[0]), again);
  check("no errors", errs.length === 0, errs);
  await ctx.close();
  await b.close();
  done();
})();
