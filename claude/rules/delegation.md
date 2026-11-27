# Delegation — subagents and independent review

## When to use subagents

| Size | The work | How |
|---|---|---|
| **Solo** | commands, lookups, one-file edits, answering a question | Just do it |
| **Squad** | a bounded task with 2–4 separable parts | `Agent` subagents in parallel, one per part |
| **Review** | a design, plan or result that would be costly if wrong | An independent reviewer agent (below) |

Collect every subagent's result before you answer. Never end a turn on "waiting for X".

## When to ask for an independent review

The discriminator: **if running the code would settle it, run the code.** Ask a reviewer only
where the failure mode is *absence* — something missing that no test would surface.

Review for: locking in an architecture or data source; a result that would redirect the
project if wrong; checking a plan for what *isn't* there (a missing cost, an unconsidered
case). Do not review routine implementation, debugging or refactors.

## Running a review — non-negotiables

1. **The reviewer never receives the author's own summary of what it did.** Point it at the
   source files and write "verify against the source, do not trust any summary" into the brief.
2. **Keep the reviewer prompt terse and ask for a verdict.** Asking for explanations and fixes
   makes reviewers reject correct work far more often.
3. **Never frame the work as probably fine.** Implying the work is clean collapses defect
   detection; implying it has bugs costs only a few false positives.
4. **Role drives output.** "Challenge this plan" produces challenges; "assess this plan"
   produces polite assessment. Choose deliberately.
5. **Advisory, never binding.** Weigh it, own the final call. A clean review is weaker
   evidence than it feels.

**Brief shape:** goal and constraints → the primary sources → "verify against those, not any
summary" → ask for **Verdict → Defects ranked, each with the quote that proves it → Direction,
one line each → Risks.** Ask for a direction, never a patch. The reviewer diagnoses; you fix.

For a big either/or decision, the `council` skill runs five differently-minded advisors, a
blind peer review and a chairman verdict.
