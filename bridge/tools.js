// Every tool the bridge offers, as one table that both front ends serve:
// mcp.js (any MCP client: Telemachus, Claude, Cursor...) and cli.js (any AI
// that can run a command). Each tool says whether it only reads; every write
// goes through change(), which cleans what it writes with the app's own
// sanitizers, stamps it the way the app stamps a save, and remembers how to
// undo it.
//
// When the app's data changes shape, this file and DATA.md change with it
// (CLAUDE.md, "The AI bridge"); test/bridge.test.js fails until they do.
"use strict";

const fs = require("fs");
const path = require("path");
const { load } = require("./load.js");
const { readConfig, openStore, undoLog, SetupError } = require("./store.js");

const L = load();
const { App, Finance, Journal, Backlog, Notes, Habits, Boards, Travel, Merge, Widgets, Recap } = L;

// ---------- the collections an AI may edit ----------
// `cats` names the list a `category` must come from; notes may have none.
const COLLECTIONS = {
  entries: { label: "timeline entry", clean: Journal.sanitizeEntry, cats: "categories", name: "title" },
  backlog: { label: "backlog item", clean: Backlog.sanitizeBacklog, cats: "categories", name: "title" },
  notes: { label: "note", clean: Notes.sanitizeNote, cats: "noteCategories", name: "title", optionalCat: true },
  financeEntries: { label: "expense", clean: Finance.sanitizeFinanceEntry, cats: "financeCategories", name: "note" },
  recurringExpenses: { label: "recurring expense", clean: Finance.sanitizeRecurring, cats: "financeCategories", name: "note" },
  habits: { label: "habit", clean: Habits.sanitizeHabit, name: "name" },
  projects: { label: "project", clean: Finance.sanitizeProject, name: "name" },
};
// Never handed to an AI: API keys and account names live in settings.
const SECRET_SETTINGS = ["mediaKeys", "steam", "anilist"];

// ---------- small helpers ----------
const today = () => Finance.localDateStr(new Date());
const nowIso = () => new Date().toISOString();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const lower = (s) => String(s == null ? "" : s).trim().toLowerCase();
const currencyOf = (data) => (data.settings && data.settings.currency) || "ILS";
const money = (data, n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + currencyOf(data);
const cut = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
// How far a show has run (see DATA.md): "airing S3 7/10", "finished 24/24".
const airingFlag = (b) => [b.airing, b.airingSeason && "S" + b.airingSeason,
  b.episodesOut && (b.episodesTotal ? b.episodesOut + "/" + b.episodesTotal : b.episodesOut + " out")].filter(Boolean).join(" ");
// How far into it you are (0.292.0): "ep 7/12", "ch 40".
const progressFlag = (b) => (/manga/.test(b.mediaSource || "") ? "ch " : "ep ") + (+b.progress || 0) + (b.episodesTotal ? "/" + b.episodesTotal : "");
// An author given by hand is pinned, as one typed in the app is: a sync
// won't replace it (see DATA.md).
const authored = (a) => (a.author && String(a.author).trim() ? { author: String(a.author).trim(), overrides: { author: true } } : {});
const limitOf = (a, d) => Math.max(1, Math.min(500, parseInt(a.limit, 10) || d));
const head = (n, shown, what) => `${n} ${what}` + (n > shown ? ` (showing ${shown}; raise limit for more)` : "");

class InputError extends Error {}
const fail = (msg) => { throw new InputError(msg); };

function requireDate(s, field) {
  if (s == null || s === "") return null;
  if (!isDate(s)) fail(`${field} must be YYYY-MM-DD, got "${s}".`);
  return s;
}

// A category or project by name, case-insensitively, as its exact stored name.
function nameIn(data, key, wanted, what) {
  const names = (data[key] || []).map((c) => c.name);
  const hit = names.find((n) => lower(n) === lower(wanted));
  if (hit) return hit;
  fail(`No ${what} called "${wanted}". There are: ${names.join(", ") || "none"}.`);
}

// An expense category's subcategory (0.288.0), by name, under its parent.
function subIn(data, category, wanted) {
  const cat = (data.financeCategories || []).find((c) => c.name === category);
  const names = ((cat && cat.subs) || []).map((x) => x.name);
  const hit = names.find((n) => lower(n) === lower(wanted));
  if (hit) return hit;
  fail(`"${category}" has no subcategory called "${wanted}". It has: ${names.join(", ") || "none"}. Add one with lifelog_add_subcategory.`);
}
const catLabel = (f) => (f.subcategory ? `${f.category} › ${f.subcategory}` : f.category);

// An item by id, or by its name/title: exact first, then a unique partial.
function findItem(data, coll, ident) {
  const spec = COLLECTIONS[coll];
  const list = data[coll] || [];
  const want = String(ident == null ? "" : ident).trim();
  if (!want) fail(`Say which ${spec.label} (its id or ${spec.name}).`);
  const byId = list.find((x) => x.id === want);
  if (byId) return byId;
  const label = (x) => lower(x[spec.name] || (coll === "notes" ? x.text : ""));
  const exact = list.filter((x) => label(x) === lower(want));
  if (exact.length === 1) return exact[0];
  const part = list.filter((x) => label(x).includes(lower(want)));
  if (part.length === 1) return part[0];
  if (!part.length && !exact.length) fail(`No ${spec.label} matches "${want}".`);
  const some = (exact.length ? exact : part).slice(0, 8).map((x) => `${x.id} (${cut(x[spec.name] || x.text, 40)})`);
  fail(`Several ${spec.label}s match "${want}"; use an id: ${some.join("; ")}.`);
}

// The app's cleaning of an item, with what it refused said out loud rather
// than silently dropped.
function cleanItem(data, coll, item, asked) {
  const spec = COLLECTIONS[coll];
  if (item.category != null && item.category !== "" && spec.cats) {
    item.category = nameIn(data, spec.cats, item.category, "category");
  }
  if (item.subcategory && spec.cats === "financeCategories") item.subcategory = subIn(data, item.category, item.subcategory);
  if (item.project) item.project = nameIn(data, "projects", item.project, "project");
  const out = spec.clean(structuredClone(item));
  for (const k of Object.keys(asked || {})) {
    if (asked[k] == null || asked[k] === "") continue;
    if (!(k in out)) fail(`LifeLog doesn't keep "${k}" on this ${spec.label} (see lifelog_guide for its fields).`);
  }
  return out;
}

// ---------- reading ----------
// Three files: lifelog.json ("data"), and beside it the drawing boards'
// boards.json ("boards"), which the app keeps apart so drawing never slows a
// save, and the trips' travel.json ("travel"), kept apart so a build older
// than them can't drop them in a merge.
const SIBLINGS = {
  boards: { name: "boards.json", empty: { boards: [] }, keys: ["boards"] },
  travel: { name: "travel.json", empty: { trips: [], places: [] }, keys: ["trips", "places"] },
};
let store = null, cfg = null;
const siblingStores = {};
function storeOf(file) {
  if (!store) { cfg = readConfig(); store = openStore(cfg); }
  const sib = SIBLINGS[file];
  if (!sib) return store;
  return siblingStores[file] = siblingStores[file] || store.sibling(sib.name, sib.empty);
}
async function readData() { return (await storeOf().read()).data; }
async function readTravel() { return Travel.sanitizeDoc((await storeOf("travel").read()).data); }
async function readBoards() {
  const doc = (await storeOf("boards").read()).data;
  return (doc.boards || []).map(Boards.sanitizeBoard);
}

// ---------- writing ----------
// apply(doc) changes the file's contents in place and returns
// { text, touched: [[coll, id]] }. Applied to the latest file each attempt,
// so a save that lost a race is simply made again on top of the newer one.
// One timestamp per change, so a new item's createdAt and updatedAt agree.
let changeNow = null;

// An item as it stands, for undo. Accomplishments are kept by year rather
// than in a list, so theirs carries the year as merge.js's __year does.
function snapshotOf(doc, coll, id) {
  // A settings map the change moved, by its key. Its "updatedAt" is the
  // map's content, so undo refuses only when that map itself changed since.
  if (coll === "settings") {
    const v = doc.settings && doc.settings[id];
    return v === undefined ? null : { id, value: structuredClone(v), updatedAt: JSON.stringify(v) };
  }
  if (coll === "accomplishments") {
    for (const [y, list] of Object.entries(doc.accomplishments || {})) {
      const a = (list || []).find((x) => x.id === id);
      if (a) return { ...a, __year: y };
    }
    return null;
  }
  return (doc[coll] || []).find((x) => x.id === id) || null;
}
function restoreItem(doc, coll, id, before) {
  if (coll === "settings") {
    doc.settings = doc.settings || {};
    if (before) doc.settings[id] = before.value; else delete doc.settings[id];
    return;
  }
  if (coll === "accomplishments") {
    removeAccomplishment(doc, id);
    if (before) {
      const { __year, ...a } = before;
      (doc.accomplishments[__year] = doc.accomplishments[__year] || []).push(a);
    }
    return;
  }
  if (before) replaceItem(doc, coll, before);
  else doc[coll] = (doc[coll] || []).filter((x) => x.id !== id);
}

// A board's or a trip's updatedAt moves when it changes, as the app's
// changed() does; merge.js's stamping covers lifelog.json's collections only.
function stampSibling(before, doc, keys, now) {
  for (const k of keys) {
    const was = new Map((before[k] || []).map((b) => [b.id, JSON.stringify({ ...b, updatedAt: 0 })]));
    for (const b of doc[k] || []) if (was.get(b.id) !== JSON.stringify({ ...b, updatedAt: 0 })) b.updatedAt = now;
  }
}

// Who made a change, named in its commit message, which the app's History
// reads to tag the save ("LifeLog bridge (Telemachus): Logged …"): the MCP
// client's name, or LIFELOG_CLIENT_NAME. The names SDKs send by default say
// nothing, so they're left out and History just says AI.
let client = "";
function setClient(name) {
  const n = String(process.env.LIFELOG_CLIENT_NAME || name || "").replace(/[^\w .-]/g, "").trim().slice(0, 40);
  client = /^(mcp|client|python|node|unknown)$/i.test(n) ? "" : n;
}
setClient("");
function commitMessage(summary, text) {
  // The item id a reply ends with is for the AI, not for History.
  const first = String(text || "").split("\n")[0].trim().replace(/ id \S+$/, "");
  return `LifeLog bridge${client ? " (" + client + ")" : ""}: ${cut(first || summary, 160)}`;
}

// While lifelog_batch gathers its steps, change() hands each one over
// instead of saving it, so the lot is saved (and undone) as one.
let batch = null;

// One file's change, saved; returns its text and the undo record's items.
async function commit(file, summary, apply) {
  if (batch) fail("This tool can't be part of a batch; run it on its own.");
  const s = storeOf(file);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, version } = await s.read();
    const before = structuredClone(data);
    const now = changeNow = nowIso();
    let out;
    try { out = apply(data); } finally { changeNow = null; }
    if (SIBLINGS[file]) stampSibling(before, data, SIBLINGS[file].keys, now);
    else { Merge.stampChangedItems(before, data, now); data.exportedAt = now; }
    if (await s.write(data, version, commitMessage(summary, out.text))) {
      const items = out.touched.map(([coll, id]) => ({
        ...(SIBLINGS[file] ? { file } : {}), coll, id,
        before: snapshotOf(before, coll, id),
        after: (snapshotOf(data, coll, id) || {}).updatedAt || null,
      }));
      return { text: out.text, items, at: now };
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error("LifeLog kept changing while saving; try again.");
}

async function change(summary, apply, { undoable = true, file = "data" } = {}) {
  if (batch) { batch.push({ file, summary, apply }); return ""; }
  const done = await commit(file, summary, apply);
  if (undoable && done.items.length) undoLog(cfg).push({ summary, at: done.at, items: done.items });
  return done.text;
}

function addItem(data, coll, item) {
  const now = changeNow || nowIso();
  const fresh = cleanItem(data, coll, { id: L.uid(), createdAt: now, updatedAt: now, ...item }, item);
  (data[coll] = data[coll] || []).push(fresh);
  return fresh;
}

function replaceItem(data, coll, item) {
  const list = data[coll] || [];
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) list.push(item); else list[i] = item;
  data[coll] = list;
}

// ---------- accomplishments, bills, boards, category names ----------
// Accomplishments are the timeline's year highlights, kept by year.
function allAccomplishments(data) {
  return Object.entries(data.accomplishments || {}).flatMap(([y, list]) => (list || []).map((a) => ({ ...a, year: y })));
}
function findAccomplishment(data, ident) {
  const want = String(ident == null ? "" : ident).trim();
  if (!want) fail("Say which accomplishment (its id or text).");
  const all = allAccomplishments(data);
  const hit = all.find((a) => a.id === want) || pickByText(all, want, (a) => a.text, "accomplishment");
  return hit;
}
function removeAccomplishment(data, id) {
  for (const y of Object.keys(data.accomplishments || {})) {
    data.accomplishments[y] = data.accomplishments[y].filter((a) => a.id !== id);
    if (!data.accomplishments[y].length) delete data.accomplishments[y];
  }
}
function pickByText(list, want, textOf, what) {
  const exact = list.filter((x) => lower(textOf(x)) === lower(want));
  if (exact.length === 1) return exact[0];
  const part = list.filter((x) => lower(textOf(x)).includes(lower(want)));
  if (part.length === 1 && !exact.length) return part[0];
  if (!part.length) fail(`No ${what} matches "${want}".`);
  fail(`Several ${what}s match "${want}"; use an id: ${(exact.length ? exact : part).slice(0, 8).map((x) => `${x.id} (${cut(textOf(x), 40)})`).join("; ")}.`);
}

// A bill by any of its plans' ids, or by name among the bills the Ledger
// shows: a bill whose price changed is a chain of plans sharing one name.
function findBill(data, ident) {
  const want = String(ident == null ? "" : ident).trim();
  if (!want) fail("Say which recurring bill (its id or name).");
  const all = data.recurringExpenses || [];
  const byId = all.find((r) => r.id === want);
  const rec = byId || pickByText(bills(data), want, (r) => r.note || r.category, "recurring bill");
  const chain = Finance.planChain(all, rec);
  return { latest: chain[chain.length - 1], chain };
}

