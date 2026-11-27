#!/usr/bin/env node
/**
 * End-to-end test against a RUNNING VS Code with Cortex Sidekick loaded.
 *
 *   node test/e2e.mjs <claude-config-dir> <workspace-dir>
 *
 * Reads port + token from <claude-config-dir>/cortex/sidekick.json, connects as a real MCP
 * client, and exercises every tool plus the live-edit hook path. Use test/run-e2e.mjs to
 * launch an isolated VS Code and run this automatically.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [claudeDir, ws] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(HERE, "..", "..", "claude", "hooks", "sidekick-notify.js");
const conn = JSON.parse(fs.readFileSync(path.join(claudeDir, "cortex", "sidekick.json"), "utf8"));
const base = `http://127.0.0.1:${conn.port}`;
const auth = { Authorization: `Bearer ${conn.token}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => {
  c ? pass++ : fail++;
  console.log(`${c ? "PASS" : "FAIL"}  ${name}${!c && extra ? "\n      " + String(extra).slice(0, 400) : ""}`);
};

// 0. wait for the extension
let up = false;
for (let i = 0; i < 90 && !up; i++) {
  try { up = (await fetch(`${base}/health`, { headers: auth })).ok; } catch {}
  if (!up) await sleep(1000);
}
ok(up, "extension is listening");
if (!up) process.exit(1);

// security checks on the raw HTTP layer
ok((await fetch(`${base}/health`)).status === 401, "no token → 401");
ok((await fetch(`${base}/health`, { headers: { ...auth, Origin: "https://evil.example" } })).status === 403, "browser Origin → 403");

const client = new Client({ name: "e2e", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: auth } }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? "";
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { r, t, j };
};

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
ok(tools.length === 8, "8 tools exposed", tools.join(", "));

const sample = path.join(ws, "sample.ts");
let x = await call("open_file", { path: "sample.ts", line: 2, endLine: 3 });
ok(/Opened/.test(x.t), "open_file opens a workspace-relative path", x.t);
await sleep(800);
x = await call("editor_state");
ok(x.j.activeFile && path.resolve(x.j.activeFile).toLowerCase() === sample.toLowerCase(), "editor_state reports the active file", x.t);
ok(x.j.selection && x.j.selection.startLine === 2, "editor_state reports the selection", JSON.stringify(x.j.selection));

let diag = [];
for (let i = 0; i < 40; i++) {
  x = await call("get_diagnostics", { path: "sample.ts", severity: "error" });
  if (Array.isArray(x.j) && x.j.length) { diag = x.j; break; }
  await sleep(1000);
}
ok(diag.some((d) => /not assignable|Type 'string'/i.test(d.message)), "get_diagnostics returns the seeded TypeScript error", JSON.stringify(diag).slice(0, 300));

x = await call("terminal_run", { command: "node -v", timeoutSec: 60 });
ok(x.j.exitCode === 0 && /v\d+\./.test(x.j.output), "terminal_run runs node -v and reads output + exit code", x.t);

x = await call("terminal_run", { command: "node -e \"process.exit(3)\"", timeoutSec: 60 });
// PowerShell shell integration reports success/failure as 0/1, not the program's own code.
ok(typeof x.j.exitCode === "number" && x.j.exitCode !== 0, "terminal_run reports a failing exit code", x.t);

x = await call("terminal_run", { command: "rm -rf ~" });
ok(x.r.isError && /guardrail/i.test(x.t), "terminal_run refuses rm -rf ~ via the guardrail", x.t);

x = await call("terminal_read", {});
ok(Array.isArray(x.j) && x.j.some((e) => /node -v/.test(e.command) && /v\d+\./.test(e.output)), "terminal_read returns earlier commands with output", x.t.slice(0, 300));

x = await call("terminal_list");
ok(Array.isArray(x.j) && x.j.some((t) => t.name.startsWith("Claude") && t.shellIntegration), "terminal_list shows the Claude terminal with shell integration", x.t);

// Live edit through the real hook script, exactly as Claude Code would fire it.
const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeDir };
const hook = (event) =>
  spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: event, tool_name: "Edit", tool_input: { file_path: sample } }), env, encoding: "utf8" });
const original = fs.readFileSync(sample, "utf8");
hook("PreToolUse");
fs.writeFileSync(sample, original.replace("const greeting", "// edited by Claude\nconst greeting"));
const post = hook("PostToolUse");
ok(post.status === 0 && post.stdout === "", "sidekick-notify hook exits 0 silently");
await sleep(1500);
x = await call("editor_state");
const pend = x.j.claudeEditsAwaitingReview || [];
ok(pend.some((p) => path.resolve(p.file).toLowerCase() === sample.toLowerCase()), "edit appears in 'awaiting review'", JSON.stringify(pend));

x = await call("show_diff", { path: sample });
ok(/Diff opened/.test(x.t), "show_diff opens a before/after diff", x.t);

// New file created by Claude: the hook path must record it as new (Revert = delete).
const nf = path.join(ws, "brand-new.ts");
spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: nf } }), env });
fs.writeFileSync(nf, "export const created = true;\n");
spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: nf } }), env });
await sleep(1500);
x = await call("editor_state");
ok((x.j.claudeEditsAwaitingReview || []).some((p) => p.newFile && /brand-new/.test(p.file)), "a newly created file is tracked as new", JSON.stringify(x.j.claudeEditsAwaitingReview));

x = await call("debug_output");
ok(typeof x.t === "string", "debug_output responds");

await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
