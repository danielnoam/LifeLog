// keel: checks an app's tests run on its own files (Node, never shipped).
//
//   const { contrast, csp } = require("../tools/keel-checks.js");
//
// contrast: WCAG contrast between a theme's colour tokens, read from the
// app's CSS. Text needs 4.5:1, "ui" (control borders, focus rings, icons,
// large or bold text) 3:1. A colour with alpha is laid over its ground.
//
//   const themes = contrast.themes(css, { base: ":root", themes: { dark: ":root", light: "html.theme-light" } });
//   contrast.check(themes, [["text", "bg"], ["text-faint", "bg", "ui"]]) // → failures, [] when all pass
//
// csp: the page's Content-Security-Policy and what it needs of the code:
// scripts from the app's own files, no inline script, handler or style
// attribute, no eval.
//
//   csp.check(html, files) // → problems, [] when all pass
//
// i18n: the English keys the code and markup use (t("..."), tn(n, "...",
// "..."), data-t, data-t-attr) against a language's table (src/lang/<code>.js).
// missing: used, not in the table (it shows in English). stale: in the
// table, used nowhere. broken: a {name} the English doesn't have, or a
// plural with no `other`.
//
//   const keys = i18n.keys([...jsFiles, "index.html"]);
//   i18n.check(keys, i18n.table("src/lang/he.js")) // → { missing, stale, broken }
const fs = require("fs");
const vm = require("vm");

// ---- contrast ----

