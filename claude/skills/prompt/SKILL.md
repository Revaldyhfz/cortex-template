---
name: prompt
description: Re-engineer a terse or underspecified request into a full specification before acting on it. Use when the user gives a short build/create/design request that names an outcome but not a stack, a scope, or a definition of done — "make X", "build me a Y", "I want a Z" — or when they type /prompt.
---

# prompt — expand before you build

**A short request is not a small request.** "make a habit tracker" names an outcome and
specifies nothing else. Acting on it raw means inventing the specification silently, then
building against it, and being wrong in a direction the user cannot see until the code exists.

Think of it as writing the prompt another AI would need to do this well.

## The move that makes this work

**Expansion is not inflation. It is specification plus narrowing.** "A habit tracker" is
infinite. A good expansion picks **one vertical slice**: the skeleton, plus one or two
trivial features that prove the wiring works end to end. So the expanded prompt is usually
**narrower in scope and wider in detail** than the raw one.

## When it fires

**Fires on:** build / create / design / implement / research requests that leave the stack,
the scope boundary or the done-condition open.

**The tell:** you are about to pick a framework, a file layout, a data model or a scope
boundary the user never named.

**Does not fire on:** commands, lookups, confirmations, corrections, status questions, or a
request that already carries its own spec. Fire on what they just asked for, not a project
they mentioned earlier and moved past.

## The eight slots

Check all eight. Drop a slot only if there is genuinely nothing to say.

| # | Slot | What it buys | Example (habit tracker) |
|---|---|---|---|
| 1 | **Role** | Register and assumed depth | "senior full-stack developer who teaches as they go" |
| 2 | **Stack + version** | Kills the biggest source of wrong output | "Next.js 15, TypeScript, SQLite via Drizzle" |
| 3 | **Scope verb** | Bounds the slice — the load-bearing word | "**scaffold**", not "build the app" |
| 4 | **Numbered deliverables** | Makes completeness checkable | 1 schema, 2 API routes, 3 one page, 4 a seed script |
| 5 | **Named real artifacts** | Forces concreteness | `db/schema.ts`, `app/api/habits/route.ts` |
| 6 | **Worked examples** | Proves the wiring, not just the drawing | "add a habit, tick today, see the streak go to 1" |
| 7 | **Quality bar** | Constrains the output form | "typed end to end, commented for a beginner" |
| 8 | **The why** | Decides what "good" means | "so I can learn how data flows from the DB to the UI" |

**Slot 8 is the one everyone drops and the one that pays most.** Change the why from "learn"
to "ship to users" and slots 6 and 7 change with it. If stuck, write the why first.

## Unknowns: which get asked, which get marked

> **If I guess wrong, do I delete code, or edit a line?**

| | Delete code | Edit a line |
|---|---|---|
| The unknown is | **architectural** — decides whether a subsystem exists | a **parameter** inside a decided build |
| So | **ASK it** in step 2 | **MARK it** `[like this, e.g. default]` and keep going |
| Examples | accounts or not · data persists or not · who uses it · what it is for | port number · app name · colour |

Slot 8, the why, is always architectural: never guess it. A question round with zero
architectural unknowns is **no round at all**: skip straight to step 4.

## The flow — five steps, two stops

| # | Step | Turn ends? |
|---|---|---|
| 1 | User sends the raw request | — |
| 2 | **Ask the questions the spec cannot be written without** | **yes — stop** |
| 3 | User answers | — |
| 4 | **Show the full re-engineered prompt**, opening with the frame line | **yes — stop** |
| 5 | Execute | — |

Asking at the front is worth it because a wrong spec wastes the whole build while a question
costs one turn. Once the spec is agreed, stop asking: mid-build check-ins cost turns and buy
nothing.

### Step 2 — the questions

- **One round, batched, three to five questions maximum.**
- **Ask only what changes what gets built.** If two answers produce the same code, it is
  curiosity, not a question.
- **Never ask what the machine already answers.** OS, shell, package manager, git identity:
  check `CLAUDE.md` and run the command (`node -v`, the repo's `package.json`) instead.
- **Use the `AskUserQuestion` tool**, not prose, so the user can answer by clicking. Give the
  two to four most likely answers as options; "Other" is added automatically.
- **Recommended option first, labelled `(Recommended)`.**

### Step 4 — the full prompt

Show the complete prompt, all eight slots, then **stop**. Open it with:

> **Frame:** I am reading this as *<X>*. The strongest alternative reading is *<Y>*, which I
> rejected because *<reason>*.

That one line gives the user a cheap veto on the most expensive thing to get wrong.

## Where the spec lives

For anything bigger than one turn, **write the spec to a file in the project** (e.g.
`SPEC.md`) and work from it. A spec that lives only in the conversation is lost to
compaction, and subagents rebuild it by guessing.
