// Zero-dependency tests for the Windows and Linux app — `node test/desktop.test.js`.
//
// The app itself is only built in CI (desktop.yml), but what can quietly go
// wrong without it can be checked here: what rings and when (src/desktop.js),
// the desktop copy of the files (tools/build-www.js --desktop), the release
// file names and the updater's latest.json (tools/desktop-files.js), and the
// shell's config agreeing with all three.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

global.window = {};
global.localStorage = { getItem: () => null, setItem: () => {} };
// desktop.js reads the platform once, at load; the tick test fills in tauri.
const platform = { desktop: true, tauri: null };
global.window.LifeLogPlatform = platform;
require("../src/desktop.js");
const { dueNow, keptSince, notifyId, tick, start, prefs, setPref } = global.window.LifeLogDesktop;
const { build, desktopIndexHtml } = require("../tools/build-www.js");
const { collect, manifest } = require("../tools/desktop-files.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}
const ROOT = path.resolve(__dirname, "..");

console.log("\nwhat rings");

const habit = { id: "h1", name: "Read", period: "day" };
const times = { h1: "21:00" };
const timeOf = (id) => times[id] || "";

test("a habit still to do rings at its time, and not before", () => {
  assert.deepStrictEqual(dueNow({ today: "2026-11-04", now: "20:59", habits: [habit], timeOf }), []);
  const due = dueNow({ today: "2026-11-04", now: "21:00", habits: [habit], timeOf });
  assert.strictEqual(due.length, 1);
  assert.strictEqual(due[0].title, "Read");
  assert.strictEqual(due[0].body, "Still to do today");
});

test("it rings once a day", () => {
  const fired = { "habit:h1:2026-11-04": "2026-11-04" };
  assert.deepStrictEqual(dueNow({ today: "2026-11-04", now: "21:10", habits: [habit], timeOf, fired }), []);
  assert.strictEqual(dueNow({ today: "2026-11-05", now: "21:10", habits: [habit], timeOf, fired }).length, 1);
});

test("a reminder missed by over an hour is let go", () => {
  assert.strictEqual(dueNow({ today: "2026-11-04", now: "22:00", habits: [habit], timeOf }).length, 1);
  assert.deepStrictEqual(dueNow({ today: "2026-11-04", now: "22:01", habits: [habit], timeOf }), []);
});

test("a weekly goal says the week", () => {
  const due = dueNow({ today: "2026-11-04", now: "21:00", habits: [{ ...habit, period: "week" }], timeOf });
  assert.strictEqual(due[0].body, "Still to do this week");
});

test("a habit with no time never rings", () => {
  assert.deepStrictEqual(dueNow({ today: "2026-11-04", now: "21:00", habits: [{ id: "h2", name: "Run" }], timeOf }), []);
});

test("a heads-up rings on its day from its time, up to 12 hours late, once", () => {
  const a = { id: "charge-r1-2026-11-05", day: "2026-11-04", time: "09:00", title: "Netflix charges tomorrow", body: "₪50" };
  assert.deepStrictEqual(dueNow({ today: "2026-11-04", now: "08:59", alerts: [a] }), []);
  assert.strictEqual(dueNow({ today: "2026-11-04", now: "09:00", alerts: [a] })[0].title, "Netflix charges tomorrow");
  assert.strictEqual(dueNow({ today: "2026-11-04", now: "21:00", alerts: [a] }).length, 1);
  assert.deepStrictEqual(dueNow({ today: "2026-11-04", now: "21:01", alerts: [a] }), []);
  assert.deepStrictEqual(dueNow({ today: "2026-11-05", now: "09:00", alerts: [a] }), []);
  assert.deepStrictEqual(dueNow({ today: "2026-11-04", now: "10:00", alerts: [a], fired: { ["alert:" + a.id]: "2026-11-04" } }), []);
});

test("a click goes where the phone's tap goes: the habit, or the heads-up's own action", () => {
  assert.strictEqual(dueNow({ today: "2026-11-04", now: "21:00", habits: [habit], timeOf })[0].action, "open-habit:h1");
  const a = { id: "release-2026-11-04", day: "2026-11-04", time: "09:00", title: "Out today", body: "Kestrel", action: "open-upcoming" };
  assert.strictEqual(dueNow({ today: "2026-11-04", now: "09:00", alerts: [a] })[0].action, "open-upcoming");
});

test("each notification gets a steady positive 31-bit id", () => {
  const a = notifyId("habit:h1:2026-11-04"), b = notifyId("alert:charge-r1-2026-11-05");
  assert.ok(Number.isInteger(a) && a > 0 && a <= 0x7fffffff);
  assert.strictEqual(a, notifyId("habit:h1:2026-11-04"));
  assert.notStrictEqual(a, b);
});

test("the shell routes a clicked notification through runAction", () => {
  const rs = fs.readFileSync(path.join(ROOT, "src-tauri/src/main.rs"), "utf8");
  assert.ok(/notification\(\)\.on_action/.test(rs));
  assert.ok(/extra\(\)\.get\("action"\)/.test(rs));
});

test("Settings → Desktop: closing keeps it in the tray and a login start stays there, until changed", () => {
  const store = {};
  const real = global.localStorage;
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  assert.deepStrictEqual(prefs(), { loginOpens: "tray", closeToTray: true });
  setPref("closeToTray", false);
  setPref("loginOpens", "window");
  assert.deepStrictEqual(prefs(), { loginOpens: "window", closeToTray: false });
  store["lifelog-desktop-prefs-v1"] = "not json";
  assert.deepStrictEqual(prefs(), { loginOpens: "tray", closeToTray: true });
  global.localStorage = real;
});

test("a reminder whose habit is kept since is found to clear, today's only", () => {
  const fired = { "habit:h1:2026-11-04": "2026-11-04", "habit:h2:2026-11-04": "2026-11-04", "habit:h3:2026-11-03": "2026-11-03", "alert:x": "2026-11-04" };
  assert.deepStrictEqual(keptSince({ today: "2026-11-04", fired, left: [{ id: "h2" }] }), ["habit:h1:2026-11-04"]);
  assert.deepStrictEqual(keptSince({ today: "2026-11-04", fired, left: [{ id: "h1" }, { id: "h2" }] }), []);
});

test("a habit's reminder offers Done; a heads-up doesn't", () => {
  const due = dueNow({ today: "2026-11-04", now: "21:00", habits: [habit], timeOf });
  assert.strictEqual(due[0].habitId, "h1");
  const alert = dueNow({ today: "2026-11-04", now: "09:00", alerts: [{ id: "a", day: "2026-11-04", time: "09:00", title: "Rent", body: "", action: "open-finance" }] });
  assert.strictEqual(alert[0].habitId, undefined);
});

test("the shell has the commands the page calls, and closing reads the setting", () => {
  const rs = fs.readFileSync(path.join(ROOT, "src-tauri/src/main.rs"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, "src/desktop.js"), "utf8");
  for (const cmd of [...js.matchAll(/invoke\("([a-z_]+)"/g)].map((m) => m[1])) {
    assert.ok(new RegExp("generate_handler!\\[[^\\]]*\\b" + cmd + "\\b").test(rs), cmd + " is not registered");
  }
  assert.ok(/CloseToTray>\(\)\.0\.load/.test(rs));
});

async function asyncTests() {
  // A habit reminder pulls from GitHub first; ticked meanwhile, it stays quiet.
  const sent = [];
  const realDate = global.Date;
  const fixed = new realDate(2026, 10, 4, 21, 0, 0);
  global.Date = class extends realDate { constructor(...a) { super(...(a.length ? a : [fixed.getTime()])); } static now() { return fixed.getTime(); } };
  const data = { habits: [{ id: "h1", name: "Read" }] };
  let left = true;
  global.window.LifeLogHabits = { leftToDo: () => ({ groups: left ? [{ period: "day", items: [{ habit: data.habits[0] }] }] : [] }) };
  global.window.LifeLogReminders = { isOn: () => true, remindAt: () => "21:00" };
  platform.tauri = { notification: { sendNotification: (n) => sent.push(n) } };
  const ctx = { state: { data }, runAction: () => {}, refresh: async () => { left = false; } };
  const si = global.setInterval, st = global.setTimeout;
  global.setInterval = () => 0; global.setTimeout = () => 0;
  start(ctx);
  global.setInterval = si; global.setTimeout = st;
  await tick();
  assert.strictEqual(sent.length, 0, "ticked on the phone: no ring");
  ctx.refresh = async () => {};
  left = true;
  await tick();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].extra.action, "open-habit:h1");
  assert.strictEqual(sent[0].id, notifyId("habit:h1:2026-11-04"));
  passed++; console.log("  ok - a reminder checks GitHub before it rings");

  // Windows: the shell's own toast, with Done, and cleared once kept.
  const calls = [];
  platform.tauri = { core: { invoke: async (cmd, args) => { calls.push([cmd, args]); } }, notification: { sendNotification: (n) => sent.push(n) } };
  const fired = {};
  global.localStorage = { getItem: () => JSON.stringify(fired), setItem: (k, v) => Object.assign(fired, JSON.parse(v)) };
  await tick();
  const toast = calls.find((c) => c[0] === "toast");
  assert.ok(toast, "rang through the shell");
  assert.strictEqual(sent.length, 1, "not through the plugin too");
  assert.deepStrictEqual(toast[1].buttons, [["Done", "done-habit:h1"]]);
  assert.strictEqual(toast[1].action, "open-habit:h1");
  assert.strictEqual(toast[1].tag, String(notifyId("habit:h1:2026-11-04")));
  left = false;
  await tick();
  await tick();
  const clears = calls.filter((c) => c[0] === "clear_toast");
  assert.deepStrictEqual(clears.map((c) => c[1].tag), [toast[1].tag], "cleared once");
  global.Date = realDate;
  passed++; console.log("  ok - on Windows a reminder is the shell's toast, with Done, cleared once kept");
}

