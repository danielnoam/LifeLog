// LifeLog — what's shared by every connection in Settings → Connections:
// the "What comes in" block on each one's screen, and the line under each
// one's row in the list.
//
// What comes in is kept in that connection's own settings object, beside
// its other fields, so it syncs and merges like them:
//   newMode  "ask" (new titles open the import review), "add" (they come
//            in without asking) or "none" (only what you already have is
//            kept in step)
//   take     { status: false } for a status left out; anything missing is on
//   send     false to stop sending your changes (the two-way ones only)
(function () {
  let ctx = null;

  // Each connection's statuses, in its own words. `defaultNew` is how it
  // behaved before the choice existed.
  const SPECS = {
    hardcover: {
      defaultNew: "ask", newLabel: "New books",
      take: [["want", "Want to Read", "To the backlog"], ["reading", "Currently Reading", "In progress"], ["read", "Read", "To the Timeline on the day you finished"], ["dnf", "Did Not Finish", "Into Dropped"]],
      send: ["Send my changes to Hardcover", "Starts, finishes, drops, and books you add"],
    },
    anilist: {
      defaultNew: "add", newLabel: "New titles",
      take: [["planning", "Planning", "To the backlog"], ["current", "Watching / Reading", "In progress, with the episode count"], ["completed", "Completed", "To the Timeline"], ["dropped", "Paused and Dropped", "Into Dropped"]],
      send: ["Send my changes to AniList", "Needs the sign-in below"],
    },
    stremio: {
      defaultNew: "ask", newLabel: "New titles",
      take: [["planning", "In your library", "To the backlog"], ["watching", "Watching", "In progress, with the episode you're on"], ["watched", "Watched movies", "To the Timeline on the last play"], ["progress", "Episode counts", "Updates shows you already have"]],
    },
    steam: {
      defaultNew: "ask", newLabel: "New wishlist games",
      take: [],
    },
  };
  const NEW_OPTIONS = [["ask", "Ask me first"], ["add", "Add straight away"], ["none", "Don't add new"]];

  const S = () => ctx.state.data.settings;
  const cfg = (k) => S()[k] || {};
  function newMode(k) {
    const v = cfg(k).newMode;
    return v === "ask" || v === "add" || v === "none" ? v : (SPECS[k] || {}).defaultNew || "ask";
  }
  const takes = (k, status) => !(cfg(k).take && cfg(k).take[status] === false);
  const sends = (k) => cfg(k).send !== false;

  async function set(k, patch) {
    const st = S();
    st[k] = { ...((ctx.DEFAULT_SETTINGS || {})[k] || {}), ...(st[k] || {}), ...patch };
    await ctx.persist();
  }

  // ---------- the block ----------
  function render(k) {
    const box = document.getElementById(k + "ComesIn");
    const spec = SPECS[k];
    if (!box || !spec || !ctx) return;
    const el = ctx.el;
    box.replaceChildren(el("h3", "sgroup-label", "What comes in"));
    const card = el("div", "sgroup-card");
    const row = el("label", "sitem");
    const t = el("span", "sitem-text");
    t.append(el("span", "sitem-title", spec.newLabel), el("span", "sitem-sub", "Ask me first opens the review"));
    const sel = el("select");
    for (const [v, label] of NEW_OPTIONS) sel.appendChild(new Option(label, v));
    sel.value = newMode(k);
    sel.onchange = () => set(k, { newMode: sel.value });
    row.append(t, sel);
    card.appendChild(row);
    const toggle = (title, sub, on, onChange) => {
      const r = el("label", "sitem toggle-label");
      const tx = el("span", "sitem-text");
      tx.append(el("span", "sitem-title", title), el("span", "sitem-sub", sub));
      const sw = el("input", "switch");
      sw.type = "checkbox";
      sw.checked = on;
      sw.onchange = () => onChange(sw.checked);
      r.append(tx, sw);
      card.appendChild(r);
    };
    for (const [status, title, sub] of spec.take) {
      toggle(title, sub, takes(k, status), (on) => set(k, { take: { ...(cfg(k).take || {}), [status]: on } }));
    }
    if (spec.send) toggle(spec.send[0], spec.send[1], sends(k), (on) => set(k, { send: on }));
    box.appendChild(card);
    box.appendChild(el("p", "hint", spec.send
      ? "The switches choose what comes in from there. Turned off, a status there leaves the title here as it is, so the two can differ until you turn it back on. Sending your changes has only its own switch."
      : "The switches choose what comes in. Turned off, that part is left as it is here."));
  }
  const renderAll = () => Object.keys(SPECS).forEach(render);

  // New titles, the way you picked: the review, straight in, or not at all.
  // `built` is buildImportItems' result; `onSkips(selected, rows)` remembers
  // what was left unticked in the review, `onAdded(rows)` what came in
  // without one. Returns how many were offered or added.
  // Straight in takes what the review would have ticked; the rest (an
  // undated finish, say) is still offered for a look.
  function route(k, { built, title, hint, onSkips, onAdded, manual }) {
    const fresh = built ? built.items.filter((it) => (it.update || !it.dup) && !it.skipped) : [];
    if (!fresh.length) return 0;
    const mode = newMode(k);
    if (mode === "none") {
      // Only what you already have: updates to it still come in.
      const ups = fresh.filter((it) => it.update && it.checked);
      if (ups.length) ctx.importStraight(title, ups, []);
      return ups.length;
    }
    let offer = built;
    if (mode === "add") {
      const picked = fresh.filter((it) => it.checked);
      if (picked.length) ctx.importStraight(title, picked, built.newCategories || [], onAdded && (() => onAdded(picked)));
      const rest = fresh.filter((it) => !it.checked);
      if (!rest.length) return picked.length;
      offer = { items: rest, newCategories: [] };
    }
    const review = () => ctx.reviewAndImport(title, hint, offer, onSkips && ((selected) => onSkips(selected, offer.items)));
    if (manual) review();
    else ctx.toast(`${title}: ${offer.items.filter((it) => !it.dup).length} to review`, false, { label: "Review", onClick: review });
    return fresh.length;
  }

  // ---------- the line under each row ----------
  function status(k) {
    const st = S();
    const keys = st.mediaKeys || {};
    if (k === "hardcover") {
      const c = st.hardcover || {};
      if (!String(keys.hardcover || "").trim()) return { text: "Needs a token in Media lookups" };
      if (!c.category) return { text: "Not set up" };
      return { text: c.category + (sends(k) ? ", both ways" : ", read only") + (c.username ? " · @" + c.username : "") };
    }
    if (k === "anilist") {
      const c = st.anilist || {};
      if (!String(c.userName || "").trim()) return { text: "Not set up" };
      return { text: c.userName + " · " + (c.token && sends(k) ? "both ways" : "read only") };
    }
    if (k === "stremio") {
      const c = st.stremio || {};
      return { text: c.authKey ? "Signed in" + (c.email ? " as " + c.email : "") + " · read only" : "Not signed in" };
    }
    if (k === "waypage") {
      const W = window.LifeLogWaypage;
      const c = W ? W.cleanConfig(st.waypage) : st.waypage || {};
      if (!c.repo || !c.token) return { text: "Not connected" };
      const n = Object.keys(c.review || {}).length;
      if (c.paused) return { text: "Turned off", tone: "warn" };
      return n ? { text: n + " to check", tone: "warn" } : { text: "Reading log · " + c.repo };
    }
    if (k === "steam") {
      const c = st.steam || {};
      return { text: c.steamId ? "Wishlist, played games, game times" : "Not set up" };
    }
    if (k === "letterboxd") return { text: "Diary and watchlist from an export" };
    if (k === "payments") {
      const sel = document.getElementById("paymentsOn");
      return { text: "Payments from notifications · " + (sel && sel.value === "on" ? "on" : "off") };
    }
    return { text: "" };
  }

  function start(c) { ctx = c; }

  const api = { start, render, renderAll, route, status, newMode, takes, sends, SPECS };
  if (typeof window !== "undefined") window.LifeLogConnections = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