function findBoard(list, ident) {
  const want = String(ident == null ? "" : ident).trim();
  if (!want) fail("Say which board (its id or name).");
  return list.find((b) => b.id === want) || pickByText(list, want, (b) => b.name, "board");
}
function findTrip(list, ident) {
  const want = String(ident == null ? "" : ident).trim();
  if (!want) fail("Say which trip (its id or name).");
  return list.find((t) => t.id === want) || pickByText(list, want, (t) => t.name, "trip");
}
function findPlace(doc, ident, trip) {
  const want = String(ident == null ? "" : ident).trim();
  if (!want) fail("Say which place (its id or name).");
  const byId = doc.places.find((p) => p.id === want);
  if (byId) return byId;
  const list = trip ? doc.places.filter((p) => p.trip === findTrip(doc.trips, trip).id) : doc.places;
  return pickByText(list, want, (p) => p.name, "place");
}
// One place as a line of a trip's plan.
function placeLine(p) {
  const when = p.time ? Travel.timeLabel(p) + " " : "";
  const extra = [p.address, p.note].filter(Boolean).join(" · ");
  return `- ${when}${p.name}${p.visited ? " ✓ visited" : ""}${extra ? " — " + cut(extra, 160) : ""}  (${p.id})`;
}
// A Google Maps link's places, read the way the app reads them
// (Travel.fetchGoogle) but straight from Google: Node isn't a browser, so
// there's no CORS and no proxy. The short link's redirect is read, not
// followed, the way proxy/worker.js does it.
async function googleGet(kind, arg) {
  try {
    if (kind === "resolve") {
      let at = "https://maps.app.goo.gl/" + arg;
      for (let hop = 0; hop < 4; hop++) {
        const res = await fetch(at, { redirect: "manual" });
        const next = res.headers.get("location");
        if (!next) break;
        at = new URL(next, at).toString();
        if (!/^https:\/\/(maps\.app\.goo\.gl|goo\.gl)\//.test(at)) return at;
      }
      fail("That link didn't lead anywhere. Copy it again from Share in Google Maps.");
    }
    const res = await fetch(Travel.googleListUrl(arg));
    if (!res.ok) fail(`Google Maps didn't send that list (HTTP ${res.status}). Is it shared?`);
    return await res.text();
  } catch (e) {
    if (e instanceof InputError) throw e;
    fail("Couldn't reach Google Maps: " + ((e && e.message) || e));
  }
}
async function readGoogle(link) {
  try { return await Travel.fetchGoogle(link, googleGet); }
  catch (e) { if (e instanceof InputError) throw e; fail(String((e && e.message) || e) + "."); }
}

// The fields a place takes from a tool's arguments; an empty string clears.
const PLACE_FIELDS = ["name", "day", "time", "endTime", "address", "note", "url", "lat", "lng", "visited"];
function placeFields(a, into) {
  for (const k of PLACE_FIELDS) {
    if (a[k] == null) continue;
    if (a[k] === "") delete into[k]; else into[k] = a[k];
  }
  if (a.day != null && a.day !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(a.day)) fail("day is a date, YYYY-MM-DD.");
  for (const k of ["time", "endTime"]) if (a[k] && !/^\d{2}:\d{2}$/.test(a[k])) fail(`${k} is a time, HH:MM (24-hour).`);
  if (into.time && !into.day) fail("A time needs a day: give day too.");
  return into;
}

function boardTexts(b) {
  return (b.elements || []).filter((e) => e.t === "text" && String(e.text || "").trim()).map((e) => String(e.text).trim());
}

// The category lists by what the user calls them, and the rename that
// carries a name through every item holding it: the app's own.
const NAME_LISTS = {
  timeline: { list: "categories", label: "timeline category", rename: (d, from, to) => { Journal.renameCategory(d, from, to); return Journal.moveCategorySources(d, from, to).map((k) => ["settings", k]); }, uses: ["entries", "backlog"] },
  expense: { list: "financeCategories", label: "expense category", rename: (d, from, to) => Finance.renameFinanceCategory(d, from, to), uses: ["financeEntries", "recurringExpenses"] },
  note: { list: "noteCategories", label: "note category", rename: (d, from, to) => Notes.renameNoteCategory(d, from, to), uses: ["notes"] },
  project: { list: "projects", label: "project", rename: (d, from, to) => Finance.renameProject(d, from, to), uses: ["financeEntries", "recurringExpenses"] },
};

// The app's palette for a new category (CATEGORY_PALETTE in app.js).
const CAT_PALETTE = ["#e23b3b", "#e2723b", "#e2b23b", "#9fe23b", "#3be25a", "#3bb2e2", "#5b8cff", "#723be2", "#b23be2", "#e23b72", "#7a8a99"];

// A sub's rename (or, with `to` null, its removal) carried through the
// expenses and bills, as the app's; returns what it touched.
function subMove(d, parent, from, to) {
  const before = new Map(["financeEntries", "recurringExpenses"].flatMap((k) => (d[k] || []).map((x) => [k + "\u0000" + x.id, JSON.stringify(x)])));
  Finance.renameFinanceSubcategory(d, parent, from, to);
  return ["financeEntries", "recurringExpenses"].flatMap((k) => (d[k] || []).filter((x) => before.get(k + "\u0000" + x.id) !== JSON.stringify(x)).map((x) => [k, x.id]));
}

// ---------- what reads see ----------
// An expense row, recurring charges included, as the Ledger counts them.
function effectiveExpenses(data, until) {
  const out = (data.financeEntries || []).map((f) => ({ ...f, kind: "expense" }));
  for (const r of data.recurringExpenses || []) {
    for (const c of Finance.planCharges(r, until)) if (!c.skipped) out.push({ ...c, kind: "recurring" });
  }
  return out;
}

function untilDate(end) {
  const t = new Date(today() + "T00:00:00");
  if (!end) return t;
  const e = new Date(end + "T00:00:00");
  return e > t ? e : t;
}

function expenseRows(data, a) {
  const start = requireDate(a.start_date, "start_date") || "0000-00-00";
  const end = requireDate(a.end_date, "end_date") || today();
  const q = lower(a.query);
  const until = untilDate(end);
  return effectiveExpenses(data, until).filter((f) => {
    const d = String(f.date || "");
    if (d < start || d > end) return false;
    if (a.include_recurring === false && f.kind === "recurring") return false;
    if (a.category && lower(f.category) !== lower(a.category)) return false;
    // "" is the category's expenses with no subcategory.
    if (a.subcategory != null && lower(f.subcategory || "") !== lower(a.subcategory)) return false;
    if (a.project && lower(f.project) !== lower(a.project)) return false;
    if (q && !lower(f.note).includes(q) && !lower(catLabel(f)).includes(q)) return false;
    return true;
  });
}

function expenseLine(data, f) {
  const fx = f.currency ? ` (${f.fxAmount} ${f.currency} at ${f.rate})` : "";
  const bits = [f.kind === "recurring" ? "recurring" : "", f.project, f.note].filter(Boolean).join(" · ");
  const id = f.kind === "recurring" ? `plan ${f.recurringId}` : f.id;
  return `- ${f.date} ${money(data, +f.amount || 0)}${fx} [${catLabel(f)}]${bits ? " " + bits : ""}  (${id})`;
}

// The bills as the Ledger lists them: one per chain, its latest plan.
function bills(data) {
  const all = data.recurringExpenses || [];
  const replaced = new Set(all.map((r) => r.prevId).filter(Boolean));
  return all.filter((r) => !replaced.has(r.id));
}

function nextCharge(r) {
  const t = today();
  const far = new Date(); far.setDate(far.getDate() + 400);
  const c = Finance.planCharges(r, far).find((x) => x.date > t && !x.skipped);
  return c || null;
}

const PER_MONTH = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 };

function habitLine(h, t) {
  const mark = Habits.markOf(h, t);
  const due = Habits.isDue(h, t);
  const state = !due ? "not due today" : Habits.isDone(h, t)
    ? (h.avoid ? `kept today (${mark} of at most ${h.limit || 0})` : "done today")
    : (h.avoid ? `over the limit today (${mark})` : h.target > 1 ? `${mark} of ${h.target} today` : "not done yet today");
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = Finance.addDaysStr(t, -i);
    days.push(!Habits.isDue(h, d) ? "·" : Habits.isDone(h, d) ? (h.avoid && i === 0 && !Habits.markOf(h, d) ? "○" : "✓") : "✗");
  }
  return `- ${h.name}${h.avoid ? " (avoiding)" : ""} [${Habits.cadenceLabel(h)}]: ${state}; streak ${Habits.streakOf(h, t)}, best ${Habits.bestStreakOf(h, t)}; last 14 days ${days.join("")}  (${h.id})`;
}

function noteText(n, max) {
  const items = n.kind === "list" ? (n.items || []).map((i) => `\n    [${i.done ? "x" : " "}] ${i.text}  (${i.id})`).join("") : "";
  const by = n.kind === "quote" ? [n.author, n.source].filter(Boolean).join(", ") : "";
  return `${n.title || (n.kind === "list" ? "List" : n.kind === "quote" ? "Quote" : "Note")}`
    + `${n.category ? " [" + n.category + "]" : ""}${n.fav ? " ★" : ""} (${String(n.createdAt || "").slice(0, 10)}, ${n.id})`
    + (n.text ? ": " + cut(n.text, max) : "") + (by ? " — " + by : "") + items;
}

// ---------- the tools ----------
// Pictures in notes (0.297.0): what a note's text points at, and what kind
// of file some bytes are.
function noteImageRefs(text) {
  const out = [];
  const re = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g;
  for (const m of String(text || "").matchAll(re)) {
    const src = m[1] != null ? m[1].trim() : m[3];
    const kept = /^lifelog-img:([a-z0-9]{8,40}\.(?:jpg|png|gif|webp))$/.exec(src);
    out.push({ src, alt: m[2] || "", id: kept ? kept[1] : null, web: /^https?:/i.test(src) });
  }
  return out;
}
function imageType(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.slice(0, 3).toString() === "GIF") return "image/gif";
  if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

const S = {
  str: (description, extra) => ({ type: "string", description, ...extra }),
  int: (description) => ({ type: "integer", description }),
  num: (description) => ({ type: "number", description }),
  bool: (description) => ({ type: "boolean", description }),
  date: (description) => ({ type: "string", description: description + " (YYYY-MM-DD)" }),
  limit: { type: "integer", description: "Most rows to return" },
};
const COLL_ENUM = Object.keys(COLLECTIONS);
const SEARCH_COLLS = ["entries", "backlog", "notes", "financeEntries", "recurringExpenses", "habits", "accomplishments", "boards", "trips"];

// The day of the month it finished (0.281.0): the one given, or today's
// when the month is left to default too. Nothing reads it yet.
function finishDay(a, year, month, now) {
  if (a.day == null) return !a.year && !a.month ? now.getDate() : null;
  const day = +a.day;
  if (!(Number.isInteger(day) && day >= 1 && day <= new Date(year, month, 0).getDate())) fail(`day must be 1-${new Date(year, month, 0).getDate()} for that month.`);
  return day;
}

