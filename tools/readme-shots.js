// The README's screenshots, taken from made-up demo data so nobody's own
// log ends up in the repo.
//
//   node tools/readme-shots.js              every shot
//   node tools/readme-shots.js backlog      only the shots whose name has "backlog"
//
// Writes docs/screenshots/<name>-desktop.webp (1280×800) and
// <name>-phone.webp (390×844 at 2×). WebP, encoded by the same Chromium,
// is a third of the PNG's size, and every re-shoot stays in git history. Needs Playwright, found the same way the
// browser suites find it. Nothing leaves the machine: every request to
// another host is refused, and cover art is drawn here as SVG.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { chromium } = require("../test/browser/harness");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "screenshots");
const only = process.argv[2] || "";

// ---------- demo data, dated from today so it never goes stale ----------
const NOW = new Date();
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const daysAgo = (n) => { const d = new Date(NOW); d.setDate(d.getDate() - n); return d; };
const monthsAgo = (n, day = 1) => { const d = new Date(NOW.getFullYear(), NOW.getMonth() - n, day); return d; };
const iso = (d) => d.toISOString();
let seq = 0;
const id = () => "demo" + (seq++).toString(36).padStart(4, "0");

const COLORS = {
  Games: "#5b8cff", Movies: "#e5a50a", Shows: "#c061cb", Anime: "#f66151", Books: "#3fb27f",
};
// A cover: two tones of a colour and a shape, so the Covers layouts read as
// covers without borrowing anyone's art. The app writes the title under it.
const TONES = ["#2d4f8f", "#6b3f8f", "#8f3f4f", "#2f7a6b", "#8a6a2a", "#3f5f8f", "#5a2d6b", "#2d6b4a", "#7a3d2a", "#334a7a"];
function cover(title, i) {
  const a = TONES[i % TONES.length], b = TONES[(i + 3) % TONES.length];
  const shapes = [
    '<circle cx="100" cy="130" r="58" fill="#fff" fill-opacity=".14"/>',
    '<path d="M0 230 L70 150 L120 200 L160 160 L200 210 V300 H0Z" fill="#000" fill-opacity=".22"/>',
    '<rect x="50" y="80" width="100" height="100" rx="8" transform="rotate(20 100 130)" fill="#fff" fill-opacity=".12"/>',
    '<path d="M100 60 L150 160 H50Z" fill="#fff" fill-opacity=".14"/>',
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><circle cx="170" cy="40" r="60" fill="#fff" fill-opacity=".06"/>${shapes[i % shapes.length]}</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function buildData() {
  const categories = Object.entries(COLORS).map(([name, color]) => ({ id: id(), name, color, createdAt: iso(monthsAgo(30)) }));
  let n = 0;
  const entry = (title, category, ago, extra = {}) => {
    const d = monthsAgo(ago, extra.day || 10);
    return {
      id: id(), title, category, year: d.getFullYear(), month: d.getMonth() + 1,
      day: d.getDate(), coverUrl: cover(title, n++), createdAt: iso(d), ...extra,
    };
  };
  const entries = [
    entry("Hollow Lantern", "Games", 0, { day: 4, backlogAddedAt: iso(monthsAgo(6)), rating: 5, genres: ["Metroidvania", "Indie"], length: "24 hrs" }),
    entry("The Quiet Orbit", "Books", 0, { day: 12, rating: 4, author: "M. Ellery" }),
    entry("Night Market", "Movies", 0, { day: 18, rating: 4, length: "1h 52m" }),
    entry("Tidebreakers", "Shows", 0, { day: 22, rating: 3 }),
    entry("Copper Skies", "Games", 1, { day: 3, backlogAddedAt: iso(monthsAgo(9)), rating: 4, genres: ["Strategy"], length: "40 hrs" }),
    entry("Paper Harbor", "Books", 1, { day: 9, backlogAddedAt: iso(monthsAgo(4)), rating: 5, author: "J. Okafor" }),
    entry("Signal Fires", "Anime", 1, { day: 15, rating: 4 }),
    entry("Last Ferry Home", "Movies", 1, { day: 21, rating: 3 }),
    entry("Glass Garden", "Games", 1, { day: 27, rating: 4, startYear: monthsAgo(3).getFullYear(), startMonth: monthsAgo(3).getMonth() + 1 }),
    entry("Northbound", "Shows", 2, { day: 6, rating: 5 }),
    entry("Ember Road", "Games", 2, { day: 14, rating: 3 }),
    entry("A Map of Small Things", "Books", 2, { day: 20, rating: 4, author: "R. Castell" }),
    entry("Starling", "Movies", 2, { day: 25, rating: 5 }),
    entry("Iron Bloom", "Anime", 3, { day: 2, rating: 4 }),
    entry("Saltwind", "Games", 3, { day: 11, rating: 5 }),
    entry("The Long Winter Fair", "Books", 3, { day: 17, rating: 3, author: "A. Lindqvist" }),
    entry("Fieldnotes", "Shows", 4, { day: 8, rating: 4 }),
    entry("Velvet Engine", "Games", 4, { day: 19, rating: 4 }),
    entry("Moth & Moon", "Movies", 5, { day: 5, rating: 4 }),
    entry("Cinder Choir", "Games", 5, { day: 23, rating: 5 }),
    entry("Harbor Lights", "Books", 6, { day: 13, rating: 4, author: "M. Ellery" }),
    entry("Skyward Kids", "Anime", 7, { day: 9, rating: 3 }),
    entry("Quarry", "Games", 8, { day: 16, rating: 4 }),
    entry("Distant Bells", "Movies", 9, { day: 21, rating: 5 }),
    entry("Lowtide", "Shows", 10, { day: 4, rating: 4 }),
    entry("Thornwall", "Games", 11, { day: 28, rating: 3 }),
    entry("Wren", "Books", 12, { day: 7, rating: 5, author: "S. Haddad" }),
    entry("Pale Circuit", "Games", 13, { day: 15, rating: 4 }),
    entry("Riverglass", "Movies", 14, { day: 2, rating: 4 }),
    entry("Underfold", "Games", 16, { day: 19, rating: 5 }),
  ];
  const thisYear = NOW.getFullYear();
  const accomplishments = {
    [thisYear]: [
      { id: id(), text: "Finished every book on the summer list", createdAt: iso(monthsAgo(2)) },
      { id: id(), text: "100% on Hollow Lantern", createdAt: iso(monthsAgo(0)) },
    ],
  };

  const soon = (days) => ymd(daysAgo(-days));
  const item = (title, category, extra = {}) => ({
    id: id(), title, category, coverUrl: cover(title, n++), createdAt: iso(daysAgo(40 + n)), ...extra,
  });
  const backlog = [
    item("Starfall Tactics", "Games", { priority: 1, summary: "A turn-based campaign across a collapsing star system: hire a crew, hold the line, and choose which worlds to save.", notes: "Friends say the second act is the best part.", bought: true, length: "35 hrs", externalRating: "88 Metacritic", genres: ["Strategy", "RPG"], releaseDate: "2025-03-14", releasePrecision: "day", releaseStatus: "released" }),
    item("Marrow Keep", "Games", { priority: 1, length: "18 hrs", externalRating: "84 Metacritic", hltb: { story: 1080, extras: 1560, complete: 2400 }, reviews: { opencritic: { score: 86 }, metauser: { score: 79 } }, releaseDate: "2024-11-02", releasePrecision: "day", releaseStatus: "released" }),
    item("Driftwood Saga", "Games", { bought: true, length: "60 hrs", releaseDate: "2023-06-20", releasePrecision: "day", releaseStatus: "released" }),
    item("Cobalt Run", "Games", { earlyAccess: true, length: "12 hrs", releaseDate: "2025-08-01", releasePrecision: "day", releaseStatus: "released" }),
    item("Lantern Hollow II", "Games", { releaseDate: soon(9), releasePrecision: "day", releaseStatus: "upcoming" }),
    item("Echo Vale", "Games", { releaseDate: soon(0), releasePrecision: "day", releaseStatus: "released" }),
    item("Orchard Protocol", "Games", { releaseDate: soon(70), releasePrecision: "month", releaseStatus: "upcoming" }),
    item("The Ninth Lighthouse", "Books", { priority: 1, author: "R. Castell", releaseDate: "2024-04-02", releasePrecision: "day", releaseStatus: "released" }),
    item("Wild Arithmetic", "Books", { author: "J. Okafor", releaseDate: "2022-09-12", releasePrecision: "day", releaseStatus: "released" }),
    item("The Salt Archive", "Books", { author: "M. Ellery", releaseDate: soon(24), releasePrecision: "day", releaseStatus: "upcoming" }),
    item("Kestrel", "Movies", { priority: 1, length: "2h 10m", externalRating: "7.8 TMDB", releaseDate: "2025-05-09", releasePrecision: "day", releaseStatus: "released" }),
    item("Small Hours", "Movies", { length: "1h 38m", releaseDate: soon(16), releasePrecision: "day", releaseStatus: "upcoming" }),
    item("Coldwater", "Shows", { airing: "airing", episodesOut: 6, episodesTotal: 10, nextAt: soon(3), nextLabel: "S2 E7", releaseDate: "2025-09-12", releasePrecision: "day", releaseStatus: "released" }),
    item("Paper Moons", "Shows", { airing: "finished", episodesOut: 8, episodesTotal: 8, releaseDate: "2024-02-01", releasePrecision: "day", releaseStatus: "released" }),
    item("Radiant Drift", "Anime", { startedAt: ymd(daysAgo(9)), progress: 3, airing: "airing", episodesOut: 4, episodesTotal: 12, nextAt: soon(5), nextLabel: "Ep 5", releaseDate: "2025-10-04", releasePrecision: "day", releaseStatus: "released" }),
    item("Hearthbound", "Anime", { priority: 1, airing: "finished", episodesOut: 24, episodesTotal: 24, releaseDate: "2023-01-10", releasePrecision: "day", releaseStatus: "released" }),
    item("Grey Meridian", "Games", { dropped: true, releaseDate: "2021-05-01", releasePrecision: "day", releaseStatus: "released" }),
    item("Tin Soldiers", "Games", { startedAt: ymd(daysAgo(12)), bought: true, releaseDate: "2024-01-20", releasePrecision: "day", releaseStatus: "released" }),
    item("The Wandering Inn of Ash", "Books", { startedAt: ymd(daysAgo(5)), author: "S. Haddad" }),
  ];

  const noteCategories = [
    { id: id(), name: "Ideas", color: "#e5a50a" }, { id: id(), name: "Recipes", color: "#3fb27f" }, { id: id(), name: "Reading", color: "#5b8cff" },
  ];
  const note = (ago, extra) => ({ id: id(), createdAt: iso(daysAgo(ago)), editedAt: iso(daysAgo(ago)), ...extra });
  const notes = [
    note(9, { kind: "list", category: "Ideas", items: [
      { id: id(), text: "Book the campsite" }, { id: id(), text: "Fix the bike's back brake", done: true, doneAt: iso(daysAgo(1)) },
      { id: id(), text: "Return library books" }, { id: id(), text: "Call about the internet plan" }] }),
    note(1, { title: "Weekend loaf", category: "Recipes", fav: true, text: "500 g flour, 350 g water, 10 g salt, 100 g starter.\n\n- Mix, rest an hour\n- Four folds, 30 minutes apart\n- Overnight in the fridge, bake at 250 °C" }),
    note(2, { kind: "quote", text: "The best time to plant a tree was twenty years ago. The second best time is now.", author: "Proverb", category: "Reading" }),
    note(3, { title: "Game night ideas", category: "Ideas", text: "Co-op only this month. **Cobalt Run** looks right for four players; check whether it has drop-in." }),
    note(14, { kind: "list", category: "Ideas", items: [
      { id: id(), text: "Headphones" }, { id: id(), text: "Desk lamp", done: true }, { id: id(), text: "A second controller" }] }),
    note(8, { title: "Things that worked this year", text: "Reading before bed instead of scrolling. One game at a time. Writing the week down on Sundays." }),
    note(12, { kind: "quote", text: "Not all those who wander are lost.", author: "J.R.R. Tolkien", source: "The Fellowship of the Ring", category: "Reading" }),
  ];

  const habitMarks = (pattern, days = 70, slip) => {
    const m = {};
    for (let i = 1; i < days; i++) if (pattern(i)) m[ymd(daysAgo(i))] = slip ? slip(i) : 1;
    return m;
  };
  const habits = [
    { id: id(), name: "Read 20 pages", color: "#3fb27f", order: 0, cadence: "daily", target: 1, startedAt: ymd(daysAgo(90)), marks: habitMarks((i) => i % 9 !== 4) },
    { id: id(), name: "Walk", color: "#5b8cff", order: 1, cadence: "daily", target: 1, startedAt: ymd(daysAgo(90)), marks: { ...habitMarks((i) => i % 4 !== 0), [ymd(NOW)]: 1 } },
    { id: id(), name: "Gym", color: "#f66151", order: 2, cadence: { days: [0, 2, 4] }, target: 1, startedAt: ymd(daysAgo(90)), marks: habitMarks((i) => [0, 2, 4].includes(daysAgo(i).getDay()) && i % 5 !== 0) },
    { id: id(), name: "Water", color: "#33c7de", order: 3, cadence: "daily", target: 3, startedAt: ymd(daysAgo(90)), marks: { ...habitMarks((i) => true, 70, (i) => (i % 3) + 1), [ymd(NOW)]: 2 } },
    { id: id(), name: "No soda", color: "#e5a50a", order: 4, cadence: "daily", avoid: true, limit: 0, target: 1, startedAt: ymd(daysAgo(90)), marks: habitMarks((i) => i % 11 === 3) },
  ];

  const financeCategories = [
    { id: id(), name: "Food", color: "#3fb27f", subs: [{ id: id(), name: "Groceries" }, { id: id(), name: "Eating out" }] },
    { id: id(), name: "Entertainment", color: "#c061cb", subs: [{ id: id(), name: "Games" }, { id: id(), name: "Books" }] },
    { id: id(), name: "Home", color: "#5b8cff" },
    { id: id(), name: "Transport", color: "#e5a50a" },
    { id: id(), name: "Subscriptions", color: "#f66151" },
  ];
  const projects = [{ id: id(), name: "Lisbon trip", color: "#33c7de" }];
  const financeEntries = [];
  const spend = (ago, amount, category, note, extra = {}) =>
    financeEntries.push({ id: id(), date: ymd(daysAgo(ago)), amount, category, note, createdAt: iso(daysAgo(ago)), ...extra });
  for (let m = 0; m < 12; m++) {
    const base = m * 30;
    spend(base + 2, 84 + (m % 4) * 9, "Food", "Weekly shop", { subcategory: "Groceries" });
    spend(base + 9, 71 + (m % 3) * 12, "Food", "Weekly shop", { subcategory: "Groceries" });
    spend(base + 16, 92 + (m % 5) * 6, "Food", "Weekly shop", { subcategory: "Groceries" });
    spend(base + 6, 38 + (m % 4) * 7, "Food", "Dinner with friends", { subcategory: "Eating out" });
    spend(base + 12, 45 + (m % 3) * 5, "Transport", "Fuel");
    if (m % 2 === 0) spend(base + 20, 29.99 + (m % 3) * 10, "Entertainment", "New game", { subcategory: "Games" });
    if (m % 3 === 1) spend(base + 24, 18.5, "Entertainment", "Paperback", { subcategory: "Books" });
  }
  spend(3, 59.99, "Entertainment", "Starfall Tactics", { subcategory: "Games" });
  spend(1, 22.4, "Food", "Lunch", { subcategory: "Eating out" });
  spend(5, 340, "Home", "New office chair");
  spend(40, 412, "Transport", "Flights", { project: "Lisbon trip" });
  spend(35, 380, "Home", "Apartment", { project: "Lisbon trip", note: "Four nights" });
  spend(34, 46, "Food", "Seafood dinner", { project: "Lisbon trip", subcategory: "Eating out", currency: "EUR", fxAmount: 42, rate: 1.095 });
  const recurringExpenses = [
    { id: id(), startDate: ymd(monthsAgo(20, 1)), interval: "monthly", amount: 1450, category: "Home", note: "Rent", createdAt: iso(monthsAgo(20)) },
    { id: id(), startDate: ymd(monthsAgo(14, 8)), interval: "monthly", amount: 15.49, category: "Subscriptions", note: "Streaming", createdAt: iso(monthsAgo(14)) },
    { id: id(), startDate: ymd(monthsAgo(10, 18)), interval: "monthly", amount: 10.99, category: "Subscriptions", note: "Music", createdAt: iso(monthsAgo(10)) },
    { id: id(), startDate: ymd(monthsAgo(6, 3)), interval: "monthly", amount: 45, category: "Home", note: "Internet", createdAt: iso(monthsAgo(6)) },
    { id: id(), startDate: ymd(monthsAgo(9, 27)), interval: "yearly", amount: 59.99, category: "Subscriptions", note: "Cloud storage", createdAt: iso(monthsAgo(9)) },
  ];

  const data = {
    version: 1, categories, entries, backlog, accomplishments, notes, noteCategories, todos: [], todoCategories: [],
    habits, financeCategories, financeEntries, recurringExpenses, projects,
    settings: { currency: "USD", mediaCategorySources: { Books: "openlibrary", Anime: "anilist-anime" } },
  };

  const tripStart = daysAgo(-18), day = (k) => ymd(new Date(tripStart.getFullYear(), tripStart.getMonth(), tripStart.getDate() + k));
  const tripId = id();
  const place = (name, k, extra) => ({ id: id(), trip: tripId, name, createdAt: iso(NOW), ...(k == null ? {} : { day: day(k) }), ...extra });
  const travel = {
    trips: [
      { id: tripId, name: "Kyoto", start: day(0), end: day(3), createdAt: iso(NOW) },
      { id: id(), name: "Lisbon", start: ymd(daysAgo(38)), end: ymd(daysAgo(34)), createdAt: iso(daysAgo(60)) },
    ],
    places: [
      place("Fushimi Inari Taisha", 0, { time: "07:30", lat: 34.9671, lng: 135.7727, address: "Fukakusa Yabunouchicho, Fushimi Ward, Kyoto", order: 0 }),
      place("Nishiki Market", 0, { time: "12:00", endTime: "13:30", lat: 35.005, lng: 135.7649, address: "Nakagyo Ward, Kyoto", order: 1 }),
      place("Gion evening walk", 0, { lat: 35.0037, lng: 135.7788, address: "Gion, Higashiyama Ward, Kyoto", order: 2 }),
      place("Arashiyama Bamboo Grove", 1, { time: "08:00", lat: 35.017, lng: 135.6713, address: "Sagaogurayama, Ukyo Ward, Kyoto", order: 0 }),
      place("Tenryu-ji", 1, { lat: 35.0156, lng: 135.6738, address: "Saga Tenryuji, Ukyo Ward, Kyoto", order: 1 }),
      place("Kinkaku-ji", 2, { time: "09:00", lat: 35.0394, lng: 135.7292, address: "Kinkakujicho, Kita Ward, Kyoto", order: 0 }),
      place("Philosopher's Path", 2, { lat: 35.0268, lng: 135.7944, address: "Sakyo Ward, Kyoto", order: 1 }),
      place("Nara Park", 3, { lat: 34.685, lng: 135.843, address: "Nara", order: 0 }),
      place("Kiyomizu-dera", null, { lat: 34.9949, lng: 135.785, address: "Higashiyama Ward, Kyoto" }),
      place("Ippodo Tea", null, { lat: 35.0136, lng: 135.7672, address: "Nakagyo Ward, Kyoto" }),
    ],
  };

  const T = (x, y, text, fs = 22) => ({ id: id(), t: "text", x, y, text, fs, c: "ink", sw: 2 });
  const boards = {
    boards: [{
      id: id(), name: "Garden plan", category: "Ideas", createdAt: iso(daysAgo(6)), updatedAt: iso(daysAgo(6)),
      elements: [
        { id: id(), t: "rect", x: 60, y: 80, w: 260, h: 160, c: "#3fb27f", sw: 3, seed: 3 },
        T(90, 170, "Vegetable bed"),
        { id: id(), t: "ellipse", x: 380, y: 90, w: 150, h: 150, c: "#e5a50a", sw: 3, seed: 5 },
        T(410, 175, "Fire pit"),
        { id: id(), t: "arrow", x: 320, y: 160, x2: 378, y2: 160, c: "ink", sw: 2, seed: 7 },
        T(60, 300, "Shed goes by the fence", 18),
      ],
    }],
  };
  return { data, travel, boards };
}

// ---------- the shots ----------
// Each one gets the page already seeded and on its tab; `go` takes it from
// there. `ui` is the saved navigation the app reopens on; `visual` the
// device's look.
const SHOTS = [
  // The tab bar: a desktop's hover menu, a phone's held tab and its fan.
  { name: "tabs", ui: { view: "backlog", backlogMode: "entries" }, noScroll: true,
    go: async (page, tag) => {
      if (tag === "desktop") { await page.hover('.tab[data-view="backlog"]'); return; }
      const box = await page.locator('.tab[data-view="backlog"]').boundingBox();
      await page.dispatchEvent('.tab[data-view="backlog"]', "pointerdown", { pointerType: "touch", isPrimary: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
    } },
  { name: "timeline", ui: { view: "timeline", timelineMode: "entries" } },
  { name: "timeline-calendar", ui: { view: "timeline", timelineMode: "entries" }, visual: { timelineLayout: "calendar" } },
  { name: "stats", ui: { view: "timeline", timelineMode: "stats" } },
  { name: "backlog", ui: { view: "backlog", backlogMode: "entries" } },
  // A computer's shot holds the pointer over a cover to show its details.
  { name: "backlog-covers", ui: { view: "backlog", backlogMode: "entries" }, visual: { backlogLayout: "covers" },
    go: async (page, tag) => { if (tag === "desktop") await page.hover('.bl-tile:has-text("Marrow Keep") .bl-tile-art'); } },
  { name: "next-releases", ui: { view: "backlog", backlogMode: "upcoming" }, visual: { outTodaySheet: "hide" } },
  { name: "item-sheet", ui: { view: "backlog", backlogMode: "entries" },
    noScroll: true, go: async (page) => { await page.click('.backlog-item-rich:has-text("Starfall Tactics") .bl-body'); } },
  { name: "notes", ui: { view: "notes", notesMode: "notes" } },
  { name: "habits", ui: { view: "notes", notesMode: "habits" } },
  { name: "ledger", ui: { view: "finance", financeMode: "entries" } },
  { name: "ledger-summary", ui: { view: "finance", financeMode: "summary" } },
  { name: "travel", ui: { view: "travel", travelMode: "time" }, visual: { disabledViews: [] } },
  { name: "search", ui: { view: "backlog", backlogMode: "entries" }, noScroll: true,
    go: async (page) => { await page.click("#search"); await page.keyboard.type("lantern", { delay: 40 }); } },
  { name: "settings", ui: { view: "timeline", timelineMode: "entries" },
    noScroll: true, go: async (page) => { await page.click("#settingsBtn"); } },
];

const SIZES = [
  { tag: "desktop", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  { tag: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function toWebp(page, png) {
  const b64 = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = "data:image/png;base64," + src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.85).split(",")[1];
  }, png.toString("base64"));
  return Buffer.from(b64, "base64");
}

async function seedIdb(page, travel, boards) {
  await page.evaluate(({ travel, boards }) => new Promise((resolve, reject) => {
    const q = indexedDB.open("lifelog");
    q.onerror = () => reject(q.error);
    q.onsuccess = () => {
      const db = q.result;
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").put(travel, "travelCache");
      tx.objectStore("handles").put(boards, "boardsCache");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { travel, boards });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(ROOT, "server.js")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const BASE = "http://localhost:" + port;
  await new Promise((r) => setTimeout(r, 600));
  const { data, travel, boards } = buildData();
  const browser = await chromium.launch();
  const errors = [];
  const encoder = await browser.newPage();
  try {
    for (const shot of SHOTS.filter((s) => s.name.includes(only))) {
      for (const size of SIZES) {
        const ctx = await browser.newContext({ ...size, reducedMotion: "reduce", serviceWorkers: "block" });
        await ctx.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
        const page = await ctx.newPage();
        page.on("pageerror", (e) => errors.push(shot.name + "/" + size.tag + ": " + e.message));
        await page.goto(BASE + "/", { waitUntil: "networkidle" });
        await seedIdb(page, travel, boards);
        await page.evaluate(({ data, ui, visual }) => {
          localStorage.setItem("lifelog-cache-v1", JSON.stringify(data));
          localStorage.setItem("lifelog-ui-v1", JSON.stringify(ui));
          localStorage.setItem("lifelog-visual-settings-v1", JSON.stringify({ outTodaySheet: "hide", ...visual }));
        }, { data, ui: shot.ui, visual: shot.visual || {} });
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForTimeout(700);
        // A phone's chips fill half its screen; the shot starts where the
        // content does, under the sticky top bar, as it would scrolled.
        if (size.tag === "phone" && !shot.noScroll) {
          await page.evaluate(() => {
            const bar = document.querySelector("#filterbar"), top = document.querySelector(".topbar");
            if (bar && !bar.hidden) window.scrollTo(0, bar.getBoundingClientRect().bottom + window.scrollY - (top ? top.offsetHeight : 0));
          });
          await page.waitForTimeout(300);
        }
        if (shot.go) { await shot.go(page, size.tag); await page.waitForTimeout(600); }
        const png = await page.screenshot();
        fs.writeFileSync(path.join(OUT, `${shot.name}-${size.tag}.webp`), await toWebp(encoder, png));
        console.log("  " + shot.name + "-" + size.tag);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  if (errors.length) { console.error("\npage errors:\n  " + errors.join("\n  ")); process.exitCode = 1; }
}

if (require.main === module) main();
module.exports = { buildData };
