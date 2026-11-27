// keel: the app's CHANGELOG.md, read for its What's new and changelog
// screens. The screens and their words stay in each app.
//
//   const C = Keel.changelog;
//   const entries = await C.load("CHANGELOG.md?v=" + APP_VERSION);  // null when it didn't load
//   C.parse(md);              // [{ version, date, sections: [{ title, items }] }], newest first
//   C.mine(entries, APP_VERSION);  // the entry this build is: "Unreleased" when it has one
//   C.between(entries, from, to);  // the releases after `from`, up to and including `to`
//
// tools/release.js writes "## [x.y.z] - YYYY-MM-DD" with "### Added" and
// the like under it. A build of main and a test build ship withPending()'s
// "## [Unreleased]" on top: what's merged since the version it carries,
// so that entry is the one "you have", not the version's own. The web copy
// serves the committed file, which has none.
//
// Items lose Markdown's marks (**, `, [text](link)): they're read, not
// rendered. A line indented under an item continues it.
(function () {
  const K = (window.Keel = window.Keel || {});

  // a > b, for x.y.z versions.
  function newer(a, b) {
    const [x, y] = [a, b].map((v) => String(v).split(".").map(Number));
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }

  const plain = (t) => t.replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  function parse(md) {
    const out = [];
    let entry = null, section = null;
    for (const line of String(md || "").split("\n")) {
      let m;
      if ((m = line.match(/^## \[([^\]]+)\](?:\s*-\s*(\S+))?/))) {
        entry = { version: m[1], date: m[2] || "", sections: [] };
        out.push(entry);
        section = null;
      } else if (!entry) continue;
      else if ((m = line.match(/^### (.+)/))) {
        section = { title: m[1].trim(), items: [] };
        entry.sections.push(section);
      } else if ((m = line.match(/^\s*[-*] (.+)/))) {
        if (!section) entry.sections.push((section = { title: "", items: [] }));
        section.items.push(m[1].trim());
      } else if (line.trim() && section && section.items.length && /^\s/.test(line)) {
        section.items[section.items.length - 1] += " " + line.trim();
      }
    }
    for (const e of out) for (const s of e.sections) s.items = s.items.map(plain);
    // An Unreleased with nothing under it says nothing.
    return out.filter((e) => e.version !== "Unreleased" || e.sections.some((s) => s.items.length));
  }

  let cache = null;
  function load(url, fetchText) {
    const get = fetchText || ((u) => fetch(u).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }));
    if (!cache || cache.url !== url || cache.failed) {
      const c = { url, failed: false };
      c.p = Promise.resolve().then(() => get(url)).then(parse).catch(() => { c.failed = true; return null; });
      cache = c;
    }
    return cache.p;
  }

  function mine(entries, version) {
    if (!entries || !entries.length) return null;
    if (entries[0].version === "Unreleased") return entries[0];
    return entries.find((e) => e.version === version) || null;
  }

  function between(entries, from, to) {
    return (entries || []).filter((e) => /^\d+\.\d+\.\d+$/.test(e.version) && newer(e.version, from) && !newer(e.version, to));
  }

  K.changelog = { parse, load, mine, between, newer };
})();
