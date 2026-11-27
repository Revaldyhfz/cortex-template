---
name: aw
description: Arm autonomous mode for a stated number of hours away. Use when the user types /aw or /aw <hours>, or says they are heading out and want work to continue without them — "I'll be out for 5 hours", "keep working while I'm gone", "autonomous mode".
---

# aw — autonomous work

`/aw 5` means **"I will be back in about 5 hours. Work until then."**

The number is the user's *absence*, not a work estimate. The run must land in a
reportable state before they walk back in, so the last 20 minutes are reserved for
wrapping up, not for starting anything.

## Steps

### 1. Arm the hook — do this FIRST, before any work

From the project directory you are going to work in:

```
node ~/.claude/autonomous/autonomous.js arm <hours> [queue-path]
```

(On Windows, `~` may not expand in every shell — use the full path to your home folder,
e.g. `node "$HOME/.claude/autonomous/autonomous.js" arm 3` in PowerShell or Git Bash.)

- Bare `/aw` with no number: use **3**, and say so.
- The queue is, in order: the path you pass, then `$AUTONOMOUS_QUEUE`, then `QUEUE.md`
  in the current directory.

This writes `~/.claude/autonomous/runs/<session-id>.json`. From then on the Stop hook
refuses to let the session end until the deadline passes, the turn cap is hit, progress
stalls, or the queue is verifiably dry. Arming first is what makes this different from
merely intending to keep going: an intention is advisory, a hook is deterministic.

`arm` prints the deadline, the wrap-up time and how many open items it is arming onto.

- **0 open items** → say so and do not start; the run would stop at its first Stop.
- **No readable queue** → go to step 2 and create one.

Echo the deadline and wrap-up time back in the user's local clock.

### 2. Find or create the queue

If `QUEUE.md` does not exist, create it from `~/.claude/autonomous/QUEUE.template.md`
and fill it with real items drawn from what the user asked for, the newest state note's
"Next", open issues or TODOs in the project. Each item needs a `done when:` with
observable evidence. Anything that needs the user's decision gets `owner: user`.

Then read, in order:

1. `QUEUE.md` — the work
2. `BLOCKERS.md` — items that may have become actionable without the user
3. The newest state note — its **Next** line
4. `~/.claude/autonomous/CHARTER.md` — **read it; it is short, and it is what you obey
   when nobody is watching**

### 3. Plan against the clock, in about five lines

Say which items you are taking, in order, and why. Anything that cannot finish or park
cleanly inside the window does not get started — pick the next item instead.

Front-load anything long-running and **background it immediately** (a download, a build,
a long test run), then work other items while it runs.

### 4. Work under the charter

The Stop hook wakes you with the time remaining, the turn count and the open items. You
do not need to track the clock. You do need to:

- **Say in one line what you are picking up** each time you move to a new item.
- **Park the user's decisions in `BLOCKERS.md`** and continue. Never stall on them.
- **Commit locally as you go.** Never push, deploy or publish.
- **Record your own errors as you make them** — they belong in the final report.
- **Keep `QUEUE.md` current**: strike what you closed, add what you opened.
- If the hook says **NO PROGRESS**, do not retry the same thing — change approach, pick
  another item, or park it.

When the queue runs low, re-read the project and add genuinely valuable items; never
invent busywork.

### 5. Wrap up in the last 20 minutes

When the hook switches to **WRAP UP** (or **THE QUEUE IS DRY**, or **STALLED**), do this
in order and start nothing new:

1. Commit every repo you touched. No dirty trees.
2. Write or refresh the state note (the `save-state` skill, if installed).
3. Update `QUEUE.md`.
4. Write the final message as an executive summary (`rules/00-answering.md`):

```markdown
**Progress: N%** — <what 100% means for this run's queue>

| | |
|---|---|
| **Stage** | <stage k of m> — <name> |
| **Last move** | <what was actually done> |
| **Next move** | <the single next action> |
| **Mistake** | <what went wrong, or "none found this pass"> |
```

Then a plain-English paragraph, what was done and **why each thread was opened**, and
what needs the user — every `owner: user` item and every new `BLOCKERS.md` entry, by
name.

Say plainly when all four are done. The hook will let the session stop.

## If the queue is dry

**Say so and stop. Do not invent work.** The charter lists what counts as legitimate
work when the queue empties; if none of it applies, the run is finished and saying so is
the correct output.

## Controls

| | |
|---|---|
| `/aw <hours>` | arm for that many hours |
| `node ~/.claude/autonomous/autonomous.js status` | this session: time left, turn, open items |
| `node ~/.claude/autonomous/autonomous.js status --all` | every armed run on the machine |
| `node ~/.claude/autonomous/autonomous.js off` | disarm **this session** |
| `node ~/.claude/autonomous/autonomous.js off --all` | disarm every run |
| `node ~/.claude/autonomous/autonomous.js lock` | exit 1 if any run is armed (for scripts that should defer) |
| delete `~/.claude/autonomous/runs/<session-id>.json` | also disarms that run |

The hook can never trap a session: a corrupt state file, an unparseable deadline, a
crash, the turn cap (400), the deadline-plus-15-minute ceiling, a stall, or a verifiably
empty queue all let the session stop. An **unreadable** queue is deliberately *not*
treated as dry. A dry queue does not release immediately — the first dry Stop asks for
the wrap-up, the second lets you go.
