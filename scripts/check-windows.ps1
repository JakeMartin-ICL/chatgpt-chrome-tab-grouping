Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
foreach ($relativePath in @("scripts\install-windows.ps1", "scripts\uninstall-windows.ps1")) {
    $tokens = $null
    $parseErrors = $null
    $fullPath = Join-Path $projectRoot $relativePath
    [System.Management.Automation.Language.Parser]::ParseFile($fullPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($null -ne $parseErrors -and $parseErrors.Count -gt 0) {
        $messages = ($parseErrors | ForEach-Object { $_.Message }) -join "; "
        throw "$relativePath failed PowerShell parsing: $messages"
    }
}

$temporaryLauncher = Join-Path ([System.IO.Path]::GetTempPath()) ("chrome-tab-grouping-check-" + [guid]::NewGuid().ToString("N") + ".exe")
try {
    $source = [System.IO.File]::ReadAllText((Join-Path $projectRoot "src\windows\launcher.cs"))
    Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $temporaryLauncher -OutputType ConsoleApplication
    if (-not (Test-Path $temporaryLauncher)) { throw "C# launcher compilation produced no executable." }
} finally {
    if (Test-Path $temporaryLauncher) { Remove-Item -Force $temporaryLauncher }
}

Write-Host "Windows PowerShell scripts and native launcher are valid."
