#!/usr/bin/env node
/**
 * sidekick-notify.js — PreToolUse + PostToolUse on Write|Edit|MultiEdit|NotebookEdit.
 *
 * Tells the Cortex Sidekick VS Code extension exactly which file Claude is about to change
 * (with its current content, so "Revert" is exact) and when the change has landed, so the
 * file opens beside you with the changed lines highlighted.
 *
 * Silent and harmless when VS Code or the extension is not running: one refused loopback
 * connection, then exit 0. Never prints, never blocks a tool call.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

function main(raw) {
  let p, conn;
  try {
    p = JSON.parse(raw);
    conn = JSON.parse(fs.readFileSync(path.join(CLAUDE, "cortex", "sidekick.json"), "utf8").replace(/^﻿/, ""));
  } catch {
    return done();
  }
  const input = p.tool_input || {};
  const file = input.file_path || input.notebook_path;
  if (!file || !conn.token) return done();

  const phase = p.hook_event_name === "PreToolUse" ? "pre" : "post";
  const body = { phase, file: path.resolve(file) };
  if (phase === "pre") {
    try {
      const st = fs.statSync(body.file);
      body.before = st.size <= 2000000 ? fs.readFileSync(body.file, "utf8") : null;
    } catch {
      body.before = null; // new file
    }
  }
  const data = JSON.stringify(body);
  const req = http.request(
    {
      host: "127.0.0.1",
      port: conn.port || 7341,
      path: "/notify",
      method: "POST",
      timeout: 800,
      headers: { authorization: `Bearer ${conn.token}`, "content-type": "application/json", "content-length": Buffer.byteLength(data) },
    },
    (res) => {
      res.resume();
      res.on("end", done);
    }
  );
  req.on("timeout", () => req.destroy());
  req.on("error", done);
  req.end(data);
}

function done() {
  process.exit(0);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    main(raw);
  } catch {
    done();
  }
});
setTimeout(done, 1500).unref();
