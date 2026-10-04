// Zero-dependency tests for bridge/ — `node test/bridge.test.js`.
//
// The bridge runs on a temporary copy of a small LifeLog file, through the
// same tools any AI gets. Two tests guard against drift: every field the
// app's sanitizers know must be in bridge/DATA.md, and every collection the
// merge knows must be in it too, so changing the data without the bridge
// fails here (CLAUDE.md, "The AI bridge").
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifelog-bridge-"));
const FILE = path.join(dir, "lifelog.json");
process.env.LIFELOG_LOCAL_FILE = FILE;
process.env.LIFELOG_STATE_DIR = path.join(dir, "state");
process.env.LIFELOG_CONFIG = path.join(dir, "none.json");

const B = require("../bridge/tools.js");
const Finance = global.window.LifeLogFinance;
const today = Finance.localDateStr(new Date());
const daysAgo = (n) => Finance.addDaysStr(today, -n);
const T = "2026-01-01T00:00:00.000Z";

function seed() {
  return {
    version: 1, appVersion: "0.238.0", exportedAt: T,
    categories: [{ id: "c1", name: "Games", color: "#112233" }, { id: "c2", name: "Books", color: "#223344" }],
    financeCategories: [{ id: "f1", name: "Food", color: "#334455" }, { id: "f2", name: "Rent", color: "#445566" }],
    noteCategories: [{ id: "n1", name: "Ideas", color: "#556677" }],
    projects: [{ id: "p1", name: "Trip", color: "#667788" }],
    entries: [{ id: "e1", title: "Hades", category: "Games", year: 2026, month: 3, date: "2026-03", rating: 5, createdAt: T, updatedAt: T }],
    backlog: [
      { id: "b1", title: "Outer Wilds", category: "Games", priority: 1, createdAt: T, updatedAt: T },
      { id: "b2", title: "Dune", category: "Books", createdAt: T, updatedAt: T },
    ],
    notes: [
      { id: "no1", text: "Ship the bridge", title: "Plan", category: "Ideas", createdAt: T, updatedAt: T },
      { id: "no2", kind: "list", text: "", items: [{ id: "i1", text: "Milk" }, { id: "i2", text: "Eggs" }], createdAt: T, updatedAt: T },
    ],
    financeEntries: [
      { id: "x1", date: "2026-09-10", amount: 50, category: "Food", note: "Pizza", createdAt: T, updatedAt: T },
      { id: "x2", date: "2026-08-03", amount: 20, category: "Food", note: "Coffee", project: "Trip", createdAt: T, updatedAt: T },
    ],
    recurringExpenses: [
      { id: "r0", startDate: "2025-01-01", endDate: "2025-12-01", interval: "monthly", amount: 2800, category: "Rent", note: "Rent", createdAt: T, updatedAt: T },
      { id: "r1", startDate: "2026-01-01", interval: "monthly", amount: 3000, category: "Rent", note: "Rent", prevId: "r0", createdAt: T, updatedAt: T },
    ],
    habits: [
      { id: "h1", name: "Read", color: "#22aa66", cadence: "daily", target: 1, order: 0, startedAt: daysAgo(30),
        marks: { [daysAgo(1)]: 1, [daysAgo(2)]: 1 }, createdAt: T, updatedAt: T },
      { id: "h2", name: "No coffee", color: "#aa2266", cadence: "daily", target: 1, order: 1, startedAt: daysAgo(30), avoid: true, limit: 0, createdAt: T, updatedAt: T },
    ],
    accomplishments: {},
    settings: { currency: "ILS", mediaKeys: { rawg: "SECRET-KEY-123" }, steam: { steamId: "7656119SECRET" } },
  };
}
const reset = () => {
  fs.writeFileSync(FILE, JSON.stringify(seed(), null, 2));
  fs.rmSync(process.env.LIFELOG_STATE_DIR, { recursive: true, force: true });
};
const data = () => JSON.parse(fs.readFileSync(FILE, "utf8"));
const call = async (name, args) => B.callTool(name, args);
const ok = async (name, args) => {
  const r = await call(name, args);
  assert.ok(r.ok, `${name} failed: ${r.text}`);
  return r.text;
};
const refused = async (name, args, re) => {
  const r = await call(name, args);
  assert.ok(!r.ok, `${name} should have refused, said: ${r.text}`);
  if (re) assert.match(r.text, re);
  return r.text;
};

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("every read tool answers, and none of them ever shows an API key", async () => {
  reset();
  for (const t of B.TOOLS.filter((x) => x.readOnly)) {
    const args = t.name === "lifelog_search" ? { query: "e" } : t.name === "lifelog_get" ? { collection: "notes", item: "no1" } : {};
    const text = await ok(t.name, args);
    assert.ok(!/SECRET/.test(text), t.name + " leaked a secret");
  }
  await refused("lifelog_get", { collection: "settings", item: "x" }, /collection must be one of/);
});

