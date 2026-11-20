// The pinned window (Nov 2026, computer app): the page turns into Today,
// Coming up, Notes and Scratchpad tabs with a quick-add line, and back.
// The browser has no Tauri, so the desktop check is stubbed; the window
// resizing itself is main.rs's and isn't reached here. Also the .ics export.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const T0 = "2026-11-01T10:00:00.000Z";
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const DATA = () => ({ categories: [{ name: "Books", color: "#2f9e44" }], entries: [], accomplishments: {}, habits: [], projects: [],
  backlog: [{ id: "b1", title: "Big Game", category: "Books", releaseDate: day(3), releasePrecision: "day", awaitingRelease: true, createdAt: T0 }],
  financeCategories: [{ name: "Food", color: "#e8590c" }], financeEntries: [], recurringExpenses: [], settings: { scratchpad: "pad text" }, noteCategories: [],
  notes: [
    { id: "n1", title: "Weekend loaf", text: "500 g flour", pinned: true, createdAt: T0 },
    { id: "l1", kind: "list", text: "Errands", items: [{ id: "t1", text: "Bins", date: day(0) }, { id: "t2", text: "Old one", date: day(-2) }], createdAt: T0 },
  ] });

async function run(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 640 }, acceptDownloads: true });
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1)/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource|ERR_FAILED/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((data) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(data));
  }, DATA());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const at = " (" + width + "px)";
  const data = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());

  check("no pin button in the browser" + at, await page.evaluate(() => document.getElementById("pinBtn").hidden));
  await page.evaluate(() => { window.LifeLogDesktop.available = () => true; window.LifeLogPin.restore(); });
  check("the pin button shows in the computer app" + at, await page.evaluate(() => !document.getElementById("pinBtn").hidden));
  await page.keyboard.press("Control+Shift+KeyP");
  await page.waitForTimeout(200);
  check("Ctrl+Shift+P pins: the page hides, the pinned view shows" + at, await page.evaluate(() =>
    document.body.classList.contains("is-pinned") && !document.getElementById("pinView").hidden
    && getComputedStyle(document.querySelector(".topbar")).display === "none" && getComputedStyle(document.getElementById("content")).display === "none"));
  check("it opens on Today: today's task, the overdue one, today's heading" + at, await page.evaluate(() => {
    const t = document.querySelector(".pin-body").textContent;
    return /Bins/.test(t) && /Old one/.test(t) && /Overdue/.test(t) && /Today/.test(t) && !/Big Game/.test(t);
  }));
  check("the pinned choice is kept for this device" + at, await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-pin-v1")).on === true));

  await page.click('.pin-tab[data-tab="upcoming"]');
  await page.waitForTimeout(150);
  check("Coming up has the release" + at, await page.evaluate(() => /Big Game/.test(document.querySelector(".pin-body").textContent)));
  await page.click('.pin-tab[data-tab="notes"]');
  await page.waitForTimeout(150);
  check("Notes has the pinned note" + at, await page.evaluate(() => /Weekend loaf/.test(document.querySelector(".pin-body").textContent)));
  await page.click('.pin-tab[data-tab="scratchpad"]');
  await page.waitForTimeout(150);
  check("Scratchpad has its field" + at, await page.evaluate(() => { const f = document.querySelector(".pin-body textarea"); return !!f && f.value === "pad text"; }));
  await page.click('.pin-tab[data-tab="today"]');

  // ---- quick add ----
  await page.fill(".pin-input", "Buy milk");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check("a task goes into the picked list" + at, (await data()).notes.find((n) => n.id === "l1").items.some((i) => i.text === "Buy milk"));
  check("and the field empties" + at, await page.evaluate(() => document.querySelector(".pin-input").value === ""));
  await page.click('.pin-kind[data-kind="expense"]');
  check("Expense asks for an amount" + at, await page.evaluate(() => /12\.50/.test(document.querySelector(".pin-input").placeholder) && document.querySelector(".pin-list").hidden));
  await page.fill(".pin-input", "12.50 coffee");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check("an expense is added with its note" + at, (await data()).financeEntries.some((f) => f.amount === 12.5 && f.note === "coffee"));
  await page.click('.pin-kind[data-kind="note"]');
  await page.fill(".pin-input", "Idea for later");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check("a note is added" + at, (await data()).notes.some((n) => n.text === "Idea for later"));

  // ---- a tick stays in the pinned view ----
  await page.evaluate(() => [...document.querySelectorAll(".pin-body .home-row")].find((r) => /Bins/.test(r.textContent)).querySelector("input[type=checkbox]").click());
  await page.waitForTimeout(300);
  check("ticking today's task keeps the window pinned" + at, await page.evaluate(() => document.body.classList.contains("is-pinned")));
  check("and the task is done" + at, (await data()).notes.find((n) => n.id === "l1").items.find((i) => i.id === "t1").done === true);

  // ---- back ----
  await page.click(".pin-off");
  await page.waitForTimeout(200);
  check("Unpin brings the page back" + at, await page.evaluate(() => !document.body.classList.contains("is-pinned") && document.getElementById("pinView").hidden
    && getComputedStyle(document.querySelector(".topbar")).display !== "none"));
  await page.click("#pinBtn");
  await page.waitForTimeout(150);
  check("the top bar's pin button pins again" + at, await page.evaluate(() => document.body.classList.contains("is-pinned")));
  await page.evaluate(() => window.LifeLogPin.set(false));

  // ---- .ics ----
  if (width > 600) {
    await page.evaluate(() => window.LifeLogSettings.openSettings("io"));
    await page.waitForTimeout(300);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportIcsBtn")]);
    const text = require("fs").readFileSync(await dl.path(), "utf8");
    check("Calendar saves lifelog.ics" + at, dl.suggestedFilename() === "lifelog.ics");
    check("with the task and the release in it" + at, /BEGIN:VCALENDAR/.test(text) && /SUMMARY:Old one/.test(text) && /SUMMARY:Big Game/.test(text));
  }

  check("no errors" + at, errs.length === 0, errs.join("\n"));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  try { await run(b, 1280); await run(b, 380); }
  finally { await b.close(); }
  done();
})();
