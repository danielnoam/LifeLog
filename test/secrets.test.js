// The keys to other accounts stay out of an export and come back on a
// restore: `node test/secrets.test.js`. storage.js keeps one list of where
// they are (SECRET_FIELDS); before 2026-11-25 two functions each spelled the
// connections out, and a new one's token went out in Export JSON unless
// someone remembered both.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.window = {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
require("../src/storage.js");
require("../src/trello.js");
require("../src/waypage.js");
require("../src/health.js");
const S = window.LifeLogStorage;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { process.exitCode = 1; console.log("  FAIL - " + name + "\n    " + String(e.message).replace(/\n/g, "\n    ")); }
}

const full = () => ({
  entries: [{ id: "e1" }],
  settings: {
    currency: "ILS",
    mediaKeys: { rawg: "R", tmdb: "T", igdbSecret: "IS" },
    steam: { steamId: "765", apiKey: "SK" },
    anilist: { userName: "dan", token: "AT" },
    stremio: { email: "a@b.c", authKey: "AK", upNext: { on: true, id: "abc", key: "UK" } },
    waypage: { repo: "o/r", token: "WT" },
    trello: { key: "public", token: "TT", lists: [] },
    hardcover: { category: "Books" },
  },
});

test("an export has every key blanked and everything else as it was", () => {
  const doc = full(), out = S.withoutSecrets(doc);
  assert.deepStrictEqual(out.settings, {
    currency: "ILS",
    mediaKeys: { rawg: "", tmdb: "", igdbSecret: "" },
    steam: { steamId: "765", apiKey: "" },
    anilist: { userName: "dan", token: "" },
    stremio: { email: "a@b.c", authKey: "", upNext: { on: true, id: "abc", key: "" } },
    waypage: { repo: "o/r", token: "" },
    trello: { key: "public", token: "", lists: [] },
    hardcover: { category: "Books" },
  });
  assert.strictEqual(out.entries, doc.entries);
  assert.deepStrictEqual(doc, full(), "the document it was given is untouched");
});

test("a connection that isn't set up isn't invented, and odd shapes pass through", () => {
  assert.deepStrictEqual(S.withoutSecrets({ settings: { currency: "USD" } }), { settings: { currency: "USD" } });
  assert.deepStrictEqual(S.withoutSecrets({ settings: { stremio: { email: "x" }, steam: "odd" } }).settings, { stremio: { email: "x", authKey: "" }, steam: "odd" });
  assert.strictEqual(S.withoutSecrets(null), null);
  const bare = { entries: [] };
  assert.strictEqual(S.withoutSecrets(bare), bare);
});

test("a restore puts this device's keys back where the backup has none", () => {
  const backup = S.withoutSecrets(full());
  assert.deepStrictEqual(S.withSecretsFrom(backup, full()), full());
});

test("a restore keeps a key the backup does have, and brings back a missing connection", () => {
  const backup = { settings: { mediaKeys: { rawg: "OLD" }, anilist: { userName: "old", token: "OLDT" }, stremio: { email: "old" } } };
  const out = S.withSecretsFrom(backup, full()).settings;
  assert.deepStrictEqual(out.mediaKeys, { rawg: "OLD", tmdb: "T", igdbSecret: "IS" });
  assert.deepStrictEqual(out.anilist, { userName: "old", token: "OLDT" });
  assert.deepStrictEqual(out.steam, { apiKey: "SK" }, "only its key, never the rest of this device's settings");
  assert.deepStrictEqual(out.stremio, { email: "old", authKey: "AK" }, "the add-on's key only where the backup has the add-on");
  assert.deepStrictEqual(out.trello, { token: "TT" });
  assert.strictEqual(out.hardcover, undefined);
  assert.deepStrictEqual(backup.settings.stremio, { email: "old" }, "the backup it was given is untouched");
});

// Every setting the app can hold: app.js's defaults, and the connections
// that clean their own. A new connection with its own cleaner is added here.
function everySetting() {
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
  const m = /const DEFAULT_SETTINGS = (\{.*?\}); \/\//.exec(app);
  assert.ok(m, "app.js's DEFAULT_SETTINGS has moved; point this test at it");
  const settings = new Function("return " + m[1])();
  settings.trello = window.LifeLogTrello.cleanConfig({});
  settings.waypage = window.LifeLogWaypage.cleanConfig({});
  settings.healthConnect = window.LifeLogHealth.cleanConfig({});
  settings.stremio = { ...settings.stremio, upNext: { on: false, id: "", key: "" } };
  return settings;
}
// Named like a key but safe to export, each with why.
const NOT_SECRET = [
  "trello.key", // Trello's API key names the app, and Trello calls it public; the token is the secret.
];

test("every setting named like a key is on the list", () => {
  const listed = (p) => S.SECRET_FIELDS.some((f) => f.length === p.length && f.every((k, i) => k === "*" || k === p[i]));
  const missing = [];
  (function walk(o, at) {
    for (const [k, v] of Object.entries(o)) {
      const p = [...at, k];
      if (v && typeof v === "object" && !Array.isArray(v)) { walk(v, p); continue; }
      if (!/token|secret|password|apikey|authkey|^key$/i.test(k)) continue;
      if (!listed(p) && !NOT_SECRET.includes(p.join("."))) missing.push(p.join("."));
    }
  })(everySetting(), []);
  assert.deepStrictEqual(missing, [], "add to SECRET_FIELDS in storage.js, or to NOT_SECRET here with why");
  for (const f of S.SECRET_FIELDS) assert.ok(f[f.length - 1] === "*" || !NOT_SECRET.includes(f.join(".")), f.join("."));
});

console.log("\n" + passed + " test(s) passed.");
