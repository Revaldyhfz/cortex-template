#!/usr/bin/env node
/**
 * autonomous.test.mjs — tests for claude/autonomous/autonomous.js.
 *
 *   node test/autonomous.test.mjs      (from the repo root; exits non-zero on failure)
 *
 * The tests that matter most prove the hook CANNOT TRAP A SESSION: every malformed-input
 * path is asserted to allow the stop. Everything runs in temp directories via the
 * AUTONOMOUS_DIR / AUTONOMOUS_LOG / AUTONOMOUS_QUEUE seams; nothing touches ~/.claude.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(REPO, "claude", "autonomous", "autonomous.js");
const HOME = os.homedir();

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "aw-test-"));
const RUNS = path.join(SANDBOX, "runs");
const LOG = path.join(SANDBOX, "autonomous.log");
const SID = "test";
const STATE = path.join(RUNS, `${SID}.json`);
const SANDBOX_ENV = { AUTONOMOUS_DIR: SANDBOX, AUTONOMOUS_LOG: LOG, AUTONOMOUS_QUEUE: "" };
const MISSING_QUEUE = path.join(SANDBOX, "nope", "queue.md"); // never created: unreadable != dry

/** The real log, which no test may touch. Asserted at the end. */
const REAL_LOG = path.join(HOME, ".claude", "autonomous", "autonomous.log");
const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return -1; } };
const REAL_LOG_BEFORE = sizeOf(REAL_LOG);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  -> " + detail : ""}`); }
}

/** Invoke the hook as session `sid` would, with a Stop payload on stdin. */
function runAs(sid) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "Stop", session_id: sid }),
    encoding: "utf8",
    env: { ...process.env, ...SANDBOX_ENV, CLAUDE_CODE_SESSION_ID: "" },
  });
  let parsed = null;
  try { parsed = r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null; } catch { /* noop */ }
  return { status: r.status, stdout: r.stdout.trim(), json: parsed };
}
const run = () => runAs(SID);

/** CLI invocations resolve the session from the environment, not from stdin. */
function cli(args, sid = SID, extraEnv = {}, cwd = undefined) {
  return spawnSync(process.execPath, [HOOK, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, ...SANDBOX_ENV, CLAUDE_CODE_SESSION_ID: sid, ...extraEnv },
  });
}

const fileFor = (sid) => path.join(RUNS, `${sid}.json`);
function writeStateFor(sid, o) {
  fs.mkdirSync(RUNS, { recursive: true });
  fs.writeFileSync(fileFor(sid), JSON.stringify(o, null, 2), "utf8");
}
const writeState = (o) => writeStateFor(SID, o);
function writeRaw(s) {
  fs.mkdirSync(RUNS, { recursive: true });
  fs.writeFileSync(STATE, s, "utf8");
}
const readStateFor = (sid) => JSON.parse(fs.readFileSync(fileFor(sid), "utf8"));
const clearFor = (sid) => { try { fs.unlinkSync(fileFor(sid)); } catch { /* noop */ } };
const clearState = () => clearFor(SID);

/** Queue fixtures on disk (not a git repo, so only the queue file counts as progress). */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "awq-"));
function queueWith(body) {
  const p = path.join(TMP, `q${Math.floor(Math.random() * 1e9)}.md`);
  fs.writeFileSync(p, body, "utf8");
  return p;
}
const OPEN_ITEM =
  "# QUEUE\n\n## P1\n\n- **[P1] A real open item** — scope: `x/` · done when: tests exit 0\n";
const NO_OPEN_ITEMS =
  "# QUEUE\n\n## P1\n\n- ~~**[P1] Finished thing**~~ — **DONE**, commit abc123.\n\n" +
  "- **[P2] Closed in substance** — **MEASURED and not recommended.** No clause here.\n";

