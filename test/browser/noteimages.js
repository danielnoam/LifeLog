// Images in notes (0.297.0): added in the sheet and drawn in the card and
// the reader; uploaded to the data repo's own "lifelog-images" branch before
// the lifelog.json that points at them; fetched by a second device; Clean up
// keeping only what the notes show and starting the branch over; a device
// putting back what a clean-up elsewhere dropped; and an Obsidian note
// imported with its picture.
//
// GitHub here is a small fake that keeps real git objects (blobs, flat
// trees, commits, refs), refuses a non-forced ref move that isn't a fast
// forward, and serves a file's raw bytes the way the contents endpoint does.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { chromium, BASE, tally, settled, forgetCopy } = require("./harness");
const { check, done } = tally();

const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "ghp_fake" };
const doc = (notes, settings = {}) => ({
  categories: [], entries: [], backlog: [], notes, todos: [], todoCategories: [], projects: [],
  financeEntries: [], recurringExpenses: [], financeCategories: [], settings, accomplishments: {},
  noteCategories: [], exportedAt: "2026-10-01T00:00:00.000Z",
});
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

function makeRepo(data) {
  const repo = { blobs: new Map(), trees: new Map(), commits: new Map(), refs: new Map(), log: [],
    file: { data, sha: "file-0" }, puts: 0 };
  return repo;
}
const headTree = (repo) => {
  const c = repo.refs.get("lifelog-images");
  return c ? repo.trees.get(repo.commits.get(c).tree) : null;
};
const imageIds = (repo) => (headTree(repo) || []).filter((e) => e.path.startsWith("images/")).map((e) => e.path.slice(7)).sort();

function serve(page, repo) {
  return page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname.replace(/^\/repos\/someone\/lifelog-data/, "");
    const m = req.method();
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const say = (status, b) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (u.pathname === "/user") return say(200, { login: "someone" });
    if (p === "" || p === "/") return say(200, { default_branch: "main", private: true });
    if (p === "/git/blobs" && m === "POST") {
      const sha = sha1(body.content);
      repo.blobs.set(sha, { b64: body.encoding === "base64" ? body.content : Buffer.from(body.content).toString("base64") });
      return say(201, { sha });
    }
    if (p === "/git/trees" && m === "POST") {
      const base = body.base_tree ? repo.trees.get(body.base_tree) : [];
      const map = new Map(base.map((e) => [e.path, e]));
      for (const e of body.tree) map.set(e.path, { path: e.path, sha: e.sha, type: "blob", mode: e.mode, size: Buffer.from(repo.blobs.get(e.sha).b64, "base64").length });
      const entries = [...map.values()];
      const sha = sha1(JSON.stringify(entries));
      repo.trees.set(sha, entries);
      return say(201, { sha });
    }
    let mm;
    if ((mm = /^\/git\/trees\/(\w+)$/.exec(p))) return say(200, { sha: mm[1], tree: repo.trees.get(mm[1]), truncated: false });
    if (p === "/git/commits" && m === "POST") {
      const sha = sha1(JSON.stringify(body) + repo.commits.size);
      repo.commits.set(sha, { tree: body.tree, parents: body.parents });
      return say(201, { sha });
    }
    if ((mm = /^\/git\/commits\/(\w+)$/.exec(p))) return say(200, { sha: mm[1], tree: { sha: repo.commits.get(mm[1]).tree } });
    if (p === "/git/ref/heads/lifelog-images") {
      const c = repo.refs.get("lifelog-images");
      return c ? say(200, { object: { sha: c } }) : say(404, { message: "Not Found" });
    }
    if (p === "/git/refs" && m === "POST") {
      if (repo.refs.has("lifelog-images")) return say(422, { message: "Reference already exists" });
      repo.refs.set("lifelog-images", body.sha);
      repo.log.push("images");
      return say(201, {});
    }
    if (p === "/git/refs/heads/lifelog-images" && m === "PATCH") {
      const cur = repo.refs.get("lifelog-images");
      if (!body.force && !repo.commits.get(body.sha).parents.includes(cur)) return say(422, { message: "Update is not a fast forward" });
      repo.refs.set("lifelog-images", body.sha);
      repo.log.push(body.force ? "force" : "images");
      return say(200, {});
    }
    if (p === "/commits") {
      if (u.searchParams.get("sha") === "lifelog-images") {
        const out = [];
        for (let c = repo.refs.get("lifelog-images"); c && out.length < 10; c = repo.commits.get(c).parents[0]) out.push({ sha: c });
        return say(200, out);
      }
      return say(200, []);
    }
    if ((mm = /^\/contents\/images\/(.+)$/.exec(p))) {
      const e = (headTree(repo) || []).find((x) => x.path === "images/" + mm[1]);
      if (!e) return say(404, { message: "Not Found" });
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from(repo.blobs.get(e.sha).b64, "base64") });
    }
    if (p === "/contents" || p === "/contents/") return say(200, [{ path: "lifelog.json", sha: repo.file.sha }]);
    if (p === "/contents/lifelog.json") {
      if (m === "PUT") {
        if (body.sha !== repo.file.sha) return say(409, { message: "does not match" });
        repo.file = { data: JSON.parse(Buffer.from(body.content, "base64").toString()), sha: "file-" + ++repo.puts };
        repo.log.push("json");
        return say(200, { content: { sha: repo.file.sha } });
      }
      return say(200, { sha: repo.file.sha, size: 100, encoding: "base64", content: Buffer.from(JSON.stringify(repo.file.data)).toString("base64") });
    }
    return say(404, { message: "Not Found" });
  });
}

