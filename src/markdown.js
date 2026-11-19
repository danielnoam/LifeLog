// LifeLog — Markdown, read (0.204.0). A note in a collection opens as a page
// rather than a text box, and most of those came in as .md files: headings,
// lists, tasks, code, quotes, links, bold and italic are what they use.
//
// parse() is pure (test/markdown.test.js): text in, a small tree out.
// render() turns that tree into DOM with createElement and textContent only,
// never innerHTML — a note is whatever was typed or imported, and none of it
// may become markup. Links are kept only when they're http(s) or mailto.
(function () {
  const i18n = (typeof window === "object" && window.i18n) || require("./language.js");
  const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const TASK = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
  const BULLET = /^\s*[-*+]\s+(.*)$/;
  const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
  const QUOTE = /^\s*>\s?(.*)$/;
  const FENCE = /^\s*(```|~~~)/;
  const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  // Tables (Nov 2026): a row of cells, then a line of dashes under it
  // (`|---|:--:|`), then rows until a blank line or one with no "|".
  const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const isTableAt = (lines, i) => i + 1 < lines.length && lines[i].includes("|") && lines[i + 1].includes("-")
    && (lines[i + 1].includes("|") || lines[i].trim().startsWith("|")) && TABLE_RULE.test(lines[i + 1]);
  // A row's cells: the outer pipes are optional, and \| is a pipe inside a cell.
  function tableCells(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const out = [];
    let cur = "";
    for (let k = 0; k < s.length; k++) {
      if (s[k] === "\\" && s[k + 1] === "|") { cur += "|"; k++; continue; }
      if (s[k] === "|") { out.push(cur.trim()); cur = ""; continue; }
      cur += s[k];
    }
    out.push(cur.trim());
    return out;
  }

  // Block structure: headings, fenced code, quotes, lists (tasks, bullets,
  // numbers), rules, and paragraphs of everything else.
  function parse(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const fence = FENCE.exec(line);
      if (fence) {
        const code = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
        i++; // the closing fence, if there is one
        blocks.push({ t: "code", text: code.join("\n") });
        continue;
      }
      const h = HEADING.exec(line);
      if (h) { blocks.push({ t: "h", level: h[1].length, text: h[2] }); i++; continue; }
      if (isTableAt(lines, i)) {
        const head = tableCells(line);
        const align = tableCells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : ""));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
          const cells = tableCells(lines[i++]);
          rows.push(head.map((_, k) => cells[k] || ""));
        }
        blocks.push({ t: "table", head, align: head.map((_, k) => align[k] || ""), rows });
        continue;
      }
      if (RULE.test(line)) { blocks.push({ t: "hr" }); i++; continue; }
      if (QUOTE.test(line)) {
        const q = [];
        while (i < lines.length && QUOTE.test(lines[i])) q.push(QUOTE.exec(lines[i++])[1]);
        blocks.push({ t: "quote", text: q.join("\n") });
        continue;
      }
      if (TASK.test(line) || BULLET.test(line) || NUMBERED.test(line)) {
        const ordered = NUMBERED.test(line) && !BULLET.test(line);
        const items = [];
        while (i < lines.length && lines[i].trim()) {
          const l = lines[i];
          const task = TASK.exec(l), num = NUMBERED.exec(l), bul = BULLET.exec(l);
          if (task) items.push({ text: task[2], done: task[1] !== " " });
          else if (ordered ? num : bul) items.push({ text: (ordered ? num[2] : bul[1]) });
          else if (items.length && /^\s+/.test(l)) items[items.length - 1].text += " " + l.trim();
          else break;
          i++;
        }
        blocks.push({ t: ordered ? "ol" : "ul", items });
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !HEADING.test(lines[i]) && !FENCE.test(lines[i])
        && !QUOTE.test(lines[i]) && !TASK.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !isTableAt(lines, i)) {
        para.push(lines[i++]);
      }
      if (!para.length) { para.push(lines[i++]); }
      blocks.push({ t: "p", text: para.join("\n") });
    }
    return blocks;
  }

  const WIKI = /\[\[([^\[\]|#\n]+)(?:#([^\[\]|\n]*))?(?:\|([^\[\]\n]+))?\]\]/;
  // Inline: `code`, **bold**, *italic* / _italic_, [text](url), and bare
  // links. Earliest match wins; what's inside bold or italic is parsed again.
  const INLINE = [
    ["code", /`([^`]+)`/],
    // Images (0.297.0): ![alt](src) and Obsidian's ![[file.png|300]]. Each
    // starts with "!", one place before the link it would otherwise be.
    ["img", /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/],
    ["embed", /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/],
    // A link to another note or board (Nov 2026), Obsidian's way:
    // [[Title]], [[Title|shown as]], [[Title#Heading]].
    ["wiki", WIKI],
    // An address may hold one level of brackets, as Wikipedia's do.
    ["link", /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/],
    ["bold", /\*\*([^*]+)\*\*|__([^_]+)__/],
    ["em", /\*([^*\s][^*]*)\*|(?:^|(?<=\W))_([^_\s][^_]*)_(?=\W|$)/],
    ["url", /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/],
  ];
  function inline(text) {
    const out = [];
    let rest = String(text || "");
    while (rest) {
      let best = null;
      for (const [t, re] of INLINE) {
        const m = re.exec(rest);
        if (m && (!best || m.index < best.m.index)) best = { t, m };
      }
      if (!best) { out.push({ t: "text", text: rest }); break; }
      const { t, m } = best;
      if (m.index) out.push({ t: "text", text: rest.slice(0, m.index) });
      if (t === "code") out.push({ t, text: m[1] });
      else if (t === "img") out.push({ t, alt: m[1], src: m[2] });
      else if (t === "embed") out.push({ t: "img", alt: "", src: m[1].trim(), embed: true });
      else if (t === "wiki") out.push({ t, target: m[1].trim(), heading: (m[2] || "").trim(), label: (m[3] || "").trim() || m[1].trim() });
      else if (t === "link") out.push({ t, href: m[2], children: inline(m[1]) });
      else if (t === "url") out.push({ t: "link", href: m[0], children: [{ t: "text", text: m[0] }] });
      else out.push({ t, children: inline(m[1] || m[2]) });
      rest = rest.slice(m.index + m[0].length);
    }
    return out;
  }

  const safeHref = (href) => (/^(https?:|mailto:)/i.test(href) ? href : null);

  // How an image is drawn is the caller's (opts.image(node) → Element):
  // notes.js turns a picture stored by LifeLog into an <img>. Without it,
  // or when it hands nothing back, an image is a line saying what it was.
  // A web address is never loaded on its own: opening a note would tell
  // that site you read it.
  function imageChip(n) {
    const href = n.embed ? null : safeHref(n.src);
    const chip = document.createElement(href ? "a" : "span");
    chip.className = "md-img-missing";
    if (href) { chip.href = href; chip.target = "_blank"; chip.rel = "noopener noreferrer"; }
    const name = n.alt || String(n.src).replace(/^.*[\\/]/, "");
    chip.textContent = href ? i18n.t("Image: {name}", { name }) : i18n.t("Image not brought in: {name}", { name });
    return chip;
  }

  function renderInline(parent, nodes, opts) {
    // A picture is a block of its own: the line breaks around it in the
    // source would only add a blank line above or below it.
    nodes = nodes.map((n, i) => {
      if (n.t !== "text") return n;
      let text = n.text;
      if (i > 0 && nodes[i - 1].t === "img") text = text.replace(/^[ \t]*\n/, "");
      if (i < nodes.length - 1 && nodes[i + 1].t === "img") text = text.replace(/\n[ \t]*$/, "");
      return text === n.text ? n : { ...n, text };
    });
    for (const n of nodes) {
      if (n.t === "text") {
        // Single line breaks inside a paragraph are kept, as the note had them.
        n.text.split("\n").forEach((part, k) => {
          if (k) parent.appendChild(document.createElement("br"));
          if (part) parent.appendChild(document.createTextNode(part));
        });
        continue;
      }
      if (n.t === "code") { const c = document.createElement("code"); c.textContent = n.text; parent.appendChild(c); continue; }
      if (n.t === "img") {
        parent.appendChild((opts && opts.image && opts.image(n)) || imageChip(n));
        continue;
      }
      // What a link to a note is depends on the notes, so the caller draws
      // it (opts.wiki); on its own it's just its words.
      if (n.t === "wiki") {
        const w = opts && opts.wiki && opts.wiki(n);
        parent.appendChild(w || document.createTextNode(n.label));
        continue;
      }
      if (n.t === "link") {
        const href = safeHref(n.href);
        const a = document.createElement(href ? "a" : "span");
        if (href) { a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; }
        renderInline(a, n.children, opts);
        parent.appendChild(a);
        continue;
      }
      const tag = document.createElement(n.t === "bold" ? "strong" : "em");
      renderInline(tag, n.children, opts);
      parent.appendChild(tag);
    }
  }

  function render(text, opts) {
    const frag = document.createDocumentFragment();
    for (const b of parse(text)) {
      let node;
      if (b.t === "h") { node = document.createElement("h" + Math.min(6, b.level + 1)); renderInline(node, inline(b.text), opts); }
      else if (b.t === "p") { node = document.createElement("p"); renderInline(node, inline(b.text), opts); }
      else if (b.t === "hr") node = document.createElement("hr");
      else if (b.t === "table") {
        // Wrapped, so a wide table scrolls sideways on its own.
        node = document.createElement("div");
        node.className = "md-table";
        const table = document.createElement("table");
        const row = (cells, tag) => {
          const tr = document.createElement("tr");
          cells.forEach((c, k) => {
            const cell = document.createElement(tag);
            if (b.align[k]) cell.className = "md-al-" + b.align[k];
            renderInline(cell, inline(c), opts);
            tr.appendChild(cell);
          });
          return tr;
        };
        const thead = document.createElement("thead");
        thead.appendChild(row(b.head, "th"));
        table.appendChild(thead);
        if (b.rows.length) {
          const tbody = document.createElement("tbody");
          for (const r of b.rows) tbody.appendChild(row(r, "td"));
          table.appendChild(tbody);
        }
        node.appendChild(table);
      }
      else if (b.t === "code") {
        node = document.createElement("pre");
        const c = document.createElement("code");
        c.textContent = b.text;
        node.appendChild(c);
      } else if (b.t === "quote") {
        node = document.createElement("blockquote");
        node.appendChild(render(b.text, opts));
      } else {
        node = document.createElement(b.t);
        for (const it of b.items) {
          const li = document.createElement("li");
          if ("done" in it) {
            li.className = "md-task" + (it.done ? " is-done" : "");
            const box = document.createElement("span");
            box.className = "md-box";
            box.textContent = it.done ? "☑" : "☐";
            li.appendChild(box);
          }
          renderInline(li, inline(it.text), opts);
          node.appendChild(li);
        }
      }
      frag.appendChild(node);
    }
    return frag;
  }

  // Every picture a text points at, in order: { alt, src, embed? }.
  function images(text) {
    const out = [];
    const re = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g;
    for (const m of String(text || "").matchAll(re)) {
      out.push(m[1] != null ? { alt: "", src: m[1].trim(), embed: true, raw: m[0] } : { alt: m[2], src: m[3], raw: m[0] });
    }
    return out;
  }

  // Every [[link]] a text makes to a note or board, in order: { target,
  // heading, label, raw }. An embed (![[picture.png]]) is a picture, not a link.
  function wikiLinks(text) {
    const out = [];
    const re = new RegExp(WIKI.source, "g");
    const src = String(text || "");
    for (const m of src.matchAll(re)) {
      if (m.index && src[m.index - 1] === "!") continue;
      out.push({ target: m[1].trim(), heading: (m[2] || "").trim(), label: (m[3] || "").trim() || m[1].trim(), raw: m[0] });
    }
    return out;
  }
  // A text with each [[link]] as the words it shows (previews, exports).
  const unwiki = (text) => String(text || "").replace(new RegExp("(^|[^!])" + WIKI.source, "g"), (all, pre, t, h, l) => pre + (l || t).trim());

  window.LifeLogMarkdown = { parse, inline, render, safeHref, images, wikiLinks, unwiki };
})();
