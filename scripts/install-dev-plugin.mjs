import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const marketplaceName = "chrome-tab-grouping-dev";
const pluginName = "chatgpt-chrome-tab-grouping";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marketplaceRoot = path.join(projectRoot, ".dev-marketplace");

const listed = run(["plugin", "marketplace", "list", "--json"], true);
const existing = JSON.parse(listed.stdout).marketplaces
  .find((marketplace) => marketplace.name === marketplaceName);

if (!existing) {
  run(["plugin", "marketplace", "add", marketplaceRoot]);
} else if (path.resolve(existing.root) !== marketplaceRoot) {
  throw new Error(`Marketplace ${marketplaceName} already points to ${existing.root}. Remove that marketplace before continuing.`);
}

run(["plugin", "add", `${pluginName}@${marketplaceName}`]);
console.log("Plugin installed. Start a new task to load the refreshed tools; an app restart is not required.");

function run(args, capture = false) {
  const result = spawnSync("codex", args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`codex ${args.join(" ")} failed with exit code ${result.status}.`);
  return result;
}
