# How to answer — the Answer Block

**Priority: highest. This file overrides other formatting instructions**, including
`~/.claude/CLAUDE.md`, other rules files, and skills.

The failure this exists to kill: **describing state without ever saying how far along it
is.** A wall of accurate facts that never answers "are we nearly there?" is a bad answer,
however well sourced. I should never have to ask "but what's the progress?"

---

## Open every substantive answer with this block

```markdown
**Progress: N%** — <one line saying what the number is measuring>

| | |
|---|---|
| **Stage** | <stage k of m> — <name of the stage> |
| **Last move** | <what was actually done, and the date> |
| **Next move** | <the single next action — one thing, not a list> |
| **Mistake** | <what went wrong, or "none found this pass"> |
```

Then, always:

1. **In plain English** — a short paragraph, no jargon, every acronym expanded, written
   for a smart person who is not inside the project. It explains **why it matters**, not
   what the table already said. Never optional.
2. **An executive summary, not the evidence.** The decision, and the two or three facts
   that force it. Do the deep work; do not paste it. Logs, long tables and command output
   go to a file, the vault, or a follow-up I ask for.
   Rule of thumb: **if it is longer than a screen, the summary is the answer and the rest
   is an attachment.**
3. **Options** — only when a decision is genuinely mine. Mark the recommended one, and say
   why the others lost. A bare menu is a failure.

## Rules for the percentage

- **Derive it, never invent it.** It comes from a visible ledger of parts marked
  done / partial / not started. Show the ledger the first time, and whenever it moves.
- **Split "built" from "operating" when they differ.** Code that exists but has never run
  for real is not 90% done. Say `70% built / 0% operating`; that gap is usually the most
  important fact on the page.
- **Never write "in progress" without a number.** If a number is genuinely impossible, say
  why in one line and give a stage instead.
- **Percentages are of the stated scope.** Say what 100% means.
- Round to 5%. `63.4%` implies a measurement that does not exist.

## Rules for the Mistake row

- **Never omit it.** If nothing went wrong, write "none found this pass".
- It covers **Claude's** errors too: a wrong claim, a skipped check, a stale note. Silent
  self-correction reads as a clean run and destroys the value of the row.

## When asking ME for something — the Ask Block

Any time I am the one who has to decide or act:

```markdown
**Ask: <the decision in one line>**

| | |
|---|---|
| **What** | the decision, phrased so it can be answered in one word |
| **Why** | why it needs me — what could not be resolved without me |
| **Where** | the file, repo, system or account it touches |
| **When** | what is blocked until I answer, and any real deadline |
| **Who** | who or what else is affected (other people, money) |
| **How** | the options, **with the recommended one marked** |
```

- **Answerable in one word.** If "yes" or "option b" cannot resolve it, it is not finished
  being thought about.
- **Say what happens if I do nothing.** Often that is the real decision.
- **One ask at a time.**

## Scope

- **Applies to:** status, analysis, research, design decisions, post-mortems, "where are
  we" questions.
- **Skip it for:** one-line confirmations ("done, committed"), quick factual lookups,
  mid-task narration. No progress table on "yes, the file exists".
- Always **answer-first**. No preamble, no flattery, no restating the question.

## Optional: web-style summaries

For a big answer (research, a plan, an audit), fill the template at
`<VAULT>/Cortex/Knowledge/templates/executive-summary.html` and open it in a browser (or
publish it as an Artifact if your Claude app supports that). It has slots for the Answer
Block, a glossary that defines every domain term, a causal chain, and a chart.
