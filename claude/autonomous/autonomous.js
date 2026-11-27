#!/usr/bin/env node
/**
 * autonomous.js — the Stop hook that keeps an armed session working.
 *
 * Why it exists: permission modes remove approval prompts WITHIN a turn, but nothing
 * starts a new turn. Claude stops when the work merely LOOKS done, and the user becomes
 * the verification loop. A written "keep going" instruction is advisory; a Stop hook is
 * deterministic. This file is that hook, plus a tiny CLI to arm and disarm it.
 *
 * What it does — on every Stop, if THIS SESSION's run file says autonomous mode is armed:
 *   - past the deadline            -> disarm, let the session stop
 *   - past the turn cap            -> disarm, let the session stop
 *   - the queue is verifiably dry  -> ask for a wrap-up once, then let the session stop
 *   - no progress for many Stops   -> warn, then ask for a wrap-up, then let it stop
 *   - inside the wrap-up window    -> block, and say WRAP UP (commit, checkpoint, report)
 *   - otherwise                    -> block, and say keep going, with the queue path
 *
 * Blocking is `{"decision":"block","reason":...}`; the reason is fed back to Claude.
 *
 * Runs are keyed by session (`runs/<session_id>.json`), so one session's `off` can never
 * end another session's run and turn counters are never pooled. The hook reads
 * `session_id` from the Stop payload on stdin; the CLI reads CLAUDE_CODE_SESSION_ID from
 * its environment. Both name the same session.
 *
 * The hook parses the queue itself. It does NOT take the agent's word that the queue is
 * dry — verifying instead of trusting is the whole reason this is a hook.
 *
 * THE RULE THIS FILE OBEYS ABOVE ALL OTHERS: it must never trap a session. Every
 * unexpected condition — unreadable state, malformed JSON, a missing or unparseable
 * deadline, a crash — exits 0 and lets the session stop. Four independent backstops,
 * any one of which ends the loop:
 *   1. the deadline (wall clock)
 *   2. the turn cap (counts blocks, so a frozen clock cannot defeat it)
 *   3. a hard ceiling of deadline + GRACE_MS regardless of anything else
 *   4. a verifiably empty queue
 *
 * CLI:
 *   node autonomous.js arm <hours> [queue-path]   arm this session (0 < hours <= 24)
 *   node autonomous.js status [--all]             time left, turn, open queue items
 *   node autonomous.js off [--all]                disarm this session (or every run)
 *   node autonomous.js lock                       exit 0 = no armed run, 1 = one is working
 *
 * Queue location, in priority order: the path given to `arm`, then $AUTONOMOUS_QUEUE,
 * then QUEUE.md in the directory `arm` is run from (the session's working directory).
 *
 * To disarm at any time: `off`, `off --all`, or delete the file under
 * ~/.claude/autonomous/runs/.
 *
 * Test: node test/autonomous.test.mjs   (from the cortex-template repo)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = os.homedir();

// AUTONOMOUS_DIR / AUTONOMOUS_LOG let the test suite point runs and the log somewhere
// disposable, so tests never write fixture lines into the real log.
const DIR = process.env.AUTONOMOUS_DIR || path.join(HOME, ".claude", "autonomous");
const RUNS = path.join(DIR, "runs");
const LOG = process.env.AUTONOMOUS_LOG || path.join(DIR, "autonomous.log");

/** Wrap-up window: the run must land in a reportable state before the user is back. */
const WRAP_MS = 20 * 60 * 1000;
/** Absolute ceiling past the deadline, whatever else happens. */
const GRACE_MS = 15 * 60 * 1000;
/** Counts blocks, not minutes — a stopped clock cannot defeat this one. */
const DEFAULT_TURN_CAP = 400;

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `${new Date().toISOString()}  ${msg}\n`, "utf8");
  } catch { /* logging must never break the session */ }
}

function allowStop() { process.exit(0); }

