// Notes that link (Nov 2026): [[Title]] in a note opens that note (or a
// board), the reader lists "Linked from", typing [[ offers names, tables
// show as tables, a template starts a new note with today filled in, and
// a note exports as one Markdown file.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  noteCategories: [],
  notes: [
    { id: "trip", title: "Trip", text: "Pack from [[Packing]] and see [[Nowhere]]\n\n| Day | Km |\n|---|--:|\n| Mon | 12 |", createdAt: "2026-11-01T10:00:00.000Z" },
    { id: "pack", title: "Packing", text: "- socks\n- charger", createdAt: "2026-11-02T10:00:00.000Z" },
    { id: "tpl", title: "Daily", text: "## {{weekday}}\n- ", template: true, createdAt: "2026-11-03T10:00:00.000Z" },
  ],
};

async function run(b, width) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
  }, SEED);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const at = " (" + width + "px)";
  const cards = () => page.evaluate(() => [...document.querySelectorAll("#notesList [data-id]")].map((c) => c.dataset.id));

  check("a template stays out of the Notebook" + at, !(await cards()).includes("tpl"), JSON.stringify(await cards()));

  await page.evaluate(() => window.LifeLogNotes.openNoteReader("trip"));
  await page.waitForTimeout(200);
  check("[[Packing]] shows as a link, [[Nowhere]] as a missing one" + at, await page.evaluate(() => {
    const a = [...document.querySelectorAll("#noteReaderBody .md-wiki")];
    return a.length === 2 && !a[0].classList.contains("is-missing") && a[1].classList.contains("is-missing");
  }));
  check("the table is drawn as a table, its second column right-aligned" + at, await page.evaluate(() => {
    const t = document.querySelector("#noteReaderBody .md-table table");
    return !!t && t.rows.length === 2 && t.rows[1].cells[1].textContent === "12" && t.rows[1].cells[1].classList.contains("md-al-right");
  }));
  if (width < 600) check("a wide table scrolls inside its box, not the page" + at, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await page.click("#noteReaderBody .md-wiki:not(.is-missing)");
  await page.waitForTimeout(400);
  check("following the link opens Packing, which lists Trip under Linked from" + at, await page.evaluate(() => {
    const s = document.querySelector("#noteReaderLinks");
    return !!s && !s.hidden && /Trip/.test(s.textContent) && /Linked from 1 note/.test(s.textContent);
  }));
  await page.click("#noteReaderLinks .nv-link-row");
  await page.waitForTimeout(400);
  check("a Linked from row goes back to Trip" + at, await page.evaluate(() => /Trip/.test(document.querySelector("#noteReaderTitle, #noteReader h2")?.textContent || document.querySelector("#noteReader").textContent)));
  await page.click("#closeNoteReaderBtn");
  await page.waitForTimeout(300);

  // Typing [[ offers note names; Enter writes the link.
  await page.evaluate(() => window.LifeLogNotes.openNoteReader("trip"));
  await page.click("#editNoteReaderBtn");
  await page.waitForTimeout(300);
  await page.click("#nText");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n[[Pac");
  await page.waitForTimeout(200);
  check("typing [[ opens the link picker with Packing" + at, await page.evaluate(() => {
    const p = document.querySelector("#linkPick");
    return !!p && !p.hidden && /Packing/.test(p.textContent);
  }));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  check("Enter writes [[Packing]] and closes the picker" + at, await page.evaluate(() => /\[\[Packing\]\]$/.test(document.querySelector("#nText").value.trimEnd())));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // A new note offers the template.
  await page.evaluate(() => { const m = document.querySelector("#noteModal"); if (!m.hidden) window.LifeLogNotes.closeNoteModal(); });
  await page.evaluate(() => window.LifeLogNotes.openNoteModal());
  await page.waitForTimeout(300);
  check("a new note offers Start from a template" + at, await page.evaluate(() => !document.querySelector("#nTemplates").hidden && document.querySelectorAll("#nTemplateChips .tpl-chip").length === 1));
  await page.click("#nTemplateChips .tpl-chip");
  await page.waitForTimeout(150);
  check("the template fills in today's weekday" + at, await page.evaluate(() => {
    const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
    return document.querySelector("#nText").value.startsWith("## " + day);
  }), await page.evaluate(() => document.querySelector("#nText").value));
  await page.evaluate(() => window.LifeLogNotes.closeNoteModal());
  await page.waitForTimeout(300);

  // Export as Markdown downloads the note as written.
  await page.evaluate(() => window.LifeLogNotes.openNoteReader("trip"));
  await page.click("#noteReaderMoreBtn");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }).catch(() => null), page.click("#noteReaderExportMdBtn")]);
  let body = "";
  if (dl) body = require("fs").readFileSync(await dl.path(), "utf8");
  check("Export as Markdown saves Trip.md with the links kept" + at, !!dl && dl.suggestedFilename() === "Trip.md" && /\[\[Packing\]\]/.test(body), dl ? dl.suggestedFilename() : "no download");

  check("no errors" + at, errs.length === 0, errs.join("\n"));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  try { await run(b, 1280); await run(b, 375); }
  finally { await b.close(); }
  done();
})();
