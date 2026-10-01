// In progress (0.218.0): what you're on now, between the backlog and the log.
// A backlog item with a `startedAt` day, shown in a card at the top of the
// Timeline instead of in the Backlog; ✓ Done logs it with the months it took.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const pad = (n) => String(n).padStart(2, "0");
const day = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const now = new Date();
const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 10);

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }, { id: "b", name: "Books", color: "#4bc46a" }],
  entries: [], accomplishments: {}, notes: [], habits: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {},
  backlog: [
    { id: "g1", title: "Outer Wilds", category: "Games", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "g2", title: "Hades", category: "Games", createdAt: "2026-01-02T00:00:00.000Z", startedAt: day(twoMonthsAgo) },
    { id: "b1", title: "Dune", category: "Books", createdAt: "2026-01-03T00:00:00.000Z", startedAt: day(now) },
  ],
};

async function run(b, width) {
  const errs = [];
  const at = " (" + width + "px)";
  const page = await b.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "entries" }));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const card = () => page.evaluate(() => [...document.querySelectorAll(".progress-row")].map((r) => r.dataset.id));
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));

  check("with nothing logged, the Timeline still shows what's in progress" + at, JSON.stringify(await card()) === JSON.stringify(["b1", "g2"]), await card());
  check("each row says how long it's been going" + at, await page.evaluate(() =>
    /since .* · today/.test(document.querySelector('.progress-row[data-id="b1"] .progress-since').textContent)
    && /since .* · \d+ days/.test(document.querySelector('.progress-row[data-id="g2"] .progress-since').textContent)));
  await page.screenshot({ path: require("path").join(require("os").tmpdir(), "inprogress-" + width + ".png") });

  // The Timeline's category chips narrow the card too.
  await page.locator("#catFilter .cat-chip", { hasText: "Books" }).click();
  await page.waitForTimeout(250);
  check("a category chip narrows the card" + at, JSON.stringify(await card()) === JSON.stringify(["b1"]), await card());
  await page.locator("#catFilter .cat-chip", { hasText: "Books" }).click();
  await page.waitForTimeout(250);

  // ---- starting from the Backlog ----
  await page.click('.tab[data-view="backlog"]');
  await page.waitForTimeout(400);
  const listed = () => page.evaluate(() => [...document.querySelectorAll("#viewBody [data-id]")].map((r) => r.dataset.id).filter((id) => ["g1", "g2", "b1"].includes(id)));
  check("the Backlog lists only what isn't started" + at, JSON.stringify(await listed()) === JSON.stringify(["g1"]), await listed());
  // The "▶ N in progress" link on the Backlog's bar was removed in 0.223.0.
  check("and no longer links to them from its bar" + at, await page.evaluate(() => !document.querySelector(".backlog-progress-link")));
  await page.click('[data-id="g1"] .bl-start');
  await page.waitForTimeout(400);
  check("▶ on a backlog row starts it, and it leaves the Backlog" + at, (await listed()).length === 0
    && (await saved()).backlog.find((x) => x.id === "g1").startedAt === await page.evaluate(() => {
      const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }), await listed());
  check("and says where it went, with a way there" + at, await page.evaluate(() =>
    /top of your Timeline/.test(document.getElementById("toast").textContent) && !!document.querySelector("#toast .toast-action")));
  await page.click("#toast .toast-action");
  await page.waitForTimeout(400);
  check("which is the Timeline's card" + at, (await card()).includes("g1"), await card());

  // ---- ↩ puts it back ----
  await page.click('.progress-row[data-id="g1"] .progress-stop');
  await page.waitForTimeout(400);
  check("↩ puts it back in the backlog" + at, !(await card()).includes("g1") && !(await saved()).backlog.find((x) => x.id === "g1").startedAt);

  // ---- ✓ Done logs it with the months it took ----
  await page.click('.progress-row[data-id="g2"] .btn:not(.progress-stop)');
  await page.waitForTimeout(300);
  const form = await page.evaluate(() => ({ sm: document.getElementById("fStartMonth").value, sy: document.getElementById("fStartYear").value,
    m: document.getElementById("fMonth").value, y: document.getElementById("fYear").value, title: document.getElementById("fTitle").value }));
  check("✓ Done opens the entry already started in the month it was started" + at,
    form.title === "Hades" && +form.sm === twoMonthsAgo.getMonth() + 1 && +form.sy === twoMonthsAgo.getFullYear()
    && +form.m === now.getMonth() + 1 && +form.y === now.getFullYear(), form);
  await page.click('#entryForm button[type="submit"]');
  await page.waitForTimeout(500);
  let d = await saved();
  const hades = d.entries.find((e) => e.title === "Hades");
  check("and logs it as a span, keeping the day it was started" + at, hades && hades.startMonth === twoMonthsAgo.getMonth() + 1
    && hades.startYear === twoMonthsAgo.getFullYear() && hades.startedAt === day(twoMonthsAgo) && !d.backlog.some((x) => x.id === "g2"), hades);
  check("it leaves the card for the log" + at, !(await card()).includes("g2") && await page.evaluate(() =>
    [...document.querySelectorAll(".entry .etitle")].some((t) => t.textContent === "Hades")));

  // Started this month: one month, no span.
  await page.click('.progress-row[data-id="b1"] .btn:not(.progress-stop)');
  await page.waitForTimeout(300);
  await page.click('#entryForm button[type="submit"]');
  await page.waitForTimeout(500);
  d = await saved();
  const dune = d.entries.find((e) => e.title === "Dune");
  check("something started this month is logged as this month, not a span" + at, dune && !dune.startMonth && !dune.startYear, dune);
  check("with the card gone once nothing's left in it" + at, !(await page.$(".progress-block")));

  // ---- starting from the backlog sheet, and a new one straight in ----
  await page.evaluate(() => window.LifeLogBacklog.startItem("g1"));
  await page.waitForTimeout(400);
  await page.click('.progress-block .month-add-btn');
  await page.waitForTimeout(300);
  check("the card's + opens a new item already set to In progress" + at, await page.evaluate(() =>
    !document.getElementById("backlogModal").hidden && document.getElementById("bStarted").checked
    && document.getElementById("bStartedBtn").getAttribute("aria-pressed") === "true"));
  await page.fill("#bTitle", "Celeste");
  await page.click('#backlogForm button[type="submit"]');
  await page.waitForTimeout(500);
  d = await saved();
  const celeste = d.backlog.find((x) => x.title === "Celeste");
  check("saved, it's in the card from today" + at, celeste && celeste.startedAt && (await card()).includes(celeste.id), celeste);
  // Its sheet's ▶ takes it back out.
  await page.click('.progress-row[data-id="' + celeste.id + '"] .etitle');
  await page.waitForTimeout(300);
  check("its row opens its sheet, ▶ on" + at, await page.evaluate(() => !document.getElementById("backlogModal").hidden && document.getElementById("bStarted").checked));
  await page.click("#bStartedBtn");
  await page.click('#backlogForm button[type="submit"]');
  await page.waitForTimeout(500);
  check("and turning ▶ off there puts it back in the backlog" + at, !(await card()).includes(celeste.id) && !(await saved()).backlog.find((x) => x.id === celeste.id).startedAt);

  // ---- it outlives a reload ----
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  check("what's in progress is still in progress after a reload" + at, JSON.stringify(await card()) === JSON.stringify(["g1"]), await card());

  await page.close();
  return errs;
}

(async () => {
  const b = await chromium.launch();
  const errs = [...await run(b, 390), ...await run(b, 1280)];
  await b.close();
  done(errs);
})();
