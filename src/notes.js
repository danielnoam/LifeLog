// LifeLog — Notes: a running feed of things written down as they happen.
// Writing one still costs nothing — text and a timestamp — but since
// 0.195.0 a note can be one of three kinds (plain text, a checklist, a
// quote with its author) and can carry a category of its own. Shared app
// plumbing arrives via init(ctx), same as every other view module.
(function () {
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  // Settings → Dates (0.301.0). Under Node nothing loaded dates.js.
  const Dates = () => window.LifeLogDates || require("./dates.js");
  const Tasks = () => window.LifeLogTasks || require("./tasks.js");
  const Tags = () => window.LifeLogTags || require("./tags.js");

  const ico = (n, c) => window.LifeLogIcons.svg(n, c);
  let state, $, el, uid, toast, persist, render, renderLazySections, groupBy,
    monthCardHeader, emptyState, backfillUpdatedAt, keepUnknown, MONTHS,
    bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
    openEntryModal, DEFAULT_SETTINGS, CATEGORY_PALETTE, buildCatFilter, sortSelect, attachSwipe;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, renderLazySections, groupBy,
      monthCardHeader, emptyState, backfillUpdatedAt, keepUnknown, MONTHS,
      bulkActionBar, bulkCheckbox, toggleBulkItem, attachLongPressSelect,
      openEntryModal, DEFAULT_SETTINGS, CATEGORY_PALETTE, buildCatFilter, sortSelect, attachSwipe } = ctx);
    const CM = window.LifeLogContextMenu;
    if (CM) CM.register("note", noteMenu);
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
  //   plain text   no `kind` — every note written before there were kinds.
  //                May have a `title` (0.199.0), shown above the text.
  //   "list"       `text` is the title, `items` the checklist: { id, text,
  //                done?, doneAt?, updatedAt? }. Items have ids so two devices
  //                ticking different ones merge (merge.js mergeNotes), and
  //                their own updatedAt so an item both changed goes to the
  //                newer edit.
  //   "quote"      `text` is the quote, with `author` and `source`.
  // `category` names one of state.data.noteCategories.
  const KINDS = ["text", "list", "quote"];
  const KNOWN_NOTE_KEYS = new Set(["id", "text", "title", "createdAt", "editedAt", "updatedAt", "kind", "category", "author", "source", "items", "fav", "pinned", "tags", "template"]);
  function sanitizeNote(n) {
    const out = {
      id: n.id || uid(),
      text: String(n.text == null ? "" : n.text),
      createdAt: n.createdAt || null,
      updatedAt: backfillUpdatedAt(n),
    };
    if (n.editedAt) out.editedAt = n.editedAt;
    if (n.fav) out.fav = true;
    // Shown on the Home tab (home.js); it stays in the Notebook too.
    if (n.pinned) out.pinned = true;
    // A template (Nov 2026): kept out of the lists, offered when a new note
    // of its kind starts. Notes and task lists only.
    if (n.template && n.kind !== "quote") out.template = true;
    if (n.kind === "list" || n.kind === "quote") out.kind = n.kind;
    const title = String(n.title == null ? "" : n.title).trim();
    if (title && !out.kind) out.title = title;
    const cat = String(n.category == null ? "" : n.category).trim();
    if (cat) out.category = cat;
    // Tags (Nov 2026), across every kind; see tags.js.
    const tags = Tags().clean(n.tags);
    if (tags.length) out.tags = tags;
    if (out.kind === "quote") {
      for (const k of ["author", "source"]) { const v = String(n[k] == null ? "" : n[k]).trim(); if (v) out[k] = v; }
    }
    if (out.kind === "list") {
      // An item keeps the fields this build doesn't know: tasks (dates,
      // priority, subtasks) are coming, and a device still on this build
      // must not strip them from a list it saves.
      // Built over a copy so the keys keep the order they came in: the
      // merge compares items as JSON, and a tick drained on top of a
      // sanitized item would otherwise read as an edit from elsewhere.
      out.items = (Array.isArray(n.items) ? n.items : []).map((it) => {
        const src = it && typeof it === "object" ? it : {};
        const item = { ...src, id: src.id || uid(), text: String(src.text != null ? src.text : "").trim() };
        if (src.done) { item.done = true; item.doneAt = src.doneAt || out.updatedAt; } else { delete item.done; delete item.doneAt; }
        if (!item.updatedAt) delete item.updatedAt;
        return Tasks().cleanItem(item);
      }).filter((it) => it.text);
      Tasks().cleanParents(out.items);
    }
    const kept = keepUnknown(n, out, KNOWN_NOTE_KEYS);
    // A list is a task itself (16 Nov 2026): its date, priority and the rest.
    if (out.kind === "list") Tasks().cleanHead(kept);
    return kept;
  }
  const kindOf = (n) => n.kind || "text";
  const openItems = (n) => (n.kind === "list" ? (n.items || []).filter((i) => !i.done) : []);

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
  // A picture's address isn't something you'd search for; its alt text is.
  const IMG_REF = /!\[([^\]]*)\]\(lifelog-img:[^)]*\)/g;
  const noteHaystack = (n) => [n.title, String(n.text || "").replace(IMG_REF, "$1"), n.boardText, n.author, n.source, n.category, ...(n.tags || []), ...(n.items || []).flatMap((i) => [i.text, i.note, ...(i.tags || [])])]
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

  // Boards in the feed and in collections (0.206.0): each one as a
  // note-shaped stand-in, keyed "board:<id>", which the cards know to draw
  // as a picture and open in the board editor. Only for All — the Boards
  // kind is boards.js's own page. Since 0.208.0 they stay while selecting:
  // the bulk bar moves and deletes them with the notes.
  const BOARD = "board:";
  const isBoardItem = (n) => n.kind === "board";
  let boardsAsked = false;
  function boardItems() {
    const B = window.LifeLogBoards;
    if (!B) return [];
    if (!B.isLoaded()) {
      if (!boardsAsked) { boardsAsked = true; B.ensureLoaded().then(() => render()).catch(() => {}); }
      return [];
    }
    return B.boardsNow().map((b) => ({
      id: BOARD + b.id, kind: "board", text: b.name, boardText: B.boardText(b), category: b.category, ...(b.tags ? { tags: b.tags } : {}),
      createdAt: b.createdAt || b.updatedAt, updatedAt: b.updatedAt, board: b, ...(b.fav ? { fav: true } : {}),
    }));
  }

  // Years, categories and types (the chip rows) and
  // the shared search box all narrow this. A category chip keyed "" is the
  // notes with none, as in the to-do list.
  // A tag chip, or #tag in the search box, keeps whatever carries any of
  // the tags, as category chips do (Daniel, 2026-11-15). A list counts when
  // one of its tasks carries one.
  const tagKeys = () => {
    const T = Tags();
    return new Set([...(state.noteActiveTags || []), ...T.parseQuery(state.search).tags].map(T.key));
  };
  const tagged = (n, keys) => Tags().hasAny(n.tags, keys) || (n.items || []).some((i) => Tags().hasAny(i.tags, keys));
  function getFilteredNotes() {
    const { text: words } = Tags().parseQuery(state.search);
    const q = words.toLowerCase();
    const tf = tagKeys();
    const yf = state.activeYears, cf = state.noteActiveCats;
    // Templates have a chip of their own and show only under it.
    const templates = state.noteKinds.has("template");
    const kinds = new Set([...state.noteKinds].filter((k) => k !== "template"));
    const pool = !templates && (!kinds.size || kinds.has("board")) ? state.data.notes.concat(boardItems()) : state.data.notes;
    return pool.filter((n) => {
      if (!!n.template !== templates) return false;
      // A collection is by name, not by when: the year chips don't reach it.
      if (yf.size && !openCollections() && !yf.has(noteYear(n))) return false;
      // A list is found through a task filed under the category too.
      if (cf.size && !cf.has(n.category || "") && !(n.items || []).some((i) => i.category && cf.has(i.category))) return false;
      if (kinds.size && !kinds.has(kindOf(n))) return false;
      if (tf.size && !tagged(n, tf)) return false;
      if (feedOnly() && isCollection(n.category)) return false;
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
  const collectionSort = () => state.data.settings.collectionSort || "title";
  async function setCollectionSort(value) {
    state.data.settings.collectionSort = value;
    render();
    await persist();
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
  // A category can be a collection (0.204.0): reference notes — recipes,
  // how-tos, software — kept by name rather than by the day they were
  // written. Their notes leave the dated feed; the collection's chip opens them.
  const isCollection = (name) => !!name && (noteCats().find((c) => c.name === name) || {}).layout === "collection";
  const collections = () => noteCats().filter((c) => c.layout === "collection");
  // The collections being looked at: every category chip that's on is a
  // collection (0.221.0; it was exactly one until then). Several show as one
  // page of cards. A collection beside a plain category is the feed instead,
  // the two filtered together like any other chips.
  function openCollections() {
    const cf = [...state.noteActiveCats];
    return cf.length && cf.every(isCollection) ? cf : null;
  }
  // The feed proper: no category picked, no search, and showing all notes or
  // plain ones. That's where collections' notes stand aside.
  const feedOnly = () => !state.noteActiveCats.size && !(state.noteActiveTags && state.noteActiveTags.size) && !state.search.trim() && (!state.noteKinds.size || state.noteKinds.has("text"));
  // Boards on their own are the Boards page; beside anything else, cards.
  const boardsPage = () => state.noteKinds.size === 1 && state.noteKinds.has("board");
  let catSaved = null; // what to do with a category made from the note sheet
  let catTags = [], catTagField = null; // the sheet's Tags for new notes
  const catTagsOf = (name) => ((noteCats().find((c) => c.name === name) || {}).tags || []);
  function openNoteCatModal(cat, onSaved) {
    const editing = !!cat;
    catSaved = onSaved || null;
    $("#noteCatModalTitle").textContent = editing ? i18n.t("Edit note category") : i18n.t("Add note category");
    $("#noteCatOrigName").value = editing ? cat.name : "";
    $("#noteCatName").value = editing ? cat.name : "";
    $("#noteCatColorInput").value = editing ? cat.color : CATEGORY_PALETTE[noteCats().length % CATEGORY_PALETTE.length];
    $("#noteCatCollection").checked = !!(editing && cat.layout === "collection");
    // How many use it, beside the title (Daniel, 2026-11-15: it sat above
    // the buttons, where it read as part of them).
    const uses = $("#noteCatUses");
    if (editing) {
      const n = state.data.notes.filter((x) => x.category === cat.name).length;
      uses.textContent = i18n.tn(n, "{n} note", "{n} notes");
      uses.hidden = false;
    } else uses.hidden = true;
    catTags = editing ? (cat.tags || []).slice() : [];
    catTagField = Tags().field($("#noteCatTags"), { get: () => catTags, set: (v) => { catTags = v; }, known: tagCounts, label: i18n.t("Tags for new notes") });
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
    const layout = $("#noteCatCollection").checked ? "collection" : "";
    if (!name) return;
    const cats = noteCats();
    const clash = (c) => c.name.toLowerCase() === name.toLowerCase();
    const after = catSaved;
    if (!orig) {
      if (cats.some(clash)) { toast(i18n.t("That category already exists"), true); return; }
      const fresh = { id: uid(), name, color, ...(layout ? { layout } : {}), updatedAt: new Date().toISOString() };
      Tags().setOn(fresh, catTags);
      cats.push(fresh);
    } else {
      const cat = cats.find((c) => c.name === orig);
      if (!cat) return;
      if (name !== cat.name && cats.some((c) => c !== cat && clash(c))) { toast(i18n.t("A category with that name already exists"), true); return; }
      cat.color = color;
      if (layout) cat.layout = layout; else delete cat.layout;
      Tags().setOn(cat, catTags);
      if (name !== cat.name) {
        // The id is the category's sync identity; only its name moves, and
        // every note holding the old one follows it.
        const old = cat.name;
        cat.name = name;
        renameNoteCategory(state.data, old, name);
        window.LifeLogBoards.renameCategory(old, name);
        if (state.noteActiveCats.has(old)) { state.noteActiveCats.delete(old); state.noteActiveCats.add(name); }
      }
    }
    closeNoteCatModal();
    buildCatFilter();
    render();
    await persist();
    if (after) after(name);
  }
  // Notes name their category; `to` null leaves them uncategorised. Boards
  // carry the same names in their own file (LifeLogBoards.renameCategory).
  function renameNoteCategory(data, from, to) {
    for (const n of data.notes || []) {
      if (n.category !== from) continue;
      if (to) n.category = to; else delete n.category;
    }
  }
  async function deleteNoteCategory() {
    const cats = noteCats();
    const cat = cats.find((c) => c.name === $("#noteCatOrigName").value);
    if (!cat) return;
    const using = state.data.notes.filter((n) => n.category === cat.name);
    if (!confirm(using.length
      ? i18n.tn(using.length, "“{category}” is used by {n} note. Delete it and leave it uncategorised?", "“{category}” is used by {n} notes. Delete it and leave them uncategorised?", { category: cat.name })
      : i18n.t("Delete note category “{category}”?", { category: cat.name }))) return;
    renameNoteCategory(state.data, cat.name, null);
    window.LifeLogBoards.renameCategory(cat.name, null);
    state.data.noteCategories = cats.filter((c) => c !== cat);
    state.noteActiveCats.delete(cat.name);
    closeNoteCatModal();
    buildCatFilter();
    render();
    await persist();
    toast(i18n.t("Note category deleted"));
  }

  // ---------- the mode bar: the sort ----------
  // The kind switch that sat here is a row of the filter bar since 0.213.0
  // (buildKindFilter in app.js). Boards are a kind of note since 0.204.0.
  const boardsOn = () => !!window.LifeLogBoards;
  // The count shares the sort's line (0.215.0); it had a strip of its own
  // above, which on a phone was a whole row for "4 notes".
  function renderNotesToolbar(root) {
    const count = state.data.notes.length;
    if (!count) return;
    const bar = el("div", "notes-toolbar");
    bar.appendChild(el("span", "notes-count", i18n.tn(count, "{n} note", "{n} notes")));
    // Boards run newest first; a collection sorts by name, and has its own.
    if (boardsPage()) { /* nothing to sort */ }
    else if (openCollections()) bar.appendChild(sortSelect("collection", collectionSort(), setCollectionSort));
    else bar.appendChild(sortSelect("notes", noteSort(), setNoteSort));
    root.appendChild(bar);
  }

  // ---------- rendering ----------
  function formatStamp(d) {
    return Dates().day(d, { weekday: true, year: "auto" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  function formatEdited(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : Dates().day(d);
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
      if (edited) stamp.appendChild(el("span", "note-edited", " · " + i18n.t("edited {when}", { when: edited })));
    }
    // A list shows its category as its header's dot, as the old panels did.
    if (n.category && (n.kind !== "list" || state.bulk.active)) {
      const cat = el("span", "note-cat");
      const dot = el("span", "dot"); dot.style.background = catColor(n.category);
      cat.append(dot, document.createTextNode(n.category));
      stamp.appendChild(cat);
    }
    // A list's tags sit in its header, by its title.
    if (n.tags && (n.kind !== "list" || state.bulk.active)) stamp.appendChild(tagPills(n.tags));
    // ★ keeps a note at the top, above the years (0.196.0) — a board too (0.208.0).
    // At the card's top right since tags (Daniel, 2026-11-15), floated so
    // the first line runs beside it; a list's is in its header.
    const kind = kindOf(n);
    if (!state.bulk.active && kind !== "list") card.appendChild(favButton(n));
    if (isBoardItem(n)) return boardCard(card, n, stamp);
    // textContent, never innerHTML: a note is whatever you typed, and the
    // white-space CSS is what keeps your line breaks.
    card.classList.toggle("is-quote", kind === "quote");
    card.classList.toggle("is-list", kind === "list");
    if (kind === "quote") {
      const q = el("blockquote", "note-text note-quote", n.text);
      card.appendChild(q);
      const by = [n.author, n.source].filter(Boolean).join(", ");
      if (by) card.appendChild(el("p", "note-author", "— " + by));
    } else if (kind === "list") {
      if (state.bulk.active) bulkListPreview(card, n);
      else listPanel(card, n);
    } else {
      if (n.title) card.appendChild(el("h4", "note-title", n.title));
      if (n.text) card.appendChild(noteBody(n.text));
    }
    // The words first, when and where at the foot, as in the note itself.
    card.appendChild(stamp);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    return card;
  }

  function favButton(n) {
    const fav = own(el("button", "note-fav" + (n.fav ? " on" : "")));
    fav.appendChild(ico("star", n.fav ? "is-fill" : ""));
    fav.type = "button";
    fav.title = n.fav ? i18n.t("Remove from favourites") : i18n.t("Add to favourites");
    fav.setAttribute("aria-label", fav.title);
    fav.setAttribute("aria-pressed", String(!!n.fav));
    fav.onclick = () => (isBoardItem(n) ? window.LifeLogBoards.toggleFav(n.board.id) : toggleFav(n.id));
    return fav;
  }

  // A card's tags: quiet outlined pills, each a way to show everything
  // with that tag (one that's on is filled in the accent).
  function tagPills(tags, { buttons = true } = {}) {
    const wrap = el("span", "tag-pills");
    const on = new Set([...(state.noteActiveTags || [])].map(Tags().key));
    for (const t of tags) {
      const lit = on.has(Tags().key(t));
      if (!buttons) { wrap.appendChild(el("span", "tag-pill" + (lit ? " on" : ""), t)); continue; }
      const b = own(el("button", "tag-pill" + (lit ? " on" : ""), t));
      b.type = "button";
      b.title = lit ? i18n.t("Stop showing only “{tag}”", { tag: t }) : i18n.t("Show everything tagged “{tag}”", { tag: t });
      b.setAttribute("aria-pressed", String(lit));
      b.onclick = () => toggleTagFilter(t);
      wrap.appendChild(b);
    }
    return wrap;
  }
  function toggleTagFilter(t) {
    const set = state.noteActiveTags;
    const k = Tags().key(t);
    const had = [...set].find((x) => Tags().key(x) === k);
    if (had) set.delete(had); else set.add(t);
    buildCatFilter();
    render();
  }
  // Everything's tags with their counts, for the chips, the All tags sheet
  // and the tag field's suggestions. Boards count once they've loaded.
  function tagCounts() {
    const B = window.LifeLogBoards;
    const boards = B && B.isLoaded && B.isLoaded() ? B.boardsNow() : [];
    return Tags().count(state.data.notes, boards, (state.data.settings || {}).tagNames);
  }

  // A board in the feed: its name, its picture, then its stamp and category.
  function boardCard(card, n, stamp) {
    card.classList.add("is-board");
    card.appendChild(el("p", "note-text note-list-title", n.text));
    const thumb = el("div", "board-thumb-inline");
    thumb.appendChild(window.LifeLogBoards.thumbnail(n.board));
    card.appendChild(thumb);
    card.appendChild(stamp);
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

  // Its items are tasks (tasks.js): a subtask sits under its task, folded
  // away by the chevron (per device), and moves with it.
  const FOLDS_KEY = "lifelog-task-folds-v1";
  let folds = null;
  function foldSet() {
    if (folds) return folds;
    try { folds = new Set(JSON.parse(localStorage.getItem(FOLDS_KEY) || "[]")); } catch (e) { folds = new Set(); }
    return folds;
  }
  function toggleFold(itemId) {
    const f = foldSet();
    if (f.has(itemId)) f.delete(itemId); else f.add(itemId);
    try { localStorage.setItem(FOLDS_KEY, JSON.stringify([...f])); } catch (e) {}
    render();
  }
  // The top-level rows, each with its subtasks.
  function taskTree(items) {
    const ids = new Set(items.map((i) => i.id));
    const top = items.filter((i) => !i.parent || !ids.has(i.parent));
    const kids = new Map(top.map((i) => [i.id, items.filter((c) => c.parent === i.id)]));
    return { top, kids };
  }

  function listPanel(card, n) {
    const items = n.items || [];
    const { top, kids } = taskTree(items);
    const open = items.filter((i) => !i.done);
    const openTop = top.filter((i) => !i.done), done = top.filter((i) => i.done).sort(byNewestDone);
    const reordering = listReorderId === n.id && openTop.length > 1;
    card.classList.toggle("is-reordering", reordering);

    const h = el("h3", "note-list-head" + (n.done ? " is-done" : ""));
    const left = el("span", "mc-left");
    // The list is a task too (16 Nov 2026): its own tick, ringed in its
    // priority, ticks every row (or moves a repeating list on).
    if (!reordering) {
      const cb = own(document.createElement("input"));
      cb.type = "checkbox";
      cb.className = "todo-check note-list-tick" + (n.priority ? " is-p" + n.priority : "");
      cb.checked = !!n.done;
      cb.setAttribute("aria-label", (n.done ? i18n.t("Mark as not done: {title}", { title: n.text || i18n.t("this list") }) : i18n.t("Mark as done: {title}", { title: n.text || i18n.t("this list") })));
      cb.onchange = () => tickItem(n.id, n.id, cb.checked);
      left.appendChild(cb);
    }
    if (n.category) { const dot = el("span", "dot"); dot.style.background = catColor(n.category); left.appendChild(dot); }
    left.appendChild(el("span", "note-list-title", reordering ? i18n.t("Drag to reorder") : (n.text || i18n.t("Untitled list"))));
    if (n.tags && !reordering) left.appendChild(tagPills(n.tags));
    h.appendChild(left);
    const right = el("span", "mc-right");
    // Next to the star and the star's size, bare like it (Daniel,
    // 2026-11-21/22); a ring turns round it while Trello syncs.
    // It opens the board: the Trello app takes the link where it's installed.
    const T = window.LifeLogTrello;
    if (!reordering && T && T.linked(n)) {
      const b = own(el("button", "note-trello" + (T.syncing() ? " is-syncing" : "")));
      b.type = "button";
      b.title = i18n.t("Open in Trello");
      b.setAttribute("aria-label", i18n.t("Open in Trello"));
      b.setAttribute("aria-busy", String(T.syncing()));
      b.append(el("span", "note-trello-ring"), ico("square-kanban"));
      b.onclick = (ev) => { ev.stopPropagation(); T.open(n); };
      right.appendChild(b);
    }
    // No open count beside the star (Daniel, 2026-11-22): the rows say it.
    if (!reordering) right.appendChild(favButton(n));
    if (reordering) {
      const btn = el("button", "btn btn-sm btn-primary", i18n.t("Done"));
      btn.type = "button";
      btn.onclick = (ev) => { ev.stopPropagation(); listReorderId = ""; render(); };
      right.appendChild(btn);
    }
    h.appendChild(right);
    card.appendChild(h);
    const headMeta = !reordering && taskMeta(n, n, [], { head: true });
    if (headMeta) { h.classList.add("has-meta"); card.appendChild(el("div", "note-list-head-meta")).appendChild(headMeta); }

    const rows = el("div", "note-list-rows");
    // A Trello board's lists are its sections (Nov 2026), each folding
    // under its name. Empty ones show too, so you see the board's lists
    // (Daniel, 2026-11-22). While reordering, a row dragged under another
    // section's name moves there (commitItemOrder).
    const secs = Tasks().sectionsOf(n);
    if (!secs && !items.length) rows.appendChild(el("p", "dsc-note", i18n.t("Nothing here.")));
    else if (!secs && !openTop.length) rows.appendChild(el("p", "dsc-note", i18n.t("All done.")));
    const withKids = (it) => {
      const sub = kids.get(it.id) || [];
      rows.appendChild(itemRow(n, it, { sub: false, kids: sub }));
      if (foldSet().has(it.id)) return;
      // A Trello card's subtasks under their checklists' names (Daniel,
      // 2026-11-22), when it has more than one or one not named Checklist.
      const lists = (it.trello && it.trello.checklists) || [];
      if (sub.length && (lists.length > 1 || (lists.length === 1 && !/^checklist$/i.test(lists[0].name)))) {
        const of = (c) => (lists.some((l) => l.id === (c.trello && c.trello.checklist)) ? c.trello.checklist : lists[0].id);
        for (const l of lists) {
          const mine = sub.filter((c) => of(c) === l.id);
          if (!mine.length) continue;
          rows.appendChild(el("div", "todo-checklist", l.name || i18n.t("Checklist")));
          for (const c of mine) rows.appendChild(itemRow(n, c, { sub: true }));
        }
        return;
      }
      for (const c of sub) rows.appendChild(itemRow(n, c, { sub: true }));
    };
    const put = (it) => { if (reordering) rows.appendChild(reorderRow(n, it, rows)); else withKids(it); };
    if (secs) {
      for (const sec of secs) {
        const mine = openTop.filter((it) => Tasks().sectionOf(n, it) === sec.id);
        const shut = !reordering && foldSet().has(n.id + "|" + sec.id);
        rows.appendChild(sectionHead(n, sec, mine.length, { shut, reordering }));
        if (!shut) mine.forEach(put);
        if (!reordering && !shut && sectionAdding === n.id + "|" + sec.id) rows.appendChild(sectionCompose(n, sec));
      }
    } else openTop.forEach(put);
    // The finished rows and the add line stay while reordering (greyed and
    // hidden, not removed): the card keeping its height is what keeps the
    // page from scrolling under a finger that is already holding a row.
    if (done.length) {
      rows.appendChild(el("div", "todo-done-sep", i18n.tn(done.length, "{n} done", "{n} done")));
      for (const it of done) withKids(it);
    }
    card.appendChild(rows);
    card.appendChild(listCompose(n));
  }

  // A section's name over its rows, with how many are open; pressing it
  // folds the section. Its + adds a task straight into it (Daniel,
  // 2026-11-22). Not a .todo-row, so a drag passes over it.
  function sectionHead(n, sec, count, { shut, reordering }) {
    const name = sec.name || i18n.t("Untitled list");
    const d = el("div", "todo-section");
    d.dataset.section = sec.id;
    if (reordering) {
      d.append(el("span", "todo-section-name", name), el("span", "todo-section-n", String(count)));
      return d;
    }
    const b = own(el("button", "todo-section-fold"));
    b.type = "button";
    b.setAttribute("aria-expanded", String(!shut));
    b.setAttribute("aria-label", (shut ? i18n.t("Show {name}", { name }) : i18n.t("Hide {name}", { name })) + ", " + i18n.tn(count, "{n} open", "{n} open"));
    b.append(ico(shut ? "chevron-right" : "chevron-down"), el("span", "todo-section-name", name), el("span", "todo-section-n", String(count)));
    b.onclick = () => toggleFold(n.id + "|" + sec.id);
    const add = own(el("button", "todo-section-add"));
    add.type = "button";
    add.title = i18n.t("Add to {group}", { group: name });
    add.setAttribute("aria-label", add.title);
    add.appendChild(ico("plus"));
    add.onclick = () => {
      if (shut) foldSet().delete(n.id + "|" + sec.id);
      sectionAdding = n.id + "|" + sec.id;
      render();
      const input = document.querySelector(`.note-card[data-id="${n.id}"] .todo-section-compose input`);
      if (input) input.focus();
    };
    d.append(b, add);
    return d;
  }

  // The add line a section's + opens under its rows: it adds into that
  // section, and stays open for the next until it's left empty.
  let sectionAdding = "";
  function sectionCompose(n, sec) {
    const key = n.id + "|" + sec.id;
    const wrap = own(el("div", "todo-compose note-list-compose todo-section-compose"));
    wrap.dataset.compose = key;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = i18n.t("Add to {group}", { group: sec.name || i18n.t("Untitled list") });
    input.autocomplete = "off";
    input.setAttribute("aria-label", input.placeholder);
    input.value = listDrafts.get(key) || "";
    const add = el("button", "btn btn-primary btn-sm", i18n.t("Add"));
    add.type = "button";
    add.disabled = !input.value.trim();
    const close = () => { if (sectionAdding === key) { sectionAdding = ""; listDrafts.delete(key); render(); } };
    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      listDrafts.delete(key);
      refocusListId = n.id;
      addItem(n.id, v, sec.id);
    };
    add.onclick = submit;
    input.oninput = () => { listDrafts.set(key, input.value); add.disabled = !input.value.trim(); };
    input.onkeydown = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); submit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); close(); }
    };
    // Left empty, it closes; a press on its own Add doesn't count as leaving.
    input.onblur = () => setTimeout(() => { if (wrap.isConnected && !input.value.trim() && !wrap.contains(document.activeElement)) close(); }, 150);
    wrap.append(input, add);
    return wrap;
  }

  // While selecting, a list keeps its items on its card, read-only: drawn as
  // its title alone, a list was a one-line card among full ones and you
  // couldn't tell which list you were ticking. A press anywhere selects it.
  function bulkListPreview(card, n) {
    card.appendChild(el("p", "note-text note-list-title", n.text || i18n.t("Untitled list")));
    const items = n.items || [];
    const open = items.filter((i) => !i.done), done = items.filter((i) => i.done).sort(byNewestDone);
    const rows = el("div", "note-list-rows is-preview");
    if (!items.length) rows.appendChild(el("p", "dsc-note", i18n.t("Nothing here.")));
    const row = (it) => {
      const r = el("div", "todo-row" + (it.done ? " is-done" : ""));
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "todo-check";
      cb.checked = !!it.done;
      cb.disabled = true;
      cb.tabIndex = -1;
      cb.setAttribute("aria-hidden", "true");
      r.append(cb, el("span", "todo-text", it.text));
      return r;
    };
    for (const it of open) rows.appendChild(row(it));
    if (done.length) {
      rows.appendChild(el("div", "todo-done-sep", i18n.tn(done.length, "{n} done", "{n} done")));
      for (const it of done) rows.appendChild(row(it));
    }
    card.appendChild(rows);
  }

  // Everything on a row stops at the row: the card underneath opens the note
  // on a click, and none of these should.
  const own = (node) => {
    for (const t of ["click", "keydown"]) node.addEventListener(t, (ev) => ev.stopPropagation());
    return node;
  };

  // A task's row: its tick (ringed in its priority's colour), its words
  // with one quiet line of what's set under them, and the ✕. Tapping the
  // words opens the task sheet (tasks.js), where it's renamed too.
  function itemRow(n, it, { sub = false, kids = [] } = {}) {
    const T = Tasks();
    const row = own(el("div", "todo-row" + (sub ? " is-sub" : "") + (it.done ? " is-done" : "")));
    row.dataset.item = it.id;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "todo-check" + (it.priority ? " is-p" + it.priority : "");
    cb.checked = !!it.done;
    cb.setAttribute("aria-label", (it.done ? i18n.t("Mark as not done: {title}", { title: it.text }) : i18n.t("Mark as done: {title}", { title: it.text })));
    cb.onchange = () => tickItem(n.id, it.id, cb.checked);
    row.appendChild(cb);
    const body = el("button", "todo-body");
    body.type = "button";
    body.appendChild(el("span", "todo-text", it.text));
    const meta = taskMeta(n, it, kids);
    if (meta) { body.appendChild(meta); row.classList.add("has-meta"); }
    body.setAttribute("aria-label", i18n.t("Open {title}", { title: it.text }));
    body.onclick = () => T.openTask(n.id, it.id);
    row.appendChild(body);
    if (kids.length) {
      const shut = foldSet().has(it.id);
      const fold = el("button", "todo-fold");
      fold.type = "button";
      fold.appendChild(ico(shut ? "chevron-right" : "chevron-down"));
      fold.setAttribute("aria-label", (shut ? i18n.t("Show subtasks of {title}", { title: it.text }) : i18n.t("Hide subtasks of {title}", { title: it.text })));
      fold.setAttribute("aria-expanded", String(!shut));
      fold.onclick = () => toggleFold(it.id);
      row.appendChild(fold);
    }
    const del = el("button", "todo-del");
    del.appendChild(ico("x"));
    del.type = "button";
    del.title = i18n.t("Delete");
    del.setAttribute("aria-label", i18n.t("Delete: {title}", { title: it.text }));
    del.onclick = () => deleteItem(n.id, it.id);
    row.appendChild(del);
    if (!it.done && !sub) attachLongPressReorder(row, n.id);
    return row;
  }
  // What's set on a task, in one line under it; null for a plain item.
  function taskMeta(n, it, kids, { head = false } = {}) {
    const T = Tasks();
    const today = T.today();
    const bits = [];
    const bit = (icon, text, cls) => {
      const b = el("span", cls || "");
      b.appendChild(ico(icon));
      if (text) b.appendChild(document.createTextNode(text));
      bits.push(b);
      return b;
    };
    if (!head && it.category && it.category !== n.category) {
      const b = el("span", "");
      const dot = el("span", "dot");
      dot.style.background = catColor(it.category);
      b.append(dot, document.createTextNode(it.category));
      bits.push(b);
    }
    if (it.date) {
      const late = !it.done && it.date < today;
      bit("calendar", T.shortDay(it.date, today) + (it.time ? " " + it.time : ""), late ? "is-late" : it.date === today && !it.done ? "is-today" : "");
    }
    if (it.remind != null && it.date) bit("bell", "").setAttribute("aria-label", i18n.t("Reminder: {when}", { when: T.remindText(it) }));
    if (it.repeat) bit("repeat", T.repeatText(it.repeat));
    if (it.deadline) bit("hourglass", i18n.t("Deadline {date}", { date: T.shortDay(it.deadline, today) }), !it.done && it.deadline < today ? "is-late" : "");
    if (it.note) bit("text", "").setAttribute("aria-label", i18n.t("Has a description"));
    if (kids && kids.length) bit("list-tree", kids.filter((c) => c.done).length + "/" + kids.length);
    // Spans, not buttons: the whole line is inside the row's button.
    if (it.tags && !head) bits.push(tagPills(it.tags, { buttons: false }));
    if (!bits.length) return null;
    const line = el("span", "todo-meta");
    line.append(...bits);
    return line;
  }

  function listCompose(n) {
    const wrap = own(el("div", "todo-compose note-list-compose"));
    const input = document.createElement("input");
    input.type = "text";
    // On a board it adds to the first list, and says so.
    const first = Tasks().sectionsOf(n) && n.sections[0];
    input.placeholder = first ? i18n.t("Add to {group}", { group: first.name || i18n.t("Untitled list") }) : i18n.t("Add an item…");
    input.autocomplete = "off";
    input.setAttribute("aria-label", i18n.t("Add to {group}", { group: (first && first.name) || n.text || i18n.t("this list") }));
    input.value = listDrafts.get(n.id) || "";
    const add = el("button", "btn btn-primary btn-sm", i18n.t("Add"));
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
      const card = `.note-card[data-id="${refocusListId}"]`;
      const input = document.querySelector(`${card} .todo-section-compose input`) || document.querySelector(`${card} .note-list-compose input`);
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
  async function togglePinned(noteId) {
    const n = (state.data.notes || []).find((x) => x.id === noteId);
    if (!n) return;
    if (n.pinned) delete n.pinned; else n.pinned = true;
    render();
    await persist();
    toast(n.pinned ? i18n.t("Pinned to Home") : i18n.t("Unpinned from Home"));
  }
  // The list itself ticks by its own id (16 Nov 2026).
  const HEAD_STATE = ["date", "deadline", "ticks", "done", "doneAt"];
  async function tickItem(noteId, itemId, done) {
    const n = findList(noteId);
    const it = n && (itemId === n.id ? n : (n.items || []).find((i) => i.id === itemId));
    if (!it) return;
    const before = (n.items || []).map((i) => ({ ...i }));
    const head = {};
    for (const k of HEAD_STATE) if (n[k] != null) head[k] = JSON.parse(JSON.stringify(n[k]));
    const r = Tasks().tick(n, itemId, done);
    await saveList(n, false);
    // A repeating task moved on rather than finishing: say where to, with
    // a way back for a tick that wasn't meant.
    if (r && r.next) toast(i18n.t("Next: {date}", { date: Tasks().shortDay(r.next, Tasks().today()) }), false, { label: i18n.t("Undo"), onClick: () => restoreItems(noteId, before, head) });
  }
  // A note's or quote's words changed from outside the sheet (a board's card).
  async function setNoteText(noteId, text) {
    const n = findList(noteId);
    if (!n || kindOf(n) === "list" || String(text) === (n.text || "")) return;
    n.text = String(text);
    n.editedAt = n.updatedAt = new Date().toISOString();
    render();
    await persist();
  }
  async function restoreItems(noteId, items, head) {
    const n = findList(noteId);
    if (!n) return;
    n.items = items;
    if (head) { for (const k of HEAD_STATE) delete n[k]; Object.assign(n, head); }
    await saveList(n, false);
  }
  async function addItem(noteId, text, section) {
    const n = findList(noteId);
    if (!n) return;
    n.items = n.items || [];
    // After the last open item, so it lands at the bottom of what's left to do.
    const lastOpen = n.items.map((i) => !i.done).lastIndexOf(true);
    n.items.splice(lastOpen + 1, 0, section ? { id: uid(), text, section } : { id: uid(), text });
    Tasks().reopen(n);
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
  // A task goes with its subtasks. Only a task with something to lose
  // (subtasks or a description) offers Undo; a plain row went as before.
  async function deleteItem(noteId, itemId, { always = false } = {}) {
    const n = findList(noteId);
    if (!n) return;
    const before = (n.items || []).map((i) => ({ ...i }));
    const it = before.find((i) => i.id === itemId);
    n.items = (n.items || []).filter((i) => i.id !== itemId && i.parent !== itemId);
    await saveList(n, true);
    if (it && (always || it.note || n.items.length < before.length - 1)) toast(i18n.t("Task deleted"), false, { label: i18n.t("Undo"), onClick: () => restoreItems(noteId, before) });
  }
  // Clear finished, in a list's ⋯ (Daniel, 2026-11-16: not on the card).
  // Takes the ticked rows off the page; saved with the rest when it closes.
  function clearDoneSheetItems() {
    const done = sheetItems.filter((i) => i.done);
    if (!done.length) return;
    const ids = new Set(done.map((i) => i.id));
    if (!confirm(i18n.tn(done.length, "Clear {n} finished item?", "Clear {n} finished items?"))) return;
    sheetItems = sheetItems.filter((i) => !ids.has(i.id) && !ids.has(i.parent));
    renderSheetItems();
    syncClearDone();
    toast(i18n.t("Cleared {n}", { n: done.length }));
  }
  function syncClearDone() {
    const b = $("#noteClearDoneBtn");
    if (b) b.hidden = sheetKind !== "list" || !sheetItems.some((i) => i.done);
  }

  // ---------- quick add (0.197.0) ----------
  // Quick add's and the home-screen shortcut's "To-do" lands in the list
  // most recently worked on, else a new "To-do" list. (A list chosen for it
  // in its sheet went in 0.199.0: a to-do widget showing one list adds to
  // that one, which is where the choice belonged.) `id` is that widget's.
  function quickList(id) {
    const lists = state.data.notes.filter((n) => n.kind === "list");
    const chosen = id && lists.find((n) => n.id === id);
    if (chosen) return chosen;
    const worked = (n) => String(n.editedAt || n.updatedAt || n.createdAt || "");
    return lists.sort((a, b) => worked(b).localeCompare(worked(a)))[0] || null;
  }
  async function focusQuickList(listId) {
    let n = quickList(listId);
    if (!n) {
      const now = new Date().toISOString();
      n = sanitizeNote({ kind: "list", text: "Tasks", items: [], createdAt: now, updatedAt: now });
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
  // A held finger picks the row up: the list turns into handles and the row
  // you are holding is already in your hand, so one gesture moves it. The
  // handles stay (and Done) for the next ones. 0.248.0; before, the hold
  // only switched modes and you had to take hold of the row again.
  const LONG_PRESS_MS = 400;
  const buzz = () => { if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) {} };
  function attachLongPressReorder(row, noteId) {
    let timer = null, start = null;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } start = null; };
    row.addEventListener("pointerdown", (ev) => {
      if (listReorderId || state.bulk.active) return;
      if (ev.button > 0 || ev.target.closest(".todo-check, .todo-del, .todo-edit")) return;
      start = { x: ev.clientX, y: ev.clientY };
      const itemId = row.dataset.item, pointerId = ev.pointerId;
      timer = setTimeout(() => {
        timer = null;
        listReorderId = noteId;
        buzz();
        const wasAt = row.getBoundingClientRect().top;
        render();
        const fresh = document.querySelector(`.todo-row.is-reorder[data-item="${itemId}"]`);
        if (!fresh) return;
        // If the page moved under the finger anyway, move it back.
        const dy = fresh.getBoundingClientRect().top - wasAt;
        if (Math.abs(dy) > 1) window.scrollBy(0, dy);
        beginRowDrag({ pointerId, clientX: start.x, clientY: start.y, preventDefault() {} }, fresh, fresh.parentElement, noteId);
      }, LONG_PRESS_MS);
    });
    row.addEventListener("contextmenu", (ev) => { if (start || listReorderId) ev.preventDefault(); });
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
    const grip = el("span", "todo-grip");
    grip.appendChild(ico("grip-vertical"));
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
  // The row rides under the finger (a transform from where it would sit),
  // kept inside the list; the others slide out of its way when its middle
  // crosses theirs. Near the top or bottom of the screen the page scrolls.
  // On release it settles into its slot before the order is written.
  function beginRowDrag(ev, row, list, noteId) {
    if (ev.button > 0) return;
    ev.preventDefault();
    row.classList.add("is-dragging");
    const height = row.getBoundingClientRect().height;
    const grab = ev.clientY - row.getBoundingClientRect().top;
    let y = ev.clientY, translate = 0, raf = 0, done = false;
    const css = getComputedStyle(document.documentElement);
    const top = (parseFloat(css.getPropertyValue("--topbar-h")) || 0) + 56;
    const bottom = window.innerHeight - (parseFloat(css.getPropertyValue("--bottombar-h")) || 0) - 56;
    const others = () => [...list.querySelectorAll(".todo-row")].filter((r) => r !== row);
    const place = () => {
      const rows = others();
      const natural = row.getBoundingClientRect().top - translate;
      const first = rows.length ? rows[0].getBoundingClientRect().top : natural;
      const last = rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom - height : natural;
      const want = Math.max(Math.min(first, natural), Math.min(Math.max(last, natural), y - grab));
      translate = want - natural;
      row.style.transform = "translateY(" + translate + "px)";
      // Where the finger says the row is, not where the list lets it sit:
      // pressed against the first row the clamped middle never crosses it.
      const mid = y - grab + height / 2;
      for (const other of rows) {
        const box = other.getBoundingClientRect();
        const rowIsAfter = !!(other.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (mid < box.top + box.height / 2 && rowIsAfter) { slideDisplaced(list, row, () => list.insertBefore(row, other)); return place(); }
        if (mid > box.top + box.height / 2 && !rowIsAfter) { slideDisplaced(list, row, () => list.insertBefore(row, other.nextSibling)); return place(); }
      }
    };
    const tick = () => {
      const step = y < top ? -12 : y > bottom ? 12 : 0;
      if (step) { window.scrollBy(0, step); place(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // The page must not scroll under a drag that began as a hold on a plain
    // row (its touch-action is the page's); refusing touchmove keeps it still.
    const holdPage = (e) => { if (e.cancelable) e.preventDefault(); };
    const onMove = (e) => { if (e.pointerId !== ev.pointerId) return; y = e.clientY; place(); };
    const onUp = (e) => {
      if (e.pointerId !== ev.pointerId || done) return;
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", holdPage);
      row.classList.remove("is-dragging");
      const settle = () => { row.classList.remove("is-settling"); commitItemOrder(list, noteId); };
      if (reducedMotion() || !translate) { row.style.transform = ""; settle(); return; }
      row.classList.add("is-settling");
      row.style.transform = "";
      let fired = false;
      const once = () => { if (!fired) { fired = true; settle(); } };
      row.addEventListener("transitionend", once, { once: true });
      setTimeout(once, 200);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", holdPage, { passive: false });
    place();
  }
  // The open items in the order the rows now stand, then the finished ones
  // where they were. A reorder isn't an edit.
  async function commitItemOrder(list, noteId) {
    const n = findList(noteId);
    if (!n) return;
    const order = [...list.querySelectorAll(".todo-row")].map((r) => r.dataset.item);
    const byId = new Map(n.items.map((i) => [i.id, i]));
    // Each row takes the section whose name it now stands under.
    let moved = false;
    if (Tasks().sectionsOf(n)) {
      let sec = null;
      for (const node of list.children) {
        if (node.dataset.section) { sec = node.dataset.section; continue; }
        const it = node.classList.contains("todo-row") && byId.get(node.dataset.item);
        if (it && sec && Tasks().sectionOf(n, it) !== sec) { it.section = sec; moved = true; }
      }
    }
    const open = order.map((id) => byId.get(id)).filter(Boolean);
    const rest = n.items.filter((i) => !order.includes(i.id));
    const next = [...open, ...rest];
    if (!moved && next.every((it, i) => it === n.items[i])) return;
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
      if (card.dataset.id.startsWith(BOARD)) { window.LifeLogBoards.openBoard(card.dataset.id.slice(BOARD.length)); return; }
      const n = (state.data.notes || []).find((x) => x.id === card.dataset.id);
      if (n) openNote(n);
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
    attachLongPressSelect(card, { id }, "note");
    return card;
  }

  // A pinned note on the Home tab (home.js): the Notebook's own card, with
  // its clicks, its ticks and its menu.
  function pinnedCard(n) {
    const card = noteCard(n);
    card.classList.add("home-pin");
    // No long press to select: Home has no bulk bar to act on a selection.
    const open = () => { const x = (state.data.notes || []).find((y) => y.id === n.id); if (x) openNote(x); };
    card.onclick = (ev) => {
      if (card.classList.contains("is-list") && !ev.target.closest(".note-list-head, .note-stamp")) return;
      open();
    };
    card.onkeydown = (ev) => { if (ev.target === card && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); open(); } };
    if (window.LifeLogContextMenu) window.LifeLogContextMenu.attach(card, "note", n.id);
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
    // Boards (0.204.0): drawn by boards.js, which keeps their own file.
    if (boardsPage() && boardsOn()) {
      renderLazySections(shell, []);
      if (notesBulkEl) { notesBulkEl.remove(); notesBulkEl = null; }
      window.LifeLogBoards.renderBoards(root);
      if (state.bulk.active) {
        notesBulkEl = notesBulkBar();
        root.appendChild(notesBulkEl);
      }
      return;
    }
    // A collection is a page of its own; the feed's year sections stand down.
    const coll = openCollections();
    if (coll) {
      renderLazySections(shell, []);
      if (notesBulkEl) { notesBulkEl.remove(); notesBulkEl = null; }
      root.appendChild(collectionView(coll));
      if (state.bulk.active) {
        notesBulkEl = notesBulkBar();
        root.appendChild(notesBulkEl);
      }
      return;
    }
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
        glyph: "pencil",
        title: i18n.t("No notes yet"),
        body: i18n.t("Write things down as you notice them. Each one keeps the date and time it was written, and you can edit it later."),
        action: i18n.t("Write your first note"),
        onAction: () => openNoteModal(null),
      }));
      return;
    }
    const notes = getFilteredNotes();
    if (!notes.length) {
      showEmpty(emptyState(feedOnly() && collections().length
        ? i18n.t("Nothing in the feed yet — everything so far is in a collection (▦ in the categories above).")
        : i18n.t("No notes match your filters.")));
      return;
    }
    if (notesEmptyEl) { notesEmptyEl.remove(); notesEmptyEl = null; }

    // Same year → month shape as the timeline. Within a month the notes run
    // in the same direction as the months: a feed read newest-first inside an
    // oldest-first month would fight itself. "Recently edited" files each
    // note under when it was last edited, and runs newest first.
    const desc = noteSort() !== "oldest";
    const bySort = (a, b) => (desc ? sortDate(b) - sortDate(a) : sortDate(a) - sortDate(b));
    // A block with no months: one card of notes under a heading of its own.
    const flatBlock = (key, title, count, list) => {
      const block = el("div", "year-block note-favs");
      block.dataset.year = key;
      const head = el("div", "year-head");
      head.appendChild(el("h2", null, title));
      head.appendChild(el("span", "ycount", count));
      block.appendChild(head);
      const grid = el("div", "month-grid");
      block.appendChild(grid);
      return {
        key, header: head, node: block, bodyEl: grid, keepBody: true,
        build: (body) => reconcile(body, [{ key }], {
          keyOf: (c) => c.key,
          create: () => el("div", "month-card"),
          update: (card) => fillMonthCard(card, "", list, false, true),
        }),
      };
    };
    const sections = [];
    // Favourites (0.196.0) sit above the years in a block of their own, and
    // not in their month as well: one place for each note. The filters still
    // apply to them, and they run in the same order as everything else.
    const favs = notes.filter((n) => n.fav).sort(bySort);
    // Trello's lists (Nov 2026), when View → Trello lists asks for it: a
    // block of their own after Favourites, out of their months. A favourite
    // stays in Favourites.
    const T = window.LifeLogTrello;
    const ownTrello = state.visual.noteTrelloGroup === "on" && T;
    const trello = ownTrello ? notes.filter((n) => !n.fav && T.linked(n)).sort(bySort) : [];
    const inTrello = new Set(trello);
    const byYear = sections.length ? {} : groupBy(notes.filter((n) => !n.fav && !inTrello.has(n)), (n) => sortDate(n).getFullYear());
    if (favs.length && !sections.length) {
      sections.push(flatBlock("favourites", i18n.t("Favourites"), i18n.tn(favs.length, "{n} note", "{n} notes"), favs));
    }
    if (trello.length) {
      sections.push(flatBlock("trello", i18n.t("Trello"), i18n.tn(trello.length, "{n} list", "{n} lists"), trello));
    }
    for (const y of Object.keys(byYear).sort((a, b) => (desc ? b - a : a - b))) {
      const block = el("div", "year-block");
      block.dataset.year = y;
      const head = el("div", "year-head");
      head.appendChild(el("h2", null, y));
      head.appendChild(el("span", "ycount", i18n.tn(byYear[y].length, "{n} note", "{n} notes")));
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
      notesBulkEl = notesBulkBar();
      root.appendChild(notesBulkEl);
    }
  }
  // A selection with Trello lists in it gets Sync and Remove instead of
  // Delete (Daniel, 2026-11-22): removing a synced list stops syncing it
  // and leaves its cards on Trello.
  const notesBulkBar = () => {
    const T = window.LifeLogTrello;
    const synced = T ? T.syncedIn(state.bulk.selected) : [];
    return bulkActionBar({
      categories: noteCats(),
      onMove: noteCats().length ? bulkMoveNotesSelected : null,
      onSync: synced.length ? () => T.check({ manual: true }) : null,
      onDelete: bulkDeleteNotesSelected,
      deleteLabel: synced.length && synced.length === state.bulk.selected.size ? i18n.t("Remove") : "",
    });
  };

  // ---------- collections (0.204.0) ----------
  // What a note is called, and what's left once that's taken off the top: a
  // plain note's title, else its first line (a "# heading" read as one).
  function splitTitle(n) {
    const kind = kindOf(n);
    if (kind === "list") return { title: n.text || i18n.t("Untitled list"), body: "" };
    if (kind === "quote") return { title: [n.author, n.source].filter(Boolean).join(", ") || i18n.t("Quote"), body: n.text };
    if (n.title) return { title: n.title, body: n.text || "" };
    const lines = String(n.text || "").split("\n");
    const first = lines.findIndex((l) => l.trim());
    if (first < 0) return { title: i18n.t("Untitled"), body: "" };
    return { title: lines[first].replace(/^#+\s*/, "").trim(), body: lines.slice(first + 1).join("\n").trim() };
  }
  // A card's text, drawn the way the reader draws it rather than as the
  // Markdown source it showed until 0.273.0 ("# Heading", "**bold**"). Links
  // become plain words: the card is one button that opens the note, and a
  // link inside it would be a second thing to tap by accident.
  function noteBody(text) {
    const md = window.LifeLogMarkdown;
    const body = el("div", "note-text md note-md");
    if (!md) { body.textContent = text; return body; }
    body.appendChild(md.render(text, mdOpts));
    for (const a of body.querySelectorAll("a")) a.replaceWith(document.createTextNode(a.textContent));
    return body;
  }

  // ---------- pictures (0.297.0) ----------
  // A note's text points at a picture as ![alt](lifelog-img:<id>); the file
  // is on this device or on GitHub (images.js). Anything else that looks
  // like an image is markdown.js's chip: a web address isn't loaded, and an
  // Obsidian embed that wasn't brought in says so.
  const Images = () => window.LifeLogImages;
  function drawImage(node) {
    const I = Images();
    const id = I && I.idOf(node.src);
    if (!id) return null;
    const img = document.createElement("img");
    img.className = "md-img";
    img.alt = node.alt || "";
    img.decoding = "async";
    I.url(id).then((u) => {
      if (u) { img.src = u; return; }
      img.replaceWith(el("span", "md-img-missing", i18n.t("Image not synced yet — it shows once the device that added it saves")));
    }).catch(() => img.replaceWith(el("span", "md-img-missing", i18n.t("Couldn't load this image"))));
    return img;
  }
  const mdOpts = { image: drawImage, wiki: drawWikiLink };
  // A card's few lines of preview, without the Markdown's punctuation.
  const plainPreview = (text) => String(text || "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\s*(#+|>|[-*+](\s+\[[ xX]\])?|\d+[.)])\s*/gm, "")
    .replace(/(\*\*|__|`|\*)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ").trim().slice(0, 220);

  function sortCollection(notes) {
    const by = collectionSort();
    const cmp = by === "edited" ? (a, b) => String(b.editedAt || b.createdAt || "").localeCompare(String(a.editedAt || a.createdAt || ""))
      : by === "newest" ? (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
      : (a, b) => splitTitle(a).title.localeCompare(splitTitle(b).title, undefined, { numeric: true, sensitivity: "base" });
    return notes.slice().sort((a, b) => (!!b.fav - !!a.fav) || cmp(a, b));
  }

  function collectionView(names) {
    const wrap = el("div", "coll");
    const head = el("div", "coll-head");
    const back = el("button", "btn btn-sm", i18n.t("‹ All notes"));
    back.type = "button";
    back.onclick = () => { state.noteActiveCats.clear(); buildCatFilter(); render(); };
    const title = el("h2", "coll-title");
    names.forEach((name, i) => {
      const dot = el("span", "dot"); dot.style.background = catColor(name);
      if (i) title.append(document.createTextNode(" · "));
      title.append(dot, document.createTextNode(name));
    });
    const notes = sortCollection(getFilteredNotes());
    const add = el("button", "btn btn-sm btn-primary", i18n.t("+ Note"));
    add.type = "button";
    add.onclick = () => openNoteModal(null);
    head.append(back, title, el("span", "ycount", i18n.tn(notes.length, "{n} note", "{n} notes")), add);
    wrap.appendChild(head);
    if (!notes.length) {
      wrap.appendChild(emptyState(state.search.trim() || state.noteKinds.size ? i18n.t("Nothing here matches.") : i18n.t("Nothing in this collection yet.")));
      return wrap;
    }
    const grid = el("div", "coll-grid");
    for (const n of notes) grid.appendChild(collectionCard(n, names.length > 1));
    wrap.appendChild(grid);
    return wrap;
  }

  // A div rather than a button: it holds the ☆ and, while selecting, a
  // checkbox, and neither may sit inside a button.
  // `showCat`: several collections are open, so each card says which it's in.
  function collectionCard(n, showCat) {
    const card = el("div", "coll-card");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.dataset.id = n.id;
    card.onkeydown = (ev) => { if (ev.target === card && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); card.onclick(); } };
    // Selecting works here as in the feed (0.208.0): hold a card, tap the rest.
    if (state.bulk.active) {
      card.classList.add("is-bulk");
      card.classList.toggle("is-selected", state.bulk.selected.has(n.id));
      card.appendChild(bulkCheckbox({ id: n.id }));
    } else {
      card.appendChild(favButton(n));
      attachLongPressSelect(card, { id: n.id }, "note");
    }
    if (isBoardItem(n)) {
      card.appendChild(el("span", "coll-card-title")).appendChild(window.LifeLogIcons.labelled("presentation", n.text));
      const thumb = el("span", "board-thumb-inline");
      thumb.appendChild(window.LifeLogBoards.thumbnail(n.board));
      card.appendChild(thumb);
      card.onclick = () => (state.bulk.active ? toggleBulkItem(n.id) : window.LifeLogBoards.openBoard(n.board.id));
      return card;
    }
    const { title, body } = splitTitle(n);
    const kind = kindOf(n);
    card.appendChild(el("span", "coll-card-title", title));
    const preview = kind === "list"
      ? (() => { const open = openItems(n); return open.length ? open.map((i) => i.text).join(" · ") : i18n.t("All done"); })()
      : kind === "quote" ? "“" + plainPreview(body) + "”" : plainPreview(body);
    if (preview) card.appendChild(el("span", "coll-card-text", preview));
    const when = n.editedAt || n.createdAt;
    const meta = [showCat ? n.category : "", kind === "list" ? i18n.tn(openItems(n).length, "{n} left", "{n} left") : "", when ? formatEdited(when) : ""].filter(Boolean).join(" · ");
    if (meta) card.appendChild(el("span", "coll-card-meta", meta));
    card.onclick = () => {
      if (state.bulk.active) toggleBulkItem(n.id);
      else openNote(findList(n.id));
    };
    return card;
  }

  // ---------- reading a note (0.204.0) ----------
  // A note in a collection opens as a page, its Markdown drawn, with Edit a
  // tap away — the note sheet is for writing, and a recipe is mostly read.
  let readingId = "";
  // How a note opens from a card or a search row: a checklist is worked in,
  // so it opens ready to edit; the rest as Notebook → View says (0.304.0;
  // until then the feed opened the editor and collections the reader).
  function openNote(n) {
    if (!n) return;
    if (kindOf(n) === "list" || state.visual.noteOpenIn === "edit") openNoteModal(n);
    else openNoteReader(n.id);
  }
  // Read ⇄ Edit: one sheet goes and the other is there, with neither fade.
  function swapSheets(close, open) {
    const a = $(close), b = $(open);
    a.classList.add("nv-instant"); b.classList.add("nv-instant");
    a.hidden = true;
    b.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => { a.classList.remove("nv-instant"); b.classList.remove("nv-instant"); }));
  }
  function applyNoteView() {
    const v = state.visual, root = document.documentElement.classList;
    root.toggle("note-lines", v.noteLineNumbers === "on");
    root.toggle("note-text-small", v.noteTextSize === "small");
    root.toggle("note-text-large", v.noteTextSize === "large");
    if (!$("#noteModal").hidden) fitText();
  }
  function setCatChip(chip, name) {
    const dot = chip.querySelector(".dot");
    if (dot) dot.style.background = name ? catColor(name) : "";
  }
  function openNoteReader(id) {
    const n = findList(id);
    if (!n) return;
    readingId = id;
    let { title, body } = splitTitle(n);
    // A one-line note has no title to split off: the line is the note.
    if (!n.title && kindOf(n) === "text" && !body) { body = title; title = i18n.t("Note"); }
    applyNoteView();
    $("#noteReaderTitle").textContent = title;
    const cat = $("#noteReaderCat");
    cat.hidden = !n.category;
    cat.lastElementChild.textContent = n.category || "";
    setCatChip(cat, n.category);
    const rt = $("#noteReaderTags");
    rt.hidden = !n.tags;
    rt.replaceChildren(...(n.tags ? [tagPills(n.tags, { buttons: false })] : []));
    const meta = [i18n.t("Written {when}", { when: formatStamp(noteDate(n)) }), n.editedAt ? i18n.t("edited {when}", { when: formatEdited(n.editedAt) }) : ""]
      .filter(Boolean).join(" · ");
    $("#noteReaderMeta").textContent = meta;
    const out = $("#noteReaderBody");
    out.replaceChildren();
    const md = window.LifeLogMarkdown;
    if (kindOf(n) === "quote") {
      const q = el("blockquote", "md-quote");
      if (md) q.appendChild(md.render(n.text, mdOpts)); else q.textContent = n.text;
      out.appendChild(q);
    } else if (md) out.appendChild(md.render(body, mdOpts));
    else out.appendChild(el("p", "note-text", body));
    if (!out.childNodes.length) out.appendChild(el("p", "muted", i18n.t("Nothing written under the title yet.")));
    // A YouTube, Spotify or SoundCloud link on a line of its own is a
    // player (Nov 2026), loaded only once tapped.
    const B = window.LifeLogBoards;
    if (B && B.embedWidget) out.querySelectorAll("p").forEach((p) => {
      const a = p.childNodes.length === 1 && p.firstChild.nodeName === "A" ? p.firstChild : null;
      const w = a && B.embedWidget(a.getAttribute("href"));
      if (w) { w.classList.add("no-swipe"); p.replaceWith(w); }
    });
    drawLinkedFrom(n);
    // Wide code and tables scroll sideways themselves, so no Read/Edit swipe starts on them.
    out.querySelectorAll("pre, table").forEach((x) => x.classList.add("no-swipe"));
    $("#noteReaderEntryBtn").hidden = kindOf(n) !== "text";
    $("#noteReaderTemplateBtn").hidden = !!n.template || kindOf(n) === "quote";
    syncPinButton(n, $("#noteReaderPinBtn"));
    syncFavButton(n, $("#noteReaderFavBtn"));
    closeNoteMenu("#noteReaderMenu", "#noteReaderMoreBtn");
    $("#noteReader .nv-scroll").scrollTop = 0;
    $("#noteReader").hidden = false;
  }
  function closeNoteReader() { $("#noteReader").hidden = true; readingId = ""; }

  // ---------- All tags (Nov 2026) ----------
  // Every tag in use with what carries it. A tap on a tag's name shows
  // only that; the pencil renames it everywhere (onto a tag that exists,
  // the two become one) and the bin takes it off everything. Nothing but
  // the tag itself is ever deleted.
  let renaming = "";
  async function openTagsModal({ adding = false } = {}) {
    renaming = "";
    $("#tagsFind").value = "";
    const B = window.LifeLogBoards;
    if (B && !B.isLoaded()) { try { await B.ensureLoaded(); } catch (e) { /* boards just don't count */ } }
    drawTagsList();
    $("#tagsModal").hidden = false;
    if (adding) $("#tagsFind").focus();
  }
  function closeTagsModal() { $("#tagsModal").hidden = true; renaming = ""; }
  function drawTagsList() {
    const list = $("#tagsList");
    const q = Tags().key($("#tagsFind").value.trim());
    const all = tagCounts();
    const rows = all.filter((c) => !q || c.key.includes(q));
    list.replaceChildren();
    // What's typed, when no tag is called that: a row to make it.
    const typed = Tags().cleanOne($("#tagsFind").value);
    if (typed && !all.some((c) => c.key === Tags().key(typed))) {
      const add = el("button", "tags-name tags-add");
      add.type = "button";
      add.append(ico("plus"), el("span", "tags-name-text", i18n.t("Add “{tag}”", { tag: typed })));
      add.onclick = () => addTagName(typed);
      const row = el("div", "tags-row");
      row.appendChild(add);
      list.appendChild(row);
    }
    if (!all.length && !typed) { list.appendChild(el("p", "muted tags-empty", i18n.t("No tags yet. Type one above to add it."))); return; }
    for (const c of rows) {
      const row = el("div", "tags-row");
      if (renaming === c.key) {
        const input = el("input", "tags-rename");
        input.type = "text";
        input.value = c.name;
        input.maxLength = Tags().MAX_LEN;
        input.setAttribute("aria-label", i18n.t("New name for {tag}", { tag: c.name }));
        const ok = el("button", "btn btn-icon");
        ok.type = "button";
        ok.title = i18n.t("Rename");
        ok.setAttribute("aria-label", i18n.t("Rename"));
        ok.appendChild(ico("check"));
        const warn = el("p", "tags-warn");
        warn.hidden = true;
        const check = () => {
          const to = Tags().cleanOne(input.value);
          const other = to && Tags().key(to) !== c.key && all.find((x) => x.key === Tags().key(to));
          warn.hidden = !other;
          if (other) warn.textContent = i18n.t("“{other}” is already a tag: renaming puts {tag} into it.", { other: other.name, tag: c.name });
        };
        // An emptied name is a delete, which asks first (deleteTag).
        const go = () => (Tags().cleanOne(input.value) ? renameTag(c.name, input.value) : deleteTag(c));
        input.oninput = check;
        input.onkeydown = (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); go(); }
          else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); renaming = ""; drawTagsList(); }
        };
        ok.onclick = go;
        row.classList.add("is-renaming");
        row.append(input, ok);
        list.append(row, warn);
        check();
        setTimeout(() => { input.focus(); input.select(); });
        continue;
      }
      const name = el("button", "tags-name");
      name.type = "button";
      name.title = i18n.t("Show everything tagged “{tag}”", { tag: c.name });
      name.append(el("span", "tags-name-text", c.name), el("span", "tags-count", Tags().summary(c)));
      name.onclick = () => {
        state.noteActiveTags.clear();
        state.noteActiveTags.add(c.name);
        closeTagsModal();
        buildCatFilter();
        render();
      };
      const ren = el("button", "btn btn-icon");
      ren.type = "button";
      ren.title = i18n.t("Rename {tag}", { tag: c.name });
      ren.setAttribute("aria-label", ren.title);
      ren.appendChild(ico("pencil"));
      ren.onclick = () => { renaming = c.key; drawTagsList(); };
      const del = el("button", "btn btn-icon");
      del.type = "button";
      del.title = i18n.t("Delete tag {tag}", { tag: c.name });
      del.setAttribute("aria-label", del.title);
      del.appendChild(ico("trash"));
      del.onclick = () => deleteTag(c);
      row.append(name, ren, del);
      list.appendChild(row);
    }
  }
  // Over the notes and their tasks, the categories' tags for new notes and
  // the boards (their own file). `to` empty deletes. The filter follows.
  async function renameTag(from, to) {
    const T = Tags();
    to = T.cleanOne(to);
    if (to === from) { renaming = ""; drawTagsList(); return; }
    const hit = T.renameIn({ notes: state.data.notes, cats: noteCats() }, from, to);
    const st = state.data.settings || (state.data.settings = {});
    const saved = T.renamed(st.tagNames, from, to);
    if (saved) { if (saved.length) st.tagNames = saved; else delete st.tagNames; }
    const B = window.LifeLogBoards;
    if (B) await B.renameTag(from, to);
    const set = state.noteActiveTags;
    const was = [...set].find((x) => T.key(x) === T.key(from));
    if (was) { set.delete(was); if (to && ![...set].some((x) => T.key(x) === T.key(to))) set.add(to); }
    renaming = "";
    if (!$("#tagsModal").hidden) drawTagsList();
    buildCatFilter();
    render();
    if (hit.notes.size || hit.cats.length || saved) await persist();
  }
  // A tag made from the Tags row's +, before anything carries it.
  async function addTagName(name) {
    const T = Tags();
    const t = T.cleanOne(name);
    if (!t) return;
    const st = state.data.settings || (state.data.settings = {});
    if (!tagCounts().some((c) => c.key === T.key(t))) { st.tagNames = T.clean([...(st.tagNames || []), t]); await persist(); }
    $("#tagsFind").value = "";
    drawTagsList();
    buildCatFilter();
    toast(i18n.t("Tag “{tag}” added", { tag: t }));
  }
  async function deleteTag(c) {
    if (!confirm(i18n.t("Take the tag “{tag}” off {what}? Nothing else is deleted.", { tag: c.name, what: Tags().summary(c) }))) return;
    await renameTag(c.name, "");
    toast(i18n.t("Tag deleted"));
  }
  function wireTags() {
    $("#closeTagsBtn").onclick = closeTagsModal;
    $("#tagsFind").oninput = () => { renaming = ""; drawTagsList(); };
    $("#tagsFind").onkeydown = (ev) => {
      if (ev.key !== "Enter") return;
      const t = Tags().cleanOne($("#tagsFind").value);
      if (t && !tagCounts().some((c) => c.key === Tags().key(t))) { ev.preventDefault(); addTagName(t); }
    };
    $("#tagsModal").addEventListener("click", (ev) => { if (ev.target === $("#tagsModal")) closeTagsModal(); });
  }
  // Escape and phone Back: the rename first, then the sheet.
  function handleTagsEscape() {
    if ($("#tagsModal").hidden) return false;
    if (renaming) { renaming = ""; drawTagsList(); return true; }
    closeTagsModal();
    return true;
  }

  // ---------- bulk actions ----------
  // Move (0.195.0) and Delete. Syncing needs media, and turning a pile of
  // notes into entries at once would need a title and a category decided per
  // note — the single-note flow below.
  // A selection can hold boards (as "board:<id>") beside notes; they live
  // in boards.json, so boards.js moves and deletes those.
  const selectedBoards = () => [...state.bulk.selected].filter((id) => id.startsWith(BOARD)).map((id) => id.slice(BOARD.length));
  const counted = (notes, boards) => i18n.join([
    notes ? i18n.tn(notes, "{n} note", "{n} notes") : "",
    boards ? i18n.tn(boards, "{n} board", "{n} boards") : "",
  ].filter(Boolean)) || i18n.t("nothing");

  async function bulkMoveNotesSelected(category) {
    const ids = state.bulk.selected, boardIds = selectedBoards();
    let n = 0;
    for (const note of state.data.notes) if (ids.has(note.id)) { note.category = category; n++; }
    state.bulk.active = false;
    state.bulk.selected.clear();
    const b = boardIds.length ? await window.LifeLogBoards.setCategory(boardIds, category) : 0;
    render();
    if (n) await persist();
    toast(i18n.t("Moved {what} to {category}", { what: counted(n, b), category }));
  }
  // Right-click on a note or board card (app.js, contextMenu). Boards come
  // as "board:<id>", as they do to the bulk bar, which moves and deletes
  // them alongside notes.
  function noteMenu(id, h) {
    const B = window.LifeLogBoards;
    const board = id.startsWith(BOARD) ? (B.boardsNow() || []).find((b) => b.id === id.slice(BOARD.length)) : null;
    const n = board ? null : (state.data.notes || []).find((x) => x.id === id);
    if (!board && !n) return null;
    const fav = !!(board || n).fav;
    const cats = noteCats();
    const current = (board || n).category || "";
    return [
      { icon: "pencil", label: i18n.t("Open"), run: () => (board ? B.openBoard(board.id) : openNote(n)) },
      { icon: "star", label: fav ? i18n.t("Unfavourite") : i18n.t("Favourite"), fill: fav, run: () => (board ? B.toggleFav(board.id) : toggleFav(n.id)) },
      { icon: n && n.pinned ? "pin-off" : "pin", label: n && n.pinned ? i18n.t("Unpin from Home") : i18n.t("Pin to Home"), hidden: !n || !homeOn(), run: () => togglePinned(n.id) },
      { icon: "layers", label: i18n.t("Move to…"), hidden: !cats.length, sub: () => cats.filter((c) => c.name !== current)
        .map((c) => ({ label: c.name, run: () => h.runOne(id, () => bulkMoveNotesSelected(c.name)) })) },
      h.divider,
      // Home has no bulk bar to act on a selection.
      { ...h.select(id), hidden: state.view === "home" },
      h.del(id, bulkDeleteNotesSelected),
    ];
  }

  async function bulkDeleteNotesSelected() {
    const ids = state.bulk.selected, boardIds = selectedBoards();
    const T = window.LifeLogTrello;
    const synced = T ? T.syncedIn(ids) : [];
    const notes = state.data.notes.filter((x) => ids.has(x.id) && !synced.includes(x)).length;
    if (notes || boardIds.length) {
      const what = counted(notes, boardIds.length);
      if (!confirm(i18n.t("Delete {what}?", { what }) + (boardIds.length ? " " + i18n.t("Boards can be brought back from Settings → History → Boards.") : "")
        + (synced.length ? " " + i18n.tn(synced.length, "The Trello list is only removed here.", "The {n} Trello lists are only removed here.") : ""))) return;
      state.data.notes = state.data.notes.filter((x) => !ids.has(x.id) || synced.includes(x));
    }
    state.bulk.active = false;
    state.bulk.selected.clear();
    if (boardIds.length) await window.LifeLogBoards.deleteBoards(boardIds);
    // Its own toast, with Undo: its cards never left Trello.
    if (synced.length) await T.unlink(synced);
    else render();
    if (notes) await persist();
    if (notes || boardIds.length) toast(i18n.t("Deleted {what}", { what: counted(notes, boardIds.length) }));
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
  function makeEntryFromNote(id = editingNoteId) {
    const n = state.data.notes.find((x) => x.id === id);
    if (!n) return;
    const d = noteDate(n);
    const { title, notes } = n.title ? { title: n.title.slice(0, ENTRY_TITLE_MAX), notes: n.text } : splitNoteForEntry(n.text);
    closeNoteModal();
    closeNoteReader();
    openEntryModal(null, null, {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      title,
      notes,
    });
  }

  // ---------- modal ----------
  // One sheet for every kind, each opened as its own screen from the add
  // menu: the kind is picked before the sheet opens and stays what it is
  // (no switching since 0.314.0). "board" is a name and a category over a
  // blank board; tapping the board makes it and opens the board editor, so
  // a board left unnamed and untouched is never made.
  const SHEET_HEADS = { text: i18n.t("New note"), list: i18n.t("New tasks"), quote: i18n.t("New quote"), board: i18n.t("New board") };
  let editingNoteId = "";
  let sheetKind = "text";
  let boardAfter = null; // what the add menu wants done once a board is made
  let sheetItems = []; // the checklist being edited: { id, text, done?, doneAt? }
  // The sheet's tags, and which of them a new note took from its category:
  // picking another category before it's saved swaps those for the new
  // one's, and leaves the ones you typed.
  let sheetTags = [], fromCat = [], sheetTagField = null;
  // A list's own task fields while its page is open (16 Nov 2026).
  const HEAD_FIELDS = ["note", "priority", "date", "time", "repeat", "remind", "deadline"];
  let sheetHead = {};
  // The list as the page was opened on it, so Save only writes what the page
  // changed: a row ticked meanwhile (a reminder's Done, the widget, a sync)
  // or a repeating list moved on keeps that.
  let sheetBase = null;
  const sameJson = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
  function baseSheet() {
    sheetBase = { items: sheetItems.map((i) => ({ ...i })), head: JSON.parse(JSON.stringify(readSheetHead())) };
  }
  // The page's rows over the list as it is now. The page renames, orders,
  // adds and removes rows; their ticks, dates and the rest are the list's.
  function mergeSheetItems(base, mine, cur) {
    const was = new Map(base.map((i) => [i.id, i]));
    const now = new Map(cur.map((i) => [i.id, i]));
    const out = [];
    for (const s of mine) {
      const b = was.get(s.id), c = now.get(s.id);
      if (!c) { if (!b || s.text !== b.text) out.push(s); continue; }
      out.push({ ...c, text: b && s.text === b.text ? c.text : s.text });
    }
    const seen = new Set(mine.map((i) => i.id));
    for (const c of cur) {
      if (seen.has(c.id) || was.has(c.id)) continue;
      if (c.done) out.push(c);
      else out.splice(out.map((i) => !i.done).lastIndexOf(true) + 1, 0, c);
    }
    return out;
  }
  function readSheetHead() {
    const h = { ...sheetHead };
    const d = $("#nDesc").value.replace(/\s+$/, "");
    if (d.trim()) h.note = d; else delete h.note;
    const p = +$("#nPriority").value;
    if (p) h.priority = p; else delete h.priority;
    return h;
  }
  function syncSheetHead() {
    const T = Tasks(), today = T.today();
    $("#nPriority").value = sheetHead.priority ? String(sheetHead.priority) : "";
    const when = T.dateSummary(sheetHead, today);
    const val = $("#nDateValue");
    val.textContent = when || i18n.t("Add");
    val.classList.toggle("is-today", sheetHead.date === today);
    val.classList.toggle("is-late", !!sheetHead.date && sheetHead.date < today);
    val.classList.toggle("is-empty", !when);
    fitDesc();
  }
  function fitDesc() { const t = $("#nDesc"); t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
  function syncSheetTags() {
    if (sheetTagField) sheetTagField.refresh();
  }
  function catDefaults(name) {
    if (editingNoteId) return;
    const T = Tags();
    const old = new Set(fromCat.map(T.key));
    const mine = sheetTags.filter((t) => !old.has(T.key(t)));
    fromCat = catTagsOf(name).filter((t) => !T.has(mine, t));
    sheetTags = T.clean([...fromCat, ...mine]);
    syncSheetTags();
  }

  function setSheetKind(kind) {
    sheetKind = KINDS.includes(kind) || kind === "board" ? kind : "text";
    const board = sheetKind === "board";
    $("#nTitleLabel").hidden = sheetKind === "quote";
    $("#nBoardPad").hidden = !board;
    $("#nTitle").placeholder = sheetKind === "list" ? i18n.t("Shopping, packing, this week…") : i18n.t("Title");
    $("#nListEditor").hidden = sheetKind !== "list";
    $("#nTextLabel").hidden = sheetKind === "list" || board;
    $("#nAuthorRow").hidden = $("#nSourceRow").hidden = sheetKind !== "quote";
    const list = sheetKind === "list";
    $("#nDesc").hidden = $("#nDateBtn").hidden = $("#nPriorityRow").hidden = $("#nSubsHead").hidden = !list;
    $("#nImages").hidden = sheetKind !== "text";
    $("#nTextLabelText").textContent = sheetKind === "quote" ? i18n.t("Quote") : i18n.t("Note");
    $("#nText").placeholder = sheetKind === "quote" ? i18n.t("The words, as they were said") : i18n.t("What happened, what you noticed…");
    $("#nText").rows = sheetKind === "quote" ? 4 : 8;
    const editing = editingNoteId && state.data.notes.find((x) => x.id === editingNoteId);
    $("#noteToEntryBtn").hidden = !editing || sheetKind !== "text";
    $("#noteCopyBtn").hidden = !editing;
    syncPinButton(editing);
    syncFavButton(editing);
    // ⋯ holds Add image (a note's own), and for a saved note its kind,
    // Make entry and Delete; a new checklist or quote has nothing in it.
    const images = sheetKind === "text";
    $("#nAddImageBtn").hidden = !images;
    $("#noteImageRule").hidden = !images || !editing;
    syncClearDone();
    $("#noteMoreBtn").hidden = !editing && !images && $("#noteClearDoneBtn").hidden;
    // Reading is for what's written; a checklist is its own page.
    $("#noteModeSeg").hidden = !editing || sheetKind === "list";
    fitText();
  }

  // ---------- the text field (0.304.0) ----------
  // It grows with what's written, so the page scrolls rather than the
  // field, and the line numbers beside it are one per line you typed: a
  // line that wraps keeps one number, as long as it is tall. Each height
  // comes from an off-screen copy of the text at the same width and type.
  let measure = null;
  function fitText() {
    const ta = $("#nText");
    if (!ta || $("#noteModal").hidden || $("#nTextLabel").hidden) return;
    const scroller = $("#noteForm");
    const keep = scroller.scrollTop;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
    scroller.scrollTop = keep;
    drawGutter();
  }
  function drawGutter() {
    const ta = $("#nText"), gutter = $("#nGutter");
    if (!document.documentElement.classList.contains("note-lines") || sheetKind === "list") { gutter.replaceChildren(); return; }
    if (!measure) { measure = el("div", "nv-measure"); measure.setAttribute("aria-hidden", "true"); }
    if (!measure.isConnected) $("#nEditor").appendChild(measure);
    const cs = getComputedStyle(ta);
    measure.style.width = ta.clientWidth + "px";
    measure.style.font = cs.font;
    measure.style.lineHeight = cs.lineHeight;
    measure.style.letterSpacing = cs.letterSpacing;
    const lines = ta.value.split("\n");
    measure.replaceChildren(...lines.map((l) => el("div", null, l || "\u200b")));
    const rows = measure.children;
    const spans = lines.map((_, i) => {
      const s = el("span", null, String(i + 1));
      s.style.height = rows[i].getBoundingClientRect().height + "px";
      return s;
    });
    gutter.replaceChildren(...spans);
    markLine();
  }
  function markLine() {
    const ta = $("#nText"), gutter = $("#nGutter");
    if (!gutter.firstChild) return;
    const at = document.activeElement === ta ? ta.value.slice(0, ta.selectionStart).split("\n").length - 1 : -1;
    [...gutter.children].forEach((s, i) => s.classList.toggle("on", i === at));
  }

  // ---------- the ⋯ menu ----------
  // Copy text: what the note says, as plain text to paste anywhere. A
  // checklist comes out as Markdown task lines, a quote with who said it.
  function noteAsText({ kind, title, text, author, source, items }) {
    if (kind === "list") {
      const lines = Tasks().listLines(items, Tasks().today());
      return [String(title || "").trim(), lines.join("\n")].filter(Boolean).join("\n\n");
    }
    if (kind === "quote") {
      const by = [author, source].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
      return [String(text || "").trim(), by ? "— " + by : ""].filter(Boolean).join("\n");
    }
    return [String(title || "").trim(), String(text || "").trim()].filter(Boolean).join("\n\n");
  }
  async function copyText(text) {
    if (!text) { toast(i18n.t("Nothing to copy yet")); return; }
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Older WebViews refuse the async clipboard; the old command still works there.
      const ta = el("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) { toast(i18n.t("Couldn't copy, the clipboard was blocked"), true); return; }
    }
    toast(i18n.t("Copied"));
  }
  const homeOn = () => !(state.visual.disabledViews || []).includes("home");
  function syncPinButton(n, b = $("#notePinBtn")) {
    b.hidden = !n || !homeOn();
    if (!n) return;
    b.replaceChildren(ico(n.pinned ? "pin-off" : "pin"), document.createTextNode(" " + (n.pinned ? i18n.t("Unpin from Home") : i18n.t("Pin to Home"))));
  }
  // The star beside ⋯ (0.314.0), lit like a card's when the note is one.
  function syncFavButton(n, b = $("#noteFavBtn")) {
    b.hidden = !n;
    if (!n) return;
    const label = n.fav ? i18n.t("Unfavourite") : i18n.t("Favourite");
    b.replaceChildren(ico("star", n.fav ? "is-fill" : ""));
    b.classList.toggle("on", !!n.fav);
    b.title = label;
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", String(!!n.fav));
  }
  // The editor and the reader each have a ⋯ and a menu under it.
  function closeNoteMenu(menu = "#noteMoreMenu", btn = "#noteMoreBtn") {
    $(menu).hidden = true;
    $(btn).setAttribute("aria-expanded", "false");
  }
  function toggleNoteMenu(menuSel = "#noteMoreMenu", btn = "#noteMoreBtn") {
    const menu = $(menuSel);
    menu.hidden = !menu.hidden;
    $(btn).setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) { const first = menu.querySelector("button:not([hidden])"); if (first) first.focus(); }
  }

  function renderSheetItems() {
    const wrap = $("#nItems");
    wrap.innerHTML = "";
    sheetItems.forEach((it, i) => {
      // No tick here: that's the card's job. A finished item keeps its tick
      // and shows struck through.
      const row = el("div", "note-list-row" + (it.done ? " is-done" : "") + (it.parent ? " is-sub" : ""));
      row.dataset.idx = String(i);
      const grip = el("button", "note-list-grip");
      grip.type = "button";
      grip.appendChild(ico("grip-vertical"));
      grip.setAttribute("aria-label", i18n.t("Move {item} — drag, or use the arrow keys", { item: it.text || i18n.t("item") }));
      wireSheetGrip(grip, row, i);
      const input = document.createElement("input");
      input.type = "text";
      input.value = it.text;
      input.setAttribute("aria-label", i18n.t("Item {n}", { n: i + 1 }));
      input.oninput = () => { it.text = input.value; };
      // Enter in an item starts the next one, like any list app.
      input.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("#nNewItem").focus(); } };
      const del = el("button", "note-list-del");
      del.appendChild(ico("x"));
      del.type = "button";
      del.setAttribute("aria-label", i18n.t("Remove item"));
      del.onclick = () => { sheetItems.splice(i, 1); renderSheetItems(); };
      // What's set on the task, under its words, and the pen to open it: the
      // date, priority, subtasks and the rest live in the task's sheet.
      const words = el("div", "note-list-words");
      words.appendChild(input);
      const saved = editingNoteId && state.data.notes.find((x) => x.id === editingNoteId);
      const meta = taskMeta(saved || { category: $("#nCategory").value }, it, sheetItems.filter((c) => c.parent === it.id));
      if (meta) { meta.onclick = () => openSheetTask(i); words.appendChild(meta); words.classList.add("has-meta"); }
      const open = el("button", "note-list-open");
      open.type = "button";
      open.appendChild(ico("pencil"));
      open.setAttribute("aria-label", i18n.t("Edit {name}", { name: it.text || i18n.t("task") }));
      open.title = i18n.t("Edit task");
      open.onclick = () => openSheetTask(i);
      row.append(grip, words, open, del);
      wrap.appendChild(row);
    });
    syncClearDone();
  }
  // A task opened from its list's page: the page is saved first so the
  // task sheet works on the stored list, and takes the list back when the
  // task closes.
  async function openSheetTask(i) {
    const id = sheetItems[i] && sheetItems[i].id;
    if (!id) return;
    const isNew = !editingNoteId;
    if (!(await saveNote(() => {}))) return;
    if (isNew) { editingNoteId = state.data.notes[0].id; setSheetKind(sheetKind); }
    const noteId = editingNoteId;
    const reload = () => {
      const n = state.data.notes.find((x) => x.id === noteId);
      if (!n || editingNoteId !== noteId || $("#noteModal").hidden) return;
      sheetItems = (n.items || []).map((x) => ({ ...x }));
      sheetTags = n.tags ? n.tags.slice() : [];
      baseSheet();
      renderSheetItems();
    };
    reload();
    Tasks().openTask(noteId, id, { onClose: reload });
  }
  // Moving a checklist's items in the sheet (0.304.0): the handle follows
  // the pointer and the row takes the place it's over; arrow keys move it
  // one step. The order is saved with the rest on Save.
  function wireSheetGrip(grip, row, i) {
    grip.onkeydown = (ev) => {
      const to = ev.key === "ArrowUp" ? i - 1 : ev.key === "ArrowDown" ? i + 1 : -1;
      if (to < 0 || to >= sheetItems.length) return;
      ev.preventDefault();
      const [it] = sheetItems.splice(i, 1);
      sheetItems.splice(to, 0, it);
      renderSheetItems();
      $("#nItems").children[to].querySelector(".note-list-grip").focus();
    };
    grip.onpointerdown = (ev) => {
      if (ev.button > 0) return;
      ev.preventDefault();
      const wrap = $("#nItems");
      grip.setPointerCapture(ev.pointerId);
      row.classList.add("is-dragging");
      wrap.classList.add("is-sorting");
      let startY = ev.clientY;
      const move = (e) => {
        const y = e.clientY;
        const others = [...wrap.children].filter((r) => r !== row);
        const before = others.find((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
        if ((before || null) !== row.nextElementSibling || (!before && row.nextElementSibling)) {
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
        wrap.classList.remove("is-sorting");
        row.style.transform = "";
        const order = [...wrap.children].map((r) => sheetItems[+r.dataset.idx]);
        if (order.some((it, k) => it !== sheetItems[k])) { sheetItems = order; renderSheetItems(); }
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);
    };
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
    opt("", i18n.t("No category"));
    for (const c of noteCats()) opt(c.name, c.name);
    opt(NEW_CATEGORY, i18n.t("New category…"));
    sel.value = noteCats().some((c) => c.name === value) ? value : "";
    sel.dataset.prev = sel.value;
    setCatChip(sel.closest(".task-field"), sel.value);
  }

  // The note sheet's pictures: a row of thumbnails for the ones the text
  // points at, each removable, and Add image. Pasting or dropping one into
  // the text adds it where the cursor is.
  function renderSheetImages() {
    const wrap = $("#nImageThumbs");
    const I = Images(), md = window.LifeLogMarkdown;
    const seen = new Set();
    const refs = I && md ? md.images($("#nText").value).filter((r) => {
      const id = I.idOf(r.src);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }) : [];
    const kids = refs.map((r) => {
      const id = I.idOf(r.src);
      const prev = wrap.querySelector(`[data-id="${id}"]`);
      if (prev) return prev;
      const box = el("span", "note-image-thumb");
      box.dataset.id = id;
      box.appendChild(drawImage(r) || el("span"));
      const del = el("button", "note-image-del");
      del.type = "button";
      del.setAttribute("aria-label", i18n.t("Remove image"));
      del.appendChild(ico("x"));
      del.onclick = () => removeSheetImage(id);
      box.appendChild(del);
      return box;
    });
    wrap.replaceChildren(...kids);
    wrap.hidden = !kids.length;
  }
  function removeSheetImage(id) {
    const ta = $("#nText");
    const esc = id.replace(/[.]/g, "\\.");
    ta.value = ta.value.replace(new RegExp("[ \\t]*!\\[[^\\]]*\\]\\(lifelog-img:" + esc + "\\)[ \\t]*\\n?", "g"), "").replace(/\n{3,}/g, "\n\n");
    renderSheetImages();
  }
  // Each picture on a line of its own, where the cursor was.
  async function addSheetImages(files) {
    const I = Images();
    const pics = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)$/i.test(f.name || ""));
    if (!I || !pics.length) return;
    const ta = $("#nText");
    const refs = [];
    for (const f of pics) {
      try { refs.push(I.ref(await I.add(f), "")); }
      catch (e) { toast((e && e.message) || i18n.t("Couldn't add that image"), true); }
    }
    if (!refs.length) return;
    const at = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const before = ta.value.slice(0, at), after = ta.value.slice(ta.selectionEnd == null ? at : ta.selectionEnd);
    const lead = before && !before.endsWith("\n") ? "\n" : "";
    const tail = after && !after.startsWith("\n") ? "\n" : "";
    const block = lead + refs.join("\n") + tail;
    ta.value = before + block + after;
    const caret = before.length + block.length;
    ta.setSelectionRange(caret, caret);
    renderSheetImages();
  }

  // Settings → Notebook → Images in notes: how many, and Clean up.
  const mb = (b) => (b >= 1048576 ? i18n.t("{size} MB", { size: (b / 1048576).toFixed(1) }) : i18n.t("{size} KB", { size: String(Math.max(1, Math.round(b / 1024))) }));
  async function updateImagesSetting() {
    const I = Images(), info = $("#noteImagesInfo");
    if (!I || !info) return;
    const st = await I.stats(state.data.notes).catch(() => null);
    if (!st) return;
    const parts = [st.used ? i18n.tn(st.used, "{n} image in your notes and boards", "{n} images in your notes and boards") : i18n.t("No images in your notes or boards yet")];
    if (st.count) parts.push(i18n.t("{size} kept on this device", { size: mb(st.bytes) }));
    if (st.waiting) parts.push(i18n.tn(st.waiting, "{n} waiting to upload", "{n} waiting to upload"));
    info.textContent = parts.join(" · ") + ". " + i18n.t("Clean up removes the ones no note or board shows any more");
  }
  async function cleanUpImages() {
    const I = Images(), S = window.LifeLogStorage;
    if (!I) return;
    const btn = $("#cleanUpImagesBtn");
    btn.disabled = true;
    try {
      const used = await I.usedEverywhere(state.data);
      const online = S && S.images && S.images.connected();
      const there = online ? await S.images.list() : new Set();
      const unused = [...there].filter((id) => !used.has(id)).length;
      if (online && !unused && !confirm(i18n.t("Every image on GitHub is in a note or on a board. Clean up anyway? It also starts the images' history over, which frees the space of ones removed before."))) return;
      if (unused && !confirm(i18n.tn(unused, "Remove {n} image no note or board shows any more? This can't be undone — a note or board brought back from History later won't have it.", "Remove {n} images no note or board shows any more? This can't be undone — a note or board brought back from History later won't have them."))) return;
      toast(i18n.t("Cleaning up images…"));
      const res = await I.cleanUp(state.data);
      if (res.remote) {
        state.data.settings.imagesCleanedAt = new Date().toISOString();
        await persist();
      }
      const r = res.remote;
      toast(r ? (r.removed ? i18n.tn(r.removed, "Removed {n} image ({size}) — GitHub frees the space in its own time", "Removed {n} images ({size}) — GitHub frees the space in its own time", { size: mb(r.bytes) }) : i18n.t("Nothing to remove — the images' history starts over"))
        : res.local ? i18n.tn(res.local, "Removed {n} image from this device", "Removed {n} images from this device") : i18n.t("Nothing to remove"));
    } catch (e) {
      toast(i18n.t("Couldn't clean up images — {error}", { error: (e && e.message) || e }), true);
    } finally {
      btn.disabled = false;
      updateImagesSetting();
    }
  }

  // `preset` fills a new one in (a Google Calendar event, journal.js):
  // { title, text, head } with head a list's own task fields.
  function openNoteModal(note, kind, { after, preset } = {}) {
    editingNoteId = note ? note.id : "";
    boardAfter = after || null;
    applyNoteView();
    closeNoteMenu();
    $("#nText").value = note && kindOf(note) !== "list" ? note.text : "";
    $("#nTitle").value = !note ? "" : kindOf(note) === "list" ? note.text : (note.title || "");
    $("#nAuthor").value = (note && note.author) || "";
    $("#nSource").value = (note && note.source) || "";
    // A list's own task fields: the box shows them, Save writes them.
    sheetHead = {};
    if (note && kindOf(note) === "list") for (const k of HEAD_FIELDS) if (note[k] != null) sheetHead[k] = JSON.parse(JSON.stringify(note[k]));
    if (!note && preset) {
      $("#nTitle").value = preset.title || "";
      $("#nText").value = preset.text || "";
      for (const k of HEAD_FIELDS) if (preset.head && preset.head[k] != null) sheetHead[k] = preset.head[k];
    }
    $("#nDesc").value = sheetHead.note || "";
    syncSheetHead();
    $("#nNewItem").value = "";
    sheetItems = note && note.items ? note.items.map((i) => ({ ...i })) : [];
    baseSheet();
    renderSheetItems();
    fillCategorySelect(note ? note.category : ([...state.noteActiveCats].find(Boolean) || ""));
    sheetTags = note && note.tags ? note.tags.slice() : [];
    fromCat = [];
    if (!note) catDefaults($("#nCategory").value);
    syncSheetTags();
    $("#deleteNoteBtn").hidden = !note;
    $("#noteTemplateBtn").hidden = !note || !!note.template || kindOf(note) === "quote";
    for (const id of ["#noteExportMdBtn", "#noteExportPdfBtn"]) $(id).hidden = !note;
    const stamp = $("#noteStampLine");
    $("#noteFoot").hidden = !note;
    if (note) {
      let line = i18n.t("Written {when}", { when: formatStamp(noteDate(note)) });
      if (note.editedAt) {
        const edited = formatEdited(note.editedAt);
        if (edited) line += " · " + i18n.t("edited {when}", { when: edited });
      }
      stamp.textContent = line;
      stamp.hidden = false;
    } else stamp.hidden = true;
    // A new note starts as the kind the list is showing.
    // Only when it's showing one; with several there's no telling which.
    const kindsOn = [...state.noteKinds].filter((k) => k !== "template");
    const shown = kindsOn.length === 1 ? kindsOn[0] : "";
    setSheetKind(note ? kindOf(note) : (kind || shown || "text"));
    // A new one says what it is in the bar; an open note's own title does.
    const head = $("#noteModalTitle");
    head.textContent = note ? i18n.t("Edit note") : SHEET_HEADS[sheetKind];
    head.classList.toggle("sr-only", !!note);
    if (sheetKind === "board") primeBoardSheet();
    renderSheetImages();
    drawTemplateRow(note);
    $("#noteForm").scrollTop = 0;
    if ($("#noteModal").hidden) $("#noteModal").hidden = false;
    fitText();
    // Only a new note starts typing. An existing one, opened to edit or
    // switched to Edit from reading, waits for a tap, so the phone's
    // keyboard doesn't cover what you were about to read.
    if (!note) (sheetKind === "list" || sheetKind === "board" ? $("#nTitle") : $("#nText")).focus({ preventScroll: true });
    openedAs = sheetNow();
  }
  function closeNoteModal() { closeNoteMenu(); closeLinkPick(); $("#noteModal").hidden = true; }
  // There's no Save button: leaving the editor (×, Escape, phone Back, a
  // tap outside) keeps what was written. Untouched, or a new note left
  // empty, it just closes.
  let openedAs = "";
  const sheetNow = () => JSON.stringify([sheetKind, $("#nTitle").value, $("#nText").value, $("#nAuthor").value,
    $("#nSource").value, $("#nCategory").value, $("#nNewItem").value.trim(), sheetItems, sheetTags, readSheetHead()]);
  async function leaveNoteModal() {
    if ($("#noteModal").hidden) return;
    if (sheetKind === "board") { closeNoteModal(); return; }
    const blank = !editingNoteId && !$("#nTitle").value.trim() && !$("#nText").value.trim()
      && !$("#nNewItem").value.trim() && !sheetItems.some((i) => i.text.trim());
    if (blank || sheetNow() === openedAs) { closeNoteModal(); return; }
    await saveNote();
  }

  async function saveNoteFromForm(ev) {
    ev.preventDefault();
    if (sheetKind === "board") await startBoard();
    else await saveNote();
  }

  function primeBoardSheet() {
    const B = window.LifeLogBoards;
    $("#nBoardPadText").textContent = (matchMedia("(pointer: coarse)").matches ? i18n.t("Tap to start drawing") : i18n.t("Click to start drawing"));
    $("#nTitle").placeholder = i18n.t("Board name");
    B.ensureLoaded().then(() => { if (sheetKind === "board") $("#nTitle").placeholder = B.nextName(); }).catch(() => {});
  }
  async function startBoard() {
    const name = $("#nTitle").value.trim();
    const category = $("#nCategory").value === NEW_CATEGORY ? "" : $("#nCategory").value;
    const after = boardAfter;
    boardAfter = null;
    closeNoteModal();
    if (after) after();
    await window.LifeLogBoards.newBoard({ name, category, tags: sheetTags });
  }
  // Saves what's in the sheet and closes it; false when there's nothing to
  // save yet (the toast says what's missing) and the sheet stays.
  async function saveNote(after) {
    addSheetItem(); // an item typed but not yet entered is still meant
    const kind = sheetKind;
    const text = (kind === "list" ? $("#nTitle").value : $("#nText").value).trim();
    const items = sheetItems.map((i) => ({ ...i, text: i.text.trim() })).filter((i) => i.text);
    const title = $("#nTitle").value.trim();
    if (kind === "list" ? !text && !items.length : kind === "text" ? !text && !title : !text) {
      toast(kind === "list" ? i18n.t("Give the list a title or an item") : kind === "quote" ? i18n.t("Write the quote") : i18n.t("Write something first"), true);
      return false;
    }
    const fields = { text, kind: kind === "text" ? undefined : kind, title: kind === "text" ? $("#nTitle").value.trim() : undefined };
    if (kind === "quote") { fields.author = $("#nAuthor").value.trim(); fields.source = $("#nSource").value.trim(); }
    if (kind === "list") {
      fields.items = items;
      const h = readSheetHead();
      for (const k of HEAD_FIELDS) fields[k] = h[k];
    }
    const category = $("#nCategory").value === NEW_CATEGORY ? "" : $("#nCategory").value;
    fields.tags = sheetTags;
    const now = new Date().toISOString();
    if (editingNoteId) {
      const n = state.data.notes.find((x) => x.id === editingNoteId);
      if (n) {
        // Only a change to what the note says counts as an edit — reopening
        // one, ticking an item or filing it under a category doesn't
        // relabel it as edited.
        const said = (x) => JSON.stringify([kindOf(x), x.title || "", x.text, x.author || "", x.source || "", x.note || "", (x.items || []).map((i) => i.text)]);
        const before = said(n);
        if (kind === "list" && kindOf(n) === "list" && sheetBase) {
          fields.items = mergeSheetItems(sheetBase.items, fields.items, n.items || []);
          for (const k of HEAD_FIELDS) if (sameJson(fields[k], sheetBase.head[k])) fields[k] = n[k];
        }
        const next = sanitizeNote({ ...n, ...fields, category });
        for (const k of ["kind", "title", "author", "source", "items", "category", "tags", ...(kind === "list" ? HEAD_FIELDS : [])]) delete n[k];
        Object.assign(n, next);
        if (said(n) !== before) n.editedAt = now;
      }
    } else {
      // Made while the Templates chip is on, it's a template.
      const template = state.noteKinds.has("template") && kind !== "quote" ? { template: true } : {};
      state.data.notes.unshift(sanitizeNote({ ...fields, ...template, category, createdAt: now, updatedAt: now }));
    }
    if (after) after(); else closeNoteModal();
    render();
    await persist();
    return true;
  }

  async function deleteNote(id = editingNoteId) {
    if (!id) return;
    if (!confirm(i18n.t("Delete this note?"))) return;
    state.data.notes = state.data.notes.filter((n) => n.id !== id);
    closeNoteModal();
    closeNoteReader();
    render();
    await persist();
    toast(i18n.t("Note deleted"));
  }

  function wire() {
    $("#noteForm").onsubmit = saveNoteFromForm;
    sheetTagField = Tags().field($("#nTags"), { get: () => sheetTags, set: (v) => { sheetTags = v; syncSheetTags(); }, known: tagCounts, placeholder: "+" });
    $("#nTagsRow").addEventListener("click", (ev) => { if (!ev.target.closest("button, input")) sheetTagField.input.focus(); });
    $("#nDesc").addEventListener("input", fitDesc);
    $("#nPriority").addEventListener("change", () => { sheetHead = readSheetHead(); });
    $("#nDateBtn").onclick = () => Tasks().openDateFor({
      get: () => sheetHead,
      set: (h) => { sheetHead = { ...readSheetHead(), ...h }; for (const k of ["date", "time", "repeat", "remind", "deadline"]) if (h[k] == null) delete sheetHead[k]; syncSheetHead(); },
    });
    wireTags();
    $("#closeNoteReaderBtn").onclick = closeNoteReader;
    $("#editNoteReaderBtn").onclick = () => {
      const n = findList(readingId);
      if (!n) { closeNoteReader(); return; }
      openNoteModal(n);
      swapSheets("#noteReader", "#noteModal");
      readingId = "";
    };
    // Read saves first: what you read is what's kept.
    $("#noteReadBtn").onclick = () => {
      const id = editingNoteId;
      saveNote(() => { closeNoteMenu(); openNoteReader(id); swapSheets("#noteModal", "#noteReader"); });
    };
    $("#cancelNoteBtn").onclick = leaveNoteModal;
    // Ctrl/Cmd+E (or whatever Settings → Keyboard says) swaps Read and
    // Edit, even while typing if the key has Ctrl or Alt in it.
    document.addEventListener("keydown", (ev) => {
      const K = window.LifeLogKeys;
      const hit = K && K.match(ev);
      if (!hit || hit.id !== "noteMode" || K.blockedWhileTyping(hit.combo, document.activeElement)) return;
      const btn = !$("#noteReader").hidden ? $("#editNoteReaderBtn")
        : !$("#noteModal").hidden && !$("#noteModeSeg").hidden ? $("#noteReadBtn") : null;
      if (!btn) return;
      ev.preventDefault();
      btn.click();
    });
    for (const [sheet, menu, btn] of [["#noteModal", "#noteMoreMenu", "#noteMoreBtn"], ["#noteReader", "#noteReaderMenu", "#noteReaderMoreBtn"]]) {
      $(btn).onclick = (ev) => { ev.stopPropagation(); toggleNoteMenu(menu, btn); };
      $(menu).addEventListener("click", (ev) => { if (ev.target.closest("button")) closeNoteMenu(menu, btn); });
      $(sheet).addEventListener("pointerdown", (ev) => {
        if (!$(menu).hidden && !ev.target.closest(`${menu}, ${btn}`)) closeNoteMenu(menu, btn);
      });
      $(menu).addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") { ev.stopPropagation(); closeNoteMenu(menu, btn); $(btn).focus(); }
      });
    }
    $("#noteReaderEntryBtn").onclick = () => makeEntryFromNote(readingId);
    $("#noteReaderCopyBtn").onclick = () => {
      const n = findList(readingId);
      if (n) copyText(noteAsText({ ...n, kind: kindOf(n), title: kindOf(n) === "list" ? n.text : n.title, text: n.text }));
    };
    $("#noteReaderDeleteBtn").onclick = () => deleteNote(readingId);
    $("#noteReaderFavBtn").onclick = async () => {
      const id = readingId;
      if (!id) return;
      await toggleFav(id);
      syncFavButton(findList(id), $("#noteReaderFavBtn"));
    };
    $("#noteReaderPinBtn").onclick = async () => {
      const id = readingId;
      if (!id) return;
      await togglePinned(id);
      syncPinButton(findList(id), $("#noteReaderPinBtn"));
    };
    $("#nText").addEventListener("input", fitText);
    for (const t of ["keyup", "click", "focus", "blur"]) $("#nText").addEventListener(t, markLine);
    if (window.ResizeObserver) {
      let w = 0;
      new ResizeObserver(() => { const now = $("#nText").clientWidth; if (now !== w) { w = now; fitText(); } }).observe($("#nText"));
    }
    $("#deleteNoteBtn").onclick = () => deleteNote();
    // Links, templates and export (Nov 2026).
    $("#nText").addEventListener("input", updateLinkPick);
    $("#nText").addEventListener("keydown", linkPickKey);
    $("#nText").addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== $("#nText")) closeLinkPick(); }, 0));
    $("#nText").addEventListener("click", updateLinkPick);
    $("#noteForm").addEventListener("scroll", closeLinkPick, { passive: true });
    // From the editor, what's written is kept first.
    const savedThen = (fn) => async () => {
      const id = editingNoteId;
      if (!id) return;
      if (sheetNow() !== openedAs && (await saveNote()) === false) return;
      closeNoteModal();
      fn(id);
    };
    $("#noteTemplateBtn").onclick = savedThen(saveAsTemplate);
    $("#noteExportMdBtn").onclick = savedThen(exportNoteMarkdown);
    $("#noteExportPdfBtn").onclick = () => { const id = editingNoteId; if (id) exportNotePdf(id); };
    $("#noteReaderTemplateBtn").onclick = () => saveAsTemplate(readingId);
    $("#noteReaderExportMdBtn").onclick = () => exportNoteMarkdown(readingId);
    $("#noteReaderExportPdfBtn").onclick = () => exportNotePdf(readingId);
    $("#noteClearDoneBtn").onclick = () => clearDoneSheetItems();
    $("#noteToEntryBtn").onclick = () => makeEntryFromNote();
    // The sheet as it stands, so unsaved words copy too.
    $("#noteCopyBtn").onclick = () => copyText(noteAsText({
      kind: sheetKind, title: $("#nTitle").value, text: $("#nText").value,
      author: $("#nAuthor").value, source: $("#nSource").value, items: sheetItems,
    }));
    $("#noteFavBtn").onclick = async () => {
      if (!editingNoteId) return;
      await toggleFav(editingNoteId);
      syncFavButton(state.data.notes.find((x) => x.id === editingNoteId));
    };
    // On a phone a sideways swipe flips Read and Edit, as the switch is laid
    // out: left goes to Edit, right back to Read (which saves, as the button does).
    if (attachSwipe) {
      const swipeOpts = { threshold: 60, requireHorizontal: true };
      attachSwipe($("#noteReader .nv-scroll"), { ...swipeOpts, onLeft: () => $("#editNoteReaderBtn").click(), onRight: () => {} });
      attachSwipe($("#noteForm"), { ...swipeOpts, onLeft: () => {}, onRight: () => { if (!$("#noteModeSeg").hidden) $("#noteReadBtn").click(); } });
    }
    $("#notePinBtn").onclick = async () => {
      if (!editingNoteId) return;
      await togglePinned(editingNoteId);
      syncPinButton(state.data.notes.find((x) => x.id === editingNoteId));
    };
    $("#nBoardPad").onclick = startBoard;
    $("#nNewItem").onkeydown = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); addSheetItem(); }
      else if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") $("#noteForm").requestSubmit();
    };
    $("#nCategory").onchange = () => {
      const sel = $("#nCategory");
      if (sel.value !== NEW_CATEGORY) { sel.dataset.prev = sel.value; setCatChip(sel.closest(".task-field"), sel.value); catDefaults(sel.value); return; }
      // Back to where it was until the new one exists: cancelling the
      // category sheet must not leave "New category…" chosen.
      sel.value = sel.dataset.prev || "";
      openNoteCatModal(null, (name) => { fillCategorySelect(name); catDefaults(name); });
    };
    $("#noteCatForm").onsubmit = saveNoteCatFromForm;
    $("#cancelNoteCatBtn").onclick = closeNoteCatModal;
    $("#deleteNoteCatBtn").onclick = deleteNoteCategory;
    // Ctrl/Cmd+Enter saves from inside the textarea, where Enter is a
    // newline and the Save button is a reach away on a phone.
    $("#nText").onkeydown = (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") $("#noteForm").requestSubmit();
    };
    $("#nText").addEventListener("input", renderSheetImages);
    const imageFiles = (dt) => [...((dt && dt.files) || [])].filter((f) => /^image\//.test(f.type));
    $("#nText").addEventListener("paste", (ev) => {
      if (sheetKind !== "text") return;
      const files = imageFiles(ev.clipboardData);
      if (!files.length) return;
      ev.preventDefault();
      addSheetImages(files);
    });
    $("#nText").addEventListener("dragover", (ev) => {
      if (sheetKind === "text" && ev.dataTransfer && [...ev.dataTransfer.types].includes("Files")) ev.preventDefault();
    });
    $("#nText").addEventListener("drop", (ev) => {
      if (sheetKind !== "text") return;
      const files = imageFiles(ev.dataTransfer);
      if (!files.length) return;
      ev.preventDefault();
      addSheetImages(files);
    });
    $("#cleanUpImagesBtn").onclick = cleanUpImages;
    $("#nAddImageBtn").onclick = () => $("#nImageInput").click();
    $("#nImageInput").onchange = (ev) => {
      const files = [...ev.target.files];
      ev.target.value = "";
      $("#nText").focus();
      addSheetImages(files);
    };
  }


  // ---------- links between notes (Nov 2026, from Odinote) ----------
  // [[Title]] in a note points at the note or board with that title, any
  // case. Nothing is stored about it: what a note links to is its own text,
  // and what links to it is worked out when it opens, so a deleted or
  // renamed note never leaves a stale list behind.
  const linkKey = (s) => String(s || "").trim().toLowerCase();
  // The name a link uses for a note: its title, a list's name, else its first line.
  function linkTitle(n) {
    if (kindOf(n) === "quote") return "";
    if (kindOf(n) === "list") return String(n.text || "").trim();
    if (n.title) return n.title;
    const line = String(n.text || "").split("\n").find((l) => l.trim());
    return line ? line.replace(/^#+\s*/, "").trim() : "";
  }
  // What [[target]] opens: { note } or { board }, else null. A note wins
  // over a board of the same name, and a template is never a target.
  function findLinkTarget(target, notes, boards = []) {
    const k = linkKey(target);
    if (!k) return null;
    const note = notes.find((n) => !n.template && linkKey(linkTitle(n)) === k);
    if (note) return { note };
    const board = boards.find((b) => linkKey(b.name) === k);
    return board ? { board } : null;
  }
  // The notes whose text links to `note`, each with the line it's on.
  function backlinksOf(note, notes) {
    const k = linkKey(linkTitle(note));
    const M = window.LifeLogMarkdown;
    if (!k || !M) return [];
    const out = [];
    for (const n of notes) {
      if (n.id === note.id || n.template) continue;
      const texts = [n.text, n.note, ...(n.items || []).flatMap((i) => [i.text, i.note])].filter(Boolean).map(String);
      for (const t of texts) {
        const hit = M.wikiLinks(t).find((l) => linkKey(l.target) === k);
        if (!hit) continue;
        const line = t.split("\n").find((l) => l.includes(hit.raw)) || "";
        const plain = M.unwiki(line).replace(/^\s*([-*+]\s+(\[[ xX]\]\s+)?|#+\s+|>\s*|\d+[.)]\s+)/, "").trim();
        out.push({ id: n.id, title: linkTitle(n) || splitTitle(n).title, line: plain.length > 140 ? plain.slice(0, 139) + "…" : plain, word: hit.label });
        break;
      }
    }
    return out;
  }
  const boardsList = () => (window.LifeLogBoards && window.LifeLogBoards.isLoaded() ? window.LifeLogBoards.boardsNow() : []);
  function drawWikiLink(node) {
    const hit = findLinkTarget(node.target, state.data.notes, boardsList());
    const a = el("a", "md-wiki" + (hit ? "" : " is-missing"));
    a.href = "#";
    if (hit) a.appendChild(ico(hit.board ? "presentation" : kindOf(hit.note) === "list" ? "list-checks" : "notebook-text"));
    a.appendChild(document.createTextNode(node.label));
    a.title = hit ? "" : i18n.t("No note called this yet. Tap to make it");
    a.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); followLink(node.target); };
    return a;
  }
  function followLink(target) {
    const hit = findLinkTarget(target, state.data.notes, boardsList());
    if (hit && hit.board) { closeNoteReader(); closeNoteModal(); window.LifeLogBoards.openBoard(hit.board.id); return; }
    if (hit) {
      if (kindOf(hit.note) === "list") { closeNoteReader(); openNoteModal(hit.note); return; }
      openNoteReader(hit.note.id);
      return;
    }
    closeNoteReader();
    openNoteModal(null, "text", { preset: { title: String(target).trim() } });
  }
  function drawLinkedFrom(n) {
    const box = $("#noteReaderLinks");
    if (!box) return;
    const links = backlinksOf(n, state.data.notes);
    box.hidden = !links.length;
    box.replaceChildren();
    if (!links.length) return;
    const h = el("h3", "nv-links-head");
    h.appendChild(ico("link"));
    h.appendChild(document.createTextNode(i18n.tn(links.length, "Linked from {n} note", "Linked from {n} notes")));
    box.appendChild(h);
    for (const l of links) {
      const row = el("button", "nv-link-row");
      row.type = "button";
      row.appendChild(el("b", null, l.title));
      if (l.line) {
        const line = el("span");
        const at = l.line.indexOf(l.word);
        if (at >= 0) {
          line.appendChild(document.createTextNode(l.line.slice(0, at)));
          line.appendChild(el("mark", null, l.word));
          line.appendChild(document.createTextNode(l.line.slice(at + l.word.length)));
        } else line.textContent = l.line;
        row.appendChild(line);
      }
      row.onclick = () => { const t = findList(l.id); if (t) { if (kindOf(t) === "list") { closeNoteReader(); openNoteModal(t); } else openNoteReader(l.id); } };
      box.appendChild(row);
    }
  }

  // Typing [[ in a note offers the notes and boards to link to. Arrows
  // move, Enter or Tab picks, Escape closes; picking writes the title and
  // the closing ]].
  const LINK_OPEN = /\[\[([^\[\]\n|#]{0,60})$/;
  let linkPick = null; // { from, query, items, at }
  function linkCandidates(query) {
    const q = linkKey(query);
    const seen = new Set();
    const all = [];
    for (const n of state.data.notes) {
      if (n.template || n.id === editingNoteId) continue;
      const t = linkTitle(n);
      if (!t || seen.has(linkKey(t))) continue;
      seen.add(linkKey(t));
      all.push({ title: t, icon: kindOf(n) === "list" ? "list-checks" : "notebook-text", sub: n.category || "" });
    }
    for (const b of boardsList()) {
      if (!b.name || seen.has(linkKey(b.name))) continue;
      seen.add(linkKey(b.name));
      all.push({ title: b.name, icon: "presentation", sub: i18n.t("Board") });
    }
    const starts = all.filter((x) => linkKey(x.title).startsWith(q));
    const has = all.filter((x) => !linkKey(x.title).startsWith(q) && linkKey(x.title).includes(q));
    return starts.concat(has).slice(0, 6);
  }
  // Where the caret is on screen, by laying the text out again in a copy of the box.
  function caretPoint(ta) {
    const cs = getComputedStyle(ta);
    const m = el("div");
    for (const k of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "boxSizing", "whiteSpace", "wordWrap", "overflowWrap", "tabSize", "direction"]) m.style[k] = cs[k];
    m.style.position = "absolute"; m.style.visibility = "hidden"; m.style.top = "0"; m.style.left = "-9999px";
    m.style.width = ta.clientWidth + "px"; m.style.whiteSpace = "pre-wrap"; m.style.overflowWrap = "break-word";
    m.textContent = ta.value.slice(0, ta.selectionStart);
    const mark = el("span", null, "​");
    m.appendChild(mark);
    document.body.appendChild(m);
    const r = ta.getBoundingClientRect();
    const x = r.left + mark.offsetLeft - ta.scrollLeft, y = r.top + mark.offsetTop - ta.scrollTop + (parseFloat(cs.lineHeight) || 20);
    m.remove();
    return { x, y };
  }
  function closeLinkPick() {
    const pop = $("#linkPick");
    linkPick = null;
    if (!pop || pop.hidden) return;
    pop.classList.add("is-leaving");
    setTimeout(() => { pop.hidden = true; pop.classList.remove("is-leaving"); }, reducedMotion() ? 0 : 140);
  }
  function drawLinkPick() {
    const pop = $("#linkPick");
    pop.replaceChildren();
    linkPick.items.forEach((it, k) => {
      const b = el("button", "link-pick-row" + (k === linkPick.at ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(k === linkPick.at));
      b.appendChild(ico(it.icon));
      b.appendChild(el("span", "link-pick-name", it.title));
      if (it.sub) b.appendChild(el("small", null, it.sub));
      b.onpointerdown = (ev) => { ev.preventDefault(); pickLink(it.title); };
      pop.appendChild(b);
    });
    if (linkPick.query.trim()) {
      if (linkPick.items.length) pop.appendChild(el("hr"));
      const b = el("button", "link-pick-row" + (linkPick.at === linkPick.items.length ? " on" : ""));
      b.type = "button";
      b.appendChild(ico("plus"));
      b.appendChild(el("span", "link-pick-name", i18n.t("New note “{name}”", { name: linkPick.query.trim() })));
      b.onpointerdown = (ev) => { ev.preventDefault(); pickLink(linkPick.query.trim()); };
      pop.appendChild(b);
    }
  }
  function updateLinkPick() {
    const ta = $("#nText"), pop = $("#linkPick");
    if (!pop || sheetKind !== "text" || ta.selectionStart !== ta.selectionEnd) { closeLinkPick(); return; }
    const m = LINK_OPEN.exec(ta.value.slice(0, ta.selectionStart));
    if (!m) { closeLinkPick(); return; }
    const items = linkCandidates(m[1]);
    if (!items.length && !m[1].trim()) { closeLinkPick(); return; }
    const total = items.length + (m[1].trim() ? 1 : 0);
    linkPick = { from: ta.selectionStart - m[1].length, query: m[1], items, at: Math.min(linkPick ? linkPick.at : 0, total - 1) };
    drawLinkPick();
    pop.classList.remove("is-leaving");
    pop.hidden = false;
    const p = caretPoint(ta), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(8, Math.min(p.x, innerWidth - w - 8));
    const top = p.y + 4 + h > innerHeight - 8 ? Math.max(8, p.y - (parseFloat(getComputedStyle(ta).lineHeight) || 20) - h - 4) : p.y + 4;
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }
  function pickLink(title) {
    const ta = $("#nText");
    if (!linkPick) return;
    const end = ta.selectionStart;
    const after = ta.value.slice(end);
    const close = after.startsWith("]]") ? "" : "]]";
    ta.setRangeText(title + close, linkPick.from, end, "end");
    if (!close) ta.selectionStart = ta.selectionEnd = linkPick.from + title.length + 2;
    closeLinkPick();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
  }
  function linkPickKey(ev) {
    if (!linkPick) return;
    const total = linkPick.items.length + (linkPick.query.trim() ? 1 : 0);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      linkPick.at = (linkPick.at + (ev.key === "ArrowDown" ? 1 : total - 1)) % total;
      drawLinkPick();
    } else if (ev.key === "Enter" || ev.key === "Tab") {
      ev.preventDefault();
      pickLink(linkPick.at < linkPick.items.length ? linkPick.items[linkPick.at].title : linkPick.query.trim());
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeLinkPick();
    }
  }

  // ---------- templates (Nov 2026) ----------
  // A template is a note or task list marked `template`. A new note of its
  // kind offers it; picking one fills the sheet, with {{date}},
  // {{weekday}} and {{time}} written out as now.
  function fillTemplate(text, now = new Date()) {
    const D = Dates();
    return String(text || "")
      .replace(/\{\{\s*date\s*\}\}/gi, () => D.day(now, { year: "auto" }))
      .replace(/\{\{\s*weekday\s*\}\}/gi, () => D.WEEKDAY_NAMES[now.getDay()])
      .replace(/\{\{\s*time\s*\}\}/gi, () => now.toLocaleTimeString(i18n.lang || [], { hour: "2-digit", minute: "2-digit" }));
  }
  const templatesFor = (kind) => state.data.notes.filter((n) => n.template && kindOf(n) === kind)
    .sort((a, b) => linkTitle(a).localeCompare(linkTitle(b)));
  function drawTemplateRow(note) {
    const row = $("#nTemplates");
    if (!row) return;
    const list = note || state.noteKinds.has("template") ? [] : templatesFor(sheetKind);
    row.hidden = !list.length;
    const chips = $("#nTemplateChips");
    chips.replaceChildren();
    for (const t of list) {
      const b = el("button", "tpl-chip");
      b.type = "button";
      b.appendChild(ico(kindOf(t) === "list" ? "list-checks" : "layers"));
      b.appendChild(document.createTextNode(linkTitle(t) || i18n.t("Untitled")));
      b.onclick = () => useTemplate(t);
      chips.appendChild(b);
    }
  }
  function useTemplate(t) {
    const now = new Date();
    if (kindOf(t) === "list") {
      $("#nTitle").value = fillTemplate(t.text, now);
      sheetItems = (t.items || []).map((i) => ({ ...i, id: uid(), text: fillTemplate(i.text, now), done: undefined, doneAt: undefined }))
        .map((i) => { delete i.done; delete i.doneAt; return i; });
      renderSheetItems();
    } else {
      $("#nTitle").value = fillTemplate(t.title || "", now);
      $("#nText").value = fillTemplate(t.text, now);
    }
    if (t.category) fillCategorySelect(t.category);
    if (t.tags) { sheetTags = [...new Set(sheetTags.concat(t.tags))]; syncSheetTags(); }
    $("#nTemplates").hidden = true;
    fitText();
    const ta = $("#nText");
    if (kindOf(t) !== "list") { ta.focus({ preventScroll: true }); ta.selectionStart = ta.selectionEnd = ta.value.length; }
  }
  // A copy of the note as a template; the note itself stays as it is.
  async function saveAsTemplate(id) {
    const n = findList(id);
    if (!n || kindOf(n) === "quote") return;
    const now = new Date().toISOString();
    const copy = JSON.parse(JSON.stringify(n));
    delete copy.id; delete copy.pinned; delete copy.fav; delete copy.editedAt;
    if (copy.items) copy.items = copy.items.map((i) => { const c = { ...i, id: uid() }; delete c.done; delete c.doneAt; return c; });
    state.data.notes.unshift(sanitizeNote({ ...copy, template: true, createdAt: now, updatedAt: now }));
    render();
    await persist();
    toast(i18n.t("Saved as a template. New notes offer it"));
  }

  // ---------- one note out (Nov 2026) ----------
  // Markdown keeps the note as written: its pictures go inside the file, so
  // it opens whole in Obsidian or anywhere else, and [[links]] stay links.
  function noteMarkdown(n) {
    const kind = kindOf(n);
    if (kind === "list") {
      const items = n.items || [];
      const byParent = (pid) => items.filter((i) => (i.parent || "") === (pid || ""));
      const lines = [];
      const walk = (pid, depth) => { for (const i of byParent(pid)) { lines.push("  ".repeat(depth) + "- [" + (i.done ? "x" : " ") + "] " + i.text); walk(i.id, depth + 1); } };
      walk("", 0);
      // Items whose parent is gone still go out, at the top level.
      for (const i of items) if (i.parent && !items.some((x) => x.id === i.parent)) lines.push("- [" + (i.done ? "x" : " ") + "] " + i.text);
      return ["# " + (n.text || i18n.t("Untitled list")), n.note || "", lines.join("\n")].filter(Boolean).join("\n\n") + "\n";
    }
    if (kind === "quote") {
      const by = [n.author, n.source].filter(Boolean).join(", ");
      return String(n.text || "").split("\n").map((l) => "> " + l).join("\n") + (by ? "\n>\n> — " + by : "") + "\n";
    }
    const { title, body } = splitTitle(n);
    return (n.title ? "# " + title + "\n\n" + String(n.text || "") : String(n.text || "")).trim() + "\n";
  }
  const fileSafe = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "note";
  async function exportNoteMarkdown(id) {
    const n = findList(id);
    if (!n) return;
    let text = noteMarkdown(n);
    const I = Images();
    if (I) {
      for (const m of [...text.matchAll(/!\[([^\]]*)\]\((lifelog-img:[^)\s]+)\)/g)]) {
        const pid = I.idOf(m[2]);
        try {
          const u = pid && await I.url(pid);
          if (!u) continue;
          const blob = await (await fetch(u)).blob();
          const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
          text = text.replace(m[0], "![" + m[1] + "](" + data + ")");
        } catch (e) { /* the line stays as it was */ }
      }
    }
    window.LifeLogIO.download(fileSafe(linkTitle(n) || splitTitle(n).title) + ".md", text, "text/markdown");
  }
  // PDF is the system's print dialog with the note on its own ("Save as
  // PDF" there), so the text stays text. A phone prints through Android's
  // own print service.
  async function exportNotePdf(id) {
    const n = findList(id);
    if (!n) return;
    if (!$("#noteModal").hidden) {
      const ok = await saveNote(() => { closeNoteMenu(); openNoteReader(id); swapSheets("#noteModal", "#noteReader"); });
      if (ok === false) return;
    } else if (readingId !== id) openNoteReader(id);
    const root = document.documentElement;
    const title = document.title;
    document.title = fileSafe(splitTitle(n).title);
    root.classList.add("printing-note");
    const done = () => { root.classList.remove("printing-note"); document.title = title; };
    const P = window.LifeLogPlatform;
    const plugin = P && P.plugin && P.plugin("Widgets");
    try {
      if (plugin && P.android && plugin.printPage) { await plugin.printPage({ name: document.title }); done(); return; }
      window.addEventListener("afterprint", done, { once: true });
      window.print();
    } catch (e) {
      done();
      toast(i18n.t("Couldn't open printing: {error}", { error: (e && e.message) || e }), true);
    }
  }

  window.LifeLogNotes = {
    init, wire,
    tagCounts, toggleTagFilter, openTagsModal, closeTagsModal, handleTagsEscape, renameTag, catTagsOf, tagPills,
    sanitizeNote, renameNoteCategory, noteYears, getFilteredNotes, noteCats, openNoteCatModal, closeNoteCatModal, noteHaystack,
    sanitizeTodo, foldTodosIntoLists, listNotes: () => state.data.notes.filter((n) => n.kind === "list"),
    renderNotes, focusQuickList, openNoteReader, closeNoteReader, isCollection, openNote, applyNoteView,
    openNoteModal, closeNoteModal, leaveNoteModal, updateImagesSetting,
    pinnedCard, togglePinned, // the Home tab (home.js)
    tickItem, deleteItem, copyText, // the task sheet (tasks.js)
    setNoteText, // a board's card
    // the search page (search.js, 0.251.0): every note, boards included,
    // and the way a row of each kind opens
    searchable: () => state.data.notes.concat(boardItems()),
    openSearchHit: (n) => {
      if (kindOf(n) === "board") { window.LifeLogBoards.openBoard(n.board.id); return; }
      openNote(n);
    },
    // pure helpers (test/notes.test.js)
    noteDate, noteYear, splitNoteForEntry, splitTitle, plainPreview,
    linkTitle, findLinkTarget, backlinksOf, fillTemplate, noteMarkdown, templatesFor,
    followLink, saveAsTemplate,
  };
})();
