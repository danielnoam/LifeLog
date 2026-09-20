const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [],
  financeCategories: [{ id: "f", name: "Food", color: "#4bd07a" }],
  projects: [{ id: "p1", name: "Switzerland", color: "#e2b23b", createdAt: "2026-05-01T00:00:00.000Z" }],
  financeEntries: [
    // No project: the rate row only shows when nobody else knows the number,
    // which is an ad-hoc foreign expense or the FIRST one on a project.
    { id: "f1", date: "2026-06-04", amount: 120, category: "Food", note: "train",
      currency: "CHF", rate: 4.1, fxAmount: 29.27, createdAt: "2026-06-04T00:00:00.000Z" },
    // On a project WITH an established rate — the case where the row hides.
    { id: "f2", date: "2026-06-05", amount: 80, category: "Food", note: "dinner", project: "Switzerland",
      currency: "CHF", rate: 4.1, fxAmount: 19.51, createdAt: "2026-06-05T00:00:00.000Z" },
  ],
  recurringExpenses: [], settings: { currency: "ILS" },
};

// Stands in for the two real services, in their documented response shapes.
// Every FX request is recorded so the URL the app builds can be checked —
// which is the half of this that can't be confirmed any other way from here.
const STUB = (mode) => {
  window.__fx = [];
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (!/frankfurter|currency-api/.test(u)) return real(url, opts);
    window.__fx.push(u);
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    const dead = () => new Response("nope", { status: 503 });
    const isFrank = /frankfurter/.test(u);
    if (mode === "frank" && isFrank) {
      // Asked for a Sunday, answered with the Friday — ECB has no weekend.
      return ok({ amount: 1, base: "CHF", date: "2026-06-03", rates: { ILS: 4.1234567 } });
    }
    if (mode === "cdn" && isFrank) return dead();
    if (mode === "cdn" && !isFrank) return ok({ date: "2026-06-03", chf: { ils: 4.5, usd: 1.1 } });
    if (mode === "tiny" && isFrank) return ok({ amount: 1, base: "KRW", date: "2026-06-03", rates: { ILS: 0.00234567891 } });
    if (mode === "dead") return dead();
    return dead();
  };
};

