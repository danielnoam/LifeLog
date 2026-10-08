// One search across everything (0.251.0). The header's box used to narrow
// the tab you were on and badge the others with a count; now it opens a
// results page over the tab: every hit, grouped by where it lives, each a
// row that opens the thing itself. The old narrowing is still there as
// "Filter the Backlog" on a group, since narrowing a feed is how bulk work
// starts (select everything matching "zelda" and move it).
//
// `state.query` is what's in the box; `state.search` is the tab filter the
// five view filters read (getFiltered, getFilteredBacklog, …), and only the
// Filter line sets it now. Each group below says what text an item carries
// (`hay`) and how to open it (`open`); the view modules don't know about
// the page, they just open their sheets as a row click would.
(() => {
  let ctx = null;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const lower = (v) => String(v == null ? "" : v).toLowerCase();
  const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MAX_PER_GROUP = 8;

  const dateLabel = (s) => {
    const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(String(s || ""));
    if (!m) return "";
    return (m[3] ? +m[3] + " " : "") + (m[2] ? MONTHS[+m[2]] + " " : "") + m[1];
  };

  // Every word typed has to be somewhere in the item; the first word is the
  // one highlighted, as the Settings search does.
  const words = (q) => lower(q).trim().split(/\s+/).filter(Boolean);
  function hit(fields, ws) {
    const hay = fields.map((f) => lower(f.text)).join("\n");
    if (!ws.every((w) => hay.includes(w))) return null;
    // The field to quote: the first that holds the first word, title aside.
    const w = ws[0];
    const where = fields.find((f, i) => i > 0 && lower(f.text).includes(w)) || null;
    return { where, titleHit: lower(fields[0].text).includes(w) };
  }

  // A window of the field around the match, so a long note shows the part
  // that matched rather than its opening line.
  function snippet(text, w) {
    const t = String(text).replace(/\s+/g, " ").trim();
    const i = lower(t).indexOf(w);
    if (i < 0) return t.slice(0, 90);
    const start = Math.max(0, i - 36);
    let s = (start > 0 ? "…" : "") + t.slice(start, Math.min(t.length, i + w.length + 60));
    if (i + w.length + 60 < t.length) s += "…";
    return s;
  }
  function marked(text, w) {
    const frag = document.createDocumentFragment();
    const i = w ? lower(text).indexOf(w) : -1;
    if (i < 0) { frag.appendChild(document.createTextNode(text)); return frag; }
    frag.appendChild(document.createTextNode(text.slice(0, i)));
    frag.appendChild(el("mark", "", text.slice(i, i + w.length)));
    frag.appendChild(document.createTextNode(text.slice(i + w.length)));
    return frag;
  }

  // ---------- what each tab holds ----------
  // A group: { view, label, icon, filter (the view the Filter line narrows,
  // or none), items() → [{ fields: [{ text, name }], meta, open }] }. The
  // first field is the title.
  function groups() {
    const { state, viewEnabled, modeEnabled } = ctx;
    const out = [];
    const f = (text, name) => ({ text: text || "", name });

    if (modeEnabled("notes", "notes")) {
      const Notes = ctx.Notes;
      out.push({
        view: "notes", label: "Notes", icon: "notebook-text", filter: "notes",
        // A list's name is its text; a plain note's first line stands in
        // for the title it may not have.
        items: () => Notes.searchable().map((n) => ({
          fields: [f(n.title || (n.kind === "list" || n.kind === "board" ? n.text : String(n.text || "").split("\n")[0]), "title"), f(n.kind === "list" || n.kind === "board" ? "" : n.text, "text"), f((n.items || []).map((i) => i.text).join(" · "), "items"), f(n.author, "author"), f(n.source, "source"), f(n.category, "category")],
          meta: [n.category, dateLabel(n.createdAt)].filter(Boolean).join(" · "),
          open: () => Notes.openSearchHit(n),
        })),
      });
    }
    if (modeEnabled("notes", "habits")) {
      out.push({
        view: "notes", label: "Habits", icon: "square-check-big", filter: "notes",
        items: () => (state.data.habits || []).filter((h) => !h.archivedAt).map((h) => ({
          fields: [f(h.name, "title")],
          meta: h.cadence || "",
          open: () => ctx.Habits.openHabitModal(h),
        })),
      });
    }
    if (viewEnabled("timeline")) {
      out.push({
        view: "timeline", label: "Timeline", icon: "list", filter: "timeline",
        items: () => {
          const entries = (state.data.entries || []).map((e) => ({
            fields: [f(e.title, "title"), f(e.notes, "notes"), f(e.category, "category"), f((e.genres || []).join(", "), "genres")],
            meta: [e.category, dateLabel(e.date)].filter(Boolean).join(" · "),
            open: () => ctx.Journal.openEntryModal(e),
          }));
          const achs = [];
          for (const y of Object.keys(state.data.accomplishments || {})) {
            (state.data.accomplishments[y] || []).forEach((a, index) => achs.push({
              fields: [f(a.text, "title"), f(a.notes, "notes")],
              meta: "Achievement · " + y,
              open: () => ctx.Journal.openAchModal({ ...a, year: +y, index }),
            }));
          }
          return entries.concat(achs);
        },
      });
    }
    if (viewEnabled("backlog")) {
      const B = ctx.Backlog;
      out.push({
        view: "backlog", label: "Backlog", icon: "star", filter: "backlog",
        items: () => (state.data.backlog || []).map((b) => ({
          fields: [f(b.title, "title"), f(b.notes, "notes"), f(b.category, "category"), f((b.genres || []).join(", "), "genres")],
          meta: [B.isStarted(b) ? "In progress" : "", b.category, b.releaseYear ? String(b.releaseYear) : ""].filter(Boolean).join(" · "),
          open: () => B.openBacklogModal(b),
        })),
      });
    }
    if (viewEnabled("finance")) {
      const F = ctx.Finance;
      out.push({
        view: "finance", label: "Ledger", icon: "receipt", filter: "finance",
        items: () => {
          const projects = new Map((state.data.projects || []).map((p) => [p.id, p.name]));
          const rows = (state.data.financeEntries || []).map((x) => ({
            fields: [f(x.note || x.category, "title"), f(x.category, "category"), f(projects.get(x.project), "project"), f(F.amountText(x), "amount")],
            meta: [F.amountText(x), dateLabel(x.date)].filter(Boolean).join(" · "),
            open: () => F.openFinanceModal(x),
          }));
          const recurring = (state.data.recurringExpenses || []).map((r) => ({
            fields: [f(r.note || r.category, "title"), f(r.category, "category"), f(F.amountText(r), "amount")],
            meta: ["Recurring", F.amountText(r)].filter(Boolean).join(" · "),
            open: () => F.openRecurringModal(r),
          }));
          return rows.concat(recurring);
        },
      });
    }
    if (viewEnabled("travel")) {
      const T = ctx.Travel;
      out.push({
        view: "travel", label: "Travel", icon: "map-pin", filter: null,
        items: () => {
          const doc = T.searchable();
          const trips = new Map(doc.trips.map((t) => [t.id, t]));
          return doc.trips.map((t) => ({
            fields: [f(t.name, "title"), f(t.note, "notes")],
            meta: ["Trip", T.rangeLabel(t.start, t.end)].filter(Boolean).join(" · "),
            open: () => { ctx.goTo("travel"); T.showTrip(t.id); },
          })).concat(doc.places.map((p) => ({
            fields: [f(p.name, "title"), f(p.address, "address"), f(p.note, "notes"), f(p.town, "town")],
            meta: [(trips.get(p.trip) || {}).name, p.town, p.day ? dateLabel(p.day) : ""].filter(Boolean).join(" · "),
            open: () => { ctx.goTo("travel"); T.showPlace(p.id); },
          })));
        },
      });
    }
    out.push({
      view: "settings", label: "Settings", icon: "settings", filter: null,
      items: () => ctx.Settings.searchSettings(state.query).map((h) => ({
        fields: [f(h.text, "title"), f(h.where, "where")],
        meta: h.where,
        open: () => ctx.Settings.openSearchHit(h),
        always: true,
      })),
    });
    return out;
  }

  // ---------- the page ----------
  const isOpen = () => !!(ctx && ctx.state.query.trim());

  function results() {
    const ws = words(ctx.state.query);
    const w = ws[0] || "";
    const out = [];
    for (const g of groups()) {
      const rows = [];
      for (const it of g.items()) {
        if (it.always) { rows.push({ it, where: null, titleHit: true }); continue; }
        const h = hit(it.fields, ws);
        if (h) rows.push({ it, where: h.where, titleHit: h.titleHit });
      }
      if (rows.length) out.push({ group: g, rows, w });
    }
    return out;
  }

  let expanded = new Set();
  function render() {
    const root = $("#searchResults");
    if (!root) return;
    const open = isOpen();
    document.documentElement.classList.toggle("is-searching", open);
    root.hidden = !open;
    if (!open) { root.replaceChildren(); return; }
    const found = results();
    const q = ctx.state.query.trim();
    root.replaceChildren();
    const total = found.reduce((n, r) => n + r.rows.length, 0);
    const head = el("div", "search-head");
    head.appendChild(el("h2", "search-title", total ? `${total} ${total === 1 ? "result" : "results"} for “${q}”` : `Nothing matches “${q}”`));
    root.appendChild(head);
    if (!total) {
      root.appendChild(el("p", "search-none muted", "Titles, notes, places, amounts and settings are all searched. Try fewer words."));
      return;
    }
    const current = ctx.state.view;
    // The tab you're on first, then the bar's order.
    found.sort((a, b) => (a.group.view === current ? -1 : b.group.view === current ? 1 : 0));
    for (const { group, rows, w } of found) {
      const sec = el("section", "search-group");
      sec.dataset.view = group.view;
      const bar = el("div", "search-group-head");
      const label = el("h3", "search-group-label");
      label.appendChild(ctx.ico(group.icon));
      label.appendChild(document.createTextNode(` ${group.label} · ${rows.length}`));
      bar.appendChild(label);
      if (group.filter) {
        const filt = el("button", "btn btn-sm search-filter", `Filter ${ctx.viewLabel(group.filter)}`);
        filt.type = "button";
        filt.dataset.filter = group.filter;
        filt.title = `Show the ${ctx.viewLabel(group.filter)} tab narrowed to “${q}”`;
        filt.onclick = () => filterTab(group.filter);
        bar.appendChild(filt);
      }
      sec.appendChild(bar);
      const list = el("div", "search-list");
      const key = group.label;
      const shown = expanded.has(key) ? rows : rows.slice(0, MAX_PER_GROUP);
      for (const r of shown) list.appendChild(row(r, w));
      if (rows.length > shown.length) {
        const more = el("button", "btn btn-sm search-more", `${rows.length - shown.length} more`);
        more.type = "button";
        more.onclick = () => { expanded.add(key); render(); };
        list.appendChild(more);
      }
      sec.appendChild(list);
      root.appendChild(sec);
    }
  }

  function row({ it, where, titleHit }, w) {
    const b = el("button", "search-row");
    b.type = "button";
    const text = el("span", "search-row-text");
    const title = el("span", "search-row-title");
    title.appendChild(titleHit ? marked(it.fields[0].text || "Untitled", w) : document.createTextNode(it.fields[0].text || "Untitled"));
    text.appendChild(title);
    if (where) {
      const s = el("span", "search-row-snippet");
      s.appendChild(marked(snippet(where.text, w), w));
      text.appendChild(s);
    }
    if (it.meta) text.appendChild(el("span", "search-row-meta", it.meta));
    b.appendChild(text);
    b.onclick = () => it.open();
    return b;
  }

  // The old behaviour, on purpose: the box's text becomes the tab's filter,
  // the results page goes, the box keeps what was typed.
  function filterTab(view) {
    ctx.state.search = ctx.state.query;
    ctx.state.query = "";
    ctx.goTo(view);
    render();
    ctx.render();
    syncFilterNote();
  }
  // While a tab is narrowed, a line above it says so, with the way back.
  function syncFilterNote() {
    const note = $("#searchFilterNote");
    if (!note) return;
    const q = ctx.state.search.trim();
    note.hidden = !q;
    if (!q) return;
    note.replaceChildren();
    note.appendChild(el("span", "", `Showing only what matches “${q}”`));
    const all = el("button", "btn btn-sm", "All results");
    all.type = "button";
    all.onclick = () => { ctx.state.query = ctx.state.search; ctx.state.search = ""; $("#search").value = ctx.state.query; ctx.render(); render(); syncFilterNote(); };
    const off = el("button", "btn btn-sm", "Clear");
    off.type = "button";
    off.onclick = () => clear();
    note.appendChild(all);
    note.appendChild(off);
  }

  function setQuery(q) {
    ctx.state.query = q;
    if (ctx.state.search) { ctx.state.search = ""; ctx.render(); }
    expanded = new Set();
    render();
    syncFilterNote();
  }
  function clear() {
    ctx.state.query = "";
    const had = !!ctx.state.search;
    ctx.state.search = "";
    $("#search").value = "";
    render();
    syncFilterNote();
    if (had) ctx.render();
  }
  // After a sheet closes, what it changed shows: the app's render calls this.
  function refresh() { if (isOpen()) render(); }

  function start(c) {
    ctx = c;
    const box = $("#search");
    box.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && isOpen()) {
        const first = $("#searchResults .search-row");
        if (first) { e.preventDefault(); first.focus(); }
      }
    });
    $("#searchResults").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const rows = [...document.querySelectorAll("#searchResults .search-row")];
      const i = rows.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      if (e.key === "ArrowUp" && i === 0) { box.focus(); return; }
      const next = rows[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) next.focus();
    });
  }

  const api = { start, setQuery, clear, render, refresh, isOpen, words, hit, snippet, dateLabel };
  if (typeof window !== "undefined") window.LifeLogSearch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
