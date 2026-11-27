// Shared connection details. The installer (or the extension, on first run) writes
// ~/.claude/cortex/sidekick.json = { port, token }; `claude mcp add` uses the same token.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";

export interface Conn {
  port: number;
  token: string;
  file: string;
}

export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function loadConn(): Conn {
  const file = path.join(claudeDir(), "cortex", "sidekick.json");
  const port = vscode.workspace.getConfiguration("cortexSidekick").get<number>("port", 7341);
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    if (typeof j.token === "string" && j.token.length >= 32) return { port: j.port || port, token: j.token, file };
  } catch {
    /* first run: create below */
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ port, token }, null, 2) + "\n", { mode: 0o600 });
  return { port, token, file };
}

export function setupCommand(c: Conn): string {
  return `claude mcp add --scope user --transport http vscode http://127.0.0.1:${c.port}/mcp --header "Authorization: Bearer ${c.token}"`;
}

export function cfg<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("cortexSidekick").get<T>(key, fallback);
}

/** Resolve a tool's path argument: absolute stays, relative is against the first workspace folder. */
export function resolvePath(p: string): string {
  if (path.isAbsolute(p)) return path.normalize(p);
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return path.normalize(root ? path.join(root, p) : p);
}
