// Letterboxd history (0.252.0). Letterboxd has no API for this; its
// Settings → Import & Export → Export your data gives a zip of CSV files,
// and this reads the four that matter:
//
//   diary.csv     Date, Name, Year, Letterboxd URI, Rating, Rewatch, Tags, Watched Date
//   watched.csv   Date, Name, Year, Letterboxd URI
//   ratings.csv   Date, Name, Year, Letterboxd URI, Rating
//   watchlist.csv Date, Name, Year, Letterboxd URI
//
// Every diary line is a Timeline entry on the day it was watched (a rewatch
// is another entry, since each watch is a thing you did); a film in
// watched.csv with no diary line is an entry on the day it was marked
// watched, which is the best date there is. Ratings come from the diary
// line, else ratings.csv, halves rounded up to the app's five stars. The
// watchlist becomes Backlog items. Everything goes through the import
// review (io.js), so what's already in your data is a duplicate there,
// not a second copy.
//
// The reading is pure (test/letterboxd.test.js); only `importFiles` touches
// the page.
(() => {
  let ctx = null;
  const lower = (s) => String(s || "").toLowerCase();

  // Header-keyed rows, so a column that moves still reads.
  function table(rows) {
    if (!rows.length) return [];
    const head = rows[0].map((h) => lower(h).trim());
    return rows.slice(1).filter((r) => r.some((c) => String(c).trim())).map((r) => {
      const o = {};
      head.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
      return o;
    });
  }
  // Which export a CSV is, from its columns when the name doesn't say.
  function kindOf(name, head) {
    const n = lower(name).replace(/^.*\//, "");
    if (/^(diary|watched|ratings|watchlist)\.csv$/.test(n)) return n.slice(0, -4);
    const cols = new Set(head.map((h) => lower(h).trim()));
    if (!cols.has("name") || !cols.has("letterboxd uri")) return null;
    if (cols.has("watched date")) return "diary";
    if (cols.has("rating")) return "ratings";
    return null; // watched and watchlist have the same columns; the name decides
  }

  const starsOf = (r) => { const n = parseFloat(r); return n > 0 ? Math.min(5, Math.ceil(n)) : 0; };
  const dateParts = (d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
    return m ? { year: +m[1], month: +m[2], date: m[0] } : null;
  };
  const uriOf = (row) => row["letterboxd uri"] || (row.name + "|" + row.year);

  // `files`: [{ name, rows }] with rows as parseCsv gives them. `category`
  // is the category every film is filed under.
  function parseExport(files, category) {
    const by = { diary: [], watched: [], ratings: [], watchlist: [] };
    let recognised = 0;
    for (const f of files) {
      const kind = kindOf(f.name, f.rows[0] || []);
      if (!kind) continue;
      recognised++;
      by[kind] = by[kind].concat(table(f.rows));
    }
    if (!recognised) throw new Error("No Letterboxd files here — the zip from Settings → Import & Export has diary.csv, watched.csv and watchlist.csv");
    const ratings = new Map();
    for (const r of by.ratings) if (starsOf(r.rating)) ratings.set(uriOf(r), starsOf(r.rating));
    const entries = [];
    const inDiary = new Set();
    for (const r of by.diary) {
      const when = dateParts(r["watched date"]) || dateParts(r.date);
      if (!r.name || !when) continue;
      inDiary.add(uriOf(r));
      entries.push(entry(r, when, starsOf(r.rating) || ratings.get(uriOf(r)) || 0, category));
    }
    for (const r of by.watched) {
      if (!r.name || inDiary.has(uriOf(r))) continue;
      const when = dateParts(r.date);
      if (!when) continue;
      entries.push(entry(r, when, ratings.get(uriOf(r)) || 0, category));
    }
    const backlog = by.watchlist.filter((r) => r.name).map((r) => {
      const b = { title: r.name, category, createdAt: r.date ? new Date(r.date + "T12:00:00Z").toISOString() : null };
      if (/^\d{4}$/.test(r.year)) b.releaseYear = +r.year;
      return b;
    });
    return { entries, backlog, counts: { diary: by.diary.length, watched: by.watched.length, ratings: by.ratings.length, watchlist: by.watchlist.length } };
  }
  function entry(r, when, rating, category) {
    const e = { title: r.name, category, year: when.year, month: when.month, date: when.date, createdAt: new Date(when.date + "T12:00:00Z").toISOString() };
    if (rating) e.rating = rating;
    // The Letterboxd link isn't kept: a film you already logged would then
    // come up as an update ("+ notes") on every import instead of being
    // left alone as the duplicate it is.
    if (lower(r.rewatch) === "yes") e.notes = "Rewatch";
    return e;
  }

  // ---------- the page ----------
  const utf8 = (bytes) => new TextDecoder().decode(bytes);
  async function filesOf(fileList) {
    const out = [];
    for (const file of fileList) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (/\.zip$/i.test(file.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
        const zip = await ctx.unzip(bytes);
        for (const name of zip.names()) {
          if (!/\.csv$/i.test(name)) continue;
          out.push({ name, rows: ctx.parseCsv(utf8(await zip.read(name))) });
        }
      } else {
        out.push({ name: file.name, rows: ctx.parseCsv(utf8(bytes)) });
      }
    }
    return out;
  }
  async function importFiles(fileList, category) {
    const files = await filesOf(fileList);
    const got = parseExport(files, category);
    const built = ctx.buildImportItems({ entries: got.entries, backlog: got.backlog, categories: [] }, ["entry", "backlog"]);
    const hint = `${got.entries.length} watched (${got.counts.diary} with a diary date) and ${got.backlog.length} on the watchlist. Films already in your data are hidden; untick anything you don't want.`;
    ctx.reviewAndImport("Import from Letterboxd", hint, built);
  }

  function start(c) { ctx = c; }

  const api = { parseExport, kindOf, starsOf, importFiles, start };
  if (typeof window !== "undefined") window.LifeLogLetterboxd = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
