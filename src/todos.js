// LifeLog — To-do: a plain checklist, as Timeline's third mode. Separate
// from Backlog on purpose: a backlog item is something you mean to
// experience and it graduates into your log when you finish it, while a
// to-do just gets ticked and stops mattering. Different endings, different
// lists. Shared app plumbing arrives via init(ctx), same as every other
// view module.
(function () {
  let state, $, el, uid, toast, persist, render, emptyState,
    backfillUpdatedAt, keepUnknown;

  function init(ctx) {
    ({ state, $, el, uid, toast, persist, render, emptyState,
      backfillUpdatedAt, keepUnknown } = ctx);
  }

  // ---------- data ----------
  // `done` is dropped rather than stored as false, matching every other
  // optional field in the file. doneAt is what the Done panel sorts by —
  // createdAt says when you wrote it, which is not the same thing and is the
  // wrong order for a list of things you just finished.
  const KNOWN_TODO_KEYS = new Set(["id", "text", "done", "doneAt", "order", "createdAt", "updatedAt"]);
  function sanitizeTodo(t) {
    const out = {
      id: t.id || uid(),
      text: String(t.text == null ? "" : t.text).trim(),
      createdAt: t.createdAt || null,
      updatedAt: backfillUpdatedAt(t),
    };
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

  // Only the shared search narrows this: a to-do has no category, and
  // filtering a checklist by year would hide the ones you haven't done.
  function getFilteredTodos() {
    const q = state.search.trim().toLowerCase();
    return q ? state.data.todos.filter((t) => t.text.toLowerCase().includes(q)) : state.data.todos;
  }

  // ---------- actions ----------
  // Focus is restored after the render that follows an add, so a list can be
  // typed straight through without reaching for the box again each time.
  let refocusCompose = false;

  async function addTodo(text) {
    text = text.trim();
    if (!text) return;
    const now = new Date().toISOString();
    // Onto the end of the list, which is where you were looking when you
    // typed it.
    const last = state.data.todos.reduce((n, t) => Math.max(n, +t.order || 0), -1);
    state.data.todos.push(sanitizeTodo({ text, order: last + 1, createdAt: now, updatedAt: now }));
    refocusCompose = true;
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

  async function clearCompleted() {
    const n = state.data.todos.filter((t) => t.done).length;
    if (!n) return;
    if (!confirm(`Clear ${n} completed to-do${n === 1 ? "" : "s"}?`)) return;
    state.data.todos = state.data.todos.filter((t) => !t.done);
    render();
    await persist();
    toast(`Cleared ${n} completed`);
  }

  // ---------- rendering ----------
  function composeRow() {
    const wrap = el("div", "todo-compose");
    const input = document.createElement("input");
    input.type = "text";
    input.id = "todoCompose";
    input.placeholder = "Add a to-do…";
    input.autocomplete = "off";
    const add = el("button", "btn btn-primary btn-sm", "Add");
    add.type = "button";
    add.disabled = true;
    const submit = () => {
      const v = input.value;
      input.value = "";
      add.disabled = true;
      addTodo(v);
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
      // The text opts out so it can still be long-pressed to select or copy,
      // the same exemption the timeline and backlog rows make.
      if (ev.target.closest(".todo-text, .todo-check, .todo-del")) return;
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
  async function commitOrder(list) {
    const ids = [...list.querySelectorAll(".todo-row")].map((r) => r.dataset.id);
    let changed = false;
    ids.forEach((id, i) => {
      const t = state.data.todos.find((x) => x.id === id);
      if (t && t.order !== i) { t.order = i; changed = true; }
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

    const del = el("button", "todo-del", "✕");
    del.type = "button";
    del.title = "Delete";
    del.setAttribute("aria-label", "Delete: " + t.text);
    del.onclick = () => deleteTodo(t.id);
    row.appendChild(del);
    return row;
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

  function panel(title, rows, opts) {
    opts = opts || {};
    const reordering = !!opts.reorderable && reorderMode && rows.length > 1;
    const card = el("div", "month-card" + (reordering ? " is-reordering" : ""));
    const h = el("h3");
    const left = el("span", "mc-left");
    left.appendChild(el("span", null, reordering ? "Drag to reorder" : title));
    h.appendChild(left);
    const right = el("span", "mc-right");
    if (reordering) {
      const done = el("button", "btn btn-sm btn-primary", "Done");
      done.type = "button";
      done.onclick = () => { reorderMode = false; render(); };
      right.appendChild(done);
    } else {
      right.appendChild(el("span", "mc", String(rows.length)));
      if (opts.onClear && rows.length) {
        const btn = el("button", "btn btn-sm", "Clear");
        btn.type = "button";
        btn.title = "Delete every completed to-do";
        btn.onclick = opts.onClear;
        right.appendChild(btn);
      }
    }
    h.appendChild(right);
    card.appendChild(h);
    if (!rows.length) { card.appendChild(el("p", "dsc-note", opts.empty || "Nothing here.")); return card; }
    rows.forEach((t) => {
      const row = reordering ? reorderRow(t, card) : todoRow(t);
      // Long-press is offered on the panel that can be reordered, and only
      // while it isn't already being reordered.
      if (opts.reorderable && !reordering) attachLongPressReorder(row);
      card.appendChild(row);
    });
    return card;
  }

  function renderTodos(root) {
    root.appendChild(composeRow());
    if (!state.data.todos.length) {
      root.appendChild(emptyState({
        glyph: "☑",
        title: "Nothing to do",
        body: "Anything you type above lands here. Tick it off and it moves to Done — which you can clear out whenever it stops being satisfying to look at.",
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
    grid.appendChild(panel("To do", todos.filter((t) => !t.done).sort(byOrder), {
      empty: "All done.",
      reorderable: true,
    }));
    grid.appendChild(panel("Done", todos.filter((t) => t.done).sort(byNewestDone), {
      empty: "Nothing ticked off yet.",
      onClear: clearCompleted,
    }));
    root.appendChild(grid);
    focusComposeIfAsked();
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
    byOldest, byNewestDone, byOrder,
  };
})();
