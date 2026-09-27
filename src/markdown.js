// LifeLog — Markdown, read (0.204.0). A note in a collection opens as a page
// rather than a text box, and most of those came in as .md files: headings,
// lists, tasks, code, quotes, links, bold and italic are what they use.
//
// parse() is pure (test/markdown.test.js): text in, a small tree out.
// render() turns that tree into DOM with createElement and textContent only,
// never innerHTML — a note is whatever was typed or imported, and none of it
// may become markup. Links are kept only when they're http(s) or mailto.
(function () {
  const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const TASK = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
  const BULLET = /^\s*[-*+]\s+(.*)$/;
  const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
  const QUOTE = /^\s*>\s?(.*)$/;
  const FENCE = /^\s*(```|~~~)/;
  const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

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
        && !QUOTE.test(lines[i]) && !TASK.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) {
        para.push(lines[i++]);
      }
      if (!para.length) { para.push(lines[i++]); }
      blocks.push({ t: "p", text: para.join("\n") });
    }
    return blocks;
  }

  // Inline: `code`, **bold**, *italic* / _italic_, [text](url), and bare
  // links. Earliest match wins; what's inside bold or italic is parsed again.
  const INLINE = [
    ["code", /`([^`]+)`/],
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
      else if (t === "link") out.push({ t, href: m[2], children: inline(m[1]) });
      else if (t === "url") out.push({ t: "link", href: m[0], children: [{ t: "text", text: m[0] }] });
      else out.push({ t, children: inline(m[1] || m[2]) });
      rest = rest.slice(m.index + m[0].length);
    }
    return out;
  }

  const safeHref = (href) => (/^(https?:|mailto:)/i.test(href) ? href : null);

  function renderInline(parent, nodes) {
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
      if (n.t === "link") {
        const href = safeHref(n.href);
        const a = document.createElement(href ? "a" : "span");
        if (href) { a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; }
        renderInline(a, n.children);
        parent.appendChild(a);
        continue;
      }
      const tag = document.createElement(n.t === "bold" ? "strong" : "em");
      renderInline(tag, n.children);
      parent.appendChild(tag);
    }
  }

  function render(text) {
    const frag = document.createDocumentFragment();
    for (const b of parse(text)) {
      let node;
      if (b.t === "h") { node = document.createElement("h" + Math.min(6, b.level + 1)); renderInline(node, inline(b.text)); }
      else if (b.t === "p") { node = document.createElement("p"); renderInline(node, inline(b.text)); }
      else if (b.t === "hr") node = document.createElement("hr");
      else if (b.t === "code") {
        node = document.createElement("pre");
        const c = document.createElement("code");
        c.textContent = b.text;
        node.appendChild(c);
      } else if (b.t === "quote") {
        node = document.createElement("blockquote");
        node.appendChild(render(b.text));
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
          renderInline(li, inline(it.text));
          node.appendChild(li);
        }
      }
      frag.appendChild(node);
    }
    return frag;
  }

  window.LifeLogMarkdown = { parse, inline, render, safeHref };
})();
