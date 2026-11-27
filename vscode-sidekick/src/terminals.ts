// Terminal capture and execution, using VS Code's shell integration API (1.93+).
//
// One listener records EVERY command run in EVERY terminal (Claude's and the user's own),
// so Claude can read the error from `npm run dev` that the user started by hand.
import * as vscode from "vscode";
import { cfg } from "./config";

export interface ExecRecord {
  terminal: string;
  command: string;
  cwd?: string;
  output: string;
  exitCode?: number;
  done: boolean;
  startedAt: number;
  finished: Promise<void>;
}

const MAX_PER_TERMINAL = 20;
const MAX_OUTPUT = 60_000;
const byTerminal = new Map<vscode.Terminal, ExecRecord[]>();
const byExecution = new Map<vscode.TerminalShellExecution, ExecRecord>();
const resolvers = new Map<ExecRecord, () => void>();

// Strip ANSI colour codes and the OSC 633 / 133 shell-integration markers.
export function clean(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "");
}

function tail(s: string, n = MAX_OUTPUT): string {
  return s.length > n ? "[…truncated…]\n" + s.slice(-n) : s;
}

export function register(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.window.onDidStartTerminalShellExecution(async (e) => {
      let resolve!: () => void;
      const rec: ExecRecord = {
        terminal: e.terminal.name,
        command: e.execution.commandLine.value,
        cwd: e.execution.cwd?.fsPath,
        output: "",
        done: false,
        startedAt: Date.now(),
        finished: new Promise<void>((r) => (resolve = r)),
      };
      resolvers.set(rec, resolve);
      const list = byTerminal.get(e.terminal) ?? [];
      list.push(rec);
      if (list.length > MAX_PER_TERMINAL) list.shift();
      byTerminal.set(e.terminal, list);
      byExecution.set(e.execution, rec);
      try {
        for await (const chunk of e.execution.read()) {
          rec.output = tail(rec.output + clean(chunk), MAX_OUTPUT * 2);
        }
      } catch {
        /* stream closed */
      }
    }),
    vscode.window.onDidEndTerminalShellExecution((e) => {
      const rec = byExecution.get(e.execution);
      if (!rec) return;
      rec.exitCode = e.exitCode;
      // The read() stream may still be flushing; give it a beat before declaring done.
      setTimeout(() => {
        rec.done = true;
        resolvers.get(rec)?.();
        resolvers.delete(rec);
        byExecution.delete(e.execution);
      }, 150);
    }),
    vscode.window.onDidCloseTerminal((t) => byTerminal.delete(t))
  );
}

function findTerminal(name: string): vscode.Terminal | undefined {
  return vscode.window.terminals.find((t) => t.name === name);
}

async function waitForIntegration(t: vscode.Terminal, ms: number): Promise<vscode.TerminalShellIntegration | undefined> {
  if (t.shellIntegration) return t.shellIntegration;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(t.shellIntegration);
    }, ms);
    const sub = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal === t) {
        clearTimeout(timer);
        sub.dispose();
        resolve(e.shellIntegration);
      }
    });
  });
}

export interface RunResult {
  terminal: string;
  command: string;
  exitCode?: number;
  output: string;
  timedOut: boolean;
  note?: string;
}

export async function run(command: string, opts: { cwd?: string; terminal?: string; timeoutSec?: number }): Promise<RunResult> {
  const name = opts.terminal || cfg("terminalName", "Claude");
  let t = findTerminal(name);
  // A different cwd than the terminal was opened in: open a fresh one rather than cd-ing
  // (cd would leak into the user's next command in that terminal).
  if (!t || opts.cwd) {
    if (t && opts.cwd) t = undefined;
    t = vscode.window.createTerminal({ name: opts.cwd ? `${name} (${shortName(opts.cwd)})` : name, cwd: opts.cwd });
  }
  t.show(true); // visible, but keep the user's focus where it is
  // A cold PowerShell with a profile can take 10+ seconds to report shell integration.
  const si = await waitForIntegration(t, 25000);
  if (!si) {
    t.sendText(command, true);
    return {
      terminal: t.name,
      command,
      output: "",
      timedOut: false,
      note:
        "Sent to the terminal, but VS Code shell integration is not active there, so output and exit code cannot be read. " +
        "Enable `terminal.integrated.shellIntegration.enabled`, or use a supported shell (bash, zsh, fish, pwsh).",
    };
  }
  const sentAt = Date.now();
  const term = t;
  const exec = si.executeCommand(command);
  // The start event arrives after executeCommand returns: milliseconds on a warm terminal,
  // 2+ seconds on a freshly opened one. Match by identity, falling back to "same terminal,
  // same command line, started after we sent it" (the API does not always hand back the
  // same execution object in the event).
  const find = () =>
    byExecution.get(exec) ??
    [...(byTerminal.get(term) ?? [])].reverse().find((r) => r.command.trim() === command.trim() && r.startedAt >= sentAt - 50);
  let rec: ExecRecord | undefined;
  for (let i = 0; i < 300 && !(rec = find()); i++) await sleep(50);
  if (!rec) return { terminal: t.name, command, output: "", timedOut: false, note: "Command was sent, but VS Code did not report it starting within 15s. Check the terminal." };

  const timeoutMs = Math.max(1, opts.timeoutSec ?? 120) * 1000;
  const timedOut = await Promise.race([rec.finished.then(() => false), sleep(timeoutMs).then(() => true)]);
  return {
    terminal: t.name,
    command,
    exitCode: rec.exitCode,
    output: tail(rec.output),
    timedOut,
    note: timedOut ? `Still running after ${timeoutMs / 1000}s (left running). Use terminal_read to check on it later.` : undefined,
  };
}

export function list() {
  return vscode.window.terminals.map((t) => ({
    name: t.name,
    shellIntegration: !!t.shellIntegration,
    recent: (byTerminal.get(t) ?? []).slice(-5).map((r) => ({ command: r.command, exitCode: r.exitCode, running: !r.done })),
  }));
}

export function read(name: string | undefined, maxChars: number) {
  const terms = name ? vscode.window.terminals.filter((t) => t.name === name) : vscode.window.terminals;
  const all = terms.flatMap((t) => byTerminal.get(t) ?? []).sort((a, b) => a.startedAt - b.startedAt);
  // Newest last; when over budget, drop from the oldest end.
  let budget = maxChars;
  const kept: { terminal: string; command: string; cwd?: string; exitCode?: number; running: boolean; output: string }[] = [];
  for (let i = all.length - 1; i >= 0 && budget > 0; i--) {
    const r = all[i];
    const o = r.output.length > budget ? "[…]" + r.output.slice(-budget) : r.output;
    budget -= o.length + r.command.length;
    kept.unshift({ terminal: r.terminal, command: r.command, cwd: r.cwd, exitCode: r.exitCode, running: !r.done, output: o });
  }
  return kept;
}

function shortName(p: string) {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
