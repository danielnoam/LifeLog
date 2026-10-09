// The page's Content-Security-Policy (0.263.0): scripts and styles come
// from the app's own files only, so a script that gets into the page some
// other way (a crafted note, an import, a link) doesn't run. These checks
// keep index.html in the shape the policy needs.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("index.html carries a Content-Security-Policy", () => {
  assert.ok(meta, "no CSP meta tag");
  const policy = meta[1];
  assert.ok(/(^|;)\s*script-src 'self'\s*(;|$)/.test(policy), "script-src is 'self' and nothing else");
  assert.ok(!/unsafe-inline|unsafe-eval/.test(policy), "no unsafe-inline or unsafe-eval");
  assert.ok(/object-src 'none'/.test(policy));
  assert.ok(/base-uri 'self'/.test(policy));
});

test("the policy comes before anything it should govern", () => {
  const head = html.indexOf("<head>");
  assert.ok(html.indexOf("<meta http-equiv=\"Content-Security-Policy\"") < html.indexOf("<link"), "CSP meta before the first link");
  assert.ok(head >= 0 && html.indexOf("<script") > html.indexOf("Content-Security-Policy"));
});

test("no inline script, handler or style attribute in index.html", () => {
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/\bsrc=/.test(m[1]));
  assert.deepStrictEqual(inlineScripts.map((m) => m[0]), [], "inline <script> blocks");
  const handlers = [...html.matchAll(/\s(on[a-z]+)="/g)].map((m) => m[1]);
  assert.deepStrictEqual(handlers, [], "inline on* handlers");
  const styleAttrs = [...html.matchAll(/\sstyle="/g)];
  assert.strictEqual(styleAttrs.length, 0, "style= attributes");
  assert.ok(!/href="javascript:/.test(html));
});

test("the app's own code sets no style attributes or inline handlers", () => {
  // el.style.x = … is fine under style-src 'self'; a style="…" attribute or a
  // <style> element isn't. Vendor files are checked too: they load the same way.
  const dir = path.join(__dirname, "..", "src");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f))
    .concat(fs.readdirSync(path.join(dir, "vendor")).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, "vendor", f)));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, ""); // comments may name eval
    assert.ok(!/setAttribute\(\s*["']style["']/.test(src), path.basename(f) + " sets a style attribute");
    assert.ok(!/\bnew Function\(|\beval\(/.test(src), path.basename(f) + " uses eval or Function");
    assert.ok(!/setAttribute\(\s*["']on[a-z]+["']/.test(src), path.basename(f) + " sets an inline handler");
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("ok - " + name); }
  catch (e) { failed++; console.log("not ok - " + name + "\n  " + (e && e.message)); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
