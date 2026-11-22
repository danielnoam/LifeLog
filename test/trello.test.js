// Zero-dependency tests for src/trello.js: Trello lists as task lists, both
// ways, run against a fake Trello — `node test/trello.test.js`.
const assert = require("assert");
global.window = {};
const T = require("../src/trello.js");

let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

const L1 = "a".repeat(24), L2 = "b".repeat(24), B = "c".repeat(24), DONE = "d".repeat(24), ME = "e".repeat(24);
const id = (n) => String(n).padStart(24, "0");
const LBL = [{ id: id(901), name: "urgent" }, { id: id(902), name: "" }];

// A fake Trello: cards by id, answering the few routes trello.js uses.
function fakeTrello(cards) {
  const db = new Map(cards.map((c) => [c.id, { idBoard: B, closed: false, dueComplete: false, desc: "", due: null, idLabels: [], idMembers: [ME], checklists: [], dateLastActivity: "2026-11-01T00:00:00.000Z", ...c }]));
  const calls = [];
  let next = 500;
  const json = (v, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(v) });
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/1/, "");
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: p, body, auth: init.headers && init.headers.Authorization });
    let m;
    if (method === "GET" && (m = /^\/lists\/(\w+)\/cards$/.exec(p))) return json([...db.values()].filter((c) => c.idList === m[1] && !c.closed));
    if (method === "GET" && /^\/boards\/\w+\/labels$/.test(p)) return json(LBL);
    if (method === "GET" && /^\/boards\/\w+\/lists$/.test(p)) return json([{ id: L1, name: "To do" }, { id: L2, name: "Doing" }, { id: DONE, name: "Done" }]);
    if (method === "GET" && (m = /^\/cards\/(\w+)$/.exec(p))) return db.has(m[1]) ? json(db.get(m[1])) : json("not found", 404);
    if (method === "PUT" && (m = /^\/cards\/(\w+)$/.exec(p))) { Object.assign(db.get(m[1]), body); return json(db.get(m[1])); }
    if (method === "POST" && p === "/cards") { const c = { id: id(next++), idBoard: B, closed: false, dueComplete: false, idLabels: [], idMembers: [ME], checklists: [], ...body }; db.set(c.id, c); return json(c); }
    if (method === "PUT" && (m = /^\/cards\/(\w+)\/checkItem\/(\w+)$/.exec(p))) {
      for (const cl of db.get(m[1]).checklists) for (const ci of cl.checkItems) if (ci.id === m[2]) Object.assign(ci, body);
      return json({});
    }
    if (method === "POST" && (m = /^\/cards\/(\w+)\/checklists$/.exec(p))) { const cl = { id: id(next++), name: body.name, checkItems: [] }; db.get(m[1]).checklists.push(cl); return json(cl); }
    if (method === "POST" && (m = /^\/checklists\/(\w+)\/checkItems$/.exec(p))) {
      const ci = { id: id(next++), name: body.name, state: body.checked ? "complete" : "incomplete", pos: 99 };
      for (const c of db.values()) for (const cl of c.checklists) if (cl.id === m[1]) cl.checkItems.push(ci);
      return json(ci);
    }
    if (method === "DELETE") return json({});
    return json("no route " + method + " " + p, 404);
  }
  return { db, calls, fetch };
}
// These run a board as a task list per Trello list (its switch off); the
// board tests further down run it as one.
const cfg = (o = {}) => T.cleanConfig({ key: "k".repeat(32), token: "tok", member: { id: ME, username: "me" }, lists: [{ id: L1, name: "To do", board: B, boardName: "Home" }], split: [B], ...o });
async function sync(data, c, trello) {
  const s = await T.syncData(() => data, c, trello.fetch);
  await s.run();
  return s;
}
const note = (data, listId = L1) => data.notes.find((n) => n.trello && n.trello.list === listId);
const task = (data, cardId) => data.notes.flatMap((n) => n.items || []).find((x) => x.trello && x.trello.card === cardId);
const sends = (trello) => trello.calls.filter((c) => c.method !== "GET");

