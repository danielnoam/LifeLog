// Sheets without cover art (0.283.0): an item linked to a source gets a block
// in its category's tint where the cover would be, with the scores, links and
// times on it; a plain item keeps the sheet without one; a dead cover link
// falls back to the block.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const T = "2026-01-01T00:00:00.000Z";
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.route("https://**", (r) => r.abort());
  await page.goto(BASE + "/", { waitUntil: "load" });
  await forgetCopy(page);
  await page.evaluate((T) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify({
    categories: [{ name: "Games", color: "#3fb950" }, { name: "Gym", color: "#e2723b" }],
    entries: [{ id: "e1", date: "2026-10-20", title: "Leg day", category: "Gym", createdAt: T }],
    backlog: [
      { id: "g", title: "Hades II", category: "Games", mediaSource: "steam", mediaId: "1145350", externalRating: "95 Metacritic", hltb: { story: 1920, extras: 2580, complete: 3990, at: "2099-01-01" }, createdAt: T },
      { id: "d", title: "Dead link", category: "Games", mediaSource: "steam", mediaId: "1", coverUrl: "https://img.invalid/x.png", createdAt: T }],
    notes: [], settings: { steam: { gameTimes: "off" } } })); }, T);
  await page.reload({ waitUntil: "load" }); await page.waitForTimeout(800);
  const look = () => page.evaluate(() => {
    const m = document.querySelector(".modal-overlay:not([hidden]) .modal");
    const wrap = m.querySelector("[id$=Cover]"), box = wrap && wrap.querySelector(".modal-cover");
    return { shown: !!wrap && !wrap.hidden, blank: !!box && box.classList.contains("is-blank"), bg: box ? box.style.background : "",
      scores: m.querySelectorAll(".modal-cover-scores .cover-score").length, links: m.querySelectorAll(".modal-cover-links a").length,
      times: !!m.querySelector(".game-times-wrap:not([hidden]) .game-times") };
  });
  const openItem = (id) => page.evaluate((id) => window.LifeLogBacklog.openBacklogModal(window.LifeLogStorage.cachedCopy().backlog.find((x) => x.id === id)), id);

  await openItem("g"); await page.waitForTimeout(300);
  let s = await look();
  check("a linked item with no art gets the tinted block", s.shown && s.blank && /rgba?\(63, 185, 80/.test(s.bg), s);
  check("with its scores, links and times on it", s.scores === 1 && s.links >= 1 && s.times, s);
  await page.selectOption("#bCategory", "Gym");
  check("the tint follows the category", /rgba?\(226, 114, 59/.test((await look()).bg));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  await openItem("d"); await page.waitForTimeout(800);
  s = await look();
  check("a dead cover link falls back to the block", s.shown && s.blank, s);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  await page.evaluate(() => window.LifeLogJournal.openEntryModal(window.LifeLogStorage.cachedCopy().entries[0]));
  await page.waitForTimeout(300);
  check("a plain entry keeps the sheet without a block", !(await look()).shown);

  await b.close();
  done(errs);
})();
