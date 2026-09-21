// Not a pass/fail suite — a measurement, which is why it lives outside
// test/browser (run-all treats everything in there as a suite). It answers
// one question: how much of a cold load is the row count, and therefore what
// virtualising the rows could possibly buy. See TODO.md's first entry for the
// numbers this produced and what they settled.
//
//   node test/perf/serve-and-run.js          # serves the repo and runs this
//
// It sweeps the dataset rather than faking a virtualised renderer: cutting
// the entries is a deeper cut than virtualising could make, so whatever it
// saves is an upper bound. Reading at 4x CPU throttle, median of three loads.
const { chromium, BASE } = require("../browser/harness");

const CATS = [
  { id: "g", name: "Games", color: "#5b8cff" }, { id: "f", name: "Film", color: "#e2554b" },
  { id: "b", name: "Books", color: "#4bc46a" }, { id: "t", name: "TV", color: "#d9a441" },
];
const NAMES = ["Bioshock", "Metro 2033", "Dune", "Hyperion", "Disco Elysium", "Outer Wilds",
  "Annihilation", "The Expanse", "Blame!", "Control", "Celeste", "Hades", "Sable", "Tunic"];

function seedData(n) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    const year = 2019 + (i % 7), month = 1 + (i % 12);
    entries.push({
      id: "e" + i, title: NAMES[i % NAMES.length] + " " + i,
      category: CATS[i % CATS.length].name, year, month,
      date: `${year}-${String(month).padStart(2, "0")}`,
      rating: 1 + (i % 5),
      notes: i % 3 === 0 ? "A few words about it, the kind you'd actually type." : "",
      genres: i % 2 ? ["Action", "RPG"] : ["Drama"],
      length: i % 4 ? (10 + (i % 40)) + "h" : "",
      createdAt: `${year}-${String(month).padStart(2, "0")}-05T00:00:00.000Z`,
    });
  }
  return { categories: CATS, entries, backlog: [], notes: [], todos: [], todoCategories: [],
    projects: [], financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {} };
}

async function measure(browser, n, reps) {
  const runs = [];
  for (let r = 0; r < reps; r++) {
    const page = await browser.newPage({ viewport: { width: 460, height: 1100 } });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate((seed) => {
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline", timelineMode: "timeline" }));
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed));
      localStorage.removeItem("lifelog-visual-settings-v1");
    }, seedData(n));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const t0 = Date.now();
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".entry");
    const firstRow = Date.now() - t0;
    await page.waitForTimeout(4000);
    const m = await cdp.send("Performance.getMetrics");
    const get = (k) => { const e = m.metrics.find((x) => x.name === k); return e ? e.value : 0; };
    const dom = await page.evaluate(() => ({
      els: document.querySelectorAll("*").length,
      rows: document.querySelectorAll(".entry").length,
      rowEls: (() => {
        const r = document.querySelector(".entry");
        return r ? r.querySelectorAll("*").length + 1 : 0;
      })(),
    }));
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.close();
    runs.push({ firstRow, recalc: get("RecalcStyleDuration") * 1000, layout: get("LayoutDuration") * 1000,
      script: get("ScriptDuration") * 1000, ...dom });
  }
  const med = (k) => { const v = runs.map((x) => x[k]).sort((a, b) => a - b); return Math.round(v[v.length >> 1]); };
  return { entries: n, rows: runs[0].rows, els: runs[0].els, elsPerRow: runs[0].rowEls,
    firstRowMs: med("firstRow"), recalcStyleMs: med("recalc"),
    layoutMs: med("layout"), scriptMs: med("script") };
}

(async () => {
  const b = await chromium.launch();
  const rows = [];
  for (const n of [611, 300, 120, 60]) rows.push(await measure(b, n, 3));
  await b.close();
  console.log(["entries", "rows", "els", "elsPerRow", "firstRowMs", "recalcStyleMs", "layoutMs", "scriptMs"].join("\t"));
  for (const r of rows) console.log(Object.values(r).join("\t"));
})().catch((e) => { console.error(e); process.exit(1); });
