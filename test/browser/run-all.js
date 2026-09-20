// Runs every browser suite against a server this file starts, so the whole
// thing is one command with no ports to remember:
//
//   node test/browser/run-all.js            all suites
//   node test/browser/run-all.js fxrate     just one (substring match)
//
// Each suite is a child process: a crash takes that suite down and not the
// run, and a suite left mid-run by a timeout can't poison the next one's
// localStorage, which is exactly how the older ad-hoc scripts used to drift.
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HERE = __dirname;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};
const SUITE_TIMEOUT_MS = 240000;

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
      const file = path.join(ROOT, rel);
      // Nothing outside the repo, however the URL is spelled.
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404).end("not found"); return; }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(body);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function runSuite(name, url) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, name + ".js")], {
      env: { ...process.env, LIFELOG_URL: url },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, SUITE_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      const m = /(\d+) passed, (\d+) failed/.exec(out);
      resolve({
        name, code, out,
        pass: m ? +m[1] : 0,
        fail: m ? +m[2] : (code === 0 ? 0 : 1),
        ran: !!m,
      });
    });
  });
}

(async () => {
  const filter = process.argv[2];
  const suites = fs.readdirSync(HERE)
    .filter((f) => f.endsWith(".js") && !["run-all.js", "harness.js"].includes(f))
    .map((f) => f.replace(/\.js$/, ""))
    .filter((n) => !filter || n.includes(filter))
    .sort();

  if (!suites.length) { console.error("No suites match " + filter); process.exit(2); }

  const { server, port } = await serve();
  const url = "http://127.0.0.1:" + port;
  let pass = 0, fail = 0;
  const broken = [];

  for (const name of suites) {
    const r = await runSuite(name, url);
    pass += r.pass; fail += r.fail;
    const bad = r.fail > 0 || !r.ran;
    if (bad) broken.push(r);
    console.log(
      (bad ? "FAIL " : "ok   ") + name.padEnd(14) +
      (r.ran ? `${r.pass} passed, ${r.fail} failed` : `did not report (exit ${r.code})`)
    );
  }

  for (const r of broken) {
    console.log("\n--- " + r.name + " ---\n" + r.out.split("\n").filter((l) => /FAIL|errors:|Error|not found/.test(l)).join("\n"));
  }

  server.close();
  console.log(`\n${suites.length} suites: ${pass} passed, ${fail} failed`);
  process.exitCode = fail || broken.length ? 1 : 0;
})();