const TOOLS = [
  {
    name: "lifelog_overview",
    description: "Start here. Today's date, the home currency, how much is in each part of LifeLog, and the exact category, project and habit names other tools need.",
    readOnly: true,
    input: {},
    async run() {
      const d = await readData();
      const names = (k) => (d[k] || []).map((c) => c.name).join(", ") || "none";
      const behind = d.appVersion && Merge.compareVersions(d.appVersion, L.version) > 0;
      return [
        `Today is ${today()}. Home currency: ${currencyOf(d)}. Data from ${storeOf().where()}.`,
        `Timeline entries: ${(d.entries || []).length}. Backlog: ${(d.backlog || []).length}. Notes: ${(d.notes || []).length}. Expenses: ${(d.financeEntries || []).length}, plus ${bills(d).length} recurring bills. Habits: ${(d.habits || []).filter((h) => !h.archivedAt).length} active. Accomplishments: ${allAccomplishments(d).length}. Drawing boards: see lifelog_boards. Trips: see lifelog_trips.`,
        `Timeline and backlog categories: ${names("categories")}.`,
        `Expense categories: ${(d.financeCategories || []).map((c) => c.name + (c.subs && c.subs.length ? ` (subcategories: ${c.subs.map((x) => x.name).join(", ")})` : "")).join(", ") || "none"}.`,
        `Note categories: ${names("noteCategories")}.`,
        `Projects: ${names("projects")}.`,
        `Habits: ${(d.habits || []).filter((h) => !h.archivedAt).map((h) => h.name).join(", ") || "none"}.`,
        `Amounts are always in the home currency; an expense paid in another one also keeps currency, fxAmount and rate. Spending totals include recurring bills. Lists show ids in brackets; use them to edit.`,
        behind ? `Warning: this data was last written by LifeLog ${d.appVersion}, newer than this bridge (${L.version}). Update the LifeLog code the bridge runs from (git pull) before editing.` : "",
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "lifelog_guide",
    description: "How LifeLog's data is shaped: every collection, every field and what it means. Read before editing with lifelog_update_item, or when unsure what a field holds.",
    readOnly: true,
    input: { section: S.str("Only this part, e.g. 'expenses', 'habits', 'notes'") },
    async run(a) {
      const doc = fs.readFileSync(path.join(__dirname, "DATA.md"), "utf8");
      if (!a.section) return doc;
      const parts = doc.split(/\n(?=## )/);
      const hit = parts.filter((p) => lower(p.split("\n")[0]).includes(lower(a.section)));
      return hit.length ? hit.join("\n") : "No section like that. Sections: " + parts.map((p) => p.split("\n")[0].replace(/^#+ /, "")).join(", ");
    },
  },
  {
    name: "lifelog_search",
    description: "Find anything by text across the timeline, backlog, notes, expenses, recurring bills, habits, accomplishments, drawing boards and trips. An item matches when every word of the query appears somewhere in it, in any order. Narrow it with collection, category and subcategory. Returns what each hit is, its category and its id. To list or review everything in a category or subcategory, don't run repeated searches: use lifelog_expenses (category and subcategory filters), lifelog_spending with group_by subcategory, lifelog_timeline, lifelog_backlog or lifelog_notes (category filter).",
    readOnly: true,
    input: {
      query: S.str("Words to look for; each must appear, in any order"),
      collection: S.str("Only this part", { enum: SEARCH_COLLS }),
      category: S.str("Only items in this category (timeline, backlog, note or expense category)"),
      subcategory: S.str("Only expenses and recurring bills in this subcategory"),
      limit: S.limit,
    },
    required: ["query"],
    async run(a) {
      const d = await readData();
      const words = lower(a.query).split(/\s+/).filter(Boolean);
      if (!words.length) fail("Give something to search for.");
      if (a.collection && !SEARCH_COLLS.includes(a.collection)) fail("collection must be one of: " + SEARCH_COLLS.join(", "));
      const cat = lower(a.category), sub = lower(a.subcategory);
      if (cat && ![...(d.categories || []), ...(d.financeCategories || []), ...(d.noteCategories || [])].some((c) => lower(c.name) === cat)) {
        fail(`No category named "${a.category}". Use one from lifelog_overview.`);
      }
      if (sub && !(d.financeCategories || []).some((c) => (!cat || lower(c.name) === cat) && (c.subs || []).some((x) => lower(x.name) === sub))) {
        fail(`No expense subcategory named "${a.subcategory}"${cat ? " in " + a.category : ""}. lifelog_overview lists them.`);
      }
      const want = (coll) => !a.collection || a.collection === coll;
      const fits = (x) => (!cat || lower(x.category) === cat) && (!sub || lower(x.subcategory) === sub);
      const hit = (text) => { const t = lower(text); return words.every((w) => t.includes(w)); };
      const hits = [];
      const look = (coll, x, text, line) => { if (want(coll) && fits(x) && hit(text)) hits.push(`- ${COLLECTIONS[coll].label}: ${line} (${x.id})`); };
      for (const e of d.entries || []) look("entries", e, [e.title, e.author, e.notes, e.category].join(" "), `${e.date} [${e.category}] ${e.title}`);
      for (const b of d.backlog || []) look("backlog", b, [b.title, b.author, b.notes, b.summary, b.category].join(" "), `[${b.category}] ${b.title}`);
      for (const n of d.notes || []) look("notes", n, [n.title, n.text, n.author, n.source, n.category, ...(n.items || []).map((i) => i.text)].join(" "),
        `${n.category ? "[" + n.category + "] " : ""}${cut(n.title || n.text || (n.items || []).map((i) => i.text).join(", "), 80)}`);
      for (const f of d.financeEntries || []) look("financeEntries", f, [f.note, f.category, f.subcategory, f.project].join(" "),
        `${f.date} ${money(d, f.amount)} [${catLabel(f)}]${f.project ? " (" + f.project + ")" : ""} ${f.note || ""}`);
      for (const r of bills(d)) look("recurringExpenses", r, [r.note, r.category, r.subcategory].join(" "), `${money(d, r.amount)} ${r.interval} [${catLabel(r)}] ${r.note || ""}`);
      // Habits, accomplishments, boards and trips have no category, so a category filter leaves them out.
      const plain = (coll) => want(coll) && !cat && !sub;
      for (const h of plain("habits") ? d.habits || [] : []) if (hit(h.name)) hits.push(`- ${COLLECTIONS.habits.label}: ${h.name} (${h.id})`);
      for (const x of plain("accomplishments") ? allAccomplishments(d) : []) if (hit(x.text + " " + (x.notes || ""))) hits.push(`- accomplishment: ${x.year}: ${x.text} (${x.id})`);
      if (plain("boards")) try {
        for (const b of await readBoards()) if (hit([b.name, ...boardTexts(b)].join(" "))) hits.push(`- board: ${b.name} (${b.id})`);
      } catch (e) { /* boards are a second file; the rest still answers */ }
      if (plain("trips")) try {
        const tr = await readTravel();
        for (const t of tr.trips) if (hit(t.name)) hits.push(`- trip: ${t.name} (${t.id})`);
        for (const p of tr.places) if (hit([p.name, p.address, p.note].join(" "))) {
          const t = tr.trips.find((x) => x.id === p.trip);
          hits.push(`- place in ${t ? t.name : "a trip"}: ${p.name} (${p.id})`);
        }
      } catch (e) { /* so are trips */ }
      const lim = limitOf(a, 40);
      return [head(hits.length, Math.min(lim, hits.length), "matches"), ...hits.slice(0, lim)].join("\n");
    },
  },
  {
    name: "lifelog_get",
    description: "One item in full, as stored: every field, for reading exactly or before editing.",
    readOnly: true,
    input: { collection: S.str("Which list", { enum: COLL_ENUM }), item: S.str("Its id (or its title/name)") },
    required: ["collection", "item"],
    async run(a) {
      if (!COLLECTIONS[a.collection]) fail("collection must be one of: " + COLL_ENUM.join(", "));
      const d = await readData();
      return JSON.stringify(findItem(d, a.collection, a.item), null, 2);
    },
  },
  {
    name: "lifelog_timeline",
    description: "What was done or finished (games, books, shows, trips, events), month by month, newest first.",
    readOnly: true,
    input: {
      query: S.str("Text in the title, author or notes"), category: S.str("A timeline category"),
      from: S.str("First month, YYYY-MM"), to: S.str("Last month, YYYY-MM"),
      min_rating: S.int("Only rated at least this (1-5)"), limit: S.limit,
    },
    async run(a) {
      const d = await readData();
      const q = lower(a.query);
      const rows = (d.entries || []).filter((e) => (!q || lower(e.title + " " + (e.author || "") + " " + (e.notes || "")).includes(q))
        && (!a.category || lower(e.category) === lower(a.category))
        && (!a.from || String(e.date) >= a.from) && (!a.to || String(e.date).slice(0, 7) <= a.to)
        && (!a.min_rating || (+e.rating || 0) >= +a.min_rating))
        .sort((x, y) => String(y.date).localeCompare(String(x.date)));
      const lim = limitOf(a, 40);
      return [head(rows.length, Math.min(lim, rows.length), "entries"), ...rows.slice(0, lim).map((e) => {
        const span = e.startMonth ? ` (from ${e.startYear}-${String(e.startMonth).padStart(2, "0")})` : "";
        return `- ${e.date}${span} [${e.category}] ${e.title}${e.author ? " by " + e.author : ""}${e.rating ? " " + "★".repeat(e.rating) : ""}${e.notes ? " — " + cut(e.notes, 120) : ""}  (${e.id})`;
      })].join("\n");
    },
  },
  {
    name: "lifelog_backlog",
    description: "Things to play, read, watch or do next. Starred ones (priority) first. A show says how far it has run (airing, between seasons, finished) and how many episodes are out; status \"airing\" lists the ones still mid-run.",
    readOnly: true,
    input: {
      query: S.str("Text in the title, author or notes"), category: S.str("A backlog category"),
      status: S.str("Which ones", { enum: ["open", "starred", "started", "bought", "dropped", "airing", "all"] }),
      starred: S.bool("Only starred ones, on top of status (the Backlog's Show → Starred)"),
      bought: S.bool("true: only bought ones; false: only not bought (the Backlog's Show → Bought / Not bought). On top of status; a category with Bought switched off passes either way"),
      price_alert: S.bool("Only Steam games with a price alert set and not bought yet (the Backlog's Show → Price alert)"),
      sort: S.str("starred (default: starred first, then by title) or length (shortest first, as the Backlog's Length sort; unknown last)", { enum: ["starred", "length"] }),
      length: S.str("Only this length, judged in each title's own unit (the Pick sheet's chips): short is up to 5 hrs, 250 pages, 13 episodes or 50 chapters; long is 25 hrs, 500 pages, 40 episodes or 200 chapters and up; unknown lengths drop out", { enum: ["short", "medium", "long"] }),
      limit: S.limit,
    },
    async run(a) {
      const d = await readData();
      const q = lower(a.query);
      const status = a.status || "open";
      const byLength = (x, y) => {
        const lx = Backlog.lengthKey(x), ly = Backlog.lengthKey(y);
        if (!lx !== !ly) return lx ? -1 : 1;
        return (lx ? lx.unit - ly.unit || lx.n - ly.n : 0) || String(x.title).localeCompare(String(y.title));
      };
      const boughtOff = (name) => ((d.categories || []).find((c) => c.name === name) || {}).showBought === false;
      const rows = (d.backlog || []).filter((b) => (!q || lower(b.title + " " + (b.author || "") + " " + (b.notes || "")).includes(q))
        && (!a.category || lower(b.category) === lower(a.category))
        && (!a.starred || b.priority)
        && (a.bought == null || !!b.bought === a.bought || boughtOff(b.category))
        && (!a.price_alert || (b.priceAlert > 0 && b.mediaSource === "steam" && !b.bought))
        && (!a.length || Backlog.lengthBand(b) === a.length)
        && (status === "all" || (status === "open" ? !b.dropped : status === "starred" ? b.priority && !b.dropped
          : status === "started" ? b.startedAt : status === "bought" ? b.bought
          : status === "airing" ? (b.airing === "airing" || b.airing === "hiatus") && !b.dropped : b.dropped)))
        .sort(a.sort === "length" ? byLength : (x, y) => (y.priority || 0) - (x.priority || 0) || String(x.title).localeCompare(String(y.title)));
      const lim = limitOf(a, 40);
      return [head(rows.length, Math.min(lim, rows.length), status + " backlog items"), ...rows.slice(0, lim).map((b) => {
        const flags = [b.priority && "starred", b.startedAt && "started " + b.startedAt, b.progress && progressFlag(b), b.bought && "bought", b.dropped && "dropped",
          b.releaseDate && "out " + b.releaseDate, b.airing && airingFlag(b), (a.sort === "length" || a.length) && b.length].filter(Boolean);
        return `- [${b.category}] ${b.title}${b.author ? " by " + b.author : ""}${flags.length ? " (" + flags.join(", ") + ")" : ""}${b.notes ? " — " + cut(b.notes, 100) : ""}  (${b.id})`;
      })].join("\n");
    },
  },
  {
    name: "lifelog_pick",
    description: "Pick something from the backlog at random, as the Backlog's Pick sheet does: only titles you could start today (not dropped, not started, already out). Narrow it like the sheet's chips. Doesn't change anything; the app's own picks also avoid what it showed recently, which this doesn't know about.",
    readOnly: true,
    input: {
      category: S.str("Only this backlog category"),
      starred: S.bool("Only starred ones"),
      bought: S.bool("Only bought ones (a category with Bought switched off passes)"),
      length: S.str("short, medium or long, judged in each title's own unit (see lifelog_backlog)", { enum: ["short", "medium", "long"] }),
      count: S.int("How many different titles to pick (default 1, up to 10)"),
    },
    async run(a) {
      const d = await readData();
      const boughtOff = (name) => ((d.categories || []).find((c) => c.name === name) || {}).showBought === false;
      const pool = (d.backlog || []).filter((b) => !b.dropped && !b.startedAt && Backlog.releaseStateOf(b) !== "waiting"
        && (!a.category || lower(b.category) === lower(a.category))
        && (!a.starred || b.priority)
        && (!a.bought || b.bought || boughtOff(b.category))
        && (!a.length || Backlog.lengthBand(b) === a.length));
      if (!pool.length) return "Nothing in the backlog matches that.";
      const n = Math.max(1, Math.min(10, Math.floor(+a.count || 1)));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return [`Picked ${Math.min(n, pool.length)} of ${pool.length}:`, ...pool.slice(0, n).map((b) => {
        const flags = [b.priority && "starred", b.bought && "bought", b.length].filter(Boolean);
        return `- [${b.category}] ${b.title}${b.author ? " by " + b.author : ""}${flags.length ? " (" + flags.join(", ") + ")" : ""}  (${b.id})`;
      })].join("\n");
    },
  },
  {
    name: "lifelog_notes",
    description: "Notes, checklists and quotes, newest first. A checklist shows its items with their ids.",
    readOnly: true,
    input: {
      query: S.str("Text anywhere in the note"), category: S.str("A note category"),
      kind: S.str("Only this kind", { enum: ["text", "list", "quote"] }),
      full: S.bool("Whole text instead of the first 500 characters"), limit: S.limit,
    },
    async run(a) {
      const d = await readData();
      const q = lower(a.query);
      const rows = (d.notes || []).filter((n) => (!q || lower([n.title, n.text, n.author, n.source, ...(n.items || []).map((i) => i.text)].join(" ")).includes(q))
        && (!a.category || lower(n.category) === lower(a.category))
        && (!a.kind || (n.kind || "text") === a.kind))
        .sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
      const lim = limitOf(a, 20);
      return [head(rows.length, Math.min(lim, rows.length), "notes"), ...rows.slice(0, lim).map((n) => "- " + noteText(n, a.full ? 1e9 : 500))].join("\n");
    },
  },
  {
    name: "lifelog_expenses",
    description: "Individual expenses, newest first, including the charges recurring bills made. Each shows its id, or the plan it came from.",
    readOnly: true,
    input: {
      start_date: S.date("From"), end_date: S.date("To, default today"),
      category: S.str("An expense category"), subcategory: S.str("With category: only this subcategory of it; \"\" for the ones with none"),
      project: S.str("A project"), query: S.str("Text in the note"),
      include_recurring: S.bool("Include recurring charges (default true)"), limit: S.limit,
    },
    async run(a) {
      const d = await readData();
      const rows = expenseRows(d, a).sort((x, y) => String(y.date).localeCompare(String(x.date)));
      const lim = limitOf(a, 40);
      const total = rows.reduce((n, f) => n + (+f.amount || 0), 0);
      return [head(rows.length, Math.min(lim, rows.length), "expenses") + `, ${money(d, total)} in all`,
        ...rows.slice(0, lim).map((f) => expenseLine(d, f))].join("\n");
    },
  },
  {
    name: "lifelog_spending",
    description: "How much was spent, in total and grouped by category, subcategory, month, year or project. Includes recurring bills (rent, subscriptions) as the Ledger does. A category's total includes all its subcategories. Use for any 'how much did I spend' question.",
    readOnly: true,
    input: {
      start_date: S.date("From"), end_date: S.date("To, default today"),
      category: S.str("Only this category"), subcategory: S.str("With category: only this subcategory of it; \"\" for the ones with none"),
      project: S.str("Only this project"), query: S.str("Text in the note"),
      group_by: S.str("Grouping; subcategory splits each category into its subcategories", { enum: ["category", "subcategory", "month", "year", "project", "none"] }),
      include_recurring: S.bool("Include recurring charges (default true)"),
    },
    async run(a) {
      const d = await readData();
      const rows = expenseRows(d, a);
      const by = a.group_by || "category";
      const keyOf = (f) => by === "month" ? String(f.date).slice(0, 7) : by === "year" ? String(f.date).slice(0, 4)
        : by === "project" ? f.project || "(no project)"
        : by === "subcategory" ? `${f.category || "Other"} › ${f.subcategory || "(no subcategory)"}` : f.category || "Other";
      const groups = new Map();
      let total = 0, recurring = 0;
      for (const f of rows) {
        const n = +f.amount || 0;
        total += n;
        if (f.kind === "recurring") recurring += n;
        if (by !== "none") groups.set(keyOf(f), (groups.get(keyOf(f)) || 0) + n);
      }
      const order = [...groups].sort(by === "month" || by === "year" ? (x, y) => x[0].localeCompare(y[0]) : (x, y) => y[1] - x[1]);
      const upcoming = rows.filter((f) => f.date > today()).length;
      return [
        `${money(d, total)} over ${rows.length} expenses, ${a.start_date || "the start"} to ${a.end_date || today()}`
          + (a.include_recurring === false ? " (recurring bills left out)." : `, of which ${money(d, recurring)} is recurring bills.`),
        upcoming ? `${upcoming} of these are still to come (after today).` : "",
        ...order.map(([k, v]) => `- ${k}: ${money(d, v)}`),
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "lifelog_recurring",
    description: "Recurring bills (rent, subscriptions...): amount, how often, next charge, and what each costs per month.",
    readOnly: true,
    input: { include_ended: S.bool("Include bills that have ended") },
    async run(a) {
      const d = await readData();
      const t = today();
      const rows = bills(d).filter((r) => a.include_ended || !r.endDate || r.endDate >= t);
      let monthly = 0;
      const lines = rows.map((r) => {
        const next = nextCharge(r);
        const live = !r.endDate || r.endDate >= t;
        if (live) monthly += (+r.amount || 0) * (PER_MONTH[r.interval] || 1);
        const fx = r.currency ? ` (${r.fxAmount} ${r.currency})` : "";
        return `- ${r.note || catLabel(r)}: ${money(d, r.amount)}${fx} ${r.interval} [${catLabel(r)}]`
          + (r.project ? ` · ${r.project}` : "") + (next ? `, next ${next.date}` : "") + (r.endDate ? `, ends ${r.endDate}` : "")
          + (Finance.isPausedOn(r, t) ? ", paused now" : "") + `  (${r.id})`;
      });
      return [`${rows.length} bills, about ${money(d, monthly)} a month.`, ...lines].join("\n");
    },
  },
  {
    name: "lifelog_habits",
    description: "Habits: whether each is done today, its streak and best streak, and the last 14 days (✓ kept, ✗ missed, · not due).",
    readOnly: true,
    input: { include_archived: S.bool("Include archived habits") },
    async run(a) {
      const d = await readData();
      const t = today();
      const rows = (d.habits || []).filter((h) => a.include_archived || !h.archivedAt).sort((x, y) => (x.order || 0) - (y.order || 0));
      return [`${rows.length} habits, today ${t}.`, ...rows.map((h) => habitLine(h, t))].join("\n");
    },
  },

  {
    name: "lifelog_accomplishments",
    description: "The year's highlights from the timeline (accomplishments), by year, newest year first.",
    readOnly: true,
    input: { year: S.int("Only this year"), query: S.str("Text in the accomplishment or its notes") },
    async run(a) {
      const d = await readData();
      const q = lower(a.query);
      const rows = allAccomplishments(d).filter((x) => (!a.year || +x.year === +a.year) && (!q || lower(x.text + " " + (x.notes || "")).includes(q)))
        .sort((x, y) => y.year.localeCompare(x.year) || String(x.createdAt || "").localeCompare(String(y.createdAt || "")));
      return [`${rows.length} accomplishments`, ...rows.map((x) => `- ${x.year}: ${x.text}${x.notes ? " — " + cut(x.notes, 200) : ""}  (${x.id})`)].join("\n");
    },
  },
  {
    name: "lifelog_boards",
    description: "The drawing boards (Notes → Boards): name, category, and the text written on each. Give board for one board's text in full. Drawings themselves aren't described.",
    readOnly: true,
    input: { board: S.str("One board's id or name"), query: S.str("Text in a board's name or its written text"), category: S.str("A note category"), limit: S.limit },
    async run(a) {
      const list = await readBoards();
      if (a.board) {
        const b = findBoard(list, a.board);
        const texts = boardTexts(b);
        return [`${b.name}${b.category ? " [" + b.category + "]" : ""}${b.fav ? " ★" : ""} (${b.id}), ${b.elements.length} elements, last changed ${String(b.updatedAt).slice(0, 10)}.`,
          texts.length ? "Text on it:\n" + texts.map((t) => "- " + t).join("\n") : "No text on it."].join("\n");
      }
      const q = lower(a.query);
      const rows = list.filter((b) => (!q || lower([b.name, ...boardTexts(b)].join(" ")).includes(q)) && (!a.category || lower(b.category) === lower(a.category)))
        .sort((x, y) => (y.fav ? 1 : 0) - (x.fav ? 1 : 0) || String(y.updatedAt).localeCompare(String(x.updatedAt)));
      const lim = limitOf(a, 40);
      return [head(rows.length, Math.min(lim, rows.length), "boards"), ...rows.slice(0, lim).map((b) => {
        const texts = boardTexts(b);
        return `- ${b.name}${b.category ? " [" + b.category + "]" : ""}${b.fav ? " ★" : ""}: ${b.elements.length} elements, changed ${String(b.updatedAt).slice(0, 10)}`
          + (texts.length ? `; text: ${cut(texts.join(" / "), 160)}` : "") + `  (${b.id})`;
      })].join("\n");
    },
  },

  {
    name: "lifelog_trips",
    description: "Trips (the Travel tab): each trip's dates and places. Give trip for its plan day by day: scheduled places by time, then the day's other places, then the places with no day yet.",
    readOnly: true,
    input: { trip: S.str("One trip's id or name") },
    async run(a) {
      const doc = await readTravel();
      if (!a.trip) {
        if (!doc.trips.length) return "No trips yet.";
        const t0 = today();
        return [`${doc.trips.length} trip${doc.trips.length === 1 ? "" : "s"}`, ...Travel.sortTrips(doc.trips, t0).map((t) => {
          const n = doc.places.filter((p) => p.trip === t.id).length;
          return `- ${t.name}: ${Travel.rangeLabel(t.start, t.end) || "no dates"}, ${n} place${n === 1 ? "" : "s"} [${Travel.tripStatus(t, t0)}]  (${t.id})`;
        })].join("\n");
      }
      const t = findTrip(doc.trips, a.trip);
      const places = doc.places.filter((p) => p.trip === t.id);
      const out = [`${t.name}: ${Travel.rangeLabel(t.start, t.end) || "no dates"}, ${places.length} places  (${t.id})`];
      for (const day of Travel.tripDays(t, places)) {
        const list = Travel.sortDay(places.filter((p) => p.day === day));
        out.push(`${Travel.dayLabel(day)} (${day})${list.length ? "" : ": nothing planned"}`, ...list.map(placeLine));
      }
      const loose = Travel.sortDay(places.filter((p) => !p.day));
      if (loose.length) out.push("No day yet", ...loose.map(placeLine));
      return out.join("\n");
    },
  },

  {
    name: "lifelog_stats",
    description: "The Timeline's Stats in numbers. With year: that year in numbers (what was logged, by category and month, ratings, from the backlog, notes, ticked checklist items, habits kept, accomplishments, spending with recurring bills) against the year before. Without: every year's count by category, the most repeated titles and the top genres.",
    readOnly: true,
    input: { year: S.int("One year, e.g. 2026"), category: S.str("Only this timeline category") },
    async run(a) {
      const d = await readData();
      const cat = a.category ? nameIn(d, "categories", a.category, "timeline category") : null;
      const inCat = (e) => !cat || e.category === cat;
      const counted = (list, keyOf) => {
        const m = new Map();
        for (const x of list) { const k = keyOf(x); if (k != null && k !== "") m.set(k, (m.get(k) || 0) + 1); }
        return [...m.entries()].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])));
      };
      const ratingLine = (list) => {
        const rated = list.filter((e) => +e.rating > 0);
        return rated.length ? `Rated ${rated.length}, average ${(rated.reduce((s, e) => s + +e.rating, 0) / rated.length).toFixed(1)} stars.` : "None rated.";
      };
      const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      if (a.year != null) {
        const year = +a.year;
        if (!/^\d{4}$/.test(String(a.year))) fail("year is four digits, like 2026.");
        const g = Recap.gather(d, year);
        const entries = g.entries.filter(inCat), prev = g.prevEntries.filter(inCat);
        const out = [`${year}${cat ? " in " + cat : ""}: ${entries.length} logged (${prev.length} in ${year - 1}), ${new Set(entries.map((e) => lower(e.title))).size} different.`];
        if (entries.length) {
          if (!cat) out.push("By category: " + counted(entries, (e) => e.category).map(([k, n]) => `${k} ${n}`).join(", ") + ".");
          out.push("By month: " + counted(entries, (e) => +e.month).sort((x, y) => x[0] - y[0]).map(([m, n]) => `${MONTHS[m]} ${n}`).join(", ") + ".");
          out.push(ratingLine(entries));
          const best = entries.filter((e) => +e.rating === 5).map((e) => e.title);
          if (best.length) out.push(`Five stars: ${best.slice(0, 15).join(", ")}${best.length > 15 ? ` and ${best.length - 15} more` : ""}.`);
          out.push(`From the backlog: ${entries.filter((e) => e.backlogAddedAt).length}.`);
        }
        if (!cat) {
          const until = untilDate(year + "-12-31");
          const spent = effectiveExpenses(d, until).filter((f) => String(f.date).slice(0, 4) === String(year) && f.date <= today());
          const prevSpent = effectiveExpenses(d, until).filter((f) => String(f.date).slice(0, 4) === String(year - 1));
          const sum = (l) => l.reduce((s, f) => s + (+f.amount || 0), 0);
          out.push(`Notes written: ${g.notes.length} (${g.prevNotes.length} in ${year - 1}). Checklist items ticked: ${g.todosDone.length}. Added to the backlog: ${g.backlogAdded.length}. Accomplishments: ${g.achievements.length}.`);
          if (g.habits.length) out.push("Habits kept: " + g.habits.map((h) => `${h.habit.name} ${h.kept} of ${h.due} days (${Math.round(h.rate * 100)}%)`).join(", ") + ".");
          out.push(`Spent: ${money(d, sum(spent))} (${money(d, sum(prevSpent))} in ${year - 1}), recurring bills included${year === new Date().getFullYear() ? ", so far" : ""}.`);
        }
        return out.join("\n");
      }
      const all = (d.entries || []).filter(inCat);
      if (!all.length) return "Nothing on the timeline" + (cat ? " in " + cat : "") + " yet.";
      const out = [`${all.length} on the timeline${cat ? " in " + cat : ""}. ${ratingLine(all)} From the backlog: ${all.filter((e) => e.backlogAddedAt).length}.`, "", "By year:"];
      for (const [y, n] of counted(all, (e) => e.year).sort((x, z) => z[0] - x[0])) {
        const mine = all.filter((e) => e.year === y);
        out.push(`- ${y}: ${n}` + (cat ? "" : " (" + counted(mine, (e) => e.category).map(([k, c]) => `${k} ${c}`).join(", ") + ")"));
      }
      const repeated = counted(all, (e) => e.title.trim()).filter(([, n]) => n > 1).slice(0, 10);
      if (repeated.length) out.push("", "Most repeated: " + repeated.map(([t, n]) => `${t} ×${n}`).join(", ") + ".");
      const genres = counted(all.flatMap((e) => (e.genres || []).map((x) => ({ x }))), (o) => o.x).slice(0, 10);
      if (genres.length) out.push("Top genres: " + genres.map(([k, n]) => `${k} ${n}`).join(", ") + ".");
      return out.join("\n");
    },
  },
  {
    name: "lifelog_habit_insights",
    description: "What a habit's grid shows, in words: the kept rate since it started, the longest run and its dates, the best and weakest weekday, and the last six months. Leave habit out for every active habit.",
    readOnly: true,
    input: { habit: S.str("Its id or name") },
    async run(a) {
      const d = await readData();
      const t = today();
      const list = a.habit ? [findItem(d, "habits", a.habit)] : (d.habits || []).filter((h) => !h.archivedAt);
      if (!list.length) return "No habits yet.";
      return list.map((h) => {
        const life = Habits.statsFor(h, h.startedAt || t, t);
        if (!life.due) return `${h.name}: nothing to say yet; it starts counting from ${h.startedAt}.`;
        const lines = [`${h.name}${h.avoid ? " (avoiding)" : ""}: kept ${Math.round(life.rate * 100)}%, ${life.done} of ${life.due} days since ${h.startedAt}.`];
        const best = Habits.bestRunOf(h, t);
        if (best.days) lines.push(`  Longest run: ${best.days} day${best.days === 1 ? "" : "s"}, ${best.from} to ${best.to}. Current streak ${Habits.streakOf(h, t)}.`);
        const days = Habits.weekdayRates(h, t).filter((x) => x.due);
        if (days.length > 1) lines.push("  By weekday: " + days.map((x) => `${x.label} ${Math.round(x.rate * 100)}%`).join(", ") + ".");
        const months = Habits.monthRates(h, t).filter((m) => m.due);
        if (months.length) lines.push("  Last months: " + months.map((m) => `${m.month} ${Math.round(m.rate * 100)}% (${m.kept}/${m.due})`).join(", ") + ".");
        return lines.join("\n");
      }).join("\n");
    },
  },
  {
    name: "lifelog_upcoming",
    description: "What's coming out from the backlog, as the Upcoming page lists it: releases and next episodes by date, then the ones with only a rough date (a month, a quarter, a year, TBA).",
    readOnly: true,
    input: {
      days: S.int("How far ahead the dated list goes, default 90"), category: S.str("A timeline category"),
      include_undated: S.bool("Also list the ones without an exact date (default true)"),
    },
    async run(a) {
      const d = await readData();
      const t = today();
      const until = Finance.addDaysStr(t, Math.max(1, Math.min(3650, parseInt(a.days, 10) || 90)));
      const cat = a.category ? nameIn(d, "categories", a.category, "timeline category") : null;
      const waiting = (d.backlog || []).filter((b) => (!cat || b.category === cat) && Backlog.isAwaitingRelease(b));
      const line = (b) => `- ${Backlog.releaseLabel(b)}: ${b.title} [${b.category}]${b.priority ? " ★" : ""}  (${b.id})`;
      const dated = waiting.map((b) => ({ b, at: Backlog.upcomingAt(b) })).filter((x) => x.at && x.at <= until).sort((x, y) => x.at.localeCompare(y.at));
      const shown = new Set(dated.map((x) => x.b));
      const out = [`${dated.length} coming by ${until}${cat ? " in " + cat : ""}:`, ...dated.map((x) => line(x.b).replace(/^- /, `- ${x.at} · `))];
      if (a.include_undated !== false) {
        const rest = waiting.filter((b) => !shown.has(b));
        if (rest.length) out.push("", `${rest.length} later or without an exact date:`, ...rest.map(line));
      }
      return out.join("\n");
    },
  },
  // ---------- writes ----------
  {
    name: "lifelog_add_expense",
    description: "Log an expense. Amount is what was paid; for another currency give currency and rate (home currency per 1 unit) and it is converted the way the app does.",
    input: {
      amount: S.num("What was paid"), category: S.str("An expense category from lifelog_overview"),
      subcategory: S.str("One of that category's subcategories, optional; without it the expense is the category alone"),
      date: S.date("When, default today"), note: S.str("What or where"), project: S.str("A project, optional"),
      currency: S.str("Three-letter code if not the home currency"), rate: S.num("Home currency per 1 unit of `currency`"),
    },
    required: ["amount", "category"],
    async run(a) {
      const paid = +a.amount;
      if (!(paid > 0)) fail("amount must be more than 0.");
      const date = requireDate(a.date, "date") || today();
      return change(`expense ${paid} ${a.category}`, (d) => {
        const code = String(a.currency || "").toUpperCase();
        const foreign = code && code !== currencyOf(d);
        if (foreign && !(+a.rate > 0)) fail(`Give a rate for ${code}: how many ${currencyOf(d)} one ${code} is.`);
        const item = { date, amount: foreign ? Math.round(paid * a.rate * 100) / 100 : paid, category: a.category };
        if (a.subcategory) item.subcategory = a.subcategory;
        if (a.note) item.note = String(a.note).trim();
        if (a.project) item.project = a.project;
        if (foreign) Object.assign(item, { currency: code, fxAmount: paid, rate: +a.rate });
        const f = addItem(d, "financeEntries", item);
        return { text: `Logged ${money(d, f.amount)}${foreign ? ` (${paid} ${code})` : ""} for ${catLabel(f)} on ${date}. id ${f.id}`, touched: [["financeEntries", f.id]] };
      });
    },
  },
  {
    name: "lifelog_add_timeline_entry",
    description: "Add something done or finished to the timeline, filed under a month.",
    input: {
      title: S.str("What"), category: S.str("A timeline category from lifelog_overview"),
      year: S.int("Default this year"), month: S.int("1-12, default this month"), day: S.int("Day of the month, optional"),
      rating: S.int("1-5 stars, optional"), notes: S.str("Optional"), author: S.str("Optional, a book's author"),
    },
    required: ["title", "category"],
    async run(a) {
      const now = new Date();
      const year = +a.year || now.getFullYear(), month = +a.month || now.getMonth() + 1;
      if (month < 1 || month > 12) fail("month must be 1-12.");
      if (a.rating != null && !(a.rating >= 1 && a.rating <= 5)) fail("rating is 1-5 stars.");
      const day = finishDay(a, year, month, now);
      return change(`timeline "${a.title}"`, (d) => {
        const item = { title: String(a.title).trim(), category: a.category, year, month, date: `${year}-${String(month).padStart(2, "0")}` };
        if (day) item.day = day;
        if (a.rating) item.rating = Math.round(a.rating);
        if (a.notes) item.notes = String(a.notes).trim();
        Object.assign(item, authored(a));
        const e = addItem(d, "entries", item);
        return { text: `Added "${e.title}" to the timeline (${e.category}, ${e.date}). id ${e.id}`, touched: [["entries", e.id]] };
      });
    },
  },
  {
    name: "lifelog_add_backlog_item",
    description: "Add something to the backlog: a game, book, show or anything to do later.",
    input: {
      title: S.str("What"), category: S.str("A backlog category from lifelog_overview"),
      notes: S.str("Optional"), starred: S.bool("Star it (priority)"), author: S.str("Optional, a book's author"),
      price_alert: S.num("Optional, for a Steam game: a US-dollar price; the app says when GG.deals' retail price is at or under it"),
    },
    required: ["title", "category"],
    async run(a) {
      return change(`backlog "${a.title}"`, (d) => {
        const item = { title: String(a.title).trim(), category: a.category };
        if (a.notes) item.notes = String(a.notes).trim();
        if (a.starred) item.priority = 1;
        if (+a.price_alert > 0) item.priceAlert = +a.price_alert;
        Object.assign(item, authored(a));
        const b = addItem(d, "backlog", item);
        return { text: `Added "${b.title}" to the backlog (${b.category}). id ${b.id}`, touched: [["backlog", b.id]] };
      });
    },
  },
  {
    name: "lifelog_finish_backlog_item",
    description: "Mark a backlog item finished: it moves to the timeline, as the app's Done does.",
    input: {
      item: S.str("Its id or title"), year: S.int("Default this year"), month: S.int("Default this month"), day: S.int("Day of the month, optional"),
      rating: S.int("1-5 stars, optional"), notes: S.str("Optional; the item's own notes are kept otherwise"),
    },
    required: ["item"],
    async run(a) {
      const now = new Date();
      const year = +a.year || now.getFullYear(), month = +a.month || now.getMonth() + 1;
      if (a.rating != null && !(a.rating >= 1 && a.rating <= 5)) fail("rating is 1-5 stars.");
      const day = finishDay(a, year, month, now);
      return change(`finished "${a.item}"`, (d) => {
        const b = findItem(d, "backlog", a.item);
        const item = { title: b.title, category: b.category, year, month, date: `${year}-${String(month).padStart(2, "0")}`, backlogAddedAt: b.createdAt };
        if (day) item.day = day;
        for (const k of ["coverUrl", "mediaId", "mediaSource", "length", "genres", "startedAt", "author", "hltb", "reviews", "externalRating"]) if (b[k]) item[k] = b[k];
        if (b.overrides && b.overrides.author) item.overrides = { author: true };
        if (a.rating) item.rating = Math.round(a.rating);
        if (a.notes) item.notes = String(a.notes).trim();
        else if (b.notes) item.notes = b.notes;
        const e = addItem(d, "entries", item);
        d.backlog = d.backlog.filter((x) => x.id !== b.id);
        return { text: `Moved "${b.title}" from the backlog to the timeline (${e.date}). id ${e.id}`, touched: [["entries", e.id], ["backlog", b.id]] };
      });
    },
  },
  {
    name: "lifelog_set_progress",
    description: "Set how far into a backlog item you are: episodes watched (chapters read for a manga), as the + on an In progress row does. Give count, or add to move it on (add 1 = watched one more). For an AniList title the app sends it to AniList at its next sync.",
    input: {
      item: S.str("Its id or title"), count: S.int("The new count, 0 or more"), add: S.int("Or: how many to add (negative takes some off)"),
    },
    required: ["item"],
    async run(a) {
      if (a.count == null && a.add == null) fail("Give count or add.");
      if (a.count != null && a.add != null) fail("Give count or add, not both.");
      return change(`progress "${a.item}"`, (d) => {
        const b = findItem(d, "backlog", a.item);
        const n = Math.max(0, Math.round(a.count != null ? +a.count : (+b.progress || 0) + (+a.add || 0)));
        if (!Number.isFinite(n)) fail("count is a whole number.");
        const next = { ...structuredClone(b), progressAt: new Date().toISOString() };
        if (n) next.progress = n; else delete next.progress;
        replaceItem(d, "backlog", cleanItem(d, "backlog", next, n ? { progress: n } : {}));
        return { text: `"${b.title}" is at ${progressFlag({ ...b, progress: n })}${b.startedAt ? "" : " (it isn't started; the count shows once it's in progress)"}. id ${b.id}`, touched: [["backlog", b.id]] };
      });
    },
  },
  {
    name: "lifelog_add_note",
    description: "Save a note. With list_items it's a checklist; with kind 'quote' a quote (author and source optional).",
    input: {
      text: S.str("The note's text (Markdown)"), title: S.str("Optional, text notes only"),
      category: S.str("A note category, optional"), kind: S.str("Kind", { enum: ["text", "list", "quote"] }),
      list_items: { type: "array", items: { type: "string" }, description: "Checklist items" },
      author: S.str("For a quote"), source: S.str("For a quote"),
    },
    async run(a) {
      const items = (a.list_items || []).map((s) => String(s).trim()).filter(Boolean);
      const kind = items.length ? "list" : a.kind === "quote" ? "quote" : a.kind === "list" ? "list" : "";
      if (!kind && !String(a.text || "").trim()) fail("A note needs text (or list_items for a checklist).");
      return change("note" + (a.title ? ` "${a.title}"` : ""), (d) => {
        const item = { text: String(a.text || "").trim() };
        if (kind) item.kind = kind;
        if (kind === "list") item.items = items.map((text) => ({ id: L.uid(), text }));
        if (a.title && !kind) item.title = String(a.title).trim();
        if (a.category) item.category = a.category;
        if (kind === "quote") { if (a.author) item.author = a.author; if (a.source) item.source = a.source; }
        const n = addItem(d, "notes", item);
        // Newest first, the way the app adds them.
        d.notes = [n, ...d.notes.filter((x) => x !== n)];
        return { text: `Saved the ${kind || "note"}${a.title ? ` "${a.title}"` : ""}. id ${n.id}`, touched: [["notes", n.id]] };
      });
    },
  },
  {
    name: "lifelog_note_images",
    description: "The images in a note, and the pictures themselves (up to 4, as images you can look at). In a note's text an image is a line of its own: ![alt](lifelog-img:<id>) is a picture LifeLog keeps; ![[name.png]] or a relative path is one an import couldn't find; a web address is only a link and isn't fetched.",
    readOnly: true,
    input: { note: S.str("The note's id or title"), pictures: S.bool("Send the pictures too (default true)") },
    required: ["note"],
    async run(a) {
      const d = await readData();
      const n = findItem(d, "notes", a.note);
      const refs = noteImageRefs(n.text);
      if (!refs.length) return `"${cut(n.title || n.text, 40)}" has no images. id ${n.id}`;
      const lines = refs.map((r, i) => `${i + 1}. ${r.id ? "kept" : r.web ? "web link, not fetched" : "not brought in"}: ${r.id || r.src}${r.alt ? ` — "${r.alt}"` : ""}`);
      const images = [];
      if (a.pictures !== false) {
        const st = storeOf();
        for (const r of refs.filter((x) => x.id).slice(0, 4)) {
          const bytes = st.images ? await st.images.get(r.id) : null;
          if (!bytes) { lines.push(`(${r.id} isn't uploaded yet: the device that added it hasn't saved since.)`); continue; }
          images.push({ data: bytes.toString("base64"), mimeType: imageType(bytes) || "image/jpeg" });
        }
      }
      return { text: `"${cut(n.title || n.text, 40)}" (id ${n.id}) has ${refs.length} image${refs.length === 1 ? "" : "s"}:\n` + lines.join("\n"), images };
    },
  },
  {
    name: "lifelog_add_note_image",
    description: "Add a picture to a note, as its own line at the end of the text (or after the line that contains `after`). Give a local file path or base64 data. JPEG, PNG, GIF or WebP up to 5 MB; it's kept as given, so shrink a big photo first. The picture is uploaded beside the data, then the note points at it.",
    input: {
      note: S.str("The note's id or title"),
      file: S.str("Path to the picture on this machine"),
      data: S.str("The picture as base64, instead of a file"),
      alt: S.str("What it shows, optional"),
      after: S.str("Put it after the first line containing this text, optional"),
    },
    required: ["note"],
    async run(a) {
      let bytes;
      if (a.file) {
        try { bytes = fs.readFileSync(String(a.file)); } catch (e) { fail(`Couldn't read ${a.file}: ${e.message}`); }
      } else if (a.data) bytes = Buffer.from(String(a.data).replace(/^data:[^,]*,/, ""), "base64");
      else fail("Give the picture as file or data.");
      const type = imageType(bytes);
      if (!type) fail("That isn't a JPEG, PNG, GIF or WebP picture.");
      if (bytes.length > 5 * 1024 * 1024) fail(`That picture is ${(bytes.length / 1048576).toFixed(1)} MB; the most is 5 MB. Shrink it first.`);
      const d0 = await readData();
      const target = findItem(d0, "notes", a.note);
      if (target.kind) fail("Only a plain note can show images, not a checklist or a quote.");
      const id = require("crypto").randomBytes(8).toString("hex") + "." + { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" }[type];
      const st = storeOf();
      if (!st.images) fail("This copy of LifeLog can't keep pictures.");
      await st.images.put([{ id, bytes }]);
      const line = "![" + String(a.alt || "").replace(/[\[\]\n]/g, " ").trim() + "](lifelog-img:" + id + ")";
      return change(`image in note "${cut(target.title || target.text, 30)}"`, (d) => {
        const n = findItem(d, "notes", target.id);
        const lines = String(n.text || "").split("\n");
        const at = a.after ? lines.findIndex((l) => lower(l).includes(lower(a.after))) : -1;
        if (a.after && at < 0) fail(`No line in the note contains "${a.after}".`);
        if (at >= 0) lines.splice(at + 1, 0, line); else lines.push(line);
        replaceItem(d, "notes", cleanItem(d, "notes", { ...n, text: lines.join("\n").replace(/^\n+/, "") }));
        return { text: `Added the picture to "${cut(n.title || n.text, 40)}" as ${id}.`, touched: [["notes", n.id]] };
      });
    },
  },
  {
    name: "lifelog_update_list",
    description: "Change a checklist: add items, tick or untick items (by id or text), or remove items.",
    input: {
      note: S.str("The checklist's id or title"),
      add: { type: "array", items: { type: "string" }, description: "New items" },
      check: { type: "array", items: { type: "string" }, description: "Items to tick" },
      uncheck: { type: "array", items: { type: "string" }, description: "Items to untick" },
      remove: { type: "array", items: { type: "string" }, description: "Items to delete" },
    },
    required: ["note"],
    async run(a) {
      return change(`checklist "${a.note}"`, (d) => {
        const n = findItem(d, "notes", a.note);
        if (n.kind !== "list") fail(`"${cut(n.title || n.text, 40)}" isn't a checklist.`);
        const items = (n.items || []).map((i) => ({ ...i }));
        const pick = (ref) => {
          const r = lower(ref);
          const hit = items.find((i) => i.id === ref) || items.find((i) => lower(i.text) === r)
            || (items.filter((i) => lower(i.text).includes(r)).length === 1 ? items.find((i) => lower(i.text).includes(r)) : null);
          return hit || fail(`No single item matches "${ref}" in that checklist.`);
        };
        const now = nowIso();
        for (const ref of a.check || []) { const i = pick(ref); i.done = true; i.doneAt = i.doneAt || now; }
        for (const ref of a.uncheck || []) { const i = pick(ref); delete i.done; delete i.doneAt; }
        const gone = new Set((a.remove || []).map((ref) => pick(ref).id));
        const kept = items.filter((i) => !gone.has(i.id));
        for (const text of (a.add || []).map((s) => String(s).trim()).filter(Boolean)) kept.push({ id: L.uid(), text });
        replaceItem(d, "notes", cleanItem(d, "notes", { ...n, items: kept }));
        const open = kept.filter((i) => !i.done).length;
        return { text: `Updated the checklist: ${kept.length} items, ${open} open.`, touched: [["notes", n.id]] };
      });
    },
  },
  {
    name: "lifelog_mark_habit",
    description: "Record a habit for a day: done (or one more toward its target), a set count, or cleared. For a habit you avoid, the count is the slips.",
    input: {
      habit: S.str("Its id or name"), date: S.date("Default today"),
      value: S.int("The day's count; omit to add one (or mark done), 0 to clear"),
    },
    required: ["habit"],
    async run(a) {
      const date = requireDate(a.date, "date") || today();
      if (date > today()) fail("That day hasn't happened yet.");
      return change(`habit "${a.habit}" ${date}`, (d) => {
        const h = findItem(d, "habits", a.habit);
        const was = Habits.markOf(h, date);
        const value = a.value != null ? Math.max(0, Math.round(+a.value) || 0)
          : h.avoid ? was + 1 : Math.min(was + 1, h.target || 1);
        const marks = { ...(h.marks || {}) };
        if (value) marks[date] = value; else delete marks[date];
        const next = cleanItem(d, "habits", { ...h, marks });
        replaceItem(d, "habits", next);
        const state = Habits.isDone(next, date) ? (h.avoid ? "still kept" : "done") : (h.avoid ? "over the limit" : `${value} of ${h.target || 1}`);
        return { text: `${h.name} on ${date}: ${value} (${state}). Streak now ${Habits.streakOf(next, today())}.`, touched: [["habits", h.id]] };
      });
    },
  },
  {
    name: "lifelog_update_item",
    description: "Change fields on any item (expense, timeline entry, backlog item, note, habit, recurring bill, project). Check lifelog_guide for the fields; LifeLog's own rules clean the result, and anything it won't keep is refused.",
    input: {
      collection: S.str("Which list", { enum: COLL_ENUM }), item: S.str("Its id (or title/name)"),
      set: { type: "object", description: "Fields to set, e.g. {\"amount\": 42, \"note\": \"Lunch\"}" },
      unset: { type: "array", items: { type: "string" }, description: "Optional fields to remove" },
    },
    required: ["collection", "item"],
    async run(a) {
      const spec = COLLECTIONS[a.collection] || fail("collection must be one of: " + COLL_ENUM.join(", "));
      const set = a.set || {};
      for (const k of ["id", "createdAt", "updatedAt"]) if (k in set || (a.unset || []).includes(k)) fail(`${k} is LifeLog's to manage.`);
      if (!Object.keys(set).length && !(a.unset || []).length) fail("Nothing to change: give set and/or unset.");
      return change(`edit ${spec.label} "${a.item}"`, (d) => {
        const old = findItem(d, a.collection, a.item);
        const next = { ...structuredClone(old), ...set };
        for (const k of a.unset || []) delete next[k];
        // Moved to another category, an expense leaves its old one's
        // subcategory behind, as in the app.
        if (spec.cats === "financeCategories" && set.category != null && !("subcategory" in set) && lower(set.category) !== lower(old.category)) delete next.subcategory;
        if (a.collection === "entries" && (set.year || set.month)) next.date = `${next.year}-${String(next.month).padStart(2, "0")}`;
        const clean = cleanItem(d, a.collection, next, set);
        replaceItem(d, a.collection, clean);
        const shown = Object.keys(set).map((k) => `${k} = ${JSON.stringify(clean[k])}`).concat((a.unset || []).map((k) => `${k} removed`));
        return { text: `Updated the ${spec.label} ${old.id}: ${shown.join(", ")}.`, touched: [[a.collection, old.id]] };
      });
    },
  },
  {
    name: "lifelog_delete_item",
    description: "Delete one item (expense, timeline entry, backlog item, note, habit, recurring bill, project). Undoable with lifelog_undo.",
    destructive: true,
    input: { collection: S.str("Which list", { enum: COLL_ENUM }), item: S.str("Its id (or title/name)") },
    required: ["collection", "item"],
    async run(a) {
      const spec = COLLECTIONS[a.collection] || fail("collection must be one of: " + COLL_ENUM.join(", "));
      return change(`delete ${spec.label} "${a.item}"`, (d) => {
        const old = findItem(d, a.collection, a.item);
        d[a.collection] = d[a.collection].filter((x) => x.id !== old.id);
        return { text: `Deleted the ${spec.label} "${cut(old[spec.name] || old.text || old.id, 60)}" (${old.id}).`, touched: [[a.collection, old.id]] };
      });
    },
  },
  {
    name: "lifelog_add_accomplishment",
    description: "Add a highlight to a year's accomplishments on the timeline.",
    input: { text: S.str("What was accomplished"), year: S.int("Default this year"), notes: S.str("Optional") },
    required: ["text"],
    async run(a) {
      const year = String(+a.year || new Date().getFullYear());
      if (!/^\d{4}$/.test(year)) fail("year is four digits, like 2026.");
      return change(`accomplishment "${a.text}"`, (d) => {
        const item = App.sanitizeAccomplishment({ id: L.uid(), text: String(a.text).trim(), createdAt: changeNow, updatedAt: changeNow, ...(a.notes ? { notes: String(a.notes).trim() } : {}) }, year);
        d.accomplishments = d.accomplishments || {};
        (d.accomplishments[year] = d.accomplishments[year] || []).push(item);
        return { text: `Added to ${year}'s accomplishments: "${item.text}". id ${item.id}`, touched: [["accomplishments", item.id]] };
      });
    },
  },
  {
    name: "lifelog_update_accomplishment",
    description: "Change an accomplishment's text or notes, or move it to another year.",
    input: { item: S.str("Its id or text"), text: S.str("New text"), notes: S.str("New notes; empty removes them"), year: S.int("Move it to this year") },
    required: ["item"],
    async run(a) {
      if (a.text == null && a.notes == null && a.year == null) fail("Nothing to change: give text, notes or year.");
      if (a.year != null && !/^\d{4}$/.test(String(a.year))) fail("year is four digits, like 2026.");
      return change(`edit accomplishment "${a.item}"`, (d) => {
        const old = findAccomplishment(d, a.item);
        const { year: was, ...item } = old;
        if (a.text != null) { if (!String(a.text).trim()) fail("An accomplishment needs text."); item.text = String(a.text).trim(); }
        if (a.notes != null) { if (String(a.notes).trim()) item.notes = String(a.notes).trim(); else delete item.notes; }
        const year = a.year != null ? String(a.year) : was;
        removeAccomplishment(d, old.id);
        (d.accomplishments[year] = d.accomplishments[year] || []).push(App.sanitizeAccomplishment(item, year));
        return { text: `Updated the accomplishment ${old.id} (${year}): "${item.text}".`, touched: [["accomplishments", old.id]] };
      });
    },
  },
  {
    name: "lifelog_delete_accomplishment",
    description: "Delete an accomplishment. Undoable with lifelog_undo.",
    destructive: true,
    input: { item: S.str("Its id or text") },
    required: ["item"],
    async run(a) {
      return change(`delete accomplishment "${a.item}"`, (d) => {
        const old = findAccomplishment(d, a.item);
        removeAccomplishment(d, old.id);
        return { text: `Deleted ${old.year}'s accomplishment "${cut(old.text, 60)}" (${old.id}).`, touched: [["accomplishments", old.id]] };
      });
    },
  },
  {
    name: "lifelog_rename_category",
    description: "Rename a category or project, or change its colour. Every item filed under it follows, as when renaming in the app (a note category's boards too). A timeline category also takes the switches for what its items show (In progress, Bought, Author, Episode count).",
    input: {
      kind: S.str("Which kind", { enum: Object.keys(NAME_LISTS) }), name: S.str("Its current name"),
      new_name: S.str("The new name"), color: S.str("New colour, #rrggbb"),
      show_in_progress: S.bool("Timeline only: offer In progress (start) on its items"),
      show_bought: S.bool("Timeline only: offer Bought on its items"),
      show_author: S.bool("Timeline only: show an author on its items"),
      show_progress: S.bool("Timeline only: show an episode count on its items in progress"),
    },
    required: ["kind", "name"],
    async run(a) {
      const spec = NAME_LISTS[a.kind] || fail("kind must be one of: " + Object.keys(NAME_LISTS).join(", "));
      const to = a.new_name != null ? String(a.new_name).trim() : "";
      const shows = [["show_in_progress", "showInProgress"], ["show_bought", "showBought"], ["show_author", "showAuthor"], ["show_progress", "showProgress"]].filter(([k]) => typeof a[k] === "boolean");
      if (shows.length && a.kind !== "timeline") fail("The show_ switches are for a timeline category.");
      if (!to && !a.color && !shows.length) fail("Nothing to change: give new_name, color or a show_ switch.");
      if (a.new_name != null && !to) fail("new_name can't be empty.");
      if (a.color && !/^#[0-9a-f]{6}$/i.test(a.color)) fail("color is #rrggbb.");
      let from = null;
      const summary = `rename ${spec.label} "${a.name}"` + (to ? ` to "${to}"` : "");
      const main = await commit("data", summary, (d) => {
        from = nameIn(d, spec.list, a.name, spec.label);
        const cat = d[spec.list].find((c) => c.name === from);
        if (to && to !== from && d[spec.list].some((c) => c !== cat && lower(c.name) === lower(to))) fail(`There's already a ${spec.label} called "${to}".`);
        const before = new Map(spec.uses.flatMap((k) => (d[k] || []).map((x) => [k + "\u0000" + x.id, JSON.stringify(x)])));
        if (a.color) cat.color = a.color.toLowerCase();
        // Stored as the app stores them: In progress and Bought only when off.
        for (const [k, field] of shows) {
          if (field !== "showAuthor" && field !== "showProgress" && a[k]) delete cat[field]; else cat[field] = a[k];
        }
        let settings = [];
        if (to && to !== from) { cat.name = to; settings = spec.rename(d, from, to) || []; }
        const moved = spec.uses.flatMap((k) => (d[k] || []).filter((x) => before.get(k + "\u0000" + x.id) !== JSON.stringify(x)).map((x) => [k, x.id]));
        return { text: `${to && to !== from ? `Renamed the ${spec.label} "${from}" to "${to}"` : `${a.color ? "Recoloured" : "Updated"} the ${spec.label} "${from}"`}; ${moved.length} item${moved.length === 1 ? "" : "s"} follow${moved.length === 1 ? "s" : ""}${settings.length ? ", and its lookup source" : ""}.`, touched: [[spec.list, cat.id], ...moved, ...settings] };
      });
      let text = main.text, items = main.items;
      if (a.kind === "note" && to && to !== from) {
        const boards = await commit("boards", summary, (doc) => {
          const hit = Boards.renameCategoryIn(doc.boards || [], from, to);
          return { text: hit.length ? ` ${hit.length} board${hit.length === 1 ? "" : "s"} too.` : "", touched: hit.map((b) => ["boards", b.id]) };
        });
        text += boards.text;
        items = items.concat(boards.items);
      }
      undoLog(cfg).push({ summary, at: main.at, items });
      return text;
    },
  },
  {
    name: "lifelog_edit_recurring_charge",
    description: "Change one charge of a recurring bill without touching the others: what it cost that time, its note, or skip it. reset puts it back to the bill's terms. Dates come from lifelog_expenses (the bill's charges).",
    input: {
      bill: S.str("The bill's id or name"), date: S.date("The charge's date"),
      amount: S.num("What was billed this time; in the bill's own currency if it's billed in another"),
      rate: S.num("For a bill in another currency: home currency per 1 unit on that date (default: the rate it has)"),
      note: S.str("This charge's note"), skip: S.bool("Skip this charge (true) or bring it back (false)"),
      reset: S.bool("Undo every change to this charge"),
    },
    required: ["bill", "date"],
    async run(a) {
      const date = requireDate(a.date, "date");
      if (a.reset && (a.amount != null || a.note != null || a.skip != null || a.rate != null)) fail("reset takes nothing else.");
      if (!a.reset && a.amount == null && a.note == null && a.skip == null && a.rate == null) fail("Nothing to change: give amount, rate, note, skip or reset.");
      if (a.amount != null && !(+a.amount >= 0)) fail("amount can't be negative.");
      return change(`charge ${date} of "${a.bill}"`, (d) => {
        const { latest, chain } = findBill(d, a.bill);
        const name = latest.note || latest.category;
        const until = new Date(date + "T00:00:00");
        let plan = null, occ = null;
        for (const r of chain) {
          const o = Finance.recurringOccurrences(r, until).find((x) => x.date === date);
          if (o) { plan = r; occ = o; }
        }
        if (!occ) {
          const far = new Date(until); far.setDate(far.getDate() + 400);
          const near = Finance.closestOccurrenceDate(chain.flatMap((r) => Finance.recurringOccurrences(r, far)), date);
          fail(`"${name}" has no charge on ${date}${near ? `; the nearest is ${near}` : ""}.`);
        }
        const rec = structuredClone(plan);
        if (a.reset) Finance.resetOccurrence(rec, date);
        else {
          const ov = (plan.overrides || {})[date] || {};
          const foreign = !!(rec.currency && rec.currency !== currencyOf(d) && Finance.occurrenceFx(rec, date, ov));
          if (!foreign && a.rate != null) fail(`"${name}" is billed in ${currencyOf(d)}; it takes no rate.`);
          const rate = foreign ? (a.rate != null ? +a.rate : occ.rate) : undefined;
          if (foreign && !(rate > 0)) fail(`Give a rate for ${rec.currency} on ${date}.`);
          Finance.setOccurrence(rec, date, {
            amount: a.amount != null ? Math.round(+a.amount * 100) / 100 : (foreign ? occ.fxAmount : occ.amount),
            note: a.note != null ? String(a.note).trim() : (occ.note || ""),
            skip: a.skip != null ? !!a.skip : !!ov.skip,
            rate,
          });
        }
        const clean = cleanItem(d, "recurringExpenses", rec);
        replaceItem(d, "recurringExpenses", clean);
        const now = Finance.recurringOccurrences(clean, until).find((x) => x.date === date);
        const fx = now.currency ? ` (${now.fxAmount} ${now.currency} at ${now.rate})` : "";
        const state = now.paused ? "paused (the bill's pause covers it)" : now.skipped ? "skipped" : money(d, now.amount) + fx;
        return { text: `"${name}" on ${date}: ${state}${now.note ? " — " + now.note : ""}${now.overridden ? "" : " (the bill's own terms)"}.`, touched: [["recurringExpenses", plan.id]] };
      });
    },
  },
  {
    name: "lifelog_pause_recurring",
    description: "Pause a recurring bill (no charges from `from` to `to`; leave `to` out to pause until resumed), resume one that's paused today, or remove a pause by its start date.",
    input: {
      bill: S.str("The bill's id or name"), from: S.date("Pause from, default today"), to: S.date("Last paused day, optional"),
      resume: S.bool("End the pause in force today; charges pick up from tomorrow"), remove: S.date("Remove the pause that starts on this date"),
    },
    required: ["bill"],
    async run(a) {
      const from = requireDate(a.from, "from"), to = requireDate(a.to, "to"), remove = requireDate(a.remove, "remove");
      if ([a.resume, remove, from || to].filter(Boolean).length > 1) fail("Pause, resume or remove: one at a time.");
      if (to && to < (from || today())) fail("A pause can't end before it starts.");
      return change(`pause "${a.bill}"`, (d) => {
        const { latest } = findBill(d, a.bill);
        const name = latest.note || latest.category;
        const rec = structuredClone(latest);
        let text;
        if (a.resume) {
          if (!Finance.resumeOn(rec, today())) fail(`"${name}" isn't paused today.`);
          text = `Resumed "${name}"; its charges pick up from tomorrow.`;
        } else if (remove) {
          const i = (rec.pauses || []).findIndex((p) => p.from === remove);
          if (i < 0) fail(`"${name}" has no pause starting ${remove}. Its pauses: ${(rec.pauses || []).map((p) => p.from + (p.to ? " to " + p.to : " on")).join(", ") || "none"}.`);
          Finance.setPause(rec, i, null);
          text = `Removed the pause from ${remove} on "${name}"; those charges are back.`;
        } else {
          const start = from || today();
          Finance.setPause(rec, null, to ? { from: start, to } : { from: start });
          text = to ? `Paused "${name}" from ${start} to ${to}.` : `Paused "${name}" from ${start} until resumed.`;
        }
        replaceItem(d, "recurringExpenses", cleanItem(d, "recurringExpenses", rec));
        return { text, touched: [["recurringExpenses", latest.id]] };
      });
    },
  },
  {
    name: "lifelog_update_board",
    description: "Rename a drawing board, file it under a note category, or star it. Its drawing isn't touched.",
    input: { board: S.str("Its id or name"), name: S.str("New name"), category: S.str("A note category; empty for none"), fav: S.bool("Starred") },
    required: ["board"],
    async run(a) {
      if (a.name == null && a.category == null && a.fav == null) fail("Nothing to change: give name, category or fav.");
      if (a.name != null && !String(a.name).trim()) fail("A board needs a name.");
      const d = a.category ? await readData() : null;
      const category = a.category ? nameIn(d, "noteCategories", a.category, "note category") : "";
      return change(`edit board "${a.board}"`, (doc) => {
        const b = findBoard((doc.boards || []).map(Boards.sanitizeBoard), a.board);
        const next = { ...(doc.boards.find((x) => x.id === b.id)) };
        if (a.name != null) next.name = String(a.name).trim();
        if (a.category != null) { if (category) next.category = category; else delete next.category; }
        if (a.fav != null) { if (a.fav) next.fav = true; else delete next.fav; }
        replaceItem(doc, "boards", Boards.sanitizeBoard(next));
        return { text: `Updated the board ${b.id}: "${next.name}"${next.category ? " [" + next.category + "]" : ""}${next.fav ? " ★" : ""}.`, touched: [["boards", b.id]] };
      }, { file: "boards" });
    },
  },
  {
    name: "lifelog_delete_board",
    description: "Delete a drawing board. Undoable with lifelog_undo.",
    destructive: true,
    input: { board: S.str("Its id or name") },
    required: ["board"],
    async run(a) {
      return change(`delete board "${a.board}"`, (doc) => {
        const b = findBoard((doc.boards || []).map(Boards.sanitizeBoard), a.board);
        doc.boards = doc.boards.filter((x) => x.id !== b.id);
        return { text: `Deleted the board "${b.name}" (${b.id}).`, touched: [["boards", b.id]] };
      }, { file: "boards" });
    },
  },
  {
    name: "lifelog_add_trip",
    description: "Start a trip in the Travel tab. Dates are optional; with them every day of the trip shows in its plan.",
    input: { name: S.str("What to call it"), start: S.date("First day"), end: S.date("Last day") },
    required: ["name"],
    async run(a) {
      return change(`add trip "${a.name}"`, (doc) => {
        const now = changeNow || nowIso();
        const t = Travel.sanitizeTrip({ id: L.uid(), name: a.name, start: a.start, end: a.end || a.start, createdAt: now, updatedAt: now });
        (doc.trips = doc.trips || []).push(t);
        return { text: `Added the trip "${t.name}"${t.start ? ", " + Travel.rangeLabel(t.start, t.end) : ""} (${t.id}).`, touched: [["trips", t.id]] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_update_trip",
    description: "Rename a trip or change its dates. An empty date clears it.",
    input: { trip: S.str("Its id or name"), name: S.str("New name"), start: S.date("First day"), end: S.date("Last day") },
    required: ["trip"],
    async run(a) {
      if (a.name == null && a.start == null && a.end == null) fail("Nothing to change: give name, start or end.");
      return change(`edit trip "${a.trip}"`, (doc) => {
        const t = findTrip(Travel.sanitizeDoc(doc).trips, a.trip);
        const next = { ...(doc.trips.find((x) => x.id === t.id)) };
        if (a.name != null) { if (!String(a.name).trim()) fail("A trip needs a name."); next.name = a.name; }
        for (const k of ["start", "end"]) if (a[k] != null) { if (a[k] === "") delete next[k]; else next[k] = a[k]; }
        const clean = Travel.sanitizeTrip(next);
        replaceItem(doc, "trips", clean);
        return { text: `Updated the trip "${clean.name}": ${Travel.rangeLabel(clean.start, clean.end) || "no dates"}.`, touched: [["trips", t.id]] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_delete_trip",
    description: "Delete a trip and every place in it. Undoable with lifelog_undo.",
    destructive: true,
    input: { trip: S.str("Its id or name") },
    required: ["trip"],
    async run(a) {
      return change(`delete trip "${a.trip}"`, (doc) => {
        const t = findTrip(Travel.sanitizeDoc(doc).trips, a.trip);
        const gone = (doc.places || []).filter((p) => p.trip === t.id);
        doc.trips = doc.trips.filter((x) => x.id !== t.id);
        doc.places = (doc.places || []).filter((p) => p.trip !== t.id);
        return { text: `Deleted the trip "${t.name}" and its ${gone.length} place${gone.length === 1 ? "" : "s"}.`, touched: [["trips", t.id], ...gone.map((p) => ["places", p.id])] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_add_place",
    description: "Add a place to a trip. Give day to plan it for that day, and time (and endTime) to schedule it; with neither it's somewhere to get to sometime during the trip.",
    input: {
      trip: S.str("The trip's id or name"), name: S.str("The place"), day: S.date("The day to go"),
      time: S.str("Start time, HH:MM (needs day)"), endTime: S.str("End time, HH:MM"),
      address: S.str("Address"), note: S.str("A note"), url: S.str("A Google Maps link"),
      lat: S.num("Latitude"), lng: S.num("Longitude"),
    },
    required: ["trip", "name"],
    async run(a) {
      return change(`add place "${a.name}"`, (doc) => {
        const t = findTrip(Travel.sanitizeDoc(doc).trips, a.trip);
        const now = changeNow || nowIso();
        const same = (doc.places || []).filter((p) => p.trip === t.id && (p.day || "") === (a.day || "") && typeof p.order === "number");
        const raw = placeFields(a, { id: L.uid(), trip: t.id, createdAt: now, updatedAt: now, order: same.length ? Math.max(...same.map((p) => p.order)) + 1 : 0 });
        const p = Travel.sanitizePlace(raw);
        (doc.places = doc.places || []).push(p);
        return { text: `Added "${p.name}" to ${t.name}${p.day ? " on " + Travel.dayLabel(p.day) + (p.time ? " at " + Travel.timeLabel(p) : "") : ", no day yet"} (${p.id}).`, touched: [["places", p.id]] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_update_place",
    description: "Change a place in a trip: move it to a day (empty day for no day), schedule or unschedule it (empty time), edit its details, or mark it visited.",
    input: {
      place: S.str("Its id, or its name"), trip: S.str("The trip, when the name alone is ambiguous"),
      name: S.str("New name"), day: S.date("The day; empty for no day"),
      time: S.str("Start time, HH:MM; empty to unschedule"), endTime: S.str("End time, HH:MM; empty to clear"),
      address: S.str("Address"), note: S.str("A note"), url: S.str("A Google Maps link"),
      lat: S.num("Latitude"), lng: S.num("Longitude"), visited: S.bool("Been there"),
    },
    required: ["place"],
    async run(a) {
      if (PLACE_FIELDS.every((k) => a[k] == null)) fail("Nothing to change.");
      return change(`edit place "${a.place}"`, (doc) => {
        const found = findPlace(Travel.sanitizeDoc(doc), a.place, a.trip);
        const next = { ...(doc.places.find((x) => x.id === found.id)) };
        if (a.day === "") { delete next.time; delete next.endTime; }
        if (a.time === "") delete next.endTime;
        placeFields({ ...a, visited: a.visited === false ? "" : a.visited }, next);
        const p = Travel.sanitizePlace(next);
        replaceItem(doc, "places", p);
        return { text: `Updated "${p.name}": ${p.day ? Travel.dayLabel(p.day) + (p.time ? " at " + Travel.timeLabel(p) : "") : "no day yet"}${p.visited ? ", visited" : ""}.`, touched: [["places", p.id]] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_delete_place",
    description: "Remove a place from a trip. Undoable with lifelog_undo.",
    destructive: true,
    input: { place: S.str("Its id, or its name"), trip: S.str("The trip, when the name alone is ambiguous") },
    required: ["place"],
    async run(a) {
      return change(`delete place "${a.place}"`, (doc) => {
        const p = findPlace(Travel.sanitizeDoc(doc), a.place, a.trip);
        doc.places = doc.places.filter((x) => x.id !== p.id);
        return { text: `Removed "${p.name}".`, touched: [["places", p.id]] };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_google_list",
    description: "Read a Google Maps link: a shared saved list (maps.app.goo.gl/…) gives every place in it, grouped by area; a shared place gives that one. Nothing is changed; lifelog_import_google_list adds them to a trip.",
    readOnly: true,
    input: { link: S.str("The link from Share in Google Maps") },
    required: ["link"],
    async run(a) {
      const got = await readGoogle(a.link);
      const lines = [`${got.name}: ${got.places.length} place${got.places.length === 1 ? "" : "s"}`];
      for (const area of Travel.areas(got.places)) {
        lines.push("", area.name);
        for (const p of area.places) lines.push(`- ${p.name}${[p.address, p.note].filter(Boolean).length ? " — " + cut([p.address, p.note].filter(Boolean).join(" · "), 160) : ""}`);
      }
      return lines.join("\n");
    },
  },
  {
    name: "lifelog_import_google_list",
    description: "Add places from a Google Maps link (a shared saved list, or one place) to a trip, with no day yet. A list often spans several trips: give only to take just the places whose names (or towns, as lifelog_google_list groups them) contain one of its comma-separated words. Places already in the trip are skipped.",
    input: {
      trip: S.str("The trip's id or name"), link: S.str("The link from Share in Google Maps"),
      only: S.str("Comma-separated: keep only places whose name or town contains one of these"),
    },
    required: ["trip", "link"],
    async run(a) {
      const got = await readGoogle(a.link);
      const words = String(a.only || "").split(",").map(lower).filter(Boolean);
      const town = new Map();
      for (const area of Travel.areas(got.places)) for (const p of area.places) town.set(p, area.name);
      const wanted = got.places.filter((p) => !words.length || words.some((w) => lower(p.name).includes(w) || lower(town.get(p)).includes(w)));
      if (!wanted.length) fail(`None of the ${got.places.length} places in "${got.name}" matches "${a.only}".`);
      const before = await readTravel();
      const t0 = findTrip(before.trips, a.trip);
      if (wanted.every((g) => before.places.some((h) => h.trip === t0.id && Travel.samePlace(h, g)))) {
        return `Nothing to add: ${wanted.length === 1 ? "that place is" : `all ${wanted.length} places are`} already in ${t0.name}.`;
      }
      return change(`import ${wanted.length} places from "${got.name}"`, (doc) => {
        const t = findTrip(Travel.sanitizeDoc(doc).trips, a.trip);
        doc.places = doc.places || [];
        const have = doc.places.filter((p) => p.trip === t.id);
        const fresh = wanted.filter((g) => !have.some((h) => Travel.samePlace(h, g)));
        const now = changeNow || nowIso();
        const loose = have.filter((p) => !p.day && typeof p.order === "number");
        let order = loose.length ? Math.max(...loose.map((p) => p.order)) + 1 : 0;
        const added = fresh.map((g) => Travel.sanitizePlace({
          ...g, id: L.uid(), trip: t.id, order: order++, createdAt: now, updatedAt: now,
          source: got.source || undefined, url: got.url || undefined,
        }));
        doc.places.push(...added);
        const skipped = wanted.length - fresh.length;
        return {
          text: `Added ${added.length} place${added.length === 1 ? "" : "s"} from "${got.name}" to ${t.name}, no day yet${skipped ? `; ${skipped} already there` : ""}.` + (added.length ? "\n" + added.map((p) => `- ${p.name}  (${p.id})`).join("\n") : ""),
          touched: added.map((p) => ["places", p.id]),
        };
      }, { file: "travel" });
    },
  },
  {
    name: "lifelog_add_habit",
    description: "Start a habit: something to do (daily, or on some weekdays, optionally several times a day) or something to keep away from (avoid, with a daily limit of slips).",
    input: {
      name: S.str("What the habit is"),
      days: { type: "array", items: { type: "string" }, description: "Weekdays it's due, e.g. [\"mon\",\"wed\",\"fri\"]; leave out for every day" },
      target: S.int("Times a day, default 1"), avoid: S.bool("Something to keep away from; its marks count slips"),
      limit: S.int("With avoid: slips a day that still count as kept, default 0"),
      color: S.str("#rrggbb, optional"), start_date: S.date("When it starts counting, default today"),
    },
    required: ["name"],
    async run(a) {
      const name = String(a.name).trim();
      if (!name) fail("A habit needs a name.");
      const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const days = (a.days || []).map((x) => {
        const n = /^\d$/.test(String(x)) ? +x : WEEK.indexOf(lower(x).slice(0, 3));
        if (!(n >= 0 && n <= 6)) fail(`"${x}" isn't a weekday (mon, tue, ...).`);
        return n;
      });
      if (a.color && !/^#[0-9a-f]{6}$/i.test(a.color)) fail("color is #rrggbb.");
      const start = requireDate(a.start_date, "start_date") || today();
      return change(`habit "${name}"`, (d) => {
        if ((d.habits || []).some((h) => !h.archivedAt && lower(h.name) === lower(name))) fail(`There's already a habit called "${name}".`);
        const item = { name, startedAt: start, order: Math.max(-1, ...(d.habits || []).map((h) => +h.order || 0)) + 1 };
        if (days.length && days.length < 7) item.cadence = { days };
        if (a.color) item.color = a.color.toLowerCase();
        if (a.avoid) Object.assign(item, { avoid: true, limit: +a.limit || 0 });
        else if (a.target) item.target = a.target;
        const h = addItem(d, "habits", item);
        return { text: `Started the habit "${h.name}" (${Habits.cadenceLabel(h)}${h.avoid ? `, avoiding, at most ${h.limit} a day` : h.target > 1 ? `, ${h.target} a day` : ""}) from ${h.startedAt}. id ${h.id}`, touched: [["habits", h.id]] };
      });
    },
  },
  {
    name: "lifelog_add_recurring",
    description: "Add a recurring bill (rent, a subscription...). It charges from start_date every week, month or year, and its charges count in spending like the Ledger's. To change a bill's price from some date, use lifelog_update_item on the old one's endDate and add the new one.",
    input: {
      amount: S.num("What each charge costs"), category: S.str("An expense category from lifelog_overview"),
      subcategory: S.str("One of that category's subcategories, optional"),
      interval: S.str("How often, default monthly", { enum: ["weekly", "monthly", "yearly"] }),
      start_date: S.date("The first charge, default today"), end_date: S.date("The last day it charges, optional"),
      note: S.str("What it is, e.g. Netflix"), project: S.str("A project, optional"),
      charge_day: S.int("Monthly or yearly: the day of the month it charges, if not the start date's"),
      charge_weekday: S.int("Weekly: 0 Sunday to 6 Saturday, if not the start date's"),
      charge_month: S.int("Yearly: 1-12, with charge_day, if not the start date's"),
      currency: S.str("Three-letter code if billed in another currency"), rate: S.num("Home currency per 1 unit of `currency`"),
    },
    required: ["amount", "category"],
    async run(a) {
      const paid = +a.amount;
      if (!(paid > 0)) fail("amount must be more than 0.");
      const start = requireDate(a.start_date, "start_date") || today();
      const end = requireDate(a.end_date, "end_date");
      if (end && end < start) fail("end_date is before start_date.");
      const interval = a.interval || "monthly";
      if (!["weekly", "monthly", "yearly"].includes(interval)) fail("interval is weekly, monthly or yearly.");
      return change(`recurring ${paid} ${a.category}`, (d) => {
        const code = String(a.currency || "").toUpperCase();
        const foreign = code && code !== currencyOf(d);
        if (foreign && !(+a.rate > 0)) fail(`Give a rate for ${code}: how many ${currencyOf(d)} one ${code} is.`);
        const item = { startDate: start, interval, amount: foreign ? Math.round(paid * a.rate * 100) / 100 : paid, category: a.category };
        if (a.subcategory) item.subcategory = a.subcategory;
        if (end) item.endDate = end;
        if (a.note) item.note = String(a.note).trim();
        if (a.project) item.project = a.project;
        if (foreign) Object.assign(item, { currency: code, fxAmount: paid, rate: +a.rate });
        if (a.charge_day != null) item.chargeDay = a.charge_day;
        if (a.charge_weekday != null) item.chargeWeekday = a.charge_weekday;
        if (a.charge_month != null) item.chargeMonth = a.charge_month;
        const r = addItem(d, "recurringExpenses", item);
        const next = nextCharge(r);
        return { text: `Added the recurring bill ${r.note || catLabel(r)}: ${money(d, r.amount)}${foreign ? ` (${paid} ${code})` : ""} ${r.interval} [${catLabel(r)}], from ${r.startDate}${next ? `, next ${next.date}` : ""}. id ${r.id}`, touched: [["recurringExpenses", r.id]] };
      });
    },
  },
  {
    name: "lifelog_add_category",
    description: "Add a category (timeline, expense or note) or a project, as the app's Add category does.",
    input: {
      kind: S.str("Which kind", { enum: Object.keys(NAME_LISTS) }), name: S.str("Its name"), color: S.str("#rrggbb, optional"),
      show_in_progress: S.bool("Timeline only: offer In progress (start) on its items, default true"),
      show_bought: S.bool("Timeline only: offer Bought on its items, default true"),
      show_author: S.bool("Timeline only: show an author on its items"),
    },
    required: ["kind", "name"],
    async run(a) {
      const spec = NAME_LISTS[a.kind] || fail("kind must be one of: " + Object.keys(NAME_LISTS).join(", "));
      const name = String(a.name).trim();
      if (!name) fail("A category needs a name.");
      if (a.color && !/^#[0-9a-f]{6}$/i.test(a.color)) fail("color is #rrggbb.");
      const shows = ["show_in_progress", "show_bought", "show_author"].filter((k) => typeof a[k] === "boolean");
      if (shows.length && a.kind !== "timeline") fail("The show_ switches are for a timeline category.");
      return change(`add ${spec.label} "${name}"`, (d) => {
        const list = d[spec.list] = d[spec.list] || [];
        if (list.some((c) => lower(c.name) === lower(name))) fail(`There's already a ${spec.label} called "${name}".`);
        const raw = { id: L.uid(), name, color: (a.color || CAT_PALETTE[list.length % CAT_PALETTE.length]).toLowerCase(), createdAt: changeNow, updatedAt: changeNow };
        if (a.show_in_progress === false) raw.showInProgress = false;
        if (a.show_bought === false) raw.showBought = false;
        if (typeof a.show_author === "boolean") raw.showAuthor = a.show_author;
        const cat = a.kind === "project" ? Finance.sanitizeProject(raw) : App.sanitizeCategory(raw);
        list.push(cat);
        return { text: `Added the ${spec.label} "${cat.name}" (${cat.color}).`, touched: [[spec.list, cat.id]] };
      });
    },
  },
  {
    name: "lifelog_delete_category",
    description: "Delete a category or project, as the app does: a timeline or expense category's items move to Other; a note category's notes and boards are left uncategorised; a project's expenses stay, just no longer grouped. Undoable with lifelog_undo.",
    destructive: true,
    input: { kind: S.str("Which kind", { enum: Object.keys(NAME_LISTS) }), name: S.str("Its name") },
    required: ["kind", "name"],
    async run(a) {
      const spec = NAME_LISTS[a.kind] || fail("kind must be one of: " + Object.keys(NAME_LISTS).join(", "));
      const summary = `delete ${spec.label} "${a.name}"`;
      let from = null;
      const main = await commit("data", summary, (d) => {
        from = nameIn(d, spec.list, a.name, spec.label);
        const cat = d[spec.list].find((c) => c.name === from);
        const before = new Map(spec.uses.flatMap((k) => (d[k] || []).map((x) => [k + "\u0000" + x.id, JSON.stringify(x)])));
        const used = spec.uses.reduce((n, k) => n + (d[k] || []).filter((x) => (a.kind === "project" ? x.project : x.category) === from).length, 0);
        const touched = [[spec.list, cat.id]];
        let where = "";
        if (used && (a.kind === "timeline" || a.kind === "expense")) {
          if (from === "Other") fail(`Can't delete "Other" while ${used} item${used === 1 ? " uses" : "s use"} it.`);
          let other = d[spec.list].find((c) => c.name === "Other");
          if (!other) {
            other = { id: "other", name: "Other", color: "#7a8a99", updatedAt: changeNow };
            d[spec.list].push(other);
            touched.push([spec.list, other.id]);
          }
          if (a.kind === "timeline") Journal.renameCategory(d, from, "Other"); else Finance.renameFinanceCategory(d, from, "Other", true);
          where = ` ${used} item${used === 1 ? "" : "s"} moved to Other.`;
        } else if (used) {
          spec.rename(d, from, null);
          where = a.kind === "note" ? ` ${used} note${used === 1 ? " is" : "s are"} now uncategorised.` : ` ${used} expense${used === 1 ? "" : "s"} no longer grouped.`;
        }
        d[spec.list] = d[spec.list].filter((c) => c !== cat);
        const moved = spec.uses.flatMap((k) => (d[k] || []).filter((x) => before.get(k + "\u0000" + x.id) !== JSON.stringify(x)).map((x) => [k, x.id]));
        return { text: `Deleted the ${spec.label} "${from}".${where}`, touched: [...touched, ...moved] };
      });
      let text = main.text, items = main.items;
      if (a.kind === "note") {
        const boards = await commit("boards", summary, (doc) => {
          const hit = Boards.renameCategoryIn(doc.boards || [], from, null);
          return { text: hit.length ? ` ${hit.length} board${hit.length === 1 ? "" : "s"} too.` : "", touched: hit.map((b) => ["boards", b.id]) };
        });
        text += boards.text;
        items = items.concat(boards.items);
      }
      undoLog(cfg).push({ summary, at: main.at, items });
      return text;
    },
  },
  // Subcategories (0.288.0): tools of their own rather than a kind on the
  // category tools, so nothing an existing chat sends changes meaning.
  {
    name: "lifelog_add_subcategory",
    description: "Add a subcategory to an expense category (e.g. Games under Entertainment). An expense can then be filed under the category alone or one of its subcategories; the category's totals include them all.",
    input: { category: S.str("The expense category"), name: S.str("The subcategory's name") },
    required: ["category", "name"],
    async run(a) {
      const name = String(a.name).trim();
      if (!name) fail("A subcategory needs a name.");
      return change(`add subcategory "${name}" to "${a.category}"`, (d) => {
        const parent = nameIn(d, "financeCategories", a.category, "expense category");
        const cat = d.financeCategories.find((c) => c.name === parent);
        const subs = cat.subs || [];
        if (subs.some((x) => lower(x.name) === lower(name))) fail(`"${parent}" already has a subcategory called "${name}".`);
        cat.subs = [...subs, { id: L.uid(), name, createdAt: changeNow, updatedAt: changeNow }];
        return { text: `Added the subcategory "${name}" to "${parent}". It has: ${cat.subs.map((x) => x.name).join(", ")}.`, touched: [["financeCategories", cat.id]] };
      });
    },
  },
  {
    name: "lifelog_rename_subcategory",
    description: "Rename an expense category's subcategory. Every expense, recurring bill and one-off charge filed under it follows.",
    input: { category: S.str("The expense category"), name: S.str("The subcategory's current name"), new_name: S.str("The new name") },
    required: ["category", "name", "new_name"],
    async run(a) {
      const to = String(a.new_name).trim();
      if (!to) fail("new_name can't be empty.");
      return change(`rename subcategory "${a.name}" to "${to}"`, (d) => {
        const parent = nameIn(d, "financeCategories", a.category, "expense category");
        const cat = d.financeCategories.find((c) => c.name === parent);
        const from = subIn(d, parent, a.name);
        if (lower(to) !== lower(from) && cat.subs.some((x) => lower(x.name) === lower(to))) fail(`"${parent}" already has a subcategory called "${to}".`);
        cat.subs = cat.subs.map((x) => (x.name === from ? { ...x, name: to } : x));
        const moved = subMove(d, parent, from, to);
        return { text: `Renamed "${parent} › ${from}" to "${to}"; ${moved.length} item${moved.length === 1 ? "" : "s"} follow${moved.length === 1 ? "s" : ""}.`, touched: [["financeCategories", cat.id], ...moved] };
      });
    },
  },
  {
    name: "lifelog_delete_subcategory",
    description: "Delete an expense category's subcategory, as the app does: what was filed under it stays in the category, with no subcategory. Undoable with lifelog_undo.",
    destructive: true,
    input: { category: S.str("The expense category"), name: S.str("The subcategory") },
    required: ["category", "name"],
    async run(a) {
      return change(`delete subcategory "${a.name}" of "${a.category}"`, (d) => {
        const parent = nameIn(d, "financeCategories", a.category, "expense category");
        const cat = d.financeCategories.find((c) => c.name === parent);
        const from = subIn(d, parent, a.name);
        cat.subs = cat.subs.filter((x) => x.name !== from);
        if (!cat.subs.length) delete cat.subs;
        const moved = subMove(d, parent, from, null);
        return { text: `Deleted "${parent} › ${from}".${moved.length ? ` ${moved.length} item${moved.length === 1 ? " is" : "s are"} now just ${parent}.` : ""}`, touched: [["financeCategories", cat.id], ...moved] };
      });
    },
  },
  {
    name: "lifelog_batch",
    description: "Make several changes as one: each step is another changing tool and its arguments, run in order on the same data, saved together and undone together by one lifelog_undo. If any step is refused, nothing is saved. For re-filing or editing many items at once. Renaming or deleting a category, and undo, run on their own.",
    destructive: true,
    input: {
      steps: {
        type: "array", description: "Up to 100 steps, e.g. [{\"tool\": \"lifelog_update_item\", \"args\": {\"collection\": \"entries\", \"item\": \"Hades\", \"set\": {\"rating\": 5}}}]",
        items: { type: "object", properties: { tool: { type: "string" }, args: { type: "object" } }, required: ["tool"] },
      },
    },
    required: ["steps"],
    async run(a) {
      const steps = Array.isArray(a.steps) ? a.steps : fail("steps is a list of {tool, args}.");
      if (!steps.length || steps.length > 100) fail("Give 1 to 100 steps.");
      const gathered = [];
      batch = gathered;
      try {
        for (const [i, s] of steps.entries()) {
          const name = String((s && s.tool) || "");
          const tool = TOOLS.find((t) => t.name === name || t.name === "lifelog_" + name);
          const at = `Step ${i + 1} (${name || "no tool"})`;
          if (!tool) fail(`${at}: no such tool.`);
          if (tool.readOnly || tool.name === "lifelog_batch") fail(`${at}: only changing tools go in a batch.`);
          const args = (s && s.args) || {};
          const n = gathered.length;
          try {
            for (const k of tool.required || []) if (args[k] == null || args[k] === "") fail(`${k} is required.`);
            await tool.run(args);
          } catch (e) { if (e instanceof InputError) fail(`${at}: ${e.message}`); throw e; }
          if (gathered.length !== n + 1) fail(`${at}: can't be part of a batch; run it on its own.`);
          gathered[n].label = at;
        }
      } finally { batch = null; }
      const files = ["data", "boards", "travel"].filter((f) => gathered.some((g) => g.file === f));
      const summary = `${steps.length} change${steps.length === 1 ? "" : "s"}`;
      const run = (f, d) => {
        for (const g of gathered.filter((x) => x.file === f)) {
          try { g.apply(d); } catch (e) { if (e instanceof InputError) fail(`${g.label}: ${e.message}`); throw e; }
        }
      };
      // Across files, every step is tried first, so a refusal in the second
      // file can't leave the first one saved.
      if (files.length > 1) for (const f of files) run(f, (await storeOf(f).read()).data);
      const texts = [], items = [];
      let at = null;
      for (const f of files) {
        const done = await commit(f, summary, (d) => {
          const out = { text: "", touched: [] };
          for (const g of gathered.filter((x) => x.file === f)) {
            let r;
            try { r = g.apply(d); } catch (e) { if (e instanceof InputError) fail(`${g.label}: ${e.message}`); throw e; }
            out.text += (out.text ? "\n" : "") + r.text;
            out.touched.push(...r.touched);
          }
          const seen = new Set();
          out.touched = out.touched.filter(([c, id]) => !seen.has(c + "\u0000" + id) && seen.add(c + "\u0000" + id));
          out.text = `${summary}:\n` + out.text;
          return out;
        });
        texts.push(done.text);
        items.push(...done.items);
        at = at || done.at;
      }
      if (items.length) undoLog(cfg).push({ summary: "batch of " + summary, at, items });
      return texts.join("\n");
    },
  },
  {
    name: "lifelog_undo",
    description: "Undo the most recent change made through this bridge. Refuses if the item was edited elsewhere since, unless force is true.",
    destructive: true,
    input: { force: S.bool("Undo even if the item was changed since") },
    async run(a) {
      storeOf();
      const log = undoLog(cfg);
      const rec = log.peek();
      if (!rec) return "There's nothing to undo.";
      const files = [...new Set(rec.items.map((it) => it.file || "data"))];
      const check = (file, d) => {
        for (const it of rec.items.filter((x) => (x.file || "data") === file)) {
          const cur = snapshotOf(d, it.coll, it.id);
          if (cur && it.after && cur.updatedAt !== it.after && !a.force) {
            fail(`"${rec.summary}" was changed again since (${it.coll} ${it.id}); undoing would lose that. Pass force to undo anyway.`);
          }
        }
      };
      // A change that spanned both files is checked in both before either
      // is put back, so an undo never stops halfway.
      if (files.length > 1) for (const f of files) check(f, (await storeOf(f).read()).data);
      for (const f of files) {
        await commit(f, `undo ${rec.summary}`, (d) => {
          check(f, d);
          for (const it of rec.items.filter((x) => (x.file || "data") === f)) restoreItem(d, it.coll, it.id, it.before);
          return { text: "", touched: [] };
        });
      }
      log.drop();
      return `Undid: ${rec.summary}.`;
    },
  },
];

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, text: `No tool called ${name}.` };
  try {
    for (const k of tool.required || []) if (args == null || args[k] == null || args[k] === "") fail(`${k} is required.`);
    const out = await tool.run(args || {});
    // A tool may send pictures with its text (lifelog_note_images).
    return out && typeof out === "object" ? { ok: true, text: out.text, images: out.images || [] } : { ok: true, text: out };
  } catch (e) {
    const known = e instanceof InputError || e instanceof SetupError;
    return { ok: false, text: known ? e.message : `${e.name}: ${e.message}` };
  }
}

function schemaOf(tool) {
  return { type: "object", properties: tool.input, ...(tool.required ? { required: tool.required } : {}), additionalProperties: false };
}

// For tests: point the bridge at a store of their own.
function useStore(s, c) { store = s; cfg = c; }

module.exports = { TOOLS, callTool, schemaOf, useStore, setClient, COLLECTIONS, SECRET_SETTINGS, version: L.version };