test("cards come in as tasks: due as the date, named labels as tags, checklist items as subtasks", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "Order the sink", desc: "Steel", due: "2026-11-25T08:30:00.000Z", idLabels: [id(901), id(902)],
    checklists: [{ id: id(50), checkItems: [{ id: id(51), name: "Measure", state: "complete", pos: 1 }, { id: id(52), name: "Pick", state: "incomplete", pos: 2 }] }] }]);
  const data = { notes: [] };
  await sync(data, cfg(), tr);
  const n = note(data);
  assert.strictEqual(n.id, "trello-" + L1);
  assert.strictEqual(n.kind, "list");
  assert.strictEqual(n.text, "Home · To do");
  const it = task(data, id(1));
  assert.strictEqual(it.id, "trello-" + id(1));
  assert.strictEqual(it.text, "Order the sink");
  assert.strictEqual(it.note, "Steel");
  assert.deepStrictEqual(T.fromDue("2026-11-25T08:30:00.000Z"), { date: it.date, time: it.time });
  assert.deepStrictEqual(it.tags, ["urgent"], "the unnamed label makes no tag");
  const kids = n.items.filter((x) => x.parent === it.id);
  assert.deepStrictEqual(kids.map((k) => [k.text, !!k.done]), [["Measure", true], ["Pick", false]]);
  assert.deepStrictEqual(it.trello.checks, [id(51), id(52)]);
  assert.deepStrictEqual(sends(tr), [], "nothing is sent on a first read");
  assert.ok(tr.calls[0].auth.includes('oauth_token="tok"'), "the token goes in the header, never the URL");
  assert.ok(!tr.calls.some((c) => /tok/.test(c.path)));
});

test("a tick here marks the card complete; a second sync sends nothing", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "A" }]);
  const data = { notes: [] };
  await sync(data, cfg(), tr);
  const it = task(data, id(1));
  it.done = true; it.doneAt = "2026-11-21T10:00:00.000Z"; it.updatedAt = "2026-11-21T10:00:00.000Z";
  await sync(data, cfg(), tr);
  assert.deepStrictEqual(sends(tr).map((c) => [c.method, c.path, c.body]), [["PUT", "/cards/" + id(1), { dueComplete: true }]]);
  assert.strictEqual(tr.db.get(id(1)).dueComplete, true);
  tr.calls.length = 0;
  await sync(data, cfg(), tr);
  assert.deepStrictEqual(sends(tr), []);
  assert.strictEqual(task(data, id(1)).done, true);
});

test("tick moves the card to the board's Done list, or archives it, as picked; unticking brings it back", async () => {
  for (const [tick, want] of [["move", { idList: DONE, pos: "top" }], ["archive", { closed: true }]]) {
    const tr = fakeTrello([{ id: id(1), idList: L1, name: "A" }]);
    const data = { notes: [] };
    const c = cfg({ tick });
    await sync(data, c, tr);
    Object.assign(task(data, id(1)), { done: true, doneAt: "2026-11-21T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z" });
    await sync(data, c, tr);
    assert.deepStrictEqual(sends(tr)[0].body, want, tick);
    assert.strictEqual(task(data, id(1)).trello.gone, true);
    const it = task(data, id(1));
    delete it.done; delete it.doneAt; it.updatedAt = "2026-11-21T11:00:00.000Z";
    await sync(data, c, tr);
    const back = tr.db.get(id(1));
    assert.ok(back.idList === L1 && !back.closed && !back.dueComplete, tick + ": unticked before it left, back on the list");
    assert.ok(!task(data, id(1)).done);
    Object.assign(task(data, id(1)), { done: true, doneAt: "2026-11-21T12:00:00.000Z", updatedAt: "2026-11-21T12:00:00.000Z" });
    await sync(data, c, tr);
    tr.calls.length = 0;
    await sync(data, c, tr);
    assert.ok(!task(data, id(1)), tick + ": once off its list, it leaves this one too");
    assert.ok(!tr.calls.some((x) => x.path === "/cards/" + id(1)), "and isn't asked about");
  }
});

test("a change there comes in; a change here goes there; both, the newer wins", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "Old", desc: "d" }]);
  const data = { notes: [] };
  await sync(data, cfg(), tr);
  Object.assign(tr.db.get(id(1)), { name: "Renamed there", dateLastActivity: "2026-11-21T09:00:00.000Z" });
  task(data, id(1)).note = "edited here";
  task(data, id(1)).updatedAt = "2026-11-21T08:00:00.000Z";
  await sync(data, cfg(), tr);
  assert.strictEqual(task(data, id(1)).text, "Renamed there");
  assert.strictEqual(tr.db.get(id(1)).desc, "edited here");
  // Both change the name: the later one stays.
  Object.assign(tr.db.get(id(1)), { name: "There, earlier", dateLastActivity: "2026-11-21T10:00:00.000Z" });
  Object.assign(task(data, id(1)), { text: "Here, later", updatedAt: "2026-11-21T11:00:00.000Z" });
  await sync(data, cfg(), tr);
  assert.strictEqual(task(data, id(1)).text, "Here, later");
  assert.strictEqual(tr.db.get(id(1)).name, "Here, later");
});

