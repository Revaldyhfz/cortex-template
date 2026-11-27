---
name: studio
description: Run a project-sized task as a multi-agent "studio" — research tracks, a director, teams of single-responsibility agents with leads, independent reviewers, and a program lead who writes the master plan and the decisions left to the user. Use for builds, redesigns, research that decides weeks of work, audits and plans (see rules/03-studio.md), or when the user says "studio", "the professional way", "like a company", "one agent per thing".
---

# studio — how to run work as an agent studio

`~/.claude/rules/03-studio.md` says *when*. This file says *how*.

**Engine.** If a `Workflow` tool is available in this session, write the studio as a workflow
script (load the `workflow-authoring` skill first if it exists). Otherwise run the same phases
by hand with the `Agent` tool: launch each phase's agents **in one message** so they run in
parallel, wait for all of them, then start the next phase. The shape below is identical either way.

---

## 1. Before any agent: scout yourself, then design the org

- **Find the work list yourself first.** List the files, read the current state, read the
  repo's own `package.json` / `pyproject.toml`. Agents need concrete inputs, not guesses.
- **Write one CONTEXT block** every agent receives:
  - the goal in the user's own words (quoted);
  - the real paths and versions;
  - the machine facts that matter (OS, shell, package manager);
  - the hard rules for this run, e.g. "paperwork only: no source edits, no installs, no pushes".
- **Design the org as a table before launching:** team → lead → members, where each member owns
  **one thing** and writes **one file at an exact path** (e.g. `docs/plan/api/auth.md`).
- **Show the user the org in one screen and start.** They want to see it, not approve it,
  unless the scope itself is in doubt.

## 2. The phases

| # | Phase | Agents |
|---|---|---|
| 1 | **Research & direction** | 3–6 research tracks in parallel, plus a **director** who fixes the canonical decisions and returns them as a list (e.g. the component list) |
| 2 | **Specs / build** | one agent per thing, grouped in teams; each team ends with a **lead** |
| 3 | **Review** | 3–5 **independent reviewers**, one lens each |
| 4 | **Master plan** | a **program lead** integrates everything |

**Model choice.** Use the strongest available model for the director, leads, reviewers and
program lead (design and finding what is *missing*). Specialists can use the default model.

### Phase 2 specifics
- **Generate members from the director's output** — one agent per item in its list.
- **Stage teams whose specs must agree:** standards first → one owner per item reading those
  standards → lead. Otherwise teams run in parallel with each other.
- **Every agent writes its deliverable to a file** and returns only
  `{file, summary (≤80 words), open_questions[]}`. The files are the product; short returns keep
  your context small.

### Phase 3 specifics — reviewers
- Give reviewers **the file list, never a summary**. Write "verify against the files, do not
  trust any summary" into every brief.
- Their role is to **challenge**, not assess: a terse verdict, then defects ranked
  blocker / major / minor, each with a quote that proves it. A direction per defect, **never a patch**.
- Never frame the work as probably fine — that framing measurably hides real defects.
- Always include one **completeness** lens (what is missing?) plus one lens per critical team.

### Phase 4 specifics — the program lead writes
- the org chart (every agent and the one thing it owned);
- a **resolution log**: every blocker and major defect, resolved or rejected with a reason. Drop none;
- milestones with exit criteria, and a risk register;
- the tools or installs that need the user's approval;
- **at most 8 decisions for the user**, each answerable in one word, with a recommended default
  and what happens if they do nothing;
- a one-screen executive summary file, which you relay in the `00-answering.md` format.

## 3. Operating the run

- **Long runs are background runs.** Run `save-state` first if context is above ~60%.
- **Big studios can hit plan usage limits.** Warn the user up front. Agents that finished keep
  their files; agents killed mid-flight keep nothing. Use high effort only where it matters, and
  do not start the heaviest late stages (leads, reviewers, program lead) when the limit is near.
- **Do not shrink the org to save tokens silently.** If you cap it, say what was left out —
  a silent cap reads as full coverage.
- **Verify before relaying.** Read the master plan against the reviews yourself. Where the
  resolution log is thin, say so in the Mistake row.

## 4. Anti-patterns

- A "studio" of five generalists. That is a Squad in costume; one owner per thing is the point.
- Specialists writing before the standards they must agree on exist.
- Reviewers who see authors' summaries, or who are asked to "assess" instead of challenge.
- A master plan that ends in a menu with no recommendation, or with more than 8 decisions.
- Building before the paperwork on a big project. Paperwork is the first run; building is the next.
