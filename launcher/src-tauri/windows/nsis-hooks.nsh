!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Checking for running OpenCat backend processes..."

opencat_cleanup_retry:
  nsExec::ExecToStack `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { param([string]$$InstallDir); $$ErrorActionPreference='Stop'; function Normalize-Path([string]$$Path){ if([string]::IsNullOrWhiteSpace($$Path)){ return '' }; [System.IO.Path]::GetFullPath($$Path).TrimEnd('\').ToLowerInvariant() }; $$runtimeDir=Join-Path $$InstallDir 'resources\opencat-runtime'; $$nodePath=Join-Path $$runtimeDir 'node\node.exe'; $$cliPath=Join-Path $$runtimeDir 'dist\cli.mjs'; $$nodeNorm=Normalize-Path $$nodePath; $$cliNorm=Normalize-Path $$cliPath; function Find-OpenCatBackend{ try{ $$nodes=@(Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'node.exe' }) } catch { $$nodes=@(Get-WmiObject Win32_Process | Where-Object { $$_.Name -eq 'node.exe' }) }; @($$nodes | Where-Object { (Normalize-Path $$_.ExecutablePath) -eq $$nodeNorm -or ([string]$$_.CommandLine).ToLowerInvariant().Contains($$cliNorm) }) }; $$ids=@(Find-OpenCatBackend | ForEach-Object { [int]$$_.ProcessId } | Sort-Object -Unique); foreach ($$processId in $$ids){ Write-Output ('Stopping OpenCat backend PID ' + $$processId); Stop-Process -Id $$processId -Force -ErrorAction Stop }; $$deadline=(Get-Date).AddSeconds(10); do { Start-Sleep -Milliseconds 250; $$remaining=@(Find-OpenCatBackend) } while ($$remaining.Count -gt 0 -and (Get-Date) -lt $$deadline); if($$remaining.Count -gt 0){ Write-Error 'OpenCat backend is still running under the install directory.'; exit 1 }; if(Test-Path -LiteralPath $$nodePath){ try { $$stream=[System.IO.File]::Open($$nodePath,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); $$stream.Close() } catch { Write-Error ('OpenCat runtime node.exe is still locked: ' + $$_.Exception.Message); exit 1 } }; exit 0 }" "$INSTDIR"`
  Pop $2
  Pop $3
  StrCmp $3 "" opencat_cleanup_check_exit 0
  DetailPrint "$3"

opencat_cleanup_check_exit:
  StrCmp $2 "0" opencat_cleanup_done 0
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "OpenCat is still running or its runtime file is locked. Please close OpenCat, then click Retry to continue installing." IDRETRY opencat_cleanup_retry
  Abort

opencat_cleanup_done:
!macroend
