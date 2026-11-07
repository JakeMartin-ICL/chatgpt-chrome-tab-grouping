import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  packages: "bundle",
  logLevel: "info",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.join(projectRoot, "src/mcp/cli.js")],
    outfile: path.join(projectRoot, "dist/mcp.js"),
  }),
  build({
    ...shared,
    entryPoints: [path.join(projectRoot, "src/bridge/native-host.js")],
    outfile: path.join(projectRoot, "dist/native-host.js"),
  }),
  build({
    ...shared,
    entryPoints: [path.join(projectRoot, "src/bridge/daemon-cli.js")],
    outfile: path.join(projectRoot, "dist/bridge-daemon.js"),
  }),
]);
