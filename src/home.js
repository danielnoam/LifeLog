// LifeLog — the Home tab: one page of what's going on now. What you're in the
// middle of, what's coming in the next two weeks (releases, new episodes,
// charges, habits still to do), a scratchpad, and the notes you pinned here.
//
// The sections are this device's to order and hide (state.visual.homeSections
// and homeHidden), like the tabs themselves. The scratchpad is synced, as
// settings.scratchpad: it is one string, and two devices editing it at once
// resolve as any setting does, the newer save winning. A pinned note is a
// note with `pinned: true`; it stays in the Notebook too.
(function () {
  const Dates = () => window.LifeLogDates || require("./dates.js");
  const ico = (n, c) => window.LifeLogIcons.svg(n, c);

  // [id, label, icon, half]. Half sections next to each other in your order
  // share a row on a wide screen (two or three across).
  const SECTIONS = [
    ["progress", "In progress", "play", false],
    ["upcoming", "Coming up", "calendar", true],
    ["scratchpad", "Scratchpad", "notebook-pen", true],
    ["pinned", "Pinned notes", "pin", true],
  ];
  const SECTION_IDS = SECTIONS.map(([id]) => id);
  const DAYS_AHEAD = 14;

  // ---------- pure (test/home.test.js, and the bridge's lifelog_home) ----------
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const addDays = (day, n) => {
    const d = new Date(day + "T00:00:00");
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // The order a device keeps, cleaned: ids it doesn't know go, and a section
  // added since goes on the end.
  function sectionOrder(saved) {
    const known = [...new Set((Array.isArray(saved) ? saved : []).filter((id) => SECTION_IDS.includes(id)))];
    return known.concat(SECTION_IDS.filter((id) => !known.includes(id)));
  }

  function inProgress(data) {
    return (data.backlog || []).filter((b) => !b.dropped && isDate(b.startedAt))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || String(a.title).localeCompare(String(b.title)));
  }

  // Everything dated from today to `days` ahead, soonest first. Only what is
  // known to the day: a release "sometime in November" is the Upcoming
  // page's to list, and here it would read as due today.
  //   { kind: "release" | "episode" | "charge" | "habit", day, title, ... }
  function comingUp(data, today, { Backlog, Finance, Habits, days = DAYS_AHEAD } = {}) {
    const until = addDays(today, days);
    const rows = [];
    if (Backlog) {
      for (const b of data.backlog || []) {
        if (b.dropped) continue;
        const episode = isDate(b.nextAt) && b.nextAt >= today;
        const day = episode ? b.nextAt
          : (b.releasePrecision || "day") === "day" && isDate(String(b.releaseDate || "").slice(0, 10)) ? String(b.releaseDate).slice(0, 10) : "";
        if (!day || day < today || day > until) continue;
        // Out today still counts: it's the day you were waiting for.
        if (!episode && day > today && !Backlog.isAwaitingRelease(b)) continue;
        rows.push({ kind: episode ? "episode" : "release", day, title: b.title, category: b.category, label: episode ? b.nextLabel || "" : "", id: b.id, starred: !!b.priority });
      }
    }
    if (Finance) {
      const all = data.recurringExpenses || [];
      const end = new Date(until + "T00:00:00");
      for (const rec of all) {
        for (const o of Finance.planCharges(rec, end)) {
          if (o.skipped || o.paused || !isDate(o.date) || o.date < today || o.date > until) continue;
          rows.push({
            kind: "charge", day: o.date, id: rec.id, amount: +o.amount || 0,
            title: o.note || rec.note || o.subcategory || o.category || rec.category || "Recurring expense",
            category: o.category || rec.category || "",
          });
        }
      }
    }
    if (Habits) {
      const live = (data.habits || []).slice().sort((x, y) => (x.order || 0) - (y.order || 0));
      for (const g of Habits.leftToDo(live, today).groups) {
        if (g.period === "day") {
          rows.push({ kind: "habit", day: today, period: "day", title: g.items.map((it) => it.habit.name).join(", "), count: g.items.length, ids: g.items.map((it) => it.habit.id) });
        } else {
          for (const it of g.items) rows.push({ kind: "habit", day: addDays(today, g.daysLeft), period: g.period, title: it.habit.name, done: it.done, target: it.target, minutes: Habits.isMinutes(it.habit), ids: [it.habit.id] });
        }
      }
    }
    const order = { habit: 0, release: 1, episode: 2, charge: 3 };
    return rows.sort((a, b) => a.day.localeCompare(b.day) || order[a.kind] - order[b.kind] || String(a.title).localeCompare(String(b.title)));
  }

  // Which heading a day goes under.
  function bucketOf(day, today) {
    if (day === today) return "Today";
    if (day === addDays(today, 1)) return "Tomorrow";
    return day <= addDays(today, 6) ? "This week" : "Later";
  }

  const pinnedNotes = (data) => (data.notes || []).filter((n) => n.pinned)
    .sort((a, b) => String(b.editedAt || b.createdAt || "").localeCompare(String(a.editedAt || a.createdAt || "")));

  // ---------- the view ----------
  let state, $, el, toast, persist, render, saveVisualSettings, switchToView, modeEnabled, viewEnabled, todayStr;
  function init(ctx) {
    ({ state, $, el, toast, persist, render, saveVisualSettings, switchToView, modeEnabled, viewEnabled, todayStr } = ctx);
  }

  const visibleSections = () => {
    const off = state.visual.homeHidden || [];
    return sectionOrder(state.visual.homeSections).filter((id) => !off.includes(id));
  };

  function sectionHead(id, more) {
    const [, label, icon] = SECTIONS.find(([s]) => s === id);
    const head = el("div", "home-sec-head");
    head.appendChild(el("h2")).appendChild(window.LifeLogIcons.labelled(icon, label));
    if (more) {
      const b = el("button", "home-more", more.label + " ›");
      b.type = "button";
      b.onclick = more.run;
      head.appendChild(b);
    }
    return head;
  }

  function goTo(view, mode) {
    if (!viewEnabled(view)) return null;
    if (mode && !modeEnabled(view, mode)) return null;
    return () => {
      if (mode) {
        if (view === "backlog") state.backlogMode = mode;
        if (view === "notes") state.notesMode = mode;
      }
      switchToView(view);
    };
  }

  function progressSection() {
    const B = window.LifeLogBacklog;
    const items = inProgress(state.data);
    const run = goTo("timeline");
    const sec = el("section", "home-sec home-progress");
    sec.appendChild(sectionHead("progress", run && items.length ? { label: "Timeline", run } : null));
    if (!items.length) {
      sec.appendChild(el("p", "home-empty", "Nothing in progress. Start something from your Backlog and it shows here."));
      return sec;
    }
    const strip = el("div", "home-strip");
    for (const b of items) {
      const tile = B.backlogTile(b, null);
      tile.classList.add("home-tile");
      tile.tabIndex = 0;
      tile.setAttribute("role", "button");
      tile.setAttribute("aria-label", b.title);
      const c = B.progressCount && window.LifeLogJournal.categoryShows(b.category).progress ? B.progressCount(b) : null;
      if (c) {
        const badge = el("span", "home-tile-count", c.text);
        badge.title = c.words;
        tile.querySelector(".bl-tile-art").appendChild(badge);
      }
      const since = el("span", "home-tile-since");
      const dot = el("span", "dot");
      dot.style.background = (state.data.categories.find((x) => x.name === b.category) || {}).color || "";
      since.append(dot, document.createTextNode("Since " + Dates().day(b.startedAt, { year: "auto" })));
      tile.appendChild(since);
      const open = () => B.openBacklogModal(b);
      tile.onclick = open;
      tile.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } };
      if (window.LifeLogContextMenu) window.LifeLogContextMenu.attach(tile, "progress", b.id);
      strip.appendChild(tile);
    }
    sec.appendChild(strip);
    return sec;
  }

  const KIND_ICON = { release: "star", episode: "tv", charge: "repeat", habit: "square-check-big" };
  function upcomingRow(r, today) {
    const row = el("button", "home-row");
    row.type = "button";
    const ki = el("span", "home-row-ico");
    ki.appendChild(ico(KIND_ICON[r.kind]));
    row.appendChild(ki);
    const text = el("span", "home-row-text");
    text.appendChild(el("span", "home-row-title", r.title));
    const sub = el("span", "home-row-sub");
    const cat = r.category && (r.kind === "charge"
      ? null
      : state.data.categories.find((x) => x.name === r.category));
    if (cat) { const dot = el("span", "dot"); dot.style.background = cat.color; sub.appendChild(dot); }
    const H = window.LifeLogHabits;
    const amt = (n) => (r.minutes ? H.minutesShort(n) : String(n));
    const words = r.kind === "habit"
      ? (r.period === "day" ? (r.count === 1 ? "1 habit left today" : r.count + " habits left today") : `${amt(r.done)} of ${amt(r.target)} this ${r.period}`)
      : r.kind === "charge" ? [r.category, "charges"].filter(Boolean).join(" · ")
        : [r.category, r.kind === "release" ? (r.day === today ? "out today" : "release") : r.label || "new episode"].filter(Boolean).join(" · ");
    sub.appendChild(document.createTextNode(words));
    text.appendChild(sub);
    row.appendChild(text);
    const right = el("span", "home-row-end" + (r.kind === "charge" ? " is-money" : ""));
    if (r.kind === "charge") right.textContent = window.LifeLogFinance.amountText(r);
    else if (r.kind === "habit") right.textContent = r.period === "day" ? r.count + " left" : r.day === today ? "Today" : Dates().day(r.day, { year: false });
    else right.textContent = r.day === today ? "Today" : bucketOf(r.day, today) === "This week" || r.day === addDays(today, 1)
      ? Dates().WEEKDAYS[Dates().parts(r.day).wd] + " " + Dates().parts(r.day).d : Dates().day(r.day, { year: "auto" });
    row.appendChild(right);
    const B = window.LifeLogBacklog;
    if (r.kind === "release" || r.kind === "episode") {
      row.onclick = () => { const b = state.data.backlog.find((x) => x.id === r.id); if (b) B.openBacklogModal(b); };
    } else if (r.kind === "charge") {
      const go = goTo("finance");
      if (go) row.onclick = go; else row.disabled = true;
    } else {
      const go = goTo("notes", "habits");
      if (go) row.onclick = go; else row.disabled = true;
    }
    return row;
  }

  function upcomingSection() {
    const today = todayStr();
    const rows = comingUp(state.data, today, { Backlog: window.LifeLogBacklog, Finance: window.LifeLogFinance, Habits: window.LifeLogHabits });
    const run = goTo("backlog", "upcoming");
    const sec = el("section", "home-sec home-upcoming");
    sec.appendChild(sectionHead("upcoming", run ? { label: "Upcoming", run } : null));
    if (!rows.length) {
      sec.appendChild(el("p", "home-empty", "Nothing dated in the next two weeks."));
      return sec;
    }
    const card = el("div", "home-card");
    let last = "";
    for (const r of rows) {
      const b = bucketOf(r.day, today);
      if (b !== last) { card.appendChild(el("p", "home-day", b)); last = b; }
      card.appendChild(upcomingRow(r, today));
    }
    sec.appendChild(card);
    return sec;
  }

  // The textarea outlives a render, so a sync landing while you type
  // doesn't take the caret (or a half-typed word) with it.
  let pad = null, padTimer = 0;
  function padField() {
    if (pad) return pad;
    pad = el("textarea", "home-pad");
    pad.id = "homeScratchpad";
    pad.placeholder = "Jot something down…";
    pad.setAttribute("aria-label", "Scratchpad");
    pad.oninput = () => {
      fitPad();
      clearTimeout(padTimer);
      padTimer = setTimeout(savePad, 700);
      markPad("Saving…");
    };
    pad.onblur = () => { if (padTimer) { clearTimeout(padTimer); savePad(); } };
    return pad;
  }
  function fitPad() {
    if (!pad || !pad.isConnected) return;
    pad.style.height = "auto";
    pad.style.height = Math.max(pad.scrollHeight, 160) + "px";
  }
  const markPad = (text) => { const s = $("#homePadState"); if (s) s.textContent = text; };
  async function savePad() {
    padTimer = 0;
    if (!pad) return;
    const v = pad.value;
    if ((state.data.settings.scratchpad || "") === v) { markPad(v ? "Saved" : ""); return; }
    if (v) state.data.settings.scratchpad = v; else delete state.data.settings.scratchpad;
    markPad("Saved");
    await persist();
  }

  // Note or Board (per device, visual.homeScratchMode): the text pad, or a
  // scratch board (boards.js) that opens in the full-screen editor.
  const scratchMode = () => (state.visual.homeScratchMode === "board" && window.LifeLogBoards ? "board" : "note");
  function modeSwitch() {
    const seg = el("div", "seg home-pad-mode");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Scratchpad kind");
    for (const [k, icon, label] of [["note", "notebook-pen", "Note"], ["board", "presentation", "Board"]]) {
      const b = el("button", "seg-btn" + (scratchMode() === k ? " active" : ""));
      b.type = "button";
      b.dataset.mode = k;
      b.setAttribute("aria-pressed", String(scratchMode() === k));
      b.append(ico(icon), document.createTextNode(label));
      b.onclick = () => {
        if (scratchMode() === k) return;
        if (padTimer) { clearTimeout(padTimer); savePad(); }
        state.visual.homeScratchMode = k;
        saveVisualSettings(state.visual);
        render();
      };
      seg.appendChild(b);
    }
    return seg;
  }

  function scratchpadSection() {
    const sec = el("section", "home-sec home-scratch");
    const head = sectionHead("scratchpad");
    if (window.LifeLogBoards) head.appendChild(modeSwitch());
    sec.appendChild(head);
    sec.appendChild(scratchMode() === "board" ? boardCard() : noteCard());
    return sec;
  }

  function noteCard() {
    const card = el("div", "home-card");
    const field = padField();
    const saved = state.data.settings.scratchpad || "";
    if (document.activeElement !== field && !padTimer) field.value = saved;
    card.appendChild(field);
    const foot = el("div", "home-pad-foot");
    const said = el("span", "home-pad-state", field.value ? "Saved" : "");
    said.id = "homePadState";
    foot.appendChild(said);
    foot.appendChild(el("span", "spacer"));
    const make = el("button", "btn btn-small");
    make.type = "button";
    make.append(ico("plus"), document.createTextNode(" Make a note"));
    make.title = "Save what's here as a note in your Notebook and clear the scratchpad";
    make.onclick = makeNote;
    foot.appendChild(make);
    card.appendChild(foot);
    requestAnimationFrame(fitPad);
    return card;
  }

  function boardCard() {
    const B = window.LifeLogBoards;
    const card = el("div", "home-card");
    const open = el("button", "home-board");
    open.type = "button";
    open.id = "homeScratchBoard";
    if (!B.isLoaded()) {
      open.appendChild(el("span", "home-board-empty", "Loading…"));
      B.ensureLoaded().then(() => { if (state.view === "home") render(); }).catch(() => {});
    } else {
      const b = B.scratchBoard();
      if (b && b.elements.length) {
        open.appendChild(B.thumbnail(b));
        open.setAttribute("aria-label", "Open the scratch board");
      } else open.appendChild(el("span", "home-board-empty", "Nothing drawn yet"));
      if (!open.hasAttribute("aria-label")) open.setAttribute("aria-label", "Draw on the scratch board");
    }
    open.onclick = () => B.openScratch();
    card.appendChild(open);
    requestAnimationFrame(() => matchPad(open));
    const foot = el("div", "home-pad-foot");
    foot.appendChild(el("span", "spacer"));
    const keep = el("button", "btn btn-small");
    keep.type = "button";
    keep.append(ico("plus"), document.createTextNode(" Keep as a board"));
    keep.title = "File this drawing as a board in your Notebook and start a blank one";
    keep.onclick = keepBoard;
    foot.appendChild(keep);
    card.appendChild(foot);
    return card;
  }

  // The board is as tall as the text pad would be here, so switching
  // between Note and Board doesn't move what's under the card.
  function matchPad(open) {
    if (!open.isConnected) return;
    const probe = el("textarea", "home-pad");
    probe.value = state.data.settings.scratchpad || "";
    probe.setAttribute("aria-hidden", "true");
    probe.tabIndex = -1;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.width = open.offsetWidth + "px";
    probe.style.height = "auto";
    open.parentNode.appendChild(probe);
    open.style.height = Math.max(probe.scrollHeight, 160) + "px";
    probe.remove();
  }

  async function keepBoard() {
    const B = window.LifeLogBoards;
    const b = await B.keepScratch();
    if (!b) { toast("The board is empty — draw something first", true); return; }
    render();
    const canOpen = viewEnabled("notes") && modeEnabled("notes", "boards");
    toast(`Kept as "${b.name}" — the scratch board is blank`, false, canOpen ? { label: "Open", onClick: () => B.openBoard(b.id) } : null);
  }

  async function makeNote() {
    const text = (pad ? pad.value : state.data.settings.scratchpad || "").trim();
    if (!text) { toast("The scratchpad is empty — write something first", true); return; }
    clearTimeout(padTimer); padTimer = 0;
    const now = new Date().toISOString();
    const N = window.LifeLogNotes;
    const note = N.sanitizeNote({ text, createdAt: now, updatedAt: now });
    state.data.notes = [note, ...(state.data.notes || [])];
    delete state.data.settings.scratchpad;
    if (pad) pad.value = "";
    render();
    await persist();
    toast("Saved as a note — the scratchpad is clear", false, viewEnabled("notes") ? { label: "Open", onClick: () => N.openNote(note) } : null);
  }

  function pinnedSection() {
    const N = window.LifeLogNotes;
    const notes = pinnedNotes(state.data);
    const run = goTo("notes", "notes");
    const sec = el("section", "home-sec home-pinned");
    sec.appendChild(sectionHead("pinned", run ? { label: "Notebook", run } : null));
    if (!notes.length) {
      sec.appendChild(el("p", "home-empty", "No pinned notes. Open a note and choose Pin to Home from its ⋯ menu."));
      return sec;
    }
    const grid = el("div", "home-pins");
    for (const n of notes) grid.appendChild(N.pinnedCard(n));
    sec.appendChild(grid);
    return sec;
  }

  const BUILD = { progress: progressSection, upcoming: upcomingSection, scratchpad: scratchpadSection, pinned: pinnedSection };
  const HALF = new Set(SECTIONS.filter((s) => s[3]).map(([id]) => id));

  function renderHome(root) {
    const page = el("div", "home");
    const head = el("div", "home-head");
    const today = todayStr();
    const p = Dates().parts(today);
    head.appendChild(el("h1", "home-date", Dates().WEEKDAY_NAMES[p.wd] + ", " + Dates().dayMonth(p.d, p.m)));
    page.appendChild(head);
    const ids = visibleSections();
    if (!ids.length) {
      page.appendChild(el("p", "home-empty", "Every section is hidden. Turn some back on from the View button."));
      root.appendChild(page);
      return;
    }
    // Halves next to each other in your order share a row on a wide screen;
    // a half on its own takes the whole width.
    for (let i = 0; i < ids.length;) {
      let j = i;
      while (j < ids.length && HALF.has(ids[j])) j++;
      if (j - i >= 2) {
        const row = el("div", "home-pair" + (j - i >= 3 ? " is-3" : ""));
        ids.slice(i, j).forEach((id) => row.appendChild(BUILD[id]()));
        page.appendChild(row);
        i = j;
      } else page.appendChild(BUILD[ids[i++]]());
    }
    root.appendChild(page);
  }

  // ---------- the View sheet: the order and which sections show ----------
  function fillViewOptions() {
    const wrap = $("#homeSectionRows");
    if (!wrap) return;
    wrap.innerHTML = "";
    const order = sectionOrder(state.visual.homeSections);
    const off = state.visual.homeHidden || [];
    order.forEach((id, i) => {
      const [, label, icon] = SECTIONS.find(([s]) => s === id);
      const row = el("div", "sitem home-sec-row");
      const text = el("span", "sitem-text");
      text.appendChild(el("span", "sitem-title")).appendChild(window.LifeLogIcons.labelled(icon, label));
      row.appendChild(text);
      const arrow = (name, delta, words) => {
        const b = el("button", "btn btn-icon tab-order-btn");
        b.type = "button";
        b.appendChild(ico(name));
        b.title = words; b.setAttribute("aria-label", words);
        b.disabled = !order[i + delta];
        b.onclick = () => moveSection(id, delta);
        return b;
      };
      row.appendChild(arrow("arrow-up", -1, "Move " + label + " up"));
      row.appendChild(arrow("arrow-down", 1, "Move " + label + " down"));
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "switch";
      box.checked = !off.includes(id);
      box.setAttribute("aria-label", "Show " + label);
      box.onchange = () => setSectionShown(id, box.checked);
      row.appendChild(box);
      wrap.appendChild(row);
    });
  }
  function moveSection(id, delta) {
    const order = sectionOrder(state.visual.homeSections);
    const i = order.indexOf(id);
    if (i < 0 || !order[i + delta]) return;
    [order[i], order[i + delta]] = [order[i + delta], order[i]];
    state.visual.homeSections = order;
    saveVisualSettings(state.visual);
    fillViewOptions();
    const b = $("#homeSectionRows").children[i + delta];
    const again = b && b.querySelectorAll(".tab-order-btn")[delta < 0 ? 0 : 1];
    if (again && !again.disabled) again.focus();
    render();
  }
  function setSectionShown(id, on) {
    const off = new Set(state.visual.homeHidden || []);
    if (on) off.delete(id); else off.add(id);
    state.visual.homeHidden = [...off];
    saveVisualSettings(state.visual);
    render();
  }

  const api = {
    init, renderHome, fillViewOptions,
    // pure
    SECTIONS, SECTION_IDS, sectionOrder, inProgress, comingUp, bucketOf, pinnedNotes,
  };
  if (typeof window !== "undefined") window.LifeLogHome = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
