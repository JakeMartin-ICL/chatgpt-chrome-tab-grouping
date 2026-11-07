import { spawnSync } from "node:child_process";

if (!["darwin", "win32"].includes(process.platform)) {
  throw new Error(`Chrome Tab Grouping refresh does not yet support ${process.platform}.`);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
runNode(["scripts/stop-daemon.mjs"]);
if (process.platform === "win32") run(["run", "install:windows"]);
run(["run", "plugin:install"]);

function run(args) {
  const result = spawnSync(npm, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${npm} ${args.join(" ")} failed with exit code ${result.status}.`);
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${process.execPath} ${args.join(" ")} failed with exit code ${result.status}.`);
}
