!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Checking for running OpenCat backend processes..."

opencat_cleanup_retry:
  System::Call 'Kernel32::SetEnvironmentVariable(t "OPENCAT_INSTALL_DIR", t "$INSTDIR") i.r0'
  StrCmp $0 "0" opencat_cleanup_environment_failed 0

  nsExec::ExecToStack `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { $$ErrorActionPreference='Stop'; $$runtime=Join-Path $$env:OPENCAT_INSTALL_DIR 'resources\opencat-runtime'; $$node=Join-Path $$runtime 'node\node.exe'; $$cli=Join-Path $$runtime 'dist\cli.mjs'; function Find-Backend { try { $$all=Get-CimInstance Win32_Process } catch { $$all=Get-WmiObject Win32_Process }; @($$all | Where-Object { $$_.Name -eq 'node.exe' -and ($$_.ExecutablePath -ieq $$node -or ([string]$$_.CommandLine) -match [regex]::Escape($$cli)) }) }; $$items=@(Find-Backend); foreach($$item in $$items){ $$processId=[int]$$item.ProcessId; Write-Output ('Stopping OpenCat backend PID ' + $$processId); Stop-Process -Id $$processId -Force -ErrorAction SilentlyContinue }; if($$items.Count -gt 0){ Wait-Process -Id $$items.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }; if(@(Find-Backend).Count -gt 0){ throw 'OpenCat backend is still running under the install directory.' } }"`
  Pop $2
  Pop $3
  StrCmp $3 "" opencat_cleanup_check_process_exit 0
  DetailPrint "$3"

opencat_cleanup_check_process_exit:
  StrCmp $2 "0" opencat_cleanup_check_lock opencat_cleanup_failed

opencat_cleanup_check_lock:
  nsExec::ExecToStack `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { $$ErrorActionPreference='Stop'; $$node=Join-Path $$env:OPENCAT_INSTALL_DIR 'resources\opencat-runtime\node\node.exe'; if(Test-Path -LiteralPath $$node){ try { $$stream=[System.IO.File]::Open($$node,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); $$stream.Close() } catch { throw ('OpenCat runtime node.exe is still locked: ' + $$_.Exception.Message) } } }"`
  Pop $2
  Pop $3
  StrCmp $3 "" opencat_cleanup_check_lock_exit 0
  DetailPrint "$3"

opencat_cleanup_check_lock_exit:
  StrCmp $2 "0" opencat_cleanup_done opencat_cleanup_failed

opencat_cleanup_environment_failed:
  DetailPrint "Unable to pass the OpenCat installation directory to PowerShell."

opencat_cleanup_failed:
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "OpenCat is still running or its runtime file is locked. Please close OpenCat, then click Retry to continue installing." IDRETRY opencat_cleanup_retry
  System::Call 'Kernel32::SetEnvironmentVariable(t "OPENCAT_INSTALL_DIR", p 0)'
  Abort

opencat_cleanup_done:
  System::Call 'Kernel32::SetEnvironmentVariable(t "OPENCAT_INSTALL_DIR", p 0)'
!macroend
