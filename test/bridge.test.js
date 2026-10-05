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
const BOARDS = path.join(dir, "boards.json");
const TRAVEL = path.join(dir, "travel.json");
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
    accomplishments: { 2025: [{ id: "a1", text: "Ran a half marathon", createdAt: T, updatedAt: T }] },
    settings: { currency: "ILS", mediaKeys: { rawg: "SECRET-KEY-123" }, steam: { steamId: "7656119SECRET" } },
  };
}
const boardsSeed = () => ({ boards: [
  { id: "bd1", name: "Kitchen plan", category: "Ideas", createdAt: T, updatedAt: T,
    elements: [{ id: "t1", t: "text", c: "ink", sw: 4, x: 0, y: 0, text: "Island here" }, { id: "p1", t: "pen", c: "ink", sw: 2, p: [0, 0, 5, 5] }] },
  { id: "bd2", name: "Doodle", createdAt: T, updatedAt: T, elements: [] },
] });
// Two more bills, for the tests about bills: one in a project with a one-off
// charge, one billed in dollars.
const withBills = () => {
  const d = data();
  d.recurringExpenses.push(
    { id: "r2", startDate: "2026-05-15", interval: "monthly", amount: 40, category: "Food", note: "Gym", project: "Trip",
      extras: [{ id: "xx1", date: "2026-06-01", amount: 10, category: "Food" }], createdAt: T, updatedAt: T },
    { id: "r3", startDate: "2026-02-05", interval: "monthly", amount: 36, currency: "USD", fxAmount: 10, rate: 3.6, category: "Food", note: "Cloud", createdAt: T, updatedAt: T });
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
};
const reset = () => {
  fs.writeFileSync(FILE, JSON.stringify(seed(), null, 2));
  fs.writeFileSync(BOARDS, JSON.stringify(boardsSeed()));
  fs.rmSync(TRAVEL, { force: true });
  fs.rmSync(process.env.LIFELOG_STATE_DIR, { recursive: true, force: true });
};
const data = () => JSON.parse(fs.readFileSync(FILE, "utf8"));
const boards = () => JSON.parse(fs.readFileSync(BOARDS, "utf8")).boards;
const travel = () => JSON.parse(fs.readFileSync(TRAVEL, "utf8"));
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
    const args = t.name === "lifelog_search" ? { query: "e" } : t.name === "lifelog_get" ? { collection: "notes", item: "no1" }
      : t.name === "lifelog_google_list" ? { link: "https://www.google.com/maps/place/Pantheon/@41.8986,12.4769,17z" } : {};
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

test("accomplishments are read, added, edited, moved between years and deleted", async () => {
  reset();
  assert.match(await ok("lifelog_accomplishments", {}), /2025: Ran a half marathon {2}\(a1\)/);
  const added = await ok("lifelog_add_accomplishment", { text: "Shipped LifeLog 1.0", year: 2026, notes: "Finally" });
  const id = /id (\S+)/.exec(added)[1];
  let d = data();
  assert.strictEqual(d.accomplishments["2026"][0].text, "Shipped LifeLog 1.0");
  assert.strictEqual(d.accomplishments["2026"][0].createdAt, d.accomplishments["2026"][0].updatedAt);
  await ok("lifelog_update_accomplishment", { item: "half marathon", year: 2024, notes: "In the rain" });
  d = data();
  assert.ok(!d.accomplishments["2025"], "an emptied year goes, as in the app");
  assert.deepStrictEqual([d.accomplishments["2024"][0].id, d.accomplishments["2024"][0].notes], ["a1", "In the rain"]);
  assert.notStrictEqual(d.accomplishments["2024"][0].updatedAt, T, "a move between years is a change the merge must see");
  await ok("lifelog_undo", {});
  assert.deepStrictEqual(data().accomplishments["2025"].map((a) => a.id), ["a1"]);
  await ok("lifelog_delete_accomplishment", { item: id });
  assert.ok(!data().accomplishments["2026"]);
  assert.match(await ok("lifelog_search", { query: "marathon" }), /accomplishment: 2025: Ran a half marathon/);
});