test("a new task here becomes a card with its date and label tags; one with no label stays a LifeLog tag", async () => {
  const tr = fakeTrello([]);
  const data = { notes: [] };
  await sync(data, cfg(), tr);
  note(data).items.push({ id: "x1", text: "Call the plumber", date: "2026-11-24", tags: ["urgent", "home"], note: "after 5" });
  await sync(data, cfg(), tr);
  const post = sends(tr).find((c) => c.method === "POST");
  assert.deepStrictEqual(post.body, { idList: L1, name: "Call the plumber", pos: "bottom", desc: "after 5", due: T.dueOf({ date: "2026-11-24" }), idLabels: [id(901)] });
  const it = note(data).items.find((x) => x.id === "x1");
  assert.ok(it.trello.card, "linked to its new card");
  assert.ok(note(data).trello.cards.includes(it.trello.card));
  assert.deepStrictEqual(it.tags, ["urgent", "home"]);
  tr.calls.length = 0;
  await sync(data, cfg(), tr);
  assert.deepStrictEqual(sends(tr), [], "nothing more to send: the noon due and the label tag match");
});

test("deleting a task here archives its card, never deletes it", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "A" }, { id: id(2), idList: L1, name: "B" }]);
  const data = { notes: [] };
  await sync(data, cfg(), tr);
  note(data).items = note(data).items.filter((x) => x.trello.card !== id(1));
  await sync(data, cfg(), tr);
  assert.deepStrictEqual(sends(tr).map((c) => [c.method, c.path, c.body]), [["PUT", "/cards/" + id(1), { closed: true }]]);
  assert.ok(!tr.calls.some((c) => c.method === "DELETE"));
  assert.ok(!task(data, id(1)));
});

test("archived or moved off there, or deleted there, leaves the list; moved to another linked list moves it", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "A" }, { id: id(2), idList: L1, name: "B" }, { id: id(3), idList: L1, name: "C" }, { id: id(4), idList: L1, name: "D" }]);
  const data = { notes: [] };
  const c = cfg({ lists: [{ id: L1, name: "To do", board: B, boardName: "Home" }, { id: L2, name: "Doing", board: B, boardName: "Home" }] });
  await sync(data, c, tr);
  tr.db.get(id(1)).closed = true;
  tr.db.delete(id(2));
  tr.db.get(id(3)).idList = L2;
  tr.db.get(id(4)).idList = DONE;
  await sync(data, c, tr);
  assert.ok(!task(data, id(1)), "archived there, gone here");
  assert.ok(!task(data, id(4)), "moved to a list not picked, gone here");
  assert.ok(!task(data, id(2)), "deleted there, gone here");
  assert.ok(note(data, L2).items.some((x) => x.trello.card === id(3)) && !note(data, L1).items.some((x) => x.trello && x.trello.card === id(3)));
  assert.deepStrictEqual(sends(tr), []);
});

test("ticked tasks an earlier sync left behind, their cards long gone, leave", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "A" }]);
  const data = { notes: [] };
  await sync(data, cfg(), tr);
  note(data).items.push({ id: "trello-" + id(9), text: "Old", done: true, trello: { card: id(9), base: { name: "Old", desc: "", due: null, done: true, labels: [] }, checks: [], gone: true } });
  note(data).trello.cards.push(id(9));
  await sync(data, cfg(), tr);
  assert.deepStrictEqual(note(data).items.map((x) => x.text), ["A"]);
  assert.deepStrictEqual(sends(tr), []);
});

test("read only sends nothing but still brings changes in", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "A" }]);
  const data = { notes: [] };
  const c = cfg({ send: false });
  await sync(data, c, tr);
  Object.assign(task(data, id(1)), { done: true, updatedAt: "2026-11-21T10:00:00.000Z" });
  note(data).items.push({ id: "x", text: "new" });
  tr.db.get(id(1)).name = "B";
  await sync(data, c, tr);
  assert.deepStrictEqual(sends(tr), []);
  assert.strictEqual(task(data, id(1)).text, "B");
});

