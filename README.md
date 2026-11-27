# Cortex: a memory and safety kit for Claude Code

Cortex turns a stock Claude Code install into one that **remembers your work across
sessions, answers in a consistent format, asks before it builds the wrong thing, and refuses
a short list of dangerous commands**. Everything is plain files (Markdown and small Node.js
scripts), with no service and no account to sign up for.

> **New to Claude Code?** Claude Code is Anthropic's AI coding assistant. It runs in your
> terminal (or in the Claude desktop app) and can read files, run commands and edit code in
> the folder you start it in. You need a Claude Pro, Max, Team or Enterprise plan, or an
> Anthropic Console (API) account.

---

## What you get

| Piece | What it does for you |
|---|---|
| **Session capture** | Every conversation is saved automatically as a readable Markdown note in a folder ("the vault"). Close the terminal by accident and nothing is lost. |
| **Live state notes** | One auto-updated note per chat: the latest summary, your last few asks, the files Claude changed. |
| **`/boot`** | Start of a session: "where did we leave off?" Claude reads the notes and briefs you in about 15 lines. |
| **`save state`** | End of a session: Claude writes a curated checkpoint (done, decided, open, next) so tomorrow's session can resume cold. |
| **Rules** | Always-loaded instructions: answer with a progress table, expand vague requests before building, know what to do alone and what to ask about. |
| **Guardrail hook** | Blocks a small set of never-intended actions (wiping your home folder, `curl … \| bash`, force-push, reading SSH private keys) and asks before sending email or editing its own config. |
| **Memory surfacing** | When your prompt matches something Claude memorised earlier, the full note is put in front of it automatically. |
| **Context watch** | Warns when the conversation is getting full (50/70/85%) and when Claude repeats the same command five times in a row. |
| **More skills** | `/prompt` (turn a one-line request into a real spec), `/research` (evidence-first decision notes), `/council` (five AI advisors stress-test a decision). |

