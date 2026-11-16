// LifeLog in the reader's language, through keel's i18n.js (2026-11-16).
// Groundwork only: no words are translated yet, so every language shows
// the English. What it sets up now: <html lang> and dir (rtl for Hebrew)
// before the first paint, so the layout (logical CSS), sideways gestures
// and keel's motion already mirror; and i18n.lang for numbers and dates
// through Intl. A language's table, when there is one, goes in
// src/lang/<code>.js and in TABLES below, and is written in only when
// it's the one in use.
(function () {
  const TABLES = [];
  const i18n = window.Keel.i18n.create({ key: "lifelog.lang", langs: ["en", "he"], load: false });
  window.i18n = i18n;
  if (TABLES.includes(i18n.lang)) {
    const v = (/\?v=[^&#]+/.exec((document.currentScript && document.currentScript.src) || "") || [""])[0];
    document.write('<script src="src/lang/' + i18n.lang + ".js" + v + '"><\/script>');
  }
})();
