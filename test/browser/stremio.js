// Stremio, read only: signing in keeps the key Stremio sends back and never
// the password; a sync reads the library into the review (backlog, in
// progress with its episode, a watched movie on the timeline finishing its
// backlog item), matched on TMDB by IMDb id; nothing is ever sent to
// Stremio but the sign-in, the read and the sign-out; Sign out forgets the
// key; an export leaves the key out; and "Add to my Stremio account" sends
// the account's add-on list back whole with the Up next row added, then the
// button turns to Remove, which takes only the row off; signed in, the app
// link and Copy give way to it.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const SEED = {
  categories: [{ name: "Films", color: "#58a6ff" }, { name: "TV", color: "#f0883e" }, { name: "Games", color: "#3fb950" }],
  entries: [{ id: "e1", title: "Thief", category: "Films", year: 2025, month: 12, date: "2025-12", createdAt: "2025-12-01T00:00:00.000Z" }],
  backlog: [{ id: "b1", title: "Collateral", category: "Films", createdAt: "2026-01-02T00:00:00.000Z" }],
  notes: [], accomplishments: {}, habits: [], financeCategories: [], financeEntries: [], recurringExpenses: [], projects: [], noteCategories: [],
  settings: { mediaKeys: { tmdb: "k" }, steam: { proxyUrl: "https://w.example" } },
};
const NEVER = "1970-01-01T00:00:00.000Z";
const item = (id, type, name, state, extra) => ({ _id: id, type, name, poster: "", removed: false, temp: false, _mtime: "2026-11-01T00:00:00.000Z",
  state: { lastWatched: NEVER, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null, ...state }, ...extra });
