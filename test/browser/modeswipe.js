// Swiping between modes is a pager (0.177.0).
//
// It used to slide the page off, fade it to nothing, and bring the next mode
// in afterwards from a short way off — an exit, a blank beat and an unrelated
// entrance. Now the mode being swiped towards sits beside the page while the
// finger is down, the two move as one strip on release, and the modes wrap
// round, so you can keep swiping one way.
//
// The assertion that matters most is the one in the middle of a turn: the
// page being left and the page arriving are on screen together, side by
// side, one screen-width (plus the gap) apart. That is what "one strip"
// means, and it is exactly what the old animation could never show.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const T = "2026-09-01T00:00:00.000Z";
const SEED = {
  categories: [], entries: [], backlog: [], projects: [], todoCategories: [],
  notes: [{ id: "n1", text: "A note on the first page", createdAt: T, updatedAt: T }],
  todos: [{ id: "t1", text: "A to-do on the second page", order: 0, createdAt: T, updatedAt: T }],
  habits: [{ id: "h1", name: "Habit on the third page", color: "#5b8cff", cadence: "daily", target: 1, order: 1,
    startedAt: "2026-09-01", createdAt: T, updatedAt: T }],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {},
};
const GAP = 16;

const mode = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-ui-v1") || "{}").notesMode || "notes");
const bodyText = (page) => page.evaluate(() => document.querySelector("#viewBody").innerText);
const xOf = (page, sel) => page.evaluate((sel) => {
  const n = document.querySelector(sel);
  if (!n) return null;
  const t = getComputedStyle(n).transform;
  return t === "none" ? 0 : new DOMMatrix(t).m41;
}, sel);

// A finger dragging across the middle of the page; `hold` leaves it down.
async function drag(page, dx, { hold = false, steps = 10 } = {}) {
  const box = await page.locator("#viewBody").boundingBox();
  const x0 = 210, y0 = box.y + 60;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (dx * i) / steps, y0 + i * 0.3);
    await page.waitForTimeout(16);
  }
  if (!hold) await page.mouse.up();
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(800);
  const W = await page.evaluate(() => document.querySelector("#content").getBoundingClientRect().width);

  // ---- 1. while the finger is down, the next mode is right beside the page ----
  await drag(page, -120, { hold: true });
  const mid = await page.evaluate(() => {
    const layer = document.querySelector(".mode-layer");
    const c = document.querySelector("#content");
    return {
      layer: !!layer,
      label: layer ? layer.innerText : "",
      // Where the name actually is on screen, not whether the text exists.
      labelBox: (() => {
        const n = layer && layer.querySelector(".mode-peek-name");
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { left: r.left, right: r.right, width: innerWidth };
      })(),
      peekX: layer ? new DOMMatrix(getComputedStyle(layer.firstChild).transform).m41 : null,
      contentX: new DOMMatrix(getComputedStyle(c).transform).m41,
      opacity: getComputedStyle(c).opacity,
    };
  });
  check("the page follows the finger", Math.abs(mid.contentX - -120) < 2, mid.contentX);
  check("and doesn't fade while it does — a page being turned is still a page", mid.opacity === "1", mid.opacity);
  check("the mode it's heading for is beside it, one page-width along",
    mid.layer && Math.abs(mid.peekX - (W + GAP - 120)) < 2, { peekX: mid.peekX, want: W + GAP - 120 });
  check("never visited yet, it shows that mode's name", /To-do/.test(mid.label), mid.label);
  check("where you can actually see it, in the part of the page uncovered so far",
    mid.labelBox && mid.labelBox.left >= 0 && mid.labelBox.right <= mid.labelBox.width, mid.labelBox);

  // ---- 2. on release the two travel as one strip ----
  await page.mouse.up();
  await page.waitForTimeout(110);
  const turning = await page.evaluate(() => {
    const layer = document.querySelector(".mode-layer");
    const leaving = layer && layer.firstChild;
    const c = document.querySelector("#content");
    return {
      leavingText: leaving ? leaving.innerText : "",
      leavingX: leaving ? new DOMMatrix(getComputedStyle(leaving).transform).m41 : null,
      arrivingText: c.innerText,
      arrivingX: new DOMMatrix(getComputedStyle(c).transform).m41,
    };
  });
  check("mid-turn, the page being left is still on screen", /A note on the first page/.test(turning.leavingText), turning.leavingText.slice(0, 60));
  check("and the real next page is already there beside it", /A to-do on the second page/.test(turning.arrivingText), turning.arrivingText.slice(0, 60));
  check("side by side, exactly one page-width and the gap apart — one strip",
    turning.leavingX < 0 && turning.arrivingX > 0 && Math.abs((turning.arrivingX - turning.leavingX) - (W + GAP)) < 3,
    { leavingX: turning.leavingX, arrivingX: turning.arrivingX, want: W + GAP });

  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    layers: document.querySelectorAll(".mode-layer").length,
    transform: getComputedStyle(document.querySelector("#content")).transform,
    viewBodies: document.querySelectorAll("#viewBody").length,
  }));
  check("it lands on the next mode", (await mode(page)) === "todo", await mode(page));
  check("and cleans up after itself: no pictures left, nothing held on the page",
    after.layers === 0 && after.transform === "none" && after.viewBodies === 1, after);

  // ---- 3. going back, the peek is the page as you left it ----
  await drag(page, 120, { hold: true });
  const back = await page.evaluate(() => (document.querySelector(".mode-layer") || {}).innerText || "");
  check("swiping back, what's beside the page is the notes page itself, not a label",
    /A note on the first page/.test(back), back.slice(0, 60));
  await page.mouse.up();
  await page.waitForTimeout(450);
  check("and it lands there", (await mode(page)) === "notes", await mode(page));

  // ---- 4. the modes wrap round ----
  await drag(page, 130);
  await page.waitForTimeout(450);
  check("swiping right from the first mode goes round to the last", (await mode(page)) === "habits", await mode(page));
  check("which really renders", /Habit on the third page/.test(await bodyText(page)));
  await drag(page, -130);
  await page.waitForTimeout(450);
  check("and swiping left from the last comes back round to the first", (await mode(page)) === "notes", await mode(page));

  // ---- 5. a short drag springs back ----
  await drag(page, -30);
  await page.waitForTimeout(350);
  const settled = await page.evaluate(() => ({
    layers: document.querySelectorAll(".mode-layer").length,
    transform: getComputedStyle(document.querySelector("#content")).transform,
  }));
  check("a drag that doesn't go far enough springs back and changes nothing",
    (await mode(page)) === "notes" && settled.layers === 0 && settled.transform === "none", settled);

  // ---- 6. a picture of a page is never the page ----
  await drag(page, -120, { hold: true });
  const inert = await page.evaluate(() => {
    const layer = document.querySelector(".mode-layer");
    return { inert: layer.inert, hidden: layer.getAttribute("aria-hidden"), firstBody: document.querySelector("#viewBody").closest(".mode-layer") === null };
  });
  check("the peek can't be clicked or read out, and the page's own ids still find the real page",
    inert.inert && inert.hidden === "true" && inert.firstBody, inert);
  await page.mouse.up();
  await page.waitForTimeout(450);

  await browser.close();
  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
