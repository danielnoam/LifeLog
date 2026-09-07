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
  const KNOWN_TODO_KEYS = new Set(["id", "text", "done", "doneAt", "createdAt", "updatedAt"]);
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
    return keepUnknown(t, out, KNOWN_TODO_KEYS);
  }

  const byOldest = (a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
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
    state.data.todos.push(sanitizeTodo({ text, createdAt: now, updatedAt: now }));
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
    const submit = () => { const v = input.value; input.value = ""; addTodo(v); };
    add.onclick = submit;
    input.onkeydown = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); submit(); }
      else if (ev.key === "Escape") input.value = "";
    };
    wrap.appendChild(input);
    wrap.appendChild(add);
    return wrap;
  }

  function todoRow(t) {
    const row = el("div", "todo-row" + (t.done ? " is-done" : ""));
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

  function panel(title, rows, opts) {
    const card = el("div", "month-card");
    const h = el("h3");
    const left = el("span", "mc-left");
    left.appendChild(el("span", null, title));
    h.appendChild(left);
    const right = el("span", "mc-right");
    right.appendChild(el("span", "mc", String(rows.length)));
    if (opts && opts.onClear && rows.length) {
      const btn = el("button", "btn btn-sm", "Clear");
      btn.type = "button";
      btn.title = "Delete every completed to-do";
      btn.onclick = opts.onClear;
      right.appendChild(btn);
    }
    h.appendChild(right);
    card.appendChild(h);
    if (!rows.length) card.appendChild(el("p", "dsc-note", opts && opts.empty ? opts.empty : "Nothing here."));
    else rows.forEach((t) => card.appendChild(todoRow(t)));
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
    grid.appendChild(panel("To do", todos.filter((t) => !t.done).sort(byOldest), {
      empty: "All done.",
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
    sanitizeTodo, getFilteredTodos, renderTodos,
    // pure helpers (test/todos.test.js)
    byOldest, byNewestDone,
  };
})();
