// Letterboxd import (0.252.0): the export zip, picked in Settings → Imports,
// opens the import review with the diary as entries and the watchlist as
// backlog; confirming writes them. The zip is built here with deflate, the
// way Letterboxd's is.
const zlib = require("zlib");
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

// A minimal zip: local headers, central directory, end record. CRCs are
// zero, which the app's reader doesn't check.
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8"), data = zlib.deflateRawSync(raw), n = Buffer.from(name, "utf8");
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(data.length), u32(raw.length), u16(n.length), u16(0), n, data]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(data.length), u32(raw.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), n]));
    parts.push(local); offset += local.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cd.length), u32(offset), u16(0)]);
  return Buffer.concat([...parts, cd, eocd]);
}
const ZIP = zip({
  "diary.csv": "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2026-02-15,Heat,1995,https://boxd.it/aaa,4.5,,,2026-02-14\n2026-03-09,Hundreds of Beavers,2022,https://boxd.it/ccc,,,,2026-03-08\n",
  "watched.csv": "Date,Name,Year,Letterboxd URI\n2026-02-15,Heat,1995,https://boxd.it/aaa\n2025-12-20,Thief,1981,https://boxd.it/ddd\n",
  "watchlist.csv": "Date,Name,Year,Letterboxd URI\n2026-01-05,Collateral,2004,https://boxd.it/eee\n",
  "reviews.csv": "Date,Name\n2026-01-01,x\n",
});

const SEED = {
  categories: [{ name: "Games", color: "#58a6ff" }, { name: "Films", color: "#f0883e" }],
  entries: [{ id: "e1", title: "Thief", category: "Films", year: 2025, month: 12, date: "2025-12-20" }],
  accomplishments: {}, backlog: [], habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {}, noteCategories: [], notes: [],
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)); }, SEED);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(300);

  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  await page.click('.srow[data-page="imports"]'); await page.waitForTimeout(300);
  check("the Imports page offers Letterboxd", await page.isVisible("#letterboxdImportBtn"));
  check("films default to the Films category", (await page.inputValue("#letterboxdCategory")) === "Films");
  await page.setInputFiles("#letterboxdImportInput", { name: "letterboxd-export.zip", mimeType: "application/zip", buffer: ZIP });
  await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 8000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll("#financePickerList .import-row, #financePickerList label")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
  check("the review lists the new films and the watchlist item", rows.some((r) => /Heat/.test(r)) && rows.some((r) => /Beavers/.test(r)) && rows.some((r) => /Collateral/.test(r)), rows);
  check("the one already logged is hidden as a duplicate", !rows.some((r) => /Thief/.test(r)), rows);
  check("the hint counts what the zip held", /3 watched/.test(await page.textContent("#financePickerHint")) && /1 on the watchlist/.test(await page.textContent("#financePickerHint")));
  await page.click("#financePickerConfirmBtn"); await page.waitForTimeout(600);
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem("lifelog-cache-v1")));
  const heat = data.entries.find((e) => e.title === "Heat");
  check("Heat is an entry on the day it was watched, with its stars", heat && heat.date === "2026-02-14" && heat.rating === 5 && heat.category === "Films", heat);
  check("the watchlist film is in the backlog with its year", data.backlog.some((x) => x.title === "Collateral" && x.releaseYear === 2004), data.backlog);
  check("Thief is still one entry", data.entries.filter((e) => e.title === "Thief").length === 1);
  check("no errors", errs.length === 0, errs);
  await ctx.close();
  await b.close();
  done();
})();
