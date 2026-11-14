// IGDB time-to-beat as a stand-in for How Long to Beat: a Steam game
// Augmented Steam has no times for gets IGDB's, found through its Steam App
// ID, and a game picked from IGDB with no Steam App ID gets them by its IGDB
// id. Both show in the same strip, linked to IGDB and named so for a screen
// reader. Without IGDB keys nothing is asked of IGDB.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const TIMES = { 1942: { hastily: 6 * 3600, normally: 9 * 3600, completely: 20 * 3600 }, 500: { hastily: 30 * 3600, normally: 45 * 3600 } };

const seed = (withKeys) => ({
  categories: [{ name: "Games", color: "#3fb950" }],
  entries: [],
  backlog: [
    { id: "s1", title: "Steam game", category: "Games", mediaSource: "steam", mediaId: "620", coverUrl: "https://img.test/s.png", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "i1", title: "IGDB game", category: "Games", mediaSource: "igdb", mediaId: "500", length: "40 hrs", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "h1", title: "HLTB game", category: "Games", mediaSource: "steam", mediaId: "1145350", createdAt: "2026-01-03T00:00:00.000Z" },
  ],
  notes: [], accomplishments: {}, habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: {
    steam: { proxyUrl: "https://proxy.test", gameTimes: "30" },
    mediaKeys: withKeys ? { igdb: "clientid123", igdbSecret: "secret12345" } : {},
  },
});

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const [width, withKeys] of [[390, true], [1280, true], [1280, false]]) {
    const at = " (" + width + "px" + (withKeys ? "" : ", no IGDB keys") + ")";
    const page = await b.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    const igdb = [];
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.route("https://img.test/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await page.route("https://proxy.test/**", (r) => {
      const u = new URL(r.request().url());
      const q = u.searchParams.get("q") || "";
      let body = {};
      if (u.pathname === "/augsteam-app/1145350") body = { hltb: { story: 1920, extras: 2580, complete: 3990, url: "https://howlongtobeat.com/game/139385" } };
      else if (u.pathname === "/igdb-token") body = { access_token: "tok", expires_in: 5000000 };
      else if (u.pathname === "/igdb/external_games") { igdb.push("ext:" + q); body = /uid = "620"/.test(q) ? [{ game: 1942, external_game_source: 1 }] : []; }
      else if (u.pathname === "/igdb/game_time_to_beats") { const id = (/game_id = (\d+)/.exec(q) || [])[1]; igdb.push("ttb:" + id); body = TIMES[id] ? [TIMES[id]] : []; }
      r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
      localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "entries" }));
    }, seed(withKeys));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const item = (id) => page.evaluate((i) => window.LifeLogStorage.cachedCopy().backlog.find((x) => x.id === i), id);

    if (!withKeys) {
      check("without IGDB keys IGDB is asked nothing" + at, igdb.length === 0, igdb);
      const i1 = await item("i1"), s1 = await item("s1");
      check("and the IGDB game and the timeless Steam game get no IGDB times" + at,
        !i1.hltb && i1.length === "40 hrs" && !(s1.hltb && s1.hltb.story), { i1, s1 });
      await page.close();
      continue;
    }

    check("IGDB is asked for the timeless Steam game by App ID and the IGDB game by id, not for the one HLTB knows" + at,
      igdb.some((x) => /^ext:.*uid = "620"/.test(x)) && igdb.includes("ttb:1942") && igdb.includes("ttb:500") && !igdb.some((x) => /1145350/.test(x)), igdb);
    const s1 = await item("s1"), i1 = await item("i1"), h1 = await item("h1");
    check("the Steam game keeps IGDB's three times, marked IGDB, with its IGDB page" + at,
      s1.hltb && s1.hltb.story === 360 && s1.hltb.extras === 540 && s1.hltb.complete === 1200 && s1.hltb.from === "igdb"
      && s1.hltb.url === "https://www.igdb.com/g/1hy" && s1.length === "6 hrs", s1);
    check("the IGDB game gets its times, and Main Story becomes the length" + at,
      i1.hltb && i1.hltb.story === 1800 && i1.hltb.extras === 2700 && !i1.hltb.complete && i1.hltb.from === "igdb" && i1.length === "30 hrs", i1);
    check("How Long to Beat's own times are untouched" + at, h1.hltb && h1.hltb.story === 1920 && !h1.hltb.from, h1);

    await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(window.LifeLogStorage.cachedCopy().backlog.find((x) => x.id === "s1")));
    await page.waitForTimeout(500);
    const sheet = await page.evaluate(() => {
      const strip = document.querySelector("#backlogGameTimes .game-times");
      return strip && {
        cells: [...strip.querySelectorAll(".game-time")].map((x) => x.querySelector(".game-time-label").textContent + "=" + x.querySelector(".game-time-value").textContent),
        link: strip.getAttribute("href"),
        label: strip.getAttribute("aria-label"),
      };
    });
    check("the sheet's strip shows IGDB's times by the same names" + at,
      sheet && JSON.stringify(sheet.cells) === JSON.stringify(["Main Story=6 h", "Main + Extras=9 h", "Completionist=20 h"]), sheet);
    check("and links to IGDB, saying so" + at, sheet && sheet.link === "https://www.igdb.com/g/1hy" && /^IGDB: .*Opens IGDB$/.test(sheet.label), sheet);
    await page.screenshot({ path: require("path").join(require("os").tmpdir(), "igdbtimes-" + width + ".png") });
    await page.click('#backlogForm button[type="submit"]');
    await page.waitForTimeout(400);
    const saved = await item("s1");
    check("saving the sheet keeps the IGDB mark and page" + at, saved.hltb && saved.hltb.from === "igdb" && saved.hltb.url === "https://www.igdb.com/g/1hy", saved);

    // A game linked in the sheet from IGDB asks there and then.
    igdb.length = 0;
    await page.evaluate(() => window.LifeLogBacklog.openBacklogModal(null));
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.getElementById("bTitle").value = "Celeste";
      document.getElementById("bMediaSource").value = "igdb";
      document.getElementById("bMediaId").value = "1942";
      window.LifeLogBacklog.setBacklogCover();
    });
    await page.waitForTimeout(700);
    const fresh = await page.evaluate(() => ({ length: document.getElementById("bLength").value, cells: document.querySelectorAll("#backlogGameTimes .game-time, #backlogGameTimesRow .game-time").length }));
    check("a sheet that links an IGDB game asks for its times and fills the length" + at,
      igdb.includes("ttb:1942") && fresh.length === "6 hrs" && fresh.cells === 3, { igdb, fresh });
    await page.click('#backlogForm button[type="submit"]');
    await page.waitForTimeout(400);
    const again = await page.evaluate(() => window.LifeLogStorage.cachedCopy().backlog.find((x) => x.title === "Celeste"));
    check("and the new item saves them" + at, again && again.hltb && again.hltb.from === "igdb" && again.hltb.complete === 1200, again);
    await page.close();
  }
  await b.close();
  done(errs);
})();