test("the overview names what other tools need", async () => {
  reset();
  const t = await ok("lifelog_overview", {});
  assert.match(t, /Home currency: ILS/);
  assert.match(t, /Expense categories: Food, Rent/);
  assert.match(t, /Habits: Read, No coffee/);
  assert.match(t, /plus 1 recurring bills/, "a bill's replaced plan isn't a second bill");
});

test("spending counts recurring bills, as the Ledger does, and can leave them out", async () => {
  reset();
  const t = await ok("lifelog_spending", { start_date: "2026-09-01", end_date: "2026-09-30" });
  assert.match(t, /^3,050\.00 ILS over 2 expenses/);
  assert.match(t, /of which 3,000\.00 ILS is recurring/);
  assert.match(t, /- Rent: 3,000\.00 ILS\n- Food: 50\.00 ILS/);
  const without = await ok("lifelog_spending", { start_date: "2026-09-01", end_date: "2026-09-30", include_recurring: false });
  assert.match(without, /^50\.00 ILS over 1 expenses/);
  const months = await ok("lifelog_spending", { start_date: "2025-12-01", end_date: "2026-01-31", group_by: "month" });
  assert.match(months, /- 2025-12: 2,800\.00 ILS\n- 2026-01: 3,000\.00 ILS/, "the old plan's charges count in its own months");
  const list = await ok("lifelog_expenses", { start_date: "2026-09-01", end_date: "2026-09-30" });
  assert.match(list, /2026-09-01 3,000\.00 ILS \[Rent\] recurring · Rent {2}\(plan r1\)/);
});

test("the recurring list shows the bill once, with its next charge", async () => {
  reset();
  const t = await ok("lifelog_recurring", {});
  assert.match(t, /^1 bills, about 3,000\.00 ILS a month\./);
  assert.match(t, /Rent: 3,000\.00 ILS monthly \[Rent\], next \d{4}-\d{2}-01 {2}\(r1\)/);
});

test("habits show today, the streak and the last two weeks", async () => {
  reset();
  const t = await ok("lifelog_habits", {});
  assert.match(t, /- Read \[Every day\]: not done yet today; streak 2, best 2;/);
  assert.match(t, /- No coffee \(avoiding\) \[Every day\]: kept today/);
});

test("an expense is checked against the real categories and saved the app's way", async () => {
  reset();
  await refused("lifelog_add_expense", { amount: 12, category: "Snacks" }, /No category called "Snacks". There are: Food, Rent/);
  await refused("lifelog_add_expense", { amount: -3, category: "Food" }, /more than 0/);
  const t = await ok("lifelog_add_expense", { amount: 12.5, category: "food", note: "Falafel", project: "trip" });
  const f = data().financeEntries[2];
  assert.ok(t.includes(f.id));
  assert.strictEqual(f.category, "Food", "the stored name, not how it was typed");
  assert.strictEqual(f.project, "Trip");
  assert.strictEqual(f.amount, 12.5);
  assert.strictEqual(f.date, today);
  assert.ok(f.createdAt && f.updatedAt && f.updatedAt === f.createdAt);
  assert.match(fs.readFileSync(FILE, "utf8"), /\n {2}"version": 1/, "written pretty, as the app writes it");
  assert.strictEqual(data().financeEntries[0].updatedAt, T, "untouched items keep their stamp");
  assert.notStrictEqual(data().exportedAt, T);
});

