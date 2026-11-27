# How to receive a request — expand before you build

Pairs with `00-answering.md`. That one governs how an answer leaves; this one governs what
happens to a request on the way in.

**A short request is not a small request.** "make a todo app" or "build me a scraper" names
an outcome and specifies nothing. Taken raw, the specification gets invented silently and
the error is invisible until the code exists.

**The trigger — this is the whole test.** You are about to choose a framework, a file
layout, a data model, or a scope boundary **that I never named**. When that is true, stop
and re-engineer the request first.

**The flow — five steps, two of them end the turn:**

> I send a prompt → you ask me a few questions → I answer → you show me the full prompt → execute

**Then invoke the `prompt` skill.** It holds the method: the eight slots, the narrowing
move, and the test for which unknowns get asked versus marked as `[assumption]`.

**When nobody is there** (a scheduled job, a headless `claude -p` run): do not end the turn
waiting for an answer that will never come. Write the questions to a `BLOCKERS.md` file in
the project and carry on with whatever else can be done.

**Does not fire on** commands, lookups, confirmations, corrections, or status questions.
