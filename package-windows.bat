@echo off
setlocal

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\package-windows.ps1" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo OpenCat packaging finished successfully.
) else (
  echo OpenCat packaging failed with exit code %EXITCODE%.
)
pause
exit /b %EXITCODE%
