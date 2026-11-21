// Settings → Sync → Erase this device (2026-11). It used to be only the app
// lock's "forgot PIN" that could clear a device, so one that didn't sync had
// no way to start over. Erasing clears the data, its past saves, the
// connections and keys, keeps the look and the language, and reloads empty.
// Not synced, it asks for the word as well; synced, GitHub is left alone.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const doc = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], projects: [],
  notes: [{ id: "n1", title: "Secret plans", body: "x", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" }],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {}, exportedAt: "2026-11-01T00:00:00.000Z",
};
const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake", sha: "sha-remote" };

async function openApp(browser, { connect = false, lang = "en", width = 460 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const puts = [];
  await page.route("https://api.github.com/**", (route) => {
    const req = route.request(), url = req.url();
    const say = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "PUT") { puts.push(url); return say(200, { content: { sha: "sha-new" } }); }
    if (/\/repos\/someone\/lifelog-data$/.test(url)) return say(200, { default_branch: "main", private: true, size: 10 });
    if (/\/commits/.test(url)) return say(200, []);
    if (/\/contents\//.test(url)) return say(200, { sha: "sha-remote", encoding: "base64", content: Buffer.from(JSON.stringify(doc)).toString("base64") });
    return say(404, { message: "Not Found" });
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate(({ gh, connect, doc, lang }) => {
    localStorage.clear();
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(doc));
    localStorage.setItem("lifelog-media-settings-v1", JSON.stringify({ rawgKey: "secret-key" }));
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ theme: "light" }));
    localStorage.setItem("lifelog.lang", lang);
    localStorage.setItem("someone-elses-app", "keep me");
    if (connect) localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
  }, { gh: GH, connect, doc, lang });
  await page.reload({ waitUntil: "networkidle" });
  // A past save, as History keeps them: the whole log.
  await page.evaluate(() => new Promise((resolve) => {
    const q = indexedDB.open("lifelog");
    q.onsuccess = () => {
      const tx = q.result.transaction("history", "readwrite");
      tx.objectStore("history").put({ id: "hpast", savedAt: "2026-11-01T00:00:00.000Z", doc: { notes: [{ id: "n1", title: "Secret plans" }] } });
      tx.oncomplete = () => resolve();
    };
  }));
  return { ctx, page, errs, puts };
}

async function openSync(page) {
  await page.evaluate(() => window.LifeLogSettings.openSettings("sync"));
  await page.waitForSelector("#settingsModal:not([hidden])", { timeout: 6000 });
  await page.waitForFunction(() => document.querySelector("#eraseHint").textContent.length > 0, null, { timeout: 4000 });
}

const leftOver = (page) => page.evaluate(() => new Promise((resolve) => {
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) ls[localStorage.key(i)] = true;
  const q = indexedDB.open("lifelog");
  q.onsuccess = () => {
    const db = q.result;
    const tx = db.transaction(["handles", "history"], "readonly");
    const a = tx.objectStore("handles").count(), b = tx.objectStore("history").count();
    tx.oncomplete = () => resolve({ ls, handles: a.result, history: b.result, notes: (window.LifeLogStorage.cachedCopy() || {}).notes || [] });
  };
}));

