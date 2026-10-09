// The import review on a long import (0.255.0): periods as years with the
// months behind a chevron, a list that gives way so Import stays on screen,
// search and sort that come on their own, and a count line that says what
// the button will do.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const cats = ["Games", "Films", "Books"];
const entries = [], notes = [];
let n = 0;
for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) for (let k = 0; k < 3; k++) { n++; entries.push({ id: "i" + n, title: `Thing ${n}`, category: cats[n % 3], year: y, month: m, date: `${y}-${String(m).padStart(2, "0")}-10` }); }
entries.push({ id: "zz", title: "Aardvark Quest", category: "Games", year: 2024, month: 3, date: "2024-03-01" });
for (let i = 0; i < 5; i++) notes.push({ id: "n" + i, title: "Note " + i, text: "words", createdAt: `2026-0${i + 1}-01T10:00:00.000Z` });
const FILE = { categories: cats.map((c) => ({ name: c, color: "#58a6ff" })), entries, backlog: [{ id: "b1", title: "Backlog thing", category: "Games" }], notes, settings: {}, exportedAt: "2026-10-01T00:00:00.000Z" };
const SMALL = { categories: [], entries: entries.slice(0, 6), backlog: [], notes: [], settings: {} };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify({ categories: [{ name: "Games", color: "#58a6ff" }], entries: [], backlog: [], settings: {} })); });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(300);
  const open = async (file) => {
    // The input is in the page whatever Settings shows, so only the first
    // open walks there.
    if (await page.evaluate(() => document.querySelector("#settingsModal").hidden)) {
      await page.click("#settingsBtn"); await page.waitForTimeout(300);
      await page.click('.srow[data-page="io"]'); await page.waitForTimeout(300);
    }
    await page.setInputFiles("#importJsonInput", { name: "lifelog.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
    await page.waitForSelector("#financePickerModal:not([hidden])"); await page.waitForTimeout(400);
  };
  const read = () => page.evaluate(() => ({
    years: [...document.querySelectorAll("#financePickerBuckets .year-chip")].map((c) => [...c.children].map((x) => x.textContent).join(" ")),
    months: [...document.querySelectorAll("#financePickerBuckets .month-chip")].map((c) => [...c.children].map((x) => x.textContent).join(" ")),
    open: [...document.querySelectorAll("#financePickerBuckets .picker-year-more")].map((b) => b.getAttribute("aria-expanded")),
    chevrons: document.querySelectorAll("#financePickerBuckets .picker-year-more").length,
    rows: document.querySelectorAll("#financePickerList .picker-row").length,
    firstTitle: (document.querySelector("#financePickerList .etitle") || {}).textContent,
    count: document.querySelector("#financePickerCount").textContent,
    search: !document.querySelector("#financePickerSearch").hidden,
    sort: !document.querySelector("#financePickerSort").hidden,
    importBottom: document.querySelector("#financePickerConfirmBtn").getBoundingClientRect().bottom,
    importDisabled: document.querySelector("#financePickerConfirmBtn").disabled,
    inner: window.innerHeight,
  }));

  await open(FILE);
  let r = await read();
  check("four years of months are four year chips, not 48 month chips", r.years.length === 4 && r.months.length === 0, r.years);
  check("each year chip carries its count", /^2026 41$/.test(r.years[0]) && /^2024 37$/.test(r.years[2]), r.years);
  check("every year has a chevron for its months", r.chevrons === 4);
  check("the Import button is on screen on a phone", r.importBottom <= r.inner, { bottom: r.importBottom, inner: r.inner });
  check("the count line says what comes in, by kind", /^145 entries, 1 backlog item, 5 notes/.test(r.count), r.count);
  check("search and sort appear on a long list", r.search && r.sort);

  await page.click("#financePickerBuckets .picker-year-more"); await page.waitForTimeout(150);
  r = await read();
  check("the chevron opens that year's months", r.months.length === 12 && /^Dec 3$/.test(r.months[0]), r.months);
  await page.click("#financePickerBuckets .month-chip"); await page.waitForTimeout(150);
  r = await read();
  check("a month chip turns its rows off and the year shows the part", /^Dec 0\/3$/.test(r.months[0]) && /^2026 38\/41$/.test(r.years[0]), { m: r.months[0], y: r.years[0] });
  check("and the count line follows", /^142 entries/.test(r.count), r.count);
  await page.click("#financePickerBuckets .year-chip"); await page.waitForTimeout(150);
  r = await read();
  check("a part-on year chip turns the whole year on", /^2026 41$/.test(r.years[0]), r.years[0]);
  await page.click("#financePickerBuckets .year-chip"); await page.waitForTimeout(150);
  r = await read();
  check("and again turns it all off", /^2026 0\/41$/.test(r.years[0]), r.years[0]);

  await page.selectOption("#financePickerSort", "name"); await page.waitForTimeout(150);
  r = await read();
  check("A to Z puts Aardvark first", r.firstTitle === "Aardvark Quest", r.firstTitle);
  await page.fill("#financePickerSearch", "aardvark"); await page.waitForTimeout(200);
  r = await read();
  check("search narrows the list", r.rows === 1, r.rows);
  await page.fill("#financePickerSearch", ""); await page.waitForTimeout(200);
  await page.click("#financePickerSelectNone"); await page.waitForTimeout(150);
  r = await read();
  check("with nothing ticked the count says so and Import is off", /Nothing selected/.test(r.count) && r.importDisabled, r);
  await page.click("#financePickerCancelBtn"); await page.waitForTimeout(300);

  await open(SMALL);
  r = await read();
  check("a short import starts with its months open and no search box", r.months.length === 2 && r.open.join() === "true" && !r.search, r);
  await page.click("#financePickerCancelBtn"); await page.waitForTimeout(200);
  check("no errors", errs.length === 0, errs);
  await ctx.close();
  await b.close();
  done();
})();
