#!/usr/bin/env node
/**
 * guardrail.js — PreToolUse hard-stop for a small set of never-intended operations.
 *
 * Why it exists: hooks fire in EVERY permission mode, including bypassPermissions.
 * So even if you later turn approval prompts off, this stays as the last enforcement
 * point. It is deliberately NARROW: it blocks things that are never intentional and
 * stays silent otherwise. A false positive here is invisible and infuriating, so the
 * bar for adding a rule is "I cannot construct a legitimate use for this."
 *
 * Two severities:
 *   deny — never an agent's call. You can still run it yourself in a terminal.
 *   ask  — a human must click Approve. With nobody present (headless `claude -p`,
 *          scheduled jobs) an ask fails CLOSED, so the command never runs.
 *
 * Contract: read hook JSON on stdin, print a PreToolUse decision on stdout, exit 0.
 * Printing nothing = no opinion = the call proceeds normally.
 *
 * Disable: remove the PreToolUse entry for this file from ~/.claude/settings.json.
 * Test:    node test/smoke.mjs   (from the cortex-template repo)
 * Audit:   every hit is appended to ~/.claude/cortex/state/guardrail-blocked.log
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// GUARDRAIL_LOG lets the test suite keep fixture hits out of the real audit log.
const AUDIT_LOG =
  process.env.GUARDRAIL_LOG || path.join(os.homedir(), ".claude", "cortex", "state", "guardrail-blocked.log");

// --- protected delete targets ------------------------------------------------
//
// Matched ONLY against the individual statement that contains the delete (see
// splitStatements), never the whole script, or an unrelated comment elsewhere
// ("# A: step one") gets read as a target.
//
// Windows patterns require a real separator (`C:\` / `C:/`), never a bare `X:`.
// Git Bash spells the same folders `/c/Users/...` and WSL `/mnt/c/...`, so both
// are covered too. Depth: the root, the Users tree and a whole profile are
// blocked; anything deeper is ordinary work.
const NUKE_TARGETS = [
  /(^|\s)['"]?[a-z]:[\\/]['"]?(\s|$)/i, // C:\  C:/
  /(^|\s)['"]?[a-z]:[\\/]users[\\/]?['"]?(\s|$)/i, // C:\Users
  /(^|\s)['"]?[a-z]:[\\/]users[\\/][^\\/\s"']+[\\/]?['"]?(\s|$)/i, // C:\Users\<name>
  /(^|\s)['"]?[a-z]:[\\/]windows([\\/]|['"]?(\s|$))/i,
  /(^|\s)['"]?[a-z]:[\\/]program files([\\/]|['"]?(\s|$))/i,
  /(^|\s)['"]?[~/]['"]?(\s|$)/, // ~ or /
  /(^|\s)\$env:USERPROFILE['"]?(\s|$)/i,
  /(^|\s)['"]?%USERPROFILE%['"]?(\s|$)/i,

  // Git Bash / MSYS `/c/...` and WSL `/mnt/c/...`
  /(^|\s)['"]?\/(?:mnt\/)?[a-z]\/?['"]?(\s|$)/i,
  /(^|\s)['"]?\/(?:mnt\/)?[a-z]\/users\/?['"]?(\s|$)/i,
  /(^|\s)['"]?\/(?:mnt\/)?[a-z]\/users\/[^\/\s"']+\/?['"]?(\s|$)/i,
  /(^|\s)['"]?\/(?:mnt\/)?[a-z]\/windows(\/|['"]?(\s|$))/i,
  /(^|\s)['"]?\/(?:mnt\/)?[a-z]\/program files(\/|['"]?(\s|$))/i,

  // macOS / Linux system roots and home directories (a path INSIDE them is fine).
  /(^|\s)['"]?\/(home|Users|etc|usr|var|boot|opt|root|srv|lib|lib64|bin|sbin|snap|System|Applications|Library)\/?\*?['"]?(\s|$)/,
  /(^|\s)['"]?\/(home|Users)\/[^\/\s"']+\/?\*?['"]?(\s|$)/, // /home/<user>  /Users/<user>
  /(^|\s)['"]?(\$HOME|\$\{HOME\}|~\/?\*?)['"]?(\s|$)/, // $HOME  ${HOME}  ~/  ~/*
  /(^|\s)['"]?\/\*['"]?(\s|$)/, // /*
  // The home folders that hold irreplaceable data (macOS app data lives in ~/Library).
  // A path INSIDE them (~/Library/Caches/foo) is ordinary work.
  /(^|\s)['"]?(~|\$HOME|\$\{HOME\}|\/Users\/[^\/\s"']+|\/home\/[^\/\s"']+)\/(Library|Documents|Desktop|Pictures)\/?\*?['"]?(\s|$)/,
];

// A pipe into an interpreter that will EXECUTE what it receives.
// `-c` / `-e` / `--eval` / `--command` mean the script is inline and stdin is just
// data, so `curl … | python -c "json.load(sys.stdin)"` is allowed.
const PIPE_TO_INTERPRETER =
  /\|\s*(?:bash|sh|zsh|python|python3|node|pwsh|powershell)(?![\w.\-])(?![^|;&\n]*\s-(?:c|e|-eval|-command)\b)/i;

// Heredoc opener: `<<EOF`, `<<-EOF`, `<<'EOF'`, `<< "EOF"`. The lookahead keeps
// arithmetic `$((a << b))` from being read as a heredoc.
const HEREDOC_OPEN = /<<-?\s*(?:(['"])([A-Za-z_]\w*)\1|([A-Za-z_]\w*))(?=$|[\s|>&;])/g;

/**
 * Remove heredoc BODIES before judging. A heredoc body is data being written
 * somewhere (a doc that *mentions* `curl | sh` must not be blocked), unless the
 * heredoc is piped straight into an interpreter — those are left intact.
 */
