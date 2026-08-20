import { spawnSync } from "node:child_process";

run(["plugin", "remove", "chatgpt-chrome-tab-grouping@chrome-tab-grouping-dev"]);
run(["plugin", "marketplace", "remove", "chrome-tab-grouping-dev"]);

function run(args) {
  const result = spawnSync("codex", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`codex ${args.join(" ")} failed with exit code ${result.status}.`);
}
