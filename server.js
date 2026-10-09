// Tiny zero-dependency static file server for LifeLog.
// Run with `node server.js` (or double-click start.cmd) then open http://localhost:5173
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5173;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split("?")[0]); }
  catch (e) { res.writeHead(400); res.end("Bad request"); return; }
  if (urlPath === "/") urlPath = "/index.html";

  // Only files inside this folder: a bare prefix check also let through a
  // sibling folder whose name starts the same way (LifeLog-backup).
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found: " + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

// This machine only: the folder holds the repo and, for anyone who kept
// one, a lifelog.json, so it is not for the whole network to read.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  LifeLog running →  http://localhost:${PORT}\n`);
});
