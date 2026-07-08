@echo off
setlocal

cd /d "%~dp0"

echo Starting OpenCat Web from source...
echo Repository: %CD%
echo.

where bun >nul 2>nul
if errorlevel 1 (
  echo Error: Bun was not found in PATH.
  echo Install Bun or add it to PATH, then run this script again.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Error: Node.js was not found in PATH.
  echo Install Node.js 22 or newer, then run this script again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call bun install
  if errorlevel 1 goto failed
  echo.
)

echo Building source...
call bun run build
if errorlevel 1 goto failed

echo.
echo Launching OpenCat Web...
echo You can pass extra options to this script, for example:
echo   start-opencat-web.bat --port 3000 --no-open
echo.

node bin/opencat web %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo OpenCat Web exited.
) else (
  echo OpenCat Web failed with exit code %EXITCODE%.
)
pause
exit /b %EXITCODE%

:failed
set "EXITCODE=%ERRORLEVEL%"
echo.
echo OpenCat Web startup failed with exit code %EXITCODE%.
pause
exit /b %EXITCODE%
