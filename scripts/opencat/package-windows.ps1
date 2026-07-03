param(
  [switch]$CheckOnly,
  [switch]$SkipToolInstall,
  [switch]$SkipBuildToolsInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
  # Windows PowerShell on supported packaging hosts should expose TLS 1.2.
}

$RequiredBunVersion = '1.3.13'
$MinimumNodeMajor = 22
$NsisUrl = 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip'
$NsisSha1 = 'EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D'
$NsisUtilsUrl = 'https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll'
$NsisUtilsSha1 = '75197FEE3C6A814FE035788D1C34EAD39349B860'
$RustupUrl = 'https://win.rustup.rs/x86_64'
$BunInstallScriptUrl = 'https://bun.com/install.ps1'
$VsBuildToolsUrl = 'https://aka.ms/vs/17/release/vs_buildtools.exe'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$TargetDir = Join-Path $RepoRoot 'launcher\src-tauri\target'
$LogPath = Join-Path $TargetDir 'opencat-package-windows.log'
$ToolsCacheDir = Join-Path $TargetDir 'opencat-package-tools'
$RuntimeDir = Join-Path $RepoRoot 'launcher\src-tauri\resources\opencat-runtime'
$NsisCacheRoot = Join-Path $env:LOCALAPPDATA 'tauri'
$NsisCacheDir = Join-Path $NsisCacheRoot 'NSIS'

$script:TranscriptStarted = $false

function Write-Step([string]$Message) {
  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Info([string]$Message) {
  Write-Host "    $Message"
}

function Fail([string]$Message) {
  throw "[OpenCat package] $Message"
}

function Prepend-Path([string]$PathToAdd) {
  if ([string]::IsNullOrWhiteSpace($PathToAdd) -or -not (Test-Path -LiteralPath $PathToAdd)) {
    return
  }
  $parts = $env:Path -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if ($parts -notcontains $PathToAdd) {
    $env:Path = "$PathToAdd;$env:Path"
  }
}

function Get-CommandPath([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    return $null
  }
  return $command.Source
}

function Invoke-External([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = $RepoRoot) {
  Write-Host ''
  Write-Host "> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($exitCode -ne 0) {
    Fail "Command failed with exit code ${exitCode}: $FilePath $($Arguments -join ' ')"
  }
}

function Download-File([string]$Url, [string]$OutFile) {
  Write-Info "Downloading $Url"
  New-Item -ItemType Directory -Path (Split-Path -Parent $OutFile) -Force | Out-Null
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -TimeoutSec 600
}

function Assert-FileSha1([string]$Path, [string]$ExpectedSha1) {
  if (-not (Test-Path -LiteralPath $Path)) {
    Fail "Missing file for SHA1 check: $Path"
  }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA1).Hash.ToUpperInvariant()
  if ($actual -ne $ExpectedSha1.ToUpperInvariant()) {
    Fail "SHA1 mismatch for $Path. Expected $ExpectedSha1, got $actual."
  }
}

