# QUEUE

Work for unattended `/aw` runs, top-down. Copy this file to `QUEUE.md` in the project
you want worked (or pass its path to `autonomous.js arm <hours> <path>`), then replace the
example items below with real ones.

The Stop hook **parses this file** to decide whether the run still has work. It counts an
item as **open** only when all of these hold:

1. The line starts a list item with a bold priority tag: `- **[P1] Title** ...`
   (`P0`–`P9`; the title may wrap onto the next line).
2. The **title line** is not struck through (`~~`). A struck sub-bullet does not close
   its parent.
3. The entry contains `done when:` — observable evidence, not intent.

An entry runs until the next item or the next `##`/`###` heading. An item whose
`owner:` names anyone other than `Claude` / `me` / `self` is **gated**: real work the
run must not do or decide. It is reported separately and does not count as open, so a
queue holding only gated items ends the run (and the report names them).

Format (this exact example line is ignored by the parser):

```
- **[P1] Short title** — scope: <where it may touch> · done when: <observable evidence>
```

Closing an item: strike the title and note the evidence, e.g.
`- ~~**[P1] Add tests for the parser**~~ — DONE, commit abc1234, 12 tests pass.`

---

## P1

- **[P1] Example: add tests for the date parser** — scope: `src/dates/`, `test/` ·
  done when: `npm test` exits 0 with at least one test per public function

- **[P1] Example: fix the broken link checker in CI** — scope: `scripts/check-links.mjs` ·
  done when: the script exits 0 on the current docs and 1 on a fixture with a dead link

## P2

- **[P2] Example: choose between SQLite and Postgres for v2** — scope: `docs/` ·
  owner: user · done when: the user picks one (prepare the comparison in BLOCKERS.md)

- ~~**[P2] Example: rename the config loader**~~ — DONE, commit abc1234.