**Why bother?** Out of the box, every Claude Code session starts from zero. Cortex gives it a
memory you can read, search and edit yourself (it's just Markdown), plus habits that make it
less likely to confidently build the wrong thing.

---

## Install

### 0. Prerequisites

You need **Claude Code**, **Node.js 18+** (it runs the hooks) and **git**. Obsidian is
optional; it's just a nice way to browse the notes.

**Windows (PowerShell):**

```powershell
irm https://claude.ai/install.ps1 | iex
```

```powershell
winget install OpenJS.NodeJS.LTS
```

```powershell
winget install Git.Git
```

**macOS (Terminal):**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

```bash
brew install node git
```

(No Homebrew? Get Node from <https://nodejs.org> and run `xcode-select --install` for git.)

**Linux (Ubuntu/Debian shown):**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

```bash
sudo apt install nodejs npm git
```

(If your distro's Node is older than 18, install a current one with
[nvm](https://github.com/nvm-sh/nvm) or from <https://nodejs.org>.)

Then **open a new terminal** and check all three work:

```bash
claude --version
node --version
git --version
```

Run `claude` once and log in through the browser before going on.

### 1. Get this repo

Use the GitHub link you were given (replace `<OWNER>`):

```bash
git clone https://github.com/<OWNER>/cortex-template.git
cd cortex-template
```

### 2. Run the installer

Pick where your notes ("the vault") should live. The default is a folder called
`Cortex-Vault` in your home directory. An existing Obsidian vault works too.

```bash
node install.mjs
```

Or, with your own vault location:

```bash
node install.mjs --vault "~/Documents/MyVault"
```

Want to see what it would do first? Add `--dry-run`. It changes nothing.

**What the installer does, and doesn't do:**

- Copies rules, skills, hooks and the capture engine into `~/.claude/`.
- Creates the vault folders (`Cortex/Sessions`, `Cortex/States`, `Cortex/Knowledge`).
- **Merges** six hook entries into `~/.claude/settings.json` after backing it up. It never
  replaces your existing settings or hooks.
- **Never overwrites** a file you already have. If you already have a `~/.claude/CLAUDE.md`,
  the template is saved next to it as `CLAUDE.md.cortex-new` for you to merge.
- Records everything it created in `~/.claude/cortex/install-manifest.json`, so
  `uninstall.mjs` can undo exactly that.

### 3. Personalise (2 minutes, done by Claude)

**Restart Claude Code** (rules and hooks only load at startup), then paste this:

```text
I just installed the Cortex template (rules in ~/.claude/rules, skills in
~/.claude/skills, hooks in ~/.claude/hooks, capture engine in ~/.claude/cortex).
Please personalise it for me:

1. Read ~/.claude/CLAUDE.md and every file in ~/.claude/rules/.
2. Work out what you can about my machine by running commands (OS, shell, Node and
   Python versions, package managers, `git config user.name` and `user.email`).
   Don't ask me anything a command can answer.
3. Ask me, using the AskUserQuestion tool with suggested answers, only what you
   couldn't detect: my role and experience level, what I mainly use Claude Code for,
   my preferred languages and tools, and how much you should do without asking.
4. Fill in every <PLACEHOLDER> in ~/.claude/CLAUDE.md, and the "This machine"
   section of ~/.claude/rules/environment.md. If a CLAUDE.md.cortex-new file exists,
   merge it with my existing CLAUDE.md instead, keeping everything of mine.
5. Add my answers about working style to the vault's Cortex/Knowledge/PREFERENCES.md
   (the vault path is in ~/.claude/cortex/cortex-config.json).
6. Delete the example memory (~/.claude/memory/example-command-style.md) and its line
   in ~/.claude/memory/MEMORY.md.
7. Show me a short summary of what you changed.
```

The guardrail will ask you to approve edits to `CLAUDE.md` and `rules/`. That's expected:
those files control Claude's behaviour, so changing them always needs your click.

### 4. Check it works

1. In Claude Code, say `hi`, wait for the reply, then look in
   `<your vault>/Cortex/Sessions/`. There should be a new note with today's date.
2. Type `/boot`. On a fresh install it will say there are no previous sessions yet.
3. Test the guardrail with something harmless. Ask Claude:
   `in a new empty folder, run git init and then git push --force origin main`.
   It should be stopped with `Blocked by guardrail rule "force-push"`. (Even if the
   hook were not loaded, this would just fail, because the folder has no remote.)

Optional, for the curious: `node test/smoke.mjs` runs an end-to-end test in a throwaway
folder (your real setup is untouched). It should print `49 passed, 0 failed`.

---

## Paste-this-to-Claude: one-shot setup

Prefer to let Claude do the whole thing? Install the prerequisites (step 0), start `claude`
in any folder, and paste:

```text
Set up the Cortex template for me from https://github.com/<OWNER>/cortex-template.

1. Clone it into a folder called cortex-template inside my home directory (use
   `gh repo clone` if the repo is private and gh is logged in; otherwise git clone).
2. Read README.md, install.mjs and uninstall.mjs before running anything, and tell me
   in two lines what the installer will change.
3. Ask me where I want my notes vault (suggest ~/Cortex-Vault), then run
   `node install.mjs --dry-run --vault "<my answer>"` and show me the result.
4. When I say yes, run it for real, then run `node test/smoke.mjs` and show the result.
5. Tell me to restart Claude Code, and give me the "Personalise" prompt from the README
   to paste after the restart.
```

---

## Which files go where

```text
cortex-template/                 (this repo: keep it, it's how you update or uninstall)
├── install.mjs / uninstall.mjs
├── claude/            ──copied to──►  ~/.claude/
│   ├── CLAUDE.md                       your machine-wide facts (personalise this)
│   ├── rules/*.md                      always-loaded instructions
│   ├── skills/<name>/SKILL.md          /boot, /save-state, /prompt, /research, /council
│   ├── hooks/*.js                      guardrail, memory surfacing, context watch, post-compact
│   ├── cortex/cortex-sync.js           the capture engine
│   └── memory/                         auto-memory folder (seeded with one example)
├── vault/Cortex/      ──copied to──►  <your vault>/Cortex/
│   ├── Cortex.md                       hub note explaining the folders
│   ├── Sessions/                       one note per conversation (automatic)
│   ├── States/                         curated checkpoints (save state)
│   │   └── Live/                       one auto-updated note per chat
│   └── Knowledge/
│       ├── PREFERENCES.md              how you like to work; Claude appends corrections
│       ├── research/                   /research decision notes
│       └── templates/executive-summary.html
└── test/smoke.mjs                      end-to-end test (throwaway folder)
```

`~` means your home folder: `C:\Users\<you>` on Windows, `/Users/<you>` on macOS,
`/home/<you>` on Linux.

Created at runtime in `~/.claude/cortex/`: `cortex-config.json` (holds the vault path),
`cortex.log` (capture health), `checkpoints/`, `sessions-index.json`, and `state/` (hook
state plus `guardrail-blocked.log`, an audit trail of every block).

---

## How it fits together: the memory layers

Claude Code forgets everything between sessions. Cortex gives it five places to remember
things, each with one job, so the same fact never lives in two places and drifts:

| Layer | Where | Holds | Loaded |
|---|---|---|---|
| **Rules** | `~/.claude/rules/`, `~/.claude/CLAUDE.md` | Stable instructions that change behaviour | Every session |
| **Auto-memory** | `~/.claude/memory/` | Facts Claude learns mid-work | Every session (one-line index only) |
| **Knowledge** | `vault/Cortex/Knowledge/` | Reference, research, your preferences | When needed |
| **States** | `vault/Cortex/States/` | Checkpoints: what was decided and why | When needed |
| **Sessions** | `vault/Cortex/Sessions/` | Full transcripts | When needed |

The flow over time: a correction you give lands in `PREFERENCES.md` or a memory file; once
it has come up three times, it gets **promoted** to a rule (and deleted from the old place).
Keep the always-loaded layer small, because you pay for it in tokens on every single turn.

---

## What each piece does

### Rules (`~/.claude/rules/`)

| File | In one line |
|---|---|
| `00-answering.md` | Big answers open with a **Progress %** table (Stage, Last move, Next move, Mistake), then plain English, then a short executive summary. Questions to you come as a one-word-answerable **Ask Block**. |
| `01-receiving.md` | A short request is not a small one: before choosing a stack or scope you never named, Claude asks 3–5 questions, shows you the full spec, *then* builds. |
| `02-discretion.md` | Four tiers: act alone (edits, local commits) → act then tell you, with the undo → ask first (push, spend, delete your stuff) → never (move money, handle passwords). Plus "finish the job, don't stop at good enough". |
| `cortex-and-memory.md` | The memory layers above, and the triggers for `save state` and `/boot`. |
| `delegation.md` | When to use subagents, and how to run an independent review without biasing the reviewer. |
| `environment.md` | Machine hazards that each cost someone a session (JSON byte-order marks, shell quoting traps). Has a section for your own machine. |
| `tooling.md` | Which tool to reach for (docs lookup, web access, security scanners). Edit to match what you have installed. |

### Skills (`~/.claude/skills/`)

Type `/name` in Claude Code, or just ask in plain words: each skill says in its description
when it applies.

| Skill | Use it when |
|---|---|
| `/boot` | Starting a session: "where did we leave off?" |
| `/save-state` | Ending a session, or before something risky: "save state". |
| `/prompt` | You have a vague idea ("make a habit tracker") and want a real spec first. |
| `/research` | Choosing a library, tool or architecture you'd have to defend later. |
| `/council` | A real either/or decision where you don't trust a single confident answer. Uses 6–11 subagents, so it costs more. |

### Hooks (`~/.claude/hooks/` and `~/.claude/cortex/`)

Hooks are scripts Claude Code runs automatically at certain moments. They're registered in
`~/.claude/settings.json` under `"hooks"`.

| Hook | When it runs | What it does |
|---|---|---|
| `cortex-sync.js` | after every reply (`Stop`) and at exit (`SessionEnd`) | Appends the new part of the conversation to the session note; updates the live note. Only reads what's new, so it takes about 100 ms. |
| `guardrail.js` | before every tool call (`PreToolUse`) | **Deny:** wiping drive/home/system folders, disk formatting, `curl … \| bash`, force-push, skipping git hooks, reading private keys, deleting a repo or moving money via an MCP tool. **Ask:** sending email or calendar changes, pushing via MCP, editing settings/rules/CLAUDE.md, firewall/SSH changes. Silent on everything else. |
| `memory-surface.js` | when you send a prompt (`UserPromptSubmit`) | If your prompt matches a memory's name, description or `triggers:`, the memory body is injected so Claude actually uses it. |
| `context-watch.js` | after every tool call (`PostToolUse`) | Warns at 50/70/85% of the context window, and on 5 identical tool calls in a row. |
| `post-compact.js` | after the conversation is compacted (`SessionStart`, `compact`) | Lists the files this session already changed, so Claude doesn't redo finished work. |

Every hook is written to **never break your session**: on any error it exits quietly.

---

## Personalising further

- **Your facts** → `~/.claude/CLAUDE.md`. Keep it short; only things that change what Claude
  does.
- **Your preferences** → just correct Claude when it does something you dislike, and tell
  it to note it in `PREFERENCES.md`. After three confirmations, ask it to promote the entry
  to a rule.
- **Don't like the progress table?** Edit or delete `~/.claude/rules/00-answering.md`. Every
  rule is optional; delete any file you disagree with.
- **Memories** → Claude writes them itself in `~/.claude/memory/`. Add `triggers: [word, word]`
  to a memory's frontmatter to make it surface reliably when those words appear.
- **Guardrail rules** → edit `~/.claude/hooks/guardrail.js`. Each rule is an
  `{ id, why, test }` object; add `decision: "ask"` to make it a prompt rather than a block.
  Re-run `node test/smoke.mjs` from the repo afterwards.
- **Several computers sharing one vault** (Syncthing, iCloud…)? Set `"indexHost"` in
  `~/.claude/cortex/cortex-config.json` to one machine's hostname so only that machine
  rebuilds the shared index.
- **Fewer permission prompts?** Claude Code can run without approval prompts
  (`"permissions": { "defaultMode": "bypassPermissions" }` in settings). Only do this once
  you trust your setup: the guardrail then becomes your main safety net, and it is
  deliberately narrow.

## Updating

Pull the repo and run the installer again. Unchanged files are skipped; files you've edited
get a `.cortex-new` copy beside them to merge by hand.

```bash
git pull
node install.mjs
```

## Uninstall

From the repo folder:

```bash
node uninstall.mjs
```

This removes only the Cortex hook entries from `settings.json` (after a backup), and **moves**
every file the installer created into `~/.claude-cortex-removed-<date>/`, so nothing you
edited is lost. Delete that folder once you're sure. Restart Claude Code afterwards.

**Your vault is never touched.** Delete it by hand if you want the notes gone. Add
`--dry-run` to preview.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No session notes appear | Restart Claude Code (hooks load at startup). Then check the end of `~/.claude/cortex/cortex.log`. "no vaultPath" means `cortex-config.json` is missing; re-run the installer. |
| `node: command not found` in hook errors | Node isn't on the PATH that Claude Code sees. Install Node, then restart your terminal **and** Claude Code. |
| Something got blocked and you meant it | The message names the rule. Run the command yourself in a terminal, or edit `guardrail.js`. Every block is logged in `~/.claude/cortex/state/guardrail-blocked.log`. |
| `settings.json is not valid JSON` | The installer refuses to touch a broken file. Fix it (or restore a `.bak-*` copy), then re-run. |
| Something changed but Claude doesn't notice | Claude Code reads its environment at startup. Restart it before assuming it's broken. |

## Privacy

Session notes contain **everything you type to Claude**, including anything sensitive you
paste. Keep your vault out of public repositories and shared folders. This template repo
contains no personal data; your vault and `~/.claude/` will.

## Credits

Built and battle-tested on a daily-driver setup, then generalised for sharing. Ideas
borrowed with thanks from the Claude Code community (the "LLM Council" pattern and the
"everything-claude-code" hooks). MIT licensed.