test("a foreign expense is converted, and needs its rate", async () => {
  reset();
  await refused("lifelog_add_expense", { amount: 10, category: "Food", currency: "EUR" }, /Give a rate for EUR/);
  await ok("lifelog_add_expense", { amount: 10, category: "Food", currency: "eur", rate: 3.9 });
  const f = data().financeEntries[2];
  assert.deepStrictEqual([f.amount, f.currency, f.fxAmount, f.rate], [39, "EUR", 10, 3.9]);
});

test("timeline ratings are 1 to 5 stars", async () => {
  reset();
  await refused("lifelog_add_timeline_entry", { title: "X", category: "Games", rating: 8 }, /1-5/);
  await ok("lifelog_add_timeline_entry", { title: "Celeste", category: "Games", year: 2026, month: 9, rating: 4 });
  const e = data().entries[1];
  assert.deepStrictEqual([e.title, e.date, e.year, e.month, e.rating], ["Celeste", "2026-09", 2026, 9, 4]);
});

test("finishing a backlog item moves it to the timeline", async () => {
  reset();
  await ok("lifelog_finish_backlog_item", { item: "outer", year: 2026, month: 10, rating: 5 });
  const d = data();
  assert.ok(!d.backlog.some((b) => b.id === "b1"));
  const e = d.entries.find((x) => x.title === "Outer Wilds");
  assert.strictEqual(e.backlogAddedAt, T);
  assert.strictEqual(e.date, "2026-10");
});

