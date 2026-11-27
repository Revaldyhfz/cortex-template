# cortex-template (this repository)

If the user asked you to **set this up** or **install** it, follow `SETUP.md` step by step.

If they are working on the template itself: run `node test/smoke.mjs`,
`node test/guardrail.test.mjs` and `node test/autonomous.test.mjs` after any change to
`install.mjs`, `uninstall.mjs` or `claude/`. The VS Code extension lives in
`vscode-sidekick/` (`npm install`, `npm run package`, then `node test/run-e2e.mjs`).