test("only cards I'm on leaves the rest of a shared board out", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "Mine" }, { id: id(2), idList: L1, name: "Theirs", idMembers: [id(77)] }]);
  const data = { notes: [] };
  await sync(data, cfg({ mine: true }), tr);
  assert.deepStrictEqual(note(data).items.map((x) => x.text), ["Mine"]);
});

test("a subtask ticked or added here goes to the card's checklist", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "A", checklists: [{ id: id(50), checkItems: [{ id: id(51), name: "one", state: "incomplete", pos: 1 }] }] },
    { id: id(2), idList: L1, name: "B" }]);
  const data = { notes: [] };
  await sync(data, cfg(), tr);
  const n = note(data);
  Object.assign(n.items.find((x) => x.trello && x.trello.check === id(51)), { done: true, updatedAt: "2026-11-21T10:00:00.000Z" });
  n.items.push({ id: "s1", text: "two", parent: "trello-" + id(1) }, { id: "s2", text: "first of B", parent: "trello-" + id(2) });
  await sync(data, cfg(), tr);
  assert.strictEqual(tr.db.get(id(1)).checklists[0].checkItems[0].state, "complete");
  assert.deepStrictEqual(tr.db.get(id(1)).checklists[0].checkItems.map((c) => c.name), ["one", "two"]);
  assert.deepStrictEqual(tr.db.get(id(2)).checklists.map((c) => c.checkItems.map((x) => x.name)), [["first of B"]], "a card with no checklist gets one");
  assert.ok(n.items.find((x) => x.id === "s1").trello.check);
  tr.calls.length = 0;
  await sync(data, cfg(), tr);
  assert.deepStrictEqual(sends(tr), []);
});

test("a repeating task completed in Trello moves to its next date here, and the card reopens with that date", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "Water plants", due: T.dueOf({ date: "2026-11-21", time: "09:00" }) }]);
  const data = { notes: [] };
  await sync(data, cfg(), tr);
  Object.assign(task(data, id(1)), { repeat: { every: 3, unit: "day" }, updatedAt: "2026-11-20T00:00:00.000Z" });
  Object.assign(tr.db.get(id(1)), { dueComplete: true, dateLastActivity: "2026-11-21T10:00:00.000Z" });
  await sync(data, cfg(), tr);
  const it = task(data, id(1));
  assert.ok(!it.done && it.date === "2026-11-24" && it.ticks.length === 1, JSON.stringify(it));
  assert.strictEqual(tr.db.get(id(1)).dueComplete, false);
  assert.ok(T.fromDue(tr.db.get(id(1)).due).date === "2026-11-24");
});

test("settings are cleaned: bad ids dropped, unknown fields kept, token blanked out of exports", () => {
  const c = T.cleanConfig({ lists: [{ id: "nope", board: B }, { id: L1, board: B, name: " To do " }, { id: L1, board: B }], tick: "explode", future: 1 });
  assert.deepStrictEqual(c.lists, [{ id: L1, name: "To do", board: B, boardName: "" }]);
  assert.strictEqual(c.tick, "complete");
  assert.strictEqual(c.future, 1);
  assert.strictEqual(T.connected(c), !!T.APP_KEY && false);
  assert.ok(/key=k{32}$/.test(T.authorizeUrl("k".repeat(32))) && /scope=read,write/.test(T.authorizeUrl("x")) && /expiration=never/.test(T.authorizeUrl("x")));
});

// ---------- a board as one task list (Daniel, 2026-11-22) ----------
const BOTH = [{ id: L1, name: "To do", board: B, boardName: "Home" }, { id: L2, name: "Doing", board: B, boardName: "Home" }];
const boardCfg = (o = {}) => cfg({ lists: BOTH, split: [], ...o });
const boardNote = (data) => data.notes.find((n) => n.id === "trello-board-" + B);

test("a board's lists come in as one task list, each list a section", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "A" }, { id: id(2), idList: L2, name: "B" }]);
  const data = { notes: [] };
  await sync(data, boardCfg(), tr);
  assert.strictEqual(data.notes.length, 1);
  const n = boardNote(data);
  assert.strictEqual(n.text, "Home");
  assert.deepStrictEqual(n.sections, [{ id: L1, name: "To do" }, { id: L2, name: "Doing" }]);
  assert.deepStrictEqual(n.items.map((x) => [x.text, x.section]), [["A", L1], ["B", L2]]);
  assert.deepStrictEqual(sends(tr), []);
});

