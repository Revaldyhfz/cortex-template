#!/usr/bin/env node
/**
 * Cortex installer — copies the template into ~/.claude and your vault, and wires the
 * hooks into ~/.claude/settings.json. Works on Windows, macOS and Linux (Node 18+).
 *
 *   node install.mjs                       # vault at ~/Cortex-Vault
 *   node install.mjs --vault "D:/Notes"    # vault somewhere else (an existing Obsidian vault is fine)
 *   node install.mjs --dry-run             # show what would happen, change nothing
 *   node install.mjs --force               # overwrite files that already exist (backups are still made)
 *   node install.mjs --no-vscode           # skip the VS Code Sidekick (extension + MCP registration)
 *   node install.mjs --no-open             # do not open the welcome page at the end
 *
 * Safe by default:
 *   - An existing file with different content is NOT overwritten. The template version is
 *     written next to it as <name>.cortex-new so you can merge by hand (or pass --force).
 *   - settings.json is backed up before it is touched, and hooks are MERGED, never replaced.
 *   - Existing vault files are never overwritten.
 *   - Everything installed is recorded in ~/.claude/cortex/install-manifest.json, which
 *     uninstall.mjs uses to undo exactly this.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

if (flag("--help") || flag("-h")) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}

const DRY = flag("--dry-run");
const FORCE = flag("--force");
const NO_VSCODE = flag("--no-vscode");
const NO_OPEN = flag("--no-open");
const HOME = os.homedir();
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const expandHome = (p) => (p.startsWith("~") ? path.join(HOME, p.slice(1)) : p);
const VAULT = path.resolve(expandHome(opt("--vault", path.join(HOME, "Cortex-Vault"))));
const fwd = (p) => p.replace(/\\/g, "/");

const [major] = process.versions.node.split(".").map(Number);
if (major < 18) {
  console.error(`Node ${process.versions.node} is too old; Cortex needs Node 18 or newer.`);
  process.exit(1);
}

const manifestPath = path.join(CLAUDE, "cortex", "install-manifest.json");
const prior = readJson(manifestPath, null);
const manifest = {
  installedAt: new Date().toISOString(),
  vault: fwd(VAULT),
  claudeDir: fwd(CLAUDE),
  files: prior ? prior.files : [], // files this installer CREATED (safe for uninstall to remove)
  settingsBackup: prior ? prior.settingsBackup : null,
  setAutoMemoryDirectory: prior ? prior.setAutoMemoryDirectory : false,
  vscodeExtension: prior ? !!prior.vscodeExtension : false,
  mcpServer: prior ? !!prior.mcpServer : false,
};
const report = { created: [], same: [], conflict: [], overwritten: [] };

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// Fill <VAULT> in Markdown so rules and skills point at the real vault path.
function render(src) {
  const raw = fs.readFileSync(src);
  if (!/\.(md|json)$/i.test(src)) return raw;
  return Buffer.from(raw.toString("utf8").split("<VAULT>").join(fwd(VAULT)), "utf8");
}

/** Copy one file. mode "template": conflict → .cortex-new. mode "keep": never touch an existing file. */
function place(src, dest, mode = "template") {
  const data = render(src);
  const rel = fwd(dest);
  if (fs.existsSync(dest)) {
    if (Buffer.compare(fs.readFileSync(dest), data) === 0) return report.same.push(rel);
    if (mode === "keep") return report.same.push(rel + " (kept yours)");
    if (!FORCE) {
      if (!DRY) fs.writeFileSync(dest + ".cortex-new", data);
      return report.conflict.push(rel);
    }
    if (!DRY) {
      fs.copyFileSync(dest, dest + `.bak-${stamp()}`);
      fs.writeFileSync(dest, data);
    }
    return report.overwritten.push(rel);
  }
  if (!DRY) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  if (!manifest.files.includes(rel)) manifest.files.push(rel);
  report.created.push(rel);
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
}

