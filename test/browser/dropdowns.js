// The app's own dropdown list (src/select.js): a click, a tap or a key on a
// <select> opens ours instead of the browser's, picking fires change, and
// the keyboard works the way the native list did.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }],
  entries: [],
  backlog: [
    { id: "a", title: "Alpha", category: "Games", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "b", title: "Beta", category: "Games", createdAt: "2025-02-01T00:00:00.000Z" },
  ],
  habits: [], notes: [], todos: [], financeEntries: [], recurringExpenses: [],
  projects: [], todoCategories: [], financeCategories: [], settings: {},
};

async function seed(page) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ outTodaySheet: "hide" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
}

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await seed(page);

  const sort = page.locator(".sort-select:visible").first();
  const before = await sort.inputValue();
  await sort.click(); await page.waitForTimeout(150);
  check("a click opens the app's list under the field", await page.isVisible(".dd-pop [role=listbox]"));
  const opts = await page.$$eval(".dd-pop .dd-opt", (o) => o.map((x) => x.textContent));
  const native = await sort.evaluate((s) => [...s.options].map((o) => o.textContent));
  check("with every option, in order", opts.join("|") === native.join("|"), { opts, native });
  check("the current one is marked selected", (await page.textContent('.dd-pop .dd-opt[aria-selected="true"]')) === await sort.evaluate((s) => s.options[s.selectedIndex].textContent));
  check("the field says it's open", (await sort.getAttribute("aria-expanded")) === "true");
  await page.evaluate(() => { window.__changes = 0; document.addEventListener("change", (e) => { if (e.target.classList.contains("sort-select")) window.__changes++; }); });
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  const afterKey = await page.locator(".sort-select:visible").first().inputValue();
  check("arrow + Enter picks the next one and fires change", afterKey !== before && (await page.evaluate(() => window.__changes)) === 1, { before, afterKey });
  check("and the list closes", (await page.$(".dd-pop")) === null);

  const sort2 = page.locator(".sort-select:visible").first();
  await sort2.focus(); await page.keyboard.press("Space"); await page.waitForTimeout(150);
  check("Space on the field opens it", await page.isVisible(".dd-pop"));
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  check("Escape closes it without changing anything", (await page.$(".dd-pop")) === null && (await sort2.inputValue()) === afterKey);
  check("and gives focus back to the field", await sort2.evaluate((s) => document.activeElement === s));

  await sort2.click(); await page.waitForTimeout(150);
  const last = await page.locator(".dd-pop .dd-opt").last();
  const lastText = await last.textContent();
  await last.click(); await page.waitForTimeout(250);
  const s3 = page.locator(".sort-select:visible").first();
  check("a click on an option picks it", await s3.evaluate((s, t) => s.options[s.selectedIndex].textContent === t, lastText));

  await s3.click(); await page.waitForTimeout(150);
  await page.mouse.click(20, 880); await page.waitForTimeout(150);
  check("a click outside closes it", (await page.$(".dd-pop")) === null);

  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  await page.click('.srow[data-page="appearance"]'); await page.waitForTimeout(300);
  await page.click("#themeSelect"); await page.waitForTimeout(150);
  check("a select inside a sheet opens above it", await page.isVisible(".dd-pop"));
  await page.locator(".dd-pop .dd-opt", { hasText: "Nord" }).click(); await page.waitForTimeout(300);
  check("and picking there runs the field's own handler (theme changes)", await page.evaluate(() => document.documentElement.classList.contains("theme-nord")));
  check("the sheet stays open", !(await page.isHidden("#settingsModal")));

  const phone = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  phone.on("pageerror", (e) => errs.push("phone pageerror: " + e.message));
  await seed(phone);
  const ps = phone.locator(".sort-select:visible").first();
  await ps.tap(); await phone.waitForTimeout(300);
  check("on a phone a tap opens the bottom sheet", await phone.isVisible(".dd-sheet"));
  check("headed with the field's name", (await phone.textContent(".dd-title")) === "Sort");
  const h = await phone.$eval(".dd-sheet .dd-opt", (o) => o.getBoundingClientRect().height);
  check("with rows at least 44px tall", h >= 44, h);
  await phone.locator(".dd-sheet .dd-opt").nth(1).tap(); await phone.waitForTimeout(300);
  check("a tap on a row picks it and closes the sheet", (await phone.$(".dd-sheet")) === null);
  await phone.locator(".sort-select:visible").first().tap(); await phone.waitForTimeout(300);
  await phone.mouse.click(195, 60); await phone.waitForTimeout(300);
  check("a tap on the dimmed page closes it", (await phone.$(".dd-sheet")) === null);

  check("no console errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
