// Out this week (0.259.0): the Upcoming view's bar has a button for what
// came out in the last seven days, opening the Out today sheet with a day
// on each tile; and that sheet sizes its grid to how many there are.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const pad = (n) => String(n).padStart(2, "0");
const day = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return day(d); };
const mk = (id, title, extra) => ({ id, title, category: "Games", createdAt: "2026-01-01T00:00:00.000Z", releasePrecision: "day", ...extra });
const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  entries: [], accomplishments: {}, notes: [], habits: [], projects: [], financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {},
  backlog: [
    mk("t1", "Out Now", { releaseDate: ago(0), releaseStatus: "released" }),
    mk("r1", "Three Days Ago", { releaseDate: ago(3), releaseStatus: "released" }),
    mk("r2", "Six Days Ago", { releaseDate: ago(6), releaseStatus: "released" }),
    mk("o1", "Ten Days Ago", { releaseDate: ago(10), releaseStatus: "released" }),
    mk("d1", "Dropped One", { releaseDate: ago(2), releaseStatus: "released", dropped: true }),
    mk("s1", "Started One", { releaseDate: ago(1), startedAt: ago(1) }),
    mk("m1", "Sometime This Month", { releaseDate: ago(0).slice(0, 7), releasePrecision: "month" }),
    mk("f1", "Next Month", { releaseDate: ago(-20) }),
  ],
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const width of [375, 1280]) {
    const at = " @" + width;
    const p = await b.newPage({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
    p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await p.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    await p.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "upcoming" }));
      localStorage.setItem("lifelog-out-today-v1", JSON.stringify({ day: new Date().toISOString().slice(0, 10) }));
      localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ outTodaySheet: "hide" }));
    }, SEED);
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1200);
    const bar = await p.evaluate(() => { const btn = document.querySelector(".out-week-btn"); return btn && { text: btn.textContent.replace(/\s+/g, " ").trim(), count: (btn.querySelector(".out-week-count") || {}).textContent, top: btn.getBoundingClientRect().top }; });
    check("the Upcoming view opens with a last-7-days button at the top" + at, bar && /Out in the last 7 days/.test(bar.text) && bar.count === "3", bar);
    await p.click(".out-week-btn"); await p.waitForTimeout(300);
    const sheet = await p.evaluate(() => ({
      open: !document.querySelector("#outTodayModal").hidden,
      title: document.querySelector("#outTodayTitle").textContent,
      count: document.querySelector("#outTodayCount").textContent,
      n: document.querySelector("#outTodayGrid").dataset.n,
      titles: [...document.querySelectorAll("#outTodayGrid .out-tile-title")].map((e) => e.textContent),
      whens: [...document.querySelectorAll("#outTodayGrid .out-tile-when")].map((e) => e.textContent),
      cols: getComputedStyle(document.querySelector("#outTodayGrid")).gridTemplateColumns.split(" ").length,
    }));
    check("it opens the sheet as Out this week" + at, sheet.open && sheet.title === "Out this week" && /3 things came out in the last 7 days/.test(sheet.count), sheet);
    check("with today's and the last six days' releases, newest first, nothing dropped, started, older or month-vague" + at, sheet.titles.join() === "Out Now,Three Days Ago,Six Days Ago", sheet.titles);
    check("each tile says the day it came out" + at, sheet.whens.length === 3 && sheet.whens.every((w) => /\d/.test(w)), sheet.whens);
    check("three tiles sit in one row of three" + at, sheet.n === "3" && sheet.cols === 3, sheet);
    if (width === 375) await p.screenshot({ path: "/tmp/claude-0/-home-claude/64876f2d-6023-5d0c-b424-488b038258a1/scratchpad/outweek-375.png" });
    await p.keyboard.press("Escape"); await p.waitForTimeout(200);

    // One thing out today: the sheet with a single large tile.
    await p.evaluate(() => { localStorage.setItem("lifelog-out-today-v1", JSON.stringify({ day: "2000-01-01" })); localStorage.removeItem("lifelog-visual-settings-v1"); });
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500);
    const one = await p.evaluate(() => ({ open: !document.querySelector("#outTodayModal").hidden, n: document.querySelector("#outTodayGrid").dataset.n, tiles: document.querySelectorAll("#outTodayGrid .out-tile").length, w: Math.round((document.querySelector("#outTodayGrid .out-tile") || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width), title: document.querySelector("#outTodayTitle").textContent }));
    check("one thing out today is one large tile" + at, one.open && one.title === "Out today" && one.n === "1" && one.tiles === 1 && one.w >= 160, one);
    if (width === 375) await p.screenshot({ path: "/tmp/claude-0/-home-claude/64876f2d-6023-5d0c-b424-488b038258a1/scratchpad/outone-375.png" });
    await p.close();
  }
  check("no errors", errs.length === 0, errs);
  await b.close();
  done();
})();
