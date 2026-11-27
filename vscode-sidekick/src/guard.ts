// Second safety layer for terminal_run: judge the command with the same guardrail.js
// that guards Claude Code's own Bash tool. Fails CLOSED: if the check cannot run (missing,
// crashed, timed out, unreadable answer) the user is asked, never silently allowed.
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { claudeDir } from "./config";

export type Verdict = { decision: "allow" | "ask" | "deny"; reason?: string };

export function judge(command: string): Promise<Verdict> {
  const script = path.join(claudeDir(), "hooks", "guardrail.js");
  const unchecked = (why: string): Verdict => ({ decision: "ask", reason: `The safety check could not run (${why}), so this command was not checked.` });
  if (!fs.existsSync(script)) return Promise.resolve(unchecked("guardrail.js is missing"));
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(process.execPath, [script], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve(unchecked("it timed out"));
    }, 5000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(unchecked("it failed to start"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // The guardrail prints nothing and exits 0 when a command is fine.
      if (code === 0 && !out.trim()) return resolve({ decision: "allow" });
      try {
        const o = JSON.parse(out).hookSpecificOutput;
        resolve({ decision: o.permissionDecision === "deny" ? "deny" : o.permissionDecision === "ask" ? "ask" : "allow", reason: o.permissionDecisionReason });
      } catch {
        resolve(unchecked("its answer was unreadable"));
      }
    });
    child.stdin.end(JSON.stringify({ tool_name: "mcp__vscode__terminal_run", tool_input: { command } }));
  });
}