async function device(browser, repo, errs, { width = 1100, wipeImages = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (msg) => { if (msg.type() === "error" && !/404|Failed to load resource/.test(msg.text())) errs.push("console: " + msg.text()); });
  page.on("dialog", (d) => d.accept());
  await serve(page, repo);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate(({ data, gh, wipe }) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "notes" }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(data));
    localStorage.setItem("lifelog-sync-base-v1", JSON.stringify(data));
    localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
    if (wipe) indexedDB.deleteDatabase("lifelog-images");
  }, { data: repo.file.data, gh: { ...GH, sha: repo.file.sha }, wipe: wipeImages });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  return { page, ctx };
}

// A real picture, drawn by the browser: wide enough to be shrunk.
async function drawPng(browser, w, h, color) {
  const p = await browser.newPage();
  const b64 = await p.evaluate(({ w, h, color }) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff"; g.fillRect(w / 4, h / 4, w / 2, h / 2);
    return c.toDataURL("image/png").split(",")[1];
  }, { w, h, color });
  await p.close();
  return Buffer.from(b64, "base64");
}

const noteText = (page, id) => page.evaluate((id) => (window.LifeLogNotes.searchable().find((n) => n.id === id) || {}).text, id);
const refIds = (text) => [...String(text || "").matchAll(/lifelog-img:([a-z0-9]+\.\w+)/g)].map((m) => m[1]);

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifelog-img-"));
  const big = path.join(dir, "big.png"), small = path.join(dir, "small.png");
  fs.writeFileSync(big, await drawPng(browser, 3000, 2000, "#c0392b"));
  fs.writeFileSync(small, await drawPng(browser, 300, 200, "#2980b9"));

  const repo = makeRepo(doc([{ id: "keep", text: "Already here", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }]));

  // ---- device A: add two pictures to a note, remove one, save ----
  const A = await device(browser, repo, errs);
  let a = A.page;
  await a.evaluate(() => window.LifeLogNotes.openNoteModal(null));
  await a.fill("#nText", "Hike\n");
  await a.setInputFiles("#nImageInput", [big, small]);
  await a.waitForFunction(() => document.querySelectorAll(".note-image-thumb img[src^='blob:']").length === 2, null, { timeout: 8000 });
  let text = await a.inputValue("#nText");
  check("Add image puts each picture on a line of its own", /^Hike\n!\[\]\(lifelog-img:\w+\.jpg\)\n!\[\]\(lifelog-img:\w+\.png\)$/.test(text), text);
  const shrunk = await a.evaluate(async (id) => {
    const u = await window.LifeLogImages.url(id);
    const img = new Image(); img.src = u; await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, refIds(text)[0]);
  check("a big picture is shrunk to 1600px on its long side", shrunk[0] === 1600 && shrunk[1] === 1067, shrunk);
  await a.click(".note-image-thumb:last-child .note-image-del");
  text = await a.inputValue("#nText");
  check("× takes the picture's line out of the text", refIds(text).length === 1 && !/\n\n\n/.test(text), text);
  await a.fill("#nTitle", "Ridge");
  await a.click("#noteForm button[type=submit]");
  await settled(a);
  await a.waitForTimeout(300);
  const hike = repo.file.data.notes.find((n) => n.title === "Ridge");
  check("the note reaches GitHub", !!hike, repo.file.data.notes.map((n) => n.title));
  const first = refIds(hike && hike.text)[0];
  check("its picture is on the lifelog-images branch, and only that one", JSON.stringify(imageIds(repo)) === JSON.stringify([first]), imageIds(repo));
  check("uploaded before the lifelog.json that points at it", repo.log.indexOf("images") >= 0 && repo.log.indexOf("images") < repo.log.lastIndexOf("json"), repo.log);
  check("the feed card draws it", await a.evaluate(() => !!document.querySelector(".note-card .md-img[src^='blob:']")));
  const mainHasNoImage = !JSON.stringify(repo.file.data).includes("base64") && JSON.stringify(repo.file.data).length < 4000;
  check("lifelog.json holds only the pointer, not the picture", mainHasNoImage, JSON.stringify(repo.file.data).length);

  // ---- device B: sees it, fetched from GitHub ----
  const B = await device(browser, repo, errs, { width: 390 });
  let b = B.page;
  await b.evaluate((id) => window.LifeLogNotes.openNoteReader(id), hike.id);
  await b.waitForSelector("#noteReaderBody .md-img[src^='blob:']", { timeout: 8000 });
  check("another device draws the picture, fetched from the branch", true);
  await b.click("#closeNoteReaderBtn");

  // ---- a picture nobody shows any more, then Clean up on B ----
  await a.evaluate(() => window.LifeLogNotes.openNoteModal(null));
  await a.fill("#nText", "Short-lived\n");
  await a.setInputFiles("#nImageInput", [small]);
  await a.waitForSelector(".note-image-thumb img[src^='blob:']", { timeout: 8000 });
  await a.click("#noteForm button[type=submit]");
  await settled(a);
  const gone = repo.file.data.notes.find((n) => /Short-lived/.test(n.text));
  const goneId = refIds(gone.text)[0];
  check("a second note's picture goes up too", imageIds(repo).includes(goneId), imageIds(repo));
  await a.evaluate((id) => { window.LifeLogNotes.openNoteModal(window.LifeLogNotes.searchable().find((n) => n.id === id)); }, gone.id);
  await a.click("#deleteNoteBtn");
  await settled(a);
  check("deleting the note leaves its picture on GitHub until a clean-up", imageIds(repo).includes(goneId));

  // A picture A uploaded for a note B hasn't pulled yet: the clean-up drops
  // it, and A puts it back once it sees the clean-up.
  await a.evaluate(() => window.LifeLogNotes.openNoteModal(null));
  await a.fill("#nText", "Racing the clean-up\n");
  await a.setInputFiles("#nImageInput", [small]);
  await a.waitForSelector(".note-image-thumb img[src^='blob:']", { timeout: 8000 });
  await a.click("#noteForm button[type=submit]");
  await settled(a);
  const raced = refIds(repo.file.data.notes.find((n) => /Racing/.test(n.text)).text)[0];

  const fileBefore = repo.file.sha;
  const bData = await b.evaluate(() => window.LifeLogStorage.cachedCopy());
  check("device B hasn't pulled A's latest notes yet", !bData.notes.some((n) => /Racing/.test(n.text)) && repo.file.sha === fileBefore);
  await b.evaluate(() => window.__ll_openSettings && 0);
  await b.evaluate(() => document.querySelector("#cleanUpImagesBtn").click());
  await b.waitForFunction(() => /Removed|Nothing to remove/.test([...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ")), null, { timeout: 8000 });
  await settled(b);
  const toastB = await b.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
  check("Clean up says what it removed", /(^| \| )Removed \d+ images? \(/.test(toastB), toastB);
  check("the branch keeps only what B's notes show", JSON.stringify(imageIds(repo)) === JSON.stringify([first]), imageIds(repo));
  const commits = (() => { const out = []; for (let c = repo.refs.get("lifelog-images"); c; c = repo.commits.get(c).parents[0]) out.push(c); return out; })();
  check("and its history starts over: one commit", commits.length === 1, commits.length);
  check("the clean-up is stamped in the synced settings", !!(repo.file.data.settings && repo.file.data.settings.imagesCleanedAt), repo.file.data.settings);

  // A pulls the stamp with B's save, and its next save puts its picture back.
  await a.evaluate(() => window.LifeLogSync && window.LifeLogSync.pollNow ? window.LifeLogSync.pollNow() : null);
  await a.reload({ waitUntil: "networkidle" });
  await a.waitForTimeout(800);
  await a.evaluate(() => window.LifeLogNotes.openNoteModal(null));
  await a.fill("#nText", "Anything, to save");
  await a.click("#noteForm button[type=submit]");
  await settled(a);
  check("a device that sees a clean-up uploads again what it dropped", imageIds(repo).includes(raced), imageIds(repo));

  // ---- Obsidian import on A ----
  const md = path.join(dir, "Lisbon.md"), tram = path.join(dir, "tram.png");
  fs.writeFileSync(tram, await drawPng(browser, 200, 120, "#27ae60"));
  fs.writeFileSync(md, "# Lisbon\n\nTram 28.\n\n![[tram.png|300]]\n\nAnd ![[missing.jpg]] here.\n");
  await a.setInputFiles("#importMdInput", [md, tram]);
  await a.waitForSelector("#financePickerModal:not([hidden])", { timeout: 5000 });
  const hint = await a.evaluate(() => document.querySelector("#financePickerModal").innerText);
  check("the review says the note has images", /1 of them has images/.test(hint), hint.slice(0, 300));
  await a.click("#financePickerConfirmBtn");
  await settled(a);
  await a.waitForTimeout(300);
  const lis = repo.file.data.notes.find((n) => n.title === "Lisbon");
  check("the embed now points at a kept copy", !!lis && /!\[\]\(lifelog-img:\w+\.png\)/.test(lis.text) && !/tram\.png/.test(lis.text), lis && lis.text);
  check("one that wasn't among the files stays as written", !!lis && /!\[\[missing\.jpg\]\]/.test(lis.text));
  check("and the imported picture is on the branch", !!lis && imageIds(repo).includes(refIds(lis.text)[0]), imageIds(repo));
  await a.evaluate((id) => window.LifeLogNotes.openNoteReader(id), lis.id);
  await a.waitForSelector("#noteReaderBody .md-img[src^='blob:']", { timeout: 8000 });
  const chip = await a.evaluate(() => (document.querySelector("#noteReaderBody .md-img-missing") || {}).textContent);
  check("the reader says which picture wasn't brought in", chip === "Image not brought in: missing.jpg", chip);
  await a.click("#closeNoteReaderBtn");
  // The toast offers the folder the missing one is in.
  const action = await a.evaluate(() => [...document.querySelectorAll(".toast .toast-action")].map((b) => b.textContent));
  check("a toast offers Find in folder, and the import keeps its Undo", action.includes("Find in folder") && action.includes("Undo"), action);
  const vault = path.join(dir, "Vault");
  fs.mkdirSync(path.join(vault, "attachments"), { recursive: true });
  fs.writeFileSync(path.join(vault, "attachments", "missing.jpg"), await drawPng(browser, 120, 80, "#8e44ad"));
  const chooser = a.waitForEvent("filechooser");
  await a.evaluate(() => [...document.querySelectorAll(".toast .toast-action")].find((b) => b.textContent === "Find in folder").click());
  await (await chooser).setFiles(vault);
  await a.waitForFunction(() => /^Found 1 image/.test((document.querySelector("#toast") || {}).textContent || ""), null, { timeout: 8000 });
  await settled(a);
  const lis2 = repo.file.data.notes.find((n) => n.title === "Lisbon");
  check("Find in folder points the note at the picture it found", refIds(lis2.text).length === 2 && !/missing\.jpg/.test(lis2.text), lis2.text);
  // Imported again, it's a note you already have.
  await a.setInputFiles("#importMdInput", [md, tram]);
  await a.waitForTimeout(500);
  const again = await a.evaluate(() => [...document.querySelectorAll("#financePickerList .picker-row input")].map((i) => i.checked));
  check("importing the same note again finds it already here", again.every((c) => !c), again);

  await A.ctx.close(); await B.ctx.close();
  await browser.close();
  done(errs);
})().catch((e) => { console.error(e); process.exit(1); });
