import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginName = "chatgpt-chrome-tab-grouping";
const marketplaceName = "chrome-tab-grouping-dev";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marketplaceRoot = path.join(projectRoot, ".dev-marketplace");
const pluginRoot = path.join(marketplaceRoot, "plugins", pluginName);

if (path.basename(marketplaceRoot) !== ".dev-marketplace") throw new Error("Unsafe marketplace staging path.");
await fs.rm(marketplaceRoot, { recursive: true, force: true });
await fs.mkdir(pluginRoot, { recursive: true });

for (const entry of [
  ".codex-plugin",
  ".mcp.json",
  "bin",
  "dist",
  "extension",
  "skills",
  "scripts/install-macos.sh",
  "scripts/uninstall-macos.sh",
  "LICENSE",
  "README.md",
]) {
  await fs.cp(path.join(projectRoot, entry), path.join(pluginRoot, entry), { recursive: true });
}

const nodePath = await fs.readFile(path.join(projectRoot, ".native-node-path"), "utf8")
  .catch(() => `${process.execPath}\n`);
await fs.writeFile(path.join(pluginRoot, ".native-node-path"), nodePath, { mode: 0o600 });

const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const baseVersion = manifest.version.split("+")[0];
const cachebuster = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
manifest.version = `${baseVersion}+codex.local-${cachebuster}`;
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(path.join(pluginRoot, "package.json"), `${JSON.stringify({
  name: pluginName,
  version: manifest.version,
  private: true,
  type: "module",
}, null, 2)}\n`);

const marketplace = {
  name: marketplaceName,
  interface: { displayName: "Chrome Tab Grouping Development" },
  plugins: [{
    name: pluginName,
    source: { source: "local", path: `./plugins/${pluginName}` },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Productivity",
  }],
};
const marketplaceFile = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");
await fs.mkdir(path.dirname(marketplaceFile), { recursive: true });
await fs.writeFile(marketplaceFile, `${JSON.stringify(marketplace, null, 2)}\n`);

console.log(`Staged ${pluginName} ${manifest.version} in ${marketplaceRoot}`);
