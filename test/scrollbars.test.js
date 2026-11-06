// The app's scrollbars (src/styles.css, "scrollbars"): `node test/scrollbars.test.js`.
// In Chromium (the browser, WebView2 on Windows, Android's WebView) a
// scrollbar-width other than auto on an element drops every ::-webkit-scrollbar
// rule for it, and the system's grey bar comes back. The Home tab's In
// progress strip shipped with `thin` and showed exactly that (2026-11-06).
// `none` (hidden) is fine, and so is the Firefox-only rule inside
// @supports not selector(::-webkit-scrollbar).
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8")
  .replace(/@supports not selector\(::-webkit-scrollbar\)\s*\{[^}]*\}/g, "");
const bad = [...css.matchAll(/scrollbar-width\s*:\s*([^;}\s]+)/g)].map((m) => m[1]).filter((v) => v !== "none" && v !== "auto");
try {
  assert.deepStrictEqual(bad, [], "scrollbar-width other than none/auto in styles.css: " + bad.join(", "));
  console.log("  ok - no rule turns the app's scrollbar back into the system's");
  console.log("\n1 test(s) passed.");
} catch (e) {
  console.error("  FAIL - " + e.message);
  process.exitCode = 1;
}