function armed(overrides = {}) {
  return {
    armed: true,
    sessionId: SID,
    startedAt: new Date().toISOString(),
    deadline: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
    turns: 0,
    turnCap: 400,
    queue: MISSING_QUEUE,
    charter: path.join(SANDBOX, "CHARTER.md"),
    ...overrides,
  };
}

console.log("autonomous.js");

// ── it must never trap ───────────────────────────────────────────────────────
console.log("\n cannot trap the session:");

clearState();
check("no state file -> allows stop", run().status === 0 && run().json === null);

writeRaw("{ this is not json");
check("corrupt JSON -> allows stop", run().json === null);

writeState(armed({ deadline: "not-a-date" }));
check("unparseable deadline -> allows stop", run().json === null);

writeState(armed({ deadline: undefined }));
check("missing deadline -> allows stop", run().json === null);

writeState(armed({ armed: false }));
check("armed:false -> allows stop", run().json === null);

writeState(armed({ deadline: new Date(Date.now() - 1000).toISOString() }));
check("past deadline -> allows stop", run().json === null);
check("past deadline -> state marked disarmed", readStateFor(SID).armed === false);

writeState(armed({ turns: 999, turnCap: 400 }));
check("past turn cap -> allows stop", run().json === null);

writeState(armed({ deadline: new Date(Date.now() - 60 * 60 * 1000).toISOString(), turns: 0 }));
check("far past deadline (hard ceiling) -> allows stop", run().json === null);

const noSid = spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ hook_event_name: "Stop" }),
  encoding: "utf8",
  env: { ...process.env, ...SANDBOX_ENV, CLAUDE_CODE_SESSION_ID: "" },
});
check("no session id anywhere -> allows stop", noSid.status === 0 && !noSid.stdout.trim());

const junkIn = spawnSync(process.execPath, [HOOK], {
  input: "not json at all",
  encoding: "utf8",
  env: { ...process.env, ...SANDBOX_ENV, CLAUDE_CODE_SESSION_ID: "" },
});
check("unparseable stdin payload -> allows stop", junkIn.status === 0);

// ── it persists while it should ──────────────────────────────────────────────
console.log("\n persists while armed and in time:");

writeState(armed());
let r = run();
check("armed with time left -> blocks", r.json && r.json.decision === "block");
check("block carries a reason", !!(r.json && r.json.reason));
check("reason names the queue", !!(r.json && r.json.reason.includes(MISSING_QUEUE)));
check("reason forbids inventing work", !!(r.json && /DO NOT invent work/i.test(r.json.reason)));
check("reason forbids pushing", !!(r.json && /Never push/i.test(r.json.reason)));
check("blocking increments the turn counter", readStateFor(SID).turns === 1,
  `turns=${readStateFor(SID).turns}`);
run();
check("turn counter keeps incrementing", readStateFor(SID).turns === 2);

// ── the wrap-up window ───────────────────────────────────────────────────────
console.log("\n wrap-up window:");

writeState(armed({ deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString() }));
r = run();
check("inside 20m of the deadline -> still blocks", r.json && r.json.decision === "block");
check("but the reason says WRAP UP", !!(r.json && /WRAP UP NOW/.test(r.json.reason)));
check("wrap reason forbids starting anything new",
  !!(r.json && /Do not start anything new/i.test(r.json.reason)));
check("wrap reason demands a clean tree", !!(r.json && /dirty tree/i.test(r.json.reason)));

writeState(armed({ deadline: new Date(Date.now() + 90 * 60 * 1000).toISOString() }));
r = run();
check("well before the deadline -> normal keep-working reason",
  !!(r.json && !/WRAP UP NOW/.test(r.json.reason)));

// ── turn cap is independent of the clock ─────────────────────────────────────
console.log("\n turn cap is independent of the clock:");

writeState(armed({ turns: 3, turnCap: 4, deadline: new Date(Date.now() + 9e6).toISOString() }));
check("under cap -> blocks", run().json !== null);
check("crossing cap -> allows stop even with hours left", run().json === null);