function blockStop(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

// ---------------------------------------------------------------- session

/** A session id becomes a filename, so it must not be able to escape RUNS. */
function safeId(id) {
  const s = String(id == null ? "" : id).replace(/[^A-Za-z0-9._-]/g, "_");
  return s.slice(0, 100);
}

/**
 * The Stop payload arrives as JSON on stdin. Never let a closed, empty or non-JSON stdin
 * become an exception — this runs on every Stop of every session, armed or not.
 */
function readPayload() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw) || {};
  } catch { return {}; }
}

/** Hook path: prefer the payload. CLI path: the environment. Either may be absent. */
function sessionIdFrom(payload) {
  const fromPayload = payload && payload.session_id;
  const id = fromPayload || process.env.CLAUDE_CODE_SESSION_ID || "";
  return id ? safeId(id) : "";
}

function stateFile(sid) { return path.join(RUNS, `${safeId(sid)}.json`); }

function listRunFiles() {
  try {
    return fs.readdirSync(RUNS)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(RUNS, f));
  } catch { return []; }
}

function readStateAt(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!s || s.armed !== true) return null;
    const deadline = Date.parse(s.deadline);
    if (!Number.isFinite(deadline)) {
      log("disarm: deadline unparseable");
      return null;
    }
    return { ...s, deadlineMs: deadline, file };
  } catch (e) {
    log(`disarm: unreadable state (${e && e.message})`);
    return null;
  }
}

function disarmAt(file, why) {
  try {
    if (fs.existsSync(file)) {
      const s = JSON.parse(fs.readFileSync(file, "utf8"));
      s.armed = false;
      s.endedAt = new Date().toISOString();
      s.endedBecause = why;
      fs.writeFileSync(file, JSON.stringify(s, null, 2), "utf8");
    }
  } catch { /* ignore */ }
  log(`disarmed [${path.basename(file, ".json").slice(0, 8)}]: ${why}`);
}

