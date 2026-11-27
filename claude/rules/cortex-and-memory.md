# Cortex capture and the memory layers

Every conversation is captured automatically into the Obsidian vault at `<VAULT>` under
`Cortex/`. The capture hook writes plain Markdown files and does **not** need Obsidian
running. Engine: `~/.claude/cortex/cortex-sync.js`; health: `~/.claude/cortex/cortex.log`.

When I say **"save state"**, invoke the `save-state` skill.
When I say **"where did we leave off"** or `/boot`, invoke the `boot` skill.

## Memory layers — one fact, one home

Writing the same fact to more than one layer is how they drift apart.

| Layer | Path | Holds | Loaded |
|---|---|---|---|
| **Rules** | `~/.claude/rules/*.md` + `~/.claude/CLAUDE.md` | Stable, behaviour-changing instructions | Every session |
| **Auto-memory** | `~/.claude/memory/` | Facts learned mid-work, not yet promoted | Every session, **index lines only** |
| **Knowledge** | `<VAULT>/Cortex/Knowledge/` | Reference and durable research | On demand |
| **States** | `<VAULT>/Cortex/States/` | Decisions and *why*, as of a date | On demand |
| **Sessions** | `<VAULT>/Cortex/Sessions/` | Raw transcripts, verbatim | On demand |

- **Auto-memory format:** one fact per file, with frontmatter (`name`, `description`,
  `metadata.type` = user / feedback / project / reference), plus a one-line pointer in
  `~/.claude/memory/MEMORY.md`. Update an existing file rather than writing a duplicate.
- **Promotion:** a memory that turns out to be a standing rule moves into `~/.claude/rules/`
  and is **deleted** from auto-memory. It never lives in both.
- **Rules earn their place by changing behaviour at a decision point.** Inventories, version
  tables and the reasoning *behind* a rule are reference: they go to `Cortex/Knowledge/`.
  Always-loaded context is paid for on every turn of every session.
- **Never conclude "not done" from one location.** Auto-memory loads as index lines only, so
  finished work can look absent while its body sits unread. Check the other layers first.
- **States are archival.** They record what was true that day; never rewrite one to match a
  later decision. Write a new one.
- **Preferences about how I like to work** live in `<VAULT>/Cortex/Knowledge/PREFERENCES.md`.
  Read it at session start; append to it whenever I correct you.
