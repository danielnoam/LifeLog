// Board tools (Nov 2026): the options in ⋯ (grid, snap, guides, sticky
// arrows, pen smoothing, kept per device), arrows that follow the shapes
// they stick to, guides while moving, group and lock, Link to… and its
// icon, cropping a picture, board text in search, and the top bar's Tags.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const DATA = { categories: [], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {}, noteCategories: [{ name: "Ideas" }],
  notes: [{ id: "n1", title: "Route notes", text: "North loop, 12 km", createdAt: "2026-11-01T10:00:00.000Z" }] };
const T0 = "2026-11-01T10:00:00.000Z";
const BOARD = { id: "bt", name: "Trip", createdAt: T0, updatedAt: T0, elements: [
  { id: "A", t: "rect", x: 0, y: 0, w: 200, h: 120, c: "ink", sw: 2, seed: 1 },
  { id: "B", t: "rect", x: 400, y: 200, w: 200, h: 120, c: "ink", sw: 2, seed: 2 },
  { id: "C", t: "rect", x: 0, y: 400, w: 120, h: 80, c: "ink", sw: 2, seed: 3 },
  { id: "tx", t: "text", x: 420, y: 40, sw: 4, c: "ink", text: "Camp by the lake" },
  { id: "pic", t: "img", x: 700, y: 0, w: 200, h: 100, url: "https://example.invalid/a.png" },
] };