/** Merge `patch` into the run file. Never throws: a failed write must not block. */
function persist(state, patch) {
  try {
    Object.assign(state, patch);
    const { deadlineMs, file, ...rest } = state;
    fs.writeFileSync(state.file, JSON.stringify(rest, null, 2), "utf8");
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ stall
// Deadline, turn cap and dry queue all bound a run, but none of them notices a run
// SPINNING. Progress = the queue file, or the git state (HEAD + working tree) of the
// queue's directory or the session's cwd, changed since the last Stop. No change for
// STALL_WARN Stops -> the keep-working reason says so; for STALL_WRAP -> ask for the
// wrap-up, and the next unchanged Stop releases. A wrap-up that commits resets the
// count, which is correct: that IS progress.
const STALL_WARN = Number(process.env.AUTONOMOUS_STALL_WARN) || 4;
const STALL_WRAP = Number(process.env.AUTONOMOUS_STALL_WRAP) || 10;

function gitState(dir) {
  if (!dir) return "";
  try {
    const { execFileSync } = require("child_process");
    // 1.5 s per call, 4 calls worst case = 6 s, inside the Stop hook's timeout. A killed
    // Stop hook would end the run early, which is worse than a missed stall.
    const opt = { cwd: dir, encoding: "utf8", timeout: 1500, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] };
    return execFileSync("git", ["rev-parse", "HEAD"], opt) + execFileSync("git", ["status", "--porcelain"], opt);
  } catch {
    return ""; // not a repo, or git unavailable: contributes nothing, never throws
  }
}

function progressFingerprint(state, payload) {
  const h = require("crypto").createHash("sha1");
  try { h.update(fs.readFileSync(state.queue, "utf8")); } catch { h.update("<unreadable>"); }
  const dirs = new Set([state.queue ? path.dirname(state.queue) : "", payload && payload.cwd]);
  for (const d of dirs) h.update("\u0000" + gitState(d));
  return h.digest("hex");
}

function bumpTurn(state) {
  persist(state, { turns: (state.turns || 0) + 1 });
  return state.turns;
}

/**
 * Hours and minutes remaining. Round to whole minutes FIRST, then split — rounding the
 * minute part on its own lets it reach 60 without carrying ("1h 60m").
 */
function fmtRemaining(ms) {
  if (ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// ------------------------------------------------------------------ queue

/**
 * Count the OPEN items in the queue file. The item format (see QUEUE.template.md):
 *
 *     - **[P1] Short title** — scope: <where it may touch> · done when: <observable evidence>
 *
 * An entry with no `done when:` is not actionable work — closed items get rewritten into
 * a verdict and lose the clause. Finished items are also struck through. So:
 *
 *     open  ==  starts a [P<n>] entry  AND  title not struck through  AND  has `done when:`
 *
 * Requiring BOTH signals is deliberate: either alone misreads real queues.
 *
 * An item whose `owner:` names anyone other than claude/me/self is GATED: real work this
 * run may not do. It is reported separately and does not count as open, so a queue of
 * nothing but the user's decisions is dry rather than unworkable-and-unfinishable.
 *
 * Returns {readable, open, titles, gated, gatedCount}. `readable:false` is NOT dryness.
 */
function scanQueue(queuePath) {
  let body;
  try {
    body = fs.readFileSync(queuePath, "utf8");
  } catch {
    return { readable: false, open: 0, titles: [], gated: [], gatedCount: 0 };
  }
  const lines = body.split(/\r?\n/);
  // Entry starts: "- " then optional "~~", then "**[P<digit>]" (either order).
  const START = /^-\s+(?:~~)?\s*\*\*\s*(?:~~)?\s*\[P(\d)\]/;
  const titles = [];
  const gated = [];
  for (let i = 0; i < lines.length; i++) {
    if (!START.test(lines[i])) continue;
    // The literal format example in a queue header is documentation, not an item.
    if (/\[P1\]\s+Short title\*\*/.test(lines[i])) continue;
    // The entry runs to the next entry start or the next heading at ANY level (## or
    // deeper), so prose in a following section can never leak into this entry.
    let j = i + 1;
    while (j < lines.length && !START.test(lines[j]) && !/^#{2,}\s/.test(lines[j])) j++;
    const entry = lines.slice(i, j).join("\n");
    // Closed only if the strike is on the TITLE line. A struck sub-bullet must not close
    // an open parent. A wrapped struck title still opens on lines[i].
    if (lines[i].includes("~~")) continue;              // struck through: closed
    if (!/done when:/i.test(entry)) continue;           // no evidence clause: not work

    // A title can wrap onto the next line, so match against the whole entry.
    const t = /\[P\d\]\s*([\s\S]+?)\*\*/.exec(entry);
    const title = t ? t[1].replace(/\s+/g, " ").trim() : lines[i].slice(2, 62).trim();

    const owner = /owner:\s*([^·\n*]+)/i.exec(entry);
    const ownedByUser = owner && !/^(claude|me|self)\b/i.test(owner[1].trim());
    (ownedByUser ? gated : titles).push(title);
  }
  return { readable: true, open: titles.length, titles, gated, gatedCount: gated.length };
}

/** Explicit arg > $AUTONOMOUS_QUEUE > QUEUE.md in the current working directory. */
function resolveQueue(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.AUTONOMOUS_QUEUE) return path.resolve(process.env.AUTONOMOUS_QUEUE);
  return path.join(process.cwd(), "QUEUE.md");
}

// -------------------------------------------------------------------- CLI

function cmdArm(hoursRaw, queueArg) {
  const hours = parseFloat(hoursRaw);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    console.error("usage: autonomous.js arm <hours> [queue-path]   (0 < hours <= 24)");
    process.exit(2);
  }
  const sid = sessionIdFrom({});
  if (!sid) {
    console.error("cannot arm: no CLAUDE_CODE_SESSION_ID in the environment.\n" +
                  "Runs are keyed by session so one session's `off` cannot end " +
                  "another's. Arm from inside a Claude Code session.");
    process.exit(2);
  }
  const startedAt = new Date();
  const deadline = new Date(startedAt.getTime() + hours * 3600 * 1000);
  fs.mkdirSync(RUNS, { recursive: true });
  const queue = resolveQueue(queueArg);
  fs.writeFileSync(stateFile(sid), JSON.stringify({
    armed: true,
    sessionId: sid,
    startedAt: startedAt.toISOString(),
    deadline: deadline.toISOString(),
    hours,
    turns: 0,
    turnCap: DEFAULT_TURN_CAP,
    queue,
    charter: path.join(DIR, "CHARTER.md"),
  }, null, 2), "utf8");
  log(`armed [${sid.slice(0, 8)}] for ${hours}h, deadline ${deadline.toISOString()}`);

  // Report the queue at arm time. Arming onto an empty queue is a no-op run, and the
  // user should find that out now rather than in three hours.
  const q = scanQueue(queue);
  console.log(JSON.stringify({
    armed: true, hours, sessionId: sid,
    deadline: deadline.toISOString(),
    deadlineLocal: deadline.toLocaleString(),
    wrapUpFrom: new Date(deadline.getTime() - WRAP_MS).toLocaleString(),
    turnCap: DEFAULT_TURN_CAP,
    queue,
    queueOpenItems: q.readable ? q.open : "queue unreadable",
    queueTitles: q.titles,
    queueGated: q.gated,
  }, null, 2));
  if (q.readable && q.open === 0) {
    console.log("\nNOTE: the queue has no open items, so this run will stop at its " +
                "first Stop rather than work. Add work, or expect it to end at once.");
  } else if (!q.readable) {
    console.log(`\nNOTE: no readable queue at ${queue}. Create it (see QUEUE.template.md) ` +
                "or re-arm with an explicit path. Until it reads, the dry-queue exit is off.");
  }
}

function cmdOff(all) {
  if (all) {
    let n = 0;
    for (const f of listRunFiles()) if (readStateAt(f)) { disarmAt(f, "manual (--all)"); n++; }
    console.log(`autonomous mode disarmed for ${n} run(s)`);
    return;
  }
  const sid = sessionIdFrom({});
  if (!sid) { console.log("no session id; nothing disarmed (use --all)"); return; }
  const f = stateFile(sid);
  if (!readStateAt(f)) { console.log("not armed for this session"); return; }
  disarmAt(f, "manual");
  console.log("autonomous mode disarmed");
}

/**
 * Is any agent currently working this machine? For scripts or scheduled jobs that should
 * DEFER rather than edit the same files concurrently.
 *
 * There is deliberately no separate lock file: an armed, unexpired run file already IS
 * the fact "an agent is working", and a second artifact could disagree with it. That also
 * makes staleness free — a run past its deadline holds nothing.
 *
 * Exit 0 = free, exit 1 = held.
 */
function cmdLock() {
  const now = Date.now();
  const held = [];
  for (const f of listRunFiles()) {
    const s = readStateAt(f);
    if (s && now < s.deadlineMs) {
      held.push({ sid: path.basename(f, ".json"), until: new Date(s.deadlineMs) });
    }
  }
  if (!held.length) { console.log("free"); return 0; }
  for (const h of held) {
    console.log(`held by ${h.sid.slice(0, 8)} until ${h.until.toLocaleString()}`);
  }
  process.exitCode = 1;
  return 1;
}

function cmdStatus(all) {
  const files = all ? listRunFiles() : [stateFile(sessionIdFrom({}))];
  const rows = [];
  for (const f of files) {
    const s = readStateAt(f);
    if (!s) continue;
    const q = scanQueue(s.queue);
    rows.push(`${path.basename(f, ".json").slice(0, 8)}  armed — ` +
              `${fmtRemaining(s.deadlineMs - Date.now())} left, ` +
              `turn ${s.turns || 0}/${s.turnCap}, ` +
              `${q.readable ? q.open + " open queue item(s)" : "queue unreadable"} (${s.queue})`);
  }
  if (!rows.length) { console.log("not armed"); return; }
  console.log(rows.join("\n"));
}

// ------------------------------------------------------------------- hook

function main() {
  const argv = process.argv;
  const all = argv.includes("--all");

  if (argv[2] === "off") return cmdOff(all);
  if (argv[2] === "arm") return cmdArm(argv[3], argv[4]);
  if (argv[2] === "status") return cmdStatus(all);
  if (argv[2] === "lock") return cmdLock();

  const payload = readPayload();
  const sid = sessionIdFrom(payload);
  if (!sid) allowStop();                   // no session: stay out of the way

  const state = readStateAt(stateFile(sid));
  if (!state) allowStop();                 // not armed: ordinary session

  const now = Date.now();
  const cap = Number.isFinite(state.turnCap) ? state.turnCap : DEFAULT_TURN_CAP;

  // Backstop 3 first: the hard ceiling can never be argued with.
  if (now > state.deadlineMs + GRACE_MS) {
    disarmAt(state.file, "hard ceiling (deadline + grace) passed");
    allowStop();
  }
  // Backstop 1: the deadline.
  if (now >= state.deadlineMs) {
    disarmAt(state.file, "deadline reached");
    allowStop();
  }

  // Backstop 4: a verifiably empty queue.
  //
  // An UNREADABLE queue is deliberately NOT treated as dry. "Dry" is a positive claim
  // and needs evidence; a missing file is the absence of evidence, and releasing on it
  // would mean a renamed queue silently ends every run. The deadline and the turn cap
  // still bound the session, so this cannot trap it.
  const q = scanQueue(state.queue);
  const dry = q.readable && q.open === 0;

  // A dry queue means the work is FINISHED — exactly when the wrap-up matters most. So
  // the first dry Stop ASKS for the wrap-up; the second releases. The turn counter is
  // bumped either way, so even if the flag write fails this is bounded by the turn cap.
  if (dry && state.dryWrapAsked === true) {
    disarmAt(state.file, "queue dry, wrap-up requested and acknowledged");
    allowStop();
  }
  if (!q.readable) {
    log(`WARNING: queue unreadable at ${state.queue} — treating as NOT dry`);
  }

  // Backstop 2: the turn cap.
  const turns = bumpTurn(state);
  if (turns > cap) {
    disarmAt(state.file, `turn cap ${cap} reached`);
    allowStop();
  }

  // Stall accounting (see STALL_WARN above). Skipped on a dry queue, which has its own wrap.
  let stall = 0;
  if (!dry) {
    const fp = progressFingerprint(state, payload);
    stall = fp === state.lastProgress ? (state.stallCount || 0) + 1 : 0;
    if (stall >= STALL_WRAP && state.stallWrapAsked === true) {
      disarmAt(state.file, `stalled: no progress for ${stall} Stops, wrap-up already requested`);
      allowStop();
    }
    persist(state, { lastProgress: fp, stallCount: stall, ...(stall === 0 ? { stallWrapAsked: false } : {}) });
  }

  const remaining = state.deadlineMs - now;
  const wrapping = remaining <= WRAP_MS;
  if (stall >= STALL_WRAP) {
    persist(state, { stallWrapAsked: true });
    log(`stall [${sid.slice(0, 8)}]: ${stall} Stops without progress -> wrap-up requested`);
    blockStop(
      `AUTONOMOUS MODE — STALLED. ${stall} consecutive Stops with no change to ${state.queue} ` +
      `and no git change in its repo or your working directory. Treat the current approach as ` +
      `failed. Finish in this order, then stop:\n` +
      `1. Park what you were stuck on in BLOCKERS.md: what you tried, why it did not move.\n` +
      `2. Commit every repo you touched; leave no dirty tree.\n` +
      `3. Write/refresh the state note for this session.\n` +
      `4. Write the summary, naming the stall in its Mistake row.\n` +
      `If you commit, that counts as progress and the run continues; if nothing changes, ` +
      `the next Stop releases you.`
    );
  }
  const stallLine = stall >= STALL_WARN
    ? `NO PROGRESS for ${stall} Stops: the queue and git are unchanged since turn ` +
      `${turns - stall}. Do not try the same thing again. State what you expected to change, ` +
      `pick a different approach or a different queue item, or park this one in BLOCKERS.md. ` +
      `At ${STALL_WRAP} the run wraps up.\n`
    : "";
  log(`block [${sid.slice(0, 8)}]: turn ${turns}/${cap}, ${fmtRemaining(remaining)} left, ` +
      `${q.readable ? q.open : "?"} open queue item(s)${wrapping ? " (WRAP)" : ""}`);

  // Finished, not out of time. The flag means the next Stop releases regardless.
  if (dry) {
    persist(state, { dryWrapAsked: true });
    blockStop(
      `AUTONOMOUS MODE — THE QUEUE IS DRY. ` +
      (q.gatedCount
        ? `Nothing in ${state.queue} is workable: ${q.gatedCount} item(s) remain but every ` +
          `one is owned by the user — ${q.gated.slice(0, 3).join(" · ")} — and the ` +
          `charter forbids deciding those for them. Say so by name in your report; an item ` +
          `waiting on the user is not the same as no work, and they cannot unblock what ` +
          `they are not told about.\n`
        : `Every item in ${state.queue} is closed, so the work is done.\n`) +
      `You may stop after wrapping up. Do not start anything new and do ` +
      `NOT invent work — the user decides what is worth doing. Finish in this order:\n` +
      `1. Commit every repo you touched; leave no dirty tree.\n` +
      `2. Write/refresh the state note for this session.\n` +
      `3. Update ${state.queue} — close what you closed, add what you opened.\n` +
      `4. Write the summary: what you did, why, what you got wrong, what needs the user.\n` +
      `Then say plainly that the queue is dry and stop. The next Stop releases you ` +
      `whatever the queue says, so this asks once and never loops.`
    );
  }

  if (wrapping) {
    blockStop(
      `AUTONOMOUS MODE — WRAP UP NOW. ${fmtRemaining(remaining)} left before the user is back. ` +
      `Do not start anything new. Finish in this order, then stop:\n` +
      `1. Commit every repo you touched; leave no dirty tree.\n` +
      `2. Write/refresh the state note for this session.\n` +
      `3. Update ${state.queue} — close what you closed, add what you opened.\n` +
      `4. Write the summary: what you did, why, what you got wrong, what needs the user.\n` +
      `If all four are genuinely done, say so plainly and stop — this hook will let you.`
    );
  }

  blockStop(
    `AUTONOMOUS MODE — keep working. ${fmtRemaining(remaining)} left, turn ${turns}/${cap}.\n` +
    stallLine +
    // Never interpolate q.open without checking q.readable: an unreadable queue reports
    // open:0, and "0 open item(s)" would promise a release the hook will refuse.
    (q.readable
      ? `${q.open} open item(s) in the queue: ${q.titles.slice(0, 5).join(" · ")}\n` +
        (q.gatedCount
          ? `${q.gatedCount} further item(s) are owned by the USER and must not be worked or ` +
            `decided: ${q.gated.slice(0, 3).join(" · ")}\n`
          : "")
      : `THE QUEUE COULD NOT BE READ at ${state.queue}. That is NOT the same as empty, ` +
        `and this run will not be released for a dry queue until the file reads again. ` +
        `Check the path before assuming there is no work.\n`) +
    `Work source, in priority order: ${state.queue}, then BLOCKERS.md, then the newest ` +
    `state note's "Next".\n` +
    `Rules while unattended (charter: ${state.charter}):\n` +
    (q.readable
      ? `- If the queue is genuinely dry, say so and DO NOT invent work — the user ` +
        `decides what is worth doing. Then stop; this hook lets you, and it checks ` +
        `the queue itself rather than taking your word for it.\n`
      : `- DO NOT invent work — the user decides what is worth doing. The dry-queue ` +
        `exit is UNAVAILABLE while the queue is unreadable, so do not expect to be ` +
        `released by finishing. Say the queue is unreadable, park it in BLOCKERS.md, ` +
        `and work the state note's "Next" instead.\n`) +
    `- Park anything that needs the user's decision in BLOCKERS.md and move to the next item.\n` +
    `- Verify before reporting; a check you did not finish is not a finding.\n` +
    `- Commit locally as you go. Never push.\n` +
    `Say in one line what you are picking up next, then do it.`
  );
}

try {
  main();
} catch (e) {
  // Absolute last resort. A crash here must not strand the session.
  log(`FATAL, allowing stop: ${e && e.stack}`);
  process.exit(0);
}
