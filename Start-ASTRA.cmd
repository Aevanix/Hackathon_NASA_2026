@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo Could not determine the installed Node.js version.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 24 (
  echo ASTRA needs Node.js 24 or later. Found Node.js %NODE_MAJOR%.
  pause
  exit /b 1
)

echo Starting ASTRA. This window will stay open while you use the website.
echo The launcher will wait for the server and open ASTRA in your default browser.
node --env-file-if-exists=.env backend\launcher.mjs
if errorlevel 1 (
  echo.
  echo ASTRA did not start. If port 4173 is busy, close the other ASTRA server or run:
  echo   set PORT=4174
  echo   node --env-file-if-exists=.env backend\launcher.mjs
  echo Then open the URL printed by the launcher.
  pause
  exit /b 1
)
