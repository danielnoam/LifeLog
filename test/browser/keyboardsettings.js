// Settings → Keyboard: changing a key, turning one off, a key moving from
// another action with Undo, a tab's own key in the Shift hint and the
// cheat sheet, Reset all, and the keys syncing in data.settings.keys.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  entries: [], backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
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

  const stored = () => page.waitForTimeout(150).then(() => page.evaluate(() => { const d = window.LifeLogStorage.cachedCopy(); return (d && d.settings && d.settings.keys) || null; }));
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur());

  await page.keyboard.press("Tab");
  check("the Keyboard row shows on a computer", await page.isVisible('#settingsHome .srow[data-page="keyboard"]'));
  check("and says what it holds", /Shortcuts/.test(await page.textContent('[data-status="keyboard"]')));
  await page.click('#settingsHome .srow[data-page="keyboard"]');
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#kbActions .kb-row")].map((r) => r.dataset.kb));
  check("every action has a row", ["add", "search", "settings", "help", "noteMode"].every((id) => rows.includes(id)), rows);
  const tabRows = await page.evaluate(() => document.querySelectorAll("#kbTabs .kb-row").length);
  check("and every tab", tabRows >= 4, tabRows);

  // Search: F becomes S.
  await page.click('[data-kb="search"] .kb-key >> text=F');
  check("clicking a key waits for the new one", await page.isVisible('[data-kb="search"] .kb-key.listening'));
  await page.keyboard.press("s");
  await page.waitForTimeout(200);
  const searchKeys = await page.evaluate(() => [...document.querySelectorAll('[data-kb="search"] .kb-key')].map((b) => b.textContent));
  check("the key pressed is kept", searchKeys.join() === "S,/", searchKeys);
  check("Settings stayed open", !(await page.isHidden("#settingsModal")));
  check("the row is marked changed", await page.isVisible('[data-kb="search"].kb-changed .kb-reset'));
  check("it's saved in the synced settings", JSON.stringify(await stored()) === JSON.stringify({ binds: { search: ["KeyS", "Slash"] } }), await stored());

  // Escape while waiting cancels without closing Settings.
  await page.click('[data-kb="add"] .kb-add');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("Esc cancels waiting for a key", !(await page.isVisible(".kb-key.listening")) && !(await page.isHidden("#settingsModal")));

  // Moving N to Settings takes it from Add entry, with Undo.
  await page.click('[data-kb="settings"] .kb-key');
  await page.keyboard.press("n");
  await page.waitForTimeout(200);
  const toast = await page.textContent("#toast").catch(() => "");
  check("a taken key moves and says from where", /N moved from Add entry/.test(toast), toast);
  check("Add entry has none now", await page.isVisible('[data-kb="add"] .kb-none'));
  await page.click("#toast button");
  await page.waitForTimeout(200);
  check("Undo puts both back", await page.evaluate(() => document.querySelector('[data-kb="add"] .kb-key').textContent === "N" && document.querySelector('[data-kb="settings"] .kb-key').textContent === "Tab"));

  // Take the third tab's key off and give the first one L.
  await page.click('#kbTabs .kb-row:nth-child(3) .kb-x');
  await page.click('#kbTabs .kb-row:nth-child(1) .kb-key');
  await page.keyboard.press("l");
  await page.waitForTimeout(200);
  const firstTab = await page.evaluate(() => document.querySelector("#kbTabs .kb-row").dataset.kb.slice(4));
  const secondTab = await page.evaluate(() => document.querySelectorAll("#kbTabs .kb-row")[2].dataset.kb.slice(4));
  await page.click("#settingsBackBtn").catch(() => {});
  check("three keys count as changed", await page.evaluate(() => window.LifeLogKeys.changedCount() === 3));

  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  check("Settings closes", await page.isHidden("#settingsModal"));
  await blur();

  await page.keyboard.press("f");
  check("F no longer searches", (await focused()) !== "search");
  await page.keyboard.press("s");
  check("S does", (await focused()) === "search");
  await page.keyboard.press("Escape");
  await blur();
  // Start from a tab that's neither, so "nothing happened" can't be the
  // page already sitting on the third tab (Home went first on a computer
  // in #55, which made the third tab the Timeline this suite opens on).
  await page.evaluate((skip) => [...document.querySelectorAll("#viewTabs .tab")].find((t) => !skip.includes(t.dataset.view)).click(), [firstTab, secondTab]);
  await page.waitForTimeout(200);
  await blur();
  await page.keyboard.press("3");
  await page.waitForTimeout(200);
  const viewNow = () => page.evaluate(() => document.querySelector("#viewTabs .tab.active").dataset.view);
  check("the key you took off does nothing", (await viewNow()) !== secondTab, await viewNow());
  await page.keyboard.press("l");
  await page.waitForTimeout(300);
  check("the tab's new key goes to it", (await viewNow()) === firstTab, await viewNow());

  await page.keyboard.down("Shift");
  await page.waitForTimeout(400);
  const hints = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#viewTabs .tab")].map((t) => [t.dataset.view, t.querySelector(".tab-key") ? t.querySelector(".tab-key").textContent : null])));
  await page.keyboard.up("Shift");
  check("held Shift shows each tab's own key", hints[firstTab] === "L" && hints[secondTab] === null, hints);

  await page.keyboard.press("?"); await page.waitForTimeout(200);
  const sheet = await page.textContent("#shortcutRows");
  check("the cheat sheet lists the new keys", /S\s*\/\s*Search/.test(sheet), sheet);
  check("and not F", !/\bF\b/.test(await page.evaluate(() => [...document.querySelectorAll("#shortcutRows dt")].map((d) => d.textContent).join(" "))));
  await page.click("#shortcutsChangeBtn");
  await page.waitForTimeout(300);
  check("Change keys opens Settings → Keyboard", !(await page.isHidden('#settingsModal .settings-page[data-page="keyboard"]')));

  await page.click("#kbResetAll");
  await page.waitForTimeout(200);
  check("Reset all clears what's stored", (await stored()) === null, await stored());
  check("and turns itself off", await page.isDisabled("#kbResetAll"));

  // Ctrl+E rebound to Alt+R in a note.
  await page.click('[data-kb="noteMode"] .kb-key');
  await page.keyboard.press("Alt+r");
  await page.waitForTimeout(200);
  check("a key with Alt is kept as Alt + R", (await page.textContent('[data-kb="noteMode"] .kb-key')) === "Alt + R");

  // Board tools: their own group, sharing keys with the app but not each other.
  const boardRows = await page.evaluate(() => [...document.querySelectorAll("#kbBoards .kb-row")].map((r) => r.dataset.kb));
  check("every board tool has a row", boardRows.length === 10 && boardRows.includes("board:pen") && boardRows.includes("board:image"), boardRows);
  await page.click('[data-kb="board:pen"] .kb-key');
  await page.keyboard.press("n");
  await page.waitForTimeout(200);
  check("a board tool can share N with Add entry", (await page.textContent('[data-kb="board:pen"] .kb-key')) === "N" && (await page.textContent('[data-kb="add"] .kb-key')) === "N");
  await page.click('[data-kb="board:pen"] .kb-key');
  await page.keyboard.press("e");
  await page.waitForTimeout(200);
  const moved = await page.evaluate(() => [...document.querySelectorAll("#toastStack .toast, .toast")].map((t) => t.textContent).join(" "));
  check("but takes E from the eraser", /E moved from Eraser/.test(moved) && await page.isVisible('[data-kb="board:eraser"] .kb-none'), moved);
  await page.click('[data-kb="board:pen"] .kb-key');
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  const fixed = await page.textContent("#toast").catch(() => "");
  check("a board's fixed key can't be given to a tool, and says why", /Space is a fixed key on boards/.test(fixed), fixed);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check("so the tool keeps its key", (await page.textContent('[data-kb="board:pen"] .kb-key')) === "E");
  await page.click("#kbResetAll");
  await page.waitForTimeout(200);

  check("no page errors", errs.length === 0, errs);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})();
