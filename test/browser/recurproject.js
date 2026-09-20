const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();
const errs = [];

const SEED = {
  categories: [], entries: [], backlog: [], notes: [], todos: [], todoCategories: [],
  financeCategories: [{ id: "f", name: "Bills", color: "#4bd07a" }],
  projects: [
    { id: "p1", name: "Switzerland", color: "#e2b23b", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "p2", name: "Studio", color: "#5b8cff", createdAt: "2026-05-02T00:00:00.000Z" },
  ],
  financeEntries: [],
  recurringExpenses: [
    // Deliberately interleaved by start date: a project's plans are rarely
    // adjacent, which is why these group rather than run-merge.
    { id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Bills", note: "Loose One", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "r2", startDate: "2026-02-01", interval: "monthly", amount: 20, category: "Bills", note: "Chalet wifi", project: "Switzerland", createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "r3", startDate: "2026-03-01", interval: "monthly", amount: 30, category: "Bills", note: "Rent", project: "Studio", createdAt: "2026-03-01T00:00:00.000Z" },
    { id: "r4", startDate: "2026-04-01", interval: "monthly", amount: 40, category: "Bills", note: "Ski pass", project: "Switzerland", createdAt: "2026-04-01T00:00:00.000Z" },
    { id: "r5", startDate: "2026-05-01", interval: "monthly", amount: 50, category: "Bills", note: "Loose Two", createdAt: "2026-05-01T00:00:00.000Z" },
  ],
  settings: { currency: "ILS" },
};

const load = async (page) => {
  await page.evaluate((s) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "finance", financeMode: "entries" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".recur-card");
  await page.waitForTimeout(400);
};

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 520, height: 1000 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await load(page);

  // ---------- grouping ----------
  const shape = await page.evaluate(() => {
    const card = document.querySelector(".recur-card");
    return {
      loose: [...card.children].filter((c) => c.classList.contains("recur-row"))
        .map((r) => r.querySelector(".etitle").textContent),
      groups: [...card.querySelectorAll(".proj-group")].map((g) => ({
        name: g.querySelector(".proj-group-name").textContent,
        rows: [...g.querySelectorAll(".recur-row .etitle")].map((t) => t.textContent),
        tint: g.style.getPropertyValue("--proj-head").trim(),
        hasEdit: !!g.querySelector(".proj-group-edit"),
      })),
    };
  });
  check("plans on the same project gather into one pill", shape.groups.length === 2, shape);
  check("even though their start dates are interleaved",
    JSON.stringify(shape.groups.find((g) => g.name === "Switzerland").rows) === JSON.stringify(["Chalet wifi", "Ski pass"]), shape.groups);
  check("the other project gets its own", 
    JSON.stringify(shape.groups.find((g) => g.name === "Studio").rows) === JSON.stringify(["Rent"]), shape.groups);
  check("plans with no project stay loose above them",
    JSON.stringify(shape.loose) === JSON.stringify(["Loose One", "Loose Two"]), shape.loose);
  check("each pill carries the project's own colour", shape.groups.every((g) => /^#[0-9a-f]{6}22$/i.test(g.tint)), shape.groups);
  check("and an edit button, like the Ledger's", shape.groups.every((g) => g.hasEdit), shape.groups);

  const editOpens = await page.evaluate(async () => {
    document.querySelector(".proj-group .proj-group-edit").click();
    await new Promise((r) => setTimeout(r, 300));
    return { open: !document.querySelector("#projectModal").hidden,
             name: document.querySelector("#projName").value,
             recur: !document.querySelector("#recurringModal").hidden };
  });
  check("pressing it edits the project, not a plan",
    editOpens.open && editOpens.recur === false && /Switzerland|Studio/.test(editOpens.name), editOpens);
  await page.evaluate(() => { document.querySelector("#projectModal").hidden = true; });

  const rowOpens = await page.evaluate(async () => {
    document.querySelector(".proj-group .recur-row").click();
    await new Promise((r) => setTimeout(r, 300));
    return { open: !document.querySelector("#recurringModal").hidden,
             note: document.querySelector("#recNote").value };
  });
  check("a row inside a pill still opens its own plan", rowOpens.open && /Chalet wifi/.test(rowOpens.note), rowOpens);

  // ---------- "+ New project…" on the recurring form ----------
  const picked = await page.evaluate(async () => {
    const sel = document.querySelector("#recProject");
    const add = [...sel.options].find((o) => /New project/.test(o.textContent));
    sel.value = add.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return { project: !document.querySelector("#projectModal").hidden,
             recurHidden: document.querySelector("#recurringModal").hidden,
             title: document.querySelector("#projectModalTitle").textContent };
  });
  check("choosing '+ New project…' on a recurring expense opens the project form",
    picked.project === true && /New project/.test(picked.title), picked);
  check("stepping out of the recurring form while it does", picked.recurHidden === true, picked);

  const saved = await page.evaluate(async () => {
    document.querySelector("#projName").value = "Iceland";
    document.querySelector("#projectForm").requestSubmit();
    await new Promise((r) => setTimeout(r, 600));
    return { recurBack: !document.querySelector("#recurringModal").hidden,
             selected: document.querySelector("#recProject").value,
             projectHidden: document.querySelector("#projectModal").hidden };
  });
  check("saving it comes back to the recurring form", saved.recurBack === true && saved.projectHidden === true, saved);
  check("with the new project already chosen", saved.selected === "Iceland", saved);

  // Cancelling must put it back the way it was found.
  const cancelled = await page.evaluate(async () => {
    const sel = document.querySelector("#recProject");
    sel.value = "Studio";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const add = [...sel.options].find((o) => /New project/.test(o.textContent));
    sel.value = add.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    document.querySelector("#cancelProjectBtn").click();
    await new Promise((r) => setTimeout(r, 300));
    return { recurBack: !document.querySelector("#recurringModal").hidden,
             selected: document.querySelector("#recProject").value };
  });
  check("cancelling comes back too", cancelled.recurBack === true, cancelled);
  check("leaving the choice as it was before, not on the '+ New project…' row",
    cancelled.selected === "Studio", cancelled);

  // ---------- the errands are a menu now ----------
  const menu = async () => page.evaluate(() => {
    const m = document.querySelector("#recMoreMenu");
    const btn = document.querySelector("#recMoreBtn");
    const wrap = document.querySelector("#recMoreWrap");
    const del = document.querySelector("#deleteRecurringBtn");
    const acts = [...document.querySelectorAll("#recurringModal .modal-actions > *")];
    const mr = m.hidden ? null : m.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const modal = document.querySelector("#recurringModal .modal").getBoundingClientRect();
    return {
      open: !m.hidden,
      wrapShown: !wrap.hidden,
      label: btn.textContent.trim(),
      expanded: btn.getAttribute("aria-expanded"),
      haspopup: btn.getAttribute("aria-haspopup"),
      controls: btn.getAttribute("aria-controls"),
      nextToDelete: acts.indexOf(wrap) === acts.indexOf(del) + 1,
      names: [...m.querySelectorAll("button")].filter((x) => !x.hidden).map((x) => x.textContent.trim()),
      // Opens upward, and stays inside the modal it belongs to.
      above: mr ? mr.bottom <= br.top + 1 : null,
      insideModal: mr ? mr.top >= modal.top - 1 && mr.left >= modal.left - 1 : null,
      styled: m.classList.contains("menu-pop"),
    };
  });
  await page.evaluate(async () => {
    const rec = JSON.parse(localStorage.getItem("lifelog-cache-v1")).recurringExpenses.find((x) => x.id === "r3");
    window.LifeLogFinance.openRecurringModal(rec);
    await new Promise((r) => setTimeout(r, 250));
  });
  let t = await menu();
  check("opening a plan no longer lays its errands out in full", t.open === false, t);
  check("a More button offers them instead, next to Delete",
    t.wrapShown === true && t.nextToDelete === true && t.label === "More\u2026", t);
  check("announced as a menu", t.haspopup === "menu" && t.controls === "recMoreMenu" && t.expanded === "false", t);

  await page.evaluate(() => document.querySelector("#recMoreBtn").click());
  await page.waitForTimeout(250);
  t = await menu();
  check("pressing it drops a menu", t.open === true && t.expanded === "true", t);
  check("wearing the same style as the + button's", t.styled === true, t);
  check("holding all of them — pause, convert, link past expenses",
    t.names.some((n) => /Pause/.test(n)) && t.names.some((n) => /Convert/.test(n))
    && t.names.some((n) => /Link past/.test(n)), t.names);
  check("opening upward, since it sits at the foot of a scrolling modal", t.above === true, t);
  check("and staying inside the modal rather than spilling out of it", t.insideModal === true, t);
  check("the button keeps its name — a menu doesn't need a 'Fewer'", t.label === "More\u2026", t);

  // ---- dismissal ----
  await page.evaluate(() => document.querySelector("#recMoreBtn").click());
  await page.waitForTimeout(200);
  check("pressing it again puts the menu away", (await menu()).open === false);

  await page.evaluate(() => document.querySelector("#recMoreBtn").click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector("#recNote").click());
  await page.waitForTimeout(200);
  check("clicking anywhere else closes it", (await menu()).open === false);

  // ---- picking one ends the menu's job ----
  const picked2 = await page.evaluate(async () => {
    document.querySelector("#recMoreBtn").click();
    await new Promise((r) => setTimeout(r, 150));
    document.querySelector("#pauseBtn").click();
    await new Promise((r) => setTimeout(r, 350));
    return { menuOpen: !document.querySelector("#recMoreMenu").hidden,
             pauseOpen: !document.querySelector("#pauseModal").hidden };
  });
  check("picking one opens what it promises", picked2.pauseOpen === true, picked2);
  check("and closes the menu behind it", picked2.menuOpen === false, picked2);
  await page.evaluate(() => { document.querySelector("#pauseModal").hidden = true; });

  // ---- it doesn't survive the modal ----
  const reopened = await page.evaluate(async () => {
    document.querySelector("#recurringModal").hidden = false;
    document.querySelector("#recMoreBtn").click();
    await new Promise((r) => setTimeout(r, 150));
    window.LifeLogFinance.closeRecurringModal();
    const rec = JSON.parse(localStorage.getItem("lifelog-cache-v1")).recurringExpenses.find((x) => x.id === "r2");
    window.LifeLogFinance.openRecurringModal(rec);
    await new Promise((r) => setTimeout(r, 250));
    return { open: !document.querySelector("#recMoreMenu").hidden };
  });
  check("it comes back closed on the next plan you open", reopened.open === false, reopened);

  // A brand new plan has nothing to pause or convert yet.
  const fresh = await page.evaluate(async () => {
    document.querySelector("#recurringModal").hidden = true;
    window.LifeLogFinance.openRecurringModal(null);
    await new Promise((r) => setTimeout(r, 250));
    return { wrap: document.querySelector("#recMoreWrap").hidden,
             del: document.querySelector("#deleteRecurringBtn").hidden,
             menu: document.querySelector("#recMoreMenu").hidden };
  });
  check("a brand new plan offers neither the button nor the menu",
    fresh.wrap === true && fresh.menu === true && fresh.del === true, fresh);
  await page.evaluate(() => { document.querySelector("#recurringModal").hidden = true; });

  // The expense form's own version must still work.
  await page.evaluate(() => { document.querySelector("#recurringModal").hidden = true; });
  const entry = await page.evaluate(async () => {
    window.LifeLogFinance.openFinanceModal(null);
    await new Promise((r) => setTimeout(r, 250));
    const sel = document.querySelector("#finProject");
    const add = [...sel.options].find((o) => /New project/.test(o.textContent));
    sel.value = add.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const projOpen = !document.querySelector("#projectModal").hidden;
    document.querySelector("#cancelProjectBtn").click();
    await new Promise((r) => setTimeout(r, 300));
    return { projOpen, finBack: !document.querySelector("#financeModal").hidden };
  });
  check("the expense form's own '+ New project…' is unaffected",
    entry.projOpen === true && entry.finBack === true, entry);

  await b.close();
  done(errs);
})();