async function erase(page, answers) {
  const asked = [];
  page.on("dialog", (d) => { asked.push(d.type()); const a = answers.shift(); a === false ? d.dismiss() : d.accept(typeof a === "string" ? a : undefined); });
  const nav = answers.length && answers[answers.length - 1] !== "wrong" ? page.waitForNavigation({ waitUntil: "networkidle", timeout: 10000 }).catch(() => null) : null;
  await page.click("#eraseDeviceBtn");
  if (nav) await nav; else await page.waitForTimeout(600);
  return asked;
}

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  try {
    // Not synced: the warning says it's for good, and the word is asked for.
    let a = await openApp(browser);
    await openSync(a.page);
    let hint = await a.page.textContent("#eraseHint");
    check("unsynced, the hint says this is the only copy", /only copy/.test(hint), hint);
    check("the row is there with nothing connected", await a.page.isVisible("#eraseDeviceBtn"));
    let asked = await erase(a.page, [true, "wrong"]);
    check("a wrong word erases nothing", asked.join() === "confirm,prompt", asked);
    let left = await leftOver(a.page);
    check("the data is still there", left.notes.length === 1 && left.ls["lifelog-media-settings-v1"], left);
    a.page.removeAllListeners("dialog");
    asked = await erase(a.page, [true, "erase"]);
    left = await leftOver(a.page);
    check("the word erases it: the notes are gone", left.notes.length === 0, left);
    check("and the past saves", left.history === 0, left);
    check("and the keys", !left.ls["lifelog-media-settings-v1"], Object.keys(left.ls));
    check("the look and the language stay", left.ls["lifelog-visual-settings-v1"] && left.ls["lifelog.lang"], Object.keys(left.ls));
    check("another app's keys on the same site stay", left.ls["someone-elses-app"], Object.keys(left.ls));
    check("the app opens empty", !(await a.page.evaluate(() => document.body.textContent.includes("Secret plans"))));
    errs.push(...a.errs);
    await a.ctx.close();

    // Synced: one confirm, GitHub's copy untouched, the connection forgotten.
    a = await openApp(browser, { connect: true });
    await openSync(a.page);
    hint = await a.page.textContent("#eraseHint");
    check("synced, the hint names GitHub and says it comes back", /GitHub/.test(hint) && /brings it back/.test(hint), hint);
    const before = a.puts.length;
    asked = await erase(a.page, [true]);
    check("synced, only a confirm", asked.join() === "confirm", asked);
    left = await leftOver(a.page);
    check("the GitHub connection is forgotten", !left.ls["lifelog-github-v1"], Object.keys(left.ls));
    check("and nothing was written to GitHub", a.puts.length === before, a.puts);
    check("the data on this device is gone", left.notes.length === 0, left);
    errs.push(...a.errs);
    await a.ctx.close();

    // Cancelled: nothing happens.
    a = await openApp(browser);
    await openSync(a.page);
    asked = await erase(a.page, [false, "wrong"]);
    left = await leftOver(a.page);
    check("cancelling the confirm asks nothing more and keeps the data", asked.join() === "confirm" && left.notes.length === 1, { asked, left });
    errs.push(...a.errs);
    await a.ctx.close();

    // The app lock's "forgot PIN" reset forgets the device too, and History's
    // past saves used to outlive it: each one the whole log, a tap from back.
    a = await openApp(browser);
    await a.page.evaluate(() => window.LifeLogStorage.forgetDevice());
    left = await leftOver(a.page);
    check("the lock reset's forget clears the past saves too", left.history === 0, left);
    errs.push(...a.errs);
    await a.ctx.close();

    // Hebrew, phone and wide.
    for (const width of [390, 1280]) {
      a = await openApp(browser, { lang: "he", width });
      await openSync(a.page);
      const r = await a.page.evaluate(() => {
        const b = document.querySelector("#eraseDeviceBtn");
        b.scrollIntoView();
        const box = b.getBoundingClientRect();
        return { label: b.textContent, hint: document.querySelector("#eraseHint").textContent, h: box.height, fits: box.right <= innerWidth + 1 && box.left >= -1 };
      });
      check(`Hebrew at ${width}: the row and hint are translated`, /[֐-׿]/.test(r.label) && /[֐-׿]/.test(r.hint), r);
      check(`Hebrew at ${width}: the row is a full tap target and fits`, r.h >= 44 && r.fits, r);
      if (process.env.SHOTS) await a.page.screenshot({ path: `${process.env.SHOTS}/erase-he-${width}.png` });
      errs.push(...a.errs);
      await a.ctx.close();
    }
    if (process.env.SHOTS) {
      for (const width of [390, 1280]) {
        a = await openApp(browser, { width });
        await openSync(a.page);
        await a.page.evaluate(() => document.querySelector("#eraseDeviceBtn").scrollIntoView());
        await a.page.screenshot({ path: `${process.env.SHOTS}/erase-en-${width}.png` });
        await a.ctx.close();
      }
    }
  } catch (e) {
    errs.push(String(e && e.stack || e));
  } finally {
    await browser.close();
    done(errs);
  }
})();
