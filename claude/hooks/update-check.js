#!/usr/bin/env node
/**
 * update-check.js — SessionStart (startup) hook: is there a newer Cortex on GitHub?
 *
 * Looks at the folder you installed Cortex from (recorded by install.mjs in
 * ~/.claude/cortex/install-manifest.json). At most every CHECK_EVERY_HOURS it runs a quick
 * `git fetch`; if the upstream branch has commits you do not have, it tells Claude, which
 * mentions it once at the start of the session and offers the `update-cortex` skill.
 *
 * It only ever READS: it never pulls, merges or installs. Updating runs code from the
 * repository on your machine, so that step always waits for your yes.
 *
 * Silent when: up to date, offline, not a git clone, no upstream, or anything goes wrong.
 * Never blocks a session: the fetch has a hard timeout and every error exits 0.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const STATE = path.join(CLAUDE, "cortex", "state", "update-check.json");
const CHECK_EVERY_HOURS = Number(process.env.CORTEX_UPDATE_HOURS || 6);
const FETCH_TIMEOUT_MS = 6000;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function git(repo, args, timeout = 3000) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout, windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

function main() {
  const manifest = readJson(path.join(CLAUDE, "cortex", "install-manifest.json"));
  const repo = manifest && manifest.repoDir;
  if (!repo || !fs.existsSync(path.join(repo, ".git"))) return;

  const head = git(repo, ["rev-parse", "HEAD"]);
  if (!head || !git(repo, ["rev-parse", "--abbrev-ref", "@{u}"])) return; // no upstream

  const state = readJson(STATE) || {};
  const due = !state.checkedAt || Date.now() - Date.parse(state.checkedAt) > CHECK_EVERY_HOURS * 3600e3;
  if (due) {
    git(repo, ["fetch", "--quiet", "--no-tags"], FETCH_TIMEOUT_MS); // offline → stays at the last known upstream
    state.checkedAt = new Date().toISOString();
  }
  const behind = Number(git(repo, ["rev-list", "--count", "HEAD..@{u}"]) || 0);
  const log = behind ? git(repo, ["log", "--no-merges", "--format=- %s (%cr)", "-n", "8", "HEAD..@{u}"]) || "" : "";
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ ...state, head, behind }, null, 2) + "\n");
  } catch {}
  if (!behind) return;

  const ctx =
    `CORTEX UPDATE AVAILABLE: the Cortex template at ${repo.replace(/\\/g, "/")} is ${behind} commit(s) behind GitHub.\n` +
    `${log}\n` +
    `At the start of your first reply, tell the user in ONE short line that a Cortex update is available ` +
    `(say what it changes in a few words) and ask whether to install it with the update-cortex skill. ` +
    `Do not update without their yes, and do not mention this again in this session.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx } }));
}

try {
  main();
} catch {}
process.exit(0);
