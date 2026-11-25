// Nothing left behind: `node test/deadcode.test.js`. A style, a function or
// a helper handed between files that nothing uses any more is removed with
// the change that stopped using it, not found a year later. The first pass
// (2026-11-25) took out eleven classes, three functions and ten helpers
// passed to files that never used them.
//
// Only names are compared, so this can miss dead code (a name that also
// appears in a comment counts as used), but what it reports is dead.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const jsIn = (dir) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".js")).map((f) => dir + "/" + f);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + String(e.message).replace(/\n/g, "\n    ")); }
}
const named = (text, name) => (text.match(new RegExp("(?<![\\w$])" + name.replace(/\$/g, "\\$") + "(?![\\w$])", "g")) || []).length;
const noComments = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

// LifeLog's own code: keel's and the vendored files answer to their own repos.
const OWN = jsIn("src");
const APP = [...OWN, ...jsIn("src/keel"), ...jsIn("bridge"), ...jsIn("tools"), "index.html", "sw.js"];
const appText = APP.map(read).join("\n");

// Classes built from a value, so their full names are never written out:
// "theme-" + theme (app.js applyTheme), "is-" + a job's or row's state and
// "is-p" + priority, "key-" + a key's state (settings.js), "md-al-" + a
// table column's side (markdown.js).
const BUILT = ["theme-", "is-", "key-", "md-al-"];

test("every class in styles.css is used by the app", () => {
  const css = read("src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const classes = new Set([...css.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((m) => m[1]));
  const dead = [...classes].filter((c) => !BUILT.some((p) => c.startsWith(p))
    && !new RegExp("(?<![\\w-])" + c + "(?![\\w-])").test(appText));
  if (dead.length) throw new Error("in styles.css but in no markup or script; remove the rules:\n" + dead.map((c) => "." + c).join("\n"));
});

// recap.js's cards are functions in a list, run in order and never called
// by name.
const RUN_FROM_A_LIST = { "src/recap.js": ["bestRated", "backlogGrew", "habitStreak", "habitsKept", "spentOnWhat", "spentByMonth"] };

test("every function is called from somewhere", () => {
  const def = /^\s*(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/gm;
  const dead = [];
  for (const f of [...OWN, ...jsIn("bridge")]) {
    const src = read(f);
    for (const m of src.matchAll(def)) {
      const name = m[1] || m[2];
      if ((RUN_FROM_A_LIST[f] || []).includes(name)) continue;
      if (named(appText, name) <= 1) dead.push(f + ":" + src.slice(0, m.index).split("\n").length + " " + name);
    }
  }
  if (dead.length) throw new Error("defined and never used; remove them:\n" + dead.join("\n"));
});

// app.js hands each file its helpers through init({ ... }); the file takes
// them with `({ ... } = ctx)`. Both lists only ever grew.
const INIT = /\n  (?:if \(window\.LifeLog\w+\) window\.LifeLog)?(\w+)\.init\(\{([\s\S]*?)\}\);/g;
const FILE_OF = { IO: "io", SettingsUI: "settings" };

test("a file uses every helper it takes from app.js, and app.js passes none it doesn't", () => {
  const app = read("src/app.js");
  const wrong = [];
  let seen = 0;
  for (const m of app.matchAll(INIT)) {
    const file = "src/" + (FILE_OF[m[1]] || m[1].toLowerCase()) + ".js";
    if (!fs.existsSync(path.join(root, file))) { wrong.push("app.js: " + m[1] + ".init has no file here; add it to FILE_OF"); continue; }
    seen++;
    const src = noComments(read(file));
    // The keys at the top level of the object, whatever their values hold.
    const keys = [];
    let depth = 0, cur = "";
    for (const ch of noComments(m[2])) {
      if ("({[".includes(ch)) depth++;
      if (")}]".includes(ch)) depth--;
      if (ch === "," && depth === 0) { keys.push(cur); cur = ""; } else cur += ch;
    }
    keys.push(cur);
    for (const k of keys.map((x) => x.trim().split(/[:\s(]/)[0]).filter(Boolean)) {
      if (!named(src, k)) wrong.push("app.js passes " + k + " to " + file + ", which never names it");
    }
    const taken = /function init\(ctx\) \{\s*\(\{([\w$,\s]+?)\} = ctx\);/.exec(src);
    for (const k of taken ? taken[1].split(",").map((x) => x.trim()).filter(Boolean) : []) {
      // Taken without a `let` it becomes a global by accident: home.js's
      // coverEl and emptyCoverEl were, until this test.
      const declared = new RegExp("\\blet\\s[^;]*(?<![\\w$])" + k.replace(/\$/g, "\\$") + "(?![\\w$])").test(src);
      if (!declared) wrong.push(file + " takes " + k + " from app.js without declaring it");
      else if (named(src, k) <= 2) wrong.push(file + " takes " + k + " from app.js and never uses it");
    }
  }
  if (seen < 15) wrong.push("found only " + seen + " init({ ... }) calls in app.js; has their shape changed?");
  if (wrong.length) throw new Error(wrong.join("\n"));
});

console.log("\n" + passed + " test(s) passed.");
