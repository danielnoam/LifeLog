// Zero-dependency tests for src/markdown.js's parser — `node test/markdown.test.js`.
// render() needs a DOM; what it draws is decided here.
const assert = require("assert");
global.window = {};
require("../src/markdown.js");
const M = global.window.LifeLogMarkdown;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}
const kinds = (text) => M.parse(text).map((b) => b.t).join(",");

test("headings, paragraphs and rules are blocks of their own", () => {
  assert.strictEqual(kinds("# Title\nSome words\nmore words\n\n---\n## Next"), "h,p,hr,h");
  const b = M.parse("## Sauce ##");
  assert.deepStrictEqual(b[0], { t: "h", level: 2, text: "Sauce" });
  assert.strictEqual(M.parse("a\nb")[0].text, "a\nb");
});

test("a list is bullets, numbers or tasks, and a wrapped line joins its item", () => {
  const [ul] = M.parse("- eggs\n- flour\n  sifted");
  assert.deepStrictEqual(ul, { t: "ul", items: [{ text: "eggs" }, { text: "flour sifted" }] });
  const [ol] = M.parse("1. Mix\n2) Bake");
  assert.strictEqual(ol.t, "ol");
  assert.deepStrictEqual(ol.items.map((i) => i.text), ["Mix", "Bake"]);
  const [tasks] = M.parse("- [ ] buy\n- [x] cook");
  assert.deepStrictEqual(tasks.items, [{ text: "buy", done: false }, { text: "cook", done: true }]);
});

test("fenced code keeps its lines as they are, markdown and all", () => {
  const [c] = M.parse("```js\nconst a = **1**;\n\n# not a heading\n```\nafter");
  assert.deepStrictEqual(c, { t: "code", text: "const a = **1**;\n\n# not a heading" });
  assert.strictEqual(kinds("```\nunclosed"), "code");
});

test("a quote gathers its lines", () => {
  assert.deepStrictEqual(M.parse("> one\n> two\nthree")[0], { t: "quote", text: "one\ntwo" });
});

test("inline: code, bold, italic, links and bare URLs, in order", () => {
  const n = M.inline("Use `npm i` and **really** *do* it: [docs](https://x.dev) or https://y.dev/a.");
  assert.deepStrictEqual(n.map((x) => x.t), ["text", "code", "text", "bold", "text", "em", "text", "link", "text", "link", "text"]);
  assert.strictEqual(n[7].href, "https://x.dev");
  assert.strictEqual(n[9].href, "https://y.dev/a");
  assert.strictEqual(n[10].text, ".");
});

test("a link's address may hold brackets", () => {
  const [l] = M.inline("[Pie](https://en.wikipedia.org/wiki/Pie_(food))");
  assert.strictEqual(l.href, "https://en.wikipedia.org/wiki/Pie_(food)");
  const n = M.inline("[x](javascript:alert(1)).");
  assert.strictEqual(n[0].href, "javascript:alert(1)");
  assert.strictEqual(n[1].text, ".");
});

test("snake_case words aren't italic, and code isn't read inside", () => {
  assert.deepStrictEqual(M.inline("my_var_name").map((x) => x.t), ["text"]);
  assert.deepStrictEqual(M.inline("`**x**`"), [{ t: "code", text: "**x**" }]);
});

test("only http(s) and mailto links are ever links", () => {
  assert.strictEqual(M.safeHref("https://a.b"), "https://a.b");
  assert.strictEqual(M.safeHref("mailto:a@b.c"), "mailto:a@b.c");
  assert.strictEqual(M.safeHref("javascript:alert(1)"), null);
  assert.strictEqual(M.safeHref("data:text/html,x"), null);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) console.log("Some tests FAILED — see above.");
