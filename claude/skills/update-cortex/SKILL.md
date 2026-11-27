---
name: update-cortex
description: Update the Cortex template (rules, skills, hooks, VS Code Sidekick, tools) to the newest version on GitHub — review what changed, pull, re-install, test. Use when the session starts with "CORTEX UPDATE AVAILABLE" and the user says yes, or when they say "update cortex", "get the latest cortex", "is there a cortex update", or type /update-cortex.
---

# update-cortex — bring Cortex up to date, safely

The repo folder is `repoDir` in `~/.claude/cortex/install-manifest.json`. Run every git
command there.

1. **Check the folder is clean.** Run `git status --porcelain`. If the user changed files
   in the clone, stop and show them which files changed. Ask whether to keep their changes
   (`git stash`, then restore them after the update) or discard them. Never discard on your own.
2. **Show what is coming.** Run `git fetch`, then `git log --oneline HEAD..@{u}` and
   `git diff --stat HEAD..@{u}`. Summarise it for the user in at most five plain lines.
3. **Read the code that will run.** Read the full diff of everything that executes:
   `install.mjs`, `uninstall.mjs`, `claude/hooks/`, `claude/cortex/`, `claude/autonomous/`
   and `tools/`. These run on their machine with their permissions. Flag anything that sends
   data off the machine, deletes files outside `~/.claude`, or weakens the guardrail. If you
   find any of that, stop and tell the user before going further.
4. **Pull and install.**
   - `git pull --ff-only`
   - `node install.mjs --dry-run`, then summarise it, especially any CONFLICT lines.
   - `node install.mjs --no-open`
5. **Merge conflicts the user's way.** For every `*.cortex-new` file the installer left,
   merge the template's changes into the user's own version. Keep everything of theirs, and
   take new rules or fixes from the template. Then delete the `.cortex-new` file.
6. **Prove it works.** Run `node test/smoke.mjs`; it must end with `0 failed`. If anything
   fails, fix it before reporting.
7. **Hand over** in two or three lines: what changed, and that Claude Code needs a restart
   (and VS Code a **Reload Window**) for new hooks, rules and tools to load.
