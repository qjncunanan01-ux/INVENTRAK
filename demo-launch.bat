@echo off
rem ============================================================
rem  INVENTRAK — one-click demo launcher (double-click me)
rem  Starts backend + public tunnel + admin dashboard.
rem  Requires Node.js installed (used to build this project).
rem ============================================================
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org then retry.
  pause
  exit /b 1
)
echo Starting INVENTRAK demo... keep this window open.
node scripts/demo-launch.js
pause
