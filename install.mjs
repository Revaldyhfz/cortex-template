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
 *   node install.mjs --no-tools            # skip registering the tool servers (Playwright, context7, GitHub, reels)
 *   node install.mjs --no-reels            # skip only the reels tool (it downloads Python + Whisper)
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
const NO_TOOLS = flag("--no-tools");
const NO_REELS = flag("--no-reels");
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
  // sha256 of each file exactly as this installer last wrote it. A file that still matches
  // was never edited by the user, so an update may replace it without asking.
  hashes: prior && prior.hashes ? prior.hashes : {},
};
const report = { created: [], same: [], updated: [], conflict: [], overwritten: [] };
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

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
    const cur = fs.readFileSync(dest);
    if (Buffer.compare(cur, data) === 0) {
      if (mode === "template") manifest.hashes[rel] = sha(data);
      return report.same.push(rel);
    }
    if (mode === "keep") return report.same.push(rel + " (kept yours)");
    if (manifest.hashes[rel] && manifest.hashes[rel] === sha(cur)) {
      // Unchanged since we installed it: this is an update, not a conflict.
      if (!DRY) {
        fs.writeFileSync(dest, data);
        fs.rmSync(dest + ".cortex-new", { force: true }); // a stale conflict copy from an older install
      }
      manifest.hashes[rel] = sha(data);
      return report.updated.push(rel);
    }
    if (!FORCE) {
      if (!DRY) fs.writeFileSync(dest + ".cortex-new", data);
      return report.conflict.push(rel);
    }
    if (!DRY) {
      fs.copyFileSync(dest, dest + `.bak-${stamp()}`);
      fs.writeFileSync(dest, data);
    }
    manifest.hashes[rel] = sha(data);
    return report.overwritten.push(rel);
  }
  if (!DRY) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  if (!manifest.files.includes(rel)) manifest.files.push(rel);
  if (mode === "template") manifest.hashes[rel] = sha(data);
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
/** First executable called `name` on PATH, as written there (a stable symlink, not its target). */
function findOnPath(name) {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext.toLowerCase());
      try {
        if (fs.statSync(p).isFile()) {
          if (process.platform !== "win32") fs.accessSync(p, fs.constants.X_OK);
          return p;
        }
      } catch {}
    }
  }
  return null;
}
// macOS/Linux: hooks get an ABSOLUTE node path. Apps started from the Dock or Finder
// (the Claude desktop app, VS Code) do not inherit the shell's PATH, so Homebrew's or
// nvm's `node` can be invisible to them and every hook would fail silently.
// Windows installers put node on the system PATH, so plain `node` is the robust choice.
const NODE = process.platform === "win32" ? "node" : `"${findOnPath("node") || process.execPath}"`;
const hookCmd = (script) => `${NODE} "${fwd(path.join(CLAUDE, script))}"`;

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
  { event: "SessionStart", matcher: "startup", script: "hooks/update-check.js", timeout: 15 },
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
function sh(cmd, argv, { input, timeout = 120000 } = {}) {
  const win = process.platform === "win32";
  const q = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const r = win
    ? spawnSync([cmd, ...argv].map(q).join(" "), { shell: true, encoding: "utf8", timeout, input })
    : spawnSync(cmd, argv, { encoding: "utf8", timeout, input });
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}`.trim(), missing: r.error?.code === "ENOENT" || r.status === 127 || /not recognized|not found/i.test(r.stderr || "") };
}
const has = (cmd) => !!cmd && sh(cmd, ["--version"]).ok;

/** VS Code's CLI: on PATH, or inside the app bundle on macOS (the PATH command is a manual step there). */
function findCode() {
  if (has("code")) return "code";
  const bundles = [
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    path.join(HOME, "Applications", "Visual Studio Code.app", "Contents", "Resources", "app", "bin", "code"),
  ];
  return process.platform === "darwin" ? bundles.find((p) => fs.existsSync(p) && has(p)) || null : null;
}
/** Claude Code's CLI: on PATH, or the binary bundled with the Claude desktop app (which sets CLAUDE_CODE_EXECPATH). */
function findClaude() {
  if (has("claude")) return "claude";
  const bundled = process.env.CLAUDE_CODE_EXECPATH;
  return bundled && fs.existsSync(bundled) && has(bundled) ? bundled : null;
}

const CLAUDE_BIN = findClaude();
if (CLAUDE_BIN) manifest.claudeBin = CLAUDE_BIN;
manifest.repoDir = fwd(REPO); // update-check.js watches this clone for new commits

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
  const CODE = findCode();
  const haveCode = !!CODE;
  const haveClaude = !!CLAUDE_BIN;
  if (CODE) manifest.codeBin = CODE;
  if (!haveCode) sidekick.notes.push("VS Code was not found. Install it (https://code.visualstudio.com), open it once, then re-run the installer.");
  else if (!fs.existsSync(VSIX)) sidekick.notes.push(`Extension package missing at ${fwd(VSIX)}; run \`npm run package\` in vscode-sidekick/.`);
  else if (!DRY) {
    const r = sh(CODE, ["--install-extension", VSIX, "--force"]);
    if (r.ok) manifest.vscodeExtension = true;
    else sidekick.notes.push("Installing the VS Code extension failed: " + r.out.slice(0, 300));
  }
  if (!haveClaude) sidekick.notes.push("Claude Code's `claude` command was not found, so the MCP server was not registered. Run the installer from inside Claude Code (it finds its own binary), or from a terminal where `claude --version` works.");
  else if (!DRY) {
    const url = `http://127.0.0.1:${conn.port}/mcp`;
    const existing = sh(CLAUDE_BIN, ["mcp", "get", "vscode"]);
    if (existing.ok && !existing.out.includes(url) && !FORCE) {
      sidekick.notes.push("An MCP server named \"vscode\" already exists and is not the Sidekick; left it alone (re-run with --force to replace it).");
    } else {
      if (existing.ok) sh(CLAUDE_BIN, ["mcp", "remove", "vscode", "-s", "user"]);
      const r = sh(CLAUDE_BIN, ["mcp", "add", "--scope", "user", "--transport", "http", "vscode", url, "--header", `Authorization: Bearer ${conn.token}`]);
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

// ---------------------------------------------------------------- 4b. tools (MCP servers)
//
// Registered at user scope, so every project gets them. A server name the user already
// has is left alone (theirs wins), unless WE added it on an earlier install, in which case
// it is refreshed (paths may have moved). Only names we added are removed by uninstall.

const toolsReport = []; // [name, status]
manifest.mcpAdded = prior && Array.isArray(prior.mcpAdded) ? prior.mcpAdded : [];
const venvPython = (dir) =>
  process.platform === "win32" ? path.join(dir, ".venv", "Scripts", "python.exe") : path.join(dir, ".venv", "bin", "python");
const ghReady = () => sh("gh", ["auth", "token"], { timeout: 10000 }).ok;
const findUv = () =>
  has("uv") ? "uv" : [path.join(HOME, ".local", "bin", "uv"), "/opt/homebrew/bin/uv", "/usr/local/bin/uv"].find((p) => fs.existsSync(p) && has(p)) || null;

function registerTool(name, def, why) {
  if (!def) return toolsReport.push([name, why]);
  const ours = manifest.mcpAdded.includes(name);
  const exists = sh(CLAUDE_BIN, ["mcp", "get", name]).ok; // read-only, so the dry run does it too
  if (exists && !ours && !FORCE) return toolsReport.push([name, "you already have one with this name — kept yours"]);
  if (DRY) return toolsReport.push([name, exists ? "would refresh" : "would register"]);
  if (exists) sh(CLAUDE_BIN, ["mcp", "remove", name, "-s", "user"]);
  const r = sh(CLAUDE_BIN, ["mcp", "add-json", "-s", "user", name, "-"], { input: JSON.stringify(def) });
  if (!r.ok) return toolsReport.push([name, "registration failed: " + r.out.slice(0, 200)]);
  if (!ours) manifest.mcpAdded.push(name);
  toolsReport.push([name, "registered"]);
}

if (NO_TOOLS) toolsReport.push(["all tools", "skipped (--no-tools)"]);
else if (!CLAUDE_BIN) toolsReport.push(["all tools", "skipped — the `claude` command was not found (run the installer from inside Claude Code)"]);
else {
  // Library docs on demand, so Claude codes against the current API instead of its memory.
  registerTool("context7", { type: "http", url: "https://mcp.context7.com/mcp" });

  // A real browser Claude drives itself (navigate, click, fill, screenshot). Pinned version.
  const npx = process.platform === "win32" ? "npx" : findOnPath("npx");
  registerTool(
    "playwright",
    npx && {
      type: "stdio",
      command: npx,
      args: ["-y", "@playwright/mcp@0.0.85"],
      // npx starts with `#!/usr/bin/env node`, so node must be on PATH even when Claude was
      // opened from the Dock (which gives apps a bare PATH).
      ...(process.platform === "win32"
        ? {}
        : { env: { PATH: [...new Set([path.dirname(process.execPath), path.dirname(npx), "/usr/local/bin", "/usr/bin", "/bin"])].join(":") } }),
    },
    "skipped — npx was not found (it comes with Node.js)"
  );

  // GitHub issues, PRs and code search, authenticated through the gh CLI at connect time.
  registerTool(
    "github",
    ghReady() && {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headersHelper: `${NODE} "${fwd(path.join(CLAUDE, "mcp", "github-headers.js"))}"`,
    },
    "skipped — install the GitHub CLI and run `gh auth login`, then re-run the installer"
  );

  // reels: watch Instagram reels, TikToks, YouTube Shorts (transcript + frames). Needs uv.
  const REELS = path.join(REPO, "tools", "reels");
  if (NO_REELS) toolsReport.push(["reels", "skipped (--no-reels)"]);
  else {
    const uv = findUv();
    let def = null;
    let why = "skipped — needs uv (macOS: `brew install uv`; Windows: `winget install astral-sh.uv`), then re-run the installer";
    if (uv && !DRY) {
      console.log("Setting up the reels tool (Python + Whisper). The first time takes a few minutes…");
      const r = sh(uv, ["sync", "--project", REELS, "--quiet"], { timeout: 1800000 });
      if (r.ok && fs.existsSync(venvPython(REELS))) def = { type: "stdio", command: fwd(venvPython(REELS)), args: [fwd(path.join(REELS, "reels_mcp.py"))] };
      else why = "setup failed: " + r.out.slice(-300);
    } else if (uv) def = {}; // dry run: report "would register"
    registerTool("reels", def, why);
  }
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
    .split("{{SIDEKICK_STATUS}}").join(esc(sidekick.status))
    .split("{{TOOLS_STATUS}}").join(
      esc(toolsReport.filter(([, s]) => /registered|refresh|kept yours/.test(s)).map(([n]) => n).join(", ") || "none — see the installer output")
    );
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
line("Updated (you had not edited these)", report.updated);
line("Overwritten (backup saved as .bak-*)", report.overwritten);
line("CONFLICT — yours kept, template saved beside it as .cortex-new; merge by hand", report.conflict);
console.log(`\nsettings.json: ${settingsChanged ? "hooks merged (backup saved)" : "already had the Cortex hooks"}`);
console.log(`VS Code Sidekick: ${sidekick.status}`);
console.log("Tools:");
for (const [n, s] of toolsReport) console.log(`  ${n}: ${s}`);
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
