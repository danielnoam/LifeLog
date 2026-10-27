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
      check("an opened sheet doesn't ask either, and shows no HLTB times" + at,
        asked.length === 0 && await page.evaluate(() => !/Main Story/.test(document.getElementById("backlogGameTimes").textContent)), asked);
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.LifeLogSettings.openSettings());
      await page.waitForTimeout(300);
      check("the switch reads Off" + at, await page.evaluate(() => document.getElementById("steamGameTimes").value === "off"));
      await page.evaluate(() => { const s = document.getElementById("steamGameTimes"); s.value = "7"; s.dispatchEvent(new Event("change")); });
      await page.waitForTimeout(300);
      check("and picking Every week is saved" + at, await page.evaluate(() => window.LifeLogStorage.cachedCopy().settings.steam.gameTimes === "7"));
      const due = await page.evaluate(() => {
        const ago = (n) => { const d = new Date(Date.now() - n * 864e5); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
        const game = (n) => ({ mediaSource: "steam", mediaId: "999", hltb: { story: 60, at: ago(n) } });
        return [window.LifeLogSync.gameTimesDue(game(3), {}), window.LifeLogSync.gameTimesDue(game(8), {})];
      });
      check("a week's interval re-asks times eight days old, not three" + at, JSON.stringify(due) === "[false,true]", due);
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
        scores: [...document.querySelectorAll("#backlogCoverScores .cover-score")].map((p) => p.textContent + "|" + p.getAttribute("aria-label") + "|" + !!p.getAttribute("href")),
        scoresTopLeft: (() => { const s = document.getElementById("backlogCoverScores").getBoundingClientRect(); return s.top - c.top < 12 && s.left - c.left < 12; })(),
        linksTopRight: (() => { const l = document.getElementById("backlogCoverLinks").getBoundingClientRect(); return l.top - c.top < 12 && c.right - l.right < 12; })(),
        noTextLine: !document.querySelector("#backlogCoverMeta .game-reviews"),
        meta: (document.querySelector("#backlogCoverMeta .bl-meta") || {}).textContent || "",
        row: document.getElementById("backlogGameTimesRow").hidden,
      };
    });
    check("the sheet shows the three times by name over the cover's foot" + at,
      sheet.shown && sheet.onCoverFoot && JSON.stringify(sheet.cells) === JSON.stringify(["Main Story=32 h", "Main + Extras=43 h", "Completionist=66½ h"]), sheet);
    check("the strip links to How Long to Beat and is a full tap target" + at, sheet.link === "https://howlongtobeat.com/game/139385" && sheet.tall, sheet);
    check("the scores are pills in the cover's top left, each with its site's name" + at,
      JSON.stringify(sheet.scores) === JSON.stringify(["OpenCritic 94|OpenCritic 94, Mighty|true", "Metacritic 85|Metacritic 85|true"]) && sheet.scoresTopLeft && sheet.noTextLine, sheet);
    check("the store links sit in the top right" + at, sheet.linksTopRight, sheet);
    const withCritic = await page.evaluate(() => {
      document.getElementById("bExternalRating").value = "95 Metacritic";
      window.LifeLogBacklog.setBacklogCover();
      const out = [...document.querySelectorAll("#backlogCoverScores .cover-score")].map((p) => p.textContent);
      document.getElementById("bExternalRating").value = "";
      window.LifeLogBacklog.setBacklogCover();
      return out;
    });
    check("with a Metacritic critic score, the user score stays out" + at, JSON.stringify(withCritic) === JSON.stringify(["Metacritic 95", "OpenCritic 94"]), withCritic);
    check("the meta line leaves out the length the times already show" + at, !/32 hrs/.test(sheet.meta) && sheet.row, sheet);
    await page.screenshot({ path: require("path").join(require("os").tmpdir(), "gametimes-" + width + ".png") });
    await page.click('#backlogForm button[type="submit"]');
    await page.waitForTimeout(400);
    b1 = await item("b1");
    check("saving the sheet keeps the times and scores" + at, b1.hltb && b1.hltb.story === 1920 && b1.reviews && b1.reviews.opencritic.score === 94 && b1.length === "32 hrs", b1);

    // ---- the entry sheet, no cover: a linked game gets the tinted block (0.283.0) ----
    await page.evaluate(() => window.LifeLogJournal.openEntryModal(window.LifeLogStorage.cachedCopy().entries.find((x) => x.id === "e1")));
    await page.waitForTimeout(400);
    const row = await page.evaluate(() => ({
      blank: document.querySelector("#entryCover .modal-cover").classList.contains("is-blank") && !document.getElementById("entryCover").hidden,
      cells: document.querySelectorAll("#entryGameTimes .game-time").length,
      reviews: [...document.querySelectorAll("#entryCoverScores .cover-score")].map((x) => x.textContent).join(),
    }));
    check("without art the times and scores sit on the tinted block" + at, row.blank && row.cells === 3 && row.reviews === "OpenCritic 90", row);
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
    const fresh = await page.evaluate(() => ({ length: document.getElementById("bLength").value, cells: document.querySelectorAll("#backlogGameTimes .game-time").length }));
    check("a sheet that links a Steam game asks for its times and fills the length" + at,
      asked.length === 1 && fresh.length === "32 hrs" && fresh.cells === 3, { asked, fresh });
    await page.click('#backlogForm button[type="submit"]');
    await page.waitForTimeout(400);
    const again = await page.evaluate(() => window.LifeLogStorage.cachedCopy().backlog.find((x) => x.title === "Hades II again"));
    check("and the new item saves them" + at, again && again.hltb && again.hltb.complete === 3990 && again.reviews && again.reviews.metauser.score === 85, again);

    // ---- other media show their length on the cover the same way ----
    const coverCells = (length, src) => page.evaluate(([length, src]) => {
      window.LifeLogBacklog.openBacklogModal({ id: "x", title: "X", category: "Games", coverUrl: "https://img.test/x.png", mediaSource: src, mediaId: "1", length, createdAt: "2026-01-01T00:00:00.000Z" });
      return new Promise((res) => setTimeout(() => res({
        cells: [...document.querySelectorAll("#backlogGameTimes .game-time")].map((c) => c.querySelector(".game-time-label").textContent + "=" + c.querySelector(".game-time-value").textContent),
        meta: (document.querySelector("#backlogCoverMeta .bl-meta") || {}).textContent || "",
      }), 300));
    }, [length, src]);
    let c = await coverCells("2 seasons · 20 episodes", "tmdb-tv");
    check("a show's seasons and episodes are cells on the cover" + at, JSON.stringify(c.cells) === JSON.stringify(["Seasons=2", "Episodes=20"]) && !/episodes/.test(c.meta), c);
    c = await coverCells("2h 10m", "tmdb-movie");
    check("a film's runtime is one cell" + at, JSON.stringify(c.cells) === JSON.stringify(["Runtime=2h 10m"]), c);
    c = await coverCells("320 pages", "openlibrary");
    check("a book's pages too" + at, JSON.stringify(c.cells) === JSON.stringify(["Pages=320"]), c);
    c = await coverCells("30 hrs", "rawg");
    check("and a game with only RAWG's playtime" + at, JSON.stringify(c.cells) === JSON.stringify(["Playtime=30 h"]), c);
    await page.keyboard.press("Escape");
    await page.close();
  }
  await b.close();
  done(errs);
})();