function Test-IsElevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Find-NpmCmd {
  $npmCmd = Get-CommandPath 'npm.cmd'
  if ($npmCmd) {
    return $npmCmd
  }

  $nodePath = Get-CommandPath 'node.exe'
  if ($nodePath) {
    $candidate = Join-Path (Split-Path -Parent $nodePath) 'npm.cmd'
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  Fail 'npm.cmd was not found. Install Node.js 22 or newer and make sure npm.cmd is available.'
}

function Ensure-Node {
  Write-Step 'Checking Node.js'
  $node = Get-CommandPath 'node.exe'
  if (-not $node) {
    $node = Get-CommandPath 'node'
  }
  if (-not $node) {
    Fail 'Node.js was not found. Install Node.js 22 or newer before packaging.'
  }

  $versionText = (& $node --version).Trim()
  $version = [Version]($versionText.TrimStart('v') -replace '-.*$', '')
  if ($version.Major -lt $MinimumNodeMajor) {
    Fail "Node.js $versionText found at $node, but OpenCat packaging requires Node.js $MinimumNodeMajor or newer."
  }
  Write-Info "Node.js $versionText at $node"
}

function Find-Bun {
  $bun = Get-CommandPath 'bun.exe'
  if ($bun) {
    return $bun
  }

  $candidate = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
  if (Test-Path -LiteralPath $candidate) {
    return $candidate
  }

  return $null
}

function Install-Bun {
  if ($SkipToolInstall) {
    Fail "Bun was not found. Install Bun $RequiredBunVersion or rerun without -SkipToolInstall."
  }

  Write-Info "Installing Bun $RequiredBunVersion with the official PowerShell installer."
  $installer = Invoke-RestMethod -Uri $BunInstallScriptUrl
  Invoke-Expression "& {$installer} -Version $RequiredBunVersion"
  Prepend-Path (Join-Path $env:USERPROFILE '.bun\bin')
}

function Ensure-Bun {
  Write-Step 'Checking Bun'
  Prepend-Path (Join-Path $env:USERPROFILE '.bun\bin')
  $bun = Find-Bun
  if (-not $bun) {
    Install-Bun
    $bun = Find-Bun
  }
  if (-not $bun) {
    Fail 'Bun installation finished, but bun.exe was not found.'
  }

  $version = (& $bun --version).Trim()
  if ($version -ne $RequiredBunVersion) {
    Write-Warning "Bun $version is installed at $bun. This package flow was validated with Bun $RequiredBunVersion; continuing with the installed version."
  } else {
    Write-Info "Bun $version at $bun"
  }
}

function Find-Cargo {
  $cargo = Get-CommandPath 'cargo.exe'
  if ($cargo) {
    return $cargo
  }

  $candidate = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
  if (Test-Path -LiteralPath $candidate) {
    return $candidate
  }

  return $null
}

function Install-Rust {
  if ($SkipToolInstall) {
    Fail 'Rust/Cargo was not found. Install Rust stable MSVC or rerun without -SkipToolInstall.'
  }

  Write-Info 'Installing Rust stable MSVC with rustup-init.'
  $rustup = Join-Path $ToolsCacheDir 'rustup-init.exe'
  Download-File $RustupUrl $rustup
  Invoke-External $rustup @(
    '-y',
    '--profile', 'minimal',
    '--default-host', 'x86_64-pc-windows-msvc',
    '--default-toolchain', 'stable'
  )
  Prepend-Path (Join-Path $env:USERPROFILE '.cargo\bin')
}

function Ensure-Rust {
  Write-Step 'Checking Rust/Cargo'
  Prepend-Path (Join-Path $env:USERPROFILE '.cargo\bin')
  $cargo = Find-Cargo
  if (-not $cargo) {
    Install-Rust
    $cargo = Find-Cargo
  }
  if (-not $cargo) {
    Fail 'Rust installation finished, but cargo.exe was not found.'
  }

  $rustc = Get-CommandPath 'rustc.exe'
  if (-not $rustc) {
    $rustc = Join-Path $env:USERPROFILE '.cargo\bin\rustc.exe'
  }
  if (-not (Test-Path -LiteralPath $rustc)) {
    Fail 'rustc.exe was not found after Rust setup.'
  }

  Write-Info (& $cargo --version)
  Write-Info (& $rustc --version)
}

function Find-Vswhere {
  $vswhere = Get-CommandPath 'vswhere.exe'
  if ($vswhere) {
    return $vswhere
  }

  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  return $null
}

function Test-MsvcByVswhere {
  $vswhere = Find-Vswhere
  if (-not $vswhere) {
    return $false
  }

  $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Workload.VCTools -property installationPath
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($installPath)) {
    Write-Info "MSVC Build Tools found at $installPath"
    return $true
  }
  return $false
}

function Test-MsvcByDirectory {
  $roots = @()
  if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles 'Microsoft Visual Studio') }
  if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio') }

  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) {
      continue
    }
    $matches = Get-ChildItem -Path $root -Recurse -Directory -Filter MSVC -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like '*\VC\Tools\MSVC' } |
      Select-Object -First 1
    if ($matches) {
      Write-Info "MSVC toolchain directory found at $($matches.FullName)"
      return $true
    }
  }

  return $false
}

function Test-MsvcBuildTools {
  return (Test-MsvcByVswhere -or Test-MsvcByDirectory)
}

