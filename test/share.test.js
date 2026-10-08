// Zero-dependency tests for src/share.js's reading of a share —
// `node test/share.test.js`. What arrives from the Share sheet, in the
// shapes the common apps send it, and where each goes.
const assert = require("assert");
global.window = {};
const S = require("../src/share.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}
const q = (o) => new URLSearchParams(o).toString();

test("a Letterboxd link alone: the title from the slug, the year dropped", () => {
  const s = S.parse(q({ url: "https://letterboxd.com/film/heat-1995/" }));
  assert.deepStrictEqual(s, { title: "Heat", text: "", url: "https://letterboxd.com/film/heat-1995/", kind: "media" });
});

test("the Letterboxd app shares text with a short link in it", () => {
  const s = S.parse(q({ text: "Heat (1995) https://boxd.it/29t2" }));
  assert.strictEqual(s.kind, "media");
  assert.strictEqual(s.title, "Heat");
  assert.strictEqual(s.url, "https://boxd.it/29t2");
});

test("Chrome sends the page title as the subject and the sharing site's name after it", () => {
  const s = S.parse(q({ title: "Heat (1995) - IMDb", text: "https://www.imdb.com/title/tt0113277/" }));
  assert.strictEqual(s.title, "Heat");
  assert.strictEqual(s.kind, "media");
});

test("Steam's link spells the game in the path", () => {
  assert.strictEqual(S.parse(q({ text: "https://store.steampowered.com/app/1245620/ELDEN_RING/" })).title, "ELDEN RING");
  assert.strictEqual(S.parse(q({ url: "https://myanimelist.net/anime/5114/Fullmetal_Alchemist__Brotherhood" })).title, "Fullmetal Alchemist Brotherhood");
});

test("YouTube shares the title on one line and the link on the next", () => {
  const s = S.parse(q({ text: "My Video Title\nhttps://youtu.be/dQw4w9WgXcQ" }));
  assert.strictEqual(s.title, "My Video Title");
  assert.strictEqual(s.text, "");
  assert.strictEqual(s.kind, "media");
});

test("a Google Maps link is a place, however it's spelled", () => {
  for (const u of ["https://maps.app.goo.gl/abc123", "https://goo.gl/maps/abc", "https://www.google.com/maps/place/Lisbon/@38.7,-9.1,12z", "https://maps.google.co.il/maps?q=tel+aviv"]) {
    assert.strictEqual(S.parse(q({ url: u })).kind, "place", u);
  }
});

test("plain text has no link, and keeps the whole text for a note", () => {
  const s = S.parse(q({ text: "Call the dentist\nabout the thing on Tuesday" }));
  assert.strictEqual(s.kind, "text");
  assert.strictEqual(s.title, "Call the dentist");
  assert.strictEqual(s.text, "Call the dentist\nabout the thing on Tuesday");
});

test("any other site is a link, named by its title or failing that its host", () => {
  assert.strictEqual(S.parse(q({ title: "Some article", url: "https://example.com/post" })).kind, "link");
  assert.strictEqual(S.parse(q({ url: "https://example.com/post" })).title, "example.com");
  assert.strictEqual(S.parse(q({ url: "javascript:alert(1)", text: "x" })).url, "", "only http(s) links count");
});

test("an empty share is nothing", () => {
  const s = S.parse("");
  assert.deepStrictEqual([s.title, s.text, s.url], ["", "", ""]);
});

console.log(`\n${passed} test(s) passed.`);
