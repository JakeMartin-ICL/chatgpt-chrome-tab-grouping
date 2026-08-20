Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$installRoot = Join-Path $env:LOCALAPPDATA "ChromeTabGrouping"
$installBin = Join-Path $installRoot "bin"
$installDist = Join-Path $installRoot "dist"
$hostName = "com.openai.chrome_tab_grouping"
$extensionId = "apcbkhkgafnhjpoemlbkmnhemfpodobc"
$registryPath = "HKCU\Software\Google\Chrome\NativeMessagingHosts\$hostName"

$nodeCommand = Get-Command node.exe -ErrorAction Stop
$nodePath = $nodeCommand.Source
$nodeVersionText = (& $nodePath --version).TrimStart("v")
$nodeMajor = [int]($nodeVersionText.Split(".")[0])
if ($nodeMajor -lt 22) {
    throw "Node.js 22 or newer is required; found $nodeVersionText."
}

$nativeBundle = Join-Path $projectRoot "dist\native-host.js"
$launcherSource = Join-Path $projectRoot "src\windows\launcher.cs"
if (-not (Test-Path $nativeBundle) -or -not (Test-Path $launcherSource)) {
    throw "Windows runtime files are missing. Run npm run build first."
}

New-Item -ItemType Directory -Force -Path $installBin, $installDist | Out-Null

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $projectRoot ".native-node-path"), "$nodePath`n", $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $installRoot ".native-node-path"), "$nodePath`n", $utf8NoBom)

Copy-Item -Force $nativeBundle (Join-Path $installDist "native-host.js")
[System.IO.File]::WriteAllText(
    (Join-Path $installRoot "package.json"),
    "{`n  `"private`": true,`n  `"type`": `"module`"`n}`n",
    $utf8NoBom
)

$temporaryLauncher = Join-Path ([System.IO.Path]::GetTempPath()) ("chrome-tab-grouping-launcher-" + [guid]::NewGuid().ToString("N") + ".exe")
try {
    $source = [System.IO.File]::ReadAllText($launcherSource)
    Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $temporaryLauncher -OutputType ConsoleApplication
    Copy-Item -Force $temporaryLauncher (Join-Path $projectRoot "bin\chrome-tab-grouping-mcp.exe")
    $nativeLauncher = Join-Path $installBin "chrome-tab-grouping-native-host.exe"
    Copy-Item -Force $temporaryLauncher $nativeLauncher
} finally {
    if (Test-Path $temporaryLauncher) { Remove-Item -Force $temporaryLauncher }
}

$extensionSource = Join-Path $projectRoot "extension"
$extensionTarget = Join-Path $installRoot "extension"
New-Item -ItemType Directory -Force -Path $extensionTarget | Out-Null
Copy-Item -Recurse -Force (Join-Path $extensionSource "*") $extensionTarget

$manifestPath = Join-Path $installRoot "$hostName.json"
$manifest = [ordered]@{
    name = $hostName
    description = "Chrome Tab Grouping native messaging bridge"
    path = (Join-Path $installBin "chrome-tab-grouping-native-host.exe")
    type = "stdio"
    allowed_origins = @("chrome-extension://$extensionId/")
}
[System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 4) + "`n"), $utf8NoBom)

& reg.exe ADD $registryPath /ve /t REG_SZ /d $manifestPath /f | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to register the Chrome native messaging host." }

Write-Host "Registered $hostName for the current Windows user."
Write-Host "Allowed extension ID: $extensionId."
Write-Host "Load $extensionTarget as an unpacked extension in each Chrome profile you want to manage."
