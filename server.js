// keel: a tiny zero-dependency static file server for the app in this
// folder. Run `node server.js` (or double-click start.cmd), then open
// http://localhost:5173. The app's name comes from keel.config.json.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5173;
const ROOT = __dirname;
let NAME = path.basename(ROOT);
try { NAME = JSON.parse(fs.readFileSync(path.join(ROOT, "keel.config.json"), "utf8")).name || NAME; } catch (e) { /* no config: the folder's name */ }

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split("?")[0]); }
  catch (e) { res.writeHead(400); res.end("Bad request"); return; }
  if (urlPath === "/") urlPath = "/index.html";

  // Only files inside this folder: a bare prefix check also let through a
  // sibling folder whose name starts the same way (app-backup).
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

// This machine only: the folder is the whole repo, and maybe someone's
// data file, so it is not for the rest of the network to read.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  ${NAME} running →  http://localhost:${PORT}\n`);
});