// ── runs are keyed by session ────────────────────────────────────────────────
console.log("\n runs are keyed by session:");

clearFor("alpha"); clearFor("beta");
writeStateFor("alpha", { ...armed(), sessionId: "alpha" });
check("an armed session blocks", runAs("alpha").json !== null);
check("a DIFFERENT session is unaffected and stops", runAs("beta").json === null);

writeStateFor("alpha", { ...armed(), sessionId: "alpha", turns: 0 });
writeStateFor("beta", { ...armed(), sessionId: "beta", turns: 0 });
runAs("alpha"); runAs("alpha"); runAs("beta");
check("turn counters are per session, not pooled",
  readStateFor("alpha").turns === 2 && readStateFor("beta").turns === 1,
  `alpha=${readStateFor("alpha").turns} beta=${readStateFor("beta").turns}`);

cli(["off"], "alpha");
check("`off` disarms only the calling session", readStateFor("alpha").armed === false);
check("the other session stays armed", readStateFor("beta").armed === true);
check("and the other session still blocks", runAs("beta").json !== null);

cli(["off", "--all"], "alpha");
check("`off --all` disarms every run", readStateFor("beta").armed === false);

writeStateFor("alpha", { ...armed(), sessionId: "alpha" });
check("arming one session does not overwrite another's file",
  !fs.existsSync(fileFor("beta")) || readStateFor("beta").sessionId === "beta");

check("a session id cannot escape the runs directory", runAs("../../../evil").status === 0);
check("path traversal did not create a file outside runs/",
  !fs.existsSync(path.join(SANDBOX, "evil.json")) &&
  !fs.existsSync(path.join(path.dirname(SANDBOX), "evil.json")));

clearFor("alpha"); clearFor("beta");

// ── the dry-queue exit ───────────────────────────────────────────────────────
console.log("\n the dry-queue exit:");

writeState(armed({ queue: queueWith(OPEN_ITEM) }));
check("an open [P1] item -> still blocks", run().json !== null);

// Dry is TWO-PHASE: the first dry Stop asks for the wrap-up, the second releases.
writeState(armed({ queue: queueWith(NO_OPEN_ITEMS) }));
r = run();
check("no open items -> asks for the wrap-up rather than releasing",
  !!(r.json && /THE QUEUE IS DRY/.test(r.json.reason)));
check("the dry wrap-up demands a clean tree and a state note",
  !!(r.json && /dirty tree/i.test(r.json.reason) && /state note/i.test(r.json.reason)));
check("the dry wrap-up still forbids inventing work",
  !!(r.json && /DO NOT invent work/i.test(r.json.reason)));
check("and it records that the ask was made", readStateFor(SID).dryWrapAsked === true);

check("the NEXT dry Stop releases", run().json === null);
check("and the run is disarmed with the reason recorded",
  readStateFor(SID).armed === false && /queue dry/.test(readStateFor(SID).endedBecause || ""),
  readStateFor(SID).endedBecause);

writeState(armed({ queue: queueWith(NO_OPEN_ITEMS), turns: 7 }));
run();
check("the wrap-up ask costs exactly one turn, so a failed flag write cannot loop",
  readStateFor(SID).turns === 8, `turns=${readStateFor(SID).turns}`);

writeState(armed({ queue: queueWith(NO_OPEN_ITEMS), turns: 3, turnCap: 4 }));
run();
check("a dry queue still cannot outlive the turn cap", run().json === null);

writeState(armed({ queue: MISSING_QUEUE }));
r = run();
check("an UNREADABLE queue is not treated as dry -> still blocks", r.json !== null);
check("and the message says UNREADABLE, never '0 open item(s)'",
  !!(r.json && /COULD NOT BE READ/.test(r.json.reason)) && !/0 open item\(s\)/.test(r.json.reason),
  r.json && r.json.reason.split("\n")[1]);
