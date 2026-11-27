---
name: personalise
description: Personalise a fresh Cortex install — fill in ~/.claude/CLAUDE.md and the machine section of the rules by detecting what commands can tell, and asking the user only the rest. Use when the user says "personalise my Cortex setup", "personalize", "set up my profile", or types /personalise, usually right after installing Cortex.
---

# personalise — make the Cortex template theirs

1. Read `~/.claude/CLAUDE.md` and every file in `~/.claude/rules/`.
2. Detect what you can by running commands — never ask what a command can answer:
   OS and version, default shell, Node / Python / package-manager versions,
   `git config user.name` and `git config user.email`, whether `code` and `gh` exist.
3. Ask, with the AskUserQuestion tool and suggested answers, **only** what you could not
   detect — at most four questions:
   - their role and experience level (pitches every explanation);
   - what they mainly use Claude Code for;
   - preferred languages, frameworks and where their projects live;
   - how much to do without asking (the tiers in `rules/02-discretion.md` are the default).
4. Fill every `<PLACEHOLDER>` in `~/.claude/CLAUDE.md`, and the "This machine" section of
   `~/.claude/rules/environment.md`. If `~/.claude/CLAUDE.md.cortex-new` exists, merge it
   into their existing `CLAUDE.md` instead, keeping everything of theirs, then delete the
   `.cortex-new` file. Do the same for any other `*.cortex-new` file the installer left.
   Before the first edit, tell them they will see an approval prompt for each of these
   files: the safety hook asks before anything changes Claude's own rules, and that prompt
   is it working.
5. Write their working-style answers into the vault's `Cortex/Knowledge/PREFERENCES.md`
   (the vault path is `vaultPath` in `~/.claude/cortex/cortex-config.json`).
6. Delete the example memory `~/.claude/memory/example-command-style.md` and its line in
   `~/.claude/memory/MEMORY.md`.
7. Show a short summary of what changed, and say that the guardrail asked them to approve
   the edits to `CLAUDE.md` and `rules/` because those files steer Claude's behaviour.
