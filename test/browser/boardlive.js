// Live things on a board (Nov 2026): a note, quote or task as a card that
// shows it as it is and is edited in place (ticks, text), a YouTube player
// that loads nothing until tapped, a Home panel, and the calendar's
// big covers switch on Home. Also a player link in a note's Read view.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const T0 = "2026-11-01T10:00:00.000Z";
const DATA = { categories: [{ name: "Books", color: "#2f9e44" }], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {}, noteCategories: [],
  notes: [
    { id: "n1", title: "Weekend loaf", text: "500 g flour\n\n- Mix\n- Rest", createdAt: T0 },
    { id: "q1", kind: "quote", text: "Less, but better.", author: "Dieter Rams", createdAt: T0 },
    { id: "l1", kind: "list", text: "Packing", items: [{ id: "a", text: "Socks" }, { id: "b", text: "Charger" }], createdAt: T0 },
    { id: "v1", title: "Watch", text: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", createdAt: T0 },
  ] };

async function run(b, width) {
  const errs = [], outside = [];
  const ctx = await b.newContext({ viewport: { width, height: 800 }, hasTouch: width < 600 });
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1)/, (r) => { outside.push(r.request().url()); r.abort(); });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource|ERR_FAILED|youtube/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((data) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "boards" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(data));
  }, DATA);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.evaluate(async () => { await window.LifeLogBoards.addBoards([{ id: "bl", name: "Live", elements: [] }]); window.LifeLogBoards.openBoard("bl"); });
  await page.waitForTimeout(300);
  const at = " (" + width + "px)";
  const els = () => page.evaluate(() => JSON.parse(JSON.stringify(window.LifeLogBoards.allBoards().find((x) => x.id === "bl").elements)));
  const add = async (kind) => {
    if (width <= 480) { await page.click(".board-add-more"); await page.click(`#boardAddMenu button:nth-child(${["card", "embed", "panel"].indexOf(kind) + 1})`); }
    else await page.click(`#boardTools [data-tool="${kind}"]`);
    await page.waitForTimeout(150);
  };
  const fit = async () => { await page.keyboard.press("Escape"); await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press("0"); await page.waitForTimeout(150); };

  // ---- cards ----
  await add("card");
  check("Card lists notes, quotes, lists and their open tasks" + at, await page.evaluate(() => {
    const t = document.querySelector("#boardLinkList").textContent;
    return /Weekend loaf/.test(t) && /Less, but better/.test(t) && /Packing/.test(t) && /Charger/.test(t);
  }));
  await page.fill("#boardLinkQuery", "packing");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  let list = (await els()).find((e) => e.t === "card");
  check("picking a list adds its card, selected" + at, !!list && list.ref === "l1" && !list.item);
  check("the card shows the list's tasks" + at, await page.evaluate(() => [...document.querySelectorAll(".board-live-card .board-task-text")].map((x) => x.textContent).join(",") === "Socks,Charger"));
  await page.click(".board-live-card .board-tick >> nth=0");
  await page.waitForTimeout(300);
  check("ticking on the card ticks the task" + at, await page.evaluate(() => window.LifeLogStorage.cachedCopy().notes.find((n) => n.id === "l1").items.find((i) => i.id === "a").done === true));
  check("and the card shows it ticked" + at, await page.evaluate(() => document.querySelector(".board-live-card .board-task").classList.contains("is-done")));

  await add("card");
  await page.fill("#boardLinkQuery", "loaf");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await fit();
  const noteCard = page.locator(".board-live-card:has-text('Weekend loaf') .board-live-body");
  check("a note's card shows its Markdown" + at, await page.evaluate(() => [...document.querySelectorAll(".board-live-card")].some((c) => /Weekend loaf/.test(c.textContent) && c.querySelector(".board-card-md li"))));
  await noteCard.dblclick();
  await page.waitForTimeout(150);
  check("double-clicking the card edits its text in place" + at, await page.evaluate(() => !!document.querySelector(".board-card-edit")));
  await page.fill(".board-card-edit", "600 g flour");
  await page.evaluate(() => document.querySelector(".board-card-edit").blur());
  await page.waitForTimeout(400);
  check("leaving it saves the note" + at, await page.evaluate(() => window.LifeLogStorage.cachedCopy().notes.find((n) => n.id === "n1").text === "600 g flour"));
  check("and the card shows the new words" + at, await page.evaluate(() => [...document.querySelectorAll(".board-live-card")].some((c) => /600 g flour/.test(c.textContent))));

  // ---- player ----
  await add("embed");
  await page.fill("#boardLinkQuery", "https://example.com/video");
  check("a link from another site isn't offered" + at, await page.evaluate(() => /isn't a YouTube/.test(document.querySelector("#boardLinkList").textContent)));
  await page.fill("#boardLinkQuery", "https://youtu.be/dQw4w9WgXcQ");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check("a YouTube link adds a player" + at, (await els()).some((e) => e.t === "embed" && e.url === "https://youtu.be/dQw4w9WgXcQ"));
  check("which loads nothing until tapped" + at, !document_has_iframe(await page.content()) && !outside.some((u) => /youtube/.test(u)), outside.join(" "));
  await fit();
  await page.click(".board-live-embed .board-play");
  await page.waitForTimeout(300);
  check("tapping it loads the privacy-enhanced player" + at, await page.evaluate(() => /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test((document.querySelector(".board-live-embed iframe") || {}).src || "")));

  // ---- panel ----
  await add("panel");
  await page.fill("#boardLinkQuery", "calendar");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("a Home panel goes on the board, live" + at, (await els()).some((e) => e.t === "panel" && e.kind === "calendar") && await page.evaluate(() => !!document.querySelector(".board-live-panel .home-cal-grid")));
  check("the player kept playing while the board changed" + at, await page.evaluate(() => !!document.querySelector(".board-live-embed iframe")));

  // ---- the thumbnail still says what's there ----
  await page.click("#boardBack");
  await page.waitForTimeout(400);
  check("the board's thumbnail draws each as a named box" + at, await page.evaluate(() => document.querySelectorAll(".board-card .board-still, .board-thumb-svg .board-still").length >= 3));

  // ---- a note's player ----
  await page.evaluate(() => window.LifeLogNotes.openNoteReader("v1"));
  await page.waitForTimeout(200);
  check("a YouTube link on its own line in a note is a player to tap" + at, await page.evaluate(() => !!document.querySelector("#noteReaderBody .note-player .board-play")));
  await page.click("#closeNoteReaderBtn");

  // ---- calendar big covers on Home ----
  if (width > 720) {
    await page.evaluate(() => { const v = JSON.parse(localStorage.getItem("lifelog-visual-settings-v1") || "{}"); v.homeFloors = [["calendar"]]; localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(v)); });
    await page.evaluate(() => { const u = JSON.parse(localStorage.getItem("lifelog-ui-v1")); u.view = "home"; localStorage.setItem("lifelog-ui-v1", JSON.stringify(u)); });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.click(".home-calendar .home-cal-grid", { button: "right" });
    await page.waitForTimeout(150);
    check("right-clicking the calendar offers Show big covers" + at, await page.evaluate(() => /Show big covers/.test((document.querySelector(".ctx-menu, #ctxMenu, .context-menu") || document.body).textContent)));
    await page.click("text=Show big covers");
    await page.waitForTimeout(200);
    check("which switches it to big covers, kept for this device" + at, await page.evaluate(() => !!document.querySelector(".home-cal.is-covers") && JSON.parse(localStorage.getItem("lifelog-visual-settings-v1")).homeCalCovers === true));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click(".home-calendar .home-cal-head", { button: "right" });
    await page.waitForTimeout(200);
    await page.evaluate(() => [...document.querySelectorAll("button[role=menuitem]")].find((b) => /Show names/.test(b.textContent)).click());
    await page.waitForTimeout(200);
    check("and back to names" + at, await page.evaluate(() => !document.querySelector(".home-cal.is-covers")));
  }

  check("no errors" + at, errs.length === 0, errs.join("\n"));
  await ctx.close();
}
function document_has_iframe(html) { return /<iframe/i.test(html); }

(async () => {
  const b = await chromium.launch();
  try { await run(b, 1280); await run(b, 390); }
  finally { await b.close(); }
  done();
})();
