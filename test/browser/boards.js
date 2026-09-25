// Drawing boards (0.193.0): the Notes tab's Boards mode and its editor,
// driven with a real mouse and with touch pointers — drawing, selecting,
// moving, erasing, undo, text, pinch zoom — then what's kept: the board
// survives a reload, never lands in lifelog.json, exports as PNG/SVG and in
// the Notes JSON, and syncs as boards.json against a fake GitHub, including
// the merge when another device saved first.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const EMPTY = { categories: [], entries: [], accomplishments: {}, backlog: [], notes: [], todos: [], todoCategories: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {} };
const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "t0ken", sha: null };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boards-"));

  async function open({ gh = null, width = 1280, height = 800, touch = false } = {}) {
    const ctx = await b.newContext({ viewport: { width, height }, acceptDownloads: true, hasTouch: touch });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
    const github = { files: {}, puts: [], conflictOnce: null };
    await page.route("https://api.github.com/**", async (route) => {
      const req = route.request(), url = req.url();
      const say = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (/\/user$/.test(url)) return say(200, { login: "someone" });
      if (/\/repos\/someone\/lifelog-data$/.test(url)) return say(200, { default_branch: "main" });
      if (/\/commits/.test(url)) return say(200, []);
      const m = url.match(/\/contents\/([^?]+)/);
      if (!m) return say(404, { message: "Not Found" });
      const file = decodeURIComponent(m[1]);
      const cur = github.files[file];
      if (req.method() === "PUT") {
        const body = JSON.parse(req.postData());
        const data = JSON.parse(Buffer.from(body.content, "base64").toString());
        if (github.conflictOnce && file === github.conflictOnce.file) {
          // Another device saved first: its copy lands, and this one is stale.
          github.files[file] = { data: github.conflictOnce.data, sha: "other" };
          github.conflictOnce = null;
          return say(409, { message: "sha mismatch" });
        }
        if (cur && body.sha !== cur.sha) return say(409, { message: "sha mismatch" });
        if (!cur && body.sha) return say(422, { message: "sha given for a new file" });
        const sha = "s" + (github.puts.length + 1);
        github.files[file] = { data, sha };
        github.puts.push({ file, data });
        return say(200, { content: { sha } });
      }
      if (!cur) return say(404, { message: "Not Found" });
      const b64 = Buffer.from(JSON.stringify(cur.data)).toString("base64");
      return say(200, { sha: cur.sha, size: b64.length, encoding: "base64", content: b64 });
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(({ data, gh }) => {
      localStorage.clear();
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "boards" }));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(data));
      if (gh) localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
    }, { data: EMPTY, gh });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    return { ctx, page, github };
  }
  const els = (page) => page.evaluate(() => {
    const id = document.querySelector("#boardEditor").hidden ? null : true;
    const bs = window.LifeLogBoards.boardsNow();
    return id && bs.length ? bs[bs.length - 1].elements : bs.map((x) => x.elements).flat();
  });
  const stroke = async (page, pts) => {
    await page.mouse.move(...pts[0]); await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...p);
    await page.mouse.up();
  };

  // ---- drawing with a mouse ----
  {
    const { ctx, page } = await open();
    check("an empty Boards mode offers to make one",
      await page.evaluate(() => /No boards yet/.test(document.querySelector("#viewBody").textContent)));
    await page.click("text=+ New board");
    await page.waitForTimeout(200);
    check("a new board opens full screen", await page.evaluate(() => !document.querySelector("#boardEditor").hidden));

    const samples = Array.from({ length: 60 }, (_, i) => [200 + i * 6, 250 + Math.round(Math.sin(i / 6) * 50)]);
    await stroke(page, samples);
    let list = await els(page);
    check("a pen stroke is one element, simplified well below its samples",
      list.length === 1 && list[0].t === "pen" && list[0].p.length / 2 < samples.length / 2, { n: list.length, pts: list[0] && list[0].p.length / 2 });

    await page.click('[data-tool="rect"]');
    await stroke(page, [[300, 400], [350, 450], [500, 500]]);
    await page.click('[data-tool="ellipse"]');
    await stroke(page, [[600, 400], [700, 450], [760, 520]]);
    await page.click('[data-tool="arrow"]');
    await stroke(page, [[520, 450], [560, 450], [590, 450]]);
    await page.click('[data-tool="line"]');
    await stroke(page, [[300, 600], [500, 620]]);
    list = await els(page);
    check("rectangle, ellipse, arrow and line each draw one element",
      JSON.stringify(list.map((e) => e.t)) === JSON.stringify(["pen", "rect", "ellipse", "arrow", "line"]), list.map((e) => e.t));
    const rect = list[1];
    check("a rectangle is the size it was dragged to", rect.w === 200 && rect.h === 100, rect);

    // Select the rectangle by its edge, move it, delete it, undo, redo.
    await page.click('[data-tool="select"]');
    await page.mouse.click(300, 450);
    check("tapping a shape's edge selects it", await page.evaluate(() => !document.querySelector("#boardDelete").hidden));
    await stroke(page, [[300, 450], [330, 470], [340, 480]]);
    list = await els(page);
    const movedRect = list.find((e) => e.id === rect.id);
    check("dragging a selection moves it by as much", movedRect.x === rect.x + 40 && movedRect.y === rect.y + 30, { rect, movedRect });
    await page.keyboard.press("Delete");
    check("Delete removes it", !(await els(page)).some((e) => e.id === rect.id));
    await page.keyboard.press("Control+z");
    check("Ctrl+Z brings it back", (await els(page)).some((e) => e.id === rect.id));
    await page.keyboard.press("Control+Shift+z");
    check("Ctrl+Shift+Z takes it away again", !(await els(page)).some((e) => e.id === rect.id));
    await page.keyboard.press("Control+z");

    // Box select everything.
    await stroke(page, [[100, 150], [500, 500], [900, 700]]);
    const selected = await page.evaluate(() => document.querySelectorAll("#boardSvg .board-sel").length);
    check("dragging a box over empty space selects what's inside it", selected === 5, selected);

    // The eraser takes the stroke it's dragged across.
    await page.keyboard.press("Escape");
    await page.click('[data-tool="eraser"]');
    await stroke(page, [[260, 180], [262, 260], [264, 330]]);
    list = await els(page);
    check("the eraser removes the stroke it crosses, and nothing else", !list.some((e) => e.t === "pen") && list.length === 4, list.map((e) => e.t));

    // Text, typed and committed.
    await page.click('[data-tool="text"]');
    await page.mouse.click(250, 700);
    await page.waitForTimeout(100);
    await page.keyboard.type("Plan A");
    await page.keyboard.press("Escape");
    list = await els(page);
    check("the text tool places what you type", list.some((e) => e.t === "text" && e.text === "Plan A"));

    // Colour applies to a selection as well as to what's drawn next.
    await page.click('[data-tool="select"]');
    await page.mouse.click(600, 470);
    await page.click('[data-color="#e03131"]');
    list = await els(page);
    check("a colour picked with something selected recolours it", list.find((e) => e.t === "ellipse").c === "#e03131");

    // Escape: out of the selection, then out of the board.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check("Escape closes the board back to the list", await page.evaluate(() =>
      document.querySelector("#boardEditor").hidden && document.querySelectorAll(".board-card:not(.board-new)").length === 1));
    check("boards never go into lifelog.json", await page.evaluate(() => !("boards" in JSON.parse(localStorage.getItem("lifelog-cache-v1")))));

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => window.LifeLogBoards.boardsNow().map((x) => x.elements.length));
    check("a board survives a reload", JSON.stringify(after) === "[5]", after);

    // Export: PNG and SVG from the board's menu.
    await page.click(".board-card:not(.board-new)");
    await page.waitForTimeout(200);
    const grab = async (id) => {
      await page.click("#boardMenuBtn");
      const [dl] = await Promise.all([page.waitForEvent("download"), page.click(id)]);
      const f = path.join(dir, dl.suggestedFilename());
      await dl.saveAs(f);
      return fs.readFileSync(f);
    };
    const png = await grab("#boardExportPng");
    check("Export PNG writes a real PNG", png.slice(1, 4).toString() === "PNG" && png.length > 1000, png.length);
    const svgText = (await grab("#boardExportSvg")).toString();
    check("Export SVG writes the drawing, text included", /^<svg/.test(svgText) && /Plan A/.test(svgText));

    // And in the Notes tab's JSON, back into a fresh app.
    await page.click("#boardBack");
    await page.evaluate(() => { document.querySelector("#settingsBtn").click(); });
    await page.click('.srow[data-page="io"]');
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-io="export-json"][data-tab="notes"]')]);
    const notesFile = path.join(dir, "notes.json");
    await dl.saveAs(notesFile);
    const exported = JSON.parse(fs.readFileSync(notesFile, "utf8"));
    check("the Notes JSON carries the boards", Array.isArray(exported.boards) && exported.boards[0].elements.length === 5);
    await ctx.close();

    const fresh = await open();
    await fresh.page.evaluate(() => { document.querySelector("#settingsBtn").click(); });
    await fresh.page.click('.srow[data-page="io"]');
    const [chooser] = await Promise.all([fresh.page.waitForEvent("filechooser"), fresh.page.click('[data-io="import-json"][data-tab="notes"]')]);
    await chooser.setFiles(notesFile);
    await fresh.page.waitForSelector("#financePickerModal:not([hidden])");
    await fresh.page.click("#financePickerConfirmBtn");
    await fresh.page.waitForTimeout(600);
    const imported = await fresh.page.evaluate(() => window.LifeLogBoards.boardsNow().map((x) => x.elements.length));
    check("importing the Notes JSON brings the board back", JSON.stringify(imported) === "[5]", imported);
    await fresh.ctx.close();
  }

  // ---- touch: a finger draws, two pinch ----
  {
    const { ctx, page } = await open({ width: 390, height: 844, touch: true });
    await page.click("text=+ New board");
    await page.waitForTimeout(200);
    const pointer = (type, id, x, y) => page.evaluate(({ type, id, x, y }) => {
      document.querySelector("#boardSvg").dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: "touch", clientX: x, clientY: y, bubbles: true, isPrimary: id === 1, button: 0,
      }));
    }, { type, id, x, y });
    await pointer("pointerdown", 1, 100, 300);
    for (let i = 1; i <= 10; i++) await pointer("pointermove", 1, 100 + i * 15, 300 + i * 5);
    await pointer("pointerup", 1, 250, 350);
    check("a finger draws a stroke", (await els(page)).length === 1);
    const scale = () => page.evaluate(() => +/scale\(([\d.]+)\)/.exec(document.querySelector(".board-world").getAttribute("transform"))[1]);
    const k0 = await scale();
    await pointer("pointerdown", 1, 150, 400);
    await pointer("pointerdown", 2, 250, 400);
    for (let i = 1; i <= 5; i++) { await pointer("pointermove", 1, 150 - i * 10, 400); await pointer("pointermove", 2, 250 + i * 10, 400); }
    await pointer("pointerup", 1, 100, 400); await pointer("pointerup", 2, 300, 400);
    const k1 = await scale();
    check("two fingers spreading zoom in, and draw nothing", k1 > k0 * 1.5 && (await els(page)).length === 1, { k0, k1 });
    await ctx.close();
  }

  // ---- boards.json on GitHub ----
  {
    const { ctx, page, github } = await open({ gh: GH });
    github.files["lifelog.json"] = { data: EMPTY, sha: "l0" };
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.click("text=+ New board");
    await page.waitForTimeout(200);
    await stroke(page, [[200, 300], [300, 320], [400, 300]]);
    await page.click("#boardBack");
    await page.waitForTimeout(800);
    const boardPut = github.puts.filter((p) => p.file === "boards.json").pop();
    check("a board is saved to boards.json beside lifelog.json", boardPut && boardPut.data.boards.length === 1 && boardPut.data.boards[0].elements.length === 1);
    check("and lifelog.json never carries it", github.puts.filter((p) => p.file === "lifelog.json").every((p) => !("boards" in p.data)));

    // Another device saves a board of its own first; this one's next save
    // meets a 409 and merges.
    const other = { id: "other1", name: "From the phone", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      elements: [{ id: "x1", t: "rect", c: "ink", sw: 2, seed: 3, x: 0, y: 0, w: 50, h: 50 }] };
    github.conflictOnce = { file: "boards.json", data: { boards: [...boardPut.data.boards, other] } };
    await page.click(".board-card:not(.board-new)");
    await page.waitForTimeout(200);
    await stroke(page, [[200, 500], [300, 520], [400, 500]]);
    await page.click("#boardBack");
    await page.waitForTimeout(1200);
    const last = github.files["boards.json"].data.boards;
    check("a save after another device's is merged, keeping both devices' boards",
      last.length === 2 && last.find((x) => x.id !== "other1").elements.length === 2, last.map((x) => [x.name, x.elements.length]));
    check("and the list shows the other device's board", await page.evaluate(() =>
      [...document.querySelectorAll(".board-name")].some((n) => n.textContent === "From the phone")));
    await ctx.close();
  }

  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  done(errs);
})();