test("notes: a checklist is made, ticked, added to and pruned by item text or id", async () => {
  reset();
  await ok("lifelog_add_note", { list_items: ["Bread", " "] });
  assert.strictEqual(data().notes[0].kind, "list");
  assert.deepStrictEqual(data().notes[0].items.map((i) => i.text), ["Bread"]);
  await ok("lifelog_update_list", { note: "no2", check: ["milk"], add: ["Butter"], remove: ["i2"] });
  const list = data().notes.find((n) => n.id === "no2");
  assert.deepStrictEqual(list.items.map((i) => [i.text, !!i.done]), [["Milk", true], ["Butter", false]]);
  assert.ok(list.items[0].doneAt);
  await refused("lifelog_update_list", { note: "Plan", check: ["x"] }, /isn't a checklist/);
});

test("a habit is marked for today, or cleared, and the streak follows", async () => {
  reset();
  const t = await ok("lifelog_mark_habit", { habit: "read" });
  assert.match(t, /Read on .*: 1 \(done\)\. Streak now 3\./);
  assert.strictEqual(data().habits[0].marks[today], 1);
  await ok("lifelog_mark_habit", { habit: "Read", value: 0 });
  assert.strictEqual(data().habits[0].marks[today], undefined);
  await refused("lifelog_mark_habit", { habit: "Read", date: Finance.addDaysStr(today, 1) }, /hasn't happened/);
});

test("any item can be edited, but only into something the app would keep", async () => {
  reset();
  await ok("lifelog_update_item", { collection: "financeEntries", item: "x1", set: { amount: 55, note: "Pizza and drinks" } });
  const f = data().financeEntries[0];
  assert.deepStrictEqual([f.amount, f.note], [55, "Pizza and drinks"]);
  assert.notStrictEqual(f.updatedAt, T, "an edit gets a fresh stamp, so the merge takes it");
  await refused("lifelog_update_item", { collection: "notes", item: "no2", set: { title: "Shop" } }, /doesn't keep "title"/);
  await refused("lifelog_update_item", { collection: "financeEntries", item: "x1", set: { category: "Toys" } }, /No category called "Toys"/);
  await refused("lifelog_update_item", { collection: "financeEntries", item: "x1", set: { id: "z" } }, /LifeLog's to manage/);
  await ok("lifelog_update_item", { collection: "entries", item: "Hades", set: { month: 4 }, unset: ["rating"] });
  const e = data().entries[0];
  assert.deepStrictEqual([e.date, e.rating], ["2026-04", undefined]);
});

test("a name that matches several asks for an id", async () => {
  reset();
  await ok("lifelog_add_backlog_item", { title: "Dune Messiah", category: "Books" });
  await refused("lifelog_get", { collection: "backlog", item: "dun" }, /Several backlog items match/);
  assert.match(await ok("lifelog_get", { collection: "backlog", item: "Dune" }), /"id": "b2"/, "an exact title wins");
});

test("undo puts back exactly what the last change touched, and won't trample a later edit", async () => {
  reset();
  await ok("lifelog_delete_item", { collection: "backlog", item: "Dune" });
  assert.ok(!data().backlog.some((b) => b.id === "b2"));
  assert.match(await ok("lifelog_undo", {}), /Undid: delete backlog item/);
  const back = data().backlog.find((b) => b.id === "b2");
  assert.strictEqual(back.title, "Dune");
  assert.notStrictEqual(back.updatedAt, T, "restored with a fresh stamp, so a device that saw the delete takes it back");
  assert.match(await ok("lifelog_undo", {}), /nothing to undo/);

  await ok("lifelog_add_expense", { amount: 5, category: "Food" });
  const d = data();
  d.financeEntries[2].amount = 6;
  d.financeEntries[2].updatedAt = "2099-01-01T00:00:00.000Z";
  fs.writeFileSync(FILE, JSON.stringify(d));
  await refused("lifelog_undo", {}, /changed again since/);
  await ok("lifelog_undo", { force: true });
  assert.strictEqual(data().financeEntries.length, 2);
});

test("a save that loses a race is made again on top of the newer file", async () => {
  reset();
  const { openStore, readConfig } = require("../bridge/store.js");
  const cfg = readConfig();
  const real = openStore(cfg);
  let first = true;
  B.useStore({
    where: () => "test",
    read: () => real.read(),
    async write(d, v, m) {
      if (first) {
        first = false;
        // Someone else saves in between.
        const other = data();
        other.notes.push({ id: "other", text: "From the phone", createdAt: T, updatedAt: T });
        fs.writeFileSync(FILE, JSON.stringify(other));
        return false;
      }
      return real.write(d, v, m);
    },
  }, cfg);
  await ok("lifelog_add_note", { text: "From the bridge" });
  B.useStore(null, null);
  const texts = data().notes.map((n) => n.text);
  assert.ok(texts.includes("From the phone") && texts.includes("From the bridge"), texts.join());
});

test("the app's setup link connects the bridge, and loses to keys set outright", () => {
  const { parseSetupLink, readConfig } = require("../bridge/store.js");
  assert.deepStrictEqual(parseSetupLink("https://danielnoam.github.io/LifeLog/#t=github_pat_X"),
    { token: "github_pat_X", owner: "", repo: "", path: "", branch: "" });
  assert.deepStrictEqual(parseSetupLink("#t=tok&r=my-data&p=log.json&b=dev&o=org"),
    { token: "tok", owner: "org", repo: "my-data", path: "log.json", branch: "dev" });
  const legacy = Buffer.from(JSON.stringify({ t: "old", o: "me", r: "lifelog-data" })).toString("base64url");
  assert.strictEqual(parseSetupLink("https://x/#setup=" + legacy).token, "old");
  assert.throws(() => parseSetupLink("https://danielnoam.github.io/LifeLog/"), /no token/);
  assert.throws(() => parseSetupLink("#setup=bm90anNvbg"), /damaged/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifelog-link-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify({ link: "https://x/#t=fromlink&r=other", repo: "chosen" }));
  const saved = { ...process.env };
  try {
    for (const k of Object.keys(process.env)) if (k.startsWith("LIFELOG_")) delete process.env[k];
    process.env.LIFELOG_CONFIG = file;
    const cfg = readConfig();
    assert.strictEqual(cfg.token, "fromlink");
    assert.strictEqual(cfg.repo, "chosen");
    assert.strictEqual(cfg.path, "lifelog.json");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("on GitHub: read with the sha, a big file through its blob, save on top, and a stale sha is retried", async () => {
  const { openStore } = require("../bridge/store.js");
  const calls = [];
  const file = { version: 1, notes: [] };
  const b64 = Buffer.from(JSON.stringify(file)).toString("base64");
  let big = false, putStatus = 200;
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push(opts.method + " " + url.replace("https://api.github.com", ""));
    const json = (status, body) => ({ ok: status < 300, status, statusText: "", json: async () => body });
    if (url.endsWith("/user")) return json(200, { login: "me" });
    if (/\/repos\/me\/lifelog-data$/.test(url)) return json(200, { default_branch: "main" });
    if (url.includes("/git/blobs/")) return json(200, { content: b64 });
    if (opts.method === "PUT") {
      const body = JSON.parse(opts.body);
      calls.push("sha " + body.sha + " branch " + body.branch);
      return json(putStatus, putStatus === 200 ? {} : { message: "sha does not match" });
    }
    return json(200, { sha: "abc", content: big ? "" : b64 });
  };
  try {
    const s = openStore({ token: "t", repo: "lifelog-data", path: "lifelog.json" });
    const r = await s.read();
    assert.deepStrictEqual([r.data, r.version], [file, "abc"]);
    assert.deepStrictEqual(calls.slice(0, 3), ["GET /user", "GET /repos/me/lifelog-data", "GET /repos/me/lifelog-data/contents/lifelog.json?ref=main"]);
    big = true;
    assert.deepStrictEqual((await s.read()).data, file, "over 1MB, the content comes from the blob");
    assert.strictEqual(await s.write(file, "abc", "m"), true);
    assert.ok(calls.includes("sha abc branch main"));
    putStatus = 409;
    assert.strictEqual(await s.write(file, "old", "m"), false, "a stale sha says try again rather than throwing");
    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await assert.rejects(openStore({ token: "t", owner: "me", repo: "x", path: "y", branch: "main" }).read(), /refused the LifeLog token/);
  } finally {
    global.fetch = realFetch;
  }
});

test("every field the app's sanitizers keep is described in DATA.md", () => {
  const doc = fs.readFileSync(path.join(__dirname, "..", "bridge", "DATA.md"), "utf8");
  const sections = Object.fromEntries(doc.split(/\n(?=## )/).map((s) => [s.split("\n")[0], s]));
  const src = (f) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");
  const listOf = (text, name) => {
    const m = new RegExp(`const ${name} = (?:new Set\\()?\\[([\\s\\S]*?)\\]`).exec(text);
    assert.ok(m, name + " not found");
    return [...m[1].replace(/\/\/.*$/gm, "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };
  const where = {
    "## Timeline (`entries`)": [["journal.js", "KNOWN_ENTRY_KEYS"]],
    "## Backlog (`backlog`)": [["backlog.js", "KNOWN_BACKLOG_KEYS"], ["backlog.js", "RELEASE_FIELDS"]],
    "## Categories (`categories`, `financeCategories`, `noteCategories`)": [["app.js", "KNOWN_CATEGORY_KEYS"]],
    "## Notes (`notes`)": [["notes.js", "KNOWN_NOTE_KEYS"]],
    "## Expenses (`financeEntries`)": [["finance.js", "KNOWN_FINANCE_ENTRY_KEYS"]],
    "## Recurring bills (`recurringExpenses`)": [["finance.js", "KNOWN_RECURRING_KEYS"]],
    "## Projects (`projects`)": [["finance.js", "KNOWN_PROJECT_KEYS"]],
    "## Habits (`habits`)": [["habits.js", "KNOWN_HABIT_KEYS"]],
    "## Accomplishments (`accomplishments`)": [["app.js", "KNOWN_ACCOMPLISHMENT_KEYS"]],
    "## Settings (`settings`)": [["app.js", "KNOWN_SETTINGS_KEYS"]],
  };
  const missing = [];
  for (const [heading, lists] of Object.entries(where)) {
    const section = sections[heading];
    assert.ok(section, "DATA.md has no section " + heading);
    for (const [file, name] of lists) {
      for (const key of listOf(src(file), name)) if (!section.includes("`" + key + "`")) missing.push(`${key} (${name}) under ${heading}`);
    }
  }
  assert.deepStrictEqual(missing, [], "describe these in bridge/DATA.md, and teach the tools if an AI should use them");
});

test("every collection the app syncs is in DATA.md, and the bridge edits only real ones", () => {
  const doc = fs.readFileSync(path.join(__dirname, "..", "bridge", "DATA.md"), "utf8");
  const Merge = require("../src/merge.js");
  const legacy = ["todos", "todoCategories"]; // folded into list notes on load (0.198.0)
  for (const key of Merge.COLLECTION_KEYS.filter((k) => !legacy.includes(k))) {
    assert.ok(doc.includes("`" + key + "`"), "DATA.md doesn't mention " + key);
  }
  for (const key of Object.keys(B.COLLECTIONS)) assert.ok(Merge.COLLECTION_KEYS.includes(key), key + " isn't a synced collection");
});

test("the MCP server speaks the protocol: initialize, tools, a call, the guide", async () => {
  reset();
  const child = spawn(process.execPath, [path.join(__dirname, "..", "bridge", "mcp.js")], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  const replies = new Map();
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies.set(m.id, m); }
  });
  const ask = (id, method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((res, rej) => {
      const t0 = Date.now();
      const poll = () => (replies.has(id) ? res(replies.get(id)) : Date.now() - t0 > 8000 ? rej(new Error("no reply to " + method)) : setTimeout(poll, 20));
      poll();
    });
  };
  try {
    const init = await ask(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.strictEqual(init.result.protocolVersion, "2025-03-26");
    assert.strictEqual(init.result.serverInfo.name, "lifelog");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const list = await ask(2, "tools/list", {});
    const names = list.result.tools.map((t) => t.name);
    assert.ok(names.includes("lifelog_spending") && names.includes("lifelog_undo"));
    const spend = list.result.tools.find((t) => t.name === "lifelog_spending");
    assert.strictEqual(spend.annotations.readOnlyHint, true);
    assert.strictEqual(list.result.tools.find((t) => t.name === "lifelog_delete_item").annotations.destructiveHint, true);
    const r = await ask(3, "tools/call", { name: "lifelog_spending", arguments: { start_date: "2026-09-01", end_date: "2026-09-30" } });
    assert.strictEqual(r.result.isError, false);
    assert.match(r.result.content[0].text, /^3,050\.00 ILS/);
    const bad = await ask(4, "tools/call", { name: "lifelog_add_expense", arguments: { amount: 1, category: "Nope" } });
    assert.strictEqual(bad.result.isError, true);
    const guide = await ask(5, "resources/read", { uri: "lifelog://guide" });
    assert.match(guide.result.contents[0].text, /^# LifeLog's data/);
    const none = await ask(6, "no/such", {});
    assert.strictEqual(none.error.code, -32601);
  } finally {
    child.kill();
  }
});

test("the command line runs the same tools", async () => {
  reset();
  const run = (args) => new Promise((res) => {
    const c = spawn(process.execPath, [path.join(__dirname, "..", "bridge", "cli.js"), ...args], { env: process.env });
    let out = "", err = "";
    c.stdout.on("data", (x) => (out += x));
    c.stderr.on("data", (x) => (err += x));
    c.on("close", (code) => res({ code, out, err }));
  });
  const r = await run(["spending", "--start_date", "2026-09-01", "--end_date=2026-09-30", "--group_by", "none"]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /^3,050\.00 ILS over 2 expenses/);
  const bad = await run(["add_expense", "--json", '{"amount":1,"category":"Nope"}']);
  assert.strictEqual(bad.code, 1);
  assert.match(bad.err, /No category called "Nope"/);
  const help = await run([]);
  assert.match(help.out, /lifelog_add_expense \(changes data\) --amount --category/);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log("  ok - " + name); }
    catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} test(s) passed.`);
})();
