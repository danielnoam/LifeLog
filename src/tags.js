// LifeLog — tags (Nov 2026): free words on a note, a quote, a task list, a
// task (or subtask) and a board, across every category and type.
//
// Stored as `tags: ["weekend", "camping"]` on the thing itself, absent when
// empty. There's no list of tags of its own: a tag exists while something
// carries it, so renaming or deleting one is a walk over everything.
// A tag keeps the case it was first typed in; two that differ only in case
// are the same tag (key()).
//
// A note category can carry `tags` too: the tags a note, list, quote or
// board made in it starts with. Only on making one, never on moving one in.
//
// This file is the data side (cleaning, counting, renaming) and the tag
// field the sheets share. The chips, cards and the All tags sheet are in
// notes.js and app.js with the rest of the Notebook.
(function () {
  const MAX_LEN = 40;
  const MAX_TAGS = 30;
  const key = (t) => String(t).toLowerCase();
  // "#Road  trip," → "Road trip". Commas end a tag as you type, so none
  // stays inside one.
  function cleanOne(t) {
    return String(t == null ? "" : t).replace(/^#+/, "").replace(/[\s,]+/g, " ").trim().slice(0, MAX_LEN).trim();
  }
  function clean(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set(), out = [];
    for (const raw of list) {
      const t = cleanOne(raw);
      if (!t || seen.has(key(t))) continue;
      seen.add(key(t));
      out.push(t);
      if (out.length >= MAX_TAGS) break;
    }
    return out;
  }
  // Sets (or removes) obj.tags; true when it changed.
  function setOn(obj, list) {
    const before = JSON.stringify(obj.tags || []);
    const c = clean(list);
    if (c.length) obj.tags = c; else delete obj.tags;
    return JSON.stringify(obj.tags || []) !== before;
  }
  const has = (list, tag) => (list || []).some((t) => key(t) === key(tag));
  // `keys` is a Set of key()s: true when the list holds any of them.
  const hasAny = (list, keys) => (list || []).some((t) => keys.has(key(t)));

  // Everything that can carry a tag, as { kind, obj, note? }: kind is
  // text, quote, list, task or board. A note's kind is absent for plain.
  function* holders(notes, boards) {
    for (const n of notes || []) {
      yield { kind: n.kind === "list" ? "list" : n.kind === "quote" ? "quote" : "text", obj: n };
      if (n.kind === "list") for (const it of n.items || []) yield { kind: "task", obj: it, note: n };
    }
    for (const b of boards || []) if (!b.scratch) yield { kind: "board", obj: b };
  }
  // Every tag in use, most used first: { name, key, total, text, quote, list, task, board }.
  // `saved`: tags made with + in the Tags row (settings.tagNames), listed
  // with 0 until something carries them.
  function count(notes, boards, saved) {
    const by = new Map();
    for (const h of holders(notes, boards)) {
      for (const t of h.obj.tags || []) {
        const k = key(t);
        let c = by.get(k);
        if (!c) by.set(k, (c = { name: t, key: k, total: 0, text: 0, quote: 0, list: 0, task: 0, board: 0 }));
        c.total++;
        c[h.kind]++;
      }
    }
    for (const t of clean(saved)) if (!by.has(key(t))) by.set(key(t), { name: t, key: key(t), total: 0, text: 0, quote: 0, list: 0, task: 0, board: 0 });
    return [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }
  const KIND_WORDS = [["text", "note", "notes"], ["quote", "quote", "quotes"], ["list", "list", "lists"], ["task", "task", "tasks"], ["board", "board", "boards"]];
  // "2 notes · 1 list · 1 board"
  const summary = (c) => KIND_WORDS.filter(([k]) => c[k]).map(([k, one, many]) => c[k] + " " + (c[k] === 1 ? one : many)).join(" · ") || "Not used yet";

  // One tag renamed (or deleted, `to` empty) in a list; null when the list
  // doesn't hold it. Renaming onto a tag the list already has leaves one.
  function renamed(list, from, to) {
    if (!has(list, from)) return null;
    const next = [];
    for (const t of list) next.push(key(t) === key(from) ? to : t);
    return clean(next.filter(Boolean));
  }
  // Over everything: notes, their tasks, boards and the categories' tags
  // for new notes. Returns what changed, so the caller can stamp and save:
  // { notes: Set of notes changed (a task changing changes its list),
  //   items: tasks changed, boards: boards changed, cats: categories changed }.
  function renameIn({ notes, boards, cats }, from, to) {
    to = cleanOne(to);
    const out = { notes: new Set(), items: [], boards: [], cats: [] };
    const apply = (obj) => { const r = renamed(obj.tags, from, to); if (!r) return false; if (r.length) obj.tags = r; else delete obj.tags; return true; };
    for (const h of holders(notes, boards)) {
      if (!apply(h.obj)) continue;
      if (h.kind === "board") out.boards.push(h.obj);
      else if (h.kind === "task") { out.items.push(h.obj); out.notes.add(h.note); }
      else out.notes.add(h.obj);
    }
    for (const c of cats || []) if (apply(c)) out.cats.push(c);
    return out;
  }

  // "#weekend #camping lake" → { tags: ["weekend", "camping"], text: "lake" }.
  // How the search box asks for a tag.
  function parseQuery(q) {
    const tags = [];
    const text = String(q || "").replace(/(^|\s)#([^\s#]+)/g, (m, sp, t) => { const c = cleanOne(t); if (c) tags.push(c); return sp; }).replace(/\s+/g, " ").trim();
    return { tags, text };
  }

  // ---------- the tag field ----------
  // Pills with ×, then a box to type in. Enter, Tab or a comma adds what's
  // typed; Backspace in an empty box takes the last one off. Typing lists
  // the tags you've used that match, most used first. `get` and `set` read
  // and write the tags; `known` returns count()'s list. A pill's × and a
  // suggestion keep the box focused, so a phone's keyboard stays up.
  function field(root, { get, set, known, placeholder = "Add a tag", label = "Tags" }) {
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const ico = (n) => window.LifeLogIcons.svg(n);
    root.classList.add("tag-field");
    root.replaceChildren();
    const lead = el("span", "tag-field-ico");
    lead.appendChild(ico("tag"));
    lead.setAttribute("aria-hidden", "true");
    const pills = el("span", "tag-field-pills");
    const input = el("input", "tag-field-input");
    input.type = "text";
    input.autocomplete = "off";
    input.enterKeyHint = "done";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", label);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-autocomplete", "list");
    const menu = el("div", "tag-suggest");
    menu.setAttribute("role", "listbox");
    menu.id = "tagSuggest" + Math.random().toString(36).slice(2, 8);
    input.setAttribute("aria-controls", menu.id);
    menu.hidden = true;
    root.append(lead, pills, input, menu);
    // hi is the suggestion the arrow keys are on; -1 until they move, so
    // Enter adds what's typed rather than a longer tag that starts with it.
    let hi = -1, options = [];

    const keep = (ev) => ev.preventDefault(); // pointerdown: don't take focus from the box
    function draw() {
      root.classList.toggle("has-tags", get().length > 0);
      pills.replaceChildren();
      for (const t of get()) {
        const p = el("span", "tag-pill");
        p.appendChild(document.createTextNode(t));
        const x = el("button", "tag-pill-x");
        x.type = "button";
        x.setAttribute("aria-label", "Remove tag " + t);
        x.appendChild(ico("x"));
        x.addEventListener("pointerdown", keep);
        x.onclick = (ev) => { ev.stopPropagation(); set(get().filter((v) => key(v) !== key(t))); draw(); suggest(); };
        p.appendChild(x);
        pills.appendChild(p);
      }
    }
    function add(t) {
      const c = cleanOne(t);
      input.value = "";
      if (c && !has(get(), c)) {
        // A tag you've used before keeps the way it was written then.
        const was = (known() || []).find((k) => k.key === key(c));
        set(clean([...get(), was ? was.name : c]));
      }
      draw();
      suggest();
    }
    function suggest() {
      const q = key(cleanOne(input.value));
      const mine = new Set(get().map(key));
      const pool = (known() || []).filter((k) => !mine.has(k.key));
      const hits = q ? pool.filter((k) => k.key.includes(q)).sort((a, b) => (b.key.startsWith(q) - a.key.startsWith(q)) || b.total - a.total) : pool;
      options = hits.slice(0, 6).map((k) => ({ name: k.name, n: k.total }));
      if (q && !pool.some((k) => k.key === q) && !mine.has(q)) options.push({ name: cleanOne(input.value), add: true });
      hi = -1;
      const open = document.activeElement === input && options.length > 0;
      menu.hidden = !open;
      input.setAttribute("aria-expanded", String(open));
      menu.replaceChildren();
      options.forEach((o, i) => {
        const row = el("div", "tag-suggest-row");
        row.setAttribute("role", "option");
        row.id = menu.id + "-" + i;
        row.appendChild(el("span", null, o.add ? `Add “${o.name}”` : o.name));
        row.appendChild(el("span", "tag-suggest-n", o.add ? "new" : String(o.n)));
        row.addEventListener("pointerdown", keep);
        row.onclick = () => add(o.name);
        menu.appendChild(row);
      });
      mark();
    }
    function mark() {
      [...menu.children].forEach((r, i) => r.classList.toggle("is-hi", i === hi));
      if (hi >= 0 && !menu.hidden) input.setAttribute("aria-activedescendant", menu.id + "-" + hi);
      else input.removeAttribute("aria-activedescendant");
    }
    input.addEventListener("input", () => { if (/,/.test(input.value)) { input.value.split(",").slice(0, -1).forEach(add); input.value = input.value.split(",").pop(); } suggest(); });
    input.addEventListener("focus", suggest);
    input.addEventListener("blur", () => { if (cleanOne(input.value)) add(input.value); menu.hidden = true; input.setAttribute("aria-expanded", "false"); });
    input.addEventListener("keydown", (ev) => {
      const open = !menu.hidden && options.length;
      if (ev.key === "ArrowDown" && open) { ev.preventDefault(); hi = (hi + 1) % options.length; mark(); }
      else if (ev.key === "ArrowUp" && open) { ev.preventDefault(); hi = hi <= 0 ? options.length - 1 : hi - 1; mark(); }
      else if (ev.key === "Enter" || (ev.key === "Tab" && cleanOne(input.value))) {
        // Takes the highlighted suggestion, else what's typed. With nothing
        // typed, Enter is left to the sheet.
        const pick = open && hi >= 0 ? options[hi].name : input.value;
        if (!cleanOne(pick)) return;
        ev.preventDefault();
        ev.stopPropagation();
        add(pick);
      } else if (ev.key === "Escape" && open) { ev.preventDefault(); ev.stopPropagation(); menu.hidden = true; input.setAttribute("aria-expanded", "false"); }
      else if (ev.key === "Backspace" && !input.value && get().length) { set(get().slice(0, -1)); draw(); suggest(); }
    });
    // A tap on the field's empty space is a tap on its box.
    root.addEventListener("click", (ev) => { if (ev.target === root || ev.target === pills) input.focus(); });
    draw();
    return { refresh: () => { draw(); if (document.activeElement === input) suggest(); }, input };
  }

  // ---------- the Tags… sheet ----------
  // One thing's tags in a small sheet over whatever is open (#tagSheet).
  // `set` saves straight away; `done` runs when it closes.
  let open = null;
  function sheet({ title = "Tags", get, set, known, done }) {
    closeSheet();
    const $ = (s) => document.querySelector(s);
    const ov = $("#tagSheet");
    if (!ov.dataset.wired) {
      ov.dataset.wired = "1";
      $("#tagSheetDone").onclick = closeSheet;
      ov.addEventListener("click", (ev) => { if (ev.target === ov) closeSheet(); });
    }
    $("#tagSheetTitle").textContent = title;
    const f = field($("#tagSheetField"), { get, set, known });
    open = { f, done };
    ov.hidden = false;
    f.input.focus();
  }
  function closeSheet() {
    const ov = document.querySelector("#tagSheet");
    if (!open || !ov || ov.hidden) return false;
    const { f, done } = open;
    open = null;
    f.input.blur();
    ov.hidden = true;
    if (done) done();
    return true;
  }
  // "Tags…", or "Tags (3)…" when there are some.
  const itemLabel = (list) => (list && list.length ? `Tags (${list.length})…` : "Tags…");

  const api = { sheet, closeSheet, itemLabel, MAX_LEN, key, cleanOne, clean, setOn, has, hasAny, holders, count, summary, renamed, renameIn, parseQuery, field };
  if (typeof window !== "undefined") window.LifeLogTags = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
