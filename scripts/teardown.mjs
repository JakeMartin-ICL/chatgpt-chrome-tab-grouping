import { spawnSync } from "node:child_process";

if (!["darwin", "win32"].includes(process.platform)) {
  throw new Error(`Chrome Tab Grouping teardown does not yet support ${process.platform}.`);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(["node", "scripts/stop-daemon.mjs"]);
run(["run", process.platform === "win32" ? "uninstall:windows" : "uninstall:mac"]);
run(["node", "scripts/remove-dev-plugin.mjs"]);

function run(args) {
  const command = args[0] === "node" ? process.execPath : npm;
  const commandArgs = args[0] === "node" ? args.slice(1) : args;
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status}.`);
}
