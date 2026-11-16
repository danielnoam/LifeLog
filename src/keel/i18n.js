// keel: the app's words in the reader's language, on window.Keel.i18n.
// English is written in the code and is the key: t("Save") shows "Save"
// until a language's table has it, so a string nobody has translated yet
// still reads, in English. Load it after platform.js, before the app.
//
//   const i18n = Keel.i18n.create({ key: "app.lang", langs: ["en", "he"] });
//   const t = i18n.t;
//   await i18n.ready                     the language's table is loaded
//   t("Saved to {place}", { place })     {name} filled in, numbers formatted
//   i18n.tn(n, "{n} page", "{n} pages")  the language's plural form
//   t("Open", { _: "state" })            one English word, two meanings: the
//                                        table's key is "state|Open"
//   i18n.apply(root)                     [data-t] text and [data-t-attr]
//                                        attributes ("placeholder,title")
//   i18n.lang, i18n.dir                  "he", "rtl"; also on <html>
//   i18n.choice, i18n.set(code | "")     "" follows the device (or English,
//                                        with device: false while a table is
//                                        still being written); set() saves
//                                        and returns true when it changed,
//                                        and the app reloads
//   i18n.list()                          [{ code, name }], each in its own
//                                        language, for the picker
//   i18n.date(d, opts), time(d, opts), number(n, opts), relative(v, unit),
//   join(items, opts), region(code), language(code), compare(a, b)
//
// A language's table is src/lang/<code>.js, loaded when it's needed
// (load: false when the app loads it itself, say before its first paint):
//
//   Keel.i18n.strings("he", { "Save": "שמירה", "{n} pages": { one: "עמוד אחד", other: "{n} עמודים" } });
//
// tools/keel-checks.js's i18n check finds the keys the code uses that a
// table lacks, the ones it has that nothing uses, and {names} that don't
// match.
(function () {
  const K = (window.Keel = window.Keel || {});
  const tables = {};
  const RTL = ["ar", "arc", "ckb", "dv", "fa", "he", "ku", "ps", "sd", "ug", "ur", "yi"];
  const base = (code) => {
    const b = String(code || "").toLowerCase().split(/[-_]/)[0];
    return b === "iw" ? "he" : b === "ji" ? "yi" : b;
  };
  const dirOf = (code) => (RTL.includes(base(code)) ? "rtl" : "ltr");

  function strings(lang, table) {
    tables[lang] = Object.assign(tables[lang] || {}, table);
  }

  function create({ key, langs = ["en"], fallback = "en", path = "src/lang/", version = "", device: follow = true, load = true } = {}) {
    const store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
    const read = () => { try { return (store && key && store.getItem(key)) || ""; } catch (e) { return ""; } };
    const choice = langs.includes(read()) ? read() : "";
    const device = () => {
      const asked = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]).filter(Boolean);
      for (const a of asked) if (langs.includes(base(a))) return base(a);
      return fallback;
    };
    let saved = choice;
    const lang = choice || (follow ? device() : fallback);
    const dir = dirOf(lang);
    const root = document.documentElement;
    root.lang = lang;
    root.dir = dir;

    const ready = lang === fallback || tables[lang] || !load ? Promise.resolve(lang) : new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = path + lang + ".js" + (version ? "?v=" + version : "");
      s.onload = () => resolve(lang);
      s.onerror = () => {
        if (K.errlog) K.errlog.note("i18n", "no table for " + lang);
        resolve(lang);
      };
      document.head.appendChild(s);
    });

    const missing = new Set();
    let plural, nums;
    const rules = () => (plural = plural || new Intl.PluralRules(lang));
    const fmt = () => (nums = nums || new Intl.NumberFormat(lang));
    const fill = (s, vars) => !vars ? s : s.replace(/\{(\w+)\}/g, (m, k) => {
      if (!(k in vars)) return m;
      const v = vars[k];
      return typeof v === "number" ? fmt().format(v) : String(v);
    });
    const look = (k) => {
      if (lang === fallback) return undefined;
      const v = tables[lang] && tables[lang][k];
      if (v === undefined || v === "") missing.add(k);
      return v === "" ? undefined : v;
    };

    function t(text, vars) {
      const k = vars && vars._ ? vars._ + "|" + text : text;
      const v = look(k);
      return fill(typeof v === "string" ? v : text, vars);
    }

    function tn(n, one, other, vars) {
      const all = Object.assign({ n }, vars);
      const k = all._ ? all._ + "|" + other : other;
      const v = look(k);
      if (v && typeof v === "object") return fill(v[rules().select(n)] || v.other || other, all);
      if (typeof v === "string") return fill(v, all);
      return fill(n === 1 ? one : other, all);
    }

    function apply(el) {
      const top = el || document;
      for (const node of top.querySelectorAll("[data-t]")) {
        const k = node.getAttribute("data-t") || node.textContent.trim().replace(/\s+/g, " ");
        node.setAttribute("data-t", k);
        node.textContent = t(k);
      }
      for (const node of top.querySelectorAll("[data-t-attr]")) {
        for (const a of node.getAttribute("data-t-attr").split(",").map((x) => x.trim()).filter(Boolean)) {
          const keep = "data-t-" + a;
          const k = node.getAttribute(keep) || node.getAttribute(a);
          if (!k) continue;
          node.setAttribute(keep, k);
          node.setAttribute(a, t(k));
        }
      }
    }

    function set(code) {
      const next = langs.includes(code) ? code : "";
      if (next === saved) return false;
      saved = next;
      try { if (store && key) next ? store.setItem(key, next) : store.removeItem(key); } catch (e) { /* private window: this launch only */ }
      return true;
    }

    const own = (code) => {
      try { return new Intl.DisplayNames([code], { type: "language" }).of(code) || code; } catch (e) { return code; }
    };
    const names = (type) => {
      try { return new Intl.DisplayNames([lang], { type }); } catch (e) { return null; }
    };
    let collator;

    return {
      lang, dir, choice, langs, ready, missing, t, tn, apply, set,
      list: () => langs.map((code) => ({ code, name: own(code), dir: dirOf(code) })),
      date: (d, opts) => new Date(d).toLocaleDateString(lang, opts),
      time: (d, opts) => new Date(d).toLocaleTimeString(lang, opts || { hour: "numeric", minute: "2-digit" }),
      number: (n, opts) => (opts ? new Intl.NumberFormat(lang, opts) : fmt()).format(n),
      relative: (v, unit, opts) => new Intl.RelativeTimeFormat(lang, opts || { numeric: "auto" }).format(v, unit),
      join: (items, opts) => (Intl.ListFormat ? new Intl.ListFormat(lang, opts).format(items) : items.join(", ")),
      region: (code) => { const n = names("region"); return (n && n.of(code)) || code; },
      language: (code) => { const n = names("language"); return (n && n.of(code)) || code; },
      compare: (a, b) => (collator = collator || new Intl.Collator(lang)).compare(a, b),
    };
  }

  K.i18n = { create, strings, dirOf, tables };
})();
