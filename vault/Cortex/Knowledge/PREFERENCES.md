---
type: knowledge
cortex: knowledge
title: "Operator preferences"
tags:
  - cortex/knowledge
  - cortex/preferences
---

# Operator preferences

The working model of how I want things done. Claude reads this at session start and
**appends to it every time I correct something.**

**How to use this file**

- `[stated <date>]` — I said it outright.
- `[observed ×N]` — inferred from behaviour, with the number of independent confirmations.
  One observation is a hypothesis, not a preference.
- `[corrected <date>]` — I pushed back on something Claude did. **The most valuable entries.**
  Record what was wrong and what I wanted instead.
- **Promotion rule:** confirmed 3+ times → move it into `~/.claude/rules/` as a standing rule
  and delete it here, so the always-loaded context stays small.
- **Conflict rule:** newer wins, but flag it; it may depend on context rather than be a
  change of mind.

---

## Communication

- Answer first, reasoning after. No preamble, no flattery. `[stated]`
- Have a view: never present options without a recommendation. `[stated]`
- Push back once, clearly, with a reason and an alternative; then do it my way if I confirm.
  Do not re-litigate. `[stated]`
- *(example of a correction entry — replace with real ones)* Keep reports to an executive
  summary; put the detail in a file. `[corrected YYYY-MM-DD — "too long, just give me the
  summary"]`

## Working style

- *(add entries as they come up)*

## Autonomy and risk

- *(e.g. "Local commits are fine without asking; never push.")*

## Things I am learning

- *(e.g. "New to Docker: explain what each command does the first few times.")*