check("and it does not promise a release it will refuse",
  !!(r.json && /dry-queue exit is UNAVAILABLE/.test(r.json.reason)));

writeState(armed({ queue: queueWith("# QUEUE\n\nnothing at all\n") }));
check("a queue with no entries at all -> asks to wrap up", !!(run().json || {}).reason);

writeState(armed({ queue: queueWith(OPEN_ITEM) }));
r = run();
check("the block message reports the open count",
  !!(r.json && /1 open item\(s\)/.test(r.json.reason)), r.json && r.json.reason.slice(0, 80));

writeState(armed({ queue: queueWith(
  "# QUEUE\n\n```\n- **[P1] Short title** — scope: <x> · done when: <y>\n```\n") }));
check("the documented format example is not counted as an item",
  /THE QUEUE IS DRY/.test((run().json || {}).reason || ""));

writeState(armed({ queue: queueWith(
  "# QUEUE\n\n- **[P1] ~~Old thing~~** — scope: `x/` · done when: it is green\n" +
  "  Nothing further to do here.\n") }));
check("strikethrough closes an item even if `done when:` survived",
  /THE QUEUE IS DRY/.test((run().json || {}).reason || ""));

// ── the shipped template parses to something sane ────────────────────────────
console.log("\n against QUEUE.template.md:");

const TEMPLATE = path.join(REPO, "claude", "autonomous", "QUEUE.template.md");
if (fs.existsSync(TEMPLATE)) {
  writeState(armed({ queue: TEMPLATE }));
  r = run();
  check("the template parses without throwing", r.status === 0);
  check("the template reports its open example items and its gated one",
    !!(r.json && /\d+ open item\(s\)/.test(r.json.reason) && /owned by the USER/.test(r.json.reason)),
    r.json && r.json.reason.split("\n").slice(1, 3).join(" | "));
} else {
  check("QUEUE.template.md exists", false, `missing: ${TEMPLATE}`);
}

// ── gated on the user ────────────────────────────────────────────────────────
console.log("\n gated-on-user items:");

const GATED_ONLY =
  "# QUEUE\n\n## P1\n\n" +
  "- **[P1] Theirs to decide** — scope: `x/` · owner: user · done when: they say yes or no\n";
const MIXED =
  "# QUEUE\n\n## P1\n\n" +
  "- **[P1] Mine to do** — scope: `x/` · done when: tests exit 0\n\n" +
  "- **[P2] Theirs to decide** — scope: `y/` · owner: user · done when: they pick one\n";
const OWNED_BY_CLAUDE =
  "# QUEUE\n\n## P1\n\n" +
  "- **[P1] Explicitly mine** — scope: `x/` · owner: Claude · done when: tests exit 0\n";

writeState(armed({ queue: queueWith(GATED_ONLY) }));
r = run();
check("a queue of only user-owned items counts as DRY",
  !!(r.json && /THE QUEUE IS DRY/.test(r.json.reason)));
check("and the wrap-up says they are the user's rather than pretending they are gone",
  !!(r.json && /owned by the user/i.test(r.json.reason) && /Theirs to decide/.test(r.json.reason)),
  r.json && r.json.reason.split("\n")[0].slice(0, 90));
check("and it tells the agent to name them",
  !!(r.json && /cannot unblock what they are not/i.test(r.json.reason)));

writeState(armed({ queue: queueWith(MIXED) }));
r = run();
check("a gated item does not hide real work", !!(r.json && /1 open item\(s\)/.test(r.json.reason)));
check("the workable item is the one reported", !!(r.json && /Mine to do/.test(r.json.reason)));
check("and the gated one is listed separately",
  !!(r.json && /owned by the USER and must not be worked/i.test(r.json.reason)));

writeState(armed({ queue: queueWith(OWNED_BY_CLAUDE) }));
r = run();
check("`owner: Claude` is still the agent's work, not gated",
  !!(r.json && /1 open item\(s\)/.test(r.json.reason)), r.json && r.json.reason.split("\n")[1]);

