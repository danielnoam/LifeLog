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
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  let ctx = null;

  // Each connection hands in one object from its own file (stremio.js,
  // hardcover.js, sync.js for Steam and AniList...), so adding or removing
  // one doesn't mean editing this file or settings.js:
  //   comesIn         its "What comes in" block: { defaultNew, newLabel,
  //                   take: [[status, their word, where it lands]], send }.
  //                   `defaultNew` is how it behaved before the choice existed.
  //   status(st)      the line under its row in the list: { text, tone }
  //   renderSettings  fills its own screen in Settings
  //   labels          its settings by name, for Restore settings
  //   onOpen, onFocus its check when the app opens and when it comes back
  //                   to the front
  // test/connections.test.js checks each one is whole.
  const REG = new Map();
  function register(id, def) { REG.set(id, { ...(REG.get(id) || {}), ...def }); }
  const ids = () => [...REG.keys()];
  const spec = (k) => (REG.get(k) || {}).comesIn;
  // One connection failing must not stop the rest (or the app opening);
  // the error still reaches the error log.
  function each(key, ...args) {
    for (const [, def] of REG) {
      if (typeof def[key] !== "function") continue;
      try { def[key](...args); } catch (e) { setTimeout(() => { throw e; }, 0); }
    }
  }
  const NEW_OPTIONS = [["ask", i18n.t("Ask me first")], ["add", i18n.t("Add straight away")], ["none", i18n.t("Don't add new")]];

  const S = () => ctx.state.data.settings;
  const cfg = (k) => S()[k] || {};
  function newMode(k) {
    const v = cfg(k).newMode;
    return v === "ask" || v === "add" || v === "none" ? v : (spec(k) || {}).defaultNew || "ask";
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
    const spec = (REG.get(k) || {}).comesIn;
    if (!box || !spec || !ctx) return;
    const el = ctx.el;
    box.replaceChildren(el("h3", "sgroup-label", i18n.t("What comes in")));
    const card = el("div", "sgroup-card");
    const row = el("label", "sitem");
    const t = el("span", "sitem-text");
    t.append(el("span", "sitem-title", spec.newLabel), el("span", "sitem-sub", i18n.t("Ask me first opens the review")));
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
      ? i18n.t("The switches choose what comes in from there. Turned off, a status there leaves the title here as it is, so the two can differ until you turn it back on. Sending your changes has only its own switch.")
      : i18n.t("The switches choose what comes in. Turned off, that part is left as it is here.")));
  }
  // Every connection's own screen, then the blocks.
  function renderAll() {
    each("renderSettings");
    ids().forEach(render);
  }

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
      // A title you skipped that has moved on since is asked about, never
      // added unseen.
      const picked = fresh.filter((it) => it.checked && !it.cameBack);
      if (picked.length) ctx.importStraight(title, picked, built.newCategories || [], onAdded && (() => onAdded(picked)));
      const rest = fresh.filter((it) => !picked.includes(it));
      if (!rest.length) return picked.length;
      // What you skipped rides along behind "Show what you skipped before".
      offer = { items: [...rest, ...built.items.filter((it) => it.skipped && !it.dup)], newCategories: [] };
    }
    const review = () => ctx.reviewAndImport(title, hint, offer, onSkips && ((selected) => onSkips(selected, offer.items)));
    if (manual) review();
    else ctx.toast(i18n.t("{title}: {n} to review", { title, n: offer.items.filter((it) => !it.dup && !it.skipped).length }), false, { label: i18n.t("Review"), onClick: review });
    return fresh.length;
  }

  // ---------- the line under each row ----------
  function status(k) {
    const def = REG.get(k);
    return (def && def.status && def.status(S())) || { text: "" };
  }
  function label(path) {
    for (const [, def] of REG) if (def.labels && def.labels[path]) return def.labels[path];
    return "";
  }
  const opened = () => each("onOpen");
  const focused = () => each("onFocus");

  function start(c) { ctx = c; }

  const api = { start, register, ids, render, renderAll, route, status, label, opened, focused, newMode, takes, sends };
  if (typeof window !== "undefined") window.LifeLogConnections = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
