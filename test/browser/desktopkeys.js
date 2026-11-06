// Desktop keys (F/Escape for search, Shift for tab numbers, Tab for Settings)
// and the top bar's icons on a computer.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  entries: [{ id: "e1", title: "Thing", category: "Games", year: 2026, month: 3, date: "2026-03",
    createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" }],
  backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {},
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((s) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
    localStorage.removeItem("lifelog-visual-settings-v1");
  }, SEED);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(600);

  const icons = await page.evaluate(() => [...document.querySelectorAll("#viewTabs .tab:not([hidden])")]
    .map((t) => { const i = t.querySelector(".tab-ico .ico"); return i ? i.getBoundingClientRect().width : 0; }));
  check("every desktop tab shows its icon", icons.length >= 4 && icons.every((w) => w >= 14 && w <= 20), icons);

  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  await page.keyboard.press("f");
  check("F focuses search", (await focused()) === "search");
  check("and types nothing", (await page.inputValue("#search")) === "");
  await page.keyboard.type("thing");
  check("typing goes into search", (await page.inputValue("#search")) === "thing");
  await page.keyboard.press("Escape");
  check("Escape clears search", (await page.inputValue("#search")) === "");
  check("and leaves the box", (await focused()) !== "search");
  await page.keyboard.press("f");
  await page.keyboard.press("Escape");
  check("Escape leaves an empty search box too", (await focused()) !== "search");

  await page.keyboard.down("Shift");
  await page.waitForTimeout(400);
  const keys = await page.evaluate(() => [...document.querySelectorAll("#viewTabs .tab:not([hidden]) .tab-key")]
    .filter((k) => getComputedStyle(k).display !== "none").map((k) => k.textContent));
  check("holding Shift numbers the tabs 1..N", keys.length >= 4 && keys.every((k, i) => k === String(i + 1)), keys);
  await page.keyboard.up("Shift");
  const gone = await page.evaluate(() => !document.documentElement.classList.contains("show-tab-keys"));
  check("letting go hides them", gone);
  await page.keyboard.down("Shift");
  await page.waitForTimeout(80);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
  check("a tap of Shift shows nothing", await page.evaluate(() => !document.documentElement.classList.contains("show-tab-keys")));

  const settingsOpen = () => page.evaluate(() => !document.getElementById("settingsModal").hidden);
  await page.keyboard.press("Tab");
  check("Tab opens Settings", await settingsOpen());
  await page.keyboard.press("Tab");
  check("Tab again closes it", !(await settingsOpen()));
  await page.keyboard.press("f");
  await page.keyboard.press("Tab");
  check("Tab in the search box doesn't open Settings", !(await settingsOpen()));

  // A Hebrew layout on Windows: Shift+/ reports "/" or ".", the F key "כ".
  const press = (key, code, shiftKey) => page.evaluate(({ key, code, shiftKey }) =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key, code, shiftKey, bubbles: true, cancelable: true })), { key, code, shiftKey });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await press("?", "Slash", true);
  const helpOpen = () => page.evaluate(() => !document.getElementById("shortcutsModal").hidden);
  check("? opens the shortcuts list", await helpOpen());
  await page.keyboard.press("Escape");
  await press("/", "Slash", true);
  check("Shift+/ opens it when the layout reports \"/\"", await helpOpen());
  check("and doesn't focus search", (await focused()) !== "search");
  await page.keyboard.press("Escape");
  await press(".", "Slash", true);
  check("or \".\"", await helpOpen());
  await page.keyboard.press("Escape");
  await press("כ", "KeyF", false);
  check("the F key focuses search on a Hebrew layout", (await focused()) === "search");
  await page.keyboard.press("Escape");

  check("no page errors", errs.length === 0, errs);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})();
