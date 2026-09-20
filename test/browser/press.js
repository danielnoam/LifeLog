const { chromium, BASE } = require("./harness");
const SEED = require("./seeds/dropseed.json");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".month-add-btn, .backlog-section-head");
  await page.waitForTimeout(400);

  // --- text fields must still be editable and selectable ---
  const fields = await page.evaluate(() => {
    const out = [];
    for (const ov of document.querySelectorAll(".modal-overlay")) {
      ov.hidden = false;
      for (const f of ov.querySelectorAll("input[type=text], input[type=number], input:not([type]), textarea, select")) {
        const cs = getComputedStyle(f);
        out.push({ id: f.id || f.tagName, sel: cs.userSelect || cs.webkitUserSelect });
      }
      ov.hidden = true;
    }
    return out;
  });
  check("every text field is still selectable", fields.length > 10 && fields.every((f) => f.sel !== "none"),
    fields.filter((f) => f.sel === "none"));

  // Actually type into one and select its text.
  const typed = await page.evaluate(async () => {
    const ov = document.querySelector("#backlogModal");
    ov.hidden = false;
    const inp = document.querySelector("#bTitle");
    inp.focus(); inp.value = "";
    document.execCommand && document.execCommand("insertText", false, "Hello There");
    if (!inp.value) inp.value = "Hello There";
    inp.setSelectionRange(0, 5);
    const sel = inp.value.slice(inp.selectionStart, inp.selectionEnd);
    ov.hidden = true;
    return { value: inp.value, sel };
  });
  check("and a field's text can still be typed and selected",
    typed.value === "Hello There" && typed.sel === "Hello", typed);

  // Notes keep their deliberate text-selectability.
  const note = await page.evaluate(() => {
    const d = document.createElement("div");
    d.className = "note-card";
    const t = document.createElement("div");
    t.className = "note-text"; t.textContent = "x";
    d.appendChild(t); document.body.appendChild(d);
    const cs = getComputedStyle(t);
    const r = { sel: cs.userSelect || cs.webkitUserSelect };
    d.remove(); return r;
  });
  check("a note's own text stays selectable", note.sel === "text", note);

  // --- press feedback exists and is transient ---
  const press = await page.evaluate(async () => {
    const btn = document.querySelector(".month-add-btn") || document.querySelector("button.btn");
    const idle = getComputedStyle(btn).opacity;
    const r = btn.getBoundingClientRect();
    return { idle, x: r.x + r.width / 2, y: r.y + r.height / 2, tag: btn.className };
  });
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  const down = await page.evaluate(() => {
    const btn = document.querySelector(".month-add-btn") || document.querySelector("button.btn");
    return getComputedStyle(btn).opacity;
  });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const up = await page.evaluate(() => {
    const btn = document.querySelector(".month-add-btn") || document.querySelector("button.btn");
    return getComputedStyle(btn).opacity;
  });
  check("a pressed button visibly responds", Number(down) < Number(press.idle), { idle: press.idle, down });
  check("and returns to normal on release", Number(up) === Number(press.idle), { up, idle: press.idle });

  // A disabled button must not answer a press.
  const dis = await page.evaluate(async () => {
    const btn = document.createElement("button");
    btn.className = "btn"; btn.textContent = "x"; btn.disabled = true;
    document.body.appendChild(btn);
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, idle: getComputedStyle(btn).opacity };
  });
  await page.mouse.move(dis.x, dis.y);
  await page.mouse.down();
  const disDown = await page.evaluate(() => getComputedStyle(document.querySelector("body > button.btn:last-of-type")).opacity);
  await page.mouse.up();
  check("a disabled button does not answer a press", disDown === dis.idle, { idle: dis.idle, down: disDown });

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
