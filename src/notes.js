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
  const KNOWN_NOTE_KEYS = new Set(["id", "text", "createdAt", "editedAt", "updatedAt", "kind", "category", "author", "source", "items"]);
  function sanitizeNote(n) {
    const out = {
      id: n.id || uid(),
      text: String(n.text == null ? "" : n.text),
      createdAt: n.createdAt || null,
      updatedAt: backfillUpdatedAt(n),
    };
    if (n.editedAt) out.editedAt = n.editedAt;
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
    if (n.category) {
      const cat = el("span", "note-cat");
      const dot = el("span", "dot"); dot.style.background = catColor(n.category);
      cat.append(dot, document.createTextNode(n.category));
      stamp.appendChild(cat);
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
      if (n.text) card.appendChild(el("p", "note-text note-list-title", n.text));
      card.appendChild(listPreview(n));
    } else card.appendChild(el("p", "note-text", n.text));
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    return card;
  }

  // A checklist on its card: the open items, tickable right there, then how
  // many are done. Ticking isn't editing — the text didn't change, so
  // editedAt stays as it was.
  const LIST_PREVIEW = 8;
  function listPreview(n) {
    const wrap = el("div", "note-items");
    const items = n.items || [];
    const open = items.filter((i) => !i.done), done = items.length - open.length;
    for (const it of open.slice(0, LIST_PREVIEW)) {
      const row = el("label", "note-item");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("aria-label", "Done: " + it.text);
      // The card opens the note on a click; a tick mustn't.
      row.addEventListener("click", (ev) => ev.stopPropagation());
      row.addEventListener("keydown", (ev) => ev.stopPropagation());
      cb.onchange = () => tickItem(n.id, it.id, cb.checked);
      row.append(cb, el("span", "note-item-text", it.text));
      wrap.appendChild(row);
    }
    const more = open.length - LIST_PREVIEW;
    const tail = [more > 0 ? `+${more} more` : "", done ? `✓ ${done} done` : ""].filter(Boolean).join(" · ");
    if (tail) wrap.appendChild(el("div", "note-items-more", tail));
    if (!items.length) wrap.appendChild(el("div", "note-items-more", "Empty list"));
    return wrap;
  }
  async function tickItem(noteId, itemId, done) {
    const n = state.data.notes.find((x) => x.id === noteId);
    const it = n && (n.items || []).find((i) => i.id === itemId);
    if (!it) return;
    if (done) { it.done = true; it.doneAt = new Date().toISOString(); } else { delete it.done; delete it.doneAt; }
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
    card.onclick = activate;
    card.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); activate(); }
    };
    attachLongPressSelect(card, { id });
    return card;
  }

  // A month's header plus its notes, keyed so a note keeps its card across a
  // render. The header rides in the same list under a reserved key, which
  // keeps the card's DOM shape exactly what it was.
  function fillMonthCard(card, label, notes, current) {
    const parts = [{ key: "__head", kind: "head", label, count: notes.length, current }];
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
    const byYear = groupBy(notes, (n) => sortDate(n).getFullYear());
    const sections = [];
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
    renderNotes,
    openNoteModal, closeNoteModal,
    // pure helpers (test/notes.test.js)
    noteDate, noteYear, splitNoteForEntry,
  };
})();
