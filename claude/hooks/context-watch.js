#!/usr/bin/env node
/**
 * context-watch.js — PostToolUse. Two warnings, each fired once, never a block.
 *
 * Idea borrowed from the "everything-claude-code" community hooks (suggest-compact /
 * context-monitor): nothing in a stock setup reads the real context size or notices a
 * tool call spinning in a loop.
 *
 *  1. CONTEXT: reads the last assistant `usage` in the transcript (input + cache read +
 *     cache write = what the model actually saw) and warns at 50 / 70 / 85% of the window,
 *     so state can be saved at a clean seam instead of wherever auto-compaction lands.
 *  2. LOOP: the same tool with the same input 5 times in a row is a stuck loop far more
 *     often than it is work. One warning per streak.
 *
 * Deliberately NOT a hang detector: a hung call never reaches PostToolUse. That needs a
 * watchdog outside the session.
 *
 * Cost: one node spawn per tool call, reads only the last 256 KB of the transcript.
 * Contract: always exit 0; print nothing unless there is something to say.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOME = process.env.USERPROFILE || process.env.HOME;
const STATE_DIR = process.env.CONTEXT_WATCH_DIR || path.join(HOME, ".claude", "cortex", "state", "context-watch");
const THRESHOLDS = [0.5, 0.7, 0.85];
const LOOP_N = 5;
const TAIL_BYTES = 256 * 1024;

function windowSize() {
  if (process.env.CONTEXT_WATCH_WINDOW) return Number(process.env.CONTEXT_WATCH_WINDOW);
  try {
    const s = JSON.parse(fs.readFileSync(path.join(HOME, ".claude", "settings.json"), "utf8"));
    return /\[1m\]/i.test(s.model || "") ? 1_000_000 : 200_000;
  } catch {
    return 200_000;
  }
}

function lastContextTokens(transcriptPath) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, "r");
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const r = JSON.parse(lines[i]);
        const u = r && r.message && r.message.usage;
        if (r.type === "assistant" && u && r.message.model !== "<synthetic>")
          return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      } catch {
        /* first line of the tail is usually cut mid-record */
      }
    }
  } catch {
    /* unreadable transcript: say nothing */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return null;
}

function decide(payload, state, win) {
  const notes = [];
  const used = payload.transcript_path ? lastContextTokens(payload.transcript_path) : null;
  if (used !== null) {
    // Usage past a 200k window proves the window is 1M, whatever the config says; without
    // this a mislabelled model fires 50% at 100k (a known community-hook bug).
    if (used > win) win = 1_000_000;
    const frac = used / win;
    // If usage dropped below the lowest mark (compaction ran), re-arm the thresholds.
    if (frac < THRESHOLDS[0]) state.warned = [];
    const crossed = THRESHOLDS.filter((t) => frac >= t && !state.warned.includes(t));
    if (crossed.length) {
      const t = Math.max(...crossed);
      state.warned.push(...crossed);
      notes.push(
        `Context is at ${Math.round(frac * 100)}% (${Math.round(used / 1000)}k of ${Math.round(win / 1000)}k tokens). ` +
          (t >= 0.85
            ? "Auto-compaction is close. Finish the current step, then save state (Cortex save-state) before starting anything new."
            : "If you are between tasks, this is a clean seam to save state; do not start a large new read without need.")
      );
    }
  }
  const sig = crypto
    .createHash("sha1")
    .update((payload.tool_name || "") + "\u0000" + JSON.stringify(payload.tool_input || {}))
    .digest("hex");
  state.recent = [...(state.recent || []), sig].slice(-LOOP_N);
  const looping = state.recent.length === LOOP_N && state.recent.every((s) => s === sig);
  if (looping && state.loopWarned !== sig) {
    state.loopWarned = sig;
    notes.push(
      `The same ${payload.tool_name} call with identical input has now run ${LOOP_N} times in a row. ` +
        "That is almost always a stuck loop: stop, state what you expected to change between attempts, and try something different."
    );
  } else if (!looping) {
    state.loopWarned = null; // streak broken: a new streak of the same call may warn again
  }
  return notes;
}

if (require.main === module) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      const payload = JSON.parse(raw);
      const sid = String(payload.session_id || "unknown").replace(/[^\w.-]/g, "_");
      const sf = path.join(STATE_DIR, `${sid}.json`);
      let state = { warned: [], recent: [], loopWarned: null };
      try {
        state = { ...state, ...JSON.parse(fs.readFileSync(sf, "utf8")) };
      } catch {
        /* first call this session */
      }
      const notes = decide(payload, state, windowSize());
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(sf, JSON.stringify(state));
      if (notes.length)
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "[context-watch] " + notes.join(" ") },
          })
        );
    } catch {
      /* a watch hook must never break a session */
    }
    process.exit(0);
  });
}

module.exports = { decide, lastContextTokens };
