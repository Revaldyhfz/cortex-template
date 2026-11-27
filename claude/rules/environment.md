# Machine hazards

Lessons that each cost a real session to learn. **Rules only**: keep incident write-ups in
`<VAULT>/Cortex/Knowledge/`. Add your own machine's hazards at the bottom as you hit them.

## The running process is a snapshot

Claude Code reads its environment when it starts. Anything changed afterwards (env vars, a
newly installed binary on PATH, a new MCP server, a newly added hook) is invisible to the
running session even though it is correct on disk.

**Before declaring anything broken, run the underlying thing directly** — execute the binary
by its full path, curl the endpoint, run the script. If that works, it needs a restart, not
a fix.

## JSON

- **Build JSON with `node -e` or a script, never shell string interpolation.** Quoting
  silently mangles payloads.
- **Windows PowerShell 5.1:** never write JSON with `Set-Content -Encoding utf8` — it adds
  a byte-order mark (BOM) and Node's `JSON.parse` then rejects the file, so apps silently
  read it as missing.

## Text with punctuation does not survive the shell

- A heredoc passed through a Python or Node string loses one level of backslash escaping.
- Backticks inside a double-quoted shell argument **execute**: `git commit -m "use \`x\`"`
  runs `x` and silently deletes it from the message.

**For content with backslashes, backticks or `$`, write it with the Write/Edit tools and
pass a file** (for example `git commit -F msg.txt`).

## Git

- A multi-path `git add a b c` aborts at the first path that does not exist and silently
  leaves the rest unstaged. Check `git status` before committing.
- Before a repo goes public, scan its full history for secrets (`gitleaks detect`).

## Filesystem

- Never recurse from your home directory. Cloud-sync folders (OneDrive, iCloud, Dropbox) can
  hold hundreds of thousands of files and hang a walk. Target exact paths.
- **Check free disk space, never recall it.** It changes by gigabytes within hours.

## This machine

<!-- Personalise: your OS, default shell and its quirks, package manager, language
     conventions (e.g. "Python: always uv + a venv, never pip install globally"),
     services that are usually stopped (e.g. Docker). Keep it to things that change
     what Claude does. -->
