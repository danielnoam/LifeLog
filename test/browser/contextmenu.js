// Right-click menus on a computer (0.305.0): each kind of row has its own
// actions, Delete asks first, Select starts selecting, a selection gets the
// bulk bar's actions, and a touch's contextmenu (Android's long press) is
// left to the long press. Demo data from tools/readme-shots.js.
const { chromium, BASE, tally } = require("./harness");
const { buildData } = require("../../tools/readme-shots.js");
const { check, done } = tally();

(async () => {
  const { data } = buildData();
  const b = await chromium.launch();
  const errs = [];
  const page = await (await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", serviceWorkers: "block" })).newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  const go = async (ui) => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(({ data, ui }) => {
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(data));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify(ui));
      localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ outTodaySheet: "hide" }));
    }, { data, ui });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(400);
  };
  const items = () => page.$$eval(".ctx-menu:not([hidden]) button, .ctx-menu:not([hidden]) .ctx-head", (n) => n.map((x) => x.textContent.trim()));
  const pick = (label) => page.click(`.ctx-menu:not([hidden]) button:text-is("${label}")`);
  // Any scroll closes the menu, so the row is brought to the middle and the
  // page left to settle first: a row at the window's bottom edge (the
  // Ledger's second entry is) used to be scrolled into view by the click
  // itself, and on a slow runner that scroll could land after the menu
  // opened and shut it again.
  const right = async (loc) => {
    await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    await loc.click({ button: "right", position: { x: 60, y: 12 } });
    await page.waitForSelector(".ctx-menu:not([hidden])", { timeout: 2000 }).catch(() => {});
  };

  await go({ view: "backlog", backlogMode: "entries" });
  const rows = () => page.locator(".backlog-item-rich[data-id]");
  await right(rows().nth(1));
  const bl = await items();
  check("a backlog row has its actions", ["Open", "Set as Done", "Move to Dropped", "Select", "Delete"].every((x) => bl.includes(x)) && bl.some((x) => /^(Un)?star$/i.test(x)), bl);
  const star = bl.find((x) => /^(Un)?star$/i.test(x));
  await pick(star);
  await page.waitForTimeout(200);
  await right(rows().nth(1));
  const flipped = (await items()).find((x) => /^(Un)?star$/i.test(x));
  check("Star flips", flipped && flipped !== star, { star, flipped });
  await page.keyboard.press("Escape");
  check("Escape closes it", (await items()).length === 0);
  await page.waitForTimeout(700);
  check("a right press doesn't start selecting", !(await page.evaluate(() => document.querySelector(".bulk-bar") && document.querySelector(".bulk-bar").isConnected)));

  const before = await rows().count();
  await right(rows().nth(1));
  await pick("Delete");
  await page.waitForTimeout(300);
  check("Delete asks, then removes the one row", dialogs.length === 1 && (await rows().count()) === before - 1, { dialogs, before, after: await rows().count() });

  await right(rows().nth(0));
  await pick("Select");
  await page.waitForTimeout(200);
  await right(rows().nth(1));
  const bulk = await items();
  check("with a selection, the menu is the bulk bar's", bulk[0] === "2 selected" && bulk.includes("Move to…") && bulk.includes("Delete 2") && bulk.includes("Clear selection"), bulk);
  await pick("Move to…");
  const sub = await items();
  check("Move to… lists the categories", sub[0] === "Move to" && sub.includes("Movies"), sub);
  await page.keyboard.press("Escape");

  for (const [ui, sel, want] of [
    [{ view: "timeline", timelineMode: "entries" }, ".entry:not(.progress-row)[data-id]", ["Open", "Move to backlog", "Select", "Delete"]],
    [{ view: "timeline", timelineMode: "entries" }, ".progress-row[data-id]", ["Open", "Back to backlog", "Set as Done", "Delete"]],
    [{ view: "finance", financeMode: "entries" }, ".finance-entry[data-id]:not([data-id*=':'])", ["Open", "Select", "Delete"]],
    [{ view: "notes", notesMode: "notes" }, ".note-card[data-id]", ["Open", "Move to…", "Select", "Delete"]],
    [{ view: "notes", notesMode: "habits" }, ".habit-card[data-id]", ["Edit", "Archive", "Delete"]],
  ]) {
    // A recurring bill's charge (id "plan:n") has no menu; which row comes second moves with the date.
    await go(ui);
    await right(page.locator(sel).nth(1));
    const got = await items();
    check(sel + " has its menu", want.every((x) => got.includes(x)), got);
    await page.keyboard.press("Escape");
  }

  await go({ view: "backlog", backlogMode: "entries" });
  await page.evaluate(() => {
    const r = document.querySelector(".backlog-item-rich[data-id]");
    r.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
    r.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 400 }));
  });
  check("a touch's contextmenu opens nothing", (await items()).length === 0);

  // Everywhere else the app's menu, never the browser's (2026-11-27).
  await go({ view: "timeline", timelineMode: "entries" });
  const fire = (sel, opts = {}) => page.evaluate(({ sel, opts }) => {
    const n = document.querySelector(sel);
    const r = n.getBoundingClientRect();
    n.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true }));
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4, shiftKey: !!opts.shift });
    n.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, { sel, opts });
  await page.mouse.click(384, 173, { button: "right" });
  await page.waitForTimeout(200);
  const pg = await items();
  check("the page's menu has the tab's adds", ["Add", "Entry", "Achievement", "Search", "Keyboard shortcuts", "Settings"].every((x) => pg.includes(x)), pg);
  await pick("Search");
  check("Search goes to the search box", await page.evaluate(() => document.activeElement && document.activeElement.id === "search"));
  check("Shift+right-click leaves the browser's menu", !(await fire("#viewTabs .tab", { shift: true })));
  check("a text field keeps the system's menu", !(await fire("#search")));
  await page.evaluate(() => { const a = document.createElement("a"); a.href = "https://example.com/"; a.id = "ctxLink"; a.textContent = "link"; document.querySelector("#viewTabs").after(a); });
  await fire("#ctxLink");
  const ln = await items();
  check("a link gets Open link and Copy link", ln.join() === "Open link,Copy link", ln);
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector("#addBtn").click());
  await page.evaluate(() => document.querySelector("#addMenu [data-add='entry']").click());
  await page.waitForTimeout(300);
  check("inside a sheet: no menu, and no browser menu", await fire(".modal-overlay:not([hidden]) .modal, .modal-overlay:not([hidden])") && (await items()).length === 0);

  check("no page errors", errs.length === 0, errs);
  await b.close();
  done();
})();