// ---------------------------------------------------------------- 1. files into ~/.claude

const SRC = path.join(REPO, "claude");
// Decided ONCE, before copying: does the user already have memories of their own?
const memDir = path.join(CLAUDE, "memory");
const seededBefore = (prior ? prior.files : []).some((f) => f.includes("/memory/"));
const hasRealMemory =
  !seededBefore && fs.existsSync(memDir) && fs.readdirSync(memDir).some((f) => f.endsWith(".md"));
for (const src of walk(SRC)) {
  const rel = path.relative(SRC, src);
  const top = rel.split(path.sep)[0];
  if (rel === path.join("cortex", "cortex-config.example.json")) continue; // written below
  // Memory examples only seed an EMPTY memory folder; never mix into real memories.
  if (top === "memory") {
    if (hasRealMemory) continue;
    place(src, path.join(CLAUDE, rel), "keep");
    continue;
  }
  place(src, path.join(CLAUDE, rel));
}

// cortex-config.json: where the capture engine writes.
const cfgPath = path.join(CLAUDE, "cortex", "cortex-config.json");
const cfg = readJson(cfgPath, null);
if (!cfg || FORCE) {
  const body = JSON.stringify({ vaultPath: fwd(VAULT), cortexRoot: "Cortex", version: 1 }, null, 2) + "\n";
  if (!DRY) {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, body); // BOM-less on purpose: JSON.parse rejects a BOM
  }
  if (!cfg && !manifest.files.includes(fwd(cfgPath))) manifest.files.push(fwd(cfgPath));
  report.created.push(fwd(cfgPath));
} else if (cfg.vaultPath && fwd(expandHome(cfg.vaultPath)) !== fwd(VAULT)) {
  console.log(`! cortex-config.json already points at ${cfg.vaultPath}; leaving it (use --force to change it).`);
}

// ---------------------------------------------------------------- 2. vault skeleton

const VSRC = path.join(REPO, "vault");
for (const src of walk(VSRC)) {
  const rel = path.relative(VSRC, src);
  place(src, path.join(VAULT, rel), "keep");
}

// ---------------------------------------------------------------- 3. hooks into settings.json

const settingsPath = path.join(CLAUDE, "settings.json");
const settings = readJson(settingsPath, {});
if (fs.existsSync(settingsPath) && readJson(settingsPath, null) === null) {
  console.error(`! ${settingsPath} exists but is not valid JSON. Fix it first; nothing in it was changed.`);
  process.exit(1);
}
const before = JSON.stringify(settings);
const hookCmd = (script) => `node "${fwd(path.join(CLAUDE, script))}"`;

const WANT = [
  { event: "Stop", script: "cortex/cortex-sync.js", timeout: 120, statusMessage: "Cortex: capturing session" },
  { event: "SessionEnd", script: "cortex/cortex-sync.js", timeout: 120, statusMessage: "Cortex: finalizing session" },
  {
    event: "PreToolUse",
    matcher: "Bash|PowerShell|Read|Write|Edit|NotebookEdit|Grep|Glob|mcp__|Agent",
    script: "hooks/guardrail.js",
    timeout: 10,
  },
  { event: "Stop", script: "autonomous/autonomous.js", timeout: 10 },
  { event: "PostToolUse", script: "hooks/context-watch.js", timeout: 5 },
  { event: "PreToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit", script: "hooks/sidekick-notify.js", timeout: 5 },
  { event: "PostToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit", script: "hooks/sidekick-notify.js", timeout: 5 },
  { event: "SessionStart", matcher: "compact", script: "hooks/post-compact.js", timeout: 10 },
  {
    event: "UserPromptSubmit",
    script: "hooks/memory-surface.js",
    timeout: 10,
    statusMessage: "Memory: surfacing relevant notes",
  },
];

