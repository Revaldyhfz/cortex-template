#!/usr/bin/env node
/**
 * cortex-sync.js — Cortex capture engine (incremental)
 *
 * Renders a Claude Code session transcript (.jsonl) into an Obsidian note.
 * Invoked by Claude Code hooks (Stop / SessionEnd) with a JSON payload on stdin
 * carrying session_id, transcript_path and cwd.
 *
 * Also writes Cortex/States/Live/<note>.md on every turn: the latest wrap-up
 * recap, your last five asks, and the files written — so /boot can brief from
 * chats nobody ran save-state on.
 *
 * Incremental: a per-session checkpoint (byte offset + rendered body) means each
 * turn parses only the records appended since the last run, O(new records), not
 * O(whole transcript). Typical cost is ~100 ms per turn.
 *
 * Design rules:
 *   * NEVER break the session. Every failure path exits 0.
 *   * Idempotent. Deleting the checkpoint forces a faithful full re-render.
 *   * Filesystem-only. Does not require Obsidian to be running.
 *   * Filename is stable for the life of a session (see sessions-index.json).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = process.env.USERPROFILE || os.homedir();
// CORTEX_HOME / CORTEX_VAULT exist so the test suite can run in full isolation.
// Without the CORTEX_HOME override the tests wrote their fixture session ids
// straight into the live sessions-index.json.
const CORTEX_HOME = process.env.CORTEX_HOME || path.join(HOME, ".claude", "cortex");
const CONFIG_PATH = path.join(CORTEX_HOME, "cortex-config.json");
const INDEX_PATH = path.join(CORTEX_HOME, "sessions-index.json");
const LOG_PATH = path.join(CORTEX_HOME, "cortex.log");
const CKPT_DIR = path.join(CORTEX_HOME, "checkpoints");

// ---------------------------------------------------------------- utilities

function log(msg) {
  try {
    fs.appendFileSync(LOG_PATH, `${fmt(new Date(), "yyyy-MM-dd HH:mm:ss")}  ${msg}\n`, "utf8");
  } catch {
    /* logging must never break capture */
  }
}

const p2 = (n) => String(n).padStart(2, "0");
function fmt(d, pattern) {
  return pattern
    .replace("yyyy", d.getFullYear())
    .replace("MM", p2(d.getMonth() + 1))
    .replace("dd", p2(d.getDate()))
    .replace("HHmm", p2(d.getHours()) + p2(d.getMinutes()))
    .replace("HH:mm:ss", `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`)
    .replace("HH:mm", `${p2(d.getHours())}:${p2(d.getMinutes())}`);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

/** Always BOM-less. See the encoding note in the header. */
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Hooks from concurrent sessions run in parallel (two SessionEnds in the same
// second). A shared `${file}.tmp` let one process rename away the
// other's temp file (ENOENT), and Windows refuses a rename onto a file another
// process is replacing at that instant (EPERM). So: a temp name per writer, and
// a short retry on the rename.
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text, { encoding: "utf8" });
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (attempt >= 20 || !["EPERM", "EACCES", "EBUSY"].includes(e.code)) {
        try { fs.unlinkSync(tmp); } catch {}
        throw e;
      }
      sleepMs(10 + Math.random() * 40);
    }
  }
}

// Serialises read-modify-write of a shared file across hook processes. Without
// it, two new sessions could each read sessions-index.json, add only themselves
// and write back, dropping the other's entry; that session then collided with
// its own note on the next run and got a duplicate. A lock older than 10 s is
// treated as left behind by a killed process.
function withLock(file, fn) {
  const lock = `${file}.lock`;
  for (let attempt = 0; ; attempt++) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch (e) {
      // EPERM/EACCES: on Windows the lock is mid-delete by its previous holder.
      if (!["EEXIST", "EPERM", "EACCES"].includes(e.code)) throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock);
      } catch {}
      if (attempt >= 200) throw new Error(`lock timeout: ${lock}`);
      sleepMs(10 + Math.random() * 40);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lock); } catch {}
  }
}

// ---------------------------------------------------------------- rendering

/** Strip harness-injected blocks that are not part of the human conversation. */
function cleanText(t) {
  if (!t) return "";
  return t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-[a-z]+>[\s\S]*?<\/local-command-[a-z]+>/g, "")
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .trim();
}

