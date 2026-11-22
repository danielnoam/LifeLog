// A Trello board as one task list (Nov 2026): a board's picked lists come
// in as one task list with each list a section, a section folds, the task
// sheet's Trello list moves a card between lists, a tick moves it to the
// board's Done list, and Settings → Trello has the board's switches. The
// board's "One task list for the board" switch splits it into a task list
// per list and back. Phone and wide, English and Hebrew.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const T = "2026-01-01T00:00:00.000Z";
const L1 = "a".repeat(24), L2 = "d".repeat(24), DONE = "f".repeat(24), B = "b".repeat(24), ME = "c".repeat(24), C1 = "1".repeat(24), C2 = "2".repeat(24), C3 = "3".repeat(24);

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const card = (id, list, name) => [id, { id, idList: list, idBoard: B, name, desc: "", due: null, dueComplete: false, closed: false, idLabels: [], idMembers: [ME], checklists: [], dateLastActivity: T }];
  const cards = new Map([card(C1, L1, "Order the sink"), card(C2, L1, "Pick tiles"), card(C3, L2, "Paint the ceiling")]);
  const sent = [];
  const until = async (ok, ms = 10000) => { for (const end = Date.now() + ms; Date.now() < end && !ok();) await new Promise((r) => setTimeout(r, 100)); };
  const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
  const LISTS = [{ id: L1, name: "To do" }, { id: L2, name: "Doing" }, { id: DONE, name: "Done" }];
  await page.route("https://api.trello.com/**", async (r) => {
    const req = r.request();
    const p = new URL(req.url()).pathname.replace(/^\/1/, "");
    if (req.method() === "OPTIONS") return r.fulfill({ status: 200, headers: { ...cors, "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, PUT, POST, DELETE" }, body: "" });
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    if (req.method() !== "GET") sent.push({ method: req.method(), path: p, body });
    let out = null, m;
    if (p === "/members/me") out = { id: ME, username: "reader" };
    else if (p === "/members/me/boards") out = [{ id: B, name: "Kitchen", lists: LISTS }];
    else if ((m = /^\/lists\/(\w+)\/cards$/.exec(p))) out = [...cards.values()].filter((c) => c.idList === m[1] && !c.closed);
    else if (p === `/boards/${B}/labels`) out = [];
    else if (p === `/boards/${B}/lists`) out = LISTS;
    else if (req.method() === "PUT" && p.startsWith("/cards/")) { const c = cards.get(p.split("/")[2]); Object.assign(c, body); out = c; }
    else if (req.method() === "GET" && p.startsWith("/cards/")) out = cards.get(p.split("/")[2]);
    if (!out) return r.fulfill({ status: 404, headers: cors, body: "not found" });
    r.fulfill({ status: 200, headers: cors, body: JSON.stringify(out) });
  });
  await page.route(/^https:\/\/(?!api\.trello\.com\/)/, (r) => r.abort());
  await page.goto(BASE + "/", { waitUntil: "load" });
  await forgetCopy(page);
  await page.evaluate(({ T, L1, L2, B, ME }) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify({
    categories: [], entries: [], backlog: [], habits: [], notes: [],
    settings: { trello: { key: "k".repeat(32), token: "tok", member: { id: ME, username: "reader" }, connectedAt: T, lists: [{ id: L1, name: "To do", board: B, boardName: "Kitchen" }, { id: L2, name: "Doing", board: B, boardName: "Kitchen" }] } } })); }, { T, L1, L2, B, ME });
  await page.reload({ waitUntil: "load" });
  const ID = "trello-board-" + B;
  await page.waitForFunction((ID) => (window.LifeLogStorage.cachedCopy().notes || []).some((x) => x.id === ID && x.items.length === 3), ID, { timeout: 10000 }).catch(() => {});
  const data = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());

  let d = await data();
  const n = d.notes.find((x) => x.id === ID);
  check("the board comes in as one task list named for it", d.notes.filter((x) => x.trello).length === 1 && n && n.text === "Kitchen", d.notes.map((x) => x.id));
  check("its lists are its sections, each task in its own", n && n.sections.map((s) => s.name).join() === "To do,Doing" && n.items.map((x) => x.section === L1 ? 1 : 2).join() === "1,1,2", n);

  await page.evaluate(() => document.querySelector('.tab[data-view="notes"]').click()); await page.waitForTimeout(500);
  const el = page.locator(`.note-card[data-id="${ID}"]`);
  const shown = () => el.evaluate((c) => [...c.querySelectorAll(".note-list-rows > *")].map((x) => x.classList.contains("todo-section") ? "#" + x.querySelector(".todo-section-name").textContent + x.querySelector(".todo-section-n").textContent : x.querySelector(".todo-text") ? x.querySelector(".todo-text").textContent : ""));
  check("the card shows each section's name and open count over its tasks", (await shown()).join("|") === "#To do2|Order the sink|Pick tiles|#Doing1|Paint the ceiling", await shown());
  const hit = await el.locator(".todo-section").first().boundingBox();
  check("a section's name is a 44px tap target on a phone", hit && hit.height >= 44, hit);
  await el.locator(".todo-section", { hasText: "To do" }).click();
  check("pressing a section's name folds it", (await shown()).join("|") === "#To do2|#Doing1|Paint the ceiling", await shown());
  await el.locator(".todo-section", { hasText: "To do" }).click();

  // The sheet's Trello list moves the card.
  await el.locator(".todo-row", { hasText: "Pick tiles" }).locator(".todo-body").click();
  await page.waitForSelector("#taskModal:not([hidden])");
  const row = await page.evaluate(() => ({ hidden: document.querySelector("#taskSectionRow").hidden, label: document.querySelector("#taskSectionLabel").textContent, opts: [...document.querySelectorAll("#taskSection option")].map((o) => o.textContent) }));
  check("the task sheet has a Trello list row with the board's lists", !row.hidden && row.label === "Trello list" && row.opts.join() === "To do,Doing", row);
  await page.selectOption("#taskSection", L2);
  await page.keyboard.press("Escape");
  await until(() => sent.some((s) => s.path === "/cards/" + C2 && s.body.idList === L2));
  check("changing it moves the card to that list on Trello", cards.get(C2).idList === L2, sent);
  check("and the task now sits under Doing", (await shown()).join("|") === "#To do1|Order the sink|#Doing2|Paint the ceiling|Pick tiles" || (await shown()).join("|") === "#To do1|Order the sink|#Doing2|Pick tiles|Paint the ceiling", await shown());

  // Held and dragged above a To do row, a Doing task moves to To do.
  const from = await el.locator(".todo-row", { hasText: "Paint the ceiling" }).locator(".todo-text").boundingBox();
  const to = await el.locator(".todo-row", { hasText: "Order the sink" }).boundingBox();
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  for (let i = 1; i <= 10; i++) { await page.mouse.move(from.x + 10, from.y + from.height / 2 + (to.y + 4 - from.y - from.height / 2) * i / 10); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll(".note-card.is-reordering .btn-primary")].find((x) => x); if (b) b.click(); });
  await until(() => sent.some((s) => s.path === "/cards/" + C3 && s.body.idList === L1));
  check("dragging a task under another section's name moves its card there", cards.get(C3).idList === L1, await shown());

  await el.locator(".todo-row", { hasText: "Order the sink" }).locator(".todo-check").first().click();
  await until(() => sent.some((s) => s.path === "/cards/" + C1 && s.body.idList === DONE));
  check("a tick moves the card to the board's Done list", cards.get(C1).idList === DONE, sent.filter((s) => s.path === "/cards/" + C1));

  // Wide: the same sections.
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(300);
  check("wide, the sections are there too", (await shown()).some((x) => x.startsWith("#Doing")), await shown());
  await page.setViewportSize({ width: 390, height: 844 });

  await page.evaluate(() => window.LifeLogSettings.openSettings("conn-trello"));
  await page.waitForSelector("#trelloLists .sitem", { timeout: 5000 }).catch(() => {});
  const rows = await page.$$eval("#trelloLists .sitem", (xs) => xs.map((x) => x.querySelector(".sitem-title").textContent + ":" + (x.querySelector("input") ? x.querySelector("input").checked : x.querySelector(".sitem-sub").textContent)));
  check("Settings: the board's switch, One task list, its lists, and Done with no switch", rows.join() === "Bring in this board:true,One task list for the board:true,To do:true,Doing:true,Done:Ticked tasks move here", rows);
  const sent0 = sent.length;
  await page.locator("#trelloLists .sitem", { hasText: "One task list for the board" }).locator("input").click({ force: true });
  await page.waitForFunction((L1) => (window.LifeLogStorage.cachedCopy().notes || []).some((x) => x.id === "trello-" + L1), L1, { timeout: 5000 }).catch(() => {});
  d = await data();
  check("turned off, the board is a task list per list, with the same tasks", !d.notes.some((x) => x.id === ID) && d.notes.find((x) => x.id === "trello-" + L2).items.map((x) => x.text).sort().join() === "Pick tiles", d.notes.map((x) => x.id));
  await page.locator("#trelloLists .sitem", { hasText: "One task list for the board" }).locator("input").click({ force: true });
  await page.waitForFunction((ID) => (window.LifeLogStorage.cachedCopy().notes || []).some((x) => x.id === ID), ID, { timeout: 5000 }).catch(() => {});
  d = await data();
  check("and on again, one task list, nothing sent to Trello either way", d.notes.filter((x) => x.trello).length === 1 && d.notes.find((x) => x.id === ID).items.filter((x) => !x.done).length === 2 && sent.length === sent0, sent.slice(sent0));
  await page.locator("#trelloLists .sitem", { hasText: "Doing" }).locator("input").click({ force: true });
  await page.waitForTimeout(300);
  d = await data();
  check("a list turned off takes its tasks off the board's task list", d.notes.find((x) => x.id === ID).items.every((x) => x.section !== L2), d.notes.find((x) => x.id === ID).items);
  await page.click(".toast-action"); await page.waitForTimeout(300);
  d = await data();
  check("and Undo puts them back", d.notes.find((x) => x.id === ID).items.some((x) => x.section === L2) && d.settings.trello.lists.length === 2, d.settings.trello.lists);

  // Hebrew.
  await page.evaluate(() => { const v = JSON.parse(localStorage.getItem("lifelog-visual-settings-v1") || "{}"); v.language = "he"; localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v)); localStorage.setItem("lifelog.lang", "he"); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" })); });
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(`.note-card[data-id="${ID}"]`, { timeout: 8000 }).catch(() => {});
  const he = await page.locator(`.note-card[data-id="${ID}"] .todo-section`).first().getAttribute("aria-label");
  check("in Hebrew the section's label is Hebrew", /^(הסתרת|הצגת) /.test(he || ""), he);
  await page.locator(`.note-card[data-id="${ID}"] .todo-row .todo-body`).first().click();
  await page.waitForSelector("#taskModal:not([hidden])");
  check("and so is the sheet's Trello list row", (await page.textContent("#taskSectionLabel")) === "רשימת Trello", await page.textContent("#taskSectionLabel"));
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.LifeLogSettings.openSettings("conn-trello"));
  await page.waitForSelector("#trelloLists .sitem", { timeout: 5000 }).catch(() => {});
  const heRows = await page.$$eval("#trelloLists .sitem .sitem-title", (xs) => xs.map((x) => x.textContent));
  check("and Settings' board switches", heRows[0] === "להביא את הלוח" && heRows[1] === "רשימת משימות אחת ללוח", heRows);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  // Every card gone from the board: its lists still show, empty.
  cards.clear();
  await page.evaluate(() => window.LifeLogTrello.check({ manual: true }));
  await page.waitForTimeout(500);
  check("a board with no tasks still shows each of its lists", (await shown()).filter((x) => x.startsWith("#")).join("|") === "#To do0|#Doing0", await shown());

  await b.close();
  done(errs);
})();