settings.hooks = settings.hooks || {};
for (const w of WANT) {
  const groups = (settings.hooks[w.event] = settings.hooks[w.event] || []);
  const name = path.basename(w.script);
  const already = groups.some((g) => (g.hooks || []).some((h) => String(h.command || "").includes(name)));
  if (already) continue;
  const hook = { type: "command", command: hookCmd(w.script), timeout: w.timeout };
  if (w.statusMessage) hook.statusMessage = w.statusMessage;
  groups.push(w.matcher ? { matcher: w.matcher, hooks: [hook] } : { hooks: [hook] });
}

// Keep auto-memory in one global folder so memory-surface.js can find it from any project.
if (!settings.autoMemoryDirectory) {
  settings.autoMemoryDirectory = "~/.claude/memory";
  manifest.setAutoMemoryDirectory = true;
}

let settingsChanged = JSON.stringify(settings) !== before;
if (settingsChanged && !DRY) {
  fs.mkdirSync(CLAUDE, { recursive: true });
  if (fs.existsSync(settingsPath)) {
    const bak = `${settingsPath}.bak-cortex-${stamp()}`;
    fs.copyFileSync(settingsPath, bak);
    if (!manifest.settingsBackup) manifest.settingsBackup = fwd(bak);
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

// ---------------------------------------------------------------- 4. VS Code Sidekick

/** Run a CLI. On Windows `code` and `claude` may be .cmd shims, which need a shell. */
function sh(cmd, argv) {
  const win = process.platform === "win32";
  const q = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const r = win
    ? spawnSync([cmd, ...argv].map(q).join(" "), { shell: true, encoding: "utf8", timeout: 120000 })
    : spawnSync(cmd, argv, { encoding: "utf8", timeout: 120000 });
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}`.trim(), missing: r.error?.code === "ENOENT" || r.status === 127 || /not recognized|not found/i.test(r.stderr || "") };
}
const has = (cmd) => sh(cmd, ["--version"]).ok;

const sidekick = { status: "skipped (--no-vscode)", notes: [] };
const VSIX = path.join(REPO, "vscode-sidekick", "dist", "cortex-sidekick.vsix");
if (!NO_VSCODE) {
  const connPath = path.join(CLAUDE, "cortex", "sidekick.json");
  let conn = readJson(connPath, null);
  if (!conn || typeof conn.token !== "string" || conn.token.length < 32) {
    conn = { port: 7341, token: crypto.randomBytes(32).toString("hex") };
    if (!DRY) {
      fs.mkdirSync(path.dirname(connPath), { recursive: true });
      fs.writeFileSync(connPath, JSON.stringify(conn, null, 2) + "\n", { mode: 0o600 }); // BOM-less
    }
  }
  const haveCode = has("code");
  const haveClaude = has("claude");
  if (!haveCode) sidekick.notes.push("VS Code's `code` command was not found. Install VS Code, run \"Shell Command: Install 'code' command in PATH\" (macOS) if needed, then re-run the installer.");
  else if (!fs.existsSync(VSIX)) sidekick.notes.push(`Extension package missing at ${fwd(VSIX)}; run \`npm run package\` in vscode-sidekick/.`);
  else if (!DRY) {
    const r = sh("code", ["--install-extension", VSIX, "--force"]);
    if (r.ok) manifest.vscodeExtension = true;
    else sidekick.notes.push("Installing the VS Code extension failed: " + r.out.slice(0, 300));
  }
  if (!haveClaude) sidekick.notes.push("The `claude` command was not found, so the MCP server was not registered. Re-run the installer from a terminal where `claude --version` works.");
  else if (!DRY) {
    const url = `http://127.0.0.1:${conn.port}/mcp`;
    const existing = sh("claude", ["mcp", "get", "vscode"]);
    if (existing.ok && !existing.out.includes(url) && !FORCE) {
      sidekick.notes.push("An MCP server named \"vscode\" already exists and is not the Sidekick; left it alone (re-run with --force to replace it).");
    } else {
      if (existing.ok) sh("claude", ["mcp", "remove", "vscode", "-s", "user"]);
      const r = sh("claude", ["mcp", "add", "--scope", "user", "--transport", "http", "vscode", url, "--header", `Authorization: Bearer ${conn.token}`]);
      if (r.ok) manifest.mcpServer = true;
      else sidekick.notes.push("Registering the MCP server failed: " + r.out.slice(0, 300));
    }
  }
  sidekick.status = DRY
    ? `would install (code: ${haveCode ? "found" : "missing"}, claude: ${haveClaude ? "found" : "missing"})`
    : manifest.vscodeExtension && manifest.mcpServer
      ? `installed — extension in VS Code, MCP server "vscode" on 127.0.0.1:${conn.port}`
      : manifest.vscodeExtension || manifest.mcpServer
        ? "partly installed — see the installer output"
        : "not installed — see the installer output";
}

