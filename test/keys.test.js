// Zero-dependency tests for src/keys.js (Settings → Keyboard) —
// `node test/keys.test.js`.
const assert = require("assert");
global.window = {};
const K = require("../src/keys.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok - " + name); }
  catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
}
let settings = {};
let views = ["notes", "timeline", "home", "backlog", "finance", "travel"];
K.bind(() => settings, () => views);
const key = (code, mods = {}) => ({ code, key: "", ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift });
const hit = (e) => { const m = K.match(e); return m && (m.other ? m.id + "+other" : m.id); };

test("defaults match the keys the app always had", () => {
  settings = {};
  assert.strictEqual(hit(key("KeyN")), "add");
  assert.strictEqual(hit(key("KeyF")), "search");
  assert.strictEqual(hit(key("Slash")), "search");
  assert.strictEqual(hit(key("Tab")), "settings");
  assert.strictEqual(hit(key("Slash", { shift: true })), "help");
  assert.strictEqual(hit(key("KeyE", { ctrl: true })), "noteMode");
  assert.strictEqual(hit(key("KeyE", { meta: true })), "noteMode", "Cmd counts as Ctrl");
  assert.strictEqual(hit(key("Digit1")), "tab:notes");
  assert.strictEqual(hit(key("Digit5")), "tab:finance");
  assert.strictEqual(hit(key("Digit2", { shift: true })), "tab:timeline+other");
  assert.strictEqual(hit(key("Digit9")), null);
  assert.strictEqual(hit(key("KeyF", { ctrl: true })), null, "Ctrl+F stays the browser's");
  assert.strictEqual(hit(key("ShiftLeft", { shift: true })), null);
});

test("? typed where a layout puts it elsewhere still opens the list", () => {
  settings = {};
  assert.strictEqual(hit({ ...key("Digit7", { shift: true }), key: "?" }), "help");
});

test("tab defaults follow the bar", () => {
  settings = {};
  views = ["home", "notes"];
  assert.strictEqual(hit(key("Digit1")), "tab:home");
  assert.deepStrictEqual(K.keysFor("tab:finance"), []);
  views = ["notes", "timeline", "home", "backlog", "finance", "travel"];
});

test("assigning a taken key moves it and only stores what changed", () => {
  settings = {};
  const taken = K.assign("settings", "KeyF", "Tab");
  assert.deepStrictEqual(taken, ["search"]);
  assert.deepStrictEqual(K.keysFor("settings"), ["KeyF"]);
  assert.deepStrictEqual(K.keysFor("search"), ["Slash"]);
  assert.deepStrictEqual(settings.keys, { binds: { search: ["Slash"], settings: ["KeyF"] } });
  assert.strictEqual(hit(key("KeyF")), "settings");
  assert.strictEqual(hit(key("Tab")), null);
  assert.strictEqual(K.changedCount(), 2);
});

test("a key you give an action beats a tab's place number", () => {
  settings = {};
  K.assign("add", "Digit3", null);
  assert.strictEqual(hit(key("Digit3")), "add");
  assert.deepStrictEqual(K.keysFor("tab:home"), [], "the tab lost it when it moved");
});

test("removing, resetting and Reset all", () => {
  settings = {};
  K.setKeys("tab:finance", []);
  assert.strictEqual(hit(key("Digit5")), null);
  assert.ok(!K.isDefault("tab:finance"));
  K.reset("tab:finance");
  assert.strictEqual(hit(key("Digit5")), "tab:finance");
  assert.strictEqual(settings.keys, undefined, "nothing left to store");
  K.setKeys("search", ["KeyS"]);
  K.setOtherMode(false);
  K.setHints(false);
  assert.strictEqual(hit(key("Digit2", { shift: true })), null);
  assert.strictEqual(K.changedCount(), 3);
  K.resetAll();
  assert.strictEqual(settings.keys, undefined);
  assert.ok(K.otherModeOn() && K.hintsOn());
});

test("setting a list back to the default drops the override", () => {
  settings = {};
  K.setKeys("search", ["KeyF"]);
  K.setKeys("search", ["KeyF", "Slash"]);
  assert.strictEqual(settings.keys, undefined);
});

