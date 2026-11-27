# How to receive a request — expand before you build

Pairs with `00-answering.md`. That one governs how an answer leaves; this one governs what
happens to a request on the way in.

**A short request is not a small request.** "make a todo app" or "build me a scraper" names
an outcome and specifies nothing. Taken raw, the specification gets invented silently and
the error is invisible until the code exists.

**Default: pick sensible defaults and go.** For a small or easily redone request, choose the
obvious stack and scope, state your assumptions in one line at the top, and build. I can
correct you after seeing something real.

**Ask first only when both are true:** the request is project-sized (days of work, or hard
to undo), and a wrong guess about the framework, data model or scope would waste that work.
Then ask at most three short questions in one message, with a recommended answer for each,
and wait. If I say "just go", go.

**For a bigger spec pass**, I can type `/prompt`. The `prompt` skill holds the full method:
the eight slots, the narrowing move, and which unknowns to ask versus mark as `[assumption]`.

**When nobody is there** (a scheduled job, a headless `claude -p` run): do not end the turn
waiting for an answer that will never come. Write the questions to a `BLOCKERS.md` file in
the project and carry on with whatever else can be done.

**Does not fire on** commands, lookups, confirmations, corrections, or status questions.
