// LifeLog — Settings → About → Test builds (0.299.0, from Waypage's 1.48.0).
//
// A pull request labelled test, test-android or test-ios has its build on
// the pre-release test-<branch> (tools/test-build.sh). A pre-release is
// never GitHub's "latest", so the updater never offers one; this fold lists
// them from the repo's public releases, no token, and:
//
//   - on Android downloads the APK through the updater's own download and
//     hands it to Android's installer. Signed with the release key and the
//     same version code, it installs over the app and keeps the data, and the
//     release installs back over it the same way. A branch that raised
//     APP_VERSION can't be left without an uninstall, and its row says so.
//   - on iPhone opens the pre-release's page, for AltStore or SideStore.
//   - in a browser opens it in place: sw.js serves that commit's files while
//     the cache "lifelog-preview" holds preview.json, and puts a bar on top
//     with Back to the release.
//
// A test build syncs with the real data, as the release does; History's
// Undo is how its writes are taken back. The fold says so.
//
// Reading the releases and opening a build in the browser are keel's
// (src/keel/releases.js, sw.js's src/keel/sw-preview.js); this is the fold.
(function () {
  const P = () => window.LifeLogPlatform;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const K = window.Keel.releases;
  const native = () => !!(P() && P().native);
  // The app's build names its repo (phones and computers); a browser's comes
  // from its GitHub Pages address.
  const R = K.create({ name: "LifeLog", repo: () => (P() && P().build && P().build.repo) || null });
  const available = () => (native() ? !!R.repo() : R.webReady);
  const newer = K.newer;

  // The test build this copy is running, if any: the app's build says its
  // branch; a browser's is preview.json in the preview cache.
  let webPreview = null;
  if (!native()) R.running.then((p) => { webPreview = p; });
  function running() {
    if (!native()) return webPreview;
    const b = P().build;
    return b && b.branch && b.branch !== "main" ? { branch: b.branch, sha: b.sha || "" } : null;
  }

  const st = { phase: "idle", list: [], stable: null, error: "", checkedAt: 0, going: null };

  async function load() {
    if (!available() || st.phase === "loading") return;
    if (P().ready) await P().ready;
    st.phase = "loading";
    st.error = "";
    paint();
    try {
      Object.assign(st, await R.list());
      st.checkedAt = Date.now();
      st.phase = "loaded";
    } catch (e) {
      st.phase = st.checkedAt ? "loaded" : "failed";
      st.error = "Couldn't look for test builds. Try again when you're online.";
    }
    paint();
  }

  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + " days ago";
  };
  const releasePage = R.releaseUrl;

  // Android: the updater's download and installer, under the build's tag.
  async function installApk(key, version, tag) {
    st.going = { key, text: "Downloading…" };
    paint();
    try {
      const uri = await P().downloadUpdate(version, (f) => { st.going = { key, text: "Downloading · " + Math.round(f * 100) + "%" }; paint(); }, tag);
      if (!uri) { P().openOutside(releasePage(tag)); st.going = null; paint(); return; }
      st.going = { key, text: "Opening the installer…" };
      paint();
      await P().openInstaller(uri);
      st.going = null;
    } catch (e) {
      st.going = { key, text: "The download didn't finish. Tap to try again", failed: true };
    }
    paint();
  }

  function install(p) {
    if (!native()) { if (p.sha) R.open(p); return; }
    if (P().ios || !p.apk) { P().openOutside(releasePage(p.tag)); return; }
    installApk(p.tag, "test-" + p.branch.replace(/[^A-Za-z0-9._-]/g, "-") + "-" + p.sha.slice(0, 7), p.tag);
  }

  function backToRelease() {
    if (!native()) { R.back(); return; }
    if (P().ios) { P().openOutside(releasePage(null)); return; }
    if (st.stable) installApk("release", st.stable);
  }

  function row(title, sub, extra, btn, onclick, disabled) {
    const r = el("div", "sitem tb-row");
    const text = r.appendChild(el("span", "sitem-text"));
    text.appendChild(el("span", "sitem-title", title));
    if (sub) text.appendChild(el("span", "sitem-sub", sub));
    if (extra) text.appendChild(el("span", "sitem-sub tb-warn", extra));
    if (btn) {
      const b = r.appendChild(el("button", "btn btn-small", btn));
      b.type = "button";
      b.disabled = !!disabled;
      if (onclick) b.onclick = onclick;
    }
    return r;
  }

  function paint() {
    const group = $("#testBuilds");
    if (!group) return;
    group.hidden = !available();
    const here = running();
    $("#testBuildsHint").textContent = here
      ? "Running a test build of " + (here.title || here.branch || "a branch")
      : "Try a pull request before it's released";
    const box = $("#testBuildsList");
    if (!box || !group.open) return;
    box.textContent = "";
    const lede = box.appendChild(el("div", "sitem"));
    lede.appendChild(el("span", "sitem-sub", native()
      ? "A test build is a pull request built before it's released. It installs over the LifeLog you have and keeps your data. It also syncs with your data, so Settings → History → Undo takes back anything it gets wrong."
        + (P().ios ? " On iPhone, Get it opens the build's page; install it with AltStore or SideStore." : "")
      : "A test build is a pull request built before it's released. Open one and this browser runs it with your data, which it also syncs, so Settings → History → Undo takes back anything it gets wrong."));
    const mine = here && here.sha ? String(here.sha).slice(0, 7) : null;
    if (!st.checkedAt && st.phase !== "failed") {
      box.appendChild(row("Looking for test builds…"));
    } else if (st.phase === "failed") {
      box.appendChild(row(st.error, null, null, "Try again", load));
    } else if (!st.list.length) {
      box.appendChild(row("No pull request has a test build right now"));
    } else {
      for (const p of st.list) {
        const installed = !!mine && p.sha.slice(0, 7) === mine;
        const going = st.going && st.going.key === p.tag;
        const sub = going ? st.going.text : [p.branch, p.at && ago(p.at), p.pr && "#" + p.pr].filter(Boolean).join(" · ");
        const higher = native() && !P().ios && !!st.stable && !!p.version && newer(p.version, st.stable)
          ? "Raises the version to " + p.version + ": going back to the release needs an uninstall" : null;
        const label = installed ? (native() ? "Installed" : "Open now") : native() ? (P().ios ? "Get it" : "Install") : "Open";
        const usable = native() ? (P().ios ? p.ipa : p.apk) : !!p.sha;
        box.appendChild(row(p.title, sub, usable || installed ? higher : (P().ios ? "No iPhone build yet" : "No Android build yet"), label, () => install(p), installed || !usable || (going && !st.going.failed)));
      }
    }
    if (here) {
      // A branch that raised the version can't be installed over by the release.
      const mineV = native() && P().build ? P().build.version : null;
      const stuck = native() && !P().ios && !!st.stable && !!mineV && newer(mineV, st.stable);
      const going = st.going && st.going.key === "release";
      const b = box.appendChild(el("button", "sitem"));
      b.type = "button";
      const t = b.appendChild(el("span", "sitem-text"));
      t.appendChild(el("span", "sitem-title", "Back to the release"));
      t.appendChild(el("span", "sitem-sub", going ? st.going.text
        : !native() ? "The released LifeLog opens again"
        : P().ios ? "Opens the latest release's page"
        : stuck ? "Uninstall LifeLog first: this test build's " + mineV + " is above " + st.stable
        : st.stable ? "LifeLog " + st.stable + " installs over this test build" : "No release found"));
      b.disabled = native() && !P().ios && (!st.stable || stuck || (going && !st.going.failed));
      b.onclick = backToRelease;
    }
    const again = box.appendChild(el("button", "sitem"));
    again.type = "button";
    const at = again.appendChild(el("span", "sitem-text"));
    at.appendChild(el("span", "sitem-title", st.phase === "loading" ? "Checking…" : "Check again"));
    if (st.checkedAt && st.phase !== "loading") at.appendChild(el("span", "sitem-sub", st.error || "Checked " + ago(st.checkedAt)));
    again.disabled = st.phase === "loading";
    again.onclick = load;
  }

  // Settings → About calls this each time it opens; the fold loads the list
  // the first time it's opened, and again whenever it's opened after that.
  function render() {
    const group = $("#testBuilds");
    if (group && !group.dataset.wired) {
      group.dataset.wired = "1";
      group.addEventListener("toggle", () => { if (group.open) { paint(); load(); } });
    }
    paint();
  }

  window.LifeLogTestBuilds = { render, running, releases: R };
})();
