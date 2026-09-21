// Serves the repo on a free port and runs a perf script against it, so the
// measurements are one command like the suites are.
//
//   node test/perf/serve-and-run.js [name]    (default: rowcount)
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  });
});

server.listen(0, "127.0.0.1", () => {
  const url = "http://127.0.0.1:" + server.address().port;
  const name = (process.argv[2] || "rowcount").replace(/\.js$/, "");
  const child = spawn(process.execPath, [path.join(__dirname, name + ".js")], {
    env: { ...process.env, LIFELOG_URL: url }, stdio: "inherit",
  });
  child.on("close", (code) => { server.close(); process.exitCode = code; });
});
