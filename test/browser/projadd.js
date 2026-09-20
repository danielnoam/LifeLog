const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const SEED = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [],
  financeCategories: [{ id: "food", name: "Food", color: "#4bd07a" }, { id: "travel", name: "Travel", color: "#5b8cff" }],
  projects: [{ id: "p1", name: "Switzerland", color: "#e2b23b", createdAt: "2026-05-01T00:00:00.000Z" }],
  financeEntries: [
    // A run of three consecutive project rows in June — one pill.
    { id: "f1", date: "2026-06-04", amount: 120, category: "Travel", note: "train", project: "Switzerland",
      currency: "CHF", rate: 4.1, fxAmount: 29.27, createdAt: "2026-06-04T00:00:00.000Z" },
    { id: "f2", date: "2026-06-05", amount: 80, category: "Food", note: "dinner", project: "Switzerland",
      currency: "CHF", rate: 4.1, fxAmount: 19.51, createdAt: "2026-06-05T00:00:00.000Z" },
    { id: "f3", date: "2026-06-06", amount: 40, category: "Food", note: "lunch", project: "Switzerland",
      currency: "CHF", rate: 4.1, fxAmount: 9.76, createdAt: "2026-06-06T00:00:00.000Z" },
    { id: "f4", date: "2026-06-20", amount: 15, category: "Food", note: "home", createdAt: "2026-06-20T00:00:00.000Z" },
  ],
  recurringExpenses: [], settings: {},
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 440, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".proj-group");
  await page.waitForTimeout(400);

  const head = await page.evaluate(() => {
    const h = document.querySelector(".proj-group-head");
    const add = h.querySelector(".proj-group-add");
    const edit = h.querySelector(".proj-group-edit");
    const kids = [...h.children].map((c) => c.className);
    const ar = add.getBoundingClientRect(), er = edit.getBoundingClientRect();
    return {
      kids, hasAdd: !!add, text: add.textContent, tag: add.tagName,
      title: add.title, aria: add.getAttribute("aria-label"),
      w: Math.round(ar.width), h: Math.round(ar.height),
      leftOfEdit: ar.right <= er.left + 1,
      gap: Math.round(er.left - ar.right),
      // Centres, not tops: the two buttons are deliberately different
      // heights (a ringed + beside a bare glyph), so equal tops would
      // mean they were NOT centred on each other.
      sameRow: Math.abs((ar.top + ar.height / 2) - (er.top + er.height / 2)) < 2,
      inHead: ar.top >= h.getBoundingClientRect().top - 1 && ar.bottom <= h.getBoundingClientRect().bottom + 1,
    };
  });
  check("the project head has a + button", head.hasAdd && head.tag === "BUTTON" && head.text === "+", head);
  check("it sits next to the edit button", head.leftOfEdit && head.sameRow && head.gap < 16, head);
  check("it fits inside the header", head.inHead && head.w >= 16 && head.h >= 16, head);
  check("and says what it does", /Add an expense to Switzerland/.test(head.title) && head.aria === head.title, head);
  check("the header reads dot, name, +, edit",
    JSON.stringify(head.kids) === JSON.stringify(["dot", "proj-group-name", "proj-group-add", "proj-group-edit"]), head.kids);

  // --- pressing it opens the form, already on the project ---
  await page.evaluate(() => document.querySelector(".proj-group-add").click());
  await page.waitForTimeout(350);
  const form = await page.evaluate(() => ({
    open: !document.querySelector("#financeModal").hidden,
    title: document.querySelector("#financeModalTitle").textContent,
    project: document.querySelector("#finProject").value,
    date: document.querySelector("#finDate").value,
    amount: document.querySelector("#finAmount").value,
    currency: (document.querySelector("#finCurrency") || {}).value || null,
    rate: (document.querySelector("#finRate") || {}).value || null,
    id: document.querySelector("#financeId").value,
  }));
  check("pressing + opens the add form", form.open && /Add finance entry/.test(form.title), form);
  check("with the project already chosen", form.project === "Switzerland", form);
  check("as a new entry, not an edit", form.id === "" && form.amount === "", form);
  check("dated into the run's month, not today", /^2026-06/.test(form.date), form);
  check("and carrying the project's currency, so the rate isn't re-entered",
    form.currency === "CHF", form);

  // --- it saves onto the project ---
  await page.evaluate(() => {
    document.querySelector("#finAmount").value = "25";
    document.querySelector("#finAmount").dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#finNote").value = "cable car";
    document.querySelector("#financeForm").requestSubmit();
  });
  await page.waitForTimeout(600);
  const saved = await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
    const e = c.financeEntries.find((x) => x.note === "cable car");
    return e ? { project: e.project, date: e.date, currency: e.currency || null } : null;
  });
  check("the saved expense belongs to the project", !!saved && saved.project === "Switzerland", saved);
  check("and landed in the right month", !!saved && /^2026-06/.test(saved.date), saved);

  // --- it must not swallow a click meant for the pill/row underneath ---
  const noLeak = await page.evaluate(async () => {
    document.querySelector("#financeModal").hidden = true;
    let opened = 0;
    const orig = window.LifeLogFinance.openProjectModal;
    return { ok: true };
  });
  await page.evaluate(() => document.querySelector(".proj-group-edit").click());
  await page.waitForTimeout(300);
  const edit = await page.evaluate(() => ({
    proj: !document.querySelector("#projectModal").hidden,
    fin: !document.querySelector("#financeModal").hidden,
  }));
  check("the edit button still opens the project, not the expense form",
    edit.proj === true && edit.fin === false, edit);

  console.log("\nerrors:", errs.length ? errs : "none");
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exitCode = fail || errs.length ? 1 : 0;
})();
