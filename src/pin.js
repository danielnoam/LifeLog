// LifeLog — the pinned window (Nov 2026), on a computer only (the Windows
// and Linux app). Pin on top turns the window itself small and always on
// top, showing Today, Coming up, Notes and the Scratchpad with a quick-add
// line under them; Unpin puts it back as it was. It's the same window and
// the same page, not a second one, so there's never a second copy of the
// data syncing against the first (main.rs's single-instance rule).
//
// What's in the tabs is Home's own sections (home.js buildPanel), so the
// pinned window never shows something Home would show differently. The
// quick add goes through the widgets' queue (widgets.js applyQueue), the
// path the phone's quick-add window takes, so an item made here is made
// exactly as one made there.
(function () {
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  const PREFS_KEY = "lifelog-pin-v1";
  const TABS = [
    ["today", () => i18n.t("Today"), "sun"],
    ["upcoming", () => i18n.t("Coming up"), "calendar"],
    ["notes", () => i18n.t("Notes"), "notebook-text"],
    ["scratchpad", () => i18n.t("Scratchpad"), "notebook-pen"],
  ];
  const KINDS = [
    ["task", () => i18n.t("Task")],
    ["note", () => i18n.t("Note")],
    ["entry", () => i18n.t("Entry")],
    ["expense", () => i18n.t("Expense")],
  ];
  let ctx = null, root = null, body = null, tabsEl = null, kindsEl = null, input = null, listPick = null;
  let on = false;

  // ---------- pure (test/pin.test.js) ----------
  // What a quick-add line becomes on the widgets' queue, or null when
  // there's nothing to add. An expense is its first number, the rest its
  // note ("12.50 coffee", "coffee 12.50"); a task goes to `list`, or to a
  // new "Inbox" list when there's none.
  function quickItem(kind, text, { today, now, id, listId = "", lists = [] } = {}) {
    const t = String(text || "").trim();
    if (!t) return null;
    const at = now || new Date().toISOString();
    if (kind === "expense") {
      const m = /(^|\s)(\d+(?:[.,]\d{1,2})?)(?=\s|$)/.exec(t);
      if (!m) return null;
      const note = (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
      return [{ kind: "expense", id, at, date: today, amount: m[2].replace(",", "."), note }];
    }
    if (kind === "entry") return [{ kind: "entry", id, at, date: today, title: t }];
    if (kind === "note") {
      const [first, ...rest] = t.split(/\n/);
      return rest.length ? [{ kind: "note", id, at, title: first.trim(), text: rest.join("\n").trim() }] : [{ kind: "note", id, at, text: t }];
    }
    if (kind === "task") {
      if (lists.some((l) => l.id === listId)) return [{ kind: "item", id, at, list: listId, text: t }];
      const inbox = id + "l";
      return [{ kind: "list", id: inbox, at, text: i18n.t("Inbox") }, { kind: "item", id, at, list: inbox, text: t }];
    }
    return null;
  }

  // ---------- this device's choices ----------
  function prefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { p = {}; }
    return {
      on: p.on === true,
      tab: TABS.some(([id]) => id === p.tab) ? p.tab : "today",
      kind: KINDS.some(([id]) => id === p.kind) ? p.kind : "task",
      list: typeof p.list === "string" ? p.list : "",
    };
  }
  function setPref(key, value) {
    const p = prefs();
    p[key] = value;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* this session only */ }
  }

  const desktop = () => !!(window.LifeLogDesktop && window.LifeLogDesktop.available());
  const invoke = (cmd, args) => {
    const P = window.LifeLogPlatform, c = P && P.tauri && P.tauri.core;
    return c ? c.invoke(cmd, args) : Promise.reject(new Error("no Tauri core"));
  };

  // ---------- the view ----------
  function build() {
    const { el, ico } = ctx;
    root = el("div", "pin-view");
    root.id = "pinView";
    root.hidden = true;
    const head = root.appendChild(el("div", "pin-head"));
    tabsEl = head.appendChild(el("div", "seg pin-tabs"));
    tabsEl.setAttribute("role", "tablist");
    for (const [id, label, icon] of TABS) {
      const b = tabsEl.appendChild(el("button", "seg-btn pin-tab"));
      b.type = "button";
      b.dataset.tab = id;
      b.setAttribute("role", "tab");
      b.title = label();
      b.appendChild(ico(icon));
      b.appendChild(el("span", "pin-tab-label", label()));
      b.onclick = () => { setPref("tab", id); fill(); };
    }
    const off = head.appendChild(el("button", "btn btn-icon pin-off"));
    off.type = "button";
    off.title = i18n.t("Unpin");
    off.setAttribute("aria-label", i18n.t("Unpin"));
    off.appendChild(ico("pin-off"));
    off.onclick = () => set(false);
    body = root.appendChild(el("div", "pin-body"));
    body.setAttribute("role", "tabpanel");

    const form = root.appendChild(el("form", "pin-add"));
    kindsEl = form.appendChild(el("div", "pin-kinds"));
    for (const [id, label] of KINDS) {
      const b = kindsEl.appendChild(el("button", "cat-chip pin-kind"));
      b.type = "button";
      b.dataset.kind = id;
      b.textContent = label();
      b.onclick = () => { setPref("kind", id); syncAdd(); input.focus(); };
    }
    listPick = kindsEl.appendChild(el("select", "pin-list"));
    listPick.setAttribute("aria-label", i18n.t("Tasks list"));
    listPick.onchange = () => setPref("list", listPick.value);
    const row = form.appendChild(el("div", "pin-add-row"));
    input = row.appendChild(el("input", "pin-input"));
    input.type = "text";
    input.autocomplete = "off";
    const go = row.appendChild(el("button", "btn btn-primary btn-icon pin-go"));
    go.type = "submit";
    go.setAttribute("aria-label", i18n.t("Add"));
    go.title = i18n.t("Add");
    go.appendChild(ico("plus"));
    form.onsubmit = (e) => { e.preventDefault(); add(); };
    document.body.appendChild(root);
  }

  const PLACEHOLDER = {
    task: () => i18n.t("Add a task"),
    note: () => i18n.t("Write a note"),
    entry: () => i18n.t("What did you finish today?"),
    expense: () => i18n.t("12.50 coffee"),
  };
  const openLists = () => (ctx.state.data.notes || []).filter((n) => n.kind === "list" && !n.template && !n.done);
  function syncAdd() {
    const p = prefs();
    for (const b of kindsEl.querySelectorAll(".pin-kind")) {
      const hide = (b.dataset.kind === "entry" && !ctx.viewEnabled("timeline")) || (b.dataset.kind === "expense" && !ctx.viewEnabled("finance"));
      b.hidden = hide;
      b.classList.toggle("on", b.dataset.kind === p.kind);
      b.setAttribute("aria-pressed", String(b.dataset.kind === p.kind));
    }
    input.placeholder = PLACEHOLDER[p.kind]();
    input.inputMode = p.kind === "expense" ? "decimal" : "text";
    const lists = openLists();
    listPick.hidden = p.kind !== "task" || !lists.length;
    listPick.textContent = "";
    for (const l of lists) {
      const o = listPick.appendChild(document.createElement("option"));
      o.value = l.id;
      o.textContent = l.text || i18n.t("Untitled list");
    }
    if (lists.length) listPick.value = lists.some((l) => l.id === p.list) ? p.list : lists[0].id;
  }

  async function add() {
    const p = prefs();
    const lists = openLists();
    const items = quickItem(p.kind, input.value, { today: ctx.todayStr(), id: ctx.uid(), listId: listPick.value || p.list, lists });
    if (!items) {
      ctx.toast(p.kind === "expense" ? i18n.t("Write the amount, like 12.50 coffee") : i18n.t("Write something first"), true);
      return;
    }
    const W = window.LifeLogWidgets;
    if (!W || !W.applyQueue(ctx.state.data, items)) return;
    input.value = "";
    ctx.afterDataChange();
    await ctx.persist();
    ctx.toast(({ task: i18n.t("Task added"), note: i18n.t("Note added"), entry: i18n.t("Entry added"), expense: i18n.t("Expense added") })[p.kind]);
  }

  function notesPanel() {
    const { el } = ctx;
    const H = window.LifeLogHome, N = window.LifeLogNotes;
    const sec = el("section", "home-sec pin-notes");
    let notes = H.pinnedNotes(ctx.state.data);
    // Nothing pinned to Home: the latest notes instead, so the tab is never empty for long.
    if (!notes.length) {
      notes = (ctx.state.data.notes || []).filter((n) => !n.template)
        .sort((a, b) => String(b.editedAt || b.createdAt || "").localeCompare(String(a.editedAt || a.createdAt || ""))).slice(0, 8);
    }
    if (!notes.length) { sec.appendChild(el("p", "home-empty", i18n.t("No notes yet"))); return sec; }
    const grid = sec.appendChild(el("div", "home-pins"));
    for (const n of notes) grid.appendChild(N.pinnedCard(n));
    return sec;
  }

  function fill() {
    if (!root || !on) return;
    const p = prefs();
    for (const b of tabsEl.querySelectorAll(".pin-tab")) {
      b.classList.toggle("active", b.dataset.tab === p.tab);
      b.setAttribute("aria-selected", String(b.dataset.tab === p.tab));
    }
    // The scratchpad's field outlives a render; keep the caret where it was.
    const a = document.activeElement;
    const keep = a && body.contains(a) && (a.tagName === "TEXTAREA" || a.tagName === "INPUT") ? { a, s: a.selectionStart, e: a.selectionEnd } : null;
    const top = body.scrollTop;
    body.textContent = "";
    const sec = p.tab === "notes" ? notesPanel() : window.LifeLogHome.buildPanel(p.tab);
    if (sec) {
      const head = sec.querySelector(".home-sec-head");
      if (head) head.remove();
      body.appendChild(sec);
    }
    body.scrollTop = top;
    if (keep && keep.a.isConnected) {
      keep.a.focus();
      try { keep.a.setSelectionRange(keep.s, keep.e); } catch (e) { /* not a text field */ }
    }
    syncAdd();
  }

  // ---------- pinning ----------
  async function set(next) {
    next = !!next && desktop();
    if (next === on) { if (on) fill(); return; }
    on = next;
    setPref("on", on);
    if (!root) build();
    root.hidden = !on;
    document.body.classList.toggle("is-pinned", on);
    syncButton();
    try { await invoke("pin_window", { on }); } catch (e) { /* an app older than this: the page still switches */ }
    // Unpinned: the page as it was, drawn for the window's full size again.
    if (on) fill(); else ctx.render();
  }
  const isOn = () => on;
  const toggle = () => set(!on);

  function syncButton() {
    const b = document.getElementById("pinBtn");
    if (!b) return;
    b.hidden = !desktop();
    const label = on ? i18n.t("Unpin") : i18n.t("Pin on top");
    b.title = label;
    b.setAttribute("aria-label", label);
  }

  // ctx: { state, el, ico, toast, uid, todayStr, persist, afterDataChange, render, viewEnabled }
  function init(c) {
    ctx = c;
    const b = document.getElementById("pinBtn");
    if (b) b.onclick = toggle;
    syncButton();
  }
  // Pinned when the app was last closed: pinned again, once the data is in.
  function restore() {
    syncButton();
    if (desktop() && prefs().on) set(true);
  }

  const api = { init, restore, set, toggle, isOn, refresh: fill, quickItem, prefs, PREFS_KEY, TABS, KINDS };
  if (typeof window !== "undefined") window.LifeLogPin = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
