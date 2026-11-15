// keel: the GitHub calls an app's sync makes against its private data
// repo, which Waypage and LifeLog each wrote for themselves. Only the
// transport: what goes in the repo, and how two devices' changes merge,
// stay in each app.
//
//   const gh = Keel.github.client(() => cfg); // { token, owner, repo, branch }
//   const got = await gh.getJson("library.json"); // { data, sha } or null
//   await gh.saveFile("library.json", { text, sha, message, onConflict });
//
// Every failure is an Error with `kind`: "offline" (GitHub never answered),
// "auth" (the token was refused), "ratelimit", "server" (5xx) or "other",
// plus `status` and GitHub's own `detail`. Each app words them itself.
(function () {
  const API = "https://api.github.com";

  // base64 that survives text that isn't ASCII.
  const b64encode = (s) => btoa(unescape(encodeURIComponent(s)));
  const b64decode = (s) => decodeURIComponent(escape(atob(String(s).replace(/\s/g, ""))));
  function bytesToBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function base64ToBytes(b64) {
    const s = atob(String(b64).replace(/\s/g, ""));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // The sha GitHub gives a file's bytes, worked out here (a tree made with
  // inline text doesn't say it). null where there's no SubtleCrypto.
  async function blobSha(bytes) {
    if (typeof bytes === "string") bytes = new TextEncoder().encode(bytes);
    if (!(globalThis.crypto && crypto.subtle)) return null;
    const head = new TextEncoder().encode("blob " + bytes.length + "\0");
    const all = new Uint8Array(head.length + bytes.length);
    all.set(head);
    all.set(bytes, head.length);
    const h = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
    return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function httpError(status, text, response) {
    let detail = "";
    try { detail = JSON.parse(text).message || ""; } catch (e) { detail = String(text || ""); }
    const e = new Error("GitHub " + status + ": " + String(text || "").slice(0, 200));
    e.status = status;
    e.detail = detail.slice(0, 160);
    const limited = /rate limit/i.test(detail) ||
      !!(response && response.headers && response.headers.get("x-ratelimit-remaining") === "0");
    e.kind = status === 401 ? "auth"
      : (status === 403 || status === 429) ? (limited ? "ratelimit" : "auth")
      : status >= 500 ? "server"
      : "other";
    return e;
  }
  function offlineError(cause) {
    const e = new Error("GitHub didn't answer: " + ((cause && cause.message) || cause));
    e.kind = "offline";
    e.status = 0;
    e.detail = "";
    return e;
  }
  const conflict = (e) => e && (e.status === 409 || e.status === 422);

  // `cfg` is the connection, or a function giving it, so a client made once
  // follows a token or branch that changes later.
  function client(cfg, { fetch: doFetch = (...a) => globalThis.fetch(...a), api = API } = {}) {
    const c = () => (typeof cfg === "function" ? cfg() : cfg);
    const repoUrl = (rest) => api + "/repos/" + c().owner + "/" + c().repo + "/" + rest;
    const contents = (path) => repoUrl("contents/" + path.split("/").map(encodeURIComponent).join("/"));
    const ref = (r) => "?ref=" + encodeURIComponent(r || c().branch);
    const headers = (extra) => Object.assign({
      Authorization: "Bearer " + c().token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }, extra || {});

    // A Response; throws only when GitHub never answered.
    async function request(url, { method = "GET", body, accept, etag } = {}) {
      const h = headers(accept ? { Accept: accept } : null);
      if (body !== undefined) h["Content-Type"] = "application/json";
      if (etag) h["If-None-Match"] = etag;
      try {
        return await doFetch(url, { method, headers: h, cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (e) {
        throw offlineError(e);
      }
    }
    async function ok(r) {
      if (r.ok) return r;
      let text = "";
      try { text = await r.text(); } catch (e) { try { text = JSON.stringify(await r.json()); } catch (e2) { /* no body */ } }
      throw httpError(r.status, text, r);
    }
    // JSON from anywhere under the repo (`rest` like "git/trees"), null for
    // a GET that's 404.
    async function json(method, rest, body) {
      const r = await request(repoUrl(rest), { method, body });
      if (method === "GET" && r.status === 404) return null;
      return (await ok(r)).json();
    }

    async function me() {
      return (await (await ok(await request(api + "/user"))).json()).login;
    }
    // The repo's details (private, default_branch, size), or null.
    async function repoInfo(owner = c().owner, repo = c().repo) {
      const r = await request(api + "/repos/" + owner + "/" + repo);
      if (r.status === 404) return null;
      return (await ok(r)).json();
    }
    async function createRepo(name, description) {
      const r = await request(api + "/user/repos", { method: "POST", body: { name, private: true, auto_init: true, description } });
      return (await ok(r)).json();
    }

    async function blob(sha) {
      return (await (await ok(await request(repoUrl("git/blobs/" + encodeURIComponent(sha))))).json()).content;
    }
    // { text, sha } or null. Past 1 MB the contents API sends no content,
    // so the bytes come as the blob its sha names (same version, same sha).
    // With `etag`, an unchanged file is { notModified: true }, which GitHub
    // doesn't count against the rate limit.
    async function getFile(path, { ref: r, etag } = {}) {
      const res = await request(contents(path) + ref(r), { accept: "application/vnd.github.object+json", etag });
      if (res.status === 304) return { notModified: true };
      if (res.status === 404) return null;
      const j = await (await ok(res)).json();
      const b64 = j.content ? j.content : j.size ? await blob(j.sha) : "";
      return { text: b64 ? b64decode(b64) : "", sha: j.sha, etag: (res.headers && res.headers.get && res.headers.get("ETag")) || "" };
    }
    // Just the file's sha (no bytes, no blob past 1 MB), or null.
    async function shaOf(path, { ref: r } = {}) {
      const res = await request(contents(path) + ref(r), { accept: "application/vnd.github.object+json" });
      if (res.status === 404) return null;
      return (await (await ok(res)).json()).sha;
    }
    // { data, sha } or null; an empty file is null too.
    async function getJson(path, opts) {
      const f = await getFile(path, opts);
      if (!f || f.notModified) return f;
      if (!f.text) return null;
      return { data: JSON.parse(f.text), sha: f.sha, etag: f.etag };
    }
    // The raw file, `as` "text", "bytes" (a Uint8Array) or "blob"; null
    // when there's none.
    async function getRaw(path, { ref: r, as = "text" } = {}) {
      const res = await request(contents(path) + ref(r), { accept: "application/vnd.github.raw" });
      if (res.status === 404) return null;
      await ok(res);
      return as === "bytes" ? new Uint8Array(await res.arrayBuffer()) : as === "blob" ? res.blob() : res.text();
    }
    // The file's sha without its bytes (from a listing of its folder), or
    // undefined when that didn't answer.
    async function peekSha(path, { ref: r } = {}) {
      const slash = path.lastIndexOf("/");
      const dir = slash < 0 ? "" : path.slice(0, slash);
      try {
        const res = await request(repoUrl("contents" + (dir ? "/" + dir : "")) + ref(r));
        if (!res.ok) return undefined;
        const list = await res.json();
        if (!Array.isArray(list)) return undefined;
        const hit = list.find((f) => f.path === path);
        return hit ? hit.sha : undefined;
      } catch (e) { return undefined; }
    }

    // Writes one file (one commit) and gives its new sha. `text` or `bytes`;
    // `sha` is the version this replaces, none for a new file.
    async function putFile(path, { text, bytes, sha, message, branch }) {
      const body = { message: message || "Update " + path, content: bytes ? bytesToBase64(bytes) : b64encode(text), branch: branch || c().branch };
      if (sha) body.sha = sha;
      const r = await request(contents(path), { method: "PUT", body });
      return (await (await ok(r)).json()).content.sha;
    }
    // putFile that copes with a stale sha (another device wrote first): the
    // file as it is now goes to `onConflict(current)`, which gives what to
    // write instead (a merge), or the same text is written over it when
    // there's no onConflict. Up to `tries` times. Gives { sha, conflicted }.
    async function saveFile(path, { text, bytes, sha, message, onConflict, tries = 3 }) {
      try {
        return { sha: await putFile(path, { text, bytes, sha, message }), conflicted: false };
      } catch (e) {
        if (!conflict(e)) throw e;
      }
      for (let n = 1; ; n++) {
        const cur = onConflict ? await getFile(path) : { sha: await shaOf(path) };
        const next = onConflict ? await onConflict(cur) : (bytes ? { bytes } : { text });
        const out = typeof next === "string" ? { text: next } : next;
        try {
          return { sha: await putFile(path, { ...out, sha: (cur && cur.sha) || null, message }), conflicted: true };
        } catch (e) {
          if (!conflict(e) || n >= tries) throw e;
        }
      }
    }
    // Removes a file; one already gone (or moved on) is no error.
    async function removeFile(path, sha, message) {
      const r = await request(contents(path), { method: "DELETE", body: { message: message || "Remove " + path, sha, branch: c().branch } });
      if (!r.ok && r.status !== 404 && !conflict(r)) await ok(r);
    }

    async function createBlob(content, encoding = "utf-8") {
      return (await json("POST", "git/blobs", { content: typeof content === "string" ? content : bytesToBase64(content), encoding: typeof content === "string" ? encoding : "base64" })).sha;
    }
    // One commit of many files on `branch` (the repo's by default): each of
    // `files` is { path, text } or { path, sha } (sha null removes it). A
    // branch that moved meanwhile gets the tree remade on its new head. A
    // missing branch is an error, or, with `root` (a function giving more
    // { path, sha } entries, asked only then), is started as a commit of
    // root + files with no parent.
    // `beforeTry` runs before each try (to stop a sync someone paused).
    async function commitFiles(files, message, { branch = c().branch, root, beforeTry, tries = 4 } = {}) {
      const tree = files.map((f) => (f.text != null ? { path: f.path, mode: "100644", type: "blob", content: f.text }
        : { path: f.path, mode: "100644", type: "blob", sha: f.sha }));
      for (let n = 1; ; n++) {
        if (beforeTry) await beforeTry();
        const head = await json("GET", "git/ref/heads/" + encodeURIComponent(branch));
        if (!head && !root) throw httpError(404, "no branch " + branch);
        try {
          if (!head) {
            const made = await json("POST", "git/trees", { tree: (await root()).map((f) => ({ path: f.path, mode: "100644", type: "blob", sha: f.sha })).concat(tree) });
            const commit = await json("POST", "git/commits", { message, tree: made.sha, parents: [] });
            await json("POST", "git/refs", { ref: "refs/heads/" + branch, sha: commit.sha });
            return commit.sha;
          }
          const base = (await json("GET", "git/commits/" + head.object.sha)).tree.sha;
          const made = await json("POST", "git/trees", { base_tree: base, tree });
          const commit = await json("POST", "git/commits", { message, tree: made.sha, parents: [head.object.sha] });
          await json("PATCH", "git/refs/heads/" + encodeURIComponent(branch), { sha: commit.sha, force: false });
          return commit.sha;
        } catch (e) {
          if (e.status !== 422 || n >= tries) throw e;
        }
      }
    }

    // Recent commits that touched `path`, newest first.
    async function listCommits(path, { perPage = 50, ref: r } = {}) {
      const list = await json("GET", "commits?path=" + encodeURIComponent(path) + "&sha=" + encodeURIComponent(r || c().branch) + "&per_page=" + perPage);
      return (list || []).map((x) => ({
        sha: x.sha,
        date: (x.commit.author && x.commit.author.date) || (x.commit.committer && x.commit.committer.date) || null,
        message: (x.commit.message || "").split("\n")[0],
        parent: (x.parents && x.parents[0] && x.parents[0].sha) || null,
      }));
    }

    return {
      request, json, me, repoInfo, createRepo, getFile, getJson, getRaw, shaOf, peekSha,
      putFile, saveFile, removeFile, createBlob, commitFiles, listCommits, blob,
    };
  }

  window.Keel = window.Keel || {};
  window.Keel.github = { client, httpError, b64encode, b64decode, bytesToBase64, base64ToBytes, blobSha, API };
})();
