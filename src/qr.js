// Minimal self-contained QR Code encoder for LifeLog's setup link.
// Byte mode, error-correction level L, versions 1-9 (auto-picked). Self-hosted
// so the token in the link is NEVER sent to an external QR service.
// Exposes: window.LifeLogQR.svg(text, {size}) -> <svg> string (or null if the
// text is too long for v1-9), and window.LifeLogQR.fits(text) -> bool.
(function () {
  "use strict";

  // ---------- GF(256) arithmetic ----------
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  function genPoly(deg) {
    let p = [1];
    for (let i = 0; i < deg; i++) {
      const q = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) { q[j] ^= p[j]; q[j + 1] ^= gmul(p[j], EXP[i]); }
      p = q;
    }
    return p; // length deg+1, p[0] === 1
  }
  function ecBytes(data, ecLen) {
    const gen = genPoly(ecLen);
    const rem = new Array(ecLen).fill(0);
    for (let i = 0; i < data.length; i++) {
      const f = data[i] ^ rem[0];
      rem.shift(); rem.push(0);
      for (let j = 0; j < ecLen; j++) rem[j] ^= gmul(gen[j + 1], f);
    }
    return rem;
  }

  // ---------- per-version tables (EC level L) ----------
  // ec = EC codewords per block, blocks = number of (uniform) blocks, data = total data codewords
  const ECL = {
    1: { ec: 7, blocks: 1, data: 19 }, 2: { ec: 10, blocks: 1, data: 34 },
    3: { ec: 15, blocks: 1, data: 55 }, 4: { ec: 20, blocks: 1, data: 80 },
    5: { ec: 26, blocks: 1, data: 108 }, 6: { ec: 18, blocks: 2, data: 136 },
    7: { ec: 20, blocks: 2, data: 156 }, 8: { ec: 24, blocks: 2, data: 194 },
    9: { ec: 30, blocks: 2, data: 232 },
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
  };

  function utf8(text) {
    const s = unescape(encodeURIComponent(text));
    const a = []; for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i));
    return a;
  }
  function chooseVersion(n) {
    for (let v = 1; v <= 9; v++) if (ECL[v].data >= n + 2) return v;
    return null;
  }

  function encodeData(bytes, version) {
    const total = ECL[version].data;
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    put(4, 4);                 // byte mode
    put(bytes.length, 8);      // char count (8 bits for v1-9)
    for (const b of bytes) put(b, 8);
    const cap = total * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0); // terminator
    while (bits.length % 8) bits.push(0);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; cw.push(v); }
    const pad = [0xEC, 0x11]; let pi = 0;
    while (cw.length < total) cw.push(pad[pi++ % 2]);
    return cw;
  }
  function interleave(dataCw, version) {
    const info = ECL[version], nb = info.blocks, per = info.data / nb, ecLen = info.ec;
    const dBlocks = [], eBlocks = [];
    for (let b = 0; b < nb; b++) { const blk = dataCw.slice(b * per, (b + 1) * per); dBlocks.push(blk); eBlocks.push(ecBytes(blk, ecLen)); }
    const out = [];
    for (let i = 0; i < per; i++) for (let b = 0; b < nb; b++) out.push(dBlocks[b][i]);
    for (let i = 0; i < ecLen; i++) for (let b = 0; b < nb; b++) out.push(eBlocks[b][i]);
    return out;
  }

  // ---------- BCH for format / version info ----------
  function formatBits(mask) {
    const data = (1 << 3) | mask; // level L = 0b01
    let rem = data << 10;
    for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
    return (((data << 10) | rem) ^ 0x5412) & 0x7FFF;
  }
  function versionBits(version) {
    let rem = version << 12;
    for (let i = 17; i >= 12; i--) if ((rem >> i) & 1) rem ^= 0x1F25 << (i - 12);
    return ((version << 12) | rem) & 0x3FFFF;
  }

  // ---------- matrix ----------
  function newMatrix(version) {
    const size = version * 4 + 17;
    const m = [], fn = [];
    for (let r = 0; r < size; r++) { m.push(new Array(size).fill(0)); fn.push(new Array(size).fill(false)); }
    const set = (r, c, v) => { m[r][c] = v ? 1 : 0; fn[r][c] = true; };

    function finder(r0, c0) {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        if (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) {
          const on = dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          set(r, c, on);
        } else set(r, c, 0); // separator
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); } // timing

    const ap = ALIGN[version];
    for (const r of ap) for (const c of ap) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }

    set(size - 8, 8, 1); // dark module

    // reserve format-info modules (values written later)
    for (let i = 0; i <= 8; i++) { if (i !== 6) { fn[8][i] = true; fn[i][8] = true; } }
    for (let i = 0; i < 8; i++) { fn[8][size - 1 - i] = true; fn[size - 1 - i][8] = true; }
    // reserve version-info modules (v7+)
    if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { fn[i][size - 11 + j] = true; fn[size - 11 + j][i] = true; }

    return { m, fn, size };
  }

  function placeData(st, cw) {
    const { m, fn, size } = st;
    let idx = 0; const totalBits = cw.length * 8;
    const bit = () => { if (idx >= totalBits) return 0; const b = (cw[idx >> 3] >> (7 - (idx & 7))) & 1; idx++; return b; };
    let up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5; // skip timing column
      for (let i = 0; i < size; i++) {
        const row = up ? size - 1 - i : i;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (!fn[row][cc]) m[row][cc] = bit();
        }
      }
      up = !up;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function writeFormat(m, size, mask) {
    const bits = formatBits(mask); // 15-bit, placed MSB (bit14) first
    const b = (i) => (bits >> i) & 1;
    // copy 1 (around top-left finder)
    for (let i = 0; i <= 5; i++) m[8][i] = b(14 - i); // (8,0..5) <- bit14..bit9
    m[8][7] = b(8); m[8][8] = b(7); m[7][8] = b(6);
    const rows = [5, 4, 3, 2, 1, 0];
    for (let i = 0; i < 6; i++) m[rows[i]][8] = b(5 - i); // (5,8)..(0,8) <- bit5..bit0
    // copy 2 (split: bottom of col 8, then right of row 8)
    for (let i = 0; i < 7; i++) m[size - 1 - i][8] = b(14 - i); // rows size-1..size-7 <- bit14..bit8
    for (let i = 0; i < 8; i++) m[8][size - 8 + i] = b(7 - i);  // cols size-8..size-1 <- bit7..bit0
  }
  function writeVersion(m, size, version) {
    if (version < 7) return;
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const b = (bits >> i) & 1;
      const a = Math.floor(i / 3), d = i % 3;
      m[size - 11 + d][a] = b; m[a][size - 11 + d] = b;
    }
  }

  function penalty(m, size) {
    let p = 0;
    for (let r = 0; r < size; r++) {
      let rc = 1, cc = 1;
      for (let c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) { rc++; if (rc === 5) p += 3; else if (rc > 5) p++; } else rc = 1;
        if (m[c][r] === m[c - 1][r]) { cc++; if (cc === 5) p += 3; else if (cc > 5) p++; } else cc = 1;
      }
    }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
    const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const scan = (arr) => {
      let s = 0;
      for (let i = 0; i + 11 <= arr.length; i++) {
        let a = true, b = true;
        for (let k = 0; k < 11; k++) { if (arr[i + k] !== p1[k]) a = false; if (arr[i + k] !== p2[k]) b = false; }
        if (a || b) s += 40;
      }
      return s;
    };
    for (let r = 0; r < size; r++) { p += scan(m[r]); const col = []; for (let c = 0; c < size; c++) col.push(m[c][r]); p += scan(col); }
    let dark = 0; for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
    p += Math.floor(Math.abs(dark / (size * size) * 100 - 50) / 5) * 10;
    return p;
  }

  function buildMask(version, cw, mask) {
    const st = newMatrix(version);
    placeData(st, cw);
    const fnMask = MASKS[mask];
    for (let r = 0; r < st.size; r++) for (let c = 0; c < st.size; c++) if (!st.fn[r][c] && fnMask(r, c)) st.m[r][c] ^= 1;
    writeFormat(st.m, st.size, mask);
    writeVersion(st.m, st.size, version);
    return st;
  }
  function build(text, forceMask) {
    const bytes = utf8(text);
    const version = chooseVersion(bytes.length);
    if (!version) return null;
    const cw = interleave(encodeData(bytes, version), version);
    if (forceMask != null) return buildMask(version, cw, forceMask);

    let best = null, bestPen = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const st = buildMask(version, cw, mask);
      const pen = penalty(st.m, st.size);
      if (pen < bestPen) { bestPen = pen; best = st; }
    }
    return best;
  }

  function svg(text, opts) {
    opts = opts || {};
    const st = build(text);
    if (!st) return null;
    const size = st.size, q = 4, dim = size + q * 2;
    let d = "";
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (st.m[r][c]) d += "M" + (c + q) + " " + (r + q) + "h1v1h-1z";
    const px = opts.size || 180;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + " " + dim + '" width="' + px + '" height="' + px +
      '" shape-rendering="crispEdges"><rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/><path d="' + d + '" fill="#000000"/></svg>';
  }

  window.LifeLogQR = {
    svg: svg, fits: (t) => chooseVersion(utf8(t).length) !== null,
    _debug: (t, mask) => { const st = build(t, mask); return st ? { size: st.size, rows: st.m.map((r) => r.join("")) } : null; },
  };
})();
