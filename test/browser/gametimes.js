// Game times (0.282.0): Steam games get How Long to Beat's three times and
// the OpenCritic and Metacritic user scores through Augmented Steam's API on
// the proxy. Main Story becomes the length unless it's pinned, the sheet
// shows the times by name over the cover (or in a row without one), the
// scores under the meta line, and the Off switch asks nothing.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const ANSWERS = {
  1145350: {
    hltb: { story: 1920, extras: 2580, complete: 3990, url: "https://howlongtobeat.com/game/139385" },
    reviews: {
      metauser: { score: 85, verdict: null, url: "https://www.metacritic.com/game/hades-ii/?ref=augmentedsteam" },
      opencritic: { score: 94, verdict: "Mighty", url: "https://opencritic.com/game/14467/hades-ii?ref=augmentedsteam" },
    },
  },
  2379780: { hltb: { story: 1290, extras: 2700, complete: 6000, url: "https://howlongtobeat.com/game/131813" }, reviews: { opencritic: { score: 90, verdict: "Mighty", url: "https://opencritic.com/game/16466/balatro" } } },
};

const seed = (gameTimes) => ({
  categories: [{ name: "Games", color: "#3fb950" }],
  entries: [
    { id: "e1", title: "Balatro", category: "Games", year: 2026, month: 2, date: "2026-02", mediaSource: "steam", mediaId: "2379780", length: "4 hrs", overrides: { length: true }, createdAt: "2026-02-01T00:00:00.000Z" },
  ],
  backlog: [
    { id: "b1", title: "Hades II", category: "Games", mediaSource: "steam", mediaId: "1145350", coverUrl: "https://img.test/hades.png", length: "20 hrs", summary: "A roguelike.", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b3", title: "Hollow Knight", category: "Games", mediaSource: "rawg", mediaId: "hollow-knight", createdAt: "2026-01-03T00:00:00.000Z" },
  ],
  notes: [], accomplishments: {}, habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: { steam: { proxyUrl: "https://proxy.test", gameTimes } },
});

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const [width, gameTimes] of [[390, "on"], [1280, "on"], [1280, "off"]]) {
    const at = " (" + width + "px, " + gameTimes + ")";
    const page = await b.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    const asked = [];
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route("https://img.test/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await page.route("https://proxy.test/**", (r) => {
      const m = /\/augsteam-app\/(\d+)$/.exec(new URL(r.request().url()).pathname);
      if (m) asked.push(m[1]);
      const body = m && ANSWERS[m[1]] ? ANSWERS[m[1]] : {};
      r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    }, seed(gameTimes));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const item = (id) => page.evaluate((i) => {
      const d = window.LifeLogStorage.cachedCopy();
      return d.backlog.find((x) => x.id === i) || d.entries.find((x) => x.id === i);
    }, id);

    if (gameTimes === "off") {
      check("Off asks Augmented Steam nothing" + at, asked.length === 0, asked);
      check("and fills nothing in" + at, !(await item("b1")).hltb && (await item("b1")).length === "20 hrs", await item("b1"));
      await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(window.LifeLogStorage.cachedCopy().backlog.find((x) => x.id === "b1")));
      await page.waitForTimeout(500);
      check("an opened sheet doesn't ask either, and shows no times" + at,
        asked.length === 0 && await page.evaluate(() => document.getElementById("backlogGameTimes").hidden), asked);
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.LifeLogSettings.openSettings());
      await page.waitForTimeout(300);
      check("the switch reads Off" + at, await page.evaluate(() => document.getElementById("steamGameTimes").value === "off"));
      await page.selectOption("#steamGameTimes", "on").catch(() => page.evaluate(() => { const s = document.getElementById("steamGameTimes"); s.value = "on"; s.dispatchEvent(new Event("change")); }));
      await page.waitForTimeout(300);
      check("and turning it On is saved" + at, await page.evaluate(() => window.LifeLogStorage.cachedCopy().settings.steam.gameTimes === "on"));
      await page.close();
      continue;
    }

    // ---- the launch fill ----
    check("the launch fill asks once per Steam game, and not for a RAWG one" + at,
      asked.length === 2 && asked.includes("1145350") && asked.includes("2379780"), asked);
    let b1 = await item("b1");
    check("Main Story becomes the length" + at, b1.length === "32 hrs", b1.length);
    check("all three times are kept, with the page and the day" + at,
      b1.hltb && b1.hltb.story === 1920 && b1.hltb.extras === 2580 && b1.hltb.complete === 3990
      && b1.hltb.url === "https://howlongtobeat.com/game/139385" && /^\d{4}-\d{2}-\d{2}$/.test(b1.hltb.at), b1.hltb);
    check("both review scores are kept, with their links" + at,
      b1.reviews && b1.reviews.opencritic.score === 94 && b1.reviews.opencritic.verdict === "Mighty"
      && b1.reviews.metauser.score === 85 && /^https:\/\/www\.metacritic\.com\//.test(b1.reviews.metauser.url), b1.reviews);
    const e1 = await item("e1");
    check("a pinned length stays, and the times still land" + at, e1.length === "4 hrs" && e1.hltb && e1.hltb.story === 1290, e1);

    // ---- the backlog sheet, with a cover ----
    await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(window.LifeLogStorage.cachedCopy().backlog.find((x) => x.id === "b1")));
    await page.waitForTimeout(500);
    const sheet = await page.evaluate(() => {
      const box = document.getElementById("backlogGameTimes");
      const r = box.getBoundingClientRect(), c = box.closest(".modal-cover").getBoundingClientRect();
      const strip = box.querySelector(".game-times");
      return {
        shown: !box.hidden,
        cells: [...box.querySelectorAll(".game-time")].map((x) => x.querySelector(".game-time-label").textContent + "=" + x.querySelector(".game-time-value").textContent),
        onCoverFoot: Math.abs(r.bottom - c.bottom) < 1 && r.top >= c.top,
        tall: strip.getBoundingClientRect().height >= 44,
        link: strip.getAttribute("href"),
        hasTimes: box.closest(".modal-cover").classList.contains("has-times"),
        reviews: (document.querySelector("#backlogCoverMeta .game-reviews") || {}).textContent || "",
        reviewsBeforeSummary: !!document.querySelector("#backlogCoverMeta .game-reviews + .bl-summary"),
        meta: (document.querySelector("#backlogCoverMeta .bl-meta") || {}).textContent || "",
        row: document.getElementById("backlogGameTimesRow").hidden,
      };
    });
    check("the sheet shows the three times by name over the cover's foot" + at,
      sheet.shown && sheet.onCoverFoot && sheet.hasTimes && JSON.stringify(sheet.cells) === JSON.stringify(["Main Story=32 h", "Main + Extras=43 h", "Completionist=66½ h"]), sheet);
    check("the strip links to How Long to Beat and is a full tap target" + at, sheet.link === "https://howlongtobeat.com/game/139385" && sheet.tall, sheet);
    check("the scores sit under the meta line, above the summary" + at,
      sheet.reviews === "OpenCritic 94 · Metacritic users 85" && sheet.reviewsBeforeSummary, sheet);
    check("the meta line leaves out the length the times already show" + at, !/32 hrs/.test(sheet.meta) && sheet.row, sheet);
    await page.screenshot({ path: require("path").join(require("os").tmpdir(), "gametimes-" + width + ".png") });
    await page.click('#backlogForm button[type="submit"]');
    await page.waitForTimeout(400);
    b1 = await item("b1");
    check("saving the sheet keeps the times and scores" + at, b1.hltb && b1.hltb.story === 1920 && b1.reviews && b1.reviews.opencritic.score === 94 && b1.length === "32 hrs", b1);

    // ---- the entry sheet, no cover ----
    await page.evaluate(() => window.LifeLogJournal.openEntryModal(window.LifeLogStorage.cachedCopy().entries.find((x) => x.id === "e1")));
    await page.waitForTimeout(400);
    const row = await page.evaluate(() => ({
      shown: !document.getElementById("entryGameTimesRow").hidden,
      cells: document.querySelectorAll("#entryGameTimesRow .game-time").length,
      reviews: (document.querySelector("#entryMetaRow .game-reviews") || {}).textContent || "",
    }));
    check("without a cover the times sit in a row under the title" + at, row.shown && row.cells === 3 && row.reviews === "OpenCritic 90", row);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // ---- a game linked in the sheet asks there and then ----
    asked.length = 0;
    await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(null));
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.getElementById("bTitle").value = "Hades II again";
      document.getElementById("bMediaSource").value = "steam";
      document.getElementById("bMediaId").value = "1145350";
      window.LifeLogBacklog.setBacklogCover();
    });
    await page.waitForTimeout(600);
    const fresh = await page.evaluate(() => ({ length: document.getElementById("bLength").value, cells: document.querySelectorAll("#backlogGameTimesRow .game-time").length }));
    check("a sheet that links a Steam game asks for its times and fills the length" + at,
      asked.length === 1 && fresh.length === "32 hrs" && fresh.cells === 3, { asked, fresh });
    await page.click('#backlogForm button[type="submit"]');
    await page.waitForTimeout(400);
    const again = await page.evaluate(() => window.LifeLogStorage.cachedCopy().backlog.find((x) => x.title === "Hades II again"));
    check("and the new item saves them" + at, again && again.hltb && again.hltb.complete === 3990 && again.reviews && again.reviews.metauser.score === 85, again);
    await page.close();
  }
  await b.close();
  done(errs);
})();
