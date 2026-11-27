# Personal environment

Machine-wide facts. Applies to every project on this machine. Loaded every session, so keep
it short: only facts that change what Claude does. Reference material (full tool inventories,
version tables) belongs in `<VAULT>/Cortex/Knowledge/`, read when it matters.

<!-- Every <ANGLE-BRACKET> value below is a placeholder. The setup prompt in the
     cortex-template README asks you for them and fills them in. -->

## Who I am

- I am <YOUR_ROLE, e.g. "a CS student learning web dev">. Pitch explanations at that level.
- How I like answers: answer first, then reasoning. Have a view; never give me options
  without a recommendation.

## Machine

- OS: <OS, e.g. Windows 11 / macOS 15 / Ubuntu 24.04>.
- Default shell: <SHELL, e.g. PowerShell 7 / zsh / bash>.
- Package manager for system tools: <e.g. winget / Homebrew / apt>.

## Language conventions

- **Python** → <e.g. `uv init` + `uv add`, always a venv, never `pip install` globally>.
- **Node/TS** → <e.g. npm, but honour a repo's own pin (pnpm-lock, packageManager field)>.
- `git init` per project.

## Git identity

Commits author as `<GIT_NAME> <GIT_EMAIL>`. Never change it.

## Where things live

- Projects: <PROJECTS_DIR, e.g. ~/code>.
- Cortex vault (session capture, state notes, knowledge): `<VAULT>`.
- Starting something new: create a subdirectory, do not scatter files.
