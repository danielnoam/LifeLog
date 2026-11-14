// LifeLog — keyboard shortcuts: the one place that knows which key does what
// on a computer, and Settings → Keyboard, where each can be changed, turned
// off or put back.
//
// A key is a combo string: modifiers in the order Ctrl, Alt, Shift, then the
// physical key's e.code ("KeyF", "Ctrl+KeyE", "Shift+Slash"). By the physical
// key, not the character, because on a Hebrew layout F reports "כ" and
// Shift+/ reports "/" (see wire() in app.js). Cmd on a Mac counts as Ctrl.
//
// Only what differs from the defaults is kept, in data.settings.keys, so the
// browser and the desktop app agree and a default changed later still
// reaches anyone who never touched it:
//   { binds: { search: ["KeyF"], "tab:finance": [] }, otherMode: false, hints: false }
// Tabs default to their place in the bar (1 is the leftmost tab you have),
// so their default moves with the bar; a key you pick stays with the tab.
//
// The board tools ("board:pen") only work while a board is open, and the
// board has every key then, so they share keys with the rest of the app
// freely and only clash with each other and the board's fixed keys.
(function () {
  const ACTIONS = [
    { id: "add", label: "Add entry", defaults: ["KeyN"] },
    { id: "search", label: "Search", defaults: ["KeyF", "Slash"] },
    { id: "settings", label: "Open or close Settings", defaults: ["Tab"] },
    { id: "help", label: "Show keyboard shortcuts", defaults: ["Shift+Slash"] },
    { id: "noteMode", label: "Switch a note between Read and Edit", defaults: ["Ctrl+KeyE"], sub: "While a note is open" },
  ];
  const BOARD_ACTIONS = [
    { id: "board:select", label: "Select", defaults: ["KeyV"] },
    { id: "board:hand", label: "Move the board", defaults: ["KeyH"] },
    { id: "board:pen", label: "Pen", defaults: ["KeyP"] },
    { id: "board:eraser", label: "Eraser", defaults: ["KeyE"] },
    { id: "board:rect", label: "Rectangle", defaults: ["KeyR"] },
    { id: "board:ellipse", label: "Ellipse", defaults: ["KeyO"] },
    { id: "board:arrow", label: "Arrow", defaults: ["KeyA"] },
    { id: "board:line", label: "Line", defaults: ["KeyL"] },
    { id: "board:text", label: "Text", defaults: ["KeyT"] },
    { id: "board:image", label: "Add a picture", defaults: ["KeyI"] },
  ];
  // What a board does with these itself (handleKey in boards.js), ahead of
  // any tool; a tool can't take them.
  const BOARD_FIXED = {
    Escape: "Step out of a text box, then a selection, then the board",
    Space: "Hold to move the board", Delete: "Delete what's selected", Backspace: "Delete what's selected",
    Equal: "Zoom in", "Shift+Equal": "Zoom in", NumpadAdd: "Zoom in", Minus: "Zoom out", NumpadSubtract: "Zoom out",
    Digit0: "Fit the drawing on screen", "Ctrl+KeyZ": "Undo", "Ctrl+Shift+KeyZ": "Redo", "Ctrl+KeyY": "Redo",
    "Ctrl+KeyA": "Select everything", "Ctrl+KeyC": "Copy", "Ctrl+KeyX": "Cut", "Ctrl+KeyV": "Paste",
  };
  const MAX_KEYS = 2;
  const MAX_TABS = 9;
  const COMBO = /^(Ctrl\+)?(Alt\+)?(Shift\+)?[A-Z][A-Za-z0-9]*$/;
  const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS|AltGraph|CapsLock|Fn)(Left|Right)?$/;

  let source = () => null;
  let views = () => [];
  function bind(getSettings, getViews) {
    source = typeof getSettings === "function" ? getSettings : () => getSettings;
    if (typeof getViews === "function") views = getViews;
  }
  const settings = () => { try { return source() || null; } catch { return null; } };
  const stored = () => { const s = settings(); return (s && s.keys) || {}; };

  const isCombo = (c) => typeof c === "string" && COMBO.test(c);
  const isActionId = (id) => typeof id === "string" && (!!action(id) || /^tab:[a-z]+$/.test(id));
  const isBoard = (id) => id.startsWith("board:");
  const hasMod = (c) => /^(Ctrl|Alt)\+/.test(c);
  const hasShift = (c) => /(^|\+)Shift\+/.test(c);
  const withoutShift = (c) => c.replace("Shift+", "");

  const action = (id) => ACTIONS.find((a) => a.id === id) || BOARD_ACTIONS.find((a) => a.id === id);
  // A synced-in or hand-edited value, made safe: unknown actions and broken
  // combos dropped, at most two keys each, no repeats.
  function clean(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    if (raw.binds && typeof raw.binds === "object") {
      const binds = {};
      for (const [id, list] of Object.entries(raw.binds)) {
        if (!isActionId(id) || !Array.isArray(list)) continue;
        binds[id] = [...new Set(list.filter(isCombo))].slice(0, MAX_KEYS);
      }
      if (Object.keys(binds).length) out.binds = binds;
    }
    if (raw.otherMode === false) out.otherMode = false;
    if (raw.hints === false) out.hints = false;
    return out;
  }

  function defaults(id) {
    const a = action(id);
    if (a) return a.defaults.slice();
    if (id.startsWith("tab:")) {
      const i = views().indexOf(id.slice(4));
      return i >= 0 && i < MAX_TABS ? ["Digit" + (i + 1)] : [];
    }
    return [];
  }
  const overridden = (id) => Object.prototype.hasOwnProperty.call(stored().binds || {}, id);
  const keysFor = (id) => (overridden(id) ? stored().binds[id].slice() : defaults(id));
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const isDefault = (id) => !overridden(id) || sameList(stored().binds[id], defaults(id));
  const otherModeOn = () => stored().otherMode !== false;
  const hintsOn = () => stored().hints !== false;
  const tabIds = () => views().map((v) => "tab:" + v);
  const boardIds = () => BOARD_ACTIONS.map((a) => a.id);
  const allIds = () => [...ACTIONS.map((a) => a.id), ...tabIds(), ...boardIds()];
  function changedCount() {
    const k = stored();
    return allIds().filter((id) => !isDefault(id)).length + (k.otherMode === false ? 1 : 0) + (k.hints === false ? 1 : 0);
  }

  // Writes go straight into data.settings; the caller persists.
  function write(fn) {
    const s = settings();
    if (!s) return;
    const k = clean(s.keys);
    fn(k);
    if (k.binds) {
      for (const id of Object.keys(k.binds)) if (sameList(k.binds[id], defaults(id))) delete k.binds[id];
      if (!Object.keys(k.binds).length) delete k.binds;
    }
    if (Object.keys(k).length) s.keys = k; else delete s.keys;
  }
  const setKeys = (id, list) => write((k) => { (k.binds = k.binds || {})[id] = [...new Set(list.filter(isCombo))].slice(0, MAX_KEYS); });
  const reset = (id) => write((k) => { if (k.binds) delete k.binds[id]; });
  const resetAll = () => write((k) => { delete k.binds; delete k.otherMode; delete k.hints; });
  const setOtherMode = (on) => write((k) => { if (on) delete k.otherMode; else k.otherMode = false; });
  const setHints = (on) => write((k) => { if (on) delete k.hints; else k.hints = false; });
  const snapshot = () => { const s = settings(); return s && s.keys ? JSON.parse(JSON.stringify(s.keys)) : null; };
  const restore = (snap) => { const s = settings(); if (!s) return; if (snap) s.keys = clean(snap); else delete s.keys; };

  // Who else has this key: the actions that would lose it if it moved.
  // A board tool only competes with the other board tools.
  const holders = (combo, except) => allIds().filter((id) => id !== except && isBoard(id) === isBoard(except || "") && keysFor(id).includes(combo));
  // Gives `combo` to `id` (in place of `replacing`, or added) and takes it
  // from whoever had it. Returns the ids it was taken from.
  function assign(id, combo, replacing) {
    const taken = holders(combo, id);
    write((k) => {
      k.binds = k.binds || {};
      for (const other of taken) k.binds[other] = keysFor(other).filter((c) => c !== combo);
      let list = keysFor(id).filter((c) => c !== combo);
      const at = replacing ? list.indexOf(replacing) : -1;
      if (at >= 0) list[at] = combo; else list.push(combo);
      k.binds[id] = list.slice(0, MAX_KEYS);
    });
    return taken;
  }

  function comboFromEvent(e) {
    const code = e && e.code;
    if (!code || MODIFIER_CODES.test(code)) return null;
    return (e.ctrlKey || e.metaKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "") + code;
  }

  // Which action a key press asks for: { id, other } (other = Shift with a
  // tab's key, for its other mode), or null. Actions first, then tabs, so a
  // key you gave an action beats a tab's place-number default.
  function match(e) {
    const combo = comboFromEvent(e);
    if (!combo) return null;
    // A "?" typed, wherever the layout keeps it, is the shortcut list while
    // that key is still the default.
    if (e.key === "?" && isDefault("help")) return { id: "help", other: false, combo };
    for (const a of ACTIONS) if (keysFor(a.id).includes(combo)) return { id: a.id, other: false, combo };
    for (const id of tabIds()) if (keysFor(id).includes(combo)) return { id, other: false, combo };
    if (hasShift(combo) && otherModeOn()) {
      const bare = withoutShift(combo);
      for (const id of tabIds()) if (keysFor(id).includes(bare)) return { id, other: true, combo };
    }
    return null;
  }
  const is = (e, id) => { const m = match(e); return !!m && m.id === id; };
  // Which board tool a key press asks for ("pen"), or null.
  function matchBoard(e) {
    const combo = comboFromEvent(e);
    if (!combo) return null;
    const a = BOARD_ACTIONS.find((x) => keysFor(x.id).includes(combo));
    return a ? a.id.slice(6) : null;
  }
  const boardKeyLabel = (tool) => { const k = keysFor("board:" + tool)[0]; return k ? label(k) : ""; };

  // A key with Ctrl or Alt works anywhere; a plain one stands down while
  // you're typing, so a title starting with "n" stays a title.
  function isTextField(node) {
    if (!node) return false;
    if (node.isContentEditable || node.tagName === "TEXTAREA" || node.tagName === "SELECT") return true;
    return node.tagName === "INPUT" && !/^(checkbox|radio|range|button|submit|reset|color|file)$/i.test(node.type);
  }
  const blockedWhileTyping = (combo, node) => !hasMod(combo) && isTextField(node);

  const NAMES = {
    Slash: "/", Backslash: "\\", Comma: ",", Period: ".", Semicolon: ";", Quote: "'", Backquote: "`",
    BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Space: "Space", Enter: "Enter",
    Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End",
    PageUp: "Page Up", PageDown: "Page Down", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Escape: "Esc", ShiftLeft: "⇧", ShiftRight: "⇧", NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *", NumpadDivide: "Num /",
    NumpadDecimal: "Num .", NumpadEnter: "Num Enter", IntlBackslash: "\\", ContextMenu: "Menu",
  };
  function keyName(code) {
    if (NAMES[code]) return NAMES[code];
    let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
    m = /^Digit(\d)$/.exec(code); if (m) return m[1];
    m = /^Numpad(\d)$/.exec(code); if (m) return "Num " + m[1];
    return code;
  }
  // The keys to draw, one per keycap: ["Ctrl", "E"]. Shift+/ is "?", as
  // it's printed on the key.
  function parts(combo) {
    if (combo === "Shift+Slash") return ["?"];
    const bits = combo.split("+");
    const code = bits.pop();
    return [...bits, keyName(code)];
  }
  const label = (combo) => parts(combo).join(" + ");

  const onComputer = () => {
    const P = typeof window !== "undefined" && window.LifeLogPlatform;
    if (P && P.desktop) return true;
    try { return window.matchMedia("(hover: hover) and (pointer: fine)").matches; } catch { return false; }
  };

  // ---------- Settings → Keyboard ----------
  let ui = null;
  let listening = null; // { id, replacing }

  function initUI(deps) {
    ui = deps;
    const { $ } = ui;
    $("#kbOtherMode").onchange = () => { setOtherMode($("#kbOtherMode").checked); changed(); };
    $("#kbHints").onchange = () => { setHints($("#kbHints").checked); changed(); };
    $("#kbResetAll").onclick = () => {
      const snap = snapshot();
      resetAll();
      changed();
      ui.toast("Every key is back to its default", false, { label: "Undo", onClick: () => { restore(snap); changed(); } });
    };
    // Ahead of every other key handler while waiting for a key, so the
    // key pressed is the key kept rather than a shortcut fired.
    window.addEventListener("keydown", onCaptureKey, true);
    document.addEventListener("pointerdown", (e) => { if (listening && !e.target.closest(".kb-key.listening")) stopListening(); }, true);
  }

  function changed() {
    renderPage();
    if (ui && ui.onChange) ui.onChange();
    if (ui) ui.persist();
  }

  function stopListening() {
    if (!listening) return;
    listening = null;
    renderPage();
  }

  function onCaptureKey(e) {
    if (!listening) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === "Escape") { stopListening(); return; }
    const combo = comboFromEvent(e);
    if (!combo) return;
    const { id, replacing } = listening;
    if (isBoard(id) && BOARD_FIXED[combo]) {
      ui.toast(label(combo) + " is a fixed key on boards (" + BOARD_FIXED[combo].toLowerCase() + ")", true);
      return;
    }
    if (id.startsWith("tab:") && hasShift(combo) && otherModeOn()) {
      ui.toast("Pick a key without Shift — Shift with a tab's key opens its other mode", true);
      return;
    }
    listening = null;
    if (keysFor(id).includes(combo) && combo !== replacing) { renderPage(); return; }
    const snap = snapshot();
    const taken = assign(id, combo, replacing);
    changed();
    if (taken.length) {
      ui.toast(label(combo) + " moved from " + taken.map(nameOf).join(", "), false, { label: "Undo", onClick: () => { restore(snap); changed(); } });
    }
    focusRow(id);
  }

  function nameOf(id) {
    const a = action(id);
    if (a) return a.label;
    const t = (ui && ui.tabs ? ui.tabs() : []).find((x) => "tab:" + x.view === id);
    return t ? t.name : id.slice(4);
  }

  function focusRow(id) {
    const row = document.querySelector('#settingsModal [data-kb="' + id + '"]');
    const b = row && (row.querySelector(".kb-key, .kb-add"));
    if (b) b.focus({ preventScroll: true });
  }

  const icon = (name, fallback) => (window.LifeLogIcons ? window.LifeLogIcons.svg(name) : document.createTextNode(fallback));

  function keyChip(id, combo) {
    const { el } = ui;
    const name = nameOf(id);
    const chip = el("span", "kb-chip");
    if (listening && listening.id === id && listening.replacing === combo) {
      const b = el("button", "kb-key listening", "Press a key…");
      b.type = "button";
      b.setAttribute("aria-label", "Press the new key for " + name + ", or Esc to cancel");
      b.onclick = stopListening;
      chip.appendChild(b);
      return chip;
    }
    const b = el("button", "kb-key");
    b.type = "button";
    b.textContent = label(combo);
    b.setAttribute("aria-label", "Change " + label(combo) + " for " + name);
    b.onclick = () => startListening(id, combo);
    const x = el("button", "kb-x");
    x.type = "button";
    x.appendChild(icon("x", "×"));
    x.setAttribute("aria-label", "Remove " + label(combo) + " from " + name);
    x.title = "Remove";
    x.onclick = () => {
      const snap = snapshot();
      setKeys(id, keysFor(id).filter((c) => c !== combo));
      changed();
      ui.toast(label(combo) + " removed from " + name, false, { label: "Undo", onClick: () => { restore(snap); changed(); } });
      focusRow(id);
    };
    chip.append(b, x);
    return chip;
  }

  function startListening(id, replacing) {
    listening = { id, replacing: replacing || null };
    renderPage();
    const b = document.querySelector("#settingsModal .kb-key.listening");
    if (b) b.focus({ preventScroll: true });
  }

  function row(id, title, sub) {
    const { el } = ui;
    const r = el("div", "sitem kb-row");
    r.dataset.kb = id;
    if (!isDefault(id)) r.classList.add("kb-changed");
    const text = el("span", "sitem-text");
    text.appendChild(el("span", "sitem-title", title));
    text.appendChild(el("span", "sitem-sub", sub || ""));
    const keys = el("span", "kb-keys");
    const list = keysFor(id);
    if (!list.length && !(listening && listening.id === id)) keys.appendChild(el("span", "kb-none", "None"));
    for (const c of list) keys.appendChild(keyChip(id, c));
    if (listening && listening.id === id && !listening.replacing) keys.appendChild(keyChip(id, null));
    else if (list.length < MAX_KEYS) {
      const add = el("button", "kb-add", "+");
      add.type = "button";
      add.title = list.length ? "Add another key" : "Add a key";
      add.setAttribute("aria-label", (list.length ? "Add another key for " : "Add a key for ") + title);
      add.onclick = () => startListening(id, null);
      keys.appendChild(add);
    }
    if (!isDefault(id)) {
      const rs = el("button", "kb-reset");
      rs.type = "button";
      rs.appendChild(icon("rotate-ccw", "↺"));
      rs.title = "Back to " + (defaults(id).map(label).join(", ") || "none");
      rs.setAttribute("aria-label", "Put " + title + " back to " + (defaults(id).map(label).join(" and ") || "no key"));
      rs.onclick = () => { reset(id); changed(); focusRow(id); };
      keys.appendChild(rs);
    }
    r.append(text, keys);
    return r;
  }

  function renderPage() {
    if (!ui) return;
    const { $ } = ui;
    const anywhere = $("#kbActions");
    const tabs = $("#kbTabs");
    if (!anywhere || !tabs) return;
    anywhere.replaceChildren(...ACTIONS.map((a) => row(a.id, a.label, a.sub)));
    const tabRows = (ui.tabs ? ui.tabs() : []).map((t) => row("tab:" + t.view, t.name, t.sub));
    tabs.replaceChildren(...tabRows);
    const boards = $("#kbBoards");
    if (boards) boards.replaceChildren(...BOARD_ACTIONS.map((a) => row(a.id, a.label, a.sub)));
    $("#kbOtherMode").checked = otherModeOn();
    $("#kbHints").checked = hintsOn();
    $("#kbZoomRow").hidden = !(window.LifeLogPlatform && window.LifeLogPlatform.desktop);
    $("#kbResetAll").disabled = !changedCount();
  }

  const api = {
    ACTIONS, BOARD_ACTIONS, BOARD_FIXED, MAX_KEYS, matchBoard, boardKeyLabel, bind, clean, defaults, keysFor, isDefault, changedCount,
    otherModeOn, hintsOn, setKeys, reset, resetAll, setOtherMode, setHints, assign, holders,
    comboFromEvent, match, is, hasMod, blockedWhileTyping, isTextField, parts, label, onComputer,
    initUI, renderPage, isListening: () => !!listening,
  };
  if (typeof window !== "undefined") window.LifeLogKeys = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
