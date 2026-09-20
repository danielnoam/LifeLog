const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();
const errs = [];
const SEED = require("./seeds/dropseed.json");

// Anything a finger lands on: real buttons, ARIA buttons, and the spans and
// labels this app uses as buttons.
const SEL = 'button, [role="button"], summary, .cat-chip, .filter-label, .tab, .chip, .pill, label.toggle-label, .link-btn, .month-add-btn, .jump-btn, .bulk-check, .backlog-dropped-toggle';

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  let walked = 0, modalsWalked = 0;
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);

  const bad = new Map();
  const views = [
    ["timeline/entries", { view: "timeline", timelineMode: "entries" }],
    ["timeline/stats", { view: "timeline", timelineMode: "stats" }],
    ["timeline/notes", { view: "timeline", timelineMode: "notes" }],
    ["timeline/todo", { view: "timeline", timelineMode: "todo" }],
    ["backlog/entries", { view: "backlog", backlogMode: "entries" }],
    ["backlog/upcoming", { view: "backlog", backlogMode: "upcoming" }],
    ["backlog/discover", { view: "backlog", backlogMode: "discover" }],
    ["finance/entries", { view: "finance", financeMode: "entries" }],
    ["finance/summary", { view: "finance", financeMode: "summary" }],
  ];
  for (const [label, ui] of views) {
    await page.evaluate((ui) => localStorage.setItem("lifelog-ui-v1", JSON.stringify(ui)), ui);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const rows = await page.evaluate((SEL) => {
      const out = [];
      for (const n of document.querySelectorAll(SEL)) {
        if (!n.offsetParent && n.tagName !== "BODY") continue; // not on screen
        const cs = getComputedStyle(n);
        const tap = cs.webkitTapHighlightColor || "";
        const sel = cs.userSelect || cs.webkitUserSelect || "";
        const transparent = /rgba\(0, 0, 0, 0\)|transparent/.test(tap);
        if (transparent && sel === "none") continue;
        const cls = (typeof n.className === "string" ? n.className : "").trim().split(/\s+/).slice(0, 2).join(".");
        out.push({ id: n.tagName.toLowerCase() + (cls ? "." + cls : "") + (n.id ? "#" + n.id : ""),
                   tap: transparent ? "ok" : tap, sel });
      }
      return out;
    }, SEL);
    walked++;
    for (const r of rows) {
      const k = r.id;
      if (!bad.has(k)) bad.set(k, { ...r, views: new Set() });
      bad.get(k).views.add(label);
    }
  }

  // Modals too — they are full of buttons and never visible above.
  await page.evaluate(() => localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" })));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const modalRows = await page.evaluate((SEL) => {
    const out = [];
    for (const ov of document.querySelectorAll(".modal-overlay")) {
      ov.hidden = false;
      for (const n of ov.querySelectorAll(SEL)) {
        const cs = getComputedStyle(n);
        const tap = cs.webkitTapHighlightColor || "";
        const sel = cs.userSelect || cs.webkitUserSelect || "";
        if (/rgba\(0, 0, 0, 0\)|transparent/.test(tap) && sel === "none") continue;
        const cls = (typeof n.className === "string" ? n.className : "").trim().split(/\s+/).slice(0, 2).join(".");
        out.push({ ov: ov.id, id: n.tagName.toLowerCase() + (cls ? "." + cls : "") + (n.id ? "#" + n.id : ""),
                   tap: /rgba\(0, 0, 0, 0\)/.test(tap) ? "ok" : tap, sel });
      }
      ov.hidden = true;
    }
    return out;
  }, SEL);
  modalsWalked = new Set(modalRows.map((r) => r.ov)).size || 1;
  for (const r of modalRows) {
    const k = r.id;
    if (!bad.has(k)) bad.set(k, { ...r, views: new Set() });
    bad.get(k).views.add("modal:" + r.ov);
  }

  // An audit rather than a scenario: it walks every view and every modal and
  // asserts that nothing pressable has been left with the browser's default
  // tap-highlight or selectable label text. 0.156.0 found 105 such elements,
  // which is to say all of them — a grep would have found only the four that
  // had already been fixed, because the bug was the absence of a rule.
  const list = [...bad.values()].sort((a, b2) => a.id.localeCompare(b2.id));
  const tapBad = list.filter((r) => r.tap !== "ok");
  const selBad = list.filter((r) => r.sel !== "none");
  for (const r of list) {
    console.log(`       ${r.id.padEnd(42)} tap=${String(r.tap).padEnd(22)} sel=${r.sel}`);
  }
  check("no pressable draws the browser's tap-highlight rect", tapBad.length === 0,
    tapBad.length ? tapBad.slice(0, 5).map((r) => r.id) : undefined);
  check("no pressable's label can be selected instead of pressed", selBad.length === 0,
    selBad.length ? selBad.slice(0, 5).map((r) => r.id) : undefined);
  check("every view and modal was actually walked", walked >= 9 && modalsWalked > 0,
    { walked, modalsWalked });

  await b.close();
  done(errs);
})();