writeState(armed({ queue: queueWith(
  "# QUEUE\n\n- **[P1] A title long enough that it has to wrap onto\n" +
  "  a second line before it closes** — scope: `x/` · done when: tests exit 0\n") }));
r = run();
check("a title that wraps onto a second line is read whole",
  !!(r.json && /A title long enough that it has to wrap onto a second line before it closes/
    .test(r.json.reason)), r.json && r.json.reason.split("\n")[1]);

// ── the advisory lock ────────────────────────────────────────────────────────
console.log("\n advisory lock (is an agent working?):");

clearFor("alpha"); clearFor("beta"); clearState();
let lk = cli(["lock"]);
check("no armed run -> free, exit 0", lk.status === 0 && /free/.test(lk.stdout),
  `${lk.status} ${lk.stdout.trim()}`);

writeStateFor("alpha", { ...armed(), sessionId: "alpha" });
lk = cli(["lock"]);
check("an armed run -> held, exit 1", lk.status === 1 && /held by alpha/.test(lk.stdout),
  `${lk.status} ${lk.stdout.trim()}`);
check("and it says until when", /until/.test(lk.stdout), lk.stdout.trim());

writeStateFor("beta", { ...armed(), sessionId: "beta", deadline: new Date(Date.now() - 60000).toISOString() });
clearFor("alpha");
lk = cli(["lock"]);
check("an EXPIRED run holds nothing", lk.status === 0 && /free/.test(lk.stdout),
  `${lk.status} ${lk.stdout.trim()}`);

writeStateFor("beta", { ...armed(), sessionId: "beta", armed: false });
lk = cli(["lock"]);
check("a disarmed run holds nothing", lk.status === 0 && /free/.test(lk.stdout));
clearFor("beta");

// ── remaining-time rendering ─────────────────────────────────────────────────
console.log("\n remaining-time rendering:");

writeState(armed({ deadline: new Date(Date.now() + 7199000).toISOString(), queue: queueWith(OPEN_ITEM) }));
r = run();
check("just under 2h renders as 2h, not 1h 60m",
  !!(r.json && /2h 0m left/.test(r.json.reason)) && !/60m/.test(r.json.reason),
  r.json && r.json.reason.split("\n")[0]);

writeState(armed({ deadline: new Date(Date.now() + 5400000).toISOString(), queue: queueWith(OPEN_ITEM) }));
r = run();
check("a normal duration still renders normally",
  !!(r.json && /1h 30m left/.test(r.json.reason)), r.json && r.json.reason.split("\n")[0]);

// ── manual disarm ────────────────────────────────────────────────────────────
console.log("\n manual disarm:");

writeState(armed());
cli(["off"]);
check("`off` sets armed:false", readStateFor(SID).armed === false);
check("after `off` the hook allows stop", run().json === null);

// ── arm / status ─────────────────────────────────────────────────────────────
console.log("\n arm and status:");

clearState();
const armQ = queueWith(OPEN_ITEM);
let a = cli(["arm", "3", armQ]);
check("arm 3 exits 0", a.status === 0, a.stderr);
const armedState = readStateFor(SID);
check("arm sets armed:true", armedState.armed === true);
check("arm sets a deadline ~3h out",
  Math.abs((Date.parse(armedState.deadline) - Date.now()) - 3 * 3600 * 1000) < 60000);
check("arm resets the turn counter", armedState.turns === 0);
check("arm uses an explicit queue path", armedState.queue === path.resolve(armQ), armedState.queue);
check("arm stamps the session id", armedState.sessionId === SID);
check("arm reports the queue depth it is arming onto", /"queueOpenItems": 1/.test(a.stdout),
  a.stdout.slice(0, 120));

