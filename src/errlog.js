// LifeLog — the errors this device has hit (0.264.0).
//
// Loaded first, so a script that throws while the rest load is caught too.
// Kept in localStorage on this device only, never synced: it's for the
// moment something breaks on a phone and the question is what, not for
// anyone else. Settings → About shows it with Copy and Clear.
(function () {
  const KEY = "lifelog-errors-v1";
  const CAP = 50;
  // The build, from this script's own ?v= (index.html keeps it at APP_VERSION).
  const VERSION = ((document.currentScript && document.currentScript.src.match(/[?&]v=([\w.]+)/)) || [])[1] || "";

  function read() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }

  // The first few frames, with the page's own origin and the ?v= query cut
  // so a line reads "src/app.js:1234:5" rather than a full URL.
  function frames(stack) {
    if (!stack) return "";
    const base = location.href.replace(/[^/]*([?#].*)?$/, "");
    return String(stack).split("\n").slice(1, 5)
      .map((l) => l.trim().split(base).join("").replace(/\?v=[\w.]+/g, ""))
      .join("\n");
  }

  function record(msg, stack) {
    msg = String(msg || "").slice(0, 300);
    // "Script error." carries nothing (a cross-origin script hid it), and the
    // ResizeObserver one is the browser noting a skipped frame, not a fault.
    if (!msg || msg === "Script error." || /ResizeObserver loop/.test(msg)) return;
    const list = read();
    const last = list[list.length - 1];
    const at = new Date().toISOString();
    if (last && last.msg === msg) { last.n = (last.n || 1) + 1; last.at = at; }
    else list.push({ at, msg, where: frames(stack), v: VERSION });
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-CAP))); } catch (e) {}
  }

  window.addEventListener("error", (e) => {
    // A failed <img> or <script> load fires here too, with no message.
    if (!e.message) return;
    record(e.message, e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    if (r && r.name === "AbortError") return;
    record(r && r.message ? (r.name && r.name !== "Error" ? r.name + ": " : "") + r.message : String(r), r && r.stack);
  });

  function asText(list) {
    return list.map((x) => `${x.at}${x.v ? " v" + x.v : ""}${x.n > 1 ? " ×" + x.n : ""}\n${x.msg}${x.where ? "\n" + x.where : ""}`).join("\n\n");
  }

  window.LifeLogErrors = {
    list: read,
    record,
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} },
    restore(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} },
    asText: () => asText(read()),
  };
})();
