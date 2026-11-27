---
name: council
description: Stress-test a decision, plan, or design through 5 role-differentiated advisors + anonymous blind peer review + a chairman verdict — the antidote to Claude-as-yes-man. Use when the user types /council, or asks to "ask the council", "stress-test this", "poke holes in this", "should I do X", or brings a genuine either/or decision where a single confident answer would be untrustworthy. NOT for lookups, facts, or tasks with one correct answer.
---

# council — five advisors, blind peer review, one verdict

The problem: **Claude is a convincing yes-man.** Ask it to defend an idea and it writes a
flawless case; ask it to kill the same idea and it writes an equally flawless case. The
council forces five *different* reasoning methods to attack the question, reviews them blind
so no role wins on authority, and makes a chairman commit to one verdict that survived.

Adapted from the community "LLM Council" pattern. Runs entirely on subagents via the
`Agent` tool. It follows `delegation.md`: advisory, role-driven, and no agent ever receives
another agent's self-summary.

## When it fires

`/council <decision>`, or a plain request to stress-test a real call. Not for facts, status
questions, or anything a check settles. If there is no clear decision, ask one line:
"What's the call you're weighing?"

## Step 1 — Frame the question

Restate the decision in one or two sentences: the choice, the options, the real constraints
(skill level, time, cost, what it locks in). Gather the context the advisors need. **Keep
your own opinion out of it.**

Write two payloads: **FULL** (question + all context) and **BARE** (the question only, for
the Outsider).

## Step 2 — Five advisors, in parallel

One message, five `Agent` calls (`subagent_type: "general-purpose"`). Each gets its role and
the payload, plus: *"Apply your assigned reasoning method rigorously and show your work. You
are one voice on a council, not the decider."*

| Advisor | Method | Gets | Charge |
|---|---|---|---|
| **Contrarian** | Inversion | FULL | Assume this fails badly. Work backward to the most likely cause. Name the fatal flaw. |
| **First-Principles** | Decomposition | FULL | Break the claim into atoms and challenge each. Is this even the right problem? |
| **Expansionist** | Analogy | FULL | Find the upside and adjacent options. Where is the ambition too small? |
| **Outsider** | Naive questioning | **BARE** | No context on purpose. Ask the dumb questions; flag insider blind spots. |
| **Executor** | Dependency graphing | FULL | Ignore whether it is a good idea. Map dependencies, critical path, and the first move tomorrow. |

## Step 3 — Anonymize

Shuffle the five responses into a random A–E order and strip every trace of who wrote which.
Keep a private letter→advisor map. This stops reviewers deferring to a role's authority.

## Step 4 — Five peer reviewers, in parallel

Each gets the anonymized A–E batch (never the map) and the original question, and answers:
1. Which response is strongest, and why? Argue from reasoning, not confidence.
2. Which has the biggest blind spot?
3. What did all five miss?
4. Is any agreement real reasoning, or conformity to the framing?

## Step 5 — Chairman

One final `Agent` receives the question, the de-anonymized responses and all reviews, and:
1. **Scores 3–5 attributes separately** before forming a recommendation.
2. **States the strongest case against** the emerging consensus, then rebuts or concedes it.
3. **Commits.** Never "it depends."

Output: **Verdict** (one line) · **Why** (two or three findings) · **The clashes** (each a
*value tension* the user must own, or an *error catch*) · **Blind spots** · **Strongest
dissent** · **One next step** · **How you will know it worked**.

## Step 6 — Deliver

Relay the verdict in the Answer Block format: decision first, a few facts, one next step.
End by naming what only the user can decide (the value tensions). The council advises; the
user owns the call.

## Cost

A standard run is **11 agents** (5 advisors, 5 reviewers, 1 chairman). For a small call run
**lean**: skip step 4 and hand the advisors straight to the chairman (6 agents).
