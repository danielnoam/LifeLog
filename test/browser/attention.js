const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();
const errs = [];

// One of each kind of unfinished thing, plus items that must NOT be counted.
const SEED = {
  categories: [{ id: "g", name: "Games", color: "#5b8cff" }, { id: "a", name: "Art", color: "#e2b23b" }],
  financeCategories: [{ id: "f", name: "Food", color: "#4bd07a" }],
  projects: [{ id: "p1", name: "Switzerland", color: "#e2b23b", createdAt: "2026-05-01T00:00:00.000Z" }],
  backlog: [
    // Steam import whose title lookup never came back.
    { id: "s1", title: "Steam app 440", category: "Games", mediaSource: "steam", mediaId: "440", createdAt: "2026-01-01T00:00:00.000Z" },
    // In a category with a source, missing everything a sync could fill.
    { id: "m1", title: "Hollow Thing", category: "Games", createdAt: "2026-01-02T00:00:00.000Z" },
    // Complete — must not be counted.
    { id: "ok1", title: "Complete One", category: "Games", coverUrl: "c.png", externalRating: "90",
      length: "10h", releaseYear: 2020, releaseDate: "2020-01-01", releaseStatus: "released",
      summary: "s", genres: ["RPG"], mediaSource: "rawg", mediaId: "1", createdAt: "2026-01-03T00:00:00.000Z" },
    // Incomplete but in a category with NO media source — not a gap, just
    // not that kind of thing. Must not be counted.
    { id: "art1", title: "A Sketchbook", category: "Art", createdAt: "2026-01-04T00:00:00.000Z" },
  ],
  financeEntries: [
    // On a project, not yet converted → provisional.
    { id: "f1", date: "2026-06-04", amount: 120, category: "Food", note: "train", project: "Switzerland",
      currency: "CHF", rate: 4.1, fxAmount: 29.27, createdAt: "2026-06-04T00:00:00.000Z" },
    // Foreign but settled — must not be counted.
    { id: "f2", date: "2026-06-05", amount: 80, category: "Food", note: "dinner", project: "Switzerland",
      currency: "CHF", rate: 4.1, fxAmount: 19.51, rateConfirmed: true, createdAt: "2026-06-05T00:00:00.000Z" },
    // Home currency — must not be counted.
    { id: "f3", date: "2026-06-06", amount: 20, category: "Food", note: "home", createdAt: "2026-06-06T00:00:00.000Z" },
  ],
  entries: [], notes: [], todos: [], todoCategories: [], recurringExpenses: [],
  settings: { currency: "ILS", mediaCategorySources: { Games: "rawg" } },
};
const CLEAN = { ...SEED, backlog: [SEED.backlog[2]], financeEntries: [SEED.financeEntries[1], SEED.financeEntries[2]] };

