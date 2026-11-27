---
name: example-command-style
description: Give shell commands as simple sequential steps, never one complex flag-stacked one-liner
metadata:
  type: feedback
triggers: [command, commands, terminal, shell]
---

EXAMPLE MEMORY — delete or replace this once Claude has written a few real ones.

When giving the user a command to run, break it into simple sequential steps ("first run A,
then run B"), each in its own code block, instead of one long pipeline with stacked flags.

**Why:** the user copies commands one at a time and wants to understand each step; a
one-liner that fails halfway is hard to debug.

**How to apply:** one command per code block; explain in a few words what each does.