const LIBRARY = [
  item("tt0113277", "movie", "Heat", {}),
  item("tt0369339", "movie", "Collateral", { lastWatched: "2026-10-02T12:00:00.000Z", timesWatched: 1, flaggedWatched: 1 }),
  item("tt0081613", "movie", "Thief", { lastWatched: "2026-11-01T12:00:00.000Z", timesWatched: 1, flaggedWatched: 1 }),
  item("tt0903747", "series", "Breaking Bad", { lastWatched: "2026-11-10T12:00:00.000Z", timeWatched: 900000, video_id: "tt0903747:2:5" }),
];
const TMDB = {
  tt0113277: { movie_results: [{ id: 949, title: "Heat", poster_path: "/heat.jpg", release_date: "1995-12-15", genre_ids: [80], vote_average: 7.9 }] },
  tt0369339: { movie_results: [{ id: 1538, title: "Collateral", poster_path: "/col.jpg", release_date: "2004-08-06", genre_ids: [53], vote_average: 7.3 }] },
  tt0081613: { movie_results: [] },
  tt0903747: { tv_results: [{ id: 1396, name: "Breaking Bad", poster_path: "/bb.jpg", first_air_date: "2008-01-20", genre_ids: [18], vote_average: 8.9 }] },
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  const calls = [];
  const CINEMETA = { transportUrl: "https://v3-cinemeta.strem.io/manifest.json", manifest: { id: "com.linvo.cinemeta", name: "Cinemeta" }, flags: { official: true, protected: true } };
  let account = [CINEMETA];
  let refuseOnce = true;
  await page.route("https://w.example/**", (r) => {
    const u = new URL(r.request().url());
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-LifeLog-Key" };
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers });
    if (/\/manifest\.json$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify({ id: "app.lifelog.upnext.x", name: "LifeLog: Up next", resources: ["catalog"], types: ["movie", "series"], catalogs: [] }) });
    return r.fulfill({ status: 200, contentType: "application/json", headers, body: "{}" });
  });
  await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
  await page.route("https://api.strem.io/**", (r) => {
    const method = new URL(r.request().url()).pathname.replace("/api/", "");
    const body = JSON.parse(r.request().postData() || "{}");
    calls.push({ method, body });
    const json = (o) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(o) });
    if (method === "login") return body.password === "right" ? json({ result: { authKey: "KEY123", user: { email: body.email } } }) : json({ error: { message: "Wrong password", code: 3 } });
    if (method === "datastoreGet") return body.authKey === "KEY123" ? json({ result: LIBRARY }) : json({ error: { message: "Session does not exist", code: 1 } });
    if (method === "logout") return json({ result: { success: true } });
    if (method === "addonCollectionGet") return json({ result: { addons: account } });
    if (method === "addonCollectionSet") {
      if (refuseOnce) { refuseOnce = false; return json({ error: { message: "Not authorized to change official add-ons", code: 9 } }); }
      account = body.addons; return json({ result: { success: true } });
    }
    return r.fulfill({ status: 404, body: "{}" });
  });
  await page.route("https://api.themoviedb.org/**", (r) => {
    const u = new URL(r.request().url());
    const find = /\/find\/(tt\d+)/.exec(u.pathname);
    const body = find ? (TMDB[find[1]] || {}) : { status: "Ended", number_of_seasons: 5, number_of_episodes: 62, seasons: [{ season_number: 1, episode_count: 7 }, { season_number: 2, episode_count: 13 }],
      last_episode_to_air: { season_number: 5, episode_number: 16 } };
    r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
  });

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await forgetCopy(page);
  await page.evaluate((seed) => { localStorage.clear(); localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "timeline" })); localStorage.setItem("lifelog-cache-v1", JSON.stringify(seed)); }, SEED);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(300);
  const data = () => page.evaluate(() => window.LifeLogStorage.cachedCopy());

  await page.click("#settingsBtn"); await page.waitForTimeout(300);
  await page.click('.srow[data-page="imports"]'); await page.waitForTimeout(300);
  await page.click('.srow[data-page="conn-stremio"]'); await page.waitForTimeout(300);
  check("the Connections page offers Stremio, signed out", await page.isVisible("#stremioSignInBtn") && /Not signed in/.test(await page.textContent("#stremioState")));
  await page.fill("#stremioEmail", "me@example.com");
  await page.fill("#stremioPassword", "wrong");
  await page.click("#stremioSignInBtn"); await page.waitForTimeout(400);
  check("a wrong password says so and keeps nothing", !((await data()).settings.stremio || {}).authKey && /Not signed in/.test(await page.textContent("#stremioState")));
  await page.fill("#stremioPassword", "right");
  await page.click("#stremioSignInBtn"); await page.waitForTimeout(400);
  let st = (await data()).settings.stremio || {};
  check("signing in keeps the key and the email", st.authKey === "KEY123" && st.email === "me@example.com" && !!st.connectedAt, st);
  check("the password is kept nowhere", !JSON.stringify(await data()).includes("right") && (await page.inputValue("#stremioPassword")) === "");
  check("signed in, the form gives way to Sign out", await page.isVisible("#stremioSignOutBtn") && !(await page.isVisible("#stremioSignInBtn")) && /me@example.com/.test(await page.textContent("#stremioState")));

  await page.click("#stremioSyncBtn"); await page.waitForTimeout(300);
  check("no categories, no sync", !calls.some((c) => c.method === "datastoreGet"));
  await page.selectOption("#stremioMovieCategory", "Films");
  await page.selectOption("#stremioShowCategory", "TV");
  await page.click("#stremioSyncBtn");
  await page.waitForSelector("#financePickerModal:not([hidden])", { timeout: 8000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll("#financePickerList .import-row, #financePickerList label")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
  check("the review lists the library", rows.some((r) => /Heat/.test(r)) && rows.some((r) => /Breaking Bad/.test(r)) && rows.some((r) => /Collateral/.test(r)), rows);
  check("a movie already logged isn't offered again", !rows.some((r) => /Thief/.test(r)), rows);
  check("the hint says dates are the last play", /last play/.test(await page.textContent("#financePickerHint")));
  await page.click("#financePickerConfirmBtn"); await page.waitForTimeout(600);
  const d = await data();
  const heat = d.backlog.find((x) => x.title === "Heat");
  check("Heat is a backlog item matched on TMDB", heat && heat.mediaSource === "tmdb-movie" && heat.mediaId === "949" && heat.category === "Films" && !heat.startedAt, heat);
  const bb = d.backlog.find((x) => x.title === "Breaking Bad");
  check("Breaking Bad is in progress at episode 12 of the run", bb && bb.mediaSource === "tmdb-tv" && /^2026-11-1[01]$/.test(bb.startedAt || "") && bb.progress === 12, bb);
  const col = d.entries.find((x) => x.title === "Collateral");
  check("Collateral is on the timeline on its last play", col && col.year === 2026 && col.month === 10 && col.category === "Films", col);
  check("and has left the backlog", !d.backlog.some((x) => x.title === "Collateral"));
  check("Thief is still one entry", d.entries.filter((e) => e.title === "Thief").length === 1);
  check("the sync only read Stremio", calls.every((c) => ["login", "datastoreGet", "addonCollectionGet"].includes(c.method)), calls.map((c) => c.method));

  await page.click("#stremioSyncBtn"); await page.waitForTimeout(1200);
  check("a second sync has nothing new", !(await page.isVisible("#financePickerModal")));

  const exported = await page.evaluate(() => window.LifeLogStorage.withoutSecrets ? JSON.stringify(window.LifeLogStorage.withoutSecrets(window.LifeLogStorage.cachedCopy())) : null);
  if (exported !== null) check("an export leaves the key out", !exported.includes("KEY123"));

  check("Up next off: no account button", !(await page.isVisible("#stremioUpNextInstall")));
  await page.click("#stremioUpNext"); await page.waitForTimeout(600);
  check("Up next on and signed in: Add to my Stremio account shows", await page.isVisible("#stremioUpNextInstall"));
  await page.click("#stremioUpNextInstall"); await page.waitForTimeout(600);
  const toastText = await page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
  check("a refusal that mentions auth keeps the key and shows Stremio's words", ((await data()).settings.stremio || {}).authKey === "KEY123" && /Not authorized to change/.test(toastText) && await page.isVisible("#stremioUpNextInstall"), toastText);
  await page.click("#stremioUpNextInstall"); await page.waitForTimeout(600);
  const sets = calls.filter((c) => c.method === "addonCollectionSet").slice(1);
  const sent = sets.length ? sets[0].body : {};
  check("the add-on list goes back whole with the row added", sets.length === 1 && sent.authKey === "KEY123" && sent.addons.length === 2 && sent.addons[0].transportUrl === CINEMETA.transportUrl && sent.addons[0].flags.protected === true
    && /^https:\/\/w\.example\/upnext\/[a-f0-9]{24}\/manifest\.json$/.test(sent.addons[1].transportUrl) && sent.addons[1].manifest.id === "app.lifelog.upnext.x", sent);
  check("then it offers Remove", /Remove/.test(await page.textContent("#stremioUpNextInstall")));
  check("no Copy the link any more; signed in, no Open in the Stremio app either", !(await page.$("#stremioUpNextCopy")) && !(await page.isVisible("#stremioUpNextAdd")));
  await page.click("#stremioUpNextInstall"); await page.waitForTimeout(600);
  const sets2 = calls.filter((c) => c.method === "addonCollectionSet").slice(1);
  check("Remove sends the list back without the row", sets2.length === 2 && JSON.stringify(sets2[1].body.addons) === JSON.stringify([CINEMETA]), sets2.map((c) => c.body));
  check("and offers Add again", /Add to my/.test(await page.textContent("#stremioUpNextInstall")));

  await page.click("#stremioSignOutBtn"); await page.waitForTimeout(400);
  st = (await data()).settings.stremio || {};
  check("Sign out forgets the key and ends the session", !st.authKey && calls.some((c) => c.method === "logout" && c.body.authKey === "KEY123"), st);
  check("signed out, the form is back", await page.isVisible("#stremioSignInBtn"));
  check("signed out, no account button; Open in the Stremio app still there", !(await page.isVisible("#stremioUpNextInstall")) && await page.isVisible("#stremioUpNextAdd"));
  check("no errors", errs.length === 0, errs);
  await ctx.close();
  await b.close();
  done();
})();