test("renaming a category or project carries every item with it, as the app does", async () => {
  reset(); withBills();
  await refused("lifelog_rename_category", { kind: "expense", name: "Food", new_name: "rent" }, /already a expense category called "rent"/);
  const t = await ok("lifelog_rename_category", { kind: "expense", name: "food", new_name: "Groceries", color: "#ABCDEF" });
  assert.match(t, /Renamed the expense category "Food" to "Groceries"; 4 items follow/);
  let d = data();
  assert.deepStrictEqual(d.financeCategories.find((c) => c.id === "f1"), { ...d.financeCategories.find((c) => c.id === "f1"), name: "Groceries", color: "#abcdef" });
  assert.ok(d.financeEntries.every((f) => f.category === "Groceries"));
  assert.strictEqual(d.recurringExpenses.find((r) => r.id === "r2").extras[0].category, "Groceries", "a bill's one-off charge follows too");
  await ok("lifelog_rename_category", { kind: "project", name: "Trip", new_name: "Japan" });
  d = data();
  assert.strictEqual(d.financeEntries.find((f) => f.id === "x2").project, "Japan");
  assert.strictEqual(d.recurringExpenses.find((r) => r.id === "r2").project, "Japan", "a bill in the project follows (the Ledger's rename once missed it)");
  await ok("lifelog_undo", {});
  assert.strictEqual(data().recurringExpenses.find((r) => r.id === "r2").project, "Trip");
  // A note category's boards live in boards.json, and follow too; one undo puts both files back.
  assert.match(await ok("lifelog_rename_category", { kind: "note", name: "Ideas", new_name: "Plans" }), /1 board too/);
  assert.strictEqual(data().notes.find((n) => n.id === "no1").category, "Plans");
  assert.strictEqual(boards().find((b) => b.id === "bd1").category, "Plans");
  await ok("lifelog_undo", {});
  assert.strictEqual(data().notes.find((n) => n.id === "no1").category, "Ideas");
  assert.strictEqual(boards().find((b) => b.id === "bd1").category, "Ideas");
});

test("one charge of a bill is changed, skipped or reset without touching the rest", async () => {
  reset(); withBills();
  await refused("lifelog_edit_recurring_charge", { bill: "Rent", date: "2026-03-02", amount: 3100 }, /no charge on 2026-03-02; the nearest is 2026-03-01/);
  assert.match(await ok("lifelog_edit_recurring_charge", { bill: "Rent", date: "2026-03-01", amount: 3100, note: "Plus repairs" }), /3,100\.00 ILS — Plus repairs/);
  assert.deepStrictEqual(data().recurringExpenses.find((r) => r.id === "r1").overrides, { "2026-03-01": { amount: 3100, note: "Plus repairs" } });
  // A charge from before the price change belongs to the older plan in the chain.
  await ok("lifelog_edit_recurring_charge", { bill: "Rent", date: "2025-06-01", skip: true });
  assert.deepStrictEqual(data().recurringExpenses.find((r) => r.id === "r0").overrides, { "2025-06-01": { skip: true } });
  const sept = await ok("lifelog_spending", { start_date: "2025-06-01", end_date: "2025-06-30", group_by: "none" });
  assert.match(sept, /^0\.00 ILS over 0 expenses/, "a skipped charge counts for nothing");
  await ok("lifelog_edit_recurring_charge", { bill: "Rent", date: "2026-03-01", reset: true });
  assert.ok(!data().recurringExpenses.find((r) => r.id === "r1").overrides, "back on the plan's terms, nothing is stored");
  // A foreign bill's amount is what was billed, at the date's rate, which is frozen.
  await refused("lifelog_edit_recurring_charge", { bill: "Rent", date: "2026-03-01", rate: 4 }, /billed in ILS; it takes no rate/);
  assert.match(await ok("lifelog_edit_recurring_charge", { bill: "Cloud", date: "2026-04-05", amount: 12, rate: 3.5 }), /42\.00 ILS \(12 USD at 3\.5\)/);
  const cloud = data().recurringExpenses.find((r) => r.id === "r3");
  assert.deepStrictEqual([cloud.overrides, cloud.rates], [{ "2026-04-05": { fxAmount: 12 } }, { "2026-04-05": 3.5 }]);
});

