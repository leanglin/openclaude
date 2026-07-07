Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSCommandPath
$PackageScript = Join-Path $RepoRoot 'scripts\opencat\package-windows.ps1'

if (-not (Test-Path -LiteralPath $PackageScript)) {
  throw "OpenCat Windows packaging script was not found: $PackageScript"
}

Set-Location $RepoRoot
& $PackageScript @args
