// LifeLog in the reader's language, through keel's i18n.js: the English in
// i18n.t() is the key, src/lang/he.js has the Hebrew. Loaded in <head>, so
// <html> has its lang and dir (rtl for Hebrew) before the first paint, and
// window.i18n is there for every script after it. The table is written in
// only when it's needed: English pays nothing for Hebrew. index.html's own
// words carry data-t (text) and data-t-attr (placeholder, title, ...), and
// are put in the language once the page is parsed, before the app's
// scripts run. Settings → Appearance → Language changes it (i18n.set) and
// the app starts again.
//
// In Node (the tests, the bridge) there's no Keel: require()ing this file
// gives an English-only i18n, so the bridge's text stays English.
(function () {
  const fill = (s, v) => (!v ? s : s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)));
  const english = {
    lang: "en", dir: "ltr", choice: "", langs: ["en"],
    t: (s, v) => fill(s, v),
    tn: (n, one, other, v) => fill(n === 1 ? one : other, Object.assign({ n }, v)),
    apply: () => {},
    join: (items) => (items.length < 3 ? items.join(" and ") : items.slice(0, -1).join(", ") + ", and " + items[items.length - 1]),
    set: () => false,
    list: () => [{ code: "en", name: "English", dir: "ltr" }],
  };
  const K = typeof window === "object" && window.Keel && window.Keel.i18n;
  if (!K || typeof document === "undefined") {
    if (typeof module === "object" && module.exports) module.exports = english;
    return;
  }
  const TABLES = ["he"];
  const i18n = K.create({ key: "lifelog.lang", langs: ["en", "he"], load: false });
  window.i18n = i18n;
  if (TABLES.includes(i18n.lang)) {
    const v = (/\?v=[^&#]+/.exec((document.currentScript && document.currentScript.src) || "") || [""])[0];
    document.write('<script src="src/lang/' + i18n.lang + ".js" + v + '"><\/script>');
    // "interactive" comes after the page is parsed and before the deferred
    // scripts run, so the app starts from markup already in the language.
    document.addEventListener("readystatechange", function once() {
      if (document.readyState !== "interactive") return;
      document.removeEventListener("readystatechange", once);
      i18n.apply(document);
    });
  }
})();