/** Pull display text and a tool summary out of a message's content blocks. */
function extract(content) {
  const tools = [];
  if (content == null) return { text: "", tools };
  if (typeof content === "string") return { text: cleanText(content), tools };

  const parts = [];
  for (const b of content) {
    if (!b) continue;
    if (b.type === "text") {
      parts.push(cleanText(b.text), "");
    } else if (b.type === "tool_use") {
      const i = b.input || {};
      let desc = i.description || i.file_path || i.pattern || i.query || "";
      if (typeof desc !== "string") desc = "";
      if (desc.length > 120) desc = desc.slice(0, 120) + "...";
      tools.push({ name: b.name, desc });
    }
    // thinking / tool_result / images are intentionally dropped
  }
  return { text: parts.join("\n").trim(), tools };
}

/**
 * Message bodies carry their own markdown headings, which collide with the
 * "## Speaker" structure and destroy Obsidian's outline. Shift them down two
 * levels. Fence-aware, so `# comment` lines inside shell or python blocks survive.
 */
function demoteHeadings(t) {
  if (!t) return "";
  let inFence = false;
  const out = [];
  for (const ln of t.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(ln)) {
      inFence = !inFence;
      out.push(ln);
      continue;
    }
    const m = !inFence && ln.match(/^(#{1,6})\s+(.*)$/);
    if (m) out.push("#".repeat(Math.min(6, m[1].length + 2)) + " " + m[2]);
    else out.push(ln);
  }
  return out.join("\n").replace(/\s+$/, "");
}

/** Render a batch of records, continuing from prior speaker state. */
function renderRecords(records, state) {
  const out = [];
  for (const r of records) {
    const { text, tools } = extract(r.message && r.message.content);
    const body = demoteHeadings(text);
    if (!body && tools.length === 0) continue;

    let ts = "";
    try {
      ts = fmt(new Date(r.timestamp), "HH:mm");
    } catch {
      /* leave blank */
    }

    // One assistant turn spans many records (each tool call is its own record).
    // Emit a speaker heading only on a genuine speaker change, or the note gets
    // one heading per tool call and the outline is useless.
    if (r.type !== state.lastSpeaker) {
      out.push(r.type === "user" ? `## 👤 You · ${ts}` : `## 🤖 Claude · ${ts}`, "");
      state.lastSpeaker = r.type;
    }
    if (r.type === "user") state.userTurns++;
    if (body) out.push(body, "");

    if (r.type === "assistant" && tools.length) {
      out.push("> [!note]- Tools used");
      for (const t of tools) out.push(t.desc ? `> - \`${t.name}\` — ${t.desc}` : `> - \`${t.name}\``);
      out.push("");
    }
  }
  return out.join("\n");
}

function buildNote(meta, body) {
  const esc = (s) => String(s).replace(/"/g, '\\"');
  return [
    "---",
    "type: session",
    "cortex: session",
    `title: "${esc(meta.title)}"`,
    `session-id: ${meta.sessionId}`,
    `date: ${fmt(meta.start, "yyyy-MM-dd")}`,
    `started: ${fmt(meta.start, "yyyy-MM-dd")}T${fmt(meta.start, "HH:mm:ss")}`,
    `updated: ${fmt(meta.end, "yyyy-MM-dd")}T${fmt(meta.end, "HH:mm:ss")}`,
    `project: "${String(meta.project).replace(/\\/g, "/")}"`,
    `turns: ${meta.turns}`,
    `captured-by: ${meta.hookEvent}`,
    "tags:",
    "  - cortex/session",
    "---",
    "",
    `# ${meta.title}`,
    "",
    "> [!abstract] Session",
    `> **Started** ${fmt(meta.start, "yyyy-MM-dd HH:mm")} · **Updated** ${fmt(meta.end, "HH:mm")} · **${meta.turns} exchanges**`,
    `> **Project** \`${meta.project}\``,
    "",
    "[[Cortex]] · [[Sessions Index]]",
    "",
    "---",
    "",
    body,
  ].join("\n");
}

/**
 * Rebuild the index from the notes on disk rather than from internal state, so
 * it self-heals when a note is deleted or renamed by hand.
 */
function rebuildIndex(vault, sessionsDir) {
  const rows = [];
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith(".md")) continue;
    let head = "";
    try {
      const fd = fs.openSync(path.join(sessionsDir, name), "r");
      const buf = Buffer.alloc(2048);
      const n = fs.readSync(fd, buf, 0, 2048, 0);
      fs.closeSync(fd);
      head = buf.slice(0, n).toString("utf8");
    } catch {
      continue;
    }
    const g = (re) => (head.match(re) || [])[1] || "";
    const link = name.replace(/\.md$/, "");
    rows.push({
      date: g(/^date:\s*(\S+)/m),
      title: g(/^title:\s*"?(.*?)"?\s*$/m) || link,
      turns: g(/^turns:\s*(\d+)/m),
      link,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const md = [
    "---",
    "type: index",
    "cortex: index",
    "tags:",
    "  - cortex/index",
    "---",
    "",
    "# Sessions Index",
    "",
    `Auto-generated by Cortex. ${rows.length} session(s) captured.`,
    "",
    "| Date | Session | Exchanges |",
    "| --- | --- | --- |",
    ...rows.map((r) => `| ${r.date} | [[${r.link}\\|${r.title}]] | ${r.turns} |`),
    "",
    "[[Cortex]]",
  ].join("\n");
  writeAtomic(path.join(vault, "Cortex", "Sessions Index.md"), md);
}

// ---------------------------------------------------------------- main

function main(raw) {
  // Machine sessions are not work sessions. If you ever script `claude -p` from a
  // scheduled job, set CLAUDE_INTERNAL_SESSION=1 in its environment, or every tick
  // drops a junk note into Sessions/.
  if (process.env.CLAUDE_INTERNAL_SESSION === "1") {
    log("skip: internal machine session (CLAUDE_INTERNAL_SESSION)");
    return;
  }
  const payload = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  })();

  let transcriptPath = payload.transcript_path || process.argv[2];
  const hookEvent = payload.hook_event_name || "manual";

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    log(`skip: no readable transcript (event=${hookEvent} path=${transcriptPath})`);
    return;
  }

  const cfg = readJson(CONFIG_PATH, {});
  // CORTEX_VAULT lets the test harness render into a scratch vault instead of
  // the live one. Not used in normal operation.
  let vault = process.env.CORTEX_VAULT || cfg.vaultPath;
  if (!vault) {
    log("skip: no vaultPath in cortex-config.json (run install.mjs, or edit the file)");
    return;
  }
  // "~/..." is allowed in the config so it stays portable between machines.
  if (vault.startsWith("~")) vault = path.join(HOME, vault.slice(1));
  const sessionsDir = path.join(vault, "Cortex", "Sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(CKPT_DIR, { recursive: true });

  let sessionId = payload.session_id;

  // ---- checkpoint: the whole point of this rewrite ----
  // NOT const, and recomputed below once a missing session id is recovered
  // from the records. It used to be fixed to null here, so the manual
  // `node cortex-sync.js <transcript>` form wrote the note and then crashed
  // at writeAtomic(null) — no checkpoint, no index rebuild, and the next run
  // re-rendered from offset 0.
  let ckptPath = sessionId ? path.join(CKPT_DIR, `${sessionId}.json`) : null;
  let ckpt = ckptPath ? readJson(ckptPath, null) : null;

  const size = fs.statSync(transcriptPath).size;
  if (ckpt && ckpt.offset > size) {
    // Transcript shrank — it was replaced, not appended to. Rebuild from scratch.
    log(`notice: transcript shrank (${ckpt.offset} -> ${size}), full re-render`);
    ckpt = null;
  }

  const startOffset = ckpt ? ckpt.offset : 0;
  if (ckpt && startOffset === size) {
    // Nothing new since last run. This is the cheap path.
    return;
  }

  const fd = fs.openSync(transcriptPath, "r");
  const len = size - startOffset;
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, startOffset);
  fs.closeSync(fd);
  let chunk = buf.toString("utf8");

  // Only whole lines are safe to consume; a trailing partial line is left for
  // the next run by rewinding the offset we record.
  let consumed = len;
  const lastNl = chunk.lastIndexOf("\n");
  if (lastNl === -1) return; // no complete line yet
  if (lastNl !== chunk.length - 1) {
    consumed = Buffer.byteLength(chunk.slice(0, lastNl + 1), "utf8");
    chunk = chunk.slice(0, lastNl + 1);
  }

  const state = ckpt
    ? { lastSpeaker: ckpt.lastSpeaker, userTurns: ckpt.userTurns }
    : { lastSpeaker: "", userTurns: 0 };

  let aiTitle = ckpt ? ckpt.aiTitle : null;
  const fresh = [];
  for (const line of chunk.split("\n")) {
    if (!line || line.length < 2) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === "ai-title" && o.aiTitle) {
      aiTitle = o.aiTitle;
      continue;
    }
    if (o.type !== "user" && o.type !== "assistant") continue;
    if (o.isSidechain === true) continue; // subagent traffic
    if (o.isMeta === true) continue; // injected system text
    fresh.push(o);
  }

  if (!fresh.length && !ckpt) {
    log("skip: no conversational records");
    return;
  }
  if (!sessionId && fresh.length) sessionId = fresh[0].sessionId;
  if (!sessionId) return;
  if (!ckptPath) ckptPath = path.join(CKPT_DIR, `${sessionId}.json`);

  const firstTs = ckpt ? ckpt.firstTs : fresh.length ? fresh[0].timestamp : null;
  const lastTs = fresh.length ? fresh[fresh.length - 1].timestamp : ckpt && ckpt.lastTs;
  const start = firstTs ? new Date(firstTs) : new Date();
  const end = lastTs ? new Date(lastTs) : new Date();

  // ---- stable filename ----
  const noteName = withLock(INDEX_PATH, () => {
    const index = readJson(INDEX_PATH, {});
    let noteName = index[sessionId];
    if (!noteName) {
      let safe = (aiTitle || "Session").replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();
      if (safe.length > 60) safe = safe.slice(0, 60).trim();
      if (!safe) safe = "Session";
      const base = `${fmt(start, "yyyy-MM-dd")} ${fmt(start, "HHmm")} — ${safe}`;
      noteName = `${base}.md`;
  
      // Two sessions starting in the same MINUTE used to compute the same filename.
      // Both then wrote to it, each with only its own body, so the file flipped
      // between them and its `session-id` no longer identified its content. That is
      // a provenance failure, not a cosmetic one: it silently breaks any join from
      // a note back to its transcript.
      //
      // Disambiguation happens ONLY on collision, never by default. Every existing
      // note is already claimed in the index and keeps its name, so no [[wikilink]]
      // in the vault breaks — a blanket rename would have been the bigger bug.
      const claimed = new Set(Object.values(index));
      const collides = (n) => claimed.has(n) || fs.existsSync(path.join(sessionsDir, n));
      if (collides(noteName)) {
        const tag = String(sessionId).slice(0, 8);
        noteName = `${base} (${tag}).md`;
        for (let n = 2; collides(noteName); n++) noteName = `${base} (${tag}-${n}).md`;
      }
      index[sessionId] = noteName;
      writeAtomic(INDEX_PATH, JSON.stringify(index, null, 1));
    }
    return noteName;
  });

  // Append with the separator that a single join() would have inserted between
  // the two batches. Plain concatenation drops exactly one newline per resume,
  // so an N-chunk incremental render came out N-1 characters short of a full one.
  const rendered = renderRecords(fresh, state);
  const prev = ckpt ? ckpt.body : "";
  const body = prev && rendered ? `${prev}\n${rendered}` : prev || rendered;
  const project = payload.cwd || (fresh.length && fresh[0].cwd) || (ckpt && ckpt.project) || "";

  writeAtomic(
    path.join(sessionsDir, noteName),
    buildNote(
      { title: aiTitle || "Claude Code session", sessionId, start, end, project, turns: state.userTurns, hookEvent },
      body
    )
  );

  writeAtomic(
    ckptPath,
    JSON.stringify({
      offset: startOffset + consumed,
      body,
      lastSpeaker: state.lastSpeaker,
      userTurns: state.userTurns,
      aiTitle,
      firstTs,
      lastTs,
      project,
      noteName,
    })
  );

  // Multi-machine vaults (synced with Syncthing, iCloud, git…): session notes have a
  // single writer each, but the index is one shared file. Set cfg.indexHost to ONE
  // machine's hostname so only that machine rebuilds it. Unset = always rebuild.
  if (!cfg.indexHost || os.hostname() === cfg.indexHost) {
    try {
      rebuildIndex(vault, sessionsDir);
    } catch (e) {
      log(`index rebuild failed: ${e.message}`);
    }
  }

  // Live state: written on EVERY turn so /boot never has to reconstruct a chat
  // that nobody ran save-state on (otherwise a long unsaved chat leaves
  // /boot briefing from a stale note). Separate try: a failure here
  // must not cost the session note or checkpoint, which are already written.
  try {
    writeLive(vault, ckptPath, fresh, { sessionId, noteName, aiTitle, start, end, project, turns: state.userTurns });
  } catch (e) {
    log(`live state failed: ${e.message}`);
  }

  log(`ok: event=${hookEvent} turns=${state.userTurns} +${fresh.length} rec -> ${noteName}`);
}

