// Captures Debug Console output from every debug session via a debug-adapter tracker.
import * as vscode from "vscode";

const MAX = 200_000;
let buf = "";

export function register(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory("*", {
      createDebugAdapterTracker(session) {
        return {
          onDidSendMessage(m: any) {
            if (m?.type === "event" && m.event === "output" && typeof m.body?.output === "string" && m.body.category !== "telemetry") {
              const tag = m.body.category && m.body.category !== "console" ? `[${m.body.category}] ` : "";
              buf += `${tag}${m.body.output}`;
              if (buf.length > MAX) buf = buf.slice(-MAX);
            }
          },
          onWillStartSession() {
            buf += `\n--- debug session started: ${session.name} ---\n`;
          },
        };
      },
    })
  );
}

export function read(maxChars: number): string {
  return buf.length > maxChars ? "[…]" + buf.slice(-maxChars) : buf;
}