function Install-MsvcBuildTools {
  if ($SkipBuildToolsInstall -or $SkipToolInstall) {
    Fail 'MSVC Build Tools were not found. Install Microsoft C++ Build Tools or rerun without skip flags.'
  }

  Write-Info 'Downloading Microsoft Visual Studio 2022 Build Tools bootstrapper.'
  $installer = Join-Path $ToolsCacheDir 'vs_buildtools.exe'
  Download-File $VsBuildToolsUrl $installer

  $args = @(
    '--add', 'Microsoft.VisualStudio.Workload.VCTools',
    '--includeRecommended',
    '--quiet',
    '--wait',
    '--norestart'
  )

  Write-Info 'Starting Build Tools installer. Approve the UAC prompt if Windows shows one.'
  if (Test-IsElevated) {
    $process = Start-Process -FilePath $installer -ArgumentList $args -Wait -PassThru
  } else {
    $process = Start-Process -FilePath $installer -ArgumentList $args -Verb RunAs -Wait -PassThru
  }

  $exitCode = $process.ExitCode
  if ($exitCode -eq 0) {
    Write-Info 'MSVC Build Tools installation completed.'
  } elseif ($exitCode -eq 3010 -or $exitCode -eq 1641) {
    Fail "MSVC Build Tools installed but Windows reports reboot required (exit code $exitCode). Reboot, then rerun this script."
  } else {
    Fail "MSVC Build Tools installer failed with exit code $exitCode. Check Visual Studio setup logs under %TEMP%."
  }
}

function Ensure-MsvcBuildTools {
  Write-Step 'Checking Microsoft C++ Build Tools'
  if (Test-MsvcBuildTools) {
    return
  }

  Install-MsvcBuildTools
  if (-not (Test-MsvcBuildTools)) {
    Fail 'MSVC Build Tools installation finished, but the VCTools workload was not detected.'
  }
}

function Test-NsisCache {
  if (-not (Test-Path -LiteralPath $NsisCacheDir)) {
    return $false
  }

  $required = @(
    'makensis.exe',
    'Bin\makensis.exe',
    'Stubs\lzma-x86-unicode',
    'Stubs\lzma_solid-x86-unicode',
    'Plugins\x86-unicode\additional\nsis_tauri_utils.dll',
    'Include\MUI2.nsh',
    'Include\FileFunc.nsh',
    'Include\x64.nsh',
    'Include\nsDialogs.nsh',
    'Include\WinMessages.nsh',
    'Include\Win\COM.nsh',
    'Include\Win\Propkey.nsh',
    'Include\Win\RestartManager.nsh'
  )
  foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $NsisCacheDir $relative))) {
      return $false
    }
  }

  $utilsPath = Join-Path $NsisCacheDir 'Plugins\x86-unicode\additional\nsis_tauri_utils.dll'
  try {
    Assert-FileSha1 $utilsPath $NsisUtilsSha1
    return $true
  } catch {
    Write-Warning $_.Exception.Message
    return $false
  }
}

function Ensure-NsisCache {
  Write-Step 'Checking Tauri NSIS cache'
  if (Test-NsisCache) {
    Write-Info "NSIS cache ready at $NsisCacheDir"
    return
  }
  if ($SkipToolInstall) {
    Fail "Tauri NSIS cache is missing or invalid at $NsisCacheDir. Rerun without -SkipToolInstall to recreate it."
  }

  Write-Info "Creating Tauri NSIS cache at $NsisCacheDir"
  New-Item -ItemType Directory -Path $NsisCacheRoot -Force | Out-Null
  Remove-Item -LiteralPath $NsisCacheDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $NsisCacheRoot 'nsis-3.11') -Recurse -Force -ErrorAction SilentlyContinue

  $zip = Join-Path $ToolsCacheDir 'nsis-3.11.zip'
  Download-File $NsisUrl $zip
  Assert-FileSha1 $zip $NsisSha1
  Expand-Archive -LiteralPath $zip -DestinationPath $NsisCacheRoot -Force
  Rename-Item -LiteralPath (Join-Path $NsisCacheRoot 'nsis-3.11') -NewName 'NSIS'

  $utilsTarget = Join-Path $NsisCacheDir 'Plugins\x86-unicode\additional\nsis_tauri_utils.dll'
  New-Item -ItemType Directory -Path (Split-Path -Parent $utilsTarget) -Force | Out-Null
  Download-File $NsisUtilsUrl $utilsTarget
  Assert-FileSha1 $utilsTarget $NsisUtilsSha1

  if (-not (Test-NsisCache)) {
    Fail "Tauri NSIS cache was created, but validation still failed at $NsisCacheDir."
  }
  Write-Info "NSIS cache ready at $NsisCacheDir"
}