test("a bill is paused, resumed and has a pause removed", async () => {
  reset(); withBills();
  await ok("lifelog_pause_recurring", { bill: "Gym", from: "2026-07-01", to: "2026-08-31" });
  assert.deepStrictEqual(data().recurringExpenses.find((r) => r.id === "r2").pauses, [{ from: "2026-07-01", to: "2026-08-31" }]);
  const summer = await ok("lifelog_expenses", { start_date: "2026-07-01", end_date: "2026-08-31", query: "gym" });
  assert.match(summer, /^0 expenses/);
  await refused("lifelog_pause_recurring", { bill: "Gym", resume: true }, /isn't paused today/);
  await ok("lifelog_pause_recurring", { bill: "Gym", from: daysAgo(10) });
  assert.match(await ok("lifelog_recurring", {}), /Gym: .*paused now/);
  await ok("lifelog_pause_recurring", { bill: "Gym", resume: true });
  const p = data().recurringExpenses.find((r) => r.id === "r2").pauses;
  assert.deepStrictEqual(p[p.length - 1], { from: daysAgo(10), to: daysAgo(1) });
  await ok("lifelog_pause_recurring", { bill: "Gym", remove: "2026-07-01" });
  assert.ok(!data().recurringExpenses.find((r) => r.id === "r2").pauses.some((x) => x.from === "2026-07-01"));
  await refused("lifelog_pause_recurring", { bill: "Gym", remove: "2020-01-01" }, /no pause starting 2020-01-01/);
});

test("boards are listed with their text, renamed, filed, starred and deleted, and undone", async () => {
  reset();
  assert.match(await ok("lifelog_boards", {}), /Kitchen plan \[Ideas\]: 2 elements.*text: Island here {2}\(bd1\)/);
  assert.match(await ok("lifelog_boards", { board: "kitchen" }), /Text on it:\n- Island here/);
  await refused("lifelog_update_board", { board: "Doodle", category: "Nope" }, /No note category called "Nope"/);
  await ok("lifelog_update_board", { board: "Doodle", name: "Sketches", category: "ideas", fav: true });
  let b = boards().find((x) => x.id === "bd2");
  assert.deepStrictEqual([b.name, b.category, b.fav], ["Sketches", "Ideas", true]);
  assert.notStrictEqual(b.updatedAt, T);
  assert.ok(!/\n/.test(fs.readFileSync(BOARDS, "utf8")), "boards.json stays compact, as the app writes it");
  await ok("lifelog_delete_board", { board: "Kitchen plan" });
  assert.deepStrictEqual(boards().map((x) => x.id), ["bd2"]);
  await ok("lifelog_undo", {});
  assert.deepStrictEqual(boards().map((x) => x.id).sort(), ["bd1", "bd2"]);
  assert.match(await ok("lifelog_search", { query: "island" }), /board: Kitchen plan/);
  // No boards file yet: an empty list, and the first change creates it.
  fs.rmSync(BOARDS);
  assert.match(await ok("lifelog_boards", {}), /^0 boards/);
});

test("trips: planned day by day, places moved and scheduled, a trip deleted with its places and undone", async () => {
  reset();
  assert.match(await ok("lifelog_trips", {}), /No trips yet/);
  await ok("lifelog_add_trip", { name: "Rome", start: "2027-04-10", end: "2027-04-12" });
  assert.ok(!/\n/.test(fs.readFileSync(TRAVEL, "utf8")), "travel.json is written compact, as the app writes it");
  await ok("lifelog_add_place", { trip: "rome", name: "Trastevere walk", day: "2027-04-11" });
  await ok("lifelog_add_place", { trip: "Rome", name: "Colosseum", day: "2027-04-11", time: "10:00", endTime: "11:30" });
  await ok("lifelog_add_place", { trip: "Rome", name: "Giolitti", note: "gelato" });
  await refused("lifelog_add_place", { trip: "Rome", name: "Vatican", time: "09:00" }, /A time needs a day/);
  await refused("lifelog_add_place", { trip: "Paris", name: "Louvre" }, /No trip matches "Paris"/);
  const plan = await ok("lifelog_trips", { trip: "Rome" });
  assert.match(plan, /Sat 10 Apr \(2027-04-10\): nothing planned/);
  assert.match(plan, /Sun 11 Apr \(2027-04-11\)\n- 10:00–11:30 Colosseum .*\n- Trastevere walk/, "a scheduled place comes first");
  assert.match(plan, /No day yet\n- Giolitti — gelato/);
  assert.match(await ok("lifelog_trips", {}), /Rome: 10–12 Apr 2027, 3 places/);

  await ok("lifelog_update_place", { place: "giolitti", day: "2027-04-12", time: "16:00", visited: true });
  let g = travel().places.find((p) => p.name === "Giolitti");
  assert.deepStrictEqual([g.day, g.time, g.visited], ["2027-04-12", "16:00", true]);
  assert.notStrictEqual(g.updatedAt, g.createdAt);
  await ok("lifelog_update_place", { place: "Giolitti", day: "", visited: false });
  g = travel().places.find((p) => p.name === "Giolitti");
  assert.ok(!g.day && !g.time && !g.visited, "no day takes the time with it");
  await ok("lifelog_update_trip", { trip: "Rome", name: "Rome in spring", end: "2027-04-13" });
  assert.deepStrictEqual([travel().trips[0].name, travel().trips[0].end], ["Rome in spring", "2027-04-13"]);
  assert.match(await ok("lifelog_search", { query: "colos" }), /place in Rome in spring: Colosseum/);

  await ok("lifelog_delete_trip", { trip: "Rome in spring" });
  assert.deepStrictEqual([travel().trips.length, travel().places.length], [0, 0]);
  await ok("lifelog_undo", {});
  assert.deepStrictEqual([travel().trips.length, travel().places.length], [1, 3], "one undo brings back the trip and its places");
});

test("a Google Maps list: read straight from Google, then picked into a trip without doubles", async () => {
  reset();
  const { googleList, LIST_ID } = require("./fixtures/google-list.js");
  const realFetch = global.fetch;
  const asked = [];
  global.fetch = async (url, init) => {
    asked.push(String(url));
    if (String(url).startsWith("https://maps.app.goo.gl/")) {
      assert.strictEqual(init && init.redirect, "manual", "the short link's redirect is read, not followed");
      return new Response(null, { status: 302, headers: { location: `https://www.google.com/maps/@/data=!4m3!11m2!2s${LIST_ID}!3e3` } });
    }
    return new Response(googleList(), { status: 200 });
  };
  try {
    const listed = await ok("lifelog_google_list", { link: "https://maps.app.goo.gl/Code1?g_st=ac" });
    assert.match(listed, /^Italy: 5 places/);
    assert.match(listed, /\nMilano\n- Duomo di Milano — P\.za del Duomo/);
    assert.ok(asked[1].includes("!1s" + LIST_ID), "the list is fetched by the id the link led to");
    assert.ok(!/Someone/.test(listed), "the list's owner never reaches the AI");

    await ok("lifelog_add_trip", { name: "Milan" });
    const out = await ok("lifelog_import_google_list", { trip: "Milan", link: "https://maps.app.goo.gl/Code1", only: "milano" });
    assert.match(out, /Added 2 places from "Italy" to Milan, no day yet/);
    let ps = travel().places;
    assert.deepStrictEqual(ps.map((p) => [p.name, p.gid, p.source, p.order]), [
      ["Duomo di Milano", "0x1334f4aad1240001:0x2a", LIST_ID, 0], ["Sforzesco Castle", "0x1334f4aad1240002:0x2b", LIST_ID, 1]]);
    assert.match(await ok("lifelog_import_google_list", { trip: "Milan", link: "https://maps.app.goo.gl/Code1", only: "milano" }), /Nothing to add: all 2 places are already in Milan/);
    assert.match(await ok("lifelog_import_google_list", { trip: "Milan", link: "https://maps.app.goo.gl/Code1", only: "duomo, colosseo" }), /Added 1 place .*; 1 already there/);
    await refused("lifelog_import_google_list", { trip: "Milan", link: "https://maps.app.goo.gl/Code1", only: "paris" }, /None of the 5 places/);
    await refused("lifelog_google_list", { link: "https://example.com/x" }, /isn't a Google Maps list or place/);
    await ok("lifelog_undo", {});
    assert.strictEqual(travel().places.length, 2, "an import is undone in one step");
  } finally {
    global.fetch = realFetch;
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
    if (url.includes("/contents/data/boards.json") && opts.method === "GET") return json(404, { message: "Not Found" });
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
    // boards.json sits beside the data file; not there yet, it reads empty
    // and the first save creates it, compact.
    const bs = openStore({ token: "t", owner: "me", repo: "lifelog-data", path: "data/lifelog.json", branch: "main" }).sibling("boards.json", { boards: [] });
    assert.deepStrictEqual(await bs.read(), { data: { boards: [] }, version: null });
    assert.strictEqual(await bs.write({ boards: [] }, null, "m"), true);
    assert.ok(calls.includes("PUT /repos/me/lifelog-data/contents/data/boards.json") && calls.includes("sha undefined branch main"));
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
    "## Trips (`travel.json`)": [["travel.js", "KNOWN_TRIP_KEYS"], ["travel.js", "KNOWN_PLACE_KEYS"]],
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