const load = async (page, seed) => {
  await page.evaluate((s) => {
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
  }, seed);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
};
const pill = (page) => page.evaluate(() => {
  const p = document.querySelector("#attentionPill");
  return { exists: !!p, hidden: p ? p.hidden : null, text: p ? p.textContent : "",
           h: p && !p.hidden ? Math.round(p.getBoundingClientRect().height) : 0 };
});
const panel = (page) => page.evaluate(() => ({
  open: !document.querySelector("#attentionModal").hidden,
  groups: [...document.querySelectorAll(".attn-group")].map((g) => ({
    label: g.querySelector(".attn-label").textContent,
    count: g.querySelector(".attn-count").textContent,
    names: g.querySelector(".attn-names").textContent,
  })),
}));

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 460, height: 950 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });

  // ---- nothing outstanding: no chrome at all ----
  await load(page, CLEAN);
  let p = await pill(page);
  check("with nothing outstanding the pill takes no room", p.exists && p.hidden === true && p.h === 0, p);

  // ---- with gaps: a count, and only the real ones ----
  await load(page, SEED);
  p = await pill(page);
  check("with gaps it appears and counts them", p.hidden === false && /^\u26a0 3$/.test(p.text.trim()), p);
  // The header is tight on a phone: a spelled-out pill ate the search field.
  const fit = await page.evaluate(() => {
    const s2 = document.querySelector("#search").getBoundingClientRect();
    const pl = document.querySelector("#attentionPill").getBoundingClientRect();
    return { searchW: Math.round(s2.width), pillW: Math.round(pl.width),
             onScreen: Math.round(pl.right) <= innerWidth };
  });
  // The header is tight on a phone: spelled out, this pill ate the search field.
  check("it stays a count, so the search keeps its room and the pill fits",
    fit.pillW < 60 && fit.searchW > 150 && fit.onScreen, fit);

  await page.evaluate(() => document.querySelector("#attentionPill").click());
  await page.waitForTimeout(300);
  let v = await panel(page);
  check("pressing it opens the panel", v.open === true, v);
  check("with one group per kind of gap", v.groups.length === 3, v.groups);
  const by = Object.fromEntries(v.groups.map((g) => [g.label.split(" ")[0], g]));
  check("the unresolved Steam import is listed", by.Steam && by.Steam.count === "1", v.groups);
  check("so is the backlog item a sync could fill", by.Backlog && by.Backlog.count === "1", v.groups);
  check("and the expense still on a guessed rate", by.Expenses && by.Expenses.count === "1", v.groups);
  check("each group names what it found", /Steam app 440/.test(by.Steam.names) && /Hollow Thing/.test(by.Backlog.names), v.groups);
  // One item, one problem: the Steam placeholder is genuinely incomplete too,
  // but listing it twice would make two things out of one.
  check("an item claimed by a more specific group isn't counted again",
    !/Steam app 440/.test(by.Backlog.names), v.groups);

  // ---- the exclusions are the whole point ----
  check("a complete backlog item is not a gap", !/Complete One/.test(JSON.stringify(v.groups)), v.groups);
  check("nor is an incomplete one whose category has no source — nothing could fill it",
    !/Sketchbook/.test(JSON.stringify(v.groups)), v.groups);
  check("nor a settled foreign expense", !/dinner/.test(JSON.stringify(v.groups)), v.groups);
  check("nor one in your own currency", !/home/.test(JSON.stringify(v.groups)), v.groups);

  // ---- the buttons go somewhere ----
  const jumped = await page.evaluate(async () => {
    const g = [...document.querySelectorAll(".attn-group")].find((x) => /Expenses/.test(x.querySelector(".attn-label").textContent));
    g.querySelector("button").click();
    await new Promise((r) => setTimeout(r, 400));
    return { view: JSON.parse(localStorage.getItem("lifelog-ui-v1")).view,
             panelOpen: !document.querySelector("#attentionModal").hidden };
  });
  check("'Take me there' switches to the right view", jumped.view === "finance", jumped);
  check("and closes the panel behind it", jumped.panelOpen === false, jumped);

  const toMedia = await page.evaluate(async () => {
    document.querySelector("#attentionPill").click();
    await new Promise((r) => setTimeout(r, 250));
    const g = [...document.querySelectorAll(".attn-group")].find((x) => /Steam/.test(x.querySelector(".attn-label").textContent));
    g.querySelector("button").click();
    await new Promise((r) => setTimeout(r, 400));
    const active = document.querySelector(".stab.active");
    return { settings: !document.querySelector("#settingsModal").hidden, tab: active ? active.dataset.stab : null };
  });
  check("the Steam one opens Settings on the tab that can fix it",
    toMedia.settings === true && toMedia.tab === "media", toMedia);

  // ---- it follows the data ----
  await page.evaluate(() => { document.querySelector("#settingsModal").hidden = true; });
  await load(page, CLEAN);
  p = await pill(page);
  check("clearing the gaps takes the pill away again", p.hidden === true, p);

  await b.close();
  done(errs);
})();
