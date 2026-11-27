// Live edits: when Claude changes a file, open it beside the user (without stealing
// focus), highlight the changed lines, and keep a "before" copy for Review diff / Revert.
//
// Where "before" comes from, best first:
//   1. the Cortex PreToolUse hook posts the file's content just before Claude's Write/Edit;
//   2. the last content VS Code saw (open documents, saves);
//   3. git HEAD;
//   4. nothing (a brand-new file: Revert deletes it, to the OS trash).
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { cfg } from "./config";

interface Pending {
  file: string;
  before: string | null; // null = file did not exist
  after: string;
  at: number;
}

const BEFORE_SCHEME = "cortex-before";
const known = new Map<string, string>(); // last content VS Code saw, by fsPath
const preImages = new Map<string, string | null>(); // posted by the pre-edit hook
const pending = new Map<string, Pending>();
const ourSaves = new Map<string, number>();
let status: vscode.StatusBarItem;

const highlight = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
  overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});
const timers = new Map<string, NodeJS.Timeout>();

const key = (f: string) => (process.platform === "win32" ? path.normalize(f).toLowerCase() : path.normalize(f));
const IGNORED = /[\\/](node_modules|\.git|dist|out|build|\.next|\.venv|venv|__pycache__|target)[\\/]/;

export function register(ctx: vscode.ExtensionContext) {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "cortexSidekick.review";
  ctx.subscriptions.push(status, highlight);

  const remember = (d: vscode.TextDocument) => {
    if (d.uri.scheme === "file" && !d.isDirty) known.set(key(d.uri.fsPath), d.getText());
  };
  vscode.workspace.textDocuments.forEach(remember);

  ctx.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(BEFORE_SCHEME, {
      provideTextDocumentContent: (uri) => pending.get(key(uri.query))?.before ?? "",
    }),
    vscode.workspace.onDidOpenTextDocument(remember),
    vscode.workspace.onWillSaveTextDocument((e) => ourSaves.set(key(e.document.uri.fsPath), Date.now())),
    vscode.workspace.onDidSaveTextDocument((d) => {
      known.set(key(d.uri.fsPath), d.getText());
      pending.delete(key(d.uri.fsPath)); // the user saved over it: their content now
      refresh();
    }),
    vscode.commands.registerCommand("cortexSidekick.review", review),
    vscode.commands.registerCommand("cortexSidekick.acceptAll", () => {
      pending.clear();
      clearAllHighlights();
      refresh();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => reapply())
  );

  // Optional "any external change" mode.
  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  const onDisk = (uri: vscode.Uri) => {
    if (cfg<string>("followEdits", "claude") !== "any" || IGNORED.test(uri.fsPath)) return;
    const k = key(uri.fsPath);
    if (Date.now() - (ourSaves.get(k) ?? 0) < 2000) return;
    void afterEdit(uri.fsPath, "watcher");
  };
  ctx.subscriptions.push(watcher, watcher.onDidChange(onDisk), watcher.onDidCreate(onDisk));
  refresh();
}

/** Called by the PreToolUse hook (via /notify) just before Claude writes a file. */
export function beforeEdit(file: string, content: string | null) {
  const k = key(file);
  if (!preImages.has(k) && !pending.has(k)) preImages.set(k, content);
}

/** Called by the PostToolUse hook (via /notify) after Claude wrote a file, or by the watcher. */
export async function afterEdit(file: string, source: "hook" | "watcher" = "hook") {
  if (cfg<string>("followEdits", "claude") === "off") return;
  const k = key(file);
  let after: string;
  try {
    const st = fs.statSync(file);
    if (st.size > 2_000_000) return;
    after = fs.readFileSync(file, "utf8");
    if (after.includes("\u0000")) return; // binary
  } catch {
    return;
  }
  let before: string | null | undefined = pending.get(k)?.before;
  if (before === undefined) before = preImages.has(k) ? preImages.get(k)! : known.get(k);
  if (before === undefined) before = await gitHead(file);
  if (before === undefined) before = source === "hook" ? null : after; // unknown history from the watcher: no diff
  preImages.delete(k);
  if (before === after) return;

  pending.set(k, { file, before, after, at: Date.now() });
  known.set(k, after);
  refresh();

  // Give VS Code a moment to reload the document from disk before decorating.
  await new Promise((r) => setTimeout(r, 120));
  const doc = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
  applyHighlight(editor, k);
}