console.log("\nthe desktop copy");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lifelog-desktop-"));
const out = path.join(tmp, "www-desktop");
const result = build(out, ROOT, true);
const html = fs.readFileSync(path.join(out, "index.html"), "utf8");

test("its index.html lets Tauri's calls through the CSP and nothing else changes", () => {
  const web = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(html, /connect-src [^;"]* ipc: http:\/\/ipc\.localhost/);
  assert.strictEqual(html.replace(" ipc: http://ipc.localhost", ""), web);
});

test("it isn't marked as a phone", () => {
  assert.doesNotMatch(html, /<html[^>]*class="[^"]*\bnative\b/);
  assert.doesNotMatch(html, /viewport-fit=cover/);
});

test("its app-build.json says desktop", () => {
  assert.strictEqual(result.info.desktop, true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, "app-build.json"), "utf8")).desktop, true);
});

test("an index.html without connect-src fails the build rather than shipping a broken app", () => {
  assert.throws(() => desktopIndexHtml("<html></html>"), /connect-src/);
});

test("the phones' copy has no desktop flag", () => {
  const phone = build(path.join(tmp, "www"), ROOT, false);
  assert.strictEqual(phone.info.desktop, undefined);
});

console.log("\nthe release files");

test("tauri's outputs get fixed names, with their signatures", () => {
  const bundle = path.join(tmp, "bundle");
  fs.mkdirSync(path.join(bundle, "nsis"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "nsis", "LifeLog_0.303.2_x64-setup.exe"), "exe");
  fs.writeFileSync(path.join(bundle, "nsis", "LifeLog_0.303.2_x64-setup.exe.sig"), "sig");
  const copied = collect("windows", path.join(tmp, "out"), bundle);
  assert.deepStrictEqual(copied, ["LifeLog-setup.exe", "LifeLog-setup.exe.sig"]);
  assert.strictEqual(fs.readFileSync(path.join(tmp, "out", "LifeLog-setup.exe"), "utf8"), "exe");
});

