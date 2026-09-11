// LifeLog — Notes: a running feed of things written down as they happen,
// as the Timeline view's second mode rather than a tab of its own (the
// phone's bottom nav is full; see NOTES.md for why Discover went the same
// way). A note is text and a timestamp and nothing else — no title, no
// category, no rating — because the whole point is that writing one costs
// nothing. Shared app plumbing arrives via init(ctx), same as every other
// view module.
(function () {
  let state, $, el, uid, toast, persist, render, renderLazySections, groupBy,
    monthCardHeader, emptyState, backfillUpdatedAt, keepUnknown, MONTHS;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, renderLazySections, groupBy,
      monthCardHeader, emptyState, backfillUpdatedAt, keepUnknown, MONTHS } = ctx);
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

  // The card's *contents*. Its click and key handlers are not here — see
  // createNoteCard, and NOTES.md on why they can't be.
  function noteCard(n) {
    const card = el("div", "note-card");
    card.dataset.id = n.id;
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
  function createNoteCard() {
    const card = el("div", "note-card");
    const open = () => {
      const n = (state.data.notes || []).find((x) => x.id === card.dataset.id);
      if (n) openNoteModal(n);
    };
    card.onclick = open;
    card.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); }
    };
    return card;
  }

  // A month's header plus its notes, keyed so a note keeps its card across a
  // render. The header rides in the same list under a reserved key, which
  // keeps the card's DOM shape exactly what it was.
  function fillMonthCard(card, label, notes) {
    const parts = [{ key: "__head", kind: "head", label, count: notes.length }];
    for (const n of notes) parts.push({ key: n.id, kind: "note", note: n });
    reconcile(card, parts, {
      animate: true,
      keyOf: (part) => part.key,
      create: (part) => (part.kind === "head" ? el("h3") : createNoteCard()),
      update: (node, part) => adopt(node, part.kind === "head"
        // No "+" on a month: a note is stamped with the moment it's written,
        // so there is no such thing as adding one to March.
        ? monthCardHeader(part.label, part.count, [], null)
        : noteCard(part.note)),
    });
  }

  // The shell outlives a render. app.js still clears #viewBody on its way
  // through (that comes out last — see TODO.md), so holding this subtree is
  // what lets the year sections, month cards and note cards survive: clearing
  // a parent detaches these nodes without destroying them.
  let notesRootEl = null, notesEmptyEl = null;

  function renderNotes(root) {
    if (!notesRootEl) notesRootEl = document.createElement("div");
    const shell = notesRootEl;
    root.appendChild(shell);

    const showEmpty = (node) => {
      // Hands the section machinery an empty list so it drops the year blocks
      // it is still holding; without this they'd sit under the empty state.
      renderLazySections(shell, []);
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
              fillMonthCard(card, MONTHS[c.month], c.notes);
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
  }

  // ---------- modal ----------
  let editingNoteId = "";

  function openNoteModal(note) {
    editingNoteId = note ? note.id : "";
    $("#noteModalTitle").textContent = note ? "Edit note" : "New note";
    $("#nText").value = note ? note.text : "";
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
    noteDate, noteYear,
  };
})();
