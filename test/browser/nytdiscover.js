// NYT bestsellers in Discover (0.272.0): a books category with a New York
// Times key gets the bestseller list as its Popular card, sits out Coming
// soon, and a bestseller added is looked up in the category's own source.
// Without the key, the card says which key would fill it.
const { chromium, BASE, tally, forgetCopy } = require("./harness");
const { check, done } = tally();

const seed = (keys) => ({
  categories: [{ id: "k", name: "Books", color: "#5b8cff" }],
  entries: [], backlog: [], accomplishments: {}, notes: [], habits: [], projects: [], financeEntries: [], recurringExpenses: [], financeCategories: [],
  settings: { mediaCategorySources: { Books: "openlibrary" }, mediaKeys: keys },
});
const NYT = { results: { lists: [
  { list_name_encoded: "combined-print-and-e-book-fiction", books: [{ title: "JAMES", author: "Percival Everett", book_image: "https://img.example/james.jpg", description: "Jim's story.", primary_isbn13: "1" }] },
  { list_name_encoded: "combined-print-and-e-book-nonfiction", books: [{ title: "THE WAGER", author: "David Grann", book_image: "https://img.example/wager.jpg", description: "A shipwreck.", primary_isbn13: "2" }] },
] } };
const OL = { docs: [{ key: "/works/OL1W", title: "James", author_name: ["Percival Everett"], cover_i: 7, first_publish_year: 2024 }] };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const width of [375, 1280]) {
    const at = " @" + width;
    const p = await b.newPage({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
    p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
    let nytCalls = 0;
    await p.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await p.route("https://api.nytimes.com/**", (r) => { nytCalls++; r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NYT) }); });
    await p.route("https://openlibrary.org/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OL) }));
    await p.route(/img\.example|covers\.openlibrary\.org/, (r) => r.fulfill({ status: 204, body: "" }));
    await p.goto(BASE + "/", { waitUntil: "networkidle" });

    const boot = async (keys) => {
      await forgetCopy(p);
      await p.evaluate((s) => {
        localStorage.clear();
        localStorage.setItem("lifelog-cache-v1", JSON.stringify(s));
        localStorage.setItem("lifelog-ui-v1", JSON.stringify({ view: "backlog", backlogMode: "discover" }));
      }, seed(keys));
      await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1200);
    };

    await boot({});
    const noKey = await p.evaluate(() => (document.querySelector("#viewBody .backlog-section") || {}).textContent || "");
    check("without a key, the books card names the New York Times key" + at, /New York Times key/.test(noKey), noKey);

    await boot({ nyt: "k" });
    const card = await p.evaluate(() => ({
      text: (document.querySelector("#viewBody .backlog-section") || {}).textContent || "",
      titles: [...document.querySelectorAll("#viewBody .dsc-row .bl-title")].map((e) => e.textContent),
    }));
    check("with it, Popular is the bestsellers, title-cased, fiction first" + at, card.titles.join() === "James,The Wager" && /NYT bestsellers/.test(card.text), card);
    check("one request for both lists" + at, nytCalls === 1, nytCalls);

    await p.locator("#viewBody .dsc-row", { hasText: "James" }).click();
    await p.waitForTimeout(800);
    const form = await p.evaluate(() => ({
      open: !document.querySelector("#backlogModal").hidden,
      title: document.querySelector("#bTitle").value,
      source: document.querySelector("#bMediaSource").value,
      id: document.querySelector("#bMediaId").value,
    }));
    check("adding one finds it in Open Library, the category's source" + at,
      form.open && form.title === "James" && form.source === "openlibrary" && form.id === "/works/OL1W", form);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);

    const upcoming = await p.evaluate(() => {
      const btn = [...document.querySelectorAll(".backlog-mode-bar .seg-btn")].find((x) => x.textContent === "Coming soon");
      btn.click();
      return new Promise((r) => setTimeout(() => r((document.querySelector("#viewBody") || {}).textContent || ""), 400));
    });
    check("Coming soon has no books card (NYT lists no future books)" + at, !/NYT bestsellers/.test(upcoming), upcoming.slice(0, 200));
    if (width === 375 && process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/nyt-375.png" });
    await p.close();
  }
  await b.close();
  done(errs);
})();
