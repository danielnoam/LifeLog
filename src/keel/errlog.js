// keel: the errors this device has hit, for the moment something breaks
// on a phone and the question is what. Kept in localStorage on this device
// only, never synced; nothing leaves unless the person copies or sends it.
//
// Load it first, before every other script, so a script that throws while
// the rest load is caught too. Its own tag sets it up:
//   <script src="src/keel/errlog.js?v=1.2.3" data-key="app.log" data-keep="50" data-console></script>
// data-key   the localStorage key (each app keeps its own)
// data-keep  how many to keep, newest last
// data-console  console.error is kept too, as kind "console"
//
// An entry: { at (ms), kind ("error", "console", or the app's own), msg,
// where (the first stack lines), v (the build, from ?v=), n (times in a
// row) }. Addresses lose their query and anything that looks like a token
// is cut, so a copied log is safe to paste into an issue.
(function () {
  const me = document.currentScript;
  const data = (me && me.dataset) || {};
  const KEY = data.key || "keel.errors";
  const KEEP = Number(data.keep) || 50;
  const VERSION = ((me && me.src.match(/[?&]v=([\w.]+)/)) || [])[1] || "";

  const clean = (t, max) => String(t == null ? "" : t)
    .replace(/(https?:\/\/[^\s?#"'<>)]+)[?#][^\s"'<>)]*/g, "$1")
    .replace(/(token|key|password|secret)=[^\s&]+/gi, "$1=…")
    .replace(/\b(github_pat_|gh[pousr]_|ya29\.)[\w.-]+/g, "$1…")
    .replace(/(Bearer\s+)\S+/gi, "$1…")
    .slice(0, max);

  function list() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }

  // The first few frames, with the page's own address and ?v= cut, so a
  // line reads "src/app.js:1234:5".
  function frames(stack) {
    if (!stack) return "";
    const base = location.href.replace(/[^/]*([?#].*)?$/, "");
    return String(stack).split("\n").slice(1, 5)
      .map((l) => l.trim().split(base).join("").replace(/\?v=[\w.]+/g, ""))
      .filter(Boolean).join("\n");
  }

  let busy = false;
  function record(msg, stack, kind = "error") {
    msg = clean(msg, 600);
    // "Script error." carries nothing (a cross-origin script hid it), and
    // the ResizeObserver one is the browser noting a skipped frame.
    if (busy || !msg || msg === "Script error." || /ResizeObserver loop/.test(msg)) return;
    busy = true;
    try {
      const all = list();
      const last = all[all.length - 1];
      const at = Date.now();
      // The same one over and over is one entry with a count.
      if (last && last.msg === msg && (last.kind || "error") === kind) { last.n = (last.n || 1) + 1; last.at = at; }
      else all.push({ at, kind, msg, where: clean(frames(stack), 600), v: VERSION });
      localStorage.setItem(KEY, JSON.stringify(all.slice(-KEEP)));
    } catch (e) { /* storage full or blocked: not kept */ }
    busy = false;
  }
  const note = (kind, text) => record(text, null, kind);
  const named = (r) => (r && r.message ? (r.name && r.name !== "Error" ? r.name + ": " : "") + r.message : String(r));

  addEventListener("error", (e) => {
    // A failed <img> or <script> load fires here too, with no message.
    if (!e.message) return;
    record(e.message, (e.error && e.error.stack) || (e.filename ? "\n" + e.filename + ":" + e.lineno + ":" + e.colno : ""));
  });
  addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    if (r && r.name === "AbortError") return;
    record(named(r), r && r.stack);
  });
  if (me && me.hasAttribute("data-console")) {
    const was = console.error.bind(console);
    console.error = (...args) => {
      const err = args.find((a) => a instanceof Error);
      record(args.map((a) => (a instanceof Error ? named(a) : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch (x) { return String(a); } })())).join(" "),
        err && err.stack, "console");
      was(...args);
    };
  }

  const stamp = (at) => new Date(at).toISOString().replace("T", " ").slice(0, 16);
  function asText(all = list()) {
    return all.map((x) => stamp(x.at) + (x.v ? " v" + x.v : "") + (x.kind && x.kind !== "error" ? " " + x.kind : "") + (x.n > 1 ? " ×" + x.n : "") +
      "\n" + x.msg + (x.where ? "\n" + x.where : "")).join("\n\n");
  }

  window.Keel = window.Keel || {};
  window.Keel.errlog = {
    record, note, list, asText, clean,
    clear() { try { localStorage.removeItem(KEY); } catch (e) { /* none */ } },
    restore(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* none */ } },
  };
})();
