// LifeLog — tasks: a checklist's items, grown up (Nov 2026).
//
// A checklist is still a list note (kind "list") and its items are still
// { id, text, done?, doneAt?, updatedAt? }. A task is an item with any of
// these set, each absent unless used:
//   note       its description (Markdown, like a note)
//   priority   1 high, 2 medium, 3 low
//   date       "YYYY-MM-DD", the day you plan to do it
//   time       "HH:MM", only with a date; without one it's all day
//   repeat     { every, unit: day|week|month|year, days?, fromDone? }, only
//              with a date. `days` (weekdays, 0 = Sunday) for a weekly one
//              on certain days; `fromDone` counts the next date from the
//              day it's ticked rather than from its date (watering).
//   remind     minutes before its date and time (an all-day task counts
//              from 09:00 that day), only with a date
//   deadline   "YYYY-MM-DD", the day it must be done by
//   parent     the id of the task it sits under: one level, never deeper
//   category   a note category of its own; none means its task's, then
//              its list's
//   ticks      when a repeating task was ticked, oldest first. Kept and
//              not shown (Daniel, 15 Nov 2026), so anything wanting the
//              history later has it.
// Subtasks are flat items with `parent`, not a nested array: merge.js
// merges a list's items one by one by id, and the widget, the bridge, Copy
// text and search all walk one array.
//
// This file is the data side (sanitizer, repeats, ticking, what's due) and
// the task sheet with its Date sheet. The rows on a list's card stay in
// notes.js with the rest of the card.
(function () {
  const Dates = () => (typeof window !== "undefined" && window.LifeLogDates) || require("./dates.js");
  const ico = (n, c) => window.LifeLogIcons.svg(n, c);

  // ---------- data ----------
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00").getTime());
  const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const pad = (n) => String(n).padStart(2, "0");
  const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function addDays(day, n) {
    const d = new Date(day + "T00:00:00");
    d.setDate(d.getDate() + n);
    return localDay(d);
  }
  const dow = (day) => new Date(day + "T00:00:00").getDay();
  const daysBetween = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
  // A month on, keeping the day: the 31st falls on the 30th in a short
  // month and comes back to the 31st after it.
  function addMonths(day, n, anchor) {
    const y = +day.slice(0, 4), m = +day.slice(5, 7) - 1 + n;
    const ny = y + Math.floor(m / 12), nm = ((m % 12) + 12) % 12;
    const last = new Date(ny, nm + 1, 0).getDate();
    return `${ny}-${pad(nm + 1)}-${pad(Math.min(anchor, last))}`;
  }

  const UNITS = ["day", "week", "month", "year"];
  const MAX_TICKS = 500;
  const MAX_REMIND = 7 * 24 * 60;
  function cleanRepeat(r) {
    if (!r || typeof r !== "object" || !UNITS.includes(r.unit)) return null;
    const out = { ...r, every: Math.min(999, Math.max(1, Math.round(+r.every) || 1)), unit: r.unit };
    const days = r.unit === "week" && Array.isArray(r.days)
      ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [];
    if (days.length) out.days = days; else delete out.days;
    if (r.fromDone) out.fromDone = true; else delete out.fromDone;
    return out;
  }
  // Cleans the task fields of one item in place and returns it. Keys keep
  // their places (merge compares items as JSON); a field that doesn't hold
  // up is dropped rather than guessed at.
  function cleanItem(it) {
    const drop = (k) => { delete it[k]; };
    if (it.note != null) { const v = String(it.note); if (v.trim()) it.note = v; else drop("note"); }
    if (it.priority != null) { const p = Math.round(+it.priority); if (p >= 1 && p <= 3) it.priority = p; else drop("priority"); }
    if (it.date != null && !isDay(it.date)) drop("date");
    if (it.time != null && !(it.date && isTime(it.time))) drop("time");
    if (it.repeat != null) { const r = it.date ? cleanRepeat(it.repeat) : null; if (r) it.repeat = r; else drop("repeat"); }
    if (it.remind != null) { const m = Math.round(+it.remind); if (it.date && m >= 0 && m <= MAX_REMIND) it.remind = m; else drop("remind"); }
    if (it.deadline != null && !isDay(it.deadline)) drop("deadline");
    if (it.parent != null) { const p = String(it.parent); if (p && p !== it.id) it.parent = p; else drop("parent"); }
    if (it.category != null) { const c = String(it.category).trim(); if (c) it.category = c; else drop("category"); }
    if (it.ticks != null) {
      const t = Array.isArray(it.ticks) ? it.ticks.filter((x) => typeof x === "string" && x) : [];
      if (t.length) it.ticks = t.slice(-MAX_TICKS); else drop("ticks");
    }
    return it;
  }
  // One level: a parent has to be an item in the same list that isn't
  // itself a subtask. Anything else (its task deleted on another device, a
  // hand edit) comes back to the top level rather than vanishing.
  function cleanParents(items) {
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const it of items) {
      if (!it.parent) continue;
      const p = byId.get(it.parent);
      if (!p || p.parent || p === it) delete it.parent;
    }
    return items;
  }
  const isTask = (it) => ["note", "priority", "date", "deadline", "parent", "category"].some((k) => it[k] != null);
  const childrenOf = (items, id) => (items || []).filter((i) => i.parent === id);

  // ---------- repeats ----------
  // The next date after `day` by the rule, once.
  function stepOnce(day, rep, anchor) {
    const every = rep.every || 1;
    if (rep.unit === "day") return addDays(day, every);
    if (rep.unit === "month") return addMonths(day, every, anchor);
    if (rep.unit === "year") return addMonths(day, 12 * every, anchor);
    if (!rep.days || !rep.days.length) return addDays(day, 7 * every);
    // Certain weekdays, every N weeks: the next listed weekday in this week,
    // else the first one in the week N on.
    const ws = Dates().weekStart();
    const weekOf = (d) => addDays(d, -((dow(d) - ws + 7) % 7));
    const home = weekOf(day);
    for (let i = 1; i <= 7 * every + 7; i++) {
      const d = addDays(day, i);
      const weeks = daysBetween(home, weekOf(d)) / 7;
      if (rep.days.includes(dow(d)) && (weeks === 0 || weeks % every === 0)) return d;
    }
    return addDays(day, 7 * every);
  }
  // Where a repeating task goes when it's ticked on `today`. From its date
  // it skips the ones missed, so a chore left a week doesn't come back as
  // overdue; from the tick it counts from today.
  function nextDate(it, today) {
    const rep = it.repeat;
    if (!rep) return null;
    const from = rep.fromDone || !it.date ? today : it.date;
    const anchor = +(it.date || today).slice(8, 10);
    let d = stepOnce(from, rep, anchor);
    for (let guard = 0; d <= today && guard < 5000; guard++) d = stepOnce(d, rep, anchor);
    return d;
  }

  // ---------- ticking ----------
  // Ticks or unticks one item of a list note, in place. A repeating task
  // isn't finished by a tick: its date moves on (its deadline with it), its
  // subtasks untick for the next round, and the tick is kept in `ticks`.
  // Ticking a task with open subtasks ticks them too.
  // Returns { next } (the new date of a repeating one) or null.
  function tick(n, itemId, done, now = new Date(), today = localDay(now)) {
    const items = n.items || [];
    const it = items.find((i) => i.id === itemId);
    if (!it) return null;
    const iso = now.toISOString();
    if (!done) { delete it.done; delete it.doneAt; return { next: null }; }
    if (it.repeat && it.date && !it.done) {
      const next = nextDate(it, today);
      if (it.deadline) it.deadline = addDays(it.deadline, daysBetween(it.date, next));
      it.date = next;
      it.ticks = (it.ticks || []).concat(iso).slice(-MAX_TICKS);
      for (const c of childrenOf(items, it.id)) { delete c.done; delete c.doneAt; }
      return { next };
    }
    it.done = true;
    it.doneAt = iso;
    for (const c of childrenOf(items, it.id)) if (!c.done) { c.done = true; c.doneAt = iso; }
    return { next: null };
  }

  // ---------- what's due ----------
  // Every open task with a date up to `until`, overdue ones included, with
  // the list it's in and the category it shows: its own, else its task's,
  // else its list's.
  function categoryOf(n, it) {
    if (it.category) return it.category;
    if (it.parent) { const p = (n.items || []).find((i) => i.id === it.parent); if (p && p.category) return p.category; }
    return n.category || "";
  }
  function dueTasks(data, until) {
    const rows = [];
    for (const n of data.notes || []) {
      if (n.kind !== "list") continue;
      for (const it of n.items || []) {
        if (it.done || !isDay(it.date) || (until && it.date > until)) continue;
        rows.push({ note: n, item: it, day: it.date, category: categoryOf(n, it) });
      }
    }
    return rows.sort((a, b) => a.day.localeCompare(b.day) || (a.item.time || "99").localeCompare(b.item.time || "99")
      || (a.item.priority || 4) - (b.item.priority || 4));
  }
  // The moment a reminder rings, as a Date, or null.
  function remindAt(it) {
    if (it.remind == null || !isDay(it.date)) return null;
    const at = new Date(it.date + "T" + (it.time || "09:00") + ":00");
    return new Date(at.getTime() - it.remind * 60000);
  }

  // ---------- words ----------
  const PRIORITY_NAMES = { 1: "High", 2: "Medium", 3: "Low" };
  function shortDay(day, today) {
    if (day === today) return "Today";
    if (day === addDays(today, 1)) return "Tomorrow";
    if (day === addDays(today, -1)) return "Yesterday";
    const D = Dates();
    if (day > today && day <= addDays(today, 6)) return D.WEEKDAYS[dow(day)];
    return D.day(day, { year: "auto", weekday: day > today && day <= addDays(today, 13) });
  }
  function repeatText(rep) {
    if (!rep) return "Never";
    const D = Dates();
    const n = rep.every || 1;
    const many = (u) => (n === 1 ? "Every " + u : `Every ${n} ${u}s`);
    let s;
    if (rep.unit === "week" && rep.days && rep.days.length) {
      const work = D.workDays();
      const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
      const names = same(rep.days, [...work].sort((a, b) => a - b)) ? "weekday" : D.weekOrder().filter((d) => rep.days.includes(d)).map((d) => D.WEEKDAYS[d]).join(", ");
      s = n === 1 ? "Every " + names : `Every ${n} weeks on ${names}`;
    } else s = many(rep.unit);
    return s + (rep.fromDone ? ", from when ticked" : "");
  }
  function remindText(it) {
    const m = it.remind;
    if (m == null) return "";
    if (!it.time) return m === 0 ? "On the day" : m === 1440 ? "The day before" : m % 1440 === 0 ? m / 1440 + " days before" : minutesText(m) + " before 09:00";
    return m === 0 ? "At the time" : minutesText(m) + " before";
  }
  const minutesText = (m) => (m % 1440 === 0 ? (m / 1440 === 1 ? "1 day" : m / 1440 + " days") : m % 60 === 0 ? (m / 60 === 1 ? "1 hour" : m / 60 + " hours") : m + " min");
  // The Date row's one line: "Today 18:00 · Every week · 30 min before".
  function dateSummary(it, today) {
    if (!it.date) return it.deadline ? "Deadline " + shortDay(it.deadline, today) : "";
    return [shortDay(it.date, today) + (it.time ? " " + it.time : ""), it.repeat ? repeatText(it.repeat) : "", remindText(it),
      it.deadline ? "deadline " + shortDay(it.deadline, today) : ""].filter(Boolean).join(" · ");
  }
  // Copy text's lines for a list: subtasks indented, dates in brackets.
  function listLines(items, today) {
    const lines = [];
    const line = (i, depth) => {
      const when = i.date ? ` (${shortDay(i.date, today)}${i.time ? " " + i.time : ""})` : "";
      lines.push(`${"  ".repeat(depth)}- [${i.done ? "x" : " "}] ${String(i.text || "").trim()}${when}`);
    };
    const ids = new Set((items || []).map((i) => i.id));
    for (const i of items || []) {
      if (!String(i.text || "").trim() || (i.parent && ids.has(i.parent))) continue;
      line(i, 0);
      for (const c of childrenOf(items, i.id)) if (String(c.text || "").trim()) line(c, 1);
    }
    return lines;
  }

  // ---------- the task sheet ----------
  let state, $, el, uid, toast, persist, render;
  let modeEnabled = () => false;
  function init(ctx) { ({ state, $, el, uid, toast, persist, render } = ctx); if (ctx.modeEnabled) modeEnabled = ctx.modeEnabled; }
  const Notes = () => window.LifeLogNotes;
  let cur = null; // { noteId, itemId }
  const findNote = (id) => (state.data.notes || []).find((n) => n.id === id && n.kind === "list");
  function current() {
    if (!cur) return {};
    const n = findNote(cur.noteId);
    const it = n && (n.items || []).find((i) => i.id === cur.itemId);
    return it ? { n, it } : {};
  }
  const catColor = (name) => ((Notes().noteCats() || []).find((c) => c.name === name) || {}).color || "";
  const isOpen = () => !$("#taskModal").hidden;

  function openTask(noteId, itemId) {
    cur = { noteId, itemId };
    if (!current().it) { cur = null; return; }
    $("#taskMoreMenu").hidden = true;
    $("#taskLogBtn").hidden = !(window.LifeLogJournal && modeEnabled("timeline", "entries"));
    fill();
    $("#taskModal").hidden = false;
    $("#taskModal .nv-scroll").scrollTop = 0;
    fitText();
  }
  // Grows the title and description with what's in them.
  function fitText() {
    for (const t of [$("#taskText"), $("#taskNote")]) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
  }
  function fill() {
    const { n, it } = current();
    if (!it) { closeTask(); return; }
    const parent = it.parent && n.items.find((i) => i.id === it.parent);
    const today = api.today();
    // A subtask's sheet goes back to its task; a task's moves between lists.
    const close = $("#taskCloseBtn");
    close.replaceChildren(ico(parent ? "chevron-left" : "x"));
    close.title = parent ? "Back to " + parent.text : "Close";
    close.setAttribute("aria-label", close.title);
    $("#taskListChip").hidden = !!parent;
    $("#taskCrumb").hidden = !parent;
    if (parent) {
      $("#taskCrumbText").textContent = (n.text || "Untitled list") + " › " + parent.text;
      $("#taskCrumb .dot").style.background = n.category ? catColor(n.category) : "";
    } else fillLists(n);
    const tick = $("#taskTick");
    tick.checked = !!it.done;
    tick.className = "todo-check" + (it.priority ? " is-p" + it.priority : "");
    tick.setAttribute("aria-label", it.done ? "Mark as not done" : "Mark as done");
    if (document.activeElement !== $("#taskText")) $("#taskText").value = it.text;
    if (document.activeElement !== $("#taskNote")) $("#taskNote").value = it.note || "";
    fillCategory(n, it, parent);
    $("#taskPriority").value = it.priority ? String(it.priority) : "";
    const when = dateSummary(it, today);
    const val = $("#taskDateValue");
    val.textContent = when || "Add";
    val.classList.toggle("is-today", it.date === today && !it.done);
    val.classList.toggle("is-late", !!it.date && it.date < today && !it.done);
    val.classList.toggle("is-empty", !when);
    $("#taskSubs").hidden = !!parent;
    if (!parent) fillSubs(n, it);
  }
  function fillLists(n) {
    const sel = $("#taskList");
    sel.innerHTML = "";
    for (const l of (state.data.notes || []).filter((x) => x.kind === "list")) {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.text || "Untitled list";
      sel.appendChild(o);
    }
    sel.value = n.id;
    $("#taskListChip .dot").style.background = n.category ? catColor(n.category) : "";
  }
  function fillCategory(n, it, parent) {
    const sel = $("#taskCategory");
    sel.innerHTML = "";
    const from = parent && (parent.category || n.category) ? [parent.category || n.category, parent.category ? "its task" : "its list"]
      : n.category ? [n.category, "its list"] : null;
    const opt = (v, label) => { const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o); };
    opt("", from ? `${from[0]}, from ${from[1]}` : "None");
    for (const c of Notes().noteCats()) opt(c.name, c.name);
    sel.value = it.category && Notes().noteCats().some((c) => c.name === it.category) ? it.category : "";
    const shown = it.category || (from && from[0]) || "";
    $("#taskCatDot").style.background = shown ? catColor(shown) : "";
    $("#taskCatDot").hidden = !shown;
  }

  // The subtasks: tick, open, drag by the handle (arrow keys on a computer).
  function fillSubs(n, it) {
    const kids = childrenOf(n.items, it.id);
    $("#taskSubsHead").textContent = kids.length ? `Subtasks ${kids.filter((c) => c.done).length}/${kids.length}` : "Subtasks";
    const wrap = $("#taskSubList");
    wrap.replaceChildren();
    wrap.hidden = !kids.length;
    const today = api.today();
    kids.forEach((c, i) => {
      const row = el("div", "todo-row task-sub" + (c.done ? " is-done" : ""));
      row.dataset.item = c.id;
      const grip = el("button", "note-list-grip");
      grip.type = "button";
      grip.appendChild(ico("grip-vertical"));
      grip.setAttribute("aria-label", "Move " + c.text + " — drag, or use the arrow keys");
      wireGrip(grip, row, i);
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "todo-check" + (c.priority ? " is-p" + c.priority : "");
      cb.checked = !!c.done;
      cb.setAttribute("aria-label", (c.done ? "Mark as not done: " : "Mark as done: ") + c.text);
      cb.onchange = () => tickOne(c.id, cb.checked);
      const body = el("button", "todo-body");
      body.type = "button";
      body.appendChild(el("span", "todo-text", c.text));
      const when = c.date ? shortDay(c.date, today) + (c.time ? " " + c.time : "") : "";
      if (when || c.note) {
        const meta = el("span", "todo-meta");
        if (when) { const b = el("span", !c.done && c.date < today ? "is-late" : c.date === today ? "is-today" : ""); b.append(ico("calendar"), document.createTextNode(when)); meta.appendChild(b); }
        if (c.note) { const b = el("span"); b.appendChild(ico("text")); meta.appendChild(b); }
        body.appendChild(meta);
        row.classList.add("has-meta");
      }
      body.setAttribute("aria-label", "Open " + c.text);
      body.onclick = () => { commitText(); cur = { noteId: n.id, itemId: c.id }; fill(); $("#taskModal .nv-scroll").scrollTop = 0; fitText(); };
      row.append(grip, cb, body);
      wrap.appendChild(row);
    });
    $("#taskSubHint").hidden = kids.length < 2;
  }
  function wireGrip(grip, row, i) {
    const wrap = $("#taskSubList");
    const save = () => moveSubs([...wrap.children].map((r) => r.dataset.item));
    grip.onkeydown = (ev) => {
      const rows = [...wrap.children];
      const to = ev.key === "ArrowUp" ? i - 1 : ev.key === "ArrowDown" ? i + 1 : -1;
      if (to < 0 || to >= rows.length) return;
      ev.preventDefault();
      wrap.insertBefore(row, to < i ? rows[to] : rows[to].nextSibling);
      save();
      const again = wrap.querySelector(`[data-item="${CSS.escape(row.dataset.item)}"] .note-list-grip`);
      if (again) again.focus();
    };
    grip.onpointerdown = (ev) => {
      if (ev.button > 0) return;
      ev.preventDefault();
      grip.setPointerCapture(ev.pointerId);
      row.classList.add("is-dragging");
      let startY = ev.clientY;
      const move = (e) => {
        const y = e.clientY;
        const others = [...wrap.children].filter((r) => r !== row);
        const before = others.find((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
        if ((before || null) !== row.nextElementSibling) {
          const top = row.offsetTop;
          row.style.transform = "";
          wrap.insertBefore(row, before || null);
          startY += row.offsetTop - top;
        }
        row.style.transform = "translateY(" + (y - startY) + "px)";
      };
      const end = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", end);
        grip.removeEventListener("pointercancel", end);
        row.classList.remove("is-dragging");
        row.style.transform = "";
        save();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);
    };
  }
  // The subtasks in their new order, each still right after its task.
  function moveSubs(order) {
    change((it, n) => {
      const byId = new Map(n.items.map((i) => [i.id, i]));
      const moved = order.map((id) => byId.get(id)).filter(Boolean);
      if (moved.every((c, k) => c === childrenOf(n.items, it.id)[k])) return false;
      const rest = n.items.filter((i) => !moved.includes(i));
      rest.splice(rest.indexOf(it) + 1, 0, ...moved);
      n.items = rest;
    }, { onTask: "parent" });
  }

  // Every change goes through here: the words typed so far are kept, the
  // change is made on the item as it is now (a sync may have replaced it),
  // and the list is drawn and saved. `fn` returning false changes nothing.
  async function change(fn, { edited = true, onTask } = {}) {
    const typed = commitText(false);
    let { n, it } = current();
    if (!it) return;
    if (onTask === "parent" && it.parent) it = n.items.find((i) => i.id === it.parent) || it;
    const out = fn(it, n);
    if (out === false && !typed) { fill(); return; }
    if (edited) n.editedAt = new Date().toISOString();
    fill();
    render();
    await persist();
  }
  // The title and description as typed, onto the item. True when they
  // changed; `save` draws and saves too (closing the sheet).
  function commitText(save = true) {
    const { n, it } = current();
    if (!it) return false;
    const text = $("#taskText").value.replace(/\s+/g, " ").trim();
    const note = $("#taskNote").value.replace(/\s+$/, "");
    let changed = false;
    if (text && text !== it.text) { it.text = text; changed = true; }
    if (note !== (it.note || "")) { if (note.trim()) it.note = note; else delete it.note; changed = true; }
    if (changed) {
      n.editedAt = new Date().toISOString();
      if (save) { render(); persist(); }
    }
    return changed;
  }
  async function tickOne(itemId, done) {
    commitText();
    await Notes().tickItem(cur.noteId, itemId, done);
    fill();
  }
  function closeTask({ all = false } = {}) {
    if (!isOpen()) return;
    const { it } = current();
    // A subtask's × is ←: back to its task, not out.
    if (!all && it && it.parent && current().n.items.some((i) => i.id === it.parent)) {
      commitText();
      cur = { noteId: cur.noteId, itemId: it.parent };
      fill();
      fitText();
      return;
    }
    commitText();
    $("#taskModal").hidden = true;
    $("#taskMoreMenu").hidden = true;
    cur = null;
  }
  async function moveToList(toId) {
    const { n, it } = current();
    const to = findNote(toId);
    if (!it || !to || to === n) return;
    commitText(false);
    const moving = [it, ...childrenOf(n.items, it.id)];
    n.items = n.items.filter((i) => !moving.includes(i));
    to.items = to.items || [];
    const lastOpen = to.items.map((i) => !i.done).lastIndexOf(true);
    to.items.splice(lastOpen + 1, 0, ...moving);
    const now = new Date().toISOString();
    n.editedAt = to.editedAt = now;
    cur = { noteId: to.id, itemId: it.id };
    fill();
    render();
    await persist();
    toast("Moved to " + (to.text || "the list"));
  }
  function copyTask() {
    const { n, it } = current();
    $("#taskMoreMenu").hidden = true;
    if (!it) return;
    commitText();
    const kids = childrenOf(n.items, it.id);
    const text = [listLines([it, ...kids], api.today()).join("\n"), it.note ? it.note.trim() : ""].filter(Boolean).join("\n\n");
    Notes().copyText(text);
  }
  // A task done is often worth a Timeline line (0.317.0): the Add entry
  // sheet opens on it, with its words, description and, when the Timeline
  // has one by that name, its category. Nothing is saved until Save, and
  // the task stays as it was, ticked or not.
  function logTask() {
    const { n, it } = current();
    $("#taskMoreMenu").hidden = true;
    if (!it) return;
    commitText();
    const category = categoryOf(n, it);
    closeTask({ all: true });
    window.LifeLogJournal.openEntryModal(null, null, { title: it.text, notes: it.note || "", category });
  }
  async function deleteTask() {
    const { n, it } = current();
    $("#taskMoreMenu").hidden = true;
    if (!it) return;
    const parent = it.parent;
    $("#taskModal").hidden = true;
    cur = null;
    await Notes().deleteItem(n.id, it.id, { always: true });
    const after = findNote(n.id);
    if (parent && after && after.items.some((i) => i.id === parent)) openTask(n.id, parent);
  }

  // ---------- the Date sheet ----------
  let draft = null, month = "";
  const WEEKDAY_SET = () => [...Dates().workDays()].sort((a, b) => a - b);
  function openDate() {
    const { it } = current();
    if (!it) return;
    draft = { date: it.date || "", time: it.time || "", repeat: it.repeat ? { ...it.repeat } : null, remind: it.remind != null ? it.remind : null, deadline: it.deadline || "" };
    month = (draft.date || api.today()).slice(0, 7);
    fillDate();
    $("#taskDateModal").hidden = false;
  }
  function repeatChoice(r) {
    if (!r) return "";
    if (r.unit === "week" && r.days && r.days.length) {
      const w = WEEKDAY_SET();
      return r.every === 1 && r.days.length === w.length && r.days.every((d, i) => d === w[i]) ? "weekday" : "custom";
    }
    return r.every === 1 ? r.unit : "custom";
  }
  function fillDate() {
    const today = api.today();
    const D = Dates();
    const has = !!draft.date;
    const now = $("#taskDateNow");
    now.replaceChildren(ico("calendar"), document.createTextNode(" " + (dateSummary(draft, today) || "No date")));
    now.classList.toggle("is-today", draft.date === today);
    // Quick picks.
    const quick = $("#taskQuick");
    quick.replaceChildren();
    const nextWeek = addDays(D.startOfWeek(today), 7);
    for (const [icon, label, day, cls] of [["sun", "Today", today, "is-today"], ["sunrise", "Tomorrow", addDays(today, 1), "is-tomorrow"],
      ["calendar", "Next week", nextWeek, "is-next"], ["ban", "No date", "", "is-none"]]) {
      const b = el("button", "task-quick-btn " + cls + (draft.date === day && (day || !has) ? " on" : ""));
      b.type = "button";
      b.append(ico(icon), el("span", "task-quick-label", label), el("span", "task-quick-day", day ? D.WEEKDAYS[dow(day)] + (day === nextWeek ? " " + +day.slice(8) : "") : ""));
      b.onclick = () => { draft.date = day; if (day) month = day.slice(0, 7); else { draft.time = ""; draft.repeat = null; draft.remind = null; } fillDate(); };
      quick.appendChild(b);
    }
    // The month.
    const [y, m] = month.split("-").map(Number);
    $("#taskCalMonth").textContent = D.MONTH_NAMES[m - 1] + " " + y;
    const grid = $("#taskCalGrid");
    grid.replaceChildren();
    for (const wd of D.weekOrder()) grid.appendChild(el("span", "task-cal-wd", D.WEEKDAYS[wd].slice(0, 1)));
    const first = `${month}-01`;
    const lead = D.weekPos(dow(first));
    for (let i = 0; i < lead; i++) grid.appendChild(el("span", "task-cal-pad"));
    const busy = new Set(dueTasks(state.data, `${month}-31`).filter((r) => r.day.startsWith(month) && !(cur && r.item.id === cur.itemId)).map((r) => r.day));
    const last = new Date(y, m, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const day = `${month}-${pad(d)}`;
      const b = el("button", "task-cal-day" + (day < today ? " is-past" : "") + (day === today ? " is-today" : "") + (day === draft.date ? " on" : "")
        + (day === draft.deadline ? " is-deadline" : "") + (busy.has(day) ? " has-tasks" : ""), String(d));
      b.type = "button";
      b.setAttribute("aria-label", D.day(day, { weekday: true }) + (busy.has(day) ? ", has tasks" : "") + (day === draft.deadline ? ", deadline" : ""));
      b.setAttribute("aria-pressed", String(day === draft.date));
      b.onclick = () => { draft.date = day; fillDate(); };
      grid.appendChild(b);
    }
    // Time, repeat, reminder: only with a date.
    const time = $("#taskTime");
    time.value = draft.time;
    time.disabled = !has;
    const rep = $("#taskRepeat");
    rep.value = repeatChoice(draft.repeat);
    rep.disabled = !has;
    const custom = rep.value === "custom";
    $("#taskRepeatCustom").hidden = !custom || !has;
    if (custom) {
      $("#taskRepeatEvery").value = String(draft.repeat.every || 1);
      $("#taskRepeatUnit").value = draft.repeat.unit;
    }
    $("#taskFromDoneLabel").hidden = !draft.repeat || !has;
    $("#taskFromDone").checked = !!(draft.repeat && draft.repeat.fromDone);
    const rem = $("#taskRemind");
    rem.replaceChildren();
    const opt = (v, label) => { const o = document.createElement("option"); o.value = v; o.textContent = label; rem.appendChild(o); };
    opt("", "Never");
    const choices = draft.time ? [[0, "At the time"], [5, "5 min before"], [15, "15 min before"], [30, "30 min before"], [60, "1 hour before"], [1440, "1 day before"]]
      : [[0, "On the day, 09:00"], [1440, "The day before, 09:00"]];
    for (const [v, label] of choices) opt(String(v), label);
    if (draft.remind != null && !choices.some(([v]) => v === draft.remind)) opt(String(draft.remind), remindText(draft));
    rem.value = draft.remind != null ? String(draft.remind) : "";
    rem.disabled = !has;
    $("#taskDeadline").value = draft.deadline;
  }
  function readRepeat() {
    const v = $("#taskRepeat").value;
    const fromDone = $("#taskFromDone").checked;
    let r = null;
    if (v === "weekday") r = { every: 1, unit: "week", days: WEEKDAY_SET() };
    else if (v === "custom") {
      const unit = $("#taskRepeatUnit").value;
      const keepDays = draft.repeat && draft.repeat.unit === "week" && unit === "week" && draft.repeat.days;
      r = { every: Math.max(1, Math.min(999, Math.round(+$("#taskRepeatEvery").value) || 1)), unit };
      if (keepDays) r.days = draft.repeat.days.slice();
    } else if (v) r = { every: 1, unit: v };
    if (r && fromDone) r.fromDone = true;
    draft.repeat = r;
  }
  function applyDate() {
    if (!draft) return;
    const d = draft;
    draft = null;
    $("#taskDateModal").hidden = true;
    change((it) => {
      const before = JSON.stringify([it.date, it.time, it.repeat, it.remind, it.deadline]);
      for (const k of ["date", "time", "repeat", "remind", "deadline"]) delete it[k];
      if (d.date) {
        it.date = d.date;
        if (d.time) it.time = d.time;
        if (d.repeat) it.repeat = d.repeat;
        if (d.remind != null) it.remind = d.remind;
      }
      if (d.deadline) it.deadline = d.deadline;
      cleanItem(it);
      return JSON.stringify([it.date, it.time, it.repeat, it.remind, it.deadline]) !== before;
    });
  }
  function handleEscape() {
    if (!$("#taskDateModal").hidden) { applyDate(); return true; }
    if (isOpen()) { if (!$("#taskMoreMenu").hidden) { $("#taskMoreMenu").hidden = true; return true; } closeTask(); return true; }
    return false;
  }

  function wire() {
    $("#taskCloseBtn").onclick = closeTask;
    $("#taskMoreBtn").onclick = (ev) => {
      ev.stopPropagation();
      const menu = $("#taskMoreMenu");
      menu.hidden = !menu.hidden;
      $("#taskMoreBtn").setAttribute("aria-expanded", String(!menu.hidden));
    };
    $("#taskModal").addEventListener("click", (ev) => { if (!ev.target.closest("#taskMoreMenu, #taskMoreBtn")) $("#taskMoreMenu").hidden = true; });
    $("#taskLogBtn").onclick = logTask;
    $("#taskCopyBtn").onclick = copyTask;
    $("#taskDeleteBtn").onclick = deleteTask;
    $("#taskList").onchange = () => moveToList($("#taskList").value);
    $("#taskTick").onchange = () => tickOne(cur.itemId, $("#taskTick").checked);
    const text = $("#taskText");
    text.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); text.blur(); } };
    text.oninput = fitText;
    text.onblur = () => { if (!text.value.trim()) { const { it } = current(); if (it) text.value = it.text; fitText(); } commitText(); };
    $("#taskNote").oninput = fitText;
    $("#taskNote").onblur = () => commitText();
    $("#taskCategory").onchange = () => change((it) => { const v = $("#taskCategory").value; if (v) it.category = v; else delete it.category; }, { edited: false });
    $("#taskPriority").onchange = () => change((it) => { const v = +$("#taskPriority").value; if (v) it.priority = v; else delete it.priority; }, { edited: false });
    $("#taskDateBtn").onclick = () => { commitText(); openDate(); };
    const sub = $("#taskNewSub");
    sub.onkeydown = (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const words = sub.value.trim();
      if (!words) return;
      sub.value = "";
      change((it, n) => {
        const kids = childrenOf(n.items, it.id);
        const after = kids.length ? kids[kids.length - 1] : it;
        n.items.splice(n.items.indexOf(after) + 1, 0, { id: uid(), text: words, parent: it.id });
      }).then(() => sub.focus());
    };
    $("#taskCalPrev").onclick = () => { const [y, m] = month.split("-").map(Number); month = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; fillDate(); };
    $("#taskCalNext").onclick = () => { const [y, m] = month.split("-").map(Number); month = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; fillDate(); };
    $("#taskTime").onchange = () => { draft.time = isTime($("#taskTime").value) ? $("#taskTime").value : ""; if (draft.remind != null && !draft.time && ![0, 1440].includes(draft.remind)) draft.remind = 0; fillDate(); };
    $("#taskRepeat").onchange = () => {
      if ($("#taskRepeat").value === "custom" && !draft.repeat) draft.repeat = { every: 2, unit: "day" };
      else readRepeat();
      fillDate();
    };
    $("#taskRepeatEvery").onchange = () => { readRepeat(); fillDate(); };
    $("#taskRepeatUnit").onchange = () => { readRepeat(); fillDate(); };
    $("#taskFromDone").onchange = () => { readRepeat(); fillDate(); };
    $("#taskRemind").onchange = () => { const v = $("#taskRemind").value; draft.remind = v === "" ? null : +v; fillDate(); };
    $("#taskDeadline").onchange = () => { draft.deadline = isDay($("#taskDeadline").value) ? $("#taskDeadline").value : ""; fillDate(); };
    $("#taskDateClear").onclick = () => { draft = { date: "", time: "", repeat: null, remind: null, deadline: "" }; applyDate(); };
    $("#taskDateDone").onclick = applyDate;
  }

  const api = {
    init, wire, openTask, closeTask, closeAll: () => closeTask({ all: true }), closeDate: applyDate, handleEscape, isOpen: () => !!cur,
    cleanItem, cleanParents, cleanRepeat, isTask, childrenOf, nextDate, tick, dueTasks, categoryOf, remindAt,
    today: () => localDay(new Date()), shortDay, repeatText, remindText, dateSummary, listLines, addDays, isDay, isTime, PRIORITY_NAMES,
  };
  if (typeof window !== "undefined") window.LifeLogTasks = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
