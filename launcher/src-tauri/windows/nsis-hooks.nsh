!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Checking for running OpenCat backend processes..."
  InitPluginsDir
  StrCpy $0 "$PLUGINSDIR\opencat-preinstall-cleanup.ps1"

  FileOpen $1 "$0" w
  FileWrite $1 "param([Parameter(Mandatory=$$true)][string]$$InstallDir)$\r$\n"
  FileWrite $1 "$$ErrorActionPreference = 'Stop'$\r$\n"
  FileWrite $1 "function Normalize-Path([string]$$Path) {$\r$\n"
  FileWrite $1 "  if ([string]::IsNullOrWhiteSpace($$Path)) { return '' }$\r$\n"
  FileWrite $1 "  return [System.IO.Path]::GetFullPath($$Path).TrimEnd('\').ToLowerInvariant()$\r$\n"
  FileWrite $1 "}$\r$\n"
  FileWrite $1 "$$runtimeDir = Join-Path $$InstallDir 'resources\opencat-runtime'$\r$\n"
  FileWrite $1 "$$nodePath = Join-Path $$runtimeDir 'node\node.exe'$\r$\n"
  FileWrite $1 "$$cliPath = Join-Path $$runtimeDir 'dist\cli.mjs'$\r$\n"
  FileWrite $1 "$$nodeNorm = Normalize-Path $$nodePath$\r$\n"
  FileWrite $1 "$$cliNorm = Normalize-Path $$cliPath$\r$\n"
  FileWrite $1 "function Get-NodeProcesses {$\r$\n"
  FileWrite $1 "  try { return @(Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'node.exe' }) }$\r$\n"
  FileWrite $1 "  catch { return @(Get-WmiObject Win32_Process | Where-Object { $$_.Name -eq 'node.exe' }) }$\r$\n"
  FileWrite $1 "}$\r$\n"
  FileWrite $1 "function Find-OpenCatBackend {$\r$\n"
  FileWrite $1 "  return @(Get-NodeProcesses | Where-Object { (Normalize-Path $$_.ExecutablePath) -eq $$nodeNorm -or ([string]$$_.CommandLine).ToLowerInvariant().Contains($$cliNorm) })$\r$\n"
  FileWrite $1 "}$\r$\n"
  FileWrite $1 "$$matches = @(Find-OpenCatBackend)$\r$\n"
  FileWrite $1 "$$ids = @($$matches | ForEach-Object { [int]$$_.ProcessId } | Sort-Object -Unique)$\r$\n"
  FileWrite $1 "foreach ($$pid in $$ids) {$\r$\n"
  FileWrite $1 "  Write-Output ('Stopping OpenCat backend PID ' + $$pid)$\r$\n"
  FileWrite $1 "  Stop-Process -Id $$pid -Force -ErrorAction Stop$\r$\n"
  FileWrite $1 "}$\r$\n"
  FileWrite $1 "$$deadline = (Get-Date).AddSeconds(10)$\r$\n"
  FileWrite $1 "do {$\r$\n"
  FileWrite $1 "  Start-Sleep -Milliseconds 250$\r$\n"
  FileWrite $1 "  $$remaining = @(Find-OpenCatBackend)$\r$\n"
  FileWrite $1 "} while ($$remaining.Count -gt 0 -and (Get-Date) -lt $$deadline)$\r$\n"
  FileWrite $1 "if ($$remaining.Count -gt 0) { Write-Error 'OpenCat backend is still running under the install directory.'; exit 1 }$\r$\n"
  FileWrite $1 "if (Test-Path -LiteralPath $$nodePath) {$\r$\n"
  FileWrite $1 "  try { $$stream = [System.IO.File]::Open($$nodePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None); $$stream.Close() }$\r$\n"
  FileWrite $1 "  catch { Write-Error ('OpenCat runtime node.exe is still locked: ' + $$_.Exception.Message); exit 1 }$\r$\n"
  FileWrite $1 "}$\r$\n"
  FileWrite $1 "exit 0$\r$\n"
  FileClose $1

opencat_cleanup_retry:
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$0" -InstallDir "$INSTDIR"'
  Pop $2
  Pop $3
  StrCmp $3 "" opencat_cleanup_check_exit 0
  DetailPrint "$3"

opencat_cleanup_check_exit:
  StrCmp $2 "0" opencat_cleanup_done 0
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "OpenCat is still running or its runtime file is locked. Please close OpenCat, then click Retry to continue installing." IDRETRY opencat_cleanup_retry
  Delete "$0"
  Abort

opencat_cleanup_done:
  Delete "$0"
!macroend