test("clean() keeps only real actions and combos, two at most", () => {
  const c = K.clean({ binds: { search: ["KeyF", "KeyF", "bad key", "Ctrl+KeyK", "KeyJ"], nope: ["KeyA"], "tab:home": "x", "tab:notes": [] }, otherMode: false, hints: true });
  assert.deepStrictEqual(c, { binds: { search: ["KeyF", "Ctrl+KeyK"], "tab:notes": [] }, otherMode: false });
  assert.deepStrictEqual(K.clean(null), {});
});

test("plain keys stand down in a text field, Ctrl and Alt ones don't", () => {
  const input = { tagName: "INPUT", type: "text" };
  const box = { tagName: "INPUT", type: "checkbox" };
  assert.ok(K.blockedWhileTyping("KeyN", input));
  assert.ok(!K.blockedWhileTyping("KeyN", box));
  assert.ok(!K.blockedWhileTyping("Ctrl+KeyE", input));
  assert.ok(!K.blockedWhileTyping("Alt+KeyN", { tagName: "TEXTAREA" }));
});

test("labels read as printed on the keys", () => {
  assert.deepStrictEqual(K.parts("Ctrl+KeyE"), ["Ctrl", "E"]);
  assert.deepStrictEqual(K.parts("Shift+Slash"), ["?"]);
  assert.strictEqual(K.label("Ctrl+Shift+Digit3"), "Ctrl + Shift + 3");
  assert.strictEqual(K.label("ArrowUp"), "↑");
  assert.strictEqual(K.label("Comma"), ",");
});

test("board tools keep their letters, by the physical key", () => {
  settings = {};
  const tool = (e) => K.matchBoard(e);
  assert.strictEqual(tool(key("KeyV")), "select");
  assert.strictEqual(tool(key("KeyP")), "pen");
  assert.strictEqual(tool({ ...key("KeyP"), key: "פ" }), "pen", "a Hebrew layout still finds it");
  assert.strictEqual(tool(key("KeyI")), "image");
  assert.strictEqual(tool(key("KeyN")), null);
  assert.strictEqual(tool(key("KeyP", { ctrl: true })), null);
  assert.strictEqual(K.boardKeyLabel("ellipse"), "O");
});

test("a board tool only takes keys from other board tools", () => {
  settings = {};
  assert.deepStrictEqual(K.assign("board:pen", "KeyN"), [], "N for Add entry is elsewhere, so nothing moves");
  assert.deepStrictEqual(K.keysFor("add"), ["KeyN"]);
  assert.strictEqual(K.matchBoard(key("KeyN")), "pen");
  assert.strictEqual(hit(key("KeyN")), "add", "outside a board N still adds");
  assert.deepStrictEqual(K.assign("board:pen", "KeyE", "KeyP"), ["board:eraser"]);
  assert.deepStrictEqual(K.keysFor("board:eraser"), []);
  assert.deepStrictEqual(K.assign("search", "KeyV", "KeyF"), [], "an app key leaves board tools alone");
  assert.deepStrictEqual(K.keysFor("board:select"), ["KeyV"]);
  assert.ok(K.changedCount() >= 3);
  K.resetAll();
  assert.strictEqual(settings.keys, undefined);
  assert.strictEqual(K.matchBoard(key("KeyE")), "eraser");
});

test("clean() keeps board tool keys", () => {
  assert.deepStrictEqual(K.clean({ binds: { "board:pen": ["KeyB"], "board:nope": ["KeyQ"] } }), { binds: { "board:pen": ["KeyB"] } });
});

test("the board's own keys are fixed", () => {
  for (const c of ["Space", "Delete", "Digit0", "Ctrl+KeyZ", "Ctrl+KeyA", "Escape"]) assert.ok(K.BOARD_FIXED[c], c);
  for (const a of K.BOARD_ACTIONS) for (const c of a.defaults) assert.ok(!K.BOARD_FIXED[c], a.id);
});

console.log(`\n${passed} test(s) passed.`);
