// The phone backup (0.215.0): in the Android app, every save also lands in
// the phone's shared Documents/LifeLog, with a copy a day kept for two weeks.
//
// The bridge is faked as native.js does it, with a Filesystem that keeps
// what it's given in memory, so the test can read back what a phone's Files
// app would see. What it can't prove is that Android lets the app write
// there — that's the manifest's job (test/nativebuild.test.js).
const { chromium, BASE, tally, settled } = require("./harness");
const { check, done } = tally();

const BUILD = { version: "0.0.0", repo: "someone/lifelog", webUrl: "https://someone.github.io/lifelog/" };
const DOC = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], projects: [], habits: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], accomplishments: {},
  settings: { mediaKeys: { rawg: "rawg-secret", tmdb: "" }, steam: { apiKey: "steam-secret", steamId: "7656" } },
  notes: [{ id: "n1", text: "Already here", createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z" }],
};

const FAKE_BRIDGE = () => {
  window.__files = JSON.parse(sessionStorage.getItem("__files") || "{}");
  window.__perm = window.__perm || "granted";
  const keep = () => sessionStorage.setItem("__files", JSON.stringify(window.__files));
  const key = (directory, path) => directory + ":" + path;
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      App: { addListener: () => Promise.resolve({ remove() {} }), minimizeApp: () => Promise.resolve() },
      Filesystem: {
        requestPermissions: async () => ({ publicStorage: window.__perm }),
        writeFile: async ({ path, data, directory }) => { window.__files[key(directory, path)] = data; keep(); return { uri: "file:///" + path }; },
        readdir: async ({ path, directory }) => {
          const pre = key(directory, path) + "/";
          return { files: Object.keys(window.__files).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes("/"))
            .map((k) => ({ name: k.slice(pre.length), type: "file" })) };
        },
        deleteFile: async ({ path, directory }) => { delete window.__files[key(directory, path)]; keep(); },
      },
    },
  };
};

const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

async function open(b, native) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  if (native) await page.addInitScript(FAKE_BRIDGE);
  await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BUILD) }));
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((d) => {
    localStorage.clear();
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(d));
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
  }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

async function openSync(page) {
  await page.click("#settingsBtn");
  await page.waitForTimeout(300);
  await page.click('.srow[data-page="sync"]');
  await page.waitForTimeout(300);
}

(async () => {
  const b = await chromium.launch();
  const allErrs = [];

  // ---- in the app ----
  {
    const { ctx, page, errs } = await open(b, true);
    const files = () => page.evaluate(() => window.__files);
    await openSync(page);
    check("in the app, Sync offers the phone backup instead of a file this phone can't keep", await page.evaluate(() =>
      !document.getElementById("phoneBackupSection").hidden && document.getElementById("backupFileSection").hidden));
    check("and it starts off", await page.evaluate(() => !document.getElementById("phoneBackupSwitch").checked));
    check("so nothing has been written", Object.keys(await files()).length === 0, await files());

    // Twenty old days already there: turning it on keeps the newest fourteen.
    await page.evaluate(() => {
      for (let i = 1; i <= 20; i++) window.__files["DOCUMENTS:LifeLog/daily/lifelog-2025-01-" + String(i).padStart(2, "0") + ".json"] = "{}";
    });
    await page.click('label:has(#phoneBackupSwitch)');
    await page.waitForTimeout(500);
    let f = await files();
    const latest = f["DOCUMENTS:LifeLog/lifelog.json"];
    check("turning it on writes a copy at once, to Documents/LifeLog", !!latest && JSON.parse(latest).notes[0].text === "Already here", Object.keys(f));
    check("and today's copy beside it", !!f["DOCUMENTS:LifeLog/daily/lifelog-" + today() + ".json"], Object.keys(f));
    // The copy is for handing around, so the API keys are blanked in it
    // (0.260.0); the Steam ID is not a secret and stays.
    const copy = latest ? JSON.parse(latest) : {};
    check("with the API keys blanked and the rest of settings kept",
      copy.settings && copy.settings.mediaKeys.rawg === "" && copy.settings.steam.apiKey === "" && copy.settings.steam.steamId === "7656",
      copy.settings);
    check("while the app's own copy still has them", await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem("lifelog-cache-v1"));
      return d.settings.mediaKeys.rawg === "rawg-secret" && d.settings.steam.apiKey === "steam-secret";
    }));
    const daily = Object.keys(f).filter((k) => k.includes("/daily/"));
    check("keeping fourteen days, oldest gone first", daily.length === 14 && !f["DOCUMENTS:LifeLog/daily/lifelog-2025-01-07.json"]
      && !!f["DOCUMENTS:LifeLog/daily/lifelog-2025-01-08.json"], daily.sort());
    check("the row says where and when", await page.evaluate(() =>
      /Documents\/LifeLog · saved/.test(document.getElementById("phoneBackupInfo").textContent)),
      await page.evaluate(() => document.getElementById("phoneBackupInfo").textContent));
    check("and the Sync row mentions it", await page.evaluate(() =>
      /backed up on this phone/.test(document.querySelector('.srow[data-page="sync"] .srow-status').textContent)));

    // An edit reaches the backup like any save.
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.evaluate(() => window.LifeLogNotes.openNoteModal(null));
    await page.waitForTimeout(250);
    await page.fill("#nText", "Written after turning it on");
    await page.click('#noteForm button[type="submit"]');
    await settled(page);
    await page.waitForTimeout(600);
    f = await files();
    check("a new note is in the backup after it's saved", /Written after turning it on/.test(f["DOCUMENTS:LifeLog/lifelog.json"] || ""));

    // Off: saves stop reaching it; what's there stays.
    await openSync(page);
    await page.click('label:has(#phoneBackupSwitch)');
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.evaluate(() => window.LifeLogNotes.openNoteModal(null));
    await page.waitForTimeout(250);
    await page.fill("#nText", "After turning it off");
    await page.click('#noteForm button[type="submit"]');
    await settled(page);
    await page.waitForTimeout(600);
    f = await files();
    check("turned off, saves stop reaching it and the last copy stays", !/After turning it off/.test(f["DOCUMENTS:LifeLog/lifelog.json"] || "")
      && /Written after turning it on/.test(f["DOCUMENTS:LifeLog/lifelog.json"] || ""));

    // Refused storage (Android 9 and earlier): it says so and stays off.
    await openSync(page);
    await page.evaluate(() => { window.__perm = "denied"; });
    await page.click('label:has(#phoneBackupSwitch)');
    await page.waitForTimeout(400);
    check("refused storage leaves it off and says why", await page.evaluate(() =>
      !document.getElementById("phoneBackupSwitch").checked && /wasn't allowed/.test(document.getElementById("toast").textContent)),
      await page.evaluate(() => document.getElementById("toast").textContent));
    allErrs.push(...errs);
    await ctx.close();
  }

  // ---- in a browser ----
  {
    const { ctx, page, errs } = await open(b, false);
    await openSync(page);
    check("in a browser there's no phone backup, and the file is where it was", await page.evaluate(() =>
      document.getElementById("phoneBackupSection").hidden && !document.getElementById("backupFileSection").hidden));
    allErrs.push(...errs);
    await ctx.close();
  }

  await b.close();
  done(allErrs);
})();
