// The Windows app is portable (2026-11-20): its update bar asks the shell
// (src-tauri/src/portable.rs) rather than Tauri's updater, shows the
// download's progress, and a folder it can't write to sends you to the
// release page instead of failing.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const BUILD = { version: "0.0.0", repo: "someone/lifelog", webUrl: "https://someone.github.io/lifelog/" };
const DOC = {
  categories: [], entries: [], backlog: [], todos: [], todoCategories: [], projects: [], habits: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings: {}, accomplishments: {}, notes: [],
};
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

const FAKE_TAURI = (mode) => {
  window.__t = { calls: [], opened: [], tauriChecks: 0, finish: null };
  class Channel { constructor() { this.onmessage = null; } }
  window.__TAURI__ = {
    core: {
      Channel,
      invoke: async (cmd, args) => {
        window.__t.calls.push(cmd);
        if (cmd === "portable_check") return "9.9.9";
        if (cmd === "portable_update") {
          if (mode === "readonly") throw "readonly";
          args.progress.onmessage(0.5);
          return new Promise((r) => { window.__t.finish = () => r(true); });
        }
        return null;
      },
    },
    opener: { openUrl: async (u) => { window.__t.opened.push(u); } },
    updater: { check: async () => { window.__t.tauriChecks++; return null; } },
  };
};

async function open(b, mode) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block", userAgent: WIN_UA });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.addInitScript(FAKE_TAURI, mode);
  await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BUILD) }));
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route("https://api.github.com/repos/someone/lifelog/releases/latest",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tag_name: "app-v9.9.9" }) }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((d) => { localStorage.clear(); localStorage.setItem("lifelog-cache-v1", JSON.stringify(d)); }, DOC);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.getElementById("updateBar").hidden, null, { timeout: 5000 }).catch(() => {});
  const text = () => page.evaluate(() => document.getElementById("updateBarText").textContent);
  const btn = () => page.evaluate(() => document.getElementById("updateReloadBtn").textContent);
  return { ctx, page, errs, text, btn };
}

(async () => {
  const b = await chromium.launch();

  const w = await open(b, "ok");
  check("the app is the Windows one", await w.page.evaluate(() => window.LifeLogPlatform.desktop && window.LifeLogPlatform.windows));
  check("a newer release is offered with Update", /9\.9\.9/.test(await w.text()) && (await w.btn()) === "Update");
  await w.page.click("#updateReloadBtn");
  await w.page.waitForTimeout(300);
  let t = await w.page.evaluate(() => window.__t);
  check("it asks the portable updater, never Tauri's", t.calls.includes("portable_check") && t.calls.includes("portable_update") && t.tauriChecks === 0, t);
  check("and shows the download's progress", /Downloading LifeLog 9\.9\.9/.test(await w.text()) && (await w.btn()) === "50%", { text: await w.text(), btn: await w.btn() });
  check("no page errors while updating", w.errs.length === 0, w.errs);
  await w.ctx.close();

  const r = await open(b, "readonly");
  await r.page.click("#updateReloadBtn");
  await r.page.waitForTimeout(300);
  check("a read-only folder says so", (await r.text()) === "LifeLog's folder is read-only, so it can't update itself" && (await r.btn()) === "Open page", { text: await r.text(), btn: await r.btn() });
  await r.page.click("#updateReloadBtn");
  await r.page.waitForTimeout(200);
  t = await r.page.evaluate(() => window.__t);
  check("and Open page opens the release page", t.opened.includes("https://github.com/someone/lifelog/releases/latest"), t);
  check("no page errors when read-only", r.errs.length === 0, r.errs);
  await r.ctx.close();

  await b.close();
  done();
})();
