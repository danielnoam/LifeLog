// Accessibility pass (0.254.0): the toast is read out, the tab bar is a
// tablist the arrows move through, every sheet is a labelled dialog that
// takes focus when it opens, Tab stays inside it, and closing hands focus
// back to the opener (0.223.0).
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ name: "Games", color: "#58a6ff" }],
  entries: [{ id: "e1", title: "Portal", category: "Games", year: 2024, month: 5, date: "2024-05-17" }],
  accomplishments: {}, backlog: [], habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [], notes: [], settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)); }, SEED);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(300);

  // ---- every sheet is a dialog with a name ----
  const dialogs = await page.evaluate(() => [...document.querySelectorAll(".modal-overlay > .modal")].map((m) => {
    const by = m.getAttribute("aria-labelledby");
    return { id: m.parentElement.id, role: m.getAttribute("role"), modal: m.getAttribute("aria-modal"), named: !!(m.getAttribute("aria-label") || (by && document.getElementById(by))) };
  }));
  check("every sheet has role=dialog", dialogs.every((d) => d.role === "dialog"), dialogs.filter((d) => d.role !== "dialog"));
  check("every sheet is aria-modal", dialogs.every((d) => d.modal === "true"), dialogs.filter((d) => d.modal !== "true"));
  check("every sheet has a name a reader can say", dialogs.every((d) => d.named), dialogs.filter((d) => !d.named));
  check("there are a few dozen of them", dialogs.length >= 25, dialogs.length);

  // ---- the toast is read out ----
  const live = await page.evaluate(() => { const l = document.querySelector("#toastLive"); return l && { role: l.getAttribute("role"), live: l.getAttribute("aria-live"), hidden: l.hidden, w: l.getBoundingClientRect().width }; });
  check("a live region exists, never hidden, out of sight", live && live.role === "status" && live.live === "polite" && !live.hidden && live.w <= 1, live);
  await page.keyboard.press("n"); await page.waitForTimeout(200);
  check("N opens the entry sheet", await page.isVisible("#entryModal"));
  const focusedIn = await page.evaluate(() => document.querySelector("#entryModal").contains(document.activeElement) && document.activeElement.getAttribute("role"));
  check("the sheet itself takes focus when it opens", focusedIn === "dialog", focusedIn);
  // Tab from the sheet goes to its first control; Shift+Tab from there wraps to the last.
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check("Tab lands on the sheet's first control", await page.evaluate(() => document.querySelector("#entryModal").contains(document.activeElement)), first);
  await page.keyboard.press("Shift+Tab");
  const wrapped = await page.evaluate(() => { const a = document.activeElement; const ov = document.querySelector("#entryModal"); const items = [...ov.querySelectorAll("button, input, select, textarea, a[href]")].filter((n) => n.getClientRects().length && !n.disabled); return { inside: ov.contains(a), isLast: a === items[items.length - 1], id: a.id || a.textContent }; });
  check("Shift+Tab from the first wraps to the last", wrapped.inside && wrapped.isLast, wrapped);
  await page.keyboard.press("Tab");
  check("and Tab from the last wraps back to the first", await page.evaluate(() => document.activeElement.id) === first);
  await page.click("#cancelEntryBtn"); await page.waitForTimeout(200);
  // A toast from a real action: saving an entry opened from the + button.
  await page.focus("#addBtn"); await page.keyboard.press("n"); await page.waitForTimeout(300);
  await page.fill("#fTitle", "Half-Life");
  await page.click('#entryForm button[type="submit"]'); await page.waitForTimeout(400);
  const spoken = await page.evaluate(() => document.querySelector("#toastLive").textContent);
  const shown = await page.evaluate(() => document.querySelector("#toast").textContent);
  check("what the toast shows is what the reader hears", spoken && spoken === shown, { spoken, shown });
  check("closing a sheet returns focus to its opener", await page.evaluate(() => document.activeElement && document.activeElement.id) === "addBtn", await page.evaluate(() => document.activeElement && document.activeElement.id));

  // ---- the tab bar is a tablist ----
  const tabs = await page.evaluate(() => ({ list: document.querySelector("#viewTabs").getAttribute("role"), roles: [...document.querySelectorAll("#viewTabs .tab")].map((t) => t.getAttribute("role")), selected: [...document.querySelectorAll("#viewTabs .tab")].filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.dataset.view) }));
  check("the bar is a tablist of tabs", tabs.list === "tablist" && tabs.roles.every((r) => r === "tab"), tabs);
  check("exactly the open tab is selected", tabs.selected.join() === "timeline", tabs);
  await page.focus('#viewTabs .tab[data-view="timeline"]');
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ focus: document.activeElement.dataset.view, selected: [...document.querySelectorAll('#viewTabs .tab[aria-selected="true"]')].map((t) => t.dataset.view), active: document.querySelector("#viewTabs .tab.active").dataset.view }));
  check("ArrowRight moves to the next tab and opens it", after.focus === "backlog" && after.selected.join() === "backlog" && after.active === "backlog", after);
  await page.keyboard.press("Home"); await page.waitForTimeout(300);
  check("Home goes to the first tab", await page.evaluate(() => document.activeElement.dataset.view) === "notes");
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(300);
  check("ArrowLeft from the first wraps to the last", await page.evaluate(() => document.activeElement.dataset.view) === "finance");
  check("no errors", errs.length === 0, errs);
  await ctx.close();
  await b.close();
  done();
})();
