---
type: hub
cortex: hub
tags:
  - cortex/hub
---

# Cortex

Persistent memory for Claude Code. Every conversation is captured to disk automatically;
curated snapshots and distilled knowledge are written on demand.

## Map

| Folder | What lives here | Written by |
| --- | --- | --- |
| [[Sessions Index\|Sessions]] | Full transcript of every conversation, one note per session | Automatic (Stop hook) |
| `States/` | Curated snapshots: what was decided, what is open, what is next | `save state` |
| `States/Live/` | One auto-updated note per chat: latest recap, recent asks, files written | Automatic (every turn) |
| `Knowledge/` | Durable notes: preferences, research, reference | You or Claude, deliberately |

## How capture works

A Claude Code **`Stop` hook** runs `~/.claude/cortex/cortex-sync.js` at the end of every
assistant turn and appends the new part of the conversation to a note in `Sessions/`. A
**`SessionEnd`** hook does a final pass when the session closes.

So capture does **not** depend on remembering to ask for it:

- Lost connection → everything up to the last completed turn is already on disk.
- Closed the terminal by accident → same.
- Forgot to say "save state" → the raw transcript is still there.

`save state` is an *enrichment* step (judgement, decisions, next steps), not the safety net.

The engine writes plain Markdown files and **never needs Obsidian running**. Obsidian is
just a nice way to read and search them.

## What is not captured

Thinking blocks, tool results and images are dropped; subagent traffic is skipped. Tool
calls appear as a collapsed "Tools used" list under each Claude turn.

## Privacy

These notes contain **everything you typed to Claude**, including anything sensitive you
pasted. Keep this vault out of public repos and shared drives.
