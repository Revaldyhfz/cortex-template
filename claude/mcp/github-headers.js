#!/usr/bin/env node
/**
 * headersHelper for the GitHub MCP server (registered by install.mjs).
 *
 * Prints connection headers as JSON on stdout; Claude Code merges them into each request.
 * It asks the GitHub CLI (`gh auth token`) for a token at connect time, so no token is
 * ever written into a config file, and gh refreshes it on its own.
 *
 * Needs: the GitHub CLI, logged in once with `gh auth login`.
 * Falls back to $GITHUB_PERSONAL_ACCESS_TOKEN if gh is unavailable.
 */
"use strict";
const { execFileSync } = require("child_process");

// Apps started from the Dock or Finder (macOS) do not get the shell's PATH, so try the
// usual install locations by full path before the bare name.
const GH_CANDIDATES = [
  "/opt/homebrew/bin/gh", // macOS, Apple silicon (Homebrew)
  "/usr/local/bin/gh", // macOS Intel (Homebrew), Linux manual installs
  "/usr/bin/gh", // Linux packages
  "C:\\Program Files\\GitHub CLI\\gh.exe",
  "C:\\Program Files (x86)\\GitHub CLI\\gh.exe",
  "gh",
];

function token() {
  for (const gh of GH_CANDIDATES) {
    try {
      const t = execFileSync(gh, ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
      if (t) return t;
    } catch {
      /* try the next candidate */
    }
  }
  return (process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "").trim();
}

const t = token();
// No Authorization header at all rather than an empty one: a malformed header gives a
// confusing HTTP 400, a missing one fails honestly.
process.stdout.write(JSON.stringify(t ? { Authorization: `Bearer ${t}` } : {}));