function Ensure-Prerequisites {
  Ensure-Node
  Ensure-Bun
  Ensure-Rust
  Ensure-MsvcBuildTools
  Ensure-NsisCache
}

function Assert-RuntimeStaging {
  Write-Step 'Checking staged OpenCat runtime'
  $nodeModules = Join-Path $RuntimeDir 'node_modules'
  if (-not (Test-Path -LiteralPath $nodeModules)) {
    Fail "Runtime node_modules is missing: $nodeModules"
  }

  $bunStore = Test-Path -LiteralPath (Join-Path $nodeModules '.bun')
  $oldModules = @(Get-ChildItem -LiteralPath $nodeModules -Force -Filter '.old_modules-*' -ErrorAction SilentlyContinue).Count -gt 0
  Write-Info "node_modules\.bun = $bunStore"
  Write-Info "node_modules\.old_modules-* = $oldModules"
  if ($bunStore -or $oldModules) {
    Fail 'Runtime node_modules contains Bun store or old module backups.'
  }

  $runtimeNode = Join-Path $RuntimeDir 'node\node.exe'
  $runtimeCli = Join-Path $RuntimeDir 'dist\cli.mjs'
  if (-not (Test-Path -LiteralPath $runtimeNode)) {
    Fail "Bundled Node runtime is missing: $runtimeNode"
  }
  if (-not (Test-Path -LiteralPath $runtimeCli)) {
    Fail "OpenCat CLI bundle is missing: $runtimeCli"
  }

  $version = (& $runtimeNode $runtimeCli --version).Trim()
  Write-Info "runtime version = $version"
  if ($version -ne '7.0.0 (OpenCat)') {
    Fail "Unexpected runtime version output: $version"
  }
}

function Invoke-Packaging {
  $bun = Find-Bun
  if (-not $bun) {
    Fail 'bun.exe was not found before packaging.'
  }
  $npm = Find-NpmCmd

  Write-Step 'Installing source dependencies'
  Invoke-External $bun @('install')

  Write-Step 'Building app-test-runner'
  Invoke-External $npm @('--prefix', 'packages/app-test-runner', 'install')
  Invoke-External $npm @('--prefix', 'packages/app-test-runner', 'run', 'build')

  Write-Step 'Building OpenCat CLI bundles'
  Invoke-External $bun @('run', 'build')

  Write-Step 'Preparing OpenCat runtime staging'
  Invoke-External $bun @('run', 'opencat:prepare-runtime')
  Assert-RuntimeStaging

  Write-Step 'Building Tauri NSIS installer'
  Invoke-External $bun @('run', '--cwd', 'launcher', 'tauri', 'build')

  $installer = Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'launcher\src-tauri\target\release\bundle\nsis') -Filter '*.exe' -ErrorAction Stop |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $installer) {
    Fail 'Tauri build finished, but no NSIS installer was found.'
  }

  $hash = Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
  Write-Step 'OpenCat package ready'
  Write-Info "Installer: $($installer.FullName)"
  Write-Info "Size: $($installer.Length) bytes"
  Write-Info "SHA256: $($hash.Hash)"
}

function Main {
  if ($env:OS -ne 'Windows_NT') {
    Fail 'This packaging script only supports Windows.'
  }

  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
  New-Item -ItemType Directory -Path $ToolsCacheDir -Force | Out-Null

  try {
    Start-Transcript -Path $LogPath -Force | Out-Null
    $script:TranscriptStarted = $true
  } catch {
    Write-Warning "Could not start transcript log at ${LogPath}: $($_.Exception.Message)"
  }

  Write-Step 'OpenCat Windows packaging'
  Write-Info "Repository: $RepoRoot"
  Write-Info "Log: $LogPath"

  Set-Location $RepoRoot
  Prepend-Path (Join-Path $env:USERPROFILE '.bun\bin')
  Prepend-Path (Join-Path $env:USERPROFILE '.cargo\bin')

  Ensure-Prerequisites
  if ($CheckOnly) {
    Write-Step 'CheckOnly complete'
    Write-Info 'All packaging prerequisites are ready.'
    return
  }

  Invoke-Packaging
}

try {
  Main
} finally {
  if ($script:TranscriptStarted) {
    Stop-Transcript | Out-Null
  }
}
