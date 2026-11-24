// A pasted list becomes one task per line (2026-11-24): on a list's card,
// in its sheet, in English and Hebrew, phone and wide. Bullets, numbers and
// blank lines come off, a ticked box comes in done, and Undo takes the lot.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const T = "2026-01-01T09:00:00.000Z";
const SEED = {
  categories: [], entries: [], accomplishments: {}, backlog: [], todos: [], todoCategories: [], habits: [],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {}, noteCategories: [],
  notes: [{ id: "L", kind: "list", text: "Shopping", createdAt: T, updatedAt: T, items: [{ id: "a", text: "Apples" }] }],
};
const LIST = "- Milk\n\n  2. Eggs\r\n- [x] Bread\n";

async function paste(page, sel, text) {
  await page.evaluate(({ sel, text }) => {
    const input = document.querySelector(sel);
    input.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { sel, text });
  await page.waitForTimeout(300);
}

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const [w, h, mobile] of [[390, 844, true], [1280, 800, false]]) {
    for (const lang of ["en", "he"]) {
      const at = ` (${lang}, ${w}px)`;
      const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
      page.on("dialog", (d) => d.accept());
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await forgetCopy(page);
      await page.evaluate(({ seed, lang }) => {
        localStorage.clear();
        localStorage.setItem("lifelog.lang", lang);
        localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
        localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
      }, { seed: SEED, lang });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const items = async () => (await page.evaluate(() => window.LifeLogStorage.cachedCopy())).notes.find((n) => n.id === "L").items;
      const COMPOSE = '.note-card[data-id="L"] .note-list-compose input';

      await page.fill(COMPOSE, "Oat");
      await paste(page, COMPOSE, LIST);
      let got = await items();
      check("pasting a list on the card adds one task per line, typed words first" + at,
        got.map((i) => i.text).join() === "Apples,Oat,Milk,Eggs,Bread" && got.find((i) => i.text === "Bread").done && !got.find((i) => i.text === "Milk").done, got.map((i) => i.text));
      check("the box is empty after" + at, (await page.inputValue(COMPOSE).catch(() => "")) === "");
      const toast = await page.textContent("#toast");
      check("a toast says how many, with Undo" + at, (lang === "en" ? /Added 4 items/ : /נוספו 4 פריטים/).test(toast), toast);
      await page.click("#toast button");
      await page.waitForTimeout(300);
      got = await items();
      check("Undo takes them all off" + at, got.map((i) => i.text).join() === "Apples", got.map((i) => i.text));

      await paste(page, COMPOSE, "Just one line");
      check("a one-line paste is an ordinary paste" + at, (await items()).length === 1);

      await page.evaluate(() => window.LifeLogNotes.openNoteModal(window.LifeLogStorage.cachedCopy().notes.find((n) => n.id === "L")));
      await page.waitForTimeout(300);
      await paste(page, "#nNewItem", "• Soap\n• Rice");
      check("pasting in the list's page adds rows there" + at, await page.evaluate(() =>
        [...document.querySelectorAll("#nItems .note-list-row input[type=text]")].map((i) => i.value).join() === "Apples,Soap,Rice"));
      await page.click("#cancelNoteBtn");
      await page.waitForTimeout(400);
      got = await items();
      check("and they're saved with the list" + at, got.map((i) => i.text).join() === "Apples,Soap,Rice", got.map((i) => i.text));
      await ctx.close();
    }
  }
  check("no page errors", !errs.length, errs);
  await b.close();
  done();
})();