const openEntry = (page) => page.evaluate(() => {
  const e = JSON.parse(localStorage.getItem("lifelog-cache-v1")).financeEntries[0];
  window.LifeLogFinance.openFinanceModal(e);
});
const readForm = (page) => page.evaluate(() => ({
  rate: document.querySelector("#finRate").value,
  preview: document.querySelector("#finFxPreview").textContent,
  btn: document.querySelector("#finRateFetchBtn").textContent,
  disabled: document.querySelector("#finRateFetchBtn").disabled,
  rowVisible: !document.querySelector("#finRateLabel").hidden,
  urls: window.__fx,
}));
const clickFetch = async (page) => {
  await page.evaluate(() => document.querySelector("#finRateFetchBtn").click());
  await page.waitForTimeout(500);
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 460, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // ---- the button exists where a foreign rate is typed ----
  await openEntry(page);
  await page.waitForTimeout(300);
  let f = await page.evaluate(() => {
    const btn = document.querySelector("#finRateFetchBtn");
    const inp = document.querySelector("#finRate");
    const br = btn.getBoundingClientRect(), ir = inp.getBoundingClientRect();
    return { exists: !!btn, tag: btn.tagName, type: btn.type, text: btn.textContent,
      sameRow: Math.abs((br.top + br.height / 2) - (ir.top + ir.height / 2)) < 3,
      rightOfInput: br.left >= ir.right - 1, fits: br.right <= inp.closest(".modal").getBoundingClientRect().right + 1 };
  });
  check("a foreign-currency entry gets a lookup button beside the rate", f.exists && f.tag === "BUTTON", f);
  check("it is type=button, so it can't submit the form", f.type === "button", f);
  check("and sits on the rate's own row without overflowing",
    f.sameRow && f.rightOfInput && f.fits, f);

  // ---- 1. primary source ----
  await page.evaluate(STUB, "frank");
  await clickFetch(page);
  f = await readForm(page);
  check("pressing it fills the rate from the primary source", f.rate === "4.12346", f);
  check("asked the primary for the expense's OWN date, not today",
    f.urls.length === 1 && f.urls[0].includes("/v1/2026-06-04") && f.urls[0].includes("base=CHF") && f.urls[0].includes("symbols=ILS"), f.urls);
  check("the preview names the date the rate is actually for",
    /ECB rate for (3 Jun|Jun 3)/.test(f.preview), f.preview);
  check("and still reads in the stored direction, home per foreign",
    /4\.12346 ILS per CHF/.test(f.preview), f.preview);
  check("the rate row is on screen for an expense nobody else prices", f.rowVisible === true, f);
  check("the button comes back", f.btn === "Look up" && f.disabled === false, f);

  // The note is tied to that exact rate, so typing over it clears it.
  await page.evaluate(() => {
    const i = document.querySelector("#finRate");
    i.value = "9"; i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  f = await readForm(page);
  check("typing a different rate drops the note rather than mislabelling it",
    !/ECB rate/.test(f.preview) && /9 ILS per CHF/.test(f.preview), f.preview);

  // ---- 2. fallback ----
  await page.evaluate(STUB, "cdn");
  await clickFetch(page);
  f = await readForm(page);
  check("a dead primary falls through to the CDN", f.rate === "4.5", f);
  check("which is version-pinned to the same date",
    f.urls.length === 2 && /currency-api@2026-06-04\/v1\/currencies\/chf\.json/.test(f.urls[1]), f.urls);
  check("and is named as a different source", /Currency API rate for (3 Jun|Jun 3)/.test(f.preview), f.preview);

  // ---- 3. both down ----
  await page.evaluate(STUB, "dead");
  await page.evaluate(() => {
    const i = document.querySelector("#finRate");
    i.value = "3.33"; i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickFetch(page);
  f = await readForm(page);
  check("with both down the rate you had is left alone", f.rate === "3.33", f);
  check("the button is usable again rather than stuck on '…'",
    f.btn === "Look up" && f.disabled === false, f);
  check("and it says so", await page.evaluate(() => {
    const t = document.querySelector(".toast, #toast");
    return !!t && /Couldn't reach a rate for CHF/.test(t.textContent);
  }));

  // ---- 4. a rate small enough that 4dp would destroy it ----
  await page.evaluate((seed) => {
    const s = JSON.parse(JSON.stringify(seed));
    s.financeEntries[0].currency = "KRW";
    s.financeEntries[0].rate = 0.0023;
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.evaluate(STUB, "tiny");
  await openEntry(page);
  await page.waitForTimeout(250);
  await clickFetch(page);
  f = await readForm(page);
  // 4dp would give 0.0023 — a 2% error on every won you ever spend.
  check("a tiny rate keeps its significant digits instead of being rounded flat",
    f.rate === "0.00234568", f);

  // ---- 4b. the boundary: a project that already knows its rate ----
  await page.evaluate((seed) => localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)), SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const onProj = await page.evaluate(() => {
    const e = JSON.parse(localStorage.getItem("lifelog-cache-v1")).financeEntries.find((x) => x.project);
    window.LifeLogFinance.openFinanceModal(e);
    return { rowVisible: !document.querySelector("#finRateLabel").hidden,
             preview: document.querySelector("#finFxPreview").textContent };
  });
  check("an expense whose project already prices it hides the rate row, button and all",
    onProj.rowVisible === false, onProj);
  check("saying where the rate came from instead", /from Switzerland/.test(onProj.preview), onProj);

  // ---- 5. Convert asks for the latest, since a project spans dates ----
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("lifelog-cache-v1")).projects[0];
    window.LifeLogFinance.openProjectModal(p);
    document.querySelector("#convertProjectBtn").click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(STUB, "frank");
  await page.evaluate(() => document.querySelector("#convRateFetchBtn").click());
  await page.waitForTimeout(500);
  const c = await page.evaluate(() => ({
    rate: document.querySelector("#convRate").value,
    urls: window.__fx,
    btn: document.querySelector("#convRateFetchBtn").textContent,
  }));
  check("Convert has a lookup button too", c.btn === "Look up", c);
  check("and asks for the latest rate, not a date", c.urls.length === 1 && /\/v1\/latest\?/.test(c.urls[0]), c.urls);
  check("filling the field it settles with", c.rate === "4.12346", c);

  // ---- 6. the conversion line must read as a caption for what's ABOVE it ----
  // .hint defaults to 10px top / 0 bottom, which left it flush against the
  // Category field — so it captioned the wrong thing, worst of all with the
  // rate row hidden and the line landing directly under Amount.
  const gaps = async () => page.evaluate(() => {
    const vis = (s) => { const n = document.querySelector(s); return n && !n.hidden && n.offsetParent ? n.getBoundingClientRect() : null; };
    const hint = vis("#finFxPreview");
    if (!hint) return { noHint: true };
    const above = vis("#finRateLabel") || document.querySelector("#finAmount").closest(".field-row").getBoundingClientRect();
    const cat = [...document.querySelectorAll("#financeForm > label")]
      .find((l) => /Category/.test(l.firstChild.textContent || "")).getBoundingClientRect();
    return { rateShown: !!vis("#finRateLabel"),
             above: Math.round(hint.top - above.bottom),
             below: Math.round(cat.top - hint.bottom) };
  });
  await page.evaluate((seed) => localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)), SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const e = JSON.parse(localStorage.getItem("lifelog-cache-v1")).financeEntries.find((x) => !x.project);
    window.LifeLogFinance.openFinanceModal(e);
  });
  await page.waitForTimeout(300);
  let g = await gaps();
  check("with the rate row shown, the line sits nearer the rate than Category",
    g.rateShown === true && g.below > g.above, g);
  check("and is clear of Category rather than touching it", g.below >= 16, g);

  await page.evaluate(() => {
    const e = JSON.parse(localStorage.getItem("lifelog-cache-v1")).financeEntries.find((x) => x.project);
    window.LifeLogFinance.openFinanceModal(e);
  });
  await page.waitForTimeout(300);
  g = await gaps();
  check("with the rate row hidden, it sits nearer Amount than Category",
    g.rateShown === false && g.below > g.above, g);
  check("and is still clear of Category", g.below >= 16, g);

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
