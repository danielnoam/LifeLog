// Runs every test/*.test.js file in this directory in one shot. Each file
// already reports its own ok/FAIL lines and sets process.exitCode on
// failure via its own `test()` helper (see any *.test.js for the pattern).
// Spawned as a separate process per file, not require()'d in-process —
// each file resets `global.window = {}` and requires its own src/*.js
// modules from scratch (see e.g. app.test.js's header comment), and
// Node's require() cache would silently no-op a second require() of the
// same src file within one process, leaving that later file's fresh
// `window` never actually populated.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

let anyFailed = false;
const failedFiles = [];
for (const f of files) {
  console.log(`\n=== ${f} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  if (result.status !== 0) { anyFailed = true; failedFiles.push(f); }
}
// A file that crashes before its first test prints a stack trace and no
// FAIL line at all, so the verdict names every file that didn't finish clean.
console.log(anyFailed ? `\nFAILED: ${failedFiles.join(", ")}` : `\nAll ${files.length} test files passed.`);
if (anyFailed) process.exitCode = 1;
