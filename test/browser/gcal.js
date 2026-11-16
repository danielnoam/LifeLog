// Google Calendar on the Timeline's calendar (0.320.0): Google answered by
// stubs, a browser token seeded as if just signed in.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const now = new Date();
const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }],
  entries: [{ id: "a", title: "Some Game", category: "Games", year: now.getFullYear(), month: now.getMonth() + 1, day: 2, createdAt: ym + "-02T00:00:00.000Z" }],
  backlog: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [], settings: {},
};
const EVENTS = [
  { id: "e1", summary: "Cinema", start: { dateTime: ym + "-14T19:30:00" }, end: { dateTime: ym + "-14T22:00:00" }, location: "Yes Planet", description: "Dune <b>Part Three</b>", htmlLink: "https://www.google.com/calendar/event?eid=e1" },
  { id: "e2", summary: "Trip", start: { date: ym + "-20" }, end: { date: ym + "-22" } },
  { id: "e3", summary: "Gone", status: "cancelled", start: { date: ym + "-15" }, end: { date: ym + "-16" } },
];

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const asked = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route("https://www.googleapis.com/calendar/v3/**", (r) => {
    const url = r.request().url();
    asked.push(url);
    if (r.request().headers().authorization !== "Bearer test-token") return r.fulfill({ status: 401, body: "{}" });
    if (url.includes("/calendarList")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [
      { id: "me@example.com", summary: "me@example.com", primary: true, backgroundColor: "#4285f4" },
      { id: "club", summary: "Climbing club", backgroundColor: "#0b8043", selected: false },
    ] }) });
    if (url.includes("/calendars/me%40example.com/events")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ items: EVENTS }) });
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ timelineLayout: "calendar", outTodaySheet: "hide" }));
    localStorage.setItem("lifelog-gcal-v1", JSON.stringify({ email: "me@example.com", calendars: [{ id: "me@example.com", name: "me@example.com", color: "#4285f4", on: true }] }));
    localStorage.setItem("lifelog-gcal-token-v1", JSON.stringify({ token: "test-token", exp: Date.now() + 3e6 }));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  check("the month is fetched from Google on its own", asked.some((u) => u.includes("/events?") && u.includes("singleEvents=true")), asked);
  check("a timed event sits on its day with its time", (await page.textContent('.cal-day[data-day="14"] .cal-name.is-event')) === "19:30Cinema");
  check("an all-day event spans its days, the end date taken back one",
    !!(await page.$('.cal-day[data-day="20"] .cal-name.is-allday')) && !!(await page.$('.cal-day[data-day="21"] .cal-name.is-allday')) && !(await page.$('.cal-day[data-day="22"] .cal-name.is-event')));
  check("a cancelled one isn't shown", !(await page.$('.cal-day[data-day="15"] .cal-name.is-event')));
  check("the cell says it to a screen reader", (await page.getAttribute('.cal-day[data-day="14"]', "aria-label")).includes("1 event"));

  await page.click('.cal-day[data-day="14"]'); await page.waitForTimeout(300);
  check("the picked day lists its events", (await page.textContent(".cal-gcal .cal-ev-row")).includes("Cinema"));
  await page.click(".cal-gcal .cal-ev-row"); await page.waitForTimeout(300);
  check("an event opens its sheet, read only", !(await page.isHidden("#gcalEventModal")) && (await page.textContent("#gcalEventTitle")) === "Cinema");
  check("with its place and its description as plain text", (await page.textContent("#gcalEventPlace")) === "Yes Planet" && (await page.textContent("#gcalEventText")) === "Dune Part Three");
  await page.click("#gcalToTask"); await page.waitForTimeout(400);
  check("Add as a task opens a new task list filled in", !(await page.isHidden("#noteModal")) && (await page.inputValue("#nTitle")) === "Cinema");
  const notes = await page.evaluate(() => window.LifeLogStorage.cachedCopy().notes.length);
  check("and nothing is saved until it is", notes === 0, notes);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  await page.click(".cal-gcal .cal-ev-row"); await page.waitForTimeout(300);
  await page.click("#gcalToEntry"); await page.waitForTimeout(400);
  check("Add to Timeline opens an entry on that day", !(await page.isHidden("#entryModal")) && (await page.inputValue("#fTitle")) === "Cinema");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  await page.evaluate(() => LifeLogSettings.openSettings("conn-gcal")); await page.waitForTimeout(400);
  check("its Connections screen says who and read only", (await page.textContent("#gcalInfo")).startsWith("me@example.com · read only"), await page.textContent("#gcalInfo"));
  check("and lists the calendars to show", (await page.$$("#gcalCals .switch")).length === 1);
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  await page.setViewportSize({ width: 400, height: 900 }); await page.waitForTimeout(400);
  check("on a phone an event is a bar along the cell's foot", (await page.$$('.cal-day[data-day="14"] .cal-evbar')).length === 1
    && (await page.evaluate(() => getComputedStyle(document.querySelector('.cal-day[data-day="14"] .cal-evbars')).display)) === "flex");

  await page.evaluate(() => LifeLogGcal.disconnect()); await page.waitForTimeout(300);
  check("Disconnect takes the events off and forgets the token", !(await page.$(".cal-name.is-event, .cal-evbar")) && (await page.evaluate(() => localStorage.getItem("lifelog-gcal-token-v1"))) === null);

  check("no console errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
