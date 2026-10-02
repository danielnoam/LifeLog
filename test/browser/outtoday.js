// Out today (0.226.0): a card above Next releases for what came out today,
// before the list drops it, and a sheet the first time the app opens that
// day (once, only if something is out, and Settings can turn it off).
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const pad = (n) => String(n).padStart(2, "0");
const day = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return day(d); };
const ahead = (n) => ago(-n);

const mk = (id, title, extra) => ({ id, title, category: "Games", createdAt: "2026-01-01T00:00:00.000Z", releasePrecision: "day", ...extra });
const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  entries: [], accomplishments: {}, notes: [], habits: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {},
  backlog: [
    mk("t1", "Out Now", { releaseDate: ago(0), releaseStatus: "released" }),
    mk("t2", "Also Today", { releaseDate: ago(0) }),
    mk("r1", "Last Week", { releaseDate: ago(3), releaseStatus: "released" }),
    mk("o1", "Long Ago", { releaseDate: ago(30), releaseStatus: "released" }),
    mk("f1", "Next Month", { releaseDate: ahead(20) }),
    mk("s1", "Already Started", { releaseDate: ago(0), startedAt: ago(0) }),
  ],
};

async function run(b, width) {
  const errs = [];
  const at = " (" + width + "px)";
  const page = await b.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "upcoming" }));
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ outTodaySheet: "hide" }));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const card = (sel) => page.evaluate((q) => [...document.querySelectorAll(q + " .out-row")].map((r) => r.dataset.id).sort(), sel || ".out-card");
  const names = () => page.evaluate(() => [...document.querySelectorAll(".out-card .backlog-section-name")].map((e) => e.textContent));

  check("what's out today has its card" + at, JSON.stringify(await card()) === JSON.stringify(["t1", "t2"]), await card());
  check("a started title isn't on it" + at, !(await card()).includes("s1"));
  check("the list below doesn't say the same title twice" + at,
    await page.evaluate(() => !!document.querySelector(".backlog-grid") && ![...document.querySelectorAll(".backlog-grid .up-row")].some((r) => r.dataset.id === "t2")));
  check("a title for next month stays in the list" + at,
    await page.evaluate(() => [...document.querySelectorAll(".backlog-grid .up-row")].some((r) => r.dataset.id === "f1")));
  await page.screenshot({ path: require("path").join(require("os").tmpdir(), "outtoday-" + width + ".png") });

  check("there is no button or dismiss to manage it" + at, await page.evaluate(() => !document.querySelector(".out-recall, .out-dismiss")));

  await page.locator('.out-row[data-id="t1"] .bl-start').click();
  await page.waitForTimeout(300);
  check("▶ starts it and it leaves the card" + at, JSON.stringify(await card()) === JSON.stringify(["t2"]) && await page.evaluate(() => !!JSON.parse(localStorage.getItem("lifelog-cache-v1")).backlog.find((x) => x.id === "t1").startedAt));

  await page.close();

  // ---- the sheet ----
  const open = async (visual, backlog, view) => {
    const p = await b.newPage({ viewport: { width, height: 900 } });
    p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    await p.evaluate(({ s, v, view }) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: view || "timeline", timelineMode: "entries" }));
      if (v) localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v));
    }, { s: { ...SEED, backlog }, v: visual, view });
    await p.reload({ waitUntil: "networkidle" });
    await p.waitForTimeout(2000);
    return p;
  };
  const shown = (p) => p.evaluate(() => !document.querySelector("#outTodayModal").hidden);
  let p = await open(null, SEED.backlog);
  check("the first open of the day shows what came out" + at, await shown(p));
  check("with a tile per title that's out, started ones not among them" + at,
    await p.evaluate(() => [...document.querySelectorAll("#outTodayGrid .out-tile-title")].map((e) => e.textContent).sort().join()) === "Also Today,Out Now");
  await p.screenshot({ path: require("path").join(require("os").tmpdir(), "outsheet-" + width + ".png") });
  await p.keyboard.press("Escape");
  check("Escape closes it" + at, !(await shown(p)));
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
  check("and it doesn't come back the same day" + at, !(await shown(p)));
  await p.evaluate(() => localStorage.setItem("lifelog-out-today-v1", JSON.stringify({ day: "2000-01-01" })));
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
  check("but does the next day" + at, await shown(p));
  await p.close();

  p = await open(null, SEED.backlog.filter((x) => x.id === "f1" || x.id === "o1"));
  check("with nothing out today it stays shut, and doesn't use the day up" + at,
    !(await shown(p)) && await p.evaluate(() => !localStorage.getItem("lifelog-out-today-v1")));
  await p.close();

  p = await open({ outTodaySheet: "hide" }, SEED.backlog);
  check("the setting turns it off" + at, !(await shown(p)));
  await p.close();

  return errs;
}

(async () => {
  const b = await chromium.launch();
  const errs = [...await run(b, 390), ...await run(b, 1280)];
  await b.close();
  done(errs);
})();
