param(
  [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSCommandPath
$SemVerPattern = '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'

function Fail([string]$Message) {
  throw "[OpenCat version] $Message"
}

function Read-TextFile([string]$RelativePath) {
  $path = Join-Path $RepoRoot $RelativePath
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing file: $RelativePath"
  }
  return [IO.File]::ReadAllText($path)
}

function Write-TextFile([string]$RelativePath, [string]$Content) {
  $path = Join-Path $RepoRoot $RelativePath
  [IO.File]::WriteAllText($path, $Content, [Text.UTF8Encoding]::new($false))
}

function Replace-FirstMatch(
  [string]$RelativePath,
  [string]$Pattern,
  [scriptblock]$Replacement,
  [System.Text.RegularExpressions.RegexOptions]$Options = [System.Text.RegularExpressions.RegexOptions]::Multiline
) {
  $text = Read-TextFile $RelativePath
  $regex = [Text.RegularExpressions.Regex]::new($Pattern, $Options)
  $match = $regex.Match($text)
  if (-not $match.Success) {
    Fail "Could not find version field in $RelativePath"
  }
  $newValue = & $Replacement $match
  $updated = $text.Substring(0, $match.Index) + $newValue + $text.Substring($match.Index + $match.Length)
  Write-TextFile $RelativePath $updated
  Write-Host "Updated $RelativePath"
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = Read-Host 'Enter OpenCat version, for example 7.0.2'
}
$Version = $Version.Trim()

if ($Version.StartsWith('v')) {
  Fail "Use a plain SemVer value without a leading 'v', for example 7.0.2."
}
if ($Version -notmatch $SemVerPattern) {
  Fail "Invalid SemVer value: $Version"
}

Set-Location $RepoRoot

Replace-FirstMatch 'package.json' '(\s*"version"\s*:\s*")[^"]+(")' {
  param($match)
  $match.Groups[1].Value + $Version + $match.Groups[2].Value
}

Replace-FirstMatch '.release-please-manifest.json' '(\s*"\."\s*:\s*")[^"]+(")' {
  param($match)
  $match.Groups[1].Value + $Version + $match.Groups[2].Value
}

Replace-FirstMatch 'launcher\package.json' '(\s*"version"\s*:\s*")[^"]+(")' {
  param($match)
  $match.Groups[1].Value + $Version + $match.Groups[2].Value
}

Replace-FirstMatch 'launcher\src-tauri\Cargo.toml' '^(\s*version\s*=\s*")[^"]+(")' {
  param($match)
  $match.Groups[1].Value + $Version + $match.Groups[2].Value
}

Replace-FirstMatch 'launcher\src-tauri\Cargo.lock' '(\[\[package\]\]\r?\nname = "opencat-launcher"\r?\nversion = ")[^"]+(")' {
  param($match)
  $match.Groups[1].Value + $Version + $match.Groups[2].Value
} ([System.Text.RegularExpressions.RegexOptions]::Singleline)

Replace-FirstMatch 'launcher\src-tauri\tauri.conf.json' '(\s*"version"\s*:\s*")[^"]+(")' {
  param($match)
  $match.Groups[1].Value + $Version + $match.Groups[2].Value
}

Replace-FirstMatch 'launcher\src-tauri\src\lib.rs' '^(const APP_VERSION:\s*&str\s*=\s*")[^"]+(";)' {
  param($match)
  $match.Groups[1].Value + $Version + $match.Groups[2].Value
}

Replace-FirstMatch 'docs\opencat-packaging.md' '^(OpenCat )\S+( ships as a Tauri launcher plus bundled runtime\.)' {
  param($match)
  $match.Groups[1].Value + $Version + $match.Groups[2].Value
}

Write-Host ''
Write-Host "OpenCat version updated to $Version."
