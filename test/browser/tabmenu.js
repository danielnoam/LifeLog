// The desktop tab menu and the number keys (0.264.2): a pointer crossing the
// bar doesn't drop a menu out of every tab it passes, the menu stays open
// coming back up from it into its tab, and a tab's number pressed again steps
// through its modes.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" })); });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__opened = [];
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains("tab-menu")) window.__opened.push(n.dataset.view);
    }).observe(document.body, { subtree: true, childList: true });
  });
  const menuOpen = () => page.evaluate(() => !!document.querySelector(".tab-menu"));
  const box = async (view) => (await page.$(`#viewTabs .tab[data-view="${view}"]`)).boundingBox();

  // Straight down through the bar, the way the pointer goes to the page.
  const tl = await box("timeline");
  await page.mouse.move(tl.x + 20, 0);
  for (let y = 0; y < 300; y += 12) { await page.mouse.move(tl.x + 20, y); await page.waitForTimeout(16); }
  await page.waitForTimeout(300);
  check("crossing the bar opens no menu", (await page.evaluate(() => window.__opened.length)) === 0,
    await page.evaluate(() => window.__opened));

  // Resting on a tab opens it.
  await page.mouse.move(tl.x + 20, tl.y + tl.height / 2);
  await page.waitForTimeout(350);
  check("resting on a tab opens its menu", await menuOpen());

  // Into the menu and back up onto the tab.
  for (let y = tl.y + tl.height / 2; y < tl.y + tl.height + 40; y += 3) { await page.mouse.move(tl.x + 20, y); await page.waitForTimeout(16); }
  check("the menu stays open under the pointer", await menuOpen());
  for (let y = tl.y + tl.height + 40; y > tl.y + 6; y -= 3) { await page.mouse.move(tl.x + 20, y); await page.waitForTimeout(16); }
  await page.waitForTimeout(400);
  check("and stays open back on its tab", await menuOpen());

  // Along the bar with one open swaps at once.
  const bl = await box("backlog");
  await page.mouse.move(bl.x + 20, bl.y + bl.height / 2, { steps: 6 });
  await page.waitForTimeout(60);
  check("moving along the bar swaps the menu at once",
    await page.evaluate(() => (document.querySelector(".tab-menu") || {}).dataset?.view === "backlog"));

  await page.mouse.move(640, 600);
  await page.waitForTimeout(400);
  check("leaving the bar closes it", !(await menuOpen()));

  // Number keys: the tab you're on steps through its modes.
  const keyOf = (view) => page.evaluate((v) => {
    const tabs = [...document.querySelectorAll("#viewTabs .tab:not([hidden])")].map((t) => t.dataset.view);
    return String(tabs.indexOf(v) + 1);
  }, view);
  const mode = () => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-ui-v1") || "{}").backlogMode || "entries");
  const view = () => page.evaluate(() => document.querySelector("#viewTabs .tab.active").dataset.view);
  const k = await keyOf("backlog");
  await page.keyboard.press(k); await page.waitForTimeout(300);
  check("a number goes to its tab", (await view()) === "backlog");
  const first = await mode();
  await page.keyboard.press(k); await page.waitForTimeout(300);
  const second = await mode();
  check("the same number again steps to the next mode", second !== first && (await view()) === "backlog", { first, second });
  const count = await page.evaluate(() => document.querySelectorAll('#viewTabs .tab[data-view="backlog"] .tab-mode-dot').length);
  for (let i = 2; i < count; i++) { await page.keyboard.press(k); await page.waitForTimeout(250); }
  await page.keyboard.press(k); await page.waitForTimeout(250);
  check("and wraps back round to the first", count > 1 && (await mode()) === first, { count, now: await mode(), first });
  await page.keyboard.press("?"); await page.waitForTimeout(200);
  check("the cheat-sheet says so", await page.evaluate(() => /again for the next mode/.test(document.querySelector("#shortcutViewRows").textContent)));

  await b.close();
  done(errs);
})();
