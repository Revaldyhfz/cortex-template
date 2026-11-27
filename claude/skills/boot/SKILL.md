---
name: boot
description: Session-start continuity briefing. Reports where the last session left off, what is still open, and what changed on disk since. Use when the user asks "where did we leave off", "what were we doing", "catch me up", or invokes /boot at the start of a session.
---

# boot

Answer one question: **where are we, and what is pending?** Short. The user is orienting,
not reading a report.

## 1. Read the most recent state note

The newest file in `<VAULT>/Cortex/States/` (by modification time, ignoring the `Live/`
subfolder). Its **Open** and **Next** sections are the spine of the briefing.

## 2. Read every live note newer than it

The capture hook writes `<VAULT>/Cortex/States/Live/<session>.md` on **every turn of every
chat**: the latest wrap-up recap, what is waiting on the user, their last five asks, and the
files written. So a chat nobody ran save-state on is still visible here.

```bash
cd "<VAULT>/Cortex/States/Live" && \
  grep -L 'boot-only: true' *.md | while IFS= read -r f; do
    echo "$(grep -m1 '^updated:' "$f" | cut -d' ' -f2)  $f"; done | sort -r | head -8
```

- Read each one whose `updated:` is newer than the state note. Skip `boot-only: true`
  (earlier boots, which carry nothing) and **this** session's own note.
- **One thread per live note.** Several chats may have run in parallel; brief each
  separately. Never merge two chats into one story.
- A live note outranks the hand-written state note on anything **newer**; the hand-written
  note outranks it on reasoning and decisions.

## 3. Check what actually changed since

Do not trust a note: it records what was true when written. Verify the claims that matter
before repeating them:

- In the project the note is about: `git status --short` and `git log --oneline -5`.
- Is capture healthy? Look at the last lines of `~/.claude/cortex/cortex.log`.
- If the note lists a blocker, test whether it still blocks.

## 4. Cross-check open items against all memory layers

**One location is not a verification.** Before calling anything unstarted, search
`~/.claude/rules/`, `~/.claude/memory/` and `<VAULT>/Cortex/Knowledge/` for it. Auto-memory
loads as index lines only, so finished work can look absent from context alone.

## 5. Load preferences

Read `<VAULT>/Cortex/Knowledge/PREFERENCES.md`.

## 6. Brief

Open with the Answer Block from `00-answering.md` (Progress, Stage, Last move, Next move,
Mistake), then, answer-first, and **stop**:

- **Where we left off** — one or two sentences.
- **Still open** — only genuinely open items, each with its verified state:
  *not started* · *done but uncommitted* · *blocked on you* · *done*. Never collapse to a
  binary.
- **Suggested next** — one recommendation, not a menu.

Then wait. Do not start work. Keep these three sections to about 15 lines.

## Rules

- **Verify before reporting.** Anything repeated from a note without checking is a guess
  wearing a citation.
- If the newest session note is newer than the last state note, say so: work happened that
  was never checkpointed.
- If nothing is open, say so plainly rather than inventing continuity.
- First run with an empty vault: say "No previous sessions captured yet" and suggest
  running `save state` at the end of today's work.
