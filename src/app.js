// LifeLog — main app logic (vanilla JS, no build step).
(function () {
  const Storage = window.LifeLogStorage;
  const MONTHS = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const DEFAULT_SETTINGS = { monthOrder: "asc" }; // monthOrder: asc (Jan->Dec) | desc (Dec->Jan) — synced
  const DEFAULT_VISUAL = { monthMinWidth: 180, monthMaxWidth: 0 }; // maxWidth 0 = stretch — local to this device, not synced
  const VISUAL_KEY = "lifelog-visual-settings-v1";
  const APP_VERSION = "0.3.0"; // bump with each shipped change so it's visible in Settings

  function loadVisualSettings() {
    try {
      const raw = localStorage.getItem(VISUAL_KEY);
      if (raw) return Object.assign({ ...DEFAULT_VISUAL }, JSON.parse(raw));
    } catch (e) {}
    return null;
  }
  function saveVisualSettings(v) {
    try { localStorage.setItem(VISUAL_KEY, JSON.stringify(v)); } catch (e) {}
  }

  const state = {
    data: emptyData(),
    visual: loadVisualSettings() || { ...DEFAULT_VISUAL },
    view: "timeline",
    search: "",
    activeYears: new Set(),
    activeCats: new Set(),
  };
  let catColor = {}; // name -> color

  function emptyData() {
    return { version: 1, categories: [], entries: [], backlog: [], accomplishments: {}, settings: { ...DEFAULT_SETTINGS } };
  }

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const uid = () => "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function rebuildColorMap() {
    catColor = {};
    for (const c of state.data.categories) catColor[c.name] = c.color;
  }
  const colorOf = (name) => catColor[name] || "#7a8a99";

  function years() {
    const ys = new Set(state.data.entries.map((e) => e.year));
    return [...ys].sort((a, b) => b - a);
  }

  function getFiltered() {
    const q = state.search.trim().toLowerCase();
    const yf = state.activeYears;
    const cf = state.activeCats;
    return state.data.entries.filter((e) => {
      if (yf.size && !yf.has(e.year)) return false;
      if (cf.size && !cf.has(e.category)) return false;
      if (q && !e.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function getFilteredBacklog() {
    const q = state.search.trim().toLowerCase();
    const cf = state.activeCats;
    return state.data.backlog.filter((b) => {
      if (cf.size && !cf.has(b.category)) return false;
      if (q && !b.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function toast(msg, isErr) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2600);
  }

  async function persist() {
    state.data.exportedAt = new Date().toISOString();
    setSyncing("Saving…");
    const where = await Storage.save(state.data);
    refreshStorageStatus(where);
  }

  // ---------- rendering ----------
  function render() {
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.view === state.view));
    const c = $("#content");
    c.innerHTML = "";
    if (state.view === "backlog") { renderBacklog(c); return; }
    const entries = getFiltered();
    if (!state.data.entries.length) {
      c.appendChild(emptyState("No entries yet. Click “+ Add” to start, or import data from Settings."));
      return;
    }
    if (!entries.length) {
      c.appendChild(emptyState("No entries match your filters."));
      return;
    }
    if (state.view === "timeline") renderTimeline(c, entries);
    else if (state.view === "categories") renderCategories(c, entries);
    else renderStats(c, entries);
  }

  function emptyState(msg) { return el("div", "empty", msg); }

  function renderTimeline(root, entries) {
    root.appendChild(timelineToolbar());

    const byYear = groupBy(entries, (e) => e.year);
    for (const y of Object.keys(byYear).sort((a, b) => b - a)) {
      const block = el("div", "year-block");
      const head = el("div", "year-head");
      head.appendChild(el("h2", null, y));
      head.appendChild(el("span", "ycount", `${byYear[y].length} entries`));
      const accs = (state.data.accomplishments && state.data.accomplishments[y]) || [];
      if (accs.length) {
        const a = el("div", "accs");
        a.appendChild(document.createTextNode("★"));
        accs.forEach((acc, i) => {
          const chip = el("span", "acc", acc.text);
          chip.title = "Edit achievement";
          chip.onclick = () => openAchModal({ year: +y, index: i, text: acc.text, createdAt: acc.createdAt });
          a.appendChild(chip);
        });
        head.appendChild(a);
      }
      block.appendChild(head);

      const grid = el("div", "month-grid");
      const byMonth = groupBy(byYear[y], (e) => e.month);
      const monthSort = state.data.settings.monthOrder === "desc" ? (a, b) => b - a : (a, b) => a - b;
      for (const m of Object.keys(byMonth).sort(monthSort)) {
        const card = el("div", "month-card");
        const h = el("h3");
        h.appendChild(el("span", null, MONTHS[m]));
        h.appendChild(el("span", "mc", String(byMonth[m].length)));
        card.appendChild(h);
        byMonth[m].forEach((e) => card.appendChild(entryRow(e)));
        grid.appendChild(card);
      }
      block.appendChild(grid);
      root.appendChild(block);
    }
  }

  function entryRow(e) {
    const row = el("div", "entry");
    const bar = el("div", "bar");
    bar.style.background = colorOf(e.category);
    row.appendChild(bar);
    const t = el("span", "etitle", e.title);
    t.title = e.title;
    row.appendChild(t);
    row.appendChild(el("span", "ecat", e.category));
    row.onclick = () => openEntryModal(e);
    return row;
  }

  function renderCategories(root, entries) {
    const counts = countBy(entries, (e) => e.category);

    // Show all categories so empty ones can still be managed; if category
    // filter chips are active, narrow to those.
    let order = state.data.categories.map((c) => c.name);
    for (const n of Object.keys(counts)) if (!order.includes(n)) order.push(n);
    if (state.activeCats.size) order = order.filter((n) => state.activeCats.has(n));

    for (const name of order) {
      const realIdx = state.data.categories.findIndex((c) => c.name === name);
      const cat = realIdx >= 0 ? state.data.categories[realIdx] : null;
      const items = entries.filter((e) => e.category === name)
        .sort((a, b) => (b.year - a.year) || (b.month - a.month));
      const sec = el("div", "cat-section");
      const head = el("div", "cat-section-head");
      head.onclick = () => sec.classList.toggle("open"); // click row to expand

      const dot = el("span", "dot"); dot.style.background = colorOf(name);
      head.appendChild(dot);
      const h = el("h2", null, name);
      head.appendChild(h);
      head.appendChild(el("span", "chev", "▶"));

      // Clicking the colour or label opens the edit-category modal.
      if (cat) {
        dot.classList.add("clickable"); dot.title = "Edit category";
        h.classList.add("clickable"); h.title = "Edit category";
        const openEdit = (ev) => { ev.stopPropagation(); openCategoryModal(cat); };
        dot.onclick = openEdit;
        h.onclick = openEdit;
      }

      head.appendChild(el("span", "count", String(items.length)));

      if (cat) {
        const up = el("button", "move", "▲"); up.title = "Move up";
        up.onclick = (ev) => { ev.stopPropagation(); moveCategory(realIdx, -1); };
        const dn = el("button", "move", "▼"); dn.title = "Move down";
        dn.onclick = (ev) => { ev.stopPropagation(); moveCategory(realIdx, 1); };
        head.appendChild(up); head.appendChild(dn);
      }
      sec.appendChild(head);

      const list = el("div", "cat-list");

      // Combine duplicate titles (e.g. a game/show experienced more than once).
      const groups = [];
      const byTitle = new Map();
      items.forEach((e) => {
        const key = e.title.trim().toLowerCase();
        let g = byTitle.get(key);
        if (!g) { g = { title: e.title, items: [] }; byTitle.set(key, g); groups.push(g); }
        g.items.push(e);
      });

      groups.forEach((g) => {
        if (g.items.length === 1) { list.appendChild(catEntryRow(g.items[0], name)); return; }

        const row = el("div", "entry combined");
        const crow = el("div", "crow");
        const bar = el("div", "bar"); bar.style.background = colorOf(name);
        crow.appendChild(bar);
        const t = el("span", "etitle", g.title); t.title = g.title;
        crow.appendChild(t);
        crow.appendChild(el("span", "times", "×" + g.items.length));
        row.appendChild(crow);

        const dates = el("div", "dates");
        g.items.forEach((e) => {
          const chip = el("span", "datechip", `${MONTHS_SHORT[e.month]} ${e.year}`);
          chip.title = "Edit this one";
          chip.onclick = () => openEntryModal(e);
          dates.appendChild(chip);
        });
        row.appendChild(dates);
        list.appendChild(row);
      });

      sec.appendChild(list);
      root.appendChild(sec);
    }
  }

  function catEntryRow(e, name) {
    const row = el("div", "entry");
    const bar = el("div", "bar"); bar.style.background = colorOf(name);
    row.appendChild(bar);
    const t = el("span", "etitle", e.title); t.title = e.title;
    row.appendChild(t);
    row.appendChild(el("span", "ecat", `${MONTHS_SHORT[e.month]} ${e.year}`));
    row.onclick = () => openEntryModal(e);
    return row;
  }

  function renderBacklog(root) {
    if (!state.data.backlog.length) {
      root.appendChild(emptyState("Your backlog is empty. Use “+ Add” → “Add to backlog” for things to watch, play, or read later, then mark them “✓ Done” once you finish."));
      return;
    }
    const items = getFilteredBacklog()
      .slice().sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    if (!items.length) {
      root.appendChild(emptyState("No backlog items match your filters."));
      return;
    }
    const card = el("div", "card backlog-card");
    items.forEach((b) => card.appendChild(backlogRow(b)));
    root.appendChild(card);
  }

  function backlogRow(b) {
    const row = el("div", "entry");
    const bar = el("div", "bar"); bar.style.background = colorOf(b.category);
    row.appendChild(bar);
    const t = el("span", "etitle", b.title); t.title = b.title;
    row.appendChild(t);
    row.appendChild(el("span", "ecat", b.category));
    const doneBtn = el("button", "btn btn-sm", "✓ Done");
    doneBtn.type = "button";
    doneBtn.title = "Move to your log";
    doneBtn.onclick = (ev) => { ev.stopPropagation(); openEntryModal(null, b); };
    row.appendChild(doneBtn);
    row.onclick = () => openBacklogModal(b);
    return row;
  }

  function renderStats(root, entries) {
    const ys = [...new Set(entries.map((e) => e.year))];
    const thisYear = new Date().getFullYear();
    const big = el("div", "card");
    const bigRow = el("div", "stat-big");
    bigRow.appendChild(statItem(entries.length, "entries"));
    bigRow.appendChild(statItem(entries.filter((e) => e.year === thisYear).length, `in ${thisYear}`));
    bigRow.appendChild(statItem(ys.length, "years"));
    bigRow.appendChild(statItem(new Set(entries.map((e) => e.category)).size, "categories"));
    big.appendChild(el("h2", null, "Overview"));
    big.appendChild(bigRow);

    const grid = el("div", "stats-grid");

    // by category
    const catCard = el("div", "card");
    catCard.appendChild(el("h2", null, "Categories"));
    const catCounts = countBy(entries, (e) => e.category);
    const byCat = groupBy(entries, (e) => e.category);
    const catUnique = {};
    for (const n of Object.keys(catCounts)) catUnique[n] = new Set(byCat[n].map((e) => e.title.trim().toLowerCase())).size;
    const catOrder = state.data.categories.map((c) => c.name).filter((n) => catCounts[n]);
    for (const n of Object.keys(catCounts)) if (!catOrder.includes(n)) catOrder.push(n);
    const catMax = Math.max(1, ...Object.values(catCounts));
    catOrder.sort((a, b) => catCounts[b] - catCounts[a])
      .forEach((n) => catCard.appendChild(barRow(n, catCounts[n], catMax, colorOf(n), catUnique[n])));

    // by year
    const yearCard = el("div", "card");
    yearCard.appendChild(el("h2", null, "Years"));
    const yearCounts = countBy(entries, (e) => e.year);
    const yearMax = Math.max(1, ...Object.values(yearCounts));
    Object.keys(yearCounts).sort((a, b) => b - a)
      .forEach((y) => yearCard.appendChild(barRow(y, yearCounts[y], yearMax, "#5b8cff")));

    grid.appendChild(catCard);
    grid.appendChild(yearCard);
    root.appendChild(big);
    root.appendChild(grid);
  }

  function statItem(n, l) {
    const i = el("div", "item");
    i.appendChild(el("div", "n", String(n)));
    i.appendChild(el("div", "l", l));
    return i;
  }
  function barRow(label, val, max, color, uniqueVal) {
    const row = el("div", "bar-row");
    row.appendChild(el("div", "lbl", label));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill");
    fill.style.width = (val / max * 100) + "%";
    fill.style.background = color;
    track.appendChild(fill);
    row.appendChild(track);
    const valEl = el("div", "val");
    if (uniqueVal != null && uniqueVal !== val) {
      valEl.title = uniqueVal + " unique title" + (uniqueVal === 1 ? "" : "s") + " (" + val + " total)";
      valEl.appendChild(el("span", "val-total", String(val)));
      valEl.appendChild(el("span", "val-unique", String(uniqueVal)));
    } else {
      valEl.textContent = String(val);
    }
    row.appendChild(valEl);
    return row;
  }

  // ---------- grouping utils ----------
  function groupBy(arr, fn) {
    const o = {};
    for (const x of arr) { const k = fn(x); (o[k] = o[k] || []).push(x); }
    return o;
  }
  function countBy(arr, fn) {
    const o = {};
    for (const x of arr) { const k = fn(x); o[k] = (o[k] || 0) + 1; }
    return o;
  }

  // ---------- filter bar ----------
  function buildYearFilter() {
    const wrap = $("#yearFilter");
    wrap.innerHTML = "";
    const ys = years();
    for (const y of state.activeYears) if (!ys.includes(y)) state.activeYears.delete(y);
    ys.forEach((y) => {
      const chip = el("span", "cat-chip year-chip" + (state.activeYears.has(y) ? " on" : ""), String(y));
      chip.onclick = () => {
        if (state.activeYears.has(y)) state.activeYears.delete(y);
        else state.activeYears.add(y);
        buildYearFilter();
        render();
      };
      wrap.appendChild(chip);
    });
  }
  function buildCatFilter() {
    const wrap = $("#catFilter");
    wrap.innerHTML = "";
    state.data.categories.forEach((c) => {
      const chip = el("span", "cat-chip" + (state.activeCats.has(c.name) ? " on" : ""));
      const dot = el("span", "dot"); dot.style.background = c.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(c.name));
      if (state.activeCats.has(c.name)) chip.style.background = c.color + "22";
      chip.onclick = () => {
        if (state.activeCats.has(c.name)) state.activeCats.delete(c.name);
        else state.activeCats.add(c.name);
        buildCatFilter();
        render();
      };
      wrap.appendChild(chip);
    });
  }

  // ---------- entry modal ----------
  function fillSelect(sel, opts, val) {
    sel.innerHTML = "";
    opts.forEach((o) => {
      const opt = el("option", null, o.label); opt.value = o.value;
      sel.appendChild(opt);
    });
    if (val != null) sel.value = val;
  }

  function openEntryModal(entry, fromBacklog) {
    const editing = !!entry;
    $("#entryModalTitle").textContent = editing ? "Edit entry" : "Add entry";
    $("#entryId").value = editing ? entry.id : "";
    $("#entryFromBacklog").value = fromBacklog ? fromBacklog.id : "";
    $("#fTitle").value = editing ? entry.title : (fromBacklog ? fromBacklog.title : "");
    fillSelect($("#fCategory"),
      state.data.categories.map((c) => ({ value: c.name, label: c.name })),
      editing ? entry.category : (fromBacklog ? fromBacklog.category : (state.data.categories[0] && state.data.categories[0].name)));
    fillSelect($("#fMonth"),
      MONTHS.slice(1).map((m, i) => ({ value: i + 1, label: m })),
      editing ? entry.month : (new Date().getMonth() + 1));
    $("#fYear").value = editing ? entry.year : new Date().getFullYear();
    $("#deleteEntryBtn").hidden = !editing;
    const added = $("#addedLine");
    if (editing && entry.createdAt) {
      added.textContent = "Added " + new Date(entry.createdAt).toLocaleDateString(undefined,
        { year: "numeric", month: "short", day: "numeric" });
      added.hidden = false;
    } else added.hidden = true;
    $("#entryModal").hidden = false;
    $("#fTitle").focus();
  }
  function closeEntryModal() { $("#entryModal").hidden = true; }

  async function saveEntryFromForm(ev) {
    ev.preventDefault();
    const id = $("#entryId").value;
    const fromBacklogId = $("#entryFromBacklog").value;
    const title = $("#fTitle").value.trim();
    const category = $("#fCategory").value;
    const year = parseInt($("#fYear").value, 10);
    const month = parseInt($("#fMonth").value, 10);
    if (!title) return;
    if (id) {
      const e = state.data.entries.find((x) => x.id === id);
      Object.assign(e, { title, category, year, month, date: `${year}-${String(month).padStart(2, "0")}` });
    } else {
      state.data.entries.push({
        id: uid(), title, category, year, month,
        date: `${year}-${String(month).padStart(2, "0")}`,
        createdAt: new Date().toISOString(),
      });
    }
    if (fromBacklogId) state.data.backlog = state.data.backlog.filter((b) => b.id !== fromBacklogId);
    closeEntryModal();
    buildYearFilter();
    render();
    await persist();
    toast(id ? "Entry updated" : (fromBacklogId ? "Moved to log" : "Entry added"));
  }

  async function deleteCurrentEntry() {
    const id = $("#entryId").value;
    if (!id) return;
    if (!confirm("Delete this entry?")) return;
    state.data.entries = state.data.entries.filter((x) => x.id !== id);
    closeEntryModal();
    buildYearFilter();
    render();
    await persist();
    toast("Entry deleted");
  }

  // ---------- achievements ----------
  function openAchModal(ach) {
    const editing = !!ach;
    $("#achModalTitle").textContent = editing ? "Edit achievement" : "Add achievement";
    $("#achOrig").value = editing ? `${ach.year}|${ach.index}` : "";
    $("#aText").value = editing ? ach.text : "";
    $("#aYear").value = editing ? ach.year : new Date().getFullYear();
    $("#deleteAchBtn").hidden = !editing;
    const added = $("#achAddedLine");
    if (editing && ach.createdAt) {
      added.textContent = "Added " + new Date(ach.createdAt).toLocaleDateString(undefined,
        { year: "numeric", month: "short", day: "numeric" });
      added.hidden = false;
    } else added.hidden = true;
    $("#achModal").hidden = false;
    $("#aText").focus();
  }
  function closeAchModal() { $("#achModal").hidden = true; }

  async function saveAchFromForm(ev) {
    ev.preventDefault();
    const text = $("#aText").value.trim();
    const year = parseInt($("#aYear").value, 10);
    if (!text || !year) return;
    const accs = state.data.accomplishments;
    const orig = $("#achOrig").value;
    let createdAt = new Date().toISOString();
    if (orig) { // editing: preserve original date, then remove the original
      const [oy, oi] = orig.split("|");
      if (accs[oy] && accs[oy][+oi]) createdAt = accs[oy][+oi].createdAt; // may be null (imported)
      if (accs[oy]) { accs[oy].splice(+oi, 1); if (!accs[oy].length) delete accs[oy]; }
    }
    (accs[year] = accs[year] || []).push({ text, createdAt });
    closeAchModal();
    render();
    await persist();
    toast(orig ? "Achievement updated" : "Achievement added");
  }

  async function deleteCurrentAch() {
    const orig = $("#achOrig").value;
    if (!orig) return;
    if (!confirm("Delete this achievement?")) return;
    const [oy, oi] = orig.split("|");
    const accs = state.data.accomplishments;
    if (accs[oy]) { accs[oy].splice(+oi, 1); if (!accs[oy].length) delete accs[oy]; }
    closeAchModal();
    render();
    await persist();
    toast("Achievement deleted");
  }

  // ---------- categories management ----------
  function openCategoryModal(cat) {
    const editing = !!cat;
    $("#catModalTitle").textContent = editing ? "Edit category" : "Add category";
    $("#catOrigName").value = editing ? cat.name : "";
    $("#cName").value = editing ? cat.name : "";
    $("#cColor").value = editing ? cat.color : "#3bb2e2";
    const uses = $("#cUses");
    if (editing) {
      const entryCount = countBy(state.data.entries, (e) => e.category)[cat.name] || 0;
      const backlogCount = countBy(state.data.backlog, (b) => b.category)[cat.name] || 0;
      const n = entryCount + backlogCount;
      uses.textContent = n + (n === 1 ? " item uses this" : " items use this");
      uses.hidden = false;
    } else uses.hidden = true;
    $("#deleteCatBtn").hidden = !editing;
    $("#catModal").hidden = false;
    $("#cName").focus();
  }
  function closeCategoryModal() { $("#catModal").hidden = true; }

  async function saveCategoryFromForm(ev) {
    ev.preventDefault();
    const orig = $("#catOrigName").value;
    const newName = $("#cName").value.trim();
    const color = $("#cColor").value;
    if (!newName) return;

    if (!orig) { // adding a new category
      if (state.data.categories.some((c) => c.name === newName)) {
        toast("That category already exists", true);
        return;
      }
      state.data.categories.push({ id: newName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: newName, color });
      closeCategoryModal();
      rebuildColorMap(); buildCatFilter(); render();
      await persist();
      toast("Category added");
      return;
    }

    const cat = state.data.categories.find((c) => c.name === orig);
    if (!cat) return;
    if (newName !== cat.name && state.data.categories.some((c) => c !== cat && c.name === newName)) {
      toast("A category with that name already exists", true);
      return;
    }
    cat.color = color;
    if (newName !== cat.name) {
      const old = cat.name;
      cat.name = newName;
      cat.id = newName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      state.data.entries.forEach((e) => { if (e.category === old) e.category = newName; });
      state.data.backlog.forEach((b) => { if (b.category === old) b.category = newName; });
      if (state.activeCats.has(old)) { state.activeCats.delete(old); state.activeCats.add(newName); }
    }
    closeCategoryModal();
    rebuildColorMap(); buildCatFilter(); render();
    await persist();
    toast("Category saved");
  }

  function deleteCurrentCategory() {
    const cat = state.data.categories.find((c) => c.name === $("#catOrigName").value);
    if (!cat) return;
    closeCategoryModal();
    deleteCategory(cat); // handles confirm, reassign-to-Other, persist & render
  }

  async function moveCategory(idx, dir) {
    const arr = state.data.categories;
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    buildCatFilter(); render();
    await persist();
  }

  async function deleteCategory(cat) {
    const counts = countBy(state.data.entries, (e) => e.category);
    const backlogCounts = countBy(state.data.backlog, (b) => b.category);
    const n = (counts[cat.name] || 0) + (backlogCounts[cat.name] || 0);
    if (n > 0) {
      if (cat.name === "Other") {
        toast("Can't delete “Other” while it's in use", true);
        return;
      }
      if (!confirm(`“${cat.name}” is used by ${n} item${n === 1 ? "" : "s"}. Move them to “Other” and delete?`)) return;
      let other = state.data.categories.find((c) => c.name === "Other");
      if (!other) { other = { id: "other", name: "Other", color: "#7a8a99" }; state.data.categories.push(other); }
      state.data.entries.forEach((e) => { if (e.category === cat.name) e.category = "Other"; });
      state.data.backlog.forEach((b) => { if (b.category === cat.name) b.category = "Other"; });
    } else {
      if (!confirm(`Delete category “${cat.name}”?`)) return;
    }
    state.data.categories = state.data.categories.filter((c) => c !== cat);
    state.activeCats.delete(cat.name);
    rebuildColorMap();
    buildCatFilter(); render();
    await persist();
    toast("Category deleted");
  }

  // ---------- backlog ----------
  function openBacklogModal(item) {
    const editing = !!item;
    $("#backlogModalTitle").textContent = editing ? "Edit backlog item" : "Add to backlog";
    $("#backlogId").value = editing ? item.id : "";
    $("#bTitle").value = editing ? item.title : "";
    fillSelect($("#bCategory"),
      state.data.categories.map((c) => ({ value: c.name, label: c.name })),
      editing ? item.category : (state.data.categories[0] && state.data.categories[0].name));
    $("#deleteBacklogBtn").hidden = !editing;
    $("#backlogModal").hidden = false;
    $("#bTitle").focus();
  }
  function closeBacklogModal() { $("#backlogModal").hidden = true; }

  async function saveBacklogFromForm(ev) {
    ev.preventDefault();
    const id = $("#backlogId").value;
    const title = $("#bTitle").value.trim();
    const category = $("#bCategory").value;
    if (!title) return;
    if (id) {
      const b = state.data.backlog.find((x) => x.id === id);
      Object.assign(b, { title, category });
    } else {
      state.data.backlog.push({ id: uid(), title, category, createdAt: new Date().toISOString() });
    }
    closeBacklogModal();
    render();
    await persist();
    toast(id ? "Backlog item updated" : "Added to backlog");
  }

  async function deleteCurrentBacklogItem() {
    const id = $("#backlogId").value;
    if (!id) return;
    if (!confirm("Remove this from your backlog?")) return;
    state.data.backlog = state.data.backlog.filter((x) => x.id !== id);
    closeBacklogModal();
    render();
    await persist();
    toast("Removed from backlog");
  }

  // ---------- settings / storage ----------
  function setStorageStatus(cls, txt) {
    const s = $("#storageStatus");
    s.innerHTML = "";
    s.appendChild(el("span", "led"));
    s.className = cls;
    s.appendChild(document.createTextNode(txt));
  }

  // Transient state while a load/save is in flight (pulsing led).
  function setSyncing(label) {
    setStorageStatus("storage-status syncing", label);
  }

  // Reflects every connected target ("up to date" once this resolves). Pass
  // the result of Storage.save() to flag when a connected target couldn't be
  // reached (offline).
  function refreshStorageStatus(savedWhere) {
    const ghOn = Storage.githubConnected;
    const fileOn = Storage.fileConnected;
    const gi = Storage.githubInfo;
    let txt, cls = "storage-status connected";
    if (ghOn && fileOn) txt = "Synced to " + (gi ? gi.owner + "/" + gi.repo : "GitHub") + " + file backup";
    else if (ghOn) txt = "Synced to " + (gi ? gi.owner + "/" + gi.repo : "GitHub");
    else if (fileOn) txt = "Saved to " + (Storage.fileName || "file");
    else if (Storage.fileName && Storage.needsReconnect) { cls = "storage-status local"; txt = "File needs reconnect — open Settings"; }
    else { cls = "storage-status local"; txt = Storage.fsSupported ? "Browser only — set up Data in Settings" : "Browser storage (this browser only)"; }
    if (savedWhere === "cache" && (ghOn || fileOn)) { cls = "storage-status local"; txt += " — offline, will retry"; }
    setStorageStatus(cls, txt);
  }

  function updateBackendInfo() {
    const info = $("#backendInfo");
    if (!info) return;
    const ghOn = Storage.githubConnected;
    const fileOn = Storage.fileConnected;
    const gi = Storage.githubInfo;
    if (ghOn && fileOn) {
      info.textContent = "Live sync: GitHub → " + gi.owner + "/" + gi.repo + ". Your local file (" + Storage.fileName + ") mirrors every save as an on-disk backup.";
    } else if (ghOn) {
      info.textContent = "Live sync: GitHub → " + gi.owner + "/" + gi.repo + ". Add a local file below for an automatic on-disk backup too.";
    } else if (fileOn) {
      info.textContent = "Saving to local file → " + Storage.fileName + ". Connect GitHub below to also sync to your phone (it becomes the live source, the file stays as backup).";
    } else {
      info.textContent = "Browser storage only. Connect a local file and/or GitHub below — data is written to every one you connect.";
    }
  }

  function updateGithubInfo() {
    const info = $("#ghInfo");
    const conn = $("#ghConnectBtn");
    const disc = $("#ghDisconnectBtn");
    const share = $("#ghShare");
    const gi = Storage.githubInfo;
    if (gi) { // prefill known fields (token is never read back)
      $("#ghRepo").value = gi.owner + "/" + gi.repo;
      $("#ghPath").value = gi.path;
      $("#ghBranch").value = gi.branch;
    }
    if (Storage.githubConnected && gi) {
      info.textContent = "Connected: " + gi.owner + "/" + gi.repo + " (" + gi.path + " on " + gi.branch + "), auto-syncing.";
      conn.textContent = "Update connection";
      disc.hidden = false;
      const frag = Storage.setupFragment();
      if (frag) {
        const link = location.origin + location.pathname + "#" + frag;
        $("#ghSetupLink").value = link;
        // warn when the current URL isn't reachable from a phone
        const localOnly = location.protocol === "file:" || /^(localhost$|127\.|0\.0\.0\.0$|\[::1\]$)/.test(location.hostname);
        $("#ghLocalWarn").hidden = !localOnly;
        // render QR (hidden when local-only or text too long for a v1-9 code)
        const qr = $("#ghQr");
        const tooLong = !localOnly && window.LifeLogQR && !window.LifeLogQR.fits(link);
        const svg = (!localOnly && window.LifeLogQR && !tooLong) ? window.LifeLogQR.svg(link, { size: 200 }) : null;
        if (svg) { qr.innerHTML = svg; qr.hidden = false; } else { qr.innerHTML = ""; qr.hidden = true; }
        $("#ghQrTooLong").hidden = !tooLong;
        share.hidden = false;
      } else share.hidden = true;
    } else {
      info.textContent = "Not connected. Syncs your log to a private GitHub repo so your phone and desktop stay in sync.";
      conn.textContent = "Connect GitHub";
      disc.hidden = true;
      share.hidden = true;
    }
  }

  function updateFileInfo() {
    const info = $("#fileInfo");
    const connect = $("#connectFileBtn");
    const recon = $("#reconnectFileBtn");
    const disc = $("#disconnectFileBtn");
    if (!Storage.fsSupported) {
      info.innerHTML =
        "Saving to a chosen file isn't enabled in this browser." +
        "<br><strong>Using Brave?</strong> It ships this feature off by default. Turn it on: " +
        "open <code>brave://flags</code> → search <em>“File System Access API”</em> → set to " +
        "<strong>Enabled</strong> → <strong>Relaunch</strong>, then reload this page." +
        "<br>Chrome and Edge support it out of the box." +
        "<br>Until then your data is saved in this browser — use <strong>Export JSON</strong> for backups.";
      connect.hidden = true; recon.hidden = true; disc.hidden = true;
      return;
    }
    if (Storage.fileName && !Storage.needsReconnect) {
      info.textContent = "Connected: " + Storage.fileName + " (auto-saving here).";
      connect.textContent = "Change data file…";
      recon.hidden = true; disc.hidden = false;
    } else if (Storage.fileName && Storage.needsReconnect) {
      info.textContent = "File “" + Storage.fileName + "” needs permission again (browsers ask after a restart).";
      recon.hidden = false; disc.hidden = false;
      connect.textContent = "Choose a different file…";
    } else {
      info.textContent = "No file connected. Data is auto-saved in this browser only.";
      connect.textContent = "Choose data file…";
      recon.hidden = true; disc.hidden = true;
    }
  }

  function setSettingsTab(name) {
    document.querySelectorAll(".stab").forEach((t) => t.classList.toggle("active", t.dataset.stab === name));
    document.querySelectorAll(".settings-panel").forEach((p) => { p.hidden = p.dataset.panel !== name; });
  }

  function openSettings() {
    setSettingsTab("data");
    updateBackendInfo();
    updateFileInfo();
    updateGithubInfo();
    $("#monthMin").value = state.visual.monthMinWidth;
    $("#monthMax").value = state.visual.monthMaxWidth;
    $("#settingsModal").hidden = false;
  }

  function onLayoutChange() {
    const min = Math.max(80, Math.min(600, parseInt($("#monthMin").value, 10) || 180));
    let max = parseInt($("#monthMax").value, 10);
    if (isNaN(max) || max < 0) max = 0;
    state.visual.monthMinWidth = min;
    state.visual.monthMaxWidth = max;
    saveVisualSettings(state.visual);
    applyMonthLayout();
  }
  function closeSettings() { $("#settingsModal").hidden = true; }

  async function connectFile() {
    try {
      const name = await Storage.connectFile(state.data);
      refreshStorageStatus();
      updateBackendInfo(); updateFileInfo();
      toast(Storage.githubConnected ? "Local backup file connected: " + name : "Connected & saved to " + name);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      toast("Couldn't connect file: " + (e.message || e), true);
    }
  }
  async function reconnectFile() {
    const ok = await Storage.reconnect();
    if (ok) {
      const fresh = await (await Storage.load()).data; // re-read from file
      if (fresh) { state.data = normalize(fresh); afterDataChange(); }
      await persist();
      refreshStorageStatus(); updateBackendInfo(); updateFileInfo();
      toast("Reconnected");
    } else toast("Permission denied", true);
  }
  async function disconnectFile() {
    await Storage.disconnect();
    refreshStorageStatus();
    updateBackendInfo(); updateFileInfo();
    toast(Storage.githubConnected ? "Local backup file disconnected (GitHub still syncing)" : "Local file disconnected (browser storage only)");
  }

  async function connectGithub() {
    const token = $("#ghToken").value.trim();
    if (!token) { toast("Paste your access token", true); return; }
    // Repo is optional (Advanced); blank → owner derived from token, repo = lifelog-data.
    let owner = "", repo = "";
    const repoRaw = $("#ghRepo").value.trim();
    if (repoRaw) {
      const m = repoRaw.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
      if (!m) { toast("Advanced repo must be owner/repo", true); return; }
      owner = m[1]; repo = m[2];
    }
    const cfg = {
      owner: owner, repo: repo,
      path: $("#ghPath").value.trim() || "lifelog.json",
      branch: $("#ghBranch").value.trim() || "main",
      token: token,
    };
    try {
      toast("Connecting to GitHub…");
      const res = await Storage.connectGithub(cfg, state.data);
      if (res.existed && res.data && Array.isArray(res.data.entries)) {
        const useRemote = confirm(
          "That repo already has a log with " + res.data.entries.length + " entries.\n\n" +
          "OK = load it onto this device.\n" +
          "Cancel = overwrite it with this device's " + state.data.entries.length + " entries."
        );
        if (useRemote) { state.data = normalize(res.data); afterDataChange(); }
        else { await persist(); } // overwrite remote with local
      }
      $("#ghToken").value = "";
      refreshStorageStatus();
      updateBackendInfo(); updateGithubInfo(); updateFileInfo();
      toast(Storage.fileConnected ? "GitHub connected — syncing, file kept as backup" : "GitHub connected — syncing here");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      toast("GitHub: " + (e.message || e), true);
    }
  }

  async function disconnectGithub() {
    await Storage.disconnectGithub();
    refreshStorageStatus();
    updateBackendInfo(); updateGithubInfo(); updateFileInfo();
    toast(Storage.fileConnected ? "GitHub disconnected (still saving to local file)" : "GitHub disconnected (browser storage only)");
  }

  // ---------- import / export ----------
  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = el("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  function exportJson() {
    download("lifelog.json", JSON.stringify(state.data, null, 2), "application/json");
  }
  function exportCsv() {
    const esc = (s) => {
      s = String(s == null ? "" : s);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [["Year", "Month", "Category", "Title", "Added"]];
    state.data.entries.slice()
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .forEach((e) => rows.push([e.year, MONTHS[e.month], e.category, e.title,
        e.createdAt ? e.createdAt.slice(0, 10) : ""]));
    download("lifelog.csv", rows.map((r) => r.map(esc).join(",")).join("\n"), "text/csv");
  }
  function importJson(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.entries || !Array.isArray(data.entries)) throw new Error("not a LifeLog file");
        if (!confirm(`Import ${data.entries.length} entries? This replaces your current data.`)) return;
        state.data = normalize(data);
        afterDataChange();
        await persist();
        toast("Imported " + state.data.entries.length + " entries");
      } catch (e) { toast("Import failed: " + (e.message || e), true); }
    };
    reader.readAsText(file);
  }

  // ---------- data lifecycle ----------
  function normalize(data) {
    data = data || emptyData();
    data.categories = data.categories || [];
    data.entries = (data.entries || []).map((e) => ({
      id: e.id || uid(),
      title: e.title || "",
      category: e.category || "Other",
      year: +e.year,
      month: +e.month,
      date: e.date || `${e.year}-${String(e.month).padStart(2, "0")}`,
      createdAt: e.createdAt || null,
    }));
    data.backlog = (data.backlog || []).map((b) => ({
      id: b.id || uid(),
      title: b.title || "",
      category: b.category || "Other",
      createdAt: b.createdAt || null,
    }));
    const incomingSettings = data.settings || {};
    // One-time migration: visual layout prefs used to be synced as part of
    // data.settings. Pull them into this device's local-only settings if it
    // doesn't have its own yet, then drop them from the synced data.
    if (localStorage.getItem(VISUAL_KEY) == null &&
        (incomingSettings.monthMinWidth != null || incomingSettings.monthMaxWidth != null)) {
      state.visual = {
        monthMinWidth: incomingSettings.monthMinWidth ?? DEFAULT_VISUAL.monthMinWidth,
        monthMaxWidth: incomingSettings.monthMaxWidth ?? DEFAULT_VISUAL.monthMaxWidth,
      };
      saveVisualSettings(state.visual);
    }
    data.settings = { monthOrder: incomingSettings.monthOrder || DEFAULT_SETTINGS.monthOrder };
    const accIn = data.accomplishments || {};
    data.accomplishments = {};
    for (const y of Object.keys(accIn)) {
      data.accomplishments[y] = (accIn[y] || []).map((a) =>
        typeof a === "string" ? { text: a, createdAt: null }
          : { text: a.text || "", createdAt: a.createdAt || null });
    }
    // ensure every used category exists
    const known = new Set(data.categories.map((c) => c.name));
    const palette = ["#e23b3b","#e2723b","#e2b23b","#9fe23b","#3be25a","#3bb2e2","#5b8cff","#723be2","#b23be2","#e23b72","#7a8a99"];
    let pi = data.categories.length;
    for (const e of [...data.entries, ...data.backlog]) if (!known.has(e.category)) {
      known.add(e.category);
      data.categories.push({ id: e.category.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: e.category, color: palette[pi++ % palette.length] });
    }
    return data;
  }

  function afterDataChange() {
    rebuildColorMap();
    applyMonthLayout();
    buildYearFilter();
    buildCatFilter();
    render();
  }

  function applyMonthLayout() {
    const s = state.visual || DEFAULT_VISUAL;
    const min = Math.max(80, parseInt(s.monthMinWidth, 10) || 180);
    const max = parseInt(s.monthMaxWidth, 10) || 0;
    document.documentElement.style.setProperty("--month-min", min + "px");
    document.documentElement.style.setProperty("--month-max", max > 0 ? Math.max(min, max) + "px" : "1fr");
  }

  function timelineToolbar() {
    const bar = el("div", "timeline-toolbar");
    const desc = state.data.settings.monthOrder === "desc";
    const btn = el("button", "btn btn-sm", desc ? "↑ Oldest first" : "↓ Newest first");
    btn.type = "button";
    btn.title = desc
      ? "Showing newest month first within each year — click for oldest first"
      : "Showing oldest month first within each year — click for newest first";
    btn.onclick = toggleMonthOrder;
    bar.appendChild(btn);
    return bar;
  }

  async function toggleMonthOrder() {
    state.data.settings.monthOrder = state.data.settings.monthOrder === "desc" ? "asc" : "desc";
    render();
    await persist();
  }

  // ---------- events ----------
  function wire() {
    $("#appVersion").textContent = "LifeLog v" + APP_VERSION;
    document.querySelectorAll(".tab").forEach((t) =>
      t.onclick = () => { state.view = t.dataset.view; render(); });
    $("#search").oninput = (e) => { state.search = e.target.value; render(); };

    const addMenu = $("#addMenu");
    const closeAddMenu = () => { addMenu.hidden = true; };
    $("#addBtn").onclick = (e) => { e.stopPropagation(); addMenu.hidden = !addMenu.hidden; };
    addMenu.querySelectorAll("button").forEach((b) => b.onclick = () => {
      closeAddMenu();
      if (b.dataset.add === "entry") openEntryModal(null);
      else if (b.dataset.add === "achievement") openAchModal(null);
      else if (b.dataset.add === "backlog") openBacklogModal(null);
      else openCategoryModal(null);
    });
    document.addEventListener("click", closeAddMenu);

    $("#cancelEntryBtn").onclick = closeEntryModal;
    $("#entryForm").onsubmit = saveEntryFromForm;
    $("#deleteEntryBtn").onclick = deleteCurrentEntry;

    $("#cancelAchBtn").onclick = closeAchModal;
    $("#achForm").onsubmit = saveAchFromForm;
    $("#deleteAchBtn").onclick = deleteCurrentAch;

    $("#cancelCatBtn").onclick = closeCategoryModal;
    $("#catForm").onsubmit = saveCategoryFromForm;
    $("#deleteCatBtn").onclick = deleteCurrentCategory;

    $("#cancelBacklogBtn").onclick = closeBacklogModal;
    $("#backlogForm").onsubmit = saveBacklogFromForm;
    $("#deleteBacklogBtn").onclick = deleteCurrentBacklogItem;

    $("#settingsBtn").onclick = openSettings;
    $("#closeSettingsBtn").onclick = closeSettings;
    document.querySelectorAll(".stab").forEach((t) => t.onclick = () => setSettingsTab(t.dataset.stab));
    $("#connectFileBtn").onclick = connectFile;
    $("#reconnectFileBtn").onclick = reconnectFile;
    $("#disconnectFileBtn").onclick = disconnectFile;
    $("#ghConnectBtn").onclick = connectGithub;
    $("#ghDisconnectBtn").onclick = disconnectGithub;
    $("#ghCopyLinkBtn").onclick = async () => {
      const v = $("#ghSetupLink").value;
      try { await navigator.clipboard.writeText(v); toast("Setup link copied"); }
      catch (e) { $("#ghSetupLink").select(); try { document.execCommand("copy"); } catch (_) {} toast("Setup link copied"); }
    };
    $("#monthMin").onchange = onLayoutChange;
    $("#monthMax").onchange = onLayoutChange;
    $("#exportJsonBtn").onclick = exportJson;
    $("#exportCsvBtn").onclick = exportCsv;
    $("#importJsonBtn").onclick = () => $("#importJsonInput").click();
    $("#importJsonInput").onchange = (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; };

    // close modals on overlay click / Escape (the conflict picker is modal —
    // it must be resolved via its buttons, not dismissed)
    document.querySelectorAll(".modal-overlay").forEach((ov) => {
      if (ov.id === "conflictModal") return;
      ov.addEventListener("click", (e) => { if (e.target === ov) ov.hidden = true; });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeEntryModal(); closeAchModal(); closeCategoryModal(); closeBacklogModal(); closeSettings(); $("#addMenu").hidden = true; }
    });
  }

  // Show the version-conflict picker and resolve once the user chooses one.
  function pickVersion(candidates) {
    return new Promise((resolve) => {
      const list = $("#conflictList");
      list.innerHTML = "";
      for (const c of candidates) {
        const item = el("div", "conflict-item");
        const info = el("div", "conflict-info");
        info.appendChild(el("strong", null, c.label));
        const count = (c.data.entries || []).length;
        const when = c.data.exportedAt ? new Date(c.data.exportedAt).toLocaleString() : "unknown time";
        info.appendChild(el("span", "muted", "Saved " + when + " · " + count + " entries"));
        item.appendChild(info);
        const btn = el("button", "btn btn-primary", "Use this");
        btn.type = "button";
        btn.onclick = () => { $("#conflictModal").hidden = true; resolve(c); };
        item.appendChild(btn);
        list.appendChild(item);
      }
      $("#conflictModal").hidden = false;
    });
  }

  // ---------- init ----------
  async function init() {
    wire();
    setSyncing("Loading…");

    // One-link device setup: open the app with #t=… (or legacy #setup=…) and it auto-connects.
    let setupMsg = null, setupErr = false;
    if (Storage.hashHasSetup(location.hash)) {
      const savedHash = location.hash;
      history.replaceState(null, "", location.pathname + location.search); // drop the token from the URL
      try { await Storage.connectFromHash(savedHash, emptyData()); setupMsg = "Connected to your GitHub sync"; }
      catch (e) { setupMsg = "Setup link failed: " + (e.message || e); setupErr = true; }
    }

    const result = await Storage.load();
    let source, githubReached;
    if (result.conflict) {
      const chosen = await pickVersion(result.conflict);
      const resolved = await Storage.resolveConflict(chosen);
      state.data = normalize(resolved.data);
      source = resolved.source;
      githubReached = result.conflict.some((c) => c.source === "github");
    } else {
      state.data = result.data ? normalize(result.data) : emptyData();
      source = result.source;
      githubReached = source === "github";
    }
    afterDataChange();

    refreshStorageStatus();

    if (setupMsg) toast(setupMsg, setupErr);
    else if (source === "seed") toast("Loaded " + state.data.entries.length + " entries from your sheet");
    else if (Storage.githubConnected && !githubReached) {
      toast("Offline — showing last saved copy; will sync when GitHub is reachable", true);
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  init();
})();
