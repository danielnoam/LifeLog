// Zero-dependency tests for the browser's proxy — `node test/proxy.test.js`.
//
// proxy/worker.js only runs on Cloudflare, so a mistake in it shows up as
// every "needs the proxy" key reading Error 502 in a browser (the IGDB route
// once broke them all). This runs the worker here with fetch stubbed, and
// checks it answers every route the phone and computer apps answer
// themselves (upstreamFor in src/platform.js): a source added to one and not
// the other works in the app and fails in a browser.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const workerSrc = fs.readFileSync(path.join(ROOT, "proxy", "worker.js"), "utf8");
const platformSrc = fs.readFileSync(path.join(ROOT, "src", "platform.js"), "utf8");

const sent = [];
const sandbox = {
  Request, Response, Headers, URL, URLSearchParams, console,
  fetch: async (url, init) => {
    sent.push({ url: String(url), init: init || {} });
    return new Response('{"ok":true}', { status: 200, headers: { Location: "" } });
  },
  module: { exports: {} },
};
vm.runInNewContext(workerSrc.replace(/^export default/m, "module.exports ="), sandbox);
const worker = sandbox.module.exports;

let passed = 0;
let queue = Promise.resolve();
function test(name, fn) {
  queue = queue.then(fn).then(
    () => { passed++; console.log("  ok - " + name); },
    (e) => { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; },
  );
}
const call = (p, init) => worker.fetch(new Request("https://proxy.example" + p, init));

const routes = [
  ["/steam-wishlist/76561198000000000", "api.steampowered.com"],
  ["/steam-owned/76561198000000000?key=ABCDEF0123456789", "api.steampowered.com"],
  ["/steam-appdetails/570", "store.steampowered.com"],
  ["/steamgriddb/search/autocomplete/portal", "www.steamgriddb.com"],
  ["/gg-deals?ids=570&key=k&region=us", "api.gg.deals"],
  ["/tiingo-prices/SPY?startDate=2026-01-01", "api.tiingo.com"],
  ["/tiingo-meta/SPY", "api.tiingo.com"],
  ["/tiingo-search?query=spy", "api.tiingo.com"],
  ["/tiingo-iex/SPY", "api.tiingo.com"],
  ["/igdb/games?q=fields%20name%3B", "api.igdb.com"],
  ["/hardcover?q=%7B%22query%22%3A%22%7Bme%7Bid%7D%7D%22%7D", "api.hardcover.app"],
  ["/augsteam-app/570", "api.augmentedsteam.com"],
];

console.log("\nthe worker");

for (const [p, host] of routes) {
  test(p.split("?")[0].replace(/\/[^/]*$/, (m) => (/\d|a{5}/.test(m) ? "/…" : m)) + " reaches " + host, async () => {
    sent.length = 0;
    const res = await call(p);
    assert.strictEqual(res.status, 200, await res.text());
    assert.strictEqual(new URL(sent[0].url).host, host);
    assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), "*");
  });
}

test("/igdb-token asks Twitch with the id and secret it was given", async () => {
  sent.length = 0;
  const res = await call("/igdb-token", { headers: { "Client-ID": "abcdefgh12", Authorization: "Secret s3cretvalue" } });
  assert.strictEqual(res.status, 200);
  assert.match(sent[0].url, /^https:\/\/id\.twitch\.tv\/oauth2\/token\?client_id=abcdefgh12&client_secret=s3cretvalue/);
  assert.strictEqual(sent[0].init.method, "POST");
});

