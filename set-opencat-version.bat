@echo off
setlocal

cd /d "%~dp0"
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\set-opencat-version.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\set-opencat-version.ps1" -Version "%~1"
)
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo OpenCat version update finished successfully.
) else (
  echo OpenCat version update failed with exit code %EXITCODE%.
)
pause
exit /b %EXITCODE%
