#!/usr/bin/env node
// LifeLog's MCP server: `node bridge/mcp.js`, spoken to over stdio by any MCP
// client (Telemachus, Claude Desktop or Code, Cursor, ...). No SDK: MCP over
// stdio is JSON-RPC 2.0, one message per line, and the few methods below are
// all a tools-and-resources server needs. Logs go to stderr; stdout is the
// protocol's alone.
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { TOOLS, callTool, schemaOf, version } = require("./tools.js");

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const GUIDE_URI = "lifelog://guide";

const INSTRUCTIONS = "LifeLog is the user's personal log: a timeline of what they did and finished, a backlog of what's next, "
  + "notes and checklists, habits, and a ledger of expenses and recurring bills. Call lifelog_overview first for today's date, "
  + "the currency and the exact category names. Answer from the tools rather than guessing; amounts are in the home currency. "
  + "Every change is saved to the user's own data and syncs to their devices, so make changes only when asked, and say what "
  + "you changed. lifelog_undo reverses the last one.";

function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      const asked = params && params.protocolVersion;
      return {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "lifelog", title: "LifeLog", version },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: schemaOf(t),
          annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false },
        })),
      };
    case "tools/call":
      return callTool(params && params.name, (params && params.arguments) || {})
        .then((r) => ({ content: [{ type: "text", text: r.text }], isError: !r.ok }));
    case "resources/list":
      return { resources: [{ uri: GUIDE_URI, name: "LifeLog data guide", mimeType: "text/markdown",
        description: "Every collection and field in LifeLog's data, and what each means." }] };
    case "resources/read":
      if (!params || params.uri !== GUIDE_URI) throw Object.assign(new Error("Unknown resource"), { code: -32602 });
      return { contents: [{ uri: GUIDE_URI, mimeType: "text/markdown", text: fs.readFileSync(path.join(__dirname, "DATA.md"), "utf8") }] };
    default:
      if (id === undefined) return undefined; // a notification: nothing to say
      throw Object.assign(new Error("Method not found: " + method), { code: -32601 });
  }
}

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (e) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  for (const m of Array.isArray(msg) ? msg : [msg]) {
    if (!m || m.method === undefined) continue; // a response to us; we ask nothing
    try {
      const result = await handle(m);
      if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result });
    } catch (e) {
      if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: e.code || -32603, message: e.message } });
    }
  }
});
rl.on("close", () => process.exit(0));
process.stderr.write(`LifeLog bridge ${version} ready (MCP over stdio)\n`);
