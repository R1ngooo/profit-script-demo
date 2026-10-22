@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js 20+ is required but was not found.
  echo Install from: https://nodejs.org/
  echo Or use the packaged version: release\profit-script-v1.2.0-win-x64\profit-script.cmd
  echo.
  pause
  exit /b 1
)

node "scripts\start-app.mjs" %*

if errorlevel 1 (
  echo.
  echo Failed to start. Please check the error messages above.
  pause
)
