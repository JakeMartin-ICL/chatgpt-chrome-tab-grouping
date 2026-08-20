import { spawnSync } from "node:child_process";

const nodeFiles = [
  "src/mcp/cli.js",
  "src/bridge/native-host.js",
  "extension/service-worker.js",
  "extension/operations.js",
  "extension/options.js",
  "scripts/build-plugin.mjs",
  "scripts/stage-plugin.mjs",
  "scripts/install-dev-plugin.mjs",
  "scripts/remove-dev-plugin.mjs",
  "scripts/setup.mjs",
  "scripts/refresh.mjs",
  "scripts/teardown.mjs",
  "scripts/check.mjs",
];

for (const file of nodeFiles) run(process.execPath, ["--check", file]);

if (process.platform === "win32") {
  run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/check-windows.ps1"]);
} else {
  run("bash", [
    "-n",
    "scripts/install-macos.sh",
    "scripts/uninstall-macos.sh",
    "bin/chrome-tab-grouping-native-host",
    "bin/chrome-tab-grouping-mcp",
  ]);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
}
