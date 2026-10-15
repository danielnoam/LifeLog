// The Android widgets' icons, drawn from src/icons.js (0.269.0) so a widget
// shows the same Lucide drawing the app does. Each becomes a vector drawable,
// res/drawable/widget_ico_<name>.xml, stroked in the colour given here.
//   node tools/widget-icons.js           writes them
//   node tools/widget-icons.js --check   fails if any is out of date
// To add one: a line in WIDGET_ICONS, then run it.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "native/widgets/android/src/main/res/drawable");

// name: [colour resource, size in dp]
const WIDGET_ICONS = {
  "circle-dot": ["@color/widget_text", 22],
  "banknote": ["@color/widget_text", 22],
  "star": ["@color/widget_text", 22],
  "pencil": ["@color/widget_text", 22],
  "list-checks": ["@color/widget_text", 22],
  "flame": ["@color/widget_muted", 12],
  "check": ["@color/widget_on_accent", 16],
  "x": ["@color/widget_slip", 16],
  "refresh-cw": ["@color/widget_text", 16],
};

function lucide() {
  const src = fs.readFileSync(path.join(ROOT, "src/icons.js"), "utf8");
  const map = {};
  for (const m of src.matchAll(/^\s*"([a-z0-9-]+)": '(.*)',$/gm)) map[m[1]] = m[2];
  return map;
}

const attrs = (s) => Object.fromEntries([...s.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const n = (v) => +(+v).toFixed(3);

// One SVG element as path data. Android's pathData takes SVG's own syntax,
// arcs included; only the shapes need spelling out.
function pathOf(tag, a) {
  if (tag === "path") return a.d;
  if (tag === "circle") {
    const cx = +a.cx, cy = +a.cy, r = +a.r;
    return `M${n(cx - r)},${n(cy)}a${r},${r} 0 1,0 ${n(2 * r)},0a${r},${r} 0 1,0 ${n(-2 * r)},0`;
  }
  if (tag === "line") return `M${a.x1},${a.y1}L${a.x2},${a.y2}`;
  if (tag === "polyline") return "M" + a.points.trim().split(/\s+/).join("L");
  if (tag === "rect") {
    const x = +(a.x || 0), y = +(a.y || 0), w = +a.width, h = +a.height;
    const r = Math.min(+(a.rx || a.ry || 0), w / 2, h / 2);
    if (!r) return `M${x},${y}h${w}v${h}h${-w}z`;
    return `M${n(x + r)},${y}h${n(w - 2 * r)}a${r},${r} 0 0 1 ${r},${r}v${n(h - 2 * r)}a${r},${r} 0 0 1 ${-r},${r}`
      + `h${n(2 * r - w)}a${r},${r} 0 0 1 ${-r},${-r}v${n(2 * r - h)}a${r},${r} 0 0 1 ${r},${-r}z`;
  }
  throw new Error("No path for <" + tag + ">");
}

function drawable(name, inner, colour, dp) {
  const paths = [...inner.matchAll(/<(path|circle|rect|line|polyline)\b([^>]*)\/?>/g)].map((m) =>
    `    <path\n        android:pathData="${pathOf(m[1], attrs(m[2]))}"\n        android:strokeColor="${colour}"\n`
    + `        android:strokeWidth="2"\n        android:strokeLineCap="round"\n        android:strokeLineJoin="round" />`);
  return `<?xml version="1.0" encoding="utf-8"?>\n<!-- Lucide's "${name}", from src/icons.js by tools/widget-icons.js. Don't edit by hand. -->\n`
    + `<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="${dp}dp"\n    android:height="${dp}dp"\n`
    + `    android:viewportWidth="24"\n    android:viewportHeight="24">\n${paths.join("\n")}\n</vector>\n`;
}

function build() {
  const map = lucide();
  return Object.entries(WIDGET_ICONS).map(([name, [colour, dp]]) => {
    if (!map[name]) throw new Error(name + " isn't in src/icons.js");
    return { file: path.join(OUT, "widget_ico_" + name.replace(/-/g, "_") + ".xml"), xml: drawable(name, map[name], colour, dp) };
  });
}

if (require.main === module) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { file, xml } of build()) {
    const now = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (now === xml) continue;
    if (check) { console.error("out of date: " + path.relative(ROOT, file)); stale++; }
    else fs.writeFileSync(file, xml);
  }
  if (stale) { console.error("Run node tools/widget-icons.js"); process.exit(1); }
}

module.exports = { WIDGET_ICONS, build, pathOf };
