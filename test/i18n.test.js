// Every word the app shows has its Hebrew in src/lang/he.js (keel's i18n
// check): none missing, none left over from text that's gone, and every
// {placeholder} and plural in the Hebrew matches the English.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { i18n } = require("../tools/keel-checks.js");

const root = path.join(__dirname, "..");
const files = ["index.html", ...fs.readdirSync(path.join(root, "src")).filter((f) => f.endsWith(".js")).map((f) => "src/" + f)]
  .map((f) => path.join(root, f));
const r = i18n.check(i18n.keys(files), i18n.table(path.join(root, "src/lang/he.js")));
assert.deepStrictEqual(r.missing, [], "Hebrew missing for: " + r.missing.join(" | "));
assert.deepStrictEqual(r.stale, [], "Hebrew for text that's gone: " + r.stale.join(" | "));
assert.deepStrictEqual(r.broken, [], "Hebrew that doesn't match its English: " + JSON.stringify(r.broken));
console.log("i18n: ok");
