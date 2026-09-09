// LifeLog — To-do: a plain checklist, as Timeline's third mode. Separate
// from Backlog on purpose: a backlog item is something you mean to
// experience and it graduates into your log when you finish it, while a
// to-do just gets ticked and stops mattering. Different endings, different
// lists. Shared app plumbing arrives via init(ctx), same as every other
// view module.
(function () {
  let state, $, el, uid, toast, persist, render, emptyState,
    backfillUpdatedAt, keepUnknown, colorOf;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, emptyState,
      backfillUpdatedAt, keepUnknown, colorOf } = ctx);
  }

  // ---------- data ----------
  // `done` is dropped rather than stored as false, matching every other
  // optional field in the file. doneAt is what the Done panel sorts by —
  // createdAt says when you wrote it, which is not the same thing and is the
  // wrong order for a list of things you just finished.
  // `category` is optional and, when set, is one of the app's own category
  // names — the same list the timeline and backlog use, rather than a second
  // set to keep in step. A to-do that has one is listed under it; the rest
  // share the general panel. Absent rather than empty when there is none,
  // like every other optional field here.
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

  // Only the shared search narrows this. The category chips deliberately
  // don't: a to-do's category picks which panel it sits in, and filtering a
  // checklist by year would hide the ones you haven't done.
  function getFilteredTodos() {
    const q = state.search.trim().toLowerCase();
    return q ? state.data.todos.filter((t) => t.text.toLowerCase().includes(q)) : state.data.todos;
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

  // ---------- rendering ----------
  // The category the compose box is set to, kept across renders so a run of
  // to-dos for the same thing can be typed without re-picking it each time.
  let composeCat = "";

  function categorySelect(value, onPick) {
    const sel = document.createElement("select");
    sel.className = "todo-cat-select";
    const none = document.createElement("option");
    none.value = ""; none.textContent = "No category";
    sel.appendChild(none);
    for (const c of state.data.categories) {
      const opt = document.createElement("option");
      opt.value = c.name; opt.textContent = c.name;
      sel.appendChild(opt);
    }
    // A to-do can hold a category that has since been renamed or deleted;
    // keep it selectable rather than silently moving the to-do somewhere else.
    if (value && !state.data.categories.some((c) => c.name === value)) {
      const opt = document.createElement("option");
      opt.value = value; opt.textContent = value;
      sel.appendChild(opt);
    }
    sel.value = value || "";
    sel.onchange = () => onPick(sel.value);
    return sel;
  }

  function composeRow() {
    const wrap = el("div", "todo-compose");
    const input = document.createElement("input");
    input.type = "text";
    input.id = "todoCompose";
    input.placeholder = "Add a to-do…";
    input.autocomplete = "off";
    const cat = categorySelect(composeCat, (v) => { composeCat = v; });
    cat.id = "todoComposeCat";
    cat.title = "Which panel it lands in";
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
    wrap.appendChild(cat);
    wrap.appendChild(add);
    return wrap;
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
      if (ev.target.closest(".todo-check, .todo-del, .todo-edit")) return;
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
        if (e.clientY < mid && rowIsAfter) { list.insertBefore(row, other); break; }
        if (e.clientY > mid && !rowIsAfter) { list.insertBefore(row, other.nextSibling); break; }
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

  // One panel per category, plus the general one. Each carries its own
  // completed to-dos at the bottom under a rule, rather than everything
  // finished being swept into a Done panel of its own: what you ticked off
  // belongs beside what you haven't, in the list it came from.
  function panel(title, open, done, category) {
    const reordering = reorderMode && open.length > 1;
    const card = el("div", "month-card" + (reordering ? " is-reordering" : ""));
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
    card.appendChild(h);

    if (!open.length && !done.length) {
      card.appendChild(el("p", "dsc-note", "Nothing here."));
      return card;
    }
    if (!open.length) card.appendChild(el("p", "dsc-note", "All done."));
    open.forEach((t) => {
      const row = reordering ? reorderRow(t, card) : todoRow(t);
      // Only while it isn't already being reordered — and never on the
      // finished ones below, which are a record of when you ticked things
      // off, not a list to rearrange.
      if (!reordering) attachLongPressReorder(row);
      card.appendChild(row);
    });
    // Hidden while reordering: the drag walks .todo-row midpoints, and a
    // finished row in the same card would be a place to drop something that
    // then can't hold the order it was dropped into.
    if (done.length && !reordering) {
      card.appendChild(el("div", "todo-done-sep", done.length + " done"));
      done.forEach((t) => card.appendChild(todoRow(t)));
    }
    return card;
  }

  function renderTodos(root) {
    root.appendChild(composeRow());
    if (!state.data.todos.length) {
      root.appendChild(emptyState({
        glyph: "☑",
        title: "Nothing to do",
        body: "Anything you type above lands here. Tick it off and it drops to the bottom of its panel, where you can clear it out whenever it stops being satisfying to look at. Give one a category and it gets a panel of its own.",
      }));
      focusComposeIfAsked();
      return;
    }
    const todos = getFilteredTodos();
    if (!todos.length) {
      root.appendChild(emptyState("No to-dos match your search."));
      focusComposeIfAsked();
      return;
    }
    const grid = el("div", "backlog-grid");
    for (const [name, group] of panelGroups(todos)) {
      grid.appendChild(panel(
        name || "To do",
        group.filter((t) => !t.done).sort(byOrder),
        group.filter((t) => t.done).sort(byNewestDone),
        name,
      ));
    }
    root.appendChild(grid);
    focusComposeIfAsked();
  }

  // The general panel first — it's where anything you don't think about
  // lands — then a panel per category in the app's own category order, so
  // this reads in the same order as the chips everywhere else. Categories
  // with nothing in them get no panel; one a to-do names but the app no
  // longer has still does, or the to-do would have nowhere to be.
  function panelGroups(todos) {
    const groups = new Map([["", []]]);
    for (const c of state.data.categories) groups.set(c.name, []);
    for (const t of todos) {
      const key = t.category || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    return [...groups].filter(([name, list]) => list.length || name === "");
  }

  function focusComposeIfAsked() {
    if (!refocusCompose) return;
    refocusCompose = false;
    const input = $("#todoCompose");
    if (input) input.focus();
  }

  window.LifeLogTodos = {
    init,
    sanitizeTodo, assignMissingOrder, getFilteredTodos, renderTodos,
    // pure helpers (test/todos.test.js)
    byOldest, byNewestDone, byOrder, panelGroups,
  };
})();