// Default queue: QUEUE.md in the working directory `arm` runs from.
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), "aw-cwd-"));
fs.writeFileSync(path.join(CWD, "QUEUE.md"), OPEN_ITEM, "utf8");
a = cli(["arm", "1"], "cwd-default", {}, CWD);
check("with no path, arm defaults to QUEUE.md in the cwd",
  a.status === 0 && readStateFor("cwd-default").queue === path.join(CWD, "QUEUE.md"),
  a.stderr || readStateFor("cwd-default").queue);
a = cli(["arm", "1"], "cwd-env", { AUTONOMOUS_QUEUE: armQ }, CWD);
check("$AUTONOMOUS_QUEUE beats the cwd default",
  readStateFor("cwd-env").queue === path.resolve(armQ), readStateFor("cwd-env").queue);
a = cli(["arm", "1", path.join(CWD, "QUEUE.md")], "cwd-arg", { AUTONOMOUS_QUEUE: armQ }, CWD);
check("an explicit path beats $AUTONOMOUS_QUEUE",
  readStateFor("cwd-arg").queue === path.join(CWD, "QUEUE.md"), readStateFor("cwd-arg").queue);
a = cli(["arm", "1"], "cwd-missing", {}, TMP);
check("arming onto a missing queue warns instead of failing",
  a.status === 0 && /no readable queue/.test(a.stdout), a.stdout.slice(-160));
["cwd-default", "cwd-env", "cwd-arg", "cwd-missing"].forEach(clearFor);
try { fs.rmSync(CWD, { recursive: true, force: true }); } catch { /* noop */ }

check("arm 0 is rejected", cli(["arm", "0"]).status === 2);
check("arm 99 (>24h) is rejected", cli(["arm", "99"]).status === 2);
check("arm with junk is rejected", cli(["arm", "abc"]).status === 2);

const noEnvArm = spawnSync(process.execPath, [HOOK, "arm", "3"], {
  encoding: "utf8",
  env: { ...process.env, ...SANDBOX_ENV, CLAUDE_CODE_SESSION_ID: "" },
});
check("arm without a session id is refused rather than writing a shared file",
  noEnvArm.status === 2, noEnvArm.stderr.slice(0, 60));

check("status reports armed", /armed/.test(cli(["status"]).stdout));
check("status --all does not throw", cli(["status", "--all"]).status === 0);

// ── scanQueue, via `arm`'s report ────────────────────────────────────────────
console.log("\n scanQueue — the parser that decides work-or-exit:");

const QDIR = fs.mkdtempSync(path.join(os.tmpdir(), "aw-queue-"));
function queueSays(name, body, expectOpen) {
  const qf = path.join(QDIR, `${name.replace(/[^a-z0-9]+/gi, "_")}.md`);
  fs.writeFileSync(qf, body, "utf8");
  const sid = `q-${Math.floor(Math.random() * 1e9)}`;
  const res = cli(["arm", "1"], sid, { AUTONOMOUS_QUEUE: qf });
  // `arm` prints its JSON and then, sometimes, a human-facing NOTE. Cut at the note.
  let open = null;
  const cut = res.stdout.indexOf("\nNOTE");
  const json = cut === -1 ? res.stdout : res.stdout.slice(0, cut);
  try { open = JSON.parse(json.trim()).queueOpenItems; } catch { /* noop */ }
  check(name, open === expectOpen, `expected ${expectOpen}, got ${open}`);
  clearFor(sid);
}

const ITEM = (t) => `- **[P1] ${t}** — scope: x · done when: it is done\n  context line\n`;

queueSays("a plain open item counts", ITEM("Do the thing"), 1);
queueSays("an owner:user item does not count",
  `- **[P1] Their call** — scope: x · owner: user · done when: they say\n`, 0);
queueSays("a struck item does not count",
  `- **[P1] ~~Done already~~** — scope: x · done when: it was done\n`, 0);
queueSays("a struck SUB-BULLET does not close an open parent",
  `- **[P1] Parent loop** — scope: x · done when: all fourteen are acted on\n` +
  `  - ~~**[P1] One sub-task already done**~~ — done when: it was done\n` +
  `  Item stays OPEN for the deferred six.\n`, 1);
