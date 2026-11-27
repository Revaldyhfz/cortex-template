import * as vscode from "vscode";
import { loadConn, setupCommand } from "./config";
import * as server from "./server";
import * as terminals from "./terminals";
import * as live from "./liveEdits";
import * as debugOut from "./debugOutput";

export function activate(ctx: vscode.ExtensionContext) {
  const conn = loadConn();
  terminals.register(ctx);
  live.register(ctx);
  debugOut.register(ctx);

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  item.command = "cortexSidekick.status";
  item.show();
  let detail = "starting";
  const srv = server.start(conn, (state, d) => {
    detail = d;
    item.text = state === "live" ? "$(plug) Sidekick" : "$(debug-pause) Sidekick (standby)";
    item.tooltip = `Cortex Sidekick: ${d}`;
  });

  ctx.subscriptions.push(
    item,
    { dispose: () => srv.dispose() },
    vscode.commands.registerCommand("cortexSidekick.status", async () => {
      const pick = await vscode.window.showInformationMessage(`Cortex Sidekick: ${detail}`, "Copy Claude setup command");
      if (pick) await vscode.commands.executeCommand("cortexSidekick.copySetup");
    }),
    vscode.commands.registerCommand("cortexSidekick.copySetup", async () => {
      await vscode.env.clipboard.writeText(setupCommand(conn));
      vscode.window.showInformationMessage("Copied. Paste it into a terminal once, then restart the Claude app.");
    })
  );
}

export function deactivate() {}
