// Shared plumbing for the browser suites.
//
// Playwright is not a dependency of this project — it is whatever the machine
// happens to have. The suites are worth keeping in the repo anyway: several
// of them exist because they caught a bug that no unit test could (a
// reconcile key collision, a CSS animation outranking a state class, a toast
// contradicting the status line next to it). Resolving it here rather than in
// fourteen files means one place to fix when a machine puts it somewhere new.
const path = require("path");

const CANDIDATES = [
  "playwright",
  "/opt/node22/lib/node_modules/playwright",
  "/usr/lib/node_modules/playwright",
  "/usr/local/lib/node_modules/playwright",
];

function loadPlaywright() {
  for (const id of CANDIDATES) {
    try { return require(id); } catch (e) { /* try the next one */ }
  }
  console.error(
    "\nPlaywright not found. These suites drive a real browser, so they need it:\n" +
    "  npm i -g playwright && npx playwright install chromium\n" +
    "Or set NODE_PATH to wherever it already lives. Looked in:\n  " +
    CANDIDATES.join("\n  ") + "\n"
  );
  process.exit(2);
}

const { chromium } = loadPlaywright();

// run-all.js serves the app and passes the port down. A suite run on its own
// falls back to the usual hand-started server.
const BASE = process.env.LIFELOG_URL || "http://localhost:5173";

// Every suite tallies the same way, so run-all can read the last line.
function tally() {
  let pass = 0, fail = 0;
  const check = (name, ok, extra) => {
    ok ? pass++ : fail++;
    console.log((ok ? "  ok   - " : "  FAIL - ") + name
      + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]"));
  };
  const done = (errs) => {
    console.log("\nerrors:", errs && errs.length ? errs : "none");
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail || (errs && errs.length) ? 1 : 0;
  };
  return { check, done, counts: () => ({ pass, fail }) };
}

const seed = (name) => require(path.join(__dirname, "seeds", name));

// Saves are coalesced (0.180.0): an edit reaches the cache at once and
// GitHub once edits settle, so a suite that checks what was sent waits for
// the status line to stop saying "Saving…" rather than guessing a delay.
async function settled(page, timeout = 8000) {
  await page.waitForTimeout(50);
  await page.waitForFunction(() => !document.querySelector(".storage-status.syncing"), null, { timeout });
}

module.exports = { chromium, BASE, tally, seed, settled };
