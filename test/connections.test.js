// Each connection hands connections.js one object from its own file:
// `node test/connections.test.js`. Before 2026-11-25 its status line, its
// "What comes in", its names for Restore settings and its checks were typed
// into connections.js, settings.js and app.js, so adding or removing one
// meant finding every spot.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.window = {};
const C = require("../src/connections.js");
for (const f of ["stremio", "hardcover", "waypage", "trello", "health", "letterboxd"]) require("../src/" + f + ".js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + String(e.message).replace(/\n/g, "\n    ")); }
}

const settings = {
  mediaKeys: { hardcover: "tok" },
  stremio: { authKey: "k", email: "a@b.c" },
  hardcover: { category: "Books", username: "dan", send: false },
  waypage: { repo: "o/r", token: "t", paused: true },
};
C.start({ state: { data: { settings } } });

test("the files that load without a browser have registered", () => {
  assert.deepStrictEqual(C.ids().sort(), ["hardcover", "health", "letterboxd", "stremio", "trello", "waypage"]);
});

test("a row's line comes from the connection's own file", () => {
  assert.strictEqual(C.status("stremio").text, "Signed in as a@b.c");
  assert.strictEqual(C.status("hardcover").text, "Books, read only · @dan");
  assert.deepStrictEqual(C.status("waypage"), { text: "Turned off", tone: "warn" });
  assert.strictEqual(C.status("letterboxd").text, "Diary and watchlist from an export");
  assert.deepStrictEqual(C.status("nothing"), { text: "" });
});

test("What comes in: each one's own default, and what was chosen", () => {
  assert.strictEqual(C.newMode("stremio"), "ask");
  settings.stremio.newMode = "none";
  assert.strictEqual(C.newMode("stremio"), "none");
  assert.ok(C.takes("hardcover", "read") && !C.sends("hardcover"));
});

test("a setting's name for Restore settings comes from its connection", () => {
  assert.strictEqual(C.label("stremio.authKey"), "Stremio sign-in key");
  assert.strictEqual(C.label("trello.token"), "Trello token");
  assert.strictEqual(C.label("importSkips.hardcover"), "Hardcover skips");
  assert.strictEqual(C.label("currency"), "");
});

test("opening runs every connection's check, and one that throws stops none", () => {
  const ran = [];
  C.register("first", { onOpen() { ran.push("first"); throw new Error("down"); } });
  C.register("second", { onOpen() { ran.push("second"); }, onFocus() { ran.push("second focus"); } });
  const realTimeout = global.setTimeout;
  let thrown = 0;
  global.setTimeout = () => { thrown++; };
  // The real ones would start polling; only these two are watched.
  for (const id of C.ids()) if (id !== "first" && id !== "second") C.register(id, { onOpen: null, onFocus: null });
  try { C.opened(); C.focused(); } finally { global.setTimeout = realTimeout; }
  assert.deepStrictEqual(ran, ["first", "second", "second focus"]);
  assert.strictEqual(thrown, 1, "the error is thrown on, for the error log");
});

// A connection is still named in app.js's normalize, which fails quietly
// when forgotten: the setting is dropped on the next sync. (Its keys are
// storage.js's SECRET_FIELDS, which test/secrets.test.js watches.)
test("every setting a connection names is one normalize keeps", () => {
  const m = /const KNOWN_SETTINGS_KEYS = new Set\(\[([\s\S]*?)\]\);/.exec(read("src/app.js"));
  assert.ok(m, "app.js's KNOWN_SETTINGS_KEYS has moved; point this test at it");
  const known = new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  const named = new Set();
  for (const f of fs.readdirSync(path.join(__dirname, "..", "src")).filter((x) => x.endsWith(".js"))) {
    const src = read("src/" + f);
    if (!/\.register\("/.test(src)) continue;
    for (const b of src.matchAll(/labels: \{([\s\S]*?)\n\s*\},/g)) for (const k of b[1].matchAll(/"([A-Za-z]+)\.[^"]+": i18n/g)) named.add(k[1]);
  }
  assert.ok(named.size >= 6, "found only " + [...named] + "; has the shape of labels changed?");
  assert.deepStrictEqual([...named].filter((k) => !known.has(k)), [], "add to KNOWN_SETTINGS_KEYS in app.js, or sync drops the setting");
});

test("no connection is spelled out in settings.js or connections.js any more", () => {
  const names = /\b(stremio|hardcover|anilist|trello|letterboxd)\b/i;
  const conn = read("src/connections.js").split("\n").filter((l) => !/^\s*\/\//.test(l) && names.test(l));
  assert.deepStrictEqual(conn, [], "connections.js: this belongs in the connection's own register()");
  assert.ok(!/LifeLog(Stremio|Hardcover|Waypage|Health|Trello)\.renderSettings/.test(read("src/settings.js")), "settings.js: renderAll() draws every connection's screen");
});

console.log("\n" + passed + " test(s) passed.");
