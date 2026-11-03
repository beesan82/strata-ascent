@echo off
setlocal
rem STRATA ASCENT launcher

cd /d "%~dp0"

if not exist "node_modules" goto install
goto run

:install
echo [STRATA ASCENT] Installing dependencies...
call npm install
if errorlevel 1 goto installerror
goto run

:installerror
echo [STRATA ASCENT] npm install failed. Please check that Node.js is installed.
pause
exit /b 1

:run
echo [STRATA ASCENT] Starting dev server...
echo [STRATA ASCENT] Open http://localhost:5173/ in your browser.
start "" http://localhost:5173/
call npm run dev
