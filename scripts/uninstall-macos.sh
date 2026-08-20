#!/bin/bash
set -euo pipefail

host_name="com.openai.chrome_tab_grouping.json"
host_manifests=(
  "${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts/${host_name}"
  "${HOME}/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts/${host_name}"
  "${HOME}/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts/${host_name}"
  "${HOME}/Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts/${host_name}"
  "${HOME}/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/${host_name}"
  "${HOME}/Library/Application Support/Chromium/NativeMessagingHosts/${host_name}"
)

removed=false
for host_manifest in "${host_manifests[@]}"; do
  if [[ -f "${host_manifest}" ]]; then
    rm -f "${host_manifest}"
    echo "Removed ${host_manifest}."
    removed=true
  fi
done

if [[ "${removed}" == false ]]; then
  echo "The Chrome native messaging registration was already absent."
fi

echo "Remove 'Chrome Tab Grouping Companion' from chrome://extensions in each profile."
echo "Remove the Codex plugin from your personal marketplace separately if installed."
