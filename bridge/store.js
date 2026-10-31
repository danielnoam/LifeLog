// Where the bridge reads and writes LifeLog's data: the same lifelog.json the
// app syncs, in your GitHub data repo, or a local copy of it (a backup file,
// or a test).
//
// Config, first found wins for each key:
//   environment  LIFELOG_TOKEN, LIFELOG_REPO ("owner/repo"), LIFELOG_FILE_PATH,
//                LIFELOG_BRANCH, LIFELOG_LOCAL_FILE, LIFELOG_STATE_DIR
//   a JSON file  LIFELOG_CONFIG, else ~/.lifelog-bridge/config.json:
//                { "token", "owner", "repo", "path", "branch", "localFile", "stateDir" }
//                (the shape Telemachus already keeps in ~/.odysseus/lifelog.json)
//   a setup link LIFELOG_LINK, or "link" in that file: the app's setup
//                link (Settings → Sync → Add another device), which carries the same connection
//
// A save goes on top of the latest file, never over it: if anything saved in
// between (a phone, the web app), GitHub refuses the stale sha and the change
// is applied again to the newer file. The app then folds it in with its
// three-way merge, the way it takes another device's save.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

class SetupError extends Error {}

// The app's setup link, from Storage.setupFragment(): #t=token&r=&p=&b=&o=,
// or the older #setup=<base64url JSON>. Only the fragment matters.
function parseSetupLink(link) {
  const h = String(link || "").trim().replace(/^[^#]*#/, "");
  if (!h) return {};
  const legacy = h.match(/(?:^|&)setup=([A-Za-z0-9\-_]+)/);
  if (legacy) {
    let c;
    try { c = JSON.parse(Buffer.from(legacy[1], "base64url").toString("utf8")); } catch (e) { c = null; }
    if (!c || !c.t) throw new SetupError("That LifeLog setup link is damaged. Copy it again from the app.");
    return { token: c.t, owner: c.o || "", repo: c.r || "", path: c.p || "", branch: c.b || "" };
  }
  const p = new URLSearchParams(h);
  if (!p.get("t")) throw new SetupError("That isn't a LifeLog setup link (it has no token). Copy it from Settings → Sync → Add another device in the app.");
  return { token: p.get("t"), owner: p.get("o") || "", repo: p.get("r") || "", path: p.get("p") || "", branch: p.get("b") || "" };
}

function readConfig() {
  const file = process.env.LIFELOG_CONFIG || path.join(os.homedir(), ".lifelog-bridge", "config.json");
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {
    if (e.code !== "ENOENT") throw new SetupError(file + " isn't valid JSON: " + e.message);
  }
  const env = process.env;
  const link = parseSetupLink(env.LIFELOG_LINK || cfg.link);
  const [envOwner, envRepo] = String(env.LIFELOG_REPO || "").split("/");
  return {
    token: (env.LIFELOG_TOKEN || cfg.token || link.token || "").trim(),
    owner: envOwner || cfg.owner || link.owner || "",
    repo: envRepo || cfg.repo || link.repo || "lifelog-data",
    path: env.LIFELOG_FILE_PATH || cfg.path || link.path || "lifelog.json",
    branch: env.LIFELOG_BRANCH || cfg.branch || link.branch || "",
    localFile: env.LIFELOG_LOCAL_FILE || cfg.localFile || "",
    stateDir: env.LIFELOG_STATE_DIR || cfg.stateDir || path.join(os.homedir(), ".lifelog-bridge"),
    configFile: file,
  };
}

const API = "https://api.github.com";

async function gh(cfg, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: {
      Authorization: "Bearer " + cfg.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "LifeLog-bridge",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new SetupError("GitHub refused the LifeLog token (expired, or no access to " + cfg.owner + "/" + cfg.repo + ").");
  }
  if (res.status === 404) throw new SetupError("GitHub has no " + url.replace(/\?.*/, "") + " on " + cfg.branch + ".");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("GitHub " + res.status + ": " + (json.message || res.statusText));
    err.status = res.status;
    throw err;
  }
  return json;
}

// Pictures in notes (0.297.0), as the app keeps them: images/<id> on the
// data repo's own "lifelog-images" branch, added in one commit on top of the
// branch (made, with no history, when there isn't one yet).
const IMG_BRANCH = "lifelog-images";
const IMG_README = "Pictures in LifeLog notes, one file each under images/. The app writes this branch; Settings → Notes → Clean up pictures replaces it with one commit of the pictures still in use.\n";
function githubImages(cfg, prepare) {
  const repo = () => `/repos/${cfg.owner}/${cfg.repo}`;
  async function head() {
    try {
      const ref = await gh(cfg, "GET", `${repo()}/git/ref/heads/${IMG_BRANCH}`);
      const c = await gh(cfg, "GET", `${repo()}/git/commits/${ref.object.sha}`);
      return { commit: ref.object.sha, tree: c.tree.sha };
    } catch (e) {
      if (e instanceof SetupError && /has no/.test(e.message)) return null;
      throw e;
    }
  }
  return {
    async get(id) {
      await prepare();
      const res = await fetch(`${API}${repo()}/contents/images/${encodeURIComponent(id)}?ref=${IMG_BRANCH}`, {
        headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "LifeLog-bridge" },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("GitHub " + res.status + " reading image " + id);
      return Buffer.from(await res.arrayBuffer());
    },
    async put(list) {
      await prepare();
      const entries = [];
      for (const it of list) {
        const b = await gh(cfg, "POST", `${repo()}/git/blobs`, { content: it.bytes.toString("base64"), encoding: "base64" });
        entries.push({ path: "images/" + it.id, mode: "100644", type: "blob", sha: b.sha });
      }
      const message = "Add " + list.length + (list.length === 1 ? " picture" : " pictures") + " (" + new Date().toISOString() + ")";
      for (let tries = 1; ; tries++) {
        const h = await head();
        try {
          if (!h) {
            const readme = await gh(cfg, "POST", `${repo()}/git/blobs`, { content: IMG_README, encoding: "utf-8" });
            const tree = await gh(cfg, "POST", `${repo()}/git/trees`, { tree: [{ path: "README.md", mode: "100644", type: "blob", sha: readme.sha }, ...entries] });
            const c = await gh(cfg, "POST", `${repo()}/git/commits`, { message, tree: tree.sha, parents: [] });
            await gh(cfg, "POST", `${repo()}/git/refs`, { ref: "refs/heads/" + IMG_BRANCH, sha: c.sha });
          } else {
            const tree = await gh(cfg, "POST", `${repo()}/git/trees`, { base_tree: h.tree, tree: entries });
            const c = await gh(cfg, "POST", `${repo()}/git/commits`, { message, tree: tree.sha, parents: [h.commit] });
            await gh(cfg, "PATCH", `${repo()}/git/refs/heads/${IMG_BRANCH}`, { sha: c.sha, force: false });
          }
          return;
        } catch (e) {
          if (e.status !== 422 || tries >= 3) throw e; // another device moved the branch meanwhile
        }
      }
    },
  };
}

// `file` is another file in the data folder (boards.json beside
// lifelog.json): written compact, as the app writes it, and read as `empty`
// when it doesn't exist yet. Its version is then null, which a write takes as
// "create".
function githubStore(cfg, file, empty) {
  let ready = null;
  const prepare = () => (ready = ready || (async () => {
    if (!cfg.owner) cfg.owner = (await gh(cfg, "GET", "/user")).login;
    if (!cfg.branch) cfg.branch = (await gh(cfg, "GET", `/repos/${cfg.owner}/${cfg.repo}`)).default_branch;
  })().catch((e) => { ready = null; throw e; }));
  const repoPath = file ? cfg.path.replace(/[^/]*$/, "") + file : cfg.path;
  const filePath = () => `/repos/${cfg.owner}/${cfg.repo}/contents/${repoPath.split("/").map(encodeURIComponent).join("/")}`;
  return {
    where: () => `GitHub ${cfg.owner || "?"}/${cfg.repo}/${repoPath}`,
    sibling: (name, emptyDoc) => githubStore(cfg, name, emptyDoc),
    images: githubImages(cfg, prepare),
    async read() {
      await prepare();
      let meta;
      try { meta = await gh(cfg, "GET", filePath() + "?ref=" + encodeURIComponent(cfg.branch)); } catch (e) {
        if (empty && e instanceof SetupError && /has no/.test(e.message)) return { data: structuredClone(empty), version: null };
        throw e;
      }
      // Over 1MB the contents API leaves the content out; the blob has it.
      const b64 = meta.content || (await gh(cfg, "GET", `/repos/${cfg.owner}/${cfg.repo}/git/blobs/${meta.sha}`)).content;
      return { data: JSON.parse(Buffer.from(b64, "base64").toString("utf8")), version: meta.sha };
    },
    async write(data, version, message) {
      try {
        await gh(cfg, "PUT", filePath(), {
          message,
          // lifelog.json pretty, as the app writes it, so the repo's diffs
          // stay readable; boards.json compact, as the app writes it.
          content: Buffer.from(file ? JSON.stringify(data) : JSON.stringify(data, null, 2), "utf8").toString("base64"),
          branch: cfg.branch,
          ...(version ? { sha: version } : {}),
        });
        return true;
      } catch (e) {
        if (e.status === 409 || e.status === 422) return false; // saved in between
        throw e;
      }
    },
  };
}

function fileStore(cfg, name, empty) {
  const file = name ? path.join(path.dirname(path.resolve(cfg.localFile)), name) : path.resolve(cfg.localFile);
  const stamp = () => { try { return String(fs.statSync(file).mtimeMs); } catch (e) { return ""; } };
  return {
    where: () => file,
    sibling: (n, emptyDoc) => fileStore(cfg, n, emptyDoc),
    // A local copy keeps its pictures in images/ beside it.
    images: {
      async get(id) {
        try { return fs.readFileSync(path.join(path.dirname(file), "images", path.basename(id))); } catch (e) { return null; }
      },
      async put(list) {
        const dir = path.join(path.dirname(file), "images");
        fs.mkdirSync(dir, { recursive: true });
        for (const it of list) fs.writeFileSync(path.join(dir, path.basename(it.id)), it.bytes);
      },
    },
    async read() {
      if (empty && !fs.existsSync(file)) return { data: structuredClone(empty), version: "" };
      try { return { data: JSON.parse(fs.readFileSync(file, "utf8")), version: stamp() }; } catch (e) {
        throw new SetupError("Couldn't read " + file + ": " + e.message);
      }
    },
    async write(data, version) {
      if (stamp() !== version) return false;
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, name ? JSON.stringify(data) : JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
      return true;
    },
  };
}

function openStore(cfg = readConfig()) {
  if (cfg.localFile) return fileStore(cfg);
  if (!cfg.token) {
    throw new SetupError("LifeLog isn't connected: give the bridge a GitHub token (LIFELOG_TOKEN, or \"token\" in "
      + cfg.configFile + ") with read and write access to your data repo, or a LIFELOG_LOCAL_FILE.");
  }
  return githubStore(cfg);
}

// The last changes the bridge made, so one can be undone. On this machine
// only; the data file itself carries no trace of who changed what.
function undoLog(cfg) {
  const file = path.join(cfg.stateDir, "undo.json");
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return []; } };
  const write = (stack) => {
    // The stack holds copies of what changed (note text, amounts), so it is
    // the user's to read and nobody else's on a shared machine.
    fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(stack.slice(-30)), { mode: 0o600 });
  };
  return {
    push(rec) { write([...read(), rec]); },
    peek() { const s = read(); return s[s.length - 1] || null; },
    drop() { const s = read(); s.pop(); write(s); },
  };
}

module.exports = { readConfig, parseSetupLink, openStore, undoLog, SetupError };
