Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$installRoot = Join-Path $env:LOCALAPPDATA "ChromeTabGrouping"
$hostName = "com.openai.chrome_tab_grouping"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

if (Test-Path $registryPath) {
    Remove-Item -Recurse -Force $registryPath
    Write-Host "Removed the Chrome native messaging registration."
} else {
    Write-Host "The Chrome native messaging registration was already absent."
}

if (Test-Path $installRoot) {
    Remove-Item -Recurse -Force $installRoot
    Write-Host "Removed $installRoot."
}

$generatedMcpLauncher = Join-Path $projectRoot "bin\chrome-tab-grouping-mcp.exe"
if (Test-Path $generatedMcpLauncher) { Remove-Item -Force $generatedMcpLauncher }

Write-Host "Remove 'Chrome Tab Grouping Companion' from chrome://extensions in each profile."
Write-Host "Remove the Codex plugin from your personal marketplace separately if installed."
