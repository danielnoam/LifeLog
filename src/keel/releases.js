// keel: what an app knows about its own releases on GitHub, for its
// update check and its Test builds list. The bar, the screens and the
// download stay in each app.
//
//   const R = Keel.releases.create({ name: "Waypage", repo: () => build.repo, fetchText });
//   await R.latest();  // { version, notes } of the newest release, or null
//   await R.list();    // { stable, list: [test builds] }
//
// Releases are tagged app-v<x.y.z>. A test build is the pre-release
// test-<branch> (preview-<branch> before), whose notes start with
// "version:", "branch:", "commit:", "pr:" lines and whose assets are
// <name>.apk and <name>.ipa. All of it is public, so no token is sent.
//
// In a browser a test build is opened, not installed: open(p) puts it in
// the cache "<name>-preview" as preview.json, and the service worker
// (src/keel/sw-preview.js) serves that commit's files while it's there.
(function () {
  const API = "https://api.github.com/repos/";

  // a > b, for x.y.z versions.
  function newer(a, b) {
    const [x, y] = [a, b].map((v) => String(v).split(".").map(Number));
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }

  function notesOf(body) {
    const out = {};
    for (const line of String(body || "").split("\n")) {
      const m = /^(version|branch|commit|pr):\s*(\S+)/.exec(line);
      if (m) out[m[1]] = m[2];
      else if (!line.trim()) break;
    }
    return out;
  }

  // GitHub's releases list → { stable: "x.y.z" | null, list: [...] }, newest first.
  function parse(releases, name) {
    const all = (releases || []).filter((r) => r && !r.draft);
    const stable = all.find((r) => !r.prerelease && /^app-v\d+\.\d+\.\d+$/.test(r.tag_name));
    const list = all.filter((r) => r.prerelease && /^(test|preview)-/.test(r.tag_name)).map((r) => {
      const n = notesOf(r.body);
      const assets = (r.assets || []).map((a) => a.name);
      return {
        tag: r.tag_name, title: String(r.name || "").replace(/^(Test|Preview): /, "") || n.branch || r.tag_name,
        branch: n.branch || r.tag_name.replace(/^(test|preview)-/, ""), version: n.version || "", sha: n.commit || "", pr: n.pr || "",
        at: Date.parse(r.published_at || r.created_at) || 0,
        apk: assets.includes(name + ".apk"), ipa: assets.includes(name + ".ipa"),
      };
    }).sort((a, b) => b.at - a.at);
    return { stable: stable ? stable.tag_name.replace(/^app-v/, "") : null, list };
  }

  // The repo of a GitHub Pages copy (owner.github.io/repo/), or null.
  function webRepo() {
    const host = /^([^.]+)\.github\.io$/i.exec(location.hostname);
    const name = location.pathname.split("/")[1];
    return host && name ? host[1] + "/" + name : null;
  }

  async function plainFetch(url, opts = {}) {
    const res = await fetch(url, { cache: "no-store", headers: opts.headers || {} });
    return { status: res.status, text: await res.text() };
  }

  function create(o) {
    const NAME = o.name;
    const CACHE = NAME.toLowerCase() + "-preview";
    const get = o.fetchText || plainFetch;
    const repo = () => (o.repo && o.repo()) || webRepo();
    async function json(path) {
      const r = repo();
      if (!r) return null;
      const res = await get(API + r + path, { headers: { Accept: "application/vnd.github+json" } });
      if (res.status !== 200) throw new Error("HTTP " + res.status);
      return JSON.parse(res.text);
    }

    // The test build this browser is running: preview.json, or null.
    const running = typeof caches === "undefined" ? Promise.resolve(null)
      : caches.open(CACHE).then((c) => c.match("./preview.json")).then((r) => (r ? r.json() : null)).catch(() => null);

    return {
      cache: CACHE, running, repo,
      // { version, notes } of the latest release, or null when it isn't
      // one (no app-v tag). Throws when GitHub can't be reached.
      async latest() {
        const rel = await json("/releases/latest");
        const version = String((rel && rel.tag_name) || "").replace(/^app-v/, "");
        return /^\d+\.\d+\.\d+$/.test(version) ? { version, notes: String(rel.body || "") } : null;
      },
      async list() { return parse(await json("/releases?per_page=100&t=" + Date.now()), NAME); },
      // Whether this browser can open a test build: a Pages copy whose
      // service worker is running.
      get webReady() { return !!webRepo() && typeof caches !== "undefined" && !!(navigator.serviceWorker && navigator.serviceWorker.controller); },
      // Opens test build `p` in this browser. Resolves false if the cache
      // refused it; otherwise the page reloads.
      async open(p) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.filter((k) => k.startsWith(CACHE)).map((k) => caches.delete(k)));
          const c = await caches.open(CACHE);
          await c.put("./preview.json", new Response(JSON.stringify({ repo: webRepo(), sha: p.sha, title: p.title, pr: p.pr, branch: p.branch, tag: p.tag }),
            { headers: { "Content-Type": "application/json" } }));
        } catch (e) { return false; }
        location.replace(new URL("./", location.href).href);
        return true;
      },
      // Back to the released copy (the service worker drops the preview).
      back() { location.replace(new URL("./?release", location.href).href); },
      releaseUrl: (tag) => "https://github.com/" + repo() + "/releases/" + (tag ? "tag/" + tag : "latest"),
    };
  }

  window.Keel = window.Keel || {};
  window.Keel.releases = { create, newer, notesOf, parse, webRepo };
})();
