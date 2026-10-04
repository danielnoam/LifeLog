// Zero-dependency tests for src/docimport.js — `node test/docimport.test.js`.
// The EPUBs and PDFs are built here, byte by byte, so what each test feeds in
// is visible beside what it expects out.
const assert = require("assert");
global.window = {};
require("../src/docimport.js");
const D = global.window.LifeLogDocImport;

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const enc = (s) => new TextEncoder().encode(s);
const bin = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
async function deflate(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// A zip with the given entries, each stored or deflated.
async function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, text, method] of entries) {
    const raw = enc(text);
    const data = method === 8 ? await deflate(raw, "deflate-raw") : raw;
    const nm = enc(name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, method, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, method, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true);
    ch.setUint32(42, offset, true);
    locals.push(new Uint8Array(lh.buffer), nm, data);
    central.push(new Uint8Array(ch.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = concat(central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cd.length, true); end.setUint32(16, offset, true);
  return concat([...locals, cd, new Uint8Array(end.buffer)]);
}

const CONTAINER = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const OPF = `<package><metadata><dc:title>The Small Book</dc:title><dc:creator>Ada &amp; Co</dc:creator></metadata>
<manifest><item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/><item id="css" href="s.css" media-type="text/css"/></manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`;
const ONE = `<html><head><title>x</title><style>p{}</style></head><body><h1>Chapter One</h1>
<p>It was a <em>dark</em> and
  <b>stormy</b> night&#8230;</p><p>Second&nbsp;paragraph.</p><ul><li>a list item</li></ul></body></html>`;
const TWO = `<html><body><h2>Chapter Two</h2><blockquote><p>A quote.</p></blockquote><p>The end.</p></body></html>`;

test("an EPUB reads in spine order, chapters as headings, emphasis kept", async () => {
  const bytes = await zip([["mimetype", "application/epub+zip", 0], ["META-INF/container.xml", CONTAINER, 8],
    ["OEBPS/content.opf", OPF, 8], ["OEBPS/text/two.xhtml", TWO, 8], ["OEBPS/text/one.xhtml", ONE, 0]]);
  const doc = await D.epubToNote(bytes);
  assert.strictEqual(doc.title, "The Small Book");
  assert.strictEqual(doc.author, "Ada & Co");
  assert.strictEqual(doc.text, "## Chapter One\n\nIt was a *dark* and **stormy** night…\n\nSecond paragraph.\n\n- a list item\n\n### Chapter Two\n\n> A quote.\n\nThe end.");
});

test("a DRM-locked EPUB says so instead of returning gibberish", async () => {
  const bytes = await zip([["META-INF/container.xml", CONTAINER, 0], ["OEBPS/content.opf", OPF, 0],
    ["META-INF/encryption.xml", "<encryption><EncryptedData/></encryption>", 0]]);
  await assert.rejects(D.epubToNote(bytes), /copy-protected/);
});

test("something that isn't a zip is refused plainly", async () => {
  await assert.rejects(D.epubToNote(enc("hello")), /valid EPUB/);
});

// A PDF from numbered object bodies; streams are given as [dict, bytes].
function pdf(objects, trailer) {
  const parts = [bin("%PDF-1.7\n")];
  objects.forEach((o, i) => {
    parts.push(bin(`${i + 1} 0 obj\n`));
    if (Array.isArray(o)) {
      parts.push(bin(`${o[0].replace(">>", ` /Length ${o[1].length}>>`)}\nstream\n`), o[1], bin("\nendstream\n"));
    } else parts.push(bin(o + "\n"));
    parts.push(bin("endobj\n"));
  });
  parts.push(bin(`trailer\n<< /Root 1 0 R ${trailer || ""}>>\n%%EOF`));
  return concat(parts);
}

test("a plain PDF: lines join into paragraphs, a wider gap starts a new one, pages in tree order", async () => {
  const page1 = "BT /F1 12 Tf 72 700 Td (A first line that wraps on-) Tj 0 -14 Td (to the next.) Tj 0 -30 Td [(New) -250 (para)] TJ ET";
  const page2 = "BT /F1 12 Tf 14 TL 72 700 Td (Page two) Tj T* (\\(still\\) here) Tj ET";
  const bytes = pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R 3 0 R] /Count 2 /Resources << /Font << /F1 7 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>",
    ["<< >>", bin(page1)],
    ["<< >>", bin(page2)],
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Title (Report) /Producer (test) >>",
  ]);
  const doc = await D.pdfToNote(bytes);
  assert.strictEqual(doc.title, "Report");
  assert.strictEqual(doc.text, "A first line that wraps onto the next.\n\nNew para\n\nPage two (still) here");
});

test("a compressed PDF with its page in an object stream and a ToUnicode font", async () => {
  // Glyph ids 1..3 mean H, i and !, as a subsetted font's ToUnicode says.
  const cmap = "begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <0048> <0003> <0021> endbfchar 1 beginbfrange <0002> <0002> <0069> endbfrange endcmap";
  const content = "BT /F2 10 Tf 1 0 0 1 50 500 Tm <000100020003> Tj ET";
  const inner = ["<< /Type /Page /Parent 8 0 R /Resources << /Font << /F2 6 0 R >> >> /Contents 4 0 R >>", "<< /Type /Pages /Kids [7 0 R] /Count 1 >>"];
  const head = "7 0 8 " + (inner[0].length + 1) + " ";
  const objstm = await deflate(bin(head + inner[0] + "\n" + inner[1]), "deflate");
  const bytes = pdf([
    "<< /Type /Catalog /Pages 8 0 R >>",
    ["<< /Type /ObjStm /N 2 /First " + head.length + " /Filter /FlateDecode >>", objstm],
    "<< /Producer (test) >>",
    ["<< /Filter /FlateDecode >>", await deflate(bin(content), "deflate")],
    ["<< /Filter [/FlateDecode] >>", await deflate(bin(cmap), "deflate")],
    "<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Body /ToUnicode 5 0 R >>",
  ]);
  const doc = await D.pdfToNote(bytes);
  assert.strictEqual(doc.text, "Hi!");
});

test("a scanned PDF (no text) and a locked one are refused with the reason", async () => {
  const scan = pdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] >>", "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>", ["<< >>", bin("q 600 0 0 800 0 0 cm /Im1 Do Q")]]);
  await assert.rejects(D.pdfToNote(scan), /No text found/);
  const locked = pdf(["<< /Type /Catalog /Pages 2 0 R >>"], "/Encrypt 2 0 R ");
  await assert.rejects(D.pdfToNote(locked), /password-protected/);
});

test("a line that starts like Markdown stays text", async () => {
  const bytes = pdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>", ["<< >>", bin("BT 72 700 Td (# 1 not a heading) Tj ET")]]);
  assert.strictEqual((await D.pdfToNote(bytes)).text, "\\# 1 not a heading");
});

test("fileToNote names the note after the file when it has no title of its own", async () => {
  const bytes = pdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>", ["<< >>", bin("BT 72 700 Td (Hello) Tj ET")]]);
  const n = await D.fileToNote(bytes, "folder/Meeting notes.PDF", Date.UTC(2026, 0, 2));
  assert.deepStrictEqual(n, { title: "Meeting notes", text: "Hello", createdAt: "2026-01-02T00:00:00.000Z" });
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log("  ok - " + name); }
    catch (e) { console.error("  FAIL - " + name); console.error("    " + e.message); process.exitCode = 1; }
  }
  console.log(`\n${passed} test(s) passed.`);
})();