async function run(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 800 } });
  await ctx.route(/example\.invalid/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource|ERR_FAILED|example\.invalid/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((data) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "boards" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(data));
  }, DATA);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.evaluate(async (board) => { await window.LifeLogBoards.addBoards([board]); window.LifeLogBoards.openBoard("bt"); }, BOARD);
  await page.waitForTimeout(400);
  const at = " (" + width + "px)";
  const els = () => page.evaluate(() => JSON.parse(JSON.stringify(window.LifeLogBoards.allBoards().find((x) => x.id === "bt").elements)));
  const el = async (id) => (await els()).find((e) => e.id === id);
  const box = (id) => page.evaluate((i) => { const r = document.querySelector(`#boardSvg .board-world [data-id="${i}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, id);
  const tool = (t) => page.click(`#boardTools [data-tool="${t}"]`);
  const drag = async (x1, y1, x2, y2, opts = {}) => {
    if (opts.shift) await page.keyboard.down("Shift");
    await page.mouse.move(x1, y1); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8);
    if (opts.during) await opts.during();
    await page.mouse.up();
    if (opts.shift) await page.keyboard.up("Shift");
    await page.waitForTimeout(80);
  };

  // ---- top bar ----
  const tagsItemShown = () => page.evaluate(() => { const i = document.querySelector("#boardTagsItem"); document.querySelector("#boardMenu").hidden = false; const v = getComputedStyle(i).display !== "none"; document.querySelector("#boardMenu").hidden = true; return v; });
  if (width > 720) {
    check("on a wide screen ⋯ has no Tags… when the Tags button shows" + at, !(await tagsItemShown()));
    check("the category box is as tall as the name" + at, await page.evaluate(() => document.querySelector("#boardCategory").offsetHeight === document.querySelector("#boardName").offsetHeight));
  } else check("on a phone Tags… is in ⋯" + at, await tagsItemShown());

  // ---- options ----
  await page.click("#boardMenuBtn");
  check("⋯ has the board options, guides and sticky arrows on by default" + at, await page.evaluate(() => {
    const v = (k) => document.querySelector(`#boardOpts [data-opt="${k}"]`).checked;
    return !v("grid") && !v("snap") && v("guides") && v("stick") && v("smooth");
  }));
  await page.click('#boardOpts label:has([data-opt="grid"])');
  check("Grid draws the grid and is kept for this device" + at, await page.evaluate(() => document.querySelector("#boardSvg").classList.contains("board-grid")
    && JSON.parse(localStorage.getItem("lifelog-board-opts-v1")).grid === true));
  check("the menu stays open while switching" + at, await page.evaluate(() => !document.querySelector("#boardMenu").hidden));
  await page.click('#boardOpts label:has([data-opt="grid"])');
  await page.keyboard.press("Escape");

  // ---- sticky arrows ----
  await tool("arrow");
  let a = await box("A"), bb = await box("B");
  await drag(a.cx, a.cy, bb.cx, bb.cy);
  let arrow = (await els()).find((e) => e.t === "arrow");
  check("an arrow drawn from one shape to another sticks to both" + at, !!arrow && arrow.b1 && arrow.b1.id === "A" && arrow.b2 && arrow.b2.id === "B", JSON.stringify(arrow));
  await tool("select");
  bb = await box("B");
  const before = await el("B");
  await drag(bb.x + 2, bb.cy, bb.x + 2 + 80, bb.cy + 60);
  const B2 = await el("B");
  arrow = (await els()).find((e) => e.t === "arrow");
  check("moving the shape moves it" + at, B2.x !== before.x || B2.y !== before.y);
  check("and the arrow's end follows it" + at, Math.abs(arrow.x2 - (B2.x + B2.w * arrow.b2.fx)) <= 1 && Math.abs(arrow.y2 - (B2.y + B2.h * arrow.b2.fy)) <= 1, JSON.stringify([arrow, B2]));

  // ---- guides ----
  let c = await box("C"), aa = await box("A");
  let sawGuide = false;
  await drag(c.x + 1, c.cy, aa.x + 4 + 1, c.cy - 30, { during: async () => { sawGuide = await page.evaluate(() => !!document.querySelector("#boardSvg .board-guide")); } });
  check("moving near another shape's edge shows a guide" + at, sawGuide);
  check("and lands lined up with it" + at, (await el("C")).x === (await el("A")).x, JSON.stringify([await el("C"), await el("A")]));

  // ---- group ----
  await page.keyboard.press("Escape");
  aa = await box("A"); c = await box("C");
  await page.mouse.click(aa.x + 1, aa.cy);
  await page.keyboard.down("Shift"); await page.mouse.click(c.x + 1, c.cy); await page.keyboard.up("Shift");
  await page.click("#boardGroup");
  check("Group gives both the same group" + at, (await el("A")).gp && (await el("A")).gp === (await el("C")).gp);
  await page.keyboard.press("Escape");
  await page.mouse.click(aa.x + 1, aa.cy);
  const selN = await page.evaluate(() => document.querySelectorAll("#boardSvg .board-overlay rect.board-sel:not(.board-sel-group)").length);
  check("picking one of the group picks both" + at, selN === 2, String(selN));

  // ---- lock ----
  await page.keyboard.press("Escape");
  await page.mouse.click(c.x + 1, c.cy);
  await page.click("#boardLock");
  check("Lock locks the group" + at, (await el("A")).lk === true && (await el("C")).lk === true);
  const lockedAt = await el("A");
  aa = await box("A");
  await drag(aa.x + 1, aa.cy, aa.x + 101, aa.cy + 50);
  check("a locked shape doesn't move" + at, (await el("A")).x === lockedAt.x && (await el("A")).y === lockedAt.y);
  await page.mouse.click(aa.x + 1, aa.cy);
  await page.keyboard.press("Delete");
  check("or delete" + at, !!(await el("A")));
  check("and shows its lock" + at, await page.evaluate(() => !!document.querySelector("#boardSvg .board-lock-badge")));
  await page.click("#boardLock");
  check("Unlock frees it again" + at, !(await el("A")).lk);

  // ---- link ----
  await page.keyboard.press("Escape");
  const t = await box("tx");
  await page.mouse.click(t.cx, t.cy);
  await page.click("#boardLink");
  await page.fill("#boardLinkQuery", "route");
  check("Link to… finds the note by name" + at, await page.evaluate(() => /Route notes/.test(document.querySelector("#boardLinkList").textContent)));
  await page.keyboard.press("Enter");
  check("picking it links the text" + at, (await el("tx")).ln === "note:n1");
  check("and draws its link icon" + at, await page.evaluate(() => !!document.querySelector("#boardSvg .board-link-badge:not(.is-missing)")));
  const badge = await page.evaluate(() => { const r = document.querySelector("#boardSvg .board-link-badge").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(badge.x, badge.y);
  await page.waitForTimeout(500);
  check("tapping the icon opens the note" + at, await page.evaluate(() => !document.querySelector("#noteReader").hidden && /Route notes/.test(document.querySelector("#noteReaderTitle").textContent)
    && document.querySelector("#boardEditor").hidden));
  await page.click("#closeNoteReaderBtn");
  await page.waitForTimeout(300);

  // ---- board text in search ----
  check("a board's text is searchable" + at, await page.evaluate(() => window.LifeLogNotes.searchable().some((n) => n.kind === "board" && /lake/.test(n.boardText || ""))));

  // ---- crop ----
  await page.evaluate(() => window.LifeLogBoards.openBoard("bt"));
  await page.waitForTimeout(300);
  await tool("select");
  const p = await box("pic");
  await page.mouse.click(p.cx, p.cy);
  await page.click("#boardCrop");
  check("Crop shows the whole picture behind and the crop handles" + at, await page.evaluate(() => document.querySelectorAll("#boardSvg .board-crop-handle").length === 4));
  const h = await page.evaluate(() => { const r = document.querySelector('#boardSvg .board-crop-handle[data-handle="nw"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await drag(h.x, h.y, h.x + (p.w / 2), h.y + (p.h / 2));
  const pic = await el("pic");
  check("dragging a corner crops it" + at, Array.isArray(pic.cr) && pic.cr[0] > 0.3 && pic.cr[1] > 0.3 && pic.w < 200, JSON.stringify(pic));
  await page.click("#boardCrop");
  check("Done ends cropping" + at, await page.evaluate(() => !document.querySelector("#boardSvg .board-crop-handle")));

  check("no errors" + at, errs.length === 0, errs.join("\n"));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  try { await run(b, 1280); await run(b, 700); }
  finally { await b.close(); }
  done();
})();