test("a card moved between the board's lists changes section; a section changed here moves the card", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "A" }, { id: id(2), idList: L1, name: "B" }]);
  const data = { notes: [] };
  await sync(data, boardCfg(), tr);
  tr.db.get(id(1)).idList = L2;
  tr.db.get(id(1)).dateLastActivity = "2026-11-30T00:00:00.000Z";
  await sync(data, boardCfg(), tr);
  assert.strictEqual(task(data, id(1)).section, L2);
  assert.ok(!task(data, id(1)).done, "moved, not done");
  assert.deepStrictEqual(sends(tr), []);
  task(data, id(2)).section = L2;
  task(data, id(2)).updatedAt = "2026-12-01T00:00:00.000Z";
  await sync(data, boardCfg(), tr);
  assert.strictEqual(tr.db.get(id(2)).idList, L2);
  const n = sends(tr).length;
  await sync(data, boardCfg(), tr);
  assert.strictEqual(sends(tr).length, n, "a second sync sends nothing");
});

test("on a board's task list a tick moves the card to its Done list, unless ticking archives", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L2, name: "A" }, { id: id(2), idList: L1, name: "B" }]);
  const data = { notes: [] };
  await sync(data, boardCfg(), tr);
  Object.assign(task(data, id(1)), { done: true, doneAt: "2026-11-02T00:00:00.000Z" });
  await sync(data, boardCfg(), tr);
  assert.strictEqual(tr.db.get(id(1)).idList, DONE);
  Object.assign(task(data, id(2)), { done: true, doneAt: "2026-11-02T00:00:00.000Z" });
  await sync(data, boardCfg({ tick: "archive" }), tr);
  assert.strictEqual(tr.db.get(id(2)).closed, true);
  assert.strictEqual(tr.db.get(id(2)).idList, L1);
});

test("a new task here goes to its section's list, the first when it has none", async () => {
  const tr = fakeTrello([]);
  const data = { notes: [] };
  await sync(data, boardCfg(), tr);
  boardNote(data).items.push({ id: "n1", text: "First" }, { id: "n2", text: "Second", section: L2 });
  await sync(data, boardCfg(), tr);
  const posts = sends(tr).filter((c) => c.path === "/cards");
  assert.deepStrictEqual(posts.map((c) => [c.body.name, c.body.idList]), [["First", L1], ["Second", L2]]);
  assert.strictEqual(boardNote(data).items.find((x) => x.id === "n2").section, L2);
});

test("switching a board to one task list and back moves the tasks, keeps their ids and sends nothing", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "A" }, { id: id(2), idList: L2, name: "B" }]);
  const data = { notes: [{ id: "x", kind: "list", text: "Mine", items: [] }] };
  const split = boardCfg({ split: [B] });
  await sync(data, split, tr);
  note(data, L1).fav = true;
  assert.strictEqual(data.notes.length, 3);
  await sync(data, boardCfg(), tr);
  assert.deepStrictEqual(data.notes.map((n) => n.id).sort(), ["trello-board-" + B, "x"].sort());
  assert.deepStrictEqual(boardNote(data).items.map((x) => [x.id, x.section]), [["trello-" + id(1), L1], ["trello-" + id(2), L2]]);
  assert.strictEqual(boardNote(data).fav, true, "the favourite star comes along");
  await sync(data, split, tr);
  assert.ok(!boardNote(data));
  assert.deepStrictEqual(note(data, L1).items.map((x) => x.id), ["trello-" + id(1)]);
  assert.deepStrictEqual(note(data, L2).items.map((x) => x.id), ["trello-" + id(2)]);
  assert.ok(!note(data, L2).items[0].section);
  assert.deepStrictEqual(sends(tr), []);
});

test("a list turned off takes its tasks off the board's task list, and nothing is archived", async () => {
  const tr = fakeTrello([{ id: id(1), idList: L1, name: "A" }, { id: id(2), idList: L2, name: "B" }]);
  const data = { notes: [] };
  await sync(data, boardCfg(), tr);
  await sync(data, boardCfg({ lists: [BOTH[0]] }), tr);
  assert.deepStrictEqual(boardNote(data).items.map((x) => x.text), ["A"]);
  assert.deepStrictEqual(boardNote(data).sections.map((x) => x.id), [L1]);
  assert.deepStrictEqual(sends(tr), []);
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log("  ok - " + name); }
    catch (e) { console.error("  FAIL - " + name); console.error("    " + (e.stack || e.message)); process.exitCode = 1; }
  }
  console.log(passed + " passed");
})();
