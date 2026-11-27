// Second safety layer for terminal_run: judge the command with the same guardrail.js
// that guards Claude Code's own Bash tool. Missing guardrail → allow (it is optional).
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { claudeDir } from "./config";

export type Verdict = { decision: "allow" | "ask" | "deny"; reason?: string };

export function judge(command: string): Promise<Verdict> {
  const script = path.join(claudeDir(), "hooks", "guardrail.js");
  if (!fs.existsSync(script)) return Promise.resolve({ decision: "allow" });
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(process.execPath, [script], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ decision: "allow" });
    }, 5000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ decision: "allow" });
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const o = JSON.parse(out).hookSpecificOutput;
        resolve({ decision: o.permissionDecision === "deny" ? "deny" : o.permissionDecision === "ask" ? "ask" : "allow", reason: o.permissionDecisionReason });
      } catch {
        resolve({ decision: "allow" });
      }
    });
    child.stdin.end(JSON.stringify({ tool_name: "mcp__vscode__terminal_run", tool_input: { command } }));
  });
}
