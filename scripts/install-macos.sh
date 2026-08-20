#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
plugin_root="$(cd "${script_dir}/.." && pwd)"
host_name="com.openai.chrome_tab_grouping"
extension_id="apcbkhkgafnhjpoemlbkmnhemfpodobc"
launcher="${plugin_root}/bin/chrome-tab-grouping-native-host"
node_bin="$(command -v node || true)"
host_dirs=("${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts")
optional_host_dirs=(
  "${HOME}/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts"
  "${HOME}/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  "${HOME}/Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts"
  "${HOME}/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts"
  "${HOME}/Library/Application Support/Chromium/NativeMessagingHosts"
)

for candidate in "${optional_host_dirs[@]}"; do
  if [[ -d "$(dirname "${candidate}")" ]]; then
    host_dirs+=("${candidate}")
  fi
done

if [[ -z "${node_bin}" || ! -x "${node_bin}" ]]; then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

if [[ ! -d "${plugin_root}/node_modules/@modelcontextprotocol/sdk" ]]; then
  echo "Dependencies are missing. Run npm install in ${plugin_root} first." >&2
  exit 1
fi

printf '%s\n' "${node_bin}" > "${plugin_root}/.native-node-path"
chmod 600 "${plugin_root}/.native-node-path"
chmod +x "${launcher}" "${plugin_root}/bin/chrome-tab-grouping-mcp"

for host_dir in "${host_dirs[@]}"; do
  mkdir -p "${host_dir}"
  host_manifest="${host_dir}/${host_name}.json"
  "${node_bin}" --input-type=module - "${host_manifest}" "${launcher}" "${host_name}" "${extension_id}" <<'NODE'
import fs from "node:fs";
const [manifestPath, launcher, name, extensionId] = process.argv.slice(2);
const manifest = {
  name,
  description: "Chrome Tab Grouping native messaging bridge",
  path: launcher,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
NODE
  echo "Registered ${host_name} in ${host_dir}."
done

echo "Allowed extension ID: ${extension_id}."
echo "Load ${plugin_root}/extension in each Chrome profile you want to manage."
