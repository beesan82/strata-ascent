@echo off
setlocal
rem BLAME! SIM launcher

cd /d "%~dp0"

if not exist "node_modules" goto install
goto run

:install
echo [BLAME! SIM] Installing dependencies...
call npm install
if errorlevel 1 goto installerror
goto run

:installerror
echo [BLAME! SIM] npm install failed. Please check that Node.js is installed.
pause
exit /b 1

:run
echo [BLAME! SIM] Starting dev server...
echo [BLAME! SIM] Open http://localhost:5173/ in your browser.
start "" http://localhost:5173/
call npm run dev
