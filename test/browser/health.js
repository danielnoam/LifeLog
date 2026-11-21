// Health Connect ticks habits (Android only). In a faked Android build the
// Health plugin answers with a week of steps, workouts and a night's sleep:
// the linked habits tick themselves (a hand tick of the same session counts
// once), the card's chip shows today's steps, Connections → Health Connect
// lists what it may read and the linked habits, and the link sheet changes
// and unlinks one. In the web app the same sheet links a habit and the chip
// shows the bar, with nothing read.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const T = "2026-01-01T00:00:00.000Z";
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const at = (n, hh) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hh, 0, 0, 0); return d.getTime(); };
const DATA = () => ({
  categories: [], entries: [], backlog: [], notes: [],
  habits: [
    { id: "walk", name: "Walk", color: "#5b8cff", cadence: "daily", target: 1, order: 0, startedAt: day(20), createdAt: T, health: { from: "steps", min: 8000 } },
    { id: "gym", name: "Gym", color: "#f66151", cadence: "daily", period: "week", target: 3, order: 1, startedAt: day(20), createdAt: T, marks: { [day(1)]: 1 }, health: { from: "workout", kind: "strength" } },
    { id: "read", name: "Read", color: "#3fb27f", cadence: "daily", target: 1, order: 2, startedAt: day(20), createdAt: T },
  ],
  settings: {},
});
const FAKE = ({ reads }) => {
  window.__hc = { reads: [], asked: [], opened: 0 };
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      App: { addListener: () => Promise.resolve({ remove() {} }) },
      Health: {
        status: async () => ({ sdk: "available", granted: ["android.permission.health.READ_STEPS", "android.permission.health.READ_EXERCISE", "android.permission.health.READ_SLEEP"] }),
        request: async (o) => { window.__hc.asked.push(o); return { granted: ["android.permission.health.READ_STEPS", "android.permission.health.READ_EXERCISE", "android.permission.health.READ_SLEEP"] }; },
        openSettings: async () => { window.__hc.opened++; },
        read: async (o) => { window.__hc.reads.push(o); return reads; },
      },
    },
  };
  try { localStorage.setItem("lifelog-health-v1", JSON.stringify({ on: true })); } catch (e) {}
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const reads = {
    steps: [{ date: day(0), count: 5230 }, { date: day(2), count: 9100 }],
    workouts: [{ start: at(1, 18), end: at(1, 19), type: 70 }, { start: at(3, 7), end: at(3, 8), type: 81 }, { start: at(3, 18), end: at(3, 19), type: 56 }],
    sleep: [],
  };

  // ---- Android ----
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.route(/^https:\/\//, (r) => r.abort());
  await page.goto(BASE + "/", { waitUntil: "load" });
  await forgetCopy(page);
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify(d)); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "habits" })); }, DATA());
  await page.addInitScript(FAKE, { reads });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => { const f = (window.LifeLogStorage.cachedCopy().settings || {}).healthConnect; return f && f.filled && f.filled.walk; }, null, { timeout: 10000 });
  const data = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());

  let d = await data();
  const asked = await page.evaluate(() => window.__hc.reads[0]);
  check("it read 30 days on the first go, and only what the links need", asked && asked.from === day(29) && asked.to === day(0) && asked.steps && asked.workouts && !asked.sleep, asked);
  const walk = d.habits.find((h) => h.id === "walk"), gym = d.habits.find((h) => h.id === "gym");
  check("steps over the bar tick the day; under it, not", walk.marks && walk.marks[day(2)] === 1 && !walk.marks[day(0)], walk.marks);
  check("strength sessions count each; a run doesn't; the hand tick of the same session counts once", gym.marks[day(1)] === 1 && gym.marks[day(3)] === 1, gym.marks);
  check("Health Connect's part is kept apart", JSON.stringify(d.settings.healthConnect.filled.walk) === JSON.stringify({ [day(2)]: [1, 1] }), d.settings.healthConnect);
  const chip = await page.evaluate(() => { const c = [...document.querySelectorAll(".habit-card")].find((x) => x.dataset.id === "walk"); const h = c && c.querySelector(".habit-health"); const head = c && c.querySelector(".habit-head"); return h ? { text: h.textContent.trim(), beforeFlame: [...head.children].indexOf(h) < [...head.children].findIndex((x) => x.classList.contains("habit-streak")) || !head.querySelector(".habit-streak") } : null; });
  check("the Walk card shows today's steps against the bar, before the flame", chip && chip.text === "5,230 / 8,000" && chip.beforeFlame, chip);
  check("a habit with no link has no chip", await page.evaluate(() => !document.querySelector('.habit-card[data-id="read"] .habit-health')));

  await page.evaluate(() => window.LifeLogSettings.openSettings("conn-health")); await page.waitForTimeout(500);
  const pg = await page.evaluate(() => ({
    on: document.querySelector("#healthOn").checked,
    perms: [...document.querySelectorAll("#healthPerms .health-perm")].map((x) => x.classList.contains("is-ok")),
    linked: [...document.querySelectorAll("#healthLinked .srow-title")].map((x) => x.textContent),
    web: !document.querySelector("#healthWebHint").hidden,
  }));
  check("the page shows it on, three of four allowed, and the two linked habits", pg.on && pg.perms.join() === "true,true,true,false" && pg.linked.join() === "Walk,Gym" && !pg.web, pg);
  await page.evaluate(() => document.querySelectorAll("#healthLinked .srow")[0].click()); await page.waitForTimeout(200);
  const sheet = await page.evaluate(() => ({ open: !document.querySelector("#healthLinkModal").hidden, title: document.querySelector("#healthLinkTitle").textContent, steps: document.querySelector("#healthLinkSteps").value, kindHidden: document.querySelector("#healthLinkKindLabel").hidden }));
  check("tapping one opens its link sheet, filled in", sheet.open && sheet.title === "Walk" && sheet.steps === "8000" && sheet.kindHidden, sheet);
  await page.fill("#healthLinkSteps", "5000");
  await page.click("#healthLinkForm button[type=submit]"); await page.waitForTimeout(800);
  d = await data();
  const w2 = d.habits.find((h) => h.id === "walk");
  check("a lower bar re-reads and ticks today too", w2.health.min === 5000 && w2.marks[day(0)] === 1 && w2.marks[day(2)] === 1, w2);
  await page.evaluate(() => document.querySelectorAll("#healthLinked .srow")[1].click()); await page.waitForTimeout(200);
  await page.click("#healthUnlinkBtn"); await page.waitForTimeout(600);
  d = await data();
  const g2 = d.habits.find((h) => h.id === "gym");
  check("unlinking takes out only the phone's part; the hand tick stays", !g2.health && g2.marks[day(1)] === 1 && !g2.marks[day(3)] && !d.settings.healthConnect.filled.gym, { marks: g2.marks, filled: d.settings.healthConnect.filled });
  await page.evaluate(() => document.querySelector("#healthBackground").click()); await page.waitForTimeout(400);
  check("Read in the background asks for that permission too", await page.evaluate(() => window.__hc.asked.some((o) => o.background === true)));
  await ctx.close();

  // ---- the web app ----
  const wctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const web = await wctx.newPage();
  web.on("pageerror", (e) => errs.push("web pageerror: " + e.message));
  await web.route(/^https:\/\//, (r) => r.abort());
  await web.goto(BASE + "/", { waitUntil: "load" });
  await forgetCopy(web);
  await web.evaluate((d) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify(d)); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "habits" })); }, DATA());
  await web.reload({ waitUntil: "load" });
  await web.waitForSelector('.habit-card[data-id="walk"] .habit-health', { timeout: 10000 });
  const wchip = await web.evaluate(() => { const h = document.querySelector('.habit-card[data-id="walk"] .habit-health'); return h && h.textContent.trim(); });
  check("on the web the chip shows the bar, with nothing read", wchip === "8,000 steps", wchip);
  await web.evaluate(() => window.LifeLogSettings.openSettings("imports")); await web.waitForTimeout(300);
  const row = await web.evaluate(() => document.querySelector('[data-conn-status="health"]').textContent);
  check("its Connections row says it's on the phone", /2 habits linked · on your phone/.test(row), row);
  await web.evaluate(() => window.LifeLogSettings.openSettings("conn-health")); await web.waitForTimeout(300);
  check("the web page explains and hides the phone's controls", await web.evaluate(() => !document.querySelector("#healthWebHint").hidden && document.querySelector("#healthGroup").hidden));
  await web.evaluate(() => [...document.querySelectorAll("#healthLinked .sitem-go")].pop().click()); await web.waitForTimeout(200);
  const opts = await web.evaluate(() => [...document.querySelectorAll("#healthLinkHabit option")].map((o) => o.textContent));
  check("Link a habit offers only habits without a link", opts.join() === "Read", opts);
  await web.selectOption("#healthLinkFrom", "sleep");
  await web.fill("#healthLinkHours", "7.5");
  await web.click("#healthLinkForm button[type=submit]"); await web.waitForTimeout(600);
  const r = (await web.evaluate(() => window.LifeLogStorage.cachedCopy())).habits.find((h) => h.id === "read");
  check("the web links a habit, to be read on the phone", r.health && r.health.from === "sleep" && r.health.hours === 7.5, r.health);
  await wctx.close();

  check("no page errors", !errs.length, errs);
  await b.close();
  done();
})();
