// Out today (0.226.0): a card above Next releases for what came out today,
// before the list drops it; ✕ hides it for the day, and the bar's button
// brings it back with the past week's releases.
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

  await page.locator('.out-row[data-id="t2"] .out-dismiss').click();
  await page.waitForTimeout(250);
  check("✕ hides it for the day" + at, JSON.stringify(await card()) === JSON.stringify(["t1"]), await card());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  check("and it stays hidden after a reload" + at, JSON.stringify(await card()) === JSON.stringify(["t1"]), await card());

  await page.locator(".out-recall").click();
  await page.waitForTimeout(250);
  check("the button brings back the dismissed one" + at, (await card(".out-card:nth-of-type(1)")).includes("t2") || (await card()).includes("t2"), await card());
  check("with last week's, as its own card" + at, JSON.stringify(await names()) === JSON.stringify(["Out today", "Out this past week"]) && (await card()).includes("r1"), await names());
  check("but not what came out a month ago" + at, !(await card()).includes("o1"));
  await page.locator(".out-recall").click();
  await page.waitForTimeout(250);
  check("pressing it again puts it away" + at, JSON.stringify(await card()) === JSON.stringify(["t1"]), await card());

  await page.locator('.out-row[data-id="t1"] .bl-start').click();
  await page.waitForTimeout(300);
  check("▶ starts it and it leaves the card" + at, (await card()).length === 0 && await page.evaluate(() => !!JSON.parse(localStorage.getItem("lifelog-cache-v1")).backlog.find((x) => x.id === "t1").startedAt));

  await page.close();
  return errs;
}

(async () => {
  const b = await chromium.launch();
  const errs = [...await run(b, 390), ...await run(b, 1280)];
  await b.close();
  done(errs);
})();
