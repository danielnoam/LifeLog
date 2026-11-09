// LifeLog — EPUB and PDF, read as text (0.236.0). A book or a document
// becomes the words in it, as Markdown, so it opens, searches and syncs like
// any note. No library: an EPUB is a zip of XHTML pages, and a PDF's text is
// in its content streams; both are compressed with deflate, which the
// browser's DecompressionStream undoes. What this can't read it says so
// rather than guessing: a scanned PDF has pictures of words, not words, and a
// password-protected one is encrypted.
//
// Everything here is pure apart from DecompressionStream, which Node has
// too, so test/docimport.test.js drives the real code.
(function () {
  const latin1 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  };
  const utf8 = (bytes) => new TextDecoder("utf-8").decode(bytes);

  async function inflate(bytes, format) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ---------- zip ----------
  // The central directory at the end lists every entry; each one's local
  // header says where its bytes start. Stored and deflated entries only,
  // which is all an EPUB uses.
  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This isn't a valid EPUB file");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = utf8(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = bytes.subarray(start, start + size);
      files.set(name, { method, raw });
    }
    return {
      names: () => [...files.keys()],
      async read(name) {
        const f = files.get(name);
        if (!f) return null;
        if (f.method === 0) return f.raw;
        if (f.method === 8) return inflate(f.raw, "deflate-raw");
        throw new Error("This EPUB uses a compression LifeLog can't read");
      },
    };
  }

  // ---------- HTML to Markdown ----------
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", shy: "" };
  const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    const v = ENTITIES[e.toLowerCase()];
    return v == null ? m : v;
  });
  const stripTags = (s) => decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

  // A chapter's headings, paragraphs, lists, quotes, bold and italic. Not a
  // general HTML converter: a book is mostly paragraphs, and pictures, tables
  // and footnote links come through as their words or not at all.
  function htmlToMarkdown(html) {
    let s = String(html || "");
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(s);
    if (body) s = body[1];
    s = s.replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
    s = s.replace(/\s+/g, " ");
    s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, inner) => {
      const t = stripTags(inner);
      return t ? "\n\n" + "#".repeat(Math.min(6, +n + 1)) + " " + t + "\n\n" : "";
    });
    s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, t, inner) => (inner.trim() ? "**" + inner.trim() + "**" : ""));
    s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, t, inner) => (inner.trim() ? "*" + inner.trim() + "*" : ""));
    s = s.replace(/<li[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "");
    s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (m, inner) => "\n\n> " + stripTags(inner.replace(/<\/?(p|div|br)[^>]*>/gi, " ")) + "\n\n");
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<\/?(p|div|section|article|ul|ol|table|tr|hr|figure|aside|nav|header|footer)\b[^>]*>/gi, "\n\n");
    s = decodeEntities(s.replace(/<[^>]*>/g, ""));
    return s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // ---------- EPUB ----------
  const dirOf = (path) => path.replace(/[^/]*$/, "");
  function resolvePath(base, href) {
    const parts = (base + decodeURIComponent(href.split("#")[0])).split("/");
    const out = [];
    for (const p of parts) { if (p === "..") out.pop(); else if (p !== "." && p !== "") out.push(p); }
    return out.join("/");
  }
  const attr = (tag, name) => { const m = new RegExp("\\b" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i").exec(tag); return m ? m[2] : null; };

  async function epubToNote(bytes) {
    const zip = await unzip(bytes);
    const container = await zip.read("META-INF/container.xml");
    const rootTag = container && /<rootfile\b[^>]*>/i.exec(utf8(container));
    const opfPath = rootTag && attr(rootTag[0], "full-path");
    const opfBytes = opfPath && await zip.read(opfPath);
    if (!opfBytes) throw new Error("This EPUB has no table of contents LifeLog can find");
    const opf = utf8(opfBytes);
    if (zip.names().includes("META-INF/encryption.xml") && /<EncryptedData/i.test(utf8(await zip.read("META-INF/encryption.xml")))) {
      throw new Error("This EPUB is copy-protected (DRM), so its text can't be read");
    }
    const tagText = (re) => { const m = re.exec(opf); return m ? stripTags(m[1]) : ""; };
    const title = tagText(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
    const author = tagText(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
    const manifest = new Map();
    for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
      const id = attr(m[0], "id"), href = attr(m[0], "href");
      if (id && href) manifest.set(id, { href, type: attr(m[0], "media-type") || "" });
    }
    const base = dirOf(opfPath);
    const chapters = [];
    for (const m of opf.matchAll(/<itemref\b[^>]*>/gi)) {
      const item = manifest.get(attr(m[0], "idref"));
      if (!item || !/html/i.test(item.type + item.href)) continue;
      const page = await zip.read(resolvePath(base, item.href));
      if (!page) continue;
      const md = htmlToMarkdown(utf8(page));
      if (md) chapters.push(md);
    }
    const text = chapters.join("\n\n");
    if (!text.trim()) throw new Error("No text found in this EPUB");
    return { title, author, text };
  }

  // ---------- PDF ----------
  // Every object, found by scanning for "n g obj" rather than trusting the
  // cross-reference table (often stale in edited files), plus the ones packed
  // into object streams, which is where most modern PDFs keep their pages.
  async function pdfObjects(bytes) {
    const src = latin1(bytes);
    const objs = new Map();
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(src))) {
      const start = m.index + m[0].length;
      let end = src.indexOf("endobj", start);
      if (end < 0) end = src.length;
      let body = src.slice(start, end);
      let stream = null;
      const sm = /stream\r?\n/.exec(body);
      if (sm && body.lastIndexOf("endstream") > sm.index) {
        const from = start + sm.index + sm[0].length;
        const lenM = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(body.slice(0, sm.index));
        let to = lenM ? from + +lenM[1] : -1;
        if (to < 0 || src.slice(to, to + 20).indexOf("endstream") < 0) to = start + body.lastIndexOf("endstream");
        stream = bytes.subarray(from, to);
        body = body.slice(0, sm.index);
      }
      objs.set(+m[1], { dict: body, stream });
      re.lastIndex = end;
    }
    for (const o of [...objs.values()]) {
      if (!/\/Type\s*\/ObjStm\b/.test(o.dict) || !o.stream) continue;
      const data = await decodeStream(o);
      if (!data) continue;
      const text = latin1(data);
      const n = +(/\/N\s+(\d+)/.exec(o.dict) || [])[1] || 0;
      const first = +(/\/First\s+(\d+)/.exec(o.dict) || [])[1] || 0;
      const head = text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < n; i++) {
        const num = head[i * 2], off = head[i * 2 + 1], next = i + 1 < n ? head[i * 2 + 3] : text.length - first;
        if (!objs.has(num)) objs.set(num, { dict: text.slice(first + off, first + next), stream: null });
      }
    }
    return objs;
  }
  function ascii85(bytes) {
    const s = latin1(bytes).replace(/\s+/g, "").replace(/^<~/, "").replace(/~>.*$/, "");
    const out = [];
    for (let i = 0; i < s.length;) {
      if (s[i] === "z") { out.push(0, 0, 0, 0); i++; continue; }
      const chunk = s.slice(i, i + 5);
      i += 5;
      const padded = (chunk + "uuuu").slice(0, 5);
      let v = 0;
      for (const c of padded) v = v * 85 + (c.charCodeAt(0) - 33);
      const four = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      out.push(...four.slice(0, chunk.length - 1));
    }
    return Uint8Array.from(out);
  }
  function asciiHex(bytes) {
    let h = latin1(bytes).replace(/\s+|>.*$/g, "");
    if (h.length % 2) h += "0";
    return Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.substr(i * 2, 2), 16));
  }
  // The filters text comes through in; an image's (DCT, JBIG2, …) aren't,
  // and a stream in one of those simply isn't read.
  async function decodeStream(o) {
    if (!o || !o.stream) return null;
    const f = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(o.dict);
    const filters = f ? [...f[1].matchAll(/\/(\w+)/g)].map((x) => x[1]) : [];
    let data = o.stream;
    try {
      for (const name of filters) {
        if (name === "FlateDecode" || name === "Fl") data = await inflate(data, "deflate");
        else if (name === "ASCII85Decode" || name === "A85") data = ascii85(data);
        else if (name === "ASCIIHexDecode" || name === "AHx") data = asciiHex(data);
        else return null;
      }
    } catch (e) { return null; }
    return data;
  }
  const refOf = (dict, key) => { const m = new RegExp("/" + key + "\\s+(\\d+)\\s+\\d+\\s+R").exec(dict); return m ? +m[1] : null; };
  // A dictionary or array value that may be written in place or be a
  // reference to one.
  function subValue(objs, dict, key, open, close) {
    const ref = refOf(dict, key);
    if (ref != null) return (objs.get(ref) || {}).dict || "";
    const i = dict.search(new RegExp("/" + key + "\\s*" + (open === "<<" ? "<<" : "\\[")));
    if (i < 0) return "";
    const j = dict.indexOf(open, i);
    let depth = 0;
    for (let k = j; k < dict.length; k++) {
      if (dict.startsWith(open, k)) { depth++; k += open.length - 1; }
      else if (dict.startsWith(close, k)) { depth--; k += close.length - 1; if (!depth) return dict.slice(j, k + 1); }
    }
    return dict.slice(j);
  }
  const subDict = (objs, dict, key) => subValue(objs, dict, key, "<<", ">>");
  const subArray = (objs, dict, key) => subValue(objs, dict, key, "[", "]");

  // A font's ToUnicode map: the character codes a page shows, in Unicode.
  function parseCMap(text) {
    const map = new Map();
    const hex = (h) => parseInt(h, 16);
    const uni = (h) => {
      if (!h) return "";
      if (h.length < 4) return String.fromCharCode(hex(h));
      let s = "";
      for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(hex(h.slice(i, i + 4)));
      return s;
    };
    let bytes = 1;
    for (const m of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
      const h = /<([0-9a-fA-F]+)>/.exec(m[1]);
      if (h) bytes = Math.max(1, h[1].length / 2);
    }
    for (const m of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const p of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(hex(p[1]), uni(p[2]));
    }
    for (const m of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const p of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
        const lo = hex(p[1]), hi = hex(p[2]);
        if (p[3][0] === "[") {
          [...p[3].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((d, i) => map.set(lo + i, uni(d[1])));
        } else {
          const h = p[3].slice(1, -1);
          const baseCode = hex(h.slice(-4));
          const prefix = uni(h.slice(0, -4));
          for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, prefix + String.fromCharCode(baseCode + c - lo));
        }
      }
    }
    return { map, bytes };
  }

  // Glyph widths, in thousandths of the font size: how far each character
  // moves the pen, which is what tells a word gap from a kerned pair.
  function parseWidths(objs, fo) {
    const widths = new Map();
    let dflt = 500;
    if (/\/Subtype\s*\/Type0\b/.test(fo.dict)) {
      const desc = subArray(objs, fo.dict, "DescendantFonts");
      const ref = /(\d+)\s+\d+\s+R/.exec(desc);
      const d = ref ? (objs.get(+ref[1]) || {}).dict || "" : (/<<[\s\S]*>>/.exec(desc) || [""])[0];
      dflt = +(/\/DW\s+([\d.]+)/.exec(d) || [])[1] || 1000;
      const w = subArray(objs, d, "W");
      const toks = [...tokens(w.replace(/^\[|\]$/g, ""))];
      for (let i = 0; i < toks.length;) {
        const c = toks[i];
        if (c.num == null) { i++; continue; }
        if (toks[i + 1] && toks[i + 1].op === "[") {
          let k = i + 2, code = c.num;
          while (k < toks.length && toks[k].op !== "]") { if (toks[k].num != null) widths.set(code++, toks[k].num); k++; }
          i = k + 1;
        } else if (toks[i + 1] && toks[i + 2] && toks[i + 1].num != null && toks[i + 2].num != null) {
          for (let code = c.num; code <= toks[i + 1].num && code - c.num < 65536; code++) widths.set(code, toks[i + 2].num);
          i += 3;
        } else i++;
      }
    } else {
      const first = +(/\/FirstChar\s+(\d+)/.exec(fo.dict) || [])[1] || 0;
      const arr = subArray(objs, fo.dict, "Widths");
      (arr.match(/-?[\d.]+/g) || []).forEach((v, i) => widths.set(first + i, +v));
      const missing = /\/MissingWidth\s+([\d.]+)/.exec(((objs.get(refOf(fo.dict, "FontDescriptor")) || {}).dict) || "");
      if (missing && +missing[1]) dflt = +missing[1];
      if (/Courier/.test(fo.dict)) dflt = 600;
    }
    return { widths, dflt };
  }

  async function loadFont(objs, num, cache) {
    if (cache.has(num)) return cache.get(num);
    const fo = objs.get(num) || { dict: "" };
    const type0 = /\/Subtype\s*\/Type0\b/.test(fo.dict);
    let cmap = null;
    const tu = refOf(fo.dict, "ToUnicode");
    if (tu != null) {
      const data = await decodeStream(objs.get(tu));
      if (data) cmap = parseCMap(latin1(data));
    }
    const font = { cmap, bytes: type0 ? 2 : (cmap ? cmap.bytes : 1), ...parseWidths(objs, fo) };
    cache.set(num, font);
    return font;
  }

  // Content-stream tokens: strings (as raw bytes), numbers, names, arrays,
  // and operators. Inline images are skipped whole.
  function* tokens(s) {
    let i = 0;
    const n = s.length;
    const ws = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
    const delim = (c) => ws(c) || "()<>[]{}/%".includes(c);
    while (i < n) {
      const c = s[i];
      if (ws(c)) { i++; continue; }
      if (c === "%") { while (i < n && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
      if (c === "(") {
        let depth = 1, out = "";
        i++;
        while (i < n && depth) {
          const d = s[i++];
          if (d === "\\") {
            const e = s[i++];
            const esc = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[e];
            if (esc) out += esc;
            else if (/[0-7]/.test(e)) { let o = e; while (o.length < 3 && /[0-7]/.test(s[i])) o += s[i++]; out += String.fromCharCode(parseInt(o, 8) & 255); }
            else if (e === "\r") { if (s[i] === "\n") i++; }
            else if (e !== "\n") out += e;
          } else if (d === "(") { depth++; out += d; }
          else if (d === ")") { if (--depth) out += d; }
          else out += d;
        }
        yield { str: out };
        continue;
      }
      if (c === "<" && s[i + 1] !== "<") {
        const end = s.indexOf(">", i);
        let h = s.slice(i + 1, end < 0 ? n : end).replace(/\s+/g, "");
        if (h.length % 2) h += "0";
        let out = "";
        for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.slice(k, k + 2), 16));
        i = end < 0 ? n : end + 1;
        yield { str: out };
        continue;
      }
      if (c === "<" || c === ">") { i += 2; yield { op: c + c }; continue; }
      if (c === "[" || c === "]") { i++; yield { op: c }; continue; }
      if (c === "/") { let j = i + 1; while (j < n && !delim(s[j])) j++; yield { name: s.slice(i + 1, j) }; i = j; continue; }
      let j = i;
      while (j < n && !delim(s[j])) j++;
      if (j === i) { i++; continue; }
      const word = s.slice(i, j);
      i = j;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { yield { num: +word }; continue; }
      if (word === "BI") { const e = s.indexOf("EI", i); i = e < 0 ? n : e + 2; continue; }
      yield { op: word };
    }
  }

  // A page's resources, with every font loaded and every form (a reusable
  // block of content, which some PDFs put all their text in) read ahead, so
  // the walk over the content below can stay synchronous.
  async function loadResources(objs, resDict, fontCache, depth) {
    const res = { fonts: new Map(), forms: new Map() };
    for (const f of subDict(objs, resDict, "Font").matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      res.fonts.set(f[1], await loadFont(objs, +f[2], fontCache));
    }
    if (depth < 4) {
      for (const x of subDict(objs, resDict, "XObject").matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
        const o = objs.get(+x[2]);
        if (!o || !/\/Subtype\s*\/Form\b/.test(o.dict)) continue;
        const data = await decodeStream(o);
        if (!data) continue;
        const own = subDict(objs, o.dict, "Resources");
        const mm = /\/Matrix\s*\[([^\]]*)\]/.exec(o.dict);
        res.forms.set(x[1], {
          content: latin1(data),
          res: own ? await loadResources(objs, own, fontCache, depth + 1) : res,
          matrix: mm ? mm[1].trim().split(/\s+/).map(Number) : [1, 0, 0, 1, 0, 0],
        });
      }
    }
    return res;
  }

  const mul = (a, b) => [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];

  // Every run of text a page draws, where it starts on the page (y up), where
  // it ends, and how big it is. Text, graphics state and forms only.
  function textRuns(content, res, ctm0, out, depth) {
    let ctm = ctm0.slice();
    const gstack = [];
    let tm = [1, 0, 0, 1, 0, 0], lm = tm.slice(), leading = 0, font = null, size = 0, tc = 0, tw = 0;
    const stack = [];
    const decode = (raw) => {
      const b = font ? font.bytes : 1;
      let text = "", adv = 0;
      for (let i = 0; i + b <= raw.length; i += b) {
        let code = 0;
        for (let k = 0; k < b; k++) code = code * 256 + raw.charCodeAt(i + k);
        const ch = font && font.cmap && font.cmap.map.has(code) ? font.cmap.map.get(code)
          : b === 1 ? raw[i] : "";
        text += ch;
        const w = font ? (font.widths.has(code) ? font.widths.get(code) : font.dflt) : 500;
        adv += w / 1000 * size + tc + (b === 1 && code === 32 ? tw : 0);
      }
      return { text, adv };
    };
    const show = (parts) => {
      const m = mul(tm, ctm);
      const x = m[4], y = m[5];
      const scale = Math.hypot(m[2], m[3]) || 1;
      let text = "", adv = 0;
      for (const p of parts) {
        if (typeof p === "number") {
          const shift = -p / 1000 * size;
          if (p < -180 && text && !/\s$/.test(text)) text += " ";
          adv += shift;
        } else {
          const d = decode(p);
          text += d.text;
          adv += d.adv;
        }
      }
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + adv * tm[0], tm[5] + adv * tm[1]];
      const end = mul(tm, ctm);
      if (text) out.push({ x, y, endX: end[4], size: size * scale, text });
    };
    const moveTo = (tx, ty) => {
      lm = [lm[0], lm[1], lm[2], lm[3], lm[4] + tx * lm[0] + ty * lm[2], lm[5] + tx * lm[1] + ty * lm[3]];
      tm = lm.slice();
    };
    for (const t of tokens(content)) {
      if (t.op == null) { stack.push(t); if (stack.length > 4096) stack.shift(); continue; }
      if (t.op === "[") { stack.push({ arr: true }); continue; }
      if (t.op === "]") {
        let at = stack.length - 1;
        while (at >= 0 && !stack[at].arr) at--;
        const items = stack.splice(at < 0 ? 0 : at);
        if (at >= 0) items.shift();
        stack.push({ list: items });
        continue;
      }
      const nums = stack.filter((x) => x.num != null).map((x) => x.num);
      const last = (k) => nums[nums.length - k] || 0;
      const lastStr = () => { const s = stack.filter((x) => x.str != null).pop(); return s ? [s.str] : []; };
      switch (t.op) {
        case "q": gstack.push(ctm); break;
        case "Q": if (gstack.length) ctm = gstack.pop(); break;
        case "cm": if (nums.length >= 6) ctm = mul(nums.slice(-6), ctm); break;
        case "BT": tm = [1, 0, 0, 1, 0, 0]; lm = tm.slice(); break;
        case "Tf": { const nm = stack.filter((x) => x.name).pop(); font = nm ? res.fonts.get(nm.name) || null : null; size = last(1); break; }
        case "Tc": tc = last(1); break;
        case "Tw": tw = last(1); break;
        case "TL": leading = last(1); break;
        case "Td": moveTo(last(2), last(1)); break;
        case "TD": leading = -last(1); moveTo(last(2), last(1)); break;
        case "Tm": if (nums.length >= 6) { lm = nums.slice(-6); tm = lm.slice(); } break;
        case "T*": moveTo(0, -leading); break;
        case "Tj": show(lastStr()); break;
        case "'": moveTo(0, -leading); show(lastStr()); break;
        case "\"": tw = last(2); tc = last(1); moveTo(0, -leading); show(lastStr()); break;
        case "TJ": { const l = stack.filter((x) => x.list).pop(); if (l) show(l.list.map((it) => (it.str != null ? it.str : it.num)).filter((v) => v != null)); break; }
        case "Do": {
          const nm = stack.filter((x) => x.name).pop();
          const form = nm && res.forms.get(nm.name);
          if (form && depth < 4) textRuns(form.content, form.res, mul(form.matrix, ctm), out, depth + 1);
          break;
        }
      }
      stack.length = 0;
    }
    return out;
  }

  // Hebrew and Arabic are drawn left to right in a PDF, glyph by glyph, so
  // the text comes out backwards. Each right-to-left stretch is turned
  // round, and on a line that is mostly right-to-left so is the order of
  // the stretches, which puts an English word inside a Hebrew sentence back
  // where it was read.
  const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  const RTL_RUN = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]+(?:[\s\d.,:;!?'"()-]+[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]+)*/g;
  function logicalOrder(line) {
    if (!RTL.test(line)) return line;
    const rtl = (line.match(/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g) || []).length;
    const ltr = (line.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
    const flip = (s) => [...s].reverse().join("").replace(/[()[\]{}<>]/g, (c) => ({ "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<" })[c]);
    if (rtl <= ltr) return line.replace(RTL_RUN, flip);
    // Mostly right-to-left: read the whole line from the right, then turn
    // the left-to-right runs (words, numbers) back the right way round.
    return flip(line).replace(/[A-Za-z0-9\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F\s.,:;'"@/_-]*[A-Za-z0-9\u00C0-\u024F]|[A-Za-z0-9\u00C0-\u024F]/g, (s) => [...s].reverse().join(""));
  }

  // Runs into lines (the same height, in the order drawn, with a space where
  // the pen jumped), lines into paragraphs: a gap noticeably taller than the
  // usual line spacing starts a new one, and a hyphen at a line's end joins
  // the word.
  function runsToParagraphs(runs) {
    const lines = [];
    let cur = null;
    for (const r of runs) {
      const tol = Math.max(1, r.size * 0.4);
      if (cur && Math.abs(r.y - cur.y) <= tol && r.x >= cur.endX - r.size) {
        const gap = r.x - cur.endX;
        if (gap > r.size * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(r.text)) cur.text += " ";
        cur.text += r.text;
        cur.endX = r.endX;
      } else {
        if (cur) lines.push(cur);
        cur = { y: r.y, endX: r.endX, size: r.size, text: r.text };
      }
    }
    if (cur) lines.push(cur);
    return linesToParagraphs(lines.map((l) => ({ y: l.y, text: logicalOrder(l.text.replace(/\s+/g, " ").trim()) })).filter((l) => l.text));
  }
  function linesToParagraphs(lines) {
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const g = lines[i - 1].y - lines[i].y;
      if (g > 0) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    // The usual spacing is a low one, not the middle: a page of short
    // paragraphs has as many paragraph gaps as line gaps.
    const usual = gaps.length ? gaps[Math.floor((gaps.length - 1) / 4)] : 0;
    const paras = [];
    let p = "";
    lines.forEach((l, i) => {
      const g = i ? lines[i - 1].y - l.y : 0;
      if (p && (g <= 0 || (usual && g > usual * 1.45))) { paras.push(p); p = ""; }
      if (!p) p = l.text;
      else if (/\p{L}[-\u00AD\u2010]$/u.test(p)) p = p.slice(0, -1) + l.text;
      else p += " " + l.text;
    });
    if (p) paras.push(p);
    return paras;
  }

  async function pdfToNote(bytes) {
    if (latin1(bytes.subarray(0, 1024)).indexOf("%PDF") < 0) throw new Error("This isn't a valid PDF file");
    const objs = await pdfObjects(bytes);
    const tail = latin1(bytes.subarray(Math.max(0, bytes.length - 4096)));
    if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(tail) || [...objs.values()].some((o) => /\/Type\s*\/XRef\b/.test(o.dict) && /\/Encrypt\b/.test(o.dict))) {
      throw new Error("This PDF is password-protected, so its text can't be read");
    }
    // Pages in reading order: walk the page tree from the catalog, falling
    // back to file order when there isn't one to walk.
    const pages = [];
    const catalog = [...objs.values()].find((o) => /\/Type\s*\/Catalog\b/.test(o.dict));
    const walk = (num, seen) => {
      const o = objs.get(num);
      if (!o || seen.has(num)) return;
      seen.add(num);
      if (/\/Type\s*\/Page\b/.test(o.dict)) { pages.push(o); return; }
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
      if (kids) for (const k of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) walk(+k[1], seen);
    };
    if (catalog && refOf(catalog.dict, "Pages") != null) walk(refOf(catalog.dict, "Pages"), new Set());
    if (!pages.length) for (const o of objs.values()) if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(o);

    let title = "";
    const info = [...objs.values()].find((o) => /\/Title\s*[(<]/.test(o.dict) && /\/(Producer|Creator|Author|CreationDate)\b/.test(o.dict));
    if (info) {
      const t = [...tokens(info.dict.slice(info.dict.indexOf("/Title") + 6))][0];
      if (t && t.str != null) {
        title = t.str.startsWith("\u00fe\u00ff")
          ? Array.from({ length: (t.str.length - 2) >> 1 }, (_, i) => String.fromCharCode(t.str.charCodeAt(2 + i * 2) * 256 + t.str.charCodeAt(3 + i * 2))).join("")
          : t.str;
        title = title.trim();
      }
    }

    const fontCache = new Map();
    const paras = [];
    for (const page of pages) {
      // Resources can sit on the page or be inherited from its parent.
      let resDict = subDict(objs, page.dict, "Resources");
      for (let parent = refOf(page.dict, "Parent"), hops = 0; !resDict && parent != null && hops < 16; hops++) {
        const po = objs.get(parent);
        if (!po) break;
        resDict = subDict(objs, po.dict, "Resources");
        parent = refOf(po.dict, "Parent");
      }
      const res = await loadResources(objs, resDict, fontCache, 0);
      // One stream, or an array of them (written in place or referenced).
      const refs = [];
      const one = refOf(page.dict, "Contents");
      if (one != null && (objs.get(one) || {}).stream) refs.push(one);
      else for (const r of subArray(objs, page.dict, "Contents").matchAll(/(\d+)\s+\d+\s+R/g)) refs.push(+r[1]);
      let content = "";
      for (const r of refs) {
        const data = await decodeStream(objs.get(r));
        if (data) content += latin1(data) + "\n";
      }
      paras.push(...runsToParagraphs(textRuns(content, res, [1, 0, 0, 1, 0, 0], [], 0)));
    }
    const text = paras.map((p) => p.replace(/^([#>*+-]|\d+[.)])(\s)/, "\\$1$2")).join("\n\n").trim();
    if (!text) throw new Error("No text found in this PDF. If it's a scan, it holds pictures of words, not words");
    return { title, text };
  }

  // One note from either kind of file. The title is the file's own, else
  // its name; an EPUB's author opens the text, since a plain note has no
  // field of its own for one.
  async function fileToNote(bytes, fileName, lastModified) {
    const isPdf = /\.pdf$/i.test(fileName);
    const doc = isPdf ? await pdfToNote(bytes) : await epubToNote(bytes);
    const name = String(fileName || "").replace(/^.*[\\/]/, "").replace(/\.(pdf|epub)$/i, "").trim();
    const when = new Date(lastModified || NaN);
    return { title: doc.title || name, text: (doc.author ? "*By " + doc.author + "*\n\n" : "") + doc.text,
      createdAt: isNaN(when) ? null : when.toISOString() };
  }

  // ---------- Excalidraw drawings (Obsidian's plugin) ----------
  // Obsidian's Excalidraw plugin saves a drawing as `Name.excalidraw.md`:
  // front matter with `excalidraw-plugin:`, the drawing's words for search,
  // and the scene itself as JSON in a ```json block, or LZ-string compressed
  // (base64, broken into lines) in a ```compressed-json one. Excalidraw's own
  // `.excalidraw` file is that JSON alone. Either becomes a board.
  const isExcalidraw = (name, text) => /\.excalidraw(\.md)?$/i.test(String(name || "")) ||
    /^﻿?---\r?\n(?:[^\n]*\n)*?excalidraw-plugin\s*:/.test(String(text || "").slice(0, 4000));

  // LZ-string's decompressFromBase64, the only half of it this needs.
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  function lzBase64(input) {
    input = String(input || "").replace(/[^A-Za-z0-9+/=]/g, "");
    if (!input) return "";
    const vals = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) vals[i] = B64.indexOf(input[i]);
    let val = vals[0], position = 32, index = 1;
    const bits = (n) => {
      let out = 0;
      for (let p = 0; p < n; p++) {
        const bit = val & position;
        position >>= 1;
        if (!position) { position = 32; val = index < vals.length ? vals[index] : 0; index++; }
        if (bit) out |= 1 << p;
      }
      return out;
    };
    const dict = [0, 1, 2];
    let dictSize = 4, numBits = 3, enlargeIn = 4;
    const first = bits(2);
    if (first === 2) return "";
    let w = String.fromCharCode(bits(first === 0 ? 8 : 16));
    dict[3] = w;
    const out = [w];
    for (;;) {
      if (index > vals.length) return "";
      let c = bits(numBits);
      if (c === 2) return out.join("");
      if (c < 2) {
        dict[dictSize++] = String.fromCharCode(bits(c === 0 ? 8 : 16));
        c = dictSize - 1;
        if (--enlargeIn === 0) { enlargeIn = 1 << numBits; numBits++; }
      }
      let entry;
      if (typeof dict[c] === "string") entry = dict[c];
      else if (c === dictSize) entry = w + w[0];
      else throw new Error("This drawing's data is damaged");
      out.push(entry);
      dict[dictSize++] = w + entry[0];
      w = entry;
      if (--enlargeIn === 0) { enlargeIn = 1 << numBits; numBits++; }
    }
  }

  // The scene in a file: the block under "Drawing" (the plugin's heading),
  // else the first such block, else the whole file as JSON.
  function excalidrawScene(text) {
    const s = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const at = s.search(/^#+\s*Drawing\s*$/m);
    const block = /```(compressed-json|json)[ \t]*\n([\s\S]*?)\n```/.exec(at >= 0 ? s.slice(at) : s) ||
      /```(compressed-json|json)[ \t]*\n([\s\S]*?)\n```/.exec(s);
    let json = block ? (block[1] === "compressed-json" ? lzBase64(block[2]) : block[2]) : s.trim();
    let scene;
    try { scene = JSON.parse(json); } catch (e) { throw new Error("This Excalidraw drawing's data can't be read"); }
    if (!scene || !Array.isArray(scene.elements)) throw new Error("This isn't an Excalidraw drawing");
    return scene;
  }

  // Excalidraw's default stroke, and the other near-blacks, become "ink",
  // the theme's text colour, so a drawing still reads in a dark theme.
  const INK = new Set(["#000", "#000000", "#1e1e1e", "#212529", "#343a40", "#000000ff"]);
  const paint = (c) => {
    const s = String(c || "").trim().toLowerCase();
    if (!s || s === "transparent" || /^#[0-9a-f]{6}00$/.test(s)) return null;
    if (INK.has(s)) return "ink";
    return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s) || /^(rgba?|hsla?)\([\d\s.,%]+\)$/.test(s) || /^[a-z]{3,20}$/.test(s) ? s : "ink";
  };
  const rnd = (n) => Math.round(+n || 0);
  const turnPt = (x, y, cx, cy, a) => {
    if (!a) return [x, y];
    const c = Math.cos(a), s = Math.sin(a);
    return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
  };
  const SKIP_NAMES = { image: ["image", "images"], frame: ["frame", "frames"], magicframe: ["frame", "frames"],
    embeddable: ["embedded page", "embedded pages"], iframe: ["embedded page", "embedded pages"] };
  // What a drawing had that a board can't show, in words: "2 images, 1 frame".
  function skippedText(skipped) {
    const by = new Map();
    for (const [t, n] of Object.entries(skipped || {})) {
      const [one, many] = SKIP_NAMES[t] || ["other shape", "other shapes"];
      const prev = by.get(one) || { n: 0, many };
      prev.n += n;
      by.set(one, prev);
    }
    return [...by].map(([one, { n, many }]) => n + " " + (n === 1 ? one : many)).join(", ");
  }

  // A scene's elements as a board's (boards.js has the shapes): rectangles,
  // ellipses and text keep their box and angle; a diamond is its four sides;
  // a line or arrow of several points is a line per segment, the arrowheads
  // on the end segments; a freehand stroke is a pen stroke. A solid fill
  // keeps its own colour (`fc`); a hatched one is the board's hatching.
  // Deleted elements are left out quietly; images, frames and embeds are
  // counted in `skipped`.
  function excalidrawToElements(scene, makeId) {
    let n = 0;
    const id = makeId || (() => "x" + Date.now().toString(36) + (n++).toString(36));
    const out = [], skipped = {};
    for (const e of scene.elements || []) {
      if (!e || e.isDeleted) continue;
      const stroke = paint(e.strokeColor), bg = paint(e.backgroundColor);
      const c = stroke || bg || "ink";
      const sw = Math.max(1, rnd(e.strokeWidth || 1));
      const seed = (Math.abs(rnd(e.seed)) % 2147483647) || 1;
      const a = ((+e.angle || 0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const angle = a < 1e-3 || Math.PI * 2 - a < 1e-3 ? 0 : Math.round(a * 1e4) / 1e4;
      const x = +e.x || 0, y = +e.y || 0, w = +e.width || 0, h = +e.height || 0;
      const cx = x + w / 2, cy = y + h / 2;
      const fill = (el) => {
        if (!bg) return el;
        el.f = true;
        if (e.fillStyle === "solid" || !stroke) el.fc = bg;
        return el;
      };
      const line = (t, p, q) => {
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.5) return;
        out.push({ id: id(), t, c, sw, seed, x: rnd(p[0]), y: rnd(p[1]), x2: rnd(q[0]), y2: rnd(q[1]) });
      };
      if (e.type === "rectangle" || e.type === "ellipse") {
        const el = fill({ id: id(), t: e.type === "rectangle" ? "rect" : "ellipse", c, sw, seed, x: rnd(x), y: rnd(y), w: Math.max(1, rnd(w)), h: Math.max(1, rnd(h)) });
        if (angle) el.a = angle;
        out.push(el);
      } else if (e.type === "diamond") {
        const pts = [[cx, y], [x + w, cy], [cx, y + h], [x, cy]].map(([px, py]) => turnPt(px, py, cx, cy, angle));
        pts.forEach((p, i) => line("line", p, pts[(i + 1) % 4]));
      } else if (e.type === "line" || e.type === "arrow") {
        const pts = (Array.isArray(e.points) ? e.points : []).map(([px, py]) => turnPt(x + (+px || 0), y + (+py || 0), cx, cy, angle));
        if (pts.length < 2) continue;
        const head = e.type === "arrow" && e.endArrowhead !== null, tail = e.type === "arrow" && !!e.startArrowhead;
        const last = pts.length - 2;
        for (let i = 0; i <= last; i++) {
          const p = pts[i], q = pts[i + 1];
          if (i === 0 && tail) {
            // The arrowhead at the start points back: the segment is drawn
            // from its middle out to each end.
            const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
            line("arrow", m, p);
            line(i === last && head ? "arrow" : "line", m, q);
          } else line(i === last && head ? "arrow" : "line", p, q);
        }
      } else if (e.type === "freedraw") {
        const pts = (Array.isArray(e.points) ? e.points : []).map(([px, py]) => turnPt(x + (+px || 0), y + (+py || 0), cx, cy, angle).map(rnd));
        const p = [];
        let px = 0, py = 0;
        pts.forEach(([qx, qy], i) => {
          if (i && qx === px && qy === py) return;
          p.push(p.length ? qx - px : qx, p.length ? qy - py : qy);
          px = qx; py = qy;
        });
        if (!p.length) continue;
        // Excalidraw draws a freehand line about two and a half times its
        // stroke width; a pen stroke is as wide as it says.
        out.push({ id: id(), t: "pen", c, sw: Math.max(1, Math.round((+e.strokeWidth || 1) * 2.5)), p });
      } else if (e.type === "text") {
        const text = String(e.text != null ? e.text : e.originalText || "").replace(/\r\n?/g, "\n");
        if (!text.trim()) continue;
        const fs = Math.max(6, rnd(e.fontSize || 20));
        const lines = text.split("\n");
        const align = e.textAlign === "center" ? 0.5 : e.textAlign === "right" ? 1 : 0;
        if (align && lines.length > 1 && !angle) {
          // A board's text is left-aligned, so a centred label in a box is
          // a text per line, each placed by its length against the widest.
          const widest = Math.max(...lines.map((l) => l.length)) || 1;
          lines.forEach((l, i) => {
            if (!l.trim()) return;
            const lw = w * (l.length / widest);
            out.push({ id: id(), t: "text", c, sw: 4, fs, x: rnd(x + (w - lw) * align), y: rnd(y + i * fs * 1.25), text: l });
          });
        } else {
          const el = { id: id(), t: "text", c, sw: 4, fs, x: rnd(x), y: rnd(y), text };
          if (angle) el.a = angle;
          out.push(el);
        }
      } else {
        const t = String(e.type || "other");
        skipped[t] = (skipped[t] || 0) + 1;
      }
    }
    return { elements: out, skipped };
  }

  // One board from an Excalidraw file: named for the file, dated when it was
  // last changed.
  function excalidrawToBoard(text, fileName, lastModified, makeId) {
    const { elements, skipped } = excalidrawToElements(excalidrawScene(text), makeId);
    const total = Object.values(skipped).reduce((t, n) => t + n, 0);
    if (!elements.length) throw new Error(total ? "Nothing on this drawing a board can show (" + skippedText(skipped) + ")" : "This drawing is empty");
    const name = String(fileName || "").replace(/^.*[\\/]/, "").replace(/\.excalidraw(\.md)?$/i, "").replace(/\.(md|json)$/i, "").trim();
    const when = new Date(lastModified || NaN);
    const stamp = isNaN(when) ? null : when.toISOString();
    return { board: { name: name || "Drawing", createdAt: stamp, updatedAt: stamp || undefined, elements }, skipped };
  }

  window.LifeLogDocImport = { unzip, htmlToMarkdown, epubToNote, pdfToNote, fileToNote, parseCMap, logicalOrder,
    isExcalidraw, lzBase64, excalidrawScene, excalidrawToElements, excalidrawToBoard, skippedText };
})();
