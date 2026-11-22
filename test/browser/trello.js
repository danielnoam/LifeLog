// Trello lists as task lists (Nov 2026): with a key, a token and a list
// picked, the app reads the list's cards from Trello's API (stood in for
// here) into a task list in the Notebook with the Trello badge, a tick there
// marks the card complete a few seconds later, a task added there becomes a
// card, and Settings → Connections → Trello lists the boards with the
// picked list switched on. In Hebrew the page has no English left but names.
// The board here is set to a task list per Trello list; trelloboards.js has
// a board as one task list.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const T = "2026-01-01T00:00:00.000Z";
const L = "a".repeat(24), B = "b".repeat(24), ME = "c".repeat(24), C1 = "1".repeat(24), C2 = "2".repeat(24);

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const cards = new Map([
    [C1, { id: C1, idList: L, idBoard: B, name: "Order the sink", desc: "", due: null, dueComplete: false, closed: false, idLabels: ["l1"], idMembers: [ME], checklists: [], dateLastActivity: T }],
    [C2, { id: C2, idList: L, idBoard: B, name: "Pick tiles", desc: "", due: null, dueComplete: false, closed: false, idLabels: [], idMembers: [ME], checklists: [], dateLastActivity: T }],
  ]);
  const sent = [];
  let slow = 0;
  const until = async (ok, ms = 10000) => { for (const end = Date.now() + ms; Date.now() < end && !ok();) await new Promise((r) => setTimeout(r, 100)); };
  const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
  await page.route("https://api.trello.com/**", async (r) => {
    const req = r.request();
    const p = new URL(req.url()).pathname.replace(/^\/1/, "");
    if (req.method() === "OPTIONS") return r.fulfill({ status: 200, headers: { ...cors, "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, PUT, POST, DELETE" }, body: "" });
    const auth = req.headers().authorization || "";
    if (!auth.includes('oauth_token="tok"')) return r.fulfill({ status: 401, headers: cors, body: "invalid token" });
    if (slow) await new Promise((res) => setTimeout(res, slow));
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    if (req.method() !== "GET") sent.push({ method: req.method(), path: p, body });
    let out = null;
    if (p === "/members/me") out = { id: ME, username: "reader", fullName: "R" };
    else if (p === "/members/me/boards") out = [{ id: B, name: "Home", lists: [{ id: L, name: "To do" }, { id: "d".repeat(24), name: "Later" }] }];
    else if (p === `/lists/${L}/cards`) out = [...cards.values()].filter((c) => c.idList === L && !c.closed);
    else if (p === `/boards/${B}/labels`) out = [{ id: "l1", name: "urgent" }];
    else if (req.method() === "PUT" && p.startsWith("/cards/")) { const c = cards.get(p.split("/")[2]); Object.assign(c, body); out = c; }
    else if (req.method() === "POST" && p === "/cards") { out = { id: "9".repeat(24), idBoard: B, closed: false, dueComplete: false, idLabels: [], checklists: [], ...body }; cards.set(out.id, out); }
    if (!out) return r.fulfill({ status: 404, headers: cors, body: "not found" });
    r.fulfill({ status: 200, headers: cors, body: JSON.stringify(out) });
  });
  await page.route(/^https:\/\/(?!api\.trello\.com\/)/, (r) => r.abort());
  await page.goto(BASE + "/", { waitUntil: "load" });
  await forgetCopy(page);
  await page.evaluate(({ T, L, B, ME }) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify({
    categories: [], entries: [], backlog: [], habits: [], notes: [{ id: "fav1", text: "A favourite", fav: true, createdAt: T, updatedAt: T }],
    settings: { trello: { key: "k".repeat(32), token: "tok", member: { id: ME, username: "reader" }, connectedAt: T, lists: [{ id: L, name: "To do", board: B, boardName: "Home" }], split: [B] } } })); }, { T, L, B, ME });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction((L) => (window.LifeLogStorage.cachedCopy().notes || []).some((x) => x.id === "trello-" + L && x.items.length), L, { timeout: 10000 }).catch(() => {});
  const data = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());

  let d = await data();
  const n = (d.notes || []).find((x) => x.id === "trello-" + L);
  check("the list comes in as a task list", n && n.kind === "list" && n.text === "Home · To do", n);
  check("its cards are tasks, a named label a tag", n && n.items.length === 2 && n.items[0].text === "Order the sink" && (n.items[0].tags || []).join() === "urgent", n && n.items);
  check("nothing was sent on the first read", sent.length === 0, sent);

  await page.evaluate(() => document.querySelector('.tab[data-view="notes"]').click()); await page.waitForTimeout(500);
  const card = page.locator(`.note-card[data-id="trello-${L}"]`);
  check("the list shows the Trello badge", await card.locator(".note-trello").count() === 1);
  await page.evaluate(() => { window.__opened = []; window.LifeLogPlatform.openOutside = (u) => { window.__opened.push(u); return true; }; });
  await card.locator(".note-trello").click();
  const opened = await page.evaluate(() => window.__opened);
  check("the badge opens the board on Trello", opened.length === 1 && opened[0] === "https://trello.com/b/" + B && await page.locator("#noteSheet.open, .note-sheet.open").count() === 0, opened);
  const where = () => page.evaluate((L) => { const c = document.querySelector(`.note-card[data-id="trello-${L}"]`); return c && c.closest(".year-block").dataset.year; }, L);
  const group = (v) => page.evaluate((v) => { const s = document.querySelector("#noteTrelloGroup"); s.value = v; s.dispatchEvent(new Event("change")); }, v);
  const inMonth = () => page.waitForFunction((L) => { const c = document.querySelector(`.note-card[data-id="trello-${L}"]`); return c && /^\d{4}$/.test(c.closest(".year-block").dataset.year); }, L, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction((L) => { const c = document.querySelector(`.note-card[data-id="trello-${L}"]`); return c && c.closest(".year-block").dataset.year === "trello"; }, L, { timeout: 5000 }).catch(() => {});
  const order = await page.$$eval(".year-block", (xs) => [...new Set(xs.map((x) => x.dataset.year))]);
  check("by default the lists are Separate: a Trello block after Favourites, before the years", await where() === "trello" && order[0] === "favourites" && order[1] === "trello", { at: await where(), order });
  await group("off"); await inMonth();
  check("View → Trello lists → In their months puts it in its month", /^\d{4}$/.test(await where()), await where());
  await group("on");
  await page.waitForFunction((L) => { const c = document.querySelector(`.note-card[data-id="trello-${L}"]`); return c && c.closest(".year-block").dataset.year === "trello"; }, L, { timeout: 5000 }).catch(() => {});
  check("and Separate again, back in the Trello block", await where() === "trello", await where());
  await card.locator(".todo-row", { hasText: "Order the sink" }).locator(".todo-check").first().click();
  await until(() => sent.length);
  check("a tick marks the card complete a few seconds later", sent.some((s) => s.method === "PUT" && s.path === "/cards/" + C1 && s.body.dueComplete === true), sent);

  await card.locator(".note-list-compose input").fill("Call the plumber");
  await card.locator(".note-list-compose input").press("Enter");
  await until(() => sent.some((x) => x.method === "POST"));
  await page.waitForFunction(() => JSON.stringify(window.LifeLogStorage.cachedCopy().notes).includes("9".repeat(24)), null, { timeout: 5000 }).catch(() => {});
  check("a task added there becomes a card on the list", sent.some((s) => s.method === "POST" && s.path === "/cards" && s.body.name === "Call the plumber" && s.body.idList === L), sent);
  d = await data();
  const added = d.notes.find((x) => x.id === "trello-" + L).items.find((x) => x.text === "Call the plumber");
  check("and is linked to it", added && added.trello && added.trello.card === "9".repeat(24), added);

  // Polish (2026-11-22): the badge is a bare icon like the star, no open
  // count beside them, and a ring turns round it while a sync runs.
  const head = await card.locator(".note-list-head").evaluate((h) => ({
    badge: h.querySelector(".note-trello").textContent.trim(), count: !!h.querySelector(".mc"),
    bg: getComputedStyle(h.querySelector(".note-trello")).backgroundColor, border: getComputedStyle(h.querySelector(".note-trello")).borderTopWidth,
    size: [h.querySelector(".note-trello .ico"), h.querySelector(".note-fav .ico")].map((i) => Math.round(i.getBoundingClientRect().width)),
  }));
  check("the badge is a bare icon the star's size, and no count sits beside them",
    head.badge === "" && !head.count && /rgba\(0, 0, 0, 0\)|transparent/.test(head.bg) && head.border === "0px" && head.size[0] === head.size[1], head);
  slow = 1500;
  await page.evaluate(() => { window.__sync = window.LifeLogTrello.check(); });
  await page.waitForTimeout(300);
  const spinning = await card.locator(".note-trello").evaluate((b) => b.classList.contains("is-syncing") && getComputedStyle(b.querySelector(".note-trello-ring")).animationName);
  await page.evaluate(() => window.__sync);
  slow = 0;
  const still = await card.locator(".note-trello").evaluate((b) => b.classList.contains("is-syncing"));
  check("while it syncs the ring turns round the badge, and stops after", spinning === "ico-spin" && !still, { spinning, still });

  // Selecting synced lists: Sync and Remove, not Delete. Remove keeps the
  // cards on Trello and stops syncing; Undo brings both back.
  await card.locator(".note-list-head").click({ button: "right" });
  await page.click('.ctx-menu:not([hidden]) button:text-is("Select")');
  await page.waitForSelector(".bulk-bar");
  const bar = await page.$$eval(".bulk-bar .btn", (xs) => xs.map((x) => x.textContent.trim()));
  check("the bar offers Sync and Remove for a synced list, no Delete", bar.includes("Sync") && bar.includes("Remove") && !bar.includes("Delete"), bar);
  const before = sent.length;
  await page.click('.bulk-bar .btn:text-is("Sync")');
  await page.waitForSelector('.toast:has-text("Trello")', { timeout: 5000 }).catch(() => {});
  check("Sync syncs now", /Trello/.test(await page.locator(".toast").last().textContent().catch(() => "")), sent.length - before);
  await page.click('.bulk-bar .btn:text-is("Remove")');
  await page.waitForTimeout(300);
  d = await data();
  check("Remove takes it out of LifeLog and stops syncing, sending nothing to Trello",
    !d.notes.some((x) => x.id === "trello-" + L) && !d.settings.trello.lists.length && sent.length === before && cards.get(C2).closed === false, { lists: d.settings.trello.lists, sent: sent.slice(before) });
  await page.click('.toast:has-text("Trello") .toast-action');
  await page.waitForFunction((L) => (window.LifeLogStorage.cachedCopy().notes || []).some((x) => x.id === "trello-" + L), L, { timeout: 3000 }).catch(() => {});
  d = await data();
  check("and Undo brings the list back, synced", d.notes.some((x) => x.id === "trello-" + L && x.items.length === 3) && d.settings.trello.lists.length === 1, d.settings.trello.lists);

  await page.evaluate(() => window.LifeLogSettings.openSettings("conn-trello"));
  await page.waitForSelector("#trelloLists .sitem", { timeout: 5000 }).catch(() => {});
  check("the account line names who's signed in", /@reader/.test(await page.textContent("#trelloState")));
  const rows = await page.$$eval("#trelloLists .sitem", (xs) => xs.map((x) => x.querySelector(".sitem-title").textContent + ":" + x.querySelector("input").checked));
  check("Settings shows the board's switches, then its lists, the picked one on", rows.join() === "Bring in this board:true,One task list for the board:false,To do:true,Later:false", rows);
  const status = await page.evaluate(() => window.LifeLogConnections.status("trello").text);
  check("the Connections row says what it's doing", /@reader · 1 list$/.test(status), status);

  await page.locator("#trelloLists .sitem", { hasText: "To do" }).locator("input").click({ force: true });
  await page.waitForTimeout(300);
  d = await data();
  check("turning a list off takes its task list out of the Notebook", !d.notes.some((x) => x.trello && x.trello.list === L) && !d.settings.trello.lists.length, d.notes.map((x) => x.id));
  await page.click(".toast-action");
  await page.waitForFunction((L) => (window.LifeLogStorage.cachedCopy().notes || []).some((x) => x.id === "trello-" + L), L, { timeout: 3000 }).catch(() => {});
  d = await data();
  check("and Undo puts the list and its tasks back", d.notes.some((x) => x.id === "trello-" + L && x.items.length === 3) && d.settings.trello.lists.length === 1, d.settings.trello.lists);
  await page.click("#trelloSignOutBtn"); await page.waitForTimeout(500);
  d = await data();
  check("Sign out forgets the token and keeps the task list", !d.settings.trello.token && d.notes.some((x) => x.id === "trello-" + L));

  await b.close();
  done(errs);
})();
