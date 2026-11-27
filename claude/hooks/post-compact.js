#!/usr/bin/env node
/**
 * post-compact.js — SessionStart (matcher "compact"). Guards against STALE REPLAY.
 *
 * The real post-compaction failure is not lost transcript (the .jsonl survives
 * compaction). It is the model re-running a step it already finished, because the
 * summary no longer shows that it finished. So, once, right after compaction, this
 * injects:
 *  - the files THIS session last wrote or edited (from its own transcript), newest
 *    first, so "done" is visible as evidence rather than as memory;
 *  - a check-before-redo instruction.
 *
 * Contract: always exit 0; stdout is SessionStart hookSpecificOutput or nothing.
 */
const fs = require("fs");

const TAIL_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 8;

function recentWrites(transcriptPath) {
  let text = "";
  try {
    const fd = fs.openSync(transcriptPath, "r");
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return [];
  }
  const seen = new Map(); // path -> order of last write
  let order = 0;
  for (const line of text.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const content = (r && r.message && r.message.content) || [];
    for (const c of Array.isArray(content) ? content : []) {
      if (c.type !== "tool_use" || !c.input) continue;
      if (["Write", "Edit", "NotebookEdit"].includes(c.name)) {
        const p = c.input.file_path || c.input.notebook_path;
        if (p) seen.set(p, order++);
      }
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_FILES).map(([p]) => p);
}

function build(payload) {
  const files = payload.transcript_path ? recentWrites(payload.transcript_path) : [];
  const parts = [
    "[post-compact] The conversation was just compacted. Work from before this point is probably already done: " +
      "before re-running any step, script or slash command from the summary, confirm it has not already happened " +
      "(git status / git log -3 in the repo concerned, and the files below).",
  ];
  if (files.length) parts.push("Files this session most recently wrote or edited, newest first: " + files.join(" | "));
  return parts.join("\n");
}

if (require.main === module) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      const payload = JSON.parse(raw);
      if (payload.source && payload.source !== "compact") process.exit(0);
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: build(payload) } })
      );
    } catch {
      /* never break session start */
    }
    process.exit(0);
  });
}

module.exports = { build, recentWrites };
