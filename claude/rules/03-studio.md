# Studio mode — run big work as a team of agents

**Default is Solo.** Subagents and studio runs multiply usage, so they are opt-in:
- **Squad**: allowed when a task clearly has separable parts that would each take many
  steps. Say so in one line before starting.
- **Studio**: only when I say "studio", or say "COOK" on something project-sized.

## Pick the tier by the work, not by habit

| Tier | The work | How |
|---|---|---|
| **Solo** | commands, lookups, confirmations, one-file edits, answering a question | Just do it. No agents. |
| **Squad** | a bounded task with 2–4 separable parts | `Agent` subagents in parallel, one per part |
| **Studio** | anything I would call a *project*: a build, a redesign, research that decides weeks of work, an audit, a plan | **The `studio` skill** |

Unsure between Solo and Squad → choose Solo. Unsure whether I want a studio run → ask in one line.

## The studio shape — the parts that matter

1. **Research first**: evidence-first tracks, including tools, libraries, prior art and licences.
2. **A director fixes the canonical decisions** (scope, architecture, the feature list) before
   specialists start.
3. **One agent owns exactly one thing** and writes one file.
4. **Standards before specs** wherever specs must agree with each other (naming, style, interfaces).
5. **A lead per team** reads every member's file, resolves contradictions, writes the team README.
6. **Independent reviewers, one lens each.** They get the files, never an author's summary
   (`delegation.md`).
7. **A program lead** writes the master plan: every review defect resolved or rejected with a
   reason, milestones, risks, and **at most 8 one-word decisions** for me.
8. **Paperwork before building** on anything big. The build is its own run, one agent per component.

## Delivery

The run ends with an executive summary in the `00-answering.md` format. Deliverables are files
in the project, never only chat. Outward actions stay mine (`02-discretion.md` tiers 3–4): no
push, deploy, purchase or sign-up happens inside a studio run.

The method lives in the `studio` skill. Load it before starting one.