test("a missing installer fails the build", () => {
  assert.throws(() => collect("linux", path.join(tmp, "out2"), path.join(tmp, "nothing")), /expected one/);
});

test("latest.json points each system at its signed file in this version's release", () => {
  const sigs = path.join(tmp, "sigs");
  fs.mkdirSync(sigs);
  fs.writeFileSync(path.join(sigs, "LifeLog-setup.exe.sig"), "WIN\n");
  fs.writeFileSync(path.join(sigs, "LifeLog.AppImage.sig"), "LIN");
  const m = manifest("0.304.0", sigs, { repo: "o/r", date: "2026-11-04T00:00:00.000Z" });
  assert.strictEqual(m.version, "0.304.0");
  assert.deepStrictEqual(Object.keys(m.platforms).sort(), ["linux-x86_64", "linux-x86_64-appimage", "windows-x86_64", "windows-x86_64-nsis"]);
  assert.strictEqual(m.platforms["windows-x86_64"].signature, "WIN");
  assert.strictEqual(m.platforms["linux-x86_64"].url, "https://github.com/o/r/releases/download/app-v0.304.0/LifeLog.AppImage");
});

console.log("\nthe shell");

const conf = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
const caps = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri", "capabilities", "default.json"), "utf8"));

test("it makes no MSI, whose version can't pass 0.255", () => {
  assert.ok(!conf.bundle.targets.includes("msi"));
  assert.match(fs.readFileSync(path.join(ROOT, ".github", "workflows", "desktop.yml"), "utf8"), /"bundles":"nsis"/);
});