// The custom properties set in the rule whose selector is exactly `selector`.
function block(css, selector) {
  const vars = {};
  const re = new RegExp("(^|\\n|\\})\\s*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "g");
  for (const m of css.matchAll(re)) for (const v of m[2].matchAll(/--([\w-]+):\s*([^;]+);?/g)) vars[v[1]] = v[2].trim();
  return vars;
}

// { name: { token: value } }: each theme's own block over `base` (if any).
function themes(css, { base, themes: sel }) {
  const root = base ? block(css, base) : {};
  const out = {};
  for (const [name, s] of Object.entries(sel)) {
    const own = block(css, s);
    if (!Object.keys(own).length && s !== base) throw new Error("no CSS block for " + s);
    out[name] = { ...root, ...own };
  }
  return out;
}

function resolve(vars, name, depth = 0) {
  const v = vars[name];
  if (!v || depth > 8) return null;
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(vars, ref[1], depth + 1) : v;
}
function parse(c) {
  if (!c) return null;
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.replace(/./g, (x) => x + x);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((s) => (s.endsWith("%") ? parseFloat(s) / 100 : parseFloat(s)));
    return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]];
  }
  return null;
}
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1);
function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
// The ratio of two CSS colours (#rgb, #rrggbb, rgb(), rgba()); null if either can't be read.
function ratio(fg, bg) {
  const b = parse(bg);
  let f = parse(fg);
  if (!f || !b) return null;
  if (f[3] < 1) f = over(f, b);
  const [x, y] = [lum(f), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// pairs: [fg, bg, kind?] by token name; kind "text" (default, 4.5) or "ui" (3).
// A token a theme doesn't have is a failure too, so a rename can't hide one.
function check(all, pairs) {
  const fails = [];
  for (const [name, vars] of Object.entries(all)) {
    for (const [fg, bg, kind = "text"] of pairs) {
      const need = kind === "ui" ? 3 : 4.5;
      const r = ratio(resolve(vars, fg), resolve(vars, bg));
      if (r == null || r < need) fails.push(name + ": --" + fg + " on --" + bg + " " + (r == null ? "unreadable" : r.toFixed(2) + ":1") + " (needs " + need + ")");
    }
  }
  return fails;
}

// ---- csp ----

function policyOf(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i);
  return m ? m[1] : null;
}

// Problems with index.html's policy and the code under it. `files` are the
// app's JS files (its own and vendored: they load the same way).
function cspCheck(html, files = []) {
  const out = [];
  const policy = policyOf(html);
  if (!policy) return ["index.html has no Content-Security-Policy meta tag"];
  if (!/(^|;)\s*script-src 'self'\s*(;|$)/.test(policy)) out.push("script-src should be 'self' and nothing else");
  if (/unsafe-inline|unsafe-eval/.test(policy)) out.push("the policy allows unsafe-inline or unsafe-eval");
  if (!/object-src 'none'/.test(policy)) out.push("object-src should be 'none'");
  if (!/base-uri 'self'/.test(policy)) out.push("base-uri should be 'self'");
  const at = html.indexOf("Content-Security-Policy");
  const firstLink = html.indexOf("<link"), firstScript = html.indexOf("<script");
  if ((firstLink >= 0 && firstLink < at) || (firstScript >= 0 && firstScript < at)) out.push("the policy must come before the first <link> and <script>");
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) if (!/\bsrc=/.test(m[1])) out.push("inline <script> in index.html");
  for (const m of html.matchAll(/\s(on[a-z]+)="/g)) out.push("inline " + m[1] + "= handler in index.html");
  if (/\sstyle="/.test(html)) out.push("style= attribute in index.html");
  if (/href="javascript:/i.test(html)) out.push("javascript: link in index.html");
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, ""); // comments may name eval
    const name = f.split(/[\\/]/).slice(-2).join("/");
    if (/setAttribute\(\s*["']style["']/.test(src)) out.push(name + " sets a style attribute");
    if (/setAttribute\(\s*["']on[a-z]+["']/.test(src)) out.push(name + " sets an inline handler");
    if (/\bnew Function\(|\beval\(/.test(src)) out.push(name + " uses eval or new Function");
  }
  return out;
}

// ---- i18n ----

const STR = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`;
function unquote(q) {
  return q.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, c) =>
    c[0] === "u" && c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ n: "\n", t: "\t" })[c] || c);
}
const ctxAfter = (src, at) => {
  const m = src.slice(at, at + 120).match(/^\s*,\s*\{[^)]*?(?:^|[\s{,])_\s*:\s*("[^"]*"|'[^']*')/);
  return m ? unquote(m[1]) + "|" : "";
};

// Every key used in these files: { key: ["file", ...] }.
function keys(files) {
  const out = Object.create(null);
  const add = (k, f) => { if (k) (out[k] = out[k] || []).includes(f) || out[k].push(f); };
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const name = f.split(/[\\/]/).slice(-2).join("/");
    if (/\.html?$/.test(f)) {
      for (const m of src.matchAll(/<\w+\b([^>]*)>([^<]*)/g)) {
        const at = m[1].match(/\sdata-t(?:="([^"]*)")?(?=[\s>\/]|$)/);
        if (at) add(at[1] || m[2].trim().replace(/\s+/g, " "), name);
        const attrs = m[1].match(/\sdata-t-attr="([^"]*)"/);
        if (attrs) for (const a of attrs[1].split(",").map((x) => x.trim()).filter(Boolean)) {
          const v = m[1].match(new RegExp("\\s" + a + '="([^"]*)"'));
          if (v) add(v[1], name);
        }
      }
      continue;
    }
    const code = src.replace(/^\s*\/\/.*$/gm, "");
    for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$.])(?:i18n\.)?t\(\s*` + STR, "g"))) {
      add(ctxAfter(code, m.index + m[0].length) + unquote(m[1]), name);
    }
    for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$])(?:i18n\.)?tn\(\s*[^,]+?,\s*` + STR + String.raw`\s*,\s*` + STR, "g"))) {
      add(ctxAfter(code, m.index + m[0].length) + unquote(m[2]), name);
    }
  }
  return out;
}

// A language's table, read the way the app loads it.
function table(file) {
  const got = {};
  const strings = (lang, t) => Object.assign(got, t);
  const sandbox = { Keel: { i18n: { strings } } };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return got;
}

const names = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

function i18nCheck(used, tbl) {
  const missing = Object.keys(used).filter((k) => tbl[k] === undefined || tbl[k] === "").sort();
  const stale = Object.keys(tbl).filter((k) => !Object.hasOwn(used, k)).sort();
  const broken = [];
  for (const [k, v] of Object.entries(tbl)) {
    const english = names(k.includes("|") ? k.slice(k.indexOf("|") + 1) : k);
    const forms = v && typeof v === "object" ? v : { "": v };
    if (typeof v === "object" && !v.other) broken.push(k + ": a plural needs an `other` form");
    for (const [form, text] of Object.entries(forms)) {
      for (const n of names(text)) if (!english.has(n) && n !== "n") broken.push(k + (form ? " (" + form + ")" : "") + ": {" + n + "} isn't in the English");
    }
  }
  return { missing, stale, broken };
}

module.exports = {
  contrast: { themes, block, resolve, parse, ratio, check },
  csp: { policyOf, check: cspCheck },
  i18n: { keys, table, check: i18nCheck },
};
