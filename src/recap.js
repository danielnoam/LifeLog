// LifeLog — Recap: the year, told rather than tabulated.
//
// Journal Stats already has a per-year breakdown (the "That year in numbers"
// card). This is the other thing: a sequence you move through one fact at a
// time, drawn from all four views, because the point of this app is that they
// are one record — what you finished, what you'd been putting off, what you
// wrote, what it cost.
//
// The split that matters: buildRecap() is pure and knows nothing about the
// DOM, so what the recap *says* is unit-testable (test/recap.test.js), and
// renderRecap() only decides how a slide looks. A slide whose build returns
// null is dropped outright — a recap that pads itself with "0 notes written"
// is a report again, which is the thing this isn't.
(function () {
  let state, $, el, toast, MONTHS, prefersReducedMotion;

  function init(ctx) {
    ({ state, $, el, toast, MONTHS, prefersReducedMotion } = ctx);
  }

  const MONTHS_LONG = () => MONTHS;

  // How much of a year one slide will show. A wall is a wall at forty tiles
  // and a chore at four hundred; a scroll back through your notes is a nice
  // thing to do for a dozen and a reading assignment beyond that. Both slides
  // say so on their own foot when they are holding something back.
  const GALLERY_MAX = 48;
  const NOTE_CARDS_MAX = 12;

  // Whether a tab (and, where a slide names one, a mode) is switched on. Read
  // off the same visual settings the tab bar reads, so the recap and the app
  // can't disagree about what exists.
  function reachable(view, mode) {
    const offViews = (state && state.visual && state.visual.disabledViews) || [];
    if (offViews.includes(view)) return false;
    if (!mode) return true;
    const offModes = ((state && state.visual && state.visual.disabledModes) || {})[view] || [];
    return !offModes.includes(mode);
  }

  // ---------- gathering ----------
  const yearOf = (iso) => +String(iso || "").slice(0, 4);
  const monthOf = (iso) => +String(iso || "").slice(5, 7);
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  // "up 12 on last year" / "down 3" / "" when there's nothing to compare to.
  // Deliberately silent at zero rather than saying "the same as last year",
  // which reads as a judgement nobody asked for.
  function delta(now, before) {
    if (!before) return "";
    const d = now - before;
    if (!d) return "";
    return (d > 0 ? "up " + d : "down " + -d) + " on " + (before === 0 ? "nothing" : "last year");
  }

  function countByKey(list, keyOf) {
    const out = new Map();
    for (const x of list) {
      const k = keyOf(x);
      if (k == null || k === "") continue;
      out.set(k, (out.get(k) || 0) + 1);
    }
    return out;
  }
  const topOf = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);

  // Everything the slides draw on, for one year and the one before it.
  function gather(data, year) {
    const entries = (data.entries || []).filter((e) => +e.year === year);
    const prevEntries = (data.entries || []).filter((e) => +e.year === year - 1);
    const notes = (data.notes || []).filter((n) => yearOf(n.createdAt) === year);
    const prevNotes = (data.notes || []).filter((n) => yearOf(n.createdAt) === year - 1);
    // Ticked list items — the To-do mode's lists became list notes (0.197.0).
    const todosDone = (data.notes || []).filter((n) => n.kind === "list").flatMap((n) => n.items || [])
      .filter((t) => t.done && yearOf(t.doneAt) === year);
    const backlogAdded = (data.backlog || []).filter((b) => yearOf(b.createdAt) === year);
    const spend = (data.financeEntries || []).filter((f) => !f.skipped && yearOf(f.date) === year);
    const prevSpend = (data.financeEntries || []).filter((f) => !f.skipped && yearOf(f.date) === year - 1);
    const achievements = (data.accomplishments && data.accomplishments[year]) || [];
    // Habits are read through src/habits.js's own pure helpers rather than
    // re-deriving cadence and streak rules here — there is exactly one place
    // that knows what a streak is, and this is not it.
    const habits = (data.habits || []).map((h) => {
      const H = window.LifeLogHabits;
      const from = year + "-01-01", to = year + "-12-31";
      if (!H) return { habit: h, kept: 0, due: 0, best: 0 };
      const st = H.statsFor(h, from, to);
      return { habit: h, kept: st.done, due: st.due, rate: st.rate, best: H.bestStreakOf(h, to) };
    }).filter((x) => x.kept > 0);
    return { year, entries, prevEntries, notes, prevNotes, todosDone, backlogAdded, spend, prevSpend, achievements, habits };
  }

  // Each slide returns a spec or null. Order is the order you see them in:
  // it opens on the year, works through what you did, and ends on what you
  // said you'd do.
  const SLIDES = [
    function opening(g) {
      const anything = g.entries.length || g.notes.length || g.todosDone.length || g.spend.length
        || g.achievements.length || g.habits.length;
      if (!anything) return null;
      return { id: "opening", kind: "title", headline: String(g.year), sub: "Here's your year." };
    },

    function logged(g) {
      if (!g.entries.length) return null;
      const unique = new Set(g.entries.map((e) => e.title.trim().toLowerCase())).size;
      // The headline never repeats the number above it. A "big" slide is one
      // figure and a phrase that completes it — "14" / "things logged" — and
      // the first cut said "14" twice, which a screenshot caught and no
      // assertion would have.
      return {
        id: "logged", kind: "big", view: "timeline",
        value: g.entries.length,
        headline: g.entries.length === 1 ? "thing logged" : "things logged",
        sub: unique < g.entries.length ? unique + " of them different" : "",
        foot: delta(g.entries.length, g.prevEntries.length),
      };
    },

    function busiestMonth(g) {
      if (g.entries.length < 3) return null;
      const counts = countByKey(g.entries, (e) => +e.month);
      const [month, n] = topOf(counts, 1)[0] || [];
      if (!month || n < 2) return null;
      return {
        id: "month", kind: "big", view: "timeline",
        value: MONTHS_LONG()[month],
        headline: "was your busiest month",
        sub: plural(n, "thing", "things") + " logged",
      };
    },

    function categories(g) {
      if (g.entries.length < 3) return null;
      const counts = countByKey(g.entries, (e) => e.category);
      if (counts.size < 2) return null;
      const top = topOf(counts, 4);
      return {
        id: "categories", kind: "bars", view: "timeline",
        headline: "What you spent it on",
        bars: top.map(([label, n]) => ({ label, n })),
        max: top[0][1],
      };
    },

    // The wall. A recap that only counts what you did is a report with nicer
    // type; this is the slide that actually shows it back to you. Cover art
    // where there is any, a category-tinted tile with the title where there
    // isn't — a book you typed in by hand belongs on the wall too.
    function gallery(g) {
      if (g.entries.length < 3) return null;
      const best = new Map();
      for (const e of g.entries) {
        const key = e.title.trim().toLowerCase();
        const cur = best.get(key);
        // One tile per title. Prefer the showing that has cover art, then the
        // one you rated highest — a replay logged twice is one thing.
        if (!cur || (!cur.coverUrl && e.coverUrl) || (+e.rating || 0) > (+cur.rating || 0)) {
          best.set(key, { title: e.title, coverUrl: e.coverUrl || "", category: e.category, rating: +e.rating || 0 });
        }
      }
      const items = [...best.values()].sort((a, b) =>
        String(a.category).localeCompare(String(b.category))
        || b.rating - a.rating
        || a.title.localeCompare(b.title));
      const withArt = items.filter((x) => x.coverUrl).length;
      return {
        id: "gallery", kind: "gallery", view: "timeline",
        headline: "Everything you logged",
        sub: items.length + (items.length === 1 ? " thing" : " things") + ", all in one place",
        items: items.slice(0, GALLERY_MAX),
        foot: items.length > GALLERY_MAX ? "Showing the first " + GALLERY_MAX : (withArt ? "" : ""),
      };
    },

    function bestRated(g) {
      const rated = g.entries.filter((e) => e.rating);
      if (!rated.length) return null;
      const best = new Map();
      for (const e of rated) {
        const k = e.title.trim().toLowerCase();
        const cur = best.get(k);
        if (!cur || e.rating > cur.rating) best.set(k, { title: e.title, rating: e.rating, category: e.category, coverUrl: e.coverUrl || "" });
      }
      const top = [...best.values()].sort((a, b) => b.rating - a.rating).slice(0, 5);
      if (top[0].rating < 4) return null; // nothing worth calling a highlight
      const avg = rated.reduce((s, e) => s + e.rating, 0) / rated.length;
      return {
        id: "rated", kind: "list", view: "timeline",
        headline: top[0].rating === 5 ? "The ones you loved" : "Your best of the year",
        list: top.filter((t) => t.rating >= 4).map((t) => ({ label: t.title, note: "★".repeat(t.rating), category: t.category, coverUrl: t.coverUrl })),
        foot: "You rated " + plural(rated.length, "thing", "things") + ", averaging " + avg.toFixed(1) + "★",
      };
    },

    function repeated(g) {
      const counts = countByKey(g.entries, (e) => e.title.trim().toLowerCase());
      const [key, n] = topOf(counts, 1)[0] || [];
      if (!key || n < 2) return null;
      const example = g.entries.find((e) => e.title.trim().toLowerCase() === key);
      return {
        id: "repeated", kind: "big", view: "timeline",
        value: example.title,
        headline: "you came back to " + n + " times",
        sub: "More than anything else this year",
      };
    },

    function fromBacklog(g) {
      const cleared = g.entries.filter((e) => e.backlogAddedAt);
      if (!cleared.length) return null;
      // How long the oldest of them had been sitting there, which is the part
      // that actually lands — a count alone says nothing about the waiting.
      const waits = cleared
        .map((e) => (new Date(e.date + "-01") - new Date(e.backlogAddedAt)) / 86400000)
        .filter((d) => isFinite(d) && d > 0);
      const longest = waits.length ? Math.round(Math.max(...waits)) : 0;
      return {
        id: "backlog", kind: "big", view: "backlog",
        value: cleared.length,
        headline: cleared.length === 1 ? "thing off your backlog" : "things off your backlog",
        sub: longest > 60 ? "One had been waiting " + Math.round(longest / 30) + " months" : "",
      };
    },

    function backlogGrew(g) {
      if (g.backlogAdded.length < 3) return null;
      const cleared = g.entries.filter((e) => e.backlogAddedAt).length;
      return {
        id: "backlog-grew", kind: "big", view: "backlog",
        value: g.backlogAdded.length,
        headline: "added to the backlog",
        sub: cleared
          ? (g.backlogAdded.length > cleared
            ? "and " + cleared + " taken off — it grew by " + (g.backlogAdded.length - cleared)
            : "and " + cleared + " taken off — you're ahead")
          : "",
      };
    },

    function wrote(g) {
      if (!g.notes.length) return null;
      // A month only leads if it actually leads: four notes in four different
      // months has no busiest month, and saying "most of them in February"
      // about one of four is a claim the data doesn't support. Same floor
      // busiestMonth applies to entries.
      const counts = countByKey(g.notes, (n) => monthOf(n.createdAt));
      const ranked = topOf(counts, 2);
      const [month, top] = ranked[0] || [];
      const leads = top >= 2 && (!ranked[1] || top > ranked[1][1]);
      // Shows them rather than counting them. The count is still the first
      // thing you read — it is the headline — but under it are the notes
      // themselves, newest first, to scroll back through.
      const cards = g.notes
        .slice()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, NOTE_CARDS_MAX)
        .map((n) => ({ text: String(n.text || ""), date: String(n.createdAt || "").slice(0, 10) }));
      return {
        id: "notes", kind: "cards", view: "notes",
        value: g.notes.length,
        headline: g.notes.length + (g.notes.length === 1 ? " note" : " notes") + " written",
        sub: leads ? "Most of them in " + MONTHS_LONG()[month] : "",
        cards,
        foot: [delta(g.notes.length, g.prevNotes.length),
          g.notes.length > NOTE_CARDS_MAX ? "Showing the most recent " + NOTE_CARDS_MAX : ""]
          .filter(Boolean).join(" · "),
      };
    },

    function ticked(g) {
      if (g.todosDone.length < 3) return null;
      return {
        id: "todos", kind: "big", view: "notes", mode: "notes",
        value: g.todosDone.length,
        headline: "to-dos ticked off",
        sub: "",
      };
    },

    // The year's best run. A habit's whole value is the pattern, so the recap
    // says the pattern rather than a count of ticks.
    function habitStreak(g) {
      if (!g.habits.length) return null;
      const top = g.habits.slice().sort((a, b) => b.best - a.best || b.kept - a.kept)[0];
      if (top.best < 3) return null; // two days in a row is not a streak worth a slide
      return {
        id: "habit-streak", kind: "big", view: "notes", mode: "habits",
        value: top.best,
        headline: top.best === 1 ? "day in a row" : "days in a row",
        sub: "your best run of " + top.habit.name,
        foot: top.due ? "kept it " + top.kept + " of " + top.due + " days it asked for" : "",
      };
    },

    // And what you actually kept, across all of them.
    function habitsKept(g) {
      if (g.habits.length < 2) return null;
      const ranked = g.habits.slice().sort((a, b) => (b.rate || 0) - (a.rate || 0));
      return {
        id: "habits-kept", kind: "bars", view: "notes", mode: "habits",
        headline: "How the habits went",
        bars: ranked.slice(0, 5).map((x) => ({ label: x.habit.name, n: x.kept, color: x.habit.color })),
        max: ranked.reduce((m, x) => Math.max(m, x.kept), 0),
        foot: "days kept in " + g.year,
      };
    },

    function spent(g, fmt) {
      if (!g.spend.length) return null;
      const total = g.spend.reduce((s, f) => s + (+f.amount || 0), 0);
      if (!total) return null;
      const byCat = new Map();
      for (const f of g.spend) byCat.set(f.category, (byCat.get(f.category) || 0) + (+f.amount || 0));
      const [topCat, topAmount] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      const prevTotal = g.prevSpend.reduce((s, f) => s + (+f.amount || 0), 0);
      const pct = prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0;
      return {
        id: "spend", kind: "big", view: "finance",
        value: fmt(total),
        headline: "spent across " + plural(g.spend.length, "expense", "expenses"),
        sub: topCat ? "Most of it on " + topCat + " (" + fmt(topAmount) + ")" : "",
        foot: prevTotal && pct ? (pct > 0 ? pct + "% more than " : Math.abs(pct) + "% less than ") + (g.year - 1) : "",
      };
    },

    function achievements(g) {
      if (!g.achievements.length) return null;
      return {
        id: "achievements", kind: "list", view: "timeline", mode: "stats",
        headline: g.achievements.length === 1 ? "The thing you're proud of" : "The things you're proud of",
        list: g.achievements.slice(0, 8).map((a) => ({ label: a.text, note: "✦" })),
      };
    },

    function closing(g) {
      const bits = [];
      if (g.entries.length) bits.push(plural(g.entries.length, "thing logged", "things logged"));
      if (g.notes.length) bits.push(plural(g.notes.length, "note", "notes"));
      if (g.todosDone.length) bits.push(plural(g.todosDone.length, "to-do done", "to-dos done"));
      const habitDays = g.habits.reduce((n, x) => n + x.kept, 0);
      if (habitDays) bits.push(plural(habitDays, "day of a habit kept", "days of habits kept"));
      if (!bits.length) return null;
      return {
        id: "closing", kind: "title",
        headline: "That was " + g.year + ".",
        sub: bits.join(", ") + ". On to the next one.",
      };
    },
  ];

  // The whole recap as data. `fmt` formats money — passed in so this file
  // never has to know about currencies.
  //
  // `reachable(view, mode)` drops a slide about a tab or mode the reader has
  // turned off. A recap is a reading of the app you actually use: someone who
  // has switched the Ledger off should not be handed a slide about their
  // spending, and the data is still all there the moment they switch it back.
  // Default is everything, so the unit tests and any caller that doesn't care
  // get the whole thing.
  function buildRecap(data, year, fmt, reachable) {
    const g = gather(data || {}, year);
    const ok = reachable || (() => true);
    const kept = SLIDES
      .map((f) => f(g, fmt || String))
      .filter((sp) => sp && (!sp.view || ok(sp.view, sp.mode)));
    // The opening and closing belong to no view, so they survive a filter
    // that removed everything else — and "2026 / That was 2026." is not a
    // recap, it is two cards of nothing. All or nothing.
    return kept.some((sp) => sp.view) ? kept : [];
  }

  // Which years are worth offering at all.
  function recapYears(data) {
    const ys = new Set();
    for (const e of data.entries || []) if (e.year) ys.add(+e.year);
    for (const n of data.notes || []) if (yearOf(n.createdAt)) ys.add(yearOf(n.createdAt));
    for (const f of data.financeEntries || []) if (yearOf(f.date)) ys.add(yearOf(f.date));
    for (const y of Object.keys(data.accomplishments || {})) if (+y) ys.add(+y);
    for (const h of data.habits || []) for (const d of Object.keys(h.marks || {})) if (yearOf(d)) ys.add(yearOf(d));
    return [...ys].sort((a, b) => b - a);
  }

  // ---------- December ----------
  // The one year the app should volunteer a recap for, or null. December of
  // the year itself, or the first half of January looking back — past that it
  // stops being this year's recap and starts being an interruption.
  function yearToOffer(now) {
    const m = now.getMonth(); // 0-indexed
    const d = now.getDate();
    if (m === 11) return now.getFullYear();
    if (m === 0 && d <= 15) return now.getFullYear() - 1;
    return null;
  }

  // ---------- the player ----------
  // One slide on screen at a time, moved through by tap, arrow key or swipe.
  let slides = [], at = 0, recapYear = null, onClosed = null;

  function wire() {
    $("#recapCloseBtn").onclick = () => closeRecap();
    $("#recapPrevBtn").onclick = () => step(-1);
    // Past the last slide, "next" closes: a recap that traps you on its final
    // card until you find the ✕ ends on the wrong note.
    $("#recapNextBtn").onclick = () => step(1);

    const screen = $("#recapScreen");
    let x0 = null;
    screen.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    screen.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 45) step(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function isOpen() { return !$("#recapScreen").hidden; }

  // Called from app.js's global keydown, before the modal checks — the recap
  // is not a modal and owns the arrow keys while it is up.
  function handleKey(e) {
    if (!isOpen()) return false;
    if (e.key === "Escape") { closeRecap(); return true; }
    if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); step(1); return true; }
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); return true; }
    return false;
  }

  function step(d) {
    const next = at + d;
    if (next < 0) return;
    if (next >= slides.length) { closeRecap(); return; }
    at = next;
    paint();
  }

  function openRecap(year, opts) {
    const fmt = (window.LifeLogFinance && window.LifeLogFinance.formatMoney) || String;
    const data = { ...state.data };
    // A year's spending has to include what the recurring plans generated,
    // which are not stored as entries. Everything else reads straight off
    // state.data, so only this one collection is swapped.
    if (window.LifeLogFinance && window.LifeLogFinance.getEffectiveFinanceEntries) {
      data.financeEntries = window.LifeLogFinance.getEffectiveFinanceEntries();
    }
    slides = buildRecap(data, year, fmt, reachable);
    if (!slides.length) { toast("Nothing logged in " + year + " to recap yet"); return false; }
    recapYear = year;
    at = 0;
    onClosed = (opts && opts.onClosed) || null;
    $("#recapScreen").hidden = false;
    document.body.classList.add("modal-open"); // same scroll lock the modals use
    paint();
    return true;
  }

  function closeRecap() {
    if ($("#recapScreen").hidden) return;
    $("#recapScreen").hidden = true;
    $("#recapStage").innerHTML = "";
    document.body.classList.remove("modal-open");
    const done = onClosed;
    onClosed = null;
    if (done) done(recapYear);
  }

  function paint() {
    const spec = slides[at];
    const stage = $("#recapStage");
    stage.innerHTML = "";
    const card = el("div", "recap-slide recap-" + spec.kind);
    if (!prefersReducedMotion()) card.classList.add("recap-in");
    buildSlide(card, spec);
    stage.appendChild(card);

    const bar = $("#recapBar");
    bar.innerHTML = "";
    slides.forEach((_, i) => {
      bar.appendChild(el("span", "recap-seg" + (i <= at ? " is-done" : "")));
    });
    $("#recapCount").textContent = (at + 1) + " / " + slides.length;
    $("#recapPrevBtn").disabled = at === 0;
  }

  function buildSlide(card, spec) {
    if (spec.kind === "title") {
      card.appendChild(el("div", "recap-year", spec.headline));
      if (spec.sub) card.appendChild(el("p", "recap-sub", spec.sub));
      return;
    }
    if (spec.kind === "big") {
      card.appendChild(el("div", "recap-value", String(spec.value)));
      card.appendChild(el("h2", "recap-headline", spec.headline));
      if (spec.sub) card.appendChild(el("p", "recap-sub", spec.sub));
      if (spec.foot) card.appendChild(el("p", "recap-foot-note", spec.foot));
      return;
    }
    if (spec.kind === "bars") {
      card.appendChild(el("h2", "recap-headline", spec.headline));
      const wrap = el("div", "recap-bars");
      for (const b of spec.bars) {
        const row = el("div", "recap-barrow");
        row.appendChild(el("span", "recap-barlabel", b.label));
        const track = el("span", "recap-bartrack");
        const fill = el("span", "recap-barfill");
        fill.style.width = Math.round((b.n / spec.max) * 100) + "%";
        fill.style.background = b.color || colorFor(b.label);
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("span", "recap-barn", String(b.n)));
        wrap.appendChild(row);
      }
      card.appendChild(wrap);
      return;
    }
    if (spec.kind === "gallery") {
      card.appendChild(el("h2", "recap-headline", spec.headline));
      if (spec.sub) card.appendChild(el("p", "recap-sub", spec.sub));
      const grid = el("div", "recap-grid");
      for (const item of spec.items) grid.appendChild(tile(item));
      card.appendChild(grid);
      if (spec.foot) card.appendChild(el("p", "recap-foot-note", spec.foot));
      return;
    }
    if (spec.kind === "cards") {
      card.appendChild(el("h2", "recap-headline", spec.headline));
      if (spec.sub) card.appendChild(el("p", "recap-sub", spec.sub));
      const stack = el("div", "recap-cards");
      for (const c of spec.cards) {
        const note = el("div", "recap-note");
        if (c.date) note.appendChild(el("div", "recap-note-date", prettyDate(c.date)));
        // textContent via el(), never innerHTML: a note is whatever you
        // typed, and .recap-note-text's white-space is what keeps the breaks.
        note.appendChild(el("p", "recap-note-text", c.text));
        stack.appendChild(note);
      }
      card.appendChild(stack);
      if (spec.foot) card.appendChild(el("p", "recap-foot-note", spec.foot));
      return;
    }
    // list
    card.appendChild(el("h2", "recap-headline", spec.headline));
    const list = el("div", "recap-list");
    for (const item of spec.list) {
      const row = el("div", "recap-listrow");
      // Cover art, or a tile of the same size tinted with the category. A dot
      // here instead left the rows visibly different heights, so a list of
      // five looked ragged depending on which of them happened to have a
      // picture.
      const placeholder = () => {
        const box = el("span", "recap-listcover is-empty");
        const c = colorFor(item.category);
        if (/^#[0-9a-f]{6}$/i.test(c)) { box.style.background = c + "33"; box.style.borderColor = c + "77"; }
        return box;
      };
      if (item.coverUrl) {
        const img = document.createElement("img");
        img.className = "recap-listcover";
        img.loading = "lazy";
        img.alt = "";
        img.src = item.coverUrl;
        img.onerror = () => img.replaceWith(placeholder());
        row.appendChild(img);
      } else {
        row.appendChild(placeholder());
      }
      const label = el("span", "recap-listlabel", item.label);
      label.title = item.label;
      row.appendChild(label);
      if (item.note) row.appendChild(el("span", "recap-listnote", item.note));
      list.appendChild(row);
    }
    card.appendChild(list);
    if (spec.foot) card.appendChild(el("p", "recap-foot-note", spec.foot));
  }

  // One tile on the wall: the cover if there is one, otherwise a tinted card
  // carrying the title, so a book typed in by hand sits beside a game that
  // came with art instead of leaving a hole in the grid.
  function tile(item) {
    const cell = el("div", "recap-tile");
    cell.title = item.title;
    if (item.coverUrl) {
      const img = document.createElement("img");
      img.className = "recap-tile-img";
      img.loading = "lazy";
      img.alt = item.title;
      img.src = item.coverUrl;
      // A dead URL leaves the tinted tile behind rather than a broken image.
      img.onerror = () => { img.remove(); cell.classList.add("is-empty"); };
      cell.appendChild(img);
    } else {
      cell.classList.add("is-empty");
    }
    // Hex + alpha suffix, the same way .entry-cat tints itself — colorFor can
    // also hand back a var() fallback, which takes no suffix, so that case
    // simply keeps the plain card background.
    const colour = colorFor(item.category);
    if (!item.coverUrl && /^#[0-9a-f]{6}$/i.test(colour)) {
      cell.style.background = colour + "26";
      cell.style.borderColor = colour + "66";
    }
    const name = el("span", "recap-tile-name", item.title);
    cell.appendChild(name);
    return cell;
  }

  function prettyDate(iso) {
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  // A journal category keeps the colour it has everywhere else; anything else
  // falls back to the accent, rather than inventing a second palette.
  function colorFor(name) {
    const cat = (state.data.categories || []).find((c) => c.name === name);
    return (cat && cat.color) || "var(--accent)";
  }

  // ---------- December ----------
  // Offered once per year per device. Device-local on purpose: it rides in
  // the visual settings, which never sync, so seeing it on your phone is not
  // the same fact as seeing it on your laptop — and being shown your year
  // twice is a much smaller cost than never being shown it at all because
  // another device ticked it off while you weren't looking.
  function maybeOfferRecap() {
    const year = yearToOffer(new Date());
    if (year == null) return;
    const seen = state.visual.recapSeen || {};
    if (seen[year]) return;
    if (!buildRecap(state.data, year, String, reachable).length) return; // nothing to show; don't mark it seen either
    openRecap(year, { onClosed: markSeen });
  }

  function markSeen(year) {
    if (year == null) return;
    state.visual.recapSeen = { ...(state.visual.recapSeen || {}), [year]: true };
    if (window.LifeLogApp && window.LifeLogApp.saveVisualSettings) window.LifeLogApp.saveVisualSettings();
  }

  window.LifeLogRecap = {
    init, wire, buildRecap, recapYears, yearToOffer, gather,
    openRecap, closeRecap, isOpen, handleKey, maybeOfferRecap,
  };
})();
