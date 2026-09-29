// Steam and friends without the proxy, in the Android app (0.215.0). The app
// sends what a browser needs proxy/worker.js for through Capacitor's native
// HTTP instead, mapped to the same upstream addresses as the worker. Faked
// here as a CapacitorHttp that records what it was asked and answers like
// the real services; what it can't prove is the phone's own network stack.
const { chromium, BASE, tally } = require("./harness");
const { check, done } = tally();

const FAKE_BRIDGE = () => {
  window.__http = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      App: { addListener: () => Promise.resolve({ remove() {} }), minimizeApp: () => Promise.resolve() },
      CapacitorHttp: {
        request: async ({ url, method, headers }) => {
          window.__http.push({ url, method, headers });
          if (window.__httpFails) throw new Error("Unable to resolve host");
          if (url.startsWith("https://store.steampowered.com/api/appdetails")) {
            const id = /appids=(\d+)/.exec(url)[1];
            return { status: 200, data: { [id]: { success: true, data: { name: "Portal 2", release_date: { date: "18 Apr, 2011" }, genres: [] } } } };
          }
          return { status: 200, data: JSON.stringify({ success: true, data: [] }) };
        },
      },
    },
  };
};

(async () => {
  const b = await chromium.launch();
  const errs = [];

  // ---- the app ----
  {
    const page = await b.newPage();
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await page.addInitScript(FAKE_BRIDGE);
    await page.route("**/app-build.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    // Nothing may leave for the stand-in address or for the proxy itself.
    const leaked = [];
    await page.route("**/*.invalid/**", (r) => { leaked.push(r.request().url()); r.abort(); });
    await page.route("https://my-proxy.example/**", (r) => { leaked.push(r.request().url()); r.abort(); });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });

    const proxy = await page.evaluate(() => window.LifeLogPlatform.steamProxy("https://my-proxy.example/"));
    check("in the app the proxy is the app's own, even with one set (the setting is synced for browsers)", /\.invalid$/.test(proxy), proxy);

    const details = await page.evaluate((p) => window.LifeLogMedia.fetchSteamAppDetails("620", p), proxy);
    const asked = await page.evaluate(() => window.__http);
    check("a Steam lookup works with no proxy running", details && details.name === "Portal 2", details);
    check("and went straight to Steam's store API, as the worker would have", asked[0] && asked[0].url === "https://store.steampowered.com/api/appdetails?appids=620&filters=basic,genres", asked);

    await page.evaluate(async (p) => {
      window.__http = [];
      await fetch(p + "/steamgriddb/games/id/42?platformdata=steam", { headers: { Authorization: "Bearer k" } });
      await fetch(p + "/steam-wishlist/76561197960287930");
      await fetch(p + "/gg-deals?ids=620&key=abc&region=us");
    }, proxy);
    const routed = await page.evaluate(() => window.__http);
    check("SteamGridDB gets its path, query and key", routed[0] && routed[0].url === "https://www.steamgriddb.com/api/v2/games/id/42?platformdata=steam"
      && /Bearer k/.test(JSON.stringify(routed[0].headers)), routed[0]);
    check("the wishlist goes to Steam's wishlist API", routed[1] && routed[1].url === "https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=76561197960287930", routed[1]);
    check("GG.deals gets its query string", routed[2] && routed[2].url === "https://api.gg.deals/v1/prices/by-steam-app-id/?ids=620&key=abc&region=us", routed[2]);

    const unknown = await page.evaluate(async (p) => (await fetch(p + "/anything-else")).status, proxy);
    check("anything the worker wouldn't relay isn't relayed here either", unknown === 404, unknown);

    const failed = await page.evaluate(async (p) => {
      window.__httpFails = true;
      try { await fetch(p + "/steam-appdetails/620"); return "resolved"; } catch (e) { return e instanceof TypeError ? "TypeError" : String(e); }
    }, proxy);
    check("offline, it fails the way fetch does, so callers' own handling applies", failed === "TypeError", failed);
    check("and nothing went out to the stand-in address or the proxy", leaked.length === 0, leaked);
    await page.close();
  }

  // ---- a browser ----
  {
    const page = await b.newPage();
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    check("in a browser the proxy you set is used as it was", await page.evaluate(() =>
      window.LifeLogPlatform.steamProxy(" https://my-proxy.example/ ") === "https://my-proxy.example"
      && window.LifeLogPlatform.steamProxy("") === "" && !window.LifeLogPlatform.steamDirect));
    await page.close();
  }

  await b.close();
  done(errs);
})();