test("it bundles the desktop copy, built by the same tool", () => {
  assert.strictEqual(conf.build.frontendDist, "../www-desktop");
  assert.match(conf.build.beforeBuildCommand, /build-www\.js www-desktop --desktop/);
});

test("it has the phones' app id, so it's one app in the data's eyes", () => {
  const cap = JSON.parse(fs.readFileSync(path.join(ROOT, "capacitor.config.json"), "utf8"));
  assert.strictEqual(conf.identifier, cap.appId);
});

test("Ctrl+scroll and Ctrl +/- zoom the window, as in a browser", () => {
  assert.strictEqual(conf.app.windows[0].zoomHotkeysEnabled, true);
});

test("it leaves the page's own CSP in charge", () => {
  assert.strictEqual(conf.app.security.csp, null);
  assert.strictEqual(conf.app.withGlobalTauri, true);
});

test("its HTTP may reach only the hosts the no-proxy routes map to", () => {
  const http = caps.permissions.find((p) => typeof p === "object" && p.identifier === "http:default");
  const hosts = http.allow.map((a) => new URL(a.url.replace("*", "x")).host).sort();
  const platform = fs.readFileSync(path.join(ROOT, "src", "platform.js"), "utf8");
  const upstream = platform.slice(platform.indexOf("function upstreamFor"), platform.indexOf("function steamProxy"));
  const mapped = [...new Set([...upstream.matchAll(/"https:\/\/([^/"]+)\//g)].map((m) => m[1]))].sort();
  assert.deepStrictEqual(hosts.filter((h) => h !== "goo.gl"), mapped);
  assert.ok(caps.permissions.every((p) => typeof p !== "string" || !/^fs:(default|allow-read|allow-remove|scope)/.test(p)));
});

test("the updater reads latest.json from the latest release", () => {
  assert.deepStrictEqual(conf.plugins.updater.endpoints, ["https://github.com/danielnoam/LifeLog/releases/latest/download/latest.json"]);
});

fs.rmSync(tmp, { recursive: true, force: true });
asyncTests().catch((e) => { console.error("  FAIL - a reminder checks GitHub before it rings"); console.error("    " + e.message); process.exitCode = 1; })
  .then(() => console.log(`\n${passed} passed`));
