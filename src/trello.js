// LifeLog — Trello lists as task lists, both ways (Nov 2026).
//
// Settings → Connections → Trello: sign in with a token, switch on the
// Trello lists you want, and each becomes a task list in the Notebook.
// A card is a task: its name the task's text, its description the task's
// description, its due date the task's date and time, its named labels
// tags, its checklist items subtasks. Ticking a task marks the card
// complete, moves it to the board's Done list or archives it (your pick);
// a new task becomes a card; edits go back; deleting a task archives its
// card (never deletes it). A card done, archived, moved off the list or
// deleted in Trello shows here on the next sync.
//
// How it stays in step: each linked task carries `trello.base`, what Trello
// had at the last sync. A field that differs from base here changed here;
// one that differs on Trello changed there; both changed, the newer side
// wins (the task's updatedAt against the card's dateLastActivity). That
// catches a change from anywhere (the widget, a reminder's Done, the
// bridge, another device) without hooking each of them. base rides sync
// with the task, so every device agrees on it.
//
// Ids are made from Trello's ("trello-<list id>" for the note,
// "trello-<card id>" for a task), so two devices bringing the same card in
// make one task, not two. `note.trello.cards` is the cards the list had at
// the last sync: one of those with no task any more was deleted here.
//
// Only api.trello.com is called, straight from the app in every build: it
// answers browsers (checked from the web copy, 21 Nov 2026), so no proxy.
// The token can read and write every board you can; it syncs like your
// other keys and is left out of exports (storage.js).
(function () {
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  const { pad, localDay } = (typeof window === "object" && window.LifeLogDates) || require("./dates.js");
  const Tasks = () => (typeof window !== "undefined" && window.LifeLogTasks) || require("./tasks.js");
  const Tags = () => (typeof window !== "undefined" && window.LifeLogTags) || require("./tags.js");
  let state, $, el, toast, persist, afterDataChange, render, whenSynced;

  function init(ctx) {
    ({ state, $, el, toast, persist, afterDataChange, render, whenSynced } = ctx);
  }

  // LifeLog's own Trello API key (a Power-Up's). It names the app, it isn't
  // a secret: Trello's own docs put it in browser code. A key typed in
  // Settings wins, for anyone running their own copy.
  const APP_KEY = "9bc8661da2c9db5df30acc2b08ee8e6d";
  const API = "https://api.trello.com/1";
  const TICKS = ["complete", "move", "archive"];
  // tick: what ticking a task does to its card. send: false reads only.
  // mine: only cards you're a member of.
  // split: the boards whose lists come in as a task list each; every other
  // board is one task list with its lists as sections (Daniel, 2026-11-22).
  const DEFAULTS = { key: "", token: "", member: null, connectedAt: "", lists: [], split: [], tick: "complete", send: true, mine: false };
  // While the app is in front: every couple of minutes, and on coming back
  // to it (tab, window focus, network) once it's been half a minute
  // (Daniel, 2026-11-22: it only seemed to sync on open). The computer app
  // in the tray keeps going at the tray's pace.
  const EVERY = 2 * 60 * 1000, AGAIN = 30 * 1000, TRAY_EVERY = 10 * 60 * 1000;
  const CARD_FIELDS = "name,desc,due,dueComplete,idLabels,idList,idBoard,closed,pos,dateLastActivity,idMembers,shortUrl";

  const text = (v) => String(v == null ? "" : v).trim();
  const plainObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const isId = (s) => typeof s === "string" && /^[0-9a-f]{24}$/i.test(s);

  // ---------- pure: settings ----------
  function cleanConfig(c) {
    c = plainObj(c);
    const out = { ...c, ...DEFAULTS };
    out.key = text(c.key);
    out.token = text(c.token);
    out.connectedAt = text(c.connectedAt);
    const m = plainObj(c.member);
    out.member = isId(m.id) ? { id: m.id, username: text(m.username), fullName: text(m.fullName) } : null;
    const seen = new Set();
    out.lists = (Array.isArray(c.lists) ? c.lists : []).map(plainObj)
      .filter((l) => isId(l.id) && isId(l.board) && !seen.has(l.id) && seen.add(l.id))
      .map((l) => ({ id: l.id, name: text(l.name), board: l.board, boardName: text(l.boardName) }));
    out.split = [...new Set((Array.isArray(c.split) ? c.split : []).filter(isId))];
    out.tick = TICKS.includes(c.tick) ? c.tick : DEFAULTS.tick;
    out.send = c.send !== false;
    out.mine = c.mine === true;
    return out;
  }
  const keyOf = (c) => c.key || APP_KEY;
  const together = (c, board) => !c.split.includes(board);
  // A board's own Done list: where its ticked tasks go, never a section.
  const DONE_NAME = /^(done|finished|complete|completed|בוצע|הושלם|סיום)$/i;
  const isDoneName = (name) => DONE_NAME.test(text(name));
  // The Trello lists a task list holds: one, or a board's.
  const listsOf = (n) => (n && n.trello ? (Array.isArray(n.trello.lists) ? n.trello.lists : n.trello.list ? [n.trello.list] : []) : []);
  // The Trello list a task sits in: its section on a board's task list
  // (the first when it has none, or one no longer brought in).
  function sectionOf(n, it) {
    const ls = listsOf(n);
    return it && ls.includes(it.section) ? it.section : ls[0];
  }
  const connected = (c) => !!(keyOf(c) && c.token);
  function authorizeUrl(key) {
    return "https://trello.com/1/authorize?expiration=never&name=LifeLog&scope=read,write&response_type=token&key=" + encodeURIComponent(key || "");
  }

  // ---------- pure: a task and a card ----------
  // A task's date and time as Trello's due. A day with no time is noon, so
  // it lands on the same day in any time zone near yours.
  function dueOf(it) {
    if (!it.date) return null;
    const d = new Date(it.date + "T" + (it.time || "12:00") + ":00");
    return isNaN(d) ? null : d.toISOString();
  }
  const minute = (iso) => (iso ? Math.floor(Date.parse(iso) / 60000) : null);
  const sameDue = (a, b) => minute(a) === minute(b);
  function fromDue(iso) {
    const d = new Date(iso);
    return { date: localDay(d), time: pad(d.getHours()) + ":" + pad(d.getMinutes()) };
  }
  const tagKey = (t) => String(t).toLowerCase();
  const sameSet = (a, b) => {
    const x = (a || []).map(tagKey).sort(), y = (b || []).map(tagKey).sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  };
  // The tags a card's named labels make; a label with no name has no tag.
  function labelTags(card, labels) {
    const byId = new Map((labels || []).map((l) => [l.id, l]));
    return Tags().clean((card.idLabels || []).map((id) => byId.get(id)).filter((l) => l && text(l.name)).map((l) => l.name));
  }
  // Of a task's tags, the ones that are labels on its board: a tag with no
  // label stays a LifeLog tag and never makes one.
  function labelled(it, labels) {
    const names = new Set((labels || []).filter((l) => text(l.name)).map((l) => tagKey(Tags().cleanOne ? Tags().cleanOne(l.name) : l.name)));
    return (it.tags || []).filter((t) => names.has(tagKey(t)));
  }
  // A card counts as done here when it's complete, archived or off the list.
  // `lists` is every Trello list the task list holds: a card moved between
  // two of a board's lists is moved, not done.
  const asLists = (l) => (Array.isArray(l) ? l : [l]);
  const cardDone = (card, lists) => !!(card.closed || card.dueComplete || !asLists(lists).includes(card.idList));
  function remoteOf(card, lists, labels, was) {
    lists = asLists(lists);
    const list = lists.includes(card.idList) ? card.idList : was || lists[0];
    return { name: text(card.name), desc: String(card.desc || ""), due: card.due || null, done: cardDone(card, lists), labels: labelTags(card, labels), list };
  }
  function localOf(it, labels, list) {
    return { name: it.text, desc: it.note || "", due: dueOf(it), done: !!it.done, labels: labelled(it, labels), list };
  }
  const SAME = { name: (a, b) => a === b, desc: (a, b) => a === b, due: sameDue, done: (a, b) => a === b, labels: sameSet, list: (a, b) => a === b };
  const FIELDS = Object.keys(SAME);

  function itemFromCard(card, lists, labels, now, onBoard = asLists(lists).length > 1) {
    lists = asLists(lists);
    const r = remoteOf(card, lists, labels);
    const it = { id: "trello-" + card.id, text: r.name || i18n.t("Untitled card") };
    if (onBoard) it.section = r.list;
    if (r.desc.trim()) it.note = r.desc;
    if (r.due) Object.assign(it, fromDue(r.due));
    if (r.labels.length) it.tags = r.labels;
    if (r.done) { it.done = true; it.doneAt = now; }
    it.trello = { card: card.id, base: r, checks: [] };
    if (r.done) it.trello.gone = !lists.includes(card.idList) || !!card.closed;
    return it;
  }
  function checksOf(card) {
    const out = [];
    for (const cl of card.checklists || []) for (const ci of cl.checkItems || []) out.push({ id: ci.id, checklist: cl.id, name: text(ci.name), done: ci.state === "complete", pos: ci.pos || 0 });
    return out.sort((a, b) => a.pos - b.pos);
  }

  // What ticking (or unticking) a task asks of its card.
  // On a board's task list a tick moves the card to the board's Done list
  // when it has one, unless ticking archives (Daniel, 2026-11-22).
  function doneParams(done, cfg, listId, card, doneList, board) {
    if (!done) {
      const p = { dueComplete: false };
      if (card.closed) p.closed = false;
      if (card.idList !== listId) { p.idList = listId; p.pos = "bottom"; }
      return p;
    }
    if (cfg.tick === "archive") return { closed: true };
    if ((cfg.tick === "move" || board) && doneList && doneList !== listId) return { idList: doneList, pos: "top" };
    return { dueComplete: true };
  }

  // ---------- pure: one sync ----------
  // Brings Trello's side (`remote`, fetched by fetchRemote) into `data` and
  // returns the requests that send this side's changes back. Mutates data.
  // Each op's `then(result, data)` writes its answer into whatever the data
  // is by then, by id, since edits may have landed while it ran.
  //   remote.lists[listId] = open cards on it, or null when it's gone
  //   remote.cards[cardId] = a card no longer on its list, or null (deleted)
  //   remote.labels[boardId], remote.doneList[boardId]
  function reconcile(data, cfgIn, remote, now = new Date().toISOString()) {
    const cfg = cleanConfig(cfgIn);
    const ops = [];
    const counts = { added: 0, updated: 0, removed: 0, sent: 0 };
    data.notes = data.notes || [];
    const me = cfg.member && cfg.member.id;
    const mineOk = (card) => !cfg.mine || !me || (card.idMembers || []).includes(me);
    const T = Tasks();

    // The task lists, made where missing: one per Trello list, or one per
    // board with the board's lists as its sections (its switch in Settings).
    const names = remote.listNames || {};
    const nameOf = (l) => text(names[l.id]) || l.name;
    const picked = new Map();
    for (const l of cfg.lists) { if (!picked.has(l.board)) picked.set(l.board, []); picked.get(l.board).push(l); }
    const linkedIds = new Set(cfg.lists.map((l) => l.id));
    const noteOf = new Map();
    for (const l of cfg.lists) {
      const whole = together(cfg, l.board);
      const id = whole ? "trello-board-" + l.board : "trello-" + l.id;
      let n = noteOf.get(l.id) || data.notes.find((x) => x.id === id)
        || (!whole && data.notes.find((x) => x.trello && x.trello.list === l.id && !Array.isArray(x.trello.lists)));
      if (!n) {
        const title = whole ? l.boardName || i18n.t("Trello board") : [l.boardName, l.name].filter(Boolean).join(" · ") || i18n.t("Trello list");
        n = { id, kind: "list", text: title, items: [], createdAt: now, editedAt: now };
        data.notes.unshift(n);
      }
      if (n.kind !== "list") continue;
      n.items = n.items || [];
      const prev = plainObj(n.trello);
      if (whole) {
        const ls = picked.get(l.board);
        n.trello = { ...prev, board: l.board, lists: ls.map((x) => x.id), cards: Array.isArray(prev.cards) ? prev.cards : [] };
        delete n.trello.list;
        n.sections = ls.map((x) => ({ id: x.id, name: nameOf(x) }));
        for (const x of ls) noteOf.set(x.id, n);
      } else {
        n.trello = { ...prev, list: l.id, board: l.board, cards: Array.isArray(prev.cards) ? prev.cards : [] };
        delete n.trello.lists;
        delete n.sections;
        noteOf.set(l.id, n);
      }
    }
    const notes = [...new Set(noteOf.values())];
    // A board switched to one task list, or back to one each: the tasks
    // move to where their Trello list now lives, with their ids (their
    // cards'), so nothing comes in twice. A task list left holding none of
    // the lists brought in goes.
    const at = (x) => Math.min(...listsOf(x).map((id) => cfg.lists.findIndex((l) => l.id === id)).filter((i) => i >= 0), Infinity);
    for (const x of data.notes.filter((y) => y.trello && !notes.includes(y)).sort((p, q) => at(p) - at(q))) {
      if (x.kind !== "list") continue;
      const own = listsOf(x);
      if (!own.some((id) => linkedIds.has(id))) continue;
      const kidsOf = (id) => (x.items || []).filter((c) => c.parent === id);
      for (const it of (x.items || []).filter((i) => !i.parent || !x.items.some((p) => p.id === i.parent))) {
        const sec = Array.isArray(x.trello.lists) ? sectionOf(x, it) : x.trello.list;
        const to = noteOf.get(sec);
        if (!to) continue;
        const moving = [it, ...kidsOf(it.id)];
        x.items = x.items.filter((i) => !moving.includes(i));
        if (to.items.some((i) => i.id === it.id)) continue; // already there (another device moved it)
        if (Array.isArray(to.trello.lists)) it.section = sec; else delete it.section;
        to.items.push(...moving.filter((i) => !to.items.some((y) => y.id === i.id)));
        if (it.trello && it.trello.card) to.trello.cards = [...new Set([...to.trello.cards, it.trello.card])];
      }
      const dest = notes.find((n) => listsOf(n).some((id) => own.includes(id)));
      for (const k of ["fav", "pinned", "category"]) if (dest && x[k] && !dest[k]) dest[k] = x[k];
      if (own.every((id) => linkedIds.has(id)) || !(x.items || []).length) data.notes = data.notes.filter((y) => y !== x);
    }
    // On a board's task list, a task whose Trello list was turned off goes
    // with it (as a list's own task list does); one made here and not sent
    // yet moves to the first section.
    for (const n of notes) {
      if (!Array.isArray(n.trello.lists)) continue;
      for (const it of [...n.items]) {
        if (it.parent || it.section == null || n.trello.lists.includes(it.section)) continue;
        if (it.trello && it.trello.card && it.trello.board === n.trello.board) {
          const gone = new Set([it.id, ...n.items.filter((c) => c.parent === it.id).map((c) => c.id)]);
          n.items = n.items.filter((c) => !gone.has(c.id));
        } else delete it.section;
      }
    }
    // Where every linked card is now, across all linked lists.
    const whereCard = new Map();
    for (const n of notes) for (const it of n.items) if (it.trello && it.trello.card) whereCard.set(it.trello.card, { n, it });
    const onLists = new Map();
    for (const [listId] of noteOf) for (const card of remote.lists[listId] || []) if (mineOk(card)) onLists.set(card.id, { card, listId });

    const drop = (n, it) => {
      const gone = new Set([it.id, ...n.items.filter((x) => x.parent === it.id).map((x) => x.id)]);
      n.items = n.items.filter((x) => !gone.has(x.id));
      counts.removed++;
    };
    const moveTo = (from, to, it, listId) => {
      if (Array.isArray(to.trello.lists)) it.section = listId; else delete it.section;
      const kids = from.items.filter((x) => x.parent === it.id);
      const ids = new Set([it.id, ...kids.map((x) => x.id)]);
      from.items = from.items.filter((x) => !ids.has(x.id));
      to.items.push(it, ...kids);
    };
    const findItem = (d, noteId, itemId) => {
      const n = (d.notes || []).find((x) => x.id === noteId);
      return n && (n.items || []).find((x) => x.id === itemId);
    };

    // One card against its task: pull what changed there, send what changed here.
    function oneCard(n, it, card) {
      const labels = remote.labels[card.idBoard] || [];
      const lists = listsOf(n), here = sectionOf(n, it), onBoard = Array.isArray(n.trello.lists);
      const r = remoteOf(card, lists, labels, here);
      const l = localOf(it, labels, here);
      // A base from before sections had no list: the card's is it.
      const base = { list: r.list, ...((it.trello && it.trello.base) || r) };
      const theirsNewer = Date.parse(card.dateLastActivity || 0) > Date.parse(it.updatedAt || 0);
      const nextBase = { ...base };
      const push = {};
      let pulled = false;
      for (const f of FIELDS) {
        const mine = !SAME[f](l[f], base[f]), there = !SAME[f](r[f], base[f]);
        // A finished task's section isn't sent: its card is in Done.
        if (f === "list" && mine && !there && (l.done || r.done)) { nextBase.list = base.list; continue; }
        if (there && (!mine || theirsNewer)) {
          pulled = pullField(n, it, f, r[f], labels) || pulled;
          nextBase[f] = r[f];
        } else if (mine && cfg.send) {
          push[f] = l[f];
        } else {
          nextBase[f] = r[f];
        }
      }
      it.trello = { ...plainObj(it.trello), card: card.id, base: nextBase };
      if (card.closed || !lists.includes(card.idList)) it.trello.gone = true; else delete it.trello.gone;
      if (pulled) counts.updated++;
      // A repeating task ticked in Trello moves on here, and its new date
      // and an open card go back.
      if (pulled && it.repeat && it.date && it.done === undefined && r.done && !base.done) {
        push.due = dueOf(it);
        push.done = false;
      }
      if (Object.keys(push).length) {
        const params = {};
        if ("name" in push) params.name = push.name;
        if ("desc" in push) params.desc = push.desc;
        if ("list" in push) { params.idList = push.list; params.pos = "bottom"; }
        if ("due" in push) params.due = push.due;
        if ("labels" in push) {
          const byName = new Map(labels.filter((x) => text(x.name)).map((x) => [tagKey(Tags().cleanOne(x.name)), x.id]));
          const unnamed = (card.idLabels || []).filter((id) => !labels.some((x) => x.id === id && text(x.name)));
          params.idLabels = [...unnamed, ...push.labels.map((t) => byName.get(tagKey(t))).filter(Boolean)];
        }
        if ("done" in push) Object.assign(params, doneParams(push.done, cfg, here, card, remote.doneList[card.idBoard], onBoard));
        const noteId = n.id, itemId = it.id;
        ops.push({ method: "PUT", path: "/cards/" + card.id, body: params, then: (res, d) => {
          const x = findItem(d, noteId, itemId);
          if (!x || !x.trello) return;
          x.trello.base = { ...x.trello.base, ...push };
          if ("done" in push) { if (push.done && (params.closed || params.idList)) x.trello.gone = true; else if (!push.done) delete x.trello.gone; }
        } });
        counts.sent++;
      }
      checklist(n, it, card);
    }

    function pullField(n, it, f, v, labels) {
      if (f === "name") { if (!v) return false; it.text = v; }
      else if (f === "list") { if (Array.isArray(n.trello.lists)) it.section = v; else delete it.section; }
      else if (f === "desc") { if (v.trim()) it.note = v; else delete it.note; }
      else if (f === "due") {
        if (v) Object.assign(it, fromDue(v));
        else { delete it.date; delete it.time; delete it.repeat; delete it.remind; }
      } else if (f === "done") {
        if (v && !it.done) {
          if (it.repeat && it.date && T.tick) { T.tick(n, it.id, true, new Date(now)); it.done = undefined; delete it.done; return true; }
          it.done = true; it.doneAt = now;
          for (const c of n.items) if (c.parent === it.id && !c.done) { c.done = true; c.doneAt = now; }
        } else if (!v && it.done) { delete it.done; delete it.doneAt; if (T.reopen) T.reopen(n); }
      } else if (f === "labels") {
        const mine = labelled(it, remote.labels[it.trello && it.trello.board] || labels);
        const rest = (it.tags || []).filter((t) => !mine.some((m) => tagKey(m) === tagKey(t)));
        const tags = Tags().clean([...rest, ...v]);
        if (tags.length) it.tags = tags; else delete it.tags;
      }
      return true;
    }

    // A card's checklist items as the task's subtasks, both ways.
    function checklist(n, it, card) {
      if (!Array.isArray(card.checklists)) return;
      const there = checksOf(card);
      const known = new Set((it.trello && it.trello.checks) || []);
      // Rows an older build cut loose from their card (it dropped every
      // row's parent on save): back under it. One whose item that build
      // then deleted on Trello goes back on its checklist.
      const ids0 = new Set(n.items.map((x) => x.id));
      const lists = new Set(card.checklists.map((c) => c.id));
      const thereIds = new Set(there.map((c) => c.id));
      const twin = new Set();
      for (const x of n.items) {
        if (x === it || (x.parent && ids0.has(x.parent)) || !x.trello || !(x.trello.check || x.trello.checklist)) continue;
        // The same row twice (once loose, once under it): the loose one goes.
        if (n.items.some((y) => y !== x && y.id === x.id && y.parent === it.id)) { twin.add(x); continue; }
        if (thereIds.has(x.trello.check)) { x.parent = it.id; continue; }
        if (lists.has(x.trello.checklist)) {
          x.parent = it.id;
          known.delete(x.trello.check);
          x.trello = { checklist: x.trello.checklist };
        }
      }
      if (twin.size) n.items = n.items.filter((x) => !twin.has(x));
      const kids = n.items.filter((x) => x.parent === it.id);
      for (const ci of there) {
        const kid = kids.find((x) => x.trello && x.trello.check === ci.id);
        if (!kid) {
          if (known.has(ci.id)) {
            // Deleted here: deleted there too (a checklist item can't be archived).
            if (cfg.send) { ops.push({ method: "DELETE", path: "/checklists/" + ci.checklist + "/checkItems/" + ci.id, then: () => {} }); counts.sent++; }
            continue;
          }
          const sub = { id: "trello-" + ci.id, text: ci.name || "…", parent: it.id, trello: { check: ci.id, checklist: ci.checklist, base: { name: ci.name, done: ci.done } } };
          if (ci.done) { sub.done = true; sub.doneAt = now; }
          const at = n.items.indexOf(kids.length ? kids[kids.length - 1] : it);
          n.items.splice(at + 1, 0, sub);
          kids.push(sub);
          counts.added++;
          continue;
        }
        const base = kid.trello.base || { name: ci.name, done: ci.done };
        const hereName = kid.text !== base.name, thereName = ci.name !== base.name;
        const hereDone = !!kid.done !== base.done, thereDone = ci.done !== base.done;
        const newer = Date.parse(card.dateLastActivity || 0) > Date.parse(kid.updatedAt || 0);
        const params = {};
        const nb = { ...base };
        if (thereName && (!hereName || newer)) { if (ci.name) kid.text = ci.name; nb.name = ci.name; } else if (hereName && cfg.send) params.name = kid.text; else nb.name = ci.name;
        if (thereDone && (!hereDone || newer)) {
          if (ci.done) { kid.done = true; kid.doneAt = now; } else { delete kid.done; delete kid.doneAt; if (T.reopen) T.reopen(n); }
          nb.done = ci.done;
        } else if (hereDone && cfg.send) params.state = kid.done ? "complete" : "incomplete"; else nb.done = ci.done;
        kid.trello = { ...kid.trello, checklist: ci.checklist, base: nb };
        if (Object.keys(params).length) {
          const noteId = n.id, kidId = kid.id;
          ops.push({ method: "PUT", path: "/cards/" + card.id + "/checkItem/" + ci.id, body: params, then: (res, d) => {
            const x = findItem(d, noteId, kidId);
            if (!x || !x.trello) return;
            x.trello.base = { ...x.trello.base, ...("name" in params ? { name: params.name } : {}), ...("state" in params ? { done: params.state === "complete" } : {}) };
          } });
          counts.sent++;
        }
      }
      // Gone from the card: gone here.
      const ids = new Set(there.map((c) => c.id));
      for (const kid of kids) if (kid.trello && kid.trello.check && !ids.has(kid.trello.check)) { n.items = n.items.filter((x) => x !== kid); counts.removed++; }
      // New here: new there, on the card's first checklist (made if none).
      const fresh = n.items.filter((x) => x.parent === it.id && !(x.trello && x.trello.check));
      if (fresh.length && cfg.send) {
        const noteId = n.id, cardId = card.id;
        let checklistId = (card.checklists[0] || {}).id;
        if (!checklistId) {
          ops.push({ method: "POST", path: "/cards/" + cardId + "/checklists", body: { name: "Checklist" }, then: (res) => { checklistId = res && res.id; } });
        }
        for (const kid of fresh) {
          const kidId = kid.id;
          const own = kid.trello && kid.trello.checklist && card.checklists.some((c) => c.id === kid.trello.checklist) ? kid.trello.checklist : "";
          ops.push({ method: "POST", path: () => (own || checklistId) && "/checklists/" + (own || checklistId) + "/checkItems", body: { name: kid.text, checked: !!kid.done, pos: "bottom" }, then: (res, d) => {
            const x = findItem(d, noteId, kidId);
            if (!x || !res || !res.id) return;
            x.trello = { check: res.id, checklist: own || checklistId, base: { name: x.text, done: !!x.done } };
            const p = findItem(d, noteId, x.parent);
            if (p && p.trello) p.trello.checks = [...new Set([...(p.trello.checks || []), res.id])];
          } });
          counts.sent++;
        }
      }
      it.trello.checks = n.items.filter((x) => x.parent === it.id && x.trello && x.trello.check).map((x) => x.trello.check);
      // Their checklists' names, for the card to show over each one's items.
      const named = card.checklists.map((c) => ({ id: c.id, name: text(c.name) }));
      if (named.length) it.trello.checklists = named; else delete it.trello.checklists;
    }

    for (const l of cfg.lists) {
      const n = noteOf.get(l.id);
      if (!n) continue;
      const cards = remote.lists[l.id];
      if (!cards) continue; // the list is gone, or didn't answer: left as it is
      const known = new Set(n.trello.cards);
      for (const card of cards) {
        if (!mineOk(card)) continue;
        const at = whereCard.get(card.id);
        if (at) {
          if (at.n !== n) { moveTo(at.n, n, at.it, l.id); at.n = n; counts.updated++; }
          oneCard(n, at.it, card);
        } else if (known.has(card.id)) {
          // Its task was deleted here: the card is archived, never deleted.
          if (cfg.send) { ops.push({ method: "PUT", path: "/cards/" + card.id, body: { closed: true }, then: () => {} }); counts.sent++; }
        } else {
          const it = itemFromCard(card, listsOf(n), remote.labels[card.idBoard], now, Array.isArray(n.trello.lists));
          it.trello.board = card.idBoard;
          n.items.push(it);
          whereCard.set(card.id, { n, it });
          checklist(n, it, card);
          counts.added++;
        }
      }
    }
    // Tasks whose card isn't on its list any more leave it, as in Trello
    // (Daniel, 2026-11-21: archived and moved cards stayed as ticked tasks).
    // Only one unticked here after it left stays, and its card comes back.
    // On a board's task list, "its list" is any of the board's brought in.
    for (const n of notes) {
      const lists = listsOf(n);
      for (const it of [...n.items]) {
        const id = it.trello && it.trello.card;
        if (!id || onLists.has(id) || it.parent) continue;
        if (!remote.lists[sectionOf(n, it)]) continue;
        if (it.done && it.trello.gone) { drop(n, it); continue; }
        if (!(id in remote.cards)) continue;
        const card = remote.cards[id];
        if (card === null) { drop(n, it); continue; }
        const onIt = lists.includes(card.idList);
        if (onIt && !card.closed && !mineOk(card)) { drop(n, it); continue; }
        const reopened = !it.done && it.trello.base && it.trello.base.done;
        if ((card.closed || !onIt) && !(reopened && cfg.send)) { drop(n, it); continue; }
        if (whereCard.get(id).n === n) oneCard(n, it, card);
      }
    }
    // New tasks here become cards, on their section's Trello list.
    if (cfg.send) {
      for (const n of notes) {
        const board = n.trello.board, onBoard = Array.isArray(n.trello.lists);
        for (const it of n.items) {
          if (it.trello || it.parent || it.done) continue;
          const listId = sectionOf(n, it);
          if (!remote.lists[listId]) continue;
          const noteId = n.id, itemId = it.id;
          const labels = remote.labels[board] || [];
          const byName = new Map(labels.filter((x) => text(x.name)).map((x) => [tagKey(Tags().cleanOne(x.name)), x.id]));
          const body = { idList: listId, name: it.text, pos: "bottom" };
          if (it.note) body.desc = it.note;
          const due = dueOf(it);
          if (due) body.due = due;
          const idLabels = (it.tags || []).map((t) => byName.get(tagKey(t))).filter(Boolean);
          if (idLabels.length) body.idLabels = idLabels;
          it.trello = { pending: true };
          ops.push({ method: "POST", path: "/cards", body, then: (res, d) => {
            const x = findItem(d, noteId, itemId);
            if (!x || !res || !res.id) return;
            if (onBoard) x.section = listId;
            x.trello = { card: res.id, board, base: localOf(x, labels, listId), checks: [] };
            const nn = d.notes.find((y) => y.id === noteId);
            if (nn && nn.trello) nn.trello.cards = [...new Set([...(nn.trello.cards || []), res.id])];
          }, failed: (d) => { const x = findItem(d, noteId, itemId); if (x && x.trello && x.trello.pending) delete x.trello; } });
          counts.sent++;
        }
      }
    }
    for (const n of notes) n.trello.cards = n.items.filter((x) => x.trello && x.trello.card).map((x) => x.trello.card);
    return { ops, counts };
  }

  // Which cards to ask about one by one: linked tasks whose card isn't on
  // its list, except done ones already known to be off it.
  function missingCards(data, cfgIn, lists) {
    const cfg = cleanConfig(cfgIn);
    const on = new Set();
    for (const id of Object.keys(lists)) for (const c of lists[id] || []) on.add(c.id);
    const out = [];
    const linkedIds = new Set(cfg.lists.map((l) => l.id));
    for (const n of data.notes || []) {
      if (!listsOf(n).some((id) => linkedIds.has(id))) continue;
      for (const it of n.items || []) {
        const id = it.trello && it.trello.card;
        if (!id || on.has(id) || it.parent) continue;
        if (!lists[sectionOf(n, it)]) continue;
        if (it.done && it.trello.gone) continue; // leaves without asking
        out.push(id);
      }
    }
    return out;
  }

  // ---------- the API ----------
  function client(cfg, fetchFn) {
    const f = fetchFn || ((...a) => fetch(...a));
    const auth = 'OAuth oauth_consumer_key="' + keyOf(cfg) + '", oauth_token="' + cfg.token + '"';
    async function call(method, path, body) {
      const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined;
      let res;
      try {
        res = await f(API + path, { method, headers: { Authorization: auth, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal });
      } catch (e) { throw new Error(i18n.t("Trello couldn't be reached")); }
      if (res.status === 404) return null;
      if (res.status === 401) { const e = new Error(i18n.t("Trello said no: get a new token")); e.signedOut = true; throw e; }
      if (!res.ok) throw new Error(i18n.t("Trello answered {status}", { status: res.status }));
      const t = await res.text();
      try { return t ? JSON.parse(t) : {}; } catch (e) { return {}; }
    }
    return { get: (p) => call("GET", p), send: call };
  }

  async function fetchRemote(api, data, cfg) {
    const remote = { lists: {}, cards: {}, labels: {}, doneList: {}, listNames: {}, boardLists: {} };
    await Promise.all(cfg.lists.map(async (l) => {
      const cards = await api.get("/lists/" + l.id + "/cards?fields=" + CARD_FIELDS + "&checklists=all&checklist_fields=name");
      remote.lists[l.id] = Array.isArray(cards) ? cards : null;
    }));
    const boards = [...new Set(cfg.lists.map((l) => l.board))];
    await Promise.all(boards.map(async (b) => {
      const labels = await api.get("/boards/" + b + "/labels?fields=name,color&limit=1000");
      remote.labels[b] = Array.isArray(labels) ? labels : [];
      // Its lists: their names now (a section follows a rename) and its Done list.
      const lists = await api.get("/boards/" + b + "/lists?fields=name&filter=open");
      if (Array.isArray(lists)) remote.boardLists[b] = lists.map((x) => x.id);
      for (const x of Array.isArray(lists) ? lists : []) remote.listNames[x.id] = text(x.name);
      const done = (Array.isArray(lists) ? lists : []).find((x) => isDoneName(x.name));
      remote.doneList[b] = done ? done.id : "";
    }));
    for (const id of missingCards(data, cfg, remote.lists).slice(0, 50)) {
      remote.cards[id] = await api.get("/cards/" + id + "?fields=" + CARD_FIELDS + "&checklists=all&checklist_fields=name");
    }
    return remote;
  }

  async function runOps(api, ops, data) {
    let done = 0;
    for (const op of ops) {
      const path = typeof op.path === "function" ? op.path() : op.path;
      if (!path) continue;
      try {
        const res = await api.send(op.method, path, op.body);
        op.then(res, data());
        done++;
      } catch (e) {
        if (op.failed) op.failed(data());
        if (e.signedOut) throw e;
      }
    }
    return done;
  }

  // The whole sync, pure but for the network, so the tests run it on a
  // fake Trello.
  // A picked list archived or deleted in Trello (not among its board's
  // open lists any more) stops syncing, and its tasks leave, as when it's
  // turned off here (Daniel, 2026-11-22: removed lists stayed). `gone` is
  // those lists, for the app to drop from Settings.
  async function syncData(getData, cfg, fetchFn) {
    cfg = cleanConfig(cfg);
    const api = client(cfg, fetchFn);
    const remote = await fetchRemote(api, getData(), cfg);
    const gone = cfg.lists.filter((l) => Array.isArray(remote.boardLists[l.board]) && !remote.boardLists[l.board].includes(l.id));
    if (gone.length) {
      const ids = new Set(gone.map((l) => l.id));
      cfg = { ...cfg, lists: cfg.lists.filter((l) => !ids.has(l.id)) };
      const data = getData();
      data.notes = (data.notes || []).filter((n) => { const own = listsOf(n); return !(own.length && own.every((id) => ids.has(id))); });
    }
    const { ops, counts } = reconcile(getData(), cfg, remote);
    return { ops, counts, gone, run: () => runOps(api, ops, getData), remote };
  }

  // ---------- in the app ----------
  const cfgNow = () => cleanConfig(state && state.data.settings && state.data.settings.trello);
  let running = null, lastStatus = "", lastSig = "", lastAt = 0, soon = null;
  const linkedSig = () => {
    const ids = new Set(cfgNow().lists.map((l) => l.id));
    return JSON.stringify((state.data.notes || []).filter((n) => listsOf(n).some((id) => ids.has(id))).map((n) => n.items));
  };

  function check(opts = {}) {
    if (running) return running.then(() => (opts.manual ? check(opts) : undefined));
    running = run(opts).finally(() => { running = null; paintSyncing(); });
    paintSyncing();
    return running;
  }
  // The badges' ring turns while a sync is going. Toggled in place, so a
  // sync doesn't re-render the Notebook; notes.js reads syncing() when it
  // builds a badge mid-sync.
  const syncing = () => !!running;
  function paintSyncing() {
    if (typeof document === "undefined") return;
    for (const b of document.querySelectorAll(".note-trello")) {
      b.classList.toggle("is-syncing", !!running);
      b.setAttribute("aria-busy", String(!!running));
    }
  }
  // Once a while has passed since the last one. Coming back to the app
  // and opening the Notebook both land here.
  function freshen() {
    if (!state || !connected(cfgNow()) || !cfgNow().lists.length) return;
    if (Date.now() - lastAt > AGAIN) check();
  }
  async function run({ manual } = {}) {
    const cfg = cfgNow();
    if (!connected(cfg)) { if (manual) toast(i18n.t("Sign in to Trello first"), true); return; }
    if (!cfg.lists.length) { if (manual) toast(i18n.t("Pick a Trello list to bring in first"), true); return; }
    if (whenSynced) await whenSynced();
    try {
      const sync = await syncData(() => state.data, cfg);
      if (sync.gone.length) {
        const ids = new Set(sync.gone.map((l) => l.id));
        const cur = cfgNow();
        cur.lists = cur.lists.filter((l) => !ids.has(l.id));
        state.data.settings.trello = cur;
        boardsCache = null;
      }
      afterDataChange();
      await persist();
      render();
      const sent = sync.ops.length ? await sync.run() : 0;
      if (sync.ops.length) { afterDataChange(); await persist(); render(); }
      lastSig = linkedSig();
      lastAt = Date.now();
      lastStatus = i18n.t("Synced {time}", { time: new Date().toLocaleTimeString(i18n.lang || [], { hour: "2-digit", minute: "2-digit" }) });
      const c = sync.counts;
      const said = [c.added && i18n.t("{n} new", { n: c.added }), c.updated && i18n.t("{n} changed", { n: c.updated }), c.removed && i18n.t("{n} removed", { n: c.removed }), sent && i18n.t("{n} sent", { n: sent })].filter(Boolean);
      if (manual) toast(said.length ? i18n.t("Trello: {what}", { what: said.join(", ") }) : i18n.t("Trello is up to date"));
    } catch (e) {
      lastStatus = e.message || i18n.t("Trello couldn't be reached");
      if (manual || e.signedOut) toast(lastStatus, true);
    }
    paintStatus();
  }

  // After a save: when a linked list changed here, its changes go to Trello
  // a few seconds later (one request for a burst of ticks).
  function changed() {
    if (!state || !connected(cfgNow()) || !cfgNow().lists.length) return;
    clearTimeout(soon);
    soon = setTimeout(() => { if (linkedSig() !== lastSig) check(); }, 4000);
  }

  let timer = null;
  function start() {
    if (window.LifeLogPlatform && window.LifeLogPlatform.headless) return;
    check();
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const shown = document.visibilityState === "visible";
      if (shown || (window.LifeLogPlatform && window.LifeLogPlatform.desktop && Date.now() - lastAt > TRAY_EVERY)) check();
    }, EVERY);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") freshen(); });
    window.addEventListener("focus", freshen);
    window.addEventListener("online", freshen);
  }

  // The Notebook's bulk bar: Sync now, and Remove, which takes synced lists
  // out of LifeLog and stops syncing them. Their cards stay on Trello.
  // Undo puts both back.
  function syncedIn(ids) {
    return (state.data.notes || []).filter((n) => ids.has(n.id) && linked(n));
  }
  async function unlink(notes) {
    if (!notes.length) return;
    const cur = cfgNow();
    const listIds = new Set(notes.flatMap(listsOf));
    const was = cur.lists.filter((l) => listIds.has(l.id));
    cur.lists = cur.lists.filter((l) => !listIds.has(l.id));
    const gone = (state.data.notes || []).filter((x) => listsOf(x).some((id) => listIds.has(id)));
    state.data.notes = state.data.notes.filter((x) => !gone.includes(x));
    await save(cur);
    paintStatus();
    render();
    toast(i18n.tn(gone.length, "Removed {n} list. It stays on Trello", "Removed {n} lists. They stay on Trello"), false, { label: i18n.t("Undo"), onClick: async () => {
      const c2 = cfgNow();
      c2.lists = [...c2.lists, ...was.filter((l) => !c2.lists.some((x) => x.id === l.id))];
      const ids = new Set((state.data.notes || []).map((x) => x.id));
      state.data.notes = [...gone.filter((x) => !ids.has(x.id)), ...(state.data.notes || [])];
      await save(c2);
      paintStatus();
      render();
    } });
  }

  // ---------- Settings › Connections › Trello ----------
  async function save(c) {
    state.data.settings.trello = c;
    afterDataChange();
    await persist();
  }

  function status() {
    const c = cfgNow();
    if (!connected(c)) return { text: i18n.t("Not connected") };
    const who = c.member && c.member.username ? "@" + c.member.username : i18n.t("Signed in");
    const n = c.lists.length;
    return { text: who + " · " + (n ? i18n.tn(n, "{n} list", "{n} lists") : i18n.t("No lists picked")) + (c.send ? "" : " · " + i18n.t("read only")) };
  }

  function paintStatus() {
    const s = $ && $("#trelloState");
    if (!s) return;
    const c = cfgNow();
    s.textContent = !keyOf(c) ? i18n.t("Needs an API key below") : !c.token ? i18n.t("Not connected") : (c.member && c.member.username ? i18n.t("Signed in as {name}", { name: "@" + c.member.username }) : i18n.t("Signed in")) + (lastStatus ? " · " + lastStatus : "");
    const row = document.querySelector('[data-conn-status="trello"]');
    if (row) row.textContent = status().text;
  }

  let boardsCache = null;
  // A board's group: Bring in this board, One task list for the board, then
  // its lists, each with its own switch. While the board is one task list
  // its Done list has none: ticked tasks go there (Daniel, 2026-11-22).
  async function paintLists(fresh) {
    const box = $("#trelloLists");
    if (!box) return;
    const c = cfgNow();
    if (!connected(c)) { box.replaceChildren(el("p", "dsc-note", i18n.t("Sign in to see your boards."))); return; }
    if (!boardsCache || fresh) {
      box.replaceChildren(el("p", "dsc-note", i18n.t("Loading your boards…")));
      try {
        const boards = await client(c).get("/members/me/boards?filter=open&fields=name&lists=open&list_fields=name");
        boardsCache = Array.isArray(boards) ? boards : [];
      } catch (e) {
        box.replaceChildren(el("p", "dsc-note", e.message));
        return;
      }
    }
    box.replaceChildren();
    const on = new Set(c.lists.map((l) => l.id));
    // A list you picked that's gone from Trello stays here so you can turn it off.
    const missing = c.lists.filter((l) => !boardsCache.some((b) => (b.lists || []).some((x) => x.id === l.id)));
    const groups = boardsCache.map((b) => ({ name: b.name, id: b.id, lists: (b.lists || []).map((x) => ({ id: x.id, name: x.name, board: b.id, boardName: b.name })) }));
    if (missing.length) groups.push({ name: i18n.t("Not found on Trello"), lists: missing.map((l) => ({ id: l.id, name: [l.boardName, l.name].filter(Boolean).join(" · "), board: l.board, boardName: l.boardName, gone: true })) });
    if (!groups.length) { box.appendChild(el("p", "dsc-note", i18n.t("No open boards on this Trello account."))); return; }
    const notes = () => state.data.notes || [];
    const openIn = (pred) => notes().reduce((sum, n) => sum + (n.items || []).filter((x) => !x.done && !x.parent && pred(n, x)).length, 0);
    const row = (title, sub, sw, cls = "") => {
      const r = el("label", "sitem toggle-label" + cls);
      const t = el("span", "sitem-text");
      t.appendChild(el("span", "sitem-title", title));
      if (sub) t.appendChild(el("span", "sitem-sub", sub));
      r.append(t, sw);
      return r;
    };
    const switchEl = (checked, label, onchange) => {
      const sw = el("input", "switch");
      sw.type = "checkbox";
      sw.checked = checked;
      if (label) sw.setAttribute("aria-label", label);
      sw.onchange = () => onchange(sw.checked);
      return sw;
    };
    // Lists in the order the board has them, so sections keep that order.
    const ordered = (lists) => {
      const pos = new Map();
      for (const g of groups) g.lists.forEach((l, i) => pos.set(l.id, i));
      return [...lists].sort((a, b) => (a.board === b.board ? (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9) : 0));
    };
    // Turning lists off takes their tasks out of the Notebook too (Daniel,
    // 2026-11-21: a kept copy read as a duplicate); Undo puts them back.
    async function setLists(add, remove, label) {
      const cur = cfgNow();
      const was = { lists: cur.lists, notes: notes() };
      const drop = new Set(remove.map((l) => l.id));
      cur.lists = ordered([...cur.lists.filter((x) => !drop.has(x.id)), ...add.filter((l) => !cur.lists.some((x) => x.id === l.id)).map((l) => ({ id: l.id, name: l.name, board: l.board, boardName: l.boardName }))]);
      let took = false;
      if (drop.size) {
        const keep = new Set(cur.lists.map((l) => l.id));
        state.data.notes = notes().flatMap((n) => {
          const own = listsOf(n);
          if (!own.some((id) => drop.has(id))) return [n];
          took = true;
          if (!own.some((id) => keep.has(id))) return [];
          const gone = new Set(n.items.filter((x) => !x.parent && drop.has(sectionOf(n, x))).map((x) => x.id));
          return [{ ...n, items: n.items.filter((x) => !gone.has(x.id) && !gone.has(x.parent)) }];
        });
      }
      await save(cur);
      paintStatus();
      if (add.length) await check({ manual: true });
      paintLists();
      if (took) render();
      if (drop.size) toast(i18n.t("Stopped syncing {name}", { name: label }), false, { label: i18n.t("Undo"), onClick: async () => {
        const c2 = cfgNow();
        c2.lists = was.lists;
        // Only the synced task lists go back as they were: anything else
        // changed since stays.
        state.data.notes = [...was.notes.filter((n) => n.trello), ...notes().filter((n) => !n.trello)];
        await save(c2);
        paintStatus();
        paintLists();
        render();
      } });
    }
    async function setTogether(board, whole) {
      const cur = cfgNow();
      cur.split = whole ? cur.split.filter((b) => b !== board) : [...new Set([...cur.split, board])];
      await save(cur);
      await check({ manual: true });
      paintLists();
      render();
    }
    for (const g of groups) {
      if (!g.lists.length) continue;
      box.appendChild(el("h3", "sgroup-label", g.name));
      const card = el("div", "sgroup-card");
      const whole = !g.gone && g.id && together(c, g.id);
      const isDone = (l) => g.id && whole && isDoneName(l.name);
      const picks = g.lists.filter((l) => !isDone(l));
      const anyOn = g.lists.some((l) => on.has(l.id));
      if (g.id) {
        const sub = anyOn ? (whole ? i18n.tn(openIn((n) => n.trello && n.trello.board === g.id), "One task list in the Notebook · {n} open", "One task list in the Notebook · {n} open")
          : i18n.t("A task list for each list")) : "";
        card.appendChild(row(i18n.t("Bring in this board"), sub, switchEl(anyOn, i18n.t("Bring in {name}", { name: g.name }), (v) =>
          v ? setLists(g.lists.filter((l) => !isDoneName(l.name)), [], g.name) : setLists([], g.lists.filter((l) => on.has(l.id)), g.name))));
        if (anyOn) card.appendChild(row(i18n.t("One task list for the board"), whole ? i18n.t("Its lists are sections in it") : i18n.t("Off: a task list for each list"),
          switchEl(whole, null, (v) => setTogether(g.id, v))));
      }
      for (const l of g.lists) {
        if (g.id && !anyOn) break;
        const cls = g.id ? " sitem-nested" : "";
        if (isDone(l)) {
          const r = el("div", "sitem" + cls);
          const t = el("span", "sitem-text");
          t.append(el("span", "sitem-title", l.name), el("span", "sitem-sub", i18n.t("Ticked tasks move here")));
          r.appendChild(t);
          card.appendChild(r);
          continue;
        }
        let sub = "";
        if (on.has(l.id)) {
          const has = notes().some((n) => listsOf(n).includes(l.id));
          sub = has ? i18n.tn(openIn((n, x) => listsOf(n).includes(l.id) && sectionOf(n, x) === l.id), "{n} open", "{n} open") : i18n.t("Comes in at the next sync");
        }
        card.appendChild(row(l.name, sub, switchEl(on.has(l.id), null, (v) => (v ? setLists([l], [], l.name) : setLists([], [l], l.name))), cls));
      }
      box.appendChild(card);
    }
  }

  function renderSettings() {
    if (!$ || !$("#trelloToken")) return;
    const c = cfgNow();
    $("#trelloKey").value = c.key;
    $("#trelloToken").value = c.token;
    $("#trelloTokenLink").href = authorizeUrl(keyOf(c));
    $("#trelloTokenLink").toggleAttribute("aria-disabled", !keyOf(c));
    $("#trelloKeyRow").hidden = !!APP_KEY && !c.key;
    $("#trelloTick").value = c.tick;
    $("#trelloSend").checked = c.send;
    $("#trelloMine").checked = c.mine;
    $("#trelloSignOutBtn").hidden = !c.token;
    $("#trelloSyncBtn").hidden = !connected(c);
    paintStatus();
    paintLists();
  }

  async function signIn() {
    const c = cfgNow();
    c.token = $("#trelloToken").value.trim();
    if (!c.token) { c.member = null; c.connectedAt = ""; await save(c); renderSettings(); return; }
    if (!keyOf(c)) { toast(i18n.t("Add the API key first"), true); return; }
    try {
      const me = await client(c).get("/members/me?fields=username,fullName");
      if (!me || !isId(me.id)) throw new Error(i18n.t("Trello didn't say who you are"));
      c.member = { id: me.id, username: text(me.username), fullName: text(me.fullName) };
      c.connectedAt = c.connectedAt || new Date().toISOString();
      await save(c);
      boardsCache = null;
      renderSettings();
      toast(i18n.t("Signed in to Trello as {name}", { name: "@" + c.member.username }));
    } catch (e) {
      lastStatus = e.message;
      await save(c);
      renderSettings();
      toast(e.message, true);
    }
  }

  function wire() {
    if (!$ || !$("#trelloToken")) return;
    $("#trelloKey").onchange = async () => {
      const c = cfgNow();
      c.key = $("#trelloKey").value.trim();
      await save(c);
      renderSettings();
    };
    $("#trelloTokenLink").onclick = (ev) => {
      if (!keyOf(cfgNow())) { ev.preventDefault(); toast(i18n.t("Add the API key first"), true); }
    };
    $("#trelloToken").onchange = signIn;
    $("#trelloSyncBtn").onclick = () => check({ manual: true });
    $("#trelloTick").onchange = async () => { const c = cfgNow(); c.tick = $("#trelloTick").value; await save(c); };
    $("#trelloSend").onchange = async () => { const c = cfgNow(); c.send = $("#trelloSend").checked; await save(c); paintStatus(); };
    $("#trelloMine").onchange = async () => { const c = cfgNow(); c.mine = $("#trelloMine").checked; await save(c); check({ manual: true }); };
    $("#trelloSignOutBtn").onclick = async () => {
      const c = cfgNow();
      c.token = ""; c.member = null; c.connectedAt = "";
      boardsCache = null; lastStatus = "";
      await save(c);
      renderSettings();
      toast(i18n.t("Signed out of Trello. Your task lists stay"));
    };
  }

  // Whether a note is a list that's syncing with Trello now (its badge).
  // A list has no page of its own on Trello, so its board's.
  function open(n) {
    const board = n && n.trello && n.trello.board;
    if (!/^[0-9a-f]{24}$/i.test(String(board || ""))) return false;
    const url = "https://trello.com/b/" + board;
    const P = window.LifeLogPlatform;
    if (P && P.openOutside) return P.openOutside(url);
    window.open(url, "_blank", "noopener");
    return true;
  }
  function linked(n) {
    if (!n || !n.trello || !state) return false;
    const c = cfgNow();
    const own = listsOf(n);
    return connected(c) && c.lists.some((l) => own.includes(l.id));
  }

  const api = {
    init, wire, start, check, changed, renderSettings, status, linked, syncing, freshen, syncedIn, unlink,
    // pure, for tests and the bridge
    APP_KEY, DEFAULTS, cleanConfig, authorizeUrl, dueOf, fromDue, reconcile, missingCards, client, syncData, connected, open,
  };
  if (typeof window !== "undefined") window.LifeLogTrello = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