function stripHeredocBodies(c) {
  const lines = String(c).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    HEREDOC_OPEN.lastIndex = 0;
    const delims = [];
    let m;
    while ((m = HEREDOC_OPEN.exec(line))) delims.push(m[2] || m[3]);
    if (!delims.length || PIPE_TO_INTERPRETER.test(line)) continue;
    for (const d of delims) {
      while (++i < lines.length && lines[i].trim() !== d) {
        /* body dropped */
      }
    }
  }
  return out.join("\n");
}

/** Split a script into statements so a rule only judges the command it is about. */
function splitStatements(c) {
  return stripHeredocBodies(c)
    .split(/\r?\n|&&|\|\||;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip wrappers (`sudo`, `xargs`, `env`…) so the real command is visible. */
function leadingCommand(segment) {
  let s = segment.trim();
  for (let i = 0; i < 5; i++) {
    const m = /^(?:sudo|xargs|env|time|nohup|command)(?![\w.\-])\s+(?:-[^\s]+\s+)*/i.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return s;
}

const RULES = [
  {
    id: "recursive-delete-of-protected-root",
    why: "Recursive force-delete aimed at a drive root, the Users/home tree, a whole user profile, or a system folder.",
    test: (tool, i) => {
      if (!isShell(tool)) return false;
      return splitStatements(i.command || "").some((s) => {
        // POSIX deletes must be in COMMAND POSITION, so `echo 'never run rm -rf /'` is fine.
        const runsDelete = s
          .split("|")
          .map(leadingCommand)
          .some(
            (seg) =>
              /^rm(?![\w.\-])\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i.test(seg) ||
              /^rmdir(?![\w.\-])\s+\/s\b/i.test(seg) ||
              /^del(?![\w.\-])\s+\/[sq]/i.test(seg)
          );
        const isRecursiveDelete =
          runsDelete || (/\bRemove-Item\b/i.test(s) && /-Recurse\b/i.test(s) && /-Force\b/i.test(s));
        return isRecursiveDelete && NUKE_TARGETS.some((re) => re.test(s));
      });
    },
  },
  {
    id: "destructive-disk-operation",
    why: "Disk-level destructive command (shadow copy deletion, format, partition wipe, secure erase, boot config, disk encryption keys).",
    test: (tool, i) =>
      !isShell(tool)
        ? false
        : splitStatements(i.command || "").some(
            (s) =>
              (cmd("vssadmin").test(s) && /\bdelete\s+shadows/i.test(s)) ||
              (cmd("format").test(s) && /\s[a-z]:/i.test(s)) ||
              cmd("diskpart").test(s) ||
              (cmd("cipher").test(s) && /\s\/w/i.test(s)) ||
              (cmd("bcdedit").test(s) && /\s(delete|set)\b/i.test(s)) ||
              cmd("mkfs(?:\\.\\w+)?").test(s) ||
              (cmd("dd").test(s) && /\bof=\/dev\/([sh]d|nvme|mmcblk|dm-|mapper\/|disk)/i.test(s)) ||
              cmd("wipefs").test(s) ||
              cmd("blkdiscard").test(s) ||
              (cmd("diskutil").test(s) && /\b(eraseDisk|eraseVolume|zeroDisk|secureErase|partitionDisk)\b/i.test(s)) ||
              (cmd("sgdisk").test(s) && /\s(-Z|--zap-all|-o|--clear)\b/.test(s)) ||
              (cmd("(?:parted|fdisk|sfdisk)").test(s) && /\b(mklabel|rm|--delete|-w\s+always)\b/i.test(s)) ||
              (cmd("shred").test(s) && /\/dev\//.test(s)) ||
              (cmd("cryptsetup").test(s) &&
                /\b(luksFormat|erase|luksErase|luksKillSlot|luksRemoveKey|reencrypt)\b/.test(s))
          ),
  },
  {
    id: "remote-lockout-risk",
    decision: "ask",
    why: "This could cut off remote access or the firewall (SSH, Tailscale, ufw, your login). A lockout may need you physically at the machine to undo.",
    test: (tool, i) =>
      !isShell(tool)
        ? false
        : splitStatements(i.command || "").some(
            (s) =>
              (cmd("systemctl").test(s) &&
                /\b(stop|disable|mask|kill)\b/.test(s) &&
                /\b(ssh|sshd|tailscaled|ufw|firewalld|systemd-logind|gdm)\b/.test(s)) ||
              (cmd("ufw").test(s) && /\b(disable|reset|default\s+allow)\b/.test(s)) ||
              (cmd("tailscale").test(s) && /\b(down|logout)\b/.test(s)) ||
              (cmd("(?:passwd|usermod)").test(s) && /\s(-l|--lock|-L|-e\s+1)\b/.test(s)) ||
              (cmd("(?:nft|iptables)").test(s) && /\b(flush|-F)\b/.test(s))
          ),
  },
  {
    id: "os-security-off",
    decision: "ask",
    why: "This turns off a macOS security protection (System Integrity Protection, Gatekeeper, the quarantine check on a downloaded app, FileVault or the firewall). Approve only if you meant to.",
    test: (tool, i) =>
      !isShell(tool)
        ? false
        : splitStatements(i.command || "").some(
            (s) =>
              (cmd("csrutil").test(s) && /\b(disable|authenticated-root\s+disable)\b/.test(s)) ||
              (cmd("spctl").test(s) && /--(master|global)-disable\b/.test(s)) ||
              (cmd("xattr").test(s) && /com\.apple\.quarantine/.test(s) && /\s-[a-zA-Z]*[dc]/.test(s)) ||
              (cmd("fdesetup").test(s) && /\bdisable\b/.test(s)) ||
              (/socketfilterfw\b/.test(s) && /--setglobalstate\s+off\b/.test(s))
          ),
  },
  {
    // On macOS/Linux Claude Code can run Bash in a sandbox. A failed command may be
    // retried OUTSIDE it; without this rule that retry would be silent in bypass mode.
    id: "sandbox-escape",
    decision: "ask",
    why: "Claude wants to run this command OUTSIDE the sandbox (full access to your files, keys and network). Approve only if you expected it.",
    test: (tool, i) => isShell(tool) && (i.dangerouslyDisableSandbox === true || i.dangerouslyDisableSandbox === "true"),
  },
  {
    id: "read-private-key-material",
    why: "Read of private key or stored-credential material. Checking that a key exists is fine; reading its contents is not.",
    test: (tool, i) => {
      const p = (i.file_path || i.path || "").replace(/\\/g, "/");
      // Normalise slashes in shell commands too, or `cat C:\...\.ssh\id_rsa` slips past.
      const c = isShell(tool) ? (i.command || "").replace(/\\/g, "/") : "";
      const target = p || c;
      if (!target) return false;
      // macOS Keychain: printing a stored password (-w / -g) or exporting the keychain.
      if (
        c &&
        splitStatements(c).some(
          (s) =>
            (cmd("security").test(s) && /\bfind-(generic|internet)-password\b/.test(s) && /\s-[a-zA-Z]*[wg]/.test(s)) ||
            (cmd("security").test(s) && /\b(dump-keychain|export)\b/.test(s))
        )
      )
        return true;
      return (
        /\/\.ssh\/id_(rsa|dsa|ecdsa|ed25519)(?!\.pub)/i.test(target) ||
        /\.claude\/\.credentials\.json/i.test(target) ||
        /\/\.aws\/credentials/i.test(target) ||
        /\.gnupg\/.*\.(key|gpg)$/i.test(target) ||
        (/id_ed25519(?!\.pub)/i.test(target) && !/\.pub\b/i.test(target))
      );
    },
  },
  {
    id: "remote-script-piped-to-shell",
    why: "Downloading a remote script straight into an interpreter. This is the standard shape of an injected payload.",
    test: (tool, i) => {
      if (!isShell(tool)) return false;
      return splitStatements(i.command || "").some((s) => {
        const fetches =
          /\b(curl|wget|iwr|Invoke-WebRequest|Invoke-RestMethod)\b/i.test(s) ||
          /\b(DownloadString|DownloadFile|DownloadData)\s*\(/i.test(s) ||
          /Net\.WebClient|System\.Net\.Http/i.test(s);
        const pipesToShell =
          PIPE_TO_INTERPRETER.test(s) || /\|\s*(iex|Invoke-Expression)\b/i.test(s) || /\b(iex|Invoke-Expression)\s*\(/i.test(s);
        return fetches && pipesToShell;
      });
    },
  },
  {
    id: "force-push",
    why: "Force push rewrites published history. Do it deliberately and by hand, not from an agent turn.",
    test: (tool, i) =>
      !isShell(tool)
        ? false
        : splitStatements(i.command || "").some(
            (s) => /\bgit\s+push\b/i.test(s) && /(--force(?!-with-lease)|\s-f\b)/i.test(s)
          ),
  },
  // A failing git hook is a finding to fix, not a gate to step round. TOKENIZED rather
  // than regexed: quoted tokens are values, never flags (so a commit MESSAGE that
  // mentions --no-verify is fine), short-option clusters are read letter by letter,
  // git's unambiguous long-option prefixes count, and nested `bash -c "..."` is re-judged.
  {
    id: "git-hook-bypass",
    why: "Skipping git hooks or commit signing (--no-verify, commit -n, core.hooksPath, gpgsign=false). Fix what the hook caught instead.",
    test: (tool, i) => isShell(tool) && splitStatements(i.command || "").some((s) => gitBypass(s, 0)),
  },
  // OUTWARD-FACING ACTIONS (ask). Reading, searching and DRAFTING stay untouched:
  // preparing is the agent's job. Only the moment something leaves the machine on
  // your behalf (an email sent, an event changed, a purchase) needs a human.
  {
    id: "outward-facing-action",
    decision: "ask",
    why: "This sends, cancels, or spends on your behalf, outside this machine. Preparing is unrestricted; dispatching is your call.",
    test: (tool) => OUTWARD_FACING.test(tool || ""),
  },
  {
    id: "irreversible-outward-action",
    why: "This moves money or destroys a repository. Never an agent's call, and deliberately not offered as an approvable prompt. Do it yourself if you mean it.",
    test: (tool) => IRREVERSIBLE.test(tool || ""),
  },
  {
    id: "repo-write-or-deploy",
    decision: "ask",
    why: "This publishes code or a deployment through an MCP tool. Reading, searching and local commits are untouched.",
    test: (tool) => REPO_WRITE.test(tool || ""),
  },
  // THE CONTROL PLANE (ask). The thing being controlled must not be able to quietly
  // edit its own controller, or every other guarantee here unwinds in one turn.
  // You can still improve these files with Claude; you just click Approve.
  {
    id: "control-plane-write",
    decision: "ask",
    why: "This edits the files that decide what an agent may do: the guardrail, settings, the rules, or CLAUDE.md. Reading them is unrestricted.",
    test: (tool, i) => {
      if (tool === "Write" || tool === "Edit" || tool === "NotebookEdit") {
        return CONTROL_PLANE.some((re) => re.test(i.file_path || i.notebook_path || ""));
      }
      if (!isShell(tool)) return false;
      return splitStatements(i.command || "").some((s) => SHELL_WRITE.test(s) && CONTROL_PLANE.some((re) => re.test(s)));
    },
  },
];

// Matched against MCP tool names (mcp__<server>__<tool>). `ccd_` is the desktop
// app's own session plumbing, which never leaves the machine.
const OUTWARD_FACING =
  /^mcp__(?!ccd_)[^]*__(send_message|send_email|reply|forward|trash_message|trash_thread|mark_message_spam|mark_thread_spam|create_event|update_event|delete_event|respond_to_event|buy_\w+)$/i;

const REPO_WRITE =
  /^mcp__(?!ccd_)[^]*__(create_pull_request|merge_pull_request|update_pull_request|push_files|create_or_update_file|delete_file|create_branch|fork_repository|create_repository|deploy_to_vercel|create_git_project|update_project_deployment_protection)$/i;

const IRREVERSIBLE = /^mcp__(?!ccd_)[^]*__(delete_repository|.*(?:trade|withdraw|transfer|swap_|sell_|deposit)\w*)$/i;

// Both path spellings (Windows and POSIX) so Git Bash cannot sidestep them.
const CONTROL_PLANE = [
  /[\\/]\.claude[\\/]hooks[\\/]guardrail(\.test)?\.js\b/i,
  /[\\/]\.claude[\\/]settings(\.local)?\.json\b/i,
  /[\\/]\.claude[\\/]rules[\\/]/i,
  /[\\/]\.claude[\\/]CLAUDE\.md\b/i,
  /\/etc\/sudoers(\.d)?\b/,
  /\/etc\/ssh\/sshd_config/,
  /\/\.ssh\/authorized_keys\b/,
];

// Shell verbs that WRITE to a path. Known gap, stated rather than hidden: this only
// sees paths that appear in the command string, so `node patch.js` (path inside the
// script) gets through. The Write/Edit arm above is the real protection; this arm
// raises the cost of the casual case. Do not read it as a security boundary.
const SHELL_WRITE =
  /(^|[\s|&;])(sed\s+-i|tee|cp|mv|rm|install|dd|git\s+checkout|git\s+restore|Set-Content|Add-Content|Out-File|Copy-Item|Move-Item|Remove-Item)\b|>{1,2}\s*[^|\s]/i;

// --- git-hook-bypass helpers --------------------------------------------------

function shellTokens(s) {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) out.push({ t: m[1].replace(/\\(.)/g, "$1"), q: true });
    else if (m[2] !== undefined) out.push({ t: m[2], q: true });
    else out.push({ t: m[3].replace(/^["']+|["']+$/g, ""), q: false });
  }
  return out;
}

const COMMIT_VALUE_SHORT = new Set(["m", "F", "c", "C", "t", "S", "u"]);
const NESTED_SHELL = /^(?:bash|sh|zsh|pwsh|powershell|cmd)(?:\.exe)?$/i;

function gitBypass(statement, depth) {
  if (depth > 2) return false;
  return statement.split("|").some((raw) => {
    const toks = shellTokens(leadingCommand(raw));
    if (!toks.length) return false;

    if (!toks[0].q && NESTED_SHELL.test(toks[0].t)) {
      for (let k = 1; k < toks.length - 1; k++) {
        if (!toks[k].q && /^(?:-c|\/c|-Command|-command)$/.test(toks[k].t))
          return splitStatements(toks[k + 1].t).some((s) => gitBypass(s, depth + 1));
      }
      return false;
    }
    if (toks[0].q || !/^git(?:\.exe)?$/i.test(toks[0].t)) return false;

    let k = 1;
    let sub = null;
    for (; k < toks.length; k++) {
      const tk = toks[k];
      if (!tk.q && tk.t === "-c" && toks[k + 1]) {
        const v = toks[++k].t;
        if (/^core\.hookspath\s*=/i.test(v)) return true;
        if (/^commit\.gpgsign\s*=\s*(?:false|0|no|off)\s*$/i.test(v)) return true;
        continue;
      }
      if (!tk.q && tk.t.startsWith("-")) continue;
      sub = tk.t.toLowerCase();
      break;
    }
    if (!sub) return false;

    for (k = k + 1; k < toks.length; k++) {
      const tk = toks[k];
      if (tk.q) continue;
      const t = tk.t;
      if (t === "--") break;
      if (/^--no-veri(?:f|fy)?$/i.test(t) || /^--no-verify$/i.test(t)) return true;
      if (/^--no-gpg(?:-(?:s(?:i(?:g(?:n)?)?)?)?)?$/i.test(t) && t.length >= "--no-gpg".length) return true;
      if (sub === "commit" && /^-[A-Za-z]+$/.test(t)) {
        for (const ch of t.slice(1)) {
          if (ch === "n") return true;
          if (COMMIT_VALUE_SHORT.has(ch)) break;
        }
      }
    }
    return false;
  });
}

// An MCP tool that runs a shell command (input field `command`) is a shell tool too,
// or every shell rule above could be sidestepped by routing the command through it.
const SHELL_TOOLS = new Set(["Bash", "PowerShell", "mcp__vscode__terminal_run"]);

function isShell(tool) {
  return SHELL_TOOLS.has(tool);
}

/** Match `name` only in command position and as a whole token (`\b` treats `-` as a boundary). */
function cmd(name) {
  return new RegExp(`(?:^|[;|&(\\s])${name}(?![\\w.\\-])`, "i");
}

// --- driver ----------------------------------------------------------------

function decide(payload) {
  const tool = payload.tool_name || "";
  const input = payload.tool_input || {};
  for (const rule of RULES) {
    let hit = false;
    try {
      hit = rule.test(tool, input);
    } catch {
      hit = false; // a broken rule must never block legitimate work
    }
    if (hit) return rule;
  }
  return null;
}

function audit(rule, payload) {
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      rule: rule.id,
      tool: payload.tool_name,
      input: payload.tool_input,
      session: payload.session_id,
    }) + "\n";
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
    fs.appendFileSync(AUDIT_LOG, line);
  } catch {
    /* logging must never break the hook */
  }
}

if (require.main === module) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      process.exit(0); // unparseable input: stay out of the way
    }
    const rule = decide(payload);
    if (!rule) process.exit(0);
    audit(rule, payload);

    const decision = rule.decision === "ask" ? "ask" : "deny";
    const reason =
      decision === "ask"
        ? `Guardrail rule "${rule.id}" wants a human on this one. ${rule.why} Approve it here if you meant it; nothing has run yet.`
        : `Blocked by guardrail rule "${rule.id}". ${rule.why} If this is genuinely intended, run it yourself in a terminal, or edit ~/.claude/hooks/guardrail.js.`;

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
      })
    );
    process.exit(0);
  });
}

module.exports = { decide, RULES };
