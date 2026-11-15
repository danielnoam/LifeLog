// Settings → Sync → Google Drive backups (src/drive.js). With no client ID
// in this copy the section isn't there. With Drive standing in (a fake
// LifeLogDrive, so no Google), Back up now sends the data without its keys,
// the list shows each backup with Restore and Delete, and Restore puts the
// backup's data back while this device's keys stay.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const doc = {
  categories: [{ name: "Games", kind: "games" }], entries: [{ id: "e-now", title: "Today's entry", date: "2026-11-15", category: "Games" }],
  backlog: [], notes: [], todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], accomplishments: {},
  settings: { steam: { apiKey: "steam-secret" }, mediaKeys: { rawg: "rawg-secret" } }, exportedAt: "2026-11-01T00:00:00.000Z",
};
const backup = {
  ...doc, entries: [{ id: "e-old", title: "From the backup", date: "2026-11-01", category: "Games" }],
  settings: { steam: { apiKey: "" }, mediaKeys: { rawg: "" } }, boards: [], backupOf: "lifelog", backedUpAt: "2026-11-01T10:00:00.000Z",
};

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 460, height: 1000 }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    page.on("dialog", (d) => d.accept());
    await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (r) => r.abort());
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await forgetCopy(page);
    await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify(d)); }, doc);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.LifeLogDrive && window.LifeLogSettings);

    await page.evaluate(() => window.LifeLogSettings.openSettings("sync"));
    await page.waitForSelector("#settingsModal:not([hidden])", { timeout: 6000 });
    check("with no client ID the section isn't there", await page.evaluate(() => document.querySelector("#driveSection").hidden));

    // Drive, standing in.
    await page.evaluate((backup) => {
      const real = window.LifeLogDrive;
      const files = [{ id: "b1", name: "lifelog-2026-11-01-1000.json", size: 2048, at: Date.parse(backup.backedUpAt), from: "Pixel 8" }];
      const fake = window.__fakeDrive = { sent: [], removed: [], on: false, auto: true, every: 7, email: "", last: null };
      window.LifeLogDrive = {
        ...real, available: true, signedIn: true, closing: false, resume: "", due: false,
        get on() { return fake.on; }, get email() { return fake.email; }, get last() { return fake.last; },
        get auto() { return fake.auto; }, set auto(v) { fake.auto = v; }, get every() { return fake.every; }, set every(v) { fake.every = v; },
        async getToken() { return "tok"; },
        async connect() { fake.on = true; fake.email = "you@example.com"; return fake.email; },
        async disconnect() { fake.on = false; },
        async list() { return files.slice(); },
        async upload(text, device) { fake.sent.push({ text, device }); const f = { id: "b" + (files.length + 1), name: "new.json", size: text.length, at: Date.now(), from: device }; files.unshift(f); fake.last = f; return f; },
        async download(id) { return JSON.parse(JSON.stringify(backup)); },
        async remove(id) { fake.removed.push(id); files.splice(files.findIndex((f) => f.id === id), 1); },
      };
      window.LifeLogSettings.openSettings("sync");
    }, backup);
    await page.waitForFunction(() => !document.querySelector("#driveSection").hidden, null, { timeout: 4000 });
    check("not connected: Connect shows, the rest doesn't", await page.evaluate(() =>
      !document.querySelector("#driveConnectBtn").hidden && document.querySelector("#driveBackupBtn").hidden && document.querySelector("#driveInfo").textContent === "Off"));

    await page.click("#driveConnectBtn");
    await page.waitForFunction(() => !document.querySelector("#driveList").hidden, null, { timeout: 4000 });
    const shown = await page.evaluate(() => ({
      info: document.querySelector("#driveInfo").textContent,
      rows: [...document.querySelectorAll("#driveList .drive-row")].map((r) => r.querySelector(".sitem-sub").textContent),
      every: document.querySelector("#driveEvery").value, auto: document.querySelector("#driveAuto").checked,
    }));
    check("connected: the account and no backup yet", /you@example\.com · no backup yet/.test(shown.info), shown);
    check("the backup in Drive is listed with its size and device", shown.rows.length === 1 && /2 KB · from Pixel 8/.test(shown.rows[0]), shown);
    check("weekly and automatic to start with", shown.every === "7" && shown.auto, shown);

    await page.selectOption("#driveEvery", "1");
    check("How often is kept", await page.evaluate(() => window.__fakeDrive.every === 1));

    await page.click("#driveBackupBtn");
    await page.waitForFunction(() => window.__fakeDrive.sent.length === 1, null, { timeout: 4000 });
    const sent = await page.evaluate(() => JSON.parse(window.__fakeDrive.sent[0].text));
    check("the backup carries the entries", sent.entries.length === 1 && sent.entries[0].id === "e-now", sent.entries);
    check("but not the keys", sent.settings.steam.apiKey === "" && sent.settings.mediaKeys.rawg === "", sent.settings);
    check("and is marked as a LifeLog backup, with boards", sent.backupOf === "lifelog" && Array.isArray(sent.boards), Object.keys(sent));
    await page.waitForFunction(() => document.querySelectorAll("#driveList .drive-row").length === 2, null, { timeout: 4000 });
    check("the new one is listed first", await page.evaluate(() => /from Browser/.test(document.querySelector("#driveList .drive-row .sitem-sub").textContent)));

    // Restore the old one.
    await page.locator("#driveList .drive-row").nth(1).getByRole("button", { name: "Restore" }).click();
    await page.waitForFunction(() => { const c = window.LifeLogStorage.cachedCopy(); const d = c && (c.data || c); return d && d.entries.some((e) => e.id === "e-old"); }, null, { timeout: 6000 });
    const after = await page.evaluate(() => { const c = window.LifeLogStorage.cachedCopy(); return c.data || c; });
    check("restore puts the backup's entries back", after.entries.length === 1 && after.entries[0].id === "e-old", after.entries);
    check("and keeps this device's keys", after.settings.steam.apiKey === "steam-secret" && after.settings.mediaKeys.rawg === "rawg-secret", after.settings);
    check("restore leaves no bookkeeping fields in the data", !("backupOf" in after) && !("boards" in after), Object.keys(after));

    await page.locator("#driveList .drive-row").nth(1).getByRole("button", { name: /Delete/ }).click();
    await page.waitForFunction(() => window.__fakeDrive.removed.length === 1, null, { timeout: 4000 });
    check("Delete removes that backup", await page.evaluate(() => window.__fakeDrive.removed[0] === "b1" && document.querySelectorAll("#driveList .drive-row").length === 1));

    const tap = await page.evaluate(() => {
      const r = document.querySelector("#driveList .drive-row .btn-small").getBoundingClientRect();
      return r.height;
    });
    check("the row's buttons line up in the row", tap > 0, tap);

    await page.click("#driveDisconnectBtn");
    await page.waitForFunction(() => !document.querySelector("#driveConnectBtn").hidden, null, { timeout: 4000 });
    check("Disconnect goes back to Connect", await page.evaluate(() => document.querySelector("#driveList").hidden && document.querySelector("#driveBackupBtn").hidden));
    await ctx.close();
  } catch (e) {
    errs.push(String(e && e.stack || e));
  } finally {
    await browser.close();
  }
  check("no page errors", !errs.length, errs);
  done();
})();
