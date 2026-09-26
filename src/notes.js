// LifeLog — Notes: a running feed of things written down as they happen.
// Writing one still costs nothing — text and a timestamp — but since
// 0.195.0 a note can be one of three kinds (plain text, a checklist, a
// quote with its author) and can carry a category of its own. Shared app
// plumbing arrives via init(ctx), same as every other view module.
(function () {
  let state, $, el, uid, toast, persist, render, renderLazySections, groupBy,
    monthCardHeader, emptyState, backfillUpdatedAt, keepUnknown, MONTHS,
    bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
    openEntryModal, DEFAULT_SETTINGS, CATEGORY_PALETTE, buildCatFilter, sortSelect;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, renderLazySections, groupBy,
      monthCardHeader, emptyState, backfillUpdatedAt, keepUnknown, MONTHS,
      bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
      openEntryModal, DEFAULT_SETTINGS, CATEGORY_PALETTE, buildCatFilter, sortSelect } = ctx);
  }

  // Looked up at call time rather than captured: this file is required by the
  // Node tests, which have no DOM and never render.
  const reconcile = (...a) => window.LifeLogReconcile.reconcile(...a);
  const adopt = (...a) => window.LifeLogReconcile.adopt(...a);

  // ---------- data ----------
  // createdAt carries a time, unlike a timeline entry's year/month: an entry
  // is filed under the month you finished something, a note is a moment.
  //
  // editedAt is deliberately not updatedAt. stampChangedItems (merge.js)
  // touches updatedAt on any content change at all — a field migration
  // included — and "edited" on the card has to mean *you* edited it, which
  // is only true when saveNoteFromForm says so.
  //
  // The kinds (0.195.0), each absent-unless-used like every optional field:
  //   plain text   no `kind` — every note written before there were kinds
  //   "list"       `text` is the title, `items` the checklist: { id, text,
  //                done?, doneAt? }. Items have ids so two devices ticking
  //                different ones merge (merge.js mergeNotes).
  //   "quote"      `text` is the quote, with `author` and `source`.
  // `category` names one of state.data.noteCategories.
  const KINDS = ["text", "list", "quote"];
  const KNOWN_NOTE_KEYS = new Set(["id", "text", "createdAt", "editedAt", "updatedAt", "kind", "category", "author", "source", "items", "fav"]);
  function sanitizeNote(n) {
    const out = {
      id: n.id || uid(),
      text: String(n.text == null ? "" : n.text),
      createdAt: n.createdAt || null,
      updatedAt: backfillUpdatedAt(n),
    };
    if (n.editedAt) out.editedAt = n.editedAt;
    if (n.fav) out.fav = true;
    if (n.kind === "list" || n.kind === "quote") out.kind = n.kind;
    const cat = String(n.category == null ? "" : n.category).trim();
    if (cat) out.category = cat;
    if (out.kind === "quote") {
      for (const k of ["author", "source"]) { const v = String(n[k] == null ? "" : n[k]).trim(); if (v) out[k] = v; }
    }
    if (out.kind === "list") {
      out.items = (Array.isArray(n.items) ? n.items : []).map((it) => {
        const item = { id: (it && it.id) || uid(), text: String(it && it.text != null ? it.text : "").trim() };
        if (it && it.done) { item.done = true; item.doneAt = it.doneAt || out.updatedAt; }
        return item;
      }).filter((it) => it.text);
    }
    return keepUnknown(n, out, KNOWN_NOTE_KEYS);
  }
  const kindOf = (n) => n.kind || "text";

  // A to-do as the To-do mode stored it — still arriving from a device on a
  // build older than 0.197.0, and in old backups — tidied just enough for
  // the fold below. It never stays in the data.
  const KNOWN_TODO_KEYS = new Set(["id", "text", "category", "done", "doneAt", "order", "createdAt", "updatedAt"]);
  function sanitizeTodo(t) {
    const out = {
      id: t.id || uid(),
      text: String(t.text == null ? "" : t.text).trim(),
      createdAt: t.createdAt || null,
      updatedAt: backfillUpdatedAt(t),
    };
    const cat = String(t.category == null ? "" : t.category).trim();
    if (cat) out.category = cat;
    if (t.done) { out.done = true; out.doneAt = t.doneAt || out.updatedAt; }
    if (Number.isFinite(+t.order)) out.order = +t.order;
    return keepUnknown(t, out, KNOWN_TODO_KEYS);
  }

  // ---------- the To-do mode's lists, as list notes (0.197.0) ----------
  // Every to-do moves into a list note: one per to-do category, titled with
  // it, and one "To-do" list for the ones with none. Deterministic, so two
  // devices doing it on their own arrive at the same notes and the same
  // items — the list's id comes from the category's, each item keeps its
  // to-do's id — and the merge unites them rather than doubling them.
  //
  // It runs whenever `todos` has anything in it, not once: a device still on
  // an older build keeps writing to-dos until it updates, and those land in
  // the right list on the next sync. A to-do that's already an item (by id,
  // or by its words in that list) brings its words and tick across instead
  // of adding a second one — that's an older device's edit. The to-do
  // categories aren't kept any more (0.198.0), so a later to-do whose
  // category this device no longer knows finds its list by title instead.
  // Returns whether anything moved.
  const LIST_BY_ID = "todos-";
  function foldTodosIntoLists(data) {
    const todos = data.todos || [];
    if (!todos.length) return false;
    const notes = data.notes = data.notes || [];
    const cats = data.todoCategories || [];
    const listFor = (name) => {
      const cat = name ? cats.find((c) => c.name === name) : null;
      const id = LIST_BY_ID + (cat ? cat.id : name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "general");
      let n = notes.find((x) => x.id === id)
        || notes.find((x) => x.kind === "list" && x.id.startsWith(LIST_BY_ID) && x.text === (name || "To-do"));
      if (!n) {
        n = { id, kind: "list", text: name || "To-do", items: [], createdAt: null, updatedAt: "1970-01-01T00:00:00.000Z" };
        notes.push(n);
      }
      n.items = n.items || [];
      return n;
    };
    const byOrderThenAge = (a, b) => ((+a.order || 0) - (+b.order || 0)) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    const open = todos.filter((t) => !t.done).sort(byOrderThenAge);
    const done = todos.filter((t) => t.done).sort((a, b) => String(b.doneAt || "").localeCompare(String(a.doneAt || "")));
    for (const t of [...open, ...done]) {
      const text = String(t.text || "").trim();
      if (!text) continue;
      const n = listFor(t.category || "");
      const low = text.toLowerCase();
      let it = n.items.find((i) => i.id === t.id) || n.items.find((i) => String(i.text).toLowerCase() === low && !!i.done === !!t.done);
      if (!it) {
        it = { id: t.id, text };
        // Open ones go after the list's open items, finished ones at the end.
        const lastOpen = n.items.map((i) => !i.done).lastIndexOf(true);
        if (t.done) n.items.push(it); else n.items.splice(lastOpen + 1, 0, it);
      }
      it.text = text;
      if (t.done) { it.done = true; it.doneAt = t.doneAt || t.updatedAt || null; } else { delete it.done; delete it.doneAt; }
      if (!n.createdAt || (t.createdAt && t.createdAt < n.createdAt)) n.createdAt = t.createdAt || n.createdAt;
      if (t.updatedAt && t.updatedAt > n.updatedAt) n.updatedAt = t.updatedAt;
    }
    data.todos = [];
    return true;
  }
  // Everything a search should find, whatever the kind.
  const noteHaystack = (n) => [n.text, n.author, n.source, n.category, ...(n.items || []).map((i) => i.text)]
    .filter(Boolean).join("\n").toLowerCase();

  // A note with no createdAt at all (hand-edited JSON, a bad import) still
  // has to land somewhere rather than vanish, so it falls back to the stamp
  // every item carries.
  function noteDate(n) {
    const d = new Date(n.createdAt || n.updatedAt || 0);
    return isNaN(d) ? new Date(0) : d;
  }
  function noteYear(n) { return noteDate(n).getFullYear(); }

  function noteYears() {
    return [...new Set(state.data.notes.map(noteYear))].sort((a, b) => b - a);
  }

  // Years, categories (the chip rows), the kind (the mode bar's switch) and
  // the shared search box all narrow this. A category chip keyed "" is the
  // notes with none, as in the to-do list.
  function getFilteredNotes() {
    const q = state.search.trim().toLowerCase();
    const yf = state.activeYears, cf = state.noteActiveCats, kind = state.noteKind;
    return state.data.notes.filter((n) => {
      if (yf.size && !yf.has(noteYear(n))) return false;
      if (cf.size && !cf.has(n.category || "")) return false;
      if (kind && kindOf(n) !== kind) return false;
      if (q && !noteHaystack(n).includes(q)) return false;
      return true;
    });
  }

  // ---------- sort ----------
  // Newest, oldest, or by when you last edited. Until you pick one the notes
  // follow the Timeline's order, which is what they did before they had
  // their own (0.195.0) — so nothing moves on upgrade.
  const noteSort = () => state.data.settings.noteSort || state.data.settings.timelineSort || DEFAULT_SETTINGS.timelineSort || "newest";
  // The date a note is filed under for the current sort.
  function sortDate(n) {
    if (noteSort() !== "edited" || !n.editedAt) return noteDate(n);
    const d = new Date(n.editedAt);
    return isNaN(d) ? noteDate(n) : d;
  }
  async function setNoteSort(value) {
    state.data.settings.noteSort = value;
    render();
    await persist();
  }

  // ---------- categories ----------
  // A fourth category list, after the journal's, Finance's and the to-do
  // list's. Like the to-do list's it has no fallback: deleting one leaves its
  // notes uncategorised.
  const noteCats = () => state.data.noteCategories || (state.data.noteCategories = []);
  const catColor = (name) => (noteCats().find((c) => c.name === name) || {}).color || "#7a8a99";
  let catSaved = null; // what to do with a category made from the note sheet
  function openNoteCatModal(cat, onSaved) {
    const editing = !!cat;
    catSaved = onSaved || null;
    $("#noteCatModalTitle").textContent = editing ? "Edit note category" : "Add note category";
    $("#noteCatOrigName").value = editing ? cat.name : "";
    $("#noteCatName").value = editing ? cat.name : "";
    $("#noteCatColorInput").value = editing ? cat.color : CATEGORY_PALETTE[noteCats().length % CATEGORY_PALETTE.length];
    const uses = $("#noteCatUses");
    if (editing) {
      const n = state.data.notes.filter((x) => x.category === cat.name).length;
      uses.textContent = n + (n === 1 ? " note uses this" : " notes use this");
      uses.hidden = false;
    } else uses.hidden = true;
    $("#deleteNoteCatBtn").hidden = !editing;
    $("#noteCatModal").hidden = false;
    $("#noteCatName").focus();
  }
  function closeNoteCatModal() { $("#noteCatModal").hidden = true; catSaved = null; }
  async function saveNoteCatFromForm(ev) {
    ev.preventDefault();
    const orig = $("#noteCatOrigName").value;
    const name = $("#noteCatName").value.trim();
    const color = $("#noteCatColorInput").value;
    if (!name) return;
    const cats = noteCats();
    const clash = (c) => c.name.toLowerCase() === name.toLowerCase();
    const after = catSaved;
    if (!orig) {
      if (cats.some(clash)) { toast("That category already exists", true); return; }
      cats.push({ id: uid(), name, color, updatedAt: new Date().toISOString() });
    } else {
      const cat = cats.find((c) => c.name === orig);
      if (!cat) return;
      if (name !== cat.name && cats.some((c) => c !== cat && clash(c))) { toast("A category with that name already exists", true); return; }
      cat.color = color;
      if (name !== cat.name) {
        // The id is the category's sync identity; only its name moves, and
        // every note holding the old one follows it.
        const old = cat.name;
        cat.name = name;
        state.data.notes.forEach((n) => { if (n.category === old) n.category = name; });
        if (state.noteActiveCats.has(old)) { state.noteActiveCats.delete(old); state.noteActiveCats.add(name); }
      }
    }
    closeNoteCatModal();
    buildCatFilter();
    render();
    await persist();
    if (after) after(name);
  }
  async function deleteNoteCategory() {
    const cats = noteCats();
    const cat = cats.find((c) => c.name === $("#noteCatOrigName").value);
    if (!cat) return;
    const using = state.data.notes.filter((n) => n.category === cat.name);
    if (!confirm(using.length
      ? `“${cat.name}” is used by ${using.length} note${using.length === 1 ? "" : "s"}. Delete it and leave them uncategorised?`
      : `Delete note category “${cat.name}”?`)) return;
    using.forEach((n) => { delete n.category; });
    state.data.noteCategories = cats.filter((c) => c !== cat);
    state.noteActiveCats.delete(cat.name);
    closeNoteCatModal();
    buildCatFilter();
    render();
    await persist();
    toast("Note category deleted");
  }

  // ---------- the mode bar: kind switch and sort ----------
  function renderNotesToolbar(root) {
    if (!state.data.notes.length) return;
    const bar = el("div", "notes-toolbar");
    const kinds = el("div", "notes-kinds");
    kinds.setAttribute("role", "group");
    kinds.setAttribute("aria-label", "Show");
    for (const [k, label] of [["", "All"], ["text", "Notes"], ["list", "Lists"], ["quote", "Quotes"]]) {
      const b = el("button", "notes-kind" + (state.noteKind === k ? " on" : ""), label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.noteKind === k));
      b.onclick = () => { state.noteKind = k; render(); };
      kinds.appendChild(b);
    }
    bar.appendChild(kinds);
    const sort = sortSelect("notes", noteSort(), setNoteSort);
    bar.appendChild(sort);
    root.appendChild(bar);
  }

  // ---------- rendering ----------
  function formatStamp(d) {
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  function formatEdited(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  // Read once per render rather than per card: "now" cannot change between
  // two month cards of the same pass, and Date() is not free at a few hundred
  // notes.
  function isCurrentMonth(year, month) {
    const now = new Date();
    return year === now.getFullYear() && month === now.getMonth() + 1;
  }

  // The card's *contents*. Its click and key handlers are not here — see
  // createNoteCard, and NOTES.md on why they can't be.
  function noteCard(n) {
    const card = el("div", "note-card");
    card.dataset.id = n.id;
    if (state.bulk.active) {
      // is-bulk re-lays the card out around the box; is-selected tints it.
      // A note card is a lot taller than a timeline row, so a 14px checkbox
      // in its corner is thin feedback on its own.
      card.classList.add("is-bulk");
      card.classList.toggle("is-selected", state.bulk.selected.has(n.id));
      card.appendChild(bulkCheckbox({ id: n.id }));
    }
    const stamp = el("div", "note-stamp", formatStamp(noteDate(n)));
    if (n.editedAt) {
      const edited = formatEdited(n.editedAt);
      if (edited) stamp.appendChild(el("span", "note-edited", " · edited " + edited));
    }
    // A list shows its category as its header's dot, as the old panels did.
    if (n.category && (n.kind !== "list" || state.bulk.active)) {
      const cat = el("span", "note-cat");
      const dot = el("span", "dot"); dot.style.background = catColor(n.category);
      cat.append(dot, document.createTextNode(n.category));
      stamp.appendChild(cat);
    }
    // ★ keeps a note at the top, above the years (0.196.0).
    if (!state.bulk.active) {
      const fav = own(el("button", "note-fav" + (n.fav ? " on" : ""), n.fav ? "★" : "☆"));
      fav.type = "button";
      fav.title = n.fav ? "Remove from favourites" : "Add to favourites";
      fav.setAttribute("aria-label", fav.title);
      fav.setAttribute("aria-pressed", String(!!n.fav));
      fav.onclick = () => toggleFav(n.id);
      stamp.appendChild(fav);
    }
    card.appendChild(stamp);
    // textContent, never innerHTML: a note is whatever you typed, and the
    // white-space CSS is what keeps your line breaks.
    const kind = kindOf(n);
    card.classList.toggle("is-quote", kind === "quote");
    card.classList.toggle("is-list", kind === "list");
    if (kind === "quote") {
      const q = el("blockquote", "note-text note-quote", n.text);
      card.appendChild(q);
      const by = [n.author, n.source].filter(Boolean).join(", ");
      if (by) card.appendChild(el("p", "note-author", "— " + by));
    } else if (kind === "list") {
      if (state.bulk.active) card.appendChild(el("p", "note-text note-list-title", n.text || "Untitled list"));
      else listPanel(card, n);
    } else card.appendChild(el("p", "note-text", n.text));
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    return card;
  }

  // ---------- a list on its card (0.196.0) ----------
  // A list note is drawn as the To-do mode's panels were, and behaves like
  // one: its title and open count in a header (with Clear for what's done),
  // a row per item — tick it, tap its words to edit them in place, ✕ to
  // delete — the finished ones under an "N done" rule, struck through, and a
  // line at the bottom to add the next. A long press reorders, as it did
  // there. Same classes as the old rows, so it looks the same too.
  //
  // Nothing in here opens the note: that's the header's job (title,
  // category, delete). A tick isn't an edit; changing an item's words or
  // adding one is.
  const listDrafts = new Map(); // what's half-typed in a list's add line, by note id
  let listReorderId = "", refocusListId = "";
  const byNewestDone = (a, b) => String(b.doneAt || "").localeCompare(String(a.doneAt || ""));
  const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function listPanel(card, n) {
    const items = n.items || [];
    const open = items.filter((i) => !i.done), done = items.filter((i) => i.done).sort(byNewestDone);
    const reordering = listReorderId === n.id && open.length > 1;
    card.classList.toggle("is-reordering", reordering);

    const h = el("h3", "note-list-head");
    const left = el("span", "mc-left");
    if (n.category) { const dot = el("span", "dot"); dot.style.background = catColor(n.category); left.appendChild(dot); }
    left.appendChild(el("span", "note-list-title", reordering ? "Drag to reorder" : (n.text || "Untitled list")));
    h.appendChild(left);
    const right = el("span", "mc-right");
    if (reordering) {
      const btn = el("button", "btn btn-sm btn-primary", "Done");
      btn.type = "button";
      btn.onclick = (ev) => { ev.stopPropagation(); listReorderId = ""; render(); };
      right.appendChild(btn);
    } else {
      right.appendChild(el("span", "mc", String(open.length)));
      if (done.length) {
        const btn = el("button", "btn btn-sm", "Clear");
        btn.type = "button";
        btn.title = "Delete this list's finished items";
        btn.onclick = (ev) => { ev.stopPropagation(); clearDoneItems(n.id); };
        right.appendChild(btn);
      }
    }
    h.appendChild(right);
    card.appendChild(h);

    const rows = el("div", "note-list-rows");
    if (!items.length) rows.appendChild(el("p", "dsc-note", "Nothing here."));
    else if (!open.length) rows.appendChild(el("p", "dsc-note", "All done."));
    for (const it of open) rows.appendChild(reordering ? reorderRow(n, it, rows) : itemRow(n, it));
    if (done.length && !reordering) {
      rows.appendChild(el("div", "todo-done-sep", done.length + " done"));
      for (const it of done) rows.appendChild(itemRow(n, it));
    }
    card.appendChild(rows);
    if (!reordering) card.appendChild(listCompose(n));
  }

  // Everything on a row stops at the row: the card underneath opens the note
  // on a click, and none of these should.
  const own = (node) => {
    for (const t of ["click", "keydown"]) node.addEventListener(t, (ev) => ev.stopPropagation());
    return node;
  };

  function itemRow(n, it) {
    const row = own(el("div", "todo-row" + (it.done ? " is-done" : "")));
    row.dataset.item = it.id;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "todo-check";
    cb.checked = !!it.done;
    cb.setAttribute("aria-label", (it.done ? "Mark as not done: " : "Mark as done: ") + it.text);
    cb.onchange = () => tickItem(n.id, it.id, cb.checked);
    row.appendChild(cb);
    const text = el("span", "todo-text", it.text);
    text.onclick = () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "todo-edit";
      input.value = it.text;
      let closed = false;
      const commit = () => { if (closed) return; closed = true; editItem(n.id, it.id, input.value); };
      input.onkeydown = (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        else if (ev.key === "Escape") { closed = true; render(); }
      };
      input.onblur = commit;
      text.replaceWith(input);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    };
    row.appendChild(text);
    const del = el("button", "todo-del", "✕");
    del.type = "button";
    del.title = "Delete";
    del.setAttribute("aria-label", "Delete: " + it.text);
    del.onclick = () => deleteItem(n.id, it.id);
    row.appendChild(del);
    if (!it.done) attachLongPressReorder(row, n.id);
    return row;
  }

  function listCompose(n) {
    const wrap = own(el("div", "todo-compose note-list-compose"));
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Add a to-do…";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Add to " + (n.text || "this list"));
    input.value = listDrafts.get(n.id) || "";
    const add = el("button", "btn btn-primary btn-sm", "Add");
    add.type = "button";
    add.disabled = !input.value.trim();
    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      listDrafts.delete(n.id);
      refocusListId = n.id;
      addItem(n.id, v);
    };
    add.onclick = submit;
    input.oninput = () => { listDrafts.set(n.id, input.value); add.disabled = !input.value.trim(); };
    input.onkeydown = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); submit(); }
      else if (ev.key === "Escape") { input.value = ""; listDrafts.delete(n.id); add.disabled = true; }
    };
    wrap.append(input, add);
    return wrap;
  }

  const findList = (id) => state.data.notes.find((x) => x.id === id);
  async function saveList(n, edited) {
    if (edited) n.editedAt = new Date().toISOString();
    render();
    if (refocusListId) {
      const input = document.querySelector(`.note-card[data-id="${refocusListId}"] .note-list-compose input`);
      refocusListId = "";
      if (input) input.focus();
    }
    await persist();
  }
  async function toggleFav(noteId) {
    const n = findList(noteId);
    if (!n) return;
    if (n.fav) delete n.fav; else n.fav = true;
    render();
    await persist();
  }
  async function tickItem(noteId, itemId, done) {
    const n = findList(noteId);
    const it = n && (n.items || []).find((i) => i.id === itemId);
    if (!it) return;
    if (done) { it.done = true; it.doneAt = new Date().toISOString(); } else { delete it.done; delete it.doneAt; }
    await saveList(n, false);
  }
  async function addItem(noteId, text) {
    const n = findList(noteId);
    if (!n) return;
    n.items = n.items || [];
    // After the last open item, so it lands at the bottom of what's left to do.
    const lastOpen = n.items.map((i) => !i.done).lastIndexOf(true);
    n.items.splice(lastOpen + 1, 0, { id: uid(), text });
    await saveList(n, true);
  }
  async function editItem(noteId, itemId, text) {
    const n = findList(noteId);
    const it = n && (n.items || []).find((i) => i.id === itemId);
    if (!it) return;
    text = text.trim();
    if (!text) return deleteItem(noteId, itemId);
    if (text === it.text) { render(); return; }
    it.text = text;
    await saveList(n, true);
  }
  async function deleteItem(noteId, itemId) {
    const n = findList(noteId);
    if (!n) return;
    n.items = (n.items || []).filter((i) => i.id !== itemId);
    await saveList(n, true);
  }
  async function clearDoneItems(noteId) {
    const n = findList(noteId);
    if (!n) return;
    const count = (n.items || []).filter((i) => i.done).length;
    if (!count || !confirm(`Clear ${count} finished item${count === 1 ? "" : "s"} from ${n.text ? "“" + n.text + "”" : "this list"}?`)) return;
    n.items = n.items.filter((i) => !i.done);
    await saveList(n, true);
    toast(`Cleared ${count}`);
  }

  // ---------- quick add (0.197.0) ----------
  // The widget's and the home-screen shortcut's "To-do" lands in a list: the
  // one ticked "Quick add goes here" in its sheet, else the one most
  // recently worked on, else a new "To-do" list.
  function quickList() {
    const lists = state.data.notes.filter((n) => n.kind === "list");
    const chosen = lists.find((n) => n.id === state.data.settings.quickList);
    if (chosen) return chosen;
    const worked = (n) => String(n.editedAt || n.updatedAt || n.createdAt || "");
    return lists.sort((a, b) => worked(b).localeCompare(worked(a)))[0] || null;
  }
  async function focusQuickList() {
    let n = quickList();
    if (!n) {
      const now = new Date().toISOString();
      n = sanitizeNote({ kind: "list", text: "To-do", items: [], createdAt: now, updatedAt: now });
      state.data.notes.unshift(n);
      persist();
    }
    render();
    const id = n.id;
    requestAnimationFrame(() => {
      const input = document.querySelector(`.note-card[data-id="${id}"] .note-list-compose input`);
      // Its section may not be drawn yet on a long feed; the sheet always is.
      if (!input) { openNoteModal(findList(id)); return; }
      input.scrollIntoView({ block: "center" });
      input.focus();
    });
  }

  // ---------- reordering a list (the To-do mode's gesture) ----------
  const LONG_PRESS_MS = 500;
  function attachLongPressReorder(row, noteId) {
    let timer = null, start = null;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } start = null; };
    row.addEventListener("pointerdown", (ev) => {
      if (listReorderId || state.bulk.active) return;
      if (ev.target.closest(".todo-check, .todo-del, .todo-edit")) return;
      start = { x: ev.clientX, y: ev.clientY };
      timer = setTimeout(() => { timer = null; listReorderId = noteId; render(); }, LONG_PRESS_MS);
    });
    row.addEventListener("pointermove", (ev) => {
      if (!start) return;
      if (Math.abs(ev.clientX - start.x) > 10 || Math.abs(ev.clientY - start.y) > 10) cancel();
    });
    row.addEventListener("pointerup", cancel);
    row.addEventListener("pointercancel", cancel);
  }
  function reorderRow(n, it, list) {
    const row = own(el("div", "todo-row is-reorder"));
    row.dataset.item = it.id;
    const grip = el("span", "todo-grip", "⠿");
    grip.setAttribute("aria-hidden", "true");
    row.append(grip, el("span", "todo-text", it.text));
    row.addEventListener("pointerdown", (ev) => beginRowDrag(ev, row, list, n.id));
    return row;
  }
  // The dragged row snaps to its slot; what it displaced slides (FLIP).
  function slideDisplaced(list, dragged, mutate) {
    if (reducedMotion()) { mutate(); return; }
    const rows = [...list.querySelectorAll(".todo-row")].filter((r) => r !== dragged);
    const before = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
    mutate();
    const moved = [];
    for (const r of rows) {
      const delta = before.get(r) - r.getBoundingClientRect().top;
      if (!delta) continue;
      r.style.transition = "none";
      r.style.transform = "translateY(" + delta + "px)";
      moved.push(r);
    }
    if (moved.length) requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const r of moved) { r.style.transition = ""; r.style.transform = ""; }
    }));
  }
  // Listeners on the window, not a pointer capture on the row: insertBefore
  // moves the row, which counts as leaving the DOM, and a captured element
  // that leaves it loses the capture (learnt in the old To-do mode).
  function beginRowDrag(ev, row, list, noteId) {
    ev.preventDefault();
    row.classList.add("is-dragging");
    const onMove = (e) => {
      if (e.pointerId !== ev.pointerId) return;
      for (const other of [...list.querySelectorAll(".todo-row")]) {
        if (other === row) continue;
        const box = other.getBoundingClientRect(), mid = box.top + box.height / 2;
        const rowIsAfter = !!(other.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (e.clientY < mid && rowIsAfter) { slideDisplaced(list, row, () => list.insertBefore(row, other)); break; }
        if (e.clientY > mid && !rowIsAfter) { slideDisplaced(list, row, () => list.insertBefore(row, other.nextSibling)); break; }
      }
    };
    const onUp = (e) => {
      if (e.pointerId !== ev.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      row.classList.remove("is-dragging");
      commitItemOrder(list, noteId);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }
  // The open items in the order the rows now stand, then the finished ones
  // where they were. A reorder isn't an edit.
  async function commitItemOrder(list, noteId) {
    const n = findList(noteId);
    if (!n) return;
    const order = [...list.querySelectorAll(".todo-row")].map((r) => r.dataset.item);
    const byId = new Map(n.items.map((i) => [i.id, i]));
    const open = order.map((id) => byId.get(id)).filter(Boolean);
    const rest = n.items.filter((i) => !order.includes(i.id));
    const next = [...open, ...rest];
    if (next.every((it, i) => it === n.items[i])) return;
    n.items = next;
    render();
    await persist();
  }

  // Bound once per node, and deliberately by id rather than over the note
  // object. adopt() carries attributes across a refill but not properties, so
  // a handler closed over `n` would keep opening the copy of the note that
  // existed when the card was first built — edit a note, click it, and the
  // pre-edit text comes back. Looking it up at click time can't go stale.
  //
  // The id is passed in rather than read off the node because
  // attachLongPressSelect binds once and only ever reads `.id` — the same
  // reason createEntryRow takes one. It is fixed for the life of the node,
  // since it is the reconcile key.
  function createNoteCard(id) {
    const card = el("div", "note-card");
    const activate = () => {
      // While selecting, a tap is a tick. Opening the editor here would
      // close the selection you were halfway through building.
      if (state.bulk.active) { toggleBulkItem(card.dataset.id); return; }
      const n = (state.data.notes || []).find((x) => x.id === card.dataset.id);
      if (n) openNoteModal(n);
    };
    // A list is a panel you work in, so only its header (and date line)
    // opens it; every other note opens from anywhere on its card.
    card.onclick = (ev) => {
      if (!state.bulk.active && card.classList.contains("is-list") && !ev.target.closest(".note-list-head, .note-stamp")) return;
      activate();
    };
    card.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); activate(); }
    };
    attachLongPressSelect(card, { id });
    return card;
  }

  // A month's header plus its notes, keyed so a note keeps its card across a
  // render. The header rides in the same list under a reserved key, which
  // keeps the card's DOM shape exactly what it was.
  function fillMonthCard(card, label, notes, current, noHead) {
    const parts = noHead ? [] : [{ key: "__head", kind: "head", label, count: notes.length, current }];
    for (const n of notes) parts.push({ key: n.id, kind: "note", note: n });
    reconcile(card, parts, {
      animate: true,
      keyOf: (part) => part.key,
      create: (part) => (part.kind === "head" ? el("h3") : createNoteCard(part.key)),
      update: (node, part) => adopt(node, part.kind === "head"
        // A "+" only on the month you are actually in. A note is stamped with
        // the moment it's written, so there is no such thing as adding one to
        // March — a + on March's card that produced a September note would
        // read as a bug. On the current month it means exactly what it looks
        // like, and saves a reach for the compose button. monthCardHeader
        // swaps it for the month's select-all box while bulk mode is on.
        ? monthCardHeader(part.label, part.count, notes,
            part.current ? { onAdd: () => openNoteModal(null) } : null)
        : noteCard(part.note)),
    });
  }

  // The shell outlives a render. app.js still clears #viewBody on its way
  // through (and will keep doing so — see DROPPED.md), so holding this is
  // what lets the year sections, month cards and note cards survive: clearing
  // a parent detaches these nodes without destroying them.
  let notesRootEl = null, notesEmptyEl = null, notesBulkEl = null;

  function renderNotes(root) {
    if (!notesRootEl) notesRootEl = document.createElement("div");
    const shell = notesRootEl;
    renderNotesToolbar(root);
    root.appendChild(shell);

    const showEmpty = (node) => {
      // Hands the section machinery an empty list so it drops the year blocks
      // it is still holding; without this they'd sit under the empty state.
      renderLazySections(shell, []);
      // Both early returns come through here, so the bar is dropped in one
      // place rather than twice: with no cards on screen there is nothing
      // left to select, and a bar counting notes you can't see is a lie.
      if (notesBulkEl) { notesBulkEl.remove(); notesBulkEl = null; }
      if (notesEmptyEl) notesEmptyEl.remove();
      notesEmptyEl = node;
      shell.appendChild(node);
    };

    if (!state.data.notes.length) {
      showEmpty(emptyState({
        glyph: "✎",
        title: "No notes yet",
        body: "Write things down as you notice them. Each one keeps the date and time it was written, and you can edit it later.",
        action: "Write your first note",
        onAction: () => openNoteModal(null),
      }));
      return;
    }
    const notes = getFilteredNotes();
    if (!notes.length) {
      showEmpty(emptyState("No notes match your filters."));
      return;
    }
    if (notesEmptyEl) { notesEmptyEl.remove(); notesEmptyEl = null; }

    // Same year → month shape as the timeline. Within a month the notes run
    // in the same direction as the months: a feed read newest-first inside an
    // oldest-first month would fight itself. "Recently edited" files each
    // note under when it was last edited, and runs newest first.
    const desc = noteSort() !== "oldest";
    const bySort = (a, b) => (desc ? sortDate(b) - sortDate(a) : sortDate(a) - sortDate(b));
    // Favourites (0.196.0) sit above the years in a block of their own, and
    // not in their month as well: one place for each note. The filters still
    // apply to them, and they run in the same order as everything else.
    const favs = notes.filter((n) => n.fav).sort(bySort);
    const byYear = groupBy(notes.filter((n) => !n.fav), (n) => sortDate(n).getFullYear());
    const sections = [];
    if (favs.length) {
      const block = el("div", "year-block note-favs");
      block.dataset.year = "favourites";
      const head = el("div", "year-head");
      head.appendChild(el("h2", null, "★ Favourites"));
      head.appendChild(el("span", "ycount", `${favs.length} note${favs.length === 1 ? "" : "s"}`));
      block.appendChild(head);
      const grid = el("div", "month-grid");
      block.appendChild(grid);
      sections.push({
        key: "favourites", header: head, node: block, bodyEl: grid, keepBody: true,
        build: (body) => reconcile(body, [{ key: "favs" }], {
          keyOf: (c) => c.key,
          create: () => el("div", "month-card"),
          update: (card) => fillMonthCard(card, "", favs, false, true),
        }),
      });
    }
    for (const y of Object.keys(byYear).sort((a, b) => (desc ? b - a : a - b))) {
      const block = el("div", "year-block");
      block.dataset.year = y;
      const head = el("div", "year-head");
      head.appendChild(el("h2", null, y));
      head.appendChild(el("span", "ycount", `${byYear[y].length} note${byYear[y].length === 1 ? "" : "s"}`));
      block.appendChild(head);
      const grid = el("div", "month-grid");
      block.appendChild(grid);
      sections.push({
        key: y, header: head, node: block, bodyEl: grid,
        // build() reconciles the body rather than appending to it, so
        // renderLazySections must not clear it first.
        keepBody: true,
        build: (body) => {
          const byMonth = groupBy(byYear[y], (n) => sortDate(n).getMonth() + 1);
          const months = Object.keys(byMonth).sort(desc ? (a, b) => b - a : (a, b) => a - b);
          const cards = months.map((m) => ({
            key: y + "-" + m,
            year: +y,
            month: +m,
            notes: byMonth[m].slice().sort((a, b) =>
              desc ? sortDate(b) - sortDate(a) : sortDate(a) - sortDate(b)),
          }));
          reconcile(body, cards, {
            keyOf: (c) => c.key,
            create: () => el("div", "month-card"),
            update: (card, c) => {
              // The Stats heatmap scrolls straight to these.
              card.dataset.year = c.year;
              card.dataset.month = c.month;
              fillMonthCard(card, MONTHS[c.month], c.notes, isCurrentMonth(c.year, c.month));
            },
          });
        },
      });
    }
    renderLazySections(shell, sections);
    // Every height read first, then every write: alternating them makes the
    // browser flush layout once per section instead of once for the lot.
    const headHeights = sections.map((s) => s.header.getBoundingClientRect().height);
    sections.forEach((s, i) => s.node.style.setProperty("--year-head-h", headHeights[i] + "px"));

    // Outside the shell, and rebuilt rather than reconciled — the same shape
    // the timeline uses. Move files the selection under a note category.
    if (notesBulkEl) { notesBulkEl.remove(); notesBulkEl = null; }
    if (state.bulk.active) {
      notesBulkEl = bulkActionBar({
        categories: noteCats(),
        onMove: noteCats().length ? bulkMoveNotesSelected : null,
        onDelete: bulkDeleteNotesSelected,
      });
      root.appendChild(notesBulkEl);
    }
  }

  // ---------- bulk actions ----------
  // Move (0.195.0) and Delete. Syncing needs media, and turning a pile of
  // notes into entries at once would need a title and a category decided per
  // note — the single-note flow below.
  async function bulkMoveNotesSelected(category) {
    const ids = state.bulk.selected;
    let n = 0;
    for (const note of state.data.notes) if (ids.has(note.id)) { note.category = category; n++; }
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Moved ${n} note${n === 1 ? "" : "s"} to ${category}`);
  }
  async function bulkDeleteNotesSelected() {
    const ids = state.bulk.selected;
    const n = ids.size;
    if (!confirm(`Delete ${n} note${n === 1 ? "" : "s"}?`)) return;
    state.data.notes = state.data.notes.filter((x) => !ids.has(x.id));
    state.bulk.active = false;
    state.bulk.selected.clear();
    render();
    await persist();
    toast(`Deleted ${n} note${n === 1 ? "" : "s"}`);
  }

  // ---------- note -> entry ----------
  // A note is one blob of text; an entry has a title and a separate notes
  // field. The split is the first line against the rest, which is how people
  // already write these ("Finished Silksong" and then why). A single-line
  // note becomes a title and leaves the entry's notes empty rather than
  // saying the same thing twice.
  //
  // The cap is on the title only, and it keeps the whole first line in the
  // notes when it trips, so nothing is silently lost.
  const ENTRY_TITLE_MAX = 80;
  function splitNoteForEntry(text) {
    const lines = String(text == null ? "" : text).split("\n");
    const first = lines[0].trim();
    const rest = lines.slice(1).join("\n").trim();
    if (first.length > ENTRY_TITLE_MAX) {
      return { title: first.slice(0, ENTRY_TITLE_MAX).trimEnd(), notes: [first, rest].filter(Boolean).join("\n\n") };
    }
    return { title: first, notes: rest };
  }

  // The note is deliberately left where it is. It is stamped with a moment
  // and the entry is filed under a month, so they are not the same record and
  // deleting one to make the other loses the moment. There is no link field
  // either: what a note-to-entry relationship should mean is exactly what
  // using this is meant to answer, and a field in a synced collection is the
  // expensive way to find out. Delete the note by hand if you want it gone.
  function makeEntryFromNote() {
    const n = state.data.notes.find((x) => x.id === editingNoteId);
    if (!n) return;
    const d = noteDate(n);
    const { title, notes } = splitNoteForEntry(n.text);
    closeNoteModal();
    openEntryModal(null, null, {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      title,
      notes,
    });
  }

  // ---------- modal ----------
  // One sheet for all three kinds. Switching kind only changes which fields
  // show; each keeps what was typed in it, and Save takes the fields of the
  // kind it's on.
  let editingNoteId = "";
  let sheetKind = "text";
  let sheetItems = []; // the checklist being edited: { id, text, done?, doneAt? }

  function setSheetKind(kind) {
    sheetKind = KINDS.includes(kind) ? kind : "text";
    document.querySelectorAll("#noteKindSeg [data-kind]").forEach((b) => {
      const on = b.dataset.kind === sheetKind;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    });
    $("#nTitleLabel").hidden = sheetKind !== "list";
    $("#nListEditor").hidden = sheetKind !== "list";
    $("#nTextLabel").hidden = sheetKind === "list";
    $("#nQuoteFields").hidden = sheetKind !== "quote";
    $("#nTextLabelText").textContent = sheetKind === "quote" ? "Quote" : "Note";
    $("#nText").placeholder = sheetKind === "quote" ? "The words, as they were said" : "What happened, what you noticed…";
    $("#nText").rows = sheetKind === "quote" ? 4 : 8;
    const editing = editingNoteId && state.data.notes.find((x) => x.id === editingNoteId);
    $("#noteToEntryBtn").hidden = !editing || sheetKind !== "text";
  }

  function renderSheetItems() {
    const wrap = $("#nItems");
    wrap.innerHTML = "";
    sheetItems.forEach((it, i) => {
      const row = el("div", "note-list-row" + (it.done ? " is-done" : ""));
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!it.done;
      cb.setAttribute("aria-label", "Done");
      cb.onchange = () => {
        if (cb.checked) { it.done = true; it.doneAt = new Date().toISOString(); } else { delete it.done; delete it.doneAt; }
        row.classList.toggle("is-done", cb.checked);
      };
      const input = document.createElement("input");
      input.type = "text";
      input.value = it.text;
      input.setAttribute("aria-label", "Item " + (i + 1));
      input.oninput = () => { it.text = input.value; };
      // Enter in an item starts the next one, like any list app.
      input.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("#nNewItem").focus(); } };
      const del = el("button", "note-list-del", "✕");
      del.type = "button";
      del.setAttribute("aria-label", "Remove item");
      del.onclick = () => { sheetItems.splice(i, 1); renderSheetItems(); };
      row.append(cb, input, del);
      wrap.appendChild(row);
    });
  }
  function addSheetItem() {
    const input = $("#nNewItem");
    const text = input.value.trim();
    if (!text) return false;
    sheetItems.push({ id: uid(), text });
    input.value = "";
    renderSheetItems();
    return true;
  }

  const NEW_CATEGORY = "\u0000new";
  function fillCategorySelect(value) {
    const sel = $("#nCategory");
    sel.innerHTML = "";
    const opt = (v, label) => { const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o); };
    opt("", "No category");
    for (const c of noteCats()) opt(c.name, c.name);
    opt(NEW_CATEGORY, "New category…");
    sel.value = noteCats().some((c) => c.name === value) ? value : "";
    sel.dataset.prev = sel.value;
  }

  function openNoteModal(note, kind) {
    editingNoteId = note ? note.id : "";
    $("#noteModalTitle").textContent = note ? "Edit note" : "New note";
    $("#nText").value = note && kindOf(note) !== "list" ? note.text : "";
    $("#nTitle").value = note && kindOf(note) === "list" ? note.text : "";
    $("#nAuthor").value = (note && note.author) || "";
    $("#nSource").value = (note && note.source) || "";
    $("#nNewItem").value = "";
    sheetItems = note && note.items ? note.items.map((i) => ({ ...i })) : [];
    $("#nQuickList").checked = !!note && state.data.settings.quickList === note.id;
    renderSheetItems();
    fillCategorySelect(note ? note.category : ([...state.noteActiveCats].find(Boolean) || ""));
    $("#deleteNoteBtn").hidden = !note;
    const stamp = $("#noteStampLine");
    if (note) {
      let line = "Written " + formatStamp(noteDate(note));
      if (note.editedAt) {
        const edited = formatEdited(note.editedAt);
        if (edited) line += " · edited " + edited;
      }
      stamp.textContent = line;
      stamp.hidden = false;
    } else stamp.hidden = true;
    // A new note starts as the kind the list is showing.
    setSheetKind(note ? kindOf(note) : (kind || state.noteKind || "text"));
    $("#noteModal").hidden = false;
    (sheetKind === "list" ? (note ? $("#nNewItem") : $("#nTitle")) : $("#nText")).focus();
  }
  function closeNoteModal() { $("#noteModal").hidden = true; }

  async function saveNoteFromForm(ev) {
    ev.preventDefault();
    addSheetItem(); // an item typed but not yet entered is still meant
    const kind = sheetKind;
    const text = (kind === "list" ? $("#nTitle").value : $("#nText").value).trim();
    const items = sheetItems.map((i) => ({ ...i, text: i.text.trim() })).filter((i) => i.text);
    if (kind === "list" ? !text && !items.length : !text) {
      toast(kind === "list" ? "Give the list a title or an item" : kind === "quote" ? "Write the quote" : "Write something first", true);
      return;
    }
    const fields = { text, kind: kind === "text" ? undefined : kind };
    if (kind === "quote") { fields.author = $("#nAuthor").value.trim(); fields.source = $("#nSource").value.trim(); }
    if (kind === "list") fields.items = items;
    const category = $("#nCategory").value === NEW_CATEGORY ? "" : $("#nCategory").value;
    const now = new Date().toISOString();
    if (editingNoteId) {
      const n = state.data.notes.find((x) => x.id === editingNoteId);
      if (n) {
        // Only a change to what the note says counts as an edit — reopening
        // one, ticking an item or filing it under a category doesn't
        // relabel it as edited.
        const said = (x) => JSON.stringify([kindOf(x), x.text, x.author || "", x.source || "", (x.items || []).map((i) => i.text)]);
        const before = said(n);
        const next = sanitizeNote({ ...n, ...fields, category });
        for (const k of ["kind", "author", "source", "items", "category"]) delete n[k];
        Object.assign(n, next);
        if (said(n) !== before) n.editedAt = now;
      }
    } else {
      state.data.notes.unshift(sanitizeNote({ ...fields, category, createdAt: now, updatedAt: now }));
    }
    // Which list quick add goes into — a setting, as it's one list for all
    // your devices, not something the note itself carries.
    const savedId = editingNoteId || (state.data.notes[0] && state.data.notes[0].id);
    const settings = state.data.settings;
    if (kind === "list" && $("#nQuickList").checked) settings.quickList = savedId;
    else if (settings.quickList === savedId) delete settings.quickList;
    closeNoteModal();
    render();
    await persist();
  }

  async function deleteNote() {
    if (!editingNoteId) return;
    if (!confirm("Delete this note?")) return;
    state.data.notes = state.data.notes.filter((n) => n.id !== editingNoteId);
    closeNoteModal();
    render();
    await persist();
    toast("Note deleted");
  }

  function wire() {
    $("#noteForm").onsubmit = saveNoteFromForm;
    $("#cancelNoteBtn").onclick = closeNoteModal;
    $("#deleteNoteBtn").onclick = deleteNote;
    $("#noteToEntryBtn").onclick = makeEntryFromNote;
    document.querySelectorAll("#noteKindSeg [data-kind]").forEach((b) => { b.onclick = () => setSheetKind(b.dataset.kind); });
    $("#nNewItem").onkeydown = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); addSheetItem(); }
      else if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") $("#noteForm").requestSubmit();
    };
    $("#nCategory").onchange = () => {
      const sel = $("#nCategory");
      if (sel.value !== NEW_CATEGORY) { sel.dataset.prev = sel.value; return; }
      // Back to where it was until the new one exists: cancelling the
      // category sheet must not leave "New category…" chosen.
      sel.value = sel.dataset.prev || "";
      openNoteCatModal(null, (name) => { fillCategorySelect(name); });
    };
    $("#noteCatForm").onsubmit = saveNoteCatFromForm;
    $("#cancelNoteCatBtn").onclick = closeNoteCatModal;
    $("#deleteNoteCatBtn").onclick = deleteNoteCategory;
    // Ctrl/Cmd+Enter saves from inside the textarea, where Enter is a
    // newline and the Save button is a reach away on a phone.
    $("#nText").onkeydown = (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") $("#noteForm").requestSubmit();
    };
  }

  window.LifeLogNotes = {
    init, wire,
    sanitizeNote, noteYears, getFilteredNotes, noteCats, openNoteCatModal, closeNoteCatModal, noteHaystack,
    sanitizeTodo, foldTodosIntoLists, listNotes: () => state.data.notes.filter((n) => n.kind === "list"),
    renderNotes, focusQuickList,
    openNoteModal, closeNoteModal,
    // pure helpers (test/notes.test.js)
    noteDate, noteYear, splitNoteForEntry,
  };
})();
