// Settings → Import & export, one tab at a time (0.191.0): every tab's JSON
// and CSV export, downloaded through its button, read back in through that
// tab's import button into an empty app, and counted. Also the full backup,
// whose import used to drop notes, to-dos, habits and projects.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const T = "2026-03-01T00:00:00.000Z";
const FULL = {
  categories: [{ id: "games", name: "Games", color: "#5b8cff" }],
  entries: [{ id: "e1", title: "Celeste", category: "Games", year: 2026, month: 3, createdAt: T, updatedAt: T }],
  accomplishments: { 2026: [{ id: "a1", text: "Ran a 10k", createdAt: T, updatedAt: T }] },
  backlog: [{ id: "b1", title: "Hades II", category: "Games", createdAt: T, updatedAt: T }],
  notes: [{ id: "n1", text: "A note", createdAt: T, updatedAt: T }],
  todos: [{ id: "t1", text: "Call mum", category: "Home", order: 0, createdAt: T, updatedAt: T }],
  todoCategories: [{ id: "home", name: "Home", color: "#abcdef" }],
  habits: [{ id: "h1", name: "Read", color: "#00aa00", cadence: "daily", target: 1, order: 0, startedAt: "2026-01-01", marks: { "2026-03-01": 1 }, createdAt: T, updatedAt: T }],
  financeCategories: [{ id: "food", name: "Food", color: "#4bd07a" }],
  financeEntries: [{ id: "f1", date: "2026-03-04", amount: 20, category: "Food", note: "lunch", project: "Trip", createdAt: T, updatedAt: T }],
  recurringExpenses: [{ id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 10, category: "Food", note: "milk", createdAt: T, updatedAt: T }],
  projects: [{ id: "p1", name: "Trip", color: "#0000ff", updatedAt: T }],
  settings: { currency: "USD", mediaKeys: { rawg: "rawg-key" } },
};
const EMPTY = { categories: [], entries: [], accomplishments: {}, backlog: [], notes: [], todos: [], todoCategories: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {} };
const COUNT = (d) => ({
  entries: d.entries.length, achievements: Object.values(d.accomplishments || {}).flat().length, backlog: d.backlog.length,
  notes: d.notes.length, todos: d.todos.length, habits: d.habits.length,
  finance: d.financeEntries.length, recurring: d.recurringExpenses.length, projects: (d.projects || []).length,
});
const NONE = { entries: 0, achievements: 0, backlog: 0, notes: 0, todos: 0, habits: 0, finance: 0, recurring: 0, projects: 0 };
const TABS = {
  // The seeded to-do opens as a "Home" list note (0.197.0), so the Notes
  // tab carries two notes and no to-dos.
  notes: { notes: 2, habits: 1 },
  timeline: { entries: 1, achievements: 1 },
  backlog: { backlog: 1 },
  finance: { finance: 1, recurring: 1, projects: 1 },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabio-"));
  let ctx, page, n = 0;
  // A fresh profile each time: the app keeps more than the cache (history,
  // what it has seen deleted), and one round's must not reach the next.
  const load = async (data) => {
    if (ctx) await ctx.close();
    ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
    page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate((d) => {
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" }));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(d));
    }, data);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.click("#settingsBtn");
    await page.click('.srow[data-page="io"]');
    await page.waitForTimeout(200);
  };
  const exportVia = async (selector, picker) => {
    const [dl] = await Promise.all([page.waitForEvent("download"), (async () => {
      await page.click(selector);
      if (picker) { await page.waitForTimeout(200); await page.click("#financePickerConfirmBtn"); }
    })()]);
    const file = path.join(dir, (n++) + "-" + dl.suggestedFilename());
    await dl.saveAs(file);
    return { name: dl.suggestedFilename(), file };
  };
  const importVia = async (selector, file) => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(selector)]);
    await chooser.setFiles(file);
    const opened = await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 3000 }).then(() => true, () => false);
    if (!opened) return { noPicker: await page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ")) };
    await page.click("#financePickerConfirmBtn");
    await page.waitForTimeout(400);
    return COUNT(await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1"))));
  };

  for (const [tab, want] of Object.entries(TABS)) {
    for (const fmt of ["json", "csv"]) {
      await load(FULL);
      const ex = tab === "finance" && fmt === "csv"
        ? await exportVia("#exportFinanceCsvBtn", true)
        : await exportVia(`[data-io="export-${fmt}"][data-tab="${tab}"]`);
      await load(EMPTY);
      const got = await importVia(tab === "finance" && fmt === "csv" ? "#importFinanceCsvBtn" : `[data-io="import-${fmt}"][data-tab="${tab}"]`, ex.file);
      // CSV has no column for a project's colour, but an expense names it.
      const expect = { ...NONE, ...want };
      check(`${tab} ${fmt}: ${ex.name} comes back whole, and only ${tab}`, JSON.stringify(got) === JSON.stringify(expect), { got, expect });
    }
  }

  // The full backup, back in through "Everything".
  await load(FULL);
  const full = await exportVia("#exportJsonBtn");
  await load(EMPTY);
  const got = await importVia("#importJsonBtn", full.file);
  const all = { ...NONE }; for (const w of Object.values(TABS)) Object.assign(all, w);
  check("the full backup brings back every kind", JSON.stringify(got) === JSON.stringify(all), { got, all });

  // And all of it as one CSV, through Everything's CSV pair.
  await load(FULL);
  const fullCsv = await exportVia('[data-io="export-csv"][data-tab="all"]');
  await load(EMPTY);
  const gotCsv = await importVia('[data-io="import-csv"][data-tab="all"]', fullCsv.file);
  check("everything as one CSV brings back every kind", JSON.stringify(gotCsv) === JSON.stringify(all), { gotCsv, all });

  // Each tab's CSV import takes its own block out of it.
  for (const [tab, want] of Object.entries(TABS)) {
    await load(EMPTY);
    const sel = tab === "finance" ? "#importFinanceCsvBtn" : `[data-io="import-csv"][data-tab="${tab}"]`;
    const got = await importVia(sel, fullCsv.file);
    check(`${tab}'s CSV import takes its own block of the everything CSV`, JSON.stringify(got) === JSON.stringify({ ...NONE, ...want }), got);
  }

  // And a full backup read by one tab's import takes that tab's share only.
  await load(EMPTY);
  const part = await importVia('[data-io="import-json"][data-tab="notes"]', full.file);
  check("a tab's import takes only its share of a full backup", JSON.stringify(part) === JSON.stringify({ ...NONE, ...TABS.notes }), part);

  // Restore settings (0.194.0): the backup's settings, on purpose, after
  // saying what changes.
  await load(EMPTY);
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#restoreSettingsBtn")]);
  await chooser.setFiles(full.file);
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")).settings);
  check("Restore settings says what it will fill, without showing the key", /RAWG API key/.test(asked) && !/rawg-key/.test(asked), asked);
  check("and puts the backup's settings in place", restored.currency === "USD" && restored.mediaKeys.rawg === "rawg-key", restored);

  await ctx.close();
  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  done(errs);
})();
