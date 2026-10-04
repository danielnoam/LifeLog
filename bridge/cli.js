#!/usr/bin/env node
// The bridge's tools as a command, for an AI (or a script) that runs shell
// commands rather than speaking MCP:
//
//   node bridge/cli.js                      lists the tools
//   node bridge/cli.js lifelog_spending --start_date 2026-09-01 --group_by month
//   node bridge/cli.js spending --json '{"start_date":"2026-09-01"}'
//
// The "lifelog_" prefix is optional. Values are read as JSON when they parse
// (numbers, true, arrays), as text otherwise. Exits 1 when the tool refused.
"use strict";

const { TOOLS, callTool, schemaOf } = require("./tools.js");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { Object.assign(out, JSON.parse(argv[++i] || "{}")); continue; }
    if (!a.startsWith("--")) throw new Error("Unexpected " + a);
    const [key, inline] = a.slice(2).split(/=(.*)/s);
    const raw = inline !== undefined ? inline : argv[++i];
    let v = raw;
    try { v = JSON.parse(raw); } catch (e) { /* plain text */ }
    out[key] = v;
  }
  return out;
}

(async () => {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || name === "help" || name === "--help") {
    for (const t of TOOLS) {
      const s = schemaOf(t);
      const params = Object.keys(s.properties).map((k) => ((s.required || []).includes(k) ? `--${k}` : `[--${k}]`)).join(" ");
      console.log(`${t.name}${t.readOnly ? "" : " (changes data)"} ${params}\n    ${t.description}`);
    }
    return;
  }
  const full = name.startsWith("lifelog_") ? name : "lifelog_" + name;
  let args;
  try { args = parseArgs(rest); } catch (e) { console.error(e.message); process.exit(2); }
  const r = await callTool(full, args);
  (r.ok ? console.log : console.error)(r.text);
  process.exitCode = r.ok ? 0 : 1;
})();
