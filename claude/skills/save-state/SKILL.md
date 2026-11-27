---
name: save-state
description: Capture the current conversation into the Cortex Obsidian vault and write a curated state snapshot — what was done, what was decided, what is still open, and what comes next. Use when the user says "save state", "save our state", "checkpoint this", or invokes /save-state. Also use before a long-running or risky operation where losing context would be costly.
---

# save state

Raw transcript capture already happens automatically (the `Stop` hook runs
`~/.claude/cortex/cortex-sync.js` after every turn). This skill adds the **curated layer**:
the judgement a future session needs and a transcript skim will not give it.

## 1. Force a sync

Make sure the raw session note is current before writing anything that links to it.

- Find this session's transcript: the most recently modified `.jsonl` under
  `~/.claude/projects/` (the subfolder name is derived from the folder the session started
  in). Its filename, minus `.jsonl`, is the session id.
- Build the payload with Node, never shell string interpolation:

```bash
SID="<session id>"
TP="$HOME/.claude/projects/<project folder>/$SID.jsonl"
node -e 'console.log(JSON.stringify({session_id:process.argv[1],transcript_path:process.argv[2],hook_event_name:"SaveState"}))' "$SID" "$TP" \
  | node "$HOME/.claude/cortex/cortex-sync.js"
```

Then read `~/.claude/cortex/sessions-index.json` to get the session note's exact filename,
for the backlink in step 2.

## 2. Write the state note

Path: `<VAULT>/Cortex/States/<yyyy-MM-dd HHmm> — <topic>.md`

```markdown
---
type: state
cortex: state
date: <yyyy-MM-dd>
session: "<session note filename, no extension>"
tags:
  - cortex/state
---

# <topic>

## Done
- Concrete, verifiable outcomes. Versions, paths, exact names.

## Decisions
- What was chosen, and **why**. The reasoning is the part that does not survive a skim.

## Open
- Unresolved threads, known breakage, things deliberately deferred.

## Next
- The specific next action, written so a fresh session could pick it up cold.

## Links
[[<session note filename>]] · [[Cortex]]
```

## 3. Quality bar

Write for **a future session with no memory of this one.**

- Concrete: "Installed Node 22.11.0, replacing 18.x" beats "updated Node".
- Record **why**, not just what. A decision without its reasoning gets re-litigated.
- Real paths, real versions, real commands.
- State blockers honestly, including what failed or was abandoned.
- Bullets, not paragraphs. Aim for under 60 lines.
- Do not restate the conversation; the session note already has it verbatim.

## 4. Confirm

Say where the note was written and give a one-line summary. If the sync in step 1 failed,
say so plainly (check `~/.claude/cortex/cortex.log` for the reason) instead of reporting
success.
