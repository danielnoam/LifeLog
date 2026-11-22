// Google Calendar's events in Home's Coming up (2026-11-21), with the
// panel's menu switch to hide them; in English and Hebrew, wide and phone.
// Google answered by stubs, a browser token seeded as if just signed in.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const SEED = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [], settings: {},
};
const EVENTS = [
  { id: "e1", summary: "Dentist", start: { dateTime: day(1) + "T09:30:00" }, end: { dateTime: day(1) + "T10:00:00" } },
  { id: "e2", summary: "Trip", start: { date: day(-1) }, end: { date: day(3) } },
  { id: "e3", summary: "Far off", start: { date: day(40) }, end: { date: day(41) } },
];
const shots = process.env.HOMEGCAL_SHOTS || "";

async function run(browser, lang, width) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", deviceScaleFactor: shots ? 2 : 1 });
  await ctx.route("https://www.googleapis.com/calendar/v3/**", (r) => {
    const url = r.request().url();
    if (url.includes("/calendarList")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ id: "me@example.com", summary: "me@example.com", primary: true, backgroundColor: "#0b8043" }] }) });
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ items: url.includes("/calendars/me%40example.com/events") ? EVENTS : [] }) });
  });
  await ctx.addInitScript((l) => localStorage.setItem("lifelog.lang", l), lang);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "home" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
    localStorage.setItem("lifelog-gcal-v1", JSON.stringify({ email: "me@example.com", calendars: [{ id: "me@example.com", name: "me@example.com", color: "#0b8043", on: true }] }));
    localStorage.setItem("lifelog-gcal-token-v1", JSON.stringify({ token: "test-token", exp: Date.now() + 3e6 }));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".home-up-ev", { timeout: 5000 }).catch(() => {});
  const at = `${lang} ${width}px`;
  const titles = () => page.$$eval('.home-sec[data-sec="upcoming"] .home-row-title', (n) => n.map((x) => x.textContent));
  check(`${at}: Coming up lists the events, one under way today, none past two weeks`,
    JSON.stringify(await titles()) === JSON.stringify(["Trip", "Dentist"]), await titles());
  check(`${at}: a timed event shows its day and time`, /09:30$/.test(await page.textContent('.home-up-ev:has-text("Dentist") .home-row-end')));
  check(`${at}: the row says just "Google Calendar", no email or calendar name`,
    (await page.$$eval(".home-up-ev .home-row-sub", (n) => n.map((x) => x.textContent))).every((t) => t === "Google Calendar"));
  check(`${at}: in its calendar's colour`, (await page.$eval(".home-up-ev", (e) => getComputedStyle(e.querySelector(".home-row-ico")).color)) === "rgb(11, 128, 67)");
  if (shots) await page.locator('.home-sec[data-sec="upcoming"]').screenshot({ path: `${shots}/upcoming-${lang}-${width}.png` });

  const ctxItems = () => page.$$eval(".ctx-menu:not([hidden]) > *", (n) => n.map((x) => x.textContent.trim()));
  const openMenu = async () => {
    const p = await page.evaluate(() => { const h = document.querySelector('.home-sec[data-sec="upcoming"] .home-sec-head'); h.scrollIntoView({ block: "center", behavior: "instant" }); const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(p.x, p.y, { button: "right" }); await page.waitForTimeout(250);
  };
  const hide = lang === "he" ? "הסתרת Google Calendar" : "Hide Google Calendar";
  const show = lang === "he" ? "הצגת Google Calendar" : "Show Google Calendar";
  await openMenu();
  check(`${at}: the panel's menu offers to hide them`, (await ctxItems()).includes(hide), await ctxItems());
  if (shots) await page.screenshot({ path: `${shots}/menu-${lang}-${width}.png` });
  await page.click(`.ctx-menu button:has-text("${hide}")`); await page.waitForTimeout(300);
  check(`${at}: Hide takes them off Coming up`, (await page.$$(".home-up-ev")).length === 0);
  check(`${at}: and is kept on this device`, (await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-visual-settings-v1")).homeUpcomingEvents)) === false);
  await openMenu();
  check(`${at}: then offers Show`, (await ctxItems()).includes(show), await ctxItems());
  await page.click(`.ctx-menu button:has-text("${show}")`); await page.waitForTimeout(300);
  check(`${at}: Show brings them back`, (await page.$$(".home-up-ev")).length === 2);

  await page.click('.home-up-ev:has-text("Dentist")'); await page.waitForTimeout(300);
  check(`${at}: tapping one opens its event sheet`, /Dentist/.test(await page.textContent(".modal-overlay:not([hidden]), .modal-overlay.open").catch(() => "")));
  check(`${at}: and the sheet doesn't show the email either`, !/@/.test(await page.textContent("#gcalEventFrom")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);

  await page.evaluate(() => LifeLogGcal.disconnect()); await page.waitForTimeout(300);
  check(`${at}: disconnected, no events and no switch`, (await page.$$(".home-up-ev")).length === 0);
  await openMenu();
  check(`${at}: (the menu without it)`, !(await ctxItems()).some((t) => /Google Calendar/.test(t)), await ctxItems());
  await page.keyboard.press("Escape");
  await ctx.close();
  return errs;
}

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  for (const lang of ["en", "he"]) for (const width of [1280, 400]) errs.push(...await run(browser, lang, width));
  await browser.close();
  done(errs);
})();
