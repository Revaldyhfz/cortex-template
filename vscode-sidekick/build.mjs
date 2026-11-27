// Bundles the extension and its dependencies (MCP SDK, zod) into one file, so the
// .vsix ships without node_modules. `vscode` is provided by the editor at runtime.
import { build } from "esbuild";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: false,
  minify: false,
  logLevel: "info",
});