// ---------------------------------------------------------------- 5. welcome page

function repoUrl() {
  const r = spawnSync("git", ["-C", REPO, "remote", "get-url", "origin"], { encoding: "utf8" });
  const u = (r.status === 0 ? r.stdout.trim() : "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\/\/[^@/]+@/, "//") // drop any embedded credentials
    .replace(/\.git$/, "");
  return /^https:\/\//.test(u) ? u : "https://github.com/";
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const welcomeSrc = path.join(REPO, "welcome", "welcome.html");
const welcomeDest = path.join(CLAUDE, "cortex", "welcome.html");
if (fs.existsSync(welcomeSrc) && !DRY) {
  const html = fs
    .readFileSync(welcomeSrc, "utf8")
    .split("{{VAULT}}").join(esc(fwd(VAULT)))
    .split("{{CLAUDE_DIR}}").join(esc(fwd(CLAUDE)))
    .split("{{REPO_DIR}}").join(esc(fwd(REPO)))
    .split("{{REPO_URL}}").join(esc(repoUrl()))
    .split("{{SIDEKICK_STATUS}}").join(esc(sidekick.status));
  fs.mkdirSync(path.dirname(welcomeDest), { recursive: true });
  fs.writeFileSync(welcomeDest, html);
}

// ---------------------------------------------------------------- 6. manifest + report

if (!DRY) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

const line = (label, list) => list.length && console.log(`\n${label} (${list.length})\n  ` + list.join("\n  "));
console.log(DRY ? "Cortex install — DRY RUN, nothing was changed" : "Cortex install — done");
console.log(`  Claude config: ${fwd(CLAUDE)}\n  Vault:         ${fwd(VAULT)}`);
line("Created", report.created);
line("Already identical", report.same);
line("Overwritten (backup saved as .bak-*)", report.overwritten);
line("CONFLICT — yours kept, template saved beside it as .cortex-new; merge by hand", report.conflict);
console.log(`\nsettings.json: ${settingsChanged ? "hooks merged (backup saved)" : "already had the Cortex hooks"}`);
console.log(`VS Code Sidekick: ${sidekick.status}`);
for (const n of sidekick.notes) console.log(`  ! ${n}`);
console.log(`
Next:
  1. Restart Claude Code (hooks, rules and MCP servers load at startup).
     If VS Code was already open, reload its window once (Ctrl/Cmd+Shift+P → "Reload Window").
  2. In Claude Code, say "personalise my Cortex setup" — it fills in ~/.claude/CLAUDE.md
     by asking you a few questions.
  3. Have a short chat, then check ${fwd(path.join(VAULT, "Cortex", "Sessions"))} for the captured note.
  Welcome page: ${fwd(welcomeDest)}
  Undo everything: node uninstall.mjs`);

if (!DRY && !NO_OPEN && fs.existsSync(welcomeDest)) {
  const opener =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", welcomeDest]] : process.platform === "darwin" ? ["open", [welcomeDest]] : ["xdg-open", [welcomeDest]];
  try {
    spawnSync(opener[0], opener[1], { stdio: "ignore", timeout: 10000 });
  } catch {}
}
