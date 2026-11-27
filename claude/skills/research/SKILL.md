---
name: research
description: Evidence-first research pass before a non-trivial technical decision. Finds what practitioners actually do, what they regret, and where they disagree, then writes a durable decision note. Use before choosing a library, tool, architecture, or config approach — or when the user says "research this", "what's the best way to", or asks for a recommendation you would have to defend later.
---

# research

Default assumption: **someone has already solved this and already hit the potholes.** Find
them before writing a line of code.

Trigger threshold: anything you would have to defend later. Skip it for questions with one
obvious answer; a research note for a settled question is theatre.

## 1. Check for prior work first

Read `<VAULT>/Cortex/Knowledge/research/` before searching. Never redo an existing pass; if
one exists and is still valid, cite it. If it is stale, update it instead of writing a second.

## 2. Source priority

1. **Official docs for the exact version in play.** Ground truth for syntax, flags and paths,
   and only that. Docs describe intent, not experience.
2. **Practitioners, weighted highest for judgement.** GitHub issues and discussions on the
   actual repo, Hacker News comments, practitioner blogs, forums, the subreddit where the
   tool actually lives.
3. **Your own priors, last**, and only as a hypothesis to verify.

When a source cannot be read, say so. Never paraphrase a search snippet as if the page had
been read.

## 3. Rules

- **Read the comments.** Top-level posts sell; comments disclose.
- **Two independent sources** before calling anything a best practice.
- **Recency.** For fast-moving tooling prefer under 6 months old; flag older material.
- **Hunt the anti-patterns.** Every pass must answer "what do people regret doing?"
- **Record dissent.** If the community is split, say so and pick a side with a reason.
- **Fit over popularity.** State why the choice fits *this* user and machine, or reject it.
- **Timebox.** About 15 minutes for a normal decision, 45 for an architectural one. Still
  unsure after that? Ask the user.

## 4. Write the note

`<VAULT>/Cortex/Knowledge/research/NNN-<topic>.md`:

```markdown
---
type: research
cortex: research
date: YYYY-MM-DD
tags: [cortex/research]
---

# <topic>

**Question**       <the actual decision being made>
**Sources**        <URL — date — what it is>   (at least 3, at least 1 practitioner)
**Consensus**      <what practitioners actually do>
**Dissent**        <the credible minority view>
**Anti-patterns**  <what people say they regret>
**Decision**       <what we are doing>
**Rationale**      <why, tied to this user and machine>
**Confidence**     high / med / low
**Revisit when**   <the condition that would change this>
```

## 5. Report

Lead with the decision and the single strongest reason. Offer the note for detail; do not
narrate the search. If the finding contradicts something in `CLAUDE.md` or a state note, say
so explicitly.