function changedLines(before: string | null, after: string): number[] {
  const a = before === null ? [] : before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length - 1;
  let eb = b.length - 1;
  while (ea >= s && eb >= s && a[ea] === b[eb]) {
    ea--;
    eb--;
  }
  if (eb < s) return []; // pure deletion: nothing to highlight in the new text
  const midA = a.slice(s, ea + 1);
  const midB = b.slice(s, eb + 1);
  // LCS on the changed middle only; too large → mark the whole middle.
  if (midA.length * midB.length > 4_000_000) return range(s, eb);
  const n = midA.length;
  const m = midB.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && midA[i] === midB[j]) {
      i++;
      j++;
    } else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else out.push(s + j++);
  }
  return out;
}

function range(a: number, b: number) {
  const r: number[] = [];
  for (let i = a; i <= b; i++) r.push(i);
  return r;
}

function applyHighlight(editor: vscode.TextEditor, k: string) {
  const p = pending.get(k);
  if (!p) return editor.setDecorations(highlight, []);
  const lines = changedLines(p.before, editor.document.getText());
  editor.setDecorations(
    highlight,
    lines.filter((l) => l < editor.document.lineCount).map((l) => new vscode.Range(l, 0, l, 0))
  );
  if (lines.length) editor.revealRange(new vscode.Range(lines[0], 0, lines[0], 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  const secs = cfg("highlightSeconds", 8);
  clearTimeout(timers.get(k));
  if (secs > 0) timers.set(k, setTimeout(() => editor.setDecorations(highlight, []), secs * 1000));
}

function reapply() {
  if (cfg("highlightSeconds", 8) > 0) return; // timed highlights are not re-shown
  for (const e of vscode.window.visibleTextEditors) if (pending.has(key(e.document.uri.fsPath))) applyHighlight(e, key(e.document.uri.fsPath));
}

function clearAllHighlights() {
  for (const e of vscode.window.visibleTextEditors) e.setDecorations(highlight, []);
}

function refresh() {
  const n = pending.size;
  if (!n) return status.hide();
  status.text = `$(edit) Claude edited ${n} file${n === 1 ? "" : "s"}`;
  status.tooltip = "Review Claude's changes: open a diff, revert, or accept";
  status.show();
}

async function review() {
  if (!pending.size) return vscode.window.showInformationMessage("No Claude edits waiting for review.");
  const items = [...pending.values()]
    .sort((a, b) => b.at - a.at)
    .map((p) => ({ label: vscode.workspace.asRelativePath(p.file), description: p.before === null ? "new file" : "", p }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Claude's edits — pick a file" });
  if (!pick) return;
  const choice = await vscode.window.showQuickPick(["Open diff", "Revert this file", "Accept"], { placeHolder: pick.label });
  if (choice === "Open diff") await showDiff(pick.p.file);
  else if (choice === "Revert this file") await revert(pick.p.file);
  else if (choice === "Accept") {
    pending.delete(key(pick.p.file));
    refresh();
  }
}

export async function showDiff(file: string): Promise<string> {
  const k = key(file);
  let p = pending.get(k);
  if (!p) {
    const head = await gitHead(file);
    if (head === undefined) return "No pre-edit snapshot or git history for this file.";
    p = { file, before: head, after: "", at: Date.now() };
    pending.set(k, p);
    refresh();
  }
  const left = vscode.Uri.from({ scheme: BEFORE_SCHEME, path: "/" + path.basename(file), query: file });
  await vscode.commands.executeCommand("vscode.diff", left, vscode.Uri.file(file), `${path.basename(file)} (before Claude ↔ now)`, { preview: true, preserveFocus: true });
  return "Diff opened in VS Code.";
}

async function revert(file: string) {
  const p = pending.get(key(file));
  if (!p) return;
  if (p.before === null) await vscode.workspace.fs.delete(vscode.Uri.file(file), { useTrash: true });
  else {
    ourSaves.set(key(file), Date.now());
    fs.writeFileSync(file, p.before, "utf8");
    known.set(key(file), p.before);
  }
  pending.delete(key(file));
  refresh();
  vscode.window.showInformationMessage(`Reverted ${vscode.workspace.asRelativePath(file)}.`);
}

export function pendingList() {
  return [...pending.values()].map((p) => ({ file: p.file, newFile: p.before === null, at: new Date(p.at).toISOString() }));
}

function gitHead(file: string): Promise<string | undefined> {
  const dir = path.dirname(file);
  return new Promise((resolve) => {
    execFile("git", ["-C", dir, "rev-parse", "--show-toplevel"], { timeout: 3000 }, (e, root) => {
      if (e) return resolve(undefined);
      const rel = path.relative(root.trim(), file).replace(/\\/g, "/");
      execFile("git", ["-C", root.trim(), "show", `HEAD:${rel}`], { timeout: 3000, maxBuffer: 4_000_000 }, (e2, out) =>
        resolve(e2 ? undefined : out)
      );
    });
  });
}
