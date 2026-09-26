// The To-do mode's lists become list notes (0.197.0), in a real app: data
// from before the change opens as list notes, the To-do mode is gone and
// whoever left the app on it lands on their lists, and — against a fake
// GitHub — a device still on an older build keeps adding and ticking to-dos
// after the switch, and each lands in the right list rather than getting
// lost or doubled.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const T = "2026-08-01T09:00:00.000Z";
const OLD = {
  categories: [], entries: [], accomplishments: {}, backlog: [], habits: [], notes: [{ id: "n1", text: "A note", createdAt: T, updatedAt: T }],
  financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], settings: {},
  todoCategories: [{ id: "c-shop", name: "Shopping", color: "#e03131", updatedAt: T }],
  todos: [
    { id: "t1", text: "Milk", category: "Shopping", order: 0, createdAt: T, updatedAt: T },
    { id: "t2", text: "Eggs", category: "Shopping", order: 1, createdAt: T, updatedAt: T },
    { id: "t3", text: "Call mum", order: 0, createdAt: T, updatedAt: T },
  ],
};
const GH = { owner: "someone", repo: "lifelog-data", path: "lifelog.json", branch: "main", token: "t0ken", sha: null };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });

  // GitHub holds the old data; the app saves over it.
  const gh = { file: { data: JSON.parse(JSON.stringify(OLD)), sha: "s0" }, puts: 0 };
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request(), url = req.url();
    const say = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (/\/user$/.test(url)) return say(200, { login: "someone" });
    if (/\/repos\/someone\/lifelog-data$/.test(url)) return say(200, { default_branch: "main" });
    if (/\/commits/.test(url)) return say(200, []);
    if (!/\/contents\/lifelog\.json/.test(url)) return say(404, { message: "Not Found" });
    if (req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      if (body.sha !== gh.file.sha) return say(409, { message: "sha mismatch" });
      gh.file = { data: JSON.parse(Buffer.from(body.content, "base64").toString()), sha: "s" + (++gh.puts) };
      return say(200, { content: { sha: gh.file.sha } });
    }
    const b64 = Buffer.from(JSON.stringify(gh.file.data)).toString("base64");
    return say(200, { sha: gh.file.sha, size: b64.length, encoding: "base64", content: b64 });
  });

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(({ old, gh }) => {
    localStorage.clear();
    localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "notes", notesMode: "todo" }));
    localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ modeOrder: { notes: ["todo", "notes", "habits", "boards"] } }));
    localStorage.setItem("lifelog-cache-v1", JSON.stringify(old));
    localStorage.setItem("lifelog-github-v1", JSON.stringify(gh));
  }, { old: OLD, gh: GH });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const lists = () => page.evaluate(() => window.LifeLogNotes.listNotes().map((n) => ({ id: n.id, text: n.text, items: n.items.map((i) => i.id + (i.done ? "✓" : "")) })));
  let L = await lists();
  check("every to-do category became a list, the rest a \"To-do\" list",
    JSON.stringify(L.map((l) => l.text).sort()) === JSON.stringify(["Shopping", "To-do"]), L);
  check("each item kept its to-do's id and its order",
    JSON.stringify(L.find((l) => l.text === "Shopping").items) === JSON.stringify(["t1", "t2"]), L);
  check("the To-do mode is gone: Notes has three modes", await page.evaluate(() =>
    document.querySelectorAll('#viewTabs .tab[data-view="notes"] .tab-mode-dot').length === 3));
  const ui = await page.evaluate(() => ({
    mode: JSON.parse(localStorage.getItem("lifelog-ui-v1") || "{}").notesMode,
    kind: document.querySelector(".notes-kind.on") && document.querySelector(".notes-kind.on").textContent,
  }));
  check("someone who left the app on To-do comes back to their lists", ui.kind === "Lists", ui);
  check("the lists are drawn as panels", await page.evaluate(() => document.querySelectorAll(".note-card.is-list .todo-row").length === 3));

  // Make a change so it's saved, then look at what GitHub got.
  // Waits for the save to reach GitHub rather than a fixed time: under a
  // loaded run it could land after 1.5s, and everything below is built on it.
  const putsBefore = gh.puts;
  await page.locator('.note-card:has-text("Shopping") .todo-check').first().click();
  for (let t = 0; t < 100 && gh.puts === putsBefore; t++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  let remote = gh.file.data;
  check("the save carries the lists, and no to-dos", (remote.todos || []).length === 0 &&
    remote.notes.filter((n) => n.kind === "list").length === 2, { todos: remote.todos, notes: remote.notes.map((n) => n.id) });

  // A device on an older build: it still has the To-do mode, adds a to-do
  // and ticks one it had, and saves. Its save merges first (GitHub moved on,
  // so it meets a 409), and the merge keeps only the to-dos it changed or
  // added — the ones it left alone were deleted on this side — along with
  // the list notes, which it carries without understanding them.
  const older = JSON.parse(JSON.stringify(remote));
  older.todos = [
    { id: "t3", text: "Call mum", order: 0, done: true, doneAt: "2026-09-02T00:00:00.000Z", createdAt: T, updatedAt: "2026-09-02T00:00:00.000Z" },
    { id: "t9", text: "Bread", category: "Shopping", order: 2, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
  ];
  gh.file = { data: older, sha: "older" };
  // "online" is how the app is told to look again. The first may find a
  // retry of its own still going and leave the merge to the next look, so
  // it looks twice — as the interval would.
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(1500);
  }
  L = await lists();
  check("a to-do an older device adds after the switch lands in its list",
    L.find((l) => l.text === "Shopping").items.some((i) => i.startsWith("t9")), L);
  check("and its tick on one that had moved comes across, without a second copy",
    JSON.stringify(L.find((l) => l.text === "To-do").items) === JSON.stringify(["t3✓"]), L);
  check("still two lists, nothing doubled", L.length === 2 && L.find((l) => l.text === "Shopping").items.length === 3, L);
  check("and this device's own tick wasn't undone by it", L.find((l) => l.text === "Shopping").items[0] === "t1✓", L);

  // Quick add: the home screen's To-do goes into a list.
  await page.evaluate(() => window.LifeLogNotes.focusQuickList());
  await page.waitForTimeout(400);
  check("quick add opens a list's add line, ready to type", await page.evaluate(() =>
    !!document.activeElement && document.activeElement.closest(".note-list-compose") !== null));

  await ctx.close();
  await b.close();
  done(errs);
})();