queueSays("a struck parent is still closed even when a child is open",
  `- ~~**[P1] Whole thing done**~~ — scope: x · done when: it was done\n` +
  `  - **[P1] leftover child** — scope: x · done when: never\n`, 0);
queueSays("an item with no done-when is not work",
  `- **[P1] Vague** — scope: x · make it better\n`, 0);
queueSays("owner:Claude counts as open",
  `- **[P1] Mine** — scope: x · owner: Claude · done when: proof exists\n`, 1);
queueSays("a ### heading terminates an entry, so prose below cannot steal its owner",
  ITEM("Mine to do") +
  `\n### Someone else's section\n\nThis section is about work with owner: user in it.\n`, 1);
queueSays("a ## heading still terminates an entry",
  ITEM("Mine to do") + `\n## Another section\n\nowner: user appears here.\n`, 1);
queueSays("the format example in the header is documentation, not an item",
  `- **[P1] Short title** — scope: <where> · done when: <evidence>\n`, 0);

try { fs.rmSync(QDIR, { recursive: true, force: true }); } catch { /* noop */ }

// ── stall detection ──────────────────────────────────────────────────────────
console.log("\n stall detection:");
{
  const q = queueWith(OPEN_ITEM);
  clearState();
  writeState(armed({ queue: q }));
  const reasons = [];
  for (let i = 0; i < 5; i++) reasons.push((run().json || {}).reason || "");
  check("no stall line while progress is unknown or recent",
    !/NO PROGRESS/.test(reasons[0]) && !/NO PROGRESS/.test(reasons[3]));
  check("warns at 4 unchanged Stops", /NO PROGRESS for 4 Stops/.test(reasons[4]), reasons[4].slice(0, 120));

  fs.appendFileSync(q, "\n- **[P1] Newly added item** — scope: `y/` · done when: z\n");
  const after = (run().json || {}).reason || "";
  check("a queue edit counts as progress and clears the warning", !/NO PROGRESS/.test(after));
  check("...and resets the counter", readStateFor(SID).stallCount === 0);

  for (let i = 0; i < 9; i++) run();
  const wrap = run();
  check("asks for a stall wrap-up at 10", /STALLED\. 10 consecutive Stops/.test((wrap.json || {}).reason || ""));
  check("the wrap-up is still a block, not a release", wrap.json && wrap.json.decision === "block");
  const rel = run();
  check("the next unchanged Stop releases", rel.status === 0 && rel.json === null);
  check("...and disarms with the reason on record",
    readStateFor(SID).armed === false && /stalled/.test(readStateFor(SID).endedBecause || ""),
    JSON.stringify(readStateFor(SID)).slice(0, 200));

  clearState();
  writeState(armed({ queue: queueWith(NO_OPEN_ITEMS) }));
  for (let i = 0; i < 12; i++) run();
  check("a dry queue never enters stall accounting", !readStateFor(SID).stallWrapAsked);
  clearState();
}

// ── the suite must leave no trace on a real installation ────────────────────
console.log("\n leaves the real install alone:");

check("the real autonomous.log gained nothing from this run",
  sizeOf(REAL_LOG) === REAL_LOG_BEFORE, `before=${REAL_LOG_BEFORE} after=${sizeOf(REAL_LOG)}`);

const realRuns = path.join(HOME, ".claude", "autonomous", "runs");
let strays = [];
try { strays = fs.readdirSync(realRuns).filter((f) => /^(test|alpha|beta|q-\d+|cwd-\w+)\.json$/.test(f)); } catch { /* noop */ }
check("no test run files were written to the real runs directory", strays.length === 0, strays.join(", "));
check("the sandbox log is where the writing actually went", fs.existsSync(LOG) && fs.statSync(LOG).size > 0);

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ }
try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* noop */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