// ---------------------------------------------------------------- live state

const CONTINUATION = /^This session is being continued from a previous conversation/;
const isBootAsk = (t) => /^[\/／]boot\b/i.test(t.trim());

/**
 * Fold the new records into the live-state summary kept beside the checkpoint
 * (`<sid>.live.json`), then render Cortex/States/Live/<session note name>.
 * The curated part is the wrap_up recap Claude writes at the end of each turn;
 * everything else is mechanical (recent asks, files written).
 */
function writeLive(vault, ckptPath, fresh, meta) {
  const livePath = ckptPath.replace(/\.json$/, ".live.json");
  const L = readJson(livePath, { asks: [], recap: "", ask: "", recapAt: "", edited: [], firstAsk: "", allBoot: true });
  for (const r of fresh) {
    const c = r.message && r.message.content;
    if (r.type === "user") {
      const { text } = extract(c);
      if (!text || CONTINUATION.test(text)) continue;
      const one = text.replace(/<pasted_content[^>]*>/g, "[pasted] ").replace(/<\/pasted_content[^>]*>/g, "")
        .replace(/\s+/g, " ").trim().slice(0, 300);
      if (!L.firstAsk) L.firstAsk = one;
      if (!isBootAsk(one)) L.allBoot = false;
      L.asks.push({ at: r.timestamp, text: one });
      if (L.asks.length > 5) L.asks.shift();
    } else if (Array.isArray(c)) {
      for (const b of c) {
        if (!b || b.type !== "tool_use") continue;
        const i = b.input || {};
        if (/wrap_up$/.test(b.name) && i.recap) {
          L.recap = String(i.recap); L.ask = String(i.ask || ""); L.recapAt = r.timestamp;
        } else if (/^(Write|Edit|NotebookEdit)$/.test(b.name) && typeof i.file_path === "string") {
          L.edited = L.edited.filter((p) => p !== i.file_path);
          L.edited.push(i.file_path);
          if (L.edited.length > 12) L.edited.shift();
        }
      }
    }
  }
  writeAtomic(livePath, JSON.stringify(L));

  const t = (ts) => { try { return fmt(new Date(ts), "yyyy-MM-dd HH:mm"); } catch { return ""; } };
  const link = meta.noteName.replace(/\.md$/, "");
  const md = [
    "---",
    "type: live-state",
    "cortex: live-state",
    `session: "${link}"`,
    `session-id: ${meta.sessionId}`,
    `started: ${fmt(meta.start, "yyyy-MM-dd")}T${fmt(meta.start, "HH:mm:ss")}`,
    `updated: ${fmt(meta.end, "yyyy-MM-dd")}T${fmt(meta.end, "HH:mm:ss")}`,
    `project: "${String(meta.project).replace(/\\/g, "/")}"`,
    `turns: ${meta.turns}`,
    `boot-only: ${L.allBoot}`,
    "tags:",
    "  - cortex/live-state",
    "---",
    "",
    `# Live — ${meta.aiTitle || "Claude Code session"}`,
    "",
    "> Auto-written by cortex-sync on every turn. Not curated beyond the recap; a",
    "> hand-written note in States/ outranks this one for anything it covers.",
    "",
    `## Where it stands${L.recapAt ? ` (${t(L.recapAt)})` : ""}`,
    L.recap || "_No wrap-up recap yet._",
    ...(L.ask ? ["", `**Waiting on you:** ${L.ask}`] : []),
    "",
    "## Recent asks",
    ...(L.asks.length ? L.asks.map((a) => `- ${t(a.at)} — ${a.text}`) : ["- _none_"]),
    "",
    "## Files written (most recent last)",
    ...(L.edited.length ? L.edited.map((p) => `- \`${p}\``) : ["- _none_"]),
    "",
    `[[${link}]] · [[Cortex]]`,
  ].join("\n");
  writeAtomic(path.join(vault, "Cortex", "States", "Live", meta.noteName), md);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    main(raw);
  } catch (e) {
    log(`ERROR: ${e && e.stack ? e.stack.split("\n")[0] : e}`);
  }
  process.exit(0); // never break the session
});
// Manual invocation with a path argument and no stdin.
if (process.argv[2]) {
  setTimeout(() => {
    if (!raw) {
      try {
        main("{}");
      } catch (e) {
        log(`ERROR: ${e}`);
      }
      process.exit(0);
    }
  }, 50);
}
