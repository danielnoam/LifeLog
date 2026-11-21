// keel: what an app knows about its own releases on GitHub, for its
// update check and its Test builds list. The bar, the screens and the
// download stay in each app.
//
//   const R = Keel.releases.create({ name: "Waypage", repo: () => build.repo, fetchText });
//   await R.latest();  // { version, notes } of the newest release, or null
//   await R.list();    // { stable, list: [test builds] }
//   await R.check(mine, "android");  // the update to offer on this device's channel, or null
//
// Releases are tagged app-v<x.y.z>. A test build is the pre-release
// test-<branch> (preview-<branch> before), whose notes start with
// "version:", "branch:", "commit:", "pr:" lines and whose assets are
// <name>.apk and <name>.ipa. All of it is public, so no token is sent.
//
// In a browser a test build is opened, not installed: open(p) puts it in
// the cache "<name>-preview" as preview.json, and the service worker
// (src/keel/sw-preview.js) serves that commit's files while it's there.
//
// Channels: "release" (the default) offers releases only. "unreleased"
// also offers the newest build of main, which isn't a release: the app's
// workflows build every merge to main, and the Pages deploy puts those
// files under <site>/unreleased/ with build.json (tools/unreleased.js),
// not on the Releases page. Hidden, not private: the repo is public, and
// anyone with the address can download them.
//
// The app's home, for a custom domain or a repo that moved: index.html
// may say <meta name="keel-site" content="https://example.com/app/"> and
// <meta name="keel-repo" content="owner/name">. The site is then where
// the unreleased builds are looked for, and a web copy away from
// github.io finds its repo there. Without them it's owner.github.io/repo/.
// Installed copies keep the index.html they were built with, so change
// these before the address changes, and ship a release with them.
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

  // <meta name="keel-<n>">'s content, or null.
  function meta(n) {
    try {
      const m = typeof document !== "undefined" && document.querySelector('meta[name="keel-' + n + '"]');
      const v = m && String(m.getAttribute("content") || "").trim();
      return v || null;
    } catch (e) { return null; }
  }

  // A web copy, not the files inside a phone or desktop app (Capacitor
  // and Tauri serve them from localhost).
  const onWeb = () => /^https?:$/.test(location.protocol || "https:") && !/(^|\.)localhost$/i.test(location.hostname);

  // The repo of a web copy: owner.github.io/repo/, or keel-repo on its own
  // domain. null otherwise.
  function webRepo() {
    const host = /^([^.]+)\.github\.io$/i.exec(location.hostname);
    const name = location.pathname.split("/")[1];
    if (host) return name ? host[1] + "/" + name : null;
    const r = meta("repo");
    return onWeb() && r && /^[\w.-]+\/[\w.-]+$/.test(r) ? r : null;
  }

  // keel-site, made to end in "/", or null.
  function metaSite() {
    const s = meta("site");
    return s && /^https:\/\/[^\s"'<>]+$/.test(s) ? s.replace(/\/?$/, "/") : null;
  }

  // The GitHub Pages site of a repo: owner.github.io/repo/.
  function siteOf(repo) {
    const [owner, name] = String(repo || "").split("/");
    return owner && name ? "https://" + owner.toLowerCase() + ".github.io/" + name + "/" : null;
  }

  // The update to offer, or null. `mine` is this build ({ version, sha, at }:
  // app-build.json's version, sha and builtAt), `rel` the latest release
  // ({ version }) or null, `u` the unreleased build for this device's kind
  // ({ version, sha, at, url }) or null. Releases come first: a newer
  // version is always offered. On "unreleased", a build of main from
  // another commit, built later than this one and not behind its version,
  // is offered too; the release it was cut from is offered over it.
  function pick(channel, mine, rel, u) {
    const v = (mine && mine.version) || "0.0.0";
    if (channel === "unreleased" && u && u.sha && u.url && u.sha !== (mine && mine.sha) && !newer(v, u.version)
      && (newer(u.version, v) || !(Date.parse(mine && mine.at) >= Date.parse(u.at)))
      && !(rel && newer(rel.version, u.version))) {
      return { channel: "unreleased", version: u.version, sha: u.sha, at: u.at, url: u.url };
    }
    if (rel && newer(rel.version, v)) return { channel: "release", version: rel.version, notes: rel.notes || "" };
    return null;
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

    const site = () => (o.site && o.site()) || metaSite() || siteOf(repo());
    const CHANNEL_KEY = o.channelKey || NAME.toLowerCase() + ".channel";

    return {
      cache: CACHE, running, repo, site,
      // "release" or "unreleased", kept on this device.
      channel() {
        try { return localStorage.getItem(CHANNEL_KEY) === "unreleased" ? "unreleased" : "release"; } catch (e) { return "release"; }
      },
      setChannel(c) {
        try { if (c === "unreleased") localStorage.setItem(CHANNEL_KEY, c); else localStorage.removeItem(CHANNEL_KEY); } catch (e) { /* stays on release */ }
      },
      // unreleased/build.json from the site, each kind's file made a full
      // address: { android: { version, sha, at, url }, windows: ... }. null
      // when there is none yet; throws when the site can't be reached.
      async unreleased() {
        const s = site();
        if (!s) return null;
        const res = await get(s + "unreleased/build.json?t=" + Date.now(), {});
        if (res.status === 404) return null;
        if (res.status !== 200) throw new Error("HTTP " + res.status);
        const j = JSON.parse(res.text) || {};
        const out = {};
        for (const k of Object.keys(j)) {
          const e = j[k];
          if (e && typeof e.file === "string" && /^[\w.-]+$/.test(e.file)) out[k] = { version: String(e.version || ""), sha: String(e.sha || ""), at: String(e.at || ""), url: s + "unreleased/" + e.file };
        }
        return out;
      },
      // The update to offer this build (mine: { version, sha, at }) on this
      // device's channel, for `kind` ("android", "windows"), or null.
      // Throws when nothing could be reached.
      async check(mine, kind) {
        const ch = this.channel();
        const [rel, u] = await Promise.all([
          this.latest().then((r) => ({ r }), (e) => ({ e })),
          ch === "unreleased" ? this.unreleased().then((r) => ({ r }), (e) => ({ e })) : Promise.resolve({ r: null }),
        ]);
        if (rel.e && (ch !== "unreleased" || u.e)) throw rel.e;
        return pick(ch, mine, rel.r || null, (u.r && u.r[kind]) || null);
      },
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
  window.Keel.releases = { create, newer, notesOf, parse, webRepo, siteOf, metaSite, pick };
})();
