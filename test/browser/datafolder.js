// Settings → Desktop → Data folder (the Windows app): shows the folder the
// shell is using, moves only after a confirm, keeps the choice when the
// folder picker is cancelled, and stays hidden where the shell has no choice.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const DOC = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], projects: [], habits: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {}, notes: [],
};

const FAKE_TAURI = (folder) => {
  window.__t = { calls: [], relaunched: 0, pick: null, confirms: [] };
  window.confirm = (m) => { window.__t.confirms.push(m); return window.__t.answer !== false; };
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        window.__t.calls.push([cmd, args]);
        if (cmd === "data_folder") return folder;
        if (cmd === "choose_data_folder") return args.mode !== folder.mode || (args.custom && args.custom !== folder.dir);
        if (cmd === "remove_old_data_copy") { folder.old = null; return null; }
        return null;
      },
    },
    dialog: { open: async () => window.__t.pick },
    process: { relaunch: async () => { window.__t.relaunched++; } },
  };
};

const FOLDER = {
  mode: "lifelog", dir: "C:\\Users\\d\\AppData\\Local\\LifeLog\\data", custom: "",
  lifelog: "C:\\Users\\d\\AppData\\Local\\LifeLog\\data", appdata: "C:\\Users\\d\\AppData\\Local\\io.github.danielnoam.lifelog",
  old: "C:\\Users\\d\\AppData\\Local\\io.github.danielnoam.lifelog\\EBWebView-old", note: "",
};

async function open(b, folder) {
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.addInitScript(FAKE_TAURI, folder);
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify(d)); }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  await page.click('.srow[data-page="desktop"]'); await page.waitForTimeout(400);
  return { page, errs };
}

(async () => {
  const b = await chromium.launch();

  const { page, errs } = await open(b, FOLDER);
  const shown = await page.evaluate(() => ({
    hidden: document.getElementById("dataFolderGroup").hidden,
    mode: document.getElementById("dataFolderMode").value,
    path: document.getElementById("dataFolderPath").textContent,
    oldHidden: document.getElementById("dataFolderOldRow").hidden,
    noteHidden: document.getElementById("dataFolderNote").hidden,
  }));
  check("the group shows on the Windows app", !shown.hidden, shown);
  check("with the folder in use and its choice", shown.mode === "lifelog" && shown.path === FOLDER.dir, shown);
  check("and the copy from before the move", !shown.oldHidden, shown);
  check("no warning when the shell had nothing to say", shown.noteHidden, shown);

  await page.evaluate(() => { window.__t.answer = false; });
  await page.selectOption("#dataFolderMode", "appdata"); await page.waitForTimeout(200);
  let t = await page.evaluate(() => window.__t);
  check("a change asks first, naming the folder", t.confirms.length === 1 && t.confirms[0].includes("io.github.danielnoam.lifelog"), t.confirms);
  check("saying no moves nothing", !t.calls.some(([c]) => c === "choose_data_folder") && t.relaunched === 0, t);
  check("and puts the choice back", (await page.inputValue("#dataFolderMode")) === "lifelog");

  await page.evaluate(() => { window.__t.answer = true; window.__t.pick = null; });
  await page.selectOption("#dataFolderMode", "custom"); await page.waitForTimeout(200);
  t = await page.evaluate(() => window.__t);
  check("a cancelled folder picker changes nothing", !t.calls.some(([c]) => c === "choose_data_folder") && (await page.inputValue("#dataFolderMode")) === "lifelog", t);

  await page.evaluate(() => { window.__t.pick = "D:\\LifeLog"; });
  await page.selectOption("#dataFolderMode", "custom"); await page.waitForTimeout(200);
  t = await page.evaluate(() => window.__t);
  const chose = t.calls.find(([c]) => c === "choose_data_folder");
  check("a picked folder is passed on", chose && chose[1].mode === "custom" && chose[1].custom === "D:\\LifeLog", chose);
  check("and LifeLog restarts to move it", t.relaunched === 1, t);

  await page.click("#dataFolderOldBtn"); await page.waitForTimeout(200);
  t = await page.evaluate(() => window.__t);
  check("removing the old copy asks, then removes it", t.calls.some(([c]) => c === "remove_old_data_copy"), t.calls);
  check("and the row goes", await page.evaluate(() => document.getElementById("dataFolderOldRow").hidden));
  check("no page errors", errs.length === 0, errs);
  await page.close();

  const linux = await open(b, null);
  check("no group where the shell has no choice (Linux)", await linux.page.evaluate(() => document.getElementById("dataFolderGroup").hidden));
  check("no page errors there either", linux.errs.length === 0, linux.errs);

  await b.close();
  done();
})();
