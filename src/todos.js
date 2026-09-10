// LifeLog — To-do: a plain checklist, as Timeline's third mode. Separate
// from Backlog on purpose: a backlog item is something you mean to
// experience and it graduates into your log when you finish it, while a
// to-do just gets ticked and stops mattering. Different endings, different
// lists. Shared app plumbing arrives via init(ctx), same as every other
// view module.
(function () {
  let state, $, el, uid, toast, persist, render, emptyState,
    backfillUpdatedAt, keepUnknown, prefersReducedMotion, CATEGORY_PALETTE,
    buildCatFilter, activatable;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, emptyState,
      backfillUpdatedAt, keepUnknown, prefersReducedMotion, CATEGORY_PALETTE,
      buildCatFilter, activatable } = ctx);
  }

  // Separate from init because init runs in the Node tests, which have no
  // DOM to wire — the same split every other module here makes.
  function wire() {
    $("#todoCatForm").onsubmit = saveTodoCatFromForm;
    $("#cancelTodoCatBtn").onclick = closeTodoCatModal;
    $("#deleteTodoCatBtn").onclick = deleteTodoCategory;
  }

  // state.data.todoCategories, not the journal's: a checklist's categories
  // are its own ("Errands", "Work"), and they have nothing to say about what
  // you watched or read. Looked up rather than cached in a map — the list is
  // a handful of names and this runs once per row.
  // Looked up at call time rather than captured: this file is required by the
  // Node tests, which have no DOM and never render, so reconcile.js must not
  // have to exist for the module to load.
  const reconcile = (...a) => window.LifeLogReconcile.reconcile(...a);
  const adopt = (...a) => window.LifeLogReconcile.adopt(...a);

  const todoCats = () => state.data.todoCategories || [];
  // The one mode with categories: Notes have none, so the chip row belongs to
  // this mode rather than to the tab.
  const isTodoMode = () => state.view === "notes" && state.notesMode === "todo";
  const colorOf = (name) => {
    const c = todoCats().find((x) => x.name === name);
    return (c && c.color) || "#7a8a99";
  };

  // ---------- data ----------
  // `done` is dropped rather than stored as false, matching every other
  // optional field in the file. doneAt is what the Done panel sorts by —
  // createdAt says when you wrote it, which is not the same thing and is the
  // wrong order for a list of things you just finished.
  // `category` is optional and, when set, names one of the to-do list's own
  // categories (state.data.todoCategories). A to-do that has one is listed
  // under it; the rest share the general panel. Absent rather than empty when
  // there is none, like every other optional field here.
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
    if (t.done) {
      out.done = true;
      // A to-do ticked before doneAt existed, or by a hand edit, still has to
      // sort somewhere: its own stamp is the closest thing to the truth.
      out.doneAt = t.doneAt || out.updatedAt;
    }
    if (Number.isFinite(+t.order)) out.order = +t.order;
    return keepUnknown(t, out, KNOWN_TODO_KEYS);
  }

  // The To do panel is hand-ordered, and the order has to be a field: a sync
  // merge rebuilds each collection from an id set (see mergeCollection), so
  // array position doesn't survive a round trip between devices.
  //
  // Anything from before the field gets one here, derived from createdAt —
  // which is the order it was already being shown in, and which two devices
  // deriving it independently both arrive at, so this can't itself become a
  // conflict. Called from normalize, so it rides out on the next save
  // rather than costing one of its own.
  function assignMissingOrder(list) {
    if (!list.some((t) => t.order === undefined)) return list;
    const seq = list.slice().sort(byOldest);
    seq.forEach((t, i) => { if (t.order === undefined) t.order = i; });
    return list;
  }

  const byOldest = (a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  // Hand-ordered, falling back to when it was written for anything that
  // somehow still has no order (a hand-edited file reaching render before
  // normalize has been near it).
  const byOrder = (a, b) => (+a.order || 0) - (+b.order || 0) || byOldest(a, b);
  const byNewestDone = (a, b) => String(b.doneAt || "").localeCompare(String(a.doneAt || ""));

  // The shared search and the category chips. Not years: hiding an undone
  // to-do because you tapped a year chip would be a trap, not a filter.
  //
  // An empty chip set means "everything", not "nothing" — same as the rest of
  // the app, and the only reading that makes an untouched filter invisible.
  function getFilteredTodos() {
    const q = state.search.trim().toLowerCase();
    const cats = state.todoActiveCats;
    const all = !cats || !cats.size;
    return state.data.todos.filter((t) =>
      (!q || t.text.toLowerCase().includes(q)) &&
      (all || cats.has(t.category || "")));
  }

  // ---------- actions ----------
  // Focus is restored after the render that follows an add, so a list can be
  // typed straight through without reaching for the box again each time.
  let refocusCompose = false;

  async function addTodo(text, category) {
    text = text.trim();
    if (!text) return;
    const now = new Date().toISOString();
    // Onto the end of the list, which is where you were looking when you
    // typed it.
    const last = state.data.todos.reduce((n, t) => Math.max(n, +t.order || 0), -1);
    state.data.todos.push(sanitizeTodo({ text, category, order: last + 1, createdAt: now, updatedAt: now }));
    refocusCompose = true;
    render();
    await persist();
  }

  // A category created from a picker lives in state.data.todoCategories like
  // any other collection, so it saves the same way — this is only ever
  // needed where the pick itself didn't already write something.
  async function commitCategories() {
    buildCatFilter();
    render();
    await persist();
  }

  async function setTodoCategory(id, category) {
    const t = state.data.todos.find((x) => x.id === id);
    if (!t) return;
    const next = String(category || "").trim();
    if ((t.category || "") === next) { render(); return; }
    if (next) t.category = next; else delete t.category;
    render();
    await persist();
  }

  async function toggleTodo(id) {
    const t = state.data.todos.find((x) => x.id === id);
    if (!t) return;
    if (t.done) { delete t.done; delete t.doneAt; }
    else { t.done = true; t.doneAt = new Date().toISOString(); }
    render();
    await persist();
  }

  async function editTodo(id, text) {
    const t = state.data.todos.find((x) => x.id === id);
    if (!t) return;
    text = text.trim();
    // An emptied box is a cancel, not a delete: deleting is the ✕, and
    // silently losing a line because a stray tap selected all of it would be
    // the worse surprise.
    if (!text || text === t.text) { render(); return; }
    t.text = text;
    render();
    await persist();
  }

  // No confirm: it's one line of text, and Settings → Data → Recently
  // deleted has it if the tap was an accident.
  async function deleteTodo(id) {
    state.data.todos = state.data.todos.filter((t) => t.id !== id);
    render();
    await persist();
  }

  // Per panel, since that's the only place the completed ones are now shown:
  // a single button that emptied every panel's tail would be reaching past
  // the list you were actually looking at.
  async function clearCompleted(category) {
    const inPanel = (t) => (t.category || "") === (category || "");
    const n = state.data.todos.filter((t) => t.done && inPanel(t)).length;
    if (!n) return;
    const where = category ? ` from ${category}` : "";
    if (!confirm(`Clear ${n} completed to-do${n === 1 ? "" : "s"}${where}?`)) return;
    state.data.todos = state.data.todos.filter((t) => !(t.done && inPanel(t)));
    render();
    await persist();
    toast(`Cleared ${n} completed`);
  }

  // ---------- categories ----------
  // The third add/edit-category modal in the app, after the journal's and
  // Finance's — TODO.md has the note about folding all three into one. This
  // is the simplest: a to-do category cascades to one collection, and there
  // is no "Other" for its to-dos to fall back into, so deleting one just
  // leaves them in the general panel.
  function openTodoCatModal(cat) {
    const editing = !!cat;
    $("#todoCatModalTitle").textContent = editing ? "Edit to-do category" : "Add to-do category";
    $("#todoCatOrigName").value = editing ? cat.name : "";
    $("#todoCatName").value = editing ? cat.name : "";
    $("#todoCatColorInput").value = editing ? cat.color : nextColor();
    const uses = $("#todoCatUses");
    if (editing) {
      const n = state.data.todos.filter((t) => t.category === cat.name).length;
      uses.textContent = n + (n === 1 ? " to-do uses this" : " to-dos use this");
      uses.hidden = false;
    } else uses.hidden = true;
    $("#deleteTodoCatBtn").hidden = !editing;
    $("#todoCatModal").hidden = false;
    $("#todoCatName").focus();
  }
  function closeTodoCatModal() { $("#todoCatModal").hidden = true; }

  const nextColor = () => CATEGORY_PALETTE[todoCats().length % CATEGORY_PALETTE.length];

  async function saveTodoCatFromForm(ev) {
    ev.preventDefault();
    const orig = $("#todoCatOrigName").value;
    const name = $("#todoCatName").value.trim();
    const color = $("#todoCatColorInput").value;
    if (!name) return;
    const cats = state.data.todoCategories;
    const clash = (c) => c.name.toLowerCase() === name.toLowerCase();

    if (!orig) {
      if (cats.some(clash)) { toast("That category already exists", true); return; }
      cats.push({ id: uid(), name, color, updatedAt: new Date().toISOString() });
      closeTodoCatModal();
      await commitCategories();
      toast("To-do category added");
      return;
    }

    const cat = cats.find((c) => c.name === orig);
    if (!cat) return;
    if (name !== cat.name && cats.some((c) => c !== cat && clash(c))) {
      toast("A category with that name already exists", true);
      return;
    }
    cat.color = color;
    if (name !== cat.name) {
      // The id stays put across a rename — it's this category's sync
      // identity. Only the name it's known by changes, and every to-do
      // holding the old one follows it.
      const old = cat.name;
      cat.name = name;
      state.data.todos.forEach((t) => { if (t.category === old) t.category = name; });
      if (state.todoActiveCats.has(old)) {
        state.todoActiveCats.delete(old);
        state.todoActiveCats.add(name);
      }
      if (composeCat === old) composeCat = name;
    }
    closeTodoCatModal();
    await commitCategories();
    toast("To-do category saved");
  }

  async function deleteTodoCategory() {
    const cats = state.data.todoCategories;
    const cat = cats.find((c) => c.name === $("#todoCatOrigName").value);
    if (!cat) return;
    const using = state.data.todos.filter((t) => t.category === cat.name);
    const ask = using.length
      ? `“${cat.name}” is used by ${using.length} to-do${using.length === 1 ? "" : "s"}. Delete it and move them to the general list?`
      : `Delete to-do category “${cat.name}”?`;
    if (!confirm(ask)) return;
    using.forEach((t) => { delete t.category; });
    state.data.todoCategories = cats.filter((c) => c !== cat);
    state.todoActiveCats.delete(cat.name);
    if (composeCat === cat.name) composeCat = "";
    closeTodoCatModal();
    await commitCategories();
    toast("To-do category deleted");
  }

  // ---------- rendering ----------
  // The category the compose box is set to, kept across renders so a run of
  // to-dos for the same thing can be typed without re-picking it each time.
  let composeCat = "";

  const NEW_CATEGORY = "\u0000new";

  function categorySelect(value, onPick) {
    const sel = document.createElement("select");
    sel.className = "todo-cat-select";
    const none = document.createElement("option");
    none.value = ""; none.textContent = "No category";
    sel.appendChild(none);
    const names = todoCats().map((c) => c.name);
    // A to-do can hold a name the list doesn't have (a hand-edited file, or a
    // sync that brought the to-do before its category); keep it selectable
    // rather than silently moving the to-do somewhere else.
    if (value && !names.includes(value)) names.push(value);
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    }
    const add = document.createElement("option");
    add.value = NEW_CATEGORY; add.textContent = "+ New category…";
    sel.appendChild(add);
    sel.value = value || "";
    sel.onchange = () => {
      if (sel.value !== NEW_CATEGORY) { onPick(sel.value, false); return; }
      const name = newCategory();
      // Back to what it was on a cancel, rather than leaving "+ New
      // category…" showing as though it were a choice. On a create there is
      // no point setting sel.value either: this select's options were built
      // before the category existed, so it has none to select. The caller's
      // re-render is what puts a picker on screen that knows about it.
      if (!name) { sel.value = value || ""; onPick(value || "", false); return; }
      onPick(name, true);
    };
    return sel;
  }

  // Creating one is part of picking one: a checklist's categories appear as
  // you need them, so a separate place to manage them first would be a
  // detour. Renaming and recolouring are in TODO.md.
  function newCategory() {
    const name = (prompt("New to-do category") || "").trim();
    if (!name) return "";
    const cats = state.data.todoCategories;
    const existing = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.name;
    cats.push({
      id: uid(),
      name,
      color: CATEGORY_PALETTE[cats.length % CATEGORY_PALETTE.length],
      updatedAt: new Date().toISOString(),
    });
    return name;
  }

  function composeRow() {
    const wrap = el("div", "todo-compose");
    const input = document.createElement("input");
    input.type = "text";
    input.id = "todoCompose";
    input.placeholder = "Add a to-do…";
    input.autocomplete = "off";
    composeSel = buildComposeCat();
    const add = el("button", "btn btn-primary btn-sm", "Add");
    add.type = "button";
    add.disabled = true;
    const submit = () => {
      const v = input.value;
      input.value = "";
      add.disabled = true;
      addTodo(v, composeCat);
    };
    add.onclick = submit;
    // Enter is the fast path and the button is the discoverable one; it
    // stays disabled until there's something to add, so it never invites a
    // press that does nothing.
    input.oninput = () => { add.disabled = !input.value.trim(); };
    input.onkeydown = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); submit(); }
      else if (ev.key === "Escape") { input.value = ""; add.disabled = true; }
    };
    wrap.appendChild(input);
    wrap.appendChild(composeSel);
    wrap.appendChild(add);
    return wrap;
  }

  function buildComposeCat() {
    const cat = categorySelect(composeCat, (v, created) => {
      composeCat = v;
      // A plain pick changes nothing on screen and nothing worth saving. A
      // new category is both: the picker has to be rebuilt to contain it,
      // and it has to survive a reload.
      if (created) commitCategories();
    });
    cat.id = "todoComposeCat";
    cat.title = "Which panel it lands in";
    return cat;
  }

  // ---------- reordering ----------
  // Long-press any unticked to-do and the whole list becomes draggable, so
  // the order stops being "whenever I happened to think of it". Not on the
  // Done panel: that one is a record of when you finished things, and
  // rearranging it would be rearranging the past.
  let reorderMode = false;
  const LONG_PRESS_MS = 500;

  function attachLongPressReorder(row) {
    let timer = null, start = null;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } start = null; };
    row.addEventListener("pointerdown", (ev) => {
      if (reorderMode) return;
      // Only the two controls opt out — a press on either is aiming at it.
      // The text used to opt out as well, "so it can still be long-pressed to
      // select or copy", which left nowhere to press at all: a row is a
      // checkbox, its text and a ✕, so every press landed on an exemption and
      // the gesture could not fire. Selecting the text is what the inline
      // editor is for (tap it), and .todo-row now says user-select: none so a
      // long press doesn't start a selection instead.
      if (ev.target.closest(".todo-check, .todo-del, .todo-edit, .todo-cat")) return;
      start = { x: ev.clientX, y: ev.clientY };
      timer = setTimeout(() => { timer = null; reorderMode = true; render(); }, LONG_PRESS_MS);
    });
    row.addEventListener("pointermove", (ev) => {
      if (!start) return;
      if (Math.abs(ev.clientX - start.x) > 10 || Math.abs(ev.clientY - start.y) > 10) cancel();
    });
    row.addEventListener("pointerup", cancel);
    row.addEventListener("pointercancel", cancel);
  }

  // The row being dragged snaps to its new slot — it's the one under your
  // finger, and lagging it behind would be lying about where it is — while
  // whatever it displaced slides into the space it left. FLIP: measure, move,
  // put everything back where it was with a transform, then release the
  // transform and let CSS carry it home.
  function slideDisplaced(list, dragged, mutate) {
    if (prefersReducedMotion()) { mutate(); return; }
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
    if (!moved.length) return;
    // Two frames: one for the browser to take the start position as given,
    // the next to change it. In one, the style change coalesces with the
    // move above and nothing animates at all.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const r of moved) { r.style.transition = ""; r.style.transform = ""; }
    }));
  }

  // Reorders the rows under the finger as it passes each neighbour's
  // midpoint, so the list shows the result while you're still holding it
  // rather than rearranging itself once you let go.
  function beginRowDrag(ev, row, list) {
    ev.preventDefault();
    row.classList.add("is-dragging");
    const onMove = (e) => {
      if (e.pointerId !== ev.pointerId) return;
      for (const other of [...list.querySelectorAll(".todo-row")]) {
        if (other === row) continue;
        const box = other.getBoundingClientRect();
        const mid = box.top + box.height / 2;
        const rowIsAfter = !!(other.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (e.clientY < mid && rowIsAfter) {
          slideDisplaced(list, row, () => list.insertBefore(row, other));
          break;
        }
        if (e.clientY > mid && !rowIsAfter) {
          slideDisplaced(list, row, () => list.insertBefore(row, other.nextSibling));
          break;
        }
      }
    };
    const onUp = (e) => {
      if (e.pointerId !== ev.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      row.classList.remove("is-dragging");
      commitOrder(list);
    };
    // On the window, and deliberately not via setPointerCapture on the row:
    // insertBefore *moves* the row, which counts as a removal, and a captured
    // element that leaves the DOM loses its capture. The first swap therefore
    // killed the gesture — the list would shuffle by exactly one position and
    // then go dead, with the pointerup landing somewhere else entirely and
    // nothing ever saved. The window doesn't move.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // Renumbers from the DOM the drag just rearranged. Sequential rather than
  // fractional: it marks every moved row as changed instead of one, which on
  // a list this size is a few hundred bytes of sync against a whole class of
  // drifting-float bugs.
  //
  // The panel's own order values are reused rather than renumbered 0..n:
  // `order` is one field across every panel, so writing 0,1,2 into a category
  // panel would collide with the general one's. Dealing the panel's existing
  // slots back out in the new sequence keeps each panel's numbers to itself.
  async function commitOrder(list) {
    const rows = [...list.querySelectorAll(".todo-row")]
      .map((r) => state.data.todos.find((x) => x.id === r.dataset.id))
      .filter(Boolean);
    const slots = rows.map((t) => +t.order || 0).sort((a, b) => a - b);
    let changed = false;
    rows.forEach((t, i) => {
      if (t.order !== slots[i]) { t.order = slots[i]; changed = true; }
    });
    if (!changed) return;
    render();
    await persist();
  }

  function todoRow(t) {
    const row = el("div", "todo-row" + (t.done ? " is-done" : ""));
    row.dataset.id = t.id;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "todo-check";
    cb.checked = !!t.done;
    cb.setAttribute("aria-label", (t.done ? "Mark as not done: " : "Mark as done: ") + t.text);
    cb.onchange = () => toggleTodo(t.id);
    row.appendChild(cb);

    const text = el("span", "todo-text", t.text);
    // Edited in place rather than in a modal: a to-do is one line, and a
    // modal to fix a typo in one line is more ceremony than the line is
    // worth.
    text.onclick = () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "todo-edit";
      input.value = t.text;
      let closed = false;
      const commit = () => { if (closed) return; closed = true; editTodo(t.id, input.value); };
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

    row.appendChild(catChip(t));

    const del = el("button", "todo-del", "✕");
    del.type = "button";
    del.title = "Delete";
    del.setAttribute("aria-label", "Delete: " + t.text);
    del.onclick = () => deleteTodo(t.id);
    row.appendChild(del);
    return row;
  }

  // Which panel this one sits in, and the way to move it to another. Swapped
  // for a select in place on click, the same idiom the text above uses —
  // a dropdown per row rendered up front would be a lot of chrome for
  // something most rows never change.
  // Just the dot: the panel heading already says which category this is, so
  // repeating the name on every row inside it was the same word twenty
  // times. The dot keeps the control in the same column on every row, filled
  // where there's a category and outlined where there isn't.
  function catChip(t) {
    const chip = el("button", "todo-cat" + (t.category ? "" : " is-none"));
    chip.type = "button";
    chip.title = t.category ? "In " + t.category : "No category";
    chip.setAttribute("aria-label", chip.title + " — change");
    const dot = el("span", "dot");
    dot.style.background = t.category ? colorOf(t.category) : "transparent";
    chip.appendChild(dot);
    chip.onclick = () => {
      let closed = false;
      const sel = categorySelect(t.category || "", (v) => {
        if (closed) return;
        closed = true;
        setTodoCategory(t.id, v);
      });
      sel.onblur = () => { if (!closed) { closed = true; render(); } };
      chip.replaceWith(sel);
      sel.focus();
      // Focusing a select doesn't open it, on a desktop or a phone — the dot
      // turned into a closed dropdown and the whole thing read as broken
      // until you clicked a second time. showPicker is the one call that
      // opens it; where it isn't available the focused select is still one
      // press away, which is where this started.
      try { sel.showPicker(); } catch (e) { /* older browser, or not user-initiated */ }
    };
    return chip;
  }

  // The same row while the list is being reordered: a grip instead of the
  // checkbox and no ✕, because a drag that ticks something off or deletes it
  // on the way past is the one thing this must not do.
  function reorderRow(t, list) {
    const row = el("div", "todo-row is-reorder");
    row.dataset.id = t.id;
    const grip = el("span", "todo-grip", "⠿");
    grip.setAttribute("aria-hidden", "true");
    row.appendChild(grip);
    row.appendChild(el("span", "todo-text", t.text));
    row.addEventListener("pointerdown", (ev) => beginRowDrag(ev, row, list));
    return row;
  }

  // ---------- panels ----------
  // One panel per category, plus the general one. Each carries its own
  // completed to-dos at the bottom under a rule, rather than everything
  // finished being swept into a Done panel of its own: what you ticked off
  // belongs beside what you haven't, in the list it came from.
  //
  // Built through reconcile.js rather than assembled and appended (0.130.0):
  // the card, its header and every row keep their nodes across a render, so
  // ticking a to-do *moves* its row past the done separator instead of
  // destroying one row above the rule and creating an unrelated one below.
  //
  // The header, the two notes and the separator ride in the same keyed list
  // as the rows, under reserved keys. That keeps the card's DOM shape exactly
  // what it was — no wrapper element, no CSS to chase — and it's the same
  // trick the Backlog's band separators will need.
  function panelParts(title, category, open, done, reordering) {
    const parts = [{ key: "__head", kind: "head", title, category, open, done, reordering }];
    if (!open.length && !done.length) {
      parts.push({ key: "__note", kind: "note", text: "Nothing here." });
      return parts;
    }
    if (!open.length) parts.push({ key: "__note", kind: "note", text: "All done." });
    for (const t of open) parts.push({ key: t.id, kind: "row", todo: t, reordering });
    // Hidden while reordering: the drag walks .todo-row midpoints, and a
    // finished row in the same card would be a place to drop something that
    // then can't hold the order it was dropped into.
    if (done.length && !reordering) {
      parts.push({ key: "__sep", kind: "sep", text: done.length + " done" });
      // Keyed by the to-do's own id, the same as an open row, so ticking one
      // is a move across the separator rather than a delete and an insert.
      for (const t of done) parts.push({ key: t.id, kind: "row", todo: t, reordering: false });
    }
    return parts;
  }

  function panelHeader(title, category, open, done, reordering) {
    const h = el("h3");
    const left = el("span", "mc-left");
    if (category) {
      const dot = el("span", "dot");
      dot.style.background = colorOf(category);
      left.appendChild(dot);
    }
    left.appendChild(el("span", null, reordering ? "Drag to reorder" : title));
    h.appendChild(left);
    const right = el("span", "mc-right");
    if (reordering) {
      const btn = el("button", "btn btn-sm btn-primary", "Done");
      btn.type = "button";
      btn.onclick = () => { reorderMode = false; render(); };
      right.appendChild(btn);
    } else {
      right.appendChild(el("span", "mc", String(open.length)));
      if (done.length) {
        const btn = el("button", "btn btn-sm", "Clear");
        btn.type = "button";
        btn.title = "Delete this panel's completed to-dos";
        btn.onclick = () => clearCompleted(category);
        right.appendChild(btn);
      }
    }
    h.appendChild(right);
    return h;
  }

  // Element-level listeners belong here and only here: create() runs once per
  // node, while update() runs on every render and works by adopting a freshly
  // built node's contents — which drops that fresh node, and anything bound
  // to it. Binding a listener in update() would bind it to the wrong element
  // and leak one per render.
  function createPart(p, card) {
    if (p.kind === "head") return el("h3");
    if (p.kind === "note") return el("p", "dsc-note");
    if (p.kind === "sep") return el("div", "todo-done-sep");
    const row = el("div", "todo-row");
    // Only while it isn't already being reordered — and never on the finished
    // ones below, which are a record of when you ticked things off, not a
    // list to rearrange. Which of the two a row gets is settled by the
    // panel's epoch, so a row never has to switch from one to the other.
    if (p.reordering) row.addEventListener("pointerdown", (ev) => beginRowDrag(ev, row, card));
    else attachLongPressReorder(row);
    return row;
  }

  function updatePart(node, p, card) {
    if (p.kind === "head") { adopt(node, panelHeader(p.title, p.category, p.open, p.done, p.reordering)); return; }
    if (p.kind === "note" || p.kind === "sep") { node.textContent = p.text; return; }
    adopt(node, p.reordering ? reorderRow(p.todo, card) : todoRow(p.todo));
  }

  function fillPanel(card, title, category, group) {
    const open = group.filter((t) => !t.done).sort(byOrder);
    const done = group.filter((t) => t.done).sort(byNewestDone);
    const reordering = reorderMode && open.length > 1;
    card.className = "month-card" + (reordering ? " is-reordering" : "");
    reconcile(card, panelParts(title, category, open, done, reordering), {
      // Reordering swaps every row for a different kind of row — a grip
      // instead of a checkbox, a drag listener instead of a long-press. Those
      // are bound in create(), so the switch has to rebuild rather than
      // refill, which is exactly what a changed epoch does.
      epoch: reordering ? "reorder" : "normal",
      keyOf: (p) => p.key,
      create: (p) => createPart(p, card),
      update: (node, p) => updatePart(node, p, card),
    });
  }

  // ---------- the view ----------
  // The shell outlives a render. app.js still clears #viewBody on its way
  // through (that changes in its own release), so holding a reference to this
  // subtree is what lets it survive: clearing a parent detaches these nodes
  // but does not destroy them, and appending the shell again re-attaches it
  // with every panel, row and listener intact.
  let todoRootEl = null, composeEl = null, composeSel = null, todoGridEl = null;

  function todoShell() {
    if (!todoRootEl) {
      todoRootEl = document.createElement("div");
      composeEl = composeRow();
      todoRootEl.appendChild(composeEl);
    }
    return todoRootEl;
  }

  // The compose box now persists, so what you had half-typed survives a
  // render that arrives while you're typing (a sync landing, say). Its
  // category picker still has to keep up with the category list, so that one
  // element — and nothing around it — is swapped each time.
  function refreshComposeCat() {
    if (!composeSel || document.activeElement === composeSel) return;
    const next = buildComposeCat();
    composeSel.replaceWith(next);
    composeSel = next;
  }

  function setTodoBody(shell, node) {
    const current = composeEl.nextSibling;
    if (current === node) return;
    if (current) shell.replaceChild(node, current);
    else shell.appendChild(node);
  }

  function renderTodos(root) {
    const shell = todoShell();
    refreshComposeCat();
    root.appendChild(shell);

    if (!state.data.todos.length) {
      setTodoBody(shell, emptyState({
        glyph: "☑",
        title: "Nothing to do",
        body: "Anything you type above lands here. Tick it off and it drops to the bottom of its panel, where you can clear it out whenever it stops being satisfying to look at. Give one a category and it gets a panel of its own.",
      }));
      focusComposeIfAsked();
      return;
    }
    const todos = getFilteredTodos();
    if (!todos.length) {
      setTodoBody(shell, emptyState("No to-dos match your search."));
      focusComposeIfAsked();
      return;
    }
    if (!todoGridEl) todoGridEl = el("div", "backlog-grid");
    setTodoBody(shell, todoGridEl);
    reconcile(todoGridEl, panelGroups(todos), {
      keyOf: ([name]) => "cat:" + name,
      create: () => el("div", "month-card"),
      update: (card, [name, group]) => fillPanel(card, name || "To do", name, group),
    });
    focusComposeIfAsked();
  }

  // The general panel first — it's where anything you don't think about
  // lands — then a panel per to-do category, in the order that list holds
  // them. Categories with nothing in them get no panel; one a to-do names
  // that the list doesn't have still does, or the to-do would have nowhere
  // to be.
  function panelGroups(todos) {
    const groups = new Map([["", []]]);
    for (const c of todoCats()) groups.set(c.name, []);
    for (const t of todos) {
      const key = t.category || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    // The general panel is kept even when empty — it's where anything new
    // lands, so a checklist with nothing in it still has somewhere to look.
    // Not while the chips are narrowing things, though: there it's a panel
    // saying "Nothing here" about a category you didn't ask to see.
    const filtering = state.todoActiveCats && state.todoActiveCats.size;
    return [...groups].filter(([name, list]) => list.length || (name === "" && !filtering));
  }

  function focusComposeIfAsked() {
    if (!refocusCompose) return;
    refocusCompose = false;
    const input = $("#todoCompose");
    if (input) input.focus();
  }

  window.LifeLogTodos = {
    init, wire,
    sanitizeTodo, assignMissingOrder, getFilteredTodos, renderTodos,
    // the Categories chip row (buildCatFilter in app.js) and its modal
    todoCats, colorOf, openTodoCatModal, closeTodoCatModal, isTodoMode,
    // pure helpers (test/todos.test.js)
    byOldest, byNewestDone, byOrder, panelGroups,
  };
})();
