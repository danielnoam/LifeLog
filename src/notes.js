// LifeLog — Notes: a running feed of things written down as they happen,
// as the Timeline view's second mode rather than a tab of its own (the
// phone's bottom nav is full; see NOTES.md for why Discover went the same
// way). A note is text and a timestamp and nothing else — no title, no
// category, no rating — because the whole point is that writing one costs
// nothing. Shared app plumbing arrives via init(ctx), same as every other
// view module.
(function () {
  let state, $, el, uid, toast, persist, render, renderLazySections, groupBy,
    monthCardHeader, emptyState, backfillUpdatedAt, keepUnknown, MONTHS,
    bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
    openEntryModal;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, renderLazySections, groupBy,
      monthCardHeader, emptyState, backfillUpdatedAt, keepUnknown, MONTHS,
      bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
      openEntryModal } = ctx);
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
  const KNOWN_NOTE_KEYS = new Set(["id", "text", "createdAt", "editedAt", "updatedAt"]);
  function sanitizeNote(n) {
    const out = {
      id: n.id || uid(),
      text: String(n.text == null ? "" : n.text),
      createdAt: n.createdAt || null,
      updatedAt: backfillUpdatedAt(n),
    };
    if (n.editedAt) out.editedAt = n.editedAt;
    return keepUnknown(n, out, KNOWN_NOTE_KEYS);
  }

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

  // The category chips don't apply here (a note has no category), so only
  // the year chips and the shared search box narrow this.
  function getFilteredNotes() {
    const q = state.search.trim().toLowerCase();
    const yf = state.activeYears;
    return state.data.notes.filter((n) => {
      if (yf.size && !yf.has(noteYear(n))) return false;
      if (q && !n.text.toLowerCase().includes(q)) return false;
      return true;
    });
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
    card.appendChild(stamp);
    // textContent, never innerHTML: a note is whatever you typed, and the
    // white-space CSS is what keeps your line breaks.
    card.appendChild(el("p", "note-text", n.text));
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    return card;
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
  // through (that comes out last — see TODO.md), so holding this subtree is
  // what lets the year sections, month cards and note cards survive: clearing
  // a parent detaches these nodes without destroying them.
  let notesRootEl = null, notesEmptyEl = null, notesBulkEl = null;

  function renderNotes(root) {
    if (!notesRootEl) notesRootEl = document.createElement("div");
    const shell = notesRootEl;
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

    // Same year → month shape as the timeline beside it, and the same month
    // order setting, so switching modes doesn't rearrange the page under
    // you. Within a month the notes run in that same direction: a feed read
    // newest-first inside an oldest-first month would fight itself.
    const desc = state.data.settings.monthOrder !== "asc";
    const byYear = groupBy(notes, noteYear);
    const sections = [];
    for (const y of Object.keys(byYear).sort((a, b) => b - a)) {
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
          const byMonth = groupBy(byYear[y], (n) => noteDate(n).getMonth() + 1);
          const months = Object.keys(byMonth).sort(desc ? (a, b) => b - a : (a, b) => a - b);
          const cards = months.map((m) => ({
            key: y + "-" + m,
            year: +y,
            month: +m,
            notes: byMonth[m].slice().sort((a, b) =>
              desc ? noteDate(b) - noteDate(a) : noteDate(a) - noteDate(b)),
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
    // the timeline uses. No onMove: a note has no category to be moved into.
    if (notesBulkEl) { notesBulkEl.remove(); notesBulkEl = null; }
    if (state.bulk.active) {
      notesBulkEl = bulkActionBar({ categories: [], onDelete: bulkDeleteNotesSelected });
      root.appendChild(notesBulkEl);
    }
  }

  // ---------- bulk actions ----------
  // Delete is the only one. Moving needs categories, syncing needs media, and
  // turning a pile of notes into entries at once would need a title and a
  // category decided per note — which is the single-note flow below, and not
  // something a bar can do for twenty of them.
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
  let editingNoteId = "";

  function openNoteModal(note) {
    editingNoteId = note ? note.id : "";
    $("#noteModalTitle").textContent = note ? "Edit note" : "New note";
    $("#nText").value = note ? note.text : "";
    $("#deleteNoteBtn").hidden = !note;
    // Only on a saved note: an unsaved one has nothing to convert yet, and
    // "Make entry" before "Save" would read as a choice between the two.
    $("#noteToEntryBtn").hidden = !note;
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
    $("#noteModal").hidden = false;
    $("#nText").focus();
  }
  function closeNoteModal() { $("#noteModal").hidden = true; }

  async function saveNoteFromForm(ev) {
    ev.preventDefault();
    const text = $("#nText").value.trim();
    if (!text) return;
    const now = new Date().toISOString();
    if (editingNoteId) {
      const n = state.data.notes.find((x) => x.id === editingNoteId);
      if (n) {
        // Only a real change counts as an edit — reopening a note, reading
        // it and pressing Save shouldn't relabel it as edited.
        if (n.text !== text) { n.text = text; n.editedAt = now; }
      }
    } else {
      state.data.notes.unshift(sanitizeNote({ text, createdAt: now, updatedAt: now }));
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
    // Ctrl/Cmd+Enter saves from inside the textarea, where Enter is a
    // newline and the Save button is a reach away on a phone.
    $("#nText").onkeydown = (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") $("#noteForm").requestSubmit();
    };
  }

  window.LifeLogNotes = {
    init, wire,
    sanitizeNote, noteYears, getFilteredNotes,
    renderNotes,
    openNoteModal, closeNoteModal,
    // pure helpers (test/notes.test.js)
    noteDate, noteYear, splitNoteForEntry,
  };
})();
