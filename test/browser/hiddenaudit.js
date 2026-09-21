// Does `hidden` actually hide — everywhere, in every layout?
//
// This exists because it didn't. A tab turned off in Settings kept its icon
// in the phone's bottom bar (0.169.2), because `html:not(.force-pc) .tab
// { display: flex }` outranks the UA stylesheet's `[hidden] { display: none }`
// and only the phone layout sets an author display on .tab. The stylesheet
// already carried a companion `X[hidden] { display: none; }` beside several
// other author displays; the ones that were missing were missing silently.
//
// Rather than reason about specificity — the thing that went wrong — this
// asks the browser. For every element the app actually hides, it sets
// `hidden` and reads the computed display. Anything that isn't "none" is a
// place where hiding it would leave it on screen.
//
// "Actually hides" comes from two sources: every element carrying a `hidden`
// attribute in index.html (that attribute is the app declaring the element
// gets shown and hidden), plus anything else caught by a patched `hidden`
// setter while the app is driven through its views and modals.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }],
  entries: [{ id: "e1", title: "Thing", category: "Games", year: 2026, month: 3, date: "2026-03",
    rating: 4, notes: "x", createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" }],
  backlog: [{ id: "b1", title: "Later", category: "Games", releaseStatus: "released",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
  notes: [{ id: "n1", text: "A note", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" }],
  todos: [{ id: "t1", text: "Do it", order: 0, createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" }],
  todoCategories: [], projects: [{ id: "p", name: "Trip", color: "#e2723b", updatedAt: "2026-01-01T00:00:00.000Z" }],
  financeEntries: [{ id: "f1", title: "Coffee", amount: 4, category: "Food", date: "2026-03-02", project: "Trip", updatedAt: "2026-01-01T00:00:00.000Z" }],
  recurringExpenses: [{ id: "r1", startDate: "2026-01-15", interval: "monthly", amount: 30,
    category: "Food", note: "Sub", createdAt: "2026-01-15T00:00:00.000Z", updatedAt: "2026-01-15T00:00:00.000Z" }],
  financeCategories: [{ id: "food", name: "Food", color: "#4bc46a", updatedAt: "2026-01-01T00:00:00.000Z" }],
  settings: { currency: "ILS" },
  accomplishments: { 2026: [{ id: "a1", text: "Did a thing" }] },
};

// The four styling contexts. The two breakpoints AND the two force-layout
// overrides, because those are separate rule blocks — the tab-bar bug lived
// in one of them and was invisible in the other.
const CONTEXTS = [
  ["desktop 1280", { width: 1280, height: 900 }, ""],
  ["phone 390", { width: 390, height: 844 }, ""],
  ["forced mobile @1280", { width: 1280, height: 900 }, "mobile"],
  ["forced pc @390", { width: 390, height: 844 }, "pc"],
];

const RECORD = () => {
  const d = Object.getOwnPropertyDescriptor(Element.prototype, "hidden");
  window.__hid = new Set();
  Object.defineProperty(Element.prototype, "hidden", {
    configurable: true,
    get() { return d.get.call(this); },
    set(v) { if (v) window.__hid.add(this); d.set.call(this, v); },
  });
};

const CHECK = () => {
  const set = new Set([...document.querySelectorAll("[hidden]"), ...(window.__hid || [])]);
  const bad = [];
  for (const el of set) {
    if (!el.isConnected) continue;
    const was = el.hasAttribute("hidden");
    if (!was) el.setAttribute("hidden", "");
    const disp = getComputedStyle(el).display;
    if (!was) el.removeAttribute("hidden");
    if (disp === "none") continue;
    const id = el.id ? "#" + el.id : "";
    const cls = typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    bad.push(el.tagName.toLowerCase() + id + cls + " → " + disp);
  }
  return { examined: set.size, bad: [...new Set(bad)] };
};

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const offenders = new Map();
  let examined = 0;

  for (const [label, vp, force] of CONTEXTS) {
    const ctx = await browser.newContext({ viewport: vp, serviceWorkers: "block" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await page.addInitScript(RECORD);
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(({ s, f }) => {
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      // A disabled tab and a disabled mode, so the elements that 0.168.0
      // learnt to hide are in the set this audit examines. Without them the
      // very bug it was written for would not be reachable from here.
      const visual = { disabledViews: ["notes"], disabledModes: { backlog: ["discover"] } };
      if (f) visual.forceLayout = f;
      localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify(visual));
      localStorage.removeItem("lifelog-github-v1");
    }, { s: SEED, f: force });

    // Two views per context keeps this quick; the static [hidden] set is on
    // every page load anyway, and the modal sweep below reaches the rest.
    for (const ui of [{ view: "finance", financeMode: "entries" }, { view: "backlog", backlogMode: "entries" }]) {
      await page.evaluate((u) => localStorage.setItem("lifelog-ui-v1", JSON.stringify(u)), ui);
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(450);
      await page.evaluate(() => document.querySelectorAll(".modal-overlay").forEach((m) => { m.hidden = false; }));
      await page.waitForTimeout(120);
      const res = await page.evaluate(CHECK);
      examined = Math.max(examined, res.examined);
      for (const b of res.bad) {
        if (!offenders.has(b)) offenders.set(b, new Set());
        offenders.get(b).add(label);
      }
      await page.evaluate(() => document.querySelectorAll(".modal-overlay").forEach((m) => { m.hidden = true; }));
    }
    await ctx.close();
  }
  await browser.close();

  const rows = [...offenders.entries()].map(([sel, where]) => sel + "  [" + [...where].join(", ") + "]");
  check("a good number of hide-able elements were actually examined", examined > 60, examined);
  check("every element the app hides is really hidden, in all four layouts", rows.length === 0, rows);
  if (rows.length) {
    console.log("\n  Each needs a companion rule beside its author display:");
    console.log("    <selector>[hidden] { display: none; }");
  }

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail || errs.length ? 1 : 0;
})();
