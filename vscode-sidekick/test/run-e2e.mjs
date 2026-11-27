#!/usr/bin/env node
/**
 * Launches an ISOLATED VS Code (throwaway user-data, extensions and Claude config dirs)
 * with the extension loaded from source, seeds a workspace with a TypeScript error, runs
 * test/e2e.mjs against it, then closes that VS Code window.
 *
 *   node test/run-e2e.mjs          (needs the `code` CLI on PATH and `npm run build` done)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sidekick-e2e-"));
const claudeDir = path.join(TMP, "claude");
const ws = path.join(TMP, "workspace");
const userData = path.join(TMP, "user-data");
const port = 7399; // not the default, so a real install on this machine is untouched

fs.mkdirSync(path.join(claudeDir, "hooks"), { recursive: true });
fs.copyFileSync(path.join(EXT, "..", "claude", "hooks", "guardrail.js"), path.join(claudeDir, "hooks", "guardrail.js"));
fs.mkdirSync(path.join(userData, "User"), { recursive: true });
fs.writeFileSync(
  path.join(userData, "User", "settings.json"),
  JSON.stringify({ "cortexSidekick.port": port, "security.workspace.trust.enabled": false, "workbench.startupEditor": "none", "git.enabled": false })
);
fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }));
fs.writeFileSync(path.join(ws, "sample.ts"), "// sample\nconst greeting: number = \"hello\";\nexport { greeting };\n");

const code = process.platform === "win32" ? "code.cmd" : "code";
const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeDir };
const vs = spawn(
  code,
  [
    "--new-window",
    `--user-data-dir=${userData}`,
    `--extensions-dir=${path.join(TMP, "exts")}`,
    `--extensionDevelopmentPath=${EXT}`,
    "--disable-workspace-trust",
    path.join(ws, "sample.ts"),
    ws,
  ],
  { env, shell: process.platform === "win32", stdio: "ignore", detached: true }
);
vs.unref();

// The extension writes sidekick.json on activation; wait for it.
const conn = path.join(claudeDir, "cortex", "sidekick.json");
for (let i = 0; i < 90 && !fs.existsSync(conn); i++) await new Promise((r) => setTimeout(r, 1000));
const r = spawnSync(process.execPath, [path.join(EXT, "test", "e2e.mjs"), claudeDir, ws], { stdio: "inherit", env });

if (!process.argv.includes("--keep-open")) {
  // Close only the VS Code processes using this throwaway profile.
  try {
    if (process.platform === "win32") {
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='Code.exe'\\" | Where-Object { $_.CommandLine -like '*${path.basename(TMP)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
        { stdio: "ignore" }
      );
    } else execSync(`pkill -f "${path.basename(TMP)}"`, { stdio: "ignore" });
  } catch {}
}
console.log(`(workspace: ${ws})`);
process.exit(r.status ?? 1);
