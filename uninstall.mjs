#!/usr/bin/env node
/**
 * Cortex uninstaller — undoes install.mjs, using ~/.claude/cortex/install-manifest.json.
 *
 *   node uninstall.mjs            # remove hooks + move installed files to a backup folder
 *   node uninstall.mjs --dry-run  # show what would happen, change nothing
 *
 * Nothing is deleted outright. Files the installer created (rules, skills, hooks, the
 * capture engine, its logs and checkpoints) are MOVED to ~/.claude-cortex-removed-<time>/,
 * so your personal edits to CLAUDE.md or the rules are recoverable. Delete that folder
 * yourself once you are sure.
 *
 * Your vault (captured sessions, state notes) is NEVER touched. Delete it by hand if you
 * want it gone.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DRY = process.argv.includes("--dry-run");
const HOME = os.homedir();
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const fwd = (p) => p.replace(/\\/g, "/");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const TRASH = path.join(HOME, `.claude-cortex-removed-${stamp}`);

const manifestPath = path.join(CLAUDE, "cortex", "install-manifest.json");
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch {
  console.error(`No install manifest at ${manifestPath}. Nothing to undo (or it was installed by hand).`);
  process.exit(1);
}

// 1. settings.json: drop only the hook entries that point at Cortex scripts.
const OURS = ["cortex-sync.js", "guardrail.js", "context-watch.js", "post-compact.js", "memory-surface.js"];
const settingsPath = path.join(CLAUDE, "settings.json");
let removedHooks = 0;
if (fs.existsSync(settingsPath)) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8").replace(/^﻿/, ""));
  const isOurs = (h) => {
    const c = fwd(String(h.command || "") + " " + (h.args || []).join(" "));
    return c.includes(fwd(CLAUDE)) && OURS.some((n) => c.includes(n));
  };
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    const kept = [];
    for (const g of groups) {
      const hooks = (g.hooks || []).filter((h) => !(isOurs(h) && ++removedHooks));
      if (hooks.length) kept.push({ ...g, hooks });
    }
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  if (manifest.setAutoMemoryDirectory && settings.autoMemoryDirectory === "~/.claude/memory")
    delete settings.autoMemoryDirectory;
  if (!DRY) {
    fs.copyFileSync(settingsPath, `${settingsPath}.bak-cortex-uninstall-${stamp}`);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
}

// 2. Move every file the installer created, plus the engine's own state folder.
const moved = [];
const move = (abs) => {
  if (!fs.existsSync(abs)) return;
  const rel = path.relative(CLAUDE, abs);
  if (rel.startsWith("..")) return; // only ever touch things inside ~/.claude
  const dest = path.join(TRASH, rel);
  if (!DRY) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(abs, dest);
  }
  moved.push(fwd(abs));
};
// The engine folder goes first and whole (logs, checkpoints, index, manifest), so the
// per-file moves below never pre-create its destination.
move(path.join(CLAUDE, "cortex"));
for (const f of manifest.files || []) move(path.resolve(f));
for (const d of ["boot", "save-state", "prompt", "research", "council"]) {
  const dir = path.join(CLAUDE, "skills", d);
  try {
    if (!DRY && fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  } catch {}
}

console.log(DRY ? "Cortex uninstall — DRY RUN, nothing was changed" : "Cortex uninstall — done");
console.log(`  Hook entries removed from settings.json: ${removedHooks}`);
console.log(`  Files moved (${moved.length}) to ${fwd(TRASH)}`);
for (const m of moved) console.log("   - " + m);
console.log(`\nYour vault was not touched: ${manifest.vault}\nRestart Claude Code to finish.`);
