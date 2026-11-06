// LifeLog — the app's own dropdown list for every <select>.
//
// The <select> stays in the page and stays the source of truth: its value,
// its options, its change handler and its closed look are all untouched.
// Only the list that opens is ours, so no caller had to change and a select
// built later (sort, bulk move, import rows) is covered the moment it exists.
// The press that would open the browser's list is caught on the document and
// our list opens instead: a menu under the field on a computer, a sheet from
// the bottom on a phone. Picking sets the value and fires input + change,
// the same events the browser's list fires.
(function () {
  const OPENERS = new Set([" ", "Enter", "F4"]);
  let open = null;   // { sel, root, list, items, active, sheet }
  let touch = null;  // the touch that started on a select, to tell a tap from a scroll
  let typed = "", typedAt = 0;

  const ours = (t) => t instanceof HTMLSelectElement && !t.multiple && t.size <= 1 && !t.disabled;
  const html = () => document.documentElement.classList;

  function asSheet() {
    if (html().contains("force-mobile")) return true;
    if (html().contains("force-pc")) return false;
    return matchMedia("(max-width: 720px), (pointer: coarse)").matches;
  }

  // The field's name for the sheet's heading: its aria-label, else the text
  // of the <label> around or pointing at it, without the select's own text.
  function titleOf(sel) {
    const own = sel.getAttribute("aria-label") || sel.title;
    if (own) return own;
    const lab = sel.closest("label") || (sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`));
    if (!lab) return "";
    let s = "";
    lab.childNodes.forEach((n) => { if (n.nodeType === 3) s += n.textContent; else if (n !== sel && !n.contains(sel) && n.tagName !== "SELECT") s += n.textContent; });
    return s.replace(/\s+/g, " ").trim();
  }

  function build(sel) {
    const sheet = asSheet();
    const root = document.createElement("div");
    root.className = sheet ? "dd-scrim" : "dd-layer";
    const box = document.createElement("div");
    box.className = sheet ? "dd-sheet" : "menu-pop dd-pop";
    const list = document.createElement("div");
    list.className = "dd-list";
    list.setAttribute("role", "listbox");
    list.tabIndex = -1;
    const title = titleOf(sel);
    if (title) list.setAttribute("aria-label", title);
    if (sheet && title) {
      const h = document.createElement("div");
      h.className = "dd-title";
      h.textContent = title;
      box.appendChild(h);
    }
    const items = [];
    const add = (o, inGroup) => {
      if (o.hidden) return;
      const b = document.createElement("div");
      b.className = "dd-opt" + (inGroup ? " is-grouped" : "");
      b.id = "dd-opt-" + items.length;
      b.setAttribute("role", "option");
      const on = o.index === sel.selectedIndex;
      b.setAttribute("aria-selected", on ? "true" : "false");
      if (o.disabled || (o.parentNode.tagName === "OPTGROUP" && o.parentNode.disabled)) b.setAttribute("aria-disabled", "true");
      const tick = document.createElement("span");
      tick.className = "dd-tick";
      if (on) tick.appendChild(LifeLogIcons.svg("check"));
      const txt = document.createElement("span");
      txt.className = "dd-text";
      txt.textContent = o.label || o.textContent;
      b.append(tick, txt);
      b.__opt = o;
      items.push(b);
      list.appendChild(b);
    };
    for (const n of sel.children) {
      if (n.tagName === "OPTGROUP") {
        const h = document.createElement("div");
        h.className = "dd-group";
        h.setAttribute("role", "presentation");
        h.textContent = n.label;
        list.appendChild(h);
        for (const o of n.children) if (o.tagName === "OPTION") add(o, true);
      } else if (n.tagName === "OPTION") add(n, false);
    }
    box.appendChild(list);
    root.appendChild(box);
    return { sel, root, box, list, items, sheet, active: -1 };
  }

  function place(o) {
    const r = o.sel.getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight, gap = 4, edge = 8;
    const box = o.box;
    box.style.minWidth = Math.max(r.width, 160) + "px";
    box.style.maxWidth = Math.min(420, vw - edge * 2) + "px";
    const below = vh - r.bottom - gap - edge, above = r.top - gap - edge;
    const want = Math.min(o.list.scrollHeight + 14, 360);
    const up = below < Math.min(want, 200) && above > below;
    box.style.maxHeight = Math.max(120, Math.min(360, up ? above : below)) + "px";
    const w = box.offsetWidth;
    box.style.left = Math.max(edge, Math.min(r.left, vw - w - edge)) + "px";
    if (up) { box.style.top = ""; box.style.bottom = (vh - r.top + gap) + "px"; box.classList.add("is-up"); }
    else { box.style.bottom = ""; box.style.top = (r.bottom + gap) + "px"; }
  }

  function setActive(i, scroll) {
    if (!open) return;
    const its = open.items;
    if (open.active >= 0 && its[open.active]) its[open.active].classList.remove("is-active");
    open.active = i;
    if (i < 0 || !its[i]) { open.list.removeAttribute("aria-activedescendant"); return; }
    its[i].classList.add("is-active");
    open.list.setAttribute("aria-activedescendant", its[i].id);
    if (scroll) its[i].scrollIntoView({ block: "nearest" });
  }

  function step(from, dir) {
    const its = open.items;
    for (let i = from + dir; i >= 0 && i < its.length; i += dir) if (!its[i].hasAttribute("aria-disabled")) return i;
    return from;
  }

  function openFor(sel) {
    if (open && open.sel === sel) return close(true);
    close(false);
    const o = build(sel);
    open = o;
    sel.setAttribute("aria-expanded", "true");
    document.body.appendChild(o.root);
    if (!o.sheet) place(o);
    const cur = o.items.findIndex((b) => b.getAttribute("aria-selected") === "true");
    setActive(cur >= 0 ? cur : step(-1, 1), false);
    if (cur >= 0) {
      const b = o.items[cur], l = o.list;
      l.scrollTop = Math.max(0, b.offsetTop - (l.clientHeight - b.offsetHeight) / 2);
    }
    o.list.focus({ preventScroll: true });
    o.list.addEventListener("keydown", onListKey);
    o.list.addEventListener("click", onListClick);
    o.list.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const b = e.target.closest(".dd-opt");
      if (b && !b.hasAttribute("aria-disabled")) setActive(o.items.indexOf(b), false);
    });
    if (o.sheet) o.root.addEventListener("click", (e) => { if (e.target === o.root) close(true); });
  }

  function close(refocus) {
    if (!open) return;
    const o = open;
    open = null;
    o.sel.setAttribute("aria-expanded", "false");
    o.root.remove();
    if (refocus) o.sel.focus({ preventScroll: true });
  }

  function choose(i) {
    const o = open;
    const b = o && o.items[i];
    if (!b || b.hasAttribute("aria-disabled")) return;
    const sel = o.sel, opt = b.__opt;
    close(true);
    if (opt.index === sel.selectedIndex) return;
    sel.selectedIndex = opt.index;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function onListClick(e) {
    const b = e.target.closest(".dd-opt");
    if (b) choose(open.items.indexOf(b));
  }

  function onListKey(e) {
    if (!open) return;
    const k = e.key, a = open.active, n = open.items.length;
    let handled = true;
    if (k === "ArrowDown") setActive(e.altKey ? a : step(a, 1), true);
    else if (k === "ArrowUp") { if (e.altKey) choose(a); else setActive(step(a, -1), true); }
    else if (k === "Home") setActive(step(-1, 1), true);
    else if (k === "End") setActive(step(n, -1), true);
    else if (k === "PageDown") { let i = a; for (let j = 0; j < 8; j++) i = step(i, 1); setActive(i, true); }
    else if (k === "PageUp") { let i = a; for (let j = 0; j < 8; j++) i = step(i, -1); setActive(i, true); }
    else if (k === "Enter" || (k === " " && !typed) || k === "Tab") choose(a);
    else if (k === "Escape") close(true);
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed = (now - typedAt > 700 ? "" : typed) + k.toLowerCase();
      typedAt = now;
      const from = typed.length === 1 ? a + 1 : a;
      for (let j = 0; j < n; j++) {
        const i = (from + j) % n, b = open.items[i];
        if (!b.hasAttribute("aria-disabled") && b.textContent.trim().toLowerCase().startsWith(typed)) { setActive(i, true); break; }
      }
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  // ----- catching the press that would open the browser's list -----
  document.addEventListener("mousedown", (e) => {
    if (open && !open.root.contains(e.target) && e.target !== open.sel) close(false);
    if (e.button !== 0 || !ours(e.target)) return;
    e.preventDefault();
    e.target.focus({ preventScroll: true });
    openFor(e.target);
  }, true);

  document.addEventListener("touchstart", (e) => {
    if (open && open.sheet === false && !open.root.contains(e.target)) close(false);
    const t = e.target;
    touch = ours(t) && e.touches.length === 1 ? { sel: t, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { capture: true, passive: true });

  // On touchend, not touchstart: a finger that lands on a field and drags is
  // scrolling the page. Cancelling the end stops the tap's click and focus,
  // which is what opens the phone's own picker (Android and iOS alike).
  document.addEventListener("touchend", (e) => {
    const t = touch;
    touch = null;
    if (!t || !e.cancelable || e.changedTouches.length !== 1) return;
    const p = e.changedTouches[0];
    if (Math.abs(p.clientX - t.x) > 10 || Math.abs(p.clientY - t.y) > 10) return;
    e.preventDefault();
    openFor(t.sel);
  }, { capture: true, passive: false });

  document.addEventListener("keydown", (e) => {
    if (!ours(e.target) || open) return;
    if (OPENERS.has(e.key) || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp"))) {
      e.preventDefault();
      e.stopPropagation();
      openFor(e.target);
    }
  }, true);

  // A press on a <label> wrapping a select only focuses it; the browser
  // wouldn't open its list there either, so neither does this.
  const shut = () => close(false);
  addEventListener("resize", shut);
  addEventListener("blur", shut);
  document.addEventListener("scroll", (e) => { if (open && !open.sheet && !open.box.contains(e.target)) shut(); }, true);

  // Callers that open a select themselves (a select swapped in on click)
  // get ours too.
  const native = HTMLSelectElement.prototype.showPicker;
  HTMLSelectElement.prototype.showPicker = function () {
    if (ours(this) && this.isConnected) return openFor(this);
    if (native) return native.call(this);
  };

  window.LifeLogSelect = { open: openFor, close: () => close(true), isOpen: () => !!open };
})();