test("/stremio/<method> passes a POST's body on to Stremio", async () => {
  sent.length = 0;
  const body = JSON.stringify({ type: "Auth", email: "a@b.c", password: "x" });
  const res = await call("/stremio/login", { method: "POST", body, headers: { "Content-Type": "application/json" } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(sent[0].url, "https://api.strem.io/api/login");
  assert.strictEqual(sent[0].init.method, "POST");
  assert.strictEqual(sent[0].init.body, body);
});

test("/stremio passes a big add-on list on whole", async () => {
  sent.length = 0;
  const addons = Array.from({ length: 40 }, (_, i) => ({ transportUrl: "https://a" + i + ".example/manifest.json", manifest: { id: "a" + i, description: "x".repeat(1500) } }));
  const body = JSON.stringify({ type: "AddonCollectionSet", authKey: "K", addons });
  assert.ok(body.length > 50000);
  await call("/stremio/addonCollectionSet", { method: "POST", body, headers: { "Content-Type": "application/json" } });
  assert.strictEqual(sent[0].init.body, body);
});

test("/stremio only takes the methods LifeLog uses", async () => {
  assert.strictEqual((await call("/stremio/datastorePut", { method: "POST", body: "{}" })).status, 404);
  assert.strictEqual((await call("/stremio/addonCollectionSet", { method: "POST", body: "{}" })).status, 200);
});

test("a browser's preflight may send a POST", async () => {
  const res = await call("/stremio/login", { method: "OPTIONS" });
  assert.match(res.headers.get("Access-Control-Allow-Methods"), /POST/);
});

// A KV namespace as Cloudflare's binding behaves, in memory.
const kvStore = new Map();
const KV = { get: async (k, t) => (kvStore.has(k) ? (t === "json" ? JSON.parse(kvStore.get(k)) : kvStore.get(k)) : null), put: async (k, v) => { kvStore.set(k, v); } };
const callEnv = (p, init, env) => worker.fetch(new Request("https://proxy.example" + p, init), env);
const UP = "/upnext/" + "a1".repeat(12), KEY = "b2".repeat(16);

test("/upnext answers 501 until a KV namespace is bound", async () => {
  assert.strictEqual((await callEnv(UP + "/manifest.json", {}, {})).status, 501);
});

test("/upnext keeps the row LifeLog posts and Stremio reads it back", async () => {
  const env = { UPNEXT: KV };
  const post = (key, body) => callEnv(UP, { method: "POST", body: JSON.stringify(body), headers: { "X-LifeLog-Key": key } }, env);
  const row = { movie: [{ id: "tt0113277", name: "Heat", poster: "https://image.tmdb.org/t/p/w342/x.jpg" }, { id: "nope", name: "Bad" }], series: [{ id: "tt0903747", name: "Breaking Bad", poster: "javascript:alert(1)" }] };
  assert.strictEqual((await post("short", row)).status, 401);
  assert.strictEqual((await post(KEY, row)).status, 200);
  assert.strictEqual((await post("c3".repeat(16), row)).status, 403, "another key can't overwrite it");
  const man = await (await callEnv(UP + "/manifest.json", {}, env)).json();
  assert.deepStrictEqual(man.catalogs.map((c) => c.type), ["movie", "series"]);
  const movies = await (await callEnv(UP + "/catalog/movie/lifelog-upnext.json", {}, env)).json();
  assert.deepStrictEqual(movies.metas, [{ id: "tt0113277", type: "movie", name: "Heat", poster: "https://image.tmdb.org/t/p/w342/x.jpg" }]);
  const shows = await (await callEnv(UP + "/catalog/series/lifelog-upnext.json", {}, env)).json();
  assert.deepStrictEqual(shows.metas, [{ id: "tt0903747", type: "series", name: "Breaking Bad" }], "only https posters");
  assert.ok(!JSON.stringify(shows).includes(KEY), "the key is never read back");
  assert.strictEqual((await callEnv("/upnext/short/manifest.json", {}, env)).status, 404);
});

test("/upnext serves three add-ons: the Backlog, its starred ones, and what's in progress", async () => {
  const env = { UPNEXT: KV };
  const row = { movie: [{ id: "tt0113277", name: "Heat", star: true }, { id: "tt0083190", name: "Thief" }], series: [],
    progress: { movie: [], series: [{ id: "tt0903747", name: "Breaking Bad" }] } };
  assert.strictEqual((await callEnv(UP, { method: "POST", body: JSON.stringify(row), headers: { "X-LifeLog-Key": KEY } }, env)).status, 200);
  const get = async (p) => (await callEnv(UP + p, {}, env)).json();
  const [all, fav, prog] = await Promise.all([get("/manifest.json"), get("/starred/manifest.json"), get("/progress/manifest.json")]);
  assert.deepStrictEqual([all.name, fav.name, prog.name], ["LifeLog: Backlog", "LifeLog: Backlog favourites", "LifeLog: In progress"]);
  assert.strictEqual(all.id, "app.lifelog.upnext.a1a1a1a1", "the first add-on keeps its id, so an install of Up next carries on");
  assert.strictEqual(new Set([all.id, fav.id, prog.id]).size, 3);
  assert.deepStrictEqual((await get("/catalog/movie/lifelog-upnext.json")).metas.map((m) => m.id), ["tt0113277", "tt0083190"]);
  const starred = (await get("/starred/catalog/movie/lifelog-starred.json")).metas;
  assert.deepStrictEqual(starred, [{ id: "tt0113277", type: "movie", name: "Heat" }], "starred only, without the star");
  assert.deepStrictEqual((await get("/progress/catalog/series/lifelog-progress.json")).metas.map((m) => m.id), ["tt0903747"]);
  assert.strictEqual((await callEnv(UP + "/starred/catalog/movie/lifelog-progress.json", {}, env)).status, 404, "a list's catalog only under its own address");
  assert.strictEqual((await callEnv(UP + "/starred", { method: "POST", body: "{}", headers: { "X-LifeLog-Key": KEY } }, env)).status, 404, "the row is posted in one place");
});

test("anything else is not found", async () => {
  assert.strictEqual((await call("/https://example.com/")).status, 404);
});

test("it answers every route the apps answer themselves", () => {
  const upstream = platformSrc.slice(platformSrc.indexOf("function upstreamFor"), platformSrc.indexOf("function tiingoQuery"));
  const names = (src) => new Set([
    ...[...src.matchAll(/\^\\\/([a-z][a-z-]*)/g)].map((m) => m[1]),
    ...[...src.matchAll(/pathname (?:===|\.startsWith\() ?"\/([a-z][a-z-]*)/g)].map((m) => m[1]),
  ]);
  const app = names(upstream), proxy = names(workerSrc.slice(workerSrc.indexOf("export default")));
  assert.ok(app.size >= 10, "upstreamFor's routes weren't found: " + [...app]);
  const missing = [...app].filter((n) => !proxy.has(n));
  assert.deepStrictEqual(missing, [], "add these to proxy/worker.js: " + missing.join(", "));
});

queue.then(() => console.log(`\n${passed} passed`));
