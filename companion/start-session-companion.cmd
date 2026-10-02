@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0node.exe" goto portable
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer, then run this launcher again.
  pause
  exit /b 1
)
set "SESSION_COMPANION_NODE=node"
goto run
:portable
set "SESSION_COMPANION_NODE=%~dp0node.exe"
:run
"%SESSION_COMPANION_NODE%" "%~dp0bridge.mjs" %*
set "SESSION_COMPANION_RESULT=%ERRORLEVEL%"
if not "%SESSION_COMPANION_RESULT%"=="0" pause
exit /b %SESSION_COMPANION_RESULT%
